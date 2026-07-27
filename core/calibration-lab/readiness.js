/**
 * core/calibration-lab/readiness.js
 *
 * EPIC 2E-K -- CONTROLLED V2 CALIBRATION LAB
 *
 * Calibration Policy (R1 Section 13) + Controlled V2 Readiness Report
 * (R1 Section 12). Pure functions over an array of Semantic Image Test
 * Records -- reuses `aggregate.js`'s own math rather than re-deriving
 * win/tie/rate numbers a second, possibly-inconsistent way.
 *
 * CRITICAL SAFETY PROPERTY: this module's output is INFORMATIONAL
 * ONLY. `computeReadinessReport()` never reads, writes, or returns any
 * Production flag (`allowProductionWrite`, `allowExport`,
 * `controlledV2ProductionActivation`, etc.), and its `readinessStatus`
 * can NEVER be the forbidden `PRODUCTION_READY` value -- the strongest
 * status this module is even capable of returning is
 * `READY_FOR_CANDIDATE_REVIEW`, which still requires a human to look at
 * the evidence and decide; nothing in this file can flip a Production
 * switch, no matter how good the numbers look.
 */

import { IMAGE_CATEGORIES, LIGHTING_CONDITIONS } from './codes.js';
import { computeDashboardSummary, computeCategoryBreakdown, computeLightingBreakdown, computeSafetySignalCounts } from './aggregate.js';

/** Calibration Policy default thresholds (R1 Section 13). Every threshold here is advisory evidence for a human reviewer -- see the module-level note above. */
export const CALIBRATION_POLICY_DEFAULTS = Object.freeze({
  minReviewedSamples: 50,
  minSkinImages: 15,
  minMixedLightImages: 10,
  minCategoryCoverage: 5,
  maxSevereIssueRate: 0.05,
  // "Safety Warning Rate must not be higher than Legacy" is expressed
  // as a ratio cap of 1.0 (V2 rate <= Legacy rate) rather than a fixed
  // number, per the spec's own relative wording.
  maxSafetyWarningRateVsLegacyRatio: 1.0,
  minInsufficientDataFloor: 10,
  // EPIC 2E-K-R2-FIX1 -- Section 4 (Readiness Honesty): the minimum
  // share of ALL images in the dataset (not just reviewed ones) that
  // must carry genuinely browser-verified, visually-decision-eligible
  // pixel evidence before Readiness will even consider looking at
  // win-rate numbers. A dataset mostly full of NOT_RENDERED/failed
  // evidence must never reach a "promising" verdict just because the
  // few eligible records happen to look good.
  minPixelPreviewCoverage: 0.8,
});

function _rate(numerator, denominator) {
  if (!denominator || denominator <= 0) return null;
  return +(numerator / denominator).toFixed(4);
}

function _reviewed(records) {
  // Mirrors aggregate.js's own exclusion -- a V1-migrated,
  // audit-only-preserved decision is never treated as a genuine,
  // evidence-backed review for Readiness purposes (Section 4/5).
  return (Array.isArray(records) ? records : []).filter(r => r && r.userDecision && r.userDecision !== 'NOT_REVIEWED' && r.legacyDecisionPreservedForAudit !== true);
}

/** Every record whose previewEvidence.visualDecisionEligible is true, regardless of review state -- the denominator/numerator basis for `pixelPreviewCoverage`/`visualDecisionEligibleCount` (Section 4). */
function _visuallyEligible(records) {
  return (Array.isArray(records) ? records : []).filter(r => r?.previewEvidence?.visualDecisionEligible === true);
}

/** Records that STILL need a human to look at them again after a V1->V2 migration (Section 5) -- these must block READY_FOR_CANDIDATE_REVIEW until re-reviewed, even if every other number looks fine. */
function _pendingReReview(records) {
  return (Array.isArray(records) ? records : []).filter(r => r?.requiresVisualReReview === true);
}

/** Counts of each previewTruthCode across ALL records (Section 4's required counters) -- deliberately over every record, not just reviewed ones, so a caller can see the full evidence-quality picture regardless of review state. */
function _previewTruthCounts(records) {
  const list = Array.isArray(records) ? records : [];
  const counts = {
    verifiedDifferentCount: 0, verifiedIdentityCount: 0, renderFailureCount: 0,
    emptyV2CanvasCount: 0, geometryMismatchCount: 0, sourceMismatchCount: 0, staleGenerationCount: 0,
  };
  for (const r of list) {
    const code = r?.previewEvidence?.previewTruthCode;
    if (code === 'BOTH_RENDERED_DIFFERENT') counts.verifiedDifferentCount += 1;
    else if (code === 'BOTH_RENDERED_IDENTITY') counts.verifiedIdentityCount += 1;
    else if (code === 'LEGACY_RENDER_FAILED' || code === 'V2_RENDER_FAILED') counts.renderFailureCount += 1;
    else if (code === 'V2_EMPTY_CANVAS') counts.emptyV2CanvasCount += 1;
    else if (code === 'GEOMETRY_MISMATCH') counts.geometryMismatchCount += 1;
    else if (code === 'SOURCE_MISMATCH') counts.sourceMismatchCount += 1;
    else if (code === 'STALE_GENERATION') counts.staleGenerationCount += 1;
  }
  return counts;
}

/** Distinct categories/lighting conditions that have at least one image recorded (any review state). */
function _coverageCounts(records) {
  const byCategory = computeCategoryBreakdown(records);
  const byLighting = computeLightingBreakdown(records);
  const categoriesPresent = IMAGE_CATEGORIES.filter(cat => byCategory[cat].totalImages > 0);
  const lightingPresent = LIGHTING_CONDITIONS.filter(cond => byLighting[cond].totalImages > 0);
  const missingCoverageCategories = IMAGE_CATEGORIES.filter(cat => byCategory[cat].totalImages === 0);
  return { categoriesPresent, lightingPresent, missingCoverageCategories, byCategory, byLighting };
}

/** Number of categories where, among reviewed images in that category, Legacy won strictly more often than V2 -- a per-category regression signal separate from the single overall win-rate number. */
function _regressionCategoryCount(byCategory) {
  let count = 0;
  for (const cat of IMAGE_CATEGORIES) {
    const c = byCategory[cat];
    if (c.reviewedCount > 0 && c.legacyWins > c.v2Wins) count += 1;
  }
  return count;
}

/**
 * Evaluates the Calibration Policy thresholds against the current
 * dataset -- returns which criteria are currently met, purely as
 * informational evidence. Never gates or activates anything.
 */
export function evaluateCalibrationPolicy(records, policy = CALIBRATION_POLICY_DEFAULTS) {
  const list = Array.isArray(records) ? records : [];
  const reviewed = _reviewed(list);
  const skinImages = list.filter(r => r?.containsSkin === true).length;
  const mixedLightImages = list.filter(r => r?.lightingCondition === 'MIXED' || (Array.isArray(r?.imageCategories) && r.imageCategories.includes('MIXED_LIGHT'))).length;
  const { categoriesPresent } = _coverageCounts(list);

  const severeCount = reviewed.filter(r => r?.safetySnapshot?.severeIssueDetected === true).length;
  const severeIssueRate = _rate(severeCount, reviewed.length);

  const v2WarningCount = reviewed.filter(r => (r?.safetySnapshot?.v2HardStopCount ?? 0) > 0 || r?.safetySnapshot?.severeIssueDetected === true).length;
  const legacyWarningCount = reviewed.filter(r => (r?.safetySnapshot?.legacySafetyWarningCount ?? 0) > 0).length;
  const v2SafetyWarningRate = _rate(v2WarningCount, reviewed.length);
  const legacySafetyWarningRate = _rate(legacyWarningCount, reviewed.length);

  const { v2WinRate, legacyWinRate } = computeDashboardSummary(list);

  const criteria = {
    reviewedSamples: { value: reviewed.length, threshold: policy.minReviewedSamples, met: reviewed.length >= policy.minReviewedSamples },
    skinImages: { value: skinImages, threshold: policy.minSkinImages, met: skinImages >= policy.minSkinImages },
    mixedLightImages: { value: mixedLightImages, threshold: policy.minMixedLightImages, met: mixedLightImages >= policy.minMixedLightImages },
    categoryCoverage: { value: categoriesPresent.length, threshold: policy.minCategoryCoverage, met: categoriesPresent.length >= policy.minCategoryCoverage },
    severeIssueRate: { value: severeIssueRate, threshold: policy.maxSevereIssueRate, met: severeIssueRate !== null && severeIssueRate <= policy.maxSevereIssueRate },
    safetyWarningRateNotWorseThanLegacy: {
      value: v2SafetyWarningRate, legacyValue: legacySafetyWarningRate,
      met: v2SafetyWarningRate === null || legacySafetyWarningRate === null || v2SafetyWarningRate <= legacySafetyWarningRate * policy.maxSafetyWarningRateVsLegacyRatio,
    },
    v2WinRateAboveLegacy: { value: v2WinRate, legacyValue: legacyWinRate, met: v2WinRate !== null && legacyWinRate !== null && v2WinRate > legacyWinRate },
  };

  const allMet = Object.values(criteria).every(c => c.met === true);
  return { criteria, allCriteriaMet: allMet };
}

/**
 * Controlled V2 Readiness Report (R1 Section 12). `readinessStatus` is
 * always one of the five permitted stable codes in codes.js -- never
 * `PRODUCTION_READY`, and never used to set any Production flag.
 */
export function computeReadinessReport(records, policy = CALIBRATION_POLICY_DEFAULTS) {
  const list = Array.isArray(records) ? records : [];
  const reviewed = _reviewed(list);
  const { categoriesPresent, lightingPresent, missingCoverageCategories, byCategory } = _coverageCounts(list);
  const safetySignals = computeSafetySignalCounts(list);
  const { v2WinRate, legacyWinRate } = computeDashboardSummary(list);
  const policyEval = evaluateCalibrationPolicy(list, policy);

  const severeCount = reviewed.filter(r => r?.safetySnapshot?.severeIssueDetected === true).length;
  const severeIssueRate = _rate(severeCount, reviewed.length);
  const lowConfidenceRate = _rate(safetySignals.lowConfidenceCount, reviewed.length);
  const safetyWarningRate = policyEval.criteria.safetyWarningRateNotWorseThanLegacy.value;
  const regressionCategoryCount = _regressionCategoryCount(byCategory);

  // EPIC 2E-K-R2-FIX1 -- Section 4 (Readiness Honesty): every one of
  // these fields is computed straight from `previewEvidence`/migration
  // audit flags, never assumed. `browserSuiteVerified` is TRUE only
  // when every eligible record's evidence was genuinely captured
  // through the real browser pixel-truth chain (never a record where
  // that could not be independently confirmed).
  const eligibleRecords = _visuallyEligible(list);
  const visualDecisionEligibleCount = eligibleRecords.length;
  const pixelPreviewCoverage = _rate(visualDecisionEligibleCount, list.length);
  const browserSuiteVerified = eligibleRecords.length > 0 && eligibleRecords.every(r => r?.previewEvidence?.browserVerified === true);
  const unverifiedLegacyRecordCount = _pendingReReview(list).length;
  const previewTruthCounts = _previewTruthCounts(list);

  let readinessStatus;
  if (reviewed.length < policy.minInsufficientDataFloor) {
    readinessStatus = 'INSUFFICIENT_DATA';
  } else if (unverifiedLegacyRecordCount > 0) {
    // Section 5: any V1-migrated record still awaiting a genuine
    // re-review means the dataset's honest picture is incomplete --
    // this is checked BEFORE browser/pixel-coverage checks because a
    // migrated record has, by construction, neither.
    readinessStatus = 'NEEDS_REVIEW_REFRESH';
  } else if (!browserSuiteVerified) {
    readinessStatus = 'NEEDS_BROWSER_VERIFICATION';
  } else if (pixelPreviewCoverage === null || pixelPreviewCoverage < policy.minPixelPreviewCoverage) {
    readinessStatus = 'NEEDS_PIXEL_PREVIEW';
  } else if (
    !policyEval.criteria.reviewedSamples.met ||
    !policyEval.criteria.skinImages.met ||
    !policyEval.criteria.mixedLightImages.met ||
    !policyEval.criteria.categoryCoverage.met
  ) {
    readinessStatus = 'NEEDS_MORE_COVERAGE';
  } else if (
    !policyEval.criteria.severeIssueRate.met ||
    !policyEval.criteria.safetyWarningRateNotWorseThanLegacy.met
  ) {
    readinessStatus = 'NEEDS_CALIBRATION';
  } else if (!policyEval.criteria.v2WinRateAboveLegacy.met) {
    readinessStatus = 'PROMISING_NOT_READY';
  } else {
    readinessStatus = 'READY_FOR_CANDIDATE_REVIEW';
  }

  return {
    sampleCount: reviewed.length,
    categoryCoverage: categoriesPresent.length,
    lightingCoverage: lightingPresent.length,
    v2WinRate, legacyWinRate,
    severeIssueRate, safetyWarningRate, lowConfidenceRate,
    regressionCategoryCount,
    missingCoverageCategories,
    // EPIC 2E-K-R2-FIX1 -- Section 4's required counters.
    browserSuiteVerified,
    visualDecisionEligibleCount,
    pixelPreviewCoverage,
    unverifiedLegacyRecordCount,
    ...previewTruthCounts,
    readinessStatus,
    // Full policy evaluation is carried through so a caller/UI can show
    // exactly which criteria drove the status, never just the label.
    policyEvaluation: policyEval,
  };
}
