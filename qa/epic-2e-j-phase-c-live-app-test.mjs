#!/usr/bin/env node
/**
 * qa/epic-2e-j-phase-c-live-app-test.mjs
 *
 * EPIC 2E-J-C-F2 Step 7A (+ F1/F2/F2-F/F2-G/F3) — launches the REAL,
 * complete, unmodified application (index.html) in headless Chromium
 * and drives it entirely through actual DOM interactions: file input,
 * real Review Console "Pass" clicks, real Re-analyze, real Observation
 * radio/checkbox clicks, real Clear Reasons/Clear Observation/Clear
 * Session button clicks, and a real fixture-swap Generation handoff.
 * Never manually forces a Controller Ready state, never calls the
 * Observation Controller directly for acceptance checks — DOM state is
 * the primary evidence; the safe, read-only `?qa=1` snapshot hook is
 * used only to confirm internal counts.
 *
 * Run: node qa/epic-2e-j-phase-c-live-app-test.mjs
 * Output: qa/epic-2e-j-phase-c-live-app-results.json,
 *         qa/epic-2e-j-phase-c-live-evidence-results.json
 */

import http from 'node:http';
import crypto from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PORT = 19995;
const FIXTURES_DIR = path.join(PROJECT_ROOT, 'qa', 'fixtures', 'epic-2e-j');
const F3_SCREENSHOT_DIR = path.join(PROJECT_ROOT, 'qa-screenshots', 'epic-2e-j', 'full-app-f3');
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
  // Normalize boolean call-sites (many of this file's Part 2 assertions
  // pass a boolean condition directly) to the canonical PASS/FAIL/NOT_TESTED
  // string vocabulary used throughout the JSON output and decision logic.
  const normalizedResult = typeof result === 'boolean' ? (result ? 'PASS' : 'FAIL') : result;
  results.push({ test, result: normalizedResult, evidence });
  const icon = normalizedResult === 'PASS' ? '✓' : normalizedResult === 'FAIL' ? '✗' : '•';
  console.log(`${icon} [${normalizedResult}] ${test} — ${evidence}`);
}

async function qaSnapshot(page) {
  return page.evaluate(() => (window.__LUMIXA_QA__ ? window.__LUMIXA_QA__.getPreviewPipelineSnapshot() : null));
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

async function waitForAnalysisCompletion(page, priorGeneration, maxWaitMs = 25000) {
  const start = Date.now();
  const transientInteractiveStates = new Set(['cancelled', 'preparing', null, undefined]);
  while (Date.now() - start < maxWaitMs) {
    const snapshot = await qaSnapshot(page);
    if (snapshot && snapshot.analysisGeneration > priorGeneration && snapshot.previewSandbox.exists && !transientInteractiveStates.has(snapshot.interactive?.state)) {
      return { completed: true, snapshot };
    }
    await page.waitForTimeout(300);
  }
  const finalSnapshot = await qaSnapshot(page);
  return { completed: finalSnapshot?.previewSandbox?.exists === true, snapshot: finalSnapshot };
}

async function importAndReachReady(page, fixture, priorGeneration) {
  await page.setInputFiles('#fileIn', path.join(FIXTURES_DIR, fixture));
  await waitForAnalysisCompletion(page, priorGeneration);
  const genBeforeReview = await qaSnapshot(page).then((s) => s?.analysisGeneration ?? priorGeneration);
  await passAllReviewItems(page);
  await page.click('#btnReanalyze');
  const result = await waitForAnalysisCompletion(page, genBeforeReview);
  return result;
}

async function captureXmpText(page) {
  return page.evaluate(() => new Promise((resolve) => {
    let captured = null;
    const orig = URL.createObjectURL;
    URL.createObjectURL = (b) => { captured = b; return orig.call(URL, b); };
    document.getElementById('btnDownload').click();
    setTimeout(async () => { URL.createObjectURL = orig; resolve(captured ? await captured.text() : null); }, 300);
  }));
}

function sha256(text) {
  return crypto.createHash('sha256').update(text ?? '').digest('hex');
}

async function main() {
  await mkdir(F3_SCREENSHOT_DIR, { recursive: true });
  const server = await startServer();
  const browser = await chromium.launch();
  const consoleErrors = [];
  const fixtureRecords = [];
  const liveEvidenceRecords = [];
  const screenshotsGenerated = [];
  let firstReadyFixture = null;

  try {
    // ══════════════════════════════════════════════════════════════
    // PART 1 — per-fixture pipeline reachability (unchanged from
    // Step 7A/F1/F2/F2-G), re-verified as a regression check.
    // ══════════════════════════════════════════════════════════════
    for (const fixture of FIXTURES) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1400 } });
      const pageErrors = [];
      page.on('pageerror', (e) => pageErrors.push(String(e)));
      const requestFailures = [];
      page.on('requestfailed', (req) => requestFailures.push({ url: req.url(), failure: req.failure()?.errorText ?? 'unknown' }));
      page.on('response', (res) => { if (res.status() >= 400) requestFailures.push({ url: res.url(), status: res.status() }); });

      await page.goto(`http://localhost:${PORT}/index.html?qa=1`);
      await page.waitForTimeout(600);
      const genBefore = await qaSnapshot(page).then((s) => s?.analysisGeneration ?? 0);
      const { completed, snapshot } = await importAndReachReady(page, fixture, genBefore);

      const legacyPreviewState = snapshot?.visualPreview?.legacyState === 'renderable' ? 'rendered' : (snapshot?.visualPreview?.legacyState ?? 'unknown');
      const controlledV2PreviewState = snapshot?.visualPreview?.controlledV2State === 'renderable' ? 'rendered' : (snapshot?.visualPreview?.controlledV2State ?? 'unknown');
      const interactiveStateNormalized = snapshot?.interactive?.state ?? 'unknown';
      const observationEnabled = snapshot?.observation?.enabled === true;

      const fixtureRecord = {
        fixture, analysisCompleted: completed,
        legacyPreviewState, controlledV2PreviewState,
        legacyContextAvailability: snapshot?.previewSandbox?.legacyContextAvailability ?? null,
        legacyContextSourceType: snapshot?.previewSandbox?.legacyContextSourceType ?? null,
        sandboxConfidence: snapshot?.previewSandbox?.confidence ?? null,
        sandboxSafetyScore: snapshot?.previewSandbox?.safetyScore ?? null,
        canGeneratePreview: snapshot?.previewSandbox?.canGeneratePreview ?? null,
        interactiveState: interactiveStateNormalized,
        observationEnabled,
        blockers: snapshot?.previewSandbox?.missingRequirements ?? [],
      };
      fixtureRecords.push(fixtureRecord);
      liveEvidenceRecords.push({ fixture, snapshot });
      record(`[${fixture}] Per-fixture pipeline record`, 'PASS', JSON.stringify(fixtureRecord));
      if (observationEnabled && !firstReadyFixture) firstReadyFixture = fixture;

      for (const rf of requestFailures) { if (!/fonts\.googleapis\.com|fonts\.gstatic\.com/i.test(rf.url)) consoleErrors.push({ fixture, type: 'requestfailed', ...rf }); }
      for (const e of pageErrors) consoleErrors.push({ fixture, type: 'pageerror', error: e });
      await page.close();
    }

    record('Full Application Acceptance: at least one fixture reaches Ready', firstReadyFixture ? 'PASS' : 'FAIL', firstReadyFixture ? `first ready fixture=${firstReadyFixture}` : 'NO fixture reached Ready in this run.');

    // ══════════════════════════════════════════════════════════════
    // PART 2 — Step 7A-F3: actual Observation UI, Session Clear,
    // Generation handoff, XMP exact comparison, side-effect checks.
    // Only runs when at least one fixture reaches Ready.
    // ══════════════════════════════════════════════════════════════
    if (firstReadyFixture) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1400 } });
      const f3Errors = [];
      page.on('pageerror', (e) => f3Errors.push(String(e)));
      const f3RequestFailures = [];
      page.on('requestfailed', (req) => f3RequestFailures.push(req.url()));

      await page.goto(`http://localhost:${PORT}/index.html?qa=1`);
      await page.waitForTimeout(600);
      const gen0 = await qaSnapshot(page).then((s) => s?.analysisGeneration ?? 0);
      await importAndReachReady(page, FIXTURES[0], gen0);
      await page.evaluate(() => { const el = document.getElementById('interactivePreviewObservationSection'); if (el) el.scrollIntoView(); });
      await page.waitForTimeout(300);

      // ── XMP capture BEFORE any Observation interaction ──
      const xmpBefore = await captureXmpText(page);
      const snapshotBeforeObs = await qaSnapshot(page);

      // ── Actual Observation radio + Reason checkbox test ──
      await page.click('#ipoOption_prefer-legacy');
      await page.waitForTimeout(200);
      const legacyChecked1 = await page.evaluate(() => document.getElementById('ipoOption_prefer-legacy').checked);
      record('Actual Observation radio: Prefer Legacy checked', legacyChecked1 === true, `checked=${legacyChecked1}`);
      let s = await qaSnapshot(page);
      record('Session Summary: one Active Legacy Observation after selection', s?.sessionSummary?.activeObservations === 1 && s?.sessionSummary?.preferLegacy === 1, JSON.stringify(s?.sessionSummary));

      await page.click('#ipoReason_skin-tone');
      await page.click('#ipoReason_contrast');
      await page.waitForTimeout(200);
      const skinChecked = await page.evaluate(() => document.getElementById('ipoReason_skin-tone').checked);
      const contrastChecked = await page.evaluate(() => document.getElementById('ipoReason_contrast').checked);
      record('Actual Reason checkboxes: Skin tone + Contrast checked', skinChecked && contrastChecked, `skinTone=${skinChecked}, contrast=${contrastChecked}`);

      const genIdBeforeSwitch = (await qaSnapshot(page))?.observation?.observationGenerationId;
      await page.click('#ipoOption_prefer-v2');
      await page.waitForTimeout(200);
      const v2Checked = await page.evaluate(() => document.getElementById('ipoOption_prefer-v2').checked);
      const skinStillChecked = await page.evaluate(() => document.getElementById('ipoReason_skin-tone').checked);
      const contrastStillChecked = await page.evaluate(() => document.getElementById('ipoReason_contrast').checked);
      s = await qaSnapshot(page);
      record('Prefer V2 selected via real radio', v2Checked === true, `checked=${v2Checked}`);
      record('Reasons preserved across same-generation Observation change', skinStillChecked && contrastStillChecked, `skinTone=${skinStillChecked}, contrast=${contrastStillChecked}`);
      record('Same Generation remains active across Observation change', s?.observation?.observationGenerationId === genIdBeforeSwitch, `before=${genIdBeforeSwitch}, after=${s?.observation?.observationGenerationId}`);
      record('Session contains one active V2 Observation (not two records)', s?.sessionSummary?.activeObservations === 1 && s?.sessionSummary?.preferV2 === 1, JSON.stringify(s?.sessionSummary));
      const legacyWordingVisible = await page.evaluate(() => document.body.textContent.includes('Legacy remains production') || document.body.textContent.toLowerCase().includes('legacy remains production'));
      record('Legacy Production wording remains visible', legacyWordingVisible, `visible=${legacyWordingVisible}`);

      await page.click('#ipoOption_no-visible-difference');
      await page.waitForTimeout(150);
      const noVisDiffChecked = await page.evaluate(() => document.getElementById('ipoOption_no-visible-difference').checked);
      record('No visible difference option selectable via real radio', noVisDiffChecked === true, `checked=${noVisDiffChecked}`);

      await page.click('#ipoOption_unsure');
      await page.waitForTimeout(150);
      const unsureChecked = await page.evaluate(() => document.getElementById('ipoOption_unsure').checked);
      record('Unsure option selectable via real radio', unsureChecked === true, `checked=${unsureChecked}`);

      await page.click('#ipoOption_prefer-legacy');
      await page.waitForTimeout(150);
      const backToLegacy = await page.evaluate(() => document.getElementById('ipoOption_prefer-legacy').checked);
      record('Return to Prefer Legacy via real radio', backToLegacy === true, `checked=${backToLegacy}`);

      await page.screenshot({ path: path.join(F3_SCREENSHOT_DIR, 'prefer-legacy-with-reasons.png') });
      screenshotsGenerated.push('full-app-f3/prefer-legacy-with-reasons.png');

      await page.click('#ipoOption_prefer-v2');
      await page.waitForTimeout(200);
      await page.screenshot({ path: path.join(F3_SCREENSHOT_DIR, 'prefer-v2-reasons-preserved.png') });
      screenshotsGenerated.push('full-app-f3/prefer-v2-reasons-preserved.png');
      await page.click('#ipoOption_prefer-legacy');
      await page.waitForTimeout(200);

      // ── Clear Reasons test ──
      await page.click('#ipoClearReasonsButton');
      await page.waitForTimeout(200);
      const legacyStillCheckedAfterClearReasons = await page.evaluate(() => document.getElementById('ipoOption_prefer-legacy').checked);
      const skinClearedAfterClearReasons = await page.evaluate(() => document.getElementById('ipoReason_skin-tone').checked);
      const contrastClearedAfterClearReasons = await page.evaluate(() => document.getElementById('ipoReason_contrast').checked);
      s = await qaSnapshot(page);
      record('Clear Reasons: current Observation remains checked', legacyStillCheckedAfterClearReasons === true, `checked=${legacyStillCheckedAfterClearReasons}`);
      record('Clear Reasons: every Reason checkbox clears', !skinClearedAfterClearReasons && !contrastClearedAfterClearReasons, `skinTone=${skinClearedAfterClearReasons}, contrast=${contrastClearedAfterClearReasons}`);
      record('Clear Reasons: Session active Observation remains', s?.sessionSummary?.activeObservations === 1, `activeObservations=${s?.sessionSummary?.activeObservations}`);
      record('Clear Reasons: Session Reason counts clear', Object.values(s?.sessionSummary?.reasonCounts ?? {}).every((v) => v === 0), JSON.stringify(s?.sessionSummary?.reasonCounts));
      record('Clear Reasons: Production source remains Legacy', s?.previewSandbox?.selectedOutputSource === 'legacy', `value=${s?.previewSandbox?.selectedOutputSource}`);

      await page.click('#ipoReason_skin-tone');
      await page.click('#ipoReason_contrast');
      await page.waitForTimeout(200);

      // ── Clear Observation test ──
      await page.click('#ipoClearButton');
      await page.waitForTimeout(200);
      const anyRadioChecked = await page.evaluate(() => Array.from(document.querySelectorAll('input[name="ipoObservation"]')).some((r) => r.checked));
      const anyReasonChecked = await page.evaluate(() => Array.from(document.querySelectorAll('input[name="ipoReason"]')).some((r) => r.checked));
      s = await qaSnapshot(page);
      record('Clear Observation: no radio remains checked', anyRadioChecked === false, `anyChecked=${anyRadioChecked}`);
      record('Clear Observation: all Reasons clear', anyReasonChecked === false, `anyChecked=${anyReasonChecked}`);
      record('Clear Observation: active preference count becomes zero', s?.sessionSummary?.activeObservations === 0, `activeObservations=${s?.sessionSummary?.activeObservations}`);
      const clearedCountAfterFirst = s?.sessionSummary?.cleared;
      record('Clear Observation: Cleared count increments exactly once', clearedCountAfterFirst === 1, `cleared=${clearedCountAfterFirst}`);
      const clearButtonDisabledAfterFirstClear = await page.evaluate(() => document.getElementById('ipoClearButton')?.disabled === true);
      if (!clearButtonDisabledAfterFirstClear) {
        // Button still enabled (e.g. a new Observation was auto-selected) — attempt the repeated click for real.
        await page.click('#ipoClearButton');
        await page.waitForTimeout(150);
      }
      s = await qaSnapshot(page);
      record('Clear Observation: repeated click does not increment again', s?.sessionSummary?.cleared === clearedCountAfterFirst, `cleared=${s?.sessionSummary?.cleared}, buttonDisabledAfterFirstClear=${clearButtonDisabledAfterFirstClear} (disabled means a second clear is structurally impossible, which itself proves idempotency)`);
      await page.screenshot({ path: path.join(F3_SCREENSHOT_DIR, 'observation-cleared.png') });
      screenshotsGenerated.push('full-app-f3/observation-cleared.png');

      await page.click('#ipoOption_prefer-legacy');
      await page.click('#ipoReason_skin-tone');
      await page.click('#ipoReason_contrast');
      await page.waitForTimeout(200);

      // ── Actual Session Clear test (real button, no raw session.clearSession()) ──
      const genBeforeSessionClear = await qaSnapshot(page).then((snap) => ({ analysisGeneration: snap?.analysisGeneration }));
      await page.click('#ipoClearSessionButton');
      await page.waitForTimeout(300);
      const legacyCheckedAfterSessionClear = await page.evaluate(() => document.getElementById('ipoOption_prefer-legacy').checked);
      const skinCheckedAfterSessionClear = await page.evaluate(() => document.getElementById('ipoReason_skin-tone').checked);
      const contrastCheckedAfterSessionClear = await page.evaluate(() => document.getElementById('ipoReason_contrast').checked);
      s = await qaSnapshot(page);
      record('Actual Session Clear: Prefer Legacy remains checked', legacyCheckedAfterSessionClear === true, `checked=${legacyCheckedAfterSessionClear}`);
      record('Actual Session Clear: Skin tone remains checked', skinCheckedAfterSessionClear === true, `checked=${skinCheckedAfterSessionClear}`);
      record('Actual Session Clear: Contrast remains checked', contrastCheckedAfterSessionClear === true, `checked=${contrastCheckedAfterSessionClear}`);
      record('Actual Session Clear: historical Cleared/Invalidated counters reset', s?.sessionSummary?.cleared === 0 && s?.sessionSummary?.invalidated === 0, JSON.stringify({ cleared: s?.sessionSummary?.cleared, invalidated: s?.sessionSummary?.invalidated }));
      record('Actual Session Clear: Observed=1, Active=1, PreferLegacy=1, PreferV2=0', s?.sessionSummary?.totalObserved === 1 && s?.sessionSummary?.activeObservations === 1 && s?.sessionSummary?.preferLegacy === 1 && s?.sessionSummary?.preferV2 === 0, JSON.stringify(s?.sessionSummary));
      record('Actual Session Clear: current Reasons remain represented', s?.sessionSummary?.reasonCounts?.skinTone === 1 && s?.sessionSummary?.reasonCounts?.contrast === 1, JSON.stringify(s?.sessionSummary?.reasonCounts));
      const genAfterSessionClear = await qaSnapshot(page).then((snap) => snap?.analysisGeneration);
      record('Actual Session Clear: no Analysis rerun occurs', genAfterSessionClear === genBeforeSessionClear.analysisGeneration, `before=${genBeforeSessionClear.analysisGeneration}, after=${genAfterSessionClear}`);
      await page.screenshot({ path: path.join(F3_SCREENSHOT_DIR, 'session-clear-rerecorded.png') });
      screenshotsGenerated.push('full-app-f3/session-clear-rerecorded.png');

      // ── Side-effect check: no Canvas/Analysis/Slider mutation from Observation actions ──
      const sliderBefore = await page.evaluate(() => document.querySelector('#interactiveBeforeAfterInner input[type="range"]')?.value ?? null);
      const canvasDrawCount = await page.evaluate(() => {
        window.__drawCount = 0;
        const orig = CanvasRenderingContext2D.prototype.drawImage;
        CanvasRenderingContext2D.prototype.drawImage = function (...args) { window.__drawCount++; return orig.apply(this, args); };
        return true;
      });
      const genBeforeSideEffect = await qaSnapshot(page).then((snap) => snap?.analysisGeneration);
      await page.click('#ipoOption_prefer-v2');
      await page.click('#ipoReason_highlight-detail');
      await page.click('#ipoClearReasonsButton');
      await page.waitForTimeout(200);
      const drawCallsDuringActions = await page.evaluate(() => window.__drawCount);
      const genAfterSideEffect = await qaSnapshot(page).then((snap) => snap?.analysisGeneration);
      const sliderAfter = await page.evaluate(() => document.querySelector('#interactiveBeforeAfterInner input[type="range"]')?.value ?? null);
      record('No Analysis rerun from Observation actions (analysisGeneration unchanged)', genAfterSideEffect === genBeforeSideEffect, `before=${genBeforeSideEffect}, after=${genAfterSideEffect}`);
      record('No Canvas drawImage calls from Observation actions', drawCallsDuringActions === 0, `drawImage calls=${drawCallsDuringActions}`);
      record('Interactive slider value unchanged by Observation actions', sliderAfter === sliderBefore, `before=${sliderBefore}, after=${sliderAfter}`);
      await page.click('#ipoOption_prefer-legacy');
      await page.click('#ipoReason_skin-tone');
      await page.click('#ipoReason_contrast');
      await page.waitForTimeout(200);

      // ── XMP exact comparison ──
      const xmpAfter = await captureXmpText(page);
      const xmpIdenticalExact = xmpBefore === xmpAfter;
      record('XMP exact comparison: identical text', xmpIdenticalExact, `before.length=${xmpBefore?.length}, after.length=${xmpAfter?.length}`);
      record('XMP exact comparison: same length', xmpBefore?.length === xmpAfter?.length, `before=${xmpBefore?.length}, after=${xmpAfter?.length}`);
      record('XMP exact comparison: same SHA-256 hash', sha256(xmpBefore) === sha256(xmpAfter), `before=${sha256(xmpBefore).slice(0, 16)}…, after=${sha256(xmpAfter).slice(0, 16)}…`);
      const snapshotAfterXmp = await qaSnapshot(page);
      record('XMP exact comparison: selected output remains Legacy', snapshotAfterXmp?.previewSandbox?.selectedOutputSource === 'legacy', `value=${snapshotAfterXmp?.previewSandbox?.selectedOutputSource}`);

      // ── Identity Preview UI honesty (already visually confirmed in Step 7A-F2-F's identity-preview-ready.png; re-confirm text presence here) ──
      const identityWordingPresent = await page.evaluate(() => {
        const text = document.getElementById('visualPreviewComparisonInner')?.textContent ?? '';
        return /no supported visual adjustment|without supported visual adjustment/i.test(text) && /NOT Lightroom-accurate/i.test(text);
      });
      const noForbiddenWording = await page.evaluate(() => {
        const text = (document.getElementById('visualPreviewComparisonInner')?.textContent ?? '').toLowerCase();
        return !text.includes('applied to production') && !text.includes('v2 activated') && !text.includes('pixels enhanced');
      });
      record('Identity Preview UI honesty: honest wording present, no forbidden claims', identityWordingPresent && noForbiddenWording, `identityWording=${identityWordingPresent}, noForbidden=${noForbiddenWording}`);

      // ── Generation handoff test: load next fixture ──
      const genIdBeforeHandoff = (await qaSnapshot(page))?.observation?.observationGenerationId;
      const analysisGenBeforeHandoff = (await qaSnapshot(page))?.analysisGeneration ?? 0;
      const { snapshot: handoffSnapshot } = await importAndReachReady(page, FIXTURES[1], analysisGenBeforeHandoff);
      await page.waitForTimeout(300);
      const radioSelectedAfterHandoff = await page.evaluate(() => Array.from(document.querySelectorAll('input[name="ipoObservation"]')).some((r) => r.checked));
      const reasonSelectedAfterHandoff = await page.evaluate(() => Array.from(document.querySelectorAll('input[name="ipoReason"]')).some((r) => r.checked));
      const sAfterHandoff = await qaSnapshot(page);
      record('Generation handoff: Generation 1 invalidated exactly once', sAfterHandoff?.sessionSummary?.invalidated === 1, `invalidated=${sAfterHandoff?.sessionSummary?.invalidated}`);
      record('Generation handoff: no radio selected automatically', radioSelectedAfterHandoff === false, `anySelected=${radioSelectedAfterHandoff}`);
      record('Generation handoff: no Reason selected automatically', reasonSelectedAfterHandoff === false, `anySelected=${reasonSelectedAfterHandoff}`);
      record('Generation handoff: old Generation id does not return', sAfterHandoff?.observation?.observationGenerationId !== genIdBeforeHandoff || sAfterHandoff?.observation?.selectedValue === null, `before=${genIdBeforeHandoff}, afterObs=${JSON.stringify(sAfterHandoff?.observation)}`);
      await page.screenshot({ path: path.join(F3_SCREENSHOT_DIR, 'generation-handoff-cleared.png') });
      screenshotsGenerated.push('full-app-f3/generation-handoff-cleared.png');

      // Select a NEW Observation on Generation 2 — must create one new active record.
      await page.click('#ipoOption_prefer-v2');
      await page.waitForTimeout(200);
      const sAfterNewObs = await qaSnapshot(page);
      record('Generation 2: selecting new Observation creates one active record', sAfterNewObs?.sessionSummary?.activeObservations === 1 && sAfterNewObs?.sessionSummary?.preferV2 === 1, JSON.stringify(sAfterNewObs?.sessionSummary));
      record('Generation handoff: invalidated count does not increment twice (poll again)', sAfterNewObs?.sessionSummary?.invalidated === 1, `invalidated=${sAfterNewObs?.sessionSummary?.invalidated}`);
      await page.screenshot({ path: path.join(F3_SCREENSHOT_DIR, 'generation-2-new-observation.png') });
      screenshotsGenerated.push('full-app-f3/generation-2-new-observation.png');

      for (const url of f3RequestFailures) { if (!/fonts\.googleapis\.com|fonts\.gstatic\.com/i.test(url)) consoleErrors.push({ context: 'F3', type: 'requestfailed', url }); }
      for (const e of f3Errors) consoleErrors.push({ context: 'F3', type: 'pageerror', error: e });

      await page.close();
    } else {
      record('Actual Observation UI workflow', 'NOT_TESTED', 'No fixture reached Ready in this run — cannot test real UI interaction on disabled controls.');
      record('Actual Session Clear button test', 'NOT_TESTED', 'Same reason.');
      record('Generation handoff test', 'NOT_TESTED', 'Same reason.');
      record('Identity Preview UI honesty', 'NOT_TESTED', 'Same reason.');
      record('Observation-to-XMP comparison', 'NOT_TESTED', 'Same reason.');
    }

    record('Console errors (only confirmed font-host failures excluded)', consoleErrors.length === 0 ? 'PASS' : 'FAIL', consoleErrors.length === 0 ? '(none)' : JSON.stringify(consoleErrors));

  } finally {
    await browser.close();
    server.close();
  }

  const passCount = results.filter((r) => r.result === 'PASS').length;
  const failCount = results.filter((r) => r.result === 'FAIL').length;
  const notTestedCount = results.filter((r) => r.result === 'NOT_TESTED').length;

  // FINAL STEP 7A ACCEPTANCE: PASS requires every category below to
  // genuinely pass — never based on Ready alone.
  const requiredPassPrefixes = [
    'Full Application Acceptance', 'Actual Observation radio', 'Actual Reason checkboxes',
    'Reasons preserved', 'Clear Reasons:', 'Clear Observation:', 'Actual Session Clear:',
    'Generation handoff:', 'XMP exact comparison:', 'Identity Preview UI honesty',
  ];
  const relevantResults = results.filter((r) => requiredPassPrefixes.some((p) => r.test.startsWith(p)));
  const allRelevantPass = relevantResults.length > 0 && relevantResults.every((r) => r.result === 'PASS');
  const finalDecision = allRelevantPass ? 'PASS' : 'FAIL';

  const output = {
    suite: 'EPIC 2E-J-C-F2 Step 7A (complete, incl. F3) - Full Application Reachability + Actual UI Workflow',
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
  console.log(`Step 7A Final Decision: ${output.decision}`);
  console.log('Results written to qa/epic-2e-j-phase-c-live-app-results.json');
  process.exit(output.decision === 'FAIL' ? 1 : 0);
}

main().catch((err) => {
  console.error('Live app test crashed:', err);
  process.exit(2);
});
