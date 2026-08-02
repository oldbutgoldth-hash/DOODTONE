/**
 * EPIC 2E-P1D — XMP Property Map
 *
 * The single source of truth mapping a canonical Candidate path to the
 * flat legacy-preset key `core/single-image/candidate/legacy-preset-
 * adapter.js` produces, and to the REAL `crs:` attribute name
 * `core/preset-engine/index.js::serializeXMP` actually emits for it.
 * Built strictly from P1D_XMP_SERIALIZATION_AUDIT.md -- every entry
 * below was verified against the real serializer source, not assumed
 * from Adobe's public XMP schema.
 *
 * Comparison modes:
 *   EXACT_INT        integer Lightroom slider value, compared exactly
 *   EXPOSURE_EV       crs:Exposure2012 = (exp/100).toFixed(2); actual is
 *                      parsed back with `Math.round(parseFloat(s) * 100)`
 *                      and compared with a small float tolerance
 *   TEMPERATURE_KELVIN  crs:Temperature = sliderToKelvin(temp); actual is
 *                      parsed back with `kelvinToSlider(parseInt(s,10))`
 *                      and compared exactly (round-trip verified exact
 *                      for every integer slider value -100..100)
 *   CURVE_ARRAY        handled separately by CURVE_PROPERTIES, not this list
 */

import { HSL_CHANNEL_IDS, GRADING_ZONE_IDS } from '../candidate/candidate-schema.js';

const GRADE_ZONE_ABBR = { shadows: 'sh', midtones: 'mid', highlights: 'hi' };
const GRADE_ZONE_XMP  = { shadows: 'Shadow', midtones: 'Midtone', highlights: 'Highlight' };

function _cap(ch) { return ch.charAt(0).toUpperCase() + ch.slice(1); }

// ── Basic Panel + WB + Presence + Detail + Parametric Curve (18) ──────────
const BASIC_ENTRIES = [
  { candidatePath: 'basic.exposure',   legacyPresetKey: 'exp',     xmpProperty: 'crs:Exposure2012',      compareMode: 'EXPOSURE_EV',       clampGroup: 'basic', required: true },
  { candidatePath: 'basic.contrast',   legacyPresetKey: 'con',     xmpProperty: 'crs:Contrast2012',      compareMode: 'EXACT_INT',         clampGroup: 'basic', required: true },
  { candidatePath: 'basic.highlights', legacyPresetKey: 'hi',      xmpProperty: 'crs:Highlights2012',    compareMode: 'EXACT_INT',         clampGroup: 'basic', required: true },
  { candidatePath: 'basic.shadows',    legacyPresetKey: 'sh',      xmpProperty: 'crs:Shadows2012',       compareMode: 'EXACT_INT',         clampGroup: 'basic', required: true },
  { candidatePath: 'basic.whites',     legacyPresetKey: 'wh',      xmpProperty: 'crs:Whites2012',        compareMode: 'EXACT_INT',         clampGroup: 'basic', required: true },
  { candidatePath: 'basic.blacks',     legacyPresetKey: 'bl',      xmpProperty: 'crs:Blacks2012',        compareMode: 'EXACT_INT',         clampGroup: 'basic', required: true },
  { candidatePath: 'basic.clarity',    legacyPresetKey: 'clarity', xmpProperty: 'crs:Clarity2012',       compareMode: 'EXACT_INT',         clampGroup: null,    required: true },
  { candidatePath: 'basic.dehaze',     legacyPresetKey: 'dehaze',  xmpProperty: 'crs:Dehaze',            compareMode: 'EXACT_INT',         clampGroup: null,    required: true },
  { candidatePath: 'basic.texture',    legacyPresetKey: 'texture', xmpProperty: 'crs:Texture',           compareMode: 'EXACT_INT',         clampGroup: null,    required: true },
  { candidatePath: 'curves.parametric.shadows',    legacyPresetKey: 'crv_sh',  xmpProperty: 'crs:ParametricShadows',    compareMode: 'EXACT_INT', clampGroup: null, required: true },
  { candidatePath: 'curves.parametric.midtones',   legacyPresetKey: 'crv_mid', xmpProperty: 'crs:ParametricMidtones',   compareMode: 'EXACT_INT', clampGroup: null, required: true },
  { candidatePath: 'curves.parametric.highlights', legacyPresetKey: 'crv_hi',  xmpProperty: 'crs:ParametricHighlights', compareMode: 'EXACT_INT', clampGroup: null, required: true },
  { candidatePath: 'detail.sharpening',     legacyPresetKey: 'sharp', xmpProperty: 'crs:Sharpness',          compareMode: 'EXACT_INT', clampGroup: null, required: true },
  { candidatePath: 'detail.noiseReduction', legacyPresetKey: 'noise', xmpProperty: 'crs:LuminanceSmoothing', compareMode: 'EXACT_INT', clampGroup: null, required: true },
  { candidatePath: 'whiteBalance.temperature', legacyPresetKey: 'temp', xmpProperty: 'crs:Temperature', compareMode: 'TEMPERATURE_KELVIN', clampGroup: 'wb', required: true },
  { candidatePath: 'whiteBalance.tint',        legacyPresetKey: 'tint', xmpProperty: 'crs:Tint',        compareMode: 'EXACT_INT',           clampGroup: 'wb', required: true },
  { candidatePath: 'basic.vibrance',   legacyPresetKey: 'vib', xmpProperty: 'crs:Vibrance',   compareMode: 'EXACT_INT', clampGroup: 'presence', required: true },
  { candidatePath: 'basic.saturation', legacyPresetKey: 'sat', xmpProperty: 'crs:Saturation', compareMode: 'EXACT_INT', clampGroup: 'presence', required: true },
];

// ── Color Grading: 3 zones x (hue, saturation, luminance) + blend (10) ────
const GRADING_ENTRIES = [];
for (const zone of GRADING_ZONE_IDS) {
  const abbr = GRADE_ZONE_ABBR[zone];
  const xmpZone = GRADE_ZONE_XMP[zone];
  for (const [field, suffix] of [['hue', 'Hue'], ['saturation', 'Sat'], ['luminance', 'Lum']]) {
    GRADING_ENTRIES.push({
      candidatePath: `grading.${zone}.${field}`,
      legacyPresetKey: `grade.grd_${abbr}_${field === 'hue' ? 'h' : field === 'saturation' ? 's' : 'l'}`,
      xmpProperty: `crs:ColorGrade${xmpZone}${suffix}`,
      compareMode: 'EXACT_INT', clampGroup: null, required: true,
    });
  }
}
GRADING_ENTRIES.push({ candidatePath: 'grading.blending', legacyPresetKey: 'grade.grd_blend', xmpProperty: 'crs:ColorGradeBlending', compareMode: 'EXACT_INT', clampGroup: null, required: true });

// ── Calibration: 3 primaries x (hue, saturation) (6) ───────────────────────
const CAL_ENTRIES = [];
for (const prim of ['red', 'green', 'blue']) {
  const cap = _cap(prim);
  CAL_ENTRIES.push({ candidatePath: `cal.${prim}PrimaryHue`,        legacyPresetKey: `cal.cal_${prim}_h`, xmpProperty: `crs:${cap}Hue`,        compareMode: 'EXACT_INT', clampGroup: null,           required: true });
  CAL_ENTRIES.push({ candidatePath: `cal.${prim}PrimarySaturation`, legacyPresetKey: `cal.cal_${prim}_s`, xmpProperty: `crs:${cap}Saturation`, compareMode: 'EXACT_INT', clampGroup: 'calibration', required: true });
}

// ── HSL: 8 channels x (hue, saturation, luminance) (24) ─────────────────────
const HSL_ENTRIES = [];
for (const ch of HSL_CHANNEL_IDS) {
  const cap = _cap(ch);
  HSL_ENTRIES.push({ candidatePath: `hsl.hue.${ch}`,        legacyPresetKey: `hsl.hsl_h_${ch}`, xmpProperty: `crs:HueAdjustment${cap}`,        compareMode: 'EXACT_INT', clampGroup: null,  required: true });
  HSL_ENTRIES.push({ candidatePath: `hsl.saturation.${ch}`, legacyPresetKey: `hsl.hsl_s_${ch}`, xmpProperty: `crs:SaturationAdjustment${cap}`, compareMode: 'EXACT_INT', clampGroup: 'hsl', required: true });
  HSL_ENTRIES.push({ candidatePath: `hsl.luminance.${ch}`,  legacyPresetKey: `hsl.hsl_l_${ch}`, xmpProperty: `crs:LuminanceAdjustment${cap}`,  compareMode: 'EXACT_INT', clampGroup: null,  required: true });
}

export const PROPERTY_MAP = Object.freeze([
  ...BASIC_ENTRIES, ...GRADING_ENTRIES, ...CAL_ENTRIES, ...HSL_ENTRIES,
]);

// ── Tone Curves: array-typed, compared separately from the scalar map ──────
export const CURVE_PROPERTIES = Object.freeze([
  { curveChannel: 'master', candidatePath: 'curves.rgb',   legacyPresetKey: 'master', xmpProperty: 'crs:ToneCurvePV2012',      required: true },
  { curveChannel: 'red',    candidatePath: 'curves.red',   legacyPresetKey: 'red',    xmpProperty: 'crs:ToneCurvePV2012Red',   required: true },
  { curveChannel: 'green',  candidatePath: 'curves.green', legacyPresetKey: 'green',  xmpProperty: 'crs:ToneCurvePV2012Green', required: true },
  { curveChannel: 'blue',   candidatePath: 'curves.blue',  legacyPresetKey: 'blue',   xmpProperty: 'crs:ToneCurvePV2012Blue',  required: true },
]);

// ── Fixed literal attributes -- never derived from the Candidate. Read
// back for informational/structural presence checks only; comparator
// must never treat these as a Candidate-vs-XMP mismatch source. ──────────
export const XMP_FIXED_ATTRIBUTES = Object.freeze({
  'crs:ProcessVersion': '11.0',
  'crs:PresetType': 'Normal',
  'crs:SupportsAmount': 'False',
  'crs:SupportsColor': 'True',
  'crs:SupportsMonochrome': 'False',
  'crs:SupportsHighDynamicRange': 'True',
  'crs:SupportsNormalDynamicRange': 'True',
  'crs:SupportsSceneReferred': 'True',
  'crs:SupportsOutputReferred': 'True',
  'crs:CameraModelRestriction': '',
  'crs:Copyright': '',
  'crs:ColorNoiseReduction': '25',
  'crs:WhiteBalance': 'Custom',
});

// ── Candidate fields the real serializer never emits at all -- always
// UNSUPPORTED, never a fidelity failure unless a documented promise
// says otherwise (none currently does). See audit §4. ─────────────────────
export const UNSUPPORTED_CANDIDATE_PATHS = Object.freeze([
  'detail.colorNoiseReduction', 'detail.radius', 'detail.detail', 'detail.masking',
  'detail.noiseReductionDetail', 'detail.colorNoiseReductionDetail', 'detail.colorNoiseReductionSmoothness',
  'profile.name', 'profile.treatment', 'profile.processVersion',
  'grading.balance', 'cal.shadowTint',
  'effects.postCropVignetteAmount', 'effects.postCropVignetteMidpoint', 'effects.postCropVignetteRoundness', 'effects.postCropVignetteFeather',
  'effects.grainAmount', 'effects.grainSize', 'effects.grainFrequency',
  'optics.removeChromaticAberration', 'optics.enableProfileCorrections', 'optics.distortion', 'optics.vignette',
]);

export function getPropertyMapEntry(candidatePath) {
  return PROPERTY_MAP.find((e) => e.candidatePath === candidatePath) ?? null;
}

export function getAllRequiredXmpProperties() {
  return [...PROPERTY_MAP.filter((e) => e.required).map((e) => e.xmpProperty), ...CURVE_PROPERTIES.map((e) => e.xmpProperty)];
}
