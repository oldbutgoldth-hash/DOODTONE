/**
 * core/single-image/white-balance-estimators/highlight-shadow-illuminant-estimator.js
 *
 * EPIC 2E-P1I — separately measures the chromatic tendency of the
 * scene's highlight band and shadow band, so mixed lighting (warm
 * tungsten interior + cool window daylight, for example) can be
 * DETECTED as a real disagreement between two independently-measured
 * illuminant readings, rather than inferred only from the existing
 * color-cast-detector's shadow/highlight LABEL comparison (which has
 * no confidence-weighted magnitude comparison of its own).
 *
 * This module does NOT decide how to correct a mixed-light scene —
 * that remains P1H's job. It only produces the two independent
 * readings plus a comparison summary; the ensemble
 * (estimator-ensemble.js) and P1H both consume that summary.
 */

import { ESTIMATOR_ID, ESTIMATOR_STATUS, REJECTION_REASON, unavailableResult } from './wb-estimator-schema.js';
import {
  meanToNeutralGains, gainsToTempTint, castAxisFromTempTint, safeClamp,
  isAnyChannelClipped, spatialCoverageOf, hueDominance,
} from './wb-color-math.js';
import { sampleCountFactor } from './estimator-confidence.js';

const MIN_BAND_SAMPLES = 25;
const SAT_CAP = 0.25; // illuminant chromaticity bands allow slightly more saturation than a strict "neutral" filter (shadows/highlights aren't pure gray) but still reject clearly object-coloured pixels
const SUFFICIENT_BAND_SAMPLES = 200;

function _percentile(sortedAsc, p) {
  if (!sortedAsc.length) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.floor(p * (sortedAsc.length - 1))));
  return sortedAsc[idx];
}

function _bandGains(pixels) {
  const n = pixels.length;
  const meanR = pixels.reduce((s, p) => s + p.r, 0) / n;
  const meanG = pixels.reduce((s, p) => s + p.g, 0) / n;
  const meanB = pixels.reduce((s, p) => s + p.b, 0) / n;
  return meanToNeutralGains(meanR, meanG, meanB);
}

function _lumStdDev(pixels) {
  const n = pixels.length;
  const mean = pixels.reduce((s, p) => s + p.lum, 0) / n;
  return Math.sqrt(pixels.reduce((s, p) => s + (p.lum - mean) ** 2, 0) / n);
}

/**
 * @param {import('./wb-pixel-sampler.js').SampleResult} sample
 * @returns {import('./wb-estimator-schema.js').EstimatorResult}
 */
export function estimateHighlightIlluminant(sample) {
  const accepted = sample?.accepted ?? [];
  const totalScanned = sample?.totalScanned ?? 0;
  if (accepted.length < MIN_BAND_SAMPLES) {
    return unavailableResult(ESTIMATOR_ID.HIGHLIGHT, REJECTION_REASON.INSUFFICIENT_SAMPLE_COUNT, { sampleCount: totalScanned });
  }
  const lumsSorted = accepted.map(p => p.lum).sort((a, b) => a - b);
  const threshold = _percentile(lumsSorted, 0.67);
  const band = accepted.filter(p => p.lum >= threshold);
  const nonClipped = band.filter(p => !isAnyChannelClipped(p.r, p.g, p.b));

  if (band.length > 0 && nonClipped.length < MIN_BAND_SAMPLES) {
    const clippingRate = safeClamp(1 - nonClipped.length / Math.max(1, band.length), 0, 1);
    if (nonClipped.length === 0) {
      return unavailableResult(ESTIMATOR_ID.HIGHLIGHT, REJECTION_REASON.HIGHLIGHTS_CLIPPED, {
        sampleCount: totalScanned, acceptedPixelCount: accepted.length, clippingRate,
      });
    }
  }
  if (nonClipped.length < MIN_BAND_SAMPLES) {
    return unavailableResult(ESTIMATOR_ID.HIGHLIGHT, REJECTION_REASON.INSUFFICIENT_SPATIAL_COVERAGE, {
      sampleCount: totalScanned, acceptedPixelCount: nonClipped.length,
    });
  }
  const meanSat = nonClipped.reduce((s, p) => s + p.sat, 0) / nonClipped.length;
  if (meanSat > SAT_CAP) {
    return unavailableResult(ESTIMATOR_ID.HIGHLIGHT, REJECTION_REASON.HIGHLIGHTS_TOO_SATURATED, {
      sampleCount: totalScanned, acceptedPixelCount: nonClipped.length, saturationRange: { min: 0, max: +meanSat.toFixed(3) },
    });
  }

  const gains = _bandGains(nonClipped);
  const { temperature, tint, gainR, gainG, gainB } = gainsToTempTint(gains);
  const castAxis = castAxisFromTempTint(temperature, tint);
  const castStrength = safeClamp(Math.sqrt(temperature ** 2 + tint ** 2) / 40, 0, 1);
  const clippingRate = safeClamp((band.length - nonClipped.length) / Math.max(1, band.length), 0, 1);
  const spatialCoverage = spatialCoverageOf(nonClipped, sample.width, sample.height);
  const sampleFactor = sampleCountFactor(nonClipped.length, SUFFICIENT_BAND_SAMPLES);

  let confidence = safeClamp(
    0.35 * sampleFactor +
    0.30 * (1 - clippingRate) +
    0.20 * spatialCoverage +
    0.15 * (1 - meanSat / SAT_CAP),
    0, 1
  );
  const status = clippingRate > 0.3 ? ESTIMATOR_STATUS.DEGRADED : ESTIMATOR_STATUS.OK;
  const warnings = clippingRate > 0.3 ? [`${(clippingRate * 100).toFixed(0)}% of the highlight band is clipped — highlight illuminant confidence reduced.`] : [];

  return {
    estimatorId: ESTIMATOR_ID.HIGHLIGHT,
    status,
    confidence: +confidence.toFixed(3),
    estimate: { rgbGain: { r: gainR, g: gainG, b: gainB }, temperatureIntent: temperature, tintIntent: tint, castAxis, castStrength: +castStrength.toFixed(3) },
    evidence: {
      sampleCount: totalScanned, acceptedPixelCount: nonClipped.length, rejectedPixelCount: totalScanned - nonClipped.length,
      luminanceRange: { min: Math.round(threshold), max: Math.round(lumsSorted[lumsSorted.length - 1]) },
      saturationRange: { min: 0, max: +meanSat.toFixed(3) },
      clippingRate: +clippingRate.toFixed(3), spatialCoverage: +spatialCoverage.toFixed(3),
    },
    diagnostics: { rejectionReason: null, warnings },
  };
}

/**
 * @param {import('./wb-pixel-sampler.js').SampleResult} sample
 * @returns {import('./wb-estimator-schema.js').EstimatorResult}
 */
export function estimateShadowIlluminant(sample) {
  const accepted = sample?.accepted ?? [];
  const totalScanned = sample?.totalScanned ?? 0;
  if (accepted.length < MIN_BAND_SAMPLES) {
    return unavailableResult(ESTIMATOR_ID.SHADOW, REJECTION_REASON.INSUFFICIENT_SAMPLE_COUNT, { sampleCount: totalScanned });
  }
  const lumsSorted = accepted.map(p => p.lum).sort((a, b) => a - b);
  const threshold = _percentile(lumsSorted, 0.33);
  const band = accepted.filter(p => p.lum <= threshold);
  if (band.length < MIN_BAND_SAMPLES) {
    return unavailableResult(ESTIMATOR_ID.SHADOW, REJECTION_REASON.INSUFFICIENT_SPATIAL_COVERAGE, {
      sampleCount: totalScanned, acceptedPixelCount: band.length,
    });
  }
  const meanSat = band.reduce((s, p) => s + p.sat, 0) / band.length;
  if (meanSat > SAT_CAP) {
    return unavailableResult(ESTIMATOR_ID.SHADOW, REJECTION_REASON.HIGHLIGHTS_TOO_SATURATED, {
      sampleCount: totalScanned, acceptedPixelCount: band.length, saturationRange: { min: 0, max: +meanSat.toFixed(3) },
    });
  }

  // Shadow-specific noise proxy: luminance stddev relative to the
  // band's own dynamic range — dark, low-light regions are inherently
  // noisier (sensor read noise dominates at low signal), and a wide
  // internal luminance spread inside what should be a tight shadow
  // band is the signature of that noise.
  const lumStdDev = _lumStdDev(band);
  const bandRange = Math.max(1, threshold - lumsSorted[0]);
  const noiseRatio = safeClamp(lumStdDev / bandRange, 0, 1);

  const gains = _bandGains(band);
  const { temperature, tint, gainR, gainG, gainB } = gainsToTempTint(gains);
  const castAxis = castAxisFromTempTint(temperature, tint);
  const castStrength = safeClamp(Math.sqrt(temperature ** 2 + tint ** 2) / 40, 0, 1);
  const spatialCoverage = spatialCoverageOf(band, sample.width, sample.height);
  const sampleFactor = sampleCountFactor(band.length, SUFFICIENT_BAND_SAMPLES);

  let confidence = safeClamp(
    0.35 * sampleFactor +
    0.30 * (1 - noiseRatio) +
    0.20 * spatialCoverage +
    0.15 * (1 - meanSat / SAT_CAP),
    0, 1
  );
  let status = ESTIMATOR_STATUS.OK;
  const warnings = [];
  if (noiseRatio > 0.55) {
    confidence = safeClamp(confidence * 0.6, 0, 1);
    status = ESTIMATOR_STATUS.DEGRADED;
    warnings.push(`Shadow band shows high internal luminance noise (ratio ${noiseRatio.toFixed(2)}) — shadow illuminant confidence reduced.`);
  }

  return {
    estimatorId: ESTIMATOR_ID.SHADOW,
    status,
    confidence: +confidence.toFixed(3),
    estimate: { rgbGain: { r: gainR, g: gainG, b: gainB }, temperatureIntent: temperature, tintIntent: tint, castAxis, castStrength: +castStrength.toFixed(3) },
    evidence: {
      sampleCount: totalScanned, acceptedPixelCount: band.length, rejectedPixelCount: totalScanned - band.length,
      luminanceRange: { min: Math.round(lumsSorted[0]), max: Math.round(threshold) },
      saturationRange: { min: 0, max: +meanSat.toFixed(3) },
      clippingRate: 0, spatialCoverage: +spatialCoverage.toFixed(3),
    },
    diagnostics: { rejectionReason: null, warnings, noiseRatio: +noiseRatio.toFixed(3) },
  };
}

const MIXED_LIGHT_VECTOR_THRESHOLD = 18; // temp/tint vector distance above which two illuminant readings are considered incompatible
const MIXED_LIGHT_MIN_CONFIDENCE = 0.3;  // both readings must clear this confidence floor to corroborate a mixed-light claim

/**
 * Compares the highlight and shadow illuminant readings and returns a
 * bounded mixed-light evidence summary. Does NOT decide any
 * correction — purely descriptive evidence for the ensemble/P1H.
 *
 * @param {import('./wb-estimator-schema.js').EstimatorResult} highlightResult
 * @param {import('./wb-estimator-schema.js').EstimatorResult} shadowResult
 */
export function compareIlluminants(highlightResult, shadowResult) {
  const hOk = highlightResult?.estimate && highlightResult.confidence >= MIXED_LIGHT_MIN_CONFIDENCE;
  const sOk = shadowResult?.estimate && shadowResult.confidence >= MIXED_LIGHT_MIN_CONFIDENCE;
  if (!hOk || !sOk) {
    return {
      compatible: true, isMixedLight: false, score: 0, vectorDistance: 0,
      reason: 'insufficient confidence in one or both bands to compare',
    };
  }
  const dt = highlightResult.estimate.temperatureIntent - shadowResult.estimate.temperatureIntent;
  const dn = highlightResult.estimate.tintIntent - shadowResult.estimate.tintIntent;
  const vectorDistance = Math.sqrt(dt ** 2 + dn ** 2);
  const axisMismatch = highlightResult.estimate.castAxis !== 'neutral'
    && shadowResult.estimate.castAxis !== 'neutral'
    && highlightResult.estimate.castAxis !== shadowResult.estimate.castAxis;

  const isMixedLight = vectorDistance >= MIXED_LIGHT_VECTOR_THRESHOLD || (axisMismatch && vectorDistance >= MIXED_LIGHT_VECTOR_THRESHOLD * 0.6);
  const score = safeClamp(vectorDistance / (MIXED_LIGHT_VECTOR_THRESHOLD * 2), 0, 1);

  return {
    compatible: !isMixedLight,
    isMixedLight,
    score: +score.toFixed(3),
    vectorDistance: +vectorDistance.toFixed(2),
    axisMismatch,
    reason: isMixedLight
      ? `Highlight (${highlightResult.estimate.castAxis}) and shadow (${shadowResult.estimate.castAxis}) illuminant readings diverge (distance ${vectorDistance.toFixed(1)}) — evidence of mixed lighting.`
      : 'Highlight and shadow illuminant readings are compatible.',
  };
}
