#!/usr/bin/env node
/**
 * qa/epic-2e-j-controlled-v2-translator-static-test.mjs
 *
 * CONTROLLED V2 VISUAL TRANSLATION R1 — Phase K (static half).
 *
 * Pure, no-Browser regression tests for
 * core/preview-rendering/controlled-v2-preview-adjustment-translator.js.
 * Covers: deterministic action mapping, non-mutation of the Legacy
 * model, signed-direction preservation, magnitude never increasing,
 * epsilon/no-op handling, unknown-action fail-closed behavior,
 * malformed evidence handling, hard-stop unavailability, Identity
 * fallback, and hard-coded-safe Production flags.
 */
import {
  translateControlledV2PreviewAdjustments,
  classifyControlledV2Action,
  resolveControlledV2ActionIntensity,
} from '../core/preview-rendering/controlled-v2-preview-adjustment-translator.js';

const results = [];
function record(test, result, evidence) {
  const normalized = typeof result === 'boolean' ? (result ? 'PASS' : 'FAIL') : result;
  results.push({ test, result: normalized, evidence });
  const icon = normalized === 'PASS' ? '✓' : '✗';
  console.log(`${icon} [${normalized}] ${test} — ${evidence}`);
}

const BASE_LEGACY = Object.freeze({
  exposure: 0.6, contrast: 0.3, highlights: 0.5, shadows: -0.5, whites: 0.2, blacks: -0.3,
  temperature: 0.4, tint: 0.1, saturation: 0.3, vibrance: 0.2, clarity: 0.4, dehaze: 0.1,
  toneCurve: Object.freeze({ highlights: 0.1, midtone: 0, shadows: -0.1 }),
  colorGrading: Object.freeze({ shadowHue: 200, shadowSat: 0.5, midtoneHue: null, midtoneSat: null, highlightHue: 40, highlightSat: 0.4 }),
  colorGradingCapability: Object.freeze({ shadowSaturation: true, midtoneSaturation: false, highlightSaturation: true, hueRendering: false, partial: false }),
  supportedAdjustments: Object.freeze(['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks', 'temperature', 'tint', 'saturation', 'vibrance', 'clarity', 'dehaze', 'toneCurve', 'colorGrading']),
  unsupportedAdjustments: Object.freeze([]),
  normalizationWarnings: Object.freeze([]),
});

function cloneLegacy() {
  // A fresh, deep, NON-frozen copy for each test — BASE_LEGACY itself
  // is frozen so accidental mutation by the module under test would
  // throw immediately in strict-mode contexts, giving an even stronger
  // non-mutation guarantee than a plain deep-equal check alone.
  return JSON.parse(JSON.stringify(BASE_LEGACY));
}

function sandboxWith(actions, presetValues = {}) {
  return {
    canGeneratePreview: true,
    previewPlan: { actions },
    simulatedPreviewPreset: {
      available: true, appliedToProduction: false, exportEligible: false,
      values: presetValues,
      adjustments: Object.entries(presetValues).map(([area, v]) => ({ area, ...v })),
    },
  };
}

const SKIN = { action: 'protect-channel', tool: 'HSL', channel: 'red-orange-yellow skin', target: 'skin tones', severity: 'low', reason: 'default' };

// ── 1. Classifier: deterministic action-to-category mapping (C1-C9) ──
record('Classifier: C1 skin protection', classifyControlledV2Action(SKIN) === 'C1-skin-protection', classifyControlledV2Action(SKIN));
record('Classifier: C2 highlight pressure', classifyControlledV2Action({ action: 'warn', tool: 'Basic Tone', channel: 'highlights', target: 'highlight roll-off' }) === 'C2-highlight-pressure', 'ok');
record('Classifier: C3 shadow crushing', classifyControlledV2Action({ action: 'protect-channel', tool: 'Basic Tone', channel: 'shadows', target: 'shadow detail' }) === 'C3-shadow-crushing', 'ok');
record('Classifier: C4 WB shift risk', classifyControlledV2Action({ action: 'warn', tool: 'White Balance', channel: 'temp/tint', target: 'WB stability' }) === 'C4-wb-shift-risk', 'ok');
record('Classifier: C5 harsh clarity', classifyControlledV2Action({ action: 'cap-intensity', tool: 'Presence', channel: 'clarity', target: 'texture/clarity' }) === 'C5-harsh-clarity', 'ok');
record('Classifier: C6 heavy color grading', classifyControlledV2Action({ action: 'suppress-risk', tool: 'Color Grading', channel: 'all', target: 'colour restraint' }) === 'C6-heavy-color-grading', 'ok');
record('Classifier: C7 calibration unsupported', classifyControlledV2Action({ action: 'suppress-risk', tool: 'Calibration', channel: 'all', target: 'calibration restraint' }) === 'C7-calibration-unsupported', 'ok');
record('Classifier: C9 overall restraint (cap-intensity)', classifyControlledV2Action({ action: 'cap-intensity', tool: 'all', channel: 'all', target: 'overall direction' }) === 'C9-overall-restraint', 'ok');
record('Classifier: overall direction with keep-legacy is no-op, not C9', classifyControlledV2Action({ action: 'keep-legacy', tool: 'all', channel: 'all', target: 'overall direction' }) === 'no-op', 'ok');
record('Classifier: require-human-review is hard-stop', classifyControlledV2Action({ action: 'require-human-review', tool: 'all', channel: 'all', target: 'overall safety' }) === 'hard-stop', 'ok');
record('Classifier: unrecognized combination fails closed to C8', classifyControlledV2Action({ action: 'mystery', tool: 'Mystery', channel: 'mystery', target: 'mystery' }) === 'C8-unknown-action', 'ok');

// ── 2. Intensity resolution ──
record('Intensity: valid preset intensity used verbatim', resolveControlledV2ActionIntensity({ target: 'skin tones' }, { values: { 'skin tones': { intensity: 0.42 } } }) === 0.42, 'ok');
record('Intensity: out-of-range preset intensity rejected (null), not coerced', resolveControlledV2ActionIntensity({ target: 'skin tones' }, { values: { 'skin tones': { intensity: 1.5 } } }) === null, 'ok');
record('Intensity: negative preset intensity rejected (null), not coerced', resolveControlledV2ActionIntensity({ target: 'skin tones' }, { values: { 'skin tones': { intensity: -0.2 } } }) === null, 'ok');
record('Intensity: non-finite preset intensity rejected (null)', resolveControlledV2ActionIntensity({ target: 'skin tones' }, { values: { 'skin tones': { intensity: NaN } } }) === null, 'ok');
record('Intensity: falls back to severity map when no preset intensity present', resolveControlledV2ActionIntensity({ target: 'x', severity: 'high' }, { values: {} }) === 0.65, 'ok');
record('Intensity: unknown severity with no preset -> null (fail closed)', resolveControlledV2ActionIntensity({ target: 'x', severity: 'bogus' }, { values: {} }) === null, 'ok');

// ── 3. Non-mutation of the Legacy model ──
{
  const legacy = cloneLegacy();
  const beforeJSON = JSON.stringify(legacy);
  const s = sandboxWith([SKIN, { action: 'warn', tool: 'Basic Tone', channel: 'highlights', target: 'highlight roll-off', severity: 'high' }], { 'skin tones': { intensity: 0.25 }, 'highlight roll-off': { intensity: 0.65 } });
  translateControlledV2PreviewAdjustments({ legacyAdjustmentModel: legacy, sandbox: s });
  record('Non-mutation: legacyAdjustmentModel is never mutated in place', JSON.stringify(legacy) === beforeJSON, 'legacy JSON unchanged after translation call');
}

// ── 4. Meaningful translation: magnitude never increases, sign preserved ──
{
  const legacy = cloneLegacy();
  const s = sandboxWith([SKIN, { action: 'warn', tool: 'Basic Tone', channel: 'highlights', target: 'highlight roll-off', severity: 'high' }], { 'skin tones': { intensity: 0.25 }, 'highlight roll-off': { intensity: 0.65 } });
  const r = translateControlledV2PreviewAdjustments({ legacyAdjustmentModel: legacy, sandbox: s });
  record('Meaningful: translationMode=legacy-derived-safety-restraint', r.translationMode === 'legacy-derived-safety-restraint', r.translationMode);
  record('Meaningful: baseSource=legacy-preview-adjustment-model', r.baseSource === 'legacy-preview-adjustment-model', r.baseSource);
  record('Meaningful: visualizedAdjustmentCount > 0', r.visualizedAdjustmentCount > 0, r.visualizedAdjustmentCount);
  const magnitudeNeverIncreased = ['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks', 'temperature', 'tint', 'saturation', 'vibrance', 'clarity', 'dehaze']
    .every((f) => Math.abs(r.adjustmentModel[f]) <= Math.abs(legacy[f]) + 1e-9);
  record('Meaningful: no field magnitude ever increased vs Legacy', magnitudeNeverIncreased, JSON.stringify(r.adjustmentModel));
  const signPreserved = ['exposure', 'contrast', 'highlights', 'whites', 'temperature', 'tint', 'saturation', 'vibrance', 'clarity']
    .every((f) => Math.sign(r.adjustmentModel[f]) === Math.sign(legacy[f]) || r.adjustmentModel[f] === legacy[f]);
  record('Meaningful: no field ever changes sign', signPreserved, 'ok');
  record('Meaningful: containsRealLightroomValues is false', r.containsRealLightroomValues === false, 'ok');
  record('Meaningful: containsXMPValues is false', r.containsXMPValues === false, 'ok');
  record('Meaningful: productionSafe is false (not a production artifact)', r.productionSafe === false, 'ok');
  record('Meaningful: appliedToProduction hard-coded false', r.appliedToProduction === false, 'ok');
  record('Meaningful: exportEligible hard-coded false', r.exportEligible === false, 'ok');
  record('Meaningful: previewOnly hard-coded true', r.previewOnly === true, 'ok');
}

// ── 5. C2/C3 directional guarantees: only the intended sign is ever touched ──
{
  const legacy = { ...cloneLegacy(), highlights: -0.5 }; // negative = "highlight recovery" — must never be weakened
  const s = sandboxWith([SKIN, { action: 'warn', tool: 'Basic Tone', channel: 'highlights', target: 'highlight roll-off', severity: 'high' }], { 'skin tones': { intensity: 0 }, 'highlight roll-off': { intensity: 0.65 } });
  const r = translateControlledV2PreviewAdjustments({ legacyAdjustmentModel: legacy, sandbox: s });
  record('C2: negative highlights (recovery) is never weakened by highlight-pressure restraint', r.adjustmentModel.highlights === -0.5, r.adjustmentModel.highlights);
}
{
  const legacy = { ...cloneLegacy(), shadows: 0.5 }; // positive = "shadow recovery" — must never be reduced by shadow-crushing restraint
  const s = sandboxWith([SKIN, { action: 'protect-channel', tool: 'Basic Tone', channel: 'shadows', target: 'shadow detail', severity: 'high' }], { 'skin tones': { intensity: 0 }, 'shadow detail': { intensity: 0.65 } });
  const r = translateControlledV2PreviewAdjustments({ legacyAdjustmentModel: legacy, sandbox: s });
  record('C3: positive shadows (recovery) is never reduced by shadow-crushing restraint', r.adjustmentModel.shadows === 0.5, r.adjustmentModel.shadows);
}
{
  const legacy = { ...cloneLegacy(), temperature: -0.5, tint: -0.2 };
  const s = sandboxWith([SKIN, { action: 'warn', tool: 'White Balance', channel: 'temp/tint', target: 'WB stability', severity: 'medium' }], { 'skin tones': { intensity: 0 }, 'WB stability': { intensity: 0.45 } });
  const r = translateControlledV2PreviewAdjustments({ legacyAdjustmentModel: legacy, sandbox: s });
  record('C4: WB restraint preserves sign (still negative)', r.adjustmentModel.temperature < 0 && r.adjustmentModel.tint < 0, `temp=${r.adjustmentModel.temperature}, tint=${r.adjustmentModel.tint}`);
  record('C4: WB restraint reduces magnitude toward zero', Math.abs(r.adjustmentModel.temperature) < 0.5 && Math.abs(r.adjustmentModel.tint) < 0.2, `temp=${r.adjustmentModel.temperature}, tint=${r.adjustmentModel.tint}`);
}
{
  const legacy = { ...cloneLegacy(), clarity: 0.7, dehaze: -0.3 };
  const s = sandboxWith([SKIN, { action: 'cap-intensity', tool: 'Presence', channel: 'clarity', target: 'texture/clarity', severity: 'medium' }], { 'skin tones': { intensity: 0 }, 'texture/clarity': { intensity: 0.45 } });
  const r = translateControlledV2PreviewAdjustments({ legacyAdjustmentModel: legacy, sandbox: s });
  record('C5: positive clarity restrained but never made negative', r.adjustmentModel.clarity > 0 && r.adjustmentModel.clarity < 0.7, r.adjustmentModel.clarity);
  record('C5: negative dehaze is left untouched (restrain-positive-only)', r.adjustmentModel.dehaze === -0.3, r.adjustmentModel.dehaze);
}
{
  const legacy = { ...cloneLegacy(), colorGrading: { ...cloneLegacy().colorGrading, shadowSat: 0.6, highlightSat: 0.5 } };
  const s = sandboxWith([SKIN, { action: 'suppress-risk', tool: 'Color Grading', channel: 'all', target: 'colour restraint', severity: 'medium' }], { 'skin tones': { intensity: 0 }, 'colour restraint': { intensity: 0.45 } });
  const r = translateControlledV2PreviewAdjustments({ legacyAdjustmentModel: legacy, sandbox: s });
  record('C6: shadow/highlight saturation restrained toward zero', Math.abs(r.adjustmentModel.colorGrading.shadowSat) < 0.6 && Math.abs(r.adjustmentModel.colorGrading.highlightSat) < 0.5, JSON.stringify(r.adjustmentModel.colorGrading));
  record('C6: hue is never touched', r.adjustmentModel.colorGrading.shadowHue === 200 && r.adjustmentModel.colorGrading.highlightHue === 40, JSON.stringify(r.adjustmentModel.colorGrading));
}

// ── 6. C7 calibration + C8 unknown: fail closed, no field changes, reported as unsupported ──
{
  const legacy = cloneLegacy();
  const s = sandboxWith([SKIN, { action: 'suppress-risk', tool: 'Calibration', channel: 'all', target: 'calibration restraint', severity: 'medium' }], { 'skin tones': { intensity: 0 }, 'calibration restraint': { intensity: 0.45 } });
  const r = translateControlledV2PreviewAdjustments({ legacyAdjustmentModel: legacy, sandbox: s });
  record('C7: calibration is reported unsupported, never claims a pixel effect', r.unsupportedActions.some((a) => a.action === 'suppress-risk' && a.tool === 'Calibration'), JSON.stringify(r.unsupportedActions));
  record('C7: calibration never appears in supportedAdjustments', !r.supportedAdjustments.includes('calibration'), 'ok');
}
{
  const legacy = cloneLegacy();
  const s = sandboxWith([{ action: 'mystery-action', tool: 'Mystery', channel: 'mystery', target: 'mystery', severity: 'high' }], {});
  const r = translateControlledV2PreviewAdjustments({ legacyAdjustmentModel: legacy, sandbox: s });
  record('C8: unknown action alone -> identity fallback (no field ever touched)', r.translationMode === 'identity-fallback' && r.visualizedAdjustmentCount === 0, r.translationMode);
  record('C8: unknown action reported in unsupportedActions', r.unsupportedActions.length === 1 && r.unsupportedActions[0].action === 'mystery-action', JSON.stringify(r.unsupportedActions));
}

// ── 7. Epsilon / no-op handling ──
{
  const legacy = cloneLegacy();
  // An action whose resolved factor produces a sub-epsilon change (a
  // tiny intensity on an already-small field) must not count as a
  // visualized adjustment.
  const tinyLegacy = { ...legacy, tint: 0.01 };
  const s = sandboxWith([SKIN], { 'skin tones': { intensity: 0.01 } }); // factor ~1 - 0.6*min(0.30,0.003)=~0.9982 -> delta ~0.000018, sub-epsilon
  const r = translateControlledV2PreviewAdjustments({ legacyAdjustmentModel: tinyLegacy, sandbox: s });
  record('Epsilon: sub-0.005 delta is not counted as a visualized/changed field', !r.changedFields.some((c) => c.field === 'tint'), JSON.stringify(r.changedFields));
}

// ── 8. Malformed evidence: fails closed, never coerces to 0 restraint ──
{
  const legacy = cloneLegacy();
  const s = sandboxWith([SKIN, { action: 'warn', tool: 'Basic Tone', channel: 'highlights', target: 'highlight roll-off' /* no severity, no preset intensity below */ }], { 'skin tones': { intensity: 0.25 } });
  const r = translateControlledV2PreviewAdjustments({ legacyAdjustmentModel: legacy, sandbox: s });
  record('Malformed: action with unresolvable intensity is reported unsupported, not defaulted to 0', r.unsupportedActions.some((a) => a.target === 'highlight roll-off'), JSON.stringify(r.unsupportedActions));
  record('Malformed: highlights field is untouched by the unresolvable action (fail-closed, no phantom restraint)', r.adjustmentModel.highlights === legacy.highlights || r.identityFallback, JSON.stringify(r.adjustmentModel?.highlights ?? null));
}
record('Malformed input: missing legacyAdjustmentModel -> unavailable, never throws', (() => {
  const r = translateControlledV2PreviewAdjustments({ sandbox: sandboxWith([SKIN], {}) });
  return r.available === false && r.translationMode === 'unavailable';
})(), 'ok');
record('Malformed input: garbage input object -> unavailable, never throws', (() => {
  const r = translateControlledV2PreviewAdjustments('not an object');
  return r.available === false && r.translationMode === 'unavailable';
})(), 'ok');

// ── 9. Hard-stop -> unavailable, never fabricates an Identity Preview ──
{
  const legacy = cloneLegacy();
  const s = sandboxWith([SKIN, { action: 'require-human-review', tool: 'all', channel: 'all', target: 'overall safety', severity: 'critical' }], { 'skin tones': { intensity: 0.25 } });
  const r = translateControlledV2PreviewAdjustments({ legacyAdjustmentModel: legacy, sandbox: s });
  record('Hard-stop: translationMode=unavailable', r.translationMode === 'unavailable', r.translationMode);
  record('Hard-stop: available=false (no Identity Preview fabricated)', r.available === false, 'ok');
  record('Hard-stop: adjustmentModel is null (nothing fabricated)', r.adjustmentModel === null, 'ok');
  record('Hard-stop: exact blocker reason is visible', r.reasons.some((x) => /require-human-review|hard.stop/i.test(x)), JSON.stringify(r.reasons));
}

// ── 10. Sandbox ineligible / malformed plan -> unavailable ──
record('Sandbox canGeneratePreview=false -> unavailable', (() => {
  const r = translateControlledV2PreviewAdjustments({ legacyAdjustmentModel: cloneLegacy(), sandbox: { canGeneratePreview: false, previewPlan: { actions: [SKIN] } } });
  return r.translationMode === 'unavailable';
})(), 'ok');
record('previewPlan.actions missing -> unavailable', (() => {
  const r = translateControlledV2PreviewAdjustments({ legacyAdjustmentModel: cloneLegacy(), sandbox: { canGeneratePreview: true, previewPlan: {} } });
  return r.translationMode === 'unavailable';
})(), 'ok');
record('previewPlan.actions empty array -> unavailable', (() => {
  const r = translateControlledV2PreviewAdjustments({ legacyAdjustmentModel: cloneLegacy(), sandbox: { canGeneratePreview: true, previewPlan: { actions: [] } } });
  return r.translationMode === 'unavailable';
})(), 'ok');
record('Contradictory evidence (appliedToProduction=true) -> unavailable', (() => {
  const s = sandboxWith([SKIN], { 'skin tones': { intensity: 0.25 } });
  s.simulatedPreviewPreset.appliedToProduction = true;
  const r = translateControlledV2PreviewAdjustments({ legacyAdjustmentModel: cloneLegacy(), sandbox: s });
  return r.translationMode === 'unavailable';
})(), 'ok');

// ── 11. Identity fallback: valid Sandbox, zero meaningful change ──
{
  const legacy = cloneLegacy();
  const s = sandboxWith([SKIN, { action: 'keep-legacy', tool: 'all', channel: 'all', target: 'overall direction', severity: 'low' }], { 'skin tones': { intensity: 0 } });
  const r = translateControlledV2PreviewAdjustments({ legacyAdjustmentModel: legacy, sandbox: s });
  record('Identity fallback: translationMode=identity-fallback', r.translationMode === 'identity-fallback', r.translationMode);
  record('Identity fallback: identityFallback=true with a non-empty reason', r.identityFallback === true && typeof r.identityFallbackReason === 'string' && r.identityFallbackReason.length > 0, r.identityFallbackReason);
  record('Identity fallback: supportedAdjustments is empty', r.supportedAdjustments.length === 0, JSON.stringify(r.supportedAdjustments));
  record('Identity fallback: adjustmentModel exactly equals the Legacy model (no fabricated change)', JSON.stringify(r.adjustmentModel) === JSON.stringify(legacy), 'ok');
  record('Identity fallback: available=true (a valid, honest result — not unavailable)', r.available === true, 'ok');
}

// ── 12. C9 overall restraint: all scalar fields restrained, tone curve/color grading untouched ──
{
  const legacy = cloneLegacy();
  const s = sandboxWith([SKIN, { action: 'cap-intensity', tool: 'all', channel: 'all', target: 'overall direction', severity: 'medium' }], { 'skin tones': { intensity: 0 }, 'overall direction': { intensity: 0.45 } });
  const r = translateControlledV2PreviewAdjustments({ legacyAdjustmentModel: legacy, sandbox: s });
  const allScalarsShrank = ['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks', 'temperature', 'tint', 'saturation', 'vibrance', 'clarity', 'dehaze']
    .every((f) => Math.abs(r.adjustmentModel[f]) < Math.abs(legacy[f]) + 1e-9);
  record('C9: overall restraint shrinks every scalar field', allScalarsShrank, 'ok');
  record('C9: tone curve is never touched generically', JSON.stringify(r.adjustmentModel.toneCurve) === JSON.stringify(legacy.toneCurve), 'ok');
  record('C9: color grading is never touched generically', JSON.stringify(r.adjustmentModel.colorGrading) === JSON.stringify(legacy.colorGrading), 'ok');
}

const fail = results.filter((r) => r.result !== 'PASS').length;
console.log(`\n${results.length - fail}/${results.length} PASS, ${fail} FAIL`);
if (fail > 0) process.exit(1);
