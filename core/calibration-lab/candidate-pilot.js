/**
 * core/calibration-lab/candidate-pilot.js
 *
 * EPIC 2E-L -- CONTROLLED V2 CANDIDATE REVIEW PILOT
 *
 * Pure, read-only cohort analysis over Calibration Lab image records.
 * It never mutates records, never writes Production state, never emits
 * XMP/preset output, and intentionally has no PRODUCTION_READY status.
 */

import { IMAGE_CATEGORIES, LIGHTING_CONDITIONS, ISSUE_CODES } from './codes.js';
import { sha256PureJsHex } from './sha256-pure-js.js';

export const CANDIDATE_PILOT_SCHEMA_VERSION = 1;

export const CANDIDATE_PILOT_STATUSES = Object.freeze([
  'PILOT_NOT_STARTED',
  'PILOT_INSUFFICIENT_VERIFIED_SAMPLES',
  'PILOT_COVERAGE_GAPS',
  'PILOT_SAFETY_HALT',
  'PILOT_REGRESSION_HALT',
  'PILOT_NEEDS_MORE_EVIDENCE',
  'PILOT_CANDIDATE_EVALUATION_READY',
]);
export const CANDIDATE_PILOT_STATUS_SET = new Set(CANDIDATE_PILOT_STATUSES);
export const FORBIDDEN_CANDIDATE_PILOT_STATUS = 'PRODUCTION_READY';

export const CANDIDATE_PILOT_POLICY_DEFAULTS = Object.freeze({
  minVerifiedReviewedSamples: 50,
  minDecisiveSamples: 25,
  minSkinSamples: 15,
  minMixedLightSamples: 10,
  minCategoryCoverage: 5,
  minLightingCoverage: 4,
  maxSevereIssueRate: 0.05,
  maxBothUnacceptableRate: 0.10,
  maxLowConfidenceRate: 0.20,
  maxRegressionCategoryCount: 1,
  minV2NetAdvantage: 0.10,
  minV2PreferenceWilsonLowerBound: 0.45,
});

const VERIFIED_TRUTH_CODES = new Set(['BOTH_RENDERED_DIFFERENT', 'BOTH_RENDERED_IDENTITY']);
const DECISIVE_DECISIONS = new Set(['LEGACY_BETTER', 'V2_BETTER']);
const SKIN_ISSUES = new Set(['SKIN_TONE_UNNATURAL', 'SKIN_TOO_ORANGE', 'SKIN_TOO_PALE']);
const SEVERE_ISSUES = new Set(['HIGHLIGHT_LOSS', 'SHADOW_LOSS', 'MIXED_LIGHT_FAILURE', 'VISUAL_RESULT_UNSTABLE']);

function rate(n, d) {
  if (!d || d <= 0) return null;
  return +(n / d).toFixed(4);
}

function isIsoTimestamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

/**
 * Strict candidate-pilot eligibility. A record must already have a real,
 * current, browser-verified pixel pair and a human decision made against
 * that evidence. Migrated audit-only decisions never enter the cohort.
 */
export function isCandidatePilotEligibleRecord(record) {
  const ev = record?.previewEvidence;
  return Boolean(
    record &&
    record.userDecision && record.userDecision !== 'NOT_REVIEWED' &&
    record.legacyDecisionPreservedForAudit !== true &&
    record.requiresVisualReReview !== true &&
    isIsoTimestamp(record.reviewedAt) &&
    ev &&
    ev.browserVerified === true &&
    ev.visualDecisionEligible === true &&
    VERIFIED_TRUTH_CODES.has(ev.previewTruthCode) &&
    ev.sameSourceGeometry === true &&
    ev.sourceFingerprintMatch === true &&
    typeof ev.legacyPixelHash === 'string' && ev.legacyPixelHash.length === 64 &&
    typeof ev.controlledV2PixelHash === 'string' && ev.controlledV2PixelHash.length === 64 &&
    (ev.legacyNonTransparentPixelCount ?? 0) > 0 &&
    (ev.controlledV2NonTransparentPixelCount ?? 0) > 0
  );
}

export function selectCandidatePilotCohort(records) {
  return (Array.isArray(records) ? records : []).filter(isCandidatePilotEligibleRecord);
}

/** Wilson score interval for V2 preference among decisive comparisons. */
export function computeWilsonInterval(successes, trials, z = 1.96) {
  if (!Number.isFinite(successes) || !Number.isFinite(trials) || trials <= 0 || successes < 0 || successes > trials) {
    return { lower: null, upper: null };
  }
  const p = successes / trials;
  const z2 = z * z;
  const denominator = 1 + z2 / trials;
  const centre = p + z2 / (2 * trials);
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * trials)) / trials);
  return {
    lower: +((centre - margin) / denominator).toFixed(4),
    upper: +((centre + margin) / denominator).toFixed(4),
  };
}

function buildCoverage(cohort) {
  const byCategory = {};
  for (const category of IMAGE_CATEGORIES) {
    const rows = cohort.filter(r => Array.isArray(r.imageCategories) && r.imageCategories.includes(category));
    const v2Wins = rows.filter(r => r.userDecision === 'V2_BETTER').length;
    const legacyWins = rows.filter(r => r.userDecision === 'LEGACY_BETTER').length;
    byCategory[category] = {
      sampleCount: rows.length,
      v2Wins,
      legacyWins,
      netV2Wins: v2Wins - legacyWins,
      regression: rows.length >= 3 && legacyWins > v2Wins,
    };
  }
  const byLighting = {};
  for (const lighting of LIGHTING_CONDITIONS) {
    const rows = cohort.filter(r => r.lightingCondition === lighting);
    const v2Wins = rows.filter(r => r.userDecision === 'V2_BETTER').length;
    const legacyWins = rows.filter(r => r.userDecision === 'LEGACY_BETTER').length;
    byLighting[lighting] = {
      sampleCount: rows.length,
      v2Wins,
      legacyWins,
      netV2Wins: v2Wins - legacyWins,
      regression: rows.length >= 3 && legacyWins > v2Wins,
    };
  }
  return { byCategory, byLighting };
}

function buildIssueFrequency(cohort) {
  const counts = Object.fromEntries(ISSUE_CODES.map(code => [code, 0]));
  for (const record of cohort) {
    for (const code of Array.isArray(record.issueCodes) ? record.issueCodes : []) {
      if (Object.prototype.hasOwnProperty.call(counts, code)) counts[code] += 1;
    }
  }
  return Object.entries(counts)
    .map(([issueCode, count]) => ({ issueCode, count }))
    .sort((a, b) => b.count - a.count || a.issueCode.localeCompare(b.issueCode));
}

function cohortFingerprint(cohort) {
  const canonical = cohort
    .map(record => ({
      imageId: record.imageId,
      imageFingerprint: record.imageFingerprint,
      analysisGenerationId: record.analysisGenerationId,
      userDecision: record.userDecision,
      issueCodes: [...(record.issueCodes || [])].sort(),
      reviewedAt: record.reviewedAt,
      legacyPixelHash: record.previewEvidence?.legacyPixelHash,
      controlledV2PixelHash: record.previewEvidence?.controlledV2PixelHash,
    }))
    .sort((a, b) => String(a.imageId).localeCompare(String(b.imageId)));
  return sha256PureJsHex(new TextEncoder().encode(JSON.stringify(canonical)));
}

export function computeCandidatePilotReport(records, policy = CANDIDATE_PILOT_POLICY_DEFAULTS, meta = {}) {
  const allRecords = Array.isArray(records) ? records : [];
  const cohort = selectCandidatePilotCohort(allRecords);
  const decisive = cohort.filter(r => DECISIVE_DECISIONS.has(r.userDecision));
  const v2Wins = cohort.filter(r => r.userDecision === 'V2_BETTER').length;
  const legacyWins = cohort.filter(r => r.userDecision === 'LEGACY_BETTER').length;
  const ties = cohort.filter(r => r.userDecision === 'ABOUT_EQUAL').length;
  const bothUnacceptable = cohort.filter(r => r.userDecision === 'BOTH_UNACCEPTABLE').length;
  const notSure = cohort.filter(r => r.userDecision === 'NOT_SURE').length;

  const skinSamples = cohort.filter(r => r.containsSkin === true).length;
  const mixedLightSamples = cohort.filter(r => r.lightingCondition === 'MIXED' || r.imageCategories?.includes('MIXED_LIGHT')).length;
  const coverage = buildCoverage(cohort);
  const categoriesPresent = IMAGE_CATEGORIES.filter(code => coverage.byCategory[code].sampleCount > 0);
  const lightingPresent = LIGHTING_CONDITIONS.filter(code => coverage.byLighting[code].sampleCount > 0);
  const regressionCategories = IMAGE_CATEGORIES.filter(code => coverage.byCategory[code].regression);
  const regressionLighting = LIGHTING_CONDITIONS.filter(code => coverage.byLighting[code].regression);

  const severeRecords = cohort.filter(r => r.safetySnapshot?.severeIssueDetected === true || (r.issueCodes || []).some(code => SEVERE_ISSUES.has(code)));
  const safetyHardStopRecords = cohort.filter(r => (r.safetySnapshot?.v2HardStopCount ?? 0) > 0);
  const lowConfidenceRecords = cohort.filter(r => typeof r.controlledV2Snapshot?.confidence === 'number' && r.controlledV2Snapshot.confidence < 0.35);
  const skinIssueRecords = cohort.filter(r => r.containsSkin === true && (r.issueCodes || []).some(code => SKIN_ISSUES.has(code)));

  const v2PreferenceWilson = computeWilsonInterval(v2Wins, decisive.length);
  const v2WinRate = rate(v2Wins, cohort.length);
  const legacyWinRate = rate(legacyWins, cohort.length);
  const v2NetAdvantage = v2WinRate === null || legacyWinRate === null ? null : +(v2WinRate - legacyWinRate).toFixed(4);
  const severeIssueRate = rate(severeRecords.length, cohort.length);
  const bothUnacceptableRate = rate(bothUnacceptable, cohort.length);
  const lowConfidenceRate = rate(lowConfidenceRecords.length, cohort.length);

  const criteria = {
    verifiedReviewedSamples: { value: cohort.length, threshold: policy.minVerifiedReviewedSamples, met: cohort.length >= policy.minVerifiedReviewedSamples },
    decisiveSamples: { value: decisive.length, threshold: policy.minDecisiveSamples, met: decisive.length >= policy.minDecisiveSamples },
    skinSamples: { value: skinSamples, threshold: policy.minSkinSamples, met: skinSamples >= policy.minSkinSamples },
    mixedLightSamples: { value: mixedLightSamples, threshold: policy.minMixedLightSamples, met: mixedLightSamples >= policy.minMixedLightSamples },
    categoryCoverage: { value: categoriesPresent.length, threshold: policy.minCategoryCoverage, met: categoriesPresent.length >= policy.minCategoryCoverage },
    lightingCoverage: { value: lightingPresent.length, threshold: policy.minLightingCoverage, met: lightingPresent.length >= policy.minLightingCoverage },
    severeIssueRate: { value: severeIssueRate, threshold: policy.maxSevereIssueRate, met: severeIssueRate !== null && severeIssueRate <= policy.maxSevereIssueRate },
    bothUnacceptableRate: { value: bothUnacceptableRate, threshold: policy.maxBothUnacceptableRate, met: bothUnacceptableRate !== null && bothUnacceptableRate <= policy.maxBothUnacceptableRate },
    lowConfidenceRate: { value: lowConfidenceRate, threshold: policy.maxLowConfidenceRate, met: lowConfidenceRate !== null && lowConfidenceRate <= policy.maxLowConfidenceRate },
    regressionCategoryCount: { value: regressionCategories.length, threshold: policy.maxRegressionCategoryCount, met: regressionCategories.length <= policy.maxRegressionCategoryCount },
    v2NetAdvantage: { value: v2NetAdvantage, threshold: policy.minV2NetAdvantage, met: v2NetAdvantage !== null && v2NetAdvantage >= policy.minV2NetAdvantage },
    v2PreferenceWilsonLowerBound: { value: v2PreferenceWilson.lower, threshold: policy.minV2PreferenceWilsonLowerBound, met: v2PreferenceWilson.lower !== null && v2PreferenceWilson.lower >= policy.minV2PreferenceWilsonLowerBound },
    noSafetyHardStops: { value: safetyHardStopRecords.length, threshold: 0, met: safetyHardStopRecords.length === 0 },
  };

  let pilotStatus;
  if (cohort.length === 0) {
    pilotStatus = 'PILOT_NOT_STARTED';
  } else if (!criteria.verifiedReviewedSamples.met || !criteria.decisiveSamples.met) {
    pilotStatus = 'PILOT_INSUFFICIENT_VERIFIED_SAMPLES';
  } else if (!criteria.skinSamples.met || !criteria.mixedLightSamples.met || !criteria.categoryCoverage.met || !criteria.lightingCoverage.met) {
    pilotStatus = 'PILOT_COVERAGE_GAPS';
  } else if (!criteria.noSafetyHardStops.met || !criteria.severeIssueRate.met || !criteria.bothUnacceptableRate.met) {
    pilotStatus = 'PILOT_SAFETY_HALT';
  } else if (!criteria.regressionCategoryCount.met) {
    pilotStatus = 'PILOT_REGRESSION_HALT';
  } else if (!criteria.lowConfidenceRate.met || !criteria.v2NetAdvantage.met || !criteria.v2PreferenceWilsonLowerBound.met) {
    pilotStatus = 'PILOT_NEEDS_MORE_EVIDENCE';
  } else {
    pilotStatus = 'PILOT_CANDIDATE_EVALUATION_READY';
  }

  const missingCategories = IMAGE_CATEGORIES.filter(code => coverage.byCategory[code].sampleCount === 0);
  const missingLighting = LIGHTING_CONDITIONS.filter(code => coverage.byLighting[code].sampleCount === 0);

  return {
    pilotSchemaVersion: CANDIDATE_PILOT_SCHEMA_VERSION,
    generatedAt: typeof meta.generatedAt === 'string' ? meta.generatedAt : new Date().toISOString(),
    sourceSessionId: typeof meta.sourceSessionId === 'string' ? meta.sourceSessionId : null,
    cohortHash: cohortFingerprint(cohort),
    pilotStatus,
    totalRecords: allRecords.length,
    verifiedReviewedSamples: cohort.length,
    excludedRecordCount: allRecords.length - cohort.length,
    decisiveSamples: decisive.length,
    v2Wins, legacyWins, ties, bothUnacceptable, notSure,
    v2WinRate, legacyWinRate, v2NetAdvantage,
    v2PreferenceWilson,
    skinSamples, mixedLightSamples,
    categoryCoverage: categoriesPresent.length,
    lightingCoverage: lightingPresent.length,
    missingCategories,
    missingLighting,
    severeIssueCount: severeRecords.length,
    severeIssueRate,
    safetyHardStopCount: safetyHardStopRecords.length,
    bothUnacceptableRate,
    lowConfidenceCount: lowConfidenceRecords.length,
    lowConfidenceRate,
    skinIssueCount: skinIssueRecords.length,
    regressionCategoryCount: regressionCategories.length,
    regressionCategories,
    regressionLighting,
    coverage,
    issueFrequency: buildIssueFrequency(cohort),
    criteria,
    cohortRecordIds: cohort.map(r => r.imageId),
    productionLocks: Object.freeze({
      productionSource: 'legacy',
      productionWrite: false,
      controlledV2Apply: false,
      previewExport: false,
      controlledV2ProductionActivation: false,
    }),
    disclaimerCode: 'CANDIDATE_PILOT_PREVIEW_ONLY_NOT_PRODUCTION',
  };
}

export function isCandidatePilotReportProductionSafe(report) {
  return Boolean(
    report &&
    CANDIDATE_PILOT_STATUS_SET.has(report.pilotStatus) &&
    report.pilotStatus !== FORBIDDEN_CANDIDATE_PILOT_STATUS &&
    report.productionLocks?.productionSource === 'legacy' &&
    report.productionLocks?.productionWrite === false &&
    report.productionLocks?.controlledV2Apply === false &&
    report.productionLocks?.previewExport === false &&
    report.productionLocks?.controlledV2ProductionActivation === false
  );
}
