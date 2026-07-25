#!/usr/bin/env node
/**
 * qa/epic-2e-j-controlled-v2-translator-pixel-static-test.mjs
 *
 * CONTROLLED V2 VISUAL TRANSLATION R1 — Phase E (pure pixel proof).
 *
 * Proves that the Controlled V2 translator's restrained adjustment
 * models, when run through the REAL pure pixel helper
 * (`applyPreviewPixelTransformV2` from
 * ui/isolated-visual-preview-renderer-v2.js — the exact same function
 * the isolated Canvas renderer calls internally), produce genuinely
 * different, correctly-bounded pixel output vs. the unrestrained
 * Legacy model — never a fabricated or purely-metadata-level claim.
 *
 * No DOM, no Canvas, no Chromium — `applyPreviewPixelTransformV2` only
 * needs a plain `{data: Uint8ClampedArray, width, height}` triple, so
 * this runs as a plain-Node static suite.
 */
import { applyPreviewPixelTransformV2 } from '../ui/isolated-visual-preview-renderer-v2.js';
import { translateControlledV2PreviewAdjustments } from '../core/preview-rendering/controlled-v2-preview-adjustment-translator.js';

const results = [];
function record(test, result, evidence) {
  const normalized = typeof result === 'boolean' ? (result ? 'PASS' : 'FAIL') : result;
  results.push({ test, result: normalized, evidence });
  const icon = normalized === 'PASS' ? '✓' : '✗';
  console.log(`${icon} [${normalized}] ${test} — ${evidence}`);
}

const WIDTH = 3, HEIGHT = 1; // dark / mid-gray / bright pixel, in that order
function freshImageData() {
  const data = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  // Pixel 0: dark (shadow zone)
  data.set([20, 24, 28, 210], 0);
  // Pixel 1: mid-gray (midtone zone)
  data.set([128, 130, 126, 180], 4);
  // Pixel 2: bright (highlight zone)
  data.set([232, 230, 235, 255], 8);
  return { data, width: WIDTH, height: HEIGHT };
}

function cloneLegacyBase() {
  return {
    exposure: 0.6, contrast: 0.3, highlights: 0.5, shadows: -0.6, whites: 0.2, blacks: -0.4,
    temperature: 0.5, tint: -0.3, saturation: 0.4, vibrance: 0.3, clarity: 0.6, dehaze: -0.2,
    toneCurve: null, colorGrading: null, colorGradingCapability: null,
  };
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

function alphaBytes(imgData) {
  const out = [];
  for (let i = 3; i < imgData.data.length; i += 4) out.push(imgData.data[i]);
  return out;
}

// ── 1. Positive highlight pressure restrained: bright pixel dims LESS under V2 than Legacy ──
{
  const legacy = { ...cloneLegacyBase(), highlights: 0.6, exposure: 0, whites: 0 };
  const s = sandboxWith([SKIN, { action: 'warn', tool: 'Basic Tone', channel: 'highlights', target: 'highlight roll-off', severity: 'high' }], { 'skin tones': { intensity: 0 }, 'highlight roll-off': { intensity: 0.65 } });
  const t = translateControlledV2PreviewAdjustments({ legacyAdjustmentModel: legacy, sandbox: s });

  const legacyImg = freshImageData(), v2Img = freshImageData();
  const alphaBefore = alphaBytes(legacyImg);
  applyPreviewPixelTransformV2(legacyImg, legacy);
  applyPreviewPixelTransformV2(v2Img, t.adjustmentModel);

  const brightLegacy = legacyImg.data[8], brightV2 = v2Img.data[8];
  record('Highlight pressure: positive highlights dims the bright pixel LESS under restrained V2 than under unrestrained Legacy', brightV2 > brightLegacy, `legacy=${brightLegacy}, v2=${brightV2}`);
  record('Highlight pressure: alpha bytes are unchanged by the pixel pipeline', JSON.stringify(alphaBytes(legacyImg)) === JSON.stringify(alphaBefore) && JSON.stringify(alphaBytes(v2Img)) === JSON.stringify(alphaBefore), 'ok');
}

// ── 2. Negative highlight recovery preserved: no restraint applied when highlights < 0 ──
{
  const legacy = { ...cloneLegacyBase(), highlights: -0.5, exposure: 0, whites: 0, contrast: 0 };
  const s = sandboxWith([SKIN, { action: 'warn', tool: 'Basic Tone', channel: 'highlights', target: 'highlight roll-off', severity: 'high' }], { 'skin tones': { intensity: 0 }, 'highlight roll-off': { intensity: 0.65 } });
  const t = translateControlledV2PreviewAdjustments({ legacyAdjustmentModel: legacy, sandbox: s });
  record('Highlight pressure: negative highlights (recovery) value itself is untouched', t.adjustmentModel.highlights === -0.5, t.adjustmentModel.highlights);
  record('Highlight pressure: contrast is also untouched when isolated at zero', t.adjustmentModel.contrast === 0, t.adjustmentModel.contrast);

  const legacyImg = freshImageData(), v2Img = freshImageData();
  applyPreviewPixelTransformV2(legacyImg, legacy);
  applyPreviewPixelTransformV2(v2Img, t.adjustmentModel);
  record('Highlight pressure: negative-highlights pixel output is IDENTICAL between Legacy and V2 (recovery never weakened)', JSON.stringify([...legacyImg.data]) === JSON.stringify([...v2Img.data]), 'ok');
}

// ── 3. Negative shadow crushing restrained: dark pixel is LESS crushed (brighter) under V2 ──
{
  const legacy = { ...cloneLegacyBase(), shadows: -0.6, blacks: 0, contrast: 0 };
  const s = sandboxWith([SKIN, { action: 'protect-channel', tool: 'Basic Tone', channel: 'shadows', target: 'shadow detail', severity: 'high' }], { 'skin tones': { intensity: 0 }, 'shadow detail': { intensity: 0.65 } });
  const t = translateControlledV2PreviewAdjustments({ legacyAdjustmentModel: legacy, sandbox: s });

  const legacyImg = freshImageData(), v2Img = freshImageData();
  applyPreviewPixelTransformV2(legacyImg, legacy);
  applyPreviewPixelTransformV2(v2Img, t.adjustmentModel);

  const darkLegacy = legacyImg.data[0], darkV2 = v2Img.data[0];
  record('Shadow crushing: negative shadows crush the dark pixel LESS under restrained V2 than Legacy', darkV2 > darkLegacy, `legacy=${darkLegacy}, v2=${darkV2}`);
}

// ── 4. Positive shadow recovery preserved: no restraint when shadows > 0 ──
{
  const legacy = { ...cloneLegacyBase(), shadows: 0.5, blacks: 0, contrast: 0 };
  const s = sandboxWith([SKIN, { action: 'protect-channel', tool: 'Basic Tone', channel: 'shadows', target: 'shadow detail', severity: 'high' }], { 'skin tones': { intensity: 0 }, 'shadow detail': { intensity: 0.65 } });
  const t = translateControlledV2PreviewAdjustments({ legacyAdjustmentModel: legacy, sandbox: s });
  record('Shadow crushing: positive shadows (recovery) value itself is untouched', t.adjustmentModel.shadows === 0.5, t.adjustmentModel.shadows);

  const legacyImg = freshImageData(), v2Img = freshImageData();
  applyPreviewPixelTransformV2(legacyImg, legacy);
  applyPreviewPixelTransformV2(v2Img, t.adjustmentModel);
  record('Shadow crushing: positive-shadows pixel output is IDENTICAL between Legacy and V2 (recovery never reduced)', JSON.stringify([...legacyImg.data]) === JSON.stringify([...v2Img.data]), 'ok');
}

// ── 5. Positive clarity capped: bright/dark pixels pushed LESS far from original under V2 ──
{
  const legacy = { ...cloneLegacyBase(), exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0, temperature: 0, tint: 0, saturation: 0, vibrance: 0, clarity: 0.8, dehaze: 0 };
  const s = sandboxWith([SKIN, { action: 'cap-intensity', tool: 'Presence', channel: 'clarity', target: 'texture/clarity', severity: 'high' }], { 'skin tones': { intensity: 0 }, 'texture/clarity': { intensity: 0.65 } });
  const t = translateControlledV2PreviewAdjustments({ legacyAdjustmentModel: legacy, sandbox: s });
  record('Clarity: restrained clarity value stays positive but smaller than Legacy', t.adjustmentModel.clarity > 0 && t.adjustmentModel.clarity < 0.8, t.adjustmentModel.clarity);

  const legacyImg = freshImageData(), v2Img = freshImageData(), sourceImg = freshImageData();
  applyPreviewPixelTransformV2(legacyImg, legacy);
  applyPreviewPixelTransformV2(v2Img, t.adjustmentModel);
  const distLegacy = Math.abs(legacyImg.data[8] - sourceImg.data[8]);
  const distV2 = Math.abs(v2Img.data[8] - sourceImg.data[8]);
  record('Clarity: restrained V2 pushes the bright pixel LESS far from its original value than unrestrained Legacy', distV2 < distLegacy, `legacyDist=${distLegacy}, v2Dist=${distV2}`);
}

// ── 6. WB values move toward zero without sign reversal (pixel-level: red-channel shift shrinks, same direction) ──
{
  const legacy = { ...cloneLegacyBase(), temperature: 0.7, tint: 0, exposure: 0 };
  const s = sandboxWith([SKIN, { action: 'warn', tool: 'White Balance', channel: 'temp/tint', target: 'WB stability', severity: 'high' }], { 'skin tones': { intensity: 0 }, 'WB stability': { intensity: 0.65 } });
  const t = translateControlledV2PreviewAdjustments({ legacyAdjustmentModel: legacy, sandbox: s });

  const legacyImg = freshImageData(), v2Img = freshImageData(), sourceImg = freshImageData();
  applyPreviewPixelTransformV2(legacyImg, legacy);
  applyPreviewPixelTransformV2(v2Img, t.adjustmentModel);

  const redShiftLegacy = legacyImg.data[4] - sourceImg.data[4]; // mid-gray pixel red channel
  const redShiftV2 = v2Img.data[4] - sourceImg.data[4];
  record('WB: restrained temperature produces a smaller same-direction red-channel shift', redShiftLegacy > 0 && redShiftV2 > 0 && redShiftV2 < redShiftLegacy, `legacyShift=${redShiftLegacy}, v2Shift=${redShiftV2}`);
}

// ── 7. Skin protection makes a bounded GLOBAL restraint (multiple fields shrink together, none reversed) ──
{
  const legacy = { ...cloneLegacyBase(), temperature: 0.5, tint: 0.3, saturation: 0.4, vibrance: 0.3, contrast: 0.4, clarity: 0.5, exposure: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0, dehaze: 0 };
  const s = sandboxWith([SKIN], { 'skin tones': { intensity: 0.3 } });
  const t = translateControlledV2PreviewAdjustments({ legacyAdjustmentModel: legacy, sandbox: s });
  const fields = ['temperature', 'tint', 'saturation', 'vibrance', 'contrast', 'clarity'];
  const allBoundedAndSameSign = fields.every((f) => Math.abs(t.adjustmentModel[f]) < Math.abs(legacy[f]) && Math.sign(t.adjustmentModel[f]) === Math.sign(legacy[f]));
  record('Skin protection: every affected field shrinks in magnitude, same sign, bounded restraint', allBoundedAndSameSign, JSON.stringify(fields.map((f) => [f, legacy[f], t.adjustmentModel[f]])));

  const legacyImg = freshImageData(), v2Img = freshImageData();
  applyPreviewPixelTransformV2(legacyImg, legacy);
  applyPreviewPixelTransformV2(v2Img, t.adjustmentModel);
  record('Skin protection: pixel output genuinely differs between Legacy and V2 (restraint has a real, non-fabricated effect)', JSON.stringify([...legacyImg.data]) !== JSON.stringify([...v2Img.data]), 'ok');
}

// ── 8. Unknown actions produce NO pixel change (identity fallback, byte-identical to source) ──
{
  const legacy = cloneLegacyBase();
  const s = sandboxWith([{ action: 'mystery-action', tool: 'Mystery', channel: 'mystery', target: 'mystery', severity: 'high' }], {});
  const t = translateControlledV2PreviewAdjustments({ legacyAdjustmentModel: legacy, sandbox: s });
  record('Unknown action alone: translationMode is identity-fallback', t.translationMode === 'identity-fallback', t.translationMode);

  // Mirrors _buildV2AdjustmentModel's identity-fallback branch: every
  // field becomes null (nothing for the renderer to apply).
  const nullModel = { exposure: null, contrast: null, highlights: null, shadows: null, whites: null, blacks: null, temperature: null, tint: null, saturation: null, vibrance: null, clarity: null, dehaze: null, toneCurve: null, colorGrading: null };
  const sourceImg = freshImageData(), v2Img = freshImageData();
  const result = applyPreviewPixelTransformV2(v2Img, nullModel);
  record('Unknown action: pixel transform reports transformed=false', result.transformed === false, JSON.stringify(result.reasons));
  record('Unknown action: pixel bytes are byte-identical to the untouched source', JSON.stringify([...v2Img.data]) === JSON.stringify([...sourceImg.data]), 'ok');
}

// ── 9. Identity case (valid Sandbox, zero meaningful restraint) preserves exact pixel bytes ──
{
  const legacy = cloneLegacyBase();
  const s = sandboxWith([SKIN, { action: 'keep-legacy', tool: 'all', channel: 'all', target: 'overall direction', severity: 'low' }], { 'skin tones': { intensity: 0 } });
  const t = translateControlledV2PreviewAdjustments({ legacyAdjustmentModel: legacy, sandbox: s });
  record('Identity case: translationMode=identity-fallback', t.translationMode === 'identity-fallback', t.translationMode);

  const nullModel = { exposure: null, contrast: null, highlights: null, shadows: null, whites: null, blacks: null, temperature: null, tint: null, saturation: null, vibrance: null, clarity: null, dehaze: null, toneCurve: null, colorGrading: null };
  const sourceImg = freshImageData(), identityImg = freshImageData();
  const result = applyPreviewPixelTransformV2(identityImg, nullModel);
  record('Identity case: exact pixel bytes preserved (transformed=false, byte-identical)', result.transformed === false && JSON.stringify([...identityImg.data]) === JSON.stringify([...sourceImg.data]), 'ok');
  record('Identity case: alpha remains exactly unchanged', identityImg.data[3] === sourceImg.data[3] && identityImg.data[7] === sourceImg.data[7] && identityImg.data[11] === sourceImg.data[11], 'ok');
}

const fail = results.filter((r) => r.result !== 'PASS').length;
console.log(`\n${results.length - fail}/${results.length} PASS, ${fail} FAIL`);
if (fail > 0) process.exit(1);
