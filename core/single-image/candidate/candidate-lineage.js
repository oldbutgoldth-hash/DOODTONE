/**
 * EPIC 2E-P1C — Candidate Lineage
 *
 * Per-parameter lineage entries: which evidence key(s)/Core module(s)
 * produced a value, whether a safety clamp was applied, the original
 * auto-generated value vs. the current (possibly manually edited)
 * value, and a confidence figure when one is available. Lineage never
 * carries image binary data or filenames.
 */

/**
 * @param {object} p
 * @param {string} p.parameterPath  e.g. "basic.highlights"
 * @param {string[]} p.evidenceKeys
 * @param {string[]} p.sourceModules
 * @param {number|null} p.rawRecommendation
 * @param {boolean} p.safetyClampApplied
 * @param {number|null} p.autoValue
 * @param {number|null} p.currentValue
 * @param {boolean} p.manuallyEdited
 * @param {number|null} p.confidence  0-100 or null
 */
export function buildParameterLineage({
  parameterPath, evidenceKeys = [], sourceModules = [], rawRecommendation = null,
  safetyClampApplied = false, autoValue = null, currentValue = null,
  manuallyEdited = false, confidence = null,
}) {
  return {
    parameterPath,
    evidenceKeys: [...evidenceKeys],
    sourceModules: [...sourceModules],
    rawRecommendation: rawRecommendation === undefined ? null : rawRecommendation,
    safetyClampApplied: !!safetyClampApplied,
    autoValue: autoValue === undefined ? null : autoValue,
    currentValue: currentValue === undefined ? null : currentValue,
    manuallyEdited: !!manuallyEdited,
    confidence: confidence === undefined ? null : confidence,
  };
}

/** Assemble a { parameterPath: lineageEntry } map, keyed by parameterPath. */
export function assembleLineageMap(entries) {
  const out = {};
  for (const e of entries) out[e.parameterPath] = e;
  return out;
}

/** Update just currentValue/manuallyEdited on an existing lineage entry (used by slider-adapter on a manual edit). Does not touch autoValue/rawRecommendation/evidenceKeys. */
export function markParameterEdited(lineageMap, parameterPath, newValue) {
  const existing = lineageMap[parameterPath];
  if (!existing) {
    lineageMap[parameterPath] = buildParameterLineage({
      parameterPath, currentValue: newValue, manuallyEdited: true,
    });
    return lineageMap;
  }
  lineageMap[parameterPath] = { ...existing, currentValue: newValue, manuallyEdited: true };
  return lineageMap;
}
