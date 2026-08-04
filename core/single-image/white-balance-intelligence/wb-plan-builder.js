/**
 * core/single-image/white-balance-intelligence/wb-plan-builder.js
 *
 * EPIC 2E-P1H — orchestrates the White Balance Plan: Evidence ->
 * neutral-reference confidence -> illuminant/object-bias separation ->
 * skin-consistency validation -> mixed-light detection -> cast
 * classification -> confidence-tiered, guardrail-capped correction ->
 * protections -> finalValues -> lineage -> diagnostics.
 *
 * Pure function: never touches the DOM/Canvas, never mutates its
 * input, never calls analyzeWhiteBalance()/detectColorCast() itself
 * (both already ran for real upstream -- see wb-evidence-extractor.js).
 * candidate-builder.js is the only place that writes this plan's
 * finalValues into candidate.whiteBalance.temperature/.tint.
 *
 * See P1H_WHITE_BALANCE_VALUE_LINEAGE_AUDIT.md §1 for why this
 * function deliberately applies AT MOST ONE mood-preservation-style
 * dampening factor (reused from whitebalance-engine, never
 * re-derived) instead of the legacy path's three compounding
 * multiplicative factors.
 */

import { extractWBEvidence } from './wb-evidence-extractor.js';
import { neutralRegionConfidence } from './neutral-region-confidence.js';
import { separateIlluminantFromObjectBias } from './illuminant-object-bias-separator.js';
import { validateSkinConsistency } from './skin-consistency-validator.js';
import { detectMixedLight } from './mixed-light-detector.js';
import { classifyCast } from './cast-classifier.js';
import { getGuardrailCaps, clampTemp, clampTint } from './wb-guardrails.js';
import { buildWBLineage } from './wb-lineage.js';
import {
  WB_PLAN_SCHEMA_VERSION, DEFAULT_STRENGTH_MODE, CONFIDENCE_TIER, WB_PLAN_STATUS, createEmptyPlan,
} from './white-balance-schema.js';

function _clamp01(v) { return Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0)); }

/**
 * @param {object} evidence   session.evidence (read-only)
 * @param {object} [opts]
 * @param {string} [opts.strengthMode]  one of STRENGTH_MODE
 * @returns {object}  the White Balance Plan (see white-balance-schema.js)
 */
export function buildWhiteBalancePlan(evidence, { strengthMode = DEFAULT_STRENGTH_MODE } = {}) {
  const extraction = extractWBEvidence(evidence);
  if (!extraction.ok) {
    const empty = createEmptyPlan();
    empty.strengthMode = strengthMode;
    empty.diagnostics.reasons = extraction.reasons;
    return empty;
  }

  const wbEvidence = extraction.evidence;
  const neutralConfidence = neutralRegionConfidence(wbEvidence);
  const objectBias = separateIlluminantFromObjectBias(wbEvidence);
  const skinValidation = validateSkinConsistency(wbEvidence);
  const mixedLight = detectMixedLight(wbEvidence);

  let planConfidence = _clamp01(
    0.35 * neutralConfidence.confidence +
    0.30 * wbEvidence.estimatorAgreement +
    0.15 * (skinValidation.trusted ? skinValidation.confidence : 0) +
    0.20 * (1 - Math.max(objectBias.score, mixedLight.score))
  );
  const transferRiskScore = wbEvidence._raw?.wbIntent?.transferRiskScore ?? 0;
  planConfidence = _clamp01(planConfidence * (1 - 0.3 * transferRiskScore));

  const confidenceTier = planConfidence >= 0.65 ? CONFIDENCE_TIER.HIGH
    : planConfidence >= 0.35 ? CONFIDENCE_TIER.MODERATE
    : CONFIDENCE_TIER.LOW;

  const classification = classifyCast(wbEvidence, objectBias, mixedLight, planConfidence);
  const { tempCap, tintCap } = getGuardrailCaps(confidenceTier, strengthMode);

  const rawTemp = wbEvidence.rawTemperature;
  const rawTint = wbEvidence.rawTint;
  const preservationFactor = wbEvidence._raw?.moodPreservation?.preservationFactor ?? 0.4;
  const intentionalLightPreserved = classification.isIntentional;
  const moodFactor = intentionalLightPreserved ? preservationFactor : 1.0;

  let correctionTemp = Math.round(rawTemp * moodFactor);
  let correctionTint = Math.round(rawTint * moodFactor);

  const objectColorBiasGuard = objectBias.isObjectColorBias;
  if (objectColorBiasGuard) {
    correctionTemp = Math.round(correctionTemp * 0.4);
    correctionTint = Math.round(correctionTint * 0.4);
  }

  const mixedLightGuard = mixedLight.isMixedLight;
  if (mixedLightGuard) {
    correctionTemp = Math.round(correctionTemp * 0.6);
    correctionTint = Math.round(correctionTint * 0.6);
  }

  correctionTemp = clampTemp(Math.max(-tempCap, Math.min(tempCap, correctionTemp)));
  correctionTint = clampTint(Math.max(-tintCap, Math.min(tintCap, correctionTint)));

  const correction = { temperature: correctionTemp, tint: correctionTint };
  const finalValues = { ...correction };

  const neutralReferenceTrusted = neutralConfidence.confidence >= 0.5;
  const protections = {
    neutralReferenceTrusted,
    skinValidationApplied: skinValidation.trusted,
    objectColorBiasGuard,
    mixedLightGuard,
    intentionalLightPreserved,
  };

  const reasons = [
    `Raw reading temp=${rawTemp}/tint=${rawTint} (estimator agreement ${wbEvidence.estimatorAgreement}).`,
    neutralConfidence.reason,
    objectBias.reason,
    mixedLight.reason,
    intentionalLightPreserved
      ? `Classified as intentional lighting (mood-preservation factor ${preservationFactor}) -- correction scaled, not zeroed.`
      : 'Classified as a likely technical defect -- full evidence-tier correction applied, up to the guardrail cap.',
    `Confidence tier: ${confidenceTier} (plan confidence ${planConfidence.toFixed(3)}) -> caps +/-${tempCap} temp, +/-${tintCap} tint at ${strengthMode} strength.`,
  ];
  const warnings = [];
  if (objectColorBiasGuard) warnings.push('Object-color bias detected -- correction reduced to avoid over-responding to a background/object color rather than the scene illuminant.');
  if (mixedLightGuard) warnings.push('Mixed lighting detected -- correction kept conservative.');
  if (!skinValidation.trusted && wbEvidence._raw?.skinCoveragePct != null) warnings.push(`Skin evidence present but not used for validation: ${skinValidation.reason}`);

  const engaged = correction.temperature !== 0 || correction.tint !== 0;

  const lineage = buildWBLineage({
    evidence: wbEvidence, classification, mixedLight, objectBias, skinValidation, neutralConfidence,
    correction, finalValues, confidenceTier, strengthMode,
  });

  return {
    schemaVersion: WB_PLAN_SCHEMA_VERSION,
    status: extraction.degraded ? WB_PLAN_STATUS.DEGRADED : WB_PLAN_STATUS.OK,
    strengthMode,
    confidence: +planConfidence.toFixed(3),
    confidenceTier,
    evidence: wbEvidence,
    classification: {
      primaryCast: classification.primaryCast,
      flags: classification.flags,
      isIntentional: classification.isIntentional,
      mixedLightDetected: mixedLightGuard,
      objectColorBiasScore: objectBias.score,
    },
    correction,
    protections,
    finalValues,
    lineage,
    diagnostics: { engaged, reasons, warnings, mixedLightMessage: mixedLight.message },
  };
}
