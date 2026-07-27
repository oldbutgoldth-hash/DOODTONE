/**
 * core/calibration-lab/preview-evidence.js
 *
 * EPIC 2E-K-R2-FIX1 -- PIXEL TRUTH, DECISION GATE AND EVIDENCE CLOSURE
 *
 * Pure logic (no DOM, no Canvas, no IndexedDB -- safe to unit-test in
 * Node) for turning REAL, ALREADY-MEASURED pixel evidence into the
 * single canonical `previewTruthCode` (Section 2), the derived
 * `visualDecisionEligible` boolean, and the Decision Eligibility Gate
 * (Section 3). The actual pixel CAPTURE (drawing to a canvas, calling
 * `getContext('2d').getImageData()`) is inherently browser-only and
 * lives in `core/calibration-lab/pixel-truth-capture.js` -- this
 * module only classifies numbers it is handed, never measures them
 * itself, so every hostile scenario in Section 11 (fake hash, blank
 * canvas hash, stale generation, mismatched geometry/fingerprint, ...)
 * can be exercised with a synthetic "measured" object and no browser
 * at all.
 *
 * CORE BUG THIS MODULE EXISTS TO FIX (Section 1/6): the R2 Browser
 * test's own success condition was
 *   `v2State !== 'rendered' || v2BackingSize > 0`
 * which is TRUE (a false PASS) whenever v2State is anything other than
 * the literal string 'rendered' -- including 'unknown', 'blocked',
 * 'failed', 'cancelled', or simply absent. `classifyPreviewTruth()`
 * below never uses that OR-shortcut shape: every side's "did this
 * genuinely render real pixels" check is a positive, independently
 * verified AND-chain (state === 'rendered' AND width>0 AND height>0
 * AND nonTransparentPixelCount>0 AND it is not the untouched default
 * 300x150 canvas) -- there is no code path by which an unproven state
 * can be mistaken for a proven one.
 */

import { PREVIEW_TRUTH_CODE_SET, PIXEL_BLOCKER_REASON_CODE_SET, isValidPixelHashVerificationMode } from './codes.js';

// A freshly created, never-rendered-to <canvas> defaults to exactly
// this backing size per the HTML spec -- this is the literal shape of
// the bug report's "Controlled V2 Canvas is still a blank default-size
// canvas (300x150)". Detecting this exact combination (default size +
// zero non-transparent pixels) is what lets classifyPreviewTruth()
// distinguish "a canvas element merely exists" from "a canvas element
// actually received real Controlled V2 pixel output".
export const DEFAULT_BLANK_CANVAS_WIDTH = 300;
export const DEFAULT_BLANK_CANVAS_HEIGHT = 150;

const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

/** A syntactically valid, lowercase 64-hex-char SHA-256 digest string. Does not (and cannot, on its own) prove the hash was honestly derived from real pixels -- see `isPixelHashConsistentWithCount` for that second, independent check. */
export function isPlausibleSha256Hex(hash) {
  return typeof hash === 'string' && SHA256_HEX_RE.test(hash);
}

/**
 * A pixel hash is inconsistent (and must be rejected as evidence) when
 * it claims to represent an all-transparent/empty buffer
 * (`nonTransparentPixelCount === 0`) while simultaneously the caller
 * asserts pixels were found, or vice versa -- this catches a forged or
 * copy-pasted hash from a DIFFERENT capture than the one the count was
 * computed from (Section 11: "Pixel Hash ปลอมต้อง FAIL", "Hash ของ
 * Blank Canvas ต้อง FAIL"). `knownBlankHashForThisSize`, when supplied,
 * is the hash of an actually-blank buffer of the same width/height
 * (computed by pixel-truth-capture.js at measurement time) -- if the
 * measured hash equals it, the canvas is genuinely blank regardless of
 * what nonTransparentPixelCount claims.
 */
export function isPixelHashConsistentWithCount(hash, nonTransparentPixelCount, knownBlankHashForThisSize = null) {
  if (!isPlausibleSha256Hex(hash)) return false;
  if (typeof knownBlankHashForThisSize === 'string' && isPlausibleSha256Hex(knownBlankHashForThisSize) && hash === knownBlankHashForThisSize) {
    return nonTransparentPixelCount === 0;
  }
  if (nonTransparentPixelCount === 0) return false; // a "blank" claim with no corroborating reference hash is never trusted as real evidence
  return true;
}

/** Pure, Node-testable non-transparent pixel counter over an already-captured RGBA buffer (a real `Uint8ClampedArray`/plain array works identically). Counts any pixel whose alpha channel is not exactly 0. */
export function countNonTransparentPixels(rgbaData) {
  if (!rgbaData || typeof rgbaData.length !== 'number') return 0;
  let count = 0;
  for (let i = 3; i < rgbaData.length; i += 4) {
    if (rgbaData[i] !== 0) count += 1;
  }
  return count;
}

function _looksLikeUntouchedDefaultCanvas(width, height, nonTransparentPixelCount) {
  return width === DEFAULT_BLANK_CANVAS_WIDTH && height === DEFAULT_BLANK_CANVAS_HEIGHT && nonTransparentPixelCount === 0;
}

/**
 * A side's STRUCTURAL render status (EPIC 2E-K-R2-FIX2 -- Section 4):
 * 'FAILED'         -- state/geometry/pixel-count proves this side did NOT
 *                     genuinely render (or its hash is present but
 *                     INVALID/INCONSISTENT -- e.g. forged, or matches a
 *                     known-blank reference while claiming real pixels --
 *                     which is treated exactly as a render failure, never
 *                     merely "unverified").
 * 'UNVERIFIED_HASH' -- state/geometry/pixel-count all PROVE a genuine
 *                     render, but no pixel hash could be produced at all
 *                     (hash is exactly null/undefined) -- e.g. an
 *                     `about:blank` in-memory Browser QA harness with no
 *                     Web Crypto AND (defensively) no usable Pure JS
 *                     fallback either. This is HONESTLY distinct from a
 *                     render failure -- see PIXEL_HASH_UNAVAILABLE below.
 * 'OK'              -- genuinely rendered AND cryptographically verified.
 *
 * CORE BUG THIS FIXES (Section 4/6): previously, ANY missing/null hash
 * (including the common case of Web Crypto being unavailable in an
 * opaque-origin context) caused `_sideGenuinelyRendered()` to return
 * `false`, so a Legacy side that had genuinely rendered 480,000 real
 * pixels was misclassified `LEGACY_RENDER_FAILED` purely because of an
 * unrelated hashing-infrastructure gap. Splitting the hash check into
 * "did we get ANY hash" (this function) vs. "was the render otherwise
 * proven" (state+geometry+count, checked FIRST and independently) fixes
 * this without ever weakening the fake-hash/blank-hash hostile-test
 * guarantees (those still hit 'FAILED', never 'UNVERIFIED_HASH').
 */
function _sideStructuralStatus(m, prefix) {
  const state = m[`${prefix}PreviewState`];
  const width = Number(m[`${prefix}OutputWidth`]);
  const height = Number(m[`${prefix}OutputHeight`]);
  const nonTransparentCount = Number(m[`${prefix}NonTransparentPixelCount`]);
  const hash = m[`${prefix}PixelHash`];
  const blankRef = m[`${prefix}BlankReferenceHash`] ?? null;

  if (state !== 'rendered') return 'FAILED';
  if (!Number.isFinite(width) || width <= 0) return 'FAILED';
  if (!Number.isFinite(height) || height <= 0) return 'FAILED';
  if (!Number.isFinite(nonTransparentCount) || nonTransparentCount <= 0) return 'FAILED';
  if (_looksLikeUntouchedDefaultCanvas(width, height, nonTransparentCount)) return 'FAILED';

  if (hash === null || hash === undefined) return 'UNVERIFIED_HASH';
  if (!isPixelHashConsistentWithCount(hash, nonTransparentCount, blankRef)) return 'FAILED';
  return 'OK';
}

/** Backward/hostile-test-compatible boolean view of `_sideStructuralStatus` -- a side "genuinely rendered real, verified pixels" only when its status is exactly 'OK'. Exported for reuse by pixel-truth-capture.js's `browserVerified` computation (Section 3). */
export function isSideStructurallyRenderedAndVerified(measured, prefix) {
  return _sideStructuralStatus(measured, prefix) === 'OK';
}

/**
 * The single canonical classifier (Section 2/4/6/11, reordered per EPIC
 * 2E-K-R2-FIX2 Section 4's explicit 12-step priority order): fatal/
 * structural problems that make a comparison meaningless at all are
 * classified first, then Legacy's own render+hash status, then whether a
 * Calibration-only V2 Preview Plan was even available/eligible for this
 * image (Section 1), then V2's own render+hash status, then geometry,
 * then the final pixel-level verdict. A missing pixel hash (verification
 * infrastructure gap) is NEVER conflated with a genuine render failure --
 * see `_sideStructuralStatus` above.
 *
 * Expected shape of `m` (every field optional -- missing/malformed
 * fields are treated as "not proven", never guessed toward success):
 *   sourceAvailable, staleGeneration, sourceFingerprintMatch,
 *   sameSourceGeometry, legacyPreviewState, legacyOutputWidth/Height,
 *   legacyNonTransparentPixelCount, legacyPixelHash,
 *   legacyBlankReferenceHash, controlledV2PreviewState,
 *   controlledV2OutputWidth/Height, controlledV2NonTransparentPixelCount,
 *   controlledV2PixelHash, controlledV2BlankReferenceHash,
 *   calibrationV2PlanAvailable, calibrationV2PlanRenderable,
 *   pixelDifferenceDetected (true/false/null).
 */
export function classifyPreviewTruth(measured) {
  const m = measured && typeof measured === 'object' ? measured : {};

  // 1. Source Available
  if (m.sourceAvailable === false) return 'SOURCE_UNAVAILABLE';
  // 2. Generation Current
  if (m.staleGeneration === true) return 'STALE_GENERATION';
  // 3. Fingerprint Match
  if (m.sourceFingerprintMatch === false) return 'SOURCE_MISMATCH';

  // 4/5. Legacy State Rendered + Legacy Pixel Count
  const legacyStatus = _sideStructuralStatus(m, 'legacy');
  if (legacyStatus === 'FAILED') return 'LEGACY_RENDER_FAILED';
  // 6. Legacy Hash Verified
  if (legacyStatus === 'UNVERIFIED_HASH') return 'PIXEL_HASH_UNAVAILABLE';

  // 7. Calibration V2 Plan Available/Renderable (Section 1) -- optional
  // fields; a caller that never supplies them (e.g. a pre-FIX2 hostile
  // test) falls through to the generic V2_RENDER_FAILED/V2_EMPTY_CANVAS
  // codes below, unchanged from FIX1 behavior.
  const planAvailable = m.calibrationV2PlanAvailable;
  const planRenderable = m.calibrationV2PlanRenderable;
  if (planAvailable === false) return 'CALIBRATION_V2_PLAN_UNAVAILABLE';
  if (planAvailable === true && planRenderable === false) return 'CALIBRATION_V2_PLAN_BLOCKED';
  const planSaidRenderable = planAvailable === true && planRenderable === true;

  // 8/9. V2 State Rendered + V2 Pixel Count
  const v2ClaimsRendered = m.controlledV2PreviewState === 'rendered';
  const v2Status = _sideStructuralStatus(m, 'controlledV2');
  if (v2Status === 'FAILED') {
    if (planSaidRenderable) return 'CALIBRATION_V2_RENDER_FAILED';
    return v2ClaimsRendered ? 'V2_EMPTY_CANVAS' : 'V2_RENDER_FAILED';
  }
  // 10. V2 Hash Verified
  if (v2Status === 'UNVERIFIED_HASH') return 'PIXEL_HASH_UNAVAILABLE';

  // Both sides independently proven to have real, hash-verified pixels --
  // geometry must match before a pixel-level diff is meaningful at all.
  // 11. Same Geometry
  if (m.sameSourceGeometry === false) return 'GEOMETRY_MISMATCH';

  // 12. Pixel Difference/Identity
  if (m.pixelDifferenceDetected === true) return 'BOTH_RENDERED_DIFFERENT';
  if (m.pixelDifferenceDetected === false) return 'BOTH_RENDERED_IDENTITY';
  // Both sides otherwise look genuinely rendered and verified, but no
  // honest pixel-diff verdict was computed -- fail closed rather than guess.
  return 'V2_RENDER_FAILED';
}

/**
 * `visualDecisionEligible` (Section 2/3): the single coarse "is this
 * record's visual evidence trustworthy enough to let a human record
 * ANY comparative decision" boolean. Deliberately does not
 * distinguish BOTH_RENDERED_DIFFERENT from BOTH_RENDERED_IDENTITY --
 * `isDecisionAllowedForEvidence()` below makes that finer distinction
 * for LEGACY_BETTER/V2_BETTER specifically.
 */
export function computeVisualDecisionEligibility(measured, previewTruthCode) {
  const m = measured && typeof measured === 'object' ? measured : {};
  if (previewTruthCode !== 'BOTH_RENDERED_DIFFERENT' && previewTruthCode !== 'BOTH_RENDERED_IDENTITY') return false;
  if (m.browserVerified !== true) return false;
  if (m.legacyPreviewState !== 'rendered' || m.controlledV2PreviewState !== 'rendered') return false;
  if (m.sameSourceGeometry !== true) return false;
  if (m.sourceFingerprintMatch !== true) return false;
  if (m.staleGeneration === true) return false;
  if (!(Number(m.legacyNonTransparentPixelCount) > 0)) return false;
  if (!(Number(m.controlledV2NonTransparentPixelCount) > 0)) return false;
  // EPIC 2E-K-R2-FIX2 -- Section 3: a genuinely rendered pair whose hash
  // could not be cryptographically verified on either side is NEVER
  // eligible for a comparative decision -- the mere existence of
  // `document`/`OffscreenCanvas` is not proof, only a verified hash is.
  if (_sideStructuralStatus(m, 'legacy') !== 'OK') return false;
  if (_sideStructuralStatus(m, 'controlledV2') !== 'OK') return false;
  return true;
}

/**
 * Builds the full, schema-shaped `previewEvidence` object (Section 2)
 * from a measured input -- the SOLE place `previewTruthCode` and
 * `visualDecisionEligible` are computed together, so they can never
 * drift apart. `renderGenerationId`/`verifiedAt` are passed through
 * from the caller (this module has no clock/ID authority of its own).
 */
export function buildPreviewEvidence(measured, { renderGenerationId = null, verifiedAt = null } = {}) {
  const m = measured && typeof measured === 'object' ? measured : {};
  const previewTruthCode = classifyPreviewTruth(m);
  const visualDecisionEligible = computeVisualDecisionEligibility(m, previewTruthCode);
  let pixelDifferenceDetected = null;
  if (previewTruthCode === 'BOTH_RENDERED_DIFFERENT') pixelDifferenceDetected = true;
  else if (previewTruthCode === 'BOTH_RENDERED_IDENTITY') pixelDifferenceDetected = false;

  return {
    previewTruthCode,
    legacyPreviewState: typeof m.legacyPreviewState === 'string' ? m.legacyPreviewState : 'unknown',
    controlledV2PreviewState: typeof m.controlledV2PreviewState === 'string' ? m.controlledV2PreviewState : 'unknown',
    legacyTransformed: m.legacyTransformed === true,
    controlledV2Transformed: m.controlledV2Transformed === true,
    sameSourceGeometry: m.sameSourceGeometry === true,
    sourceWidth: Number.isFinite(m.sourceWidth) ? m.sourceWidth : null,
    sourceHeight: Number.isFinite(m.sourceHeight) ? m.sourceHeight : null,
    legacyOutputWidth: Number.isFinite(m.legacyOutputWidth) ? m.legacyOutputWidth : null,
    legacyOutputHeight: Number.isFinite(m.legacyOutputHeight) ? m.legacyOutputHeight : null,
    controlledV2OutputWidth: Number.isFinite(m.controlledV2OutputWidth) ? m.controlledV2OutputWidth : null,
    controlledV2OutputHeight: Number.isFinite(m.controlledV2OutputHeight) ? m.controlledV2OutputHeight : null,
    legacyPixelHash: isPlausibleSha256Hex(m.legacyPixelHash) ? m.legacyPixelHash : null,
    controlledV2PixelHash: isPlausibleSha256Hex(m.controlledV2PixelHash) ? m.controlledV2PixelHash : null,
    legacyNonTransparentPixelCount: Number.isFinite(m.legacyNonTransparentPixelCount) ? m.legacyNonTransparentPixelCount : null,
    controlledV2NonTransparentPixelCount: Number.isFinite(m.controlledV2NonTransparentPixelCount) ? m.controlledV2NonTransparentPixelCount : null,
    pixelDifferenceDetected,
    browserVerified: m.browserVerified === true,
    visualDecisionEligible,
    sourceFingerprintMatch: m.sourceFingerprintMatch === true,
    renderGenerationId: renderGenerationId ?? null,
    verifiedAt: verifiedAt ?? null,
    // EPIC 2E-K-R2-FIX2 -- Section 5: real Calibration V2 Preview Plan
    // availability/mode, and real per-side hash-verification status --
    // never hard-coded, always read from what was actually measured.
    calibrationV2PlanAvailable: typeof m.calibrationV2PlanAvailable === 'boolean' ? m.calibrationV2PlanAvailable : null,
    calibrationV2PlanRenderable: typeof m.calibrationV2PlanRenderable === 'boolean' ? m.calibrationV2PlanRenderable : null,
    calibrationV2PlanMode: typeof m.calibrationV2PlanMode === 'string' ? m.calibrationV2PlanMode : null,
    pixelHashVerificationMode: isValidPixelHashVerificationMode(m.pixelHashVerificationMode) ? m.pixelHashVerificationMode : 'HASH_UNAVAILABLE',
    legacyHashVerified: _sideStructuralStatus(m, 'legacy') === 'OK',
    controlledV2HashVerified: _sideStructuralStatus(m, 'controlledV2') === 'OK',
  };
}

/**
 * The Decision Eligibility Gate (Section 3) -- the ONE function both
 * the renderer (to enable/disable buttons) and the controller (to
 * validate `saveCurrentDecision()`, even if called directly bypassing
 * the UI) must call. There is deliberately no second copy of this
 * logic anywhere else in the codebase.
 */
export function isDecisionAllowedForEvidence(decisionCode, previewEvidence) {
  if (decisionCode === 'NOT_REVIEWED') return true;
  const ev = previewEvidence && typeof previewEvidence === 'object' ? previewEvidence : null;
  if (!ev || ev.visualDecisionEligible !== true) return false;
  if (decisionCode === 'LEGACY_BETTER' || decisionCode === 'V2_BETTER') {
    return ev.previewTruthCode === 'BOTH_RENDERED_DIFFERENT';
  }
  if (decisionCode === 'ABOUT_EQUAL' || decisionCode === 'BOTH_UNACCEPTABLE' || decisionCode === 'NOT_SURE') {
    return ev.previewTruthCode === 'BOTH_RENDERED_DIFFERENT' || ev.previewTruthCode === 'BOTH_RENDERED_IDENTITY';
  }
  return false;
}

/**
 * UI-facing "why is this blocked right now" reason code (Section 1's
 * 6-code list) -- purely a friendlier, more specific presentation of
 * the same evidence `previewTruthCode` already captures. Returns
 * `null` when nothing is blocked (i.e. some decision is allowed).
 */
export function deriveUiBlockerReasonCode(previewEvidence) {
  const ev = previewEvidence && typeof previewEvidence === 'object' ? previewEvidence : null;
  if (!ev) return 'V2_RENDER_PLAN_UNAVAILABLE';
  if (ev.visualDecisionEligible === true) return null;
  // EPIC 2E-K-R2-FIX2 -- Section 5: NEVER a hard-coded
  // `v2RenderPlanAvailable: true` default -- the real Calibration V2
  // Preview Plan availability/renderability, as actually measured and
  // stored on this evidence object, is the only input here.
  if (ev.calibrationV2PlanAvailable === false) return 'CALIBRATION_V2_PLAN_UNAVAILABLE';
  if (ev.calibrationV2PlanAvailable === true && ev.calibrationV2PlanRenderable === false) return 'CALIBRATION_V2_PLAN_BLOCKED';
  switch (ev.previewTruthCode) {
    case 'CALIBRATION_V2_PLAN_UNAVAILABLE': return 'CALIBRATION_V2_PLAN_UNAVAILABLE';
    case 'CALIBRATION_V2_PLAN_BLOCKED': return 'CALIBRATION_V2_PLAN_BLOCKED';
    case 'CALIBRATION_V2_RENDER_FAILED': return 'V2_RENDER_FAILED';
    case 'PIXEL_HASH_UNAVAILABLE': return 'HASH_UNAVAILABLE';
    case 'V2_EMPTY_CANVAS': return 'V2_EMPTY_CANVAS';
    case 'V2_RENDER_FAILED': return 'V2_RENDER_FAILED';
    case 'STALE_GENERATION': return 'V2_STALE_GENERATION';
    case 'SOURCE_MISMATCH': return 'V2_SOURCE_MISMATCH';
    case 'GEOMETRY_MISMATCH': return 'GEOMETRY_MISMATCH';
    case 'LEGACY_RENDER_FAILED': return 'V2_RENDER_FAILED';
    case 'SOURCE_UNAVAILABLE': return 'V2_RENDER_PLAN_UNAVAILABLE';
    case 'NOT_RENDERED': return 'V2_RENDER_PLAN_UNAVAILABLE';
    default: return 'V2_RENDER_FAILED';
  }
}

/** Validate the previewTruthCode/blocker-code fields against the vocabulary (used by schema.js's validateImageRecord). */
export function isValidPreviewTruthCode(code) { return PREVIEW_TRUTH_CODE_SET.has(code); }
export function isValidPixelBlockerReasonCode(code) { return code === null || PIXEL_BLOCKER_REASON_CODE_SET.has(code); }

/**
 * The default `previewEvidence` for a record that has never had a
 * genuine pixel-truth measurement attempt (a freshly created record
 * before `pixel-truth-capture.js` runs, or a V1-migrated record --
 * Section 5). Every boolean is honestly `false`/`null` -- never
 * defaulted toward eligibility.
 */
export function createNotRenderedPreviewEvidence() {
  return {
    previewTruthCode: 'NOT_RENDERED',
    legacyPreviewState: 'unknown',
    controlledV2PreviewState: 'unknown',
    legacyTransformed: false,
    controlledV2Transformed: false,
    sameSourceGeometry: false,
    sourceWidth: null,
    sourceHeight: null,
    legacyOutputWidth: null,
    legacyOutputHeight: null,
    controlledV2OutputWidth: null,
    controlledV2OutputHeight: null,
    legacyPixelHash: null,
    controlledV2PixelHash: null,
    legacyNonTransparentPixelCount: null,
    controlledV2NonTransparentPixelCount: null,
    pixelDifferenceDetected: null,
    browserVerified: false,
    visualDecisionEligible: false,
    sourceFingerprintMatch: false,
    renderGenerationId: null,
    verifiedAt: null,
    calibrationV2PlanAvailable: null,
    calibrationV2PlanRenderable: null,
    calibrationV2PlanMode: null,
    pixelHashVerificationMode: 'HASH_UNAVAILABLE',
    legacyHashVerified: false,
    controlledV2HashVerified: false,
  };
}

/** Structural validation for a `previewEvidence` object (used by schema.js's validateImageRecord -- fails closed on anything malformed). */
export function isValidPreviewEvidence(ev) {
  if (!ev || typeof ev !== 'object') return false;
  if (!isValidPreviewTruthCode(ev.previewTruthCode)) return false;
  if (typeof ev.legacyPreviewState !== 'string') return false;
  if (typeof ev.controlledV2PreviewState !== 'string') return false;
  for (const key of ['legacyTransformed', 'controlledV2Transformed', 'sameSourceGeometry', 'browserVerified', 'visualDecisionEligible', 'sourceFingerprintMatch']) {
    if (typeof ev[key] !== 'boolean') return false;
  }
  for (const key of ['sourceWidth', 'sourceHeight', 'legacyOutputWidth', 'legacyOutputHeight', 'controlledV2OutputWidth', 'controlledV2OutputHeight', 'legacyNonTransparentPixelCount', 'controlledV2NonTransparentPixelCount']) {
    if (ev[key] !== null && !(typeof ev[key] === 'number' && Number.isFinite(ev[key]))) return false;
  }
  for (const key of ['legacyPixelHash', 'controlledV2PixelHash']) {
    if (ev[key] !== null && !isPlausibleSha256Hex(ev[key])) return false;
  }
  if (ev.pixelDifferenceDetected !== null && typeof ev.pixelDifferenceDetected !== 'boolean') return false;
  if (ev.renderGenerationId !== null && typeof ev.renderGenerationId !== 'string') return false;
  if (ev.verifiedAt !== null && typeof ev.verifiedAt !== 'string') return false;
  for (const key of ['calibrationV2PlanAvailable', 'calibrationV2PlanRenderable']) {
    if (ev[key] !== null && typeof ev[key] !== 'boolean') return false;
  }
  if (ev.calibrationV2PlanMode !== null && typeof ev.calibrationV2PlanMode !== 'string') return false;
  if (!isValidPixelHashVerificationMode(ev.pixelHashVerificationMode)) return false;
  for (const key of ['legacyHashVerified', 'controlledV2HashVerified']) {
    if (typeof ev[key] !== 'boolean') return false;
  }
  return true;
}
