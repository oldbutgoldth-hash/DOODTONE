/**
 * ui/interactive-preview-observation-controller-v2.js
 *
 * EPIC 2E-J Phase A (+ EPIC 2E-J-A-F, EPIC 2E-J-A-F2, EPIC 2E-J-A-F3
 * correctness patches) — a read-only, UI-local observation/feedback
 * layer sitting below the Interactive Before/After viewer. Records
 * ONLY what the person notices about the two approximate browser
 * previews ("Prefer Legacy" / "Prefer Controlled V2" / "No visible
 * difference" / "Unsure") — never a production decision, never an
 * approval of Controlled V2, never written into any core analysis
 * object.
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
// this file. Every projected property is read through this exactly
// once, and the returned value is reused — never a second direct
// access of the original object/property.
function safeGet(object, key, fallback = undefined) {
  try {
    if (!object || typeof object !== 'object') return fallback;
    return object[key];
  } catch {
    return fallback;
  }
}

// FIX 6 (EPIC 2E-J-A-F3): safely reads a method off a target ONCE and
// returns the callable (or null) — never re-reads the property again
// later. A hostile getter that throws degrades to "no method
// available" (the target is skipped), never a crash.
function _safeMethod(target, methodName) {
  const method = safeGet(target, methodName);
  return typeof method === 'function' ? method : null;
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

// One honest message per real cause — never a single generic
// "unavailable" message regardless of the actual reason.
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
// Neutral, not an error — never labeled "stale".
const PROVIDER_UNCONFIRMED_WARNING = 'Current generation could not be independently confirmed.';

// Builds the compact, DOM-free state object returned by every public
// method and passed to onStateChange. Never includes any DOM element.
function _buildState({ state, observation, observationGenerationId, currentGenerationId, interactiveComparisonReady, safetyReadOnly, createdAt, updatedAt, warnings, blockers, unavailableReason, contextGenerationId, providerGenerationId, providerConfigured, providerEvidenceAvailable, generationUsable, generationConfirmed }) {
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
      providerGenerationId: providerGenerationId ?? null,
      providerConfigured: providerConfigured === true,
      providerEvidenceAvailable: providerEvidenceAvailable === true,
      generationUsable: generationUsable === true,
      generationConfirmed: generationConfirmed === true,
    },
  };
}

// FIX 9 (EPIC 2E-J-A-F3): a compact, safe-primitives-only signature of
// a state object, used to detect a MEANINGFUL transition (never
// JSON.stringify of an arbitrary object, never exposes raw objects or
// "[object Object]").
function _stateSignature(state) {
  const s = _isRecord(state) ? state : {};
  const meta = _isRecord(s.metadata) ? s.metadata : {};
  const safePart = (v) => {
    if (v === null || v === undefined) return '';
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
    return '~'; // any other type (object/array/etc.) collapses to a fixed marker — never serialized directly
  };
  const firstWarning = Array.isArray(s.warnings) && s.warnings.length > 0 ? safePart(s.warnings[0]) : '';
  const firstBlocker = Array.isArray(meta.blockers) && meta.blockers.length > 0 ? safePart(meta.blockers[0]) : '';
  return [
    safePart(s.state), safePart(s.observation), safePart(s.observationGenerationId),
    safePart(meta.providerConfigured), safePart(meta.providerEvidenceAvailable),
    safePart(meta.generationUsable), safePart(meta.generationConfirmed),
    safePart(meta.unavailableReason), firstWarning, firstBlocker,
  ].join('|');
}

/**
 * FIX-pattern (mirrors the Interactive Before/After controller's own
 * shared-priority-function approach): a single, pure state-derivation
 * function so there is exactly one ruleset for "is this enabled, and if
 * not, why".
 *
 * @param {{
 *   disposed: boolean,
 *   context: ({ generationId: any, interactiveState: string, interactiveReady: boolean, safetyBlocked: boolean, blockedReason: (string|null) }|null),
 *   observation: (string|null), observationGenerationId: any,
 *   createdAt: (string|null), updatedAt: (string|null),
 *   providerResult: ({ configured: boolean, available: boolean, generationId: any }|null),
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
  const rawProviderResult = safeGet(rec, 'providerResult');
  const providerResult = _isRecord(rawProviderResult) ? rawProviderResult : { configured: false, available: false, generationId: null };
  const providerConfigured = safeGet(providerResult, 'configured') === true;
  const providerEvidenceAvailable = safeGet(providerResult, 'available') === true;
  const providerGenerationId = safeGet(providerResult, 'generationId') ?? null;

  if (disposed) {
    return _buildState({ state: 'disposed', currentGenerationId: null, warnings: [], blockers: [] });
  }

  const generationId = safeGet(context, 'generationId') ?? null;
  const interactiveState = _normalizeInteractiveState(safeGet(context, 'interactiveState'));
  const interactiveReady = safeGet(context, 'interactiveReady') === true;
  const safetyBlockedFlag = safeGet(context, 'safetyBlocked') === true;
  const blockedReason = _normalizeBlockedReason(safeGet(context, 'blockedReason'));

  let generationUsable, generationConfirmed;
  const providerMismatch = providerConfigured && providerEvidenceAvailable && generationId !== null && providerGenerationId !== generationId;
  if (!providerConfigured) {
    generationUsable = generationId !== null;
    generationConfirmed = false;
  } else if (providerEvidenceAvailable) {
    if (providerMismatch) {
      generationUsable = false;
      generationConfirmed = false;
    } else {
      generationUsable = generationId !== null;
      generationConfirmed = generationId !== null;
    }
  } else {
    generationUsable = generationId !== null;
    generationConfirmed = false;
  }

  const metaBase = { contextGenerationId: generationId, providerGenerationId, providerConfigured, providerEvidenceAvailable, generationUsable, generationConfirmed };

  if (providerMismatch) {
    return _buildState({
      state: 'unavailable', observationGenerationId: null, currentGenerationId: generationId,
      interactiveComparisonReady: false, safetyReadOnly: false, createdAt: null, updatedAt: null,
      warnings: [STALE_WARNING_MESSAGE], blockers: [STALE_WARNING_MESSAGE],
      unavailableReason: 'cancelled', ...metaBase,
    });
  }

  if (!generationUsable) {
    return _buildState({
      state: 'unavailable', observationGenerationId, currentGenerationId: generationId,
      interactiveComparisonReady: false, safetyReadOnly: false, createdAt, updatedAt,
      warnings: [], blockers: [UNAVAILABLE_REASON_MESSAGE['missing-generation']],
      unavailableReason: 'missing-generation', ...metaBase,
    });
  }

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
  const providerUnconfirmedWarning = (enabled && providerConfigured && !providerEvidenceAvailable) ? [PROVIDER_UNCONFIRMED_WARNING] : [];

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

  if (observation !== null && observationGenerationId === generationId) {
    return _buildState({
      state: 'selected', observation, observationGenerationId, currentGenerationId: generationId,
      interactiveComparisonReady: true, safetyReadOnly: false, createdAt, updatedAt,
      warnings: providerUnconfirmedWarning, blockers: [], unavailableReason: null, ...metaBase,
    });
  }

  return _buildState({
    state: 'ready', observation: null, observationGenerationId: null, currentGenerationId: generationId,
    interactiveComparisonReady: true, safetyReadOnly: false, createdAt, updatedAt,
    warnings: providerUnconfirmedWarning, blockers: [], unavailableReason: null, ...metaBase,
  });
}

/**
 * `root` and `statusElement` were accepted but never used — removed
 * from the options/API entirely rather than keeping misleading unused
 * fields. All DOM updates are the renderer's responsibility via
 * `renderInteractivePreviewObservationV2(container, state)`.
 *
 * @param {{ optionInputs: HTMLInputElement[], clearButton: HTMLElement, generationProvider: (()=>any)|null, onStateChange: ((state:object)=>void)|null }} options
 */
export function createInteractivePreviewObservationControllerV2(options) {
  const isOptionsRecord = _isRecord(options);
  const rawOptionInputs = isOptionsRecord ? safeGet(options, 'optionInputs') : undefined;
  const rawClearButton = isOptionsRecord ? safeGet(options, 'clearButton') : undefined;
  const rawGenerationProvider = isOptionsRecord ? safeGet(options, 'generationProvider') : undefined;
  const rawOnStateChange = isOptionsRecord ? safeGet(options, 'onStateChange') : undefined;

  // FIX 6/8 (EPIC 2E-J-A-F3): normalize optionInputs into a copied,
  // bounded array of { target, addEventListenerMethod,
  // removeEventListenerMethod } descriptors — the capability (a
  // callable addEventListener) is projected ONCE here and never
  // re-read from the original object again. A hostile getter that
  // throws on `addEventListener` simply causes that entry to be
  // skipped, never a crash. Deduplicated by target object identity;
  // the caller's original array is never mutated.
  const optionDescriptors = [];
  if (Array.isArray(rawOptionInputs)) {
    const seen = new Set();
    for (const item of rawOptionInputs.slice(0, 16)) {
      if (!item || typeof item !== 'object') continue;
      if (seen.has(item)) continue;
      const addEventListenerMethod = _safeMethod(item, 'addEventListener');
      if (!addEventListenerMethod) continue; // no usable capability — skip, never crash
      seen.add(item);
      const removeEventListenerMethod = _safeMethod(item, 'removeEventListener');
      optionDescriptors.push({ target: item, addEventListenerMethod, removeEventListenerMethod });
    }
  }
  const clearButtonAddListener = (rawClearButton && typeof rawClearButton === 'object') ? _safeMethod(rawClearButton, 'addEventListener') : null;
  const clearButtonRemoveListener = (rawClearButton && typeof rawClearButton === 'object') ? _safeMethod(rawClearButton, 'removeEventListener') : null;
  const clearButtonTarget = clearButtonAddListener ? rawClearButton : null;

  const generationProvider = typeof rawGenerationProvider === 'function' ? rawGenerationProvider : null;
  const onStateChange = typeof rawOnStateChange === 'function' ? rawOnStateChange : null;

  let disposed = false;
  let context = null; // { generationId, interactiveState, interactiveReady, safetyBlocked, blockedReason }
  let observation = null;
  let observationGenerationId = null;
  let createdAt = null;
  let updatedAt = null;

  /**
   * A structured provider read — never communicates provider state
   * through null/undefined ambiguity alone. A throwing provider is
   * NEVER treated as proof that context is current.
   * @returns {{ configured: boolean, available: boolean, generationId: any }}
   */
  function _readProviderGeneration() {
    if (!generationProvider) return { configured: false, available: false, generationId: null };
    try {
      const value = generationProvider();
      if (value === null || value === undefined) return { configured: true, available: false, generationId: null };
      return { configured: true, available: true, generationId: value };
    } catch {
      return { configured: true, available: false, generationId: null };
    }
  }

  // FIX 1 (EPIC 2E-J-A-F3): the single centralized helper for clearing
  // in-memory observation fields — used identically by every public
  // method that needs to clear a stale/invalid observation, never
  // duplicated inline.
  function _clearObservationMemory() {
    const hadObservation = observation !== null || observationGenerationId !== null || createdAt !== null || updatedAt !== null;
    observation = null;
    observationGenerationId = null;
    createdAt = null;
    updatedAt = null;
    return hadObservation;
  }

  // FIX 1: the single centralized helper for detecting a genuine
  // provider/context mismatch from one already-taken provider snapshot.
  function _providerMismatchesContext(providerResult) {
    const generationId = context ? context.generationId : null;
    return providerResult.configured === true && providerResult.available === true && generationId !== null && providerResult.generationId !== generationId;
  }

  let lastState = deriveObservationStateV2({ disposed, context, observation, observationGenerationId, createdAt, updatedAt, providerResult: _readProviderGeneration() });
  let lastSignature = _stateSignature(lastState);

  const listeners = [];
  // FIX 7 (EPIC 2E-J-A-F3): registers a listener using the ALREADY
  // PROJECTED callable method (never re-reading `target.addEventListener`
  // again). Only records the listener if registration genuinely
  // succeeds — a throwing addEventListener call is caught and the
  // listener is simply not recorded (never crashes controller setup).
  function _addListener(target, addEventListenerMethod, removeEventListenerMethod, type, handler) {
    if (!target || !addEventListenerMethod) return false;
    try {
      addEventListenerMethod.call(target, type, handler);
    } catch {
      return false;
    }
    listeners.push({ target, type, handler, removeEventListenerMethod });
    return true;
  }

  function _emitIfChanged() {
    const signature = _stateSignature(lastState);
    if (signature === lastSignature) return;
    lastSignature = signature;
    if (onStateChange) {
      try { onStateChange(lastState); } catch { /* a hostile/throwing consumer must not break this controller */ }
    }
  }

  // Every public operation takes exactly ONE provider snapshot and
  // reuses it throughout that single operation — never re-reading the
  // provider multiple times within one call.
  function _refreshWith(providerResult) {
    lastState = deriveObservationStateV2({ disposed, context, observation, observationGenerationId, createdAt, updatedAt, providerResult });
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
    const newGenerationId = safeGet(rec, 'generationId') ?? null;
    const rawInteractiveState = safeGet(rec, 'interactiveState');
    const newInteractiveState = typeof rawInteractiveState === 'string' ? rawInteractiveState : null;
    const newInteractiveReady = safeGet(rec, 'interactiveReady') === true;
    const newSafetyBlocked = safeGet(rec, 'safetyBlocked') === true;
    const rawBlockedReason = safeGet(rec, 'blockedReason');
    const newBlockedReason = _normalizeBlockedReason(rawBlockedReason);

    const priorGenerationId = context ? context.generationId : null;
    const wasReady = context ? (context.interactiveState === 'ready' && context.interactiveReady === true) : false;
    context = {
      generationId: newGenerationId,
      interactiveState: newInteractiveState,
      interactiveReady: newInteractiveReady,
      safetyBlocked: newSafetyBlocked,
      blockedReason: newBlockedReason,
    };

    // FIX 3 (EPIC 2E-J-A-F3): ONE provider snapshot for this entire
    // operation.
    const providerResult = _readProviderGeneration();

    const nowReady = newInteractiveState === 'ready' && newInteractiveReady === true;
    const generationChanged = priorGenerationId !== null && newGenerationId !== priorGenerationId;
    const leftReady = wasReady && !nowReady;
    // FIX 3: a provider that actively disagrees with the NEW context
    // must clear stale memory too — even when the context generation ID
    // itself didn't change and remains "Ready" on paper, a provider
    // mismatch means the context can no longer be trusted as current.
    const providerMismatch = _providerMismatchesContext(providerResult);

    let staleCleared = false;
    if (generationChanged || leftReady || providerMismatch) {
      staleCleared = _clearObservationMemory();
    }

    _refreshWith(providerResult);
    if (staleCleared) {
      lastState = { ...lastState, warnings: [STALE_WARNING_MESSAGE] };
    }
    _emitIfChanged();
    return lastState;
  }

  /**
   * Records an observation, associated with the CURRENT generation.
   * @param {string} value one of the 4 valid observation values
   */
  function selectObservation(value) {
    if (disposed) return lastState;
    // ONE provider snapshot for this entire operation.
    const providerResult = _readProviderGeneration();

    // FIX 2 (EPIC 2E-J-A-F3): a provider/context mismatch must clear
    // stale memory IMMEDIATELY and return the freshly-derived
    // stale/unavailable state — never merely returning the cached
    // `lastState` (which previously left the old selection sitting in
    // memory, able to silently reappear if the provider later returned
    // to the original generation).
    if (_providerMismatchesContext(providerResult)) {
      const staleCleared = _clearObservationMemory();
      _refreshWith(providerResult);
      if (staleCleared) lastState = { ...lastState, warnings: [STALE_WARNING_MESSAGE] };
      _emitIfChanged();
      return lastState;
    }

    const liveState = deriveObservationStateV2({ disposed, context, observation, observationGenerationId, createdAt, updatedAt, providerResult });
    if (liveState.state !== 'ready' && liveState.state !== 'selected') return lastState; // not enabled
    const normalized = normalizeObservationValue(value);
    if (normalized === null) return lastState; // invalid value — silently ignored, never crashes

    const generationId = context ? context.generationId : null;
    if (generationId === null) return lastState;

    observation = normalized;
    observationGenerationId = generationId;
    const now = _safeNow();
    if (createdAt === null) createdAt = now;
    updatedAt = now;

    _refreshWith(providerResult);
    _emitIfChanged();
    return lastState;
  }

  /**
   * Removes the current observation. Does not reset analysis, does not
   * rerender previews, does not affect split position or production.
   * FIX 5 (EPIC 2E-J-A-F3): if a provider mismatch is active, this
   * resolves to the actual stale/unavailable state (stale warning takes
   * priority) rather than forcing a misleading "cleared". If the
   * context is still genuinely Ready and the provider is current, this
   * resolves to the transient "cleared" display state as before.
   */
  function clearObservation() {
    if (disposed) return lastState;
    const providerResult = _readProviderGeneration(); // ONE snapshot for this operation
    const mismatch = _providerMismatchesContext(providerResult);
    const staleCleared = _clearObservationMemory();
    _refreshWith(providerResult);
    if (mismatch) {
      lastState = { ...lastState, warnings: [STALE_WARNING_MESSAGE] };
    } else if (staleCleared && lastState.state === 'ready') {
      lastState = { ...lastState, state: 'cleared' };
    }
    _emitIfChanged();
    return lastState;
  }

  /** Full reset: clears observation, timestamps, and generation association. Controller remains reusable. */
  function reset() {
    if (disposed) return lastState;
    context = null;
    _clearObservationMemory();
    _refreshWith(_readProviderGeneration());
    _emitIfChanged();
    return lastState;
  }

  /** Permanently disposes the controller: removes listeners (using each listener's own stored remove method, never re-reading the target), ignores all future updates. */
  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const { target, type, handler, removeEventListenerMethod } of listeners) {
      if (!removeEventListenerMethod) continue;
      try { removeEventListenerMethod.call(target, type, handler); } catch { /* best-effort */ }
    }
    listeners.length = 0;
    context = null;
    _clearObservationMemory();
    lastState = deriveObservationStateV2({ disposed: true, context: null, observation: null, observationGenerationId: null, createdAt: null, updatedAt: null, providerResult: { configured: false, available: false, generationId: null } });
  }

  /**
   * FIX 4 (EPIC 2E-J-A-F3): getState() re-reads the provider (ONE
   * snapshot) and re-derives before returning — never simply returning
   * a stale cached `lastState`. If the provider now disagrees with
   * context, observation MEMORY is cleared (via the same centralized
   * helper, not merely hidden through derivation) and a stale state is
   * returned; a previously-Selected observation is NEVER returned as
   * Selected once the provider reports a different generation, and can
   * never silently revive later.
   * FIX 9: onStateChange is emitted only on a genuine state-signature
   * change, not on every ordinary getState() call.
   */
  function getState() {
    if (disposed) return lastState;
    const providerResult = _readProviderGeneration(); // ONE snapshot
    const mismatch = _providerMismatchesContext(providerResult);
    let staleCleared = false;
    if (mismatch) staleCleared = _clearObservationMemory();

    _refreshWith(providerResult);
    if (staleCleared) {
      lastState = { ...lastState, warnings: [STALE_WARNING_MESSAGE] };
    }
    _emitIfChanged();
    return lastState;
  }

  // Wire native radio inputs and the Clear button using the
  // already-projected capability descriptors — never re-reading
  // `target.addEventListener` at registration time.
  for (const { target, addEventListenerMethod, removeEventListenerMethod } of optionDescriptors) {
    _addListener(target, addEventListenerMethod, removeEventListenerMethod, 'change', () => {
      if (target.checked) selectObservation(target.value);
    });
  }
  if (clearButtonTarget) {
    _addListener(clearButtonTarget, clearButtonAddListener, clearButtonRemoveListener, 'click', () => clearObservation());
  }

  // Emit the initial (unavailable) state immediately so the DOM is
  // synced from the very first render, rather than showing empty/
  // default HTML attribute values until the first setContext() call.
  if (onStateChange) {
    try { onStateChange(lastState); } catch { /* hostile consumer must not break setup */ }
  }

  return { setContext, selectObservation, clearObservation, reset, dispose, getState };
}

export { deriveObservationStateV2, normalizeObservationValue };
