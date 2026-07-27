/**
 * core/calibration-lab/pixel-truth-capture.js
 *
 * EPIC 2E-K-R2-FIX1 -- Section 1: Real Controlled V2 pixel rendering.
 * EPIC 2E-K-R2-FIX2 -- Sections 2, 3, 5: wired to the Calibration-only
 * V2 Preview Plan (so V2 genuinely renders instead of staying blank/
 * unknown), a real Pure-JS SHA-256 fallback for opaque-origin contexts
 * with no Web Crypto, and a `browserVerified` computed honestly from
 * measured evidence rather than from the mere existence of
 * `document`/`OffscreenCanvas`.
 *
 * BROWSER-ONLY (Canvas + Web Crypto/Pure-JS SHA-256) orchestration that
 * captures REAL pixel-truth evidence for one already-decoded image, by
 * calling the SAME production `createVisualPreviewComparisonControllerV2()`/
 * `renderIsolatedVisualPreviewV2()` chain the main app's own Visual
 * Preview Comparison and the R2 Calibration Lab slider already use --
 * this module never reimplements rendering, it only MEASURES the two
 * canvases that reused chain actually painted (or honestly left
 * untouched).
 *
 * Runs against two TEMPORARY, never-DOM-attached canvases owned
 * entirely by this call -- never the visible slider's own canvases,
 * so evidence capture at `addImage()` time (Section 1/2) never
 * depends on whether the user is currently looking at that image.
 * Both canvases and the comparison controller instance are disposed
 * before this function returns; nothing here is retained.
 *
 * Returns a "measured" object in exactly the shape
 * `core/calibration-lab/preview-evidence.js`'s `classifyPreviewTruth()`/
 * `buildPreviewEvidence()` expect -- this module never classifies
 * anything itself, it only measures and hands off.
 */

import { createVisualPreviewComparisonControllerV2 } from '../../ui/visual-preview-comparison-controller-v2.js';
import { computeImageFingerprint } from './run-comparison-pipeline.js';
import {
  buildPreviewEvidence, isPlausibleSha256Hex, isPixelHashConsistentWithCount,
  isSideStructurallyRenderedAndVerified, DEFAULT_BLANK_CANVAS_WIDTH, DEFAULT_BLANK_CANVAS_HEIGHT,
} from './preview-evidence.js';
import { sha256PureJsHex } from './sha256-pure-js.js';

const HEX_CHARS = '0123456789abcdef';

function _bytesToHex(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    out += HEX_CHARS[(b >> 4) & 0xf] + HEX_CHARS[b & 0xf];
  }
  return out;
}

/**
 * SHA-256 hex digest of an arbitrary byte buffer (EPIC 2E-K-R2-FIX2 --
 * Section 3). Tries Web Crypto (`crypto.subtle`) FIRST when it is
 * genuinely available (a Secure Context); when it is not -- e.g. an
 * `about:blank` in-memory Browser QA harness, which is not a Secure
 * Context and so has no Web Crypto API at all -- falls back to the
 * real, from-scratch `sha256PureJsHex()` implementation
 * (`core/calibration-lab/sha256-pure-js.js`, proven correct against
 * official NIST/FIPS 180-4 vectors and against Node's own `crypto`
 * module). NEVER a fake hash, NEVER a simplified checksum -- both
 * paths produce a real, standards-conformant SHA-256 digest.
 *
 * Returns `{ hex, mode }` where `mode` is one of
 * `'WEB_CRYPTO_SHA256' | 'PURE_JS_SHA256' | 'HASH_UNAVAILABLE'` --
 * `hex` is `null` only in the (should-be-unreachable) case that even
 * the Pure JS fallback throws.
 */
export async function sha256HexWithMode(bytes) {
  const subtle = (typeof crypto !== 'undefined' && crypto.subtle) ? crypto.subtle : null;
  if (subtle) {
    try {
      const buffer = bytes instanceof Uint8Array ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) : bytes;
      const digest = await subtle.digest('SHA-256', buffer);
      return { hex: _bytesToHex(new Uint8Array(digest)), mode: 'WEB_CRYPTO_SHA256' };
    } catch {
      // Fall through to the Pure JS path below -- a Web Crypto call
      // failure is never treated as "no hash exists at all".
    }
  }
  try {
    const hex = sha256PureJsHex(bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes ?? []));
    return { hex, mode: 'PURE_JS_SHA256' };
  } catch {
    return { hex: null, mode: 'HASH_UNAVAILABLE' };
  }
}

/** Backward-compatible hex-only accessor (used by anything that only needs the digest, never the mode). Returns `null` (never throws) if neither mechanism could produce a hash. */
export async function sha256Hex(bytes) {
  const { hex } = await sha256HexWithMode(bytes);
  return hex;
}

/** The hash of a fully-transparent (all-zero) RGBA buffer of the given size -- computed on demand rather than hardcoded, so it is correct for ANY captured canvas size, not just the 300x150 default. Used as the `*BlankReferenceHash` corroboration input to `isPixelHashConsistentWithCount`. */
export async function computeBlankReferenceHash(width, height) {
  const w = Number(width), h = Number(height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  const zeroBuffer = new Uint8Array(w * h * 4);
  return sha256Hex(zeroBuffer);
}

function _countNonTransparent(rgba) {
  let count = 0;
  for (let i = 3; i < rgba.length; i += 4) {
    if (rgba[i] !== 0) count += 1;
  }
  return count;
}

/** Reads back a canvas's ACTUAL committed pixels (never trusting the caller's own claimed width/height) -- returns null measurements (never throws) if the canvas has no context or a tainted/cross-origin read fails, which classifyPreviewTruth() will correctly treat as "not proven". Records WHICH hashing mechanism actually produced the pixel hash (Section 3). */
async function _measureCanvas(canvas) {
  const width = Number(canvas?.width) || 0;
  const height = Number(canvas?.height) || 0;
  if (!canvas || typeof canvas.getContext !== 'function' || width <= 0 || height <= 0) {
    return { width, height, nonTransparentPixelCount: 0, pixelHash: null, blankReferenceHash: null, hashMode: 'HASH_UNAVAILABLE' };
  }
  try {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const { data } = ctx.getImageData(0, 0, width, height);
    const nonTransparentPixelCount = _countNonTransparent(data);
    const [{ hex: pixelHash, mode: hashMode }, blankReferenceHash] = await Promise.all([
      sha256HexWithMode(data),
      computeBlankReferenceHash(width, height),
    ]);
    return { width, height, nonTransparentPixelCount, pixelHash, blankReferenceHash, hashMode };
  } catch {
    // Tainted/cross-origin canvas or an unavailable 2D context -- an
    // unreadable canvas is never treated as proof of anything.
    return { width, height, nonTransparentPixelCount: 0, pixelHash: null, blankReferenceHash: null, hashMode: 'HASH_UNAVAILABLE' };
  }
}

function _createTempCanvas() {
  if (typeof OffscreenCanvas !== 'undefined') {
    try { return new OffscreenCanvas(DEFAULT_BLANK_CANVAS_WIDTH, DEFAULT_BLANK_CANVAS_HEIGHT); } catch { /* fall through */ }
  }
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    return document.createElement('canvas');
  }
  return null;
}

/** Combines two sides' hash-verification modes into ONE reported `pixelHashVerificationMode` (Section 3): worst-case-first -- if either side could produce no hash at all, the whole capture honestly reports HASH_UNAVAILABLE; else if either side needed the Pure JS fallback, report that (still a REAL verified hash, just a different mechanism); only both-WEB_CRYPTO reports WEB_CRYPTO_SHA256. */
function _combineHashMode(a, b) {
  if (a === 'HASH_UNAVAILABLE' || b === 'HASH_UNAVAILABLE') return 'HASH_UNAVAILABLE';
  if (a === 'PURE_JS_SHA256' || b === 'PURE_JS_SHA256') return 'PURE_JS_SHA256';
  return 'WEB_CRYPTO_SHA256';
}

/**
 * Captures REAL pixel-truth evidence for one image (Section 1/2/3/5).
 *
 * @param {object} input
 * @param {HTMLImageElement} input.imgElement - the already-decoded source image (same element used at analysis time).
 * @param {object|null} input.renderPlan - the transient `visualPreviewRenderPlanV2`-shaped object (from the Calibration-only V2 Preview Plan, `renderPlanForPixelPreviewTransientOnly` -- EPIC 2E-K-R2-FIX2 Section 1/2).
 * @param {object|null} input.calibrationV2PreviewPlan - the Calibration V2 Preview Plan's own contract summary (`calibrationV2PreviewPlanTransientOnly` -- mode/available/renderable), used to populate the new Section 5 evidence fields honestly (never inferred).
 * @param {string|null} input.analysisGenerationId - this record's own generation id (echoed back as `renderGenerationId`).
 * @param {string|null} input.expectedImageFingerprint - the fingerprint already stored on the record; used to verify the source has not been swapped between analysis and capture.
 * @returns {Promise<object>} a `previewEvidence` object (see preview-evidence.js's `buildPreviewEvidence()`), ready to attach to a Semantic Image Test Record. Never throws.
 */
export async function capturePixelTruthEvidence({ imgElement, renderPlan, calibrationV2PreviewPlan = null, analysisGenerationId = null, expectedImageFingerprint = null } = {}) {
  const verifiedAt = new Date().toISOString();
  const sourceAvailable = !!(imgElement && typeof imgElement === 'object' &&
    (imgElement.complete !== false) && Number(imgElement.naturalWidth) > 0 && Number(imgElement.naturalHeight) > 0);

  const calibrationV2PlanAvailable = typeof calibrationV2PreviewPlan?.available === 'boolean' ? calibrationV2PreviewPlan.available : null;
  const calibrationV2PlanRenderable = typeof calibrationV2PreviewPlan?.renderable === 'boolean' ? calibrationV2PreviewPlan.renderable : null;
  const calibrationV2PlanMode = typeof calibrationV2PreviewPlan?.mode === 'string' ? calibrationV2PreviewPlan.mode : null;

  if (!sourceAvailable) {
    return buildPreviewEvidence({
      sourceAvailable: false, calibrationV2PlanAvailable, calibrationV2PlanRenderable, calibrationV2PlanMode,
    }, { renderGenerationId: analysisGenerationId, verifiedAt });
  }

  // Re-derive the fingerprint from the EXACT source element being
  // handed to both renders, right now -- never assumed to still match
  // just because it matched at analysis time (defends against the
  // hostile "source swapped between analysis and capture" scenario).
  let sourceFingerprintMatch = true;
  if (typeof expectedImageFingerprint === 'string' && expectedImageFingerprint.length > 0) {
    let liveFingerprint = null;
    try { liveFingerprint = computeImageFingerprint(imgElement); } catch { liveFingerprint = null; }
    sourceFingerprintMatch = liveFingerprint === expectedImageFingerprint;
  }

  const legacyCanvas = _createTempCanvas();
  const v2Canvas = _createTempCanvas();
  if (!legacyCanvas || !v2Canvas) {
    return buildPreviewEvidence({
      sourceAvailable: true, sourceFingerprintMatch,
      legacyPreviewState: 'unavailable', controlledV2PreviewState: 'unavailable',
      calibrationV2PlanAvailable, calibrationV2PlanRenderable, calibrationV2PlanMode,
    }, { renderGenerationId: analysisGenerationId, verifiedAt });
  }

  const ctrl = createVisualPreviewComparisonControllerV2({ legacyCanvas, v2Canvas });
  let result = null;
  try {
    result = await ctrl.render({ source: imgElement, renderPlan, analysisGenerationId });
  } catch {
    result = null;
  }

  const staleGeneration = !!(result && analysisGenerationId != null && result.analysisGenerationId !== analysisGenerationId);

  const legacyMeasured = await _measureCanvas(legacyCanvas);
  const v2Measured = await _measureCanvas(v2Canvas);

  try { ctrl.dispose(); } catch { /* best-effort cleanup only */ }

  const legacyState = result?.legacy?.state ?? 'unknown';
  const v2State = result?.v2?.state ?? 'unknown';

  const sameSourceGeometry = legacyMeasured.width > 0 && legacyMeasured.height > 0 &&
    legacyMeasured.width === v2Measured.width && legacyMeasured.height === v2Measured.height;

  const pixelDifferenceDetected = (legacyState === 'rendered' && v2State === 'rendered' &&
    legacyMeasured.pixelHash && v2Measured.pixelHash)
    ? legacyMeasured.pixelHash !== v2Measured.pixelHash
    : null;

  const measured = {
    sourceAvailable: true,
    staleGeneration,
    sourceFingerprintMatch,
    sameSourceGeometry,
    sourceWidth: Number(imgElement.naturalWidth) || null,
    sourceHeight: Number(imgElement.naturalHeight) || null,
    legacyPreviewState: legacyState,
    legacyOutputWidth: legacyMeasured.width,
    legacyOutputHeight: legacyMeasured.height,
    legacyNonTransparentPixelCount: legacyMeasured.nonTransparentPixelCount,
    legacyPixelHash: legacyMeasured.pixelHash,
    legacyBlankReferenceHash: legacyMeasured.blankReferenceHash,
    legacyTransformed: result?.legacy?.metadata?.visualAdjustmentsApplied === true,
    controlledV2PreviewState: v2State,
    controlledV2OutputWidth: v2Measured.width,
    controlledV2OutputHeight: v2Measured.height,
    controlledV2NonTransparentPixelCount: v2Measured.nonTransparentPixelCount,
    controlledV2PixelHash: v2Measured.pixelHash,
    controlledV2BlankReferenceHash: v2Measured.blankReferenceHash,
    controlledV2Transformed: result?.v2?.metadata?.visualAdjustmentsApplied === true,
    pixelDifferenceDetected,
    // EPIC 2E-K-R2-FIX2 -- Section 1/5: the Calibration V2 Preview Plan's
    // own real availability/renderability -- NEVER inferred from
    // `renderPlan`'s mere existence.
    calibrationV2PlanAvailable, calibrationV2PlanRenderable, calibrationV2PlanMode,
    // EPIC 2E-K-R2-FIX2 -- Section 3: which mechanism verified each
    // side's pixel hash, combined into the one reported mode.
    pixelHashVerificationMode: _combineHashMode(legacyMeasured.hashMode, v2Measured.hashMode),
  };

  // EPIC 2E-K-R2-FIX2 -- Section 3: `browserVerified` computed HONESTLY
  // from real, just-measured evidence -- NEVER from the mere existence
  // of `document`/`OffscreenCanvas` (the exact reported defect: a bare
  // 300x150 blank V2 canvas with a null hash previously still reported
  // `browserVerified: true`). True only when BOTH sides structurally
  // rendered real pixels AND both hashes are present+consistent AND
  // source/generation/geometry all check out.
  measured.browserVerified =
    isSideStructurallyRenderedAndVerified(measured, 'legacy') &&
    isSideStructurallyRenderedAndVerified(measured, 'controlledV2') &&
    sourceFingerprintMatch === true &&
    sameSourceGeometry === true &&
    staleGeneration !== true;

  return buildPreviewEvidence(measured, { renderGenerationId: analysisGenerationId, verifiedAt });
}
