/**
 * EPIC 2E-P1D — Candidate ↔ XMP Comparator
 *
 * Compares the EXPORT-EXPECTED value (the value actually handed to
 * `serializeXMP()` -- i.e. AFTER `quickSafetyClamp()`, per the
 * "Expected Value Source" rule) against the parsed XMP readback for
 * every property in xmp-property-map.js, plus the four Tone Curve
 * channels. Never compares against the pre-clamp Candidate value --
 * that value is preserved separately (candidateOriginalValue) for
 * lineage/diagnostics only.
 *
 * Comparison results: MATCH, MATCH_WITH_TOLERANCE, MISSING, MISMATCH,
 * UNSUPPORTED, INVALID. Severity: CRITICAL (required, blocks) or
 * WARNING (optional/informational, never blocks).
 */

import { PROPERTY_MAP, CURVE_PROPERTIES, UNSUPPORTED_CANDIDATE_PATHS } from './xmp-property-map.js';
import { PARSE_STATUS } from './xmp-readback-schema.js';

export const COMPARISON_RESULT = Object.freeze({
  MATCH: 'MATCH',
  MATCH_WITH_TOLERANCE: 'MATCH_WITH_TOLERANCE',
  MISSING: 'MISSING',
  MISMATCH: 'MISMATCH',
  UNSUPPORTED: 'UNSUPPORTED',
  INVALID: 'INVALID',
});

const SEVERITY = Object.freeze({ CRITICAL: 'CRITICAL', WARNING: 'WARNING', INFO: 'INFO' });

// Float tolerance for the one field that round-trips through a decimal
// string (`crs:Exposure2012="(exp/100).toFixed(2)"`) -- expressed in
// the SAME "×100" integer slider units the comparator works in, so a
// tolerance of 1 covers the maximum possible single-unit rounding
// error from the .toFixed(2) string round-trip. Every other numeric
// field in the real serializer is an integer with no decimal
// formatting (see audit §7), so every other field uses exact (0)
// tolerance.
const EXPOSURE_TOLERANCE_SLIDER_UNITS = 1;

function _getByPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

/**
 * @param {object} params
 * @param {object} params.candidate            the full Candidate (for candidateOriginalValue lineage only)
 * @param {object} params.exportExpectedPreset  the flat preset object AFTER quickSafetyClamp() -- the actual serializeXMP() input
 * @param {object} params.readback              parseXmpReadback() output
 * @param {(temp:number)=>number} params.sliderToKelvin  injected from whitebalance-engine (no duplicate formula here)
 * @returns {{comparisons:object[], summary:object}}
 */
export function compareCandidateToReadback({ candidate, exportExpectedPreset, readback, sliderToKelvin }) {
  const comparisons = [];

  if (readback.parseStatus !== PARSE_STATUS.OK) {
    // No per-property comparison is meaningful against an unparseable
    // readback -- the gate reports PARSE_FAILED directly; the
    // comparator still returns an (empty) well-formed result rather
    // than throwing.
    return { comparisons, summary: _summarize(comparisons) };
  }

  for (const entry of PROPERTY_MAP) {
    const candidateOriginalValue = _getByPath(candidate, entry.candidatePath);
    const exportExpectedValue = _getByPath(exportExpectedPreset, entry.legacyPresetKey);
    const actualValue = _readbackScalar(readback, entry);

    comparisons.push(_compareScalar(entry, candidateOriginalValue, exportExpectedValue, actualValue, sliderToKelvin));
  }

  for (const curveEntry of CURVE_PROPERTIES) {
    comparisons.push(_compareCurve(curveEntry, exportExpectedPreset, readback));
  }

  for (const path of UNSUPPORTED_CANDIDATE_PATHS) {
    comparisons.push({
      candidatePath: path, xmpProperty: null, expected: null, actual: null,
      dataType: 'unsupported', tolerance: null,
      result: COMPARISON_RESULT.UNSUPPORTED, severity: SEVERITY.INFO,
      message: `"${path}" is not exported by the current XMP serializer (documented, not a fidelity failure).`,
    });
  }

  return { comparisons, summary: _summarize(comparisons) };
}

function _readbackScalar(readback, entry) {
  const parts = entry.candidatePath.split('.');
  if (parts[0] === 'basic') return readback.basic[parts[1]];
  if (parts[0] === 'whiteBalance') return readback.whiteBalance[parts[1]];
  if (parts[0] === 'detail') return readback.detail[parts[1]];
  if (parts[0] === 'curves' && parts[1] === 'parametric') return readback.curves.parametric[parts[2]];
  if (parts[0] === 'hsl') return readback.hsl[parts[1]][parts[2]];
  if (parts[0] === 'grading' && parts.length === 3) return readback.grading[parts[1]][parts[2]];
  if (parts[0] === 'grading' && parts[1] === 'blending') return readback.grading.blending;
  if (parts[0] === 'cal') return readback.cal[parts[1]];
  return undefined;
}

function _compareScalar(entry, candidateOriginalValue, exportExpectedValue, actualValue, sliderToKelvin) {
  const base = {
    candidatePath: entry.candidatePath, xmpProperty: entry.xmpProperty,
    candidateOriginalValue, dataType: entry.compareMode,
    tolerance: entry.compareMode === 'EXPOSURE_EV' ? EXPOSURE_TOLERANCE_SLIDER_UNITS : 0,
  };

  if (actualValue === null || actualValue === undefined) {
    return { ...base, expected: exportExpectedValue, actual: null, result: COMPARISON_RESULT.MISSING, severity: SEVERITY.CRITICAL, message: `Required property "${entry.xmpProperty}" is missing from the generated XMP.` };
  }
  if (typeof actualValue === 'number' && (Number.isNaN(actualValue) || !Number.isFinite(actualValue))) {
    return { ...base, expected: exportExpectedValue, actual: actualValue, result: COMPARISON_RESULT.INVALID, severity: SEVERITY.CRITICAL, message: `"${entry.xmpProperty}" parsed to a non-finite number.` };
  }

  let expected = exportExpectedValue;
  let actual = actualValue;

  if (entry.compareMode === 'TEMPERATURE_KELVIN') {
    // Compare in Kelvin space (the XMP's own unit) -- forward-convert
    // the post-clamp slider value using the SAME formula the real
    // serializer uses (injected, never duplicated here).
    expected = sliderToKelvin(exportExpectedValue);
  } else if (entry.compareMode === 'EXPOSURE_EV') {
    // Both sides compared in "×100 slider units" -- actual was already
    // converted back via Math.round(parseFloat(s)*100) by the parser.
    expected = exportExpectedValue;
  }

  const diff = Math.abs(Number(expected) - Number(actual));
  if (diff === 0) {
    return { ...base, expected, actual, result: COMPARISON_RESULT.MATCH, severity: SEVERITY.INFO, message: null };
  }
  if (diff <= base.tolerance) {
    return { ...base, expected, actual, result: COMPARISON_RESULT.MATCH_WITH_TOLERANCE, severity: SEVERITY.INFO, message: `Within tolerance (Δ${diff} ≤ ${base.tolerance}).` };
  }
  return { ...base, expected, actual, result: COMPARISON_RESULT.MISMATCH, severity: SEVERITY.CRITICAL, message: `"${entry.xmpProperty}" expected ${expected}, got ${actual} (Δ${diff}).` };
}

function _compareCurve(curveEntry, exportExpectedPreset, readback) {
  const base = { candidatePath: curveEntry.candidatePath, xmpProperty: curveEntry.xmpProperty, dataType: 'CURVE_ARRAY', tolerance: 0 };
  const readbackCurve = readback.curves[curveEntry.curveChannel];

  if (readbackCurve === null || readbackCurve === undefined) {
    return { ...base, expected: null, actual: null, result: COMPARISON_RESULT.MISSING, severity: SEVERITY.CRITICAL, message: `Tone Curve "${curveEntry.xmpProperty}" is missing from the generated XMP.` };
  }
  if (!Array.isArray(readbackCurve)) {
    return { ...base, expected: null, actual: readbackCurve, result: COMPARISON_RESULT.INVALID, severity: SEVERITY.CRITICAL, message: `Tone Curve "${curveEntry.xmpProperty}" failed to parse (${readbackCurve.reason ?? 'invalid'}).` };
  }

  // Expected points: what the serializer actually rounded/serialized
  // (curves.master with per-channel fallback to master), matching
  // core/preset-engine/index.js::_curveStr exactly.
  const curves = exportExpectedPreset.curves ?? null;
  const expectedPoints = _expectedCurvePoints(curves, curveEntry.legacyPresetKey);

  if (expectedPoints.length !== readbackCurve.length) {
    return { ...base, expected: expectedPoints, actual: readbackCurve, result: COMPARISON_RESULT.MISMATCH, severity: SEVERITY.CRITICAL, message: `Tone Curve "${curveEntry.xmpProperty}" point count mismatch (expected ${expectedPoints.length}, got ${readbackCurve.length}).` };
  }
  for (let i = 0; i < expectedPoints.length; i++) {
    const e = expectedPoints[i], a = readbackCurve[i];
    if (Math.round(e.x) !== a.x || Math.round(e.y) !== a.y) {
      return { ...base, expected: expectedPoints, actual: readbackCurve, result: COMPARISON_RESULT.MISMATCH, severity: SEVERITY.CRITICAL, message: `Tone Curve "${curveEntry.xmpProperty}" point ${i} mismatch: expected (${Math.round(e.x)},${Math.round(e.y)}), got (${a.x},${a.y}).` };
    }
  }
  return { ...base, expected: expectedPoints, actual: readbackCurve, result: COMPARISON_RESULT.MATCH, severity: SEVERITY.INFO, message: null };
}

function _expectedCurvePoints(curves, channel) {
  // Mirrors core/preset-engine/index.js::_curveStr exactly: default
  // linear set when the whole `curves` object is null, then per-
  // channel fallback to master.
  const DEFAULT_LINEAR = [{ x: 0, y: 0 }, { x: 255, y: 255 }];
  if (!curves) return DEFAULT_LINEAR;
  const master = curves.master ?? DEFAULT_LINEAR;
  return curves[channel] ?? master;
}

function _summarize(comparisons) {
  const summary = { totalCompared: comparisons.length, matched: 0, mismatched: 0, missing: 0, unsupported: 0, warnings: 0 };
  for (const c of comparisons) {
    if (c.result === COMPARISON_RESULT.MATCH) summary.matched++;
    else if (c.result === COMPARISON_RESULT.MATCH_WITH_TOLERANCE) { summary.matched++; summary.warnings++; }
    else if (c.result === COMPARISON_RESULT.MISSING) summary.missing++;
    else if (c.result === COMPARISON_RESULT.MISMATCH || c.result === COMPARISON_RESULT.INVALID) summary.mismatched++;
    else if (c.result === COMPARISON_RESULT.UNSUPPORTED) summary.unsupported++;
  }
  summary.passRate = summary.totalCompared > 0 ? +((summary.matched / summary.totalCompared).toFixed(4)) : 1;
  return summary;
}
