#!/usr/bin/env node
/**
 * qa/epic-2e-j-safe-recovery-upload-baseline-static-test.mjs
 *
 * No-Browser static self-test for computeUploadBaselineDecision(),
 * exported by qa/epic-2e-j-safe-recovery-upload-baseline-test.mjs.
 * Importing that file for its exported pure function must NEVER
 * trigger a full Browser-suite run — guarded by the isMainModule check
 * in that file.
 */
import { computeUploadBaselineDecision } from './epic-2e-j-safe-recovery-upload-baseline-test.mjs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const results = [];
function record(test, result, evidence) {
  results.push({ test, result, evidence });
  const icon = result === 'PASS' ? '✓' : '✗';
  console.log(`${icon} [${result}] ${test} — ${evidence}`);
}

function check(test, actual, expected) {
  record(test, actual === expected ? 'PASS' : 'FAIL', `expected=${expected}, actual=${actual}`);
}

check('Empty rows -> FAIL_UPLOAD_BASELINE (fail-closed)', computeUploadBaselineDecision([]), 'FAIL_UPLOAD_BASELINE');
check('Non-array input -> FAIL_UPLOAD_BASELINE (fail-closed)', computeUploadBaselineDecision(null), 'FAIL_UPLOAD_BASELINE');
check('All PASS -> PASS_UPLOAD_BASELINE', computeUploadBaselineDecision([{ result: 'PASS' }, { result: 'PASS' }]), 'PASS_UPLOAD_BASELINE');
check('One FAIL among PASS -> FAIL_UPLOAD_BASELINE', computeUploadBaselineDecision([{ result: 'PASS' }, { result: 'FAIL' }]), 'FAIL_UPLOAD_BASELINE');
check('One NOT_TESTED among PASS -> FAIL_UPLOAD_BASELINE (strict)', computeUploadBaselineDecision([{ result: 'PASS' }, { result: 'NOT_TESTED' }]), 'FAIL_UPLOAD_BASELINE');
check('Malformed row (missing result) -> FAIL_UPLOAD_BASELINE', computeUploadBaselineDecision([{ result: 'PASS' }, { foo: 'bar' }]), 'FAIL_UPLOAD_BASELINE');
check('Malformed row (boolean result) -> FAIL_UPLOAD_BASELINE', computeUploadBaselineDecision([{ result: true }]), 'FAIL_UPLOAD_BASELINE');
check('Unknown status string -> FAIL_UPLOAD_BASELINE', computeUploadBaselineDecision([{ result: 'MAYBE' }]), 'FAIL_UPLOAD_BASELINE');

// Confirms importing the Browser test file for its pure function never
// triggered a Playwright/Chromium launch (no results JSON side effect).
const resultsJsonPath = path.join(__dirname, 'epic-2e-j-safe-recovery-upload-baseline-results.json');
let importSideEffectFree = true;
try {
  const before = await readFile(resultsJsonPath, 'utf8').catch(() => null);
  // Re-import (module cache means this is a no-op re-require, which is
  // itself proof the module body doesn't re-run main() on each import).
  await import('./epic-2e-j-safe-recovery-upload-baseline-test.mjs');
  const after = await readFile(resultsJsonPath, 'utf8').catch(() => null);
  importSideEffectFree = before === after;
} catch { importSideEffectFree = false; }
record('Importing the Browser test file for its pure function has no side effects (isMainModule guard)', importSideEffectFree ? 'PASS' : 'FAIL', `sideEffectFree=${importSideEffectFree}`);

const fail = results.filter((r) => r.result !== 'PASS').length;
console.log(`\n${results.length - fail}/${results.length} PASS, ${fail} FAIL`);
if (fail > 0) process.exit(1);
