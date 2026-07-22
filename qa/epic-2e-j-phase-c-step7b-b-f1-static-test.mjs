#!/usr/bin/env node
/**
 * qa/epic-2e-j-phase-c-step7b-b-f1-static-test.mjs
 *
 * EPIC 2E-J — Step 7B-B-F1-R.
 *
 * FIX 4: static, browser-free self-test of the pure decision function
 * in qa/epic-2e-j-phase-c-step7b-b-f1-decision.mjs. Runs under plain
 * `node` — no Chromium, no network, no DOM, no filesystem dependency
 * beyond writing its own result file.
 *
 * FIX 5: this script does NOT run, simulate, or fabricate the real
 * Chromium browser suite (qa/epic-2e-j-phase-c-step7b-b-test.mjs). The
 * output file it writes honestly records that the browser suite was
 * NOT_RUN_ENVIRONMENT_BLOCKED for this patch, and does not reuse the
 * prior 28/29 browser-suite result as evidence for the FIX 1/2/3
 * changes made in this patch (those changes have never been exercised
 * in a real browser).
 *
 * Run: node qa/epic-2e-j-phase-c-step7b-b-f1-static-test.mjs
 * Output: qa/epic-2e-j-phase-c-step7b-b-f1-static-results.json
 */

import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeStep7BBDecision, isAllowedExternalFontUrl } from './epic-2e-j-phase-c-step7b-b-f1-decision.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

const results = [];
function record(test, pass, evidence) {
  const result = pass ? 'PASS' : 'FAIL';
  results.push({ test, result, evidence });
  console.log(`${pass ? '✓' : '✗'} [${result}] ${test} — ${evidence}`);
}

// Mirrors the real exit-code rule used in
// qa/epic-2e-j-phase-c-step7b-b-test.mjs: process.exit(finalDecision === 'FAIL' ? 1 : 0)
function expectedExitCode(decision) {
  return decision === 'FAIL' ? 1 : 0;
}

// ══════════════════════════════════════════════════════════════════
// FIX 4 — Case A: all PASS => PASS, exit success.
// ══════════════════════════════════════════════════════════════════
{
  const input = [
    { test: 'Check 1', result: 'PASS' },
    { test: 'Check 2', result: 'PASS' },
    { test: 'Check 3', result: 'PASS' },
  ];
  const decision = computeStep7BBDecision(input);
  const exitCode = expectedExitCode(decision);
  record('Case A: all PASS => decision is PASS', decision === 'PASS', `decision=${decision}`);
  record('Case A: all PASS => exit code is success (0)', exitCode === 0, `exitCode=${exitCode}`);
}

// ══════════════════════════════════════════════════════════════════
// FIX 4 — Case B: one FAIL => FAIL, non-zero exit.
// ══════════════════════════════════════════════════════════════════
{
  const input = [
    { test: 'Check 1', result: 'PASS' },
    { test: 'Check 2', result: 'FAIL' },
    { test: 'Check 3', result: 'PASS' },
  ];
  const decision = computeStep7BBDecision(input);
  const exitCode = expectedExitCode(decision);
  record('Case B: one FAIL => decision is FAIL', decision === 'FAIL', `decision=${decision}`);
  record('Case B: one FAIL => exit code is non-zero', exitCode !== 0, `exitCode=${exitCode}`);
}

// ══════════════════════════════════════════════════════════════════
// FIX 4 — Case C: unexpected NOT_TESTED (Contrast) => FAIL, non-zero exit.
// ══════════════════════════════════════════════════════════════════
{
  const input = [
    { test: 'Check 1', result: 'PASS' },
    { test: 'Contrast: Status message meets 4.5:1 (WCAG AA normal text)', result: 'NOT_TESTED' },
    { test: 'Check 3', result: 'PASS' },
  ];
  const decision = computeStep7BBDecision(input);
  const exitCode = expectedExitCode(decision);
  record('Case C: unexpected NOT_TESTED (Contrast) => decision is FAIL', decision === 'FAIL', `decision=${decision}`);
  record('Case C: unexpected NOT_TESTED (Contrast) => exit code is non-zero', exitCode !== 0, `exitCode=${exitCode}`);
}

// ══════════════════════════════════════════════════════════════════
// FIX 4 — Case D: unexpected NOT_TESTED (Clear Session) => FAIL, non-zero exit.
// ══════════════════════════════════════════════════════════════════
{
  const input = [
    { test: 'Check 1', result: 'PASS' },
    { test: 'Clear Session actually clears recorded session data', result: 'NOT_TESTED' },
    { test: 'Check 3', result: 'PASS' },
  ];
  const decision = computeStep7BBDecision(input);
  const exitCode = expectedExitCode(decision);
  record('Case D: unexpected NOT_TESTED (Clear Session) => decision is FAIL', decision === 'FAIL', `decision=${decision}`);
  record('Case D: unexpected NOT_TESTED (Clear Session) => exit code is non-zero', exitCode !== 0, `exitCode=${exitCode}`);
}

// ══════════════════════════════════════════════════════════════════
// FIX 4 — Case E: only Physical touch hardware NOT_TESTED => CONDITIONAL_PASS, exit success.
// ══════════════════════════════════════════════════════════════════
{
  const input = [
    { test: 'Check 1', result: 'PASS' },
    { test: 'Physical touch hardware', result: 'NOT_TESTED' },
    { test: 'Check 3', result: 'PASS' },
  ];
  const decision = computeStep7BBDecision(input);
  const exitCode = expectedExitCode(decision);
  record('Case E: only Physical touch hardware NOT_TESTED => decision is CONDITIONAL_PASS', decision === 'CONDITIONAL_PASS', `decision=${decision}`);
  record('Case E: only Physical touch hardware NOT_TESTED => exit code is success (0)', exitCode === 0, `exitCode=${exitCode}`);
}

// ══════════════════════════════════════════════════════════════════
// FIX 4 — Case F: Physical touch hardware plus one FAIL => FAIL, non-zero exit.
// ══════════════════════════════════════════════════════════════════
{
  const input = [
    { test: 'Check 1', result: 'FAIL' },
    { test: 'Physical touch hardware', result: 'NOT_TESTED' },
    { test: 'Check 3', result: 'PASS' },
  ];
  const decision = computeStep7BBDecision(input);
  const exitCode = expectedExitCode(decision);
  record('Case F: Physical touch hardware + one FAIL => decision is FAIL', decision === 'FAIL', `decision=${decision}`);
  record('Case F: Physical touch hardware + one FAIL => exit code is non-zero', exitCode !== 0, `exitCode=${exitCode}`);
}

// ══════════════════════════════════════════════════════════════════
// Bonus (still static/pure, no Chromium): isAllowedExternalFontUrl
// allowlist sanity, including lookalike/spoofing attempts.
// ══════════════════════════════════════════════════════════════════
{
  const cases = [
    ['https://fonts.googleapis.com/css2?family=Inter', true],
    ['https://fonts.gstatic.com/s/inter/v12/abc.woff2', true],
    ['https://evil.com/fonts.googleapis.com', false],
    ['https://fonts.googleapis.com.evil.com/x', false],
    ['https://notfonts.googleapis.com/x', false],
    ['https://example.com/font.woff2', false],
    ['not-a-url', false],
    [null, false],
    [undefined, false],
    ['', false],
  ];
  let allCorrect = true;
  const failures = [];
  for (const [url, expected] of cases) {
    const actual = isAllowedExternalFontUrl(url);
    if (actual !== expected) { allCorrect = false; failures.push({ url, expected, actual }); }
  }
  record('isAllowedExternalFontUrl allows only fonts.googleapis.com/fonts.gstatic.com (lookalikes rejected)', allCorrect, allCorrect ? `${cases.length} cases checked, all correct` : JSON.stringify(failures));
}

const passCount = results.filter((r) => r.result === 'PASS').length;
const failCount = results.filter((r) => r.result === 'FAIL').length;

const output = {
  suite: 'EPIC 2E-J — Step 7B-B-F1-R FIX 4: static decision self-test (no Chromium, no network, no DOM)',
  generatedAt: new Date().toISOString(),
  summary: { total: results.length, pass: passCount, fail: failCount },
  results,
  // FIX 5 — honest environment status. This static self-test exercises
  // ONLY the pure decision function and the pure URL allowlist — it
  // does NOT execute, simulate, or infer anything about the real
  // Chromium browser suite (qa/epic-2e-j-phase-c-step7b-b-test.mjs).
  browserSuiteExecution: {
    status: 'NOT_RUN_ENVIRONMENT_BLOCKED',
    reason: 'This sandbox cannot download or launch a Chromium binary (network allowlist blocks the Playwright browser download host, and no system browser is available). The FIX 1/2/3 changes to qa/epic-2e-j-phase-c-step7b-b-test.mjs (fail-closed decision wiring, console/resource listeners, required result rows) were NOT executed in a real browser for this patch.',
    doesNotClaim: [
      'PASS for the browser suite',
      'that qa/epic-2e-j-phase-c-step7b-b-results.json on disk (28/29, from a PRIOR run before this patch) is evidence for the FIX 1/2/3 changes made here',
      'any Console/Resource runtime counts (zero or otherwise) from an actual run',
    ],
    finalPhaseCDecisionRegenerated: false,
  },
};
await writeFile(path.join(PROJECT_ROOT, 'qa', 'epic-2e-j-phase-c-step7b-b-f1-static-results.json'), JSON.stringify(output, null, 2));
console.log(`\n${passCount}/${results.length} PASS, ${failCount} FAIL`);
console.log('Browser suite execution: NOT_RUN_ENVIRONMENT_BLOCKED (see output JSON)');
process.exit(failCount > 0 ? 1 : 0);
