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
  for (const dim of MATRIX_DIMENSIONS) {
    const legacyDirection = LEGACY_DIRECTION_KEY[dim] ? (legacySummary[LEGACY_DIRECTION_KEY[dim]] ?? 'unknown') : (dim === 'safety' ? legacySummary.riskLevel : 'unknown');
    const toolKey = TRANSLATION_TOOL_KEY[dim];
    const v2Entry = toolKey ? toolPriorityMap[toolKey] : null;
    const v2Direction = v2Entry ? _directionOf(v2Entry.intensity) : (dim === 'skin' ? 'conservative' : dim === 'safety' ? (safety?.globalSafetyScore != null ? _directionOf(1 - safety.globalSafetyScore) : 'unknown') : 'unknown');
    const clampProfile = toolKey && safety?.clampProfiles ? safety.clampProfiles[toolKey] : null;
    const v2Safety = clampProfile ? clampProfile.clampSeverity : (dim === 'safety' ? (safety?.overStackAnalysis?.severity ?? 'unknown') : 'none');

    let alignment = 'unknown', divergence = 0.5;
    if (legacyDirection !== 'unknown' && v2Direction !== 'unknown') {
      if (legacyDirection === v2Direction) { alignment = 'aligned'; divergence = 0.1; }
      else if ((legacyDirection === 'balanced' || v2Direction === 'balanced')) { alignment = 'partially-aligned'; divergence = 0.4; }
      else { alignment = 'divergent'; divergence = 0.75; }
    }
    const recommendation = alignment === 'divergent' ? `Review ${dim} direction before any future activation — legacy and V2 disagree.` : alignment === 'aligned' ? `${dim} direction is consistent between legacy and V2.` : 'Insufficient data to compare confidently.';
    matrix[dim] = { legacyDirection, v2Direction, v2Safety, alignment, divergence: +divergence.toFixed(2), recommendation, reason: `Compared legacy "${legacyDirection}" against V2 "${v2Direction}" for ${dim}.` };
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
function _buildSafetyDelta(legacySummary, translation, safety) {
  const safetyImprovements = [], remainingRisks = [], reasons = [];
  if (safety?.channelProtectionsCount === undefined) { /* not built yet, ignore */ }
  if (translation?.protectedChannels?.length) safetyImprovements.push('V2 explicitly protects skin/highlight/shadow channels that legacy mapping does not track individually.');
  if (safety && safety.toolCapsCount > 0) safetyImprovements.push(`V2 applies ${safety.toolCapsCount} explicit tool-level safety cap(s) before any future activation.`);
  if (translation?.toolSuppressionMap?.length) safetyImprovements.push('V2 suppresses specific risky tool/channel combinations that legacy mapping applies uniformly.');
  if (safety?.overStackAnalysis && !safety.overStackAnalysis.hasRisk) safetyImprovements.push('V2 actively checks for and currently finds no over-stacking risk in the combined tool plan.');
  if (legacySummary.riskLevel === 'high') safetyImprovements.push('Legacy mapping shows a "high" abstract risk level — V2 layers additional caution legacy mapping does not apply.');

  if (!safety) remainingRisks.push('No Safety Clamp data available — cannot yet estimate a meaningful safety delta.');
  if (safety?.hardStopsCount > 0) remainingRisks.push(`${safety.hardStopsCount} hard stop(s) currently active in V2 — these represent real, unresolved risk, not an improvement.`);
  remainingRisks.push('V2 has not been validated against real shadow-compare data from actual edited photos.');
  remainingRisks.push('Confidence/safety weightings throughout the V2 chain are hand-reasoned, not tuned from measured outcomes.');

  const score = +clamp01(0.4 + safetyImprovements.length * 0.1 - remainingRisks.length * 0.05).toFixed(3);
  const v2SaferThanLegacy = safetyImprovements.length > remainingRisks.length && (safety?.hardStopsCount ?? 0) === 0;
  reasons.push(`Safety delta estimated at ${score} from ${safetyImprovements.length} identified improvement(s) against ${remainingRisks.length} remaining risk(s)/caveat(s).`);
  return { v2SaferThanLegacy, score, safetyImprovements, remainingRisks, reasons };
}

// ── Task 11: Expected Improvement ───────────────────────────────────────────
function _buildExpectedImprovement(divergenceAnalysis, safetyDelta, alignmentScores) {
  const likelyBetterAreas = [...safetyDelta.safetyImprovements];
  const likelySameAreas = [];
  const likelyRiskAreas = [...safetyDelta.remainingRisks];
  if (alignmentScores.overallAlignment > 0.7) likelySameAreas.push('Overall creative direction is largely consistent with legacy mapping.');
  if (divergenceAnalysis.hasMajorDivergence) likelyRiskAreas.push(`${divergenceAnalysis.divergentAreas.length} area(s) diverge from legacy mapping and need human review before any activation.`);
  likelyRiskAreas.push('No controlled activation stage (EPIC 2E) exists yet.');

  const confidence = +clamp01(alignmentScores.overallAlignment * 0.5 + safetyDelta.score * 0.5).toFixed(3);
  const reasons = [`Expected improvement estimate combines alignment (${alignmentScores.overallAlignment}) and safety delta (${safetyDelta.score}) — this is a forward-looking ESTIMATE, not a claim of final image quality improvement.`];
  return { likelyBetterAreas, likelySameAreas, likelyRiskAreas, confidence, reasons };
}

// ── Task 12: Activation Readiness ───────────────────────────────────────────
function _buildActivationReadiness(safetySummary, divergenceAnalysis, missingCount) {
  const blockers = ['EPIC 2E (a real controlled-activation stage) has not been implemented yet — this is a hard blocker regardless of any other signal.'];
  if (safetySummary?.hardStopsCount > 0) blockers.push(`${safetySummary.hardStopsCount} hard stop(s) are currently active.`);
  if (divergenceAnalysis.severity === 'high' || divergenceAnalysis.severity === 'critical') blockers.push(`Divergence severity is "${divergenceAnalysis.severity}".`);
  if (missingCount >= 3) blockers.push(`${missingCount} of 5 core V2 inputs are missing or incomplete.`);
  if (!safetySummary?.available) blockers.push('Safety Clamp data is unavailable.');

  const level = missingCount >= 3 || !safetySummary?.available ? 'not-ready'
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
  const comparisonMatrix = _buildComparisonMatrix(legacySummary, translation, safety);
  const alignmentScores = _buildAlignmentScores(comparisonMatrix, feasibility);
  const divergenceAnalysis = _buildDivergenceAnalysis(comparisonMatrix, translation, safety, dnaNames);
  const safetyDelta = _buildSafetyDelta(legacySummary, translation, safetySummary);
  const expectedImprovement = _buildExpectedImprovement(divergenceAnalysis, safetyDelta, alignmentScores);

  const missingCount = [!plan, !translation, !safety, !budget, !feasibility].filter(Boolean).length;
  const activationReadiness = _buildActivationReadiness(safetySummary, divergenceAnalysis, missingCount);

  const readiness = missingCount >= 3 ? 'not-ready' : missingCount >= 1 ? 'partial' : 'ready-for-shadow-compare';
  const confidence = +clamp01(
    alignmentScores.overallAlignment * 0.35 + safetyDelta.score * 0.35 +
    (translation?.confidence ?? 0.4) * 0.15 + (safety?.confidence ?? safety?.globalSafetyScore ?? 0.4) * 0.15
    - (missingCount >= 3 ? 0.2 : missingCount * 0.05)
  ).toFixed(3);

  reasons.push(`Shadow compare readiness "${readiness}", overall alignment ${alignmentScores.overallAlignment}, safety delta ${safetyDelta.score}.`);
  if (divergenceAnalysis.hasMajorDivergence) reasons.push(`${divergenceAnalysis.divergentAreas.length} divergent area(s): ${divergenceAnalysis.divergentAreas.join(', ')}.`);
  if (missingCount > 0) warnings.push(`${missingCount} of 5 core V2 inputs (plan/translation/safety/budget/feasibility) missing or incomplete.`);

  const photographerSummary = `V2 currently looks ${safetyDelta.v2SaferThanLegacy ? 'more cautious/safer' : 'broadly similar'} than the current mapping, ${divergenceAnalysis.hasMajorDivergence ? `with ${divergenceAnalysis.divergentAreas.length} area(s) worth reviewing` : 'with no major disagreements found'}. This is a shadow comparison only — your exported preset is unaffected.`;

  developerSummaryLines.push('lightroomShadowCompareReportV2 is a REPORT ONLY — it never generates a Lightroom slider value, never touches XMP, and never activates V2 mapping.');
  developerSummaryLines.push(`activationReadiness.canProceedToControlledActivation is hard-coded false — EPIC 2E does not exist yet.`);
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
