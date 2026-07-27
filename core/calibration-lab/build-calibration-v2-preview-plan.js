/**
 * core/calibration-lab/build-calibration-v2-preview-plan.js
 *
 * EPIC 2E-K-R2-FIX2 -- Section 1: Calibration-only Controlled V2
 * Preview Plan.
 *
 * ROOT CAUSE THIS MODULE FIXES: the Calibration Lab previously fed
 * `pixel-truth-capture.js` the SAME `visualPreviewRenderPlanV2` object
 * Production reads (`finalPreset._decision.finalStyleIntent.
 * visualPreviewRenderPlanV2`). That object's V2 side is gated behind
 * `core/lightroom-mapping-engine/mapping-v2-overlay-preview-sandbox.js`'s
 * Human Review checklist -- and `run-comparison-pipeline.js` always
 * passes `controlledPreviewReviewStateV2: null` (Calibration Lab has no
 * Human Review workflow at all), so the Sandbox's `human-review-complete`
 * required gate NEVER passes, `canGeneratePreview` is always `false`,
 * `simulatedPreviewPreset.available` is always `false`, and every fresh
 * Calibration image is unrenderable on the V2 side ("V2 simulated
 * preview preset exists but is not currently available (Sandbox not
 * eligible)") -- regardless of how safe or unsafe the image actually is.
 *
 * THE FIX: this module builds a CALIBRATION-ONLY Sandbox instance --
 * a fresh, function-call-scoped object, never the shared/global
 * Production Sandbox -- by calling the EXACT SAME, UNMODIFIED
 * `buildControlledOverlayPreviewSandboxV2()` Production itself calls,
 * with exactly ONE override: `flags.requireHumanReviewForPreview:
 * false` (a supported, pre-existing override parameter that function
 * already accepts). Every OTHER required gate -- no hard stops, no
 * critical over-stack, sufficient confidence, sufficient safety score,
 * Test Gate eligibility, Overlay Simulation present, Safety Clamp
 * present -- is evaluated EXACTLY as Production would; `humanReviewState`
 * is passed as `null`, never fabricated as "passed". This is the ONLY
 * reason the override is safe: it disables a workflow-completion gate
 * (did a human click approve?) that has no bearing on pixel/safety
 * correctness, never a safety gate itself.
 *
 * The resulting Sandbox is then fed into the EXISTING, UNMODIFIED
 * `buildVisualPreviewRenderPlanV2()` (which internally calls the
 * EXISTING, UNMODIFIED `translateControlledV2PreviewAdjustments()` --
 * "Existing Controlled V2 Translation Policies") to produce a real
 * `{legacyRenderPlan, v2RenderPlan, sharedRenderConstraints}` object,
 * ready to hand directly to
 * `ui/visual-preview-comparison-controller-v2.js`'s `render()` --
 * exactly the same contract Production's own render plan already
 * satisfies, so the isolated pixel renderer needs ZERO changes to
 * accept it.
 *
 * NEVER TOUCHED, NEVER IMPORTED FOR WRITING, NEVER MUTATED BY THIS FILE:
 *   - core/lightroom-mapping-engine/mapping-v2-overlay-preview-sandbox.js
 *     (called read-only, with a supported override parameter)
 *   - core/decision-engine/index.js's own Production Sandbox rebuild
 *     (a completely separate call, on a completely separate object,
 *     with a completely separate `humanReviewState`/`flags` argument --
 *     this module cannot reach or influence it)
 *   - core/lightroom-mapping-engine/index.js (Production Mapping)
 *   - core/xmp-validator/index.js, core/preset-engine/index.js
 *   - Global Human Review / Production Activation Gate state
 *
 * This module NEVER creates a canvas, NEVER reads/writes IndexedDB,
 * NEVER calls serializeXMP/downloadXMP, and returns a plan that is
 * ALWAYS `previewOnly: true, exportEligible: false,
 * appliedToProduction: false, productionWrite: false,
 * productionSource: 'legacy'` -- these five fields are hard-coded
 * constants in this file's own return shape, never derived from any
 * upstream value, so no upstream data corruption could ever flip them.
 */

import { buildControlledOverlayPreviewSandboxV2 } from '../lightroom-mapping-engine/mapping-v2-overlay-preview-sandbox.js';
import { buildVisualPreviewRenderPlanV2 } from '../preview-rendering/visual-preview-render-plan-v2.js';
import { CALIBRATION_V2_PREVIEW_MODE } from './codes.js';

function _isRecord(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function _hardStopsCount(safetyClamp) {
  if (Array.isArray(safetyClamp?.hardStops)) return safetyClamp.hardStops.length;
  if (typeof safetyClamp?.hardStops === 'number' && Number.isFinite(safetyClamp.hardStops)) return safetyClamp.hardStops;
  return 0;
}

function _unavailablePlan({ sourceGenerationId, sourceFingerprint, safetyClampAvailable, noHardStops, noCriticalOverstack, reasons, warnings }) {
  return {
    mode: CALIBRATION_V2_PREVIEW_MODE,
    available: false,
    renderable: false,
    adjustmentModel: null,
    sourceGenerationId: sourceGenerationId ?? null,
    sourceFingerprint: sourceFingerprint ?? null,
    safetyVerified: !!(safetyClampAvailable && noHardStops && noCriticalOverstack),
    noHardStops: !!noHardStops,
    noCriticalOverstack: !!noCriticalOverstack,
    previewOnly: true,
    exportEligible: false,
    appliedToProduction: false,
    productionWrite: false,
    productionSource: 'legacy',
    reasons: reasons.length ? reasons : ['Calibration V2 Preview Plan is unavailable.'],
    warnings,
    // Transient-only, never persisted (no field for this on schema.js's
    // Semantic Image Test Record) -- consumed exclusively by
    // pixel-truth-capture.js within the same runtime call.
    renderPlanForPixelPreview: null,
  };
}

const BASE_WARNINGS = Object.freeze([
  'Calibration-only preview: never applied to Production, never exported, never mutates the Legacy preset, and never marks Production Human Review as passed.',
]);

/**
 * Builds a Calibration-only Controlled V2 Preview Plan for one already-
 * analyzed image (Section 1 contract). Returns synchronously (pure
 * function of its already-computed inputs -- no DOM/Canvas/network).
 *
 * @param {object} input
 * @param {object} input.finalPreset - the full `finalPreset` object `runCalibrationComparisonPipeline()` already computed (must carry `_decision.finalStyleIntent`).
 * @param {object} input.legacyPreset - the mapped Legacy Lightroom preset (`mapStyleFingerprintToLightroom()`'s output) for this same analysis.
 * @param {string|number|null} input.sourceGenerationId - this record's own generation id (stamped through, never invented).
 * @param {string|null} input.sourceFingerprint - this record's own perceptual image fingerprint (stamped through, never invented).
 * @returns {object} the Section-1 CALIBRATION_PREVIEW_ONLY contract, plus a transient `renderPlanForPixelPreview` sub-object for the isolated pixel renderer.
 */
export function buildCalibrationV2PreviewPlan(input = {}) {
  const {
    finalPreset = null,
    legacyPreset = null,
    sourceGenerationId = null,
    sourceFingerprint = null,
  } = _isRecord(input) ? input : {};

  const reasons = [];
  const warnings = [...BASE_WARNINGS];

  const finalStyleIntent = _isRecord(finalPreset?._decision?.finalStyleIntent) ? finalPreset._decision.finalStyleIntent : null;
  const safetyClamp = _isRecord(finalStyleIntent?.lightroomSafetyClampV2) ? finalStyleIntent.lightroomSafetyClampV2 : null;
  const overlaySimulation = _isRecord(finalStyleIntent?.legacyOverlaySimulationV2) ? finalStyleIntent.legacyOverlaySimulationV2 : null;

  const hardStopsCount = _hardStopsCount(safetyClamp);
  const overStackSeverity = safetyClamp?.overStackAnalysis?.severity ?? 'unknown';
  const noHardStops = hardStopsCount === 0;
  const noCriticalOverstack = overStackSeverity !== 'critical';
  const safetyClampAvailable = !!safetyClamp;
  const overlaySimulationAvailable = !!overlaySimulation;
  const legacyPresetAvailable = _isRecord(legacyPreset);
  const idsPresent = typeof sourceGenerationId === 'string' || typeof sourceGenerationId === 'number';
  const fingerprintPresent = typeof sourceFingerprint === 'string' && sourceFingerprint.length > 0;

  if (!finalStyleIntent) reasons.push('No finalStyleIntent was supplied -- Calibration V2 Preview Plan is unavailable.');
  if (!legacyPresetAvailable) reasons.push('No Legacy preset was supplied -- Calibration V2 Preview Plan is unavailable.');
  if (!safetyClampAvailable) reasons.push('Safety Clamp is unavailable -- Calibration V2 Preview Plan cannot be verified safe, so it is blocked.');
  if (!overlaySimulationAvailable) reasons.push('Overlay Simulation is unavailable -- Calibration V2 Preview Plan cannot be built.');
  if (!noHardStops) reasons.push(`${hardStopsCount} active hard stop(s) reported by Safety Clamp -- Calibration V2 Preview Plan is blocked (this is a genuine safety block, never bypassed for calibration purposes).`);
  if (!noCriticalOverstack) reasons.push(`Critical over-stack severity ("${overStackSeverity}") reported by Safety Clamp -- Calibration V2 Preview Plan is blocked.`);
  if (!idsPresent) reasons.push('sourceGenerationId was not supplied -- Calibration V2 Preview Plan cannot be safely identity-stamped.');
  if (!fingerprintPresent) reasons.push('sourceFingerprint was not supplied -- Calibration V2 Preview Plan cannot be safely identity-stamped.');

  const eligible = !!finalStyleIntent && legacyPresetAvailable && safetyClampAvailable &&
    overlaySimulationAvailable && noHardStops && noCriticalOverstack && idsPresent && fingerprintPresent;

  if (!eligible) {
    return _unavailablePlan({ sourceGenerationId, sourceFingerprint, safetyClampAvailable, noHardStops, noCriticalOverstack, reasons, warnings });
  }

  // ── Build the CALIBRATION-ONLY Sandbox (see module docstring: the
  // ONLY override is requireHumanReviewForPreview:false; every other
  // gate is evaluated exactly as Production evaluates it). ──
  let calibrationSandbox = null;
  try {
    calibrationSandbox = buildControlledOverlayPreviewSandboxV2({
      finalStyleIntent,
      decision: { styleBudget: finalPreset?._decision?.styleBudget ?? null },
      legacyPreset,
      legacyStyleBudget: finalPreset?._decision?.styleBudget ?? null,
      lightroomMappingPlanV2: finalStyleIntent.lightroomMappingPlanV2 ?? null,
      lightroomTranslationV2: finalStyleIntent.lightroomTranslationV2 ?? null,
      lightroomSafetyClampV2: safetyClamp,
      lightroomShadowCompareReportV2: finalStyleIntent.lightroomShadowCompareReportV2 ?? null,
      lightroomControlledActivationV2: finalStyleIntent.lightroomControlledActivationV2 ?? null,
      legacySafetyOverlayV2: finalStyleIntent.legacySafetyOverlayV2 ?? null,
      legacyOverlaySimulationV2: overlaySimulation,
      controlledOverlayTestGateV2: finalStyleIntent.controlledOverlayTestGateV2 ?? null,
      styleBudgetIntelligence: finalStyleIntent.styleBudgetIntelligence ?? null,
      photographerIntent: finalStyleIntent.photographerIntent ?? null,
      styleDNA: finalStyleIntent.photographerStyle?.top?.styleDNA ?? null,
      styleFeasibility: finalStyleIntent.styleFeasibilityEstimate ?? null,
      captureCapability: finalStyleIntent.captureCapabilityEstimate ?? null,
      // Never fabricated as "passed" -- the Calibration Lab genuinely
      // has no Human Review workflow, so this stays honestly null.
      humanReviewState: null,
      // THE ONLY OVERRIDE. Every other flag remains at its Production
      // default (LIGHTROOM_MAPPING_V2_FLAGS, merged inside the callee).
      flags: { requireHumanReviewForPreview: false },
    });
  } catch (e) {
    reasons.push(`Calibration Sandbox construction failed safely: ${e?.message ?? 'unknown error'}.`);
    return _unavailablePlan({ sourceGenerationId, sourceFingerprint, safetyClampAvailable, noHardStops, noCriticalOverstack, reasons, warnings });
  }

  // ── Feed the calibration-only Sandbox into the EXISTING, UNMODIFIED
  // Render Plan builder -- reuses translateControlledV2PreviewAdjustments
  // ("Existing Controlled V2 Translation Policies") with zero new
  // editing/adjustment algorithm. ──
  let fullRenderPlan = null;
  try {
    fullRenderPlan = buildVisualPreviewRenderPlanV2({
      legacyPreset,
      controlledOverlayPreviewSandboxV2: calibrationSandbox,
      legacyOverlaySimulationV2: overlaySimulation,
      lightroomSafetyClampV2: safetyClamp,
      captureCapability: finalStyleIntent.captureCapabilityEstimate ?? null,
      photographerIntent: finalStyleIntent.photographerIntent ?? null,
      photographerStyle: finalStyleIntent.photographerStyle ?? null,
      styleDNA: finalStyleIntent.photographerStyle?.top?.styleDNA ?? null,
    });
  } catch (e) {
    reasons.push(`Calibration Render Plan construction failed safely: ${e?.message ?? 'unknown error'}.`);
    return _unavailablePlan({ sourceGenerationId, sourceFingerprint, safetyClampAvailable, noHardStops, noCriticalOverstack, reasons, warnings });
  }

  const v2 = fullRenderPlan?.v2RenderPlan ?? null;
  const available = v2?.available === true;
  const renderable = v2?.renderable === true;

  reasons.push(...(Array.isArray(v2?.reasons) ? v2.reasons : []));
  warnings.push(...(Array.isArray(v2?.warnings) ? v2.warnings : []));

  return {
    mode: CALIBRATION_V2_PREVIEW_MODE,
    available,
    renderable,
    adjustmentModel: v2?.adjustmentModel ?? null,
    sourceGenerationId,
    sourceFingerprint,
    safetyVerified: safetyClampAvailable && noHardStops && noCriticalOverstack,
    noHardStops,
    noCriticalOverstack,
    // Hard-coded constants -- never derived from any upstream value,
    // regardless of what `v2` claims (v2.previewOnly/exportEligible/
    // appliedToProduction are ALSO always these exact values by
    // construction of visual-preview-render-plan-v2.js, but this
    // module's own guarantee does not depend on that fact holding).
    previewOnly: true,
    exportEligible: false,
    appliedToProduction: false,
    productionWrite: false,
    productionSource: 'legacy',
    reasons,
    warnings: [...new Set(warnings)],
    // Transient-only (never persisted): the exact shape
    // `ui/visual-preview-comparison-controller-v2.js`'s `render()`
    // already expects (`{legacyRenderPlan, v2RenderPlan,
    // sharedRenderConstraints}`), unmodified from
    // `buildVisualPreviewRenderPlanV2()`'s own return value.
    renderPlanForPixelPreview: fullRenderPlan,
  };
}

/** Structural guard used by hostile tests (Section 13): a Calibration V2 Preview Plan must NEVER report any of these five fields in a way that could enable Production activation, regardless of upstream data. */
export function isCalibrationPlanProductionSafe(plan) {
  if (!_isRecord(plan)) return false;
  return plan.previewOnly === true &&
    plan.exportEligible === false &&
    plan.appliedToProduction === false &&
    plan.productionWrite === false &&
    plan.productionSource === 'legacy';
}
