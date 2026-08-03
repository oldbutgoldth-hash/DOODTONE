/**
 * core/single-image/basic-tone-intelligence/basic-tone-schema.js
 *
 * EPIC 2E-P1F — Basic Tone Intelligence & Adaptive Dynamic Range.
 *
 * Pure constants and shape helpers for the Basic Tone Plan. No
 * Session/DOM access, no Core analysis calls, no XMP knowledge --
 * same convention as core/single-image/color-intelligence/
 * color-intelligence-schema.js, which this module deliberately
 * mirrors in shape (see P1F_BASIC_TONE_INTELLIGENCE_ARCHITECTURE.md).
 *
 * IMPORTANT: this module never imports or duplicates
 * core/xmp-validator's HARD_LIMITS constants. The bounds below are a
 * SEPARATE, independently-owned set of limits for this new layer,
 * chosen to sit safely inside (never outside) HARD_LIMITS.basic for
 * exposure/contrast/highlights/shadows/whites/blacks -- the six
 * fields quickSafetyClamp() actually clamps (see
 * P1F_BASIC_VALUE_LINEAGE_AUDIT.md). For texture/clarity/dehaze --
 * which quickSafetyClamp() does NOT clamp at all (clampGroup: null in
 * the P1D property map) -- these bounds are the ONLY safety net those
 * three fields get, so they are deliberately conservative.
 */

export const BASIC_TONE_SCHEMA_VERSION = 'P1F_BASIC_TONE_PLAN@1';

/** Internal strength strategy names (architecture/extensibility -- no new user-facing panel this round). */
export const STRENGTH_MODE = Object.freeze({
  NATURAL: 'NATURAL',
  BALANCED: 'BALANCED',
  DRAMATIC: 'DRAMATIC',
});

export const DEFAULT_STRENGTH_MODE = STRENGTH_MODE.BALANCED;

/**
 * Per-mode scalar applied to every recommended magnitude (both
 * technicalCorrection and tonalCharacter fields) before guardrail
 * bounding. Deliberately NOT wired to the P1E color STRENGTH_SCALARS
 * -- Basic Tone strength governs tonal structure only, per this
 * EPIC's explicit scope (see P1F_P1E_COMPOSITION_POLICY.md).
 */
export const STRENGTH_SCALARS = Object.freeze({
  [STRENGTH_MODE.NATURAL]: 0.60,
  [STRENGTH_MODE.BALANCED]: 1.00,
  [STRENGTH_MODE.DRAMATIC]: 1.35,
});

/** Dynamic-range / tonal-character scene classes, evidence-derived only (never filename/UI-derived). */
export const SCENE_CLASS = Object.freeze({
  UNDEREXPOSED: 'UNDEREXPOSED',
  OVEREXPOSED: 'OVEREXPOSED',
  HIGH_DYNAMIC_RANGE: 'HIGH_DYNAMIC_RANGE',
  LOW_CONTRAST: 'LOW_CONTRAST',
  HIGH_CONTRAST: 'HIGH_CONTRAST',
  HIGH_KEY: 'HIGH_KEY',
  LOW_KEY: 'LOW_KEY',
  BALANCED: 'BALANCED',
  HAZY: 'HAZY',
  LOW_CONFIDENCE: 'LOW_CONFIDENCE',
});

/**
 * Local, independently-owned bounds (Layer A of the two-layer safety
 * net -- see project convention). Each is the maximum this layer will
 * ever write for that field, before quickSafetyClamp() (Layer B) runs
 * at export time. For exposure/contrast/highlights/shadows/whites/
 * blacks these sit strictly inside core/xmp-validator's
 * HARD_LIMITS.basic ([-35,35]/[-20,25]/[-55,10]/[-25,35]/[-30,20]/
 * [-35,15]) so normal P1F output never depends on that downstream
 * clamp to save it from an unreasonable value. For texture/clarity/
 * dehaze -- which HARD_LIMITS.basic does not cover at all -- these
 * are the only bound that will ever apply.
 */
export const BOUNDS = Object.freeze({
  exposure: { lo: -25, hi: 25 },
  contrast: { lo: -15, hi: 20 },
  highlights: { lo: -40, hi: 8 },
  shadows: { lo: -15, hi: 28 },
  whites: { lo: -22, hi: 16 },
  blacks: { lo: -25, hi: 12 },
  texture: { lo: -20, hi: 20 },
  clarity: { lo: -18, hi: 16 },
  dehaze: { lo: -5, hi: 25 },
});

/** Minimum histogram-engine confidence before this layer trusts the evidence at all. Below this, everything falls back to a conservative LOW_CONFIDENCE plan. */
export const MIN_EVIDENCE_CONFIDENCE = 0.45;

/** Skin-heavy coverage threshold -- reuses the same style of threshold as P1E's creative-tone-strategy.js. */
export const SKIN_HEAVY_COVERAGE_PCT = 15;

/** Haze-evidence thresholds (proxy: low contrastRatio + low avgSatPct + moderate-low drStops -- see P1F_DYNAMIC_RANGE_CLASSIFICATION.md for why no dedicated haze sensor exists yet). */
export const HAZE_CONTRAST_RATIO_MAX = 3.2;
export const HAZE_SAT_PCT_MAX = 22;
export const HAZE_MIN_CONFIDENCE = 0.5;

/** Skin-caution scale factor for Texture/Clarity/Contrast, mirroring P1E's skinCautionScale() shape but owned independently by this layer. */
export function skinCautionScale({ skinCoveragePct = null, skinConfidence = null } = {}) {
  if (skinCoveragePct === null || skinConfidence === null) return 0.6;
  if (skinCoveragePct <= 2) return 1.0;
  const confidenceFactor = Math.max(0.4, Math.min(1, skinConfidence));
  if (skinCoveragePct >= 25) return 0.35 * confidenceFactor + 0.05;
  if (skinCoveragePct >= 10) return 0.5 * confidenceFactor + 0.1;
  return 0.7 * confidenceFactor + 0.15;
}

export function buildEmptyBasicTonePlan() {
  return {
    schemaVersion: BASIC_TONE_SCHEMA_VERSION,
    strengthMode: DEFAULT_STRENGTH_MODE,
    sceneClass: SCENE_CLASS.LOW_CONFIDENCE,
    confidence: 0,
    evidence: { source: 'none', reasons: ['no usable stats evidence'] },
    technicalCorrection: { exposure: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0 },
    tonalCharacter: { contrast: 0, texture: 0, clarity: 0, dehaze: 0 },
    protections: {
      highlightProtection: false, shadowProtection: false,
      skinProtection: { applied: false, coveragePct: null, confidence: null, scale: 1.0 },
      noiseProtection: false, hazeConfidence: 0,
    },
    finalValues: {
      exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0,
      texture: 0, clarity: 0, dehaze: 0,
    },
    lineage: {},
    diagnostics: { engaged: false, reasons: ['no usable stats evidence -- Basic Tone Plan left at neutral defaults'], fieldsAdjusted: [] },
  };
}
