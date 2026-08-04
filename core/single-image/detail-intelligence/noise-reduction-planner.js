/**
 * core/single-image/detail-intelligence/noise-reduction-planner.js
 *
 * EPIC 2E-P1G — computes the evidence-driven Luminance Noise Reduction
 * recommendation, replacing the `isPortrait ? 20 : 10` binary literal
 * in core/lightroom-mapping-engine/index.js (see
 * P1G_DETAIL_VALUE_LINEAGE_AUDIT.md §3).
 *
 * Also computes a Color Noise Reduction RECOMMENDATION for diagnostics
 * / lineage purposes only -- per the audit, the real serializer
 * hardcodes crs:ColorNoiseReduction="25" and never reads the Candidate,
 * so this recommendation is explicitly marked `supported: false` and
 * is NEVER written into an exported Candidate field by
 * candidate-builder.js. See P1G_SUPPORTED_XMP_DETAIL_FIELDS.md.
 */

import { STRENGTH_SCALARS, SKIN_HEAVY_COVERAGE_FRACTION } from './detail-schema.js';
import { selectNoiseBucket, estimateBaseNoiseStrength } from './noise-profile-estimator.js';

/**
 * @param {object} evidence   extractDetailEvidence().evidence
 * @param {string[]} flags    classifyDetailScene().flags
 * @param {{strengthMode?:string}} [opts]
 * @returns {object}
 */
export function planNoiseReduction(evidence, flags, { strengthMode = 'BALANCED' } = {}) {
  const rationale = [];
  const { bucketName, bucket } = selectNoiseBucket(evidence.luminanceNoise);

  let strength = estimateBaseNoiseStrength(evidence);
  rationale.push(`Bucket ${bucketName} [${bucket.lo}-${bucket.hi}] from measured luminance noise ${evidence.luminanceNoise.toFixed(2)}.`);

  if (evidence.shadowLiftRisk > 0) {
    rationale.push(`P1F shadow-lift risk (${evidence.shadowLiftRisk.toFixed(2)}) increases noise-reduction compensation -- lifted shadows reveal previously invisible sensor noise.`);
  }

  const isSkinHeavy = typeof evidence.skinCoverage === 'number' && evidence.skinCoverage >= SKIN_HEAVY_COVERAGE_FRACTION;
  if (isSkinHeavy) {
    strength -= 0.15;
    rationale.push('High skin coverage -- luminance NR restrained to avoid plastic-looking skin and loss of eyelash/hair/fabric detail.');
  }

  strength = Math.max(0, Math.min(1, strength));
  const scalar = STRENGTH_SCALARS[strengthMode] ?? STRENGTH_SCALARS.BALANCED;
  let modeAdjusted = Math.max(0, Math.min(1, strength * scalar));

  // Portrait NR ceiling -- even at the top of a bucket, a skin-heavy
  // image never reaches the bucket's own maximum, which is the
  // concrete anti-"plastic skin" guarantee independent of the strength
  // scalar above.
  let oversmoothingProtection = false;
  if (isSkinHeavy && modeAdjusted > 0.65) {
    modeAdjusted = 0.65;
    oversmoothingProtection = true;
    rationale.push('Portrait noise-reduction ceiling applied -- never reaches the bucket maximum on skin-heavy images.');
  }

  const luminance = Math.round(bucket.lo + (bucket.hi - bucket.lo) * modeAdjusted);

  // Color NR -- recommendation only, never exported (see module docblock).
  const colorRecommended = flags.includes('COLOR_NOISE')
    ? Math.round(luminance * 0.6)
    : Math.round(luminance * 0.3);

  return {
    luminance,
    color: {
      recommended: colorRecommended,
      supported: false,
      reason: 'crs:ColorNoiseReduction is hardcoded to "25" by core/preset-engine/index.js\'s serializeXMP() and never reads the Candidate -- Color Noise Reduction has no proven Candidate -> Legacy Preset -> Serializer -> XMP path. This recommendation is diagnostic-only.',
    },
    bucket: bucketName,
    rationale,
    confidence: Math.max(0.2, 1 - Math.abs(evidence.luminanceNoise - 0.3)),
    oversmoothingProtection,
    skinReduced: isSkinHeavy,
  };
}
