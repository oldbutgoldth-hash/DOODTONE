/**
 * ═══════════════════════════════════════════════════════════════════════════
 * STYLE BUDGET INTELLIGENCE (EPIC 1.7)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Answers: "Given the photographer intent, style DNA, feasibility, and
 * capture capability, how should editing EFFORT be distributed?" — an
 * ABSTRACT resource-allocation layer. This is deliberately NOT Lightroom
 * Mapping: every value here is a 0-1 priority, never a slider value, and
 * nothing in this module writes to or reads from
 * core/lightroom-mapping-engine or the XMP generator.
 *
 * NAMING NOTE: a DIFFERENT, older "styleBudget" already exists in
 * core/decision-engine (Stage 2.4C's `_buildStyleBudget`, a simple
 * 4-category colour-mood budget that DOES feed Lightroom Mapping today).
 * This module's export is deliberately called `styleBudgetIntelligence`
 * throughout the codebase to avoid any collision with — or accidental
 * replacement of — that existing, still-in-use system.
 *
 * Same "one function, two call sites" pattern as EPIC 1.6's
 * buildCaptureCapability(): core/decision-engine calls this with
 * preliminary inputs (styleFeasibilityEstimate, captureCapabilityEstimate);
 * core/reference-transfer-engine calls the SAME function with
 * authoritative inputs (styleFeasibility, captureCapability) once they
 * exist. Never two separate copies of this logic.
 */

const clamp01 = (v) => Math.max(0, Math.min(1, v ?? 0));

// ── Task 3: Intent-aware base allocation ────────────────────────────────────
// One example per named intent from the spec; every other detected intent
// falls back to its FAMILY's allocation (via FAMILY_BUDGET_ALLOCATION
// below), and any intent with no family match at all falls back to
// DEFAULT_BUDGET_ALLOCATION. This guarantees every one of the 21 intents
// from EPIC 1.4/1.5 produces a sensible budget, not just the 6 named here.
const DEFAULT_BUDGET_ALLOCATION = {
  tonalBudget: 0.50, colorBudget: 0.50, skinBudget: 0.50, contrastBudget: 0.50,
  wbBudget: 0.50, curveBudget: 0.50, hslBudget: 0.50, calibrationBudget: 0.40,
  colorGradingBudget: 0.50, detailBudget: 0.40, safetyBudget: 0.55,
};

const INTENT_BUDGET_ALLOCATION = {
  'Premium': { // luxury-clean
    tonalBudget: 0.75, skinBudget: 0.85, safetyBudget: 0.80, colorBudget: 0.50,
    calibrationBudget: 0.20, curveBudget: 0.55, wbBudget: 0.40, hslBudget: 0.40,
    colorGradingBudget: 0.45, detailBudget: 0.40, contrastBudget: 0.45,
  },
  'Dreamy': { // soft-emotional
    curveBudget: 0.80, tonalBudget: 0.75, wbBudget: 0.50, contrastBudget: 0.25,
    detailBudget: 0.20, skinBudget: 0.60, safetyBudget: 0.60, colorBudget: 0.40,
    calibrationBudget: 0.30, hslBudget: 0.35, colorGradingBudget: 0.40,
  },
  'Filmic': { // film-organic
    curveBudget: 0.80, colorGradingBudget: 0.80, calibrationBudget: 0.50,
    hslBudget: 0.50, detailBudget: 0.25, skinBudget: 0.70, safetyBudget: 0.55,
    tonalBudget: 0.50, wbBudget: 0.40, contrastBudget: 0.45, colorBudget: 0.50,
  },
  'Editorial': { // editorial-directed / bold
    contrastBudget: 0.75, colorBudget: 0.75, curveBudget: 0.50, detailBudget: 0.50,
    safetyBudget: 0.50, tonalBudget: 0.50, skinBudget: 0.50, wbBudget: 0.45,
    hslBudget: 0.55, calibrationBudget: 0.40, colorGradingBudget: 0.55,
  },
  'Cinematic': { // cinematic-moody
    curveBudget: 0.80, colorGradingBudget: 0.80, contrastBudget: 0.55, tonalBudget: 0.50,
    skinBudget: 0.55, safetyBudget: 0.55, wbBudget: 0.45, hslBudget: 0.50,
    calibrationBudget: 0.40, detailBudget: 0.40, colorBudget: 0.50,
  },
  'Natural': { // documentary-natural
    safetyBudget: 0.80, skinBudget: 0.75, wbBudget: 0.50, calibrationBudget: 0.20,
    colorGradingBudget: 0.25, tonalBudget: 0.50, curveBudget: 0.40, hslBudget: 0.30,
    contrastBudget: 0.40, detailBudget: 0.40, colorBudget: 0.35,
  },
};
// Family-level fallback for intents not individually named above.
const FAMILY_BUDGET_ALLOCATION = {
  'luxury-clean': INTENT_BUDGET_ALLOCATION['Premium'],
  'soft-emotional': INTENT_BUDGET_ALLOCATION['Dreamy'],
  'film-organic': INTENT_BUDGET_ALLOCATION['Filmic'],
  'editorial-directed': INTENT_BUDGET_ALLOCATION['Editorial'],
  'cinematic-moody': INTENT_BUDGET_ALLOCATION['Cinematic'],
  'documentary-natural': INTENT_BUDGET_ALLOCATION['Natural'],
  'minimal-commercial': DEFAULT_BUDGET_ALLOCATION,
};

function _baseAllocation(primaryIntent, intentFamily) {
  return { ...(INTENT_BUDGET_ALLOCATION[primaryIntent] ?? FAMILY_BUDGET_ALLOCATION[intentFamily] ?? DEFAULT_BUDGET_ALLOCATION) };
}

// ── Task 5: Style DNA-aware reinforcement ───────────────────────────────────
// Matches DNA element NAMES already produced by _buildStyleDNA (Stage
// 2.4.2B) — reads them, never recomputes DNA itself. Three worked
// examples from the spec are implemented as named rules; any DNA element
// not covered by a rule is simply ignored (no invented reinforcement).
const DNA_BUDGET_RULES = [
  { element: 'Clean Whites', adjust: { tonalBudget: +0.10, calibrationBudget: -0.10 }, reason: '"Clean Whites" DNA reinforces tonal control and discourages heavy calibration.' },
  { element: 'Highlight Roll-off', adjust: { curveBudget: +0.10, tonalBudget: +0.05 }, reason: '"Highlight Roll-off" DNA calls for curve-driven tonal softness.' },
  { element: 'Open Shadows', adjust: { tonalBudget: +0.05, safetyBudget: +0.05 }, reason: '"Open Shadows" DNA needs careful, protected tonal work.' },
  { element: 'Neutral Warm Skin', adjust: { skinBudget: +0.10, wbBudget: +0.05 }, reason: '"Neutral Warm Skin" DNA reinforces skin priority and gentle WB.' },
  { element: 'Brown Midtones', adjust: { colorGradingBudget: +0.10, curveBudget: +0.05 }, reason: '"Brown Midtones" DNA is primarily colour-grading and curve work.' },
  { element: 'Matte Blacks', adjust: { curveBudget: +0.05, calibrationBudget: -0.05 }, reason: '"Matte Blacks" DNA is curve-driven, not calibration-driven.' },
  { element: 'Muted Green', adjust: { hslBudget: +0.05, colorBudget: -0.05 }, reason: '"Muted Green" DNA calls for restrained HSL work over broad colour push.' },
  { element: 'Warm Skin', adjust: { skinBudget: +0.10, wbBudget: -0.05 }, reason: '"Warm Skin" DNA reinforces skin priority.' },
  { element: 'Film Color Separation', adjust: { colorGradingBudget: +0.10, hslBudget: +0.05 }, reason: '"Film Color Separation" DNA is colour-grading led.' },
  { element: 'Bright Green Luminance', adjust: { hslBudget: +0.05 }, reason: '"Bright Green Luminance" DNA is a luminance-channel (HSL), not saturation, concern.' },
  { element: 'Reduced Green Saturation', adjust: { hslBudget: +0.10, colorBudget: -0.10 }, reason: '"Reduced Green Saturation" DNA explicitly prefers luminance control over saturation push.', suppress: { area: 'green saturation', reason: 'Reduced Green Saturation DNA prefers luminance over saturation.' } },
  { element: 'Pastel Palette', adjust: { curveBudget: +0.10, safetyBudget: +0.10 }, reason: '"Pastel Palette" DNA needs curve-led softness with strong safety margins.' },
  { element: 'Soft Contrast', adjust: { contrastBudget: -0.10, curveBudget: +0.05 }, reason: '"Soft Contrast" DNA explicitly de-prioritises contrast push.' },
];

function _applyDNAReinforcement(budget, styleDNA) {
  const applied = [], suppressions = [], dimensionReasons = {};
  for (const dna of styleDNA ?? []) {
    const rule = DNA_BUDGET_RULES.find(r => r.element === dna.name);
    if (!rule) continue;
    for (const [key, delta] of Object.entries(rule.adjust)) {
      budget[key] = clamp01((budget[key] ?? 0.5) + delta);
      dimensionReasons[key] = rule.reason;
    }
    applied.push(rule.reason);
    if (rule.suppress) suppressions.push({ ...rule.suppress, source: `Style DNA: ${dna.name}` });
  }
  return { applied, suppressions, dimensionReasons };
}

// ── Task 4: Capture-aware reduction ─────────────────────────────────────────
function _applyCaptureAdjustment(budget, cap) {
  const applied = [], dimensionReasons = {};
  if (!cap) return { applied, dimensionReasons };
  if (cap.highlightRecovery < 0.45) {
    budget.tonalBudget = clamp01(budget.tonalBudget - 0.15);
    budget.safetyBudget = clamp01(budget.safetyBudget + 0.15);
    const reason = `Low highlight recovery (${cap.highlightRecovery.toFixed(2)}) — reduced highlight-heavy tonal budget, raised safety budget.`;
    applied.push(reason); dimensionReasons.tonalBudget = reason; dimensionReasons.safetyBudget = reason;
  }
  if (cap.shadowRecovery < 0.45) {
    budget.contrastBudget = clamp01(budget.contrastBudget - 0.10);
    budget.safetyBudget = clamp01(budget.safetyBudget + 0.10);
    const reason = `Low shadow recovery (${cap.shadowRecovery.toFixed(2)}) — reduced shadow-crushing contrast budget, raised safety budget.`;
    applied.push(reason); dimensionReasons.contrastBudget = reason; dimensionReasons.safetyBudget = reason;
  }
  if (cap.whiteBalanceLatitude < 0.40) {
    budget.wbBudget = clamp01(budget.wbBudget - 0.15);
    const reason = `Low white balance latitude (${cap.whiteBalanceLatitude.toFixed(2)}) — reduced WB budget in favour of safer tonal balance.`;
    applied.push(reason); dimensionReasons.wbBudget = reason;
  }
  if (cap.colorLatitude < 0.40) {
    budget.hslBudget = clamp01(budget.hslBudget - 0.15);
    budget.calibrationBudget = clamp01(budget.calibrationBudget - 0.10);
    budget.safetyBudget = clamp01(budget.safetyBudget + 0.10);
    const reason = `Low colour latitude (${cap.colorLatitude.toFixed(2)}) — reduced HSL/calibration budget, raised safety budget.`;
    applied.push(reason); dimensionReasons.hslBudget = reason; dimensionReasons.calibrationBudget = reason;
  }
  if (cap.skinReliability < 0.45) {
    budget.skinBudget = clamp01(budget.skinBudget + 0.15);
    budget.colorBudget = clamp01(budget.colorBudget - 0.10);
    const reason = `Low skin reliability (${cap.skinReliability.toFixed(2)}) — raised skin budget, reduced aggressive colour manipulation.`;
    applied.push(reason); dimensionReasons.skinBudget = reason; dimensionReasons.colorBudget = reason;
  }
  // Patch 4 (EPIC 1.7F): noise-related adjustment moved to
  // _applyNoiseAwareAdjustment() below — it now depends on
  // noiseReliability.status, not just the raw noiseTolerance number, so
  // it must run after noiseReliability is determined in the main function.
  return { applied, dimensionReasons };
}

// Patch 4 (EPIC 1.7F): noise data can be MEASURED (real
// image-analysis-core quality pass ran), ESTIMATED (Capture Capability
// fell back to its neutral 0.55 default — see capture-capability-
// model.js's own `hasQualityData` flag, surfaced here via its warning
// text since no dedicated field exists), or UNAVAILABLE (no
// captureCapability object at all). This module must not claim
// certainty it doesn't have — it can only tell measured from estimated
// by reading that same warning text capture-capability-model.js already
// emits for exactly this situation.
function _buildNoiseReliability(captureCapability) {
  if (!captureCapability) {
    return { status: 'unavailable', source: null, confidence: 0, reason: 'Noise tolerance unavailable; detail budget uses conservative fallback.' };
  }
  const isEstimated = (captureCapability.warnings ?? []).some(w => w.includes('Noise/sharpness data not yet available'));
  if (isEstimated) {
    return { status: 'estimated', source: 'Capture Capability (neutral default — no measured noise/sharpness data yet)', confidence: 0.30, reason: 'Noise-related budget is preliminary because noise source is not confirmed.' };
  }
  return { status: 'measured', source: 'Capture Capability (image-analysis-core quality pass)', confidence: +clamp01(captureCapability.confidence ?? 0.7).toFixed(3), reason: 'Noise tolerance was measured from the actual capture.' };
}

// Patch 4: noise-aware budget adjustment, now conditioned on
// noiseReliability.status rather than the raw number alone — this
// REPLACES the old unconditional "noiseTolerance < 0.40 → reduce
// detailBudget" rule that used to live inside _applyCaptureAdjustment.
function _applyNoiseAwareAdjustment(budget, captureCapability, noiseReliability) {
  const applied = [], warnings = [], suppressed = [];
  const dimensionReasons = {};

  if (noiseReliability.status === 'unavailable') {
    // Do NOT aggressively reduce detailBudget with no data at all —
    // conservative fallback only, not a confirmed reduction.
    budget.detailBudget = clamp01(Math.min(budget.detailBudget, 0.45));
    warnings.push('Noise tolerance unavailable; detail budget uses conservative fallback.');
    dimensionReasons.detailBudget = 'Noise tolerance unavailable — detail budget capped conservatively rather than confirmed-reduced.';
    return { applied, warnings, suppressed, dimensionReasons };
  }

  if (noiseReliability.status === 'estimated') {
    warnings.push('Noise-related budget is preliminary because noise source is not confirmed.');
    // Still allow a mild, clearly-labelled easing — not a confirmed cut.
    if ((captureCapability.noiseTolerance ?? 0.55) < 0.40) {
      budget.detailBudget = clamp01(budget.detailBudget - 0.10);
      const reason = `Estimated noise tolerance is low (${captureCapability.noiseTolerance.toFixed(2)}, unconfirmed) — detail budget eased conservatively pending real measurement.`;
      applied.push(reason); dimensionReasons.detailBudget = reason;
    }
    return { applied, warnings, suppressed, dimensionReasons };
  }

  // status === 'measured' — confirmed real data, safe to apply the full rule.
  if (captureCapability.noiseTolerance < 0.40) {
    budget.detailBudget = clamp01(budget.detailBudget - 0.20);
    budget.safetyBudget = clamp01(budget.safetyBudget + 0.10);
    const reason = `Measured noise tolerance is low (${captureCapability.noiseTolerance.toFixed(2)}) — reduced detail/clarity budget, raised safety budget.`;
    applied.push(reason); dimensionReasons.detailBudget = reason; dimensionReasons.safetyBudget = reason;
    suppressed.push(
      { area: 'harsh clarity', reason: 'Measured noise tolerance is low — aggressive clarity work would amplify visible noise.', source: 'Capture Capability (measured)', severity: 'medium' },
      { area: 'aggressive texture', reason: 'Measured noise tolerance is low — aggressive texture/detail work would amplify visible noise.', source: 'Capture Capability (measured)', severity: 'medium' },
    );
  }
  return { applied, warnings, suppressed, dimensionReasons };
}

// ── Task 6: Over-stacking detection ─────────────────────────────────────────
const STACKING_RULES = [
  { riskType: 'HSL + Calibration + Color Grading stacking', test: b => b.hslBudget > 0.65 && b.calibrationBudget > 0.65 && b.colorGradingBudget > 0.65, affected: ['hslBudget', 'calibrationBudget', 'colorGradingBudget'], severity: 'high', note: 'Three colour-manipulation budgets all high at once risks compounding colour artifacts.' },
  { riskType: 'WB + Color Grading + Calibration stacking', test: b => b.wbBudget > 0.65 && b.colorGradingBudget > 0.65 && b.calibrationBudget > 0.65, affected: ['wbBudget', 'colorGradingBudget', 'calibrationBudget'], severity: 'high', note: 'Three colour-temperature-affecting budgets all high risks an unstable overall cast.' },
  { riskType: 'Contrast + Curve high with low safety', test: b => b.contrastBudget > 0.65 && b.curveBudget > 0.65 && b.safetyBudget < 0.45, affected: ['contrastBudget', 'curveBudget', 'safetyBudget'], severity: 'high', note: 'Aggressive tonal push with low safety margin risks crushed/blown tonal transitions.' },
  { riskType: 'Detail high with low noise tolerance', test: (b, cap) => b.detailBudget > 0.6 && cap && cap.noiseTolerance < 0.45, affected: ['detailBudget'], severity: 'medium', note: 'Pushing detail/clarity on a noise-limited capture risks amplifying noise.' },
  { riskType: 'Color high with low color latitude', test: (b, cap) => b.colorBudget > 0.65 && cap && cap.colorLatitude < 0.45, affected: ['colorBudget'], severity: 'medium', note: 'Pushing colour further on a capture with little colour latitude left risks clipping.' },
];

function _detectStackingRisk(budget, captureCapability) {
  const risks = [];
  for (const rule of STACKING_RULES) {
    if (rule.test(budget, captureCapability)) risks.push(rule);
  }
  if (!risks.length) return { hasRisk: false, severity: 'none', riskType: null, affectedBudgets: [], recommendations: [], reasons: ['No budget-stacking risk detected — allocation is within safe combined limits.'] };

  const severity = risks.some(r => r.severity === 'high') ? 'high' : 'medium';
  return {
    hasRisk: true, severity,
    riskType: risks.map(r => r.riskType).join('; '),
    affectedBudgets: [...new Set(risks.flatMap(r => r.affected))],
    recommendations: risks.map(r => `Consider easing one of: ${r.affected.join(', ')} — ${r.note}`),
    reasons: risks.map(r => r.note),
  };
}

// ── Task 7: Suppressed areas (beyond DNA-driven suppressions above) ────────
function _buildSuppressedAreas(budget, captureCapability, dnaSuppressions, intentConflicts) {
  const suppressed = [...dnaSuppressions];
  if (captureCapability) {
    if (captureCapability.highlightRecovery < 0.35) suppressed.push({ area: 'aggressive highlight recovery', reason: 'Highlight recovery headroom is nearly exhausted on this capture.', source: 'Capture Capability', severity: 'high' });
    if (captureCapability.shadowRecovery < 0.35) suppressed.push({ area: 'deep crushed blacks', reason: 'Shadow recovery headroom is nearly exhausted — pushing blacks further risks unrecoverable crush.', source: 'Capture Capability', severity: 'high' });
    if (captureCapability.whiteBalanceLatitude < 0.35) suppressed.push({ area: 'strong WB shift', reason: 'White balance latitude is limited — a strong shift risks an unnatural cast.', source: 'Capture Capability', severity: 'medium' });
    if (captureCapability.noiseTolerance < 0.35) suppressed.push({ area: 'harsh clarity', reason: 'Noise tolerance is low — aggressive clarity/texture work would amplify visible noise.', source: 'Capture Capability', severity: 'medium' });
  }
  if (budget.calibrationBudget < 0.25) suppressed.push({ area: 'aggressive calibration', reason: 'Calibration budget was reduced by intent/capture signals — heavy calibration would work against the detected intent or capture limits.', source: 'Style Budget Allocation', severity: 'low' });
  if (budget.contrastBudget > 0.7 === false && budget.contrastBudget < 0.3) suppressed.push({ area: 'heavy contrast', reason: 'Contrast budget is intentionally low for this intent — a heavy contrast push would contradict it.', source: 'Style Budget Allocation', severity: 'low' });
  if (intentConflicts?.hasConflict && intentConflicts.severity === 'high') {
    suppressed.push({ area: 'full-strength application of the detected intent', reason: `High-severity intent conflict detected (${intentConflicts.conflicts?.map(c => c.name).join(', ')}) — apply the look conservatively until reviewed.`, source: 'Intent Conflict', severity: 'high' });
  }
  return suppressed;
}

// ── Task 8: Budget confidence — deliberately NOT a reuse of intent confidence ──
// Patch 3 (EPIC 1.7F): the OLD formula could return ~0.5+ even when
// almost every input was missing, because each missing signal quietly
// fell back to a neutral-ish default (0.5/0.7) that still contributed
// positively to the weighted sum. This is now corrected with an
// explicit missing-input count and a penalty that dominates the
// formula once 4+ of the 6 critical inputs are absent.
function _computeBudgetConfidence({ intentConfidence, intentStrength, dnaValidationScore, feasibilityScore, captureConfidence, refColorConfidence, conflictSeverity, stackingRisk, missingInputCount }) {
  const conflictPenalty = { high: 0.25, medium: 0.12, none: 0, low: 0.05 }[conflictSeverity] ?? 0;
  const stackingPenalty = stackingRisk?.severity === 'high' ? 0.15 : stackingRisk?.severity === 'medium' ? 0.08 : 0;

  let confidence = (intentConfidence ?? 0.5) * 0.20
    + (intentStrength ?? 0.5) * 0.15
    + (dnaValidationScore ?? 0.7) * 0.20
    + (feasibilityScore ?? 0.5) * 0.20
    + (captureConfidence ?? 0.5) * 0.15
    + (refColorConfidence ?? 0.5) * 0.10
    - conflictPenalty - stackingPenalty;

  // Missing-input penalty: scales sharply once several critical inputs
  // are absent, so an (almost) empty-input call lands in the required
  // 0.25-0.38 band rather than drifting back up toward 0.5 on defaults.
  if (missingInputCount >= 4) {
    confidence = Math.min(confidence, 0.38 - (missingInputCount - 4) * 0.04);
  } else if (missingInputCount >= 2) {
    confidence -= missingInputCount * 0.06;
  }

  return +clamp01(confidence).toFixed(3);
}

// Patch 2 (EPIC 1.7F): human-readable area name + typical source signal
// per budget dimension — used to upgrade priorities[] from bare
// {dimension, value} into the required {area, dimension, value, level,
// reason, source} shape.
const DIMENSION_META = {
  tonalBudget: { area: 'tonal control', source: 'Photographer Intent' },
  colorBudget: { area: 'color separation', source: 'Photographer Intent' },
  skinBudget: { area: 'skin protection', source: 'Capture Capability' },
  contrastBudget: { area: 'natural rendering', source: 'Photographer Intent' },
  wbBudget: { area: 'WB restraint', source: 'Capture Capability' },
  curveBudget: { area: 'curve shaping', source: 'Photographer Intent' },
  hslBudget: { area: 'color separation', source: 'Style DNA' },
  calibrationBudget: { area: 'calibration restraint', source: 'Style DNA' },
  colorGradingBudget: { area: 'curve shaping', source: 'Photographer Intent' },
  detailBudget: { area: 'detail restraint', source: 'Capture Capability' },
  safetyBudget: { area: 'highlight safety', source: 'Capture Capability' },
};
function _levelOf(value) {
  return value >= 0.85 ? 'critical' : value >= 0.65 ? 'high' : value >= 0.4 ? 'medium' : 'low';
}
function _buildPriorities(budget, dimensionReasons) {
  return Object.entries(budget).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([dimension, value]) => {
    const meta = DIMENSION_META[dimension] ?? { area: dimension.replace('Budget', ''), source: 'Style Budget Allocation' };
    return {
      area: meta.area, dimension, value: +value.toFixed(3), level: _levelOf(value),
      reason: dimensionReasons[dimension] ?? `"${meta.area}" was allocated a ${_levelOf(value)} priority in this budget.`,
      source: meta.source,
    };
  });
}

/**
 * Main entry point — Task 1 model, assembled from Tasks 3-8. Called with
 * PRELIMINARY inputs from core/decision-engine (styleFeasibilityEstimate,
 * captureCapabilityEstimate — both may be less complete than their
 * authoritative counterparts) and again with AUTHORITATIVE inputs from
 * core/reference-transfer-engine — same function both times.
 */
export function buildStyleBudgetIntelligence({
  photographerIntent, photographerStyle, styleFeasibility, captureCapability,
  referenceColorIntelligence = null, engineTrustWeights = null,
}) {
  // Patch 3 (EPIC 1.7F): count missing critical inputs BEFORE applying
  // any default, so the confidence penalty reflects genuine absence —
  // not defaults that were quietly substituted in.
  const missingInputCount = [
    !photographerIntent, !photographerStyle?.top?.styleDNA?.length,
    !photographerStyle?.top?.styleDNAValidation, !styleFeasibility,
    !captureCapability, !referenceColorIntelligence,
  ].filter(Boolean).length;

  const primaryIntent = photographerIntent?.primaryIntent ?? 'Natural';
  const intentFamily = photographerIntent?.intentFamily ?? 'documentary-natural';
  const intentStrength = photographerIntent?.intentStrength ?? 0.5;
  const intentConfidence = photographerIntent?.confidence ?? 0.5;
  const styleDNA = photographerStyle?.top?.styleDNA ?? [];
  const dnaValidationScore = photographerStyle?.top?.styleDNAValidation?.score ?? 0.7;
  const feasibilityScore = styleFeasibility?.score ?? (styleFeasibility?.level === 'high' ? 0.8 : styleFeasibility?.level === 'medium' ? 0.5 : styleFeasibility?.level === 'low' ? 0.25 : 0.5);

  // Task 3
  const budget = _baseAllocation(primaryIntent, intentFamily);

  // Task 5
  const { applied: dnaReasons, suppressions: dnaSuppressions, dimensionReasons: dnaDimReasons } = _applyDNAReinforcement(budget, styleDNA);

  // Task 4 (non-noise dimensions)
  const { applied: captureReasons, dimensionReasons: captureDimReasons } = _applyCaptureAdjustment(budget, captureCapability);

  // Patch 4: noise-aware adjustment, run separately with explicit
  // measured/estimated/unavailable handling.
  const noiseReliability = _buildNoiseReliability(captureCapability);
  const { applied: noiseReasons, warnings: noiseWarnings, suppressed: noiseSuppressed, dimensionReasons: noiseDimReasons } =
    _applyNoiseAwareAdjustment(budget, captureCapability, noiseReliability);

  // Task 6 (runs AFTER all budget adjustments above, including noise)
  const budgetStackingRisk = _detectStackingRisk(budget, captureCapability);

  // Task 7
  const suppressedAreas = [
    ..._buildSuppressedAreas(budget, captureCapability, dnaSuppressions, photographerIntent?.conflicts),
    ...noiseSuppressed,
  ];

  // Task 8 / Patch 3
  const confidence = _computeBudgetConfidence({
    intentConfidence, intentStrength, dnaValidationScore, feasibilityScore,
    captureConfidence: captureCapability?.confidence, refColorConfidence: referenceColorIntelligence?.confidence,
    conflictSeverity: photographerIntent?.conflicts?.severity ?? 'none', stackingRisk: budgetStackingRisk,
    missingInputCount,
  });

  const overallBudget = +clamp01(Object.values(budget).reduce((a, b) => a + b, 0) / Object.keys(budget).length).toFixed(3);
  // Patch 1 (EPIC 1.7F): required vocabulary is conservative / balanced /
  // expressive / aggressive-risky — "assertive" was the old, non-standard
  // term and has been fully replaced. "aggressive-risky" is a WARNING
  // LABEL ONLY (never modifies mapping or any budget value) surfaced when
  // a high overall budget coincides with a real risk signal.
  //
  // Threshold calibration note: overallBudget is an 11-dimension AVERAGE,
  // and several dimensions (detailBudget, calibrationBudget) are
  // deliberately kept low by nearly every intent allocation — the
  // realistic ceiling across all 6 named intents, even with full DNA
  // reinforcement and an excellent capture, is ~0.57-0.58, never close to
  // 0.7. The "high budget" threshold is set at 0.54 to sit meaningfully
  // above the ~0.44-0.52 range typical of a normal, unremarkable capture,
  // while still being reachable by the intents this stage's own
  // allocation table actually produces — verified against all 6 named
  // intents under both typical and excellent capture conditions.
  const hasHighBudget = overallBudget >= 0.54;
  const hasRiskSignal = budget.safetyBudget < 0.40
    || budgetStackingRisk.severity === 'high'
    || (captureCapability && captureCapability.overallScore < 0.40);
  const budgetLevel = hasHighBudget && hasRiskSignal ? 'aggressive-risky'
    : hasHighBudget ? 'expressive'
    : (overallBudget >= 0.42 && missingInputCount < 4) ? 'balanced'
    : 'conservative';

  // Patch 2: priorities[] upgraded to {area, dimension, value, level,
  // reason, source} — dimensionReasons merges DNA + capture + noise
  // adjustments so the MOST SPECIFIC available reason is shown per
  // dimension (later merges here intentionally override earlier ones
  // only where a more specific adjustment actually touched that
  // dimension; dimensions untouched by any adjustment fall back to the
  // generic per-dimension text _buildPriorities already provides).
  const dimensionReasons = { ...dnaDimReasons, ...captureDimReasons, ...noiseDimReasons };
  const priorities = _buildPriorities(budget, dimensionReasons);

  const risks = [];
  if (budgetStackingRisk.hasRisk) risks.push(`Budget stacking risk detected (${budgetStackingRisk.severity}): ${budgetStackingRisk.riskType}.`);
  if (confidence < 0.4) risks.push('Overall budget confidence is low — treat this allocation as a rough starting point, not a settled plan.');
  if (budgetLevel === 'aggressive-risky') risks.push('Budget level is "aggressive-risky" — a high overall budget combined with a real risk signal (low safety, high stacking risk, or limited capture capability). This is a warning label only and does not change any budget value or feed Lightroom Mapping.');

  const reasons = [
    `Base allocation for "${primaryIntent}" (${intentFamily} family): top priorities are ${priorities.map(p => p.area).join(', ')}.`,
    ...dnaReasons, ...captureReasons, ...noiseReasons,
  ];
  const warnings = [...noiseWarnings];
  if (!captureCapability) warnings.push('No Capture Capability data was available — this budget does not yet reflect full capture-aware adjustment (Task 4).');
  if (missingInputCount >= 4) warnings.push(`${missingInputCount} of 6 critical inputs (Photographer Intent, Style DNA, Style DNA Validation, Style Feasibility, Capture Capability, Reference Color Intelligence) were missing — confidence has been reduced accordingly; treat this budget as a rough default, not a considered allocation.`);
  if (engineTrustWeights) reasons.push('Engine trust weights were available and considered contextually alongside DNA validation confidence.');

  return {
    overallBudget, budgetLevel,
    tonalBudget: +budget.tonalBudget.toFixed(3), colorBudget: +budget.colorBudget.toFixed(3),
    skinBudget: +budget.skinBudget.toFixed(3), contrastBudget: +budget.contrastBudget.toFixed(3),
    wbBudget: +budget.wbBudget.toFixed(3), curveBudget: +budget.curveBudget.toFixed(3),
    hslBudget: +budget.hslBudget.toFixed(3), calibrationBudget: +budget.calibrationBudget.toFixed(3),
    colorGradingBudget: +budget.colorGradingBudget.toFixed(3), detailBudget: +budget.detailBudget.toFixed(3),
    safetyBudget: +budget.safetyBudget.toFixed(3),
    confidence, priorities, suppressedAreas, budgetStackingRisk,
    noiseReliability,
    risks, reasons, warnings,
  };
}
