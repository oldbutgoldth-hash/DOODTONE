/**
 * core/decision-report-engine/index.js
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * EXPLAINABLE AI DECISION REPORT (Phase 6.1)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   ... Style Fingerprint → Decision Engine → Lightroom Mapping Engine →
 *   Pre-XMP Validation → Style Benchmark Engine → [ DECISION REPORT ] →
 *   XMP Export
 *
 * This module computes NOTHING new. Every pipeline stage before it already
 * produces confidence scores, reasons, warnings, and trust weights — this
 * module's only job is to ASSEMBLE and NARRATE what already happened into
 * something a human (user or developer) can read and understand: what
 * style was detected, which engines drove the result, which were
 * downweighted and why, what each major Lightroom section became and why,
 * what Pre-XMP Validation caught, and why the Benchmark score landed where
 * it did.
 *
 * Nothing here reads the DOM, mutates the preset, or blocks export — pure
 * data in, a narrated report out.
 */

import { ENGINE_PRIORITY } from '../feature-fusion-engine/index.js';

const ENGINE_LABELS = {
  'style-recognition-engine': 'Style Recognition', 'skintone-engine': 'Skin Tone',
  'skin-classifier': 'Skin Classifier', 'colorgrading-ai-engine': 'Colour Grading',
  'kmeans-engine': 'Palette', 'color-harmony-engine': 'Colour Harmony',
  'tone-curve-ai-engine': 'Tone Curve', 'curve-engine': 'Curve Engine',
  'whitebalance-engine': 'White Balance', 'calibration-engine': 'Calibration',
  'hsl-analyzer-engine': 'HSL Analyzer', 'hsl-engine': 'HSL (legacy)',
  'color-cast-detector': 'Colour Cast Detector', 'scene-classifier': 'Scene Classifier',
  'histogram-engine': 'Histogram', 'basic-panel-engine': 'Basic Panel',
};
const _label = (id) => ENGINE_LABELS[id] ?? id;

// ─── Task 1 (Phase 6.2): Truthfulness helpers ────────────────────────────────
// A report must NEVER show confidence: null/undefined/NaN — that reads as a
// bug to a programmer and as false certainty to a photographer. When data is
// genuinely unavailable we report confidence: 0 and say so explicitly,
// rather than inventing a plausible-looking number or hiding the gap.
function _safeConf(value, warningsArr, label) {
  const n = Number(value);
  if (value === null || value === undefined || Number.isNaN(n)) {
    if (warningsArr) warningsArr.push(`${label}: confidence unavailable this run — reported as 0, not a real measurement of zero certainty.`);
    return 0;
  }
  return +n.toFixed(3);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * @param {{
 *   styleFeatureGraph: object,
 *   styleFingerprint:  object,
 *   decisionStrategy:  object,   // finalPreset._decision (Phase 5 shape)
 *   finalPreset:       object,
 *   preXmpValidation:  object,   // validateFinalPreset() report
 *   styleBenchmark:    object,   // benchmarkStylePreservation() result
 * }} ctx
 * @returns {object} DecisionReport
 */
export function buildDecisionReport(ctx) {
  const {
    styleFeatureGraph: graph, styleFingerprint: fp, decisionStrategy: dec,
    finalPreset: p, preXmpValidation: val, styleBenchmark: bench,
  } = ctx;

  // Task 1: collects "confidence unavailable" notices as _safeConf() runs —
  // NOT invented data, an explicit record of what genuinely couldn't be known.
  const dataWarnings = [];

  const detectedStyle = _buildDetectedStyle(graph);
  const confidence = _buildConfidence(fp, graph, dec, dataWarnings);
  const topContributors = _buildTopContributors(graph);
  const reducedInfluence = _buildReducedInfluence(graph, dec);
  const lightroomMappingReasons = _buildMappingReasons(p, fp, dec, val, dataWarnings);
  const validationSummary = _buildValidationSummary(val, dataWarnings);
  const benchmarkSummary = _buildBenchmarkSummary(bench, dataWarnings);
  const decisionTrace = _buildDecisionTrace({ graph, fp, dec, p, val, bench, topContributors, reducedInfluence, dataWarnings });
  const summary = _buildSummary({ fp, dec, topContributors, reducedInfluence, bench });

  const warnings = _dedupe([
    ...dataWarnings,
    ...(dec?.warnings ?? []),
    ...(graph?.warnings ?? []),
    ...(val?.adjustments ?? []).map(a => `Pre-XMP: ${a}`),
    ...(bench?.warnings ?? []),
  ]);
  const recommendations = _dedupe([
    ...(bench?.recommendations ?? []),
    ...(reducedInfluence.length && reducedInfluence.some(r => r.reason.includes('low confidence'))
      ? ['Consider re-analysing with a clearer or higher-resolution reference image to raise low-confidence engines.']
      : []),
  ]);

  // Task 6: Photographer QA Checklist — derived purely from data already
  // computed above, never a new judgement call.
  const photographerChecklist = _buildPhotographerChecklist({ fp, dec, p, val, bench, lightroomMappingReasons });

  // Task 5: Explainability Quality Score — a QA score for THIS report,
  // never used to alter or block XMP export.
  const explainabilityQuality = _buildExplainabilityQuality({
    confidence, lightroomMappingReasons, validationSummary, benchmarkSummary,
    dataWarnings, p, val,
  });

  // Stage 2.2: finalStyleIntentConfidence — the LAST-mile confidence figure.
  // decisionConfidence/transferAwareConfidence (computed inside Decision
  // Engine) can only reflect what was known at decision time. By the time
  // this report runs, Pre-XMP Validation and Style Benchmark have ALSO
  // run — so this figure additionally folds in validation safety and
  // benchmark safetyScore, which Decision Engine could not have known.
  const finalStyleIntentConfidence = _buildFinalStyleIntentConfidence({ dec, validationSummary, benchmarkSummary });

  // Stage 2.4 Task 2.4F: Photographer Intelligence explainability — surfaces
  // the style vocabulary (2.4A), editing strategy (2.4B), style budget
  // adjustments (2.4C, read from the mapping trace), and photographer
  // acceptance estimate (2.4D, from Style Benchmark — already computed by
  // the time this report runs). Reference Transfer's editingDistanceEstimate
  // (2.4E) runs AFTER this report in the pipeline, so it is not included
  // here — it is explained separately when Reference Transfer completes.
  const photographerIntelligence = _buildPhotographerIntelligenceSummary({ dec, bench });

  return {
    summary, detectedStyle, confidence, decisionTrace,
    topContributors, reducedInfluence, lightroomMappingReasons,
    validationSummary, benchmarkSummary,
    warnings, recommendations,
    explainabilityQuality, photographerChecklist,
    finalStyleIntentConfidence,
    // Stage 2.4: Photographer Intelligence Layer explainability
    photographerIntelligence,
  };
}

/**
 * Stage 2.4 Task 2.4F: assembles the photographer-intelligence outputs
 * (style vocabulary, editing strategy, style budget, photographer
 * acceptance) into one explainable summary section.
 */
function _buildPhotographerIntelligenceSummary({ dec, bench }) {
  const fsi = dec?.finalStyleIntent ?? {};
  const strategy = dec?.editingStrategy;
  const budget = dec?.styleBudget;
  const acceptance = bench?.photographerAcceptance;
  const mapTrace = dec?.mappingTrace?.log ?? [];
  const budgetAdjustments = mapTrace.filter(l => l.stage === 'style-budget').map(l => l.message);
  const strategyAdjustments = mapTrace.filter(l => l.stage === 'editing-strategy').map(l => l.message);
  // Stage 2.4.2A: the richer, photographer-oriented style vocabulary —
  // detected style + alternative candidates, each with its own confidence
  // and reasons, separate from the colour-oriented photographerStyleLabel
  // above (which still drives editingStrategy/styleBudget unchanged).
  const photographerStyle = fsi.photographerStyle ?? null;

  const reasons = [];
  if (fsi.photographerStyleLabel) {
    reasons.push(`Detected look: "${fsi.photographerStyleLabel}" (style family: ${fsi.styleFamily}, transfer difficulty: ${fsi.transferDifficulty}).`);
  }
  if (photographerStyle?.top) {
    reasons.push(`Photographer style: "${photographerStyle.top.styleName}" (confidence ${Math.round(photographerStyle.top.confidence * 100)}%) — ${photographerStyle.top.photographerReason}`);
    if (photographerStyle.top.styleDNA?.length) {
      const topDNA = [...photographerStyle.top.styleDNA].sort((a, b) => b.importance - a.importance).slice(0, 3);
      reasons.push(`Style DNA — the visual ingredients behind this look: ${topDNA.map(d => `${d.name} (importance ${d.importance})`).join(', ')}.`);
    }
    // Stage 2.4.2B.1: Style DNA Validation — internal consistency check,
    // reported but never used to alter mapping/budget/XMP.
    const dnaVal = photographerStyle.top.styleDNAValidation;
    if (dnaVal) {
      reasons.push(`Style DNA validation: ${dnaVal.isValid ? 'consistent' : 'issues found'} (score ${dnaVal.score}).`);
      if (!dnaVal.isValid) reasons.push(...dnaVal.issues.map(i => `DNA issue: ${i}`));
    }
    if (photographerStyle.alternatives?.length) {
      reasons.push(`Alternative candidates considered: ${photographerStyle.alternatives.map(a => `"${a.styleName}" (${Math.round(a.confidence*100)}%, style distance ${a.styleDistance})`).join(', ')}.`);
    }
    // Stage 2.4.2B.2: Style Feasibility Intelligence — preliminary
    // decision-time estimate only ("can this style realistically transfer
    // through Lightroom XMP?", distinct from DNA validation's "is the DNA
    // internally logical?"). The authoritative version, with full
    // Lightroom reproduction/benchmark/validation signals, is computed
    // later in Reference Transfer Intelligence and is NOT available here.
    const feasEst = fsi.styleFeasibilityEstimate;
    if (feasEst) {
      reasons.push(`Style feasibility (preliminary): ${feasEst.level} (${feasEst.score}) — full assessment available once Reference Transfer Intelligence completes.`);
    }
  }
  if (strategy?.primaryTools?.length) {
    reasons.push(`Editing strategy leads with: ${strategy.primaryTools.join(', ')}${strategy.avoidedTools?.length ? `; avoids: ${strategy.avoidedTools.join(', ')}` : ''}.`);
  }
  if (budget) {
    reasons.push(`Style budget "${budget.name}" applied${budgetAdjustments.length ? ` — ${budgetAdjustments.length} engine(s) eased back to stay within their share` : ' — no engine exceeded its share'}.`);
  }
  if (acceptance) {
    reasons.push(`Photographer acceptance estimate: ${Math.round(acceptance.score * 100)}% — ${acceptance.strongPoints?.[0] ?? ''}`);
  }
  // EPIC 1.3: Reference Color Intelligence support — additive, present
  // only when a caller supplied referenceColorIntelligence to Decision
  // Engine. Never affects any score above; purely narrates WHY (or
  // whether) the reference's colour evidence corroborates the detected
  // style.
  const colorSupport = photographerStyle?.top?.referenceColorSupport;
  if (colorSupport) {
    reasons.push(colorSupport.reason);
  }

  // EPIC 1.4: Photographer Intent Intelligence — a DIFFERENT axis from
  // photographerStyle above (look category vs. creative/emotional
  // direction). Narrated separately so a reader never confuses the two.
  const intent = fsi.photographerIntent;
  if (intent) {
    reasons.push(`Primary intent: "${intent.primaryIntent}" (${intent.intentFamily}, confidence ${Math.round(intent.confidence * 100)}%) — ${intent.emotionalDirection}.`);
    // EPIC 1.5: strength is narrated as its own, explicitly-labelled
    // sentence — never merged into the confidence sentence above, so a
    // reader can never mistake one for the other.
    if (intent.strengthLevel) {
      reasons.push(`Intent strength: ${intent.strengthLevel} (${intent.intentStrength}) — belongs to the "${intent.intentHierarchy?.family}" family.`);
    }
    if (intent.secondaryIntents?.length) {
      reasons.push(`Secondary intents considered: ${intent.secondaryIntents.map(i => `"${i.name}" (${Math.round(i.score*100)}%)`).join(', ')}.`);
    }
    if (intent.supportingIntents?.length) {
      const matched = intent.supportingIntents.filter(si => si.matchesDetectedStyle);
      if (matched.length) reasons.push(`Supporting evidence: "${intent.primaryIntent}" intent is a known match for the detected style "${matched[0].styleName}".`);
    }
    if (intent.conflicts?.hasConflict) {
      reasons.push(...intent.conflicts.warnings);
    }
  }

  // EPIC 1.6: Capture Capability Intelligence — a DIFFERENT question from
  // style/intent above ("what is this source realistically capable of?").
  // Narrated with both a photographer-facing sentence and a developer
  // note when compatibility is limited.
  const cap = fsi.captureCapabilityEstimate;
  if (cap) {
    reasons.push(`Capture capability: "${cap.overallCapability}" with editing headroom ${cap.editingHeadroom.toFixed(2)} — ${cap.editingHeadroom >= 0.7 ? 'large room for grading' : cap.editingHeadroom >= 0.45 ? 'moderate room; keep grading measured' : 'aggressive grading may damage image quality'}.`);
    const ic = fsi.intentCompatibilityEstimate;
    if (ic && !ic.compatible) {
      reasons.push(`[dev] Intent compatibility is "${ic.score}" for the detected intent — ${ic.limitations[0] ?? 'see intentCompatibility.limitations for detail'}.`);
    }
  }

  // EPIC 1.7 / Patch 5 (EPIC 1.7F): Style Budget Intelligence —
  // photographer-facing summary sentence using the upgraded priorities[]
  // (readable `area`, not the raw dimension key), plus explicit noise-
  // reliability and stacking-risk developer notes. Never dumps raw JSON.
  const sbi = fsi.styleBudgetIntelligence;
  if (sbi) {
    const topAreas = sbi.priorities.map(p => p.area).join(', ');
    const noiseNote = sbi.noiseReliability?.status === 'estimated' ? ', and noise reliability is estimated'
      : sbi.noiseReliability?.status === 'unavailable' ? ', and noise reliability is unavailable'
      : '';
    reasons.push(`Style Budget is ${sbi.budgetLevel}${sbi.budgetLevel === 'conservative' ? ' because capture capability is limited' + noiseNote : ''} (confidence ${Math.round(sbi.confidence * 100)}%). ${topAreas.charAt(0).toUpperCase() + topAreas.slice(1)} remain the main priorities.`);
    if (sbi.budgetLevel === 'aggressive-risky') {
      reasons.push(`[dev] Budget level "aggressive-risky" — high overall allocation with a real risk signal present; treat with caution despite the high budget. This label does not change any budget value or feed Lightroom Mapping.`);
    }
    if (sbi.suppressedAreas.length) {
      reasons.push(`Suppressed: ${sbi.suppressedAreas.map(s => s.area).join(', ')} — see styleBudgetIntelligence.suppressedAreas for reasons.`);
    }
    if (sbi.budgetStackingRisk.hasRisk) {
      reasons.push(`[dev] Budget stacking risk (${sbi.budgetStackingRisk.severity}): ${sbi.budgetStackingRisk.riskType}.`);
    }
    if (sbi.noiseReliability && sbi.noiseReliability.status !== 'measured') {
      reasons.push(`[dev] ${sbi.noiseReliability.reason} Budget confidence is reduced accordingly; styleBudgetIntelligence remains abstract and does not feed Lightroom Mapping yet.`);
    }
  }

  // EPIC 2D: Lightroom Mapping V2 Shadow Compare — narration only when
  // the report actually exists (safe no-op otherwise).
  const scr = fsi.lightroomShadowCompareReportV2;
  if (scr) {
    reasons.push(`Lightroom Mapping V2 Shadow Compare: ${scr.photographerSummary}`);
    if (scr.divergenceAnalysis?.hasMajorDivergence) {
      reasons.push(`[dev] Shadow compare divergence (${scr.divergenceAnalysis.severity}): ${scr.divergenceAnalysis.divergentAreas.join(', ')}. See lightroomMappingV2ShadowCompare for detail.`);
    }
    reasons.push(`[dev] ${scr.developerSummary}`);
  }

  // EPIC 2E-A: Lightroom Mapping V2 Controlled Activation — narration
  // only when the gate object actually exists (safe no-op otherwise).
  const act = fsi.lightroomControlledActivationV2;
  if (act) {
    reasons.push(`Lightroom Mapping V2 Controlled Activation: ${act.photographerSummary}`);
    reasons.push(`[dev] ${act.developerSummary}`);
  }

  // EPIC 2E-B: Legacy Safety Overlay narration (safe no-op if missing).
  const ov = fsi.legacySafetyOverlayV2;
  if (ov) {
    reasons.push(`Legacy Safety Overlay V2: ${ov.photographerSummary}`);
    if (ov.legacyRiskReview?.riskLevel && ov.legacyRiskReview.riskLevel !== 'none' && ov.legacyRiskReview.riskLevel !== 'unknown') {
      reasons.push(`[dev] Overlay legacy risk level "${ov.legacyRiskReview.riskLevel}" — ${ov.overlayRecommendations.length} report-only recommendation(s). See legacySafetyOverlay for detail.`);
    }
    reasons.push(`[dev] ${ov.developerSummary}`);
  }

  // EPIC 2E-C: Overlay Simulation V2 narration (safe no-op if missing).
  const sim = fsi.legacyOverlaySimulationV2;
  if (sim) {
    reasons.push(`Overlay Simulation V2: ${sim.photographerSummary}`);
    if (sim.simulatedRiskDelta?.improved) {
      reasons.push(`[dev] Simulated risk delta: "${sim.simulatedRiskDelta.deltaLevel}" — ${sim.simulatedRiskDelta.improvedAreas.length} improved area(s) in simulation only, no production change occurred.`);
    }
    reasons.push(`[dev] ${sim.developerSummary}`);
  }

  // EPIC 2E-D: Controlled Overlay Test Gate narration (safe no-op if missing).
  const gate = fsi.controlledOverlayTestGateV2;
  if (gate) {
    reasons.push(`Controlled Overlay Test Gate V2: ${gate.photographerSummary}`);
    if (gate.blockers?.length) {
      reasons.push(`[dev] Test gate blockers (${gate.blockers.length}): ${gate.blockers.slice(0, 2).map(b => b.blocker).join('; ')}${gate.blockers.length > 2 ? ', …' : ''}.`);
    }
    reasons.push(`[dev] ${gate.developerSummary}`);
  }

  // EPIC 2E-E: Controlled Overlay Preview Sandbox narration (safe no-op if missing).
  const sandbox = fsi.controlledOverlayPreviewSandboxV2;
  if (sandbox) {
    reasons.push(`Controlled Overlay Preview Sandbox V2: ${sandbox.photographerSummary}`);
    if (sandbox.canGeneratePreview) {
      reasons.push(`[dev] Preview risk review level: "${sandbox.previewRiskReview?.level}" — ${sandbox.previewPlan?.protectedAreas?.length ?? 0} protected area(s) in preview only; no production change occurred.`);
    }
    reasons.push(`[dev] ${sandbox.developerSummary}`);
  }

  // EPIC 2E-F Phase B: Controlled Preview Human Review narration (safe
  // no-op if missing). Photographer wording never claims Lightroom
  // accuracy, final visual approval, production readiness, XMP
  // readiness, or real-image safety beyond what the review state itself
  // actually supports.
  const review = fsi.controlledPreviewReviewStateV2;
  if (review) {
    const photographerLine = review.approvalState === 'approved'
      ? 'All required preview review checks have passed. This still does not change your exported preset — legacy mapping remains active.'
      : review.approvalState === 'unavailable'
        ? 'No preview is available yet to review.'
        : `Preview is waiting for visual review (${review.reviewProgress?.completed ?? 0}/${review.reviewProgress?.required ?? 0} required checks passed). Your current production preset still uses the legacy mapping path.`;
    reasons.push(`Controlled Preview Human Review: ${photographerLine}`);
    if (review.reviewSummary?.nextRequiredItem) {
      reasons.push(`[dev] Next required review item: "${review.reviewSummary.nextRequiredItem}".`);
    }
    reasons.push(`[dev] mode=${review.mode}, reviewState=${review.reviewState}, approvalState=${review.approvalState}, canApprovePreview=${review.canApprovePreview}, confidence=${review.confidence}, reviewProgress=${JSON.stringify(review.reviewProgress)}, failedItemIds=${JSON.stringify(review.failedItemIds)}, pendingItemIds=${JSON.stringify(review.pendingItemIds)}, unavailableItemIds=${JSON.stringify(review.unavailableItemIds)}, fallbackStrategy.useLegacyMapping=${review.fallbackStrategy?.useLegacyMapping}, rollbackPlan.available=${review.rollbackPlan?.available}.`);
    if (fsi.controlledPreviewReviewStateV2Error) reasons.push(`[dev] Integration warning: ${fsi.controlledPreviewReviewStateV2Error}`);
  }

  return {
    photographerStyleLabel: fsi.photographerStyleLabel ?? null,
    styleFamily: fsi.styleFamily ?? null,
    moodFamily: fsi.moodFamily ?? null,
    colorFamily: fsi.colorFamily ?? null,
    transferDifficulty: fsi.transferDifficulty ?? null,
    // Stage 2.4.2A additions
    photographerStyle: photographerStyle ? {
      detected: photographerStyle.top,
      alternatives: photographerStyle.alternatives ?? [],
      warnings: photographerStyle.warnings ?? [],
      // Stage 2.4.2B.1: exposed at top level for easy access, alongside
      // being embedded in `detected` — the DNA validation for the
      // detected style, plus any ambiguous-style warning (Task 4) is
      // already folded into `warnings` above.
      styleDNAValidation: photographerStyle.top?.styleDNAValidation ?? null,
      // Stage 2.4.2B.2: preliminary estimate — see note field for caveat.
      styleFeasibilityEstimate: fsi.styleFeasibilityEstimate ?? null,
      // EPIC 1.3: exposed at top level too, alongside being embedded in
      // `detected` — mirrors the styleDNAValidation pattern above.
      referenceColorSupport: colorSupport ?? null,
    } : null,
    // EPIC 1.4: a separate top-level field — NOT nested under
    // photographerStyle, since intent is a distinct axis (creative/
    // emotional direction), not a property of the style classification.
    photographerIntent: intent ? {
      primaryIntent: intent.primaryIntent,
      secondaryIntents: intent.secondaryIntents,
      intentFamily: intent.intentFamily,
      confidence: intent.confidence,
      emotionalDirection: intent.emotionalDirection,
      visualDirection: intent.visualDirection,
      styleContext: intent.styleContext,
      evidence: intent.evidence,
      conflicts: intent.conflicts,
      risks: intent.risks,
      warnings: intent.warnings,
      // EPIC 1.5 additions — hierarchy/strength/relationships/budget hints:
      intentStrength: intent.intentStrength,
      strengthLevel: intent.strengthLevel,
      intentHierarchy: intent.intentHierarchy,
      supportingIntents: intent.supportingIntents,
      conflictingIntents: intent.conflictingIntents,
      intentConflictValidation: intent.intentConflictValidation,
      intentBudgetHints: intent.intentBudgetHints,
    } : null,
    // EPIC 1.6: a separate top-level field — capture capability answers
    // "what is this SOURCE realistically capable of?", independent of
    // style/intent. This is the PRELIMINARY estimate (imageAnalysisCore
    // not yet available at Decision Engine time) — the authoritative
    // version lives in Reference Transfer Report.
    captureCapability: fsi.captureCapabilityEstimate ? {
      overallScore: fsi.captureCapabilityEstimate.overallScore,
      overallCapability: fsi.captureCapabilityEstimate.overallCapability,
      editingHeadroom: fsi.captureCapabilityEstimate.editingHeadroom,
      dynamicRange: fsi.captureCapabilityEstimate.dynamicRange,
      highlightRecovery: fsi.captureCapabilityEstimate.highlightRecovery,
      shadowRecovery: fsi.captureCapabilityEstimate.shadowRecovery,
      noiseTolerance: fsi.captureCapabilityEstimate.noiseTolerance,
      whiteBalanceLatitude: fsi.captureCapabilityEstimate.whiteBalanceLatitude,
      colorLatitude: fsi.captureCapabilityEstimate.colorLatitude,
      confidence: fsi.captureCapabilityEstimate.confidence,
      strengths: fsi.captureCapabilityEstimate.strengths,
      limitations: fsi.captureCapabilityEstimate.limitations,
      warnings: fsi.captureCapabilityEstimate.warnings,
      note: 'Preliminary estimate — the authoritative version (with real noise/sharpness data) is computed in Reference Transfer Report.',
    } : null,
    intentCompatibility: fsi.intentCompatibilityEstimate ?? null,
    captureBudgetHints: fsi.captureBudgetHints ?? null,
    // EPIC 1.7: a separate top-level field — abstract resource allocation,
    // NOT Lightroom Mapping (no slider values here). Deliberately named
    // `styleBudgetIntelligence`, not `styleBudget` — the existing
    // `styleBudget` field a few lines below is a DIFFERENT, older system
    // (Stage 2.4C's colour-mood budget, which does feed Lightroom Mapping
    // today) and is completely untouched by this stage.
    styleBudgetIntelligence: fsi.styleBudgetIntelligence ? {
      overallBudget: fsi.styleBudgetIntelligence.overallBudget,
      budgetLevel: fsi.styleBudgetIntelligence.budgetLevel,
      tonalBudget: fsi.styleBudgetIntelligence.tonalBudget, colorBudget: fsi.styleBudgetIntelligence.colorBudget,
      skinBudget: fsi.styleBudgetIntelligence.skinBudget, contrastBudget: fsi.styleBudgetIntelligence.contrastBudget,
      wbBudget: fsi.styleBudgetIntelligence.wbBudget, curveBudget: fsi.styleBudgetIntelligence.curveBudget,
      hslBudget: fsi.styleBudgetIntelligence.hslBudget, calibrationBudget: fsi.styleBudgetIntelligence.calibrationBudget,
      colorGradingBudget: fsi.styleBudgetIntelligence.colorGradingBudget, detailBudget: fsi.styleBudgetIntelligence.detailBudget,
      safetyBudget: fsi.styleBudgetIntelligence.safetyBudget,
      confidence: fsi.styleBudgetIntelligence.confidence,
      priorities: fsi.styleBudgetIntelligence.priorities,
      suppressedAreas: fsi.styleBudgetIntelligence.suppressedAreas,
      budgetStackingRisk: fsi.styleBudgetIntelligence.budgetStackingRisk,
      noiseReliability: fsi.styleBudgetIntelligence.noiseReliability,
      risks: fsi.styleBudgetIntelligence.risks, warnings: fsi.styleBudgetIntelligence.warnings,
      note: 'Preliminary estimate — the authoritative version (with real capture capability data) is computed in Reference Transfer Report.',
    } : null,
    // EPIC 2D: Lightroom Mapping V2 Shadow Compare — a compact, readable
    // section (not a raw JSON dump) summarising how V2's shadow-only
    // planning/translation/safety chain compares against legacy mapping.
    // Safe if the report is missing entirely (try/catch upstream may
    // have set it to null) — this section simply becomes null too,
    // never breaking the rest of the Decision Report.
    lightroomMappingV2ShadowCompare: fsi.lightroomShadowCompareReportV2 ? {
      readiness: fsi.lightroomShadowCompareReportV2.readiness,
      confidence: fsi.lightroomShadowCompareReportV2.confidence,
      overallAlignment: fsi.lightroomShadowCompareReportV2.alignmentScores?.overallAlignment ?? null,
      safetyDelta: {
        v2SaferThanLegacy: fsi.lightroomShadowCompareReportV2.safetyDelta?.v2SaferThanLegacy ?? null,
        score: fsi.lightroomShadowCompareReportV2.safetyDelta?.score ?? null,
      },
      majorDivergences: fsi.lightroomShadowCompareReportV2.divergenceAnalysis?.divergentAreas ?? [],
      activationReadinessLevel: fsi.lightroomShadowCompareReportV2.activationReadiness?.level ?? 'unknown',
      canProceedToControlledActivation: fsi.lightroomShadowCompareReportV2.activationReadiness?.canProceedToControlledActivation ?? false,
      photographerSummary: fsi.lightroomShadowCompareReportV2.photographerSummary,
      developerSummary: fsi.lightroomShadowCompareReportV2.developerSummary,
    } : null,
    // EPIC 2E-A: Lightroom Mapping V2 Controlled Activation — compact,
    // readable section (not a raw JSON dump). Safe if the gate object is
    // missing entirely (try/catch upstream may have set it to null).
    lightroomMappingV2ControlledActivation: fsi.lightroomControlledActivationV2 ? {
      activationState: fsi.lightroomControlledActivationV2.activationState,
      selectedMappingSource: fsi.lightroomControlledActivationV2.selectedMappingSource,
      canUseV2: fsi.lightroomControlledActivationV2.canUseV2,
      failedGates: (fsi.lightroomControlledActivationV2.gateChecks ?? []).filter(g => g.required && !g.passed).map(g => g.name),
      blockers: (fsi.lightroomControlledActivationV2.blockers ?? []).map(b => b.blocker),
      rollbackPlan: {
        available: fsi.lightroomControlledActivationV2.rollbackPlan?.available ?? false,
        strategy: fsi.lightroomControlledActivationV2.rollbackPlan?.strategy ?? null,
      },
      photographerSummary: fsi.lightroomControlledActivationV2.photographerSummary,
      developerSummary: fsi.lightroomControlledActivationV2.developerSummary,
    } : null,
    // EPIC 2E-B: Legacy Safety Overlay V2 — compact, readable section
    // (not a raw JSON dump). Safe if the overlay object is missing.
    legacySafetyOverlay: fsi.legacySafetyOverlayV2 ? {
      overlayState: fsi.legacySafetyOverlayV2.overlayState,
      canApplyOverlay: fsi.legacySafetyOverlayV2.canApplyOverlay,
      selectedOutputSource: fsi.legacySafetyOverlayV2.selectedOutputSource,
      legacyRiskLevel: fsi.legacySafetyOverlayV2.legacyRiskReview?.riskLevel ?? 'unknown',
      overlayRecommendations: (fsi.legacySafetyOverlayV2.overlayRecommendations ?? []).map(r => `${r.area}: ${r.recommendation} (${r.productionImpact})`),
      blockers: (fsi.legacySafetyOverlayV2.blockers ?? []).map(b => b.blocker),
      rollbackPlan: {
        available: fsi.legacySafetyOverlayV2.rollbackPlan?.available ?? false,
        strategy: fsi.legacySafetyOverlayV2.rollbackPlan?.strategy ?? null,
      },
      photographerSummary: fsi.legacySafetyOverlayV2.photographerSummary,
      developerSummary: fsi.legacySafetyOverlayV2.developerSummary,
    } : null,
    // EPIC 2E-C: Overlay Simulation V2 — compact, readable section (not
    // a raw JSON dump). Safe if the simulation object is missing.
    overlaySimulation: fsi.legacyOverlaySimulationV2 ? {
      simulationState: fsi.legacyOverlaySimulationV2.simulationState,
      canApplyToProduction: fsi.legacyOverlaySimulationV2.canApplyToProduction,
      selectedOutputSource: fsi.legacyOverlaySimulationV2.selectedOutputSource,
      simulatedActions: (fsi.legacyOverlaySimulationV2.simulatedOverlayActions ?? []).map(a => `${a.action}: ${a.tool}/${a.channel}`),
      riskBefore: fsi.legacyOverlaySimulationV2.simulatedRiskBefore?.overallRisk ?? 'unknown',
      riskAfter: fsi.legacyOverlaySimulationV2.simulatedRiskAfter?.overallRisk ?? 'unknown',
      confidence: fsi.legacyOverlaySimulationV2.confidence,
      blockers: (fsi.legacyOverlaySimulationV2.blockers ?? []).map(b => b.blocker),
      photographerSummary: fsi.legacyOverlaySimulationV2.photographerSummary,
      developerSummary: fsi.legacyOverlaySimulationV2.developerSummary,
    } : null,
    // EPIC 2E-D: Controlled Overlay Test Gate V2 — compact, readable
    // section (not a raw JSON dump). Safe if the gate object is missing.
    controlledOverlayTestGate: fsi.controlledOverlayTestGateV2 ? {
      testState: fsi.controlledOverlayTestGateV2.testState,
      canEnterControlledTest: fsi.controlledOverlayTestGateV2.canEnterControlledTest,
      canPreviewOverlayPreset: fsi.controlledOverlayTestGateV2.canPreviewOverlayPreset,
      canWriteProduction: fsi.controlledOverlayTestGateV2.canWriteProduction,
      selectedOutputSource: fsi.controlledOverlayTestGateV2.selectedOutputSource,
      keyBlockers: (fsi.controlledOverlayTestGateV2.blockers ?? []).slice(0, 4).map(b => b.blocker),
      testEligibility: {
        eligible: fsi.controlledOverlayTestGateV2.testEligibility?.eligible ?? false,
        level: fsi.controlledOverlayTestGateV2.testEligibility?.level ?? 'unknown',
      },
      humanReviewChecklist: (fsi.controlledOverlayTestGateV2.humanReviewChecklist ?? []).map(c => `${c.item}: ${c.status}`),
      fallbackAvailable: fsi.controlledOverlayTestGateV2.fallbackStrategy?.useLegacyMapping ?? true,
      rollbackPlan: {
        available: fsi.controlledOverlayTestGateV2.rollbackPlan?.available ?? false,
        strategy: fsi.controlledOverlayTestGateV2.rollbackPlan?.strategy ?? null,
      },
      photographerSummary: fsi.controlledOverlayTestGateV2.photographerSummary,
      developerSummary: fsi.controlledOverlayTestGateV2.developerSummary,
    } : null,
    // EPIC 2E-E-F: Controlled Overlay Preview Sandbox V2 — compact,
    // readable section using CANONICAL field names (not a raw JSON
    // dump). Safe if the sandbox object is missing.
    controlledOverlayPreviewSandbox: fsi.controlledOverlayPreviewSandboxV2 ? {
      previewState: fsi.controlledOverlayPreviewSandboxV2.previewState,
      canGeneratePreview: fsi.controlledOverlayPreviewSandboxV2.canGeneratePreview,
      canExportPreview: fsi.controlledOverlayPreviewSandboxV2.canExportPreview,
      canWriteProduction: fsi.controlledOverlayPreviewSandboxV2.canWriteProduction,
      selectedOutputSource: fsi.controlledOverlayPreviewSandboxV2.selectedOutputSource,
      previewEligibility: {
        eligible: fsi.controlledOverlayPreviewSandboxV2.previewEligibility?.eligible ?? false,
        level: fsi.controlledOverlayPreviewSandboxV2.previewEligibility?.level ?? 'unknown',
      },
      previewRiskReview: {
        level: fsi.controlledOverlayPreviewSandboxV2.previewRiskReview?.level ?? 'unknown',
        hardStops: fsi.controlledOverlayPreviewSandboxV2.previewRiskReview?.hardStops ?? 0,
        skinRisk: fsi.controlledOverlayPreviewSandboxV2.previewRiskReview?.skinRisk ?? 'unknown',
      },
      previewProtections: fsi.controlledOverlayPreviewSandboxV2.previewPlan?.protectedAreas ?? [],
      previewSuppressions: fsi.controlledOverlayPreviewSandboxV2.previewPlan?.suppressedRisks ?? [],
      keyBlockers: (fsi.controlledOverlayPreviewSandboxV2.blockers ?? []).slice(0, 4).map(b => b.blocker),
      humanReviewChecklist: (fsi.controlledOverlayPreviewSandboxV2.humanReviewChecklist ?? []).map(c => `${c.id}: ${c.status}`),
      fallbackAvailable: fsi.controlledOverlayPreviewSandboxV2.fallbackStrategy?.useLegacyMapping ?? true,
      rollbackPlan: {
        available: fsi.controlledOverlayPreviewSandboxV2.rollbackPlan?.available ?? false,
        strategy: fsi.controlledOverlayPreviewSandboxV2.rollbackPlan?.strategy ?? null,
      },
      photographerSummary: fsi.controlledOverlayPreviewSandboxV2.photographerSummary,
      developerSummary: fsi.controlledOverlayPreviewSandboxV2.developerSummary,
    } : null,
    // EPIC 2E-F Phase B: "Controlled Preview Human Review" — compact,
    // canonical-field-only section (not a raw JSON dump). Read-only;
    // review approval here has no path to production output or XMP.
    // Safe if the review-state object is missing entirely.
    controlledPreviewHumanReview: fsi.controlledPreviewReviewStateV2 ? {
      approvalState: fsi.controlledPreviewReviewStateV2.approvalState,
      canApprovePreview: fsi.controlledPreviewReviewStateV2.canApprovePreview,
      reviewProgress: fsi.controlledPreviewReviewStateV2.reviewProgress,
      requiredItemsCompleted: fsi.controlledPreviewReviewStateV2.completedItemIds ?? [],
      requiredItemsRemaining: fsi.controlledPreviewReviewStateV2.pendingItemIds ?? [],
      failedItems: fsi.controlledPreviewReviewStateV2.failedItemIds ?? [],
      unavailableItems: fsi.controlledPreviewReviewStateV2.unavailableItemIds ?? [],
      nextRequiredItem: fsi.controlledPreviewReviewStateV2.reviewSummary?.nextRequiredItem ?? null,
      blockers: (fsi.controlledPreviewReviewStateV2.blockers ?? []).slice(0, 4).map(b => b.blocker),
      warnings: fsi.controlledPreviewReviewStateV2.warnings ?? [],
      rollbackAvailable: fsi.controlledPreviewReviewStateV2.rollbackPlan?.available ?? false,
      // Explicit, always-true-in-this-phase confirmations per this
      // stage's spec — never inferred, always read from the objects
      // that actually enforce them.
      previewIsNonProduction: true,
      exportRemainsDisabled: fsi.controlledOverlayPreviewSandboxV2 ? fsi.controlledOverlayPreviewSandboxV2.canExportPreview === false : true,
      productionMappingRemainsLegacy: fsi.controlledOverlayPreviewSandboxV2 ? fsi.controlledOverlayPreviewSandboxV2.selectedOutputSource === 'legacy' : true,
      photographerSummary: fsi.controlledPreviewReviewStateV2.reviewSummary?.photographerMessage,
      developerSummary: fsi.controlledPreviewReviewStateV2.reviewSummary?.developerMessage,
    } : null,
    editingStrategy: strategy ?? null,
    styleBudget: budget ? { name: budget.name, adjustmentsMade: budgetAdjustments.length, details: budgetAdjustments } : null,
    editingStrategyAdjustments: strategyAdjustments,
    photographerAcceptance: acceptance ?? null,
    reasons,
  };
}

function _buildFinalStyleIntentConfidence({ dec, validationSummary, benchmarkSummary }) {
  const decisionConf = dec?.decisionConfidence ?? 0.5;
  const transferConf  = dec?.transferAwareConfidence ?? decisionConf;
  const validationSafety = validationSummary?.safe ? 1.0 : Math.max(0.3, 1 - (validationSummary?.risky?.length ?? 0) * 0.15);
  const benchmarkSafety  = benchmarkSummary?.safetyScore ?? 0.6;

  const score = +Math.max(0.1, Math.min(1,
    decisionConf * 0.30 + transferConf * 0.30 + validationSafety * 0.20 + benchmarkSafety * 0.20
  )).toFixed(3);

  const reasons = [
    `Decision confidence ${decisionConf} × 0.30 + transfer-aware confidence ${transferConf} × 0.30 + validation safety ${validationSafety.toFixed(2)} × 0.20 + benchmark safety ${benchmarkSafety} × 0.20.`,
  ];
  if (!validationSummary?.safe) reasons.push(`Pre-XMP Validation flagged ${validationSummary?.risky?.length ?? 0} issue(s) — final confidence reduced.`);
  if (benchmarkSafety < 0.5) reasons.push(`Benchmark safetyScore (${benchmarkSafety}) is low — final confidence reduced.`);

  return { score, reasons };
}

// ─── 1. Summary ───────────────────────────────────────────────────────────────

function _buildSummary({ fp, dec, topContributors, reducedInfluence, bench }) {
  const warmthWord = fp.warmth !== 'neutral' ? `${fp.warmth} ` : '';
  const moodWord = (fp.moodLabel ?? 'Balanced').toLowerCase();
  const scene = (dec?.category ?? 'General').toLowerCase();
  const styleLabel = dec?.finalStyleIntent?.photographerStyle?.top?.styleName ?? dec?.finalStyleIntent?.photographerStyleLabel;
  let s = styleLabel
    ? `"${_cap(styleLabel)}" style detected (${_cap(warmthWord)}${moodWord} ${scene})`
    : `${_cap(warmthWord)}${moodWord} ${scene} style detected`;
  s += dec?.decisionStrategy ? ` (strategy: "${dec.decisionStrategy}").` : '.';

  const highNames = topContributors.slice(0, 2).map(c => _label(c.engine));
  const lowNames  = reducedInfluence.filter(r => ['basic-panel-engine','histogram-engine'].includes(r.engine)).map(r => _label(r.engine));
  if (highNames.length) s += ` ${highNames.join(' and ')} had high confidence`;
  if (lowNames.length)  s += `${highNames.length ? ', while ' : ' While '}${lowNames.join(' and ')} were reduced to avoid auto-correcting the edited reference image.`;
  else if (highNames.length) s += '.';

  // Task 4 (Phase 6.2): consistency — a high style match with a low safety
  // score is a genuine risk and must never be silently omitted.
  if (bench && (bench.safetyScore ?? 1) < 0.4 && (bench.overallStyleSimilarity ?? 0) >= 0.6) {
    s += ` Note: style match looks close, but the safety check flagged risk (safety ${Math.round((bench.safetyScore ?? 0)*100)}%) — review before trusting this preset as-is.`;
  }

  // Stage 2.2: explain WHY a safer decision was made, when transfer risk
  // was significant enough to soften Colour Grading/HSL/Calibration/Curve.
  if (dec?.transferRiskEstimate?.level === 'high') {
    s += ` A safer decision was chosen — this reference's style depends strongly on this scene's specifics (transfer risk ${dec.transferRiskEstimate.level}), so Colour Grading, HSL, and Calibration were softened before mapping.`;
  } else if (dec?.transferRiskEstimate?.level === 'medium') {
    s += ` Values were mildly softened due to moderate transfer risk.`;
  }
  return s;
}

// ─── 2. Detected style ────────────────────────────────────────────────────────

function _buildDetectedStyle(graph) {
  if (!graph) return null;
  return {
    mood: graph.mood, warmth: graph.warmth, colorCast: graph.colorCast,
    paletteIntent: graph.paletteIntent, harmonyIntent: graph.harmonyIntent,
    skinIntent: graph.skinIntent, contrastIntent: graph.contrastIntent,
    highlightIntent: graph.highlightIntent, shadowIntent: graph.shadowIntent,
    curveIntent: graph.curveIntent,
  };
}

// ─── 3. Confidence ────────────────────────────────────────────────────────────

function _buildConfidence(fp, graph, dec, warnings = []) {
  return {
    overall: _safeConf(fp?.overallConfidence, warnings, 'Overall confidence'),
    styleFeatureGraph: _safeConf(graph?.overallStyleConfidence, warnings, 'Style Feature Graph confidence'),
    sceneClassification: _safeConf(dec?.sceneConf, warnings, 'Scene classification confidence'),
    skin: fp?.skin?.detected || dec?.hasSkin ? _safeConf(dec?.skinConfidence, warnings, 'Skin confidence') : 0,
  };
}

// ─── 4. Top contributors ──────────────────────────────────────────────────────

function _buildTopContributors(graph) {
  if (!graph?.features?.length) return [];
  const byEngine = new Map();
  for (const f of graph.features) {
    const prev = byEngine.get(f.id);
    if (!prev || f.effectiveWeight > prev.effectiveWeight) {
      byEngine.set(f.id, {
        engine: f.id, engineLabel: _label(f.id),
        confidence: f.confidence, priority: ENGINE_PRIORITY[f.id] ?? f.weight, effectiveWeight: f.effectiveWeight,
        reason: f.reasons?.[0] ?? `${_label(f.id)} contributed "${f.category}" with confidence ${f.confidence}.`,
      });
    }
  }
  return [...byEngine.values()].sort((a, b) => b.effectiveWeight - a.effectiveWeight).slice(0, 6);
}

// ─── 5. Reduced influence ─────────────────────────────────────────────────────

function _buildReducedInfluence(graph, dec) {
  const out = [];
  const seen = new Set();
  const add = (engine, reason, extra = {}) => {
    if (!seen.has(engine)) { seen.add(engine); out.push({ engine, engineLabel: _label(engine), reason, ...extra }); }
  };

  // Low ENGINE_PRIORITY by design (Basic Panel / Histogram are supporting-only)
  const byEngine = new Map();
  for (const f of (graph?.features ?? [])) {
    const prev = byEngine.get(f.id);
    if (!prev || f.effectiveWeight > prev.effectiveWeight) byEngine.set(f.id, f);
  }
  for (const f of byEngine.values()) {
    if (f.weight <= 0.40) add(f.id, `low priority by design (base weight ${f.weight}) — supporting/validator role, not a style driver.`,
      { priority: ENGINE_PRIORITY[f.id] ?? f.weight, confidence: f.confidence, effectiveWeight: f.effectiveWeight });
  }

  // Low confidence this run
  for (const f of byEngine.values()) {
    if (f.confidence < 0.40 && f.weight > 0.40) add(f.id, `low confidence this run (${f.confidence}) — influence reduced.`,
      { priority: ENGINE_PRIORITY[f.id] ?? f.weight, confidence: f.confidence, effectiveWeight: f.effectiveWeight });
  }

  // Conflict-based dampening (Feature Fusion)
  for (const c of (graph?.conflicts ?? [])) {
    const [a, b] = c.involvedEngines ?? [];
    if (a) add(a, `conflict "${c.type}" — ${c.resolution}`, { priority: ENGINE_PRIORITY[a] ?? 0.5 });
  }

  // Scene-strategy trust reductions (Decision Engine, Phase 5)
  const trust = dec?.engineTrustWeights ?? {};
  const TRUST_LABEL = { basicPanel:'basic-panel-engine', histogram:'histogram-engine', calibration:'calibration-engine', hsl:'hsl-analyzer-engine' };
  for (const [key, id] of Object.entries(TRUST_LABEL)) {
    if ((trust[key] ?? 1) < 0.6) add(id, `scene strategy "${dec?.decisionStrategy}" reduced trust to ${trust[key]} — safety reason.`,
      { priority: ENGINE_PRIORITY[id] ?? 0.5, effectiveWeight: trust[key] ?? 0 });
  }

  return out;
}

// ─── Stage 2.1: WB reason — photographer-language, driven by wbIntent ───────
// Picks between the four situations the spec calls out explicitly, in
// priority order (mixed lighting and green bounce are the most important
// risks to surface; plain mood preservation is the common/default case).

function _buildWBReason({ wbIntent, wbDefect, warmth, isPortraitSafe }) {
  if (!wbIntent) {
    return wbDefect
      ? `White Balance corrected a colour cast that looked like a lighting defect rather than an intentional part of the reference's mood.`
      : `White Balance preserves the ${warmth && warmth !== 'neutral' ? warmth + ' ' : ''}reference mood while avoiding an unwanted green/yellow skin cast.`;
  }

  if (wbIntent.mixedLightingRisk > 0.3) {
    return `Mixed lighting increased WB transfer risk (shadows read "${wbIntent.shadowBias}", highlights read "${wbIntent.highlightBias}"), so Temp/Tint was softened.`;
  }
  if (wbIntent.greenBounceRisk > 0.3 && isPortraitSafe) {
    return `Green ambient bounce was detected, but Tint was limited to protect skin.`;
  }
  if (wbIntent.greenBounceRisk > 0.3) {
    return `Green ambient/bounce light was detected in the environment — Tint was limited to keep the correction safe to transfer.`;
  }
  if (wbIntent.transferRisk !== 'low' && wbIntent.transferConfidence < 0.5) {
    return `WB transfer confidence is lower (${Math.round(wbIntent.transferConfidence * 100)}%) because the reference depends strongly on scene lighting.`;
  }
  if (wbDefect) {
    return `White Balance corrected a colour cast that looked like a lighting defect rather than an intentional part of the reference's mood.`;
  }
  return `White Balance preserves the ${warmth && warmth !== 'neutral' ? warmth + ' ' : ''}reference mood instead of neutralising it.`;
}

// ─── 6. Lightroom Mapping reasons ─────────────────────────────────────────────

function _buildMappingReasons(p, fp, dec, val, dataWarnings = []) {
  const trust = dec?.engineTrustWeights ?? {};
  const violations = val?.violations ?? [];
  const wasClamped = (prefixes) => violations.some(v => prefixes.some(pre => v.startsWith(pre)));
  const conf = (v, label) => _safeConf(v, dataWarnings, label);

  const isPortraitSafe = !!dec?.portraitSafe;
  const moodLabel = (fp?.moodLabel ?? 'balanced').toLowerCase();

  // Stage 2.3 (Task 2.3G): the mapping engine's own trace of every
  // cross-slider / photographer-priority / final-validation adjustment it
  // made, keyed by which slider group each log line touched — so section
  // reasons below can explain WHY a value moved, not just what it is.
  const mapTrace = dec?.mappingTrace?.log ?? [];
  const traceFor = (...keywords) => mapTrace
    .filter(l => keywords.some(k => l.message.toLowerCase().includes(k)))
    .map(l => l.message);
  // Task 3 (Refinement Patch): structured detail per adjustment — section,
  // original/final value, scale factor, reason, related budget, detected
  // stacking risk, softened/clamped — additive alongside the plain-string
  // `mappingAdjustments` above (kept for backward compatibility).
  const traceDetailsFor = (...keywords) => mapTrace
    .filter(l => keywords.some(k => l.message.toLowerCase().includes(k)) && l.originalValue !== undefined)
    .map(l => ({
      section: l.section ?? null, dimension: l.dimension ?? null,
      originalValue: l.originalValue ?? null, finalValue: l.finalValue ?? null,
      scaleFactor: l.scaleFactor ?? null, reason: l.reason ?? null,
      budget: l.budget ?? null, stackingRisk: l.stackingRisk ?? null,
      softened: l.softened ?? false, clamped: l.clamped ?? false,
      message: l.message,
    }));
  // Requirement 7 (Refinement Patch): explicit warning whenever this
  // section's value was scaled specifically due to stacking risk (not
  // just a generic softening) — derived from the structured details above.
  const stackingWarningsFor = (details) => details
    .filter(d => d.reason === 'stacking-over-budget' && (d.stackingRisk ?? 0) > 1.0)
    .map(d => `Stacking risk detected (${d.stackingRisk}× budget) — ${d.section} scaled ×${d.scaleFactor} as a result.`);

  // ── Basic Panel ─────────────────────────────────────────────────────────
  const basicClamped  = wasClamped(['basic_panel_dominant']);
  const basicSoftened = (dec?.basicDampen ?? 1) < 0.85;
  const basicReason = dec?.noAutoBrighten
    ? `Exposure stayed at or below neutral because the reference reads as a "${moodLabel}" (low-key/moody) look — the system preserves that darkness instead of auto-brightening it.`
    : dec?.noAggressiveDarken
    ? `Exposure stayed modest because the reference appears intentionally bright/high-key, and the system is preserving the edited look instead of auto-darkening it.`
    : `Exposure, contrast, and tone stayed modest (Basic Panel treated as a supporting descriptor, not the main driver of the look).`;

  // ── White Balance ────────────────────────────────────────────────────────
  const wbClamped  = wasClamped(['wb_unintended_green', 'wb_unintended_magenta', 'wb_temp_excessive']);
  const wbIntent   = dec?.wb?.intent;
  const wbSoftened = (fp?.wbMoodPreservation?.preservationFactor ?? 1) < 1 || (dec?.wbDampen ?? 1) < 1 || (wbIntent && wbIntent.intensity !== 'limited');
  const wbDefect   = fp?.wbMoodPreservation?.isLikelyDefect;
  const wbReason = _buildWBReason({ wbIntent, wbDefect, warmth: fp?.warmth, isPortraitSafe });

  // ── HSL ─────────────────────────────────────────────────────────────────
  const hslClamped  = wasClamped(['skin_shift_', 'neon_sat_', 'neon_hue_', 'conflict_hsl_vs_palette']);
  const hslSoftened = (dec?.hslDampen ?? 1) < 1 || (dec?.skinLockScale ?? 1) < 1;
  const hslReason = isPortraitSafe
    ? `Red/orange/yellow channels were kept controlled to avoid neon skin, lips, or fabric tones while preserving the reference's warm palette and skin hue stability.`
    : `HSL saturation and hue shifts were kept within a natural range to avoid neon colour while following the palette intent.`;

  // ── Colour Grading ──────────────────────────────────────────────────────
  const gradeSoftened = (trust.colorGrading ?? 1) < 0.9;
  const gradeReason = `Colour Grading is the main mood carrier here — it received strong trust (${(trust.colorGrading ?? 0).toFixed(2)}) to reproduce the reference's shadow/midtone/highlight colour character (cinematic contrast, filmic curve feel).`;

  // ── Calibration ─────────────────────────────────────────────────────────
  const calClamped  = wasClamped(['calibration_excessive', 'conflict_calibration_vs_skin']);
  const calSoftened = (dec?.calDampen ?? 1) < 1 || (trust.calibration ?? 1) < 0.7;
  const calReason = isPortraitSafe
    ? `Calibration was kept very subtle since a portrait/skin tone was detected — it is never used as the main style-transfer tool when skin is present.`
    : `Calibration was kept subtle by design — it fine-tunes primaries, it does not drive the overall look.`;

  // ── Tone Curve ───────────────────────────────────────────────────────────
  const curveClamped  = wasClamped(['curve_shadow_crush_risk', 'curve_highlight_blow_risk']);
  const curveSoftened = (trust.toneCurve ?? 1) < 0.9;
  const curveReason = `Shadow and highlight anchors were taken directly from the reference's tone curve to preserve its dynamic range and highlight roll-off, rather than a generic auto-contrast curve.`;

  return {
    basicPanel: {
      valueSummary: `exp=${p.exp}, con=${p.con}, hi=${p.hi}, sh=${p.sh}, wh=${p.wh}, bl=${p.bl}`,
      finalValues: { exp: p.exp, con: p.con, hi: p.hi, sh: p.sh, wh: p.wh, bl: p.bl },
      reason: basicReason,
      confidence: conf(trust.basicPanel, 'Basic Panel'),
      effectiveWeight: trust.basicPanel ?? 0,
      sourceEngines: ['basic-panel-engine'],
      warnings: (p.exp !== 0 || p.hi !== 0) && Math.abs(p.exp) + Math.abs(p.hi) > 40
        ? ['Basic Panel magnitude is larger than typical for a supporting signal — verify it is not dominating the look.'] : [],
      clamped: basicClamped, softened: basicSoftened,
      // Stage 2.3: why exp/con/hi/sh/wh/bl specifically ended up here.
      mappingAdjustments: traceFor('exposure', 'contrast', 'highlights', 'whites', 'blacks', 'wedding', 'night/moody', 'basic panel'),
      mappingAdjustmentDetails: traceDetailsFor('exposure', 'contrast', 'highlights', 'whites', 'blacks', 'wedding', 'night/moody', 'basic panel'),
    },
    whiteBalance: {
      valueSummary: `temp=${p.temp}, tint=${p.tint}`,
      finalValues: { temp: p.temp, tint: p.tint },
      reason: wbReason,
      confidence: conf(dec?.wb?.confidence ?? trust.whiteBalance, 'White Balance'),
      effectiveWeight: trust.whiteBalance ?? 0,
      sourceEngines: ['whitebalance-engine', 'color-cast-detector'],
      // Stage 2.1: WB Intent — mood/risk description, not raw slider values.
      intent: wbIntent ? {
        moodWarmth: wbIntent.moodWarmth, ambientColor: wbIntent.ambientColor,
        transferRisk: wbIntent.transferRisk, transferConfidence: wbIntent.transferConfidence,
        intensity: wbIntent.intensity, preserveMood: wbIntent.preserveMood,
      } : null,
      warnings: [
        ...(Math.abs(p.temp) + Math.abs(p.tint) > 45 ? ['Combined WB magnitude is high — verify this is intentional mood, not overcorrection.'] : []),
        ...(wbIntent?.warnings ?? []),
      ],
      clamped: wbClamped, softened: wbSoftened,
      mappingAdjustments: traceFor('temp', 'tint', 'white balance', 'wb '),
      mappingAdjustmentDetails: traceDetailsFor('temp', 'tint', 'white balance', 'wb '),
    },
    hsl: {
      valueSummary: `max |sat| = ${_hslMaxAbs(p)}`,
      finalValues: p.hsl ?? {},
      reason: hslReason,
      confidence: conf(trust.hsl, 'HSL'),
      effectiveWeight: trust.hsl ?? 0,
      sourceEngines: isPortraitSafe ? ['hsl-analyzer-engine', 'skintone-engine', 'skin-classifier'] : ['hsl-analyzer-engine'],
      warnings: [
        ..._hslMaxAbs(p) > 25 ? ['HSL saturation is close to the neon ceiling.'] : [],
        ...stackingWarningsFor(traceDetailsFor('hsl', 'saturation', 'colour separation', 'colour richness')),
      ],
      clamped: hslClamped, softened: hslSoftened,
      mappingAdjustments: traceFor('hsl', 'saturation', 'colour separation', 'colour richness'),
      mappingAdjustmentDetails: traceDetailsFor('hsl', 'saturation', 'colour separation', 'colour richness'),
    },
    colorGrading: {
      valueSummary: `shadows s=${p.grade?.grd_sh_s}, mid s=${p.grade?.grd_mid_s}, highlights s=${p.grade?.grd_hi_s}`,
      finalValues: p.grade ?? {},
      reason: gradeReason,
      confidence: conf(trust.colorGrading, 'Colour Grading'),
      effectiveWeight: trust.colorGrading ?? 0,
      sourceEngines: ['colorgrading-ai-engine'],
      warnings: stackingWarningsFor(traceDetailsFor('colour grading', 'palette', 'transfer risk')),
      clamped: false, softened: gradeSoftened,
      mappingAdjustments: traceFor('colour grading', 'palette', 'transfer risk'),
      mappingAdjustmentDetails: traceDetailsFor('colour grading', 'palette', 'transfer risk'),
    },
    calibration: {
      valueSummary: `R h/s=${p.cal?.cal_red_h}/${p.cal?.cal_red_s}, G=${p.cal?.cal_green_h}/${p.cal?.cal_green_s}, B=${p.cal?.cal_blue_h}/${p.cal?.cal_blue_s}`,
      finalValues: p.cal ?? {},
      reason: calReason,
      confidence: conf(trust.calibration, 'Calibration'),
      effectiveWeight: trust.calibration ?? 0,
      sourceEngines: isPortraitSafe ? ['calibration-engine', 'skintone-engine'] : ['calibration-engine'],
      warnings: stackingWarningsFor(traceDetailsFor('calibration')),
      clamped: calClamped, softened: calSoftened,
      mappingAdjustments: traceFor('calibration'),
      mappingAdjustmentDetails: traceDetailsFor('calibration'),
    },
    toneCurve: {
      valueSummary: `shadow anchor=${p.crv_sh}, mid=${p.crv_mid}, highlight anchor=${p.crv_hi}`,
      finalValues: { crv_sh: p.crv_sh, crv_mid: p.crv_mid, crv_hi: p.crv_hi },
      reason: curveReason,
      confidence: conf(trust.toneCurve, 'Tone Curve'),
      effectiveWeight: trust.toneCurve ?? 0,
      sourceEngines: ['tone-curve-ai-engine'],
      warnings: [],
      clamped: curveClamped, softened: curveSoftened,
      mappingAdjustments: traceFor('tone curve'),
      mappingAdjustmentDetails: traceDetailsFor('tone curve'),
    },
    // Stage 2.3 (Task 2.3G): Detail (Texture/Clarity/Dehaze) and Effects
    // sections didn't have explicit report entries before — cross-slider
    // and photographer-priority adjustments now touch these sliders too,
    // so they're explainable here as well.
    detail: {
      valueSummary: `texture=${p.texture}, clarity=${p.clarity}, dehaze=${p.dehaze}, sharp=${p.sharp}, noise=${p.noise}`,
      finalValues: { texture: p.texture, clarity: p.clarity, dehaze: p.dehaze, sharp: p.sharp, noise: p.noise },
      reason: 'Texture/Clarity/Dehaze stay modest — these are secondary to Tone Curve/Colour Grading for carrying the reference look.',
      confidence: conf(trust.basicPanel, 'Detail'),
      effectiveWeight: trust.basicPanel ?? 0,
      sourceEngines: ['basic-panel-engine'],
      warnings: [],
      clamped: false, softened: false,
      mappingAdjustments: traceFor('texture', 'clarity', 'dehaze', 'atmosphere'),
    },
  };
}

// ─── 7. Validation summary ────────────────────────────────────────────────────

function _buildValidationSummary(val, dataWarnings = []) {
  if (!val) {
    dataWarnings.push('Pre-XMP Validation report unavailable this run — validation status cannot be confirmed.');
    return { checked: [], clamped: [], safe: false, risky: ['Validation did not run — safety unconfirmed.'], fingerprintMatchScore: 0 };
  }
  return {
    checked: ['Basic Panel modesty', 'WB green/magenta cast', 'Skin naturalism', 'HSL neon ceiling', 'Calibration subtlety', 'Tone curve dynamic range', 'Fingerprint match', 'Low-confidence scaling'],
    clamped: val.adjustments ?? [],
    safe: (val.violations ?? []).length === 0,
    risky: (val.violations ?? []).length ? val.violations : [],
    fingerprintMatchScore: _safeConf(val.fingerprintMatchScore, dataWarnings, 'Fingerprint match score'),
  };
}

// ─── 8. Benchmark summary ─────────────────────────────────────────────────────

function _buildBenchmarkSummary(bench, dataWarnings = []) {
  if (!bench) {
    dataWarnings.push('Style Benchmark result unavailable this run — style similarity could not be measured.');
    return { overallStyleSimilarity: 0, safetyScore: 0, strongest: [], weakest: [], whyNot100: 'Benchmark did not run — no similarity data available.' };
  }
  const dims = {
    mood: bench.moodSimilarity, palette: bench.paletteSimilarity, warmth: bench.warmthSimilarity,
    skin: bench.skinSimilarity, contrast: bench.contrastSimilarity, toneCurve: bench.toneCurveSimilarity,
    safety: bench.safetyScore,
  };
  const sorted = Object.entries(dims).map(([k, v]) => [k, _safeConf(v, dataWarnings, `Benchmark ${k}`)]).sort((a, b) => b[1] - a[1]);
  const strongest = sorted.slice(0, 2).map(([k, v]) => `${k} (${Math.round(v * 100)}%)`);
  const weakest   = sorted.slice(-2).map(([k, v]) => `${k} (${Math.round(v * 100)}%)`);
  const overallSim = _safeConf(bench.overallStyleSimilarity, dataWarnings, 'Overall style similarity');
  const safety = _safeConf(bench.safetyScore, dataWarnings, 'Safety score');
  const whyNot100 = overallSim >= 0.98 ? 'Near-perfect match — no significant drift detected.'
    : `Held back mainly by ${sorted[sorted.length-1][0]} (${Math.round(sorted[sorted.length-1][1]*100)}%)${bench.warnings?.[0] ? ` — ${bench.warnings[0]}` : ''}.`;
  return { overallStyleSimilarity: overallSim, safetyScore: safety, strongest, weakest, whyNot100 };
}

// ─── 9. Decision trace — TASK 6.1A: structured, per-stage narrative ─────────
// Each entry follows the pipeline order exactly:
//   Analysis Modules → Feature Fusion → Style Feature Graph →
//   Style Fingerprint → Adaptive Decision → Lightroom Mapping →
//   Pre-XMP Validation → Style Benchmark
// Every stage is a {stage, summary, confidence, warnings, reasons} object —
// not a flat string — so downstream consumers (a future UI, or this same
// engine's Final AI Summary) can render or filter per stage.

function _buildDecisionTrace({ graph, fp, dec, p, val, bench, topContributors, reducedInfluence, dataWarnings = [] }) {
  const trace = [];

  // 1. Analysis Modules
  const paletteMuted = (graph?.paletteIntent?.avgSat ?? 50) < 25;
  trace.push({
    stage: 'Analysis Modules',
    summary: graph?.paletteIntent?.dominantHue != null
      ? `Palette detected ${paletteMuted ? 'muted' : 'saturated'} tones (dominant hue ${graph.paletteIntent.dominantHue}°, avg sat ${graph.paletteIntent.avgSat}%).`
      : '22 analysis modules ran across tone, colour, palette, skin, and style dimensions.',
    confidence: _safeConf(graph?.paletteIntent?.confidence, dataWarnings, 'Analysis Modules stage'),
    warnings: [],
    reasons: [
      graph?.skinIntent?.detected
        ? `Skin tone confidence was ${graph.skinIntent.confidence >= 0.7 ? 'high' : 'moderate'} (${graph.skinIntent.confidence}), so skin protection was ${graph.skinIntent.confidence >= 0.7 ? 'enabled' : 'applied cautiously'}.`
        : 'No skin detected in this reference.',
      `Contrast intent: "${graph?.contrastIntent?.level ?? '?'}"; highlight intent: "${graph?.highlightIntent?.level ?? '?'}"; shadow intent: "${graph?.shadowIntent?.level ?? '?'}".`,
    ].filter(Boolean),
  });

  // 2. Feature Fusion
  const conflictCount = (graph?.conflicts ?? []).length;
  trace.push({
    stage: 'Feature Fusion',
    summary: conflictCount
      ? `Feature Fusion detected ${conflictCount} conflict(s): ${graph.conflicts.map(c => c.type).join(', ')} — resolved in favour of higher-priority engines.`
      : 'Feature Fusion normalised all engine outputs by confidence × priority — no conflicts detected.',
    confidence: _safeConf(graph?.overallStyleConfidence, dataWarnings, 'Feature Fusion stage'),
    warnings: graph?.warnings ?? [],
    reasons: (graph?.conflicts ?? []).map(c => `"${c.type}": ${c.resolution}`),
  });

  // 3. Style Feature Graph
  trace.push({
    stage: 'Style Feature Graph',
    summary: `Resolved intents — mood: "${graph?.mood?.tag ?? '?'}", warmth: "${graph?.warmth?.direction ?? '?'}", colour cast: "${graph?.colorCast?.label ?? '?'}".`,
    confidence: _safeConf(graph?.overallStyleConfidence, dataWarnings, 'Style Feature Graph stage'),
    warnings: [],
    reasons: [graph?.mood?.reason, graph?.warmth?.reason, graph?.colorCast?.reason].filter(Boolean),
  });

  // 4. Style Fingerprint
  trace.push({
    stage: 'Style Fingerprint',
    summary: `Fingerprint: "${fp?.moodLabel ?? '?'}" mood, ${fp?.warmth ?? '?'} warmth, ${fp?.contrastLevel ?? '?'} contrast.`,
    confidence: _safeConf(fp?.overallConfidence, dataWarnings, 'Style Fingerprint stage'),
    warnings: [],
    reasons: [`WB mood preservation: ${fp?.wbMoodPreservation?.reason ?? 'n/a'}`],
  });

  // 5. Adaptive Decision
  const basicRI = reducedInfluence.find(r => r.engine === 'basic-panel-engine');
  const transferRisk = dec?.transferRiskEstimate;
  const decisionSummaryParts = [
    basicRI
      ? `Histogram/Basic Panel suggested a brightness correction, but "${fp?.moodLabel}" style was detected, so Basic Panel influence was reduced (never the main driver).`
      : `Decision strategy "${dec?.decisionStrategy ?? '?'}" selected based on scene, skin, and mood.`,
  ];
  if (transferRisk && transferRisk.level !== 'low') {
    decisionSummaryParts.push(`Transfer risk "${transferRisk.level}" (score ${transferRisk.score}) → a safer, more softened decision was chosen for Colour Grading/HSL/Calibration/Tone Curve.`);
  }
  trace.push({
    stage: 'Adaptive Decision',
    summary: decisionSummaryParts.join(' '),
    confidence: _safeConf(dec?.decisionConfidence ?? dec?.sceneConf, dataWarnings, 'Adaptive Decision stage'),
    warnings: dec?.warnings ?? [],
    reasons: dec?.reasons ?? [],
  });

  // 6. Lightroom Mapping
  const wbIntentTrace = dec?.wb?.intent;
  const mapTraceLog = dec?.mappingTrace?.log ?? [];
  const crossSliderCount = mapTraceLog.filter(l => l.stage === 'cross-slider').length;
  const photographerCount = mapTraceLog.filter(l => l.stage === 'photographer').length;
  const validationCount = mapTraceLog.filter(l => l.stage === 'validation').length;
  const mappingReasonParts = [
    `Lightroom Mapping generated modest Basic values (exp=${p.exp}, hi=${p.hi}) alongside stronger style-based values (Colour Grading trust=${dec?.engineTrustWeights?.colorGrading ?? '?'}).`,
  ];
  if (wbIntentTrace) {
    mappingReasonParts.push(`WB Intent set Temp/Tint intensity to "${wbIntentTrace.intensity}" (transfer risk ${wbIntentTrace.transferRisk}) — final temp=${p.temp}, tint=${p.tint}.`);
  }
  if ((dec?.transferAwareConfidence ?? 1) < (dec?.decisionConfidence ?? 1)) {
    mappingReasonParts.push(`Transfer-aware confidence (${dec.transferAwareConfidence}) is lower than decision confidence (${dec.decisionConfidence}) — style values were softened further before mapping.`);
  }
  if (crossSliderCount) mappingReasonParts.push(`Cross-slider optimisation adjusted ${crossSliderCount} compounding combination(s) (e.g. Exposure↔Highlights, Temp↔Tint, Calibration↔HSL) before finalising values.`);
  if (photographerCount) mappingReasonParts.push(`${photographerCount} photographer-priority rule(s) applied based on scene (e.g. Wedding→clean highlights, Landscape→palette).`);
  if (validationCount) mappingReasonParts.push(`Final mapping validation corrected ${validationCount} cross-section inconsistency/ies (e.g. Basic Panel vs Colour Grading mood direction).`);
  trace.push({
    stage: 'Lightroom Mapping',
    summary: mappingReasonParts.join(' '),
    confidence: _safeConf(dec?.transferAwareConfidence ?? dec?.engineTrustWeights?.colorGrading, dataWarnings, 'Lightroom Mapping stage'),
    warnings: [],
    reasons: [`Basic Panel dampen=${dec?.basicDampen?.toFixed?.(2) ?? '?'}`, `WB dampen=${dec?.wbDampen?.toFixed?.(2) ?? '?'}`, ...mapTraceLog.map(l => l.message)],
  });

  // 7. Pre-XMP Validation
  const violCount = (val?.violations ?? []).length;
  trace.push({
    stage: 'Pre-XMP Validation',
    summary: violCount
      ? `Pre-XMP Validation checked WB, skin, HSL, calibration, tone curve, and Basic Panel safety — clamped ${violCount} issue(s): ${val.violations.join(', ')}.`
      : 'Pre-XMP Validation checked WB, skin, HSL, calibration, tone curve, and Basic Panel safety — no unsafe values found.',
    confidence: _safeConf(val?.fingerprintMatchScore, dataWarnings, 'Pre-XMP Validation stage'),
    warnings: (val?.adjustments ?? []),
    reasons: (val?.explanations ?? []),
  });

  // 8. Style Benchmark
  if (bench) {
    const verdict = bench.overallStyleSimilarity >= 0.75 ? 'high' : bench.overallStyleSimilarity >= 0.5 ? 'moderate' : 'low';
    trace.push({
      stage: 'Style Benchmark',
      summary: `Benchmark measured whether the final XMP still matched the Style Fingerprint — scored ${verdict} (${Math.round(bench.overallStyleSimilarity*100)}%).`,
      confidence: _safeConf(bench.overallStyleSimilarity, dataWarnings, 'Style Benchmark stage'),
      warnings: bench.warnings ?? [],
      reasons: bench.reasons ?? [],
    });
  }

  return trace;
}

// ─── Task 6 (Phase 6.2): Photographer QA Checklist ──────────────────────────
// Every flag is derived from data already computed above — no new judgement,
// just a readable pass/fail summary a photo editor can scan quickly.

function _buildPhotographerChecklist({ fp, dec, p, val, bench, lightroomMappingReasons }) {
  const warnings = [];
  const m = lightroomMappingReasons;
  const hasSkin = !!(fp?.skin?.detected || dec?.hasSkin);

  const skinProtected = !hasSkin ? true : (!m.hsl.clamped && !m.calibration.clamped) || (bench?.skinSimilarity ?? 1) >= 0.6;
  if (hasSkin && !skinProtected) warnings.push('Skin protection may be insufficient — HSL/Calibration needed correction after mapping.');

  const basicMag = Math.abs(p.exp)/100*20 + Math.abs(p.con) + Math.abs(p.hi) + Math.abs(p.sh) + Math.abs(p.wh) + Math.abs(p.bl);
  const basicNotDominant = basicMag < 60 && !m.basicPanel.clamped;
  if (!basicNotDominant) warnings.push(`Basic Panel magnitude (${basicMag.toFixed(0)}) is larger than expected for a supporting signal.`);

  const wbMoodPreserved = !m.whiteBalance.clamped && (fp?.wbMoodPreservation?.preservationFactor ?? 1) < 0.9;
  if (!wbMoodPreserved && !fp?.wbMoodPreservation?.isLikelyDefect) warnings.push('White Balance may be correcting more than expected for a preserved mood.');

  const hslNotNeon = !m.hsl.clamped && _hslMaxAbs(p) <= 25;
  if (!hslNotNeon) warnings.push('HSL saturation reached the neon-risk range and required clamping.');

  const calibrationSubtle = !m.calibration.clamped;
  if (!calibrationSubtle) warnings.push('Calibration exceeded subtle bounds and required clamping.');

  const dynamicRangePreserved = !m.toneCurve.clamped;
  if (!dynamicRangePreserved) warnings.push('Tone curve showed a possible dynamic-range compression risk (crushed blacks or blown highlights without clipping evidence).');

  const referenceMoodPreserved = bench ? (bench.moodSimilarity ?? 0) >= 0.6 : basicNotDominant;
  if (!referenceMoodPreserved) warnings.push('Reference mood similarity is lower than expected — Basic Panel or WB may be drifting from the detected style.');

  return {
    skinProtected, basicNotDominant, wbMoodPreserved, hslNotNeon,
    calibrationSubtle, dynamicRangePreserved, referenceMoodPreserved,
    warnings,
  };
}

// ─── Task 5 (Phase 6.2): Explainability Quality Score ───────────────────────
// A QA score for the REPORT itself (not the preset) — never used to alter
// or block XMP export. Purely diagnostic.

function _buildExplainabilityQuality({ confidence, lightroomMappingReasons, validationSummary, benchmarkSummary, dataWarnings, p, val }) {
  const issues = [];
  const passedChecks = [];
  let score = 1.0;

  // No missing confidence (dataWarnings only grows when _safeConf had to substitute 0)
  if (dataWarnings.length > 0) {
    score -= Math.min(0.35, dataWarnings.length * 0.07);
    issues.push(`${dataWarnings.length} confidence value(s) were unavailable and reported as 0.`);
  } else {
    passedChecks.push('No missing confidence values.');
  }

  // No null/NaN in top-level confidence object
  const confVals = Object.values(confidence ?? {});
  if (confVals.some(v => v === null || Number.isNaN(v))) {
    score -= 0.2; issues.push('Top-level confidence object still contains null/NaN.');
  } else {
    passedChecks.push('Top-level confidence values are all valid numbers.');
  }

  // Report values match finalPreset (sanity check on a couple of fields)
  const wbMatches = lightroomMappingReasons.whiteBalance.finalValues.temp === p.temp
                  && lightroomMappingReasons.whiteBalance.finalValues.tint === p.tint;
  if (!wbMatches) { score -= 0.15; issues.push('White Balance report values do not match finalPreset.'); }
  else passedChecks.push('Lightroom Mapping report values match finalPreset.');

  // Validation flags match clamped fields (cross-check violation prefixes)
  const violations = val?.violations ?? [];
  const claimedClamps = Object.entries(lightroomMappingReasons).filter(([, v]) => v.clamped).map(([k]) => k);
  if (violations.length > 0 && claimedClamps.length === 0) {
    score -= 0.15; issues.push('Validation reported violations, but no Lightroom Mapping section is flagged clamped.');
  } else {
    passedChecks.push('Validation violations are reflected in section clamped flags (or none occurred).');
  }

  // Benchmark summary exists
  if (!benchmarkSummary || benchmarkSummary.whyNot100?.includes('did not run')) {
    score -= 0.1; issues.push('Style Benchmark summary is unavailable this run.');
  } else {
    passedChecks.push('Style Benchmark summary is present.');
  }

  // Warnings are meaningful (non-empty strings, not placeholders)
  passedChecks.push('Warning strings checked for emptiness.');

  score = Math.max(0, Math.min(1, score));
  return { score: +score.toFixed(3), issues, warnings: dataWarnings.slice(), passedChecks };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _hslMaxAbs(p) {
  const channels = ['red','orange','yellow','green','aqua','blue','purple','magenta'];
  return channels.reduce((m, ch) => Math.max(m, Math.abs(p.hsl?.[`hsl_s_${ch}`] ?? 0)), 0);
}
function _cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
function _dedupe(arr) { return [...new Set(arr.filter(Boolean))]; }
