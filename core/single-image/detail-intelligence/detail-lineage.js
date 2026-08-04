/**
 * core/single-image/detail-intelligence/detail-lineage.js
 *
 * EPIC 2E-P1G — builds the Detail Plan's own lightweight,
 * plan-level lineage/explainability record for the Advanced
 * Diagnostics panel, mirroring
 * basic-tone-intelligence/basic-tone-lineage.js.
 */

import { FOCUS_LIMITED_TEXT } from './detail-schema.js';

export function buildDetailLineage({ sceneClass, confidence, sharpeningPlan, noiseReductionPlan }) {
  return {
    sharpening: {
      value: sharpeningPlan.amount, bucket: sharpeningPlan.bucket,
      reason: sharpeningPlan.rationale.join(' '), sceneClass,
      evidenceConfidence: sharpeningPlan.confidence ?? confidence,
    },
    noiseReductionLuminance: {
      value: noiseReductionPlan.luminance, bucket: noiseReductionPlan.bucket,
      reason: noiseReductionPlan.rationale.join(' '), sceneClass,
      evidenceConfidence: noiseReductionPlan.confidence ?? confidence,
    },
    colorNoiseReduction: {
      value: null, recommended: noiseReductionPlan.color.recommended, supported: false,
      reason: noiseReductionPlan.color.reason,
    },
  };
}

/**
 * @returns {{engaged:boolean, reasons:string[], focusLimited:boolean}}
 */
export function summarizeDetailDiagnostics({ sceneClass, flags, finalValues, guardrailAdjustments = [], classificationReasons = [], sharpeningRationale = [], noiseReductionRationale = [] }) {
  const engaged = finalValues.sharpening !== 0 || finalValues.noiseReductionLuminance !== 0;
  const focusLimited = flags.includes('SOFT_FOCUS') || flags.includes('MOTION_BLUR_RISK');
  const reasons = [
    `Scene flags: ${flags.join(', ')}.`,
    ...classificationReasons,
    ...sharpeningRationale,
    ...noiseReductionRationale,
    ...guardrailAdjustments,
  ];
  if (focusLimited) reasons.push(`${FOCUS_LIMITED_TEXT.en} / ${FOCUS_LIMITED_TEXT.th}`);
  return { engaged, reasons, focusLimited };
}
