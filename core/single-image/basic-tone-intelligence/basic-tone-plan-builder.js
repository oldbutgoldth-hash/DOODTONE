/**
 * core/single-image/basic-tone-intelligence/basic-tone-plan-builder.js
 *
 * EPIC 2E-P1F — Basic Tone Intelligence & Adaptive Dynamic Range.
 *
 * Orchestrates the full Basic Tone Plan from real session evidence:
 *
 *   session.evidence.stats (histogram-engine) + session.evidence.skin
 *   (skin-classifier/skintone-engine, merged)
 *     -> classifyDynamicRange()          (dynamic-range-classifier.js)
 *     -> computeExposureRecommendation() (exposure-recommendation.js)
 *     -> computeHighlightRecovery() / computeShadowRecovery()
 *        (highlight-shadow-recovery.js)
 *     -> computeWhitesRecommendation() / computeBlacksRecommendation()
 *        (black-white-point-planner.js)
 *     -> computeContrastRecommendation() / computeLocalContrastDetail()
 *        (local-contrast-planner.js)
 *     -> applyBasicToneGuardrails()      (basic-tone-guardrails.js)
 *     -> buildBasicToneLineage() / summarizeBasicToneDiagnostics()
 *        (basic-tone-lineage.js)
 *
 * Pure function: reads `evidence` (already computed upstream by the
 * existing pipeline), never calls a Core analysis module itself, never
 * touches the DOM, never mutates its input. Mirrors the architecture
 * of core/single-image/color-intelligence/color-plan-builder.js.
 */

import {
  BASIC_TONE_SCHEMA_VERSION, STRENGTH_SCALARS, DEFAULT_STRENGTH_MODE,
  SCENE_CLASS, SKIN_HEAVY_COVERAGE_PCT, skinCautionScale, buildEmptyBasicTonePlan,
} from './basic-tone-schema.js';
import { classifyDynamicRange } from './dynamic-range-classifier.js';
import { computeExposureRecommendation } from './exposure-recommendation.js';
import { computeHighlightRecovery, computeShadowRecovery } from './highlight-shadow-recovery.js';
import { computeWhitesRecommendation, computeBlacksRecommendation } from './black-white-point-planner.js';
import { computeContrastRecommendation, computeLocalContrastDetail } from './local-contrast-planner.js';
import { applyBasicToneGuardrails } from './basic-tone-guardrails.js';
import { buildBasicToneLineage, summarizeBasicToneDiagnostics } from './basic-tone-lineage.js';

function _resultOf(evidence, key) {
  const entry = evidence?.[key];
  if (!entry || typeof entry !== 'object') return null;
  const usable = entry.status === 'COMPLETED' || entry.status === 'CACHE_HIT';
  return usable ? (entry.result ?? null) : null;
}

/**
 * @param {object} evidence  session.evidence (read-only)
 * @param {{strengthMode?: string}} [opts]
 * @returns {object} the full Basic Tone Plan (see schema shape / P1F architecture doc)
 */
export function buildBasicTonePlan(evidence, { strengthMode = DEFAULT_STRENGTH_MODE } = {}) {
  const stats = _resultOf(evidence, 'stats');
  if (!stats || typeof stats.avgLum !== 'number' || stats.total === 0) {
    const empty = buildEmptyBasicTonePlan();
    empty.strengthMode = strengthMode;
    return empty;
  }

  const skinResult = _resultOf(evidence, 'skin');
  const skin = {
    coveragePct: typeof skinResult?.coveragePct === 'number' ? skinResult.coveragePct : null,
    confidence: typeof skinResult?.confidence === 'number' ? skinResult.confidence : null,
  };
  const isSkinHeavy = typeof skin.coveragePct === 'number' && skin.coveragePct >= SKIN_HEAVY_COVERAGE_PCT;
  const skinScale = skinCautionScale(skin);

  const strengthScalar = STRENGTH_SCALARS[strengthMode] ?? STRENGTH_SCALARS[DEFAULT_STRENGTH_MODE];

  const { sceneClass, confidence, reasons: classificationReasons, signalsUsed } = classifyDynamicRange({ stats, skin });

  // ── Technical correction (exposure/highlights/shadows/whites/blacks) ──
  const shadowsRec = computeShadowRecovery({ stats, sceneClass, strengthScalar });
  const highlightsRec = computeHighlightRecovery({ stats, sceneClass, strengthScalar });
  const exposureRec = computeExposureRecommendation({ stats, sceneClass, strengthScalar, plannedShadowRecoveryValue: shadowsRec.value });
  const whiteClothingProtection = isSkinHeavy && (stats.avgLum > 165 || sceneClass === SCENE_CLASS.HIGH_KEY);
  const whitesRec = computeWhitesRecommendation({ stats, sceneClass, strengthScalar, whiteClothingProtection });
  const blacksRec = computeBlacksRecommendation({ stats, sceneClass, strengthScalar });

  // ── Tonal character (contrast/texture/clarity/dehaze) ──
  const contrastRec = computeContrastRecommendation({ stats, sceneClass, skinScale, strengthScalar });
  const detail = computeLocalContrastDetail({ stats, sceneClass, skinScale, strengthScalar });

  const noiseRisk = sceneClass === SCENE_CLASS.UNDEREXPOSED || sceneClass === SCENE_CLASS.LOW_KEY;
  const { values: finalValues, adjustments: guardrailAdjustments, noiseProtection } = applyBasicToneGuardrails({
    exposure: exposureRec.value, contrast: contrastRec.value, highlights: highlightsRec.value,
    shadows: shadowsRec.value, whites: whitesRec.value, blacks: blacksRec.value,
    texture: detail.texture.value, clarity: detail.clarity.value, dehaze: detail.dehaze.value,
  }, { noiseRisk });

  const fieldRecommendations = {
    exposure: exposureRec, contrast: contrastRec, highlights: highlightsRec, shadows: shadowsRec,
    whites: whitesRec, blacks: blacksRec, texture: detail.texture, clarity: detail.clarity, dehaze: detail.dehaze,
  };
  const lineage = buildBasicToneLineage({ sceneClass, confidence, fieldRecommendations });
  const diagnostics = summarizeBasicToneDiagnostics({ sceneClass, finalValues, guardrailAdjustments, classificationReasons });

  return {
    schemaVersion: BASIC_TONE_SCHEMA_VERSION,
    strengthMode,
    sceneClass,
    confidence,
    evidence: { source: 'histogram-engine', signalsUsed, skin },
    technicalCorrection: {
      exposure: exposureRec.value, highlights: highlightsRec.value,
      shadows: shadowsRec.value, whites: whitesRec.value, blacks: blacksRec.value,
    },
    tonalCharacter: {
      contrast: contrastRec.value, texture: detail.texture.value,
      clarity: detail.clarity.value, dehaze: detail.dehaze.value,
    },
    protections: {
      highlightProtection: highlightsRec.value < 0,
      shadowProtection: shadowsRec.value > 0,
      skinProtection: { applied: isSkinHeavy, coveragePct: skin.coveragePct, confidence: skin.confidence, scale: skinScale },
      noiseProtection,
      hazeConfidence: detail.dehaze.hazeConfidence ?? 0,
    },
    finalValues,
    lineage,
    diagnostics,
  };
}
