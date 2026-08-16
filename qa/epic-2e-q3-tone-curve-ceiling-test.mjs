#!/usr/bin/env node
/**
 * EPIC 2E-Q3 — Tone Curve Transfer Strength Ceiling.
 *
 * Third finding from the "RCM presets are close to a no-op" investigation
 * (Q1: white balance base value silently missing; Q2: white balance
 * confidence-cliff crushing a real difference). This round explains a
 * symptom Q1/Q2 did not touch: the user's original screenshot showed the
 * Tone Curve panel essentially linear/near-default.
 *
 * The tone curve pipeline already dampens its own output twice before
 * lightroom-candidate-mapper.js gets it: tone-curve-transfer-engine.js's
 * _deriveMappingCurve() applies mode-based shadow/highlight rolloff,
 * graduated endpoint dampening (as low as 0.2x), smoothing, and
 * intensity; perceptual-pixel-transfer-engine.js's monotonic() then
 * hard-caps every point's shift (+-22 master / +-4 endpoints, +-9/+-3
 * for R/G/B). On TOP of both of those, protectPixelTransferCurves()
 * applied a THIRD, independently-derived scale (baseScale) -- capped at
 * a flat ceiling of 0.78 no matter how large or well-evidenced the real
 * difference was. A genuinely large, unmistakable, safe-to-transfer
 * tonal difference could never express more than roughly three-quarters
 * strength, regardless of the user's own Intensity setting.
 *
 * This suite proves: (1) the ceiling is now 0.95, not 0.78, for
 * well-evidenced (matchNeedScore above the ramp point) cases, (2) the
 * floor (0.32) and the matchNeed-proportional ramp are byte-identical to
 * before, (3) neutral-white/high-key target protection is completely
 * unaffected, and (4) per-channel R/G/B curve conservatism (channelScale)
 * is completely unaffected -- only the master curve's ceiling changed.
 */
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log(`✓ [PASS] ${name}`); }
  catch (error) { console.error(`✗ [FAIL] ${name}\n${error.stack}`); process.exitCode = 1; }
}
const read = rel => fs.readFile(path.join(ROOT, rel), 'utf8');

const { buildCoreColorMatchAnalysis } = await import(path.join(ROOT, 'core/color-match/core-color-match-analysis.js'));
const { buildPhotographicCompensation } = await import(path.join(ROOT, 'core/color-match/photographic-compensation-engine.js'));
const { mapCompensationToLightroomCandidate } = await import(path.join(ROOT, 'core/color-match/lightroom-candidate-mapper.js'));

function buildLargeDifferenceAnalysis() {
  const refTone = {
    shadow: { avgColor: { r: 120, g: 100, b: 70 }, temperatureHint: 30, tintHint: 3, pixelShare: 0.3 },
    midtone: { avgColor: { r: 200, g: 175, b: 130 }, temperatureHint: 34, tintHint: 2, pixelShare: 0.5 },
    highlight: { avgColor: { r: 245, g: 230, b: 195 }, temperatureHint: 26, tintHint: 1, pixelShare: 0.2 },
    contrast: 24, blackPoint: 30, whitePoint: 250,
  };
  const tgtTone = {
    shadow: { avgColor: { r: 20, g: 22, b: 26 }, temperatureHint: -18, tintHint: -3, pixelShare: 0.3 },
    midtone: { avgColor: { r: 100, g: 104, b: 112 }, temperatureHint: -16, tintHint: -2, pixelShare: 0.5 },
    highlight: { avgColor: { r: 205, g: 208, b: 214 }, temperatureHint: -10, tintHint: -1, pixelShare: 0.2 },
    contrast: 60, blackPoint: 2, whitePoint: 238,
  };
  const palette = h => ({ confidence: 0.85, colors: [
    { weight: 0.4, hsl: { h, s: 35, l: 55 } },
    { weight: 0.3, hsl: { h: (h + 180) % 360, s: 20, l: 45 } },
    { weight: 0.3, hsl: { h: 0, s: 4, l: 78 } },
  ] });
  return buildCoreColorMatchAnalysis({
    reference: { palette: palette(30), toneZones: refTone, skinAnalysis: { detected: false }, histogram: { clipHiPct: 0.1, clipLoPct: 0.1, drStops: 9 } },
    target: { palette: palette(210), toneZones: tgtTone, skinAnalysis: { detected: false }, histogram: { clipHiPct: 0.1, clipLoPct: 0.1, drStops: 9 } },
    analysisGenerationId: 'q3-fixture',
  });
}

const samplePixelTransfer = {
  curves: {
    master: [{ x: 0, y: 18 }, { x: 64, y: 96 }, { x: 128, y: 156 }, { x: 192, y: 210 }, { x: 255, y: 250 }],
    red: [{ x: 0, y: 2 }, { x: 128, y: 132 }, { x: 255, y: 254 }],
    green: [{ x: 0, y: 2 }, { x: 128, y: 130 }, { x: 255, y: 254 }],
    blue: [{ x: 0, y: 1 }, { x: 128, y: 128 }, { x: 255, y: 255 }],
  },
};

function reconstructPreQ3Master(points, matchNeed, neutral) {
  const baseScaleRaw = Math.max(0.32, Math.min(0.78, matchNeed / 24));
  const baseScale = neutral?.active ? baseScaleRaw * Math.max(0.48, Math.min(1, 1 - neutral.strength * 0.42)) : baseScaleRaw;
  return points.map(p => {
    const highWeight = Math.max(0, Math.min(1, (p.x - 150) / 105));
    const shadowWeight = Math.max(0, Math.min(1, (95 - p.x) / 95));
    const endpointProtection = 1 - Math.max(highWeight, shadowWeight) * (neutral?.active ? 0.25 : 0.12);
    return { x: p.x, y: Math.round(p.x + (p.y - p.x) * baseScale * endpointProtection) };
  });
}

await test('Well-evidenced large difference (matchNeedScore > 24): new ceiling (0.95) produces a stronger master curve than the reconstructed pre-Q3 ceiling (0.78)', () => {
  const analysis = buildLargeDifferenceAnalysis();
  const compensation = buildPhotographicCompensation({ analysis, intensity: 70 });
  assert.ok(analysis.delta.matchNeedScore > 24, `expected matchNeedScore > 24 to actually hit the old ceiling, got ${analysis.delta.matchNeedScore}`);
  const candidate = mapCompensationToLightroomCandidate({ compensation, pixelTransfer: samplePixelTransfer });
  const preQ3 = reconstructPreQ3Master(samplePixelTransfer.curves.master, compensation.evidence.matchNeedScore, compensation.targetProtection.neutralWhite);
  const newMaster = candidate.safePreset.curves.master;
  // Sum of absolute per-point deviation from identity, new vs reconstructed old.
  const magnitude = pts => pts.reduce((sum, p) => sum + Math.abs(p.y - p.x), 0);
  assert.ok(magnitude(newMaster) > magnitude(preQ3), `new magnitude=${magnitude(newMaster)} should exceed pre-Q3 magnitude=${magnitude(preQ3)}`);
});

await test('Modest difference (matchNeedScore well under the ramp point): baseScale floor/ramp is byte-identical to before (ceiling never engages)', () => {
  // matchNeed/24 stays under both 0.78 and 0.95 for a small matchNeedScore,
  // so the ceiling change must have zero effect here.
  const refTone = { shadow: { avgColor: { r: 90, g: 88, b: 84 }, temperatureHint: 3, tintHint: 0, pixelShare: 0.3 }, midtone: { avgColor: { r: 150, g: 148, b: 144 }, temperatureHint: 3, tintHint: 0, pixelShare: 0.5 }, highlight: { avgColor: { r: 222, g: 220, b: 216 }, temperatureHint: 3, tintHint: 0, pixelShare: 0.2 }, contrast: 44, blackPoint: 10, whitePoint: 244 };
  const tgtTone = { shadow: { avgColor: { r: 84, g: 82, b: 80 }, temperatureHint: -1, tintHint: 0, pixelShare: 0.3 }, midtone: { avgColor: { r: 144, g: 142, b: 140 }, temperatureHint: -1, tintHint: 0, pixelShare: 0.5 }, highlight: { avgColor: { r: 218, g: 216, b: 214 }, temperatureHint: -1, tintHint: 0, pixelShare: 0.2 }, contrast: 42, blackPoint: 9, whitePoint: 243 };
  const palette = () => ({ confidence: 0.85, colors: [{ weight: 0.5, hsl: { h: 30, s: 15, l: 55 } }, { weight: 0.3, hsl: { h: 200, s: 10, l: 45 } }, { weight: 0.2, hsl: { h: 0, s: 4, l: 78 } }] });
  const analysis = buildCoreColorMatchAnalysis({ reference: { palette: palette(), toneZones: refTone, skinAnalysis: { detected: false }, histogram: { clipHiPct: 0.1, clipLoPct: 0.1, drStops: 9 } }, target: { palette: palette(), toneZones: tgtTone, skinAnalysis: { detected: false }, histogram: { clipHiPct: 0.1, clipLoPct: 0.1, drStops: 9 } }, analysisGenerationId: 'q3-modest' });
  const compensation = buildPhotographicCompensation({ analysis, intensity: 70 });
  assert.ok(analysis.delta.matchNeedScore < 24, `expected a modest matchNeedScore below the ramp point, got ${analysis.delta.matchNeedScore}`);
  const candidate = mapCompensationToLightroomCandidate({ compensation, pixelTransfer: samplePixelTransfer });
  const preQ3 = reconstructPreQ3Master(samplePixelTransfer.curves.master, compensation.evidence.matchNeedScore, compensation.targetProtection.neutralWhite);
  assert.deepEqual(candidate.safePreset.curves.master, preQ3.map(p => ({ x: p.x, y: Math.max(0, Math.min(255, p.y)) })));
});

await test('REGRESSION: high-key wedding target + already-warm skin (EPIC O fixture) candidate bounds unaffected by the ceiling change', async () => {
  const palette = (colors, confidence = 0.92) => ({ confidence, colors });
  const refPalette = palette([{ weight: 0.42, hsl: { h: 110, s: 44, l: 28 } }, { weight: 0.28, hsl: { h: 28, s: 46, l: 66 } }, { weight: 0.18, hsl: { h: 0, s: 5, l: 78 } }, { weight: 0.12, hsl: { h: 210, s: 24, l: 42 } }]);
  const weddingPalette = palette([{ weight: 0.48, hsl: { h: 0, s: 4, l: 94 } }, { weight: 0.18, hsl: { h: 335, s: 34, l: 72 } }, { weight: 0.14, hsl: { h: 215, s: 36, l: 68 } }, { weight: 0.11, hsl: { h: 30, s: 42, l: 62 } }, { weight: 0.09, hsl: { h: 108, s: 32, l: 54 } }]);
  const tone = (cfg = {}) => ({
    shadow: { avgColor: cfg.shadowRgb || { r: 42, g: 39, b: 35 }, temperatureHint: cfg.shadowWarm ?? 20, tintHint: cfg.shadowTint ?? 0, pixelShare: cfg.shadowShare ?? 0.3 },
    midtone: { avgColor: cfg.midRgb || { r: 132, g: 125, b: 116 }, temperatureHint: cfg.midWarm ?? 22, tintHint: cfg.midTint ?? 0, pixelShare: cfg.midShare ?? 0.5 },
    highlight: { avgColor: cfg.hiRgb || { r: 226, g: 218, b: 205 }, temperatureHint: cfg.hiWarm ?? 24, tintHint: cfg.hiTint ?? 0, pixelShare: cfg.hiShare ?? 0.2 },
    contrast: cfg.contrast ?? 52, blackPoint: cfg.blackPoint ?? 10, whitePoint: cfg.whitePoint ?? 244,
  });
  const reference = { palette: refPalette, toneZones: tone({ shadowShare: 0.48, midShare: 0.43, hiShare: 0.09, shadowWarm: 28, midWarm: 30, hiWarm: 26, contrast: 58, whitePoint: 238 }), skinAnalysis: { detected: true, coveragePct: 22, confidence: 0.9, avgHue: 29, avgSat: 38, avgLum: 63 }, histogram: { clipHiPct: 0.1, clipLoPct: 0.1, drStops: 10 } };
  const target = { palette: weddingPalette, toneZones: tone({ shadowRgb: { r: 178, g: 172, b: 169 }, midRgb: { r: 225, g: 221, b: 219 }, hiRgb: { r: 249, g: 246, b: 244 }, shadowShare: 0.08, midShare: 0.34, hiShare: 0.58, shadowWarm: 7, midWarm: 8, hiWarm: 5, contrast: 28, blackPoint: 38, whitePoint: 252 }), skinAnalysis: { detected: true, coveragePct: 14, confidence: 0.9, avgHue: 31, avgSat: 52, avgLum: 69 }, histogram: { clipHiPct: 1.2, clipLoPct: 0, drStops: 7.3 } };
  const analysis = buildCoreColorMatchAnalysis({ reference, target, analysisGenerationId: '2e-q3-regression' });
  const compensation = buildPhotographicCompensation({ analysis, intensity: 72, protectionOptions: { preserveSkinTone: true, protectHighlights: true, protectShadows: true } });
  const candidate = mapCompensationToLightroomCandidate({ compensation, targetMediaContext: { fileName: '981A8131.CR2', mediaType: 'RAW' } });
  assert.ok(candidate.safePreset.exp <= 5, candidate.safePreset);
  assert.ok(candidate.safePreset.hi <= 3, candidate.safePreset);
  assert.ok(candidate.safePreset.wh <= 2, candidate.safePreset);
  assert.ok(candidate.safePreset.temp <= 10, candidate.safePreset);
  assert.ok(candidate.safePreset.hsl.hsl_s_orange <= 5, candidate.safePreset.hsl);
});

await test('Source: only the ceiling changed (0.78 -> 0.95); floor (0.32), ramp divisor (24), channelScale, and neutral-protection multiplier are byte-identical', async () => {
  const source = await read('core/color-match/lightroom-candidate-mapper.js');
  assert.match(source, /let baseScale = clamp\(matchNeed \/ 24, 0\.32, 0\.95\);/);
  assert.doesNotMatch(source, /clamp\(matchNeed \/ 24, 0\.32, 0\.78\)/);
  assert.match(source, /if \(neutral\?\.active\) baseScale \*= clamp\(1 - neutral\.strength \* 0\.42, 0\.48, 1\);/);
  assert.match(source, /const channelScale = clamp\(baseScale \* 0\.55, 0\.18, 0\.52\);/);
});

console.log(`\n${pass}/${pass + (process.exitCode ? 1 : 0)} PASS, ${process.exitCode ? 1 : 0} FAIL`);
if (process.exitCode) process.exit(process.exitCode);
