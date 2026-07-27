#!/usr/bin/env node
/**
 * qa/calibration-full-suite.mjs
 *
 * EPIC 2E-K-R2-FIX1 -- Section 9: `npm run test:calibration-full`.
 *
 * Runs, in order: Preflight, the full Static suite (which already
 * includes the Storage test's pure portions is NOT true -- Storage
 * needs fake-indexeddb and is run explicitly here), the dedicated
 * Storage test, the dedicated Pixel-Truth hostile static test (already
 * also part of run-static-suites.mjs, re-run here explicitly for a
 * standalone signal), and finally the real Browser suite.
 *
 * HONESTY CONTRACT (Section 9/13's explicit requirement): this
 * aggregator NEVER prints "ALL PASSED" if the Browser step did not
 * genuinely run to completion -- a Browser step that could not run
 * (no Chromium/Chrome/Edge available) is reported as its own distinct
 * `NOT_VERIFIED` outcome, separate from a genuine PASS or FAIL, and the
 * overall exit code is non-zero whenever ANY step is not a genuine
 * PASS.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

function run(label, relScript) {
  console.log(`\n${'='.repeat(70)}\n${label}\n${'='.repeat(70)}`);
  const result = spawnSync(process.execPath, [path.join(PROJECT_ROOT, relScript)], { stdio: 'inherit', cwd: PROJECT_ROOT });
  return { label, relScript, status: result.status };
}

const steps = [];
steps.push(run('Step 1/5: Preflight', 'qa/preflight.mjs'));
steps.push(run('Step 2/5: Full Static Suite (includes Pixel-Truth hostile tests)', 'qa/run-static-suites.mjs'));
steps.push(run('Step 3/5: Calibration Lab Storage Test (real IndexedDB via fake-indexeddb, includes Migration tests)', 'qa/epic-2e-k-calibration-lab-storage-test.mjs'));
steps.push(run('Step 4/5: Pixel-Truth Hostile Static Test (standalone signal)', 'qa/epic-2e-k-r2-fix1-pixel-truth-static-test.mjs'));
const browserStep = run('Step 5/5: Calibration Lab Browser Suite (REAL Chromium -- never Conditional Pass)', 'qa/epic-2e-k-calibration-lab-browser-test.mjs');
steps.push(browserStep);

console.log(`\n${'='.repeat(70)}\nCALIBRATION FULL SUITE SUMMARY\n${'='.repeat(70)}`);
let anyFailed = false;
for (const step of steps) {
  const isBrowserStep = step.relScript === browserStep.relScript;
  let verdict;
  if (step.status === 0) verdict = 'PASS';
  else if (isBrowserStep) { verdict = 'FAIL_OR_NOT_VERIFIED (Browser suite did not exit 0 -- see its own output above for whether this was a genuine failure or an unavailable Browser environment; NEVER treat this as a silent pass)'; anyFailed = true; }
  else { verdict = 'FAIL'; anyFailed = true; }
  console.log(`${step.status === 0 ? '✓' : '✗'} ${step.label}: ${verdict} (exit ${step.status})`);
}

if (anyFailed) {
  console.log('\nOverall: NOT all steps genuinely passed. Per Section 13, this must never be reported as a closed/complete QA run.');
} else {
  console.log('\nOverall: every step, including the real Browser suite, genuinely passed.');
}
process.exit(anyFailed ? 1 : 0);
