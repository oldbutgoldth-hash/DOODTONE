/**
 * core/image-analysis-core/index.js
 *
 * Image Analysis Core
 *
 * Single-pass deep technical analysis covering 15 distinct measurements:
 *
 *   1.  RGB Histogram         — per-channel 256-bucket distributions
 *   2.  Luminance (LAB L*)    — perceptual lightness, CIE L*a*b* L channel
 *   3.  Dynamic Range         — EV stops between black/white points
 *   4.  Highlight Clipping    — % pixels blown out
 *   5.  Shadow Clipping       — % pixels crushed to black
 *   6.  White Balance         — warm/cool/neutral cast estimate
 *   7.  Saturation Distrib.   — histogram of HSL saturation values
 *   8.  Dominant Hue          — most frequent hue bucket
 *   9.  Scene Classification  — Portrait/Landscape/Wedding/Travel/General
 *   10. Face / Skin Detection — YCbCr-based skin pixel ratio
 *   11. Skin Tone Analysis    — avg HSL of detected skin pixels
 *   12. Sharpness Score       — Laplacian variance (focus measure)
 *   13. Blur Detection        — derived from sharpness + edge density
 *   14. Noise Estimation      — high-frequency luminance variance in flat areas
 *   15. JPEG Artifact Detect. — 8×8 block-boundary discontinuity score
 *
 * Designed as a single-pass pipeline: pixel data is read from canvas once,
 * then multiple analysis passes run over the same buffer for efficiency.
 */

import { runFromBuffers } from './pixel-math.js';

// ─── Config ───────────────────────────────────────────────────────────────────

const MAX_DIM       = 480;   // downsample long edge for the main pass
const SHARPNESS_DIM = 600;   // slightly larger for edge/noise/artifact detection

/* EPIC 2E-P0.7 R6 — Worker offload config. The heavy per-pixel passes
 * (_mainPass/_qualityPass, now in pixel-math.js) used to run entirely
 * synchronously on the main thread inside a single setTimeout callback
 * (see WORKER_TIMEOUT_MS below for why that's dangerous). When a real
 * Worker is available we now run them there instead, so they can never
 * block Preview rendering, slider input, or any other UI work — and a
 * Worker that genuinely hangs can be terminate()'d, unlike a runaway
 * synchronous function on the main thread which nothing can interrupt. */
const WORKER_TIMEOUT_MS = 20000;
let _sharedWorker = null;
let _workerFailed = false; // sticky: once a Worker proves unusable in this session, stop retrying it per-call
let _jobSeq = 0;

function _getWorker() {
  if (_workerFailed) return null;
  if (_sharedWorker) return _sharedWorker;
  if (typeof Worker === 'undefined') { _workerFailed = true; return null; }
  try {
    _sharedWorker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    return _sharedWorker;
  } catch (error) {
    console.warn('[LUMIXA][ImageAnalysisCore] Worker unavailable, falling back to synchronous main-thread analysis.', error?.message || error);
    _workerFailed = true;
    _sharedWorker = null;
    return null;
  }
}

/**
 * Runs the heavy pixel-math pass in a Worker, with its own timeout that
 * terminate()s the worker (not just abandons the Promise) so a hung job
 * can never leak — and never leaves the returned Promise unresolved.
 */
function _runInWorker(buffers) {
  return new Promise((resolve, reject) => {
    const worker = _getWorker();
    if (!worker) { reject(Object.assign(new Error('Worker unavailable'), { code: 'WORKER_UNAVAILABLE' })); return; }

    const jobId = ++_jobSeq;
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      // A job that genuinely can't be preempted (unlike synchronous
      // main-thread code) CAN be terminated here — this is the concrete
      // fix for "Promise.race with setTimeout is not sufficient for
      // synchronous CPU-heavy work": termination actually stops the work.
      try { worker.terminate(); } catch { /* already gone */ }
      _sharedWorker = null; // next call spins up a fresh worker
      reject(Object.assign(new Error(`Image Analysis Core Worker exceeded ${WORKER_TIMEOUT_MS / 1000}s and was terminated`), { code: 'WORKER_TIMEOUT' }));
    }, WORKER_TIMEOUT_MS);

    const onMessage = (event) => {
      if (event.data?.jobId !== jobId || settled) return;
      settled = true;
      clearTimeout(timer);
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
      if (event.data.ok) resolve(event.data.result);
      else reject(Object.assign(new Error(event.data.error?.message || 'Worker analysis failed'), { code: 'WORKER_ANALYSIS_FAILED' }));
    };
    const onError = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
      _sharedWorker = null;
      reject(Object.assign(new Error(error?.message || 'Worker crashed'), { code: 'WORKER_CRASHED' }));
    };
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);

    // Transfer the underlying ArrayBuffers — zero-copy, and the whole
    // point of never sending an HTMLImageElement/canvas to a Worker.
    worker.postMessage(
      { jobId, data: buffers.data.buffer, w: buffers.w, h: buffers.h, data2: buffers.data2.buffer, w2: buffers.w2, h2: buffers.h2 },
      [buffers.data.buffer, buffers.data2.buffer]
    );
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * @typedef {Object} ImageAnalysisResult
 * // RGB Histogram
 * @property {Uint32Array} histL
 * @property {Uint32Array} histR
 * @property {Uint32Array} histG
 * @property {Uint32Array} histB
 * // Luminance / LAB
 * @property {number} avgLum          mean luminance (ITU-R BT.709, 0-255)
 * @property {number} avgLabL         mean CIE L* (0-100)
 * @property {number} median
 * @property {number} blackPoint
 * @property {number} whitePoint
 * @property {number} contrast        std-dev of luminance
 * // Dynamic Range
 * @property {number} dynamicRange    levels (whitePoint - blackPoint)
 * @property {number} drStops         EV stops
 * @property {number} contrastRatio   Weber ratio (p95/p5)
 * // Clipping
 * @property {number} clipHiPct
 * @property {number} clipLoPct
 * @property {number} clipHiCount
 * @property {number} clipLoCount
 * // White Balance
 * @property {number} rbDiff
 * @property {number} gDiff
 * @property {string} whiteBalanceCast  'warm'|'cool'|'green'|'magenta'|'neutral'
 * @property {number} avgR
 * @property {number} avgG
 * @property {number} avgB
 * // Saturation
 * @property {number}   avgSatPct
 * @property {number[]} satHistogram     20-bucket saturation distribution (%)
 * // Hue
 * @property {number} dominantHue        degrees
 * @property {string} dominantHueName
 * // Scene
 * @property {string} category
 * // Skin
 * @property {boolean} skinDetected
 * @property {number}  skinPct
 * @property {object}  skinTone          { h, s, l } avg HSL of skin pixels
 * // Sharpness / Blur / Noise / Artifacts
 * @property {number}  sharpnessScore    0-100
 * @property {string}  sharpnessLabel    'Sharp'|'Acceptable'|'Soft'|'Blurry'
 * @property {boolean} blurDetected
 * @property {number}  blurConfidence    0-1
 * @property {number}  noiseScore        0-100 (higher = noisier)
 * @property {string}  noiseLabel        'Clean'|'Light'|'Moderate'|'Heavy'
 * @property {number}  jpegArtifactScore 0-100 (higher = more visible blocking)
 * @property {string}  jpegArtifactLabel 'None'|'Mild'|'Moderate'|'Severe'
 *
 * @property {number} total
 * @property {string} summary
 */

/**
 * Run the full Image Analysis Core pipeline.
 *
 * EPIC 2E-P0.7 R6 — this used to run its entire two-pass pixel analysis
 * synchronously, inline, inside a single setTimeout callback: one
 * unbroken block the main thread could not be interrupted from, and
 * which a Promise.race+setTimeout timeout could not actually preempt
 * either (the timeout's own callback is JS too, and JS is
 * single-threaded — it cannot fire while _run() is still mid-loop).
 * That was the real mechanism behind "stuck at Image Analysis Core":
 * not necessarily an infinite loop, just a long enough synchronous
 * block, on a real multi-megapixel photo, that nothing else — not the
 * UI, not even the safety timeout — could run until it finished.
 *
 * Now: the same pixel math (byte-for-byte identical, see
 * pixel-math.js) runs in a Web Worker whenever one is available, so it
 * can never block the main thread, and a hung Worker job can be
 * genuinely terminate()'d — something no amount of Promise racing can
 * do to synchronous main-thread code. If Workers are unavailable
 * (older environment, disabled, or the Worker script fails to load),
 * this falls back to the exact original synchronous behaviour so
 * nothing regresses.
 *
 * @param {HTMLImageElement} img
 * @param {{ useWorker?: boolean }} [options]
 * @returns {Promise<ImageAnalysisResult & { _meta: object }>}
 */
export function analyzeImageCore(img, { useWorker = true } = {}) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      _run(img, { useWorker }).then(resolve, reject);
    }, 50);
  });
}

// ─── Orchestration ────────────────────────────────────────────────────────────

async function _run(img, { useWorker = true } = {}) {
  if (!img.naturalWidth || !img.naturalHeight)
    throw new Error('Image not ready for analysis — naturalWidth is 0');

  const startedAt = (typeof performance !== 'undefined' ? performance.now() : Date.now());

  // Canvas draw is DOM-only and must stay on the main thread either way.
  const { data, w, h } = _drawToBuffer(img, MAX_DIM);
  const { data: data2, w: w2, h: h2 } = _drawToBuffer(img, SHARPNESS_DIM);

  let result;
  let workerUsed = false;
  let workerError = null;
  if (useWorker) {
    try {
      // Buffers are Transferred (zero-copy) into the Worker, not
      // copied and not shared — the main-thread typed arrays are
      // detached after this call, which is why fresh buffers are
      // drawn above rather than reused afterward.
      result = await _runInWorker({ data, w, h, data2, w2, h2 });
      workerUsed = true;
    } catch (error) {
      workerError = error?.message || String(error);
      console.warn('[LUMIXA][ImageAnalysisCore] Worker path failed, falling back to synchronous main-thread analysis.', workerError);
    }
  }
  if (!result) {
    // Fallback path — same pure function pixel-math.js exports, just
    // called in-process. Re-draw fresh buffers since the worker
    // attempt (if any) may have transferred/detached the originals.
    const fallbackBuffers = useWorker && workerUsed === false && workerError !== null
      ? { data: _drawToBuffer(img, MAX_DIM).data, w, h, data2: _drawToBuffer(img, SHARPNESS_DIM).data, w2, h2 }
      : { data, w, h, data2, w2, h2 };
    result = runFromBuffers(fallbackBuffers);
  }

  const durationMs = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt);
  result._meta = {
    workerUsed,
    workerError,
    durationMs,
    mainDims: { w, h },
    qualityDims: { w2, h2 },
    inputDims: { naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight },
  };
  return result;
}

// ─── Canvas helpers ───────────────────────────────────────────────────────────

function _drawToBuffer(img, maxDim) {
  const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth  * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  return { data, w, h };
}

