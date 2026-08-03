/**
 * core/single-image/color-intelligence/color-intelligence-schema.js
 *
 * EPIC 2E-P1E — Color Intelligence & Creative Tone Candidate.
 *
 * Pure constants and shape helpers for the Color Intelligence layer.
 * No Session/DOM access, no Core analysis calls, no XMP knowledge.
 * See P1E_COLOR_INTELLIGENCE_ARCHITECTURE.md for the full design
 * rationale and P1E_CREATIVE_TONE_HEURISTICS.md for why each bound
 * below was chosen.
 *
 * IMPORTANT: this module never imports or duplicates
 * core/xmp-validator's HARD_LIMITS constants (that table belongs to
 * the Reference-Color-Match / fingerprint-aware validation path and
 * to the final `quickSafetyClamp()` export safety net — both of which
 * this EPIC must not touch). The bounds below are a SEPARATE, tighter,
 * independently-owned set of limits for this new layer, chosen to sit
 * safely inside (never outside) the values `quickSafetyClamp()` and
 * `validateFinalPreset()` already enforce elsewhere in the app, so
 * that P1E enrichment can never depend on a downstream clamp to save
 * it from an unreasonable value ("two-layer safety net" convention).
 */

export const COLOR_INTELLIGENCE_SCHEMA_VERSION = 'P1E_COLOR_PLAN@1';

/** Internal strength strategy names (architecture/extensibility only — no new user-facing panel in this EPIC). */
export const STRENGTH_MODE = Object.freeze({
  NATURAL: 'NATURAL',
  BALANCED: 'BALANCED',
  CINEMATIC: 'CINEMATIC',
  STRONG: 'STRONG',
});

/** The new, intentionally-stronger-than-before default (still bounded and skin-safe). */
export const DEFAULT_STRENGTH_MODE = STRENGTH_MODE.BALANCED;

/**
 * Per-mode scalar applied to the "restoration fraction" (see
 * color-plan-builder.js) before any hard bound is applied. NATURAL is
 * intentionally close to pre-P1E (conservative) behavior; BALANCED is
 * the new default; CINEMATIC/STRONG exist for architectural
 * extensibility (e.g., a future user-facing intensity control) and
 * are validated by tests even though nothing in this EPIC exposes
 * them in the UI yet.
 */
export const STRENGTH_SCALARS = Object.freeze({
  [STRENGTH_MODE.NATURAL]: 0.35,
  [STRENGTH_MODE.BALANCED]: 0.70,
  [STRENGTH_MODE.CINEMATIC]: 1.00,
  [STRENGTH_MODE.STRONG]: 1.30,
});

export const HSL_CHANNEL_IDS = Object.freeze(['red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'magenta']);
export const GRADING_ZONE_IDS = Object.freeze(['shadows', 'midtones', 'highlights']);
export const CAL_PRIMARY_IDS = Object.freeze(['red', 'green', 'blue']);

/** Channels adjacent to real human skin tones — always the most tightly protected. */
export const SKIN_ADJACENT_HSL_CHANNELS = Object.freeze(new Set(['red', 'orange', 'yellow']));

/**
 * Local, independently-owned bounds (Layer A of the two-layer safety
 * net). Each is a maximum ABSOLUTE MAGNITUDE this layer will ever
 * write, before `quickSafetyClamp()` (Layer B) runs at export time.
 * Skin bounds are deliberately asymmetric to match real photographic
 * practice: a small amount of extra warmth reads as healthy, a small
 * amount of desaturation reads as safe, while too much of either
 * direction reads as sunburnt/jaundiced/plastic.
 */
export const BOUNDS = Object.freeze({
  hsl: {
    skin: { hue: 4, satLow: 8, satHigh: 6, luminance: 10 },
    color: { hue: 14, sat: 22, luminance: 18 },
  },
  grading: {
    // Per Lightroom Color Grading semantics, these are "push amounts"
    // from a neutral 0 -- not absolute saturation percentages.
    saturation: 22,
    luminance: 12,
    shadowsHighlightsExtra: 4, // shadows/highlights may push slightly further than midtones for separation
  },
  calibration: {
    hue: 9,
    saturation: 14,
  },
  presence: {
    vibrance: 28,
    saturation: 16, // kept tighter than vibrance -- global Saturation is the least skin-safe control available
  },
});

/** Minimum evidence coverage (percent of sampled pixels) before a channel/zone/primary is considered "real enough to act on". Below this, P1E contributes nothing for that field -- never fabricates color for hues that aren't actually present. */
export const MIN_MEANINGFUL_COVERAGE_PCT = Object.freeze({
  hslChannel: 3,
  calibrationPrimary: 2,
});

/** Minimum blended confidence for grading-zone evidence to be trusted at all (evidence.grading.result.confidence). */
export const MIN_GRADING_CONFIDENCE = 0.35;

/** Skin scale-down factors applied on top of everything else for skin-adjacent HSL channels, keyed by how much real skin was detected. */
export function skinCautionScale({ skinCoveragePct = null, skinConfidence = null } = {}) {
  // No skin evidence at all (module didn't run / soft-failed): stay
  // moderately cautious by default -- "skin protection has structural
  // priority" (project convention) means we never assume "definitely
  // no skin" just because the module didn't report.
  if (skinCoveragePct === null || skinConfidence === null) return 0.5;
  if (skinCoveragePct <= 2) return 1.0;      // negligible/no skin -- no extra caution needed
  const confidenceFactor = Math.max(0.4, Math.min(1, skinConfidence));
  if (skinCoveragePct >= 25) return 0.30 * confidenceFactor + 0.05;
  if (skinCoveragePct >= 10) return 0.45 * confidenceFactor + 0.10;
  return 0.65 * confidenceFactor + 0.15; // small amount of skin present (e.g. hands, background person)
}

export function buildEmptyColorPlan() {
  return {
    schemaVersion: COLOR_INTELLIGENCE_SCHEMA_VERSION,
    strengthMode: DEFAULT_STRENGTH_MODE,
    engaged: false,
    hsl: { hue: {}, saturation: {}, luminance: {} },
    grading: {
      shadows: { hue: 0, saturation: 0, luminance: 0 },
      midtones: { hue: 0, saturation: 0, luminance: 0 },
      highlights: { hue: 0, saturation: 0, luminance: 0 },
    },
    cal: {
      redPrimaryHue: 0, redPrimarySaturation: 0,
      greenPrimaryHue: 0, greenPrimarySaturation: 0,
      bluePrimaryHue: 0, bluePrimarySaturation: 0,
    },
    presence: { vibrance: 0, saturation: 0 },
    reasons: [],
    skinProtection: { applied: false, coveragePct: null, confidence: null, scale: 1.0 },
    fieldsBoosted: [],
  };
}
