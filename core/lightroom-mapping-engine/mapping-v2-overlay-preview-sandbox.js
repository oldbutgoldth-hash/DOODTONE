/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CONTROLLED OVERLAY PREVIEW SANDBOX V2 (EPIC 2E-E)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Answers: "If we previewed the overlay safely, what abstract preset
 * changes would be simulated, what risks would be reduced, and what
 * must remain blocked?" This is NOT production activation. It builds a
 * SEPARATE, non-production preview object — legacy mapping remains the
 * driver and the actual exported preset.
 *
 * HARD GUARANTEES (never derived from any flag or input combination):
 * - `canExportPreviewXMP` is always `false`
 * - `canWriteProduction` is always `false`
 * - `selectedOutputSource` is always `"legacy"`
 * - `previewPresetShadow.containsRealSliderValues` is always `false`
 * - `previewPresetShadow.containsXMPValues` is always `false`
 * - the original `legacyPreset`/`legacyMapping` object is NEVER mutated —
 *   every legacy value is only read and copied into new plain objects
 *   (verified via a before/after JSON snapshot test)
 *
 * `canCreatePreview` is the one flag-driven output — it can be `true`
 * when the safe report/sandbox-object flags are enabled and required
 * data exists, because building an abstract preview object never
 * touches production by itself.
 *
 * GATE-ONLY: not called from anywhere in the production pipeline.
 * `core/lightroom-mapping-engine/index.js`'s `mapStyleFingerprintToLightroom()`
 * does not import this file and does not read
 * `controlledOverlayPreviewSandboxV2`.
 *
 * Every input is OPTIONAL; every access below is null-safe.
 */

import { LIGHTROOM_MAPPING_V2_FLAGS } from './mapping-v2-flags.js';

const clamp01 = (v) => Math.max(0, Math.min(1, v ?? 0));
const RISK_RANK = { none: 0, low: 1, medium: 2, high: 3, critical: 4, unknown: 0 };
const maxRisk = (...vals) => vals.reduce((a, b) => RISK_RANK[b] > RISK_RANK[a] ? b : a, 'none');

/** Task 4: one preview-gate-check entry. */
function _gate({ name, passed, required, severity, reason, source }) {
  return { name, passed: !!passed, required: !!required, severity, reason, source };
}

// ── Task 5: Legacy Preview Input — READ-ONLY, treats legacy data as immutable ──
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

  let riskLevel = 'unknown';
  if (src) {
    const risky = [src.hi, src.sh, src.clarity].filter(v => v != null && Math.abs(v) / 100 >= 0.25).length;
    riskLevel = risky >= 2 ? 'high' : risky === 1 ? 'medium' : 'low';
  } else if (legacyStyleBudget && (legacyStyleBudget.calibration ?? 0) > 0.5) {
    riskLevel = 'medium';
  }

  return {
    available, sourceType, immutable: true, riskLevel,
    dimensionsAvailable, dimensionsUnavailable: [...new Set(dimensionsUnavailable)],
    notes, warnings,
  };
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
    flags: flagsOverride = null,
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

  const missingCount = [!testGate, !simulation, !overlay, !safety].filter(Boolean).length;

  // ── Task 5: Legacy Preview Input (read-only) ────────────────────────────
  const legacyPreviewInput = _buildLegacyPreviewInput(legacyPreset, legacyMapping, legacyBudget);

  // ── Task 4: Preview Gate Checks (16) ─────────────────────────────────────
  const previewGateChecks = [
    _gate({ name: 'preview sandbox enabled', passed: flags.enableControlledOverlayPreviewSandbox === true, required: true, severity: 'high', reason: flags.enableControlledOverlayPreviewSandbox ? 'Preview sandbox is enabled.' : 'Preview sandbox is disabled.', source: 'Feature Flags' }),
    _gate({ name: 'preview report allowed', passed: flags.allowOverlayPreviewSandboxReport === true, required: true, severity: 'medium', reason: flags.allowOverlayPreviewSandboxReport ? 'Report output is allowed.' : 'Report output is disabled.', source: 'Feature Flags' }),
    _gate({ name: 'preview shadow object allowed', passed: flags.allowOverlayPreviewPresetObject === true, required: true, severity: 'medium', reason: flags.allowOverlayPreviewPresetObject ? 'Preview shadow object is allowed.' : 'Preview shadow object is disabled.', source: 'Feature Flags' }),
    _gate({ name: 'preview XMP export disabled', passed: flags.allowOverlayPreviewXMPExport !== true, required: true, severity: 'critical', reason: flags.allowOverlayPreviewXMPExport ? 'Preview XMP export is ENABLED — unexpected in this phase.' : 'Preview XMP export correctly disabled (default).', source: 'Feature Flags' }),
    _gate({ name: 'production write disabled', passed: flags.allowOverlayPreviewProductionWrite !== true, required: true, severity: 'critical', reason: flags.allowOverlayPreviewProductionWrite ? 'Production write is ENABLED — unexpected in this phase.' : 'Production write correctly disabled (default).', source: 'Feature Flags' }),
    _gate({ name: 'preset mutation disabled', passed: flags.allowOverlayPreviewPresetMutation !== true, required: true, severity: 'critical', reason: flags.allowOverlayPreviewPresetMutation ? 'Preset mutation is ENABLED — unexpected in this phase.' : 'Preset mutation correctly disabled (default).', source: 'Feature Flags' }),
    _gate({ name: 'controlled overlay test gate exists', passed: !!testGate, required: flags.requireControlledOverlayTestGateForPreview, severity: 'medium', reason: testGate ? 'Controlled Overlay Test Gate V2 is available.' : 'Controlled Overlay Test Gate V2 is missing.', source: 'Controlled Overlay Test Gate V2' }),
    _gate({ name: 'overlay simulation exists', passed: !!simulation, required: flags.requireOverlaySimulationForPreview, severity: 'high', reason: simulation ? 'Overlay Simulation V2 is available.' : 'Overlay Simulation V2 is missing.', source: 'Overlay Simulation V2' }),
    _gate({ name: 'legacy safety overlay exists', passed: !!overlay, required: flags.requireLegacySafetyOverlayForPreview, severity: 'high', reason: overlay ? 'Legacy Safety Overlay V2 is available.' : 'Legacy Safety Overlay V2 is missing.', source: 'Legacy Safety Overlay V2' }),
    _gate({ name: 'safety clamp exists', passed: !!safety, required: flags.requireSafetyClampForPreview, severity: 'high', reason: safety ? 'Safety Clamp V2 is available.' : 'Safety Clamp V2 is missing.', source: 'Safety Clamp V2' }),
    _gate({ name: 'no hard stops', passed: hardStopsCount === 0, required: flags.requireNoHardStopsForPreview, severity: 'critical', reason: hardStopsCount === 0 ? 'No active hard stops.' : `${hardStopsCount} active hard stop(s).`, source: 'Safety Clamp V2' }),
    _gate({ name: 'no critical over-stack', passed: !criticalOverstack, required: flags.requireNoCriticalOverstackForPreview, severity: 'critical', reason: `Over-stack severity "${overStackSeverity}".`, source: 'Safety Clamp V2' }),
    _gate({ name: 'preview confidence sufficient', passed: false, required: false, severity: 'medium', reason: 'Evaluated after confidence is computed below (see reasons[]).', source: 'Preview Sandbox' }), // placeholder, patched after confidence calc
    _gate({ name: 'preview safety score sufficient', passed: false, required: false, severity: 'medium', reason: 'Evaluated after safety score is computed below (see reasons[]).', source: 'Preview Sandbox' }), // placeholder, patched after safetyScore calc
    _gate({ name: 'rollback available', passed: true, required: true, severity: 'critical', reason: 'Preview-sandbox-only rollback (no production write ever occurs) is always available.', source: 'Legacy Mapping' }),
    _gate({ name: 'legacy mapping/preset/context available or partial fallback available', passed: legacyPreviewInput.available !== false, required: false, severity: 'medium', reason: `Legacy preview input availability: ${legacyPreviewInput.available}.`, source: 'Legacy Mapping' }),
  ];

  // ── Task 3: hard guarantees ──────────────────────────────────────────────
  const canExportPreviewXMP = false; // hard-coded — never true in this phase
  const canWriteProduction = false; // hard-coded — never true in this phase
  const selectedOutputSource = 'legacy'; // hard-coded — legacy remains the sole production path
  const canCreatePreview = flags.enableControlledOverlayPreviewSandbox === true
    && flags.allowOverlayPreviewSandboxReport === true
    && flags.allowOverlayPreviewPresetObject === true
    && (!!simulation || !!overlay); // needs at least some upstream V2 data to build a meaningful preview

  // ── Task 6: Preview Overlay Plan ─────────────────────────────────────────
  const planMode = !canCreatePreview ? 'disabled' : flags.allowOverlayPreviewPresetObject ? 'preview-object-only' : 'simulation-only';
  const previewOverlayActions = [];
  const addPreviewAction = (action, tool, channel, target, severity, reason, productionImpact) => previewOverlayActions.push({ action, tool, channel, target, previewOnly: true, severity, reason, source: 'Preview Sandbox V2', productionImpact });

  const impact = canCreatePreview ? 'preview-only' : 'blocked';
  addPreviewAction('protect-channel', 'HSL', 'red-orange-yellow skin', 'skin tones', capture?.skinReliability != null && capture.skinReliability < 0.45 ? 'high' : 'medium', 'Skin tones are always previewed as protected first.', impact);
  const simActions = simulation?.simulatedOverlayActions ?? [];
  for (const a of simActions) {
    if (a.action === 'keep-legacy' || a.action === 'require-human-review') continue;
    addPreviewAction(a.action, a.tool, a.channel, a.target, a.severity, `Derived from Overlay Simulation V2: ${a.reason}`, impact);
  }
  if (hardStopsCount > 0) addPreviewAction('require-human-review', 'all', 'all', 'overall safety', 'critical', `${hardStopsCount} active hard stop(s) — preview recommends human review before anything further.`, 'blocked');
  if (previewOverlayActions.length === 1) addPreviewAction('no-action', 'all', 'all', 'overall direction', 'low', 'No specific risky areas beyond default skin protection — preview recommends keeping legacy mapping as-is.', 'none');

  const blockedActions = ['write overlay to production XMP', 'mutate legacy preset', 'replace legacy mapping', 'export preview as real XMP'];
  const previewProtectedAreasForPlan = previewOverlayActions.filter(a => a.action === 'protect-channel').map(a => a.target);
  const previewSuppressedForPlan = previewOverlayActions.filter(a => a.action === 'suppress-risk').map(a => a.target);

  const previewOverlayPlan = {
    mode: planMode,
    planState: canCreatePreview ? (legacyPreviewInput.available === true ? 'preview-object-ready' : 'partial-preview') : 'disabled',
    actions: previewOverlayActions,
    blockedActions,
    protectedAreas: previewProtectedAreasForPlan,
    suppressedRisks: previewSuppressedForPlan,
    reasons: [`Preview overlay plan mode is "${planMode}" — no action here ever writes to production XMP or mutates the legacy preset.`],
    warnings: legacyPreviewInput.available !== true ? ['Legacy input is partial or unavailable — preview overlay plan is based on incomplete data.'] : [],
  };

  // ── Task 7: Preview Preset Shadow Object (abstract only, hard guarantees) ──
  const shadowType = !canCreatePreview ? 'unavailable' : legacyPreviewInput.available === true ? 'abstract-preview' : 'risk-preview';
  const changes = previewOverlayActions.filter(a => a.action !== 'no-action' && a.action !== 'require-human-review').map(a => {
    const intensity = a.severity === 'critical' ? 0.85 : a.severity === 'high' ? 0.65 : a.severity === 'medium' ? 0.45 : 0.25;
    const direction = a.action === 'protect-channel' ? 'reduce aggressive shift' : a.action === 'suppress-risk' ? 'suppress risky direction' : a.action === 'cap-intensity' ? 'cap intensity' : a.action === 'warn' ? 'flag for caution' : 'maintain restraint';
    return {
      area: a.target,
      simulatedChange: `${a.action.replace('-', ' ')} on ${a.tool}${a.channel && a.channel !== 'all' ? ` / ${a.channel}` : ''}`,
      direction, intensity: +clamp01(intensity).toFixed(3),
      reason: a.reason, source: a.source, productionImpact: a.productionImpact,
    };
  });
  const unchangedAreas = ['neutral grays', 'overall composition', 'unaffected tonal ranges'];
  const previewPresetShadow = {
    available: canCreatePreview,
    type: shadowType,
    source: legacyPreviewInput.sourceType,
    immutableLegacySource: true,
    containsRealSliderValues: false, // hard guarantee — never true
    containsXMPValues: false, // hard guarantee — never true
    changes,
    unchangedAreas,
    blockedChanges: blockedActions,
    warnings: legacyPreviewInput.available !== true ? ['Preview preset shadow is based on partial legacy context.'] : [],
    reasons: ['This is an ABSTRACT preview object only — normalized 0-1 intensities, no Lightroom slider values, no XMP fields, never written to production.'],
  };

  // ── Task 8: Preview Risk Before / After / Delta ─────────────────────────
  const riskyAreasBefore = [...new Set(previewOverlayActions.filter(a => a.action !== 'no-action' && a.action !== 'require-human-review').map(a => a.target))];
  const overallRiskBefore = legacyPreviewInput.riskLevel !== 'unknown' ? legacyPreviewInput.riskLevel : (hardStopsCount > 0 ? 'high' : overStackSeverity !== 'unknown' ? overStackSeverity : 'unknown');
  const previewRiskBefore = { overallRisk: overallRiskBefore, areas: riskyAreasBefore, reasons: [`Before-state derived from legacy preview input (available=${legacyPreviewInput.available}) and Safety Clamp V2 signals.`] };

  const afterRiskPerArea = changes.map(c => c.intensity >= 0.6 ? 'low' : c.intensity >= 0.4 ? 'medium' : 'low');
  const improvedAreas = changes.filter((c, i) => RISK_RANK[afterRiskPerArea[i]] < RISK_RANK[overallRiskBefore]).map(c => c.area);
  const overallRiskAfter = legacyPreviewInput.available === true && changes.length ? maxRisk(...afterRiskPerArea, 'none') : overallRiskBefore;
  const previewRiskAfter = {
    overallRisk: legacyPreviewInput.available === true ? overallRiskAfter : overallRiskBefore,
    areas: legacyPreviewInput.available === true ? changes.map(c => c.area) : riskyAreasBefore,
    reasons: [legacyPreviewInput.available === true ? 'After-state is a PREVIEW estimate only — no production change actually occurred.' : 'Legacy input is partial/unavailable — after-state is not meaningfully different from before-state.'],
  };

  const deltaLevel = legacyPreviewInput.available !== true ? (improvedAreas.length ? 'small' : 'unknown')
    : improvedAreas.length >= 3 ? 'strong' : improvedAreas.length === 2 ? 'moderate' : improvedAreas.length === 1 ? 'small' : 'none';
  const previewRiskDelta = {
    improved: legacyPreviewInput.available === true && improvedAreas.length > 0,
    deltaLevel, improvedAreas,
    unchangedAreas: unchangedAreas,
    unresolvedRisks: previewOverlayActions.filter(a => a.action === 'require-human-review').map(a => a.target),
    confidence: +clamp01(legacyPreviewInput.available === true ? 0.6 : 0.25).toFixed(3),
    reasons: [
      'This is a PREVIEW, report-only estimate — it does not claim any actual final image quality improvement.',
      'Preview risk appears lower only where explicitly supported by identified protections/suppressions above.',
      ...(legacyPreviewInput.available !== true ? ['Legacy preset data is partial/unavailable, so this delta is a rough estimate, not a considered one.'] : []),
    ],
  };

  // ── Task 9: Protections / Suppressions / No Action ──────────────────────
  const previewProtections = previewOverlayActions.filter(a => a.action === 'protect-channel').map(a => ({
    area: a.target, protectionLevel: a.severity, previewAction: a.action, reason: a.reason, source: a.source,
  }));
  const previewSuppressions = previewOverlayActions.filter(a => a.action === 'suppress-risk').map(a => ({
    risk: a.target, suppression: `preview would suppress "${a.channel}" on ${a.tool}`, severity: a.severity,
    activeInPreview: canCreatePreview, activeInProduction: false, reason: a.reason, source: a.source,
  }));
  const previewNoActionAreas = [];
  if (legacyPreviewInput.available !== true) previewNoActionAreas.push({ area: 'full legacy comparison', reason: 'no action because legacy data unavailable', source: 'Legacy Preview Input' });
  if (!flags.allowOverlayPreviewProductionWrite) previewNoActionAreas.push({ area: 'production output', reason: 'no action because production write disabled', source: 'Feature Flags' });
  if (legacyPreviewInput.riskLevel === 'low' || legacyPreviewInput.riskLevel === 'none') previewNoActionAreas.push({ area: 'overall legacy direction', reason: 'no action because risk is low', source: 'Legacy Risk Review' });
  if (hardStopsCount > 0) previewNoActionAreas.push({ area: 'controlled test / production write', reason: 'no action because hard stop requires human review', source: 'Safety Clamp V2' });

  // ── Task 10: Preview Comparison ──────────────────────────────────────────
  const comparisonType = legacyPreviewInput.available === true ? 'abstract-risk-compare' : legacyPreviewInput.available === 'partial' ? 'partial-risk-compare' : 'unavailable';
  const previewComparison = {
    available: comparisonType !== 'unavailable',
    comparisonType,
    legacySummary: `Legacy risk level: ${legacyPreviewInput.riskLevel}.`,
    previewSummary: canCreatePreview ? `Preview suggests ${previewProtections.length} protection(s) and ${previewSuppressions.length} suppression(s), risk category "${previewRiskAfter.overallRisk}".` : 'No preview object was created — nothing to summarise.',
    likelySaferAreas: improvedAreas,
    unresolvedAreas: previewRiskDelta.unresolvedRisks,
    confidence: +clamp01(legacyPreviewInput.available === true ? 0.55 : 0.25).toFixed(3),
    warnings: comparisonType === 'unavailable' ? ['No legacy context available — comparison could not be built.'] : comparisonType === 'partial-risk-compare' ? ['Comparison is based on partial legacy context only.'] : [],
    reasons: ['Compares abstract RISK CATEGORIES only — never actual image pixels, never a visual-quality claim.'],
  };

  // ── Task 11: Human Review Notes ───────────────────────────────────────────
  const humanReviewNotes = [
    { note: 'Review skin protection preview before any overlay test.', severity: 'high', requiredBefore: 'controlled-overlay-test', reason: 'Skin tones are the highest-priority protection area.' },
    { note: 'Confirm highlight roll-off is not over-capped.', severity: 'medium', requiredBefore: 'controlled-overlay-test', reason: 'Over-capping highlights can flatten a look unintentionally.' },
    { note: 'Test real high-key image before preview XMP export.', severity: 'high', requiredBefore: 'preview-xmp-export', reason: 'Synthetic tests do not cover all real-world capture variation.' },
    { note: 'Confirm no XMP regression with default flags.', severity: 'critical', requiredBefore: 'production-write', reason: 'Default flags must never change current exported XMP.' },
  ];
  if (hardStopsCount > 0) humanReviewNotes.unshift({ note: `Resolve ${hardStopsCount} active hard stop(s) before any further review.`, severity: 'critical', requiredBefore: 'controlled-overlay-test', reason: 'Hard stops represent unresolved, real risk.' });

  // ── Task 3: Sandbox State ────────────────────────────────────────────────
  let sandboxState;
  if (!flags.enableControlledOverlayPreviewSandbox) {
    sandboxState = 'disabled';
  } else if (!canCreatePreview) {
    sandboxState = missingCount >= 3 ? 'unavailable' : 'blocked';
  } else if (hardStopsCount > 0 || criticalOverstack) {
    sandboxState = 'blocked';
  } else if (legacyPreviewInput.available !== true || missingCount > 0) {
    sandboxState = 'partial-preview';
  } else if (globalSafetyScore != null && globalSafetyScore >= flags.minPreviewSandboxSafetyScore) {
    sandboxState = 'ready-for-human-review';
  } else {
    sandboxState = 'preview-object-ready';
  }

  // ── Task 12: Confidence + Safety Score ───────────────────────────────────
  const legacyAvailabilityFactor = legacyPreviewInput.available === true ? 1 : legacyPreviewInput.available === 'partial' ? 0.5 : 0.2;
  const safetyScore = +clamp01(
    (testGate?.safetyScore ?? 0.3) * 0.20 + (simulation?.safetyScore ?? 0.3) * 0.20 +
    (overlay?.safetyScore ?? 0.3) * 0.15 + (globalSafetyScore ?? 0.3) * 0.25 +
    (hardStopsCount === 0 ? 1 : 0) * 0.10 + legacyAvailabilityFactor * 0.10
  ).toFixed(3);
  // Preview XMP export / production write being disabled must NOT itself
  // lower confidence or safety score (Task 12 rule) — they only prevent
  // production/export application.
  const confidence = +clamp01(
    (testGate?.confidence ?? 0.3) * 0.20 + (simulation?.confidence ?? 0.3) * 0.20 +
    (overlay?.confidence ?? 0.3) * 0.15 + (shadowCompare?.confidence ?? 0.3) * 0.15 +
    legacyAvailabilityFactor * 0.30
    - (missingCount >= 3 ? 0.2 : missingCount * 0.05)
  ).toFixed(3);

  // Patch the two placeholder gate checks now that confidence/safetyScore exist.
  previewGateChecks[12] = _gate({ name: 'preview confidence sufficient', passed: confidence >= flags.minPreviewSandboxConfidence, required: true, severity: 'medium', reason: `Preview confidence ${confidence} vs. required ${flags.minPreviewSandboxConfidence}.`, source: 'Preview Sandbox V2' });
  previewGateChecks[13] = _gate({ name: 'preview safety score sufficient', passed: safetyScore >= flags.minPreviewSandboxSafetyScore, required: true, severity: 'medium', reason: `Preview safety score ${safetyScore} vs. required ${flags.minPreviewSandboxSafetyScore}.`, source: 'Preview Sandbox V2' });

  const failedRequiredGates = previewGateChecks.filter(g => g.required && !g.passed);

  // ── Task 13: Rollback + Fallback ──────────────────────────────────────────
  const rollbackPlan = {
    available: true,
    strategy: 'preview-sandbox-no-production-write',
    triggerConditions: ['preview gate failure', 'hard stop', 'critical overstack', 'XMP validation failure', 'user disables preview flag', 'confidence below threshold', 'human review failed'],
    restoreTarget: 'legacy Lightroom Mapping',
    reason: 'The preview sandbox never writes production output or exports real XMP in the first place — "rollback" here means simply not consuming the preview object, which leaves legacy mapping completely untouched.',
  };
  const fallbackStrategy = {
    useLegacyMapping: true,
    selectedFallback: 'legacy Lightroom Mapping',
    safeMode: true,
    reason: 'EPIC 2E-E only builds an abstract, non-production preview object — legacy Lightroom Mapping remains the exclusive production path regardless of preview output.',
  };

  const warnings = [...(legacyPreviewInput.warnings ?? [])], reasons = [];
  reasons.push(`Sandbox state "${sandboxState}" — canCreatePreview=${canCreatePreview}, canExportPreviewXMP=${canExportPreviewXMP}, canWriteProduction=${canWriteProduction}, selectedOutputSource="${selectedOutputSource}".`);
  if (failedRequiredGates.length) reasons.push(`${failedRequiredGates.length} of ${previewGateChecks.filter(g => g.required).length} required gate(s) failed: ${failedRequiredGates.map(g => g.name).join(', ')}.`);
  if (missingCount > 0) warnings.push(`${missingCount} of 4 core inputs (testGate/simulation/overlay/safety) missing or incomplete — preview sandbox is a partial preview.`);
  if (hardStopsCount > 0) warnings.push(`${hardStopsCount} active hard stop(s) — preview includes a require-human-review action.`);

  const photographerSummary = 'Legacy Mapping is still active. Preview Sandbox shows a safe abstract preview of what V2 would protect or suppress, but it does not change exported XMP.';
  const developerSummary = `canExportPreviewXMP=false and canWriteProduction=false by default; selectedOutputSource=legacy; previewPresetShadow contains no real Lightroom slider values. sandboxState=${sandboxState}, canCreatePreview=${canCreatePreview}, ${changes.length} preview change(s) (all productionImpact!=none unless no-action).`;

  return {
    mode: 'controlled-overlay-preview-sandbox',
    sandboxState, canCreatePreview, canExportPreviewXMP, canWriteProduction, selectedOutputSource,
    previewGateChecks,
    blockers: _buildPreviewBlockers(flags, testGate, simulation, overlay, safety, legacyPreviewInput, hardStopsCount, criticalOverstack, missingCount),
    warnings, reasons,
    legacyPreviewInput, previewOverlayPlan, previewPresetShadow,
    previewRiskBefore, previewRiskAfter, previewRiskDelta,
    previewProtections, previewSuppressions, previewNoActionAreas,
    previewComparison, humanReviewNotes,
    confidence, safetyScore,
    rollbackPlan, fallbackStrategy,
    photographerSummary, developerSummary,
  };
}

function _buildPreviewBlockers(flags, testGate, simulation, overlay, safety, legacyPreviewInput, hardStopsCount, criticalOverstack, missingCount) {
  const blockers = [];
  if (!flags.enableControlledOverlayPreviewSandbox) blockers.push({ blocker: 'Preview sandbox is disabled.', severity: 'high', requiredFix: 'Set LIGHTROOM_MAPPING_V2_FLAGS.enableControlledOverlayPreviewSandbox to true.', source: 'Feature Flags' });
  blockers.push({ blocker: 'Preview XMP export is disabled by design in EPIC 2E-E.', severity: 'critical', requiredFix: 'A future, separate EPIC would need to introduce preview XMP export capability — not in scope here.', source: 'Feature Flags' });
  blockers.push({ blocker: 'Production write is disabled by design in EPIC 2E-E.', severity: 'critical', requiredFix: 'A future, separate EPIC would need to introduce production write capability — not in scope here.', source: 'Feature Flags' });
  if (!testGate) blockers.push({ blocker: 'Controlled Overlay Test Gate V2 is missing.', severity: 'low', requiredFix: 'Ensure EPIC 2E-D test gate runs before the preview sandbox.', source: 'Controlled Overlay Test Gate V2' });
  if (!simulation) blockers.push({ blocker: 'Overlay Simulation V2 is missing.', severity: 'medium', requiredFix: 'Ensure EPIC 2E-C simulation runs before the preview sandbox.', source: 'Overlay Simulation V2' });
  if (!overlay) blockers.push({ blocker: 'Legacy Safety Overlay V2 is missing.', severity: 'medium', requiredFix: 'Ensure EPIC 2E-B overlay runs before the preview sandbox.', source: 'Legacy Safety Overlay V2' });
  if (hardStopsCount > 0) blockers.push({ blocker: `Safety clamp contains ${hardStopsCount} hard stop(s).`, severity: 'critical', requiredFix: 'Resolve all active hard stops before trusting this preview.', source: 'Safety Clamp V2' });
  if (criticalOverstack) blockers.push({ blocker: 'Over-stack risk is critical.', severity: 'critical', requiredFix: 'Reduce over-stacked tool combinations.', source: 'Safety Clamp V2' });
  if (legacyPreviewInput.available !== true) blockers.push({ blocker: 'Legacy preset/mapping output is not fully available.', severity: 'medium', requiredFix: 'Supply legacyPreset/legacyMapping, or run the preview sandbox after legacy mapping completes.', source: 'Legacy Mapping' });
  if (missingCount > 0) blockers.push({ blocker: `${missingCount} of 4 core V2 inputs are missing or incomplete.`, severity: 'medium', requiredFix: 'Ensure the full V2 chain (EPIC 2A-2E-D) has run.', source: 'Input Validation' });
  return blockers;
}
