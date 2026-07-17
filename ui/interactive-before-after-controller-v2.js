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

// FIX 3 (EPIC 2E-I-A-F2): tightened from 0.02 (2%) to 0.001 (0.1%).
// Legacy and Controlled V2 previews are both derived from the SAME
// source image, so their aspect ratios should be almost identical —
// a broad 2% tolerance could visibly stretch geometry in an overlay
// comparison. 0.1% still comfortably tolerates ordinary integer
// pixel-rounding differences (e.g. 400/300 vs 401/300) while blocking
// any materially different geometry.
const ASPECT_RATIO_TOLERANCE = 0.001;

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
 * Builds the compact alignment metadata object per FIX 3's expanded
 * shape. `sameAspectRatio` uses a small documented tolerance (2%,
 * relative); `exactSourcePixelMatch` requires literally identical
 * SOURCE backing dimensions (never claimed when resampling to a
 * common display size was required). When aspect ratios are
 * compatible, a single bounded common display dimension is chosen
 * (Legacy's aspect ratio preserved, width bounded by the smaller of
 * the two source widths — never upscaling beyond either source's
 * actual resolution) so both display canvases can be set to IDENTICAL
 * dimensions, which is what makes the CSS split-overlay layering
 * genuinely aligned rather than merely "close enough by luck".
 */
function _computeAlignment(legacyDims, v2Dims) {
  if (!legacyDims || !v2Dims) {
    return {
      sourceLegacyWidth: legacyDims?.width ?? null, sourceLegacyHeight: legacyDims?.height ?? null,
      sourceV2Width: v2Dims?.width ?? null, sourceV2Height: v2Dims?.height ?? null,
      displayWidth: null, displayHeight: null,
      sameAspectRatio: false, exactSourcePixelMatch: false, displayDimensionsNormalized: false,
      aspectRatioRelativeDifference: null, aspectRatioTolerance: ASPECT_RATIO_TOLERANCE,
    };
  }
  const legacyRatio = legacyDims.width / legacyDims.height;
  const v2Ratio = v2Dims.width / v2Dims.height;
  const relativeDiff = Math.abs(legacyRatio - v2Ratio) / Math.max(legacyRatio, v2Ratio);
  const sameAspectRatio = relativeDiff <= ASPECT_RATIO_TOLERANCE;
  const exactSourcePixelMatch = legacyDims.width === v2Dims.width && legacyDims.height === v2Dims.height;

  let displayWidth = null, displayHeight = null, displayDimensionsNormalized = false;
  if (sameAspectRatio) {
    if (exactSourcePixelMatch) {
      displayWidth = legacyDims.width;
      displayHeight = legacyDims.height;
      displayDimensionsNormalized = false; // dimensions already identical — no resampling needed
    } else {
      // Bounded common size: preserve Legacy's aspect ratio, never
      // upscale beyond either source's actual resolution.
      const candidateWidth = Math.min(legacyDims.width, v2Dims.width);
      const candidateHeight = Math.max(1, Math.round(candidateWidth / legacyRatio));
      // FIX 4 (EPIC 2E-I-A-F2): guard against rounding pushing the
      // derived height above either source's actual height (which
      // would mean, however slightly, upscaling one side beyond its
      // real resolution). If that would happen, refuse to normalize —
      // block interaction rather than distort geometry.
      if (candidateWidth <= legacyDims.width && candidateWidth <= v2Dims.width && candidateHeight <= legacyDims.height && candidateHeight <= v2Dims.height) {
        displayWidth = candidateWidth;
        displayHeight = candidateHeight;
        displayDimensionsNormalized = true;
      }
      // else: displayWidth/displayHeight remain null — the caller
      // treats this the same as a material aspect-ratio mismatch
      // (blocked, no copy).
    }
  }

  return {
    sourceLegacyWidth: legacyDims.width, sourceLegacyHeight: legacyDims.height,
    sourceV2Width: v2Dims.width, sourceV2Height: v2Dims.height,
    displayWidth, displayHeight,
    sameAspectRatio: sameAspectRatio && (displayWidth !== null || exactSourcePixelMatch), exactSourcePixelMatch, displayDimensionsNormalized,
    aspectRatioRelativeDifference: relativeDiff, aspectRatioTolerance: ASPECT_RATIO_TOLERANCE,
  };
}

/** Copies a source canvas's current pixels into a bounded display canvas at an explicit target size, ONCE. Never called on every pointer movement. */
function _copyCanvasToDisplay(sourceCanvas, displayCanvas, targetWidth, targetHeight) {
  if (!sourceCanvas || !displayCanvas || !Number.isFinite(targetWidth) || !Number.isFinite(targetHeight) || targetWidth <= 0 || targetHeight <= 0) return false;
  try {
    displayCanvas.width = targetWidth;
    displayCanvas.height = targetHeight;
    const ctx = displayCanvas.getContext('2d');
    if (!ctx) return false;
    ctx.clearRect(0, 0, targetWidth, targetHeight);
    ctx.drawImage(sourceCanvas, 0, 0, targetWidth, targetHeight);
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
    metadata: { legacyVisualAdjustmentsApplied: null, v2VisualAdjustmentsApplied: null },
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
  let pendingRafId = null; // FIX 7: a real RAF ID, never a boolean flag alone
  let activePointerId = null;
  // FIX 5 (EPIC 2E-I-A-F2): the element that actually owns pointer
  // capture, stored so capture can be released from contexts that
  // never receive an Event object (clear(), dispose(), a mid-drag
  // rebind) — not merely from a pointerup/pointercancel handler.
  let activePointerTarget = null;
  // FIX 4: tri-state (true/false/null) preview-effect metadata, passed
  // in from the caller (ui/app.js) via updateSources() and never
  // inferred here.
  let legacyVisualAdjustmentsApplied = null;
  let v2VisualAdjustmentsApplied = null;

  const hasRaf = typeof requestAnimationFrame === 'function';
  const hasCancelRaf = typeof cancelAnimationFrame === 'function';

  function _cancelPendingRaf() {
    if (pendingRafId !== null && hasCancelRaf) {
      try { cancelAnimationFrame(pendingRafId); } catch { /* best-effort */ }
    }
    pendingRafId = null;
  }

  /** Resets both display canvases to 0×0, releasing their pixel storage. Shared by FIX 2's stale-abort path and clear()/dispose(). */
  function _clearDisplayCanvases() {
    try {
      if (legacyDisplayCanvas) { legacyDisplayCanvas.width = 0; legacyDisplayCanvas.height = 0; }
      if (v2DisplayCanvas) { v2DisplayCanvas.width = 0; v2DisplayCanvas.height = 0; }
    } catch { /* best-effort cosmetic cleanup */ }
  }

  // FIX 5 (EPIC 2E-I-A-F2): releases pointer capture using the STORED
  // target/ID — never depends on receiving an Event object, so it
  // works identically whether called from a real pointerup handler or
  // from clear()/dispose()/a mid-drag rebind where no event exists.
  function _releaseActivePointerCapture() {
    if (activePointerTarget && activePointerId !== null && typeof activePointerTarget.releasePointerCapture === 'function') {
      try { activePointerTarget.releasePointerCapture(activePointerId); } catch { /* best-effort */ }
    }
    activePointerTarget = null;
    activePointerId = null;
    isDragging = false;
  }

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
      // FIX 1 (EPIC 2E-I-A-F): the overlay (Controlled V2) must be
      // clipped from the LEFT by `splitPercent` — not from the right —
      // so that Legacy (the base layer underneath) shows through on
      // the LEFT side (0 to splitPercent%) and V2 remains visible only
      // on the RIGHT side (splitPercent% to 100%), matching the
      // required "Left: Legacy / Right: Controlled V2" labels exactly.
      // At splitPercent=0: `inset(0 0 0 0%)` clips nothing — V2 fills
      // the whole viewport. At splitPercent=100: `inset(0 0 0 100%)`
      // clips everything — V2 occupies 0%, Legacy fills the viewport.
      overlayWrapper.style.clipPath = `inset(0 0 0 ${percent}%)`;
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
    const effectMetadata = { legacyVisualAdjustmentsApplied, v2VisualAdjustmentsApplied };
    // FIX 4 (EPIC 2E-I-A-F): a no-op-preview warning is honest only
    // when the evidence EXPLICITLY says false — missing (`null`)
    // evidence must never be treated as false.
    const legacyNoOp = legacyVisualAdjustmentsApplied === false;
    const v2NoOp = v2VisualAdjustmentsApplied === false;
    const effectWarnings = [];
    if (legacyNoOp && v2NoOp) effectWarnings.push('Both previews were rendered without supported visual adjustments and may appear identical.');
    else if (legacyNoOp || v2NoOp) effectWarnings.push('The two previews may appear identical because one side contains no supported visual adjustment.');

    if (!alignment.sameAspectRatio) {
      return {
        state: 'blocked', splitPercent, legacyAvailable: true, v2Available: true, bothAvailable: true,
        interactive: false, sourceGenerationId, currentGenerationId: _currentGeneration(), alignment,
        warnings: effectWarnings,
        blockers: ['Interactive comparison is blocked because the previews cannot be aligned safely.'],
        metadata: effectMetadata,
      };
    }

    return {
      state: 'ready', splitPercent, legacyAvailable: true, v2Available: true, bothAvailable: true,
      interactive: true, sourceGenerationId, currentGenerationId: _currentGeneration(), alignment,
      warnings: effectWarnings, blockers: [], metadata: effectMetadata,
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
   * FIX 2 (EPIC 2E-I-A-F): the proposed generation is checked against
   * `generationProvider()` at multiple points during this binding
   * operation — before any copy begins, after dimension validation,
   * after the Legacy copy, after the V2 copy, and immediately before
   * declaring "ready". If the generation becomes stale at ANY of these
   * points, both display canvases are cleared and a `cancelled` result
   * is returned — stale pixels are never exposed, even momentarily.
   *
   * @param {{ legacySourceCanvas: (HTMLCanvasElement|null), v2SourceCanvas: (HTMLCanvasElement|null), generationId: (number|string|null), legacyVisualAdjustmentsApplied?: (boolean|null), v2VisualAdjustmentsApplied?: (boolean|null) }} input
   */
  function updateSources({ legacySourceCanvas, v2SourceCanvas, generationId, legacyVisualAdjustmentsApplied: legacyEffectMeta, v2VisualAdjustmentsApplied: v2EffectMeta } = {}) {
    if (disposed) return lastState;

    const proposedGenerationId = generationId ?? null;

    function _staleNow() {
      if (!hasGenerationProvider) return false;
      return proposedGenerationId !== _currentGeneration();
    }
    function _abortAsStale() {
      _clearDisplayCanvases();
      sourceGenerationId = null;
      legacyAvailable = false;
      v2Available = false;
      alignment = _computeAlignment(null, null);
      return _unavailableState({
        state: 'cancelled',
        currentGenerationId: _currentGeneration(),
        blockers: ['Interactive comparison was cancelled because a newer analysis is active.'],
      });
    }

    // FIX 2: check #1 — before any copy begins.
    if (_staleNow()) { lastState = _abortAsStale(); _emitStateChange(); return lastState; }

    // FIX 1/6 (EPIC 2E-I-A-F2): before validating/copying the NEW
    // source pair, unconditionally clear everything left over from any
    // PRIOR bind — cancel any pending RAF (an old scheduled frame must
    // never later apply to the newly-bound pair), release pointer
    // capture and end any in-progress drag, disable interaction, and
    // wipe both display canvases back to 0×0. This guarantees a
    // Legacy-only rebind can never retain a stale V2 image (and vice
    // versa), and that a failed/blocked new bind can never keep
    // showing a previous successful Ready pair.
    _cancelPendingRaf();
    _releaseActivePointerCapture();
    legacyAvailable = false;
    v2Available = false;
    alignment = _computeAlignment(null, null);
    legacyVisualAdjustmentsApplied = null;
    v2VisualAdjustmentsApplied = null;
    _clearDisplayCanvases();

    const legacyValidCanvas = _validateCanvasLike(legacySourceCanvas);
    const v2ValidCanvas = _validateCanvasLike(v2SourceCanvas);
    const legacyDims = legacyValidCanvas ? _readCanvasDimensions(legacySourceCanvas) : null;
    const v2Dims = v2ValidCanvas ? _readCanvasDimensions(v2SourceCanvas) : null;

    // FIX 2: check #2 — after dimension validation.
    if (_staleNow()) { lastState = _abortAsStale(); _emitStateChange(); return lastState; }

    const proposedAlignment = _computeAlignment(legacyDims, v2Dims);
    const targetW = proposedAlignment.displayWidth, targetH = proposedAlignment.displayHeight;
    const bothPresent = !!legacyDims && !!v2Dims;
    const alignmentOk = proposedAlignment.sameAspectRatio && Number.isFinite(targetW) && Number.isFinite(targetH);

    let copiedLegacy = false, copiedV2 = false;
    // FIX 3: when a misaligned pair is deliberately NOT copied, data
    // was still genuinely valid for both sides — `skippedForMisalignment`
    // tracks this so availability correctly reflects "blocked" (both
    // sides had real data, alignment failed) rather than being
    // conflated with "unavailable" (no valid data at all).
    let skippedForMisalignment = false;

    if (bothPresent && alignmentOk) {
      copiedLegacy = _copyCanvasToDisplay(legacySourceCanvas, legacyDisplayCanvas, targetW, targetH);
      // FIX 2: check #3 — after the Legacy copy.
      if (_staleNow()) { lastState = _abortAsStale(); _emitStateChange(); return lastState; }
      copiedV2 = _copyCanvasToDisplay(v2SourceCanvas, v2DisplayCanvas, targetW, targetH);
      // FIX 2: check #4 — after the V2 copy.
      if (_staleNow()) { lastState = _abortAsStale(); _emitStateChange(); return lastState; }
    } else if (bothPresent && !alignmentOk) {
      // FIX 3: material aspect-ratio mismatch — never copy a
      // deceptive, non-aligned pair of display canvases. The
      // "blocked" state (computed below from `alignment.sameAspectRatio`)
      // communicates this; no pixels are drawn. Any pixels from a
      // PRIOR successful bind are explicitly cleared here too — a
      // blocked result must never silently keep showing stale content
      // from an earlier ready state.
      skippedForMisalignment = true;
      _clearDisplayCanvases();
    } else if (legacyDims && !v2Dims) {
      copiedLegacy = _copyCanvasToDisplay(legacySourceCanvas, legacyDisplayCanvas, legacyDims.width, legacyDims.height);
      if (_staleNow()) { lastState = _abortAsStale(); _emitStateChange(); return lastState; }
    } else if (v2Dims && !legacyDims) {
      copiedV2 = _copyCanvasToDisplay(v2SourceCanvas, v2DisplayCanvas, v2Dims.width, v2Dims.height);
      if (_staleNow()) { lastState = _abortAsStale(); _emitStateChange(); return lastState; }
    }

    legacyAvailable = skippedForMisalignment ? !!legacyDims : copiedLegacy;
    v2Available = skippedForMisalignment ? !!v2Dims : copiedV2;
    alignment = proposedAlignment;
    legacyVisualAdjustmentsApplied = (legacyEffectMeta === true || legacyEffectMeta === false) ? legacyEffectMeta : null;
    v2VisualAdjustmentsApplied = (v2EffectMeta === true || v2EffectMeta === false) ? v2EffectMeta : null;
    sourceGenerationId = proposedGenerationId;

    // Reset split to 50 on every new source bind — never persisted
    // across analysis generations in Phase A.
    splitPercent = 50;
    _applySplitToDom(splitPercent);

    // FIX 2: check #5 — immediately before declaring ready.
    if (_staleNow()) { lastState = _abortAsStale(); _emitStateChange(); return lastState; }

    return _refreshState();
  }

  /** Sets the split percentage (0-100), clamped and NaN/Infinity-safe. Never redraws pixels — CSS-only. FIX 8: refuses to update the DOM when disposed, non-interactive, or stale. */
  function setSplit(value) {
    if (disposed || lastState.interactive !== true || _isStale()) return lastState;
    splitPercent = _clampSplit(value);
    _applySplitToDom(splitPercent);
    lastState = { ...lastState, splitPercent };
    _emitStateChange();
    return lastState;
  }

  function _scheduleSplitFromClientX(clientX) {
    if (!viewport || pendingRafId !== null) return;
    if (!hasRaf) {
      // FIX 7 (EPIC 2E-I-A-F2): the no-rAF fallback previously called
      // getBoundingClientRect() with no try/catch — a hostile or
      // disconnected viewport could throw straight out of this
      // function. Wrapped the same way as the rAF branch below: a
      // failure here is a silent no-op, never a crash, and never
      // changes the split.
      try {
        const rect = viewport.getBoundingClientRect();
        if (!rect || !(rect.width > 0)) return;
        setSplit(((clientX - rect.left) / rect.width) * 100);
      } catch {
        // A hostile/disconnected DOM read here is a no-op, never a crash.
      }
      return;
    }
    pendingRafId = requestAnimationFrame(() => {
      pendingRafId = null;
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
    // FIX 6 (EPIC 2E-I-A-F): the handle is a child of the viewport,
    // and both have their own pointerdown listener — without this,
    // pressing the handle would bubble the same event up to the
    // viewport's listener too, processing the single press twice.
    // stopPropagation() here means the viewport's own listener never
    // fires for a press that started on the handle.
    e.stopPropagation?.();
    isDragging = true;
    activePointerId = e.pointerId;
    activePointerTarget = e.target; // FIX 5: stored so capture can be released without needing an Event later
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
    _releaseActivePointerCapture(); // FIX 5: uses the stored target/ID, not the (possibly absent) event
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
    _cancelPendingRaf(); // FIX 9
    _releaseActivePointerCapture(); // FIX 5/9: ends any in-progress drag and releases capture without needing an event
    sourceGenerationId = null;
    legacyAvailable = false;
    v2Available = false;
    alignment = _computeAlignment(null, null);
    legacyVisualAdjustmentsApplied = null; // FIX 9: clear effect metadata too
    v2VisualAdjustmentsApplied = null;
    splitPercent = 50;
    _applySplitToDom(splitPercent);
    _clearDisplayCanvases(); // FIX 9: dimensions reset to 0×0, releasing pixel storage
    return _refreshState();
  }

  /** Removes all listeners, cancels pending rAF work, releases references, and becomes permanently unavailable. */
  function dispose() {
    if (disposed) return;
    disposed = true;
    _cancelPendingRaf(); // FIX 7: genuinely cancels any pending scheduled frame, not just a boolean flag
    _releaseActivePointerCapture(); // FIX 5
    for (const { target, type, handler, opts } of listeners) {
      try { target.removeEventListener(type, handler, opts); } catch { /* best-effort */ }
    }
    listeners.length = 0;
    _clearDisplayCanvases();
    lastState = _unavailableState({ blockers: ['Interactive Before/After controller has been disposed.'] });
  }

  function getState() {
    return lastState;
  }

  return { updateSources, setSplit, reset, clear, dispose, getState };
}
