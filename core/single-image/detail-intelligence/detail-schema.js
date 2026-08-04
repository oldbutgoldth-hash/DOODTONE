/**
 * core/single-image/detail-intelligence/detail-schema.js
 *
 * EPIC 2E-P1G — Detail Intelligence, Sharpening and Noise Reduction.
 *
 * Pure constants and shape helpers for the Detail Plan. No
 * Session/DOM access, no Core analysis calls, no XMP knowledge --
 * mirrors core/single-image/basic-tone-intelligence/basic-tone-schema.js
 * in shape and in its safety-net rationale (see
 * P1G_DETAIL_VALUE_LINEAGE_AUDIT.md).
 *
 * IMPORTANT: as documented in the audit (§5), core/xmp-validator's
 * HARD_LIMITS has ZERO entries for any Detail field -- both
 * detail.sharpening and detail.noiseReduction have clampGroup: null in
 * xmp-property-map.js. This means Layer B (quickSafetyClamp) provides
 * NO protection whatsoever for Sharpening or Noise Reduction, before
 * or after this EPIC. The BOUNDS below (Layer A, enforced by
 * detail-guardrails.js) are therefore the ONLY safety net either field
 * will ever get -- deliberately conservative and always enforced,
 * exactly like P1F's texture/clarity/dehaze bounds.
 */

export const DETAIL_SCHEMA_VERSION = 'P1G_DETAIL_PLAN@1';

/** Internal strength strategy names. CRISP remains skin-safe and halo-safe -- see detail-guardrails.js. */
export const STRENGTH_MODE = Object.freeze({
  NATURAL: 'NATURAL',
  BALANCED: 'BALANCED',
  CRISP: 'CRISP',
});

export const DEFAULT_STRENGTH_MODE = STRENGTH_MODE.BALANCED;

/** Per-mode scalar applied to the normalized strength BEFORE bucket positioning (never after -- so a mode can never push a value outside its class bucket). */
export const STRENGTH_SCALARS = Object.freeze({
  [STRENGTH_MODE.NATURAL]: 0.72,
  [STRENGTH_MODE.BALANCED]: 1.00,
  [STRENGTH_MODE.CRISP]: 1.22,
});

/** Non-exclusive Detail scene flags -- an image may carry several at once. Evidence-derived only, never filename/UI-derived (see evidence extractor). */
export const DETAIL_SCENE_FLAGS = Object.freeze([
  'CLEAN_HIGH_DETAIL', 'CLEAN_PORTRAIT', 'LOW_LIGHT_PORTRAIT', 'HIGH_NOISE',
  'COLOR_NOISE', 'SOFT_FOCUS', 'MOTION_BLUR_RISK', 'FINE_TEXTURE',
  'LOW_DETAIL', 'LOW_CONFIDENCE',
]);

/**
 * Export-safe Sharpening buckets (§ spec "Export-safe limits", subject
 * to the real source audit -- these are guardrail RANGES, never
 * mandatory fixed outputs; a class never forces its minimum).
 */
export const SHARPENING_BUCKETS = Object.freeze({
  NOISY_OR_SOFT: { lo: 0, hi: 18 },
  CLEAN_PORTRAIT: { lo: 8, hi: 22 },
  DETAILED_PORTRAIT_EVENT: { lo: 14, hi: 28 },
  LANDSCAPE_DETAIL: { lo: 18, hi: 35 },
});

/** Export-safe Luminance Noise Reduction buckets. */
export const NOISE_REDUCTION_BUCKETS = Object.freeze({
  CLEAN: { lo: 0, hi: 8 },
  MILD: { lo: 6, hi: 18 },
  MODERATE: { lo: 14, hi: 28 },
  STRONG: { lo: 22, hi: 35 }, // "strong noise max 35 this phase"
});

/** Absolute Layer-A bound for the two genuinely Candidate-driven Detail fields (union of all buckets above -- the final defensive clamp in detail-guardrails.js). */
export const BOUNDS = Object.freeze({
  sharpening: { lo: 0, hi: 35 },
  noiseReduction: { lo: 0, hi: 35 },
});

/** Minimum evidence confidence before this layer trusts imageAnalysis evidence at all. Below this, everything falls back to a conservative LOW_CONFIDENCE plan (mirrors P1F's MIN_EVIDENCE_CONFIDENCE convention). */
export const MIN_EVIDENCE_CONFIDENCE = 0.4;

/** Skin-heavy coverage threshold -- same convention/value as P1F's SKIN_HEAVY_COVERAGE_PCT (basic-tone-schema.js), expressed here as a 0-1 fraction since detail-evidence-extractor.js normalizes skinCoverage to 0-1. */
export const SKIN_HEAVY_COVERAGE_FRACTION = 0.15;

/** Thresholds used by edge-detail-classifier.js / noise-profile-estimator.js. Documented here once so tests and planners share the same numbers. */
export const THRESHOLDS = Object.freeze({
  highNoise: 0.55,
  mildNoiseFloor: 0.15,
  moderateNoiseFloor: 0.35,
  strongNoiseFloor: 0.60,
  colorNoise: 0.5,
  highDetailEdgeDensity: 0.6,
  fineTextureDensity: 0.65,
  lowDetailEdgeDensity: 0.25,
  lowFocusConfidence: 0.45,
  motionBlurRisk: 0.5,
  lowLightConfidence: 0.5,
});

/**
 * Required bilingual diagnostic text (verbatim, per spec) shown when
 * Sharpening was deliberately reduced because source sharpness is
 * genuinely limited (soft focus / motion-blur risk) -- never a promise
 * that missed focus can be recovered.
 */
export const FOCUS_LIMITED_TEXT = Object.freeze({
  th: 'ภาพมีความคมชัดต้นฉบับจำกัด ระบบจึงลดการเพิ่มความคมเพื่อป้องกันขอบภาพแตก',
  en: 'Source sharpness is limited, so sharpening was reduced to avoid halos.',
});

export function buildEmptyDetailPlan() {
  return {
    schemaVersion: DETAIL_SCHEMA_VERSION,
    strengthMode: DEFAULT_STRENGTH_MODE,
    sceneClass: ['LOW_CONFIDENCE'],
    confidence: 0,
    evidence: {
      source: 'none',
      luminanceNoise: null, chromaNoise: null, edgeDensity: null, fineDetailDensity: null,
      motionBlurRisk: null, focusConfidence: null, skinCoverage: null, lowLightConfidence: null,
      shadowLiftRisk: null, compressionArtifactRisk: null,
    },
    sharpening: { amount: 0, bucket: 'NOISY_OR_SOFT', rationale: ['no usable Image Analysis Core evidence'], confidence: 0 },
    noiseReduction: {
      luminance: 0, color: { recommended: null, supported: false, reason: 'Color Noise Reduction is hardcoded by the serializer (crs:ColorNoiseReduction="25") -- never Candidate-derived. See P1G_SUPPORTED_XMP_DETAIL_FIELDS.md.' },
      bucket: 'CLEAN', rationale: ['no usable Image Analysis Core evidence'], confidence: 0,
    },
    protections: {
      skinProtection: { applied: false, coveragePct: null, confidence: null },
      haloProtection: false, lowDetailProtection: false, motionBlurProtection: false, oversmoothingProtection: false,
      focusLimited: false,
    },
    finalValues: { sharpening: 0, noiseReductionLuminance: 0 },
    lineage: {},
    diagnostics: { engaged: false, reasons: ['no usable Image Analysis Core evidence -- Detail Plan left at neutral defaults'], flags: ['LOW_CONFIDENCE'] },
  };
}
