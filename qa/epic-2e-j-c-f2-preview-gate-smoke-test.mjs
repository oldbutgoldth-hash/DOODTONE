#!/usr/bin/env node
/**
 * qa/epic-2e-j-c-f2-preview-gate-smoke-test.mjs
 *
 * EPIC 2E-J-C-F2 Steps 1-3 — a focused, non-browser Node.js smoke test
 * for the Controlled V2 Preview Gate reachability fix and the safe
 * Human Review projection. Calls the real project modules directly
 * (no browser, no screenshots, no Observation UI).
 *
 * Run: node qa/epic-2e-j-c-f2-preview-gate-smoke-test.mjs
 */

import { buildControlledOverlayTestGateV2 } from '../core/lightroom-mapping-engine/mapping-v2-overlay-test-gate.js';
import { buildControlledOverlayPreviewSandboxV2 } from '../core/lightroom-mapping-engine/mapping-v2-overlay-preview-sandbox.js';
import { buildVisualPreviewRenderPlanV2 } from '../core/preview-rendering/visual-preview-render-plan-v2.js';
import { _projectHumanReviewStateV2 } from '../core/decision-engine/index.js';
import { LIGHTROOM_MAPPING_V2_FLAGS } from '../core/lightroom-mapping-engine/mapping-v2-flags.js';

const results = [];
function record(test, pass, evidence) {
  results.push({ test, result: pass ? 'PASS' : 'FAIL', evidence });
  console.log(`${pass ? '✓' : '✗'} [${pass ? 'PASS' : 'FAIL'}] ${test} — ${evidence}`);
}

const REQUIRED_IDS = [
  'legacy-output-preserved', 'source-image-reviewed', 'skin-tones-reviewed',
  'highlights-reviewed', 'shadows-reviewed', 'white-balance-reviewed',
  'color-stacking-reviewed', 'rollback-confirmed', 'preview-non-production-confirmed',
  'export-path-unchanged',
];
const ID = REQUIRED_IDS[0];

// ── Valid mock evidence, reused across full-pipeline tests ──
const legacyOverlaySimulationV2 = { confidence: 0.9, safetyScore: 0.9, legacyInputSummary: { available: true } };
const legacySafetyOverlayV2 = { confidence: 0.9, safetyScore: 0.9 };
const lightroomSafetyClampV2 = { hardStops: [], overStackAnalysis: { severity: 'low' }, globalSafetyScore: 0.9 };
const lightroomShadowCompareReportV2 = { safetyDelta: { status: 'safe' }, confidence: 0.9 };
const legacyPreset = { exp: 0.1, con: 0.1 };

function runFullPipeline(humanReviewState) {
  const testGate = buildControlledOverlayTestGateV2({ legacyOverlaySimulationV2, legacySafetyOverlayV2, lightroomSafetyClampV2, lightroomShadowCompareReportV2, legacyPreset });
  const sandbox = buildControlledOverlayPreviewSandboxV2({
    legacyOverlaySimulationV2, legacySafetyOverlayV2, lightroomSafetyClampV2, lightroomShadowCompareReportV2, legacyPreset,
    controlledOverlayTestGateV2: testGate, humanReviewState,
  });
  const renderPlan = buildVisualPreviewRenderPlanV2({ controlledOverlayPreviewSandboxV2: sandbox });
  return { testGate, sandbox, renderPlan };
}

function allApproved() {
  return { reviewItems: REQUIRED_IDS.map((id) => ({ id, status: 'passed', reviewed: true, reviewerDecision: 'approve' })) };
}

// ── FIX 1/2: preview-only flags + eligibility ──
console.log('=== FIX 1/2: Preview-only flags and Test Gate eligibility ===');
record('allowControlledOverlayTest remains false', LIGHTROOM_MAPPING_V2_FLAGS.allowControlledOverlayTest === false, `value=${LIGHTROOM_MAPPING_V2_FLAGS.allowControlledOverlayTest}`);
record('allowOverlayTestPresetPreview enabled', LIGHTROOM_MAPPING_V2_FLAGS.allowOverlayTestPresetPreview === true, `value=${LIGHTROOM_MAPPING_V2_FLAGS.allowOverlayTestPresetPreview}`);
record('allowOverlayPreviewGeneration enabled', LIGHTROOM_MAPPING_V2_FLAGS.allowOverlayPreviewGeneration === true, `value=${LIGHTROOM_MAPPING_V2_FLAGS.allowOverlayPreviewGeneration}`);
record('allowOverlayPreviewExport remains false', LIGHTROOM_MAPPING_V2_FLAGS.allowOverlayPreviewExport === false, `value=${LIGHTROOM_MAPPING_V2_FLAGS.allowOverlayPreviewExport}`);
record('allowOverlayPreviewProductionWrite remains false', LIGHTROOM_MAPPING_V2_FLAGS.allowOverlayPreviewProductionWrite === false, `value=${LIGHTROOM_MAPPING_V2_FLAGS.allowOverlayPreviewProductionWrite}`);
record('enableControlledActivation remains false', LIGHTROOM_MAPPING_V2_FLAGS.enableControlledActivation === false, `value=${LIGHTROOM_MAPPING_V2_FLAGS.enableControlledActivation}`);
record('allowProductionOverride remains false', LIGHTROOM_MAPPING_V2_FLAGS.allowProductionOverride === false, `value=${LIGHTROOM_MAPPING_V2_FLAGS.allowProductionOverride}`);

const gateOnly = buildControlledOverlayTestGateV2({ legacyOverlaySimulationV2, legacySafetyOverlayV2, lightroomSafetyClampV2, lightroomShadowCompareReportV2, legacyPreset });
record('canEnterControlledTest remains false', gateOnly.canEnterControlledTest === false, `value=${gateOnly.canEnterControlledTest}`);
record('canPreviewOverlayPreset is true', gateOnly.canPreviewOverlayPreset === true, `value=${gateOnly.canPreviewOverlayPreset}`);

// ── FIX 3: Human Review projection test cases A-J ──
console.log('');
console.log('=== FIX 3: Safe Human Review projection ===');

const A = _projectHumanReviewStateV2({ reviewItems: [{ id: ID, status: 'passed', reviewed: true, reviewerDecision: 'approve' }] });
record('A: status=passed+reviewed=true+approve -> passed', A[ID] === 'passed', JSON.stringify(A));

const B = _projectHumanReviewStateV2({ reviewItems: [{ id: ID, status: 'passed', reviewed: false, reviewerDecision: 'approve' }] });
record('B: reviewed=false -> not passed', B[ID] === undefined, JSON.stringify(B));

const C = _projectHumanReviewStateV2({ reviewItems: [{ id: ID, status: 'passed', reviewed: true, reviewerDecision: 'reject' }] });
record('C: reject -> failed', C[ID] === 'failed', JSON.stringify(C));

const D = _projectHumanReviewStateV2({ reviewItems: [{ id: ID, status: 'passed', reviewed: true, reviewerDecision: 'needs-adjustment' }] });
record('D: needs-adjustment -> not passed (pending)', D[ID] === undefined, JSON.stringify(D));

const E = _projectHumanReviewStateV2({ reviewItems: [{ id: ID, status: 'failed', reviewed: true, reviewerDecision: 'undecided' }] });
record('E: status=failed -> failed', E[ID] === 'failed', JSON.stringify(E));

const F = _projectHumanReviewStateV2({ reviewItems: [{ id: ID, status: 'pending', reviewed: false, reviewerDecision: 'undecided' }] });
record('F: pending status -> not passed', F[ID] === undefined, JSON.stringify(F));

const G = _projectHumanReviewStateV2({ reviewItems: [{ id: ID, status: 'passed', reviewed: true }] }); // reviewerDecision missing
record('G: missing reviewerDecision -> not passed', G[ID] === undefined, JSON.stringify(G));

const H1 = _projectHumanReviewStateV2({ reviewItems: [
  { id: ID, status: 'passed', reviewed: true, reviewerDecision: 'approve' },
  { id: ID, status: 'failed', reviewed: true, reviewerDecision: 'reject' },
] });
const H2 = _projectHumanReviewStateV2({ reviewItems: [
  { id: ID, status: 'failed', reviewed: true, reviewerDecision: 'reject' },
  { id: ID, status: 'passed', reviewed: true, reviewerDecision: 'approve' },
] });
record('H: duplicate passed+reject (either order) -> failed wins', H1[ID] === 'failed' && H2[ID] === 'failed', `order1=${H1[ID]}, order2=${H2[ID]}`);

let crashedI = false;
const hostileArr = [{ id: ID, status: 'passed', reviewed: true, reviewerDecision: 'approve' }];
Object.defineProperty(hostileArr, '1', { get() { throw new Error('evil'); } });
Object.defineProperty(hostileArr, 'length', { value: 2 });
let I = {};
try { I = _projectHumanReviewStateV2({ reviewItems: hostileArr }); } catch { crashedI = true; }
record('I: hostile Review array index getter -> no crash', !crashedI && I[ID] === 'passed', `crashed=${crashedI}, result=${JSON.stringify(I)}`);

let crashedJ = false;
const hostileItem = {};
Object.defineProperty(hostileItem, 'id', { get() { throw new Error('evil2'); } });
let J = {};
try { J = _projectHumanReviewStateV2({ reviewItems: [hostileItem, { id: ID, status: 'passed', reviewed: true, reviewerDecision: 'approve' }] }); } catch { crashedJ = true; }
record('J: hostile item getter -> malformed item skipped, no crash', !crashedJ && J[ID] === 'passed', `crashed=${crashedJ}, result=${JSON.stringify(J)}`);

// ── K: full pipeline, all 10 approved -> Ready ──
console.log('');
console.log('=== K/L: Full pipeline reachability + Production lock ===');
const humanReviewStateK = _projectHumanReviewStateV2(allApproved());
const { sandbox: sandboxK, renderPlan: renderPlanK } = runFullPipeline(humanReviewStateK);
const missingK = sandboxK.previewGateChecks?.filter((g) => g.required && !g.passed).map((g) => g.id) ?? [];
record('K: all-ten-item approved -> human-review-complete removed', !missingK.includes('human-review-complete'), `missingRequirements=${JSON.stringify(missingK)}`);
record('K: canGeneratePreview = true', sandboxK.canGeneratePreview === true, `canGeneratePreview=${sandboxK.canGeneratePreview}`);
record('K: Render Plan renderable = true', renderPlanK.v2RenderPlan.renderable === true, `renderable=${renderPlanK.v2RenderPlan.renderable}`);

record('L: canWriteProduction = false', sandboxK.canWriteProduction === false, `value=${sandboxK.canWriteProduction}`);
record('L: canExportPreview = false', sandboxK.canExportPreview === false, `value=${sandboxK.canExportPreview}`);
record('L: allowControlledOverlayTest = false', LIGHTROOM_MAPPING_V2_FLAGS.allowControlledOverlayTest === false, `value=${LIGHTROOM_MAPPING_V2_FLAGS.allowControlledOverlayTest}`);
record('L: selectedOutputSource = legacy', sandboxK.selectedOutputSource === 'legacy', `value=${sandboxK.selectedOutputSource}`);

// ── C/D full-pipeline regression: reject/needs-adjustment must still block Preview ──
console.log('');
console.log('=== Full-pipeline regression: reject/needs-adjustment still block Preview ===');
const rejectedReview = { reviewItems: REQUIRED_IDS.map((id, i) => ({ id, status: i === 0 ? 'passed' : 'passed', reviewed: true, reviewerDecision: i === 0 ? 'reject' : 'approve' })) };
const humanReviewStateReject = _projectHumanReviewStateV2(rejectedReview);
const { sandbox: sandboxReject } = runFullPipeline(humanReviewStateReject);
record('C (pipeline): a single reject blocks canGeneratePreview', sandboxReject.canGeneratePreview === false, `canGeneratePreview=${sandboxReject.canGeneratePreview}`);

const adjustReview = { reviewItems: REQUIRED_IDS.map((id, i) => ({ id, status: 'passed', reviewed: true, reviewerDecision: i === 0 ? 'needs-adjustment' : 'approve' })) };
const humanReviewStateAdjust = _projectHumanReviewStateV2(adjustReview);
const { sandbox: sandboxAdjust } = runFullPipeline(humanReviewStateAdjust);
record('D (pipeline): a single needs-adjustment blocks canGeneratePreview', sandboxAdjust.canGeneratePreview === false, `canGeneratePreview=${sandboxAdjust.canGeneratePreview}`);

// ── Summary ──
const pass = results.filter((r) => r.result === 'PASS').length;
const fail = results.filter((r) => r.result === 'FAIL').length;
console.log(`\n${pass}/${results.length} PASS, ${fail} FAIL`);
process.exit(fail > 0 ? 1 : 0);
