/**
 * EPIC 2E-N4 — Candidate Preview Pixel Renderer
 *
 * Deterministic browser preview for the exact N3 safePreset. This is still
 * an approximation of Lightroom's RAW pipeline, but it applies WB, tone,
 * HSL and grading from one candidate source of truth and reports metrics.
 */

import { buildLUT, defaultCurveSet } from '../curve-engine/index.js';

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
function channelForHue(h) {
  if (h >= 337.5 || h < 22.5) return 'red';
  if (h < 52.5) return 'orange';
  if (h < 82.5) return 'yellow';
  if (h < 157.5) return 'green';
  if (h < 202.5) return 'aqua';
  if (h < 247.5) return 'blue';
  if (h < 292.5) return 'purple';
  return 'magenta';
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
  const curveLuts = {
    master: candidateCurveLut(curves.master || defaultCurveSet().master),
    red: candidateCurveLut(curves.red || defaultCurveSet().red),
    green: candidateCurveLut(curves.green || defaultCurveSet().green),
    blue: candidateCurveLut(curves.blue || defaultCurveSet().blue),
  };
  const curveMagnitude = ['master','red','green','blue'].reduce((sum,ch)=>sum+(curves[ch]||[]).reduce((s,p)=>s+Math.abs((p.y||0)-(p.x||0)),0),0);
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
    // truth is identical between Preview and Candidate XMP.
    r = curveLuts.master[curveLuts.red[Math.round(clamp8(r))]];
    g = curveLuts.master[curveLuts.green[Math.round(clamp8(g))]];
    b = curveLuts.master[curveLuts.blue[Math.round(clamp8(b))]];

    let hsl = rgbToHsl(r, g, b);
    const channel = channelForHue(hsl.h);
    hsl.h += preset.hsl?.[`hsl_h_${channel}`] || 0;
    hsl.s += preset.hsl?.[`hsl_s_${channel}`] || 0;
    hsl.l += preset.hsl?.[`hsl_l_${channel}`] || 0;
    hsl.s += (preset.vib || 0) * (1 - hsl.s / 100) * 0.55 + (preset.sat || 0) * 0.32;
    [r, g, b] = hslToRgb(hsl.h, hsl.s, hsl.l);

    // Three-way grading with soft luma weights.
    const grade = preset.grade || {};
    const applyGrade = (hue, sat, weight) => {
      if (!sat || !weight) return;
      const [gr, gg, gb] = hueRgb(hue || 0);
      const alpha = clamp((sat / 100) * weight * 0.24, 0, 0.12);
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

export function renderColorMatchCandidateToCanvas({ image, canvas, preset, maxWidth = 640 } = {}) {
  if (!image || !canvas || !preset) throw new TypeError('Candidate canvas render requires image, canvas and preset.');
  const naturalWidth = image.naturalWidth || image.width;
  const naturalHeight = image.naturalHeight || image.height;
  const scale = Math.min(1, maxWidth / Math.max(1, naturalWidth));
  const width = Math.max(1, Math.round(naturalWidth * scale));
  const height = Math.max(1, Math.round(naturalHeight * scale));
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, width, height);
  const source = ctx.getImageData(0, 0, width, height);
  const rendered = applyColorMatchCandidateToImageData(source, preset);
  ctx.putImageData(rendered.imageData, 0, 0);
  return { width, height, ...rendered.metrics };
}
