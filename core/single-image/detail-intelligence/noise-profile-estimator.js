/**
 * core/single-image/detail-intelligence/noise-profile-estimator.js
 *
 * EPIC 2E-P1G — pure noise-bucket selection + base strength estimate,
 * shared by noise-reduction-planner.js. Kept separate from the planner
 * so the "which bucket does this noise level fall into" question has
 * one, independently testable answer.
 */

import { NOISE_REDUCTION_BUCKETS, THRESHOLDS } from './detail-schema.js';

/**
 * @param {number} luminanceNoise  0-1
 * @returns {{bucketName:string, bucket:{lo:number,hi:number}}}
 */
export function selectNoiseBucket(luminanceNoise) {
  if (luminanceNoise < THRESHOLDS.mildNoiseFloor) return { bucketName: 'CLEAN', bucket: NOISE_REDUCTION_BUCKETS.CLEAN };
  if (luminanceNoise < THRESHOLDS.moderateNoiseFloor) return { bucketName: 'MILD', bucket: NOISE_REDUCTION_BUCKETS.MILD };
  if (luminanceNoise < THRESHOLDS.strongNoiseFloor) return { bucketName: 'MODERATE', bucket: NOISE_REDUCTION_BUCKETS.MODERATE };
  return { bucketName: 'STRONG', bucket: NOISE_REDUCTION_BUCKETS.STRONG };
}

/**
 * Base 0-1 position within the selected bucket, BEFORE skin/mode
 * adjustment. Increases with measured noise and with shadow-lift risk
 * (P1F's own noise-protection signal -- lifted shadows reveal sensor
 * noise that was previously invisible).
 *
 * @param {{luminanceNoise:number, shadowLiftRisk:number}} evidence
 * @returns {number} 0-1
 */
export function estimateBaseNoiseStrength({ luminanceNoise, shadowLiftRisk }) {
  const base = 0.15 + 0.75 * luminanceNoise + 0.25 * (shadowLiftRisk ?? 0);
  return Math.max(0, Math.min(1, base));
}
