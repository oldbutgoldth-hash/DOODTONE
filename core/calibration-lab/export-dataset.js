/**
 * core/calibration-lab/export-dataset.js
 *
 * EPIC 2E-K -- CONTROLLED V2 CALIBRATION LAB
 *
 * Export Calibration Data (R1 Section 10) as JSON or CSV. Pure
 * functions -- no DOM, no file-system access; callers (the Calibration
 * Lab UI) turn the returned string into a downloadable Blob themselves.
 *
 * HARD GUARANTEE, enforced by construction (never by a runtime filter
 * that could be bypassed): neither export function ever reads a field
 * named for an original image, a Base64 payload, or a Local File Path
 * -- the field allow-lists below are the ONLY data that can ever reach
 * the output, so there is no code path through which such data could
 * leak even if a caller's record object happened to carry an extra,
 * unexpected property.
 */

import { CALIBRATION_SCHEMA_VERSION } from './schema.js';

function _csvCell(value) {
  const s = value === null || value === undefined ? '' : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** The bounded, allow-listed record shape both exporters read from -- deliberately excludes `notes` from CSV (per the R1 spec's explicit required-column list) but includes it in JSON as a bounded, user-authored annotation string (never a Raw Core Prose value, never used to derive any code). */
function _boundedRecord(record) {
  return {
    imageId: record?.imageId ?? null,
    imageFingerprint: record?.imageFingerprint ?? null,
    imageCategories: Array.isArray(record?.imageCategories) ? [...record.imageCategories] : [],
    lightingCondition: record?.lightingCondition ?? null,
    containsSkin: record?.containsSkin === true,
    userDecision: record?.userDecision ?? 'NOT_REVIEWED',
    issueCodes: Array.isArray(record?.issueCodes) ? [...record.issueCodes] : [],
    notes: typeof record?.notes === 'string' ? record.notes : '',
    legacyConfidence: record?.legacySnapshot?.confidence ?? null,
    v2Confidence: record?.controlledV2Snapshot?.confidence ?? null,
    legacySafetyScore: record?.legacySnapshot?.safetyScore ?? null,
    v2SafetyScore: record?.controlledV2Snapshot?.safetyScore ?? null,
    legacyTemperature: record?.legacySnapshot?.temperature ?? null,
    v2Temperature: record?.controlledV2Snapshot?.temperature ?? null,
    legacyTint: record?.legacySnapshot?.tint ?? null,
    v2Tint: record?.controlledV2Snapshot?.tint ?? null,
    reviewedAt: record?.reviewedAt ?? null,
  };
}

/**
 * Builds the JSON export payload -- stable codes and real numbers
 * only. `session` is reduced to its own bounded field set (never
 * carries anything beyond what schema.js's `createCalibrationSession`
 * produces).
 */
export function buildExportJson(session, records) {
  const list = Array.isArray(records) ? records : [];
  return {
    exportSchemaVersion: CALIBRATION_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    session: {
      sessionId: session?.sessionId ?? null,
      createdAt: session?.createdAt ?? null,
      updatedAt: session?.updatedAt ?? null,
      locale: session?.locale ?? null,
      appVersion: session?.appVersion ?? null,
      calibrationSchemaVersion: session?.calibrationSchemaVersion ?? CALIBRATION_SCHEMA_VERSION,
      imageCount: session?.imageCount ?? list.length,
      reviewedCount: session?.reviewedCount ?? null,
      legacyWins: session?.legacyWins ?? null,
      v2Wins: session?.v2Wins ?? null,
      ties: session?.ties ?? null,
      bothRejected: session?.bothRejected ?? null,
      pendingCount: session?.pendingCount ?? null,
    },
    records: list.map(_boundedRecord),
  };
}

/** The exact required CSV column order (R1 Section 10). */
export const CSV_COLUMNS = Object.freeze([
  'sessionId', 'imageId', 'imageCategories', 'lightingCondition', 'containsSkin',
  'userDecision', 'issueCodes', 'legacyConfidence', 'v2Confidence',
  'legacySafetyScore', 'v2SafetyScore', 'legacyTemperature', 'v2Temperature',
  'legacyTint', 'v2Tint', 'reviewedAt',
]);

/**
 * Builds the CSV export string (R1 Section 10's exact required
 * columns, in order). `sessionId` is repeated on every row since CSV
 * has no nested/session-level header concept.
 */
export function buildExportCsv(session, records) {
  const list = Array.isArray(records) ? records : [];
  const sessionId = session?.sessionId ?? '';
  const rows = [CSV_COLUMNS.join(',')];
  for (const record of list) {
    const bounded = _boundedRecord(record);
    const row = {
      sessionId,
      imageId: bounded.imageId,
      imageCategories: bounded.imageCategories.join(';'),
      lightingCondition: bounded.lightingCondition,
      containsSkin: bounded.containsSkin,
      userDecision: bounded.userDecision,
      issueCodes: bounded.issueCodes.join(';'),
      legacyConfidence: bounded.legacyConfidence,
      v2Confidence: bounded.v2Confidence,
      legacySafetyScore: bounded.legacySafetyScore,
      v2SafetyScore: bounded.v2SafetyScore,
      legacyTemperature: bounded.legacyTemperature,
      v2Temperature: bounded.v2Temperature,
      legacyTint: bounded.legacyTint,
      v2Tint: bounded.v2Tint,
      reviewedAt: bounded.reviewedAt,
    };
    rows.push(CSV_COLUMNS.map(col => _csvCell(row[col])).join(','));
  }
  return rows.join('\r\n');
}
