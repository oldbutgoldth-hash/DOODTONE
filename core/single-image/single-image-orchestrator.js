/**
 * EPIC 2E-P1A — Single Image Analysis Orchestrator
 *
 * Owns the full lifecycle of a Single Image Analysis Session: create,
 * decode-ready, analyze, commit evidence (with generation-ownership
 * enforcement), and always resolve to a terminal status. This is the
 * ONLY module the real `ui/app.js` calls into for single-image
 * Session lifecycle — see P1A_MODIFIED_FILES.md's Integration Map for
 * the exact `ui/app.js` call sites that now go through this file.
 *
 * This module does not reimplement any Core analysis formula. It
 * wraps the outcome of calls `ui/app.js` still makes directly into
 * the real engines (histogram-engine, whitebalance-engine, etc.) —
 * see single-image-analysis-profile.js for the declared module list.
 */

import {
  createSingleImageSession,
  updateSessionStatus,
  appendSessionWarning,
  appendSessionError,
  resetSessionData,
  SESSION_STATUS,
  MODULE_STATE,
} from './single-image-session.js';
import {
  getActiveSession,
  setActiveSession,
  updateActiveSession,
  isActiveGeneration,
  clearActiveSession,
} from './single-image-session-store.js';
import { normalizeEvidence, normalizeFromSettled } from './evidence-normalizer.js';
import { SINGLE_IMAGE_FULL, PROFILE_VERSION, getModuleDescriptor, getRequiredModuleIds, getTotalModuleCount } from './single-image-analysis-profile.js';
import { syncEvidenceKeyToLegacyState, clearLegacyMirrors } from './legacy-state-adapter.js';
import { computeCacheKey, readCompatibleEvidence, writeCompletedEvidence } from './single-image-analysis-cache.js';
import { buildAnalysisReportFromSession } from './report/analysis-report-builder.js';
import { REPORT_STATUS } from './report/analysis-report-schema.js';
import { buildCandidateFromSession } from './candidate/candidate-builder.js';
import { CANDIDATE_STATUS } from './candidate/candidate-schema.js';
import { validateCandidate } from './candidate/candidate-validator.js';
import { computeExportParity } from './candidate/candidate-export-parity.js';
// EPIC 2E-P1D — XMP Serialize + Readback Fidelity Gate. Pure gate
// module only -- this orchestrator function is the ONLY place that
// traces events and commits `session.xmpFidelity`, mirroring the
// exact pure-core/traced-orchestrator split already established by
// buildAndCommitCandidate() above (candidate-builder.js is pure;
// this file owns tracing + Session commit).
import { runXmpFidelityGate } from './xmp-fidelity/xmp-fidelity-gate.js';
import { FIDELITY_STATUS } from './xmp-fidelity/xmp-fidelity-report.js';

export const ENGINE_VERSION = 'single-image-orchestrator@1.0.0';

// ---------------------------------------------------------------------
// Image fingerprint
// ---------------------------------------------------------------------

// A bounded content sample (not the whole file, for performance on
// large photographs) mixed with file metadata. FNV-1a is used rather
// than SHA-256 deliberately: this fingerprint exists only to key an
// in-memory dedup cache, not for any security/integrity purpose — the
// project's real SHA-256 implementation
// (core/calibration-lab/sha256-pure-js.js) is reserved for QA/
// packaging checksums. This is a documented, intentional deviation
// from a literal "hash" reading of the spec — see
// P1A_SINGLE_IMAGE_SESSION_ARCHITECTURE.md "Known limitations".
const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function _fnv1a(str) {
  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

const SAMPLE_BYTES = 65536;

/**
 * Compute a deterministic fingerprint for an uploaded image.
 * Never uses filename alone — combines filename + size + MIME type +
 * lastModified (when available) + decoded width/height + a bounded
 * content sample hash (when the file object supports arrayBuffer()).
 * @param {File|Blob|object} file
 * @param {{width?: number, height?: number}} [decodedMeta]
 * @returns {Promise<string>}
 */
export async function computeImageFingerprint(file, decodedMeta = {}) {
  const filename = file?.name ?? 'unknown';
  const size = typeof file?.size === 'number' ? file.size : -1;
  const mimeType = file?.type ?? 'unknown';
  const lastModified = typeof file?.lastModified === 'number' ? file.lastModified : -1;
  const width = decodedMeta.width ?? -1;
  const height = decodedMeta.height ?? -1;
  const metaString = `${filename}|${size}|${mimeType}|${lastModified}|${width}|${height}`;

  let sampleHash = 'nosample';
  if (file && typeof file.arrayBuffer === 'function' && size > 0) {
    try {
      let buffer;
      if (typeof file.slice === 'function' && size > SAMPLE_BYTES * 2) {
        const head = await file.slice(0, SAMPLE_BYTES).arrayBuffer();
        const tail = await file.slice(size - SAMPLE_BYTES, size).arrayBuffer();
        buffer = new Uint8Array(head.byteLength + tail.byteLength);
        buffer.set(new Uint8Array(head), 0);
        buffer.set(new Uint8Array(tail), head.byteLength);
      } else {
        buffer = new Uint8Array(await file.arrayBuffer());
      }
      // Fold the byte sample into a string cheaply (every 8th byte for
      // very large samples keeps this fast without weakening
      // uniqueness for the dedup purpose this fingerprint serves).
      let sampleStr = '';
      const step = buffer.length > 8192 ? 8 : 1;
      for (let i = 0; i < buffer.length; i += step) sampleStr += String.fromCharCode(buffer[i]);
      sampleHash = _fnv1a(sampleStr);
    } catch (_err) {
      sampleHash = 'sampleerror';
    }
  }

  return `${_fnv1a(metaString)}-${sampleHash}-${size}`;
}

// ---------------------------------------------------------------------
// Trace helper
// ---------------------------------------------------------------------

function _trace(session, type, extra = {}) {
  session.runtime.trace.push({
    type,
    sessionId: session.sessionId,
    generationId: session.generationId,
    at: Date.now(),
    ...extra,
  });
}

// ---------------------------------------------------------------------
// Lifecycle: upload -> decode-ready
// ---------------------------------------------------------------------

/**
 * Begin a new upload: aborts any prior active Session, creates a new
 * one, and computes its fingerprint. Does not decode the image itself
 * — `ui/app.js` still owns the actual `FileReader`/`Image` decode; it
 * calls `markImageDecoded()` once that finishes.
 * @param {File} file
 * @returns {Promise<{sessionId: string, generationId: string}>}
 */
export async function beginUpload(file) {
  abortActiveSession('SUPERSEDED_BY_NEW_UPLOAD');

  const session = createSingleImageSession({ file });
  updateSessionStatus(session, SESSION_STATUS.IMAGE_DECODING, { stage: 'IMAGE_DECODING' });
  setActiveSession(session);
  _trace(session, 'SESSION_CREATED');
  _trace(session, 'SESSION_ACTIVATED');
  _trace(session, 'IMAGE_DECODE_STARTED');

  const ticket = { sessionId: session.sessionId, generationId: session.generationId };

  try {
    const fingerprint = await computeImageFingerprint(file);
    updateActiveSession(ticket.sessionId, ticket.generationId, (s) => {
      s.image.fingerprint = fingerprint;
      s.cache.fingerprint = fingerprint;
      s.cache.profileVersion = PROFILE_VERSION;
      s.cache.engineVersion = ENGINE_VERSION;
    });
  } catch (err) {
    // Fingerprinting is best-effort; a failure here must not block
    // the upload — record it as a warning, not a session error.
    updateActiveSession(ticket.sessionId, ticket.generationId, (s) => {
      appendSessionWarning(s, 'FINGERPRINT_FAILED', String(err?.message ?? err));
    });
  }

  return ticket;
}

/**
 * Record that the image has finished decoding and its analysis proxy
 * (if any) has been created. Rejected silently (no-op) if a newer
 * upload has since superseded this Session.
 */
export function markImageDecoded(ticket, { width, height, decodedSource = null, analysisProxy = null, displaySource = null, proxySize = null }) {
  const result = updateActiveSession(ticket.sessionId, ticket.generationId, (s) => {
    s.image.width = width ?? null;
    s.image.height = height ?? null;
    s.image.aspectRatio = (width && height) ? +(width / height).toFixed(6) : null;
    s.image.megapixels = (width && height) ? +((width * height) / 1e6).toFixed(2) : null;
    s.image.decodedSource = decodedSource;
    s.image.analysisProxy = analysisProxy;
    s.image.displaySource = displaySource;
    s.cache.proxySize = proxySize;
    updateSessionStatus(s, SESSION_STATUS.IMAGE_READY, { stage: 'IMAGE_READY' });
    _trace(s, 'PROXY_CREATED');
    _trace(s, 'IMAGE_DECODE_COMPLETED');
  });
  return result.applied;
}

export function markImageDecodeFailed(ticket, error) {
  const result = updateActiveSession(ticket.sessionId, ticket.generationId, (s) => {
    appendSessionError(s, 'IMAGE_DECODE_FAILED', String(error?.message ?? error));
    updateSessionStatus(s, SESSION_STATUS.FAILED, { stage: 'FAILED' });
    _trace(s, 'IMAGE_DECODE_FAILED');
  });
  return result.applied;
}

// ---------------------------------------------------------------------
// Lifecycle: analysis
// ---------------------------------------------------------------------

/**
 * Request permission to start (or restart) analysis for the active
 * Session. Returns null (no ticket) if:
 *  - there is no active session, or
 *  - the given sessionId/generationId is stale, or
 *  - analysis is ALREADY in progress for this exact Session
 *    (duplicate Analyze / double-click protection).
 * @returns {{sessionId: string, generationId: string}|null}
 */
export function startAnalysisTicket(sessionId, generationId) {
  if (!isActiveGeneration(sessionId, generationId)) return null;
  const session = getActiveSession();
  if (session.status === SESSION_STATUS.ANALYZING || session.status === SESSION_STATUS.ANALYSIS_QUEUED) {
    return null; // duplicate Analyze call — real defect this closes, see audit §13
  }
  updateActiveSession(sessionId, generationId, (s) => {
    updateSessionStatus(s, SESSION_STATUS.ANALYSIS_QUEUED, { stage: 'ANALYSIS_QUEUED' });
    s.progress.totalModules = getTotalModuleCount();
    s.progress.completedModules = 0;
    s.progress.percentage = 0;
    _trace(s, 'ANALYSIS_STARTED');
    updateSessionStatus(s, SESSION_STATUS.ANALYZING, { stage: 'ANALYZING' });
  });
  return { sessionId, generationId };
}

/**
 * Commit ONE module's outcome into the active Session's evidence
 * (and, if `legacyState` is supplied, immediately mirror it into the
 * real `ui/app.js` `state` object via the legacy adapter). No-ops
 * silently if the ticket is stale — this is the exact choke point
 * that prevents a late-resolving Promise from an ABORTED/superseded
 * Session from corrupting a newer Session's data (audit §13).
 *
 * @param {{sessionId,generationId}} ticket
 * @param {string} moduleId - must match single-image-analysis-profile.js
 * @param {object} outcome - {status, result, confidence, diagnostics, warnings, errors, startedAt, completedAt}
 * @param {object} [legacyState] - the real ui/app.js `state` object
 * @returns {{committed: boolean, entry: object|null}}
 */
export function commitEvidence(ticket, moduleId, outcome, legacyState = null) {
  const descriptor = getModuleDescriptor(moduleId);
  if (!descriptor) throw new Error(`commitEvidence: unknown moduleId "${moduleId}"`);

  if (!isActiveGeneration(ticket.sessionId, ticket.generationId)) {
    return { committed: false, entry: null, reason: 'STALE_GENERATION' };
  }

  const normalized = normalizeEvidence(moduleId, outcome);
  let committed = false;
  updateActiveSession(ticket.sessionId, ticket.generationId, (s) => {
    committed = true;
    s.runtime.moduleStates[moduleId] = normalized.status;
    if (descriptor.evidenceKey !== 'candidate') {
      s.evidence[descriptor.evidenceKey] = normalized;
    }
    s.progress.currentModule = moduleId;
    s.progress.completedModules = Math.min(s.progress.totalModules, s.progress.completedModules + 1);
    s.progress.percentage = s.progress.totalModules
      ? Math.round((s.progress.completedModules / s.progress.totalModules) * 100)
      : 0;

    const traceType = {
      [MODULE_STATE.COMPLETED]: 'MODULE_COMPLETED',
      [MODULE_STATE.CACHE_HIT]: 'CACHE_HIT',
      [MODULE_STATE.SOFT_FAILED]: 'MODULE_SOFT_FAILED',
      [MODULE_STATE.FAILED]: 'MODULE_FAILED',
      [MODULE_STATE.TIMED_OUT]: 'MODULE_TIMED_OUT',
      [MODULE_STATE.ABORTED]: 'MODULE_ABORTED',
      [MODULE_STATE.SKIPPED]: 'MODULE_QUEUED',
    }[normalized.status] || 'MODULE_COMPLETED';
    _trace(s, traceType, { moduleId, evidenceKey: descriptor.evidenceKey });

    if (normalized.status === MODULE_STATE.SOFT_FAILED || normalized.status === MODULE_STATE.FAILED) {
      appendSessionWarning(s, `${moduleId.toUpperCase()}_UNAVAILABLE`, `${moduleId} produced no usable evidence this Session.`, { moduleId });
    }

    if (descriptor.required && (normalized.status === MODULE_STATE.FAILED || normalized.status === MODULE_STATE.TIMED_OUT)) {
      appendSessionError(s, 'REQUIRED_MODULE_FAILED', `Required module "${moduleId}" failed: ${normalized.errors?.[0]?.message ?? 'no detail'}`, { moduleId });
      updateSessionStatus(s, SESSION_STATUS.FAILED, { stage: 'FAILED' });
      _trace(s, 'ANALYSIS_FAILED', { moduleId });
    }

    if (legacyState && descriptor.evidenceKey !== 'candidate') {
      syncEvidenceKeyToLegacyState(legacyState, descriptor.evidenceKey, normalized);
      _trace(s, 'LEGACY_STATE_SYNCED', { moduleId, evidenceKey: descriptor.evidenceKey });
    }
  });

  return { committed, entry: normalized };
}

/** Convenience wrapper for a Promise.allSettled() entry — see evidence-normalizer.js. */
export function commitFromSettled(ticket, moduleId, settledResult, opts = {}, legacyState = null) {
  const descriptor = getModuleDescriptor(moduleId);
  const normalized = normalizeFromSettled(moduleId, settledResult, { ...opts, required: descriptor?.required });
  return commitEvidence(ticket, moduleId, normalized, legacyState);
}

/**
 * Commit the RAW single-image Candidate (buildFinalPreset's flat
 * output, already validated/benchmarked by the existing P1A/P1B
 * pipeline). EPIC 2E-P1C: this is now `session.candidateRaw`, NOT
 * `session.candidate` -- `session.candidate` is reserved exclusively
 * for the canonical, nested P1C Candidate built by
 * buildAndCommitCandidate() below, from this same raw value. See
 * P1C_CANDIDATE_SOURCE_LINEAGE_AUDIT.md §6/§13 for why this rename is
 * safe (nothing outside core/single-image/ read the old flat
 * `session.candidate` shape back).
 */
export function commitCandidate(ticket, candidate) {
  if (!isActiveGeneration(ticket.sessionId, ticket.generationId)) {
    return { committed: false };
  }
  let committed = false;
  updateActiveSession(ticket.sessionId, ticket.generationId, (s) => {
    committed = true;
    s.candidateRaw = candidate;
    s.runtime.moduleStates.decisionCandidate = MODULE_STATE.COMPLETED;
    _trace(s, 'EVIDENCE_NORMALIZED', { moduleId: 'decisionCandidate' });
  });
  return { committed };
}

// ---------------------------------------------------------------------
// Canonical Candidate build (EPIC 2E-P1C)
// ---------------------------------------------------------------------

/**
 * Build the canonical, nested Lightroom Auto-Tune Candidate from the
 * ACTIVE Session's already-committed `candidateRaw` (never re-runs
 * buildFinalPreset or any Core module) and commit it to
 * `session.candidate`. Must be called AFTER `commitCandidate()` has
 * populated `session.candidateRaw` for this generation -- a no-op
 * (not an error) if the ticket is stale or the Session has not reached
 * a terminal analysis status yet.
 *
 * @param {{sessionId,generationId}} ticket
 * @param {{legacyState?: object, engineVersion?: string}} [opts]
 * @returns {{committed: boolean, candidate: object|null, validation: object|null, reason: string|null}}
 */
export function buildAndCommitCandidate(ticket, { legacyState = null, engineVersion = null } = {}) {
  if (!ticket || !isActiveGeneration(ticket.sessionId, ticket.generationId)) {
    return { committed: false, candidate: null, validation: null, reason: 'STALE_GENERATION' };
  }
  const session = getActiveSession();
  if (session.status !== SESSION_STATUS.COMPLETED && session.status !== SESSION_STATUS.PARTIAL) {
    return { committed: false, candidate: null, validation: null, reason: 'SESSION_NOT_TERMINAL' };
  }

  const startedAt = Date.now();
  _trace(session, 'CANDIDATE_BUILD_STARTED');
  const { candidate } = buildCandidateFromSession(session, { engineVersion });
  _trace(session, 'CANDIDATE_NORMALIZED', { candidateId: candidate.candidateId });

  // EPIC 2E-P1E R3 -- Creative Tone Plan trace (bounded, no image data).
  // candidate.diagnostics.colorIntelligence already carries the plan's
  // engaged/fieldsBoosted/reasons/sceneClass -- this trace event only
  // records identity + a small summary, never pixel/evidence payloads.
  _trace(session, 'CREATIVE_TONE_PLAN_CREATED', {
    candidateId: candidate.candidateId,
    strengthMode: candidate.diagnostics.colorIntelligence?.strengthMode ?? null,
    sceneClass: candidate.diagnostics.colorIntelligence?.sceneClass ?? null,
    fieldsBoostedCount: (candidate.diagnostics.colorIntelligence?.fieldsBoosted ?? []).length,
  });

  // EPIC 2E-P1E R3 -- Export Parity Audit. Computes, once per build
  // (pure, no serialization, no DOM), whether this Candidate's own
  // current color values already satisfy quickSafetyClamp()'s export-
  // time thresholds -- the exact question Objective A exists to answer.
  // Stored on candidate.diagnostics.exportParity for the Advanced
  // Diagnostics panel and for getCandidateExportReadiness() callers;
  // never blocks the build, never mutates the Candidate.
  _trace(session, 'COLOR_PARITY_AUDIT_STARTED', { candidateId: candidate.candidateId });
  const exportParity = computeExportParity(candidate);
  candidate.diagnostics.exportParity = {
    allMatch: exportParity.allMatch,
    summary: exportParity.summary,
    mismatches: exportParity.entries.filter((e) => !e.candidateVsExportMatch).map((e) => ({
      parameterPath: e.parameterPath, xmpProperty: e.xmpProperty,
      candidateValue: e.candidateCurrentValue, exportExpectedValue: e.exportExpectedValue,
    })),
  };
  for (const mismatch of candidate.diagnostics.exportParity.mismatches) {
    _trace(session, 'COLOR_EXPORT_SAFE_ADJUSTMENT', {
      candidateId: candidate.candidateId, parameterPath: mismatch.parameterPath,
      candidateValue: mismatch.candidateValue, exportExpectedValue: mismatch.exportExpectedValue,
    });
  }
  _trace(session, exportParity.allMatch ? 'COLOR_PARITY_MATCH' : 'COLOR_PARITY_MISMATCH', {
    candidateId: candidate.candidateId, mismatchCount: exportParity.summary.mismatched,
  });
  _trace(session, 'COLOR_PARITY_AUDIT_COMPLETED', {
    candidateId: candidate.candidateId, allMatch: exportParity.allMatch, totalChecked: exportParity.summary.totalChecked,
  });
  _trace(session, 'CREATIVE_TONE_PLAN_APPLIED', {
    candidateId: candidate.candidateId, engaged: candidate.diagnostics.colorIntelligence?.engaged ?? false,
  });

  _trace(session, 'CANDIDATE_VALIDATION_STARTED', { candidateId: candidate.candidateId });
  const fullValidation = validateCandidate(candidate);
  if (fullValidation.errors.length > 0) {
    candidate.status = CANDIDATE_STATUS.INVALID;
    _trace(session, 'CANDIDATE_INVALID', { candidateId: candidate.candidateId, errorCount: fullValidation.errors.length });
  } else if (fullValidation.warnings.length > 0) {
    candidate.status = CANDIDATE_STATUS.VALID_WITH_WARNINGS;
    _trace(session, 'CANDIDATE_VALID_WITH_WARNINGS', { candidateId: candidate.candidateId, warningCount: fullValidation.warnings.length });
  } else if (candidate.status !== CANDIDATE_STATUS.FAILED && candidate.status !== CANDIDATE_STATUS.EMPTY) {
    candidate.status = CANDIDATE_STATUS.VALID;
    _trace(session, 'CANDIDATE_VALID', { candidateId: candidate.candidateId });
  }

  let committed = false;
  updateActiveSession(ticket.sessionId, ticket.generationId, (s) => {
    committed = true;
    s.candidate = candidate;
    _trace(s, 'CANDIDATE_COMMITTED', {
      candidateId: candidate.candidateId, status: candidate.status,
      revision: candidate.revision, durationMs: Date.now() - startedAt,
    });
  });

  if (!committed) {
    _trace(session, 'CANDIDATE_STALE_REJECTED', { candidateId: candidate.candidateId });
    return { committed: false, candidate: null, validation: fullValidation, reason: 'STALE_GENERATION_AT_COMMIT' };
  }

  _trace(session, (candidate.status === CANDIDATE_STATUS.INVALID || candidate.status === CANDIDATE_STATUS.FAILED)
    ? 'CANDIDATE_BUILD_FAILED' : 'CANDIDATE_BUILD_COMPLETED',
    { candidateId: candidate.candidateId, durationMs: Date.now() - startedAt });

  return { committed: true, candidate, validation: fullValidation, reason: null };
}

/**
 * Finalize analysis: COMPLETED if every required module succeeded and
 * no optional module soft-failed; PARTIAL if required modules
 * succeeded but at least one optional module did not; the session is
 * left FAILED (already set by commitEvidence) if a required module
 * failed. Always leaves the Session in a terminal status — never
 * ANALYZING indefinitely.
 */
export function completeAnalysis(ticket) {
  if (!isActiveGeneration(ticket.sessionId, ticket.generationId)) return null;
  let finalStatus = null;
  updateActiveSession(ticket.sessionId, ticket.generationId, (s) => {
    if (s.status === SESSION_STATUS.FAILED) {
      finalStatus = SESSION_STATUS.FAILED;
      return; // already terminal from a required-module failure
    }
    const anyDegraded = Object.values(s.runtime.moduleStates).some(
      (st) => st === MODULE_STATE.SOFT_FAILED || st === MODULE_STATE.FAILED
        || st === MODULE_STATE.TIMED_OUT || st === MODULE_STATE.ABORTED,
    );
    finalStatus = anyDegraded ? SESSION_STATUS.PARTIAL : SESSION_STATUS.COMPLETED;
    updateSessionStatus(s, finalStatus, { stage: finalStatus });
    s.progress.percentage = 100;
    _trace(s, finalStatus === SESSION_STATUS.PARTIAL ? 'ANALYSIS_PARTIAL' : 'ANALYSIS_COMPLETED');

    if (s.cache.fingerprint && s.cache.profileVersion && s.cache.engineVersion) {
      const key = computeCacheKey({
        fingerprint: s.cache.fingerprint,
        profileVersion: s.cache.profileVersion,
        engineVersion: s.cache.engineVersion,
        proxySize: s.cache.proxySize ?? 0,
      });
      s.cache.key = key;
      writeCompletedEvidence(key, s.evidence, { candidate: s.candidate, candidateRaw: s.candidateRaw, status: finalStatus });
    }
  });
  return finalStatus;
}

// ---------------------------------------------------------------------
// Report build (EPIC 2E-P1B)
// ---------------------------------------------------------------------

/**
 * Build the canonical AI Image Analysis Report from the ACTIVE
 * Session's already-committed `evidence` and commit it to
 * `session.report`. Must be called AFTER `completeAnalysis()` has
 * left the Session COMPLETED or PARTIAL -- never runs, reruns, or
 * waits on any Core module itself, and is a no-op (not an error) if
 * the ticket is stale or the Session has not reached a terminal
 * analysis status yet. `legacyState` is optional and used only for
 * the documented evidence-key fallback described in
 * analysis-report-builder.js.
 *
 * Idempotency: calling this again for the SAME Session (e.g. a bug
 * that double-invokes it) increments `reportBuildCount` rather than
 * silently no-op'ing, so a test can assert "built exactly once per
 * completed analysis" by asserting the call site, not this function.
 *
 * @param {{sessionId,generationId}} ticket
 * @returns {{committed: boolean, report: object|null, validation: object|null, reason: string|null}}
 */
export function buildAndCommitReport(ticket, { legacyState = null } = {}) {
  if (!ticket || !isActiveGeneration(ticket.sessionId, ticket.generationId)) {
    return { committed: false, report: null, validation: null, reason: 'STALE_GENERATION' };
  }
  const session = getActiveSession();
  if (session.status !== SESSION_STATUS.COMPLETED && session.status !== SESSION_STATUS.PARTIAL) {
    return { committed: false, report: null, validation: null, reason: 'SESSION_NOT_TERMINAL' };
  }

  _trace(session, 'REPORT_BUILD_STARTED', { sourceStatus: session.status });
  const { report, validation } = buildAnalysisReportFromSession(session, { legacyState });
  _trace(session, 'REPORT_VALIDATION_STARTED');
  _trace(session, validation.valid ? 'REPORT_VALIDATION_PASSED' : 'REPORT_VALIDATION_FAILED', {
    errorCount: validation.errors.length,
  });
  if (!validation.valid) {
    report.status = REPORT_STATUS.FAILED;
  }

  let committed = false;
  updateActiveSession(ticket.sessionId, ticket.generationId, (s) => {
    committed = true;
    s.report = report;
    _trace(s, 'REPORT_COMMITTED', { reportId: report.reportId, status: report.status, reportBuildCount: report.reportBuildCount });
  });

  if (!committed) {
    _trace(session, 'REPORT_STALE_REJECTED', { reportId: report.reportId });
    return { committed: false, report: null, validation, reason: 'STALE_GENERATION_AT_COMMIT' };
  }

  return { committed: true, report, validation, reason: null };
}

export function failAnalysis(ticket, error) {
  if (!isActiveGeneration(ticket.sessionId, ticket.generationId)) return false;
  updateActiveSession(ticket.sessionId, ticket.generationId, (s) => {
    appendSessionError(s, 'ANALYSIS_FAILED', String(error?.message ?? error));
    updateSessionStatus(s, SESSION_STATUS.FAILED, { stage: 'FAILED' });
    _trace(s, 'ANALYSIS_FAILED');
  });
  return true;
}

// ---------------------------------------------------------------------
// Cache lookup (read path — does not itself run analysis)
// ---------------------------------------------------------------------

/**
 * Look up compatible cached evidence for a fingerprint/profile/engine
 * combination WITHOUT starting analysis. Callers decide whether to
 * apply the cached evidence (e.g. re-uploading the exact same file)
 * or proceed to a fresh `startAnalysisTicket()` run.
 */
export function lookupCachedEvidence({ fingerprint, profileVersion = PROFILE_VERSION, engineVersion = ENGINE_VERSION, proxySize = 0 }) {
  const key = computeCacheKey({ fingerprint, profileVersion, engineVersion, proxySize });
  return readCompatibleEvidence(key);
}

// ---------------------------------------------------------------------
// Abort / Reset
// ---------------------------------------------------------------------

export function abortActiveSession(reason = 'ABORTED') {
  const session = getActiveSession();
  if (!session) return false;
  if ([SESSION_STATUS.COMPLETED, SESSION_STATUS.FAILED, SESSION_STATUS.ABORTED, SESSION_STATUS.RESET].includes(session.status)) {
    return false; // already terminal, nothing to abort
  }
  updateSessionStatus(session, SESSION_STATUS.ABORTING, { stage: 'ABORTING' });
  _trace(session, 'SESSION_ABORT_REQUESTED', { reason });
  try {
    session.runtime.abortController?.abort();
  } catch (_err) {
    // best-effort; the real generation-ownership check in
    // updateActiveSession() is what actually prevents stale writes,
    // not this signal — see Known Limitations.
  }
  updateSessionStatus(session, SESSION_STATUS.ABORTED, { stage: 'ABORTED' });
  _trace(session, 'SESSION_ABORTED', { reason });
  return true;
}

/**
 * Full Reset: abort whatever is active, clear its data, clear the
 * store, and clear the legacy mirrors. Matches `handleReset()`'s
 * existing scope (ui/app.js:2955) — this is additive, not a
 * replacement for its DOM-clearing responsibilities.
 */
export function resetActiveSession(legacyState = null) {
  const session = getActiveSession();
  if (session) {
    abortActiveSession('RESET');
    resetSessionData(session);
    _trace(session, 'SESSION_RESET');
  }
  clearActiveSession();
  if (legacyState) clearLegacyMirrors(legacyState);
  return true;
}

export function getActiveSessionSnapshot() {
  return getActiveSession();
}

// ---------------------------------------------------------------------
// XMP Serialize + Readback Fidelity Gate (EPIC 2E-P1D)
// ---------------------------------------------------------------------

/**
 * Trace that XMP serialization is about to run for this download
 * attempt. Called from ui/app.js's handleDownload() immediately
 * before the ONE serializeXMP() call for this attempt (see the
 * Single Serialization Rule in P1D_XMP_FIDELITY_GATE_POLICY.md).
 */
export function traceXmpSerializationStarted({ candidateId = null, revision = null } = {}) {
  const session = getActiveSession();
  if (!session) return { traced: false };
  _trace(session, 'XMP_SERIALIZATION_STARTED', { candidateId, revision });
  return { traced: true };
}

export function traceXmpSerializationCompleted({ candidateId = null, revision = null, xmpLength = 0 } = {}) {
  const session = getActiveSession();
  if (!session) return { traced: false };
  _trace(session, 'XMP_SERIALIZATION_COMPLETED', { candidateId, revision, xmpLength });
  return { traced: true };
}

export function traceXmpSerializationFailed({ candidateId = null, revision = null, errorMessage = null } = {}) {
  const session = getActiveSession();
  if (!session) return { traced: false };
  _trace(session, 'XMP_SERIALIZATION_FAILED', { candidateId, revision, errorCode: 'SERIALIZATION_FAILED', errorMessage });
  return { traced: true };
}

/**
 * Run the XMP Fidelity Gate for the ONE XMP string this download
 * attempt already serialized (never re-serializes -- `xmpString` is
 * parsed exactly as given), trace every required lifecycle event, and
 * commit the resulting Fidelity Report to `session.xmpFidelity`
 * (generation-gated, exactly like `buildAndCommitCandidate()` commits
 * `session.candidate`). Does NOT rerun analysis, does NOT rebuild the
 * Candidate, does NOT read DOM/slider state -- `candidate` and
 * `exportExpectedPreset` are supplied by the caller (ui/app.js's
 * handleDownload(), which already has them from the existing,
 * unmodified candidateToLegacyPreset()/quickSafetyClamp() pipeline).
 *
 * @param {{sessionId,generationId}} ticket
 * @param {{candidate:object, exportExpectedPreset:object, xmpString:string}} params
 * @returns {{committed:boolean, status:string, report:object|null, reason:string|null}}
 */
export function runXmpFidelityCheck(ticket, { candidate, exportExpectedPreset, xmpString }) {
  if (!ticket || !isActiveGeneration(ticket.sessionId, ticket.generationId)) {
    return { committed: false, status: FIDELITY_STATUS.FAIL, report: null, reason: 'STALE_GENERATION' };
  }
  const session = getActiveSession();

  _trace(session, 'XMP_READBACK_STARTED', { candidateId: candidate?.candidateId ?? null, revision: candidate?.revision ?? null });
  const { status, report } = runXmpFidelityGate({ candidate, exportExpectedPreset, xmpString });

  if (report.readback.parseStatus === 'OK') {
    _trace(session, 'XMP_READBACK_COMPLETED', { candidateId: candidate?.candidateId ?? null, fidelityReportId: report.fidelityReportId });
  } else {
    _trace(session, 'XMP_READBACK_FAILED', {
      candidateId: candidate?.candidateId ?? null, fidelityReportId: report.fidelityReportId,
      errorCode: report.diagnostics.errorCode, errorMessage: report.diagnostics.errorMessage,
    });
  }

  _trace(session, 'XMP_FIDELITY_COMPARISON_STARTED', { candidateId: candidate?.candidateId ?? null, fidelityReportId: report.fidelityReportId });
  const mismatchCount = report.mismatches.length + report.missingRequired.length;
  _trace(session, mismatchCount === 0 ? 'XMP_FIDELITY_MATCH' : 'XMP_FIDELITY_MISMATCH', {
    candidateId: candidate?.candidateId ?? null, fidelityReportId: report.fidelityReportId, mismatchCount,
  });

  const statusTraceType = {
    [FIDELITY_STATUS.PASS]: 'XMP_FIDELITY_PASSED',
    [FIDELITY_STATUS.PASS_WITH_WARNINGS]: 'XMP_FIDELITY_PASSED_WITH_WARNINGS',
    [FIDELITY_STATUS.FAIL]: 'XMP_FIDELITY_FAILED',
    [FIDELITY_STATUS.PARSE_FAILED]: 'XMP_FIDELITY_FAILED',
  }[status] ?? 'XMP_FIDELITY_FAILED';
  _trace(session, statusTraceType, {
    candidateId: candidate?.candidateId ?? null, fidelityReportId: report.fidelityReportId,
    status, mismatchCount, durationMs: report.diagnostics.durationMs,
    errorCode: report.diagnostics.errorCode, errorMessage: report.diagnostics.errorMessage,
  });

  let committed = false;
  const result = updateActiveSession(ticket.sessionId, ticket.generationId, (s) => {
    // Belt-and-braces staleness guard, matching updateCandidateParameter()'s
    // own pattern: if the Candidate this report was computed FOR is no
    // longer the live one (a newer build/edit/reset raced this call),
    // do not attach a report for a different Candidate identity/revision.
    if (candidate && s.candidate && (s.candidate.candidateId !== candidate.candidateId || s.candidate.revision !== candidate.revision)) {
      _trace(s, 'XMP_FIDELITY_STALE_REJECTED', { candidateId: candidate.candidateId, fidelityReportId: report.fidelityReportId, revision: candidate.revision, currentRevision: s.candidate.revision });
      return;
    }
    s.xmpFidelity = report;
    committed = true;
  });

  return {
    committed: result.applied && committed,
    status,
    report,
    reason: result.applied ? (committed ? null : 'STALE_CANDIDATE_REPLACED') : result.reason,
  };
}

/** Trace that a download was allowed (PASS or PASS_WITH_WARNINGS). */
export function traceXmpDownloadAllowed({ candidateId = null, fidelityReportId = null, status = null } = {}) {
  const session = getActiveSession();
  if (!session) return { traced: false };
  _trace(session, 'XMP_DOWNLOAD_ALLOWED', { candidateId, fidelityReportId, status });
  return { traced: true };
}

/** Trace that a download was blocked by the Fidelity Gate (FAIL / PARSE_FAILED). */
export function traceXmpDownloadBlocked({ candidateId = null, fidelityReportId = null, status = null, errorCode = null, errorMessage = null } = {}) {
  const session = getActiveSession();
  if (!session) return { traced: false };
  _trace(session, 'XMP_DOWNLOAD_BLOCKED', { candidateId, fidelityReportId, status, errorCode, errorMessage });
  return { traced: true };
}

// ---------------------------------------------------------------------
// XMP export trace events (EPIC 2E-P1C)
// ---------------------------------------------------------------------

/**
 * Trace that an XMP export used the validated Candidate as its source
 * (never the DOM). Called from ui/app.js's handleDownload() right
 * before serializeXMP(). A no-op (not an error) if there is no active
 * Session to attach the trace to.
 */
export function traceXmpExportUsingCandidate({ candidateId = null, revision = null } = {}) {
  const session = getActiveSession();
  if (!session) return { traced: false };
  _trace(session, 'XMP_EXPORT_USING_CANDIDATE', { candidateId, revision });
  return { traced: true };
}

/**
 * Trace that an XMP export was blocked because no valid Candidate
 * existed. Called from ui/app.js's handleDownload() when
 * candidateStore.getValidatedCandidate() returns null.
 */
export function traceXmpExportBlocked({ reason = null } = {}) {
  const session = getActiveSession();
  if (!session) return { traced: false };
  _trace(session, 'XMP_EXPORT_BLOCKED_NO_CANDIDATE', { reason });
  return { traced: true };
}

export { SINGLE_IMAGE_FULL, PROFILE_VERSION, getRequiredModuleIds, getTotalModuleCount };
