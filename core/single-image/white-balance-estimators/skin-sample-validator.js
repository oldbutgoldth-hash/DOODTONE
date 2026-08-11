/**
 * core/single-image/white-balance-estimators/skin-sample-validator.js
 *
 * EPIC 2E-P1I R2 -- Pixel Skin Validation and WB Correction Plausibility.
 *
 * Extracts a TRUSTED subset of skin-toned pixels from the SAME
 * `sample.accepted` list P1I's other six estimators already consumed
 * (no second pixel scan -- reuses the one sample the pipeline already
 * took, matching the "single shared sample pass" contract test 75 in
 * the R1 suite protects).
 *
 * Reuses wb-color-math.js's existing `isLikelySkinPixelYCbCr()` AS-IS
 * (the SAME formula already used a third time in this codebase, per
 * reuse-first -- see that function's own doc comment) to find candidate
 * skin pixels. This module does not build a face detector and does not
 * add any new skin-COLOR formula -- it only decides which of the
 * classifier's candidate pixels are trustworthy enough to use in a WB
 * correction plausibility check, and rejects the ones that are not:
 * clipped, implausibly saturated (colored/stage light on skin, not
 * natural skin tone), or sitting in the noisy near-shadow luminance
 * band just above the classifier's own Y>80 floor.
 *
 * No personal-attribute or ethnicity input exists anywhere in this
 * module. It operates only on r,g,b pixel values and the SAME
 * documented skin-tone chrominance band every other skin-aware module
 * in this codebase already uses.
 */

import {
  isLikelySkinPixelYCbCr, isAnyChannelClipped, saturationOf, luminance,
  safeClamp, spatialCoverageOf,
} from './wb-color-math.js';

export const SKIN_VALIDATOR_ESTIMATOR_ID = 'skinSampleValidator'; // diagnostics/trace label only -- never added to ESTIMATOR_ID (this is not a seventh WB-cast estimator, see module doc)

export const SKIN_REJECTION_REASON = Object.freeze({
  NO_SKIN_DETECTED: 'NO_SKIN_DETECTED',                             // isLikelySkinPixelYCbCr found nothing at all (includes deep-shadow skin below the classifier's own Y>80 floor, and colored/stage-lit skin whose Cb/Cr already falls outside the classifier's band)
  INSUFFICIENT_SKIN_SAMPLE_COUNT: 'INSUFFICIENT_SKIN_SAMPLE_COUNT',   // some candidates found, but too few survived rejection to trust
  INSUFFICIENT_SKIN_SPATIAL_COVERAGE: 'INSUFFICIENT_SKIN_SPATIAL_COVERAGE', // accepted skin pixels are real but too spatially concentrated (a few stray pixels, not a genuine skin region)
});

// -- Documented thresholds (calibrated against wb-color-math.js's real
// isLikelySkinPixelYCbCr()/saturationOf()/luminance() functions -- see
// P1I_R2_PIXEL_SKIN_VALIDATION_MODEL.md Calibration section for the exact
// numeric search used to derive each bound, not guessed values) --------

// Natural, well-lit skin (light/medium/deep tone, warm or neutral
// light) measured saturation tops out around 0.58 across the full
// tone range when computed via the SAME saturationOf() every other
// P1I estimator uses. A brute-force scan of every RGB triple that
// still passes isLikelySkinPixelYCbCr shows saturation CAN reach much
// higher (up to 1.0) for triples the chrominance band happens to also
// admit but that are not remotely skin-like (e.g. a near-zero-blue
// olive/orange value, or a strongly colored gel light landing just
// inside the band) -- this is exactly the gap this cap closes.
export const SKIN_SAT_MAX = 0.62;

// isLikelySkinPixelYCbCr() itself already requires Y>80 (true deep
// shadow never becomes a "candidate" at all -- see NO_SKIN_DETECTED
// above). This SECOND, higher floor additionally treats the narrow
// Y 80-95 band as too close to that classification boundary to trust
// for a WB-correction simulation (noisier, more sensor-floor-adjacent
// than genuinely well-exposed skin) -- distinct from, and stricter
// than, the classifier's own bound.
export const SKIN_SHADOW_LUM_MIN = 95;

export const MIN_SKIN_SAMPLE_COUNT = 40;         // fewer accepted skin pixels than this is a stray handful, not a trustworthy region
export const MIN_SKIN_SPATIAL_COVERAGE = 0.004;  // bbox-area fraction of frame (spatialCoverageOf()) below this is too concentrated/small to trust

/**
 * @typedef {Object} SkinSampleValidationResult
 * @property {string} status              'OK'|'DEGRADED'|'UNAVAILABLE'
 * @property {number} sampleQualityConfidence  0-1 -- how much the ACCEPTED sample itself supports trust (count + coverage + cleanliness), independent of any correction plausibility
 * @property {import('./wb-pixel-sampler.js').SampledPixel[]} acceptedPixels  internal -- consumed by skin-correction-plausibility.js, never serialized into the stored session bundle (see estimator-ensemble.js wiring)
 * @property {{candidateSkinPixels:number, acceptedSkinPixels:number, rejectedClipped:number, rejectedSaturated:number, rejectedLowLuminance:number, spatialCoverage:number}} sampleSummary
 * @property {string|null} rejectionReason
 * @property {string[]} warnings
 */

/**
 * @param {import('./wb-pixel-sampler.js').SampleResult} sample  the SAME sample object P1I's six estimators already received
 * @returns {SkinSampleValidationResult}
 */
export function extractValidatedSkinSamples(sample) {
  const accepted = sample?.accepted ?? [];
  const width = sample?.width ?? 0, height = sample?.height ?? 0;

  const candidates = accepted.filter(px => isLikelySkinPixelYCbCr(px.r, px.g, px.b));
  const candidateSkinPixels = candidates.length;

  if (candidateSkinPixels === 0) {
    return {
      status: 'UNAVAILABLE',
      sampleQualityConfidence: 0,
      acceptedPixels: [],
      sampleSummary: {
        candidateSkinPixels: 0, acceptedSkinPixels: 0,
        rejectedClipped: 0, rejectedSaturated: 0, rejectedLowLuminance: 0,
        spatialCoverage: 0,
      },
      rejectionReason: SKIN_REJECTION_REASON.NO_SKIN_DETECTED,
      warnings: [],
    };
  }

  let rejectedClipped = 0, rejectedSaturated = 0, rejectedLowLuminance = 0;
  const acceptedPixels = [];

  // Priority order (each pixel counted toward exactly ONE rejection
  // bucket, checked in this order): clipped first (an unrecoverable
  // highlight is disqualifying regardless of its saturation reading,
  // since clipping itself distorts the saturation computation), then
  // saturation (colored/stage light), then the stricter shadow floor.
  for (const px of candidates) {
    if (isAnyChannelClipped(px.r, px.g, px.b)) { rejectedClipped++; continue; }
    const sat = px.sat ?? saturationOf(px.r, px.g, px.b);
    if (sat > SKIN_SAT_MAX) { rejectedSaturated++; continue; }
    const lum = px.lum ?? luminance(px.r, px.g, px.b);
    if (lum < SKIN_SHADOW_LUM_MIN) { rejectedLowLuminance++; continue; }
    acceptedPixels.push(px);
  }

  const acceptedSkinPixels = acceptedPixels.length;
  const spatialCoverage = spatialCoverageOf(acceptedPixels, width, height);

  const sampleSummary = {
    candidateSkinPixels, acceptedSkinPixels,
    rejectedClipped, rejectedSaturated, rejectedLowLuminance,
    spatialCoverage: +spatialCoverage.toFixed(4),
  };

  if (acceptedSkinPixels < MIN_SKIN_SAMPLE_COUNT) {
    return {
      status: 'UNAVAILABLE', sampleQualityConfidence: 0, acceptedPixels: [],
      sampleSummary, rejectionReason: SKIN_REJECTION_REASON.INSUFFICIENT_SKIN_SAMPLE_COUNT, warnings: [],
    };
  }
  if (spatialCoverage < MIN_SKIN_SPATIAL_COVERAGE) {
    return {
      status: 'UNAVAILABLE', sampleQualityConfidence: 0, acceptedPixels: [],
      sampleSummary, rejectionReason: SKIN_REJECTION_REASON.INSUFFICIENT_SKIN_SPATIAL_COVERAGE, warnings: [],
    };
  }

  // sampleQualityConfidence: count factor + coverage factor + cleanliness
  // (fraction of CANDIDATES that survived, i.e. how little the region
  // needed clip/saturation/shadow rejection) -- same "compose from real
  // sample terms, never a fixed number" discipline every other P1I
  // confidence formula follows (estimator-confidence.js).
  const countFactor = safeClamp(acceptedSkinPixels / (MIN_SKIN_SAMPLE_COUNT * 3), 0, 1);
  const coverageFactor = safeClamp(spatialCoverage / (MIN_SKIN_SPATIAL_COVERAGE * 5), 0, 1);
  const cleanlinessFactor = safeClamp(acceptedSkinPixels / Math.max(1, candidateSkinPixels), 0, 1);
  const sampleQualityConfidence = safeClamp(
    0.40 * countFactor + 0.30 * coverageFactor + 0.30 * cleanlinessFactor, 0, 1
  );

  const warnings = [];
  const rejectedRatio = 1 - cleanlinessFactor;
  if (rejectedRatio >= 0.5) {
    warnings.push('More than half of candidate skin pixels were rejected (clipped/saturated/near-shadow) -- remaining sample is genuine but thin.');
  }

  return {
    status: sampleQualityConfidence >= 0.35 ? 'OK' : 'DEGRADED',
    sampleQualityConfidence: +sampleQualityConfidence.toFixed(3),
    acceptedPixels,
    sampleSummary,
    rejectionReason: null,
    warnings,
  };
}
