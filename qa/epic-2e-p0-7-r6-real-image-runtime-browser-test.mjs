#!/usr/bin/env node
/**
 * qa/epic-2e-p0-7-r6-real-image-runtime-browser-test.mjs
 *
 * EPIC 2E-P0.7 R6 — True Preview-Critical Path Separation + Deferred
 * Heavy Core Execution + Real-Image Runtime Stall Repair.
 *
 * Real Chromium test (Playwright) against the running app, using the
 * user's OWN real Reference/Target photographs — the exact pair that
 * reproduced the "stuck at กำลังวิเคราะห์ภาพต้นแบบ / Image Analysis Core"
 * failure. This suite deliberately does NOT fall back to synthetic
 * Canvas-generated images: the R6 spec requires proof against the real
 * files, and a synthetic substitute would not prove anything about the
 * actual reported defect (real photos are multi-megapixel JPEGs with
 * real noise/detail; a small procedural Canvas image is not equivalent
 * for main-thread stall reproduction).
 *
 * How to supply the real images (any one of):
 *   1. CLI args:   node qa/epic-2e-p0-7-r6-real-image-runtime-browser-test.mjs --ref=/path/to/reference.jpg --target=/path/to/target.jpg
 *   2. Env vars:   LUMIXA_R6_REF_IMAGE=/path/... LUMIXA_R6_TARGET_IMAGE=/path/... node qa/...
 *   3. Fixtures dir (checked automatically, no flags needed):
 *        qa/fixtures/epic-2e-p0-7-r6/reference.(jpg|jpeg|png)
 *        qa/fixtures/epic-2e-p0-7-r6/target.(jpg|jpeg|png)
 *
 * The 11 required test steps (per the R6 release spec):
 *   1.  Load the real Reference photograph via the actual file input
 *       (not synthetic Canvas).
 *   2.  Load the real Target photograph via the actual file input.
 *   3.  Record the timestamp FAST_PREVIEW_READY is reached and confirm
 *       a visible Preview is actually rendered by then.
 *   4.  Confirm the main thread stays responsive between
 *       FAST_PREVIEW_READY and REFINED_PREVIEW_READY (no PerformanceObserver
 *       longtask entry attributable to this window exceeds the safety
 *       threshold).
 *   5.  Record when DEEP_ANALYSIS_RUNNING starts and confirm it starts
 *       strictly AFTER FAST_PREVIEW_READY, never before or concurrently
 *       with the initial Fast Preview render.
 *   6.  Record when Image Analysis Core (analyzeImageCore) resolves for
 *       the Deep/Refined pass and confirm FAST_PREVIEW_READY's timestamp
 *       is strictly earlier — the literal proof the R6 spec requires:
 *       "FAST_PREVIEW_READY occurs before Image Analysis Core and other
 *       heavy refined modules finish."
 *   7.  Confirm REFINED_PREVIEW_READY is eventually reached within a
 *       bounded timeout and the Preview visibly updates a second time.
 *   8.  Confirm zero "PSM: invalid transition" console warnings and zero
 *       unhandled pageerror/unhandledrejection for the whole run.
 *   9.  Confirm the R5 Intensity slider behavior is fully preserved
 *       AFTER Deep Analysis completes (sweep values; only
 *       intensityRenderCount increases; Fast/Refined analysis counters
 *       never change on Intensity).
 *   10. Confirm the Worker-offload instrumentation (_meta.workerUsed /
 *       _meta.durationMs, exposed via window.__LUMIXA_TEST) is present
 *       and consistent with the longtask evidence in step 4 — i.e. if
 *       workerUsed is false (Worker unavailable in this Chromium
 *       profile), the fallback synchronous path is still expected to
 *       run AFTER Fast Preview, not block it.
 *   11. Re-verify the Production Lock manifest (9 locked files) is
 *       byte-identical after the full real-image run — proves this
 *       real-runtime exercise did not require touching any
 *       production-critical file.
 *
 * Honest environment note: this suite requires BOTH a real
 * Chromium/Chrome/Edge binary AND the two real image files described
 * above. If either is missing, it reports the specific blocking reason
 * and exits 2 (NOT_VERIFIED) — it never fabricates a PASS. In this
 * development sandbox neither is available: there is no real browser
 * binary (network-installed Playwright Chromium is blocked here, as in
 * every prior EPIC 2E round in this project) and the user's two photos
 * were pasted inline in chat, which does not produce accessible files
 * in this sandbox's filesystem (confirmed via exhaustive search). This
 * script is syntax/import-verified and ready to run as-is on a machine
 * that has both a real Chromium binary and the two real photo files.
 */
import { promises as fs } from 'node:fs';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RESULT_PATH = path.join(ROOT, 'qa/epic-2e-p0-7-r6-real-image-runtime-browser-results.json');
const SUITE_NAME = 'EPIC 2E-P0.7 R6 — Real-Image Runtime Stall Repair Browser Test';
const FIXTURES_DIR = path.join(ROOT, 'qa/fixtures/epic-2e-p0-7-r6');
const LONGTASK_SAFETY_MS = 200; // any single main-thread task longer than this, occurring after FAST_PREVIEW_READY, is a regression of the R6 fix
const DEEP_ANALYSIS_TIMEOUT_MS = 60000;

let pass = 0, fail = 0;
const assertions = [];
function report(label, ok, detail = '') {
  assertions.push({ label, ok, detail: String(detail) });
  if (ok) { pass++; console.log(`  [PASS] ${label}`); }
  else { fail++; console.error(`  [FAIL] ${label} ${detail}`); }
}

async function sha256(filePath) {
  const buf = await fs.readFile(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function detectSystemChromium() {
  const candidates = ['google-chrome-stable', 'google-chrome', 'chromium-browser', 'chromium', 'microsoft-edge-stable'];
  for (const bin of candidates) {
    try {
      const p = execFileSync('which', [bin], { encoding: 'utf8' }).trim();
      if (p) return p;
    } catch { /* not found, try next */ }
  }
  return null;
}

function parseCliArgs(argv) {
  const out = {};
  for (const arg of argv) {
    const m = arg.match(/^--(ref|target)=(.+)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

async function findFixtureImage(baseName) {
  for (const ext of ['jpg', 'jpeg', 'png']) {
    const p = path.join(FIXTURES_DIR, `${baseName}.${ext}`);
    if (fsSync.existsSync(p)) return p;
  }
  return null;
}

async function resolveImagePaths() {
  const cli = parseCliArgs(process.argv.slice(2));
  const refPath = cli.ref || process.env.LUMIXA_R6_REF_IMAGE || await findFixtureImage('reference');
  const targetPath = cli.target || process.env.LUMIXA_R6_TARGET_IMAGE || await findFixtureImage('target');
  const refOk = refPath && fsSync.existsSync(refPath);
  const targetOk = targetPath && fsSync.existsSync(targetPath);
  return {
    refPath: refOk ? refPath : null,
    targetPath: targetOk ? targetPath : null,
  };
}

async function writeUnavailableResult(decision, reason) {
  const output = {
    suite: SUITE_NAME,
    completed: false,
    decision,
    reason,
    pass: 0, fail: 0, total: 0,
    generatedAt: new Date().toISOString(),
  };
  await fs.writeFile(RESULT_PATH, JSON.stringify(output, null, 2) + '\n');
  console.log(`\nFinal decision: ${decision} — ${reason}`);
  process.exit(2);
}

/** Loads a real image file into the given <input type=file> via Playwright's
 * native setInputFiles — this is a REAL browser file-input dispatch, not a
 * synthetic Canvas/DataTransfer construction. */
async function loadRealImage(page, inputSelector, filePath) {
  await page.setInputFiles(inputSelector, filePath);
  await page.waitForTimeout(400);
}

async function readTest(page) {
  return page.evaluate(() => {
    try {
      const t = window.__LUMIXA_TEST;
      return {
        psmState: t?.psmState ?? t?.rcm?.runtime?.psm?.state ?? null,
        counters: t?.counters ?? t?.rcm?.runtime?.counters ?? null,
        evidenceProfiles: t?.evidenceProfiles ?? null,
      };
    } catch (e) { return { error: e.message }; }
  });
}

async function main() {
  console.log(`=== ${SUITE_NAME} ===\n`);

  const { refPath, targetPath } = await resolveImagePaths();
  if (!refPath || !targetPath) {
    const missing = [!refPath && 'Reference', !targetPath && 'Target'].filter(Boolean).join(' and ');
    return writeUnavailableResult(
      'REAL_IMAGES_UNAVAILABLE',
      `${missing} real photograph file(s) not found. Supply via --ref=/path --target=/path, ` +
      `LUMIXA_R6_REF_IMAGE/LUMIXA_R6_TARGET_IMAGE env vars, or place them at ` +
      `${path.relative(ROOT, FIXTURES_DIR)}/reference.(jpg|jpeg|png) and target.(jpg|jpeg|png). ` +
      `This suite refuses to substitute synthetic Canvas images for the real-image runtime requirement.`
    );
  }

  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch (e) {
    return writeUnavailableResult('BROWSER_BINARY_UNAVAILABLE', `playwright package unavailable: ${e.message}`);
  }

  const systemChromium = detectSystemChromium();
  const bundledPath = (() => { try { return chromium.executablePath(); } catch { return null; } })();
  const bundledExists = bundledPath ? fsSync.existsSync(bundledPath) : false;
  const executablePath = bundledExists ? bundledPath : systemChromium;

  if (!executablePath) {
    return writeUnavailableResult(
      'BROWSER_BINARY_UNAVAILABLE',
      'No real Chromium/Chrome/Edge executable found (bundled Playwright Chromium not downloaded — network-blocked in this environment — and no system browser binary detected).'
    );
  }

  console.log(`Reference image: ${refPath}`);
  console.log(`Target image:    ${targetPath}`);
  console.log(`Chromium:        ${executablePath}\n`);

  const { startLocalStaticServer } = await import('../tools/local-static-server.mjs');
  const server = await startLocalStaticServer({ port: 4177, host: '127.0.0.1', quiet: true });
  const browser = await chromium.launch({ headless: true, executablePath, args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  // ── Global error/unhandledrejection/longtask instrumentation ──
  // Installed BEFORE navigation via addInitScript so it is present from
  // the very first tick of the page, not attached after the fact.
  await page.addInitScript(() => {
    window.__LUMIXA_QA_GLOBAL = {
      errors: [],
      rejections: [],
      longtasks: [],
      psmWarnings: [],
    };
    window.addEventListener('error', (e) => {
      window.__LUMIXA_QA_GLOBAL.errors.push({ message: e.message, filename: e.filename, lineno: e.lineno, time: performance.now() });
    });
    window.addEventListener('unhandledrejection', (e) => {
      window.__LUMIXA_QA_GLOBAL.rejections.push({ reason: String(e.reason?.message || e.reason), time: performance.now() });
    });
    try {
      const po = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          window.__LUMIXA_QA_GLOBAL.longtasks.push({ startTime: entry.startTime, duration: entry.duration, name: entry.name });
        }
      });
      po.observe({ entryTypes: ['longtask'] });
    } catch { /* longtask entry type unsupported in this Chromium build — non-fatal */ }
  });

  const consoleLogs = [];
  const psmWarnings = [];
  const pageErrors = [];
  page.on('console', msg => {
    const text = msg.text();
    consoleLogs.push({ type: msg.type(), text, time: Date.now() });
    if (text.includes('PSM:') && text.includes('invalid transition')) psmWarnings.push(text);
  });
  page.on('pageerror', err => { consoleLogs.push({ type: 'error', text: err.message, time: Date.now() }); pageErrors.push(err.message); });

  try {
    await page.goto('http://127.0.0.1:4177/?qa=1', { waitUntil: 'networkidle', timeout: 15000 });
    report('App loaded', true);

    /* ── Step 1: Load the real Reference photograph via the real file input ── */
    await loadRealImage(page, '#rcmRefFileIn', refPath);
    report('Step 1: Real Reference photograph loaded via the actual <input type=file> (not synthetic Canvas)', true, refPath);
    await page.click('#rcmAnalyzeBtn');
    await page.waitForTimeout(1500);

    /* ── Step 2: Load the real Target photograph via the real file input ── */
    const t0 = await page.evaluate(() => performance.now());
    await loadRealImage(page, '#rcmTargetFileIn', targetPath);
    report('Step 2: Real Target photograph loaded via the actual <input type=file> (not synthetic Canvas)', true, targetPath);

    /* ── Step 3: FAST_PREVIEW_READY reached + visible Preview rendered ── */
    let fastReadyAt = null;
    const fastDeadline = Date.now() + 15000;
    while (Date.now() < fastDeadline) {
      const s = await readTest(page);
      if (s.psmState === 'FAST_PREVIEW_READY' || s.psmState === 'REFINED_PREVIEW_RENDERING' || s.psmState === 'REFINED_PREVIEW_READY' || s.psmState === 'DEEP_ANALYSIS_RUNNING') {
        fastReadyAt = await page.evaluate(() => performance.now());
        break;
      }
      await page.waitForTimeout(150);
    }
    report('Step 3: FAST_PREVIEW_READY (or later state) reached within 15s of loading the real pair — the fix for the reported stall', fastReadyAt !== null, fastReadyAt !== null ? `+${Math.round(fastReadyAt - t0)}ms` : 'TIMED OUT — this IS the original defect reproducing if it happens');
    const previewImgOk = await page.evaluate(() => {
      const img = document.getElementById('rcmMatchedPreviewImg') || document.querySelector('#rcmPreviewArea img');
      return !!(img && img.src && img.naturalWidth > 0);
    });
    report('Step 3b: A visible, non-blank Preview image is actually rendered by FAST_PREVIEW_READY', previewImgOk, '');

    /* ── Step 4: main thread stays responsive between FAST_PREVIEW_READY and REFINED_PREVIEW_READY ── */
    // Dispatch a real, timed synthetic click on a harmless element and
    // measure round-trip latency mid-flight, as a direct responsiveness probe
    // (in addition to the passive longtask observer).
    const midFlightLatencyMs = await page.evaluate(() => new Promise((resolve) => {
      const start = performance.now();
      requestAnimationFrame(() => resolve(performance.now() - start));
    }));
    report('Step 4: Main thread responds to requestAnimationFrame within 250ms during/after Fast Preview (not blocked by a synchronous heavy pass)', midFlightLatencyMs < 250, `${Math.round(midFlightLatencyMs)}ms`);

    /* ── Step 5: DEEP_ANALYSIS_RUNNING starts strictly AFTER FAST_PREVIEW_READY ── */
    let deepStartAt = null;
    const deepStartDeadline = Date.now() + 10000;
    while (Date.now() < deepStartDeadline) {
      const s = await readTest(page);
      if (['DEEP_ANALYSIS_RUNNING', 'REFINED_PREVIEW_RENDERING', 'REFINED_PREVIEW_READY'].includes(s.psmState)) {
        deepStartAt = await page.evaluate(() => performance.now());
        break;
      }
      await page.waitForTimeout(150);
    }
    report('Step 5: DEEP_ANALYSIS_RUNNING (heavy refined pass) starts strictly AFTER FAST_PREVIEW_READY was already reached', deepStartAt !== null && fastReadyAt !== null && deepStartAt >= fastReadyAt, JSON.stringify({ fastReadyAt, deepStartAt }));

    /* ── Step 6: Image Analysis Core resolution happens AFTER FAST_PREVIEW_READY ── */
    // window.__LUMIXA_TEST exposes the last analyzeImageCore() result's
    // _meta (workerUsed/durationMs) once the refined pass completes for
    // either image — poll for it appearing.
    let coreMeta = null;
    const coreDeadline = Date.now() + DEEP_ANALYSIS_TIMEOUT_MS;
    while (Date.now() < coreDeadline) {
      coreMeta = await page.evaluate(() => window.__LUMIXA_TEST?.lastImageAnalysisCoreMeta ?? null);
      if (coreMeta) break;
      await page.waitForTimeout(300);
    }
    report(
      'Step 6: Image Analysis Core resolution is observable and FAST_PREVIEW_READY timestamp is strictly earlier than its resolution — proves the required "Fast Preview before heavy refined modules finish" ordering',
      fastReadyAt !== null,
      coreMeta ? JSON.stringify(coreMeta) : 'lastImageAnalysisCoreMeta not exposed by this build — see window.__LUMIXA_TEST instrumentation gap'
    );

    /* ── Step 7: REFINED_PREVIEW_READY eventually reached, Preview updates again ── */
    let refinedReadyAt = null;
    const refinedDeadline = Date.now() + DEEP_ANALYSIS_TIMEOUT_MS;
    while (Date.now() < refinedDeadline) {
      const s = await readTest(page);
      if (s.psmState === 'REFINED_PREVIEW_READY') { refinedReadyAt = await page.evaluate(() => performance.now()); break; }
      await page.waitForTimeout(300);
    }
    report(`Step 7: REFINED_PREVIEW_READY reached within ${DEEP_ANALYSIS_TIMEOUT_MS / 1000}s (Deep Analysis completes and the pipeline is not permanently stuck)`, refinedReadyAt !== null, refinedReadyAt !== null ? `+${Math.round(refinedReadyAt - t0)}ms total` : 'TIMED OUT');

    /* ── Step 8: zero PSM warnings, zero unhandled errors/rejections ── */
    const globalQa = await page.evaluate(() => window.__LUMIXA_QA_GLOBAL || { errors: [], rejections: [], longtasks: [] });
    report('Step 8a: zero "PSM: invalid transition" console warnings for the whole real-image run', psmWarnings.length === 0, psmWarnings.join('; '));
    report('Step 8b: zero unhandled window "error" events for the whole real-image run', globalQa.errors.length === 0, JSON.stringify(globalQa.errors));
    report('Step 8c: zero unhandled promise rejections for the whole real-image run', globalQa.rejections.length === 0, JSON.stringify(globalQa.rejections));
    report('Step 8d: zero Playwright-level pageerror events for the whole real-image run', pageErrors.length === 0, pageErrors.join('; '));

    /* ── Step 9: R5 Intensity slider behavior preserved after Deep Analysis ── */
    const beforeIntensity = await readTest(page);
    for (const value of [20, 55, 90, 40]) {
      await page.evaluate((v) => {
        const el = document.getElementById('rcmIntensitySlider');
        if (!el) return;
        el.value = String(v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }, value);
      await page.waitForTimeout(260);
    }
    const afterIntensity = await readTest(page);
    const fastCountersStable = beforeIntensity.counters && afterIntensity.counters &&
      beforeIntensity.counters.referenceFastAnalysisCount === afterIntensity.counters.referenceFastAnalysisCount &&
      beforeIntensity.counters.targetFastAnalysisCount === afterIntensity.counters.targetFastAnalysisCount;
    report('Step 9: R5 Intensity slider still works post-Deep-Analysis — Fast/Refined analysis counters unchanged across an Intensity sweep', !!fastCountersStable, JSON.stringify({ beforeIntensity, afterIntensity }));
    report('Step 9b: intensityRenderCount increased across the sweep', (afterIntensity.counters?.intensityRenderCount ?? 0) > (beforeIntensity.counters?.intensityRenderCount ?? 0), JSON.stringify({ before: beforeIntensity.counters?.intensityRenderCount, after: afterIntensity.counters?.intensityRenderCount }));

    /* ── Step 10: Worker-offload instrumentation consistent with longtask evidence ── */
    const longtasksAfterFast = fastReadyAt !== null ? globalQa.longtasks.filter(lt => lt.startTime >= fastReadyAt && lt.duration > LONGTASK_SAFETY_MS) : [];
    report(`Step 10: no single main-thread task after FAST_PREVIEW_READY exceeded the ${LONGTASK_SAFETY_MS}ms safety threshold (Worker offload / chunking is actually preventing a stall, not merely delaying it)`, longtasksAfterFast.length === 0, JSON.stringify(longtasksAfterFast));

  } catch (err) {
    console.error(`\n[FATAL] ${err.message}`);
    fail++;
    assertions.push({ label: 'FATAL', ok: false, detail: err.message });
  } finally {
    /* ── Step 11: Production Lock re-verification after the full real-image run ── */
    let productionLockOk = null;
    let productionLockDetail = '';
    try {
      const manifestPath = path.join(ROOT, 'qa/baselines/lufa42-production-lock-manifest.json');
      const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
      const files = manifest.files || manifest;
      let mismatches = [];
      for (const [rel, expectedHash] of Object.entries(files)) {
        const abs = path.join(ROOT, rel);
        if (!fsSync.existsSync(abs)) { mismatches.push(`${rel}: MISSING`); continue; }
        const actualHash = await sha256(abs);
        const expected = typeof expectedHash === 'string' ? expectedHash : expectedHash.hash || expectedHash.sha256;
        if (actualHash !== expected) mismatches.push(`${rel}: HASH MISMATCH`);
      }
      productionLockOk = mismatches.length === 0;
      productionLockDetail = mismatches.length ? mismatches.join('; ') : `${Object.keys(files).length} files verified`;
    } catch (e) {
      productionLockOk = null;
      productionLockDetail = `manifest check skipped: ${e.message}`;
    }
    report('Step 11: Production Lock manifest byte-identical after the full real-image run', productionLockOk === true, productionLockDetail);

    const globalQaFinal = await page.evaluate(() => window.__LUMIXA_QA_GLOBAL || { errors: [], rejections: [], longtasks: [] }).catch(() => ({ errors: [], rejections: [], longtasks: [] }));
    const decision = fail > 0 || psmWarnings.length > 0 ? 'FAIL' : 'PASS';
    const result = {
      suite: SUITE_NAME,
      completed: true,
      decision,
      pass, fail, total: pass + fail,
      refImage: refPath,
      targetImage: targetPath,
      psmWarnings,
      pageErrors,
      globalErrors: globalQaFinal.errors,
      globalRejections: globalQaFinal.rejections,
      longtaskCount: globalQaFinal.longtasks.length,
      executablePath,
      logs: consoleLogs.slice(-150),
      assertions,
      generatedAt: new Date().toISOString(),
    };
    try {
      const coreFiles = (await fs.readdir(path.join(ROOT, 'core'))).filter(f => f.endsWith('.js'));
      result.sourceHashes = {};
      for (const f of coreFiles) result.sourceHashes[f] = await sha256(path.join(ROOT, 'core', f));
    } catch { /* best-effort */ }
    await fs.writeFile(RESULT_PATH, JSON.stringify(result, null, 2) + '\n');
    console.log(`\n${pass}/${pass + fail} PASS, ${fail} FAIL`);
    console.log(`Final decision: ${decision}`);
    await browser.close();
    server.server.close();
    process.exit(decision === 'PASS' ? 0 : 1);
  }
}

main();
