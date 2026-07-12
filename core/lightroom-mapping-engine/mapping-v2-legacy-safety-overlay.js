/**
 * ═══════════════════════════════════════════════════════════════════════════
 * LEGACY SAFETY OVERLAY V2 (EPIC 2E-B)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Answers: "Can V2 safety intelligence warn, cap, or guide the current
 * LEGACY mapping safely — without replacing it?" Legacy Mapping remains
 * the driver; V2 Safety becomes an advisor / guardrail.
 *
 * HARD GUARANTEE: with the default flags in mapping-v2-flags.js
 * (enableLegacySafetyOverlay=false, allowLegacyOverlayProductionClamp=false),
 * `canApplyOverlay` is always `false`, `selectedOutputSource` is always
 * `"legacy"`, `overlayClampPlan.canApply` is always `false`, and every
 * `suppressedLegacyRisks[].active` is `false`. The overlay produces
 * advice/report output ONLY — it never mutates production XMP, never
 * replaces legacy mapping, and never creates a new final preset.
 *
 * GATE-ONLY: not called from anywhere in the production pipeline.
 * `core/lightroom-mapping-engine/index.js`'s `mapStyleFingerprintToLightroom()`
 * does not import this file and does not read `legacySafetyOverlayV2`.
 *
 * Every input is OPTIONAL; every access below is null-safe. Never
 * mutates any input object it reads — legacy preset values, if present,
 * are only classified abstractly, never modified or re-emitted.
 */

import { LIGHTROOM_MAPPING_V2_FLAGS } from './mapping-v2-flags.js';

const clamp01 = (v) => Math.max(0, Math.min(1, v ?? 0));
const OVERSTACK_RANK = { none: 0, low: 1, medium: 2, high: 3, critical: 4 };

/** Classifies a magnitude into an abstract label — never a real slider value. */
function _abstractLevel(magnitude) {
  if (magnitude == null) return 'unknown';
  const m = Math.abs(magnitude);
  return m < 0.15 ? 'low' : m < 0.4 ? 'medium' : 'high';
}

/** Task 4: one overlay gate-check entry. */
function _gate({ name, passed, required, severity, reason, source }) {
  return { name, passed: !!passed, required: !!required, severity, reason, source };
}

// ── Task 5: Legacy Risk Review ──────────────────────────────────────────────
// Inspects legacy preset/mapping context READ-ONLY, classifying risk
// abstractly. Never modifies or regenerates legacy values.
function _buildLegacyRiskReview(legacyOutput, legacyStyleBudget) {
  if (!legacyOutput && !legacyStyleBudget) {
    return {
      available: false, riskLevel: 'unknown',
      riskyAreas: [], safeAreas: [], unknownAreas: ['all'],
      reasons: ['No legacy preset/mapping output was supplied — overlay review is based on budget context only, if any.'],
      warnings: ['Legacy preset output is not available; overlay review is partial.'],
    };
  }

  const riskyAreas = [], safeAreas = [], unknownAreas = [], reasons = [], warnings = [];
  const src = legacyOutput ?? {};

  const check = (label, magnitude, riskThreshold) => {
    if (magnitude == null) { unknownAreas.push(label); return; }
    const lvl = _abstractLevel(magnitude);
    if (Math.abs(magnitude) >= riskThreshold) { riskyAreas.push(label); reasons.push(`${label}: legacy magnitude reads "${lvl}" — worth a guardrail review.`); }
    else safeAreas.push(label);
  };

  // Only READ existing values; classify abstractly. Thresholds are on the
  // raw legacy scale (these values already exist in the legacy preset).
  check('highlight pressure', src.hi != null ? src.hi / 100 : null, 0.25);
  check('shadow crushing', src.sh != null ? src.sh / 100 : null, 0.25);
  check('harsh clarity/detail', src.clarity != null ? src.clarity / 100 : null, 0.2);
  check('WB shift risk', src.temp != null ? src.temp / 2000 : null, 0.2);
  check('heavy color grading', (src.vib != null || src.sat != null) ? ((Math.abs(src.vib ?? 0) + Math.abs(src.sat ?? 0)) / 2) / 100 : null, 0.25);

  if (legacyStyleBudget) {
    if ((legacyStyleBudget.calibration ?? 0) > 0.5) { riskyAreas.push('aggressive calibration'); reasons.push('Legacy style budget allocates a high calibration share.'); }
    else safeAreas.push('calibration restraint');
  } else unknownAreas.push('calibration');

  const riskLevel = riskyAreas.length >= 3 ? 'high' : riskyAreas.length === 2 ? 'medium' : riskyAreas.length === 1 ? 'low' : 'none';
  return { available: true, riskLevel, riskyAreas, safeAreas, unknownAreas, reasons, warnings };
}

// ── Task 8: Protected Areas ──────────────────────────────────────────────────
function _buildProtectedAreas(legacyRiskReview, translation, capture) {
  const areas = [];
  const push = (area, level, reason, affectedLegacyRisk) => areas.push({ area, protectionLevel: level, reason, source: 'Legacy Safety Overlay V2', affectedLegacyRisk });

  push('skin tones', capture?.skinReliability != null && capture.skinReliability < 0.45 ? 'critical' : 'high', 'Skin tones are the highest-priority area to protect from any legacy risk.', legacyRiskReview.riskyAreas.includes('skin hue shift') ? 'skin hue shift' : 'aggressive calibration');
  if (legacyRiskReview.riskyAreas.includes('highlight pressure')) push('highlight roll-off', 'high', 'Legacy shows highlight pressure — protect roll-off.', 'highlight pressure');
  if (legacyRiskReview.riskyAreas.includes('shadow crushing')) push('shadow detail', 'high', 'Legacy shows shadow crushing — protect detail.', 'shadow crushing');
  if (legacyRiskReview.riskyAreas.includes('aggressive calibration')) push('clean whites', 'medium', 'Aggressive calibration can dirty clean whites.', 'aggressive calibration');
  push('neutral grays', 'low', 'Keep neutral grays neutral under any overlay.', null);
  if ((translation?.protectedChannels ?? []).some(c => c.channel?.includes('green'))) push('green luminance', 'high', 'V2 translation flags green luminance protection (e.g. Green Pastel DNA).', 'green saturation');
  return areas;
}

/**
 * Main entry point. Every field optional; every access null-safe.
 * Guaranteed never to throw, including `buildLegacySafetyOverlayV2({})`.
 */
export function buildLegacySafetyOverlayV2(input = {}) {
  const {
    decision = null, finalStyleIntent = null, legacyPreset = null, legacyMapping = null,
    legacyStyleBudget = null, lightroomMappingPlanV2 = null, lightroomTranslationV2 = null,
    lightroomSafetyClampV2 = null, lightroomShadowCompareReportV2 = null,
    lightroomControlledActivationV2 = null, styleBudgetIntelligence = null,
    photographerIntent = null, styleDNA = null, styleFeasibility = null,
    captureCapability = null, referenceColorIntelligence = null, flags: flagsOverride = null,
  } = input ?? {};

  const flags = { ...LIGHTROOM_MAPPING_V2_FLAGS, ...(flagsOverride ?? {}) };

  const translation = lightroomTranslationV2 ?? finalStyleIntent?.lightroomTranslationV2 ?? null;
  const safety = lightroomSafetyClampV2 ?? finalStyleIntent?.lightroomSafetyClampV2 ?? null;
  const shadowCompare = lightroomShadowCompareReportV2 ?? finalStyleIntent?.lightroomShadowCompareReportV2 ?? null;
  const activation = lightroomControlledActivationV2 ?? finalStyleIntent?.lightroomControlledActivationV2 ?? null;
  const capture = captureCapability ?? finalStyleIntent?.captureCapabilityEstimate ?? null;
  const legacyOutput = legacyPreset ?? legacyMapping ?? null;
  const legacyBudget = legacyStyleBudget ?? decision?.styleBudget ?? null;

  const hardStopsCount = safety?.hardStops?.length ?? 0;
  const overStackSeverity = safety?.overStackAnalysis?.severity ?? 'unknown';
  const overStackRank = OVERSTACK_RANK[overStackSeverity] ?? 0;
  const criticalOverstack = overStackSeverity === 'critical';
  const globalSafetyScore = safety?.globalSafetyScore ?? null;
  const activationSelectedLegacy = activation?.selectedMappingSource === 'legacy';
  const shadowStatus = shadowCompare?.safetyDelta?.status ?? 'unavailable';
  const shadowNotRiskier = shadowStatus !== 'riskier';

  const missingCount = [!safety, !shadowCompare, !activation, !translation, !legacyOutput].filter(Boolean).length;

  // ── Task 5: Legacy Risk Review ──────────────────────────────────────────
  const legacyRiskReview = _buildLegacyRiskReview(legacyOutput, legacyBudget);

  // ── Task 4: Overlay Gate Checks (11) ────────────────────────────────────
  const overlayGateChecks = [
    _gate({ name: 'legacy safety overlay enabled', passed: flags.enableLegacySafetyOverlay === true, required: true, severity: 'critical', reason: flags.enableLegacySafetyOverlay ? 'Overlay is enabled.' : 'Overlay is disabled (default).', source: 'Feature Flags' }),
    _gate({ name: 'production clamp allowed', passed: flags.allowLegacyOverlayProductionClamp === true, required: true, severity: 'critical', reason: flags.allowLegacyOverlayProductionClamp ? 'Production clamp is allowed.' : 'Production clamp is disabled (default).', source: 'Feature Flags' }),
    _gate({ name: 'activation gate exists', passed: !!activation, required: flags.requireActivationGateForOverlay, severity: 'high', reason: activation ? 'Controlled Activation Gate is available.' : 'Controlled Activation Gate is missing.', source: 'Controlled Activation Gate' }),
    _gate({ name: 'activation gate selected legacy', passed: activationSelectedLegacy, required: flags.requireActivationGateForOverlay, severity: 'high', reason: activationSelectedLegacy ? 'Activation gate correctly has legacy selected.' : 'Activation gate did not select legacy.', source: 'Controlled Activation Gate' }),
    _gate({ name: 'safety clamp exists', passed: !!safety, required: true, severity: 'high', reason: safety ? 'Safety Clamp V2 is available.' : 'Safety Clamp V2 is missing.', source: 'Safety Clamp V2' }),
    _gate({ name: 'no hard stops', passed: hardStopsCount === 0, required: flags.requireNoHardStopsForOverlay, severity: 'critical', reason: hardStopsCount === 0 ? 'No active hard stops.' : `${hardStopsCount} active hard stop(s).`, source: 'Safety Clamp V2' }),
    _gate({ name: 'no critical over-stack', passed: !criticalOverstack, required: flags.requireNoCriticalOverstackForOverlay, severity: 'critical', reason: `Over-stack severity "${overStackSeverity}".`, source: 'Safety Clamp V2' }),
    _gate({ name: 'global safety score sufficient', passed: globalSafetyScore != null && globalSafetyScore >= flags.minOverlaySafetyScore, required: true, severity: 'high', reason: globalSafetyScore != null ? `Global safety score ${globalSafetyScore} vs. required ${flags.minOverlaySafetyScore}.` : 'Global safety score unavailable.', source: 'Safety Clamp V2' }),
    _gate({ name: 'shadow compare not riskier', passed: shadowNotRiskier, required: true, severity: 'high', reason: `Shadow compare safetyDelta.status is "${shadowStatus}".`, source: 'Shadow Compare Report V2' }),
    _gate({ name: 'rollback available', passed: true, required: true, severity: 'critical', reason: 'Immediate legacy-only rollback is always available.', source: 'Legacy Mapping' }),
    _gate({ name: 'legacy mapping/preset available', passed: legacyOutput != null || legacyRiskReview.available, required: true, severity: 'medium', reason: legacyRiskReview.available ? 'Legacy context is available for review.' : 'Legacy preset/mapping output is not available.', source: 'Legacy Mapping' }),
  ];

  const failedRequiredGates = overlayGateChecks.filter(g => g.required && !g.passed);
  const allRequiredGatesPass = failedRequiredGates.length === 0;

  // ── Task 3: canApplyOverlay / selectedOutputSource — the two guarantees ──
  // Derived strictly from flags. With defaults (enableLegacySafetyOverlay=false,
  // allowLegacyOverlayProductionClamp=false), canApplyOverlay is ALWAYS false
  // and selectedOutputSource is ALWAYS "legacy".
  const canApplyOverlay = flags.enableLegacySafetyOverlay === true && flags.allowLegacyOverlayProductionClamp === true && allRequiredGatesPass;
  const selectedOutputSource = canApplyOverlay ? 'legacy+overlay' : 'legacy';

  // ── Task 3: Overlay State ────────────────────────────────────────────────
  let overlayState;
  if (!flags.enableLegacySafetyOverlay) {
    overlayState = flags.allowLegacyOverlayWarningsOnly ? 'warnings-only' : 'disabled';
  } else if (hardStopsCount > 0 || criticalOverstack || !activationSelectedLegacy) {
    overlayState = 'blocked';
  } else if (canApplyOverlay) {
    overlayState = 'eligible-for-controlled-overlay';
  } else if (globalSafetyScore != null && globalSafetyScore >= flags.minOverlaySafetyScore) {
    overlayState = 'eligible-for-review';
  } else {
    overlayState = 'warnings-only';
  }

  // ── Task 6: Overlay Recommendations (report-only / blocked by default) ──
  const productionImpact = canApplyOverlay ? 'future-overlay' : (flags.enableLegacySafetyOverlay ? 'blocked' : 'report-only');
  const overlayRecommendations = [];
  const rec = (area, recommendation, severity, reason) => overlayRecommendations.push({ area, recommendation, severity, reason, source: 'Legacy Safety Overlay V2', productionImpact });
  rec('skin tones', 'protect skin tones from any legacy colour push', 'high', 'Skin is always the top protection priority.');
  for (const risk of legacyRiskReview.riskyAreas) {
    if (risk === 'highlight pressure') rec('highlights', 'preserve highlight roll-off', 'high', 'Legacy shows highlight pressure.');
    else if (risk === 'shadow crushing') rec('shadows', 'preserve shadow detail', 'high', 'Legacy shows shadow crushing.');
    else if (risk === 'aggressive calibration') rec('calibration', 'cap aggressive calibration', 'medium', 'Legacy budget leans heavily on calibration.');
    else if (risk === 'heavy color grading') rec('color grading', 'reduce heavy colour grading', 'medium', 'Legacy shows heavy grading.');
    else if (risk === 'harsh clarity/detail') rec('clarity/detail', 'reduce harsh clarity/detail', 'medium', 'Legacy shows harsh clarity.');
    else if (risk === 'WB shift risk') rec('white balance', 'avoid strong WB shift', 'medium', 'Legacy shows a strong WB shift.');
  }
  if ((translation?.toolSuppressionMap ?? []).some(s => s.tool === 'HSL' && s.channel?.includes('green'))) rec('green saturation', 'suppress green saturation', 'medium', 'V2 translation suppresses green saturation (e.g. Green Pastel DNA).');

  // ── Task 7: Overlay Clamp Plan (report-only / disabled by default) ──────
  const clampMode = canApplyOverlay ? 'eligible-future-clamp' : (flags.enableLegacySafetyOverlay ? 'disabled' : 'report-only');
  const clampItems = overlayRecommendations.map(r => ({
    tool: r.area, channel: 'abstract', clampType: r.recommendation.startsWith('protect') || r.recommendation.startsWith('preserve') ? 'protect-channel' : r.recommendation.startsWith('suppress') ? 'suppress-tool' : r.recommendation.startsWith('cap') ? 'cap-intensity' : r.recommendation.startsWith('avoid') ? 'block-aggressive-direction' : 'reduce-risk',
    severity: r.severity, reason: r.reason, source: 'Legacy Safety Overlay V2',
    wouldAffectProduction: false, // always false by default — report-only
  }));
  const overlayClampPlan = {
    mode: clampMode, canApply: false, // always false in EPIC 2E-B default
    clampItems,
    summary: `${clampItems.length} abstract clamp item(s) prepared as ${clampMode === 'report-only' ? 'advice only' : clampMode}; none affect production output.`,
    reasons: [`Overlay clamp plan is "${clampMode}" — no clamp item touches XMP; legacy mapping remains the sole production path.`],
    warnings: canApplyOverlay ? [] : ['Overlay clamp is not applied — production flags are disabled by default.'],
  };

  // ── Task 8: Protected Areas ──────────────────────────────────────────────
  const protectedAreas = _buildProtectedAreas(legacyRiskReview, translation, capture);

  // ── Task 9: Suppressed Legacy Risks (active:false by default) ────────────
  const suppressedLegacyRisks = legacyRiskReview.riskyAreas.map(risk => ({
    risk, suppression: `overlay would advise easing "${risk}"`,
    severity: legacyRiskReview.riskLevel === 'high' ? 'high' : 'medium',
    reason: `Identified in legacy risk review; overlay could guardrail this in a future controlled-overlay phase.`,
    source: 'Legacy Safety Overlay V2',
    active: false, // always false — overlay is not applied to production
  }));

  // ── Task 10: Confidence + Safety Score ───────────────────────────────────
  const safetyScore = +clamp01(
    (globalSafetyScore ?? 0.3) * 0.4 +
    (hardStopsCount === 0 ? 1 : 0) * 0.25 +
    (overStackRank <= OVERSTACK_RANK[flags.maxAllowedOverStackSeverity] ? 1 : 0) * 0.15 +
    (shadowNotRiskier ? 1 : 0) * 0.10 +
    (legacyRiskReview.available ? 1 : 0.3) * 0.10
  ).toFixed(3);

  const confidence = +clamp01(
    (globalSafetyScore ?? 0.3) * 0.25 + (shadowCompare?.confidence ?? 0.3) * 0.20 +
    (activation?.confidence ?? 0.3) * 0.15 + (legacyRiskReview.available ? 0.8 : 0.3) * 0.20 +
    (capture?.overallScore ?? 0.4) * 0.10 + (hardStopsCount === 0 ? 1 : 0) * 0.10
    - (missingCount >= 3 ? 0.25 : missingCount * 0.05)
  ).toFixed(3);

  // ── Task 11: Rollback Plan ───────────────────────────────────────────────
  const rollbackPlan = {
    available: true,
    strategy: 'immediate-legacy-only',
    triggerConditions: [
      'overlay gate failure',
      'hard stop detected',
      'XMP validation failure',
      'production error',
      'user disables overlay flag',
      'confidence below threshold',
    ],
    restoreTarget: 'legacy Lightroom Mapping',
    reason: 'The overlay never becomes the driver — reverting means simply not applying overlay advice, leaving the already-active legacy mapping untouched.',
  };

  // ── Task 7 (fallback strategy) ───────────────────────────────────────────
  const fallbackStrategy = {
    useLegacyMapping: true,
    selectedFallback: 'legacy Lightroom Mapping',
    safeMode: true,
    reason: 'EPIC 2E-B overlay is advice/report-only by default — legacy Lightroom Mapping remains the exclusive production path.',
  };

  const warnings = [...(legacyRiskReview.warnings ?? [])], reasons = [];
  reasons.push(`Overlay state "${overlayState}" — canApplyOverlay=${canApplyOverlay}, selectedOutputSource="${selectedOutputSource}" (default flags keep production on legacy mapping only).`);
  if (failedRequiredGates.length) reasons.push(`${failedRequiredGates.length} required overlay gate(s) failed: ${failedRequiredGates.map(g => g.name).join(', ')}.`);
  if (missingCount > 0) warnings.push(`${missingCount} of 5 core inputs (safety/shadowCompare/activation/translation/legacy) missing or incomplete — overlay review is partial.`);
  if (!legacyRiskReview.available) warnings.push('Legacy preset output is not available; overlay review is partial.');

  const photographerSummary = 'Legacy Mapping is still active. V2 Safety Overlay is prepared as a guardrail, but it is not changing exported XMP yet.';
  const developerSummary = `canApplyOverlay=false by default; selectedOutputSource=${selectedOutputSource}; production clamp flags are disabled. overlayState=${overlayState}, overlayClampPlan.mode=${clampMode}, ${suppressedLegacyRisks.length} suppressible risk(s) (all inactive).`;

  return {
    mode: 'legacy-safety-overlay',
    overlayState, canApplyOverlay, selectedOutputSource,
    overlayGateChecks, blockers: _buildBlockers(flags, activation, safety, hardStopsCount, criticalOverstack, activationSelectedLegacy, globalSafetyScore, legacyRiskReview, missingCount),
    warnings, reasons,
    legacyRiskReview, overlayRecommendations, overlayClampPlan, protectedAreas, suppressedLegacyRisks,
    rollbackPlan, fallbackStrategy,
    confidence, safetyScore,
    photographerSummary, developerSummary,
  };
}

// ── Task 4 (blockers helper) ─────────────────────────────────────────────────
function _buildBlockers(flags, activation, safety, hardStopsCount, criticalOverstack, activationSelectedLegacy, globalSafetyScore, legacyRiskReview, missingCount) {
  const blockers = [];
  if (!flags.enableLegacySafetyOverlay) blockers.push({ blocker: 'Legacy safety overlay is disabled.', severity: 'critical', requiredFix: 'Set LIGHTROOM_MAPPING_V2_FLAGS.enableLegacySafetyOverlay to true in a future, deliberate change.', source: 'Feature Flags' });
  if (!flags.allowLegacyOverlayProductionClamp) blockers.push({ blocker: 'Overlay production clamp is disabled.', severity: 'critical', requiredFix: 'Set LIGHTROOM_MAPPING_V2_FLAGS.allowLegacyOverlayProductionClamp to true in a future, deliberate change.', source: 'Feature Flags' });
  if (flags.requireActivationGateForOverlay && !activation) blockers.push({ blocker: 'Controlled Activation Gate is missing.', severity: 'high', requiredFix: 'Ensure the activation gate (EPIC 2E-A) runs before the overlay.', source: 'Controlled Activation Gate' });
  if (flags.requireActivationGateForOverlay && activation && !activationSelectedLegacy) blockers.push({ blocker: 'Activation gate did not select legacy.', severity: 'high', requiredFix: 'Overlay only applies while legacy is the selected source.', source: 'Controlled Activation Gate' });
  if (flags.requireNoHardStopsForOverlay && hardStopsCount > 0) blockers.push({ blocker: `Safety clamp contains ${hardStopsCount} hard stop(s).`, severity: 'critical', requiredFix: 'Resolve all active hard stops.', source: 'Safety Clamp V2' });
  if (flags.requireNoCriticalOverstackForOverlay && criticalOverstack) blockers.push({ blocker: 'Over-stack risk is critical.', severity: 'critical', requiredFix: 'Reduce over-stacked tool combinations.', source: 'Safety Clamp V2' });
  if (globalSafetyScore != null && globalSafetyScore < flags.minOverlaySafetyScore) blockers.push({ blocker: `Global safety score (${globalSafetyScore}) is below the overlay threshold (${flags.minOverlaySafetyScore}).`, severity: 'high', requiredFix: 'Wait for a higher-confidence input.', source: 'Safety Clamp V2' });
  if (!legacyRiskReview.available) blockers.push({ blocker: 'Legacy preset/mapping output is not available for a full overlay review.', severity: 'medium', requiredFix: 'Supply legacyPreset/legacyMapping or run the overlay after legacy mapping completes.', source: 'Legacy Mapping' });
  if (missingCount > 0) blockers.push({ blocker: `${missingCount} of 5 core V2 inputs are missing or incomplete.`, severity: 'medium', requiredFix: 'Ensure the full V2 chain (EPIC 2A-2E-A) has run.', source: 'Input Validation' });
  return blockers;
}
