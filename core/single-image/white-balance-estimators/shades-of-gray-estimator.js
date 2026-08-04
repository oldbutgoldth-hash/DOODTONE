/**
 * core/single-image/white-balance-estimators/shades-of-gray-estimator.js
 *
 * EPIC 2E-P1I — genuine Minkowski p-norm Shades of Gray estimator.
 *
 * Documented p value: p=6 (SOG_P), matching the classic Shades-of-Gray
 * literature's typical p range (p=1 reduces to Gray World, p=∞
 * approaches White Patch/Max-RGB; p=6 is a well-established "robust
 * middle ground" value already used by whitebalance-engine's own
 * private _shadesOfGray() — kept identical here for cross-estimator
 * comparability, since changing the exponent would make this
 * estimator's output not meaningfully comparable to that existing,
 * proven choice).
 *
 * Deliberately UNWEIGHTED (unlike gray-world-estimator.js's
 * saturation-weighted mean) and computed on the raw accepted-pixel
 * set with no saturation down-weighting — this is what makes it a
 * genuinely INDEPENDENT estimator rather than "a weighted Gray World
 * result" (per the spec's explicit requirement). The p-norm itself
 * (mean of r^p, raised to 1/p) naturally weights brighter pixels more
 * heavily than a plain arithmetic mean, which is Shades-of-Gray's
 * actual distinguishing statistical property versus Gray World.
 */

import { ESTIMATOR_ID, ESTIMATOR_STATUS, REJECTION_REASON, unavailableResult } from './wb-estimator-schema.js';
import {
  gainsToTempTint, castAxisFromTempTint, safeClamp, safeNumber,
  hueDominance, spatialCoverageOf, hueDegreesToFamily,
} from './wb-color-math.js';
import { sampleCountFactor, dominancePenaltyMultiplier } from './estimator-confidence.js';

export const SOG_P = 6;
export const MIN_SAMPLE_COUNT = 40;
const SUFFICIENT_SAMPLE_COUNT = 400;
const DOMINANCE_WARN_RATIO = 0.45;
const DOMINANCE_SEVERE_RATIO = 0.65;

function _minkowskiGains(pixels, p) {
  const n = pixels.length;
  if (!n) return { r: 1, g: 1, b: 1 };
  let rS = 0, gS = 0, bS = 0;
  for (const { r, g, b } of pixels) { rS += r ** p; gS += g ** p; bS += b ** p; }
  const rM = safeNumber((rS / n) ** (1 / p), 1);
  const gM = safeNumber((gS / n) ** (1 / p), 1);
  const bM = safeNumber((bS / n) ** (1 / p), 1);
  const ref = (rM + gM + bM) / 3;
  if (ref <= 0) return { r: 1, g: 1, b: 1 };
  return { r: ref / Math.max(1, rM), g: ref / Math.max(1, gM), b: ref / Math.max(1, bM) };
}

/**
 * @param {import('./wb-pixel-sampler.js').SampleResult} sample
 * @returns {import('./wb-estimator-schema.js').EstimatorResult}
 */
export function estimateShadesOfGray(sample) {
  const accepted = sample?.accepted ?? [];
  const totalScanned = sample?.totalScanned ?? 0;

  if (accepted.length < MIN_SAMPLE_COUNT) {
    return unavailableResult(ESTIMATOR_ID.SHADES_OF_GRAY, REJECTION_REASON.INSUFFICIENT_SAMPLE_COUNT, {
      sampleCount: totalScanned, acceptedPixelCount: accepted.length, rejectedPixelCount: totalScanned - accepted.length,
    });
  }

  const gains = _minkowskiGains(accepted, SOG_P);
  const { temperature, tint, gainR, gainG, gainB } = gainsToTempTint(gains);
  const castAxis = castAxisFromTempTint(temperature, tint);
  const castStrength = safeClamp(Math.sqrt(temperature ** 2 + tint ** 2) / 40, 0, 1);

  const { dominanceRatio, dominantHueDegrees } = hueDominance(accepted);
  const spatialCoverage = spatialCoverageOf(accepted, sample.width, sample.height);
  const sampleFactor = sampleCountFactor(accepted.length, SUFFICIENT_SAMPLE_COUNT);

  let lumMin = Infinity, lumMax = -Infinity, satMin = Infinity, satMax = -Infinity;
  for (const px of accepted) {
    if (px.lum < lumMin) lumMin = px.lum;
    if (px.lum > lumMax) lumMax = px.lum;
    if (px.sat < satMin) satMin = px.sat;
    if (px.sat > satMax) satMax = px.sat;
  }

  // SOG-specific confidence term: how much the p-norm result diverges
  // from a plain arithmetic mean. A large divergence signals a
  // non-uniform, potentially dominated distribution — SOG's own
  // signal, independent of the dominanceRatio hue-bucket check.
  const n = accepted.length;
  const arithR = accepted.reduce((s, p) => s + p.r, 0) / n;
  const arithG = accepted.reduce((s, p) => s + p.g, 0) / n;
  const arithB = accepted.reduce((s, p) => s + p.b, 0) / n;
  const pNormR = (accepted.reduce((s, p) => s + p.r ** SOG_P, 0) / n) ** (1 / SOG_P);
  const pNormG = (accepted.reduce((s, p) => s + p.g ** SOG_P, 0) / n) ** (1 / SOG_P);
  const pNormB = (accepted.reduce((s, p) => s + p.b ** SOG_P, 0) / n) ** (1 / SOG_P);
  const divergence = safeClamp(
    (Math.abs(pNormR - arithR) + Math.abs(pNormG - arithG) + Math.abs(pNormB - arithB)) / 90,
    0, 1
  );

  let confidence = safeClamp(
    0.35 * sampleFactor +
    0.25 * spatialCoverage +
    0.20 * (1 - dominanceRatio) +
    0.20 * (1 - divergence),
    0, 1
  );

  const warnings = [];
  let status = ESTIMATOR_STATUS.OK;
  const domMultiplier = dominancePenaltyMultiplier(dominanceRatio, {
    warnRatio: DOMINANCE_WARN_RATIO, severeRatio: DOMINANCE_SEVERE_RATIO, warnMultiplier: 0.75, severeMultiplier: 0.5,
  });
  if (domMultiplier < 1) {
    confidence = safeClamp(confidence * domMultiplier, 0, 1);
    status = ESTIMATOR_STATUS.DEGRADED;
    if (domMultiplier <= 0.5) warnings.push(`A single hue (family "${hueDegreesToFamily(dominantHueDegrees)}") covers ${(dominanceRatio * 100).toFixed(0)}% of coloured accepted pixels — Shades of Gray confidence reduced.`);
  }

  return {
    estimatorId: ESTIMATOR_ID.SHADES_OF_GRAY,
    status,
    confidence: +confidence.toFixed(3),
    estimate: {
      rgbGain: { r: gainR, g: gainG, b: gainB },
      temperatureIntent: temperature, tintIntent: tint,
      castAxis, castStrength: +castStrength.toFixed(3),
    },
    evidence: {
      sampleCount: totalScanned,
      acceptedPixelCount: n,
      rejectedPixelCount: totalScanned - n,
      luminanceRange: { min: Math.round(lumMin), max: Math.round(lumMax) },
      saturationRange: { min: +satMin.toFixed(3), max: +satMax.toFixed(3) },
      clippingRate: safeClamp((sample.rejectedCounts?.fullyClipped ?? 0) / Math.max(1, totalScanned), 0, 1),
      spatialCoverage: +spatialCoverage.toFixed(3),
    },
    diagnostics: {
      rejectionReason: null, warnings,
      p: SOG_P,
      divergenceFromArithmeticMean: +divergence.toFixed(3),
      dominanceRatio: +dominanceRatio.toFixed(3),
    },
  };
}
