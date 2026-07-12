/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CONTROLLED OVERLAY PREVIEW SANDBOX V2 (EPIC 2E-E, patched EPIC 2E-E-F)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Answers: "If we previewed the overlay safely, what abstract preset
 * changes would be simulated, what risks would be reduced, and what
 * must remain blocked?" This is NOT production activation. It builds a
 * SEPARATE, non-production preview object — legacy mapping remains the
 * driver and the actual exported preset.
 *
 * EPIC 2E-E-F rewrote this module's public contract and eligibility
 * logic. Canonical fields (see the return statement) replace the
 * EPIC 2E-E shape; the old field names remain as backward-compatible
 * aliases pointing at the same values so nothing that already reads
 * them breaks, but all NEW logic here — and all integrations — read the
 * canonical names first.
 *
 * HARD GUARANTEES (never derived from any flag or input combination):
 * - `canExportPreview` (and its alias `canExportPreviewXMP`) is always `false`
 * - `canWriteProduction` is always `false`
 * - `selectedOutputSource` is always `"legacy"`
 * - `simulatedPreviewPreset.containsRealSliderValues` is always `false`
 * - `simulatedPreviewPreset.containsXMPValues` is always `false`
 * - the original `legacyPreset`/`legacyMapping`/`legacyOverlaySimulationV2`/
 *   `lightroomSafetyClampV2`/`controlledOverlayTestGateV2` objects are NEVER
 *   mutated — every value is only read and copied into new plain objects
 *   (verified via before/after JSON snapshot tests)
 * - `simulatedPreviewPreset` is always a NEW object, never the same
 *   reference as `legacyPreset`
 *
 * `canGeneratePreview` (canonical; `canCreatePreview` alias) is the one
 * genuinely flag-and-gate-driven output — EPIC 2E-E-F's core fix is that
 * it now requires ALL of: sandbox enabled, generation flag explicitly
 * allowed, the Controlled Overlay Test Gate existing AND indicating
 * controlled-test eligibility, Overlay Simulation/Legacy Safety
 * Overlay/Safety Clamp all existing, no hard stops, no critical
 * over-stack, sufficient confidence AND safety score, AND a complete
 * human review — never just "simulation or overlay exists".
 *
 * GATE-ONLY: not called from anywhere in the production pipeline.
 * `core/lightroom-mapping-engine/index.js`'s `mapStyleFingerprintToLightroom()`
 * does not import this file. Nothing here calls preset-engine or
 * xmp-validator, and this object never feeds XMP export.
 *
 * Every input is OPTIONAL; every access below is null-safe.
 */

import { LIGHTROOM_MAPPING_V2_FLAGS } from './mapping-v2-flags.js';

const clamp01 = (v) => Math.max(0, Math.min(1, v ?? 0));
const RISK_RANK = { none: 0, low: 1, medium: 2, high: 3, critical: 4, unknown: 0 };
const maxRisk = (...vals) => vals.reduce((a, b) => RISK_RANK[b] > RISK_RANK[a] ? b : a, 'none');

/** Canonical previewGateChecks entry shape: {id, label, required, passed, status, reason}. */
function _gate({ id, label, required, passed, status, reason }) {
  return { id, label, required: !!required, passed: !!passed, status, reason };
}

/** Canonical humanReviewChecklist entry shape: {id, label, required, status, reason}. */
function _checklistItem(id, label, required, status, reason) {
  return { id, label, required, status, reason };
}

// ── Legacy Preview Input — READ-ONLY, treats legacy data as immutable ──────
function _buildLegacyPreviewInput(legacyPreset, legacyMapping, legacyStyleBudget) {
  const src = legacyPreset ?? legacyMapping ?? null;
  const notes = [], warnings = [];
  let sourceType, available;

  if (src) {
    sourceType = legacyPreset ? 'legacy-preset' : 'legacy-mapping';
    available = true;
    notes.push('Legacy context is treated as immutable — read only, never modified, never re-emitted as new slider values.');
  } else if (legacyStyleBudget) {
    sourceType = 'legacy-budget-only';
    available = 'partial';
    warnings.push('Legacy preset output is not available; preview sandbox uses partial legacy context.');
  } else {
    sourceType = 'unavailable';
    available = false;
    warnings.push('Legacy preset output is not available; preview sandbox uses partial legacy context.');
  }

  const dimensionsAvailable = [], dimensionsUnavailable = [];
  const dims = ['tonal', 'contrast', 'whiteBalance', 'colorGrading', 'clarity/detail', 'calibration'];
  if (src) {
    if (src.hi != null || src.sh != null) dimensionsAvailable.push('tonal'); else dimensionsUnavailable.push('tonal');
    if (src.con != null) dimensionsAvailable.push('contrast'); else dimensionsUnavailable.push('contrast');
    if (src.temp != null || src.tint != null) dimensionsAvailable.push('whiteBalance'); else dimensionsUnavailable.push('whiteBalance');
    if (src.vib != null || src.sat != null) dimensionsAvailable.push('colorGrading'); else dimensionsUnavailable.push('colorGrading');
    if (src.clarity != null) dimensionsAvailable.push('clarity/detail'); else dimensionsUnavailable.push('clarity/detail');
  } else {
    dimensionsUnavailable.push(...dims.filter(d => d !== 'calibration'));
  }
  if (legacyStyleBudget) dimensionsAvailable.push('calibration'); else dimensionsUnavailable.push('calibration');

  return {
    available, sourceType, immutable: true,
    dimensionsAvailable, dimensionsUnavailable: [...new Set(dimensionsUnavailable)],
    notes, warnings,
  };
}

/**
 * Canonical humanReviewChecklist builder. NEVER assumes review is
 * complete — every item defaults to "pending" (or "not-required" if the
 * overall flag disables the requirement) unless the caller explicitly
 * supplied a passed/failed status via `input.humanReviewState` (an
 * optional, read-only map of {[itemId]: 'passed'|'failed'}).
 */
function _buildHumanReviewChecklist(requireReview, reviewState) {
  const items = [
    ['legacy-output-preserved', 'Confirm legacy output/preset is preserved and unmodified'],
    ['source-image-reviewed', 'Review the source image alongside the preview'],
    ['skin-tones-reviewed', 'Confirm skin tones are protected in the preview'],
    ['highlights-reviewed', 'Confirm highlights are not over-capped or damaged'],
    ['shadows-reviewed', 'Confirm shadow detail is preserved'],
    ['white-balance-reviewed', 'Confirm no unwanted white balance shift'],
    ['color-stacking-reviewed', 'Confirm no risky colour-tool stacking'],
    ['rollback-confirmed', 'Confirm rollback to legacy mapping works as expected'],
    ['preview-non-production-confirmed', 'Confirm the preview is clearly marked non-production'],
    ['export-path-unchanged', 'Confirm the current XMP export path is unchanged'],
  ];
  return items.map(([id, label]) => {
    if (!requireReview) return _checklistItem(id, label, false, 'not-required', 'Human review is not required by current flags.');
    const suppliedStatus = reviewState?.[id];
    if (suppliedStatus === 'passed' || suppliedStatus === 'failed') {
      return _checklistItem(id, label, true, suppliedStatus, `Status supplied by caller: "${suppliedStatus}".`);
    }
    return _checklistItem(id, label, true, 'pending', 'No review has been recorded yet — never assumed complete.');
  });
}

/**
 * Main entry point. Every field optional; every access null-safe.
 * Guaranteed never to throw, including `buildControlledOverlayPreviewSandboxV2({})`.
 * NEVER mutates any input object.
 */
export function buildControlledOverlayPreviewSandboxV2(input = {}) {
  const {
    decision = null, finalStyleIntent = null, legacyPreset = null, legacyMapping = null,
    legacyStyleBudget = null, lightroomMappingPlanV2 = null, lightroomTranslationV2 = null,
    lightroomSafetyClampV2 = null, lightroomShadowCompareReportV2 = null,
    lightroomControlledActivationV2 = null, legacySafetyOverlayV2 = null,
    legacyOverlaySimulationV2 = null, controlledOverlayTestGateV2 = null,
    styleBudgetIntelligence = null, photographerIntent = null, styleDNA = null,
    styleFeasibility = null, captureCapability = null, referenceColorIntelligence = null,
    humanReviewState = null, flags: flagsOverride = null,
  } = input ?? {};

  const flags = { ...LIGHTROOM_MAPPING_V2_FLAGS, ...(flagsOverride ?? {}) };

  const safety = lightroomSafetyClampV2 ?? finalStyleIntent?.lightroomSafetyClampV2 ?? null;
  const shadowCompare = lightroomShadowCompareReportV2 ?? finalStyleIntent?.lightroomShadowCompareReportV2 ?? null;
  const overlay = legacySafetyOverlayV2 ?? finalStyleIntent?.legacySafetyOverlayV2 ?? null;
  const simulation = legacyOverlaySimulationV2 ?? finalStyleIntent?.legacyOverlaySimulationV2 ?? null;
  const testGate = controlledOverlayTestGateV2 ?? finalStyleIntent?.controlledOverlayTestGateV2 ?? null;
  const capture = captureCapability ?? finalStyleIntent?.captureCapabilityEstimate ?? null;
  const legacyBudget = legacyStyleBudget ?? decision?.styleBudget ?? null;

  const hardStopsCount = safety?.hardStops?.length ?? 0;
  const overStackSeverity = safety?.overStackAnalysis?.severity ?? 'unknown';
  const criticalOverstack = overStackSeverity === 'critical';
  const globalSafetyScore = safety?.globalSafetyScore ?? null;

  // EPIC 2E-E-F: "test gate indicates controlled-test eligibility" is a
  // REQUIRED, explicit signal — not inferred from mere existence.
  const testGateEligible = testGate?.canEnterControlledTest === true || testGate?.testEligibility?.eligible === true;

  const missingCount = [!testGate, !simulation, !overlay, !safety].filter(Boolean).length;

  const legacyPreviewInput = _buildLegacyPreviewInput(legacyPreset, legacyMapping, legacyBudget);

  // ── Confidence + Safety Score computed FIRST (no placeholder gate checks) ──
  const legacyAvailabilityFactor = legacyPreviewInput.available === true ? 1 : legacyPreviewInput.available === 'partial' ? 0.5 : 0.2;
  const safetyScore = +clamp01(
    (testGate?.safetyScore ?? 0.3) * 0.20 + (simulation?.safetyScore ?? 0.3) * 0.20 +
    (overlay?.safetyScore ?? 0.3) * 0.15 + (globalSafetyScore ?? 0.3) * 0.25 +
    (hardStopsCount === 0 ? 1 : 0) * 0.10 + legacyAvailabilityFactor * 0.10
  ).toFixed(3);
  const confidence = +clamp01(
    (testGate?.confidence ?? 0.3) * 0.20 + (simulation?.confidence ?? 0.3) * 0.20 +
    (overlay?.confidence ?? 0.3) * 0.15 + (shadowCompare?.confidence ?? 0.3) * 0.15 +
    legacyAvailabilityFactor * 0.30
    - (missingCount >= 3 ? 0.2 : missingCount * 0.05)
  ).toFixed(3);

  // ── Human Review Checklist (never assumed complete) ─────────────────────
  const requireReview = flags.requireHumanReviewForPreview === true;
  const humanReviewChecklist = _buildHumanReviewChecklist(requireReview, humanReviewState);
  const requiredReviewItems = humanReviewChecklist.filter(c => c.required);
  const humanReviewComplete = !requireReview || (requiredReviewItems.length > 0 && requiredReviewItems.every(c => c.status === 'passed'));
  const humanReviewFailed = requiredReviewItems.some(c => c.status === 'failed');

  const confidenceSufficient = confidence >= flags.minOverlayPreviewConfidence;
  const safetyScoreSufficient = safetyScore >= flags.minOverlayPreviewSafetyScore;

  // ── Canonical Preview Gate Checks (deterministic, no placeholders) ──────
  const previewGateChecks = [
    _gate({ id: 'sandbox-enabled', label: 'Preview sandbox enabled', required: true, passed: flags.enableOverlayPreviewSandbox === true, status: flags.enableOverlayPreviewSandbox ? 'passed' : 'disabled', reason: flags.enableOverlayPreviewSandbox ? 'Preview sandbox is enabled.' : 'Preview sandbox is disabled.' }),
    _gate({ id: 'generation-allowed', label: 'Overlay preview generation allowed', required: true, passed: flags.allowOverlayPreviewGeneration === true, status: flags.allowOverlayPreviewGeneration ? 'passed' : 'disabled', reason: flags.allowOverlayPreviewGeneration ? 'Preview generation is allowed.' : 'Preview generation is disabled (default).' }),
    _gate({ id: 'export-disabled', label: 'Preview export disabled', required: true, passed: flags.allowOverlayPreviewExport !== true, status: flags.allowOverlayPreviewExport ? 'failed' : 'passed', reason: flags.allowOverlayPreviewExport ? 'Preview export flag is ENABLED — export still hard-blocked at the output level regardless.' : 'Preview export correctly disabled (default).' }),
    _gate({ id: 'production-write-disabled', label: 'Production write disabled', required: true, passed: flags.allowOverlayPreviewProductionWrite !== true, status: flags.allowOverlayPreviewProductionWrite ? 'failed' : 'passed', reason: flags.allowOverlayPreviewProductionWrite ? 'Production write flag is ENABLED — write still hard-blocked at the output level regardless.' : 'Production write correctly disabled (default).' }),
    _gate({ id: 'preset-mutation-disabled', label: 'Preset mutation disabled', required: true, passed: flags.allowOverlayPreviewPresetMutation !== true, status: flags.allowOverlayPreviewPresetMutation ? 'failed' : 'passed', reason: flags.allowOverlayPreviewPresetMutation ? 'Preset mutation flag is ENABLED — this module never mutates input objects regardless.' : 'Preset mutation correctly disabled (default).' }),
    _gate({ id: 'test-gate-exists', label: 'Controlled Overlay Test Gate exists', required: flags.requireControlledOverlayTestGateForPreview, passed: !!testGate, status: testGate ? 'passed' : 'unavailable', reason: testGate ? 'Controlled Overlay Test Gate V2 is available.' : 'Controlled Overlay Test Gate V2 is missing.' }),
    _gate({ id: 'test-gate-eligible', label: 'Test gate indicates controlled-test eligibility', required: true, passed: testGateEligible, status: testGateEligible ? 'passed' : (testGate ? 'failed' : 'unavailable'), reason: testGate ? `Test gate canEnterControlledTest=${testGate.canEnterControlledTest}, eligibility level=${testGate.testEligibility?.level ?? 'unknown'}.` : 'No test gate available to check eligibility.' }),
    _gate({ id: 'simulation-exists', label: 'Overlay Simulation exists', required: flags.requireOverlaySimulationForPreview, passed: !!simulation, status: simulation ? 'passed' : 'unavailable', reason: simulation ? 'Overlay Simulation V2 is available.' : 'Overlay Simulation V2 is missing.' }),
    _gate({ id: 'overlay-exists', label: 'Legacy Safety Overlay exists', required: flags.requireLegacySafetyOverlayForPreview, passed: !!overlay, status: overlay ? 'passed' : 'unavailable', reason: overlay ? 'Legacy Safety Overlay V2 is available.' : 'Legacy Safety Overlay V2 is missing.' }),
    _gate({ id: 'safety-clamp-exists', label: 'Safety Clamp exists', required: flags.requireSafetyClampForPreview, passed: !!safety, status: safety ? 'passed' : 'unavailable', reason: safety ? 'Safety Clamp V2 is available.' : 'Safety Clamp V2 is missing.' }),
    _gate({ id: 'no-hard-stops', label: 'No hard stops', required: flags.requireNoHardStopsForPreview, passed: hardStopsCount === 0, status: hardStopsCount === 0 ? 'passed' : 'failed', reason: hardStopsCount === 0 ? 'No active hard stops.' : `${hardStopsCount} active hard stop(s).` }),
    _gate({ id: 'no-critical-overstack', label: 'No critical over-stack', required: flags.requireNoCriticalOverstackForPreview, passed: !criticalOverstack, status: criticalOverstack ? 'failed' : 'passed', reason: `Over-stack severity "${overStackSeverity}".` }),
    _gate({ id: 'confidence-sufficient', label: 'Preview confidence sufficient', required: true, passed: confidenceSufficient, status: confidenceSufficient ? 'passed' : 'failed', reason: `Confidence ${confidence} vs. required ${flags.minOverlayPreviewConfidence}.` }),
    _gate({ id: 'safety-score-sufficient', label: 'Preview safety score sufficient', required: true, passed: safetyScoreSufficient, status: safetyScoreSufficient ? 'passed' : 'failed', reason: `Safety score ${safetyScore} vs. required ${flags.minOverlayPreviewSafetyScore}.` }),
    _gate({ id: 'human-review-complete', label: 'Human review complete or not required', required: flags.requireHumanReviewForPreview, passed: humanReviewComplete, status: !requireReview ? 'not-required' : humanReviewFailed ? 'failed' : humanReviewComplete ? 'passed' : 'pending', reason: !requireReview ? 'Human review is not required by current flags.' : humanReviewComplete ? 'All required review items passed.' : humanReviewFailed ? 'One or more required review items failed.' : `${requiredReviewItems.filter(c => c.status === 'pending').length} required review item(s) still pending.` }),
    _gate({ id: 'rollback-available', label: 'Rollback available', required: true, passed: true, status: 'passed', reason: 'Preview-sandbox-only rollback (no production write ever occurs) is always available.' }),
    _gate({ id: 'legacy-context-available', label: 'Legacy mapping/preset/context available or partial fallback available', required: false, passed: legacyPreviewInput.available !== false, status: legacyPreviewInput.available === true ? 'passed' : legacyPreviewInput.available === 'partial' ? 'pending' : 'unavailable', reason: `Legacy preview input availability: ${legacyPreviewInput.available}.` }),
  ];

  const failedRequiredGates = previewGateChecks.filter(g => g.required && !g.passed);
  const allRequiredGatesPass = failedRequiredGates.length === 0;

  // ── Canonical hard guarantees + the one genuinely gated output ─────────
  const canExportPreview = false; // hard-coded — never true in this EPIC, even if allowOverlayPreviewExport is forced true
  const canWriteProduction = false; // hard-coded — never true in this EPIC
  const selectedOutputSource = 'legacy'; // hard-coded — legacy remains the sole production path
  const canGeneratePreview = allRequiredGatesPass; // EPIC 2E-E-F: requires EVERY required gate, not just "data exists"

  // ── Canonical Preview State ──────────────────────────────────────────────
  let previewState;
  if (!flags.enableOverlayPreviewSandbox) {
    previewState = 'disabled';
  } else if (missingCount >= 3 && legacyPreviewInput.available === false) {
    previewState = 'unavailable';
  } else if (hardStopsCount > 0 || criticalOverstack || humanReviewFailed) {
    previewState = 'blocked';
  } else if (canGeneratePreview) {
    previewState = 'preview-ready';
  } else {
    // All technical (non-human-review) gates pass, but human review is
    // the only thing missing → honestly reflect that state.
    const technicalGatesExcludingReview = previewGateChecks.filter(g => g.required && g.id !== 'human-review-complete');
    const technicalGatesPass = technicalGatesExcludingReview.every(g => g.passed);
    if (technicalGatesPass && requireReview && !humanReviewComplete) previewState = 'awaiting-human-review';
    else if (technicalGatesPass) previewState = 'eligible';
    else previewState = 'blocked';
  }

  // ── Preview Eligibility ──────────────────────────────────────────────────
  const previewEligibility = {
    eligible: canGeneratePreview,
    level: previewState,
    reason: canGeneratePreview ? 'All required gates passed, including human review.' : `Not yet eligible — ${failedRequiredGates.length} required gate(s) unmet: ${failedRequiredGates.map(g => g.id).join(', ')}.`,
    missingRequirements: failedRequiredGates.map(g => g.id),
    passedRequirements: previewGateChecks.filter(g => g.passed).map(g => g.id),
  };

  // ── Preview Plan ──────────────────────────────────────────────────────────
  const previewActions = [];
  const addAction = (action, tool, channel, target, severity, reason) => previewActions.push({ action, tool, channel, target, previewOnly: true, severity, reason, source: 'Preview Sandbox V2', productionImpact: canGeneratePreview ? 'preview-only' : 'blocked' });
  addAction('protect-channel', 'HSL', 'red-orange-yellow skin', 'skin tones', capture?.skinReliability != null && capture.skinReliability < 0.45 ? 'high' : 'medium', 'Skin tones are always previewed as protected first.');
  const simActions = simulation?.simulatedOverlayActions ?? [];
  for (const a of simActions) {
    if (a.action === 'keep-legacy' || a.action === 'require-human-review') continue;
    addAction(a.action, a.tool, a.channel, a.target, a.severity, `Derived from Overlay Simulation V2: ${a.reason}`);
  }
  if (hardStopsCount > 0) addAction('require-human-review', 'all', 'all', 'overall safety', 'critical', `${hardStopsCount} active hard stop(s) — preview recommends human review before anything further.`);
  if (previewActions.length === 1) addAction('no-action', 'all', 'all', 'overall direction', 'low', 'No specific risky areas beyond default skin protection — preview recommends keeping legacy mapping as-is.');

  const previewPlan = {
    mode: !canGeneratePreview ? 'disabled' : 'preview-object-only',
    planState: canGeneratePreview ? (legacyPreviewInput.available === true ? 'preview-object-ready' : 'partial-preview') : 'disabled',
    actions: previewActions,
    blockedActions: ['write overlay to production XMP', 'mutate legacy preset', 'replace legacy mapping', 'export preview as real XMP'],
    protectedAreas: previewActions.filter(a => a.action === 'protect-channel').map(a => a.target),
    suppressedRisks: previewActions.filter(a => a.action === 'suppress-risk').map(a => a.target),
    reasons: [`Preview plan mode is "${!canGeneratePreview ? 'disabled' : 'preview-object-only'}" — no action here ever writes to production XMP or mutates the legacy preset.`],
    warnings: legacyPreviewInput.available !== true ? ['Legacy input is partial or unavailable — preview plan is based on incomplete data.'] : [],
  };

  // ── Canonical Simulated Preview Preset (hard guarantees) ────────────────
  let simulatedPreviewPreset;
  if (!canGeneratePreview) {
    simulatedPreviewPreset = {
      available: false, mode: 'non-production-preview', source: 'legacy-plus-overlay-simulation',
      productionSafe: false, exportEligible: false, appliedToProduction: false,
      containsRealSliderValues: false, containsXMPValues: false,
      values: {}, adjustments: [], metadata: { legacyPreviewInputAvailable: legacyPreviewInput.available, canGeneratePreview },
      reason: `Preview not generated — ${failedRequiredGates.length ? `required gate(s) unmet: ${failedRequiredGates.map(g => g.id).join(', ')}` : 'preview generation is not currently eligible'}.`,
    };
  } else {
    const adjustments = previewActions.filter(a => a.action !== 'no-action' && a.action !== 'require-human-review').map(a => {
      const intensity = a.severity === 'critical' ? 0.85 : a.severity === 'high' ? 0.65 : a.severity === 'medium' ? 0.45 : 0.25;
      const direction = a.action === 'protect-channel' ? 'reduce aggressive shift' : a.action === 'suppress-risk' ? 'suppress risky direction' : a.action === 'cap-intensity' ? 'cap intensity' : a.action === 'warn' ? 'flag for caution' : 'maintain restraint';
      return { area: a.target, simulatedChange: `${a.action.replace('-', ' ')} on ${a.tool}${a.channel && a.channel !== 'all' ? ` / ${a.channel}` : ''}`, direction, intensity: +clamp01(intensity).toFixed(3), reason: a.reason, source: a.source, productionImpact: 'preview-only' };
    });
    // `values` is a NEW plain object — never the legacyPreset reference,
    // and never contains real Lightroom slider values, only abstract
    // 0-1 normalized entries keyed by area.
    const values = {};
    for (const adj of adjustments) values[adj.area] = { direction: adj.direction, intensity: adj.intensity };
    simulatedPreviewPreset = {
      available: true, mode: 'non-production-preview', source: 'legacy-plus-overlay-simulation',
      productionSafe: false, exportEligible: false, appliedToProduction: false,
      containsRealSliderValues: false, containsXMPValues: false,
      values, adjustments,
      metadata: { legacyPreviewInputAvailable: legacyPreviewInput.available, sourceType: legacyPreviewInput.sourceType, adjustmentCount: adjustments.length },
      reason: 'Abstract, non-production preview object — normalized 0-1 intensities only, no Lightroom slider values, no XMP fields, never written to production.',
    };
  }

  // ── Canonical Preview Risk Review (missing evidence never implies low risk) ──
  const riskFrom = (val, fallback = 'unknown') => val ?? fallback;
  const previewRiskReview = {
    level: legacyPreviewInput.riskLevelComputed ?? (hardStopsCount > 0 ? 'high' : criticalOverstack ? 'critical' : legacyPreviewInput.available === true ? 'medium' : 'unknown'),
    hardStops: hardStopsCount,
    overStackSeverity: riskFrom(overStackSeverity),
    skinRisk: riskFrom(capture?.skinReliability != null ? (capture.skinReliability < 0.45 ? 'high' : 'low') : null),
    highlightRisk: riskFrom(capture?.highlightRecovery != null ? (capture.highlightRecovery < 0.4 ? 'high' : 'low') : null),
    shadowRisk: riskFrom(capture?.shadowRecovery != null ? (capture.shadowRecovery < 0.4 ? 'high' : 'low') : null),
    whiteBalanceRisk: riskFrom(capture?.whiteBalanceLatitude != null ? (capture.whiteBalanceLatitude < 0.4 ? 'medium' : 'low') : null),
    colorRisk: riskFrom(capture?.colorLatitude != null ? (capture.colorLatitude < 0.4 ? 'medium' : 'low') : null),
    exportRisk: 'none', // export is hard-blocked in this EPIC — no export can occur, so no export risk exists
    productionWriteRisk: 'none', // production write is hard-blocked in this EPIC
    findings: [
      `${hardStopsCount} hard stop(s), over-stack severity "${overStackSeverity}".`,
      legacyPreviewInput.available !== true ? 'Legacy context is partial/unavailable — risk findings for missing dimensions are "unknown", never assumed low.' : 'Legacy context is available for risk review.',
    ],
  };

  // ── Safety Requirements ──────────────────────────────────────────────────
  const safetyRequirements = {
    noHardStops: hardStopsCount === 0,
    noCriticalOverstack: !criticalOverstack,
    minSafetyScorePassed: safetyScoreSufficient,
    minConfidencePassed: confidenceSufficient,
    legacyFallbackAvailable: true,
    productionWriteDisabled: true, // always true in this EPIC
    exportDisabled: true, // always true in this EPIC
    humanReviewComplete,
    reasons: [`Safety requirements evaluated against thresholds: safetyScore>=${flags.minOverlayPreviewSafetyScore}, confidence>=${flags.minOverlayPreviewConfidence}.`],
    warnings: globalSafetyScore == null ? ['Global safety score is unavailable — safety requirement cannot be confidently evaluated.'] : [],
  };

  // ── Rollback / Fallback ───────────────────────────────────────────────────
  const rollbackPlan = {
    available: true,
    restoreSource: 'legacy',
    productionMutationDetected: false,
    steps: [
      'Discard the isolated preview object.',
      'Restore the selected output source to legacy.',
      'Keep production Lightroom Mapping unchanged.',
      'Keep the existing XMP export path unchanged.',
    ],
    // Backward-compatible fields from EPIC 2E-E/2E-E-F — kept as-is.
    strategy: 'preview-sandbox-no-production-write',
    triggerConditions: ['preview gate failure', 'hard stop', 'critical overstack', 'XMP validation failure', 'user disables preview flag', 'confidence below threshold', 'human review failed'],
    restoreTarget: 'legacy Lightroom Mapping',
    reason: 'The preview sandbox never writes production output or exports real XMP in the first place — "rollback" here means simply not consuming the preview object, which leaves legacy mapping completely untouched.',
  };
  const fallbackStrategy = {
    useLegacyMapping: true,
    selectedFallback: 'legacy Lightroom Mapping',
    safeMode: true,
    reason: 'This module only builds an abstract, non-production preview object — legacy Lightroom Mapping remains the exclusive production path regardless of preview output.',
  };

  // ── Blockers ──────────────────────────────────────────────────────────────
  const blockers = [];
  if (!flags.enableOverlayPreviewSandbox) blockers.push({ blocker: 'Preview sandbox is disabled.', severity: 'high', requiredFix: 'Set LIGHTROOM_MAPPING_V2_FLAGS.enableOverlayPreviewSandbox to true.', source: 'Feature Flags' });
  if (!flags.allowOverlayPreviewGeneration) blockers.push({ blocker: 'Overlay preview generation is disabled.', severity: 'critical', requiredFix: 'Set LIGHTROOM_MAPPING_V2_FLAGS.allowOverlayPreviewGeneration to true in a future, deliberate change.', source: 'Feature Flags' });
  // EPIC 2E-E-G: preview export and production write being disabled are
  // INTENTIONAL DESIGN CONSTRAINTS of this EPIC, not failures blocking
  // preview generation — moved out of blockers[] into their own
  // explicit, always-visible productionRestrictions[] array so a
  // preview-ready state never reports itself as "blocked" by its own
  // by-design safety rails.
  if (!testGateEligible) blockers.push({ blocker: 'Controlled Overlay Test Gate does not indicate controlled-test eligibility.', severity: 'high', requiredFix: 'Wait for the test gate to reach controlled-test eligibility before generating a preview.', source: 'Controlled Overlay Test Gate V2' });
  if (requireReview && !humanReviewComplete) blockers.push({ blocker: `Human review is ${humanReviewFailed ? 'failed' : 'incomplete'} (${requiredReviewItems.filter(c => c.status === 'pending').length} item(s) pending).`, severity: 'critical', requiredFix: 'Complete all required human review checklist items.', source: 'Human Review Process' });
  if (hardStopsCount > 0) blockers.push({ blocker: `Safety clamp contains ${hardStopsCount} hard stop(s).`, severity: 'critical', requiredFix: 'Resolve all active hard stops before trusting this preview.', source: 'Safety Clamp V2' });
  if (criticalOverstack) blockers.push({ blocker: 'Over-stack risk is critical.', severity: 'critical', requiredFix: 'Reduce over-stacked tool combinations.', source: 'Safety Clamp V2' });
  if (legacyPreviewInput.available !== true) blockers.push({ blocker: 'Legacy preset/mapping output is not fully available.', severity: 'medium', requiredFix: 'Supply legacyPreset/legacyMapping, or run the preview sandbox after legacy mapping completes.', source: 'Legacy Mapping' });
  if (missingCount > 0) blockers.push({ blocker: `${missingCount} of 4 core V2 inputs are missing or incomplete.`, severity: 'medium', requiredFix: 'Ensure the full V2 chain (EPIC 2A-2E-D) has run.', source: 'Input Validation' });

  const warnings = [...(legacyPreviewInput.warnings ?? [])], reasons = [];
  reasons.push(`Preview state "${previewState}" — canGeneratePreview=${canGeneratePreview}, canExportPreview=${canExportPreview}, canWriteProduction=${canWriteProduction}, selectedOutputSource="${selectedOutputSource}".`);
  if (failedRequiredGates.length) reasons.push(`${failedRequiredGates.length} of ${previewGateChecks.filter(g => g.required).length} required gate(s) failed: ${failedRequiredGates.map(g => g.id).join(', ')}.`);
  if (missingCount > 0) warnings.push(`${missingCount} of 4 core inputs (testGate/simulation/overlay/safety) missing or incomplete — preview eligibility reflects a rough sketch.`);
  if (hardStopsCount > 0) warnings.push(`${hardStopsCount} active hard stop(s) — preview includes a require-human-review action.`);
  if (requireReview && !humanReviewComplete) warnings.push('Human review is not complete — never assumed passed by default.');

  // EPIC 2E-E-G: intentional, by-design safety rails — always visible
  // and explicit, but never reported as a preview-generation blocker.
  // A preview can be fully "preview-ready" while these still apply.
  const productionRestrictions = [
    { restriction: 'Preview export is disabled by design in this EPIC.', severity: 'info', reason: 'Export capability is out of scope for this EPIC — not a failure, an intentional constraint.', source: 'Feature Flags' },
    { restriction: 'Production write is disabled by design in this EPIC.', severity: 'info', reason: 'Production write capability is out of scope for this EPIC — not a failure, an intentional constraint.', source: 'Feature Flags' },
  ];
  reasons.push('Preview export and production write are intentionally disabled by design in this EPIC — see productionRestrictions[], not blockers[].');

  const photographerSummary = canGeneratePreview
    ? 'Legacy Mapping is still active. A safe abstract preview of what V2 would protect or suppress is ready to review, but it does not change exported XMP.'
    : previewState === 'awaiting-human-review'
      ? 'Legacy Mapping is still active. Preview Sandbox is technically ready, but human review must be completed before a preview object can be generated.'
      : 'Legacy Mapping is still active. Preview Sandbox is prepared, but preview generation, export, and production write are all disabled by default.';
  const developerSummary = `canGeneratePreview=${canGeneratePreview}; canExportPreview=false and canWriteProduction=false always; selectedOutputSource=legacy; simulatedPreviewPreset contains no real Lightroom slider values or XMP fields. previewState=${previewState}, ${previewEligibility.missingRequirements.length} missing requirement(s), humanReviewComplete=${humanReviewComplete}.`;

  const result = {
    // ── Canonical fields (EPIC 2E-E-F) ──
    mode: 'controlled-overlay-preview-sandbox',
    previewState, canGeneratePreview, canExportPreview, canWriteProduction, selectedOutputSource,
    previewGateChecks, blockers, productionRestrictions, warnings, reasons,
    previewEligibility, previewPlan, simulatedPreviewPreset, previewRiskReview,
    humanReviewChecklist, safetyRequirements,
    rollbackPlan, fallbackStrategy,
    confidence, safetyScore,
    photographerSummary, developerSummary,
  };

  // ── Backward-compatible aliases (EPIC 2E-E names) — same values, not duplicated logic ──
  result.sandboxState = result.previewState;
  result.canCreatePreview = result.canGeneratePreview;
  result.canExportPreviewXMP = result.canExportPreview;
  result.previewOverlayPlan = result.previewPlan;
  result.previewPresetShadow = result.simulatedPreviewPreset;
  result.humanReviewNotes = humanReviewChecklist.filter(c => c.required).map(c => ({ note: c.label, severity: c.status === 'failed' ? 'critical' : 'medium', requiredBefore: 'production-write', reason: c.reason }));
  // Legacy risk-before/after/delta fields some older callers may still read.
  result.previewRiskBefore = { overallRisk: previewRiskReview.level, areas: previewPlan.protectedAreas, reasons: ['See previewRiskReview for the canonical, structured risk breakdown.'] };
  result.previewRiskAfter = { overallRisk: canGeneratePreview ? 'low' : previewRiskReview.level, areas: previewPlan.protectedAreas, reasons: ['This is a PREVIEW estimate only — no production change actually occurred.'] };
  result.previewRiskDelta = { improved: canGeneratePreview, deltaLevel: canGeneratePreview ? 'small' : 'unknown', improvedAreas: previewPlan.protectedAreas, unchangedAreas: [], unresolvedRisks: previewActions.filter(a => a.action === 'require-human-review').map(a => a.target), confidence: +clamp01(legacyPreviewInput.available === true ? 0.5 : 0.2).toFixed(3), reasons: ['This is a PREVIEW, report-only estimate — it does not claim any actual final image quality improvement.'] };

  return result;
}
