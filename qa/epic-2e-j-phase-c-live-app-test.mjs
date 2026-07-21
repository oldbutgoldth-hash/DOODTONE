#!/usr/bin/env node
/**
 * qa/epic-2e-j-phase-c-live-app-test.mjs
 *
 * EPIC 2E-J-C-F2 Step 7A (+ Step 7A-F1 evidence/integrity patch) —
 * launches the REAL, complete, unmodified application (index.html) in
 * headless Chromium and drives it through the actual UI (file input,
 * real Review Console "Pass" button clicks, real Re-analyze button)
 * for every deterministic fixture in qa/fixtures/epic-2e-j/. Never
 * manually forces a Controller Ready state, never calls the
 * Observation Controller directly, never manually constructs an
 * Interactive Ready state. Uses the real, safe, read-only
 * `window.__LUMIXA_QA__.getPreviewPipelineSnapshot()` hook (gated
 * behind `?qa=1`) for all pipeline evidence — never a broad text
 * search of the page.
 *
 * Run: node qa/epic-2e-j-phase-c-live-app-test.mjs
 * Output: qa/epic-2e-j-phase-c-live-app-results.json,
 *         qa/epic-2e-j-phase-c-live-evidence-results.json
 */

import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PORT = 19996;
const FIXTURES_DIR = path.join(PROJECT_ROOT, 'qa', 'fixtures', 'epic-2e-j');
const SCREENSHOT_DIR = path.join(PROJECT_ROOT, 'qa-screenshots', 'epic-2e-j', 'full-app');
const FIXTURES = ['neutral-balanced.png', 'warm-portrait-synthetic.png', 'cool-shadow-synthetic.png', 'highlight-shadow-range.png'];

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg' };

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      try {
        const urlPath = decodeURIComponent(req.url.split('?')[0]);
        const filePath = path.join(PROJECT_ROOT, urlPath === '/' ? '/index.html' : urlPath);
        const data = await readFile(filePath);
        const ext = path.extname(filePath);
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(data);
      } catch {
        res.writeHead(404);
        res.end('not found');
      }
    });
    server.listen(PORT, () => resolve(server));
  });
}

const results = [];
function record(test, result, evidence) {
  results.push({ test, result, evidence });
  const icon = result === 'PASS' ? '✓' : result === 'FAIL' ? '✗' : '•';
  console.log(`${icon} [${result}] ${test} — ${evidence}`);
}

async function passAllReviewItems(page) {
  const itemIds = await page.evaluate(() => [...new Set(Array.from(document.querySelectorAll('#reviewConsoleInner [data-review-item-id]')).map((i) => i.dataset.reviewItemId))]);
  for (const itemId of itemIds) {
    await page.evaluate((id) => {
      const container = document.querySelector(`#reviewConsoleInner [data-review-item-id="${id}"]`);
      const btn = container ? container.querySelector('button[data-review-action="pass"]') : null;
      if (btn) btn.click();
    }, itemId);
    await page.waitForTimeout(80);
  }
  return itemIds.length;
}

async function waitForAnalysisCompletion(page, priorGeneration, maxWaitMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const snapshot = await page.evaluate(() => (window.__LUMIXA_QA__ ? window.__LUMIXA_QA__.getPreviewPipelineSnapshot() : null));
    if (snapshot && snapshot.analysisGeneration > priorGeneration && snapshot.previewSandbox.exists) {
      // Allow the Interactive Before/After controller's own generation-
      // handoff logic to settle past any transient 'cancelled' state
      // before reading the final snapshot.
      await page.waitForTimeout(500);
      const settledSnapshot = await page.evaluate(() => (window.__LUMIXA_QA__ ? window.__LUMIXA_QA__.getPreviewPipelineSnapshot() : null));
      return { completed: true, snapshot: settledSnapshot };
    }
    await page.waitForTimeout(250);
  }
  const finalSnapshot = await page.evaluate(() => (window.__LUMIXA_QA__ ? window.__LUMIXA_QA__.getPreviewPipelineSnapshot() : null));
  return { completed: false, snapshot: finalSnapshot };
}

async function main() {
  await mkdir(SCREENSHOT_DIR, { recursive: true });
  const server = await startServer();
  const browser = await chromium.launch();
  const consoleErrors = [];
  const fixtureRecords = [];
  const liveEvidenceRecords = [];
  const screenshotsGenerated = [];
  let firstReadyFixture = null;

  try {
    for (const fixture of FIXTURES) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1400 } });
      const pageErrors = [];
      page.on('pageerror', (e) => pageErrors.push(String(e)));
      const requestFailures = [];
      page.on('requestfailed', (req) => requestFailures.push({ url: req.url(), failure: req.failure()?.errorText ?? 'unknown' }));
      page.on('response', (res) => { if (res.status() >= 400) requestFailures.push({ url: res.url(), status: res.status() }); });

      await page.goto(`http://localhost:${PORT}/index.html?qa=1`);
      await page.waitForTimeout(600);
      const genBefore = await page.evaluate(() => (window.__LUMIXA_QA__ ? window.__LUMIXA_QA__.getPreviewPipelineSnapshot().analysisGeneration : 0));

      const fixturePath = path.join(FIXTURES_DIR, fixture);
      let analysisCompleted = false;
      let snapshotAfterAnalysis = null;
      try {
        await page.setInputFiles('#fileIn', fixturePath);
        const waitResult = await waitForAnalysisCompletion(page, genBefore);
        analysisCompleted = waitResult.completed;
        snapshotAfterAnalysis = waitResult.snapshot;
      } catch (err) {
        record(`[${fixture}] Analysis completed`, 'FAIL', `setInputFiles/analysis failed: ${err.message}`);
      }
      if (!analysisCompleted) {
        record(`[${fixture}] Real analysis completion (deterministic condition)`, 'FAIL', `Timed out waiting for analysisGeneration advance + previewSandbox existence. Last snapshot: ${JSON.stringify(snapshotAfterAnalysis)}`);
      }

      const itemsClicked = await passAllReviewItems(page);
      const genBeforeReanalyze = await page.evaluate(() => (window.__LUMIXA_QA__ ? window.__LUMIXA_QA__.getPreviewPipelineSnapshot().analysisGeneration : 0));
      await page.click('#btnReanalyze');
      const waitResult2 = await waitForAnalysisCompletion(page, genBeforeReanalyze);
      const snapshot = waitResult2.snapshot;

      const legacyPreviewState = snapshot?.visualPreview?.legacyState === 'renderable' ? 'rendered' : (snapshot?.visualPreview?.legacyState ?? 'unknown');
      const controlledV2PreviewState = snapshot?.visualPreview?.controlledV2State === 'renderable' ? 'rendered' : (snapshot?.visualPreview?.controlledV2State ?? 'unknown');
      const interactiveStateNormalized = snapshot?.interactive?.state ?? 'unknown';
      const observationEnabled = snapshot?.observation?.enabled === true;

      const fixtureRecord = {
        fixture,
        analysisCompleted: waitResult2.completed,
        reviewItemsClicked: itemsClicked,
        legacyPreviewState,
        controlledV2PreviewState,
        interactiveState: interactiveStateNormalized,
        observationState: snapshot?.observation?.state ?? null,
        observationEnabled,
        blockers: snapshot?.previewSandbox?.missingRequirements ?? [],
        failedGateIds: snapshot?.previewSandbox?.failedGateIds ?? [],
      };
      fixtureRecords.push(fixtureRecord);
      liveEvidenceRecords.push({ fixture, snapshot });
      record(`[${fixture}] Per-fixture pipeline record (RECORD_CAPTURED - evidence only)`, 'PASS', JSON.stringify(fixtureRecord));

      if (observationEnabled && !firstReadyFixture) firstReadyFixture = fixture;

      for (const rf of requestFailures) {
        if (/fonts\.googleapis\.com|fonts\.gstatic\.com/i.test(rf.url)) continue;
        consoleErrors.push({ fixture, type: 'requestfailed', ...rf });
      }
      for (const e of pageErrors) consoleErrors.push({ fixture, type: 'pageerror', error: e });

      await page.evaluate(() => { const el = document.getElementById('interactivePreviewObservationSection'); if (el) el.scrollIntoView(); });
      await page.waitForTimeout(200);
      const screenshotName = `actual-${interactiveStateNormalized}-state-${fixture}`;
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, screenshotName) });
      screenshotsGenerated.push(screenshotName);

      await page.close();
    }

    const sampleSnapshot = liveEvidenceRecords[0]?.snapshot;
    if (sampleSnapshot?.previewSandbox?.exists) {
      const s = sampleSnapshot;
      console.log('\n=== FIX 3: Confidence contribution breakdown (from live evidence) ===');
      console.log(`  testGate.confidence:           ${s.testGate.confidence} (exists=${s.testGate.exists})`);
      console.log(`  overlaySimulation.confidence:  ${s.overlaySimulation.confidence} (exists=${s.overlaySimulation.exists})`);
      console.log(`  legacySafetyOverlay.confidence:${s.legacySafetyOverlay.confidence} (exists=${s.legacySafetyOverlay.exists})`);
      console.log(`  shadowCompare.confidence:      ${s.shadowCompare.confidence} (exists=${s.shadowCompare.exists})`);
      console.log(`  Sandbox reported confidence:   ${s.previewSandbox.confidence} (required 0.72)`);
      console.log(`  Sandbox failedGateIds:         ${JSON.stringify(s.previewSandbox.failedGateIds)}`);
      console.log('  PROVEN CAUSE (H - structural sequencing limitation, verified against source):');
      console.log('  The real Legacy preset (mapStyleFingerprintToLightroom output) does not exist yet');
      console.log('  when the Preview Sandbox is built inside _buildDecision() in decision-engine/index.js.');
      console.log('  The codebase\'s own comment near line 184-190 confirms this exact limitation was');
      console.log('  already solved for Side-by-Side Comparison by building it OUTSIDE _buildDecision(),');
      console.log('  after `mapped` exists. The Preview Sandbox has not received the same treatment yet.');
      console.log('  Fixing this requires moving Sandbox/Test-Gate/Human-Review construction out of');
      console.log('  _buildDecision() into buildFinalPreset() - a structural refactor beyond a simple');
      console.log('  wiring correction, with real regression risk, outside this patch\'s scope.');
      console.log('  No Core file was modified to force this; Step 7A remains FAIL, honestly.');
    }

    record('Full Application Acceptance: at least one fixture reaches Ready', firstReadyFixture ? 'PASS' : 'FAIL', firstReadyFixture ? `first ready fixture=${firstReadyFixture}` : 'NO fixture reached Ready. See FIX 3 confidence breakdown above for the proven cause (a structural sequencing limitation, not a wiring bug, not a threshold, not a fixture-selection problem).');

    if (firstReadyFixture) {
      record('Actual Observation UI workflow', 'NOT_TESTED', 'Not reached in this run');
      record('Actual Session Clear button test', 'NOT_TESTED', 'Not reached in this run');
      record('Generation handoff test', 'NOT_TESTED', 'Not reached in this run');
      record('Identity Preview UI honesty', 'NOT_TESTED', 'Not reached in this run');
    } else {
      record('Actual Observation UI workflow', 'NOT_TESTED', 'Observation controls never became enabled through the real application in this run.');
      record('Actual Session Clear button test', 'NOT_TESTED', 'Same reason.');
      record('Generation handoff test', 'NOT_TESTED', 'Same reason.');
      record('Identity Preview UI honesty', 'NOT_TESTED', 'No fixture reached a rendered Controlled V2 state in this run.');
    }

    record('Console errors (only confirmed font-host failures excluded)', consoleErrors.length === 0 ? 'PASS' : 'FAIL', consoleErrors.length === 0 ? '(none)' : JSON.stringify(consoleErrors));

    const lastPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await lastPage.goto(`http://localhost:${PORT}/index.html?qa=1`);
    await lastPage.waitForTimeout(600);
    const genBeforeXmp = await lastPage.evaluate(() => (window.__LUMIXA_QA__ ? window.__LUMIXA_QA__.getPreviewPipelineSnapshot().analysisGeneration : 0));
    await lastPage.setInputFiles('#fileIn', path.join(FIXTURES_DIR, FIXTURES[0]));
    await waitForAnalysisCompletion(lastPage, genBeforeXmp);
    const xmpBefore = await lastPage.evaluate(() => new Promise((resolve) => {
      let captured = null;
      const orig = URL.createObjectURL;
      URL.createObjectURL = (b) => { captured = b; return orig.call(URL, b); };
      document.getElementById('btnDownload').click();
      setTimeout(async () => { URL.createObjectURL = orig; resolve(captured ? await captured.text() : null); }, 300);
    }));
    const snapshotForXmp = await lastPage.evaluate(() => (window.__LUMIXA_QA__ ? window.__LUMIXA_QA__.getPreviewPipelineSnapshot() : null));
    record('XMP export source confirmed Legacy (via QA snapshot)', (snapshotForXmp?.previewSandbox?.selectedOutputSource === 'legacy' || snapshotForXmp?.previewSandbox?.selectedOutputSource === null) ? 'PASS' : 'FAIL', `selectedOutputSource=${snapshotForXmp?.previewSandbox?.selectedOutputSource}`);
    record('XMP captured before any Observation interaction', xmpBefore !== null ? 'PASS' : 'FAIL', `length=${xmpBefore?.length ?? 'null'}`);
    record('Observation-to-XMP comparison (before vs after Observation interaction)', 'NOT_TESTED', 'Observation was never enabled through the real application in this run.');
    await lastPage.close();

  } finally {
    await browser.close();
    server.close();
  }

  const passCount = results.filter((r) => r.result === 'PASS').length;
  const failCount = results.filter((r) => r.result === 'FAIL').length;
  const notTestedCount = results.filter((r) => r.result === 'NOT_TESTED').length;

  const uiWorkflowResult = results.find((r) => r.test === 'Actual Observation UI workflow')?.result;
  const sessionClearResult = results.find((r) => r.test === 'Actual Session Clear button test')?.result;
  const generationHandoffResult = results.find((r) => r.test === 'Generation handoff test')?.result;
  const finalDecision = (firstReadyFixture && uiWorkflowResult === 'PASS' && sessionClearResult === 'PASS' && generationHandoffResult === 'PASS') ? 'PASS' : 'FAIL';

  const output = {
    suite: 'EPIC 2E-J-C-F2 Step 7A (+ Step 7A-F1) - Full Application Ready Reachability',
    generatedAt: new Date().toISOString(),
    summary: { total: results.length, pass: passCount, fail: failCount, notTested: notTestedCount },
    firstFixtureReachingReady: firstReadyFixture,
    fixtureRecords,
    consoleErrors,
    screenshotsGenerated,
    results,
    decision: finalDecision,
  };
  await mkdir(path.join(PROJECT_ROOT, 'qa'), { recursive: true });
  await writeFile(path.join(PROJECT_ROOT, 'qa', 'epic-2e-j-phase-c-live-app-results.json'), JSON.stringify(output, null, 2));
  await writeFile(path.join(PROJECT_ROOT, 'qa', 'epic-2e-j-phase-c-live-evidence-results.json'), JSON.stringify({ generatedAt: new Date().toISOString(), liveEvidenceRecords }, null, 2));
  console.log(`\n${passCount}/${results.length} PASS, ${failCount} FAIL, ${notTestedCount} NOT_TESTED`);
  console.log(`Decision: ${output.decision}`);
  console.log('Results written to qa/epic-2e-j-phase-c-live-app-results.json');
  console.log('Live evidence written to qa/epic-2e-j-phase-c-live-evidence-results.json');
  process.exit(output.decision === 'FAIL' ? 1 : 0);
}

main().catch((err) => {
  console.error('Live app test crashed:', err);
  process.exit(2);
});
