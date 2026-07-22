#!/usr/bin/env node
/**
 * qa/epic-2e-j-phase-c-step7b-b-f1-static-test.mjs
 *
 * EPIC 2E-J — Step 7B-B-F1-R, extended by Step 7B-B-F1-R2 (Malformed
 * Decision Input and URL Protocol Final Lock).
 *
 * FIX 4: static, browser-free self-test of the pure decision function
 * in qa/epic-2e-j-phase-c-step7b-b-f1-decision.mjs — cases A-F (F1-R)
 * plus cases G-R (F1-R2: malformed result containers/rows, malformed
 * permittedNotTested, and URL-protocol restriction). Runs under plain
 * `node` — no Chromium, no network, no DOM, no filesystem dependency
 * beyond writing its own result file.
 *
 * FIX 5: this script does NOT run, simulate, or fabricate the real
 * Chromium browser suite (qa/epic-2e-j-phase-c-step7b-b-test.mjs). The
 * output file it writes honestly records the LIVE Browser environment
 * status (COMBINED CLOSEOUT R1 Phase F — computed via
 * detectPlaywrightPackage()/detectBrowserExecutable(), never the
 * retired NOT_RUN_ENVIRONMENT_BLOCKED literal), and never reuses a
 * prior browser-suite result as evidence for changes made in a later
 * patch.
 *
 * Run: node qa/epic-2e-j-phase-c-step7b-b-f1-static-test.mjs
 * Output: qa/epic-2e-j-phase-c-step7b-b-f1-static-results.json
 */

import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeStep7BBDecision, isAllowedExternalFontUrl } from './epic-2e-j-phase-c-step7b-b-f1-decision.mjs';
// COMBINED CLOSEOUT R1 — Phase F: the legacy NOT_RUN_ENVIRONMENT_BLOCKED
// term is retired. The real Browser environment status is now computed
// LIVE via the same detectPlaywrightPackage()/detectBrowserExecutable()
// helpers every other suite in this project uses, rather than a
// hard-coded literal.
import { detectPlaywrightPackage, detectBrowserExecutable } from './helpers/playwright-lumixa-test-runtime.mjs';

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
// Step 7B-B-F1-R2 FIX 1 — fail-closed on invalid result containers.
// Every malformed-decision case here must produce decision FAIL and an
// expected non-zero exit code — malformed input can never produce PASS
// or CONDITIONAL_PASS by accident.
// ══════════════════════════════════════════════════════════════════

// Case G: empty results Array.
{
  const decision = computeStep7BBDecision([]);
  const exitCode = expectedExitCode(decision);
  record('Case G: empty results Array => decision is FAIL', decision === 'FAIL', `decision=${decision}`);
  record('Case G: empty results Array => exit code is non-zero', exitCode !== 0, `exitCode=${exitCode}`);
}

// Case H: null results.
{
  const decision = computeStep7BBDecision(null);
  const exitCode = expectedExitCode(decision);
  record('Case H: null results => decision is FAIL', decision === 'FAIL', `decision=${decision}`);
  record('Case H: null results => exit code is non-zero', exitCode !== 0, `exitCode=${exitCode}`);
}

// Case I: undefined results.
{
  const decision = computeStep7BBDecision(undefined);
  const exitCode = expectedExitCode(decision);
  record('Case I: undefined results => decision is FAIL', decision === 'FAIL', `decision=${decision}`);
  record('Case I: undefined results => exit code is non-zero', exitCode !== 0, `exitCode=${exitCode}`);
}

// Case J: malformed result status (not PASS/FAIL/NOT_TESTED).
{
  const decision = computeStep7BBDecision([{ test: 'x', result: 'UNKNOWN' }]);
  const exitCode = expectedExitCode(decision);
  record('Case J: malformed result status ("UNKNOWN") => decision is FAIL', decision === 'FAIL', `decision=${decision}`);
  record('Case J: malformed result status ("UNKNOWN") => exit code is non-zero', exitCode !== 0, `exitCode=${exitCode}`);
}

// Case K: missing result field.
{
  const decision = computeStep7BBDecision([{ test: 'x' }]);
  const exitCode = expectedExitCode(decision);
  record('Case K: missing result field => decision is FAIL', decision === 'FAIL', `decision=${decision}`);
  record('Case K: missing result field => exit code is non-zero', exitCode !== 0, `exitCode=${exitCode}`);
}

// Case L: missing test field.
{
  const decision = computeStep7BBDecision([{ result: 'PASS' }]);
  const exitCode = expectedExitCode(decision);
  record('Case L: missing test field => decision is FAIL', decision === 'FAIL', `decision=${decision}`);
  record('Case L: missing test field => exit code is non-zero', exitCode !== 0, `exitCode=${exitCode}`);
}

// Case M: blank test field.
{
  const decision = computeStep7BBDecision([{ test: '   ', result: 'PASS' }]);
  const exitCode = expectedExitCode(decision);
  record('Case M: blank test field => decision is FAIL', decision === 'FAIL', `decision=${decision}`);
  record('Case M: blank test field => exit code is non-zero', exitCode !== 0, `exitCode=${exitCode}`);
}

// Case N: null row.
{
  const decision = computeStep7BBDecision([null]);
  const exitCode = expectedExitCode(decision);
  record('Case N: null row => decision is FAIL', decision === 'FAIL', `decision=${decision}`);
  record('Case N: null row => exit code is non-zero', exitCode !== 0, `exitCode=${exitCode}`);
}

// Case O: malformed permittedNotTested must not throw and must not
// broaden the permitted set. A single hostile string (not an Array) is
// passed as the override; it must be rejected in favor of the safe
// default — which does NOT include "Contrast: Status message" — so the
// NOT_TESTED row below is correctly treated as unexpected and FAILs,
// proving the malformed override could not sneak it through.
{
  const input = [
    { test: 'Check 1', result: 'PASS' },
    { test: 'Contrast: Status message', result: 'NOT_TESTED' },
  ];
  const hostilePermittedNotTested = 'Contrast: Status message'; // malformed: a string, not an Array
  let threw = false;
  let decision;
  try {
    decision = computeStep7BBDecision(input, hostilePermittedNotTested);
  } catch {
    threw = true;
  }
  const exitCode = threw ? 1 : expectedExitCode(decision);
  record('Case O: malformed permittedNotTested does not throw', !threw, `threw=${threw}`);
  record('Case O: malformed permittedNotTested cannot broaden the permitted set => decision is FAIL', decision === 'FAIL', `decision=${decision}`);
  record('Case O: malformed permittedNotTested => exit code is non-zero', exitCode !== 0, `exitCode=${exitCode}`);
}

// ══════════════════════════════════════════════════════════════════
// Existing normal-behavior regression (still holds after FIX 1/2):
// all-PASS still PASSes, and only Physical touch hardware NOT_TESTED
// still yields CONDITIONAL_PASS — malformed-input hardening must not
// have broken the legitimate paths.
// ══════════════════════════════════════════════════════════════════
{
  const decision = computeStep7BBDecision([{ test: 'Check 1', result: 'PASS' }, { test: 'Check 2', result: 'PASS' }]);
  record('Regression: all PASS still => PASS after FIX 1/2 hardening', decision === 'PASS', `decision=${decision}`);
}
{
  const decision = computeStep7BBDecision([{ test: 'Check 1', result: 'PASS' }, { test: 'Physical touch hardware', result: 'NOT_TESTED' }]);
  record('Regression: only Physical touch hardware NOT_TESTED still => CONDITIONAL_PASS after FIX 1/2 hardening', decision === 'CONDITIONAL_PASS', `decision=${decision}`);
}

// ══════════════════════════════════════════════════════════════════
// isAllowedExternalFontUrl allowlist sanity, including lookalike/
// spoofing attempts and (Step 7B-B-F1-R2 FIX 3) protocol restriction.
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

// FIX 3 — Case P: FTP scheme on an otherwise-allowed host must be rejected.
{
  const actual = isAllowedExternalFontUrl('ftp://fonts.googleapis.com/x');
  record('Case P: FTP allowed-host URL ("ftp://fonts.googleapis.com/x") => rejected', actual === false, `actual=${actual}`);
}

// FIX 3 — Case Q: javascript: scheme on an otherwise-allowed host must be rejected.
{
  const actual = isAllowedExternalFontUrl('javascript://fonts.googleapis.com/x');
  record('Case Q: JavaScript scheme URL ("javascript://fonts.googleapis.com/x") => rejected', actual === false, `actual=${actual}`);
}

// FIX 3 — Case R: data: URL must be rejected.
{
  const actual = isAllowedExternalFontUrl('data:text/plain,fonts.googleapis.com');
  record('Case R: Data URL ("data:text/plain,fonts.googleapis.com") => rejected', actual === false, `actual=${actual}`);
}

const passCount = results.filter((r) => r.result === 'PASS').length;
const failCount = results.filter((r) => r.result === 'FAIL').length;

// COMBINED CLOSEOUT R1 — Phase F: LIVE Browser environment status,
// computed fresh every run rather than a hard-coded legacy literal.
const livePkgStatus = await detectPlaywrightPackage();
const liveExeStatus = await detectBrowserExecutable(livePkgStatus.mod ? livePkgStatus.mod.chromium : null);
const liveBrowserStatus = liveExeStatus.found ? 'BROWSER_BINARY_AVAILABLE' : 'BROWSER_BINARY_UNAVAILABLE';

const output = {
  suite: 'EPIC 2E-J — Step 7B-B-F1-R / F1-R2: static decision self-test (no Chromium, no network, no DOM)',
  generatedAt: new Date().toISOString(),
  summary: { total: results.length, pass: passCount, fail: failCount },
  results,
  // FIX 5 / COMBINED CLOSEOUT R1 Phase F — honest, LIVE environment
  // status. This static self-test exercises ONLY the pure decision
  // function and the pure URL allowlist — it does NOT execute,
  // simulate, or infer anything about the real Chromium browser suite
  // (qa/epic-2e-j-phase-c-step7b-b-test.mjs). The legacy
  // NOT_RUN_ENVIRONMENT_BLOCKED term is retired in favor of a live
  // detection result.
  browserSuiteExecution: {
    status: liveBrowserStatus,
    packageStatus: livePkgStatus.status,
    reason: 'This static self-test never executes, simulates, or fabricates the real Chromium browser suite regardless of whether a Browser binary is currently available — Browser availability is reported honestly here for diagnostic purposes only. The FIX 1/2/3 changes to qa/epic-2e-j-phase-c-step7b-b-test.mjs (fail-closed decision wiring, console/resource listeners, required result rows) were NOT executed by THIS static suite.',
    doesNotClaim: [
      'PASS for the browser suite',
      'that any prior qa/epic-2e-j-phase-c-step7b-b-results.json on disk is evidence for changes made in a later patch',
      'any Console/Resource runtime counts (zero or otherwise) from an actual run',
    ],
    finalPhaseCDecisionRegenerated: false,
  },
};
await writeFile(path.join(PROJECT_ROOT, 'qa', 'epic-2e-j-phase-c-step7b-b-f1-static-results.json'), JSON.stringify(output, null, 2));
console.log(`\n${passCount}/${results.length} PASS, ${failCount} FAIL`);
console.log(`Browser suite execution: ${liveBrowserStatus} (see output JSON)`);
process.exit(failCount > 0 ? 1 : 0);
