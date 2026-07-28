#!/usr/bin/env node
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCohortSaveReceipt, findNextPendingIndex } from '../core/calibration-lab/cohort-save-feedback.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0;
function test(name, fn) {
  try { fn(); pass += 1; console.log(`✓ [PASS] ${name}`); }
  catch (error) { console.error(`✗ [FAIL] ${name}\n${error.stack || error}`); process.exitCode = 1; }
}

const eligibleEvidence = {
  previewTruthCode: 'BOTH_RENDERED_DIFFERENT', browserVerified: true, visualDecisionEligible: true,
  sameSourceGeometry: true, sourceFingerprintMatch: true,
  legacyPixelHash: 'a'.repeat(64), controlledV2PixelHash: 'b'.repeat(64),
  legacyNonTransparentPixelCount: 480000, controlledV2NonTransparentPixelCount: 480000,
};
function row(id, decision = 'NOT_REVIEWED', overrides = {}) {
  return {
    imageId: id, imageFingerprint: `fp-${id}`, analysisGenerationId: `gen-${id}`,
    imageCategories: ['PORTRAIT'], lightingCondition: 'DAYLIGHT', containsSkin: true,
    userDecision: decision, issueCodes: [], notes: '', reviewedAt: decision === 'NOT_REVIEWED' ? null : '2026-07-28T00:00:00.000Z',
    legacyDecisionPreservedForAudit: false, requiresVisualReReview: false,
    legacySnapshot: { confidence: .7 }, controlledV2Snapshot: { confidence: .8 },
    safetySnapshot: { severeIssueDetected: false, v2HardStopCount: 0 },
    previewEvidence: { ...eligibleEvidence }, ...overrides,
  };
}

test('next-pending navigation moves forward and wraps', () => {
  const rows = [row('a', 'V2_BETTER'), row('b'), row('c', 'ABOUT_EQUAL'), row('d')];
  assert.equal(findNextPendingIndex(rows, 0), 1);
  assert.equal(findNextPendingIndex(rows, 1), 3);
  assert.equal(findNextPendingIndex(rows, 3), 1);
});

test('next-pending navigation returns -1 after all images are reviewed', () => {
  assert.equal(findNextPendingIndex([row('a', 'V2_BETTER'), row('b', 'LEGACY_BETTER')], 0), -1);
  assert.equal(findNextPendingIndex([], 0), -1);
});

test('valid saved review produces a Cohort receipt with hard Production locks', () => {
  const saved = row('saved', 'V2_BETTER');
  const rows = [saved, row('pending')];
  const receipt = buildCohortSaveReceipt(saved, rows, { savedAt: '2026-07-28T01:00:00.000Z' });
  assert.equal(receipt.code, 'DECISION_SAVED_TO_COHORT');
  assert.equal(receipt.includedInCohort, true);
  assert.equal(receipt.reviewedCount, 1);
  assert.equal(receipt.pendingCount, 1);
  assert.equal(receipt.candidatePilotVerifiedSampleCount, 1);
  assert.equal(receipt.productionSource, 'legacy');
  assert.equal(receipt.productionWrite, false);
  assert.equal(receipt.controlledV2Apply, false);
  assert.equal(receipt.previewExport, false);
});

test('saved but unverified review is reported honestly as excluded', () => {
  const excluded = row('excluded', 'V2_BETTER', { previewEvidence: { ...eligibleEvidence, browserVerified: false } });
  const receipt = buildCohortSaveReceipt(excluded, [excluded]);
  assert.equal(receipt.code, 'DECISION_SAVED_EXCLUDED');
  assert.equal(receipt.includedInCohort, false);
  assert.equal(receipt.candidatePilotVerifiedSampleCount, 0);
});

const renderer = await fs.readFile(path.join(ROOT, 'ui/calibration-lab/calibration-lab-renderer.js'), 'utf8');
const controller = await fs.readFile(path.join(ROOT, 'ui/calibration-lab/calibration-lab-controller.js'), 'utf8');
const i18n = await fs.readFile(path.join(ROOT, 'ui/calibration-lab/calibration-lab-i18n.js'), 'utf8');
const helper = await fs.readFile(path.join(ROOT, 'core/calibration-lab/cohort-save-feedback.js'), 'utf8');

test('renderer exposes a prominent guided save bar and save-and-next control', () => {
  assert(renderer.includes("'data-cal-role': 'guided-save-bar'"));
  assert(renderer.includes("'data-cal-role': 'save-and-next-button'"));
  assert(renderer.includes("'data-cal-role': 'cohort-save-result'"));
  assert(renderer.includes("'data-cal-role': 'current-cohort-status'"));
});

test('save controls require both pixel eligibility and an explicit decision', () => {
  assert(renderer.includes("const saveEligible = evidenceEligible && decisionChosen"));
  assert(renderer.includes("pendingDecision !== 'NOT_REVIEWED'"));
  assert(controller.includes("if (userDecision === 'NOT_REVIEWED')"));
});

test('controller publishes semantic save receipts and next-pending navigation', () => {
  assert(controller.includes('buildCohortSaveReceipt(updated, records)'));
  assert(controller.includes('function goToNextPending()'));
  assert(controller.includes('currentIncludedInCandidatePilot'));
  assert(controller.includes('lastActionResultCode'));
});

test('Thai and English guided Cohort copy is present without changing canonical codes', () => {
  for (const phrase of ['Save and Go to Next Unreviewed Image', 'บันทึกและไปภาพที่ยังไม่ได้ตรวจถัดไป', 'DECISION_SAVED_TO_COHORT']) {
    assert(i18n.includes(phrase) || controller.includes(phrase) || renderer.includes(phrase));
  }
});

test('guided Cohort UX contains no Production activation or XMP write action', () => {
  assert(!/serializeXMP|downloadXMP|activateControlledV2|productionSource\s*=\s*['"]controlled/i.test(helper));
  assert(helper.includes("productionSource: 'legacy'"));
  assert(helper.includes('productionWrite: false'));
});

if (!process.exitCode) console.log(`\n${pass}/${pass} PASS, 0 FAIL`);
