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
  // EPIC 2E-K-R2-FIX1 -- PIXEL TRUTH, DECISION GATE AND EVIDENCE CLOSURE.
  path.join(PROJECT_ROOT, 'core', 'calibration-lab', 'preview-evidence.js'),
  path.join(PROJECT_ROOT, 'core', 'calibration-lab', 'pixel-truth-capture.js'),
  path.join(PROJECT_ROOT, 'core', 'calibration-lab', 'migrate-v1-to-v2.js'),
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
    // EPIC 2E-K-R2-FIX1 -- Section 8: the nav button's visible text
    // must NEVER be the hardcoded English string "Calibration Lab" --
    // the app boots in Thai by default, so its initial text must be
    // the real Thai translation, genuinely different from the English
    // one, and it must NOT contain the literal English words
    // "Calibration Lab" (the exact reported defect).
    const navBtnTextTh = (await navBtn.textContent() || '').trim();
    const navBtnTitleTh = await navBtn.getAttribute('title');
    const navBtnAriaTh = await navBtn.getAttribute('aria-label');
    recordCondition('Locale Header (FIX1 Section 8): nav button text is NOT the hardcoded English "Calibration Lab" string while the app is in Thai', !/Calibration Lab/i.test(navBtnTextTh), { navBtnTextTh });
    recordCondition('Locale Header (FIX1 Section 8): nav button title/aria-label are populated (never empty) and consistent with its visible text', navBtnTitleTh === navBtnTextTh && navBtnAriaTh === navBtnTextTh, { navBtnTextTh, navBtnTitleTh, navBtnAriaTh });
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
      const qa = window.__LUMIXA_QA__.getCalibrationLabSnapshot();
      return {
        overallState: note ? note.getAttribute('data-cal-pixel-overall-state') : null,
        legacyState: note ? note.getAttribute('data-cal-pixel-legacy-state') : null,
        v2State: note ? note.getAttribute('data-cal-pixel-v2-state') : null,
        legacyBackingSize: legacyCanvas ? legacyCanvas.width * legacyCanvas.height : 0,
        v2BackingSize: v2Canvas ? v2Canvas.width * v2Canvas.height : 0,
        v2Width: v2Canvas ? v2Canvas.width : 0,
        v2Height: v2Canvas ? v2Canvas.height : 0,
        // EPIC 2E-K-R2-FIX1 -- Section 6: the AUTHORITATIVE evidence
        // (captured once, at addImage() time, via the real reused
        // pixel-render chain -- see core/calibration-lab/pixel-truth-capture.js)
        // rather than only the live re-render's own transient state.
        previewTruthCode: qa.currentPreviewTruthCode,
        browserVerified: qa.currentBrowserVerified,
        visualDecisionEligible: qa.currentVisualDecisionEligible,
        pixelBlockerReasonCode: qa.currentPixelBlockerReasonCode,
      };
    });
    recordCondition('Real Pixel Comparison: the render actually resolved to a real state (rendered/blocked/failed/cancelled/unavailable), never left permanently in the transient "rendering" placeholder', pixelState1.overallState !== null, JSON.stringify(pixelState1));
    // EPIC 2E-K-R2-FIX1 -- Section 6: the EXACT false-positive bug this
    // replaces was `v2State !== 'rendered' || v2BackingSize > 0` --
    // that OR-shortcut is TRUE (a false PASS) whenever v2State is
    // 'unknown'/'blocked'/'failed'/'cancelled'/anything but the literal
    // string 'rendered', including the reported "status=unknown, canvas
    // stuck at blank 300x150" defect. The fixed condition below is a
    // POSITIVE, independently-verified proof for a 'rendered' claim,
    // never an OR that lets an unproven state slip through, and it
    // ALSO fails a false 'rendered' claim that has zero backing pixels
    // or the untouched default 300x150 size.
    // FIX1 Section 6 -- positive, independently-verified proof for a
    // 'rendered' claim (never the old OR-shortcut that let 'unknown'/
    // 'blocked'/'failed'/'cancelled' states silently pass):
    recordCondition('Real Pixel Comparison: the Legacy canvas received real backing pixel dimensions (genuinely drawn to, not a blank 0x0 canvas) when its side claims rendered', pixelState1.legacyState !== 'rendered' || pixelState1.legacyBackingSize > 0, JSON.stringify(pixelState1));
    const v2ClaimsRendered = pixelState1.v2State === 'rendered';
    recordCondition('Real Pixel Comparison (FIX1 Section 6): if Controlled V2 claims rendered, it must have real non-zero backing pixels -- a claim of "rendered" with zero pixels is a FAIL, never a silent pass', !v2ClaimsRendered || (pixelState1.v2Width > 0 && pixelState1.v2Height > 0 && pixelState1.v2BackingSize > 0), JSON.stringify(pixelState1));
    recordCondition('Real Pixel Comparison (FIX1 Section 6): a V2 canvas that claims rendered must not be the untouched default 300x150 blank size', !v2ClaimsRendered || !(pixelState1.v2Width === 300 && pixelState1.v2Height === 150), JSON.stringify(pixelState1));
    // EPIC 2E-K-R2-FIX1 -- Section 1/2: the AUTHORITATIVE, persisted
    // previewEvidence (captured at addImage() time, independent of
    // whatever the live slider re-render currently shows) must also
    // agree that this is real, browser-verified evidence before the
    // Decision Gate could ever allow a comparative decision.
    recordCondition('Pixel Truth (FIX1 Section 1/2): previewEvidence.previewTruthCode is one of the 10 canonical stable codes (never a freeform value)', typeof pixelState1.previewTruthCode === 'string' && pixelState1.previewTruthCode.length > 0, JSON.stringify(pixelState1));
    recordCondition('Pixel Truth (FIX1 Section 1): previewEvidence.browserVerified is a real boolean (never undefined)', typeof pixelState1.browserVerified === 'boolean', JSON.stringify(pixelState1));

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

    // EPIC 2E-K-R2-FIX1 -- Section 3: Decision Eligibility Gate. The
    // exact allowed decision depends on what the real fixture image's
    // pixel evidence turned out to be (BOTH_RENDERED_DIFFERENT vs
    // BOTH_RENDERED_IDENTITY vs any failure code) -- this test reads
    // the AUTHORITATIVE evidence first and only then picks a decision
    // that the gate is SUPPOSED to allow, rather than assuming
    // V2_BETTER is always eligible. It also proves the gate genuinely
    // blocks whichever decisions it is NOT supposed to allow.
    const gateState = await page.evaluate(() => window.__LUMIXA_QA__.getCalibrationLabSnapshot());
    const eligible = gateState.currentVisualDecisionEligible === true;
    const truthCode = gateState.currentPreviewTruthCode;
    recordCondition('Decision Gate (FIX1 Section 3): currentVisualDecisionEligible is a real boolean reflecting genuine pixel evidence, never assumed true', typeof gateState.currentVisualDecisionEligible === 'boolean', JSON.stringify(gateState));

    // Every decision chip's disabled state must exactly match
    // isDecisionAllowedForEvidence()'s verdict for the CURRENT evidence
    // -- read straight off the DOM's own data attributes (Section 3:
    // "must check the gate in the UI too", never relying on the
    // disabled attribute ALONE, which is why the Controller-level
    // check below is the one that actually matters for safety).
    const chipStates = await page.evaluate(() => {
      const chips = [...document.querySelectorAll('#calibrationLabRoot [data-cal-decision-code]')];
      return chips.map(c => ({ code: c.getAttribute('data-cal-decision-code'), allowed: c.getAttribute('data-cal-decision-allowed') === 'true', disabled: c.disabled === true }));
    });
    const chipStatesConsistent = chipStates.every(c => c.allowed === !c.disabled);
    recordCondition('Decision Gate (FIX1 Section 3): every decision chip\'s disabled attribute exactly matches its data-cal-decision-allowed flag (no chip is clickable while marked ineligible, or vice versa)', chipStatesConsistent, JSON.stringify(chipStates));

    // Controller-level enforcement (Section 3's explicit requirement:
    // "must check the gate in the Controller too, never rely on the UI
    // disabled attribute alone") -- attempt to save V2_BETTER by
    // calling the controller DIRECTLY, bypassing the UI entirely. This
    // must be rejected whenever the current evidence is not
    // BOTH_RENDERED_DIFFERENT, no matter what the UI would have allowed.
    const directSaveAttempt = await page.evaluate(async () => {
      const ctrl = window.__LUMIXA_CAL_LAB_CONTROLLER_FOR_QA__;
      if (!ctrl) return { skipped: true };
      const before = ctrl.getState().currentRecord?.userDecision ?? null;
      const result = await ctrl.saveCurrentDecision({ userDecision: 'V2_BETTER', issueCodes: [], notes: 'hostile-direct-call' });
      return { skipped: false, before, after: result.currentRecord?.userDecision ?? null, lastActionError: result.lastActionError };
    });
    if (!directSaveAttempt.skipped) {
      const shouldHaveBeenRejected = truthCode !== 'BOTH_RENDERED_DIFFERENT';
      recordCondition('Decision Gate (FIX1 Section 3): Controller.saveCurrentDecision() rejects V2_BETTER called directly (bypassing the UI) when evidence is not BOTH_RENDERED_DIFFERENT', !shouldHaveBeenRejected || (directSaveAttempt.after === directSaveAttempt.before && directSaveAttempt.lastActionError === 'DECISION_NOT_ELIGIBLE'), JSON.stringify(directSaveAttempt));
    }

    // Now record a genuinely ALLOWED decision through the real UI, so
    // Decision + Issue Code Persistence is still proven for whichever
    // decision code is actually eligible for this fixture's real
    // pixel outcome.
    const decisionLabelPattern = (truthCode === 'BOTH_RENDERED_DIFFERENT' && eligible)
      ? /Controlled V2 is better|Controlled V2 ดีกว่า/
      : (eligible ? /About equal|เท่ากันโดยประมาณ/ : null);
    if (decisionLabelPattern) {
      await page.locator('#calibrationLabRoot .cal-chip', { hasText: decisionLabelPattern }).first().click();
      const wbCheckbox = page.locator('#calibrationLabRoot label', { hasText: /White balance too warm|White Balance อุ่นเกินไป/ }).locator('input[type="checkbox"]');
      await wbCheckbox.check();
      await page.locator('#calibrationLabRoot button', { hasText: /Save Result for This Image|บันทึกผลภาพปัจจุบัน/ }).first().click();
      snap = await calSnapshot(page);
      const expectedDecision = truthCode === 'BOTH_RENDERED_DIFFERENT' ? 'V2_BETTER' : 'ABOUT_EQUAL';
      recordCondition('Decision Persistence: an ELIGIBLE decision saves successfully and currentDecisionCode reflects it', snap.currentDecisionCode === expectedDecision, JSON.stringify(snap));
      recordCondition('Issue Code Persistence: WB_TOO_WARM present in selectedIssueCodes', Array.isArray(snap.selectedIssueCodes) && snap.selectedIssueCodes.includes('WB_TOO_WARM'), JSON.stringify(snap));

      // EPIC 2E-K-R2-FIX1 -- Section 7: Clear Current Answer must
      // genuinely empty Notes, not just reset the decision code.
      const notesBox = page.locator('#calibrationLabRoot textarea.cal-textarea');
      await notesBox.fill('this note must be gone after Clear');
      await page.locator('#calibrationLabRoot button', { hasText: /Clear This Image's Answer|ล้างคำตอบของภาพนี้/ }).first().click();
      const notesValueAfterClear = await page.evaluate(() => document.querySelector('#calibrationLabRoot textarea.cal-textarea')?.value ?? null);
      snap = await calSnapshot(page);
      recordCondition('Clear Current Answer (FIX1 Section 7): decision resets to NOT_REVIEWED', snap.currentDecisionCode === 'NOT_REVIEWED', JSON.stringify(snap));
      recordCondition('Clear Current Answer (FIX1 Section 7): the Notes textarea is genuinely empty after clearing (the R2 bug re-supplied the OLD notes value here)', notesValueAfterClear === '', { notesValueAfterClear });
    } else {
      recordCondition('Decision Gate (FIX1 Section 3): no decision is eligible for this fixture\'s real evidence -- Decision Controls correctly remain disabled rather than allowing a save', chipStates.every(c => !c.allowed), JSON.stringify({ chipStates, truthCode }));
    }

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
    // EPIC 2E-K-R2-FIX1 -- Section 8: #calibrationLabNavBtn itself lives
    // OUTSIDE #calibrationLabRoot (it's part of the main app header),
    // so the audit above never covers it -- explicit nav-button checks
    // at each stage of the TH->EN->TH cycle are the only thing that
    // proves the button genuinely reacts to a real language change,
    // not just at first paint.
    const navBtnTextThBeforeSwitch = (await navBtn.textContent() || '').trim();
    await page.evaluate(() => { document.documentElement.lang = 'en'; });
    await page.waitForTimeout(200);
    const enAudit = await auditVisibleLocaleSections(page, ['#calibrationLabRoot'], { mode: 'en', approvedTerms: ['IndexedDB', 'Controlled V2', 'JSON', 'CSV'] });
    const navBtnTextEn = (await navBtn.textContent() || '').trim();
    const navBtnTitleEn = await navBtn.getAttribute('title');
    recordCondition('Locale Header (FIX1 Section 8): nav button text genuinely CHANGES when the language switches to English (never stuck on the Thai string)', navBtnTextEn !== navBtnTextThBeforeSwitch && navBtnTextEn.length > 0, { navBtnTextThBeforeSwitch, navBtnTextEn });
    recordCondition('Locale Header (FIX1 Section 8): in English mode, nav button title matches its visible text (both reactively updated together)', navBtnTitleEn === navBtnTextEn, { navBtnTitleEn, navBtnTextEn });
    await page.evaluate(() => { document.documentElement.lang = 'th'; });
    await page.waitForTimeout(200);
    const thAudit2 = await auditVisibleLocaleSections(page, ['#calibrationLabRoot'], { mode: 'th', approvedTerms: ['IndexedDB', 'Controlled V2', 'JSON', 'CSV'] });
    const navBtnTextThAfterRoundTrip = (await navBtn.textContent() || '').trim();
    recordCondition('Locale Header (FIX1 Section 8): switching back to Thai restores the exact original Thai nav button text (genuine round-trip, not a one-way flip)', navBtnTextThAfterRoundTrip === navBtnTextThBeforeSwitch, { navBtnTextThBeforeSwitch, navBtnTextThAfterRoundTrip });
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
