/**
 * EPIC 2E-P1C — Candidate Store
 *
 * The canonical Candidate Store is the only source of Lightroom values
 * after Candidate creation. It is a thin, generation-gated facade over
 * `session.candidate` (delegating storage to the same Session object
 * P1A/P1B already own — no second, possibly-diverging copy of the
 * Candidate exists anywhere), reusing the exact generation-ownership
 * check (`isActiveGeneration`/`updateActiveSession`) the Session Store
 * already enforces for evidence/report writes. A stale sessionId/
 * generationId write is rejected the same way a stale evidence commit
 * already is.
 *
 * Maintains its own pub/sub channel (separate from the Session
 * Store's own) so slider-sync UI code can subscribe to
 * Candidate-specific events without filtering unrelated Session
 * events.
 */

import { getActiveSession, updateActiveSession, isActiveGeneration } from '../single-image-session-store.js';
import { CANDIDATE_STATUS, validateCandidateShape } from './candidate-schema.js';
import { markParameterEdited } from './candidate-lineage.js';

const _subscribers = new Set();

// Local trace helper -- mirrors single-image-orchestrator.js's _trace()
// exactly (same session.runtime.trace.push shape). Duplicated locally
// rather than imported from the orchestrator to avoid a circular
// import (the orchestrator itself imports from this module's sibling
// candidate-builder.js).
function _trace(session, type, extra = {}) {
  if (!session?.runtime?.trace) return;
  session.runtime.trace.push({ type, sessionId: session.sessionId, generationId: session.generationId, at: Date.now(), ...extra });
}

function _notify(eventType, candidate, extra = {}) {
  for (const fn of _subscribers) {
    try { fn({ type: eventType, candidate, ...extra }); } catch (_err) { /* subscriber errors never break the store */ }
  }
}

export function subscribe(fn) {
  _subscribers.add(fn);
  return () => _subscribers.delete(fn);
}

export function unsubscribe(fn) {
  _subscribers.delete(fn);
}

/** @returns {object|null} the active Session's Candidate, or null. */
export function getActiveCandidate() {
  return getActiveSession()?.candidate ?? null;
}

/** Install a full Candidate object as the active one (generation-gated). Used by the builder's commit path. */
export function setActiveCandidate(sessionId, generationId, candidate) {
  const result = updateActiveSession(sessionId, generationId, (s) => {
    s.candidate = candidate;
  });
  if (result.applied) _notify('CANDIDATE_SET', result.session.candidate);
  return { committed: result.applied, candidate: result.applied ? result.session.candidate : null, reason: result.applied ? null : result.reason };
}

function _getByPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function _setByPath(obj, path, value) {
  const keys = path.split('.');
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (cur[keys[i]] == null || typeof cur[keys[i]] !== 'object') return false;
    cur = cur[keys[i]];
  }
  cur[keys[keys.length - 1]] = value;
  return true;
}

/**
 * Update exactly ONE Candidate parameter (dotted path, e.g.
 * "basic.highlights", "hsl.saturation.orange", "cal.redPrimaryHue").
 * Generation-gated. Sets status USER_EDITED, bumps revision, records
 * the edit in diagnostics.manualEdits + diagnostics.lineage. Never
 * rebuilds the whole Candidate and never triggers analysis.
 *
 * EPIC 2E-P1C R3: fully transactional -- clone the active Candidate,
 * apply the single edit + bookkeeping to the CLONE only, validate the
 * clone, and only then commit it over `session.candidate` in one
 * atomic `updateActiveSession()` write. If validation fails, the
 * previously-committed, valid Candidate in the Session is returned
 * completely untouched (never overwritten with a partially-mutated,
 * now-invalid object) -- export continues to use the last valid
 * state. This replaces the old in-place "mutate first, downgrade
 * status to INVALID after the fact if validation fails" pattern,
 * which could leave a genuinely INVALID Candidate stored (and every
 * later USER_EDITED edit permanently lost) from a single bad edit.
 *
 * @returns {{committed:boolean, candidate:object|null, reason:string|null, validationErrors:string[]}}
 *   reason is one of: null (success), 'STALE_GENERATION',
 *   'NO_ACTIVE_CANDIDATE', 'UNSAFE_VALUE', 'UNKNOWN_PARAMETER_PATH',
 *   'SHAPE_VALIDATION_FAILED', 'STALE_CANDIDATE_REPLACED'.
 */
export function updateCandidateParameter(sessionId, generationId, parameterPath, newValue, { source = 'USER_EDIT' } = {}) {
  if (!isActiveGeneration(sessionId, generationId)) {
    return { committed: false, candidate: null, reason: 'STALE_GENERATION', validationErrors: [] };
  }
  if (!Number.isFinite(newValue)) {
    return { committed: false, candidate: null, reason: 'UNSAFE_VALUE', validationErrors: [`${parameterPath}: value is not a finite number (${String(newValue)})`] };
  }

  const activeSession = getActiveSession();
  const liveCandidate = activeSession?.candidate;
  if (!liveCandidate) {
    return { committed: false, candidate: null, reason: 'NO_ACTIVE_CANDIDATE', validationErrors: [] };
  }

  // 1-2. Read the active Candidate, create a safe structured clone.
  const clone = structuredClone(liveCandidate);

  // 3. Apply the single parameter edit to the clone only.
  const ok = _setByPath(clone, parameterPath, newValue);
  if (!ok) {
    return { committed: false, candidate: null, reason: 'UNKNOWN_PARAMETER_PATH', validationErrors: [`Unknown or unwritable parameter path: ${parameterPath}`] };
  }

  // 4. Update revision, updatedAt, manualEdits and lineage on the clone.
  clone.revision = (clone.revision ?? 0) + 1;
  clone.updatedAt = Date.now();
  if (source === 'USER_EDIT') {
    const edits = clone.diagnostics.manualEdits;
    if (!edits.changedParameters.includes(parameterPath)) edits.changedParameters.push(parameterPath);
    edits.revision = clone.revision;
    edits.lastEditedAt = clone.updatedAt;
    markParameterEdited(clone.diagnostics.lineage, parameterPath, newValue);
  }

  // 5. Run validateCandidateShape(clone).
  const shapeCheck = validateCandidateShape(clone);
  if (shapeCheck.errors.length > 0) {
    // 6. Validation failed: do NOT overwrite the previously valid
    // Candidate. The live session.candidate is untouched by this
    // function -- export remains available for the last valid state.
    console.error('[P1C User Edit Validation Failed]', {
      parameterPath, newValue, sessionId, generationId,
      errors: shapeCheck.errors, warnings: shapeCheck.warnings,
    });
    return { committed: false, candidate: null, reason: 'SHAPE_VALIDATION_FAILED', validationErrors: shapeCheck.errors };
  }

  // 7. Validation succeeded: mark the clone USER_EDITED and commit it
  // atomically over session.candidate.
  if (source === 'USER_EDIT') clone.status = CANDIDATE_STATUS.USER_EDITED;

  let updated = null;
  const result = updateActiveSession(sessionId, generationId, (s) => {
    // Belt-and-braces: if the live Candidate was replaced by something
    // else (a brand-new build, a Reset) while this transaction was
    // being prepared, do not clobber it with a clone of the stale one.
    if (!s.candidate || s.candidate.candidateId !== liveCandidate.candidateId || s.candidate.revision !== liveCandidate.revision) return;
    s.candidate = clone;
    if (source === 'USER_EDIT') _trace(s, 'CANDIDATE_PARAMETER_EDITED', { candidateId: clone.candidateId, parameterPath, revision: clone.revision });
    updated = s.candidate;
  });

  if (result.applied && updated) _notify('CANDIDATE_PARAMETER_EDITED', updated, { parameterPath, newValue });
  return {
    committed: result.applied && !!updated,
    candidate: updated,
    reason: result.applied ? (updated ? null : 'STALE_CANDIDATE_REPLACED') : result.reason,
    validationErrors: [],
  };
}

/**
 * Apply a shallow patch of {parameterPath: value} pairs as ONE atomic
 * revision bump (used by bulk operations like Reset-All-to-Auto).
 * Generation-gated.
 */
export function applyCandidatePatch(sessionId, generationId, patch, { source = 'PATCH', status = null } = {}) {
  if (!isActiveGeneration(sessionId, generationId)) return { committed: false, candidate: null, reason: 'STALE_GENERATION' };
  let updated = null;
  const result = updateActiveSession(sessionId, generationId, (s) => {
    if (!s.candidate) return;
    for (const [path, value] of Object.entries(patch)) _setByPath(s.candidate, path, value);
    s.candidate.revision = (s.candidate.revision ?? 0) + 1;
    s.candidate.updatedAt = Date.now();
    if (status) s.candidate.status = status;
    updated = s.candidate;
  });
  if (result.applied && updated) _notify('CANDIDATE_PATCHED', updated, { patch, source });
  return { committed: result.applied && !!updated, candidate: updated, reason: result.applied ? (updated ? null : 'NO_ACTIVE_CANDIDATE') : result.reason };
}

/**
 * Reset exactly one parameter to its recorded auto-generated value
 * (diagnostics.autoValues). No-op (committed:false) if the parameter
 * was never auto-generated or the group isn't in autoValues.
 */
export function resetParameterToAuto(sessionId, generationId, parameterPath) {
  const candidate = getActiveCandidate();
  if (!candidate?.diagnostics?.autoValues) return { committed: false, candidate: null, reason: 'NO_AUTO_VALUES' };
  const autoValue = _getByPath(candidate.diagnostics.autoValues, parameterPath);
  if (autoValue === undefined) return { committed: false, candidate: null, reason: 'PARAMETER_NOT_IN_AUTO_VALUES' };
  const r = updateCandidateParameter(sessionId, generationId, parameterPath, autoValue, { source: 'RESET_TO_AUTO' });
  if (r.committed) {
    updateActiveSession(sessionId, generationId, (s) => {
      const edits = s.candidate.diagnostics.manualEdits;
      edits.changedParameters = edits.changedParameters.filter((p) => p !== parameterPath);
      if (s.candidate.diagnostics.lineage[parameterPath]) s.candidate.diagnostics.lineage[parameterPath].manuallyEdited = false;
      if (edits.changedParameters.length === 0) s.candidate.status = CANDIDATE_STATUS.AUTO_GENERATED;
      _trace(s, 'CANDIDATE_RESET_TO_AUTO', { candidateId: s.candidate.candidateId, parameterPath });
    });
    _notify('CANDIDATE_RESET_TO_AUTO', getActiveCandidate(), { parameterPath });
  }
  return r;
}

/** Reset every Candidate value to its recorded auto-generated snapshot. */
export function resetAllToAuto(sessionId, generationId) {
  const candidate = getActiveCandidate();
  if (!candidate?.diagnostics?.autoValues) return { committed: false, candidate: null, reason: 'NO_AUTO_VALUES' };
  const av = candidate.diagnostics.autoValues;
  const result = updateActiveSession(sessionId, generationId, (s) => {
    s.candidate.whiteBalance = { ...av.whiteBalance };
    s.candidate.basic = { ...av.basic };
    s.candidate.curves = { ...av.curves, parametric: { ...av.curves.parametric } };
    s.candidate.hsl = {
      hue: { ...av.hsl.hue }, saturation: { ...av.hsl.saturation }, luminance: { ...av.hsl.luminance },
    };
    s.candidate.grading = {
      shadows: { ...av.grading.shadows }, midtones: { ...av.grading.midtones }, highlights: { ...av.grading.highlights },
      blending: av.grading.blending, balance: av.grading.balance,
    };
    s.candidate.cal = { ...av.cal };
    s.candidate.detail = { ...av.detail };
    s.candidate.revision = (s.candidate.revision ?? 0) + 1;
    s.candidate.updatedAt = Date.now();
    s.candidate.status = CANDIDATE_STATUS.AUTO_GENERATED;
    s.candidate.diagnostics.manualEdits = { changedParameters: [], revision: s.candidate.revision, lastEditedAt: s.candidate.updatedAt };
    for (const key of Object.keys(s.candidate.diagnostics.lineage)) s.candidate.diagnostics.lineage[key].manuallyEdited = false;
    _trace(s, 'CANDIDATE_RESET_TO_AUTO', { candidateId: s.candidate.candidateId, parameterPath: null });
  });
  if (result.applied) _notify('CANDIDATE_RESET_TO_AUTO', result.session.candidate, { parameterPath: null });
  return { committed: result.applied, candidate: result.applied ? result.session.candidate : null, reason: result.applied ? null : result.reason };
}

/** Clear the active Session's Candidate (used by handleReset() / new upload). */
export function clearActiveCandidate(sessionId, generationId) {
  if (!sessionId) { _notify('CANDIDATE_CLEARED', null); return { committed: true, candidate: null, reason: null }; }
  const result = updateActiveSession(sessionId, generationId, (s) => { s.candidate = null; _trace(s, 'CANDIDATE_CLEARED', {}); });
  _notify('CANDIDATE_CLEARED', null);
  return { committed: result.applied, candidate: null, reason: result.applied ? null : result.reason };
}

// Statuses considered safe to export -- unchanged from R1/R2: VALID,
// VALID_WITH_WARNINGS, and USER_EDITED (a successfully-validated manual
// edit is exactly as exportable as an auto-generated one).
const EXPORT_READY_STATUSES = Object.freeze([
  CANDIDATE_STATUS.VALID, CANDIDATE_STATUS.VALID_WITH_WARNINGS, CANDIDATE_STATUS.USER_EDITED,
]);

/**
 * EPIC 2E-P1C R3: full export-readiness diagnostic. Unlike
 * getValidatedCandidate() (which returns only the Candidate-or-null),
 * this never silently returns null without a reason -- it checks
 * Session existence, Candidate existence, session/generation
 * ownership (candidate.sessionId/candidate.generationId must match
 * the ACTIVE session -- not just "some candidate object exists"),
 * status, and full structural shape, in that order, and reports
 * exactly which check failed.
 *
 * @returns {{ready:boolean, candidate:object|null, reason:string|null, validationErrors:string[]}}
 *   reason is one of: null (ready), 'STALE_SESSION',
 *   'NO_ACTIVE_CANDIDATE', 'STALE_GENERATION', 'INVALID_STATUS',
 *   'SHAPE_VALIDATION_FAILED'.
 */
export function getCandidateExportReadiness() {
  const session = getActiveSession();
  if (!session) return { ready: false, candidate: null, reason: 'STALE_SESSION', validationErrors: [] };

  const candidate = session.candidate;
  if (!candidate) return { ready: false, candidate: null, reason: 'NO_ACTIVE_CANDIDATE', validationErrors: [] };

  // Ownership check: the stored Candidate must actually belong to the
  // currently-active Session/generation, not just be non-null (guards
  // against any future code path that could leave a stale Candidate
  // object reachable after a generation change).
  if (candidate.sessionId !== session.sessionId || candidate.generationId !== session.generationId) {
    return { ready: false, candidate: null, reason: 'STALE_GENERATION', validationErrors: [] };
  }

  if (!EXPORT_READY_STATUSES.includes(candidate.status)) {
    return { ready: false, candidate: null, reason: 'INVALID_STATUS', validationErrors: [] };
  }

  const shapeCheck = validateCandidateShape(candidate);
  if (shapeCheck.errors.length > 0) {
    return { ready: false, candidate: null, reason: 'SHAPE_VALIDATION_FAILED', validationErrors: shapeCheck.errors };
  }

  return { ready: true, candidate, reason: null, validationErrors: [] };
}

/**
 * Return the validated Candidate only if it is in a state safe to
 * export. Backed by getCandidateExportReadiness() (session/generation
 * ownership + status + full structural validation) -- kept as a
 * simple Candidate-or-null convenience wrapper for existing call
 * sites; use getCandidateExportReadiness() directly when the reason
 * for a `null` result needs to be shown to the user or logged.
 */
export function getValidatedCandidate() {
  return getCandidateExportReadiness().candidate;
}
