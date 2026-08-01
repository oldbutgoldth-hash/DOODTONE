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

/** Commit the single-image Candidate (buildFinalPreset's output). */
export function commitCandidate(ticket, candidate) {
  if (!isActiveGeneration(ticket.sessionId, ticket.generationId)) {
    return { committed: false };
  }
  let committed = false;
  updateActiveSession(ticket.sessionId, ticket.generationId, (s) => {
    committed = true;
    s.candidate = candidate;
    s.runtime.moduleStates.decisionCandidate = MODULE_STATE.COMPLETED;
    _trace(s, 'EVIDENCE_NORMALIZED', { moduleId: 'decisionCandidate' });
  });
  return { committed };
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
      writeCompletedEvidence(key, s.evidence, { candidate: s.candidate, status: finalStatus });
    }
  });
  return finalStatus;
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

export { SINGLE_IMAGE_FULL, PROFILE_VERSION, getRequiredModuleIds, getTotalModuleCount };
