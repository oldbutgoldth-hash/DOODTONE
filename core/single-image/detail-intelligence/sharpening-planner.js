/**
 * core/single-image/detail-intelligence/sharpening-planner.js
 *
 * EPIC 2E-P1G — computes the evidence-driven Sharpening recommendation.
 * Replaces the hardcoded `const sharp = 40;` literal in
 * core/lightroom-mapping-engine/index.js (see
 * P1G_DETAIL_VALUE_LINEAGE_AUDIT.md §3) with a bounded, scene-aware
 * value.
 *
 * Rules enforced here (see P1G_SHARPENING_POLICY.md for the full
 * rationale):
 *  - Never uses Sharpening to repair blur -- SOFT_FOCUS/MOTION_BLUR_RISK
 *    always route to the restrained NOISY_OR_SOFT bucket (0-18),
 *    regardless of how much "edge" evidence is present.
 *  - High measured noise reduces Sharpening (HIGH_NOISE also routes to
 *    NOISY_OR_SOFT).
 *  - Portraits (CLEAN_PORTRAIT/LOW_LIGHT_PORTRAIT) stay restrained
 *    relative to detailed/landscape imagery.
 *  - Skin coverage further reduces the position within whichever
 *    bucket was selected (never changes the bucket itself).
 *  - Strong P1F Texture/Clarity (candidate.basic.texture/.clarity)
 *    reduces additional Sharpening pressure -- coordination with P1F,
 *    never overwriting P1F's own fields (see
 *    P1G_P1F_DETAIL_COORDINATION_POLICY.md).
 */

import { SHARPENING_BUCKETS, STRENGTH_SCALARS, SKIN_HEAVY_COVERAGE_FRACTION } from './detail-schema.js';

function _selectBucket(flags) {
  if (flags.includes('SOFT_FOCUS') || flags.includes('MOTION_BLUR_RISK') || flags.includes('HIGH_NOISE') || flags.includes('LOW_CONFIDENCE')) {
    return { bucketName: 'NOISY_OR_SOFT', bucket: SHARPENING_BUCKETS.NOISY_OR_SOFT };
  }
  const isPortraitish = flags.includes('CLEAN_PORTRAIT') || flags.includes('LOW_LIGHT_PORTRAIT');
  if (isPortraitish && flags.includes('FINE_TEXTURE')) {
    return { bucketName: 'DETAILED_PORTRAIT_EVENT', bucket: SHARPENING_BUCKETS.DETAILED_PORTRAIT_EVENT };
  }
  if (flags.includes('CLEAN_HIGH_DETAIL') || (flags.includes('FINE_TEXTURE') && !isPortraitish)) {
    return { bucketName: 'LANDSCAPE_DETAIL', bucket: SHARPENING_BUCKETS.LANDSCAPE_DETAIL };
  }
  if (isPortraitish) {
    return { bucketName: 'CLEAN_PORTRAIT', bucket: SHARPENING_BUCKETS.CLEAN_PORTRAIT };
  }
  // LOW_DETAIL or an otherwise-unflagged clean image -- restrained default, never the top bucket.
  return { bucketName: 'CLEAN_PORTRAIT', bucket: SHARPENING_BUCKETS.CLEAN_PORTRAIT };
}

/**
 * @param {object} evidence   extractDetailEvidence().evidence
 * @param {string[]} flags    classifyDetailScene().flags
 * @param {{strengthMode?:string, p1fTexture?:number, p1fClarity?:number}} [opts]
 * @returns {{amount:number, bucket:string, rationale:string[], confidence:number, haloProtection:boolean, motionBlurProtection:boolean, skinReduced:boolean}}
 */
export function planSharpening(evidence, flags, { strengthMode = 'BALANCED', p1fTexture = 0, p1fClarity = 0 } = {}) {
  const rationale = [];
  const { bucketName, bucket } = _selectBucket(flags);
  const isRestrainedBucket = bucketName === 'NOISY_OR_SOFT';
  if (isRestrainedBucket) {
    if (flags.includes('SOFT_FOCUS') || flags.includes('MOTION_BLUR_RISK')) {
      rationale.push('Source sharpness is limited, so sharpening was reduced to avoid halos.');
    }
    if (flags.includes('HIGH_NOISE')) rationale.push('High measured noise -- sharpening restrained to avoid amplifying noise as false detail.');
  }

  let strength = 0.35 + 0.45 * evidence.edgeDensity + 0.25 * evidence.focusConfidence - 0.45 * evidence.luminanceNoise;

  const isSkinHeavy = typeof evidence.skinCoverage === 'number' && evidence.skinCoverage >= SKIN_HEAVY_COVERAGE_FRACTION;
  let skinReduced = false;
  if (isSkinHeavy) {
    const skinConfidence = typeof evidence.skinCoverage === 'number' ? 1 : 0.6;
    strength -= 0.15 + 0.2 * skinConfidence;
    skinReduced = true;
    rationale.push('High skin coverage -- global sharpening strength reduced to avoid crunchy/oversharpened skin texture.');
  }

  const p1fTextureClarityStrong = p1fTexture > 10 || p1fClarity > 8;
  if (p1fTextureClarityStrong) {
    strength -= 0.15;
    rationale.push(`P1F Texture/Clarity already strong (texture=${p1fTexture}, clarity=${p1fClarity}) -- additional sharpening pressure reduced to avoid stacked local-contrast accumulation.`);
  }

  strength = Math.max(0, Math.min(1, strength));
  const scalar = STRENGTH_SCALARS[strengthMode] ?? STRENGTH_SCALARS.BALANCED;
  const modeAdjusted = Math.max(0, Math.min(1, strength * scalar));

  const amount = Math.round(bucket.lo + (bucket.hi - bucket.lo) * modeAdjusted);
  rationale.push(`Bucket ${bucketName} [${bucket.lo}-${bucket.hi}], strength ${modeAdjusted.toFixed(2)} (mode ${strengthMode}) -> ${amount}.`);

  return {
    amount, bucket: bucketName, rationale,
    confidence: Math.max(0.2, 1 - evidence.luminanceNoise * 0.3),
    haloProtection: isRestrainedBucket,
    motionBlurProtection: flags.includes('MOTION_BLUR_RISK') || flags.includes('SOFT_FOCUS'),
    skinReduced,
  };
}
