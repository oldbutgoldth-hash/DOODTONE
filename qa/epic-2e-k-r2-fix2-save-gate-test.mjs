#!/usr/bin/env node
/**
 * qa/epic-2e-k-r2-fix2-save-gate-test.mjs
 *
 * EPIC 2E-K-R2-FIX2 -- Section 6/11: Save Result Gate.
 *
 * Real behavioral test (deterministic IndexedDB contract harness, the ACTUAL
 * createCalibrationLabController() -- never a hand-rolled stub) proving:
 *
 *   1. saveCurrentDecision({ userDecision: 'NOT_REVIEWED' }) is REJECTED
 *      with lastActionError === 'DECISION_REQUIRED' (reported bugs #3/#4:
 *      Save Result must never be able to persist Notes/Issue Codes with
 *      userDecision=NOT_REVIEWED, and must never create a bogus
 *      reviewedAt timestamp for a record that was never actually
 *      reviewed).
 *   2. A rejected Save leaves the record, notes, issueCodes, reviewedAt,
 *      and the session's rollup counters completely unchanged.
 *   3. The pre-existing Decision Eligibility Gate (FIX1 Section 3) still
 *      independently rejects a real decision (V2_BETTER) against
 *      ineligible Evidence with DECISION_NOT_ELIGIBLE -- the new
 *      NOT_REVIEWED gate must not have weakened or replaced it.
 *   4. A genuine decision against genuinely eligible Evidence still
 *      succeeds normally (notes/issueCodes/reviewedAt persist, session
 *      counters update) -- the new gate must not have made legitimate
 *      saves impossible.
 *   5. clearCurrentAnswer() is completely unaffected by the new gate --
 *      it never calls saveCurrentDecision() and may still legitimately
 *      set userDecision back to NOT_REVIEWED.
 *
 * No Browser, no Chromium -- safe for run-static-suites.mjs. Uses the
 * SAME shared deterministic IndexedDB backend pattern established by
 * qa/epic-2e-k-calibration-lab-storage-test.mjs (two independent
 * createCalibrationLabStorage() handles reading/writing the same
 * underlying QA IndexedDB-contract database).
 */
import { randomUUID } from 'node:crypto';
import { createDeterministicIndexedDbEnvironment } from './helpers/deterministic-indexeddb.mjs';
import { createCalibrationLabController } from '../ui/calibration-lab/calibration-lab-controller.js';
import { createCalibrationLabStorage } from '../ui/calibration-lab/calibration-lab-storage.js';
import { createImageTestRecord } from '../core/calibration-lab/schema.js';

const env = createDeterministicIndexedDbEnvironment();
globalThis.indexedDB = env.indexedDB;
globalThis.IDBKeyRange = env.IDBKeyRange;
let passCount = 0, failCount = 0;
function record(test, ok, evidence) {
  const icon = ok ? '✓' : '✗';
  const status = ok ? 'PASS' : 'FAIL';
  if (ok) passCount++; else failCount++;
  const safeEvidence = (() => { try { return JSON.stringify(evidence); } catch { return String(evidence); } })();
  console.log(`${icon} [${status}] ${test} — ${safeEvidence}`);
}

// Same eligible-evidence fixture shape used by
// qa/epic-2e-k-calibration-lab-static-test.mjs's _eligiblePreviewEvidence(),
// kept in sync deliberately (a genuinely rendered, Web-Crypto-verified,
// Calibration-plan-available, both-sides-different pixel result).
function eligiblePreviewEvidence() {
  return {
    previewTruthCode: 'BOTH_RENDERED_DIFFERENT', legacyPreviewState: 'rendered', controlledV2PreviewState: 'rendered',
    legacyTransformed: true, controlledV2Transformed: true, sameSourceGeometry: true,
    sourceWidth: 800, sourceHeight: 600, legacyOutputWidth: 800, legacyOutputHeight: 600,
    controlledV2OutputWidth: 800, controlledV2OutputHeight: 600,
    legacyPixelHash: 'a'.repeat(64), controlledV2PixelHash: 'b'.repeat(64),
    legacyNonTransparentPixelCount: 480000, controlledV2NonTransparentPixelCount: 480000,
    pixelDifferenceDetected: true, browserVerified: true, visualDecisionEligible: true,
    sourceFingerprintMatch: true, renderGenerationId: 'gen-fix2-savegate', verifiedAt: new Date().toISOString(),
    calibrationV2PlanAvailable: true, calibrationV2PlanRenderable: true, calibrationV2PlanMode: 'CALIBRATION_PREVIEW_ONLY',
    pixelHashVerificationMode: 'WEB_CRYPTO_SHA256', legacyHashVerified: true, controlledV2HashVerified: true,
  };
}

function ineligiblePreviewEvidence() {
  // The exact reported bug-4/bug-5/bug-7 shape: V2 never actually
  // rendered (default 300x150, zero pixels) -- Decision Gate must stay
  // closed regardless of what the new NOT_REVIEWED check does.
  return {
    previewTruthCode: 'CALIBRATION_V2_PLAN_BLOCKED', legacyPreviewState: 'rendered', controlledV2PreviewState: 'unknown',
    legacyTransformed: true, controlledV2Transformed: false, sameSourceGeometry: false,
    sourceWidth: 800, sourceHeight: 600, legacyOutputWidth: 800, legacyOutputHeight: 600,
    controlledV2OutputWidth: 300, controlledV2OutputHeight: 150,
    legacyPixelHash: 'a'.repeat(64), controlledV2PixelHash: null,
    legacyNonTransparentPixelCount: 480000, controlledV2NonTransparentPixelCount: 0,
    pixelDifferenceDetected: false, browserVerified: false, visualDecisionEligible: false,
    sourceFingerprintMatch: true, renderGenerationId: 'gen-fix2-savegate-ineligible', verifiedAt: new Date().toISOString(),
    calibrationV2PlanAvailable: true, calibrationV2PlanRenderable: false, calibrationV2PlanMode: 'CALIBRATION_PREVIEW_ONLY',
    pixelHashVerificationMode: 'WEB_CRYPTO_SHA256', legacyHashVerified: true, controlledV2HashVerified: false,
  };
}

async function seedRecordForCurrentSession(sessionId, previewEvidence) {
  // Writes directly through a SECOND storage handle onto the SAME
  // underlying QA IndexedDB-contract database the controller's own internal
  // storage (created inside init()) reads from -- this is how we get a
  // genuinely persisted, schema-valid record in place for
  // controller.openSession() to load, without needing a real decoded
  // <img>/Canvas (unavailable in plain Node -- see pixel-truth-capture.js).
  const sideStorage = await createCalibrationLabStorage();
  const rec = createImageTestRecord({
    imageCategories: ['WEDDING'], lightingCondition: 'DAYLIGHT', previewEvidence,
  });
  await sideStorage.saveImageRecord(sessionId, rec);
  return rec;
}

async function main() {
  const controller = createCalibrationLabController({ locale: 'en', appVersion: 'fix2-savegate-test' });
  await controller.init();
  let state = await controller.startNewSession();
  const sessionId = state.session.sessionId;

  // --- Scenario 1: NOT_REVIEWED rejected even against ELIGIBLE evidence ---
  await seedRecordForCurrentSession(sessionId, eligiblePreviewEvidence());
  state = await controller.openSession(sessionId);
  record('Seeded eligible record loads with lastActionError=null', state.lastActionError === null, { lastActionError: state.lastActionError });
  record('Seeded eligible record starts NOT_REVIEWED / notes empty / reviewedAt null', state.currentRecord.userDecision === 'NOT_REVIEWED' && state.currentRecord.notes === '' && state.currentRecord.issueCodes.length === 0 && state.currentRecord.reviewedAt === null, { record: state.currentRecord });

  const beforeSessionCounters = { ...state.session };
  state = await controller.saveCurrentDecision({ userDecision: 'NOT_REVIEWED', issueCodes: ['SKIN_TONE_UNNATURAL'], notes: 'this must never persist' });
  record('Save Result with userDecision=NOT_REVIEWED is rejected with DECISION_REQUIRED', state.lastActionError === 'DECISION_REQUIRED', { lastActionError: state.lastActionError });
  record('Blocked Save (NOT_REVIEWED) leaves userDecision unchanged', state.currentRecord.userDecision === 'NOT_REVIEWED', { userDecision: state.currentRecord.userDecision });
  record('Blocked Save (NOT_REVIEWED) does not persist Notes', state.currentRecord.notes === '', { notes: state.currentRecord.notes });
  record('Blocked Save (NOT_REVIEWED) does not persist Issue Codes', Array.isArray(state.currentRecord.issueCodes) && state.currentRecord.issueCodes.length === 0, { issueCodes: state.currentRecord.issueCodes });
  record('Blocked Save (NOT_REVIEWED) does not create reviewedAt', state.currentRecord.reviewedAt === null, { reviewedAt: state.currentRecord.reviewedAt });
  record('Blocked Save (NOT_REVIEWED) leaves Session counters unchanged', state.session.reviewedCount === beforeSessionCounters.reviewedCount && state.session.pendingCount === beforeSessionCounters.pendingCount, { before: beforeSessionCounters, after: state.session });

  // Reload from storage directly to prove nothing was silently persisted underneath the in-memory state either.
  const reloadStorage = await createCalibrationLabStorage();
  const persistedAfterBlockedSave = (await reloadStorage.loadImageRecordsForSession(sessionId))[0];
  record('Blocked Save (NOT_REVIEWED) was never actually written to storage', persistedAfterBlockedSave.userDecision === 'NOT_REVIEWED' && persistedAfterBlockedSave.notes === '' && persistedAfterBlockedSave.reviewedAt === null, { persisted: persistedAfterBlockedSave });

  // --- Scenario 2: a REAL decision still correctly succeeds against ELIGIBLE evidence ---
  state = await controller.saveCurrentDecision({ userDecision: 'V2_BETTER', issueCodes: [], notes: 'genuinely reviewed' });
  record('Save Result with a real decision (V2_BETTER) against eligible Evidence succeeds', state.lastActionError === null, { lastActionError: state.lastActionError });
  record('Successful Save persists the real userDecision', state.currentRecord.userDecision === 'V2_BETTER', { userDecision: state.currentRecord.userDecision });
  record('Successful Save persists Notes', state.currentRecord.notes === 'genuinely reviewed', { notes: state.currentRecord.notes });
  record('Successful Save creates a real reviewedAt', typeof state.currentRecord.reviewedAt === 'string' && state.currentRecord.reviewedAt.length > 0, { reviewedAt: state.currentRecord.reviewedAt });
  record('Successful Save updates Session reviewedCount', state.session.reviewedCount === beforeSessionCounters.reviewedCount + 1, { before: beforeSessionCounters.reviewedCount, after: state.session.reviewedCount });

  // --- Scenario 3: clearCurrentAnswer() still works and is unaffected by the new gate ---
  state = await controller.clearCurrentAnswer();
  record('clearCurrentAnswer() still succeeds (bypasses saveCurrentDecision entirely)', state.lastActionError === null, { lastActionError: state.lastActionError });
  record('clearCurrentAnswer() resets userDecision to NOT_REVIEWED', state.currentRecord.userDecision === 'NOT_REVIEWED', { userDecision: state.currentRecord.userDecision });
  record('clearCurrentAnswer() resets notes/issueCodes/reviewedAt', state.currentRecord.notes === '' && state.currentRecord.issueCodes.length === 0 && state.currentRecord.reviewedAt === null, { record: state.currentRecord });

  // --- Scenario 4: pre-existing DECISION_NOT_ELIGIBLE gate (FIX1 Section 3) must still work independently ---
  state = await controller.startNewSession();
  const sessionId2 = state.session.sessionId;
  await seedRecordForCurrentSession(sessionId2, ineligiblePreviewEvidence());
  state = await controller.openSession(sessionId2);
  const beforeIneligible = { ...state.currentRecord };
  state = await controller.saveCurrentDecision({ userDecision: 'V2_BETTER', issueCodes: [], notes: 'should be blocked by evidence, not by NOT_REVIEWED' });
  record('Save Result with a real decision against INELIGIBLE Evidence is still rejected with DECISION_NOT_ELIGIBLE', state.lastActionError === 'DECISION_NOT_ELIGIBLE', { lastActionError: state.lastActionError });
  record('Blocked Save (ineligible evidence) leaves the record fully unchanged', state.currentRecord.userDecision === beforeIneligible.userDecision && state.currentRecord.notes === beforeIneligible.notes && state.currentRecord.reviewedAt === beforeIneligible.reviewedAt, { before: beforeIneligible, after: state.currentRecord });

  // --- Scenario 5: NOT_REVIEWED rejection also holds against ineligible evidence (both gates independently agree) ---
  state = await controller.saveCurrentDecision({ userDecision: 'NOT_REVIEWED', issueCodes: [], notes: 'x' });
  record('NOT_REVIEWED is rejected with DECISION_REQUIRED even when Evidence is also ineligible (NOT_REVIEWED check runs first)', state.lastActionError === 'DECISION_REQUIRED', { lastActionError: state.lastActionError });

  console.log(`\n${passCount} PASS, ${failCount} FAIL`);
  if (failCount > 0) process.exit(1);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
