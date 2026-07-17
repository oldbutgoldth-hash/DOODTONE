/**
 * ui/interactive-preview-observation-controller-v2.js
 *
 * EPIC 2E-J Phase A (+ EPIC 2E-J-A-F, EPIC 2E-J-A-F2 correctness
 * patches) — a read-only, UI-local observation/feedback layer sitting
 * below the Interactive Before/After viewer. Records ONLY what the
 * person notices about the two approximate browser previews ("Prefer
 * Legacy" / "Prefer Controlled V2" / "No visible difference" /
 * "Unsure") — never a production decision, never an approval of
 * Controlled V2, never written into any core analysis object.
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
// FIX 7 (EPIC 2E-J-A-F2): neutral, not an error — never labeled "stale".
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
      // FIX 1 (EPIC 2E-J-A-F2): generation *usability* (can we act on
      // this generation at all, falling back to context when the
      // provider gives no evidence) is now explicitly separate from
      // generation *confirmation* (the provider actively agreed with
      // context this read) — a missing/throwing/unavailable provider
      // must never be displayed or treated as "confirmed".
      contextGenerationId: contextGenerationId ?? null,
      providerGenerationId: providerGenerationId ?? null,
      providerConfigured: providerConfigured === true,
      providerEvidenceAvailable: providerEvidenceAvailable === true,
      generationUsable: generationUsable === true,
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

  // Each context field read exactly once via safeGet, stored, never
  // re-read from `context` directly afterward.
  const generationId = safeGet(context, 'generationId') ?? null;
  const interactiveState = _normalizeInteractiveState(safeGet(context, 'interactiveState'));
  const interactiveReady = safeGet(context, 'interactiveReady') === true;
  const safetyBlockedFlag = safeGet(context, 'safetyBlocked') === true;
  const blockedReason = _normalizeBlockedReason(safeGet(context, 'blockedReason'));

  // FIX 1 (EPIC 2E-J-A-F2): generationUsable/generationConfirmed
  // computed per the phase's exact 4-case rule table.
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
    // Configured but threw or returned no usable value THIS READ.
    generationUsable = generationId !== null;
    generationConfirmed = false;
  }

  const metaBase = { contextGenerationId: generationId, providerGenerationId, providerConfigured, providerEvidenceAvailable, generationUsable, generationConfirmed };

  if (providerMismatch) {
    // A configured, working provider actively disagrees with context —
    // this is a genuine stale-generation condition. A stale observation
    // must never remain checked; clearing the in-memory fields
    // themselves is the CALLER's responsibility, but the state we
    // return here must never show a selection against an unconfirmed
    // generation.
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

  // Only an actual SAFETY anomaly ever produces the "blocked"
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

  // FIX 7 (EPIC 2E-J-A-F2): when Context is genuinely Ready but a
  // configured provider gave no usable evidence THIS READ, controls
  // remain enabled using the Context fallback — `generationConfirmed`
  // stays false and a neutral (never "stale"/error-styled) warning is
  // surfaced.
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

  // Enabled — but a stale (previous-generation) selection must never be
  // displayed or carried forward.
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
  // FIX 5 (EPIC 2E-J-A-F2): every options property is safely read
  // exactly once here — a hostile getter (always-throwing or
  // throw-on-second-read) on any of these must never crash controller
  // creation.
  const isOptionsRecord = _isRecord(options);
  const rawOptionInputs = isOptionsRecord ? safeGet(options, 'optionInputs') : undefined;
  const rawClearButton = isOptionsRecord ? safeGet(options, 'clearButton') : undefined;
  const rawGenerationProvider = isOptionsRecord ? safeGet(options, 'generationProvider') : undefined;
  const rawOnStateChange = isOptionsRecord ? safeGet(options, 'onStateChange') : undefined;

  // FIX 6 (EPIC 2E-J-A-F2): normalize optionInputs into a copied,
  // bounded array containing only elements that genuinely support
  // addEventListener, deduplicated by object identity — the caller's
  // original array is never mutated, and no arbitrary array entry is
  // retained as an event target.
  const optionInputs = [];
  if (Array.isArray(rawOptionInputs)) {
    const seen = new Set();
    for (const item of rawOptionInputs.slice(0, 16)) {
      if (!item || typeof item !== 'object' || typeof item.addEventListener !== 'function') continue;
      if (seen.has(item)) continue;
      seen.add(item);
      optionInputs.push(item);
    }
  }
  const clearButton = (rawClearButton && typeof rawClearButton === 'object') ? rawClearButton : null;
  const generationProvider = typeof rawGenerationProvider === 'function' ? rawGenerationProvider : null;
  const onStateChange = typeof rawOnStateChange === 'function' ? rawOnStateChange : null;

  let disposed = false;
  let context = null; // { generationId, interactiveState, interactiveReady, safetyBlocked, blockedReason }
  let observation = null;
  let observationGenerationId = null;
  let createdAt = null;
  let updatedAt = null;

  /**
   * FIX 2 (EPIC 2E-J-A-F2): a structured provider read — never
   * communicates provider state through null/undefined ambiguity
   * alone. A throwing provider is NEVER treated as proof that context
   * is current.
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

  let lastState = deriveObservationStateV2({ disposed, context, observation, observationGenerationId, createdAt, updatedAt, providerResult: _readProviderGeneration() });

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

  // FIX 4 (EPIC 2E-J-A-F2): every public operation takes exactly ONE
  // provider snapshot and reuses it throughout that single operation —
  // never re-reading the provider multiple times within one call, which
  // could otherwise produce internally contradictory state if the
  // provider's value changes mid-operation.
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
    const newContext = {
      generationId: newGenerationId,
      interactiveState: newInteractiveState,
      interactiveReady: newInteractiveReady,
      safetyBlocked: newSafetyBlocked,
      blockedReason: newBlockedReason,
    };
    context = newContext;

    // An observation is valid only while the EXACT Ready comparison
    // context remains valid — clear it immediately whenever the
    // generation changes OR the same generation simply stops being
    // Ready (Preparing/Partial/Failed/Blocked/Cancelled), never only on
    // a generation-ID change.
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

    _refreshWith(_readProviderGeneration());
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
    // ONE provider snapshot for this entire operation.
    const providerResult = _readProviderGeneration();
    // Re-derive the CURRENT enabled/disabled status from context/provider
    // directly rather than trusting `lastState.state`, which may be the
    // transient display value "cleared" left over from a just-completed
    // clearObservation() call — that transient value must never block a
    // fresh selection right afterward.
    const liveState = deriveObservationStateV2({ disposed, context, observation, observationGenerationId, createdAt, updatedAt, providerResult });
    if (liveState.state !== 'ready' && liveState.state !== 'selected') return lastState; // not enabled
    const normalized = normalizeObservationValue(value);
    if (normalized === null) return lastState; // invalid value — silently ignored, never crashes

    const generationId = context ? context.generationId : null;
    if (generationId === null) return lastState;
    // Before accepting, verify the provider — when it actively gave
    // evidence this read — agrees with the context generation. A
    // provider that gave NO evidence (unconfigured, threw, or returned
    // null/undefined) does not block acceptance: the selection is
    // associated with context per FIX 7's fallback policy, with
    // `generationConfirmed` honestly left false.
    if (providerResult.configured && providerResult.available && providerResult.generationId !== generationId) return lastState;

    observation = normalized;
    observationGenerationId = generationId;
    const now = _safeNow();
    if (createdAt === null) createdAt = now;
    updatedAt = now;

    _refreshWith(providerResult);
    _emit();
    return lastState;
  }

  /**
   * Removes the current observation. Does not reset analysis, does not
   * rerender previews, does not affect split position or production.
   * If the context is still genuinely Ready, this resolves to the
   * transient "cleared" display state (controls remain enabled, ready
   * for an immediate new selection). If the context is no longer Ready,
   * this resolves to the ACTUAL unavailable state instead of forcing a
   * misleading "cleared".
   */
  function clearObservation() {
    if (disposed) return lastState;
    const providerResult = _readProviderGeneration(); // ONE snapshot for this operation
    const hadObservation = observation !== null;
    observation = null;
    observationGenerationId = null;
    createdAt = null;
    updatedAt = null;
    _refreshWith(providerResult);
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
    _refreshWith(_readProviderGeneration());
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
    lastState = deriveObservationStateV2({ disposed: true, context: null, observation: null, observationGenerationId: null, createdAt: null, updatedAt: null, providerResult: { configured: false, available: false, generationId: null } });
  }

  /**
   * FIX 3 (EPIC 2E-J-A-F2): getState() re-reads the provider (ONE
   * snapshot) and re-derives before returning — never simply returning
   * a stale cached `lastState`. If the provider now disagrees with
   * context, the observation is cleared immediately and a stale state
   * is returned; a previously-Selected observation is NEVER returned as
   * Selected once the provider reports a different generation.
   * onStateChange is emitted only on a MEANINGFUL transition (the
   * resolved state actually changed) — not on every ordinary getState()
   * call, to avoid needless render churn from passive polling.
   */
  function getState() {
    if (disposed) return lastState;
    const providerResult = _readProviderGeneration();
    const previousStateLabel = lastState.state;
    const previousObservation = lastState.observation;

    const generationId = context ? context.generationId : null;
    const mismatch = providerResult.configured && providerResult.available && generationId !== null && providerResult.generationId !== generationId;
    if (mismatch && observation !== null) {
      observation = null;
      observationGenerationId = null;
      createdAt = null;
      updatedAt = null;
    }

    _refreshWith(providerResult);
    if (mismatch) {
      lastState = { ...lastState, warnings: [STALE_WARNING_MESSAGE] };
    }

    const meaningfulChange = lastState.state !== previousStateLabel || lastState.observation !== previousObservation;
    if (meaningfulChange) _emit();
    return lastState;
  }

  // Wire native radio inputs and the Clear button. Missing elements are
  // handled safely — this controller works with zero DOM elements
  // (state-only usage) for testability.
  for (const input of optionInputs) {
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
