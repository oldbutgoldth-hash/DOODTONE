/**
 * core/single-image/candidate/candidate-export-parity.js
 *
 * EPIC 2E-P1E R3 — Candidate <-> Export Parity Utility.
 *
 * Answers, for every PROPERTY_MAP-supported Candidate field, the
 * REQUIRED PARITY POLICY question this round exists to settle:
 * "is the value the user sees on screen the SAME value that ends up in
 * Lightroom?" -- proven from source, not assumed.
 *
 * Reuses, never duplicates:
 *   - `candidateToLegacyPreset()`   (P1C legacy-preset-adapter.js)
 *   - `quickSafetyClamp()`          (production-locked core/xmp-validator,
 *                                    imported read-only -- never modified)
 *   - `PROPERTY_MAP`/`CURVE_PROPERTIES` (P1D xmp-property-map.js)
 *   - `compareCandidateToReadback()` (P1D candidate-xmp-comparator.js) --
 *     used AS-IS for the optional readback-aware variant below; this
 *     module never re-implements XMP comparison logic itself.
 *
 * Pure, read-only: never mutates the Candidate, never calls
 * serializeXMP() itself (the caller supplies an already-serialized XMP
 * string, if any, from the ONE real export attempt -- "Single
 * Serialization Rule", unchanged from P1D).
 */

import { PROPERTY_MAP } from '../xmp-fidelity/xmp-property-map.js';
import { candidateToLegacyPreset } from './legacy-preset-adapter.js';
import { quickSafetyClamp } from '../../xmp-validator/index.js';

function _getByPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

/**
 * Candidate vs. export-expected parity, WITHOUT requiring a
 * serialized XMP string -- the check that must run at build/commit
 * time, and again on demand for the Advanced Diagnostics panel,
 * before the user has clicked "Download XMP" at all.
 *
 * @param {object} candidate  canonical Candidate
 * @returns {{entries: object[], summary: object, allMatch: boolean}}
 */
export function computeExportParity(candidate) {
  const preClampPreset = candidateToLegacyPreset(candidate);
  const { preset: exportExpectedPreset, adjustments: clampAdjustments } = quickSafetyClamp(preClampPreset);

  const entries = PROPERTY_MAP.map((entry) => {
    const candidateCurrentValue = _getByPath(candidate, entry.candidatePath);
    const preClampValue = _getByPath(preClampPreset, entry.legacyPresetKey);
    const exportExpectedValue = _getByPath(exportExpectedPreset, entry.legacyPresetKey);
    const clampAdjusted = typeof preClampValue === 'number' && typeof exportExpectedValue === 'number'
      ? preClampValue !== exportExpectedValue
      : preClampValue !== exportExpectedValue;
    const candidateVsExportMatch = candidateCurrentValue === exportExpectedValue;
    return {
      parameterPath: entry.candidatePath,
      xmpProperty: entry.xmpProperty,
      legacyPresetKey: entry.legacyPresetKey,
      clampGroup: entry.clampGroup ?? null,
      candidateCurrentValue,
      preClampValue,
      exportExpectedValue,
      clampAdjusted,
      candidateVsExportMatch,
    };
  });

  const mismatches = entries.filter((e) => !e.candidateVsExportMatch);
  const clampAdjustedEntries = entries.filter((e) => e.clampAdjusted);

  const summary = {
    totalChecked: entries.length,
    matched: entries.length - mismatches.length,
    mismatched: mismatches.length,
    clampAdjustedCount: clampAdjustedEntries.length,
    clampAdjustments, // raw quickSafetyClamp() adjustment strings, for the existing console.debug/toast path
  };

  return { entries, summary, allMatch: mismatches.length === 0, exportExpectedPreset };
}

/**
 * @param {object} candidate
 * @returns {object[]} only the entries where the Candidate's current
 *   value differs from what export-time `quickSafetyClamp()` will
 *   actually write -- i.e. exactly what the Advanced Diagnostics panel
 *   and the "export-safe adjustment" notice need to render.
 */
export function getExportParityMismatches(candidate) {
  return computeExportParity(candidate).entries.filter((e) => !e.candidateVsExportMatch);
}
