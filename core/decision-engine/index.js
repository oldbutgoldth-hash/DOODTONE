/**
 * core/decision-engine/index.js
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ADAPTIVE DECISION INTELLIGENCE (Phase 5) + DECISION INTELLIGENCE
 * OPTIMIZATION (Stage 2.2)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   Reference Image → 22 Analysis Modules → Feature Fusion Engine →
 *   Style Feature Graph → Style Fingerprint → [ ADAPTIVE DECISION ENGINE ] →
 *   Lightroom Mapping Engine → Pre-XMP Validation Pass → XMP Export
 *
 * This module does NOT compute Lightroom slider values — that is the
 * exclusive job of core/lightroom-mapping-engine. Decision Engine decides
 * the TREATMENT STRATEGY, and — as of Phase 5 — that strategy is no longer
 * one fixed set of weights applied to every image. It is chosen per-image
 * from scene type, skin presence/confidence, portrait/wedding detection,
 * detected mood, overall Style Feature Graph confidence, and any conflicts
 * Feature Fusion reported, then expressed as a set of per-engine trust
 * multipliers (`engineTrustWeights`) that scale the existing dampening
 * levers (gradeStrength, hslDampen, calDampen, skinLockScale, plus two new
 * ones: basicDampen, wbDampen) before Lightroom Mapping ever runs.
 *
 * buildFinalPreset(...) remains the public entry point app.js calls — same
 * flat preset shape as before, for backward compatibility with
 * core/xmp-validator, core/style-fingerprint, and ui/app.js.
 */

import { buildStyleFingerprint } from '../style-fingerprint/index.js';
import { mapStyleFingerprintToLightroom } from '../lightroom-mapping-engine/index.js';
import { buildCaptureCapability, buildIntentCompatibility, buildCaptureBudgetHints } from '../image-analysis/capture-capability-model.js';
import { buildStyleBudgetIntelligence } from './style-budget-model.js';
import { buildLightroomMappingPlanV2 } from '../lightroom-mapping-engine/mapping-v2-planner.js';
import { buildLightroomTranslationV2 } from '../lightroom-mapping-engine/mapping-v2-translator.js';
import { buildLightroomSafetyClampV2 } from '../lightroom-mapping-engine/mapping-v2-safety-clamp.js';
import { buildLightroomShadowCompareReportV2 } from '../lightroom-mapping-engine/mapping-v2-shadow-compare.js';
import { buildLightroomControlledActivationV2 } from '../lightroom-mapping-engine/mapping-v2-activation-controller.js';
import { buildLegacySafetyOverlayV2 } from '../lightroom-mapping-engine/mapping-v2-legacy-safety-overlay.js';
import { buildLegacyOverlaySimulationV2 } from '../lightroom-mapping-engine/mapping-v2-overlay-simulation.js';
import { buildControlledOverlayTestGateV2 } from '../lightroom-mapping-engine/mapping-v2-overlay-test-gate.js';
import { buildControlledOverlayPreviewSandboxV2 } from '../lightroom-mapping-engine/mapping-v2-overlay-preview-sandbox.js';
import { createPreviewReviewStateV2 } from '../lightroom-mapping-engine/mapping-v2-preview-review-state.js';

// ─── Scene strategy table ─────────────────────────────────────────────────────
// Each strategy is a set of TRUST MULTIPLIERS (not the base ENGINE_PRIORITY
// weights from feature-fusion-engine — those already rank engines globally
// for the Style Feature Graph). These multipliers scale how much of each
// engine's contribution actually reaches Lightroom Mapping for THIS
// specific image's context. 1.0 = full trust for this scene, lower = more
// caution. Kept conservative and easy to read/tune.
const SCENE_STRATEGIES = {
  portrait: {
    label: 'Portrait / Wedding — skin & style protected',
    basicTrust: 0.50, wbTrust: 1.00, gradeTrust: 1.00, hslTrust: 0.50,
    calTrust: 0.45, curveTrust: 0.90, paletteTrust: 0.60,
    skinProtect: 1.00,
    noAutoBrighten: false, noAggressiveDarken: false,
    protectWarmChannels: false, strongColorAllowed: false,
  },
  landscape: {
    label: 'Landscape — palette & tone curve led',
    basicTrust: 0.80, wbTrust: 0.70, gradeTrust: 1.00, hslTrust: 0.95,
    calTrust: 0.70, curveTrust: 1.00, paletteTrust: 1.00,
    skinProtect: 0.40,
    noAutoBrighten: false, noAggressiveDarken: false,
    protectWarmChannels: false, strongColorAllowed: true,   // gated further by confidence
  },
  food: {
    label: 'Food — warm channels protected from neon',
    basicTrust: 0.75, wbTrust: 1.00, gradeTrust: 0.85, hslTrust: 0.65,
    calTrust: 0.55, curveTrust: 0.80, paletteTrust: 1.00,
    skinProtect: 0.40,
    noAutoBrighten: false, noAggressiveDarken: false,
    protectWarmChannels: true, strongColorAllowed: false,
  },
  moody: {
    label: 'Night / Moody — preserve darkness, no auto-brighten',
    basicTrust: 0.45, wbTrust: 0.80, gradeTrust: 1.00, hslTrust: 0.70,
    calTrust: 0.55, curveTrust: 1.05, paletteTrust: 0.85,
    skinProtect: 0.80,
    noAutoBrighten: true, noAggressiveDarken: false,
    protectWarmChannels: false, strongColorAllowed: false,
  },
  airy: {
    label: 'High-Key / Airy — preserve soft highlights',
    basicTrust: 0.45, wbTrust: 0.80, gradeTrust: 0.90, hslTrust: 0.70,
    calTrust: 0.55, curveTrust: 0.95, paletteTrust: 0.90,
    skinProtect: 0.80,
    noAutoBrighten: false, noAggressiveDarken: true,
    protectWarmChannels: false, strongColorAllowed: false,
  },
  general: {
    label: 'General — balanced trust across engines',
    basicTrust: 0.75, wbTrust: 0.85, gradeTrust: 0.95, hslTrust: 0.80,
    calTrust: 0.65, curveTrust: 0.90, paletteTrust: 0.85,
    skinProtect: 0.70,
    noAutoBrighten: false, noAggressiveDarken: false,
    protectWarmChannels: false, strongColorAllowed: false,
  },
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * @param {{
 *   stats:       object,   // from histogram-engine
 *   basic:       object,   // from basic-panel-engine (tone descriptor)
 *   wb:          object,   // from whitebalance-engine
 *   skin:        object|null,
 *   hsl:         object|null,
 *   calibration: object|null,
 *   grading:     object|null,
 *   toneCurves:  object|null,
 *   scene:       object|null,   // from scene-classifier
 *   cast:        object|null,   // from color-cast-detector
 *   styleRecognition: object|null,
 *   palette:     object|null,
 *   harmony:     object|null,
 *   mode:        string,        // 'single-image-auto' | 'style-transfer'
 *   fingerprint: object|null,   // pre-built Style Fingerprint (preferred)
 * }} inputs
 * @returns {object} finalPreset — ready for the Pre-XMP Validation Pass
 */
/**
 * @param {object} inputs
 * ...(existing fields unchanged)...
 * @param {object|null} [inputs.controlledPreviewReviewStateV2] - EPIC 2E-F-B-F:
 *   optional, existing Controlled Preview Human Review state from a future
 *   Review Console UI (Phase C). Contains an optional human-review
 *   checklist state (which items have been reviewed, their status,
 *   reviewer decisions/notes). It is NEVER trusted as-is: every derived
 *   field on it (approvalState, canApprovePreview, canRequestAdjustment,
 *   canRejectPreview, reviewProgress, completedItemIds, failedItemIds,
 *   confidence, etc.) is fully recalculated by the Review State engine
 *   against the CURRENT Controlled Overlay Preview Sandbox before use —
 *   only its raw per-item review data (status/reviewerDecision/
 *   reviewerNote) is preserved as a normalization seed. Defaults to
 *   `null` (no existing review state), which is fully backward
 *   compatible with every existing caller. This input is purely
 *   informational and read-only from the perspective of production
 *   output: it does NOT affect Production Lightroom Mapping and does
 *   NOT affect XMP export in any way.
 */
export function buildFinalPreset(inputs) {
  const {
    stats, basic, wb, skin, hsl, calibration, grading, toneCurves,
    scene = null, cast = null, styleRecognition = null,
    palette = null, harmony = null, mode = 'single-image-auto',
    // EPIC 1.3: optional Reference Color Intelligence (from
    // core/color-match/color-match-intelligence-bridge.js). Purely
    // additive — every existing caller that doesn't pass this continues
    // to work identically. When present, it is used ONLY as supporting
    // evidence for the already-computed Photographer Style — never to
    // change scores, DNA, validation, or feasibility.
    referenceColorIntelligence = null,
    // EPIC 2E-F-B-F: optional existing Controlled Preview Human Review
    // state from a future Phase C UI caller. See JSDoc above — always
    // safe to omit; every existing caller is unaffected.
    controlledPreviewReviewStateV2 = null,
  } = inputs ?? {};

  const fingerprint = inputs?.fingerprint ?? buildStyleFingerprint({
    stats, basic, wb, skin, hsl, calibration, grading, toneCurves,
    palette, harmony, styleRecognition,
  });

  const decision = _buildDecision({
    fingerprint, stats, basic, wb, skin, hsl, scene, cast, mode, styleRecognition, referenceColorIntelligence,
    existingControlledPreviewReviewStateV2: controlledPreviewReviewStateV2,
  });

  const mapped = mapStyleFingerprintToLightroom({
    fingerprint, decision, stats, basic, wb, hsl, calibration, grading, toneCurves,
  });

  return {
    ...mapped,
    category: decision.category,
    name: `AI ${decision.category} — Lumina Precision`,
    _decision: _buildDebugTrace({ decision, fingerprint, mapped, stats, wb, cast }),
  };
}

// ─── Adaptive decision building ─────────────────────────────────────────────

function _buildDecision({ fingerprint, stats, basic, wb, skin, hsl, scene, cast, mode, styleRecognition, referenceColorIntelligence = null, existingControlledPreviewReviewStateV2 = null }) {
  const category    = scene?.category ?? stats?.category ?? 'General';
  const sceneConf    = scene?.confidence ?? 0.5;
  const isPortrait   = category === 'Portrait' || category === 'Wedding';
  const skinPct      = skin?.coveragePct ?? stats?.skinPct ?? 0;
  const hasSkin       = skinPct > 5;
  const skinConfidence= skin?.confidence ?? 0.5;
  const portraitSafe = isPortrait || (skinPct > 8 && (skin?.isFaceCandidate ?? false));
  const skinHue       = skin?.avgHSL?.h ?? 30;
  const mood           = fingerprint.mood;
  const styleTop       = styleRecognition?.top?.style ?? fingerprint.styleRecognitionTop ?? null;
  const overallConf    = fingerprint.overallConfidence ?? 0.5;

  // ── Task 1+2: choose the adaptive scene strategy ─────────────────────────
  const strategyName = _determineDecisionStrategy({ isPortrait, mood, styleTop, category });
  const strategy      = SCENE_STRATEGIES[strategyName];

  const warnings = [];
  const appliedGuards = [];

  // ── Task 3: fold low-confidence engines + conflicts INTO the trust
  //    multipliers (compounding with the scene-strategy base values) ──────
  const cm = fingerprint.confidenceMap ?? {};
  let wbTrust    = strategy.wbTrust;
  let gradeTrust = strategy.gradeTrust;
  let hslTrust   = strategy.hslTrust;
  let calTrust   = strategy.calTrust;
  let curveTrust = strategy.curveTrust;
  let basicTrust = strategy.basicTrust;

  const LOW_CONF = 0.40;
  if ((cm.wb ?? 0.5)         < LOW_CONF) { wbTrust    *= 0.6; warnings.push(`WB confidence low (${cm.wb}) — trust reduced.`); }
  if ((cm.hsl ?? 0.5)        < LOW_CONF) { hslTrust   *= 0.6; warnings.push(`HSL confidence low (${cm.hsl}) — trust reduced.`); }
  if ((cm.calibration ?? 0.5)< LOW_CONF) { calTrust   *= 0.6; warnings.push(`Calibration confidence low (${cm.calibration}) — trust reduced.`); }
  if ((cm.grading ?? 0.5)    < LOW_CONF) { gradeTrust *= 0.6; warnings.push(`Colour Grading confidence low (${cm.grading}) — trust reduced.`); }
  if ((cm.toneCurves ?? 0.5) < LOW_CONF) { curveTrust *= 0.6; warnings.push(`Tone Curve confidence low (${cm.toneCurves}) — trust reduced.`); }
  if (overallConf < LOW_CONF) {
    basicTrust *= 0.8; wbTrust *= 0.85; gradeTrust *= 0.85; hslTrust *= 0.85; calTrust *= 0.85;
    warnings.push(`Overall Style Feature Graph confidence low (${overallConf}) — all trust weights reduced further.`);
  }

  // Stage 2.1: WB Intent transfer risk further tightens wbTrust — this is
  // the "treat WB as transfer risk, not just a slider command" requirement.
  // High mixed-lighting/green-bounce/magenta risk means the raw correction
  // is scene-specific and should carry LESS weight into Lightroom Mapping,
  // independent of how confident the engine was about measuring it.
  const wbIntent = wb?.wbIntent;
  if (wbIntent) {
    if (wbIntent.transferRisk === 'high')        { wbTrust *= 0.55; warnings.push(`WB transfer risk high (${wbIntent.transferRiskScore}) — trust reduced.`); }
    else if (wbIntent.transferRisk === 'medium') { wbTrust *= 0.80; }
    if (wbIntent.mixedLightingRisk > 0.3) warnings.push(`Mixed lighting detected (shadows="${wbIntent.shadowBias}", highlights="${wbIntent.highlightBias}") — WB trust reduced accordingly.`);
  }

  const conflicts = fingerprint.featureGraph?.conflicts ?? [];
  let hslDampen = 1.0, calDampen = 1.0;
  for (const c of conflicts) {
    if (c.type === 'hsl_vs_palette_saturation') {
      hslDampen = Math.min(hslDampen, 0.55);
      appliedGuards.push(`HSL dampened ×0.55 (conflict: ${c.type})`);
    }
    if (c.type === 'calibration_vs_skin') {
      calDampen = Math.min(calDampen, 0.5);
      appliedGuards.push(`Calibration dampened ×0.5 (conflict: ${c.type})`);
    }
    if (c.type === 'basic_vs_style_exposure' || c.type === 'histogram_vs_style_highkey') {
      appliedGuards.push(`Histogram/Basic brightness overridden by Style Fingerprint mood (conflict: ${c.type})`);
    }
    if (c.type === 'wb_vs_palette_warmth') {
      gradeTrust = Math.min(gradeTrust, 0.75);
      appliedGuards.push(`Grade trust capped at 0.75 (conflict: ${c.type})`);
    }
    // Stage 2.2: WB correction vs WB mood preservation — wbIntent already
    // resolves this at the WB engine level (intensity scaling in Lightroom
    // Mapping), so Decision Engine doesn't need to double-dampen here; it
    // just records that wbIntent's judgement was trusted over raw magnitude.
    if (c.type === 'wb_correction_vs_mood_preservation') {
      appliedGuards.push(`WB correction trusted via wbIntent.intensity over raw magnitude (conflict: ${c.type})`);
    }
    // Stage 2.2: Tone Curve compressing dynamic range without clipping
    // evidence or a matching mood — cap curve trust so Lightroom Mapping
    // treats the anchors a little more conservatively, and flag it loudly
    // so Pre-XMP Validation gives it extra scrutiny.
    if (c.type === 'curve_vs_dynamic_range_safety') {
      curveTrust = Math.min(curveTrust, 0.70);
      appliedGuards.push(`Tone Curve trust capped at 0.70 — dynamic range compression flagged for validation (conflict: ${c.type})`);
    }
  }

  // ── Stage 2.2: internal transfer-risk estimate ────────────────────────────
  // Reference Transfer Intelligence runs LATER in the pipeline (after
  // Lightroom Mapping) and cannot inform this decision directly — instead
  // Decision Engine computes its OWN lightweight transfer-risk assessment
  // from signals already available here (wbIntent, conflict count, skin/
  // scene dependency, overall confidence). This is intentionally a proxy,
  // not a duplicate of Reference Transfer's fuller analysis — the two are
  // expected to agree in the common case since they read the same
  // upstream data, and Reference Transfer's own report remains the
  // authoritative, more complete assessment for anything downstream.
  const transferRiskEstimate = _estimateTransferRisk({ wbIntent, conflicts, skinPct, portraitSafe, overallConf });

  // Transfer-aware softening: high estimated transfer risk pulls back the
  // style-driving engines (grading/HSL/calibration/curve) further, on top
  // of whatever scene-strategy/conflict dampening already applied — a
  // reference whose look depends heavily on THIS scene's specifics should
  // produce a more conservative preset.
  if (transferRiskEstimate.level === 'high') {
    gradeTrust *= 0.75; hslTrust *= 0.75; calTrust *= 0.75; curveTrust *= 0.85;
    warnings.push(`Transfer risk high (score ${transferRiskEstimate.score}) — Colour Grading/HSL/Calibration/Curve trust softened for safer portability.`);
    appliedGuards.push('Guard: high transfer risk — Lightroom values softened across the board.');
  } else if (transferRiskEstimate.level === 'medium') {
    gradeTrust *= 0.90; hslTrust *= 0.90; calTrust *= 0.90;
  }

  // ── Landscape: "allow stronger green/blue style only if confidence high" ─
  const strongColorAllowed = strategy.strongColorAllowed && overallConf >= 0.55;
  if (strategy.strongColorAllowed && !strongColorAllowed)
    warnings.push(`Landscape strong-colour allowance withheld — overallConfidence (${overallConf}) below 0.55 threshold.`);

  // ── Skin protection scaling: full strength in portrait, relaxed when the
  //    scene doesn't call for it (landscape/food), always gated on hasSkin ─
  const baseSkinLock = _skinLockScale(skinPct);
  const skinLockScale = hasSkin
    ? Math.min(1.0, baseSkinLock / Math.max(0.35, strategy.skinProtect))
    : 1.0;

  const gradeStrength = Math.max(0.1, Math.min(1.0, (mode === 'style-transfer' ? 1.0 : 0.90) * gradeTrust));
  const basicDampen   = Math.max(0.10, Math.min(0.85, 0.85 * basicTrust));
  const wbDampen       = Math.max(0.20, Math.min(1.0, wbTrust));

  appliedGuards.push(`Strategy "${strategyName}": basicDampen=${basicDampen.toFixed(2)}, wbDampen=${wbDampen.toFixed(2)}, gradeStrength=${gradeStrength.toFixed(2)}, hslTrust=${hslTrust.toFixed(2)}, calTrust=${calTrust.toFixed(2)}, skinLockScale=${skinLockScale.toFixed(2)}.`);
  if (strategy.noAutoBrighten)     appliedGuards.push('Guard: no-auto-brighten (moody mood) — exposure/highlights cannot go positive.');
  if (strategy.noAggressiveDarken) appliedGuards.push('Guard: no-aggressive-darken (airy mood) — exposure/highlights floor relaxed.');
  if (strategy.protectWarmChannels)appliedGuards.push('Guard: warm-channel protection (food scene) — red/orange/yellow saturation capped tighter.');
  if (strongColorAllowed)          appliedGuards.push('Guard: strong-colour allowance (landscape, high confidence) — green/aqua/blue given extra headroom.');

  // ── Stage 2.2: Decision confidence metrics ────────────────────────────────
  // decisionConfidence — how confident THIS decision is, given engine trust
  // weights and conflict count (everything Decision Engine itself knows).
  // transferAwareConfidence — the same, further discounted by the internal
  // transfer-risk estimate above. These are DIFFERENT numbers on purpose:
  // a confidently-made decision can still be a risky one to transfer.
  const trustAvg = (wbTrust + gradeTrust + hslTrust + calTrust + curveTrust) / 5;
  const conflictPenalty = Math.min(0.4, conflicts.length * 0.12);
  const decisionConfidence = +Math.max(0.1, Math.min(1,
    trustAvg * 0.5 + overallConf * 0.3 + (1 - conflictPenalty) * 0.2
  )).toFixed(3);
  const transferAwareConfidence = +Math.max(0.1, Math.min(1,
    decisionConfidence * (1 - transferRiskEstimate.score * 0.5)
  )).toFixed(3);

  const reasons = [
    `Scene: ${category} (confidence ${Math.round(sceneConf*100)}%)${scene?.categoryRaw && scene.categoryRaw!==category ? `, overriding histogram guess "${scene.categoryRaw}"` : ''}.`,
    `Decision strategy: "${strategyName}" — ${strategy.label}.`,
    `portraitSafe=${portraitSafe} → ${portraitSafe ? 'tight skin/colour guardrails active' : 'standard guardrails'}.`,
    `WB mood preservation: ${fingerprint.wbMoodPreservation.reason}`,
    `Tone style: "${fingerprint.moodLabel}" — Basic Panel treated as supporting signal only (dampen ${basicDampen.toFixed(2)}).`,
    `Transfer risk: ${transferRiskEstimate.level} (score ${transferRiskEstimate.score}) — ${transferRiskEstimate.reasons.join(' ')}`,
    `Decision confidence ${decisionConfidence}, transfer-aware confidence ${transferAwareConfidence}.`,
    ...appliedGuards,
  ];

  const graph = fingerprint.featureGraph;
  const finalStyleIntent = {
    strategy: strategyName,
    // Backward-compat flat fields (pre-Stage-2.2 shape) — kept alongside
    // the structured intents below so any existing reader still works.
    mood: fingerprint.mood, moodLabel: fingerprint.moodLabel,
    warmth: fingerprint.warmth, colorCast: fingerprint.colorCast,
    contrastLevel: fingerprint.contrastLevel,
    skinProtected: hasSkin && strategy.skinProtect >= 0.7,
    // 1. mood intent
    moodIntent: { tag: fingerprint.mood, label: fingerprint.moodLabel, confidence: overallConf },
    // 2. WB intent — the structured object from Stage 2.1, summarised
    wbIntent: wbIntent ? {
      direction: wbIntent.moodWarmth?.direction, transferRisk: wbIntent.transferRisk,
      intensity: wbIntent.intensity, preserveMood: wbIntent.preserveMood,
    } : null,
    // 3. skin intent
    skinIntent: { protected: hasSkin && strategy.skinProtect >= 0.7, coveragePct: +skinPct.toFixed(1), confidence: skinConfidence },
    // 4. palette intent
    paletteIntent: graph?.paletteIntent ?? (fingerprint.paletteDominantHue != null
      ? { dominantHue: fingerprint.paletteDominantHue, avgSat: fingerprint.paletteAvgSat } : null),
    // 5. contrast intent
    contrastIntent: graph?.contrastIntent ?? { level: fingerprint.contrastLevel },
    // 6. highlight intent
    highlightIntent: graph?.highlightIntent ?? null,
    // 7. shadow intent
    shadowIntent: graph?.shadowIntent ?? null,
    // 8. curve intent
    curveIntent: graph?.curveIntent ?? null,
    // 9. colour grading intent
    gradingIntent: graph?.gradingIntent ?? null,
    // 10. transfer risk intent
    transferRiskIntent: transferRiskEstimate,
    overallConfidence: overallConf,
  };

  // ── Stage 2.4 Task 2.4A: Style Intent Vocabulary (colour-oriented,
  //    feeds editingStrategy/styleBudget below — UNCHANGED by 2.4.2A) ─────
  const styleVocabulary = _deriveStyleVocabulary({ fingerprint, graph, category, decisionStrategy: strategyName, hasSkin });
  finalStyleIntent.photographerStyleLabel = styleVocabulary.photographerStyleLabel;
  finalStyleIntent.styleFamily     = styleVocabulary.styleFamily;
  finalStyleIntent.moodFamily      = styleVocabulary.moodFamily;
  finalStyleIntent.colorFamily     = styleVocabulary.colorFamily;
  finalStyleIntent.contrastFamily  = styleVocabulary.contrastFamily;
  finalStyleIntent.transferDifficulty = styleVocabulary.transferDifficulty;

  // ── Stage 2.4.2A: Style Vocabulary Intelligence (photographer-oriented) ──
  // A richer, SEPARATE classifier — additive on finalStyleIntent, does not
  // replace or feed editingStrategy/styleBudget below (per spec: "Do NOT
  // create style budgets yet"). Uses only data already computed upstream
  // (Style Fingerprint, Style Feature Graph, WB Intent, Style Recognition,
  // Colour Harmony, Skin, Scene) — no new analysis.
  finalStyleIntent.photographerStyle = _classifyPhotographerStyle({
    fingerprint, graph, category, decisionStrategy: strategyName,
    hasSkin, skinConfidence, wbIntent, overallConf,
  });

  // ── EPIC 1.3: Reference Color Intelligence — supporting evidence only ────
  // If a caller supplies referenceColorIntelligence (from
  // core/color-match/color-match-intelligence-bridge.js, computed
  // independently from a reference image's colour signals alone), check
  // whether its own colour-only styleHints name the SAME style this
  // classifier already detected. If so, attach a `referenceColorSupport`
  // field — purely additive, never touching `confidence`, `styleDNA`,
  // `styleDNAValidation`, or `styleFeasibilityEstimate` above. This can
  // never make an already-detected style "more true" numerically; it can
  // only add a plain-language corroboration note, or (if the hints point
  // elsewhere) note the absence of support without penalising anything.
  if (referenceColorIntelligence) {
    finalStyleIntent.photographerStyle.top.referenceColorSupport =
      _buildReferenceColorSupport(finalStyleIntent.photographerStyle.top.styleName, referenceColorIntelligence);
  }

  // ── Stage 2.4 Task 2.4B: Editing Strategy Engine ─────────────────────────
  const editingStrategy = _buildEditingStrategy(styleVocabulary, { hasSkin, portraitSafe });

  // ── Stage 2.4 Task 2.4C: Style Budget System ─────────────────────────────
  const styleBudget = _buildStyleBudget(styleVocabulary);

  const engineTrustWeights = {
    basicPanel: +basicTrust.toFixed(3), histogram: +Math.min(0.30, basicTrust * 0.4).toFixed(3),
    whiteBalance: +wbTrust.toFixed(3), colorGrading: +gradeTrust.toFixed(3),
    hsl: +hslTrust.toFixed(3), calibration: +calTrust.toFixed(3),
    toneCurve: +curveTrust.toFixed(3), palette: +strategy.paletteTrust.toFixed(3),
    skinTone: +strategy.skinProtect.toFixed(3), styleRecognition: 1.0,
  };

  // ── Stage 2.4.2B.2: Style Feasibility Intelligence (preliminary estimate) ─
  // The AUTHORITATIVE styleFeasibility (using complexity, transferConfidence,
  // lightroomReproduction, wbTransferRisk, benchmark, validation) is computed
  // later in core/reference-transfer-engine, once all of those exist — none
  // of them are available yet at decision time. This is a lightweight proxy
  // using only what Decision Engine itself knows (DNA validation score,
  // average engine trust, transferRiskEstimate as a WB-risk stand-in, and
  // the style's own declared transfer difficulty), so Decision Report has
  // *something* to show before Reference Transfer runs.
  finalStyleIntent.styleFeasibilityEstimate = _estimateStyleFeasibilityProxy(
    finalStyleIntent.photographerStyle?.top, transferRiskEstimate, engineTrustWeights
  );

  // ── EPIC 1.4: Photographer Intent Intelligence ────────────────────────────
  // Answers a DIFFERENT question from photographerStyle above (look
  // category) — what creative/emotional DIRECTION is behind it. Uses only
  // signals already computed above (photographerStyle, its DNA
  // validation, styleFeasibilityEstimate, the same fingerprint/graph/
  // wbIntent signals, plus optional referenceColorIntelligence) — no new
  // image analysis. Never overrides photographerStyle/Style DNA — purely
  // additive.
  finalStyleIntent.photographerIntent = _buildPhotographerIntent({
    fingerprint, graph, category, hasSkin, skinConfidence, wbIntent,
    photographerStyle: finalStyleIntent.photographerStyle,
    styleFeasibilityEstimate: finalStyleIntent.styleFeasibilityEstimate,
    referenceColorIntelligence, overallConf,
  });

  // ── EPIC 1.6: Capture Capability Intelligence (preliminary estimate) ─────
  // Answers a DIFFERENT question from everything above: "what is this
  // SOURCE CAPTURE realistically capable of reproducing?" — independent
  // of which style/intent is detected. Uses only `stats` (already
  // available here from histogram-engine) — noise/sharpness data
  // (core/image-analysis-core) is not resolved yet at decision time, so
  // this is a preliminary estimate; the authoritative version (with real
  // noise/sharpness) is computed later in core/reference-transfer-engine
  // using this SAME function, never a duplicated copy of its logic.
  finalStyleIntent.captureCapabilityEstimate = buildCaptureCapability({
    stats, imageAnalysisCore: null, skinConfidence,
    styleFeasibility: finalStyleIntent.styleFeasibilityEstimate,
  });
  finalStyleIntent.intentCompatibilityEstimate = buildIntentCompatibility(
    finalStyleIntent.photographerIntent.primaryIntent, finalStyleIntent.captureCapabilityEstimate
  );
  finalStyleIntent.captureBudgetHints = buildCaptureBudgetHints(finalStyleIntent.captureCapabilityEstimate);

  // ── EPIC 1.7: Style Budget Intelligence (preliminary estimate) ───────────
  // Answers "how should editing EFFORT be distributed?" given intent +
  // DNA + feasibility + capture capability — an ABSTRACT resource
  // allocation layer, NOT Lightroom Mapping. Named `styleBudgetIntelligence`
  // (not `styleBudget`) to avoid any collision with the existing,
  // unrelated Stage 2.4C `styleBudget` (a simple colour-mood budget that
  // DOES feed Lightroom Mapping today) — that system is completely
  // untouched by this stage. Preliminary here (captureCapabilityEstimate
  // lacks real noise data yet); the authoritative version is computed
  // later in core/reference-transfer-engine using this SAME function.
  finalStyleIntent.styleBudgetIntelligence = buildStyleBudgetIntelligence({
    photographerIntent: finalStyleIntent.photographerIntent,
    photographerStyle: finalStyleIntent.photographerStyle,
    styleFeasibility: finalStyleIntent.styleFeasibilityEstimate,
    captureCapability: finalStyleIntent.captureCapabilityEstimate,
    referenceColorIntelligence, engineTrustWeights,
  });

  // ── EPIC 2A: Lightroom Mapping V2 Planner (SHADOW-ONLY) ───────────────────
  // Attaches a purely abstract planning object — never a Lightroom slider
  // value — to finalStyleIntent, mirroring where every other EPIC
  // 1.4-1.7 intelligence layer already lives. This does NOT affect
  // production mapping: `mapStyleFingerprintToLightroom()` (called below,
  // unchanged) never reads `finalStyleIntent` at all, so nothing added
  // here can reach XMP export. Wrapped in try/catch as defense-in-depth —
  // buildLightroomMappingPlanV2() is itself designed to never throw (every
  // input optional, every access null-safe), but a planning-layer failure
  // must never be able to break the production preset build either way.
  try {
    finalStyleIntent.lightroomMappingPlanV2 = buildLightroomMappingPlanV2({
      finalStyleIntent, photographerIntent: finalStyleIntent.photographerIntent,
      styleBudgetIntelligence: finalStyleIntent.styleBudgetIntelligence,
      styleDNA: finalStyleIntent.photographerStyle?.top?.styleDNA,
      styleDNAValidation: finalStyleIntent.photographerStyle?.top?.styleDNAValidation,
      styleFeasibility: finalStyleIntent.styleFeasibilityEstimate,
      captureCapability: finalStyleIntent.captureCapabilityEstimate,
      referenceColorIntelligence, legacyStyleBudget: null,
    });
  } catch (e) {
    finalStyleIntent.lightroomMappingPlanV2 = null;
    finalStyleIntent.lightroomMappingPlanV2Error = `Shadow planner failed safely (production unaffected): ${e.message}`;
  }

  // ── EPIC 2B: Budget-to-Lightroom Translation V2 (SHADOW-ONLY) ─────────────
  // Same safety posture as EPIC 2A's planner attachment above: purely
  // abstract tool-direction/range hints, never a slider value, attached
  // to finalStyleIntent (which mapStyleFingerprintToLightroom below never
  // reads), wrapped in try/catch as defense-in-depth even though
  // buildLightroomTranslationV2() is itself designed to never throw.
  try {
    finalStyleIntent.lightroomTranslationV2 = buildLightroomTranslationV2({
      finalStyleIntent, lightroomMappingPlanV2: finalStyleIntent.lightroomMappingPlanV2,
      photographerIntent: finalStyleIntent.photographerIntent,
      styleBudgetIntelligence: finalStyleIntent.styleBudgetIntelligence,
      styleDNA: finalStyleIntent.photographerStyle?.top?.styleDNA,
      styleDNAValidation: finalStyleIntent.photographerStyle?.top?.styleDNAValidation,
      styleFeasibility: finalStyleIntent.styleFeasibilityEstimate,
      captureCapability: finalStyleIntent.captureCapabilityEstimate,
      referenceColorIntelligence, legacyMapping: null,
    });
  } catch (e) {
    finalStyleIntent.lightroomTranslationV2 = null;
    finalStyleIntent.lightroomTranslationV2Error = `Shadow translator failed safely (production unaffected): ${e.message}`;
  }

  // ── EPIC 2C: Safety Clamp & Over-stack Protection V2 (SHADOW-ONLY) ───────
  // Reviews lightroomTranslationV2 and produces safety decisions (clamp
  // profiles, tool caps, hard stops, over-stack analysis) for a FUTURE
  // controlled activation — activationGate.canActivate is hard-coded
  // false inside buildLightroomSafetyClampV2() itself, not just by
  // omission here. Attached to finalStyleIntent (never read by
  // mapStyleFingerprintToLightroom below), wrapped in try/catch as
  // defense-in-depth, matching the exact pattern used for the planner
  // (EPIC 2A) and translator (EPIC 2B) above.
  try {
    finalStyleIntent.lightroomSafetyClampV2 = buildLightroomSafetyClampV2({
      finalStyleIntent, lightroomMappingPlanV2: finalStyleIntent.lightroomMappingPlanV2,
      lightroomTranslationV2: finalStyleIntent.lightroomTranslationV2,
      photographerIntent: finalStyleIntent.photographerIntent,
      styleBudgetIntelligence: finalStyleIntent.styleBudgetIntelligence,
      styleDNA: finalStyleIntent.photographerStyle?.top?.styleDNA,
      styleDNAValidation: finalStyleIntent.photographerStyle?.top?.styleDNAValidation,
      styleFeasibility: finalStyleIntent.styleFeasibilityEstimate,
      captureCapability: finalStyleIntent.captureCapabilityEstimate,
      referenceColorIntelligence, legacyMapping: null,
    });
  } catch (e) {
    finalStyleIntent.lightroomSafetyClampV2 = null;
    finalStyleIntent.lightroomSafetyClampV2Error = `Shadow safety clamp failed safely (production unaffected): ${e.message}`;
  }

  // ── EPIC 2D: Shadow Compare Report V2 (SHADOW-COMPARE ONLY) ───────────────
  // Compares legacy mapping (via the already-computed `styleBudget` local
  // variable — read-only, never re-derived into new slider values) against
  // the full V2 chain (plan/translation/safety) and produces a REPORT.
  // Attached to finalStyleIntent, never read by mapStyleFingerprintToLightroom
  // below, wrapped in try/catch as defense-in-depth — same pattern as
  // EPIC 2A/2B/2C above.
  try {
    finalStyleIntent.lightroomShadowCompareReportV2 = buildLightroomShadowCompareReportV2({
      finalStyleIntent, decision: { styleBudget },
      lightroomMappingPlanV2: finalStyleIntent.lightroomMappingPlanV2,
      lightroomTranslationV2: finalStyleIntent.lightroomTranslationV2,
      lightroomSafetyClampV2: finalStyleIntent.lightroomSafetyClampV2,
      photographerIntent: finalStyleIntent.photographerIntent,
      styleBudgetIntelligence: finalStyleIntent.styleBudgetIntelligence,
      styleDNA: finalStyleIntent.photographerStyle?.top?.styleDNA,
      styleDNAValidation: finalStyleIntent.photographerStyle?.top?.styleDNAValidation,
      styleFeasibility: finalStyleIntent.styleFeasibilityEstimate,
      captureCapability: finalStyleIntent.captureCapabilityEstimate,
      referenceColorIntelligence,
    });
  } catch (e) {
    finalStyleIntent.lightroomShadowCompareReportV2 = null;
    finalStyleIntent.lightroomShadowCompareReportV2Error = `Shadow compare failed safely (production unaffected): ${e.message}`;
  }

  // ── EPIC 2E-A: Controlled Activation Gate ─────────────────────────────────
  // Answers "is Mapping V2 allowed to influence production output?" — with
  // no `flags` override passed here, this resolves to the safe defaults in
  // mapping-v2-flags.js (enableControlledActivation=false,
  // allowProductionOverride=false), guaranteeing canUseV2=false and
  // selectedMappingSource="legacy" regardless of any upstream signal.
  // Attached to finalStyleIntent, never read by mapStyleFingerprintToLightroom
  // below, wrapped in try/catch as defense-in-depth — same pattern as
  // EPIC 2A/2B/2C/2D above.
  try {
    finalStyleIntent.lightroomControlledActivationV2 = buildLightroomControlledActivationV2({
      finalStyleIntent, decision: { styleBudget },
      lightroomMappingPlanV2: finalStyleIntent.lightroomMappingPlanV2,
      lightroomTranslationV2: finalStyleIntent.lightroomTranslationV2,
      lightroomSafetyClampV2: finalStyleIntent.lightroomSafetyClampV2,
      lightroomShadowCompareReportV2: finalStyleIntent.lightroomShadowCompareReportV2,
      photographerIntent: finalStyleIntent.photographerIntent,
      styleBudgetIntelligence: finalStyleIntent.styleBudgetIntelligence,
      styleDNA: finalStyleIntent.photographerStyle?.top?.styleDNA,
      styleFeasibility: finalStyleIntent.styleFeasibilityEstimate,
      captureCapability: finalStyleIntent.captureCapabilityEstimate,
      // No `flags` override — always resolves to the safe defaults.
    });
  } catch (e) {
    finalStyleIntent.lightroomControlledActivationV2 = null;
    finalStyleIntent.lightroomControlledActivationV2Error = `Controlled activation gate failed safely (production unaffected): ${e.message}`;
  }

  // ── EPIC 2E-B: Legacy Safety Overlay ──────────────────────────────────────
  // V2 safety intelligence acts as an advisor/guardrail over the ACTIVE
  // legacy mapping without replacing it. With no `flags` override, this
  // resolves to the safe defaults (enableLegacySafetyOverlay=false,
  // allowLegacyOverlayProductionClamp=false) — canApplyOverlay=false,
  // selectedOutputSource="legacy", overlayClampPlan.canApply=false.
  // Attached to finalStyleIntent, never read by mapStyleFingerprintToLightroom
  // below, wrapped in try/catch as defense-in-depth — same pattern as
  // EPIC 2A/2B/2C/2D/2E-A above.
  try {
    finalStyleIntent.legacySafetyOverlayV2 = buildLegacySafetyOverlayV2({
      finalStyleIntent, decision: { styleBudget }, legacyStyleBudget: styleBudget,
      lightroomMappingPlanV2: finalStyleIntent.lightroomMappingPlanV2,
      lightroomTranslationV2: finalStyleIntent.lightroomTranslationV2,
      lightroomSafetyClampV2: finalStyleIntent.lightroomSafetyClampV2,
      lightroomShadowCompareReportV2: finalStyleIntent.lightroomShadowCompareReportV2,
      lightroomControlledActivationV2: finalStyleIntent.lightroomControlledActivationV2,
      styleBudgetIntelligence: finalStyleIntent.styleBudgetIntelligence,
      photographerIntent: finalStyleIntent.photographerIntent,
      styleDNA: finalStyleIntent.photographerStyle?.top?.styleDNA,
      styleFeasibility: finalStyleIntent.styleFeasibilityEstimate,
      captureCapability: finalStyleIntent.captureCapabilityEstimate,
      // No `flags` override — always resolves to the safe defaults.
    });
  } catch (e) {
    finalStyleIntent.legacySafetyOverlayV2 = null;
    finalStyleIntent.legacySafetyOverlayV2Error = `Legacy safety overlay failed safely (production unaffected): ${e.message}`;
  }

  // ── EPIC 2E-C: Overlay Preview / Controlled Overlay Simulation ───────────
  // Answers "if the overlay WERE allowed to act, what would it recommend?"
  // — a pure report/preview layer. With no `flags` override, this
  // resolves to the safe defaults (allowOverlaySimulationProductionWrite=
  // false, allowOverlaySimulationPresetMutation=false); more importantly,
  // `canApplyToProduction` and `selectedOutputSource` are HARD-CODED
  // inside the module itself, not just gated by flags — verified this
  // stays false/legacy even when flags are forced true. Attached to
  // finalStyleIntent, never read by mapStyleFingerprintToLightroom below,
  // wrapped in try/catch as defense-in-depth — same pattern as
  // EPIC 2A-2E-B above.
  try {
    finalStyleIntent.legacyOverlaySimulationV2 = buildLegacyOverlaySimulationV2({
      finalStyleIntent, decision: { styleBudget }, legacyStyleBudget: styleBudget,
      lightroomMappingPlanV2: finalStyleIntent.lightroomMappingPlanV2,
      lightroomTranslationV2: finalStyleIntent.lightroomTranslationV2,
      lightroomSafetyClampV2: finalStyleIntent.lightroomSafetyClampV2,
      lightroomShadowCompareReportV2: finalStyleIntent.lightroomShadowCompareReportV2,
      lightroomControlledActivationV2: finalStyleIntent.lightroomControlledActivationV2,
      legacySafetyOverlayV2: finalStyleIntent.legacySafetyOverlayV2,
      styleBudgetIntelligence: finalStyleIntent.styleBudgetIntelligence,
      photographerIntent: finalStyleIntent.photographerIntent,
      styleDNA: finalStyleIntent.photographerStyle?.top?.styleDNA,
      styleFeasibility: finalStyleIntent.styleFeasibilityEstimate,
      captureCapability: finalStyleIntent.captureCapabilityEstimate,
      // No `flags` override — always resolves to the safe defaults.
    });
  } catch (e) {
    finalStyleIntent.legacyOverlaySimulationV2 = null;
    finalStyleIntent.legacyOverlaySimulationV2Error = `Overlay simulation failed safely (production unaffected): ${e.message}`;
  }

  // ── EPIC 2E-D: Controlled Overlay Test Gate ───────────────────────────────
  // Answers "is the overlay simulation safe enough to enter a controlled
  // TEST mode?" — NOT production activation. With no `flags` override,
  // this resolves to the safe defaults (allowControlledOverlayTest=false,
  // allowOverlayTestPresetPreview=false); `canWriteProduction` is
  // additionally HARD-CODED false inside the module itself — verified
  // this stays false even when every other flag is forced true. Attached
  // to finalStyleIntent, never read by mapStyleFingerprintToLightroom
  // below, wrapped in try/catch as defense-in-depth — same pattern as
  // EPIC 2A-2E-C above.
  try {
    finalStyleIntent.controlledOverlayTestGateV2 = buildControlledOverlayTestGateV2({
      finalStyleIntent, decision: { styleBudget }, legacyStyleBudget: styleBudget,
      lightroomMappingPlanV2: finalStyleIntent.lightroomMappingPlanV2,
      lightroomTranslationV2: finalStyleIntent.lightroomTranslationV2,
      lightroomSafetyClampV2: finalStyleIntent.lightroomSafetyClampV2,
      lightroomShadowCompareReportV2: finalStyleIntent.lightroomShadowCompareReportV2,
      lightroomControlledActivationV2: finalStyleIntent.lightroomControlledActivationV2,
      legacySafetyOverlayV2: finalStyleIntent.legacySafetyOverlayV2,
      legacyOverlaySimulationV2: finalStyleIntent.legacyOverlaySimulationV2,
      styleBudgetIntelligence: finalStyleIntent.styleBudgetIntelligence,
      photographerIntent: finalStyleIntent.photographerIntent,
      styleDNA: finalStyleIntent.photographerStyle?.top?.styleDNA,
      styleFeasibility: finalStyleIntent.styleFeasibilityEstimate,
      captureCapability: finalStyleIntent.captureCapabilityEstimate,
      // No `flags` override — always resolves to the safe defaults.
    });
  } catch (e) {
    finalStyleIntent.controlledOverlayTestGateV2 = null;
    finalStyleIntent.controlledOverlayTestGateV2Error = `Controlled overlay test gate failed safely (production unaffected): ${e.message}`;
  }

  // ── EPIC 2E-E, patched EPIC 2E-E-F: Controlled Overlay Preview Sandbox ────
  // Answers "if we previewed the overlay safely, what abstract preset
  // changes would be simulated?" — builds a SEPARATE, non-production
  // preview object. With no `flags` override, this resolves to the safe
  // defaults (allowOverlayPreviewExport=false,
  // allowOverlayPreviewProductionWrite=false,
  // allowOverlayPreviewPresetMutation=false); `canExportPreview` and
  // `canWriteProduction` are additionally HARD-CODED false inside the
  // module itself, and `simulatedPreviewPreset` is guaranteed to contain
  // no real slider values and no XMP values — verified this stays true
  // even when every export/write/mutation flag is forced true.
  // `canGeneratePreview` now requires ALL required gates (including a
  // genuine test-gate eligibility check and a complete human review),
  // not just "some V2 data exists" (EPIC 2E-E-F's core eligibility fix).
  // Attached to finalStyleIntent, never read by mapStyleFingerprintToLightroom
  // below, wrapped in try/catch as defense-in-depth — same pattern as
  // EPIC 2A-2E-D above.
  try {
    finalStyleIntent.controlledOverlayPreviewSandboxV2 = buildControlledOverlayPreviewSandboxV2({
      finalStyleIntent, decision: { styleBudget }, legacyStyleBudget: styleBudget,
      lightroomMappingPlanV2: finalStyleIntent.lightroomMappingPlanV2,
      lightroomTranslationV2: finalStyleIntent.lightroomTranslationV2,
      lightroomSafetyClampV2: finalStyleIntent.lightroomSafetyClampV2,
      lightroomShadowCompareReportV2: finalStyleIntent.lightroomShadowCompareReportV2,
      lightroomControlledActivationV2: finalStyleIntent.lightroomControlledActivationV2,
      legacySafetyOverlayV2: finalStyleIntent.legacySafetyOverlayV2,
      legacyOverlaySimulationV2: finalStyleIntent.legacyOverlaySimulationV2,
      controlledOverlayTestGateV2: finalStyleIntent.controlledOverlayTestGateV2,
      styleBudgetIntelligence: finalStyleIntent.styleBudgetIntelligence,
      photographerIntent: finalStyleIntent.photographerIntent,
      styleDNA: finalStyleIntent.photographerStyle?.top?.styleDNA,
      styleFeasibility: finalStyleIntent.styleFeasibilityEstimate,
      captureCapability: finalStyleIntent.captureCapabilityEstimate,
      // No `flags` override — always resolves to the safe defaults.
    });
  } catch (e) {
    finalStyleIntent.controlledOverlayPreviewSandboxV2 = null;
    finalStyleIntent.controlledOverlayPreviewSandboxV2Error = `Overlay preview sandbox failed safely (production unaffected): ${e.message}`;
  }

  // ── EPIC 2E-F Phase B, patched EPIC 2E-F-B-F: Controlled Preview Review State ──
  // Tracks the (future, Phase C) human-review checklist for the preview
  // sandbox object above. This stage is READ-ONLY and produces no side
  // effects — it never activates production output, never enables
  // preview export or production write (those remain hard-coded false
  // inside the Preview Sandbox itself), and approval here has no path
  // to influence XMP export in any way.
  //
  // `existingControlledPreviewReviewStateV2` (a `_buildDecision` param,
  // itself sourced from `buildFinalPreset(inputs)`'s optional
  // `inputs.controlledPreviewReviewStateV2`) is how a future Phase C UI
  // caller passes in prior review progress. It defaults to `null` — the
  // fully backward-compatible default for every existing caller that
  // doesn't pass it, in which case behavior is identical to before this
  // patch. When provided, it is treated as entirely UNTRUSTED raw input:
  // createPreviewReviewStateV2() below normalizes every review item and
  // recalculates every derived field itself; nothing here reads or
  // copies an approval-related field from it.
  //
  // Attached to finalStyleIntent, never read by
  // mapStyleFingerprintToLightroom below, wrapped in try/catch as
  // defense-in-depth — same pattern as EPIC 2A-2E-E above. Built AFTER
  // the preview sandbox (integration order #11, per this phase's spec).
  try {
    finalStyleIntent.controlledPreviewReviewStateV2 = createPreviewReviewStateV2({
      // EPIC 2E-F-B-F: the explicit incoming state from a future Phase C
      // caller takes priority over anything already on finalStyleIntent
      // (which, in the current stateless architecture, is never already
      // set at this point anyway). Passed through as raw, UNTRUSTED
      // input — createPreviewReviewStateV2 itself is fully responsible
      // for normalizing every review item and recalculating every
      // derived field (approvalState, canApprovePreview, etc.) against
      // the CURRENT Preview Sandbox below. No approval field is read or
      // copied here — that would duplicate the Review State engine's own
      // logic, which this patch must not do.
      existingReviewState: existingControlledPreviewReviewStateV2 ?? finalStyleIntent.controlledPreviewReviewStateV2 ?? null,
      controlledOverlayPreviewSandboxV2: finalStyleIntent.controlledOverlayPreviewSandboxV2,
      controlledOverlayTestGateV2: finalStyleIntent.controlledOverlayTestGateV2,
      legacyOverlaySimulationV2: finalStyleIntent.legacyOverlaySimulationV2,
      legacySafetyOverlayV2: finalStyleIntent.legacySafetyOverlayV2,
      lightroomSafetyClampV2: finalStyleIntent.lightroomSafetyClampV2,
      lightroomShadowCompareReportV2: finalStyleIntent.lightroomShadowCompareReportV2,
      photographerIntent: finalStyleIntent.photographerIntent,
      photographerStyle: finalStyleIntent.photographerStyle,
      styleDNA: finalStyleIntent.photographerStyle?.top?.styleDNA,
      captureCapability: finalStyleIntent.captureCapabilityEstimate,
    });
  } catch (e) {
    finalStyleIntent.controlledPreviewReviewStateV2 = null;
    finalStyleIntent.controlledPreviewReviewStateV2Error = `Preview review state failed safely (production unaffected): ${e.message}`;
  }

  return {
    category, isPortrait, portraitSafe, hasSkin, skinPct, skinHue, skinConfidence,
    mode, gradeStrength, skinLockScale, hslDampen, calDampen,
    basicDampen, wbDampen,
    noAutoBrighten: strategy.noAutoBrighten, noAggressiveDarken: strategy.noAggressiveDarken,
    protectWarmChannels: strategy.protectWarmChannels, strongColorAllowed,
    sceneConfidence: sceneConf,
    decisionStrategy: strategyName, engineTrustWeights, appliedGuards,
    finalStyleIntent, conflicts,
    warnings: [...warnings, ...styleVocabulary.warnings],
    reasons: [...reasons, ...styleVocabulary.reasons],
    // Stage 2.4: Photographer Intelligence Layer
    editingStrategy, styleBudget,
    // Stage 2.2: transfer-aware decision output
    transferRiskEstimate, decisionConfidence, transferAwareConfidence,
  };
}

/**
 * Stage 2.4 Task 2.4A: Style Intent Vocabulary.
 * Classifies the reference into a photographer-recognisable named look
 * using ONLY signals that already exist (fingerprint mood/warmth/cast,
 * Style Feature Graph palette/contrast intents, scene category, decision
 * strategy, style-recognition top label). No new analysis — this is a
 * rule-based lookup over existing data, the same pattern as
 * feature-fusion-engine's STYLE_TO_MOOD table.
 */
function _deriveStyleVocabulary({ fingerprint, graph, category, decisionStrategy, hasSkin }) {
  const mood = fingerprint.mood;
  const warmth = fingerprint.warmth;
  const cast = fingerprint.colorCast;
  const paletteHue = graph?.paletteIntent?.dominantHue ?? null;
  const paletteSat = graph?.paletteIntent?.avgSat ?? null;
  const contrastLevel = graph?.contrastIntent?.level ?? fingerprint.contrastLevel;
  const styleTop = fingerprint.styleRecognitionTop;
  const reasons = [], warnings = [];

  const isGreenish = paletteHue != null && paletteHue >= 70 && paletteHue <= 165;
  const isEarthy   = paletteHue != null && paletteHue >= 20 && paletteHue <= 50 && warmth === 'warm';
  const isMuted    = paletteSat != null && paletteSat < 25;
  const isPastel   = isMuted && (mood === 'airy_bright' || contrastLevel === 'low');

  // Ordered rule table — first match wins. Each rule is a small, named,
  // explainable combination of existing signals, matching the 12
  // vocabulary examples in the spec.
  const rules = [
    { test: () => isGreenish && isPastel,                                          label: 'green pastel',        styleFamily: 'nature',     colorFamily: 'green',  reason: 'Muted green-dominant palette with soft/airy mood.' },
    { test: () => isGreenish && (mood === 'matte_shadow' || contrastLevel === 'low'), label: 'matte forest',       styleFamily: 'nature',     colorFamily: 'green',  reason: 'Green-dominant palette with matte/flat tonal character.' },
    { test: () => isEarthy && (mood === 'matte_shadow' || cast === 'warm'),          label: 'brown film',          styleFamily: 'film',       colorFamily: 'earth',  reason: 'Warm earthy palette with film-like compressed contrast.' },
    { test: () => isEarthy,                                                          label: 'warm earth tone',     styleFamily: 'natural',    colorFamily: 'earth',  reason: 'Warm, earthy dominant palette.' },
    { test: () => (category === 'Wedding') && mood === 'airy_bright',                label: 'airy wedding',        styleFamily: 'wedding',    colorFamily: 'neutral',reason: 'Wedding scene with airy/high-key mood.' },
    { test: () => (category === 'Wedding'),                                          label: 'luxury wedding',      styleFamily: 'wedding',    colorFamily: 'neutral',reason: 'Wedding scene, not specifically high-key — treated as a polished/luxury look.' },
    { test: () => hasSkin && mood === 'airy_bright' && isMuted,                       label: 'soft high-key',       styleFamily: 'portrait',   colorFamily: 'neutral',reason: 'Skin present, airy/high-key mood, muted palette.' },
    { test: () => hasSkin && mood === 'balanced' && contrastLevel !== 'high',         label: 'clean portrait',      styleFamily: 'portrait',   colorFamily: 'neutral',reason: 'Skin present, balanced mood and contrast — a clean, unstylised portrait look.' },
    { test: () => mood === 'moody_dark' && (styleTop === 'Documentary' || styleTop === 'Street'), label: 'natural documentary', styleFamily: 'documentary', colorFamily: 'neutral', reason: 'Moody tone with documentary/street style recognition.' },
    { test: () => mood === 'moody_dark' && contrastLevel === 'high',                  label: 'moody cinematic',     styleFamily: 'cinematic',  colorFamily: 'neutral',reason: 'Moody-dark mood combined with high contrast — a cinematic look.' },
    { test: () => mood === 'moody_dark',                                              label: 'dark editorial',      styleFamily: 'editorial',  colorFamily: 'neutral',reason: 'Moody-dark mood without the high-contrast cinematic signature.' },
    { test: () => styleTop === 'Fashion' && isMuted,                                  label: 'muted fashion',       styleFamily: 'fashion',    colorFamily: 'neutral',reason: 'Fashion style recognition with a muted palette.' },
  ];

  let matched = rules.find(r => r.test());
  if (!matched) {
    matched = { label: 'balanced natural', styleFamily: 'general', colorFamily: isGreenish ? 'green' : isEarthy ? 'earth' : 'neutral',
      reason: 'No strong named-look signature detected — treated as a balanced, natural reference.' };
    warnings.push('No specific photographer style label matched strongly — falling back to "balanced natural".');
  }
  reasons.push(`Style vocabulary: "${matched.label}" — ${matched.reason}`);

  const moodFamily = mood === 'airy_bright' ? 'airy' : mood === 'moody_dark' ? 'moody'
    : mood === 'matte_shadow' ? 'matte' : mood === 'high_contrast' ? 'contrasty' : 'balanced';
  const contrastFamily = contrastLevel === 'high' ? 'punchy' : contrastLevel === 'low' ? 'flat' : 'natural';

  // Transfer difficulty: named looks that depend heavily on scene-specific
  // colour (green/earth palettes, mixed lighting) are harder to transfer
  // than neutral-palette looks (portrait/editorial/wedding).
  const hardFamilies = new Set(['nature', 'film']);
  const transferDifficulty = hardFamilies.has(matched.styleFamily) ? 'high'
    : matched.styleFamily === 'cinematic' ? 'medium' : 'low';

  return {
    photographerStyleLabel: matched.label,
    styleFamily: matched.styleFamily,
    moodFamily, colorFamily: matched.colorFamily, contrastFamily,
    transferDifficulty, reasons, warnings,
  };
}

/**
 * Stage 2.4 Task 2.4B: Editing Strategy Engine.
 * Chooses HOW to build the detected look — which Lightroom tools should
 * lead, which should support, and which should be actively avoided for
 * THIS style family, so Lightroom Mapping doesn't let every engine push
 * toward the same look independently (see also Task 2.4C budget).
 */
/**
 * Stage 2.4.2A: Style Vocabulary Intelligence.
 *
 * Upgrades from colour-based reasoning (_deriveStyleVocabulary above, still
 * used unchanged for editingStrategy/styleBudget) to photographer-oriented
 * reasoning — 17 named looks a working photographer would actually use,
 * each carrying rich metadata for Decision Report to explain.
 *
 * Declarative STYLE_PROFILES table, not 17 hand-written classifier
 * functions: each profile's `match(s)` reads a common `signals` object
 * (built once from data ALREADY computed upstream — Style Fingerprint,
 * Style Feature Graph, WB Intent, Style Recognition, Colour Harmony,
 * Skin, Scene) and returns a 0–1 score plus the specific hits that
 * contributed to it. This is intentionally NOT a re-analysis of pixels —
 * every signal here already exists on the fingerprint/graph/wbIntent
 * objects passed in; nothing duplicates style-recognition-engine's own
 * pixel-level feature extraction, only reads its output
 * (styleRecognitionTop).
 */
function _buildStyleSignals({ fingerprint, graph, category, hasSkin, wbIntent }) {
  return {
    moodTag: fingerprint.mood,
    warmthDir: fingerprint.warmth,
    colorCast: fingerprint.colorCast,
    contrastLevel: graph?.contrastIntent?.level ?? fingerprint.contrastLevel,
    paletteHue: graph?.paletteIntent?.dominantHue ?? null,
    paletteSat: graph?.paletteIntent?.avgSat ?? null,
    harmonyScheme: graph?.harmonyIntent?.scheme ?? null,
    skinDetected: hasSkin,
    wbTransferRisk: wbIntent?.transferRisk ?? 'low',
    wbDirection: wbIntent?.moodWarmth?.direction ?? 'neutral',
    category,
    styleTop: fingerprint.styleRecognitionTop,
  };
}

const STYLE_PROFILES = [
  {
    name: 'Airy Wedding', priority: 1.00,
    description: 'Bright, soft, high-key wedding look with gentle highlight roll-off and an airy atmosphere.',
    characteristics: ['bright exposure', 'soft highlight roll-off', 'airy atmosphere', 'gentle skin tones'],
    preferredTools: ['highlights', 'whites', 'toneCurve_soft', 'skinProtection'],
    avoidedTools: ['exposure_darken', 'hsl_saturation_strong'],
    transferDifficulty: 'low',
    match: (s) => { let sc=0; const h=[];
      if (s.category==='Wedding') { sc+=0.30; h.push('Wedding scene'); }
      if (s.moodTag==='airy_bright') { sc+=0.35; h.push('airy/high-key mood'); }
      if (s.contrastLevel!=='high') { sc+=0.15; h.push('non-punchy contrast'); }
      if (s.warmthDir!=='cool') { sc+=0.10; h.push('warm/neutral warmth'); }
      if (s.skinDetected) { sc+=0.10; h.push('skin present'); }
      return { score: sc, hits: h }; },
  },
  {
    name: 'Luxury Wedding', priority: 0.95,
    description: 'Polished, editorial wedding look with clean tonal balance rather than a high-key airy treatment.',
    characteristics: ['clean tonal balance', 'controlled saturation', 'editorial polish'],
    preferredTools: ['colorGrading', 'toneCurve', 'skinProtection'],
    avoidedTools: ['hsl_saturation_strong', 'texture_heavy'],
    transferDifficulty: 'medium',
    match: (s) => { let sc=0; const h=[];
      if (s.category==='Wedding') { sc+=0.30; h.push('Wedding scene'); }
      if (s.styleTop==='Luxury') { sc+=0.30; h.push('Luxury style recognition'); }
      if (s.moodTag!=='airy_bright') { sc+=0.15; h.push('not high-key (distinguishes from Airy Wedding)'); }
      if (s.paletteSat!=null && s.paletteSat<35) { sc+=0.15; h.push('restrained palette'); }
      if (s.contrastLevel!=='low') { sc+=0.10; h.push('defined (non-flat) contrast'); }
      return { score: sc, hits: h }; },
  },
  {
    name: 'Brown Film', priority: 0.95,
    description: 'Warm, earthy, film-emulation look with compressed contrast and a faded, nostalgic tonal character.',
    characteristics: ['warm earthy palette', 'compressed contrast', 'faded shadows', 'film-like tonal roll-off'],
    preferredTools: ['toneCurve', 'colorGrading', 'calibration_subtle'],
    avoidedTools: ['wb_strong_warm', 'hsl_orange_red_strong'],
    transferDifficulty: 'high',
    match: (s) => { let sc=0; const h=[];
      if (s.paletteHue!=null && s.paletteHue>=20 && s.paletteHue<=50) { sc+=0.30; h.push('warm/earthy dominant hue'); }
      if (s.warmthDir==='warm') { sc+=0.20; h.push('warm reference mood'); }
      if (s.moodTag==='matte_shadow') { sc+=0.30; h.push('matte/compressed shadow character'); }
      if (s.styleTop==='Vintage') { sc+=0.20; h.push('Vintage style recognition'); }
      return { score: sc, hits: h }; },
  },
  {
    name: 'Green Pastel', priority: 0.90,
    description: 'Soft, muted green-dominant palette with a gentle, airy pastel character.',
    characteristics: ['muted green palette', 'soft light', 'low saturation', 'gentle atmosphere'],
    preferredTools: ['hsl_green_luminance', 'toneCurve'],
    avoidedTools: ['hsl_green_saturation_strong', 'calibration_strong'],
    transferDifficulty: 'high',
    match: (s) => { let sc=0; const h=[];
      if (s.paletteHue!=null && s.paletteHue>=70 && s.paletteHue<=165) { sc+=0.35; h.push('green-dominant palette'); }
      if (s.paletteSat!=null && s.paletteSat<30) { sc+=0.30; h.push('muted/pastel saturation'); }
      if (s.moodTag==='airy_bright' || s.contrastLevel==='low') { sc+=0.25; h.push('soft/airy tonal character'); }
      if (s.moodTag!=='moody_dark') { sc+=0.10; h.push('not dark (distinguishes from Dark Forest)'); }
      return { score: sc, hits: h }; },
  },
  {
    name: 'Soft Portrait', priority: 0.85,
    description: 'Gentle portrait treatment with soft highlight handling and relaxed contrast.',
    characteristics: ['soft highlight roll-off', 'relaxed contrast', 'flattering skin tones'],
    preferredTools: ['skinProtection', 'toneCurve_soft', 'highlights'],
    avoidedTools: ['hsl_saturation_strong', 'texture_heavy'],
    transferDifficulty: 'low',
    match: (s) => { let sc=0; const h=[];
      if (s.skinDetected) { sc+=0.30; h.push('skin present'); }
      if (s.moodTag==='soft_highlight' || s.moodTag==='balanced') { sc+=0.30; h.push('soft/balanced tonal mood'); }
      if (s.contrastLevel!=='high') { sc+=0.25; h.push('relaxed contrast'); }
      if (s.category==='Portrait') { sc+=0.15; h.push('Portrait scene'); }
      return { score: sc, hits: h }; },
  },
  {
    name: 'Clean Portrait', priority: 0.80,
    description: 'Unstylised, naturally balanced portrait with minimal colour intervention.',
    characteristics: ['balanced exposure', 'neutral colour cast', 'minimal stylisation'],
    preferredTools: ['skinProtection', 'toneCurve'],
    avoidedTools: ['colorGrading_strong', 'hsl_saturation_strong'],
    transferDifficulty: 'low',
    match: (s) => { let sc=0; const h=[];
      if (s.skinDetected) { sc+=0.25; h.push('skin present'); }
      if (s.moodTag==='balanced') { sc+=0.30; h.push('balanced mood — no strong stylisation'); }
      if (s.colorCast==='neutral') { sc+=0.20; h.push('neutral colour cast'); }
      if (s.contrastLevel==='medium') { sc+=0.15; h.push('natural (medium) contrast'); }
      if (s.category==='Portrait') { sc+=0.10; h.push('Portrait scene'); }
      return { score: sc, hits: h }; },
  },
  {
    name: 'Natural Documentary', priority: 0.85,
    description: 'Unposed, journalistic treatment with natural contrast and minimal colour styling.',
    characteristics: ['natural contrast', 'journalistic tone', 'minimal colour grading'],
    preferredTools: ['toneCurve', 'skinProtection'],
    avoidedTools: ['colorGrading_strong', 'calibration_strong'],
    transferDifficulty: 'low',
    match: (s) => { let sc=0; const h=[];
      if (s.styleTop==='Documentary' || s.styleTop==='Street') { sc+=0.40; h.push(`${s.styleTop} style recognition`); }
      if (s.contrastLevel==='medium') { sc+=0.25; h.push('natural (medium) contrast'); }
      if (s.moodTag==='balanced' || s.moodTag==='moody_dark') { sc+=0.20; h.push('unstylised tonal mood'); }
      if (s.paletteSat!=null && s.paletteSat<40) { sc+=0.15; h.push('restrained colour palette'); }
      return { score: sc, hits: h }; },
  },
  {
    name: 'Editorial Fashion', priority: 0.90,
    description: 'Deliberate, high-impact fashion treatment with bold contrast or a strongly controlled palette.',
    characteristics: ['bold contrast or controlled palette', 'deliberate colour styling', 'polished skin'],
    preferredTools: ['colorGrading', 'hsl', 'skinProtection'],
    avoidedTools: ['calibration_strong'],
    transferDifficulty: 'medium',
    match: (s) => { let sc=0; const h=[];
      if (s.styleTop==='Fashion') { sc+=0.40; h.push('Fashion style recognition'); }
      if (s.contrastLevel==='high') { sc+=0.25; h.push('bold contrast'); }
      if (s.paletteSat!=null && s.paletteSat>45) { sc+=0.20; h.push('deliberate, saturated palette'); }
      if (s.skinDetected) { sc+=0.15; h.push('skin present'); }
      return { score: sc, hits: h }; },
  },
  {
    name: 'Moody Cinematic', priority: 0.90,
    description: 'Dark, high-contrast, deliberately graded look with cinematic tonal separation.',
    characteristics: ['deep shadows', 'high contrast', 'deliberate colour grading', 'cinematic mood'],
    preferredTools: ['toneCurve', 'colorGrading', 'shadow_control'],
    avoidedTools: ['shadows_lifted_flat', 'exposure_brighten'],
    transferDifficulty: 'medium',
    match: (s) => { let sc=0; const h=[];
      if (s.moodTag==='moody_dark') { sc+=0.35; h.push('moody-dark mood'); }
      if (s.contrastLevel==='high') { sc+=0.30; h.push('high contrast'); }
      if (s.harmonyScheme==='Complementary' || s.harmonyScheme==='Split Complementary') { sc+=0.20; h.push(`${s.harmonyScheme} colour harmony (cinematic split-tone signature)`); }
      if (s.wbTransferRisk!=='low') { sc+=0.15; h.push('scene-dependent lighting adds cinematic mood'); }
      return { score: sc, hits: h }; },
  },
  {
    name: 'Dark Forest', priority: 0.90,
    description: 'Deep, moody green-dominant look — the darker counterpart to Green Pastel.',
    characteristics: ['deep green palette', 'low-key mood', 'rich shadow detail'],
    preferredTools: ['hsl_green_luminance', 'toneCurve', 'shadow_control'],
    avoidedTools: ['hsl_green_saturation_strong', 'exposure_brighten'],
    transferDifficulty: 'high',
    match: (s) => { let sc=0; const h=[];
      if (s.paletteHue!=null && s.paletteHue>=70 && s.paletteHue<=165) { sc+=0.35; h.push('green-dominant palette'); }
      if (s.moodTag==='moody_dark') { sc+=0.40; h.push('moody-dark mood (distinguishes from Green Pastel)'); }
      if (s.contrastLevel==='high' || s.contrastLevel==='medium') { sc+=0.15; h.push('defined contrast'); }
      return { score: sc, hits: h }; },
  },
  {
    name: 'Fine Art Portrait', priority: 0.85,
    description: 'Deliberate, colour-theory-driven portrait with artistic intent beyond a natural record.',
    characteristics: ['deliberate colour harmony', 'artistic contrast', 'considered composition mood'],
    preferredTools: ['colorGrading', 'hsl', 'toneCurve'],
    avoidedTools: ['calibration_strong'],
    transferDifficulty: 'medium',
    match: (s) => { let sc=0; const h=[];
      if (s.skinDetected) { sc+=0.20; h.push('skin present'); }
      if (s.harmonyScheme==='Triadic' || s.harmonyScheme==='Complementary') { sc+=0.35; h.push(`${s.harmonyScheme} colour harmony — deliberate colour theory`); }
      if (s.contrastLevel==='high') { sc+=0.25; h.push('artistic, elevated contrast'); }
      if (s.paletteSat!=null && s.paletteSat>40) { sc+=0.20; h.push('bold, considered palette'); }
      return { score: sc, hits: h }; },
  },
  {
    name: 'Soft Matte', priority: 0.75,
    description: 'General flat, matte tonal treatment without a specific colour direction.',
    characteristics: ['lifted blacks', 'flat tonal curve', 'muted overall palette'],
    preferredTools: ['toneCurve', 'colorGrading_subtle'],
    avoidedTools: ['blacks_deepen', 'contrast_strong'],
    transferDifficulty: 'medium',
    match: (s) => { let sc=0; const h=[];
      if (s.moodTag==='matte_shadow') { sc+=0.40; h.push('matte shadow character'); }
      if (s.contrastLevel==='low') { sc+=0.30; h.push('flat/low contrast'); }
      if (s.paletteSat!=null && s.paletteSat<30) { sc+=0.20; h.push('muted overall palette'); }
      if (!(s.paletteHue!=null && ((s.paletteHue>=70&&s.paletteHue<=165)||(s.paletteHue>=20&&s.paletteHue<=50)))) { sc+=0.10; h.push('no strong green/earth colour direction'); }
      return { score: sc, hits: h }; },
  },
  {
    name: 'Bright Lifestyle', priority: 0.80,
    description: 'Energetic, bright everyday look with lively (not muted) colour and an airy feel.',
    characteristics: ['bright exposure', 'lively colour', 'everyday/candid mood'],
    preferredTools: ['toneCurve', 'colorGrading', 'highlights'],
    avoidedTools: ['exposure_darken'],
    transferDifficulty: 'low',
    match: (s) => { let sc=0; const h=[];
      if (s.moodTag==='airy_bright') { sc+=0.35; h.push('airy/bright mood'); }
      if (s.paletteSat!=null && s.paletteSat>=30) { sc+=0.30; h.push('lively (not muted) colour — distinguishes from Muted Lifestyle'); }
      if (s.category==='Travel' || s.category==='General') { sc+=0.20; h.push(`${s.category} scene`); }
      if (s.warmthDir!=='cool') { sc+=0.15; h.push('warm/neutral warmth'); }
      return { score: sc, hits: h }; },
  },
  {
    name: 'Muted Lifestyle', priority: 0.75,
    description: 'Calm, understated everyday look with soft, desaturated colour.',
    characteristics: ['soft/balanced mood', 'desaturated colour', 'everyday candid tone'],
    preferredTools: ['toneCurve', 'colorGrading_subtle'],
    avoidedTools: ['hsl_saturation_strong', 'vibrance_strong'],
    transferDifficulty: 'low',
    match: (s) => { let sc=0; const h=[];
      if (s.moodTag==='balanced' || s.moodTag==='soft_highlight') { sc+=0.30; h.push('soft/balanced mood'); }
      if (s.paletteSat!=null && s.paletteSat<30) { sc+=0.35; h.push('desaturated colour'); }
      if (s.category==='Travel' || s.category==='General') { sc+=0.20; h.push(`${s.category} scene`); }
      if (s.contrastLevel!=='high') { sc+=0.15; h.push('gentle contrast'); }
      return { score: sc, hits: h }; },
  },
  {
    name: 'Warm Earth', priority: 0.80,
    description: 'General warm, earthy colour character without a specific film/matte signature.',
    characteristics: ['warm earthy palette', 'natural (non-matte) contrast'],
    preferredTools: ['colorGrading', 'calibration_subtle'],
    avoidedTools: ['wb_strong_warm'],
    transferDifficulty: 'medium',
    match: (s) => { let sc=0; const h=[];
      if (s.paletteHue!=null && s.paletteHue>=20 && s.paletteHue<=50) { sc+=0.40; h.push('warm/earthy dominant hue'); }
      if (s.warmthDir==='warm') { sc+=0.30; h.push('warm reference mood'); }
      if (s.moodTag!=='matte_shadow') { sc+=0.15; h.push('not matte (distinguishes from Brown Film)'); }
      if (s.colorCast==='warm') { sc+=0.15; h.push('warm colour cast'); }
      return { score: sc, hits: h }; },
  },
  {
    name: 'Korean Clean', priority: 0.85,
    description: 'Bright, minimal, very clean look with soft neutral-to-cool tones and gentle skin rendering.',
    characteristics: ['very clean palette', 'low saturation', 'bright/neutral tones', 'soft skin rendering'],
    preferredTools: ['skinProtection', 'toneCurve_soft', 'whites'],
    avoidedTools: ['hsl_saturation_strong', 'wb_strong_warm'],
    transferDifficulty: 'medium',
    match: (s) => { let sc=0; const h=[];
      if ((s.moodTag==='airy_bright' || s.moodTag==='balanced') && s.contrastLevel==='low') { sc+=0.30; h.push('bright, low-contrast tonal character'); }
      if (s.colorCast==='neutral' || s.colorCast==='cool') { sc+=0.25; h.push('neutral/cool colour cast'); }
      if (s.paletteSat!=null && s.paletteSat<25) { sc+=0.25; h.push('very clean, minimal saturation'); }
      if (s.skinDetected) { sc+=0.20; h.push('skin present (clean skin rendering)'); }
      return { score: sc, hits: h }; },
  },
  {
    name: 'Japanese Soft', priority: 0.85,
    description: 'Quiet, soft-toned look with muted, slightly cool-neutral colour and gentle contrast.',
    characteristics: ['soft muted tones', 'gentle contrast', 'quiet neutral-cool palette'],
    preferredTools: ['toneCurve_soft', 'colorGrading_subtle'],
    avoidedTools: ['hsl_saturation_strong', 'contrast_strong'],
    transferDifficulty: 'medium',
    match: (s) => { let sc=0; const h=[];
      if (s.moodTag==='soft_highlight' || s.contrastLevel==='low') { sc+=0.30; h.push('soft, low-contrast tonal character'); }
      if (s.colorCast==='neutral' || s.colorCast==='cool') { sc+=0.25; h.push('neutral/cool-leaning colour cast'); }
      if (s.paletteSat!=null && s.paletteSat<30) { sc+=0.25; h.push('muted palette'); }
      if (s.warmthDir!=='warm') { sc+=0.20; h.push('not warm (distinguishes from Warm Earth/Brown Film)'); }
      return { score: sc, hits: h }; },
  },
];

/**
 * Stage 2.4.2B: Style DNA Intelligence.
 *
 * Style DNA describes the abstract VISUAL INGREDIENTS that make a
 * photographer style look the way it does — it is explicitly NOT a
 * Lightroom preset, NOT sliders, NOT a budget, NOT XMP. It answers "why
 * does this look like Airy Wedding?" (soft highlight roll-off + lifted
 * whites + open shadows + clean skin + clean WB) BEFORE anything decides
 * how Lightroom should recreate it — Lightroom Mapping is untouched by
 * this stage entirely.
 *
 * DNA_ELEMENTS is a shared catalog of reusable "ingredients" (many styles
 * share elements like "Soft Contrast" or "Matte Blacks") — each with a
 * description, PREFERRED/AVOIDED LIGHTROOM TOOL CATEGORIES ONLY (never
 * slider values, per the spec), and a photographer-language reason.
 * STYLE_DNA_PROFILES then lists, per style, which elements apply and how
 * IMPORTANT each one is (0–1) to that style's identity.
 */
const DNA_ELEMENTS = {
  'Highlight Roll-off':      { description: 'Highlights fade gently toward white rather than clipping abruptly.', preferredLightroomTools: ['toneCurve', 'highlights'], avoidedLightroomTools: ['highlights_crush'], photographerReason: 'Gives bright areas a soft, airy transition instead of a hard edge.' },
  'White Lift':               { description: 'Whites sit slightly lifted rather than kept neutral-dark.', preferredLightroomTools: ['whites', 'toneCurve'], avoidedLightroomTools: ['blacks_deepen'], photographerReason: 'Creates the light, open feeling typical of bright editorial work.' },
  'Soft Contrast':            { description: 'Overall contrast stays gentle rather than punchy.', preferredLightroomTools: ['toneCurve', 'basicPanel_subtle'], avoidedLightroomTools: ['contrast_strong'], photographerReason: 'Keeps the tonal transition relaxed instead of graphic.' },
  'Open Shadows':             { description: 'Shadows retain visible detail rather than going dense/black.', preferredLightroomTools: ['shadows', 'toneCurve'], avoidedLightroomTools: ['blacks_deepen'], photographerReason: 'Preserves an airy, unobstructed feeling in darker areas.' },
  'Neutral Warm Skin':        { description: 'Skin reads warm but clean — never pushed toward orange or magenta.', preferredLightroomTools: ['skinProtection', 'calibration_subtle'], avoidedLightroomTools: ['hsl_orange_red_strong'], photographerReason: 'Keeps skin natural and flattering under bright, airy light.' },
  'Low Saturation Green':     { description: 'Green channel (foliage/background) is kept quiet rather than vivid.', preferredLightroomTools: ['hsl_green_luminance'], avoidedLightroomTools: ['hsl_green_saturation_strong'], photographerReason: 'Prevents background greenery from competing with the subject.' },
  'Clean White Balance':      { description: 'WB reads neutral-to-mildly-warm with no visible colour cast.', preferredLightroomTools: ['wb_mild'], avoidedLightroomTools: ['wb_strong_warm', 'wb_strong_cool'], photographerReason: 'A clean WB is the foundation of a light, trustworthy colour palette.' },
  'Brown Midtones':           { description: 'Midtones carry a warm brown/sepia character rather than neutral grey.', preferredLightroomTools: ['colorGrading', 'calibration_subtle'], avoidedLightroomTools: ['hsl_saturation_strong'], photographerReason: 'The signature warm-brown "film" tonal character lives in the midtones.' },
  'Warm Highlight':           { description: 'Highlights carry a warm (not clinical white) tint.', preferredLightroomTools: ['colorGrading'], avoidedLightroomTools: ['wb_strong_cool'], photographerReason: 'Reinforces the warm, nostalgic film feeling into the brightest tones.' },
  'Matte Blacks':             { description: 'Blacks are lifted rather than crushed to pure black.', preferredLightroomTools: ['toneCurve', 'blacks_lift'], avoidedLightroomTools: ['blacks_deepen'], photographerReason: 'The lifted, faded black point is the core signature of a matte/film look.' },
  'Muted Green':              { description: 'Green tones are desaturated toward olive/sage rather than vivid.', preferredLightroomTools: ['hsl_green_luminance', 'calibration_subtle'], avoidedLightroomTools: ['hsl_green_saturation_strong'], photographerReason: 'Keeps foliage from reading as a modern, punchy green.' },
  'Warm Skin':                { description: 'Skin reads warm and sun-kissed.', preferredLightroomTools: ['skinProtection', 'colorGrading'], avoidedLightroomTools: ['wb_strong_cool'], photographerReason: 'Warm skin tone supports the overall earthy/film mood.' },
  'Film Color Separation':    { description: 'Colour channels separate distinctly by tone (e.g. warm highlights, cool-leaning shadows) rather than moving uniformly.', preferredLightroomTools: ['colorGrading'], avoidedLightroomTools: ['calibration_strong'], photographerReason: 'Emulates how colour negative film renders shadows and highlights differently.' },
  'Bright Green Luminance':   { description: 'Green tones are brightened, not darkened, while saturation is reduced.', preferredLightroomTools: ['hsl_green_luminance'], avoidedLightroomTools: ['hsl_green_saturation_strong'], photographerReason: 'Bright, airy green luminance is what gives a pastel palette its lightness.' },
  'Reduced Green Saturation': { description: 'Green saturation is pulled down substantially from the raw reading.', preferredLightroomTools: ['hsl_green_luminance'], avoidedLightroomTools: ['hsl_green_saturation_strong', 'calibration_strong'], photographerReason: 'Vivid green would break the pastel character immediately.' },
  'Pastel Palette':           { description: 'Overall palette sits in soft, low-saturation pastel territory.', preferredLightroomTools: ['toneCurve', 'colorGrading_subtle'], avoidedLightroomTools: ['vibrance_strong', 'hsl_saturation_strong'], photographerReason: 'Pastel colour is the defining trait of the whole look.' },
  'Neutral WB':                { description: 'White balance reads close to neutral, no strong direction.', preferredLightroomTools: ['wb_mild'], avoidedLightroomTools: ['wb_strong_warm', 'wb_strong_cool'], photographerReason: 'A neutral base lets the pastel/muted colour grading carry the mood instead of WB.' },
  'Matte Curve':               { description: 'Tone curve is flattened — shadows lifted, highlights gently rolled off.', preferredLightroomTools: ['toneCurve'], avoidedLightroomTools: ['contrast_strong'], photographerReason: 'A flat curve is what makes a look read as "matte" rather than punchy.' },
  'Clean Whites':               { description: 'Whites are bright and free of any colour cast.', preferredLightroomTools: ['whites', 'wb_mild'], avoidedLightroomTools: ['wb_strong_warm', 'wb_strong_cool'], photographerReason: 'Clean whites read as polished and premium.' },
  'Cream Highlight':            { description: 'Highlights carry a subtle warm cream tint rather than stark white.', preferredLightroomTools: ['colorGrading'], avoidedLightroomTools: ['wb_strong_cool'], photographerReason: 'A cream highlight softens the look without sacrificing cleanliness.' },
  'Luxury Skin':                { description: 'Skin is smooth, even-toned, and free of harsh colour shifts.', preferredLightroomTools: ['skinProtection', 'calibration_subtle'], avoidedLightroomTools: ['hsl_orange_red_strong', 'calibration_strong'], photographerReason: 'Even, controlled skin tone is essential to a premium editorial feel.' },
  'Controlled Contrast':        { description: 'Contrast is deliberately shaped, neither flat nor harsh.', preferredLightroomTools: ['toneCurve', 'basicPanel_subtle'], avoidedLightroomTools: ['contrast_strong'], photographerReason: 'Controlled (not extreme) contrast reads as intentional and polished.' },
  'Elegant Color Separation':   { description: 'Shadow/midtone/highlight colours separate subtly rather than uniformly.', preferredLightroomTools: ['colorGrading'], avoidedLightroomTools: ['calibration_strong'], photographerReason: 'Subtle colour separation adds depth without looking stylised.' },
  'Natural Skin':                { description: 'Skin tone stays close to how it naturally appeared, minimal intervention.', preferredLightroomTools: ['skinProtection'], avoidedLightroomTools: ['hsl_orange_red_strong', 'calibration_strong'], photographerReason: 'An unforced, natural skin tone keeps the portrait honest.' },
  'Gentle Highlights':           { description: 'Highlights are softened slightly without full roll-off treatment.', preferredLightroomTools: ['highlights'], avoidedLightroomTools: ['highlights_crush'], photographerReason: 'A gentle highlight touch keeps the portrait soft without going fully airy.' },
  'Neutral Color Cast':          { description: 'No dominant colour cast across the image.', preferredLightroomTools: ['wb_mild'], avoidedLightroomTools: ['wb_strong_warm', 'wb_strong_cool'], photographerReason: 'A neutral cast keeps the portrait from reading as stylised.' },
  'Balanced Contrast':            { description: 'Contrast sits at a natural, medium level.', preferredLightroomTools: ['toneCurve'], avoidedLightroomTools: ['contrast_strong'], photographerReason: 'Balanced contrast avoids drawing attention to the editing itself.' },
  'Minimal Saturation Shift':     { description: 'Colour saturation stays close to the reference — little added or removed.', preferredLightroomTools: ['hsl'], avoidedLightroomTools: ['hsl_saturation_strong', 'vibrance_strong'], photographerReason: 'Minimal saturation change keeps a "clean" portrait honest to the scene.' },
  'Natural Contrast':             { description: 'Contrast follows the scene\'s own dynamic range rather than being stylised.', preferredLightroomTools: ['toneCurve'], avoidedLightroomTools: ['contrast_strong'], photographerReason: 'Natural contrast supports an unposed, journalistic feel.' },
  'Unfiltered Color':             { description: 'Colour is left close to how the camera captured it.', preferredLightroomTools: ['toneCurve'], avoidedLightroomTools: ['colorGrading_strong', 'hsl_saturation_strong'], photographerReason: 'Documentary work favours truthful colour over stylisation.' },
  'Journalistic Tone':            { description: 'Overall tone reads unposed and observational.', preferredLightroomTools: ['toneCurve'], avoidedLightroomTools: ['colorGrading_strong'], photographerReason: 'A journalistic tone avoids anything that calls attention to the edit.' },
  'Minimal Grading':               { description: 'Colour grading is applied sparingly if at all.', preferredLightroomTools: ['toneCurve'], avoidedLightroomTools: ['colorGrading_strong', 'calibration_strong'], photographerReason: 'Heavy grading would contradict the documentary intent.' },
  'Bold Contrast':                 { description: 'Contrast is pushed for graphic, high-impact tonal separation.', preferredLightroomTools: ['toneCurve', 'contrast'], avoidedLightroomTools: [], photographerReason: 'Bold contrast gives fashion imagery its graphic punch.' },
  'Deliberate Color Separation':   { description: 'Colours are intentionally pushed apart for stylised impact.', preferredLightroomTools: ['colorGrading', 'hsl'], avoidedLightroomTools: [], photographerReason: 'Deliberate colour separation is a hallmark of editorial styling.' },
  'Polished Skin':                 { description: 'Skin is smooth and evenly toned, styled rather than raw.', preferredLightroomTools: ['skinProtection', 'calibration_subtle'], avoidedLightroomTools: ['hsl_orange_red_strong'], photographerReason: 'Polished skin supports a high-production editorial feel.' },
  'Controlled Saturation':         { description: 'Saturation is deliberately set, neither muted nor oversaturated.', preferredLightroomTools: ['hsl', 'colorGrading'], avoidedLightroomTools: ['hsl_saturation_strong'], photographerReason: 'Controlled saturation supports a considered, art-directed palette.' },
  'Controlled Shadows':            { description: 'Shadows are shaped deliberately — neither crushed flat nor lifted open.', preferredLightroomTools: ['toneCurve', 'shadow_control'], avoidedLightroomTools: ['shadows_lifted_flat'], photographerReason: 'Deliberately controlled shadows carry cinematic mood.' },
  'Cinematic Color Grading':       { description: 'Shadow/highlight colour grading is used deliberately for mood.', preferredLightroomTools: ['colorGrading'], avoidedLightroomTools: [], photographerReason: 'Colour grading is the primary tool cinematic looks use to build mood.' },
  'Deep Contrast':                  { description: 'Contrast is pushed for a dramatic, high-impact tonal range.', preferredLightroomTools: ['toneCurve', 'contrast'], avoidedLightroomTools: ['shadows_lifted_flat'], photographerReason: 'Deep contrast reinforces the dramatic, cinematic mood.' },
  'Restrained Highlights':          { description: 'Highlights are kept controlled rather than bright/airy.', preferredLightroomTools: ['highlights'], avoidedLightroomTools: ['whites_lift_strong'], photographerReason: 'Restrained highlights keep the mood dark and cinematic instead of airy.' },
  'Deep Green Luminance':           { description: 'Green tones are darkened rather than brightened.', preferredLightroomTools: ['hsl_green_luminance', 'shadow_control'], avoidedLightroomTools: ['hsl_green_saturation_strong'], photographerReason: 'Deep green luminance gives foliage a moody, dense feeling.' },
  'Low-key Mood':                   { description: 'Overall exposure sits deliberately dark.', preferredLightroomTools: ['toneCurve', 'shadow_control'], avoidedLightroomTools: ['exposure_brighten'], photographerReason: 'Low-key exposure is the foundation of a dark, moody forest look.' },
  'Rich Shadow Detail':             { description: 'Shadows are dark but retain visible texture/detail.', preferredLightroomTools: ['shadows', 'toneCurve'], avoidedLightroomTools: ['blacks_deepen'], photographerReason: 'Detail in the shadows keeps a dark look from going murky.' },
  'Deliberate Color Harmony':       { description: 'Colours follow an intentional harmony scheme (complementary/triadic) rather than occurring naturally.', preferredLightroomTools: ['colorGrading', 'hsl'], avoidedLightroomTools: [], photographerReason: 'Deliberate colour harmony is what elevates a portrait to fine art.' },
  'Artistic Contrast':              { description: 'Contrast is shaped for artistic/dramatic effect rather than natural rendering.', preferredLightroomTools: ['toneCurve'], avoidedLightroomTools: [], photographerReason: 'Artistic contrast supports a considered, gallery-style presentation.' },
  'Considered Composition Mood':    { description: 'Overall tonal mood feels deliberate and composed rather than candid.', preferredLightroomTools: ['toneCurve', 'colorGrading'], avoidedLightroomTools: [], photographerReason: 'A composed mood signals artistic intent over documentation.' },
  'Bold Palette':                    { description: 'Colour palette is saturated and confidently used.', preferredLightroomTools: ['hsl', 'colorGrading'], avoidedLightroomTools: [], photographerReason: 'A bold palette supports strong artistic statement-making.' },
  'Flat Tonal Response':             { description: 'Tone curve is deliberately flattened across the range.', preferredLightroomTools: ['toneCurve'], avoidedLightroomTools: ['contrast_strong'], photographerReason: 'A flat response is the technical definition of a matte look.' },
  'Muted Palette':                   { description: 'Overall colour saturation is kept low.', preferredLightroomTools: ['colorGrading_subtle'], avoidedLightroomTools: ['hsl_saturation_strong', 'vibrance_strong'], photographerReason: 'Muted colour keeps the matte mood from feeling flat and lifeless.' },
  'Lifted Blacks':                   { description: 'Black point sits above true black.', preferredLightroomTools: ['blacks_lift', 'toneCurve'], avoidedLightroomTools: ['blacks_deepen'], photographerReason: 'Lifted blacks are the defining trait of a matte tonal curve.' },
  'Bright Exposure':                  { description: 'Overall exposure sits deliberately bright.', preferredLightroomTools: ['toneCurve', 'highlights'], avoidedLightroomTools: ['exposure_darken'], photographerReason: 'Bright exposure gives lifestyle imagery its energetic feel.' },
  'Lively Color':                     { description: 'Colour is saturated and energetic rather than muted.', preferredLightroomTools: ['hsl', 'vibrance'], avoidedLightroomTools: [], photographerReason: 'Lively colour supports an upbeat, everyday mood.' },
  'Candid Mood':                       { description: 'Overall tone feels unposed and spontaneous.', preferredLightroomTools: ['toneCurve'], avoidedLightroomTools: ['colorGrading_strong'], photographerReason: 'A candid mood keeps lifestyle imagery feeling authentic.' },
  'Open Highlights':                   { description: 'Highlights are kept bright and open rather than controlled.', preferredLightroomTools: ['highlights', 'whites'], avoidedLightroomTools: ['highlights_crush'], photographerReason: 'Open highlights reinforce the bright, energetic lifestyle feel.' },
  'Desaturated Palette':               { description: 'Colour saturation is pulled down across the board.', preferredLightroomTools: ['colorGrading_subtle'], avoidedLightroomTools: ['hsl_saturation_strong', 'vibrance_strong'], photographerReason: 'A desaturated palette supports a calm, understated mood.' },
  'Soft Mood':                          { description: 'Overall tonal character is gentle rather than punchy.', preferredLightroomTools: ['toneCurve'], avoidedLightroomTools: ['contrast_strong'], photographerReason: 'A soft mood keeps everyday imagery calm and understated.' },
  'Candid Tone':                        { description: 'Colour and tone stay close to how the scene naturally appeared.', preferredLightroomTools: ['toneCurve'], avoidedLightroomTools: ['colorGrading_strong'], photographerReason: 'A candid tone avoids over-styling everyday moments.' },
  'Warm Midtones':                      { description: 'Midtones lean warm rather than neutral.', preferredLightroomTools: ['colorGrading', 'wb_mild'], avoidedLightroomTools: ['wb_strong_cool'], photographerReason: 'Warm midtones are the foundation of an earthy colour character.' },
  'Earthy Palette':                     { description: 'Colour palette sits in warm browns/tans/ochres.', preferredLightroomTools: ['colorGrading', 'calibration_subtle'], avoidedLightroomTools: [], photographerReason: 'An earthy palette gives the image a grounded, natural feeling.' },
  'Soft Skin Glow':                     { description: 'Skin has a soft, luminous quality rather than flat rendering.', preferredLightroomTools: ['skinProtection', 'highlights'], avoidedLightroomTools: ['hsl_orange_red_strong'], photographerReason: 'A soft glow supports the clean, bright aesthetic.' },
  'Bright Neutral Tones':               { description: 'Overall tones are bright with no strong colour direction.', preferredLightroomTools: ['whites', 'wb_mild'], avoidedLightroomTools: ['wb_strong_warm', 'wb_strong_cool'], photographerReason: 'Bright neutral tones are central to a clean, minimal aesthetic.' },
  'Muted Neutral Palette':              { description: 'Colour is muted and leans neutral rather than warm or cool.', preferredLightroomTools: ['colorGrading_subtle'], avoidedLightroomTools: ['hsl_saturation_strong'], photographerReason: 'A muted neutral palette supports a quiet, understated mood.' },
  'Quiet Tonal Mood':                   { description: 'Overall tonal character feels calm and restrained.', preferredLightroomTools: ['toneCurve'], avoidedLightroomTools: ['contrast_strong'], photographerReason: 'A quiet tonal mood is central to a soft, contemplative aesthetic.' },
  'Cool-Neutral Cast':                  { description: 'A very slight cool lean sits within an otherwise neutral cast.', preferredLightroomTools: ['wb_mild'], avoidedLightroomTools: ['wb_strong_warm'], photographerReason: 'A cool-neutral cast supports a quiet, contemplative mood.' },
};

const STYLE_DNA_PROFILES = {
  'Airy Wedding': [
    { element: 'Highlight Roll-off', importance: 0.90 }, { element: 'White Lift', importance: 0.85 },
    { element: 'Soft Contrast', importance: 0.80 }, { element: 'Open Shadows', importance: 0.70 },
    { element: 'Neutral Warm Skin', importance: 0.75 }, { element: 'Low Saturation Green', importance: 0.50 },
    { element: 'Clean White Balance', importance: 0.60 },
  ],
  'Luxury Wedding': [
    { element: 'Clean Whites', importance: 0.90 }, { element: 'Cream Highlight', importance: 0.70 },
    { element: 'Luxury Skin', importance: 0.80 }, { element: 'Controlled Contrast', importance: 0.75 },
    { element: 'Elegant Color Separation', importance: 0.65 },
  ],
  'Brown Film': [
    { element: 'Brown Midtones', importance: 0.90 }, { element: 'Warm Highlight', importance: 0.70 },
    { element: 'Soft Contrast', importance: 0.60 }, { element: 'Matte Blacks', importance: 0.85 },
    { element: 'Muted Green', importance: 0.55 }, { element: 'Warm Skin', importance: 0.65 },
    { element: 'Film Color Separation', importance: 0.80 },
  ],
  'Green Pastel': [
    { element: 'Bright Green Luminance', importance: 0.90 }, { element: 'Reduced Green Saturation', importance: 0.85 },
    { element: 'Pastel Palette', importance: 0.80 }, { element: 'Neutral WB', importance: 0.60 },
    { element: 'Soft Contrast', importance: 0.70 }, { element: 'Matte Curve', importance: 0.55 },
  ],
  'Soft Portrait': [
    { element: 'Soft Contrast', importance: 0.80 }, { element: 'Natural Skin', importance: 0.85 },
    { element: 'Gentle Highlights', importance: 0.70 }, { element: 'Open Shadows', importance: 0.55 },
    { element: 'Neutral WB', importance: 0.50 },
  ],
  'Clean Portrait': [
    { element: 'Neutral Color Cast', importance: 0.85 }, { element: 'Balanced Contrast', importance: 0.80 },
    { element: 'Natural Skin', importance: 0.80 }, { element: 'Minimal Saturation Shift', importance: 0.70 },
  ],
  'Natural Documentary': [
    { element: 'Natural Contrast', importance: 0.85 }, { element: 'Unfiltered Color', importance: 0.80 },
    { element: 'Journalistic Tone', importance: 0.75 }, { element: 'Minimal Grading', importance: 0.70 },
  ],
  'Editorial Fashion': [
    { element: 'Bold Contrast', importance: 0.80 }, { element: 'Deliberate Color Separation', importance: 0.80 },
    { element: 'Polished Skin', importance: 0.70 }, { element: 'Controlled Saturation', importance: 0.65 },
  ],
  'Moody Cinematic': [
    { element: 'Controlled Shadows', importance: 0.85 }, { element: 'Cinematic Color Grading', importance: 0.85 },
    { element: 'Deep Contrast', importance: 0.80 }, { element: 'Restrained Highlights', importance: 0.65 },
  ],
  'Dark Forest': [
    { element: 'Deep Green Luminance', importance: 0.90 }, { element: 'Low-key Mood', importance: 0.85 },
    { element: 'Rich Shadow Detail', importance: 0.70 }, { element: 'Muted Green', importance: 0.55 },
    { element: 'Matte Blacks', importance: 0.50 },
  ],
  'Fine Art Portrait': [
    { element: 'Deliberate Color Harmony', importance: 0.85 }, { element: 'Artistic Contrast', importance: 0.75 },
    { element: 'Considered Composition Mood', importance: 0.65 }, { element: 'Bold Palette', importance: 0.60 },
  ],
  'Soft Matte': [
    { element: 'Matte Curve', importance: 0.85 }, { element: 'Flat Tonal Response', importance: 0.80 },
    { element: 'Muted Palette', importance: 0.70 }, { element: 'Lifted Blacks', importance: 0.75 },
  ],
  'Bright Lifestyle': [
    { element: 'Bright Exposure', importance: 0.85 }, { element: 'Lively Color', importance: 0.75 },
    { element: 'Candid Mood', importance: 0.65 }, { element: 'Open Highlights', importance: 0.65 },
  ],
  'Muted Lifestyle': [
    { element: 'Desaturated Palette', importance: 0.85 }, { element: 'Soft Mood', importance: 0.75 },
    { element: 'Candid Tone', importance: 0.65 }, { element: 'Soft Contrast', importance: 0.60 },
  ],
  'Warm Earth': [
    { element: 'Warm Midtones', importance: 0.85 }, { element: 'Earthy Palette', importance: 0.85 },
    { element: 'Natural Contrast', importance: 0.60 }, { element: 'Warm Skin', importance: 0.55 },
  ],
  'Korean Clean': [
    { element: 'Clean Whites', importance: 0.80 }, { element: 'Minimal Saturation Shift', importance: 0.75 },
    { element: 'Soft Skin Glow', importance: 0.80 }, { element: 'Bright Neutral Tones', importance: 0.70 },
  ],
  'Japanese Soft': [
    { element: 'Muted Neutral Palette', importance: 0.85 }, { element: 'Soft Contrast', importance: 0.75 },
    { element: 'Quiet Tonal Mood', importance: 0.70 }, { element: 'Cool-Neutral Cast', importance: 0.60 },
  ],
};

/** Fuzzy keyword overlap between a DNA element's name and the detection
 *  "hits" already produced by _classifyPhotographerStyle — used only to
 *  scale confidence, never to invent new detection. */
function _elementSupportedByHits(elementName, hits) {
  const words = elementName.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  const hitText = hits.join(' ').toLowerCase();
  return words.some(w => hitText.includes(w));
}

/**
 * Builds the Style DNA array for a given style name: each entry carries
 * importance (fixed per style, "how central is this ingredient"),
 * confidence (scaled by whether THIS image's actual detection hits
 * support the element, and by the style's own overall confidence — never
 * invented), description, tool categories, and a photographer reason.
 */
function _buildStyleDNA(styleName, hits, parentConfidence) {
  const profile = STYLE_DNA_PROFILES[styleName];
  if (!profile) return [];
  return profile.map(({ element, importance }) => {
    const meta = DNA_ELEMENTS[element] ?? {
      description: 'Visual ingredient contributing to this style.', preferredLightroomTools: [], avoidedLightroomTools: [], photographerReason: '',
    };
    const supported = _elementSupportedByHits(element, hits);
    const confidence = +clamp01(parentConfidence * (supported ? 1.0 : 0.6)).toFixed(3);
    return {
      name: element, importance: +importance.toFixed(2), confidence,
      description: meta.description,
      preferredLightroomTools: meta.preferredLightroomTools,
      avoidedLightroomTools: meta.avoidedLightroomTools,
      photographerReason: meta.photographerReason,
    };
  });
}

/**
 * Stage 2.4.2B.1: Style DNA Validation.
 *
 * DNA is hand-curated (STYLE_DNA_PROFILES above) and therefore consistent
 * BY CONSTRUCTION for every style this codebase ships — but the spec asks
 * for a genuine, reusable validation mechanism (not a rubber stamp), both
 * to catch any future profile edits that introduce a contradiction and to
 * demonstrate the exact invalid combinations named in the spec (e.g.
 * "Airy Wedding with Heavy Contrast") actually get flagged when present.
 *
 * STYLE_DNA_RULES lists, per style, which elements are REQUIRED (the
 * style's identity depends on them) and which are FORBIDDEN (their
 * presence would contradict the style's definition) — covering every
 * example named in the spec's Task 2. Styles without an explicit rule
 * set still get the GENERIC checks (duplicates, missing high-importance
 * element, confidence mismatch, tool contradiction).
 */
const STYLE_DNA_RULES = {
  'Airy Wedding':      { required: ['Highlight Roll-off', 'Clean White Balance'], forbidden: ['Heavy Contrast', 'Crushed Blacks', 'Neon Saturation', 'Matte Blacks'] },
  'Brown Film':         { required: ['Warm Highlight', 'Muted Green', 'Matte Blacks', 'Film Color Separation'], forbidden: ['Clean Blue Highlights', 'Cool White Balance'] },
  'Green Pastel':       { required: ['Bright Green Luminance', 'Reduced Green Saturation', 'Pastel Palette'], forbidden: ['High Green Saturation', 'Heavy Contrast'] },
  'Luxury Wedding':     { required: ['Clean Whites', 'Cream Highlight', 'Controlled Contrast', 'Luxury Skin'], forbidden: ['Harsh Skin', 'Dirty Whites', 'Aggressive Calibration'] },
  'Soft Portrait':      { required: ['Soft Contrast', 'Natural Skin', 'Gentle Highlights'], forbidden: ['Harsh Clarity', 'Heavy Blacks', 'Extreme Color Shift'] },
  'Moody Cinematic':    { required: ['Controlled Shadows', 'Cinematic Color Grading'], forbidden: ['Airy High-key Whites'] },
  'Fine Art Portrait':  { required: ['Deliberate Color Harmony'], forbidden: ['Neon HSL'] },
  'Clean Portrait':     { required: ['Neutral Color Cast'], forbidden: ['Heavy Matte Blacks'] },
};

/** Coarse "how hard is this DNA to reproduce elsewhere" signal, used only
 *  to sanity-check the style's own declared transferDifficulty — a style
 *  whose DNA is dominated by scene-specific ingredients (colour-family
 *  elements, film separation) but claims "low" transfer difficulty is an
 *  internal inconsistency worth flagging. */
const HARD_TO_TRANSFER_ELEMENTS = new Set([
  'Film Color Separation', 'Muted Green', 'Bright Green Luminance', 'Reduced Green Saturation',
  'Deep Green Luminance', 'Brown Midtones', 'Warm Highlight', 'Cinematic Color Grading', 'Earthy Palette',
]);

function _validateStyleDNA(styleName, dna, declaredTransferDifficulty) {
  const issues = [], warnings = [], corrections = [], reasons = [];
  const names = dna.map(d => d.name);
  const rules = STYLE_DNA_RULES[styleName];

  // ── Generic checks (apply to every style) ─────────────────────────────
  const seen = new Set(), dupes = new Set();
  for (const n of names) { if (seen.has(n)) dupes.add(n); seen.add(n); }
  if (dupes.size) {
    issues.push(`Duplicated DNA element(s): ${[...dupes].join(', ')}.`);
    corrections.push(`Remove the duplicate ${[...dupes].join(', ')} entr${dupes.size > 1 ? 'ies' : 'y'}.`);
  }

  if (!dna.some(d => d.importance > 0.7)) {
    issues.push('No high-importance DNA element found — this style\'s identity may be underspecified.');
    corrections.push(`Add or raise the importance of a defining element for "${styleName}".`);
  }

  for (const d of dna) {
    if (d.importance > 0.7 && d.confidence < 0.3) {
      warnings.push(`"${d.name}" is a high-importance ingredient (${d.importance}) but scored low confidence (${d.confidence}) this run — the reference may not actually show it strongly.`);
    }
  }

  const preferredTools = new Set(dna.flatMap(d => d.preferredLightroomTools ?? []));
  const avoidedTools = new Set(dna.flatMap(d => d.avoidedLightroomTools ?? []));
  const conflictTools = [...preferredTools].filter(t => avoidedTools.has(t));
  if (conflictTools.length) {
    issues.push(`Tool contradiction: ${conflictTools.join(', ')} appear as both preferred and avoided across this style's own DNA elements.`);
    corrections.push(`Resolve conflicting tool guidance on ${conflictTools.join(', ')} within "${styleName}" DNA.`);
  }

  // ── Style-specific required/forbidden rules ───────────────────────────
  if (rules) {
    for (const req of rules.required) {
      if (!names.includes(req)) {
        issues.push(`Missing expected DNA element "${req}" for "${styleName}".`);
        corrections.push(`Add "${req}" to ${styleName} DNA.`);
      }
    }
    for (const forb of rules.forbidden) {
      if (names.includes(forb)) {
        issues.push(`Impossible combination: "${styleName}" should not include "${forb}".`);
        corrections.push(`Remove "${forb}" from ${styleName} DNA.`);
      }
    }
  }

  // ── transferDifficulty mismatch ───────────────────────────────────────
  const hardCount = dna.filter(d => HARD_TO_TRANSFER_ELEMENTS.has(d.name)).length;
  if (declaredTransferDifficulty === 'low' && hardCount >= 2) {
    warnings.push(`Declared transfer difficulty "low" seems inconsistent with ${hardCount} scene-dependent DNA element(s) (e.g. colour-family/film ingredients).`);
  }
  if (declaredTransferDifficulty === 'high' && hardCount === 0) {
    warnings.push(`Declared transfer difficulty "high" has no scene-dependent DNA element backing it up — may be overstated.`);
  }

  const totalChecks = 4 + (rules ? rules.required.length + rules.forbidden.length : 0);
  const score = +clamp01(1 - issues.length / Math.max(1, totalChecks)).toFixed(3);
  const isValid = issues.length === 0;
  reasons.push(`"${styleName}" DNA checked against ${totalChecks} rule(s): ${issues.length} issue(s), ${warnings.length} warning(s).`);

  return { isValid, score, issues, warnings, corrections, reasons };
}

/**
 * Stage 2.4.2B Task 3: Alternative Style Distance.
 * Reuses the DNA just built (Task 1) instead of any new pixel comparison
 * or duplicating style-recognition-engine logic — distance is purely a
 * function of how much two styles' DNA element sets overlap, weighted by
 * importance (a shared, high-importance element counts more than a minor
 * one). 0 = identical DNA, 1 = no shared ingredients at all.
 */
function _computeStyleDistance(dnaA, dnaB) {
  if (!dnaA?.length || !dnaB?.length) return 1.0;
  const mapA = new Map(dnaA.map(d => [d.name, d.importance]));
  const mapB = new Map(dnaB.map(d => [d.name, d.importance]));
  const allNames = new Set([...mapA.keys(), ...mapB.keys()]);
  let sharedWeight = 0, totalWeight = 0;
  for (const name of allNames) {
    const a = mapA.get(name) ?? 0, b = mapB.get(name) ?? 0;
    sharedWeight += Math.min(a, b);
    totalWeight += Math.max(a, b);
  }
  const similarity = totalWeight > 0 ? sharedWeight / totalWeight : 0;
  return +(1 - similarity).toFixed(3);
}


/**
 * EPIC 1.3: compares Reference Color Intelligence's independently-computed
 * styleHints (colour evidence only) against the style Photographer
 * Intelligence already detected (via full Style Fingerprint/Feature Graph
 * analysis). Produces a plain-language corroboration note either way —
 * never a score, never something that feeds back into confidence, DNA,
 * validation, or feasibility. Absence of support is reported honestly,
 * not hidden, but is explicitly framed as "not the deciding signal here,"
 * never as a mark against the detected style.
 */
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * EPIC 1.4 — Photographer Intent Intelligence
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Answers a DIFFERENT question from photographerStyle. Style is a LOOK
 * CATEGORY ("Luxury Wedding," "Brown Film" — what named look is this?).
 * Intent is the CREATIVE/EMOTIONAL DIRECTION behind it ("Premium,"
 * "Dreamy" — what feeling is the photographer going for?). The same
 * style can carry different intents (a Luxury Wedding photo could read
 * as "Premium" or as "Romantic"), so this is deliberately a separate
 * classification, not a renaming of style.
 *
 * Uses ONLY signals already computed elsewhere in this file
 * (finalStyleIntent.photographerStyle, Style DNA Validation,
 * styleFeasibilityEstimate, the same fingerprint/graph/wbIntent signals
 * _buildStyleSignals already reads, plus the optional
 * referenceColorIntelligence from EPIC 1.3) — no new image analysis.
 */
function _buildIntentSignals({ fingerprint, graph, category, hasSkin, skinConfidence, wbIntent, photographerStyle, styleFeasibilityEstimate, referenceColorIntelligence, overallConf }) {
  return {
    moodTag: fingerprint.mood, warmthDir: fingerprint.warmth, colorCast: fingerprint.colorCast,
    contrastLevel: graph?.contrastIntent?.level ?? fingerprint.contrastLevel,
    paletteHue: graph?.paletteIntent?.dominantHue ?? null,
    paletteSat: graph?.paletteIntent?.avgSat ?? null,
    harmonyScheme: graph?.harmonyIntent?.scheme ?? null,
    skinDetected: hasSkin, skinConfidence: skinConfidence ?? 0.5,
    wbTransferRisk: wbIntent?.transferRisk ?? 'low', wbDirection: wbIntent?.moodWarmth?.direction ?? 'neutral',
    category, styleTop: fingerprint.styleRecognitionTop, overallConf,
    styleName: photographerStyle?.top?.styleName ?? null,
    styleFamily: photographerStyle?.top ? STYLE_PROFILES.find(p => p.name === photographerStyle.top.styleName)?.priority : null,
    dnaValidationScore: photographerStyle?.top?.styleDNAValidation?.score ?? 0.7,
    feasibilityLevel: styleFeasibilityEstimate?.level ?? 'medium',
    refColorMood: referenceColorIntelligence?.colorMood ?? null,
    refPaletteSummary: referenceColorIntelligence?.paletteSignature?.summary ?? null,
  };
}

/**
 * 19-intent declarative table — same "signals object + match()" pattern
 * as STYLE_PROFILES above. Each intent additionally carries the static
 * descriptive fields Task 1/3 require (description, visual/emotional
 * direction, preferred/conflicting cues, DNA relationship, feasibility
 * notes) — these don't vary per image, only `match()`'s score does.
 */
const INTENT_PROFILES = [
  { name: 'Dreamy', intentFamily: 'soft-emotional',
    description: 'A gentle, romantic, airy feeling — softness over sharpness.',
    emotionalDirection: 'gentle, romantic, airy', visualDirection: 'soft highlights, clean whites, low contrast, warm-neutral skin',
    preferredCues: ['soft contrast', 'airy highlights', 'warm-neutral skin'], conflictingCues: ['heavy contrast', 'crushed blacks'],
    styleDNARelationship: 'Aligns with DNA ingredients like "Soft Contrast," "Highlight Roll-off."', feasibilityNotes: 'Usually easy to transfer — mostly global tone/WB work.',
    match: (s) => { let sc=0; const hits=[];
      if (s.moodTag==='airy_bright') { sc+=0.3; hits.push({source:'Style Fingerprint', signal:'airy/bright mood', weight:0.3, reason:'Airy mood supports a dreamy feel.'}); }
      if (s.contrastLevel==='low') { sc+=0.25; hits.push({source:'Style Feature Graph', signal:'low contrast', weight:0.25, reason:'Soft contrast is central to a dreamy read.'}); }
      if (s.skinDetected && s.warmthDir!=='cool') { sc+=0.2; hits.push({source:'Skin Analysis', signal:'warm-neutral skin', weight:0.2, reason:'Warm skin tone supports gentleness.'}); }
      if (['Airy Wedding','Soft Portrait','Japanese Soft'].includes(s.styleName)) { sc+=0.25; hits.push({source:'Photographer Style', signal:s.styleName, weight:0.25, reason:'Detected style commonly carries a dreamy intent.'}); }
      return { score: sc, hits }; } },

  { name: 'Premium', intentFamily: 'luxury-clean',
    description: 'Elegant, polished, refined — a high-end, considered feel.',
    emotionalDirection: 'elegant, polished, refined', visualDirection: 'cream highlights, clean skin, controlled contrast, muted distractions',
    preferredCues: ['clean whites', 'controlled contrast', 'muted saturation'], conflictingCues: ['harsh skin', 'dirty whites'],
    styleDNARelationship: 'Aligns with "Clean Whites," "Cream Highlight," "Controlled Contrast," "Luxury Skin."', feasibilityNotes: 'Moderate — depends on clean skin/whites transferring reliably.',
    match: (s) => { let sc=0; const hits=[];
      if (['Luxury Wedding','Editorial Fashion','Fine Art Portrait'].includes(s.styleName)) { sc+=0.3; hits.push({source:'Photographer Style', signal:s.styleName, weight:0.3, reason:'This style commonly signals a premium intent.'}); }
      if (s.contrastLevel!=='low' && s.contrastLevel!=='high') { sc+=0.2; hits.push({source:'Style Feature Graph', signal:'controlled (moderate) contrast', weight:0.2, reason:'Neither flat nor harsh contrast reads as considered/polished.'}); }
      if (s.paletteSat!=null && s.paletteSat<35) { sc+=0.2; hits.push({source:'Colour Analysis', signal:'muted palette saturation', weight:0.2, reason:'Restrained colour supports a refined feel.'}); }
      if (s.skinDetected && s.skinConfidence>0.6) { sc+=0.15; hits.push({source:'Skin Analysis', signal:'clean, well-detected skin', weight:0.15, reason:'Clean skin rendering is central to premium portraiture.'}); }
      if (s.refColorMood==='Warm Luxury' || s.refColorMood==='Luxury Wedding') { sc+=0.25; hits.push({source:'Reference Color Intelligence', signal:s.refPaletteSummary ?? s.refColorMood, weight:0.25, reason:`Colour evidence ("${s.refColorMood}") independently supports a premium/luxury intent.`}); }
      return { score: sc, hits }; } },

  { name: 'Clean', intentFamily: 'minimal-neutral',
    description: 'Unfussy, neutral, no visible colour cast or stylisation.',
    emotionalDirection: 'fresh, honest, uncomplicated', visualDirection: 'neutral colour cast, balanced exposure, minimal grading',
    preferredCues: ['neutral colour cast', 'balanced contrast'], conflictingCues: ['strong colour cast', 'heavy grading'],
    styleDNARelationship: 'Aligns with "Neutral Color Cast," "Balanced Contrast," "Minimal Saturation Shift."', feasibilityNotes: 'Usually easy — a neutral, unstylised look transfers reliably.',
    match: (s) => { let sc=0; const hits=[];
      if (s.colorCast==='neutral') { sc+=0.35; hits.push({source:'Style Fingerprint', signal:'neutral colour cast', weight:0.35, reason:'No visible cast is the core of a clean read.'}); }
      if (s.contrastLevel==='medium') { sc+=0.2; hits.push({source:'Style Feature Graph', signal:'balanced contrast', weight:0.2, reason:'Natural contrast avoids stylisation.'}); }
      if (['Clean Portrait','Korean Clean'].includes(s.styleName)) { sc+=0.3; hits.push({source:'Photographer Style', signal:s.styleName, weight:0.3, reason:'Detected style is defined by cleanliness.'}); }
      if (s.paletteSat!=null && s.paletteSat<25) { sc+=0.15; hits.push({source:'Colour Analysis', signal:'low overall saturation', weight:0.15, reason:'Minimal colour intensity supports an unfussy read.'}); }
      return { score: sc, hits }; } },

  { name: 'Editorial', intentFamily: 'fashion-directed',
    description: 'Bold, intentional, styled — a deliberate, graphic statement.',
    emotionalDirection: 'bold, intentional, styled', visualDirection: 'strong contrast, controlled colour separation, graphic mood',
    preferredCues: ['bold contrast', 'deliberate colour separation'], conflictingCues: ['very low confidence', 'washed out palette'],
    styleDNARelationship: 'Aligns with "Bold Contrast," "Deliberate Colour Separation," "Polished Skin."', feasibilityNotes: 'Can be harder to transfer — deliberate styling may rely on scene-specific choices.',
    match: (s) => { let sc=0; const hits=[];
      if (['Editorial Fashion','Fine Art Portrait'].includes(s.styleName)) { sc+=0.35; hits.push({source:'Photographer Style', signal:s.styleName, weight:0.35, reason:'Detected style is inherently editorial.'}); }
      if (s.contrastLevel==='high') { sc+=0.25; hits.push({source:'Style Feature Graph', signal:'high contrast', weight:0.25, reason:'Bold contrast is a hallmark of editorial work.'}); }
      if (s.paletteSat!=null && s.paletteSat>45) { sc+=0.2; hits.push({source:'Colour Analysis', signal:'deliberate, saturated palette', weight:0.2, reason:'Confident colour use supports a styled, directed feel.'}); }
      if (s.styleTop==='Fashion') { sc+=0.2; hits.push({source:'Style Recognition', signal:'Fashion', weight:0.2, reason:'Independent style-recognition agreement.'}); }
      return { score: sc, hits }; } },

  { name: 'Natural', intentFamily: 'documentary-honest',
    description: 'Unposed, true-to-scene, minimal intervention.',
    emotionalDirection: 'honest, unforced, real', visualDirection: 'natural contrast, unfiltered colour, minimal grading',
    preferredCues: ['natural contrast', 'unfiltered colour'], conflictingCues: ['extreme colour grading'],
    styleDNARelationship: 'Aligns with "Natural Contrast," "Unfiltered Colour," "Minimal Grading."', feasibilityNotes: 'Usually easy — natural looks are inherently global-preset-friendly.',
    match: (s) => { let sc=0; const hits=[];
      if (['Natural Documentary','Clean Portrait'].includes(s.styleName)) { sc+=0.3; hits.push({source:'Photographer Style', signal:s.styleName, weight:0.3, reason:'Detected style favours an unforced read.'}); }
      if (s.contrastLevel==='medium') { sc+=0.2; hits.push({source:'Style Feature Graph', signal:'natural (medium) contrast', weight:0.2, reason:'Unstylised contrast supports honesty.'}); }
      if (s.paletteSat!=null && s.paletteSat<40 && s.paletteSat>15) { sc+=0.2; hits.push({source:'Colour Analysis', signal:'moderate, restrained palette', weight:0.2, reason:'Colour that isn\'t pushed either way reads as truthful.'}); }
      if (s.styleTop==='Documentary' || s.styleTop==='Street') { sc+=0.25; hits.push({source:'Style Recognition', signal:s.styleTop, weight:0.25, reason:'Independent style-recognition agreement.'}); }
      return { score: sc, hits }; } },

  { name: 'Emotional', intentFamily: 'soft-emotional',
    description: 'Warm, intimate, feeling-led rather than technically perfect.',
    emotionalDirection: 'intimate, tender, felt', visualDirection: 'warm tones, soft or moody light, skin-forward',
    preferredCues: ['warm tones', 'skin-forward composition'], conflictingCues: ['cold, clinical colour'],
    styleDNARelationship: 'Aligns with "Neutral Warm Skin," "Warm Skin," soft or moody Colour Grading.', feasibilityNotes: 'Moderate — depends on how the warmth/mood was built.',
    match: (s) => { let sc=0; const hits=[];
      if (s.skinDetected && s.skinConfidence>0.5) { sc+=0.3; hits.push({source:'Skin Analysis', signal:'skin present, well-detected', weight:0.3, reason:'A feeling-led image is usually people-centred.'}); }
      if (s.warmthDir==='warm') { sc+=0.25; hits.push({source:'Style Fingerprint', signal:'warm reference mood', weight:0.25, reason:'Warmth supports intimacy.'}); }
      if (s.moodTag==='soft_highlight' || s.moodTag==='moody_dark') { sc+=0.2; hits.push({source:'Style Fingerprint', signal:s.moodTag, weight:0.2, reason:'Soft or moody light supports emotional weight.'}); }
      return { score: sc, hits }; } },

  { name: 'Minimal', intentFamily: 'minimal-neutral',
    description: 'Restrained, quiet, few competing visual elements.',
    emotionalDirection: 'calm, uncluttered, quiet', visualDirection: 'low saturation, single dominant hue family, gentle contrast',
    preferredCues: ['low saturation', 'single hue family'], conflictingCues: ['many competing colours'],
    styleDNARelationship: 'Aligns with "Muted Neutral Palette," "Quiet Tonal Mood."', feasibilityNotes: 'Usually easy — few elements to reproduce.',
    match: (s) => { let sc=0; const hits=[];
      if (s.paletteSat!=null && s.paletteSat<22) { sc+=0.35; hits.push({source:'Colour Analysis', signal:'very low saturation', weight:0.35, reason:'Restraint in colour is the core of minimalism.'}); }
      if (['Soft Matte','Korean Clean','Japanese Soft'].includes(s.styleName)) { sc+=0.3; hits.push({source:'Photographer Style', signal:s.styleName, weight:0.3, reason:'Detected style is inherently minimal.'}); }
      if (s.contrastLevel!=='high') { sc+=0.15; hits.push({source:'Style Feature Graph', signal:'gentle contrast', weight:0.15, reason:'Restrained contrast avoids visual noise.'}); }
      return { score: sc, hits }; } },

  { name: 'Romantic', intentFamily: 'soft-emotional',
    description: 'Warm, tender, softly lit — love-story visual language.',
    emotionalDirection: 'tender, warm, nostalgic', visualDirection: 'warm skin, soft highlights, gentle contrast',
    preferredCues: ['warm skin', 'soft highlights'], conflictingCues: ['cold cast', 'harsh contrast'],
    styleDNARelationship: 'Aligns with "Neutral Warm Skin," "Highlight Roll-off," "Soft Contrast."', feasibilityNotes: 'Usually easy — mostly global WB/tone work.',
    match: (s) => { let sc=0; const hits=[];
      if (['Airy Wedding','Luxury Wedding','Soft Portrait'].includes(s.styleName)) { sc+=0.3; hits.push({source:'Photographer Style', signal:s.styleName, weight:0.3, reason:'Wedding/soft-portrait styles commonly carry romantic intent.'}); }
      if (s.warmthDir==='warm' && s.skinDetected) { sc+=0.3; hits.push({source:'Skin + WB', signal:'warm skin tone', weight:0.3, reason:'Warm skin is central to a romantic feel.'}); }
      if (s.contrastLevel!=='high') { sc+=0.2; hits.push({source:'Style Feature Graph', signal:'gentle contrast', weight:0.2, reason:'Softness supports tenderness.'}); }
      return { score: sc, hits }; } },

  { name: 'Cinematic', intentFamily: 'dramatic-directed',
    description: 'Dramatic, deliberate, film-like tonal separation.',
    emotionalDirection: 'dramatic, moody, directed', visualDirection: 'deep shadows, deliberate colour grading, controlled highlights',
    preferredCues: ['deep shadows', 'deliberate grading'], conflictingCues: ['bright airy whites'],
    styleDNARelationship: 'Aligns with "Controlled Shadows," "Cinematic Colour Grading," "Deep Contrast."', feasibilityNotes: 'Moderate — colour grading transfers well, exact mood depends on scene lighting.',
    match: (s) => { let sc=0; const hits=[];
      if (s.styleName==='Moody Cinematic') { sc+=0.35; hits.push({source:'Photographer Style', signal:s.styleName, weight:0.35, reason:'Directly matches the detected style.'}); }
      if (s.moodTag==='moody_dark') { sc+=0.25; hits.push({source:'Style Fingerprint', signal:'moody-dark mood', weight:0.25, reason:'Dark mood supports drama.'}); }
      if (s.contrastLevel==='high') { sc+=0.2; hits.push({source:'Style Feature Graph', signal:'high contrast', weight:0.2, reason:'Strong contrast supports a directed, dramatic look.'}); }
      if (s.harmonyScheme==='Complementary' || s.harmonyScheme==='Split Complementary') { sc+=0.2; hits.push({source:'Colour Harmony', signal:s.harmonyScheme, weight:0.2, reason:'Deliberate colour harmony supports cinematic grading.'}); }
      return { score: sc, hits }; } },

  { name: 'Bold', intentFamily: 'dramatic-directed',
    description: 'Confident, vivid, unafraid of strong colour or contrast.',
    emotionalDirection: 'confident, energetic, striking', visualDirection: 'vivid saturation, strong contrast',
    preferredCues: ['vivid saturation', 'strong contrast'], conflictingCues: ['muted, quiet palette'],
    styleDNARelationship: 'Aligns with "Bold Palette," "Controlled Saturation."', feasibilityNotes: 'Moderate — vivid colour can be harder to keep safe within Lightroom limits.',
    match: (s) => { let sc=0; const hits=[];
      if (s.paletteSat!=null && s.paletteSat>55) { sc+=0.35; hits.push({source:'Colour Analysis', signal:'vivid palette saturation', weight:0.35, reason:'Strong colour is the core of a bold read.'}); }
      if (s.contrastLevel==='high') { sc+=0.3; hits.push({source:'Style Feature Graph', signal:'high contrast', weight:0.3, reason:'Strong contrast reinforces confidence.'}); }
      if (['Editorial Fashion','Fine Art Portrait'].includes(s.styleName)) { sc+=0.2; hits.push({source:'Photographer Style', signal:s.styleName, weight:0.2, reason:'These styles often carry a bold intent.'}); }
      return { score: sc, hits }; } },

  { name: 'Muted', intentFamily: 'minimal-neutral',
    description: 'Deliberately desaturated, quiet colour throughout.',
    emotionalDirection: 'calm, subdued, understated', visualDirection: 'desaturated palette, gentle tonal contrast',
    preferredCues: ['desaturated colour'], conflictingCues: ['vivid colour'],
    styleDNARelationship: 'Aligns with "Desaturated Palette," "Muted Palette."', feasibilityNotes: 'Usually easy — desaturation is simple global work.',
    match: (s) => { let sc=0; const hits=[];
      if (s.paletteSat!=null && s.paletteSat<28) { sc+=0.4; hits.push({source:'Colour Analysis', signal:'desaturated palette', weight:0.4, reason:'Low saturation defines a muted read.'}); }
      if (['Muted Lifestyle','Brown Film','Soft Matte'].includes(s.styleName)) { sc+=0.3; hits.push({source:'Photographer Style', signal:s.styleName, weight:0.3, reason:'Detected style is inherently muted.'}); }
      if (s.refColorMood==='Muted Film') { sc+=0.2; hits.push({source:'Reference Color Intelligence', signal:s.refColorMood, weight:0.2, reason:'Independent colour evidence agrees.'}); }
      return { score: sc, hits }; } },

  { name: 'Warm', intentFamily: 'temperature-directed',
    description: 'Strongly warm colour temperature throughout.',
    emotionalDirection: 'cosy, inviting, sun-touched', visualDirection: 'warm white balance, golden/brown colour direction',
    preferredCues: ['warm white balance'], conflictingCues: ['cool cast'],
    styleDNARelationship: 'Aligns with "Warm Midtones," "Warm Highlight," "Warm Skin."', feasibilityNotes: 'Usually easy — primarily a WB/Colour Grading transfer.',
    match: (s) => { let sc=0; const hits=[];
      if (s.warmthDir==='warm') { sc+=0.4; hits.push({source:'Style Fingerprint', signal:'warm reference mood', weight:0.4, reason:'Directly defines a warm intent.'}); }
      if (s.wbDirection==='warm') { sc+=0.25; hits.push({source:'White Balance Intent', signal:'warm direction', weight:0.25, reason:'WB reading confirms warmth.'}); }
      if (['Brown Film','Warm Earth'].includes(s.styleName)) { sc+=0.25; hits.push({source:'Photographer Style', signal:s.styleName, weight:0.25, reason:'Detected style is warm by definition.'}); }
      return { score: sc, hits }; } },

  { name: 'Soft', intentFamily: 'soft-emotional',
    description: 'Gentle tonal transitions, nothing harsh or abrupt.',
    emotionalDirection: 'gentle, easy, unforced', visualDirection: 'low contrast, gentle highlight/shadow roll-off',
    preferredCues: ['low contrast', 'gentle roll-off'], conflictingCues: ['harsh clarity', 'heavy blacks'],
    styleDNARelationship: 'Aligns with "Soft Contrast," "Gentle Highlights."', feasibilityNotes: 'Usually easy — global tone work.',
    match: (s) => { let sc=0; const hits=[];
      if (s.contrastLevel==='low') { sc+=0.35; hits.push({source:'Style Feature Graph', signal:'low contrast', weight:0.35, reason:'Gentleness is defined by soft contrast.'}); }
      if (s.moodTag==='soft_highlight') { sc+=0.3; hits.push({source:'Style Fingerprint', signal:'soft-highlight mood', weight:0.3, reason:'Soft highlight handling reinforces the read.'}); }
      if (['Soft Portrait','Japanese Soft'].includes(s.styleName)) { sc+=0.25; hits.push({source:'Photographer Style', signal:s.styleName, weight:0.25, reason:'Detected style is defined by softness.'}); }
      return { score: sc, hits }; } },

  { name: 'Classic', intentFamily: 'timeless-balanced',
    description: 'Timeless, balanced, not tied to a current trend.',
    emotionalDirection: 'timeless, dependable, composed', visualDirection: 'neutral cast, moderate contrast, moderate saturation',
    preferredCues: ['neutral cast', 'moderate everything'], conflictingCues: ['trend-heavy stylisation'],
    styleDNARelationship: 'Aligns with "Balanced Contrast," "Neutral Color Cast."', feasibilityNotes: 'Usually easy — a balanced look transfers reliably.',
    match: (s) => { let sc=0; const hits=[];
      if (s.contrastLevel==='medium' && s.colorCast==='neutral') { sc+=0.35; hits.push({source:'Style Feature Graph', signal:'neutral, balanced reading', weight:0.35, reason:'Balance without a strong direction reads as classic.'}); }
      if (s.paletteSat!=null && s.paletteSat>=25 && s.paletteSat<=45) { sc+=0.25; hits.push({source:'Colour Analysis', signal:'moderate saturation', weight:0.25, reason:'Neither muted nor vivid supports timelessness.'}); }
      if (['Clean Portrait','Natural Documentary'].includes(s.styleName)) { sc+=0.2; hits.push({source:'Photographer Style', signal:s.styleName, weight:0.2, reason:'These styles often read as classic.'}); }
      return { score: sc, hits }; } },

  { name: 'Modern', intentFamily: 'timeless-balanced',
    description: 'Clean, confident, contemporary — deliberate but not vintage.',
    emotionalDirection: 'confident, current, uncluttered', visualDirection: 'clean whites, controlled contrast, neutral-to-cool cast',
    preferredCues: ['clean whites', 'neutral-cool cast'], conflictingCues: ['warm/vintage colour direction'],
    styleDNARelationship: 'Aligns with "Clean Whites," "Bright Neutral Tones."', feasibilityNotes: 'Usually easy — clean, controlled looks transfer well.',
    match: (s) => { let sc=0; const hits=[];
      if (['Korean Clean','Editorial Fashion'].includes(s.styleName)) { sc+=0.3; hits.push({source:'Photographer Style', signal:s.styleName, weight:0.3, reason:'These styles commonly read as modern.'}); }
      if (s.colorCast==='neutral' || s.colorCast==='cool') { sc+=0.3; hits.push({source:'Style Fingerprint', signal:`${s.colorCast} colour cast`, weight:0.3, reason:'Neutral-to-cool casts read as contemporary rather than vintage.'}); }
      if (s.contrastLevel!=='low') { sc+=0.2; hits.push({source:'Style Feature Graph', signal:'defined contrast', weight:0.2, reason:'Some contrast supports confidence over softness.'}); }
      return { score: sc, hits }; } },

  { name: 'Documentary', intentFamily: 'documentary-honest',
    description: 'Observational, unposed, letting the moment lead.',
    emotionalDirection: 'observational, candid, unforced', visualDirection: 'natural contrast, unfiltered colour, minimal styling',
    preferredCues: ['unposed feel', 'unfiltered colour'], conflictingCues: ['heavy styling'],
    styleDNARelationship: 'Aligns with "Natural Contrast," "Journalistic Tone," "Minimal Grading."', feasibilityNotes: 'Usually easy — minimal grading by definition.',
    match: (s) => { let sc=0; const hits=[];
      if (s.styleTop==='Documentary' || s.styleTop==='Street') { sc+=0.4; hits.push({source:'Style Recognition', signal:s.styleTop, weight:0.4, reason:'Direct style-recognition agreement.'}); }
      if (s.styleName==='Natural Documentary') { sc+=0.35; hits.push({source:'Photographer Style', signal:s.styleName, weight:0.35, reason:'Directly matches the detected style.'}); }
      if (s.contrastLevel==='medium') { sc+=0.15; hits.push({source:'Style Feature Graph', signal:'natural contrast', weight:0.15, reason:'Unstylised tone supports an observational read.'}); }
      return { score: sc, hits }; } },

  { name: 'Filmic', intentFamily: 'nostalgic-textured',
    description: 'Analogue-inspired — warm, faded, colour-separated like film stock.',
    emotionalDirection: 'nostalgic, textured, imperfect-on-purpose', visualDirection: 'brown midtones, matte blacks, warm highlight, film colour separation',
    preferredCues: ['matte blacks', 'film colour separation'], conflictingCues: ['neon saturation', 'clean digital contrast'],
    styleDNARelationship: 'Aligns with "Brown Midtones," "Matte Blacks," "Film Colour Separation."', feasibilityNotes: 'High difficulty — film emulation is one of the harder looks to reproduce with global sliders alone.',
    match: (s) => { let sc=0; const hits=[];
      if (s.styleName==='Brown Film') { sc+=0.4; hits.push({source:'Photographer Style', signal:s.styleName, weight:0.4, reason:'Directly matches the detected style.'}); }
      if (s.styleTop==='Vintage') { sc+=0.25; hits.push({source:'Style Recognition', signal:'Vintage', weight:0.25, reason:'Independent style-recognition agreement.'}); }
      if (s.warmthDir==='warm' && s.paletteHue!=null && s.paletteHue>=20 && s.paletteHue<=50) { sc+=0.35; hits.push({source:'Colour Analysis', signal:'warm/earthy dominant hue', weight:0.35, reason:'Warm earthy palette is central to a filmic read.'}); }
      return { score: sc, hits }; } },

  { name: 'High Key', intentFamily: 'luminance-directed',
    description: 'Bright, open, minimal shadow — an airy overall exposure.',
    emotionalDirection: 'light, open, optimistic', visualDirection: 'bright overall exposure, low contrast, open shadows',
    preferredCues: ['bright exposure', 'open shadows'], conflictingCues: ['crushed blacks'],
    styleDNARelationship: 'Aligns with "White Lift," "Open Shadows," "Highlight Roll-off."', feasibilityNotes: 'Usually easy — global exposure/highlight work.',
    match: (s) => { let sc=0; const hits=[];
      if (s.moodTag==='airy_bright') { sc+=0.4; hits.push({source:'Style Fingerprint', signal:'airy/bright mood', weight:0.4, reason:'Directly defines a high-key read.'}); }
      if (s.contrastLevel==='low') { sc+=0.3; hits.push({source:'Style Feature Graph', signal:'low contrast', weight:0.3, reason:'Open, low-contrast tone supports high-key.'}); }
      if (s.refColorMood==='High Key') { sc+=0.3; hits.push({source:'Reference Color Intelligence', signal:s.refColorMood, weight:0.3, reason:'Independent colour/luminance evidence agrees.'}); }
      return { score: sc, hits }; } },

  { name: 'Low Key', intentFamily: 'luminance-directed',
    description: 'Dark, dense, dramatic — most of the frame in shadow.',
    emotionalDirection: 'mysterious, intense, dramatic', visualDirection: 'dark overall exposure, deep shadows, controlled highlights',
    preferredCues: ['dark exposure', 'deep shadows'], conflictingCues: ['bright, open whites'],
    styleDNARelationship: 'Aligns with "Low-key Mood," "Rich Shadow Detail," "Controlled Shadows."', feasibilityNotes: 'Moderate — depends on the reference\'s own dynamic range being healthy.',
    match: (s) => { let sc=0; const hits=[];
      if (s.moodTag==='moody_dark') { sc+=0.4; hits.push({source:'Style Fingerprint', signal:'moody-dark mood', weight:0.4, reason:'Directly defines a low-key read.'}); }
      if (['Moody Cinematic','Dark Forest'].includes(s.styleName)) { sc+=0.3; hits.push({source:'Photographer Style', signal:s.styleName, weight:0.3, reason:'These styles are inherently low-key.'}); }
      if (s.refColorMood==='Low Key') { sc+=0.3; hits.push({source:'Reference Color Intelligence', signal:s.refColorMood, weight:0.3, reason:'Independent colour/luminance evidence agrees.'}); }
      return { score: sc, hits }; } },

  // EPIC 1.5: added so the new intent-family membership table below (which
  // names both of these as family members alongside the original 19) has
  // real, detectable profiles behind them — additive, doesn't change any
  // of the original 19 intents' own scoring.
  { name: 'Elegant', intentFamily: 'luxury-clean',
    description: 'Refined, graceful, quietly confident — restraint as sophistication.',
    emotionalDirection: 'graceful, refined, understated', visualDirection: 'controlled contrast, clean neutral-warm tones, minimal distraction',
    preferredCues: ['controlled contrast', 'clean tones'], conflictingCues: ['harsh skin', 'busy palette'],
    styleDNARelationship: 'Aligns with "Controlled Contrast," "Elegant Color Separation," "Luxury Skin."', feasibilityNotes: 'Usually easy to moderate — mostly global tone/skin work.',
    match: (s) => { let sc=0; const hits=[];
      if (['Luxury Wedding','Fine Art Portrait'].includes(s.styleName)) { sc+=0.35; hits.push({source:'Photographer Style', signal:s.styleName, weight:0.35, reason:'These styles commonly carry an elegant intent.'}); }
      if (s.contrastLevel!=='high' && s.contrastLevel!=='low') { sc+=0.25; hits.push({source:'Style Feature Graph', signal:'controlled (moderate) contrast', weight:0.25, reason:'Neither flat nor harsh contrast supports gracefulness.'}); }
      if (s.paletteSat!=null && s.paletteSat<38) { sc+=0.2; hits.push({source:'Colour Analysis', signal:'restrained palette', weight:0.2, reason:'Quiet colour supports understated sophistication.'}); }
      if (s.skinDetected && s.skinConfidence>0.6) { sc+=0.2; hits.push({source:'Skin Analysis', signal:'clean, well-detected skin', weight:0.2, reason:'Clean skin rendering supports a graceful read.'}); }
      return { score: sc, hits }; } },

  { name: 'Commercial', intentFamily: 'minimal-commercial',
    description: 'Polished, market-ready, built to sell a product or brand cleanly.',
    emotionalDirection: 'confident, polished, purposeful', visualDirection: 'clean neutral tones, controlled/punchy contrast, minimal distraction',
    preferredCues: ['clean tones', 'controlled or punchy contrast'], conflictingCues: ['muddy colour cast', 'low confidence'],
    styleDNARelationship: 'Aligns with "Bright Neutral Tones," "Controlled Saturation."', feasibilityNotes: 'Usually easy — clean, controlled looks transfer reliably.',
    match: (s) => { let sc=0; const hits=[];
      if (['Editorial Fashion','Korean Clean'].includes(s.styleName)) { sc+=0.3; hits.push({source:'Photographer Style', signal:s.styleName, weight:0.3, reason:'These styles often read as commercial/market-ready.'}); }
      if (s.colorCast==='neutral') { sc+=0.25; hits.push({source:'Style Fingerprint', signal:'neutral colour cast', weight:0.25, reason:'A clean, neutral cast supports a commercial read.'}); }
      if (s.contrastLevel==='high' || s.contrastLevel==='medium') { sc+=0.2; hits.push({source:'Style Feature Graph', signal:`${s.contrastLevel} contrast`, weight:0.2, reason:'Defined contrast supports a confident, market-ready look.'}); }
      if (s.overallConf>0.6) { sc+=0.15; hits.push({source:'Style Fingerprint', signal:'high analysis confidence', weight:0.15, reason:'Commercial work is usually shot/lit cleanly, producing reliable analysis.'}); }
      return { score: sc, hits }; } },
];

/**
 * Task 5: named conflict rules per intent. Each conflict names the
 * concrete opposing evidence (never auto-corrects — report only).
 */
const INTENT_CONFLICT_RULES = {
  'Dreamy':   [{ name: 'Heavy Contrast', test: s => s.contrastLevel === 'high', severity: 'medium', note: 'A dreamy intent usually calls for soft, not heavy, contrast.' }],
  'Clean':    [{ name: 'Dirty Whites', test: s => s.colorCast !== 'neutral', severity: 'medium', note: 'A visible colour cast works against a clean read.' }],
  'Premium':  [{ name: 'Harsh Skin', test: s => s.skinDetected && s.skinConfidence < 0.4, severity: 'high', note: 'Premium/luxury intent depends on clean, well-rendered skin.' }],
  'Natural':  [{ name: 'Extreme Color Grading', test: s => s.paletteSat != null && s.paletteSat > 65, severity: 'medium', note: 'Very high saturation contradicts an unforced, natural read.' }],
  'Editorial':[{ name: 'Very Low Confidence', test: s => s.overallConf < 0.35, severity: 'high', note: 'A deliberate, directed intent is hard to assert with low-confidence analysis.' }],
  'High Key': [{ name: 'Crushed Blacks', test: s => s.contrastLevel === 'high' && s.moodTag === 'moody_dark', severity: 'high', note: 'High-key and crushed blacks are directly contradictory.' }],
  'Low Key':  [{ name: 'Over-opened Whites', test: s => s.moodTag === 'airy_bright', severity: 'high', note: 'Low-key and an airy/bright mood are directly contradictory.' }],
  'Filmic':   [{ name: 'Neon Saturation', test: s => s.paletteSat != null && s.paletteSat > 70, severity: 'high', note: 'Filmic/analogue intent is contradicted by neon-level saturation.' }],
  // EPIC 1.5: added — the 9th named conflict from this stage's spec.
  'Minimal':  [{ name: 'Excessive Palette Complexity', test: s => s.dominantHueFamilyCount != null ? s.dominantHueFamilyCount > 2 : (s.paletteSat != null && s.paletteSat > 50), severity: 'medium', note: 'A minimal intent calls for few competing colours — a complex, multi-hue palette works against it.' }],
};

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * EPIC 1.5 — Intent Hierarchy & Intent Strength
 * ═══════════════════════════════════════════════════════════════════════════
 * Upgrades EPIC 1.4's flat intent label into a structured hierarchy
 * (which family, how strongly, what supports/conflicts with it) and a
 * genuinely separate STRENGTH measure from CONFIDENCE:
 *   confidence = how sure the system is that this label is correct
 *   strength   = how visually dominant that intent reads in the image
 * A reference can be read with high confidence as only a MILD instance
 * of an intent (e.g. "Dreamy, 95% confident, but only mildly dreamy") —
 * these are not the same number and must never be conflated.
 */

// ── Task 1: Intent Family membership (many-to-many — an intent can
//    belong to more than one family; which one is REPORTED depends on
//    which family best matches the whole detected intent set, not a
//    fixed 1:1 lookup). Names/membership exactly as specified.
const INTENT_FAMILY_MEMBERSHIP = {
  'luxury-clean':        ['Premium', 'Clean', 'Elegant', 'Romantic', 'Modern'],
  'soft-emotional':      ['Dreamy', 'Soft', 'Emotional', 'Romantic', 'High Key'],
  'film-organic':        ['Filmic', 'Muted', 'Warm', 'Classic', 'Natural'],
  'editorial-directed':  ['Editorial', 'Bold', 'Modern', 'Cinematic'],
  'documentary-natural': ['Documentary', 'Natural', 'Clean', 'Minimal'],
  'cinematic-moody':     ['Cinematic', 'Low Key', 'Bold', 'Filmic', 'Muted'],
  'minimal-commercial':  ['Minimal', 'Clean', 'Modern', 'Commercial'],
};

/**
 * Picks the best-fitting family for the DETECTED SET of intents (primary
 * + secondaries), not just the primary intent alone — a family that also
 * contains one or more of the secondary intents is a better contextual
 * fit than a family that only contains the primary by coincidence.
 * Returns the full hierarchy structure Task 1 asks for, including
 * runner-up families for transparency.
 */
function _resolveIntentFamily(primaryIntentName, secondaryIntentNames) {
  const detectedSet = [primaryIntentName, ...secondaryIntentNames];
  const scored = Object.entries(INTENT_FAMILY_MEMBERSHIP).map(([family, members]) => {
    const matched = detectedSet.filter(name => members.includes(name));
    // Primary-intent membership counts double — the family should still
    // usually follow the primary intent, secondaries only break ties.
    const weight = (members.includes(primaryIntentName) ? 2 : 0) + matched.filter(n => n !== primaryIntentName).length;
    return { family, members, matched, weight };
  }).sort((a, b) => b.weight - a.weight);

  const best = scored[0];
  const alternatives = scored.slice(1, 3).filter(f => f.weight > 0).map(f => ({ family: f.family, overlapCount: f.matched.length }));

  return {
    family: best.weight > 0 ? best.family : 'unclassified',
    familyMembers: best.members,
    matchedFamilyIntents: best.matched,
    alternativeFamilies: alternatives,
  };
}

// ── Task 2: Intent Strength — deliberately NOT the same computation as
//    confidence. Confidence asks "how sure are we this label is right";
//    strength asks "how visually dominant is it in the image."
const KNOWN_EVIDENCE_SOURCES = ['Style Fingerprint', 'Style Feature Graph', 'Skin Analysis', 'Photographer Style', 'Colour Analysis', 'Reference Color Intelligence', 'Style Recognition', 'White Balance Intent', 'Colour Harmony', 'Skin + WB'];

function _computeIntentStrength({ topScore, evidence, intentConflicts, feasibilityLevel, dnaValidationScore }) {
  // Rule: strong evidence from MULTIPLE INDEPENDENT SOURCES increases strength.
  const distinctSources = new Set(evidence.map(e => e.source)).size;
  const sourceDiversity = Math.min(1, distinctSources / 3); // 3+ distinct sources = full diversity credit

  // Rule: high feasibility supports strength.
  const feasibilityBonus = { high: 1.0, medium: 0.55, low: 0.15 }[feasibilityLevel] ?? 0.5;

  // Rule: conflicting cues reduce strength.
  const conflictPenalty = { high: 0.35, medium: 0.18, none: 0 }[intentConflicts.severity] ?? 0;

  // Rule: high validation risk reduces strength (DNA validation score is
  // the proxy already computed for the detected Photographer Style).
  const validationPenalty = dnaValidationScore < 0.6 ? (0.6 - dnaValidationScore) * 0.5 : 0;

  let strength = topScore * 0.45 + sourceDiversity * 0.25 + feasibilityBonus * 0.15
               - conflictPenalty - validationPenalty;
  strength = clamp01(strength);

  const strengthLevel = strength >= 0.85 ? 'dominant' : strength >= 0.6 ? 'strong' : strength >= 0.35 ? 'moderate' : 'subtle';
  return { strength: +strength.toFixed(3), strengthLevel };
}

// ── Task 3: Intent → Style relationship map (which named looks a given
//    intent is known to support/corroborate).
const INTENT_STYLE_SUPPORT = {
  'Premium':  ['Luxury Wedding'],
  'Dreamy':   ['Airy Wedding', 'Soft Portrait'],
  'Filmic':   ['Brown Film', 'Moody Cinematic'],
  'Clean':    ['Luxury Wedding', 'Clean Portrait'],
  'Muted':    ['Brown Film', 'Green Pastel'],
  'Romantic': ['Airy Wedding', 'Luxury Wedding'],
};

function _buildSupportingIntents(primaryIntentName, detectedStyleName) {
  const supportedStyles = INTENT_STYLE_SUPPORT[primaryIntentName] ?? [];
  return supportedStyles.map(styleName => ({
    styleName,
    matchesDetectedStyle: styleName === detectedStyleName,
    reason: styleName === detectedStyleName
      ? `"${primaryIntentName}" intent is known to support "${styleName}" — and that is exactly the style detected here.`
      : `"${primaryIntentName}" intent is known to support "${styleName}" (not the style detected in this reference, but a related look).`,
  }));
}

// ── Task 4: Intent Budget Hints — explanation-only preferences a FUTURE
//    Style Budget stage could use. Never applied to any slider here.
const INTENT_BUDGET_HINTS = {
  'Premium':  { tonalPriority: 'highlights / whites / controlled contrast', colorPriority: 'cream / neutral / muted distractions', skinPriority: 'high', contrastPriority: 'controlled (medium)', toolPreferenceHints: ['Highlights', 'Whites', 'Skin Protection'], toolAvoidanceHints: ['aggressive Calibration', 'dirty/cast Whites'] },
  'Dreamy':   { tonalPriority: 'open shadows / soft highlights', colorPriority: 'warm-neutral, low saturation', skinPriority: 'medium-high', contrastPriority: 'low-medium', toolPreferenceHints: ['Tone Curve (soft)', 'Highlights'], toolAvoidanceHints: ['heavy Blacks', 'harsh Clarity'] },
  'Cinematic':{ tonalPriority: 'controlled shadows / colour grading', colorPriority: 'deliberate shadow/highlight separation', skinPriority: 'medium', contrastPriority: 'medium-high', toolPreferenceHints: ['Colour Grading', 'Tone Curve'], toolAvoidanceHints: ['over-opened Whites'] },
  'Clean':    { tonalPriority: 'balanced exposure, neutral whites', colorPriority: 'neutral, minimal cast', skinPriority: 'high', contrastPriority: 'medium', toolPreferenceHints: ['White Balance (neutral)', 'HSL (minimal)'], toolAvoidanceHints: ['strong colour cast', 'heavy grading'] },
  'Editorial':{ tonalPriority: 'bold contrast, controlled highlights', colorPriority: 'deliberate, saturated separation', skinPriority: 'medium', contrastPriority: 'high', toolPreferenceHints: ['Colour Grading', 'HSL'], toolAvoidanceHints: ['flat, undirected tone'] },
  'Natural':  { tonalPriority: 'natural contrast, unforced tone', colorPriority: 'unfiltered, restrained', skinPriority: 'high', contrastPriority: 'medium', toolPreferenceHints: ['Tone Curve (minimal)'], toolAvoidanceHints: ['extreme colour grading', 'heavy Calibration'] },
  'Minimal':  { tonalPriority: 'gentle, uncluttered tone', colorPriority: 'very low saturation, single hue family', skinPriority: 'medium', contrastPriority: 'low-medium', toolPreferenceHints: ['Tone Curve (subtle)'], toolAvoidanceHints: ['multi-hue colour pushes', 'high Vibrance/Saturation'] },
  'Romantic': { tonalPriority: 'soft highlights, warm skin', colorPriority: 'warm, gentle', skinPriority: 'high', contrastPriority: 'low-medium', toolPreferenceHints: ['White Balance (warm)', 'Skin Protection'], toolAvoidanceHints: ['cool cast', 'harsh contrast'] },
  'Bold':     { tonalPriority: 'strong contrast', colorPriority: 'vivid, confident saturation', skinPriority: 'medium', contrastPriority: 'high', toolPreferenceHints: ['HSL', 'Vibrance/Saturation'], toolAvoidanceHints: ['muted/quiet palette'] },
  'Muted':    { tonalPriority: 'gentle tonal contrast', colorPriority: 'desaturated throughout', skinPriority: 'medium', contrastPriority: 'low-medium', toolPreferenceHints: ['Vibrance (reduced)'], toolAvoidanceHints: ['vivid colour pushes'] },
  'Warm':     { tonalPriority: 'warm white balance', colorPriority: 'golden/brown direction', skinPriority: 'medium-high', contrastPriority: 'medium', toolPreferenceHints: ['White Balance (warm)', 'Colour Grading'], toolAvoidanceHints: ['cool cast'] },
  'Soft':     { tonalPriority: 'gentle roll-off, low contrast', colorPriority: 'unforced', skinPriority: 'medium-high', contrastPriority: 'low', toolPreferenceHints: ['Tone Curve (soft)'], toolAvoidanceHints: ['harsh Clarity', 'heavy Blacks'] },
  'Classic':  { tonalPriority: 'balanced, moderate contrast', colorPriority: 'neutral, moderate saturation', skinPriority: 'medium-high', contrastPriority: 'medium', toolPreferenceHints: ['Tone Curve (balanced)'], toolAvoidanceHints: ['trend-heavy stylisation'] },
  'Modern':   { tonalPriority: 'clean whites, controlled contrast', colorPriority: 'neutral-to-cool', skinPriority: 'medium', contrastPriority: 'medium-high', toolPreferenceHints: ['White Balance (neutral/cool)'], toolAvoidanceHints: ['warm/vintage direction'] },
  'Documentary':{ tonalPriority: 'natural, unforced tone', colorPriority: 'unfiltered', skinPriority: 'medium', contrastPriority: 'medium', toolPreferenceHints: ['Tone Curve (minimal)'], toolAvoidanceHints: ['heavy styling'] },
  'Filmic':   { tonalPriority: 'matte blacks, warm highlight', colorPriority: 'film-style colour separation', skinPriority: 'medium', contrastPriority: 'low-medium', toolPreferenceHints: ['Colour Grading', 'Calibration (subtle)'], toolAvoidanceHints: ['neon saturation', 'clean digital contrast'] },
  'High Key': { tonalPriority: 'bright exposure, open shadows', colorPriority: 'light, airy', skinPriority: 'high', contrastPriority: 'low', toolPreferenceHints: ['Exposure', 'Whites'], toolAvoidanceHints: ['crushed blacks'] },
  'Low Key':  { tonalPriority: 'dark exposure, deep shadows', colorPriority: 'dense, controlled', skinPriority: 'medium', contrastPriority: 'medium-high', toolPreferenceHints: ['Shadows', 'Colour Grading'], toolAvoidanceHints: ['over-opened whites'] },
  'Emotional':{ tonalPriority: 'soft or moody light, skin-forward', colorPriority: 'warm', skinPriority: 'high', contrastPriority: 'low-medium', toolPreferenceHints: ['Skin Protection', 'White Balance (warm)'], toolAvoidanceHints: ['cold, clinical colour'] },
  'Elegant':  { tonalPriority: 'controlled contrast, clean tones', colorPriority: 'quiet, refined', skinPriority: 'high', contrastPriority: 'medium', toolPreferenceHints: ['Skin Protection', 'Tone Curve (balanced)'], toolAvoidanceHints: ['busy palette', 'harsh skin'] },
  'Commercial':{ tonalPriority: 'clean, controlled or punchy contrast', colorPriority: 'neutral, market-clean', skinPriority: 'medium', contrastPriority: 'medium-high', toolPreferenceHints: ['White Balance (neutral)', 'HSL'], toolAvoidanceHints: ['muddy colour cast'] },
};

function _buildIntentBudgetHints(primaryIntentName) {
  const hints = INTENT_BUDGET_HINTS[primaryIntentName];
  if (!hints) {
    return { tonalPriority: 'balanced', colorPriority: 'neutral', skinPriority: 'medium', contrastPriority: 'medium', toolPreferenceHints: [], toolAvoidanceHints: [], reasons: [`No specific budget hint profile exists yet for "${primaryIntentName}" — using a neutral default.`] };
  }
  return { ...hints, reasons: [`Budget hints for "${primaryIntentName}" are explanation-only — they do not change any Lightroom slider until a future Style Budget stage reads them.`] };
}

// ── Task 5: extended conflict validation — same underlying rule check
//    as _detectIntentConflicts, reshaped with the additional
//    affectedIntent/affectedStyle fields the spec asks for. Kept as a
//    SEPARATE function (not a replacement) so the original
//    _detectIntentConflicts/`conflicts` field from EPIC 1.4 keeps working
//    unchanged for backward compatibility.
function _buildIntentConflictValidation(intentName, styleName, baseConflicts) {
  return {
    hasConflict: baseConflicts.hasConflict,
    severity: baseConflicts.severity,
    conflicts: baseConflicts.conflicts,
    affectedIntent: intentName,
    affectedStyle: styleName ?? null,
    recommendations: baseConflicts.recommendations,
    reasons: baseConflicts.hasConflict
      ? [`"${intentName}" (applied to detected style "${styleName ?? 'unknown'}") shows ${baseConflicts.conflicts.length} conflict(s) at "${baseConflicts.severity}" severity.`]
      : [`No conflicts detected between "${intentName}" and the analysed signals.`],
  };
}

function _detectIntentConflicts(intentName, signals) {
  const rules = INTENT_CONFLICT_RULES[intentName] ?? [];
  const conflicts = [], warnings = [], recommendations = [];
  for (const rule of rules) {
    if (rule.test(signals)) {
      conflicts.push({ name: rule.name, severity: rule.severity, note: rule.note });
      warnings.push(`"${intentName}" intent conflicts with detected "${rule.name}" — ${rule.note}`);
      recommendations.push(`Review whether "${intentName}" is the right intent read, or whether "${rule.name}" reflects a different creative direction than initially detected.`);
    }
  }
  const severity = conflicts.some(c => c.severity === 'high') ? 'high' : conflicts.length ? 'medium' : 'none';
  return { hasConflict: conflicts.length > 0, severity, conflicts, warnings, recommendations };
}

/**
 * Main entry point. Ranks all 19 intents by weighted evidence score,
 * returns the primary + secondary intents, structured evidence, detected
 * conflicts, and plain-language reasons — mirroring
 * _classifyPhotographerStyle's own shape/conventions so the two read
 * consistently in Decision Report.
 */
function _buildPhotographerIntent(signalCtx) {
  const s = _buildIntentSignals(signalCtx);
  const results = INTENT_PROFILES.map(profile => {
    const { score, hits } = profile.match(s);
    return { profile, score: clamp01(score), hits };
  }).sort((a, b) => b.score - a.score);

  const top = results[0];
  const secondary = results.slice(1, 4).filter(r => r.score > 0.2);
  const confidence = +clamp01(top.score * (0.5 + 0.5 * (signalCtx.overallConf ?? 0.5))).toFixed(3);

  const evidence = top.hits.map(h => ({ ...h, confidence: +clamp01(confidence * (h.weight / Math.max(0.01, top.score))).toFixed(3) }));
  const intentConflicts = _detectIntentConflicts(top.profile.name, s);

  const risks = [];
  if (top.score < 0.3) risks.push('No strong intent signature matched — this is a loose approximation.');
  if (intentConflicts.hasConflict) risks.push(`Detected conflicting evidence against the primary intent (severity: ${intentConflicts.severity}).`);

  // ── EPIC 1.5 Task 1/3: Intent Hierarchy (family resolved from the
  // WHOLE detected intent set, not just the primary alone) ────────────────
  const secondaryNames = secondary.map(r => r.profile.name);
  const intentHierarchy = _resolveIntentFamily(top.profile.name, secondaryNames);
  const supportingIntents = _buildSupportingIntents(top.profile.name, s.styleName);

  // ── EPIC 1.5 Task 2: Intent Strength — deliberately separate from confidence ──
  const { strength: intentStrength, strengthLevel } = _computeIntentStrength({
    topScore: top.score, evidence, intentConflicts,
    feasibilityLevel: s.feasibilityLevel, dnaValidationScore: s.dnaValidationScore,
  });

  // ── EPIC 1.5 Task 4: Intent Budget Hints — explanation-only ─────────────
  const intentBudgetHints = _buildIntentBudgetHints(top.profile.name);

  // ── EPIC 1.5 Task 5: extended conflict validation (additive alongside
  // the original `conflicts` field, which keeps its Stage-1.4 shape) ──────
  const intentConflictValidation = _buildIntentConflictValidation(top.profile.name, s.styleName, intentConflicts);

  const reasons = [
    `Primary intent "${top.profile.name}" (${top.profile.intentFamily}) — ${evidence.map(e => e.signal).join(', ') || 'weak evidence'}.`,
    `Intent strength: ${strengthLevel} (${intentStrength}) — belongs to the "${intentHierarchy.family}" family alongside ${intentHierarchy.matchedFamilyIntents.filter(n => n !== top.profile.name).join(', ') || 'no other currently-detected intents'}.`,
    ...(intentConflicts.hasConflict ? intentConflicts.warnings : []),
  ];

  return {
    primaryIntent: top.profile.name,
    secondaryIntents: secondary.map(r => ({ name: r.profile.name, score: +r.score.toFixed(3) })),
    intentFamily: intentHierarchy.family, // EPIC 1.5: now resolved contextually rather than a fixed 1:1 lookup — same field name/shape as EPIC 1.4 for backward compatibility
    // EPIC 1.5 additions:
    intentStrength, strengthLevel, intentHierarchy,
    supportingIntents,
    conflictingIntents: intentConflicts.conflicts.map(c => ({ name: c.name, severity: c.severity, note: c.note })),
    intentConflictValidation, intentBudgetHints,
    // EPIC 1.4 fields, unchanged shape:
    confidence,
    emotionalDirection: top.profile.emotionalDirection,
    visualDirection: top.profile.visualDirection,
    styleContext: { detectedStyle: s.styleName, styleDNARelationship: top.profile.styleDNARelationship, feasibilityNotes: top.profile.feasibilityNotes },
    evidence, risks, reasons,
    warnings: top.score < 0.3 ? ['Low-confidence intent match — treat as a loose approximation.'] : [],
    conflicts: intentConflicts, // kept unchanged for backward compatibility — see intentConflictValidation above for the EPIC 1.5-extended version
  };
}

function _buildReferenceColorSupport(detectedStyleName, rci) {
  const matchingHint = rci.styleHints?.find(h => h.styleName === detectedStyleName);
  if (matchingHint) {
    return {
      supported: true,
      matchScore: matchingHint.matchScore,
      colorMood: rci.colorMood,
      paletteSignature: rci.paletteSignature.summary,
      reason: `"${detectedStyleName}" is supported by Reference Color Intelligence — ${rci.paletteSignature.summary} palette with a "${rci.colorMood}" colour mood (colour-only match score ${matchingHint.matchScore}).`,
    };
  }
  return {
    supported: false,
    colorMood: rci.colorMood,
    paletteSignature: rci.paletteSignature.summary,
    reason: `Reference Color Intelligence's colour-only reading ("${rci.colorMood}" mood, ${rci.paletteSignature.summary}) did not independently point to "${detectedStyleName}" — this does not lower confidence; it means colour evidence alone wasn't the deciding signal for this detection.`,
  };
}

function _classifyPhotographerStyle(ctx) {
  const s = _buildStyleSignals(ctx);
  const results = STYLE_PROFILES.map(profile => {
    const { score, hits } = profile.match(s);
    const weightedScore = clamp01(score) * profile.priority;
    return { profile, rawScore: clamp01(score), weightedScore, hits };
  }).sort((a, b) => b.weightedScore - a.weightedScore);

  const confidenceOf = (r) => +clamp01(r.rawScore * (0.5 + 0.5 * (ctx.overallConf ?? 0.5))).toFixed(3);

  const warnings = [];
  const top = results[0];
  if (!top || top.rawScore < 0.25) {
    warnings.push('No photographer style matched strongly — treat the detected label as a loose approximation.');
  }
  if (results.length > 1 && (results[0].weightedScore - results[1].weightedScore) < 0.08) {
    warnings.push(`"${results[0].profile.name}" and "${results[1].profile.name}" scored very closely — this reference sits between two looks.`);
  }

  const toEntry = (r) => ({
    styleName: r.profile.name,
    description: r.profile.description,
    confidence: confidenceOf(r),
    priority: r.profile.priority,
    characteristics: r.profile.characteristics,
    preferredTools: r.profile.preferredTools,
    avoidedTools: r.profile.avoidedTools,
    transferDifficulty: r.profile.transferDifficulty,
    photographerReason: r.hits.length
      ? `Detected as "${r.profile.name}" because: ${r.hits.join('; ')}.`
      : `"${r.profile.name}" is the closest available match, though no strong signals were found.`,
    warnings: r.rawScore < 0.25 ? [`Low confidence match (${r.hits.length} signal(s) only).`] : [],
    reasons: r.hits,
    // Stage 2.4.2B: Style DNA — abstract visual ingredients, NOT Lightroom
    // sliders/budgets/XMP. Computed here so distance (below) can reuse it.
    styleDNA: _buildStyleDNA(r.profile.name, r.hits, confidenceOf(r)),
  });

  const topEntry = toEntry(top ?? { profile: STYLE_PROFILES.find(p => p.name === 'Clean Portrait') ?? STYLE_PROFILES[0], rawScore: 0.1, weightedScore: 0.1, hits: [] });
  topEntry.styleDistance = 0;   // the detected style is distance 0 from itself, by definition
  // Stage 2.4.2B.1: validate the detected style's own DNA for internal
  // consistency (required/forbidden elements, duplicates, tool
  // contradictions) BEFORE this DNA is ever used for a style budget.
  topEntry.styleDNAValidation = _validateStyleDNA(topEntry.styleName, topEntry.styleDNA, topEntry.transferDifficulty);

  const alternativeEntries = results.slice(1, 4).filter(r => r.rawScore > 0.15).map(toEntry)
    .map(entry => ({
      ...entry,
      styleDistance: _computeStyleDistance(topEntry.styleDNA, entry.styleDNA),
      styleDNAValidation: _validateStyleDNA(entry.styleName, entry.styleDNA, entry.transferDifficulty),
    }))
    .sort((a, b) => b.confidence - a.confidence);

  // Task 4: if the DETECTED style's DNA failed validation but an
  // alternative's DNA is meaningfully more internally consistent, report
  // it — never auto-switch, only warn.
  if (!topEntry.styleDNAValidation.isValid || topEntry.styleDNAValidation.score < 0.7) {
    const better = alternativeEntries.find(a => a.styleDNAValidation.score > topEntry.styleDNAValidation.score + 0.15);
    if (better) {
      warnings.push(`Detected style may be ambiguous; alternative style "${better.styleName}" appears more internally consistent (DNA validation score ${better.styleDNAValidation.score} vs ${topEntry.styleDNAValidation.score}).`);
    }
  }

  return {
    top: topEntry,
    // Alternatives are selected by weighted (priority-adjusted) ranking —
    // matching how the top style was chosen — but DISPLAYED sorted by raw
    // confidence, so the list reads naturally to a human ("closest matches
    // first") rather than by an internal priority tiebreak they can't see.
    alternatives: alternativeEntries,
    warnings,
  };
}

function clamp01(v) { return Math.max(0, Math.min(1, v ?? 0)); }

function _buildEditingStrategy(vocab, { hasSkin, portraitSafe }) {
  const reasons = [], warnings = [];
  let primaryTools = [], secondaryTools = [], avoidedTools = [];

  switch (vocab.colorFamily) {
    case 'green':
      primaryTools = ['hsl_green_luminance', 'toneCurve', 'calibration_subtle'];
      secondaryTools = ['colorGrading'];
      avoidedTools = ['hsl_green_saturation_strong', 'calibration_strong'];
      reasons.push('Green-family look: prefer Green luminance/curve/subtle calibration; avoid stacking strong HSL+Calibration+Grading on green simultaneously.');
      break;
    case 'earth':
      primaryTools = ['colorGrading', 'toneCurve', 'calibration_subtle'];
      secondaryTools = ['wb_mild'];
      avoidedTools = ['wb_strong_warm'];
      reasons.push('Earth/film-family look: prefer Colour Grading + Tone Curve + subtle Calibration; avoid over-warming WB.');
      if (hasSkin) { avoidedTools.push('hsl_orange_red_strong'); reasons.push('Skin present — protect orange/red channels from the warm colour push.'); }
      break;
    default:
      primaryTools = ['toneCurve', 'colorGrading'];
      secondaryTools = ['hsl'];
      avoidedTools = [];
  }

  if (vocab.styleFamily === 'wedding') {
    primaryTools.push('highlights', 'whites', 'toneCurve_soft');
    avoidedTools.push('exposure_darken');
    reasons.push('Wedding look: prefer Highlights/Whites/soft Tone Curve; avoid darkening exposure; protect white-dress highlight roll-off.');
  }
  if (vocab.styleFamily === 'cinematic') {
    primaryTools.push('toneCurve', 'colorGrading', 'shadow_control');
    if (vocab.moodFamily !== 'matte') avoidedTools.push('shadows_lifted_flat');
    reasons.push('Cinematic look: prefer Curve + Colour Grading + controlled shadows; avoid flat lifted shadows unless a matte style is detected.');
  }
  if (vocab.styleFamily === 'portrait' && portraitSafe) {
    primaryTools.push('skinProtection');
    reasons.push('Portrait look: skin protection is a primary tool alongside the colour family above.');
  }

  return { primaryTools: [...new Set(primaryTools)], secondaryTools: [...new Set(secondaryTools)], avoidedTools: [...new Set(avoidedTools)], reasons, warnings };
}

/**
 * Stage 2.4 Task 2.4C: Style Budget System.
 * A rule-based allocation of how much each engine is "allowed" to
 * contribute toward a given mood dimension, so multiple engines don't
 * independently over-build the same look (e.g. HSL + Calibration +
 * Colour Grading all boosting green at once). Lightroom Mapping Engine
 * uses this to scale down engines whose COMBINED contribution exceeds
 * the budgeted share for the dominant dimension.
 */
function _buildStyleBudget(vocab) {
  if (vocab.colorFamily === 'green') {
    return { name: 'greenMoodBudget', total: 1.0, hsl: 0.30, calibration: 0.20, colorGrading: 0.20, wb: 0.10, curve: 0.20 };
  }
  if (vocab.colorFamily === 'earth' || vocab.warmthDirection === 'warm') {
    return { name: 'warmMoodBudget', total: 1.0, wb: 0.25, colorGrading: 0.30, calibration: 0.15, hsl: 0.10, curve: 0.20 };
  }
  if (vocab.moodFamily === 'moody' || vocab.moodFamily === 'matte') {
    return { name: 'shadowMoodBudget', total: 1.0, curve: 0.35, colorGrading: 0.25, basicPanel: 0.15, hsl: 0.10, calibration: 0.15 };
  }
  return { name: 'balancedBudget', total: 1.0, hsl: 0.20, calibration: 0.20, colorGrading: 0.30, wb: 0.15, curve: 0.15 };
}

/**
 * Stage 2.2: Decision Engine's own lightweight transfer-risk assessment.
 * Reference Transfer Intelligence (core/reference-transfer-engine) runs
 * LATER in the pipeline and produces a fuller, authoritative report — but
 * Decision Engine needs SOME transfer-risk awareness at mapping time, so
 * this computes a proxy from signals already in scope: wbIntent (Stage
 * 2.1), conflict count from Feature Fusion, and skin/scene dependency.
 * Both assessments read the same upstream data and are expected to agree
 * in the common case.
 */
/**
 * Stage 2.4.2B.2: preliminary, decision-time-only feasibility estimate.
 * Distinct from Style DNA Validation (_validateStyleDNA — "is the DNA
 * internally logical?"); this asks "can it realistically transfer?" using
 * only signals Decision Engine has: the style's own DNA validation score,
 * average engine trust across the pipeline, transferRiskEstimate (the
 * decision-time WB/conflict-based proxy from Stage 2.2) as a stand-in for
 * transfer risk, and the style's declared transferDifficulty.
 */
function _estimateStyleFeasibilityProxy(topStyleEntry, transferRiskEstimate, engineTrustWeights) {
  const dnaScore = topStyleEntry?.styleDNAValidation?.score ?? 0.7;
  const trustValues = Object.values(engineTrustWeights ?? {});
  const trustAvg = trustValues.length ? trustValues.reduce((a, b) => a + b, 0) / trustValues.length : 0.6;
  const riskProxy = transferRiskEstimate?.score ?? 0.3;
  const difficultyPenalty = { low: 0, medium: 0.08, high: 0.16 }[topStyleEntry?.transferDifficulty ?? 'medium'] ?? 0.08;

  const score = +clamp01(dnaScore * 0.4 + trustAvg * 0.35 + (1 - riskProxy) * 0.25 - difficultyPenalty).toFixed(3);
  const level = score >= 0.7 ? 'high' : score >= 0.4 ? 'medium' : 'low';

  return {
    score, level,
    note: 'Preliminary decision-time estimate only — the authoritative styleFeasibility (with full Lightroom reproduction, benchmark, and validation signals) is computed later in Reference Transfer Intelligence.',
  };
}

function _estimateTransferRisk({ wbIntent, conflicts, skinPct, portraitSafe, overallConf }) {
  const wbRisk = wbIntent?.transferRiskScore ?? 0.3;   // unknown WB → assume moderate
  const conflictRisk = Math.min(1, (conflicts?.length ?? 0) * 0.15);
  const skinRisk = (portraitSafe && skinPct > 30) ? 0.3 : (portraitSafe && skinPct > 10) ? 0.15 : 0.05;
  const confidenceRisk = overallConf < 0.4 ? 0.3 : overallConf < 0.6 ? 0.1 : 0;

  const score = +Math.max(0, Math.min(1,
    wbRisk * 0.40 + conflictRisk * 0.30 + skinRisk * 0.15 + confidenceRisk * 0.15
  )).toFixed(3);
  const level = score >= 0.55 ? 'high' : score >= 0.30 ? 'medium' : 'low';

  const reasons = [];
  if (wbRisk > 0.3) reasons.push(`WB transfer risk contributes ${wbRisk.toFixed(2)}.`);
  if (conflictRisk > 0) reasons.push(`${conflicts?.length ?? 0} Feature Fusion conflict(s) contribute ${conflictRisk.toFixed(2)}.`);
  if (skinRisk > 0.1) reasons.push(`Heavy skin dependency contributes ${skinRisk.toFixed(2)}.`);
  if (confidenceRisk > 0) reasons.push(`Low overall confidence contributes ${confidenceRisk.toFixed(2)}.`);
  if (!reasons.length) reasons.push('No significant transfer-risk signals detected.');

  return { score, level, reasons };
}

/** Chooses which SCENE_STRATEGIES entry applies to this image. */
function _determineDecisionStrategy({ isPortrait, mood, styleTop, category }) {
  if (isPortrait) return 'portrait';
  // Food is checked before generic mood tags: a bright, warmly-lit food
  // shot often resolves mood="airy_bright" (Food→airy_bright in
  // feature-fusion-engine's STYLE_TO_MOOD table), but it still needs
  // food-specific warm-channel protection, not just generic airy handling.
  if (styleTop === 'Food') return 'food';
  if (mood === 'moody_dark') return 'moody';
  if (mood === 'airy_bright') return 'airy';
  if (category === 'Landscape') return 'landscape';
  return 'general';
}

function _skinLockScale(skinPct) {
  if (skinPct >= 40) return 0.30;
  if (skinPct >= 20) return 0.55;
  if (skinPct >= 10) return 0.75;
  return 1.0;
}

// ─── Debug trace — extended with Phase 5 adaptive fields ─────────────────────

function _buildDebugTrace({ decision, fingerprint, mapped, stats, wb, cast }) {
  return {
    category:       decision.category,
    categoryRaw:    stats?.category,
    sceneCategory:  decision.category,
    sceneConf:      decision.sceneConfidence,
    castBgGreen:    cast?.bgGreenDominant ?? false,
    castSubjectNeutral: cast?.subjectNeutral ?? false,
    skinPct:        +decision.skinPct.toFixed(1),
    skinSource:     decision.hasSkin ? 'engine' : 'stats',
    hasSkin:        decision.hasSkin,
    skinConfidence: decision.skinConfidence,
    isPortrait:     decision.isPortrait,
    portraitSafe:   decision.portraitSafe,
    mode:           decision.mode,
    toneStyle:      fingerprint.mood,
    toneStyleLabel: fingerprint.moodLabel,
    gradeStrength:  decision.gradeStrength,
    basicDampen:    decision.basicDampen,
    wbDampen:       decision.wbDampen,
    skinLockScale:  decision.skinLockScale,
    wbMoodPreservation: fingerprint.wbMoodPreservation,
    wb: {
      tempRaw:           wb?.consensus?.temperature ?? 0,
      tintRaw:           wb?.consensus?.tint ?? 0,
      tempFinal:         mapped.temp,
      tintFinal:         mapped.tint,
      confidence:        +(wb?.confidence ?? 0).toFixed(2),
      neutralPixelCount: wb?.neutralPixelCount ?? 0,
      sources: [
        { name: 'grayWorld',    temp: wb?.grayWorld?.temperature ?? 0,   tint: wb?.grayWorld?.tint ?? 0   },
        { name: 'whitePatch',   temp: wb?.whitePatch?.temperature ?? 0,  tint: wb?.whitePatch?.tint ?? 0  },
        { name: 'shadesOfGray', temp: wb?.shadesOfGray?.temperature ?? 0,tint: wb?.shadesOfGray?.tint ?? 0},
      ],
      // Stage 2.1: the structured intent — mood/risk description, forwarded
      // as-is to Lightroom Mapping, Reference Transfer, and Explainability.
      // Decision Engine reads this to decide TREATMENT (already folded into
      // wbTrust/wbDampen above) but never edits it — WB engine owns intent.
      intent: wb?.wbIntent ?? null,
    },
    // Phase 5: Adaptive Decision Intelligence output
    decisionStrategy:   decision.decisionStrategy,
    engineTrustWeights: decision.engineTrustWeights,
    appliedGuards:      decision.appliedGuards,
    finalStyleIntent:   decision.finalStyleIntent,
    // Stage 2.2: Decision Intelligence Optimization output
    transferRiskEstimate:   decision.transferRiskEstimate,
    decisionConfidence:     decision.decisionConfidence,
    transferAwareConfidence: decision.transferAwareConfidence,
    noAutoBrighten:      decision.noAutoBrighten,
    noAggressiveDarken:  decision.noAggressiveDarken,
    protectWarmChannels: decision.protectWarmChannels,
    strongColorAllowed:  decision.strongColorAllowed,
    reasons:            decision.reasons,
    warnings:           decision.warnings,
    // Backward-compat alias (previous field name)
    rationale:          decision.reasons,
    conflicts: decision.conflicts ?? [],
    // Stage 2.4: Photographer Intelligence Layer
    editingStrategy: decision.editingStrategy ?? null,
    styleBudget: decision.styleBudget ?? null,
    // Stage 2.3: mapping-level explainability trace (intent summary +
    // every cross-slider/photographer/validation adjustment made inside
    // core/lightroom-mapping-engine). Purely additive — forwarded as-is.
    mappingTrace: mapped._mappingTrace ?? null,
    hslDampen: decision.hslDampen ?? 1.0,
    calDampen: decision.calDampen ?? 1.0,
    clampsApplied: [
      `Strategy "${decision.decisionStrategy}": Basic Panel dampen=${decision.basicDampen?.toFixed(2)} (exp=${mapped.exp})`,
      `WB: ${Math.round(fingerprint.wbMoodPreservation.preservationFactor*100)}% mood-preservation × ${Math.round((decision.wbDampen??1)*100)}% scene trust applied`,
      decision.portraitSafe ? `WB temp/tint clamped ±12/-10…+12 (portraitSafe)` : null,
      decision.portraitSafe ? `Cal hue ±3, sat ±4 (portraitSafe)` : decision.hasSkin ? `Cal hue ±4, sat ±6 (skin)` : null,
      decision.portraitSafe ? `HSL skin channels ±2h/-6…+4s (portraitSafe)` : null,
      (decision.conflicts ?? []).length ? `${decision.conflicts.length} Style Feature Graph conflict(s) detected — see conflicts[]` : null,
    ].filter(Boolean),
  };
}
