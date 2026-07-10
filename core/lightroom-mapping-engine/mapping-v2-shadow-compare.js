/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SHADOW COMPARE REPORT V2 (EPIC 2D) — SHADOW-COMPARE ONLY
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Compares (1) legacy production mapping, (2) lightroomMappingPlanV2,
 * (3) lightroomTranslationV2, (4) lightroomSafetyClampV2 — and answers
 * "how does V2 think differently from current production mapping?" and
 * "is V2 safer, more aligned, or still too risky?" This is a REPORT ONLY:
 * it never generates a Lightroom slider value, never touches XMP, and
 * never activates V2. `activationReadiness.canProceedToControlledActivation`
 * is hard-coded false — EPIC 2E (a real activation stage) does not exist
 * yet, so this stage cannot claim readiness for it no matter how
 * favourable every upstream signal looks.
 *
 * SHADOW-ONLY: not called from anywhere in the production pipeline.
 * `core/lightroom-mapping-engine/index.js`'s existing
 * `mapStyleFingerprintToLightroom()` does not import this file.
 * `fallbackStrategy.useLegacyMapping` is always `true`.
 *
 * Every input is OPTIONAL; every access below is null-safe. Never
 * mutates any of the V2 objects it reads (legacyMapping,
 * lightroomMappingPlanV2, lightroomTranslationV2, lightroomSafetyClampV2)
 * — only reads and summarises them.
 */

const clamp01 = (v) => Math.max(0, Math.min(1, v ?? 0));
const severityRank = { none: 0, low: 1, medium: 2, high: 3, critical: 4 };
const maxSeverity = (...vals) => vals.reduce((a, b) => severityRank[b] > severityRank[a] ? b : a, 'none');

/** Classifies a 0-1 (or similar small numeric) magnitude into an abstract category — never a real slider value. */
function _directionOf(magnitude, { lowLabel = 'conservative', midLabel = 'balanced', highLabel = 'strong' } = {}) {
  if (magnitude == null) return 'unknown';
  const m = Math.abs(magnitude);
  return m < 0.15 ? lowLabel : m < 0.4 ? midLabel : highLabel;
}

// ── Task 3: Legacy Summary ──────────────────────────────────────────────────
// Reads legacy production output ONLY to summarise abstractly — never
// modifies it, never re-derives a slider value from it.
function _buildLegacySummary(legacyMapping, legacyPreset, legacyStyleBudget) {
  const src = legacyMapping ?? legacyPreset ?? null;
  if (!src) {
    return { available: false, tonalDirection: 'unknown', colorDirection: 'unknown', wbDirection: 'unknown', contrastDirection: 'unknown', riskLevel: 'unknown', notes: ['No legacy mapping/preset output was supplied — legacy summary is unavailable, not assumed.'] };
  }
  // These come from an already-computed legacy PRESET object (numbers
  // that already exist there) — we only classify their MAGNITUDE into
  // an abstract label, never re-emit or alter the numbers themselves.
  const exp = src.exp ?? 0, con = src.con ?? 0, hi = src.hi ?? 0, sh = src.sh ?? 0;
  const temp = src.temp ?? 0, tint = src.tint ?? 0, vib = src.vib ?? 0, sat = src.sat ?? 0;
  const clarity = src.clarity ?? 0, dehaze = src.dehaze ?? 0, texture = src.texture ?? 0;

  const tonalDirection = _directionOf((Math.abs(exp) + Math.abs(hi) + Math.abs(sh)) / 3 / 50, {});
  const colorDirection = _directionOf((Math.abs(vib) + Math.abs(sat)) / 2 / 50, {});
  const wbDirection = _directionOf((Math.abs(temp) / 500 + Math.abs(tint) / 50) / 2, {});
  const contrastDirection = _directionOf(Math.abs(con) / 50, {});
  const aggressiveTools = [Math.abs(clarity) > 15, Math.abs(dehaze) > 15, Math.abs(texture) > 15].filter(Boolean).length;
  const budgetRisk = legacyStyleBudget && ((legacyStyleBudget.calibration ?? 0) > 0.5 || (legacyStyleBudget.colorGrading ?? 0) > 0.5);
  const riskLevel = aggressiveTools >= 2 || budgetRisk ? 'high' : aggressiveTools === 1 ? 'medium' : 'low';

  const notes = [`Legacy mapping "${legacyStyleBudget?.name ?? 'unnamed budget'}" summarised abstractly from existing preset values — no new values generated.`];
  return { available: true, tonalDirection, colorDirection, wbDirection, contrastDirection, riskLevel, notes };
}

// ── Task 4: V2 Plan Summary ─────────────────────────────────────────────────
function _buildPlanSummary(plan) {
  if (!plan) return { available: false, warning: 'lightroomMappingPlanV2 was not supplied.' };
  return {
    available: true,
    mainPriorities: plan.mappingPriorities ?? [],
    protectedAreas: (plan.protectedAreas ?? []).map(a => a.area),
    avoidedTools: (plan.avoidedTools ?? []).map(a => a.tool),
    recommendedTools: (plan.recommendedTools ?? []).map(a => a.tool),
    plannerReadiness: plan.readiness ?? 'unknown',
    plannerConfidence: plan.confidence ?? null,
  };
}

// ── Task 5: Translation Summary (validates, never mutates) ─────────────────
function _buildTranslationSummary(translation, warnings) {
  if (!translation) return { available: false, warning: 'lightroomTranslationV2 was not supplied.' };

  let allNormalized = true;
  const hintGroupNames = ['basicToneHints', 'toneCurveHints', 'whiteBalanceHints', 'hslHints', 'colorGradingHints', 'calibrationHints', 'presenceHints', 'detailHints'];
  for (const name of hintGroupNames) {
    const group = translation[name];
    if (!group) continue;
    const checkOne = (h) => { if (h?.intensity != null && h?.maxIntensity != null && h.intensity > h.maxIntensity) allNormalized = false; };
    if (group.intensity != null) checkOne(group);
    else for (const sub of Object.values(group)) checkOne(sub);
  }
  for (const r of translation.targetRangeHints ?? []) {
    if (r.minIntensity > r.maxIntensity) allNormalized = false;
    if (r.safetyLimit != null && r.maxIntensity > r.safetyLimit) allNormalized = false;
  }
  if (!allNormalized) warnings.push('Translation hints failed a normalization check (intensity/range ordering) — flagged for review, not corrected here.');

  const toolPriorityMap = translation.toolPriorityMap ?? {};
  const toolSummary = Object.entries(toolPriorityMap).map(([tool, v]) => ({ tool, priority: v.priority, intensity: v.intensity }));

  return {
    available: true,
    targetRangeHintsCount: (translation.targetRangeHints ?? []).length,
    toolPrioritySummary: toolSummary,
    toolSuppressionCount: (translation.toolSuppressionMap ?? []).length,
    protectedChannels: (translation.protectedChannels ?? []).map(c => c.channel),
    translationReadiness: translation.readiness ?? 'unknown',
    translationConfidence: translation.confidence ?? null,
    allHintsNormalized: allNormalized,
  };
}

// ── Task 6: Safety Summary ──────────────────────────────────────────────────
function _buildSafetySummary(safety, warnings) {
  if (!safety) return { available: false, warning: 'lightroomSafetyClampV2 was not supplied.' };
  if (safety.activationGate?.canActivate !== false) {
    warnings.push('[CRITICAL] lightroomSafetyClampV2.activationGate.canActivate is not false — this must never happen in the current shadow-only phase.');
  }
  return {
    available: true,
    globalSafetyScore: safety.globalSafetyScore ?? null,
    activationGateLevel: safety.activationGate?.level ?? 'unknown',
    canActivate: safety.activationGate?.canActivate ?? null,
    clampProfileCount: Object.keys(safety.clampProfiles ?? {}).length,
    toolCapsCount: (safety.toolCaps ?? []).length,
    channelProtectionsCount: (safety.channelProtections ?? []).length,
    overStackSeverity: safety.overStackAnalysis?.severity ?? 'unknown',
    hardStopsCount: (safety.hardStops ?? []).length,
    softCapsCount: (safety.softCaps ?? []).length,
  };
}

// ── Task 7: Comparison Matrix ────────────────────────────────────────────────
const MATRIX_DIMENSIONS = ['tonal', 'color', 'skin', 'wb', 'curve', 'hsl', 'calibration', 'colorGrading', 'detail', 'safety'];
const TRANSLATION_TOOL_KEY = { tonal: 'basicTone', color: 'colorGrading', skin: null, wb: 'whiteBalance', curve: 'toneCurve', hsl: 'hsl', calibration: 'calibration', colorGrading: 'colorGrading', detail: 'detail', safety: null };
const LEGACY_DIRECTION_KEY = { tonal: 'tonalDirection', color: 'colorDirection', wb: 'wbDirection', curve: 'contrastDirection' };

function _buildComparisonMatrix(legacySummary, translation, safety) {
  const matrix = {};
  const toolPriorityMap = translation?.toolPriorityMap ?? {};
  const legacyAvailable = legacySummary?.available === true;
  for (const dim of MATRIX_DIMENSIONS) {
    // EPIC 2D-F Patch 3: never invent a legacy direction when legacy
    // output is unavailable — force "unknown" explicitly rather than
    // relying on _buildLegacySummary's own fallback staying "unknown"
    // forever (defensive: correct today, but shouldn't be an implicit
    // assumption this function silently depends on).
    const legacyDirection = !legacyAvailable ? 'unknown' : (LEGACY_DIRECTION_KEY[dim] ? (legacySummary[LEGACY_DIRECTION_KEY[dim]] ?? 'unknown') : (dim === 'safety' ? legacySummary.riskLevel : 'unknown'));
    const toolKey = TRANSLATION_TOOL_KEY[dim];
    const v2Entry = toolKey ? toolPriorityMap[toolKey] : null;
    const v2Direction = v2Entry ? _directionOf(v2Entry.intensity) : (dim === 'skin' ? 'conservative' : dim === 'safety' ? (safety?.globalSafetyScore != null ? _directionOf(1 - safety.globalSafetyScore) : 'unknown') : 'unknown');
    const clampProfile = toolKey && safety?.clampProfiles ? safety.clampProfiles[toolKey] : null;
    const v2Safety = clampProfile ? clampProfile.clampSeverity : (dim === 'safety' ? (safety?.overStackAnalysis?.severity ?? 'unknown') : 'none');

    let alignment = 'unknown', divergence = 0.5, recommendation;
    if (!legacyAvailable) {
      alignment = 'unknown'; divergence = 0.5;
      recommendation = 'Needs legacy mapping output for full comparison.';
    } else if (legacyDirection !== 'unknown' && v2Direction !== 'unknown') {
      if (legacyDirection === v2Direction) { alignment = 'aligned'; divergence = 0.1; }
      else if ((legacyDirection === 'balanced' || v2Direction === 'balanced')) { alignment = 'partially-aligned'; divergence = 0.4; }
      else { alignment = 'divergent'; divergence = 0.75; }
      recommendation = alignment === 'divergent' ? `Review ${dim} direction before any future activation — legacy and V2 disagree.` : alignment === 'aligned' ? `${dim} direction is consistent between legacy and V2.` : 'Insufficient data to compare confidently.';
    } else {
      recommendation = 'Insufficient data to compare confidently.';
    }
    const reason = !legacyAvailable ? `Legacy mapping output unavailable — only V2's own "${v2Direction}" direction for ${dim} is known.` : `Compared legacy "${legacyDirection}" against V2 "${v2Direction}" for ${dim}.`;
    matrix[dim] = { legacyDirection, v2Direction, v2Safety, alignment, divergence: +divergence.toFixed(2), recommendation, reason };
  }
  return matrix;
}

// ── Task 8: Alignment Scores ─────────────────────────────────────────────────
function _buildAlignmentScores(matrix, feasibility) {
  const alignVal = (a) => a === 'aligned' ? 1 : a === 'partially-aligned' ? 0.6 : a === 'divergent' ? 0.2 : 0.4;
  const tonalAlignment = alignVal(matrix.tonal.alignment);
  const colorAlignment = (alignVal(matrix.color.alignment) + alignVal(matrix.hsl.alignment) + alignVal(matrix.colorGrading.alignment)) / 3;
  const skinAlignment = matrix.skin.v2Safety === 'high' || matrix.skin.v2Safety === 'critical' ? 0.8 : 0.5;
  const safetyAlignment = matrix.safety.divergence != null ? clamp01(1 - matrix.safety.divergence) : 0.5;
  const intentAlignment = (tonalAlignment + colorAlignment) / 2;
  const feasibilityAlignment = feasibility?.score ?? (feasibility?.level === 'high' ? 0.8 : feasibility?.level === 'medium' ? 0.5 : 0.3);
  const overallAlignment = +clamp01((tonalAlignment + colorAlignment + skinAlignment + safetyAlignment + intentAlignment + feasibilityAlignment) / 6).toFixed(3);
  return {
    overallAlignment,
    tonalAlignment: +tonalAlignment.toFixed(3), colorAlignment: +colorAlignment.toFixed(3),
    skinAlignment: +skinAlignment.toFixed(3), safetyAlignment: +safetyAlignment.toFixed(3),
    intentAlignment: +intentAlignment.toFixed(3), feasibilityAlignment: +clamp01(feasibilityAlignment).toFixed(3),
  };
}

// ── Task 9: Divergence Analysis ─────────────────────────────────────────────
function _buildDivergenceAnalysis(matrix, translation, safety, dnaNames) {
  const divergentAreas = [], reasons = [], recommendations = [];
  for (const [dim, entry] of Object.entries(matrix)) {
    if (entry.alignment === 'divergent') {
      divergentAreas.push(dim);
      reasons.push(`${dim}: legacy is "${entry.legacyDirection}" while V2 leans "${entry.v2Direction}".`);
      recommendations.push(entry.recommendation);
    }
  }
  if (translation?.toolSuppressionMap?.some(s => s.tool === 'HSL' && s.channel?.includes('green'))) {
    divergentAreas.push('green-saturation-suppression');
    reasons.push('V2 suppresses green saturation for Green Pastel DNA; legacy mapping has no equivalent suppression.');
  }
  if (safety?.overStackAnalysis?.hasRisk && (safety.overStackAnalysis.severity === 'high' || safety.overStackAnalysis.severity === 'critical')) {
    divergentAreas.push('over-stack-risk');
    reasons.push(`V2's own over-stack analysis flags "${safety.overStackAnalysis.severity}" severity that legacy mapping does not evaluate at all.`);
  }
  if ((translation?.toolPriorityMap?.detail?.intensity ?? 0) < 0.4 && translation?.presenceHints) {
    reasons.push('V2 is deliberately conservative on detail/presence due to noise uncertainty — legacy mapping does not factor noise reliability at all.');
  }

  const hasMajorDivergence = divergentAreas.length > 0;
  const severity = divergentAreas.length >= 3 ? 'high' : divergentAreas.length === 2 ? 'medium' : divergentAreas.length === 1 ? 'low' : 'none';
  return { hasMajorDivergence, severity, divergentAreas, reasons, recommendations };
}

// ── Task 10: Safety Delta ───────────────────────────────────────────────────
function _buildSafetyDelta(legacySummary, translation, safetySummary, safety) {
  const safetyImprovements = [], remainingRisks = [], reasons = [];
  const legacyAvailable = legacySummary?.available === true;
  const overStackSeverity = safetySummary?.overStackSeverity ?? 'unknown';
  const overStackRisky = overStackSeverity === 'high' || overStackSeverity === 'critical';
  const hardStopsCount = safetySummary?.hardStopsCount ?? 0;
  const globalSafetyScore = safetySummary?.globalSafetyScore;
  const lowSafetyScore = globalSafetyScore != null && globalSafetyScore < 0.5;
  const blockersCount = (safety?.activationGate?.blockers ?? []).length;
  // Safety Clamp's own blockers[] always includes 2 static, phase-level
  // entries ("shadow-only phase", "no real-image comparison yet") that
  // are true regardless of input quality — only blockers BEYOND that
  // baseline represent a genuine, input-specific risk signal worth
  // factoring into a safety claim here.
  const extraBlockersCount = Math.max(0, blockersCount - 2);

  if (translation?.protectedChannels?.length) safetyImprovements.push('V2 explicitly protects skin/highlight/shadow channels that legacy mapping does not track individually.');
  if (safetySummary && safetySummary.toolCapsCount > 0) safetyImprovements.push(`V2 applies ${safetySummary.toolCapsCount} explicit tool-level safety cap(s) before any future activation.`);
  if (translation?.toolSuppressionMap?.length) safetyImprovements.push('V2 suppresses specific risky tool/channel combinations that legacy mapping applies uniformly.');
  if (safetySummary?.overStackSeverity === 'none') safetyImprovements.push('V2 actively checks for and currently finds no over-stacking risk in the combined tool plan.');
  if (legacyAvailable && legacySummary.riskLevel === 'high') safetyImprovements.push('Legacy mapping shows a "high" abstract risk level — V2 layers additional caution legacy mapping does not apply.');

  if (!safetySummary?.available) remainingRisks.push('No Safety Clamp data available — cannot yet estimate a meaningful safety delta.');
  if (hardStopsCount > 0) remainingRisks.push(`${hardStopsCount} hard stop(s) currently active in V2 — these represent real, unresolved risk, not an improvement.`);
  if (overStackRisky) remainingRisks.push(`Over-stack analysis severity is "${overStackSeverity}" — a real, unresolved risk signal.`);
  if (lowSafetyScore) remainingRisks.push(`Global safety score (${globalSafetyScore}) is below the confidence threshold needed to claim V2 is safer.`);
  if (extraBlockersCount > 0) remainingRisks.push(`${extraBlockersCount} additional activation-gate blocker(s) beyond the standard shadow-only phase gate are currently active.`);
  remainingRisks.push('V2 has not been validated against real shadow-compare data from actual edited photos.');
  remainingRisks.push('Confidence/safety weightings throughout the V2 chain are hand-reasoned, not tuned from measured outcomes.');

  // EPIC 2D-F Patch 2: v2SaferThanLegacy is ONLY ever true when every one
  // of these guards passes — legacy output must actually exist to compare
  // against, safety must genuinely look clean, and there must be concrete
  // improvements to point to. Any single failing guard forces `false`
  // and an honest `status`, never an optimistic default.
  let status, v2SaferThanLegacy, confidence;
  if (!legacyAvailable) {
    status = 'uncertain'; v2SaferThanLegacy = false;
    reasons.push('Legacy mapping output is not available — there is nothing concrete to compare V2 against, so a "safer" claim cannot be made.');
    confidence = 0.25;
  } else if (hardStopsCount > 0) {
    status = 'riskier'; v2SaferThanLegacy = false;
    reasons.push(`${hardStopsCount} active hard stop(s) mean V2 currently carries real, unresolved risk — it cannot be called safer than legacy in this state.`);
    confidence = 0.3;
  } else if (overStackRisky) {
    status = 'uncertain'; v2SaferThanLegacy = false;
    reasons.push(`Over-stack severity "${overStackSeverity}" is a real risk signal that blocks a confident safety claim.`);
    confidence = 0.35;
  } else if (lowSafetyScore) {
    status = 'uncertain'; v2SaferThanLegacy = false;
    reasons.push(`Global safety score (${globalSafetyScore}) is too low to support a confident safety claim.`);
    confidence = 0.35;
  } else if (extraBlockersCount > 0) {
    status = 'uncertain'; v2SaferThanLegacy = false;
    reasons.push(`${extraBlockersCount} additional activation-gate blocker(s) beyond the standard shadow-only phase gate remain — a confident safety claim is premature.`);
    confidence = 0.4;
  } else if (safetyImprovements.length >= 2) {
    status = 'safer-estimate'; v2SaferThanLegacy = true;
    reasons.push(`${safetyImprovements.length} concrete safety improvement(s) identified with no active hard stops, high over-stack risk, or low safety score — a cautious "safer" estimate is supportable.`);
    confidence = 0.6;
  } else {
    status = 'similar'; v2SaferThanLegacy = false;
    reasons.push('No blocking risk signals found, but too few concrete improvements to confidently claim V2 is safer rather than merely similar.');
    confidence = 0.45;
  }

  const score = +clamp01(0.4 + safetyImprovements.length * 0.1 - remainingRisks.length * 0.05).toFixed(3);
  reasons.push(`Safety delta estimated at ${score} from ${safetyImprovements.length} identified improvement(s) against ${remainingRisks.length} remaining risk(s)/caveat(s).`);
  return { v2SaferThanLegacy, status, confidence: +clamp01(confidence).toFixed(3), score, safetyImprovements, remainingRisks, reasons };
}

// ── Task 11: Expected Improvement ───────────────────────────────────────────
function _buildExpectedImprovement(divergenceAnalysis, safetyDelta, alignmentScores, legacyAvailable) {
  // EPIC 2D-F Patch 4: without legacy output, "better" is not directly
  // comparable — phrase every improvement area as a hedge ("potentially
  // better") rather than a flat assertion, and lower confidence
  // accordingly.
  const likelyBetterAreas = safetyDelta.safetyImprovements.map(s => legacyAvailable ? s : `Potentially better: ${s.charAt(0).toLowerCase()}${s.slice(1)}`);
  const likelySameAreas = [];
  const likelyRiskAreas = [...safetyDelta.remainingRisks];
  if (alignmentScores.overallAlignment > 0.7) likelySameAreas.push('Overall creative direction is largely consistent with legacy mapping.');
  if (divergenceAnalysis.hasMajorDivergence) likelyRiskAreas.push(`${divergenceAnalysis.divergentAreas.length} area(s) diverge from legacy mapping and need human review before any activation.`);
  if (!legacyAvailable) likelyRiskAreas.push('No final legacy mapping output available for direct comparison.');
  likelyRiskAreas.push('No controlled activation stage (EPIC 2E) exists yet.');

  const confidence = +clamp01((alignmentScores.overallAlignment * 0.5 + safetyDelta.score * 0.5) * (legacyAvailable ? 1 : 0.6)).toFixed(3);
  const reasons = [`Expected improvement estimate combines alignment (${alignmentScores.overallAlignment}) and safety delta (${safetyDelta.score}) — this is a forward-looking ESTIMATE, not a claim of final image quality improvement.${legacyAvailable ? '' : ' Confidence is further reduced because legacy mapping output was unavailable for direct comparison.'}`];
  return { likelyBetterAreas, likelySameAreas, likelyRiskAreas, confidence, reasons };
}

// ── Task 12: Activation Readiness ───────────────────────────────────────────
function _buildActivationReadiness(safetySummary, divergenceAnalysis, missingCount, legacyAvailable) {
  const blockers = ['EPIC 2E (a real controlled-activation stage) has not been implemented yet — this is a hard blocker regardless of any other signal.'];
  if (!legacyAvailable) blockers.push('Legacy mapping output is not available — comparison is partial, not a full head-to-head against production mapping.');
  if (safetySummary?.hardStopsCount > 0) blockers.push(`${safetySummary.hardStopsCount} hard stop(s) are currently active.`);
  if (divergenceAnalysis.severity === 'high' || divergenceAnalysis.severity === 'critical') blockers.push(`Divergence severity is "${divergenceAnalysis.severity}".`);
  if (missingCount >= 3) blockers.push(`${missingCount} of 5 core V2 inputs are missing or incomplete.`);
  if (!safetySummary?.available) blockers.push('Safety Clamp data is unavailable.');

  // EPIC 2D-F Patch 1: with no legacy output to compare against, the
  // ceiling is "needs-more-shadow-data" — never eligible-for-controlled-test
  // or ready-for-shadow-review, both of which would imply a completed
  // comparison that hasn't actually happened.
  const level = missingCount >= 3 || !safetySummary?.available ? 'not-ready'
    : !legacyAvailable ? 'needs-more-shadow-data'
    : (safetySummary?.hardStopsCount > 0 || divergenceAnalysis.severity === 'high') ? 'needs-more-shadow-data'
    : divergenceAnalysis.severity === 'none' || divergenceAnalysis.severity === 'low' ? 'eligible-for-controlled-test'
    : 'ready-for-shadow-review';

  return {
    level,
    canProceedToControlledActivation: false, // hard-coded — EPIC 2E does not exist yet
    blockers,
    requiredNextSteps: [
      'Human review of this shadow compare report against real edited photos.',
      'Real-image tests across a representative sample, not synthetic inputs only.',
      'A dedicated, explicit controlled-activation flag/stage (EPIC 2E) that does not exist yet.',
      'A rollback fallback path in case controlled activation ever produces unexpected results.',
      'An XMP regression test suite run before and after any future activation change.',
    ],
    reason: 'EPIC 2D produces a comparison report only — it cannot itself authorise controlled activation, which requires a separate future stage.',
  };
}

/**
 * Main entry point. Every field optional; every access null-safe.
 * Guaranteed never to throw, including `buildLightroomShadowCompareReportV2({})`.
 * Never mutates any input object — only reads and summarises.
 */
export function buildLightroomShadowCompareReportV2(input = {}) {
  const {
    decision = null, finalStyleIntent = null, legacyMapping = null, legacyPreset = null,
    lightroomMappingPlanV2 = null, lightroomTranslationV2 = null, lightroomSafetyClampV2 = null,
    styleBudgetIntelligence = null, photographerIntent = null, styleDNA = null,
    styleDNAValidation = null, styleFeasibility = null, captureCapability = null,
    referenceColorIntelligence = null, transferConfidence = null,
  } = input ?? {};

  const plan = lightroomMappingPlanV2 ?? finalStyleIntent?.lightroomMappingPlanV2 ?? null;
  const translation = lightroomTranslationV2 ?? finalStyleIntent?.lightroomTranslationV2 ?? null;
  const safety = lightroomSafetyClampV2 ?? finalStyleIntent?.lightroomSafetyClampV2 ?? null;
  const budget = styleBudgetIntelligence ?? finalStyleIntent?.styleBudgetIntelligence ?? null;
  const legacyBudget = decision?.styleBudget ?? null;
  const feasibility = styleFeasibility ?? finalStyleIntent?.styleFeasibilityEstimate ?? null;
  const dnaRaw = styleDNA ?? finalStyleIntent?.photographerStyle?.top?.styleDNA;
  const dna = Array.isArray(dnaRaw) ? dnaRaw : (dnaRaw && Array.isArray(dnaRaw.elements)) ? dnaRaw.elements : (dnaRaw && Array.isArray(dnaRaw.items)) ? dnaRaw.items : [];
  const dnaNames = dna.map(d => d?.name).filter(Boolean);

  const warnings = [], developerSummaryLines = [], reasons = [];

  // Tasks 3-6
  const legacySummary = _buildLegacySummary(legacyMapping, legacyPreset, legacyBudget);
  const v2PlanSummary = _buildPlanSummary(plan);
  const translationSummary = _buildTranslationSummary(translation, warnings);
  const safetySummary = _buildSafetySummary(safety, warnings);

  // Task 7-12
  const legacyAvailable = legacySummary.available === true;
  const comparisonMatrix = _buildComparisonMatrix(legacySummary, translation, safety);
  const alignmentScores = _buildAlignmentScores(comparisonMatrix, feasibility);
  const divergenceAnalysis = _buildDivergenceAnalysis(comparisonMatrix, translation, safety, dnaNames);
  const safetyDelta = _buildSafetyDelta(legacySummary, translation, safetySummary, safety);
  const expectedImprovement = _buildExpectedImprovement(divergenceAnalysis, safetyDelta, alignmentScores, legacyAvailable);

  const missingCount = [!plan, !translation, !safety, !budget, !feasibility].filter(Boolean).length;
  const activationReadiness = _buildActivationReadiness(safetySummary, divergenceAnalysis, missingCount, legacyAvailable);

  // EPIC 2D-F Patch 1: readiness must not exceed "partial" when legacy
  // output is unavailable — a shadow compare without a legacy baseline
  // is inherently incomplete, never "ready-for-shadow-compare".
  let readiness = missingCount >= 3 ? 'not-ready' : missingCount >= 1 ? 'partial' : 'ready-for-shadow-compare';
  if (!legacyAvailable && readiness === 'ready-for-shadow-compare') readiness = 'partial';
  const confidence = +clamp01(
    alignmentScores.overallAlignment * 0.35 + safetyDelta.score * 0.35 +
    (translation?.confidence ?? 0.4) * 0.15 + (safety?.confidence ?? safety?.globalSafetyScore ?? 0.4) * 0.15
    - (missingCount >= 3 ? 0.2 : missingCount * 0.05)
  ).toFixed(3);

  reasons.push(`Shadow compare readiness "${readiness}", overall alignment ${alignmentScores.overallAlignment}, safety delta ${safetyDelta.score} (status: ${safetyDelta.status}).`);
  if (divergenceAnalysis.hasMajorDivergence) reasons.push(`${divergenceAnalysis.divergentAreas.length} divergent area(s): ${divergenceAnalysis.divergentAreas.join(', ')}.`);
  if (missingCount > 0) warnings.push(`${missingCount} of 5 core V2 inputs (plan/translation/safety/budget/feasibility) missing or incomplete.`);
  if (!legacyAvailable) warnings.push('Legacy mapping output is not available at this stage; Shadow Compare is partial.');

  // EPIC 2D-F Patch 5: photographer-facing language is cautious and
  // reflects safetyDelta.status honestly — never asserts "safer" unless
  // status is genuinely "safer-estimate".
  const photographerSummary = !legacyAvailable
    ? `Shadow Compare is partial because final legacy mapping output is not available at this stage. V2 shows ${safetyDelta.safetyImprovements.length ? 'stronger safety planning' : 'its planned safety measures'}, but it is not yet proven safer than the active mapping. This is a shadow comparison only — your exported preset is unaffected.`
    : safetyDelta.status === 'safer-estimate'
      ? `V2 currently looks more cautious/safer than the current mapping, ${divergenceAnalysis.hasMajorDivergence ? `with ${divergenceAnalysis.divergentAreas.length} area(s) worth reviewing` : 'with no major disagreements found'}. This is a shadow comparison only — your exported preset is unaffected.`
      : `V2 appears ${safetyDelta.status === 'riskier' ? 'to carry unresolved risk right now' : 'broadly similar to legacy mapping, with safety not yet confidently proven either way'}, ${divergenceAnalysis.hasMajorDivergence ? `and ${divergenceAnalysis.divergentAreas.length} area(s) worth reviewing` : 'with no major disagreements found'}. This is a shadow comparison only — your exported preset is unaffected.`;

  developerSummaryLines.push('lightroomShadowCompareReportV2 is a REPORT ONLY — it never generates a Lightroom slider value, never touches XMP, and never activates V2 mapping.');
  developerSummaryLines.push(`activationReadiness.canProceedToControlledActivation is hard-coded false — EPIC 2E does not exist yet.`);
  if (!legacyAvailable) developerSummaryLines.push('Comparison is based on V2 shadow objects and legacy budget context, not final legacy mapping output.');
  developerSummaryLines.push(`legacySummary.available=${legacyAvailable}; safetyDelta.status=${safetyDelta.status}. Controlled activation remains blocked until real shadow comparison data is available.`);
  if (safetySummary?.canActivate !== false && safetySummary?.available) developerSummaryLines.push('[CRITICAL] Safety Clamp activationGate.canActivate was not false — investigate immediately.');
  const developerSummary = developerSummaryLines.join(' ');

  return {
    mode: 'shadow-compare', readiness, confidence,
    legacySummary, v2PlanSummary, translationSummary, safetySummary,
    comparisonMatrix, alignmentScores, divergenceAnalysis, safetyDelta,
    expectedImprovement, activationReadiness,
    photographerSummary, developerSummary,
    recommendations: [...divergenceAnalysis.recommendations, ...activationReadiness.requiredNextSteps.slice(0, 2)],
    warnings, reasons,
    fallbackStrategy: {
      useLegacyMapping: true,
      reason: 'EPIC 2D is a shadow-compare report only — production XMP generation continues to use legacy mapping exclusively, regardless of this report\'s findings.',
      requiredBeforeActivation: activationReadiness.requiredNextSteps,
      safeMode: true,
    },
  };
}
