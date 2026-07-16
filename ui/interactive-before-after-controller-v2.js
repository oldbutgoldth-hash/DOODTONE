/**
 * ui/interactive-before-after-controller-v2.js
 *
 * EPIC 2E-I Phase A — Interactive Before/After Visual Comparison.
 *
 * A read-only, split-overlay interactive viewer built ONLY on top of
 * the already-rendered Legacy/Controlled-V2 preview canvases produced
 * by `ui/visual-preview-comparison-controller-v2.js`. This module:
 *
 * - never re-runs analysis, never rebuilds the Render Plan
 * - never calls the isolated pixel renderer
 * - never reads the original source image or reprocesses pixels
 * - never mutates the Legacy/V2 preview SOURCE canvases (their
 *   lifecycle is owned entirely by the existing Preview Comparison
 *   Controller) — this module only ever READS them, once per source
 *   update, into its own small bounded display canvases
 * - never writes any state into finalStyleIntent, the Render Plan,
 *   Side-by-Side Comparison, Review State, Decision Report, or
 *   Reference Transfer — everything here is UI-local
 * - remains strictly read-only: no Apply/Export/Download/Save/
 *   Activate/persistence of any kind
 *
 * DISPLAY STRATEGY: each source preview canvas is copied ONCE (via a
 * single `drawImage()` call) into this module's own small bounded
 * "display canvas" whenever `updateSources()` is called (i.e. once per
 * successful analysis generation) — never on every pointer/slider
 * movement. Slider movement afterward only ever changes a CSS custom
 * property (`--comparison-split`) and a `clip-path`, which is
 * essentially free to repaint.
 */

function _isRecord(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// Safe property access — a malformed/hostile source object with a
// throwing getter (e.g. a hostile `width`/`height` getter) must never
// crash this controller. Any read that throws is treated as missing.
function safeGet(object, key, fallback = undefined) {
  try {
    if (!object || typeof object !== 'object') return fallback;
    return object[key];
  } catch {
    return fallback;
  }
}

const ASPECT_RATIO_TOLERANCE = 0.02; // ~2% relative tolerance, documented

function _clampSplit(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 50;
  return Math.max(0, Math.min(100, n));
}

function _validateCanvasLike(canvas) {
  if (!canvas || typeof canvas !== 'object') return false;
  try {
    return typeof canvas.getContext === 'function';
  } catch {
    return false;
  }
}

/**
 * Reads width/height off a canvas-like object safely (hostile getters
 * never throw out of this function) and returns null dimensions if
 * anything is invalid.
 */
function _readCanvasDimensions(canvas) {
  const w = safeGet(canvas, 'width');
  const h = safeGet(canvas, 'height');
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  return { width: w, height: h };
}

/**
 * Builds the compact alignment metadata object per the phase's
 * suggested shape. `sameAspectRatio` uses a small documented tolerance
 * (2%, relative); `exactPixelMatch` requires literally identical
 * backing dimensions.
 */
function _computeAlignment(legacyDims, v2Dims) {
  if (!legacyDims || !v2Dims) {
    return {
      legacyWidth: legacyDims?.width ?? null, legacyHeight: legacyDims?.height ?? null,
      v2Width: v2Dims?.width ?? null, v2Height: v2Dims?.height ?? null,
      sameAspectRatio: false, normalizedDisplayRatio: null, exactPixelMatch: false,
    };
  }
  const legacyRatio = legacyDims.width / legacyDims.height;
  const v2Ratio = v2Dims.width / v2Dims.height;
  const relativeDiff = Math.abs(legacyRatio - v2Ratio) / Math.max(legacyRatio, v2Ratio);
  const sameAspectRatio = relativeDiff <= ASPECT_RATIO_TOLERANCE;
  const exactPixelMatch = legacyDims.width === v2Dims.width && legacyDims.height === v2Dims.height;
  return {
    legacyWidth: legacyDims.width, legacyHeight: legacyDims.height,
    v2Width: v2Dims.width, v2Height: v2Dims.height,
    sameAspectRatio, normalizedDisplayRatio: legacyRatio, exactPixelMatch,
  };
}

/** Copies a source canvas's current pixels into a bounded display canvas ONCE. Never called on every pointer movement. */
function _copyCanvasToDisplay(sourceCanvas, displayCanvas) {
  if (!sourceCanvas || !displayCanvas) return false;
  try {
    const dims = _readCanvasDimensions(sourceCanvas);
    if (!dims) return false;
    displayCanvas.width = dims.width;
    displayCanvas.height = dims.height;
    const ctx = displayCanvas.getContext('2d');
    if (!ctx) return false;
    ctx.clearRect(0, 0, dims.width, dims.height);
    ctx.drawImage(sourceCanvas, 0, 0);
    return true;
  } catch {
    return false;
  }
}

function _unavailableState(extra = {}) {
  return {
    state: 'unavailable',
    splitPercent: 50,
    legacyAvailable: false,
    v2Available: false,
    bothAvailable: false,
    interactive: false,
    sourceGenerationId: null,
    currentGenerationId: null,
    alignment: _computeAlignment(null, null),
    warnings: [],
    blockers: [],
    metadata: {},
    ...extra,
  };
}

/**
 * Creates the Interactive Before/After controller.
 *
 * @param {{
 *   legacyDisplayCanvas: HTMLCanvasElement,
 *   v2DisplayCanvas: HTMLCanvasElement,
 *   overlayWrapper: HTMLElement,
 *   viewport: HTMLElement,
 *   dividerElement: HTMLElement,
 *   handleElement: HTMLElement,
 *   rangeInput: HTMLInputElement,
 *   generationProvider: () => (number|string|null),
 *   onStateChange?: (state: object) => void,
 * }} options
 */
export function createInteractiveBeforeAfterControllerV2(options = {}) {
  const {
    legacyDisplayCanvas, v2DisplayCanvas, overlayWrapper, viewport,
    dividerElement, handleElement, rangeInput, generationProvider, onStateChange,
  } = options;

  let disposed = false;
  let splitPercent = 50;
  let sourceGenerationId = null;
  let legacyAvailable = false;
  let v2Available = false;
  let alignment = _computeAlignment(null, null);
  let lastState = _unavailableState();
  let isDragging = false;
  let rafPending = false;
  let activePointerId = null;

  const hasGenerationProvider = typeof generationProvider === 'function';

  function _currentGeneration() {
    if (!hasGenerationProvider) return sourceGenerationId; // no provider — never treat as stale
    try {
      return generationProvider();
    } catch {
      return null;
    }
  }

  function _isStale() {
    if (!hasGenerationProvider) return false;
    return sourceGenerationId !== _currentGeneration();
  }

  function _applySplitToDom(percent) {
    if (viewport && viewport.style) viewport.style.setProperty('--comparison-split', `${percent}%`);
    if (overlayWrapper && overlayWrapper.style) {
      overlayWrapper.style.clipPath = `inset(0 ${100 - percent}% 0 0)`;
    }
    if (dividerElement && dividerElement.style) dividerElement.style.left = `${percent}%`;
    if (handleElement) {
      if (handleElement.style) handleElement.style.left = `${percent}%`;
      handleElement.setAttribute('aria-valuenow', String(Math.round(percent)));
    }
    if (rangeInput && rangeInput.value !== String(Math.round(percent))) {
      rangeInput.value = String(Math.round(percent));
    }
  }

  function _emitStateChange() {
    if (typeof onStateChange === 'function') {
      try { onStateChange(lastState); } catch { /* a caller's own callback error must never break this controller */ }
    }
  }

  function _computeInteractiveState() {
    if (disposed) return _unavailableState({ warnings: [], blockers: ['Interactive Before/After controller has been disposed.'] });

    const stale = _isStale();
    if (stale) {
      return _unavailableState({
        state: 'cancelled',
        sourceGenerationId,
        currentGenerationId: _currentGeneration(),
        blockers: ['Interactive comparison was cancelled because a newer analysis is active.'],
      });
    }

    if (!legacyAvailable && !v2Available) {
      return _unavailableState({ sourceGenerationId, currentGenerationId: _currentGeneration() });
    }
    if (legacyAvailable && !v2Available) {
      return _unavailableState({
        state: 'partial', legacyAvailable: true, v2Available: false,
        sourceGenerationId, currentGenerationId: _currentGeneration(),
        blockers: ['Interactive comparison is unavailable because only one preview rendered.'],
      });
    }
    if (!legacyAvailable && v2Available) {
      return _unavailableState({
        state: 'partial', legacyAvailable: false, v2Available: true,
        sourceGenerationId, currentGenerationId: _currentGeneration(),
        blockers: ['Interactive comparison is unavailable because only one preview rendered.'],
      });
    }

    // Both available — check alignment before declaring ready.
    if (!alignment.sameAspectRatio) {
      return {
        state: 'blocked', splitPercent, legacyAvailable: true, v2Available: true, bothAvailable: true,
        interactive: false, sourceGenerationId, currentGenerationId: _currentGeneration(), alignment,
        warnings: [],
        blockers: ['Interactive comparison is blocked because the previews cannot be aligned safely.'],
        metadata: {},
      };
    }

    return {
      state: 'ready', splitPercent, legacyAvailable: true, v2Available: true, bothAvailable: true,
      interactive: true, sourceGenerationId, currentGenerationId: _currentGeneration(), alignment,
      warnings: [], blockers: [], metadata: {},
    };
  }

  function _refreshState() {
    lastState = _computeInteractiveState();
    _emitStateChange();
    return lastState;
  }

  /**
   * Binds the current analysis generation's rendered Legacy/V2 preview
   * canvases. Copies each into this module's own bounded display
   * canvas exactly once (never re-copied on slider movement).
   *
   * @param {{ legacySourceCanvas: (HTMLCanvasElement|null), v2SourceCanvas: (HTMLCanvasElement|null), generationId: (number|string|null) }} input
   */
  function updateSources({ legacySourceCanvas, v2SourceCanvas, generationId } = {}) {
    if (disposed) return lastState;

    sourceGenerationId = generationId ?? null;

    const legacyValidCanvas = _validateCanvasLike(legacySourceCanvas);
    const v2ValidCanvas = _validateCanvasLike(v2SourceCanvas);

    const legacyDims = legacyValidCanvas ? _readCanvasDimensions(legacySourceCanvas) : null;
    const v2Dims = v2ValidCanvas ? _readCanvasDimensions(v2SourceCanvas) : null;

    legacyAvailable = !!legacyDims && _copyCanvasToDisplay(legacySourceCanvas, legacyDisplayCanvas);
    v2Available = !!v2Dims && _copyCanvasToDisplay(v2SourceCanvas, v2DisplayCanvas);

    alignment = _computeAlignment(legacyAvailable ? legacyDims : null, v2Available ? v2Dims : null);

    // Reset split to 50 on every new source bind — never persisted
    // across analysis generations in Phase A.
    splitPercent = 50;
    _applySplitToDom(splitPercent);

    return _refreshState();
  }

  /** Sets the split percentage (0-100), clamped and NaN/Infinity-safe. Never redraws pixels — CSS-only. */
  function setSplit(value) {
    if (disposed) return lastState;
    splitPercent = _clampSplit(value);
    _applySplitToDom(splitPercent);
    lastState = { ...lastState, splitPercent };
    _emitStateChange();
    return lastState;
  }

  function _scheduleSplitFromClientX(clientX) {
    if (!viewport || rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      if (disposed || !isDragging) return;
      try {
        const rect = viewport.getBoundingClientRect();
        if (!rect || rect.width <= 0) return;
        const pct = ((clientX - rect.left) / rect.width) * 100;
        setSplit(pct);
      } catch {
        // A hostile/disconnected DOM read here is a no-op, never a crash.
      }
    });
  }

  function _onPointerDown(e) {
    if (disposed || lastState.interactive !== true) return;
    isDragging = true;
    activePointerId = e.pointerId;
    try { if (e.target && typeof e.target.setPointerCapture === 'function') e.target.setPointerCapture(e.pointerId); } catch { /* capture is best-effort */ }
    e.preventDefault?.();
    _scheduleSplitFromClientX(e.clientX);
  }

  function _onPointerMove(e) {
    if (disposed || !isDragging || e.pointerId !== activePointerId) return;
    _scheduleSplitFromClientX(e.clientX);
  }

  function _endDrag(e) {
    if (!isDragging) return;
    isDragging = false;
    try { if (e?.target && typeof e.target.releasePointerCapture === 'function' && e.pointerId === activePointerId) e.target.releasePointerCapture(e.pointerId); } catch { /* best-effort */ }
    activePointerId = null;
  }

  function _onRangeInput(e) {
    if (disposed || lastState.interactive !== true) return;
    setSplit(e.target?.value);
  }

  // ARIA slider pattern: the visible handle (role="slider") supports
  // its own keyboard interaction directly, per WAI-ARIA Authoring
  // Practices — not merely relying on the separate <input type="range">
  // below it, even though that range input is kept visible and usable
  // as a second, redundant accessible control.
  function _onHandleKeyDown(e) {
    if (disposed || lastState.interactive !== true) return;
    let next = null;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = splitPercent - 1;
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = splitPercent + 1;
    else if (e.key === 'PageDown') next = splitPercent - 10;
    else if (e.key === 'PageUp') next = splitPercent + 10;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = 100;
    if (next === null) return;
    e.preventDefault?.();
    setSplit(next);
  }

  // Wire up interaction listeners once — never duplicated across
  // updateSources() calls, since they're attached exactly once here at
  // controller creation time, not per-bind.
  const listeners = [];
  function _addListener(target, type, handler, opts) {
    if (!target || typeof target.addEventListener !== 'function') return;
    target.addEventListener(type, handler, opts);
    listeners.push({ target, type, handler, opts });
  }
  if (viewport) {
    _addListener(viewport, 'pointerdown', _onPointerDown);
    _addListener(viewport, 'pointermove', _onPointerMove);
    _addListener(viewport, 'pointerup', _endDrag);
    _addListener(viewport, 'pointercancel', _endDrag);
    _addListener(viewport, 'lostpointercapture', _endDrag);
  }
  if (handleElement) {
    _addListener(handleElement, 'pointerdown', _onPointerDown);
    _addListener(handleElement, 'keydown', _onHandleKeyDown);
  }
  if (rangeInput) {
    _addListener(rangeInput, 'input', _onRangeInput);
  }

  function reset() {
    if (disposed) return lastState;
    setSplit(50);
    return lastState;
  }

  /** Clears bound sources, resets split, and returns to the unavailable/waiting state. Controller remains reusable afterward. */
  function clear() {
    if (disposed) return lastState;
    isDragging = false;
    activePointerId = null;
    sourceGenerationId = null;
    legacyAvailable = false;
    v2Available = false;
    alignment = _computeAlignment(null, null);
    splitPercent = 50;
    _applySplitToDom(splitPercent);
    try {
      if (legacyDisplayCanvas) { legacyDisplayCanvas.width = 0; legacyDisplayCanvas.height = 0; }
      if (v2DisplayCanvas) { v2DisplayCanvas.width = 0; v2DisplayCanvas.height = 0; }
    } catch { /* best-effort cosmetic cleanup */ }
    return _refreshState();
  }

  /** Removes all listeners, cancels pending rAF work, releases references, and becomes permanently unavailable. */
  function dispose() {
    if (disposed) return;
    disposed = true;
    isDragging = false;
    activePointerId = null;
    rafPending = true; // prevents any already-scheduled rAF callback from doing anything further
    for (const { target, type, handler, opts } of listeners) {
      try { target.removeEventListener(type, handler, opts); } catch { /* best-effort */ }
    }
    listeners.length = 0;
    try {
      if (legacyDisplayCanvas) { legacyDisplayCanvas.width = 0; legacyDisplayCanvas.height = 0; }
      if (v2DisplayCanvas) { v2DisplayCanvas.width = 0; v2DisplayCanvas.height = 0; }
    } catch { /* best-effort */ }
    lastState = _unavailableState({ blockers: ['Interactive Before/After controller has been disposed.'] });
  }

  function getState() {
    return lastState;
  }

  return { updateSources, setSplit, reset, clear, dispose, getState };
}
