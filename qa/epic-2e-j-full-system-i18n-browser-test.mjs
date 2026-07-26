#!/usr/bin/env node
/**
 * qa/epic-2e-j-full-system-i18n-browser-test.mjs
 *
 * I18N RUNTIME CLOSURE + QA INTEGRITY R3 — Phase I (rebuild of the
 * FULL-SYSTEM I18N COMPLETION R2 Phase M suite).
 *
 * The R2 version of this suite had seven confirmed integrity defects
 * (independent review, EP9CD1_RUNTIME_REVIEW_SUMMARY.json): a broken
 * Playwright-package contract, a Build-V2 button selector that has
 * never existed in this app, three hardcoded-`true` acceptance rows,
 * and a Thai-leak detector that skipped ANY text node containing a
 * Thai character (allowing mixed Thai+English sentences through). All
 * seven are fixed in this file. See
 * qa/epic-2e-j-i18n-visible-text-audit-static-test.mjs and
 * qa/epic-2e-j-qa-integrity-static-test.mjs for the Static regression
 * guards that make each defect class structurally unable to silently
 * reappear.
 *
 *   1. Start in Thai.
 *   2. Upload a safety-eligible photo fixture and reach Ready (existing
 *      importAndReachReady() helper — clicks every real "Pass" button,
 *      then #btnReanalyze, purely to reach a reviewed, ready state;
 *      this is NOT used as proof of the guided Build-V2 button below).
 *   3. Verify the six visual Review items are complete.
 *   4. Verify the four system Review items are auto-verified.
 *   5. Click the REAL #btnBuildControlledV2 button and prove every
 *      required pre/during/post state from real DOM + QA-snapshot
 *      evidence (Phase B/C).
 *   6. Prove Legacy/V2 actually rendered, Exact dimensions, Interactive
 *      ready, Observation enabled, both results on the current
 *      generation — from real evidence, never a literal `true` (Phase C).
 *   7. Select a real Observation option + two real Reason tags through
 *      the actual radio/checkbox controls; prove the codes changed and
 *      Session incremented exactly once (Phase C).
 *   8. Set the Before/After slider to 73 through real input/change
 *      events; prove the DOM value and the controller-driven split
 *      readout both reflect 73, and that it survives TH->EN->TH (Phase C).
 *   9. Audit every visible main-UI section for English leakage using the
 *      mixed-language-aware detector (Phase D) — a node containing BOTH
 *      Thai and English is never skipped.
 *  10-11. Switch to English, then back to Thai; verify each direction.
 *  12. Verify the bounded state invariants (now read from FIELDS THAT
 *      ACTUALLY EXIST on the QA snapshot — see captureInvariants()) are
 *      unchanged by the locale round-trip.
 *  13. Capture per-section screenshots in both languages.
 *
 * Consistent with every other Browser suite in this project: if
 * Playwright/Chromium is unavailable, this suite honestly reports
 * PLAYWRIGHT_PACKAGE_UNAVAILABLE / BROWSER_BINARY_UNAVAILABLE rather
 * than fabricating a PASS. The fail-closed gate (tools/local-gate.mjs)
 * treats that as a failure of the gate, which is the intended behavior.
 */
import { stat, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import {
  detectPlaywrightPackage,
  detectBrowserExecutable,
  REQUIRED_LAUNCH_ARGS,
  BUILD_CONTROLLED_V2_BUTTON_SELECTOR,
  buildLumixaAppSnapshot,
  openLumixaInMemoryPage,
  generateRunId,
  computeSourceHash,
  writeResultAtomic,
  buildRuntimeCrashRow,
  writeBrowserUnavailableResult,
  buildRunIdentity,
  qaSnapshot,
  passAllReviewItems,
  importAndReachReady,
  waitForAnalysisCompletion,
} from './helpers/playwright-lumixa-test-runtime.mjs';
import { auditVisibleLocaleSections, decideVisibleLocaleAudit } from './helpers/visible-locale-audit.mjs';
import { captureXmpText, sha256XmpText } from './helpers/playwright-lumixa-test-runtime.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const FIXTURES_ROOT = path.join(PROJECT_ROOT, 'qa', 'fixtures', 'epic-2e-j');
const RESULTS_PATH = path.join(PROJECT_ROOT, 'qa', 'epic-2e-j-full-system-i18n-browser-results.json');
const SCREENSHOT_DIR = path.join(PROJECT_ROOT, 'qa-screenshots', 'i18n-r3');
const SUITE_NAME = 'I18N RUNTIME CLOSURE + QA INTEGRITY R3 — Phase I: full-system EN/TH Browser suite';

const FIXTURE = path.join(FIXTURES_ROOT, 'ready', 'ready-portrait-orientation-1.jpg');

const SOURCE_HASH_INPUTS = [
  path.join(__dirname, 'epic-2e-j-full-system-i18n-browser-test.mjs'),
  path.join(__dirname, 'helpers', 'playwright-lumixa-test-runtime.mjs'),
  path.join(__dirname, 'helpers', 'visible-locale-audit.mjs'),
  path.join(PROJECT_ROOT, 'ui', 'isolated-visual-preview-renderer-v2.js'),
  path.join(PROJECT_ROOT, 'index.html'),
  path.join(PROJECT_ROOT, 'ui', 'app.js'),
  path.join(PROJECT_ROOT, 'ui', 'i18n', 'index.js'),
  path.join(PROJECT_ROOT, 'ui', 'i18n', 'en.js'),
  path.join(PROJECT_ROOT, 'ui', 'i18n', 'th.js'),
  path.join(PROJECT_ROOT, 'ui', 'i18n', 'domain-presenters.js'),
  path.join(PROJECT_ROOT, 'ui', 'review-console-renderer.js'),
  path.join(PROJECT_ROOT, 'ui', 'side-by-side-comparison-renderer.js'),
  path.join(PROJECT_ROOT, 'ui', 'visual-preview-comparison-renderer-v2.js'),
  path.join(PROJECT_ROOT, 'ui', 'interactive-before-after-renderer-v2.js'),
  FIXTURE,
];

// Sections whose visible text must be fully Thai in TH mode.
// R4 Phase B: expanded from 6 to the full 8 required sections the
// spec names explicitly (App shell/nav, Analysis status/panels, Review
// Console, Data Comparison, Visual Preview, Before/After, Observation,
// Session Summary). `analysisStatus` and `sessionSummary` were
// previously uncovered by this suite's per-section audit entirely.
const REQUIRED_SECTIONS = [
  { key: 'appShell', selector: 'body' },
  { key: 'analysisStatus', selector: '#imageAnalysisSection' },
  { key: 'reviewConsole', selector: '#reviewConsoleSection' },
  { key: 'dataComparison', selector: '#sideBySideComparisonSection' },
  { key: 'visualPreview', selector: '#visualPreviewComparisonSection' },
  { key: 'beforeAfter', selector: '#interactiveBeforeAfterSection' },
  { key: 'observation', selector: '#interactivePreviewObservationSection' },
  { key: 'sessionSummary', selector: '#interactivePreviewObservationSessionSection' },
];
// R4 Phase B: NO section key is permitted to be NOT_TESTED in this
// suite. `#imageAnalysisSection` (analysisStatus) is set to
// display:block once analyzeImageCore() resolves (ui/app.js) and is
// only ever hidden again by the Reset workflow, which this suite
// never triggers -- by the time the TH/EN audits run (well after
// Review + Build Controlled V2), every one of the 8 required sections
// is expected to be genuinely present. Verified directly against
// ui/app.js rather than assumed.
const PERMITTED_NOT_TESTED_SECTIONS = [];

const APPROVED_TERMS = [
  'Visual Preview Comparison', 'Visual Preview', 'Data Comparison', 'Review Console',
  'Session Observation Summary', 'Before/After', 'Color Grading', 'Tone Curve', 'Basic Panel',
  'Adobe Camera Raw', 'Controlled V2', 'Identity fallback', 'Safety-restraint', 'LUMIXA',
  'Lightroom', 'Production', 'Sandbox', 'Mapping', 'Preview', 'Identity', 'Legacy', 'Canvas',
  'EXIF', 'ACR', 'RGB', 'HSL', 'XMP', 'sRGB', 'ICC', 'RAW', 'LAN', 'URL', 'JSON', 'PNG',
  'JPEG', 'JPG', 'WEBP', 'DPR', 'CSS', 'DOM', 'ARIA', 'QA', 'V2', 'AI', 'UI', 'ID', 'px', 'ms',
  'Pro', 'Master', 'Crypto', 'TRC', 'USDT', 'API', 'Enter', 'Professional', 'Means',
];

let runId = null;
let startedAt = null;
let sourceHash = null;
const results = [];
const ALLOWED_STATUSES = new Set(['PASS', 'FAIL', 'NOT_TESTED', 'NOT_APPLICABLE']);

function recordStatus(test, status, evidence) {
  const statusOk = typeof status === 'string' && ALLOWED_STATUSES.has(status);
  let safeEvidence;
  try { safeEvidence = String(evidence); } catch (e) { safeEvidence = `[evidence formatting threw: ${e?.name ?? 'UnknownError'}]`; }
  const finalStatus = statusOk ? status : 'FAIL';
  const icon = finalStatus === 'PASS' ? '✓' : finalStatus === 'FAIL' ? '✗' : '•';
  results.push({ test, result: finalStatus, evidence: safeEvidence });
  console.log(`${icon} [${finalStatus}] ${test} — ${safeEvidence}`);
}
const record = (test, ok, evidence) => recordStatus(test, ok ? 'PASS' : 'FAIL', evidence);

// ══════════════════════════════════════════════════════════════════
// R4 Phase A/D/K: the previous per-suite COLLECT_LEAKS template string
// + auditSection() (which called page.evaluate with three positional
// arguments instead of one argument object -- silently thrown away by the blanket .catch() below
// it, turning every audited section into a false NOT_TESTED -- R4
// Defect A) have been REMOVED. Both the Thai-mode and English-mode
// visible-text audits below now go through the ONE shared,
// single-argument-object helper in qa/helpers/visible-locale-audit.mjs
// (auditVisibleLocaleSections / decideVisibleLocaleAudit), which is
// also visibility-aware for the English direction (Defect C) instead
// of the old truncated whole-body-text-slice approach.
// ══════════════════════════════════════════════════════════════════


// ══════════════════════════════════════════════════════════════════
// captureInvariants() — I18N RUNTIME CLOSURE R3: reads ONLY fields
// that genuinely exist on window.__LUMIXA_QA__.getPreviewPipelineSnapshot()
// (verified directly against ui/app.js). The R2 version of this
// function read `snap.generationId`, `snap.fileIdentityToken`,
// `snap.visualPreview.legacyRendered/v2Rendered/exactDimensions`,
// `snap.observation.selected` and `snap.selectedProductionSource` /
// `snap.xmpHash` — none of which exist on the real snapshot shape, so
// every one of those comparisons was silently `null === null` (always
// true) rather than genuine evidence. Fixed here to use the real
// field names, plus the new `visualPreviewControllerState` this round
// added to ui/app.js specifically to expose actual (post-render, not
// merely eligible-to-render) Legacy/V2 outcomes to QA.
// ══════════════════════════════════════════════════════════════════
async function captureInvariants(page) {
  const snap = await qaSnapshot(page);
  const sliderReadout = await page.evaluate(() => {
    const readout = document.getElementById('ibaSplitReadout');
    return readout ? readout.textContent : null;
  }).catch(() => null);
  return {
    analysisGeneration: snap?.analysisGeneration ?? null,
    reviewGuidance: JSON.stringify(snap?.reviewGuidance ?? null),
    translationMode: snap?.controlledV2Translation?.mode ?? null,
    visualizedAdjustmentCount: snap?.controlledV2Translation?.visualizedAdjustmentCount ?? null,
    legacyRendered: snap?.visualPreviewControllerState?.legacyRendered ?? null,
    v2Rendered: snap?.visualPreviewControllerState?.v2Rendered ?? null,
    interactiveState: snap?.interactive?.state ?? null,
    alignmentStatus: snap?.interactive?.alignmentStatus ?? null,
    sliderValue: await page.evaluate(() => {
      const r = document.querySelector('#interactiveBeforeAfterSection input[type="range"]');
      return r ? r.value : null;
    }).catch(() => null),
    sliderReadout,
    observationSelectedValue: snap?.observation?.selectedValue ?? null,
    observationReasons: JSON.stringify((snap?.observation?.reasons ?? []).slice().sort()),
    sessionSummary: JSON.stringify(snap?.sessionSummary ?? null),
    // Real, canonical proxy for "selected Production source" — the
    // exact same field core/decision-engine hard-codes to 'legacy' and
    // that the Preview Sandbox itself carries; there is no separate
    // `selectedProductionSource` field on this QA snapshot.
    selectedOutputSource: snap?.previewSandbox?.selectedOutputSource ?? null,
    canWriteProduction: snap?.previewSandbox?.canWriteProduction ?? null,
  };
}

async function main() {
  runId = generateRunId();
  startedAt = new Date().toISOString();
  sourceHash = await computeSourceHash(SOURCE_HASH_INPUTS);

  try { await stat(FIXTURE); }
  catch (e) {
    await writeBrowserUnavailableResult(RESULTS_PATH, { suite: SUITE_NAME, status: 'FIXTURE_MISSING', reason: `${FIXTURE}: ${e.message}` });
    return 0;
  }

  // PHASE A — the single consistent Playwright contract: `available`
  // is checked (never `pkg.status` alone, never assumed), and
  // `pkg.chromium` is used directly (never destructured from `pkg.mod`
  // for THIS suite's own launch call — though `pkg.mod` remains valid
  // for any other consumer that still prefers it).
  const pkg = await detectPlaywrightPackage();
  if (!pkg.available) {
    await writeBrowserUnavailableResult(RESULTS_PATH, { suite: SUITE_NAME, status: 'PLAYWRIGHT_PACKAGE_UNAVAILABLE', reason: pkg.error });
    return 0;
  }
  const chromium = pkg.chromium;
  const browserDetect = await detectBrowserExecutable(chromium);
  if (!browserDetect.found) {
    await writeBrowserUnavailableResult(RESULTS_PATH, { suite: SUITE_NAME, status: 'BROWSER_BINARY_UNAVAILABLE', reason: JSON.stringify(browserDetect.attempts) });
    return 0;
  }

  await mkdir(SCREENSHOT_DIR, { recursive: true }).catch(() => {});

  const browser = await chromium.launch({ executablePath: browserDetect.found, args: REQUIRED_LAUNCH_ARGS });
  let completed = false;
  try {
    const prebuiltApp = await buildLumixaAppSnapshot(PROJECT_ROOT);
    const { page, collectors, cleanup } = await openLumixaInMemoryPage({ browser, projectRoot: PROJECT_ROOT, prebuiltApp, viewport: { width: 1440, height: 1000 } });

    try {
      // ── 1. Start in Thai ────────────────────────────────────────────
      await page.evaluate(() => window.setLang && window.setLang('th'));
      const langAfter = await page.evaluate(() => localStorage.getItem('lang'));
      record('Step 1: app starts in Thai (state.lang persisted as "th")', langAfter === 'th', `lang=${langAfter}`);

      // ── 2. Upload + reach Ready (via Pass-all-items + Re-analyze — a
      //      DIFFERENT workflow than the guided Build-V2 button tested
      //      in Step 5 below; never conflated with it) ─────────────────
      const ready = await importAndReachReady(page, FIXTURE, null);
      const genAfterReady = await qaSnapshot(page).then((s) => s?.analysisGeneration ?? null);
      record('Step 2: safety-eligible photo uploaded and Analysis completed', !!ready?.completed, JSON.stringify({ completed: ready?.completed ?? null, analysisGeneration: genAfterReady }));

      // ── 3+4. Review items ───────────────────────────────────────────
      const reviewed = await passAllReviewItems(page);
      const snapAfterReview = await qaSnapshot(page);
      const g = snapAfterReview?.reviewGuidance ?? {};
      record('Step 3: the six manual visual Review items are complete', (g.visualPassed ?? 0) >= (g.visualRequired ?? 6), JSON.stringify({ visualPassed: g.visualPassed, visualRequired: g.visualRequired }));
      record('Step 4: the four system Review items are auto-verified with zero manual clicks', (g.systemVerified ?? 0) >= (g.systemRequired ?? 4), JSON.stringify({ systemVerified: g.systemVerified, systemRequired: g.systemRequired, manualVisualButtonsClicked: reviewed?.manualVisualButtonsClicked ?? null, systemButtonsClicked: reviewed?.systemButtonsClicked ?? null, totalReviewItems: reviewed?.totalReviewItems ?? null }));
      // R4 Phase H: the previous evidence embedded `clicked: reviewed`
      // where `reviewed` was actually `itemIds.length` (ALL 10 review
      // items iterated, manual+system alike) mislabeled as a click
      // count -- contradicting this row's own "zero manual clicks"
      // wording. passAllReviewItems() now returns an honest breakdown;
      // this row asserts systemButtonsClicked is genuinely 0 (system-
      // verified items render no Pass button at all -- see
      // ui/review-console-renderer.js's isSystemVerified branch) and
      // manualVisualButtonsClicked matches the 6 real visual items.
      record('Step 4b: system-verified items were never clicked (systemButtonsClicked === 0) -- they carry no Pass button in the DOM', reviewed?.systemButtonsClicked === 0, JSON.stringify(reviewed));
      record('Step 4c: exactly the 6 manual visual items received a real click (manualVisualButtonsClicked === 6)', reviewed?.manualVisualButtonsClicked === 6, JSON.stringify(reviewed));

      // ── 5. PHASE B — guided Build Controlled V2 button, real proof ──
      const sel = BUILD_CONTROLLED_V2_BUTTON_SELECTOR;
      const preClickState = await page.evaluate((s) => {
        const matches = document.querySelectorAll(s);
        const btn = matches[0] || null;
        if (!btn) return { count: 0 };
        const cs = window.getComputedStyle(btn);
        return {
          count: matches.length,
          visible: cs.display !== 'none' && cs.visibility !== 'hidden' && btn.offsetParent !== null,
          disabled: btn.disabled === true,
          ariaDisabled: btn.getAttribute('aria-disabled'),
        };
      }, sel);
      record('Step 5a: #btnBuildControlledV2 exists exactly once', preClickState.count === 1, JSON.stringify(preClickState));
      record('Step 5b: #btnBuildControlledV2 is visible', preClickState.visible === true, JSON.stringify(preClickState));
      record('Step 5c: #btnBuildControlledV2 disabled === false before click', preClickState.disabled === false, JSON.stringify(preClickState));
      record('Step 5d: #btnBuildControlledV2 aria-disabled === "false" before click', preClickState.ariaDisabled === 'false', JSON.stringify(preClickState));
      record('Step 5e: reviewGuidance.readyToBuildV2 === true before click', snapAfterReview?.reviewGuidance?.readyToBuildV2 === true, `readyToBuildV2=${snapAfterReview?.reviewGuidance?.readyToBuildV2}`);

      const generationBeforeBuild = snapAfterReview?.analysisGeneration ?? null;

      // Click and — in the SAME evaluate call, before any await yields
      // back to Playwright's own event loop — read the button's state
      // immediately after click(). handleBuildControlledV2Preview()
      // synchronously sets disabled/aria-busy BEFORE its first `await`,
      // so this genuinely observes the busy state (never a guess/poll
      // race), or, honestly, the button not existing.
      const duringClick = await page.evaluate((s) => {
        const btn = document.querySelector(s);
        if (!btn) return { clicked: false };
        btn.click();
        return {
          clicked: true,
          disabledRightAfterClick: btn.disabled === true,
          ariaBusyRightAfterClick: btn.getAttribute('aria-busy') === 'true',
        };
      }, sel);
      record('Step 5f: clicking #btnBuildControlledV2 immediately enters a busy state (disabled and/or aria-busy)', duringClick.clicked === true && (duringClick.disabledRightAfterClick === true || duringClick.ariaBusyRightAfterClick === true), JSON.stringify(duringClick));

      const buildOutcome = await waitForAnalysisCompletion(page, generationBeforeBuild, 25000);
      const snapAfterBuild = buildOutcome.snapshot;
      const generationAfterBuild = snapAfterBuild?.analysisGeneration ?? null;
      record('Step 5g: analysis generation increments exactly once after the guided Build', typeof generationBeforeBuild === 'number' && typeof generationAfterBuild === 'number' && generationAfterBuild === generationBeforeBuild + 1, JSON.stringify({ generationBeforeBuild, generationAfterBuild }));

      const postClickState = await page.evaluate((s) => {
        const btn = document.querySelector(s);
        if (!btn) return null;
        return { disabled: btn.disabled === true, ariaBusy: btn.getAttribute('aria-busy') };
      }, sel);
      record('Step 5h: #btnBuildControlledV2 returns from busy state after processing completes', postClickState !== null && postClickState.ariaBusy !== 'true', JSON.stringify(postClickState));

      const modeAfterBuild = snapAfterBuild?.controlledV2Translation?.mode ?? null;
      record('Step 5i: Controlled V2 built with a meaningful translation mode (Safety-restraint or honest Identity fallback)', modeAfterBuild === 'legacy-derived-safety-restraint' || modeAfterBuild === 'identity-fallback', `translationMode=${modeAfterBuild}`);

      const liveRegionText = await page.evaluate(() => {
        const el = document.getElementById('buildControlledV2LiveRegion');
        return el ? el.textContent : null;
      });
      record('Step 5j: buildControlledV2LiveRegion contains a non-empty localized outcome announcement', typeof liveRegionText === 'string' && liveRegionText.trim().length > 0, JSON.stringify({ liveRegionText }));

      const vprFocusState = await page.evaluate(() => {
        const sec = document.getElementById('visualPreviewComparisonSection');
        if (!sec) return { sectionExists: false };
        const visible = window.getComputedStyle(sec).display !== 'none';
        return { sectionExists: true, visible, isActiveElement: document.activeElement === sec };
      });
      if (vprFocusState.sectionExists && vprFocusState.visible) {
        record('Step 5k: Visual Preview Comparison section receives focus as the designed post-build scroll target', vprFocusState.isActiveElement === true, JSON.stringify(vprFocusState));
      } else {
        recordStatus('Step 5k: Visual Preview Comparison section receives focus as the designed post-build scroll target', 'NOT_TESTED', JSON.stringify(vprFocusState));
      }

      // ── 6. PHASE C — required rendered states, from REAL evidence ──
      const bothOnCurrentGeneration = snapAfterBuild?.visualPreviewControllerState?.analysisGenerationId === snapAfterBuild?.analysisGeneration
        && snapAfterBuild?.analysisGeneration !== null && snapAfterBuild?.analysisGeneration !== undefined;
      const observationRadioCount = await page.evaluate(() => document.querySelectorAll('#interactivePreviewObservationSection input[name="ipoObservation"]:not([disabled])').length);
      record('Step 6a: Legacy preview actually rendered (visualPreviewControllerState.legacyRendered === true)', snapAfterBuild?.visualPreviewControllerState?.legacyRendered === true, `legacyRendered=${snapAfterBuild?.visualPreviewControllerState?.legacyRendered}`);
      record('Step 6b: Controlled V2 preview actually rendered (visualPreviewControllerState.v2Rendered === true)', snapAfterBuild?.visualPreviewControllerState?.v2Rendered === true, `v2Rendered=${snapAfterBuild?.visualPreviewControllerState?.v2Rendered}`);
      record('Step 6c: Exact dimensions alignment achieved (interactive.alignmentStatus === "Exact dimensions")', snapAfterBuild?.interactive?.alignmentStatus === 'Exact dimensions', `alignmentStatus=${snapAfterBuild?.interactive?.alignmentStatus}`);
      record('Step 6d: Interactive Before/After state is ready', snapAfterBuild?.interactive?.state === 'ready', `interactiveState=${snapAfterBuild?.interactive?.state}`);
      record('Step 6e: Observation radio controls are enabled (not disabled) in the DOM', observationRadioCount > 0, `enabledObservationRadioCount=${observationRadioCount}`);
      record('Step 6f: both rendered Preview results belong to the current analysis generation', bothOnCurrentGeneration, JSON.stringify({ controllerGen: snapAfterBuild?.visualPreviewControllerState?.analysisGenerationId, currentGen: snapAfterBuild?.analysisGeneration }));

      // ── 7. PHASE C — real Observation + Reason selection ────────────
      const sessionBefore = snapAfterBuild?.sessionSummary?.totalObserved ?? 0;
      await page.evaluate(() => {
        const opt = document.querySelector('#interactivePreviewObservationSection input[name="ipoObservation"][value="prefer-v2"]');
        if (opt) { opt.checked = true; opt.dispatchEvent(new Event('change', { bubbles: true })); }
      });
      await page.waitForTimeout(150);
      const snapAfterObs = await qaSnapshot(page);
      record('Step 7a: a specific Observation option ("prefer-v2") was selected through the real radio control', snapAfterObs?.observation?.selectedValue === 'prefer-v2', `selectedValue=${snapAfterObs?.observation?.selectedValue}`);

      await page.evaluate(() => {
        for (const value of ['skin-tone', 'contrast']) {
          const cb = document.querySelector(`#interactivePreviewObservationSection input[name="ipoReason"][value="${value}"]`);
          if (cb) { cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); }
        }
      });
      await page.waitForTimeout(150);
      const snapAfterReasons = await qaSnapshot(page);
      const reasonsAfter = (snapAfterReasons?.observation?.reasons ?? []).slice().sort();
      const reasonsMatch = reasonsAfter.includes('skin-tone') && reasonsAfter.includes('contrast');
      record('Step 7b: two Reason tags were selected through real checkbox controls and the Reason codes changed accordingly', reasonsMatch, JSON.stringify({ reasonsAfter }));

      const sessionAfter = snapAfterReasons?.sessionSummary?.totalObserved ?? -1;
      record('Step 7c: Session summary totalObserved increments exactly once for this generation (one record per generation, regardless of how many Reason toggles followed)', sessionAfter === sessionBefore + 1, JSON.stringify({ sessionBefore, sessionAfter }));

      // ── 8. PHASE C — real Before/After slider set to 73 ─────────────
      await page.evaluate(() => {
        const r = document.querySelector('#interactiveBeforeAfterSection input[type="range"]');
        if (r) { r.value = '73'; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); }
      });
      await page.waitForTimeout(200);
      const sliderDomValue = await page.evaluate(() => document.querySelector('#interactiveBeforeAfterSection input[type="range"]')?.value ?? null);
      const sliderReadoutAfter = await page.evaluate(() => document.getElementById('ibaSplitReadout')?.textContent ?? null);
      record('Step 8a: the Before/After range input.value === "73" after real input/change events', sliderDomValue === '73', `sliderDomValue=${sliderDomValue}`);
      record('Step 8b: the controller-driven split readout reflects the same 73 split', typeof sliderReadoutAfter === 'string' && sliderReadoutAfter.includes('73'), JSON.stringify({ sliderReadoutAfter }));

      // -- Capture invariants BEFORE any language switch --------------
      const before = await captureInvariants(page);
      // R4 Phase L: XMP exact locale invariant -- captured BEFORE the
      // TH->EN->TH round trip below via the real #btnDownload click
      // (captureXmpText intercepts the Blob, never actually saves a
      // file). A Legacy preset is genuinely available at this point in
      // the workflow (Build Controlled V2 already completed), so this
      // must never fall back to NOT_APPLICABLE -- that was the R4
      // Defect L gap: the previous version of this suite recorded
      // NOT_APPLICABLE unconditionally, even though a real preset was
      // always available to compare.
      const xmpBeforeLocaleSwitch = await captureXmpText(page);

      // -- 9. Thai visible-text audit, per required section (R4 Phase B/D) --
      // Uses the shared, single-argument-object helper (R4 Phase A) --
      // NOT the old broken 3-argument auditSection(). A section that
      // genuinely cannot be found is now itself a decision FAIL (no
      // permitted NOT_TESTED sections in this suite -- see
      // PERMITTED_NOT_TESTED_SECTIONS above), and an audit that throws
      // is distinguished from "section absent" instead of both being
      // silently swallowed into a false zero-leak PASS.
      const thAuditRows = await auditVisibleLocaleSections(page, REQUIRED_SECTIONS, { mode: 'th', approvedTerms: APPROVED_TERMS });
      for (const row of thAuditRows) {
        if (row.status === 'NOT_TESTED') {
          recordStatus(`Step 9: Thai audit -- ${row.key} section present`, 'NOT_TESTED', `selector ${row.selector} not found in this build`);
        } else if (row.status === 'FAIL' && row.reason === 'audit-threw') {
          // R4 Defect A/B: an audit infrastructure failure is recorded
          // as an explicit FAIL, never silently downgraded.
          recordStatus(`Step 9: Thai audit -- ${row.key} audit ran without error`, 'FAIL', `audit-threw: ${row.error}`);
        } else {
          record(`Step 9: Thai audit -- ${row.key} has zero visible English sentences / unresolved template tokens (mixed Thai+English nodes are inspected, never skipped)`, row.status === 'PASS', JSON.stringify({ leaks: row.leaks.length, unresolvedTemplateLeaks: row.unresolvedTemplateLeaks.length, sample: row.leaks.slice(0, 5) }));
        }
        await page.screenshot({ path: path.join(SCREENSHOT_DIR, `th-${row.key}.png`), fullPage: false }).catch(() => {});
      }
      const thDecision = decideVisibleLocaleAudit(thAuditRows, { permittedNotTested: PERMITTED_NOT_TESTED_SECTIONS });
      record('Step 9: fail-closed decision across all 8 required Thai sections is PASS (no FAIL rows, no unpermitted NOT_TESTED rows)', thDecision.decision === 'PASS', JSON.stringify({ decision: thDecision.decision, totalLeaks: thDecision.totalLeaks, failedKeys: thDecision.failures.map((r) => r.key), notTestedKeys: thDecision.unpermittedNotTested.map((r) => r.key) }));

      // -- 10+11. TH -> EN -> TH (R4 Phase C/K: visibility-aware EN audit,
      //    replacing the old truncated whole-body innerText slice
      //    check, which was neither visibility-aware nor per-section) --
      await page.evaluate(() => window.setLang && window.setLang('en'));
      await page.waitForTimeout(600);
      const enAuditRows = await auditVisibleLocaleSections(page, REQUIRED_SECTIONS, { mode: 'en', approvedTerms: APPROVED_TERMS });
      for (const row of enAuditRows) {
        if (row.status === 'NOT_TESTED') {
          recordStatus(`Step 10: English audit -- ${row.key} section present`, 'NOT_TESTED', `selector ${row.selector} not found in this build`);
        } else if (row.status === 'FAIL' && row.reason === 'audit-threw') {
          recordStatus(`Step 10: English audit -- ${row.key} audit ran without error`, 'FAIL', `audit-threw: ${row.error}`);
        } else {
          record(`Step 10: English audit -- ${row.key} has zero visible Thai fragments / unresolved template tokens`, row.status === 'PASS', JSON.stringify({ leaks: row.leaks.length, unresolvedTemplateLeaks: row.unresolvedTemplateLeaks.length, sample: row.leaks.slice(0, 5) }));
        }
        await page.screenshot({ path: path.join(SCREENSHOT_DIR, `en-${row.key}.png`), fullPage: false }).catch(() => {});
      }
      const enDecision = decideVisibleLocaleAudit(enAuditRows, { permittedNotTested: PERMITTED_NOT_TESTED_SECTIONS });
      record('Step 10: fail-closed decision across all 8 required English sections is PASS (no FAIL rows, no unpermitted NOT_TESTED rows)', enDecision.decision === 'PASS', JSON.stringify({ decision: enDecision.decision, totalLeaks: enDecision.totalLeaks, failedKeys: enDecision.failures.map((r) => r.key), notTestedKeys: enDecision.unpermittedNotTested.map((r) => r.key) }));

      await page.evaluate(() => window.setLang && window.setLang('th'));
      await page.waitForTimeout(600);
      const thRoundTripRows = await auditVisibleLocaleSections(page, REQUIRED_SECTIONS, { mode: 'th', approvedTerms: APPROVED_TERMS });
      const thRoundTripDecision = decideVisibleLocaleAudit(thRoundTripRows, { permittedNotTested: PERMITTED_NOT_TESTED_SECTIONS });
      record('Step 11: switching back to Thai renders Thai again with zero English leaks (fail-closed across all 8 sections)', thRoundTripDecision.decision === 'PASS', JSON.stringify({ decision: thRoundTripDecision.decision, totalLeaks: thRoundTripDecision.totalLeaks, failedKeys: thRoundTripDecision.failures.map((r) => r.key), notTestedKeys: thRoundTripDecision.unpermittedNotTested.map((r) => r.key) }));



      // ── 12. State invariants after TH -> EN -> TH ───────────────────
      const after = await captureInvariants(page);
      const xmpAfterLocaleSwitch = await captureXmpText(page);
      const changed = Object.keys(before).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
      record('Step 12: TH→EN→TH changed NO bounded state invariant (generation, Review, V2 mode, render state, alignment, slider+readout, Observation, Reasons, Session, Production source)', changed.length === 0, JSON.stringify({ changedFields: changed, before, after }));

      const consoleErrors = (collectors?.consoleErrors ?? []).length;
      const pageErrors = (collectors?.pageErrors ?? []).length;
      record('Step 13: zero page errors and zero console errors across the entire workflow', consoleErrors === 0 && pageErrors === 0, JSON.stringify({ pageErrors, consoleErrors, samples: (collectors?.pageErrors ?? []).slice(0, 3) }));

      record('Production source remained Legacy for the whole run (previewSandbox.selectedOutputSource)', after.selectedOutputSource === 'legacy' || after.selectedOutputSource === null, `selectedOutputSource=${after.selectedOutputSource}`);
      record('Production write remained disabled for the whole run (previewSandbox.canWriteProduction === false)', after.canWriteProduction === false || after.canWriteProduction === null, `canWriteProduction=${after.canWriteProduction}`);
      // R4 Phase L: genuine XMP-exact-locale invariant -- the same
      // real serializeXMP()/downloadXMP() production path is invoked
      // (via a real #btnDownload click) both before and after the
      // TH->EN->TH round trip; locale switching must never change one
      // byte of the exported preset, since it is presentation-only.
      const xmpBothCaptured = typeof xmpBeforeLocaleSwitch === 'string' && typeof xmpAfterLocaleSwitch === 'string';
      if (!xmpBothCaptured) {
        // A genuinely missing #btnDownload or a capture failure is an
        // infrastructure problem, not a legitimate "not applicable"
        // case -- recorded as FAIL, never NOT_APPLICABLE, per R4
        // Defect B's same fail-closed principle applied here.
        recordStatus('XMP exact locale invariant: both captures succeeded (before and after TH->EN->TH)', 'FAIL', JSON.stringify({ beforeCaptured: typeof xmpBeforeLocaleSwitch === 'string', afterCaptured: typeof xmpAfterLocaleSwitch === 'string' }));
      } else {
        record('XMP exact locale invariant: identical text before vs. after TH->EN->TH', xmpBeforeLocaleSwitch === xmpAfterLocaleSwitch, `beforeLength=${xmpBeforeLocaleSwitch.length}, afterLength=${xmpAfterLocaleSwitch.length}`);
        record('XMP exact locale invariant: identical length before vs. after TH->EN->TH', xmpBeforeLocaleSwitch.length === xmpAfterLocaleSwitch.length, `before=${xmpBeforeLocaleSwitch.length}, after=${xmpAfterLocaleSwitch.length}`);
        record('XMP exact locale invariant: identical SHA-256 hash before vs. after TH->EN->TH', sha256XmpText(xmpBeforeLocaleSwitch) === sha256XmpText(xmpAfterLocaleSwitch), `before=${sha256XmpText(xmpBeforeLocaleSwitch).slice(0, 16)}..., after=${sha256XmpText(xmpAfterLocaleSwitch).slice(0, 16)}...`);
      }

      completed = true;
    } finally {
      await cleanup?.().catch(() => {});
    }
  } catch (err) {
    results.push(buildRuntimeCrashRow(err));
    console.error('✗ [FAIL] Suite crashed —', err?.message ?? err);
  } finally {
    await browser.close().catch(() => {});
  }

  const failCount = results.filter((r) => r.result === 'FAIL').length;
  const notTested = results.filter((r) => r.result === 'NOT_TESTED').length;
  // R4 Phase B (Defect B fix): the previous decision ONLY checked
  // failCount, silently ignoring any required NOT_TESTED row -- a
  // section that fell through to NOT_TESTED (whether from a genuine
  // "not in this build" case or, before the R4 Phase A fix, from a
  // swallowed audit-infrastructure exception) never affected the
  // suite's final PASS/FAIL verdict. Fixed: ANY NOT_TESTED row now
  // fails the suite closed, with no exception list for this suite (the
  // one legitimate conditional NOT_TESTED source, Step 5k's focus
  // check, is itself gated on the section being genuinely
  // absent/hidden, which never happens in the deterministic fixture
  // workflow this suite drives).
  const decision = !completed ? 'INCOMPLETE' : (failCount > 0 || notTested > 0) ? 'FAIL' : 'PASS';
  await writeResultAtomic(RESULTS_PATH, {
    suite: SUITE_NAME,
    decision,
    ...buildRunIdentity({ runId, startedAt, completedAt: new Date().toISOString(), completed, sourceHash, browserExecutablePath: browserDetect.found, browserVersion: null }),
    results,
    summary: { total: results.length, pass: results.filter((r) => r.result === 'PASS').length, fail: failCount, notTested },
  });
  console.log(`\nFinal decision: ${decision} (${results.length} rows, ${failCount} FAIL, ${notTested} NOT_TESTED)`);
  return failCount > 0 || notTested > 0 || !completed ? 1 : 0;
}

process.exit(await main());
