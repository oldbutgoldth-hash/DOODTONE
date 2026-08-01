/**
 * core/image-analysis-core/worker.js
 *
 * EPIC 2E-P0.7 R6 — Web Worker that runs Image Analysis Core's heavy
 * per-pixel passes off the main UI thread.
 *
 * Contract:
 *   - Receives ONLY plain numbers and transferable ArrayBuffers
 *     (Uint8ClampedArray.buffer). Never receives an HTMLImageElement,
 *     a canvas, or any other DOM object — those cannot cross into a
 *     Worker anyway, and the R6 spec explicitly calls this out.
 *   - Every posted job carries a `jobId` so a superseded/aborted job's
 *     late response can be safely ignored by the caller.
 *   - Always posts back exactly one message per job: either
 *     { jobId, ok:true, result } or { jobId, ok:false, error }.
 *     Never leaves a job silently unanswered.
 */
import { runFromBuffers } from './pixel-math.js';

self.onmessage = (event) => {
  const { jobId, data, w, h, data2, w2, h2 } = event.data || {};
  try {
    const buffers = {
      data: new Uint8ClampedArray(data),
      w, h,
      data2: new Uint8ClampedArray(data2),
      w2, h2,
    };
    const result = runFromBuffers(buffers);
    self.postMessage({ jobId, ok: true, result });
  } catch (error) {
    self.postMessage({ jobId, ok: false, error: { message: error?.message || String(error), stack: error?.stack || null } });
  }
};
