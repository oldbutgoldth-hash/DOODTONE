#!/usr/bin/env node
/**
 * qa/playwright-in-memory-app-smoke.mjs
 *
 * EPIC 2E-J — ENV-B1B: Navigation-Free In-Memory Browser Harness smoke
 * test. Verifies (honestly, never fabricating a Browser launch or a
 * navigation result) whether this sandbox can drive a real Playwright
 * Chromium session that loads the complete LUMIXA application from an
 * in-memory HTML document (qa/helpers/playwright-in-memory-app.mjs)
 * built entirely from local files read via Node's fs — with ZERO
 * Browser navigation to anything other than "about:blank?qa=1", zero
 * HTTP/HTTPS/localhost/file network requests, and zero local server.
 *
 * Distinct from qa/playwright-virtual-origin-smoke.mjs (EPIC 2E-J
 * ENV-B1A-R), which requires navigating to a virtual origin URL — a
 * navigation this sandbox is understood to block regardless of Browser
 * binary availability. This harness never navigates anywhere except
 * "about:blank?qa=1".
 *
 * Does NOT test full Step 7B-B Observation behavior — that remains the
 * job of the existing Browser test suite. Does NOT integrate with the
 * Virtual-Origin helper or Step 7A/7B tests.
 *
 * Run: node qa/playwright-in-memory-app-smoke.mjs
 * Output: qa/playwright-in-memory-app-smoke-results.json
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
const ABOUT_BLANK_URL = 'about:blank?qa=1';

const results = [];
function record(test, result, evidence) {
  results.push({ test, result, evidence });
  const icon = result === 'PASS' ? '✓' : result === 'FAIL' ? '✗' : '•';
  console.log(`${icon} [${result}] ${test} — ${evidence}`);
}

// ── PART 1 — Playwright Node package resolvability (mirrors the same
// detection approach as qa/playwright-virtual-origin-smoke.mjs; a
// missing NODE PACKAGE is reported distinctly from a missing BROWSER
// BINARY, never conflated) ────────────────────────────────────────────
async function detectPlaywrightPackage() {
  try {
    const mod = await import('playwright');
    return { status: 'PLAYWRIGHT_PACKAGE_AVAILABLE', mod };
  } catch (e) {
    return { status: 'PLAYWRIGHT_PACKAGE_UNAVAILABLE', error: String((e && e.message) || e) };
  }
}

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

async function main() {
  await mkdir(path.join(PROJECT_ROOT, 'qa'), { recursive: true });

  const output = {
    playwrightPackageStatus: null,
    browserExecutablePath: null,
    browserVersion: null,
    aboutBlankUrl: ABOUT_BLANK_URL,
    aboutBlankResult: null,
    finalPageUrl: null,
    moduleCount: 0,
    importEdgeCount: 0,
    dynamicImportLiteralCount: 0,
    inlineModuleCount: 0,
    localAssetCount: 0,
    requestsByScheme: {},
    totalNetworkRequests: 0,
    pageErrors: [],
    consoleErrors: [],
    unresolvedImports: [],
    rejectedSpecifiers: [],
    duplicateCanonicalIds: [],
    finalDecision: null,
  };

  // ── PART 1 ──
  const pkg = await detectPlaywrightPackage();
  output.playwrightPackageStatus = pkg.status;
  record('PART 1: Playwright Node package resolvability', pkg.status === 'PLAYWRIGHT_PACKAGE_AVAILABLE' ? 'PASS' : 'NOT_TESTED', pkg.status === 'PLAYWRIGHT_PACKAGE_AVAILABLE' ? 'import("playwright") resolved' : `import("playwright") failed: ${pkg.error}`);

  if (pkg.status !== 'PLAYWRIGHT_PACKAGE_AVAILABLE') {
    output.finalDecision = 'PLAYWRIGHT_PACKAGE_UNAVAILABLE';
    record('Honest status: Playwright package unavailable — no Browser launch fabricated', 'NOT_TESTED', 'The reusable helper (qa/helpers/playwright-in-memory-app.mjs) was still built and is statically verified separately (qa/playwright-in-memory-app-static-test.mjs); no Browser launch is attempted or claimed.');
    await writeFile(path.join(PROJECT_ROOT, 'qa', 'playwright-in-memory-app-smoke-results.json'), JSON.stringify({ suite: 'EPIC 2E-J ENV-B1B — In-Memory App Harness smoke test', generatedAt: new Date().toISOString(), results, ...output }, null, 2));
    console.log(`\nFinal decision: ${output.finalDecision}`);
    process.exit(0);
  }

  const { chromium } = pkg.mod;

  // ── PART 2 ──
  const browserDetect = await detectBrowserExecutable(chromium);
  output.browserExecutablePath = browserDetect.found;
  output.browserVersion = browserDetect.versionOutput;
  record('PART 2: Browser executable detection', browserDetect.found ? 'PASS' : 'NOT_TESTED', browserDetect.found ? `found=${browserDetect.found}, version=${browserDetect.versionOutput}` : `no usable Browser executable found among ${browserDetect.attempts.length} candidates (never downloaded one): ${JSON.stringify(browserDetect.attempts)}`);

  if (!browserDetect.found) {
    output.finalDecision = 'BROWSER_BINARY_UNAVAILABLE';
    await writeFile(path.join(PROJECT_ROOT, 'qa', 'playwright-in-memory-app-smoke-results.json'), JSON.stringify({ suite: 'EPIC 2E-J ENV-B1B — In-Memory App Harness smoke test', generatedAt: new Date().toISOString(), results, ...output }, null, 2));
    console.log(`\nFinal decision: ${output.finalDecision}`);
    process.exit(0);
  }

  // ── Build the in-memory app BEFORE launching a Browser — this part
  // is pure Node/fs work and never touches the network. ──
  const { buildInMemoryApp, toEvidenceSummary } = await import('./helpers/playwright-in-memory-app.mjs');
  let app;
  let evidence;
  try {
    app = await buildInMemoryApp(PROJECT_ROOT);
    evidence = toEvidenceSummary(app);
    output.moduleCount = evidence.moduleCount;
    output.importEdgeCount = evidence.importEdgeCount;
    output.dynamicImportLiteralCount = evidence.dynamicImportLiteralCount;
    output.inlineModuleCount = evidence.inlineModuleCount;
    output.localAssetCount = evidence.localAssetCount;
    output.rejectedSpecifiers = evidence.rejectedSpecifiers;
    output.duplicateCanonicalIds = evidence.duplicateCanonicalIds;
    record('PART 3/4/5/6: in-memory app graph built from disk (no network) — modules discovered, specifiers rewritten to canonical IDs, Import Map + data: URLs constructed', evidence.moduleCount > 0 && evidence.duplicateCanonicalIds.length === 0 ? 'PASS' : 'FAIL', `moduleCount=${evidence.moduleCount}, importEdgeCount=${evidence.importEdgeCount}, dynamicImportLiteralCount=${evidence.dynamicImportLiteralCount}, inlineModuleCount=${evidence.inlineModuleCount}, rejectedSpecifiers=${evidence.rejectedSpecifiers.length}, duplicateCanonicalIds=${evidence.duplicateCanonicalIds.length}`);
  } catch (buildErr) {
    output.finalDecision = 'FAIL_IN_MEMORY_HARNESS';
    record('PART 3/4/5/6: in-memory app graph build', 'FAIL', String((buildErr && buildErr.stack) || buildErr));
    await writeFile(path.join(PROJECT_ROOT, 'qa', 'playwright-in-memory-app-smoke-results.json'), JSON.stringify({ suite: 'EPIC 2E-J ENV-B1B — In-Memory App Harness smoke test', generatedAt: new Date().toISOString(), results, ...output }, null, 2));
    console.log(`\nFinal decision: ${output.finalDecision}`);
    process.exit(1);
  }

  // ── PARTS 1/7/8/9 — real Browser attempt ──
  let browser = null;
  try {
    browser = await chromium.launch({ executablePath: browserDetect.found, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const page = await context.newPage();

    const pageErrors = [];
    const consoleErrors = [];
    const requestLog = []; // {url, scheme}

    // Listeners installed BEFORE any navigation/setContent, per PART 7.
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('request', (req) => {
      const url = req.url();
      let scheme = 'unknown';
      try { scheme = new URL(url).protocol.replace(':', ''); } catch { /* leave as 'unknown' */ }
      requestLog.push({ url, scheme });
    });

    // Required sequence: about:blank?qa=1 is the ONLY navigation target
    // ever used by this harness.
    let aboutBlankResult = 'FAILED';
    try {
      await page.goto(ABOUT_BLANK_URL, { waitUntil: 'domcontentloaded', timeout: 10000 });
      aboutBlankResult = 'SUCCEEDED';
    } catch (navErr) {
      aboutBlankResult = `THREW: ${String((navErr && navErr.message) || navErr)}`;
    }
    output.aboutBlankResult = aboutBlankResult;
    record('PART 1/7: navigate to about:blank?qa=1 (the only navigation target used anywhere in this harness)', aboutBlankResult === 'SUCCEEDED' ? 'PASS' : 'FAIL', `aboutBlankResult=${aboutBlankResult}`);

    if (aboutBlankResult === 'SUCCEEDED') {
      let setContentOk = false;
      let setContentError = null;
      try {
        await page.setContent(app.html, { waitUntil: 'domcontentloaded', timeout: 20000 });
        setContentOk = true;
      } catch (e) {
        setContentError = String((e && e.message) || e);
      }
      record('PART 7: page.setContent() loads the in-memory HTML document', setContentOk ? 'PASS' : 'FAIL', setContentOk ? 'setContent resolved' : `setContent threw: ${setContentError}`);

      const finalUrl = page.url();
      output.finalPageUrl = finalUrl;
      record('PART 7: Page URL remains about:blank?qa=1 after setContent (no navigation occurred)', finalUrl === ABOUT_BLANK_URL ? 'PASS' : 'FAIL', `finalUrl=${finalUrl}`);

      if (setContentOk) {
        // Deterministic wait for module startup: window.__LUMIXA_QA__ is
        // only assigned partway through ui/app.js's own module body,
        // which per ES module evaluation order only runs AFTER every one
        // of its static imports (all statically-imported Core engine
        // modules) has already finished evaluating — so this single
        // flag is real proof that app.js AND at least one Core module
        // both executed, not just that some script tag ran.
        let moduleStartupOk = false;
        let moduleStartupError = null;
        try {
          await page.waitForFunction(() => !!(window.__LUMIXA_QA__ && typeof window.__LUMIXA_QA__.getPreviewPipelineSnapshot === 'function'), null, { timeout: 15000 });
          moduleStartupOk = true;
        } catch (e) {
          moduleStartupError = String((e && e.message) || e);
        }
        record('PART 9: app.js executes and at least one Core module executes (window.__LUMIXA_QA__ assigned after all static imports evaluate)', moduleStartupOk ? 'PASS' : 'FAIL', moduleStartupOk ? 'window.__LUMIXA_QA__ observed' : `waitForFunction failed: ${moduleStartupError}`);

        const readyState = await page.evaluate(() => document.readyState).catch(() => null);
        record('PART 9: document.readyState is interactive or complete', (readyState === 'interactive' || readyState === 'complete') ? 'PASS' : 'FAIL', `readyState=${readyState}`);

        const domChecks = await page.evaluate(() => {
          const root = document.getElementById('lumixaApp');
          const rootText = root ? (root.textContent || '').trim().length : 0;
          return {
            rootExists: !!root,
            rootTextLength: rootText,
            hasHeaderVersion: !!document.getElementById('aiWorkflowHeaderVersion'),
            hasViewerViewport: !!document.getElementById('viewerViewport'),
            hasPreviewImg: !!document.getElementById('previewImg'),
            hasRedeemButton: !!document.getElementById('btnRedeem'),
            locationSearch: window.location.search,
          };
        }).catch(() => null);
        const rootOk = !!(domChecks && domChecks.rootExists && domChecks.rootTextLength > 0);
        record('PART 9: main application root (#lumixaApp) is present with visible non-empty content', rootOk ? 'PASS' : 'FAIL', JSON.stringify(domChecks));
        const uiElementsOk = !!(domChecks && domChecks.hasHeaderVersion && domChecks.hasViewerViewport && domChecks.hasPreviewImg && domChecks.hasRedeemButton);
        record('PART 9: expected LUMIXA UI elements exist (#aiWorkflowHeaderVersion, #viewerViewport, #previewImg, #btnRedeem)', uiElementsOk ? 'PASS' : 'FAIL', JSON.stringify(domChecks));
        const qaQueryOk = !!(domChecks && domChecks.locationSearch === '?qa=1');
        record('PART 9: the QA query is visible through location.search', qaQueryOk ? 'PASS' : 'FAIL', `locationSearch=${domChecks && domChecks.locationSearch}`);

        // Small flush wait so any trailing microtask-scheduled console/page errors surface before we snapshot.
        await page.waitForTimeout(200);
      }
    }

    output.pageErrors = pageErrors;
    output.consoleErrors = consoleErrors;
    record('PART 9: no page errors', pageErrors.length === 0 ? 'PASS' : 'FAIL', pageErrors.length === 0 ? '(none)' : JSON.stringify(pageErrors));
    record('PART 9: no console errors', consoleErrors.length === 0 ? 'PASS' : 'FAIL', consoleErrors.length === 0 ? '(none)' : JSON.stringify(consoleErrors));

    // ── PART 8 — network-zero contract ──
    const byScheme = {};
    for (const r of requestLog) byScheme[r.scheme] = (byScheme[r.scheme] || 0) + 1;
    output.requestsByScheme = byScheme;
    output.totalNetworkRequests = requestLog.length;
    const nonDataRequests = requestLog.filter((r) => r.scheme !== 'data' && r.scheme !== 'about');
    record('PART 8: network-zero contract — every observed request is a data: module load (or the initial about: target); zero http/https/file/localhost requests', nonDataRequests.length === 0 ? 'PASS' : 'FAIL', `requestsByScheme=${JSON.stringify(byScheme)}, nonDataRequests=${JSON.stringify(nonDataRequests.slice(0, 20))}`);

    output.unresolvedImports = evidence.rejectedSpecifiers;
    record('PART 10: no unresolved/rejected import in the graph (module-path-resolution or module-read failures)', evidence.rejectedSpecifiers.filter((r) => r.context === 'module-path-resolution' || r.context === 'module-read').length === 0 ? 'PASS' : 'FAIL', `rejectedSpecifiers=${JSON.stringify(evidence.rejectedSpecifiers)}`);
    record('PART 10: no duplicate canonical module ID in the graph', evidence.duplicateCanonicalIds.length === 0 ? 'PASS' : 'FAIL', `duplicateCanonicalIds=${JSON.stringify(evidence.duplicateCanonicalIds)}`);

    const allPassed = results.filter((r) => r.result === 'FAIL').length === 0;
    output.finalDecision = allPassed ? 'PASS_IN_MEMORY_HARNESS_READY' : 'FAIL_IN_MEMORY_HARNESS';

    await page.close();
    await context.close();
  } catch (harnessErr) {
    output.finalDecision = 'FAIL_IN_MEMORY_HARNESS';
    record('Harness-level error', 'FAIL', String((harnessErr && harnessErr.stack) || harnessErr));
  } finally {
    if (browser) await browser.close();
  }

  await writeFile(path.join(PROJECT_ROOT, 'qa', 'playwright-in-memory-app-smoke-results.json'), JSON.stringify({ suite: 'EPIC 2E-J ENV-B1B — In-Memory App Harness smoke test', generatedAt: new Date().toISOString(), results, ...output }, null, 2));
  console.log(`\nFinal decision: ${output.finalDecision}`);
  process.exit(output.finalDecision === 'PASS_IN_MEMORY_HARNESS_READY' ? 0 : 1);
}

main().catch(async (err) => {
  console.error('In-Memory App smoke test crashed:', err);
  try {
    await mkdir(path.join(PROJECT_ROOT, 'qa'), { recursive: true });
    await writeFile(path.join(PROJECT_ROOT, 'qa', 'playwright-in-memory-app-smoke-results.json'), JSON.stringify({
      suite: 'EPIC 2E-J ENV-B1B — In-Memory App Harness smoke test',
      generatedAt: new Date().toISOString(),
      results,
      playwrightPackageStatus: 'UNKNOWN',
      browserExecutablePath: null,
      browserVersion: null,
      aboutBlankUrl: ABOUT_BLANK_URL,
      aboutBlankResult: 'CRASHED',
      finalPageUrl: null,
      moduleCount: 0, importEdgeCount: 0, dynamicImportLiteralCount: 0,
      inlineModuleCount: 0, localAssetCount: 0,
      requestsByScheme: {}, totalNetworkRequests: 0,
      pageErrors: [], consoleErrors: [],
      unresolvedImports: [], rejectedSpecifiers: [], duplicateCanonicalIds: [],
      finalDecision: 'TOOL_ENVIRONMENT_UNAVAILABLE',
      crashError: String((err && err.message) || err),
    }, null, 2));
  } catch { /* best-effort */ }
  process.exit(2);
});
