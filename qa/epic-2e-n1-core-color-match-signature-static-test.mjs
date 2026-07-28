#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildColorMatchSignature } from '../core/color-match/reference-target-signature-engine.js';
import { compareColorMatchSignatures, circularHueDifference } from '../core/color-match/signature-delta-engine.js';
import { buildCoreColorMatchAnalysis } from '../core/color-match/core-color-match-analysis.js';
import {
  COLOR_MATCH_SIGNATURE_SCHEMA_VERSION,
  COLOR_MATCH_MATCH_STATES,
  isColorMatchSignature,
  isColorMatchDelta,
} from '../core/color-match/signature-schema.js';

let pass = 0;
function test(name, fn) {
  try { fn(); pass++; console.log(`✓ [PASS] ${name}`); }
  catch (error) { console.error(`✗ [FAIL] ${name}\n${error.stack}`); process.exitCode = 1; }
}

const palette = (warm = 0) => ({
  confidence: 0.9,
  colors: [
    { weight: 0.42, hsl: { h: 30 + warm, s: 48, l: 63 } },
    { weight: 0.28, hsl: { h: 210, s: 32, l: 42 } },
    { weight: 0.2, hsl: { h: 0, s: 5, l: 82 } },
    { weight: 0.1, hsl: { h: 110, s: 35, l: 35 } },
  ],
});
const tone = ({ warmth = 5, tint = 0, offset = 0, contrast = 50 } = {}) => ({
  shadow: { avgColor: { r: 42 + offset, g: 39 + offset, b: 35 + offset }, saturation: 18, temperatureHint: warmth - 4, tintHint: tint, pixelShare: 0.3 },
  midtone: { avgColor: { r: 132 + offset, g: 126 + offset, b: 116 + offset }, saturation: 24, temperatureHint: warmth, tintHint: tint, pixelShare: 0.5 },
  highlight: { avgColor: { r: 225 + offset, g: 218 + offset, b: 205 + offset }, saturation: 15, temperatureHint: warmth + 5, tintHint: tint, pixelShare: 0.2 },
  contrast, blackPoint: 10, whitePoint: 244,
});

function signature(role, overrides = {}) {
  return buildColorMatchSignature({
    role,
    palette: overrides.palette ?? palette(),
    toneZones: overrides.toneZones ?? tone(),
    hslAnalysis: overrides.hslAnalysis ?? { confidence: 0.8, channels: {} },
    skinAnalysis: overrides.skinAnalysis ?? { detected: true, coveragePct: 18, confidence: 0.82, avgHue: 29, avgSat: 38, avgLum: 62 },
    histogram: overrides.histogram ?? { clipHiPct: 0.2, clipLoPct: 0.1, drStops: 9.5 },
    analysisGenerationId: 'gen-n1-test',
  });
}

test('Reference and Target share one deterministic schema', () => {
  const ref = signature('REFERENCE');
  const tgt = signature('TARGET');
  assert.equal(ref.schemaVersion, COLOR_MATCH_SIGNATURE_SCHEMA_VERSION);
  assert.equal(tgt.schemaVersion, COLOR_MATCH_SIGNATURE_SCHEMA_VERSION);
  assert.ok(isColorMatchSignature(ref));
  assert.ok(isColorMatchSignature(tgt));
  assert.deepEqual(Object.keys(ref).sort(), Object.keys(tgt).sort());
});

test('Signature never stores raw image, path, file name, Blob, or Base64 data', () => {
  const text = JSON.stringify(signature('REFERENCE'));
  for (const forbidden of ['data:image', 'blob:', 'C:\\', '/Users/', '/home/', 'fileName', 'localPath', 'pixelBuffer']) {
    assert.equal(text.includes(forbidden), false, forbidden);
  }
});

test('Identical signatures classify as ALREADY_CLOSE with near-zero need', () => {
  const delta = compareColorMatchSignatures({ referenceSignature: signature('REFERENCE'), targetSignature: signature('TARGET') });
  assert.ok(isColorMatchDelta(delta));
  assert.equal(delta.matchState, COLOR_MATCH_MATCH_STATES.ALREADY_CLOSE);
  assert.ok(delta.matchNeedScore < 1, delta.matchNeedScore);
  assert.deepEqual(delta.reasonCodes, ['SIGNATURES_ALREADY_CLOSE']);
});

test('Warm reference versus cool target creates positive warmth delta', () => {
  const ref = signature('REFERENCE', { toneZones: tone({ warmth: 28 }) });
  const tgt = signature('TARGET', { toneZones: tone({ warmth: -18 }) });
  const delta = compareColorMatchSignatures({ referenceSignature: ref, targetSignature: tgt });
  assert.ok(delta.whiteBalance.warmth > 35, delta.whiteBalance.warmth);
  assert.ok(delta.reasonCodes.includes('WB_REFERENCE_WARMER'));
  assert.notEqual(delta.matchState, COLOR_MATCH_MATCH_STATES.ALREADY_CLOSE);
});

test('Swapping Reference and Target reverses signed WB and tone deltas', () => {
  const a = signature('REFERENCE', { toneZones: tone({ warmth: 20, offset: 10, contrast: 62 }) });
  const b = signature('TARGET', { toneZones: tone({ warmth: -8, offset: -8, contrast: 40 }) });
  const ab = compareColorMatchSignatures({ referenceSignature: a, targetSignature: b });
  const ba = compareColorMatchSignatures({
    referenceSignature: { ...b, role: 'REFERENCE' },
    targetSignature: { ...a, role: 'TARGET' },
  });
  assert.equal(ab.whiteBalance.warmth, -ba.whiteBalance.warmth);
  assert.equal(ab.tone.midtoneLuma, -ba.tone.midtoneLuma);
  assert.equal(ab.tone.contrast, -ba.tone.contrast);
});

test('Circular hue delta handles the 359°/1° boundary correctly', () => {
  assert.equal(circularHueDifference(1, 359), 2);
  assert.equal(circularHueDifference(359, 1), -2);
});

test('Low evidence fails closed as INSUFFICIENT_EVIDENCE', () => {
  const ref = buildColorMatchSignature({ role: 'REFERENCE', palette: { confidence: 0.1, colors: palette().colors }, toneZones: tone() });
  const tgt = buildColorMatchSignature({ role: 'TARGET', palette: { confidence: 0.1, colors: palette().colors }, toneZones: tone() });
  const delta = compareColorMatchSignatures({ referenceSignature: ref, targetSignature: tgt });
  assert.equal(delta.matchState, COLOR_MATCH_MATCH_STATES.INSUFFICIENT_EVIDENCE);
});

test('Orchestrator is signature-only and hard-locks Production/XMP', () => {
  const result = buildCoreColorMatchAnalysis({
    reference: { palette: palette(), toneZones: tone(), hslAnalysis: { confidence: 0.8, channels: {} } },
    target: { palette: palette(4), toneZones: tone({ warmth: -5 }), hslAnalysis: { confidence: 0.8, channels: {} } },
    analysisGenerationId: 'gen-orchestrator',
  });
  assert.equal(result.stage, 'N1_SIGNATURE_DELTA_FOUNDATION');
  assert.equal(result.production.productionSource, 'legacy');
  assert.equal(result.production.productionWrite, false);
  assert.equal(result.production.xmpWriteAllowed, false);
  assert.equal(result.production.lightroomMappingAllowed, false);
  assert.equal(JSON.stringify(result).includes('<x:xmpmeta'), false);
});

test('Invalid role or missing core evidence is rejected', () => {
  assert.throws(() => buildColorMatchSignature({ role: 'OTHER', palette: palette(), toneZones: tone() }));
  assert.throws(() => buildColorMatchSignature({ role: 'REFERENCE', palette: palette() }));
});

console.log(`\n${pass}/9 PASS, ${process.exitCode ? 1 : 0} FAIL`);
if (process.exitCode) process.exit(process.exitCode);
