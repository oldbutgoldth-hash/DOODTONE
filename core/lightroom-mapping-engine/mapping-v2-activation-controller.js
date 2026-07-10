/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CONTROLLED ACTIVATION GATE (EPIC 2E-A)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Answers: "Is Mapping V2 allowed to influence production output?" With
 * the default flags in mapping-v2-flags.js, the answer is always NO —
 * legacy Lightroom Mapping remains the exclusive path to XMP export.
 * This module only marks V2 as ELIGIBLE for a future controlled
 * activation; it never itself flips any switch that would change
 * production output.
 *
 * HARD GUARANTEE: `canUseV2` and `selectedMappingSource` are derived
 * from the passed-in `flags` (or the safe defaults from
 * mapping-v2-flags.js if none are passed) — with those defaults,
 * `canUseV2` is always `false` and `selectedMappingSource` is always
 * `"legacy"`, regardless of how favourable every other upstream signal
 * looks. `fallbackStrategy.useLegacyMapping` is always `true`.
 *
 * SHADOW-ONLY / GATE-ONLY: not called from anywhere in the production
 * pipeline. `core/lightroom-mapping-engine/index.js`'s existing
 * `mapStyleFingerprintToLightroom()` does not import this file and does
 * not read `lightroomControlledActivationV2` in any way.
 *
 * Every input is OPTIONAL; every access below is null-safe. Never
 * mutates any input object it reads.
 */

import { LIGHTROOM_MAPPING_V2_FLAGS } from './mapping-v2-flags.js';

const clamp01 = (v) => Math.max(0, Math.min(1, v ?? 0));
const OVERSTACK_RANK = { none: 0, low: 1, medium: 2, high: 3, critical: 4 };

/** Task 4: builds one gate-check entry. */
function _gate({ name, passed, required, severity, reason, source }) {
  return { name, passed: !!passed, required: !!required, severity, reason, source };
}

/**
 * Main entry point. Every field optional; every access null-safe.
 * Guaranteed never to throw, including `buildLightroomControlledActivationV2({})`.
 */
export function buildLightroomControlledActivationV2(input = {}) {
  const {
    decision = null, finalStyleIntent = null, legacyMapping = null, legacyPreset = null,
    lightroomMappingPlanV2 = null, lightroomTranslationV2 = null, lightroomSafetyClampV2 = null,
    lightroomShadowCompareReportV2 = null, styleBudgetIntelligence = null, photographerIntent = null,
    styleDNA = null, styleFeasibility = null, captureCapability = null,
    flags: flagsOverride = null,
  } = input ?? {};

  // Flags always resolve to a complete object — an override merges ON TOP
  // of the safe defaults, so a partial/malformed override can only ever
  // ADD restrictions relative to the defaults' shape, never silently drop
  // a required key to `undefined`.
  const flags = { ...LIGHTROOM_MAPPING_V2_FLAGS, ...(flagsOverride ?? {}) };

  const plan = lightroomMappingPlanV2 ?? finalStyleIntent?.lightroomMappingPlanV2 ?? null;
  const translation = lightroomTranslationV2 ?? finalStyleIntent?.lightroomTranslationV2 ?? null;
  const safety = lightroomSafetyClampV2 ?? finalStyleIntent?.lightroomSafetyClampV2 ?? null;
  const shadowCompare = lightroomShadowCompareReportV2 ?? finalStyleIntent?.lightroomShadowCompareReportV2 ?? null;
  const budget = styleBudgetIntelligence ?? finalStyleIntent?.styleBudgetIntelligence ?? null;
  const feasibility = styleFeasibility ?? finalStyleIntent?.styleFeasibilityEstimate ?? null;
  const legacyOutput = legacyMapping ?? legacyPreset ?? null;
  const legacyAvailable = legacyOutput != null || shadowCompare?.legacySummary?.available === true;

  const missingCount = [!plan, !translation, !safety, !shadowCompare, !budget].filter(Boolean).length;

  const hardStopsCount = safety?.hardStops?.length ?? 0;
  const overStackSeverity = safety?.overStackAnalysis?.severity ?? 'unknown';
  const overStackRank = OVERSTACK_RANK[overStackSeverity] ?? 0;
  const maxAllowedRank = OVERSTACK_RANK[flags.maxAllowedOverStackSeverity] ?? OVERSTACK_RANK.medium;
  const criticalOverstack = overStackSeverity === 'critical';
  const overstackWithinLimit = overStackRank <= maxAllowedRank;
  const globalSafetyScore = safety?.globalSafetyScore ?? null;
  const shadowConfidence = shadowCompare?.confidence ?? null;
  const alignment = shadowCompare?.alignmentScores?.overallAlignment ?? null;
  const safetyDeltaStatus = shadowCompare?.safetyDelta?.status ?? 'unavailable';
  const safetyDeltaAcceptable = safetyDeltaStatus === 'safer-estimate' || safetyDeltaStatus === 'similar';

  // ── Task 4: Gate Checks (11 required checks) ────────────────────────────
  const gateChecks = [
    _gate({ name: 'controlled activation flag enabled', passed: flags.enableControlledActivation === true, required: true, severity: 'critical', reason: flags.enableControlledActivation ? 'Controlled activation flag is enabled.' : 'Controlled activation flag is disabled (default).', source: 'Feature Flags' }),
    _gate({ name: 'production override allowed', passed: flags.allowProductionOverride === true, required: true, severity: 'critical', reason: flags.allowProductionOverride ? 'Production override is allowed.' : 'Production override is disabled (default).', source: 'Feature Flags' }),
    _gate({ name: 'shadow compare exists', passed: !!shadowCompare, required: flags.requireShadowCompare, severity: 'high', reason: shadowCompare ? 'Shadow Compare Report V2 is available.' : 'Shadow Compare Report V2 is missing.', source: 'Shadow Compare Report V2' }),
    _gate({ name: 'shadow compare confidence sufficient', passed: shadowConfidence != null && shadowConfidence >= flags.minActivationConfidence, required: true, severity: 'high', reason: shadowConfidence != null ? `Shadow compare confidence ${shadowConfidence} vs. required ${flags.minActivationConfidence}.` : 'Shadow compare confidence unavailable.', source: 'Shadow Compare Report V2' }),
    _gate({ name: 'global safety score sufficient', passed: globalSafetyScore != null && globalSafetyScore >= flags.minGlobalSafetyScore, required: true, severity: 'critical', reason: globalSafetyScore != null ? `Global safety score ${globalSafetyScore} vs. required ${flags.minGlobalSafetyScore}.` : 'Global safety score unavailable.', source: 'Safety Clamp V2' }),
    _gate({ name: 'no hard stops', passed: hardStopsCount === 0, required: flags.requireNoHardStops, severity: 'critical', reason: hardStopsCount === 0 ? 'No active hard stops.' : `${hardStopsCount} active hard stop(s).`, source: 'Safety Clamp V2' }),
    _gate({ name: 'no critical over-stack', passed: !criticalOverstack && overstackWithinLimit, required: flags.requireNoCriticalOverstack, severity: 'critical', reason: `Over-stack severity "${overStackSeverity}" vs. max allowed "${flags.maxAllowedOverStackSeverity}".`, source: 'Safety Clamp V2' }),
    _gate({ name: 'legacy mapping available', passed: legacyAvailable, required: flags.requireLegacyMappingAvailable, severity: 'high', reason: legacyAvailable ? 'Legacy mapping output is available for comparison.' : 'Legacy mapping output is not available.', source: 'Legacy Mapping' }),
    _gate({ name: 'safetyDelta status acceptable', passed: safetyDeltaAcceptable, required: true, severity: 'high', reason: `Shadow compare safetyDelta.status is "${safetyDeltaStatus}".`, source: 'Shadow Compare Report V2' }),
    _gate({ name: 'human review completed', passed: false, required: flags.requireHumanReview, severity: 'critical', reason: 'No mechanism in this codebase can mark human review as complete — this gate can only be satisfied by an explicit future process outside this function.', source: 'Human Review Process' }),
    _gate({ name: 'fallback to legacy available', passed: true, required: true, severity: 'critical', reason: 'Legacy Lightroom Mapping pipeline always remains available as a fallback.', source: 'Legacy Mapping' }),
  ];

  const failedRequiredGates = gateChecks.filter(g => g.required && !g.passed);
  const allRequiredGatesPass = failedRequiredGates.length === 0;

  // ── Task 5: Blockers ─────────────────────────────────────────────────────
  const blockers = [];
  if (!flags.enableControlledActivation) blockers.push({ blocker: 'Controlled activation flag is disabled.', severity: 'critical', requiredFix: 'Set LIGHTROOM_MAPPING_V2_FLAGS.enableControlledActivation to true in a future, deliberate change.', source: 'Feature Flags' });
  if (!flags.allowProductionOverride) blockers.push({ blocker: 'Production override is disabled.', severity: 'critical', requiredFix: 'Set LIGHTROOM_MAPPING_V2_FLAGS.allowProductionOverride to true in a future, deliberate change.', source: 'Feature Flags' });
  blockers.push({ blocker: 'Human review is required before activation.', severity: 'critical', requiredFix: 'Complete a human review process (does not exist in this codebase yet) and record its result.', source: 'Human Review Process' });
  if (!legacyAvailable) blockers.push({ blocker: 'Legacy mapping output is not available for final comparison.', severity: 'high', requiredFix: 'Supply legacyMapping/legacyPreset, or run this stage after legacy mapping completes.', source: 'Legacy Mapping' });
  if (hardStopsCount > 0) blockers.push({ blocker: `Safety clamp contains ${hardStopsCount} hard stop(s).`, severity: 'critical', requiredFix: 'Resolve all active hard stops in lightroomSafetyClampV2.', source: 'Safety Clamp V2' });
  if (criticalOverstack || !overstackWithinLimit) blockers.push({ blocker: `Over-stack risk is "${overStackSeverity}" (exceeds allowed "${flags.maxAllowedOverStackSeverity}").`, severity: 'critical', requiredFix: 'Reduce over-stacked tool combinations before reconsidering activation.', source: 'Safety Clamp V2' });
  if (!safetyDeltaAcceptable) blockers.push({ blocker: `Shadow compare status is "${safetyDeltaStatus}" — safety delta does not prove V2 is safer or at least similar.`, severity: 'high', requiredFix: 'Re-run shadow compare once legacy output and safety signals improve.', source: 'Shadow Compare Report V2' });
  if (globalSafetyScore != null && globalSafetyScore < flags.minGlobalSafetyScore) blockers.push({ blocker: `Global safety score (${globalSafetyScore}) is below the required threshold (${flags.minGlobalSafetyScore}).`, severity: 'high', requiredFix: 'Improve upstream capture/style signals or wait for a higher-confidence input.', source: 'Safety Clamp V2' });
  if (missingCount > 0) blockers.push({ blocker: `${missingCount} of 5 core V2 inputs (plan/translation/safety/shadowCompare/budget) are missing or incomplete.`, severity: 'medium', requiredFix: 'Ensure the full V2 shadow chain (EPIC 2A-2D) has run before evaluating activation.', source: 'Input Validation' });

  // ── Task 3: Activation State ─────────────────────────────────────────────
  let activationState;
  if (missingCount >= 3 || !shadowCompare) {
    activationState = 'legacy-only';
  } else if (hardStopsCount > 0 || criticalOverstack || !overstackWithinLimit || !legacyAvailable || !safetyDeltaAcceptable) {
    activationState = 'blocked';
  } else if (allRequiredGatesPass) {
    // Cannot actually happen with default flags (flag/human-review gates
    // always fail), but the branch exists for when flags are deliberately
    // changed in a future, separate stage.
    activationState = 'ready-for-controlled-test';
  } else if (globalSafetyScore != null && globalSafetyScore >= flags.minGlobalSafetyScore && shadowConfidence != null && shadowConfidence >= flags.minActivationConfidence) {
    activationState = 'ready-for-human-review';
  } else {
    activationState = 'shadow-eligible';
  }

  // ── Task 3: canUseV2 / selectedMappingSource — the two guarantees ───────
  // These are the ONLY two fields that could ever influence production
  // behavior, and both are derived strictly from `flags`. With the
  // defaults in mapping-v2-flags.js (enableControlledActivation=false,
  // allowProductionOverride=false), canUseV2 is ALWAYS false and
  // selectedMappingSource is ALWAYS "legacy" — no combination of upstream
  // signals (safety score, alignment, confidence) can override this.
  const canUseV2 = flags.enableControlledActivation === true && flags.allowProductionOverride === true && allRequiredGatesPass;
  const selectedMappingSource = canUseV2 ? 'v2' : 'legacy';

  // ── Task 6: Rollback Plan ────────────────────────────────────────────────
  const rollbackPlan = {
    available: true,
    strategy: 'immediate-legacy-fallback',
    triggerConditions: [
      'any V2 gate failure',
      'hard stop detected',
      'confidence below threshold',
      'production error',
      'XMP validation failure',
      'user disables V2 flag',
    ],
    restoreTarget: 'legacy Lightroom Mapping',
    reason: 'Legacy Lightroom Mapping remains the default, always-available path — rollback requires no data migration, only reverting to the path already in production use.',
  };

  // ── Task 7: Fallback Strategy ────────────────────────────────────────────
  const fallbackStrategy = {
    useLegacyMapping: true, // always true in EPIC 2E-A, regardless of flags or gate results
    selectedFallback: 'legacy Lightroom Mapping',
    safeMode: true,
    reason: canUseV2
      ? 'All gates passed and flags explicitly allow it, yet legacy mapping remains the safe default fallback path.'
      : 'Default flags and/or unmet gate requirements keep legacy Lightroom Mapping as the exclusive production path.',
  };

  // ── Task 8: Activation Confidence (technical readiness only — never a trigger) ──
  const confidence = +clamp01(
    (shadowConfidence ?? 0.3) * 0.20 + (globalSafetyScore ?? 0.3) * 0.25 +
    (safetyDeltaAcceptable ? 0.7 : 0.2) * 0.15 + (alignment ?? 0.3) * 0.15 +
    (hardStopsCount === 0 ? 1 : 0) * 0.10 + (overstackWithinLimit ? 1 : 0) * 0.10 +
    (legacyAvailable ? 1 : 0) * 0.05
    - (missingCount >= 3 ? 0.25 : missingCount * 0.05)
  ).toFixed(3);

  const warnings = [], reasons = [];
  reasons.push(`Activation state "${activationState}" — canUseV2=${canUseV2}, selectedMappingSource="${selectedMappingSource}" (default flags keep production on legacy mapping).`);
  if (failedRequiredGates.length) reasons.push(`${failedRequiredGates.length} of ${gateChecks.filter(g => g.required).length} required gate(s) failed: ${failedRequiredGates.map(g => g.name).join(', ')}.`);
  if (missingCount > 0) warnings.push(`${missingCount} of 5 core V2 inputs missing/incomplete — activation confidence reflects a rough sketch, not a considered readiness estimate.`);
  if (!legacyAvailable) warnings.push('Legacy mapping output is unavailable — this gate cannot yet make a full comparison-based decision.');

  const safetySummary = {
    globalSafetyScore, hardStopsCount, overStackSeverity,
    withinAllowedOverstack: overstackWithinLimit,
  };
  const compareSummary = {
    available: !!shadowCompare,
    readiness: shadowCompare?.readiness ?? 'unknown',
    confidence: shadowConfidence,
    safetyDeltaStatus,
    alignment,
  };

  const photographerSummary = 'Mapping V2 is prepared but not active. The current XMP still uses Legacy Mapping. V2 requires human review and production flags before it can affect exported presets.';
  const developerSummary = `Controlled activation flags are disabled by default; selectedMappingSource=${selectedMappingSource}; fallbackStrategy.useLegacyMapping=${fallbackStrategy.useLegacyMapping}. activationState=${activationState}, canUseV2=${canUseV2}.`;

  return {
    mode: 'controlled-activation-gate',
    activationState, canUseV2, selectedMappingSource,
    gateChecks, blockers, warnings, reasons,
    rolloutMode: canUseV2 ? 'controlled-test' : 'inactive',
    rollbackPlan, fallbackStrategy,
    confidence,
    safetySummary, compareSummary,
    photographerSummary, developerSummary,
  };
}
