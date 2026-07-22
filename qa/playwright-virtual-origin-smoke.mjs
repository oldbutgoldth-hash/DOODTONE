#!/usr/bin/env node
/**
 * qa/playwright-virtual-origin-smoke.mjs
 *
 * EPIC 2E-J — ENV-B1A-R: Virtual-Origin Harness Recovery — ENVIRONMENT
 * WORK ONLY. Verifies (honestly, never fabricating a Browser launch)
 * whether this sandbox can drive a real Playwright Chromium session
 * against this project's own files served under a stable virtual
 * origin (http://lumixa.test) instead of localhost/127.0.0.1/a local
 * HTTP server. Does NOT test full Step 7B-B Observation behavior —
 * that remains the job of the existing Browser test suite.
 *
 * Run: node qa/playwright-virtual-origin-smoke.mjs
 * Output: qa/playwright-virtual-origin-smoke-results.json
 */

import { writeFile, mkdir, access } from 'node:fs/promises';
import { constants as FS_CONSTANTS } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const ORIGIN = 'http://lumixa.test';
const NAV_URL = `${ORIGIN}/index.html?qa=1`;

const results = [];
function record(test, result, evidence) {
  results.push({ test, result, evidence });
  const icon = result === 'PASS' ? '✓' : result === 'FAIL' ? '✗' : '•';
  console.log(`${icon} [${result}] ${test} — ${evidence}`);
}

// ── PART 1 — Playwright Node package resolvability ───────────────────
// A missing NODE PACKAGE is distinct from a missing BROWSER BINARY —
// these are recorded as two entirely separate outcomes.
async function detectPlaywrightPackage() {
  try {
    const mod = await import('playwright');
    return { status: 'PLAYWRIGHT_PACKAGE_AVAILABLE', mod };
  } catch (e) {
    return { status: 'PLAYWRIGHT_PACKAGE_UNAVAILABLE', error: String((e && e.message) || e) };
  }
}

// ── PART 2 — Browser executable detection (never downloads one) ─────
async function isExecutableFile(candidatePath) {
  try {
    await access(candidatePath, FS_CONSTANTS.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function detectBrowserExecutable(chromium) {
  const candidates = [];
  if (typeof process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH === 'string' && process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH.length > 0) {
    candidates.push({ label: 'PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH env var', path: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });
  }
  try {
    const bundled = chromium && typeof chromium.executablePath === 'function' ? chromium.executablePath() : null;
    if (typeof bundled === 'string' && bundled.length > 0) candidates.push({ label: 'Playwright bundled Chromium', path: bundled });
  } catch { /* bundled path resolution itself can throw when nothing is installed — skip, never crash */ }
  candidates.push(
    { label: '/usr/bin/chromium', path: '/usr/bin/chromium' },
    { label: '/usr/bin/chromium-browser', path: '/usr/bin/chromium-browser' },
    { label: '/usr/bin/google-chrome', path: '/usr/bin/google-chrome' },
    { label: '/usr/bin/google-chrome-stable', path: '/usr/bin/google-chrome-stable' },
    { label: '/opt/google/chrome/chrome', path: '/opt/google/chrome/chrome' },
  );

  const attempts = [];
  for (const candidate of candidates) {
    const exists = await isExecutableFile(candidate.path);
    if (!exists) {
      attempts.push({ ...candidate, exists: false, versionOutput: null });
      continue;
    }
    try {
      const { stdout } = await execFileAsync(candidate.path, ['--version'], { timeout: 8000 });
      attempts.push({ ...candidate, exists: true, versionOutput: stdout.trim() });
      return { found: candidate.path, versionOutput: stdout.trim(), attempts };
    } catch (e) {
      attempts.push({ ...candidate, exists: true, versionOutput: null, versionError: String((e && e.message) || e) });
    }
  }
  return { found: null, versionOutput: null, attempts };
}

// ── PART 9 — route security self-test targets ────────────────────────
const TRAVERSAL_PATHS = [
  '/../secret.txt',
  '/%2e%2e/secret.txt',
  '/qa/../../secret.txt',
  '/qa/%2e%2e/%2e%2e/secret.txt',
  '/qa%2f..%2fsecret.txt',
  '/qa%5c..%5csecret.txt',
  '/C:%5csecret.txt',
  '/%00secret.txt',
];

async function main() {
  await mkdir(path.join(PROJECT_ROOT, 'qa'), { recursive: true });

  const output = {
    playwrightPackageStatus: null,
    browserExecutablePath: null,
    browserVersion: null,
    origin: ORIGIN,
    navigationStatus: null,
    totalRequests: 0,
    jsRequests: 0,
    cssRequests: 0,
    imageRequests: 0,
    local404s: 0,
    forbiddenRequests: 0,
    unexpectedExternalRequests: 0,
    pageErrors: [],
    consoleErrors: [],
    requestFailures: [],
    fontFallbackUsed: false,
    finalDecision: null,
  };

  // ── PART 1 ──
  const pkg = await detectPlaywrightPackage();
  output.playwrightPackageStatus = pkg.status;
  record('PART 1: Playwright Node package resolvability', pkg.status === 'PLAYWRIGHT_PACKAGE_AVAILABLE' ? 'PASS' : 'NOT_TESTED', pkg.status === 'PLAYWRIGHT_PACKAGE_AVAILABLE' ? 'import("playwright") resolved' : `import("playwright") failed: ${pkg.error}`);

  if (pkg.status !== 'PLAYWRIGHT_PACKAGE_AVAILABLE') {
    output.navigationStatus = 'NOT_ATTEMPTED_PLAYWRIGHT_PACKAGE_UNAVAILABLE';
    output.finalDecision = 'PLAYWRIGHT_PACKAGE_UNAVAILABLE';
    record('Honest status: Playwright package unavailable — no Browser launch fabricated', 'NOT_TESTED', 'The reusable helper (qa/helpers/playwright-virtual-origin.mjs) was still created and is statically verified separately (qa/playwright-virtual-origin-helper-static-test.mjs); no Browser launch is attempted or claimed.');
    await writeFile(path.join(PROJECT_ROOT, 'qa', 'playwright-virtual-origin-smoke-results.json'), JSON.stringify({ suite: 'EPIC 2E-J ENV-B1A-R — Playwright Virtual-Origin Harness smoke test', generatedAt: new Date().toISOString(), results, ...output }, null, 2));
    console.log(`\nFinal decision: ${output.finalDecision}`);
    process.exit(0);
  }

  const { chromium } = pkg.mod;
  const { installLumixaVirtualOrigin } = await import('./helpers/playwright-virtual-origin.mjs');

  // ── PART 2 ──
  const browserDetect = await detectBrowserExecutable(chromium);
  output.browserExecutablePath = browserDetect.found;
  output.browserVersion = browserDetect.versionOutput;
  record('PART 2: Browser executable detection', browserDetect.found ? 'PASS' : 'NOT_TESTED', browserDetect.found ? `found=${browserDetect.found}, version=${browserDetect.versionOutput}` : `no usable Browser executable found among ${browserDetect.attempts.length} candidates (never downloaded one): ${JSON.stringify(browserDetect.attempts)}`);

  if (!browserDetect.found) {
    output.navigationStatus = 'NOT_ATTEMPTED_BROWSER_BINARY_UNAVAILABLE';
    output.finalDecision = 'BROWSER_BINARY_UNAVAILABLE';
    await writeFile(path.join(PROJECT_ROOT, 'qa', 'playwright-virtual-origin-smoke-results.json'), JSON.stringify({ suite: 'EPIC 2E-J ENV-B1A-R — Playwright Virtual-Origin Harness smoke test', generatedAt: new Date().toISOString(), results, ...output }, null, 2));
    console.log(`\nFinal decision: ${output.finalDecision}`);
    process.exit(0);
  }

  // ── PARTS 3/4/5/6/7/8/9 — real Browser attempt ──
  let browser = null;
  try {
    browser = await chromium.launch({ executablePath: browserDetect.found });
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const { externalRequestLog, localRequestLog } = await installLumixaVirtualOrigin(context, { projectRoot: PROJECT_ROOT, origin: ORIGIN });

    const page = await context.newPage();
    const pageErrors = [];
    const consoleErrors = [];
    const requestFailures = [];
    const badStatusRequests = [];
    const requestLog = [];

    page.on('pageerror', (e) => pageErrors.push(String(e)));
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('requestfailed', (req) => requestFailures.push({ url: req.url(), failure: req.failure()?.errorText ?? 'unknown' }));
    page.on('response', (resp) => {
      const url = resp.url();
      const status = resp.status();
      requestLog.push({ url, status });
      if (status >= 400) badStatusRequests.push({ url, status });
    });

    let navigationStatus = 'FAILED';
    let finalUrl = null;
    try {
      const resp = await page.goto(NAV_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
      finalUrl = page.url();
      navigationStatus = resp && resp.ok() ? 'SUCCEEDED' : `RESPONDED_STATUS_${resp ? resp.status() : 'null'}`;
    } catch (navErr) {
      navigationStatus = `THREW: ${String((navErr && navErr.message) || navErr)}`;
    }
    await page.waitForTimeout(400);

    output.navigationStatus = navigationStatus;
    record('PART 3: virtual-origin navigation succeeds and final URL begins with the virtual origin', navigationStatus === 'SUCCEEDED' && typeof finalUrl === 'string' && finalUrl.startsWith(`${ORIGIN}/`), `navigationStatus=${navigationStatus}, finalUrl=${finalUrl}`);

    const readyState = await page.evaluate(() => document.readyState).catch(() => null);
    record('PART 8: document becomes interactive or complete', readyState === 'interactive' || readyState === 'complete', `readyState=${readyState}`);

    const bodyContent = await page.evaluate(() => {
      const body = document.body;
      return body ? (body.textContent || '').trim().length : 0;
    }).catch(() => 0);
    record('PART 8: application body contains visible non-empty content', bodyContent > 0, `bodyTextLength=${bodyContent}`);

    const jsRequests = requestLog.filter((r) => /\.m?js(\?|$)/.test(r.url) && r.url.startsWith(ORIGIN));
    const cssRequests = requestLog.filter((r) => /\.css(\?|$)/.test(r.url) && r.url.startsWith(ORIGIN));
    const imageRequests = requestLog.filter((r) => /\.(png|jpe?g|webp|svg)(\?|$)/.test(r.url) && r.url.startsWith(ORIGIN));
    const localRequestsOnly = requestLog.filter((r) => r.url.startsWith(ORIGIN));
    const local404sList = localRequestsOnly.filter((r) => r.status === 404);
    const forbiddenList = localRequestsOnly.filter((r) => r.status === 403);

    output.totalRequests = requestLog.length;
    output.jsRequests = jsRequests.length;
    output.cssRequests = cssRequests.length;
    output.imageRequests = imageRequests.length;
    output.local404s = local404sList.length;
    output.forbiddenRequests = forbiddenList.length;
    output.unexpectedExternalRequests = externalRequestLog.length;
    output.pageErrors = pageErrors;
    output.consoleErrors = consoleErrors;
    output.requestFailures = requestFailures;
    output.fontFallbackUsed = true; // the helper's Google Fonts stub routes are always installed by installLumixaVirtualOrigin

    record('PART 8: index.html loads from disk under the virtual origin', localRequestsOnly.some((r) => r.url === NAV_URL || r.url === `${ORIGIN}/index.html`) , `matchingRequests=${JSON.stringify(localRequestsOnly.filter((r) => r.url.includes('index.html')))}`);
    record('PART 8: at least one JS/MJS module loads', jsRequests.length > 0, `jsRequests=${jsRequests.length}`);
    record('PART 8: CSS loads when present (informational — not required to be non-zero)', true, `cssRequests=${cssRequests.length}`);
    record('PART 8: no local JS/CSS/module/image 404 under the virtual origin', local404sList.length === 0, `local404s=${JSON.stringify(local404sList)}`);
    record('PART 8: no unexpected external request reached the real network', externalRequestLog.length === 0, `unexpectedExternalRequests=${JSON.stringify(externalRequestLog)}`);
    const localhostAttempts = requestLog.filter((r) => /^https?:\/\/(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|::1)/i.test(r.url));
    record('PART 8: no localhost/127.0.0.1/private-IP request was made', localhostAttempts.length === 0, `localhostAttempts=${JSON.stringify(localhostAttempts)}`);
    record('PART 8: no page errors', pageErrors.length === 0, pageErrors.length === 0 ? '(none)' : JSON.stringify(pageErrors));
    record('PART 8: no console errors', consoleErrors.length === 0, consoleErrors.length === 0 ? '(none)' : JSON.stringify(consoleErrors));
    record('PART 8: no request failures', requestFailures.length === 0, requestFailures.length === 0 ? '(none)' : JSON.stringify(requestFailures));

    // ── PART 9 — route security self-test ──
    let traversalAllPass = true;
    const traversalEvidence = [];
    for (const traversalPath of TRAVERSAL_PATHS) {
      const url = `${ORIGIN}${traversalPath}`;
      let status = null;
      let threw = null;
      try {
        const r = await context.request.get(url, { failOnStatusCode: false });
        status = r.status();
      } catch (e) {
        threw = String((e && e.message) || e);
      }
      const pass = status === 403;
      if (!pass) traversalAllPass = false;
      traversalEvidence.push({ path: traversalPath, status, threw });
    }
    record('PART 9: route security self-test — every traversal path is rejected with 403, outside file never read', traversalAllPass, JSON.stringify(traversalEvidence));

    const allPartEightNinePassed = results.filter((r) => r.result === 'FAIL').length === 0 && navigationStatus === 'SUCCEEDED';
    output.finalDecision = allPartEightNinePassed ? 'PASS_VIRTUAL_ORIGIN_READY' : 'FAIL_VIRTUAL_ORIGIN';

    await page.close();
    await context.close();
  } catch (harnessErr) {
    output.navigationStatus = output.navigationStatus ?? `HARNESS_ERROR: ${String((harnessErr && harnessErr.message) || harnessErr)}`;
    output.finalDecision = 'FAIL_VIRTUAL_ORIGIN';
    record('Harness-level error', 'FAIL', String((harnessErr && harnessErr.message) || harnessErr));
  } finally {
    if (browser) await browser.close();
  }

  await writeFile(path.join(PROJECT_ROOT, 'qa', 'playwright-virtual-origin-smoke-results.json'), JSON.stringify({ suite: 'EPIC 2E-J ENV-B1A-R — Playwright Virtual-Origin Harness smoke test', generatedAt: new Date().toISOString(), results, ...output }, null, 2));
  console.log(`\nFinal decision: ${output.finalDecision}`);
  process.exit(output.finalDecision === 'PASS_VIRTUAL_ORIGIN_READY' ? 0 : 1);
}

main().catch(async (err) => {
  console.error('Virtual-Origin smoke test crashed:', err);
  try {
    await mkdir(path.join(PROJECT_ROOT, 'qa'), { recursive: true });
    await writeFile(path.join(PROJECT_ROOT, 'qa', 'playwright-virtual-origin-smoke-results.json'), JSON.stringify({
      suite: 'EPIC 2E-J ENV-B1A-R — Playwright Virtual-Origin Harness smoke test',
      generatedAt: new Date().toISOString(),
      results,
      playwrightPackageStatus: 'UNKNOWN',
      browserExecutablePath: null,
      browserVersion: null,
      origin: ORIGIN,
      navigationStatus: 'CRASHED',
      totalRequests: 0, jsRequests: 0, cssRequests: 0, imageRequests: 0,
      local404s: 0, forbiddenRequests: 0, unexpectedExternalRequests: 0,
      pageErrors: [], consoleErrors: [], requestFailures: [],
      fontFallbackUsed: false,
      finalDecision: 'TOOL_ENVIRONMENT_UNAVAILABLE',
      crashError: String((err && err.message) || err),
    }, null, 2));
  } catch { /* best-effort */ }
  process.exit(2);
});
