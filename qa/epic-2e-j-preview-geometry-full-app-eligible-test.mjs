#!/usr/bin/env node
/**
 * qa/epic-2e-j-preview-geometry-full-app-eligible-test.mjs
 *
 * LOCAL-FIRST GEOMETRY R3 -- Phase C2: FULL-APP SAFETY-ELIGIBLE GEOMETRY
 * SUITE.
 *
 * The honest counterpart to Phase C1 (decoder/render-only, synthetic
 * marker fixtures). This suite drives the REAL, complete app pipeline --
 * real Analysis, real Safety gates, real Human Review, real V2 Render
 * Plan, real Interactive Before/After, real Observation -- using photo-
 * like fixtures that are proven able to reach a real "Preview Ready"
 * state, per the spec's explicit requirement: "Use photo-like fixtures
 * that are already proven to reach Preview Ready."
 *
 * Fixtures: qa/fixtures/epic-2e-j/ready/*.jpg|png, six EXIF-orientation
 * variants (1/3/6/8/no-EXIF, landscape/portrait) generated FROM the
 * real qa/fixtures/epic-2e-j/neutral-balanced.png content (see
 * qa/fixtures/epic-2e-j/ready/generate_ready_fixtures.py) -- a smooth,
 * low-contrast neutral gradient already proven (SAFE RECOVERY + DEPLOY
 * GEOMETRY R2 -- Phase C) to clear Safety and reach Preview Ready,
 * never a synthetic marker block.
 *
 * Per the spec: "When a fixture legitimately triggers a hard stop: it
 * is a fixture-design failure, regenerate the fixture, do not weaken
 * safety." This suite therefore treats HARD_SAFETY_STOP (or any other
 * blocker) on any of these fixtures as a genuine FAIL of this suite --
 * never as a reason to loosen an assertion, weaken a threshold, or
 * treat the blocked fixture as NOT_APPLICABLE.
 *
 * Run: node qa/epic-2e-j-preview-geometry-full-app-eligible-test.mjs
 * Output: qa/epic-2e-j-preview-geometry-full-app-eligible-results.json
 */

import { readFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import {
  detectPlaywrightPackage,
  detectBrowserExecutable,
  REQUIRED_LAUNCH_ARGS,
  buildLumixaAppSnapshot,
  openLumixaInMemoryPage,
  generateRunId,
  computeSourceHash,
  writeResultAtomic,
  buildRuntimeCrashRow,
  writeBrowserUnavailableResult,
  qaSnapshot,
  passAllReviewItems,
  waitForAnalysisCompletion,
} from './helpers/playwright-lumixa-test-runtime.mjs';
import { readJpegExifOrientation } from './helpers/exif-orientation-reader.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const FIXTURES_DIR = path.join(PROJECT_ROOT, 'qa', 'fixtures', 'epic-2e-j', 'ready');
const MANIFEST_PATH = path.join(FIXTURES_DIR, 'manifest.json');
const RESULTS_PATH = path.join(PROJECT_ROOT, 'qa', 'epic-2e-j-preview-geometry-full-app-eligible-results.json');
const SUITE_NAME = 'LOCAL-FIRST GEOMETRY R3 -- Phase C2: Full-App Safety-Eligible Geometry suite';

const SOURCE_HASH_INPUTS = [
  path.join(__dirname, 'epic-2e-j-preview-geometry-full-app-eligible-test.mjs'),
  path.join(__dirname, 'helpers', 'playwright-lumixa-test-runtime.mjs'),
  path.join(__dirname, 'helpers', 'playwright-in-memory-app.mjs'),
  path.join(__dirname, 'helpers', 'exif-orientation-reader.mjs'),
  path.join(PROJECT_ROOT, 'ui', 'app.js'),
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

export function computeFullAppEligibleDecision(resultRows, { completed, sourceHash: resultSourceHash, currentSourceHash } = {}) {
  if (!Array.isArray(resultRows) || resultRows.length === 0) return { decision: 'FAIL', reasons: ['EMPTY_RESULT_SET'] };
  const reasons = [];
  let failCount = 0, malformed = 0;
  for (const row of resultRows) {
    const wellFormed = !!row && typeof row.test === 'string' && row.test.trim().length > 0 && typeof row.result === 'string' && ALLOWED_STATUSES.has(row.result);
    if (!wellFormed) { malformed++; continue; }
    if (row.result === 'FAIL') failCount++;
  }
  if (malformed > 0) reasons.push(`MALFORMED_ROWS=${malformed}`);
  if (failCount > 0) reasons.push(`FAIL_COUNT=${failCount}`);
  if (completed !== true) reasons.push('BROWSER_EXECUTION_NOT_COMPLETED');
  if (typeof resultSourceHash !== 'string' || resultSourceHash.length === 0 || resultSourceHash !== currentSourceHash) reasons.push('SOURCE_HASH_MISMATCH_OR_MISSING');
  return { decision: reasons.length === 0 ? 'PASS' : 'FAIL', reasons };
}

async function captureXmpText(page) {
  return page.evaluate(() => new Promise((resolve) => {
    let captured = null;
    const orig = URL.createObjectURL;
    URL.createObjectURL = (b) => { captured = b; return orig.call(URL, b); };
    const btn = document.getElementById('btnDownload');
    if (!btn) { URL.createObjectURL = orig; resolve(null); return; }
    btn.click();
    setTimeout(async () => { URL.createObjectURL = orig; resolve(captured ? await captured.text() : null); }, 300);
  }));
}
function sha256(text) {
  return crypto.createHash('sha256').update(text ?? '').digest('hex');
}

async function main() {
  runId = generateRunId();
  startedAt = new Date().toISOString();
  sourceHash = await computeSourceHash(SOURCE_HASH_INPUTS);

  let manifest;
  try {
    manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
  } catch (e) {
    await writeBrowserUnavailableResult(RESULTS_PATH, { suite: SUITE_NAME, status: 'FIXTURE_MISSING', reason: `manifest.json unreadable: ${e.message}` });
    process.exit(1);
  }
  for (const fx of manifest.fixtures) {
    const fp = path.join(FIXTURES_DIR, fx.filename);
    try {
      const st = await stat(fp);
      if (!st.isFile()) throw new Error('not a regular file');
      const buf = await readFile(fp);
      if (fx.exifOrientation !== null) {
        const parsed = readJpegExifOrientation(buf);
        if (parsed !== fx.exifOrientation) throw new Error(`EXIF mismatch: manifest=${fx.exifOrientation}, parsed=${parsed}`);
      }
    } catch (e) {
      await writeBrowserUnavailableResult(RESULTS_PATH, { suite: SUITE_NAME, status: 'FIXTURE_MISSING', reason: `${fx.filename}: ${e.message}` });
      process.exit(1);
    }
  }

  const pkg = await detectPlaywrightPackage();
  if (pkg.status !== 'PLAYWRIGHT_PACKAGE_AVAILABLE') {
    await writeBrowserUnavailableResult(RESULTS_PATH, { suite: SUITE_NAME, status: 'PLAYWRIGHT_PACKAGE_UNAVAILABLE', reason: pkg.error });
    console.log('Final decision: PLAYWRIGHT_PACKAGE_UNAVAILABLE');
    process.exit(0);
  }
  const { chromium } = pkg.mod;
  const browserDetect = await detectBrowserExecutable(chromium);
  if (!browserDetect.found) {
    await writeBrowserUnavailableResult(RESULTS_PATH, { suite: SUITE_NAME, status: 'BROWSER_BINARY_UNAVAILABLE', reason: JSON.stringify(browserDetect.attempts) });
    console.log('Final decision: BROWSER_BINARY_UNAVAILABLE');
    process.exit(0);
  }

  const browser = await chromium.launch({ executablePath: browserDetect.found, args: REQUIRED_LAUNCH_ARGS });
  const appSnapshot = await buildLumixaAppSnapshot(PROJECT_ROOT);

  try {
    const runtime = await openLumixaInMemoryPage({ browser, projectRoot: PROJECT_ROOT, qaQuery: '?qa=1', viewport: { width: 1440, height: 1200 }, prebuiltApp: appSnapshot });
    const page = runtime.page;
    const pageErrors = [];
    const consoleErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      if (text.includes('fonts.googleapis.com') || text.includes('fonts.gstatic.com') || text.includes('Failed to load resource')) return;
      consoleErrors.push(text);
    });
    await page.waitForTimeout(600);

    let priorGeneration = 0;
    let previousFixture = null;
    const orderedFixtures = manifest.fixtures.slice();

    for (const fx of orderedFixtures) {
      const fixtureAbsPath = path.join(FIXTURES_DIR, fx.filename);
      const tag = `[${fx.filename}]`;

      const genBeforeUpload = priorGeneration;
      await page.setInputFiles('#fileIn', fixtureAbsPath);
      const initialAnalysis = await waitForAnalysisCompletion(page, genBeforeUpload, 25000);
      recordCondition(`${tag} Step 1-2: upload + initial Analysis completes`, initialAnalysis.completed === true, JSON.stringify(initialAnalysis.snapshot?.previewSandbox ?? {}));

      const genBeforeReview = initialAnalysis.snapshot?.analysisGeneration ?? genBeforeUpload;
      const passedCount = await passAllReviewItems(page);
      await page.click('#btnReanalyze');
      const afterReview = await waitForAnalysisCompletion(page, genBeforeReview, 25000);
      recordCondition(`${tag} Step 3: Human Review completed + Re-analyze reaches a new generation`, afterReview.completed === true && (afterReview.snapshot?.analysisGeneration ?? -1) > genBeforeReview, `manualVisualButtonsClicked=${passedCount?.manualVisualButtonsClicked}, generation=${afterReview.snapshot?.analysisGeneration}`);
      priorGeneration = afterReview.snapshot?.analysisGeneration ?? genBeforeReview;

      let snap = afterReview.snapshot;
      const pollStart = Date.now();
      while (Date.now() - pollStart < 15000) {
        snap = await qaSnapshot(page);
        const settled = snap?.visualPreview?.legacyState !== undefined
          && (snap?.interactive?.state === 'ready' || snap?.interactive?.state === 'blocked' || snap?.interactive?.state === 'partial' || snap?.interactive?.state === 'failed');
        if (settled) break;
        await page.waitForTimeout(250);
      }
      recordCondition(`${tag} Step 4: current-generation Visual Preview settled`, !!snap, JSON.stringify({ interactive: snap?.interactive, visualPreview: snap?.visualPreview }));

      const diag = snap?.previewGeometryDiagnostics;
      // These are the exact assertions Phase C2 requires and Phase C1
      // explicitly must NOT make: real canGeneratePreview=true, zero
      // hard stops, a real V2 Render Plan. A blocker here on one of
      // these photo-like fixtures is a FIXTURE-DESIGN failure per the
      // spec, never grounds to weaken this assertion.
      recordCondition(`${tag} Step 5: canGeneratePreview=true (real Safety eligibility, never weakened)`, diag?.canGeneratePreview === true, `canGeneratePreview=${diag?.canGeneratePreview}, blockerCode=${diag?.blockerCode}`);
      recordCondition(`${tag} Step 5: no hard stop`, diag?.hardStopCount === 0, `hardStopCount=${diag?.hardStopCount}`);
      recordCondition(`${tag} Step 5: V2 Render Plan exists`, diag?.renderPlanExists === true && diag?.v2PlanExists === true, JSON.stringify(diag));

      recordCondition(`${tag} Step 6: Legacy rendered`, snap?.visualPreview?.legacyState === 'renderable', `legacyState=${snap?.visualPreview?.legacyState}`);
      recordCondition(`${tag} Step 7: V2 rendered (or truthful Identity)`, snap?.visualPreview?.controlledV2State === 'renderable', `controlledV2State=${snap?.visualPreview?.controlledV2State}, v2Renderable=${diag?.v2Renderable}`);
      recordCondition(`${tag} Step 8: Alignment reports Exact dimensions`, snap?.interactive?.alignmentStatus === 'Exact dimensions', `alignmentStatus=${snap?.interactive?.alignmentStatus}`);
      recordCondition(`${tag} Step 9: Interactive Before/After reaches ready`, snap?.interactive?.state === 'ready', `state=${snap?.interactive?.state}`);
      recordCondition(`${tag} Step 10: Observation controls enabled`, snap?.observation?.enabled === true, `enabled=${snap?.observation?.enabled}, state=${snap?.observation?.state}`);

      const beforeObs = { selectedOutputSource: snap?.previewSandbox?.selectedOutputSource, canWriteProduction: snap?.previewSandbox?.canWriteProduction, canExportPreview: snap?.previewSandbox?.canExportPreview, canEnterControlledTest: snap?.testGate?.canEnterControlledTest };
      const xmpBeforeHash = sha256(await captureXmpText(page));

      let keyboardSelectOk = false;
      try {
        await page.locator('#ipoOption_prefer-legacy').focus();
        await page.keyboard.press('Space');
        await page.waitForTimeout(150);
        const checked = await page.evaluate(() => document.getElementById('ipoOption_prefer-legacy')?.checked === true);
        keyboardSelectOk = checked === true;
      } catch { keyboardSelectOk = false; }
      recordCondition(`${tag} Step 11: Observation selected via real keyboard (focus + Space)`, keyboardSelectOk, `keyboardSelectOk=${keyboardSelectOk}`);

      const afterObsSnap = await qaSnapshot(page);
      const afterObs = { selectedOutputSource: afterObsSnap?.previewSandbox?.selectedOutputSource, canWriteProduction: afterObsSnap?.previewSandbox?.canWriteProduction, canExportPreview: afterObsSnap?.previewSandbox?.canExportPreview, canEnterControlledTest: afterObsSnap?.testGate?.canEnterControlledTest };
      const productionUnchanged = beforeObs.selectedOutputSource === 'legacy' && afterObs.selectedOutputSource === 'legacy'
        && beforeObs.canWriteProduction === false && afterObs.canWriteProduction === false
        && beforeObs.canExportPreview === false && afterObs.canExportPreview === false
        && beforeObs.canEnterControlledTest === false && afterObs.canEnterControlledTest === false;
      recordCondition(`${tag} Step 12: Production remains Legacy; Mapping/Controlled-Test unchanged after Observation`, productionUnchanged, JSON.stringify({ before: beforeObs, after: afterObs }));

      const xmpAfterHash = sha256(await captureXmpText(page));
      recordCondition(`${tag} Step 12b: exported XMP text is byte-for-byte unchanged after Observation`, xmpBeforeHash === xmpAfterHash && xmpBeforeHash !== sha256(null), `before=${xmpBeforeHash}, after=${xmpAfterHash}`);

      const genBeforeReanalyze = afterObsSnap?.analysisGeneration ?? priorGeneration;
      await page.click('#btnReanalyze');
      const reanalyzed = await waitForAnalysisCompletion(page, genBeforeReanalyze, 25000);
      const reanalyzedSnap = reanalyzed.snapshot;
      const staleCheckOk = reanalyzed.completed === true
        && (reanalyzedSnap?.analysisGeneration ?? -1) > genBeforeReanalyze
        && reanalyzedSnap?.canonicalSourceGeometry?.generationId === reanalyzedSnap?.analysisGeneration
        && reanalyzedSnap?.canonicalSourceGeometry?.canonicalWidth !== null;
      recordCondition(`${tag} Step 13: re-analyze produces a fresh, current-generation canonical geometry (no stale commit)`, staleCheckOk, JSON.stringify(reanalyzedSnap?.canonicalSourceGeometry ?? {}));
      priorGeneration = reanalyzedSnap?.analysisGeneration ?? priorGeneration;

      if (previousFixture) {
        const dimsShouldDiffer = previousFixture.expectedDecodedWidth !== fx.expectedDecodedWidth || previousFixture.expectedDecodedHeight !== fx.expectedDecodedHeight;
        const currentCanonical = reanalyzedSnap?.canonicalSourceGeometry;
        const noPriorGeometryLeaked = !dimsShouldDiffer || (currentCanonical?.canonicalWidth === fx.expectedDecodedWidth && currentCanonical?.canonicalHeight === fx.expectedDecodedHeight);
        recordCondition(`${tag} Step 14: no prior fixture's geometry remains (vs previous: ${previousFixture.filename})`, noPriorGeometryLeaked, JSON.stringify({ current: currentCanonical, expected: { w: fx.expectedDecodedWidth, h: fx.expectedDecodedHeight }, previous: { w: previousFixture.expectedDecodedWidth, h: previousFixture.expectedDecodedHeight } }));
      } else {
        recordStatus(`${tag} Step 14: no prior fixture's geometry remains`, 'NOT_APPLICABLE', 'first fixture in sequence — no prior fixture to compare against');
      }
      previousFixture = fx;
    }

    recordCondition('Zero page errors across the entire full-app-eligible suite', pageErrors.length === 0, pageErrors.length === 0 ? '(none)' : pageErrors.join('; '));
    recordCondition('Zero console errors across the entire full-app-eligible suite', consoleErrors.length === 0, consoleErrors.length === 0 ? '(none)' : consoleErrors.join('; '));
    recordCondition('Zero non-allowed Network requests (data:/about: only)', runtime.collectors.nonAllowedNetworkRequests.length === 0, JSON.stringify(runtime.collectors.nonAllowedNetworkRequests));

    await runtime.cleanup();

    const passCount = results.filter((r) => r.result === 'PASS').length;
    const failCount = results.filter((r) => r.result === 'FAIL').length;
    const decisionResult = computeFullAppEligibleDecision(results, { completed: true, sourceHash, currentSourceHash: sourceHash });
    const output = {
      suite: SUITE_NAME,
      scopeNote: 'This suite proves full-app safety-eligible geometry behavior on photo-like fixtures. See qa/epic-2e-j-preview-geometry-decoder-render-test.mjs (Phase C1) for decoder/render-only coverage on synthetic marker fixtures.',
      runId, startedAt, completedAt: new Date().toISOString(), completed: true, sourceHash,
      browserExecutablePath: browserDetect.found, browserVersion: browser.version?.() ?? null,
      generatedAt: new Date().toISOString(),
      summary: { total: results.length, pass: passCount, fail: failCount, notTested: results.length - passCount - failCount },
      results,
      decision: decisionResult.decision,
      decisionReasons: decisionResult.reasons,
    };
    await mkdir(path.join(PROJECT_ROOT, 'qa'), { recursive: true });
    await writeResultAtomic(RESULTS_PATH, output);
    console.log(`\n${passCount}/${results.length} PASS, ${failCount} FAIL`);
    console.log(`Decision: ${decisionResult.decision}${decisionResult.reasons.length ? ` (${decisionResult.reasons.join(', ')})` : ''}`);
    process.exit(decisionResult.decision === 'PASS' ? 0 : 1);
  } finally {
    await browser.close();
  }
}

const isMainModule = (() => {
  try { return import.meta.url === `file://${process.argv[1]}`; } catch { return false; }
})();
if (isMainModule) {
  main().catch(async (err) => {
    console.error('Full-App Safety-Eligible Geometry suite crashed:', err?.name ?? err);
    try {
      const nowIso = new Date().toISOString();
      await writeResultAtomic(RESULTS_PATH, {
        suite: SUITE_NAME, runId, startedAt, completedAt: nowIso, completed: false, sourceHash,
        browserExecutablePath: null, browserVersion: null, generatedAt: nowIso,
        summary: { total: 1, pass: 0, fail: 1, notTested: 0 },
        results: [buildRuntimeCrashRow(err)],
        decision: 'FAIL',
      });
    } catch (writeErr) {
      console.error('Failed to write crash result JSON:', writeErr?.name ?? writeErr);
    }
    process.exit(2);
  });
}
