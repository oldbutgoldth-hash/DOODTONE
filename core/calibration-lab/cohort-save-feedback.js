/**
 * EPIC 2E-M -- GUIDED COHORT INTAKE
 *
 * Pure helpers for turning an already-persisted human review into a
 * semantic save receipt and for locating the next unreviewed image.
 * No DOM, no storage writes, no Production/XMP behavior.
 */

import { computeCandidatePilotReport, isCandidatePilotEligibleRecord } from './candidate-pilot.js';

export const COHORT_SAVE_RESULT_CODES = Object.freeze([
  'DECISION_SAVED_TO_COHORT',
  'DECISION_SAVED_EXCLUDED',
  'CURRENT_ANSWER_CLEARED',
  'IMAGE_ADDED_TO_SESSION',
]);

export function findNextPendingIndex(records, currentIndex = -1) {
  const rows = Array.isArray(records) ? records : [];
  if (rows.length === 0) return -1;
  const start = Number.isInteger(currentIndex) ? currentIndex : -1;
  for (let offset = 1; offset <= rows.length; offset += 1) {
    const index = ((start + offset) % rows.length + rows.length) % rows.length;
    if (rows[index]?.userDecision === 'NOT_REVIEWED') return index;
  }
  return -1;
}

export function buildCohortSaveReceipt(record, records, { savedAt = new Date().toISOString() } = {}) {
  const rows = Array.isArray(records) ? records : [];
  const includedInCohort = isCandidatePilotEligibleRecord(record);
  const report = computeCandidatePilotReport(rows);
  const reviewedCount = rows.filter(row => row?.userDecision && row.userDecision !== 'NOT_REVIEWED').length;
  const pendingCount = rows.filter(row => !row?.userDecision || row.userDecision === 'NOT_REVIEWED').length;
  return Object.freeze({
    code: includedInCohort ? 'DECISION_SAVED_TO_COHORT' : 'DECISION_SAVED_EXCLUDED',
    imageId: record?.imageId ?? null,
    includedInCohort,
    userDecision: record?.userDecision ?? 'NOT_REVIEWED',
    reviewedCount,
    pendingCount,
    totalCount: rows.length,
    candidatePilotVerifiedSampleCount: report.verifiedReviewedSamples,
    targetVerifiedSamples: report.criteria?.verifiedReviewedSamples?.threshold ?? null,
    pilotStatus: report.pilotStatus,
    savedAt,
    productionSource: 'legacy',
    productionWrite: false,
    controlledV2Apply: false,
    previewExport: false,
  });
}
