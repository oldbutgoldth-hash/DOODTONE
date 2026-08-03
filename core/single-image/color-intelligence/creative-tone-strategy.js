/**
 * core/single-image/color-intelligence/creative-tone-strategy.js
 *
 * EPIC 2E-P1E R3 — Stronger Creative Tone Engine, scene-aware layer.
 *
 * Formalizes the "technicalCorrection vs creativeTone" split requested
 * for R3 WITHOUT duplicating or replacing any restoration formula
 * already owned by color-plan-builder.js. This module answers exactly
 * two pure questions, from EXISTING evidence only (session.evidence
 * via evidence-color-signals.js, and the Candidate's own current
 * color-field values) -- it never calls a Core analysis module and
 * never fabricates a signal that isn't already present:
 *
 *   1. classifyScene(...)         -- which ONE scene class best
 *      describes this image, from real evidence, so color-plan-
 *      builder.js can ask for a bounded, explainable adjustment
 *      instead of always applying the same restoration fraction.
 *   2. getFamilyMultiplier(...)   -- given that scene class, a small,
 *      bounded per-field-family multiplier (never below 0.5, never
 *      above 1.3) that color-plan-builder.js multiplies into its
 *      EXISTING restoration `fraction` before calling the EXISTING
 *      `_restoreTowardEvidence()` / `restoreCircularHue()` functions.
 *      The final result is ALWAYS still passed through the same hard
 *      `_clamp(..., hardBound)` those functions already apply, so no
 *      scene multiplier can ever push a value outside `BOUNDS`
 *      (color-intelligence-schema.js) -- the multiplier only changes
 *      HOW MUCH of the already-bounded restoration gap is spent, never
 *      the ceiling itself.
 *
 * "technicalCorrection" vs "creativeTone" (documented split, R3):
 *   - technicalCorrection: signals that argue for RESTRAINT --
 *     oversaturation-reduction (ALREADY_SATURATED scene class) and the
 *     existing skin-caution scale (skinCautionScale(), unchanged,
 *     still owned by color-intelligence-schema.js). These only ever
 *     scale a multiplier DOWN from 1.0.
 *   - creativeTone: signals that argue for STRONGER, more intentional
 *     restoration -- portrait/skin-heavy separation, green-outdoor
 *     foliage separation, colorful-costume preservation, and low-
 *     saturation vibrance preference. These scale a multiplier UP from
 *     1.0, always bounded to +30% max.
 *   compose() in color-plan-builder.js = the existing
 *   `_restoreTowardEvidence(cur, evidenceTarget, fraction, hardBound)`
 *   / `restoreCircularHue(cur, target, fraction)` calls, where
 *   `fraction = strengthScalar * technicalMultiplier * creativeMultiplier * skinCaution`
 *   -- i.e. this module supplies ADDITIONAL FACTORS into the SAME
 *   compose expression, never a parallel computation.
 */

export const SCENE_CLASS = Object.freeze({
  PORTRAIT_SKIN: 'PORTRAIT_SKIN',
  GREEN_OUTDOOR: 'GREEN_OUTDOOR',
  COLORFUL_COSTUME: 'COLORFUL_COSTUME',
  ALREADY_SATURATED: 'ALREADY_SATURATED',
  LOW_SATURATION: 'LOW_SATURATION',
  GENERIC: 'GENERIC',
});

// Evidence thresholds -- chosen to require REAL, meaningfully-sized
// signal before a scene class engages; below threshold, GENERIC
// (neutral, 1.0-multiplier) handling applies. No value here ever
// exceeds the +/-30% ceiling documented above.
const SKIN_HEAVY_COVERAGE_PCT = 15;
const SCENE_CONFIDENCE_MIN = 0.40;
const ALREADY_SATURATED_MAGNITUDE = 40; // sum of |hsl.saturation[ch]| across all 8 channels
const LOW_SATURATION_MAGNITUDE = 8;

const GREEN_OUTDOOR_PATTERN = /outdoor|landscape|nature|forest|park|garden|foliage|mountain|hike|countryside/;
const COLORFUL_COSTUME_PATTERN = /travel|costume|festival|market|culture|parade|carnival|street/;

/**
 * @param {object} params
 * @param {object} params.signals               deriveColorSignals() output
 * @param {object} params.candidateColorFields   candidate.hsl / candidate.grading / candidate.cal / candidate.basic (already-reshaped, pre-P1E values)
 * @returns {{sceneClass:string, reasons:string[], signalsUsed:object}}
 */
export function classifyScene({ signals, candidateColorFields } = {}) {
  const skinCoveragePct = signals?.skin?.coveragePct ?? null;
  const isSkinHeavy = typeof skinCoveragePct === 'number' && skinCoveragePct >= SKIN_HEAVY_COVERAGE_PCT;

  const sceneCategoryRaw = signals?.scene?.category ?? null;
  const sceneCategory = typeof sceneCategoryRaw === 'string' ? sceneCategoryRaw.toLowerCase() : '';
  const sceneConfidence = typeof signals?.scene?.confidence === 'number' ? signals.scene.confidence : 0;
  const isGreenOutdoor = sceneConfidence >= SCENE_CONFIDENCE_MIN && GREEN_OUTDOOR_PATTERN.test(sceneCategory);
  const isColorfulCostume = sceneConfidence >= SCENE_CONFIDENCE_MIN && COLORFUL_COSTUME_PATTERN.test(sceneCategory);

  const hslSat = candidateColorFields?.hsl?.saturation ?? {};
  const satMagnitudeSum = Object.values(hslSat).reduce((s, v) => s + Math.abs(typeof v === 'number' ? v : 0), 0);
  const isAlreadySaturated = satMagnitudeSum >= ALREADY_SATURATED_MAGNITUDE;
  const isLowSaturation = !isAlreadySaturated && satMagnitudeSum <= LOW_SATURATION_MAGNITUDE;

  const reasons = [];
  let sceneClass = SCENE_CLASS.GENERIC;

  // Skin protection has structural priority (project convention) --
  // checked first, so a skin-heavy portrait is never reclassified as
  // "already saturated" or "green outdoor" even if a background
  // happens to match those signals too.
  if (isSkinHeavy) {
    sceneClass = SCENE_CLASS.PORTRAIT_SKIN;
    reasons.push(`skin coverage ${skinCoveragePct}% >= ${SKIN_HEAVY_COVERAGE_PCT}% -- portrait/skin-heavy handling engaged (skin channels keep full existing protection; non-skin channels get gentle separation).`);
  } else if (isGreenOutdoor) {
    sceneClass = SCENE_CLASS.GREEN_OUTDOOR;
    reasons.push(`scene "${sceneCategoryRaw}" (confidence ${sceneConfidence}) matched green/outdoor pattern -- foliage-separation handling engaged.`);
  } else if (isColorfulCostume) {
    sceneClass = SCENE_CLASS.COLORFUL_COSTUME;
    reasons.push(`scene "${sceneCategoryRaw}" (confidence ${sceneConfidence}) matched colorful/travel pattern -- costume-preservation handling engaged.`);
  } else if (isAlreadySaturated) {
    sceneClass = SCENE_CLASS.ALREADY_SATURATED;
    reasons.push(`existing HSL saturation magnitude sum ${satMagnitudeSum.toFixed(1)} >= ${ALREADY_SATURATED_MAGNITUDE} -- restraint handling engaged (no global overboost).`);
  } else if (isLowSaturation) {
    sceneClass = SCENE_CLASS.LOW_SATURATION;
    reasons.push(`existing HSL saturation magnitude sum ${satMagnitudeSum.toFixed(1)} <= ${LOW_SATURATION_MAGNITUDE} -- Vibrance-preferred handling engaged.`);
  } else {
    reasons.push('no scene-specific signal met its threshold -- generic bounded restoration applies (neutral 1.0 multipliers).');
  }

  return {
    sceneClass,
    reasons,
    signalsUsed: { skinCoveragePct, sceneCategory: sceneCategoryRaw, sceneConfidence, satMagnitudeSum: +satMagnitudeSum.toFixed(2) },
  };
}

/**
 * Bounded per-family multipliers, keyed by scene class. Every value is
 * in [0.5, 1.3] -- never enough, even combined with the STRONG
 * strength-mode scalar (1.30) and a skinCaution factor, to escape the
 * hard `_clamp(..., hardBound)` ceiling color-plan-builder.js always
 * applies afterward. `hslNonSkin` never applies to skin-adjacent
 * channels (red/orange/yellow) -- those keep their own, separate,
 * always-active `skinCautionScale()` regardless of scene class.
 */
const FAMILY_MULTIPLIERS = Object.freeze({
  [SCENE_CLASS.PORTRAIT_SKIN]: { hslNonSkin: 1.05, presenceVibrance: 1.15, presenceSaturation: 0.75, grading: 0.85, calibration: 0.85 },
  [SCENE_CLASS.GREEN_OUTDOOR]: { hslNonSkin: 1.15, presenceVibrance: 1.05, presenceSaturation: 1.00, grading: 1.05, calibration: 1.00 },
  [SCENE_CLASS.COLORFUL_COSTUME]: { hslNonSkin: 1.20, presenceVibrance: 1.10, presenceSaturation: 1.05, grading: 1.10, calibration: 1.05 },
  [SCENE_CLASS.ALREADY_SATURATED]: { hslNonSkin: 0.70, presenceVibrance: 0.70, presenceSaturation: 0.60, grading: 0.85, calibration: 0.90 },
  [SCENE_CLASS.LOW_SATURATION]: { hslNonSkin: 1.00, presenceVibrance: 1.25, presenceSaturation: 0.90, grading: 1.00, calibration: 1.00 },
  [SCENE_CLASS.GENERIC]: { hslNonSkin: 1.00, presenceVibrance: 1.00, presenceSaturation: 1.00, grading: 1.00, calibration: 1.00 },
});

/**
 * @param {string} sceneClass  one of SCENE_CLASS
 * @param {string} family      'hslNonSkin' | 'presenceVibrance' | 'presenceSaturation' | 'grading' | 'calibration'
 * @returns {number} multiplier in [0.5, 1.3]
 */
export function getFamilyMultiplier(sceneClass, family) {
  const row = FAMILY_MULTIPLIERS[sceneClass] ?? FAMILY_MULTIPLIERS[SCENE_CLASS.GENERIC];
  const v = row[family];
  return typeof v === 'number' ? v : 1.0;
}

export function getAllFamilyMultipliers(sceneClass) {
  return { ...(FAMILY_MULTIPLIERS[sceneClass] ?? FAMILY_MULTIPLIERS[SCENE_CLASS.GENERIC]) };
}
