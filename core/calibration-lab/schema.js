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

export const CALIBRATION_SCHEMA_VERSION = 1;

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
} = {}) {
  return {
    imageId: _genId('cal-image'),
    imageFingerprint: typeof imageFingerprint === 'string' ? imageFingerprint : null,
    imageCategories: Array.isArray(imageCategories) ? [...imageCategories] : [],
    lightingCondition: typeof lightingCondition === 'string' ? lightingCondition : 'UNKNOWN',
    containsSkin: containsSkin === true,
    analysisGenerationId,
    legacySnapshot,
    controlledV2Snapshot,
    safetySnapshot,
    userDecision: 'NOT_REVIEWED',
    issueCodes: [],
    notes: '',
    reviewedAt: null,
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
  const counters = ['imageCount', 'reviewedCount', 'legacyWins', 'v2Wins', 'ties', 'bothRejected', 'pendingCount'];
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
  for (const r of list) {
    const d = r && USER_DECISION_SET.has(r.userDecision) ? r.userDecision : 'NOT_REVIEWED';
    if (d === 'NOT_REVIEWED') { pendingCount += 1; continue; }
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
    reviewedCount, legacyWins, v2Wins, ties, bothRejected, pendingCount,
    updatedAt: _nowIso(),
  };
}
