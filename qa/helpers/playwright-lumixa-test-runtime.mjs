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

import { access, readFile, writeFile, rename } from 'node:fs/promises';
import { constants as FS_CONSTANTS } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import crypto from 'node:crypto';
import path from 'node:path';
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
  // I18N RUNTIME CLOSURE + QA INTEGRITY R3 — Phase A: single consistent
  // contract for every consumer. `available`/`chromium` are the
  // preferred fields going forward; `status`/`mod` are kept for the
  // existing consumers that already destructure `{ chromium } = pkg.mod`
  // — both shapes always agree with each other, verified by the
  // self-test in qa/epic-2e-j-playwright-contract-static-test.mjs.
  try {
    const mod = await import('playwright');
    return {
      available: true,
      status: 'PLAYWRIGHT_PACKAGE_AVAILABLE',
      mod,
      chromium: mod.chromium,
      error: null,
    };
  } catch (e) {
    return {
      available: false,
      status: 'PLAYWRIGHT_PACKAGE_UNAVAILABLE',
      mod: null,
      chromium: null,
      error: String((e && e.message) || e),
    };
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

/**
 * EPIC 2E-K-R2-FIX2 -- Section 7: unified Browser Detection Contract.
 *
 * Historically this function returned only `{found, versionOutput,
 * attempts}`, while qa/preflight.mjs read `detection.available` and
 * qa/epic-2e-k-calibration-lab-browser-test.mjs read
 * `chromiumInfo.executablePath` -- neither field ever existed, so both
 * callers silently treated a genuinely-detected Chromium as absent
 * (reported bugs #8/#9). The contract now ALWAYS returns all of:
 *   - `found`          (kept, unchanged meaning: absolute path string, or null)
 *   - `executablePath` (=== found -- the name every caller in this
 *                        codebase actually reads for the launch path)
 *   - `available`      (=== Boolean(found) -- the name Preflight reads)
 *   - `versionOutput`, `attempts` (unchanged)
 * A Contract Static Test (qa/epic-2e-k-r2-fix2-browser-contract-static-test.mjs)
 * asserts `executablePath === found` and `available === Boolean(found)`
 * on every call, so this triple can never drift apart again.
 */
export async function detectBrowserExecutable(chromium) {
  const candidates = [];
  if (typeof process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH === 'string' && process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH.length > 0) {
    candidates.push({ label: 'PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH env var', path: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });
  }
  try {
    const bundled = chromium && typeof chromium.executablePath === 'function' ? chromium.executablePath() : null;
    if (typeof bundled === 'string' && bundled.length > 0) candidates.push({ label: 'Playwright bundled Chromium', path: bundled });
  } catch { /* bundled path resolution itself can throw when nothing is installed — skip, never crash */ }
  // EPIC 2E-K-R2-FIX2 -- Section 7: this helper is invoked directly by
  // qa/preflight.mjs (via plain `node`, not only via the Windows .bat's
  // own separate `where chrome`/`where msedge`/`exist` probes -- see
  // RUN_LUMIXA_CALIBRATION_QA_WINDOWS.bat Step 3), so the SAME common-
  // system-path list that script already trusts is mirrored here for
  // process.platform === 'win32', in addition to the existing Linux
  // paths -- never a Windows-only rewrite of the Linux list, both sets
  // of candidates coexist and are probed in the same honest exists-
  // then-launch order.
  if (process.platform === 'win32') {
    const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const localAppData = process.env['LocalAppData'] || '';
    candidates.push(
      { label: 'Chrome (Program Files)', path: `${programFiles}\Google\Chrome\Application\chrome.exe` },
      { label: 'Chrome (Program Files x86)', path: `${programFilesX86}\Google\Chrome\Application\chrome.exe` },
      ...(localAppData ? [{ label: 'Chrome (LocalAppData)', path: `${localAppData}\Google\Chrome\Application\chrome.exe` }] : []),
      { label: 'Edge (Program Files x86)', path: `${programFilesX86}\Microsoft\Edge\Application\msedge.exe` },
      { label: 'Edge (Program Files)', path: `${programFiles}\Microsoft\Edge\Application\msedge.exe` },
    );
  } else {
    candidates.push(
      { label: '/usr/bin/chromium', path: '/usr/bin/chromium' },
      { label: '/usr/bin/chromium-browser', path: '/usr/bin/chromium-browser' },
      { label: '/usr/bin/google-chrome', path: '/usr/bin/google-chrome' },
      { label: '/usr/bin/google-chrome-stable', path: '/usr/bin/google-chrome-stable' },
      { label: '/opt/google/chrome/chrome', path: '/opt/google/chrome/chrome' },
    );
  }

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
      return { found: candidate.path, executablePath: candidate.path, available: true, versionOutput: stdout.trim(), attempts };
    } catch (e) {
      attempts.push({ ...candidate, exists: true, versionOutput: null, versionError: String((e && e.message) || e) });
    }
  }
  return { found: null, executablePath: null, available: false, versionOutput: null, attempts };
}

export const REQUIRED_LAUNCH_ARGS = ['--no-sandbox', '--disable-dev-shm-usage'];

// I18N RUNTIME CLOSURE + QA INTEGRITY R3 — Phase B: the ONE canonical
// selector for the real guided "Build Controlled V2 Preview" button —
// verified against index.html line 517 (`<button id="btnBuildControlledV2"`).
// Every Browser suite that needs to click this specific button must
// import this constant rather than hand-writing the ID string, so a
// future ID rename can never silently desync a test again the way the
// I18N RUNTIME CLOSURE R3 review found (`#buildControlledV2Btn` — an ID
// that has never existed in this app).
export const BUILD_CONTROLLED_V2_BUTTON_SELECTOR = '#btnBuildControlledV2';


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
// requires a non-empty result set where EVERY row is well-formed AND
// exactly {test: <non-empty string>, result: 'PASS'}. Any missing
// test, blank test, missing result, boolean result, NOT_TESTED, FAIL,
// unknown status, or empty Array must not produce
// PASS_IN_MEMORY_HARNESS_READY (FIX 11, ENV-B2-F2 — strengthens the
// previous version, which only validated `result` and never required a
// bounded, non-empty `test` name on every row).
//
// NOTE (updated ENV-B2-F1 / FIX 8): qa/playwright-in-memory-app-smoke.mjs
// imports and calls this exact function for its own final decision
// (replacing its previous inline `results.filter(r => r.result ===
// 'FAIL').length === 0` logic), and qa/epic-2e-j-phase-c-step7b-b-test.mjs
// reuses it too for its FIX 7 `environment.inMemoryHarnessDecision`
// metadata field — this is the single canonical, reusable
// implementation for every current caller.
// ══════════════════════════════════════════════════════════════════
export function computeInMemoryHarnessDecision(results) {
  if (!Array.isArray(results) || results.length === 0) {
    return 'FAIL_IN_MEMORY_HARNESS';
  }
  const allRowsWellFormed = results.every(
    (r) => r && typeof r === 'object' && typeof r.test === 'string' && r.test.trim().length > 0 && typeof r.result === 'string'
  );
  if (!allRowsWellFormed) return 'FAIL_IN_MEMORY_HARNESS';

  const allExactlyPass = results.every((r) => r.result === 'PASS');
  return allExactlyPass ? 'PASS_IN_MEMORY_HARNESS_READY' : 'FAIL_IN_MEMORY_HARNESS';
}

// ══════════════════════════════════════════════════════════════════
// COMBINED CLOSEOUT R2 — Phase E: Fail-Closed Result Artifact Identity.
//
// A stale result JSON from an earlier successful run must never be
// mistaken for evidence of the CURRENT run — especially when the
// current run crashed or the Browser became unavailable. Every real
// Browser-suite result now carries a `runId`/`startedAt`/`completedAt`/
// `completed`/`sourceHash`/`browserExecutablePath`/`browserVersion`
// identity block, is written atomically (temp file -> rename, never a
// partial overwrite of the official path), and can be independently
// validated as "current" by a pure function usable both by suites
// themselves and by static self-tests.
// ══════════════════════════════════════════════════════════════════

/** A fresh, non-empty run identifier — never reused across runs. */
export function generateRunId() {
  return crypto.randomUUID();
}

/**
 * Computes a single sha256 hex digest over the concatenated UTF-8
 * contents of every given absolute file path, in the GIVEN order (order
 * matters and must be held constant by callers so the same source set
 * always produces the same hash) — used to detect "this suite's own
 * source, or a shared helper it depends on, changed since this result
 * was written" without needing git or any external tooling. A missing
 * file fails closed by throwing (callers should let this propagate —
 * a suite that cannot read its own source has no business claiming a
 * current, verified result).
 */
export async function computeSourceHash(absoluteFilePaths) {
  const hash = crypto.createHash('sha256');
  for (const p of absoluteFilePaths) {
    const contents = await readFile(p, 'utf8');
    hash.update(path.basename(p));
    hash.update('\x00');
    hash.update(contents);
    hash.update('\x00');
  }
  return hash.digest('hex');
}

/**
 * Writes `dataObj` as pretty-printed JSON to `finalPath` ATOMICALLY: a
 * temporary sibling file (unique per-process/per-call, same directory
 * so the rename is on the same filesystem) is written first and fsync-
 * flushed by the OS on close, then renamed over `finalPath` in one
 * filesystem operation. A reader can therefore never observe a
 * partially-written official result file — it either sees the complete
 * prior file or the complete new one.
 */
export async function writeResultAtomic(finalPath, dataObj) {
  const dir = path.dirname(finalPath);
  const tmpPath = path.join(dir, `.${path.basename(finalPath)}.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`);
  const json = JSON.stringify(dataObj, null, 2);
  await writeFile(tmpPath, json);
  await rename(tmpPath, finalPath);
}

/**
 * Builds the standard identity block every real-Browser-suite result
 * must carry. `browserExecutablePath`/`browserVersion` are honest nulls
 * when no Browser was actually launched (e.g. the Browser-unavailable
 * path) — never fabricated.
 */
export function buildRunIdentity({ runId, startedAt, completedAt, completed, sourceHash, browserExecutablePath, browserVersion }) {
  return {
    runId: runId ?? null,
    startedAt: startedAt ?? null,
    completedAt: completedAt ?? null,
    completed: completed === true,
    sourceHash: sourceHash ?? null,
    browserExecutablePath: browserExecutablePath ?? null,
    browserVersion: browserVersion ?? null,
  };
}

/**
 * A single bounded "the suite crashed" evidence row — `errorName` only
 * (e.g. "TypeError", "SecurityError"), NEVER the full error message or
 * stack, which could leak file paths, arbitrary Runtime state, or be
 * unbounded in length.
 */
export function buildRuntimeCrashRow(error) {
  return { test: 'RUNTIME_CRASH', result: 'FAIL', evidence: `errorName=${(error && error.name) || 'UnknownError'}` };
}

/**
 * Pure validation: is `resultObj` a CURRENT, well-formed result for
 * `expectedSourceHash`? Every condition is required — this is the
 * single function both real suites (to decide whether to trust a prior
 * result before treating it as authoritative for cross-referencing) and
 * the static self-tests (FIX E5) exercise. Never throws; returns a
 * bounded `{ valid, reasons }` shape.
 */
export function validateResultFreshness(resultObj, { expectedSourceHash } = {}) {
  const reasons = [];
  if (!resultObj || typeof resultObj !== 'object') {
    return { valid: false, reasons: ['result is not an object'] };
  }
  if (resultObj.completed !== true) reasons.push('completed is not true');
  if (typeof resultObj.runId !== 'string' || resultObj.runId.trim().length === 0) reasons.push('runId is missing or empty');
  if (expectedSourceHash !== undefined && resultObj.sourceHash !== expectedSourceHash) reasons.push('sourceHash does not match the current sources');
  if (!Array.isArray(resultObj.results) || resultObj.results.length === 0) {
    reasons.push('results array is missing or empty');
  } else {
    const malformedRow = resultObj.results.some(
      (r) => !r || typeof r !== 'object' || typeof r.test !== 'string' || r.test.trim().length === 0 || typeof r.result !== 'string'
    );
    if (malformedRow) reasons.push('one or more result rows are malformed');
  }
  if (typeof resultObj.generatedAt !== 'string' && typeof resultObj.completedAt !== 'string') reasons.push('missing a generated/completed timestamp');
  return { valid: reasons.length === 0, reasons };
}

/**
 * FIX E4 — when Playwright/Browser is unavailable, writes an explicit,
 * CURRENT, atomically-written environment-status result (never PASS,
 * never merely leaving a stale prior PASS file untouched) so a reader
 * can never mistake an old successful run for evidence about the
 * present environment.
 */
export async function writeBrowserUnavailableResult(finalPath, { suite, status, reason }) {
  const nowIso = new Date().toISOString();
  const identity = buildRunIdentity({
    runId: generateRunId(),
    startedAt: nowIso,
    completedAt: nowIso,
    completed: true, // the SUITE completed its honest environment check — it did not crash
    sourceHash: null, // no suite-specific source hash claimed for an environment-only result
    browserExecutablePath: null,
    browserVersion: null,
  });
  const output = {
    suite,
    ...identity,
    generatedAt: nowIso,
    summary: { total: 1, pass: 0, fail: 0, notTested: 1 },
    results: [{ test: 'Browser environment availability', result: 'NOT_TESTED', evidence: reason }],
    decision: status, // e.g. 'BROWSER_BINARY_UNAVAILABLE' / 'PLAYWRIGHT_PACKAGE_UNAVAILABLE' — never 'PASS'
  };
  await writeResultAtomic(finalPath, output);
  return output;
}

// ══════════════════════════════════════════════════════════════════
// COMBINED CLOSEOUT R3 — Phase C FIX C2: the deterministic Human
// Review completion workflow, factored out of the Live App suite (it
// already reaches Ready/51-51 this way) so Observation Smoke can use
// the SAME real DOM-driven sequence — real Review Console "Pass"
// clicks + a real "Re-analyze" click — instead of a bare fixture
// upload followed by a fixed timeout. Behavior is unchanged from the
// Live App suite's own prior local copies of these functions; this is
// a pure extraction, never a rewrite.
// ══════════════════════════════════════════════════════════════════

/** Reads the safe, read-only `?qa=1` snapshot hook (or null if absent). */
export async function qaSnapshot(page) {
  return page.evaluate(() => (window.__LUMIXA_QA__ ? window.__LUMIXA_QA__.getPreviewPipelineSnapshot() : null));
}

/** Clicks every real Review Console "Pass" button currently present. */
/**
 * R4 Phase H fix: the previous return value was `itemIds.length` --
 * the TOTAL number of review items iterated over (manual/visual AND
 * system-verified alike) -- mislabeled as "clicked" by every caller's
 * evidence field. In truth, system-verified items render NO
 * `button[data-review-action="pass"]` at all (see
 * ui/review-console-renderer.js's `isSystemVerified` branch, which
 * renders only a read-only badge), so the `if (btn) btn.click();`
 * guard below was already correctly a no-op for every system item --
 * only the RETURN VALUE lied about what happened. Fixed to return a
 * bounded, honestly-labeled breakdown instead of one ambiguous number.
 */
export async function passAllReviewItems(page) {
  const itemIds = await page.evaluate(() => [...new Set(Array.from(document.querySelectorAll('#reviewConsoleInner [data-review-item-id]')).map((i) => i.dataset.reviewItemId))]);
  let manualVisualButtonsClicked = 0;
  let systemButtonsClicked = 0; // expected to stay 0 -- system-verified items have no Pass button to click
  let itemsWithNoButtonFound = 0;
  for (const itemId of itemIds) {
    const outcome = await page.evaluate((id) => {
      const container = document.querySelector(`#reviewConsoleInner [data-review-item-id="${id}"]`);
      const btn = container ? container.querySelector('button[data-review-action="pass"]') : null;
      if (btn) { btn.click(); return { clicked: true, hadButton: true }; }
      return { clicked: false, hadButton: false };
    }, itemId);
    if (outcome.clicked) manualVisualButtonsClicked += 1;
    else itemsWithNoButtonFound += 1;
    await page.waitForTimeout(80);
  }
  return {
    totalReviewItems: itemIds.length,
    manualVisualButtonsClicked,
    systemButtonsClicked, // always 0 by construction -- kept explicit rather than omitted, so a FUTURE regression that adds a clickable system-item button would show up as a nonzero value here instead of silently vanishing
    itemsWithNoButtonFound, // the system-verified items -- expected to equal totalReviewItems - manualVisualButtonsClicked
  };
}

/**
 * R4 Phase L: captures the real, currently-generated XMP text by
 * clicking the actual #btnDownload button and intercepting the Blob
 * passed to URL.createObjectURL -- this invokes the SAME production
 * serializeXMP()/downloadXMP() code path a real photographer's click
 * would, without ever triggering an actual browser file-save dialog
 * or writing to disk. Moved here (from
 * epic-2e-j-phase-c-live-app-test.mjs, which keeps its own local copy
 * unchanged to avoid touching an already-passing suite) so any other
 * suite -- e.g. the full-system TH/EN locale suite -- can prove the
 * XMP-exact-locale invariant without inventing a second
 * implementation of the same interception technique.
 */
export async function captureXmpText(page) {
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

/** SHA-256 hex digest of a text string (or of the empty string if `text` is null/undefined) -- used to prove exact-content equality without embedding a full XMP body in evidence JSON. */
export function sha256XmpText(text) {
  return crypto.createHash('sha256').update(text ?? '').digest('hex');
}

/** Polls the QA snapshot until a NEW, non-transient analysis Generation with an existing previewSandbox is observed (or times out). */
export async function waitForAnalysisCompletion(page, priorGeneration, maxWaitMs = 25000) {
  const start = Date.now();
  const transientInteractiveStates = new Set(['cancelled', 'preparing', null, undefined]);
  while (Date.now() - start < maxWaitMs) {
    const snapshot = await qaSnapshot(page);
    if (snapshot && snapshot.analysisGeneration > priorGeneration && snapshot.previewSandbox.exists && !transientInteractiveStates.has(snapshot.interactive?.state)) {
      return { completed: true, snapshot };
    }
    await page.waitForTimeout(300);
  }
  const finalSnapshot = await qaSnapshot(page);
  return { completed: finalSnapshot?.previewSandbox?.exists === true, snapshot: finalSnapshot };
}

/**
 * The full deterministic Ready-reachability workflow: upload the given
 * fixture (an ABSOLUTE path), wait for the initial analysis, click
 * every real Review Console "Pass" button, click the real "Re-analyze"
 * button, then wait for the resulting analysis to complete. Returns the
 * same shape as `waitForAnalysisCompletion()`.
 */
export async function importAndReachReady(page, fixtureAbsolutePath, priorGeneration) {
  await page.setInputFiles('#fileIn', fixtureAbsolutePath);
  await waitForAnalysisCompletion(page, priorGeneration);
  const genBeforeReview = await qaSnapshot(page).then((s) => s?.analysisGeneration ?? priorGeneration);
  await passAllReviewItems(page);
  await page.click('#btnReanalyze');
  return waitForAnalysisCompletion(page, genBeforeReview);
}
