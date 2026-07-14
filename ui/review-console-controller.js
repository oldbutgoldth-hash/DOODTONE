/**
 * ui/review-console-controller.js
 *
 * Controlled Preview Review Console — interaction controller
 * (EPIC 2E-F Phase C-B).
 *
 * Owns event wiring for the interactive Human Review controls rendered
 * by `ui/review-console-renderer.js`. This module NEVER computes
 * approval, progress, or any derived Review State field itself — every
 * state transition goes through the existing Review State Engine
 * (`core/lightroom-mapping-engine/mapping-v2-preview-review-state.js`):
 *
 * - updatePreviewReviewItemV2  — every Pass/Fail/Needs Adjustment/
 *   Pending/note action
 * - resetPreviewReviewStateV2  — the Reset Review action
 *
 * STATE OWNERSHIP: this controller does not hold the Review State
 * itself — it reads it via `getState()` and commits changes via
 * `setState(newState)`, both supplied by the caller (ui/app.js), which
 * is the single source of truth. This controller never mutates the
 * object returned by `getState()` — every engine call returns a NEW
 * state object per that engine's own immutability contract.
 *
 * NO PRODUCTION SIDE EFFECTS: nothing here ever touches Preview
 * Export, Production Write, Production Mapping, XMP export, or
 * localStorage/any persistence. Review approval remains purely
 * informational.
 *
 * EVENT SAFETY: uses ONE delegated listener set per `attach()` call,
 * scoped with an AbortController so a later `attach()` (e.g. after a
 * full console re-render replaces the DOM) — or `destroy()` — cleanly
 * removes the previous listeners without ever accumulating duplicates
 * across Re-analyze or new-image-import cycles.
 */

import { updatePreviewReviewItemV2, resetPreviewReviewStateV2 } from '../core/lightroom-mapping-engine/mapping-v2-preview-review-state.js';

// Canonical action → update payload mapping (per Phase C-B spec).
// These exact shapes are what the Review State Engine's own
// normalization logic expects — verified against
// updatePreviewReviewItemV2's status/decision/reviewed consistency
// rules; this controller only ever sends these four combinations, so
// the engine can never receive an unsupported combination.
const ACTION_UPDATES = {
  pass: { status: 'passed', reviewed: true, reviewerDecision: 'approve' },
  fail: { status: 'failed', reviewed: true, reviewerDecision: 'reject' },
  adjust: { status: 'pending', reviewed: true, reviewerDecision: 'needs-adjustment' },
  pending: { status: 'pending', reviewed: false, reviewerDecision: 'undecided' },
};

// Actions the spec treats as destructive enough to require a
// lightweight, inline (no window.confirm — this app has no existing
// modal system) two-step confirmation before committing.
const CONFIRM_REQUIRED_ACTIONS = new Set(['fail']);

const MAX_NOTE_LENGTH = 500;

/**
 * Trims a reviewer note to a safe, bounded string: strips excessive
 * trailing whitespace, preserves internal line breaks, and hard-caps
 * length at MAX_NOTE_LENGTH (the textarea's own maxlength attribute
 * already prevents typing past this, but input can arrive from paste
 * events that bypass maxlength enforcement in some browsers, so this
 * is enforced again here defensively).
 */
function _sanitizeNote(raw) {
  if (typeof raw !== 'string') return '';
  // Preserve internal newlines; only trim trailing whitespace/newlines
  // and leading whitespace, never collapse content the reviewer typed.
  const trimmed = raw.replace(/\s+$/u, '').replace(/^\s+/u, '');
  return trimmed.length > MAX_NOTE_LENGTH ? trimmed.slice(0, MAX_NOTE_LENGTH) : trimmed;
}

/**
 * Creates and attaches the interactive controller for one Review
 * Console container. Returns `{ destroy }` — the caller MUST call
 * `destroy()` before attaching a new controller to the same or a
 * different container (e.g. before a full re-render replaces the DOM,
 * or when tearing down for a new image import) to avoid leaking
 * listeners.
 *
 * @param {object} opts
 * @param {HTMLElement} opts.container - the element event delegation listens on (must contain the rendered console markup)
 * @param {() => object|null} opts.getState - returns the CURRENT editable Review State (or null)
 * @param {(newState: object|null) => void} opts.setState - commits a new Review State (the engine's return value) as current
 * @param {() => void} opts.rerender - re-renders the console from the (now-updated) current state; called after every committed action
 * @param {(message: string) => void} [opts.announce] - optional callback for concise user feedback (e.g. an aria-live toast); never receives raw error text
 */
export function createReviewConsoleController({ container, getState, setState, rerender, announce }) {
  if (!container || typeof container.addEventListener !== 'function') {
    return { destroy() {} };
  }

  // Per-item "are you sure?" state for destructive actions (Fail) and
  // one console-level flag for Reset — held in controller-local memory
  // only, never persisted, never part of the Review State object
  // itself (so it never leaks into updatePreviewReviewItemV2 payloads).
  const pendingConfirm = new Set(); // item IDs currently showing "Confirm Fail?"
  let resetConfirmPending = false;

  let abortController = new AbortController();

  function _safeAnnounce(message) {
    if (typeof announce === 'function') {
      try { announce(message); } catch { /* feedback is best-effort only — never let it break the actual state update */ }
    }
  }

  function _commitState(nextState, message) {
    setState(nextState);
    rerender();
    if (message) _safeAnnounce(message);
  }

  function _handleItemAction(itemId, action) {
    const current = getState();
    if (!current) return; // no active Review State to update against — safe no-op
    const update = ACTION_UPDATES[action];
    if (!update) return; // unrecognized action token — safe no-op, never guesses

    if (CONFIRM_REQUIRED_ACTIONS.has(action) && !pendingConfirm.has(itemId)) {
      // First click on a destructive action — arm the inline
      // confirmation instead of committing immediately.
      pendingConfirm.add(itemId);
      rerender();
      return;
    }
    pendingConfirm.delete(itemId);

    let next;
    try {
      next = updatePreviewReviewItemV2(current, itemId, update);
    } catch (err) {
      // Preserve the last valid state — never corrupt the UI, never
      // fall back to any "approved"-looking state, never expose the
      // raw error/stack trace to the user.
      _safeAnnounce('Could not update this review item. The previous review state was kept.');
      return;
    }

    const messages = {
      pass: 'Review item marked as passed.',
      fail: 'Review item marked as failed.',
      adjust: 'Adjustment requested.',
      pending: 'Review item returned to pending.',
    };
    _commitState(next, messages[action]);
  }

  function _handleCancelConfirm(itemId) {
    pendingConfirm.delete(itemId);
    rerender();
  }

  function _handleResetClick() {
    if (!resetConfirmPending) {
      resetConfirmPending = true;
      rerender();
      return;
    }
    const current = getState();
    resetConfirmPending = false;
    if (!current) { rerender(); return; }
    let next;
    try {
      next = resetPreviewReviewStateV2(current);
    } catch {
      _safeAnnounce('Could not reset the review state. The previous review state was kept.');
      rerender();
      return;
    }
    _commitState(next, 'Review state reset.');
  }

  function _handleResetCancel() {
    resetConfirmPending = false;
    rerender();
  }

  function _handleNoteCommit(itemId, rawValue, { skipRerender = false } = {}) {
    const current = getState();
    if (!current) return;
    const note = _sanitizeNote(rawValue);
    let next;
    try {
      next = updatePreviewReviewItemV2(current, itemId, { reviewerNote: note });
    } catch {
      _safeAnnounce('Could not save this note. The previous review state was kept.');
      return;
    }
    // Always commit the new state immediately — the whole point of
    // `skipRerender` is that a click action about to run next (see
    // `_handleFocusOut` below) reads `getState()` and must see this
    // note already applied ("the action update must use the latest
    // note state"). Only the DOM re-render is deferred, never the
    // state commit itself.
    setState(next);
    // Notes commit quietly (no toast spam on every blur) — the saved
    // text remaining visible in the textarea after re-render is
    // sufficient feedback.
    if (!skipRerender) rerender();
  }

  /**
   * EPIC 2E-F-C-B-F Bug 2 fix: true only when `el` is another
   * interactive Review Console control (an action button, including
   * Reset Review / Confirm-Fail / Cancel) that a `focusout` is
   * transferring focus TO. When true, the about-to-run `click` handler
   * for that same control is responsible for the next render — the
   * focusout handler must not rerender first, or it would replace the
   * DOM (destroying the very button the browser is about to dispatch
   * the click event to) before that click ever fires.
   */
  function _isPendingActionControl(el) {
    if (!el || typeof el.closest !== 'function' || !container.contains(el)) return false;
    return !!el.closest('[data-review-action]');
  }

  function _handleClick(e) {
    const actionBtn = e.target.closest('[data-review-action]');
    if (actionBtn) {
      const action = actionBtn.dataset.reviewAction;
      const itemRow = actionBtn.closest('[data-review-item-id]');
      const itemId = itemRow?.dataset.reviewItemId;

      if (action === 'cancel-confirm' && itemId) { _handleCancelConfirm(itemId); return; }
      if (action === 'reset-review') { _handleResetClick(); return; }
      if (action === 'reset-cancel') { _handleResetCancel(); return; }
      if (itemId) { _handleItemAction(itemId, action); return; }
      return;
    }
  }

  function _handleFocusOut(e) {
    const textarea = e.target.closest('textarea[data-review-note]');
    if (!textarea) return;
    const itemRow = textarea.closest('[data-review-item-id]');
    const itemId = itemRow?.dataset.reviewItemId;
    if (!itemId) return;
    // If focus is moving to another Review Console action control
    // (Pass/Fail/Adjust/Pending/Reset/Confirm/Cancel), that control's
    // own `click` handler will run immediately after this `focusout`
    // (browser event order: focusout → focus → click) and will perform
    // the single final rerender itself, using the just-committed note.
    // Rerendering HERE first would destroy that control before its
    // click ever fires, silently swallowing the user's action.
    const skipRerender = _isPendingActionControl(e.relatedTarget);
    _handleNoteCommit(itemId, textarea.value, { skipRerender });
  }

  function _handleInput(e) {
    const textarea = e.target.closest('textarea[data-review-note]');
    if (!textarea) return;
    const itemRow = textarea.closest('[data-review-item-id]');
    const itemId = itemRow?.dataset.reviewItemId;
    if (!itemId) return;
    // Live character counter only — never commits to the Review State
    // Engine on every keystroke (that would be wasteful and could race
    // with itself); the counter is a plain DOM text update, not a
    // re-render, so this stays cheap even for fast typing.
    const counter = container.querySelector(`[data-note-counter="${CSS.escape(itemId)}"]`);
    if (counter) counter.textContent = `${textarea.value.length}/${MAX_NOTE_LENGTH}`;
  }

  function attach() {
    abortController = new AbortController();
    const { signal } = abortController;
    container.addEventListener('click', _handleClick, { signal });
    // `focusout` (not `blur`) bubbles, so a single delegated listener
    // on the container can catch every textarea losing focus.
    container.addEventListener('focusout', _handleFocusOut, { signal });
    container.addEventListener('input', _handleInput, { signal });
  }

  function destroy() {
    abortController.abort();
    pendingConfirm.clear();
    resetConfirmPending = false;
  }

  /** Exposes read-only confirmation state so the renderer can reflect it (e.g. showing "Confirm Fail?" instead of "Fail"). Never mutated by the renderer. */
  function getUiState() {
    return { pendingConfirmItemIds: new Set(pendingConfirm), resetConfirmPending };
  }

  /**
   * EPIC 2E-F-C-B-F Bug 1 fix: clears transient, controller-local
   * confirmation state (armed "Confirm Fail?" prompts and the
   * console-level Reset confirmation) WITHOUT touching the Review
   * State object, WITHOUT rerendering, and WITHOUT tearing down event
   * listeners. This controller persists for the whole page session
   * (see module doc), so without an explicit reset, a "Confirm Fail?"
   * armed on one image's item could visually reappear on a DIFFERENT
   * image's item that happens to share the same canonical item ID
   * (every image uses the same fixed set of review item IDs). The
   * caller (ui/app.js) calls this at the start of a genuine new image
   * import / full app reset, BEFORE the new analysis result renders —
   * not on ordinary same-image Re-analyze, where an armed confirmation
   * MAY be intentionally cleared but the Review State itself must not
   * be touched by this function. Safe to call even when nothing is
   * currently armed.
   */
  function resetTransientUiState() {
    pendingConfirm.clear();
    resetConfirmPending = false;
  }

  attach();
  return { destroy, getUiState, resetTransientUiState };
}
