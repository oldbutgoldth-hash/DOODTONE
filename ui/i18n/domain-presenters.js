/**
 * ui/i18n/domain-presenters.js
 *
 * FULL-SYSTEM I18N COMPLETION R2 — Phase A.
 *
 * Presentation-only helpers that translate STABLE DOMAIN CODES into
 * localized, photographer-facing text at the render boundary.
 *
 * WHY THIS MODULE EXISTS
 * Several Core modules legitimately emit English prose (they are
 * business logic, and their output values are part of the stable
 * production contract — this round must not change them). The UI must
 * therefore never display that prose directly in Thai mode. Instead
 * the UI branches on the stable CODE or ID that accompanies the prose
 * and translates here, keeping the raw English available only for the
 * collapsed Developer Details block.
 *
 * HARD RULES (enforced by qa/epic-2e-j-i18n-visible-text-audit-static-test.mjs
 * and by this module's own design):
 * - This module NEVER runs analysis, never mutates state, never
 *   touches Mapping/XMP, and never performs I/O. It is pure string
 *   lookup over already-computed codes.
 * - It never branches business logic on translated text — callers pass
 *   a code, and receive display text.
 * - Every lookup degrades safely: an unknown/malformed code returns a
 *   bounded, honest "unrecognised" string rather than throwing,
 *   rendering blank, or leaking a raw object.
 * - No HTML is ever produced. Callers use textContent/el({text}).
 */

import { t } from './index.js';

/** Safe string coercion for an untrusted code coming from upstream data. */
function _safeCode(code) {
  return typeof code === 'string' && code.trim() ? code.trim() : null;
}

/** camelCases a kebab-case canonical ID ('export-path-unchanged' -> 'exportPathUnchanged'). */
export function camelizeId(id) {
  const safe = _safeCode(id);
  if (!safe) return null;
  return safe.replace(/-([a-z0-9])/g, (_m, c) => c.toUpperCase());
}

/** The ten canonical Review item IDs, in canonical display order. */
export const CANONICAL_REVIEW_ITEM_IDS = [
  'legacy-output-preserved',
  'source-image-reviewed',
  'skin-tones-reviewed',
  'highlights-reviewed',
  'shadows-reviewed',
  'white-balance-reviewed',
  'color-stacking-reviewed',
  'rollback-confirmed',
  'preview-non-production-confirmed',
  'export-path-unchanged',
];
const CANONICAL_REVIEW_ITEM_ID_SET = new Set(CANONICAL_REVIEW_ITEM_IDS);

export function isCanonicalReviewItemId(id) {
  const safe = _safeCode(id);
  return safe !== null && CANONICAL_REVIEW_ITEM_ID_SET.has(safe);
}

/**
 * Translates one field of a canonical Review item by its stable ID.
 *
 * `field` is one of: title | description | whatThisChecks |
 * whatToLookFor | whyItMatters.
 *
 * For a NON-canonical (developer-defined) item this returns null, so
 * the caller can fall back to the item's own bounded source label and
 * mark it as developer-defined -- never crashing, never silently
 * pretending an unknown check is one of the ten standard ones.
 */
export function presentReviewItemField(id, field, lang) {
  if (!isCanonicalReviewItemId(id)) return null;
  const camel = camelizeId(id);
  const allowedFields = new Set(['title', 'description', 'whatThisChecks', 'whatToLookFor', 'whyItMatters']);
  if (!allowedFields.has(field)) return null;
  return t(`review.item.${camel}.${field}`, null, lang);
}

/** Bounded label for an unknown, developer-defined review item. */
export function presentUnknownReviewItemNote(lang) {
  return t('review.item.unknownDeveloperDefined', null, lang);
}

// ── Generic code->key presenters ────────────────────────────────────────

/**
 * Shared implementation: look up `code` inside `namespace`, falling
 * back to `fallbackKey` for an unknown/malformed code. Codes are
 * matched exactly as emitted upstream (no case folding) so a silent
 * near-miss can never resolve to the wrong sentence.
 */
function _present(namespace, code, fallbackKey, lang, params) {
  const safe = _safeCode(code);
  if (!safe) return t(fallbackKey, null, lang);
  const key = `${namespace}.${safe}`;
  const text = t(key, params ?? null, lang);
  // t() returns the literal key when nothing resolves -- treat that as
  // "unknown code" rather than rendering a dotted key path on screen.
  return text === key ? t(fallbackKey, null, lang) : text;
}

/** Renderer limitation codes (BROWSER_APPROXIMATION, RAW_NOT_SIMULATED, ...). */
export function presentLimitationCode(code, lang) {
  return _present('previewCode.limitation', code, 'previewCode.unknownCode', lang);
}

/** Renderer reason codes (RENDERED_ADJUSTMENT_COUNTS, IDENTITY_NO_SUPPORTED_CHANGE, ...). */
export function presentReasonCode(code, lang, params) {
  return _present('previewCode.reason', code, 'previewCode.unknownCode', lang, params);
}

/** Controller/preview blocker codes (PREVIEW_PLAN_UNAVAILABLE, HARD_SAFETY_STOP, ...). */
export function presentBlockerCode(code, lang) {
  return _present('previewCode.blocker', code, 'previewCode.unknownCode', lang);
}

/**
 * I18N RUNTIME CLOSURE R3 — Phase G: Interactive Before/After
 * blocker/warning codes (CANCELLED_NEWER_ANALYSIS,
 * SAFETY_ANOMALY_BLOCKED, V2_PREVIEW_FAILED, ...), emitted additively
 * by `interactive-before-after-controller-v2.js`'s pure
 * `deriveInteractiveBeforeAfterStateV2()` alongside its existing raw
 * English `blockers`/`warnings` arrays.
 */
export function presentBeforeAfterBlockerCode(code, lang) {
  return _present('beforeAfter.blockerCode', code, 'beforeAfter.blockerCode.unknown', lang);
}

export function presentBeforeAfterWarningCode(code, lang) {
  // NOTE: warningCodes reaching Before/After are merged from TWO
  // sources -- this controller's own codes (BOTH_NO_SUPPORTED_
  // ADJUSTMENTS, SAFETY_EVIDENCE_NOT_CONFIRMED, V2_SAFETY_RESTRAINT_
  // LABEL, V2_IDENTITY_FALLBACK_LABEL, under `beforeAfter.warningCode`)
  // AND the isolated Visual Preview renderer's honesty/limitation
  // codes (BROWSER_APPROXIMATION, RAW_NOT_SIMULATED, CAMERA_PROFILE_
  // NOT_REPRODUCED, ...) that are threaded through unchanged from each
  // side's own `warningCodes` (already dictionaried under
  // `previewCode.limitation`, per `presentLimitationCode` above) --
  // try the Before/After namespace first, then fall back to the
  // shared limitation namespace, before finally giving up.
  const safe = _safeCode(code);
  if (!safe) return t('beforeAfter.warningCode.unknown', null, lang);
  const primaryKey = `beforeAfter.warningCode.${safe}`;
  const primaryText = t(primaryKey, null, lang);
  if (primaryText !== primaryKey) return primaryText;
  const limitationKey = `previewCode.limitation.${safe}`;
  const limitationText = t(limitationKey, null, lang);
  if (limitationText !== limitationKey) return limitationText;
  return t('beforeAfter.warningCode.unknown', null, lang);
}

/**
 * I18N RUNTIME CLOSURE R3 — Phase F: Data Comparison blocker/warning/
 * recommendation/summary codes, emitted additively by
 * `mapping-v2-side-by-side-comparison.js`'s `buildSideBySidePreviewComparisonV2()`
 * alongside its existing raw English `blockers`/`warnings`/
 * `recommendations`/`photographerSummary` fields.
 */
export function presentComparisonBlockerCode(code, params, lang, rawFallbackText = '') {
  const safe = _safeCode(code);
  if (!safe) return rawFallbackText || t('comparison.blockerCode.unknown', null, lang);
  const key = `comparison.blockerCode.${safe}`;
  const text = t(key, params ?? null, lang);
  return text === key ? (rawFallbackText || t('comparison.blockerCode.unknown', null, lang)) : text;
}

export function presentComparisonWarningCode(code, params, lang, rawFallbackText = '') {
  const safe = _safeCode(code);
  if (!safe) return rawFallbackText || t('comparison.warningCode.unknown', null, lang);
  const key = `comparison.warningCode.${safe}`;
  const text = t(key, params ?? null, lang);
  return text === key ? (rawFallbackText || t('comparison.warningCode.unknown', null, lang)) : text;
}

export function presentComparisonRecommendationCode(code, params, lang, rawFallbackText = '') {
  const safe = _safeCode(code);
  if (!safe) return rawFallbackText || t('comparison.recommendationCode.unknown', null, lang);
  const key = `comparison.recommendationCode.${safe}`;
  const text = t(key, params ?? null, lang);
  return text === key ? (rawFallbackText || t('comparison.recommendationCode.unknown', null, lang)) : text;
}

export function presentComparisonSummaryCode(code, lang, rawFallbackText = '') {
  const safe = _safeCode(code);
  if (!safe) return rawFallbackText || t('comparison.summaryCode.unknown', null, lang);
  const key = `comparison.summaryCode.${safe}`;
  const text = t(key, null, lang);
  return text === key ? (rawFallbackText || t('comparison.summaryCode.unknown', null, lang)) : text;
}

/**
 * I18N RUNTIME CLOSURE R3 — Phase E: Review Console blocker/warning
 * codes (NO_SANDBOX_AVAILABLE, REQUIRED_ITEM_FAILED, ...), emitted
 * additively alongside the existing English `blockers`/`warnings`
 * arrays by mapping-v2-preview-review-state.js and
 * mapping-v2-overlay-preview-sandbox.js. `rawFallbackText` is the
 * corresponding raw Core English sentence (already merged/deduped by
 * the renderer) — used ONLY when `code` is missing/unrecognized, so a
 * genuinely new blocker/warning Core adds before its code is wired up
 * is never silently hidden, just shown in English until the dictionary
 * catches up (fail-open toward visibility, never toward data loss).
 */
export function presentReviewBlockerCode(code, params, lang, rawFallbackText = '') {
  const safe = _safeCode(code);
  if (!safe) return rawFallbackText || t('review.blockerCode.unknown', null, lang);
  const key = `review.blockerCode.${safe}`;
  const text = t(key, params ?? null, lang);
  return text === key ? (rawFallbackText || t('review.blockerCode.unknown', null, lang)) : text;
}

export function presentReviewWarningCode(code, params, lang, rawFallbackText = '') {
  const safe = _safeCode(code);
  if (!safe) return rawFallbackText || t('review.warningCode.unknown', null, lang);
  const key = `review.warningCode.${safe}`;
  const text = t(key, params ?? null, lang);
  return text === key ? (rawFallbackText || t('review.warningCode.unknown', null, lang)) : text;
}

/**
 * I18N RUNTIME CLOSURE R3 — Phase E: the Review Console's top
 * "primary guidance" sentence (READY_TO_BUILD_V2,
 * NEEDS_ADJUSTMENT_OR_FAILED, REVIEW_REMAINING_VISUAL_ITEMS,
 * HUMAN_REVIEW_NOT_REQUIRED), emitted additively alongside Core's
 * existing English `reviewGuidance.primaryGuidance` string by both
 * _buildReviewGuidance() (mapping-v2-preview-review-state.js) and the
 * local `reviewGuidance` builder in
 * mapping-v2-overlay-preview-sandbox.js.
 */
export function presentReviewGuidanceCode(code, params, lang, rawFallbackText = '') {
  const safe = _safeCode(code);
  if (!safe) return rawFallbackText || t('review.guidance.unknown', null, lang);
  const key = `review.guidance.${safe}`;
  const text = t(key, params ?? null, lang);
  return text === key ? (rawFallbackText || t('review.guidance.unknown', null, lang)) : text;
}

/** Risk levels: low | medium | high | critical | unknown. */
export function presentRiskLevel(level, lang) {
  const safe = _safeCode(level);
  const allowed = new Set(['low', 'medium', 'high', 'critical', 'unknown']);
  const key = allowed.has(safe) ? safe : 'unknown';
  return t(`review.risk.level.${key}`, null, lang);
}

/** Review presentation states: not-started | in-progress | approved | ... */
export function presentReviewSummaryState(state, lang) {
  const safe = _safeCode(state);
  const map = {
    'not-started': 'notStarted',
    'in-progress': 'inProgress',
    approved: 'approved',
    blocked: 'blocked',
    rejected: 'rejected',
    'needs-adjustment': 'needsAdjustment',
    unavailable: 'unavailable',
    'ready-to-build-v2': 'readyToBuildV2',
  };
  const camel = map[safe] ?? 'unavailable';
  return t(`review.summaryState.${camel}`, null, lang);
}

/** Comparison direction codes. */
export function presentDirection(code, lang) {
  const safe = _safeCode(code);
  const map = {
    similar: 'similar',
    'legacy-stronger': 'legacyStronger',
    'v2-stronger': 'v2Stronger',
    'legacy-safer': 'legacySafer',
    'v2-safer': 'v2Safer',
    mixed: 'mixed',
    unknown: 'unknown',
  };
  return t(`comparison.direction.${map[safe] ?? 'unknown'}`, null, lang);
}

/** Comparison side codes. */
export function presentSide(code, lang) {
  const safe = _safeCode(code);
  const map = { legacy: 'legacy', v2: 'v2', tie: 'tie', 'human-review': 'humanReview', unknown: 'unknown' };
  return t(`comparison.side.${map[safe] ?? 'unknown'}`, null, lang);
}

/** Comparison state codes. */
export function presentComparisonState(code, lang) {
  const safe = _safeCode(code);
  const map = {
    unavailable: 'unavailable',
    partial: 'partial',
    blocked: 'blocked',
    'ready-for-review': 'readyForReview',
    reviewed: 'reviewed',
    'insufficient-evidence': 'insufficientEvidence',
  };
  return t(`comparison.stateLabel.${map[safe] ?? 'unavailable'}`, null, lang);
}

/** Evidence quality codes. */
export function presentEvidenceLevel(code, lang) {
  const safe = _safeCode(code);
  const allowed = new Set(['insufficient', 'limited', 'moderate', 'strong']);
  return t(`comparison.evidence.${allowed.has(safe) ? safe : 'insufficient'}`, null, lang);
}

/** Approval-state codes. */
export function presentApprovalState(code, lang) {
  const safe = _safeCode(code);
  const map = {
    'not-started': 'notStarted',
    'in-progress': 'inProgress',
    blocked: 'blocked',
    'needs-adjustment': 'needsAdjustment',
    rejected: 'rejected',
    approved: 'approved',
    unavailable: 'unavailable',
  };
  return t(`comparison.approvalState.${map[safe] ?? 'unavailable'}`, null, lang);
}

/** Comparison dimension name, by stable dimension ID. */
export function presentDimensionName(id, lang) {
  const camel = camelizeId(id);
  if (!camel) return t('comparison.dimensionName.unknown', null, lang);
  const key = `comparison.dimensionName.${camel}`;
  const text = t(key, null, lang);
  return text === key ? t('comparison.dimensionName.unknown', null, lang) : text;
}

/** Comparison dimension description, by stable dimension ID. */
export function presentDimensionDescription(id, lang) {
  const camel = camelizeId(id);
  if (!camel) return t('comparison.dimensionDescription.unknown', null, lang);
  const key = `comparison.dimensionDescription.${camel}`;
  const text = t(key, null, lang);
  return text === key ? t('comparison.dimensionDescription.unknown', null, lang) : text;
}

/**
 * Projects a bounded array of codes into translated display strings.
 * Never iterates an untrusted value directly; caps at `max` entries so
 * hostile/oversized upstream data can never flood the UI.
 */
export function presentCodeList(codes, presenter, lang, max = 12) {
  let isArr;
  try { isArr = Array.isArray(codes); } catch { return []; }
  if (!isArr) return [];
  const out = [];
  const bound = Math.min(codes.length, max);
  for (let i = 0; i < bound; i++) {
    let raw;
    try { raw = codes[i]; } catch { continue; }
    const text = presenter(raw, lang);
    if (typeof text === 'string' && text) out.push(text);
  }
  return out;
}
