/**
 * ui/isolated-visual-preview-renderer-v2.js
 *
 * Isolated Browser Preview Canvas Renderer (EPIC 2E-H Phase A).
 *
 * Renders an APPROXIMATE, non-production browser preview into a
 * caller-supplied, isolated target canvas, using a Render Plan already
 * built by `core/preview-rendering/visual-preview-render-plan-v2.js`.
 * This module NEVER:
 * - re-runs image analysis, K-Means, or any analysis pipeline stage
 * - calls decision-engine, lightroom-mapping-engine, preset-engine, or
 *   xmp-validator
 * - writes to production XMP or Lightroom Mapping in any way
 * - mutates the source image/canvas — it only ever reads source pixels
 *   and writes into the separate, caller-owned target canvas
 * - appends any temporary canvas to the DOM (all intermediate canvases
 *   are detached/offscreen and released after use)
 * - persists anything to localStorage or any other storage
 * - executes dynamic code, uses eval, injects HTML, or fetches
 *   external images
 *
 * PRODUCT TRUTH: every successful render carries
 * `previewAccuracy: "approximate-browser-preview"` and a fixed set of
 * honesty warnings (not Lightroom-accurate, RAW development not
 * simulated, camera profiles not reproduced, local masks not
 * reproduced, color-management differences may remain) — these are
 * never optional and never omitted.
 *
 * NOT INTEGRATED (Phase A): this module is not called from
 * ui/app.js, index.html, or any Side-by-Side UI. It exists as a
 * standalone, testable rendering primitive only. Phase B will wire the
 * Render Plan in; Phase C will wire this canvas renderer into the UI.
 *
 * CANCELLATION: every render is scoped to a `generationId` and/or an
 * `AbortSignal`. A newer render request always prevents an older one
 * from committing pixels to the target canvas — checked at multiple
 * points during processing, not just at the start.
 */

// ── Pixel-safety helpers ──────────────────────────────────────────────────────
function _clampByte(v) {
  // Uint8ClampedArray already clamps on write, but intermediate math
  // uses plain numbers, so NaN must be caught explicitly (NaN would
  // otherwise clamp to 0 silently, masking a real bug) and integer
  // overflow avoided by clamping BEFORE assignment.
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

function _isRecord(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Normalizes an arbitrary adjustment-model value to a safe multiplier/
 * offset input for the pixel transforms below. Exported as a pure test
 * helper per the phase spec — never touches any mutable global state.
 */
export function normalizePreviewAdjustmentV2(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-1, Math.min(1, value));
}

// ── Conservative pixel transforms (Uint8ClampedArray in place) ───────────────
// Every transform below is intentionally conservative — this is an
// approximate browser preview, never an attempt at exact Lightroom
// slider equivalence. Each function is a pure, small, single-purpose
// step in the deterministic pipeline documented in
// _PIXEL_PIPELINE_ORDER below.

function _applyExposure(data, value) {
  const v = normalizePreviewAdjustmentV2(value);
  if (v === 0) return;
  // Approximate ±2-stop range: 2^(v*2) → v=-1 → 0.25x, v=+1 → 4x.
  const factor = Math.pow(2, v * 2);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = _clampByte(data[i] * factor);
    data[i + 1] = _clampByte(data[i + 1] * factor);
    data[i + 2] = _clampByte(data[i + 2] * factor);
  }
}

function _applyWhiteBlackPoint(data, whites, blacks) {
  const w = normalizePreviewAdjustmentV2(whites), b = normalizePreviewAdjustmentV2(blacks);
  if (w === 0 && b === 0) return;
  // Conservative linear remap: whites pushes the white point up/down by
  // up to ~15%, blacks pushes the black point similarly — never a full
  // 0-255 remap, to avoid harsh clipping in an approximate preview.
  const whitePoint = 255 - w * 38;
  const blackPoint = b * 38;
  const range = Math.max(1, whitePoint - blackPoint);
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      data[i + c] = _clampByte(((data[i + c] - blackPoint) / range) * 255);
    }
  }
}

function _applyHighlightsShadows(data, highlights, shadows) {
  const h = normalizePreviewAdjustmentV2(highlights), s = normalizePreviewAdjustmentV2(shadows);
  if (h === 0 && s === 0) return;
  for (let i = 0; i < data.length; i += 4) {
    const luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    // Highlights affect bright pixels more (luma-weighted toward 255);
    // shadows affect dark pixels more (luma-weighted toward 0). Both
    // are conservative additive shifts, never multiplicative blowouts.
    const highlightWeight = Math.pow(luma / 255, 2);
    const shadowWeight = Math.pow(1 - luma / 255, 2);
    const shift = h * highlightWeight * -30 + s * shadowWeight * 30;
    for (let c = 0; c < 3; c++) data[i + c] = _clampByte(data[i + c] + shift);
  }
}

function _applyContrastToneCurve(data, contrast, toneCurve) {
  const c = normalizePreviewAdjustmentV2(contrast);
  const curve = _isRecord(toneCurve) ? toneCurve : null;
  if (c === 0 && !curve) return;
  // Conservative S-curve around the midpoint (128) for `contrast`;
  // additive per-zone nudges (shadow/midtone/highlight) for
  // `toneCurve` — never a full arbitrary spline, only the three
  // canonical zones this codebase's Legacy preset actually produces.
  const contrastFactor = 1 + c * 0.5;
  for (let i = 0; i < data.length; i += 4) {
    for (let ch = 0; ch < 3; ch++) {
      let val = data[i + ch];
      if (contrastFactor !== 1) val = (val - 128) * contrastFactor + 128;
      if (curve) {
        const zoneShift = val < 85 ? (normalizePreviewAdjustmentV2(curve.shadows) * 20)
          : val > 170 ? (normalizePreviewAdjustmentV2(curve.highlights) * 20)
          : (normalizePreviewAdjustmentV2(curve.midtone) * 20);
        val += zoneShift;
      }
      data[i + ch] = _clampByte(val);
    }
  }
}

function _applyTemperatureTint(data, temperature, tint) {
  const t = normalizePreviewAdjustmentV2(temperature), ti = normalizePreviewAdjustmentV2(tint);
  if (t === 0 && ti === 0) return;
  // Temperature: warm (+t) boosts red/reduces blue, cool (-t) the
  // opposite. Tint: magenta (+ti) boosts red+blue/reduces green, green
  // (-ti) the opposite. Conservative ±20-unit shifts, never a full
  // Kelvin-accurate white-balance model.
  const rShift = t * 20 + ti * 12, gShift = -ti * 16, bShift = -t * 20 + ti * 12;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = _clampByte(data[i] + rShift);
    data[i + 1] = _clampByte(data[i + 1] + gShift);
    data[i + 2] = _clampByte(data[i + 2] + bShift);
  }
}

function _applySaturationVibrance(data, saturation, vibrance) {
  const s = normalizePreviewAdjustmentV2(saturation), v = normalizePreviewAdjustmentV2(vibrance);
  if (s === 0 && v === 0) return;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const currentSat = max === 0 ? 0 : (max - min) / max;
    // Vibrance protects already-saturated pixels more than saturation
    // does (a conservative approximation of Lightroom's behavior, not
    // an exact reproduction).
    const vibranceFactor = 1 + v * (1 - currentSat) * 0.6;
    const saturationFactor = 1 + s * 0.6;
    const totalFactor = vibranceFactor * saturationFactor;
    data[i] = _clampByte(luma + (r - luma) * totalFactor);
    data[i + 1] = _clampByte(luma + (g - luma) * totalFactor);
    data[i + 2] = _clampByte(luma + (b - luma) * totalFactor);
  }
}

function _applyClarityDehaze(data, width, height, clarity, dehaze) {
  const c = normalizePreviewAdjustmentV2(clarity), d = normalizePreviewAdjustmentV2(dehaze);
  if (c === 0 && d === 0) return;
  // Conservative approximation only: a simple local-midtone-contrast
  // nudge based on each pixel's distance from mid-gray — NOT a real
  // unsharp-mask/local-contrast or haze-removal algorithm. This is
  // intentionally simple for Phase A; it is documented as approximate,
  // never claimed to reproduce Lightroom's actual Clarity/Dehaze math.
  const strength = (c + d) * 0.25;
  if (strength === 0) return;
  for (let i = 0; i < data.length; i += 4) {
    for (let ch = 0; ch < 3; ch++) {
      const val = data[i + ch];
      const distFromMid = val - 128;
      data[i + ch] = _clampByte(val + distFromMid * strength * 0.3);
    }
  }
}

function _applyColorGrading(data, colorGrading) {
  const g = _isRecord(colorGrading) ? colorGrading : null;
  if (!g) return;
  // Extremely conservative: only a small additive shadow/highlight hue
  // lean via cross-channel nudges — never a full HSL wheel
  // transformation. Approximate only.
  const shadowSat = normalizePreviewAdjustmentV2(g.shadowSat);
  const highlightSat = normalizePreviewAdjustmentV2(g.highlightSat);
  if (shadowSat === 0 && highlightSat === 0) return;
  for (let i = 0; i < data.length; i += 4) {
    const luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    const isShadow = luma < 85, isHighlight = luma > 170;
    const nudge = isShadow ? shadowSat * 8 : isHighlight ? highlightSat * 8 : 0;
    if (nudge !== 0) {
      data[i] = _clampByte(data[i] + nudge);
      data[i + 2] = _clampByte(data[i + 2] - nudge * 0.5);
    }
  }
}

/**
 * Documents and executes the deterministic pixel-pipeline order. Every
 * step reads/writes the SAME `Uint8ClampedArray` in place — never a
 * new buffer per step — to avoid repeated transform accumulation
 * artifacts and to bound memory use to one buffer for the whole
 * pipeline (plus the ImageData wrapper itself).
 */
const _PIXEL_PIPELINE_ORDER = [
  '1. source decode/bitmap readiness',
  '2. resize to safe preview resolution',
  '3. exposure',
  '4. white/black point approximation',
  '5. highlights/shadows approximation',
  '6. contrast/tone curve approximation',
  '7. temperature/tint approximation',
  '8. saturation/vibrance approximation',
  '9. clarity/dehaze approximation',
  '10. limited color grading',
  '11. alpha restoration',
  '12. final clamp',
];

function _runPixelPipeline(imageData, model, appliedAdjustments, skippedAdjustments) {
  const { data, width, height } = imageData;
  const track = (name, fn, ...args) => {
    const before = model[name];
    if (before === null || before === undefined) { skippedAdjustments.push(name); return; }
    fn(...args);
    appliedAdjustments.push(name);
  };

  // Preserve original alpha values before any RGB processing touches
  // the buffer, so step 11 can restore them exactly regardless of what
  // any earlier step did (none of the transforms above touch alpha,
  // but this guarantees correctness even if that ever changes).
  const originalAlpha = new Uint8ClampedArray(data.length / 4);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) originalAlpha[j] = data[i + 3];

  track('exposure', _applyExposure, data, model.exposure);
  if (model.whites !== null || model.blacks !== null) { _applyWhiteBlackPoint(data, model.whites ?? 0, model.blacks ?? 0); if (model.whites !== null) appliedAdjustments.push('whites'); else skippedAdjustments.push('whites'); if (model.blacks !== null) appliedAdjustments.push('blacks'); else skippedAdjustments.push('blacks'); }
  else { skippedAdjustments.push('whites', 'blacks'); }
  if (model.highlights !== null || model.shadows !== null) { _applyHighlightsShadows(data, model.highlights ?? 0, model.shadows ?? 0); if (model.highlights !== null) appliedAdjustments.push('highlights'); else skippedAdjustments.push('highlights'); if (model.shadows !== null) appliedAdjustments.push('shadows'); else skippedAdjustments.push('shadows'); }
  else { skippedAdjustments.push('highlights', 'shadows'); }
  if (model.contrast !== null || model.toneCurve) { _applyContrastToneCurve(data, model.contrast ?? 0, model.toneCurve); if (model.contrast !== null) appliedAdjustments.push('contrast'); else skippedAdjustments.push('contrast'); if (model.toneCurve) appliedAdjustments.push('toneCurve'); else skippedAdjustments.push('toneCurve'); }
  else { skippedAdjustments.push('contrast', 'toneCurve'); }
  if (model.temperature !== null || model.tint !== null) { _applyTemperatureTint(data, model.temperature ?? 0, model.tint ?? 0); if (model.temperature !== null) appliedAdjustments.push('temperature'); else skippedAdjustments.push('temperature'); if (model.tint !== null) appliedAdjustments.push('tint'); else skippedAdjustments.push('tint'); }
  else { skippedAdjustments.push('temperature', 'tint'); }
  if (model.saturation !== null || model.vibrance !== null) { _applySaturationVibrance(data, model.saturation ?? 0, model.vibrance ?? 0); if (model.saturation !== null) appliedAdjustments.push('saturation'); else skippedAdjustments.push('saturation'); if (model.vibrance !== null) appliedAdjustments.push('vibrance'); else skippedAdjustments.push('vibrance'); }
  else { skippedAdjustments.push('saturation', 'vibrance'); }
  if (model.clarity !== null || model.dehaze !== null) { _applyClarityDehaze(data, width, height, model.clarity ?? 0, model.dehaze ?? 0); if (model.clarity !== null) appliedAdjustments.push('clarity'); else skippedAdjustments.push('clarity'); if (model.dehaze !== null) appliedAdjustments.push('dehaze'); else skippedAdjustments.push('dehaze'); }
  else { skippedAdjustments.push('clarity', 'dehaze'); }
  track('colorGrading', _applyColorGrading, data, model.colorGrading);

  // 11. alpha restoration — guarantee alpha is exactly the original
  // captured value, never drifted by any RGB-only transform above.
  for (let i = 0, j = 0; i < data.length; i += 4, j++) data[i + 3] = originalAlpha[j];

  // 12. final clamp — Uint8ClampedArray already clamps every write,
  // but this guards against any accidental raw-array substitution in
  // the future; a defensive no-op today, cheap enough to always run.
  for (let i = 0; i < data.length; i++) data[i] = _clampByte(data[i]);
}

/**
 * Test-only pure helper: applies the full pipeline to a plain
 * Uint8ClampedArray/width/height triple without any canvas/DOM
 * involvement. Exported per the phase spec's "test helpers" allowance.
 */
export function applyPreviewPixelTransformV2(imageDataLike, adjustmentModel) {
  const model = _isRecord(adjustmentModel) ? adjustmentModel : {};
  const applied = [], skipped = [];
  _runPixelPipeline(imageDataLike, model, applied, skipped);
  return { appliedAdjustments: applied, skippedAdjustments: skipped };
}

const HONESTY_WARNINGS = [
  'This browser preview is an approximation — it is NOT Lightroom-accurate.',
  'RAW development is not simulated.',
  'Camera profiles are not reproduced.',
  'Local masks are not reproduced.',
  'Color-management differences from Lightroom/ACR may remain.',
];

function _baseResult({ side, generationId, state, rendered = false, warnings = [], reasons = [], processingTimeMs = 0, disposed = false }) {
  return {
    mode: 'isolated-browser-preview-render',
    state, side: side === 'v2' ? 'v2' : 'legacy',
    rendered,
    previewAccuracy: 'approximate-browser-preview',
    cssWidth: 0, cssHeight: 0, backingWidth: 0, backingHeight: 0, devicePixelRatio: 0,
    processingTimeMs: +processingTimeMs.toFixed(2),
    appliedAdjustments: [], skippedAdjustments: [],
    warnings: [...new Set([...warnings, ...HONESTY_WARNINGS])],
    reasons,
    sourceGenerationId: generationId ?? null,
    disposed,
    metadata: { pixelPipelineOrder: _PIXEL_PIPELINE_ORDER },
  };
}

/**
 * Computes conservative safe preview dimensions from real source
 * dimensions and the Render Plan's sharedRenderConstraints, preserving
 * aspect ratio and never upscaling.
 */
function _computeSafeDimensions(sourceWidth, sourceHeight, constraints) {
  const maxW = Number.isFinite(constraints?.maxInputWidth) && constraints.maxInputWidth > 0 ? constraints.maxInputWidth : 2048;
  const maxH = Number.isFinite(constraints?.maxInputHeight) && constraints.maxInputHeight > 0 ? constraints.maxInputHeight : 2048;
  if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) || sourceWidth <= 0 || sourceHeight <= 0) return null;
  const scale = Math.min(1, maxW / sourceWidth, maxH / sourceHeight);
  return { width: Math.max(1, Math.round(sourceWidth * scale)), height: Math.max(1, Math.round(sourceHeight * scale)) };
}

function _getSourceDimensions(source) {
  if (!source) return null;
  const w = source.naturalWidth ?? source.width, h = source.naturalHeight ?? source.height;
  return Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 ? { width: w, height: h } : null;
}

function _isSupportedSource(source) {
  if (!source || typeof source !== 'object') return false;
  const ctor = source.constructor?.name;
  return (typeof HTMLImageElement !== 'undefined' && source instanceof HTMLImageElement)
    || (typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap)
    || (typeof HTMLCanvasElement !== 'undefined' && source instanceof HTMLCanvasElement)
    || (typeof OffscreenCanvas !== 'undefined' && source instanceof OffscreenCanvas)
    || ctor === 'HTMLImageElement' || ctor === 'ImageBitmap' || ctor === 'HTMLCanvasElement' || ctor === 'OffscreenCanvas'; // duck-typed fallback for cross-realm instances in tests
}

/** Creates a detached (never DOM-appended) temporary canvas, preferring OffscreenCanvas when available. */
function _createTempCanvas(width, height) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  if (typeof document !== 'undefined') { const c = document.createElement('canvas'); c.width = width; c.height = height; return c; }
  return null;
}

/**
 * Renders one isolated preview (Legacy or V2 side) into the supplied
 * target canvas, using the given Render Plan. Never mutates `source`.
 * Safe to call with any malformed/missing input — always returns a
 * well-formed result object, never throws.
 *
 * @param {object} params
 * @param {HTMLImageElement|ImageBitmap|HTMLCanvasElement|OffscreenCanvas} params.source
 * @param {HTMLCanvasElement|OffscreenCanvas} params.canvas - the caller-owned target canvas this function draws into
 * @param {object} params.renderPlan - the object returned by buildVisualPreviewRenderPlanV2()
 * @param {"legacy"|"v2"} params.side
 * @param {number} [params.generationId] - used for stale-render protection when paired with a controller from createIsolatedVisualPreviewRendererV2()
 * @param {AbortSignal} [params.signal]
 */
export async function renderIsolatedVisualPreviewV2({ source, canvas, renderPlan, side, generationId, signal } = {}) {
  const startTime = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const normalizedSide = side === 'v2' ? 'v2' : side === 'legacy' ? 'legacy' : null;

  if (signal?.aborted) return _baseResult({ side: normalizedSide ?? 'legacy', generationId, state: 'cancelled', reasons: ['Render was already cancelled before starting.'], processingTimeMs: (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startTime });

  if (!normalizedSide) return _baseResult({ side: 'legacy', generationId, state: 'unavailable', reasons: ['Invalid or missing "side" — must be "legacy" or "v2".'] });
  if (!canvas || typeof canvas.getContext !== 'function') return _baseResult({ side: normalizedSide, generationId, state: 'unavailable', reasons: ['Missing or invalid target canvas.'] });
  if (!_isSupportedSource(source)) return _baseResult({ side: normalizedSide, generationId, state: 'unavailable', reasons: ['Missing or unsupported source (must be HTMLImageElement, ImageBitmap, HTMLCanvasElement, or OffscreenCanvas).'] });

  const plan = _isRecord(renderPlan) ? (normalizedSide === 'v2' ? renderPlan.v2RenderPlan : renderPlan.legacyRenderPlan) : null;
  if (!plan || plan.renderable !== true) {
    return _baseResult({ side: normalizedSide, generationId, state: 'blocked', reasons: [!plan ? 'No render plan was supplied for this side.' : 'The supplied render plan is not marked renderable for this side.'] });
  }

  const sourceDims = _getSourceDimensions(source);
  if (!sourceDims) return _baseResult({ side: normalizedSide, generationId, state: 'failed', reasons: ['Source has zero or invalid dimensions.'] });

  const safeDims = _computeSafeDimensions(sourceDims.width, sourceDims.height, plan.renderConstraints ?? renderPlan?.sharedRenderConstraints);
  if (!safeDims) return _baseResult({ side: normalizedSide, generationId, state: 'failed', reasons: ['Could not compute safe preview dimensions.'] });

  if (signal?.aborted) return _baseResult({ side: normalizedSide, generationId, state: 'cancelled', reasons: ['Cancelled before pixel processing began.'] });

  const dpr = Math.min(2, (typeof window !== 'undefined' && Number.isFinite(window.devicePixelRatio) ? window.devicePixelRatio : 1), Number.isFinite(plan.renderConstraints?.maxDevicePixelRatio) ? plan.renderConstraints.maxDevicePixelRatio : 2);
  const backingWidth = Math.max(1, Math.round(safeDims.width * dpr));
  const backingHeight = Math.max(1, Math.round(safeDims.height * dpr));

  let tempCanvas, tempCtx, imageData;
  try {
    tempCanvas = _createTempCanvas(backingWidth, backingHeight);
    if (!tempCanvas) return _baseResult({ side: normalizedSide, generationId, state: 'failed', reasons: ['No canvas implementation is available in this environment.'] });
    tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
    if (!tempCtx) return _baseResult({ side: normalizedSide, generationId, state: 'failed', reasons: ['Could not acquire a 2D rendering context.'] });

    tempCtx.setTransform(1, 0, 0, 1, 0, 0); // reset before drawing — never accumulate transforms across renders
    tempCtx.clearRect(0, 0, backingWidth, backingHeight);
    tempCtx.drawImage(source, 0, 0, backingWidth, backingHeight);

    if (signal?.aborted) return _baseResult({ side: normalizedSide, generationId, state: 'cancelled', reasons: ['Cancelled after draw, before pixel read.'] });

    try {
      imageData = tempCtx.getImageData(0, 0, backingWidth, backingHeight);
    } catch (e) {
      return _baseResult({ side: normalizedSide, generationId, state: 'failed', reasons: ['Could not read pixel data — the source may be cross-origin/tainted.'] });
    }
  } catch (e) {
    return _baseResult({ side: normalizedSide, generationId, state: 'failed', reasons: [`Rendering failed unexpectedly (production unaffected): ${e?.message ?? 'unknown error'}`] });
  }

  if (signal?.aborted) return _baseResult({ side: normalizedSide, generationId, state: 'cancelled', reasons: ['Cancelled after pixel read, before processing.'] });

  const appliedAdjustments = [], skippedAdjustments = [];
  try {
    _runPixelPipeline(imageData, plan.adjustmentModel ?? {}, appliedAdjustments, skippedAdjustments);
  } catch (e) {
    return _baseResult({ side: normalizedSide, generationId, state: 'failed', reasons: [`Pixel processing failed unexpectedly (production unaffected): ${e?.message ?? 'unknown error'}`] });
  }

  if (signal?.aborted) return _baseResult({ side: normalizedSide, generationId, state: 'cancelled', reasons: ['Cancelled after processing, before commit — target canvas left untouched.'] });

  // Commit: only now does the CALLER-SUPPLIED target canvas get
  // touched — everything above operated on the detached temp canvas,
  // so a cancelled/failed render never leaves partial pixels on the
  // caller's real canvas.
  try {
    canvas.width = backingWidth;
    canvas.height = backingHeight;
    const targetCtx = canvas.getContext('2d');
    if (!targetCtx) return _baseResult({ side: normalizedSide, generationId, state: 'failed', reasons: ['Could not acquire a 2D context on the target canvas.'] });
    targetCtx.setTransform(1, 0, 0, 1, 0, 0);
    targetCtx.putImageData(imageData, 0, 0);
    if (canvas.style) canvas.style.width = '100%';
  } catch (e) {
    return _baseResult({ side: normalizedSide, generationId, state: 'failed', reasons: [`Could not commit rendered pixels to the target canvas: ${e?.message ?? 'unknown error'}`] });
  }

  const endTime = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const result = _baseResult({
    side: normalizedSide, generationId, state: 'rendered', rendered: true,
    reasons: [`Rendered ${appliedAdjustments.length} adjustment(s), skipped ${skippedAdjustments.length} unsupported/unavailable adjustment(s).`],
    processingTimeMs: endTime - startTime,
  });
  result.cssWidth = safeDims.width;
  result.cssHeight = safeDims.height;
  result.backingWidth = backingWidth;
  result.backingHeight = backingHeight;
  result.devicePixelRatio = dpr;
  result.appliedAdjustments = appliedAdjustments;
  result.skippedAdjustments = skippedAdjustments;
  return result;
}

/**
 * Creates a small controller object for generation-based stale-render
 * protection across repeated calls (e.g. Re-analyze, side-switching).
 * Does not itself hold any canvas/image reference — callers still pass
 * those explicitly to `render()` each time, keeping this controller
 * free of any DOM/mutable-global coupling beyond its own counters.
 */
export function createIsolatedVisualPreviewRendererV2(options = {}) {
  let currentGenerationId = 0;
  let disposed = false;

  function nextGeneration() {
    return ++currentGenerationId;
  }

  async function render(input = {}) {
    if (disposed) {
      return { mode: 'isolated-browser-preview-render', state: 'unavailable', side: input.side === 'v2' ? 'v2' : 'legacy', rendered: false, previewAccuracy: 'approximate-browser-preview', cssWidth: 0, cssHeight: 0, backingWidth: 0, backingHeight: 0, devicePixelRatio: 0, processingTimeMs: 0, appliedAdjustments: [], skippedAdjustments: [], warnings: [...HONESTY_WARNINGS], reasons: ['Renderer has been disposed.'], sourceGenerationId: input.generationId ?? null, disposed: true, metadata: {} };
    }
    const generationId = input.generationId ?? nextGeneration();
    const result = await renderIsolatedVisualPreviewV2({ ...input, generationId });
    // Stale-generation protection: if a NEWER render was requested
    // while this one was in flight, downgrade this result to
    // "cancelled" even if it technically finished — a newer render
    // must always win, never an older one committing after it.
    if (generationId !== currentGenerationId && input.generationId === undefined) {
      // Only applies when this controller assigned the generation ID
      // itself (input.generationId === undefined case) — an
      // explicitly-caller-supplied generationId is the caller's own
      // responsibility to compare against their own source of truth.
      return { ...result, state: result.state === 'rendered' ? 'cancelled' : result.state, rendered: false, reasons: [...result.reasons, 'A newer render superseded this one after completion — result discarded.'] };
    }
    return result;
  }

  function isStale(generationId) {
    return generationId !== currentGenerationId;
  }

  function dispose() {
    disposed = true;
  }

  return {
    render,
    nextGeneration,
    isStale,
    dispose,
    get disposed() { return disposed; },
    get currentGenerationId() { return currentGenerationId; },
  };
}

/**
 * Disposes a renderer created by createIsolatedVisualPreviewRendererV2.
 * Safe to call multiple times, safe to call with a malformed/foreign
 * object (no-op rather than throwing).
 */
export function disposeIsolatedVisualPreviewRendererV2(renderer) {
  if (renderer && typeof renderer.dispose === 'function') renderer.dispose();
}
