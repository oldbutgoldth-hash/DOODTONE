/**
 * EPIC 2E-P1C — Candidate Slider Adapter
 *
 * Pure mapping between the canonical Candidate's parameter paths and
 * the real DOM slider IDs (audited in
 * P1C_CANDIDATE_SOURCE_LINEAGE_AUDIT.md §2/§12). Contains NO direct
 * `document` access itself — callers (ui/app.js) inject small
 * `{ setSlider, getSlider }` accessor functions, so this module stays
 * unit-testable in plain Node and the DOM remains purely a display/
 * editor surface, never a second source of truth.
 *
 * "Rounding only for display": `renderCandidateToSliders` rounds the
 * value it writes into the slider's numeric attribute, but never
 * mutates the Candidate itself — the stored Candidate value is always
 * the exact number the builder/editor produced.
 */

import { HSL_CHANNEL_IDS, GRADING_ZONE_IDS } from './candidate-schema.js';
import { SLIDER_RANGES, clampToSliderRange } from './candidate-validator.js';

const GRADE_ZONE_ABBR = { shadows: 'sh', midtones: 'mid', highlights: 'hi' };
const GRADE_ABBR_ZONE = { sh: 'shadows', mid: 'midtones', hi: 'highlights' };

/** Every real slider ID this adapter knows about, mapped to its Candidate parameter path and its SLIDER_RANGES lookup key. */
export function buildSliderParameterMap() {
  const map = {};
  map.exp = { path: 'basic.exposure', rangeKey: 'exp' };
  map.con = { path: 'basic.contrast', rangeKey: 'con' };
  map.hi = { path: 'basic.highlights', rangeKey: 'hi' };
  map.sh = { path: 'basic.shadows', rangeKey: 'sh' };
  map.wh = { path: 'basic.whites', rangeKey: 'wh' };
  map.bl = { path: 'basic.blacks', rangeKey: 'bl' };
  map.temp = { path: 'whiteBalance.temperature', rangeKey: 'temp' };
  map.tint = { path: 'whiteBalance.tint', rangeKey: 'tint' };
  map.vib = { path: 'basic.vibrance', rangeKey: 'vib' };
  map.sat = { path: 'basic.saturation', rangeKey: 'sat' };
  map.clarity = { path: 'basic.clarity', rangeKey: 'clarity' };
  map.dehaze = { path: 'basic.dehaze', rangeKey: 'dehaze' };
  map.texture = { path: 'basic.texture', rangeKey: 'texture' };
  map.sharp = { path: 'detail.sharpening', rangeKey: 'sharp' };
  map.noise = { path: 'detail.noiseReduction', rangeKey: 'noise' };
  map.crv_hi = { path: 'curves.parametric.highlights', rangeKey: null };
  map.crv_mid = { path: 'curves.parametric.midtones', rangeKey: null };
  map.crv_sh = { path: 'curves.parametric.shadows', rangeKey: null };

  for (const ch of HSL_CHANNEL_IDS) {
    map[`hsl_h_${ch}`] = { path: `hsl.hue.${ch}`, rangeKey: 'hsl_h' };
    map[`hsl_s_${ch}`] = { path: `hsl.saturation.${ch}`, rangeKey: 'hsl_s' };
    map[`hsl_l_${ch}`] = { path: `hsl.luminance.${ch}`, rangeKey: 'hsl_l' };
  }
  for (const zone of GRADING_ZONE_IDS) {
    const abbr = GRADE_ZONE_ABBR[zone];
    map[`grd_${abbr}_h`] = { path: `grading.${zone}.hue`, rangeKey: 'grd_h' };
    map[`grd_${abbr}_s`] = { path: `grading.${zone}.saturation`, rangeKey: 'grd_s' };
    map[`grd_${abbr}_l`] = { path: `grading.${zone}.luminance`, rangeKey: 'grd_l' };
  }
  map.grd_blend = { path: 'grading.blending', rangeKey: 'grd_blend' };

  for (const prim of ['red', 'green', 'blue']) {
    map[`cal_${prim}_h`] = { path: `cal.${prim}PrimaryHue`, rangeKey: 'cal_h' };
    map[`cal_${prim}_s`] = { path: `cal.${prim}PrimarySaturation`, rangeKey: 'cal_s' };
  }
  return map;
}

const SLIDER_PARAMETER_MAP = buildSliderParameterMap();

function _getByPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

/**
 * Render every supported Candidate value into its matching slider via
 * the injected `setSlider(id, value)`. A slider with no DOM element
 * present is simply skipped (never an error, never a Candidate
 * mutation) — matches "missing DOM control must not delete Candidate
 * value".
 */
export function renderCandidateToSliders(candidate, { setSlider }) {
  if (!candidate || typeof setSlider !== 'function') return { renderedCount: 0 };
  let renderedCount = 0;
  for (const [sliderId, { path }] of Object.entries(SLIDER_PARAMETER_MAP)) {
    const raw = _getByPath(candidate, path);
    if (raw === undefined || raw === null) continue;
    setSlider(sliderId, Math.round(raw));
    renderedCount += 1;
  }
  return { renderedCount };
}

/**
 * Translate ONE raw slider-edit event into a Candidate update
 * instruction: {parameterPath, clampedValue, wasClamped} — or null if
 * the slider ID isn't a known Candidate-backed parameter. Clamps to
 * the real DOM/UI range (candidate-validator.SLIDER_RANGES) — the same
 * range the slider's own `min`/`max` attributes already enforce, so
 * this can never push a value the UI itself wouldn't have allowed.
 */
export function resolveSliderEdit(sliderId, rawValue) {
  const entry = SLIDER_PARAMETER_MAP[sliderId];
  if (!entry) return null;
  const numeric = typeof rawValue === 'number' ? rawValue : parseInt(rawValue, 10);
  if (!Number.isFinite(numeric)) return null;
  const { value: clampedValue, clamped: wasClamped } = entry.rangeKey
    ? clampToSliderRange(entry.rangeKey, numeric)
    : { value: numeric, clamped: false };
  return { parameterPath: entry.path, clampedValue, wasClamped, sliderId };
}

/** All real slider IDs this adapter recognizes — used to attach listeners exactly once, over exactly the supported set. */
export function getSupportedSliderIds() {
  return Object.keys(SLIDER_PARAMETER_MAP);
}
