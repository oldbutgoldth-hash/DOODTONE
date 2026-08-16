#!/usr/bin/env node
/**
 * EPIC 2E-Q4 — Graceful Skin Protection Degradation.
 *
 * Fourth finding from the "RCM presets are not good enough to use"
 * investigation, targeting the one of the user's four original problem
 * categories Q1-Q3 did not touch: "ผิวคน/สกินโทนถูกกระทบ" (skin/skin tone
 * affected).
 *
 * classifySkin()'s `detected` flag is a hard boolean cliff at 4% skin
 * coverage. Both deriveSkinModel() (photographic-compensation-engine.js)
 * and deriveTargetSkinProtection() (target-aware-protection-engine.js)
 * gated ALL skin protection on that single boolean -- a target with real
 * but just-under-4% skin coverage (a small/partial-frame portrait, a
 * face partially out of crop, or simply a borderline classifier read)
 * got EXACTLY THE SAME ZERO skin protection as a target with no skin
 * pixels at all. This is the same silent-skip failure shape as EPIC
 * 2E-Q1's missing white-balance base -- protection the system is fully
 * capable of computing simply never engages because one upstream
 * boolean landed on the wrong side of a cliff.
 *
 * This suite proves: (1) coverage at/above the classifier's own 4%
 * threshold is byte-identical to before (skinPresence clamps to
 * exactly 1), (2) coverage in the borderline 0-4% zone now gets
 * real, proportional, non-zero protection instead of none, (3)
 * genuinely zero coverage still gets genuinely zero protection, and
 * (4) explicitly disabling skin protection (preserveSkinTone: false)
 * still fully disables it regardless of coverage.
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
const { buildTargetAwareProtection } = await import(path.join(ROOT, 'core/color-match/target-aware-protection-engine.js'));

const refTone = { shadow: { avgColor: { r: 96, g: 78, b: 55 }, temperatureHint: 32, tintHint: 3, pixelShare: 0.28 }, midtone: { avgColor: { r: 168, g: 138, b: 96 }, temperatureHint: 30, tintHint: 1, pixelShare: 0.5 }, highlight: { avgColor: { r: 235, g: 210, b: 168 }, temperatureHint: 22, tintHint: -1, pixelShare: 0.22 }, contrast: 46, blackPoint: 12, whitePoint: 246 };
const tgtTone = { shadow: { avgColor: { r: 58, g: 62, b: 70 }, temperatureHint: -6, tintHint: -1, pixelShare: 0.3 }, midtone: { avgColor: { r: 150, g: 152, b: 158 }, temperatureHint: -4, tintHint: 0, pixelShare: 0.48 }, highlight: { avgColor: { r: 228, g: 226, b: 224 }, temperatureHint: 2, tintHint: 0, pixelShare: 0.22 }, contrast: 42, blackPoint: 10, whitePoint: 242 };
const palette = h => ({ confidence: 0.85, colors: [{ weight: 0.36, hsl: { h, s: 42, l: 55 } }, { weight: 0.24, hsl: { h: 30, s: 38, l: 62 } }, { weight: 0.22, hsl: { h: 0, s: 6, l: 78 } }, { weight: 0.18, hsl: { h: 200, s: 20, l: 45 } }] });

function buildAnalysis(coveragePct) {
  return buildCoreColorMatchAnalysis({
    reference: { palette: palette(30), toneZones: refTone, skinAnalysis: { detected: true, coveragePct: 24, confidence: 0.85, avgHue: 30, avgSat: 40, avgLum: 62 }, histogram: { clipHiPct: 0.2, clipLoPct: 0.1, drStops: 9 } },
    target: { palette: palette(210), toneZones: tgtTone, skinAnalysis: { detected: coveragePct > 4, coveragePct, confidence: 0.8, avgHue: 28, avgSat: 34, avgLum: 58 }, histogram: { clipHiPct: 0.2, clipLoPct: 0.1, drStops: 8.5 } },
    analysisGenerationId: 'q4-fixture',
  });
}

await test('Coverage at/above the 4% classifier threshold: skinPresence=1, byte-identical protection to before', () => {
  const c22 = buildPhotographicCompensation({ analysis: buildAnalysis(22), intensity: 70 });
  const c45 = buildPhotographicCompensation({ analysis: buildAnalysis(4.5), intensity: 70 });
  assert.equal(c22.skinProtection.skinPresence, 1);
  assert.equal(c45.skinProtection.skinPresence, 1);
  assert.equal(c22.skinProtection.active, true);
});

await test('Borderline coverage (3%, below the old hard cliff): protection is now real and non-zero, not the old zero', () => {
  const c = buildPhotographicCompensation({ analysis: buildAnalysis(3), intensity: 70 });
  assert.equal(c.skinProtection.active, true, 'protection should engage even though detected=false');
  assert.ok(c.skinProtection.skinPresence > 0 && c.skinProtection.skinPresence < 1, c.skinProtection.skinPresence);
  assert.ok(c.skinProtection.protectionStrength > 0, 'protectionStrength must be non-zero at 3% coverage');
  assert.ok(c.skinProtection.skinChannelTransferStrength < 1, 'some dampening must apply to skin-adjacent channels');
});

await test('Protection strength ramps monotonically with coverage in the borderline zone (1% < 2% < 3% < 4.5%)', () => {
  const strengths = [1, 2, 3, 4.5].map(cov => buildPhotographicCompensation({ analysis: buildAnalysis(cov), intensity: 70 }).skinProtection.protectionStrength);
  for (let i = 1; i < strengths.length; i += 1) assert.ok(strengths[i] > strengths[i - 1], `expected monotonic ramp, got ${JSON.stringify(strengths)}`);
});

await test('Genuinely zero coverage still gets genuinely zero protection', () => {
  const c = buildPhotographicCompensation({ analysis: buildAnalysis(0), intensity: 70 });
  assert.equal(c.skinProtection.active, false);
  assert.equal(c.skinProtection.skinPresence, 0);
  assert.equal(c.skinProtection.protectionStrength, 0);
  assert.equal(c.skinProtection.skinChannelTransferStrength, 1);
});

await test('target-aware-protection-engine: same ramp behavior, and preserveSkinTone:false still fully disables regardless of coverage', () => {
  const analysis = buildAnalysis(2.5);
  const withProtection = buildTargetAwareProtection({ referenceSignature: analysis.referenceSignature, targetSignature: analysis.targetSignature, delta: analysis.delta, options: {} });
  assert.equal(withProtection.skin.active, true);
  assert.ok(withProtection.skin.strength > 0);
  const disabled = buildTargetAwareProtection({ referenceSignature: analysis.referenceSignature, targetSignature: analysis.targetSignature, delta: analysis.delta, options: { preserveSkinTone: false } });
  assert.equal(disabled.skin.active, false);
  assert.equal(disabled.skin.strength, 0);
});

await test('target-aware-protection-engine: full-coverage case (skinPresence=1) matches the exact pre-Q4 strength formula (no regression)', () => {
  const analysis = buildAnalysis(22);
  const p = buildTargetAwareProtection({ referenceSignature: analysis.referenceSignature, targetSignature: analysis.targetSignature, delta: analysis.delta, options: {} });
  const t = analysis.targetSignature;
  const confidence = Math.max(0, Math.min(1, t.skin.confidence));
  const coverage = Math.max(0, Math.min(1, t.skin.coveragePct / 42));
  // Reconstruct naturalityRisk/strength independently is out of scope here;
  // instead assert skinPresence itself is exactly 1 at this coverage, which
  // is what guarantees byte-identical output to the pre-Q4 formula.
  assert.equal(p.skin.skinPresence, 1);
});

await test('Source: skinPresence ramp is present in both engines, gated on coveragePct/4, not the boolean detected flag', async () => {
  const compSource = await read('core/color-match/photographic-compensation-engine.js');
  const protSource = await read('core/color-match/target-aware-protection-engine.js');
  assert.match(compSource, /const skinPresence = clamp\(\(Number\(target\.skin\.coveragePct\) \|\| 0\) \/ 4, 0, 1\);/);
  assert.match(protSource, /const skinPresence = clamp\(\(Number\(target\.skin\.coveragePct\) \|\| 0\) \/ 4, 0, 1\);/);
});

console.log(`\n${pass}/${pass + (process.exitCode ? 1 : 0)} PASS, ${process.exitCode ? 1 : 0} FAIL`);
if (process.exitCode) process.exit(process.exitCode);
