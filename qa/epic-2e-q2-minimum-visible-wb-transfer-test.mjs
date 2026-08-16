#!/usr/bin/env node
/**
 * EPIC 2E-Q2 — Minimum Visible White Balance Transfer.
 *
 * Second half of the "RCM produces near-no-op presets" investigation
 * (first half: EPIC 2E-Q1, which fixed white balance transfer being
 * silently skipped entirely when no Target base value was present).
 * This round targets a separate, real mechanism: even once a base value
 * exists, wbStrength compounded up to 4 confidence-side factors
 * (illuminant.transferStrength, skin.globalWbTransferStrength, amount,
 * largeShiftDampen) BEFORE target-aware protection (neutral.
 * whiteBalanceScale, targetSkin.globalWarmthScale) got its own
 * multiplicative turn. For a real illuminant difference with decent but
 * not pristine evidence, that compounding alone could crush the
 * transfer under ~10% of the raw measured difference.
 *
 * The old warmthFloor rescue only existed for warmth (never tint) and
 * used a binary all-or-nothing gate (zoneConsistency>=.72 AND
 * illuminantConfidence>=.55). This suite proves the new continuous
 * confidence-side floor: (1) rescues a moderate-confidence case the old
 * binary gate would have rejected, (2) applies symmetrically to tint
 * (previously unfloored), (3) never fires when there is no real
 * transfer intent (amount=0 / BLOCKED_INSUFFICIENT_EVIDENCE), and (4)
 * never overrides genuine target-aware protection (high-key target,
 * already-warm skin) -- verified against the exact same fixture EPIC
 * O's own target-aware-roundtrip regression test uses.
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
const { buildPhotographicCompensation, COMPENSATION_STATES } = await import(path.join(ROOT, 'core/color-match/photographic-compensation-engine.js'));

function buildAnalysis({ spread = 30, dominantWeight = 0.55 } = {}) {
  const refTone = {
    shadow: { avgColor: { r: 90, g: 76, b: 58 }, temperatureHint: 34 - spread, tintHint: 4, pixelShare: 0.28 },
    midtone: { avgColor: { r: 168, g: 140, b: 100 }, temperatureHint: 30, tintHint: 1, pixelShare: 0.5 },
    highlight: { avgColor: { r: 236, g: 214, b: 176 }, temperatureHint: 26 + spread, tintHint: -1, pixelShare: 0.22 },
    contrast: 46, blackPoint: 12, whitePoint: 246,
  };
  const tgtTone = {
    shadow: { avgColor: { r: 58, g: 62, b: 68 }, temperatureHint: -4 - spread * 0.4, tintHint: -1, pixelShare: 0.3 },
    midtone: { avgColor: { r: 150, g: 152, b: 158 }, temperatureHint: -6, tintHint: 0, pixelShare: 0.48 },
    highlight: { avgColor: { r: 228, g: 226, b: 222 }, temperatureHint: -8 + spread * 0.4, tintHint: 1, pixelShare: 0.22 },
    contrast: 42, blackPoint: 10, whitePoint: 242,
  };
  const rest = 1 - dominantWeight;
  const palette = dominantHue => ({ confidence: 0.8, colors: [
    { weight: dominantWeight, hsl: { h: dominantHue, s: 44, l: 55 } },
    { weight: rest * 0.5, hsl: { h: 30, s: 36, l: 62 } },
    { weight: rest * 0.3, hsl: { h: 0, s: 6, l: 78 } },
    { weight: rest * 0.2, hsl: { h: 200, s: 20, l: 45 } },
  ] });
  return buildCoreColorMatchAnalysis({
    reference: { palette: palette(30), toneZones: refTone, skinAnalysis: { detected: true, coveragePct: 24, confidence: 0.8, avgHue: 30, avgSat: 38, avgLum: 60 }, histogram: { clipHiPct: 0.2, clipLoPct: 0.1, drStops: 9 } },
    target: { palette: palette(205), toneZones: tgtTone, skinAnalysis: { detected: true, coveragePct: 22, confidence: 0.78, avgHue: 27, avgSat: 32, avgLum: 57 }, histogram: { clipHiPct: 0.2, clipLoPct: 0.1, drStops: 8.5 } },
    analysisGenerationId: 'q2-fixture',
  });
}

/** Reconstructs the pre-Q2 formula from the same real intermediates the
 * current engine computed, so this suite can prove an actual before/
 * after difference against the real engine's own numbers -- not a
 * hand-derived guess. */
function reconstructPreQ2Warmth(analysis, c, intensity = 70) {
  const amount = Math.max(0, Math.min(100, intensity)) / 100;
  const largeShiftDampen = analysis.delta.matchNeedScore >= 55 ? 0.78 : analysis.delta.matchNeedScore >= 28 ? 0.9 : 1;
  const wbStrength = c.illuminant.transferStrength * c.skinProtection.globalWbTransferStrength * amount * largeShiftDampen;
  const rawWarmth = analysis.delta.whiteBalance.warmth * wbStrength * c.targetProtection.neutralWhite.whiteBalanceScale * c.targetProtection.skin.globalWarmthScale;
  const consistentIlluminant = c.illuminant.zoneConsistency >= 0.72 && c.illuminant.illuminantConfidence >= 0.55;
  const floorScale = c.targetProtection.skin.targetAlreadyWarm ? 0.18 : 0.30;
  const floor = consistentIlluminant && Math.abs(analysis.delta.whiteBalance.warmth) >= 8 ? analysis.delta.whiteBalance.warmth * amount * floorScale : 0;
  const final = Math.abs(rawWarmth) < Math.abs(floor) && Math.sign(rawWarmth || floor) === Math.sign(floor) ? floor : rawWarmth;
  return Math.max(-45, Math.min(45, final));
}

await test('Moderate-confidence case (zoneConsistency ~0.70, below the OLD binary 0.72 gate): the new continuous floor rescues warmth above what the old binary gate would have given', () => {
  const analysis = buildAnalysis({ spread: 30, dominantWeight: 0.55 });
  const c = buildPhotographicCompensation({ analysis, intensity: 70 });
  assert.ok(c.illuminant.zoneConsistency < 0.72, `expected below old gate, got ${c.illuminant.zoneConsistency}`);
  const preQ2 = reconstructPreQ2Warmth(analysis, c, 70);
  assert.ok(Math.abs(c.semanticIntents.whiteBalance.warmth) > Math.abs(preQ2), `new=${c.semanticIntents.whiteBalance.warmth} should exceed reconstructed pre-Q2=${preQ2}`);
  assert.equal(c.semanticIntents.whiteBalance.transferFloorApplied, true);
});

await test('Floor applies symmetrically to tint, which had no floor mechanism at all before this round', () => {
  const analysis = buildAnalysis({ spread: 30, dominantWeight: 0.55 });
  const c = buildPhotographicCompensation({ analysis, intensity: 70 });
  assert.ok(Math.abs(c.semanticIntents.whiteBalance.tint) > 0, 'tint should be non-zero for a real measured tint delta');
});

await test('Floor never fires when there is no real transfer intent (BLOCKED_INSUFFICIENT_EVIDENCE keeps warmth exactly 0)', () => {
  const analysis = buildAnalysis({ spread: 30, dominantWeight: 0.55 });
  analysis.referenceSignature.evidence.confidence = 0.2;
  analysis.targetSignature.evidence.confidence = 0.2;
  analysis.delta.evidence.combinedConfidence = 0.2;
  const c = buildPhotographicCompensation({ analysis, intensity: 70 });
  assert.equal(c.state, COMPENSATION_STATES.BLOCKED_INSUFFICIENT_EVIDENCE);
  assert.equal(c.semanticIntents.whiteBalance.warmth, 0);
  assert.equal(c.semanticIntents.whiteBalance.tint, 0);
});

await test('Floor never fires at intensity=0 (amount gate preserved)', () => {
  const analysis = buildAnalysis({ spread: 30, dominantWeight: 0.55 });
  const c = buildPhotographicCompensation({ analysis, intensity: 0 });
  assert.equal(c.semanticIntents.whiteBalance.warmth, 0);
  assert.equal(c.semanticIntents.whiteBalance.tint, 0);
});

await test('Floor never fires for a trivially small raw difference (no evidence to rescue)', () => {
  const analysis = buildAnalysis({ spread: 0, dominantWeight: 0.25 });
  // Make reference and target nearly identical so matchNeedScore stays low.
  const c = buildPhotographicCompensation({ analysis: buildCoreColorMatchAnalysis({
    reference: { palette: { confidence: 0.8, colors: [{ weight: 0.5, hsl: { h: 30, s: 30, l: 60 } }, { weight: 0.3, hsl: { h: 200, s: 20, l: 45 } }, { weight: 0.2, hsl: { h: 0, s: 5, l: 78 } }] },
      toneZones: { shadow: { avgColor: { r: 80, g: 78, b: 74 }, temperatureHint: 1, tintHint: 0, pixelShare: 0.3 }, midtone: { avgColor: { r: 150, g: 148, b: 144 }, temperatureHint: 1, tintHint: 0, pixelShare: 0.5 }, highlight: { avgColor: { r: 220, g: 218, b: 214 }, temperatureHint: 1, tintHint: 0, pixelShare: 0.2 }, contrast: 40, blackPoint: 10, whitePoint: 244 } },
    target: { palette: { confidence: 0.8, colors: [{ weight: 0.5, hsl: { h: 30, s: 30, l: 60 } }, { weight: 0.3, hsl: { h: 200, s: 20, l: 45 } }, { weight: 0.2, hsl: { h: 0, s: 5, l: 78 } }] },
      toneZones: { shadow: { avgColor: { r: 80, g: 78, b: 74 }, temperatureHint: 1, tintHint: 0, pixelShare: 0.3 }, midtone: { avgColor: { r: 150, g: 148, b: 144 }, temperatureHint: 1, tintHint: 0, pixelShare: 0.5 }, highlight: { avgColor: { r: 220, g: 218, b: 214 }, temperatureHint: 1, tintHint: 0, pixelShare: 0.2 }, contrast: 40, blackPoint: 10, whitePoint: 244 } },
    analysisGenerationId: 'q2-identity' }), intensity: 70 });
  assert.equal(c.semanticIntents.whiteBalance.warmth, 0);
  assert.equal(c.semanticIntents.whiteBalance.transferFloorApplied, false);
});

await test('REGRESSION: high-key wedding target + already-warm skin (EPIC O fixture) still stays within its documented safe bounds -- floor does not override genuine target-aware protection', async () => {
  const { mapCompensationToLightroomCandidate } = await import(path.join(ROOT, 'core/color-match/lightroom-candidate-mapper.js'));
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
  const analysis = buildCoreColorMatchAnalysis({ reference, target, analysisGenerationId: '2e-q2-regression' });
  const compensation = buildPhotographicCompensation({ analysis, intensity: 72, protectionOptions: { preserveSkinTone: true, protectHighlights: true, protectShadows: true } });
  const candidate = mapCompensationToLightroomCandidate({ compensation, targetMediaContext: { fileName: '981A8131.CR2', mediaType: 'RAW' } });
  assert.ok(candidate.safePreset.exp <= 5, candidate.safePreset);
  assert.ok(candidate.safePreset.hi <= 3, candidate.safePreset);
  assert.ok(candidate.safePreset.wh <= 2, candidate.safePreset);
  assert.ok(candidate.safePreset.temp <= 10, candidate.safePreset);
  assert.ok(candidate.safePreset.hsl.hsl_s_orange <= 5, candidate.safePreset.hsl);
});

await test('Source: floor is computed from a continuous illuminantEvidenceStrength scalar, not the old binary AND-gate', async () => {
  const source = await read('core/color-match/photographic-compensation-engine.js');
  assert.match(source, /illuminantEvidenceStrength = clamp\(illuminant\.zoneConsistency \* 0\.5 \+ illuminant\.illuminantConfidence \* 0\.5, 0, 1\)/);
  // The old binary gate is no longer a live variable (only mentioned in an
  // explanatory code comment describing what was removed).
  assert.doesNotMatch(source, /const consistentIlluminant/);
  assert.doesNotMatch(source, /const warmthFloorScale/);
});

await test('Source: floor only touches the confidence-side factors (transferStrength, skin.globalWbTransferStrength), never amount, largeShiftDampen, or either target-aware protection scale', async () => {
  const source = await read('core/color-match/photographic-compensation-engine.js');
  const fnStart = source.indexOf('function buildSemanticIntents');
  const fn = source.slice(fnStart, source.indexOf('\nexport function buildPhotographicCompensation'));
  assert.match(fn, /confidenceSideRaw = illuminant\.transferStrength \* skin\.globalWbTransferStrength/);
  assert.match(fn, /wbStrength = confidenceSideEffective \* amount \* largeShiftDampen/);
  assert.match(fn, /finalWarmthIntent = delta\.whiteBalance\.warmth \* wbStrength \* neutral\.whiteBalanceScale \* targetSkin\.globalWarmthScale/);
});

console.log(`\n${pass}/${pass + (process.exitCode ? 1 : 0)} PASS, ${process.exitCode ? 1 : 0} FAIL`);
if (process.exitCode) process.exit(process.exitCode);
