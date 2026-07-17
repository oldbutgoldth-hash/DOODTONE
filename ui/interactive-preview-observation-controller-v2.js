/**
 * ui/interactive-preview-observation-controller-v2.js
 *
 * EPIC 2E-J Phase A (+ EPIC 2E-J-A-F correctness patch) — a read-only,
 * UI-local observation/feedback layer sitting below the Interactive
 * Before/After viewer. Records ONLY what the person notices about the
 * two approximate browser previews ("Prefer Legacy" / "Prefer
 * Controlled V2" / "No visible difference" / "Unsure") — never a
 * production decision, never an approval of Controlled V2, never
 * written into any core analysis object.
 *
 * State ownership: this module owns ONLY the selected observation value,
 * its associated generation ID, in-memory timestamps, and UI-local
 * interaction/warning state. It never reads or writes finalStyleIntent,
 * the Visual Preview Render Plan, Side-by-Side Comparison, the
 * Interactive Before/After controller's own state, Review State,
 * Decision Report, Reference Transfer, Mapping, or XMP.
 *
 * No persistence: no localStorage/sessionStorage/IndexedDB/cookies/
 * network calls anywhere in this file. The observation intentionally
 * disappears on Re-analyze, New image, Reset, or page reload.
 */

const VALID_OBSERVATIONS = ['prefer-legacy', 'prefer-v2', 'no-visible-difference', 'unsure'];
const NORMALIZED_INTERACTIVE_STATES = ['preparing', 'ready', 'partial', 'failed', 'blocked', 'cancelled', 'unavailable'];
const VALID_BLOCKED_REASONS = ['safety', 'alignment', 'preview-state', 'source'];

// Safe single-read property access — a throwing getter degrades to the
// fallback, never a crash. Used at every untrusted-input boundary in
// this file (context objects, observation values, etc.). FIX 3
// (EPIC 2E-J-A-F): every projected property is read through this
// exactly once, and the returned value is reused — never a second
// direct access of the original object/property.
function safeGet(object, key, fallback = undefined) {
  try {
    if (!object || typeof object !== 'object') return fallback;
    return object[key];
  } catch {
    return fallback;
  }
}

function _isRecord(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Deterministic normalizer: exact string match only (no aliases, no
 * trimming into acceptance) — everything else becomes null.
 */
function normalizeObservationValue(value) {
  return VALID_OBSERVATIONS.includes(value) ? value : null;
}

function _normalizeInteractiveState(value) {
  return NORMALIZED_INTERACTIVE_STATES.includes(value) ? value : 'unavailable';
}

function _normalizeBlockedReason(value) {
  return VALID_BLOCKED_REASONS.includes(value) ? value : null;
}

function _safeNow() {
  try {
    const t = Date.now();
    return Number.isFinite(t) ? new Date(t).toISOString() : null;
  } catch {
    return null;
  }
}

function _safeWarningText(value, maxLen = 240) {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  if (!t) return null;
  return t.length > maxLen ? `${t.slice(0, maxLen)}…` : t;
}

// FIX 6 (EPIC 2E-J-A-F): one honest message per real cause — never a
// single generic "unavailable" message regardless of the actual reason.
const UNAVAILABLE_REASON_MESSAGE = {
  preparing: 'Observation will be available when both previews finish rendering.',
  partial: 'Observation is unavailable because only one preview rendered.',
  failed: 'Observation is unavailable because the comparison could not be prepared.',
  cancelled: 'The previous observation was cleared because a newer analysis is active.',
  alignment: 'Observation is unavailable because the previews cannot be aligned safely.',
  'preview-state': 'Observation is unavailable because one preview did not pass its render requirements.',
  source: 'Observation is unavailable because the preview sources are incomplete.',
  'missing-generation': 'Observation is unavailable because the current analysis generation is unknown.',
  'not-ready': 'Observation is available after both previews are ready.',
};
const SAFETY_BLOCKED_MESSAGE = 'Observation is unavailable while the comparison is blocked by a safety anomaly.';
const STALE_WARNING_MESSAGE = 'The previous observation was cleared because a newer analysis is active.';

// Builds the compact, DOM-free state object returned by every public
// method and passed to onStateChange. Never includes any DOM element.
function _buildState({ state, observation, observationGenerationId, currentGenerationId, interactiveComparisonReady, safetyReadOnly, createdAt, updatedAt, warnings, blockers, unavailableReason, contextGenerationId, providerGenerationId, generationConfirmed }) {
  return {
    state,
    observation: observation ?? null,
    observationGenerationId: observationGenerationId ?? null,
    currentGenerationId: currentGenerationId ?? null,
    interactiveComparisonReady: interactiveComparisonReady === true,
    safetyReadOnly: safetyReadOnly === true,
    createdAt: createdAt ?? null,
    updatedAt: updatedAt ?? null,
    warnings: Array.isArray(warnings) ? warnings.slice(0, 4) : [],
    metadata: {
      blockers: Array.isArray(blockers) ? blockers.slice(0, 4) : [],
      unavailableReason: unavailableReason ?? null,
      contextGenerationId: contextGenerationId ?? null,
      // FIX 5: `providerGenerationId` is `undefined` when no provider
      // exists at all — never displayed/treated as "confirmed" in that
      // case. Normalized to `null` here only for a stable shape.
      providerGenerationId: providerGenerationId === undefined ? null : providerGenerationId,
      generationConfirmed: generationConfirmed === true,
    },
  };
}

/**
 * FIX-pattern (mirrors the Interactive Before/After controller's own
 * shared-priority-function approach): a single, pure state-derivation
 * function so there is exactly one ruleset for "is this enabled, and if
 * not, why".
 *
 * Priority (EPIC 2E-J-A-F FIX 1/4/5/9): disposed → generation
 * unconfirmed (provider disagrees with context) → missing generation →
 * safety-blocked → ready+confirmed (enabled) → every other cause, with
 * an honest specific reason.
 *
 * @param {{
 *   disposed: boolean,
 *   context: ({ generationId: any, interactiveState: string, interactiveReady: boolean, safetyBlocked: boolean, blockedReason: (string|null) }|null),
 *   observation: (string|null), observationGenerationId: any,
 *   createdAt: (string|null), updatedAt: (string|null),
 *   hasProvider: boolean, providerGenerationId: any,
 * }} input
 */
function deriveObservationStateV2(input) {
  const rec = _isRecord(input) ? input : {};
  const disposed = safeGet(rec, 'disposed') === true;
  const rawContext = safeGet(rec, 'context');
  const context = _isRecord(rawContext) ? rawContext : null;
  const observation = normalizeObservationValue(safeGet(rec, 'observation'));
  const observationGenerationId = safeGet(rec, 'observationGenerationId') ?? null;
  const createdAt = safeGet(rec, 'createdAt') ?? null;
  const updatedAt = safeGet(rec, 'updatedAt') ?? null;
  const hasProvider = safeGet(rec, 'hasProvider') === true;
  const providerGenerationId = safeGet(rec, 'providerGenerationId');

  if (disposed) {
    return _buildState({ state: 'disposed', currentGenerationId: null, warnings: [], blockers: [] });
  }

  // FIX 3: each context field read exactly once via safeGet, stored,
  // never re-read from `context` directly afterward.
  const generationId = safeGet(context, 'generationId') ?? null;
  const interactiveState = _normalizeInteractiveState(safeGet(context, 'interactiveState'));
  const interactiveReady = safeGet(context, 'interactiveReady') === true;
  const safetyBlockedFlag = safeGet(context, 'safetyBlocked') === true;
  const blockedReason = _normalizeBlockedReason(safeGet(context, 'blockedReason'));

  // FIX 1/5: a provider that disagrees with the context generation
  // means the context is stale relative to the app's own canonical
  // generation counter — never trust the context alone when a working
  // provider says otherwise. A THROWING provider (surfaced upstream as
  // `hasProvider === true` but `providerGenerationId === null` from a
  // failed read) must NOT be treated as confirming anything — but it
  // must also not be treated as a mismatch; fall back to the context
  // value in that case (handled by the caller before this function is
  // invoked; see `_currentGeneration()`).
  const generationConfirmed = generationId !== null && (!hasProvider || providerGenerationId === undefined || providerGenerationId === generationId);
  const metaBase = { contextGenerationId: generationId, providerGenerationId, generationConfirmed };

  if (hasProvider && providerGenerationId !== undefined && generationId !== null && providerGenerationId !== generationId) {
    // FIX 8: a stale observation must never remain checked — clearing
    // the in-memory fields themselves is the CALLER's responsibility
    // (setContext/selectObservation), but the state we return here must
    // never show a selection against an unconfirmed generation.
    return _buildState({
      state: 'unavailable', observationGenerationId: null, currentGenerationId: generationId,
      interactiveComparisonReady: false, safetyReadOnly: false, createdAt: null, updatedAt: null,
      warnings: [STALE_WARNING_MESSAGE], blockers: [STALE_WARNING_MESSAGE],
      unavailableReason: 'cancelled', ...metaBase,
    });
  }

  if (generationId === null) {
    return _buildState({
      state: 'unavailable', observationGenerationId, currentGenerationId: null,
      interactiveComparisonReady: false, safetyReadOnly: false, createdAt, updatedAt,
      warnings: [], blockers: [UNAVAILABLE_REASON_MESSAGE['missing-generation']],
      unavailableReason: 'missing-generation', ...metaBase,
    });
  }

  // FIX 4: only an actual SAFETY anomaly ever produces the "blocked"
  // Observation state — every other Interactive Before/After cause
  // (alignment/preview-state/source/preparing/partial/failed/cancelled)
  // remains "unavailable" with its own honest reason, never conflated
  // with a safety anomaly.
  const isSafetyBlocked = safetyBlockedFlag || (interactiveState === 'blocked' && blockedReason === 'safety');
  if (isSafetyBlocked) {
    return _buildState({
      state: 'blocked', observationGenerationId, currentGenerationId: generationId,
      interactiveComparisonReady: interactiveReady, safetyReadOnly: true,
      createdAt, updatedAt, warnings: [],
      blockers: [SAFETY_BLOCKED_MESSAGE],
      unavailableReason: null, ...metaBase,
    });
  }

  const enabled = interactiveState === 'ready' && interactiveReady === true;

  if (!enabled) {
    let reason;
    if (interactiveState === 'blocked' && blockedReason === 'alignment') reason = 'alignment';
    else if (interactiveState === 'blocked' && blockedReason === 'preview-state') reason = 'preview-state';
    else if (interactiveState === 'blocked' && blockedReason === 'source') reason = 'source';
    else if (interactiveState === 'preparing') reason = 'preparing';
    else if (interactiveState === 'partial') reason = 'partial';
    else if (interactiveState === 'failed') reason = 'failed';
    else if (interactiveState === 'cancelled') reason = 'cancelled';
    else reason = 'not-ready';

    return _buildState({
      state: 'unavailable', observationGenerationId, currentGenerationId: generationId,
      interactiveComparisonReady: interactiveReady, safetyReadOnly: false,
      createdAt, updatedAt, warnings: [],
      blockers: [UNAVAILABLE_REASON_MESSAGE[reason] ?? UNAVAILABLE_REASON_MESSAGE['not-ready']],
      unavailableReason: reason, ...metaBase,
    });
  }

  // Enabled AND generation-confirmed — but a stale (previous-generation)
  // selection must never be displayed or carried forward.
  if (observation !== null && observationGenerationId === generationId) {
    return _buildState({
      state: 'selected', observation, observationGenerationId, currentGenerationId: generationId,
      interactiveComparisonReady: true, safetyReadOnly: false, createdAt, updatedAt,
      warnings: [], blockers: [], unavailableReason: null, ...metaBase,
    });
  }

  return _buildState({
    state: 'ready', observation: null, observationGenerationId: null, currentGenerationId: generationId,
    interactiveComparisonReady: true, safetyReadOnly: false, createdAt, updatedAt,
    warnings: [], blockers: [], unavailableReason: null, ...metaBase,
  });
}

/**
 * FIX 12 (EPIC 2E-J-A-F, option A): `root` and `statusElement` were
 * accepted but never used — removed from the options/API entirely
 * rather than keeping misleading unused fields. All DOM updates are the
 * renderer's responsibility via `renderInteractivePreviewObservationV2(container, state)`.
 *
 * @param {{ optionInputs: HTMLInputElement[], clearButton: HTMLElement, generationProvider: (()=>any)|null, onStateChange: ((state:object)=>void)|null }} options
 */
export function createInteractivePreviewObservationControllerV2(options) {
  const opts = _isRecord(options) ? options : {};
  const optionInputs = Array.isArray(opts.optionInputs) ? opts.optionInputs : [];
  const clearButton = opts.clearButton ?? null;
  const generationProvider = typeof opts.generationProvider === 'function' ? opts.generationProvider : null;
  const onStateChange = typeof opts.onStateChange === 'function' ? opts.onStateChange : null;
  const hasProvider = generationProvider !== null;

  let disposed = false;
  let context = null; // { generationId, interactiveState, interactiveReady, safetyBlocked, blockedReason }
  let observation = null;
  let observationGenerationId = null;
  let createdAt = null;
  let updatedAt = null;

  // FIX 1 (EPIC 2E-J-A-F): a safe wrapper around the generation
  // provider — a throwing provider must never crash and must never be
  // treated as confirming anything (returns null, which `deriveObservationStateV2`
  // treats as "provider evidence unavailable this read", falling back
  // to the context's own generation value rather than flagging a false
  // mismatch).
  function _currentGeneration() {
    if (!generationProvider) return null;
    try {
      const value = generationProvider();
      return value ?? null;
    } catch {
      return null;
    }
  }

  // A provider that returns/throws `null` gave no usable evidence THIS
  // READ — pass `undefined` (not `null`) into deriveObservationStateV2
  // so it is correctly treated as "fall back to context", never as a
  // generation mismatch against the context's real value.
  function _resolveProviderGenerationId() {
    if (!hasProvider) return undefined;
    const value = _currentGeneration();
    return value === null ? undefined : value;
  }

  let lastState = deriveObservationStateV2({ disposed, context, observation, observationGenerationId, createdAt, updatedAt, hasProvider, providerGenerationId: _resolveProviderGenerationId() });

  const listeners = [];
  function _addListener(target, type, handler) {
    if (!target || typeof target.addEventListener !== 'function') return;
    target.addEventListener(type, handler);
    listeners.push({ target, type, handler });
  }

  function _emit() {
    if (onStateChange) {
      try { onStateChange(lastState); } catch { /* a hostile/throwing consumer must not break this controller */ }
    }
  }

  function _refresh() {
    const providerGenerationId = _resolveProviderGenerationId();
    lastState = deriveObservationStateV2({ disposed, context, observation, observationGenerationId, createdAt, updatedAt, hasProvider, providerGenerationId });
    return lastState;
  }

  /**
   * Sets the current Interactive Before/After context. Called by the
   * app-integration layer every time Interactive state changes.
   * @param {{ generationId: any, interactiveState: string, interactiveReady: boolean, safetyBlocked: boolean, blockedReason: (string|null) }} input
   */
  function setContext(input) {
    if (disposed) return lastState;
    const rec = _isRecord(input) ? input : {};
    // FIX 3: single-read every field.
    const newGenerationId = safeGet(rec, 'generationId') ?? null;
    const rawInteractiveState = safeGet(rec, 'interactiveState');
    const newInteractiveState = typeof rawInteractiveState === 'string' ? rawInteractiveState : null;
    const newInteractiveReady = safeGet(rec, 'interactiveReady') === true;
    const newSafetyBlocked = safeGet(rec, 'safetyBlocked') === true;
    const rawBlockedReason = safeGet(rec, 'blockedReason');
    const newBlockedReason = _normalizeBlockedReason(rawBlockedReason);

    const priorGenerationId = context ? context.generationId : null;
    const wasReady = context ? (context.interactiveState === 'ready' && context.interactiveReady === true) : false;
    const newContext = {
      generationId: newGenerationId,
      interactiveState: newInteractiveState,
      interactiveReady: newInteractiveReady,
      safetyBlocked: newSafetyBlocked,
      blockedReason: newBlockedReason,
    };
    context = newContext;

    // FIX 9 (EPIC 2E-J-A-F): an observation is valid only while the
    // EXACT Ready comparison context remains valid — clear it
    // immediately whenever the generation changes OR the same
    // generation simply stops being Ready (Preparing/Partial/Failed/
    // Blocked/Cancelled), never only on a generation-ID change.
    const nowReady = newInteractiveState === 'ready' && newInteractiveReady === true;
    const generationChanged = priorGenerationId !== null && newGenerationId !== priorGenerationId;
    const leftReady = wasReady && !nowReady;
    let staleCleared = false;
    if (observation !== null && (generationChanged || leftReady)) {
      observation = null;
      observationGenerationId = null;
      createdAt = null;
      updatedAt = null;
      staleCleared = true;
    }

    _refresh();
    if (staleCleared) {
      lastState = { ...lastState, warnings: [STALE_WARNING_MESSAGE] };
    }
    _emit();
    return lastState;
  }

  /**
   * Records an observation, associated with the CURRENT generation.
   * @param {string} value one of the 4 valid observation values
   */
  function selectObservation(value) {
    if (disposed) return lastState;
    // Re-derive the CURRENT enabled/disabled status from context/provider
    // directly rather than trusting `lastState.state`, which may be the
    // transient display value "cleared" left over from a just-completed
    // clearObservation() call — that transient value must never block a
    // fresh selection right afterward.
    const providerGenerationId = _resolveProviderGenerationId();
    const liveState = deriveObservationStateV2({ disposed, context, observation, observationGenerationId, createdAt, updatedAt, hasProvider, providerGenerationId });
    if (liveState.state !== 'ready' && liveState.state !== 'selected') return lastState; // not enabled
    const normalized = normalizeObservationValue(value);
    if (normalized === null) return lastState; // invalid value — silently ignored, never crashes

    const generationId = context ? context.generationId : null;
    if (generationId === null) return lastState;
    // FIX 1: before accepting, verify the provider (when available and
    // non-throwing this read) agrees with the context generation.
    if (hasProvider && providerGenerationId !== undefined && providerGenerationId !== generationId) return lastState;

    observation = normalized;
    observationGenerationId = generationId;
    const now = _safeNow();
    if (createdAt === null) createdAt = now;
    updatedAt = now;

    _refresh();
    _emit();
    return lastState;
  }

  /**
   * Removes the current observation. Does not reset analysis, does not
   * rerender previews, does not affect split position or production.
   * FIX 11 (EPIC 2E-J-A-F): if the context is still genuinely Ready,
   * this resolves to the transient "cleared" display state (controls
   * remain enabled, ready for an immediate new selection). If the
   * context is no longer Ready, this resolves to the ACTUAL unavailable
   * state instead of forcing a misleading "cleared".
   */
  function clearObservation() {
    if (disposed) return lastState;
    const hadObservation = observation !== null;
    observation = null;
    observationGenerationId = null;
    createdAt = null;
    updatedAt = null;
    _refresh();
    if (hadObservation && lastState.state === 'ready') {
      lastState = { ...lastState, state: 'cleared' };
    }
    _emit();
    return lastState;
  }

  /** Full reset: clears observation, timestamps, and generation association. Controller remains reusable. */
  function reset() {
    if (disposed) return lastState;
    context = null;
    observation = null;
    observationGenerationId = null;
    createdAt = null;
    updatedAt = null;
    _refresh();
    _emit();
    return lastState;
  }

  /** Permanently disposes the controller: removes listeners, ignores all future updates. */
  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const { target, type, handler } of listeners) {
      try { target.removeEventListener(type, handler); } catch { /* best-effort */ }
    }
    listeners.length = 0;
    context = null;
    observation = null;
    observationGenerationId = null;
    lastState = deriveObservationStateV2({ disposed: true, context: null, observation: null, observationGenerationId: null, createdAt: null, updatedAt: null, hasProvider: false, providerGenerationId: undefined });
  }

  function getState() {
    return lastState;
  }

  // Wire native radio inputs and the Clear button. Missing elements are
  // handled safely — this controller works with zero DOM elements
  // (state-only usage) for testability.
  for (const input of optionInputs) {
    if (!input || typeof input.addEventListener !== 'function') continue;
    _addListener(input, 'change', () => {
      if (input.checked) selectObservation(input.value);
    });
  }
  _addListener(clearButton, 'click', () => clearObservation());

  // Emit the initial (unavailable) state immediately so the DOM is
  // synced from the very first render, rather than showing empty/
  // default HTML attribute values until the first setContext() call.
  _emit();

  return { setContext, selectObservation, clearObservation, reset, dispose, getState };
}

export { deriveObservationStateV2, normalizeObservationValue };
