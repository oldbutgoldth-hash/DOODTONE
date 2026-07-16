/**
 * ui/visual-preview-comparison-controller-v2.js
 *
 * EPIC 2E-H Phase C — Legacy/V2 Preview Canvas UI Controller.
 *
 * Orchestrates the two isolated pixel renderers
 * (ui/isolated-visual-preview-renderer-v2.js) against the canonical
 * `finalStyleIntent.visualPreviewRenderPlanV2` object, reading it
 * ONLY (never rebuilding, never re-normalizing Legacy/V2 presets
 * here). This module is UI-local orchestration only:
 *
 * - never calls analyzeImage/analyzeImageCore or any analysis engine
 * - never calls Decision Engine, Decision Report, or Reference Transfer
 * - never imports or mutates finalStyleIntent
 * - never mutates the canonical Side-by-Side Comparison object
 * - never writes XMP, never touches preset-engine/xmp-validator
 * - remains strictly read-only: no Export, Apply, Activate V2, Approve
 *
 * SEQUENTIAL RENDERING: Legacy renders first, then (only if still the
 * current session) V2 renders second — per the phase's mobile-memory
 * guidance, this module never holds two large staging buffers at once.
 *
 * GENERATION/CANCELLATION: this controller owns its own internal
 * `sessionId` counter (incremented on every `render()` call, `clear()`,
 * and `dispose()`), tied conceptually to the caller's own
 * `analysisGenerationId` (passed through and echoed back in the
 * returned state, never used as the sole staleness mechanism since the
 * caller's generation numbering is out of this module's control). Each
 * individual side ALSO benefits from the isolated renderer's own
 * internal per-renderer generation protection (from
 * `createIsolatedVisualPreviewRendererV2()`), so a render is protected
 * against staleness at two independent levels.
 */

import {
  createIsolatedVisualPreviewRendererV2,
  disposeIsolatedVisualPreviewRendererV2,
} from './isolated-visual-preview-renderer-v2.js';

function _isRecord(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// EPIC 2E-H-C-F FIX 9: safe property access — a malformed/hostile
// Render Plan object with a throwing getter must never reject/crash
// this controller's render() call. Any read that throws is treated as
// missing evidence, never propagated as an error.
function safeGet(object, key, fallback = undefined) {
  try {
    if (!object || typeof object !== 'object') return fallback;
    return object[key];
  } catch {
    return fallback;
  }
}

// Tri-state boolean — missing/non-boolean evidence is honestly `null`,
// never coerced to `false` ("confirmed disabled") or `true`.
function _triStateBoolean(v) {
  return v === true ? true : v === false ? false : null;
}

function _clearCanvasSafely(canvas) {
  if (!canvas) return;
  try {
    const ctx = canvas.getContext && canvas.getContext('2d');
    if (ctx && canvas.width > 0 && canvas.height > 0) ctx.clearRect(0, 0, canvas.width, canvas.height);
  } catch {
    // A cleared canvas is a best-effort cosmetic action — a failure
    // here (e.g. context already lost) is never propagated as an error.
  }
}

// FIX 11 (EPIC 2E-H-C-F): after renderer work has genuinely been
// aborted (never before — this must not race with an active commit),
// reset backing dimensions to 0 so old pixel storage is released and
// the CSS layout does not retain the previous image's aspect ratio.
function _resetCanvasDimensions(canvas) {
  if (!canvas) return;
  try {
    canvas.width = 0;
    canvas.height = 0;
  } catch {
    // Best-effort cosmetic action only.
  }
}

function _unavailableState(analysisGenerationId, extraBlockers = []) {
  return {
    state: 'unavailable',
    legacy: null,
    v2: null,
    bothRendered: false,
    visualComparisonAvailable: false,
    analysisGenerationId: analysisGenerationId ?? null,
    warnings: [],
    blockers: extraBlockers,
    metadata: { legacyEligible: false, v2Eligible: false, v2Contradictory: false },
  };
}

function _cancelledState(analysisGenerationId) {
  return {
    state: 'cancelled',
    legacy: null,
    v2: null,
    bothRendered: false,
    visualComparisonAvailable: false,
    analysisGenerationId: analysisGenerationId ?? null,
    warnings: [],
    blockers: [],
    metadata: {},
  };
}

/**
 * RENDER CONDITIONS (per EPIC 2E-H Phase C spec) — evaluated purely
 * from the canonical Render Plan's own fields, never re-derived or
 * "fixed" here. A malformed/missing plan is always treated as
 * ineligible, never defaulted to eligible. FIX 9 (EPIC 2E-H-C-F):
 * every field read exactly once through safeGet, stored, then
 * validated from the stored variable only.
 */
function _legacyEligible(legacyPlan) {
  if (!_isRecord(legacyPlan)) return false;
  const available = safeGet(legacyPlan, 'available');
  const renderable = safeGet(legacyPlan, 'renderable');
  return available === true && renderable === true;
}

function _v2Contradictory(v2Plan) {
  const upstreamEvidence = safeGet(v2Plan, 'upstreamEvidence');
  const contradictory = safeGet(upstreamEvidence, 'contradictory');
  return contradictory === true;
}

function _v2Eligible(v2Plan) {
  if (!_isRecord(v2Plan)) return false;
  const available = safeGet(v2Plan, 'available');
  const renderable = safeGet(v2Plan, 'renderable');
  const previewOnly = safeGet(v2Plan, 'previewOnly');
  const productionSource = safeGet(v2Plan, 'productionSource');
  const exportEligible = safeGet(v2Plan, 'exportEligible');
  const appliedToProduction = safeGet(v2Plan, 'appliedToProduction');
  if (available !== true || renderable !== true) return false;
  if (previewOnly !== true) return false;
  if (productionSource === true) return false;
  if (exportEligible === true) return false;
  if (appliedToProduction === true) return false;
  if (_v2Contradictory(v2Plan)) return false;
  return true;
}

/**
 * Creates a Visual Preview Comparison controller bound to two
 * caller-owned target canvases. The canvases are never created,
 * replaced, or reused for anything else by this module — the caller
 * (ui/app.js) owns their lifecycle in the DOM.
 *
 * @param {{ legacyCanvas: HTMLCanvasElement, v2Canvas: HTMLCanvasElement }} options
 */
export function createVisualPreviewComparisonControllerV2({ legacyCanvas, v2Canvas } = {}) {
  let disposed = false;
  let sessionId = 0;
  // FIX 1 (EPIC 2E-H-C-F): renderer instances are now REPLACEABLE
  // (`let`, not `const`) — clear() disposes and recreates both,
  // genuinely aborting any in-flight pixel work instead of merely
  // incrementing this controller's own bookkeeping counter (which the
  // underlying renderer's internal generation never learned about,
  // letting an old render silently commit after "clear").
  let legacyRenderer = createIsolatedVisualPreviewRendererV2();
  let v2Renderer = createIsolatedVisualPreviewRendererV2();
  let lastState = _unavailableState(null);

  function _recreateRenderers() {
    disposeIsolatedVisualPreviewRendererV2(legacyRenderer);
    disposeIsolatedVisualPreviewRendererV2(v2Renderer);
    legacyRenderer = createIsolatedVisualPreviewRendererV2();
    v2Renderer = createIsolatedVisualPreviewRendererV2();
  }

  /**
   * @param {{ source: (HTMLImageElement|ImageBitmap|HTMLCanvasElement|OffscreenCanvas), renderPlan: object, analysisGenerationId: (number|string|null), signal?: AbortSignal }} input
   */
  async function render({ source, renderPlan, analysisGenerationId, signal } = {}) {
    if (disposed) return _unavailableState(analysisGenerationId, ['Visual Preview Comparison controller has been disposed.']);
    const mySession = ++sessionId;

    const rp = _isRecord(renderPlan) ? renderPlan : null;
    const legacyPlan = rp ? safeGet(rp, 'legacyRenderPlan') : null;
    const v2Plan = rp ? safeGet(rp, 'v2RenderPlan') : null;
    const constraints = rp ? safeGet(rp, 'sharedRenderConstraints') : null;

    const legacyEligible = _legacyEligible(legacyPlan);
    const v2Contradictory = _v2Contradictory(v2Plan);
    const v2Eligible = _v2Eligible(v2Plan);

    // FIX 6 (EPIC 2E-H-C-F): canonical tri-state safety evidence,
    // read exactly once and preserved honestly — never overwritten,
    // never mutated on the Render Plan itself.
    const rawSelectedSource = safeGet(rp, 'selectedProductionSource');
    const selectedProductionSource = rawSelectedSource === 'legacy' ? 'legacy' : rawSelectedSource === 'v2' ? 'v2' : 'unknown';
    const allowExport = _triStateBoolean(safeGet(constraints, 'allowExport'));
    const allowProductionWrite = _triStateBoolean(safeGet(constraints, 'allowProductionWrite'));
    const v2ExportEligible = _triStateBoolean(safeGet(v2Plan, 'exportEligible'));
    const v2AppliedToProduction = _triStateBoolean(safeGet(v2Plan, 'appliedToProduction'));

    const warnings = [];
    const blockers = [];

    if (!rp) {
      blockers.push('No Visual Preview Render Plan is available for this analysis.');
    } else {
      if (!legacyEligible) blockers.push('Legacy preview plan is unavailable or not renderable.');
      if (v2Contradictory) {
        blockers.push('V2 preview is blocked — contradictory safety evidence was reported upstream.');
        warnings.push('V2 preview evidence contradicts the expected non-production guarantees — Legacy behavior is unaffected.');
      } else if (_isRecord(v2Plan) && !v2Eligible) {
        blockers.push('V2 preview plan is unavailable, not renderable, or not eligible under current safety constraints.');
      } else if (!_isRecord(v2Plan)) {
        blockers.push('V2 preview plan is unavailable.');
      }
    }

    let legacyResult = null;
    let v2Result = null;

    const hasSource = !!source;
    const hasLegacyCanvas = !!legacyCanvas;
    const hasV2Canvas = !!v2Canvas;

    // FIX 10 (EPIC 2E-H-C-F): an eligible plan with a missing
    // source/canvas gets an explicit, specific blocker — never an
    // ambiguous generic "blocked" with no explanation, and the
    // isolated renderer is never called with an invalid target.
    if (legacyEligible && !hasSource) blockers.push('Source image is unavailable for visual preview rendering.');
    else if (legacyEligible && !hasLegacyCanvas) blockers.push('Legacy preview target canvas is unavailable.');
    if (v2Eligible && !hasSource && !blockers.some(b => b.startsWith('Source image is unavailable'))) blockers.push('Source image is unavailable for visual preview rendering.');
    else if (v2Eligible && !hasV2Canvas) blockers.push('V2 preview target canvas is unavailable.');

    // Sequential rendering: Legacy first, release, then V2 — never two
    // large staging buffers held simultaneously (mobile-memory safety).
    if (legacyEligible && hasSource && hasLegacyCanvas) {
      legacyResult = await legacyRenderer.render({ source, canvas: legacyCanvas, renderPlan: rp, side: 'legacy', signal });
      if (mySession !== sessionId) return _cancelledState(analysisGenerationId);
    }

    if (v2Eligible && hasSource && hasV2Canvas) {
      v2Result = await v2Renderer.render({ source, canvas: v2Canvas, renderPlan: rp, side: 'v2', signal });
      if (mySession !== sessionId) return _cancelledState(analysisGenerationId);
    }

    const legacyRendered = legacyResult?.rendered === true;
    const v2Rendered = v2Result?.rendered === true;
    const bothRendered = legacyRendered && v2Rendered;
    const anyRendered = legacyRendered || v2Rendered;
    const anyCancelled = legacyResult?.state === 'cancelled' || v2Result?.state === 'cancelled';
    const anyFailed = legacyResult?.state === 'failed' || v2Result?.state === 'failed';

    // VISUAL HONESTY: a rendered side with no supported visual
    // adjustment must never silently look like a successful stylistic
    // change — flag it explicitly.
    if (legacyRendered && legacyResult?.metadata?.visualAdjustmentsApplied === false) {
      warnings.push('Legacy preview contains no supported visual adjustment.');
    }
    if (v2Rendered && v2Result?.metadata?.visualAdjustmentsApplied === false) {
      warnings.push('V2 preview contains no supported visual adjustment.');
    }

    // Overall state priority: cancellation first (never claim any
    // other outcome for a superseded run), then genuine render
    // outcomes, then absence-of-evidence, then failure, then a
    // residual "blocked" catch-all.
    let overallState;
    if (anyCancelled) overallState = 'cancelled';
    else if (bothRendered) overallState = 'rendered';
    else if (anyRendered) overallState = 'partial'; // never "rendered" when only one side actually succeeded
    else if (!legacyEligible && !v2Eligible) overallState = rp ? 'blocked' : 'unavailable';
    else if (anyFailed) overallState = 'failed';
    else overallState = 'blocked';

    const newState = {
      state: overallState,
      legacy: legacyResult,
      v2: v2Result,
      bothRendered,
      // visualComparisonAvailable must exactly mirror bothRendered —
      // never derived from Render Plan capability alone.
      visualComparisonAvailable: bothRendered,
      analysisGenerationId: analysisGenerationId ?? null,
      warnings,
      blockers,
      metadata: {
        legacyEligible, v2Eligible, v2Contradictory,
        selectedProductionSource, allowExport, allowProductionWrite,
        v2ExportEligible, v2AppliedToProduction,
      },
    };

    if (mySession === sessionId) lastState = newState;
    return newState;
  }

  /** Cancels any in-flight render by disposing and recreating both isolated renderers, resets both canvases to empty, and returns to the waiting state. Used on Re-analyze start, new-image import, and reset/removal. */
  function clear() {
    if (disposed) return; // FIX 1: do not recreate renderers after the controller itself has been disposed
    sessionId++; // invalidate any render() currently in flight at the controller level
    _recreateRenderers(); // FIX 1: genuinely aborts in-flight pixel work
    _clearCanvasSafely(legacyCanvas);
    _clearCanvasSafely(v2Canvas);
    _resetCanvasDimensions(legacyCanvas); // FIX 11
    _resetCanvasDimensions(v2Canvas);
    lastState = _unavailableState(null);
  }

  /** Disposes both underlying isolated renderers (aborting any in-flight work) and clears both canvases. Idempotent. */
  function dispose() {
    if (disposed) return;
    disposed = true;
    sessionId++;
    disposeIsolatedVisualPreviewRendererV2(legacyRenderer);
    disposeIsolatedVisualPreviewRendererV2(v2Renderer);
    _clearCanvasSafely(legacyCanvas);
    _clearCanvasSafely(v2Canvas);
    _resetCanvasDimensions(legacyCanvas); // FIX 11
    _resetCanvasDimensions(v2Canvas);
    lastState = _unavailableState(null);
  }

  function getState() {
    return lastState;
  }

  return { render, clear, dispose, getState };
}
