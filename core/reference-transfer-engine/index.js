import { buildCaptureCapability, buildIntentCompatibility, buildCaptureBudgetHints } from '../image-analysis/capture-capability-model.js';
import { buildStyleBudgetIntelligence } from '../decision-engine/style-budget-model.js';

/**
 * core/reference-transfer-engine/index.js
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * REFERENCE TRANSFER INTELLIGENCE (Phase 6.3)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   ... Style Benchmark → Explainability Engine →
 *   [ REFERENCE TRANSFER INTELLIGENCE ] → XMP Export
 *
 * This module answers a question the pipeline has never asked before:
 * "will this extracted preset still look right on a DIFFERENT RAW photo?"
 *
 * It separates three concepts that must never be conflated:
 *
 *  1. Reference Analysis Confidence — how well did the pipeline UNDERSTAND
 *     this reference image? (mostly already computed — fingerprint /
 *     feature-graph confidence, summarised here.)
 *
 *  2. Transfer Confidence — how safely can the DETECTED STYLE be carried
 *     onto a different photo? A perfectly-understood reference can still be
 *     a BAD candidate for transfer if its look depends heavily on this
 *     exact scene's lighting, this exact subject's skin, or edits no
 *     global Lightroom slider can reproduce.
 *
 *  3. Lightroom Reproduction Estimate — of the style that IS transferable,
 *     how much of it can a global XMP preset actually reproduce, versus
 *     how much came from local/manual edits Lightroom sliders can't touch?
 *
 * Nothing here re-analyses pixels or adds a new analysis engine — every
 * signal is read from data the pipeline already computed (Style Feature
 * Graph, Style Fingerprint, Decision Strategy, Style Benchmark, Pre-XMP
 * Validation, and — where available — image-analysis-core's sharpness/
 * noise/edge-density numbers). Per the spec: Benchmark measures internal
 * pipeline quality; this module measures real-world portability. The two
 * are reported side by side, never merged into one number.
 */

const clamp01 = (v) => Math.max(0, Math.min(1, v ?? 0));

// EPIC 2E-H-B-F FIX 6/7/8: shared safety helpers for the Visual
// Preview Render Plan compact preservation below.

// Tri-state boolean — missing/non-boolean evidence is honestly `null`,
// never coerced to `false` ("confirmed safe") or `true`.
// EPIC 2E-H-B-F2 FIX 2: safe property access — a malformed object with
// a throwing getter must never crash Reference Transfer construction.
// Any read that throws is treated as missing evidence, never an
// uncaught exception.
function safeGetRT(object, key, fallback = undefined) {
  try {
    if (!object || typeof object !== 'object') return fallback;
    return object[key];
  } catch {
    return fallback;
  }
}

function _triStateBooleanRT(value) {
  return value === true ? true : value === false ? false : null;
}

// FIX 8: normalize an untrusted array into bounded, deduplicated,
// primitive-string-only entries — never a shallow copy of arbitrary
// object entries.
function _boundedStringArrayRT(arr, limit = 10) {
  const safeArr = Array.isArray(arr) ? arr : [];
  const seen = new Set();
  const out = [];
  for (const item of safeArr) {
    if (typeof item !== 'string') continue;
    const t = item.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t.length > 300 ? `${t.slice(0, 300)}…` : t);
    if (out.length >= limit) break;
  }
  return out;
}

// FIX 7: a canonical string field is preserved ONLY when it is
// actually one of the given allowed values — otherwise honestly
// "unknown", never defaulted to a value that looks like confirmed
// evidence (e.g. "legacy") when the source data never said so.
function _canonicalStringRT(value, allowed, unknownValue = 'unknown') {
  return allowed.includes(value) ? value : unknownValue;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * @param {{
 *   stats: object, styleFeatureGraph: object, styleFingerprint: object,
 *   decisionStrategy: object,   // finalPreset._decision
 *   finalPreset: object, preXmpValidation: object, styleBenchmark: object,
 *   wb: object|null,             // raw whitebalance-engine result (for moodPreservation.magnitude)
 *   cast: object|null,           // raw color-cast-detector result (zone labels)
 *   imageAnalysisCore: object|null,  // sharpness/noise/edgeDensity, if resolved by this point
 * }} ctx
 * @returns {object} referenceTransferReport — see TASK 6.3E shape
 */
export function buildReferenceTransferReport(ctx) {
  const referenceConfidence = _buildReferenceConfidence(ctx);
  const { complexity, signalNames } = _analyzeComplexity(ctx);         // TASK 6.3A
  const wbTransferRisk       = _analyzeWBTransfer(ctx);               // TASK 6.3D
  const transferConfidence   = _computeTransferConfidence(ctx, complexity, wbTransferRisk); // TASK 6.3B
  const lightroomReproduction= _estimateLightroomReproduction(signalNames, complexity);     // TASK 6.3C
  const recommendations      = _buildRecommendations({ ctx, complexity, transferConfidence, wbTransferRisk, lightroomReproduction });

  // Stage 2.4 Task 2.4E: Editing Distance Estimate — how far the generated
  // XMP is likely to be from a finished professional edit. Reuses signals
  // already available in ctx (no new measurement) — benchmark score and
  // validation warnings were already passed in for Task 2.4D-style scoring.
  const editingDistanceEstimate = _buildEditingDistanceEstimate({ ctx, complexity, transferConfidence, wbTransferRisk });

  // Stage 2.4.2B.2: Style Feasibility Intelligence — answers "can this
  // detected style realistically be reproduced through Lightroom XMP?",
  // distinct from Style DNA Validation ("is the DNA internally logical?").
  // Computed HERE (not in Decision Engine) because this is the first point
  // in the pipeline where complexity, transferConfidence,
  // lightroomReproduction, wbTransferRisk, styleBenchmark, and Pre-XMP
  // Validation are ALL simultaneously available — Decision Engine runs
  // before any of those exist (same architectural constraint documented
  // in every prior transfer-risk stage). Decision Engine instead attaches
  // a lightweight PRELIMINARY estimate at decision time (see
  // finalStyleIntent.styleFeasibilityEstimate in core/decision-engine) —
  // this is the authoritative version.
  const styleFeasibility = _computeStyleFeasibility({ ctx, complexity, transferConfidence, lightroomReproduction, wbTransferRisk, referenceConfidence });

  const recommendations2 = _buildFeasibilityRecommendations({ recommendations, styleFeasibility, referenceConfidence, transferConfidence, lightroomReproduction });

  // ── EPIC 1.6: Capture Capability Intelligence (authoritative) ────────────
  // The first point in the pipeline where imageAnalysisCore's real noise/
  // sharpness data is available — Decision Engine's own
  // captureCapabilityEstimate used imageAnalysisCore:null and is only a
  // preliminary read. Same buildCaptureCapability() function, never a
  // second copy of its logic — only the inputs differ.
  const dec = ctx.decisionStrategy;
  const captureCapability = buildCaptureCapability({
    stats: ctx.stats, imageAnalysisCore: ctx.imageAnalysisCore ?? null,
    skinConfidence: dec?.skinConfidence, styleFeasibility, transferConfidence, benchmark: ctx.styleBenchmark,
  });
  const intentCompatibility = buildIntentCompatibility(
    dec?.finalStyleIntent?.photographerIntent?.primaryIntent ?? 'Natural', captureCapability
  );
  const captureBudgetHints = buildCaptureBudgetHints(captureCapability);

  // Task 8: explain why transfer reads easy/medium/hard using capture
  // capability specifically (distinct from the complexity/WB-risk-based
  // explanation _buildRecommendations already gives).
  const transferEase = captureCapability.overallScore >= 0.7 ? 'easy' : captureCapability.overallScore >= 0.45 ? 'medium' : 'hard';
  recommendations2.push(`Transfer difficulty from a capture-capability standpoint: "${transferEase}" — ${captureCapability.reasons[0]}`);
  if (!intentCompatibility.compatible) {
    recommendations2.push(`[dev] Detected intent "${dec?.finalStyleIntent?.photographerIntent?.primaryIntent}" may not be fully achievable given this capture's limitations — see referenceTransferReport.intentCompatibility.limitations.`);
  }

  // ── EPIC 1.7: Style Budget Intelligence (authoritative) ──────────────────
  // Same buildStyleBudgetIntelligence() function Decision Engine calls
  // preliminarily — here with the AUTHORITATIVE styleFeasibility and
  // captureCapability (both just computed above with real
  // imageAnalysisCore data), producing a more reliable allocation than
  // Decision Engine's own preliminary styleBudgetIntelligence estimate.
  const styleBudgetIntelligence = buildStyleBudgetIntelligence({
    photographerIntent: dec?.finalStyleIntent?.photographerIntent,
    photographerStyle: dec?.finalStyleIntent?.photographerStyle,
    styleFeasibility, captureCapability,
    referenceColorIntelligence: ctx.referenceColorIntelligence ?? null,
  });

  // Task 10: explain why transfer should be conservative or expressive
  // using the budget's own overall level — additive to recommendations,
  // does not touch the transfer algorithm itself anywhere in this file.
  // Patch 5 (EPIC 1.7F): vocabulary aligned to conservative/balanced/
  // expressive/aggressive-risky — "assertive" no longer exists as a value.
  if (styleBudgetIntelligence.budgetLevel === 'conservative') {
    recommendations2.push(`Style Budget suggests a conservative approach overall (${styleBudgetIntelligence.overallBudget}) — several look components should be softened rather than applied at full strength. See styleBudgetIntelligence.suppressedAreas.`);
  } else if (styleBudgetIntelligence.budgetLevel === 'expressive') {
    recommendations2.push(`Style Budget suggests the detected intent can be applied expressively (${styleBudgetIntelligence.overallBudget}) — capture capability and DNA validation both support a fuller-strength transfer.`);
  } else if (styleBudgetIntelligence.budgetLevel === 'aggressive-risky') {
    recommendations2.push(`[dev] Style Budget is "aggressive-risky" (${styleBudgetIntelligence.overallBudget}) — a high overall allocation combined with a real risk signal (low safety budget, high stacking risk, or limited capture capability). This is a warning label only; treat the look as needing conservative, careful application despite the high budget.`);
  }
  if (styleBudgetIntelligence.budgetStackingRisk.hasRisk) {
    recommendations2.push(`[dev] Budget stacking risk (${styleBudgetIntelligence.budgetStackingRisk.severity}): ${styleBudgetIntelligence.budgetStackingRisk.riskType} — see styleBudgetIntelligence.budgetStackingRisk before EPIC 2's Lightroom Mapping V2 consumes this budget.`);
  }
  if (styleBudgetIntelligence.noiseReliability?.status !== 'measured') {
    recommendations2.push(`Note: ${styleBudgetIntelligence.noiseReliability.reason}`);
  }

  // EPIC 2D: compact Shadow Compare V2 context — read-only, additive to
  // recommendations only, does not touch the transfer algorithm itself.
  const shadowCompare = dec?.finalStyleIntent?.lightroomShadowCompareReportV2 ?? null;
  if (shadowCompare) {
    const status = shadowCompare.safetyDelta?.status ?? 'uncertain';
    const legacyAvailable = shadowCompare.legacySummary?.available === true;
    const stanceText = !legacyAvailable
      ? 'appears more safety-aware, but direct legacy comparison is incomplete'
      : status === 'safer-estimate' ? 'currently looks safer/more cautious than'
      : status === 'riskier' ? 'currently carries unresolved risk compared to'
      : 'appears broadly similar to, with safety not yet confidently proven either way, compared to';
    recommendations2.push(`Shadow Compare V2: the experimental V2 mapping chain ${stanceText} the active legacy mapping (still shadow-only, not used for this export).`);
    if (shadowCompare.divergenceAnalysis?.hasMajorDivergence) {
      recommendations2.push(`[dev] Shadow Compare divergence (${shadowCompare.divergenceAnalysis.severity}): ${shadowCompare.divergenceAnalysis.divergentAreas.join(', ')}.`);
    }
    if (shadowCompare.activationReadiness?.blockers?.length) {
      recommendations2.push(`[dev] Remaining activation blockers: ${shadowCompare.activationReadiness.blockers[0]}${shadowCompare.activationReadiness.blockers.length > 1 ? ` (+${shadowCompare.activationReadiness.blockers.length - 1} more)` : ''}.`);
    }
  }

  // EPIC 2E-A: compact Controlled Activation context — read-only,
  // additive to recommendations only, does not touch the transfer
  // algorithm itself.
  const controlledActivation = dec?.finalStyleIntent?.lightroomControlledActivationV2 ?? null;
  if (controlledActivation) {
    recommendations2.push(`Controlled Activation: Mapping V2 is ${controlledActivation.canUseV2 ? 'active' : 'not yet active'} — this export uses ${controlledActivation.selectedMappingSource === 'legacy' ? 'Legacy Mapping' : 'Mapping V2'}.`);
    if (controlledActivation.blockers?.length) {
      recommendations2.push(`[dev] Activation blockers: ${controlledActivation.blockers[0].blocker}${controlledActivation.blockers.length > 1 ? ` (+${controlledActivation.blockers.length - 1} more)` : ''}.`);
    }
    recommendations2.push(`[dev] Fallback: ${controlledActivation.fallbackStrategy?.selectedFallback ?? 'legacy Lightroom Mapping'} (useLegacyMapping=${controlledActivation.fallbackStrategy?.useLegacyMapping ?? true}).`);
  }

  // EPIC 2E-B: compact Legacy Safety Overlay context — read-only,
  // additive to recommendations only, does not touch the transfer
  // algorithm itself.
  const overlay = dec?.finalStyleIntent?.legacySafetyOverlayV2 ?? null;
  if (overlay) {
    recommendations2.push(`Legacy Safety Overlay: Legacy Mapping is still active${overlay.canApplyOverlay ? '' : ' and the overlay is advice-only'} — it is ${overlay.canApplyOverlay ? 'eligible to guardrail output' : 'not changing exported XMP'}.`);
    if ((overlay.protectedAreas ?? []).length) {
      recommendations2.push(`[dev] Overlay protects: ${overlay.protectedAreas.slice(0, 4).map(a => a.area).join(', ')}${overlay.protectedAreas.length > 4 ? ', …' : ''}.`);
    }
    if (overlay.blockers?.length) {
      recommendations2.push(`[dev] Overlay blockers: ${overlay.blockers[0].blocker}${overlay.blockers.length > 1 ? ` (+${overlay.blockers.length - 1} more)` : ''}.`);
    }
  }

  // EPIC 2E-C: compact Overlay Simulation context — read-only, additive
  // to recommendations only, does not touch the transfer algorithm.
  const simulation = dec?.finalStyleIntent?.legacyOverlaySimulationV2 ?? null;
  if (simulation) {
    recommendations2.push(`Overlay Simulation: Legacy Mapping remains active — production write is disabled, so simulation is preview-only (${simulation.simulatedOverlayActions?.length ?? 0} simulated action(s)).`);
    if ((simulation.simulatedRiskAfter?.remainingRisks ?? []).length) {
      recommendations2.push(`[dev] Unresolved simulated risks: ${simulation.simulatedRiskAfter.remainingRisks.slice(0, 3).join(', ')}${simulation.simulatedRiskAfter.remainingRisks.length > 3 ? ', …' : ''}.`);
    }
  }

  // EPIC 2E-D: compact Controlled Overlay Test Gate context — read-only,
  // additive to recommendations only, does not touch the transfer
  // algorithm itself.
  const testGate = dec?.finalStyleIntent?.controlledOverlayTestGateV2 ?? null;
  if (testGate) {
    recommendations2.push(`Controlled Overlay Test Gate: Legacy Mapping remains active — controlled test is ${testGate.canEnterControlledTest ? 'allowed' : 'not allowed'} (state: ${testGate.testState}).`);
    const humanReviewItem = (testGate.humanReviewChecklist ?? []).find(c => c.required);
    if (humanReviewItem) {
      recommendations2.push(`[dev] Human review status: ${humanReviewItem.status} (${(testGate.humanReviewChecklist ?? []).filter(c => c.status === 'pending').length} item(s) pending).`);
    }
    if (testGate.blockers?.length) {
      recommendations2.push(`[dev] Test gate blockers: ${testGate.blockers[0].blocker}${testGate.blockers.length > 1 ? ` (+${testGate.blockers.length - 1} more)` : ''}.`);
    }
  }

  // EPIC 2E-E-F: compact Controlled Overlay Preview Sandbox context using
  // CANONICAL field names — read-only, additive to recommendations only,
  // does not touch the transfer algorithm itself.
  const previewSandbox = dec?.finalStyleIntent?.controlledOverlayPreviewSandboxV2 ?? null;
  if (previewSandbox) {
    recommendations2.push(`Preview Sandbox: Legacy Mapping remains active — preview export is ${previewSandbox.canExportPreview ? 'allowed' : 'disabled'} (state: ${previewSandbox.previewState}).`);
    const protectedAreas = previewSandbox.previewPlan?.protectedAreas ?? [];
    if (protectedAreas.length) {
      recommendations2.push(`[dev] Top preview protections: ${protectedAreas.slice(0, 3).join(', ')}${protectedAreas.length > 3 ? ', …' : ''}.`);
    }
    const unresolvedRisks = previewSandbox.previewPlan?.actions?.filter(a => a.action === 'require-human-review').map(a => a.target) ?? [];
    if (unresolvedRisks.length) {
      recommendations2.push(`[dev] Unresolved preview risks: ${unresolvedRisks.slice(0, 3).join(', ')}${unresolvedRisks.length > 3 ? ', …' : ''}.`);
    }
  }

  // EPIC 2E-F Phase B: compact Controlled Preview Human Review context —
  // read-only, additive to recommendations only, does not touch the
  // transfer algorithm. `controlledPreviewReviewStateV2` itself is not
  // cloned or reconstructed here (this function only READS
  // dec.finalStyleIntent, it never rebuilds it), so the canonical object
  // on finalStyleIntent is preserved automatically without needing a
  // second, conflicting Review State object.
  const reviewState = dec?.finalStyleIntent?.controlledPreviewReviewStateV2 ?? null;
  // EPIC 2E-G Phase B: same pass-through pattern as reviewState above —
  // this reads the canonical object already attached to
  // dec.finalStyleIntent (never rebuilds finalStyleIntent), so the
  // canonical sideBySidePreviewComparisonV2 object is preserved as-is
  // automatically.
  const sideBySideComparison = dec?.finalStyleIntent?.sideBySidePreviewComparisonV2 ?? null;
  // EPIC 2E-H Phase B: same pass-through pattern — reads the canonical
  // object already attached to dec.finalStyleIntent, never rebuilds
  // finalStyleIntent, so the canonical visualPreviewRenderPlanV2 object
  // is preserved as-is automatically.
  // EPIC 2E-H-B-F3 FIX 3: top-level access goes through safeGetRT —
  // never a direct `dec?.finalStyleIntent?.visualPreviewRenderPlanV2`
  // read, since optional chaining is safe against null/undefined but
  // NOT against a throwing getter on an object that genuinely exists.
  const rawFinalStyleIntentForVPR = safeGetRT(dec, 'finalStyleIntent');
  const visualPreviewRenderPlan = safeGetRT(rawFinalStyleIntentForVPR, 'visualPreviewRenderPlanV2') ?? null;
  if (reviewState) {
    recommendations2.push(`Preview Review: approval state is "${reviewState.approvalState}" (${reviewState.reviewProgress?.completed ?? 0}/${reviewState.reviewProgress?.required ?? 0} required checks passed) — review approval never activates production output.`);
    if (reviewState.reviewSummary?.nextRequiredItem) {
      recommendations2.push(`[dev] Next required review item: ${reviewState.reviewSummary.nextRequiredItem}.`);
    }
  }

  return {
    referenceConfidence, transferConfidence, complexity,
    lightroomReproduction, wbTransferRisk, recommendations: recommendations2,
    // Stage 2.4
    editingDistanceEstimate,
    // Stage 2.4.2B.2
    styleFeasibility,
    // EPIC 1.6
    captureCapability, intentCompatibility, captureBudgetHints,
    // EPIC 1.7
    styleBudgetIntelligence,
    // EPIC 2D: compact context only — the full report lives on finalStyleIntent.lightroomShadowCompareReportV2
    shadowCompareContext: shadowCompare ? {
      available: true,
      status: shadowCompare.safetyDelta?.status ?? 'uncertain',
      legacyComparisonAvailable: shadowCompare.legacySummary?.available === true,
      readiness: shadowCompare.readiness,
      activationReadinessLevel: shadowCompare.activationReadiness?.level ?? 'unknown',
      canProceedToControlledActivation: shadowCompare.activationReadiness?.canProceedToControlledActivation ?? false,
      majorDivergences: shadowCompare.divergenceAnalysis?.divergentAreas ?? [],
    } : { available: false },
    // EPIC 2E-A: compact context only — the full gate lives on finalStyleIntent.lightroomControlledActivationV2
    activationContext: controlledActivation ? {
      available: true,
      activationState: controlledActivation.activationState,
      canUseV2: controlledActivation.canUseV2,
      selectedMappingSource: controlledActivation.selectedMappingSource,
      productionOutputStillLegacy: controlledActivation.selectedMappingSource === 'legacy',
      majorBlockers: (controlledActivation.blockers ?? []).slice(0, 3).map(b => b.blocker),
      fallbackAvailable: controlledActivation.fallbackStrategy?.useLegacyMapping ?? true,
    } : { available: false },
    // EPIC 2E-B: compact overlay context — the full overlay lives on finalStyleIntent.legacySafetyOverlayV2
    overlayContext: overlay ? {
      available: true,
      overlayState: overlay.overlayState,
      canApplyOverlay: overlay.canApplyOverlay,
      selectedOutputSource: overlay.selectedOutputSource,
      productionOutputStillLegacy: overlay.selectedOutputSource === 'legacy',
      legacyRiskLevel: overlay.legacyRiskReview?.riskLevel ?? 'unknown',
      protectedAreas: (overlay.protectedAreas ?? []).map(a => a.area),
      fallbackAvailable: overlay.fallbackStrategy?.useLegacyMapping ?? true,
    } : { available: false },
    // EPIC 2E-C: compact context only — the full simulation lives on finalStyleIntent.legacyOverlaySimulationV2
    simulationContext: simulation ? {
      available: true,
      simulationState: simulation.simulationState,
      canApplyToProduction: simulation.canApplyToProduction,
      productionWriteDisabled: !simulation.canApplyToProduction,
      topSimulatedActions: (simulation.simulatedOverlayActions ?? []).slice(0, 3).map(a => `${a.action}: ${a.tool}`),
      unresolvedRisks: simulation.simulatedRiskAfter?.remainingRisks ?? [],
    } : { available: false },
    // EPIC 2E-D: compact context only — the full gate lives on finalStyleIntent.controlledOverlayTestGateV2
    testGateContext: testGate ? {
      available: true,
      testState: testGate.testState,
      canEnterControlledTest: testGate.canEnterControlledTest,
      humanReviewRequired: (testGate.humanReviewChecklist ?? []).some(c => c.required && c.status === 'pending'),
      topBlockers: (testGate.blockers ?? []).slice(0, 3).map(b => b.blocker),
    } : { available: false },
    // EPIC 2E-E: compact context only — the full sandbox lives on finalStyleIntent.controlledOverlayPreviewSandboxV2
    previewSandboxContext: previewSandbox ? {
      available: true,
      previewState: previewSandbox.previewState,
      previewExportDisabled: !previewSandbox.canExportPreview,
      topPreviewProtections: (previewSandbox.previewPlan?.protectedAreas ?? []).slice(0, 3),
      unresolvedRisks: previewSandbox.previewPlan?.actions?.filter(a => a.action === 'require-human-review').map(a => a.target) ?? [],
    } : { available: false },
    // EPIC 2E-F Phase B: compact context only — the canonical object
    // lives on finalStyleIntent.controlledPreviewReviewStateV2, preserved
    // as-is by this pass-through read.
    reviewStateContext: reviewState ? {
      available: true,
      approvalState: reviewState.approvalState,
      canApprovePreview: reviewState.canApprovePreview,
      requiredCompleted: reviewState.reviewProgress?.completed ?? 0,
      requiredTotal: reviewState.reviewProgress?.required ?? 0,
      nextRequiredItem: reviewState.reviewSummary?.nextRequiredItem ?? null,
    } : { available: false },
    // EPIC 2E-G Phase B: compact context only — the full canonical
    // object lives on finalStyleIntent.sideBySidePreviewComparisonV2,
    // preserved as-is by this pass-through read (never rebuilt).
    // canRenderLegacyPreview/canRenderV2Preview/canCompareVisually are
    // always false here — no image-rendering pipeline exists yet.
    sideBySideComparisonContext: sideBySideComparison ? {
      available: true,
      comparisonState: sideBySideComparison.comparisonState,
      comparisonAvailable: sideBySideComparison.comparisonAvailable,
      canCompareVisually: sideBySideComparison.canCompareVisually,
      saferSide: sideBySideComparison.safetyComparison?.saferSide ?? 'uncertain',
      selectedProductionSource: sideBySideComparison.selectedProductionSource ?? 'legacy',
    } : { available: false },
    // EPIC 2E-H Phase B: compact context only — the full canonical
    // object lives on finalStyleIntent.visualPreviewRenderPlanV2,
    // preserved as-is by this pass-through read (never rebuilt). Only
    // bounded, canonical fields are preserved here — never a canvas,
    // ImageData, ImageBitmap, source image, or function (none of those
    // exist on the source Render Plan object either, since it is
    // data-only by construction). Full adjustment-model objects are
    // NOT duplicated here — only their supported/unsupported name
    // lists, which is sufficient for any current Reference Transfer
    // consumer; if a future renderer needs the full models, they
    // should read finalStyleIntent.visualPreviewRenderPlanV2 directly
        // rather than growing this compact context further.
    visualPreviewRenderPlanV2: (() => {
      const hasVPR = visualPreviewRenderPlan && typeof visualPreviewRenderPlan === 'object' && !Array.isArray(visualPreviewRenderPlan);
      if (!hasVPR) return { available: false };
      const rp = visualPreviewRenderPlan;
      const rawLegacy = safeGetRT(rp, 'legacyRenderPlan');
      const rawV2 = safeGetRT(rp, 'v2RenderPlan');
      const rawConstraints = safeGetRT(rp, 'sharedRenderConstraints');
      const rawFallback = safeGetRT(rp, 'fallbackStrategy');
      const rawRollback = safeGetRT(rp, 'rollbackPlan');
      const legacyAdjModel = safeGetRT(rawLegacy, 'adjustmentModel');
      const v2AdjModel = safeGetRT(rawV2, 'adjustmentModel');
      const v2Upstream = safeGetRT(rawV2, 'upstreamEvidence');

      // FIX 1 (EPIC 2E-H-B-F3): every untrusted property read exactly
      // once through safeGetRT, stored, then validated from the
      // stored variable only — never a second direct read of the
      // original property.
      const rawMode = safeGetRT(rp, 'mode');
      const mode = typeof rawMode === 'string' ? rawMode : 'isolated-visual-preview-render-plan';
      const rawRenderState = safeGetRT(rp, 'renderState');
      const renderState = _canonicalStringRT(rawRenderState, ['unavailable', 'partial', 'blocked', 'ready-for-isolated-render', 'insufficient-data']);
      const rawSelectedSource = safeGetRT(rp, 'selectedProductionSource');
      const selectedProductionSource = _canonicalStringRT(rawSelectedSource, ['legacy', 'v2']);

      const rawLegacyConfidence = safeGetRT(rawLegacy, 'confidence');
      const legacyConfidence = Number.isFinite(rawLegacyConfidence) ? rawLegacyConfidence : null;
      const rawV2Confidence = safeGetRT(rawV2, 'confidence');
      const v2Confidence = Number.isFinite(rawV2Confidence) ? rawV2Confidence : null;

      // FIX 5 (EPIC 2E-H-B-F3): canonical V2 evidence is now preserved
      // as tri-state reads — never hard-coded `false`, which would
      // silently discard a genuine (even if anomalous) upstream claim.
      // An explicit `true` is preserved as anomalous evidence, never
      // interpreted as approval — the separate `integrationGuarantees`
      // below is what actually governs Phase B's behavior, regardless
      // of what this canonical evidence says.
      const rawV2ExportEligible = safeGetRT(rawV2, 'exportEligible');
      const v2ExportEligible = _triStateBooleanRT(rawV2ExportEligible);
      const rawV2AppliedToProduction = safeGetRT(rawV2, 'appliedToProduction');
      const v2AppliedToProduction = _triStateBooleanRT(rawV2AppliedToProduction);

      const rawMaxInputWidth = safeGetRT(rawConstraints, 'maxInputWidth');
      const maxInputWidth = Number.isFinite(rawMaxInputWidth) ? rawMaxInputWidth : null;
      const rawMaxInputHeight = safeGetRT(rawConstraints, 'maxInputHeight');
      const maxInputHeight = Number.isFinite(rawMaxInputHeight) ? rawMaxInputHeight : null;
      const rawMaxPixelCount = safeGetRT(rawConstraints, 'maxPixelCount');
      const maxPixelCount = Number.isFinite(rawMaxPixelCount) ? rawMaxPixelCount : null;
      const rawMaxDevicePixelRatio = safeGetRT(rawConstraints, 'maxDevicePixelRatio');
      const maxDevicePixelRatio = Number.isFinite(rawMaxDevicePixelRatio) ? rawMaxDevicePixelRatio : null;

      const rawFallbackReason = safeGetRT(rawFallback, 'reason');
      const fallbackReason = typeof rawFallbackReason === 'string' ? rawFallbackReason.slice(0, 300) : null;

      return {
        available: true,
        mode,
        renderState,
        previewAccuracy: 'approximate-browser-preview',
        // FIX 7: never defaulted to "legacy" — that would fabricate
        // confirmed evidence from missing data. The actual fallback
        // (Legacy Mapping remains active regardless) is documented
        // separately via fallbackStrategy.useLegacyMapping below. FIX
        // 1's rule (do not convert V2 evidence into approval/fallback
        // selection) means this field only ever PRESERVES whatever
        // canonical value existed — it never causes V2 to be selected
        // or activated by this module.
        selectedProductionSource,
        legacy: {
          // FIX 4 (EPIC 2E-H-B-F2): tri-state — missing availability/
          // renderability is honestly `null`, never coerced to `false`.
          available: _triStateBooleanRT(safeGetRT(rawLegacy, 'available')),
          renderable: _triStateBooleanRT(safeGetRT(rawLegacy, 'renderable')),
          source: _canonicalStringRT(safeGetRT(rawLegacy, 'source'), ['legacy']),
          previewOnly: _triStateBooleanRT(safeGetRT(rawLegacy, 'previewOnly')),
          productionSource: _triStateBooleanRT(safeGetRT(rawLegacy, 'productionSource')),
          supportedAdjustments: _boundedStringArrayRT(safeGetRT(legacyAdjModel, 'supportedAdjustments')),
          unsupportedAdjustments: _boundedStringArrayRT(safeGetRT(legacyAdjModel, 'unsupportedAdjustments')),
          confidence: legacyConfidence,
        },
        v2: {
          available: _triStateBooleanRT(safeGetRT(rawV2, 'available')),
          renderable: _triStateBooleanRT(safeGetRT(rawV2, 'renderable')),
          source: _canonicalStringRT(safeGetRT(rawV2, 'source'), ['controlled-v2-preview']),
          previewOnly: _triStateBooleanRT(safeGetRT(rawV2, 'previewOnly')),
          productionSource: _triStateBooleanRT(safeGetRT(rawV2, 'productionSource')),
          // FIX 5 (EPIC 2E-H-B-F3): canonical evidence, tri-state —
          // preserved honestly (including an anomalous explicit
          // `true`), never hard-coded and never interpreted as
          // approval. See `integrationGuarantees` at the top level for
          // what Phase B actually executed, which is always false
          // regardless of this value.
          exportEligible: v2ExportEligible,
          appliedToProduction: v2AppliedToProduction,
          supportedAdjustments: _boundedStringArrayRT(safeGetRT(v2AdjModel, 'supportedAdjustments')),
          unsupportedAdjustments: _boundedStringArrayRT(safeGetRT(v2AdjModel, 'unsupportedAdjustments')),
          confidence: v2Confidence,
          // FIX 6 (EPIC 2E-H-B-F): only the 4 canonical primitive
          // tri-state fields are selected — never a shallow spread of
          // the whole upstreamEvidence object, which could carry extra
          // unbounded/nested/function-valued fields from a malformed
          // upstream Sandbox report.
          upstreamEvidence: {
            simulatedPreviewAvailable: _triStateBooleanRT(safeGetRT(v2Upstream, 'simulatedPreviewAvailable')),
            exportEligible: _triStateBooleanRT(safeGetRT(v2Upstream, 'exportEligible')),
            appliedToProduction: _triStateBooleanRT(safeGetRT(v2Upstream, 'appliedToProduction')),
            contradictory: _triStateBooleanRT(safeGetRT(v2Upstream, 'contradictory')),
          },
        },
        // FIX 9 (EPIC 2E-H-B-F3): Phase B architectural guarantees —
        // always these exact values, regardless of any upstream
        // evidence above (including an anomalous explicit `true` for
        // V2 exportEligible/appliedToProduction). This is what Phase B
        // integration actually executed, kept explicitly separate from
        // what upstream canonical evidence reports.
        integrationGuarantees: {
          actualRenderInvoked: false,
          previewExportInvoked: false,
          productionWriteInvoked: false,
          productionApplicationInvoked: false,
          actualPreviewImagesAvailable: false,
          visualComparisonAvailable: false,
        },
        constraints: {
          maxInputWidth, maxInputHeight, maxPixelCount, maxDevicePixelRatio,
          // FIX 4/6 (EPIC 2E-H-B-F2): tri-state — missing evidence is
          // honestly `null`, never coerced to `false`.
          allowProductionWrite: _triStateBooleanRT(safeGetRT(rawConstraints, 'allowProductionWrite')),
          allowExport: _triStateBooleanRT(safeGetRT(rawConstraints, 'allowExport')),
        },
        // FIX 8: bounded, deduplicated, primitive-string-only — never a
        // shallow copy of arbitrary (possibly object-valued) array entries.
        blockers: _boundedStringArrayRT(safeGetRT(rp, 'blockers')),
        warnings: _boundedStringArrayRT(safeGetRT(rp, 'renderWarnings')),
        fallbackStrategy: (rawFallback && typeof rawFallback === 'object' && !Array.isArray(rawFallback)) ? {
          useLegacyMapping: _triStateBooleanRT(safeGetRT(rawFallback, 'useLegacyMapping')),
          safeMode: _triStateBooleanRT(safeGetRT(rawFallback, 'safeMode')),
          reason: fallbackReason,
        } : null,
        rollbackPlan: (rawRollback && typeof rawRollback === 'object' && !Array.isArray(rawRollback)) ? {
          available: _triStateBooleanRT(safeGetRT(rawRollback, 'available')),
          restoreSource: _canonicalStringRT(safeGetRT(rawRollback, 'restoreSource'), ['legacy']),
          productionMutationDetected: _triStateBooleanRT(safeGetRT(rawRollback, 'productionMutationDetected')),
          steps: _boundedStringArrayRT(safeGetRT(rawRollback, 'steps')),
        } : null,
      };
    })(),
  };
}

/**
 * Stage 2.4 Task 2.4E: estimates how far the generated XMP is from a
 * finished professional edit, without requiring actual Lightroom feedback.
 * Combines transferConfidence, referenceComplexity, benchmark score,
 * validation warnings, style-budget/cross-slider stacking activity (read
 * from the mapping trace, if present), and WB transfer risk.
 */
function _buildEditingDistanceEstimate({ ctx, complexity, transferConfidence, wbTransferRisk }) {
  const reasons = [], recommendations = [];
  const bench = ctx.styleBenchmark;
  const val = ctx.preXmpValidation;
  const mapTrace = ctx.decisionStrategy?.mappingTrace?.log ?? [];

  const benchmarkFactor = clamp01(bench?.overallStyleSimilarity ?? 0.6);
  const validationPenalty = Math.min(0.3, (val?.violations?.length ?? 0) * 0.06);
  const stackingActivity = mapTrace.filter(l => l.stage === 'style-budget' || l.stage === 'cross-slider').length;
  const stackingPenalty = Math.min(0.25, stackingActivity * 0.05);
  const wbPenalty = wbTransferRisk.transferRiskScore * 0.20;
  const complexityPenalty = complexity.score * 0.20;
  const transferPenalty = (1 - transferConfidence.score) * 0.25;

  const distanceScore = clamp01(
    (1 - benchmarkFactor) * 0.20 + validationPenalty + stackingPenalty + wbPenalty + complexityPenalty + transferPenalty
  );
  const level = distanceScore >= 0.55 ? 'high' : distanceScore >= 0.30 ? 'medium' : 'low';
  const expectedManualWorkPercent = Math.round(distanceScore * 100);

  reasons.push(`Editing distance ${distanceScore.toFixed(3)} — benchmark gap ${(1-benchmarkFactor).toFixed(2)}, validation issues ${validationPenalty.toFixed(2)}, engine stacking ${stackingPenalty.toFixed(2)} (${stackingActivity} adjustment(s)), WB risk ${wbPenalty.toFixed(2)}, complexity ${complexityPenalty.toFixed(2)}, transfer risk ${transferPenalty.toFixed(2)}.`);
  if (level === 'low')    reasons.push('The preset is likely close to a finished look — minor manual touch-ups expected.');
  if (level === 'medium') reasons.push('The preset is a solid draft — moderate manual adjustment is likely before it reads as finished.');
  if (level === 'high')   reasons.push('The preset is a rough starting point — significant manual work is likely needed to reach a finished professional look.');

  if (stackingActivity > 3) recommendations.push('Multiple engines needed budget/cross-slider correction — review whether the detected style family matches the reference visually.');
  if (wbTransferRisk.transferRisk !== 'low') recommendations.push('WB depends on this scene\'s specific lighting — expect to manually tune Temp/Tint on a different photo.');
  if (complexity.level === 'high') recommendations.push('High reference complexity — some of the look may not be reproducible by Lightroom sliders alone.');

  return { score: +distanceScore.toFixed(3), level, expectedManualWorkPercent, reasons, recommendations };
}

// ─── Reference Analysis Confidence (concept #1 — kept separate) ─────────────

function _buildReferenceConfidence(ctx) {
  const fp = ctx.styleFingerprint, graph = ctx.styleFeatureGraph;
  const overall = clamp01(fp?.overallConfidence ?? 0.5);
  const graphConf = clamp01(graph?.overallStyleConfidence ?? 0.5);
  return {
    score: +((overall + graphConf) / 2).toFixed(3),
    reasons: [
      `Style Fingerprint confidence: ${overall.toFixed(2)} (blended across all analysis engines).`,
      `Style Feature Graph confidence: ${graphConf.toFixed(2)} (effectiveWeight-weighted across 22 modules).`,
    ],
  };
}

// ─── TASK 6.3A: Reference Complexity Analysis ────────────────────────────────
// Estimates visual editing complexity WITHOUT detecting any specific tool —
// only from signals already computed by the pipeline. High complexity means
// the reference likely contains local/manual edits a global XMP preset
// cannot fully reproduce.

function _analyzeComplexity(ctx) {
  const { stats, styleFeatureGraph: graph, styleFingerprint: fp, imageAnalysisCore: iac, cast } = ctx;
  const signals = [];   // { name, score(0-1), reason }

  // 1. Local contrast irregularity — high highlight AND shadow mass together
  //    with only moderate global contrast suggests zone-specific (local)
  //    contrast work rather than one global contrast curve.
  const hiMass = graph?.highlightIntent?.mass ?? 0, shMass = graph?.shadowIntent?.mass ?? 0;
  const globalSigma = graph?.contrastIntent?.sigma ?? stats?.contrast ?? 50;
  if (hiMass > 25 && shMass > 25 && globalSigma < 60) {
    signals.push({ name: 'local contrast irregularity', score: 0.6,
      reason: `Both highlight (${hiMass}%) and shadow (${shMass}%) mass are heavy while global contrast (σ=${globalSigma}) stays moderate — suggests zone-specific contrast work.` });
  }

  // 2. Unusual skin smoothness — skin present, image reads sharp overall,
  //    but noise is near-zero (natural skin always carries some texture/noise).
  if (fp?.skin?.detected && iac && (iac.noiseScore ?? 50) < 8 && (iac.sharpnessScore ?? 0) >= 40) {
    signals.push({ name: 'unusual skin smoothness', score: 0.75,
      reason: `Skin detected with sharpness=${iac.sharpnessScore} but noise=${iac.noiseScore} — unnaturally smooth for real skin texture, suggests retouching.` });
  }

  // 3/8. Strong selective colour separation / aggressive local colour shifts
  const hslFeature = (graph?.features ?? []).find(f => f.id === 'hsl-analyzer-engine' && f.category === 'hsl');
  if (hslFeature?.value) {
    const sats = Object.values(hslFeature.value).map(c => Math.abs(c.satAdj ?? 0));
    const maxSat = Math.max(0, ...sats), minSat = sats.length ? Math.min(...sats) : 0;
    if (maxSat > 20 && (maxSat - minSat) > 18) {
      signals.push({ name: 'selective colour separation', score: 0.55,
        reason: `HSL pushes one channel hard (${maxSat}) while others stay near zero (${minSat}) — one colour was isolated and shifted independently.` });
    }
  }
  if ((graph?.conflicts ?? []).some(c => c.type === 'hsl_vs_palette_saturation')) {
    signals.push({ name: 'aggressive local colour shift vs palette', score: 0.5,
      reason: 'HSL saturation disagreed with the extracted palette — a sign of localised, not global, colour adjustment.' });
  }

  // 4. Highlight roll-off inconsistency — curve pulls highlights down hard
  //    with no real clipping evidence to justify it (manual highlight work).
  const hiY = graph?.curveIntent?.highlightY;
  if (hiY != null && hiY < 235 && (stats?.clipHiPct ?? 0) < 1) {
    signals.push({ name: 'highlight roll-off inconsistency', score: 0.5,
      reason: `Tone curve highlight anchor (Y=${hiY}) is pulled down with no clipping evidence (${stats?.clipHiPct ?? 0}%) — likely manual highlight recovery/roll-off.` });
  }

  // 5. Background/subject colour isolation — spatial cast zones disagree.
  if (cast && cast.center?.label && cast.border?.label && cast.center.label !== cast.border.label &&
      cast.center.label !== 'neutral' && cast.border.label !== 'neutral') {
    signals.push({ name: 'background/subject colour isolation', score: 0.65,
      reason: `Subject (${cast.center.label}) and background (${cast.border.label}) carry different colour casts — colour was likely treated separately per region.` });
  }

  // 6. Cinematic grading — strong shadow/highlight hue split (teal-orange-like).
  const shHue = ctx.finalPreset?.grade?.grd_sh_h, hiHue = ctx.finalPreset?.grade?.grd_hi_h;
  const gradingLook = graph?.gradingIntent?.look;
  if (gradingLook === 'Cinematic' || (shHue != null && hiHue != null && Math.abs(shHue - hiHue) > 90)) {
    signals.push({ name: 'cinematic grading', score: 0.4,
      reason: `Shadow/highlight colour grading hues diverge strongly (${shHue}° vs ${hiHue}°) — a deliberate cinematic split-tone look.` });
  }

  // 7. Heavy matte curve — shadows lifted well beyond what the raw black point implies.
  const shY = graph?.curveIntent?.shadowY;
  if (fp?.mood === 'matte_shadow' && shY != null && shY > 25 && (stats?.blackPoint ?? 0) < 8) {
    signals.push({ name: 'heavy matte curve', score: 0.55,
      reason: `Shadow anchor lifted to Y=${shY} despite a near-zero raw black point (${stats?.blackPoint ?? 0}) — a strong manual matte treatment.` });
  }

  // 9. Dynamic range compression — narrow measured DR but curve implies high contrast intent.
  if ((stats?.drStops ?? 5) < 3 && graph?.contrastIntent?.level === 'high') {
    signals.push({ name: 'dynamic range compression', score: 0.5,
      reason: `Measured dynamic range is narrow (${stats?.drStops ?? '?'} EV) yet contrast intent reads "high" — the tonal range was likely compressed and re-expanded manually.` });
  }

  // 10. Texture inconsistency — very sharp AND very clean simultaneously
  //     (frequency-separation-style signature: detail without matching grain).
  if (iac && (iac.sharpnessScore ?? 0) > 70 && (iac.noiseScore ?? 50) < 10) {
    signals.push({ name: 'texture inconsistency', score: 0.6,
      reason: `Very high sharpness (${iac.sharpnessScore}) paired with very low noise (${iac.noiseScore}) — texture and grain don't match, a common frequency-separation signature.` });
  }

  const score = signals.length
    ? clamp01(signals.reduce((s, x) => s + x.score, 0) / Math.max(4, signals.length + 1))
    : 0.15;   // no signals fired → low-complexity default, not zero (never overstate certainty)
  const level = score >= 0.65 ? 'high' : score >= 0.35 ? 'medium' : 'low';

  // Phase 6.3.1 fix: signal NAMES are internal debug/mapping detail only —
  // returned as a separate value, never attached to the user-facing
  // `complexity` object (which previously leaked `_signals`).
  const signalNames = signals.map(s => s.name);
  const complexity = {
    score: +score.toFixed(3), level,
    reasons: signals.length ? signals.map(s => s.reason) : ['No strong complexity signals detected — reference likely uses global tonal/colour adjustments only.'],
  };
  return { complexity, signalNames };
}

// ─── TASK 6.3D: WB Transfer Intelligence ─────────────────────────────────────
// Do NOT copy WB values directly — estimate the MOOD and how scene-dependent
// it looks, so a target image gets mood preservation, not a literal Temp/Tint copy.

function _analyzeWBTransfer(ctx) {
  const { wb, cast, styleFingerprint: fp } = ctx;

  // Stage 2.1: prefer the WB engine's own structured wbIntent — it is now
  // the single source of truth for mood/risk description, computed once
  // where the raw pixel data lives. Only fall back to a local re-derivation
  // when wbIntent is unavailable (e.g. an older cached wb result).
  if (wb?.wbIntent) {
    const intent = wb.wbIntent;
    const referenceMoodWB = _wbIntentToMoodLabel(intent);
    const targetTransferWB = intent.transferRisk !== 'low'
      ? `Preserve mood only (${referenceMoodWB}) — do not copy Temp/Tint literally onto a target shot under different lighting.`
      : `Mood is close to neutral/standard — WB should transfer reasonably well as a mild directional nudge, not an absolute value.`;
    return {
      referenceMoodWB, targetTransferWB, transferRisk: intent.transferRisk,
      transferRiskScore: intent.transferRiskScore,
      sceneDependent: intent.transferRisk !== 'low',
      reasons: [...intent.reasons, ...intent.warnings],
    };
  }

  // ── Fallback: legacy re-derivation from raw wb/cast (pre-wbIntent data) ──
  const temp = wb?.consensus?.temperature ?? 0;
  const lum  = ctx.stats?.avgLum ?? 128;
  const castLabel = wb?.cast ?? fp?.colorCast ?? 'neutral';

  // Mixed lighting: shadows/highlights carry different, non-neutral casts —
  // color-cast-detector already computes this per zone.
  const mixedLighting = !!(cast?.shadows?.label && cast?.highlights?.label &&
    cast.shadows.label !== cast.highlights.label &&
    cast.shadows.label !== 'neutral' && cast.highlights.label !== 'neutral');
  const forestBounce = !!cast?.bgGreenDominant;
  const neonLike = (castLabel === 'green' || castLabel === 'magenta') && (ctx.stats?.avgSatPct ?? 0) > 45;
  const goldenHour = temp > 20 && lum >= 110 && lum <= 200 && castLabel === 'warm';
  const blueHour = temp < -18 && lum < 110;
  const studioGel = !mixedLighting && !forestBounce && Math.abs(temp) > 30 && (cast?.subjectNeutral === false);

  let referenceMoodWB;
  if (mixedLighting)      referenceMoodWB = 'Mixed Lighting';
  else if (forestBounce)  referenceMoodWB = 'Forest/Green Bounce Light';
  else if (neonLike)      referenceMoodWB = 'Neon / Saturated Colour Light';
  else if (goldenHour)    referenceMoodWB = 'Golden Hour';
  else if (blueHour)      referenceMoodWB = 'Blue Hour';
  else if (studioGel)     referenceMoodWB = 'Studio Gel / Strong Artificial Cast';
  else if (Math.abs(temp) <= 6) referenceMoodWB = 'Neutral / Daylight-Balanced';
  else                     referenceMoodWB = temp > 0 ? 'Standard Warm' : 'Standard Cool';

  const sceneDependent = mixedLighting || forestBounce || neonLike || studioGel;
  const transferRiskScore = clamp01(
    (mixedLighting ? 0.35 : 0) + (forestBounce ? 0.25 : 0) + (neonLike ? 0.3 : 0) +
    (studioGel ? 0.25 : 0) + (goldenHour || blueHour ? 0.1 : 0) +
    Math.min(0.2, Math.abs(temp) / 150)
  );
  const transferRisk = transferRiskScore >= 0.55 ? 'high' : transferRiskScore >= 0.25 ? 'medium' : 'low';

  const targetTransferWB = sceneDependent
    ? `Preserve mood only (${referenceMoodWB}) — do not copy Temp/Tint literally onto a target shot under different lighting.`
    : `Mood is close to neutral/standard — WB should transfer reasonably well as a mild directional nudge, not an absolute value.`;

  const reasons = [
    `Reference WB reads as "${referenceMoodWB}" (temp=${temp}, avgLum=${lum.toFixed?.(0) ?? lum}).`,
    mixedLighting ? `Shadows (${cast.shadows.label}) and highlights (${cast.highlights.label}) carry different casts — classic mixed-lighting signature.` : null,
    forestBounce ? 'Background shows green bounce-light dominance distinct from the subject.' : null,
  ].filter(Boolean);

  return {
    referenceMoodWB, targetTransferWB, transferRisk,
    transferRiskScore: +transferRiskScore.toFixed(3),
    sceneDependent, reasons,
  };
}

/** Maps a wbIntent object to the same descriptive mood labels the legacy
 *  fallback path used, so downstream text stays consistent either way. */
function _wbIntentToMoodLabel(intent) {
  if (intent.mixedLightingRisk > 0.3) return 'Mixed Lighting';
  if (intent.greenBounceRisk > 0.3)   return 'Forest/Green Bounce Light';
  if (intent.magentaRisk > 0.3 && intent.moodWarmth.direction !== 'neutral') return 'Studio Gel / Strong Artificial Cast';
  if (intent.moodWarmth.direction === 'warm' && intent.moodWarmth.strength > 0.4) return 'Golden Hour / Warm Ambient';
  if (intent.moodWarmth.direction === 'cool' && intent.moodWarmth.strength > 0.4) return 'Blue Hour / Cool Ambient';
  if (intent.moodWarmth.direction === 'neutral') return 'Neutral / Daylight-Balanced';
  return intent.moodWarmth.direction === 'warm' ? 'Standard Warm' : 'Standard Cool';
}

// ─── TASK 6.3B: Transfer Confidence ───────────────────────────────────────────

// ─── Fallback scene-dependency table (Phase 6.3.1) ───────────────────────────
// Used ONLY when engineTrustWeights is unavailable — a coarse, reasoned
// default per strategy. When real per-image trust weights exist, they are
// far more accurate (see _sceneDependency below) and take priority.
const SCENE_DEPENDENCY_FALLBACK = { portrait: 0.5, food: 0.55, landscape: 0.35, moody: 0.3, airy: 0.3, general: 0.15 };

/**
 * Estimate how tied the extracted style is to THIS image's specific scene.
 * Prefers real, per-image engineTrustWeights (Phase 5 Adaptive Decision
 * output) over the hard-coded strategy table: if the Decision Engine
 * actually leaned heavily on scene-sensitive signals (skin tone, white
 * balance, colour grading) for THIS image, that is a much more accurate
 * portability signal than a generic per-strategy guess.
 */
function _sceneDependency(dec) {
  const trust = dec?.engineTrustWeights;
  if (trust && Object.keys(trust).length) {
    // Scene-sensitive: their trust reflects how much THIS scene's specific
    // lighting/subject drove the result. Scene-agnostic: engines whose
    // output tends to generalise across different scenes/subjects.
    const sensitive = ['skinTone', 'whiteBalance', 'colorGrading'].map(k => trust[k] ?? 0.5);
    const agnostic  = ['palette', 'toneCurve', 'styleRecognition'].map(k => trust[k] ?? 0.5);
    const sensitiveAvg = sensitive.reduce((a, b) => a + b, 0) / sensitive.length;
    const agnosticAvg  = agnostic.reduce((a, b) => a + b, 0) / agnostic.length;
    // Centered at 0.5: sensitive trust well above agnostic trust → higher dependency.
    return clamp01(0.5 + (sensitiveAvg - agnosticAvg) * 0.6);
  }
  return SCENE_DEPENDENCY_FALLBACK[dec?.decisionStrategy] ?? 0.3;
}

function _computeTransferConfidence(ctx, complexity, wbTransferRisk) {
  const { styleFeatureGraph: graph, decisionStrategy: dec, styleBenchmark: bench, preXmpValidation: val, finalPreset: p } = ctx;
  const reasons = [], risks = [];

  // Each dependency factor is 0 (safe to transfer) .. 1 (highly scene/subject specific)
  const wbDependency = wbTransferRisk.transferRiskScore;
  if (wbDependency > 0.4) risks.push(`White Balance is scene-dependent (${wbTransferRisk.referenceMoodWB}) — risk ${wbTransferRisk.transferRisk}.`);

  const skinDependency = (dec?.hasSkin && dec?.portraitSafe) ? clamp01((dec.skinPct ?? 0) / 60) : 0;
  if (skinDependency > 0.3) risks.push(`Style leans on this specific skin tone (coverage ${dec?.skinPct ?? 0}%) — may need review on a different subject.`);

  const sceneDependency = _sceneDependency(dec);

  const paletteUniqueness = (graph?.paletteIntent?.avgSat ?? 30) > 55 ? 0.5 : 0.15;
  if (paletteUniqueness > 0.3) risks.push(`Palette is highly saturated/specific (avg ${graph?.paletteIntent?.avgSat}%) — a differently-coloured scene may not respond the same way.`);

  const highlightDependency = (graph?.highlightIntent?.level === 'bright' && (ctx.stats?.clipHiPct ?? 0) > 1) ? 0.4 : 0.1;

  const gradeIntensity = clamp01(((p.grade?.grd_sh_s ?? 0) + (p.grade?.grd_mid_s ?? 0) + (p.grade?.grd_hi_s ?? 0)) / 45);
  if (gradeIntensity > 0.4) risks.push('Colour Grading intensity is strong — mood carries over well, but exact colour may shift on different lighting.');

  const calDependency = clamp01((['red','green','blue'].reduce((s,c)=>s+Math.abs(p.cal?.[`cal_${c}_h`]??0)+Math.abs(p.cal?.[`cal_${c}_s`]??0),0)) / 40);

  const complexityPenalty = complexity.score;
  if (complexityPenalty >= 0.65) risks.push('High reference complexity — likely contains edits a global preset cannot fully carry over.');

  const benchmarkFactor = clamp01(bench?.overallStyleSimilarity ?? 0.5);
  const validationFactor = (val?.violations?.length ?? 0) === 0 ? 1.0 : clamp01(1 - (val.violations.length * 0.15));
  if ((val?.violations?.length ?? 0) > 2) risks.push('Multiple Pre-XMP corrections were needed — the extracted values were already at the edge of safe bounds.');

  // Weighted roll-up: dependencies REDUCE confidence, benchmark/validation SUPPORT it.
  const dependencyDrag = clamp01(
    wbDependency * 0.20 + skinDependency * 0.15 + sceneDependency * 0.15 +
    paletteUniqueness * 0.10 + highlightDependency * 0.10 + gradeIntensity * 0.10 +
    calDependency * 0.05 + complexityPenalty * 0.15
  );
  const score = clamp01((1 - dependencyDrag) * 0.7 + benchmarkFactor * 0.15 + validationFactor * 0.15);

  reasons.push(`Dependency drag ${dependencyDrag.toFixed(2)} (WB ${wbDependency.toFixed(2)}, skin ${skinDependency.toFixed(2)}, scene ${sceneDependency.toFixed(2)}, palette ${paletteUniqueness.toFixed(2)}, grading ${gradeIntensity.toFixed(2)}, complexity ${complexityPenalty.toFixed(2)}).`);
  reasons.push(`Supported by internal benchmark (${benchmarkFactor.toFixed(2)}) and validation stability (${validationFactor.toFixed(2)}) — these measure pipeline quality, not portability, and are weighted lightly here on purpose.`);

  // Stage 2.2: cross-check against Decision Engine's own internal proxy
  // estimate (computed earlier in the pipeline, before Lightroom Mapping,
  // from a subset of these same signals). This is transparency only — it
  // never overrides this module's fuller, authoritative score.
  const decisionEstimate = dec?.transferRiskEstimate;
  if (decisionEstimate) {
    const decisionScore = 1 - decisionEstimate.score;   // risk → confidence
    const delta = Math.abs(decisionScore - score);
    if (delta > 0.25) {
      reasons.push(`Note: Decision Engine's own in-pipeline estimate (≈${decisionScore.toFixed(2)}) diverges from this fuller analysis (${score.toFixed(3)}) by ${delta.toFixed(2)} — Reference Transfer's assessment is the authoritative one.`);
    } else {
      reasons.push(`Consistent with Decision Engine's in-pipeline estimate (≈${decisionScore.toFixed(2)}).`);
    }
  }

  return { score: +score.toFixed(3), reasons, risks };
}

// ─── TASK 6.3C: Lightroom Reproduction Estimate ──────────────────────────────

const UNSUPPORTED_LOOK_MAP = {
  'unusual skin smoothness': 'heavy retouch / skin smoothing beyond XMP capability',
  'selective colour separation': 'local colour painting on a single object or area',
  'aggressive local colour shift vs palette': 'selective masking beyond global HSL capability',
  'background/subject colour isolation': 'composite lighting or selective background grading',
  'local contrast irregularity': 'dodge & burn on specific zones',
  'texture inconsistency': 'frequency separation retouching',
  'highlight roll-off inconsistency': 'manual highlight painting/recovery beyond global roll-off',
};

function _estimateLightroomReproduction(signalNames, complexity) {
  const unsupportedLook = (signalNames ?? [])
    .map(name => UNSUPPORTED_LOOK_MAP[name])
    .filter(Boolean);

  const limitations = [];
  if (complexity.level === 'high') {
    limitations.push('This reference likely contains localised edits that cannot be reproduced by a global Lightroom preset.');
  } else if (complexity.level === 'medium') {
    limitations.push('Some elements of this look may rely on local adjustments; the global preset will approximate the overall mood but not every detail.');
  } else {
    limitations.push('This reference appears to use primarily global tonal/colour adjustments — a Lightroom preset should reproduce it closely.');
  }
  if (unsupportedLook.length) {
    limitations.push(`Detected signals suggesting non-global edits: ${unsupportedLook.join(', ')}.`);
  }

  const expectedSimilarity = clamp01(1 - complexity.score * 0.8);

  return { expectedSimilarity: +expectedSimilarity.toFixed(3), limitations, unsupportedLook: [...new Set(unsupportedLook)] };
}

// ─── TASK 6.3E: Recommendations (photographer + developer) ──────────────────

// ─── Stage 2.4.2B.2: Style Feasibility Intelligence ──────────────────────────

const SKIN_CRITICAL_STYLES = new Set(['Airy Wedding', 'Soft Portrait', 'Clean Portrait', 'Luxury Wedding', 'Fine Art Portrait', 'Korean Clean']);

/**
 * Task 2: style-specific feasibility rules. Each returns a small bounded
 * score adjustment plus concrete strengths/riskFactors/blockers — never a
 * generic number alone. Only signals already computed elsewhere in the
 * pipeline are read (stats, styleFeatureGraph, wb, decisionStrategy) —
 * no new analysis.
 */
function _applyStyleSpecificFeasibilityRules(styleName, ctx, wbTransferRisk) {
  const strengths = [], riskFactors = [], blockers = [];
  let adjustment = 0;
  const stats = ctx.stats ?? {};
  const dec = ctx.decisionStrategy ?? {};
  const hasSkin = dec.hasSkin;
  const skinConfidence = dec.skinConfidence ?? 0.5;
  const clipHi = stats.clipHiPct ?? 0;
  const clipLo = stats.clipLoPct ?? 0;
  const drStops = stats.drStops ?? 5;
  const colorCast = ctx.styleFingerprint?.colorCast ?? 'neutral';
  const paletteSat = ctx.styleFeatureGraph?.paletteIntent?.avgSat;

  switch (styleName) {
    case 'Airy Wedding':
      if (clipHi < 2 && drStops >= 5) { adjustment += 0.05; strengths.push('Highlights are clean and dynamic range supports a soft, controllable roll-off.'); }
      if (clipHi > 5) { adjustment -= 0.10; riskFactors.push('Highlights already show clipping — a clean highlight roll-off may not be fully recoverable.'); }
      if (hasSkin && skinConfidence > 0.6) strengths.push('Skin is well-detected and protectable for this look.');
      if (hasSkin && skinConfidence < 0.4) { adjustment -= 0.08; riskFactors.push('Skin protection confidence is low for a style that depends on clean, flattering skin.'); }
      if (wbTransferRisk.transferRisk === 'high') { adjustment -= 0.08; riskFactors.push('WB transfer risk is high — a clean, neutral white balance may not transfer reliably.'); }
      break;
    case 'Green Pastel':
      if (wbTransferRisk.transferRisk !== 'high') strengths.push('Green ambient cast does not appear heavily scene-dependent.');
      else { adjustment -= 0.10; riskFactors.push('Green ambient light looks scene-dependent — the pastel green mood may not transfer as-is.'); }
      if (paletteSat != null && paletteSat > 55) { adjustment -= 0.08; riskFactors.push('Green saturation is already high in the reference — reducing it further for a pastel look is a bigger lift.'); }
      if (hasSkin && skinConfidence < 0.5) { adjustment -= 0.05; riskFactors.push('Foliage-dominant palette alongside detected skin increases the risk of green competing with the subject.'); }
      break;
    case 'Brown Film':
      strengths.push('Tone Curve and Colour Grading (the primary tools for this look) are always available regardless of scene.');
      if (hasSkin && skinConfidence < 0.5) { adjustment -= 0.08; riskFactors.push('Skin protection confidence is weak for a style that relies on warm, controlled skin tone.'); }
      if (Math.abs(ctx.wb?.consensus?.temperature ?? 0) > 30) { adjustment -= 0.05; riskFactors.push('WB would need fairly aggressive warming to fully match this look.'); }
      break;
    case 'Moody Cinematic':
      if (clipLo < 2 && drStops >= 5) strengths.push('Shadow detail and dynamic range are healthy enough to support deliberate grading.');
      if (clipLo > 5 || drStops < 4) { adjustment -= 0.10; blockers.push('The reference already shows shadow clipping or limited dynamic range — controlled cinematic shadow grading may be constrained.'); }
      break;
    case 'Luxury Wedding':
      if (clipHi < 2) strengths.push('Whites are not clipped and can be preserved cleanly.');
      if (colorCast !== 'neutral') { adjustment -= 0.08; riskFactors.push(`A ${colorCast} colour cast may work against clean, neutral whites.`); }
      if (hasSkin && skinConfidence > 0.6) strengths.push('Skin is well-supported for a polished, premium look.');
      break;
    default:
      // No style-specific rule set yet for this style — generic scoring
      // (Task 1) still applies; nothing invented here.
  }

  return { adjustment: Math.max(-0.2, Math.min(0.15, adjustment)), strengths, riskFactors, blockers };
}

/**
 * Task 1 + 3: overall feasibility score and generic blockers. Benchmark
 * is deliberately weighted lightly and never treated as feasibility
 * itself (Rule: "Benchmark must NOT be treated as the same thing as
 * feasibility") — it measures internal pipeline quality, feasibility
 * measures real-world Lightroom transferability.
 */
function _computeStyleFeasibility({ ctx, complexity, transferConfidence, lightroomReproduction, wbTransferRisk, referenceConfidence }) {
  const photoStyle = ctx.decisionStrategy?.finalStyleIntent?.photographerStyle?.top;
  const dnaValidation = photoStyle?.styleDNAValidation;
  const bench = ctx.styleBenchmark;
  const val = ctx.preXmpValidation;

  const dnaValidationScore = dnaValidation?.score ?? 0.7;
  const benchmarkSafety = clamp01(bench?.safetyScore ?? 0.6);
  const violationCount = val?.violations?.length ?? 0;
  const validationPenalty = Math.min(0.15, violationCount * 0.03);

  const lightroomFeasibility = clamp01(
    (lightroomReproduction?.expectedSimilarity ?? 0.5) * 0.5 +
    dnaValidationScore * 0.3 +
    (1 - complexity.score) * 0.2
  );
  const transferFeasibility = clamp01(
    transferConfidence.score * 0.5 +
    (1 - wbTransferRisk.transferRiskScore) * 0.3 +
    benchmarkSafety * 0.2
  );
  const styleComplexityPenalty = complexity.score;

  let score = clamp01(
    lightroomFeasibility * 0.45 + transferFeasibility * 0.35 + (1 - styleComplexityPenalty) * 0.20 - validationPenalty
  );

  const reasons = [], warnings = [], riskFactors = [], blockers = [], strengths = [], recommendations = [];

  reasons.push(`Base feasibility: lightroomFeasibility ${lightroomFeasibility.toFixed(2)}×0.45 + transferFeasibility ${transferFeasibility.toFixed(2)}×0.35 + (1-complexity ${styleComplexityPenalty.toFixed(2)})×0.20 − validation penalty ${validationPenalty.toFixed(2)} = ${score.toFixed(3)}.`);

  if (dnaValidationScore < 0.6) riskFactors.push(`Style DNA validation score is low (${dnaValidationScore}) — the detected style's own definition may be inconsistent.`);
  else strengths.push(`Style DNA is internally consistent (validation score ${dnaValidationScore}).`);

  // Task 2: style-specific rules
  const styleRules = _applyStyleSpecificFeasibilityRules(photoStyle?.styleName, ctx, wbTransferRisk);
  score = clamp01(score + styleRules.adjustment);
  strengths.push(...styleRules.strengths);
  riskFactors.push(...styleRules.riskFactors);
  blockers.push(...styleRules.blockers);
  if (styleRules.adjustment !== 0) reasons.push(`Style-specific adjustment for "${photoStyle?.styleName ?? 'this style'}": ${styleRules.adjustment >= 0 ? '+' : ''}${styleRules.adjustment.toFixed(2)}.`);

  // Task 3: generic blockers (never claims a specific editing tool was used)
  if (complexity.level === 'high') blockers.push('High reference complexity — localized edits beyond a global Lightroom preset may be required.');
  if (ctx.wb?.wbIntent?.mixedLightingRisk > 0.3) blockers.push('Extreme mixed lighting detected — a single global White Balance adjustment may not suit the whole frame.');
  if (wbTransferRisk.sceneDependent) riskFactors.push('Strong scene-dependent colour cast detected.');
  if (wbTransferRisk.transferRisk === 'high' && !blockers.some(b => b.includes('mixed lighting'))) blockers.push('High White Balance transfer risk.');
  if (SKIN_CRITICAL_STYLES.has(photoStyle?.styleName) && ctx.decisionStrategy?.hasSkin && (ctx.decisionStrategy?.skinConfidence ?? 1) < 0.4) {
    blockers.push('Low skin confidence for a skin-critical style — protected skin rendering cannot be guaranteed.');
  }
  if ((lightroomReproduction?.expectedSimilarity ?? 1) < 0.5) blockers.push('Low Lightroom reproduction estimate — this look likely depends on non-global edits.');
  if (violationCount > 2) blockers.push('High validation risk — multiple Pre-XMP corrections were required to keep values safe.');
  if (dnaValidation && !dnaValidation.isValid) blockers.push("Style DNA validation failed — the detected style's own definition shows internal inconsistencies.");

  if (!bench) warnings.push('Style Benchmark result unavailable — feasibility scoring used a neutral safety default.');
  if (!val) warnings.push('Pre-XMP Validation result unavailable — feasibility scoring could not confirm validation safety.');

  const level = score >= 0.7 ? 'high' : score >= 0.4 ? 'medium' : 'low';

  if (level === 'high') recommendations.push('This style is a strong candidate for direct XMP transfer — expect only minor manual touch-ups.');
  else if (level === 'medium') recommendations.push('This style is transferable but expect to review/adjust a few areas manually after applying the preset.');
  else recommendations.push('This style is a challenging transfer candidate — treat the generated XMP as a rough starting point only.');
  if (blockers.length) recommendations.push(`Key blocker(s) to review: ${blockers[0]}`);

  return {
    score: +score.toFixed(3), level, lightroomFeasibility: +lightroomFeasibility.toFixed(3),
    transferFeasibility: +transferFeasibility.toFixed(3), styleComplexityPenalty: +styleComplexityPenalty.toFixed(3),
    riskFactors, blockers, strengths, recommendations, reasons, warnings,
  };
}

/** Task 5: fold styleFeasibility into the report's top-level
 *  recommendations — specifically explaining WHY transferConfidence may
 *  read lower than referenceConfidence (a well-understood reference can
 *  still be a poor transfer candidate). */
function _buildFeasibilityRecommendations({ recommendations, styleFeasibility, referenceConfidence, transferConfidence, lightroomReproduction }) {
  const rec = [...recommendations];
  const gap = (referenceConfidence?.score ?? 0) - (transferConfidence?.score ?? 0);
  if (gap > 0.15) {
    rec.push(`Transfer confidence (${transferConfidence.score}) is notably lower than reference confidence (${referenceConfidence.score}) — style feasibility analysis points to ${styleFeasibility.riskFactors[0] ?? styleFeasibility.blockers[0] ?? 'scene-specific dependencies'} as the main reason.`);
  }
  if ((lightroomReproduction?.expectedSimilarity ?? 1) < 0.6 && styleFeasibility.level !== 'low') {
    rec.push(`Lightroom reproduction is limited (${lightroomReproduction.expectedSimilarity}) even though overall feasibility reads "${styleFeasibility.level}" — some of this look's character may not be fully global-preset-friendly.`);
  }
  if (styleFeasibility.level === 'high') rec.push('Style feasibility is high — this is a strong candidate for XMP transfer.');
  return rec;
}

function _buildRecommendations({ ctx, complexity, transferConfidence, wbTransferRisk, lightroomReproduction }) {
  const rec = [];

  // Stage 2.4.2A: reference the richer photographer-style vocabulary
  // (Decision Engine) when available — additive, purely informational.
  const photoStyle = ctx.decisionStrategy?.finalStyleIntent?.photographerStyle?.top;
  if (photoStyle) {
    rec.push(`Detected as a "${photoStyle.styleName}" look (${photoStyle.transferDifficulty} transfer difficulty) — ${photoStyle.description}`);
  }
  // Stage 2.4.2B.1: surface a note when the detected style's own DNA
  // failed internal consistency validation — informational only, does
  // not change transfer confidence/complexity computation.
  if (photoStyle?.styleDNAValidation && !photoStyle.styleDNAValidation.isValid) {
    rec.push(`[dev] Detected style's DNA has ${photoStyle.styleDNAValidation.issues.length} consistency issue(s) — see finalStyleIntent.photographerStyle.top.styleDNAValidation before this feeds a future style budget.`);
  }

  // EPIC 1.3: Reference Color Intelligence — explains WHY transferConfidence
  // reads high or low using independently-computed colour evidence, without
  // changing how transferConfidence itself is calculated anywhere above.
  const colorSupport = photoStyle?.referenceColorSupport;
  if (colorSupport) {
    if (colorSupport.supported && transferConfidence.score >= 0.6) {
      rec.push(`Reference Color Intelligence corroborates this: independent colour-only analysis ("${colorSupport.colorMood}" mood, ${colorSupport.paletteSignature}) agrees with the detected style, consistent with the ${transferConfidence.score >= 0.75 ? 'high' : 'reasonable'} transfer confidence.`);
    } else if (!colorSupport.supported && transferConfidence.score < 0.5) {
      rec.push(`Reference Color Intelligence found the colour evidence ambiguous for this style ("${colorSupport.colorMood}" mood didn't clearly point here) — consistent with the lower transfer confidence; this reference's colour signature may be less distinctive than its style label suggests.`);
    } else if (!colorSupport.supported) {
      rec.push(`Note: Reference Color Intelligence's colour-only reading ("${colorSupport.colorMood}") didn't independently corroborate the detected style — worth a quick visual sanity check, though this alone doesn't lower transfer confidence.`);
    }
  }

  // EPIC 1.4: Photographer Intent Intelligence — explains WHY transfer is
  // easy/difficult and whether the reference likely needs only global
  // colour work or more complex localized editing, using the intent
  // already computed in Decision Engine. Does not change transfer
  // algorithm computation anywhere in this module.
  const intent = ctx.decisionStrategy?.finalStyleIntent?.photographerIntent;
  if (intent) {
    rec.push(`Creative intent read as "${intent.primaryIntent}" (${intent.intentFamily}) — ${intent.styleContext?.feasibilityNotes ?? ''}`);
    // EPIC 1.5: strength/hierarchy context — explains whether the look is
    // a subtle or dominant instance of its intent, which a FUTURE Style
    // Budget stage would need to decide how strongly to apply it. Does
    // not change any transfer/complexity/confidence computation here.
    if (intent.strengthLevel) {
      rec.push(`Intent strength is "${intent.strengthLevel}" (${intent.intentStrength}) — ${intent.strengthLevel === 'dominant' || intent.strengthLevel === 'strong' ? 'a clearly-expressed look, a future Style Budget could afford to apply it assertively' : 'a subtler instance of this intent, a future Style Budget should likely apply it more conservatively'}.`);
    }
    if (intent.conflicts?.hasConflict) {
      rec.push(`[dev] Intent conflict detected (severity: ${intent.conflicts.severity}): ${intent.conflicts.conflicts.map(c => c.name).join(', ')} — see finalStyleIntent.photographerIntent.conflicts before treating this intent read as settled.`);
    }
    if (complexity.level === 'high' && ['Filmic', 'Cinematic', 'Editorial'].includes(intent.primaryIntent)) {
      rec.push(`This "${intent.primaryIntent}" intent combined with high reference complexity suggests the look may lean on localized editing beyond a single global XMP preset — treat the export as a strong starting point, not a finished result.`);
    } else if (complexity.level !== 'high' && ['Clean', 'Natural', 'Minimal', 'Classic'].includes(intent.primaryIntent)) {
      rec.push(`This "${intent.primaryIntent}" intent combined with low reference complexity suggests this look is primarily global colour/tone work — a strong candidate for a direct XMP starting point.`);
    }
  }

  // Photographer-facing
  if (wbTransferRisk.sceneDependent) rec.push(`This look depends strongly on scene lighting (${wbTransferRisk.referenceMoodWB}) — WB may require manual adjustment on a different shot.`);
  if (ctx.decisionStrategy?.hasSkin) rec.push('Skin tone should be reviewed after applying the preset, especially on a subject with different skin tone or lighting.');
  if (complexity.level !== 'low') rec.push('This reference shows signs of localized editing — expect to fine-tune after applying the preset rather than using it as-is.');
  if (transferConfidence.score < 0.5) rec.push('Transfer confidence is low — treat this preset as a strong starting point, not a final result, on a new image.');

  // Developer-facing
  if (wbTransferRisk.transferRiskScore > 0.4) rec.push('[dev] WB dependency is dominating transfer quality — see wbTransferRisk.reasons.');
  if ((ctx.styleFeatureGraph?.conflicts ?? []).length) rec.push('[dev] Scene-specific colour cast / conflicts reduced transfer confidence — see styleFeatureGraph.conflicts.');
  if (complexity.score >= 0.5) rec.push('[dev] Complexity signals suggest localized edits beyond Lightroom — see complexity.reasons and lightroomReproduction.unsupportedLook.');

  return rec;
}
