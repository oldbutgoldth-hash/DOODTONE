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

// ── FIX 3-F (EPIC 2E-J-C-F2 Step 3-F): conservative rank-based duplicate precedence ──
console.log('');
console.log('=== Step 3-F: Conservative duplicate precedence (failed > pending > passed) ===');

const _pending = { id: ID, status: 'pending', reviewed: false, reviewerDecision: 'undecided' };
const _passed = { id: ID, status: 'passed', reviewed: true, reviewerDecision: 'approve' };
const _needsAdj = { id: ID, status: 'passed', reviewed: true, reviewerDecision: 'needs-adjustment' };
const _unreviewed = { id: ID, status: 'passed', reviewed: false, reviewerDecision: 'approve' };
const _undecidedPassed = { id: ID, status: 'passed', reviewed: true, reviewerDecision: 'undecided' };
const _failed = { id: ID, status: 'failed', reviewed: true, reviewerDecision: 'reject' };

const t1 = _projectHumanReviewStateV2({ reviewItems: [_pending, _passed] });
record('1: pending then passed -> omitted', t1[ID] === undefined, JSON.stringify(t1));

const t2 = _projectHumanReviewStateV2({ reviewItems: [_passed, _pending] });
record('2: passed then pending -> omitted', t2[ID] === undefined, JSON.stringify(t2));

const t3 = _projectHumanReviewStateV2({ reviewItems: [_needsAdj, _passed] });
record('3: needs-adjustment then passed -> omitted', t3[ID] === undefined, JSON.stringify(t3));

const t4 = _projectHumanReviewStateV2({ reviewItems: [_passed, _needsAdj] });
record('4: passed then needs-adjustment -> omitted', t4[ID] === undefined, JSON.stringify(t4));

const t5 = _projectHumanReviewStateV2({ reviewItems: [_unreviewed, _passed] });
record('5: unreviewed then passed -> omitted', t5[ID] === undefined, JSON.stringify(t5));

const t6 = _projectHumanReviewStateV2({ reviewItems: [_passed, _unreviewed] });
record('6: passed then unreviewed -> omitted', t6[ID] === undefined, JSON.stringify(t6));

const t7 = _projectHumanReviewStateV2({ reviewItems: [_undecidedPassed] });
record('7: passed+reviewed=true+undecided -> omitted', t7[ID] === undefined, JSON.stringify(t7));

const t8a = _projectHumanReviewStateV2({ reviewItems: [_failed, _pending, _passed] });
const t8b = _projectHumanReviewStateV2({ reviewItems: [_passed, _failed, _pending] });
const t8c = _projectHumanReviewStateV2({ reviewItems: [_pending, _passed, _failed] });
record('8: failed+pending+passed, any order -> failed always wins', t8a[ID] === 'failed' && t8b[ID] === 'failed' && t8c[ID] === 'failed', `order1=${t8a[ID]}, order2=${t8b[ID]}, order3=${t8c[ID]}`);

const t9 = _projectHumanReviewStateV2({ reviewItems: [_passed, _passed] });
record('9: approved duplicate entries -> passed', t9[ID] === 'passed', JSON.stringify(t9));

const humanReviewStateT10 = _projectHumanReviewStateV2(allApproved());
const { sandbox: sandboxT10, renderPlan: renderPlanT10 } = runFullPipeline(humanReviewStateT10);
record('10: all ten properly approved -> canGeneratePreview=true', sandboxT10.canGeneratePreview === true, `canGeneratePreview=${sandboxT10.canGeneratePreview}`);
record('10: all ten properly approved -> Render Plan renderable=true', renderPlanT10.v2RenderPlan.renderable === true, `renderable=${renderPlanT10.v2RenderPlan.renderable}`);

// Test 11: buildFinalPreset-level integration — every checklist ID
// carries one pending duplicate AND one passed duplicate.
const mixedAllIds = { reviewItems: REQUIRED_IDS.flatMap((id) => [
  { id, status: 'pending', reviewed: false, reviewerDecision: 'undecided' },
  { id, status: 'passed', reviewed: true, reviewerDecision: 'approve' },
]) };
const humanReviewStateT11 = _projectHumanReviewStateV2(mixedAllIds);
record('11: every ID has a pending+passed duplicate -> projected map empty', Object.keys(humanReviewStateT11).length === 0, JSON.stringify(humanReviewStateT11));
const { sandbox: sandboxT11 } = runFullPipeline(humanReviewStateT11);
const missingT11 = sandboxT11.previewGateChecks?.filter((g) => g.required && !g.passed).map((g) => g.id) ?? [];
record('11: Sandbox Human Review remains incomplete', missingT11.includes('human-review-complete'), `missingRequirements=${JSON.stringify(missingT11)}`);
record('11: canGeneratePreview remains false', sandboxT11.canGeneratePreview === false, `canGeneratePreview=${sandboxT11.canGeneratePreview}`);

record('12: canWriteProduction = false', sandboxT10.canWriteProduction === false, `value=${sandboxT10.canWriteProduction}`);
record('12: canExportPreview = false', sandboxT10.canExportPreview === false, `value=${sandboxT10.canExportPreview}`);
record('12: allowControlledOverlayTest = false', LIGHTROOM_MAPPING_V2_FLAGS.allowControlledOverlayTest === false, `value=${LIGHTROOM_MAPPING_V2_FLAGS.allowControlledOverlayTest}`);
record('12: selectedOutputSource = legacy', sandboxT10.selectedOutputSource === 'legacy', `value=${sandboxT10.selectedOutputSource}`);

// ── FIX 6 (EPIC 2E-J-C-F2 Step 4-6): Identity Preview honesty + actual buildFinalPreset integration ──
console.log('');
console.log('=== Step 4-6: Identity Preview honesty + buildFinalPreset integration ===');

const { buildFinalPreset } = await import('../core/decision-engine/index.js');
const { applyPreviewPixelTransformV2 } = await import('../ui/isolated-visual-preview-renderer-v2.js');

// Test A: ACTUAL buildFinalPreset call (not a manually duplicated
// module call) — every checklist ID carries one pending duplicate and
// one passed duplicate.
const mixedReviewA = { reviewItems: REQUIRED_IDS.flatMap((id) => [
  { id, status: 'pending', reviewed: false, reviewerDecision: 'undecided' },
  { id, status: 'passed', reviewed: true, reviewerDecision: 'approve' },
]) };
const resultA = buildFinalPreset({ controlledPreviewReviewStateV2: mixedReviewA });
const sandboxA = resultA._decision?.finalStyleIntent?.controlledOverlayPreviewSandboxV2;
const missingA = sandboxA?.previewGateChecks?.filter((g) => g.required && !g.passed).map((g) => g.id) ?? [];
record('A: buildFinalPreset duplicate integration — Sandbox exists', !!sandboxA, `sandbox exists=${!!sandboxA}`);
record('A: buildFinalPreset duplicate integration — human-review-complete missing', missingA.includes('human-review-complete'), `missingRequirements=${JSON.stringify(missingA)}`);
record('A: buildFinalPreset duplicate integration — canGeneratePreview=false', sandboxA?.canGeneratePreview === false, `canGeneratePreview=${sandboxA?.canGeneratePreview}`);

// Test B: ACTUAL buildFinalPreset call with all ten genuinely approved.
// Empty synthetic analysis input may leave another genuine evidence
// gate (e.g. confidence) unmet — reported honestly, never fabricated.
const allApprovedB = { reviewItems: REQUIRED_IDS.map((id) => ({ id, status: 'passed', reviewed: true, reviewerDecision: 'approve' })) };
const resultB = buildFinalPreset({ controlledPreviewReviewStateV2: allApprovedB });
const sandboxB = resultB._decision?.finalStyleIntent?.controlledOverlayPreviewSandboxV2;
const missingB = sandboxB?.previewGateChecks?.filter((g) => g.required && !g.passed).map((g) => ({ id: g.id, reason: g.reason })) ?? [];
console.log(`  [INFO] B: buildFinalPreset approved integration — Sandbox state: canGeneratePreview=${sandboxB?.canGeneratePreview}, confidence=${sandboxB?.confidence}, safetyScore=${sandboxB?.safetyScore}, selectedOutputSource=${sandboxB?.selectedOutputSource}, missingRequirements=${JSON.stringify(missingB)}`);
record('B: buildFinalPreset approved integration — human-review-complete itself no longer blocks', !missingB.some((g) => g.id === 'human-review-complete'), `missingRequirements=${JSON.stringify(missingB.map((g) => g.id))}`);
record('B: buildFinalPreset approved integration — selectedOutputSource=legacy', sandboxB?.selectedOutputSource === 'legacy', `value=${sandboxB?.selectedOutputSource}`);

// Test C: direct complete-evidence Identity Preview.
const testGateC = buildControlledOverlayTestGateV2({ legacyOverlaySimulationV2, legacySafetyOverlayV2, lightroomSafetyClampV2, lightroomShadowCompareReportV2, legacyPreset });
const humanReviewStateC = _projectHumanReviewStateV2(allApproved());
const sandboxC = buildControlledOverlayPreviewSandboxV2({ legacyOverlaySimulationV2, legacySafetyOverlayV2, lightroomSafetyClampV2, lightroomShadowCompareReportV2, legacyPreset, controlledOverlayTestGateV2: testGateC, humanReviewState: humanReviewStateC });
const renderPlanC = buildVisualPreviewRenderPlanV2({ controlledOverlayPreviewSandboxV2: sandboxC });
record('C: Sandbox canGeneratePreview=true', sandboxC.canGeneratePreview === true, `value=${sandboxC.canGeneratePreview}`);
record('C: simulatedPreviewPreset.available=true', sandboxC.simulatedPreviewPreset?.available === true, `value=${sandboxC.simulatedPreviewPreset?.available}`);
record('C: Render Plan renderable=true', renderPlanC.v2RenderPlan.renderable === true, `value=${renderPlanC.v2RenderPlan.renderable}`);
const identityReasonPresent = renderPlanC.v2RenderPlan.reasons.some((r) => /identity/i.test(r)) || renderPlanC.v2RenderPlan.warnings.some((w) => /identity/i.test(w));
record('C: Identity Preview reason/warning present', identityReasonPresent, JSON.stringify(renderPlanC.v2RenderPlan.reasons));
record('C: canWriteProduction=false', sandboxC.canWriteProduction === false, `value=${sandboxC.canWriteProduction}`);
record('C: canExportPreview=false', sandboxC.canExportPreview === false, `value=${sandboxC.canExportPreview}`);
record('C: selectedOutputSource=legacy', sandboxC.selectedOutputSource === 'legacy', `value=${sandboxC.selectedOutputSource}`);

// Test D: missing Sandbox entirely.
const renderPlanD = buildVisualPreviewRenderPlanV2({});
record('D: missing Sandbox -> renderable=false', renderPlanD.v2RenderPlan.renderable === false, `value=${renderPlanD.v2RenderPlan.renderable}`);
record('D: missing Sandbox -> not Identity Preview', !renderPlanD.v2RenderPlan.reasons.some((r) => /identity/i.test(r)), JSON.stringify(renderPlanD.v2RenderPlan.reasons));

// Test E: Sandbox present but unavailable.
const renderPlanE = buildVisualPreviewRenderPlanV2({ controlledOverlayPreviewSandboxV2: { simulatedPreviewPreset: { available: false } } });
record('E: Sandbox unavailable -> renderable=false', renderPlanE.v2RenderPlan.renderable === false, `value=${renderPlanE.v2RenderPlan.renderable}`);
record('E: Sandbox unavailable -> not Identity Preview', !renderPlanE.v2RenderPlan.reasons.some((r) => /identity/i.test(r)), JSON.stringify(renderPlanE.v2RenderPlan.reasons));

// Test F: malformed simulated preset (not an object).
let crashedF = false;
let renderPlanF;
try { renderPlanF = buildVisualPreviewRenderPlanV2({ controlledOverlayPreviewSandboxV2: { simulatedPreviewPreset: 'not-an-object' } }); } catch { crashedF = true; }
record('F: malformed simulated preset -> no crash', !crashedF, `crashed=${crashedF}`);
record('F: malformed simulated preset -> renderable=false', renderPlanF?.v2RenderPlan.renderable === false, `value=${renderPlanF?.v2RenderPlan.renderable}`);

// Test G: safety blocker (hard stop active) — Sandbox itself cannot generate preview.
const unsafeClamp = { hardStops: [{ reason: 'test hard stop' }], overStackAnalysis: { severity: 'low' }, globalSafetyScore: 0.9 };
const testGateG = buildControlledOverlayTestGateV2({ legacyOverlaySimulationV2, legacySafetyOverlayV2, lightroomSafetyClampV2: unsafeClamp, lightroomShadowCompareReportV2, legacyPreset });
const sandboxG = buildControlledOverlayPreviewSandboxV2({ legacyOverlaySimulationV2, legacySafetyOverlayV2, lightroomSafetyClampV2: unsafeClamp, lightroomShadowCompareReportV2, legacyPreset, controlledOverlayTestGateV2: testGateG, humanReviewState: _projectHumanReviewStateV2(allApproved()) });
const renderPlanG = buildVisualPreviewRenderPlanV2({ controlledOverlayPreviewSandboxV2: sandboxG });
record('G: hard stop -> Sandbox canGeneratePreview=false', sandboxG.canGeneratePreview === false, `value=${sandboxG.canGeneratePreview}`);
record('G: hard stop -> Render Plan renderable=false', renderPlanG.v2RenderPlan.renderable === false, `value=${renderPlanG.v2RenderPlan.renderable}`);

// Test H: contradictory Production evidence.
const renderPlanH = buildVisualPreviewRenderPlanV2({ controlledOverlayPreviewSandboxV2: { simulatedPreviewPreset: { available: true, appliedToProduction: true } } });
record('H: contradictory evidence -> renderable=false', renderPlanH.v2RenderPlan.renderable === false, `value=${renderPlanH.v2RenderPlan.renderable}`);
record('H: contradictory evidence -> blocker identifies it', renderPlanH.v2RenderPlan.reasons.some((r) => /contradictory/i.test(r)), JSON.stringify(renderPlanH.v2RenderPlan.reasons));

// Test I: genuine supported adjustment, via the isolated renderer's own
// contract (colorGrading with a non-zero shadowSat/highlightSat) — not
// adding a new supported-adjustment field, just exercising the one the
// Render Plan/renderer contract already supports.
const imgWidth = 2, imgHeight = 2;
const imgData = new Uint8ClampedArray(imgWidth * imgHeight * 4).fill(128);
for (let i = 3; i < imgData.length; i += 4) imgData[i] = 255;
const transformResultI = applyPreviewPixelTransformV2({ data: imgData, width: imgWidth, height: imgHeight }, { colorGrading: { shadowSat: 0.3, highlightSat: 0.2 } });
record('I: genuine supported adjustment -> transformed=true', transformResultI.transformed === true, `transformed=${transformResultI.transformed}`);
record('I: genuine supported adjustment -> appliedAdjustments non-empty', transformResultI.appliedAdjustments.length > 0, JSON.stringify(transformResultI.appliedAdjustments));

// Test L: Production Mapping regression — identical Basic/WB/HSL/
// Color-Grading/Calibration/Tone-Curve fields with vs. without Review
// state, using the canonical buildFinalPreset output shape (not a
// hand-picked subset).
const resultWithoutReview = buildFinalPreset({});
const resultWithReview = buildFinalPreset({ controlledPreviewReviewStateV2: allApprovedB });
const metadataKeys = new Set(['_decision', '_mappingTrace']);
let productionMappingIdentical = true;
const differences = [];
for (const key of Object.keys(resultWithoutReview)) {
  if (metadataKeys.has(key)) continue;
  if (JSON.stringify(resultWithoutReview[key]) !== JSON.stringify(resultWithReview[key])) {
    productionMappingIdentical = false;
    differences.push(key);
  }
}
record('L: Production Mapping fields identical with/without Review state', productionMappingIdentical, differences.length ? `differing fields: ${differences.join(', ')}` : 'all fields identical');

// ── Summary ──
const pass = results.filter((r) => r.result === 'PASS').length;
const fail = results.filter((r) => r.result === 'FAIL').length;
console.log(`\n${pass}/${results.length} PASS, ${fail} FAIL`);
process.exit(fail > 0 ? 1 : 0);
