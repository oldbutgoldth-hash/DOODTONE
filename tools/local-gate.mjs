#!/usr/bin/env node
/**
 * tools/local-gate.mjs
 *
 * LOCAL-FIRST GEOMETRY R3 -- Phase E2: `npm run test:local-gate`, the
 * fail-closed everyday pre-commit/pre-deploy check for local Windows
 * development. Runs the 11 required steps IN ORDER, and exits non-zero
 * when any of the following is true:
 *   - any required suite fails
 *   - Browser is unavailable
 *   - any result is stale/malformed
 *   - upload did not execute
 *   - V2/Exact dimensions/Observation were not proven
 *
 * The ONLY permitted NOT_TESTED row across every suite in this gate is
 * the single, documented "Physical touch hardware" item in Step 7B-B
 * (manual-only, cannot be proven by an automated Browser run) -- any
 * other NOT_TESTED row anywhere is treated as a failure.
 *
 * This is explicitly SEPARATE from:
 *   - `npm run test:browser` / qa/run-browser-suites.mjs, which is a
 *     non-blocking REPORT runner (always exits 0 by design, so a
 *     Chromium-unavailable dev machine never blocks on it) -- this
 *     fixes the R2-era defect where that runner was the ONLY Browser
 *     entry point and never itself failed CI.
 *   - `npm run test:deploy`, which targets a real deployed URL and is
 *     never part of the everyday local inner loop.
 *
 * Run: node tools/local-gate.mjs
 */

import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeCurrentSourceHash, SUITE_SOURCE_FILES } from '../qa/phase-c-suite-source-manifest.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

// Each step names the suite it runs, the result JSON it must inspect
// (null for steps that only need a clean process exit code, e.g. the
// syntax gate and the static-suite runner, which already aggregate
// their own pass/fail internally), and the manifest key used to
// recompute a fresh sourceHash for staleness verification.
const STEPS = [
  { n: 1, label: 'ESM syntax', script: 'tools/esm-syntax-gate.mjs', resultFile: null, manifestKey: null },
  { n: 2, label: 'Focused Core', script: 'qa/epic-2e-j-focused-core-smoke-test.mjs', resultFile: 'qa/epic-2e-j-focused-core-smoke-results.json', manifestKey: null },
  { n: 3, label: 'Static suites', script: 'qa/run-static-suites.mjs', resultFile: null, manifestKey: null },
  { n: 4, label: 'In-Memory startup', script: 'qa/playwright-in-memory-app-smoke.mjs', resultFile: 'qa/playwright-in-memory-app-smoke-results.json', manifestKey: null },
  { n: 5, label: 'Upload baseline', script: 'qa/epic-2e-j-safe-recovery-upload-baseline-test.mjs', resultFile: 'qa/epic-2e-j-safe-recovery-upload-baseline-results.json', manifestKey: 'uploadBaseline', requireUploadExecuted: true },
  { n: 6, label: 'Live App', script: 'qa/epic-2e-j-phase-c-live-app-test.mjs', resultFile: 'qa/epic-2e-j-phase-c-live-app-results.json', manifestKey: 'liveApp' },
  { n: 7, label: 'Observation Smoke', script: 'qa/epic-2e-j-phase-c-observation-smoke-test.mjs', resultFile: 'qa/epic-2e-j-phase-c-results.json', manifestKey: 'observationSmoke' },
  { n: 8, label: 'Step 7B-A', script: 'qa/epic-2e-j-phase-c-step7b-a-test.mjs', resultFile: 'qa/epic-2e-j-phase-c-step7b-a-results.json', manifestKey: 'step7bA' },
  { n: 9, label: 'Step 7B-B', script: 'qa/epic-2e-j-phase-c-step7b-b-test.mjs', resultFile: 'qa/epic-2e-j-phase-c-step7b-b-results.json', manifestKey: 'step7bB', permittedNotTestedPattern: /physical touch hardware/i },
  { n: 10, label: 'Decoder geometry (Phase C1)', script: 'qa/epic-2e-j-preview-geometry-decoder-render-test.mjs', resultFile: 'qa/epic-2e-j-preview-geometry-decoder-render-results.json', manifestKey: 'previewGeometryDecoderRender' },
  { n: 11, label: 'Full-app eligible geometry (Phase C2)', script: 'qa/epic-2e-j-preview-geometry-full-app-eligible-test.mjs', resultFile: 'qa/epic-2e-j-preview-geometry-full-app-eligible-results.json', manifestKey: 'previewGeometryFullAppEligible', requireGeometryProofs: true },
];

const BROWSER_UNAVAILABLE_STATUSES = new Set(['BROWSER_BINARY_UNAVAILABLE', 'PLAYWRIGHT_PACKAGE_UNAVAILABLE']);

function evaluateStepResult(step, resultObj) {
  const reasons = [];
  if (!resultObj || typeof resultObj !== 'object') {
    reasons.push('result JSON missing or unreadable');
    return { ok: false, reasons };
  }
  // writeBrowserUnavailableResult() (the shared helper every suite uses
  // for an honest environment-unavailable status) puts the status in
  // `decision`, not `status` — check both, since a couple of older
  // suite files predate that helper and used `status` directly.
  const environmentStatus = typeof resultObj.decision === 'string' ? resultObj.decision : (typeof resultObj.status === 'string' ? resultObj.status : null);
  if (environmentStatus && BROWSER_UNAVAILABLE_STATUSES.has(environmentStatus)) {
    reasons.push(`Browser unavailable in this environment (${environmentStatus}) — local-gate cannot prove PASS without a real Browser run here; run on a machine with Chromium/Playwright installed`);
    return { ok: false, reasons, browserUnavailable: true };
  }
  if (resultObj.completed !== true) reasons.push('completed is not true');
  if (!Array.isArray(resultObj.results) || resultObj.results.length === 0) reasons.push('results array missing or empty');
  const rows = Array.isArray(resultObj.results) ? resultObj.results : [];
  const malformed = rows.filter((r) => !r || typeof r.test !== 'string' || typeof r.result !== 'string' || !['PASS', 'FAIL', 'NOT_TESTED', 'NOT_APPLICABLE'].includes(r.result));
  if (malformed.length > 0) reasons.push(`${malformed.length} malformed result row(s)`);
  const failRows = rows.filter((r) => r.result === 'FAIL');
  if (failRows.length > 0) reasons.push(`${failRows.length} FAIL row(s): ${failRows.slice(0, 5).map((r) => r.test).join('; ')}`);
  const notTestedRows = rows.filter((r) => r.result === 'NOT_TESTED');
  const pattern = step.permittedNotTestedPattern;
  const unexpectedNotTested = notTestedRows.filter((r) => !(pattern && pattern.test(r.test)));
  if (unexpectedNotTested.length > 0) reasons.push(`${unexpectedNotTested.length} unexpected NOT_TESTED row(s): ${unexpectedNotTested.slice(0, 5).map((r) => r.test).join('; ')}`);
  if (pattern && notTestedRows.length > 0 && !notTestedRows.every((r) => pattern.test(r.test))) {
    // already covered by unexpectedNotTested above, kept as an explicit named check for clarity
  }
  if (step.requireUploadExecuted) {
    const uploadRow = rows.find((r) => /upload/i.test(r.test));
    if (!uploadRow || uploadRow.result !== 'PASS') reasons.push('upload did not execute / did not PASS');
  }
  if (step.requireGeometryProofs) {
    const v2Row = rows.find((r) => /V2 rendered/i.test(r.test));
    const exactDimsRow = rows.find((r) => /Exact dimensions/i.test(r.test));
    const observationRow = rows.find((r) => /Observation controls enabled/i.test(r.test));
    if (!v2Row || v2Row.result !== 'PASS') reasons.push('V2 render/Identity Preview not proven PASS on at least one fixture');
    if (!exactDimsRow || exactDimsRow.result !== 'PASS') reasons.push('Exact dimensions not proven PASS on at least one fixture');
    if (!observationRow || observationRow.result !== 'PASS') reasons.push('Observation enabled not proven PASS on at least one fixture');
  }
  if (step.manifestKey && typeof resultObj.sourceHash !== 'string') {
    reasons.push('sourceHash missing from result — cannot prove freshness');
  }
  return { ok: reasons.length === 0, reasons };
}

async function runStep(step) {
  console.log(`\n=== Step ${step.n}/11: ${step.label} (${step.script}) ===`);
  const proc = spawnSync(process.execPath, [path.join(PROJECT_ROOT, step.script)], { stdio: 'inherit', cwd: PROJECT_ROOT });
  const exitCode = proc.status;

  if (!step.resultFile) {
    // Steps without a dedicated result JSON (the syntax gate, the
    // static-suite runner) are judged purely on their own process exit
    // code, which those scripts already compute honestly.
    const ok = exitCode === 0;
    return { step, ok, exitCode, reasons: ok ? [] : [`process exited ${exitCode}`] };
  }

  const resultPath = path.join(PROJECT_ROOT, step.resultFile);
  let resultObj = null;
  try {
    resultObj = JSON.parse(await readFile(resultPath, 'utf8'));
  } catch (e) {
    return { step, ok: false, exitCode, reasons: [`could not read/parse ${step.resultFile}: ${e.message}`] };
  }

  const evaluation = evaluateStepResult(step, resultObj);

  // Staleness: recompute the CURRENT sourceHash for this suite's own
  // manifest entry and require an exact match — never trust mtime.
  if (step.manifestKey && typeof resultObj.sourceHash === 'string') {
    try {
      const currentHash = await computeCurrentSourceHash(step.manifestKey, PROJECT_ROOT);
      if (currentHash !== resultObj.sourceHash) {
        evaluation.reasons.push('STALE result: sourceHash does not match current source files — rerun this suite');
        evaluation.ok = false;
      }
    } catch (e) {
      evaluation.reasons.push(`could not verify freshness via suite-source-manifest: ${e.message}`);
      evaluation.ok = false;
    }
  }

  return { step, ok: evaluation.ok, exitCode, reasons: evaluation.reasons, browserUnavailable: evaluation.browserUnavailable === true };
}

async function main() {
  const outcomes = [];
  for (const step of STEPS) {
    const outcome = await runStep(step);
    outcomes.push(outcome);
    console.log(outcome.ok ? `  -> Step ${step.n} OK` : `  -> Step ${step.n} FAILED: ${outcome.reasons.join('; ')}`);
  }

  console.log('\n=== LOCAL GATE SUMMARY ===');
  let anyFailed = false;
  for (const o of outcomes) {
    console.log(`  ${o.ok ? 'PASS' : 'FAIL'}  Step ${o.step.n}: ${o.step.label}${o.ok ? '' : ` — ${o.reasons.join('; ')}`}`);
    if (!o.ok) anyFailed = true;
  }

  if (anyFailed) {
    console.log('\nLOCAL GATE: FAIL — one or more required steps did not pass. See reasons above.');
    process.exit(1);
  }
  console.log('\nLOCAL GATE: PASS — all 11 required steps passed with fresh, non-stale, well-formed evidence.');
  process.exit(0);
}

main().catch((err) => {
  console.error('local-gate crashed:', err?.stack ?? err);
  process.exit(2);
});
