/**
 * ═══════════════════════════════════════════════════════════════════════════
 * REFERENCE COLOR MATCH — XMP Generator (EPIC 1.2)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Deliberately does NOT write a new XMP serializer. core/preset-engine's
 * serializeXMP()/downloadXMP() already produce the exact Lightroom-
 * compatible .xmp this EPIC's "XMP Preset Generator" requirement describes
 * (Temperature, Tint, Exposure, Contrast, Highlights, Shadows, Whites,
 * Blacks, Texture, Clarity, Dehaze, Vibrance, Saturation, Tone Curve,
 * HSL/Colour Mixer, Colour Grading Shadows/Midtones/Highlights — every
 * field the spec lists is already handled by that module). Likewise,
 * core/xmp-validator's quickSafetyClamp() is reused as the final safety
 * pass, exactly as the main analyse→map→validate pipeline already does —
 * this keeps the "more than one safety net" pattern from
 * docs/project/01_PROJECT_VISION.md consistent across BOTH XMP-producing
 * paths in the app, rather than inventing a second, divergent one here.
 *
 * This module's only real job is adapting a Reference Color Match profile
 * (from color-transfer-engine.js, optionally eased by preserve-engine.js)
 * into the flat preset-engine object shape.
 */
import { serializeXMP, downloadXMP } from '../preset-engine/index.js';
import { quickSafetyClamp } from '../xmp-validator/index.js';

const HSL_CHANNELS = ['red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'magenta'];

// Neutral, safe Tone Curve anchor defaults — the colour-transfer profile
// does not compute its own curve shape (it works in Basic Panel /
// Colour Grading / HSL space only), so these match core/xmp-validator's
// own HARD_LIMITS.curve neutral midpoints rather than inventing new ones.
const NEUTRAL_CURVE_ANCHORS = { crv_sh: 5, crv_mid: 128, crv_hi: 248 };

/**
 * Converts a Reference Color Match profile into the flat preset object
 * shape core/preset-engine's serializeXMP() expects.
 * @param {object} profile - from buildColorTransferProfile(), optionally passed through applyPreservation()
 * @returns {object} preset-engine-shaped preset object
 */
export function buildReferenceMatchPreset(profile) {
  const hsl = {};
  for (const ch of HSL_CHANNELS) {
    const shift = profile.hsl[ch] ?? { h: 0, s: 0, l: 0 };
    hsl[`hsl_h_${ch}`] = shift.h; hsl[`hsl_s_${ch}`] = shift.s; hsl[`hsl_l_${ch}`] = shift.l;
  }

  return {
    exp: profile.tone.exposure, con: profile.tone.contrast,
    hi: profile.tone.highlights, sh: profile.tone.shadows,
    wh: profile.tone.whites, bl: profile.tone.blacks,
    clarity: profile.detail.clarity, dehaze: profile.detail.dehaze, texture: profile.detail.texture,
    temp: profile.wb.temp, tint: profile.wb.tint,
    vib: profile.presence.vibrance, sat: profile.presence.saturation,
    sharp: 0, noise: 0, // Reference Color Match does not analyse sharpening/noise — left neutral
    ...NEUTRAL_CURVE_ANCHORS,
    hsl,
    grade: {
      grd_sh_h: profile.grade.shadowHue, grd_sh_s: profile.grade.shadowSat, grd_sh_l: 0,
      grd_mid_h: profile.grade.midtoneHue, grd_mid_s: profile.grade.midtoneSat, grd_mid_l: 0,
      grd_hi_h: profile.grade.highlightHue, grd_hi_s: profile.grade.highlightSat, grd_hi_l: 0,
      grd_blend: profile.grade.blending,
    },
    cal: { cal_red_h: 0, cal_red_s: 0, cal_green_h: 0, cal_green_s: 0, cal_blue_h: 0, cal_blue_s: 0 }, // Reference Color Match does not touch Calibration
  };
}

/**
 * Builds the preset, runs it through the SAME Pre-XMP safety clamp the
 * main pipeline uses, serializes it, and triggers a browser download —
 * mirroring ui/app.js's own export flow so the two XMP-producing paths in
 * the app stay consistent.
 * @param {object} profile - from buildColorTransferProfile()/applyPreservation()
 * @param {string} fileName - without extension
 * @returns {{ xmp: string, preset: object, safetyAdjustments: string[] }}
 */
export function generateReferenceMatchXMP(profile, fileName = 'LUMIXA-Reference-Match') {
  const rawPreset = buildReferenceMatchPreset(profile);
  const { preset: safePreset, adjustments } = quickSafetyClamp(rawPreset); // reuse existing hard-ceiling safety net
  const xmp = serializeXMP(safePreset); // reuse existing serializer — no new XMP-writing logic
  return { xmp, preset: safePreset, safetyAdjustments: adjustments };
}

/** Convenience: generate + immediately trigger the browser download, exactly like the main pipeline's export button. */
export function downloadReferenceMatchXMP(profile, fileName = 'LUMIXA-Reference-Match') {
  const { xmp, safetyAdjustments } = generateReferenceMatchXMP(profile, fileName);
  downloadXMP(xmp, fileName); // reuse existing download trigger — no new Blob/anchor logic
  return { xmp, safetyAdjustments };
}
