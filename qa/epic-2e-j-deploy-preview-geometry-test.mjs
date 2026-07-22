#!/usr/bin/env node
/**
 * qa/epic-2e-j-deploy-preview-geometry-test.mjs
 *
 * DEPLOY GEOMETRY R1 — Phase G: real Deploy parity suite.
 *
 * Accepts the deployed URL ONLY from the `LUMIXA_DEPLOY_URL`
 * environment variable — this suite never hard-codes or guesses a
 * URL. When the variable is absent/empty, it writes an honest current
 * `DEPLOY_URL_REQUIRED` result and exits 0 (never claims Deploy
 * parity, never regenerates a stale "successful" Final Phase C
 * result).
 *
 * Unlike every other Browser suite in this project, this ONE suite
 * deliberately does NOT use the zero-Network In-Memory Harness — it
 * performs a REAL `page.goto()` navigation to the exact deployed
 * HTTPS URL supplied, over the real network, and explicitly ALLOWS
 * that one origin (plus documented Google Fonts hosts, only if
 * actually used) rather than treating all non-`data:`/`about:` traffic
 * as a violation.
 *
 * Run: LUMIXA_DEPLOY_URL=https://your-deploy.example node qa/epic-2e-j-deploy-preview-geometry-test.mjs
 * Output: qa/epic-2e-j-deploy-preview-geometry-results.json
 * Screenshots: qa/screenshots/deploy-preview-geometry/<fixture>.png (one per fixture, only on a real run)
 */

import { readFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  detectPlaywrightPackage,
  detectBrowserExecutable,
  REQUIRED_LAUNCH_ARGS,
  generateRunId,
  computeSourceHash,
  writeResultAtomic,
  buildRuntimeCrashRow,
  writeBrowserUnavailableResult,
} from './helpers/playwright-lumixa-test-runtime.mjs';
import { readJpegExifOrientation } from './helpers/exif-orientation-reader.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const FIXTURES_DIR = path.join(PROJECT_ROOT, 'qa', 'fixtures', 'preview-geometry');
const MANIFEST_PATH = path.join(FIXTURES_DIR, 'manifest.json');
const RESULTS_PATH = path.join(PROJECT_ROOT, 'qa', 'epic-2e-j-deploy-preview-geometry-results.json');
const SCREENSHOTS_DIR = path.join(PROJECT_ROOT, 'qa', 'screenshots', 'deploy-preview-geometry');
const SUITE_NAME = 'DEPLOY GEOMETRY R1 — Deploy Preview Geometry suite';

// The exact qaContractVersion string this suite's own source currently
// expects getPreviewPipelineSnapshot() to report. Must be kept in sync
// by hand with ui/app.js's own literal — a deliberate, visible,
// single-point comparison rather than a dynamic runtime guess, so a
// genuine deploy/source drift is always caught explicitly.
const EXPECTED_QA_CONTRACT_VERSION = '2E-J-C-R2';

// Only these external hosts are ever tolerated on the real deploy
// origin, and ONLY when actually requested by the deployed page itself
// (never pre-allowed if unused) — documented Google Fonts hosts.
const ALLOWED_EXTERNAL_HOSTS = new Set(['fonts.googleapis.com', 'fonts.gstatic.com']);

const SOURCE_HASH_INPUTS = [
  path.join(__dirname, 'epic-2e-j-deploy-preview-geometry-test.mjs'),
  path.join(__dirname, 'helpers', 'playwright-lumixa-test-runtime.mjs'),
  path.join(__dirname, 'helpers', 'exif-orientation-reader.mjs'),
  MANIFEST_PATH,
];

let runId = null;
let startedAt = null;
let sourceHash = null;
const results = [];
const ALLOWED_STATUSES = new Set(['PASS', 'FAIL', 'NOT_TESTED', 'NOT_APPLICABLE']);

function recordStatus(test, status, evidence) {
  const testOk = typeof test === 'string' && test.trim().length > 0;
  const statusOk = typeof status === 'string' && ALLOWED_STATUSES.has(status);
  let safeEvidence;
  try { safeEvidence = String(evidence); } catch (e) { safeEvidence = `[evidence formatting threw: ${e?.name ?? 'UnknownError'}]`; }
  const finalStatus = (testOk && statusOk) ? status : 'FAIL';
  const finalTest = testOk ? test : '[MISSING_TEST_NAME]';
  const icon = finalStatus === 'PASS' ? '✓' : finalStatus === 'FAIL' ? '✗' : '•';
  results.push({ test: finalTest, result: finalStatus, evidence: safeEvidence });
  console.log(`${icon} [${finalStatus}] ${finalTest} — ${safeEvidence}`);
}
function recordCondition(test, condition, evidence) {
  recordStatus(test, condition === true ? 'PASS' : 'FAIL', evidence);
}

async function writeDeployStatusResult(status, reason, extra = {}) {
  const nowIso = new Date().toISOString();
  const output = {
    suite: SUITE_NAME,
    runId: runId ?? generateRunId(),
    startedAt: startedAt ?? nowIso,
    completedAt: nowIso,
    completed: true,
    sourceHash: sourceHash ?? null,
    deployUrl: extra.deployUrl ?? null,
    browserExecutablePath: extra.browserExecutablePath ?? null,
    browserVersion: extra.browserVersion ?? null,
    generatedAt: nowIso,
    summary: { total: 1, pass: 0, fail: 0, notTested: 1 },
    results: [{ test: 'Deploy Preview Geometry availability', result: 'NOT_TESTED', evidence: reason }],
    screenshotsGenerated: extra.screenshotsGenerated ?? [],
    decision: status, // never 'PASS_DEPLOY_PREVIEW_GEOMETRY' here
  };
  await mkdir(path.join(PROJECT_ROOT, 'qa'), { recursive: true });
  await writeResultAtomic(RESULTS_PATH, output);
  return output;
}

async function main() {
  runId = generateRunId();
  startedAt = new Date().toISOString();
  sourceHash = await computeSourceHash(SOURCE_HASH_INPUTS);

  const deployUrl = process.env.LUMIXA_DEPLOY_URL;
  if (typeof deployUrl !== 'string' || deployUrl.trim().length === 0) {
    console.log('LUMIXA_DEPLOY_URL is not set — this suite never hard-codes or guesses a deployed URL.');
    await writeDeployStatusResult('DEPLOY_URL_REQUIRED', 'LUMIXA_DEPLOY_URL environment variable was not provided. Set it to the exact deployed HTTPS URL to run this suite for real.');
    console.log('Final decision: DEPLOY_URL_REQUIRED');
    process.exit(0);
  }
  let parsedUrl;
  try {
    parsedUrl = new URL(deployUrl);
    if (parsedUrl.protocol !== 'https:') throw new Error(`Expected an https: URL, got "${parsedUrl.protocol}"`);
  } catch (e) {
    await writeDeployStatusResult('FAIL_DEPLOY_PREVIEW_GEOMETRY', `LUMIXA_DEPLOY_URL is not a valid https URL: ${e.message}`, { deployUrl });
    console.log('Final decision: FAIL_DEPLOY_PREVIEW_GEOMETRY (invalid URL)');
    process.exit(1);
  }

  let manifest;
  try {
    manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
    for (const fx of manifest.fixtures) {
      const fp = path.join(FIXTURES_DIR, fx.filename);
      const st = await stat(fp);
      if (!st.isFile()) throw new Error(`${fx.filename} is not a regular file`);
      const buf = await readFile(fp);
      const parsed = readJpegExifOrientation(buf);
      if (parsed !== fx.exifOrientation) throw new Error(`${fx.filename} EXIF mismatch: manifest=${fx.exifOrientation}, parsed=${parsed}`);
    }
  } catch (e) {
    await writeDeployStatusResult('FAIL_DEPLOY_PREVIEW_GEOMETRY', `Fixture manifest verification failed: ${e.message}`, { deployUrl });
    process.exit(1);
  }

  const pkg = await detectPlaywrightPackage();
  if (pkg.status !== 'PLAYWRIGHT_PACKAGE_AVAILABLE') {
    await writeDeployStatusResult('PLAYWRIGHT_PACKAGE_UNAVAILABLE', pkg.error, { deployUrl });
    console.log('Final decision: PLAYWRIGHT_PACKAGE_UNAVAILABLE');
    process.exit(0);
  }
  const { chromium } = pkg.mod;
  const browserDetect = await detectBrowserExecutable(chromium);
  if (!browserDetect.found) {
    await writeDeployStatusResult('BROWSER_BINARY_UNAVAILABLE', JSON.stringify(browserDetect.attempts), { deployUrl });
    console.log('Final decision: BROWSER_BINARY_UNAVAILABLE');
    process.exit(0);
  }

  const browser = await chromium.launch({ executablePath: browserDetect.found, args: REQUIRED_LAUNCH_ARGS });
  const screenshotsGenerated = [];
  let buildMismatch = false;

  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
    const page = await context.newPage();
    const pageErrors = [];
    const consoleErrors = [];
    const unexpectedOrigins = new Set();
    const usedFontHosts = new Set();
    const deployHost = parsedUrl.host;

    page.on('pageerror', (e) => pageErrors.push(String(e)));
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('request', (req) => {
      let host;
      try { host = new URL(req.url()).host; } catch { return; }
      if (host === deployHost) return; // the deployment's own origin — always allowed
      if (ALLOWED_EXTERNAL_HOSTS.has(host)) { usedFontHosts.add(host); return; }
      unexpectedOrigins.add(host);
    });

    // Navigate to the EXACT deployed URL supplied — never a guessed or
    // rewritten variant. A trailing "?qa=1" is appended only if the
    // URL doesn't already carry a query string, so the bounded QA
    // snapshot hook is reachable without altering a URL the caller
    // explicitly gave us.
    const navUrl = parsedUrl.search ? deployUrl : `${deployUrl}${deployUrl.endsWith('/') ? '' : ''}?qa=1`;
    await page.goto(navUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    recordCondition('Navigated to the exact deployed URL supplied via LUMIXA_DEPLOY_URL', page.url().startsWith(deployUrl.split('?')[0]), `navigated to ${page.url()}`);

    // Verify the QA contract/build marker.
    let contractCheck = null;
    try {
      await page.waitForFunction(() => !!(window.__LUMIXA_QA__ && typeof window.__LUMIXA_QA__.getPreviewPipelineSnapshot === 'function'), null, { timeout: 20000 });
      const snap = await page.evaluate(() => window.__LUMIXA_QA__.getPreviewPipelineSnapshot());
      contractCheck = snap?.qaContractVersion ?? null;
    } catch (e) {
      contractCheck = null;
    }
    buildMismatch = contractCheck !== EXPECTED_QA_CONTRACT_VERSION;
    recordCondition('Deployed build QA contract marker matches expected source contract', !buildMismatch, `expected=${EXPECTED_QA_CONTRACT_VERSION}, deployed=${contractCheck}`);

    if (buildMismatch) {
      await context.close();
      await writeDeployStatusResult('DEPLOY_BUILD_MISMATCH', `Deployed qaContractVersion="${contractCheck}" does not match this source's expected "${EXPECTED_QA_CONTRACT_VERSION}" — the deployed build is older than (or otherwise diverged from) the current source contract.`, { deployUrl, browserExecutablePath: browserDetect.found, browserVersion: browser.version?.() ?? null });
      console.log('Final decision: DEPLOY_BUILD_MISMATCH');
      process.exit(1);
    }

    await mkdir(SCREENSHOTS_DIR, { recursive: true });

    let priorGeneration = 0;
    for (const fx of manifest.fixtures) {
      const fixtureAbsPath = path.join(FIXTURES_DIR, fx.filename);
      const tag = `[${fx.filename}]`;

      await page.setInputFiles('#fileIn', fixtureAbsPath);

      // Wait for analysis using the same QA snapshot contract as the
      // local suite, polling the real deployed page.
      let snap = null;
      const analysisStart = Date.now();
      while (Date.now() - analysisStart < 30000) {
        snap = await page.evaluate(() => window.__LUMIXA_QA__ ? window.__LUMIXA_QA__.getPreviewPipelineSnapshot() : null);
        if (snap && snap.analysisGeneration > priorGeneration && snap.previewSandbox?.exists) break;
        await page.waitForTimeout(300);
      }
      recordCondition(`${tag} Initial analysis completes on the deployed build`, !!snap && snap.previewSandbox?.exists === true, JSON.stringify(snap?.previewSandbox ?? {}));

      // Complete Human Review through the real deployed UI.
      const itemIds = await page.evaluate(() => [...new Set(Array.from(document.querySelectorAll('#reviewConsoleInner [data-review-item-id]')).map((i) => i.dataset.reviewItemId))]);
      for (const itemId of itemIds) {
        await page.evaluate((id) => {
          const container = document.querySelector(`#reviewConsoleInner [data-review-item-id="${id}"]`);
          const btn = container ? container.querySelector('button[data-review-action="pass"]') : null;
          if (btn) btn.click();
        }, itemId);
        await page.waitForTimeout(80);
      }
      const genBeforeReanalyze = snap?.analysisGeneration ?? priorGeneration;
      await page.click('#btnReanalyze');

      let finalSnap = null;
      const reviewStart = Date.now();
      while (Date.now() - reviewStart < 30000) {
        finalSnap = await page.evaluate(() => window.__LUMIXA_QA__ ? window.__LUMIXA_QA__.getPreviewPipelineSnapshot() : null);
        if (finalSnap && finalSnap.analysisGeneration > genBeforeReanalyze
          && (finalSnap.interactive?.state === 'ready' || finalSnap.interactive?.state === 'blocked' || finalSnap.interactive?.state === 'partial')) break;
        await page.waitForTimeout(300);
      }
      priorGeneration = finalSnap?.analysisGeneration ?? genBeforeReanalyze;

      recordCondition(`${tag} V2 is not Unavailable`, finalSnap?.visualPreview?.controlledV2State === 'renderable', `controlledV2State=${finalSnap?.visualPreview?.controlledV2State}`);
      recordCondition(`${tag} Legacy rendered`, finalSnap?.visualPreview?.legacyState === 'renderable', `legacyState=${finalSnap?.visualPreview?.legacyState}`);
      recordCondition(`${tag} Alignment reports Exact dimensions`, finalSnap?.interactive?.alignmentStatus === 'Exact dimensions', `alignmentStatus=${finalSnap?.interactive?.alignmentStatus}`);
      recordCondition(`${tag} Observation available after two-preview readiness`, finalSnap?.observation?.enabled === true, `observationEnabled=${finalSnap?.observation?.enabled}`);

      const screenshotPath = path.join(SCREENSHOTS_DIR, `${fx.filename.replace(/\.[^.]+$/, '')}.png`);
      try {
        await page.screenshot({ path: screenshotPath, fullPage: false });
        screenshotsGenerated.push(screenshotPath);
        recordCondition(`${tag} Screenshot generated`, true, screenshotPath);
      } catch (e) {
        recordCondition(`${tag} Screenshot generated`, false, e.message);
      }
    }

    recordCondition('Zero page errors on the deployed site', pageErrors.length === 0, pageErrors.length === 0 ? '(none)' : pageErrors.join('; '));
    recordCondition('Zero console errors on the deployed site', consoleErrors.length === 0, consoleErrors.length === 0 ? '(none)' : consoleErrors.join('; '));
    recordCondition('No unexpected external origins requested', unexpectedOrigins.size === 0, unexpectedOrigins.size === 0 ? '(none)' : JSON.stringify([...unexpectedOrigins]));
    recordStatus('Documented font hosts actually used', usedFontHosts.size > 0 ? 'PASS' : 'NOT_APPLICABLE', JSON.stringify([...usedFontHosts]));

    await context.close();
  } finally {
    await browser.close();
  }

  const passCount = results.filter((r) => r.result === 'PASS').length;
  const failCount = results.filter((r) => r.result === 'FAIL').length;
  const notTestedCount = results.filter((r) => r.result === 'NOT_TESTED').length;
  const decision = (failCount === 0 && notTestedCount === 0 && passCount === results.length) ? 'PASS_DEPLOY_PREVIEW_GEOMETRY' : 'FAIL_DEPLOY_PREVIEW_GEOMETRY';

  const output = {
    suite: SUITE_NAME,
    runId, startedAt, completedAt: new Date().toISOString(), completed: true, sourceHash,
    deployUrl,
    browserExecutablePath: browserDetect.found, browserVersion: browser.version?.() ?? null,
    generatedAt: new Date().toISOString(),
    summary: { total: results.length, pass: passCount, fail: failCount, notTested: notTestedCount },
    screenshotsGenerated,
    results,
    decision,
  };
  await mkdir(path.join(PROJECT_ROOT, 'qa'), { recursive: true });
  await writeResultAtomic(RESULTS_PATH, output);
  console.log(`\n${passCount}/${results.length} PASS, ${failCount} FAIL`);
  console.log(`Decision: ${decision}`);
  process.exit(decision === 'PASS_DEPLOY_PREVIEW_GEOMETRY' ? 0 : 1);
}

const isMainModule = (() => {
  try { return import.meta.url === `file://${process.argv[1]}`; } catch { return false; }
})();
if (isMainModule) {
  main().catch(async (err) => {
    console.error('Deploy Preview Geometry suite crashed:', err?.name ?? err);
    try {
      await writeDeployStatusResult('FAIL_DEPLOY_PREVIEW_GEOMETRY', `Suite crashed: ${err?.name ?? 'UnknownError'}`);
    } catch (writeErr) {
      console.error('Failed to write crash result JSON:', writeErr?.name ?? writeErr);
    }
    process.exit(2);
  });
}
