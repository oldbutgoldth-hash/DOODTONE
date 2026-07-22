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

import crypto from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// COMBINED CLOSEOUT R1 — Phase E: migrated off node:http/localhost/direct
// chromium.launch() onto the shared Navigation-Free In-Memory Harness —
// the SAME helper the Step 7B-B suite uses. No local server, no
// localhost/127.0.0.1/private-IP navigation; the only navigation target
// is about:blank?qa=1.
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const FIXTURES_DIR = path.join(PROJECT_ROOT, 'qa', 'fixtures', 'epic-2e-j');
const F3_SCREENSHOT_DIR = path.join(PROJECT_ROOT, 'qa-screenshots', 'epic-2e-j', 'full-app-f3');
const FIXTURES = ['neutral-balanced.png', 'warm-portrait-synthetic.png', 'cool-shadow-synthetic.png', 'highlight-shadow-range.png'];
const RESULTS_PATH = path.join(PROJECT_ROOT, 'qa', 'epic-2e-j-phase-c-live-app-results.json');
const EVIDENCE_RESULTS_PATH = path.join(PROJECT_ROOT, 'qa', 'epic-2e-j-phase-c-live-evidence-results.json');
const SOURCE_HASH_INPUTS = [
  path.join(__dirname, 'epic-2e-j-phase-c-live-app-test.mjs'),
  path.join(__dirname, 'helpers', 'playwright-lumixa-test-runtime.mjs'),
  path.join(__dirname, 'helpers', 'playwright-in-memory-app.mjs'),
  path.join(__dirname, 'helpers', 'playwright-opaque-origin-storage.mjs'),
];

// COMBINED CLOSEOUT R2 — Phase E: hoisted to module scope (not declared
// inside main()) so the outer main().catch() crash handler below can
// still access this run's identity even if main() throws partway
// through — a function-local const/let inside main() would not be
// visible to the outer catch callback's scope at all.
let runId = null;
let startedAt = null;
let sourceHash = null;

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

// COMBINED CLOSEOUT R3 — Phase C FIX C2: qaSnapshot/passAllReviewItems/
// waitForAnalysisCompletion are now imported from the shared runtime
// helper (qa/helpers/playwright-lumixa-test-runtime.mjs) rather than
// defined locally — Observation Smoke uses the exact same functions.
// This local wrapper only resolves the fixture filename against this
// suite's own FIXTURES_DIR and delegates everything else unchanged, so
// existing call sites (which pass a bare fixture filename) and this
// suite's 51/51 passing behavior are both preserved exactly.
async function importAndReachReady(page, fixture, priorGeneration) {
  const result = await (async () => {
    await page.setInputFiles('#fileIn', path.join(FIXTURES_DIR, fixture));
    await waitForAnalysisCompletion(page, priorGeneration);
    const genBeforeReview = await qaSnapshot(page).then((s) => s?.analysisGeneration ?? priorGeneration);
    await passAllReviewItems(page);
    await page.click('#btnReanalyze');
    return waitForAnalysisCompletion(page, genBeforeReview);
  })();
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
  runId = generateRunId();
  startedAt = new Date().toISOString();
  sourceHash = await computeSourceHash(SOURCE_HASH_INPUTS);
  await mkdir(F3_SCREENSHOT_DIR, { recursive: true });
  // COMBINED CLOSEOUT R2 — Phase E: shared Browser detection (never a
  // downloaded binary), launched with the required sandbox args. When
  // unavailable, this suite now WRITES a current environment-status
  // result (never leaves a stale prior PASS file standing as if it
  // were current — FIX E4).
  const pkg = await detectPlaywrightPackage();
  if (pkg.status !== 'PLAYWRIGHT_PACKAGE_AVAILABLE') {
    console.log(`Playwright Node package unavailable: ${pkg.error}`);
    console.log('Final decision: PLAYWRIGHT_PACKAGE_UNAVAILABLE');
    await writeBrowserUnavailableResult(RESULTS_PATH, {
      suite: 'EPIC 2E-J-C-F2 Step 7A (complete, incl. F3) - Full Application Reachability + Actual UI Workflow',
      status: 'PLAYWRIGHT_PACKAGE_UNAVAILABLE',
      reason: pkg.error,
    });
    console.log('qa/epic-2e-j-phase-c-live-app-results.json updated with a current PLAYWRIGHT_PACKAGE_UNAVAILABLE environment result (never PASS, no stale prior result left behind).');
    process.exit(0);
  }
  const { chromium } = pkg.mod;
  const browserDetect = await detectBrowserExecutable(chromium);
  if (!browserDetect.found) {
    console.log(`No usable Browser executable found among ${browserDetect.attempts.length} candidates (never downloaded one): ${JSON.stringify(browserDetect.attempts)}`);
    console.log('Final decision: BROWSER_BINARY_UNAVAILABLE');
    await writeBrowserUnavailableResult(RESULTS_PATH, {
      suite: 'EPIC 2E-J-C-F2 Step 7A (complete, incl. F3) - Full Application Reachability + Actual UI Workflow',
      status: 'BROWSER_BINARY_UNAVAILABLE',
      reason: JSON.stringify(browserDetect.attempts),
    });
    console.log('qa/epic-2e-j-phase-c-live-app-results.json updated with a current BROWSER_BINARY_UNAVAILABLE environment result (never PASS, no stale prior result left behind).');
    process.exit(0);
  }
  const browser = await chromium.launch({ executablePath: browserDetect.found, args: REQUIRED_LAUNCH_ARGS });
  const appSnapshot = await buildLumixaAppSnapshot(PROJECT_ROOT);
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
      const fixtureRuntime = await openLumixaInMemoryPage({ browser, projectRoot: PROJECT_ROOT, qaQuery: '?qa=1', viewport: { width: 1440, height: 1400 }, prebuiltApp: appSnapshot });
      const page = fixtureRuntime.page;
      const pageErrors = [];
      page.on('pageerror', (e) => pageErrors.push(String(e)));
      const requestFailures = [];
      page.on('requestfailed', (req) => requestFailures.push({ url: req.url(), failure: req.failure()?.errorText ?? 'unknown' }));
      page.on('response', (res) => { if (res.status() >= 400) requestFailures.push({ url: res.url(), status: res.status() }); });

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

      // FIX 2 (Step 7A-F3-F): the per-fixture result is COMPUTED from
      // the actual captured evidence — never hard-coded 'PASS'. Every
      // one of the 7 required conditions must genuinely hold.
      const fixtureFailedFields = [];
      if (fixtureRecord.analysisCompleted !== true) fixtureFailedFields.push(`analysisCompleted=${fixtureRecord.analysisCompleted}`);
      if (fixtureRecord.legacyPreviewState !== 'rendered') fixtureFailedFields.push(`legacyPreviewState=${fixtureRecord.legacyPreviewState}`);
      if (fixtureRecord.controlledV2PreviewState !== 'rendered') fixtureFailedFields.push(`controlledV2PreviewState=${fixtureRecord.controlledV2PreviewState}`);
      if (fixtureRecord.canGeneratePreview !== true) fixtureFailedFields.push(`canGeneratePreview=${fixtureRecord.canGeneratePreview}`);
      if (fixtureRecord.interactiveState !== 'ready') fixtureFailedFields.push(`interactiveState=${fixtureRecord.interactiveState}`);
      if (fixtureRecord.observationEnabled !== true) fixtureFailedFields.push(`observationEnabled=${fixtureRecord.observationEnabled}`);
      if (fixtureRecord.blockers.length !== 0) fixtureFailedFields.push(`blockers=${JSON.stringify(fixtureRecord.blockers)}`);
      const fixturePasses = fixtureFailedFields.length === 0;
      fixtureRecord.result = fixturePasses ? 'PASS' : 'FAIL';
      record(`[${fixture}] Per-fixture pipeline record`, fixturePasses, fixturePasses ? JSON.stringify(fixtureRecord) : `FAILED FIELDS: ${fixtureFailedFields.join(', ')} — full record: ${JSON.stringify(fixtureRecord)}`);
      if (observationEnabled && !firstReadyFixture) firstReadyFixture = fixture;

      for (const rf of requestFailures) { if (!/fonts\.googleapis\.com|fonts\.gstatic\.com/i.test(rf.url)) consoleErrors.push({ fixture, type: 'requestfailed', ...rf }); }
      for (const e of pageErrors) consoleErrors.push({ fixture, type: 'pageerror', error: e });
      await fixtureRuntime.cleanup();
    }

    record('Full Application Acceptance: at least one fixture reaches Ready', firstReadyFixture ? 'PASS' : 'FAIL', firstReadyFixture ? `first ready fixture=${firstReadyFixture}` : 'NO fixture reached Ready in this run.');

    // ══════════════════════════════════════════════════════════════
    // PART 2 — Step 7A-F3: actual Observation UI, Session Clear,
    // Generation handoff, XMP exact comparison, side-effect checks.
    // Only runs when at least one fixture reaches Ready.
    // ══════════════════════════════════════════════════════════════
    if (firstReadyFixture) {
      const f3Runtime = await openLumixaInMemoryPage({ browser, projectRoot: PROJECT_ROOT, qaQuery: '?qa=1', viewport: { width: 1440, height: 1400 }, prebuiltApp: appSnapshot });
      const page = f3Runtime.page;
      const f3Errors = [];
      page.on('pageerror', (e) => f3Errors.push(String(e)));
      const f3RequestFailures = [];
      page.on('requestfailed', (req) => f3RequestFailures.push(req.url()));

      await page.waitForTimeout(600);
      const gen0 = await qaSnapshot(page).then((s) => s?.analysisGeneration ?? 0);
      await importAndReachReady(page, FIXTURES[0], gen0);
      await page.evaluate(() => { const el = document.getElementById('interactivePreviewObservationSection'); if (el) el.scrollIntoView(); });
      await page.waitForTimeout(300);

      // ── XMP capture BEFORE any Observation interaction ──
      const xmpBefore = await captureXmpText(page);
      const snapshotBeforeObs = await qaSnapshot(page);

      // COMBINED CLOSEOUT R2 — Phase B FIX B2: validate the QA snapshot
      // contract ONCE, before any Observation scenario runs, so a
      // missing/incompatible hook produces exactly ONE clear
      // QA_CONTRACT_MISSING failure instead of a dozen downstream
      // `undefined` cascade failures. The dependent scenario is stopped
      // safely (skipped) rather than continuing on broken evidence.
      const qaContractOk = !!snapshotBeforeObs
        && snapshotBeforeObs.qaContractVersion === '2E-J-C-R2'
        && snapshotBeforeObs.sessionSummary && typeof snapshotBeforeObs.sessionSummary === 'object'
        && typeof snapshotBeforeObs.sessionSummary.activeObservations === 'number'
        && Array.isArray(snapshotBeforeObs.sessionSummary.topReasons)
        && snapshotBeforeObs.sessionSummary.reasonCounts && typeof snapshotBeforeObs.sessionSummary.reasonCounts === 'object'
        && snapshotBeforeObs.observation && typeof snapshotBeforeObs.observation === 'object'
        && ('selectedValue' in snapshotBeforeObs.observation)
        && ('reasons' in snapshotBeforeObs.observation)
        && ('observationGenerationId' in snapshotBeforeObs.observation);
      if (!qaContractOk) {
        record('QA_CONTRACT_MISSING: the ?qa=1 snapshot hook does not expose the required 2E-J-C-R2 fields (qaContractVersion/sessionSummary/observation.selectedValue|reasons|observationGenerationId) — Observation scenarios stopped safely, no cascade of undefined-derived failures', false, JSON.stringify(snapshotBeforeObs));
      }
      if (qaContractOk) {
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
      const canvasDimsBefore = await page.evaluate(() => {
        const canvases = Array.from(document.querySelectorAll('#interactiveBeforeAfterInner canvas, #visualPreviewComparisonInner canvas'));
        return canvases.map((c) => ({ width: c.width, height: c.height }));
      });
      // FIX 3: instrument all three canvas-mutation methods, not just drawImage.
      await page.evaluate(() => {
        window.__canvasCallCounts = { drawImage: 0, getImageData: 0, putImageData: 0 };
        window.__origCanvasMethods = {
          drawImage: CanvasRenderingContext2D.prototype.drawImage,
          getImageData: CanvasRenderingContext2D.prototype.getImageData,
          putImageData: CanvasRenderingContext2D.prototype.putImageData,
        };
        CanvasRenderingContext2D.prototype.drawImage = function (...args) { window.__canvasCallCounts.drawImage++; return window.__origCanvasMethods.drawImage.apply(this, args); };
        CanvasRenderingContext2D.prototype.getImageData = function (...args) { window.__canvasCallCounts.getImageData++; return window.__origCanvasMethods.getImageData.apply(this, args); };
        CanvasRenderingContext2D.prototype.putImageData = function (...args) { window.__canvasCallCounts.putImageData++; return window.__origCanvasMethods.putImageData.apply(this, args); };
      });
      const genBeforeSideEffect = await qaSnapshot(page).then((snap) => snap?.analysisGeneration);
      await page.click('#ipoOption_prefer-v2');
      await page.click('#ipoReason_highlight-detail');
      await page.click('#ipoClearReasonsButton');
      await page.waitForTimeout(200);
      const canvasCallCounts = await page.evaluate(() => window.__canvasCallCounts);
      const canvasDimsAfter = await page.evaluate(() => {
        const canvases = Array.from(document.querySelectorAll('#interactiveBeforeAfterInner canvas, #visualPreviewComparisonInner canvas'));
        return canvases.map((c) => ({ width: c.width, height: c.height }));
      });
      // Restore the original Canvas methods after the action window — never alters Runtime behavior beyond this instrumentation.
      await page.evaluate(() => {
        CanvasRenderingContext2D.prototype.drawImage = window.__origCanvasMethods.drawImage;
        CanvasRenderingContext2D.prototype.getImageData = window.__origCanvasMethods.getImageData;
        CanvasRenderingContext2D.prototype.putImageData = window.__origCanvasMethods.putImageData;
      });
      const genAfterSideEffect = await qaSnapshot(page).then((snap) => snap?.analysisGeneration);
      const sliderAfter = await page.evaluate(() => document.querySelector('#interactiveBeforeAfterInner input[type="range"]')?.value ?? null);
      record('No Analysis rerun from Observation actions (analysisGeneration unchanged)', genAfterSideEffect === genBeforeSideEffect, `before=${genBeforeSideEffect}, after=${genAfterSideEffect}`);
      record('No Canvas drawImage calls from Observation actions', canvasCallCounts.drawImage === 0, `drawImage calls=${canvasCallCounts.drawImage}`);
      record('No Canvas getImageData calls from Observation actions', canvasCallCounts.getImageData === 0, `getImageData calls=${canvasCallCounts.getImageData}`);
      record('No Canvas putImageData calls from Observation actions', canvasCallCounts.putImageData === 0, `putImageData calls=${canvasCallCounts.putImageData}`);
      record('Preview Canvas width/height unchanged by Observation actions', JSON.stringify(canvasDimsBefore) === JSON.stringify(canvasDimsAfter), `before=${JSON.stringify(canvasDimsBefore)}, after=${JSON.stringify(canvasDimsAfter)}`);
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
      const handoffSelectedValueNull = sAfterHandoff?.observation?.selectedValue === null;
      const handoffReasonsEmpty = Array.isArray(sAfterHandoff?.observation?.reasons) && sAfterHandoff.observation.reasons.length === 0;
      const handoffGenIdClearedOrDifferent = sAfterHandoff?.observation?.observationGenerationId === null || sAfterHandoff?.observation?.observationGenerationId !== genIdBeforeHandoff;
      const handoffInvalidatedExactlyOne = sAfterHandoff?.sessionSummary?.invalidated === 1;
      record('Generation handoff: old Generation id does not return (all conditions, not just one)', handoffSelectedValueNull && handoffReasonsEmpty && handoffGenIdClearedOrDifferent && handoffInvalidatedExactlyOne, `selectedValueNull=${handoffSelectedValueNull}, reasonsEmpty=${handoffReasonsEmpty}, genIdClearedOrDifferent=${handoffGenIdClearedOrDifferent}, invalidatedExactlyOne=${handoffInvalidatedExactlyOne}, before=${genIdBeforeHandoff}, afterObs=${JSON.stringify(sAfterHandoff?.observation)}`);
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
      } // end if (qaContractOk)

      await f3Runtime.cleanup();
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
  }

  const passCount = results.filter((r) => r.result === 'PASS').length;
  const failCount = results.filter((r) => r.result === 'FAIL').length;
  const notTestedCount = results.filter((r) => r.result === 'NOT_TESTED').length;

  // FIX 1 (Step 7A-F3-F): FAIL-CLOSED final decision. PASS requires
  // ALL of:
  //   - failCount === 0 (any executed FAIL — console error, Analysis
  //     rerun, Canvas side effect, slider mutation, XMP difference,
  //     per-fixture failure, or anything else — forces FAIL)
  //   - notTestedCount === 0 (no deferred/incomplete category)
  //   - at least one fixture genuinely reached Ready
  //   - every required functional category's specific checks passed
  // This does NOT rely on test-name-prefix filtering alone — failCount
  // and notTestedCount are computed across the ENTIRE result set, so a
  // FAIL or NOT_TESTED anywhere (even outside the named categories)
  // still forces the overall decision to FAIL.
  const requiredPassPrefixes = [
    'Full Application Acceptance', 'Actual Observation radio', 'Actual Reason checkboxes',
    'Reasons preserved', 'Clear Reasons:', 'Clear Observation:', 'Actual Session Clear:',
    'Generation handoff:', 'XMP exact comparison:', 'Identity Preview UI honesty',
  ];
  const relevantResults = results.filter((r) => requiredPassPrefixes.some((p) => r.test.startsWith(p)));
  const namedCategoriesPass = relevantResults.length > 0 && relevantResults.every((r) => r.result === 'PASS');
  const finalDecision = (failCount === 0 && notTestedCount === 0 && !!firstReadyFixture && namedCategoriesPass) ? 'PASS' : 'FAIL';

  const output = {
    suite: 'EPIC 2E-J-C-F2 Step 7A (complete, incl. F3) - Full Application Reachability + Actual UI Workflow',
    runId,
    startedAt,
    completedAt: new Date().toISOString(),
    completed: true,
    sourceHash,
    browserExecutablePath: browserDetect.found,
    browserVersion: browser.version(),
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
  await writeResultAtomic(RESULTS_PATH, output);
  await writeResultAtomic(EVIDENCE_RESULTS_PATH, { runId, generatedAt: new Date().toISOString(), liveEvidenceRecords });
  console.log(`\n${passCount}/${results.length} PASS, ${failCount} FAIL, ${notTestedCount} NOT_TESTED`);
  console.log(`Live App Final Decision: ${output.decision}`);
  console.log('Results written to qa/epic-2e-j-phase-c-live-app-results.json');
  process.exit(output.decision === 'FAIL' ? 1 : 0);
}

main().catch(async (err) => {
  console.error('Live app test crashed:', err && err.name ? err.name : err);
  try {
    const nowIso = new Date().toISOString();
    await writeResultAtomic(RESULTS_PATH, {
      suite: 'EPIC 2E-J-C-F2 Step 7A (complete, incl. F3) - Full Application Reachability + Actual UI Workflow',
      runId,
      startedAt,
      completedAt: nowIso,
      completed: false,
      sourceHash,
      browserExecutablePath: null,
      browserVersion: null,
      generatedAt: nowIso,
      summary: { total: 1, pass: 0, fail: 1, notTested: 0 },
      results: [buildRuntimeCrashRow(err)],
      decision: 'FAIL',
    });
  } catch (writeErr) {
    console.error('Failed to write crash result JSON:', writeErr && writeErr.name ? writeErr.name : writeErr);
  }
  process.exit(2);
});
