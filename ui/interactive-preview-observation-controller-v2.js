/**
 * ui/interactive-preview-observation-controller-v2.js
 *
 * EPIC 2E-J Phase A — a read-only, UI-local observation/feedback layer
 * sitting below the Interactive Before/After viewer. Records ONLY what
 * the person notices about the two approximate browser previews
 * ("Prefer Legacy" / "Prefer Controlled V2" / "No visible difference" /
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

// Safe single-read property access — a throwing getter degrades to the
// fallback, never a crash. Used at every untrusted-input boundary in
// this file (context objects, observation values, etc.).
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

function _safeNow() {
  try {
    const t = Date.now();
    return Number.isFinite(t) ? new Date(t).toISOString() : null;
  } catch {
    return null;
  }
}

// Builds the compact, DOM-free state object returned by every public
// method and passed to onStateChange. Never includes any DOM element.
function _buildState({ state, observation, observationGenerationId, currentGenerationId, interactiveComparisonReady, safetyReadOnly, createdAt, updatedAt, warnings, blockers }) {
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
    metadata: { blockers: Array.isArray(blockers) ? blockers.slice(0, 4) : [] },
  };
}

/**
 * FIX-pattern (mirrors the Interactive Before/After controller's own
 * shared-priority-function approach): a single, pure state-derivation
 * function so there is exactly one ruleset for "is this enabled, and if
 * not, why".
 *
 * @param {{ disposed: boolean, context: object|null, observation: (string|null), observationGenerationId: any, createdAt: (string|null), updatedAt: (string|null) }} input
 */
function deriveObservationStateV2(input) {
  const rec = _isRecord(input) ? input : {};
  const disposed = safeGet(rec, 'disposed') === true;
  const context = _isRecord(safeGet(rec, 'context')) ? rec.context : null;
  const observation = normalizeObservationValue(safeGet(rec, 'observation'));
  const observationGenerationId = safeGet(rec, 'observationGenerationId') ?? null;
  const createdAt = safeGet(rec, 'createdAt') ?? null;
  const updatedAt = safeGet(rec, 'updatedAt') ?? null;

  if (disposed) {
    return _buildState({ state: 'disposed', currentGenerationId: null, warnings: [], blockers: [] });
  }

  const generationId = safeGet(context, 'generationId') ?? null;
  const interactiveState = safeGet(context, 'interactiveState');
  const interactiveReady = safeGet(context, 'interactiveReady') === true;
  const safetyBlocked = safeGet(context, 'safetyBlocked') === true;

  // Observation is enabled ONLY when Interactive Before/After itself
  // reports "ready", both canvases are actually available, no safety
  // anomaly is active, and a real generation ID exists.
  const enabled = interactiveState === 'ready' && interactiveReady === true && !safetyBlocked && generationId !== null;

  if (safetyBlocked) {
    return _buildState({
      state: 'blocked', observationGenerationId, currentGenerationId: generationId,
      interactiveComparisonReady: interactiveReady, safetyReadOnly: true,
      createdAt, updatedAt, warnings: [],
      blockers: ['Observation is unavailable while the comparison is blocked.'],
    });
  }

  if (!enabled) {
    return _buildState({
      state: 'unavailable', observationGenerationId, currentGenerationId: generationId,
      interactiveComparisonReady: interactiveReady, safetyReadOnly: false,
      createdAt, updatedAt, warnings: [],
      blockers: ['Observation is available after both previews are ready.'],
    });
  }

  // Enabled — but a stale (previous-generation) selection must never be
  // displayed or carried forward.
  if (observation !== null && observationGenerationId === generationId) {
    return _buildState({
      state: 'selected', observation, observationGenerationId, currentGenerationId: generationId,
      interactiveComparisonReady: true, safetyReadOnly: false, createdAt, updatedAt,
      warnings: [], blockers: [],
    });
  }

  return _buildState({
    state: 'ready', observation: null, observationGenerationId: null, currentGenerationId: generationId,
    interactiveComparisonReady: true, safetyReadOnly: false, createdAt, updatedAt,
    warnings: [], blockers: [],
  });
}

/**
 * @param {{ root: HTMLElement, optionInputs: HTMLInputElement[], clearButton: HTMLElement, statusElement: HTMLElement, generationProvider: (()=>any)|null, onStateChange: ((state:object)=>void)|null }} options
 */
export function createInteractivePreviewObservationControllerV2(options) {
  const opts = _isRecord(options) ? options : {};
  const root = opts.root ?? null;
  const optionInputs = Array.isArray(opts.optionInputs) ? opts.optionInputs : [];
  const clearButton = opts.clearButton ?? null;
  const statusElement = opts.statusElement ?? null;
  const generationProvider = typeof opts.generationProvider === 'function' ? opts.generationProvider : null;
  const onStateChange = typeof opts.onStateChange === 'function' ? opts.onStateChange : null;

  let disposed = false;
  let context = null; // { generationId, interactiveState, interactiveReady, safetyBlocked }
  let observation = null;
  let observationGenerationId = null;
  let createdAt = null;
  let updatedAt = null;
  let lastState = deriveObservationStateV2({ disposed, context, observation, observationGenerationId, createdAt, updatedAt });

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
    lastState = deriveObservationStateV2({ disposed, context, observation, observationGenerationId, createdAt, updatedAt });
    return lastState;
  }

  /**
   * Sets the current Interactive Before/After context. Called by the
   * app-integration layer every time Interactive state changes.
   * @param {{ generationId: any, interactiveState: string, interactiveReady: boolean, safetyBlocked: boolean }} input
   */
  function setContext(input) {
    if (disposed) return lastState;
    const rec = _isRecord(input) ? input : {};
    const newGenerationId = safeGet(rec, 'generationId') ?? null;
    const newContext = {
      generationId: newGenerationId,
      interactiveState: typeof safeGet(rec, 'interactiveState') === 'string' ? rec.interactiveState : null,
      interactiveReady: safeGet(rec, 'interactiveReady') === true,
      safetyBlocked: safeGet(rec, 'safetyBlocked') === true,
    };
    const priorGenerationId = safeGet(context, 'generationId') ?? null;
    context = newContext;

    // GENERATION ASSOCIATION: if the generation changed, any existing
    // observation must be cleared immediately and never carried forward
    // — it is never migrated, never displayed against the new
    // generation, even transiently.
    let staleCleared = false;
    if (observation !== null && priorGenerationId !== null && newGenerationId !== priorGenerationId) {
      observation = null;
      observationGenerationId = null;
      createdAt = null;
      updatedAt = null;
      staleCleared = true;
    }

    _refresh();
    if (staleCleared) {
      lastState = { ...lastState, warnings: ['The previous observation was cleared because a newer analysis is active.'] };
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
    // Re-derive the CURRENT enabled/disabled status from context directly
    // rather than trusting `lastState.state`, which may be the transient
    // display value "cleared" left over from a just-completed
    // clearObservation() call — that transient value must never block a
    // fresh selection right afterward.
    const liveState = deriveObservationStateV2({ disposed, context, observation, observationGenerationId, createdAt, updatedAt });
    if (liveState.state !== 'ready' && liveState.state !== 'selected') return lastState; // not enabled
    const normalized = normalizeObservationValue(value);
    if (normalized === null) return lastState; // invalid value — silently ignored, never crashes

    const generationId = safeGet(context, 'generationId') ?? null;
    if (generationId === null) return lastState;

    observation = normalized;
    observationGenerationId = generationId;
    const now = _safeNow();
    if (createdAt === null) createdAt = now;
    updatedAt = now;

    _refresh();
    _emit();
    return lastState;
  }

  /** Removes the current observation. Does not reset analysis, does not rerender previews, does not affect split position or production. */
  function clearObservation() {
    if (disposed) return lastState;
    const hadObservation = observation !== null;
    observation = null;
    observationGenerationId = null;
    createdAt = null;
    updatedAt = null;
    _refresh();
    if (hadObservation) {
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
    lastState = deriveObservationStateV2({ disposed: true, context: null, observation: null, observationGenerationId: null, createdAt: null, updatedAt: null });
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
