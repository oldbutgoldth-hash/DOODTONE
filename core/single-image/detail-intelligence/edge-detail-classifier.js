/**
 * core/single-image/detail-intelligence/edge-detail-classifier.js
 *
 * EPIC 2E-P1G — classifies the non-exclusive Detail scene flags
 * (DETAIL_SCENE_FLAGS in detail-schema.js) from the evidence object
 * detail-evidence-extractor.js produced. An image may carry several
 * flags at once (e.g. LOW_LIGHT_PORTRAIT + HIGH_NOISE). Never derives
 * a flag from filename, UI state, or anything other than the passed
 * evidence object.
 */

import { THRESHOLDS, SKIN_HEAVY_COVERAGE_FRACTION } from './detail-schema.js';

/**
 * @param {object} evidence  the `.evidence` object from extractDetailEvidence() (must be `.ok`)
 * @returns {{flags: string[], reasons: string[]}}
 */
export function classifyDetailScene(evidence) {
  const flags = [];
  const reasons = [];
  const {
    luminanceNoise, chromaNoise, edgeDensity, fineDetailDensity,
    motionBlurRisk, focusConfidence, skinCoverage, lowLightConfidence,
  } = evidence;

  const isSkinHeavy = typeof skinCoverage === 'number' && skinCoverage >= SKIN_HEAVY_COVERAGE_FRACTION;

  if (edgeDensity >= THRESHOLDS.highDetailEdgeDensity && luminanceNoise < 0.25 && focusConfidence >= 0.7) {
    flags.push('CLEAN_HIGH_DETAIL');
    reasons.push(`High edge/detail evidence (${edgeDensity.toFixed(2)}) with low noise and strong focus confidence.`);
  }

  if (isSkinHeavy && luminanceNoise < 0.3 && focusConfidence >= 0.55 && lowLightConfidence < THRESHOLDS.lowLightConfidence) {
    flags.push('CLEAN_PORTRAIT');
    reasons.push('Skin-heavy image with clean, in-focus evidence.');
  }

  if (isSkinHeavy && (lowLightConfidence >= THRESHOLDS.lowLightConfidence || luminanceNoise >= 0.4)) {
    flags.push('LOW_LIGHT_PORTRAIT');
    reasons.push('Skin-heavy image with low-light and/or elevated-noise evidence.');
  }

  if (luminanceNoise >= THRESHOLDS.highNoise) {
    flags.push('HIGH_NOISE');
    reasons.push(`Measured luminance noise (${luminanceNoise.toFixed(2)}) at or above the high-noise threshold.`);
  }

  if (chromaNoise >= THRESHOLDS.colorNoise) {
    flags.push('COLOR_NOISE');
    reasons.push(`Estimated chroma-noise proxy (${chromaNoise.toFixed(2)}) elevated -- Color Noise Reduction export remains unsupported regardless (see P1G_SUPPORTED_XMP_DETAIL_FIELDS.md).`);
  }

  const uniformlySoft = focusConfidence < THRESHOLDS.lowFocusConfidence && motionBlurRisk < THRESHOLDS.motionBlurRisk;
  if (uniformlySoft) {
    flags.push('SOFT_FOCUS');
    reasons.push('Low focus confidence without a strong localized-blur signal -- treated as overall soft focus, not motion blur.');
  }

  if (motionBlurRisk >= THRESHOLDS.motionBlurRisk) {
    flags.push('MOTION_BLUR_RISK');
    reasons.push(`Blur-detection evidence (${motionBlurRisk.toFixed(2)}) at or above the motion-blur-risk threshold.`);
  }

  if (fineDetailDensity >= THRESHOLDS.fineTextureDensity && luminanceNoise < 0.4) {
    flags.push('FINE_TEXTURE');
    reasons.push('High fine-detail-density evidence with acceptable noise -- clothing/decorative-detail territory.');
  }

  if (edgeDensity < THRESHOLDS.lowDetailEdgeDensity && fineDetailDensity < THRESHOLDS.lowDetailEdgeDensity) {
    flags.push('LOW_DETAIL');
    reasons.push('Low edge and fine-detail-density evidence -- smooth/high-key-leaning image.');
  }

  if (flags.length === 0) {
    flags.push('LOW_CONFIDENCE');
    reasons.push('No specific Detail scene flag met its evidence threshold -- treated conservatively.');
  }

  return { flags, reasons };
}
