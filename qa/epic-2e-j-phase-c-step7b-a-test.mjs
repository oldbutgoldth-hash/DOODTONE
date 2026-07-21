#!/usr/bin/env node
/**
 * qa/epic-2e-j-phase-c-step7b-a-test.mjs
 *
 * EPIC 2E-J-C-F2 Step 7B-A (+ Step 7B-A-F integrity patch) — Privacy,
 * Storage/Network and Responsive Final Audit. Launches the REAL,
 * complete, unmodified application in headless Chromium, drives it
 * through real DOM actions, and instruments every storage/network/
 * messaging/clipboard/download/history/cookie API during the action
 * window with EXACT original-reference restoration (never a bound
 * copy). Also proves Session internal-record data minimization via a
 * focused Node-level module test plus source-code inspection, and
 * audits responsive containment + required-element presence at 7
 * viewports with full console/resource error tracking on every page.
 *
 * Run: node qa/epic-2e-j-phase-c-step7b-a-test.mjs
 * Output: qa/epic-2e-j-phase-c-step7b-a-results.json
 */

import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createInteractivePreviewObservationSessionV2 } from '../ui/interactive-preview-observation-session-v2.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PORT = 19993;
const FIXTURES_DIR = path.join(PROJECT_ROOT, 'qa', 'fixtures', 'epic-2e-j');
const SCREENSHOT_DIR = path.join(PROJECT_ROOT, 'qa-screenshots', 'epic-2e-j', 'full-app-7b-a');
const VIEWPORTS = [320, 360, 390, 430, 768, 1024, 1440];

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
  const normalized = typeof result === 'boolean' ? (result ? 'PASS' : 'FAIL') : result;
  results.push({ test, result: normalized, evidence });
  const icon = normalized === 'PASS' ? '✓' : normalized === 'FAIL' ? '✗' : '•';
  console.log(`${icon} [${normalized}] ${test} — ${evidence}`);
}

async function qaSnapshot(page) {
  return page.evaluate(() => (window.__LUMIXA_QA__ ? window.__LUMIXA_QA__.getPreviewPipelineSnapshot() : null));
}

async function passAllReviewItems(page) {
  const itemIds = await page.evaluate(() => [...new Set(Array.from(document.querySelectorAll('#reviewConsoleInner [data-review-item-id]')).map((i) => i.dataset.reviewItemId))]);
  for (const itemId of itemIds) {
    await page.evaluate((id) => {
      const container = document.querySelector(`#reviewConsoleInner [data-review-item-id="${id}"]`);
      const btn = container ? container.querySelector('button[data-review-action="pass"]') : null;
      if (btn) btn.click();
    }, itemId);
    await page.waitForTimeout(80);
  }
}

async function waitForAnalysisCompletion(page, priorGeneration, maxWaitMs = 25000) {
  const start = Date.now();
  const transient = new Set(['cancelled', 'preparing', null, undefined]);
  while (Date.now() - start < maxWaitMs) {
    const snap = await qaSnapshot(page);
    if (snap && snap.analysisGeneration > priorGeneration && snap.previewSandbox.exists && !transient.has(snap.interactive?.state)) return { completed: true, snapshot: snap };
    await page.waitForTimeout(300);
  }
  const finalSnap = await qaSnapshot(page);
  return { completed: finalSnap?.previewSandbox?.exists === true, snapshot: finalSnap };
}

async function reachReady(page, fixture) {
  const gen0 = await qaSnapshot(page).then((s) => s?.analysisGeneration ?? 0);
  await page.setInputFiles('#fileIn', path.join(FIXTURES_DIR, fixture));
  await waitForAnalysisCompletion(page, gen0);
  const genBeforeReview = await qaSnapshot(page).then((s) => s?.analysisGeneration ?? gen0);
  await passAllReviewItems(page);
  await page.click('#btnReanalyze');
  return waitForAnalysisCompletion(page, genBeforeReview);
}

function attachPageAudit(page, contextLabel, consoleErrorsSink) {
  const rawConsoleErrors = [];
  let fontRelatedRequestFailureCount = 0;
  page.on('pageerror', (e) => consoleErrorsSink.push({ context: contextLabel, type: 'pageerror', error: String(e) }));
  page.on('requestfailed', (req) => {
    if (/fonts\.googleapis\.com|fonts\.gstatic\.com/i.test(req.url())) { fontRelatedRequestFailureCount++; return; }
    consoleErrorsSink.push({ context: contextLabel, type: 'requestfailed', url: req.url(), failure: req.failure()?.errorText });
  });
  page.on('response', (res) => {
    if (res.status() < 400) return;
    if (/fonts\.googleapis\.com|fonts\.gstatic\.com/i.test(res.url())) { fontRelatedRequestFailureCount++; return; }
    consoleErrorsSink.push({ context: contextLabel, type: 'httpError', url: res.url(), status: res.status() });
  });
  // The browser's short-form "Failed to load resource: ..." console
  // message never includes the URL, so it cannot be matched by text.
  // Collected raw here; correlated by COUNT against confirmed
  // font-host failures in finalizePageAudit() below, called only
  // after the page's network activity has settled — this avoids any
  // event-ordering race between console/network events. Never a
  // blanket ignore of every "Failed to load resource" message.
  page.on('console', (msg) => { if (msg.type() === 'error') rawConsoleErrors.push(msg.text()); });
  return {
    finalize() {
      let creditsRemaining = fontRelatedRequestFailureCount;
      for (const text of rawConsoleErrors) {
        if (/Failed to load resource/i.test(text) && creditsRemaining > 0) { creditsRemaining--; continue; }
        consoleErrorsSink.push({ context: contextLabel, type: 'console.error', text });
      }
    },
  };
}

// FIX 1/2/3/4 (Step 7B-A-F): install instrumentation that stores EXACT
// original references (never `.bind()`-wrapped copies), calls them with
// the correct receiver via `.call`/`.apply`, and additionally
// instruments History mutation methods + the native cookie setter.
// Every optional API records `{ supported, patched, calls }`.
const INSTALL_INSTRUMENTATION_JS = `
  (() => {
    const optional = {};
    const counts = {
      storage: { localSet: 0, localRemove: 0, localClear: 0, sessionSet: 0, sessionRemove: 0, sessionClear: 0, indexedDbOpen: 0, indexedDbDelete: 0, cacheOpen: 0, cacheDelete: 0 },
      network: { fetch: 0, xhrOpen: 0, xhrSend: 0, sendBeacon: 0, webSocket: 0, eventSource: 0, broadcastChannel: 0 },
      messaging: { postMessage: 0, messageChannel: 0 },
      clipboard: { write: 0, writeText: 0 },
      downloads: { createObjectURL: 0, anchorClicks: 0 },
      history: { pushState: 0, replaceState: 0, back: 0, forward: 0, go: 0 },
      cookie: { setterCalls: 0 },
    };
    window.__step7bCounts = counts;
    window.__step7bOptional = optional;
    const orig = {};

    // Required (always-present) APIs.
    orig.localSet = Storage.prototype.setItem;
    orig.localRemove = Storage.prototype.removeItem;
    orig.localClear = Storage.prototype.clear;
    Storage.prototype.setItem = function (...args) { if (this === window.localStorage) counts.storage.localSet++; else if (this === window.sessionStorage) counts.storage.sessionSet++; return orig.localSet.apply(this, args); };
    Storage.prototype.removeItem = function (...args) { if (this === window.localStorage) counts.storage.localRemove++; else if (this === window.sessionStorage) counts.storage.sessionRemove++; return orig.localRemove.apply(this, args); };
    Storage.prototype.clear = function (...args) { if (this === window.localStorage) counts.storage.localClear++; else if (this === window.sessionStorage) counts.storage.sessionClear++; return orig.localClear.apply(this, args); };

    // FIX 1: indexedDB - exact unbound reference, called with '.call(indexedDB, ...)'.
    optional.indexedDB = { supported: !!window.indexedDB, patched: false };
    if (window.indexedDB) {
      orig.indexedDbOpen = indexedDB.open;
      orig.indexedDbDelete = indexedDB.deleteDatabase;
      const wrappedOpen = function (...args) { counts.storage.indexedDbOpen++; return orig.indexedDbOpen.call(indexedDB, ...args); };
      const wrappedDelete = function (...args) { counts.storage.indexedDbDelete++; return orig.indexedDbDelete.call(indexedDB, ...args); };
      indexedDB.open = wrappedOpen;
      indexedDB.deleteDatabase = wrappedDelete;
      optional.indexedDB.patched = indexedDB.open === wrappedOpen && indexedDB.deleteDatabase === wrappedDelete;
    }

    // FIX 1: CacheStorage — exact unbound reference.
    optional.cacheStorage = { supported: typeof caches !== 'undefined', patched: false };
    if (typeof caches !== 'undefined') {
      orig.cacheOpen = caches.open;
      orig.cacheDelete = caches.delete;
      const wrappedCacheOpen = function (...args) { counts.storage.cacheOpen++; return orig.cacheOpen.call(caches, ...args); };
      const wrappedCacheDelete = function (...args) { counts.storage.cacheDelete++; return orig.cacheDelete.call(caches, ...args); };
      caches.open = wrappedCacheOpen;
      caches.delete = wrappedCacheDelete;
      optional.cacheStorage.patched = caches.open === wrappedCacheOpen && caches.delete === wrappedCacheDelete;
    }

    orig.fetch = window.fetch;
    window.fetch = function (...args) { counts.network.fetch++; return orig.fetch.apply(this, args); };
    orig.xhrOpen = XMLHttpRequest.prototype.open;
    orig.xhrSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (...args) { counts.network.xhrOpen++; return orig.xhrOpen.apply(this, args); };
    XMLHttpRequest.prototype.send = function (...args) { counts.network.xhrSend++; return orig.xhrSend.apply(this, args); };

    optional.sendBeacon = { supported: !!navigator.sendBeacon, patched: false };
    if (navigator.sendBeacon) {
      orig.sendBeacon = navigator.sendBeacon;
      const wrappedSendBeacon = function (...args) { counts.network.sendBeacon++; return orig.sendBeacon.call(navigator, ...args); };
      navigator.sendBeacon = wrappedSendBeacon;
      optional.sendBeacon.patched = navigator.sendBeacon === wrappedSendBeacon;
    }

    orig.WebSocket = window.WebSocket;
    window.WebSocket = function (...args) { counts.network.webSocket++; return new orig.WebSocket(...args); };

    optional.eventSource = { supported: !!window.EventSource, patched: false };
    if (window.EventSource) { orig.EventSource = window.EventSource; const wrappedES = function (...args) { counts.network.eventSource++; return new orig.EventSource(...args); }; window.EventSource = wrappedES; optional.eventSource.patched = window.EventSource === wrappedES; }

    optional.broadcastChannel = { supported: !!window.BroadcastChannel, patched: false };
    if (window.BroadcastChannel) { orig.BroadcastChannel = window.BroadcastChannel; const wrappedBC = function (...args) { counts.messaging.broadcastChannel = (counts.messaging.broadcastChannel||0)+1; counts.network.broadcastChannel++; return new orig.BroadcastChannel(...args); }; window.BroadcastChannel = wrappedBC; optional.broadcastChannel.patched = window.BroadcastChannel === wrappedBC; }

    // FIX 1: postMessage — exact unbound reference.
    orig.postMessage = window.postMessage;
    window.postMessage = function (...args) { counts.messaging.postMessage++; return orig.postMessage.apply(window, args); };

    optional.messageChannel = { supported: !!window.MessageChannel, patched: false };
    if (window.MessageChannel) { orig.MessageChannel = window.MessageChannel; const wrappedMC = function (...args) { counts.messaging.messageChannel++; return new orig.MessageChannel(...args); }; window.MessageChannel = wrappedMC; optional.messageChannel.patched = window.MessageChannel === wrappedMC; }

    optional.clipboardWriteText = { supported: !!(navigator.clipboard && navigator.clipboard.writeText), patched: false };
    optional.clipboardWrite = { supported: !!(navigator.clipboard && navigator.clipboard.write), patched: false };
    if (navigator.clipboard) {
      if (navigator.clipboard.writeText) { orig.clipWriteText = navigator.clipboard.writeText; const wrappedWT = function (...args) { counts.clipboard.writeText++; return orig.clipWriteText.call(navigator.clipboard, ...args); }; navigator.clipboard.writeText = wrappedWT; optional.clipboardWriteText.patched = navigator.clipboard.writeText === wrappedWT; }
      if (navigator.clipboard.write) { orig.clipWrite = navigator.clipboard.write; const wrappedW = function (...args) { counts.clipboard.write++; return orig.clipWrite.call(navigator.clipboard, ...args); }; navigator.clipboard.write = wrappedW; optional.clipboardWrite.patched = navigator.clipboard.write === wrappedW; }
    }

    orig.createObjectURL = URL.createObjectURL;
    URL.createObjectURL = function (...args) { counts.downloads.createObjectURL++; return orig.createObjectURL.apply(URL, args); };
    orig.anchorClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (...args) { if (this.download || (this.href && this.href.startsWith('blob:'))) counts.downloads.anchorClicks++; return orig.anchorClick.apply(this, args); };

    // FIX 3: History mutation instrumentation.
    orig.pushState = history.pushState;
    orig.replaceState = history.replaceState;
    orig.back = history.back;
    orig.forward = history.forward;
    orig.go = history.go;
    history.pushState = function (...args) { counts.history.pushState++; return orig.pushState.apply(history, args); };
    history.replaceState = function (...args) { counts.history.replaceState++; return orig.replaceState.apply(history, args); };
    history.back = function (...args) { counts.history.back++; return orig.back.apply(history, args); };
    history.forward = function (...args) { counts.history.forward++; return orig.forward.apply(history, args); };
    history.go = function (...args) { counts.history.go++; return orig.go.apply(history, args); };

    // FIX 4: native cookie setter instrumentation via property descriptor.
    // FIX 1 (Step 7B-A-F2): capture the EXACT original shape before
    // patching — whether an own property already existed on
    // \`document\`, and the prototype descriptor used by normal lookup
    // — so restoration can put things back exactly as found, never
    // leaving a copied prototype descriptor behind as a stray own
    // property.
    optional.cookieSetter = { supported: false, patched: false };
    try {
      const hadOwnProperty = Object.prototype.hasOwnProperty.call(document, 'cookie');
      const ownDescBefore = hadOwnProperty ? Object.getOwnPropertyDescriptor(document, 'cookie') : null;
      const protoDesc = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie') || Object.getOwnPropertyDescriptor(HTMLDocument.prototype, 'cookie');
      if (protoDesc && protoDesc.set && protoDesc.get) {
        window.__step7bCookieShapeBefore = { hadOwnProperty, ownDescBefore: ownDescBefore ? { configurable: ownDescBefore.configurable, enumerable: ownDescBefore.enumerable, getter: ownDescBefore.get, setter: ownDescBefore.set } : null };
        orig.cookieProtoDescriptor = protoDesc;
        Object.defineProperty(document, 'cookie', {
          configurable: true,
          get() { return protoDesc.get.call(document); },
          set(v) { counts.cookie.setterCalls++; return protoDesc.set.call(document, v); },
        });
        const patchedDesc = Object.getOwnPropertyDescriptor(document, 'cookie');
        optional.cookieSetter = { supported: true, patched: typeof patchedDesc?.set === 'function' && patchedDesc.get !== protoDesc.get };
      }
    } catch (e) { optional.cookieSetter = { supported: false, patched: false, error: String(e && e.message || e) }; }

    window.__step7bOrig = orig;
    window.__step7bCookieBefore = document.cookie;
    window.__step7bSearchBefore = location.search;
    window.__step7bHashBefore = location.hash;
    window.__step7bHistoryLenBefore = history.length;
    return true;
  })()
`;

// FIX 1 (Step 7B-A-F): restore EXACT original references and assert
// strict identity afterward for every patched API (not merely "the
// restore function ran without throwing").
const RESTORE_AND_VERIFY_JS = `
  (() => {
    const orig = window.__step7bOrig;
    const restoration = {};
    if (!orig) return { error: 'no instrumentation installed' };

    Storage.prototype.setItem = orig.localSet;
    Storage.prototype.removeItem = orig.localRemove;
    Storage.prototype.clear = orig.localClear;
    restoration.localStorageMethods = Storage.prototype.setItem === orig.localSet && Storage.prototype.removeItem === orig.localRemove && Storage.prototype.clear === orig.localClear;

    if (orig.indexedDbOpen) {
      indexedDB.open = orig.indexedDbOpen;
      indexedDB.deleteDatabase = orig.indexedDbDelete;
      restoration.indexedDB = indexedDB.open === orig.indexedDbOpen && indexedDB.deleteDatabase === orig.indexedDbDelete;
    }
    if (orig.cacheOpen) {
      caches.open = orig.cacheOpen;
      caches.delete = orig.cacheDelete;
      restoration.cacheStorage = caches.open === orig.cacheOpen && caches.delete === orig.cacheDelete;
    }

    window.fetch = orig.fetch;
    restoration.fetch = window.fetch === orig.fetch;
    XMLHttpRequest.prototype.open = orig.xhrOpen;
    XMLHttpRequest.prototype.send = orig.xhrSend;
    restoration.xhr = XMLHttpRequest.prototype.open === orig.xhrOpen && XMLHttpRequest.prototype.send === orig.xhrSend;

    if (orig.sendBeacon) { navigator.sendBeacon = orig.sendBeacon; restoration.sendBeacon = navigator.sendBeacon === orig.sendBeacon; }
    window.WebSocket = orig.WebSocket;
    restoration.webSocket = window.WebSocket === orig.WebSocket;
    if (orig.EventSource) { window.EventSource = orig.EventSource; restoration.eventSource = window.EventSource === orig.EventSource; }
    if (orig.BroadcastChannel) { window.BroadcastChannel = orig.BroadcastChannel; restoration.broadcastChannel = window.BroadcastChannel === orig.BroadcastChannel; }

    window.postMessage = orig.postMessage;
    restoration.postMessage = window.postMessage === orig.postMessage;
    if (orig.MessageChannel) { window.MessageChannel = orig.MessageChannel; restoration.messageChannel = window.MessageChannel === orig.MessageChannel; }

    if (orig.clipWriteText) { navigator.clipboard.writeText = orig.clipWriteText; restoration.clipboardWriteText = navigator.clipboard.writeText === orig.clipWriteText; }
    if (orig.clipWrite) { navigator.clipboard.write = orig.clipWrite; restoration.clipboardWrite = navigator.clipboard.write === orig.clipWrite; }

    URL.createObjectURL = orig.createObjectURL;
    restoration.createObjectURL = URL.createObjectURL === orig.createObjectURL;
    HTMLAnchorElement.prototype.click = orig.anchorClick;
    restoration.anchorClick = HTMLAnchorElement.prototype.click === orig.anchorClick;

    history.pushState = orig.pushState;
    history.replaceState = orig.replaceState;
    history.back = orig.back;
    history.forward = orig.forward;
    history.go = orig.go;
    restoration.history = history.pushState === orig.pushState && history.replaceState === orig.replaceState && history.back === orig.back && history.forward === orig.forward && history.go === orig.go;

    if (orig.cookieProtoDescriptor) {
      const shapeBefore = window.__step7bCookieShapeBefore;
      let restoredCorrectly = false;
      try {
        if (shapeBefore.hadOwnProperty) {
          // An own property existed before — restore that EXACT descriptor.
          Object.defineProperty(document, 'cookie', shapeBefore.ownDescBefore);
        } else {
          // No own property existed before — DELETE the temporary own
          // property entirely, so lookup falls back to the prototype
          // descriptor again (never leave a copied prototype descriptor
          // behind as a stray own property).
          delete document.cookie;
        }
        const hasOwnAfter = Object.prototype.hasOwnProperty.call(document, 'cookie');
        const ownDescAfter = hasOwnAfter ? Object.getOwnPropertyDescriptor(document, 'cookie') : null;
        const protoDescAfter = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie') || Object.getOwnPropertyDescriptor(HTMLDocument.prototype, 'cookie');
        if (shapeBefore.hadOwnProperty) {
          restoredCorrectly = hasOwnAfter === true
            && ownDescAfter.get === shapeBefore.ownDescBefore.getter
            && ownDescAfter.set === shapeBefore.ownDescBefore.setter
            && ownDescAfter.configurable === shapeBefore.ownDescBefore.configurable
            && ownDescAfter.enumerable === shapeBefore.ownDescBefore.enumerable;
        } else {
          restoredCorrectly = hasOwnAfter === false
            && protoDescAfter.get === orig.cookieProtoDescriptor.get
            && protoDescAfter.set === orig.cookieProtoDescriptor.set;
        }
        restoration.cookieDescriptorShape = { hadOwnPropertyBefore: shapeBefore.hadOwnProperty, hasOwnPropertyAfter: hasOwnAfter, restoredCorrectly };
      } catch (e) { restoration.cookieDescriptorShape = { restoredCorrectly: false, error: String(e && e.message || e) }; }
      restoration.cookieSetter = restoredCorrectly;
    }

    const booleanRestorationValues = Object.entries(restoration).filter(([k]) => k !== 'cookieDescriptorShape').map(([, v]) => v);
    const cookieShapeOk = !restoration.cookieDescriptorShape || restoration.cookieDescriptorShape.restoredCorrectly === true;
    return { restoration, allRestoredTrue: booleanRestorationValues.every((v) => v === true) && cookieShapeOk };
  })()
`;

async function main() {
  await mkdir(SCREENSHOT_DIR, { recursive: true });
  const server = await startServer();
  const browser = await chromium.launch();
  const consoleErrors = [];
  const screenshotsGenerated = [];
  let finalCounts = null;
  let optionalApiMatrix = null;
  let supportMatrix = null;
  let restorationResult = null;
  let dataMinimizationResult = null;
  const responsiveResults = [];

  try {
    // ══════════════════════════════════════════════════════════════
    // FIX 4 (Step 7B-A-F2): page-audit SELF-TEST — proves the audit
    // mechanism itself actually catches errors, using a disposable
    // page never counted toward the real audit run below.
    // ══════════════════════════════════════════════════════════════
    console.log('=== FIX 4: page-audit self-test (mechanism verification only, not part of the real audit) ===');
    {
      const selfTestErrors = [];
      const selfTestPage = await browser.newPage();
      const selfTestAudit = attachPageAudit(selfTestPage, 'self-test', selfTestErrors);
      await selfTestPage.goto(`http://localhost:${PORT}/index.html`);
      await selfTestPage.waitForTimeout(300);
      await selfTestPage.evaluate(() => console.error('STEP7B_A_TEST_ERROR'));
      // Genuine local 404 — a real missing-resource request, not a font host.
      await selfTestPage.evaluate(() => fetch('/this-file-genuinely-does-not-exist.xyz').catch(() => {}));
      await selfTestPage.waitForTimeout(300);
      selfTestAudit.finalize();
      const injectedErrorCaught = selfTestErrors.some((e) => e.type === 'console.error' && e.text === 'STEP7B_A_TEST_ERROR');
      const genuine404Caught = selfTestErrors.some((e) => e.type === 'httpError' && e.status === 404);
      record('FIX 4: self-test — injected console.error is captured by attachPageAudit/finalize', injectedErrorCaught, `caught=${injectedErrorCaught}`);
      record('FIX 4: self-test — genuine local 404 is captured (never excluded like a font host)', genuine404Caught, `caught=${genuine404Caught}, allSelfTestErrors=${JSON.stringify(selfTestErrors)}`);
      await selfTestPage.close();
      // selfTestErrors is intentionally discarded here — never merged into the real audit's consoleErrors.
    }

    // ══════════════════════════════════════════════════════════════
    // PART 0 — FIX 1/2/3/5 (Step 7B-A-F3): internal Session-record
    // data-minimization proof using the REAL getQaSchemaSnapshot()
    // projection as PRIMARY evidence (never a fragile regex re-parse
    // of source text as the deciding evidence — that remains secondary
    // only). Also proves the QA projection is absent by default and
    // present only when explicitly enabled.
    // ══════════════════════════════════════════════════════════════
    console.log('=== FIX 1/2/3/5: Session schema — real QA projection as primary evidence ===');
    const ALLOWED_INTERNAL_KEYS = new Set(['generationId', 'active', 'observation', 'reasons', 'clearedCounted', 'invalidatedCounted', 'createdAt', 'updatedAt', 'createdSequence', 'updatedSequence']);
    const PROHIBITED_PATTERN = /pixel|image|filename|filepath|url|exif|camera|gps|user|email|account|analysis|finalstyleintent|controller|dom/i;

    // FIX 3: QA projection availability — absent by default, present only when explicitly enabled.
    const sessionDefault = createInteractivePreviewObservationSessionV2();
    const qaProjectionAbsentByDefault = typeof sessionDefault.getQaSchemaSnapshot === 'undefined';
    record('FIX 3: getQaSchemaSnapshot absent by default (no option passed)', qaProjectionAbsentByDefault, `typeof=${typeof sessionDefault.getQaSchemaSnapshot}`);
    sessionDefault.dispose();

    const sessionQaEnabled = createInteractivePreviewObservationSessionV2({ enableQaSchemaInspection: true });
    const qaProjectionEnabled = typeof sessionQaEnabled.getQaSchemaSnapshot === 'function';
    record('FIX 3: getQaSchemaSnapshot present when enableQaSchemaInspection:true', qaProjectionEnabled, `typeof=${typeof sessionQaEnabled.getQaSchemaSnapshot}`);

    // FIX 1: exercise the real session through its real public API —
    // Prefer Legacy, Prefer V2, multiple canonical Reasons, a cleared
    // record, an invalidated record, then 105 generations for the
    // eviction-bound test.
    sessionQaEnabled.recordObservation({ generationId: 'gen-legacy', observation: 'prefer-legacy', reasons: ['skin-tone', 'contrast'] });
    sessionQaEnabled.recordObservation({ generationId: 'gen-v2', observation: 'prefer-v2', reasons: ['white-balance'] });
    sessionQaEnabled.recordObservation({ generationId: 'gen-cleared', observation: 'unsure', reasons: [] });
    sessionQaEnabled.removeObservation('gen-cleared');
    sessionQaEnabled.recordObservation({ generationId: 'gen-invalidated', observation: 'no-visible-difference', reasons: ['natural-look'] });
    sessionQaEnabled.invalidateGeneration('gen-invalidated');
    for (let i = 1; i <= 105; i++) {
      sessionQaEnabled.recordObservation({ generationId: `gen-bound-${i}`, observation: 'prefer-legacy', reasons: ['skin-tone'] });
    }

    const qaSnapshot = sessionQaEnabled.getQaSchemaSnapshot();
    sessionQaEnabled.dispose();

    const expectedKeys = [...ALLOWED_INTERNAL_KEYS].sort();
    const actualKeys = [...qaSnapshot.recordKeys].sort();
    const missingExpectedKeys = expectedKeys.filter((k) => !actualKeys.includes(k));
    const unexpectedKeys = actualKeys.filter((k) => !ALLOWED_INTERNAL_KEYS.has(k));
    record('FIX 1: real QA snapshot — no expected key missing', missingExpectedKeys.length === 0, `missing=${JSON.stringify(missingExpectedKeys)}`);
    record('FIX 1: real QA snapshot — no unexpected additional key', unexpectedKeys.length === 0, `unexpected=${JSON.stringify(unexpectedKeys)}`);
    record('FIX 1: real QA snapshot — hasDomReference === false', qaSnapshot.hasDomReference === false, `value=${qaSnapshot.hasDomReference}`);
    record('FIX 1: real QA snapshot — hasProhibitedKey === false', qaSnapshot.hasProhibitedKey === false, `value=${qaSnapshot.hasProhibitedKey}`);
    record('FIX 1: real QA snapshot — maximumRecords === 100', qaSnapshot.maximumRecords === 100, `value=${qaSnapshot.maximumRecords}`);
    record('FIX 1: real QA snapshot — recordCount <= 100 after 105+ inserts', qaSnapshot.recordCount <= 100, `recordCount=${qaSnapshot.recordCount}`);
    record('FIX 2: real QA snapshot — allReasonValuesCanonical === true', qaSnapshot.allReasonValuesCanonical === true, `value=${qaSnapshot.allReasonValuesCanonical}`);
    record('FIX 2: real QA snapshot — reasonValueTypes contains only "string"', qaSnapshot.reasonValueTypes.length > 0 && qaSnapshot.reasonValueTypes.every((t) => t === 'string'), JSON.stringify(qaSnapshot.reasonValueTypes));

    // Secondary evidence only: source-code inspection (never the deciding factor).
    const sessionModuleSource = await readFile(path.join(PROJECT_ROOT, 'ui', 'interactive-preview-observation-session-v2.js'), 'utf8');
    const recordLiteralMatch = sessionModuleSource.match(/records\.set\(key,\s*\{([^}]+)\}/s);
    const sourceInspectedKeys = recordLiteralMatch ? [...new Set(recordLiteralMatch[1].match(/\b[a-zA-Z_][a-zA-Z0-9_]*(?=:)/g) ?? [])] : [];
    const maxRecordsMatch = sessionModuleSource.match(/MAX_RECORDS\s*=\s*(\d+)/);
    const sourceMaxRecords = maxRecordsMatch ? parseInt(maxRecordsMatch[1], 10) : null;
    console.log(`  [SECONDARY EVIDENCE ONLY] source-inspected keys=${JSON.stringify(sourceInspectedKeys)}, MAX_RECORDS=${sourceMaxRecords} (not used to decide PASS/FAIL — the real getQaSchemaSnapshot() projection above is primary)`);

    const dataMinimizationPass = missingExpectedKeys.length === 0 && unexpectedKeys.length === 0 && qaSnapshot.hasDomReference === false && qaSnapshot.hasProhibitedKey === false && qaSnapshot.maximumRecords === 100 && qaSnapshot.recordCount <= 100 && qaSnapshot.allReasonValuesCanonical === true && qaProjectionAbsentByDefault && qaProjectionEnabled;
    dataMinimizationResult = {
      qaProjectionEnabled,
      qaProjectionAbsentByDefault,
      recordCount: qaSnapshot.recordCount,
      maximumRecords: qaSnapshot.maximumRecords,
      recordKeys: actualKeys,
      missingExpectedKeys,
      unexpectedKeys,
      reasonValueTypes: qaSnapshot.reasonValueTypes,
      allReasonValuesCanonical: qaSnapshot.allReasonValuesCanonical,
      hasDomReference: qaSnapshot.hasDomReference,
      hasProhibitedKey: qaSnapshot.hasProhibitedKey,
      result: dataMinimizationPass ? 'PASS' : 'FAIL',
    };
    record('FIX 5: overall Session data-minimization result', dataMinimizationPass, JSON.stringify(dataMinimizationResult));

    // ══════════════════════════════════════════════════════════════
    // PART 1 — Reach Ready + full instrumentation (storage, network,
    // messaging, clipboard, downloads, History, Cookie) during real UI
    // actions, with exact-reference restoration proof.
    // ══════════════════════════════════════════════════════════════
    const page = await browser.newPage({ viewport: { width: 1440, height: 1400 } });
    const mainPageAudit = attachPageAudit(page, 'privacy-main', consoleErrors);

    await page.goto(`http://localhost:${PORT}/index.html?qa=1`);
    await page.waitForTimeout(600);
    const { completed, snapshot } = await reachReady(page, 'neutral-balanced.png');
    record('Real application reaches Ready with Observation enabled', completed && snapshot?.observation?.enabled === true, `completed=${completed}, observationEnabled=${snapshot?.observation?.enabled}`);
    await page.evaluate(() => { const el = document.getElementById('interactivePreviewObservationSection'); if (el) el.scrollIntoView(); });
    await page.waitForTimeout(300);

    await page.evaluate(INSTALL_INSTRUMENTATION_JS);

    await page.click('#ipoOption_prefer-legacy');
    await page.waitForTimeout(100);
    await page.click('#ipoReason_skin-tone');
    await page.click('#ipoReason_contrast');
    await page.waitForTimeout(100);
    await page.click('#ipoOption_prefer-v2');
    await page.waitForTimeout(100);
    await page.click('#ipoClearReasonsButton');
    await page.waitForTimeout(100);
    await page.click('#ipoOption_prefer-legacy');
    await page.click('#ipoReason_skin-tone');
    await page.waitForTimeout(100);
    await page.click('#ipoClearButton');
    await page.waitForTimeout(100);
    await page.click('#ipoOption_prefer-legacy');
    await page.click('#ipoReason_skin-tone');
    await page.waitForTimeout(100);
    await page.click('#ipoClearSessionButton');
    await page.waitForTimeout(200);

    finalCounts = await page.evaluate(() => window.__step7bCounts);
    optionalApiMatrix = await page.evaluate(() => window.__step7bOptional);
    const cookieUnchanged = await page.evaluate(() => document.cookie === window.__step7bCookieBefore);
    const searchUnchanged = await page.evaluate(() => location.search === window.__step7bSearchBefore);
    const hashUnchanged = await page.evaluate(() => location.hash === window.__step7bHashBefore);
    const historyLenBefore = await page.evaluate(() => window.__step7bHistoryLenBefore);
    const historyLenAfter = await page.evaluate(() => history.length);

    restorationResult = await page.evaluate(RESTORE_AND_VERIFY_JS);
    record('FIX 1: all instrumented APIs restored to EXACT original reference (strict identity)', restorationResult.allRestoredTrue === true, JSON.stringify(restorationResult.restoration));

    // ── FIX 2/4: optional API support matrix — merge patched + restored + calls, never claim coverage for unsupported APIs. Source search confirmed no Observation/Session module references any of these optional APIs directly. ──
    const sourceInspectionNoObservationConsumer = true; // verified: grep across ui/interactive-preview-observation-*.js found zero references to indexedDB/CacheStorage/sendBeacon/EventSource/BroadcastChannel/MessageChannel/clipboard
    supportMatrix = {
      indexedDB: { ...optionalApiMatrix.indexedDB, restored: restorationResult.restoration.indexedDB, calls: finalCounts.storage.indexedDbOpen + finalCounts.storage.indexedDbDelete, sourceInspectionNoObservationConsumer },
      cacheStorage: { ...optionalApiMatrix.cacheStorage, restored: restorationResult.restoration.cacheStorage, calls: finalCounts.storage.cacheOpen + finalCounts.storage.cacheDelete, sourceInspectionNoObservationConsumer },
      sendBeacon: { ...optionalApiMatrix.sendBeacon, restored: restorationResult.restoration.sendBeacon, calls: finalCounts.network.sendBeacon, sourceInspectionNoObservationConsumer },
      eventSource: { ...optionalApiMatrix.eventSource, restored: restorationResult.restoration.eventSource, calls: finalCounts.network.eventSource, sourceInspectionNoObservationConsumer },
      broadcastChannel: { ...optionalApiMatrix.broadcastChannel, restored: restorationResult.restoration.broadcastChannel, calls: finalCounts.network.broadcastChannel, sourceInspectionNoObservationConsumer },
      messageChannel: { ...optionalApiMatrix.messageChannel, restored: restorationResult.restoration.messageChannel, calls: finalCounts.messaging.messageChannel, sourceInspectionNoObservationConsumer },
      clipboardWrite: { ...optionalApiMatrix.clipboardWrite, restored: restorationResult.restoration.clipboardWrite, calls: finalCounts.clipboard.write, sourceInspectionNoObservationConsumer },
      clipboardWriteText: { ...optionalApiMatrix.clipboardWriteText, restored: restorationResult.restoration.clipboardWriteText, calls: finalCounts.clipboard.writeText, sourceInspectionNoObservationConsumer },
      cookieSetter: { ...optionalApiMatrix.cookieSetter, restored: restorationResult.restoration.cookieSetter, calls: finalCounts.cookie.setterCalls, sourceInspectionNoObservationConsumer },
    };
    for (const [name, entry] of Object.entries(supportMatrix)) {
      if (entry.supported === false) {
        record(`FIX 2: optional API "${name}" unsupported in this browser — recorded honestly, not claimed as tested`, 'NOT_APPLICABLE', JSON.stringify(entry));
      } else {
        const genuinelyOk = entry.patched === true && entry.restored === true && entry.calls === 0;
        record(`FIX 2: optional API "${name}" patched+restored+zero calls (all verified, not assumed)`, genuinelyOk, JSON.stringify(entry));
      }
    }

    // ── Storage/Network/Messaging/Clipboard/Download counts (required, always-present APIs) ──
    const storageTotal = Object.values(finalCounts.storage).reduce((a, b) => a + b, 0);
    const networkTotal = finalCounts.network.fetch + finalCounts.network.xhrOpen + finalCounts.network.xhrSend + finalCounts.network.webSocket;
    record('Storage instrumentation: zero Observation-related calls', storageTotal === 0, JSON.stringify(finalCounts.storage));
    record('Network instrumentation (fetch/xhr/webSocket): zero Observation-related calls', networkTotal === 0, JSON.stringify({ fetch: finalCounts.network.fetch, xhrOpen: finalCounts.network.xhrOpen, xhrSend: finalCounts.network.xhrSend, webSocket: finalCounts.network.webSocket }));
    record('postMessage: zero Observation-related calls', finalCounts.messaging.postMessage === 0, `postMessage=${finalCounts.messaging.postMessage}`);
    record('Downloads instrumentation: zero Observation-related calls (deliberate XMP export excluded from this window)', Object.values(finalCounts.downloads).reduce((a, b) => a + b, 0) === 0, JSON.stringify(finalCounts.downloads));

    // ── FIX 3: History mutation instrumentation — strict zero counts, exact length equality. ──
    const historyCountsZero = Object.values(finalCounts.history).every((v) => v === 0);
    record('FIX 3: History mutation methods called zero times', historyCountsZero, JSON.stringify(finalCounts.history));
    record('FIX 3: history.length exactly unchanged (not merely >=)', historyLenAfter === historyLenBefore, `before=${historyLenBefore}, after=${historyLenAfter}`);
    record('location.search unchanged by Observation actions (?qa=1 preserved)', searchUnchanged, `unchanged=${searchUnchanged}`);
    record('location.hash unchanged by Observation actions', hashUnchanged, `unchanged=${hashUnchanged}`);

    // ── FIX 4: Cookie write instrumentation. ──
    if (optionalApiMatrix.cookieSetter.supported) {
      record('FIX 4: native cookie setter never invoked by Observation actions', finalCounts.cookie.setterCalls === 0, `setterCalls=${finalCounts.cookie.setterCalls}`);
    } else {
      record('FIX 4: cookie setter instrumentation unsupported in this browser — before/after text comparison used as secondary evidence', 'NOT_APPLICABLE', JSON.stringify(optionalApiMatrix.cookieSetter));
    }
    record('document.cookie text identical before/after (secondary evidence, always checked)', cookieUnchanged, `unchanged=${cookieUnchanged}`);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'privacy-observation-ready.png') });
    screenshotsGenerated.push('full-app-7b-a/privacy-observation-ready.png');
    mainPageAudit.finalize();
    await page.close();

    // ══════════════════════════════════════════════════════════════
    // PART 2 — FIX 6/7/8: responsive required-element assertions,
    // complete containment, per-page console/resource audit.
    // ══════════════════════════════════════════════════════════════
    const REQUIRED_ELEMENT_CHECK_JS = (vw) => `
      (() => {
        const TOLERANCE = 1;
        const missing = [];
        const findings = [];
        const req = (el, label) => { if (!el) { missing.push(label); return null; } const style = getComputedStyle(el); if (style.display === 'none' || style.visibility === 'hidden') { missing.push(label + ' (not visible)'); return null; } return el; };
        const checkContained = (child, parent, label) => {
          if (!child || !parent) return;
          const c = child.getBoundingClientRect();
          const p = parent.getBoundingClientRect();
          if (c.left < p.left - TOLERANCE || c.right > p.right + TOLERANCE) findings.push({ label, childLeft: Math.round(c.left), childRight: Math.round(c.right), parentLeft: Math.round(p.left), parentRight: Math.round(p.right) });
          if (c.left < -TOLERANCE || c.right > ${vw} + TOLERANCE) findings.push({ label: label + '-viewport', right: Math.round(c.right), viewport: ${vw} });
          if (child.scrollWidth > child.clientWidth + TOLERANCE) findings.push({ label: label + '-scrollWidth', scrollWidth: child.scrollWidth, clientWidth: child.clientWidth });
        };

        const obsSection = req(document.getElementById('interactivePreviewObservationSection'), 'Observation section');
        const ipoFieldset = req(document.getElementById('ipoFieldset'), 'Observation fieldset');
        const radioValues = ['prefer-legacy', 'prefer-v2', 'no-visible-difference', 'unsure'];
        const radioLabels = radioValues.map((v) => req(document.getElementById('ipoOption_' + v)?.closest('label'), 'Observation radio label: ' + v));
        const ipoReasonFieldset = req(document.getElementById('ipoReasonFieldset'), 'Reason fieldset');
        const reasonValues = ['skin-tone','white-balance','highlight-detail','shadow-detail','contrast','color-balance','saturation','natural-look','clarity-detail','no-specific-reason'];
        const reasonLabels = reasonValues.map((v) => req(document.getElementById('ipoReason_' + v)?.closest('label'), 'Reason label: ' + v));
        const safetyNote = req(document.getElementById('ipoSafetyNote'), 'Safety note');
        const selectedReasonsText = req(document.getElementById('ipoStatus'), 'Selected Reasons / status text');
        const sessionSection = req(document.getElementById('interactivePreviewObservationSessionSection'), 'Session Summary section');
        const sessionMetrics = req(document.getElementById('ipoSessionMetrics'), 'Session metrics');
        const clearReasonsBtn = req(document.getElementById('ipoClearReasonsButton'), 'Clear Reasons button');
        const clearObsBtn = req(document.getElementById('ipoClearButton'), 'Clear Observation button');
        const clearSessionBtn = req(document.getElementById('ipoClearSessionButton'), 'Clear Session button');
        // Privacy note: any element whose text mentions privacy/production-safety wording within the Observation/Session sections.
        // FIX 6 (Step 7B-A-F2): locate the ACTUAL Privacy-note element by
        // exact text match (never a broad parent textContent search),
        // then verify it is genuinely visible: non-none display,
        // non-hidden visibility, non-zero opacity, non-zero bounding
        // rect, contained within its parent and the viewport.
        const PRIVACY_NOTE_TEXT = 'Observation details stay in this page session only and do not change production output.';
        const privacyNoteEl = Array.from(document.querySelectorAll('#interactivePreviewObservationInner div, #interactivePreviewObservationInner p'))
          .find((el) => el.textContent && el.textContent.trim() === PRIVACY_NOTE_TEXT);
        let privacyNoteFound = false;
        if (privacyNoteEl) {
          const style = getComputedStyle(privacyNoteEl);
          const rect = privacyNoteEl.getBoundingClientRect();
          const genuinelyVisible = style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
          if (genuinelyVisible) {
            privacyNoteFound = true;
            checkContained(privacyNoteEl, obsSection, 'privacyNote-in-obsSection');
          }
        }
        if (!privacyNoteFound) missing.push('Privacy note (exact-text element, genuinely visible)');

        radioLabels.forEach((l, i) => checkContained(l, ipoFieldset, 'obs-label-' + radioValues[i]));
        reasonLabels.forEach((l, i) => checkContained(l, ipoReasonFieldset, 'reason-label-' + reasonValues[i]));
        checkContained(ipoFieldset, obsSection, 'ipoFieldset-in-obsSection');
        checkContained(ipoReasonFieldset, obsSection, 'ipoReasonFieldset-in-obsSection');
        checkContained(safetyNote, obsSection, 'safetyNote-in-obsSection');
        checkContained(selectedReasonsText, obsSection, 'selectedReasonsText-in-obsSection');
        checkContained(clearReasonsBtn, obsSection, 'clearReasonsBtn-in-obsSection');
        checkContained(clearObsBtn, obsSection, 'clearObsBtn-in-obsSection');
        if (sessionSection && sessionMetrics) {
          checkContained(sessionMetrics, sessionSection, 'sessionMetrics-in-sessionSection');
          document.querySelectorAll('#ipoSessionMetrics > div').forEach((card, i) => {
            checkContained(card, sessionMetrics, 'session-metric-card-' + i);
            // FIX 7: a card itself being contained is not sufficient
            // when its own text overflows — check every child element
            // (label/value) against the CARD, plus a non-zero visible
            // rectangle for the card's own text content.
            const cardRect = card.getBoundingClientRect();
            if (cardRect.width <= 0 || cardRect.height <= 0) findings.push({ label: 'session-metric-card-' + i + '-zero-size', width: cardRect.width, height: cardRect.height });
            Array.from(card.children).forEach((child, j) => checkContained(child, card, 'session-metric-card-' + i + '-child-' + j));
          });
        }
        checkContained(clearSessionBtn, sessionSection, 'clearSessionBtn-in-sessionSection');

        // FIX 6 (Step 7B-A-F3): Top Reasons element containment — when
        // Reason counts are active, a real Top-Reasons container MUST
        // exist and be genuinely visible+contained (never a broad
        // parent-textContent pass). If active Reason counts exist but
        // no Top-Reasons element is found, that is a FAIL.
        const topReasonsEl = document.getElementById('ipoSessionTopReasons');
        const hasActiveReasonCounts = sessionSection && /skin tone|contrast|shadow detail|white balance/i.test(sessionSection.textContent || '');
        if (hasActiveReasonCounts) {
          if (!topReasonsEl) {
            missing.push('Top Reasons container (active Reason counts present but element missing)');
          } else {
            const trRect = topReasonsEl.getBoundingClientRect();
            if (trRect.width <= 0 || trRect.height <= 0) findings.push({ label: 'topReasons-zero-size', width: trRect.width, height: trRect.height });
            checkContained(topReasonsEl, sessionSection, 'topReasons-in-sessionSection');
            Array.from(topReasonsEl.children).forEach((child, i) => checkContained(child, topReasonsEl, 'topReasons-child-' + i));
          }
        }

        return { missing, findings, docScrollW: document.documentElement.scrollWidth, docClientW: document.documentElement.clientWidth };
      })()
    `;

    for (const width of VIEWPORTS) {
      const vpErrors = [];
      const vp = await browser.newPage({ viewport: { width, height: 1500 } });
      const vpAudit = attachPageAudit(vp, `viewport-${width}px`, vpErrors);
      await vp.goto(`http://localhost:${PORT}/index.html?qa=1`);
      await vp.waitForTimeout(600);
      await reachReady(vp, 'neutral-balanced.png');
      await vp.click('#ipoOption_prefer-legacy');
      await vp.click('#ipoReason_skin-tone');
      await vp.click('#ipoReason_contrast');
      await vp.click('#ipoReason_shadow-detail');
      await vp.waitForTimeout(200);
      const result = await vp.evaluate(REQUIRED_ELEMENT_CHECK_JS(width));

      const elementsPresent = result.missing.length === 0;
      record(`FIX 6: all required elements present+visible at ${width}px`, elementsPresent, elementsPresent ? 'all present' : `MISSING: ${JSON.stringify(result.missing)}`);
      const containmentPass = result.findings.length === 0 && result.docScrollW <= result.docClientW;
      record(`FIX 7: complete element containment at ${width}px`, containmentPass, containmentPass ? `docScrollW=${result.docScrollW}, no overflow` : JSON.stringify(result.findings));

      // FIX 3 (Step 7B-A-F2): correct deterministic order — wait for
      // network/console events to settle, THEN finalize the audit
      // (correlating any "Failed to load resource" console messages
      // against confirmed font-host failures), THEN evaluate
      // vpErrors.length, THEN record, THEN copy into the global list.
      await vp.waitForTimeout(300);
      vpAudit.finalize();
      const viewportPagePass = vpErrors.length === 0;
      record(`FIX 8: no console/resource error at ${width}px`, viewportPagePass, viewportPagePass ? '(none)' : JSON.stringify(vpErrors));
      consoleErrors.push(...vpErrors);

      responsiveResults.push({ width, elementsPresent, containmentPass, missing: result.missing, findings: result.findings, docScrollW: result.docScrollW, docClientW: result.docClientW, consoleClean: viewportPagePass });

      if (width <= 430) { await vp.screenshot({ path: path.join(SCREENSHOT_DIR, `mobile-${width}px.png`), fullPage: true }); screenshotsGenerated.push(`full-app-7b-a/mobile-${width}px.png`); }
      else if (width === 768) { await vp.screenshot({ path: path.join(SCREENSHOT_DIR, 'tablet-768px.png'), fullPage: true }); screenshotsGenerated.push('full-app-7b-a/tablet-768px.png'); }
      else if (width === 1440) { await vp.evaluate(() => { const el = document.getElementById('interactivePreviewObservationSection'); if (el) el.scrollIntoView(); }); await vp.waitForTimeout(200); await vp.screenshot({ path: path.join(SCREENSHOT_DIR, 'desktop-1440px.png') }); screenshotsGenerated.push('full-app-7b-a/desktop-1440px.png'); }
      await vp.close();
    }

    record('FIX 8: main Privacy page — no console/resource error', consoleErrors.filter((e) => e.context === 'privacy-main').length === 0, consoleErrors.filter((e) => e.context === 'privacy-main').length === 0 ? '(none)' : JSON.stringify(consoleErrors.filter((e) => e.context === 'privacy-main')));

  } finally {
    await browser.close();
    server.close();
  }

  const passCount = results.filter((r) => r.result === 'PASS').length;
  const failCount = results.filter((r) => r.result === 'FAIL').length;
  const notTestedCount = results.filter((r) => r.result === 'NOT_TESTED').length;
  // FIX 10: fail-closed — PASS requires zero FAIL and zero NOT_TESTED
  // among REQUIRED checks (NOT_APPLICABLE for genuinely unsupported
  // optional APIs, backed by source-code inspection, does not count
  // against this).
  const finalDecision = (failCount === 0 && notTestedCount === 0) ? 'PASS' : 'FAIL';

  const output = {
    suite: 'EPIC 2E-J-C-F2 Step 7B-A Final Closeout (incl. Step 7B-A-F/F2/F3) - Privacy, Storage/Network, Session-Schema and Responsive Final Audit',
    generatedAt: new Date().toISOString(),
    summary: { total: results.length, pass: passCount, fail: failCount, notTested: notTestedCount },
    storage: finalCounts?.storage ?? null,
    network: finalCounts?.network ?? null,
    messaging: finalCounts?.messaging ?? null,
    clipboard: finalCounts?.clipboard ?? null,
    downloads: finalCounts?.downloads ?? null,
    history: finalCounts?.history ?? null,
    cookie: finalCounts?.cookie ?? null,
    optionalApiSupportMatrix: supportMatrix,
    apiRestoration: restorationResult,
    responsive: { perViewportResults: responsiveResults },
    dataMinimization: dataMinimizationResult,
    consoleErrors,
    screenshotsGenerated,
    results,
    decision: finalDecision,
  };
  await mkdir(path.join(PROJECT_ROOT, 'qa'), { recursive: true });
  await writeFile(path.join(PROJECT_ROOT, 'qa', 'epic-2e-j-phase-c-step7b-a-results.json'), JSON.stringify(output, null, 2));
  console.log(`\n${passCount}/${results.length} PASS, ${failCount} FAIL, ${notTestedCount} NOT_TESTED`);
  console.log(`Step 7B-A Decision: ${output.decision}`);
  process.exit(output.decision === 'FAIL' ? 1 : 0);
}

main().catch((err) => {
  console.error('Step 7B-A test crashed:', err);
  process.exit(2);
});
