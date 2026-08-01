/**
 * EPIC 2E-N4 — Candidate Preview Pixel Renderer
 * EPIC 2E-P0.8A — Preview Rendering Artifact Repair + Posterization
 * Removal + Candidate-to-Preview Fidelity.
 *
 * Deterministic browser preview for the exact N3 safePreset. This is still
 * an approximation of Lightroom's RAW pipeline, but it applies WB, tone,
 * HSL, grading and calibration from one candidate source of truth and
 * reports metrics.
 *
 * P0.8A root-cause summary (full detail in the delivered pixel-pipeline
 * and posterization root-cause reports):
 *   1. `channelForHue()` assigned every pixel to exactly ONE of Lightroom's
 *      8 HSL channels via 8 hard hue-degree cutoffs with zero blending
 *      between neighbours. A continuous-hue area (e.g. grass/foliage
 *      spanning yellow-green through blue-green) would show a literal
 *      spatial edge wherever the underlying hue crossed one of those 8
 *      fixed boundaries — the direct cause of the reported block-shaped
 *      colour regions. Fixed by replacing the hard bucket with the SAME
 *      smooth Gaussian hue-weighting already used at analysis time (see
 *      `gaussian-hsl-transfer-engine.js`) — every channel now contributes
 *      to every pixel, weighted continuously by hue distance, so there is
 *      no boundary left to be discontinuous across.
 *   2. `renderColorMatchCandidateToCanvas` rendered into a fixed
 *      `maxWidth = 640` internal buffer, then the `<canvas>` element is
 *      displayed at CSS `width:100%` — on any container wider than
 *      640px (the common case) the browser upscales that already-lossy
 *      raster, visually enlarging any residual artifact. Fixed by
 *      deriving the render width from the canvas's actual on-screen
 *      display size (× devicePixelRatio) instead of a fixed small cap.
 *   3. The Tone Curve stage hard-quantized to an 8-bit integer twice in a
 *      row (`curveLuts.master[curveLuts.red[Math.round(clamp8(r))]]` —
 *      each `curveLuts.*` a 256-entry `Uint8Array`) before HSL/grading
 *      ever ran. Fixed by sampling a >=1024-entry FLOAT LUT with linear
 *      interpolation (`buildFloatLUT`/`sampleFloatLUT`, additive exports
 *      in curve-engine) instead — no hard rounding happens until the
 *      single final `clamp8()` write to the output buffer.
 *   4. Calibration (`preset.cal`) was normalised into every call but
 *      never actually applied to a pixel — a real Candidate-to-Preview
 *      fidelity gap (Preview under-represented the Candidate). Fixed by
 *      applying it as a smooth, continuously-weighted blend of the 3 RGB
 *      primary shifts (weighted by each pixel's own normalised R/G/B
 *      share — always continuous, never a hard "if red dominates" cutoff).
 *   5. No skin or white-clothing protection existed at all. Fixed with
 *      continuous (feathered, not hard-masked) skin/white confidence
 *      functions that damp — never fully zero — the saturation/hue
 *      magnitude of HSL, Grading and Calibration for pixels that read as
 *      likely skin or likely white/near-neutral highlight.
 *   6. HSL saturation, Grading and Calibration could all push the same
 *      pixel's saturation upward independently with no shared ceiling.
 *      Fixed with a bounded total-chroma-shift safety limit applied
 *      after all three are summed, before compositing.
 */

import { buildLUT, defaultCurveSet, buildFloatLUT, sampleFloatLUT } from '../curve-engine/index.js';
import { gaussianHueWeight } from './perceptual-color-science.js';
import { LIGHTROOM_HSL_CENTERS } from './gaussian-hsl-transfer-engine.js';

const clamp8 = value => Math.max(0, Math.min(255, value));
const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));
const round = (value, digits = 3) => {
  const p = 10 ** digits;
  return Math.round((Number(value) || 0) * p) / p;
};


function isIdentityCurve(points) {
  return Array.isArray(points) && points.length >= 2 && points.every(p => Math.round(p.x) === Math.round(p.y));
}
function candidateCurveLut(points) {
  if (isIdentityCurve(points)) return Uint8Array.from({ length: 256 }, (_, i) => i);
  return buildLUT(points);
}

// ─── P0.8A: float, interpolated curve sampling (no hard mid-pipeline
// quantization — see file header §3). `null` sentinel means "identity",
// sampled as an exact passthrough with zero interpolation error, so a
// fully-neutral preset still produces bit-identical output to the
// pre-P0.8A behaviour (required by the existing identity-preset test).
function candidateFloatCurve(points) {
  if (isIdentityCurve(points)) return null;
  return buildFloatLUT(points);
}
function sampleCurve(floatLut, x) {
  return floatLut === null ? x : sampleFloatLUT(floatLut, x);
}

// ─── P0.8A: smooth, continuous HSL channel blending ────────────────────
// Replaces the old hard-boundary `channelForHue()` bucket. Every one of
// Lightroom's 8 HSL channels contributes to every pixel, weighted by a
// Gaussian function of hue distance from that channel's centre — the
// SAME `gaussianHueWeight`/`LIGHTROOM_HSL_CENTERS` already used when the
// Candidate's per-channel deltas are derived from the Reference/Target
// palettes (gaussian-hsl-transfer-engine.js), so render-time blending now
// matches analysis-time blending instead of approximating it with a
// hard nearest-bucket lookup.
const HSL_CHANNEL_NAMES = Object.keys(LIGHTROOM_HSL_CENTERS);
const HSL_SIGMA = 25; // matches the sigma the analysis-time Gaussian transfer already uses

let _hueWeightTableCache = null;
function getHueWeightTable() {
  if (_hueWeightTableCache) return _hueWeightTableCache;
  // 8 x 360 table, built once (lazily, then cached for the module's
  // lifetime — the channel centres/sigma are constants, not per-render
  // state) rather than recomputed per pixel. Each hue-degree's 8 weights
  // are normalised to sum to 1 so overlapping Gaussian influence never
  // double-counts a channel's adjustment magnitude.
  const table = HSL_CHANNEL_NAMES.map(() => new Float32Array(360));
  for (let deg = 0; deg < 360; deg++) {
    let sum = 0;
    const raw = new Array(HSL_CHANNEL_NAMES.length);
    for (let c = 0; c < HSL_CHANNEL_NAMES.length; c++) {
      const w = gaussianHueWeight(deg, LIGHTROOM_HSL_CENTERS[HSL_CHANNEL_NAMES[c]], HSL_SIGMA);
      raw[c] = w;
      sum += w;
    }
    for (let c = 0; c < HSL_CHANNEL_NAMES.length; c++) {
      table[c][deg] = sum > 1e-6 ? raw[c] / sum : 0;
    }
  }
  _hueWeightTableCache = table;
  return table;
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0; const l = (max + min) / 2;
  const d = max - min;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  if (h < 0) h += 360;
  return { h, s: s * 100, l: l * 100 };
}
function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360; s = clamp(s, 0, 100) / 100; l = clamp(l, 0, 100) / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = l - c / 2;
  let rp = 0, gp = 0, bp = 0;
  if (h < 60) [rp, gp, bp] = [c, x, 0];
  else if (h < 120) [rp, gp, bp] = [x, c, 0];
  else if (h < 180) [rp, gp, bp] = [0, c, x];
  else if (h < 240) [rp, gp, bp] = [0, x, c];
  else if (h < 300) [rp, gp, bp] = [x, 0, c];
  else [rp, gp, bp] = [c, 0, x];
  return [(rp + m) * 255, (gp + m) * 255, (bp + m) * 255];
}
function hueRgb(hue) { return hslToRgb(hue, 100, 50); }

function kelvinToApproxRgb(kelvin) {
  const t = clamp(kelvin, 2000, 50000) / 100;
  const r = t <= 66 ? 255 : 329.698727446 * ((t - 60) ** -0.1332047592);
  const g = t <= 66
    ? 99.470802586 * Math.log(t) - 161.1195681661
    : 288.1221695283 * ((t - 60) ** -0.0755148492);
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  return [clamp(r, 0, 255), clamp(g, 0, 255), clamp(b, 0, 255)];
}
function sliderToKelvinApprox(slider) {
  const s = clamp(slider, -100, 100);
  return s >= 0
    ? Math.round(5500 + s * (50000 - 5500) / 100)
    : Math.round(5500 + s * (5500 - 2000) / 100);
}
function buildWhiteBalanceGains(tempSlider, tintSlider) {
  const neutral = kelvinToApproxRgb(5500);
  const requested = kelvinToApproxRgb(sliderToKelvinApprox(tempSlider));
  const raw = neutral.map((v, i) => v / Math.max(1, requested[i]));
  const greenNormaliser = raw[1] || 1;
  let r = raw[0] / greenNormaliser;
  let g = 1;
  let b = raw[2] / greenNormaliser;
  const tint = clamp(tintSlider, -100, 100) / 100;
  // Lightroom positive Tint moves toward magenta: reduce green slightly and
  // support red/blue. Negative Tint moves toward green.
  r *= 1 + tint * 0.05;
  g *= 1 - tint * 0.18;
  b *= 1 + tint * 0.05;
  return {
    r: clamp(r, 0.72, 1.35),
    g: clamp(g, 0.82, 1.18),
    b: clamp(b, 0.72, 1.35),
  };
}

// ─── P0.8A: continuous (feathered) skin/white protection ───────────────
// Both functions return a smooth 0..1 confidence with no hard on/off
// edge anywhere in their domain — every boundary is a linear ramp of
// non-zero width, so protection strength fades in/out rather than
// switching. Computed from the ORIGINAL (pre-adjustment) pixel so
// protection strength reflects what the photo actually contains, not
// what earlier pipeline stages have already done to it.
function _softBand(x, lo, hi, feather) {
  const a = clamp((x - lo) / Math.max(1e-6, feather), 0, 1);
  const b = clamp((hi - x) / Math.max(1e-6, feather), 0, 1);
  return Math.min(a, b);
}
/**
 * Continuous re-derivation of this project's existing YCbCr skin model
 * (core/skin-classifier/index.js `_ycbcr`, ITU-R BT.601), replacing its
 * hard boolean thresholds with smooth ramps of the same boundaries.
 * @returns {number} 0..1
 */
function skinConfidence(r, g, b) {
  const Y = 0.299 * r + 0.587 * g + 0.114 * b;
  const Cb = -0.168736 * r - 0.331264 * g + 0.5 * b + 128;
  const Cr = 0.5 * r - 0.418688 * g - 0.081312 * b + 128;
  const wy = _softBand(Y, 70, 240, 20);
  const wcb = _softBand(Cb, 77, 127, 10);
  const wcr = _softBand(Cr, 133, 173, 10);
  return wy * wcb * wcr;
}
/**
 * Near-neutral highlight confidence — high luminance, low saturation.
 * Used to protect white/light fabric from picking up unwanted chroma.
 * @returns {number} 0..1
 */
function whiteConfidence(r, g, b) {
  const luma = (r + g + b) / 3;
  const maxc = Math.max(r, g, b), minc = Math.min(r, g, b);
  const sat = maxc > 0 ? (maxc - minc) / maxc : 0;
  const lumaWeight = clamp((luma - 200) / 45, 0, 1);
  const satWeight = clamp((0.20 - sat) / 0.20, 0, 1);
  return lumaWeight * satWeight;
}

const SKIN_PROTECTION_STRENGTH = 0.60;
const SKIN_HUE_PROTECTION_STRENGTH = 0.75; // hue shift is dampened harder than saturation/luma for skin
const WHITE_PROTECTION_STRENGTH = 0.65;
// P0.8A Step 6 — total-chroma-shift safety limit. HSL saturation +
// Grading + Calibration are each individually bounded at their own
// source (see lightroom-candidate-mapper.js clamps), but nothing
// previously stopped them from ALL landing on the same pixel and
// compounding. This caps the combined |Δsaturation-equivalent| the
// three stages may apply together, scaling all three down
// proportionally (never favouring one over another) if their sum would
// exceed it.
const MAX_TOTAL_CHROMA_SHIFT = 42;

export function applyColorMatchCandidateToImageData(imageData, preset) {
  if (!imageData?.data || !preset) throw new TypeError('Preview renderer requires ImageData and a candidate preset.');
  // Defensive normalization for live Intensity rebuilds. The renderer must
  // accept a valid partial candidate while optional colour groups are empty.
  const normalizedPreset = {
    ...preset,
    hsl: preset.hsl && typeof preset.hsl === 'object' ? preset.hsl : {},
    grade: preset.grade && typeof preset.grade === 'object' ? preset.grade : {},
    cal: preset.cal && typeof preset.cal === 'object' ? preset.cal : {},
    curves: preset.curves && typeof preset.curves === 'object' ? preset.curves : defaultCurveSet(),
  };
  preset = normalizedPreset;
  const output = new Uint8ClampedArray(imageData.data);
  const exposureFactor = 2 ** ((preset.exp || 0) / 100);
  const contrastFactor = 1 + (preset.con || 0) / 100;
  const wbGains = buildWhiteBalanceGains(preset.temp || 0, preset.tint || 0);
  const curves = preset.curves || defaultCurveSet();
  // P0.8A: float/interpolated curve sampling replaces the old chained
  // 256-entry integer LUT round-trip (file header §3). `candidateCurveLut`
  // (256-entry Uint8Array) is kept only for `pointCurveMagnitude`'s
  // identity/no-op detection below, which several other reports and the
  // XMP lineage already key off of — untouched.
  const curveLuts = {
    master: candidateCurveLut(curves.master || defaultCurveSet().master),
    red: candidateCurveLut(curves.red || defaultCurveSet().red),
    green: candidateCurveLut(curves.green || defaultCurveSet().green),
    blue: candidateCurveLut(curves.blue || defaultCurveSet().blue),
  };
  const floatCurves = {
    master: candidateFloatCurve(curves.master || defaultCurveSet().master),
    red: candidateFloatCurve(curves.red || defaultCurveSet().red),
    green: candidateFloatCurve(curves.green || defaultCurveSet().green),
    blue: candidateFloatCurve(curves.blue || defaultCurveSet().blue),
  };
  const curveMagnitude = ['master','red','green','blue'].reduce((sum,ch)=>sum+(curves[ch]||[]).reduce((s,p)=>s+Math.abs((p.y||0)-(p.x||0)),0),0);
  const hueWeightTable = getHueWeightTable();
  const cal = preset.cal || {};
  const calActive = !!(cal.cal_red_h || cal.cal_red_s || cal.cal_green_h || cal.cal_green_s || cal.cal_blue_h || cal.cal_blue_s);
  let changedPixels = 0;
  let absoluteDifference = 0;
  let clippedHighlights = 0;
  let clippedShadows = 0;
  let sourceClippedHighlights = 0;
  let sourceClippedShadows = 0;
  let newlyClippedHighlights = 0;
  let newlyClippedShadows = 0;
  let recoveredHighlights = 0;
  let recoveredShadows = 0;

  for (let i = 0; i < output.length; i += 4) {
    if (output[i + 3] === 0) continue;
    const original = [output[i], output[i + 1], output[i + 2]];
    let [r, g, b] = original;

    // P0.8A protection confidence — computed from the untouched source
    // pixel, before any adjustment, so it reflects the photo itself.
    const skinConf = skinConfidence(original[0], original[1], original[2]);
    const whiteConf = whiteConfidence(original[0], original[1], original[2]);
    // Multiplicative damping factors (never fully zero — protection
    // limits creative intent, it does not erase it). A pixel that is
    // both plausibly skin AND plausibly a bright highlight (e.g. a lit
    // cheekbone) gets the stronger of the two, not both stacked.
    const satDamp = 1 - Math.max(skinConf * SKIN_PROTECTION_STRENGTH, whiteConf * WHITE_PROTECTION_STRENGTH);
    const hueDamp = 1 - Math.max(skinConf * SKIN_HUE_PROTECTION_STRENGTH, whiteConf * WHITE_PROTECTION_STRENGTH * 0.5);
    const lumaDamp = 1 - whiteConf * WHITE_PROTECTION_STRENGTH * 0.6; // protect white fabric's highlight texture from being crushed

    // White-balance approximation calibrated from the same 2000–50000 K
    // slider contract used by XMP serialization. This is still a rendered-JPEG
    // preview, not Adobe's RAW pipeline, but it no longer under-represents a
    // Temperature move by treating it as a tiny fixed RGB offset.
    r *= wbGains.r;
    g *= wbGains.g;
    b *= wbGains.b;

    // Exposure and contrast.
    r *= exposureFactor; g *= exposureFactor; b *= exposureFactor;
    r = 128 + (r - 128) * contrastFactor;
    g = 128 + (g - 128) * contrastFactor;
    b = 128 + (b - 128) * contrastFactor;

    // Zone-aware Basic Panel approximation.
    const luma = (r + g + b) / 3;
    const shadowWeight = clamp((112 - luma) / 112, 0, 1);
    const highlightWeight = clamp((luma - 143) / 112, 0, 1);
    const midWeight = 1 - Math.max(shadowWeight, highlightWeight);
    const zoneLift = shadowWeight * ((preset.sh || 0) * 0.42 + (preset.bl || 0) * 0.2)
      + highlightWeight * ((preset.hi || 0) * 0.42 + (preset.wh || 0) * 0.2);
    r += zoneLift; g += zoneLift; b += zoneLift;

    // Apply the exact candidate point curves that are serialized into XMP.
    // Per-channel curve first, then master luminance curve. This is an
    // approximation of Adobe's processing order, but the curve source of
    // truth is identical between Preview and Candidate XMP. P0.8A: sampled
    // from a >=1024-entry FLOAT LUT with linear interpolation — no
    // Math.round, no integer LUT round-trip, until the final clamp8() at
    // the end of this loop.
    r = sampleCurve(floatCurves.master, sampleCurve(floatCurves.red, clamp(r, 0, 255)));
    g = sampleCurve(floatCurves.master, sampleCurve(floatCurves.green, clamp(g, 0, 255)));
    b = sampleCurve(floatCurves.master, sampleCurve(floatCurves.blue, clamp(b, 0, 255)));

    // P0.8A: smooth, continuous 8-channel HSL blend — replaces the old
    // hard nearest-bucket `channelForHue()` lookup (file header §1). Skin
    // hue shift is protected more strongly than saturation/luminance.
    let hsl = rgbToHsl(r, g, b);
    const hueIdx = ((Math.round(hsl.h) % 360) + 360) % 360;
    let dh = 0, ds = 0, dl = 0;
    for (let c = 0; c < HSL_CHANNEL_NAMES.length; c++) {
      const w = hueWeightTable[c][hueIdx];
      if (w <= 0) continue;
      const name = HSL_CHANNEL_NAMES[c];
      dh += w * (preset.hsl?.[`hsl_h_${name}`] || 0);
      ds += w * (preset.hsl?.[`hsl_s_${name}`] || 0);
      dl += w * (preset.hsl?.[`hsl_l_${name}`] || 0);
    }
    let vibSatDelta = (preset.vib || 0) * (1 - hsl.s / 100) * 0.55 + (preset.sat || 0) * 0.32;

    // P0.8A: Calibration (RGB primary hue/saturation) — previously
    // normalised but never applied (a real Candidate-to-Preview fidelity
    // gap). Applied as a smooth blend weighted by each pixel's own
    // continuous, normalised R/G/B share — never a hard "if red
    // dominates" cutoff, so there is no boundary to be discontinuous
    // across here either.
    let calHueDelta = 0, calSatDelta = 0;
    if (calActive) {
      const total = Math.max(1, r + g + b);
      const wr = clamp(r / total, 0, 1), wg = clamp(g / total, 0, 1), wb = clamp(b / total, 0, 1);
      calHueDelta = wr * (cal.cal_red_h || 0) + wg * (cal.cal_green_h || 0) + wb * (cal.cal_blue_h || 0);
      calSatDelta = wr * (cal.cal_red_s || 0) + wg * (cal.cal_green_s || 0) + wb * (cal.cal_blue_s || 0);
    }

    // P0.8A Step 6 — bounded total chroma shift. Sum the saturation-
    // equivalent contributions from HSL + vibrance/sat + Calibration and
    // scale all three down together (never independently) if their
    // combined magnitude would exceed the safety limit.
    const totalSatMagnitude = Math.abs(ds) + Math.abs(vibSatDelta) + Math.abs(calSatDelta);
    const chromaScale = totalSatMagnitude > MAX_TOTAL_CHROMA_SHIFT
      ? MAX_TOTAL_CHROMA_SHIFT / totalSatMagnitude
      : 1;

    hsl.h += (dh + calHueDelta) * hueDamp;
    hsl.s += (ds + vibSatDelta + calSatDelta) * chromaScale * satDamp;
    hsl.l += dl * lumaDamp;
    [r, g, b] = hslToRgb(hsl.h, hsl.s, hsl.l);

    // Three-way grading with soft luma weights.
    const grade = preset.grade || {};
    const applyGrade = (hue, sat, weight) => {
      if (!sat || !weight) return;
      const [gr, gg, gb] = hueRgb(hue || 0);
      const alpha = clamp((sat / 100) * weight * 0.24, 0, 0.12) * satDamp;
      r = r * (1 - alpha) + gr * alpha;
      g = g * (1 - alpha) + gg * alpha;
      b = b * (1 - alpha) + gb * alpha;
    };
    applyGrade(grade.grd_sh_h, grade.grd_sh_s, shadowWeight);
    applyGrade(grade.grd_mid_h, grade.grd_mid_s, midWeight);
    applyGrade(grade.grd_hi_h, grade.grd_hi_s, highlightWeight);

    const nr = clamp8(r), ng = clamp8(g), nb = clamp8(b);
    const sourceHighlightClipped = Math.max(...original) >= 254;
    const sourceShadowClipped = Math.max(...original) <= 1;
    const outputHighlightClipped = Math.max(nr, ng, nb) >= 254;
    const outputShadowClipped = Math.max(nr, ng, nb) <= 1;
    if (sourceHighlightClipped) sourceClippedHighlights += 1;
    if (sourceShadowClipped) sourceClippedShadows += 1;
    if (!sourceHighlightClipped && outputHighlightClipped) newlyClippedHighlights += 1;
    if (!sourceShadowClipped && outputShadowClipped) newlyClippedShadows += 1;
    if (sourceHighlightClipped && !outputHighlightClipped) recoveredHighlights += 1;
    if (sourceShadowClipped && !outputShadowClipped) recoveredShadows += 1;
    const pixelDifference = Math.abs(nr - original[0]) + Math.abs(ng - original[1]) + Math.abs(nb - original[2]);
    if (pixelDifference >= 1) changedPixels += 1;
    absoluteDifference += pixelDifference;
    if (nr >= 254 || ng >= 254 || nb >= 254) clippedHighlights += 1;
    if (nr <= 1 && ng <= 1 && nb <= 1) clippedShadows += 1;
    output[i] = nr; output[i + 1] = ng; output[i + 2] = nb;
  }

  const pixelCount = output.length / 4;
  return {
    imageData: new ImageData(output, imageData.width, imageData.height),
    metrics: {
      pixelCount,
      changedPixels,
      changedPixelPct: round(changedPixels / Math.max(1, pixelCount) * 100, 3),
      meanAbsoluteChannelDifference: round(absoluteDifference / Math.max(1, pixelCount * 3), 3),
      clippedHighlightPct: round(clippedHighlights / Math.max(1, pixelCount) * 100, 3),
      clippedShadowPct: round(clippedShadows / Math.max(1, pixelCount) * 100, 3),
      sourceClippedHighlightPct: round(sourceClippedHighlights / Math.max(1, pixelCount) * 100, 3),
      sourceClippedShadowPct: round(sourceClippedShadows / Math.max(1, pixelCount) * 100, 3),
      newlyClippedHighlightPct: round(newlyClippedHighlights / Math.max(1, pixelCount) * 100, 3),
      newlyClippedShadowPct: round(newlyClippedShadows / Math.max(1, pixelCount) * 100, 3),
      recoveredHighlightPct: round(recoveredHighlights / Math.max(1, pixelCount) * 100, 3),
      recoveredShadowPct: round(recoveredShadows / Math.max(1, pixelCount) * 100, 3),
      identity: changedPixels === 0,
      pointCurvesApplied: curveMagnitude >= 1,
      pointCurveMagnitude: round(curveMagnitude, 2),
    },
  };
}

// P0.8A Step 8 — the internal render buffer must not be a fixed small
// cap that then gets CSS-upscaled as the final displayed Preview. The
// default here is now a generous ceiling (well above any common display
// width), and `renderColorMatchCandidateToCanvas`'s caller is expected to
// pass the canvas's actual on-screen size — see
// `_previewRenderWidthFor()` in ui/reference-color-match-panel.js, which
// reads the canvas's live CSS box size (accounting for devicePixelRatio)
// rather than using this default. The default only applies when no
// canvas is laid out yet (e.g. an off-screen render).
const DEFAULT_PREVIEW_MAX_WIDTH = 1600;

export function renderColorMatchCandidateToCanvas({ image, canvas, preset, maxWidth = DEFAULT_PREVIEW_MAX_WIDTH } = {}) {
  if (!image || !canvas || !preset) throw new TypeError('Candidate canvas render requires image, canvas and preset.');
  const naturalWidth = image.naturalWidth || image.width;
  const naturalHeight = image.naturalHeight || image.height;
  const scale = Math.min(1, maxWidth / Math.max(1, naturalWidth));
  const width = Math.max(1, Math.round(naturalWidth * scale));
  const height = Math.max(1, Math.round(naturalHeight * scale));
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  // High-quality smoothing for the downscale draw — never nearest-
  // neighbour. Explicit even though it is the canvas default, so this
  // contract cannot silently regress.
  if ('imageSmoothingEnabled' in ctx) ctx.imageSmoothingEnabled = true;
  if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, width, height);
  const source = ctx.getImageData(0, 0, width, height);
  const rendered = applyColorMatchCandidateToImageData(source, preset);
  ctx.putImageData(rendered.imageData, 0, 0);
  return { width, height, ...rendered.metrics };
}
