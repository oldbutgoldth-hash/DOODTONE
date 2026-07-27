#!/usr/bin/env node
/**
 * qa/epic-2e-k-r2-fix2-browser-contract-static-test.mjs
 *
 * EPIC 2E-K-R2-FIX2 -- Section 7: Browser Detection Contract.
 *
 * Reported bug #8: detectBrowserExecutable() returned only
 * `{found, versionOutput, attempts}`, while qa/preflight.mjs read
 * `detection.available` (always undefined -> always falsy) and
 * qa/epic-2e-k-calibration-lab-browser-test.mjs read
 * `chromiumInfo.executablePath` (also always undefined) -- so BOTH
 * callers treated a genuinely-present Chromium as absent (bug #9:
 * BROWSER_BINARY_UNAVAILABLE reported even when a real binary exists).
 *
 * This suite proves the unified contract genuinely holds, in BOTH the
 * "not found" and "found" cases -- using a REAL executable file (a
 * temporary shell script that prints a fake `--version` string) so the
 * "found" path is exercised through the actual execFile()/isExecutableFile()
 * code, never mocked/stubbed.
 *
 * No Browser, no Chromium install required -- safe for
 * run-static-suites.mjs.
 */
import { detectBrowserExecutable, detectPlaywrightPackage } from './helpers/playwright-lumixa-test-runtime.mjs';
import { readFile } from 'node:fs/promises';

let passCount = 0, failCount = 0;
function record(test, ok, evidence) {
  const icon = ok ? '✓' : '✗';
  const status = ok ? 'PASS' : 'FAIL';
  if (ok) passCount++; else failCount++;
  const safeEvidence = (() => { try { return JSON.stringify(evidence); } catch { return String(evidence); } })();
  console.log(`${icon} [${status}] ${test} — ${safeEvidence}`);
}

async function main() {
  // --- Case 1: deterministically NOT found, independent of the host machine. ---
  const savedEnvPath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  delete process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  const notFound = await detectBrowserExecutable(null, { candidatePaths: [], includeSystemCandidates: false, environment: {} });
  record('NOT-FOUND case: executablePath === found', notFound.executablePath === notFound.found, { executablePath: notFound.executablePath, found: notFound.found });
  record('NOT-FOUND case: available === Boolean(found)', notFound.available === Boolean(notFound.found), { available: notFound.available, found: notFound.found });
  record('NOT-FOUND case: found is null, available is false with injected empty candidates', notFound.found === null && notFound.available === false, { notFound });
  record('NOT-FOUND case: attempts array is empty because host candidates were explicitly disabled', Array.isArray(notFound.attempts) && notFound.attempts.length === 0, { attemptCount: notFound.attempts?.length });

  // --- Case 2: genuinely FOUND, using the current Node executable. ---
  // process.execPath is a real executable on Windows, macOS and Linux and
  // responds to --version, so this test is deterministic and does not depend
  // on shell-script execution semantics.
  const fakeBinaryPath = process.execPath;
  const found = await detectBrowserExecutable(null, {
    candidatePaths: [{ label: 'cross-platform executable fixture', path: fakeBinaryPath }],
    includeSystemCandidates: false,
    environment: {},
  });
  record('FOUND case: executablePath === found', found.executablePath === found.found, { executablePath: found.executablePath, found: found.found });
  record('FOUND case: available === Boolean(found)', found.available === Boolean(found.found), { available: found.available, found: found.found });
  record('FOUND case: found equals the real cross-platform executable fixture', found.found === fakeBinaryPath, { found: found.found, fakeBinaryPath });
  record('FOUND case: available is true, executablePath is a non-empty string', found.available === true && typeof found.executablePath === 'string' && found.executablePath.length > 0, { found });
  // Windows may normalize the executable version through PowerShell's
  // ProductVersion (for example `22.16.0.0`) while Node's `--version`
  // returns `v22.16.0`. Both are truthful representations of the same
  // executable version. Compare the semantic numeric core rather than
  // requiring one platform-specific display format.
  const normalizeVersion = (value) => String(value || '')
    .trim()
    .replace(/^v/i, '')
    .split('.')
    .map(part => String(Number.parseInt(part, 10)))
    .filter(part => part !== 'NaN');
  const actualVersionParts = normalizeVersion(found.versionOutput);
  const expectedVersionParts = normalizeVersion(process.version);
  const sameSemanticNodeVersion = expectedVersionParts.length >= 3
    && actualVersionParts.length >= 3
    && expectedVersionParts.slice(0, 3).join('.') === actualVersionParts.slice(0, 3).join('.');
  record('FOUND case: versionOutput identifies the real executable version across Windows/macOS/Linux formatting', sameSemanticNodeVersion, {
    versionOutput: found.versionOutput,
    expected: process.version,
    actualVersionParts,
    expectedVersionParts,
  });

  // Restore original env state.
  if (savedEnvPath === undefined) delete process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  else process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = savedEnvPath;

  // --- Contract consumers: structural proof both callers now read the SAME field names ---
  const preflightSrc = await readFile(new URL('./preflight.mjs', import.meta.url), 'utf8');
  record('qa/preflight.mjs reads detection.available (the unified contract field, never a nonexistent field)', preflightSrc.includes('detection?.available'), {});
  record('qa/preflight.mjs no longer imports { chromium } from \'playwright\' at the top level (Section 8)', !/^import\s*\{\s*chromium\s*\}\s*from\s*['"]playwright['"]/m.test(preflightSrc), {});

  const browserTestSrc = await readFile(new URL('./epic-2e-k-calibration-lab-browser-test.mjs', import.meta.url), 'utf8');
  record('qa/epic-2e-k-calibration-lab-browser-test.mjs reads chromiumInfo.executablePath (the unified contract field)', browserTestSrc.includes('chromiumInfo.executablePath'), {});

  // --- Windows candidate paths present for cross-platform parity (Section 7's explicit requirement) ---
  const runtimeSrc = await readFile(new URL('./helpers/playwright-lumixa-test-runtime.mjs', import.meta.url), 'utf8');
  record('detectBrowserExecutable() includes Windows Chrome/Edge candidate paths (process.platform === \'win32\' branch)', runtimeSrc.includes("process.platform === 'win32'") && runtimeSrc.includes('chrome.exe') && runtimeSrc.includes('msedge.exe'), {});
  record('detectBrowserExecutable() still includes bundled Playwright Chromium support (chromium.executablePath())', runtimeSrc.includes('chromium.executablePath'), {});
  record('detectBrowserExecutable() still includes /usr/bin/chromium for real Linux detection', runtimeSrc.includes("/usr/bin/chromium'"), {});

  // --- detectPlaywrightPackage() sanity (used by the fixed preflight.mjs instead of a top-level import) ---
  const pkg = await detectPlaywrightPackage();
  record('detectPlaywrightPackage() resolves with a genuine status in this environment', pkg.status === 'PLAYWRIGHT_PACKAGE_AVAILABLE' || pkg.status === 'PLAYWRIGHT_PACKAGE_UNAVAILABLE', { status: pkg.status });

  console.log(`\n${passCount} PASS, ${failCount} FAIL`);
  if (failCount > 0) process.exit(1);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
