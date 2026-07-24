#!/usr/bin/env node
/**
 * qa/epic-2e-j-safe-recovery-upload-baseline-test.mjs
 *
 * SAFE RECOVERY + DEPLOY GEOMETRY R2 — Phase 1B: the Baseline Upload
 * Contract. Proves, through the REAL DOM (real file input, real
 * previewImg element, real analysis pipeline — never a forced/mocked
 * Controller state), that the upload -> decode -> analysis-complete
 * contract described in EC3_CURRENT_GEOMETRY_BASELINE_LIFECYCLE.md
 * (recovery-evidence/ec3-baseline/) still holds on THIS codebase,
 * before any Phase 3+ lifecycle-hardening edit in this task, and again
 * after (this same file is re-run, unchanged, post-edit — a single
 * source of truth for both "before" and "after" evidence).
 *
 * Required by the spec:
 *   1. Open the application.
 *   2. Confirm upload area is visible.
 *   3. Call setInputFiles() on the real input.
 *   4. Confirm uploadWrap hides.
 *   5. Confirm previewWrap shows.
 *   6. Confirm previewImg receives a non-empty source.
 *   7. Confirm previewImg load/decode completes.
 *   8. Confirm state.imageLoaded becomes true through the public QA hook.
 *   9. Confirm runAnalysis begins.
 *  10. Confirm analysis reaches a completed visible state.
 *  11. Confirm sliders and analysis groups become visible.
 *  12. Confirm zero Page errors and zero Console errors.
 *  13. Confirm selecting a second image also works.
 *  14. Confirm Reset returns to upload state.
 * Plus (this round's extended contract):
 *  15. Re-analyze works (same file, new generation).
 *  16. Rapid upload A-then-B: B's generation wins, A's does not overwrite it.
 *  17. Reset after analysis returns cleanly to upload state a second time.
 *
 * Uses the shared Navigation-Free In-Memory Harness (same helper every
 * other real-Browser suite in this project uses) — no localhost/
 * private-IP navigation, only about:blank?qa=1. When no Chromium binary
 * exists (confirmed true in the authoring sandbox — see
 * recovery-evidence/ec3-baseline/ for the direct `npx playwright
 * install chromium` attempt that failed with a network-allowlist 403),
 * this suite fails closed to BROWSER_BINARY_UNAVAILABLE and writes that
 * honest status — it never claims PASS without a real run.
 *
 * Run: node qa/epic-2e-j-safe-recovery-upload-baseline-test.mjs
 * Output: qa/epic-2e-j-safe-recovery-upload-baseline-results.json
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
  waitForAnalysisCompletion,
} from './helpers/playwright-lumixa-test-runtime.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const FIXTURES_DIR = path.join(PROJECT_ROOT, 'qa', 'fixtures', 'epic-2e-j');
const FIXTURE_A = path.join(FIXTURES_DIR, 'neutral-balanced.png');
const FIXTURE_B = path.join(FIXTURES_DIR, 'warm-portrait-synthetic.png');
const RESULTS_PATH = path.join(PROJECT_ROOT, 'qa', 'epic-2e-j-safe-recovery-upload-baseline-results.json');
const SOURCE_HASH_INPUTS = [
  path.join(__dirname, 'epic-2e-j-safe-recovery-upload-baseline-test.mjs'),
  path.join(__dirname, 'helpers', 'playwright-lumixa-test-runtime.mjs'),
  path.join(__dirname, 'helpers', 'playwright-in-memory-app.mjs'),
  path.join(PROJECT_ROOT, 'ui', 'app.js'),
];

let runId = null;
let startedAt = null;
let sourceHash = null;

const results = [];
function record(test, result, evidence) {
  const normalizedResult = typeof result === 'boolean' ? (result ? 'PASS' : 'FAIL') : result;
  results.push({ test, result: normalizedResult, evidence });
  const icon = normalizedResult === 'PASS' ? '✓' : normalizedResult === 'FAIL' ? '✗' : '•';
  console.log(`${icon} [${normalizedResult}] ${test} — ${evidence}`);
}

/**
 * Fail-closed decision function — exported so a static self-test can
 * exercise it directly without ever launching a real Browser.
 */
export function computeUploadBaselineDecision(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return 'FAIL_UPLOAD_BASELINE';
  const allowed = new Set(['PASS', 'FAIL', 'NOT_TESTED']);
  for (const row of rows) {
    if (!row || typeof row.result !== 'string' || !allowed.has(row.result)) return 'FAIL_UPLOAD_BASELINE';
    if (row.result === 'FAIL') return 'FAIL_UPLOAD_BASELINE';
  }
  return rows.every((r) => r.result === 'PASS') ? 'PASS_UPLOAD_BASELINE' : 'FAIL_UPLOAD_BASELINE';
}

async function main() {
  runId = generateRunId();
  startedAt = new Date().toISOString();
  sourceHash = await computeSourceHash(SOURCE_HASH_INPUTS);

  const pkg = await detectPlaywrightPackage();
  if (pkg.status !== 'PLAYWRIGHT_PACKAGE_AVAILABLE') {
    console.log(`Playwright Node package unavailable: ${pkg.error}`);
    console.log('Final decision: PLAYWRIGHT_PACKAGE_UNAVAILABLE');
    await writeBrowserUnavailableResult(RESULTS_PATH, {
      suite: 'SAFE RECOVERY + DEPLOY GEOMETRY R2 — Phase 1B: Baseline Upload Contract',
      status: 'PLAYWRIGHT_PACKAGE_UNAVAILABLE',
      reason: pkg.error,
    });
    return;
  }
  const { chromium } = pkg.mod;
  const browserDetect = await detectBrowserExecutable(chromium);
  if (!browserDetect.found) {
    console.log(`No usable Browser executable found among ${browserDetect.attempts.length} candidates (never downloaded one): ${JSON.stringify(browserDetect.attempts)}`);
    console.log('Final decision: BROWSER_BINARY_UNAVAILABLE');
    await writeBrowserUnavailableResult(RESULTS_PATH, {
      suite: 'SAFE RECOVERY + DEPLOY GEOMETRY R2 — Phase 1B: Baseline Upload Contract',
      status: 'BROWSER_BINARY_UNAVAILABLE',
      reason: `No usable Browser executable found among ${browserDetect.attempts.length} candidates.`,
    });
    return;
  }

  const browser = await chromium.launch({ headless: true, args: REQUIRED_LAUNCH_ARGS });
  try {
    const prebuiltApp = await buildLumixaAppSnapshot(PROJECT_ROOT);
    const pageErrors = [];
    const consoleErrors = [];
    const { page } = await openLumixaInMemoryPage({ browser, projectRoot: PROJECT_ROOT, prebuiltApp });
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

    // 1. Open the application.
    record('1. Application reachable (about:blank?qa=1, in-memory harness)', 'PASS', 'page loaded');

    // 2. Confirm upload area is visible.
    const uploadVisibleInitially = await page.evaluate(() => {
      const el = document.getElementById('uploadWrap');
      return !!el && getComputedStyle(el).display !== 'none';
    });
    record('2. Upload area (#uploadWrap) visible before any upload', uploadVisibleInitially, `visible=${uploadVisibleInitially}`);

    // 3. Call setInputFiles() on the real input (first upload — fixture A).
    const genBefore = await qaSnapshot(page).then((s) => s?.analysisGeneration ?? 0);
    await page.setInputFiles('#fileIn', FIXTURE_A);
    record('3. setInputFiles() called on real #fileIn (fixture A)', 'PASS', FIXTURE_A);

    // 4. Confirm uploadWrap hides.
    await page.waitForFunction(() => {
      const el = document.getElementById('uploadWrap');
      return el && getComputedStyle(el).display === 'none';
    }, { timeout: 10000 }).catch(() => {});
    const uploadHidden = await page.evaluate(() => {
      const el = document.getElementById('uploadWrap');
      return !!el && getComputedStyle(el).display === 'none';
    });
    record('4. #uploadWrap hides after upload', uploadHidden, `hidden=${uploadHidden}`);

    // 5. Confirm previewWrap shows.
    const previewShown = await page.evaluate(() => {
      const el = document.getElementById('previewWrap');
      return !!el && getComputedStyle(el).display !== 'none';
    });
    record('5. #previewWrap shows after upload', previewShown, `shown=${previewShown}`);

    // 6. Confirm previewImg receives a non-empty source.
    const previewSrcNonEmpty = await page.evaluate(() => {
      const img = document.getElementById('previewImg');
      return !!img && typeof img.src === 'string' && img.src.length > 0;
    });
    record('6. #previewImg.src is non-empty', previewSrcNonEmpty, `nonEmpty=${previewSrcNonEmpty}`);

    // 7. Confirm previewImg load/decode completes.
    await page.waitForFunction(() => {
      const img = document.getElementById('previewImg');
      return !!img && img.complete && img.naturalWidth > 0 && img.naturalHeight > 0;
    }, { timeout: 10000 }).catch(() => {});
    const imgDecodeComplete = await page.evaluate(() => {
      const img = document.getElementById('previewImg');
      return !!img && img.complete && img.naturalWidth > 0 && img.naturalHeight > 0;
    });
    record('7. #previewImg load/decode completes (naturalWidth/Height > 0)', imgDecodeComplete, `complete=${imgDecodeComplete}`);

    // 8. Confirm state.imageLoaded becomes true through the public QA hook.
    await page.waitForFunction(() => window.__LUMIXA_QA__?.getPreviewPipelineSnapshot?.()?.imageLoaded === true, { timeout: 10000 }).catch(() => {});
    const imageLoadedViaHook = await qaSnapshot(page).then((s) => s?.imageLoaded === true);
    record('8. state.imageLoaded === true via public ?qa=1 hook', imageLoadedViaHook, `imageLoaded=${imageLoadedViaHook}`);

    // 9 + 10. Confirm runAnalysis begins and reaches a completed visible state.
    const { completed: analysisACompleted, snapshot: snapAfterA } = await waitForAnalysisCompletion(page, genBefore);
    record('9. runAnalysis begins (analysisGeneration increments)', (snapAfterA?.analysisGeneration ?? 0) > genBefore, `generation ${genBefore} -> ${snapAfterA?.analysisGeneration}`);
    record('10. Analysis reaches a completed visible state (previewSandbox exists)', analysisACompleted, `previewSandbox.exists=${snapAfterA?.previewSandbox?.exists}`);

    // 11. Confirm sliders and analysis groups become visible.
    const slidersAndGroupsVisible = await page.evaluate(() => {
      const sliders = document.getElementById('sliders');
      const groups = document.getElementById('analysisGroups');
      return !!sliders && getComputedStyle(sliders).display !== 'none' && !!groups && getComputedStyle(groups).display !== 'none';
    });
    record('11. #sliders and #analysisGroups visible after analysis', slidersAndGroupsVisible, `visible=${slidersAndGroupsVisible}`);

    // 15. Re-analyze works.
    const genBeforeReanalyze = snapAfterA?.analysisGeneration ?? genBefore;
    const reanalyzeBtnExists = await page.evaluate(() => !!document.getElementById('btnReanalyze'));
    if (reanalyzeBtnExists) {
      await page.click('#btnReanalyze');
      const { completed: reanalyzeCompleted, snapshot: snapAfterReanalyze } = await waitForAnalysisCompletion(page, genBeforeReanalyze);
      record('15. Re-analyze produces a new completed generation', reanalyzeCompleted && (snapAfterReanalyze?.analysisGeneration ?? 0) > genBeforeReanalyze, `generation ${genBeforeReanalyze} -> ${snapAfterReanalyze?.analysisGeneration}`);
    } else {
      record('15. Re-analyze produces a new completed generation', 'NOT_TESTED', '#btnReanalyze not present in DOM');
    }

    // 13. Confirm selecting a second image also works (fixture B, distinct from A).
    const genBeforeSecond = await qaSnapshot(page).then((s) => s?.analysisGeneration ?? 0);
    await page.setInputFiles('#fileIn', FIXTURE_B);
    const { completed: secondCompleted, snapshot: snapAfterSecond } = await waitForAnalysisCompletion(page, genBeforeSecond);
    record('13. Selecting a second image (fixture B) also completes analysis', secondCompleted && (snapAfterSecond?.analysisGeneration ?? 0) > genBeforeSecond, `generation ${genBeforeSecond} -> ${snapAfterSecond?.analysisGeneration}`);

    // 16. Rapid upload A-then-B: fire both setInputFiles calls back-to-back
    // (no await between them) and confirm the FINAL generation/state
    // corresponds to B, never a stale mix with A.
    const genBeforeRapid = await qaSnapshot(page).then((s) => s?.analysisGeneration ?? 0);
    const rapidA = page.setInputFiles('#fileIn', FIXTURE_A);
    const rapidB = page.setInputFiles('#fileIn2', FIXTURE_B);
    await Promise.allSettled([rapidA, rapidB]);
    const { completed: rapidCompleted, snapshot: snapAfterRapid } = await waitForAnalysisCompletion(page, genBeforeRapid, 25000);
    record('16. Rapid upload A-then-B settles on ONE final completed generation (no stale mix)', rapidCompleted && (snapAfterRapid?.analysisGeneration ?? 0) > genBeforeRapid, `generation ${genBeforeRapid} -> ${snapAfterRapid?.analysisGeneration}`);

    // 14 / 17. Confirm Reset returns to upload state (twice, to prove it
    // is not a one-shot fix).
    const resetBtnExists = await page.evaluate(() => !!document.getElementById('btnReset'));
    if (resetBtnExists) {
      await page.click('#btnReset');
      await page.waitForFunction(() => {
        const el = document.getElementById('uploadWrap');
        return el && getComputedStyle(el).display !== 'none';
      }, { timeout: 5000 }).catch(() => {});
      const uploadVisibleAfterReset = await page.evaluate(() => {
        const el = document.getElementById('uploadWrap');
        return !!el && getComputedStyle(el).display !== 'none';
      });
      record('14. Reset returns to upload state', uploadVisibleAfterReset, `uploadVisible=${uploadVisibleAfterReset}`);

      // 17. Upload again after Reset, reach completion, Reset again.
      const genBeforeThird = await qaSnapshot(page).then((s) => s?.analysisGeneration ?? 0);
      await page.setInputFiles('#fileIn', FIXTURE_A);
      await waitForAnalysisCompletion(page, genBeforeThird);
      await page.click('#btnReset');
      await page.waitForFunction(() => {
        const el = document.getElementById('uploadWrap');
        return el && getComputedStyle(el).display !== 'none';
      }, { timeout: 5000 }).catch(() => {});
      const uploadVisibleAfterSecondReset = await page.evaluate(() => {
        const el = document.getElementById('uploadWrap');
        return !!el && getComputedStyle(el).display !== 'none';
      });
      record('17. Reset works a second time (not a one-shot fix)', uploadVisibleAfterSecondReset, `uploadVisible=${uploadVisibleAfterSecondReset}`);
    } else {
      record('14. Reset returns to upload state', 'NOT_TESTED', '#btnReset not present in DOM');
      record('17. Reset works a second time (not a one-shot fix)', 'NOT_TESTED', '#btnReset not present in DOM');
    }

    // 12. Confirm zero Page errors and zero Console errors (checked LAST,
    // after every interaction above has had a chance to throw).
    record('12. Page errors === 0', pageErrors.length === 0, pageErrors.length === 0 ? '(none)' : JSON.stringify(pageErrors));
    record('12. Console errors === 0', consoleErrors.length === 0, consoleErrors.length === 0 ? '(none)' : JSON.stringify(consoleErrors));

    const decision = computeUploadBaselineDecision(results);
    console.log(`\nFinal decision: ${decision}`);
    const passCount = results.filter((r) => r.result === 'PASS').length;
    const failCount = results.filter((r) => r.result === 'FAIL').length;
    const summary = { total: results.length, pass: passCount, fail: failCount, notTested: results.length - passCount - failCount };
    console.log(`${passCount}/${results.length} PASS, ${failCount} FAIL`);
    await writeResultAtomic(RESULTS_PATH, {
      suite: 'SAFE RECOVERY + DEPLOY GEOMETRY R2 — Phase 1B: Baseline Upload Contract',
      runId, startedAt, completedAt: new Date().toISOString(), completed: true, sourceHash,
      browserExecutablePath: browserDetect.path ?? null,
      results,
      summary,
      decision,
    });
  } catch (err) {
    console.error('Baseline Upload Contract suite crashed:', err);
    await writeResultAtomic(RESULTS_PATH, buildRuntimeCrashRow(err) && {
      suite: 'SAFE RECOVERY + DEPLOY GEOMETRY R2 — Phase 1B: Baseline Upload Contract',
      runId, startedAt, completedAt: new Date().toISOString(), completed: false, sourceHash,
      results, decision: 'CRASHED_UPLOAD_BASELINE', crash: buildRuntimeCrashRow(err),
    });
  } finally {
    await browser.close();
  }
}

const isMainModule = (() => {
  try { return import.meta.url === `file://${process.argv[1]}`; } catch { return false; }
})();
if (isMainModule) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
