/**
 * core/single-image/detail-intelligence/detail-plan-builder.js
 *
 * EPIC 2E-P1G — Detail Intelligence, Sharpening and Noise Reduction.
 *
 * Orchestrates the full Detail Plan from real session evidence:
 *
 *   session.evidence.imageAnalysis (core/image-analysis-core) +
 *   session.evidence.skin (skin-classifier/skintone-engine, merged) +
 *   session.evidence.stats (histogram-engine) +
 *   candidate.diagnostics.basicToneIntelligence (P1F, read-only)
 *     -> extractDetailEvidence()       (detail-evidence-extractor.js)
 *     -> classifyDetailScene()         (edge-detail-classifier.js)
 *     -> planSharpening()              (sharpening-planner.js)
 *     -> planNoiseReduction()          (noise-reduction-planner.js,
 *                                        using noise-profile-estimator.js)
 *     -> applyDetailGuardrails()       (detail-guardrails.js)
 *     -> buildDetailLineage() / summarizeDetailDiagnostics()
 *        (detail-lineage.js)
 *
 * Pure function: reads `evidence` and the already-committed P1F
 * `basicToneDiagnostics` (both computed upstream by the existing
 * pipeline), never calls a Core analysis module itself, never touches
 * the DOM, never mutates its input, and NEVER writes to
 * candidate.basic.* or candidate.hsl/grading/cal (P1F/P1E territory --
 * see P1G_P1F_DETAIL_COORDINATION_POLICY.md). Mirrors the architecture
 * of basic-tone-intelligence/basic-tone-plan-builder.js.
 */

import {
  DETAIL_SCHEMA_VERSION, DEFAULT_STRENGTH_MODE, buildEmptyDetailPlan,
} from './detail-schema.js';
import { extractDetailEvidence } from './detail-evidence-extractor.js';
import { classifyDetailScene } from './edge-detail-classifier.js';
import { planSharpening } from './sharpening-planner.js';
import { planNoiseReduction } from './noise-reduction-planner.js';
import { applyDetailGuardrails } from './detail-guardrails.js';
import { buildDetailLineage, summarizeDetailDiagnostics } from './detail-lineage.js';
import { MIN_EVIDENCE_CONFIDENCE } from './detail-schema.js';

/**
 * @param {object} evidence   session.evidence (read-only)
 * @param {object} [opts]
 * @param {string} [opts.strengthMode]
 * @param {object} [opts.basicToneDiagnostics]  candidate.diagnostics.basicToneIntelligence (P1F, read-only)
 * @param {number} [opts.p1fTexture]  candidate.basic.texture (already-final P1F value, read-only)
 * @param {number} [opts.p1fClarity]  candidate.basic.clarity (already-final P1F value, read-only)
 * @returns {object} the full Detail Plan
 */
export function buildDetailPlan(evidence, {
  strengthMode = DEFAULT_STRENGTH_MODE,
  basicToneDiagnostics = null,
  p1fTexture = 0,
  p1fClarity = 0,
} = {}) {
  const extraction = extractDetailEvidence(evidence, basicToneDiagnostics);

  if (!extraction.ok || extraction.confidence < MIN_EVIDENCE_CONFIDENCE) {
    const empty = buildEmptyDetailPlan();
    empty.strengthMode = strengthMode;
    empty.confidence = extraction.confidence ?? 0;
    if (extraction.reasons?.length) empty.diagnostics.reasons = [...empty.diagnostics.reasons, ...extraction.reasons];
    return empty;
  }

  const ev = extraction.evidence;
  const { flags, reasons: classificationReasons } = classifyDetailScene(ev);

  const sharpeningPlan = planSharpening(ev, flags, { strengthMode, p1fTexture, p1fClarity });
  const noiseReductionPlan = planNoiseReduction(ev, flags, { strengthMode });

  const lowDetail = flags.includes('LOW_DETAIL');
  const { values: finalValuesRaw, adjustments: guardrailAdjustments, protections: guardrailProtections } = applyDetailGuardrails(
    { sharpening: sharpeningPlan.amount, noiseReductionLuminance: noiseReductionPlan.luminance },
    { skinCoverage: ev.skinCoverage, motionBlurRisk: ev.motionBlurRisk, lowDetail },
  );

  const finalValues = { sharpening: finalValuesRaw.sharpening, noiseReductionLuminance: finalValuesRaw.noiseReduction };

  const lineage = buildDetailLineage({ sceneClass: flags, confidence: extraction.confidence, sharpeningPlan, noiseReductionPlan });
  const diagnostics = summarizeDetailDiagnostics({
    sceneClass: flags, flags, finalValues, guardrailAdjustments, classificationReasons,
    sharpeningRationale: sharpeningPlan.rationale, noiseReductionRationale: noiseReductionPlan.rationale,
  });

  return {
    schemaVersion: DETAIL_SCHEMA_VERSION,
    strengthMode,
    sceneClass: flags,
    confidence: extraction.confidence,
    evidence: ev,
    sharpening: { amount: finalValues.sharpening, bucket: sharpeningPlan.bucket, rationale: sharpeningPlan.rationale, confidence: sharpeningPlan.confidence },
    noiseReduction: {
      luminance: finalValues.noiseReductionLuminance, color: noiseReductionPlan.color,
      bucket: noiseReductionPlan.bucket, rationale: noiseReductionPlan.rationale, confidence: noiseReductionPlan.confidence,
    },
    protections: {
      skinProtection: {
        applied: guardrailProtections.skinProtection.applied || sharpeningPlan.skinReduced || noiseReductionPlan.skinReduced,
        coveragePct: ev.skinCoverage, confidence: null,
      },
      haloProtection: guardrailProtections.haloProtection || sharpeningPlan.haloProtection,
      lowDetailProtection: guardrailProtections.lowDetailProtection,
      motionBlurProtection: guardrailProtections.motionBlurProtection || sharpeningPlan.motionBlurProtection,
      oversmoothingProtection: noiseReductionPlan.oversmoothingProtection,
      focusLimited: diagnostics.focusLimited,
    },
    finalValues,
    lineage,
    diagnostics,
  };
}
