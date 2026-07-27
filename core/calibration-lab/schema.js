/**
 * core/calibration-lab/schema.js
 *
 * EPIC 2E-K -- CONTROLLED V2 CALIBRATION LAB
 *
 * Pure data-shape builders + structural validators for the Calibration
 * Session and Semantic Image Test Record (R1 spec Sections 2-3). No
 * DOM, no IndexedDB -- the storage layer (ui/calibration-lab/
 * calibration-lab-storage.js) uses `validateSession`/`validateImageRecord`
 * to detect a corrupt on-disk record before it is ever handed to the
 * controller, and `recomputeSessionCounts` is the single source of
 * truth the controller calls after every save so the session's summary
 * counts can never silently drift from the records that back them.
 */

import {
  isValidCategoryList, isValidLightingCondition, isValidUserDecision, isValidIssueCodeList,
  USER_DECISION_SET,
} from './codes.js';
import { createNotRenderedPreviewEvidence, isValidPreviewEvidence } from './preview-evidence.js';

// EPIC 2E-K-R2-FIX1 -- Section 2: Calibration Schema V2. Bumped from 1
// to 2 because every Semantic Image Test Record now carries a
// `previewEvidence` object (see createImageTestRecord() below) plus
// two migration-audit fields -- a v1 record read back from storage has
// neither, and `ui/calibration-lab/calibration-lab-storage.js`'s
// migration step (Section 5) is the ONLY place that gap is closed.
export const CALIBRATION_SCHEMA_VERSION = 2;

// Per-RECORD schema version (independent of the session-level
// CALIBRATION_SCHEMA_VERSION above) -- lets the storage layer detect
// and migrate individual v1 image records even inside an otherwise
// up-to-date session object, without needing every record in a
// session to share one version.
export const RECORD_SCHEMA_VERSION = 2;

// Bounds -- deliberately conservative so a corrupt or hostile record
// (e.g. a multi-megabyte "notes" string, or thousands of images in one
// session) cannot blow out IndexedDB storage or make dashboard/export
// math unbounded.
export const MAX_NOTES_LENGTH = 2000;
export const MAX_IMAGES_PER_SESSION = 500;
export const MAX_STORED_SESSIONS = 20;

function _isFiniteNumberOrNull(v) {
  return v === null || (typeof v === 'number' && Number.isFinite(v));
}

function _isIsoTimestamp(v) {
  if (typeof v !== 'string' || v.length === 0) return false;
  const t = Date.parse(v);
  return Number.isFinite(t);
}

function _nowIso() {
  return new Date().toISOString();
}

function _genId(prefix) {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `${prefix}-${crypto.randomUUID()}`;
    }
  } catch { /* fall through to the bounded fallback below */ }
  // Bounded, dependency-free fallback -- never a Local File Path, never
  // anything derived from the user's filesystem.
  const rand = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${rand}`;
}

/**
 * Creates a new, empty Calibration Session (R1 Section 2). `locale` and
 * `appVersion` are recorded for QA/debugging only -- they are never
 * used to gate any Production behavior.
 */
export function createCalibrationSession({ locale, appVersion } = {}) {
  const nowIso = _nowIso();
  return {
    sessionId: _genId('cal-session'),
    createdAt: nowIso,
    updatedAt: nowIso,
    locale: (locale === 'en' || locale === 'th') ? locale : 'th',
    appVersion: typeof appVersion === 'string' && appVersion.length > 0 ? appVersion : 'unknown',
    calibrationSchemaVersion: CALIBRATION_SCHEMA_VERSION,
    imageCount: 0,
    reviewedCount: 0,
    legacyWins: 0,
    v2Wins: 0,
    ties: 0,
    bothRejected: 0,
    pendingCount: 0,
    legacyAuditOnlyCount: 0,
  };
}

/**
 * Creates a new Semantic Image Test Record (R1 Section 3). Only bounded,
 * stable-code and numeric fields -- never the original image, never a
 * Base64 payload, never a Local File Path.
 */
export function createImageTestRecord({
  imageFingerprint,
  imageCategories,
  lightingCondition,
  containsSkin = false,
  analysisGenerationId = null,
  legacySnapshot = null,
  controlledV2Snapshot = null,
  safetySnapshot = null,
  // EPIC 2E-K-R2-FIX1 -- Section 2: real pixel-truth evidence (see
  // core/calibration-lab/preview-evidence.js). Defaults to the honest
  // "never measured yet" shape -- a caller (the controller, right
  // after `pixel-truth-capture.js` resolves) overwrites this with the
  // real captured evidence; it is never defaulted toward eligibility.
  previewEvidence = null,
  // EPIC 2E-K-R2-FIX1 -- Section 5: only ever set by the V1->V2
  // migration step (ui/calibration-lab/calibration-lab-storage.js) --
  // a freshly created record is never migrated, so both default false.
  legacyDecisionPreservedForAudit = false,
  requiresVisualReReview = false,
} = {}) {
  return {
    imageId: _genId('cal-image'),
    recordSchemaVersion: RECORD_SCHEMA_VERSION,
    imageFingerprint: typeof imageFingerprint === 'string' ? imageFingerprint : null,
    imageCategories: Array.isArray(imageCategories) ? [...imageCategories] : [],
    lightingCondition: typeof lightingCondition === 'string' ? lightingCondition : 'UNKNOWN',
    containsSkin: containsSkin === true,
    analysisGenerationId,
    legacySnapshot,
    controlledV2Snapshot,
    safetySnapshot,
    previewEvidence: isValidPreviewEvidence(previewEvidence) ? previewEvidence : createNotRenderedPreviewEvidence(),
    userDecision: 'NOT_REVIEWED',
    issueCodes: [],
    notes: '',
    reviewedAt: null,
    legacyDecisionPreservedForAudit: legacyDecisionPreservedForAudit === true,
    requiresVisualReReview: requiresVisualReReview === true,
  };
}

/**
 * Structural validation for a Calibration Session -- used by the
 * storage layer's corrupt-record handling (R1 Section 9). Returns
 * `false` for anything malformed rather than throwing, so a caller can
 * always fail closed (skip/quarantine the record) instead of crashing.
 */
export function validateSession(session) {
  if (!session || typeof session !== 'object') return false;
  if (typeof session.sessionId !== 'string' || session.sessionId.length === 0) return false;
  if (!_isIsoTimestamp(session.createdAt)) return false;
  if (!_isIsoTimestamp(session.updatedAt)) return false;
  if (session.locale !== 'th' && session.locale !== 'en') return false;
  if (typeof session.appVersion !== 'string') return false;
  if (typeof session.calibrationSchemaVersion !== 'number') return false;
  const counters = ['imageCount', 'reviewedCount', 'legacyWins', 'v2Wins', 'ties', 'bothRejected', 'pendingCount', 'legacyAuditOnlyCount'];
  for (const key of counters) {
    if (typeof session[key] !== 'number' || !Number.isFinite(session[key]) || session[key] < 0) return false;
  }
  return true;
}

/**
 * Structural validation for a Semantic Image Test Record -- rejects
 * any record whose canonical decision/category/lighting/issue fields
 * are not a recognized stable code (see codes.js), or whose notes
 * exceed the bounded length, or whose snapshots are not bounded plain
 * objects (or null).
 */
export function validateImageRecord(record) {
  if (!record || typeof record !== 'object') return false;
  if (typeof record.imageId !== 'string' || record.imageId.length === 0) return false;
  if (typeof record.recordSchemaVersion !== 'number') return false;
  if (record.imageFingerprint !== null && typeof record.imageFingerprint !== 'string') return false;
  if (!isValidCategoryList(record.imageCategories) && !(Array.isArray(record.imageCategories) && record.imageCategories.length === 0)) return false;
  if (!isValidLightingCondition(record.lightingCondition)) return false;
  if (typeof record.containsSkin !== 'boolean') return false;
  if (!isValidUserDecision(record.userDecision)) return false;
  if (!isValidIssueCodeList(record.issueCodes)) return false;
  if (typeof record.notes !== 'string' || record.notes.length > MAX_NOTES_LENGTH) return false;
  if (record.reviewedAt !== null && !_isIsoTimestamp(record.reviewedAt)) return false;
  for (const snap of [record.legacySnapshot, record.controlledV2Snapshot, record.safetySnapshot]) {
    if (snap !== null && (typeof snap !== 'object' || Array.isArray(snap))) return false;
  }
  // EPIC 2E-K-R2-FIX1 -- Section 2: previewEvidence is REQUIRED on
  // every schema-v2 record (never optional/null) -- a record that
  // somehow lacks it has not gone through createImageTestRecord()'s
  // own default and is treated as structurally invalid, never silently
  // accepted with missing evidence.
  if (!isValidPreviewEvidence(record.previewEvidence)) return false;
  if (typeof record.legacyDecisionPreservedForAudit !== 'boolean') return false;
  if (typeof record.requiresVisualReReview !== 'boolean') return false;
  return true;
}

/**
 * Recomputes a session's summary counters from its own backing image
 * records -- the ONLY place these counters are ever derived, so the
 * controller can never let them silently drift from the records that
 * back them. Returns a NEW session object (does not mutate the input).
 */
export function recomputeSessionCounts(session, records) {
  const list = Array.isArray(records) ? records : [];
  let reviewedCount = 0, legacyWins = 0, v2Wins = 0, ties = 0, bothRejected = 0, pendingCount = 0;
  // EPIC 2E-K-R2-FIX1 -- Section 4/5 (Readiness Honesty): a decision
  // that was PRESERVED FOR AUDIT from a V1 migration (see
  // `legacyDecisionPreservedForAudit` on schema v2 records) is real
  // history and must stay visible on the record itself, but it is
  // NEVER allowed to feed the session's own win/tie/reject counters --
  // those numbers must only ever reflect decisions made against real,
  // browser-verified pixel evidence. Counted separately below so
  // nothing is silently dropped from the summary.
  let legacyAuditOnlyCount = 0;
  for (const r of list) {
    const d = r && USER_DECISION_SET.has(r.userDecision) ? r.userDecision : 'NOT_REVIEWED';
    if (d === 'NOT_REVIEWED') { pendingCount += 1; continue; }
    if (r?.legacyDecisionPreservedForAudit === true) { legacyAuditOnlyCount += 1; continue; }
    reviewedCount += 1;
    if (d === 'LEGACY_BETTER') legacyWins += 1;
    else if (d === 'V2_BETTER') v2Wins += 1;
    else if (d === 'ABOUT_EQUAL') ties += 1;
    else if (d === 'BOTH_UNACCEPTABLE') bothRejected += 1;
    // NOT_SURE counts toward reviewedCount only -- no dedicated bucket.
  }
  return {
    ...session,
    imageCount: list.length,
    reviewedCount, legacyWins, v2Wins, ties, bothRejected, pendingCount, legacyAuditOnlyCount,
    updatedAt: _nowIso(),
  };
}
