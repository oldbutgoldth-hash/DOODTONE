/**
 * core/preview-rendering/controlled-v2-preview-adjustment-translator.js
 *
 * CONTROLLED V2 VISUAL TRANSLATION R1 — Phase A/B/C.
 *
 * PURE MODULE. No DOM, no Canvas, no Storage, no Network, no XMP, no
 * Production imports. This file imports nothing from ui/, nothing from
 * core/lightroom-mapping-engine's production write path, and nothing
 * from core/preset-engine or xmp-validator. It is a deterministic,
 * synchronous, side-effect-free function of its inputs only.
 *
 * WHAT THIS SOLVES: today, `controlledOverlayPreviewSandboxV2.
 * simulatedPreviewPreset` only ever contains ABSTRACT risk-mitigation
 * ACTIONS (protect-channel / warn / cap-intensity / suppress-risk /
 * keep-legacy / require-human-review / no-action) plus a 0-1 abstract
 * mitigation *intensity* — never a concrete signed Lightroom-style
 * adjustment value a pixel renderer could apply. Because of that gap,
 * the existing V2 Render Plan (core/preview-rendering/
 * visual-preview-render-plan-v2.js) can only ever produce an Identity
 * Preview.
 *
 * This translator closes that gap HONESTLY: it takes the REAL, already
 * -normalized Legacy adjustment model (concrete, signed, [-1,1] values
 * derived from the actual current Lightroom preset) as its starting
 * point, and applies the Sandbox's abstract restraint actions AS
 * BOUNDED REDUCTIONS on top of it — it never invents a new value,
 * never strengthens a value, never reverses a sign, and never fabricates
 * an adjustment the Legacy model did not already have. Controlled V2 is
 * therefore a restrained variant of the current Legacy Browser Preview,
 * never a random independent look and never a copy of the Legacy canvas
 * taken after rendering.
 *
 * This module NEVER claims its output values are real Lightroom slider
 * values, real XMP values, or Production values — every result honestly
 * reports `containsRealLightroomValues: false`, `containsXMPValues:
 * false`, `productionSafe: false` (meaning: not a production artifact —
 * this value must never be written to Production), `appliedToProduction:
 * false`, `exportEligible: false`.
 */

// ── Pure helpers (duplicated intentionally rather than imported — this
// module must have zero dependency edges into any other file, per the
// Phase A "pure module" constraint) ─────────────────────────────────────

function _isRecord(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Clamps to [-1, 1]; rejects NaN/Infinity/non-numbers as null, never coerced to 0. */
function _clampUnit(v) {
  if (!Number.isFinite(v)) return null;
  return Math.max(-1, Math.min(1, v));
}

const CHANGE_EPSILON = 0.005;

// The exact 12 flat, scalar Legacy adjustment fields this codebase's
// Legacy adjustment model normalizes (see LEGACY_FIELD_SCALE in
// visual-preview-render-plan-v2.js — this list is intentionally kept
// in sync BY HAND, same convention already used for
// qa/phase-c-suite-source-manifest.mjs's manifest entries).
const FLAT_FIELDS = [
  'exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks',
  'temperature', 'tint', 'saturation', 'vibrance', 'clarity', 'dehaze',
];

const SEVERITY_INTENSITY_MAP = { low: 0.25, medium: 0.45, high: 0.65, critical: 0.85 };

// ── Phase B: deterministic bounded restraint factors (verbatim formulas) ──

function _restraintFactorForAction(action, intensity) {
  switch (action) {
    case 'protect-channel': return 1 - Math.min(0.30, intensity * 0.30);
    case 'warn':
    case 'block-aggressive-direction': return 1 - Math.min(0.35, intensity * 0.35);
    case 'cap-intensity': return 1 - Math.min(0.55, intensity * 0.55);
    case 'suppress-risk': return 1 - Math.min(0.70, intensity * 0.70);
    case 'keep-legacy':
    case 'no-action':
    default: return 1;
  }
}

/**
 * Resolves the 0-1 mitigation intensity for one Sandbox action, per
 * Phase B: prefer a finite `simulatedPreviewPreset` intensity in
 * [0,1] for this action's `target` (checked against both `.values{}`
 * and the `.adjustments[]` array shapes the Sandbox produces), else
 * fall back to the severity map. A malformed (out-of-range, non-
 * finite) intensity value is REJECTED (returns null), never silently
 * coerced to 0 — the caller must then fail this action closed.
 */
export function resolveControlledV2ActionIntensity(actionEntry, simulatedPreviewPreset) {
  const target = typeof actionEntry?.target === 'string' ? actionEntry.target : null;
  const preset = _isRecord(simulatedPreviewPreset) ? simulatedPreviewPreset : null;

  let presetIntensity;
  let presetIntensityWasPresent = false;
  if (target && preset) {
    const fromValues = _isRecord(preset.values) ? preset.values[target] : null;
    if (_isRecord(fromValues) && Object.prototype.hasOwnProperty.call(fromValues, 'intensity')) {
      presetIntensity = fromValues.intensity;
      presetIntensityWasPresent = true;
    } else if (Array.isArray(preset.adjustments)) {
      const entry = preset.adjustments.find((a) => _isRecord(a) && a.area === target && Object.prototype.hasOwnProperty.call(a, 'intensity'));
      if (entry) { presetIntensity = entry.intensity; presetIntensityWasPresent = true; }
    }
  }

  if (presetIntensityWasPresent) {
    if (Number.isFinite(presetIntensity) && presetIntensity >= 0 && presetIntensity <= 1) return presetIntensity;
    // Malformed evidence — reject rather than coerce to 0 (a coerced 0
    // would silently mean "no restraint at all", which is the OPPOSITE
    // of fail-closed for a safety-restraint mechanism).
    return null;
  }

  const severity = typeof actionEntry?.severity === 'string' ? actionEntry.severity : null;
  if (severity && Object.prototype.hasOwnProperty.call(SEVERITY_INTENSITY_MAP, severity)) return SEVERITY_INTENSITY_MAP[severity];
  return null;
}

// ── Phase C: action → field mapping classifier (C1-C9) ──────────────────

/**
 * Classifies one Sandbox action entry into one of the C1-C9 policy
 * categories (plus the two structural categories 'hard-stop' and
 * 'no-op'). Matches the EXACT action/tool/channel/target vocabulary
 * produced by core/lightroom-mapping-engine/mapping-v2-overlay-simulation.js
 * and copied into sandbox.previewPlan.actions[] by
 * mapping-v2-overlay-preview-sandbox.js.
 */
export function classifyControlledV2Action(actionEntry) {
  const action = typeof actionEntry?.action === 'string' ? actionEntry.action.trim() : '';
  const tool = typeof actionEntry?.tool === 'string' ? actionEntry.tool.trim() : '';
  const channel = typeof actionEntry?.channel === 'string' ? actionEntry.channel.trim().toLowerCase() : '';
  const target = typeof actionEntry?.target === 'string' ? actionEntry.target.trim().toLowerCase() : '';

  if (action === 'require-human-review') return 'hard-stop';
  if (action === 'keep-legacy' || action === 'no-action') return 'no-op';

  // C1 — skin-tone protection (always the first action the Sandbox adds).
  if (target === 'skin tones' || (tool === 'HSL' && channel.includes('skin'))) return 'C1-skin-protection';

  // C2 — highlight pressure / highlight roll-off.
  if (target === 'highlight roll-off' || (tool === 'Basic Tone' && channel === 'highlights')) return 'C2-highlight-pressure';

  // C3 — shadow crushing / shadow detail.
  if (target === 'shadow detail' || (tool === 'Basic Tone' && channel === 'shadows')) return 'C3-shadow-crushing';

  // C4 — White Balance shift risk.
  if (target === 'wb stability' || tool === 'White Balance') return 'C4-wb-shift-risk';

  // C5 — harsh clarity/detail (Presence).
  if (target === 'texture/clarity' || (tool === 'Presence' && channel === 'clarity')) return 'C5-harsh-clarity';

  // C6 — heavy color grading.
  if (target === 'colour restraint' || tool === 'Color Grading') return 'C6-heavy-color-grading';

  // C7 — aggressive calibration (never visualized by the isolated renderer).
  if (tool === 'Calibration' || target === 'calibration restraint') return 'C7-calibration-unsupported';

  // C9 — an explicit "overall" restraint, only for cap-intensity/suppress-risk.
  if (target === 'overall direction' && (action === 'cap-intensity' || action === 'suppress-risk')) return 'C9-overall-restraint';

  // C8 — everything else: fail closed as unknown.
  return 'C8-unknown-action';
}

// ── Field-restraint primitives — each mutates `workingModel` in place,
// records a touch attribution, and NEVER increases magnitude, NEVER
// changes sign, and NEVER invents a value where the Legacy model had
// none (null/undefined fields are always left untouched). ──────────────

function _restrainTowardZero(workingModel, touchMap, field, factor, category, reason) {
  const v = workingModel[field];
  if (!Number.isFinite(v) || v === 0) return;
  const restrained = _clampUnit(v * factor);
  workingModel[field] = restrained === null ? v : restrained;
  if (!touchMap.has(field)) touchMap.set(field, { category, reason });
}

function _restrainPositiveOnly(workingModel, touchMap, field, factor, category, reason) {
  const v = workingModel[field];
  if (!Number.isFinite(v) || v <= 0) return;
  const restrained = _clampUnit(v * factor);
  workingModel[field] = restrained === null ? v : restrained;
  if (!touchMap.has(field)) touchMap.set(field, { category, reason });
}

function _restrainNegativeOnly(workingModel, touchMap, field, factor, category, reason) {
  const v = workingModel[field];
  if (!Number.isFinite(v) || v >= 0) return;
  const restrained = _clampUnit(v * factor);
  workingModel[field] = restrained === null ? v : restrained;
  if (!touchMap.has(field)) touchMap.set(field, { category, reason });
}

function _restrainColorGradingTowardZero(workingModel, touchMap, subfield, factor, category, reason) {
  if (!_isRecord(workingModel.colorGrading)) return;
  const v = workingModel.colorGrading[subfield];
  if (!Number.isFinite(v) || v === 0) return;
  const restrained = _clampUnit(v * factor);
  workingModel.colorGrading[subfield] = restrained === null ? v : restrained;
  if (!touchMap.has(`colorGrading.${subfield}`)) touchMap.set(`colorGrading.${subfield}`, { category, reason });
}

/** Applies exactly one classified action's policy to the working model. Returns a short human-readable policy description for `appliedPolicies`, or null if the action produced no field-level policy (hard-stop/no-op/unsupported are handled by the caller before/after this function). */
function _applyActionPolicy(category, actionEntry, intensity, workingModel, touchMap) {
  switch (category) {
    case 'C1-skin-protection': {
      // Softer than a normal protect-channel reduction — only 60% of
      // the normal magnitude — since this is a GLOBAL approximation,
      // never a local skin mask.
      const base = _restraintFactorForAction('protect-channel', intensity);
      const factor = 1 - (1 - base) * 0.6;
      const reason = 'Skin-tone protection: global, conservative restraint (60% of the normal protect-channel reduction) — not a local skin mask.';
      for (const field of ['temperature', 'tint', 'saturation', 'vibrance', 'contrast', 'clarity']) {
        _restrainTowardZero(workingModel, touchMap, field, factor, category, reason);
      }
      return `C1 skin-tone protection: restrained temperature/tint/saturation/vibrance/contrast/clarity toward zero (factor ${factor.toFixed(3)}).`;
    }
    case 'C2-highlight-pressure': {
      const factor = _restraintFactorForAction('warn', intensity);
      const softFactor = 1 - (1 - factor) * 0.5;
      const reason = 'Highlight pressure: reduced only positive exposure/highlights/whites — negative highlight recovery is never weakened.';
      _restrainPositiveOnly(workingModel, touchMap, 'exposure', factor, category, reason);
      _restrainPositiveOnly(workingModel, touchMap, 'highlights', factor, category, reason);
      _restrainPositiveOnly(workingModel, touchMap, 'whites', factor, category, reason);
      _restrainPositiveOnly(workingModel, touchMap, 'contrast', softFactor, category, 'Highlight pressure: optionally softened positive contrast by half the action factor.');
      return `C2 highlight pressure: restrained positive exposure/highlights/whites (factor ${factor.toFixed(3)}), positive contrast at half factor.`;
    }
    case 'C3-shadow-crushing': {
      const factor = _restraintFactorForAction('protect-channel', intensity);
      const softFactor = 1 - (1 - factor) * 0.5;
      const reason = 'Shadow crushing: restrained only negative shadows/blacks — positive shadow-opening values are never reduced.';
      _restrainNegativeOnly(workingModel, touchMap, 'shadows', factor, category, reason);
      _restrainNegativeOnly(workingModel, touchMap, 'blacks', factor, category, reason);
      _restrainPositiveOnly(workingModel, touchMap, 'contrast', softFactor, category, 'Shadow crushing: optionally softened positive contrast by half the action factor (high contrast deepens shadow crushing).');
      return `C3 shadow crushing: restrained negative shadows/blacks (factor ${factor.toFixed(3)}), positive contrast at half factor.`;
    }
    case 'C4-wb-shift-risk': {
      const factor = _restraintFactorForAction('warn', intensity);
      const reason = 'White Balance shift risk: moved temperature/tint magnitude toward zero, sign preserved — never a new WB direction.';
      _restrainTowardZero(workingModel, touchMap, 'temperature', factor, category, reason);
      _restrainTowardZero(workingModel, touchMap, 'tint', factor, category, reason);
      return `C4 WB shift risk: restrained temperature/tint toward zero (factor ${factor.toFixed(3)}).`;
    }
    case 'C5-harsh-clarity': {
      const factor = _restraintFactorForAction('cap-intensity', intensity);
      const reason = 'Harsh clarity/detail: restrained only positive clarity/dehaze — never made negative, never invented when absent.';
      _restrainPositiveOnly(workingModel, touchMap, 'clarity', factor, category, reason);
      _restrainPositiveOnly(workingModel, touchMap, 'dehaze', factor, category, reason);
      return `C5 harsh clarity/detail: restrained positive clarity/dehaze (factor ${factor.toFixed(3)}).`;
    }
    case 'C6-heavy-color-grading': {
      const factor = _restraintFactorForAction('suppress-risk', intensity);
      const reason = 'Heavy color grading: reduced shadow/highlight saturation magnitude, hue preserved — midtone saturation remains unsupported.';
      _restrainColorGradingTowardZero(workingModel, touchMap, 'shadowSat', factor, category, reason);
      _restrainColorGradingTowardZero(workingModel, touchMap, 'highlightSat', factor, category, reason);
      return `C6 heavy color grading: restrained shadow/highlight saturation toward zero (factor ${factor.toFixed(3)}), hue untouched.`;
    }
    case 'C9-overall-restraint': {
      const baseAction = actionEntry?.action === 'suppress-risk' ? 'suppress-risk' : 'cap-intensity';
      const factor = _restraintFactorForAction(baseAction, intensity);
      const reason = `Overall restraint (${baseAction}): restrained all currently-supported scalar Legacy fields toward zero — tone curve and color grading are never affected generically.`;
      for (const field of FLAT_FIELDS) _restrainTowardZero(workingModel, touchMap, field, factor, category, reason);
      return `C9 overall restraint: restrained all scalar fields toward zero (factor ${factor.toFixed(3)}).`;
    }
    default:
      return null;
  }
}

/** Mirrors the isolated renderer's own zero-check for Color Grading — a finite ZERO is real data but produces no visual change, so it must not be reported as "renderable"/"supported" after restraint pushes it to exactly 0. */
function _recomputeColorGradingRenderability(model) {
  const g = _isRecord(model.colorGrading) ? model.colorGrading : null;
  const shSat = g?.shadowSat;
  const hiSat = g?.highlightSat;
  const hasShadowSaturation = Number.isFinite(shSat) && shSat !== 0;
  const hasHighlightSaturation = Number.isFinite(hiSat) && hiSat !== 0;
  return hasShadowSaturation || hasHighlightSaturation;
}

function _deepCloneLegacyModel(legacy) {
  const clone = {};
  for (const field of FLAT_FIELDS) clone[field] = legacy[field] ?? null;
  clone.toneCurve = _isRecord(legacy.toneCurve) ? { ...legacy.toneCurve } : (legacy.toneCurve ?? null);
  clone.colorGrading = _isRecord(legacy.colorGrading) ? { ...legacy.colorGrading } : (legacy.colorGrading ?? null);
  clone.colorGradingCapability = _isRecord(legacy.colorGradingCapability) ? { ...legacy.colorGradingCapability } : null;
  return clone;
}

function _buildUnavailableResult(reasons, warnings = []) {
  return {
    mode: 'controlled-v2-browser-preview-translation',
    available: false,
    meaningful: false,
    translationMode: 'unavailable',
    baseSource: null,
    adjustmentModel: null,
    supportedAdjustments: [],
    unsupportedActions: [],
    appliedPolicies: [],
    changedFields: [],
    visualizedAdjustmentCount: 0,
    identityFallback: false,
    identityFallbackReason: null,
    confidence: 0.05,
    warnings,
    reasons,
    productionSafe: false,
    previewOnly: true,
    containsRealLightroomValues: false,
    containsXMPValues: false,
    appliedToProduction: false,
    exportEligible: false,
  };
}

/**
 * Main entry point.
 *
 * @param {object} input
 * @param {object} input.legacyAdjustmentModel - the REAL, already-normalized Legacy adjustment model (from `_buildLegacyAdjustmentModel` / `legacyRenderPlan.adjustmentModel`). Required — never mutated.
 * @param {object} [input.sandbox] - `controlledOverlayPreviewSandboxV2` (or an equivalent shape). Used for `canGeneratePreview` eligibility.
 * @param {object} [input.previewPlan] - `sandbox.previewPlan` (or supplied directly) — must contain `.actions[]`.
 * @param {object} [input.simulatedPreviewPreset] - `sandbox.simulatedPreviewPreset` (or supplied directly) — supplies per-action intensities.
 * @param {object} [input.previewRiskReview] - informational only; never alters the deterministic policy.
 * @param {object} [input.captureCapability] - informational only; never alters the deterministic policy.
 */
export function translateControlledV2PreviewAdjustments(input = {}) {
  const legacy = _isRecord(input?.legacyAdjustmentModel) ? input.legacyAdjustmentModel : null;
  if (!legacy) {
    return _buildUnavailableResult(['legacyAdjustmentModel is missing or invalid — Controlled V2 translation requires the real Legacy adjustment model as its base.']);
  }

  const sandbox = _isRecord(input?.sandbox) ? input.sandbox : null;
  const previewPlan = _isRecord(input?.previewPlan) ? input.previewPlan : (_isRecord(sandbox?.previewPlan) ? sandbox.previewPlan : null);
  const simulatedPreviewPreset = _isRecord(input?.simulatedPreviewPreset) ? input.simulatedPreviewPreset : (_isRecord(sandbox?.simulatedPreviewPreset) ? sandbox.simulatedPreviewPreset : null);

  // ── D3 UNAVAILABLE conditions ──────────────────────────────────────
  if (sandbox && sandbox.canGeneratePreview !== true) {
    return _buildUnavailableResult(['Sandbox reports canGeneratePreview !== true — preview generation is not eligible; Controlled V2 translation is unavailable until eligibility is met.']);
  }
  if (!previewPlan || !Array.isArray(previewPlan.actions)) {
    return _buildUnavailableResult(['previewPlan.actions is missing or malformed — cannot evaluate restraint evidence.']);
  }
  const rawActions = previewPlan.actions.filter(_isRecord);
  if (rawActions.length === 0) {
    return _buildUnavailableResult(['previewPlan.actions is empty — no restraint evidence to evaluate (a valid Sandbox always includes at least the default skin-protection action).']);
  }
  if (simulatedPreviewPreset && simulatedPreviewPreset.available === false) {
    return _buildUnavailableResult(['simulatedPreviewPreset.available === false — Sandbox is not yet eligible to produce preview evidence.']);
  }
  const hasHardStop = rawActions.some((a) => a.action === 'require-human-review');
  if (hasHardStop) {
    return _buildUnavailableResult(['A hard-stop safety action (require-human-review) is present in previewPlan.actions — Controlled V2 cannot produce a translated preview until the hard stop is resolved. Human Review cannot override this.']);
  }
  const contradictory = simulatedPreviewPreset?.appliedToProduction === true || simulatedPreviewPreset?.exportEligible === true;
  if (contradictory) {
    return _buildUnavailableResult(['V2 preview evidence is contradictory (appliedToProduction or exportEligible reports true) — blocking translation as a safety precaution; this should never happen upstream.']);
  }

  // ── Build the working (restrained) model, starting as an exact,
  // never-mutated-in-place copy of the real Legacy model ──────────────
  const workingModel = _deepCloneLegacyModel(legacy);
  const touchMap = new Map(); // field name -> { category, reason }
  const appliedPolicies = [];
  const unsupportedActions = [];
  const warnings = [];

  for (const actionEntry of rawActions) {
    const category = classifyControlledV2Action(actionEntry);
    if (category === 'hard-stop') continue; // already handled above (defensive, unreachable)
    if (category === 'no-op') continue;

    if (category === 'C7-calibration-unsupported') {
      unsupportedActions.push({
        action: actionEntry.action ?? null, tool: actionEntry.tool ?? null, channel: actionEntry.channel ?? null, target: actionEntry.target ?? null,
        reason: 'Calibration is not currently visualized by the isolated renderer — reported as unsupported; no pixel effect is claimed and no field is added to supportedAdjustments.',
      });
      continue;
    }
    if (category === 'C8-unknown-action') {
      unsupportedActions.push({
        action: actionEntry.action ?? null, tool: actionEntry.tool ?? null, channel: actionEntry.channel ?? null, target: actionEntry.target ?? null,
        reason: 'Unrecognized action/tool/channel/target combination — fails closed with no field changes; never generically applied to "all fields".',
      });
      continue;
    }

    const intensity = resolveControlledV2ActionIntensity(actionEntry, simulatedPreviewPreset);
    if (intensity === null) {
      unsupportedActions.push({
        action: actionEntry.action ?? null, tool: actionEntry.tool ?? null, channel: actionEntry.channel ?? null, target: actionEntry.target ?? null,
        reason: 'Could not resolve a valid 0-1 mitigation intensity (missing/out-of-range/non-finite evidence) — failed closed, no field changes applied.',
      });
      continue;
    }

    const policyDescription = _applyActionPolicy(category, actionEntry, intensity, workingModel, touchMap);
    if (policyDescription) appliedPolicies.push(policyDescription);
  }

  // Recompute Color Grading renderability/capability after restraint —
  // a restraint that pushes shadowSat/highlightSat to exactly 0 must
  // stop being reported as visually renderable, mirroring the pixel
  // renderer's own zero-check.
  const colorGradingRenderableAfter = _recomputeColorGradingRenderability(workingModel);
  if (_isRecord(workingModel.colorGradingCapability)) {
    workingModel.colorGradingCapability = {
      ...workingModel.colorGradingCapability,
      shadowSaturation: Number.isFinite(workingModel.colorGrading?.shadowSat) && workingModel.colorGrading.shadowSat !== 0,
      highlightSaturation: Number.isFinite(workingModel.colorGrading?.highlightSat) && workingModel.colorGrading.highlightSat !== 0,
    };
  }

  // ── Diff against the untouched Legacy model — only |delta| >= 0.005
  // counts as a genuine, meaningful visualized change. ─────────────────
  const changedFieldsAll = [];
  for (const field of FLAT_FIELDS) {
    const before = legacy[field] ?? null;
    const after = workingModel[field] ?? null;
    if (!Number.isFinite(before) || !Number.isFinite(after)) continue;
    const delta = after - before;
    if (Math.abs(delta) < CHANGE_EPSILON) continue;
    const touch = touchMap.get(field) ?? { category: null, reason: null };
    changedFieldsAll.push({ field, before: +before.toFixed(4), after: +after.toFixed(4), delta: +delta.toFixed(4), action: touch.category, reason: touch.reason });
  }
  for (const subfield of ['shadowSat', 'highlightSat']) {
    const before = _isRecord(legacy.colorGrading) ? (legacy.colorGrading[subfield] ?? null) : null;
    const after = _isRecord(workingModel.colorGrading) ? (workingModel.colorGrading[subfield] ?? null) : null;
    if (!Number.isFinite(before) || !Number.isFinite(after)) continue;
    const delta = after - before;
    if (Math.abs(delta) < CHANGE_EPSILON) continue;
    const touch = touchMap.get(`colorGrading.${subfield}`) ?? { category: null, reason: null };
    changedFieldsAll.push({ field: `colorGrading.${subfield}`, before: +before.toFixed(4), after: +after.toFixed(4), delta: +delta.toFixed(4), action: touch.category, reason: touch.reason });
  }

  const visualizedAdjustmentCount = changedFieldsAll.length;
  const meaningful = visualizedAdjustmentCount > 0;

  // supportedAdjustments: mirror the Legacy model's own supported/
  // unsupported classification for flat + toneCurve fields (these
  // never change eligibility — only magnitude), but recompute
  // colorGrading eligibility since restraint can zero it out.
  const supportedAdjustments = [];
  for (const field of FLAT_FIELDS) if (Number.isFinite(workingModel[field])) supportedAdjustments.push(field);
  if (_isRecord(workingModel.toneCurve)) supportedAdjustments.push('toneCurve');
  if (colorGradingRenderableAfter) supportedAdjustments.push('colorGrading');

  if (!meaningful) {
    // D2 IDENTITY FALLBACK — Sandbox valid, but no meaningful
    // renderer-supported field changed. adjustmentModel must contain no
    // fabricated change, i.e. must equal the Legacy model exactly.
    return {
      mode: 'controlled-v2-browser-preview-translation',
      available: true,
      meaningful: false,
      translationMode: 'identity-fallback',
      baseSource: 'legacy-preview-adjustment-model',
      adjustmentModel: { ...legacy },
      supportedAdjustments: [],
      unsupportedActions,
      appliedPolicies,
      changedFields: [],
      visualizedAdjustmentCount: 0,
      identityFallback: true,
      identityFallbackReason: unsupportedActions.length > 0
        ? 'Every restraint action present resolved to an unsupported/unknown category or a sub-epsilon change — no supported browser-visible field was meaningfully altered.'
        : 'No restraint action produced a change of at least 0.005 in any renderer-supported field — the current Legacy Preview already satisfies every present safety restraint.',
      confidence: 0.35,
      warnings: [...warnings, 'Controlled V2 rendered as an honest Identity fallback — this is not the final V2 appearance, only the current absence of a meaningful, renderer-supported safety restraint.'],
      reasons: ['Sandbox and Legacy model were both valid, but translation produced zero meaningful (>= 0.005) field changes.'],
      productionSafe: false,
      previewOnly: true,
      containsRealLightroomValues: false,
      containsXMPValues: false,
      appliedToProduction: false,
      exportEligible: false,
    };
  }

  // D1 MEANINGFUL TRANSLATION.
  const changedFields = changedFieldsAll.slice(0, 10);
  return {
    mode: 'controlled-v2-browser-preview-translation',
    available: true,
    meaningful: true,
    translationMode: 'legacy-derived-safety-restraint',
    baseSource: 'legacy-preview-adjustment-model',
    adjustmentModel: workingModel,
    supportedAdjustments,
    unsupportedActions,
    appliedPolicies,
    changedFields,
    visualizedAdjustmentCount,
    identityFallback: false,
    identityFallbackReason: null,
    confidence: +(Math.min(0.6, 0.3 + visualizedAdjustmentCount * 0.03)).toFixed(3),
    warnings: [...warnings, 'Controlled V2 values are bounded, restrained, browser-preview-only approximations derived from the current Legacy Preview — never real Lightroom, ACR, or XMP values, and never a Production result.'],
    reasons: [`Translated ${visualizedAdjustmentCount} field(s) with a meaningful (>= 0.005) change via ${appliedPolicies.length} applied polic(y/ies), derived from the real Legacy adjustment model.`],
    productionSafe: false,
    previewOnly: true,
    containsRealLightroomValues: false,
    containsXMPValues: false,
    appliedToProduction: false,
    exportEligible: false,
  };
}
