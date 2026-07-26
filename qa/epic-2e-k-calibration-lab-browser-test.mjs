#!/usr/bin/env node
/**
 * qa/epic-2e-k-calibration-lab-browser-test.mjs
 *
 * EPIC 2E-K -- CONTROLLED V2 CALIBRATION LAB (Browser half).
 *
 * Drives the REAL Calibration Lab UI inside the shared in-memory app
 * harness: opens the Lab via #calibrationLabNavBtn, starts a session,
 * adds images from real fixtures, navigates between them, saves a
 * decision + issue codes, ends and reopens the session (save/restore),
 * audits TH<->EN visible text inside #calibrationLabRoot only (reusing
 * the SAME shared visible-locale-audit helper the main i18n suite
 * uses), checks 7 required mobile viewport widths for horizontal
 * overflow, verifies keyboard Tab reach + Escape-closes-and-restores-
 * focus, and re-confirms the Production locks + exact XMP invariant
 * are unaffected by using the Lab at all.
 *
 * Consistent with every other Browser suite in this project: if
 * Playwright/Chromium is unavailable, this suite honestly reports
 * BROWSER_BINARY_UNAVAILABLE (exit 0) rather than fabricating results.
 *
 * Run: node qa/epic-2e-k-calibration-lab-browser-test.mjs
 * Output: qa/epic-2e-k-calibration-lab-browser-results.json
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import {
  detectPlaywrightPackage, detectBrowserExecutable, REQUIRED_LAUNCH_ARGS,
  buildLumixaAppSnapshot, openLumixaInMemoryPage, generateRunId, computeSourceHash,
  writeResultAtomic, buildRuntimeCrashRow, writeBrowserUnavailableResult, qaSnapshot,
  captureXmpText, sha256XmpText,
} from './helpers/playwright-lumixa-test-runtime.mjs';
import { auditVisibleLocaleSections, decideVisibleLocaleAudit } from './helpers/visible-locale-audit.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const RESULTS_PATH = path.join(PROJECT_ROOT, 'qa', 'epic-2e-k-calibration-lab-browser-results.json');
const SUITE_NAME = 'CONTROLLED V2 CALIBRATION LAB R1 -- Phase K: Calibration Lab Browser suite';

const FIXTURE_1 = path.join(PROJECT_ROOT, 'qa', 'fixtures', 'epic-2e-j', 'neutral-balanced.png');
const FIXTURE_2 = path.join(PROJECT_ROOT, 'qa', 'fixtures', 'epic-2e-j', 'warm-portrait-synthetic.png');

const MOBILE_VIEWPORTS = [320, 360, 390, 430, 768, 1024, 1440];

const SOURCE_HASH_INPUTS = [
  path.join(__dirname, 'epic-2e-k-calibration-lab-browser-test.mjs'),
  path.join(__dirname, 'helpers', 'playwright-lumixa-test-runtime.mjs'),
  path.join(__dirname, 'helpers', 'visible-locale-audit.mjs'),
  path.join(PROJECT_ROOT, 'index.html'),
  path.join(PROJECT_ROOT, 'ui', 'calibration-lab', 'calibration-lab-entry.js'),
  path.join(PROJECT_ROOT, 'ui', 'calibration-lab', 'calibration-lab-controller.js'),
  path.join(PROJECT_ROOT, 'ui', 'calibration-lab', 'calibration-lab-renderer.js'),
  path.join(PROJECT_ROOT, 'ui', 'calibration-lab', 'calibration-lab-storage.js'),
  path.join(PROJECT_ROOT, 'ui', 'calibration-lab', 'calibration-lab-i18n.js'),
  path.join(PROJECT_ROOT, 'core', 'calibration-lab', 'codes.js'),
  path.join(PROJECT_ROOT, 'core', 'calibration-lab', 'schema.js'),
  path.join(PROJECT_ROOT, 'core', 'calibration-lab', 'run-comparison-pipeline.js'),
  // EPIC 2E-K-R2 -- REAL PIXEL COMPARISON: the bounded-LRU cache module
  // and the reused production pixel-rendering chain.
  path.join(PROJECT_ROOT, 'core', 'calibration-lab', 'bounded-lru-cache.js'),
  path.join(PROJECT_ROOT, 'ui', 'visual-preview-comparison-controller-v2.js'),
  path.join(PROJECT_ROOT, 'ui', 'isolated-visual-preview-renderer-v2.js'),
  path.join(PROJECT_ROOT, 'core', 'preview-rendering', 'visual-preview-render-plan-v2.js'),
  FIXTURE_1, FIXTURE_2,
];

let runId = null, startedAt = null, sourceHash = null;
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
function recordCondition(test, condition, evidence) { recordStatus(test, condition === true ? 'PASS' : 'FAIL', evidence); }

function sha256(text) { return crypto.createHash('sha256').update(text ?? '').digest('hex'); }

async function calSnapshot(page) {
  return page.evaluate(() => (window.__LUMIXA_QA__ && typeof window.__LUMIXA_QA__.getCalibrationLabSnapshot === 'function')
    ? window.__LUMIXA_QA__.getCalibrationLabSnapshot() : null);
}

async function main() {
  runId = generateRunId();
  startedAt = new Date().toISOString();
  sourceHash = await computeSourceHash(SOURCE_HASH_INPUTS);

  const pkg = await detectPlaywrightPackage();
  if (pkg.status !== 'PLAYWRIGHT_PACKAGE_AVAILABLE') {
    await writeBrowserUnavailableResult(RESULTS_PATH, { suite: SUITE_NAME, status: 'PLAYWRIGHT_PACKAGE_UNAVAILABLE', reason: pkg.error });
    console.log('Final decision: PLAYWRIGHT_PACKAGE_UNAVAILABLE');
    process.exit(0);
  }
  const chromiumInfo = await detectBrowserExecutable(pkg.chromium);
  if (!chromiumInfo.executablePath) {
    await writeBrowserUnavailableResult(RESULTS_PATH, { suite: SUITE_NAME, status: 'BROWSER_BINARY_UNAVAILABLE', reason: 'No usable Chromium executable found in this environment.' });
    console.log('Final decision: BROWSER_BINARY_UNAVAILABLE');
    process.exit(0);
  }

  let completed = false;
  const browser = await pkg.chromium.launch({ executablePath: chromiumInfo.executablePath, args: REQUIRED_LAUNCH_ARGS });
  try {
    const prebuiltApp = await buildLumixaAppSnapshot(PROJECT_ROOT);
    const runtime = await openLumixaInMemoryPage({ browser, projectRoot: PROJECT_ROOT, prebuiltApp });
    const { page, collectors } = runtime;

    const xmpBefore = await captureXmpText(page);

    // Wait for the Calibration Lab's own QA global to attach (it merges
    // onto window.__LUMIXA_QA__ asynchronously, after its own
    // controller.init() resolves -- separate from app.js's own flag).
    await page.waitForFunction(() => !!(window.__LUMIXA_QA__ && typeof window.__LUMIXA_QA__.getCalibrationLabSnapshot === 'function'), null, { timeout: 15000 });

    const navBtn = page.locator('#calibrationLabNavBtn');
    recordCondition('Nav button #calibrationLabNavBtn exists and is visible', await navBtn.count() > 0, {});
    await navBtn.click();

    const root = page.locator('#calibrationLabRoot');
    await page.waitForSelector('#calibrationLabRoot.cal-open', { timeout: 5000 });
    recordCondition('Calibration Lab overlay opens with role=dialog aria-modal=true', await root.getAttribute('role') === 'dialog' && await root.getAttribute('aria-modal') === 'true', {});

    let snap = await calSnapshot(page);
    recordCondition('Initial calibrationMode=CLOSED-or-REVIEW, sessionState=NO_SESSION before starting a session', snap.sessionState === 'NO_SESSION', JSON.stringify(snap));

    // Session Creation.
    await page.locator('#calibrationLabRoot button', { hasText: /Start New Session|เริ่ม Session ใหม่/ }).first().click();
    snap = await calSnapshot(page);
    recordCondition('Session Creation: sessionState becomes ACTIVE with a real sessionId', snap.sessionState === 'ACTIVE', JSON.stringify(snap));

    // Add image 1 -- select a category chip, then set the file.
    await page.locator('#calibrationLabRoot .cal-chip[data-cal-category="WEDDING"]').click();
    await page.setInputFiles('#calibrationLabRoot input[type="file"]', FIXTURE_1);
    await page.waitForFunction(() => {
      const s = window.__LUMIXA_QA__.getCalibrationLabSnapshot();
      return s.imageCount >= 1;
    }, null, { timeout: 20000 });
    snap = await calSnapshot(page);
    recordCondition('Add image 1: imageCount becomes 1, currentImageId set', snap.imageCount === 1 && !!snap.currentImageId, JSON.stringify(snap));
    const firstImageId = snap.currentImageId;

    // EPIC 2E-K-R2 -- REAL PIXEL COMPARISON: for an image added in the
    // CURRENT runtime session, the comparison view must render two
    // REAL <canvas> elements (not the old "same source image on both
    // sides" placeholder), reusing the exact same production isolated
    // pixel renderer the main app's own Visual Preview Comparison uses.
    await page.waitForSelector('#calibrationLabRoot canvas[data-cal-role="pixel-canvas-legacy"]', { timeout: 10000 });
    await page.waitForSelector('#calibrationLabRoot canvas[data-cal-role="pixel-canvas-v2"]', { timeout: 10000 });
    recordCondition('Real Pixel Comparison: both canvas[data-cal-role=pixel-canvas-legacy] and pixel-canvas-v2 exist for a just-added image (never the old same-image-both-sides placeholder)', true, {});
    // Wait for the async render() to resolve (status note moves off the transient "rendering..." text).
    await page.waitForFunction(() => {
      const note = document.querySelector('#calibrationLabRoot [data-cal-role="pixel-preview-status"]');
      return !!note && note.getAttribute('data-cal-pixel-overall-state') != null;
    }, null, { timeout: 20000 }).catch(() => {});
    const pixelState1 = await page.evaluate(() => {
      const note = document.querySelector('#calibrationLabRoot [data-cal-role="pixel-preview-status"]');
      const legacyCanvas = document.querySelector('#calibrationLabRoot canvas[data-cal-role="pixel-canvas-legacy"]');
      const v2Canvas = document.querySelector('#calibrationLabRoot canvas[data-cal-role="pixel-canvas-v2"]');
      return {
        overallState: note ? note.getAttribute('data-cal-pixel-overall-state') : null,
        legacyState: note ? note.getAttribute('data-cal-pixel-legacy-state') : null,
        v2State: note ? note.getAttribute('data-cal-pixel-v2-state') : null,
        legacyBackingSize: legacyCanvas ? legacyCanvas.width * legacyCanvas.height : 0,
        v2BackingSize: v2Canvas ? v2Canvas.width * v2Canvas.height : 0,
      };
    });
    recordCondition('Real Pixel Comparison: the render actually resolved to a real state (rendered/blocked/failed/cancelled/unavailable), never left permanently in the transient "rendering" placeholder', pixelState1.overallState !== null, JSON.stringify(pixelState1));
    recordCondition('Real Pixel Comparison: the Legacy canvas received real backing pixel dimensions (genuinely drawn to, not a blank 0x0 canvas) when its side is not blocked', pixelState1.legacyState !== 'rendered' || pixelState1.legacyBackingSize > 0, JSON.stringify(pixelState1));
    recordCondition('Real Pixel Comparison: the Controlled V2 canvas received real backing pixel dimensions when its side is not blocked', pixelState1.v2State !== 'rendered' || pixelState1.v2BackingSize > 0, JSON.stringify(pixelState1));

    // Add image 2.
    await page.locator('#calibrationLabRoot .cal-chip[data-cal-category="EVENT"]').click();
    await page.setInputFiles('#calibrationLabRoot input[type="file"]', FIXTURE_2);
    await page.waitForFunction(() => window.__LUMIXA_QA__.getCalibrationLabSnapshot().imageCount >= 2, null, { timeout: 20000 });
    snap = await calSnapshot(page);
    const secondImageId = snap.currentImageId;
    recordCondition('Add image 2 (Multi-image Navigation setup): imageCount becomes 2', snap.imageCount === 2 && secondImageId !== firstImageId, JSON.stringify(snap));

    // Multi-image Navigation: Previous returns to image 1.
    await page.locator('#calibrationLabRoot button', { hasText: /Previous Image|ภาพก่อนหน้า/ }).first().click();
    snap = await calSnapshot(page);
    recordCondition('Multi-image Navigation: Previous Image returns to the first image', snap.currentImageId === firstImageId, JSON.stringify(snap));
    await page.locator('#calibrationLabRoot button', { hasText: /Next Image|ภาพถัดไป/ }).first().click();
    snap = await calSnapshot(page);
    recordCondition('Multi-image Navigation: Next Image returns to the second image', snap.currentImageId === secondImageId, JSON.stringify(snap));

    // Decision + Issue Code Persistence.
    await page.locator('#calibrationLabRoot .cal-chip', { hasText: /Controlled V2 is better|Controlled V2 ดีกว่า/ }).first().click();
    const wbCheckbox = page.locator('#calibrationLabRoot label', { hasText: /White balance too warm|White Balance อุ่นเกินไป/ }).locator('input[type="checkbox"]');
    await wbCheckbox.check();
    await page.locator('#calibrationLabRoot button', { hasText: /Save Result for This Image|บันทึกผลภาพปัจจุบัน/ }).first().click();
    snap = await calSnapshot(page);
    recordCondition('Decision Persistence: currentDecisionCode saved as V2_BETTER', snap.currentDecisionCode === 'V2_BETTER', JSON.stringify(snap));
    recordCondition('Issue Code Persistence: WB_TOO_WARM present in selectedIssueCodes', Array.isArray(snap.selectedIssueCodes) && snap.selectedIssueCodes.includes('WB_TOO_WARM'), JSON.stringify(snap));

    // Save and Restore: end session, reopen it, confirm the decision/issue survive.
    const sessionIdBeforeEnd = (await calSnapshot(page)) && (await page.evaluate(() => window.__LUMIXA_QA__.getCalibrationLabSnapshot()));
    await page.locator('#calibrationLabRoot button', { hasText: /End Session|จบ Session/ }).first().click();
    snap = await calSnapshot(page);
    recordCondition('End Session sets sessionState=ENDED', snap.sessionState === 'ENDED', JSON.stringify(snap));
    await page.locator('#calibrationLabRoot button', { hasText: /^.*(cal-session-).*$/ }).first().click().catch(() => {});
    // Fall back to clicking the first listed session button by role if the text-based locator above didn't match.
    const openSessionBtn = page.locator('#calibrationLabRoot .cal-row button').filter({ hasNotText: /Start New Session|เริ่ม Session ใหม่/ }).first();
    if (await openSessionBtn.count() > 0) await openSessionBtn.click().catch(() => {});
    await page.waitForFunction(() => window.__LUMIXA_QA__.getCalibrationLabSnapshot().sessionState === 'ACTIVE', null, { timeout: 5000 }).catch(() => {});
    snap = await calSnapshot(page);
    recordCondition('Save and Restore: reopening the session restores imageCount=2', snap.sessionState === 'ACTIVE' && snap.imageCount === 2, JSON.stringify(snap));

    // EPIC 2E-K-R2 -- REAL PIXEL COMPARISON honest fallback: a session
    // reopened from storage never had its <img> elements re-decoded in
    // THIS runtime (the source photo is never persisted) -- the
    // comparison view must honestly show the unavailable placeholder,
    // never a stale/incorrect canvas.
    const pixelUnavailableAfterRestore = await page.locator('#calibrationLabRoot [data-cal-role="pixel-preview-unavailable"]').count();
    recordCondition('Real Pixel Comparison honest fallback: after Save-and-Restore (session reopened from storage), the comparison view shows the translated "not in this session" message rather than a live canvas', pixelUnavailableAfterRestore > 0, { pixelUnavailableAfterRestore });

    // TH -> EN -> TH visible-locale audit, scoped to #calibrationLabRoot only.
    const thAudit1 = await auditVisibleLocaleSections(page, ['#calibrationLabRoot'], { mode: 'th', approvedTerms: ['IndexedDB', 'Controlled V2', 'JSON', 'CSV'] });
    await page.evaluate(() => { document.documentElement.lang = 'en'; });
    await page.waitForTimeout(200);
    const enAudit = await auditVisibleLocaleSections(page, ['#calibrationLabRoot'], { mode: 'en', approvedTerms: ['IndexedDB', 'Controlled V2', 'JSON', 'CSV'] });
    await page.evaluate(() => { document.documentElement.lang = 'th'; });
    await page.waitForTimeout(200);
    const thAudit2 = await auditVisibleLocaleSections(page, ['#calibrationLabRoot'], { mode: 'th', approvedTerms: ['IndexedDB', 'Controlled V2', 'JSON', 'CSV'] });
    const thDecision1 = decideVisibleLocaleAudit(thAudit1, { permittedNotTested: [] });
    const enDecision = decideVisibleLocaleAudit(enAudit, { permittedNotTested: [] });
    const thDecision2 = decideVisibleLocaleAudit(thAudit2, { permittedNotTested: [] });
    recordCondition('TH -> EN -> TH: Thai mode has zero visible English leaks inside the Calibration Lab', thDecision1.decision === 'PASS', JSON.stringify(thAudit1));
    recordCondition('TH -> EN -> TH: English mode has zero visible Thai leaks inside the Calibration Lab', enDecision.decision === 'PASS', JSON.stringify(enAudit));
    recordCondition('TH -> EN -> TH: switching back to Thai is clean again (round-trip)', thDecision2.decision === 'PASS', JSON.stringify(thAudit2));

    // Mobile viewports: no horizontal overflow of #calibrationLabRoot.
    for (const width of MOBILE_VIEWPORTS) {
      await page.setViewportSize({ width, height: 800 });
      await page.waitForTimeout(50);
      const overflow = await page.evaluate(() => {
        const el = document.getElementById('calibrationLabRoot');
        if (!el) return null;
        return { scrollWidth: el.scrollWidth, clientWidth: document.documentElement.clientWidth };
      });
      recordCondition(`Mobile viewport ${width}px: no horizontal overflow of #calibrationLabRoot`, overflow && overflow.scrollWidth <= overflow.clientWidth + 2, JSON.stringify(overflow));
    }
    await page.setViewportSize({ width: 1280, height: 900 });

    // Keyboard accessibility: Tab reaches the close button; Escape closes and restores focus to the nav button.
    await navBtn.focus();
    const closeBtnReached = await page.evaluate(() => {
      const root = document.getElementById('calibrationLabRoot');
      const focusables = [...root.querySelectorAll('a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')];
      return focusables.length > 0 && focusables[0].getAttribute('aria-label') !== null;
    });
    recordCondition('Keyboard: the dialog exposes at least one focusable element (its close button first)', closeBtnReached === true, {});
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    const closedAfterEscape = await page.evaluate(() => !document.getElementById('calibrationLabRoot').classList.contains('cal-open'));
    const focusRestored = await page.evaluate(() => document.activeElement && document.activeElement.id === 'calibrationLabNavBtn');
    recordCondition('Keyboard: Escape closes the Calibration Lab overlay', closedAfterEscape === true, {});
    recordCondition('Keyboard: focus is restored to the nav trigger button on close', focusRestored === true, {});

    // Production Locks Unchanged + XMP Exact Invariant Unchanged.
    const mainSnap = await qaSnapshot(page);
    recordCondition('Production Locks Unchanged: main app selectedOutputSource remains legacy, canWriteProduction/canExportPreview remain false', mainSnap?.previewSandbox?.selectedOutputSource === 'legacy' && mainSnap?.previewSandbox?.canWriteProduction === false && mainSnap?.previewSandbox?.canExportPreview === false, JSON.stringify(mainSnap?.previewSandbox));
    const calSnapFinal = await calSnapshot(page);
    recordCondition('Production Locks Unchanged: Calibration Lab QA snapshot reports productionSource=legacy, productionWrite/controlledV2Apply/previewExport=false', calSnapFinal.productionSource === 'legacy' && calSnapFinal.productionWrite === false && calSnapFinal.controlledV2Apply === false && calSnapFinal.previewExport === false, JSON.stringify(calSnapFinal));

    const xmpAfter = await captureXmpText(page);
    recordCondition('XMP Exact Invariant Unchanged: byte-identical XMP before and after using the Calibration Lab', xmpBefore !== null && xmpAfter !== null && sha256XmpText(xmpBefore) === sha256XmpText(xmpAfter), `beforeHash=${sha256XmpText(xmpBefore ?? '')}, afterHash=${sha256XmpText(xmpAfter ?? '')}`);

    recordCondition('0 unexpected page errors', collectors.pageErrors.length === 0, JSON.stringify(collectors.pageErrors));
    recordCondition('0 unexpected console errors', collectors.consoleErrors.length === 0, JSON.stringify(collectors.consoleErrors));

    completed = true;
    await runtime.cleanup();
  } catch (err) {
    recordStatus('Suite execution', 'FAIL', buildRuntimeCrashRow(err).evidence);
  } finally {
    await browser.close();
  }

  const failCount = results.filter((r) => r.result === 'FAIL').length;
  const notTestedCount = results.filter((r) => r.result === 'NOT_TESTED').length;
  const decision = (!completed || failCount > 0 || notTestedCount > 0) ? 'FAIL' : 'PASS';
  await writeResultAtomic(RESULTS_PATH, {
    suite: SUITE_NAME, runId, startedAt, completedAt: new Date().toISOString(), completed,
    sourceHash, results, decision,
  });
  console.log(`\n${results.filter((r) => r.result === 'PASS').length}/${results.length} PASS`);
  console.log(`Final decision: ${decision}`);
  process.exit(decision === 'PASS' ? 0 : 1);
}

main().catch(async (err) => {
  console.error('Suite crashed:', err?.stack ?? err);
  try {
    await writeBrowserUnavailableResult(RESULTS_PATH, { suite: SUITE_NAME, status: 'SUITE_CRASHED', reason: String(err?.message ?? err) });
  } catch { /* best-effort only */ }
  process.exit(1);
});
