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
 * shape. `sameAspectRatio` uses a small documented tolerance (0.1%,
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
  // DEPLOY GEOMETRY R1 — Phase A FIX A3 (root cause): when only one (or
  // neither) side has rendered, geometry has genuinely NOT been
  // compared yet — this is "not evaluated", never "evaluated and found
  // to differ". The previous code hard-coded `sameAspectRatio: false`/
  // `exactSourcePixelMatch: false` here, which is a false claim of a
  // genuine mismatch and was the exact cause of the misleading
  // "Alignment: Blocked geometry" text appearing whenever only Legacy
  // (or only V2) had rendered — a state that has nothing to do with
  // geometry at all. `null` is the honest tri-state value for "not yet
  // evaluated"; only the real two-dims branch below may ever report an
  // actual `true`/`false` verdict.
  if (!legacyDims || !v2Dims) {
    return {
      sourceLegacyWidth: legacyDims?.width ?? null, sourceLegacyHeight: legacyDims?.height ?? null,
      sourceV2Width: v2Dims?.width ?? null, sourceV2Height: v2Dims?.height ?? null,
      displayWidth: null, displayHeight: null,
      sameAspectRatio: null, exactSourcePixelMatch: null, displayDimensionsNormalized: false,
      aspectRatioRelativeDifference: null, aspectRatioTolerance: ASPECT_RATIO_TOLERANCE,
      // DEPLOY GEOMETRY R1 — Phase C5: spec-named aliases for the same
      // values above (additive only — every pre-existing field name is
      // unchanged) — "not yet evaluated" honestly reports null here too.
      legacyPixelWidth: legacyDims?.width ?? null, legacyPixelHeight: legacyDims?.height ?? null,
      v2PixelWidth: v2Dims?.width ?? null, v2PixelHeight: v2Dims?.height ?? null,
      canonicalWidth: null, canonicalHeight: null,
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
    // DEPLOY GEOMETRY R1 — Phase C5: spec-named aliases (additive only)
    // for the required alignment-metadata shape. `canonicalWidth`/
    // `canonicalHeight` are only ever reported when the two sides'
    // SOURCE backing dimensions are literally identical
    // (exactSourcePixelMatch) — there is no single "the" canonical size
    // to report otherwise, so this never fabricates one.
    legacyPixelWidth: legacyDims.width, legacyPixelHeight: legacyDims.height,
    v2PixelWidth: v2Dims.width, v2PixelHeight: v2Dims.height,
    canonicalWidth: exactSourcePixelMatch ? legacyDims.width : null,
    canonicalHeight: exactSourcePixelMatch ? legacyDims.height : null,
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

/**
 * Phase B safety integration: reads compact tri-state safety evidence
 * (mirrored from Visual Preview Comparison's own canonical evidence,
 * never re-derived or altered here) and determines whether interaction
 * must be blocked. Missing evidence alone is never treated as an
 * anomaly — only explicit contradictory values are.
 * FIX 8 (EPIC 2E-I-B-F): every field read exactly once through
 * safeGet — a throwing getter on `safety` degrades to unknown
 * evidence, never a crash.
 */
function _hasSafetyAnomaly(safety) {
  if (!_isRecord(safety)) return false;
  const rawSelectedSource = safeGet(safety, 'selectedProductionSource');
  const rawContradictory = safeGet(safety, 'v2Contradictory');
  const rawAllowExport = safeGet(safety, 'allowExport');
  const rawAllowWrite = safeGet(safety, 'allowProductionWrite');
  if (rawSelectedSource === 'v2') return true;
  if (rawContradictory === true) return true;
  if (rawAllowExport === true) return true;
  if (rawAllowWrite === true) return true;
  return false;
}

function _hasMissingSafetyEvidence(safety) {
  if (!_isRecord(safety)) return true;
  const source = safeGet(safety, 'selectedProductionSource');
  const rawAllowExport = safeGet(safety, 'allowExport');
  const rawAllowWrite = safeGet(safety, 'allowProductionWrite');
  const rawContradictory = safeGet(safety, 'v2Contradictory');
  return (source !== 'legacy' && source !== 'v2') || rawAllowExport === null || rawAllowWrite === null || rawContradictory === null;
}

// FIX 2/3 (EPIC 2E-I-B-F2): the single shared safety-normalization
// helper — used identically by both updateSources() and
// prepareState(), so a hostile/malformed `safety` object is normalized
// exactly once (single-read via safeGet) regardless of which entry
// point supplied it. Never preserves the arbitrary original object.
function _normalizeSafetyEvidence(safety) {
  if (!_isRecord(safety)) return null;
  const rawSelectedSource = safeGet(safety, 'selectedProductionSource');
  const rawAllowExport = safeGet(safety, 'allowExport');
  const rawAllowWrite = safeGet(safety, 'allowProductionWrite');
  const rawContradictory = safeGet(safety, 'v2Contradictory');
  return {
    selectedProductionSource: rawSelectedSource === 'legacy' ? 'legacy' : rawSelectedSource === 'v2' ? 'v2' : 'unknown',
    allowExport: rawAllowExport === true ? true : rawAllowExport === false ? false : null,
    allowProductionWrite: rawAllowWrite === true ? true : rawAllowWrite === false ? false : null,
    v2Contradictory: rawContradictory === true ? true : rawContradictory === false ? false : null,
  };
}

const SIDE_STATE_VALUES = ['rendered', 'failed', 'blocked', 'cancelled', 'unavailable', 'unknown'];
// FIX 1 (EPIC 2E-I-B-F): normalizes any incoming side-state string to
// one of the 6 canonical values — an unrecognized string never passes
// through verbatim, it becomes "unknown".
function _normalizeSideState(v) {
  return SIDE_STATE_VALUES.includes(v) ? v : 'unknown';
}

function _triState(v) {
  return v === true ? true : v === false ? false : null;
}

// Builds a friendly, non-raw status label for a side, per FIX 4/10 —
// never exposes internal state strings directly, and never implies
// success merely because adjustment evidence is missing.
function _friendlySideStatus(name, rendered, normalizedState, effectTriState) {
  if (rendered) {
    if (effectTriState === false) return { text: `${name}: No supported adjustment`, tone: 'neutral' };
    if (effectTriState === true) return { text: `${name}: Rendered`, tone: 'success' };
    return { text: `${name}: Rendered · adjustment evidence unknown`, tone: 'neutral' };
  }
  if (normalizedState === 'failed') return { text: `${name}: Failed`, tone: 'danger' };
  if (normalizedState === 'blocked') return { text: `${name}: Blocked`, tone: 'danger' };
  if (normalizedState === 'cancelled') return { text: `${name}: Cancelled`, tone: 'neutral' };
  return { text: `${name}: Unavailable`, tone: 'neutral' };
}

// Phase B: normalizes/dedupes a warning list into safe display
// strings, bounded in count and length — never a raw object, never
// [object Object]/undefined/NaN.
function _safeWarningText(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') { const t = value.trim(); return t ? (t.length > 300 ? `${t.slice(0, 300)}…` : t) : null; }
  if (typeof value === 'object' && !Array.isArray(value)) {
    for (const key of ['message', 'warning', 'reason', 'text']) {
      const v = safeGet(value, key);
      if (typeof v === 'string' && v.trim()) return v.length > 300 ? `${v.slice(0, 300)}…` : v;
    }
  }
  return null;
}
function _dedupeWarnings(list, limit = 6) {
  const seen = new Set();
  const out = [];
  for (const item of Array.isArray(list) ? list : []) {
    const t = _safeWarningText(item);
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * FIX 7 (EPIC 2E-I-B-F): the single, authoritative state-priority
 * function — used both by `ui/app.js` (BEFORE any canvas bind is even
 * attempted, for Partial/Failed/Blocked/Preparing/Unavailable) and
 * internally by this controller's `_computeInteractiveState()` (AFTER
 * canvases have been copied, with real alignment data). App and
 * Controller never maintain two separate copies of this priority
 * logic.
 *
 * Priority (FIX 2): stale/cancelled → safety anomaly → both rendered
 * & aligned (ready) → exactly one rendered (partial) → both explicitly
 * failed (failed) → either explicitly blocked (blocked/preview-state)
 * → still preparing (preparing) → otherwise unavailable.
 *
 * @param {{
 *   stale: boolean,
 *   legacySide: ({ rendered: boolean, state: string, visualAdjustmentsApplied: (boolean|null), warnings: any[] }|null),
 *   v2Side: (same shape|null),
 *   safety: ({ selectedProductionSource, allowExport, allowProductionWrite, v2Contradictory }|null),
 *   alignment: (object|null),
 *   splitPercent: number,
 *   sourceGenerationId: any,
 *   currentGenerationId: any,
 * }} input
 */
export function deriveInteractiveBeforeAfterStateV2(input) {
  const rec = _isRecord(input) ? input : {};
  const stale = safeGet(rec, 'stale') === true;
  // FIX 1 (EPIC 2E-I-B-F2): each untrusted property read EXACTLY ONCE
  // through safeGet, stored, then validated from the stored variable
  // only — never a second direct read of the original property (which
  // a throw-on-second-read hostile getter would defeat).
  const rawLegacySide = safeGet(rec, 'legacySide');
  const legacySide = _isRecord(rawLegacySide) ? rawLegacySide : null;
  const rawV2Side = safeGet(rec, 'v2Side');
  const v2Side = _isRecord(rawV2Side) ? rawV2Side : null;
  const rawSafety = safeGet(rec, 'safety');
  const safety = _normalizeSafetyEvidence(rawSafety);
  const rawAlignment = safeGet(rec, 'alignment');
  const alignment = rawAlignment ?? null;
  const rawSplit = safeGet(rec, 'splitPercent');
  const splitPercent = Number.isFinite(rawSplit) ? rawSplit : 50;
  const rawSourceGenerationId = safeGet(rec, 'sourceGenerationId');
  const sourceGenerationId = rawSourceGenerationId ?? null;
  const rawCurrentGenerationId = safeGet(rec, 'currentGenerationId');
  const currentGenerationId = rawCurrentGenerationId ?? null;

  const legacyRendered = safeGet(legacySide, 'rendered') === true;
  const v2Rendered = safeGet(v2Side, 'rendered') === true;
  const legacyState = _normalizeSideState(safeGet(legacySide, 'state'));
  const v2State = _normalizeSideState(safeGet(v2Side, 'state'));
  const legacyEffect = _triState(safeGet(legacySide, 'visualAdjustmentsApplied'));
  const v2Effect = _triState(safeGet(v2Side, 'visualAdjustmentsApplied'));
  const legacyWarnings = _dedupeWarnings(safeGet(legacySide, 'warnings'));
  const v2Warnings = _dedupeWarnings(safeGet(v2Side, 'warnings'));

  const legacyStatus = _friendlySideStatus('Legacy', legacyRendered, legacyState, legacyEffect);
  const v2Status = _friendlySideStatus('Controlled V2', v2Rendered, v2State, v2Effect);
  const baseMetadata = {
    legacyVisualAdjustmentsApplied: legacyEffect, v2VisualAdjustmentsApplied: v2Effect,
    safety: _isRecord(safety) ? safety : null, legacyStatus, v2Status,
  };
  const emptyAlignment = _computeAlignment(null, null);

  // 1. stale/cancelled generation.
  if (stale) {
    return {
      state: 'cancelled', blockedReason: null, splitPercent: 50,
      legacyAvailable: false, v2Available: false, bothAvailable: false, interactive: false,
      sourceGenerationId, currentGenerationId, alignment: alignment ?? emptyAlignment,
      warnings: [], blockers: ['Interactive comparison was cancelled because a newer analysis is active.'],
      metadata: baseMetadata,
    };
  }

  // 2. critical safety anomaly — outranks EVERYTHING below, even
  // before any canvas has been bound.
  if (_hasSafetyAnomaly(safety)) {
    return {
      state: 'blocked', blockedReason: 'safety', splitPercent,
      legacyAvailable: legacyRendered, v2Available: v2Rendered, bothAvailable: legacyRendered && v2Rendered, interactive: false,
      sourceGenerationId, currentGenerationId, alignment: alignment ?? emptyAlignment,
      warnings: _dedupeWarnings([...legacyWarnings, ...v2Warnings]),
      blockers: ['Interactive comparison is blocked because production safety evidence reports an anomaly.'],
      metadata: baseMetadata,
    };
  }

  // 3. both rendered — ready, unless real alignment data says blocked.
  if (legacyRendered && v2Rendered) {
    if (alignment && alignment.sameAspectRatio === false) {
      return {
        state: 'blocked', blockedReason: 'alignment', splitPercent,
        legacyAvailable: true, v2Available: true, bothAvailable: true, interactive: false,
        sourceGenerationId, currentGenerationId, alignment,
        warnings: _dedupeWarnings([...legacyWarnings, ...v2Warnings]),
        blockers: ['Alignment blocked: preview geometry differs beyond the safe tolerance.'],
        metadata: baseMetadata,
      };
    }
    const legacyNoOp = legacyEffect === false;
    const v2NoOp = v2Effect === false;
    const effectWarnings = [];
    if (legacyNoOp && v2NoOp) effectWarnings.push('Both previews contain no supported visual adjustments and may appear identical.');
    else if (legacyNoOp || v2NoOp) effectWarnings.push('One preview contains no supported visual adjustment and may match the source image.');
    const missingSafetyWarning = _hasMissingSafetyEvidence(safety) ? ['Production safety evidence is not fully confirmed.'] : [];
    return {
      state: 'ready', blockedReason: null, splitPercent,
      legacyAvailable: true, v2Available: true, bothAvailable: true, interactive: true,
      sourceGenerationId, currentGenerationId, alignment: alignment ?? emptyAlignment,
      warnings: _dedupeWarnings([...effectWarnings, ...missingSafetyWarning, ...legacyWarnings, ...v2Warnings]),
      blockers: [], metadata: baseMetadata,
    };
  }

  // 4. exactly one side rendered — partial, with a friendly reason for
  // the missing side (FIX 4).
  if (legacyRendered !== v2Rendered) {
    const missingLabel = legacyRendered
      ? (v2State === 'failed' ? 'Controlled V2 preview failed.' : v2State === 'blocked' ? 'Controlled V2 preview blocked.' : 'Controlled V2 preview unavailable.')
      : (legacyState === 'failed' ? 'Legacy preview failed.' : legacyState === 'blocked' ? 'Legacy preview blocked.' : 'Legacy preview unavailable.');
    return {
      state: 'partial', blockedReason: null, splitPercent: 50,
      legacyAvailable: legacyRendered, v2Available: v2Rendered, bothAvailable: false, interactive: false,
      sourceGenerationId: null, currentGenerationId, alignment: emptyAlignment,
      warnings: _dedupeWarnings([...legacyWarnings, ...v2Warnings]),
      blockers: [missingLabel],
      metadata: baseMetadata,
    };
  }

  // Neither side rendered from here on.
  // 5. both sides explicitly failed.
  if (legacyState === 'failed' && v2State === 'failed') {
    return {
      state: 'failed', blockedReason: null, splitPercent: 50,
      legacyAvailable: false, v2Available: false, bothAvailable: false, interactive: false,
      sourceGenerationId: null, currentGenerationId, alignment: emptyAlignment,
      warnings: _dedupeWarnings([...legacyWarnings, ...v2Warnings]),
      blockers: ['Interactive comparison could not be prepared. Existing analysis and production output were not changed.'],
      metadata: baseMetadata,
    };
  }

  // 6. one or both sides explicitly blocked.
  if (legacyState === 'blocked' || v2State === 'blocked') {
    return {
      state: 'blocked', blockedReason: 'preview-state', splitPercent: 50,
      legacyAvailable: false, v2Available: false, bothAvailable: false, interactive: false,
      sourceGenerationId: null, currentGenerationId, alignment: emptyAlignment,
      warnings: _dedupeWarnings([...legacyWarnings, ...v2Warnings]),
      blockers: ['Interactive comparison is blocked because one preview did not pass its render requirements.'],
      metadata: baseMetadata,
    };
  }

  // 7. still preparing/rendering — evidence is genuinely unknown yet,
  // never explicitly failed/blocked/unavailable.
  if (legacyState === 'unknown' || v2State === 'unknown') {
    return {
      state: 'preparing', blockedReason: null, splitPercent: 50,
      legacyAvailable: false, v2Available: false, bothAvailable: false, interactive: false,
      sourceGenerationId: null, currentGenerationId, alignment: emptyAlignment,
      warnings: [], blockers: [],
      metadata: baseMetadata,
    };
  }

  // 8. otherwise — genuinely unavailable (e.g. both sides explicitly
  // report "unavailable"/"cancelled", no analysis has produced any
  // evidence yet).
  return {
    state: 'unavailable', blockedReason: null, splitPercent: 50,
    legacyAvailable: false, v2Available: false, bothAvailable: false, interactive: false,
    sourceGenerationId: null, currentGenerationId, alignment: emptyAlignment,
    warnings: [], blockers: [],
    metadata: baseMetadata,
  };
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
  // Phase B: compact safety evidence mirrored from Visual Preview
  // Comparison's own canonical evidence — never re-derived, never
  // written back anywhere.
  let safetyEvidence = null;
  // FIX 7 (EPIC 2E-I-B-F): compact preview side status (state string +
  // warnings), passed via updateSources()'s `previewStatus` — used
  // only for UI-local status projection, never to alter pixel data.
  let legacySideState = null;
  let v2SideState = null;

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
    // Phase B: local dragging class only — never a global `user-select: none`.
    try { if (viewport && viewport.classList) viewport.classList.remove('iba-dragging'); } catch { /* best-effort */ }
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

    // FIX 7 (EPIC 2E-I-B-F): delegates to the single shared
    // state-priority function — after a canvas bind attempt,
    // `legacyAvailable`/`v2Available` (actual copy-success) take
    // priority as the "rendered" signal, merged with any richer
    // `legacySideState`/`v2SideState` (state string + warnings) the
    // caller supplied via `updateSources()`'s `previewStatus`.
    return deriveInteractiveBeforeAfterStateV2({
      stale: _isStale(),
      legacySide: { rendered: legacyAvailable, state: legacyAvailable ? 'rendered' : (safeGet(legacySideState, 'state') ?? 'unavailable'), visualAdjustmentsApplied: legacyVisualAdjustmentsApplied, warnings: safeGet(legacySideState, 'warnings') },
      v2Side: { rendered: v2Available, state: v2Available ? 'rendered' : (safeGet(v2SideState, 'state') ?? 'unavailable'), visualAdjustmentsApplied: v2VisualAdjustmentsApplied, warnings: safeGet(v2SideState, 'warnings') },
      safety: safetyEvidence,
      alignment,
      splitPercent,
      sourceGenerationId,
      currentGenerationId: _currentGeneration(),
    });
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
  function updateSources({ legacySourceCanvas, v2SourceCanvas, generationId, legacyVisualAdjustmentsApplied: legacyEffectMeta, v2VisualAdjustmentsApplied: v2EffectMeta, safety, previewStatus } = {}) {
    if (disposed) return lastState;

    // FIX 7 (EPIC 2E-I-B-F): store the compact preview-side status
    // (state string + warnings) supplied by the caller — used only for
    // UI-local status projection via the shared
    // deriveInteractiveBeforeAfterStateV2() helper, never to alter
    // pixel data or source validity.
    const rawPreviewStatus = _isRecord(previewStatus) ? previewStatus : null;
    legacySideState = { state: safeGet(rawPreviewStatus, 'legacyState'), warnings: safeGet(rawPreviewStatus, 'legacyWarnings') };
    v2SideState = { state: safeGet(rawPreviewStatus, 'v2State'), warnings: safeGet(rawPreviewStatus, 'v2Warnings') };

    const proposedGenerationId = generationId ?? null;
    // FIX 2 (EPIC 2E-I-B-F2): normalize via the shared single-read
    // helper — a hostile/malformed `safety` object is never spread
    // verbatim into internal state, and every field is read exactly
    // once through safeGet.
    const normalizedSafety = _normalizeSafetyEvidence(safety);

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
    safetyEvidence = normalizedSafety;
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
    try { if (viewport && viewport.classList) viewport.classList.add('iba-dragging'); } catch { /* best-effort */ }
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
    safetyEvidence = null; // Phase B: clear safety evidence too
    legacySideState = null; // FIX 7: clear side-status too
    v2SideState = null;
    splitPercent = 50;
    _applySplitToDom(splitPercent);
    _clearDisplayCanvases(); // FIX 9: dimensions reset to 0×0, releasing pixel storage
    return _refreshState();
  }

  /**
   * FIX 7 (EPIC 2E-I-B-F): for the NON-ready path (Partial/Failed/
   * Blocked/Preparing/Unavailable) — never touches canvases, never
   * copies pixels, but uses the EXACT SAME shared
   * deriveInteractiveBeforeAfterStateV2() priority function the
   * controller itself uses internally, so `ui/app.js` never maintains
   * a second, potentially-divergent copy of the state-priority rules.
   * Also clears any previously-bound display canvases/source state,
   * since a non-ready result must never keep showing stale Ready
   * content.
   *
   * @param {{ legacySide: object, v2Side: object, safety: object, generationId: (number|string|null) }} input
   */
  function prepareState({ legacySide, v2Side, safety, generationId } = {}) {
    if (disposed) return lastState;
    _cancelPendingRaf();
    _releaseActivePointerCapture();
    sourceGenerationId = null;
    legacyAvailable = false;
    v2Available = false;
    alignment = _computeAlignment(null, null);
    legacyVisualAdjustmentsApplied = null;
    v2VisualAdjustmentsApplied = null;
    legacySideState = _isRecord(legacySide) ? legacySide : null;
    v2SideState = _isRecord(v2Side) ? v2Side : null;
    // FIX 3 (EPIC 2E-I-B-F2): normalize via the SAME shared helper
    // updateSources() uses — never preserves the arbitrary original
    // `safety` object/getters internally.
    safetyEvidence = _normalizeSafetyEvidence(safety);
    splitPercent = 50;
    _applySplitToDom(splitPercent);
    _clearDisplayCanvases();

    const proposedGenerationId = generationId ?? null;
    const stale = hasGenerationProvider ? proposedGenerationId !== _currentGeneration() : false;
    lastState = deriveInteractiveBeforeAfterStateV2({
      stale,
      legacySide: _isRecord(legacySide) ? legacySide : null,
      v2Side: _isRecord(v2Side) ? v2Side : null,
      safety: safetyEvidence,
      alignment: null,
      splitPercent: 50,
      sourceGenerationId: proposedGenerationId,
      currentGenerationId: _currentGeneration(),
    });
    _emitStateChange();
    return lastState;
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

  return { updateSources, prepareState, setSplit, reset, clear, dispose, getState };
}
