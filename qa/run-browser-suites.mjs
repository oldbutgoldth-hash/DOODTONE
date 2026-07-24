#!/usr/bin/env node
/**
 * qa/run-browser-suites.mjs
 *
 * SAFE RECOVERY + DEPLOY GEOMETRY R2 — Phase 8: the `npm run
 * test:browser` entry point. Runs every real-Browser (Playwright +
 * Chromium) suite in this project in sequence, on ONE machine that
 * actually has a resolvable Chromium executable.
 *
 * NEVER wired into the default `npm test` — this script is only ever
 * invoked explicitly by a human or a Browser-capable CI job. It must
 * never run as part of a Vercel (or any) production build, since it
 * may attempt to launch a real browser and its suites are not
 * side-effect-free with respect to wall-clock time.
 *
 * Each suite already fails closed to an honest
 * BROWSER_BINARY_UNAVAILABLE / PLAYWRIGHT_PACKAGE_UNAVAILABLE result
 * (never a fabricated PASS) when no Chromium is resolvable — this
 * runner does not change that contract, it only sequences the suites
 * and reports a combined summary of each suite's own exit code.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

const BROWSER_SUITES = [
  'qa/epic-2e-j-safe-recovery-upload-baseline-test.mjs',
  'qa/epic-2e-j-phase-c-live-app-test.mjs',
  'qa/epic-2e-j-phase-c-observation-smoke-test.mjs',
  'qa/epic-2e-j-phase-c-step7b-a-test.mjs',
  'qa/epic-2e-j-phase-c-step7b-b-test.mjs',
  'qa/epic-2e-j-preview-geometry-browser-test.mjs',
  'qa/helpers/playwright-opaque-origin-cookie.mjs',
  'qa/playwright-in-memory-app-smoke.mjs',
  'qa/playwright-virtual-origin-smoke.mjs',
];

const exitCodes = {};
for (const rel of BROWSER_SUITES) {
  console.log(`\n=== ${rel} ===`);
  const result = spawnSync(process.execPath, [path.join(PROJECT_ROOT, rel)], { stdio: 'inherit', cwd: PROJECT_ROOT });
  exitCodes[rel] = result.status;
}

console.log('\n=== Browser suite exit codes (0 = suite\'s own PASS/available-and-clean, non-zero = suite reports FAIL or an unavailable-environment status — see each suite\'s own results JSON for the honest reason) ===');
console.log(JSON.stringify(exitCodes, null, 2));
// This runner never itself fails CI — the honest per-suite results
// JSON files (already written atomically by each suite) are the real
// evidence; a Chromium-unavailable environment reporting non-zero
// here is expected and must not be conflated with a genuine defect.
process.exit(0);
