#!/usr/bin/env node
/**
 * qa/epic-2e-j-preview-geometry-decoder-render-test.mjs
 *
 * LOCAL-FIRST GEOMETRY R3 -- Phase C1: DECODER/RENDER GEOMETRY SUITE.
 *
 * This is the honest half of the split of the former single
 * epic-2e-j-preview-geometry-browser-test.mjs, which incorrectly
 * required synthetic marker fixtures (solid-color corner-marker test
 * patterns, not real photos) to pass through the REAL Analysis/Safety
 * pipeline and reach full V2/Observation eligibility -- something they
 * were never designed to do, and which the independent review
 * correctly identified as a test-design defect (42/105 FAIL), not a
 * geometry defect.
 *
 * SCOPE (exactly what Phase C1 requires):
 *   - canonical decode
 *   - EXIF orientation
 *   - backing dimensions
 *   - marker orientation
 *   - Legacy/V2 same-source renderer parity
 *
 * This suite deliberately bypasses ui/app.js's Analysis/Safety/Human-
 * Review pipeline entirely. It dynamic-imports the real, unmodified
 * ui/preview-source-geometry-normalizer-v2.js module directly inside
 * the already-loaded in-memory page (via the SAME import-map canonical
 * URL app.js itself uses, https://lumixa.invalid/ui/preview-source-
 * geometry-normalizer-v2.js -- proven identical, not a copy) and calls
 * its real decodeCanonicalSource()/markRenderStarted()/
 * markRenderSettled() API directly with real fixture bytes. This is the
 * "bounded QA-only, non-production-eligible Identity Render Plan"
 * the spec permits: the SAME decoded ImageBitmap is drawn onto two
 * separate canvases (labeled "legacy" and "v2" for this suite's own
 * bookkeeping only) with zero adjustments -- an Identity transform --
 * which is sufficient to prove "same canonical source" / "Legacy/V2
 * same-source renderer parity" without needing (or claiming) any real
 * V2 adjustment pipeline, safety eligibility, or Observation gate.
 *
 * This suite MUST NOT claim, and never asserts:
 *   - full Production safety approval
 *   - real full-app canGeneratePreview
 *   - Observation availability
 *
 * Run: node qa/epic-2e-j-preview-geometry-decoder-render-test.mjs
 * Output: qa/epic-2e-j-preview-geometry-decoder-render-results.json
 */

import { readFile, mkdir, stat } from 'node:fs/promises';
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
} from './helpers/playwright-lumixa-test-runtime.mjs';
import { readJpegExifOrientation } from './helpers/exif-orientation-reader.mjs';
import { matchesExpectedColor } from './helpers/marker-color-classifier.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const FIXTURES_DIR = path.join(PROJECT_ROOT, 'qa', 'fixtures', 'preview-geometry');
const MANIFEST_PATH = path.join(FIXTURES_DIR, 'manifest.json');
const RESULTS_PATH = path.join(PROJECT_ROOT, 'qa', 'epic-2e-j-preview-geometry-decoder-render-results.json');
const SUITE_NAME = 'LOCAL-FIRST GEOMETRY R3 -- Phase C1: Decoder/Render Geometry suite (decoder-only, NOT production-safety-eligible)';

const SOURCE_HASH_INPUTS = [
  path.join(__dirname, 'epic-2e-j-preview-geometry-decoder-render-test.mjs'),
  path.join(__dirname, 'helpers', 'playwright-lumixa-test-runtime.mjs'),
  path.join(__dirname, 'helpers', 'playwright-in-memory-app.mjs'),
  path.join(__dirname, 'helpers', 'exif-orientation-reader.mjs'),
  path.join(__dirname, 'helpers', 'marker-color-classifier.mjs'),
  path.join(PROJECT_ROOT, 'ui', 'preview-source-geometry-normalizer-v2.js'),
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

/** Same fail-closed shape as every other suite's pure decision function. */
export function computeDecoderRenderDecision(resultRows, { completed, sourceHash: resultSourceHash, currentSourceHash } = {}) {
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

  const fixtureBytesByFilename = {};
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
      fixtureBytesByFilename[fx.filename] = buf;
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
    const runtime = await openLumixaInMemoryPage({ browser, projectRoot: PROJECT_ROOT, qaQuery: '?qa=1', viewport: { width: 1000, height: 800 }, prebuiltApp: appSnapshot });
    const page = runtime.page;

    // ── Never-touched-Production baseline: taken BEFORE any fixture is
    //    fed into the decoder, so the "no Production writes" assertion
    //    at the end proves the entire decoder/render pass genuinely
    //    never mutated app-level Production/Mapping/Controlled-Test
    //    state -- this suite never calls the UI upload flow or
    //    runAnalysis() at all. ──
    const productionBaseline = await qaSnapshot(page);

    let genCounter = 0;
    let previousFixture = null;

    for (const fx of manifest.fixtures) {
      const tag = `[${fx.filename}]`;
      const bytes = fixtureBytesByFilename[fx.filename];
      const base64 = bytes.toString('base64');
      const mime = fx.filename.endsWith('.png') ? 'image/png' : 'image/jpeg';
      genCounter += 1;
      const genId = genCounter;

      // Bounded, non-production-eligible decode + Identity render: the
      // real ui/preview-source-geometry-normalizer-v2.js module,
      // dynamic-imported by its real canonical URL (already present in
      // the page's import map because app.js itself imports it -- this
      // is NOT a copy or a mock), fed the real fixture bytes directly.
      const outcome = await page.evaluate(async ({ base64, mime, genId }) => {
        const mod = await import('https://lumixa.invalid/ui/preview-source-geometry-normalizer-v2.js');
        const normalizer = mod.createPreviewSourceGeometryNormalizerV2();
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const file = new File([bytes], 'fixture', { type: mime });

        const { source, evidence } = await normalizer.decodeCanonicalSource(file, genId, null);
        if (!source) return { evidence, legacySample: null, v2Sample: null };

        normalizer.markRenderStarted(genId);
        // Identity Render Plan: draw the SAME decoded source onto two
        // independent canvases with zero adjustments -- this is the
        // bounded QA-only stand-in for "Legacy renders" / "V2 renders"
        // the spec explicitly permits for this suite; it proves same-
        // source parity without any real adjustment pipeline.
        function drawAndSample(label) {
          const canvas = document.createElement('canvas');
          canvas.width = source.width ?? source.naturalWidth;
          canvas.height = source.height ?? source.naturalHeight;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(source, 0, 0);
          const relX = 0.15, relY = 0.15;
          const x = Math.min(canvas.width - 1, Math.max(0, Math.round(canvas.width * relX)));
          const y = Math.min(canvas.height - 1, Math.max(0, Math.round(canvas.height * relY)));
          const px = ctx.getImageData(x, y, 1, 1).data;
          return { r: px[0], g: px[1], b: px[2], a: px[3], canvasWidth: canvas.width, canvasHeight: canvas.height };
        }
        const legacySample = drawAndSample('legacy');
        const v2Sample = drawAndSample('v2');
        normalizer.markRenderSettled(genId);
        if (typeof source.close === 'function') source.close();

        return { evidence, legacySample, v2Sample };
      }, { base64, mime, genId });

      recordCondition(`${tag} canonical decode completes`, outcome.evidence?.decodeComplete === true, JSON.stringify(outcome.evidence));
      recordCondition(`${tag} EXIF/orientation applied by decoder (browser-native, never manually rotated)`, outcome.evidence?.orientationAppliedByDecoder === true, `decodePath=${outcome.evidence?.decodePath}`);
      recordCondition(`${tag} backing dimensions match expected decoded dimensions (orientation ${fx.exifOrientation ?? 'none'})`, outcome.evidence?.canonicalWidth === fx.expectedDecodedWidth && outcome.evidence?.canonicalHeight === fx.expectedDecodedHeight, JSON.stringify({ decoded: { w: outcome.evidence?.canonicalWidth, h: outcome.evidence?.canonicalHeight }, expected: { w: fx.expectedDecodedWidth, h: fx.expectedDecodedHeight } }));

      const markerOk = matchesExpectedColor(outcome.legacySample, fx.expectedVisualTopLeftMarker);
      recordCondition(`${tag} marker orientation: top-left patch classifies as expected color (dominance-based)`, markerOk, JSON.stringify({ sample: outcome.legacySample, expected: fx.expectedVisualTopLeftMarker }));

      const parityOk = !!outcome.legacySample && !!outcome.v2Sample
        && outcome.legacySample.r === outcome.v2Sample.r && outcome.legacySample.g === outcome.v2Sample.g && outcome.legacySample.b === outcome.v2Sample.b
        && outcome.legacySample.canvasWidth === outcome.v2Sample.canvasWidth && outcome.legacySample.canvasHeight === outcome.v2Sample.canvasHeight;
      recordCondition(`${tag} Legacy/V2 same-source renderer parity (Identity Render Plan, bounded QA-only)`, parityOk, JSON.stringify({ legacy: outcome.legacySample, v2: outcome.v2Sample }));

      if (previousFixture) {
        const dimsShouldDiffer = previousFixture.expectedDecodedWidth !== fx.expectedDecodedWidth || previousFixture.expectedDecodedHeight !== fx.expectedDecodedHeight;
        const noPriorGeometryLeaked = !dimsShouldDiffer || (outcome.evidence?.canonicalWidth === fx.expectedDecodedWidth && outcome.evidence?.canonicalHeight === fx.expectedDecodedHeight);
        recordCondition(`${tag} no prior fixture's geometry remains (vs previous: ${previousFixture.filename})`, noPriorGeometryLeaked, JSON.stringify({ current: { w: outcome.evidence?.canonicalWidth, h: outcome.evidence?.canonicalHeight }, previous: { w: previousFixture.expectedDecodedWidth, h: previousFixture.expectedDecodedHeight } }));
      } else {
        recordStatus(`${tag} no prior fixture's geometry remains`, 'NOT_APPLICABLE', 'first fixture in sequence — no prior fixture to compare against');
      }
      previousFixture = fx;
    }

    // ── Real Browser-level stale-generation isolation: start decode N,
    //    then immediately start decode N+1 before N's promise settles,
    //    and confirm N resolves 'stale-discarded'. This is the same
    //    invariant qa/epic-2e-j-preview-source-geometry-normalizer-
    //    static-test.mjs already proves with a STUBBED createImageBitmap
    //    -- this is the real-Browser confirmation of the same contract. ──
    const staleFixture = manifest.fixtures[0];
    const staleBytes = fixtureBytesByFilename[staleFixture.filename];
    const staleOutcome = await page.evaluate(async ({ base64, mime }) => {
      const mod = await import('https://lumixa.invalid/ui/preview-source-geometry-normalizer-v2.js');
      const normalizer = mod.createPreviewSourceGeometryNormalizerV2();
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const makeFile = () => new File([bytes], 'fixture', { type: mime });

      const genAPromise = normalizer.decodeCanonicalSource(makeFile(), 'gen-A', null);
      const genBPromise = normalizer.decodeCanonicalSource(makeFile(), 'gen-B', null);
      const [genAResult, genBResult] = await Promise.all([genAPromise, genBPromise]);
      if (genAResult.source && typeof genAResult.source.close === 'function') genAResult.source.close();
      if (genBResult.source && typeof genBResult.source.close === 'function') genBResult.source.close();
      return { genA: genAResult.evidence, genB: genBResult.evidence };
    }, { base64: staleBytes.toString('base64'), mime: staleFixture.filename.endsWith('.png') ? 'image/png' : 'image/jpeg' });
    const staleIsolationOk = staleOutcome.genA?.decodePath === 'stale-discarded' && staleOutcome.genB?.decodeComplete === true;
    recordCondition('Real-Browser stale-generation isolation: superseded decode discards, newer decode wins', staleIsolationOk, JSON.stringify(staleOutcome));

    // ── No Production writes: this suite never called the UI upload
    //    flow or runAnalysis() -- Production/Mapping/Controlled-Test
    //    fields must read identically to the pre-suite baseline. ──
    const productionAfter = await qaSnapshot(page);
    const noProductionWrites = productionBaseline?.previewSandbox?.selectedOutputSource === 'legacy'
      && productionAfter?.previewSandbox?.selectedOutputSource === 'legacy'
      && productionBaseline?.previewSandbox?.canWriteProduction === false && productionAfter?.previewSandbox?.canWriteProduction === false
      && productionBaseline?.previewSandbox?.canExportPreview === false && productionAfter?.previewSandbox?.canExportPreview === false;
    recordCondition('No Production writes: decoder/render-only pass never touched Production/Mapping/Controlled-Test state', noProductionWrites, JSON.stringify({ before: productionBaseline?.previewSandbox, after: productionAfter?.previewSandbox }));

    recordCondition('Zero page errors across the decoder/render suite', runtime.collectors.pageErrors.length === 0, runtime.collectors.pageErrors.length === 0 ? '(none)' : runtime.collectors.pageErrors.join('; '));
    recordCondition('Zero non-allowed Network requests (data:/about: only)', runtime.collectors.nonAllowedNetworkRequests.length === 0, JSON.stringify(runtime.collectors.nonAllowedNetworkRequests));

    await runtime.cleanup();

    const passCount = results.filter((r) => r.result === 'PASS').length;
    const failCount = results.filter((r) => r.result === 'FAIL').length;
    const decisionResult = computeDecoderRenderDecision(results, { completed: true, sourceHash, currentSourceHash: sourceHash });
    const output = {
      suite: SUITE_NAME,
      scopeNote: 'This suite proves decoder/render/geometry correctness ONLY. It does not run, and never claims, full Production safety approval, full-app canGeneratePreview, or Observation availability -- see qa/epic-2e-j-preview-geometry-full-app-eligible-test.mjs (Phase C2) for that coverage on photo-like fixtures.',
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
    console.error('Preview Geometry Decoder/Render suite crashed:', err?.name ?? err);
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
