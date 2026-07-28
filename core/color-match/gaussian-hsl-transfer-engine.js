/**
 * EPIC 2E-O8 — Gaussian HSL transfer using actual Reference/Target palettes.
 * The production engine is imported directly by the candidate mapper tests;
 * no formula is duplicated inside QA.
 */
import { gaussianHueWeight, circularHueDelta, rgbToLab, deltaE2000 } from './perceptual-color-science.js';

export const LIGHTROOM_HSL_CENTERS = Object.freeze({
  red: 0, orange: 30, yellow: 60, green: 120,
  aqua: 180, blue: 225, purple: 270, magenta: 315,
});
const clamp = (v, min, max) => Math.max(min, Math.min(max, Number(v) || 0));
const round = (v, d = 3) => { const p = 10 ** d; return Math.round((Number(v) || 0) * p) / p; };

function bucketStats(palette, center, sigma) {
  let total = 0, hueSin = 0, hueCos = 0, sat = 0, lum = 0, labL = 0, laba = 0, labb = 0;
  for (const color of palette?.colors || []) {
    const population = clamp(color?.weight, 0, 1);
    const saturation = clamp(color?.hsl?.s, 0, 100);
    // Neutral pixels must not drive a hue bucket.
    const chromaReliability = clamp((saturation - 4) / 22, 0, 1);
    const weight = population * gaussianHueWeight(color?.hsl?.h, center, sigma) * chromaReliability;
    if (weight <= 1e-8) continue;
    const hue = ((Number(color.hsl.h) % 360) + 360) % 360;
    const radians = hue * Math.PI / 180;
    const lab = rgbToLab(color.rgb || color);
    total += weight; hueSin += Math.sin(radians) * weight; hueCos += Math.cos(radians) * weight;
    sat += saturation * weight; lum += clamp(color?.hsl?.l, 0, 100) * weight;
    labL += lab.L * weight; laba += lab.a * weight; labb += lab.b * weight;
  }
  if (total <= 1e-8) return { coverage: 0, hue: center, saturation: 0, luminance: 0, lab: { L: 0, a: 0, b: 0 } };
  let hue = Math.atan2(hueSin, hueCos) * 180 / Math.PI; if (hue < 0) hue += 360;
  return {
    coverage: round(total, 5), hue: round(hue, 2), saturation: round(sat / total, 2), luminance: round(lum / total, 2),
    lab: { L: labL / total, a: laba / total, b: labb / total },
  };
}

export function deriveGaussianHslTransfer({ referencePalette, targetPalette, intensity = 60, sigma = 25 } = {}) {
  const scale = clamp(intensity, 0, 100) / 100;
  const channels = {};
  let supported = 0, confidenceSum = 0, perceptualDistanceSum = 0;
  for (const [channel, center] of Object.entries(LIGHTROOM_HSL_CENTERS)) {
    const ref = bucketStats(referencePalette, center, sigma);
    const target = bucketStats(targetPalette, center, sigma);
    const sharedCoverage = Math.min(ref.coverage, target.coverage);
    const confidence = clamp(sharedCoverage / 0.08, 0, 1);
    const perceptualDistance = ref.coverage && target.coverage ? deltaE2000(ref.lab, target.lab) : 0;
    const hueDelta = circularHueDelta(target.hue, ref.hue);
    // Lightroom HSL hue is intentionally bounded; large scene-object shifts are dampened.
    channels[channel] = {
      hue: round(clamp(hueDelta * 0.42 * confidence * scale, -18, 18), 2),
      saturation: round(clamp((ref.saturation - target.saturation) * 0.55 * confidence * scale, -28, 28), 2),
      luminance: round(clamp((ref.luminance - target.luminance) * 0.45 * confidence * scale, -22, 22), 2),
      confidence: round(confidence, 3), sharedCoverage: round(sharedCoverage, 4), perceptualDistance: round(perceptualDistance, 3),
      reference: ref, target,
    };
    if (confidence >= 0.2) { supported += 1; confidenceSum += confidence; perceptualDistanceSum += perceptualDistance; }
  }
  return {
    kind: 'LUMIXA_GAUSSIAN_HSL_TRANSFER', schemaVersion: 1, sigma,
    channels, supportedChannelCount: supported,
    confidence: round(supported ? confidenceSum / supported : 0, 3),
    meanSharedDeltaE2000: round(supported ? perceptualDistanceSum / supported : 0, 3),
  };
}
