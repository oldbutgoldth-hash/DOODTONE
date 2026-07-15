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

function _applyExposure(data, value, startByte = 0, endByte = data.length) {
  const v = normalizePreviewAdjustmentV2(value);
  if (v === 0) return;
  // Approximate ±2-stop range: 2^(v*2) → v=-1 → 0.25x, v=+1 → 4x.
  const factor = Math.pow(2, v * 2);
  for (let i = startByte; i < endByte; i += 4) {
    data[i] = _clampByte(data[i] * factor);
    data[i + 1] = _clampByte(data[i + 1] * factor);
    data[i + 2] = _clampByte(data[i + 2] * factor);
  }
}

function _applyWhiteBlackPoint(data, whites, blacks, startByte = 0, endByte = data.length) {
  const w = normalizePreviewAdjustmentV2(whites), b = normalizePreviewAdjustmentV2(blacks);
  if (w === 0 && b === 0) return;
  // Conservative linear remap: whites pushes the white point up/down by
  // up to ~15%, blacks pushes the black point similarly — never a full
  // 0-255 remap, to avoid harsh clipping in an approximate preview.
  const whitePoint = 255 - w * 38;
  const blackPoint = b * 38;
  const range = Math.max(1, whitePoint - blackPoint);
  for (let i = startByte; i < endByte; i += 4) {
    for (let c = 0; c < 3; c++) {
      data[i + c] = _clampByte(((data[i + c] - blackPoint) / range) * 255);
    }
  }
}

function _applyHighlightsShadows(data, highlights, shadows, startByte = 0, endByte = data.length) {
  const h = normalizePreviewAdjustmentV2(highlights), s = normalizePreviewAdjustmentV2(shadows);
  if (h === 0 && s === 0) return;
  for (let i = startByte; i < endByte; i += 4) {
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

function _applyContrastToneCurve(data, contrast, toneCurve, startByte = 0, endByte = data.length) {
  const c = normalizePreviewAdjustmentV2(contrast);
  const curve = _isRecord(toneCurve) ? toneCurve : null;
  if (c === 0 && !curve) return;
  // Conservative S-curve around the midpoint (128) for `contrast`;
  // additive per-zone nudges (shadow/midtone/highlight) for
  // `toneCurve` — never a full arbitrary spline, only the three
  // canonical zones this codebase's Legacy preset actually produces.
  const contrastFactor = 1 + c * 0.5;
  for (let i = startByte; i < endByte; i += 4) {
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

function _applyTemperatureTint(data, temperature, tint, startByte = 0, endByte = data.length) {
  const t = normalizePreviewAdjustmentV2(temperature), ti = normalizePreviewAdjustmentV2(tint);
  if (t === 0 && ti === 0) return;
  // Temperature: warm (+t) boosts red/reduces blue, cool (-t) the
  // opposite. Tint: magenta (+ti) boosts red+blue/reduces green, green
  // (-ti) the opposite. Conservative ±20-unit shifts, never a full
  // Kelvin-accurate white-balance model.
  const rShift = t * 20 + ti * 12, gShift = -ti * 16, bShift = -t * 20 + ti * 12;
  for (let i = startByte; i < endByte; i += 4) {
    data[i] = _clampByte(data[i] + rShift);
    data[i + 1] = _clampByte(data[i + 1] + gShift);
    data[i + 2] = _clampByte(data[i + 2] + bShift);
  }
}

function _applySaturationVibrance(data, saturation, vibrance, startByte = 0, endByte = data.length) {
  const s = normalizePreviewAdjustmentV2(saturation), v = normalizePreviewAdjustmentV2(vibrance);
  if (s === 0 && v === 0) return;
  for (let i = startByte; i < endByte; i += 4) {
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

function _applyClarityDehaze(data, width, height, clarity, dehaze, startByte = 0, endByte = data.length) {
  const c = normalizePreviewAdjustmentV2(clarity), d = normalizePreviewAdjustmentV2(dehaze);
  if (c === 0 && d === 0) return;
  // Conservative approximation only: a simple local-midtone-contrast
  // nudge based on each pixel's distance from mid-gray — NOT a real
  // unsharp-mask/local-contrast or haze-removal algorithm. This is
  // intentionally simple for Phase A; it is documented as approximate,
  // never claimed to reproduce Lightroom's actual Clarity/Dehaze math.
  const strength = (c + d) * 0.25;
  if (strength === 0) return;
  for (let i = startByte; i < endByte; i += 4) {
    for (let ch = 0; ch < 3; ch++) {
      const val = data[i + ch];
      const distFromMid = val - 128;
      data[i + ch] = _clampByte(val + distFromMid * strength * 0.3);
    }
  }
}

function _applyColorGrading(data, colorGrading, startByte = 0, endByte = data.length) {
  const g = _isRecord(colorGrading) ? colorGrading : null;
  if (!g) return;
  // Extremely conservative: only a small additive shadow/highlight hue
  // lean via cross-channel nudges — never a full HSL wheel
  // transformation. Approximate only.
  const shadowSat = normalizePreviewAdjustmentV2(g.shadowSat);
  const highlightSat = normalizePreviewAdjustmentV2(g.highlightSat);
  if (shadowSat === 0 && highlightSat === 0) return;
  for (let i = startByte; i < endByte; i += 4) {
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

/** Yields control back to the event loop — a lightweight macrotask boundary, never an arbitrary long delay. */
function _yieldToEventLoop() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

const DEFAULT_CHUNK_PIXEL_BUDGET = 100000; // within the spec's recommended 50,000-150,000 range

/**
 * FIX 2 + FIX 3 (EPIC 2E-H-A-F2): chunked, cancellable pixel pipeline.
 * Unlike the fully-synchronous `_runPixelPipeline` above (kept for the
 * small-buffer pure test helper), this version processes each
 * pipeline stage in bounded pixel-count chunks, yielding to the event
 * loop after every chunk so the browser can run abort callbacks,
 * dispose(), and newer render requests WHILE a large image is still
 * being processed — not just between pipeline stages, but within a
 * single stage on a large image. `signal`/`shouldContinue` are
 * re-checked after every single chunk, at every stage boundary, and
 * immediately before the final alpha-restore/clamp pass.
 *
 * Returns `{ cancelled: boolean, cancellationChecks: number,
 * yieldedToEventLoop: boolean }` in addition to mutating
 * appliedAdjustments/skippedAdjustments in place, same as the sync
 * version.
 */
async function _runPixelPipelineAsyncV2(imageData, model, appliedAdjustments, skippedAdjustments, { signal, shouldContinue, chunkPixelBudget = DEFAULT_CHUNK_PIXEL_BUDGET } = {}) {
  const { data, width, height } = imageData;
  const totalPixels = width * height;
  const chunkBytes = Math.max(4, Math.floor(chunkPixelBudget) * 4);
  let cancellationChecks = 0;
  let yieldedToEventLoop = false;

  const isCancelled = () => {
    cancellationChecks++;
    return !!signal?.aborted || (typeof shouldContinue === 'function' && shouldContinue() !== true);
  };

  if (isCancelled()) return { cancelled: true, cancellationChecks, yieldedToEventLoop };

  // Preserve original alpha values before any RGB processing touches
  // the buffer — this is a single cheap pass (one byte per pixel, no
  // per-channel math), left un-chunked since even an 8K image is a
  // small, fast typed-array copy.
  const originalAlpha = new Uint8ClampedArray(totalPixels);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) originalAlpha[j] = data[i + 3];

  // Each stage: a name list (for applied/skipped bookkeeping), an
  // availability check against the normalized adjustment model, and a
  // range-apply function using the SAME transform functions the sync
  // pipeline uses — just invoked per-chunk instead of over the whole
  // buffer at once.
  const stages = [
    { names: ['exposure'], available: model.exposure !== null && model.exposure !== undefined, apply: (s, e) => _applyExposure(data, model.exposure, s, e) },
    { names: ['whites', 'blacks'], available: model.whites !== null && model.whites !== undefined || model.blacks !== null && model.blacks !== undefined, apply: (s, e) => _applyWhiteBlackPoint(data, model.whites ?? 0, model.blacks ?? 0, s, e) },
    { names: ['highlights', 'shadows'], available: model.highlights !== null && model.highlights !== undefined || model.shadows !== null && model.shadows !== undefined, apply: (s, e) => _applyHighlightsShadows(data, model.highlights ?? 0, model.shadows ?? 0, s, e) },
    { names: ['contrast', 'toneCurve'], available: (model.contrast !== null && model.contrast !== undefined) || !!model.toneCurve, apply: (s, e) => _applyContrastToneCurve(data, model.contrast ?? 0, model.toneCurve, s, e) },
    { names: ['temperature', 'tint'], available: model.temperature !== null && model.temperature !== undefined || model.tint !== null && model.tint !== undefined, apply: (s, e) => _applyTemperatureTint(data, model.temperature ?? 0, model.tint ?? 0, s, e) },
    { names: ['saturation', 'vibrance'], available: model.saturation !== null && model.saturation !== undefined || model.vibrance !== null && model.vibrance !== undefined, apply: (s, e) => _applySaturationVibrance(data, model.saturation ?? 0, model.vibrance ?? 0, s, e) },
    { names: ['clarity', 'dehaze'], available: model.clarity !== null && model.clarity !== undefined || model.dehaze !== null && model.dehaze !== undefined, apply: (s, e) => _applyClarityDehaze(data, width, height, model.clarity ?? 0, model.dehaze ?? 0, s, e) },
    { names: ['colorGrading'], available: model.colorGrading !== null && model.colorGrading !== undefined, apply: (s, e) => _applyColorGrading(data, model.colorGrading, s, e) },
  ];

  for (const stage of stages) {
    if (!stage.available) { skippedAdjustments.push(...stage.names); continue; }
    // Process this stage in bounded byte-range chunks across the whole
    // buffer, checking cancellation after every chunk.
    for (let startByte = 0; startByte < data.length; startByte += chunkBytes) {
      if (isCancelled()) return { cancelled: true, cancellationChecks, yieldedToEventLoop };
      const endByte = Math.min(startByte + chunkBytes, data.length);
      stage.apply(startByte, endByte);
      if (endByte < data.length) { await _yieldToEventLoop(); yieldedToEventLoop = true; }
    }
    if (isCancelled()) return { cancelled: true, cancellationChecks, yieldedToEventLoop };
    appliedAdjustments.push(...stage.names);
  }

  if (isCancelled()) return { cancelled: true, cancellationChecks, yieldedToEventLoop };

  // 11. alpha restoration — same guarantee as the sync pipeline.
  for (let i = 0, j = 0; i < data.length; i += 4, j++) data[i + 3] = originalAlpha[j];
  // 12. final clamp — defensive no-op, cheap enough to run unchunked.
  for (let i = 0; i < data.length; i++) data[i] = _clampByte(data[i]);

  return { cancelled: false, cancellationChecks, yieldedToEventLoop };
}

/**
 * Test-only pure helper: applies the full pipeline to a plain
 * Uint8ClampedArray/width/height triple without any canvas/DOM
 * involvement. Exported per the phase spec's "test helpers" allowance.
 *
 * FIX 7 (EPIC 2E-H-A-F): validates every input shape defensively
 * before touching it — never throws, never mutates malformed input.
 * For VALID input, the supplied `data` buffer is mutated in place
 * (documented here explicitly, per the phase spec's allowance) since
 * this mirrors the real canvas pipeline's own in-place behavior and
 * avoids an extra full-size buffer allocation.
 */
export function applyPreviewPixelTransformV2(imageDataLike, adjustmentModel) {
  if (!_isRecord(imageDataLike)) {
    return { state: 'unavailable', transformed: false, appliedAdjustments: [], skippedAdjustments: [], warnings: [], reasons: ['imageDataLike must be an object with data/width/height.'] };
  }
  const { data, width, height } = imageDataLike;
  if (!(data instanceof Uint8ClampedArray)) {
    return { state: 'unavailable', transformed: false, appliedAdjustments: [], skippedAdjustments: [], warnings: [], reasons: ['imageDataLike.data must be a Uint8ClampedArray.'] };
  }
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 || !Number.isInteger(width) || !Number.isInteger(height)) {
    return { state: 'unavailable', transformed: false, appliedAdjustments: [], skippedAdjustments: [], warnings: [], reasons: ['imageDataLike.width/height must be finite positive integers.'] };
  }
  if (data.length < width * height * 4) {
    return { state: 'unavailable', transformed: false, appliedAdjustments: [], skippedAdjustments: [], warnings: [], reasons: [`imageDataLike.data.length (${data.length}) is smaller than required for ${width}x${height} RGBA pixels (${width * height * 4}).`] };
  }
  const model = _isRecord(adjustmentModel) ? adjustmentModel : {};
  const applied = [], skipped = [];
  try {
    _runPixelPipeline(imageDataLike, model, applied, skipped);
  } catch (e) {
    return { state: 'failed', transformed: false, appliedAdjustments: [], skippedAdjustments: [], warnings: [], reasons: [`Pixel transform failed unexpectedly: ${e?.message ?? 'unknown error'}`] };
  }
  return {
    state: 'rendered', transformed: true,
    appliedAdjustments: applied, skippedAdjustments: skipped,
    warnings: [...HONESTY_WARNINGS],
    reasons: [`Applied ${applied.length} adjustment(s), skipped ${skipped.length} unsupported/unavailable adjustment(s). Note: the supplied data buffer was mutated in place.`],
  };
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
export async function renderIsolatedVisualPreviewV2({ source, canvas, renderPlan, side, generationId, signal, shouldCommit } = {}) {
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

  // FIX 4 (EPIC 2E-H-A-F): for HTMLImageElement sources, wait for
  // decode readiness BEFORE reading dimensions or drawing — img.onload
  // already guarantees naturalWidth/naturalHeight are available, but
  // decode() additionally guarantees the browser has finished any
  // async decode work. Falls back safely (no arbitrary timeout) when
  // unsupported or when it rejects on an already-loaded image; never
  // mutates the source image itself. Canvas/ImageBitmap sources need
  // no decode step — already fully rasterized pixel data by
  // construction.
  if (typeof HTMLImageElement !== 'undefined' && source instanceof HTMLImageElement && typeof source.decode === 'function') {
    try {
      await source.decode();
    } catch (e) {
      return _baseResult({ side: normalizedSide, generationId, state: 'failed', reasons: [`Source image failed to decode: ${e?.message ?? 'unknown decode error'}`] });
    }
    if (signal?.aborted) return _baseResult({ side: normalizedSide, generationId, state: 'cancelled', reasons: ['Cancelled after image decode, before dimension read.'] });
    if (!Number.isFinite(source.naturalWidth) || !Number.isFinite(source.naturalHeight) || source.naturalWidth <= 0 || source.naturalHeight <= 0) {
      return _baseResult({ side: normalizedSide, generationId, state: 'failed', reasons: ['Source image decoded but reports zero or invalid natural dimensions.'] });
    }
  }

  const sourceDims = _getSourceDimensions(source);
  if (!sourceDims) return _baseResult({ side: normalizedSide, generationId, state: 'failed', reasons: ['Source has zero or invalid dimensions.'] });

  const safeDims = _computeSafeDimensions(sourceDims.width, sourceDims.height, plan.renderConstraints ?? renderPlan?.sharedRenderConstraints);
  if (!safeDims) return _baseResult({ side: normalizedSide, generationId, state: 'failed', reasons: ['Could not compute safe preview dimensions.'] });

  if (signal?.aborted) return _baseResult({ side: normalizedSide, generationId, state: 'cancelled', reasons: ['Cancelled before pixel processing began.'] });

  // FIX 3 (EPIC 2E-H-A-F): compute the REQUESTED DPR first, then
  // enforce maxPixelCount on the resulting backing dimensions — DPR
  // must never be allowed to multiply the pixel workload beyond the
  // configured limit. Malformed constraint values fall back to
  // conservative defaults rather than being trusted blindly.
  const constraints = plan.renderConstraints ?? renderPlan?.sharedRenderConstraints ?? {};
  const maxDPR = Number.isFinite(constraints.maxDevicePixelRatio) && constraints.maxDevicePixelRatio > 0 ? constraints.maxDevicePixelRatio : 2;
  const maxPixelCount = Number.isFinite(constraints.maxPixelCount) && constraints.maxPixelCount > 0 ? constraints.maxPixelCount : 2048 * 2048;
  const requestedDpr = Math.min(maxDPR, (typeof window !== 'undefined' && Number.isFinite(window.devicePixelRatio) && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1));

  let effectiveDpr = requestedDpr;
  let backingWidth = Math.max(1, Math.round(safeDims.width * effectiveDpr));
  let backingHeight = Math.max(1, Math.round(safeDims.height * effectiveDpr));
  let downscaledForMemorySafety = false;

  if (backingWidth * backingHeight > maxPixelCount) {
    downscaledForMemorySafety = true;
    // Reduce effective DPR (never CSS dimensions) to bring the backing
    // pixel count within budget, preserving aspect ratio exactly.
    const basePixelCount = Math.max(1, safeDims.width * safeDims.height);
    const maxDprForBudget = Math.sqrt(maxPixelCount / basePixelCount);
    effectiveDpr = Math.max(1, Math.min(effectiveDpr, maxDprForBudget));
    backingWidth = Math.max(1, Math.round(safeDims.width * effectiveDpr));
    backingHeight = Math.max(1, Math.round(safeDims.height * effectiveDpr));
    // Final safety net: if even DPR=1 at these CSS dimensions still
    // exceeds the budget (a very small maxPixelCount), clamp the
    // backing dimensions directly while preserving aspect ratio —
    // never silently exceed the configured limit.
    if (backingWidth * backingHeight > maxPixelCount) {
      const clampScale = Math.sqrt(maxPixelCount / (backingWidth * backingHeight));
      backingWidth = Math.max(1, Math.floor(backingWidth * clampScale));
      backingHeight = Math.max(1, Math.floor(backingHeight * clampScale));
    }
  }

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
  } finally {
    // FIX 10 (EPIC 2E-H-A-F): the temp canvas/context are no longer
    // needed once `imageData` has been extracted — dereferencing them
    // explicitly here (rather than only implicitly at function return)
    // lets the garbage collector reclaim the temp canvas's backing
    // memory sooner, which matters because the pixel pipeline below
    // can run for a while on a large image. This is honest reference
    // clearing, not a claim of manual memory deallocation — JavaScript
    // provides no such guarantee, and none is claimed here.
    tempCanvas = null;
    tempCtx = null;
  }

  if (signal?.aborted) return _baseResult({ side: normalizedSide, generationId, state: 'cancelled', reasons: ['Cancelled after pixel read, before processing.'] });

  // FIX 2 + FIX 3 (EPIC 2E-H-A-F2): chunked, cancellable pixel
  // processing — checks `signal`/`shouldCommit` after every bounded
  // chunk (not just at stage boundaries), so a large image cannot
  // block the event loop long enough to prevent an abort/dispose/
  // newer-render from taking effect during processing itself.
  const appliedAdjustments = [], skippedAdjustments = [];
  let pipelineResult;
  try {
    pipelineResult = await _runPixelPipelineAsyncV2(imageData, plan.adjustmentModel ?? {}, appliedAdjustments, skippedAdjustments, { signal, shouldContinue: shouldCommit });
  } catch (e) {
    return _baseResult({ side: normalizedSide, generationId, state: 'failed', reasons: [`Pixel processing failed unexpectedly (production unaffected): ${e?.message ?? 'unknown error'}`] });
  }
  if (pipelineResult.cancelled) {
    const r = _baseResult({ side: normalizedSide, generationId, state: 'cancelled', reasons: ['Cancelled during chunked pixel processing — target canvas left untouched.'] });
    r.metadata = { ...r.metadata, processingMode: 'chunked-main-thread', chunkPixelBudget: DEFAULT_CHUNK_PIXEL_BUDGET, cancellationChecks: pipelineResult.cancellationChecks, yieldedToEventLoop: pipelineResult.yieldedToEventLoop };
    return r;
  }

  // FIX 1 + FIX 9 (EPIC 2E-H-A-F): pre-commit authorization — checked
  // IMMEDIATELY before touching canvas.width/height/pixels, never
  // relying only on the post-render staleness check a caller might do
  // afterward (which is too late: an older render could otherwise
  // physically overwrite a newer one's pixels before its result object
  // is even inspected). `shouldCommit` is optional — callers not using
  // the controller below may omit it and rely on `signal` alone.
  if (typeof shouldCommit === 'function' && shouldCommit() !== true) {
    return _baseResult({ side: normalizedSide, generationId, state: 'cancelled', reasons: ['Commit authorization denied immediately before commit (stale generation, disposed renderer, or aborted signal) — target canvas left untouched.'] });
  }
  // Re-verify the target canvas is still a valid, usable canvas right
  // before commit — a caller could have discarded/replaced it during
  // the async work above.
  if (!canvas || typeof canvas.getContext !== 'function') {
    return _baseResult({ side: normalizedSide, generationId, state: 'failed', reasons: ['Target canvas became invalid before commit — nothing was written.'] });
  }
  if (!Number.isFinite(backingWidth) || !Number.isFinite(backingHeight) || backingWidth <= 0 || backingHeight <= 0 || backingWidth * backingHeight > maxPixelCount) {
    return _baseResult({ side: normalizedSide, generationId, state: 'failed', reasons: ['Computed backing dimensions are invalid or exceed the configured pixel budget — refusing to commit.'] });
  }

  // FIX 4 (EPIC 2E-H-A-F2): staged, atomic commit. The fully-processed
  // output is first built in a DETACHED staging canvas (never the
  // caller's target), so if anything fails while building it, the
  // target canvas is never touched at all. Only after the staging
  // canvas is complete AND every authorization check has been
  // re-verified does the target canvas get resized and drawn to, in
  // one short final operation — never resized/cleared speculatively
  // before commit is actually guaranteed to succeed.
  let stagingCanvas;
  try {
    stagingCanvas = _createTempCanvas(backingWidth, backingHeight);
    if (!stagingCanvas) return _baseResult({ side: normalizedSide, generationId, state: 'failed', reasons: ['No canvas implementation is available in this environment for staging.'] });
    const stagingCtx = stagingCanvas.getContext('2d');
    if (!stagingCtx) return _baseResult({ side: normalizedSide, generationId, state: 'failed', reasons: ['Could not acquire a 2D context on the staging canvas.'] });
    stagingCtx.putImageData(imageData, 0, 0);
  } catch (e) {
    return _baseResult({ side: normalizedSide, generationId, state: 'failed', reasons: [`Failed to build staged output: ${e?.message ?? 'unknown error'}`] });
  }

  // Final pre-commit re-validation — an async gap (however short)
  // exists between building the staging canvas and here, so
  // authorization is checked one last time immediately before the
  // target is ever touched.
  if (typeof shouldCommit === 'function' && shouldCommit() !== true) {
    stagingCanvas = null;
    return _baseResult({ side: normalizedSide, generationId, state: 'cancelled', reasons: ['Commit authorization denied immediately before final commit — target canvas left untouched.'] });
  }
  if (!canvas || typeof canvas.getContext !== 'function') {
    stagingCanvas = null;
    return _baseResult({ side: normalizedSide, generationId, state: 'failed', reasons: ['Target canvas became invalid immediately before final commit — nothing was written.'] });
  }

  // Capture previous target dimensions (cheap — two integers) for
  // best-effort restoration if the final commit throws. Pixel content
  // is NOT snapshotted here — doing so would require an extra
  // full-resolution buffer for what is expected to be an extremely
  // rare failure path (everything above has already succeeded by this
  // point); if restoration is needed, dimensions are restored honestly
  // and pixel-content restoration is reported as `false`, never
  // silently claimed.
  const previousWidth = canvas.width, previousHeight = canvas.height;
  let targetRestoredAfterFailure = null;
  try {
    canvas.width = backingWidth;
    canvas.height = backingHeight;
    const targetCtx = canvas.getContext('2d');
    if (!targetCtx) throw new Error('Target 2D context unavailable immediately after resize.');
    targetCtx.setTransform(1, 0, 0, 1, 0, 0);
    targetCtx.drawImage(stagingCanvas, 0, 0);
    if (canvas.style) canvas.style.width = '100%';
  } catch (e) {
    try { canvas.width = previousWidth; canvas.height = previousHeight; targetRestoredAfterFailure = false; }
    catch { targetRestoredAfterFailure = false; }
    stagingCanvas = null;
    const r = _baseResult({ side: normalizedSide, generationId, state: 'failed', reasons: [`Could not commit rendered pixels to the target canvas: ${e?.message ?? 'unknown error'}`] });
    r.metadata = { ...r.metadata, commitAtomicity: 'staged', targetRestoredAfterFailure };
    return r;
  } finally {
    stagingCanvas = null;
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
  result.devicePixelRatio = effectiveDpr;
  result.appliedAdjustments = appliedAdjustments;
  result.skippedAdjustments = skippedAdjustments;
  result.metadata = {
    ...result.metadata,
    requestedDevicePixelRatio: requestedDpr,
    effectiveDevicePixelRatio: effectiveDpr,
    pixelCount: backingWidth * backingHeight,
    downscaledForMemorySafety,
    // FIX 8 (EPIC 2E-H-A-F): honest — this renderer does not implement
    // a bounded elapsed-time timeout in Phase A/A-F; `timeoutMs` in
    // renderConstraints remains advisory only. Never implying an
    // enforced timeout that doesn't exist.
    timeoutEnforced: false,
    // FIX 7 (EPIC 2E-H-A-F2): honest processing metadata. Never claims
    // Worker rendering — `allowWorkerRendering` remains `false` in
    // sharedRenderConstraints, and `processingMode` always honestly
    // reports the real (main-thread, chunked) execution model.
    processingMode: 'chunked-main-thread',
    chunkPixelBudget: DEFAULT_CHUNK_PIXEL_BUDGET,
    cancellationChecks: pipelineResult.cancellationChecks,
    yieldedToEventLoop: pipelineResult.yieldedToEventLoop,
    commitAtomicity: 'staged',
    targetRestoredAfterFailure: null, // no failure occurred on this successful path
  };
  return result;
}

/**
 * Combines two AbortSignals into one that aborts when EITHER source
 * aborts. Uses the native `AbortSignal.any` when available; falls back
 * to a manual listener-based combine with explicit cleanup (both
 * listeners are removed once either fires, or when `cleanup()` is
 * called directly for the render-completed-without-abort case) so no
 * listener is ever left dangling after a render finishes normally.
 */
function _combineSignals(signalA, signalB) {
  if (!signalA) return { signal: signalB ?? undefined, cleanup: () => {} };
  if (!signalB) return { signal: signalA, cleanup: () => {} };
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.any === 'function') {
    return { signal: AbortSignal.any([signalA, signalB]), cleanup: () => {} };
  }
  const combined = new AbortController();
  if (signalA.aborted || signalB.aborted) { combined.abort(); return { signal: combined.signal, cleanup: () => {} }; }
  const onAbort = () => combined.abort();
  signalA.addEventListener('abort', onAbort, { once: true });
  signalB.addEventListener('abort', onAbort, { once: true });
  const cleanup = () => {
    signalA.removeEventListener('abort', onAbort);
    signalB.removeEventListener('abort', onAbort);
  };
  return { signal: combined.signal, cleanup };
}

/**
 * Creates a small controller object for generation-based stale-render
 * protection across repeated calls (e.g. Re-analyze, side-switching).
 * Does not itself hold any canvas/image reference — callers still pass
 * those explicitly to `render()` each time, keeping this controller
 * free of any DOM/mutable-global coupling beyond its own counters.
 *
 * FIX 2 (EPIC 2E-H-A-F): dispose() now genuinely cancels any in-flight
 * render — an internal AbortController is created per active render
 * and aborted on dispose, invalidating both the generation counter AND
 * the signal any in-progress renderIsolatedVisualPreviewV2 call is
 * checking. The caller's OWN AbortSignal (if supplied) is never
 * aborted by this controller — only the controller's internal one.
 */
export function createIsolatedVisualPreviewRendererV2(options = {}) {
  let currentGenerationId = 0;
  let disposed = false;
  const activeControllers = new Map(); // generationId -> internal AbortController

  function nextGeneration() {
    return ++currentGenerationId;
  }

  async function render(input = {}) {
    if (disposed) {
      return { mode: 'isolated-browser-preview-render', state: 'unavailable', side: input.side === 'v2' ? 'v2' : 'legacy', rendered: false, previewAccuracy: 'approximate-browser-preview', cssWidth: 0, cssHeight: 0, backingWidth: 0, backingHeight: 0, devicePixelRatio: 0, processingTimeMs: 0, appliedAdjustments: [], skippedAdjustments: [], warnings: [...HONESTY_WARNINGS], reasons: ['Renderer has been disposed.'], sourceGenerationId: input.generationId ?? null, disposed: true, metadata: {} };
    }
    // FIX 5 (EPIC 2E-H-A-F2): the controller ALWAYS owns generation IDs
    // — render() always calls nextGeneration() itself, regardless of
    // whether the caller also supplied a generationId. The old
    // `input.generationId ?? nextGeneration()` let a caller-supplied ID
    // silently desync from `currentGenerationId` (never updating it),
    // causing shouldCommit()'s `generationId === currentGenerationId`
    // check to permanently fail for an otherwise-valid, newest render
    // — a genuinely stale-forever bug, not just a caller convenience
    // gap. A caller-supplied ID is now preserved ONLY as external
    // metadata (`callerSuppliedGenerationId`) on the input passed
    // through, never used for freshness comparison.
    const callerSuppliedGenerationId = Number.isFinite(input.generationId) ? input.generationId : null;
    const generationId = nextGeneration();
    const internalController = new AbortController();
    activeControllers.set(generationId, internalController);

    const { signal: combinedSignal, cleanup: cleanupSignals } = _combineSignals(internalController.signal, input.signal);

    // FIX 1's exact recommended shouldCommit predicate — the single
    // final authority checked immediately before any pixel commit,
    // never relying only on a post-render check.
    const shouldCommit = () => !disposed && generationId === currentGenerationId && !combinedSignal?.aborted;

    try {
      const result = await renderIsolatedVisualPreviewV2({ ...input, generationId, signal: combinedSignal, shouldCommit });
      if (result.metadata) result.metadata.callerSuppliedGenerationId = callerSuppliedGenerationId;
      return result;
    } finally {
      // FIX 10 (EPIC 2E-H-A-F): resource cleanup — always runs
      // regardless of success/failure/cancellation, removing this
      // render's internal controller and any signal-combine listeners
      // so nothing is retained beyond the render's own lifetime.
      activeControllers.delete(generationId);
      cleanupSignals();
    }
  }

  function isStale(generationId) {
    return generationId !== currentGenerationId;
  }

  function dispose() {
    if (disposed) return; // idempotent — safe to call more than once
    disposed = true;
    // Invalidate every currently-tracked generation at once — no
    // future generationId can ever equal -1, so shouldCommit()
    // permanently denies commit for anything still in flight.
    currentGenerationId = -1;
    for (const controller of activeControllers.values()) {
      try { controller.abort(); } catch { /* already aborted, or AbortController.abort unsupported in this environment — safe to ignore */ }
    }
    activeControllers.clear();
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
