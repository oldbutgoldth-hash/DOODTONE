/**
 * core/calibration-lab/aggregate.js
 *
 * EPIC 2E-K -- CONTROLLED V2 CALIBRATION LAB
 *
 * Pure Calibration Dashboard math (R1 Section 11). Every function here
 * takes a plain array of Semantic Image Test Records (see
 * core/calibration-lab/schema.js) and returns bounded, numeric/stable-
 * code summaries -- no DOM, no IndexedDB, no localized text. The
 * Dashboard renderer is the only place these numbers are ever
 * projected into a sentence, and per R1's explicit requirement, no
 * single aggregate number here is ever treated as a Production-
 * readiness verdict -- that judgment (with all its caveats) is
 * `readiness.js`'s job, not this module's.
 */

import { IMAGE_CATEGORIES, LIGHTING_CONDITIONS, ISSUE_CODES } from './codes.js';

const LOW_CONFIDENCE_THRESHOLD = 0.35;
const SKIN_ISSUE_CODES = new Set(['SKIN_TONE_UNNATURAL', 'SKIN_TOO_ORANGE', 'SKIN_TOO_PALE']);

function _rate(numerator, denominator) {
  if (!denominator || denominator <= 0) return null;
  return +(numerator / denominator).toFixed(4);
}

function _reviewedRecords(records) {
  return records.filter(r => r && r.userDecision && r.userDecision !== 'NOT_REVIEWED');
}

/** Top-level counts + win/tie/rejection rates (computed over REVIEWED images only -- a denominator of unreviewed images would silently understate every rate). */
export function computeDashboardSummary(records) {
  const list = Array.isArray(records) ? records : [];
  const reviewed = _reviewedRecords(list);
  const reviewedCount = reviewed.length;

  const legacyWins = reviewed.filter(r => r.userDecision === 'LEGACY_BETTER').length;
  const v2Wins = reviewed.filter(r => r.userDecision === 'V2_BETTER').length;
  const ties = reviewed.filter(r => r.userDecision === 'ABOUT_EQUAL').length;
  const bothUnacceptable = reviewed.filter(r => r.userDecision === 'BOTH_UNACCEPTABLE').length;

  return {
    totalImages: list.length,
    reviewedCount,
    pendingCount: list.length - reviewedCount,
    v2WinRate: _rate(v2Wins, reviewedCount),
    legacyWinRate: _rate(legacyWins, reviewedCount),
    tieRate: _rate(ties, reviewedCount),
    bothUnacceptableRate: _rate(bothUnacceptable, reviewedCount),
  };
}

/** Per-category breakdown -- every declared category appears even at zero count, so a Dashboard can show real gaps rather than silently omitting a category with no data yet. */
export function computeCategoryBreakdown(records) {
  const list = Array.isArray(records) ? records : [];
  const out = {};
  for (const cat of IMAGE_CATEGORIES) {
    const inCat = list.filter(r => Array.isArray(r?.imageCategories) && r.imageCategories.includes(cat));
    const reviewedInCat = _reviewedRecords(inCat);
    out[cat] = {
      totalImages: inCat.length,
      reviewedCount: reviewedInCat.length,
      v2Wins: reviewedInCat.filter(r => r.userDecision === 'V2_BETTER').length,
      legacyWins: reviewedInCat.filter(r => r.userDecision === 'LEGACY_BETTER').length,
      ties: reviewedInCat.filter(r => r.userDecision === 'ABOUT_EQUAL').length,
      bothUnacceptable: reviewedInCat.filter(r => r.userDecision === 'BOTH_UNACCEPTABLE').length,
    };
  }
  return out;
}

/** Per-lighting-condition breakdown -- same shape/rationale as the category breakdown. */
export function computeLightingBreakdown(records) {
  const list = Array.isArray(records) ? records : [];
  const out = {};
  for (const cond of LIGHTING_CONDITIONS) {
    const inCond = list.filter(r => r?.lightingCondition === cond);
    const reviewedInCond = _reviewedRecords(inCond);
    out[cond] = {
      totalImages: inCond.length,
      reviewedCount: reviewedInCond.length,
      v2Wins: reviewedInCond.filter(r => r.userDecision === 'V2_BETTER').length,
      legacyWins: reviewedInCond.filter(r => r.userDecision === 'LEGACY_BETTER').length,
    };
  }
  return out;
}

/** Issue-code frequency table, sorted most-frequent first. Every declared issue code is present (possibly at 0) so a caller never has to guess which codes were simply never selected. */
export function computeIssueFrequency(records) {
  const list = Array.isArray(records) ? records : [];
  const counts = Object.fromEntries(ISSUE_CODES.map(code => [code, 0]));
  for (const r of list) {
    if (!Array.isArray(r?.issueCodes)) continue;
    for (const code of r.issueCodes) {
      if (code in counts) counts[code] += 1;
    }
  }
  return Object.entries(counts)
    .map(([issueCode, count]) => ({ issueCode, count }))
    .sort((a, b) => b.count - a.count || a.issueCode.localeCompare(b.issueCode));
}

/**
 * Safety/quality signal counts (R1 Section 11's explicit list) -- these
 * are the counts a Readiness calculation reads; the Dashboard also
 * displays them directly so no single rolled-up score can hide them.
 */
export function computeSafetySignalCounts(records) {
  const list = Array.isArray(records) ? records : [];
  let safetyWarningCount = 0, lowConfidenceCount = 0, mixedLightFailureCount = 0, skinToneIssueCount = 0;
  for (const r of list) {
    if (r?.safetySnapshot?.severeIssueDetected === true || (r?.safetySnapshot?.v2HardStopCount ?? 0) > 0) safetyWarningCount += 1;
    const v2Confidence = r?.controlledV2Snapshot?.confidence;
    if (typeof v2Confidence === 'number' && v2Confidence < LOW_CONFIDENCE_THRESHOLD) lowConfidenceCount += 1;
    if (Array.isArray(r?.issueCodes) && r.issueCodes.includes('MIXED_LIGHT_FAILURE')) mixedLightFailureCount += 1;
    if (r?.containsSkin === true && Array.isArray(r?.issueCodes) && r.issueCodes.some(c => SKIN_ISSUE_CODES.has(c))) skinToneIssueCount += 1;
  }
  return { safetyWarningCount, lowConfidenceCount, mixedLightFailureCount, skinToneIssueCount };
}

/** Convenience wrapper bundling every Dashboard computation together (R1 Section 11). */
export function computeCalibrationDashboard(records) {
  const list = Array.isArray(records) ? records : [];
  return {
    summary: computeDashboardSummary(list),
    byCategory: computeCategoryBreakdown(list),
    byLighting: computeLightingBreakdown(list),
    issueFrequency: computeIssueFrequency(list),
    safetySignals: computeSafetySignalCounts(list),
  };
}
