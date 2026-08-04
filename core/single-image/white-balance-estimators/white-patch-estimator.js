/**
 * core/single-image/white-balance-estimators/white-patch-estimator.js
 *
 * EPIC 2E-P1I — genuine White Patch estimator. Does NOT simply choose
 * the brightest pixel (that would be single-specular-pixel noise, one
 * of the explicit failure modes the spec calls out) — it derives a
 * high-luminance PERCENTILE region among the accepted pixel set,
 * excludes any pixel with a clipped channel, rejects candidates that
 * are too saturated to be a genuine near-white surface (as opposed to
 * a colored light source), and requires a minimum sample count AND
 * spatial spread before accepting the estimate at all.
 */

import { ESTIMATOR_ID, ESTIMATOR_STATUS, REJECTION_REASON, unavailableResult } from './wb-estimator-schema.js';
import {
  meanToNeutralGains, gainsToTempTint, castAxisFromTempTint, safeClamp,
  isAnyChannelClipped, spatialCoverageOf, hueDominance, hueDegreesToFamily,
} from './wb-color-math.js';

const HIGHLIGHT_PERCENTILE = 0.90;      // top 10% of accepted-pixel luminance is the candidate highlight band
const MIN_HIGHLIGHT_SAMPLES = 15;       // fewer than this is treated as unreliable/single-pixel-specular-risk
const MIN_SPATIAL_COVERAGE = 0.002;     // candidates clustered into a near-single-point region are rejected
const SAT_REJECT_TOO_SATURATED = 0.18;  // above this mean saturation, candidates are not a credible "near-white" surface
const SAT_REJECT_COLORED_LIGHT = 0.35;  // combined with strong hue dominance, treated as a colored light source specifically
const COLORED_LIGHT_DOMINANCE = 0.6;

function _percentile(sortedAsc, p) {
  if (!sortedAsc.length) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.floor(p * (sortedAsc.length - 1))));
  return sortedAsc[idx];
}

/**
 * @param {import('./wb-pixel-sampler.js').SampleResult} sample
 * @returns {import('./wb-estimator-schema.js').EstimatorResult}
 */
export function estimateWhitePatch(sample) {
  const accepted = sample?.accepted ?? [];
  const totalScanned = sample?.totalScanned ?? 0;

  if (!accepted.length) {
    return unavailableResult(ESTIMATOR_ID.WHITE_PATCH, REJECTION_REASON.NO_VALID_HIGHLIGHT_REGION, {
      sampleCount: totalScanned, rejectedPixelCount: totalScanned,
    });
  }

  const lumsSorted = accepted.map(p => p.lum).sort((a, b) => a - b);
  const threshold = _percentile(lumsSorted, HIGHLIGHT_PERCENTILE);

  const highLum = accepted.filter(px => px.lum >= threshold);
  const nonClipped = highLum.filter(px => !isAnyChannelClipped(px.r, px.g, px.b));

  if (highLum.length > 0 && nonClipped.length === 0) {
    return unavailableResult(ESTIMATOR_ID.WHITE_PATCH, REJECTION_REASON.HIGHLIGHTS_CLIPPED, {
      sampleCount: totalScanned, acceptedPixelCount: accepted.length, rejectedPixelCount: totalScanned - accepted.length,
      luminanceRange: { min: Math.round(lumsSorted[0]), max: Math.round(lumsSorted[lumsSorted.length - 1]) },
      clippingRate: 1,
    });
  }
  if (nonClipped.length === 0) {
    return unavailableResult(ESTIMATOR_ID.WHITE_PATCH, REJECTION_REASON.NO_VALID_HIGHLIGHT_REGION, {
      sampleCount: totalScanned, acceptedPixelCount: accepted.length, rejectedPixelCount: totalScanned - accepted.length,
    });
  }

  const meanSat = nonClipped.reduce((s, p) => s + p.sat, 0) / nonClipped.length;
  const { dominanceRatio } = hueDominance(nonClipped);

  if (meanSat > SAT_REJECT_COLORED_LIGHT && dominanceRatio >= COLORED_LIGHT_DOMINANCE) {
    return unavailableResult(ESTIMATOR_ID.WHITE_PATCH, REJECTION_REASON.COLORED_LIGHT_SUSPECTED, {
      sampleCount: totalScanned, acceptedPixelCount: accepted.length, rejectedPixelCount: totalScanned - accepted.length,
      saturationRange: { min: 0, max: +meanSat.toFixed(3) },
    });
  }
  if (meanSat > SAT_REJECT_TOO_SATURATED) {
    return unavailableResult(ESTIMATOR_ID.WHITE_PATCH, REJECTION_REASON.HIGHLIGHTS_TOO_SATURATED, {
      sampleCount: totalScanned, acceptedPixelCount: accepted.length, rejectedPixelCount: totalScanned - accepted.length,
      saturationRange: { min: 0, max: +meanSat.toFixed(3) },
    });
  }

  const spatialCoverage = spatialCoverageOf(nonClipped, sample.width, sample.height);
  if (nonClipped.length < MIN_HIGHLIGHT_SAMPLES || spatialCoverage < MIN_SPATIAL_COVERAGE) {
    return unavailableResult(ESTIMATOR_ID.WHITE_PATCH, REJECTION_REASON.INSUFFICIENT_SPATIAL_COVERAGE, {
      sampleCount: totalScanned, acceptedPixelCount: nonClipped.length, rejectedPixelCount: totalScanned - nonClipped.length,
      spatialCoverage,
    });
  }

  const n = nonClipped.length;
  const meanR = nonClipped.reduce((s, p) => s + p.r, 0) / n;
  const meanG = nonClipped.reduce((s, p) => s + p.g, 0) / n;
  const meanB = nonClipped.reduce((s, p) => s + p.b, 0) / n;
  const gains = meanToNeutralGains(meanR, meanG, meanB);
  const { temperature, tint, gainR, gainG, gainB } = gainsToTempTint(gains);
  const castAxis = castAxisFromTempTint(temperature, tint);
  const castStrength = safeClamp(Math.sqrt(temperature ** 2 + tint ** 2) / 40, 0, 1);

  const lumVar = nonClipped.reduce((s, p) => s + (p.lum - (nonClipped.reduce((a, q) => a + q.lum, 0) / n)) ** 2, 0) / n;
  const lumStability = safeClamp(1 - Math.sqrt(lumVar) / 40, 0, 1);
  const sampleFactor = safeClamp(n / 150, 0, 1);
  const saturationCleanliness = safeClamp(1 - meanSat / SAT_REJECT_TOO_SATURATED, 0, 1);

  let confidence = safeClamp(
    0.30 * sampleFactor +
    0.25 * spatialCoverage * 10 /* spatialCoverage is a tiny fraction for a highlight band; scale into a usable confidence range, still clamped 0-1 */ +
    0.25 * saturationCleanliness +
    0.20 * lumStability,
    0, 1
  );

  const warnings = [];
  if (n < 40) warnings.push(`Only ${n} non-clipped highlight candidates found — White Patch estimate has limited support.`);

  return {
    estimatorId: ESTIMATOR_ID.WHITE_PATCH,
    status: ESTIMATOR_STATUS.OK,
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
      luminanceRange: { min: Math.round(threshold), max: Math.round(lumsSorted[lumsSorted.length - 1]) },
      saturationRange: { min: 0, max: +meanSat.toFixed(3) },
      clippingRate: safeClamp((sample.rejectedCounts?.fullyClipped ?? 0) / Math.max(1, totalScanned), 0, 1),
      spatialCoverage: +spatialCoverage.toFixed(4),
    },
    diagnostics: { rejectionReason: null, warnings, dominantHueFamily: hueDegreesToFamily(hueDominance(nonClipped).dominantHueDegrees) },
  };
}
