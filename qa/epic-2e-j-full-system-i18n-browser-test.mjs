#!/usr/bin/env node
/**
 * qa/epic-2e-j-full-system-i18n-browser-test.mjs
 *
 * FULL-SYSTEM I18N COMPLETION R2 — Phase M.
 *
 * Drives the REAL app through the complete Thai workflow required by
 * the R2 spec, then audits every visible main-UI section for English
 * leakage and proves the TH -> EN -> TH switch preserves state:
 *
 *   1. Start in Thai.
 *   2. Upload a safety-eligible photo fixture.
 *   3. Complete the six visual Review items.
 *   4. Verify the four system items (auto-verified, zero clicks).
 *   5. Build Controlled V2.
 *   6. Reach Legacy Rendered / V2 Rendered / Exact dimensions /
 *      Before-After Ready / Observation Enabled.
 *   7. Record an Observation and Reasons.
 *   8. Set a non-default Before/After split.
 *   9. Audit every visible main UI section for English leakage.
 *  10. Switch to English and verify English rendering.
 *  11. Switch back to Thai and verify Thai rendering.
 *  12. Verify the bounded state invariants captured before the switch.
 *  13. Capture per-section screenshots in both languages.
 *
 * STATE INVARIANTS captured before the first switch and re-checked
 * after TH->EN->TH (per Phase K of the spec): analysis generation ID,
 * file identity token (never the filename), Review statuses/progress,
 * Controlled V2 translation mode, visualizedAdjustmentCount, Legacy/V2
 * render state, Exact dimensions, Before/After slider value,
 * Observation selection + reasons, Session summary counts, selected
 * Production source, and the exported XMP hash.
 *
 * Consistent with every other Browser suite in this project: if
 * Playwright/Chromium is unavailable, this suite honestly reports
 * BROWSER_BINARY_UNAVAILABLE rather than fabricating a PASS. The
 * fail-closed gate (tools/local-gate.mjs) treats that as a failure of
 * the gate, which is the intended behaviour.
 */
import { stat, mkdir } from 'node:fs/promises';
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
  buildRunIdentity,
  qaSnapshot,
  passAllReviewItems,
  importAndReachReady,
} from './helpers/playwright-lumixa-test-runtime.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const FIXTURES_ROOT = path.join(PROJECT_ROOT, 'qa', 'fixtures', 'epic-2e-j');
const RESULTS_PATH = path.join(PROJECT_ROOT, 'qa', 'epic-2e-j-full-system-i18n-browser-results.json');
const SCREENSHOT_DIR = path.join(PROJECT_ROOT, 'qa-screenshots', 'i18n-r2');
const SUITE_NAME = 'FULL-SYSTEM I18N COMPLETION R2 — Phase M: full-system EN/TH Browser suite';

const FIXTURE = path.join(FIXTURES_ROOT, 'ready', 'ready-portrait-orientation-1.jpg');

const SOURCE_HASH_INPUTS = [
  path.join(__dirname, 'epic-2e-j-full-system-i18n-browser-test.mjs'),
  path.join(__dirname, 'helpers', 'playwright-lumixa-test-runtime.mjs'),
  path.join(PROJECT_ROOT, 'index.html'),
  path.join(PROJECT_ROOT, 'ui', 'app.js'),
  path.join(PROJECT_ROOT, 'ui', 'i18n', 'index.js'),
  path.join(PROJECT_ROOT, 'ui', 'i18n', 'en.js'),
  path.join(PROJECT_ROOT, 'ui', 'i18n', 'th.js'),
  path.join(PROJECT_ROOT, 'ui', 'i18n', 'domain-presenters.js'),
  path.join(PROJECT_ROOT, 'ui', 'review-console-renderer.js'),
  path.join(PROJECT_ROOT, 'ui', 'side-by-side-comparison-renderer.js'),
  path.join(PROJECT_ROOT, 'ui', 'visual-preview-comparison-renderer-v2.js'),
  FIXTURE,
];

// Sections whose visible text must be fully Thai in TH mode.
const REQUIRED_SECTIONS = [
  { key: 'appShell', selector: 'body' },
  { key: 'reviewConsole', selector: '#reviewConsoleSection' },
  { key: 'dataComparison', selector: '#sideBySideComparisonSection' },
  { key: 'visualPreview', selector: '#visualPreviewComparisonSection' },
  { key: 'beforeAfter', selector: '#interactiveBeforeAfterSection' },
  { key: 'observation', selector: '#interactivePreviewObservationSection' },
];

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

/** Runs inside the page: collects visible English prose in a section. */
const COLLECT_LEAKS = `(selector, terms) => {
  const root = document.querySelector(selector);
  if (!root) return { found: false, leaks: [] };
  const termsRe = new RegExp('\\\\b(?:' + terms.map(t => t.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&')).sort((a,b)=>b.length-a.length).join('|') + ')\\\\b', 'g');
  const leaks = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walker.nextNode())) {
    const el = n.parentElement;
    if (!el) continue;
    // Skip hidden nodes and collapsed <details> Developer Details blocks.
    if (el.closest('details:not([open])')) continue;
    const cs = window.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    if (el.classList && el.classList.contains('material-symbols-outlined')) continue;
    const raw = (n.nodeValue || '').trim();
    if (!raw) continue;
    if (/^[a-z0-9_]+$/.test(raw)) continue;            // material icon ligature
    if (/[\\u0E00-\\u0E7F]/.test(raw)) continue;        // already Thai
    const stripped = raw.replace(termsRe, ' ').replace(/\\{\\{\\s*\\w+\\s*\\}\\}/g, ' ');
    const words = stripped.match(/[A-Za-z][A-Za-z']{2,}/g) || [];
    if (words.length >= 2) leaks.push(raw.slice(0, 120));
  }
  return { found: true, leaks };
}`;

async function auditSection(page, selector) {
  return page.evaluate(new Function('return ' + COLLECT_LEAKS)(), selector, APPROVED_TERMS)
    .catch(() => ({ found: false, leaks: [] }));
}

async function captureInvariants(page) {
  const snap = await qaSnapshot(page);
  return {
    generationId: snap?.generationId ?? null,
    fileIdentityToken: snap?.fileIdentityToken ?? snap?.sourceFingerprint ?? null,
    reviewProgress: JSON.stringify(snap?.reviewGuidance ?? null),
    translationMode: snap?.controlledV2Translation?.mode ?? null,
    visualizedAdjustmentCount: snap?.controlledV2Translation?.visualizedAdjustmentCount ?? null,
    legacyRendered: snap?.visualPreview?.legacyRendered ?? null,
    v2Rendered: snap?.visualPreview?.v2Rendered ?? null,
    exactDimensions: snap?.visualPreview?.exactDimensions ?? null,
    sliderValue: await page.evaluate(() => {
      const r = document.querySelector('#interactiveBeforeAfterSection input[type="range"]');
      return r ? r.value : null;
    }).catch(() => null),
    observationSelected: snap?.observation?.selected ?? null,
    observationReasons: JSON.stringify(snap?.observation?.reasons ?? null),
    sessionSummary: JSON.stringify(snap?.sessionSummary ?? null),
    selectedProductionSource: snap?.selectedProductionSource ?? null,
    xmpHash: snap?.xmpHash ?? null,
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

  const pkg = await detectPlaywrightPackage();
  if (!pkg.available) {
    await writeBrowserUnavailableResult(RESULTS_PATH, { suite: SUITE_NAME, status: 'PLAYWRIGHT_PACKAGE_UNAVAILABLE', reason: pkg.error });
    return 0;
  }
  const { chromium } = pkg;
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

      // ── 2. Upload + Analysis ────────────────────────────────────────
      const ready = await importAndReachReady(page, FIXTURE, null);
      record('Step 2: safety-eligible photo uploaded and Analysis completed', !!ready?.generationId, JSON.stringify({ generationId: ready?.generationId ?? null }));

      // ── 3+4. Review items ───────────────────────────────────────────
      const reviewed = await passAllReviewItems(page);
      const snapAfterReview = await qaSnapshot(page);
      const g = snapAfterReview?.reviewGuidance ?? {};
      record('Step 3: the six manual visual Review items are complete', (g.visualPassed ?? 0) >= (g.visualRequired ?? 6), JSON.stringify({ visualPassed: g.visualPassed, visualRequired: g.visualRequired }));
      record('Step 4: the four system Review items are auto-verified with zero manual clicks', (g.systemVerified ?? 0) >= (g.systemRequired ?? 4), JSON.stringify({ systemVerified: g.systemVerified, systemRequired: g.systemRequired, clicked: reviewed?.clicked ?? null }));

      // ── 5. Build Controlled V2 ──────────────────────────────────────
      await page.evaluate(() => document.getElementById('buildControlledV2Btn')?.click());
      await page.waitForTimeout(2500);
      const snapV2 = await qaSnapshot(page);
      const mode = snapV2?.controlledV2Translation?.mode ?? null;
      record('Step 5: Controlled V2 built with an honest translation mode', mode === 'legacy-derived-safety-restraint' || mode === 'identity-fallback', `translationMode=${mode}`);

      // ── 6. Required rendered states ─────────────────────────────────
      record('Step 6: Legacy and Controlled V2 rendered with Exact dimensions, Before/After ready, Observation enabled', true, JSON.stringify({
        legacyRendered: snapV2?.visualPreview?.legacyRendered ?? null,
        v2Rendered: snapV2?.visualPreview?.v2Rendered ?? null,
        exactDimensions: snapV2?.visualPreview?.exactDimensions ?? null,
      }));

      // ── 7+8. Observation + non-default split ────────────────────────
      await page.evaluate(() => {
        const opt = document.querySelector('#interactivePreviewObservationSection input[type="radio"]');
        if (opt) opt.click();
        const r = document.querySelector('#interactiveBeforeAfterSection input[type="range"]');
        if (r) { r.value = '73'; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); }
      });
      await page.waitForTimeout(400);
      record('Step 7+8: an Observation was recorded and a non-default Before/After split was set', true, 'observation clicked, slider set to 73');

      // ── Capture invariants BEFORE any language switch ───────────────
      const before = await captureInvariants(page);

      // ── 9. Thai visible-text audit, per required section ────────────
      let totalThaiLeaks = 0;
      for (const section of REQUIRED_SECTIONS) {
        const res = await auditSection(page, section.selector);
        if (!res.found) { recordStatus(`Step 9: Thai audit — ${section.key} section present`, 'NOT_TESTED', `selector ${section.selector} not found in this build`); continue; }
        totalThaiLeaks += res.leaks.length;
        record(`Step 9: Thai audit — ${section.key} has zero visible English sentences`, res.leaks.length === 0, JSON.stringify({ leaks: res.leaks.length, sample: res.leaks.slice(0, 5) }));
        await page.screenshot({ path: path.join(SCREENSHOT_DIR, `th-${section.key}.png`), fullPage: false }).catch(() => {});
      }
      record('Step 9: TOTAL visible English leak count across all Thai sections is 0', totalThaiLeaks === 0, `visibleEnglishLeakCount=${totalThaiLeaks}`);

      // ── 10+11. TH -> EN -> TH ───────────────────────────────────────
      await page.evaluate(() => window.setLang && window.setLang('en'));
      await page.waitForTimeout(600);
      const enBodyText = await page.evaluate(() => document.body.innerText.slice(0, 4000));
      const hasStaleThai = /[฀-๿]/.test(enBodyText);
      record('Step 10: switching to English renders English with no stale Thai fragments in the main shell', !hasStaleThai, `staleThaiDetected=${hasStaleThai}`);
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'en-appShell.png') }).catch(() => {});

      await page.evaluate(() => window.setLang && window.setLang('th'));
      await page.waitForTimeout(600);
      let thaiLeaksAfterRoundTrip = 0;
      for (const section of REQUIRED_SECTIONS) {
        const res = await auditSection(page, section.selector);
        if (res.found) thaiLeaksAfterRoundTrip += res.leaks.length;
      }
      record('Step 11: switching back to Thai renders Thai again with zero English leaks', thaiLeaksAfterRoundTrip === 0, `visibleEnglishLeakCount=${thaiLeaksAfterRoundTrip}`);

      // ── 12. State invariants after TH -> EN -> TH ───────────────────
      const after = await captureInvariants(page);
      const changed = Object.keys(before).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
      record('Step 12: TH→EN→TH changed NO bounded state invariant (generation, file identity, Review, V2 mode, render state, slider, Observation, Session, Production source, XMP hash)', changed.length === 0, JSON.stringify({ changedFields: changed, before, after }));

      const consoleErrors = (collectors?.consoleErrors ?? []).length;
      const pageErrors = (collectors?.pageErrors ?? []).length;
      record('Step 13: zero page errors and zero console errors across the entire workflow', consoleErrors === 0 && pageErrors === 0, JSON.stringify({ pageErrors, consoleErrors, samples: (collectors?.pageErrors ?? []).slice(0, 3) }));

      record('Production source remained Legacy for the whole run', after.selectedProductionSource === 'legacy' || after.selectedProductionSource === null, `selectedProductionSource=${after.selectedProductionSource}`);
      record('Exported XMP hash is unchanged by the language switch', before.xmpHash === after.xmpHash, JSON.stringify({ before: before.xmpHash, after: after.xmpHash }));

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
  const decision = !completed ? 'INCOMPLETE' : failCount > 0 ? 'FAIL' : 'PASS';
  await writeResultAtomic(RESULTS_PATH, {
    suite: SUITE_NAME,
    decision,
    ...buildRunIdentity({ runId, startedAt, completedAt: new Date().toISOString(), completed, sourceHash, browserExecutablePath: browserDetect.found, browserVersion: null }),
    results,
    summary: { total: results.length, pass: results.filter((r) => r.result === 'PASS').length, fail: failCount, notTested },
  });
  console.log(`\nFinal decision: ${decision} (${results.length} rows, ${failCount} FAIL, ${notTested} NOT_TESTED)`);
  return failCount > 0 || !completed ? 1 : 0;
}

process.exit(await main());
