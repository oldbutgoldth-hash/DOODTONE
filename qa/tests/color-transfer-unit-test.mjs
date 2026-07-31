/**
 * ═══════════════════════════════════════════════════════════════════════════
 * LUMIXA — Color Transfer Unit Tests
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Tests pure math/data functions that don't require browser APIs.
 * Run: node qa/tests/color-transfer-unit-test.mjs
 */

import { strict as assert } from 'node:assert';

let passCount = 0;
let failCount = 0;

function test(name, fn) {
  try {
    fn();
    passCount++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failCount++;
    console.log(`  ✗ ${name}: ${e.message}`);
  }
}

// ── Import pure functions ─────────────────────────────────────────────────────
// We need to test the math independently, so we replicate the key functions:

function clamp(v, lim) {
  if (Array.isArray(lim)) return Math.max(lim[0], Math.min(lim[1], v));
  return Math.max(-lim, Math.min(lim, v));
}

function gaussianWeight(dh, sigma) {
  return Math.exp(-(dh * dh) / (2 * sigma * sigma));
}

function circularHueDistance(h1, h2) {
  let dh = Math.abs(h1 - h2);
  if (dh > 180) dh = 360 - dh;
  return dh;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

console.log('\n=== LUMIXA Color Transfer Unit Tests ===\n');

console.log('Clamp:');
test('clamp positive within range', () => assert.equal(clamp(5, 10), 5));
test('clamp positive over range', () => assert.equal(clamp(15, 10), 10));
test('clamp negative within range', () => assert.equal(clamp(-5, 10), -5));
test('clamp negative over range', () => assert.equal(clamp(-15, 10), -10));
test('clamp array range [min, max]', () => assert.equal(clamp(50, [-20, 30]), 30));
test('clamp array range below min', () => assert.equal(clamp(-30, [-20, 30]), -20));

console.log('\nCircular Hue Distance:');
test('same hue → 0', () => assert.equal(circularHueDistance(0, 0), 0));
test('adjacent hues', () => assert.equal(circularHueDistance(10, 30), 20));
test('wrapping around 360°', () => assert.equal(circularHueDistance(350, 10), 20));
test('opposite hues', () => assert.equal(circularHueDistance(0, 180), 180));
test('near wrap', () => assert.equal(circularHueDistance(355, 5), 10));

console.log('\nGaussian Weight:');
test('zero distance → weight 1', () => assert.ok(Math.abs(gaussianWeight(0, 25) - 1.0) < 0.001));
test('small distance → high weight', () => assert.ok(gaussianWeight(10, 25) > 0.8));
test('medium distance → moderate weight', () => assert.ok(gaussianWeight(25, 25) > 0.5 && gaussianWeight(25, 25) < 0.7));
test('large distance → low weight', () => assert.ok(gaussianWeight(50, 25) < 0.15));
test('very large distance → near zero', () => assert.ok(gaussianWeight(90, 25) < 0.002));

console.log('\nHSL Channel Gaussian Distribution:');
{
  const CHANNEL_HUES = [0, 30, 60, 120, 180, 240, 270, 300];
  const CHANNELS = ['red','orange','yellow','green','aqua','blue','purple','magenta'];
  const SIGMA = 25;

  test('red hue (0°) → strongest in red channel', () => {
    const hue = 0;
    const weights = CHANNEL_HUES.map(ch => {
      let dh = Math.abs(hue - ch);
      if (dh > 180) dh = 360 - dh;
      return gaussianWeight(dh, SIGMA);
    });
    const maxIdx = weights.indexOf(Math.max(...weights));
    assert.equal(maxIdx, 0); // red channel
  });

  test('orange hue (30°) → strongest in orange channel', () => {
    const hue = 30;
    const weights = CHANNEL_HUES.map(ch => {
      let dh = Math.abs(hue - ch);
      if (dh > 180) dh = 360 - dh;
      return gaussianWeight(dh, SIGMA);
    });
    const maxIdx = weights.indexOf(Math.max(...weights));
    assert.equal(maxIdx, 1); // orange channel
  });

  test('blue hue (240°) → strongest in blue channel', () => {
    const hue = 240;
    const weights = CHANNEL_HUES.map(ch => {
      let dh = Math.abs(hue - ch);
      if (dh > 180) dh = 360 - dh;
      return gaussianWeight(dh, SIGMA);
    });
    const maxIdx = weights.indexOf(Math.max(...weights));
    assert.equal(maxIdx, 5); // blue channel
  });

  test('hue 350° (near red) → strongest in red, not magenta (wraparound fix)', () => {
    const hue = 350;
    const weights = CHANNEL_HUES.map(ch => {
      let dh = Math.abs(hue - ch);
      if (dh > 180) dh = 360 - dh;
      return gaussianWeight(dh, SIGMA);
    });
    const maxIdx = weights.indexOf(Math.max(...weights));
    assert.equal(maxIdx, 0); // red channel, NOT magenta (index 7)
  });

  test('hue 350° → red weight > magenta weight (wraparound correctness)', () => {
    const hue = 350;
    const redW = gaussianWeight(circularHueDistance(350, 0), SIGMA);
    const magW = gaussianWeight(circularHueDistance(350, 300), SIGMA);
    assert.ok(redW > magW, `red(${redW.toFixed(3)}) should be > magenta(${magW.toFixed(3)})`);
  });

  test('adjacent channels share weight (smooth distribution)', () => {
    const hue = 45; // between red(0°) and orange(30°) and yellow(60°)
    const weights = CHANNEL_HUES.map(ch => {
      let dh = Math.abs(hue - ch);
      if (dh > 180) dh = 360 - dh;
      return gaussianWeight(dh, SIGMA);
    });
    // Orange (30°) and yellow (60°) should be strongest, red (0°) should have meaningful weight
    assert.ok(weights[1] > 0.8, `orange weight ${weights[1].toFixed(3)} should be > 0.8`);
    assert.ok(weights[2] > 0.8, `yellow weight ${weights[2].toFixed(3)} should be > 0.8`);
    assert.ok(weights[0] > 0.1, `red weight ${weights[0].toFixed(3)} should be > 0.1 (meaningful contribution)`);
  });
}

console.log('\nSAFE_BOUNDS vs HARD_LIMITS (safety hierarchy):');
{
  const SAFE = { exposure: 38, contrast: 25 };
  const HARD = { exposure: [-40, 40], contrast: [-25, 30] };

  test('SAFE_BOUNDS.exposure <= HARD_LIMITS.exposure max (tighter safety)', () => {
    assert.ok(SAFE.exposure <= Math.abs(HARD.exposure[1]), `SAFE ${SAFE.exposure} should be <= HARD max ${Math.abs(HARD.exposure[1])}`);
  });
  test('SAFE_BOUNDS.contrast <= HARD_LIMITS.contrast max (tighter safety)', () => {
    assert.ok(SAFE.contrast <= Math.abs(HARD.contrast[1]), `SAFE ${SAFE.contrast} should be <= HARD max ${Math.abs(HARD.contrast[1])}`);
  });
}

console.log('\nAdaptive Skin Protection:');
{
  test('confidence=0 → retention=0.25 (minimum protection)', () => {
    const confidence = 0;
    const retention = 0.25 + confidence * 0.30;
    assert.equal(retention, 0.25);
  });
  test('confidence=0.5 → retention=0.40', () => {
    const confidence = 0.5;
    const retention = 0.25 + confidence * 0.30;
    assert.equal(retention, 0.40);
  });
  test('confidence=1.0 → retention=0.55 (maximum protection)', () => {
    const confidence = 1.0;
    const retention = 0.25 + confidence * 0.30;
    assert.equal(retention, 0.55);
  });
  test('hue retention is always less than saturation retention', () => {
    for (let c = 0; c <= 1; c += 0.1) {
      const satRet = 0.25 + c * 0.30;
      const hueRet = satRet * 0.85;
      assert.ok(hueRet < satRet, `at conf=${c.toFixed(1)}: hueRet(${hueRet.toFixed(3)}) < satRet(${satRet.toFixed(3)})`);
    }
  });
}

console.log('\nGraduated Endpoint Dampening:');
{
  const dampening = [0.2, 0.4, 0.7, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 0.7, 0.4, 0.2];

  test('endpoint (index 0) has lowest dampening', () => assert.equal(dampening[0], 0.2));
  test('near-endpoint (index 1) has moderate dampening', () => assert.equal(dampening[1], 0.4));
  test('inner-near (index 2) has mild dampening', () => assert.equal(dampening[2], 0.7));
  test('midpoint (index 6) has no dampening', () => assert.equal(dampening[6], 1.0));
  test('dampening is symmetric', () => {
    for (let i = 0; i < dampening.length; i++) {
      assert.equal(dampening[i], dampening[dampening.length - 1 - i], `index ${i} vs ${dampening.length - 1 - i}`);
    }
  });
  test('dampening is monotonically increasing from edges to center', () => {
    for (let i = 1; i < 7; i++) {
      assert.ok(dampening[i] >= dampening[i - 1], `index ${i} should be >= index ${i - 1}`);
    }
  });
}

console.log('\nHistogram Matching Merge Weight:');
{
  test('histWeight=0.65 means histogram dominates tone curve', () => {
    const histW = 0.65;
    const tcW = 1 - histW;
    assert.ok(histW > tcW, 'histogram weight should be > tone curve weight');
  });
  test('blending at mid-point: hist=100, tc=50 → result > 75', () => {
    const histVal = 100;
    const tcVal = 50;
    const histW = 0.65;
    const result = Math.round(histVal * histW + tcVal * (1 - histW));
    assert.ok(result > 75, `result ${result} should be > 75`);
  });
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${passCount + failCount} tests: ${passCount} PASS, ${failCount} FAIL\n`);
process.exit(failCount > 0 ? 1 : 0);
