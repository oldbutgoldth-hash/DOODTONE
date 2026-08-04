/**
 * qa/fixtures/epic-2e-p1i/synthetic-pixel-fixtures.mjs
 *
 * EPIC 2E-P1I — deterministic synthetic pixel-buffer fixtures. Every
 * fixture returns a real `{data:Uint8ClampedArray, width, height}`
 * buffer (never a prefilled estimator output) built from a seeded,
 * pure PRNG (mulberry32) — same seed always produces the same buffer,
 * satisfying the "deterministic" requirement for reproducible tests.
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

/** Builds a {data,width,height} buffer from a per-pixel [r,g,b,a] callback. */
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

/** 1. Neutral gray scene — flat mid-gray with tiny deterministic dither. */
export function neutralGrayScene(seed = 1) {
  const rnd = mulberry32(seed);
  return build(W, H, () => { const n = (rnd() - 0.5) * 6; return [128 + n, 128 + n, 128 + n, 255]; });
}

/** 2. Uniform warm cast — R>G>B tungsten-like cast, textured (not flat, so it's not near-black/clip rejected). */
export function uniformWarmCastScene(seed = 2) {
  const rnd = mulberry32(seed);
  return build(W, H, () => { const n = (rnd() - 0.5) * 10; return [175 + n, 140 + n, 95 + n, 255]; });
}

/** 3. Uniform cool cast — B>G>R shade/blue-hour-like cast. */
export function uniformCoolCastScene(seed = 3) {
  const rnd = mulberry32(seed);
  return build(W, H, () => { const n = (rnd() - 0.5) * 10; return [95 + n, 130 + n, 175 + n, 255]; });
}

/** 4. Uniform green cast — fluorescent-like G>R,B. */
export function uniformGreenCastScene(seed = 4) {
  const rnd = mulberry32(seed);
  return build(W, H, () => { const n = (rnd() - 0.5) * 10; return [110 + n, 165 + n, 105 + n, 255]; });
}

/** 5. Green foliage dominant + a small genuinely neutral patch (top-left corner). */
export function greenFoliageWithNeutralPatchScene(seed = 5) {
  const rnd = mulberry32(seed);
  return build(W, H, (x, y) => {
    if (x < 34 && y < 34) { const n = (rnd() - 0.5) * 8; return [140 + n, 140 + n, 140 + n, 255]; }
    const n = (rnd() - 0.5) * 20;
    return [55 + n, 150 + n, 50 + n, 255];
  });
}

/** 6. Pink/red clothing dominant + a neutral wall region (right half). */
export function pinkClothingWithNeutralWallScene(seed = 6) {
  const rnd = mulberry32(seed);
  return build(W, H, (x, y) => {
    if (x > W * 0.55) { const n = (rnd() - 0.5) * 8; return [150 + n, 150 + n, 150 + n, 255]; }
    const n = (rnd() - 0.5) * 15;
    return [205 + n, 110 + n, 130 + n, 255];
  });
}

/** 7. Blue wall dominant + a neutral-toned "skin-like" patch (bottom band). */
export function blueWallWithSkinScene(seed = 7) {
  const rnd = mulberry32(seed);
  return build(W, H, (x, y) => {
    if (y > H * 0.7) { const n = (rnd() - 0.5) * 6; return [205 + n, 160 + n, 135 + n, 255]; } // classic skin-tone RGB band
    const n = (rnd() - 0.5) * 15;
    return [70 + n, 100 + n, 175 + n, 255];
  });
}

/** 8. Neutral white patch — a genuine bright, low-saturation highlight region with spatial support. */
export function neutralWhitePatchScene(seed = 8) {
  const rnd = mulberry32(seed);
  return build(W, H, (x, y) => {
    const inPatch = x > W * 0.3 && x < W * 0.7 && y > H * 0.2 && y < H * 0.5;
    if (inPatch) { const n = (rnd() - 0.5) * 6; return [225 + n, 223 + n, 220 + n, 255]; }
    const n = (rnd() - 0.5) * 20;
    return [120 + n, 110 + n, 100 + n, 255];
  });
}

/** 9. Clipped white patch — the bright region is fully at the 255 ceiling. */
export function clippedWhitePatchScene(seed = 9) {
  const rnd = mulberry32(seed);
  return build(W, H, (x, y) => {
    const inPatch = x > W * 0.3 && x < W * 0.7 && y > H * 0.2 && y < H * 0.5;
    if (inPatch) return [255, 255, 255, 255];
    const n = (rnd() - 0.5) * 20;
    return [120 + n, 110 + n, 100 + n, 255];
  });
}

/** 10. Colored stage highlight — the brightest region is a saturated magenta/blue light, not a white surface. */
export function coloredStageHighlightScene(seed = 10) {
  const rnd = mulberry32(seed);
  return build(W, H, (x, y) => {
    const inPatch = x > W * 0.3 && x < W * 0.7 && y > H * 0.2 && y < H * 0.5;
    if (inPatch) { const n = (rnd() - 0.5) * 6; return [230 + n, 60 + n, 210 + n, 255]; }
    const n = (rnd() - 0.5) * 15;
    return [90 + n, 85 + n, 95 + n, 255];
  });
}

/** 11. Mixed light — warm highlights (top band) + cool shadows (bottom band), simulating tungsten interior + window daylight. */
export function mixedWarmHighlightCoolShadowScene(seed = 11) {
  const rnd = mulberry32(seed);
  // Chroma deliberately tuned to stay just UNDER highlight/shadow-
  // illuminant-estimator.js's own SAT_CAP=0.25 (verified: highlight
  // sat~0.239, shadow sat~0.221) -- both bands must clear the
  // estimator's own saturation guard to produce a usable illuminant
  // reading at all, while still being far enough apart in temp/tint
  // (verified vectorDistance~13, axisMismatch true) to clear
  // compareIlluminants()'s mixed-light threshold (axisMismatch &&
  // distance >= MIXED_LIGHT_VECTOR_THRESHOLD*0.6=10.8). An earlier,
  // more strongly saturated version of this fixture (spread to
  // 220/175/110 and 45/55/80) was too saturated and both bands were
  // rejected HIGHLIGHTS_TOO_SATURATED before any comparison could run.
  return build(W, H, (x, y) => {
    // Recipe re-tuned a second time: candidate RGB triples were
    // verified in isolation via wb-color-math.js's real
    // rgbToHsl()/meanToNeutralGains()/gainsToTempTint() before being
    // committed here -- highlight (215,205,190): sat=0.238 (just
    // under the estimator's SAT_CAP=0.25), temp=-4, axis='cool';
    // shadow (53,65,85): sat=0.232, temp=13, axis='warm'. Both clear
    // SAT_CAP (usable, non-rejected readings) while axisMismatch is
    // true and the resulting vectorDistance (~17) clears
    // compareIlluminants()'s axisMismatch-corroborated mixed-light
    // threshold (MIXED_LIGHT_VECTOR_THRESHOLD*0.6=10.8). Luminance
    // ordering also verified: shadow(~64) < midtone(140) <
    // highlight(~206), so the shadow/highlight-illuminant
    // estimators' own percentile-based band selection (bottom/top
    // tercile by luminance) lines up with this fixture's y-position
    // bands as intended.
    if (y < H * 0.35) { const n = (rnd() - 0.5) * 6; return [215 + n, 205 + n, 190 + n, 255]; } // warm highlight band
    if (y > H * 0.65) { const n = (rnd() - 0.5) * 6; return [53 + n, 65 + n, 85 + n, 255]; } // cool shadow band
    const n = (rnd() - 0.5) * 10;
    return [140 + n, 140 + n, 140 + n, 255]; // neutral midtone band
  });
}

/** 12. Low-light noisy shadows — a mostly dark scene with heavy per-pixel luminance noise in the low band. */
export function lowLightNoisyShadowScene(seed = 12) {
  const rnd = mulberry32(seed);
  return build(W, H, () => {
    const base = 22;
    const noise = (rnd() - 0.5) * 34; // large relative to the low base luminance -> high noiseRatio
    return [base + noise, base + noise * 0.9, base + noise * 1.1, 255];
  });
}

/** 13. Skin-heavy portrait — most of the frame is a skin-tone band, small neutral background strip. */
export function skinHeavyPortraitScene(seed = 13) {
  const rnd = mulberry32(seed);
  return build(W, H, (x, y) => {
    if (x < W * 0.15) { const n = (rnd() - 0.5) * 8; return [150 + n, 150 + n, 150 + n, 255]; }
    const n = (rnd() - 0.5) * 10;
    return [215 + n, 170 + n, 145 + n, 255];
  });
}

/** 14. Sunset — strong warm gradient, intentional-looking mood rather than a technical defect. */
export function sunsetScene(seed = 14) {
  const rnd = mulberry32(seed);
  return build(W, H, (x, y) => {
    const t = y / H;
    const n = (rnd() - 0.5) * 8;
    return [230 - t * 40 + n, 140 - t * 30 + n, 90 - t * 40 + n, 255];
  });
}

/** 15. Low-confidence monochromatic scene — nearly a single hue everywhere, very little neutral/diverse evidence. */
export function lowConfidenceMonochromaticScene(seed = 15) {
  const rnd = mulberry32(seed);
  return build(W, H, () => { const n = (rnd() - 0.5) * 4; return [180 + n, 60 + n, 60 + n, 255]; });
}

/** Alpha-heavy transparent scene — most pixels fully transparent, small opaque region. */
export function alphaHeavyTransparentScene(seed = 16) {
  const rnd = mulberry32(seed);
  return build(W, H, (x, y) => {
    const opaque = x > W * 0.4 && x < W * 0.6 && y > H * 0.4 && y < H * 0.6;
    const n = (rnd() - 0.5) * 8;
    return [140 + n, 140 + n, 140 + n, opaque ? 255 : 20];
  });
}

/** Empty/degenerate buffer. */
export function emptyBuffer() {
  return { data: new Uint8ClampedArray(0), width: 0, height: 0 };
}

/** NaN/Infinity-poisoned buffer (test-only, not producible by a real canvas — proves defensive rejection). */
export function poisonedValueBuffer() {
  const w = 20, h = 20;
  const data = new Uint8ClampedArray(w * h * 4);
  data.fill(128);
  // Overwrite a region with NaN/Infinity via a plain Float64Array-backed
  // wrapper object (Uint8ClampedArray itself cannot store NaN — it
  // clamps to 0 — so this fixture uses a plain array to genuinely
  // exercise the hasInvalidChannel() guard with real non-finite values).
  const plain = Array.from(data);
  for (let i = 0; i < 40; i += 4) { plain[i] = NaN; plain[i + 1] = Infinity; plain[i + 2] = -Infinity; plain[i + 3] = 255; }
  return { data: plain, width: w, height: h };
}

/** Bright band where MOST pixels have exactly one channel clipped (R>=255) -- not fully clipped (sampler still accepts them), but White Patch's stricter any-channel-clipped guard should reject the whole highlight band. */
export function partiallyClippedHighlightScene(seed = 17) {
  const rnd = mulberry32(seed);
  return build(W, H, (x, y) => {
    const inPatch = x > W * 0.3 && x < W * 0.7 && y > H * 0.2 && y < H * 0.5;
    if (inPatch) { const n = (rnd() - 0.5) * 4; return [255, 248 + n, 235 + n, 255]; } // R permanently clipped, G/B nearly clipped but not fully-255-on-all-3
    const n = (rnd() - 0.5) * 20;
    return [120 + n, 110 + n, 100 + n, 255];
  });
}

/** Full luminance-range gradient (dark to bright, top to bottom) with a QUIET (low-noise) shadow band -- baseline for shadow-noise confidence comparison. */
export function gradientQuietShadowScene(seed = 18) {
  const rnd = mulberry32(seed);
  // Three FLAT luminance blocks (not a continuous gradient) so the
  // tercile-selected shadow band is uniform except for injected
  // per-pixel noise -- isolates the noise signal from any systematic
  // brightness trend within the band itself.
  return build(W, H, (x, y) => {
    const t = y / H;
    const isShadowBand = t < 0.34;
    const base = isShadowBand ? 55 : t < 0.67 ? 140 : 210;
    // Near-zero noise specifically in the shadow band (amplitude ~1) --
    // uniform-noise stddev/range is scale-INVARIANT (~0.289) once the
    // amplitude clears a small threshold, so "quiet" must be near-flat,
    // not just "less noisy," to produce a measurably different
    // noiseRatio from gradientNoisyShadowScene() below.
    const n = (rnd() - 0.5) * (isShadowBand ? 1 : 4);
    return [base + n, base + n, base + n, 255];
  });
}

/** Same luminance gradient, but the SHADOW (bottom-tercile) band carries heavy per-pixel noise -- for shadow-noise confidence comparison against gradientQuietShadowScene(). */
export function gradientNoisyShadowScene(seed = 19) {
  const rnd = mulberry32(seed);
  // Identical three-block structure to gradientQuietShadowScene() --
  // the ONLY difference is heavy per-pixel noise within the shadow
  // (bottom) block, isolating shadow-noise as the single variable.
  return build(W, H, (x, y) => {
    const t = y / H;
    const isShadowBand = t < 0.34;
    const base = isShadowBand ? 55 : t < 0.67 ? 140 : 210;
    const n = (rnd() - 0.5) * (isShadowBand ? 40 : 4);
    return [base + n, base + n, base + n, 255];
  });
}

/** Full luminance-range gradient with a PARTIALLY clipped highlight band (elevated clip rate, not total) -- for highlight-clipping confidence comparison against a clean-highlight gradient. */
export function gradientPartiallyClippedHighlightScene(seed = 20) {
  const rnd = mulberry32(seed);
  return build(W, H, (x, y) => {
    const t = y / H; // t=1 (y=H) is BRIGHTEST (highlight band)
    const isHighlightBand = t > 0.8;
    // ~60% of the highlight band has exactly one channel pinned at the
    // 255 ceiling (R only) -- NOT fully clipped on all 3 channels, so
    // the pixel sampler's own isFullyClipped() upstream filter still
    // ACCEPTS these pixels (matching a real sensor's single-channel
    // clip behaviour); the highlight estimator's stricter
    // isAnyChannelClipped() check is what must reject them.
    if (isHighlightBand && rnd() < 0.6) { const n = (rnd() - 0.5) * 4; return [255, 235 + n, 225 + n, 255]; }
    const base = 30 + t * 170;
    const n = (rnd() - 0.5) * 6;
    return [base + n, base + n, base + n, 255];
  });
}

/** Same luminance-range gradient with a CLEAN (non-clipped) highlight band -- baseline for the comparison above. */
export function gradientCleanHighlightScene(seed = 21) {
  const rnd = mulberry32(seed);
  return build(W, H, (x, y) => {
    const t = y / H;
    const base = 30 + t * 170; // caps below 255
    const n = (rnd() - 0.5) * 6;
    return [base + n, base + n, base + n, 255];
  });
}

export const FIXTURES = {
  NEUTRAL_GRAY: neutralGrayScene,
  UNIFORM_WARM: uniformWarmCastScene,
  UNIFORM_COOL: uniformCoolCastScene,
  UNIFORM_GREEN: uniformGreenCastScene,
  GREEN_FOLIAGE_NEUTRAL_PATCH: greenFoliageWithNeutralPatchScene,
  PINK_CLOTHING_NEUTRAL_WALL: pinkClothingWithNeutralWallScene,
  BLUE_WALL_SKIN: blueWallWithSkinScene,
  NEUTRAL_WHITE_PATCH: neutralWhitePatchScene,
  CLIPPED_WHITE_PATCH: clippedWhitePatchScene,
  COLORED_STAGE_HIGHLIGHT: coloredStageHighlightScene,
  MIXED_WARM_HL_COOL_SHADOW: mixedWarmHighlightCoolShadowScene,
  LOW_LIGHT_NOISY_SHADOW: lowLightNoisyShadowScene,
  SKIN_HEAVY_PORTRAIT: skinHeavyPortraitScene,
  SUNSET: sunsetScene,
  LOW_CONFIDENCE_MONOCHROME: lowConfidenceMonochromaticScene,
  ALPHA_HEAVY_TRANSPARENT: alphaHeavyTransparentScene,
  EMPTY: emptyBuffer,
  POISONED: poisonedValueBuffer,
  PARTIALLY_CLIPPED_HIGHLIGHT: partiallyClippedHighlightScene,
  GRADIENT_QUIET_SHADOW: gradientQuietShadowScene,
  GRADIENT_NOISY_SHADOW: gradientNoisyShadowScene,
  GRADIENT_PARTIAL_CLIP_HIGHLIGHT: gradientPartiallyClippedHighlightScene,
  GRADIENT_CLEAN_HIGHLIGHT: gradientCleanHighlightScene,
};
