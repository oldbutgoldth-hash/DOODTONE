#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveToneZoneBoundaries } from '../core/color-match/tone-zone-analyzer.js';

let pass = 0;
function test(name, fn) {
  try { fn(); pass++; console.log(`✓ [PASS] ${name}`); }
  catch (error) { console.error(`✗ [FAIL] ${name}\n${error.stack}`); process.exitCode = 1; }
}

test('Normal dynamic range retains the established 40-level zone margins', () => {
  const bounds = resolveToneZoneBoundaries(10, 244);
  assert.equal(bounds.shadowMax, 50);
  assert.equal(bounds.highlightMin, 204);
});

test('Narrow dynamic range has non-overlapping shadow and highlight thresholds', () => {
  const bounds = resolveToneZoneBoundaries(120, 150);
  assert.ok(bounds.shadowMax < bounds.highlightMin, bounds);
  assert.equal(bounds.shadowMax, 129.6);
  assert.equal(bounds.highlightMin, 140.4);
});

test('Malformed or reversed points remain bounded and ordered', () => {
  const bounds = resolveToneZoneBoundaries(280, -20);
  assert.ok(bounds.shadowMax <= bounds.highlightMin, bounds);
  assert.ok(bounds.shadowMax >= 0 && bounds.highlightMin <= 255, bounds);
});

console.log(`\n${pass}/3 PASS, ${process.exitCode ? 1 : 0} FAIL`);
if (process.exitCode) process.exit(process.exitCode);
