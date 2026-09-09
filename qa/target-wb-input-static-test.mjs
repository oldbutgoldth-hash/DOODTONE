#!/usr/bin/env node
import assert from 'node:assert/strict';
import { parseTargetWhiteBalanceBaseFields } from '../ui/reference-color-match-panel.js';

let pass = 0;
function test(name, fn) {
  try { fn(); pass++; console.log(`✓ [PASS] ${name}`); }
  catch (error) { console.error(`✗ [FAIL] ${name}\n${error.stack}`); process.exitCode = 1; }
}

test('Blank fields remain unknown instead of becoming numeric zero', () => {
  assert.deepEqual(parseTargetWhiteBalanceBaseFields('', ''), { baseTemperatureK: null, baseTint: null });
  assert.deepEqual(parseTargetWhiteBalanceBaseFields('5200', ''), { baseTemperatureK: 5200, baseTint: null });
});
test('Explicit zero tint remains valid photographer input', () => {
  assert.deepEqual(parseTargetWhiteBalanceBaseFields(' 5200 ', '0'), { baseTemperatureK: 5200, baseTint: 0 });
});
test('Out-of-range or non-numeric values fail closed', () => {
  assert.deepEqual(parseTargetWhiteBalanceBaseFields('51000', '-151'), { baseTemperatureK: null, baseTint: null });
  assert.deepEqual(parseTargetWhiteBalanceBaseFields('warm', 'magenta'), { baseTemperatureK: null, baseTint: null });
});

console.log(`\n${pass}/3 PASS, ${process.exitCode ? 1 : 0} FAIL`);
if (process.exitCode) process.exit(process.exitCode);
