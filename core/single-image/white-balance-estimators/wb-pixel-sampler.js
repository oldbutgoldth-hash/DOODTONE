/**
 * core/single-image/white-balance-estimators/wb-pixel-sampler.js
 *
 * EPIC 2E-P1I — deterministic pixel sampling for the WB estimator
 * family. Split into a DOM-free pure function (`sampleFromBuffer`,
 * unit-testable in Node against synthetic fixtures with zero browser
 * dependency) and a thin browser-only wrapper (`sampleFromImage`) that
 * performs the actual canvas draw — mirroring the exact split
 * core/image-analysis-core/pixel-math.js already established for the
 * same reason ("pure, DOM-free pixel math... so the exact same
 * algorithm can run either on the main thread or inside a Worker").
 *
 * No existing engine retains a shared pixel buffer (see
 * P1I_PIXEL_EVIDENCE_PIPELINE_AUDIT.md §1) — this sampler performs its
 * own independent draw, exactly as whitebalance-engine/_sample() and
 * color-cast-detector/_detect() already do independently of each
 * other and of image-analysis-core.
 */

import {
  isAlphaRejected, hasInvalidChannel, isNearBlack, isFullyClipped,
  saturationOf, luminance,
} from './wb-color-math.js';

// ─── Documented sampling budget ────────────────────────────────────────────
// MAX_ANALYSIS_DIM sits between whitebalance-engine's 320px pass and
// image-analysis-core's 480px pass — comparable cost to the existing
// WB engine's own draw, not a new heavier pass. STRIDE=2 (finer than
// whitebalance-engine's STRIDE=3) is affordable specifically because
// MAX_SAMPLES below hard-caps total accepted-pixel work regardless of
// source resolution — see P1I_PERFORMANCE_AND_SAMPLING_POLICY.md.
export const MAX_ANALYSIS_DIM = 360;
export const PIXEL_STRIDE = 2;
export const MAX_SAMPLES = 20000; // hard ceiling on ACCEPTED samples returned; scanning still proceeds deterministically to derive rejection counts up to MAX_SCAN

// Scanning (not just acceptance) is also bounded so a pathological
// synthetic fixture (or a future very-large MAX_ANALYSIS_DIM) can
// never make the sampler itself unbounded.
export const MAX_SCAN = 400000;

/**
 * @typedef {Object} SampledPixel
 * @property {number} r
 * @property {number} g
 * @property {number} b
 * @property {number} x
 * @property {number} y
 * @property {number} lum          luminance() of this pixel, 0-255
 * @property {number} sat          HSL saturation, 0-1
 */

/**
 * @typedef {Object} SampleResult
 * @property {SampledPixel[]} accepted
 * @property {{alpha:number, nearBlack:number, fullyClipped:number, invalid:number}} rejectedCounts
 * @property {number} totalScanned
 * @property {number} width
 * @property {number} height
 * @property {boolean} maxSamplesHit
 * @property {boolean} maxScanHit
 */

/**
 * Pure, deterministic pixel sampler. Given the SAME `{data,width,height}`
 * buffer, always returns the IDENTICAL accepted-pixel list and
 * rejection counts — no randomness, no Date.now(), no external state.
 *
 * @param {{data: Uint8ClampedArray|number[], width:number, height:number}} buffer
 * @param {{stride?:number}} [opts]
 * @returns {SampleResult}
 */
export function sampleFromBuffer(buffer, opts = {}) {
  const data = buffer?.data;
  const width = Math.max(0, Math.trunc(buffer?.width ?? 0));
  const height = Math.max(0, Math.trunc(buffer?.height ?? 0));
  const stride = Math.max(1, Math.trunc(opts.stride ?? PIXEL_STRIDE));

  const accepted = [];
  const rejectedCounts = { alpha: 0, nearBlack: 0, fullyClipped: 0, invalid: 0 };
  let totalScanned = 0;
  let maxSamplesHit = false;
  let maxScanHit = false;

  if (!data || !width || !height) {
    return { accepted, rejectedCounts, totalScanned, width, height, maxSamplesHit, maxScanHit };
  }

  outer:
  for (let y = 0; y < height; y += stride) {
    for (let x = 0; x < width; x += stride) {
      if (totalScanned >= MAX_SCAN) { maxScanHit = true; break outer; }
      totalScanned++;

      const o = (y * width + x) * 4;
      const r = data[o], g = data[o + 1], b = data[o + 2], a = data[o + 3];

      if (hasInvalidChannel(r, g, b)) { rejectedCounts.invalid++; continue; }
      if (isAlphaRejected(a)) { rejectedCounts.alpha++; continue; }
      if (isFullyClipped(r, g, b)) { rejectedCounts.fullyClipped++; continue; }
      if (isNearBlack(r, g, b)) { rejectedCounts.nearBlack++; continue; }

      if (accepted.length >= MAX_SAMPLES) { maxSamplesHit = true; continue; }

      accepted.push({ r, g, b, x, y, lum: luminance(r, g, b), sat: saturationOf(r, g, b) });
    }
  }

  return { accepted, rejectedCounts, totalScanned, width, height, maxSamplesHit, maxScanHit };
}

/**
 * Browser-only: draws `img` to an internal canvas at MAX_ANALYSIS_DIM
 * and samples it via sampleFromBuffer(). Not usable outside a DOM
 * environment — tests exercise sampleFromBuffer() directly with
 * synthetic fixtures instead (see P1I_PIXEL_EVIDENCE_PIPELINE_AUDIT.md
 * §14 on why this split makes deterministic Node testing possible).
 *
 * @param {HTMLImageElement} img
 * @returns {SampleResult & {scale:number}}
 */
export function sampleFromImage(img) {
  if (typeof document === 'undefined') {
    throw Object.assign(new Error('sampleFromImage() requires a DOM (document.createElement) — use sampleFromBuffer() in non-browser contexts'), { code: 'DOM_UNAVAILABLE' });
  }
  if (!img?.naturalWidth) throw new Error('Image not ready for pixel sampling');

  const scale = Math.min(1, MAX_ANALYSIS_DIM / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;

  const result = sampleFromBuffer({ data, width: w, height: h });
  return { ...result, scale };
}
