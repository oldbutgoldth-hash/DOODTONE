/**
 * core/single-image/white-balance-estimators/gray-world-estimator.js
 *
 * EPIC 2E-P1I — genuine, independent Gray World estimator operating on
 * the pixel sampler's accepted-pixel list (already excludes fully-
 * clipped and near-black pixels — see wb-pixel-sampler.js). This is a
 * NEW implementation with its own confidence/rejection contract; it
 * does not call whitebalance-engine's private `_grayWorld()` (which
 * has no confidence model beyond a fixed 0.5 — see
 * P1I_PIXEL_EVIDENCE_PIPELINE_AUDIT.md §11) and does not duplicate its
 * formula verbatim, though the underlying channel-mean-to-neutral-
 * gains math is intentionally the same well-established technique
 * (see P1I_GRAY_WORLD_MODEL.md).
 *
 * Requirement satisfied: "must not force a green forest toward
 * magenta merely because green dominates" — implemented via (a) a
 * saturation-down-weighted mean (highly saturated / colourful pixels
 * contribute less to the average) and (b) a hue-dominance confidence
 * penalty (if one hue bucket dominates the coloured accepted pixels,
 * confidence is reduced, tested directly for green/pink dominance).
 */

import { ESTIMATOR_ID, ESTIMATOR_STATUS, REJECTION_REASON, unavailableResult } from './wb-estimator-schema.js';
import {
  meanToNeutralGains, gainsToTempTint, castAxisFromTempTint, safeClamp,
  hueDominance, spatialCoverageOf, hueDegreesToFamily,
} from './wb-color-math.js';
import { sampleCountFactor, dominancePenaltyMultiplier } from './estimator-confidence.js';

export const MIN_SAMPLE_COUNT = 40;
const SAT_WEIGHT_FLOOR = 0.15;          // a fully-saturated pixel still contributes >=15% weight, never fully silenced
const DOMINANCE_WARN_RATIO = 0.45;
const DOMINANCE_SEVERE_RATIO = 0.65;
const SUFFICIENT_SAMPLE_COUNT = 400;    // accepted-sample count treated as "fully sufficient" for the sample-count confidence term
const SAT_DIVERSITY_FULL_STDDEV = 0.3;  // saturation stddev treated as "fully diverse" for the diversity confidence term

/**
 * @param {import('./wb-pixel-sampler.js').SampleResult} sample
 * @returns {import('./wb-estimator-schema.js').EstimatorResult}
 */
export function estimateGrayWorld(sample) {
  const accepted = sample?.accepted ?? [];
  const totalScanned = sample?.totalScanned ?? 0;

  if (accepted.length < MIN_SAMPLE_COUNT) {
    return unavailableResult(ESTIMATOR_ID.GRAY_WORLD, REJECTION_REASON.INSUFFICIENT_SAMPLE_COUNT, {
      sampleCount: totalScanned, acceptedPixelCount: accepted.length, rejectedPixelCount: totalScanned - accepted.length,
    });
  }

  let wSum = 0, rSum = 0, gSum = 0, bSum = 0;
  let lumMin = Infinity, lumMax = -Infinity, satMin = Infinity, satMax = -Infinity;

  for (const px of accepted) {
    const weight = Math.max(SAT_WEIGHT_FLOOR, 1 - px.sat);
    wSum += weight;
    rSum += px.r * weight; gSum += px.g * weight; bSum += px.b * weight;
    if (px.lum < lumMin) lumMin = px.lum;
    if (px.lum > lumMax) lumMax = px.lum;
    if (px.sat < satMin) satMin = px.sat;
    if (px.sat > satMax) satMax = px.sat;
  }

  const meanR = wSum > 0 ? rSum / wSum : 0;
  const meanG = wSum > 0 ? gSum / wSum : 0;
  const meanB = wSum > 0 ? bSum / wSum : 0;
  const gains = meanToNeutralGains(meanR, meanG, meanB);
  const { temperature, tint, gainR, gainG, gainB } = gainsToTempTint(gains);
  const castAxis = castAxisFromTempTint(temperature, tint);
  const castStrength = safeClamp(Math.sqrt(temperature ** 2 + tint ** 2) / 40, 0, 1);

  const { dominanceRatio, dominantHueDegrees } = hueDominance(accepted);
  const spatialCoverage = spatialCoverageOf(accepted, sample.width, sample.height);

  const meanSat = accepted.reduce((s, p) => s + p.sat, 0) / accepted.length;
  const satVar = accepted.reduce((s, p) => s + (p.sat - meanSat) ** 2, 0) / accepted.length;
  const satDiversity = safeClamp(Math.sqrt(satVar) / SAT_DIVERSITY_FULL_STDDEV, 0, 1);
  const sampleFactor = sampleCountFactor(accepted.length, SUFFICIENT_SAMPLE_COUNT);

  let confidence = safeClamp(
    0.30 * sampleFactor +
    0.25 * spatialCoverage +
    0.25 * satDiversity +
    0.20 * (1 - dominanceRatio),
    0, 1
  );

  const warnings = [];
  let status = ESTIMATOR_STATUS.OK;
  const domMultiplier = dominancePenaltyMultiplier(dominanceRatio, {
    warnRatio: DOMINANCE_WARN_RATIO, severeRatio: DOMINANCE_SEVERE_RATIO, warnMultiplier: 0.7, severeMultiplier: 0.4,
  });
  if (domMultiplier < 1) {
    confidence = safeClamp(confidence * domMultiplier, 0, 1);
    status = ESTIMATOR_STATUS.DEGRADED;
    const severity = domMultiplier <= 0.4 ? 'sharply' : '';
    warnings.push(`A single hue (~${Math.round(dominantHueDegrees ?? 0)}°, family "${hueDegreesToFamily(dominantHueDegrees)}") covers ${(dominanceRatio * 100).toFixed(0)}% of coloured accepted pixels — Gray World confidence reduced ${severity} to avoid treating an object colour as the scene illuminant.`.replace('  ', ' '));
  }
  if (spatialCoverage < 0.15) {
    warnings.push('Accepted pixels are spatially clustered in a small region of the frame — Gray World estimate may not represent the whole scene.');
  }

  return {
    estimatorId: ESTIMATOR_ID.GRAY_WORLD,
    status,
    confidence: +confidence.toFixed(3),
    estimate: {
      rgbGain: { r: gainR, g: gainG, b: gainB },
      temperatureIntent: temperature, tintIntent: tint,
      castAxis, castStrength: +castStrength.toFixed(3),
    },
    evidence: {
      sampleCount: totalScanned,
      acceptedPixelCount: accepted.length,
      rejectedPixelCount: totalScanned - accepted.length,
      luminanceRange: { min: Math.round(lumMin), max: Math.round(lumMax) },
      saturationRange: { min: +satMin.toFixed(3), max: +satMax.toFixed(3) },
      clippingRate: safeClamp((sample.rejectedCounts?.fullyClipped ?? 0) / Math.max(1, totalScanned), 0, 1),
      spatialCoverage: +spatialCoverage.toFixed(3),
    },
    diagnostics: {
      rejectionReason: null, warnings,
      dominanceRatio: +dominanceRatio.toFixed(3),
      dominantHueDegrees: dominantHueDegrees == null ? null : Math.round(dominantHueDegrees),
      dominantHueFamily: hueDegreesToFamily(dominantHueDegrees),
    },
  };
}
