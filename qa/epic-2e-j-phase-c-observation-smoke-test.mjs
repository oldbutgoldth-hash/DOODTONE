#!/usr/bin/env node
/**
 * qa/epic-2e-j-phase-c-observation-smoke-test.mjs
 *
 * EPIC 2E-J Phase C — a small, bounded, reproducible smoke test for the
 * Preview Observation + Session Summary layer. Spawns its own local
 * static file server and drives a real headless Chromium session.
 *
 * PREREQUISITE: the `playwright` npm package must be resolvable from
 * this file (installed globally and linked, or locally). This project
 * has no build step and does not commit a `node_modules/` directory —
 * this script is a QA utility, not part of the shipped application.
 *
 * Run: node qa/epic-2e-j-phase-c-observation-smoke-test.mjs
 * Output: qa/epic-2e-j-phase-c-results.json
 */

import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PORT = 19998;

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
    // ── Harness page: real Observation controller/renderer/session,
    // loaded via real ES module imports from the actual project files,
    // driven with a synthetic Ready context (since the live analysis
    // pipeline never reaches Interactive "Ready" under this project's
    // current Render Plan — a pre-existing, documented limitation
    // carried forward from every prior EPIC 2E-J patch). ──
    const harnessHtml = `<!DOCTYPE html><html><head></head><body>
<div id="obsContainer" style="width:100%;max-width:500px;box-sizing:border-box"></div>
<div id="sessionContainer" style="width:100%;max-width:500px;box-sizing:border-box"></div>
<script type="module">
  import { createInteractivePreviewObservationControllerV2, normalizeReasons } from '/ui/interactive-preview-observation-controller-v2.js';
  import { createInteractivePreviewObservationSessionV2 } from '/ui/interactive-preview-observation-session-v2.js';
  import {
    ensureInteractivePreviewObservationLayout, renderInteractivePreviewObservationV2,
    ensureInteractivePreviewObservationSessionLayout, renderInteractivePreviewObservationSessionV2,
  } from '/ui/interactive-preview-observation-renderer-v2.js';

  const obsContainer = document.getElementById('obsContainer');
  const sessionContainer = document.getElementById('sessionContainer');
  const elements = ensureInteractivePreviewObservationLayout(obsContainer);
  ensureInteractivePreviewObservationSessionLayout(sessionContainer);
  window.__session = createInteractivePreviewObservationSessionV2();
  window.__normalizeReasons = normalizeReasons;

  let activeGenId = null;
  let lastSig = null;
  function syncSession(s) {
    if (s.state === 'selected') {
      const sig = String(s.observationGenerationId) + '|' + String(s.observation) + '|' + s.reasons.slice().sort().join(',');
      if (sig !== lastSig) { window.__session.recordObservation({ generationId: s.observationGenerationId, observation: s.observation, reasons: s.reasons }); lastSig = sig; }
      activeGenId = s.observationGenerationId;
    } else if (s.state === 'cleared') {
      const t = activeGenId ?? s.currentGenerationId;
      if (t !== null && t !== undefined) window.__session.removeObservation(t);
      activeGenId = null; lastSig = null;
    } else if (s.state === 'unavailable' || s.state === 'blocked') {
      if (activeGenId !== null) window.__session.invalidateGeneration(activeGenId);
      activeGenId = null; lastSig = null;
    }
    renderInteractivePreviewObservationSessionV2(sessionContainer, window.__session.getSummary());
  }

  window.__controller = createInteractivePreviewObservationControllerV2({
    ...elements, generationProvider: () => window.__gen ?? null,
    onStateChange: (s) => { renderInteractivePreviewObservationV2(obsContainer, s); syncSession(s); },
  });
  window.__gen = 1;
  window.__ready = true;
</script>
</body></html>`;
    await writeFile(path.join(PROJECT_ROOT, '_qa_j_harness.html'), harnessHtml);

    const page = await browser.newPage({ viewport: { width: 700, height: 1000 } });
    const consoleErrors = [];
    page.on('pageerror', (e) => consoleErrors.push(String(e)));
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

    await page.goto(`http://localhost:${PORT}/_qa_j_harness.html`);
    await page.waitForFunction(() => window.__ready === true);

    // ── Initial unavailable state ──
    const initialState = await page.evaluate(() => window.__controller.getState().state);
    record('Initial unavailable state', initialState === 'unavailable' ? 'PASS' : 'FAIL', `state="${initialState}"`);

    // ── Ready state ──
    await page.evaluate(() => window.__controller.setContext({ generationId: 1, interactiveState: 'ready', interactiveReady: true, safetyBlocked: false, blockedReason: null }));
    const readyState = await page.evaluate(() => window.__controller.getState().state);
    record('Ready state reachable', readyState === 'ready' ? 'PASS' : 'FAIL', `state="${readyState}"`);

    // ── All four Observation options ──
    for (const value of ['prefer-legacy', 'prefer-v2', 'no-visible-difference', 'unsure']) {
      const r = await page.evaluate((v) => window.__controller.selectObservation(v), value);
      record(`Select observation "${value}"`, r.observation === value ? 'PASS' : 'FAIL', `observation="${r.observation}"`);
    }

    // ── Reason selection + 5-limit + no-specific-reason exclusivity ──
    await page.evaluate(() => window.__controller.selectObservation('prefer-legacy'));
    await page.evaluate(() => { window.__controller.toggleReason('skin-tone'); window.__controller.toggleReason('contrast'); window.__controller.toggleReason('shadow-detail'); window.__controller.toggleReason('highlight-detail'); window.__controller.toggleReason('saturation'); });
    const at5 = await page.evaluate(() => window.__controller.getState());
    record('Five-reason limit reached', at5.reasons.length === 5 && at5.reasonLimitReached === true ? 'PASS' : 'FAIL', `count=${at5.reasons.length}, limitReached=${at5.reasonLimitReached}`);
    await page.evaluate(() => window.__controller.toggleReason('color-balance'));
    const after6th = await page.evaluate(() => window.__controller.getState().reasons.length);
    record('Sixth reason rejected', after6th === 5 ? 'PASS' : 'FAIL', `count=${after6th}`);
    await page.evaluate(() => window.__controller.toggleReason('no-specific-reason'));
    const afterGeneric = await page.evaluate(() => window.__controller.getState().reasons);
    record('No-specific-reason exclusivity', afterGeneric.length === 1 && afterGeneric[0] === 'no-specific-reason' ? 'PASS' : 'FAIL', `reasons=${JSON.stringify(afterGeneric)}`);

    // ── Clear Reasons (keeps Observation) ──
    await page.evaluate(() => window.__controller.clearReasons());
    const afterClearReasons = await page.evaluate(() => window.__controller.getState());
    record('Clear Reasons keeps Observation selected', afterClearReasons.reasons.length === 0 && afterClearReasons.observation === 'prefer-legacy' ? 'PASS' : 'FAIL', `reasons=${afterClearReasons.reasons.length}, observation="${afterClearReasons.observation}"`);

    // ── Clear Observation ──
    await page.evaluate(() => window.__controller.clearObservation());
    const afterClearObs = await page.evaluate(() => window.__controller.getState());
    record('Clear Observation', afterClearObs.observation === null ? 'PASS' : 'FAIL', `observation=${afterClearObs.observation}`);

    // ── Generation invalidation + stale-selection non-revival ──
    await page.evaluate(() => window.__controller.selectObservation('prefer-v2'));
    await page.evaluate(() => { window.__gen = 2; window.__controller.setContext({ generationId: 1, interactiveState: 'preparing', interactiveReady: false, safetyBlocked: false, blockedReason: null }); });
    const invalidatedState = await page.evaluate(() => window.__controller.getState());
    record('Generation invalidation clears Observation', invalidatedState.observation === null && invalidatedState.state === 'unavailable' ? 'PASS' : 'FAIL', `state="${invalidatedState.state}", observation=${invalidatedState.observation}`);
    await page.evaluate(() => window.__controller.setContext({ generationId: 2, interactiveState: 'ready', interactiveReady: true, safetyBlocked: false, blockedReason: null }));
    const afterRecoveryState = await page.evaluate(() => window.__controller.getState());
    record('Stale selection does not revive', afterRecoveryState.observation === null && afterRecoveryState.state === 'ready' ? 'PASS' : 'FAIL', `state="${afterRecoveryState.state}", observation=${afterRecoveryState.observation}`);

    // ── Session active/cleared/invalidated counts ──
    const sessionSummary1 = await page.evaluate(() => window.__session.getSummary());
    record('Session invalidated count', sessionSummary1.invalidated >= 1 ? 'PASS' : 'FAIL', `invalidated=${sessionSummary1.invalidated}`);
    await page.evaluate(() => window.__controller.selectObservation('unsure'));
    const sessionSummary2 = await page.evaluate(() => window.__session.getSummary());
    record('Session active count after new selection', sessionSummary2.activeObservations === 1 && sessionSummary2.unsure === 1 ? 'PASS' : 'FAIL', `active=${sessionSummary2.activeObservations}, unsure=${sessionSummary2.unsure}`);
    await page.evaluate(() => window.__controller.clearObservation());
    const sessionSummary3 = await page.evaluate(() => window.__session.getSummary());
    record('Session cleared count', sessionSummary3.cleared >= 1 ? 'PASS' : 'FAIL', `cleared=${sessionSummary3.cleared}`);

    // ── Session clear + re-record ──
    await page.evaluate(() => window.__controller.selectObservation('prefer-legacy'));
    await page.evaluate(() => { window.__session.clearSession(); });
    const afterSessionClearRaw = await page.evaluate(() => window.__session.getSummary());
    record('Session module clearSession clears history', afterSessionClearRaw.totalObserved === 0 ? 'PASS' : 'FAIL', `totalObserved=${afterSessionClearRaw.totalObserved}`);

    // ── Provider unavailable warning ──
    const providerUnavailablePage = await browser.newPage({ viewport: { width: 700, height: 800 } });
    await providerUnavailablePage.goto(`http://localhost:${PORT}/_qa_j_harness.html`);
    await providerUnavailablePage.waitForFunction(() => window.__ready === true);
    await providerUnavailablePage.evaluate(() => {
      window.__controller.dispose();
    });
    const providerTestResult = await providerUnavailablePage.evaluate(() => {
      // Create a fresh controller with a throwing provider to test the neutral warning path.
      return import('/ui/interactive-preview-observation-controller-v2.js').then(({ createInteractivePreviewObservationControllerV2 }) => {
        const c = createInteractivePreviewObservationControllerV2({ generationProvider: () => { throw new Error('down'); } });
        c.setContext({ generationId: 1, interactiveState: 'ready', interactiveReady: true, safetyBlocked: false, blockedReason: null });
        const s = c.getState();
        c.dispose();
        return { state: s.state, generationConfirmed: s.metadata.generationConfirmed, warnings: s.warnings };
      });
    });
    record('Provider unavailable produces neutral warning, stays usable', providerTestResult.state === 'ready' && providerTestResult.generationConfirmed === false && providerTestResult.warnings.length > 0 ? 'PASS' : 'FAIL', JSON.stringify(providerTestResult));
    await providerUnavailablePage.close();

    // ── Provider mismatch ──
    const mismatchResult = await page.evaluate(() => {
      return import('/ui/interactive-preview-observation-controller-v2.js').then(({ createInteractivePreviewObservationControllerV2 }) => {
        let gen = 1;
        const c = createInteractivePreviewObservationControllerV2({ generationProvider: () => gen });
        c.setContext({ generationId: 1, interactiveState: 'ready', interactiveReady: true, safetyBlocked: false, blockedReason: null });
        c.selectObservation('prefer-legacy');
        gen = 2;
        const r = c.getState();
        c.dispose();
        return { state: r.state, observation: r.observation };
      });
    });
    record('Provider mismatch clears observation via getState', mismatchResult.state === 'unavailable' && mismatchResult.observation === null ? 'PASS' : 'FAIL', JSON.stringify(mismatchResult));

    // ── No duplicate IDs ──
    const dupIds = await page.evaluate(() => {
      const ids = Array.from(document.querySelectorAll('[id]')).map((e) => e.id);
      return { total: ids.length, unique: new Set(ids).size };
    });
    record('No duplicate element IDs', dupIds.total === dupIds.unique ? 'PASS' : 'FAIL', `total=${dupIds.total}, unique=${dupIds.unique}`);

    // ── Keyboard focus ──
    await page.evaluate(() => { window.__gen = 3; window.__controller.setContext({ generationId: 3, interactiveState: 'ready', interactiveReady: true, safetyBlocked: false, blockedReason: null }); });
    await page.locator('#ipoOption_prefer-legacy').focus();
    const focusedId = await page.evaluate(() => document.activeElement.id);
    record('Keyboard focus reaches radio option', focusedId === 'ipoOption_prefer-legacy' ? 'PASS' : 'FAIL', `activeElement.id="${focusedId}"`);

    // ── No storage writes from Observation actions ──
    const storageCheck = await page.evaluate(() => {
      const lsCountBefore = localStorage.length;
      const ssCountBefore = sessionStorage.length;
      window.__controller.selectObservation('prefer-v2');
      window.__controller.toggleReason('contrast');
      window.__controller.clearReasons();
      window.__controller.clearObservation();
      return { lsSame: localStorage.length === lsCountBefore, ssSame: sessionStorage.length === ssCountBefore };
    });
    record('No storage writes from Observation actions', storageCheck.lsSame && storageCheck.ssSame ? 'PASS' : 'FAIL', JSON.stringify(storageCheck));

    // ── No Canvas/drawImage calls from Observation actions ──
    const canvasCheck = await page.evaluate(() => {
      let drawCalls = 0;
      const orig = CanvasRenderingContext2D.prototype.drawImage;
      CanvasRenderingContext2D.prototype.drawImage = function (...args) { drawCalls++; return orig.apply(this, args); };
      window.__controller.selectObservation('unsure');
      window.__controller.toggleReason('natural-look');
      window.__controller.clearObservation();
      CanvasRenderingContext2D.prototype.drawImage = orig;
      return drawCalls;
    });
    record('No Canvas drawImage calls from Observation actions', canvasCheck === 0 ? 'PASS' : 'FAIL', `drawImage calls=${canvasCheck}`);

    // ── No network requests from Observation actions ──
    const networkRequests = [];
    page.on('request', (req) => networkRequests.push(req.url()));
    const beforeCount = networkRequests.length;
    await page.evaluate(() => { window.__controller.selectObservation('prefer-legacy'); window.__controller.toggleReason('contrast'); });
    await page.waitForTimeout(200);
    record('No network requests from Observation actions', networkRequests.length === beforeCount ? 'PASS' : 'FAIL', `requests fired=${networkRequests.length - beforeCount}`);

    await page.close();

    // ── Responsive: 320/390/desktop ──
    for (const width of [320, 390, 1440]) {
      const p = await browser.newPage({ viewport: { width, height: 900 } });
      const pErrors = [];
      p.on('pageerror', (e) => pErrors.push(String(e)));
      await p.goto(`http://localhost:${PORT}/_qa_j_harness.html`);
      await p.waitForFunction(() => window.__ready === true);
      await p.evaluate(() => window.__controller.setContext({ generationId: 1, interactiveState: 'ready', interactiveReady: true, safetyBlocked: false, blockedReason: null }));
      const overflow = await p.evaluate(() => ({ scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth }));
      record(`No document horizontal overflow at ${width}px`, overflow.scrollW <= overflow.clientW ? 'PASS' : 'FAIL', `scrollWidth=${overflow.scrollW}, clientWidth=${overflow.clientW}`);
      await p.close();
    }

    record('Console errors across entire smoke test', consoleErrors.length === 0 ? 'PASS' : 'FAIL', consoleErrors.length === 0 ? '(none)' : consoleErrors.join('; '));

  } finally {
    await browser.close();
    server.close();
    try { await (await import('node:fs/promises')).unlink(path.join(PROJECT_ROOT, '_qa_j_harness.html')); } catch { /* best-effort cleanup */ }
  }

  const passCount = results.filter((r) => r.result === 'PASS').length;
  const failCount = results.filter((r) => r.result === 'FAIL').length;
  const output = {
    suite: 'EPIC 2E-J Phase C Observation smoke test',
    generatedAt: new Date().toISOString(),
    summary: { total: results.length, pass: passCount, fail: failCount, notTested: results.length - passCount - failCount },
    results,
  };
  await mkdir(path.join(PROJECT_ROOT, 'qa'), { recursive: true });
  await writeFile(path.join(PROJECT_ROOT, 'qa', 'epic-2e-j-phase-c-results.json'), JSON.stringify(output, null, 2));
  console.log(`\n${passCount}/${results.length} PASS, ${failCount} FAIL`);
  console.log('Results written to qa/epic-2e-j-phase-c-results.json');
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Smoke test crashed:', err);
  process.exit(2);
});
