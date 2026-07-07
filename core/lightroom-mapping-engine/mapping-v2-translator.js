/**
 * ═══════════════════════════════════════════════════════════════════════════
 * BUDGET-TO-LIGHTROOM TRANSLATION V2 (EPIC 2B) — SHADOW-ONLY
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Translates styleBudgetIntelligence + lightroomMappingPlanV2 +
 * captureCapability + photographerIntent + Style DNA into
 * `lightroomTranslationV2` — a shadow-only description of safe Lightroom
 * TOOL DIRECTIONS, abstract target ranges, priorities, risks, and
 * constraints for a future EPIC 2C/2D/2E to consume. This is NOT final
 * mapping, NOT production XMP, NOT actual slider output.
 *
 * HARD RULE, enforced throughout this file: every intensity/range value
 * is a 0-1 abstract number. Nothing here ever produces a real Lightroom
 * unit — no "+0.4" exposure stops, no "-12" contrast points, no "+300"
 * Kelvin/mired temp shift, no numeric HSL slider value. If a future
 * developer is tempted to add a literal Lightroom unit anywhere in this
 * file, that is out of scope for EPIC 2B and belongs in the (not yet
 * built) EPIC 2C+ translation-to-slider stage instead.
 *
 * SHADOW-ONLY: not called from anywhere in the production pipeline.
 * `core/lightroom-mapping-engine/index.js`'s existing
 * `mapStyleFingerprintToLightroom()` — the only function that produces
 * real slider values feeding XMP export — does not import this file.
 * `fallbackStrategy.useLegacyMapping` is always `true` in this phase.
 *
 * Every input is OPTIONAL; every access below is null-safe. This
 * function must never throw, including a fully empty call
 * `buildLightroomTranslationV2({})`.
 */

const clamp01 = (v) => Math.max(0, Math.min(1, v ?? 0));
const priorityOf = (v) => v >= 0.85 ? 'critical' : v >= 0.65 ? 'high' : v >= 0.4 ? 'medium' : 'low';

/** Task 1: caps `value` at `maxIntensity`, both already assumed 0-1. */
function capIntensity(value, maxIntensity) { return Math.min(value, maxIntensity); }

const INTENSITY_CAP_WARNING = 'Translation hint intensity was capped by maxIntensity safety limit.';
const MAXINTENSITY_CAP_WARNING = 'Translation maxIntensity was capped by safetyLimit.';

/**
 * EPIC 2B-F Task 1/2/3: makes ONE {intensity, maxIntensity, safetyLimit?}
 * hint internally consistent — never changes what the hint MEANS
 * (direction/reason/sourceSignals untouched), only makes its numbers
 * safe: intensity <= maxIntensity <= safetyLimit <= 1. Pushes a
 * deduplicated warning + a specific developer note whenever a real cap
 * happens (never invents a warning when nothing was actually capped).
 */
function normalizeHintSafety(hint, label, warnings, developerNotes) {
  if (!hint || typeof hint !== 'object' || hint.intensity == null || hint.maxIntensity == null) return hint;

  let maxIntensity = clamp01(hint.maxIntensity);
  let intensity = clamp01(hint.intensity);

  if (hint.safetyLimit != null) {
    const safetyLimit = clamp01(hint.safetyLimit);
    if (maxIntensity > safetyLimit) {
      developerNotes.push(`${label} maxIntensity capped from ${maxIntensity.toFixed(2)} to ${safetyLimit.toFixed(2)} because safetyLimit reduced it.`);
      if (!warnings.includes(MAXINTENSITY_CAP_WARNING)) warnings.push(MAXINTENSITY_CAP_WARNING);
      maxIntensity = safetyLimit;
    }
  }
  if (intensity > maxIntensity) {
    developerNotes.push(`${label} intensity capped from ${intensity.toFixed(2)} to ${maxIntensity.toFixed(2)} because maxIntensity (safety-adjusted) limited it.`);
    if (!warnings.includes(INTENSITY_CAP_WARNING)) warnings.push(INTENSITY_CAP_WARNING);
    intensity = maxIntensity;
  }

  return { ...hint, intensity: +intensity.toFixed(3), maxIntensity: +maxIntensity.toFixed(3) };
}

/** Applies normalizeHintSafety to every named hint in an object, e.g. {highlights: {...}, shadowsContrast: {...}} or a flat single hint. */
function normalizeHintGroup(groupName, group, warnings, developerNotes) {
  if (!group || typeof group !== 'object') return group;
  // A "flat" hint has its own intensity directly; a "grouped" hint nests sub-hints keyed by name.
  if (group.intensity != null && group.maxIntensity != null) {
    return normalizeHintSafety(group, groupName, warnings, developerNotes);
  }
  const out = {};
  for (const [key, sub] of Object.entries(group)) {
    out[key] = (sub && typeof sub === 'object' && sub.intensity != null && sub.maxIntensity != null)
      ? normalizeHintSafety(sub, `${groupName}.${key}`, warnings, developerNotes)
      : sub;
  }
  return out;
}

/** Task 1: same safety rules applied to a targetRangeHints entry (minIntensity/maxIntensity/safetyLimit shape, not intensity/maxIntensity). */
function normalizeRangeHint(range, warnings, developerNotes) {
  const label = `${range.tool ?? 'tool'}/${range.channel ?? 'channel'}`;
  let minIntensity = clamp01(range.minIntensity);
  let maxIntensity = clamp01(range.maxIntensity);
  const safetyLimit = range.safetyLimit != null ? clamp01(range.safetyLimit) : null;

  if (safetyLimit != null && maxIntensity > safetyLimit) {
    developerNotes.push(`${label} maxIntensity capped from ${maxIntensity.toFixed(2)} to ${safetyLimit.toFixed(2)} because safetyLimit reduced it.`);
    if (!warnings.includes(MAXINTENSITY_CAP_WARNING)) warnings.push(MAXINTENSITY_CAP_WARNING);
    maxIntensity = safetyLimit;
  }
  if (minIntensity > maxIntensity) {
    developerNotes.push(`${label} minIntensity capped from ${minIntensity.toFixed(2)} to ${maxIntensity.toFixed(2)} because it exceeded maxIntensity.`);
    minIntensity = maxIntensity;
  }

  return {
    ...range,
    minIntensity: +minIntensity.toFixed(3), maxIntensity: +maxIntensity.toFixed(3),
    safetyLimit: safetyLimit != null ? +safetyLimit.toFixed(3) : range.safetyLimit,
    rangeType: 'abstract-intensity',
  };
}

/** Task 2: runs safety normalization across the whole translation object, right before it's returned. Never alters direction/reason/sourceSignals/priority text — only makes the numeric fields internally consistent. */
function normalizeTranslationSafety(t, warnings, developerNotes) {
  const hintGroupNames = ['basicToneHints', 'toneCurveHints', 'whiteBalanceHints', 'hslHints', 'colorGradingHints', 'calibrationHints', 'presenceHints', 'detailHints'];
  for (const name of hintGroupNames) {
    if (t[name]) t[name] = normalizeHintGroup(name, t[name], warnings, developerNotes);
  }
  if (Array.isArray(t.targetRangeHints)) {
    t.targetRangeHints = t.targetRangeHints.map(r => normalizeRangeHint(r, warnings, developerNotes));
  }
  if (t.toolPriorityMap) {
    for (const [tool, entry] of Object.entries(t.toolPriorityMap)) {
      if (entry && entry.intensity != null) entry.intensity = +clamp01(entry.intensity).toFixed(3);
    }
  }
  return t;
}


/** Task 7 helper — one {priority, intensity, reason, source} tool entry. */
function _toolPriority(intensity, reason, source) {
  return { priority: priorityOf(intensity), intensity: +clamp01(intensity).toFixed(3), reason, source };
}

/** Task 3 helper — one abstract target-range hint (never a slider value). */
function _range({ tool, channel, direction, minIntensity, maxIntensity, safetyLimit, reason, sourceSignals }) {
  return {
    tool, channel, direction, rangeType: 'abstract-intensity',
    minIntensity: +clamp01(minIntensity).toFixed(3), maxIntensity: +clamp01(maxIntensity).toFixed(3),
    safetyLimit: +clamp01(safetyLimit ?? 0.6).toFixed(3), reason, sourceSignals: sourceSignals ?? [],
  };
}

/**
 * Task 6: intent/DNA-driven tool direction guidance — same "named
 * intents + family fallback" pattern already established in
 * core/decision-engine/style-budget-model.js (EPIC 1.7) and
 * mapping-v2-planner.js (EPIC 2A), applied here to per-TOOL direction
 * phrasing rather than budget numbers or plan-dimension phrasing.
 */
const INTENT_TOOL_GUIDANCE = {
  'Premium': {
    basicTone: 'protect clean whites / cream highlights', skin: 'critical protection',
    calibration: 'restrained', color: 'muted distractions',
    avoid: [{ tool: 'White Balance', channel: 'strong shift', reason: 'dirty whites contradict a premium read' }, { tool: 'Calibration', channel: 'all', reason: 'harsh skin contradicts a premium read' }],
  },
  'Elegant': {
    basicTone: 'protect clean whites, controlled contrast', skin: 'critical protection',
    calibration: 'restrained', color: 'muted distractions', avoid: [{ tool: 'Calibration', channel: 'all', reason: 'harsh skin contradicts an elegant read' }],
  },
  'Dreamy': {
    toneCurve: 'soft roll-off', contrast: 'gentle', presence: 'restrained',
    avoid: [{ tool: 'Presence', channel: 'clarity', reason: 'harsh clarity contradicts a dreamy read' }, { tool: 'Tone Curve', channel: 'blacks', reason: 'crushed blacks contradict a dreamy read' }],
  },
  'Filmic': {
    toneCurve: 'matte / film curve direction', colorGrading: 'warm midtone / muted shadow direction',
    hsl: 'controlled greens', skin: 'protected', avoid: [{ tool: 'HSL', channel: 'saturation', reason: 'neon saturation contradicts a filmic read' }],
  },
  'Cinematic': {
    toneCurve: 'controlled shadows', colorGrading: 'separation', basicTone: 'restrained whites',
    avoid: [{ tool: 'Basic Tone', channel: 'whites', reason: 'over-opened whites contradict a cinematic read' }],
  },
  'Natural': {
    whiteBalance: 'natural correction', hsl: 'conservative', colorGrading: 'low', skin: 'protected',
    avoid: [{ tool: 'Color Grading', channel: 'all', reason: 'artificial grading contradicts a natural/documentary read' }],
  },
};
const FAMILY_TOOL_GUIDANCE = {
  'luxury-clean': INTENT_TOOL_GUIDANCE['Premium'],
  'soft-emotional': INTENT_TOOL_GUIDANCE['Dreamy'],
  'film-organic': INTENT_TOOL_GUIDANCE['Filmic'],
  'cinematic-moody': INTENT_TOOL_GUIDANCE['Cinematic'],
  'documentary-natural': INTENT_TOOL_GUIDANCE['Natural'],
};
const DEFAULT_TOOL_GUIDANCE = { basicTone: 'natural, unforced tone', avoid: [] };
function _toolGuidance(primaryIntent, intentFamily, dnaNames) {
  let guidance = INTENT_TOOL_GUIDANCE[primaryIntent] ?? FAMILY_TOOL_GUIDANCE[intentFamily] ?? DEFAULT_TOOL_GUIDANCE;
  if (dnaNames?.some(n => n === 'Reduced Green Saturation' || n === 'Bright Green Luminance')) {
    guidance = {
      ...guidance, hsl: 'green luminance-aware direction, suppress green saturation',
      calibration: 'restrained', toneCurve: guidance.toneCurve ?? 'soft contrast',
      avoid: [...(guidance.avoid ?? []), { tool: 'HSL', channel: 'green saturation', reason: 'Green Pastel DNA prefers luminance over saturation' }],
    };
  }
  return guidance;
}

/**
 * Main entry point. Every field of `input` is optional; every access is
 * null-safe. Guaranteed never to throw, even for
 * `buildLightroomTranslationV2({})` or `buildLightroomTranslationV2()`.
 */
export function buildLightroomTranslationV2(input = {}) {
  const {
    decision = null, finalStyleIntent = null, lightroomMappingPlanV2 = null,
    styleBudgetIntelligence = null, photographerIntent = null, styleDNA = null,
    styleDNAValidation = null, styleFeasibility = null, captureCapability = null,
    referenceColorIntelligence = null, transferConfidence = null, legacyMapping = null,
  } = input ?? {};

  const planV2 = lightroomMappingPlanV2 ?? finalStyleIntent?.lightroomMappingPlanV2 ?? null;
  const intent = photographerIntent ?? finalStyleIntent?.photographerIntent ?? null;
  const budget = styleBudgetIntelligence ?? finalStyleIntent?.styleBudgetIntelligence ?? null;
  const dna = styleDNA ?? finalStyleIntent?.photographerStyle?.top?.styleDNA ?? [];
  const dnaValidation = styleDNAValidation ?? finalStyleIntent?.photographerStyle?.top?.styleDNAValidation ?? null;
  const feasibility = styleFeasibility ?? finalStyleIntent?.styleFeasibilityEstimate ?? null;
  const capture = captureCapability ?? finalStyleIntent?.captureCapabilityEstimate ?? null;
  const transferConf = transferConfidence ?? null;

  // ── Task 0-consistent noise handling: never assume "measured" without
  // an explicit source. ──────────────────────────────────────────────────
  const noiseStatus = budget?.noiseReliability?.status ?? (capture?.noiseReliability?.status) ?? (capture ? 'estimated' : 'unavailable');

  // ── Task 11: readiness ───────────────────────────────────────────────────
  const criticalPresent = [!!budget, !!planV2, !!capture, !!intent, !!dnaValidation, !!feasibility].filter(Boolean).length;
  const missingCriticalCount = 6 - criticalPresent;
  const stackingHigh = budget?.budgetStackingRisk?.severity === 'high';

  const b = budget ?? {};
  const cap = capture ?? {};
  const primaryIntent = intent?.primaryIntent ?? 'Natural';
  const intentFamily = intent?.intentFamily ?? 'documentary-natural';
  const dnaNames = (dna ?? []).map(d => d?.name).filter(Boolean);
  const guidance = _toolGuidance(primaryIntent, intentFamily, dnaNames);

  const translationWarnings = [], reasons = [], developerNotes = [];
  const toolSuppressionMap = [];
  const protectedChannels = [];
  const targetRangeHints = [];
  const safetyConstraints = [];

  // ── Task 4 + 5: budget dimensions → tool hints, safety-adjusted ────────
  const tonalBudget = b.tonalBudget ?? 0.5, contrastBudget = b.contrastBudget ?? 0.5;
  const curveBudget = b.curveBudget ?? 0.5, wbBudget = b.wbBudget ?? 0.5;
  const hslBudget = b.hslBudget ?? 0.5, calibrationBudget = b.calibrationBudget ?? 0.5;
  const colorGradingBudget = b.colorGradingBudget ?? 0.5, detailBudget = b.detailBudget ?? 0.5;
  const colorBudget = b.colorBudget ?? 0.5, safetyBudget = b.safetyBudget ?? 0.55;

  const highlightRecovery = cap.highlightRecovery, shadowRecovery = cap.shadowRecovery;
  const noiseTolerance = cap.noiseTolerance, wbLatitude = cap.whiteBalanceLatitude;
  const colorLatitude = cap.colorLatitude, skinReliability = cap.skinReliability;

  // Basic Tone (tonalBudget + contrastBudget) — highlight/shadow safety applied.
  let basicToneMax = clamp01((tonalBudget + contrastBudget) / 2 + 0.15);
  let basicToneDirection = guidance.basicTone ?? 'natural, unforced tone';
  if (highlightRecovery != null && highlightRecovery < 0.45) {
    basicToneMax = clamp01(basicToneMax - 0.20);
    safetyConstraints.push({ area: 'highlight roll-off', reason: `Low highlight recovery (${highlightRecovery.toFixed(2)}) limits safe highlight push.`, source: 'Capture Capability', severity: 'high' });
    protectedChannels.push({ channel: 'highlight roll-off', protectionLevel: 'high', reason: 'Limited highlight recovery headroom.', source: 'Capture Capability' });
    translationWarnings.push('Limited highlight recovery — reduce maxIntensity for highlights/whites/high-key directions.');
    targetRangeHints.push(_range({ tool: 'Basic Tone', channel: 'highlights', direction: 'protect / soften', minIntensity: 0.1, maxIntensity: basicToneMax, safetyLimit: 0.5, reason: `${primaryIntent} intent and limited highlightRecovery require conservative highlight mapping.`, sourceSignals: ['Photographer Intent', 'Capture Capability', 'Style Budget'] }));
  }
  if (shadowRecovery != null && shadowRecovery < 0.45) {
    safetyConstraints.push({ area: 'shadow detail', reason: `Low shadow recovery (${shadowRecovery.toFixed(2)}) limits safe shadow push.`, source: 'Capture Capability', severity: 'high' });
    protectedChannels.push({ channel: 'shadow detail', protectionLevel: 'high', reason: 'Limited shadow recovery headroom.', source: 'Capture Capability' });
    translationWarnings.push('Limited shadow recovery — reduce maxIntensity for blacks/shadows/deep contrast.');
  }
  const basicToneHints = { direction: basicToneDirection, intensity: +clamp01((tonalBudget + contrastBudget) / 2).toFixed(3), maxIntensity: +basicToneMax.toFixed(3), reason: `Basic Tone hint from tonal/contrast budget, intent "${primaryIntent}"${highlightRecovery != null && highlightRecovery < 0.45 ? ', reduced for highlight safety' : ''}.`, sourceSignals: ['Style Budget Intelligence', 'Photographer Intent'] };
  targetRangeHints.push(_range({ tool: 'Basic Tone', channel: 'overall tone', direction: basicToneDirection, minIntensity: Math.max(0, (tonalBudget + contrastBudget) / 2 - 0.2), maxIntensity: basicToneMax, safetyLimit: highlightRecovery != null ? clamp01(highlightRecovery) : 0.6, reason: `Tonal budget (${tonalBudget.toFixed(2)}) and contrast budget (${contrastBudget.toFixed(2)}) for "${primaryIntent}" intent.`, sourceSignals: ['Style Budget Intelligence', 'Photographer Intent'] }));

  // Tone Curve
  let curveMax = clamp01(curveBudget + 0.15);
  let curveDirection = guidance.toneCurve ?? 'gentle, natural tonal curve';
  if (shadowRecovery != null && shadowRecovery < 0.45) { curveMax = clamp01(curveMax - 0.20); curveDirection = 'avoid crushed blacks — ' + curveDirection; }
  const toneCurveHints = { direction: curveDirection, intensity: +clamp01(curveBudget).toFixed(3), maxIntensity: +curveMax.toFixed(3), reason: `Tone Curve hint from curve budget, intent "${primaryIntent}".`, sourceSignals: ['Style Budget Intelligence', 'Photographer Intent'] };
  targetRangeHints.push(_range({ tool: 'Tone Curve', channel: 'shadows/highlights', direction: curveDirection, minIntensity: Math.max(0, curveBudget - 0.2), maxIntensity: curveMax, safetyLimit: shadowRecovery != null ? clamp01(shadowRecovery) : 0.6, reason: `Curve budget (${curveBudget.toFixed(2)}) for "${primaryIntent}" intent.`, sourceSignals: ['Style Budget Intelligence'] }));

  // White Balance
  let wbMax = clamp01(wbBudget + 0.1);
  let wbDirection = guidance.whiteBalance ?? 'maintain natural white balance';
  if (wbLatitude != null && wbLatitude < 0.40) {
    wbMax = clamp01(wbMax - 0.20);
    wbDirection = 'restrained WB adjustment';
    toolSuppressionMap.push({ tool: 'White Balance', channel: 'strong shift', severity: 'medium', reason: `Low white balance latitude (${wbLatitude.toFixed(2)}).`, source: 'Capture Capability' });
    translationWarnings.push('Low white balance latitude — suppress strong WB shift.');
  }
  const whiteBalanceHints = { direction: wbDirection, intensity: +clamp01(wbBudget).toFixed(3), maxIntensity: +wbMax.toFixed(3), reason: `White Balance hint from WB budget${wbLatitude != null ? ', adjusted for capture WB latitude' : ''}.`, sourceSignals: ['Style Budget Intelligence', 'Capture Capability'] };
  targetRangeHints.push(_range({ tool: 'White Balance', channel: 'temp/tint', direction: wbDirection, minIntensity: Math.max(0, wbBudget - 0.2), maxIntensity: wbMax, safetyLimit: wbLatitude != null ? clamp01(wbLatitude) : 0.6, reason: `WB budget (${wbBudget.toFixed(2)})${wbLatitude != null ? `, capture WB latitude ${wbLatitude.toFixed(2)}` : ''}.`, sourceSignals: ['Style Budget Intelligence', 'Capture Capability'] }));

  // HSL
  let hslMax = clamp01(hslBudget + 0.1);
  let hslDirection = guidance.hsl ?? 'careful, targeted hue/saturation refinement';
  if (colorLatitude != null && colorLatitude < 0.40) {
    hslMax = clamp01(hslMax - 0.20);
    toolSuppressionMap.push({ tool: 'HSL', channel: 'saturation', severity: 'medium', reason: `Low colour latitude (${colorLatitude.toFixed(2)}).`, source: 'Capture Capability' });
  }
  if (dnaNames.includes('Reduced Green Saturation')) {
    toolSuppressionMap.push({ tool: 'HSL', channel: 'green saturation', severity: 'high', reason: 'Green Pastel DNA suppresses saturation in favour of luminance.', source: 'Style DNA' });
    protectedChannels.push({ channel: 'green luminance', protectionLevel: 'high', reason: 'Green Pastel DNA prioritises luminance control over saturation push.', source: 'Style DNA' });
  }
  const hslHints = { direction: hslDirection, intensity: +clamp01(hslBudget).toFixed(3), maxIntensity: +hslMax.toFixed(3), reason: `HSL hint from HSL budget, intent/DNA "${primaryIntent}".`, sourceSignals: ['Style Budget Intelligence', 'Style DNA', 'Capture Capability'] };
  targetRangeHints.push(_range({ tool: 'HSL', channel: dnaNames.includes('Reduced Green Saturation') ? 'green' : 'general hue/saturation', direction: hslDirection, minIntensity: Math.max(0, hslBudget - 0.2), maxIntensity: hslMax, safetyLimit: colorLatitude != null ? clamp01(colorLatitude) : 0.55, reason: `HSL budget (${hslBudget.toFixed(2)}) for "${primaryIntent}".`, sourceSignals: ['Style Budget Intelligence', 'Style DNA'] }));

  // Calibration
  let calibrationMax = clamp01(calibrationBudget + 0.1);
  let calibrationDirection = guidance.calibration ?? 'subtle, corrective calibration only';
  if (skinReliability != null && skinReliability < 0.45) {
    calibrationMax = clamp01(calibrationMax - 0.20);
    toolSuppressionMap.push({ tool: 'Calibration', channel: 'all', severity: 'high', reason: `Low skin reliability (${skinReliability.toFixed(2)}) — Calibration shifts risk unnatural skin.`, source: 'Capture Capability' });
  }
  if (colorLatitude != null && colorLatitude < 0.40) {
    calibrationMax = clamp01(calibrationMax - 0.15);
    toolSuppressionMap.push({ tool: 'Calibration', channel: 'all', severity: 'high', reason: `Limited colour latitude (${colorLatitude.toFixed(2)}).`, source: 'Capture Capability' });
  }
  const calibrationHints = { direction: calibrationDirection, intensity: +clamp01(calibrationBudget).toFixed(3), maxIntensity: +calibrationMax.toFixed(3), reason: `Calibration hint from calibration budget, restrained by capture/skin safety checks.`, sourceSignals: ['Style Budget Intelligence', 'Capture Capability'] };
  targetRangeHints.push(_range({ tool: 'Calibration', channel: 'primaries', direction: calibrationDirection, minIntensity: 0, maxIntensity: calibrationMax, safetyLimit: 0.45, reason: `Calibration budget (${calibrationBudget.toFixed(2)}), restrained for safety.`, sourceSignals: ['Style Budget Intelligence', 'Capture Capability'] }));

  // Color Grading
  let colorGradingMax = clamp01(colorGradingBudget + 0.1);
  let colorGradingDirection = guidance.colorGrading ?? 'light, supportive colour grading';
  if (colorLatitude != null && colorLatitude < 0.40) colorGradingMax = clamp01(colorGradingMax - 0.15);
  const colorGradingHints = { direction: colorGradingDirection, intensity: +clamp01(colorGradingBudget).toFixed(3), maxIntensity: +colorGradingMax.toFixed(3), reason: `Color Grading hint from budget, intent "${primaryIntent}".`, sourceSignals: ['Style Budget Intelligence', 'Photographer Intent'] };
  targetRangeHints.push(_range({ tool: 'Color Grading', channel: 'shadows/midtones/highlights', direction: colorGradingDirection, minIntensity: Math.max(0, colorGradingBudget - 0.2), maxIntensity: colorGradingMax, safetyLimit: colorLatitude != null ? clamp01(colorLatitude) : 0.55, reason: `Color Grading budget (${colorGradingBudget.toFixed(2)}) for "${primaryIntent}".`, sourceSignals: ['Style Budget Intelligence'] }));

  // Presence / Detail — noise-aware (Task 0-consistent: never treat as measured without explicit source)
  let detailMax = clamp01(detailBudget + 0.1);
  let presenceDirection = guidance.presence ?? 'restrained presence adjustments';
  let detailSafety = 0.5;
  if (noiseStatus !== 'measured') {
    detailMax = Math.min(detailMax, 0.40);
    detailSafety = 0.7;
    translationWarnings.push(`Noise reliability is "${noiseStatus}"; avoid aggressive detail mapping.`);
    developerNotes.push(`Detail/Presence hints capped conservatively — noiseReliability.status is "${noiseStatus}", not "measured".`);
  } else if (noiseTolerance != null && noiseTolerance < 0.40) {
    detailMax = clamp01(detailBudget - 0.20);
    detailSafety = 0.8;
    toolSuppressionMap.push({ tool: 'Presence', channel: 'clarity', severity: 'medium', reason: `Measured noise tolerance is low (${noiseTolerance.toFixed(2)}).`, source: 'Capture Capability' });
  }
  const presenceHints = { direction: presenceDirection, intensity: +clamp01(detailBudget * 0.7).toFixed(3), maxIntensity: +clamp01(detailMax * 0.8).toFixed(3), reason: `Presence hint, kept restrained relative to Detail.`, sourceSignals: ['Style Budget Intelligence', 'Capture Capability'] };
  const detailHints = { direction: 'restrained detail/texture work', intensity: +clamp01(detailBudget).toFixed(3), maxIntensity: +detailMax.toFixed(3), reason: `Detail hint from detail budget, noise status "${noiseStatus}".`, sourceSignals: ['Style Budget Intelligence', 'Capture Capability'] };
  targetRangeHints.push(_range({ tool: 'Detail', channel: 'sharpening/noise reduction', direction: detailHints.direction, minIntensity: 0, maxIntensity: detailMax, safetyLimit: detailSafety, reason: `Detail budget (${detailBudget.toFixed(2)}), noise status "${noiseStatus}".`, sourceSignals: ['Style Budget Intelligence', 'Capture Capability'] }));

  // ── Skin protection (Task 5 + 6, cross-cutting across tools) ────────────
  if (skinReliability != null && skinReliability < 0.45) {
    protectedChannels.push({ channel: 'red/orange/yellow skin channels', protectionLevel: 'critical', reason: `Low skin reliability (${skinReliability.toFixed(2)}).`, source: 'Capture Capability' });
    toolSuppressionMap.push({ tool: 'HSL', channel: 'red/orange/yellow', severity: 'high', reason: 'Aggressive shifts risk unnatural skin rendering.', source: 'Capture Capability' });
  } else if (guidance.skin) {
    protectedChannels.push({ channel: 'skin tones', protectionLevel: guidance.skin === 'critical protection' ? 'critical' : 'medium', reason: `"${primaryIntent}" intent/DNA guidance protects skin.`, source: 'Photographer Intent / Style DNA' });
  }
  for (const a of guidance.avoid ?? []) {
    toolSuppressionMap.push({ tool: a.tool, channel: a.channel, severity: 'medium', reason: `${a.reason} ("${primaryIntent}" intent/DNA guidance).`, source: 'Photographer Intent / Style DNA' });
  }
  protectedChannels.push({ channel: 'neutral grays', protectionLevel: 'low', reason: 'Baseline protection against unintended colour cast in neutral tones.', source: 'Style Budget Allocation' });

  // ── Task 7: Tool Priority Map ────────────────────────────────────────────
  const toolPriorityMap = {
    basicTone: _toolPriority((tonalBudget + contrastBudget) / 2, `Basic Tone priority from tonal/contrast budget for "${primaryIntent}".`, 'Style Budget Intelligence'),
    toneCurve: _toolPriority(curveBudget, `Tone Curve priority from curve budget for "${primaryIntent}".`, 'Style Budget Intelligence'),
    whiteBalance: _toolPriority(wbBudget, 'White Balance priority from WB budget.', 'Style Budget Intelligence'),
    hsl: _toolPriority(hslBudget, 'HSL priority from HSL budget.', 'Style Budget Intelligence'),
    colorGrading: _toolPriority(colorGradingBudget, `Color Grading priority for "${primaryIntent}".`, 'Style Budget Intelligence'),
    calibration: _toolPriority(calibrationBudget, 'Calibration priority from calibration budget.', 'Style Budget Intelligence'),
    presence: _toolPriority(detailBudget * 0.7, 'Presence priority kept below Detail.', 'Style Budget Intelligence'),
    detail: _toolPriority(detailBudget, `Detail priority, noise status "${noiseStatus}".`, 'Capture Capability'),
  };

  // ── Task 10: Translation confidence — separate from intent/budget/planner confidence ──
  let confidence = clamp01(
    (budget?.confidence ?? 0.4) * 0.30 + (planV2?.confidence ?? 0.4) * 0.25 +
    (capture?.confidence ?? 0.4) * 0.20 + (dnaValidation?.score ?? 0.5) * 0.15 +
    (feasibility?.score ?? (feasibility?.level === 'high' ? 0.8 : feasibility?.level === 'medium' ? 0.5 : 0.4)) * 0.10
  );
  if (noiseStatus !== 'measured') confidence -= 0.05;
  if (stackingHigh) confidence -= 0.15;
  if (missingCriticalCount >= 4) confidence = Math.min(confidence, 0.35 - (missingCriticalCount - 4) * 0.05);
  else if (missingCriticalCount >= 2) confidence -= missingCriticalCount * 0.05;
  confidence = +clamp01(confidence).toFixed(3);

  // ── Task 11: readiness ───────────────────────────────────────────────────
  let readiness;
  if (criticalPresent >= 6 && confidence >= 0.65 && !stackingHigh) readiness = 'ready-for-controlled-activation';
  else if (criticalPresent >= 5) readiness = 'ready-for-shadow-compare';
  else if (criticalPresent >= 2) readiness = 'partial';
  else readiness = 'not-ready';
  if (readiness !== 'not-ready' && readiness !== 'partial') {
    translationWarnings.push(readiness === 'ready-for-controlled-activation'
      ? 'Readiness is "ready-for-controlled-activation" — still shadow-only in EPIC 2B; production activation requires a separate, explicit future stage.'
      : 'Readiness is "ready-for-shadow-compare" — suitable for comparison analysis only, not production use.');
  }

  reasons.push(`Translation built for "${primaryIntent}" (${intentFamily} family), readiness "${readiness}", confidence ${confidence}.`);
  if (missingCriticalCount > 0) reasons.push(`${missingCriticalCount} of 6 critical inputs missing or incomplete.`);

  const photographerSummary = `This look prioritises ${Object.entries(toolPriorityMap).filter(([, v]) => v.priority === 'high' || v.priority === 'critical').map(([k]) => k).join(', ') || 'a balanced set of tools'}. Translation is shadow-only — legacy mapping remains active and nothing here changes your exported preset yet.`;

  developerNotes.push('lightroomTranslationV2 is SHADOW-ONLY — it does not generate XMP and is not consumed by production Lightroom Mapping in this phase.');
  if (legacyMapping) developerNotes.push('legacyMapping was supplied for future shadow-compare purposes but is not diffed against this translation yet.');

  const result = {
    mode: 'shadow-translation',
    readiness, confidence,
    basicToneHints, toneCurveHints, whiteBalanceHints, hslHints,
    colorGradingHints, calibrationHints, presenceHints, detailHints,
    targetRangeHints, toolPriorityMap, toolSuppressionMap, safetyConstraints,
    protectedChannels, translationWarnings,
    fallbackStrategy: {
      useLegacyMapping: true,
      reason: 'EPIC 2B is shadow-only — Budget-to-Lightroom Translation V2 output is not yet activated for production XMP generation.',
      requiredBeforeActivation: [
        'Shadow-compare this translation against legacy mapping + lightroomMappingPlanV2 across a representative image set.',
        'Human review of targetRangeHints/toolSuppressionMap/protectedChannels coverage against real edited photos.',
        'A dedicated EPIC 2C+ stage to translate these abstract ranges into actual Lightroom slider values.',
        'Explicit sign-off before any production wiring change.',
      ],
      safeMode: true,
    },
    photographerSummary, developerNotes, reasons,
  };

  // EPIC 2B-F Task 1/2/3: final safety pass — guarantees intensity <=
  // maxIntensity <= safetyLimit <= 1 across every hint group and
  // targetRangeHints entry, right before returning. Runs LAST so it can
  // never be bypassed by any earlier code path, and never changes what a
  // hint MEANS (direction/reason/sourceSignals/priority untouched) — only
  // makes its own numbers internally consistent. Warnings/developer notes
  // are deduplicated (normalizeHintSafety/normalizeRangeHint only ever
  // push the two fixed warning strings once each, via `includes` checks).
  return normalizeTranslationSafety(result, result.translationWarnings, result.developerNotes);
}
