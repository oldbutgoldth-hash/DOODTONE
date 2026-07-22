/**
 * qa/helpers/playwright-lumixa-test-runtime.mjs
 *
 * EPIC 2E-J — ENV-B2: Integrate the In-Memory Harness into the Step
 * 7B-B Browser suite. This is the reusable runtime shared by any QA
 * Browser test that needs a real, complete LUMIXA application page
 * with zero localhost/127.0.0.1/private-IP/HTTP-server/file:/external-
 * network dependency — built on top of the two ENV-B1B/ENV-B1B-F1
 * helpers (qa/helpers/playwright-in-memory-app.mjs for the module
 * graph + in-memory HTML, qa/helpers/playwright-opaque-origin-storage.mjs
 * for the about:blank opaque-origin Storage compatibility layer).
 *
 * Never imports 'playwright' at the top level (so a missing Node
 * package is reported honestly rather than crashing this module's own
 * import), and never starts a local HTTP server.
 */

import { access } from 'node:fs/promises';
import { constants as FS_CONSTANTS } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildInMemoryApp, toEvidenceSummary } from './playwright-in-memory-app.mjs';
import {
  buildProbeInvocationSource,
  buildInstallerInvocationSource,
} from './playwright-opaque-origin-storage.mjs';

const execFileAsync = promisify(execFile);

// ══════════════════════════════════════════════════════════════════
// PART 8 — Browser detection: env var -> bundled -> common system
// paths, in that order. Never downloads a Browser binary.
// ══════════════════════════════════════════════════════════════════
export async function detectPlaywrightPackage() {
  try {
    const mod = await import('playwright');
    return { status: 'PLAYWRIGHT_PACKAGE_AVAILABLE', mod };
  } catch (e) {
    return { status: 'PLAYWRIGHT_PACKAGE_UNAVAILABLE', error: String((e && e.message) || e) };
  }
}

async function isExecutableFile(candidatePath) {
  try {
    await access(candidatePath, FS_CONSTANTS.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function detectBrowserExecutable(chromium) {
  const candidates = [];
  if (typeof process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH === 'string' && process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH.length > 0) {
    candidates.push({ label: 'PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH env var', path: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });
  }
  try {
    const bundled = chromium && typeof chromium.executablePath === 'function' ? chromium.executablePath() : null;
    if (typeof bundled === 'string' && bundled.length > 0) candidates.push({ label: 'Playwright bundled Chromium', path: bundled });
  } catch { /* bundled path resolution itself can throw when nothing is installed — skip, never crash */ }
  candidates.push(
    { label: '/usr/bin/chromium', path: '/usr/bin/chromium' },
    { label: '/usr/bin/chromium-browser', path: '/usr/bin/chromium-browser' },
    { label: '/usr/bin/google-chrome', path: '/usr/bin/google-chrome' },
    { label: '/usr/bin/google-chrome-stable', path: '/usr/bin/google-chrome-stable' },
    { label: '/opt/google/chrome/chrome', path: '/opt/google/chrome/chrome' },
  );

  const attempts = [];
  for (const candidate of candidates) {
    const exists = await isExecutableFile(candidate.path);
    if (!exists) {
      attempts.push({ ...candidate, exists: false, versionOutput: null });
      continue;
    }
    try {
      const { stdout } = await execFileAsync(candidate.path, ['--version'], { timeout: 8000 });
      attempts.push({ ...candidate, exists: true, versionOutput: stdout.trim() });
      return { found: candidate.path, versionOutput: stdout.trim(), attempts };
    } catch (e) {
      attempts.push({ ...candidate, exists: true, versionOutput: null, versionError: String((e && e.message) || e) });
    }
  }
  return { found: null, versionOutput: null, attempts };
}

export const REQUIRED_LAUNCH_ARGS = ['--no-sandbox', '--disable-dev-shm-usage'];

// ══════════════════════════════════════════════════════════════════
// PART 1 — reusable in-memory page runtime.
// ══════════════════════════════════════════════════════════════════

/**
 * Builds the in-memory app ONCE and returns it, so multiple Pages
 * within the same test run can share a single project snapshot
 * instead of re-reading/re-scanning every project file per Page.
 */
export async function buildLumixaAppSnapshot(projectRoot) {
  return buildInMemoryApp(projectRoot);
}

/**
 * Opens a real Playwright Page loaded with the complete, unmodified
 * LUMIXA application via the Navigation-Free In-Memory Harness —
 * never localhost/127.0.0.1/private-IP/HTTP-server/file:/external
 * network. Implements PART 1 steps 1-10 in order.
 *
 * @param {{ browser: import('playwright').Browser, projectRoot: string, qaQuery?: string, viewport?: {width:number,height:number}, prebuiltApp?: any }} options
 */
export async function openLumixaInMemoryPage({ browser, projectRoot, qaQuery = '?qa=1', viewport, prebuiltApp }) {
  // Step 1 — build (or reuse) the in-memory app snapshot.
  const app = prebuiltApp || await buildLumixaAppSnapshot(projectRoot);

  // Step 2 — Context with serviceWorkers: "block".
  const context = await browser.newContext({ serviceWorkers: 'block', viewport });
  const page = await context.newPage();

  // Step 3 — listeners installed BEFORE any loading.
  const collectors = {
    pageErrors: [],
    consoleErrors: [],
    requestFailures: [],
    nonAllowedNetworkRequests: [], // any request that is not a data:/about: scheme — HTTP/HTTPS/file/localhost detection
  };
  page.on('pageerror', (e) => collectors.pageErrors.push(String(e)));
  page.on('console', (msg) => { if (msg.type() === 'error') collectors.consoleErrors.push(msg.text()); });
  page.on('requestfailed', (req) => collectors.requestFailures.push({ url: req.url(), failure: req.failure()?.errorText ?? 'unknown' }));
  page.on('request', (req) => {
    const url = req.url();
    let scheme = 'unknown';
    try { scheme = new URL(url).protocol.replace(':', ''); } catch { /* leave as 'unknown' */ }
    if (scheme !== 'data' && scheme !== 'about') collectors.nonAllowedNetworkRequests.push({ url, scheme });
  });

  // Step 4 — navigate ONLY to about:blank(+qaQuery). No other
  // navigation target is ever used by this runtime.
  const aboutBlankUrl = `about:blank${qaQuery}`;
  await page.goto(aboutBlankUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });

  // Step 5 — detect native Storage access.
  const probeBefore = await page.evaluate(buildProbeInvocationSource());
  const nativeStorageAvailable = !!(probeBefore.localStorageAccessible && probeBefore.sessionStorageAccessible);

  // Step 6 — install the Opaque-Origin Storage shim only when needed.
  let storageStatus;
  if (nativeStorageAvailable) {
    storageStatus = 'NATIVE_STORAGE_AVAILABLE';
  } else {
    await context.addInitScript({ content: buildInstallerInvocationSource() });
    await page.evaluate(buildInstallerInvocationSource());
    storageStatus = 'OPAQUE_ORIGIN_MEMORY_STORAGE_INSTALLED';
  }

  // Step 7 — verify Storage access.
  const probeAfter = await page.evaluate(buildProbeInvocationSource());
  const storageAccessVerified = !!(probeAfter.localStorageAccessible && probeAfter.sessionStorageAccessible);

  // PART 7 (ENV-B2) — read-only Storage property check: assigning a
  // replacement to window.localStorage/sessionStorage must never
  // silently replace the installed object. A throw under strict-mode
  // assignment is also acceptable evidence of read-only-ness.
  const readOnlyCheck = await page.evaluate(() => {
    const beforeLocal = window.localStorage;
    const beforeSession = window.sessionStorage;
    let threwOnLocalAssign = false;
    let threwOnSessionAssign = false;
    try {
      window.localStorage = { __replacement: true };
    } catch {
      threwOnLocalAssign = true;
    }
    try {
      window.sessionStorage = { __replacement: true };
    } catch {
      threwOnSessionAssign = true;
    }
    const localIdentityPreserved = window.localStorage === beforeLocal;
    const sessionIdentityPreserved = window.sessionStorage === beforeSession;
    return {
      localStorageReadOnly: threwOnLocalAssign || localIdentityPreserved,
      sessionStorageReadOnly: threwOnSessionAssign || sessionIdentityPreserved,
      localIdentityPreserved,
      sessionIdentityPreserved,
      threwOnLocalAssign,
      threwOnSessionAssign,
    };
  });

  // Step 8 — load the application.
  await page.setContent(app.html, { waitUntil: 'domcontentloaded', timeout: 30000 });

  // Step 9 — wait for window.__LUMIXA_QA__ (app.js + at least one Core
  // module executed — see qa/helpers/playwright-in-memory-app.mjs for
  // why this single flag is sufficient proof, per ES module evaluation
  // order).
  await page.waitForFunction(
    () => !!(window.__LUMIXA_QA__ && typeof window.__LUMIXA_QA__.getPreviewPipelineSnapshot === 'function'),
    null,
    { timeout: 20000 }
  );

  const evidence = toEvidenceSummary(app);

  async function cleanup() {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
  }

  // Step 10 — return context, page, app evidence, error collectors, cleanup.
  return {
    context,
    page,
    app,
    evidence,
    collectors,
    storageStatus,
    nativeStorageAvailable,
    storageAccessVerified,
    readOnlyCheck,
    cleanup,
  };
}

// ══════════════════════════════════════════════════════════════════
// PART 6 — Storage privacy key detection. Case-insensitive denylist;
// theme ("dm") and language ("lang") writes remain allowed. Only key
// NAMES are ever inspected — never values.
// ══════════════════════════════════════════════════════════════════
const PRIVACY_DENYLIST_PATTERNS = [/observation/i, /reason/i, /session/i, /interactivePreview/i, /ipo/i];
const ALLOWED_KEY_NAMES = new Set(['dm', 'lang']);

export function classifyStorageKeyPrivacyRisk(keyNames) {
  const flagged = [];
  for (const key of keyNames || []) {
    if (ALLOWED_KEY_NAMES.has(key)) continue;
    if (PRIVACY_DENYLIST_PATTERNS.some((re) => re.test(key))) flagged.push(key);
  }
  return { flagged, safe: flagged.length === 0 };
}

/** Reads only key NAMES from window.localStorage/sessionStorage — never values. */
export async function observeAppStorageKeys(page) {
  const result = await page.evaluate(() => {
    const collect = (store) => {
      const keys = [];
      try {
        for (let i = 0; i < store.length; i++) keys.push(store.key(i));
      } catch { /* leave keys as whatever was collected so far */ }
      return keys;
    };
    return { localStorageKeys: collect(window.localStorage), sessionStorageKeys: collect(window.sessionStorage) };
  });
  const merged = Array.from(new Set([...(result.localStorageKeys || []), ...(result.sessionStorageKeys || [])]));
  return { localStorageKeys: result.localStorageKeys, sessionStorageKeys: result.sessionStorageKeys, allKeys: merged };
}

// ══════════════════════════════════════════════════════════════════
// PART 5 — fail-closed In-Memory harness decision rule. Exported as a
// reusable pure function (unit-testable without a Browser): PASS
// requires a non-empty result set where EVERY row is exactly 'PASS'.
// Any FAIL, NOT_TESTED, malformed row, or empty set must not produce
// PASS_IN_MEMORY_HARNESS_READY.
//
// NOTE: qa/playwright-in-memory-app-smoke.mjs (the original ENV-B1B/
// ENV-B1B-F1 smoke test) is outside this round's ALLOWED FILES, so its
// own inline decision computation is left untouched this round. This
// corrected rule lives here as the canonical, reusable implementation
// for any current or future caller (including a later round that
// re-points the smoke test at it).
// ══════════════════════════════════════════════════════════════════
export function computeInMemoryHarnessDecision(results) {
  if (!Array.isArray(results) || results.length === 0) {
    return 'FAIL_IN_MEMORY_HARNESS';
  }
  const allRowsWellFormed = results.every(
    (r) => r && typeof r === 'object' && typeof r.result === 'string'
  );
  if (!allRowsWellFormed) return 'FAIL_IN_MEMORY_HARNESS';

  const allExactlyPass = results.every((r) => r.result === 'PASS');
  return allExactlyPass ? 'PASS_IN_MEMORY_HARNESS_READY' : 'FAIL_IN_MEMORY_HARNESS';
}
