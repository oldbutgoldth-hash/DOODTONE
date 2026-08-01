/**
 * EPIC 2E-P1A — Single Image Analysis Session Store
 *
 * Holds the ONE currently-active Single Image Session (this project's
 * primary workflow analyzes one image at a time — this is a
 * single-slot registry by design, not a multi-session cache).
 *
 * This module owns identity/staleness ENFORCEMENT: every mutation must
 * present the sessionId + generationId it believes is current, and is
 * rejected if a newer Session/generation has since become active. This
 * directly closes the race condition documented in
 * P1A_SOURCE_LINEAGE_AUDIT.md Q13 — today `ui/app.js` has no such
 * check at all on its `state.last*` writes.
 */

let _active = null;
const _subscribers = new Set();

function _notify(eventType, session) {
  for (const fn of _subscribers) {
    try {
      fn({ type: eventType, session });
    } catch (_err) {
      // subscriber errors must never break the store
    }
  }
}

/** @returns {object|null} the currently active Session, or null. */
export function getActiveSession() {
  return _active;
}

/**
 * Install a Session as the active one, unconditionally. Used only by
 * the orchestrator when it has already decided this Session should
 * become current (e.g. on new upload). Does NOT abort the prior
 * session's in-flight work by itself — the orchestrator is
 * responsible for signalling its AbortController before calling this.
 */
export function setActiveSession(session) {
  _active = session;
  _notify('SESSION_ACTIVATED', session);
  return session;
}

/**
 * Apply `updaterFn(session)` to the active session, but ONLY if
 * `sessionId`/`generationId` still match the currently active Session.
 * Returns `{ applied: boolean, session: object|null }`.
 *
 * This is the single choke point stale-generation protection flows
 * through — every evidence/progress/status/report/candidate/xmp write
 * in the orchestrator goes through this function.
 */
export function updateActiveSession(sessionId, generationId, updaterFn) {
  if (!_active) return { applied: false, session: null, reason: 'NO_ACTIVE_SESSION' };
  if (_active.sessionId !== sessionId) {
    return { applied: false, session: _active, reason: 'STALE_SESSION_ID' };
  }
  if (_active.generationId !== generationId) {
    return { applied: false, session: _active, reason: 'STALE_GENERATION_ID' };
  }
  updaterFn(_active);
  _notify('SESSION_UPDATED', _active);
  return { applied: true, session: _active, reason: null };
}

/**
 * True if the given sessionId/generationId pair is still the active
 * one. Cheap check callers can use before doing expensive work that
 * they'd otherwise have to throw away.
 */
export function isActiveGeneration(sessionId, generationId) {
  return !!_active && _active.sessionId === sessionId && _active.generationId === generationId;
}

export function subscribe(fn) {
  _subscribers.add(fn);
  return () => _subscribers.delete(fn);
}

export function unsubscribe(fn) {
  _subscribers.delete(fn);
}

export function clearActiveSession() {
  const prev = _active;
  _active = null;
  _notify('SESSION_CLEARED', prev);
  return prev;
}

/** Test-only: reset all module state between test files/cases. */
export function __resetStoreForTests() {
  _active = null;
  _subscribers.clear();
}
