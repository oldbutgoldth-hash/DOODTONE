/**
 * qa/fixtures/epic-2e-p1i/skin-validation-fixtures-r2.mjs
 *
 * EPIC 2E-P1I R2 -- Pixel Skin Validation and WB Correction Plausibility.
 * Deterministic synthetic pixel-buffer fixtures, same seeded-PRNG /
 * build() pattern as synthetic-pixel-fixtures.mjs (kept in a SEPARATE
 * file so the R1 fixtures file is never touched by this round -- see
 * P1I_R2_MODIFIED_FILES section in the docs).
 *
 * Every RGB base value below was chosen by live calibration against
 * the REAL isLikelySkinPixelYCbCr()/saturationOf()/luminance()
 * functions (see P1I_R2_PIXEL_SKIN_VALIDATION_MODEL.md Calibration
 * section) -- not guessed.
 */

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clampByte(v) { return Math.max(0, Math.min(255, Math.round(v))); }

function build(width, height, fn) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = fn(x, y);
      const o = (y * width + x) * 4;
      data[o] = clampByte(r); data[o + 1] = clampByte(g); data[o + 2] = clampByte(b); data[o + 3] = clampByte(a);
    }
  }
  return { data, width, height };
}

const W = 220, H = 160;

/** 1. Natural, unclipped, well-lit skin patch (bottom 45% band) over a neutral gray rest-of-frame. Calibrated: sat~0.5, unclipped, Y~150-190. */
export function naturalUnclippedSkinScene(seed = 201) {
  const rnd = mulberry32(seed);
  return build(W, H, (x, y) => {
    if (y > H * 0.55) { const n = (rnd() - 0.5) * 8; return [190 + n, 140 + n, 110 + n, 255]; }
    const n = (rnd() - 0.5) * 6; return [130 + n, 130 + n, 130 + n, 255];
  });
}

/** 2. Same layout, but the skin band has one channel pinned at the 255 clip ceiling -- calibrated in-band, isLikelySkinPixelYCbCr=true, isAnyChannelClipped=true. */
export function clippedSkinPatchScene(seed = 202) {
  const rnd = mulberry32(seed);
  return build(W, H, (x, y) => {
    if (y > H * 0.55) { const n = (rnd() - 0.5) * 4; return [255, 200 + n, 175 + n, 255]; }
    const n = (rnd() - 0.5) * 6; return [130 + n, 130 + n, 130 + n, 255];
  });
}

/** 3. Red/orange stage-light-on-skin -- calibrated to be the maximum-saturation point (sat=0.916) that STILL passes isLikelySkinPixelYCbCr unclipped, i.e. the dedicated saturation-rejection path (not the classifier itself) must reject it. */
export function redStageLightSkinScene(seed = 203) {
  const rnd = mulberry32(seed);
  return build(W, H, (x, y) => {
    if (y > H * 0.55) { const n = (rnd() - 0.5) * 3; return [248 + n, 172 + n, 96 + n, 255]; }
    const n = (rnd() - 0.5) * 6; return [130 + n, 130 + n, 130 + n, 255];
  });
}

/** 4. Magenta stage-light-on-skin -- calibrated: NO RGB triple in the magenta hue range passes isLikelySkinPixelYCbCr at all (Cb pushed above the band's 127 ceiling), so this is rejected at the classification stage itself -- an even earlier/stronger rejection than the saturation path. See P1I_R2_PIXEL_SKIN_VALIDATION_MODEL.md for the documented calibration search that established this. */
export function magentaStageLightSkinScene(seed = 204) {
  const rnd = mulberry32(seed);
  return build(W, H, (x, y) => {
    if (y > H * 0.55) { const n = (rnd() - 0.5) * 3; return [200 + n, 60 + n, 180 + n, 255]; }
    const n = (rnd() - 0.5) * 6; return [130 + n, 130 + n, 130 + n, 255];
  });
}

/** 5. Deep-shadow skin -- calibrated to Y~85 (inside the classifier's own Y>80 floor, but below skin-sample-validator.js's stricter SKIN_SHADOW_LUM_MIN=95), so this specifically exercises the rejectedLowLuminance path rather than NO_SKIN_DETECTED. */
export function shadowSkinScene(seed = 205) {
  const rnd = mulberry32(seed);
  return build(W, H, (x, y) => {
    if (y > H * 0.55) { const n = (rnd() - 0.5) * 3; return [95 + n, 85 + n, 60 + n, 255]; }
    const n = (rnd() - 0.5) * 6; return [130 + n, 130 + n, 130 + n, 255];
  });
}

/** 6. Cool-shifted (off-center-but-still-in-band) skin -- base natural skin pushed 20 units cooler (R-20,B+20). Calibrated: a moderate warming correction (temp +5..+10) measurably IMPROVES its skin-band plausibility score; overcorrecting (temp +15) pushes it back out. */
export function coolShiftedSkinScene(seed = 206, shift = 20) {
  const rnd = mulberry32(seed);
  return build(W, H, (x, y) => {
    if (y > H * 0.55) { const n = (rnd() - 0.5) * 8; return [190 - shift + n, 140 + n, 110 + shift + n, 255]; }
    const n = (rnd() - 0.5) * 6; return [130 + n, 130 + n, 130 + n, 255];
  });
}

/** 7. Tiny skin patch (12x12px corner) -- at the sampler's default stride=2, this yields well under skin-sample-validator.js's MIN_SKIN_SAMPLE_COUNT=40 accepted skin pixels. */
export function tinySkinPatchScene(seed = 207) {
  const rnd = mulberry32(seed);
  return build(W, H, (x, y) => {
    if (x < 12 && y < 12) { const n = (rnd() - 0.5) * 4; return [190 + n, 140 + n, 110 + n, 255]; }
    const n = (rnd() - 0.5) * 6; return [130 + n, 130 + n, 130 + n, 255];
  });
}

/** 8. Compact 12x12 skin blob (same as fixture 7) -- sampled at a DENSER stride in the test itself (stride:1) to get acceptedSkinPixels comfortably above MIN_SKIN_SAMPLE_COUNT while its bounding-box area stays under MIN_SKIN_SPATIAL_COVERAGE*frameArea -- isolates the spatial-coverage rejection path from the sample-count path. */
export function compactSkinBlobScene(seed = 208) {
  const rnd = mulberry32(seed);
  return build(W, H, (x, y) => {
    if (x < 12 && y < 12) { const n = (rnd() - 0.5) * 4; return [190 + n, 140 + n, 110 + n, 255]; }
    const n = (rnd() - 0.5) * 6; return [130 + n, 130 + n, 130 + n, 255];
  });
}

/** 9. Green foliage ONLY, no real skin anywhere -- confirms foliage never becomes skin candidate evidence (isLikelySkinPixelYCbCr excludes it at the classifier stage). */
export function greenFoliageOnlyScene(seed = 209) {
  const rnd = mulberry32(seed);
  return build(W, H, () => { const n = (rnd() - 0.5) * 20; return [55 + n, 150 + n, 50 + n, 255]; });
}

/** 10. Pink costume ONLY, no real skin anywhere -- confirms costume fabric never becomes skin candidate evidence. */
export function pinkCostumeOnlyScene(seed = 210) {
  const rnd = mulberry32(seed);
  return build(W, H, () => { const n = (rnd() - 0.5) * 15; return [205 + n, 110 + n, 130 + n, 255]; });
}

/** 11. Pink costume covering most of the frame + a genuine, smaller natural skin patch (bottom band) -- confirms the costume pixels do not dilute/dominate the skin evidence extracted from the real skin region. */
export function pinkCostumeWithRealSkinScene(seed = 211) {
  const rnd = mulberry32(seed);
  return build(W, H, (x, y) => {
    if (y > H * 0.75) { const n = (rnd() - 0.5) * 8; return [190 + n, 140 + n, 110 + n, 255]; }
    const n = (rnd() - 0.5) * 15; return [205 + n, 110 + n, 130 + n, 255];
  });
}

export const SKIN_FIXTURES_R2 = {
  NATURAL_UNCLIPPED_SKIN: naturalUnclippedSkinScene,
  CLIPPED_SKIN: clippedSkinPatchScene,
  RED_STAGE_LIGHT_SKIN: redStageLightSkinScene,
  MAGENTA_STAGE_LIGHT_SKIN: magentaStageLightSkinScene,
  SHADOW_SKIN: shadowSkinScene,
  COOL_SHIFTED_SKIN: coolShiftedSkinScene,
  TINY_SKIN_PATCH: tinySkinPatchScene,
  COMPACT_SKIN_BLOB: compactSkinBlobScene,
  GREEN_FOLIAGE_ONLY: greenFoliageOnlyScene,
  PINK_COSTUME_ONLY: pinkCostumeOnlyScene,
  PINK_COSTUME_WITH_REAL_SKIN: pinkCostumeWithRealSkinScene,
};
