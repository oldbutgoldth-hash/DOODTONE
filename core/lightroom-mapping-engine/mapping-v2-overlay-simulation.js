/**
 * ═══════════════════════════════════════════════════════════════════════════
 * OVERLAY PREVIEW / CONTROLLED OVERLAY SIMULATION (EPIC 2E-C)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Answers: "If Legacy Safety Overlay WERE allowed to act, what would it
 * recommend capping, protecting, or suppressing?" A pure simulation/
 * preview layer. Legacy Mapping remains the driver; this module never
 * writes production output, never mutates the legacy preset, and never
 * replaces legacy mapping.
 *
 * HARD GUARANTEE: `canApplyToProduction` is always `false` and
 * `selectedOutputSource` is always `"legacy"` in this phase —
 * `allowOverlaySimulationProductionWrite` and
 * `allowOverlaySimulationPresetMutation` default `false` in
 * mapping-v2-flags.js, and this module additionally never assigns to
 * any property of an input object (every legacy value is only READ,
 * classified abstractly, and copied into new plain objects — the
 * original `legacyPreset`/`legacyMapping` reference is provably
 * untouched, verified via a before/after JSON snapshot test).
 *
 * GATE-ONLY: not called from anywhere in the production pipeline.
 * `core/lightroom-mapping-engine/index.js`'s `mapStyleFingerprintToLightroom()`
 * does not import this file and does not read `legacyOverlaySimulationV2`.
 *
 * Every input is OPTIONAL; every access below is null-safe.
 */

import { LIGHTROOM_MAPPING_V2_FLAGS } from './mapping-v2-flags.js';

const clamp01 = (v) => Math.max(0, Math.min(1, v ?? 0));
const RISK_RANK = { none: 0, low: 1, medium: 2, high: 3, critical: 4, unknown: 0 };
const maxRisk = (...vals) => vals.reduce((a, b) => RISK_RANK[b] > RISK_RANK[a] ? b : a, 'none');

/** Task 4: one simulation gate-check entry. */
function _gate({ name, passed, required, severity, reason, source }) {
  return { name, passed: !!passed, required: !!required, severity, reason, source };
}

// ── Task 5: Legacy Input Summary — READ-ONLY classification, never mutates ──
function _buildLegacyInputSummary(legacyPreset, legacyMapping, legacyStyleBudget) {
  const src = legacyPreset ?? legacyMapping ?? null;
  const notes = [], warnings = [];
  let sourceType, available;

  if (src) {
    sourceType = legacyPreset ? 'legacy-preset' : 'legacy-mapping';
    available = true;
    notes.push(`Legacy ${sourceType === 'legacy-preset' ? 'preset' : 'mapping'} output is available — simulation classifies it abstractly, never modifies it.`);
  } else if (legacyStyleBudget) {
    sourceType = 'legacy-budget-only';
    available = 'partial';
    warnings.push('Legacy preset output is not available; simulation uses legacy budget/context only.');
  } else {
    sourceType = 'unavailable';
    available = false;
    warnings.push('No legacy context available at all — simulation is based on V2 shadow objects only.');
  }

  const dims = ['tonal', 'contrast', 'whiteBalance', 'colorGrading', 'clarity/detail', 'calibration'];
  const editableDimensions = [], unavailableDimensions = [];
  if (src) {
    if (src.hi != null || src.sh != null) editableDimensions.push('tonal'); else unavailableDimensions.push('tonal');
    if (src.con != null) editableDimensions.push('contrast'); else unavailableDimensions.push('contrast');
    if (src.temp != null || src.tint != null) editableDimensions.push('whiteBalance'); else unavailableDimensions.push('whiteBalance');
    if (src.vib != null || src.sat != null) editableDimensions.push('colorGrading'); else unavailableDimensions.push('colorGrading');
    if (src.clarity != null) editableDimensions.push('clarity/detail'); else unavailableDimensions.push('clarity/detail');
  } else {
    unavailableDimensions.push(...dims.filter(d => d !== 'calibration'));
  }
  if (legacyStyleBudget) editableDimensions.push('calibration'); else unavailableDimensions.push('calibration');

  let riskLevel = 'unknown';
  if (src) {
    const risky = [src.hi, src.sh, src.clarity].filter(v => v != null && Math.abs(v) / 100 >= 0.25).length;
    riskLevel = risky >= 2 ? 'high' : risky === 1 ? 'medium' : 'low';
  } else if (legacyStyleBudget && (legacyStyleBudget.calibration ?? 0) > 0.5) {
    riskLevel = 'medium';
  }

  return { available, sourceType, riskLevel, editableDimensions, unavailableDimensions: [...new Set(unavailableDimensions)], notes, warnings };
}

/**
 * Main entry point. Every field optional; every access null-safe.
 * Guaranteed never to throw, including `buildLegacyOverlaySimulationV2({})`.
 * NEVER mutates any input object — every legacy value is only read.
 */
export function buildLegacyOverlaySimulationV2(input = {}) {
  const {
    decision = null, finalStyleIntent = null, legacyPreset = null, legacyMapping = null,
    legacyStyleBudget = null, lightroomMappingPlanV2 = null, lightroomTranslationV2 = null,
    lightroomSafetyClampV2 = null, lightroomShadowCompareReportV2 = null,
    lightroomControlledActivationV2 = null, legacySafetyOverlayV2 = null,
    styleBudgetIntelligence = null, photographerIntent = null, styleDNA = null,
    styleFeasibility = null, captureCapability = null, referenceColorIntelligence = null,
    flags: flagsOverride = null,
  } = input ?? {};

  const flags = { ...LIGHTROOM_MAPPING_V2_FLAGS, ...(flagsOverride ?? {}) };

  const safety = lightroomSafetyClampV2 ?? finalStyleIntent?.lightroomSafetyClampV2 ?? null;
  const shadowCompare = lightroomShadowCompareReportV2 ?? finalStyleIntent?.lightroomShadowCompareReportV2 ?? null;
  const activation = lightroomControlledActivationV2 ?? finalStyleIntent?.lightroomControlledActivationV2 ?? null;
  const overlay = legacySafetyOverlayV2 ?? finalStyleIntent?.legacySafetyOverlayV2 ?? null;
  const capture = captureCapability ?? finalStyleIntent?.captureCapabilityEstimate ?? null;
  const legacyBudget = legacyStyleBudget ?? decision?.styleBudget ?? null;

  const hardStopsCount = safety?.hardStops?.length ?? 0;
  const overStackSeverity = safety?.overStackAnalysis?.severity ?? 'unknown';
  const criticalOverstack = overStackSeverity === 'critical';
  const globalSafetyScore = safety?.globalSafetyScore ?? null;

  const missingCount = [!overlay, !safety, !activation, !shadowCompare].filter(Boolean).length;

  // ── Task 5: Legacy Input Summary (read-only) ────────────────────────────
  const legacyInputSummary = _buildLegacyInputSummary(legacyPreset, legacyMapping, legacyBudget);

  // ── Task 4: Simulation Gate Checks (10) ─────────────────────────────────
  const simulationGateChecks = [
    _gate({ name: 'overlay simulation enabled', passed: flags.enableLegacyOverlaySimulation === true, required: true, severity: 'high', reason: flags.enableLegacyOverlaySimulation ? 'Simulation is enabled.' : 'Simulation is disabled.', source: 'Feature Flags' }),
    _gate({ name: 'simulation report allowed', passed: flags.allowOverlaySimulationReport === true, required: true, severity: 'medium', reason: flags.allowOverlaySimulationReport ? 'Report output is allowed.' : 'Report output is disabled.', source: 'Feature Flags' }),
    _gate({ name: 'production write disabled', passed: flags.allowOverlaySimulationProductionWrite !== true, required: true, severity: 'critical', reason: flags.allowOverlaySimulationProductionWrite ? 'Production write is ENABLED — unexpected in this phase.' : 'Production write correctly disabled (default).', source: 'Feature Flags' }),
    _gate({ name: 'preset mutation disabled', passed: flags.allowOverlaySimulationPresetMutation !== true, required: true, severity: 'critical', reason: flags.allowOverlaySimulationPresetMutation ? 'Preset mutation is ENABLED — unexpected in this phase.' : 'Preset mutation correctly disabled (default).', source: 'Feature Flags' }),
    _gate({ name: 'legacy safety overlay exists', passed: !!overlay, required: flags.requireLegacyOverlayForSimulation, severity: 'high', reason: overlay ? 'Legacy Safety Overlay V2 is available.' : 'Legacy Safety Overlay V2 is missing.', source: 'Legacy Safety Overlay V2' }),
    _gate({ name: 'safety clamp exists', passed: !!safety, required: flags.requireSafetyClampForSimulation, severity: 'high', reason: safety ? 'Safety Clamp V2 is available.' : 'Safety Clamp V2 is missing.', source: 'Safety Clamp V2' }),
    _gate({ name: 'controlled activation gate exists', passed: !!activation, required: flags.requireControlledActivationGateForSimulation, severity: 'medium', reason: activation ? 'Controlled Activation Gate is available.' : 'Controlled Activation Gate is missing.', source: 'Controlled Activation Gate' }),
    _gate({ name: 'legacy mapping or preset available', passed: legacyInputSummary.available !== false, required: false, severity: 'medium', reason: `Legacy input availability: ${legacyInputSummary.available}.`, source: 'Legacy Mapping' }),
    _gate({ name: 'no critical hard stops', passed: hardStopsCount === 0, required: false, severity: 'critical', reason: hardStopsCount === 0 ? 'No active hard stops.' : `${hardStopsCount} active hard stop(s).`, source: 'Safety Clamp V2' }),
    _gate({ name: 'rollback available', passed: true, required: true, severity: 'critical', reason: 'Simulation-only rollback (no production write ever occurs) is always available.', source: 'Legacy Mapping' }),
  ];

  const failedRequiredGates = simulationGateChecks.filter(g => g.required && !g.passed);

  // ── Task 3: canApplyToProduction / selectedOutputSource — hard guarantees ──
  const canApplyToProduction = false; // hard-coded: EPIC 2E-C never writes production output
  const selectedOutputSource = 'legacy'; // hard-coded: legacy remains the sole production path
  const canSimulate = flags.enableLegacyOverlaySimulation === true && flags.allowOverlaySimulationReport === true;

  // ── Task 3: Simulation State ─────────────────────────────────────────────
  let simulationState;
  if (!flags.enableLegacyOverlaySimulation) {
    simulationState = 'disabled';
  } else if (legacyInputSummary.available === false && missingCount >= 3) {
    simulationState = 'unavailable';
  } else if (legacyInputSummary.available !== true || missingCount > 0) {
    simulationState = 'partial-preview';
  } else if (hardStopsCount > 0 || criticalOverstack) {
    simulationState = 'partial-preview';
  } else if (globalSafetyScore != null && globalSafetyScore >= flags.minSimulationSafetyScore && (shadowCompare?.confidence ?? 0) >= flags.minSimulationConfidence) {
    simulationState = 'ready-for-human-review';
  } else {
    simulationState = 'report-only';
  }

  // ── Task 6: Simulated Overlay Actions ────────────────────────────────────
  const simulatedOverlayActions = [];
  const addAction = (action, tool, channel, target, severity, reason) => simulatedOverlayActions.push({ action, tool, channel, target, simulationOnly: true, severity, reason, source: 'Overlay Simulation V2', wouldAffectProduction: false });

  addAction('protect-channel', 'HSL', 'red-orange-yellow skin', 'skin tones', capture?.skinReliability != null && capture.skinReliability < 0.45 ? 'high' : 'medium', 'Skin tones are always simulated as protected first.');
  const overlayRiskyAreas = overlay?.legacyRiskReview?.riskyAreas ?? [];
  for (const risk of overlayRiskyAreas) {
    if (risk === 'highlight pressure') addAction('warn', 'Basic Tone', 'highlights', 'highlight roll-off', 'high', 'Legacy risk review flags highlight pressure.');
    else if (risk === 'shadow crushing') addAction('protect-channel', 'Basic Tone', 'shadows', 'shadow detail', 'high', 'Legacy risk review flags shadow crushing.');
    else if (risk === 'aggressive calibration') addAction('suppress-risk', 'Calibration', 'all', 'calibration restraint', 'medium', 'Legacy risk review flags aggressive calibration.');
    else if (risk === 'harsh clarity/detail') addAction('cap-intensity', 'Presence', 'clarity', 'texture/clarity', 'medium', 'Legacy risk review flags harsh clarity/detail.');
    else if (risk === 'WB shift risk') addAction('warn', 'White Balance', 'temp/tint', 'WB stability', 'medium', 'Legacy risk review flags a WB shift risk.');
    else if (risk === 'heavy color grading') addAction('suppress-risk', 'Color Grading', 'all', 'colour restraint', 'medium', 'Legacy risk review flags heavy colour grading.');
  }
  if ((safety?.clampProfiles?.presence?.clampSeverity ?? 'none') !== 'none') addAction('cap-intensity', 'Presence', 'clarity', 'texture/clarity', 'medium', 'Safety Clamp V2 profile already flags Presence for capping (e.g. estimated noise reliability).');
  if (hardStopsCount > 0) addAction('require-human-review', 'all', 'all', 'overall safety', 'critical', `${hardStopsCount} active hard stop(s) in Safety Clamp V2 — simulation recommends human review before any future action.`);
  if (simulatedOverlayActions.length === 1) addAction('keep-legacy', 'all', 'all', 'overall direction', 'low', 'No specific risky areas identified beyond the default skin protection — simulation recommends keeping legacy mapping as-is.');

  // ── Task 7: Simulated Clamp Preview (report-only / simulated-only, never applied) ──
  const clampMode = legacyInputSummary.available === true ? 'simulated-only' : 'report-only';
  const clampItems = simulatedOverlayActions.filter(a => a.action !== 'keep-legacy').map(a => ({
    tool: a.tool, channel: a.channel,
    clampType: a.action === 'warn' ? 'block-aggressive-direction' : a.action === 'protect-channel' ? 'protect-channel' : a.action === 'suppress-risk' ? 'suppress-tool' : a.action === 'cap-intensity' ? 'cap-intensity' : 'reduce-risk',
    originalRisk: a.severity, simulatedRiskAfterClamp: a.severity === 'critical' ? 'medium' : a.severity === 'high' ? 'low' : 'none',
    severity: a.severity, reason: a.reason, source: a.source,
    wouldAffectProduction: false,
  }));
  const simulatedClampPreview = {
    mode: clampMode, canApply: false, appliedToProduction: false,
    clampItems,
    summary: `${clampItems.length} simulated clamp item(s) previewed as ${clampMode}; none applied to production.`,
    reasons: [`Simulation clamp preview is "${clampMode}" — production write and preset mutation remain disabled by default.`],
    warnings: legacyInputSummary.available !== true ? ['Legacy input is partial or unavailable — simulated clamp preview is based on incomplete data.'] : [],
  };

  // ── Task 8: Risk Before / After / Delta ─────────────────────────────────
  const riskyAreasBefore = [...new Set(simulatedOverlayActions.filter(a => a.action !== 'keep-legacy' && a.action !== 'require-human-review').map(a => a.target))];
  const overallRiskBefore = legacyInputSummary.riskLevel !== 'unknown' ? legacyInputSummary.riskLevel : (hardStopsCount > 0 ? 'high' : overStackSeverity !== 'unknown' ? overStackSeverity : 'unknown');
  const simulatedRiskBefore = {
    overallRisk: overallRiskBefore,
    riskyAreas: riskyAreasBefore,
    reasons: [`Before-state derived from legacy risk review (available=${legacyInputSummary.available}) and Safety Clamp V2 signals.`],
  };

  const improvedAreas = clampItems.filter(c => RISK_RANK[c.simulatedRiskAfterClamp] < RISK_RANK[c.originalRisk]).map(c => c.tool);
  const remainingRisks = clampItems.filter(c => c.simulatedRiskAfterClamp !== 'none').map(c => `${c.tool}: ${c.simulatedRiskAfterClamp}`);
  const overallRiskAfter = clampItems.length ? maxRisk(...clampItems.map(c => c.simulatedRiskAfterClamp), 'none') : overallRiskBefore;
  const simulatedRiskAfter = {
    overallRisk: legacyInputSummary.available === true ? overallRiskAfter : overallRiskBefore,
    remainingRisks, improvedAreas,
    reasons: [legacyInputSummary.available === true ? 'After-state is a SIMULATED estimate only — no production change actually occurred.' : 'Legacy input is partial/unavailable — after-state is not meaningfully different from before-state.'],
  };

  const deltaConfidenceBase = legacyInputSummary.available === true ? 0.6 : 0.25;
  const deltaLevel = legacyInputSummary.available !== true ? (improvedAreas.length ? 'small' : 'unknown')
    : improvedAreas.length >= 3 ? 'strong' : improvedAreas.length === 2 ? 'moderate' : improvedAreas.length === 1 ? 'small' : 'none';
  const simulatedRiskDelta = {
    improved: legacyInputSummary.available === true && improvedAreas.length > 0,
    deltaLevel,
    improvedAreas, unchangedAreas: legacyInputSummary.editableDimensions.filter(d => !improvedAreas.some(a => a.toLowerCase().includes(d.split('/')[0]))),
    unresolvedRisks: remainingRisks,
    confidence: +clamp01(deltaConfidenceBase).toFixed(3),
    reasons: [
      'This is a SIMULATED, report-only estimate — it does not claim any actual final image quality improvement.',
      ...(legacyInputSummary.available !== true ? ['Legacy preset data is partial/unavailable, so this delta is a rough estimate, not a considered one.'] : []),
    ],
  };

  // ── Task 9: Protected Areas / Suppressed Risks / No Action Areas ────────
  const protectedAreas = simulatedOverlayActions.filter(a => a.action === 'protect-channel').map(a => ({
    area: a.target, protectionLevel: a.severity, reason: a.reason, source: a.source, simulatedAction: a.action,
  }));
  const suppressedRisks = simulatedOverlayActions.filter(a => a.action === 'suppress-risk').map(a => ({
    risk: a.target, simulatedSuppression: `simulation would suppress "${a.channel}" on ${a.tool}`, severity: a.severity, reason: a.reason, source: a.source,
    activeInProduction: false,
  }));
  const noActionAreas = [];
  if (legacyInputSummary.available !== true) noActionAreas.push({ area: 'full legacy comparison', reason: 'no action because legacy data is unavailable or partial', source: 'Legacy Input Summary' });
  if (!flags.allowOverlaySimulationProductionWrite) noActionAreas.push({ area: 'production output', reason: 'no action because production overlay/simulation write flag is disabled', source: 'Feature Flags' });
  if (legacyInputSummary.riskLevel === 'low' || legacyInputSummary.riskLevel === 'none') noActionAreas.push({ area: 'overall legacy direction', reason: 'no action because risk is low', source: 'Legacy Risk Review' });

  // ── Task 10: Confidence + Safety Score ───────────────────────────────────
  const legacyAvailabilityFactor = legacyInputSummary.available === true ? 1 : legacyInputSummary.available === 'partial' ? 0.5 : 0.2;
  const safetyScore = +clamp01(
    (globalSafetyScore ?? 0.3) * 0.35 + (overlay?.safetyScore ?? 0.3) * 0.25 +
    (hardStopsCount === 0 ? 1 : 0) * 0.20 + (overStackSeverity === 'none' || overStackSeverity === 'low' ? 1 : overStackSeverity === 'medium' ? 0.5 : 0) * 0.10 +
    legacyAvailabilityFactor * 0.10
  ).toFixed(3);
  // Production write being disabled must NOT itself lower confidence — it
  // only prevents production application (Task 10 rule).
  const confidence = +clamp01(
    (overlay?.confidence ?? 0.3) * 0.25 + (shadowCompare?.confidence ?? 0.3) * 0.20 +
    (activation?.confidence ?? 0.3) * 0.15 + legacyAvailabilityFactor * 0.25 +
    (capture?.overallScore ?? 0.4) * 0.15
    - (missingCount >= 3 ? 0.2 : missingCount * 0.05)
  ).toFixed(3);

  // ── Task 11: Rollback + Fallback ─────────────────────────────────────────
  const rollbackPlan = {
    available: true,
    strategy: 'simulation-only-no-production-write',
    triggerConditions: ['simulation gate failure', 'hard stop', 'confidence below threshold', 'production error', 'user disables simulation flag'],
    restoreTarget: 'legacy Lightroom Mapping',
    reason: 'The simulation never writes production output in the first place — "rollback" here means simply not consuming the simulation, which leaves legacy mapping completely untouched.',
  };
  const fallbackStrategy = {
    useLegacyMapping: true,
    selectedFallback: 'legacy Lightroom Mapping',
    safeMode: true,
    reason: 'EPIC 2E-C is a pure simulation/preview layer — legacy Lightroom Mapping remains the exclusive production path regardless of simulation output.',
  };

  const warnings = [...(legacyInputSummary.warnings ?? [])], reasons = [];
  reasons.push(`Simulation state "${simulationState}" — canApplyToProduction=${canApplyToProduction}, selectedOutputSource="${selectedOutputSource}".`);
  if (failedRequiredGates.length) reasons.push(`${failedRequiredGates.length} required simulation gate(s) failed: ${failedRequiredGates.map(g => g.name).join(', ')}.`);
  if (missingCount > 0) warnings.push(`${missingCount} of 4 core inputs (overlay/safety/activation/shadowCompare) missing or incomplete — simulation is a partial preview.`);
  if (hardStopsCount > 0) warnings.push(`${hardStopsCount} active hard stop(s) — simulation includes a require-human-review action.`);

  const photographerSummary = 'Legacy Mapping is still active. Overlay Simulation shows what V2 would protect or cap, but it is not changing exported XMP.';
  const developerSummary = `canApplyToProduction=false by default; selectedOutputSource=legacy; simulation is report-only. simulationState=${simulationState}, ${simulatedOverlayActions.length} simulated action(s), ${clampItems.length} clamp preview item(s) (all wouldAffectProduction=false).`;

  return {
    mode: 'legacy-overlay-simulation',
    simulationState, canSimulate, canApplyToProduction, selectedOutputSource,
    simulationGateChecks,
    blockers: _buildSimulationBlockers(flags, overlay, safety, activation, legacyInputSummary, hardStopsCount, missingCount),
    warnings, reasons,
    legacyInputSummary, simulatedOverlayActions, simulatedClampPreview,
    simulatedRiskBefore, simulatedRiskAfter, simulatedRiskDelta,
    protectedAreas, suppressedRisks, noActionAreas,
    confidence, safetyScore,
    rollbackPlan, fallbackStrategy,
    photographerSummary, developerSummary,
  };
}

function _buildSimulationBlockers(flags, overlay, safety, activation, legacyInputSummary, hardStopsCount, missingCount) {
  const blockers = [];
  if (!flags.enableLegacyOverlaySimulation) blockers.push({ blocker: 'Overlay simulation is disabled.', severity: 'high', requiredFix: 'Set LIGHTROOM_MAPPING_V2_FLAGS.enableLegacyOverlaySimulation to true.', source: 'Feature Flags' });
  blockers.push({ blocker: 'Production write is disabled by design in EPIC 2E-C.', severity: 'critical', requiredFix: 'A future, separate EPIC would need to introduce production write capability — not in scope here.', source: 'Feature Flags' });
  if (!overlay) blockers.push({ blocker: 'Legacy Safety Overlay V2 is missing.', severity: 'medium', requiredFix: 'Ensure EPIC 2E-B overlay runs before the simulation.', source: 'Legacy Safety Overlay V2' });
  if (!safety) blockers.push({ blocker: 'Safety Clamp V2 is missing.', severity: 'medium', requiredFix: 'Ensure EPIC 2C safety clamp runs before the simulation.', source: 'Safety Clamp V2' });
  if (!activation) blockers.push({ blocker: 'Controlled Activation Gate is missing.', severity: 'low', requiredFix: 'Ensure EPIC 2E-A activation gate runs before the simulation.', source: 'Controlled Activation Gate' });
  if (legacyInputSummary.available !== true) blockers.push({ blocker: 'Legacy preset/mapping output is not fully available.', severity: 'medium', requiredFix: 'Supply legacyPreset/legacyMapping, or run the simulation after legacy mapping completes.', source: 'Legacy Mapping' });
  if (hardStopsCount > 0) blockers.push({ blocker: `Safety clamp contains ${hardStopsCount} hard stop(s).`, severity: 'critical', requiredFix: 'Resolve all active hard stops before trusting this simulation.', source: 'Safety Clamp V2' });
  if (missingCount > 0) blockers.push({ blocker: `${missingCount} of 4 core V2 inputs are missing or incomplete.`, severity: 'medium', requiredFix: 'Ensure the full V2 chain (EPIC 2A-2E-B) has run.', source: 'Input Validation' });
  return blockers;
}
