/**
 * ═══════════════════════════════════════════════════════════════════════════
 * LIGHTROOM MAPPING V2 PLANNER (EPIC 2A) — SHADOW-ONLY
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Answers: "How should Lightroom Mapping V2 THINK about this image?" — an
 * abstract planning layer, NOT a slider generator. This module NEVER
 * outputs a Lightroom slider value (no Exposure +0.4, no Contrast -12, no
 * Temp +300, no numeric HSL value) — every plan dimension below is a
 * 0-1 abstract priority/intensity/safety-limit, exactly like
 * styleBudgetIntelligence (EPIC 1.7) that feeds it.
 *
 * SHADOW-ONLY: this module is not called from anywhere in the production
 * pipeline. `core/lightroom-mapping-engine/index.js`'s existing
 * `mapStyleFingerprintToLightroom()` — the ONLY function that currently
 * produces real Lightroom slider values and feeds XMP export — is
 * completely untouched by this file and does not import from it.
 * `fallbackStrategy.useLegacyMapping` is always `true` in this phase.
 *
 * Every input is OPTIONAL. This function must never throw — every field
 * access below is null-safe, and every code path (including a fully
 * empty call `buildLightroomMappingPlanV2({})`) returns a complete,
 * well-formed `lightroomMappingPlanV2` object with `readiness:
 * "not-ready"` rather than crashing or returning partial/undefined data.
 */

const clamp01 = (v) => Math.max(0, Math.min(1, v ?? 0));
const priorityOf = (v) => v >= 0.85 ? 'critical' : v >= 0.65 ? 'high' : v >= 0.4 ? 'medium' : 'low';

/** Task 3 helper — builds one structured plan dimension, never a slider value. */
function _plan({ priority, direction, intensity, safetyLimit, reason, sourceSignals }) {
  return {
    priority: priority ?? 'low',
    direction: direction ?? 'maintain natural, unmodified rendering',
    intensity: +clamp01(intensity).toFixed(3),
    safetyLimit: +clamp01(safetyLimit ?? 0.5).toFixed(3),
    reason: reason ?? 'No strong signal — default conservative plan.',
    sourceSignals: sourceSignals ?? [],
  };
}

/**
 * Task 6: Intent/DNA-driven directional guidance, keyed by intent name
 * (falls back to intentFamily, then to a generic conservative default) —
 * mirrors the same "named examples + family fallback" pattern
 * core/decision-engine/style-budget-model.js already established for
 * EPIC 1.7, applied here to PLAN DIRECTION rather than budget numbers.
 */
const INTENT_PLAN_GUIDANCE = {
  'Premium': {
    priorityDims: ['skinPlan', 'tonalPlan', 'safetyPlan'],
    tonalDirection: 'protect clean whites and cream highlights, controlled contrast',
    protect: [{ area: 'clean whites', severity: 'high' }, { area: 'cream highlights', severity: 'medium' }],
    avoid: [{ tool: 'aggressive Calibration', severity: 'medium' }, { tool: 'dirty/cast Whites', severity: 'high' }, { tool: 'harsh skin rendering', severity: 'high' }],
  },
  'Elegant': {
    priorityDims: ['skinPlan', 'tonalPlan', 'safetyPlan'],
    tonalDirection: 'controlled contrast, clean neutral-warm tones',
    protect: [{ area: 'clean whites', severity: 'medium' }],
    avoid: [{ tool: 'busy/complex colour palette', severity: 'low' }, { tool: 'harsh skin rendering', severity: 'high' }],
  },
  'Dreamy': {
    priorityDims: ['curvePlan', 'tonalPlan'],
    tonalDirection: 'soften contrast, open shadows gently, soft highlight roll-off',
    protect: [{ area: 'highlight roll-off', severity: 'medium' }],
    avoid: [{ tool: 'harsh Clarity', severity: 'high' }, { tool: 'deep crushed Blacks', severity: 'high' }],
  },
  'Filmic': {
    priorityDims: ['curvePlan', 'colorGradingPlan', 'hslPlan'],
    tonalDirection: 'matte shadow character, film-style colour separation',
    protect: [{ area: 'skin tones', severity: 'high' }, { area: 'film midtones', severity: 'medium' }],
    avoid: [{ tool: 'excessive Green Saturation', severity: 'medium' }, { tool: 'neon-level Saturation', severity: 'high' }],
  },
  'Cinematic': {
    priorityDims: ['curvePlan', 'colorGradingPlan'],
    tonalDirection: 'deepen shadows cautiously, deliberate colour grading',
    protect: [{ area: 'shadow detail', severity: 'high' }],
    avoid: [{ tool: 'over-opened Whites', severity: 'high' }],
  },
  'Natural': {
    priorityDims: ['safetyPlan', 'skinPlan', 'wbPlan'],
    tonalDirection: 'maintain natural exposure, unforced tone',
    protect: [{ area: 'skin tones', severity: 'medium' }, { area: 'neutral grays', severity: 'low' }],
    avoid: [{ tool: 'artificial/heavy grading', severity: 'medium' }],
  },
};
const FAMILY_PLAN_GUIDANCE = {
  'luxury-clean': INTENT_PLAN_GUIDANCE['Premium'],
  'soft-emotional': INTENT_PLAN_GUIDANCE['Dreamy'],
  'film-organic': INTENT_PLAN_GUIDANCE['Filmic'],
  'cinematic-moody': INTENT_PLAN_GUIDANCE['Cinematic'],
  'documentary-natural': INTENT_PLAN_GUIDANCE['Natural'],
};
const DEFAULT_PLAN_GUIDANCE = {
  priorityDims: ['safetyPlan', 'tonalPlan'],
  tonalDirection: 'maintain natural, unmodified rendering',
  protect: [{ area: 'skin tones', severity: 'low' }],
  avoid: [],
};
function _planGuidance(primaryIntent, intentFamily, styleDNANames) {
  let guidance = INTENT_PLAN_GUIDANCE[primaryIntent] ?? FAMILY_PLAN_GUIDANCE[intentFamily] ?? DEFAULT_PLAN_GUIDANCE;
  // "Green Pastel" style/DNA is a special-cased addition regardless of
  // detected intent, per Task 6's explicit worked example.
  if (styleDNANames?.some(n => n === 'Reduced Green Saturation' || n === 'Bright Green Luminance')) {
    guidance = {
      ...guidance,
      greenPastelOverride: true,
      protect: [...guidance.protect, { area: 'natural greens', severity: 'high' }],
      avoid: [...guidance.avoid, { tool: 'excessive Green Saturation', severity: 'high' }, { tool: 'Calibration stacking', severity: 'medium' }],
    };
  }
  return guidance;
}

/**
 * Main entry point. Every field of `input` is optional; every internal
 * access is null-safe via `?.` and `??`. This function is guaranteed to
 * never throw, even called as `buildLightroomMappingPlanV2({})` or
 * `buildLightroomMappingPlanV2()`.
 */
export function buildLightroomMappingPlanV2(input = {}) {
  const {
    decision = null, finalStyleIntent = null, photographerIntent = null,
    styleBudgetIntelligence = null, styleDNA = null, styleDNAValidation = null,
    styleFeasibility = null, captureCapability = null, referenceColorIntelligence = null,
    transferConfidence = null, legacyMapping = null, legacyStyleBudget = null,
  } = input ?? {};

  // Resolve from either the flat top-level args OR finalStyleIntent/decision
  // (whichever the caller happened to pass) — never assume one shape.
  const intent = photographerIntent ?? finalStyleIntent?.photographerIntent ?? null;
  const budget = styleBudgetIntelligence ?? finalStyleIntent?.styleBudgetIntelligence ?? null;
  const dna = styleDNA ?? finalStyleIntent?.photographerStyle?.top?.styleDNA ?? [];
  const dnaValidation = styleDNAValidation ?? finalStyleIntent?.photographerStyle?.top?.styleDNAValidation ?? null;
  const feasibility = styleFeasibility ?? finalStyleIntent?.styleFeasibilityEstimate ?? null;
  const capture = captureCapability ?? finalStyleIntent?.captureCapabilityEstimate ?? null;
  const refColor = referenceColorIntelligence ?? null;
  const transferConf = transferConfidence ?? null;

  // ── Task 2: readiness — how much of the required input actually exists ──
  const criticalPresent = [!!intent, !!budget, !!dna?.length, !!dnaValidation, !!feasibility, !!capture].filter(Boolean).length;
  const readiness = criticalPresent >= 5 ? 'ready-for-shadow-compare'
    : criticalPresent >= 2 ? 'partial'
    : 'not-ready';

  const primaryIntent = intent?.primaryIntent ?? 'Natural';
  const intentFamily = intent?.intentFamily ?? 'documentary-natural';
  const dnaNames = (dna ?? []).map(d => d?.name).filter(Boolean);
  const guidance = _planGuidance(primaryIntent, intentFamily, dnaNames);

  const b = budget ?? {}; // every budget.* access below defaults to undefined → handled by ?? 0.5 per-field
  const cap = capture ?? {};

  const protectedAreas = [...guidance.protect.map(p => ({ area: p.area, reason: `"${primaryIntent}" intent/DNA guidance protects this area.`, source: 'Photographer Intent / Style DNA', severity: p.severity }))];
  const avoidedTools = [...guidance.avoid.map(a => ({ tool: a.tool, reason: `"${primaryIntent}" intent/DNA guidance avoids this.`, source: 'Photographer Intent / Style DNA', severity: a.severity }))];
  const recommendedTools = [];
  const sliderRiskWarnings = [];
  const developerNotes = [];
  const warnings = [];
  const reasons = [`Plan built for primary intent "${primaryIntent}" (${intentFamily} family), readiness "${readiness}".`];

  // ── Task 4: styleBudgetIntelligence as planning input (safe — read-only) ──
  const tonalBudget = b.tonalBudget ?? 0.5, contrastBudget = b.contrastBudget ?? 0.5;
  const colorBudget = b.colorBudget ?? 0.5, skinBudget = b.skinBudget ?? 0.5;
  const wbBudget = b.wbBudget ?? 0.5, curveBudget = b.curveBudget ?? 0.5;
  const hslBudget = b.hslBudget ?? 0.5, calibrationBudget = b.calibrationBudget ?? 0.5;
  const colorGradingBudget = b.colorGradingBudget ?? 0.5, detailBudget = b.detailBudget ?? 0.5;
  const safetyBudget = b.safetyBudget ?? 0.55;

  if (b.budgetLevel === 'aggressive-risky') {
    sliderRiskWarnings.push('Style Budget is "aggressive-risky" — high overall allocation combined with a real risk signal; plan conservatively despite high individual budgets.');
  }
  if (hslBudget > 0.65 && calibrationBudget > 0.65 && colorGradingBudget > 0.65) {
    sliderRiskWarnings.push('High color grading, HSL, and calibration budgets may over-stack color.');
  }

  // ── Task 5: Capture Capability safety limits (can only REDUCE intensity/priority, never invent slider values) ──
  const highlightRecovery = cap.highlightRecovery, shadowRecovery = cap.shadowRecovery;
  const noiseTolerance = cap.noiseTolerance, wbLatitude = cap.whiteBalanceLatitude;
  const colorLatitude = cap.colorLatitude, skinReliability = cap.skinReliability;
  // EPIC 2B Task 0 fix: never assume "measured" without an explicit
  // noiseReliability source/confidence — this previously defaulted to
  // 'measured' whenever `capture` existed at all, even if
  // captureCapability carried no real noiseReliability data of its own.
  // Now: explicit status wins; otherwise 'estimated' if capture data
  // exists (its noiseTolerance figure may still be a rough read), or
  // 'unavailable' if there's no capture data at all.
  const noiseStatus = budget?.noiseReliability?.status
    ?? (capture?.noiseReliability?.status)
    ?? (capture ? 'estimated' : 'unavailable');

  let tonalDirection = guidance.tonalDirection;
  let tonalSafety = 0.6;
  if (highlightRecovery != null && highlightRecovery < 0.45) {
    tonalDirection = 'avoid aggressive whites/highlights — ' + tonalDirection;
    tonalSafety = 0.85;
    protectedAreas.push({ area: 'highlight roll-off', reason: `Low highlight recovery (${highlightRecovery.toFixed(2)}) limits safe highlight push.`, source: 'Capture Capability', severity: 'high' });
    warnings.push('Limited highlight latitude — high-key mapping should be conservative.');
  }
  const tonalPlan = _plan({
    priority: priorityOf(Math.max(tonalBudget, contrastBudget)),
    direction: tonalDirection, intensity: (tonalBudget + contrastBudget) / 2, safetyLimit: tonalSafety,
    reason: `Tonal priority driven by intent (${primaryIntent}) tonal/contrast budget.`,
    sourceSignals: ['Photographer Intent', 'Style Budget Intelligence', capture ? 'Capture Capability' : null].filter(Boolean),
  });

  let curveDirection = 'gentle, natural tonal transitions';
  let curveSafety = 0.6;
  if (shadowRecovery != null && shadowRecovery < 0.45) {
    curveDirection = 'avoid crushed blacks — preserve shadow detail';
    curveSafety = 0.85;
    protectedAreas.push({ area: 'shadow detail', reason: `Low shadow recovery (${shadowRecovery.toFixed(2)}) limits safe shadow push.`, source: 'Capture Capability', severity: 'high' });
    warnings.push('Limited shadow latitude — avoid deepening shadows aggressively.');
  } else if (guidance.tonalDirection?.includes('deepen shadows') || primaryIntent === 'Cinematic') {
    curveDirection = 'deepen shadows cautiously, deliberate colour grading curve';
  } else if (primaryIntent === 'Dreamy') {
    curveDirection = 'soften contrast via gentle curve, open shadows';
  }
  const curvePlan = _plan({
    priority: priorityOf(curveBudget), direction: curveDirection, intensity: curveBudget, safetyLimit: curveSafety,
    reason: `Curve priority driven by intent (${primaryIntent}) curve budget${shadowRecovery != null && shadowRecovery < 0.45 ? ', reduced for shadow safety' : ''}.`,
    sourceSignals: ['Photographer Intent', 'Style Budget Intelligence'],
  });

  let wbIntensity = wbBudget, wbDirection = 'maintain natural white balance';
  if (wbLatitude != null && wbLatitude < 0.40) {
    wbIntensity = clamp01(wbBudget - 0.15);
    wbDirection = 'restrained WB adjustment — avoid strong shifts';
    avoidedTools.push({ tool: 'strong WB shift', reason: `Low white balance latitude (${wbLatitude.toFixed(2)}).`, source: 'Capture Capability', severity: 'medium' });
    warnings.push('Low white balance latitude — keep WB adjustment restrained.');
  }
  const wbPlan = _plan({
    priority: priorityOf(wbIntensity), direction: wbDirection, intensity: wbIntensity, safetyLimit: wbLatitude != null ? clamp01(wbLatitude) : 0.6,
    reason: `WB priority from intent budget${wbLatitude != null ? ', adjusted for capture WB latitude' : ''}.`,
    sourceSignals: ['Style Budget Intelligence', capture ? 'Capture Capability' : null].filter(Boolean),
  });

  let hslIntensity = hslBudget;
  if (colorLatitude != null && colorLatitude < 0.40) {
    hslIntensity = clamp01(hslBudget - 0.15);
    avoidedTools.push({ tool: 'aggressive HSL', reason: `Low colour latitude (${colorLatitude.toFixed(2)}).`, source: 'Capture Capability', severity: 'medium' });
  }
  const hslPlan = _plan({
    priority: priorityOf(hslIntensity),
    direction: guidance.greenPastelOverride ? 'protect natural green luminance, suppress green saturation' : 'careful, targeted hue/saturation refinement',
    intensity: hslIntensity, safetyLimit: colorLatitude != null ? clamp01(colorLatitude) : 0.55,
    reason: `HSL priority from intent budget${colorLatitude != null ? ', adjusted for capture colour latitude' : ''}.`,
    sourceSignals: ['Style Budget Intelligence', 'Style DNA', capture ? 'Capture Capability' : null].filter(Boolean),
  });

  let calibrationIntensity = calibrationBudget;
  if (skinReliability != null && skinReliability < 0.45) {
    calibrationIntensity = clamp01(calibrationBudget - 0.15);
    avoidedTools.push({ tool: 'aggressive Calibration', reason: `Low skin reliability (${skinReliability.toFixed(2)}) — Calibration shifts risk unnatural skin rendering.`, source: 'Capture Capability', severity: 'medium' });
  }
  if (guidance.greenPastelOverride) {
    calibrationIntensity = clamp01(calibrationIntensity - 0.10);
    avoidedTools.push({ tool: 'Calibration stacking', reason: 'Green Pastel DNA prefers HSL luminance control over Calibration stacking.', source: 'Style DNA', severity: 'medium' });
  }
  const calibrationPlan = _plan({
    priority: priorityOf(calibrationIntensity), direction: 'subtle, corrective calibration only', intensity: calibrationIntensity,
    safetyLimit: 0.5, reason: `Calibration priority from intent budget, restrained by capture/DNA safety checks.`,
    sourceSignals: ['Style Budget Intelligence', capture ? 'Capture Capability' : null, 'Style DNA'].filter(Boolean),
  });

  let colorGradingIntensity = colorGradingBudget;
  if (colorLatitude != null && colorLatitude < 0.40) {
    colorGradingIntensity = clamp01(colorGradingBudget - 0.10);
  }
  const colorGradingPlan = _plan({
    priority: priorityOf(colorGradingIntensity),
    direction: primaryIntent === 'Filmic' || primaryIntent === 'Cinematic' ? 'deliberate shadow/highlight colour grading' : 'light, supportive colour grading',
    intensity: colorGradingIntensity, safetyLimit: colorLatitude != null ? clamp01(colorLatitude) : 0.55,
    reason: `Color grading priority from intent budget (${primaryIntent}).`,
    sourceSignals: ['Style Budget Intelligence', 'Photographer Intent'],
  });

  let detailIntensity = detailBudget, detailSafety = 0.55;
  if (noiseStatus !== 'measured') {
    detailIntensity = Math.min(detailIntensity, 0.40);
    detailSafety = 0.7;
    sliderRiskWarnings.push('Noise reliability is estimated; avoid aggressive detail mapping.');
    developerNotes.push(`Detail plan capped conservatively — noiseReliability.status is "${noiseStatus}", not "measured".`);
  } else if (noiseTolerance != null && noiseTolerance < 0.40) {
    detailIntensity = clamp01(detailBudget - 0.20);
    detailSafety = 0.8;
    avoidedTools.push({ tool: 'harsh Clarity', reason: `Measured noise tolerance is low (${noiseTolerance.toFixed(2)}).`, source: 'Capture Capability', severity: 'medium' });
    avoidedTools.push({ tool: 'aggressive texture', reason: `Measured noise tolerance is low (${noiseTolerance.toFixed(2)}).`, source: 'Capture Capability', severity: 'medium' });
  }
  const detailPlan = _plan({
    priority: priorityOf(detailIntensity), direction: 'restrained detail/texture work', intensity: detailIntensity, safetyLimit: detailSafety,
    reason: `Detail priority from intent budget, reduced for noise safety where applicable.`,
    sourceSignals: ['Style Budget Intelligence', 'Capture Capability'],
  });

  let skinPriority = priorityOf(skinBudget);
  if (skinReliability != null && skinReliability < 0.45) {
    skinPriority = 'critical';
    avoidedTools.push({ tool: 'aggressive red/orange/yellow shifts', reason: `Low skin reliability (${skinReliability.toFixed(2)}).`, source: 'Capture Capability', severity: 'critical' });
    protectedAreas.push({ area: 'skin tones', reason: `Low skin reliability (${skinReliability.toFixed(2)}) — skin rendering needs the highest protection.`, source: 'Capture Capability', severity: 'critical' });
  }
  const skinPlan = _plan({
    priority: skinPriority, direction: 'protect natural, reliable skin rendering', intensity: skinBudget,
    safetyLimit: skinReliability != null ? clamp01(skinReliability) : 0.65,
    reason: `Skin priority from intent budget${skinReliability != null ? ', escalated by capture skin reliability check' : ''}.`,
    sourceSignals: ['Style Budget Intelligence', 'Capture Capability'],
  });

  const colorPlan = _plan({
    priority: priorityOf(colorBudget), direction: primaryIntent === 'Natural' ? 'keep colour conservative and unforced' : 'moderate, intent-aligned colour presence',
    intensity: colorBudget, safetyLimit: colorLatitude != null ? clamp01(colorLatitude) : 0.55,
    reason: `Colour priority from intent budget (${primaryIntent}).`,
    sourceSignals: ['Style Budget Intelligence', 'Photographer Intent'],
  });

  let safetyPriority = priorityOf(safetyBudget);
  if (b.budgetLevel === 'aggressive-risky' || (cap.overallScore != null && cap.overallScore < 0.40)) safetyPriority = 'critical';
  const safetyPlan = _plan({
    priority: safetyPriority, direction: 'apply conservative safety limits across all tools', intensity: safetyBudget, safetyLimit: 0.9,
    reason: `Safety priority from Style Budget's own safetyBudget, escalated when capture capability or budget risk is high.`,
    sourceSignals: ['Style Budget Intelligence', 'Capture Capability'],
  });

  // Intent-driven priority escalation (Task 6) — bump named priority dims by one level if not already critical.
  const dims = { tonalPlan, colorPlan, skinPlan, wbPlan, curvePlan, hslPlan, calibrationPlan, colorGradingPlan, detailPlan, safetyPlan };
  const bump = { low: 'medium', medium: 'high', high: 'critical', critical: 'critical' };
  for (const dimName of guidance.priorityDims ?? []) {
    if (dims[dimName] && dims[dimName].priority !== 'critical') dims[dimName].priority = bump[dims[dimName].priority];
  }

  recommendedTools.push(
    ...(tonalBudget > 0.6 ? [{ tool: 'Basic Tone', reason: 'High tonal budget for this intent.', source: 'Style Budget Intelligence', severity: 'low' }] : []),
    ...(curveBudget > 0.6 ? [{ tool: 'Tone Curve', reason: 'High curve budget for this intent.', source: 'Style Budget Intelligence', severity: 'low' }] : []),
    ...(colorGradingBudget > 0.6 ? [{ tool: 'Color Grading', reason: 'High color grading budget for this intent.', source: 'Style Budget Intelligence', severity: 'low' }] : []),
    ...(hslBudget > 0.6 ? [{ tool: 'HSL', reason: 'High HSL budget for this intent.', source: 'Style Budget Intelligence', severity: 'low' }] : []),
  );

  const mappingPriorities = Object.entries(dims).sort((a, b2) => (b2[1].priority === 'critical' ? 3 : b2[1].priority === 'high' ? 2 : b2[1].priority === 'medium' ? 1 : 0) - (a[1].priority === 'critical' ? 3 : a[1].priority === 'high' ? 2 : a[1].priority === 'medium' ? 1 : 0))
    .slice(0, 4).map(([name, p]) => ({ dimension: name, priority: p.priority, reason: p.reason }));

  // EPIC 2B Task 0 fix: the OLD formula could return ~0.43 confidence
  // even on a fully empty input, because each missing signal quietly
  // fell back to a neutral-ish default (0.4/0.5) that still contributed
  // positively. Same fix pattern as EPIC 1.7F's style-budget-model.js
  // Patch 3 — an explicit missing-input penalty now dominates once
  // several of the 6 critical inputs are absent, landing empty/near-
  // empty input confidence in the required ~0.25-0.35 band.
  let confidence = clamp01(
    (intent?.confidence ?? 0.4) * 0.25 + (budget?.confidence ?? 0.4) * 0.30 +
    (dnaValidation?.score ?? 0.5) * 0.20 + (capture?.confidence ?? 0.4) * 0.15 +
    (transferConf?.score ?? 0.5) * 0.10
  );
  const missingCriticalCount = 6 - criticalPresent;
  if (missingCriticalCount >= 4) {
    confidence = Math.min(confidence, 0.35 - (missingCriticalCount - 4) * 0.05);
  } else if (missingCriticalCount >= 2) {
    confidence -= missingCriticalCount * 0.05;
  }
  confidence = +clamp01(confidence).toFixed(3);

  if (readiness !== 'ready-for-shadow-compare') {
    warnings.push(`Readiness is "${readiness}" — ${6 - criticalPresent} of 6 critical inputs are missing or incomplete; this plan is a rough sketch, not a considered plan.`);
  }
  developerNotes.push('lightroomMappingPlanV2 is SHADOW-ONLY — it is not consumed by production Lightroom Mapping or XMP export in this phase.');
  if (legacyMapping) developerNotes.push('legacyMapping was supplied for future shadow-compare purposes but is not diffed against this plan yet.');
  if (legacyStyleBudget) developerNotes.push('legacyStyleBudget (Stage 2.4C) was supplied for context only — this planner does not read its values.');

  return {
    mode: 'shadow-planning',
    readiness, confidence,
    tonalPlan, colorPlan, skinPlan, wbPlan, curvePlan, hslPlan,
    calibrationPlan, colorGradingPlan, detailPlan, safetyPlan,
    mappingPriorities, protectedAreas, avoidedTools, recommendedTools,
    sliderRiskWarnings,
    fallbackStrategy: {
      useLegacyMapping: true,
      reason: 'EPIC 2A is shadow-only — Lightroom Mapping V2 Planner output is not yet activated for production XMP generation.',
      requiredBeforeActivation: [
        'Shadow-compare this plan against legacy mapping output across a representative image set.',
        'Human review of protectedAreas/avoidedTools coverage against real edited photos.',
        'A dedicated EPIC 2B (or later) stage to translate abstract plan dimensions into actual Lightroom slider values.',
        'Explicit sign-off before any production wiring change.',
      ],
      safeMode: true,
    },
    reasons, warnings, developerNotes,
  };
}
