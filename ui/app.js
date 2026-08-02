/**
 * ui/app.js — LUMIXA AI (Application controller / entry-point)
 * Adapted from the original engine controller: all analysis / preset /
 * export logic is untouched. Only presentation-state wiring (dark mode,
 * tabs, modals, drag state) has been switched from stylesheet classes to
 * inline CSS custom properties + direct style assignment, to match the
 * LUMIXA visual system (no external stylesheet).
 */

import { analyzeImage }                        from '../core/histogram-engine/index.js';
import { buildPreset, serializeXMP, downloadXMP } from '../core/preset-engine/index.js';
import { extractPalette }                      from '../core/kmeans-engine/index.js';
import { analyzeWhiteBalance }                 from '../core/whitebalance-engine/index.js';
import {
  setSlider, bindSliders, switchTab,
  renderHSLPanel, renderGradingPanel, renderCalibrationPanel,
  renderAnalysisPanel, setAnalysisBox, flashSuccess,
} from './ui-engine.js';
import { renderHistograms }    from './histogram-renderer.js';
import { renderPalette }       from './palette-renderer.js';
import { renderWhiteBalance }  from './whitebalance-renderer.js';
import { ToneCurveEditor }     from './tone-curve-editor.js';
import { analyzeSkinTone }     from '../core/skintone-engine/index.js';
import { renderSkinTone }      from './skintone-renderer.js';
import { generateBasicPanel }  from '../core/basic-panel-engine/index.js';
import { renderBasicPanel }    from './basic-panel-renderer.js';
import { analyzeHSL }          from '../core/hsl-analyzer-engine/index.js';
import { renderHSLAnalyzer }   from './hsl-analyzer-renderer.js';
import { analyzeColorGrading }  from '../core/colorgrading-ai-engine/index.js';
import { renderColorGrading }   from './colorgrading-renderer.js';
import { generateToneCurves }   from '../core/tone-curve-ai-engine/index.js';
import { renderToneCurves }     from './tone-curve-renderer.js';
import { analyzeCalibration }   from '../core/calibration-engine/index.js';
import { recognizeStyle }       from '../core/style-recognition-engine/index.js';
import { renderCalibration }    from './calibration-renderer.js';
import { generateHarmonies }    from '../core/color-harmony-engine/index.js';
import { renderColorHarmony }   from './color-harmony-renderer.js';
import { analyzeImageCore }     from '../core/image-analysis-core/index.js';
import { renderImageAnalysis }  from './image-analysis-renderer.js';
import { scenePreset }         from '../core/curve-engine/index.js';
import { buildFinalPreset }     from '../core/decision-engine/index.js';
import { classifySkin }         from '../core/skin-classifier/index.js';
import { processingLog }        from '../core/processing-log/index.js';
import { buildStyleFingerprint } from '../core/style-fingerprint/index.js';
import { buildStyleFeatureGraph } from '../core/feature-fusion-engine/index.js';
import { validateFinalPreset, quickSafetyClamp } from '../core/xmp-validator/index.js';
import { benchmarkStylePreservation } from '../core/style-benchmark-engine/index.js';
import { buildDecisionReport } from '../core/decision-report-engine/index.js';
import { renderReviewConsole } from './review-console-renderer.js';
import { t } from './i18n/index.js';
import { presentReviewGuidanceCode, presentBlockerCode } from './i18n/domain-presenters.js';
import { createReviewConsoleController } from './review-console-controller.js';
import { applyPreviewEvidenceToReviewStateV2 } from '../core/lightroom-mapping-engine/mapping-v2-preview-review-state.js';
import { renderSideBySideComparison } from './side-by-side-comparison-renderer.js';
import { createVisualPreviewComparisonControllerV2 } from './visual-preview-comparison-controller-v2.js';
import { ensureVisualPreviewComparisonLayout, renderVisualPreviewComparison, clearVisualPreviewComparisonDisplay, buildRenderingPlaceholderState, buildPreparingAnalysisState } from './visual-preview-comparison-renderer-v2.js';
// DEPLOY GEOMETRY R1 — Phase B: canonical decode + EXIF orientation.
import { createPreviewSourceGeometryNormalizerV2 } from './preview-source-geometry-normalizer-v2.js';
import { createInteractiveBeforeAfterControllerV2 } from './interactive-before-after-controller-v2.js';
import { ensureInteractiveBeforeAfterLayout, getInteractiveBeforeAfterElements, renderInteractiveBeforeAfterStatus, clearInteractiveBeforeAfterDisplay } from './interactive-before-after-renderer-v2.js';
import { createInteractivePreviewObservationControllerV2 } from './interactive-preview-observation-controller-v2.js';
import { ensureInteractivePreviewObservationLayout, renderInteractivePreviewObservationV2, clearInteractivePreviewObservationDisplay, renderInteractivePreviewObservationContextV2, ensureInteractivePreviewObservationSessionLayout, renderInteractivePreviewObservationSessionV2 } from './interactive-preview-observation-renderer-v2.js';
import { createInteractivePreviewObservationSessionV2 } from './interactive-preview-observation-session-v2.js';
import { buildReferenceTransferReport } from '../core/reference-transfer-engine/index.js';
import { classifyScene }        from '../core/scene-classifier/index.js';
import { detectColorCast }      from '../core/color-cast-detector/index.js';
// EPIC 2E-P1A — Single Image Analysis Session Foundation: canonical
// Session lifecycle for the single-image workflow (see
// core/single-image/*.js). Wraps calls this file already makes into
// the engines above — no Core formula imported here is duplicated or
// altered, only the ownership of their outputs changes.
import * as singleImageOrchestrator from '../core/single-image/single-image-orchestrator.js';
// EPIC 2E-P1B — AI Image Analysis Report: pure renderer, reads only
// session.report (built by the orchestrator from already-committed
// evidence) -- never re-runs analysis, never reads DOM/slider state.
import { renderSingleImageReport, clearSingleImageReportDisplay } from './single-image-report-renderer.js';
// EPIC 2E-P1C — Canonical Lightroom Auto-Tune Candidate: pure mapping/
// store modules. The Candidate Store (not the DOM) is the source of
// Lightroom values from here on -- see P1C_CANDIDATE_ARCHITECTURE.md.
import { renderCandidateToSliders, resolveSliderEdit, getSupportedSliderIds } from '../core/single-image/candidate/candidate-slider-adapter.js';
import { candidateToLegacyPreset } from '../core/single-image/candidate/legacy-preset-adapter.js';
import * as candidateStore from '../core/single-image/candidate/candidate-store.js';
import { CANDIDATE_STATUS } from '../core/single-image/candidate/candidate-schema.js';

// ─── Theme tokens (LUMIXA visual system) ───────────────────────────────────────
const THEME = {
  dark: {
    '--bg': '#15110c', '--surface-1': '#1c1712', '--surface-2': '#241d16', '--surface-3': '#332a1c',
    '--border': '#3a2f22', '--border-strong': '#55432d',
    '--text': '#f2e8d8', '--text-dim': '#b9a582', '--text-faint': '#7d6c52',
    '--accent': '#c9a24b', '--accent-soft': 'rgba(201,162,75,.14)', '--accent-strong': '#e0bd6e', '--on-accent': '#241a0a',
    '--success': '#93ac84', '--warn': '#d99a4e', '--danger': '#c17361',
  },
  light: {
    '--bg': '#f6efe1', '--surface-1': '#fbf6ec', '--surface-2': '#f1e7d4', '--surface-3': '#e7d9c0',
    '--border': '#e0d0b2', '--border-strong': '#c9b48c',
    '--text': '#2a2013', '--text-dim': '#7d6a4d', '--text-faint': '#a5926f',
    '--accent': '#a3762a', '--accent-soft': 'rgba(163,118,42,.12)', '--accent-strong': '#8a611f', '--on-accent': '#fff8ec',
    '--success': '#5c7657', '--warn': '#b5762c', '--danger': '#9c4f3f',
  },
};
function applyThemeVars(dark) {
  const root = document.getElementById('lumixaApp');
  if (!root) return;
  const map = dark ? THEME.dark : THEME.light;
  for (const [k, v] of Object.entries(map)) root.style.setProperty(k, v);
}

// ─── State ────────────────────────────────────────────────────────────────────
const state = {
  darkMode:    localStorage.getItem('dm') !== '0',   // dark by default
  lang:        localStorage.getItem('lang')     || 'th',
  isPremium:   true,   // UNLIMITED MODE — quota system disabled
  freeCount:   0,      // unused
  imageLoaded: false,
  activeAnalysisGroup: 'overview', // which .agroup tab is currently visible — 'overview' matches its default display:flex in index.html
  lastStats:   null,
  lastPalette: null,
  lastWB:      null,
  lastSkin:    null,
  lastSingleImageReport: null, // EPIC 2E-P1B: last-built AI Image Analysis Report snapshot (UI mirror of session.report)
  lastCandidateStatus: null, // EPIC 2E-P1C: last-known Candidate status (UI mirror, for locale re-render of the status badge only)
  _candidateSliderSyncGuard: false, // EPIC 2E-P1C: true while renderCandidateToSliders() is writing sliders, so the slider 'input' listener below can ignore its own writes (no feedback loop)
  lastBasic:   null,
  lastHSL:     null,
  lastGrading: null,
  lastToneCurves: null,
  lastCalibration: null,
  lastHarmony:     null,
  lastImageAnalysis: null,
  lastStyleRecognition: null,
  lastStyleFeatureGraph: null,
  lastBenchmark: null,
  lastDecisionReport: null,
  lastReferenceTransfer: null,
  // EPIC 2E-F Phase C-A: Controlled Preview Review Console state — a
  // pure UI reflection of already-computed, shadow-only analysis
  // results. Never influences production output.
  lastPreviewSandbox: null,
  lastPreviewReviewState: null,
  // FIX4: Candidate Review is a post-preview human decision only.
  // It never gates preview generation and never enables Production/XMP.
  lastPreviewReviewGenerationId: null,
  candidateReviewAuditHistory: [],
  // R4 Phase C: bounded, serializable inputs to the persistent "AI Box"
  // analysis-complete summary, stored so it can be honestly rebuilt in
  // the CURRENT language on a locale switch -- this box is injected
  // via innerHTML (not a data-i18n-key element), so it falls outside
  // rerenderAppShellForLocale()'s declarative sweep and needs its own
  // explicit re-render hook.
  lastAnalysisBoxSummaryData: null,
  lastReviewAnnouncement: null,
  lastBuildAnnouncement: null,
  lastProcessingLog: null,
  curveEditor: null,
  // DEPLOY GEOMETRY R1 — Phase B1: the currently-selected File, retained
  // in page memory ONLY for as long as this generation is current —
  // never written to localStorage/sessionStorage/IndexedDB, never sent
  // to Network, never read for its name/path anywhere in this app.
  // Cleared unconditionally by handleReset() on every Reset/new image.
  currentRetainedFile: null,
  // DEPLOY GEOMETRY R1 — Phase B2: bounded canonical-decode evidence
  // for the current generation only (see _buildPreviewGeometryDiagnostics
  // and preview-source-geometry-normalizer-v2.js) — never raw pixels.
  lastCanonicalSourceEvidence: null,
  // SAFE RECOVERY + DEPLOY GEOMETRY R2 — Phase 4: bounded post-render
  // outcome evidence for the current generation only — lets
  // _buildPreviewGeometryDiagnostics() report the render-time blocker
  // codes (LEGACY_RENDER_FAILED / V2_RENDER_FAILED /
  // PIXEL_DIMENSION_MISMATCH / GENERATION_MISMATCH) that cannot be
  // known before render() actually resolves. Bounded primitives only.
  lastRenderOutcomeEvidence: null,
};

// DEPLOY GEOMETRY R1 — Phase B: one shared normalizer instance for the
// lifetime of the page, so canonical decode + resource release is
// tracked consistently across every analysis generation.
const previewSourceGeometryNormalizer = createPreviewSourceGeometryNormalizerV2();

// EPIC 2E-F Phase C-B: must be declared BEFORE waitForRoot(...) below —
// waitForRoot's callback (which calls ensureReviewConsoleController(),
// defined later in this file as a hoisted function declaration) can
// run SYNCHRONOUSLY if the DOM root already exists on the very first
// check, i.e. before this file has finished executing top-to-bottom
// past this point. A `let`/`const` declared further down the file is
// in the temporal dead zone until its own statement runs, so it must
// live here, ahead of the immediately-invoked waitForRoot call.
let reviewConsoleController = null;
// EPIC 2E-H Phase C: lazy-initialized once the Visual Preview
// Comparison section's skeleton (and its two target canvases) exists
// in the DOM — see ensureVisualPreviewComparisonController() below.
let visualPreviewComparisonController = null;
// EPIC 2E-I Phase A: lazy-initialized once the Interactive Before/After
// section's skeleton exists in the DOM.
let interactiveBeforeAfterController = null;
let interactivePreviewObservationController = null;

// ── EPIC 2E-J-C-F2 Step 7A-F1: safe, read-only QA snapshot hook ──────
// Gated strictly behind `?qa=1` in the page URL — when absent, no
// global hook is created at all, per this step's explicit instruction.
// Every returned field is a safe, freshly-copied primitive (number,
// string, boolean, or array/object of only those) — never image
// pixels, filenames, file paths, EXIF, user data, complete Analysis
// objects, DOM elements, or a mutable reference into live application
// state. This is purely diagnostic/read-only and never writes
// anything back into the application.
function _qaSafeNum(v) { return typeof v === 'number' && Number.isFinite(v) ? v : null; }
function _qaSafeBool(v) { return v === true || v === false ? v : null; }
function _qaSafeStr(v) { return typeof v === 'string' ? v : null; }
function _qaSafeStrArray(v) { return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 32) : []; }
// COMBINED CLOSEOUT R2 — Phase B FIX B1: a non-negative-integer-only
// numeric projection for Session summary counters — never a raw pass-
// through of an untrusted/hostile numeric value.
function _qaSafeCount(v) { return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0; }
// Bounded, string-only, max-5 Reason array (matches the Controller's own
// REASON_LIMIT — defense in depth, never trusts the source array length).
function _qaSafeReasons(v) { return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 5) : []; }

// CONTROLLED V2 VISUAL TRANSLATION R1 — Phase J: bounded, defensive
// projection of the translator's own `changedFields` entries for the
// QA snapshot — never the full adjustmentModel, never any Lightroom
// slider value beyond these 6 named, already-rounded numeric fields
// plus 2 short strings. Malformed/extra entries are dropped, not
// coerced; a max of 10 entries is enforced here too (defense-in-depth
// on top of the render plan already slicing to 10).
function _qaSafeChangedFields(v) {
  if (!Array.isArray(v)) return [];
  return v
    .filter((e) => e && typeof e === 'object')
    .slice(0, 10)
    .map((e) => ({
      field: _qaSafeStr(e.field),
      before: _qaSafeNum(e.before),
      after: _qaSafeNum(e.after),
      delta: _qaSafeNum(e.delta),
      action: _qaSafeStr(e.action),
      reason: _qaSafeStr(e.reason),
    }))
    .filter((e) => e.field !== null);
}

// DEPLOY GEOMETRY R1 — Phase A FIX A1/A2: bounded blocker-code
// diagnostics traced across the real boundary chain
// (controlledOverlayPreviewSandboxV2 -> buildVisualPreviewRenderPlanV2()
// -> finalStyleIntent.visualPreviewRenderPlanV2 -> the Visual Preview
// Comparison controller/renderer). Every returned field is a bounded
// primitive — never a raw image, pixel buffer, EXIF block, filename, or
// arbitrary internal object. `blockerCode` is one of a small, stable,
// documented vocabulary — never collapsed into a generic "under current
// safety constraints" string. Pure/read-only: never mutates
// state.lastPreviewSandbox/lastFinalStyleIntent, never affects
// production output.
function _qaSafeGenerationId(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') return v;
  return null;
}
function _buildPreviewGeometryDiagnostics(generationId) {
  const fsi = state.lastFinalStyleIntent ?? null;
  const sandbox = state.lastPreviewSandbox ?? null;
  const renderPlan = fsi && typeof fsi === 'object' ? fsi.visualPreviewRenderPlanV2 ?? null : null;
  const v2Plan = renderPlan && typeof renderPlan === 'object' ? renderPlan.v2RenderPlan ?? null : null;

  const sandboxExists = !!sandbox;
  // FIX4: Human approval is Candidate Review evidence only. It is NOT
  // a Preview-generation gate. Read the actual Candidate Review state
  // for diagnostics rather than the Sandbox's deliberately bypassed
  // legacy `human-review-complete` gate row (which now means only that
  // approval is not required to render a preview).
  const gateChecks = Array.isArray(sandbox?.previewGateChecks) ? sandbox.previewGateChecks : [];
  const candidateReviewState = state.lastPreviewReviewState ?? null;
  const humanReviewComplete = candidateReviewState
    ? candidateReviewState?.reviewGuidance?.candidateReviewComplete === true
    : null;
  const previewGenerationDependsOnReview = false;
  const canGeneratePreview = sandbox?.canGeneratePreview === true ? true : sandbox?.canGeneratePreview === false ? false : null;
  const simulatedPreviewPresetAvailable = v2Plan?.upstreamEvidence?.simulatedPreviewAvailable === true
    ? true : v2Plan?.upstreamEvidence?.simulatedPreviewAvailable === false ? false : null;
  const contradictoryEvidence = v2Plan?.upstreamEvidence?.contradictory === true;
  const hardStopBlockerText = Array.isArray(renderPlan?.blockers)
    ? renderPlan.blockers.find((b) => typeof b === 'string' && /hard stop/i.test(b)) : null;
  const hardStopCount = hardStopBlockerText ? (Number(hardStopBlockerText.match(/^(\d+)/)?.[1]) || 0) : 0;
  const renderPlanExists = !!renderPlan;
  const v2PlanExists = !!v2Plan;
  const v2Available = v2Plan?.available === true;
  const v2Renderable = v2Plan?.renderable === true;
  // Identity-fallback eligible: the exact valid-Identity-Preview policy
  // documented/implemented in core/preview-rendering/visual-preview-render-plan-v2.js
  // (read-only here, never re-derived): available + renderable + never
  // contradictory + zero concrete supported adjustments.
  const supportedAdjustments = Array.isArray(v2Plan?.adjustmentModel?.supportedAdjustments) ? v2Plan.adjustmentModel.supportedAdjustments : null;
  const identityFallbackEligible = v2Available && v2Renderable && !contradictoryEvidence
    && Array.isArray(supportedAdjustments) && supportedAdjustments.length === 0;

  const otherFailedRequiredGates = gateChecks.filter((g) => g && typeof g === 'object' && g.required && g.passed !== true && g.id !== 'human-review-complete');

  let blockerCode = null;
  if (!renderPlanExists) blockerCode = 'V2_PLAN_BUILD_FAILED';
  else if (!sandboxExists) blockerCode = 'SANDBOX_MISSING';
  else if (contradictoryEvidence) blockerCode = 'CONTRADICTORY_SAFETY_EVIDENCE';
  else if (hardStopCount > 0) blockerCode = 'HARD_SAFETY_STOP';
  else if (otherFailedRequiredGates.length > 0) blockerCode = 'SANDBOX_NOT_ELIGIBLE';
  else if (!simulatedPreviewPresetAvailable && !v2Available) blockerCode = 'SIMULATED_PRESET_UNAVAILABLE';
  else if (v2Available && !v2Renderable) blockerCode = 'SANDBOX_NOT_ELIGIBLE';
  // else: no known PRE-RENDER blocker — Sandbox/Plan eligibility looks
  // fine. SAFE RECOVERY + DEPLOY GEOMETRY R2 — Phase 4: only NOW check
  // the POST-decode/render outcome evidence for this SAME generation
  // (unavailable before decode/render actually run — this function is
  // also called once, pre-render, to compute the value threaded into
  // render() itself; at that call site none of these can fire yet,
  // which is correct — they only become reachable on a LATER call to
  // this function, e.g. via the QA snapshot hook, after decode/render
  // has resolved for this generation).
  else {
    const decodeEv = state.lastCanonicalSourceEvidence;
    const decodeEvMatchesGeneration = decodeEv && _qaSafeGenerationId(decodeEv.generationId) === _qaSafeGenerationId(generationId);
    const renderEv = state.lastRenderOutcomeEvidence;
    const renderEvMatchesGeneration = renderEv && _qaSafeGenerationId(renderEv.generationId) === _qaSafeGenerationId(generationId);

    if (decodeEv && !decodeEvMatchesGeneration) {
      blockerCode = 'GENERATION_MISMATCH';
    } else if (renderEv && !renderEvMatchesGeneration) {
      blockerCode = 'GENERATION_MISMATCH';
    } else if (decodeEvMatchesGeneration && decodeEv.decodeComplete === false && decodeEv.decodePath !== 'unavailable') {
      // 'unavailable' means decode was never attempted for this
      // generation (e.g. no file yet) — not itself a failure to
      // report; 'stale-discarded' or a genuine decode exception both
      // mean decodeComplete stays false with a real attempt made.
      blockerCode = 'SOURCE_DECODE_FAILED';
    } else if (decodeEvMatchesGeneration && decodeEv.decodeComplete === true
      && !(Number.isFinite(decodeEv.canonicalWidth) && decodeEv.canonicalWidth > 0 && Number.isFinite(decodeEv.canonicalHeight) && decodeEv.canonicalHeight > 0)) {
      blockerCode = 'SOURCE_GEOMETRY_INVALID';
    } else if (renderEvMatchesGeneration && renderEv.legacyFailed) {
      blockerCode = 'LEGACY_RENDER_FAILED';
    } else if (renderEvMatchesGeneration && renderEv.v2Failed) {
      blockerCode = 'V2_RENDER_FAILED';
    } else if (renderEvMatchesGeneration && renderEv.legacyRendered && renderEv.v2Rendered
      && (renderEv.legacyBackingWidth !== renderEv.v2BackingWidth || renderEv.legacyBackingHeight !== renderEv.v2BackingHeight)) {
      blockerCode = 'PIXEL_DIMENSION_MISMATCH';
    }
    // else: no known blocker — V2 is genuinely eligible and (if
    // decode/render evidence for this generation exists yet) succeeded
    // cleanly. blockerCode stays null.
  }

  return {
    generationId: _qaSafeGenerationId(generationId),
    sandboxExists,
    humanReviewComplete,
    previewGenerationDependsOnReview,
    candidateReviewStatus: _qaSafeStr(candidateReviewState?.candidateReviewStatus),
    canGeneratePreview,
    simulatedPreviewPresetAvailable,
    contradictoryEvidence,
    hardStopCount,
    renderPlanExists,
    v2PlanExists,
    v2Available,
    v2Renderable,
    identityFallbackEligible,
    blockerCode,
  };
}

function ensureQaSnapshotHook() {
  let qaEnabled = false;
  try { qaEnabled = new URLSearchParams(window.location.search).get('qa') === '1'; } catch { qaEnabled = false; }
  if (!qaEnabled) return; // no ?qa=1 -> no global hook created at all

  function getPreviewPipelineSnapshot() {
    const fsi = state.lastFinalStyleIntent ?? null;
    const testGate = fsi?.controlledOverlayTestGateV2 ?? null;
    const overlaySimulation = fsi?.legacyOverlaySimulationV2 ?? null;
    const legacySafetyOverlay = fsi?.legacySafetyOverlayV2 ?? null;
    const shadowCompare = fsi?.lightroomShadowCompareReportV2 ?? null;
    const safetyClamp = fsi?.lightroomSafetyClampV2 ?? null;
    const previewSandbox = state.lastPreviewSandbox ?? null;
    const v2Plan = fsi?.visualPreviewRenderPlanV2?.v2RenderPlan ?? null;
    const legacyPlan = fsi?.visualPreviewRenderPlanV2?.legacyRenderPlan ?? null;

    let interactiveState = null, alignmentStatus = null;
    try {
      const ibaState = interactiveBeforeAfterController ? interactiveBeforeAfterController.getState() : null;
      interactiveState = _qaSafeStr(ibaState?.state);
      // LOCAL-FIRST QA FIX: Interactive Before/After stores its real
      // geometry evidence on the top-level `alignment` object, not at
      // `metadata.alignment.status`.  Reading the old path made the QA
      // snapshot report null even while the rendered UI truthfully showed
      // "Alignment: Exact dimensions".  Derive the same bounded friendly
      // label from the canonical tri-state evidence used by the renderer.
      const qaAlignment = ibaState && typeof ibaState === 'object' ? ibaState.alignment ?? null : null;
      if (qaAlignment && typeof qaAlignment === 'object') {
        if (qaAlignment.sameAspectRatio === false) alignmentStatus = 'Blocked geometry';
        else if (qaAlignment.displayDimensionsNormalized === true) alignmentStatus = 'Normalized once';
        else if (qaAlignment.exactSourcePixelMatch === true) alignmentStatus = 'Exact dimensions';
        else if (qaAlignment.sameAspectRatio == null && qaAlignment.exactSourcePixelMatch == null) alignmentStatus = 'Not evaluated — both previews are required';
        else alignmentStatus = 'Unknown';
      } else {
        alignmentStatus = _qaSafeStr(ibaState?.blockedReason);
      }
    } catch { /* leave nulls, never throw from the QA hook */ }

    // COMBINED CLOSEOUT R2 — Phase B FIX B1: the QA-only snapshot now
    // also exposes the Observation's own selectedValue/reasons/
    // observationGenerationId (never a raw Controller reference — one
    // getState() call, then only safe bounded primitives are copied
    // out), plus a bounded Session summary projection (one getSummary()
    // call, already a fresh safe-copy from the Session module itself;
    // re-projected here defensively so this hook never depends on the
    // Session module's internal shape remaining identical forever).
    let observationEnabled = null, observationState = null, observationSelectedValue = null, observationReasons = [], observationGenerationId = null;
    try {
      const obsState = interactivePreviewObservationController ? interactivePreviewObservationController.getState() : null;
      observationState = _qaSafeStr(obsState?.state);
      observationEnabled = obsState ? (obsState.state === 'ready' || obsState.state === 'selected' || obsState.state === 'cleared') : null;
      observationSelectedValue = _qaSafeStr(obsState?.observation);
      observationReasons = _qaSafeReasons(obsState?.reasons);
      observationGenerationId = _qaSafeNum(obsState?.observationGenerationId);
    } catch { /* leave nulls/defaults, never throw from the QA hook */ }

    let sessionSummary = {
      totalObserved: 0, activeObservations: 0, preferLegacy: 0, preferV2: 0,
      noVisibleDifference: 0, unsure: 0, cleared: 0, invalidated: 0,
      reasonCounts: {}, topReasons: [], lastObservation: null,
    };
    try {
      const rawSummary = interactivePreviewObservationSession ? interactivePreviewObservationSession.getSummary() : null;
      if (rawSummary) {
        const rawCounts = (rawSummary.reasonCounts && typeof rawSummary.reasonCounts === 'object') ? rawSummary.reasonCounts : {};
        const safeCounts = {};
        for (const k of Object.keys(rawCounts)) { safeCounts[k] = _qaSafeCount(rawCounts[k]); }
        const rawTop = Array.isArray(rawSummary.topReasons) ? rawSummary.topReasons.slice(0, 3) : [];
        const safeTop = rawTop.map((t) => ({ reason: _qaSafeStr(t?.reason), count: _qaSafeCount(t?.count) })).filter((t) => t.reason !== null);
        const rawLast = rawSummary.lastObservation && typeof rawSummary.lastObservation === 'object' ? rawSummary.lastObservation : null;
        sessionSummary = {
          totalObserved: _qaSafeCount(rawSummary.totalObserved),
          activeObservations: _qaSafeCount(rawSummary.activeObservations),
          preferLegacy: _qaSafeCount(rawSummary.preferLegacy),
          preferV2: _qaSafeCount(rawSummary.preferV2),
          noVisibleDifference: _qaSafeCount(rawSummary.noVisibleDifference),
          unsure: _qaSafeCount(rawSummary.unsure),
          cleared: _qaSafeCount(rawSummary.cleared),
          invalidated: _qaSafeCount(rawSummary.invalidated),
          reasonCounts: safeCounts,
          topReasons: safeTop,
          lastObservation: rawLast ? {
            generationId: _qaSafeNum(rawLast.generationId),
            observation: _qaSafeStr(rawLast.observation),
            reasons: _qaSafeReasons(rawLast.reasons),
          } : null,
        };
      }
    } catch { /* leave the zeroed/empty default shape, never throw from the QA hook */ }

    return {
      qaContractVersion: '2E-J-C-R2',
      // SAFE RECOVERY + DEPLOY GEOMETRY R2 — Phase 1 requirement #8: the
      // Baseline Upload Contract test must confirm state.imageLoaded
      // becomes true through THIS public, bounded QA hook (never by
      // reaching into module-internal state directly). A single boolean
      // — no image data, no dimensions, no file metadata.
      imageLoaded: _qaSafeBool(state.imageLoaded),
      analysisGeneration: _qaSafeNum(analysisRenderGeneration),
      testGate: {
        exists: !!testGate,
        confidence: _qaSafeNum(testGate?.confidence),
        safetyScore: _qaSafeNum(testGate?.safetyScore),
        canPreviewOverlayPreset: _qaSafeBool(testGate?.canPreviewOverlayPreset),
        canEnterControlledTest: _qaSafeBool(testGate?.canEnterControlledTest),
      },
      overlaySimulation: {
        exists: !!overlaySimulation,
        confidence: _qaSafeNum(overlaySimulation?.confidence),
        safetyScore: _qaSafeNum(overlaySimulation?.safetyScore),
      },
      legacySafetyOverlay: {
        exists: !!legacySafetyOverlay,
        confidence: _qaSafeNum(legacySafetyOverlay?.confidence),
        safetyScore: _qaSafeNum(legacySafetyOverlay?.safetyScore),
      },
      shadowCompare: {
        exists: !!shadowCompare,
        confidence: _qaSafeNum(shadowCompare?.confidence),
        safetyScore: _qaSafeNum(shadowCompare?.safetyScore),
      },
      safetyClamp: {
        exists: !!safetyClamp,
        globalSafetyScore: _qaSafeNum(safetyClamp?.globalSafetyScore),
      },
      previewSandbox: {
        exists: !!previewSandbox,
        previewState: _qaSafeStr(previewSandbox?.previewState),
        confidence: _qaSafeNum(previewSandbox?.confidence),
        safetyScore: _qaSafeNum(previewSandbox?.safetyScore),
        canGeneratePreview: _qaSafeBool(previewSandbox?.canGeneratePreview),
        missingRequirements: _qaSafeStrArray(previewSandbox?.previewGateChecks?.filter?.((g) => g?.required && !g?.passed)?.map?.((g) => g?.reason)),
        failedGateIds: _qaSafeStrArray(previewSandbox?.previewGateChecks?.filter?.((g) => g?.required && !g?.passed)?.map?.((g) => g?.id)),
        selectedOutputSource: _qaSafeStr(previewSandbox?.selectedOutputSource),
        canWriteProduction: _qaSafeBool(previewSandbox?.canWriteProduction),
        canExportPreview: _qaSafeBool(previewSandbox?.canExportPreview),
        // FIX 5 (Step 7A-F2): safe classification only (never the
        // actual Legacy preset values) — read from the Sandbox's own
        // existing `simulatedPreviewPreset.metadata` field, already
        // produced by mapping-v2-overlay-preview-sandbox.js.
        legacyContextAvailability: _qaSafeBool(previewSandbox?.simulatedPreviewPreset?.metadata?.legacyPreviewInputAvailable),
        legacyContextSourceType: _qaSafeStr(previewSandbox?.simulatedPreviewPreset?.metadata?.sourceType),
      },
      renderPlan: {
        exists: !!v2Plan,
        v2Renderable: _qaSafeBool(v2Plan?.renderable),
        v2State: _qaSafeStr(v2Plan?.state),
        visualAdjustmentsApplied: _qaSafeBool(v2Plan?.visualAdjustmentsApplied),
      },
      // DEPLOY GEOMETRY R1 — Phase A1/A2: bounded blocker-code evidence,
      // traced from the same Sandbox/Render Plan already read above —
      // never a second independent read, never a raw internal object.
      previewGeometryDiagnostics: _buildPreviewGeometryDiagnostics(analysisRenderGeneration),
      // DEPLOY GEOMETRY R1 — Phase B2: bounded canonical-decode evidence
      // for the CURRENT generation only — re-projected defensively
      // through the same _qaSafe* helpers used everywhere else in this
      // hook, even though preview-source-geometry-normalizer-v2.js
      // already only returns bounded primitives. Never raw pixels,
      // never an ImageBitmap/canvas reference, never a filename/path.
      canonicalSourceGeometry: (() => {
        const ev = state.lastCanonicalSourceEvidence;
        if (!ev || typeof ev !== 'object') {
          return {
            generationId: null, decodePath: null, encodedOrientation: null,
            orientationAppliedByDecoder: null, canonicalWidth: null, canonicalHeight: null,
            sourceAspectRatio: null, decodeComplete: null,
          };
        }
        return {
          generationId: _qaSafeGenerationId(ev.generationId),
          decodePath: _qaSafeStr(ev.decodePath),
          encodedOrientation: _qaSafeStr(ev.encodedOrientation),
          orientationAppliedByDecoder: _qaSafeBool(ev.orientationAppliedByDecoder),
          canonicalWidth: _qaSafeNum(ev.canonicalWidth),
          canonicalHeight: _qaSafeNum(ev.canonicalHeight),
          sourceAspectRatio: _qaSafeNum(ev.sourceAspectRatio),
          decodeComplete: _qaSafeBool(ev.decodeComplete),
        };
      })(),
      visualPreview: {
        legacyState: _qaSafeStr(legacyPlan?.renderable === true ? 'renderable' : (legacyPlan ? 'not-renderable' : null)),
        controlledV2State: _qaSafeStr(v2Plan?.renderable === true ? 'renderable' : (v2Plan ? 'not-renderable' : null)),
      },
      // I18N RUNTIME CLOSURE + QA INTEGRITY R3 — Phase C: the ACTUAL
      // post-render outcome of the two isolated Canvas renderers,
      // read directly from visualPreviewComparisonController.getState()
      // — this is genuinely distinct from `visualPreview` above, which
      // only reflects Render Plan *eligibility* (computed before any
      // pixel work happens), never whether a render actually completed.
      // A Browser test proving "Legacy rendered === true / V2 rendered
      // === true" must read THIS field, never `visualPreview.*State`.
      // Bounded/safe projection only — never the raw ImageData/canvas
      // reference, never the full render-plan object.
      visualPreviewControllerState: (() => {
        try {
          const vs = visualPreviewComparisonController ? visualPreviewComparisonController.getState() : null;
          return {
            exists: !!vs,
            state: _qaSafeStr(vs?.state),
            legacyRendered: _qaSafeBool(vs?.legacy?.rendered === true),
            v2Rendered: _qaSafeBool(vs?.v2?.rendered === true),
            bothRendered: _qaSafeBool(vs?.bothRendered),
            visualComparisonAvailable: _qaSafeBool(vs?.visualComparisonAvailable),
            analysisGenerationId: _qaSafeNum(vs?.analysisGenerationId),
          };
        } catch {
          return { exists: false, state: null, legacyRendered: null, v2Rendered: null, bothRendered: null, visualComparisonAvailable: null, analysisGenerationId: null };
        }
      })(),
      interactive: {
        state: interactiveState,
        alignmentStatus,
      },
      observation: {
        enabled: observationEnabled,
        state: observationState,
        selectedValue: observationSelectedValue,
        reasons: observationReasons,
        observationGenerationId,
      },
      sessionSummary,
      // CONTROLLED V2 VISUAL TRANSLATION R1 — Phase J: bounded
      // diagnostics for the translator's own honesty fields, read
      // directly from the already-computed render-plan-level object
      // (core/preview-rendering/visual-preview-render-plan-v2.js) —
      // never re-derived, never a raw adjustmentModel, never any
      // filename/image data. `mode` is one of
      // 'legacy-derived-safety-restraint' | 'identity-fallback' |
      // 'unavailable'; `changedFields` is capped at 10 entries, each a
      // small {field, before, after, delta, action, reason} record.
      controlledV2Translation: (() => {
        // EPIC 2E-J FULL-SYSTEM I18N + CROSS-LAYER HONESTY R1 -- Phase E:
        // FIX for Defect 2C -- same invalid-root-read bug as the
        // Side-by-Side comparison note above: `controlledV2Translation`
        // lives at `visualPreviewRenderPlanV2.v2RenderPlan.controlledV2Translation`,
        // never at the root of `visualPreviewRenderPlanV2` itself.
        const t = fsi?.visualPreviewRenderPlanV2?.v2RenderPlan?.controlledV2Translation ?? null;
        return {
          exists: !!t,
          mode: _qaSafeStr(t?.mode),
          meaningful: _qaSafeBool(t?.meaningful),
          identityFallback: _qaSafeBool(t?.identityFallback),
          visualizedAdjustmentCount: _qaSafeNum(t?.visualizedAdjustmentCount),
          supportedAdjustments: _qaSafeStrArray(t?.supportedAdjustments),
          changedFields: _qaSafeChangedFields(t?.changedFields),
          confidence: _qaSafeNum(t?.confidence),
        };
      })(),
      // CONTROLLED V2 VISUAL TRANSLATION R1 — Phase J: bounded
      // Human Review progress summary, read directly from the already-
      // computed Review State Engine output
      // (core/lightroom-mapping-engine/mapping-v2-preview-review-state.js)
      // — never re-derived or re-filtered here, so this can never
      // disagree with what the Review Console UI itself shows.
      reviewGuidance: (() => {
        const g = state.lastPreviewReviewState?.reviewGuidance ?? null;
        return {
          exists: !!g,
          visualRequired: _qaSafeNum(g?.visualRequired),
          visualPassed: _qaSafeNum(g?.visualPassed),
          systemRequired: _qaSafeNum(g?.systemRequired),
          systemVerified: _qaSafeNum(g?.systemVerified),
          readyToBuildV2: _qaSafeBool(g?.readyToBuildV2),
          candidateReviewComplete: _qaSafeBool(g?.candidateReviewComplete),
          previewGenerationDependsOnReview: _qaSafeBool(g?.previewGenerationDependsOnReview),
          candidateReviewStatus: _qaSafeStr(state.lastPreviewReviewState?.candidateReviewStatus),
          previewEvidenceReady: _qaSafeBool(state.lastPreviewReviewState?.metadata?.previewEvidenceReady),
          productionSource: _qaSafeStr(state.lastPreviewReviewState?.productionSource),
          productionWrite: _qaSafeBool(state.lastPreviewReviewState?.productionWrite),
          controlledV2Apply: _qaSafeBool(state.lastPreviewReviewState?.controlledV2Apply),
          previewExport: _qaSafeBool(state.lastPreviewReviewState?.previewExport),
        };
      })(),
    };
  }

  window.__LUMIXA_QA__ = { getPreviewPipelineSnapshot };
}
// EPIC 2E-J Phase B: the session summary is created ONCE and persists
// across Re-analyze/New image/Reset — only the current generation's
// record is invalidated/cleared on those events, never the whole
// session (per this phase's explicit "do not clear the whole session"
// requirement).
let interactivePreviewObservationSession = null;
// Tracks which generation's invalidation has already been sent to the
// session module, so repeated lifecycle callbacks for the SAME
// generation never double-count an invalidation.
let lastInvalidatedObservationGenerationId = null;
// FIX 1 (EPIC 2E-J-B-F2): tracks which generation ACTUALLY owns the
// current active Session record — never inferred from
// `currentGenerationId` (which may already refer to a brand-new
// generation by the time the Observation controller reports
// unavailable/cleared for the OLD one).
let activeObservationSessionGenerationId = null;
// FIX 3 (EPIC 2E-J-B-F2): a compact signature (generation|observation|
// reasons) used to detect a GENUINE change worth recording — a
// metadata-only transition (provider-confirmation flicker, warning
// text change) while the Observation remains "selected" must never
// re-call recordObservation() and artificially advance the Session's
// updatedSequence.
let lastObservationSyncSignature = null;

// ─── Boot ─────────────────────────────────────────────────────────────────────
// The DC/React runtime streams and mounts the template asynchronously, so the
// real DOM (#lumixaApp and its children) does not necessarily exist yet by the
// time the browser fires DOMContentLoaded for this thin host document. Poll
// until the root is actually present before wiring anything up.
function waitForRoot(cb) {
  const root = document.getElementById('lumixaApp');
  if (root && document.getElementById('darkBtn')) { cb(); return; }
  requestAnimationFrame(() => waitForRoot(cb));
}
waitForRoot(() => {
  applyDarkMode();
  updateStatusPills();
  setupFileHandlers();
  setupHeaderActions();
  setupNavigation();
  setupRedeemCode();

  const hslCard  = document.getElementById('hslCard');
  const gradCard = document.getElementById('gradCard');
  const calCard  = document.getElementById('calCard');
  if (hslCard)  renderHSLPanel(hslCard, state.lang);
  if (gradCard) renderGradingPanel(gradCard, state.lang);
  if (calCard)  renderCalibrationPanel(calCard, state.lang);

  bindSliders(document.body);

  // EPIC 2E-P1C — Candidate-owned slider synchronization (Slider -> Candidate).
  // Wired exactly once at boot, over exactly the supported slider-ID set
  // (getSupportedSliderIds()) -- confirmed via source audit that
  // renderHSLPanel/renderGradingPanel/renderCalibrationPanel above are
  // themselves called exactly once at boot and never again on language
  // change, so this listener never needs to be re-attached. Each edit:
  // updates ONE Candidate parameter (never rebuilds/reruns analysis),
  // sets status USER_EDITED, bumps revision. Guarded by
  // state._candidateSliderSyncGuard so a Candidate -> Slider render
  // (runAnalysis()'s commit block, resetAllToAuto, etc.) can never loop
  // back into a spurious "user edit."
  for (const sliderId of getSupportedSliderIds()) {
    const el = document.getElementById(sliderId);
    if (!el) continue;
    el.addEventListener('input', function () {
      if (state._candidateSliderSyncGuard) return;
      const resolved = resolveSliderEdit(sliderId, this.value);
      if (!resolved) return;
      const session = singleImageOrchestrator.getActiveSessionSnapshot();
      if (!session) return;
      candidateStore.updateCandidateParameter(session.sessionId, session.generationId, resolved.parameterPath, resolved.clampedValue);
      const c = candidateStore.getActiveCandidate();
      if (c) { state.lastCandidateStatus = c.status; updateCandidateStatusBadge(c.status); }
    });
  }

  window.switchTab = switchTab;
  setupAnalysisTabs();
  setupAnalysisResizeObserver();
  ensureReviewConsoleController();
  ensureQaSnapshotHook();

  // Tone Curve Editor — init after DOM ready
  const curveCanvas = document.getElementById('toneCurveCanvas');
  if (curveCanvas) {
    state.curveEditor = new ToneCurveEditor(curveCanvas, {
      dark:      state.darkMode,
      onChange:  (cs) => { state.lastCurveSet = cs; },
    });
    // Wire channel buttons
    document.querySelectorAll('[data-curve-ch]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-curve-ch]').forEach(b => styleCurveBtn(b, false));
        styleCurveBtn(btn, true);
        state.curveEditor.setChannel(btn.dataset.curveCh);
      });
    });
    document.getElementById('btnCurveReset')?.addEventListener('click', () => {
      state.curveEditor.resetChannel();
    });
    document.getElementById('btnCurveResetAll')?.addEventListener('click', () => {
      state.curveEditor.resetAll();
    });
  }
});

// ─── Visual-state helpers (inline-style based) ─────────────────────────────────
function styleCurveBtn(btn, active) {
  const ch = btn.dataset.curveCh;
  const colors = { master: 'var(--accent)', red: '#b5544a', green: '#7c9468', blue: '#5f7fa3' };
  if (active) {
    btn.style.background = colors[ch]; btn.style.color = '#fff8ec'; btn.style.borderColor = colors[ch];
  } else {
    btn.style.background = 'var(--surface-2)'; btn.style.color = 'var(--text-dim)'; btn.style.borderColor = 'var(--border)';
  }
}
function styleAtab(btn, active) {
  btn.style.background = active ? 'var(--accent)' : 'transparent';
  btn.style.color = active ? 'var(--on-accent)' : 'var(--text-dim)';
}
function styleNavItem(btn, active) {
  btn.style.background = active ? 'var(--accent-soft)' : 'transparent';
  btn.style.color = active ? 'var(--accent)' : 'var(--text-dim)';
  btn.style.fontWeight = active ? '700' : '500';
}
window.openModal  = (id) => { const m = document.getElementById(id); if (m) m.style.display = 'flex'; };
window.closeModal = (id) => { const m = document.getElementById(id); if (m) m.style.display = 'none'; };

// ─── Dark mode ────────────────────────────────────────────────────────────────
function applyDarkMode() {
  applyThemeVars(state.darkMode);
  document.documentElement.classList.toggle('light', !state.darkMode);
  const btn = document.getElementById('darkBtn');
  if (btn) {
    const icon = btn.querySelector('.material-symbols-outlined');
    if (icon) icon.textContent = state.darkMode ? 'light_mode' : 'dark_mode';
  }
}
function toggleDarkMode() {
  state.darkMode = !state.darkMode;
  localStorage.setItem('dm', state.darkMode ? '1' : '0');
  applyDarkMode();
  // Re-render canvases with new theme
  if (state.curveEditor) {
    state.curveEditor.setDark(state.darkMode);
  }
  if (state.lastStats) {
    const hc = document.getElementById('histCanvas');
    if (hc) renderHistograms(hc, state.lastStats, { dark: state.darkMode });
  }
  if (state.lastPalette) {
    const pc = document.getElementById('paletteCanvas');
    if (pc) renderPalette(pc, state.lastPalette, { dark: state.darkMode });
  }
  if (state.lastHarmony) {
    const hc = document.getElementById('harmonyCanvas');
    if (hc) renderColorHarmony(hc, state.lastHarmony, { dark: state.darkMode });
  }
  if (state.lastImageAnalysis) {
    const iac = document.getElementById('imageAnalysisCanvas');
    if (iac) renderImageAnalysis(iac, state.lastImageAnalysis, { dark: state.darkMode });
  }
  if (state.lastCalibration) {
    const cc = document.getElementById('calibrationCanvas');
    if (cc) renderCalibration(cc, state.lastCalibration, { dark: state.darkMode });
  }
  if (state.lastToneCurves) {
    const tc = document.getElementById('toneCurveAICanvas');
    if (tc) renderToneCurves(tc, state.lastToneCurves, state.lastStats, { dark: state.darkMode });
  }
  if (state.lastGrading) {
    const cc = document.getElementById('colorGradingCanvas');
    if (cc) renderColorGrading(cc, state.lastGrading, { dark: state.darkMode });
  }
  if (state.lastHSL) {
    const hc = document.getElementById('hslAnalyzerCanvas');
    if (hc) renderHSLAnalyzer(hc, state.lastHSL, { dark: state.darkMode });
  }
  if (state.lastBasic) {
    const bc = document.getElementById('basicCanvas');
    if (bc) renderBasicPanel(bc, state.lastBasic, { dark: state.darkMode });
  }
  if (state.lastSkin) {
    const sc = document.getElementById('skinCanvas');
    if (sc) renderSkinTone(sc, state.lastSkin, { dark: state.darkMode });
  }
  if (state.lastWB) {
    const wc = document.getElementById('wbCanvas');
    if (wc) renderWhiteBalance(wc, state.lastWB, { dark: state.darkMode });
  }
}

// ─── Status pills ─────────────────────────────────────────────────────────────
function updateStatusPills() {
  const planEl  = document.getElementById('planText');
  const usageEl = document.getElementById('usageText');
  if (planEl)  planEl.textContent  = 'UNLIMITED';
  if (usageEl) usageEl.textContent = '∞';
}

// ─── Language ─────────────────────────────────────────────────────────────────
function openLangModal()  { const m = document.getElementById('langModal');  if (m) m.style.display = 'flex'; }
function closeLangModal() { const m = document.getElementById('langModal');  if (m) m.style.display = 'none'; }
// EPIC 2E-J FULL-SYSTEM I18N + CROSS-LAYER HONESTY R1 -- Phase C.
// State-preserving language switch: re-renders every currently-visible
// section from ALREADY-COMPUTED state -- never re-runs runAnalysis(),
// never re-decodes the source image, never re-invokes the pixel
// renderer or touches Mapping/XMP/production output, never mutates
// Review/Observation progress. This is what makes setLang() a REAL
// application-wide switch (Defect 1) rather than a no-op that only
// updated state.lang/localStorage/pill styling. Each section is
// wrapped in its own try/catch so one section's re-render failure can
// never take down the others (or leave state.lang un-applied).
/**
 * FULL-SYSTEM I18N COMPLETION R2 -- Phase I: re-applies every static
 * app-shell string in index.html from the centralized dictionary.
 *
 * Static markup carries `data-i18n-key` (text content) and
 * `data-i18n-placeholder-key` (input placeholders). This function is a
 * PURE presentation pass: it only writes `textContent` / the
 * `placeholder` attribute on elements that already exist. It never
 * reloads the page, never re-runs Analysis, never touches a canvas,
 * and never mutates any analysis/review/observation state.
 */
/**
 * R4 Phase C: rebuilds the persistent "AI Box" analysis-complete
 * summary HTML from bounded, stored data + the given language --
 * called both at the moment analysis completes AND again from
 * rerenderCurrentUiForLocale() on every locale switch, so this box
 * (injected via innerHTML, not covered by the declarative
 * data-i18n-key sweep) never keeps showing yesterday's language after
 * the user switches. Only the photographer-facing prefix line
 * ("Analysis complete -- category ...") is localized; the technical
 * diagnostic detail below it (WB Temp/Tint, clamps, Pre-XMP
 * corrections, benchmark warnings) is intentionally left as
 * developer-facing diagnostic prose, consistent with this file's
 * established "Developer Details" convention elsewhere.
 */
function _buildAnalysisBoxOkHtml(data, lang) {
  if (!data || typeof data !== 'object') return '';
  const { category, portraitSafe, wbTempFinal, wbTempRaw, wbTintFinal, wbTintRaw, wbConfidence, wbNeutralPixelCount, skinPct, skinSource, fingerprintMatchPct, styleSimilarityPct, safetyPct, clampsApplied, violations, benchmarkWarnings } = data;
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[ch]));
  const prefix = `<strong>${esc(t('analysisBox.analysisComplete', null, lang))} — ${esc(category)}${portraitSafe ? ` · ${esc(t('appShell.analysisPortraitSafe', null, lang))} ✓` : ''}</strong><br><small>`;
  const rows = [
    `${t('appShell.analysisWbTemp', null, lang)}: ${esc(wbTempFinal)} (${t('appShell.analysisRaw', null, lang)} ${esc(wbTempRaw)})`,
    `${t('appShell.analysisTint', null, lang)}: ${esc(wbTintFinal)} (${t('appShell.analysisRaw', null, lang)} ${esc(wbTintRaw)})`,
    `${t('appShell.analysisConfidence', null, lang)}: ${esc(wbConfidence)}%`,
    `${t('appShell.analysisNeutralPixels', null, lang)}: ${esc(wbNeutralPixelCount)}`,
    `${t('appShell.analysisSkin', null, lang)}: ${esc(skinPct)}% (${esc(skinSource)})`,
    `${t('appShell.analysisStyleFingerprint', null, lang)}: ${esc(fingerprintMatchPct)}%`,
  ];
  if (Number.isFinite(styleSimilarityPct)) rows.push(`${t('appShell.analysisStyleSimilarity', null, lang)}: ${styleSimilarityPct}%`);
  if (Number.isFinite(safetyPct)) rows.push(`${t('appShell.analysisSafety', null, lang)}: ${safetyPct}%`);
  let body = rows.join(' · ');
  const technical = [];
  if (Array.isArray(clampsApplied) && clampsApplied.length) technical.push(`${t('appShell.analysisClamps', null, lang)}: ${clampsApplied.map(esc).join(' | ')}`);
  if (Array.isArray(violations) && violations.length) technical.push(`${t('appShell.analysisCorrections', null, lang)}: ${violations.map(esc).join(', ')}`);
  if (Array.isArray(benchmarkWarnings) && benchmarkWarnings.length) technical.push(`${t('appShell.analysisWarnings', null, lang)}: ${benchmarkWarnings.slice(0, 2).map(esc).join(' | ')}`);
  if (technical.length) body += `<details style="margin-top:6px"><summary>${esc(t('appShell.analysisDeveloperDetails', null, lang))}</summary><span style="color:var(--warn)">${technical.join('<br>')}</span></details>`;
  return `${prefix}${body}</small>`;
}

function rerenderAppShellForLocale(lang) {
  let textApplied = 0;
  let placeholderApplied = 0;
  try {
    document.querySelectorAll('[data-i18n-key]').forEach((node) => {
      try {
        const key = node.getAttribute('data-i18n-key');
        if (!key) return;
        const text = t(key, null, lang);
        // t() returns the literal key when missing -- never paint a raw
        // dotted key path onto the shell; leave the existing text alone.
        if (text && text !== key) { node.textContent = text; textApplied += 1; }
      } catch { /* one bad node never blocks the rest of the shell */ }
    });
    document.querySelectorAll('[data-i18n-placeholder-key]').forEach((node) => {
      try {
        const key = node.getAttribute('data-i18n-placeholder-key');
        if (!key) return;
        const text = t(key, null, lang);
        if (text && text !== key) { node.setAttribute('placeholder', text); placeholderApplied += 1; }
      } catch { /* ignore a single bad node */ }
    });
  } catch (err) {
    console.warn('App-shell locale re-render failed (other sections unaffected):', err);
  }
  return { textApplied, placeholderApplied };
}

function _presentReviewAnnouncement(presentation, lang) {
  if (!presentation || typeof presentation.code !== 'string') return '';
  const key = `review.announcement.${presentation.code}`;
  const text = t(key, presentation.params || null, lang);
  return text === key ? '' : text;
}

function _presentBuildAnnouncement(presentation, lang) {
  if (!presentation || typeof presentation.code !== 'string') return '';
  if (presentation.code === 'SAFETY_RESTRAINT') return t('review.outcome.safetyRestraint', null, lang);
  if (presentation.code === 'IDENTITY_FALLBACK') return t('review.outcome.identityFallback', null, lang);
  if (presentation.code === 'BLOCKED') {
    const reason = presentBlockerCode(presentation.params?.blockerCode, lang);
    return t('review.outcome.blocked', { reason }, lang);
  }
  if (presentation.code === 'UNAVAILABLE') return t('review.outcome.unavailable', null, lang);
  return '';
}

function _setLiveRegionWithoutLocaleAnnouncement(id, text) {
  const node = document.getElementById(id);
  if (!node) return;
  const previous = node.getAttribute('aria-live');
  node.setAttribute('aria-live', 'off');
  node.textContent = text || '';
  queueMicrotask(() => {
    if (!node.isConnected) return;
    if (previous == null) node.removeAttribute('aria-live'); else node.setAttribute('aria-live', previous);
  });
}

function _rerenderPersistentAnnouncementsForLocale() {
  _setLiveRegionWithoutLocaleAnnouncement('reviewConsoleLiveRegion', _presentReviewAnnouncement(state.lastReviewAnnouncement, state.lang));
  _setLiveRegionWithoutLocaleAnnouncement('buildControlledV2LiveRegion', _presentBuildAnnouncement(state.lastBuildAnnouncement, state.lang));
}

function rerenderCurrentUiForLocale() {
  // App shell first: nav, buttons, section titles, upload area, tips.
  try { rerenderAppShellForLocale(state.lang); } catch (err) { console.warn('Locale re-render: app shell failed (other sections unaffected):', err); }
  try { _rerenderPersistentAnnouncementsForLocale(); } catch (err) { console.warn('Locale re-render: live announcements failed:', err); }
  try { const panel = document.getElementById('analysisInner'); if (panel?.__lumixaAnalysisStats) renderAnalysisPanel(panel, panel.__lumixaAnalysisStats, state.lang); } catch (err) { console.warn('Locale re-render: Analysis panel labels failed:', err); }
  try { const success = document.getElementById('successMsg'); if (success && success.style.display !== 'none') success.textContent = t('appShell.downloadSuccess', null, state.lang); } catch (err) { console.warn('Locale re-render: download status failed:', err); }

  // R4 Phase C: the persistent "AI Box" analysis-complete summary is
  // innerHTML-injected (not a data-i18n-key element), so it falls
  // outside the declarative sweep above and needs its own explicit
  // re-render from the bounded data stashed when analysis completed.
  try {
    if (state.lastAnalysisBoxSummaryData) setAnalysisBox('ok', _buildAnalysisBoxOkHtml(state.lastAnalysisBoxSummaryData, state.lang));
  } catch (err) { console.warn('Locale re-render: Analysis status box failed (other sections unaffected):', err); }

  // EPIC 2E-P1B: AI Image Analysis Report -- re-renders from the
  // already-built report snapshot only; never rebuilds the report,
  // never touches session.evidence.
  try {
    const reportInner = document.getElementById('singleImageReportInner');
    if (reportInner && reportInner.dataset.reportLayoutBuilt === '1' && state.lastSingleImageReport) {
      renderSingleImageReport(reportInner, state.lastSingleImageReport, state.lang);
    }
  } catch (err) { console.warn('Locale re-render: AI Image Analysis Report failed (other sections unaffected):', err); }

  // EPIC 2E-P1C: Candidate status badge -- text-only re-render from the
  // last-known status mirror. Never rebuilds the Candidate, never
  // re-renders sliders, never touches the Candidate Store.
  try { updateCandidateStatusBadge(state.lastCandidateStatus); } catch (err) { console.warn('Locale re-render: Candidate status badge failed (other sections unaffected):', err); }

  // Review Console (+ its own Build Controlled V2 Preview button
  // label/hint) -- already a pure function of state.lastPreviewSandbox
  // / state.lastPreviewReviewState / state.lang.
  try { renderReviewConsoleFromState(); } catch (err) { console.warn('Locale re-render: Review Console failed (other sections unaffected):', err); }

  // Data Comparison ("Side-by-Side Preview Comparison") -- already a
  // pure function of state.lastSideBySideComparison merged with the
  // stashed plan-time/resolved Visual Preview hint.
  try { _rerenderDataComparisonWithResolvedVisualState(); } catch (err) { console.warn('Locale re-render: Data Comparison failed (other sections unaffected):', err); }

  // Visual Preview Comparison -- re-renders from the last settled
  // vprState (or an honest "preparing" placeholder if none has
  // settled yet) -- never re-invokes the pixel renderer, never
  // touches the canvases (see this renderer's own SKELETON/METADATA
  // SEPARATION guarantee: only metadata/status text is updated here).
  try {
    const vprInner = document.getElementById('visualPreviewComparisonInner');
    if (vprInner && vprInner.dataset.vprLayoutBuilt === '1') {
      const vprStateForLocale = state.lastVisualPreviewComparisonState ?? buildPreparingAnalysisState();
      renderVisualPreviewComparison(vprInner, vprStateForLocale, state.lang);
    }
  } catch (err) { console.warn('Locale re-render: Visual Preview Comparison failed (other sections unaffected):', err); }

  // Interactive Before/After -- re-renders from the last state the
  // controller itself emitted; never re-syncs sources, never re-reads
  // the display canvases.
  try {
    const ibaInner = document.getElementById('interactiveBeforeAfterInner');
    if (ibaInner && ibaInner.dataset.ibaLayoutBuilt === '1' && state.lastIbaState) {
      renderInteractiveBeforeAfterStatus(ibaInner, state.lastIbaState, state.lang);
    }
  } catch (err) { console.warn('Locale re-render: Interactive Before/After failed (other sections unaffected):', err); }

  // Preview Observation (+ Context summary + Session Observation
  // Summary) -- re-renders from the last state the controller itself
  // emitted and the last context info computed; the session summary's
  // underlying counts are read fresh from the session module's own
  // live getSummary() (that data is not itself language-dependent,
  // only its labels are, and getSummary() is a read-only accessor that
  // never mutates the in-memory session).
  try {
    const obsInner = document.getElementById('interactivePreviewObservationInner');
    if (obsInner && obsInner.dataset.ipoLayoutBuilt === '1' && state.lastObservationState) {
      renderInteractivePreviewObservationV2(obsInner, state.lastObservationState, state.lang);
    }
    if (obsInner && obsInner.dataset.ipoLayoutBuilt === '1' && state.lastObservationContextInfo) {
      renderInteractivePreviewObservationContextV2(obsInner, state.lastObservationContextInfo, state.lang);
    }
    const sessionInner = document.getElementById('interactivePreviewObservationSessionInner');
    if (sessionInner && sessionInner.dataset.ipoSessionLayoutBuilt === '1' && interactivePreviewObservationSession) {
      renderInteractivePreviewObservationSessionV2(sessionInner, interactivePreviewObservationSession.getSummary(), state.lang);
    }
  } catch (err) { console.warn('Locale re-render: Preview Observation failed (other sections unaffected):', err); }
}

function setLang(lang) {
  const normalizedLang = lang === 'th' ? 'th' : 'en';
  state.lang = normalizedLang; localStorage.setItem('lang', normalizedLang); document.documentElement.lang = normalizedLang;
  document.querySelectorAll('.lang-opt').forEach(o => {
    const active = o.dataset.lang === normalizedLang;
    o.style.borderColor = active ? 'var(--accent)' : 'var(--border)';
    o.style.background  = active ? 'var(--accent-soft)' : 'transparent';
  });
  // EPIC 2E-J Phase C: a real, state-preserving, application-wide
  // language switch -- re-renders every currently-visible section from
  // already-computed state. Wrapped so a re-render failure can never
  // leave state.lang/localStorage/pill styling un-applied (those three
  // have already happened, unconditionally, above).
  try { rerenderCurrentUiForLocale(); } catch (err) { console.warn('setLang: locale re-render failed (state.lang was still updated):', err); }
  // Announce the switch (and its state-preservation guarantee) through
  // a dedicated, persistent aria-live region -- never reused for any
  // other announcement, so it can never race Review/Build-V2 feedback.
  try {
    const liveRegion = document.getElementById('langChangeLiveRegion');
    if (liveRegion) {
      const languageName = t(normalizedLang === 'th' ? 'app.languageNameTh' : 'app.languageNameEn', null, normalizedLang);
      liveRegion.textContent = t('app.languageChanged', { language: languageName }, normalizedLang);
    }
  } catch (err) { console.warn('setLang: language-change announcement failed (language switch itself was still applied):', err); }
}
window.setLang   = setLang;
window.closeLang = closeLangModal;

// ─── Navigation ───────────────────────────────────────────────────────────────
function redrawGroup(groupName) {
  const groupEl = document.querySelector(`.agroup[data-group="${groupName}"]`);
  const draw = {
    overview: () => {
      if (state.lastImageAnalysis) { const c=document.getElementById('imageAnalysisCanvas'); if(c) renderImageAnalysis(c, state.lastImageAnalysis, {dark:state.darkMode}); }
      if (state.lastStats)         { const c=document.getElementById('histCanvas');          if(c) renderHistograms(c, state.lastStats, {dark:state.darkMode}); }
      if (state.lastPalette)       { const c=document.getElementById('paletteCanvas');       if(c) renderPalette(c, state.lastPalette, {dark:state.darkMode}); }
    },
    tone: () => {
      if (state.lastBasic)      { const c=document.getElementById('basicCanvas');       if(c) renderBasicPanel(c, state.lastBasic, {dark:state.darkMode}); }
      if (state.lastToneCurves) { const c=document.getElementById('toneCurveAICanvas'); if(c) renderToneCurves(c, state.lastToneCurves, state.lastStats, {dark:state.darkMode}); }
      if (state.lastWB)         { const c=document.getElementById('wbCanvas');          if(c) renderWhiteBalance(c, state.lastWB, {dark:state.darkMode}); }
    },
    colour: () => {
      if (state.lastHSL)         { const c=document.getElementById('hslAnalyzerCanvas'); if(c) renderHSLAnalyzer(c, state.lastHSL, {dark:state.darkMode}); }
      if (state.lastGrading)     { const c=document.getElementById('colorGradingCanvas');if(c) renderColorGrading(c, state.lastGrading, {dark:state.darkMode}); }
      if (state.lastCalibration) { const c=document.getElementById('calibrationCanvas'); if(c) renderCalibration(c, state.lastCalibration, {dark:state.darkMode}); }
      if (state.lastHarmony)     { const c=document.getElementById('harmonyCanvas');     if(c) renderColorHarmony(c, state.lastHarmony, {dark:state.darkMode}); }
    },
    detail: () => {
      if (state.lastSkin) { const c=document.getElementById('skinCanvas'); if(c) renderSkinTone(c, state.lastSkin, {dark:state.darkMode}); }
    },
  };
  // Same shared readiness flow as first-import: waits for the now-visible
  // group's layout to settle (not just one requestAnimationFrame) before
  // drawing — RE-ANALYZE CONSISTENCY requires the same sizing logic on
  // every render path. `groupEl` is only used to wait for LAYOUT
  // readiness here (image/fonts/frames/non-zero-size) — its width is
  // NOT passed down to renderImageAnalysis/renderPalette, since each
  // section has its own padding different from the .agroup's. Each
  // renderer resolves its OWN canvas's content width via
  // resolveCanvasCssWidth once its section is visible and settled.
  waitForAnalysisRenderReady({ containers: [groupEl] }).then(() => {
    (draw[groupName] || (() => {}))();
  });
}

function setupAnalysisTabs() {
  const tabs = document.querySelectorAll('.atab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const group = tab.dataset.group;
      tabs.forEach(t => styleAtab(t, t === tab));
      document.querySelectorAll('.agroup').forEach(g => {
        g.style.display = (g.dataset.group === group) ? 'flex' : 'none';
      });
      state.activeAnalysisGroup = group;
      redrawGroup(group);   // re-render now-visible canvases (fixes offsetWidth 0)
    });
  });
}

// ─── Analysis canvas resize handling ───────────────────────────────────────────
// Redraws the currently-visible analysis group's canvases from CACHED
// state.last* results when its container is resized (browser resize,
// mobile rotation, sidebar collapse, etc.) — never re-runs K-Means or any
// other analysis computation, only re-renders the existing data at the
// new measured size.
function setupAnalysisResizeObserver() {
  const activeGroupEl = () => document.querySelector(`.agroup[data-group="${state.activeAnalysisGroup}"]`) || document.querySelector('.agroup[data-group="overview"]');

  const scheduleRedraw = (() => {
    let rafPending = false;
    return () => {
      if (rafPending) return;
      rafPending = true;
      requestAnimationFrame(() => {
        rafPending = false;
        const el = activeGroupEl();
        const group = el?.dataset?.group;
        if (group) redrawGroup(group);
      });
    };
  })();

  if (typeof ResizeObserver === 'undefined') {
    // Safe fallback for browsers without ResizeObserver support.
    let resizeTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(scheduleRedraw, 150);
    });
    return;
  }

  const lastWidths = new WeakMap();
  const ro = new ResizeObserver(entries => {
    for (const entry of entries) {
      const target = entry.target;
      const newWidth = entry.contentRect.width;
      const previousWidth = lastWidths.get(target) ?? 0;
      // Skip when width hasn't meaningfully changed — prevents redraw
      // (and any possible ResizeObserver) loops from a sub-pixel/no-op
      // trigger. Tracked PER ELEMENT so one hidden group reporting 0
      // width can never clobber another group's last-known width.
      if (Math.abs(newWidth - previousWidth) < 1) continue;
      lastWidths.set(target, newWidth);
      // Only the currently active/visible group with a genuinely
      // positive width should ever trigger a redraw — a hidden .agroup
      // (display:none) reports contentRect.width === 0 and must never
      // schedule a redraw of the group that's actually on screen.
      const isActiveGroup = target.dataset?.group === state.activeAnalysisGroup;
      if (isActiveGroup && newWidth > 0) scheduleRedraw();
    }
  });
  document.querySelectorAll('.agroup').forEach(el => ro.observe(el));
}

function setupNavigation() {
  window.scrollToSection = (id, btn) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
    document.querySelectorAll('.nav-item').forEach(b => styleNavItem(b, false));
    if (btn) styleNavItem(btn, true);
  };
}

// ─── Header ───────────────────────────────────────────────────────────────────
function setupHeaderActions() {
  document.getElementById('darkBtn')?.addEventListener('click', toggleDarkMode);
  document.getElementById('langBtn')?.addEventListener('click', openLangModal);
  document.getElementById('langModal')?.addEventListener('click', e => {
    if (e.target.id === 'langModal') closeLangModal();
  });
}

// ─── File handling ────────────────────────────────────────────────────────────
function setupFileHandlers() {
  document.getElementById('fileIn')?.addEventListener('change',  e => loadFile(e.target.files[0]));
  document.getElementById('fileIn2')?.addEventListener('change', e => loadFile(e.target.files[0]));

  const zone = document.getElementById('dropZone');
  if (zone) {
    zone.addEventListener('dragover',  e => { e.preventDefault(); zone.style.borderColor = 'var(--accent)'; zone.style.background = 'var(--accent-soft)'; });
    zone.addEventListener('dragleave', ()  => { zone.style.borderColor = 'var(--border)'; zone.style.background = 'var(--surface-1)'; });
    zone.addEventListener('drop', e => {
      e.preventDefault(); zone.style.borderColor = 'var(--border)'; zone.style.background = 'var(--surface-1)';
      loadFile(e.dataTransfer.files[0]);
    });
  }

  document.getElementById('btnDownload')?.addEventListener('click',  handleDownload);
  document.getElementById('btnReanalyze')?.addEventListener('click', handleReanalyze);
  document.getElementById('btnReset')?.addEventListener('click',     handleReset);
  document.getElementById('btnBuildControlledV2')?.addEventListener('click', handleBuildControlledV2Preview);
}

async function loadFile(file) {
  if (!file?.type.startsWith('image/')) return;

  // EPIC 2E-P1A R3 FIX: handleReset() MUST run BEFORE beginUpload().
  // R2's ordering (beginUpload() then handleReset()) created the new
  // Session first, but handleReset() unconditionally calls
  // singleImageOrchestrator.resetActiveSession(state) — which ABORTS
  // and CLEARS whatever Session is currently active, including the one
  // beginUpload() had just created one line earlier, and also nulls
  // activeUploadTicket. Every subsequent img.onload -> runAnalysis()
  // call then found no active ticket and returned immediately,
  // stranding the UI on "loading" permanently. See
  // P1A_UPLOAD_LIFECYCLE_FIX.md for the full root-cause writeup.
  //
  // The correct order: reset/abort whatever was previously active
  // FIRST, THEN create the new Session. beginUpload() itself also
  // calls abortActiveSession() internally as a defensive first step,
  // so a prior in-flight analysis is aborted exactly once either way
  // — handleReset() here additionally clears the DOM/legacy state that
  // beginUpload() intentionally does not touch (it owns Session
  // lifecycle only, not UI).
  handleReset();

  // Create the new upload Session and capture its ticket into a LOCAL
  // constant that this call's own reader/img closures reference
  // directly — never the shared, reassignable `activeUploadTicket`
  // module variable — so a slow-resolving PRIOR image's img.onload
  // (fired after a newer upload has already reassigned
  // activeUploadTicket) can never be misattributed to the newer
  // Session. `activeUploadTicket` is still updated for
  // handleReanalyze()/runAnalysis()'s own no-arg call sites, which
  // intentionally want "whatever Session is current right now".
  const uploadTicket = await singleImageOrchestrator.beginUpload(file);
  activeUploadTicket = uploadTicket;

  // Clears the PREVIOUS image's retained File/canonical-decode
  // resources (DEPLOY GEOMETRY R1 — Phase B1/B4) via handleReset()
  // above; this line then retains the NEW file, exactly once.
  state.currentRetainedFile = file;

  const reader = new FileReader();
  reader.onload = e => {
    const img = document.getElementById('previewImg');
    if (!img) return;

    // Show loading state immediately
    document.getElementById('uploadWrap').style.display  = 'none';
    document.getElementById('previewWrap').style.display = 'block';
    document.getElementById('sliders').style.display     = 'none';
    setAnalysisBox('loading', t('analysisBox.loadingImage', null, state.lang));

    // Wait for image to fully decode before reading pixels
    img.onload = () => {
      state.imageLoaded = true;
      // EPIC 2E-P1A: record decode completion on the Session BEFORE
      // analysis starts, using THIS call's captured uploadTicket (not
      // the current activeUploadTicket — see the note above). If a
      // newer upload has since superseded uploadTicket, both
      // markImageDecoded() and startAnalysisTicket() (inside
      // runAnalysis()) independently no-op via the same generation-
      // ownership check in single-image-session-store.js — this stale
      // callback can never mutate or start analysis for the newer
      // Session. analysisProxy stays null in this round: the real
      // pipeline has no distinct downscaled-proxy object today, each
      // engine downsamples internally (documented in
      // P1A_SINGLE_IMAGE_SESSION_ARCHITECTURE.md "Known limitations").
      if (uploadTicket) {
        singleImageOrchestrator.markImageDecoded(uploadTicket, {
          width: img.naturalWidth,
          height: img.naturalHeight,
          decodedSource: img,
          displaySource: img,
          analysisProxy: null,
        });
      }
      runAnalysis(uploadTicket);
    };
    img.onerror = () => {
      setAnalysisBox('error', t('analysisBox.imageLoadFailed', null, state.lang));
      if (uploadTicket) singleImageOrchestrator.markImageDecodeFailed(uploadTicket, new Error('Image decode failed'));
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

// ─── Analysis canvas render readiness ──────────────────────────────────────────
// Root cause of the "first import renders wrong, Re-analyze fixes it" bug:
// the first-import path used to commit a canvas render after only ONE
// requestAnimationFrame following a display:none→block change, without
// waiting for (a) the image to fully decode, (b) web fonts used by the
// canvas text (Inter, JetBrains Mono — canvases never auto-redraw when a
// font finishes loading later), or (c) the container's layout to
// genuinely settle. Re-analyze happened to look correct only because by
// that point the container had already been visible for a while and
// fonts had long since loaded — it was never actually a different/more
// correct code path, just a lucky later timing. This helper is shared by
// every render call (first import, Re-analyze, tab switch, resize) so
// there is exactly one readiness contract instead of two silently
// different ones.
// EPIC 2E-H-C-F2 FIX 1: safe property access for the canonical Visual
// Preview Render Plan chain — optional chaining (`?.`) protects against
// null/undefined but NOT against a throwing getter on an object that
// genuinely exists. Any read that throws is treated as missing
// evidence, never propagated as an uncaught exception into the main
// analysis flow.
function safeGetVisualPreviewProperty(object, key, fallback = undefined) {
  try {
    if (!object || typeof object !== 'object') return fallback;
    return object[key];
  } catch {
    return fallback;
  }
}

let analysisRenderGeneration = 0;
// EPIC 2E-P1A: the current Single Image Analysis Session's
// {sessionId, generationId} ticket — the single-image workflow's
// counterpart to `analysisRenderGeneration` above, but for STATE
// WRITES (state.last*) and Candidate/XMP-adjacent commits rather than
// DOM/canvas render callbacks (which `analysisRenderGeneration`
// already protects — see P1A_SOURCE_LINEAGE_AUDIT.md §9/§13). Set by
// loadFile() -> singleImageOrchestrator.beginUpload(), read by
// runAnalysis()/handleReanalyze()/handleReset().
let activeUploadTicket = null;
// R4 Phase G: tracks the in-flight, fire-and-forget Visual Preview
// Comparison render() promise for the CURRENT generation, so callers
// outside runAnalysis() (e.g. handleBuildControlledV2Preview) can
// genuinely await the resolved render outcome instead of reading
// visualPreviewComparisonController.getState() immediately after
// runAnalysis() resolves -- which could still return a pre-render
// eligibility/plan-time state, since render() is never awaited inside
// runAnalysis() itself (by design, so a slow/failed preview render
// never delays or breaks the rest of the analysis result).
let _latestVisualPreviewRenderSettlePromise = null;
let _latestVisualPreviewRenderSettleGeneration = null;

async function waitForAnalysisRenderReady({ image = null, containers = [], maxFrames = 6 } = {}) {
  // 1. Wait for the image to fully decode. img.onload (used to trigger
  // runAnalysis) already guarantees naturalWidth/naturalHeight are
  // available, but decode() additionally guarantees the browser has
  // finished the (potentially async) image decode work — falls back
  // safely if unsupported or if it rejects on an already-loaded image.
  if (image && typeof image.decode === 'function') {
    try { await image.decode(); } catch { /* onload already fired — safe to continue with the fallback (already-loaded) state */ }
  }
  // 2. Wait for web fonts used by canvas text. Canvas text is drawn as
  // pixels once, at draw time — unlike DOM text it never reflows when a
  // font finishes loading afterward, so drawing before fonts are ready
  // can bake in fallback-font metrics permanently until the next redraw.
  if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) {
    try { await document.fonts.ready; } catch { /* Font Loading API unsupported/failed — proceed with whatever font is currently available rather than blocking forever */ }
  }
  // 3/4. Wait for the browser to complete layout after any display
  // change. Two animation frames, not one: the first frame is when the
  // browser commits a display:none→block layout change; the second
  // guarantees layout/paint has fully settled before we measure.
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  // 5. Measure the actual containers. Bounded retry (never an infinite
  // loop) if a container still reports zero width/height — e.g. an
  // ancestor element is still settling its own layout.
  const measure = () => containers.map(c => (c ? c.getBoundingClientRect() : null));
  let rects = measure();
  let attempt = 0;
  while (rects.some(rect => !rect || rect.width <= 0) && attempt < maxFrames) {
    await new Promise(resolve => requestAnimationFrame(resolve));
    rects = measure();
    attempt++;
  }
  return rects;
}

// ─── Analysis pipeline ────────────────────────────────────────────────────────
// EPIC 2E-F Phase C-A, upgraded Phase C-B: renders the Controlled
// Preview Review Console from the current
// state.lastPreviewSandbox/lastPreviewReviewState. As of Phase C-B this
// includes interactive Pass/Fail/Needs-Adjustment/Pending controls and
// an editable reviewer note, but THIS function still never calls
// runAnalysis(), never re-runs any analysis stage, and never touches
// XMP/production output directly — it only re-renders DOM from
// whatever state.lastPreviewReviewState currently holds. All actual
// state MUTATION happens inside review-console-controller.js, via the
// Review State Engine's own update/reset functions, never here.
// (`reviewConsoleController` itself is declared earlier, just before
// waitForRoot(...) — see the comment there for why.)

function _getCandidateReviewAvailability() {
  const meta = state.lastPreviewReviewState?.metadata ?? null;
  const available = meta?.previewEvidenceReady === true &&
    meta?.currentGenerationId === analysisRenderGeneration;
  return {
    available,
    reasonCode: available ? null : 'PREVIEW_EVIDENCE_REQUIRED',
  };
}

function _archiveCandidateReviewForNewGeneration(nextGenerationId) {
  const prior = state.lastPreviewReviewState;
  const priorGenerationId = state.lastPreviewReviewGenerationId;
  if (!prior || priorGenerationId === null || priorGenerationId === undefined || priorGenerationId === nextGenerationId) return;
  const manualItems = Array.isArray(prior.reviewItems) ? prior.reviewItems.filter((item) => item?.manual !== false) : [];
  const hasHumanInput = manualItems.some((item) => item?.reviewed === true || item?.reviewerDecision !== 'undecided' || (typeof item?.reviewerNote === 'string' && item.reviewerNote.trim()));
  if (hasHumanInput) {
    state.candidateReviewAuditHistory.push({
      generationId: priorGenerationId,
      candidateReviewStatus: typeof prior.candidateReviewStatus === 'string' ? prior.candidateReviewStatus : (prior.approvalState ?? 'not-started'),
      visualPassed: Number(prior.reviewGuidance?.visualPassed ?? 0),
      visualRequired: Number(prior.reviewGuidance?.visualRequired ?? 0),
      archivedAt: new Date().toISOString(),
    });
    if (state.candidateReviewAuditHistory.length > 20) state.candidateReviewAuditHistory.splice(0, state.candidateReviewAuditHistory.length - 20);
  }
}

function renderReviewConsoleFromState() {
  const reviewInner = document.getElementById('reviewConsoleInner');
  if (!reviewInner) return;
  const uiState = reviewConsoleController ? reviewConsoleController.getUiState() : null;
  renderReviewConsole(reviewInner, state.lastPreviewSandbox, state.lastPreviewReviewState, uiState, state.lang);
  _syncBuildControlledV2Button();
}

// CONTROLLED V2 VISUAL TRANSLATION R1 — Phase H: module-level flag
// preventing an overlapping second Build-V2 run — belt-and-braces on
// top of the button's own `disabled` attribute (which is set
// synchronously as the very first statement of the click handler,
// before any await, so a second click cannot reach the guard below in
// practice — this flag exists purely as defense-in-depth, e.g. against
// a synthetic/programmatic click that bypasses the DOM attribute).
let buildControlledV2InProgress = false;

/**
 * FIX4 — Preview-before-review workflow.
 * Keeps the single preview control synchronized with actual render
 * evidence. Preview generation happens automatically from Safety/Render
 * eligibility and never depends on Candidate Review approval. Once both
 * canvases are ready, this control only navigates to the comparison.
 * It never runs Analysis, never activates Production, and never writes XMP.
 */
function _syncBuildControlledV2Button() {
  const btn = document.getElementById('btnBuildControlledV2');
  const label = document.getElementById('btnBuildControlledV2Label');
  const hint = document.getElementById('btnBuildControlledV2Hint');
  if (!btn) return;

  // I18N RUNTIME CLOSURE R3 — Phase H: removed the inline
  // the old inline Thai/English ternary branches — every string here now comes
  // from the centralized dictionary (review.buildButton.*,
  // review.noPreview, review.guidance.*), all of which already existed
  // in both ui/i18n/en.js and ui/i18n/th.js but were never wired to
  // this function.
  if (buildControlledV2InProgress) {
    btn.disabled = true;
    btn.setAttribute('aria-disabled', 'true');
    btn.setAttribute('aria-busy', 'true');
    if (label) label.textContent = t('review.buildButton.building', null, state.lang);
    return;
  }
  btn.removeAttribute('aria-busy');
  if (label) label.textContent = t('review.buildButton.label', null, state.lang);

  const previewEligible = state.lastPreviewSandbox?.canGeneratePreview === true;
  const previewReady = _getCandidateReviewAvailability().available;
  btn.disabled = !previewReady;
  btn.setAttribute('aria-disabled', String(!previewReady));
  if (label) label.textContent = previewReady
    ? t('review.buildButton.viewPreview', null, state.lang)
    : t('review.buildButton.building', null, state.lang);
  if (hint) {
    hint.textContent = previewReady
      ? t('review.previewEvidenceReady', null, state.lang)
      : previewEligible
        ? t('review.previewGenerating', null, state.lang)
        : t('review.previewSafetyBlocked', null, state.lang);
  }
}

/** Minimal record check local to app.js (mirrors the same guard used throughout the renderer modules) — avoids importing an internal helper across module boundaries just for this one check. */
function _isRecordLike(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * FIX4 — View the already-rendered Controlled V2 comparison.
 * This is navigation-only: no Analysis call, no Candidate Review gate,
 * no Production activation, no export, and no XMP mutation.
 */
async function handleBuildControlledV2Preview() {
  const btn = document.getElementById('btnBuildControlledV2');
  if (!btn || btn.disabled || buildControlledV2InProgress) return;
  if (!_getCandidateReviewAvailability().available) return;

  // FIX4: Preview generation already happened automatically from
  // safety/render eligibility. This control only navigates to the
  // rendered comparison; it never re-runs Analysis and never depends
  // on Candidate Review approval.
  const vprState = visualPreviewComparisonController ? visualPreviewComparisonController.getState() : null;
  const generationId = analysisRenderGeneration;
  const translationMode = vprState?.metadata?.controlledV2Translation?.mode ?? null;
  const outcomePresentation = translationMode === 'legacy-derived-safety-restraint'
    ? { code: 'SAFETY_RESTRAINT', params: {}, category: 'view-controlled-v2', generationId }
    : translationMode === 'identity-fallback'
      ? { code: 'IDENTITY_FALLBACK', params: {}, category: 'view-controlled-v2', generationId }
      : { code: 'UNAVAILABLE', params: {}, category: 'view-controlled-v2', generationId };

  state.lastBuildAnnouncement = outcomePresentation;
  const liveRegion = document.getElementById('buildControlledV2LiveRegion');
  if (liveRegion) liveRegion.textContent = _presentBuildAnnouncement(outcomePresentation, state.lang);

  const vprSec = document.getElementById('visualPreviewComparisonSection');
  if (vprSec && vprSec.style.display !== 'none' && typeof vprSec.scrollIntoView === 'function') {
    vprSec.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (!vprSec.hasAttribute('tabindex')) vprSec.setAttribute('tabindex', '-1');
    if (typeof vprSec.focus === 'function') vprSec.focus({ preventScroll: true });
  }
}

// EPIC 2E-F Phase C-B: attaches the interactive controller EXACTLY
// ONCE per page session — not once per analysis/render. This is safe
// (and is the recommended "one-time listener registration" pattern)
// because `reviewConsoleInner` is a persistent DOM element that is
// never itself replaced; every render only replaces ITS CHILDREN via
// replaceChildren(), so a single delegated listener set attached to
// `reviewConsoleInner` continues to correctly catch clicks/input on
// freshly-rendered children across every Re-analyze and new-image
// import, with zero risk of accumulating duplicate listeners.
function ensureReviewConsoleController() {
  if (reviewConsoleController) return;
  const reviewInner = document.getElementById('reviewConsoleInner');
  if (!reviewInner) return;
  reviewConsoleController = createReviewConsoleController({
    container: reviewInner,
    // getState/setState close over `state.lastPreviewReviewState`
    // itself (re-read on every call, never captured once) — this is
    // the ONE editable Review State object for the currently active
    // analysis result, exactly as the phase spec's "State Ownership"
    // section describes. The controller never mutates the object this
    // getter returns; every call to updatePreviewReviewItemV2/
    // resetPreviewReviewStateV2 inside the controller produces a NEW
    // object, which setState below then stores.
    getState: () => state.lastPreviewReviewState,
    setState: (next) => { state.lastPreviewReviewState = next; },
    getReviewAvailability: _getCandidateReviewAvailability,
    rerender: renderReviewConsoleFromState,
    // LOCALE RUNTIME TRUTH + QA NEUTRALITY R4 -- Phase D: confirmed
    // Review Console leak ("Review item marked as passed.") -- the
    // controller that emits this raw English announcement is a
    // production-locked file (ui/review-console-controller.js) and
    // cannot be edited to emit a code. Its announcement strings are
    // drawn from a small, fixed, enumerable set (never free-form), so
    // they are safely classified+translated here at the presentation
    // boundary before ever reaching the live region -- the raw
    // English is the fallback only for an unrecognized message.
    announce: (message) => {
      const code = _REVIEW_CONTROLLER_ANNOUNCEMENT_CODES[message] || null;
      state.lastReviewAnnouncement = code ? { code, params: {}, category: 'review-action', generationId: analysisGenerationId } : null;
      const liveRegion = document.getElementById('reviewConsoleLiveRegion');
      if (liveRegion) liveRegion.textContent = code ? _presentReviewAnnouncement(state.lastReviewAnnouncement, state.lang) : _translateReviewControllerAnnouncement(message, state.lang);
    },
  });
}

const _REVIEW_CONTROLLER_ANNOUNCEMENT_CODES = {
  'Review item marked as passed.': 'ITEM_MARKED_PASSED',
  'Review item marked as failed.': 'ITEM_MARKED_FAILED',
  'Adjustment requested.': 'ADJUSTMENT_REQUESTED',
  'Review item returned to pending.': 'ITEM_RETURNED_PENDING',
  'Could not update this review item. The previous review state was kept.': 'ITEM_UPDATE_FAILED',
  'Could not reset the review state. The previous review state was kept.': 'RESET_FAILED',
  'Review state reset.': 'STATE_RESET',
  'Could not save this note. The previous review state was kept.': 'NOTE_SAVE_FAILED',
};
function _translateReviewControllerAnnouncement(message, lang) {
  if (typeof message !== 'string' || !message.trim()) return message;
  const code = _REVIEW_CONTROLLER_ANNOUNCEMENT_CODES[message];
  if (!code) return message;
  const key = `review.announcement.${code}`;
  const text = t(key, null, lang);
  return text === key ? message : text;
}

/**
 * EPIC 2E-I Phase A: syncs the Interactive Before/After viewer from an
 * already-resolved Visual Preview Comparison result. Never re-invokes
 * the pixel renderer, never re-reads the source image — only ever
 * reads the two already-rendered preview canvases
 * (`legacyVisualPreviewCanvasV2` / `controlledV2VisualPreviewCanvasV2`)
 * that `visualPreviewComparisonController.render()` already committed
 * pixels into.
 */
const SIDE_STATE_STRINGS = ['rendered', 'failed', 'blocked', 'cancelled', 'unavailable', 'unknown'];
// FIX 1 (EPIC 2E-I-B-F): normalizes a Visual Preview per-side render
// outcome's raw `state` string to one of the 6 canonical values — an
// unrecognized string is never passed through verbatim.
function _normalizeSideStateString(v) {
  return SIDE_STATE_STRINGS.includes(v) ? v : 'unknown';
}

/**
 * EPIC 2E-J FULL-SYSTEM I18N + CROSS-LAYER HONESTY R1 -- Phase F.
 *
 * Builds the bounded, page-memory-only "resolved visual state" object
 * from the ALREADY-RESOLVED vprState (produced once
 * visualPreviewComparisonController.render() genuinely settles) plus
 * the current Interactive Before/After alignment evidence. This is
 * the ONE place that reconciles "what the render plan intended"
 * (plan-time, in visualPreviewInfoForComparisonNote) with "what
 * actually rendered" (this object) for the Data Comparison layer's
 * cross-layer banner -- never re-derives/recomputes anything the
 * controller/renderer already computed, never calls Analysis again,
 * never mutates vprState.
 */
function _buildResolvedVisualState(vprState, generationId) {
  const legacyR = _isRecordLike(vprState?.legacy) ? vprState.legacy : null;
  const v2R = _isRecordLike(vprState?.v2) ? vprState.v2 : null;
  const meta = _isRecordLike(vprState?.metadata) ? vprState.metadata : null;
  const legacyRendered = legacyR?.rendered === true;
  const v2Rendered = v2R?.rendered === true;
  let alignmentExact = false;
  try {
    const ibaState = interactiveBeforeAfterController ? interactiveBeforeAfterController.getState() : null;
    const qaAlignment = ibaState && typeof ibaState === 'object' ? (ibaState.alignment ?? null) : null;
    alignmentExact = !!(qaAlignment && qaAlignment.exactSourcePixelMatch === true);
  } catch { /* never let alignment introspection affect the resolved-state object */ }
  return {
    generationId,
    renderState: typeof vprState?.state === 'string' ? vprState.state : 'unavailable',
    legacyRendered,
    v2Rendered,
    bothRendered: vprState?.bothRendered === true,
    visualComparisonAvailable: vprState?.visualComparisonAvailable === true,
    alignmentExact,
    translationMode: typeof meta?.controlledV2Translation?.mode === 'string' ? meta.controlledV2Translation.mode : null,
    visualizedAdjustmentCount: Number.isFinite(meta?.controlledV2Translation?.visualizedAdjustmentCount) ? meta.controlledV2Translation.visualizedAdjustmentCount : 0,
    allowProductionWrite: typeof meta?.allowProductionWrite === 'boolean' ? meta.allowProductionWrite : undefined,
    allowExport: typeof meta?.allowExport === 'boolean' ? meta.allowExport : undefined,
    appliedToProduction: typeof meta?.v2AppliedToProduction === 'boolean' ? meta.v2AppliedToProduction : undefined,
  };
}

/**
 * Re-renders the ALREADY-VISIBLE Data Comparison section using the
 * current plan-time hint merged with the just-built resolved visual
 * state -- never a new section, never a new engine call, never
 * changes state.lastSideBySideComparison's own semantic Unknown
 * values. A no-op if the Data Comparison section isn't currently
 * mounted (e.g. this analysis had no comparison data at all).
 */
function _rerenderDataComparisonWithResolvedVisualState() {
  if (!state.lastComparisonInnerEl || !state.lastSideBySideComparison) return;
  const planTimeInfo = _isRecordLike(state.lastVisualPreviewInfoForComparisonNote) ? state.lastVisualPreviewInfoForComparisonNote : null;
  const mergedInfo = {
    ...(planTimeInfo ?? {}),
    resolved: state.lastResolvedVisualState ?? null,
  };
  renderSideBySideComparison(state.lastComparisonInnerEl, state.lastSideBySideComparison, mergedInfo, state.lang);
}

function _syncInteractiveBeforeAfter(vprState, generationId) {
  const ibaSec = document.getElementById('interactiveBeforeAfterSection');
  const ibaInner = document.getElementById('interactiveBeforeAfterInner');
  if (!ibaSec || !ibaInner) return;

  // FIX 5 (EPIC 2E-I-A-F) / Phase B SAFE APP BOUNDARY: every untrusted
  // field on `vprState` is read exactly once through the existing
  // safeGetVisualPreviewProperty helper, normalized into a compact
  // local object, and stored — never a repeated direct/optional-chained
  // read afterward, and `vprState` itself is never mutated. A throwing
  // getter anywhere on `vprState` degrades to a safe local
  // "unavailable" Interactive Before/After result — it never breaks
  // Visual Preview Comparison (which already rendered successfully by
  // the time this runs) and never enters the main Analysis catch
  // block, since this whole function is itself called from within the
  // already-isolated Visual Preview Comparison try/catch boundary in
  // runAnalysis().
  try {
    ibaSec.style.display = 'block';

    const elements = ensureInteractiveBeforeAfterLayout(ibaInner);
    if (!elements) return;

    if (!interactiveBeforeAfterController) {
      interactiveBeforeAfterController = createInteractiveBeforeAfterControllerV2({
        ...elements,
        // The provider always reflects the CURRENT analysis generation
        // at call time — never a captured/stale value — so the
        // controller's own staleness check stays correct even across
        // multiple Re-analyze cycles without needing to be recreated.
        generationProvider: () => analysisRenderGeneration,
        // FIX 11 (EPIC 2E-I-B-F): this is the SOLE render path for
        // every state transition — both updateSources() and
        // prepareState() emit through this callback, so no separate
        // manual renderInteractiveBeforeAfterStatus() call is ever
        // needed after calling either of them below.
        onStateChange: (ibaState) => { state.lastIbaState = ibaState; renderInteractiveBeforeAfterStatus(ibaInner, ibaState, state.lang); },
      });
    }

    // Phase B: build the canonical compact normalized input ONCE —
    // every untrusted vprState field read exactly one time here, never
    // re-read afterward by the branches below.
    const vprMeta = safeGetVisualPreviewProperty(vprState, 'metadata');
    const legacyResult = safeGetVisualPreviewProperty(vprState, 'legacy');
    const v2Result = safeGetVisualPreviewProperty(vprState, 'v2');
    const legacyMeta = safeGetVisualPreviewProperty(legacyResult, 'metadata');
    const v2Meta = safeGetVisualPreviewProperty(v2Result, 'metadata');
    const rawLegacyEffect = safeGetVisualPreviewProperty(legacyMeta, 'visualAdjustmentsApplied');
    const rawV2Effect = safeGetVisualPreviewProperty(v2Meta, 'visualAdjustmentsApplied');
    const rawSelectedSource = safeGetVisualPreviewProperty(vprMeta, 'selectedProductionSource');
    const rawAllowExport = safeGetVisualPreviewProperty(vprMeta, 'allowExport');
    const rawAllowWrite = safeGetVisualPreviewProperty(vprMeta, 'allowProductionWrite');
    const rawV2Contradictory = safeGetVisualPreviewProperty(vprMeta, 'v2Contradictory');
    // FIX 1: preserve each side's actual outcome (state string +
    // bounded warnings), never collapsed to a single "rendered"
    // boolean — this is what lets Failed/Blocked/Preparing be
    // distinguished from plain Unavailable downstream.
    const rawLegacyState = safeGetVisualPreviewProperty(legacyResult, 'state');
    const rawV2State = safeGetVisualPreviewProperty(v2Result, 'state');
    const rawLegacyWarnings = safeGetVisualPreviewProperty(legacyResult, 'warnings');
    const rawV2Warnings = safeGetVisualPreviewProperty(v2Result, 'warnings');
    // I18N RUNTIME CLOSURE R3 -- Phase G: parallel STABLE CODE arrays,
    // additive alongside the raw English `warnings` above -- never
    // replacing them (Developer Details / legacy consumers still read
    // the raw text).
    const rawLegacyWarningCodes = safeGetVisualPreviewProperty(legacyResult, 'warningCodes');
    const rawV2WarningCodes = safeGetVisualPreviewProperty(v2Result, 'warningCodes');
    // CONTROLLED V2 VISUAL TRANSLATION R1 — Phase F: the Interactive
    // Before/After section must also clearly identify whether its
    // right-hand side is a meaningful Safety-restraint translation or
    // an honest Identity fallback (never a vague, undifferentiated
    // "Controlled V2" label) — reusing the SAME bounded, pre-sanitized
    // controlledV2Translation object threaded through
    // vprState.metadata (Phase D/F), never recomputed here. This is
    // prepended to v2's own warnings list, which already flows through
    // the existing, tested #ibaMessages display path — no new render
    // path is introduced.
    const rawControlledV2Translation = safeGetVisualPreviewProperty(vprMeta, 'controlledV2Translation');
    const controlledV2TranslationMode = rawControlledV2Translation && typeof rawControlledV2Translation === 'object' ? rawControlledV2Translation.mode : null;
    const v2WarningsWithLabel = Array.isArray(rawV2Warnings) ? [...rawV2Warnings] : [];
    const v2WarningCodesWithLabel = Array.isArray(rawV2WarningCodes) ? [...rawV2WarningCodes] : [];
    if (controlledV2TranslationMode === 'legacy-derived-safety-restraint') {
      v2WarningsWithLabel.unshift('Right side: Controlled V2 — Safety-restraint preview (bounded restraints on the Legacy preview; not Lightroom/ACR, not Production).');
      v2WarningCodesWithLabel.unshift('V2_SAFETY_RESTRAINT_LABEL');
    } else if (controlledV2TranslationMode === 'identity-fallback') {
      v2WarningsWithLabel.unshift('Right side: Controlled V2 — Identity fallback (no supported safety restraint produced a meaningful visual change; not the final V2 appearance).');
      v2WarningCodesWithLabel.unshift('V2_IDENTITY_FALLBACK_LABEL');
    }

    const compact = {
      generationId,
      legacy: {
        rendered: safeGetVisualPreviewProperty(legacyResult, 'rendered') === true,
        state: _normalizeSideStateString(rawLegacyState),
        visualAdjustmentsApplied: (rawLegacyEffect === true || rawLegacyEffect === false) ? rawLegacyEffect : null,
        warnings: Array.isArray(rawLegacyWarnings) ? rawLegacyWarnings.slice(0, 6) : [],
        warningCodes: Array.isArray(rawLegacyWarningCodes) ? rawLegacyWarningCodes.slice(0, 6) : [],
      },
      v2: {
        rendered: safeGetVisualPreviewProperty(v2Result, 'rendered') === true,
        state: _normalizeSideStateString(rawV2State),
        visualAdjustmentsApplied: (rawV2Effect === true || rawV2Effect === false) ? rawV2Effect : null,
        warnings: v2WarningsWithLabel.slice(0, 6),
        warningCodes: v2WarningCodesWithLabel.slice(0, 6),
      },
      bothRendered: safeGetVisualPreviewProperty(vprState, 'bothRendered') === true,
      visualComparisonAvailable: safeGetVisualPreviewProperty(vprState, 'visualComparisonAvailable') === true,
      // Phase B SAFETY INTEGRATION: mirrored, never altered, from
      // Visual Preview Comparison's own canonical evidence.
      safety: {
        selectedProductionSource: rawSelectedSource === 'legacy' ? 'legacy' : rawSelectedSource === 'v2' ? 'v2' : 'unknown',
        allowExport: rawAllowExport === true ? true : rawAllowExport === false ? false : null,
        allowProductionWrite: rawAllowWrite === true ? true : rawAllowWrite === false ? false : null,
        v2Contradictory: rawV2Contradictory === true ? true : rawV2Contradictory === false ? false : null,
      },
    };

    // Per the phase's explicit integration rule: only ever bind sources
    // when the Visual Preview Comparison genuinely completed with both
    // sides rendered — never inferred from canvas presence/dimensions
    // alone.
    const ready = compact.bothRendered && compact.visualComparisonAvailable;
    let ibaResultState = null;
    if (ready) {
      const legacySourceCanvas = document.getElementById('legacyVisualPreviewCanvasV2');
      const v2SourceCanvas = document.getElementById('controlledV2VisualPreviewCanvasV2');
      // FIX 11: updateSources() emits via onStateChange — no separate
      // render call needed here.
      ibaResultState = interactiveBeforeAfterController.updateSources({
        legacySourceCanvas, v2SourceCanvas, generationId: compact.generationId,
        legacyVisualAdjustmentsApplied: compact.legacy.visualAdjustmentsApplied,
        v2VisualAdjustmentsApplied: compact.v2.visualAdjustmentsApplied,
        safety: compact.safety,
        previewStatus: {
          legacyState: compact.legacy.state, v2State: compact.v2.state,
          legacyWarnings: compact.legacy.warnings, v2Warnings: compact.v2.warnings,
          legacyWarningCodes: compact.legacy.warningCodes, v2WarningCodes: compact.v2.warningCodes,
        },
      });
    } else {
      // FIX 2 (EPIC 2E-I-B-F): use the SAME shared state-priority
      // helper (via controller.prepareState()) that updateSources()
      // itself uses internally — never a separately hand-built
      // Partial/Unavailable object here, so safety anomalies,
      // both-failed, and blocked-preview-state are all still
      // correctly detected even though no canvas has been bound yet.
      // FIX 11: prepareState() emits via onStateChange — no separate
      // render call needed here.
      ibaResultState = interactiveBeforeAfterController.prepareState({
        legacySide: compact.legacy, v2Side: compact.v2, safety: compact.safety,
        generationId: compact.generationId,
      });
    }

    // EPIC 2E-J Phase A: sync the Preview Observation layer's context
    // from Interactive Before/After's OWN resolved state — compact
    // primitives only, never the full analysis or Visual Preview
    // object. Observation integration failures are caught locally
    // below and must never affect Interactive Before/After itself.
    _syncInteractivePreviewObservation(ibaResultState, compact.generationId);
  } catch (ibaErr) {
    // FIX 5: a failure anywhere above must affect only Interactive
    // Before/After — Visual Preview Comparison (rendered just before
    // this function was called) remains fully visible and unaffected.
    console.warn('InteractiveBeforeAfter sync failed (Visual Preview Comparison unaffected):', ibaErr);
    if (interactiveBeforeAfterController) interactiveBeforeAfterController.clear();
    // EPIC 2E-J FULL-SYSTEM I18N + CROSS-LAYER HONESTY R1 -- Phase C
    // follow-up: this last-resort fallback blocker text now also comes
    // from the centralized i18n dictionary (the exact same string
    // beforeAfter.statusMessage.failed already used by the normal
    // 'failed' status path), so a locale switch never leaves this rare
    // catch-path message stranded in English.
    try { renderInteractiveBeforeAfterStatus(ibaInner, { state: 'failed', interactive: false, warnings: [], blockers: [t('beforeAfter.statusMessage.failed', null, state.lang)] }, state.lang); } catch { /* last-resort no-op */ }
  }
}

/**
 * EPIC 2E-J Phase A: safe integration glue for the Preview Observation
 * layer. Reads Interactive Before/After's OWN resolved state (never the
 * raw Visual Preview object) through single-read safe getters, and
 * passes only a compact primitive context to the Observation
 * controller. A failure here affects ONLY the Observation section —
 * never Analysis, Visual Preview, Interactive Before/After, Mapping, or
 * XMP.
 */
/**
 * EPIC 2E-J Phase B: syncs the Session Observation Summary from a
 * compact observation-state projection. Called from the Observation
 * controller's own `onStateChange` — never reads the full mutable
 * controller/session objects, only the safe primitives already present
 * on the state object. Idempotent per generation via
 * `lastInvalidatedObservationGenerationId` (module-level), so repeated
 * lifecycle callbacks for the SAME generation never double-count an
 * invalidation.
 */
function _syncObservationSession(observationState) {
  if (!interactivePreviewObservationSession) return;
  try {
    const state = safeGetVisualPreviewProperty(observationState, 'state');
    if (state === 'selected') {
      const genId = safeGetVisualPreviewProperty(observationState, 'observationGenerationId');
      const observation = safeGetVisualPreviewProperty(observationState, 'observation');
      const rawReasons = safeGetVisualPreviewProperty(observationState, 'reasons');
      const reasons = Array.isArray(rawReasons) ? rawReasons : [];
      if (genId !== null && genId !== undefined) {
        // FIX 3 (EPIC 2E-J-B-F2): only a GENUINE change (generation,
        // observation value, or the actual reason set) is worth a new
        // recordObservation() call — a metadata-only re-emit (provider
        // confirmation flicker, warning text change) while remaining
        // "selected" for the SAME generation/observation/reasons must
        // never artificially advance the Session's updatedSequence.
        const signature = `${String(genId)}|${String(observation)}|${reasons.slice().sort().join(',')}`;
        if (signature !== lastObservationSyncSignature) {
          interactivePreviewObservationSession.recordObservation({ generationId: genId, observation, reasons });
          lastObservationSyncSignature = signature;
        }
        // FIX 1: this generation now genuinely owns the active Session
        // record — track it so a LATER cleared/unavailable/blocked
        // transition (which may report a DIFFERENT currentGenerationId
        // by then) still targets the correct generation.
        activeObservationSessionGenerationId = genId;
        lastInvalidatedObservationGenerationId = null; // this generation is active again — guard resets
      }
    } else if (state === 'cleared') {
      // FIX 1/8: the generation whose Observation was just cleared is
      // the one we were TRACKING as active — never the new
      // `currentGenerationId` (which may already be different by the
      // time this fires). Fall back to `currentGenerationId` only when
      // no tracked active generation exists at all.
      const rawCurrentGenId = safeGetVisualPreviewProperty(observationState, 'currentGenerationId');
      const targetGenId = activeObservationSessionGenerationId ?? rawCurrentGenId;
      if (targetGenId !== null && targetGenId !== undefined) {
        interactivePreviewObservationSession.removeObservation(targetGenId);
      }
      activeObservationSessionGenerationId = null;
      lastObservationSyncSignature = null;
    } else if (state === 'unavailable' || state === 'blocked') {
      // FIX 1/2/8: invalidate the generation that ACTUALLY owned the
      // prior active Observation (tracked separately) — never the
      // newly-entered `currentGenerationId`, and never invalidate at
      // all when there was no tracked active generation to begin with
      // (a brand-new generation that never had an Observation must not
      // be falsely counted as "invalidated").
      if (activeObservationSessionGenerationId !== null && lastInvalidatedObservationGenerationId !== activeObservationSessionGenerationId) {
        interactivePreviewObservationSession.invalidateGeneration(activeObservationSessionGenerationId);
        lastInvalidatedObservationGenerationId = activeObservationSessionGenerationId;
      }
      activeObservationSessionGenerationId = null;
      lastObservationSyncSignature = null;
    }
  } catch (sessionErr) {
    // A Session-module failure must never affect the Observation
    // controls themselves.
    console.warn('Observation session sync failed (Preview Observation unaffected):', sessionErr);
  }
}

function _syncInteractivePreviewObservation(ibaState, generationId) {
  const obsSec = document.getElementById('interactivePreviewObservationSection');
  const obsInner = document.getElementById('interactivePreviewObservationInner');
  if (!obsSec || !obsInner) return;
  const sessionSec = document.getElementById('interactivePreviewObservationSessionSection');
  const sessionInner = document.getElementById('interactivePreviewObservationSessionInner');

  try {
    obsSec.style.display = 'block';
    const elements = ensureInteractivePreviewObservationLayout(obsInner);
    if (!elements) return;

    let sessionClearButton = null;
    if (sessionSec && sessionInner) {
      sessionSec.style.display = 'block';
      const sessionElements = ensureInteractivePreviewObservationSessionLayout(sessionInner);
      sessionClearButton = sessionElements ? sessionElements.clearSessionButton : null;
    }
    // EPIC 2E-J Phase B: the session summary is created ONCE and
    // persists for the lifetime of the page — it is never recreated or
    // cleared by Re-analyze/New image/Reset (only the current
    // generation's record is invalidated/cleared on those events).
    if (!interactivePreviewObservationSession) {
      interactivePreviewObservationSession = createInteractivePreviewObservationSessionV2();
    }

    if (sessionClearButton && sessionClearButton.dataset.ipoSessionClearWired !== '1') {
      sessionClearButton.dataset.ipoSessionClearWired = '1';
      sessionClearButton.addEventListener('click', () => {
        if (!interactivePreviewObservationSession) return;
        interactivePreviewObservationSession.clearSession();
        // FIX 4 (EPIC 2E-J-B-F2): reset the app-level sync signature and
        // active-generation tracker BEFORE re-recording — otherwise the
        // signature would still match the just-selected Observation
        // (which never actually changed) and _syncObservationSession()
        // would incorrectly skip the recordObservation() call, leaving
        // the freshly-cleared session with zero records even though a
        // current selection is visible on screen.
        lastObservationSyncSignature = null;
        activeObservationSessionGenerationId = null;
        // Preferred documented behavior: immediately re-record the
        // current valid active Observation (if any) as the first
        // record of the freshly-cleared session, so the summary never
        // misleadingly shows zero while a current selection is
        // visible on screen.
        if (interactivePreviewObservationController) {
          const currentObsState = interactivePreviewObservationController.getState();
          _syncObservationSession(currentObsState);
        }
        if (sessionInner) {
          try { renderInteractivePreviewObservationSessionV2(sessionInner, interactivePreviewObservationSession.getSummary(), state.lang); } catch { /* best-effort */ }
        }
      });
    }

    if (!interactivePreviewObservationController) {
      interactivePreviewObservationController = createInteractivePreviewObservationControllerV2({
        ...elements,
        // FIX 2 (EPIC 2E-J-A-F): the SAME canonical current-generation
        // provider Interactive Before/After itself uses — never a
        // duplicate generation counter.
        generationProvider: () => analysisRenderGeneration,
        onStateChange: (s) => {
          state.lastObservationState = s;
          renderInteractivePreviewObservationV2(obsInner, s, state.lang);
          _syncObservationSession(s);
          if (sessionInner) {
            try { renderInteractivePreviewObservationSessionV2(sessionInner, interactivePreviewObservationSession.getSummary(), state.lang); } catch { /* session render failure must not break Observation itself */ }
          }
        },
      });
    }

    const rawState = safeGetVisualPreviewProperty(ibaState, 'state');
    const rawInteractive = safeGetVisualPreviewProperty(ibaState, 'interactive');
    const rawMetadata = safeGetVisualPreviewProperty(ibaState, 'metadata');
    const rawSafety = safeGetVisualPreviewProperty(rawMetadata, 'safety');
    const rawBlockedReason = safeGetVisualPreviewProperty(ibaState, 'blockedReason');
    // Observation must be blocked whenever Interactive Before/After itself
    // is blocked for a safety reason — never merely because the comparison
    // happens to be geometry-blocked or preview-state-blocked (those are
    // still "unavailable" for observation purposes, per this phase's
    // explicit context requirements, not a safety anomaly in themselves).
    const safetyBlocked = typeof rawState === 'string' && rawState === 'blocked' && rawBlockedReason === 'safety';

    // DEPLOY GEOMETRY R1 — Phase D: Observation may be enabled only
    // when the two sides' canonical SOURCE pixel dimensions are proven
    // EXACTLY identical — a strictly stronger requirement than
    // Interactive Before/After's own 'ready' gate, which may still
    // enter 'ready' after a one-time display-size normalization
    // (compatible aspect ratio, not necessarily identical source
    // pixels). Reading the real two-dims alignment object (never
    // re-derived here) rather than trusting `rawInteractive` alone.
    const rawAlignment = safeGetVisualPreviewProperty(ibaState, 'alignment');
    const alignExactPixelMatch = safeGetVisualPreviewProperty(rawAlignment, 'exactSourcePixelMatch');
    const alignLegacyW = safeGetVisualPreviewProperty(rawAlignment, 'sourceLegacyWidth');
    const alignLegacyH = safeGetVisualPreviewProperty(rawAlignment, 'sourceLegacyHeight');
    const alignV2W = safeGetVisualPreviewProperty(rawAlignment, 'sourceV2Width');
    const alignV2H = safeGetVisualPreviewProperty(rawAlignment, 'sourceV2Height');
    const alignDimsNonZero = Number.isFinite(alignLegacyW) && alignLegacyW > 0 && Number.isFinite(alignLegacyH) && alignLegacyH > 0
      && Number.isFinite(alignV2W) && alignV2W > 0 && Number.isFinite(alignV2H) && alignV2H > 0;
    const observationExactPixelMatchOk = rawInteractive === true && alignExactPixelMatch === true && alignDimsNonZero;

    interactivePreviewObservationController.setContext({
      generationId,
      interactiveState: typeof rawState === 'string' ? rawState : null,
      interactiveReady: observationExactPixelMatchOk,
      safetyBlocked,
      // FIX 4 (EPIC 2E-J-A-F): preserve the real blockedReason so the
      // Observation layer can distinguish safety/alignment/preview-state
      // causes honestly, rather than collapsing every "blocked" cause
      // into the same generic message.
      blockedReason: typeof rawBlockedReason === 'string' ? rawBlockedReason : null,
    });

    // EPIC 2E-J Phase B: compact comparison context summary — friendly
    // text only, never raw generation/state objects.
    const rawLegacyStatus = safeGetVisualPreviewProperty(rawMetadata, 'legacyStatus');
    const rawV2Status = safeGetVisualPreviewProperty(rawMetadata, 'v2Status');
    const legacyStatusText = safeGetVisualPreviewProperty(rawLegacyStatus, 'text');
    const v2StatusText = safeGetVisualPreviewProperty(rawV2Status, 'text');
    // FATAL DEFECT FIX (LOCAL-FIRST GEOMETRY R3 — Phase A1): `rawAlignment`
    // was previously re-declared here with `const`, a duplicate lexical
    // declaration in the same function scope as the `rawAlignment` declared
    // above (originally line 1314). This is a genuine ES-module SyntaxError
    // ("Identifier 'rawAlignment' has already been declared") that prevents
    // ui/app.js from evaluating at all under a real ESM parse goal — proven
    // via `node --input-type=module -e "import('./ui/app.js')..."`, which
    // `node --check` (used by every prior syntax sweep) fails to catch. The
    // single declaration above already holds the exact same value (same
    // ibaState, same 'alignment' property, no reassignment in between), so
    // it is reused here rather than redeclared.
    const alignSameRatio = safeGetVisualPreviewProperty(rawAlignment, 'sameAspectRatio');
    const alignNormalized = safeGetVisualPreviewProperty(rawAlignment, 'displayDimensionsNormalized');
    const alignExactMatch = safeGetVisualPreviewProperty(rawAlignment, 'exactSourcePixelMatch');
    // DEPLOY GEOMETRY R1 — Phase A FIX A3: "Blocked geometry" is reserved
    // for a GENUINE mismatch — both previews rendered and their real
    // canonical geometry was actually compared and found to differ
    // (alignSameRatio === false, a real Boolean verdict from
    // _computeAlignment(legacyDims, v2Dims) with two real dims). When
    // geometry has not been evaluated yet (only one/neither preview
    // rendered), alignSameRatio/alignExactMatch are honestly `null` —
    // this must read "Not evaluated", never be conflated with a real
    // geometry failure.
    let alignmentStatusText;
    let alignmentStatusCode;
    if (alignSameRatio === false) { alignmentStatusText = 'Blocked geometry'; alignmentStatusCode = 'BLOCKED_GEOMETRY'; }
    else if (alignNormalized === true) { alignmentStatusText = 'Normalized once'; alignmentStatusCode = 'NORMALIZED_ONCE'; }
    else if (alignExactMatch === true) { alignmentStatusText = 'Exact dimensions'; alignmentStatusCode = 'EXACT_DIMENSIONS'; }
    else if (alignSameRatio === null && alignExactMatch === null) { alignmentStatusText = 'Not evaluated — both previews are required'; alignmentStatusCode = 'NOT_EVALUATED'; }
    else { alignmentStatusText = 'Unknown'; alignmentStatusCode = 'UNKNOWN'; }

    const obsStateForContext = interactivePreviewObservationController.getState();
    const obsMeta = safeGetVisualPreviewProperty(obsStateForContext, 'metadata');
    const rawGenerationConfirmed = safeGetVisualPreviewProperty(obsMeta, 'generationConfirmed');
    const rawGenerationUsable = safeGetVisualPreviewProperty(obsMeta, 'generationUsable');
    // FIX 12 (EPIC 2E-J-B-F): renderInteractivePreviewObservationContextV2
    // expects a tri-state `generationConfirmed` (true/false/null) per
    // this exact rule table — the PRIOR logic incorrectly labeled an
    // active Provider/Context mismatch as "Context fallback" merely
    // because a provider was configured; it must instead be
    // "Unavailable" whenever generationUsable is false (a genuine
    // mismatch or missing generation), never conflated with the
    // legitimate fallback case (provider configured but gave no
    // evidence this read, while the generation itself is still usable).
    let generationConfirmedForContext;
    if (rawGenerationConfirmed === true) {
      generationConfirmedForContext = true; // Confirmed
    } else if (rawGenerationUsable === true) {
      generationConfirmedForContext = false; // Context fallback
    } else {
      generationConfirmedForContext = null; // Unavailable (mismatch or missing generation)
    }

    // Strip the "Legacy: "/"Controlled V2: " prefix that Interactive
    // Before/After's own friendly badge text already includes — the
    // Context summary below adds its own "Legacy preview: "/
    // "Controlled V2 preview: " label, so passing the raw badge text
    // through unmodified would duplicate the source name.
    const stripPrefix = (text, prefix) => (typeof text === 'string' && text.startsWith(prefix)) ? text.slice(prefix.length) : text;
    const cleanLegacyStatus = stripPrefix(legacyStatusText, 'Legacy: ');
    const cleanV2Status = stripPrefix(v2StatusText, 'Controlled V2: ');

    const observationContextInfo = {
      generationId,
      legacyStatus: typeof cleanLegacyStatus === 'string' ? cleanLegacyStatus : 'Unknown',
      v2Status: typeof cleanV2Status === 'string' ? cleanV2Status : 'Unknown',
      // I18N RUNTIME CLOSURE R3 -- Phase G: the confirmed Observation
      // Runtime leak ("Exact dimensions" shown untranslated in Thai
      // mode) -- additive STABLE CODE alongside the existing raw
      // English `alignmentStatus`, which is kept for back-compat/dev
      // fallback only.
      alignmentStatus: alignmentStatusText,
      alignmentStatusCode: alignmentStatusCode,
      generationConfirmed: generationConfirmedForContext,
    };
    state.lastObservationContextInfo = observationContextInfo;
    renderInteractivePreviewObservationContextV2(obsInner, observationContextInfo, state.lang);
  } catch (obsErr) {
    console.warn('Preview Observation sync failed (Interactive Before/After unaffected):', obsErr);
    if (interactivePreviewObservationController) interactivePreviewObservationController.reset();
  }
}

async function runAnalysis(callerTicket = null) {
  const img = document.getElementById('previewImg');
  if (!img || !img.naturalWidth || !img.naturalHeight) {
    setAnalysisBox('error', t('analysisBox.imageNotReady', null, state.lang));
    return;
  }

  // EPIC 2E-P1A R3: prefer the ticket the CALLER explicitly captured
  // (loadFile()'s img.onload passes its own upload-local `uploadTicket`
  // so a slow/stale image decode can never be attributed to a newer
  // Session — see loadFile()'s comments). Callers that don't have a
  // specific ticket of their own (handleReanalyze(), the legacy
  // `state.imageLoaded && ...` guard) fall back to whatever Session is
  // CURRENTLY active, which is the correct behavior for "re-run
  // analysis on the image that's on screen right now".
  const ticket = callerTicket || activeUploadTicket;

  // EPIC 2E-P1A: acquire this run's analysis ticket. Returns null (and
  // this function returns immediately, doing nothing further) if:
  //  - there is no active Session (shouldn't happen in the normal
  //    upload flow, but defensive),
  //  - this ticket is stale (a newer upload has superseded it) — this
  //    is also how a stale, superseded image's img.onload callback is
  //    prevented from starting analysis for a newer upload, or
  //  - analysis is ALREADY in progress for this exact Session — this
  //    is the real fix for "clicking Re-analyze twice quickly starts
  //    two concurrent runAnalysis() invocations" confirmed in
  //    P1A_SOURCE_LINEAGE_AUDIT.md §13.
  const analysisTicket = ticket
    ? singleImageOrchestrator.startAnalysisTicket(ticket.sessionId, ticket.generationId)
    : null;
  if (!analysisTicket) return;

  // COMBINED CLOSEOUT R1 — Phase B FIX B1: capture the Observation
  // Controller's PRIOR state and prior Generation ID BEFORE incrementing
  // analysisRenderGeneration — never after. The Controller's own
  // generationProvider() callback reads analysisRenderGeneration live,
  // so reading getState() AFTER the increment would let the provider
  // already report the NEW generation while the Controller's own
  // `context.generationId` still held the OLD one — getState() would
  // itself detect a transient provider/context mismatch and briefly set
  // the stale warning, only for the very next reset() call (the old
  // code) to erase it again inside the SAME synchronous task, before any
  // MutationObserver could ever observe the transition. Capturing BEFORE
  // the increment guarantees the provider and context still genuinely
  // agree at capture time — a clean read, no side effect, no premature
  // transition.
  let priorObsState = null;
  let priorGenerationId = null;
  // Recorded per FIX B1's explicit requirement — used by FIX B3 callers
  // downstream (and available for QA introspection) to confirm a stale
  // warning is only ever meaningful when a real prior Observation
  // genuinely existed.
  let priorObservationWasSelected = false;
  if (interactivePreviewObservationController) {
    priorObsState = interactivePreviewObservationController.getState();
    priorGenerationId = safeGetVisualPreviewProperty(priorObsState, 'currentGenerationId');
    priorObservationWasSelected = safeGetVisualPreviewProperty(priorObsState, 'state') === 'selected';
  }

  // New generation for this analysis run — any in-flight render callback
  // from a PREVIOUS import that resolves after this point will see its
  // captured generation number no longer match and skip committing its
  // (now stale) render. Fixes "rapid import of two different images"
  // showing a mix of the old and new image's analysis.
  const renderGeneration = ++analysisRenderGeneration;
  _archiveCandidateReviewForNewGeneration(renderGeneration);
  if (state.lastPreviewReviewState) {
    state.lastPreviewReviewState = applyPreviewEvidenceToReviewStateV2(state.lastPreviewReviewState, {
      generationId: renderGeneration, renderState: 'preparing',
      legacyRendered: false, v2Rendered: false, bothRendered: false,
      visualComparisonAvailable: false,
    });
    renderReviewConsoleFromState();
  }

  // EPIC 2E-H-C-F FIX 2: cancel any in-flight Visual Preview render and
  // clear stale pixels/metadata IMMEDIATELY on every new analysis run —
  // before the long Histogram/Skin/HSL/Decision pipeline below even
  // starts, never waiting until the new Render Plan is ready. This
  // never clears Human Review state (state.lastPreviewReviewState is
  // untouched here) — only the Visual Preview canvases/controller.
  if (visualPreviewComparisonController) {
    visualPreviewComparisonController.clear();
    const vprInnerEarly = document.getElementById('visualPreviewComparisonInner');
    // FIX 2 (EPIC 2E-H-C-F2): show an explicit "Preparing" state
    // rather than falling back to the generic empty/unavailable
    // display — the analysis pipeline is genuinely about to run, this
    // is not "nothing is happening". This update is synchronous and
    // represents the generation we JUST incremented above, so no
    // staleness check is needed here (FIX 8 applies to the later
    // asynchronous updates below, not this one).
    if (vprInnerEarly) renderVisualPreviewComparison(vprInnerEarly, buildPreparingAnalysisState(), state.lang);
  }

  // EPIC 2E-I Phase A: cancel/clear the Interactive Before/After viewer
  // at the exact same point — immediately on every new analysis run,
  // never waiting for the new previews to be ready. Split resets to 50
  // per this phase's explicit Re-analyze lifecycle requirement.
  if (interactiveBeforeAfterController) {
    const newIbaState = interactiveBeforeAfterController.clear();
    const ibaInnerEarly = document.getElementById('interactiveBeforeAfterInner');
    if (ibaInnerEarly) renderInteractiveBeforeAfterStatus(ibaInnerEarly, { ...newIbaState, state: 'preparing' }, state.lang);
  }

  // EPIC 2E-J Phase A (COMBINED CLOSEOUT R1 — Phase B FIX B2): enter a
  // real "preparing" Context for the NEW generation through the
  // Controller's own setContext() lifecycle — never reset(). This
  // covers BOTH Re-analyze and New image, since runAnalysis() is the
  // single entry point for both. setContext() detects the genuine
  // generation change itself, clears stale Observation/Reason memory
  // through the SAME centralized _clearObservationMemory() helper
  // reset() used to call, and — ONLY when a real prior Observation
  // genuinely existed (staleCleared === true) — surfaces the exact one
  // stale-generation warning through the ordinary onStateChange
  // pipeline (never a timer, never a Test-only injection). Controls
  // disable again immediately (unavailableReason: 'preparing') until
  // the new Interactive comparison reaches Ready; the warning remains
  // visible until that next genuine context transition, at which point
  // deriving state fresh from the Ready context naturally stops
  // including it (FIX B5) — no manual clearing required.
  if (interactivePreviewObservationController) {
    interactivePreviewObservationController.setContext({
      generationId: renderGeneration,
      interactiveState: 'preparing',
      interactiveReady: false,
      safetyBlocked: false,
      blockedReason: null,
    });
    // FIX B4: invalidate the prior generation's Session record exactly
    // once. The setContext() call above already synchronously emitted
    // onStateChange -> _syncObservationSession(), which independently
    // invalidates the SAME prior generation through the SAME shared
    // `lastInvalidatedObservationGenerationId` guard — so whichever path
    // runs first "wins" and this one becomes a no-op rather than a
    // second invalidation, never double-counting one transition as two.
    if (interactivePreviewObservationSession && priorGenerationId !== null && priorGenerationId !== undefined && lastInvalidatedObservationGenerationId !== priorGenerationId) {
      interactivePreviewObservationSession.invalidateGeneration(priorGenerationId);
      lastInvalidatedObservationGenerationId = priorGenerationId;
      const sessionInnerEarly = document.getElementById('interactivePreviewObservationSessionInner');
      if (sessionInnerEarly) {
        try { renderInteractivePreviewObservationSessionV2(sessionInnerEarly, interactivePreviewObservationSession.getSummary(), state.lang); } catch { /* session render failure must not break Analysis */ }
      }
    }
  }

  setAnalysisBox('loading', t('analysisBox.analyzingHistogram', null, state.lang));

  // EPIC 2E-P1B: show the Report section immediately with a
  // "building" placeholder and clear whatever report (if any) was
  // showing for a PREVIOUS image/generation -- never leaves a stale
  // report visible while a new analysis is in flight.
  {
    const reportSec = document.getElementById('singleImageReportSection');
    const reportInner = document.getElementById('singleImageReportInner');
    if (reportSec) reportSec.style.display = 'block';
    if (reportInner) clearSingleImageReportDisplay(reportInner, state.lang);
    state.lastSingleImageReport = null;
  }

  // EPIC 2E-P1C: no stale Candidate status may be visible while a new
  // analysis is in flight -- clear the badge immediately (the sliders
  // themselves keep showing their last values until the new Candidate
  // is committed, matching the Report section's own "keep old UI,
  // replace only the status" pattern above).
  updateCandidateStatusBadge(null);
  state.lastCandidateStatus = null;

  try {
    setAnalysisBox('loading', t('analysisBox.analyzingHistogram', null, state.lang));

    processingLog.reset({
      width:    img.naturalWidth,
      height:   img.naturalHeight,
      fileName: img.src ? img.src.split('/').pop().split('?')[0].slice(0,80) : '(unknown)',
    });
    const logS1 = processingLog.startStage('HistogramEngine');

    const stats = await analyzeImage(img);
    // EPIC 2E-P1A: histogram is the first REQUIRED module — commit
    // through the orchestrator (which also mirrors into state.lastStats
    // via the legacy adapter, replacing the old direct assignment) and
    // stop this run immediately if a newer Session has already
    // superseded it, rather than continuing to do wasted/stale work.
    if (!singleImageOrchestrator.commitEvidence(analysisTicket, 'histogram', { status: 'COMPLETED', result: stats, startedAt: Date.now(), completedAt: Date.now() }, state).committed) return;

    logS1.output({
      avgLum: stats.avgLum, median: stats.median,
      blackPoint: stats.blackPoint, whitePoint: stats.whitePoint,
      drStops: stats.drStops, avgSatPct: stats.avgSatPct,
      avgR: stats.avgR, avgG: stats.avgG, avgB: stats.avgB,
      rbDiff: +stats.rbDiff.toFixed(2), gDiff: +stats.gDiff.toFixed(2),
      categoryRaw: stats.category, skinPctRaw: stats.skinPct,
    });
    logS1.end('ok');

    const imageAnalysisCorePromise = analyzeImageCore(img).then(coreResult => {
      // EPIC 2E-P1A: this .then() may resolve well after a NEWER
      // upload has superseded `analysisTicket` (it's fire-and-forget,
      // Worker-backed, up to WORKER_TIMEOUT_MS=20s) — commitEvidence()
      // silently no-ops the state.lastImageAnalysis write in that case
      // instead of letting a stale image's Core result land on a
      // different image's state (P1A_SOURCE_LINEAGE_AUDIT.md §13).
      singleImageOrchestrator.commitEvidence(analysisTicket, 'imageAnalysisCore', { status: 'COMPLETED', result: coreResult, completedAt: Date.now() }, state);
      const iaSec = document.getElementById('imageAnalysisSection');
      const iac = document.getElementById('imageAnalysisCanvas');
      if (iaSec && iac) {
        iaSec.style.display = 'block';
        // UI FIX-F: measure the CANVAS itself, not the section — the
        // section's rect is a border-box width that includes its 20px
        // padding on each side, which would overshoot the canvas's
        // actual (width:100%) content box by 40px.
        waitForAnalysisRenderReady({ image: img, containers: [iac] }).then(([rect]) => {
          if (renderGeneration !== analysisRenderGeneration) return; // a newer import superseded this one
          if (!rect || rect.width <= 0) return; // FIX 6: skip safely — never commit a distorted render; ResizeObserver/tab visibility can trigger a later redraw
          renderImageAnalysis(iac, coreResult, { dark: state.darkMode, cssWidth: rect.width });
        });
      }
      return coreResult;
    }).catch(err => { console.warn('ImageAnalysisCore:', err); return null; });

    const paletteHarmonyPromise = extractPalette(img).then(palette => {
      // EPIC 2E-P1A: same staleness protection as imageAnalysisCore above.
      singleImageOrchestrator.commitEvidence(analysisTicket, 'palette', { status: 'COMPLETED', result: palette, completedAt: Date.now() }, state);
      const palSec = document.getElementById('paletteSection');
      const pc = document.getElementById('paletteCanvas');
      if (palSec && pc) {
        palSec.style.display = 'block';
        // UI FIX-F: measure the canvas itself, same rationale as above.
        waitForAnalysisRenderReady({ image: img, containers: [pc] }).then(([rect]) => {
          if (renderGeneration !== analysisRenderGeneration) return; // a newer import superseded this one
          if (!rect || rect.width <= 0) return; // FIX 6: skip safely
          renderPalette(pc, palette, { dark: state.darkMode, cssWidth: rect.width });
        });
      }
      let harmony = null;
      try {
        harmony = generateHarmonies(palette);
        singleImageOrchestrator.commitEvidence(analysisTicket, 'harmony', { status: 'COMPLETED', result: harmony, completedAt: Date.now() }, state);
        const harSec = document.getElementById('harmonySection');
        const hc = document.getElementById('harmonyCanvas');
        if (harSec && hc) {
          harSec.style.display = 'block';
          waitForAnalysisRenderReady({ image: img, containers: [hc] }).then(() => {
            if (renderGeneration !== analysisRenderGeneration) return;
            renderColorHarmony(hc, harmony, { dark: state.darkMode });
          });
        }
      } catch (err) { console.warn('ColorHarmony:', err); }
      return { palette, harmony };
    }).catch(err => { console.warn('Palette:', err); return { palette: null, harmony: null }; });

    setAnalysisBox('loading', t('analysisBox.analyzingSkinColor', null, state.lang));
    const logS3a = processingLog.startStage('SkinClassifier+CastDetector');

    const [skinClassRes, castRes] = (await Promise.allSettled([
      classifySkin(img),
      detectColorCast(img),
    ])).map(r => r.status === 'fulfilled' ? r.value : null);

    const skinPctAccurate = skinClassRes?.coveragePct ?? stats?.skinPct ?? 0;

    logS3a.output({
      skinPct: skinClassRes?.skinPct, skinPctEffective: skinPctAccurate,
      skinConfidence: skinClassRes?.confidence,
      isFaceCandidate: skinClassRes?.isFaceCandidate,
      clusterRatio: skinClassRes?.clusterRatio,
      castGlobal: castRes?.global?.label,
      castBgGreen: castRes?.bgGreenDominant,
      castSubjectNeutral: castRes?.subjectNeutral,
      castCenter: castRes?.center?.label,
      castBorder: castRes?.border?.label,
    });
    if (!skinClassRes) logS3a.warn('SkinClassifier failed — falling back to stats.skinPct');
    if (!castRes)      logS3a.warn('CastDetector failed — BG attenuation skipped');
    logS3a.end('ok');

    const logS3b = processingLog.startStage('SceneClassifier');
    const sceneRes = classifyScene(stats, skinClassRes);
    logS3b.output({
      category: sceneRes.category, confidence: sceneRes.confidence,
      categoryRaw: sceneRes.categoryRaw,
    });
    logS3b.decide('category', sceneRes.category,
      `score=${JSON.stringify(Object.fromEntries(Object.entries(sceneRes.scores ?? {}).map(([k,v])=>[k,+v.toFixed(2)])))} conf=${sceneRes.confidence}`);
    if (sceneRes.category !== sceneRes.categoryRaw)
      logS3b.warn(`Scene overrode histogram category: ${sceneRes.categoryRaw} → ${sceneRes.category}`);
    logS3b.end('ok');

    setAnalysisBox('loading', t('analysisBox.analyzingColorLight', null, state.lang));
    const logS3c = processingLog.startStage('ColorEngines',
      { category: sceneRes.category, skinPct: skinPctAccurate });

    const [skinToneRes, wbRes, hslRes, gradingRes, tcRes, calRes, styleRecRes] =
      (await Promise.allSettled([
        analyzeSkinTone(img),
        analyzeWhiteBalance(img, { category: sceneRes.category, skinPct: skinPctAccurate, cast: castRes }),
        analyzeHSL(img, { category: sceneRes.category }),
        analyzeColorGrading(img, { category: sceneRes.category }),
        generateToneCurves(img, stats),
        analyzeCalibration(img, { category: sceneRes.category, skinPct: skinPctAccurate }),
        recognizeStyle(img),
      ])).map(r => r.status === 'fulfilled' ? r.value : null);

    const skinMerged = skinToneRes
      ? { ...skinToneRes, coveragePct: skinPctAccurate, isFaceCandidate: skinClassRes?.isFaceCandidate ?? true, confidence: skinClassRes?.confidence ?? 0.5 }
      : skinClassRes;
    // EPIC 2E-P1A: every state.lastX assignment below now goes through
    // commitEvidence() (Session evidence first, legacy `state` mirror
    // second, both gated on this run's ticket still being current) —
    // local `const`s below always get the freshly-computed value
    // regardless of staleness, so downstream logic in THIS function
    // invocation (fusionCtx, buildFinalPreset, etc.) is unaffected;
    // only the SHARED `state.lastX` fields (which a different,
    // superseding Session's own commits might already be about to
    // overwrite) are protected from a stale write.
    const skin       = skinMerged;
    const wb         = wbRes;
    const cast       = castRes;
    const hsl        = hslRes;
    const grading    = gradingRes;
    const toneCurves = tcRes;
    const calibration= calRes;
    const basic      = generateBasicPanel(stats);
    const styleRecognition = styleRecRes;
    singleImageOrchestrator.commitEvidence(analysisTicket, 'skinTone', { status: 'COMPLETED', result: skin, completedAt: Date.now() }, state);
    singleImageOrchestrator.commitEvidence(analysisTicket, 'whiteBalance', { status: wb ? 'COMPLETED' : 'SOFT_FAILED', result: wb, completedAt: Date.now() }, state);
    singleImageOrchestrator.commitEvidence(analysisTicket, 'hsl', { status: hsl ? 'COMPLETED' : 'SOFT_FAILED', result: hsl, completedAt: Date.now() }, state);
    singleImageOrchestrator.commitEvidence(analysisTicket, 'colorGrading', { status: grading ? 'COMPLETED' : 'SOFT_FAILED', result: grading, completedAt: Date.now() }, state);
    singleImageOrchestrator.commitEvidence(analysisTicket, 'toneCurves', { status: toneCurves ? 'COMPLETED' : 'SOFT_FAILED', result: toneCurves, completedAt: Date.now() }, state);
    singleImageOrchestrator.commitEvidence(analysisTicket, 'calibration', { status: calibration ? 'COMPLETED' : 'SOFT_FAILED', result: calibration, completedAt: Date.now() }, state);
    // basicPanel is REQUIRED (buildFinalPreset() below reads `basic`
    // unconditionally) — stop this run here if a newer Session has
    // already superseded it.
    if (!singleImageOrchestrator.commitEvidence(analysisTicket, 'basicPanel', { status: 'COMPLETED', result: basic, completedAt: Date.now() }, state).committed) return;
    singleImageOrchestrator.commitEvidence(analysisTicket, 'styleRecognition', { status: styleRecognition ? 'COMPLETED' : 'SOFT_FAILED', result: styleRecognition, completedAt: Date.now() }, state);

    logS3c.output({
      wb_temp: wb?.consensus?.temperature, wb_tint: wb?.consensus?.tint,
      wb_confidence: wb?.confidence, wb_neutralPx: wb?.neutralPixelCount,
      wb_cast: wb?.cast, wb_moodPreservation: wb?.moodPreservation?.preservationFactor,
      skin_coveragePct: skin?.coveragePct, skin_isFace: skin?.isFaceCandidate,
      hsl_dominant: hsl?.dominant, hsl_guardrails: hsl?.guardrailsApplied,
      cal_category: calibration?.category,
      basic_exp: basic?.exposure?.value, basic_hi: basic?.highlights?.value,
      basic_toneStyle: basic?.toneStyle?.tag,
      grading_look: grading?.look,
      tc_category: toneCurves?.category,
      style_top: styleRecognition?.top?.style,
    });
    if (!wbRes)      logS3c.warn('WhiteBalance engine failed');
    if (!hslRes)     logS3c.warn('HSL engine failed');
    if (!calRes)     logS3c.warn('Calibration engine failed');
    if (!gradingRes) logS3c.warn('ColorGrading engine failed');
    if (!tcRes)      logS3c.warn('ToneCurve engine failed');
    if (!styleRecRes) logS3c.warn('StyleRecognition engine failed');
    logS3c.end('ok');

    const logPh = processingLog.startStage('PaletteHarmonyAwait');
    await Promise.allSettled([paletteHarmonyPromise]);
    logPh.output({ paletteResolved: !!state.lastPalette, harmonyResolved: !!state.lastHarmony });
    if (!state.lastPalette) logPh.warn('Palette did not resolve — Feature Fusion proceeds with graceful fallback (palette-derived intents will be null)');
    if (!state.lastHarmony) logPh.warn('Harmony did not resolve — Feature Fusion proceeds with graceful fallback');
    logPh.end('ok');

    const fusionCtx = {
      stats, basic, wb, skin, hsl, calibration, grading, toneCurves,
      palette: state.lastPalette, harmony: state.lastHarmony, styleRecognition,
      scene: sceneRes, cast: castRes,
    };
    const logFusion = processingLog.startStage('FeatureFusionEngine');
    const styleFeatureGraph = buildStyleFeatureGraph(fusionCtx);
    singleImageOrchestrator.commitEvidence(analysisTicket, 'styleFeatureGraph', { status: 'COMPLETED', result: styleFeatureGraph, completedAt: Date.now() }, state);
    logFusion.output({
      featureCount: styleFeatureGraph.features.length,
      conflictCount: styleFeatureGraph.conflicts.length,
      overallStyleConfidence: styleFeatureGraph.overallStyleConfidence,
      moodTag: styleFeatureGraph.mood.tag,
    });
    styleFeatureGraph.conflicts.forEach(c => logFusion.decide(c.type, null, c.description));
    if (styleFeatureGraph.conflicts.length) logFusion.warn(`${styleFeatureGraph.conflicts.length} engine conflict(s) detected and resolved: ${styleFeatureGraph.conflicts.map(c=>c.type).join(', ')}`);
    logFusion.end('ok');

    const logFp = processingLog.startStage('StyleFingerprint');
    const styleFingerprint = buildStyleFingerprint({ ...fusionCtx, featureGraph: styleFeatureGraph });
    singleImageOrchestrator.commitEvidence(analysisTicket, 'styleFingerprint', { status: 'COMPLETED', result: styleFingerprint, completedAt: Date.now() }, state);
    logFp.output({
      mood: styleFingerprint.mood, warmth: styleFingerprint.warmth,
      colorCast: styleFingerprint.colorCast, contrastLevel: styleFingerprint.contrastLevel,
      overallConfidence: styleFingerprint.overallConfidence,
      styleRecognitionTop: styleFingerprint.styleRecognitionTop,
    });
    logFp.end('ok');

    const logS4 = processingLog.startStage('DecisionEngine', {
      mode: 'single-image-auto', portraitSafe: !!(sceneRes.category === 'Portrait' || skinPctAccurate > 8),
    });
    const rawPreset = buildFinalPreset({
      stats, basic, wb, skin, hsl, calibration, grading, toneCurves,
      scene: sceneRes, cast: castRes, styleRecognition,
      palette: state.lastPalette, harmony: state.lastHarmony,
      fingerprint: styleFingerprint,
      // EPIC 2E-F Phase C-B: hand the CURRENT editable Review State
      // back into the pipeline (EPIC 2E-F-B-F input plumbing) so
      // in-progress human review survives Re-analyze. On a genuine new
      // image import this is always null here, because handleReset()
      // (called unconditionally at the start of loadFile(), before
      // runAnalysis() ever runs) already cleared
      // state.lastPreviewReviewState — so a different image can never
      // inherit approval from the previous one. On Re-analyze of the
      // SAME image, handleReset() is NOT called, so this carries the
      // user's current review progress in; the Review State Engine
      // then normalizes it against the freshly-computed Preview
      // Sandbox, safely downgrading any now-stale approval.
      // FIX4: every new Analysis generation starts a fresh Candidate
      // Review. Prior decisions are archived in bounded UI memory and
      // never reused for a different pixel generation.
      controlledPreviewReviewStateV2: null,
    });

    const { preset: validatedPreset, report: validationReport } = validateFinalPreset(rawPreset, styleFingerprint);
    validatedPreset._decision   = rawPreset._decision;
    validatedPreset._validation = validationReport;
    // validationReport is REQUIRED (Candidate cannot be considered
    // trustworthy without it) — stop this run here if superseded.
    if (!singleImageOrchestrator.commitEvidence(analysisTicket, 'validation', { status: 'COMPLETED', result: validationReport, completedAt: Date.now() }, state).committed) return;

    const logBench = processingLog.startStage('StyleBenchmark');
    const benchmark = benchmarkStylePreservation({
      styleFingerprint: styleFingerprint,
      styleFeatureGraph: styleFeatureGraph,
      decisionStrategy: validatedPreset._decision,
      finalPreset: validatedPreset,
      preXmpValidation: validationReport,
    });
    singleImageOrchestrator.commitEvidence(analysisTicket, 'benchmark', { status: 'COMPLETED', result: benchmark, completedAt: Date.now() }, state);
    logBench.output({
      overallStyleSimilarity: benchmark.overallStyleSimilarity,
      safetyScore: benchmark.safetyScore,
      moodSimilarity: benchmark.moodSimilarity,
      warningCount: benchmark.warnings.length,
    });
    benchmark.warnings.forEach(w => logBench.warn(w));

    let finalPreset = validatedPreset;
    if (benchmark.details.extremelyUnsafe) {
      const reclamp = quickSafetyClamp(validatedPreset);
      finalPreset = { ...reclamp.preset, _decision: validatedPreset._decision, _validation: validationReport, _benchmark: benchmark };
      // EPIC 2E-P1C: preserve the reclamp adjustments on the preset so
      // candidate-builder.js can attribute them in diagnostics.safetyClamps
      // (does not change finalPreset's Lightroom values themselves).
      finalPreset._reclampAdjustments = reclamp.adjustments;
      logBench.decide('reclamp', null, `safetyScore ${benchmark.safetyScore} < threshold — quickSafetyClamp re-applied (${reclamp.adjustments.length} adjustment(s)).`);
      reclamp.adjustments.forEach(a => logBench.decide('reclamp_detail', null, a));
    } else {
      finalPreset._benchmark = benchmark;
    }
    logBench.end('ok');

    // EPIC 2E-P1A: commit the Candidate to the Session, then only push
    // it to the sliders if this run is still the current one. This is
    // the direct fix for the spec's named "old callbacks overwriting a
    // new image ... mismatched Report, sliders, Candidate and XMP"
    // failure mode — a stale image A's finalPreset can no longer land
    // on image B's sliders.
    if (!singleImageOrchestrator.commitCandidate(analysisTicket, finalPreset).committed) return;

    // EPIC 2E-P1C R2: the canonical Candidate build/validate/store-commit/
    // slider-sync step used to happen right here -- while the Session was
    // still ANALYZING. buildAndCommitCandidate() correctly refuses to run
    // until the Session is terminal (COMPLETED/PARTIAL), so it always
    // returned reason: SESSION_NOT_TERMINAL at this call site, and the UI
    // showed the "Auto-Tune Candidate build failed" message on every real
    // analysis run. That block now lives after completeAnalysis() below,
    // gated on the real finalSessionStatus it returns -- see
    // P1C_R2_RUNTIME_LIFECYCLE_FIX.md. commitCandidate() above still runs
    // here so session.candidateRaw is available before Session
    // finalization, per that fix's requirement #1.

    const logVal = processingLog.startStage('PreXMPValidation', {
      mood: styleFingerprint.mood, colorCast: styleFingerprint.colorCast,
      overallConfidence: styleFingerprint.overallConfidence,
    });
    logVal.output({
      fingerprintMatchScore: validationReport.fingerprintMatchScore,
      violationCount: validationReport.violations.length,
      adjustmentCount: validationReport.adjustments.length,
    });
    validationReport.adjustments.forEach(a => logVal.decide('clamp', null, a));
    if (validationReport.violations.length) logVal.warn(`${validationReport.violations.length} style-fingerprint violation(s) corrected: ${validationReport.violations.join(', ')}`);
    logVal.end('ok');

    const d = finalPreset._decision ?? {};
    logS4.output({
      temp: finalPreset.temp, tint: finalPreset.tint,
      exp: finalPreset.exp, con: finalPreset.con,
      hi: finalPreset.hi, sh: finalPreset.sh,
      vib: finalPreset.vib, sat: finalPreset.sat,
      portraitSafe: d.portraitSafe, category: d.category,
      wbTempRaw: d.wb?.tempRaw, wbTintRaw: d.wb?.tintRaw,
      wbTempFinal: d.wb?.tempFinal, wbTintFinal: d.wb?.tintFinal,
      wbConf: d.wb?.confidence,
      castBgGreen: d.castBgGreen, castSubjectNeutral: d.castSubjectNeutral,
      clampsApplied: (d.clampsApplied ?? []).join(' | ') || 'none',
      fingerprintMatchScore: validationReport.fingerprintMatchScore,
      validationViolations: validationReport.violations.join(', ') || 'none',
    });
    (d.wb?.sources ?? []).forEach(s =>
      logS4.decide(`wb.${s.name}`, `temp=${s.temp} tint=${s.tint}`, `source weight in blend`));
    (d.clampsApplied ?? []).forEach(c => logS4.decide('clamp', null, c));
    logS4.end('ok');

    const logReport = processingLog.startStage('DecisionReport');
    const decisionReport = buildDecisionReport({
      styleFeatureGraph: styleFeatureGraph,
      styleFingerprint: styleFingerprint,
      decisionStrategy: finalPreset._decision,
      finalPreset: finalPreset,
      preXmpValidation: validationReport,
      styleBenchmark: finalPreset._benchmark,
    });
    finalPreset._report = decisionReport;
    singleImageOrchestrator.commitEvidence(analysisTicket, 'decisionReport', { status: 'COMPLETED', result: decisionReport, completedAt: Date.now() }, state);
    logReport.output({
      summary: decisionReport.summary,
      topContributorCount: decisionReport.topContributors.length,
      reducedInfluenceCount: decisionReport.reducedInfluence.length,
      warningCount: decisionReport.warnings.length,
    });
    logReport.end('ok');
    console.debug('[DecisionReport]', decisionReport);

    const logTransfer = processingLog.startStage('ReferenceTransfer');
    await Promise.allSettled([imageAnalysisCorePromise]);
    if (!state.lastImageAnalysis) logTransfer.warn('imageAnalysisCore unresolved — texture/smoothness complexity signals skipped this run.');
    const referenceTransferReport = buildReferenceTransferReport({
      stats, styleFeatureGraph: styleFeatureGraph, styleFingerprint: styleFingerprint,
      decisionStrategy: finalPreset._decision, finalPreset: finalPreset,
      preXmpValidation: validationReport, styleBenchmark: finalPreset._benchmark,
      wb, cast: castRes, imageAnalysisCore: state.lastImageAnalysis,
    });
    finalPreset._transfer = referenceTransferReport;
    singleImageOrchestrator.commitEvidence(analysisTicket, 'referenceTransfer', { status: 'COMPLETED', result: referenceTransferReport, completedAt: Date.now() }, state);
    logTransfer.output({
      referenceConfidence: referenceTransferReport.referenceConfidence.score,
      transferConfidence: referenceTransferReport.transferConfidence.score,
      complexityLevel: referenceTransferReport.complexity.level,
      wbTransferRisk: referenceTransferReport.wbTransferRisk.transferRisk,
      expectedLightroomSimilarity: referenceTransferReport.lightroomReproduction.expectedSimilarity,
    });
    referenceTransferReport.transferConfidence.risks.forEach(r => logTransfer.warn(r));
    logTransfer.end('ok');
    console.debug('[ReferenceTransfer]', referenceTransferReport);

    processingLog.setFinalPreset(finalPreset);
    singleImageOrchestrator.commitEvidence(analysisTicket, 'processingLog', { status: 'COMPLETED', result: processingLog.snapshot(), completedAt: Date.now() }, state);
    console.debug('[ProcessingLog]', state.lastProcessingLog);

    if (state.curveEditor) {
      state.curveEditor.setHistStats(stats);
      if (toneCurves) {
        state.curveEditor.loadPreset({
          master: toneCurves.master.points,
          red:    toneCurves.red.points,
          green:  toneCurves.green.points,
          blue:   toneCurves.blue.points,
        });
      } else {
        state.curveEditor.loadPreset(scenePreset(stats.category));
      }
    }

    const showSection = (id) => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'block';
    };
    showSection('basicSection');
    showSection('histSection');

    requestAnimationFrame(() => {
      const bc = document.getElementById('basicCanvas');
      if (bc) renderBasicPanel(bc, basic, { dark: state.darkMode });
      const hc = document.getElementById('histCanvas');
      if (hc) renderHistograms(hc, stats, { dark: state.darkMode });
    });

    if (wb)       { showSection('wbSection');          requestAnimationFrame(() => { const c=document.getElementById('wbCanvas');          if(c) renderWhiteBalance(c, wb, {dark:state.darkMode}); }); }
    if (skin)     { showSection('skinSection');        requestAnimationFrame(() => { const c=document.getElementById('skinCanvas');        if(c) renderSkinTone(c, skin, {dark:state.darkMode}); }); }
    if (hsl)      { showSection('hslAnalyzerSection'); requestAnimationFrame(() => { const c=document.getElementById('hslAnalyzerCanvas'); if(c) renderHSLAnalyzer(c, hsl, {dark:state.darkMode}); }); }
    if (grading)  { showSection('colorGradingSection');requestAnimationFrame(() => { const c=document.getElementById('colorGradingCanvas');if(c) renderColorGrading(c, grading, {dark:state.darkMode}); }); }
    if (toneCurves){ showSection('toneCurveAISection');requestAnimationFrame(() => { const c=document.getElementById('toneCurveAICanvas'); if(c) renderToneCurves(c, toneCurves, stats, {dark:state.darkMode}); }); }
    if (calibration){ showSection('calibrationSection');requestAnimationFrame(() => { const c=document.getElementById('calibrationCanvas'); if(c) renderCalibration(c, calibration, {dark:state.darkMode}); }); }

    const analysisContainer = document.getElementById('analysisInner');
    if (analysisContainer) renderAnalysisPanel(analysisContainer, buildAnalysisDisplay(stats, finalPreset), state.lang);

    const dec = finalPreset._decision;
    const val = finalPreset._validation;
    const bench = finalPreset._benchmark;
    const wb_d = dec.wb;
    // R4 Phase C: stash the bounded inputs so this persistent summary
    // can be honestly rebuilt in whichever language is active later
    // (see _buildAnalysisBoxOkHtml + its hook in
    // rerenderCurrentUiForLocale) -- the raw "✓ วิเคราะห์เสร็จแล้ว"
    // Thai literal previously baked in here never updated on locale
    // switch, which is the confirmed R4 Analysis-status leak.
    state.lastAnalysisBoxSummaryData = {
      category: dec.category ?? stats.category,
      portraitSafe: dec.portraitSafe,
      wbTempFinal: wb_d.tempFinal, wbTempRaw: wb_d.tempRaw,
      wbTintFinal: wb_d.tintFinal, wbTintRaw: wb_d.tintRaw,
      wbConfidence: Math.round(wb_d.confidence * 100),
      wbNeutralPixelCount: wb_d.neutralPixelCount,
      skinPct: dec.skinPct, skinSource: dec.skinSource,
      fingerprintMatchPct: Math.round((val?.fingerprintMatchScore ?? 1) * 100),
      styleSimilarityPct: bench ? Math.round(bench.overallStyleSimilarity * 100) : null,
      safetyPct: bench ? Math.round(bench.safetyScore * 100) : null,
      clampsApplied: dec.clampsApplied ?? [],
      violations: val?.violations ?? [],
      benchmarkWarnings: bench?.warnings ?? [],
    };
    setAnalysisBox('ok', _buildAnalysisBoxOkHtml(state.lastAnalysisBoxSummaryData, state.lang));
    document.getElementById('sliders').style.display = 'block';
    const groups = document.getElementById('analysisGroups');
    if (groups) groups.style.display = 'block';

    // EPIC 2E-F Phase C-A: Controlled Preview Review Console — pure
    // read-only display of the already-computed, shadow-only Preview
    // Sandbox + Review State. Does NOT re-run any analysis, does NOT
    // call decision-engine/lightroom-mapping-engine/preset-engine/
    // xmp-validator, and does NOT affect XMP export.
    state.lastPreviewSandbox = finalPreset._decision?.finalStyleIntent?.controlledOverlayPreviewSandboxV2 ?? null;
    state.lastPreviewReviewState = finalPreset._decision?.finalStyleIntent?.controlledPreviewReviewStateV2 ?? null;
    state.lastPreviewReviewGenerationId = renderGeneration;
    if (state.lastPreviewReviewState) {
      state.lastPreviewReviewState = applyPreviewEvidenceToReviewStateV2(state.lastPreviewReviewState, {
        generationId: renderGeneration, renderState: 'rendering',
        legacyRendered: false, v2Rendered: false, bothRendered: false,
        visualComparisonAvailable: false,
      });
    }
    // FIX 1 (EPIC 2E-J-C-F2 Step 7A-F1): kept for the read-only QA
    // snapshot hook only (see ensureQaSnapshotHook below) — a plain
    // reference to the already-computed finalStyleIntent, never
    // mutated here or by the QA hook, never affecting XMP export or
    // any production path.
    state.lastFinalStyleIntent = finalPreset._decision?.finalStyleIntent ?? null;
    const reviewSec = document.getElementById('reviewConsoleSection');
    const reviewInner = document.getElementById('reviewConsoleInner');
    if (reviewSec && reviewInner && (state.lastPreviewSandbox || state.lastPreviewReviewState)) {
      reviewSec.style.display = 'block';
      renderReviewConsoleFromState();
    } else if (reviewSec) {
      reviewSec.style.display = 'none';
    }

    // EPIC 2E-G Phase C: Side-by-Side Preview Comparison — pure
    // read-only display of the already-computed, data-level comparison
    // object. Does NOT re-run analysis, does NOT call the Comparison
    // Engine or any other engine, does NOT affect XMP export. Same
    // section-hide/show lifecycle as the Review Console above.
    state.lastSideBySideComparison = finalPreset._decision?.finalStyleIntent?.sideBySidePreviewComparisonV2 ?? null;
    const comparisonSec = document.getElementById('sideBySideComparisonSection');
    const comparisonInner = document.getElementById('sideBySideComparisonInner');
    if (comparisonSec && comparisonInner && state.lastSideBySideComparison) {
      comparisonSec.style.display = 'block';
      // CONTROLLED V2 VISUAL TRANSLATION R1 — Phase I: pass the
      // already-computed Visual Preview Render Plan's diagnostic
      // fields through as a read-only hint so the Data Comparison
      // renderer can honestly cross-reference the SEPARATE Visual
      // Preview Comparison (pixel-based) evidence layer, without
      // fetching/re-deriving anything itself and without this call
      // site reinterpreting either layer's own values. This is plain
      // data already present on finalStyleIntent at this point in the
      // pipeline (built synchronously by decision-engine well before
      // this render call) — no new computation, no pixel rendering
      // triggered here.
      // EPIC 2E-J FULL-SYSTEM I18N + CROSS-LAYER HONESTY R1 -- Phase E:
      // FIX for Defect 2B/2C -- `visualPreviewRenderPlanV2` has NO
      // canonical root `renderable`/`controlledV2Translation` field;
      // the real, authoritative values live nested under
      // `.v2RenderPlan.renderable` / `.v2RenderPlan.controlledV2Translation`
      // (see core/preview-rendering/visual-preview-render-plan-v2.js's
      // `_buildV2RenderPlan()` return shape). Reading the root fields
      // (as this call site previously did) always silently resolved to
      // `undefined`, which is exactly why the Data Comparison banner
      // below always fell through to its "not currently available"
      // branch even after a real Controlled V2 render succeeded. Also
      // threads through the root-level `sharedRenderConstraints`
      // object's explicit `allowProductionWrite`/`allowExport` booleans
      // (Phase G) -- never inferred from `appliedToProduction` alone.
      const vprPlanForComparisonNote = finalPreset._decision?.finalStyleIntent?.visualPreviewRenderPlanV2 ?? null;
      const v2RenderPlanForComparisonNote = _isRecordLike(vprPlanForComparisonNote?.v2RenderPlan) ? vprPlanForComparisonNote.v2RenderPlan : null;
      const sharedConstraintsForComparisonNote = _isRecordLike(vprPlanForComparisonNote?.sharedRenderConstraints) ? vprPlanForComparisonNote.sharedRenderConstraints : null;
      const visualPreviewInfoForComparisonNote = _isRecordLike(vprPlanForComparisonNote)
        ? {
            renderable: v2RenderPlanForComparisonNote?.renderable === true,
            controlledV2Translation: _isRecordLike(v2RenderPlanForComparisonNote?.controlledV2Translation) ? v2RenderPlanForComparisonNote.controlledV2Translation : null,
            allowProductionWrite: typeof sharedConstraintsForComparisonNote?.allowProductionWrite === 'boolean' ? sharedConstraintsForComparisonNote.allowProductionWrite : undefined,
            allowExport: typeof sharedConstraintsForComparisonNote?.allowExport === 'boolean' ? sharedConstraintsForComparisonNote.allowExport : undefined,
          }
        : null;
      // EPIC 2E-J FULL-SYSTEM I18N + CROSS-LAYER HONESTY R1 -- Phase F:
      // stash the plan-time bounded hint + container so the resolved
      // visual-state hook (added below, once the Visual Preview
      // Comparison render actually settles) can merge in the
      // authoritative post-render evidence and safely re-render this
      // SAME Data Comparison section again -- never a duplicate
      // section, never a second engine call.
      state.lastVisualPreviewInfoForComparisonNote = visualPreviewInfoForComparisonNote;
      state.lastComparisonInnerEl = comparisonInner;
      // A new generation starting must never show a PRIOR generation's
      // resolved Rendered status -- mark it stale/preparing immediately.
      state.lastResolvedVisualState = { generationId: renderGeneration, renderState: 'preparing' };
      renderSideBySideComparison(comparisonInner, state.lastSideBySideComparison, visualPreviewInfoForComparisonNote, state.lang);
    } else if (comparisonSec) {
      comparisonSec.style.display = 'none';
    }

    // EPIC 2E-H Phase C: Visual Preview Comparison — isolated,
    // read-only browser-preview canvases for Legacy and Controlled V2,
    // built strictly from the canonical
    // finalStyleIntent.visualPreviewRenderPlanV2 object (never
    // rebuilt/re-normalized here). This never re-runs analysis, never
    // calls Decision Engine/Report/Reference Transfer, never mutates
    // finalStyleIntent or the Side-by-Side Comparison object, and
    // never affects XMP export. Rendering is started AFTER the
    // analysis UI above has already committed, and is NOT awaited here
    // — a slow/failed preview render must never delay or break the
    // rest of the analysis result. Any error is caught locally so a
    // Visual Preview Comparison failure never fails the whole
    // analysis flow (per this phase's explicit isolation requirement).
    // FIX 1 (EPIC 2E-H-C-F2): each level of the canonical chain read
    // exactly once through safeGetVisualPreviewProperty — never a
    // direct optional-chaining read afterward, since a throwing getter
    // on `_decision`/`finalStyleIntent`/`visualPreviewRenderPlanV2`
    // itself (as opposed to merely being null/undefined) would not be
    // caught by `?.` alone.
    // FIX 7: the entire extraction+invocation boundary below is
    // wrapped locally — a malformed canonical getter, an unsupported
    // source, or any Preview UI error must affect ONLY the Visual
    // Preview section, never enter this function's own analysis
    // catch block, never replace the analysis result, and never hide
    // Review Console or Data Comparison.
    try {
      const decisionForVpr = safeGetVisualPreviewProperty(finalPreset, '_decision');
      const finalStyleIntentForVpr = safeGetVisualPreviewProperty(decisionForVpr, 'finalStyleIntent');
      const visualPreviewRenderPlan = safeGetVisualPreviewProperty(finalStyleIntentForVpr, 'visualPreviewRenderPlanV2', null);
      const vprSec = document.getElementById('visualPreviewComparisonSection');
      const vprInner = document.getElementById('visualPreviewComparisonInner');
      if (vprSec && vprInner) {
        vprSec.style.display = 'block';
        ensureVisualPreviewComparisonLayout(vprInner);
        if (!visualPreviewComparisonController) {
          const legacyCanvas = document.getElementById('legacyVisualPreviewCanvasV2');
          const v2Canvas = document.getElementById('controlledV2VisualPreviewCanvasV2');
          if (legacyCanvas && v2Canvas) {
            visualPreviewComparisonController = createVisualPreviewComparisonControllerV2({ legacyCanvas, v2Canvas });
          }
        }
        if (visualPreviewComparisonController) {
          // FIX 4 (EPIC 2E-H-C-F): show an immediate "in progress"
          // placeholder BEFORE render() begins — the section must never
          // show a stale "Waiting for analysis and Render Plan" message
          // while pixel rendering is actively starting.
          renderVisualPreviewComparison(vprInner, buildRenderingPlaceholderState(), state.lang);
          // DEPLOY GEOMETRY R1 — Phase A FIX A1/A4: compute the bounded
          // blocker-code diagnostic ONCE here (this is the only place with
          // access to BOTH state.lastPreviewSandbox and
          // state.lastFinalStyleIntent.visualPreviewRenderPlanV2) and pass
          // it through unchanged — the controller/renderer never
          // recompute or re-derive it, preserving single-source-of-truth.
          const _previewGeometryDiagnostics = _buildPreviewGeometryDiagnostics(renderGeneration);
          // DEPLOY GEOMETRY R1 — Phase B2/B3/C3: decode exactly ONE
          // canonical source for this generation — createImageBitmap
          // with explicit `imageOrientation: 'from-image'`, safely
          // falling back to the already-decoded <img> element if
          // unavailable/failed. This single returned object is what
          // gets passed to the controller below, which reuses it
          // identically for BOTH Legacy and V2 — neither side ever
          // decodes or infers orientation independently, and neither
          // ever manually rotates a source the browser already
          // oriented (which would double-rotate it).
          const _canonicalDecode = await previewSourceGeometryNormalizer.decodeCanonicalSource(state.currentRetainedFile, renderGeneration, img);
          state.lastCanonicalSourceEvidence = _canonicalDecode.evidence;
          // Phase B4: a newer analysis may have started while the
          // (async) decode above was in flight — never let a stale
          // generation's canonical source or render commit into a
          // newer one. Everything else in runAnalysis() before/after
          // this Visual-Preview-only boundary is unaffected.
          if (renderGeneration === analysisRenderGeneration) {
          // SAFE RECOVERY + DEPLOY GEOMETRY R2 — Phase 3: mark this
          // generation's render as STARTED before invoking it, so the
          // normalizer's resource map knows this generation's bitmap is
          // actively being consumed and must not be closed out from
          // under it even if a newer generation's decode begins first.
          previewSourceGeometryNormalizer.markRenderStarted(renderGeneration);
          // Fire-and-forget (never awaited here) — see rationale above.
          // R4 Phase G: capture the SAME promise reference so an
          // external caller (handleBuildControlledV2Preview) can await
          // its genuine settlement -- this is purely an additional
          // read-only attachment; it does not change when or how the
          // .then()/.catch() below run, nor their side effects.
          const _vprRenderPromise = visualPreviewComparisonController.render({
            source: _canonicalDecode.source ?? img,
            renderPlan: visualPreviewRenderPlan,
            analysisGenerationId: renderGeneration,
            v2BlockerCode: _previewGeometryDiagnostics.blockerCode,
          });
          _latestVisualPreviewRenderSettleGeneration = renderGeneration;
          _latestVisualPreviewRenderSettlePromise = _vprRenderPromise.catch(() => null);
          _vprRenderPromise.then(vprState => {
            // Phase 3: mark settled on EVERY settle path (success here,
            // failure in .catch() below) — this is what lets a
            // superseded generation's bitmap be released the instant
            // its render finishes, never before.
            previewSourceGeometryNormalizer.markRenderSettled(renderGeneration);
            // SAFE RECOVERY + DEPLOY GEOMETRY R2 — Phase 4: record
            // bounded post-render outcome evidence for THIS generation
            // — this is what lets _buildPreviewGeometryDiagnostics()
            // (when read later via the QA snapshot) report
            // LEGACY_RENDER_FAILED / V2_RENDER_FAILED /
            // PIXEL_DIMENSION_MISMATCH, which cannot be known before
            // render() resolves. Only recorded if this is still the
            // current generation — a stale/superseded render's outcome
            // must never overwrite a newer generation's evidence.
            if (renderGeneration === analysisRenderGeneration) {
              const legacyR = vprState?.legacy ?? null;
              const v2R = vprState?.v2 ?? null;
              state.lastRenderOutcomeEvidence = {
                generationId: renderGeneration,
                legacyRendered: legacyR?.rendered === true,
                legacyFailed: legacyR?.state === 'failed',
                v2Rendered: v2R?.rendered === true,
                v2Failed: v2R?.state === 'failed',
                legacyBackingWidth: typeof legacyR?.backingWidth === 'number' ? legacyR.backingWidth : null,
                legacyBackingHeight: typeof legacyR?.backingHeight === 'number' ? legacyR.backingHeight : null,
                v2BackingWidth: typeof v2R?.backingWidth === 'number' ? v2R.backingWidth : null,
                v2BackingHeight: typeof v2R?.backingHeight === 'number' ? v2R.backingHeight : null,
              };
            }
            // FIX 8: a newer analysis (Re-analyze / new image) may have
            // already started by the time this resolves — never let a
            // stale preview render overwrite the current one's display.
            if (renderGeneration !== analysisRenderGeneration) return;
            state.lastVisualPreviewComparisonState = vprState;
            if (state.lastPreviewReviewState) {
              state.lastPreviewReviewState = applyPreviewEvidenceToReviewStateV2(state.lastPreviewReviewState, {
                generationId: renderGeneration,
                renderState: vprState?.state ?? null,
                legacyRendered: vprState?.legacy?.rendered === true,
                v2Rendered: vprState?.v2?.rendered === true,
                bothRendered: vprState?.bothRendered === true,
                visualComparisonAvailable: vprState?.visualComparisonAvailable === true,
              });
              renderReviewConsoleFromState();
            }
            renderVisualPreviewComparison(vprInner, vprState, state.lang);
            // EPIC 2E-I Phase A: sync the Interactive Before/After
            // viewer from the SAME resolved Visual Preview Comparison
            // result — never a separate/duplicate render, never
            // re-invoking the pixel renderer.
            _syncInteractiveBeforeAfter(vprState, renderGeneration);
            // EPIC 2E-J Phase F: build the bounded resolved visual
            // state from THIS settled vprState and re-render the
            // already-visible Data Comparison section so its banner
            // reflects what actually rendered, not just the plan-time
            // hint computed before this promise resolved. Generation-
            // checked above already (renderGeneration === analysisRenderGeneration).
            state.lastResolvedVisualState = _buildResolvedVisualState(vprState, renderGeneration);
            _rerenderDataComparisonWithResolvedVisualState();
          }).catch(err => {
            // Phase 3: mark settled on the failure path too — a thrown/
            // rejected render must release its pending-render claim
            // just as reliably as a successful one, or a failed render
            // would leak its generation's bitmap forever.
            previewSourceGeometryNormalizer.markRenderSettled(renderGeneration);
            // SAFE RECOVERY + DEPLOY GEOMETRY R2 — Phase 4: a rejected
            // render() promise (as opposed to a resolved-but-'failed'
            // side result) is recorded as a V2_RENDER_FAILED blocker —
            // V2 is the newer, more complex render path and therefore
            // the more likely failure point when the whole call throws
            // rather than one side reporting its own 'failed' state;
            // this is a documented best-available inference, not a
            // certainty, since a rejection gives no per-side detail.
            if (renderGeneration === analysisRenderGeneration) {
              state.lastRenderOutcomeEvidence = {
                generationId: renderGeneration,
                legacyRendered: false, legacyFailed: false,
                v2Rendered: false, v2Failed: true,
                legacyBackingWidth: null, legacyBackingHeight: null,
                v2BackingWidth: null, v2BackingHeight: null,
              };
            }
            // FIX 5 (EPIC 2E-H-C-F): a caught error must still produce a
            // VISIBLE failed state in the Preview section — not merely a
            // console warning that leaves the section silently stuck on
            // its "rendering" placeholder forever. Generation-checked so
            // a stale failure from a superseded run can never overwrite
            // the current analysis's own (possibly successful) display.
            console.warn('VisualPreviewComparison render failed (analysis unaffected):', err);
            if (renderGeneration !== analysisRenderGeneration) return;
            if (state.lastPreviewReviewState) {
              state.lastPreviewReviewState = applyPreviewEvidenceToReviewStateV2(state.lastPreviewReviewState, {
                generationId: renderGeneration, renderState: 'failed',
                legacyRendered: false, v2Rendered: false, bothRendered: false,
                visualComparisonAvailable: false,
              });
              renderReviewConsoleFromState();
            }
            renderVisualPreviewComparison(vprInner, {
              state: 'failed',
              legacy: null, v2: null, bothRendered: false, visualComparisonAvailable: false,
              warnings: [],
              blockers: [t('previewCode.reason.PREVIEW_RENDER_FAILED', null, state.lang)],
              blockerCodes: ['PREVIEW_RENDER_FAILED'],
              metadata: {},
            }, state.lang);
            // EPIC 2E-I Phase A: a failed Visual Preview render means
            // the Interactive viewer has no valid sources either —
            // clear it rather than leaving stale content/interaction
            // enabled.
            if (interactiveBeforeAfterController) interactiveBeforeAfterController.clear();
            // EPIC 2E-J Phase F: a rejected render() must also update
            // the resolved visual state -- otherwise the Data
            // Comparison banner would keep showing stale plan-time
            // info (or 'preparing') forever after a failure.
            state.lastResolvedVisualState = {
              generationId: renderGeneration,
              renderState: 'failed',
              legacyRendered: false,
              v2Rendered: false,
              bothRendered: false,
              visualComparisonAvailable: false,
              alignmentExact: false,
              translationMode: null,
              visualizedAdjustmentCount: 0,
              allowProductionWrite: undefined,
              allowExport: undefined,
              appliedToProduction: undefined,
            };
            _rerenderDataComparisonWithResolvedVisualState();
          });
          }
        }
      } else if (vprSec) {
        vprSec.style.display = 'none';
      }
    } catch (vprErr) {
      // FIX 7 (EPIC 2E-H-C-F2): a failure anywhere in the Visual
      // Preview extraction/invocation boundary above must never reach
      // this function's own catch block below — it would otherwise
      // incorrectly replace the entire analysis result with a generic
      // error box, hiding Review Console and Data Comparison for a
      // failure that has nothing to do with them.
      console.warn('VisualPreviewComparison boundary failed (analysis unaffected):', vprErr);
    }

    // EPIC 2E-P1A: always resolve the Session to a terminal status —
    // COMPLETED if every required module succeeded and no optional
    // module degraded, PARTIAL if an optional module soft-failed. A
    // no-op if this ticket is already stale (a newer Session already
    // owns "active"). This guarantees the Session lifecycle never gets
    // stuck in ANALYZING, per the spec's explicit requirement.
    const finalSessionStatus = singleImageOrchestrator.completeAnalysis(analysisTicket);

    // EPIC 2E-P1C R2: build the canonical nested Candidate ONLY now that
    // the Session has reached a terminal status. This mirrors the
    // buildAndCommitReport() gate immediately below -- both read only
    // from session.evidence (never from Report text, DOM slider values,
    // stale legacy state, or synthetic defaults) and are independent
    // sibling outputs of the same evidence, per
    // P1C_CANDIDATE_ARCHITECTURE.md. buildAndCommitCandidate() itself
    // still carries its own terminal-status + isActiveGeneration guards
    // (unchanged, not weakened) -- this call-site gate is an additional,
    // not a replacement, safeguard. A stale ticket (Image A superseded
    // by Image B) makes completeAnalysis() return null, which satisfies
    // neither branch's equality check below, so a stale callback can
    // never build or synchronize a Candidate after a newer image becomes
    // active.
    if (finalSessionStatus === 'COMPLETED' || finalSessionStatus === 'PARTIAL') {
      const candidateResult = singleImageOrchestrator.buildAndCommitCandidate(analysisTicket, {
        legacyState: state,
        engineVersion: singleImageOrchestrator.ENGINE_VERSION,
      });
      if (candidateResult && candidateResult.committed && candidateResult.candidate) {
        // Guard flag so the boot-time slider 'input' listener (wired near
        // bindSliders(document.body) below) can tell "the Candidate Store
        // just wrote this slider" apart from "the user just edited this
        // slider" -- setSlider() itself only assigns el.value (no input
        // event fires from a JS property assignment), so this guard is a
        // belt-and-braces measure per the spec's explicit "prevent
        // feedback loops via a synchronization guard" rule. Wrapped in
        // try/finally so a thrown error mid-render can never leave the
        // guard stuck true.
        state._candidateSliderSyncGuard = true;
        try {
          renderCandidateToSliders(candidateResult.candidate, { setSlider });
          const nameEl = document.getElementById('presetName');
          if (nameEl) nameEl.value = candidateResult.candidate.profile?.name ?? finalPreset.name;
        } finally {
          state._candidateSliderSyncGuard = false;
        }
        state.lastCandidateStatus = candidateResult.candidate.status;
        updateCandidateStatusBadge(candidateResult.candidate.status);
      } else {
        // Candidate build failed (or this run was superseded) even
        // though the Session reached a terminal status -- do not fall
        // back to applyPresetToSliders(finalPreset) (that would
        // reintroduce exactly the "DOM as hidden source of truth"
        // problem P1C removes). Leave sliders at their last known state,
        // clear the Candidate Store so XMP export stays blocked, and
        // surface a FAILED badge with full (non-image) diagnostics.
        console.error('[P1C Candidate Build Failed]', {
          reason: candidateResult?.reason,
          sessionStatus: singleImageOrchestrator.getActiveSessionSnapshot()?.status,
          sessionId: analysisTicket?.sessionId,
          generationId: analysisTicket?.generationId,
          candidateRawAvailable: !!singleImageOrchestrator.getActiveSessionSnapshot()?.candidateRaw,
          validationErrors: candidateResult?.validation?.errors ?? [],
          validationWarnings: candidateResult?.validation?.warnings ?? [],
        });
        candidateStore.clearActiveCandidate(analysisTicket.sessionId, analysisTicket.generationId);
        state.lastCandidateStatus = CANDIDATE_STATUS.FAILED;
        updateCandidateStatusBadge(CANDIDATE_STATUS.FAILED);
      }
    } else {
      // finalSessionStatus is FAILED, ABORTED, or null (stale ticket --
      // a newer image already became active). Never build a Candidate
      // from a non-terminal or failed Session: clear the Candidate
      // Store, clear the badge, and leave sliders exactly as they were
      // so no stale/partial values are shown. XMP export stays blocked
      // because candidateStore.getValidatedCandidate() now returns null.
      candidateStore.clearActiveCandidate();
      state.lastCandidateStatus = null;
      updateCandidateStatusBadge(null);
    }

    // EPIC 2E-P1B: build the canonical AI Image Analysis Report from
    // the Session's now-final evidence and render it -- ONLY on
    // COMPLETED/PARTIAL (never on FAILED/ABORTED), and only if this
    // ticket is still the active generation (buildAndCommitReport()
    // itself no-ops on a stale ticket, same guarantee every other
    // commit* call in this function already relies on). This never
    // re-runs any Core module -- it reads session.evidence, already
    // fully populated by the commitEvidence() calls above.
    if (finalSessionStatus === 'COMPLETED' || finalSessionStatus === 'PARTIAL') {
      const built = singleImageOrchestrator.buildAndCommitReport(analysisTicket, { legacyState: state });
      if (built.committed) {
        state.lastSingleImageReport = built.report;
        const reportInner = document.getElementById('singleImageReportInner');
        if (reportInner) renderSingleImageReport(reportInner, built.report, state.lang);
      }
    }

  } catch (err) {
    setAnalysisBox('error', `<strong>⚠ ${t('analysisBox.failed', null, state.lang)}:</strong> ${err.message}`);
    console.error('runAnalysis error:', err);
    // EPIC 2E-P1A: an unexpected error must still leave the Session in
    // a terminal FAILED state, not stuck in ANALYZING — same
    // no-op-if-stale guarantee as completeAnalysis() above.
    if (analysisTicket) singleImageOrchestrator.failAnalysis(analysisTicket, err);
    // EPIC 2E-P1B: a failed analysis must never show a report (old or
    // partially built) -- hide the section entirely.
    {
      const reportSec = document.getElementById('singleImageReportSection');
      if (reportSec) reportSec.style.display = 'none';
      state.lastSingleImageReport = null;
    }
    // EPIC 2E-P1C: a failed analysis must never leave a stale Candidate
    // status badge visible either -- the FAILED status the orchestrator
    // set on the Session (see buildAndCommitCandidate()/failAnalysis())
    // is mirrored here for the UI badge only; no Candidate is rebuilt.
    state.lastCandidateStatus = CANDIDATE_STATUS.FAILED;
    updateCandidateStatusBadge(CANDIDATE_STATUS.FAILED);
  }
}

// EPIC 2E-P1C — minimal Candidate status badge. Text/color-only; never
// rebuilds the Candidate, never touches the Candidate Store, never
// re-renders sliders. `status` is one of CANDIDATE_STATUS or null/
// undefined (hides the badge). See P1C_CANDIDATE_ARCHITECTURE.md and
// index.html's #candidateStatusBadge element.
const CANDIDATE_BADGE_I18N_KEY = Object.freeze({
  BUILDING: 'candidateStatus.building',
  AUTO_GENERATED: 'candidateStatus.ready',
  VALID: 'candidateStatus.valid',
  VALID_WITH_WARNINGS: 'candidateStatus.validWithWarnings',
  INVALID: 'candidateStatus.invalid',
  USER_EDITED: 'candidateStatus.userEdited',
  FAILED: 'candidateStatus.failed',
});
const CANDIDATE_BADGE_COLOR = Object.freeze({
  BUILDING: 'var(--text-dim)',
  AUTO_GENERATED: 'var(--success)',
  VALID: 'var(--success)',
  VALID_WITH_WARNINGS: 'var(--warn)',
  INVALID: 'var(--danger)',
  USER_EDITED: 'var(--accent)',
  FAILED: 'var(--danger)',
});
function updateCandidateStatusBadge(status) {
  const el = document.getElementById('candidateStatusBadge');
  if (!el) return;
  // EMPTY / STALE / null / undefined -- nothing worth surfacing to the
  // user (EMPTY = no analysis run yet; STALE never reaches the UI mirror
  // since a superseded build simply never commits).
  const key = status ? CANDIDATE_BADGE_I18N_KEY[status] : null;
  if (!key) { el.style.display = 'none'; el.textContent = ''; return; }
  el.textContent = t(key, null, state.lang);
  el.style.color = CANDIDATE_BADGE_COLOR[status] || 'var(--text-dim)';
  el.style.borderColor = CANDIDATE_BADGE_COLOR[status] || 'var(--border)';
  el.style.display = 'block';
}

// EPIC 2E-P1C — DEPRECATED COMPATIBILITY FUNCTION. Superseded by
// renderCandidateToSliders(candidate, { setSlider }) at this file's one
// call site (runAnalysis()'s Candidate-commit block). Confirmed via
// project-wide grep to have zero remaining callers as of P1C; retained
// only as a documented fallback, not deleted outright.
function applyPresetToSliders(preset) {
  setSlider('exp', preset.exp); setSlider('con', preset.con);
  setSlider('hi',  preset.hi);  setSlider('sh',  preset.sh);
  setSlider('wh',  preset.wh);  setSlider('bl',  preset.bl);
  setSlider('temp', preset.temp); setSlider('tint', preset.tint);
  setSlider('vib',  preset.vib);  setSlider('sat',  preset.sat);
  setSlider('clarity', preset.clarity); setSlider('dehaze', preset.dehaze);
  setSlider('texture', preset.texture); setSlider('sharp',  preset.sharp);
  setSlider('noise', preset.noise);
  setSlider('crv_hi', preset.crv_hi); setSlider('crv_mid', preset.crv_mid); setSlider('crv_sh', preset.crv_sh);
  for (const [id, val] of Object.entries(preset.hsl))   setSlider(id, val);
  for (const [id, val] of Object.entries(preset.grade)) setSlider(id, val);
  for (const [id, val] of Object.entries(preset.cal))   setSlider(id, val);
  const nameEl = document.getElementById('presetName');
  if (nameEl) nameEl.value = preset.name;
}

function buildAnalysisDisplay(stats, preset) {
  return {
    'Scene Type':          stats.category,
    'Brightness':          `Avg ${stats.avgLum}  ·  Median ${stats.median}`,
    'Dynamic Range':       `${stats.drStops ?? stats.dynamicRange} EV  (${stats.dynamicRange} levels)`,
    'Contrast Ratio':      `1 : ${stats.contrastRatio ?? stats.contrast}`,
    'Highlight Clipping':  `${stats.clipHiPct ?? 0}%`,
    'Shadow Clipping':     `${stats.clipLoPct ?? 0}%`,
    'White Balance':       `${stats.rbDiff > 3 ? 'Warm' : stats.rbDiff < -3 ? 'Cool' : 'Neutral'}  (temp ${preset.temp})`,
    'Avg Saturation':      `${stats.avgSatPct}%`,
    'Skin Tone':           stats.skinDetected ? `Detected (${stats.skinPct}%)` : 'Not detected',
    'Black / White Point': `${stats.blackPoint}  /  ${stats.whitePoint}`,
  };
}

// ─── Action handlers ──────────────────────────────────────────────────────────
// EPIC 2E-P1C: XMP export source migrated from readSlidersAsPreset()
// (DOM reconstruction) to the canonical Candidate Store. The existing
// serializer/downloader (serializeXMP, downloadXMP) and the existing
// final safety net (quickSafetyClamp) are unchanged and still run --
// only the *input* to that unchanged pipeline changed, from a
// DOM-reconstructed preset to legacyPresetAdapter(validated Candidate).
// See P1C_LEGACY_PRESET_MIGRATION_MAP.md.
function handleDownload() {
  const candidate = candidateStore.getValidatedCandidate();
  if (!candidate) {
    // No valid Candidate exists (EMPTY/BUILDING/INVALID/STALE/FAILED) --
    // block export outright. Never fall back to reading stale slider
    // DOM values; that would silently reintroduce the exact
    // DOM-as-hidden-source-of-truth problem P1C removes.
    singleImageOrchestrator.traceXmpExportBlocked({ reason: 'NO_VALID_CANDIDATE' });
    const msgEl = document.getElementById('successMsg');
    if (msgEl) msgEl.textContent = t('appShell.downloadBlockedNoCandidate', null, state.lang);
    return;
  }

  let preset = candidateToLegacyPreset(candidate);

  // The existing final safety net (unchanged) still runs, exactly as it
  // did before P1C -- it now clamps the Candidate-derived preset instead
  // of a DOM-derived one, but the clamp logic itself is untouched.
  const safety = quickSafetyClamp(preset);
  preset = safety.preset;
  if (safety.adjustments.length) {
    console.debug('[Pre-XMP Validation · Export]', safety.adjustments);
    const msgEl = document.getElementById('successMsg');
    if (msgEl) msgEl.textContent = t('appShell.downloadSafetyAdjustments', { count: safety.adjustments.length }, state.lang);
  } else {
    const msgEl = document.getElementById('successMsg');
    if (msgEl) msgEl.textContent = t('appShell.downloadSuccess', null, state.lang);
  }

  singleImageOrchestrator.traceXmpExportUsingCandidate({ candidateId: candidate.candidateId, revision: candidate.revision });

  const xmp    = serializeXMP(preset);
  const name   = document.getElementById('presetName')?.value || 'AI Preset';
  downloadXMP(xmp, name);
  flashSuccess();
}

function handleReanalyze() {
  const img = document.getElementById('previewImg');
  if (state.imageLoaded && img?.complete && img.naturalWidth) runAnalysis();
}

function handleReset() {
  // EPIC 2E-F-C-B-F Bug 1 fix: clear the review console controller's
  // TRANSIENT confirmation state (armed "Confirm Fail?" prompts, the
  // Reset-confirmation prompt) before this image's Review State is
  // cleared below and a new image's analysis begins. Without this, a
  // confirmation armed on one image's item could visually reappear on
  // a different image's item that happens to reuse the same canonical
  // review item ID (every image shares the same fixed set of IDs).
  // This never touches the Review State object itself, never
  // rerenders on its own, and never tears down the controller's event
  // listeners — handleReset() is called unconditionally at the start
  // of loadFile() (genuine new image import) and by the app's own
  // Reset button, but NEVER by handleReanalyze() (which calls
  // runAnalysis() directly), so an ordinary same-image Re-analyze
  // never clears this.
  if (reviewConsoleController) reviewConsoleController.resetTransientUiState();

  // EPIC 2E-P1A: abort whatever Session is active, clear its data, and
  // clear its legacy `state.last*` mirrors through the SAME adapter
  // every analysis commit uses — additive to (not a replacement for)
  // the explicit state.lastX = null lines below, which remain for the
  // fields this adapter doesn't cover (lastPreviewSandbox, curveEditor,
  // etc. — see P1A_LEGACY_COMPATIBILITY_MAP.md for the full split).
  singleImageOrchestrator.resetActiveSession(state);
  activeUploadTicket = null;

  // EPIC 2E-P1B: clear the Report UI immediately -- session.report
  // itself was already nulled by resetSessionData() inside
  // singleImageOrchestrator.resetActiveSession() just above.
  {
    const reportSec = document.getElementById('singleImageReportSection');
    const reportInner = document.getElementById('singleImageReportInner');
    if (reportSec) reportSec.style.display = 'none';
    if (reportInner) clearSingleImageReportDisplay(reportInner, state.lang);
  }
  state.lastSingleImageReport = null;

  // EPIC 2E-P1C: session.candidate was already nulled by
  // resetSessionData() inside resetActiveSession() above; also clear the
  // Candidate Store's pub/sub mirror, the status badge, and any manual
  // edit history so a Reset can never leave a stale Candidate reachable
  // by XMP export.
  // clearActiveCandidate(sessionId, generationId) is generation-gated;
  // session.candidate was already nulled by resetSessionData() inside
  // resetActiveSession() above, so this call is invoked with no
  // sessionId purely to notify the pub/sub channel (candidate-store.js
  // treats a falsy sessionId as "already cleared, just notify").
  candidateStore.clearActiveCandidate();
  updateCandidateStatusBadge(null);
  state.lastCandidateStatus = null;

  state.imageLoaded = false; state.lastStats = null; state.lastPalette = null; state.lastWB = null;
  state.lastCurveSet = null;
  state.lastSkin = null;
  state.lastBasic = null;
  state.lastHSL = null;
  state.lastGrading = null;
  state.lastToneCurves = null;
  state.lastCalibration = null;
  state.lastHarmony = null;
  state.lastImageAnalysis = null;
  state.lastStyleRecognition = null;
  state.lastProcessingLog = null;
  state.lastStyleFingerprint = null;
  state.lastStyleFeatureGraph = null;
  state.lastValidationReport = null;
  state.lastBenchmark = null;
  state.lastDecisionReport = null;
  state.lastReferenceTransfer = null;
  state.lastPreviewSandbox = null;
  state.lastPreviewReviewState = null;
  state.lastPreviewReviewGenerationId = null;
  state.lastSideBySideComparison = null;
  // DEPLOY GEOMETRY R1 — Phase B1/B4: release the retained File
  // reference and any in-flight/decoded canonical-source resource
  // (ImageBitmap) unconditionally on every Reset/new image — a stale
  // generation must never keep memory alive past this point.
  state.currentRetainedFile = null;
  state.lastCanonicalSourceEvidence = null;
  state.lastRenderOutcomeEvidence = null;
  previewSourceGeometryNormalizer.releaseAll();
  if (state.curveEditor) state.curveEditor.resetAll();
  document.getElementById('uploadWrap').style.display  = 'block';
  document.getElementById('previewWrap').style.display = 'none';
  document.getElementById('sliders').style.display     = 'none';
  document.getElementById('aiBox').style.display       = 'none';
  const groups = document.getElementById('analysisGroups');
  if (groups) groups.style.display = 'none';
  const reviewSec = document.getElementById('reviewConsoleSection');
  if (reviewSec) reviewSec.style.display = 'none';
  const comparisonSec = document.getElementById('sideBySideComparisonSection');
  if (comparisonSec) comparisonSec.style.display = 'none';
  // EPIC 2E-H Phase C: cancel any in-flight preview render, clear both
  // canvases, and hide the section — same lifecycle guarantee as the
  // Review Console/Side-by-Side sections above. Safe to call even if
  // the controller was never created yet (handled internally as a
  // no-op check).
  if (visualPreviewComparisonController) visualPreviewComparisonController.clear();
  const vprSec = document.getElementById('visualPreviewComparisonSection');
  if (vprSec) vprSec.style.display = 'none';
  const vprInner = document.getElementById('visualPreviewComparisonInner');
  if (vprInner) clearVisualPreviewComparisonDisplay(vprInner, state.lang);
  // EPIC 2E-I Phase A: same reset guarantee — clear (not dispose, so
  // the controller remains reusable for the next analysis), hide the
  // section, reset the status display.
  if (interactiveBeforeAfterController) interactiveBeforeAfterController.clear();
  const ibaSec = document.getElementById('interactiveBeforeAfterSection');
  if (ibaSec) ibaSec.style.display = 'none';
  const ibaInner = document.getElementById('interactiveBeforeAfterInner');
  if (ibaInner) clearInteractiveBeforeAfterDisplay(ibaInner, state.lang);
  // EPIC 2E-J Phase A: same reset guarantee for Preview Observation —
  // clear (not dispose), hide the section, reset the status display.
  if (interactivePreviewObservationController) {
    // EPIC 2E-J Phase B: capture generation BEFORE reset() clears it,
    // then invalidate ONLY the current generation's Session record —
    // never the whole session (Reset must not wipe earlier session
    // history).
    const priorObsState = interactivePreviewObservationController.getState();
    const priorGenerationId = safeGetVisualPreviewProperty(priorObsState, 'currentGenerationId');
    interactivePreviewObservationController.reset();
    if (interactivePreviewObservationSession && priorGenerationId !== null && priorGenerationId !== undefined && lastInvalidatedObservationGenerationId !== priorGenerationId) {
      interactivePreviewObservationSession.invalidateGeneration(priorGenerationId);
      lastInvalidatedObservationGenerationId = priorGenerationId;
    }
  }
  const obsSec = document.getElementById('interactivePreviewObservationSection');
  if (obsSec) obsSec.style.display = 'none';
  const obsInner = document.getElementById('interactivePreviewObservationInner');
  if (obsInner) clearInteractivePreviewObservationDisplay(obsInner, state.lang);
  // Session summary itself is intentionally NOT cleared/hidden here —
  // it persists across Reset (only the current generation's record was
  // invalidated above); re-render it with the updated summary.
  const sessionInnerReset = document.getElementById('interactivePreviewObservationSessionInner');
  if (sessionInnerReset && interactivePreviewObservationSession) {
    try { renderInteractivePreviewObservationSessionV2(sessionInnerReset, interactivePreviewObservationSession.getSummary(), state.lang); } catch { /* best-effort */ }
  }
  const reviewInner = document.getElementById('reviewConsoleInner');
  if (reviewInner) reviewInner.innerHTML = '';
  // Reset active tab back to Overview
  document.querySelectorAll('.atab').forEach(t => styleAtab(t, t.dataset.group === 'overview'));
  document.querySelectorAll('.agroup').forEach(g => { g.style.display = (g.dataset.group === 'overview') ? 'flex' : 'none'; });
  ['basicSection','toneCurveAISection','calibrationSection','harmonySection','colorGradingSection','hslAnalyzerSection','histSection','paletteSection','wbSection','skinSection','imageAnalysisSection'].forEach(id => {
    const el = document.getElementById(id); if (el) el.style.display = 'none';
  });
  const fi = document.getElementById('fileIn');   if (fi)  fi.value  = '';
  const fi2= document.getElementById('fileIn2');  if (fi2) fi2.value = '';
}

// ─── Read sliders ─────────────────────────────────────────────────────────────
const gv = id => parseInt(document.getElementById(id)?.value ?? 0, 10);

// EPIC 2E-P1C — DEPRECATED COMPATIBILITY FUNCTION. The main single-image
// XMP export path (handleDownload()) no longer calls this -- it now
// reads from candidateStore.getValidatedCandidate() ->
// candidateToLegacyPreset() instead, per P1C's "Candidate Store, not the
// DOM, is the source of Lightroom values" rule. Confirmed via
// project-wide grep to have zero remaining callers in this codebase as
// of P1C; retained only as a documented compatibility fallback rather
// than deleted outright, per the spec's legacy-compatibility guidance.
// See P1C_LEGACY_PRESET_MIGRATION_MAP.md.
function readSlidersAsPreset() {
  const HSL_CHANNELS = ['red','orange','yellow','green','aqua','blue','purple','magenta'];
  const hsl = {};
  for (const ch of HSL_CHANNELS) {
    hsl[`hsl_h_${ch}`] = gv(`hsl_h_${ch}`);
    hsl[`hsl_s_${ch}`] = gv(`hsl_s_${ch}`);
    hsl[`hsl_l_${ch}`] = gv(`hsl_l_${ch}`);
  }
  const grade = {
    grd_sh_h: gv('grd_sh_h'), grd_sh_s: gv('grd_sh_s'), grd_sh_l: gv('grd_sh_l'),
    grd_mid_h:gv('grd_mid_h'),grd_mid_s:gv('grd_mid_s'),grd_mid_l:gv('grd_mid_l'),
    grd_hi_h: gv('grd_hi_h'), grd_hi_s: gv('grd_hi_s'), grd_hi_l: gv('grd_hi_l'),
    grd_blend:gv('grd_blend'),
  };
  const cal = {
    cal_red_h:gv('cal_red_h'),cal_red_s:gv('cal_red_s'),
    cal_green_h:gv('cal_green_h'),cal_green_s:gv('cal_green_s'),
    cal_blue_h:gv('cal_blue_h'),cal_blue_s:gv('cal_blue_s'),
  };
  return {
    exp:gv('exp'),con:gv('con'),hi:gv('hi'),sh:gv('sh'),wh:gv('wh'),bl:gv('bl'),
    clarity:gv('clarity'),dehaze:gv('dehaze'),texture:gv('texture'),
    temp:gv('temp'),tint:gv('tint'),vib:gv('vib'),sat:gv('sat'),
    sharp:gv('sharp'),noise:gv('noise'),
    crv_hi:gv('crv_hi'),crv_mid:gv('crv_mid'),crv_sh:gv('crv_sh'),
    hsl, grade, cal,
    curves: state.curveEditor ? state.curveEditor.getCurveSet() : null,
  };
}

// ─── Supporter code ───────────────────────────────────────────────────────────
function setupRedeemCode() {
  document.getElementById('btnRedeem')?.addEventListener('click', redeemCode);
}
function redeemCode() {
  const input = document.getElementById('codeIn');
  const msg   = document.getElementById('redeemMsg');
  if (!input || !msg) return;
  const code = input.value.trim().toUpperCase();
  if (!code) { msg.innerHTML = '<div style="margin-top:9px;padding:10px 13px;border-radius:2px;border-left:2px solid var(--danger);background:var(--surface-2);color:var(--danger);font-size:12px">กรุณากรอกโค้ด</div>'; return; }
  msg.innerHTML = '<div style="margin-top:9px;padding:10px 13px;border-radius:2px;border-left:2px solid var(--success);background:var(--surface-2);color:var(--success);font-size:12px">✅ ระบบ Unlimited Mode อยู่แล้ว</div>';
  input.value = '';
  setTimeout(() => (msg.innerHTML = ''), 3000);
}
