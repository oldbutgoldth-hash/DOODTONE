/**
 * EPIC 2E-P1D — XMP Fidelity Gate
 *
 * Pure function: given a Candidate, the post-clamp export preset
 * ALREADY handed to `serializeXMP()`, and the XMP string that call
 * produced, runs the readback parser + comparator and decides
 * PASS / PASS_WITH_WARNINGS / FAIL. Never re-serializes (the caller
 * passes in the one-and-only XMP string already generated for this
 * download attempt -- see the Single Serialization Rule in
 * P1D_XMP_FIDELITY_GATE_POLICY.md), never mutates the Candidate, never
 * triggers analysis, never touches Session/DOM/trace -- those are the
 * orchestrator wrapper's job (`single-image-orchestrator.js::
 * runXmpFidelityCheck`), matching this project's established pure-
 * core/traced-orchestrator split (candidate-builder.js vs
 * single-image-orchestrator.js).
 */

import { parseXmpReadback } from './xmp-readback-parser.js';
import { compareCandidateToReadback, COMPARISON_RESULT } from './candidate-xmp-comparator.js';
import { buildFidelityReport, FIDELITY_STATUS } from './xmp-fidelity-report.js';
import { PARSE_STATUS } from './xmp-readback-schema.js';
import { sliderToKelvin } from '../../whitebalance-engine/index.js';

export const FIDELITY_ERROR_CODE = Object.freeze({
  NO_EXPORT_READY_CANDIDATE: 'NO_EXPORT_READY_CANDIDATE',
  STALE_CANDIDATE: 'STALE_CANDIDATE',
  SERIALIZATION_FAILED: 'SERIALIZATION_FAILED',
  XMP_TOO_LARGE: 'XMP_TOO_LARGE',
  XML_PARSE_FAILED: 'XML_PARSE_FAILED',
  REQUIRED_PROPERTY_MISSING: 'REQUIRED_PROPERTY_MISSING',
  PROPERTY_VALUE_MISMATCH: 'PROPERTY_VALUE_MISMATCH',
  INVALID_CURVE: 'INVALID_CURVE',
  CANDIDATE_REVISION_MISMATCH: 'CANDIDATE_REVISION_MISMATCH',
  UNKNOWN_FIDELITY_ERROR: 'UNKNOWN_FIDELITY_ERROR',
});

/**
 * @param {object} params
 * @param {object} params.candidate            the validated Candidate this export used
 * @param {object} params.exportExpectedPreset  flat preset AFTER quickSafetyClamp() -- the exact serializeXMP() input
 * @param {string} params.xmpString             the exact string serializeXMP() returned (parsed as-is, never re-serialized)
 * @returns {{status:string, report:object}}
 */
export function runXmpFidelityGate({ candidate, exportExpectedPreset, xmpString }) {
  const startedAt = Date.now();

  if (!candidate) {
    return {
      status: FIDELITY_STATUS.FAIL,
      report: buildFidelityReport({
        candidateId: null, sessionId: null, generationId: null, candidateRevision: null,
        status: FIDELITY_STATUS.FAIL, comparisonResult: null, readback: null,
        durationMs: Date.now() - startedAt, errorCode: FIDELITY_ERROR_CODE.NO_EXPORT_READY_CANDIDATE,
        errorMessage: 'No export-ready Candidate was supplied to the Fidelity Gate.',
        xmpLength: typeof xmpString === 'string' ? xmpString.length : 0,
      }),
    };
  }

  const readback = parseXmpReadback(xmpString);

  if (readback.parseStatus !== PARSE_STATUS.OK) {
    const errorCode = readback.diagnostics.parserErrors.some((e) => e.startsWith('xmp_too_large'))
      ? FIDELITY_ERROR_CODE.XMP_TOO_LARGE
      : FIDELITY_ERROR_CODE.XML_PARSE_FAILED;
    return {
      status: FIDELITY_STATUS.PARSE_FAILED,
      report: buildFidelityReport({
        candidateId: candidate.candidateId, sessionId: candidate.sessionId, generationId: candidate.generationId,
        candidateRevision: candidate.revision, status: FIDELITY_STATUS.PARSE_FAILED,
        comparisonResult: null, readback, durationMs: Date.now() - startedAt,
        errorCode, errorMessage: readback.diagnostics.parserErrors.join('; ') || 'XMP failed to parse.',
        xmpLength: readback.sourceLength,
      }),
    };
  }

  const comparisonResult = compareCandidateToReadback({ candidate, exportExpectedPreset, readback, sliderToKelvin });
  const { comparisons } = comparisonResult;

  const missingRequired = comparisons.filter((c) => c.result === COMPARISON_RESULT.MISSING && c.severity === 'CRITICAL');
  const mismatches = comparisons.filter((c) => (c.result === COMPARISON_RESULT.MISMATCH || c.result === COMPARISON_RESULT.INVALID) && c.severity === 'CRITICAL');
  const warnings = comparisons.filter((c) => c.result === COMPARISON_RESULT.MATCH_WITH_TOLERANCE);

  let status; let errorCode = null; let errorMessage = null;
  if (missingRequired.length > 0) {
    status = FIDELITY_STATUS.FAIL;
    errorCode = FIDELITY_ERROR_CODE.REQUIRED_PROPERTY_MISSING;
    errorMessage = `${missingRequired.length} required XMP propert${missingRequired.length === 1 ? 'y is' : 'ies are'} missing: ${missingRequired.slice(0, 5).map((c) => c.xmpProperty).join(', ')}`;
  } else if (mismatches.length > 0) {
    const anyCurve = mismatches.some((c) => c.dataType === 'CURVE_ARRAY');
    status = FIDELITY_STATUS.FAIL;
    errorCode = anyCurve ? FIDELITY_ERROR_CODE.INVALID_CURVE : FIDELITY_ERROR_CODE.PROPERTY_VALUE_MISMATCH;
    errorMessage = `${mismatches.length} XMP value(s) did not match the Candidate: ${mismatches.slice(0, 5).map((c) => c.xmpProperty).join(', ')}`;
  } else if (warnings.length > 0) {
    status = FIDELITY_STATUS.PASS_WITH_WARNINGS;
  } else {
    status = FIDELITY_STATUS.PASS;
  }

  const report = buildFidelityReport({
    candidateId: candidate.candidateId, sessionId: candidate.sessionId, generationId: candidate.generationId,
    candidateRevision: candidate.revision, status, comparisonResult, readback,
    durationMs: Date.now() - startedAt, errorCode, errorMessage, xmpLength: readback.sourceLength,
  });
  report.diagnostics.candidateStatus = candidate.status;

  return { status, report };
}
