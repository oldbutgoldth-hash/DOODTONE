/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CONTROLLED OVERLAY TEST GATE V2 (EPIC 2E-D)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Answers: "Is the overlay simulation safe enough to enter a controlled
 * TEST mode?" This is NOT production activation — it evaluates
 * readiness, builds a test plan, a human-review checklist, and safety
 * requirements for a future, separate controlled test that does not
 * happen in this stage.
 *
 * HARD GUARANTEE: `canWriteProduction` is hard-coded `false` — Task 3
 * states this must remain false for this EPIC regardless of any flag.
 * `canEnterControlledTest` and `canPreviewOverlayPreset` are derived
 * from `allowControlledOverlayTest`/`allowOverlayTestPresetPreview`
 * (both default `false`), so with defaults they are also always
 * `false`, and `selectedOutputSource` is always `"legacy"`.
 *
 * GATE-ONLY: not called from anywhere in the production pipeline.
 * `core/lightroom-mapping-engine/index.js`'s `mapStyleFingerprintToLightroom()`
 * does not import this file and does not read `controlledOverlayTestGateV2`.
 *
 * Every input is OPTIONAL; every access below is null-safe. Never
 * mutates any input object it reads.
 */

import { LIGHTROOM_MAPPING_V2_FLAGS } from './mapping-v2-flags.js';

const clamp01 = (v) => Math.max(0, Math.min(1, v ?? 0));

/** Task 4: one test-gate-check entry. */
function _gate({ name, passed, required, severity, reason, source }) {
  return { name, passed: !!passed, required: !!required, severity, reason, source };
}

/** Task 8: one human-review-checklist entry. */
function _checklistItem(item, required, status, reason) {
  return { item, required, status, reason };
}

/**
 * Main entry point. Every field optional; every access null-safe.
 * Guaranteed never to throw, including `buildControlledOverlayTestGateV2({})`.
 * Never mutates any input object.
 */
export function buildControlledOverlayTestGateV2(input = {}) {
  const {
    decision = null, finalStyleIntent = null, legacyPreset = null, legacyMapping = null,
    legacyStyleBudget = null, lightroomMappingPlanV2 = null, lightroomTranslationV2 = null,
    lightroomSafetyClampV2 = null, lightroomShadowCompareReportV2 = null,
    lightroomControlledActivationV2 = null, legacySafetyOverlayV2 = null,
    legacyOverlaySimulationV2 = null, styleBudgetIntelligence = null,
    photographerIntent = null, styleDNA = null, styleFeasibility = null,
    captureCapability = null, referenceColorIntelligence = null, flags: flagsOverride = null,
  } = input ?? {};

  const flags = { ...LIGHTROOM_MAPPING_V2_FLAGS, ...(flagsOverride ?? {}) };

  const safety = lightroomSafetyClampV2 ?? finalStyleIntent?.lightroomSafetyClampV2 ?? null;
  const shadowCompare = lightroomShadowCompareReportV2 ?? finalStyleIntent?.lightroomShadowCompareReportV2 ?? null;
  const activation = lightroomControlledActivationV2 ?? finalStyleIntent?.lightroomControlledActivationV2 ?? null;
  const overlay = legacySafetyOverlayV2 ?? finalStyleIntent?.legacySafetyOverlayV2 ?? null;
  const simulation = legacyOverlaySimulationV2 ?? finalStyleIntent?.legacyOverlaySimulationV2 ?? null;
  const legacyOutput = legacyPreset ?? legacyMapping ?? null;
  const legacyBudget = legacyStyleBudget ?? decision?.styleBudget ?? null;
  const legacyAvailable = legacyOutput != null || legacyBudget != null || simulation?.legacyInputSummary?.available === true;

  const hardStopsCount = safety?.hardStops?.length ?? 0;
  const overStackSeverity = safety?.overStackAnalysis?.severity ?? 'unknown';
  const criticalOverstack = overStackSeverity === 'critical';
  const globalSafetyScore = safety?.globalSafetyScore ?? null;
  const shadowStatus = shadowCompare?.safetyDelta?.status ?? 'unavailable';
  const simulationConfidence = simulation?.confidence ?? null;
  const simulationSafetyScore = simulation?.safetyScore ?? null;
  const rollbackFromActivation = activation?.rollbackPlan?.available === true;

  const missingCount = [!simulation, !overlay, !safety, !shadowCompare, !activation].filter(Boolean).length;

  // ── Task 4: Test Gate Checks (16) ────────────────────────────────────────
  const humanReviewNotRequired = flags.requireHumanReviewForOverlayTest !== true;
  const testGateChecks = [
    _gate({ name: 'controlled overlay test gate enabled', passed: flags.enableControlledOverlayTestGate === true, required: true, severity: 'high', reason: flags.enableControlledOverlayTestGate ? 'Test gate is enabled.' : 'Test gate is disabled.', source: 'Feature Flags' }),
    _gate({ name: 'controlled overlay test allowed', passed: flags.allowControlledOverlayTest === true, required: true, severity: 'critical', reason: flags.allowControlledOverlayTest ? 'Controlled test is allowed.' : 'Controlled test is disabled (default).', source: 'Feature Flags' }),
    _gate({ name: 'overlay preset preview allowed', passed: flags.allowOverlayTestPresetPreview === true, required: true, severity: 'critical', reason: flags.allowOverlayTestPresetPreview ? 'Preset preview is allowed.' : 'Preset preview is disabled (default).', source: 'Feature Flags' }),
    _gate({ name: 'production write disabled', passed: flags.allowOverlayTestProductionWrite !== true, required: true, severity: 'critical', reason: flags.allowOverlayTestProductionWrite ? 'Production write is ENABLED — unexpected in this phase.' : 'Production write correctly disabled (default).', source: 'Feature Flags' }),
    _gate({ name: 'overlay simulation exists', passed: !!simulation, required: flags.requireOverlaySimulationForTest, severity: 'high', reason: simulation ? 'Overlay Simulation V2 is available.' : 'Overlay Simulation V2 is missing.', source: 'Overlay Simulation V2' }),
    _gate({ name: 'legacy safety overlay exists', passed: !!overlay, required: flags.requireLegacySafetyOverlayForTest, severity: 'high', reason: overlay ? 'Legacy Safety Overlay V2 is available.' : 'Legacy Safety Overlay V2 is missing.', source: 'Legacy Safety Overlay V2' }),
    _gate({ name: 'safety clamp exists', passed: !!safety, required: flags.requireSafetyClampForTest, severity: 'high', reason: safety ? 'Safety Clamp V2 is available.' : 'Safety Clamp V2 is missing.', source: 'Safety Clamp V2' }),
    _gate({ name: 'shadow compare exists', passed: !!shadowCompare, required: flags.requireShadowCompareForTest, severity: 'medium', reason: shadowCompare ? 'Shadow Compare Report V2 is available.' : 'Shadow Compare Report V2 is missing.', source: 'Shadow Compare Report V2' }),
    _gate({ name: 'controlled activation gate exists', passed: !!activation, required: false, severity: 'medium', reason: activation ? 'Controlled Activation Gate is available.' : 'Controlled Activation Gate is missing.', source: 'Controlled Activation Gate' }),
    _gate({ name: 'no hard stops', passed: hardStopsCount === 0, required: flags.requireNoHardStopsForOverlayTest, severity: 'critical', reason: hardStopsCount === 0 ? 'No active hard stops.' : `${hardStopsCount} active hard stop(s).`, source: 'Safety Clamp V2' }),
    _gate({ name: 'no critical over-stack', passed: !criticalOverstack, required: flags.requireNoCriticalOverstackForOverlayTest, severity: 'critical', reason: `Over-stack severity "${overStackSeverity}".`, source: 'Safety Clamp V2' }),
    _gate({ name: 'overlay simulation confidence sufficient', passed: simulationConfidence != null && simulationConfidence >= flags.minOverlaySimulationConfidence, required: true, severity: 'medium', reason: simulationConfidence != null ? `Simulation confidence ${simulationConfidence} vs. required ${flags.minOverlaySimulationConfidence}.` : 'Simulation confidence unavailable.', source: 'Overlay Simulation V2' }),
    _gate({ name: 'overlay simulation safety score sufficient', passed: simulationSafetyScore != null && simulationSafetyScore >= flags.minOverlaySimulationSafetyScore, required: true, severity: 'medium', reason: simulationSafetyScore != null ? `Simulation safety score ${simulationSafetyScore} vs. required ${flags.minOverlaySimulationSafetyScore}.` : 'Simulation safety score unavailable.', source: 'Overlay Simulation V2' }),
    _gate({ name: 'human review completed or not required', passed: humanReviewNotRequired, required: flags.requireHumanReviewForOverlayTest, severity: 'critical', reason: humanReviewNotRequired ? 'Human review is not required by current flags.' : 'No mechanism in this codebase can mark human review as complete — this gate can only be satisfied by an explicit future process.', source: 'Human Review Process' }),
    _gate({ name: 'rollback available', passed: true, required: true, severity: 'critical', reason: 'Legacy-only rollback is always available regardless of test-gate state.', source: 'Legacy Mapping' }),
    _gate({ name: 'legacy mapping/preset available or partial fallback available', passed: legacyAvailable, required: false, severity: 'medium', reason: legacyAvailable ? 'Legacy context is available (full or partial).' : 'No legacy context available at all.', source: 'Legacy Mapping' }),
  ];

  const failedRequiredGates = testGateChecks.filter(g => g.required && !g.passed);
  const allRequiredGatesPass = failedRequiredGates.length === 0;

  // ── Task 3: hard guarantees ──────────────────────────────────────────────
  const canWriteProduction = false; // hard-coded — Task 3: must remain false for this EPIC regardless of any flag
  const canEnterControlledTest = flags.allowControlledOverlayTest === true && allRequiredGatesPass;
  const canPreviewOverlayPreset = flags.allowOverlayTestPresetPreview === true && !!simulation;
  const selectedOutputSource = 'legacy'; // hard-coded — no production write path exists in this phase

  // ── Task 3: Test State ───────────────────────────────────────────────────
  let testState;
  if (!flags.enableControlledOverlayTestGate) {
    testState = 'blocked';
  } else if (!simulation || missingCount >= 3) {
    testState = 'unavailable';
  } else if (hardStopsCount > 0 || criticalOverstack) {
    testState = 'blocked';
  } else if (canEnterControlledTest) {
    testState = 'eligible-for-controlled-test';
  } else if (flags.allowOverlayTestPresetPreview && canPreviewOverlayPreset) {
    testState = 'eligible-for-controlled-preview';
  } else if (globalSafetyScore != null && globalSafetyScore >= flags.minOverlayTestSafetyScore && simulationConfidence != null && simulationConfidence >= flags.minOverlayTestConfidence) {
    testState = 'ready-for-human-review';
  } else {
    testState = 'report-only';
  }

  // ── Task 6: Test Eligibility ─────────────────────────────────────────────
  const missingRequirements = failedRequiredGates.map(g => g.name);
  const passedRequirements = testGateChecks.filter(g => g.passed).map(g => g.name);
  const riskNotes = [];
  if (hardStopsCount > 0) riskNotes.push(`${hardStopsCount} active hard stop(s) in Safety Clamp V2.`);
  if (criticalOverstack) riskNotes.push('Critical over-stack risk detected.');
  if (shadowStatus === 'riskier' || shadowStatus === 'uncertain') riskNotes.push(`Shadow compare status is "${shadowStatus}" — not a confident safety signal.`);
  if (!legacyAvailable) riskNotes.push('No legacy context available — eligibility assessment is based on V2 shadow objects only.');

  const eligibilityLevel = !flags.enableControlledOverlayTestGate ? 'not-eligible'
    : canEnterControlledTest ? 'controlled-test-eligible'
    : canPreviewOverlayPreset ? 'preview-eligible'
    : (globalSafetyScore != null && globalSafetyScore >= flags.minOverlayTestSafetyScore) ? 'human-review-needed'
    : 'report-only';
  const testEligibility = {
    eligible: canEnterControlledTest, // false by default — allowControlledOverlayTest defaults false
    level: eligibilityLevel,
    reason: canEnterControlledTest ? 'All required gates passed and controlled test flag is explicitly enabled.' : `Not yet eligible for a controlled test — ${missingRequirements.length} required gate(s) unmet.`,
    missingRequirements, passedRequirements, riskNotes,
  };

  // ── Task 7: Test Plan ─────────────────────────────────────────────────────
  const testPlanMode = canEnterControlledTest ? 'controlled-test' : canPreviewOverlayPreset ? 'preview-only' : 'report-only';
  const testPlan = {
    mode: testPlanMode,
    allowedActions: [
      'inspect overlay simulation',
      'review simulated clamp actions',
      'compare risk before/after',
      'review protected areas',
      'export legacy XMP only',
    ],
    prohibitedActions: [
      'write overlay to production XMP',
      'mutate legacy preset',
      'replace legacy mapping',
      'bypass human review',
      'ignore hard stops',
    ],
    requiredSteps: [
      'human review',
      'real image test',
      'XMP regression test',
      'rollback verification',
      'compare Legacy vs overlay preview',
      'confirm no skin/highlight/shadow regression',
    ],
    testScope: testPlanMode === 'report-only' ? 'Report/inspection only — no preset preview or production write occurs.' : testPlanMode === 'preview-only' ? 'Overlay output may be previewed as a non-production preset only.' : 'A controlled, flagged test scope — still never writes production XMP directly from this gate.',
    successCriteria: [
      'no XMP regression',
      'improved safety notes',
      'no hard stops',
      'skin protection maintained',
      'highlight/shadow safety maintained',
      'mobile/console clean',
    ],
    stopConditions: [
      'hard stop detected',
      'critical overstack',
      'XMP validation failure',
      'visual regression',
      'user disables overlay flag',
    ],
  };

  // ── Task 8: Human Review Checklist ───────────────────────────────────────
  const reviewStatus = (condition) => flags.requireHumanReviewForOverlayTest ? (condition ? 'pending' : 'not-required') : 'not-required';
  const humanReviewChecklist = [
    _checklistItem('Review shadow compare report', true, reviewStatus(!!shadowCompare), shadowCompare ? 'Shadow Compare Report V2 is available for review.' : 'Shadow Compare Report V2 is not available yet.'),
    _checklistItem('Review safety clamp hard stops', true, reviewStatus(!!safety), safety ? `${hardStopsCount} hard stop(s) currently active.` : 'Safety Clamp V2 is not available yet.'),
    _checklistItem('Review overlay simulation actions', true, reviewStatus(!!simulation), simulation ? `${simulation.simulatedOverlayActions?.length ?? 0} simulated action(s) to review.` : 'Overlay Simulation V2 is not available yet.'),
    _checklistItem('Test with real portrait image', true, reviewStatus(true), 'Requires a real-image test pass, not yet performed.'),
    _checklistItem('Test with high-key image', true, reviewStatus(true), 'Requires a real-image test pass, not yet performed.'),
    _checklistItem('Test with moody image', true, reviewStatus(true), 'Requires a real-image test pass, not yet performed.'),
    _checklistItem('Confirm skin tones are protected', true, reviewStatus(true), 'Requires human visual confirmation, not yet performed.'),
    _checklistItem('Confirm highlights are not damaged', true, reviewStatus(true), 'Requires human visual confirmation, not yet performed.'),
    _checklistItem('Confirm XMP output unchanged with default flags', true, reviewStatus(true), 'Requires a regression test run, not yet performed.'),
    _checklistItem('Confirm rollback behavior', true, reviewStatus(true), 'Requires a rollback drill, not yet performed.'),
  ];

  // ── Task 9: Safety Requirements ──────────────────────────────────────────
  const safetyReqWarnings = [];
  if (globalSafetyScore == null) safetyReqWarnings.push('Global safety score is unavailable — safety requirement cannot be confidently evaluated.');
  if (!legacyAvailable) safetyReqWarnings.push('Legacy context is unavailable — safety requirements are based on V2 shadow objects only.');
  const safetyRequirements = {
    noHardStops: hardStopsCount === 0,
    noCriticalOverstack: !criticalOverstack,
    minSafetyScorePassed: globalSafetyScore != null && globalSafetyScore >= flags.minOverlayTestSafetyScore,
    minConfidencePassed: simulationConfidence != null && simulationConfidence >= flags.minOverlayTestConfidence,
    legacyFallbackAvailable: true,
    productionWriteDisabled: true, // always true in EPIC 2E-D
    reasons: [`Safety requirements evaluated against thresholds: safetyScore>=${flags.minOverlayTestSafetyScore}, confidence>=${flags.minOverlayTestConfidence}.`],
    warnings: safetyReqWarnings,
  };

  // ── Task 10: Confidence + Safety Score ───────────────────────────────────
  const legacyAvailabilityFactor = legacyAvailable ? 1 : 0.3;
  const safetyScore = +clamp01(
    (globalSafetyScore ?? 0.3) * 0.30 + (simulationSafetyScore ?? 0.3) * 0.25 +
    (overlay?.safetyScore ?? 0.3) * 0.15 + (hardStopsCount === 0 ? 1 : 0) * 0.15 +
    (rollbackFromActivation || true ? 1 : 0) * 0.05 + legacyAvailabilityFactor * 0.10
  ).toFixed(3);
  // Production write being disabled must NOT itself lower confidence (Task 10 rule).
  const confidence = +clamp01(
    (simulationConfidence ?? 0.3) * 0.30 + (overlay?.confidence ?? 0.3) * 0.20 +
    (shadowCompare?.confidence ?? 0.3) * 0.15 + legacyAvailabilityFactor * 0.20 +
    (activation?.confidence ?? 0.3) * 0.15
    - (missingCount >= 3 ? 0.2 : missingCount * 0.05)
  ).toFixed(3);

  // ── Task 11: Rollback + Fallback ─────────────────────────────────────────
  const rollbackPlan = {
    available: true,
    strategy: 'test-gate-legacy-fallback',
    triggerConditions: [
      'test gate failure', 'hard stop', 'critical overstack', 'XMP validation failure',
      'production error', 'user disables test flag', 'confidence below threshold', 'human review failed',
    ],
    restoreTarget: 'legacy Lightroom Mapping',
    reason: 'No controlled test has actually run in this phase — "rollback" here means the test gate simply stays closed, leaving legacy mapping untouched.',
  };
  const fallbackStrategy = {
    useLegacyMapping: true,
    selectedFallback: 'legacy Lightroom Mapping',
    safeMode: true,
    reason: 'EPIC 2E-D only evaluates test-gate readiness — legacy Lightroom Mapping remains the exclusive production path regardless of gate outcome.',
  };

  const warnings = [], reasons = [];
  reasons.push(`Test state "${testState}" — canEnterControlledTest=${canEnterControlledTest}, canPreviewOverlayPreset=${canPreviewOverlayPreset}, canWriteProduction=${canWriteProduction}, selectedOutputSource="${selectedOutputSource}".`);
  if (failedRequiredGates.length) reasons.push(`${failedRequiredGates.length} of ${testGateChecks.filter(g => g.required).length} required gate(s) failed: ${failedRequiredGates.map(g => g.name).join(', ')}.`);
  if (missingCount > 0) warnings.push(`${missingCount} of 5 core inputs (simulation/overlay/safety/shadowCompare/activation) missing or incomplete — test-gate evaluation is a rough sketch.`);
  if (hardStopsCount > 0) warnings.push(`${hardStopsCount} active hard stop(s) — controlled test remains blocked.`);

  const photographerSummary = 'Legacy Mapping is still active. Overlay Test Gate is prepared, but overlay preview and production write are disabled by default.';
  const developerSummary = `canEnterControlledTest=false by default; canWriteProduction=false; selectedOutputSource=legacy; fallbackStrategy.useLegacyMapping=true. testState=${testState}, ${testEligibility.missingRequirements.length} missing requirement(s).`;

  // ── Task 5: Blockers ──────────────────────────────────────────────────────
  const blockers = [];
  if (!flags.allowControlledOverlayTest) blockers.push({ blocker: 'Controlled overlay test flag is disabled.', severity: 'critical', requiredFix: 'Set LIGHTROOM_MAPPING_V2_FLAGS.allowControlledOverlayTest to true in a future, deliberate change.', source: 'Feature Flags' });
  if (!flags.allowOverlayTestPresetPreview) blockers.push({ blocker: 'Overlay preset preview is disabled.', severity: 'high', requiredFix: 'Set LIGHTROOM_MAPPING_V2_FLAGS.allowOverlayTestPresetPreview to true in a future, deliberate change.', source: 'Feature Flags' });
  if (flags.requireHumanReviewForOverlayTest) blockers.push({ blocker: 'Human review is required before controlled test.', severity: 'critical', requiredFix: 'Complete a human review process (does not exist in this codebase yet) and record its result.', source: 'Human Review Process' });
  if (!simulation) blockers.push({ blocker: 'Overlay simulation is missing.', severity: 'high', requiredFix: 'Ensure EPIC 2E-C simulation runs before the test gate.', source: 'Overlay Simulation V2' });
  if (!overlay) blockers.push({ blocker: 'Legacy Safety Overlay is missing.', severity: 'medium', requiredFix: 'Ensure EPIC 2E-B overlay runs before the test gate.', source: 'Legacy Safety Overlay V2' });
  if (hardStopsCount > 0) blockers.push({ blocker: 'Safety Clamp has hard stops.', severity: 'critical', requiredFix: 'Resolve all active hard stops before any future test.', source: 'Safety Clamp V2' });
  if (criticalOverstack) blockers.push({ blocker: 'Over-stack risk is critical.', severity: 'critical', requiredFix: 'Reduce over-stacked tool combinations.', source: 'Safety Clamp V2' });
  if (shadowStatus === 'uncertain' || shadowStatus === 'riskier') blockers.push({ blocker: `Shadow Compare is "${shadowStatus}".`, severity: 'high', requiredFix: 'Wait for a more confident shadow-compare signal.', source: 'Shadow Compare Report V2' });
  // Production write disabled by design is a deliberate SAFETY blocker, not a system failure (Task 5).
  blockers.push({ blocker: 'Production write is disabled by design in EPIC 2E-D.', severity: 'critical', requiredFix: 'A future, separate EPIC would need to introduce production write capability — not in scope here.', source: 'Feature Flags' });

  return {
    mode: 'controlled-overlay-test-gate',
    testState, canEnterControlledTest, canPreviewOverlayPreset, canWriteProduction, selectedOutputSource,
    testGateChecks, blockers, warnings, reasons,
    testEligibility, testPlan, humanReviewChecklist, safetyRequirements,
    rollbackPlan, fallbackStrategy,
    confidence, safetyScore,
    photographerSummary, developerSummary,
  };
}
