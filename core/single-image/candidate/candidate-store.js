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
 */
export function updateCandidateParameter(sessionId, generationId, parameterPath, newValue, { source = 'USER_EDIT' } = {}) {
  if (!isActiveGeneration(sessionId, generationId)) return { committed: false, candidate: null, reason: 'STALE_GENERATION' };
  let updated = null;
  const result = updateActiveSession(sessionId, generationId, (s) => {
    if (!s.candidate) return;
    const ok = _setByPath(s.candidate, parameterPath, newValue);
    if (!ok) return;
    s.candidate.revision = (s.candidate.revision ?? 0) + 1;
    s.candidate.updatedAt = Date.now();
    if (source === 'USER_EDIT') {
      s.candidate.status = CANDIDATE_STATUS.USER_EDITED;
      const edits = s.candidate.diagnostics.manualEdits;
      if (!edits.changedParameters.includes(parameterPath)) edits.changedParameters.push(parameterPath);
      edits.revision = s.candidate.revision;
      edits.lastEditedAt = s.candidate.updatedAt;
      markParameterEdited(s.candidate.diagnostics.lineage, parameterPath, newValue);
      // Structural-only re-check (never a formula/range retune) — if a
      // genuinely corrupt value slipped past the caller's own clamp
      // (e.g. NaN from a malformed DOM read), downgrade to INVALID so
      // getValidatedCandidate() blocks export instead of silently
      // exporting a broken value.
      const shapeCheck = validateCandidateShape(s.candidate);
      if (shapeCheck.errors.length > 0) s.candidate.status = CANDIDATE_STATUS.INVALID;
      _trace(s, 'CANDIDATE_PARAMETER_EDITED', { candidateId: s.candidate.candidateId, parameterPath, revision: s.candidate.revision });
    }
    updated = s.candidate;
  });
  if (result.applied && updated) _notify('CANDIDATE_PARAMETER_EDITED', updated, { parameterPath, newValue });
  return { committed: result.applied && !!updated, candidate: updated, reason: result.applied ? (updated ? null : 'NO_ACTIVE_CANDIDATE') : result.reason };
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

/** Return the validated Candidate only if it is in a state safe to export (VALID or VALID_WITH_WARNINGS). Returns null otherwise. */
export function getValidatedCandidate() {
  const c = getActiveCandidate();
  if (!c) return null;
  if (c.status === CANDIDATE_STATUS.VALID || c.status === CANDIDATE_STATUS.VALID_WITH_WARNINGS || c.status === CANDIDATE_STATUS.USER_EDITED) return c;
  return null;
}
