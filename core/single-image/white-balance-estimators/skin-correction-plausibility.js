/**
 * core/single-image/white-balance-estimators/skin-correction-plausibility.js
 *
 * EPIC 2E-P1I R2 -- Pixel Skin Validation and WB Correction Plausibility.
 *
 * Given a set of already-VALIDATED skin pixels (skin-sample-validator.js's
 * output) and the ensemble's PROPOSED correction (temperature/tint --
 * evidence only, never Candidate), simulates what that correction would
 * do to those pixel colors in a temporary, pure calculation, and scores
 * whether the result still looks like plausible skin.
 *
 * ── Ethnicity-neutral model, documented (spec requirement) ───────────
 * "Plausible skin" is NOT one fixed hue or one reference skin tone.
 * This module reuses the SAME 2-D YCbCr chrominance BAND
 * wb-color-math.js's isLikelySkinPixelYCbCr() already uses across the
 * whole codebase (Cb 77-127, Cr 133-173) -- a band, not a point, wide
 * enough to admit the full realistic range of human skin tones/melanin
 * levels at a given lighting condition, and the SAME band every other
 * skin-aware module already trusts for this exact purpose. Plausibility
 * is scored as how far INSIDE that band a pixel's chrominance sits
 * (continuous 0-1, not the classifier's own hard boolean), before vs.
 * after the proposed correction is applied. This never targets one
 * fixed hue and never takes an ethnicity/personal-attribute input --
 * only the pixel's own r,g,b values, exactly like the classifier it
 * reuses.
 *
 * ── Pure simulation only (spec requirement #4) ────────────────────────
 * `_inverseTempTintToGains()` below is a LOCAL, documented, approximate
 * inverse of wb-color-math.js's `gainsToTempTint()` -- used ONLY to
 * simulate the effect of a proposed correction on already-sampled pixel
 * colors for this plausibility check. It is never exported for reuse
 * by Candidate-writing code, never mutates any pixel/session data, and
 * has no relationship to how the real Preview/Candidate pipeline
 * ultimately renders a Temp/Tint adjustment -- see
 * P1I_R2_SKIN_CORRECTION_PLAUSIBILITY.md for the full derivation,
 * the documented residual degree of freedom (temp/tint compress 3 gain
 * channels into 2 scalars, so an exact inverse does not exist), and the
 * mean-gain-preserving convention chosen to resolve it, verified by a
 * round-trip test in the automated suite.
 */

import { extractValidatedSkinSamples } from './skin-sample-validator.js';
import { safeClamp, safeNumber } from './wb-color-math.js';

// ── Skin chrominance band (identical numbers to isLikelySkinPixelYCbCr's
// own Cb 77-127 / Cr 133-173 band -- expressed here as center+half-width
// for a continuous distance-to-center score rather than a hard boolean) ──
const CB_CENTER = 102, CB_HALF = 25;
const CR_CENTER = 153, CR_HALF = 20;
const Y_MIN = 80, Y_MAX = 235;
const OUT_OF_TONE_PENALTY = 0.5; // multiplicative penalty when luminance drifts outside the plausible skin tonal range after correction

const GAIN_MIN = 0.05, GAIN_MAX = 4; // simulation-only safety clamp on the SIMULATED correction gain -- unrelated to any Candidate/XMP export clamp

export const SUPPORT_TOLERANCE = 0.05;   // afterScore may drop by up to this much and still count as "supported" (measurement noise margin)
export const MIN_AFTER_SCORE_FLOOR = 0.30; // below this, skin looks implausible regardless of the before/after delta

export const MAX_CORROBORATION_BOOST = 0.15; // documented bound (spec item 18): plausibility corroboration alone can raise confidence at most this much above the sample-quality baseline
export const UNSUPPORTED_PENALTY_MULTIPLIER = 0.5; // an unsupported correction more than halves confidence -- reduces, never zeroes outright (skin still only ever REDUCES trust, see module doc)
export const CONFLICT_PENALTY_MULTIPLIER = 0.75;   // moderate additional reduction when skin disagrees with a confident neutral-region reading (spec item 9/17) -- never a full override

/**
 * Local, pure, documented-approximate inverse of gainsToTempTint().
 * See module doc for the derivation and the mean-gain-preserving
 * convention used to resolve the residual degree of freedom.
 */
function _inverseTempTintToGains(temperature, tint) {
  const t = safeNumber(temperature, 0);
  const n = safeNumber(tint, 0);
  const g = 1 - n / 22;
  const rbDiff = t / 28;
  const r = (3 - g + rbDiff * g) / 2;
  const b = (3 - g - rbDiff * g) / 2;
  return { r, g, b };
}

function _applyGain(px, gains) {
  return {
    r: safeClamp(px.r * gains.r, 0, 255),
    g: safeClamp(px.g * gains.g, 0, 255),
    b: safeClamp(px.b * gains.b, 0, 255),
  };
}

/** Continuous 0-1 "how centered inside the skin chrominance band" score -- never a fixed-hue target. */
function _skinBandScore(r, g, b) {
  const Y = 0.299 * r + 0.587 * g + 0.114 * b;
  const Cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
  const Cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  const cbDist = Math.abs(Cb - CB_CENTER) / CB_HALF;
  const crDist = Math.abs(Cr - CR_CENTER) / CR_HALF;
  let score = safeClamp(1 - Math.max(cbDist, crDist), 0, 1);
  if (Y < Y_MIN || Y > Y_MAX) score *= OUT_OF_TONE_PENALTY;
  return score;
}

/**
 * @param {{r:number,g:number,b:number}[]} acceptedPixels  skin-sample-validator.js's validated, accepted skin pixels
 * @param {{temperature:number,tint:number}} proposedCorrection  the ensemble's consensus (evidence only)
 * @param {{neutralRegionResult?:object|null}} [opts]
 * @returns {{beforeScore:number, afterScore:number, improvement:number, correctionSupported:boolean, conflictWithNeutral:boolean, warnings:string[]}}
 */
export function evaluateCorrectionPlausibility(acceptedPixels, proposedCorrection, opts = {}) {
  const n = acceptedPixels?.length ?? 0;
  const warnings = [];
  if (n === 0) {
    return { beforeScore: 0, afterScore: 0, improvement: 0, correctionSupported: false, conflictWithNeutral: false, warnings: ['no accepted skin pixels to evaluate'] };
  }

  const temperature = safeNumber(proposedCorrection?.temperature, 0);
  const tint = safeNumber(proposedCorrection?.tint, 0);
  const rawGains = _inverseTempTintToGains(temperature, tint);
  const gains = {
    r: safeClamp(rawGains.r, GAIN_MIN, GAIN_MAX),
    g: safeClamp(rawGains.g, GAIN_MIN, GAIN_MAX),
    b: safeClamp(rawGains.b, GAIN_MIN, GAIN_MAX),
  };
  const gainClamped = rawGains.r !== gains.r || rawGains.g !== gains.g || rawGains.b !== gains.b;
  if (gainClamped) {
    warnings.push('Proposed correction implies an extreme, out-of-range simulated gain -- clamped; this itself counts as evidence against plausibility.');
  }

  let beforeSum = 0, afterSum = 0;
  for (const px of acceptedPixels) {
    beforeSum += _skinBandScore(px.r, px.g, px.b);
    const corrected = _applyGain(px, gains);
    afterSum += _skinBandScore(corrected.r, corrected.g, corrected.b);
  }
  const beforeScore = beforeSum / n;
  const afterScore = afterSum / n;
  const improvement = afterScore - beforeScore;

  let correctionSupported = !gainClamped
    && afterScore >= (beforeScore - SUPPORT_TOLERANCE)
    && afterScore >= MIN_AFTER_SCORE_FLOOR;

  // Conflict-with-neutral (spec items 9/17): the neutral-region estimator
  // is itself confident, yet skin plausibility does NOT support the
  // (largely neutral-region-weighted, per estimator-ensemble.js's own
  // hierarchy) proposed correction. Recorded as a signal only -- see
  // validateSkinCorrection() below for how this is turned into a
  // MODERATE confidence reduction, never a full override.
  const neutralRegionResult = opts.neutralRegionResult ?? null;
  const neutralIsConfident = !!(neutralRegionResult && neutralRegionResult.estimate && Number.isFinite(neutralRegionResult.confidence) && neutralRegionResult.confidence >= 0.35);
  const conflictWithNeutral = neutralIsConfident && !correctionSupported;

  return {
    beforeScore: +beforeScore.toFixed(3),
    afterScore: +afterScore.toFixed(3),
    improvement: +improvement.toFixed(3),
    correctionSupported,
    conflictWithNeutral,
    warnings,
  };
}

/**
 * Top-level entrypoint: sample-validate then plausibility-evaluate,
 * assembled into the spec's stable result contract. This is the ONLY
 * function estimator-ensemble.js calls for skin validation.
 *
 * @param {import('./wb-pixel-sampler.js').SampleResult} sample
 * @param {{temperature:number,tint:number}} proposedCorrection
 * @param {{neutralRegionResult?:object|null}} [opts]
 * @returns {{status:string, confidence:number, sampleSummary:object, plausibility:object|null, rejectionReason:string|null, warnings:string[]}}
 */
export function validateSkinCorrection(sample, proposedCorrection, opts = {}) {
  const sampleResult = extractValidatedSkinSamples(sample);

  if (sampleResult.status === 'UNAVAILABLE') {
    return {
      status: 'UNAVAILABLE',
      confidence: 0,
      sampleSummary: sampleResult.sampleSummary,
      plausibility: null,
      rejectionReason: sampleResult.rejectionReason,
      warnings: sampleResult.warnings,
    };
  }

  const plausibility = evaluateCorrectionPlausibility(sampleResult.acceptedPixels, proposedCorrection, opts);

  // Confidence composition -- documented, bounded (spec items 17/18):
  // corroboration can only nudge confidence UP by a small, capped
  // amount; an unsupported correction more than halves it; a conflict
  // with a confident neutral-region reading applies one further,
  // moderate multiplicative reduction. Never a fixed number, never an
  // override of any other estimator.
  let confidence = sampleResult.sampleQualityConfidence;
  if (plausibility.correctionSupported) {
    const boost = safeClamp(plausibility.improvement, 0, MAX_CORROBORATION_BOOST);
    confidence = safeClamp(confidence + boost, 0, 1);
  } else {
    confidence = safeClamp(confidence * UNSUPPORTED_PENALTY_MULTIPLIER, 0, 1);
  }
  if (plausibility.conflictWithNeutral) {
    confidence = safeClamp(confidence * CONFLICT_PENALTY_MULTIPLIER, 0, 1);
  }

  const warnings = [...sampleResult.warnings, ...plausibility.warnings];
  if (plausibility.conflictWithNeutral) {
    warnings.push('Skin plausibility conflicts with a confident neutral-region reading -- confidence reduced moderately, not overridden.');
  }

  const status = plausibility.correctionSupported && confidence >= 0.35 ? 'OK' : 'DEGRADED';

  return {
    status,
    confidence: +confidence.toFixed(3),
    sampleSummary: sampleResult.sampleSummary,
    plausibility,
    rejectionReason: null,
    warnings,
  };
}

