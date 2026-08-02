/**
 * EPIC 2E-P1D — XMP Fidelity Report
 *
 * Builds the serializable Fidelity Report object from a comparator
 * result. Pure data assembly -- no comparison logic, no parsing, no
 * session/DOM access.
 */

import { COMPARISON_RESULT } from './candidate-xmp-comparator.js';

export const FIDELITY_STATUS = Object.freeze({
  NOT_RUN: 'NOT_RUN',
  RUNNING: 'RUNNING',
  PASS: 'PASS',
  PASS_WITH_WARNINGS: 'PASS_WITH_WARNINGS',
  FAIL: 'FAIL',
  PARSE_FAILED: 'PARSE_FAILED',
  STALE: 'STALE',
});

let _reportSeq = 0;
function _nextReportId() {
  _reportSeq += 1;
  return `xmpfid_${Date.now().toString(36)}_${_reportSeq}`;
}

/**
 * @param {object} params
 * @param {string} params.candidateId
 * @param {string} params.sessionId
 * @param {number} params.generationId
 * @param {number} params.candidateRevision
 * @param {string} params.status                one of FIDELITY_STATUS
 * @param {{comparisons:object[], summary:object}} params.comparisonResult
 * @param {object} params.readback               parseXmpReadback() output
 * @param {number} params.durationMs
 * @param {string|null} params.errorCode
 * @param {string|null} params.errorMessage
 * @param {number} params.xmpLength
 * @returns {object} Fidelity Report (see P1D spec's exact contract)
 */
export function buildFidelityReport({
  candidateId, sessionId, generationId, candidateRevision, status,
  comparisonResult, readback, durationMs, errorCode = null, errorMessage = null,
  xmpLength = 0, sourceSessionStatus = null,
}) {
  const comparisons = comparisonResult?.comparisons ?? [];
  const summary = comparisonResult?.summary ?? { totalCompared: 0, matched: 0, mismatched: 0, missing: 0, unsupported: 0, warnings: 0, passRate: 0 };

  const mismatches = comparisons.filter((c) => c.result === COMPARISON_RESULT.MISMATCH || c.result === COMPARISON_RESULT.INVALID);
  const missingRequired = comparisons.filter((c) => c.result === COMPARISON_RESULT.MISSING);
  const unsupportedParameters = comparisons.filter((c) => c.result === COMPARISON_RESULT.UNSUPPORTED);
  const warnings = comparisons.filter((c) => c.result === COMPARISON_RESULT.MATCH_WITH_TOLERANCE);

  return {
    fidelityReportId: _nextReportId(),
    candidateId: candidateId ?? null,
    sessionId: sessionId ?? null,
    generationId: generationId ?? null,
    candidateRevision: candidateRevision ?? null,
    schemaVersion: 'P1D_XMP_FIDELITY_REPORT@1',
    status,
    createdAt: Date.now(),
    summary: {
      totalCompared: summary.totalCompared,
      matched: summary.matched,
      mismatched: summary.mismatched,
      missing: summary.missing,
      unsupported: summary.unsupported,
      warnings: summary.warnings,
      passRate: summary.passRate,
    },
    comparisons,
    mismatches,
    missingRequired,
    unsupportedParameters,
    warnings,
    serializer: {
      xmpLength,
      namespaceVersion: readback?.namespaces?.crs ?? null,
      processVersion: readback?.profile?.processVersion ?? null,
    },
    readback: {
      parseStatus: readback?.parseStatus ?? 'NOT_RUN',
      parserWarnings: readback?.diagnostics?.parserWarnings ?? [],
      parserErrors: readback?.diagnostics?.parserErrors ?? [],
    },
    diagnostics: {
      durationMs,
      candidateStatus: null, // filled by caller (orchestrator) which has the live Candidate status
      sourceSessionStatus,
      errorCode,
      errorMessage,
    },
  };
}
