/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ISOLATED VISUAL PREVIEW RENDER PLAN V2 (EPIC 2E-H Phase A) — PLAN ONLY
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Builds a normalized, browser-renderable "render plan" describing what
 * an isolated, non-production canvas preview would abstractly apply for
 * (1) the current Legacy Mapping preset and (2) the V2 Controlled
 * Overlay Preview Sandbox — WITHOUT rendering anything itself.
 *
 * This is PLAN CONSTRUCTION ONLY:
 * - creates no canvas, no pixels, no DOM
 * - is not wired into the main pipeline (decision-engine/index.js is
 *   NOT modified by this file's existence — a future Phase B will do
 *   that integration)
 * - never changes the project version
 * - never writes XMP, never touches preset-engine/xmp-validator
 * - never activates Production Write or Mapping V2
 *
 * PRODUCT TRUTH: every plan this module returns is an APPROXIMATE
 * BROWSER PREVIEW — never Lightroom rendering, Adobe Camera Raw
 * rendering, RAW development, ICC-accurate output, a color-managed
 * proof, or production preset output. `previewAccuracy` is always the
 * literal string `"approximate-browser-preview"`, on every plan, with
 * no exception.
 *
 * `selectedProductionSource` is hard-coded `"legacy"`. No returned plan
 * ever contains an XMP string, XMP namespace, production-write flag,
 * export command, or preset-mutation instruction — this module cannot
 * write to Lightroom Mapping, presets, or XMP even in principle, since
 * it contains no such code path at all.
 *
 * A GENUINE DATA-HONESTY CONSTRAINT DISCOVERED WHILE BUILDING THIS
 * MODULE: `controlledOverlayPreviewSandboxV2.simulatedPreviewPreset`
 * does NOT contain concrete, signed adjustment magnitudes — its
 * `adjustments[]`/`values{}` are RISK-MITIGATION ACTION DESCRIPTIONS
 * (e.g. "reduce aggressive shift", "suppress risky direction", "cap
 * intensity") with only an abstract 0-1 *intensity* (how strongly to
 * mitigate), never a direction/magnitude a pixel transform could
 * actually apply (e.g. "+0.3 exposure"). Because of this, the V2
 * render plan's `adjustmentModel` honestly reports EVERY adjustment as
 * unsupported in Phase A — `v2RenderPlan.renderable` is therefore
 * `false` in every currently-reachable scenario, not because the
 * renderer is incomplete, but because there is no concrete signed
 * adjustment data yet to render. This is documented, not hidden.
 */

// ── Legacy preset field → normalized adjustment mapping ──────────────────────
// Scale factors below are NOT guesses — each is the exact clamp range
// verified directly in core/lightroom-mapping-engine/index.js (the
// `STYLE_LIMIT` constant for exposure/contrast/highlights/shadows/
// whites/blacks, and the explicit `clamp(temp, -50, 50)` /
// `clamp(tint, -30, 30)` / vibrance clamp calls for the rest).
const LEGACY_FIELD_SCALE = {
  exposure: { key: 'exp', scale: 35 },
  contrast: { key: 'con', scale: 25 },
  highlights: { key: 'hi', scale: 55 },
  shadows: { key: 'sh', scale: 35 },
  whites: { key: 'wh', scale: 30 },
  blacks: { key: 'bl', scale: 35 },
  temperature: { key: 'temp', scale: 50 },
  tint: { key: 'tint', scale: 30 },
  saturation: { key: 'sat', scale: 20 },
  vibrance: { key: 'vib', scale: 30 },
  clarity: { key: 'clarity', scale: 40 },
  dehaze: { key: 'dehaze', scale: 40 },
};

// toneCurve and colorGrading are structurally different (nested
// objects, not single numeric fields) — handled separately below,
// never through the flat numeric scale table above.
const SUPPORTED_ADJUSTMENTS = [
  'exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks',
  'temperature', 'tint', 'saturation', 'vibrance', 'clarity', 'dehaze',
  'toneCurve', 'colorGrading',
];

function _isRecord(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function _safeArray(v) {
  return Array.isArray(v) ? v : [];
}

/** Clamps a value to [-1, 1], rejecting NaN/Infinity/non-numbers entirely (returns null, never a coerced 0). */
function _clampUnit(v) {
  if (!Number.isFinite(v)) return null;
  return Math.max(-1, Math.min(1, v));
}

/**
 * Normalizes one flat numeric Legacy preset field (e.g. `exp`) into a
 * [-1, 1] value using its real, verified clamp-range scale. Missing or
 * malformed input is honestly `{value: null, supported: false}` —
 * never coerced to a neutral `0`, which would falsely claim "no
 * adjustment" when the truth is "no evidence".
 */
function _normalizeLegacyField(raw, scale) {
  if (raw === undefined || raw === null || !Number.isFinite(raw)) return { value: null, supported: false };
  const normalized = _clampUnit(raw / scale);
  return normalized === null ? { value: null, supported: false } : { value: +normalized.toFixed(4), supported: true };
}

/**
 * Builds a normalized adjustment model from the REAL current Legacy
 * preset (`mapped`, from mapStyleFingerprintToLightroom — never the V2
 * Sandbox's simulated preset). Every field is normalized independently
 * and defensively; a malformed/missing Legacy preset produces a model
 * where every field is honestly unsupported, never a crash and never a
 * fabricated value.
 */
function _buildLegacyAdjustmentModel(legacyPreset) {
  const preset = _isRecord(legacyPreset) ? legacyPreset : {};
  const supportedAdjustments = [];
  const unsupportedAdjustments = [];
  const normalizationWarnings = [];
  const model = {};

  for (const name of Object.keys(LEGACY_FIELD_SCALE)) {
    const { key, scale } = LEGACY_FIELD_SCALE[name];
    const { value, supported } = _normalizeLegacyField(preset[key], scale);
    model[name] = value;
    if (supported) supportedAdjustments.push(name);
    else { unsupportedAdjustments.push(name); if (key in preset) normalizationWarnings.push(`Legacy field "${key}" for "${name}" was present but not a finite number — treated as unsupported.`); }
  }

  // Basic tone-curve approximation: only the three canonical curve
  // control points this codebase actually produces (crv_hi/crv_mid/
  // crv_sh) are used — never a full arbitrary curve, and never
  // invented when absent.
  const curveFields = ['crv_hi', 'crv_mid', 'crv_sh'];
  const hasCurve = curveFields.some(k => Number.isFinite(preset[k]));
  if (hasCurve) {
    model.toneCurve = {
      highlights: _clampUnit((preset.crv_hi ?? 0) / 50),
      midtone: _clampUnit((preset.crv_mid ?? 0) / 50),
      shadows: _clampUnit((preset.crv_sh ?? 0) / 50),
    };
    supportedAdjustments.push('toneCurve');
  } else {
    model.toneCurve = null;
    unsupportedAdjustments.push('toneCurve');
  }

  // Limited color-grading approximation: only shadow/midtone/highlight
  // hue+saturation balance (grd_*), never the full Lightroom color-
  // grading wheel model.
  // FIX 1 (EPIC 2E-H-A-F2): merge nested `preset.grade.*` and flat
  // `preset.grd_*` fields — the previous either/or logic
  // (`_isRecord(preset.grade) ? preset.grade : preset`) let an EMPTY
  // nested `grade: {}` object hide perfectly valid flat `grd_*` data,
  // since it picked the nested object wholesale merely because it
  // existed as an object, never checking whether it actually had
  // anything in it. `pickFinite` instead resolves the first genuinely
  // finite value across BOTH candidate sources per field — neither
  // source can hide the other's valid data, and neither ever
  // fabricates a value when both are genuinely missing.
  const pickFinite = (...values) => values.find(v => Number.isFinite(v)) ?? null;
  const nestedGrade = _isRecord(preset.grade) ? preset.grade : {};
  const gradeCandidateValues = [
    pickFinite(nestedGrade.grd_sh_h, preset.grd_sh_h), pickFinite(nestedGrade.grd_sh_s, preset.grd_sh_s),
    pickFinite(nestedGrade.grd_mid_h, preset.grd_mid_h), pickFinite(nestedGrade.grd_mid_s, preset.grd_mid_s),
    pickFinite(nestedGrade.grd_hi_h, preset.grd_hi_h), pickFinite(nestedGrade.grd_hi_s, preset.grd_hi_s),
  ];
  const hasGrade = gradeCandidateValues.some(v => Number.isFinite(v));
  const gradeObjectPresentButEmpty = _isRecord(preset.grade) && !hasGrade;
  const shSat = pickFinite(nestedGrade.grd_sh_s, preset.grd_sh_s);
  const midSat = pickFinite(nestedGrade.grd_mid_s, preset.grd_mid_s);
  const hiSat = pickFinite(nestedGrade.grd_hi_s, preset.grd_hi_s);
  // FIX 1 (EPIC 2E-H-A-F3): the browser preview Renderer currently
  // applies ONLY saturation-based nudges for color grading
  // (`_applyColorGrading` reads `shadowSat`/`highlightSat` only, never
  // any Hue field) — so a Hue-only preset like `{grd_sh_h: 30}` would
  // previously report `supportedAdjustments: ["colorGrading"]` and
  // `renderable: true` while producing literally zero pixel change,
  // since every saturation value would be `null`. Support/renderable
  // now requires at least one FINITE, usable saturation value — Hue
  // alone is preserved in the normalized model (useful metadata/
  // future-proofing) but never makes this adjustment "supported".
  const hasUsableSaturation = Number.isFinite(shSat) || Number.isFinite(midSat) || Number.isFinite(hiSat);
  if (hasGrade) {
    model.colorGrading = {
      shadowHue: pickFinite(nestedGrade.grd_sh_h, preset.grd_sh_h),
      shadowSat: shSat === null ? null : _clampUnit(shSat / 30),
      midtoneHue: pickFinite(nestedGrade.grd_mid_h, preset.grd_mid_h),
      midtoneSat: midSat === null ? null : _clampUnit(midSat / 15),
      highlightHue: pickFinite(nestedGrade.grd_hi_h, preset.grd_hi_h),
      highlightSat: hiSat === null ? null : _clampUnit(hiSat / 30),
    };
    if (hasUsableSaturation) {
      supportedAdjustments.push('colorGrading');
    } else {
      // Hue exists but no usable saturation — preserve the Hue data in
      // the model (never fabricated further), but this is honestly
      // unsupported by the current renderer, not a rendering-capable
      // adjustment.
      unsupportedAdjustments.push('colorGrading');
      normalizationWarnings.push('Legacy preset has Hue-only color grading data (no finite saturation value) — the browser preview renderer only applies saturation-based grading nudges, so Hue-only grading is not implemented and does not make this adjustment supported.');
    }
  } else {
    model.colorGrading = null;
    unsupportedAdjustments.push('colorGrading');
    if (gradeObjectPresentButEmpty) normalizationWarnings.push('Legacy preset.grade was present but contained no finite hue/saturation field — treated as unsupported, not fabricated.');
  }

  return {
    ...model,
    supportedAdjustments,
    unsupportedAdjustments,
    normalizationWarnings,
  };
}

/**
 * Builds a normalized adjustment model from the V2 Sandbox's
 * `simulatedPreviewPreset`. See the file-level comment for why every
 * field here is honestly unsupported in Phase A:
 * `simulatedPreviewPreset.values`/`adjustments` carry abstract
 * risk-mitigation ACTION descriptions and a 0-1 mitigation
 * *intensity*, never a concrete signed pixel-adjustment magnitude a
 * renderer could apply. This function does not invent one.
 */
function _buildV2AdjustmentModel(sandbox) {
  const preset = _isRecord(sandbox?.simulatedPreviewPreset) ? sandbox.simulatedPreviewPreset : null;
  const model = {};
  for (const name of SUPPORTED_ADJUSTMENTS) model[name] = null;

  const unsupportedAdjustments = [...SUPPORTED_ADJUSTMENTS];
  const normalizationWarnings = [];
  if (preset && _isRecord(preset.values) && Object.keys(preset.values).length) {
    normalizationWarnings.push(`V2 simulated preview data reports ${Object.keys(preset.values).length} risk-mitigation area(s), but these are abstract action descriptions (e.g. "reduce aggressive shift") with only a 0-1 mitigation intensity, never a concrete signed adjustment magnitude a pixel renderer can apply — all V2 adjustments remain unsupported until a future engine revision provides concrete adjustment values.`);
  } else {
    normalizationWarnings.push('No V2 simulated preview adjustment data is available.');
  }

  return {
    ...model,
    supportedAdjustments: [],
    unsupportedAdjustments,
    normalizationWarnings,
  };
}

function _buildProtectedChannels() {
  return {
    alpha: true,
    extremeHighlights: true,
    deepShadows: true,
    skinSensitiveHueRanges: true,
    note: 'Approximate protection only — this is NOT semantic masking accuracy; no perfect skin protection is claimed or implied.',
  };
}

function _buildRenderConstraints() {
  return {
    maxInputWidth: 2048,
    maxInputHeight: 2048,
    maxPixelCount: 2048 * 2048,
    maxDevicePixelRatio: 2,
    preserveAspectRatio: true,
    preserveAlpha: true,
    colorSpaceAssumption: 'sRGB (browser-managed, not ICC-accurate)',
    allowOffscreenCanvas: true,
    allowWorkerRendering: false,
    allowProductionWrite: false,
    allowExport: false,
    // FIX 8 (EPIC 2E-H-A-F): this value is ADVISORY ONLY at the plan
    // level — this module has no code path that measures or enforces
    // elapsed time. Whether a consuming renderer actually implements a
    // bounded timeout is reported honestly by THAT renderer's own
    // result metadata (`timeoutEnforced`), never implied here.
    timeoutMs: 8000,
  };
}

const HONESTY_WARNINGS = [
  'This browser preview is an approximation — it is NOT Lightroom-accurate.',
  'RAW development is not simulated.',
  'Camera profiles are not reproduced.',
  'Local masks are not reproduced.',
  'Color-management differences from Lightroom/ACR may remain.',
];

/**
 * Builds the Legacy render plan. `renderable` is true only when at
 * least one supported adjustment was actually normalized from real
 * Legacy preset data — never merely because `legacyPreset` exists as
 * an object.
 */
function _buildLegacyRenderPlan(legacyPreset) {
  const available = _isRecord(legacyPreset);
  const adjustmentModel = _buildLegacyAdjustmentModel(legacyPreset);
  const renderable = available && adjustmentModel.supportedAdjustments.length > 0;
  const warnings = [...HONESTY_WARNINGS];
  const reasons = [];

  if (!available) reasons.push('No Legacy preset was supplied — Legacy render plan is unavailable.');
  else if (!renderable) reasons.push('Legacy preset was supplied, but no field normalized to a supported adjustment — nothing for the browser renderer to apply.');
  else reasons.push(`Legacy preset normalized ${adjustmentModel.supportedAdjustments.length} supported adjustment(s): ${adjustmentModel.supportedAdjustments.join(', ')}.`);

  if (adjustmentModel.unsupportedAdjustments.length) warnings.push(`Unsupported/unavailable Legacy adjustments: ${adjustmentModel.unsupportedAdjustments.join(', ')}.`);

  return {
    available, renderable, source: 'legacy', previewOnly: true, productionSource: true,
    previewAccuracy: 'approximate-browser-preview',
    adjustmentModel, protectedChannels: _buildProtectedChannels(), renderConstraints: _buildRenderConstraints(),
    warnings, reasons,
    confidence: +(available ? (renderable ? 0.5 : 0.2) : 0.05).toFixed(2),
  };
}

/**
 * Builds the V2 render plan. Blocks rendering (returns `renderable:
 * false`) when the Sandbox's non-production evidence is missing or
 * contradictory: `simulatedPreviewPreset.available` must be `true`,
 * `appliedToProduction` must not be `true`, `exportEligible` must not
 * be `true`. Even when all of that evidence checks out, `renderable`
 * remains `false` in Phase A because the adjustment model itself has
 * no supported (concrete, signed) adjustments yet — see the
 * file-level comment.
 */
function _buildV2RenderPlan(sandbox) {
  const preset = _isRecord(sandbox?.simulatedPreviewPreset) ? sandbox.simulatedPreviewPreset : null;
  const warnings = [...HONESTY_WARNINGS];
  const reasons = [];

  const presetAvailable = preset?.available === true;
  const appliedToProduction = preset?.appliedToProduction;
  const exportEligible = preset?.exportEligible;
  const contradictoryEvidence = appliedToProduction === true || exportEligible === true;

  if (!preset) reasons.push('No V2 Sandbox simulated preview preset was supplied — V2 render plan is unavailable.');
  else if (!presetAvailable) reasons.push('V2 simulated preview preset exists but is not currently available (Sandbox not eligible) — nothing to render yet.');
  else if (contradictoryEvidence) { reasons.push('V2 preview evidence is contradictory (appliedToProduction or exportEligible reports true) — blocking V2 rendering as a safety precaution.'); warnings.push('V2 preview evidence contradicts the expected non-production guarantees — this should never happen upstream; treat with caution.'); }
  else reasons.push('V2 simulated preview preset is available and confirmed non-production, but contains no concrete signed adjustment values to render in Phase A.');

  const available = !!preset;
  const adjustmentModel = _buildV2AdjustmentModel(sandbox);
  // renderable requires: available data, non-production confirmed, no
  // contradictory evidence, AND at least one supported (concrete)
  // adjustment — the last condition is never met in Phase A (see file
  // header), so this is always false today, honestly.
  const renderable = available && presetAvailable && !contradictoryEvidence && adjustmentModel.supportedAdjustments.length > 0;

  if (adjustmentModel.unsupportedAdjustments.length) warnings.push(`Unsupported/unavailable V2 adjustments: ${adjustmentModel.unsupportedAdjustments.join(', ')}.`);

  return {
    available, renderable, source: 'controlled-v2-preview', previewOnly: true, productionSource: false,
    // This Render Plan's OWN behavior — always hard-coded, regardless
    // of upstream anomalies (which are preserved honestly below in
    // `upstreamEvidence`, never silently overwritten or hidden here).
    exportEligible: false, appliedToProduction: false,
    // FIX 6 (EPIC 2E-H-A-F): the actual upstream Sandbox report,
    // preserved as-is — `null` when the field itself was never
    // supplied (distinct from an explicit `false`), so a genuine
    // contradiction (upstream reporting `true`) is never silently lost
    // just because this Plan's own guarantee is hard-coded safe.
    upstreamEvidence: {
      simulatedPreviewAvailable: presetAvailable,
      exportEligible: typeof exportEligible === 'boolean' ? exportEligible : null,
      appliedToProduction: typeof appliedToProduction === 'boolean' ? appliedToProduction : null,
      contradictory: contradictoryEvidence,
    },
    previewAccuracy: 'approximate-browser-preview',
    adjustmentModel, protectedChannels: _buildProtectedChannels(), renderConstraints: _buildRenderConstraints(),
    warnings, reasons,
    confidence: +(presetAvailable && !contradictoryEvidence ? 0.15 : 0.05).toFixed(2),
  };
}

/**
 * Main entry point. Every field optional; every access null-safe.
 * Guaranteed never to throw, including `buildVisualPreviewRenderPlanV2({})`.
 * Never mutates any input object — only reads and normalizes.
 */
export function buildVisualPreviewRenderPlanV2(input = {}) {
  const {
    sourceImageMetadata = null,
    legacyPreset = null,
    controlledOverlayPreviewSandboxV2: sandbox = null,
    legacyOverlaySimulationV2: overlaySimulation = null,
    lightroomSafetyClampV2: safetyClamp = null,
    sideBySidePreviewComparisonV2: comparison = null,
    captureCapability = null,
    photographerIntent = null,
    photographerStyle = null,
    styleDNA = null,
  } = _isRecord(input) ? input : {};

  const blockers = [], renderWarnings = [], reasons = [];

  const legacyRenderPlan = _buildLegacyRenderPlan(legacyPreset);
  const v2RenderPlan = _buildV2RenderPlan(sandbox);

  renderWarnings.push(...legacyRenderPlan.warnings.filter(w => !HONESTY_WARNINGS.includes(w)));
  renderWarnings.push(...v2RenderPlan.warnings.filter(w => !HONESTY_WARNINGS.includes(w)));
  renderWarnings.push(...HONESTY_WARNINGS);
  reasons.push(...legacyRenderPlan.reasons, ...v2RenderPlan.reasons);

  if (!legacyRenderPlan.available && !v2RenderPlan.available) blockers.push('Neither Legacy nor V2 render data is available.');
  if (!legacyRenderPlan.renderable && !v2RenderPlan.renderable) blockers.push('No renderable adjustment model exists for either side yet.');

  // ── Hard-stop / critical-overstack awareness from Safety Clamp (informational only — this module has no code path to act on it beyond blocking/warning) ──
  const hardStopsCount = Array.isArray(safetyClamp?.hardStops) ? safetyClamp.hardStops.length
    : (typeof safetyClamp?.hardStops === 'number' && Number.isFinite(safetyClamp.hardStops) ? safetyClamp.hardStops : 0);
  if (hardStopsCount > 0) { blockers.push(`${hardStopsCount} hard stop(s) reported by Safety Clamp.`); renderWarnings.push(`${hardStopsCount} active hard stop(s) — treat any V2 render plan with caution.`); }

  let renderState;
  if (!legacyRenderPlan.available && !v2RenderPlan.available) renderState = 'unavailable';
  else if (hardStopsCount > 0) renderState = 'blocked';
  else if (!legacyRenderPlan.renderable && !v2RenderPlan.renderable) renderState = 'insufficient-data';
  else if (legacyRenderPlan.renderable || v2RenderPlan.renderable) renderState = 'ready-for-isolated-render';
  else renderState = 'partial';

  const confidence = +Math.max(0, Math.min(1,
    (legacyRenderPlan.available ? 0.2 : 0) + (v2RenderPlan.available ? 0.1 : 0) +
    (legacyRenderPlan.renderable ? 0.3 : 0) + (v2RenderPlan.renderable ? 0.1 : 0) -
    (hardStopsCount > 0 ? 0.3 : 0)
  )).toFixed(3);

  // Optional supplementary context — never required for a valid plan,
  // referenced only in reasons/metadata, never used to fabricate
  // adjustment values.
  if (_isRecord(captureCapability)) reasons.push('Capture capability context is available (informational only — does not alter the render plan itself).');
  if (_isRecord(photographerIntent) || _isRecord(photographerStyle) || styleDNA) reasons.push('Photographer intent/style context is available (informational only — does not alter the render plan itself).');
  if (_isRecord(comparison)) reasons.push(`Side-by-Side comparison context available (comparisonState="${_isRecord(comparison) ? comparison.comparisonState : 'unknown'}").`);
  if (_isRecord(overlaySimulation)) reasons.push('Overlay simulation context is available (informational only).');

  return {
    mode: 'isolated-visual-preview-render-plan',
    renderState,
    previewAccuracy: 'approximate-browser-preview',
    selectedProductionSource: 'legacy',
    legacyRenderPlan,
    v2RenderPlan,
    sharedRenderConstraints: _buildRenderConstraints(),
    protectedChannels: _buildProtectedChannels(),
    renderWarnings: [...new Set(renderWarnings)],
    blockers,
    reasons,
    rollbackPlan: {
      available: true, restoreSource: 'legacy', productionMutationDetected: false,
      steps: [
        'Discard the isolated preview canvas.',
        'Release temporary ImageBitmap and pixel buffers.',
        'Discard the Visual Preview Render Plan.',
        'Keep Legacy Lightroom Mapping active.',
        'Keep the existing XMP export path unchanged.',
      ],
    },
    fallbackStrategy: {
      useLegacyMapping: true, safeMode: true,
      reason: 'EPIC 2E-H Phase A produces a render plan only — no canvas is rendered automatically and no production output is affected regardless of this plan\'s contents.',
    },
    confidence: Number(confidence),
    metadata: {
      phase: 'EPIC 2E-H Phase A', integrated: false,
      hasSourceImageMetadata: _isRecord(sourceImageMetadata),
      futureObjectPath: 'not yet integrated into finalStyleIntent',
    },
  };
}
