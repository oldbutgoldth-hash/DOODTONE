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
 *
 * LOCAL-FIRST GEOMETRY R3 — Phase E3 FIX: this runner used to always
 * `process.exit(0)` regardless of any suite's outcome, which the
 * independent review correctly flagged as unusable for a local
 * pre-deploy gate ("this cannot serve as a local pre-deploy gate").
 * `npm run test:local-gate` (tools/local-gate.mjs) is now the real,
 * fail-closed gate and does NOT depend on this file. This script now
 * has two modes:
 *   - default (no flag) — `npm run test:browser`: a REAL gate. Exits
 *     non-zero if any suite exited non-zero (including an unavailable-
 *     Browser environment status).
 *   - `--report` — `npm run test:browser:report`: the OLD always-
 *     exits-0 behavior, explicitly renamed and kept ONLY for casual,
 *     non-blocking local inspection of every suite's honest per-suite
 *     results JSON. Never used as a gate anywhere in this project.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

const BROWSER_SUITES = [
  { script: 'qa/epic-2e-j-safe-recovery-upload-baseline-test.mjs', result: 'qa/epic-2e-j-safe-recovery-upload-baseline-results.json' },
  { script: 'qa/epic-2e-j-phase-c-live-app-test.mjs', result: 'qa/epic-2e-j-phase-c-live-app-results.json' },
  { script: 'qa/epic-2e-j-phase-c-observation-smoke-test.mjs', result: 'qa/epic-2e-j-phase-c-results.json' },
  { script: 'qa/epic-2e-j-phase-c-step7b-a-test.mjs', result: 'qa/epic-2e-j-phase-c-step7b-a-results.json' },
  { script: 'qa/epic-2e-j-phase-c-step7b-b-test.mjs', result: 'qa/epic-2e-j-phase-c-step7b-b-results.json', allowNotTested: /physical touch hardware/i },
  { script: 'qa/epic-2e-j-preview-geometry-decoder-render-test.mjs', result: 'qa/epic-2e-j-preview-geometry-decoder-render-results.json' },
  { script: 'qa/epic-2e-j-preview-geometry-full-app-eligible-test.mjs', result: 'qa/epic-2e-j-preview-geometry-full-app-eligible-results.json' },
  { script: 'qa/epic-2e-j-controlled-v2-browser-test.mjs', result: 'qa/epic-2e-j-controlled-v2-browser-results.json' },
  { script: 'qa/epic-2e-j-full-system-i18n-browser-test.mjs', result: 'qa/epic-2e-j-full-system-i18n-browser-results.json' },
  { script: 'qa/helpers/playwright-opaque-origin-cookie.mjs', result: 'qa/epic-2e-j-r3-cookie-compat-browser-selftest-results.json' },
  { script: 'qa/playwright-in-memory-app-smoke.mjs', result: 'qa/playwright-in-memory-app-smoke-results.json' },
  { script: 'qa/playwright-virtual-origin-smoke.mjs', result: 'qa/playwright-virtual-origin-smoke-results.json' },
];

const UNAVAILABLE = new Set(['BROWSER_BINARY_UNAVAILABLE', 'PLAYWRIGHT_PACKAGE_UNAVAILABLE']);

function inspectFreshResult(suite, startedAtMs) {
  const resultPath = path.join(PROJECT_ROOT, suite.result);
  let parsed;
  try {
    const stat = statSync(resultPath);
    if (stat.mtimeMs + 1000 < startedAtMs) return { ok: false, reason: 'result JSON was not refreshed by this run' };
    parsed = JSON.parse(readFileSync(resultPath, 'utf8'));
  } catch (error) {
    return { ok: false, reason: `result JSON missing or malformed: ${error.message}` };
  }

  const decision = typeof parsed.decision === 'string' ? parsed.decision : (typeof parsed.status === 'string' ? parsed.status : null);
  if (decision && UNAVAILABLE.has(decision)) return { ok: false, reason: `environment unavailable (${decision})` };
  const rows = Array.isArray(parsed.results) ? parsed.results : [];
  if (rows.length === 0) return { ok: false, reason: 'results array missing or empty' };
  const fail = rows.filter((row) => row?.result === 'FAIL');
  if (fail.length) return { ok: false, reason: `${fail.length} FAIL row(s)` };
  const notTested = rows.filter((row) => row?.result === 'NOT_TESTED');
  const unexpected = notTested.filter((row) => !(suite.allowNotTested && suite.allowNotTested.test(String(row?.test ?? ''))));
  if (unexpected.length) return { ok: false, reason: `${unexpected.length} unexpected NOT_TESTED row(s)` };
  if (parsed.completed === false) return { ok: false, reason: 'completed is false' };
  if (typeof decision === 'string' && /FAIL|UNAVAILABLE/i.test(decision)) return { ok: false, reason: `decision=${decision}` };
  return { ok: true, reason: 'fresh result has no FAIL/unavailable/unexpected NOT_TESTED rows' };
}

const exitCodes = {};
const evidenceChecks = {};
for (const suite of BROWSER_SUITES) {
  console.log(`\n=== ${suite.script} ===`);
  const startedAtMs = Date.now();
  const result = spawnSync(process.execPath, [path.join(PROJECT_ROOT, suite.script)], { stdio: 'inherit', cwd: PROJECT_ROOT });
  exitCodes[suite.script] = result.status;
  evidenceChecks[suite.script] = inspectFreshResult(suite, startedAtMs);
}

console.log('\n=== Browser suite exit codes (0 = suite\'s own PASS/available-and-clean, non-zero = suite reports FAIL or an unavailable-environment status — see each suite\'s own results JSON for the honest reason) ===');
console.log(JSON.stringify(exitCodes, null, 2));
console.log('\n=== Fresh result evidence checks ===');
console.log(JSON.stringify(evidenceChecks, null, 2));

const reportOnly = process.argv.includes('--report');
if (reportOnly) {
  console.log('\n(--report mode: this runner never fails CI. Use `npm run test:browser` — no flag — for a real gate, or `npm run test:local-gate` for the full fail-closed local check.)');
  process.exit(0);
}
const anyNonZero = Object.values(exitCodes).some((code) => code !== 0) || Object.values(evidenceChecks).some((check) => !check.ok);
if (anyNonZero) {
  console.log('\ntest:browser FAILED — one or more suites exited non-zero (FAIL or unavailable-Browser environment). Use `npm run test:browser:report` for a non-blocking view of the same results.');
  process.exit(1);
}
console.log('\ntest:browser PASSED — every suite exited 0.');
process.exit(0);
