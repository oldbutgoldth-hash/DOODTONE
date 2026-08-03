/**
 * core/single-image/basic-tone-intelligence/basic-tone-lineage.js
 *
 * EPIC 2E-P1F — builds the Basic Tone Plan's own lightweight,
 * plan-level lineage/explainability record (distinct from the
 * Candidate-level per-parameter lineage core/single-image/candidate/
 * candidate-lineage.js already builds for every basic.* field). This
 * module answers "why did the Basic Tone layer produce this value?"
 * for a human reading the Advanced Diagnostics panel, in plain
 * language, without ever exposing raw XML or internal formulas.
 */

export function buildBasicToneLineage({ sceneClass, confidence, fieldRecommendations }) {
  const lineage = {};
  for (const [field, rec] of Object.entries(fieldRecommendations)) {
    lineage[field] = {
      value: rec.value,
      reason: rec.reason ?? null,
      sceneClass,
      evidenceConfidence: typeof rec.confidence === 'number' ? rec.confidence : confidence,
    };
  }
  return lineage;
}

/**
 * @returns {{engaged:boolean, reasons:string[], fieldsAdjusted:string[]}}
 */
export function summarizeBasicToneDiagnostics({ sceneClass, finalValues, guardrailAdjustments = [], classificationReasons = [] }) {
  const fieldsAdjusted = Object.entries(finalValues)
    .filter(([, v]) => Number.isFinite(v) && v !== 0)
    .map(([k]) => k);
  const engaged = fieldsAdjusted.length > 0;
  const reasons = [
    `Scene classified as ${sceneClass}.`,
    ...classificationReasons,
    ...(engaged ? [`${fieldsAdjusted.length} Basic field(s) adjusted: ${fieldsAdjusted.join(', ')}.`] : ['No Basic field required adjustment -- all kept at neutral 0.']),
    ...guardrailAdjustments,
  ];
  return { engaged, reasons, fieldsAdjusted };
}
