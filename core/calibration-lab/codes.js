/**
 * core/calibration-lab/codes.js
 *
 * EPIC 2E-K -- CONTROLLED V2 CALIBRATION LAB
 *
 * Every stable code enum used by the Calibration Lab. These are the
 * ONLY vocabulary the Calibration Lab's data model, storage layer,
 * export and Semantic QA Snapshot are allowed to persist as the
 * canonical record of a decision -- never a localized (Thai/English)
 * sentence. `ui/calibration-lab/calibration-lab-i18n.js` is the single
 * place a stable code is ever turned into display text, and only for
 * rendering; it is never read back or stored.
 *
 * This module is pure data + pure validators -- no DOM, no IndexedDB, no
 * import from ui/app.js or from any Production-locked core engine
 * output shape. Safe to import from Node (tests) or the browser alike.
 */

// --- Image categories (Section 4) -- user may select more than one --------
export const IMAGE_CATEGORIES = Object.freeze([
  'WEDDING', 'PORTRAIT', 'GRADUATION', 'ORDINATION', 'EVENT',
  'INDOOR', 'OUTDOOR', 'MIXED_LIGHT', 'NIGHT', 'BACKLIT',
  'SKIN_DOMINANT', 'LANDSCAPE', 'PRODUCT', 'OTHER',
]);
export const IMAGE_CATEGORY_SET = new Set(IMAGE_CATEGORIES);

// --- Lighting conditions (Section 5) ----------------------------------------
export const LIGHTING_CONDITIONS = Object.freeze([
  'DAYLIGHT', 'SHADE', 'TUNGSTEN', 'FLUORESCENT', 'LED',
  'MIXED', 'FLASH', 'LOW_LIGHT', 'UNKNOWN',
]);
export const LIGHTING_CONDITION_SET = new Set(LIGHTING_CONDITIONS);

// --- Comparison decision (Section 6) -- never triggers Apply/Export/XMP ----
export const USER_DECISIONS = Object.freeze([
  'LEGACY_BETTER', 'V2_BETTER', 'ABOUT_EQUAL', 'BOTH_UNACCEPTABLE', 'NOT_SURE', 'NOT_REVIEWED',
]);
export const USER_DECISION_SET = new Set(USER_DECISIONS);

// --- Issue codes (Section 7) -- user may select multiple per image ---------
export const ISSUE_CODES = Object.freeze([
  'WB_TOO_WARM', 'WB_TOO_COOL', 'TINT_TOO_MAGENTA', 'TINT_TOO_GREEN',
  'SKIN_TONE_UNNATURAL', 'SKIN_TOO_ORANGE', 'SKIN_TOO_PALE',
  'OBJECT_COLOR_MISREAD_AS_LIGHT', 'MIXED_LIGHT_FAILURE',
  'EXPOSURE_TOO_BRIGHT', 'EXPOSURE_TOO_DARK', 'HIGHLIGHT_LOSS', 'SHADOW_LOSS',
  'CONTRAST_TOO_HIGH', 'CONTRAST_TOO_LOW', 'SATURATION_TOO_HIGH', 'SATURATION_TOO_LOW',
  'COLOR_SHIFT', 'VISUAL_RESULT_UNSTABLE', 'OTHER',
]);
export const ISSUE_CODE_SET = new Set(ISSUE_CODES);

// --- Preview Truth codes (EPIC 2E-K-R2-FIX1 Section 2) ---------------------
// The ONLY stable classification of what a Legacy/Controlled-V2 pixel
// render PAIR actually produced -- computed exclusively by
// `core/calibration-lab/preview-evidence.js`'s `classifyPreviewTruth()`
// from REAL measured pixel evidence (never from a Render Plan's own
// claimed `state` alone -- see that module's docstring for why).
export const PREVIEW_TRUTH_CODES = Object.freeze([
  'BOTH_RENDERED_DIFFERENT', 'BOTH_RENDERED_IDENTITY',
  'LEGACY_RENDER_FAILED', 'V2_RENDER_FAILED', 'V2_EMPTY_CANVAS',
  'GEOMETRY_MISMATCH', 'SOURCE_MISMATCH', 'STALE_GENERATION',
  'SOURCE_UNAVAILABLE', 'NOT_RENDERED',
  // EPIC 2E-K-R2-FIX2 -- Section 4: these four distinguish "genuinely
  // failed to render" from "rendered fine but could not be VERIFIED"
  // (hash API unavailable) or "V2 side was never eligible to render in
  // the first place because the Calibration-only V2 Preview Plan itself
  // reported unavailable/blocked" -- neither of these is a Legacy or V2
  // pixel-rendering failure, and must never be classified as one.
  'PIXEL_HASH_UNAVAILABLE', 'CALIBRATION_V2_PLAN_UNAVAILABLE',
  'CALIBRATION_V2_PLAN_BLOCKED', 'CALIBRATION_V2_RENDER_FAILED',
]);
export const PREVIEW_TRUTH_CODE_SET = new Set(PREVIEW_TRUTH_CODES);

/** Validate a previewTruthCode -- the single stored classification field on `previewEvidence`. */
export function isValidPreviewTruthCode(code) {
  return typeof code === 'string' && PREVIEW_TRUTH_CODE_SET.has(code);
}

// --- UI-facing pixel blocker reason codes (EPIC 2E-K-R2-FIX1 Section 1) -----
// A finer-grained, UI-facing "why are Decision Controls disabled right
// now" code, derived FROM previewEvidence by
// `preview-evidence.js`'s `deriveUiBlockerReasonCode()` -- distinct
// from (but derived from) the persisted previewTruthCode above. Never
// stored on a record itself; recomputed on demand for display only.
export const PIXEL_BLOCKER_REASON_CODES = Object.freeze([
  'V2_RENDER_PLAN_UNAVAILABLE', 'V2_RENDER_FAILED', 'V2_EMPTY_CANVAS',
  'V2_STALE_GENERATION', 'V2_SOURCE_MISMATCH', 'GEOMETRY_MISMATCH',
  // EPIC 2E-K-R2-FIX2 -- Section 5: the real, distinct reasons a
  // Calibration-only V2 Preview Plan itself may be unavailable/blocked,
  // and the real reason a genuinely-rendered side could not be
  // cryptographically verified -- each derived from real evidence
  // fields, never hard-coded.
  'CALIBRATION_V2_PLAN_UNAVAILABLE', 'CALIBRATION_V2_PLAN_BLOCKED',
  'HASH_UNAVAILABLE',
]);
export const PIXEL_BLOCKER_REASON_CODE_SET = new Set(PIXEL_BLOCKER_REASON_CODES);

/** Validate a UI-facing pixel blocker reason code. `null` is also valid (means "not blocked"). */
export function isValidPixelBlockerReasonCode(code) {
  return code === null || (typeof code === 'string' && PIXEL_BLOCKER_REASON_CODE_SET.has(code));
}

// --- Pixel hash verification mode (EPIC 2E-K-R2-FIX2 Section 3) ------------
// Which mechanism actually produced a given side's pixel hash. An
// in-memory/opaque-origin (about:blank) Browser QA harness may not have
// `crypto.subtle` (Web Crypto requires a secure context) -- this is
// honestly distinguished from a genuine render failure. `HASH_UNAVAILABLE`
// means neither mechanism could produce a hash; it is NEVER conflated
// with "the canvas failed to render" (see preview-evidence.js Section 4).
export const PIXEL_HASH_VERIFICATION_MODES = Object.freeze([
  'WEB_CRYPTO_SHA256', 'PURE_JS_SHA256', 'HASH_UNAVAILABLE',
]);
export const PIXEL_HASH_VERIFICATION_MODE_SET = new Set(PIXEL_HASH_VERIFICATION_MODES);
export function isValidPixelHashVerificationMode(code) {
  return typeof code === 'string' && PIXEL_HASH_VERIFICATION_MODE_SET.has(code);
}

// --- Calibration V2 Preview Plan mode (EPIC 2E-K-R2-FIX2 Section 1) --------
export const CALIBRATION_V2_PREVIEW_MODE = 'CALIBRATION_PREVIEW_ONLY';

// --- Readiness status (Section 12) ------------------------------------------
// PRODUCTION_READY is intentionally NOT a member of this set -- the
// Calibration Lab is a Preview/Shadow-only measurement tool and MUST
// NEVER be able to assert that Controlled V2 is ready for Production,
// per the R1 spec's explicit requirement that no such status exist.
export const READINESS_STATUSES = Object.freeze([
  'INSUFFICIENT_DATA', 'NEEDS_MORE_COVERAGE', 'NEEDS_CALIBRATION',
  'PROMISING_NOT_READY', 'READY_FOR_CANDIDATE_REVIEW',
  // EPIC 2E-K-R2-FIX1 -- Section 4 (Readiness Honesty): these three
  // statuses let the ladder honestly report "the numbers might look
  // good, but the evidence behind them has not actually been proven
  // real yet" -- distinct from NEEDS_MORE_COVERAGE (not enough
  // reviewed samples) and NEEDS_CALIBRATION (safety signals too high).
  // Never checked before the four legacy statuses above in the
  // ladder -- see readiness.js's computeReadinessReport().
  'NEEDS_BROWSER_VERIFICATION', 'NEEDS_PIXEL_PREVIEW', 'NEEDS_REVIEW_REFRESH',
]);
export const READINESS_STATUS_SET = new Set(READINESS_STATUSES);
export const FORBIDDEN_READINESS_STATUS = 'PRODUCTION_READY';

// --- Session lifecycle state (used by the Semantic QA Snapshot, Section 14) -
export const SESSION_STATES = Object.freeze(['NO_SESSION', 'ACTIVE', 'ENDED']);
export const SESSION_STATE_SET = new Set(SESSION_STATES);

// --- Persistence mode (used by storage layer + Semantic QA Snapshot) -------
export const PERSISTENCE_MODES = Object.freeze(['INDEXEDDB', 'IN_MEMORY_FALLBACK', 'UNAVAILABLE']);
export const PERSISTENCE_MODE_SET = new Set(PERSISTENCE_MODES);

// --- Calibration Lab top-level UI mode (used by the Semantic QA Snapshot) --
export const CALIBRATION_MODES = Object.freeze(['CLOSED', 'REVIEW', 'DASHBOARD', 'READINESS', 'PILOT']);
export const CALIBRATION_MODE_SET = new Set(CALIBRATION_MODES);

/** Validate an array of category codes: every entry must be a known code, at least one entry, no duplicates. */
export function isValidCategoryList(list) {
  if (!Array.isArray(list) || list.length === 0) return false;
  const seen = new Set();
  for (const c of list) {
    if (typeof c !== 'string' || !IMAGE_CATEGORY_SET.has(c)) return false;
    if (seen.has(c)) return false;
    seen.add(c);
  }
  return true;
}

/** Validate a single lighting condition code. */
export function isValidLightingCondition(code) {
  return typeof code === 'string' && LIGHTING_CONDITION_SET.has(code);
}

/** Validate a single user decision code. */
export function isValidUserDecision(code) {
  return typeof code === 'string' && USER_DECISION_SET.has(code);
}

/** Validate an array of issue codes: every entry known, no duplicates. Empty array is valid (no issues selected). */
export function isValidIssueCodeList(list) {
  if (!Array.isArray(list)) return false;
  const seen = new Set();
  for (const c of list) {
    if (typeof c !== 'string' || !ISSUE_CODE_SET.has(c)) return false;
    if (seen.has(c)) return false;
    seen.add(c);
  }
  return true;
}

/** Validate a readiness status code -- explicitly rejects the forbidden PRODUCTION_READY value even if a caller tries to smuggle it through. */
export function isValidReadinessStatus(code) {
  if (typeof code !== 'string') return false;
  if (code === FORBIDDEN_READINESS_STATUS) return false;
  return READINESS_STATUS_SET.has(code);
}
