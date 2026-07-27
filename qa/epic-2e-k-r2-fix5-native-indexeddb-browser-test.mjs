#!/usr/bin/env node
/**
 * EPIC 2E-K-R2-FIX5 — Native Browser IndexedDB verification.
 *
 * Runs against a real Chromium/Chrome/Edge binary through the Chrome DevTools
 * Protocol and a short-lived localhost origin. Exit codes:
 *   0 PASS, 1 FAIL, 2 NOT_VERIFIED (environment/browser/origin unavailable).
 */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { detectBrowserExecutable, detectPlaywrightPackage } from './helpers/playwright-lumixa-test-runtime.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const RESULT_PATH = path.join(__dirname, 'epic-2e-k-r2-fix5-native-indexeddb-browser-results.json');
const MIME = new Map([
  ['.html', 'text/html; charset=utf-8'], ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'], ['.json', 'application/json; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'], ['.png', 'image/png'],
]);

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function safeJson(value) { try { return JSON.stringify(value); } catch { return String(value); } }

function harnessHtml() {
  return `<!doctype html><meta charset="utf-8"><title>LUMIXA FIX5 Native IDB QA</title>
<script type="module">
import { createCalibrationLabStorage } from '/ui/calibration-lab/calibration-lab-storage.js';
import { createCalibrationSession, createImageTestRecord } from '/core/calibration-lab/schema.js';

const params = new URLSearchParams(location.search);
const phase = params.get('phase') || 'seed';
window.__LUMIXA_FIX5_NATIVE_IDB__ = { completed: false, phase, decision: 'RUNNING' };

try {
  const storage = await createCalibrationLabStorage();
  if (storage.persistenceMode !== 'INDEXEDDB') throw new Error('NATIVE_INDEXEDDB_BACKEND_NOT_SELECTED:' + storage.persistenceMode);

  if (phase === 'seed') {
    const session = createCalibrationSession({ locale: 'th', appVersion: 'fix5-native-browser' });
    const record = createImageTestRecord({ imageCategories: ['EVENT'], lightingCondition: 'LED' });
    await storage.saveSession(session);
    await storage.saveImageRecord(session.sessionId, record);
    const sessions = await storage.listSessions();
    const records = await storage.loadImageRecordsForSession(session.sessionId);
    window.__LUMIXA_FIX5_NATIVE_IDB__ = {
      completed: true, phase, decision: 'PASS', persistenceMode: storage.persistenceMode,
      sessionId: session.sessionId, imageId: record.imageId,
      sessionRoundTrip: sessions.some(item => item.sessionId === session.sessionId),
      imageRoundTrip: records.some(item => item.imageId === record.imageId),
    };
  } else if (phase === 'reload') {
    const sessionId = params.get('sessionId');
    const imageId = params.get('imageId');
    const sessions = await storage.listSessions();
    const records = await storage.loadImageRecordsForSession(sessionId);
    const persistedAcrossReload = sessions.some(item => item.sessionId === sessionId)
      && records.some(item => item.imageId === imageId);
    await storage.deleteSession(sessionId);
    const deletedSession = !(await storage.listSessions()).some(item => item.sessionId === sessionId);
    const deletedRecords = (await storage.loadImageRecordsForSession(sessionId)).length === 0;
    const usage = await storage.getStorageUsageSummary();
    window.__LUMIXA_FIX5_NATIVE_IDB__ = {
      completed: true, phase, decision: persistedAcrossReload && deletedSession && deletedRecords ? 'PASS' : 'FAIL',
      persistenceMode: storage.persistenceMode, persistedAcrossReload, deletedSession, deletedRecords, usage,
    };
  } else {
    throw new Error('UNKNOWN_PHASE:' + phase);
  }
} catch (error) {
  window.__LUMIXA_FIX5_NATIVE_IDB__ = {
    completed: true, phase, decision: 'FAIL', error: String(error?.stack || error),
    href: location.href, origin: location.origin,
  };
}
</script>`;
}

function createStaticServer() {
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (url.pathname === '/__fix5_native_idb__.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(harnessHtml());
        return;
      }
      const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
      const filePath = path.resolve(ROOT, rel);
      if (!filePath.startsWith(`${ROOT}${path.sep}`)) {
        res.writeHead(403); res.end('forbidden'); return;
      }
      const data = await fs.readFile(filePath);
      res.writeHead(200, { 'Content-Type': MIME.get(path.extname(filePath)) ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(data);
    } catch {
      res.writeHead(404); res.end('not found');
    }
  });
}

class CdpClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.seq = 0;
    this.pending = new Map();
    this.listeners = new Map();
    this.ws.onmessage = event => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const pending = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(safeJson(message.error)));
        else pending.resolve(message.result);
        return;
      }
      for (const listener of this.listeners.get(message.method) ?? []) listener(message.params);
    };
  }
  async open() {
    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });
    return this;
  }
  on(method, fn) { this.listeners.set(method, [...(this.listeners.get(method) ?? []), fn]); }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  close() { try { this.ws.close(); } catch {} }
}

async function waitForResult(client, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await client.send('Runtime.evaluate', {
      expression: 'window.__LUMIXA_FIX5_NATIVE_IDB__ ? JSON.stringify(window.__LUMIXA_FIX5_NATIVE_IDB__) : null',
      returnByValue: true,
    });
    const raw = response?.result?.value;
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.completed) return parsed;
    }
    await sleep(100);
  }
  throw new Error('Timed out waiting for native IndexedDB harness result');
}

async function hashSources() {
  const files = [
    'ui/calibration-lab/calibration-lab-storage.js',
    'core/calibration-lab/schema.js',
    'core/calibration-lab/migrate-v1-to-v2.js',
    'qa/epic-2e-k-r2-fix5-native-indexeddb-browser-test.mjs',
  ];
  const hash = createHash('sha256');
  for (const rel of files) hash.update(rel).update(await fs.readFile(path.join(ROOT, rel)));
  return hash.digest('hex');
}

async function writeResult(result) {
  await fs.writeFile(RESULT_PATH, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
}

async function main() {
  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  const sourceHash = await hashSources();
  const playwrightPackage = await detectPlaywrightPackage();
  const detection = await detectBrowserExecutable(playwrightPackage.chromium);
  if (!detection.available) {
    const result = { epic: '2E-K-R2-FIX5', suite: 'NATIVE_BROWSER_INDEXEDDB', decision: 'NOT_VERIFIED', reason: 'BROWSER_BINARY_UNAVAILABLE', completed: true, runId, startedAt, completedAt: new Date().toISOString(), sourceHash, browser: detection };
    await writeResult(result); console.log(JSON.stringify(result, null, 2)); process.exit(2);
  }

  const server = createStaticServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const serverPort = server.address().port;
  const profileDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lumixa-fix5-native-idb-'));
  const args = [
    '--headless=new', '--disable-gpu', '--disable-dev-shm-usage', '--no-proxy-server', '--proxy-bypass-list=*',
    '--remote-debugging-port=0', `--user-data-dir=${profileDir}`, 'about:blank',
  ];
  if (process.platform !== 'win32') args.unshift('--no-sandbox');

  const browser = spawn(detection.executablePath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let browserStderr = '';
  browser.stderr.on('data', chunk => { browserStderr += String(chunk).slice(0, 4000); });
  let client = null;
  const pageErrors = [];
  const consoleErrors = [];

  try {
    let port = null;
    for (let attempt = 0; attempt < 200; attempt += 1) {
      try {
        const active = await fs.readFile(path.join(profileDir, 'DevToolsActivePort'), 'utf8');
        port = Number(active.split(/\r?\n/)[0]);
        if (Number.isInteger(port) && port > 0) break;
      } catch {}
      await sleep(50);
    }
    if (!port) throw Object.assign(new Error('DevToolsActivePort unavailable'), { code: 'CDP_UNAVAILABLE' });

    const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json());
    const target = targets.find(item => item.type === 'page');
    if (!target?.webSocketDebuggerUrl) throw Object.assign(new Error('No debuggable page target'), { code: 'CDP_TARGET_UNAVAILABLE' });
    client = await new CdpClient(target.webSocketDebuggerUrl).open();
    client.on('Runtime.exceptionThrown', event => pageErrors.push(event?.exceptionDetails?.text ?? safeJson(event)));
    client.on('Runtime.consoleAPICalled', event => {
      if (event.type === 'error') consoleErrors.push(event.args?.map(arg => arg.value ?? arg.description).join(' ') ?? 'console error');
    });
    await client.send('Runtime.enable');
    await client.send('Page.enable');

    const base = `http://127.0.0.1:${serverPort}/__fix5_native_idb__.html`;
    const seedNav = await client.send('Page.navigate', { url: `${base}?phase=seed` });
    if (seedNav?.errorText) {
      const result = {
        epic: '2E-K-R2-FIX5', suite: 'NATIVE_BROWSER_INDEXEDDB', decision: 'NOT_VERIFIED',
        reason: seedNav.errorText === 'net::ERR_BLOCKED_BY_ADMINISTRATOR' ? 'BROWSER_ORIGIN_BLOCKED_BY_POLICY' : 'BROWSER_NAVIGATION_FAILED',
        navigationError: seedNav.errorText, completed: true, runId, startedAt, completedAt: new Date().toISOString(), sourceHash,
        browserExecutable: detection.executablePath, browserVersion: detection.versionOutput,
        pageErrors, consoleErrors,
      };
      await writeResult(result); console.log(JSON.stringify(result, null, 2)); process.exitCode = 2; return;
    }
    const seed = await waitForResult(client);
    if (seed.decision !== 'PASS' || !seed.sessionRoundTrip || !seed.imageRoundTrip) throw new Error(`Seed phase failed: ${safeJson(seed)}`);

    const reloadUrl = `${base}?phase=reload&sessionId=${encodeURIComponent(seed.sessionId)}&imageId=${encodeURIComponent(seed.imageId)}`;
    const reloadNav = await client.send('Page.navigate', { url: reloadUrl });
    if (reloadNav?.errorText) throw new Error(`Reload navigation failed: ${reloadNav.errorText}`);
    const reload = await waitForResult(client);
    if (reload.decision !== 'PASS' || !reload.persistedAcrossReload || !reload.deletedSession || !reload.deletedRecords) {
      throw new Error(`Reload phase failed: ${safeJson(reload)}`);
    }

    const result = {
      epic: '2E-K-R2-FIX5', suite: 'NATIVE_BROWSER_INDEXEDDB', decision: 'PASS', completed: true,
      runId, startedAt, completedAt: new Date().toISOString(), sourceHash,
      browserExecutable: detection.executablePath, browserVersion: detection.versionOutput,
      origin: `http://127.0.0.1:${serverPort}`, seed, reload, pageErrors, consoleErrors,
    };
    if (pageErrors.length || consoleErrors.length) {
      result.decision = 'FAIL';
      result.reason = 'BROWSER_RUNTIME_ERRORS';
    }
    await writeResult(result); console.log(JSON.stringify(result, null, 2)); process.exitCode = result.decision === 'PASS' ? 0 : 1;
  } catch (error) {
    const notVerifiedCodes = new Set(['CDP_UNAVAILABLE', 'CDP_TARGET_UNAVAILABLE']);
    const decision = notVerifiedCodes.has(error?.code) ? 'NOT_VERIFIED' : 'FAIL';
    const result = {
      epic: '2E-K-R2-FIX5', suite: 'NATIVE_BROWSER_INDEXEDDB', decision,
      reason: error?.code ?? 'NATIVE_BROWSER_TEST_ERROR', error: error?.stack ?? String(error),
      completed: true, runId, startedAt, completedAt: new Date().toISOString(), sourceHash,
      browserExecutable: detection.executablePath, browserVersion: detection.versionOutput,
      pageErrors, consoleErrors, browserStderr: browserStderr.slice(-2000),
    };
    await writeResult(result); console.error(JSON.stringify(result, null, 2)); process.exitCode = decision === 'NOT_VERIFIED' ? 2 : 1;
  } finally {
    client?.close();
    try { browser.kill('SIGTERM'); } catch {}
    await sleep(300);
    try { browser.kill('SIGKILL'); } catch {}
    await new Promise(resolve => server.close(resolve));
    await fs.rm(profileDir, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch(async error => {
  console.error(error?.stack ?? error);
  process.exit(1);
});
