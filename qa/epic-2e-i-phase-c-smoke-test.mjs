#!/usr/bin/env node
/**
 * qa/epic-2e-i-phase-c-smoke-test.mjs
 *
 * EPIC 2E-I-C-F — a small, bounded, reproducible smoke test for the
 * Interactive Before/After viewer. Spawns its own local static file
 * server (no external dependency beyond the already-installed
 * `playwright` package) and drives a real headless Chromium session.
 *
 * PREREQUISITE: the `playwright` npm package must be resolvable from
 * this file (e.g. installed globally and linked, or installed locally
 * via `npm install playwright` in this directory). This project has no
 * build step and does not commit a `node_modules/` directory — this
 * script is a QA utility, not part of the shipped vanilla-ES-module
 * application.
 *
 * Run: node qa/epic-2e-i-phase-c-smoke-test.mjs
 * Output: qa/epic-2e-i-phase-c-results.json
 *
 * This script deliberately does NOT attempt physical-device or
 * screen-reader testing — those remain NOT_TESTED, never fabricated.
 */

import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PORT = 19999;

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg' };

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      try {
        const urlPath = decodeURIComponent(req.url.split('?')[0]);
        const filePath = path.join(PROJECT_ROOT, urlPath === '/' ? '/index.html' : urlPath);
        const data = await readFile(filePath);
        const ext = path.extname(filePath);
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(data);
      } catch {
        res.writeHead(404);
        res.end('not found');
      }
    });
    server.listen(PORT, () => resolve(server));
  });
}

const results = [];
function record(test, result, evidence) {
  results.push({ test, result, evidence });
  const icon = result === 'PASS' ? '✓' : result === 'FAIL' ? '✗' : '•';
  console.log(`${icon} [${result}] ${test} — ${evidence}`);
}

async function main() {
  const server = await startServer();
  const browser = await chromium.launch();

  try {
    // ── Harness page: real Interactive Before/After skeleton + controller,
    // loaded via real ES module imports from the actual project files. ──
    const harnessHtml = `<!DOCTYPE html><html><head></head><body>
<div id="testContainer" style="width:400px"></div>
<script type="module">
  import { createInteractiveBeforeAfterControllerV2 } from '/ui/interactive-before-after-controller-v2.js';
  import { ensureInteractiveBeforeAfterLayout, renderInteractiveBeforeAfterStatus } from '/ui/interactive-before-after-renderer-v2.js';
  function makeCanvas(w,h,color) { const c=document.createElement('canvas'); c.width=w;c.height=h; const ctx=c.getContext('2d'); ctx.fillStyle=color; ctx.fillRect(0,0,w,h); return c; }
  window.__makeCanvas = makeCanvas;
  const container = document.getElementById('testContainer');
  const elements = ensureInteractiveBeforeAfterLayout(container);
  const controller = createInteractiveBeforeAfterControllerV2({ ...elements, generationProvider: () => window.__gen ?? 1, onStateChange: (s) => renderInteractiveBeforeAfterStatus(container, s) });
  window.__controller = controller;
  window.__gen = 1;
  window.__ready = true;
</script>
</body></html>`;
    await writeFile(path.join(PROJECT_ROOT, '_qa_harness.html'), harnessHtml);

    const page = await browser.newPage({ viewport: { width: 600, height: 600 } });
    const consoleErrors = [];
    page.on('pageerror', (e) => consoleErrors.push(String(e)));
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

    await page.goto(`http://localhost:${PORT}/_qa_harness.html`);
    await page.waitForFunction(() => window.__ready === true);

    // ── Ready state ──
    const readyState = await page.evaluate(() => {
      const legacySrc = window.__makeCanvas(400, 300, 'rgb(200,50,50)');
      const v2Src = window.__makeCanvas(400, 300, 'rgb(50,200,50)');
      return window.__controller.updateSources({
        legacySourceCanvas: legacySrc, v2SourceCanvas: v2Src, generationId: 1,
        legacyVisualAdjustmentsApplied: true, v2VisualAdjustmentsApplied: true,
        safety: { selectedProductionSource: 'legacy', allowExport: false, allowProductionWrite: false, v2Contradictory: false },
      }).state;
    });
    record('Ready state reachable', readyState === 'ready' ? 'PASS' : 'FAIL', `state="${readyState}"`);

    // ── 0% / 50% / 100% split, direction check ──
    for (const [pct, expectDesc] of [[0, 'V2 fills (no clip)'], [50, 'half-split'], [100, 'Legacy fills (full clip)']]) {
      await page.evaluate((p) => window.__controller.setSplit(p), pct);
      const clipPath = await page.evaluate(() => document.getElementById('ibaOverlayWrapper').style.clipPath);
      const expectedInset = `inset(0px 0px 0px ${pct}%)`;
      const ok = clipPath === expectedInset;
      record(`Split ${pct}% direction (${expectDesc})`, ok ? 'PASS' : 'FAIL', `clip-path="${clipPath}"`);
    }
    await page.evaluate(() => window.__controller.setSplit(50));

    // ── Partial state ──
    const partialState = await page.evaluate(() => {
      window.__controller.clear();
      return window.__controller.prepareState({
        legacySide: { rendered: true, state: 'rendered', warnings: [] },
        v2Side: { rendered: false, state: 'unavailable', warnings: [] },
        safety: { selectedProductionSource: 'legacy', allowExport: false, allowProductionWrite: false, v2Contradictory: false },
        generationId: 1,
      }).state;
    });
    record('Partial state reachable', partialState === 'partial' ? 'PASS' : 'FAIL', `state="${partialState}"`);

    // ── Safety Blocked state (before any canvas bind) ──
    const blockedState = await page.evaluate(() => {
      window.__controller.clear();
      const r = window.__controller.prepareState({
        legacySide: { rendered: false, state: 'unavailable', warnings: [] },
        v2Side: { rendered: false, state: 'unavailable', warnings: [] },
        safety: { selectedProductionSource: 'v2', allowExport: false, allowProductionWrite: false, v2Contradictory: false },
        generationId: 1,
      });
      return { state: r.state, blockedReason: r.blockedReason };
    });
    record('Safety Blocked state (v2 production source anomaly)',
      blockedState.state === 'blocked' && blockedState.blockedReason === 'safety' ? 'PASS' : 'FAIL',
      `state="${blockedState.state}", blockedReason="${blockedState.blockedReason}"`);

    // ── Re-bind Ready for keyboard/drag tests ──
    await page.evaluate(() => {
      const legacySrc = window.__makeCanvas(400, 300, 'rgb(200,50,50)');
      const v2Src = window.__makeCanvas(400, 300, 'rgb(50,200,50)');
      return window.__controller.updateSources({ legacySourceCanvas: legacySrc, v2SourceCanvas: v2Src, generationId: 1 });
    });

    // ── Keyboard: ArrowRight / Home / End ──
    await page.evaluate(() => document.getElementById('ibaHandle').focus());
    const before = await page.evaluate(() => window.__controller.getState().splitPercent);
    await page.keyboard.press('ArrowRight');
    const afterRight = await page.evaluate(() => window.__controller.getState().splitPercent);
    record('Keyboard ArrowRight increases split', afterRight === before + 1 ? 'PASS' : 'FAIL', `${before} -> ${afterRight}`);
    await page.keyboard.press('Home');
    const afterHome = await page.evaluate(() => window.__controller.getState().splitPercent);
    record('Keyboard Home = 0% (V2)', afterHome === 0 ? 'PASS' : 'FAIL', `splitPercent=${afterHome}`);
    await page.keyboard.press('End');
    const afterEnd = await page.evaluate(() => window.__controller.getState().splitPercent);
    record('Keyboard End = 100% (Legacy)', afterEnd === 100 ? 'PASS' : 'FAIL', `splitPercent=${afterEnd}`);

    // ── FIX 3 (EPIC 2E-I-C-F2): focus-visible computed outline ──
    await page.evaluate(() => document.getElementById('ibaHandle').focus());
    const handleOutline = await page.evaluate(() => getComputedStyle(document.getElementById('ibaHandle')).outlineStyle);
    record('focus-visible computed outline on handle', handleOutline === 'solid' ? 'PASS' : 'FAIL', `outlineStyle="${handleOutline}"`);
    await page.evaluate(() => document.getElementById('ibaRangeInput').focus());
    const rangeOutline = await page.evaluate(() => getComputedStyle(document.getElementById('ibaRangeInput')).outlineStyle);
    record('focus-visible computed outline on range input', rangeOutline === 'solid' ? 'PASS' : 'FAIL', `outlineStyle="${rangeOutline}"`);

    // ── FIX 3: Tab reaches an Interactive control; Shift+Tab does not trap ──
    await page.evaluate(() => document.body.focus());
    await page.evaluate(() => document.getElementById('ibaRangeInput').scrollIntoView());
    // Focus the range input directly (a full page Tab-walk is environment-dependent);
    // verify Shift+Tab moves focus AWAY from it without throwing/trapping.
    await page.evaluate(() => document.getElementById('ibaRangeInput').focus());
    const focusedBeforeShiftTab = await page.evaluate(() => document.activeElement.id);
    await page.keyboard.press('Shift+Tab');
    const focusedAfterShiftTab = await page.evaluate(() => document.activeElement.id);
    record('Shift+Tab does not trap focus', focusedAfterShiftTab !== focusedBeforeShiftTab ? 'PASS' : 'FAIL', `"${focusedBeforeShiftTab}" -> "${focusedAfterShiftTab}"`);

    // ── FIX 3: pointer drag updates split ──
    const viewportBox = await page.evaluate(() => {
      const r = document.getElementById('ibaViewport').getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    });
    await page.mouse.move(viewportBox.x + viewportBox.width * 0.2, viewportBox.y + viewportBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(viewportBox.x + viewportBox.width * 0.8, viewportBox.y + viewportBox.height / 2, { steps: 5 });
    await page.waitForTimeout(100);
    const splitAfterDrag = await page.evaluate(() => window.__controller.getState().splitPercent);
    record('Pointer drag updates split', splitAfterDrag > 60 && splitAfterDrag < 90 ? 'PASS' : 'FAIL', `splitPercent=${splitAfterDrag} (expected roughly 80)`);
    await page.mouse.up();
    const draggingClassAfterUp = await page.evaluate(() => document.getElementById('ibaViewport').classList.contains('iba-dragging'));
    record('Dragging class removed after pointerup', !draggingClassAfterUp ? 'PASS' : 'FAIL', `iba-dragging present=${draggingClassAfterUp}`);

    // ── No drawImage/getImageData during slider movement (instrumented) ──
    const drawCallsDuringDrag = await page.evaluate(async () => {
      let drawImageCalls = 0;
      let getImageDataCalls = 0;
      const origDraw = CanvasRenderingContext2D.prototype.drawImage;
      const origGetData = CanvasRenderingContext2D.prototype.getImageData;
      CanvasRenderingContext2D.prototype.drawImage = function (...args) { drawImageCalls++; return origDraw.apply(this, args); };
      CanvasRenderingContext2D.prototype.getImageData = function (...args) { getImageDataCalls++; return origGetData.apply(this, args); };
      for (let i = 0; i <= 100; i += 5) window.__controller.setSplit(i);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      CanvasRenderingContext2D.prototype.drawImage = origDraw;
      CanvasRenderingContext2D.prototype.getImageData = origGetData;
      return { drawImageCalls, getImageDataCalls };
    });
    record('No drawImage during slider movement', drawCallsDuringDrag.drawImageCalls === 0 ? 'PASS' : 'FAIL', `drawImage calls=${drawCallsDuringDrag.drawImageCalls}`);
    record('No getImageData during slider movement', drawCallsDuringDrag.getImageDataCalls === 0 ? 'PASS' : 'FAIL', `getImageData calls=${drawCallsDuringDrag.getImageDataCalls}`);

    await page.close();

    // ── Full-page viewport/overflow tests on the real index.html ──
    for (const width of [320, 360, 390, 430, 768, 900, 1024, 1440]) {
      const p = await browser.newPage({ viewport: { width, height: 800 } });
      const pErrors = [];
      p.on('pageerror', (e) => pErrors.push(String(e)));
      await p.goto(`http://localhost:${PORT}/index.html`);
      await p.waitForTimeout(500);
      const overflow = await p.evaluate(() => ({
        scrollW: document.documentElement.scrollWidth,
        clientW: document.documentElement.clientWidth,
      }));
      record(`No document horizontal overflow at ${width}px`, overflow.scrollW <= overflow.clientW ? 'PASS' : 'FAIL', `scrollWidth=${overflow.scrollW}, clientWidth=${overflow.clientW}`);
      await p.close();
    }

    // ── FIX 2/3 (EPIC 2E-I-C-F2): a large (3000x2000) image must remain
    // internally scrollable within #viewerViewport WITHOUT the document
    // itself ever scrolling horizontally, and the image must never be
    // resized merely to satisfy overflow containment. ──
    const largeImgPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const largeImgErrors = [];
    largeImgPage.on('pageerror', (e) => largeImgErrors.push(String(e)));
    await largeImgPage.goto(`http://localhost:${PORT}/index.html`);
    await largeImgPage.waitForTimeout(600);
    // Use the well-known /tmp fixture used throughout this project's manual QA.
    await largeImgPage.setInputFiles('#fileIn', '/tmp/test_photo_large.jpg').catch(() => null);
    await largeImgPage.waitForTimeout(20000);
    const largeImgResult = await largeImgPage.evaluate(() => {
      const docEl = document.documentElement;
      const viewer = document.getElementById('viewerViewport');
      const img = document.getElementById('previewImg');
      viewer.scrollLeft = 150;
      return {
        docScrollW: docEl.scrollWidth, docClientW: docEl.clientWidth,
        viewerScrollW: viewer.scrollWidth, viewerClientW: viewer.clientWidth,
        naturalW: img.naturalWidth, displayW: img.clientWidth,
      };
    });
    await largeImgPage.waitForTimeout(500);
    const scrollLeftSettled = await largeImgPage.evaluate(() => document.getElementById('viewerViewport').scrollLeft);
    record('Document does not overflow with a 3000x2000 image loaded',
      largeImgResult.docScrollW <= largeImgResult.docClientW ? 'PASS' : 'FAIL',
      `scrollWidth=${largeImgResult.docScrollW}, clientWidth=${largeImgResult.docClientW}`);
    record('#viewerViewport remains internally horizontally scrollable',
      largeImgResult.viewerScrollW > largeImgResult.viewerClientW && scrollLeftSettled === 150 ? 'PASS' : 'FAIL',
      `viewerScrollWidth=${largeImgResult.viewerScrollW}, viewerClientWidth=${largeImgResult.viewerClientW}, scrollLeftAfterSet=${scrollLeftSettled}`);
    record('Large image is not resized to satisfy overflow containment',
      largeImgResult.naturalW === largeImgResult.displayW ? 'PASS' : 'FAIL',
      `naturalWidth=${largeImgResult.naturalW}, displayedClientWidth=${largeImgResult.displayW}`);
    await largeImgPage.close();

    // ── Duplicate-ID check on the real app after an image import ──
    const dupPage = await browser.newPage({ viewport: { width: 1024, height: 900 } });
    const dupErrors = [];
    dupPage.on('pageerror', (e) => dupErrors.push(String(e)));
    await dupPage.goto(`http://localhost:${PORT}/index.html`);
    await dupPage.waitForTimeout(600);
    const dupSectionCount = await dupPage.evaluate(() => document.querySelectorAll('#interactiveBeforeAfterSection').length);
    record('No duplicate #interactiveBeforeAfterSection before any import', dupSectionCount <= 1 ? 'PASS' : 'FAIL', `count=${dupSectionCount}`);
    const allIds = await dupPage.evaluate(() => {
      const ids = Array.from(document.querySelectorAll('[id]')).map((e) => e.id);
      return { total: ids.length, unique: new Set(ids).size };
    });
    record('No duplicate element IDs on page', allIds.total === allIds.unique ? 'PASS' : 'FAIL', `total=${allIds.total}, unique=${allIds.unique}`);
    record('No console/page errors on initial load', dupErrors.length === 0 ? 'PASS' : 'FAIL', dupErrors.length === 0 ? '(none)' : dupErrors.join('; '));
    await dupPage.close();

    record('Console errors across entire smoke test', consoleErrors.length === 0 ? 'PASS' : 'FAIL', consoleErrors.length === 0 ? '(none)' : consoleErrors.join('; '));

  } finally {
    await browser.close();
    server.close();
    try { await (await import('node:fs/promises')).unlink(path.join(PROJECT_ROOT, '_qa_harness.html')); } catch { /* best-effort cleanup */ }
  }

  const passCount = results.filter((r) => r.result === 'PASS').length;
  const failCount = results.filter((r) => r.result === 'FAIL').length;
  const output = {
    suite: 'EPIC 2E-I Phase C smoke test',
    generatedAt: new Date().toISOString(),
    summary: { total: results.length, pass: passCount, fail: failCount, notTested: results.length - passCount - failCount },
    results,
  };
  await mkdir(path.join(PROJECT_ROOT, 'qa'), { recursive: true });
  await writeFile(path.join(PROJECT_ROOT, 'qa', 'epic-2e-i-phase-c-results.json'), JSON.stringify(output, null, 2));
  console.log(`\n${passCount}/${results.length} PASS, ${failCount} FAIL`);
  console.log('Results written to qa/epic-2e-i-phase-c-results.json');
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Smoke test crashed:', err);
  process.exit(2);
});
