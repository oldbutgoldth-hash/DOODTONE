#!/usr/bin/env node
/**
 * qa/epic-2e-j-controlled-v2-browser-test.mjs
 *
 * CONTROLLED V2 VISUAL TRANSLATION R1 — Phase K (Browser half).
 *
 * Drives the REAL, complete app pipeline — real upload, real Analysis,
 * real Human Review (6 manual visual items + 4 system-verified items,
 * per Phase G), the real guided "Build Controlled V2 Preview" button
 * (Phase H), and the real Controlled V2 translator (Phases A-F) — for
 * 5 distinct photo-like fixture "flavors":
 *   1. portrait/photo-like ready   — qa/fixtures/epic-2e-j/ready/ready-portrait-orientation-1.jpg
 *   2. neutral-balanced baseline   — qa/fixtures/epic-2e-j/neutral-balanced.png
 *   3. warm / skin+WB risk         — qa/fixtures/epic-2e-j/warm-portrait-synthetic.png
 *   4. cool / shadow+WB risk       — qa/fixtures/epic-2e-j/cool-shadow-synthetic.png
 *   5. highlight/shadow + detail   — qa/fixtures/epic-2e-j/highlight-shadow-range.png
 *
 * For EACH fixture this proves: upload+Analysis completes; all 4
 * system-verified review items are auto-passed with ZERO manual clicks
 * (proving Phase G's core guarantee end-to-end); the 6 manual visual
 * items can be completed; reviewGuidance.readyToBuildV2 becomes true;
 * the "Build Controlled V2 Preview" button (not merely a generic
 * Re-analyze) produces a fresh generation; the resulting
 * translationMode is honestly either 'legacy-derived-safety-restraint'
 * or 'identity-fallback' (never anything else, never fabricated); V2
 * renders (or a truthful Identity Preview); Exact dimensions; the
 * Interactive Before/After reaches ready; Observation is enabled; 0
 * unexpected page/console errors; exported XMP is byte-identical
 * before and after; Production Mapping remains Legacy throughout.
 *
 * Per the spec's REQUIRED cross-fixture assertion: at least 2 of the 5
 * fixtures must produce translationMode==='legacy-derived-safety-
 * restraint' with visualizedAdjustmentCount>0 — a genuinely meaningful
 * (non-Identity) Controlled V2 preview. If fewer than 2 do, this is
 * treated as a genuine FAIL of this suite (a fixture-design or
 * translator defect), never silently accepted or loosened.
 *
 * Consistent with every other Browser suite in this project: if
 * Playwright/Chromium is unavailable in the current environment, this
 * suite honestly reports BROWSER_BINARY_UNAVAILABLE (exit 0, per the
 * project's established "environment-unavailable is not a suite
 * failure" convention) rather than fabricating results.
 *
 * Run: node qa/epic-2e-j-controlled-v2-browser-test.mjs
 * Output: qa/epic-2e-j-controlled-v2-browser-results.json
 */

import { readFile, stat } from 'node:fs/promises';
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const FIXTURES_ROOT = path.join(PROJECT_ROOT, 'qa', 'fixtures', 'epic-2e-j');
const RESULTS_PATH = path.join(PROJECT_ROOT, 'qa', 'epic-2e-j-controlled-v2-browser-results.json');
const SUITE_NAME = 'CONTROLLED V2 VISUAL TRANSLATION R1 — Phase K: Controlled V2 Browser suite';

const FIXTURES = [
  { label: 'portrait-photo-like-ready', file: path.join(FIXTURES_ROOT, 'ready', 'ready-portrait-orientation-1.jpg') },
  { label: 'neutral-balanced', file: path.join(FIXTURES_ROOT, 'neutral-balanced.png') },
  { label: 'warm-skin-wb-risk', file: path.join(FIXTURES_ROOT, 'warm-portrait-synthetic.png') },
  { label: 'cool-shadow-wb-risk', file: path.join(FIXTURES_ROOT, 'cool-shadow-synthetic.png') },
  { label: 'highlight-shadow-detail-risk', file: path.join(FIXTURES_ROOT, 'highlight-shadow-range.png') },
];

const SOURCE_HASH_INPUTS = [
  path.join(__dirname, 'epic-2e-j-controlled-v2-browser-test.mjs'),
  path.join(__dirname, 'helpers', 'playwright-lumixa-test-runtime.mjs'),
  path.join(PROJECT_ROOT, 'ui', 'app.js'),
  path.join(PROJECT_ROOT, 'ui', 'review-console-renderer.js'),
  path.join(PROJECT_ROOT, 'core', 'lightroom-mapping-engine', 'mapping-v2-preview-review-state.js'),
  path.join(PROJECT_ROOT, 'core', 'lightroom-mapping-engine', 'mapping-v2-overlay-preview-sandbox.js'),
  path.join(PROJECT_ROOT, 'core', 'preview-rendering', 'controlled-v2-preview-adjustment-translator.js'),
  path.join(PROJECT_ROOT, 'core', 'preview-rendering', 'visual-preview-render-plan-v2.js'),
  ...FIXTURES.map((f) => f.file),
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

export function computeControlledV2BrowserDecision(resultRows, { completed, meaningfulCount, sourceHash: resultSourceHash, currentSourceHash } = {}) {
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
  if (typeof meaningfulCount === 'number' && meaningfulCount < 2) reasons.push(`MEANINGFUL_TRANSLATION_COUNT_BELOW_2=${meaningfulCount}`);
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

/** Clicks #btnBuildControlledV2 and waits for it to genuinely re-enable (processing finished) before returning. */
async function clickBuildControlledV2AndWait(page, priorGeneration, maxWaitMs = 25000) {
  const clicked = await page.evaluate(() => {
    const btn = document.getElementById('btnBuildControlledV2');
    if (!btn || btn.disabled) return false;
    btn.click();
    return true;
  });
  if (!clicked) return { clicked: false, completed: false, snapshot: null };
  const outcome = await waitForAnalysisCompletion(page, priorGeneration, maxWaitMs);
  return { clicked: true, ...outcome };
}

async function main() {
  runId = generateRunId();
  startedAt = new Date().toISOString();
  sourceHash = await computeSourceHash(SOURCE_HASH_INPUTS);

  for (const fx of FIXTURES) {
    try {
      const st = await stat(fx.file);
      if (!st.isFile()) throw new Error('not a regular file');
    } catch (e) {
      await writeBrowserUnavailableResult(RESULTS_PATH, { suite: SUITE_NAME, status: 'FIXTURE_MISSING', reason: `${fx.label} (${fx.file}): ${e.message}` });
      console.log('Final decision: FIXTURE_MISSING');
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
  let meaningfulCount = 0;
  let completed = false;

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

    for (const fx of FIXTURES) {
      const tag = `[${fx.label}]`;

      const genBeforeUpload = priorGeneration;
      await page.setInputFiles('#fileIn', fx.file);
      const initialAnalysis = await waitForAnalysisCompletion(page, genBeforeUpload, 25000);
      recordCondition(`${tag} Upload + initial Analysis completes`, initialAnalysis.completed === true, JSON.stringify(initialAnalysis.snapshot?.previewSandbox ?? {}));
      priorGeneration = initialAnalysis.snapshot?.analysisGeneration ?? genBeforeUpload;

      // Phase G proof: the 4 system-verified items must ALREADY be
      // fully verified before any manual review click happens at all.
      let snap = await qaSnapshot(page);
      const guidanceBeforeManualReview = snap?.reviewGuidance ?? null;
      recordCondition(`${tag} All 4 system-verified review items auto-pass with ZERO manual clicks`, guidanceBeforeManualReview?.systemRequired === 4 && guidanceBeforeManualReview?.systemVerified === 4, JSON.stringify(guidanceBeforeManualReview));

      // Complete the 6 manual visual items (passAllReviewItems is a
      // safe no-op for the 4 system items, which render no Pass button).
      const passedCount = await passAllReviewItems(page);
      await page.waitForTimeout(150);
      snap = await qaSnapshot(page);
      const guidanceAfterManualReview = snap?.reviewGuidance ?? null;
      recordCondition(`${tag} All 6 visual review items are completable and readyToBuildV2 becomes true`, guidanceAfterManualReview?.visualPassed === 6 && guidanceAfterManualReview?.readyToBuildV2 === true, `passedCount=${passedCount}, guidance=${JSON.stringify(guidanceAfterManualReview)}`);

      const xmpBefore = await captureXmpText(page);

      // The actual Phase H button — never a bare Re-analyze call.
      const buildOutcome = await clickBuildControlledV2AndWait(page, priorGeneration, 25000);
      recordCondition(`${tag} "Build Controlled V2 Preview" button is clickable and produces a new generation`, buildOutcome.clicked === true && buildOutcome.completed === true, JSON.stringify({ clicked: buildOutcome.clicked, completed: buildOutcome.completed }));
      priorGeneration = buildOutcome.snapshot?.analysisGeneration ?? priorGeneration;

      let finalSnap = buildOutcome.snapshot;
      const pollStart = Date.now();
      while (Date.now() - pollStart < 15000) {
        finalSnap = await qaSnapshot(page);
        const settled = finalSnap?.visualPreview?.legacyState !== undefined
          && (finalSnap?.interactive?.state === 'ready' || finalSnap?.interactive?.state === 'blocked' || finalSnap?.interactive?.state === 'partial' || finalSnap?.interactive?.state === 'failed');
        if (settled) break;
        await page.waitForTimeout(250);
      }

      const translation = finalSnap?.controlledV2Translation ?? null;
      const mode = translation?.mode;
      const isHonestMode = mode === 'legacy-derived-safety-restraint' || mode === 'identity-fallback';
      recordCondition(`${tag} translationMode is honestly one of the two valid non-blocked values`, isHonestMode, JSON.stringify(translation));
      if (mode === 'legacy-derived-safety-restraint' && (translation?.visualizedAdjustmentCount ?? 0) > 0) meaningfulCount++;

      recordCondition(`${tag} V2 rendered (or truthful Identity)`, finalSnap?.visualPreview?.controlledV2State === 'renderable', `controlledV2State=${finalSnap?.visualPreview?.controlledV2State}`);
      recordCondition(`${tag} Exact dimensions`, finalSnap?.interactive?.alignmentStatus === 'Exact dimensions', `alignmentStatus=${finalSnap?.interactive?.alignmentStatus}`);
      recordCondition(`${tag} Interactive Before/After reaches ready`, finalSnap?.interactive?.state === 'ready', `state=${finalSnap?.interactive?.state}`);
      recordCondition(`${tag} Observation controls enabled`, finalSnap?.observation?.enabled === true, `enabled=${finalSnap?.observation?.enabled}`);
      recordCondition(`${tag} Production Mapping remains Legacy`, finalSnap?.previewSandbox?.selectedOutputSource === 'legacy' && finalSnap?.previewSandbox?.canWriteProduction === false && finalSnap?.previewSandbox?.canExportPreview === false, JSON.stringify({ src: finalSnap?.previewSandbox?.selectedOutputSource, write: finalSnap?.previewSandbox?.canWriteProduction, exp: finalSnap?.previewSandbox?.canExportPreview }));

      const xmpAfter = await captureXmpText(page);
      recordCondition(`${tag} Exported XMP is unchanged by Building the Controlled V2 Preview`, xmpBefore !== null && xmpAfter !== null && sha256(xmpBefore) === sha256(xmpAfter), `beforeHash=${sha256(xmpBefore ?? '')}, afterHash=${sha256(xmpAfter ?? '')}`);
    }

    recordCondition('0 unexpected page errors across all 5 fixtures', pageErrors.length === 0, JSON.stringify(pageErrors));
    recordCondition('0 unexpected console errors across all 5 fixtures', consoleErrors.length === 0, JSON.stringify(consoleErrors));
    recordCondition('At least 2 of 5 fixtures produced a genuinely meaningful (non-Identity) Controlled V2 translation', meaningfulCount >= 2, `meaningfulCount=${meaningfulCount}`);

    completed = true;
    await runtime.cleanup();
  } catch (err) {
    recordStatus('Suite execution', 'FAIL', buildRuntimeCrashRow(err).evidence);
  } finally {
    await browser.close();
  }

  const decision = computeControlledV2BrowserDecision(results, { completed, meaningfulCount, sourceHash, currentSourceHash: sourceHash });
  await writeResultAtomic(RESULTS_PATH, {
    suite: SUITE_NAME, runId, startedAt, completedAt: new Date().toISOString(), completed,
    sourceHash, results, decision: decision.decision, reasons: decision.reasons, meaningfulCount,
  });
  console.log(`\n${results.filter((r) => r.result === 'PASS').length}/${results.length} PASS`);
  console.log(`Final decision: ${decision.decision}${decision.reasons.length ? ' — ' + decision.reasons.join('; ') : ''}`);
  process.exit(decision.decision === 'PASS' ? 0 : 1);
}

main().catch(async (err) => {
  console.error('Suite crashed:', err?.stack ?? err);
  try {
    await writeBrowserUnavailableResult(RESULTS_PATH, { suite: SUITE_NAME, status: 'SUITE_CRASHED', reason: String(err?.message ?? err) });
  } catch { /* best-effort only */ }
  process.exit(1);
});
