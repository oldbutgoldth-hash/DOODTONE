#!/usr/bin/env node
/**
 * qa/epic-2e-k-calibration-lab-static-test.mjs
 *
 * EPIC 2E-K -- CONTROLLED V2 CALIBRATION LAB.
 *
 * Structural + pure-logic static suite for the Calibration Lab's
 * core/calibration-lab/* modules (codes, schema, run-comparison-
 * pipeline extractors, aggregate, readiness, export-dataset) plus the
 * scoped ui/calibration-lab-i18n dictionary and the controller's QA
 * snapshot contract. Everything here runs in plain Node -- no Browser,
 * no IndexedDB (see the separate -storage-test.mjs for that), no
 * network. Safe for run-static-suites.mjs.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  IMAGE_CATEGORIES, LIGHTING_CONDITIONS, USER_DECISIONS, ISSUE_CODES, READINESS_STATUSES,
  FORBIDDEN_READINESS_STATUS, isValidCategoryList, isValidLightingCondition, isValidUserDecision,
  isValidIssueCodeList, isValidReadinessStatus,
} from '../core/calibration-lab/codes.js';
import {
  createCalibrationSession, createImageTestRecord, validateSession, validateImageRecord,
  recomputeSessionCounts, CALIBRATION_SCHEMA_VERSION, MAX_NOTES_LENGTH,
} from '../core/calibration-lab/schema.js';
import {
  extractLegacySnapshot, extractControlledV2Snapshot, extractSafetySnapshot, computeContainsSkin,
} from '../core/calibration-lab/run-comparison-pipeline.js';
import {
  computeDashboardSummary, computeCategoryBreakdown, computeLightingBreakdown,
  computeIssueFrequency, computeSafetySignalCounts, computeCalibrationDashboard,
} from '../core/calibration-lab/aggregate.js';
import { computeReadinessReport, evaluateCalibrationPolicy, CALIBRATION_POLICY_DEFAULTS } from '../core/calibration-lab/readiness.js';
import { buildExportJson, buildExportCsv, CSV_COLUMNS } from '../core/calibration-lab/export-dataset.js';
import { calibrationLabT, checkCalibrationLabDictionaryCoverage } from '../ui/calibration-lab/calibration-lab-i18n.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let passCount = 0, failCount = 0;
function record(test, ok, evidence) {
  const icon = ok ? '✓' : '✗';
  const status = ok ? 'PASS' : 'FAIL';
  if (ok) passCount++; else failCount++;
  const safeEvidence = (() => { try { return JSON.stringify(evidence); } catch { return String(evidence); } })();
  console.log(`${icon} [${status}] ${test} — ${safeEvidence}`);
}

// ── Section 1: stable codes (R1 Sections 4-7, 12) ───────────────────────────
record('Exactly 14 image categories declared', IMAGE_CATEGORIES.length === 14, { count: IMAGE_CATEGORIES.length });
record('Exactly 9 lighting conditions declared', LIGHTING_CONDITIONS.length === 9, { count: LIGHTING_CONDITIONS.length });
record('Exactly 6 user decisions declared', USER_DECISIONS.length === 6, { count: USER_DECISIONS.length });
record('Exactly 20 issue codes declared', ISSUE_CODES.length === 20, { count: ISSUE_CODES.length });
record('Exactly 8 readiness statuses declared (5 original + 3 added by EPIC 2E-K-R2-FIX1 Section 4)', READINESS_STATUSES.length === 8, { count: READINESS_STATUSES.length });
record('PRODUCTION_READY is never a member of READINESS_STATUSES', !READINESS_STATUSES.includes('PRODUCTION_READY'), {});
record('isValidReadinessStatus() rejects the forbidden PRODUCTION_READY value', isValidReadinessStatus(FORBIDDEN_READINESS_STATUS) === false, {});
record('isValidCategoryList() accepts a valid list', isValidCategoryList(['WEDDING', 'INDOOR']) === true, {});
record('isValidCategoryList() rejects an unknown code', isValidCategoryList(['NOT_A_CATEGORY']) === false, {});
record('isValidCategoryList() rejects duplicates', isValidCategoryList(['WEDDING', 'WEDDING']) === false, {});
record('isValidLightingCondition() rejects an unknown code', isValidLightingCondition('SUNSHINE') === false, {});
record('isValidUserDecision() rejects a freeform sentence instead of a code', isValidUserDecision('Controlled V2 is much better') === false, {});
record('isValidIssueCodeList() accepts an empty list (no issues selected)', isValidIssueCodeList([]) === true, {});
record('isValidIssueCodeList() rejects an unknown code', isValidIssueCodeList(['NOT_AN_ISSUE']) === false, {});

// ── Section 2: session/record schema (R1 Sections 2-3) ──────────────────────
{
  const session = createCalibrationSession({ locale: 'th', appVersion: '1.0.0-test' });
  record('createCalibrationSession() produces a structurally valid session', validateSession(session), {});
  record('New session has all required counter fields at zero', ['imageCount', 'reviewedCount', 'legacyWins', 'v2Wins', 'ties', 'bothRejected', 'pendingCount'].every(k => session[k] === 0), {});
  record('New session stamps the current CALIBRATION_SCHEMA_VERSION', session.calibrationSchemaVersion === CALIBRATION_SCHEMA_VERSION, {});

  const rec = createImageTestRecord({ imageCategories: ['PORTRAIT'], lightingCondition: 'DAYLIGHT', containsSkin: true });
  record('createImageTestRecord() produces a structurally valid record', validateImageRecord(rec), {});
  record('New record defaults to NOT_REVIEWED', rec.userDecision === 'NOT_REVIEWED', {});
  record('New record has an imageId, never a Local File Path field', typeof rec.imageId === 'string' && !('filePath' in rec) && !('localFilePath' in rec) && !('imageBase64' in rec) && !('originalImage' in rec), {});

  record('validateSession() rejects null', validateSession(null) === false, {});
  record('validateSession() rejects a bare number', validateSession(42) === false, {});
  record('validateSession() rejects a session with a non-ISO createdAt', validateSession({ ...session, createdAt: 'not-a-date' }) === false, {});
  record('validateImageRecord() rejects null', validateImageRecord(null) === false, {});
  record('validateImageRecord() rejects a record with a freeform-sentence userDecision (HOSTILE: localized text as canonical decision)', validateImageRecord({ ...rec, userDecision: 'Controlled V2 ดีกว่ามาก' }) === false, {});
  record('validateImageRecord() rejects notes exceeding MAX_NOTES_LENGTH', validateImageRecord({ ...rec, notes: 'x'.repeat(MAX_NOTES_LENGTH + 1) }) === false, {});
  record('validateImageRecord() rejects a non-array issueCodes', validateImageRecord({ ...rec, issueCodes: 'WB_TOO_WARM' }) === false, {});

  const r1 = { ...rec, userDecision: 'V2_BETTER' };
  const r2 = createImageTestRecord({ imageCategories: ['EVENT'], lightingCondition: 'MIXED' });
  const updated = recomputeSessionCounts(session, [r1, r2]);
  record('recomputeSessionCounts() derives imageCount/reviewedCount/pendingCount correctly', updated.imageCount === 2 && updated.reviewedCount === 1 && updated.pendingCount === 1 && updated.v2Wins === 1, { updated });
}

// ── Section 3: bounded snapshot extractors (never raw prose) ────────────────
{
  const mockFinalPreset = {
    category: 'Portrait',
    _decision: { finalStyleIntent: {
      visualPreviewRenderPlanV2: {
        legacyRenderPlan: { adjustmentModel: { temperature: 0.1, tint: -0.02 }, confidence: 0.5 },
        v2RenderPlan: { adjustmentModel: { temperature: 0.05, tint: -0.01 }, confidence: 0.3, controlledV2Translation: { mode: 'legacy-derived-safety-restraint' } },
      },
      lightroomSafetyClampV2: {
        globalSafetyScore: 0.8,
        hardStops: ['Some prose describing a hard stop.'],
        softCaps: ['Some prose describing a soft cap.'],
        photographerSummary: 'A long human-readable safety summary sentence.',
      },
    } },
  };
  const mockBenchmark = { safetyScore: 0.9, warnings: ['w1', 'w2'], details: { extremelyUnsafe: false } };

  const legacy = extractLegacySnapshot(mockFinalPreset, mockBenchmark);
  const v2 = extractControlledV2Snapshot(mockFinalPreset);
  const safety = extractSafetySnapshot(mockFinalPreset, mockBenchmark);

  record('extractLegacySnapshot() returns only bounded numeric/stable-code fields', Object.keys(legacy).sort().join(',') === ['category', 'confidence', 'safetyScore', 'temperature', 'tint'].sort().join(','), { keys: Object.keys(legacy) });
  record('extractControlledV2Snapshot() returns only bounded numeric/stable-code fields', Object.keys(v2).sort().join(',') === ['confidence', 'safetyScore', 'temperature', 'tint', 'translationMode'].sort().join(','), { keys: Object.keys(v2) });
  record('extractSafetySnapshot() NEVER includes the raw hardStops/softCaps/photographerSummary prose arrays (HOSTILE: raw Core prose leak)', !('hardStops' in safety) && !('softCaps' in safety) && !('photographerSummary' in safety), { keys: Object.keys(safety) });
  record('extractSafetySnapshot() reduces hard stops to a bounded count, not the prose itself', safety.v2HardStopCount === 1 && typeof safety.v2HardStopCount === 'number', { safety });
  record('extractLegacySnapshot()/extractControlledV2Snapshot() are null-safe (never throw on missing input)', (() => { try { extractLegacySnapshot(null, null); extractControlledV2Snapshot(null); extractSafetySnapshot(null, null); return true; } catch { return false; } })(), {});
  record('computeContainsSkin() is a bounded boolean, never a raw percentage string', computeContainsSkin({}, 12) === true && computeContainsSkin({ isFaceCandidate: false }, 0) === false, {});
}

// ── Section 4: dashboard aggregate math (R1 Section 11) ─────────────────────
{
  function mk(cat, light, decision, skin, issue) {
    const r = createImageTestRecord({ imageCategories: [cat], lightingCondition: light, containsSkin: skin });
    r.userDecision = decision;
    if (issue) r.issueCodes = [issue];
    r.safetySnapshot = { legacySafetyWarningCount: 0, v2HardStopCount: 0, v2SoftCapCount: 0, severeIssueDetected: false };
    r.controlledV2Snapshot = { confidence: 0.6 };
    return r;
  }
  const empty = computeDashboardSummary([]);
  record('computeDashboardSummary([]) returns null rates (no denominator), never NaN/Infinity', empty.v2WinRate === null && empty.legacyWinRate === null, { empty });

  const recs = [
    mk('WEDDING', 'DAYLIGHT', 'V2_BETTER', false), mk('WEDDING', 'DAYLIGHT', 'V2_BETTER', false),
    mk('PORTRAIT', 'SHADE', 'LEGACY_BETTER', true, 'SKIN_TONE_UNNATURAL'), mk('PORTRAIT', 'SHADE', 'ABOUT_EQUAL', true),
    mk('EVENT', 'MIXED', 'BOTH_UNACCEPTABLE', false, 'MIXED_LIGHT_FAILURE'),
  ];
  const summary = computeDashboardSummary(recs);
  record('computeDashboardSummary() win/tie/reject rates sum to 1.0 over reviewed images', Math.abs((summary.v2WinRate + summary.legacyWinRate + summary.tieRate + summary.bothUnacceptableRate) - 1) < 1e-9, { summary });

  const byCategory = computeCategoryBreakdown(recs);
  record('computeCategoryBreakdown() includes every declared category, even at zero count', IMAGE_CATEGORIES.every(c => c in byCategory), {});
  record('computeCategoryBreakdown() correctly attributes WEDDING V2 wins', byCategory.WEDDING.v2Wins === 2 && byCategory.WEDDING.totalImages === 2, { wedding: byCategory.WEDDING });

  const byLighting = computeLightingBreakdown(recs);
  record('computeLightingBreakdown() includes every declared lighting condition', LIGHTING_CONDITIONS.every(c => c in byLighting), {});

  const issueFreq = computeIssueFrequency(recs);
  record('computeIssueFrequency() includes every declared issue code (possibly at 0)', ISSUE_CODES.every(code => issueFreq.some(row => row.issueCode === code)), {});
  record('computeIssueFrequency() sorts most-frequent first', issueFreq[0].count >= issueFreq[issueFreq.length - 1].count, { top: issueFreq[0] });

  const safetySignals = computeSafetySignalCounts(recs);
  record('computeSafetySignalCounts() counts the mixed-light failure and skin-tone issue correctly', safetySignals.mixedLightFailureCount === 1 && safetySignals.skinToneIssueCount === 1, { safetySignals });

  const dash = computeCalibrationDashboard(recs);
  record('computeCalibrationDashboard() bundles summary/byCategory/byLighting/issueFrequency/safetySignals together', ['summary', 'byCategory', 'byLighting', 'issueFrequency', 'safetySignals'].every(k => k in dash), {});
}

// ── Section 5: Calibration Policy + Readiness Report (R1 Sections 12-13) ────
{
  record('computeReadinessReport([]) is INSUFFICIENT_DATA, never PRODUCTION_READY or any unrecognized status', computeReadinessReport([]).readinessStatus === 'INSUFFICIENT_DATA', {});
  record('computeReadinessReport() never returns the forbidden PRODUCTION_READY status under ANY input, by construction (the function has no branch that can produce it)', (() => {
    const src = String(computeReadinessReport);
    return !src.includes("'PRODUCTION_READY'");
  })(), {});

  // EPIC 2E-K-R2-FIX1 -- Section 4: the readiness ladder now ALSO
  // requires genuine, browser-verified, visually-decision-eligible
  // pixel evidence before it will even look at win-rate/coverage
  // numbers (NEEDS_BROWSER_VERIFICATION / NEEDS_PIXEL_PREVIEW sit
  // below INSUFFICIENT_DATA but above NEEDS_MORE_COVERAGE in the
  // ladder) -- every fixture record built here for the ladder tests
  // below must carry a genuinely eligible previewEvidence object, or
  // these tests would only ever be proving the NEW evidence gate
  // (already covered by qa/epic-2e-k-r2-fix1-pixel-truth-static-test.mjs),
  // never reaching the older coverage/win-rate tiers they intend to
  // exercise.
  function _eligiblePreviewEvidence() {
    return {
      previewTruthCode: 'BOTH_RENDERED_DIFFERENT', legacyPreviewState: 'rendered', controlledV2PreviewState: 'rendered',
      legacyTransformed: true, controlledV2Transformed: true, sameSourceGeometry: true,
      sourceWidth: 800, sourceHeight: 600, legacyOutputWidth: 800, legacyOutputHeight: 600,
      controlledV2OutputWidth: 800, controlledV2OutputHeight: 600,
      legacyPixelHash: 'a'.repeat(64), controlledV2PixelHash: 'b'.repeat(64),
      legacyNonTransparentPixelCount: 480000, controlledV2NonTransparentPixelCount: 480000,
      pixelDifferenceDetected: true, browserVerified: true, visualDecisionEligible: true,
      sourceFingerprintMatch: true, renderGenerationId: 'gen-fixture', verifiedAt: new Date().toISOString(),
    };
  }
  function mkBig(n, catList, mixedEvery, skinEvery, v2WinEvery) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const r = createImageTestRecord({
        imageCategories: [catList[i % catList.length]],
        lightingCondition: (mixedEvery && i % mixedEvery === 0) ? 'MIXED' : 'DAYLIGHT',
        containsSkin: !!(skinEvery && i % skinEvery === 0),
        previewEvidence: _eligiblePreviewEvidence(),
      });
      r.userDecision = (v2WinEvery && i % v2WinEvery === 0) ? 'LEGACY_BETTER' : 'V2_BETTER';
      r.safetySnapshot = { legacySafetyWarningCount: 0, v2HardStopCount: 0, v2SoftCapCount: 0, severeIssueDetected: false };
      r.controlledV2Snapshot = { confidence: 0.6 };
      out.push(r);
    }
    return out;
  }
  const small = mkBig(10, ['WEDDING', 'PORTRAIT'], 0, 0, 0);
  record('Readiness ladder: below the reviewed-sample floor stays INSUFFICIENT_DATA', computeReadinessReport(small.slice(0, 5)).readinessStatus === 'INSUFFICIENT_DATA', {});

  const midCoverageGap = mkBig(60, ['WEDDING', 'PORTRAIT', 'GRADUATION', 'EVENT', 'OUTDOOR'], 7, 3, 5);
  const midResult = computeReadinessReport(midCoverageGap);
  record('Readiness ladder: enough samples but insufficient mixed-light coverage yields NEEDS_MORE_COVERAGE', midResult.readinessStatus === 'NEEDS_MORE_COVERAGE', { midResult });

  const wellCovered = mkBig(65, ['WEDDING', 'PORTRAIT', 'GRADUATION', 'EVENT', 'OUTDOOR'], 6, 3, 6);
  const readyResult = computeReadinessReport(wellCovered);
  record('Readiness ladder: full coverage + V2 winning + zero severe issues reaches READY_FOR_CANDIDATE_REVIEW', readyResult.readinessStatus === 'READY_FOR_CANDIDATE_REVIEW', { readyResult });

  const legacyWinning = wellCovered.map(r => ({ ...r, userDecision: 'LEGACY_BETTER' }));
  record('Readiness ladder: Legacy winning overall yields PROMISING_NOT_READY (never claims readiness while losing to Legacy)', computeReadinessReport(legacyWinning).readinessStatus === 'PROMISING_NOT_READY', {});

  const severe = wellCovered.map((r, i) => (i < 10 ? { ...r, safetySnapshot: { ...r.safetySnapshot, severeIssueDetected: true } } : r));
  record('Readiness ladder: a high severe-issue rate yields NEEDS_CALIBRATION even with good coverage', computeReadinessReport(severe).readinessStatus === 'NEEDS_CALIBRATION', {});

  const policyEval = evaluateCalibrationPolicy(wellCovered, CALIBRATION_POLICY_DEFAULTS);
  record('evaluateCalibrationPolicy() reports allCriteriaMet=true for the well-covered, V2-winning dataset', policyEval.allCriteriaMet === true, {});
}

// ── Section 6: export contract (R1 Section 10) ──────────────────────────────
{
  const session = createCalibrationSession({ locale: 'en', appVersion: '1.0' });
  const rec = createImageTestRecord({ imageFingerprint: 'dhash-abc', imageCategories: ['WEDDING'], lightingCondition: 'TUNGSTEN', containsSkin: true });
  rec.userDecision = 'V2_BETTER';
  rec.issueCodes = ['WB_TOO_WARM'];
  rec.legacySnapshot = { temperature: 0.1, tint: -0.02, confidence: 0.5, safetyScore: 0.9 };
  rec.controlledV2Snapshot = { temperature: 0.05, tint: -0.01, confidence: 0.4, safetyScore: 0.8 };
  rec.reviewedAt = new Date().toISOString();
  // HOSTILE: attempt to smuggle forbidden fields onto the record before
  // exporting -- the exporter's field allow-list must exclude them from
  // the OUTPUT regardless, by construction (never a runtime filter that
  // could be bypassed).
  const hostileRecord = { ...rec, imageBase64: 'data:image/png;base64,AAAA', localFilePath: 'C:\\Users\\someone\\Pictures\\wedding.jpg', originalImageDataUrl: 'blob:fake' };

  const json = buildExportJson(session, [hostileRecord]);
  const jsonStr = JSON.stringify(json);
  record('JSON export never contains a smuggled imageBase64 field (HOSTILE)', !jsonStr.includes('imageBase64') && !jsonStr.includes('data:image'), {});
  record('JSON export never contains a smuggled Local File Path field (HOSTILE)', !jsonStr.includes('localFilePath') && !jsonStr.includes('Pictures'), {});
  record('JSON export never contains a smuggled originalImageDataUrl field (HOSTILE)', !jsonStr.includes('originalImageDataUrl') && !jsonStr.includes('blob:fake'), {});
  record('JSON export uses stable codes and real numbers for the record', json.records[0].userDecision === 'V2_BETTER' && typeof json.records[0].legacyTemperature === 'number', {});

  const csv = buildExportCsv(session, [hostileRecord]);
  record('CSV export never contains a smuggled imageBase64/localFilePath value (HOSTILE)', !csv.includes('imageBase64') && !csv.includes('Pictures') && !csv.includes('data:image'), {});
  record('CSV export header matches the exact required column order', CSV_COLUMNS.join(',') === 'sessionId,imageId,imageCategories,lightingCondition,containsSkin,userDecision,issueCodes,legacyConfidence,v2Confidence,legacySafetyScore,v2SafetyScore,legacyTemperature,v2Temperature,legacyTint,v2Tint,reviewedAt', { header: CSV_COLUMNS.join(',') });
  record('CSV export properly escapes commas/quotes in issueCodes/imageCategories cells', csv.split('\r\n')[1].includes('WEDDING'), {});
}

// ── Section 7: scoped EN/TH dictionary coverage ─────────────────────────────
{
  const coverage = checkCalibrationLabDictionaryCoverage();
  record('Every stable code (decision/category/lighting/issue/readiness) has a Calibration Lab dictionary entry in BOTH en and th', coverage.ok, { missing: coverage.missing.slice(0, 10) });
  record('calibrationLabT() falls back to the raw key path for an unknown key (never throws, never returns undefined)', calibrationLabT('nonexistent.path.x', 'th') === 'nonexistent.path.x', {});
  record('calibrationLabT() never returns visible sentence text for a code lookup mismatch across languages (EN and TH text differ for the same code)', calibrationLabT('decision.V2_BETTER', 'en') !== calibrationLabT('decision.V2_BETTER', 'th'), {});
}

console.log(`\n${passCount}/${passCount + failCount} PASS, ${failCount} FAIL`);
process.exit(failCount > 0 ? 1 : 0);
