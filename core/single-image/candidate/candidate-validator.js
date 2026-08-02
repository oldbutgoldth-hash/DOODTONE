/**
 * EPIC 2E-P1C — Candidate Validator
 *
 * Range/required-field/nested-schema validation plus safety-warning
 * collection. No formula tuning happens here — ranges are taken
 * verbatim from two real, already-audited sources (see
 * P1C_LIGHTROOM_PARAMETER_CONTRACT.md and
 * P1C_CANDIDATE_SOURCE_LINEAGE_AUDIT.md §12):
 *
 *  1. SLIDER_RANGES  — the real DOM `min`/`max` UI limits
 *     (index.html + ui/ui-engine.js's renderHSLPanel/
 *     renderGradingPanel/renderCalibrationPanel). Used to clamp a
 *     manual slider edit to what the UI already allows.
 *  2. HARD_LIMITS    — re-exported, unmodified, from
 *     core/xmp-validator/index.js. This is the SAME "modest range"
 *     safety ceiling `quickSafetyClamp()`/`validateFinalPreset()`
 *     already apply; P1C reuses it to raise WARNINGS on a Candidate
 *     value, but does not itself clamp — quickSafetyClamp remains the
 *     one authoritative clamp, run again at export time exactly as it
 *     was before P1C (see legacy-preset-adapter.js / P1C_MODIFIED_FILES.md).
 */

import { HARD_LIMITS } from '../../xmp-validator/index.js';
import { validateCandidateShape } from './candidate-schema.js';

// ─── Real DOM/UI ranges (audited, not invented) ─────────────────────
export const SLIDER_RANGES = Object.freeze({
  exp: [-200, 200], con: [-100, 100], hi: [-100, 100], sh: [-100, 100],
  wh: [-100, 100], bl: [-100, 100],
  temp: [-100, 100], tint: [-100, 100],
  vib: [-100, 100], sat: [-100, 100],
  sharp: [0, 150], noise: [0, 100],
  clarity: [-100, 100], dehaze: [-100, 100], texture: [-100, 100],
  hsl_h: [-100, 100], hsl_s: [-100, 100], hsl_l: [-100, 100],
  grd_h: [0, 360], grd_s: [0, 100], grd_l: [-100, 100], grd_blend: [0, 100],
  cal_h: [-100, 100], cal_s: [-100, 100],
  // crv_hi/mid/sh: no DOM range exists (hidden inputs) — no invented
  // limit; left unconstrained here, matching the audit finding.
});

export { HARD_LIMITS };

function _clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

/** Clamp a raw slider-edit value to its real DOM range. Returns {value, clamped}. */
export function clampToSliderRange(rangeKey, rawValue) {
  const range = SLIDER_RANGES[rangeKey];
  if (!range) return { value: rawValue, clamped: false }; // no known DOM range (e.g. crv_*) — pass through
  const [lo, hi] = range;
  const v = _clamp(rawValue, lo, hi);
  return { value: v, clamped: v !== rawValue };
}

/** Soft safety-ceiling check (HARD_LIMITS) — produces warnings, never rejects, never clamps by itself. */
function _checkHardLimits(candidate, warnings) {
  const b = candidate.basic;
  const basicMap = { exposure: 'exposure', contrast: 'contrast', highlights: 'highlights', shadows: 'shadows', whites: 'whites', blacks: 'blacks' };
  for (const [field, limitKey] of Object.entries(basicMap)) {
    const [lo, hi] = HARD_LIMITS.basic[limitKey];
    const v = b[field];
    if (typeof v === 'number' && (v < lo || v > hi)) warnings.push(`basic.${field} (${v}) exceeds the modest safety range [${lo},${hi}] — quickSafetyClamp will re-tighten this at export.`);
  }
  const wb = candidate.whiteBalance;
  if (Math.abs(wb.temperature) > HARD_LIMITS.wb.tempCap * 1.5) warnings.push(`whiteBalance.temperature (${wb.temperature}) exceeds the safety ceiling.`);
  if (wb.tint < HARD_LIMITS.wb.tintGreenFloorIntentional || wb.tint > HARD_LIMITS.wb.tintMagentaCeil) warnings.push(`whiteBalance.tint (${wb.tint}) exceeds the safety ceiling.`);

  const SKIN_CHANNELS = new Set(['red', 'orange', 'yellow']);
  for (const ch of Object.keys(candidate.hsl.saturation)) {
    const isSkin = SKIN_CHANNELS.has(ch);
    const cap = isSkin ? HARD_LIMITS.hsl.skinSatHi + 4 : HARD_LIMITS.hsl.colorSatCap + 5;
    const v = candidate.hsl.saturation[ch];
    if (Math.abs(v) > cap) warnings.push(`hsl.saturation.${ch} (${v}) exceeds the safety ceiling (±${cap}).`);
  }
  for (const prim of ['red', 'green', 'blue']) {
    const v = candidate.cal[`${prim}PrimarySaturation`];
    if (Math.abs(v) > HARD_LIMITS.calibration.satCap + 5) warnings.push(`cal.${prim}PrimarySaturation (${v}) exceeds the safety ceiling.`);
  }
  if (Math.abs(candidate.basic.vibrance) > HARD_LIMITS.presence.vibCap + 10) warnings.push(`basic.vibrance (${candidate.basic.vibrance}) exceeds the safety ceiling.`);
  if (Math.abs(candidate.basic.saturation) > HARD_LIMITS.presence.satCap + 10) warnings.push(`basic.saturation (${candidate.basic.saturation}) exceeds the safety ceiling.`);
}

/**
 * Full Candidate validation: structural (candidate-schema.js) + range
 * + safety-warning collection. Never silently discards an invalid
 * parameter — errors and warnings are both returned in full.
 * @returns {{status, errors, warnings, normalizedCandidate}}
 */
export function validateCandidate(candidate) {
  const shapeResult = validateCandidateShape(candidate);
  if (shapeResult.errors.length > 0) return shapeResult;

  const warnings = [...shapeResult.warnings];
  _checkHardLimits(candidate, warnings);

  const status = warnings.length > 0 ? 'VALID_WITH_WARNINGS' : 'VALID';
  return { status, errors: [], warnings, normalizedCandidate: candidate };
}
