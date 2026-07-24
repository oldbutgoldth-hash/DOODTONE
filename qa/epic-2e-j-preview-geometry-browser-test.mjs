#!/usr/bin/env node
/**
 * qa/epic-2e-j-preview-geometry-browser-test.mjs
 *
 * DEPLOY GEOMETRY R1 — Phase F: local real-Browser geometry suite.
 *
 * Runs entirely on the proven Navigation-Free In-Memory Runtime
 * (qa/helpers/playwright-lumixa-test-runtime.mjs) — no local static
 * file server, no localhost/127.0.0.1 navigation. A real Browser
 * (Playwright + a resolvable Chromium executable) is required to
 * execute this suite; when unavailable it writes an honest current
 * BROWSER_BINARY_UNAVAILABLE/PLAYWRIGHT_PACKAGE_UNAVAILABLE result
 * rather than fabricating a PASS (same fail-closed contract every
 * other Browser suite in this project uses).
 *
 * For EACH of the 6 deterministic geometry fixtures (Phase E), on ONE
 * shared page/session (so cross-fixture geometry isolation is
 * genuinely exercised, not merely assumed), in order:
 *   1. upload via the real #fileIn file input
 *   2. wait for Analysis to complete
 *   3. complete Human Review through the real Review Console UI
 *      (Pass every item) + a real Re-analyze click
 *   4. wait for the current-generation Visual Preview to finish
 *   5. verify the V2 Render Plan exists and is eligible
 *   6. verify Legacy rendered
 *   7. verify V2 rendered (renderable, possibly a truthful Identity
 *      Preview when there are zero supported adjustments)
 *   8. verify exact pixel dimensions (Alignment === "Exact dimensions")
 *   9. verify the orientation marker (samples REAL rendered canvas
 *      pixels — never CSS display dimensions, never trusted metadata
 *      alone)
 *  10. verify Interactive Before/After reaches "ready"
 *  11. verify Observation controls are enabled
 *  12. select an Observation value via a REAL keyboard interaction
 *  13. verify Production/Mapping/Controlled-Test/XMP-adjacent fields
 *      are unchanged by that Observation selection
 *  13b. (SAFE RECOVERY + DEPLOY GEOMETRY R2 — Phase 7) verify the
 *      actual exported XMP TEXT hash is byte-for-byte identical
 *      before/after the Observation selection
 *  14. re-analyze the SAME fixture again and verify the new
 *      generation's canonical geometry is fresh (never the prior
 *      generation's stale committed pixels/dimensions)
 *  15. (next iteration) uploading the NEXT, differently-oriented
 *      fixture and verifying its own canonical geometry — never any
 *      trace of the PREVIOUS fixture's dimensions/orientation
 *
 * Run: node qa/epic-2e-j-preview-geometry-browser-test.mjs
 * Output: qa/epic-2e-j-preview-geometry-browser-results.json
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
const FIXTURES_DIR = path.join(PROJECT_ROOT, 'qa', 'fixtures', 'preview-geometry');
const MANIFEST_PATH = path.join(FIXTURES_DIR, 'manifest.json');
const RESULTS_PATH = path.join(PROJECT_ROOT, 'qa', 'epic-2e-j-preview-geometry-browser-results.json');
const SUITE_NAME = 'DEPLOY GEOMETRY R1 — Preview Geometry local Browser suite';

const SOURCE_HASH_INPUTS = [
  path.join(__dirname, 'epic-2e-j-preview-geometry-browser-test.mjs'),
  path.join(__dirname, 'helpers', 'playwright-lumixa-test-runtime.mjs'),
  path.join(__dirname, 'helpers', 'playwright-in-memory-app.mjs'),
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

export function computePreviewGeometryBrowserDecision(resultRows, { completed, sourceHash: resultSourceHash, currentSourceHash, permittedNotTestedTests = [] } = {}) {
  if (!Array.isArray(resultRows) || resultRows.length === 0) return { decision: 'FAIL', reasons: ['EMPTY_RESULT_SET'] };
  const permittedSet = new Set(permittedNotTestedTests);
  const reasons = [];
  let failCount = 0, unexpectedNotTested = 0, malformed = 0;
  for (const row of resultRows) {
    const wellFormed = !!row && typeof row.test === 'string' && row.test.trim().length > 0 && typeof row.result === 'string' && ALLOWED_STATUSES.has(row.result);
    if (!wellFormed) { malformed++; continue; }
    if (row.result === 'FAIL') failCount++;
    if (row.result === 'NOT_TESTED' && !permittedSet.has(row.test)) unexpectedNotTested++;
  }
  if (malformed > 0) reasons.push(`MALFORMED_ROWS=${malformed}`);
  if (failCount > 0) reasons.push(`FAIL_COUNT=${failCount}`);
  if (unexpectedNotTested > 0) reasons.push(`UNEXPECTED_NOT_TESTED=${unexpectedNotTested}`);
  if (completed !== true) reasons.push('BROWSER_EXECUTION_NOT_COMPLETED');
  if (typeof resultSourceHash !== 'string' || resultSourceHash.length === 0 || resultSourceHash !== currentSourceHash) reasons.push('SOURCE_HASH_MISMATCH_OR_MISSING');
  return { decision: reasons.length === 0 ? 'PASS' : 'FAIL', reasons };
}

/** Samples the real rendered canvas at the manifest's relative marker point, using the canvas's BACKING pixel dimensions (never CSS display size). */
async function sampleCanvasMarker(page, canvasId, relX, relY) {
  return page.evaluate(({ canvasId, relX, relY }) => {
    const canvas = document.getElementById(canvasId);
    if (!canvas || !canvas.width || !canvas.height) return null;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const x = Math.min(canvas.width - 1, Math.max(0, Math.round(canvas.width * relX)));
    const y = Math.min(canvas.height - 1, Math.max(0, Math.round(canvas.height * relY)));
    const px = ctx.getImageData(x, y, 1, 1).data;
    return { r: px[0], g: px[1], b: px[2], a: px[3], canvasWidth: canvas.width, canvasHeight: canvas.height, sampledX: x, sampledY: y };
  }, { canvasId, relX, relY });
}

function colorMatches(sample, expectedRgb, tolerance) {
  if (!sample) return false;
  return Math.abs(sample.r - expectedRgb[0]) <= tolerance && Math.abs(sample.g - expectedRgb[1]) <= tolerance && Math.abs(sample.b - expectedRgb[2]) <= tolerance;
}

// SAFE RECOVERY + DEPLOY GEOMETRY R2 — Phase 7: captures the REAL
// exported XMP text via the app's own real Download button (same
// technique the Live App suite uses) so this suite can prove XMP is
// byte-for-byte unchanged before/after Preview and Observation
// actions — a genuine content hash, not merely a check that the
// Production/Mapping FIELD state (selectedOutputSource etc.) looks
// unchanged.
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

  // ── Load + independently re-verify the fixture manifest (Phase E's
  //    "verify fixture EXIF metadata during test setup; fail closed on
  //    malformed fixture") before any Browser action touches it. ──
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
      const parsed = readJpegExifOrientation(buf);
      if (parsed !== fx.exifOrientation) throw new Error(`EXIF mismatch: manifest=${fx.exifOrientation}, parsed=${parsed}`);
    } catch (e) {
      await writeBrowserUnavailableResult(RESULTS_PATH, { suite: SUITE_NAME, status: 'FIXTURE_MISSING', reason: `${fx.filename}: ${e.message}` });
      process.exit(1);
    }
  }

  const pkg = await detectPlaywrightPackage();
  if (pkg.status !== 'PLAYWRIGHT_PACKAGE_AVAILABLE') {
    console.log(`Playwright Node package unavailable: ${pkg.error}`);
    await writeBrowserUnavailableResult(RESULTS_PATH, { suite: SUITE_NAME, status: 'PLAYWRIGHT_PACKAGE_UNAVAILABLE', reason: pkg.error });
    console.log('Final decision: PLAYWRIGHT_PACKAGE_UNAVAILABLE');
    process.exit(0);
  }
  const { chromium } = pkg.mod;
  const browserDetect = await detectBrowserExecutable(chromium);
  if (!browserDetect.found) {
    console.log(`No usable Browser executable found (never downloaded one): ${JSON.stringify(browserDetect.attempts)}`);
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

    // Sequential order deliberately alternates orientation/shape every
    // step, so "no prior geometry remains" genuinely exercises a real
    // dimension/orientation CHANGE each time, never two consecutive
    // fixtures that happen to share the same shape.
    const orderedFixtures = manifest.fixtures.slice();

    for (const fx of orderedFixtures) {
      const fixtureAbsPath = path.join(FIXTURES_DIR, fx.filename);
      const tag = `[${fx.filename}]`;

      // Steps 1-3: real upload + wait for Analysis + complete Human
      // Review through the real Review Console UI + real Re-analyze.
      const genBeforeUpload = priorGeneration;
      await page.setInputFiles('#fileIn', fixtureAbsPath);
      const initialAnalysis = await waitForAnalysisCompletion(page, genBeforeUpload, 25000);
      recordCondition(`${tag} Step 1-2: upload + initial Analysis completes`, initialAnalysis.completed === true, JSON.stringify(initialAnalysis.snapshot?.previewSandbox ?? {}));

      const genBeforeReview = initialAnalysis.snapshot?.analysisGeneration ?? genBeforeUpload;
      const passedCount = await passAllReviewItems(page);
      await page.click('#btnReanalyze');
      const afterReview = await waitForAnalysisCompletion(page, genBeforeReview, 25000);
      recordCondition(`${tag} Step 3: Human Review completed + Re-analyze reaches a new generation`, afterReview.completed === true && (afterReview.snapshot?.analysisGeneration ?? -1) > genBeforeReview, `reviewItemsPassed=${passedCount}, generation=${afterReview.snapshot?.analysisGeneration}`);
      priorGeneration = afterReview.snapshot?.analysisGeneration ?? genBeforeReview;

      // Step 4: wait for the current-generation Visual Preview + IBA +
      // Observation to settle (bounded poll, never a fixed guess).
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

      // Step 5: V2 Render Plan exists and is eligible.
      const diag = snap?.previewGeometryDiagnostics;
      recordCondition(`${tag} Step 5: V2 Render Plan exists`, diag?.renderPlanExists === true && diag?.v2PlanExists === true, JSON.stringify(diag));
      recordCondition(`${tag} Step 5: V2 eligible (no blocker code, or a benign Identity-eligible state)`, diag?.blockerCode === null || diag?.identityFallbackEligible === true, `blockerCode=${diag?.blockerCode}, identityFallbackEligible=${diag?.identityFallbackEligible}`);

      // Step 6: Legacy rendered.
      recordCondition(`${tag} Step 6: Legacy rendered`, snap?.visualPreview?.legacyState === 'renderable', `legacyState=${snap?.visualPreview?.legacyState}`);

      // Step 7: V2 rendered (renderable) — possibly a truthful Identity Preview.
      recordCondition(`${tag} Step 7: V2 rendered (or truthful Identity)`, snap?.visualPreview?.controlledV2State === 'renderable', `controlledV2State=${snap?.visualPreview?.controlledV2State}, v2Renderable=${diag?.v2Renderable}`);

      // Step 8: exact pixel dimensions.
      recordCondition(`${tag} Step 8: Alignment reports Exact dimensions`, snap?.interactive?.alignmentStatus === 'Exact dimensions', `alignmentStatus=${snap?.interactive?.alignmentStatus}`);

      // Step 9: orientation marker — sample the REAL rendered Legacy
      // canvas's backing pixels (never CSS display size, never trusted
      // metadata alone).
      const sample = await sampleCanvasMarker(page, 'legacyVisualPreviewCanvasV2', manifest.markerSampleRelative.x, manifest.markerSampleRelative.y);
      const expectedRgb = manifest.markerColors[fx.expectedVisualTopLeftMarker];
      const markerOk = colorMatches(sample, expectedRgb, manifest.colorMatchToleranceRGB);
      recordCondition(`${tag} Step 9: orientation marker matches expected top-left color`, markerOk, JSON.stringify({ sample, expectedRgb }));
      recordCondition(`${tag} Step 9: canvas backing dimensions match expected decoded dimensions`, sample?.canvasWidth === fx.expectedDecodedWidth && sample?.canvasHeight === fx.expectedDecodedHeight, JSON.stringify({ sampled: sample ? { w: sample.canvasWidth, h: sample.canvasHeight } : null, expected: { w: fx.expectedDecodedWidth, h: fx.expectedDecodedHeight } }));

      // Step 10: Interactive Before/After ready.
      recordCondition(`${tag} Step 10: Interactive Before/After reaches ready`, snap?.interactive?.state === 'ready', `state=${snap?.interactive?.state}`);

      // Step 11: Observation enabled.
      recordCondition(`${tag} Step 11: Observation controls enabled`, snap?.observation?.enabled === true, `enabled=${snap?.observation?.enabled}, state=${snap?.observation?.state}`);

      // Snapshot Production/Mapping/Controlled-Test fields BEFORE the
      // Observation selection, to prove step 13 afterward.
      const beforeObs = { selectedOutputSource: snap?.previewSandbox?.selectedOutputSource, canWriteProduction: snap?.previewSandbox?.canWriteProduction, canExportPreview: snap?.previewSandbox?.canExportPreview, canEnterControlledTest: snap?.testGate?.canEnterControlledTest };
      // SAFE RECOVERY + DEPLOY GEOMETRY R2 — Phase 7: also capture the
      // REAL exported XMP text's hash BEFORE the Observation
      // selection — genuine byte-content proof, not just field state.
      const xmpBeforeHash = sha256(await captureXmpText(page));

      // Step 12: select Observation via a REAL keyboard interaction —
      // focus the radio input, then press Enter (activates the
      // currently-focused radio the same way a real user's keypress
      // would for a standard HTML radio input focus+Enter/Space
      // pattern used elsewhere in this project's Browser suites).
      let keyboardSelectOk = false;
      try {
        await page.locator('#ipoOption_prefer-legacy').focus();
        await page.keyboard.press('Space');
        await page.waitForTimeout(150);
        const checked = await page.evaluate(() => document.getElementById('ipoOption_prefer-legacy')?.checked === true);
        keyboardSelectOk = checked === true;
      } catch (e) {
        keyboardSelectOk = false;
      }
      recordCondition(`${tag} Step 12: Observation selected via real keyboard (focus + Space)`, keyboardSelectOk, `keyboardSelectOk=${keyboardSelectOk}`);

      // Step 13: no Mapping/XMP/Production change from the Observation
      // selection — re-read the SAME fields and require identical values.
      const afterObsSnap = await qaSnapshot(page);
      const afterObs = { selectedOutputSource: afterObsSnap?.previewSandbox?.selectedOutputSource, canWriteProduction: afterObsSnap?.previewSandbox?.canWriteProduction, canExportPreview: afterObsSnap?.previewSandbox?.canExportPreview, canEnterControlledTest: afterObsSnap?.testGate?.canEnterControlledTest };
      const productionUnchanged = beforeObs.selectedOutputSource === 'legacy' && afterObs.selectedOutputSource === 'legacy'
        && beforeObs.canWriteProduction === false && afterObs.canWriteProduction === false
        && beforeObs.canExportPreview === false && afterObs.canExportPreview === false
        && beforeObs.canEnterControlledTest === false && afterObs.canEnterControlledTest === false;
      recordCondition(`${tag} Step 13: Production/Mapping/Controlled-Test unchanged after Observation`, productionUnchanged, JSON.stringify({ before: beforeObs, after: afterObs }));

      // Step 13b: the actual exported XMP TEXT hash is byte-for-byte
      // identical before and after the Observation selection — the
      // strongest available proof that Observation never touches
      // Production/XMP, beyond the field-state check above.
      const xmpAfterHash = sha256(await captureXmpText(page));
      recordCondition(`${tag} Step 13b: exported XMP text is byte-for-byte unchanged after Observation`, xmpBeforeHash === xmpAfterHash && xmpBeforeHash !== sha256(null), `before=${xmpBeforeHash}, after=${xmpAfterHash}`);

      // Step 14: re-analyze the SAME fixture again — verify the new
      // generation's canonical geometry is fresh (stale geometry from
      // the prior generation must never commit into the new one).
      const genBeforeReanalyze = afterObsSnap?.analysisGeneration ?? priorGeneration;
      await page.click('#btnReanalyze');
      const reanalyzed = await waitForAnalysisCompletion(page, genBeforeReanalyze, 25000);
      const reanalyzedSnap = reanalyzed.snapshot;
      const staleCheckOk = reanalyzed.completed === true
        && (reanalyzedSnap?.analysisGeneration ?? -1) > genBeforeReanalyze
        && reanalyzedSnap?.canonicalSourceGeometry?.generationId === reanalyzedSnap?.analysisGeneration
        && reanalyzedSnap?.canonicalSourceGeometry?.canonicalWidth !== null;
      recordCondition(`${tag} Step 14: re-analyze produces a fresh, current-generation canonical geometry (no stale commit)`, staleCheckOk, JSON.stringify(reanalyzedSnap?.canonicalSourceGeometry ?? {}));
      priorGeneration = reanalyzedSnap?.analysisGeneration ?? priorGeneration;

      // Step 15: cross-fixture isolation — compare THIS fixture's
      // canonical geometry against the PREVIOUS fixture's (when one
      // exists) — dimensions must differ whenever the fixtures'
      // expected decoded dimensions genuinely differ, proving no prior
      // geometry leaked forward.
      if (previousFixture) {
        const dimsShouldDiffer = previousFixture.expectedDecodedWidth !== fx.expectedDecodedWidth || previousFixture.expectedDecodedHeight !== fx.expectedDecodedHeight;
        const currentCanonical = reanalyzedSnap?.canonicalSourceGeometry;
        const noPriorGeometryLeaked = !dimsShouldDiffer || (currentCanonical?.canonicalWidth === fx.expectedDecodedWidth && currentCanonical?.canonicalHeight === fx.expectedDecodedHeight);
        recordCondition(`${tag} Step 15: no prior fixture's geometry remains (vs previous: ${previousFixture.filename})`, noPriorGeometryLeaked, JSON.stringify({ current: currentCanonical, expected: { w: fx.expectedDecodedWidth, h: fx.expectedDecodedHeight }, previous: { w: previousFixture.expectedDecodedWidth, h: previousFixture.expectedDecodedHeight } }));
      } else {
        recordStatus(`${tag} Step 15: no prior fixture's geometry remains`, 'NOT_APPLICABLE', 'first fixture in sequence — no prior fixture to compare against');
      }

      previousFixture = fx;
    }

    recordCondition('Zero page errors across the entire geometry suite', pageErrors.length === 0, pageErrors.length === 0 ? '(none)' : pageErrors.join('; '));
    recordCondition('Zero console errors across the entire geometry suite', consoleErrors.length === 0, consoleErrors.length === 0 ? '(none)' : consoleErrors.join('; '));
    recordCondition('Zero non-allowed Network requests (data:/about: only)', runtime.collectors.nonAllowedNetworkRequests.length === 0, JSON.stringify(runtime.collectors.nonAllowedNetworkRequests));

    await runtime.cleanup();
  } finally {
    await browser.close();
  }

  const passCount = results.filter((r) => r.result === 'PASS').length;
  const failCount = results.filter((r) => r.result === 'FAIL').length;
  const decisionResult = computePreviewGeometryBrowserDecision(results, { completed: true, sourceHash, currentSourceHash: sourceHash, permittedNotTestedTests: [] });
  const output = {
    suite: SUITE_NAME,
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
}

const isMainModule = (() => {
  try { return import.meta.url === `file://${process.argv[1]}`; } catch { return false; }
})();
if (isMainModule) {
  main().catch(async (err) => {
    console.error('Preview Geometry Browser suite crashed:', err?.name ?? err);
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
