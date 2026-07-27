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

import { PREVIEW_TRUTH_CODE_SET, PIXEL_BLOCKER_REASON_CODE_SET } from './codes.js';

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

/** A side "genuinely rendered real pixels" only when ALL of these independently-checked facts hold -- see the module docstring for why this is an AND-chain, never an OR-shortcut. */
function _sideGenuinelyRendered(m, prefix) {
  const state = m[`${prefix}PreviewState`];
  const width = Number(m[`${prefix}OutputWidth`]);
  const height = Number(m[`${prefix}OutputHeight`]);
  const nonTransparentCount = Number(m[`${prefix}NonTransparentPixelCount`]);
  const hash = m[`${prefix}PixelHash`];
  if (state !== 'rendered') return false;
  if (!Number.isFinite(width) || width <= 0) return false;
  if (!Number.isFinite(height) || height <= 0) return false;
  if (!Number.isFinite(nonTransparentCount) || nonTransparentCount <= 0) return false;
  if (_looksLikeUntouchedDefaultCanvas(width, height, nonTransparentCount)) return false;
  if (!isPixelHashConsistentWithCount(hash, nonTransparentCount, m[`${prefix}BlankReferenceHash`] ?? null)) return false;
  return true;
}

/**
 * The single canonical classifier (Section 2/6/11). Takes a plain
 * "measured" object (see `pixel-truth-capture.js` for the real
 * browser-side producer, or any synthetic object in a hostile test)
 * and returns exactly one code from `PREVIEW_TRUTH_CODES`. Order is
 * significant: fatal/structural problems that make a pixel comparison
 * meaningless at all (missing source, stale generation, mismatched
 * source/geometry) are classified BEFORE finer render-outcome codes,
 * exactly mirroring the readiness ladder's own "most severe first"
 * convention elsewhere in this codebase.
 *
 * Expected shape of `m` (every field optional -- missing/malformed
 * fields are treated as "not proven", never guessed toward success):
 *   sourceAvailable, staleGeneration, sourceFingerprintMatch,
 *   sameSourceGeometry, legacyPreviewState, legacyOutputWidth/Height,
 *   legacyNonTransparentPixelCount, legacyPixelHash,
 *   legacyBlankReferenceHash, controlledV2PreviewState,
 *   controlledV2OutputWidth/Height, controlledV2NonTransparentPixelCount,
 *   controlledV2PixelHash, controlledV2BlankReferenceHash,
 *   pixelDifferenceDetected (true/false/null).
 */
export function classifyPreviewTruth(measured) {
  const m = measured && typeof measured === 'object' ? measured : {};

  if (m.sourceAvailable === false) return 'SOURCE_UNAVAILABLE';
  if (m.staleGeneration === true) return 'STALE_GENERATION';
  if (m.sourceFingerprintMatch === false) return 'SOURCE_MISMATCH';

  const legacyOk = _sideGenuinelyRendered(m, 'legacy');
  if (!legacyOk) return 'LEGACY_RENDER_FAILED';

  // Legacy is proven from here on -- classify V2's specific outcome.
  // A V2 side that claims state==='rendered' but fails the pixel-level
  // checks (zero-or-default canvas, inconsistent hash) is the EXACT
  // false-positive shape the R2 Browser test bug allowed through --
  // it gets its own code (V2_EMPTY_CANVAS) rather than being lumped
  // into the generic V2_RENDER_FAILED.
  const v2ClaimsRendered = m.controlledV2PreviewState === 'rendered';
  const v2Ok = _sideGenuinelyRendered(m, 'controlledV2');
  if (v2ClaimsRendered && !v2Ok) return 'V2_EMPTY_CANVAS';
  if (!v2Ok) return 'V2_RENDER_FAILED';

  // Both sides independently proven to have real, non-blank pixels --
  // geometry must match before a pixel-level diff is meaningful at all.
  if (m.sameSourceGeometry === false) return 'GEOMETRY_MISMATCH';

  if (m.pixelDifferenceDetected === true) return 'BOTH_RENDERED_DIFFERENT';
  if (m.pixelDifferenceDetected === false) return 'BOTH_RENDERED_IDENTITY';
  // Both sides otherwise look genuinely rendered, but no honest
  // pixel-diff verdict was computed -- fail closed rather than guess.
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
export function deriveUiBlockerReasonCode(previewEvidence, { v2RenderPlanAvailable = true } = {}) {
  const ev = previewEvidence && typeof previewEvidence === 'object' ? previewEvidence : null;
  if (!ev) return 'V2_RENDER_PLAN_UNAVAILABLE';
  if (ev.visualDecisionEligible === true) return null;
  if (v2RenderPlanAvailable === false) return 'V2_RENDER_PLAN_UNAVAILABLE';
  switch (ev.previewTruthCode) {
    case 'V2_EMPTY_CANVAS': return 'V2_EMPTY_CANVAS';
    case 'V2_RENDER_FAILED': return 'V2_RENDER_FAILED';
    case 'STALE_GENERATION': return 'V2_STALE_GENERATION';
    case 'SOURCE_MISMATCH': return 'V2_SOURCE_MISMATCH';
    case 'GEOMETRY_MISMATCH': return 'GEOMETRY_MISMATCH';
    case 'LEGACY_RENDER_FAILED': return 'V2_RENDER_FAILED';
    case 'SOURCE_UNAVAILABLE': return 'V2_RENDER_PLAN_UNAVAILABLE';
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
  return true;
}
