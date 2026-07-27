#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  CANDIDATE_PILOT_STATUSES,
  computeCandidatePilotReport,
  computeWilsonInterval,
  isCandidatePilotEligibleRecord,
  isCandidatePilotReportProductionSafe,
  selectCandidatePilotCohort,
} from '../core/calibration-lab/candidate-pilot.js';
import { buildCandidatePilotExport } from '../core/calibration-lab/export-candidate-pilot.js';

let pass = 0;
function test(name, fn) {
  try { fn(); pass += 1; console.log(`✓ [PASS] ${name}`); }
  catch (error) { console.error(`✗ [FAIL] ${name}\n${error.stack || error}`); process.exitCode = 1; }
}

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const categories = ['WEDDING', 'PORTRAIT', 'EVENT', 'OUTDOOR', 'MIXED_LIGHT', 'SKIN_DOMINANT'];
const lightings = ['DAYLIGHT', 'MIXED', 'LED', 'LOW_LIGHT', 'FLASH'];

function record(i, decision = 'V2_BETTER', overrides = {}) {
  const category = categories[i % categories.length];
  const lighting = lightings[i % lightings.length];
  return {
    imageId: `image-${i}`,
    imageFingerprint: `fingerprint-${i}`,
    analysisGenerationId: `generation-${i}`,
    imageCategories: [category],
    lightingCondition: lighting,
    containsSkin: i < 24 || category === 'SKIN_DOMINANT',
    userDecision: decision,
    issueCodes: [],
    notes: '',
    reviewedAt: new Date(2026, 0, 1, 0, 0, i).toISOString(),
    legacyDecisionPreservedForAudit: false,
    requiresVisualReReview: false,
    legacySnapshot: { confidence: 0.72 },
    controlledV2Snapshot: { confidence: 0.78 },
    safetySnapshot: { severeIssueDetected: false, v2HardStopCount: 0 },
    previewEvidence: {
      previewTruthCode: 'BOTH_RENDERED_DIFFERENT',
      browserVerified: true,
      visualDecisionEligible: true,
      sameSourceGeometry: true,
      sourceFingerprintMatch: true,
      legacyPixelHash: HASH_A,
      controlledV2PixelHash: HASH_B,
      legacyNonTransparentPixelCount: 480000,
      controlledV2NonTransparentPixelCount: 480000,
    },
    ...overrides,
  };
}

function readyRecords() {
  const list = [];
  for (let i = 0; i < 42; i += 1) list.push(record(i, 'V2_BETTER'));
  for (let i = 42; i < 50; i += 1) list.push(record(i, 'LEGACY_BETTER'));
  for (let i = 50; i < 55; i += 1) list.push(record(i, 'ABOUT_EQUAL'));
  for (let i = 55; i < 58; i += 1) list.push(record(i, 'BOTH_UNACCEPTABLE'));
  for (let i = 58; i < 60; i += 1) list.push(record(i, 'NOT_SURE'));
  return list;
}

test('Candidate Pilot status vocabulary never includes PRODUCTION_READY', () => {
  assert(!CANDIDATE_PILOT_STATUSES.includes('PRODUCTION_READY'));
});

test('Eligibility requires real browser-verified visual evidence and a reviewed decision', () => {
  assert.equal(isCandidatePilotEligibleRecord(record(1)), true);
  assert.equal(isCandidatePilotEligibleRecord(record(2, 'NOT_REVIEWED')), false);
  assert.equal(isCandidatePilotEligibleRecord(record(3, 'V2_BETTER', { previewEvidence: { ...record(3).previewEvidence, browserVerified: false } })), false);
  assert.equal(isCandidatePilotEligibleRecord(record(4, 'V2_BETTER', { legacyDecisionPreservedForAudit: true })), false);
});

test('Cohort selector excludes migrated, pending and unverified records', () => {
  const rows = [record(1), record(2, 'NOT_REVIEWED'), record(3, 'V2_BETTER', { requiresVisualReReview: true }), record(4, 'V2_BETTER', { previewEvidence: { ...record(4).previewEvidence, controlledV2PixelHash: null } })];
  assert.deepEqual(selectCandidatePilotCohort(rows).map(r => r.imageId), ['image-1']);
});

test('Wilson interval is bounded and conservative', () => {
  const interval = computeWilsonInterval(42, 50);
  assert(interval.lower > 0.7 && interval.lower < 0.8);
  assert(interval.upper > 0.9 && interval.upper <= 1);
  assert.deepEqual(computeWilsonInterval(0, 0), { lower: null, upper: null });
});

test('Empty dataset is PILOT_NOT_STARTED', () => {
  assert.equal(computeCandidatePilotReport([]).pilotStatus, 'PILOT_NOT_STARTED');
});

test('Small verified dataset is insufficient, never candidate-ready', () => {
  assert.equal(computeCandidatePilotReport(readyRecords().slice(0, 12)).pilotStatus, 'PILOT_INSUFFICIENT_VERIFIED_SAMPLES');
});

test('Coverage gaps are reported after sample floor is met', () => {
  const rows = readyRecords().map((r, i) => ({ ...r, imageCategories: ['PORTRAIT'], lightingCondition: i % 2 ? 'DAYLIGHT' : 'LED', containsSkin: true }));
  assert.equal(computeCandidatePilotReport(rows).pilotStatus, 'PILOT_COVERAGE_GAPS');
});

test('Safety hard stop halts the Pilot', () => {
  const rows = readyRecords();
  rows[0] = { ...rows[0], safetySnapshot: { ...rows[0].safetySnapshot, v2HardStopCount: 1 } };
  assert.equal(computeCandidatePilotReport(rows).pilotStatus, 'PILOT_SAFETY_HALT');
});

test('Category regression halts the Pilot', () => {
  const rows = readyRecords();
  for (let i = 0; i < 6; i += 1) rows[i] = { ...rows[i], imageCategories: ['PRODUCT'], userDecision: 'LEGACY_BETTER' };
  for (let i = 6; i < 12; i += 1) rows[i] = { ...rows[i], imageCategories: ['ORDINATION'], userDecision: 'LEGACY_BETTER' };
  for (let i = 12; i < rows.length; i += 1) rows[i] = { ...rows[i], imageCategories: [categories[i % 5]] };
  const report = computeCandidatePilotReport(rows);
  assert.equal(report.pilotStatus, 'PILOT_REGRESSION_HALT');
  assert(report.regressionCategories.includes('PRODUCT'));
  assert(report.regressionCategories.includes('ORDINATION'));
});

test('Weak V2 advantage needs more evidence rather than passing', () => {
  const rows = readyRecords();
  rows.forEach((r, i) => { if (i < 25) r.userDecision = 'V2_BETTER'; else if (i < 50) r.userDecision = 'LEGACY_BETTER'; else r.userDecision = 'ABOUT_EQUAL'; });
  assert.equal(computeCandidatePilotReport(rows).pilotStatus, 'PILOT_NEEDS_MORE_EVIDENCE');
});

test('Strong, covered, verified cohort reaches candidate evaluation only', () => {
  const report = computeCandidatePilotReport(readyRecords(), undefined, { sourceSessionId: 'session-ready', generatedAt: '2026-07-27T00:00:00.000Z' });
  assert.equal(report.pilotStatus, 'PILOT_CANDIDATE_EVALUATION_READY');
  assert.equal(report.sourceSessionId, 'session-ready');
  assert.equal(report.verifiedReviewedSamples, 60);
  assert.equal(report.productionLocks.productionSource, 'legacy');
  assert.equal(report.productionLocks.productionWrite, false);
  assert.equal(report.productionLocks.controlledV2Apply, false);
  assert.equal(report.productionLocks.previewExport, false);
  assert.equal(isCandidatePilotReportProductionSafe(report), true);
});

test('Cohort hash is deterministic and changes when a decision changes', () => {
  const rows = readyRecords();
  const a = computeCandidatePilotReport(rows, undefined, { generatedAt: '2026-01-01T00:00:00.000Z' }).cohortHash;
  const b = computeCandidatePilotReport([...rows].reverse(), undefined, { generatedAt: '2026-02-01T00:00:00.000Z' }).cohortHash;
  assert.equal(a, b);
  const changed = rows.map(r => ({ ...r }));
  changed[0].userDecision = 'LEGACY_BETTER';
  const c = computeCandidatePilotReport(changed).cohortHash;
  assert.notEqual(a, c);
});

test('Candidate Pilot export contains no image payload, path, preset or XMP field', () => {
  const payload = buildCandidatePilotExport({ sessionId: 'session-ready' }, readyRecords(), { generatedAt: '2026-07-27T00:00:00.000Z' });
  const text = JSON.stringify(payload);
  assert.equal(payload.exportType, 'LUMIXA_CONTROLLED_V2_CANDIDATE_PILOT_REPORT');
  assert(!/base64|data:image|objectUrl|filePath|originalImage|pixelBuffer/i.test(text));
  assert(!Object.keys(payload.report).some(k => /xmp|preset/i.test(k)));
  assert.equal(payload.report.productionLocks.productionWrite, false);
});

if (!process.exitCode) console.log(`\n${pass}/${pass} PASS, 0 FAIL`);
