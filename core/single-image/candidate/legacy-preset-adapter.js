/**
 * EPIC 2E-P1C — Legacy Preset Adapter
 *
 * Converts the canonical, nested Candidate into the EXACT flat preset
 * shape the existing, unmodified `core/preset-engine`'s `serializeXMP`
 * and `core/xmp-validator`'s `quickSafetyClamp` already expect (the
 * same shape `readSlidersAsPreset()`/`buildFinalPreset()` have always
 * produced — see P1C_CANDIDATE_SOURCE_LINEAGE_AUDIT.md §7). This is
 * the ONLY place P1C reshapes data for export; the serializer itself
 * is never touched.
 */

import { HSL_CHANNEL_IDS, GRADING_ZONE_IDS } from './candidate-schema.js';

const GRADE_ZONE_ABBR = { shadows: 'sh', midtones: 'mid', highlights: 'hi' };

/**
 * @param {object} candidate  canonical Candidate (from candidate-store.getValidatedCandidate())
 * @returns {object} flat preset object — identical shape to buildFinalPreset()'s output
 */
export function candidateToLegacyPreset(candidate) {
  const hsl = {};
  for (const ch of HSL_CHANNEL_IDS) {
    hsl[`hsl_h_${ch}`] = candidate.hsl.hue[ch] ?? 0;
    hsl[`hsl_s_${ch}`] = candidate.hsl.saturation[ch] ?? 0;
    hsl[`hsl_l_${ch}`] = candidate.hsl.luminance[ch] ?? 0;
  }

  const grade = {};
  for (const zone of GRADING_ZONE_IDS) {
    const abbr = GRADE_ZONE_ABBR[zone];
    grade[`grd_${abbr}_h`] = candidate.grading[zone]?.hue ?? 0;
    grade[`grd_${abbr}_s`] = candidate.grading[zone]?.saturation ?? 0;
    grade[`grd_${abbr}_l`] = candidate.grading[zone]?.luminance ?? 0;
  }
  grade.grd_blend = candidate.grading.blending ?? 50;

  const cal = {
    cal_red_h: candidate.cal.redPrimaryHue ?? 0, cal_red_s: candidate.cal.redPrimarySaturation ?? 0,
    cal_green_h: candidate.cal.greenPrimaryHue ?? 0, cal_green_s: candidate.cal.greenPrimarySaturation ?? 0,
    cal_blue_h: candidate.cal.bluePrimaryHue ?? 0, cal_blue_s: candidate.cal.bluePrimarySaturation ?? 0,
  };

  return {
    name: candidate.profile?.name ?? 'AI Preset',
    exp: candidate.basic.exposure ?? 0, con: candidate.basic.contrast ?? 0,
    hi: candidate.basic.highlights ?? 0, sh: candidate.basic.shadows ?? 0,
    wh: candidate.basic.whites ?? 0, bl: candidate.basic.blacks ?? 0,
    clarity: candidate.basic.clarity ?? 0, dehaze: candidate.basic.dehaze ?? 0, texture: candidate.basic.texture ?? 0,
    temp: candidate.whiteBalance.temperature ?? 0, tint: candidate.whiteBalance.tint ?? 0,
    vib: candidate.basic.vibrance ?? 0, sat: candidate.basic.saturation ?? 0,
    sharp: candidate.detail.sharpening ?? 0, noise: candidate.detail.noiseReduction ?? 0,
    crv_hi: candidate.curves.parametric.highlights ?? 0,
    crv_mid: candidate.curves.parametric.midtones ?? 0,
    crv_sh: candidate.curves.parametric.shadows ?? 0,
    hsl, grade, cal,
    // EPIC 2E-P1C R3: only emit a `curves` object when real point-curve
    // data exists (candidate.curves.rgb is the master channel every
    // other channel falls back to). Previously this always built a
    // {master:null, red:null, green:null, blue:null} SHELL object even
    // when no curve editor data existed -- that shell is truthy, so
    // core/preset-engine/index.js's own `p.curves ?? defaultCurveSet()`
    // fallback (unchanged, still in the untouched serializer) never
    // triggered, and serializeCurvePoints(null) then threw inside
    // serializeXMP() on every export with no curve data -- the actual,
    // always-reproducible root cause of "Download XMP does nothing."
    // Setting the whole field to `null` here (not a shell of nulls)
    // restores the exact pre-P1C readSlidersAsPreset() contract
    // (`curves: state.curveEditor ? state.curveEditor.getCurveSet() : null`)
    // that the serializer's fallback was always written to expect. See
    // P1C_R3_USER_EDIT_EXPORT_FIX.md.
    curves: candidate.curves?.rgb != null
      ? {
          master: candidate.curves.rgb,
          red: candidate.curves.red ?? null,
          green: candidate.curves.green ?? null,
          blue: candidate.curves.blue ?? null,
        }
      : null,
  };
}
