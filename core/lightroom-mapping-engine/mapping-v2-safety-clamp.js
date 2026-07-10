/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SAFETY CLAMP & OVER-STACK PROTECTION V2 (EPIC 2C) — SHADOW-ONLY
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Reviews lightroomTranslationV2 and produces safety DECISIONS — which
 * directions are safe, which must be capped, which tool combinations are
 * risky — for a FUTURE controlled activation that does not happen in
 * this stage. This is NOT production mapping, NOT XMP, NOT final slider
 * generation. `activationGate.canActivate` is HARD-CODED false in this
 * phase — no combination of inputs, however favourable, can flip it,
 * because EPIC 2C's own job is only to build the gate, not open it.
 *
 * SHADOW-ONLY: not called from anywhere in the production pipeline.
 * `core/lightroom-mapping-engine/index.js`'s existing
 * `mapStyleFingerprintToLightroom()` — the only function producing real
 * slider values feeding XMP export — does not import this file.
 * `fallbackStrategy.useLegacyMapping` is always `true`.
 *
 * Every input is OPTIONAL; every access below is null-safe. This
 * function must never throw, including `buildLightroomSafetyClampV2({})`
 * or no argument at all.
 */

const clamp01 = (v) => Math.max(0, Math.min(1, v ?? 0));
const severityRank = { none: 0, low: 1, medium: 2, high: 3, critical: 4, 'hard-stop': 5 };
const maxSeverity = (...vals) => vals.reduce((a, b) => severityRank[b] > severityRank[a] ? b : a, 'none');

/** Deep-clones a plain JSON-serialisable object — used so safeTranslationPreview never mutates the original lightroomTranslationV2 (Task 11). */
function _deepClone(obj) {
  if (obj == null) return obj;
  try { return JSON.parse(JSON.stringify(obj)); } catch { return null; }
}

// ── Task 5: Clamp Profiles ──────────────────────────────────────────────────
// One profile per major Lightroom tool category. `captureSignal` is the
// single most relevant capture-capability dimension for that tool (e.g.
// colorLatitude for HSL/Calibration, whiteBalanceLatitude for WB,
// noiseTolerance-with-reliability for Detail/Presence).
function _buildClampProfile({ tool, baseIntensity, captureSignal, riskyForSkin, safetyBudget, noiseStatus }) {
  const sourceSignals = ['Style Budget Intelligence', 'Lightroom Mapping V2 Translation'];
  let severity = 'none';
  let maxAllowedIntensity = clamp01(baseIntensity ?? 0.5);
  const warnings = [];

  if (captureSignal != null) {
    sourceSignals.push('Capture Capability');
    if (captureSignal < 0.30) { severity = maxSeverity(severity, 'high'); maxAllowedIntensity = clamp01(Math.min(maxAllowedIntensity, 0.30)); warnings.push(`Capture signal very low (${captureSignal.toFixed(2)}) — intensity capped hard.`); }
    else if (captureSignal < 0.45) { severity = maxSeverity(severity, 'medium'); maxAllowedIntensity = clamp01(Math.min(maxAllowedIntensity, 0.5)); warnings.push(`Capture signal low (${captureSignal.toFixed(2)}) — intensity reduced.`); }
  }
  if (safetyBudget != null && safetyBudget > 0.7) {
    severity = maxSeverity(severity, 'low');
    maxAllowedIntensity = clamp01(maxAllowedIntensity * 0.85);
    warnings.push(`High safety budget (${safetyBudget.toFixed(2)}) — intensity trimmed for caution.`);
    sourceSignals.push('Style Budget Safety');
  }
  if (riskyForSkin) {
    severity = maxSeverity(severity, 'medium');
    maxAllowedIntensity = clamp01(Math.min(maxAllowedIntensity, 0.5));
    warnings.push('Tool can affect skin channels — extra caution applied.');
    sourceSignals.push('Skin Risk');
  }
  if (noiseStatus != null && noiseStatus !== 'measured') {
    severity = maxSeverity(severity, 'medium');
    maxAllowedIntensity = clamp01(Math.min(maxAllowedIntensity, 0.40));
    warnings.push(`Noise reliability is "${noiseStatus}" — detail/texture intensity capped conservatively.`);
    sourceSignals.push('Noise Reliability');
  }

  return {
    maxAllowedIntensity: +clamp01(maxAllowedIntensity).toFixed(3),
    safetyReason: warnings[0] ?? `No specific risk signal for ${tool} — default moderate ceiling.`,
    sourceSignals: [...new Set(sourceSignals)],
    clampSeverity: severity,
    canUse: severity !== 'hard-stop' && maxAllowedIntensity > 0.02,
    warnings,
  };
}

// ── Task 8: Over-stack rule table (all 10 named patterns) ──────────────────
function _detectOverStack({ toolPriorityMap, capture, budget, intent, styleDNANames, noiseStatus }) {
  const risks = [];
  const tp = toolPriorityMap ?? {};
  const high = (name) => (tp[name]?.intensity ?? 0) > 0.6;
  const highBudget = (v) => (v ?? 0) > 0.6;

  if (high('hsl') && high('calibration') && high('colorGrading')) {
    risks.push({ riskType: 'HSL + Calibration + Color Grading all high', tools: ['HSL', 'Calibration', 'Color Grading'], channels: [], severity: 'high', reason: 'Three colour-manipulation tools all high at once risks compounding colour artifacts.' });
  }
  if (high('whiteBalance') && high('calibration') && high('colorGrading')) {
    risks.push({ riskType: 'WB + Calibration + Color Grading all high', tools: ['White Balance', 'Calibration', 'Color Grading'], channels: [], severity: 'high', reason: 'Three colour-temperature-affecting tools all high risks an unstable overall cast.' });
  }
  if (high('toneCurve') && high('basicTone') && high('presence')) {
    risks.push({ riskType: 'Tone Curve + Contrast + Presence all high', tools: ['Tone Curve', 'Basic Tone', 'Presence'], channels: [], severity: 'medium', reason: 'Aggressive combined tonal/texture push risks unnatural micro-contrast.' });
  }
  if ((high('detail') || high('presence')) && noiseStatus !== 'measured') {
    risks.push({ riskType: 'Detail/Presence high while noise reliability unconfirmed', tools: ['Detail', 'Presence'], channels: [], severity: 'medium', reason: `Noise status is "${noiseStatus}" — pushing detail/texture without confirmed noise data risks amplifying noise.` });
  }
  if ((high('hsl') || high('calibration') || high('colorGrading')) && capture?.skinReliability != null && capture.skinReliability < 0.45) {
    risks.push({ riskType: 'High colour manipulation with low skin reliability', tools: ['HSL', 'Calibration', 'Color Grading'], channels: ['red/orange/yellow skin channels'], severity: 'high', reason: `Low skin reliability (${capture.skinReliability.toFixed(2)}) combined with strong colour tools risks unnatural skin.` });
  }
  if (high('basicTone') && capture?.highlightRecovery != null && capture.highlightRecovery < 0.40) {
    risks.push({ riskType: 'High highlight/white direction with low highlightRecovery', tools: ['Basic Tone'], channels: ['highlight roll-off'], severity: 'high', reason: `Low highlight recovery (${capture.highlightRecovery.toFixed(2)}) makes an aggressive high-key/whites push unsafe.` });
  }
  if (high('toneCurve') && capture?.shadowRecovery != null && capture.shadowRecovery < 0.40) {
    risks.push({ riskType: 'High shadow/black direction with low shadowRecovery', tools: ['Tone Curve'], channels: ['shadow detail'], severity: 'high', reason: `Low shadow recovery (${capture.shadowRecovery.toFixed(2)}) makes an aggressive low-key/blacks push unsafe.` });
  }
  if (styleDNANames?.some(n => n === 'Reduced Green Saturation' || n === 'Bright Green Luminance') && (budget?.hslBudget ?? 0) > 0.6) {
    risks.push({ riskType: 'Green Pastel DNA with high green saturation push', tools: ['HSL'], channels: ['green saturation'], severity: 'medium', reason: 'Green Pastel DNA explicitly prefers luminance control over saturation push.' });
  }
  if ((intent === 'Premium' || intent === 'Clean' || intent === 'Elegant') && (highBudget(budget?.calibrationBudget) || (capture?.whiteBalanceLatitude != null && capture.whiteBalanceLatitude < 0.35))) {
    risks.push({ riskType: 'Premium/Clean intent with dirty whites or aggressive calibration risk', tools: ['Calibration', 'White Balance'], channels: ['clean whites'], severity: 'medium', reason: `"${intent}" intent depends on clean whites — aggressive calibration or limited WB latitude threatens that.` });
  }
  if ((intent === 'Natural' || intent === 'Documentary') && (high('colorGrading') || high('calibration'))) {
    risks.push({ riskType: 'Natural/Documentary intent with high color grading or calibration', tools: ['Color Grading', 'Calibration'], channels: [], severity: 'medium', reason: `"${intent}" intent calls for restraint — high grading/calibration would read as artificial.` });
  }

  if (!risks.length) return { hasRisk: false, severity: 'none', riskTypes: [], affectedTools: [], affectedChannels: [], recommendations: [], reasons: ['No over-stack risk detected across the 10 checked patterns.'] };

  const severity = risks.reduce((s, r) => maxSeverity(s, r.severity), 'none');
  return {
    hasRisk: true, severity,
    riskTypes: risks.map(r => r.riskType),
    affectedTools: [...new Set(risks.flatMap(r => r.tools))],
    affectedChannels: [...new Set(risks.flatMap(r => r.channels))],
    recommendations: risks.map(r => `Ease one of [${r.tools.join(', ')}] — ${r.reason}`),
    reasons: risks.map(r => r.reason),
  };
}

/**
 * Main entry point. Every field optional; every access null-safe.
 * Guaranteed never to throw, including `buildLightroomSafetyClampV2({})`.
 */
export function buildLightroomSafetyClampV2(input = {}) {
  const {
    decision = null, finalStyleIntent = null, lightroomMappingPlanV2 = null,
    lightroomTranslationV2 = null, styleBudgetIntelligence = null, photographerIntent = null,
    styleDNA = null, styleDNAValidation = null, styleFeasibility = null,
    captureCapability = null, referenceColorIntelligence = null, transferConfidence = null,
    legacyMapping = null,
  } = input ?? {};

  const plan = lightroomMappingPlanV2 ?? finalStyleIntent?.lightroomMappingPlanV2 ?? null;
  const translation = lightroomTranslationV2 ?? finalStyleIntent?.lightroomTranslationV2 ?? null;
  const budget = styleBudgetIntelligence ?? finalStyleIntent?.styleBudgetIntelligence ?? null;
  const intentObj = photographerIntent ?? finalStyleIntent?.photographerIntent ?? null;
  const dna = styleDNA ?? finalStyleIntent?.photographerStyle?.top?.styleDNA ?? [];
  const dnaValidation = styleDNAValidation ?? finalStyleIntent?.photographerStyle?.top?.styleDNAValidation ?? null;
  const feasibility = styleFeasibility ?? finalStyleIntent?.styleFeasibilityEstimate ?? null;
  const capture = captureCapability ?? finalStyleIntent?.captureCapabilityEstimate ?? null;

  const primaryIntent = intentObj?.primaryIntent ?? 'Natural';
  const dnaNames = (dna ?? []).map(d => d?.name).filter(Boolean);
  const noiseStatus = budget?.noiseReliability?.status ?? (capture ? 'estimated' : 'unavailable');

  const warnings = [], developerNotes = [], reasons = [];
  const hardStops = [], softCaps = [];

  // ── Task 3: Global Safety Score ─────────────────────────────────────────
  const missingCount = [!translation, !plan, !budget, !capture, !dnaValidation, !feasibility].filter(Boolean).length;
  const feasScore = feasibility?.score ?? (feasibility?.level === 'high' ? 0.8 : feasibility?.level === 'medium' ? 0.5 : feasibility?.level === 'low' ? 0.25 : 0.4);
  const noisePenalty = noiseStatus === 'unavailable' ? 0.15 : noiseStatus === 'estimated' ? 0.08 : 0;

  // ── Task 8 runs before the score so over-stack/protection severity can feed into it ──
  const overStackAnalysis = _detectOverStack({ toolPriorityMap: translation?.toolPriorityMap, capture, budget, intent: primaryIntent, styleDNANames: dnaNames, noiseStatus });
  const stackPenalty = { critical: 0.30, high: 0.20, medium: 0.10, low: 0.03, none: 0 }[overStackAnalysis.severity] ?? 0;

  const protectedSeverityPenalty = (translation?.protectedChannels ?? []).some(c => c.protectionLevel === 'critical') ? 0.08 : 0;

  let globalSafetyScore = (translation?.confidence ?? 0.4) * 0.20 + (plan?.confidence ?? 0.4) * 0.15 +
    (budget?.confidence ?? 0.4) * 0.20 + feasScore * 0.15 + (dnaValidation?.score ?? 0.5) * 0.10 +
    (capture?.overallScore ?? 0.4) * 0.10 + (capture?.editingHeadroom ?? 0.4) * 0.10
    - noisePenalty - stackPenalty - protectedSeverityPenalty;
  if (missingCount >= 4) globalSafetyScore = Math.min(globalSafetyScore, 0.35 - (missingCount - 4) * 0.03);
  else if (missingCount >= 2) globalSafetyScore -= missingCount * 0.05;
  globalSafetyScore = +clamp01(globalSafetyScore).toFixed(3);

  // ── Task 5: Clamp Profiles ──────────────────────────────────────────────
  const b = budget ?? {};
  const safetyBudget = b.safetyBudget ?? 0.55;
  const clampProfiles = {
    basicTone: _buildClampProfile({ tool: 'Basic Tone', baseIntensity: translation?.toolPriorityMap?.basicTone?.intensity ?? b.tonalBudget, captureSignal: capture?.highlightRecovery, riskyForSkin: false, safetyBudget }),
    toneCurve: _buildClampProfile({ tool: 'Tone Curve', baseIntensity: translation?.toolPriorityMap?.toneCurve?.intensity ?? b.curveBudget, captureSignal: capture?.shadowRecovery, riskyForSkin: false, safetyBudget }),
    whiteBalance: _buildClampProfile({ tool: 'White Balance', baseIntensity: translation?.toolPriorityMap?.whiteBalance?.intensity ?? b.wbBudget, captureSignal: capture?.whiteBalanceLatitude, riskyForSkin: false, safetyBudget }),
    hsl: _buildClampProfile({ tool: 'HSL', baseIntensity: translation?.toolPriorityMap?.hsl?.intensity ?? b.hslBudget, captureSignal: capture?.colorLatitude, riskyForSkin: true, safetyBudget }),
    colorGrading: _buildClampProfile({ tool: 'Color Grading', baseIntensity: translation?.toolPriorityMap?.colorGrading?.intensity ?? b.colorGradingBudget, captureSignal: capture?.colorLatitude, riskyForSkin: false, safetyBudget }),
    calibration: _buildClampProfile({ tool: 'Calibration', baseIntensity: translation?.toolPriorityMap?.calibration?.intensity ?? b.calibrationBudget, captureSignal: Math.min(capture?.colorLatitude ?? 1, capture?.skinReliability ?? 1), riskyForSkin: true, safetyBudget }),
    presence: _buildClampProfile({ tool: 'Presence', baseIntensity: translation?.toolPriorityMap?.presence?.intensity ?? b.detailBudget, captureSignal: capture?.noiseTolerance, riskyForSkin: false, safetyBudget, noiseStatus }),
    detail: _buildClampProfile({ tool: 'Detail', baseIntensity: translation?.toolPriorityMap?.detail?.intensity ?? b.detailBudget, captureSignal: capture?.noiseTolerance, riskyForSkin: false, safetyBudget, noiseStatus }),
  };

  // ── Task 6: Tool Caps — derived from translation's own targetRangeHints, capped further by clampProfiles ──
  const toolCaps = [];
  const toolKeyMap = { 'Basic Tone': 'basicTone', 'Tone Curve': 'toneCurve', 'White Balance': 'whiteBalance', 'HSL': 'hsl', 'Color Grading': 'colorGrading', 'Calibration': 'calibration', 'Detail / Presence': 'detail' };
  for (const range of translation?.targetRangeHints ?? []) {
    const key = toolKeyMap[range.tool] ?? null;
    const profile = key ? clampProfiles[key] : null;
    const original = range.maxIntensity ?? 0.5;
    const capped = profile ? Math.min(original, profile.maxAllowedIntensity) : original;
    if (capped < original || (profile && profile.clampSeverity !== 'none')) {
      toolCaps.push({
        tool: range.tool, channel: range.channel,
        originalIntensity: +clamp01(original).toFixed(3),
        cappedIntensity: +clamp01(Math.min(capped, range.safetyLimit ?? 1)).toFixed(3),
        capReason: profile?.safetyReason ?? 'Default safety review.',
        source: 'Safety Clamp V2', severity: profile?.clampSeverity ?? 'low',
      });
    }
  }
  // Green Pastel-specific tool cap (Task 6 named example)
  if (dnaNames.includes('Reduced Green Saturation')) {
    const existingHsl = translation?.toolPriorityMap?.hsl?.intensity ?? 0.5;
    toolCaps.push({ tool: 'HSL', channel: 'green saturation', originalIntensity: +clamp01(existingHsl).toFixed(3), cappedIntensity: +clamp01(Math.min(existingHsl, 0.25)).toFixed(3), capReason: 'Green Pastel DNA suppresses saturation in favour of luminance control.', source: 'Style DNA', severity: 'high' });
  }

  // ── Task 7: Channel Protections — reuse translation's own protectedChannels as a base, add capture-driven ones ──
  const channelProtections = (translation?.protectedChannels ?? []).map(c => ({
    channel: c.channel, protectionLevel: c.protectionLevel, reason: c.reason, source: c.source,
    affectedTools: c.channel.includes('skin') ? ['HSL', 'Calibration', 'Color Grading'] : c.channel.includes('green') ? ['HSL'] : c.channel.includes('white') ? ['Basic Tone', 'Calibration'] : c.channel.includes('shadow') ? ['Tone Curve', 'Basic Tone'] : c.channel.includes('highlight') ? ['Basic Tone'] : [],
  }));
  if (capture?.skinReliability != null && capture.skinReliability < 0.45 && !channelProtections.some(c => c.channel.includes('skin'))) {
    channelProtections.push({ channel: 'skin red/orange/yellow', protectionLevel: 'critical', reason: `Low skin reliability (${capture.skinReliability.toFixed(2)}).`, source: 'Capture Capability', affectedTools: ['HSL', 'Calibration', 'Color Grading'] });
  }

  // ── Task 9: Hard Stops ───────────────────────────────────────────────────
  if (capture?.skinReliability != null && capture.skinReliability < 0.30 && (b.hslBudget ?? 0) > 0.6) {
    hardStops.push({ area: 'Skin + aggressive colour manipulation', reason: `Critical skin reliability (${capture.skinReliability.toFixed(2)}) combined with a high colour budget risks unnatural skin rendering.`, source: 'Capture Capability', severity: 'critical', requiredFix: 'Reduce HSL/Calibration/Color Grading intensity affecting skin channels before any activation.' });
  }
  if (capture?.highlightRecovery != null && capture.highlightRecovery < 0.20 && (translation?.toolPriorityMap?.basicTone?.intensity ?? 0) > 0.6) {
    hardStops.push({ area: 'Very low highlightRecovery + strong high-key direction', reason: `Highlight recovery is critically low (${capture.highlightRecovery.toFixed(2)}).`, source: 'Capture Capability', severity: 'critical', requiredFix: 'Cap Basic Tone highlight intensity to a low ceiling or avoid high-key direction entirely.' });
  }
  if (capture?.noiseTolerance != null && capture.noiseTolerance < 0.20 && ((translation?.toolPriorityMap?.presence?.intensity ?? 0) > 0.6 || (translation?.toolPriorityMap?.detail?.intensity ?? 0) > 0.6)) {
    hardStops.push({ area: 'Very low noiseTolerance + high presence/detail direction', reason: `Noise tolerance is critically low (${capture.noiseTolerance.toFixed(2)}).`, source: 'Capture Capability', severity: 'critical', requiredFix: 'Cap Detail/Presence intensity sharply or suppress entirely.' });
  }
  if (overStackAnalysis.severity === 'critical' || (overStackAnalysis.hasRisk && overStackAnalysis.affectedTools.length >= 3 && overStackAnalysis.severity === 'high')) {
    hardStops.push({ area: 'High over-stack risk across 3+ colour tools', reason: `${overStackAnalysis.affectedTools.length} tools (${overStackAnalysis.affectedTools.join(', ')}) are all implicated in overlapping over-stack risks at "${overStackAnalysis.severity}" severity.`, source: 'Over-Stack Analysis', severity: 'high', requiredFix: 'Reduce at least one of the stacking tools before any activation.' });
  }
  if (!translation) {
    hardStops.push({ area: 'Missing core translation input', reason: 'lightroomTranslationV2 was not supplied — nothing safe can be derived without it.', source: 'Input Validation', severity: 'critical', requiredFix: 'Ensure lightroomTranslationV2 is computed and passed before any safety review.' });
  }
  if (feasScore < 0.25) {
    hardStops.push({ area: 'Style Feasibility very low', reason: `Feasibility score (${feasScore.toFixed(2)}) is too low to trust any V2 mapping direction yet.`, source: 'Style Feasibility', severity: 'high', requiredFix: 'Re-evaluate style detection/feasibility before considering activation.' });
  }

  // ── Task 10: Soft Caps ───────────────────────────────────────────────────
  for (const [key, profile] of Object.entries(clampProfiles)) {
    if (profile.clampSeverity !== 'none' && profile.clampSeverity !== 'hard-stop') {
      const original = translation?.toolPriorityMap?.[key]?.intensity ?? 0.5;
      if (original > profile.maxAllowedIntensity) {
        softCaps.push({ area: key, originalIntensity: +clamp01(original).toFixed(3), cappedIntensity: profile.maxAllowedIntensity, reason: profile.safetyReason, source: 'Clamp Profile', severity: profile.clampSeverity === 'high' ? 'high' : profile.clampSeverity === 'medium' ? 'medium' : 'low' });
      }
    }
  }

  // ── Task 11: Safe Translation Preview (deep-cloned, never mutates original) ──
  const clonedTranslation = _deepClone(translation);
  let safeTargetRangeHints = null, safeToolPriorityMap = null;
  if (clonedTranslation) {
    safeTargetRangeHints = (clonedTranslation.targetRangeHints ?? []).map(r => {
      const cap = toolCaps.find(tc => tc.tool === r.tool && tc.channel === r.channel);
      return cap ? { ...r, maxIntensity: cap.cappedIntensity, rangeType: 'abstract-intensity' } : r;
    });
    safeToolPriorityMap = { ...clonedTranslation.toolPriorityMap };
    for (const [key, profile] of Object.entries(clampProfiles)) {
      if (safeToolPriorityMap[key]) {
        safeToolPriorityMap[key] = { ...safeToolPriorityMap[key], intensity: Math.min(safeToolPriorityMap[key].intensity, profile.maxAllowedIntensity) };
      }
    }
  }
  const safeTranslationPreview = {
    safeTargetRangeHints, safeToolPriorityMap,
    appliedCaps: toolCaps.length + softCaps.length,
    hardStopsCount: hardStops.length,
    overStackSeverity: overStackAnalysis.severity,
  };

  // ── Task 4: Activation Gate — canActivate is ALWAYS false in EPIC 2C ────
  const blockers = ['EPIC 2C is a shadow-only phase — no controlled activation flag exists yet.', 'No real-image shadow comparison has been run yet.'];
  if (overStackAnalysis.severity === 'high' || overStackAnalysis.severity === 'critical') blockers.push(`Over-stack risk severity is "${overStackAnalysis.severity}".`);
  if ((capture?.overallScore ?? 1) < 0.4) blockers.push('Capture capability is low.');
  if (noiseStatus !== 'measured') blockers.push(`Noise reliability is "${noiseStatus}", not measured.`);
  if (feasScore < 0.4) blockers.push('Style feasibility is low.');
  if (!translation) blockers.push('Translation input is missing.');
  if (hardStops.length) blockers.push(`${hardStops.length} hard stop(s) are active.`);

  const gateLevel = hardStops.length || overStackAnalysis.severity === 'critical' ? 'blocked'
    : (missingCount >= 3 || !translation || !plan) ? 'blocked'
    : globalSafetyScore >= 0.6 && overStackAnalysis.severity !== 'high' ? 'eligible-for-shadow-compare'
    : 'shadow-only';

  const activationGate = {
    canActivate: false, // hard-coded — EPIC 2C never activates production mapping, regardless of any score
    level: gateLevel,
    reason: 'EPIC 2C builds the safety gate but does not open it — production activation requires a separate, explicit future stage with real shadow-compare validation.',
    blockers,
    requiredBeforeActivation: [
      'Run real-image shadow-compare across a representative sample and review divergence from legacy mapping.',
      'Resolve all current hard stops and reduce over-stack severity to low/none.',
      'Human sign-off on clampProfiles/toolCaps/channelProtections against real edited photos.',
      'Add an explicit, separate controlled-activation flag/stage that does not exist yet.',
    ],
  };

  const readiness = (!translation || !plan || !budget) ? 'not-ready'
    : (!capture || !dnaValidation || missingCount >= 3) ? 'partial'
    : globalSafetyScore >= 0.6 && overStackAnalysis.severity !== 'high' && overStackAnalysis.severity !== 'critical' ? 'ready-for-shadow-compare'
    : 'partial';

  reasons.push(`Safety review for "${primaryIntent}" — global safety score ${globalSafetyScore}, activation gate "${activationGate.level}".`);
  if (overStackAnalysis.hasRisk) reasons.push(`Over-stack risk (${overStackAnalysis.severity}): ${overStackAnalysis.riskTypes.join('; ')}.`);
  if (hardStops.length) warnings.push(`${hardStops.length} hard stop(s) present — see hardStops[] for required fixes.`);
  if (missingCount > 0) warnings.push(`${missingCount} of 6 critical inputs missing/incomplete — safety review is a rough sketch, not a considered one.`);

  developerNotes.push('lightroomSafetyClampV2 is SHADOW-ONLY — it does not generate XMP and is not consumed by production Lightroom Mapping. activationGate.canActivate is hard-coded false in this phase.');
  if (legacyMapping) developerNotes.push('legacyMapping was supplied for future shadow-compare context only — not diffed against this safety review yet.');

  const photographerSummary = `Safety review for this look: ${activationGate.level === 'blocked' ? 'currently blocked from any future activation' : activationGate.level === 'eligible-for-shadow-compare' ? 'eligible for shadow-comparison testing (not production use)' : 'shadow-only, further review needed'}. ${hardStops.length ? `${hardStops.length} issue(s) must be resolved first.` : 'No hard stops currently active.'} This does not affect your current exported preset.`;

  return {
    mode: 'shadow-safety',
    readiness, confidence: globalSafetyScore,
    globalSafetyScore, activationGate,
    clampProfiles, toolCaps, channelProtections, overStackAnalysis, hardStops, softCaps,
    safeTranslationPreview,
    photographerSummary, developerNotes, warnings, reasons,
    fallbackStrategy: {
      useLegacyMapping: true,
      reason: 'EPIC 2C is shadow-only — Safety Clamp & Over-stack Protection V2 builds the activation gate but never opens it; production XMP generation continues to use legacy mapping exclusively.',
      requiredBeforeActivation: activationGate.requiredBeforeActivation,
      safeMode: true,
    },
  };
}
