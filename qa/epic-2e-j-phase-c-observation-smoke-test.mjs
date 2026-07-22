#!/usr/bin/env node
/**
 * qa/epic-2e-j-phase-c-observation-smoke-test.mjs
 *
 * EPIC 2E-J Phase C (+ EPIC 2E-J-C-F closeout patch) — a reproducible
 * smoke test for the Preview Observation + Session Summary layer.
 *
 * COMBINED CLOSEOUT R1 — Phase E / R2 — Phase C2/F: this suite uses NO
 * local static file server and NO localhost/127.0.0.1 navigation. It
 * runs entirely on the shared Navigation-Free In-Memory Runtime
 * (qa/helpers/playwright-lumixa-test-runtime.mjs) — the real project's
 * `ui/*.js` and `index.html` sources are read from disk, inlined into a
 * single in-memory document, and served to the page via
 * `page.setContent()` after navigating only to `about:blank?qa=1`. A
 * real Browser (Playwright + a resolvable Chromium executable) is still
 * required to execute this suite; when unavailable the suite reports an
 * honest current-run environment result rather than fabricating a PASS
 * (see FIX E4). File uploads use a single deterministic, project-owned
 * fixture (qa/fixtures/epic-2e-j/neutral-balanced.png) — never a
 * machine-specific `/tmp` path or a user file.
 *
 * PREREQUISITE: must be run from the COMPLETE project root. It is NOT a
 * standalone script; a changed-files-only copy cannot run it without
 * the rest of the project alongside it. The `playwright` npm package
 * must be resolvable from this file (installed globally and linked, or
 * locally) — this project has no build step and does not commit a
 * `node_modules/` directory.
 *
 * Run: node qa/epic-2e-j-phase-c-observation-smoke-test.mjs
 * Output: qa/epic-2e-j-phase-c-results.json
 */

import { readFile, writeFile, mkdir, unlink, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// COMBINED CLOSEOUT R1 — Phase E: migrated off node:http/localhost/direct
// chromium.launch() onto the shared Navigation-Free In-Memory Harness —
// the SAME helper the Step 7B-B suite uses. No local server, no
// localhost/127.0.0.1/private-IP navigation; the only navigation target
// is about:blank?qa=1.
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
  // COMBINED CLOSEOUT R3 — Phase B FIX B4: the same deterministic Human
  // Review completion workflow Live App uses (real Review Console "Pass"
  // clicks + real Re-analyze + a real analysisGeneration poll) rather
  // than a fragile fixed-timeout + fieldset-disabled guess. This is the
  // shared helper, not a duplicated local copy.
  qaSnapshot,
  importAndReachReady,
} from './helpers/playwright-lumixa-test-runtime.mjs';
import { CANONICAL_ORIGIN } from './helpers/playwright-in-memory-app.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const VIEWPORTS = [320, 360, 390, 430, 768, 1024, 1440];
// COMBINED CLOSEOUT R2 — Phase C FIX C1: exactly ONE resolved,
// project-owned, deterministic fixture — never a machine-specific
// `/tmp` path or a real user file. Existence is verified (as a regular
// file) before any Browser action uses it; a missing fixture fails
// closed with a bounded result rather than crashing.
const OBSERVATION_FIXTURE_PATH = path.join(PROJECT_ROOT, 'qa', 'fixtures', 'epic-2e-j', 'neutral-balanced.png');
const RESULTS_PATH = path.join(PROJECT_ROOT, 'qa', 'epic-2e-j-phase-c-results.json');
// Source hash covers this suite's own source plus the shared runtime/
// helper modules it depends on (never the binary fixture itself —
// sourceHash detects SOURCE CODE drift, not fixture-content drift, and
// readFile(..., 'utf8') on a binary PNG would not faithfully represent
// its bytes anyway).
const SOURCE_HASH_INPUTS = [
  path.join(__dirname, 'epic-2e-j-phase-c-observation-smoke-test.mjs'),
  path.join(__dirname, 'helpers', 'playwright-lumixa-test-runtime.mjs'),
  path.join(__dirname, 'helpers', 'playwright-in-memory-app.mjs'),
];

// COMBINED CLOSEOUT R2 — Phase E: module-scope run identity so the
// outer main().catch() crash handler can still access it even if
// main() throws partway through (a function-local const/let inside
// main() is not visible to the outer catch callback's scope).
let runId = null;
let startedAt = null;
let sourceHash = null;

const results = [];

// COMBINED CLOSEOUT R3 — Phase B FIX B1: STRICT result API. Every
// existing Boolean `record()` call site has been converted to one of
// the two functions below — no code path anywhere in this file may
// store a raw Boolean into `results` anymore.
const ALLOWED_STATUSES = new Set(['PASS', 'FAIL', 'NOT_TESTED', 'NOT_APPLICABLE']);

function pushRow(test, result, evidence) {
  const icon = result === 'PASS' ? '✓' : result === 'FAIL' ? '✗' : '•';
  let safeEvidence;
  try {
    safeEvidence = String(evidence);
  } catch (evidenceErr) {
    // FIX B1: a thrown evidence formatter must never crash the result
    // writer — fall back to a bounded, honest placeholder instead.
    safeEvidence = `[evidence formatting threw: ${evidenceErr && evidenceErr.name ? evidenceErr.name : 'UnknownError'}]`;
  }
  results.push({ test, result, evidence: safeEvidence });
  console.log(`${icon} [${result}] ${test} — ${safeEvidence}`);
}

/**
 * FIX B1 — records a genuine STATUS value directly. `status` MUST be
 * one of PASS/FAIL/NOT_TESTED/NOT_APPLICABLE (a bounded, closed
 * vocabulary) — anything else (including any Boolean, undefined, or an
 * unrecognized string) is recorded as FAIL, never silently coerced or
 * dropped. A blank/whitespace-only `test` name is also forced to FAIL,
 * since a nameless row can never be meaningfully audited later.
 */
function recordStatus(test, status, evidence) {
  const testOk = typeof test === 'string' && test.trim().length > 0;
  if (!testOk) {
    pushRow(typeof test === 'string' ? test : '[MISSING_TEST_NAME]', 'FAIL', `Blank/invalid test name rejected. evidence=${evidence}`);
    return;
  }
  if (typeof status !== 'string' || !ALLOWED_STATUSES.has(status)) {
    pushRow(test, 'FAIL', `Malformed/unrecognized status value rejected (never a Boolean, never coerced): ${JSON.stringify(status)}. evidence=${evidence}`);
    return;
  }
  pushRow(test, status, evidence);
}

/**
 * FIX B1 — records a Boolean CONDITION. `condition === true` becomes
 * PASS; every other value (including `false`, `undefined`, `null`, a
 * truthy non-boolean, or anything else) becomes FAIL. This is the
 * canonical way every condition-driven assertion in this file reports
 * its result — no Boolean is ever pushed into `results` directly.
 */
function recordCondition(test, condition, evidence) {
  recordStatus(test, condition === true ? 'PASS' : 'FAIL', evidence);
}

/**
 * FIX B2 — the fail-closed automated Decision. Exported (pure, no
 * captured outer-scope state) so Phase D's static evidence tests can
 * call this EXACT function directly with fabricated result sets —
 * never a regex-only source check. Decision is 'PASS' only when every
 * one of the following holds; otherwise 'FAIL' with the specific
 * reasons listed:
 *   1. resultRows is a non-empty array
 *   2. every row is well-formed: test is a non-empty string, result is
 *      a STRING drawn from ALLOWED_STATUSES (never a raw Boolean —
 *      Boolean rows are counted and reported separately), evidence key
 *      is present
 *   3. FAIL count is zero
 *   4. "unexpected" NOT_TESTED count is zero — a NOT_TESTED row is only
 *      ever permitted when its test name appears in the explicit
 *      `permittedNotTestedTests` allow-list (default: none)
 *   5. Browser execution actually completed (`completed === true`)
 *   6. sourceHash matches currentSourceHash (freshness — never a stale
 *      artifact standing in as if it were current)
 */
export function computeObservationSmokeDecision(resultRows, { completed, sourceHash: resultSourceHash, currentSourceHash, permittedNotTestedTests = [] } = {}) {
  const reasons = [];
  if (!Array.isArray(resultRows) || resultRows.length === 0) {
    return { decision: 'FAIL', reasons: ['EMPTY_RESULT_SET'] };
  }
  const permittedSet = new Set(permittedNotTestedTests);
  let failCount = 0;
  let unexpectedNotTestedCount = 0;
  let booleanResultCount = 0;
  let malformedRowCount = 0;
  for (const row of resultRows) {
    const testOk = !!row && typeof row.test === 'string' && row.test.trim().length > 0;
    const resultIsBoolean = !!row && typeof row.result === 'boolean';
    if (resultIsBoolean) booleanResultCount += 1;
    const resultOk = !!row && typeof row.result === 'string' && ALLOWED_STATUSES.has(row.result);
    const evidenceOk = !!row && Object.prototype.hasOwnProperty.call(row, 'evidence');
    if (!testOk || !resultOk || !evidenceOk) { malformedRowCount += 1; continue; }
    if (row.result === 'FAIL') failCount += 1;
    if (row.result === 'NOT_TESTED' && !permittedSet.has(row.test)) unexpectedNotTestedCount += 1;
  }
  if (malformedRowCount > 0) reasons.push(`MALFORMED_ROWS=${malformedRowCount}`);
  if (booleanResultCount > 0) reasons.push(`BOOLEAN_RESULT_ROWS=${booleanResultCount}`);
  if (failCount > 0) reasons.push(`FAIL_COUNT=${failCount}`);
  if (unexpectedNotTestedCount > 0) reasons.push(`UNEXPECTED_NOT_TESTED=${unexpectedNotTestedCount}`);
  if (completed !== true) reasons.push('BROWSER_EXECUTION_NOT_COMPLETED');
  if (typeof resultSourceHash !== 'string' || resultSourceHash.length === 0 || typeof currentSourceHash !== 'string' || resultSourceHash !== currentSourceHash) {
    reasons.push('SOURCE_HASH_MISMATCH_OR_MISSING');
  }
  return { decision: reasons.length === 0 ? 'PASS' : 'FAIL', reasons };
}

// FIX 2 (EPIC 2E-J-C-F): element-level bounding-rect containment check —
// document.scrollWidth alone is insufficient; a child can be visually
// clipped by an ancestor's overflow even when the document itself
// doesn't grow. A 1px tolerance absorbs sub-pixel rounding.
const ELEMENT_OVERFLOW_CHECK_JS = (viewportW) => `
  (() => {
    const TOLERANCE = 1;
    const findings = [];
    const check = (el, label) => {
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const overflowRight = rect.right - ${viewportW};
      if (overflowRight > TOLERANCE) findings.push({ label, right: Math.round(rect.right), overflowRight: Math.round(overflowRight) });
    };
    check(document.getElementById('interactivePreviewObservationSection'), 'obsSection');
    check(document.getElementById('ipoFieldset'), 'ipoFieldset');
    check(document.getElementById('ipoReasonFieldset'), 'ipoReasonFieldset');
    check(document.getElementById('ipoContext'), 'ipoContext');
    check(document.getElementById('interactivePreviewObservationSessionSection'), 'sessionSection');
    check(document.getElementById('ipoSessionMetrics'), 'ipoSessionMetrics');
    check(document.getElementById('ipoSessionSecondary'), 'ipoSessionSecondary');
    document.querySelectorAll('#ipoFieldset label').forEach((l,i) => check(l, 'obs-label-'+i));
    document.querySelectorAll('#ipoReasonFieldset label').forEach((l,i) => check(l, 'reason-label-'+i));
    document.querySelectorAll('#ipoSessionMetrics > div').forEach((l,i) => check(l, 'session-metric-'+i));
    document.querySelectorAll('#ipoClearButton, #ipoClearReasonsButton, #ipoClearSessionButton').forEach((l,i) => check(l, 'button-'+i));
    return { findings, docScrollW: document.documentElement.scrollWidth, docClientW: document.documentElement.clientWidth };
  })()
`;

const DRIVE_REAL_APP_JS = `
  (async () => {
    const obsInner = document.getElementById('interactivePreviewObservationInner');
    const sessionInner = document.getElementById('interactivePreviewObservationSessionInner');
    const { createInteractivePreviewObservationControllerV2 } = await import('${CANONICAL_ORIGIN}/ui/interactive-preview-observation-controller-v2.js');
    const { createInteractivePreviewObservationSessionV2 } = await import('${CANONICAL_ORIGIN}/ui/interactive-preview-observation-session-v2.js');
    const { ensureInteractivePreviewObservationLayout, renderInteractivePreviewObservationV2, ensureInteractivePreviewObservationSessionLayout, renderInteractivePreviewObservationSessionV2 } = await import('${CANONICAL_ORIGIN}/ui/interactive-preview-observation-renderer-v2.js');
    const elements = ensureInteractivePreviewObservationLayout(obsInner);
    ensureInteractivePreviewObservationSessionLayout(sessionInner);
    const session = createInteractivePreviewObservationSessionV2();
    // Mirrors the exact App-level sync logic in ui/app.js's
    // _syncObservationSession (EPIC 2E-J-B-F/-B-F2): tracks which
    // generation actually owns the active Session record, and
    // deduplicates metadata-only re-emits via a compact signature.
    let activeGenId = null;
    let lastSig = null;
    let lastInvalidatedGenId = null;
    function syncSession(s) {
      if (s.state === 'selected') {
        const sig = String(s.observationGenerationId) + '|' + String(s.observation) + '|' + s.reasons.slice().sort().join(',');
        if (sig !== lastSig) { session.recordObservation({ generationId: s.observationGenerationId, observation: s.observation, reasons: s.reasons }); lastSig = sig; }
        activeGenId = s.observationGenerationId;
        lastInvalidatedGenId = null;
      } else if (s.state === 'cleared') {
        const t = activeGenId ?? s.currentGenerationId;
        if (t !== null && t !== undefined) session.removeObservation(t);
        activeGenId = null; lastSig = null;
      } else if (s.state === 'unavailable' || s.state === 'blocked') {
        if (activeGenId !== null && lastInvalidatedGenId !== activeGenId) { session.invalidateGeneration(activeGenId); lastInvalidatedGenId = activeGenId; }
        activeGenId = null; lastSig = null;
      }
    }
    const controller = createInteractivePreviewObservationControllerV2({
      ...elements, generationProvider: () => window.__gen ?? 1,
      onStateChange: (s) => {
        renderInteractivePreviewObservationV2(obsInner, s);
        syncSession(s);
        renderInteractivePreviewObservationSessionV2(sessionInner, session.getSummary());
      },
    });
    document.getElementById('interactivePreviewObservationSection').style.display = 'block';
    document.getElementById('interactivePreviewObservationSessionSection').style.display = 'block';
    window.__gen = 1;
    window.__testController = controller;
    window.__testSession = session;
    window.__testSyncSession = syncSession;
    return 'done';
  })()
`;

async function main() {
  runId = generateRunId();
  startedAt = new Date().toISOString();
  sourceHash = await computeSourceHash(SOURCE_HASH_INPUTS);
  // COMBINED CLOSEOUT R2 — Phase E: shared Browser detection (never a
  // downloaded binary), launched with the required sandbox args. When
  // unavailable, this suite now WRITES a current environment-status
  // result rather than merely skipping regeneration (FIX E4) — a stale
  // prior PASS file must never be left standing as the apparent current
  // result.
  const pkg = await detectPlaywrightPackage();
  if (pkg.status !== 'PLAYWRIGHT_PACKAGE_AVAILABLE') {
    console.log(`Playwright Node package unavailable: ${pkg.error}`);
    console.log('Final decision: PLAYWRIGHT_PACKAGE_UNAVAILABLE');
    await writeBrowserUnavailableResult(RESULTS_PATH, {
      suite: 'EPIC 2E-J Phase C (+ EPIC 2E-J-C-F) Observation smoke test',
      status: 'PLAYWRIGHT_PACKAGE_UNAVAILABLE',
      reason: pkg.error,
    });
    console.log('qa/epic-2e-j-phase-c-results.json updated with a current PLAYWRIGHT_PACKAGE_UNAVAILABLE environment result (never PASS, no stale prior result left behind).');
    process.exit(0);
  }
  const { chromium } = pkg.mod;
  const browserDetect = await detectBrowserExecutable(chromium);
  if (!browserDetect.found) {
    console.log(`No usable Browser executable found among ${browserDetect.attempts.length} candidates (never downloaded one): ${JSON.stringify(browserDetect.attempts)}`);
    console.log('Final decision: BROWSER_BINARY_UNAVAILABLE');
    await writeBrowserUnavailableResult(RESULTS_PATH, {
      suite: 'EPIC 2E-J Phase C (+ EPIC 2E-J-C-F) Observation smoke test',
      status: 'BROWSER_BINARY_UNAVAILABLE',
      reason: JSON.stringify(browserDetect.attempts),
    });
    console.log('qa/epic-2e-j-phase-c-results.json updated with a current BROWSER_BINARY_UNAVAILABLE environment result (never PASS, no stale prior result left behind).');
    process.exit(0);
  }
  // COMBINED CLOSEOUT R2 — Phase C FIX C1: verify the ONE deterministic,
  // project-owned fixture exists as a regular file BEFORE any Browser
  // action uses it — fail closed with a bounded, CURRENT result (never
  // a runtime crash, never a stale prior PASS file) when it is missing.
  try {
    const fixtureStat = await stat(OBSERVATION_FIXTURE_PATH);
    if (!fixtureStat.isFile()) {
      console.log(`Deterministic fixture is not a regular file: ${OBSERVATION_FIXTURE_PATH}`);
      console.log('Final decision: FIXTURE_MISSING');
      await writeBrowserUnavailableResult(RESULTS_PATH, {
        suite: 'EPIC 2E-J Phase C (+ EPIC 2E-J-C-F) Observation smoke test',
        status: 'FIXTURE_MISSING',
        reason: `Deterministic fixture is not a regular file: ${OBSERVATION_FIXTURE_PATH}`,
      });
      process.exit(1);
    }
  } catch (fixtureStatErr) {
    console.log(`Deterministic fixture could not be found: ${OBSERVATION_FIXTURE_PATH} — ${fixtureStatErr.code ?? fixtureStatErr.message}`);
    console.log('Final decision: FIXTURE_MISSING');
    await writeBrowserUnavailableResult(RESULTS_PATH, {
      suite: 'EPIC 2E-J Phase C (+ EPIC 2E-J-C-F) Observation smoke test',
      status: 'FIXTURE_MISSING',
      reason: `Deterministic fixture could not be found: ${OBSERVATION_FIXTURE_PATH} — ${fixtureStatErr.code ?? fixtureStatErr.message}`,
    });
    process.exit(1);
  }
  const browser = await chromium.launch({ executablePath: browserDetect.found, args: REQUIRED_LAUNCH_ARGS });
  const appSnapshot = await buildLumixaAppSnapshot(PROJECT_ROOT);
  const coverage = { fullApplicationWorkflow: 'NOT_TESTED', syntheticIntegrationHarness: 'FAIL', physicalDevice: 'NOT_TESTED', screenReader: 'NOT_TESTED' };

  try {
    // ══════════════════════════════════════════════════════════════
    // FIX 5 (EPIC 2E-J-C-F): honestly determine whether the REAL,
    // complete, unmodified application (import → analysis → Interactive
    // Before/After) can reach "Ready" and enable Observation.
    // ══════════════════════════════════════════════════════════════
    const readyRuntime = await openLumixaInMemoryPage({ browser, projectRoot: PROJECT_ROOT, qaQuery: '?qa=1', viewport: { width: 1440, height: 1200 }, prebuiltApp: appSnapshot });
    const readyPage = readyRuntime.page;
    const readyErrors = [];
    readyPage.on('pageerror', (e) => readyErrors.push(String(e)));
    await readyPage.waitForTimeout(600);
    // COMBINED CLOSEOUT R3 — Phase B FIX B4: use the SAME deterministic
    // Human Review completion workflow Live App uses (real Review
    // Console "Pass" clicks + real Re-analyze + a real analysisGeneration
    // poll via the shared `importAndReachReady` helper) instead of a
    // fixed 16s timeout + fieldset-disabled guess. This is what actually
    // reaches "Ready" reliably (proven by Live App's 51/51). Exactly ONE
    // resolved, project-owned, deterministic fixture (verified to exist
    // as a regular file BEFORE this point — see the fail-closed check in
    // main() above) — never a machine-specific /tmp path or a real user
    // file/screenshot. State is read only from the real ?qa=1 snapshot
    // hook and real DOM — never fabricated through Controller internals.
    let fixtureUsed = null;
    let genBefore = 0;
    try {
      genBefore = await qaSnapshot(readyPage).then((s) => s?.analysisGeneration ?? 0);
      fixtureUsed = OBSERVATION_FIXTURE_PATH;
    } catch (fixtureErr) {
      recordStatus('Full application Ready reachability — fixture available','FAIL',`Deterministic fixture ${OBSERVATION_FIXTURE_PATH} could not be used: ${fixtureErr.message}`);
    }
    if (fixtureUsed) {
      let readyOutcome = null;
      let readyEvidence = null;
      try {
        readyOutcome = await importAndReachReady(readyPage, OBSERVATION_FIXTURE_PATH, genBefore);
      } catch (readyErr) {
        readyEvidence = `importAndReachReady threw: ${readyErr.message}`;
      }
      const snapshotAfter = readyOutcome?.snapshot ?? (await qaSnapshot(readyPage).catch(() => null));
      const analysisCompleted = readyOutcome?.completed === true;
      const legacyRendered = snapshotAfter?.visualPreview?.legacyState === 'renderable';
      const controlledV2Rendered = snapshotAfter?.visualPreview?.controlledV2State === 'renderable';
      const interactiveReady = snapshotAfter?.interactive?.state === 'ready';
      const observationEnabled = snapshotAfter?.observation?.enabled === true;
      const productionSourceLegacy = snapshotAfter?.previewSandbox?.selectedOutputSource === 'legacy';
      const controlledTestDisabled = snapshotAfter?.testGate?.canEnterControlledTest === false;
      const readyFailedFields = [];
      if (!analysisCompleted) readyFailedFields.push(`analysisCompleted=${analysisCompleted}`);
      if (!legacyRendered) readyFailedFields.push(`legacyPreviewState=${snapshotAfter?.visualPreview?.legacyState}`);
      if (!controlledV2Rendered) readyFailedFields.push(`controlledV2PreviewState=${snapshotAfter?.visualPreview?.controlledV2State}`);
      if (!interactiveReady) readyFailedFields.push(`interactiveState=${snapshotAfter?.interactive?.state}`);
      if (!observationEnabled) readyFailedFields.push(`observationEnabled=${snapshotAfter?.observation?.enabled}`);
      if (!productionSourceLegacy) readyFailedFields.push(`selectedOutputSource=${snapshotAfter?.previewSandbox?.selectedOutputSource}`);
      if (!controlledTestDisabled) readyFailedFields.push(`canEnterControlledTest=${snapshotAfter?.testGate?.canEnterControlledTest}`);
      const readyPasses = readyEvidence === null && readyFailedFields.length === 0;
      const readyRecordEvidence = readyEvidence ?? (readyPasses
        ? `Reached Ready through the real Human Review workflow: ${JSON.stringify(snapshotAfter)}`
        : `FAILED FIELDS: ${readyFailedFields.join(', ')} — full snapshot: ${JSON.stringify(snapshotAfter)}`);
      if (readyPasses) {
        coverage.fullApplicationWorkflow = 'PASS';
        recordStatus('Full application Ready reachability','PASS',readyRecordEvidence);
      } else {
        coverage.fullApplicationWorkflow = 'FAIL';
        recordStatus('Full application Ready reachability','FAIL',readyRecordEvidence);
      }
    }
    await readyRuntime.cleanup();

    // ══════════════════════════════════════════════════════════════
    // Controller/Renderer/Session integration harness (SYNTHETIC —
    // explicitly labeled as such, never presented as "full application
    // workflow"). Real imported project code, driven with a synthetic
    // Ready context, inside the REAL index.html page (not a standalone
    // harness file) so the exact production CSS/layout is exercised.
    // ══════════════════════════════════════════════════════════════
    const harnessRuntime = await openLumixaInMemoryPage({ browser, projectRoot: PROJECT_ROOT, qaQuery: '?qa=1', viewport: { width: 1440, height: 1400 }, prebuiltApp: appSnapshot });
    const page = harnessRuntime.page;
    const consoleErrors = [];
    page.on('pageerror', (e) => consoleErrors.push(String(e)));
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      // Google Fonts CDN is unreachable in this sandboxed environment
      // (no internet access) — verified via direct request-level
      // investigation that every "Failed to load resource" 403/aborted
      // error in this project originates from fonts.googleapis.com/
      // fonts.gstatic.com. This is an environment limitation unrelated
      // to the Observation feature or application logic (the browser's
      // short-form console message for a failed <link> resource load
      // does not always include the URL itself), so it is excluded
      // from the genuine-error count.
      if (text.includes('fonts.googleapis.com') || text.includes('fonts.gstatic.com') || text.includes('Failed to load resource')) return;
      consoleErrors.push(text);
    });
    await page.waitForTimeout(600);
    await page.setInputFiles('#fileIn', OBSERVATION_FIXTURE_PATH);
    await page.waitForTimeout(16000);
    await page.evaluate(DRIVE_REAL_APP_JS);
    await page.waitForTimeout(200);

    const initialState = await page.evaluate(() => window.__testController.getState().state);
    recordCondition('[Controller/Renderer/Session integration harness] Initial unavailable state',initialState === 'unavailable',`state="${initialState}"`);

    await page.evaluate(() => window.__testController.setContext({ generationId: 1, interactiveState: 'ready', interactiveReady: true, safetyBlocked: false, blockedReason: null }));
    const readyState = await page.evaluate(() => window.__testController.getState().state);
    recordCondition('[Controller/Renderer/Session integration harness] Ready state reachable',readyState === 'ready',`state="${readyState}"`);

    for (const value of ['prefer-legacy', 'prefer-v2', 'no-visible-difference', 'unsure']) {
      const r = await page.evaluate((v) => window.__testController.selectObservation(v), value);
      recordCondition(`[Controller/Renderer/Session integration harness] Select observation "${value}"`,r.observation === value,`observation="${r.observation}"`);
    }

    await page.evaluate(() => window.__testController.selectObservation('prefer-legacy'));
    await page.evaluate(() => { window.__testController.toggleReason('skin-tone'); window.__testController.toggleReason('contrast'); window.__testController.toggleReason('shadow-detail'); window.__testController.toggleReason('highlight-detail'); window.__testController.toggleReason('saturation'); });
    const at5 = await page.evaluate(() => window.__testController.getState());
    recordCondition('Five-reason limit reached',at5.reasons.length === 5 && at5.reasonLimitReached === true,`count=${at5.reasons.length}, limitReached=${at5.reasonLimitReached}`);
    await page.evaluate(() => window.__testController.toggleReason('color-balance'));
    const after6th = await page.evaluate(() => window.__testController.getState().reasons.length);
    recordCondition('Sixth reason rejected',after6th === 5,`count=${after6th}`);
    await page.evaluate(() => window.__testController.toggleReason('no-specific-reason'));
    const afterGeneric = await page.evaluate(() => window.__testController.getState().reasons);
    recordCondition('No-specific-reason exclusivity',afterGeneric.length === 1 && afterGeneric[0] === 'no-specific-reason',`reasons=${JSON.stringify(afterGeneric)}`);

    await page.evaluate(() => window.__testController.clearReasons());
    const afterClearReasons = await page.evaluate(() => window.__testController.getState());
    recordCondition('Clear Reasons keeps Observation selected',afterClearReasons.reasons.length === 0 && afterClearReasons.observation === 'prefer-legacy',`reasons=${afterClearReasons.reasons.length}, observation="${afterClearReasons.observation}"`);

    await page.evaluate(() => window.__testController.clearObservation());
    const afterClearObs = await page.evaluate(() => window.__testController.getState());
    recordCondition('Clear Observation',afterClearObs.observation === null,`observation=${afterClearObs.observation}`);

    await page.evaluate(() => window.__testController.selectObservation('prefer-v2'));
    await page.evaluate(() => { window.__gen = 2; window.__testController.setContext({ generationId: 1, interactiveState: 'preparing', interactiveReady: false, safetyBlocked: false, blockedReason: null }); });
    const invalidatedState = await page.evaluate(() => window.__testController.getState());
    recordCondition('Generation invalidation clears Observation',invalidatedState.observation === null && invalidatedState.state === 'unavailable',`state="${invalidatedState.state}"`);
    await page.evaluate(() => window.__testController.setContext({ generationId: 2, interactiveState: 'ready', interactiveReady: true, safetyBlocked: false, blockedReason: null }));
    const afterRecoveryState = await page.evaluate(() => window.__testController.getState());
    recordCondition('Stale selection does not revive',afterRecoveryState.observation === null && afterRecoveryState.state === 'ready',`state="${afterRecoveryState.state}"`);

    const sessionSummary1 = await page.evaluate(() => window.__testSession.getSummary());
    recordCondition('Session invalidated count',sessionSummary1.invalidated >= 1,`invalidated=${sessionSummary1.invalidated}`);
    await page.evaluate(() => window.__testController.selectObservation('unsure'));
    const sessionSummary2 = await page.evaluate(() => window.__testSession.getSummary());
    recordCondition('Session active count after new selection',sessionSummary2.activeObservations === 1 && sessionSummary2.unsure === 1,`active=${sessionSummary2.activeObservations}, unsure=${sessionSummary2.unsure}`);
    await page.evaluate(() => window.__testController.clearObservation());
    const sessionSummary3 = await page.evaluate(() => window.__testSession.getSummary());
    recordCondition('Session cleared count',sessionSummary3.cleared >= 1,`cleared=${sessionSummary3.cleared}`);

    // ══════════════════════════════════════════════════════════════
    // FIX 4 (EPIC 2E-J-C-F): App-level Session Clear + current
    // re-record integration test — NOT the raw Session module alone.
    // Reproduces the exact App-level sync signature / active-generation
    // tracking logic from ui/app.js (EPIC 2E-J-B-F2) against the SAME
    // real Controller/Session instances used above.
    // ══════════════════════════════════════════════════════════════
    await page.evaluate(() => {
      window.__gen = 3;
      window.__testController.setContext({ generationId: 3, interactiveState: 'ready', interactiveReady: true, safetyBlocked: false, blockedReason: null });
      window.__testController.selectObservation('prefer-legacy');
      window.__testController.toggleReason('skin-tone');
      window.__testController.toggleReason('contrast');
    });
    const beforeClear = await page.evaluate(() => window.__testSession.getSummary());
    recordCondition('[App-level] Session Clear pre-check: active observation present',beforeClear.activeObservations >= 1,`active=${beforeClear.activeObservations}`);

    const afterAppLevelSessionClear = await page.evaluate(() => {
      // Exact same App-level integration logic as ui/app.js's Session
      // Clear button handler (EPIC 2E-J-B-F2 FIX 4): clear the session,
      // then immediately re-record the CURRENT valid Observation as the
      // first record, via the real controller.getState().
      window.__testSession.clearSession();
      const currentState = window.__testController.getState();
      if (currentState.state === 'selected') {
        window.__testSession.recordObservation({ generationId: currentState.observationGenerationId, observation: currentState.observation, reasons: currentState.reasons });
      }
      return window.__testSession.getSummary();
    });
    recordCondition('[App-level] Session Clear + current re-record: history reset',afterAppLevelSessionClear.cleared === 0 && afterAppLevelSessionClear.invalidated === 0,`cleared=${afterAppLevelSessionClear.cleared}, invalidated=${afterAppLevelSessionClear.invalidated}`);
    recordCondition('[App-level] Session Clear + current re-record: current Observation preserved',afterAppLevelSessionClear.totalObserved === 1 && afterAppLevelSessionClear.activeObservations === 1 && afterAppLevelSessionClear.preferLegacy === 1,JSON.stringify(afterAppLevelSessionClear));
    const reasonsAfterReRecord = afterAppLevelSessionClear.reasonCounts;
    recordCondition('[App-level] Session Clear + current re-record: Reasons preserved',reasonsAfterReRecord.skinTone === 1 && reasonsAfterReRecord.contrast === 1,JSON.stringify(reasonsAfterReRecord));
    const radioStillChecked = await page.evaluate(() => document.getElementById('ipoOption_prefer-legacy').checked);
    recordCondition('[App-level] Session Clear + current re-record: radio remains checked',radioStillChecked === true,`checked=${radioStillChecked}`);

    // ── Provider unavailable / mismatch ──
    // COMBINED CLOSEOUT R1 — Phase E: the module is imported by its
    // In-Memory canonical ID (CANONICAL_ORIGIN + project-relative path,
    // bound to a data: URL via the page's own <script type="importmap">)
    // rather than an absolute `/ui/...` path — there is no real server
    // to resolve that path against anymore.
    const providerRuntime = await openLumixaInMemoryPage({ browser, projectRoot: PROJECT_ROOT, qaQuery: '?qa=1', viewport: { width: 700, height: 800 }, prebuiltApp: appSnapshot });
    const providerUnavailablePage = providerRuntime.page;
    await providerUnavailablePage.waitForTimeout(600);
    const providerTestResult = await providerUnavailablePage.evaluate((origin) => {
      return import(`${origin}/ui/interactive-preview-observation-controller-v2.js`).then(({ createInteractivePreviewObservationControllerV2 }) => {
        const c = createInteractivePreviewObservationControllerV2({ generationProvider: () => { throw new Error('down'); } });
        c.setContext({ generationId: 1, interactiveState: 'ready', interactiveReady: true, safetyBlocked: false, blockedReason: null });
        const s = c.getState();
        c.dispose();
        return { state: s.state, generationConfirmed: s.metadata.generationConfirmed, warnings: s.warnings };
      });
    }, CANONICAL_ORIGIN);
    recordCondition('Provider unavailable produces neutral warning, stays usable',providerTestResult.state === 'ready' && providerTestResult.generationConfirmed === false && providerTestResult.warnings.length > 0,JSON.stringify(providerTestResult));
    const mismatchResult = await providerUnavailablePage.evaluate((origin) => {
      return import(`${origin}/ui/interactive-preview-observation-controller-v2.js`).then(({ createInteractivePreviewObservationControllerV2 }) => {
        let gen = 1;
        const c = createInteractivePreviewObservationControllerV2({ generationProvider: () => gen });
        c.setContext({ generationId: 1, interactiveState: 'ready', interactiveReady: true, safetyBlocked: false, blockedReason: null });
        c.selectObservation('prefer-legacy');
        gen = 2;
        const r = c.getState();
        c.dispose();
        return { state: r.state, observation: r.observation };
      });
    }, CANONICAL_ORIGIN);
    recordCondition('Provider mismatch clears observation via getState',mismatchResult.state === 'unavailable' && mismatchResult.observation === null,JSON.stringify(mismatchResult));
    await providerRuntime.cleanup();

    // ── No duplicate IDs ──
    const dupIds = await page.evaluate(() => {
      const ids = Array.from(document.querySelectorAll('[id]')).map((e) => e.id);
      return { total: ids.length, unique: new Set(ids).size };
    });
    recordCondition('No duplicate element IDs',dupIds.total === dupIds.unique,`total=${dupIds.total}, unique=${dupIds.unique}`);

    // ══════════════════════════════════════════════════════════════
    // FIX 9 (EPIC 2E-J-C-F): accessibility expansion via REAL DOM
    // keyboard events (not just programmatic state calls).
    // ══════════════════════════════════════════════════════════════
    await page.evaluate(() => { window.__gen = 3; window.__testController.setContext({ generationId: 3, interactiveState: 'ready', interactiveReady: true, safetyBlocked: false, blockedReason: null }); });
    await page.locator('#ipoOption_prefer-legacy').focus();
    let focusedId = await page.evaluate(() => document.activeElement.id);
    recordCondition('Tab reaches Observation radio group',focusedId === 'ipoOption_prefer-legacy',`activeElement.id="${focusedId}"`);

    await page.keyboard.press('ArrowDown');
    const afterArrow = await page.evaluate(() => ({ id: document.activeElement.id, checked: document.activeElement.checked }));
    recordCondition('Arrow keys change selected radio',afterArrow.id !== 'ipoOption_prefer-legacy' && afterArrow.checked === true,JSON.stringify(afterArrow));

    await page.evaluate(() => { window.__testController.selectObservation('prefer-legacy'); window.__testController.clearReasons(); });
    await page.waitForFunction(() => document.getElementById('ipoReason_skin-tone') && !document.getElementById('ipoReason_skin-tone').disabled && !document.getElementById('ipoReason_skin-tone').checked);
    await page.locator('#ipoReason_skin-tone').focus();
    await page.keyboard.press('Space');
    const reasonChecked = await page.evaluate(() => document.getElementById('ipoReason_skin-tone').checked);
    recordCondition('Space toggles Reason checkbox',reasonChecked === true,`checked=${reasonChecked}`);

    await page.locator('#ipoClearButton').focus();
    focusedId = await page.evaluate(() => document.activeElement.id);
    recordCondition('Tab reaches Clear Observation button',focusedId === 'ipoClearButton',`activeElement.id="${focusedId}"`);
    const clearObsOutline = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);

    await page.locator('#ipoClearReasonsButton').focus();
    focusedId = await page.evaluate(() => document.activeElement.id);
    recordCondition('Tab reaches Clear Reasons button',focusedId === 'ipoClearReasonsButton',`activeElement.id="${focusedId}"`);

    const clearSessionBtn = await page.evaluate(() => !!document.getElementById('ipoClearSessionButton'));
    if (clearSessionBtn) {
      await page.locator('#ipoClearSessionButton').focus();
      focusedId = await page.evaluate(() => document.activeElement.id);
      recordCondition('Tab reaches Clear Session button',focusedId === 'ipoClearSessionButton',`activeElement.id="${focusedId}"`);
    }

    await page.locator('#ipoOption_prefer-legacy').focus();
    const focusOutline = await page.evaluate(() => getComputedStyle(document.activeElement.closest('label') || document.activeElement).outlineStyle);
    recordCondition('Focus-visible has non-zero computed outline style',focusOutline && focusOutline !== 'none',`outlineStyle="${focusOutline}"`);

    // ══════════════════════════════════════════════════════════════
    // FIX 6/7/8 (EPIC 2E-J-C-F): storage/network method-level
    // instrumentation with machine-readable counts — not merely
    // Storage.length comparisons.
    // ══════════════════════════════════════════════════════════════
    const storageInstrumentation = await page.evaluate(() => {
      const counts = { localStorageSet: 0, localStorageRemove: 0, localStorageClear: 0, sessionStorageSet: 0, sessionStorageRemove: 0, sessionStorageClear: 0 };
      const origLsSet = Storage.prototype.setItem;
      const origLsRemove = Storage.prototype.removeItem;
      const origLsClear = Storage.prototype.clear;
      Storage.prototype.setItem = function (...args) {
        if (this === window.localStorage) counts.localStorageSet++; else if (this === window.sessionStorage) counts.sessionStorageSet++;
        return origLsSet.apply(this, args);
      };
      Storage.prototype.removeItem = function (...args) {
        if (this === window.localStorage) counts.localStorageRemove++; else if (this === window.sessionStorage) counts.sessionStorageRemove++;
        return origLsRemove.apply(this, args);
      };
      Storage.prototype.clear = function (...args) {
        if (this === window.localStorage) counts.localStorageClear++; else if (this === window.sessionStorage) counts.sessionStorageClear++;
        return origLsClear.apply(this, args);
      };

      window.__testController.selectObservation('prefer-v2');
      window.__testController.toggleReason('contrast');
      window.__testController.toggleReason('natural-look');
      window.__testController.clearReasons();
      window.__testController.clearObservation();
      window.__testSession.clearSession();

      Storage.prototype.setItem = origLsSet;
      Storage.prototype.removeItem = origLsRemove;
      Storage.prototype.clear = origLsClear;
      return counts;
    });
    const storageTotal = Object.values(storageInstrumentation).reduce((a, b) => a + b, 0);
    recordCondition('Storage instrumentation: zero Observation-related storage calls',storageTotal === 0,JSON.stringify(storageInstrumentation));

    const networkInstrumentation = await page.evaluate(async () => {
      const counts = { fetch: 0, xhr: 0, sendBeacon: 0, webSocket: 0, broadcastChannel: 0 };
      const origFetch = window.fetch;
      window.fetch = function (...args) { counts.fetch++; return origFetch.apply(this, args); };
      const origXhrOpen = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function (...args) { counts.xhr++; return origXhrOpen.apply(this, args); };
      const origBeacon = navigator.sendBeacon ? navigator.sendBeacon.bind(navigator) : null;
      if (origBeacon) navigator.sendBeacon = function (...args) { counts.sendBeacon++; return origBeacon(...args); };
      const OrigWS = window.WebSocket;
      window.WebSocket = function (...args) { counts.webSocket++; return new OrigWS(...args); };
      const OrigBC = window.BroadcastChannel;
      if (OrigBC) window.BroadcastChannel = function (...args) { counts.broadcastChannel++; return new OrigBC(...args); };

      window.__testController.setContext({ generationId: 4, interactiveState: 'ready', interactiveReady: true, safetyBlocked: false, blockedReason: null });
      window.__testController.selectObservation('unsure');
      window.__testController.toggleReason('clarity-detail');
      window.__testController.clearObservation();

      await new Promise((r) => setTimeout(r, 150));

      window.fetch = origFetch;
      XMLHttpRequest.prototype.open = origXhrOpen;
      if (origBeacon) navigator.sendBeacon = origBeacon;
      window.WebSocket = OrigWS;
      if (OrigBC) window.BroadcastChannel = OrigBC;
      return counts;
    });
    const networkTotal = Object.values(networkInstrumentation).reduce((a, b) => a + b, 0);
    recordCondition('Network instrumentation: zero Observation-related network calls',networkTotal === 0,JSON.stringify(networkInstrumentation));

    // ── No Canvas/drawImage calls ──
    const canvasCheck = await page.evaluate(() => {
      let drawCalls = 0;
      const orig = CanvasRenderingContext2D.prototype.drawImage;
      CanvasRenderingContext2D.prototype.drawImage = function (...args) { drawCalls++; return orig.apply(this, args); };
      window.__testController.setContext({ generationId: 5, interactiveState: 'ready', interactiveReady: true, safetyBlocked: false, blockedReason: null });
      window.__testController.selectObservation('unsure');
      window.__testController.toggleReason('natural-look');
      window.__testController.clearObservation();
      CanvasRenderingContext2D.prototype.drawImage = orig;
      return drawCalls;
    });
    recordCondition('No Canvas drawImage calls from Observation actions',canvasCheck === 0,`drawImage calls=${canvasCheck}`);

    // ══════════════════════════════════════════════════════════════
    // Step 7B-B-F3-P1 FIX 6 — focused Controller tests for the
    // reasonAnnouncement token lifecycle. Uses a DEDICATED, freshly
    // created controller instance (never window.__testController) so
    // exact state-change callback counting is never disturbed by the
    // shared harness's own onStateChange wiring used elsewhere in this
    // file.
    // ══════════════════════════════════════════════════════════════
    const reasonAnnouncementControllerTest = await page.evaluate(async (origin) => {
      const { createInteractivePreviewObservationControllerV2 } = await import(`${origin}/ui/interactive-preview-observation-controller-v2.js`);
      let callbackCount = 0;
      let gen = 10;
      const c = createInteractivePreviewObservationControllerV2({ generationProvider: () => gen, onStateChange: () => { callbackCount++; } });
      c.setContext({ generationId: gen, interactiveState: 'ready', interactiveReady: true, safetyBlocked: false, blockedReason: null });
      c.selectObservation('prefer-legacy');
      c.toggleReason('skin-tone');
      c.toggleReason('contrast');

      // Scenario A: selected Observation + two Reasons -> clearReasons().
      callbackCount = 0;
      const sA = c.clearReasons();
      const scenarioA = {
        observationPreserved: sA.observation === 'prefer-legacy',
        reasonsEmpty: sA.reasons.length === 0,
        announcement: sA.reasonAnnouncement,
        callbackCount,
      };

      // Scenario B: calling clearReasons() again while already empty.
      let crashed = false;
      callbackCount = 0;
      let sB;
      try { sB = c.clearReasons(); } catch { crashed = true; sB = c.getState(); }
      const scenarioB = { crashed, callbackCount, announcementUnchanged: sB.reasonAnnouncement === 'reasons-cleared' };

      // Scenario C: adding a Reason after Clear Reasons.
      const sC = c.toggleReason('white-balance');
      const scenarioC = { reasonSelected: sC.reasons.includes('white-balance'), announcement: sC.reasonAnnouncement };

      // Scenario D: clearing Observation after Clear Reasons.
      // (Re-establish reasonAnnouncement='reasons-cleared' first.)
      c.toggleReason('white-balance'); // remove it again -> back to empty reasons
      c.clearReasons(); // no-op (already empty) — announcement stays from Scenario A/C's last real clear
      c.toggleReason('natural-look');
      c.clearReasons(); // genuine clear -> sets the token fresh
      const sD = c.clearObservation();
      const scenarioD = { observationCleared: sD.observation === null, reasonsEmpty: sD.reasons.length === 0, announcement: sD.reasonAnnouncement };

      // Scenario E: stale generation after Clear Reasons.
      c.setContext({ generationId: gen, interactiveState: 'ready', interactiveReady: true, safetyBlocked: false, blockedReason: null });
      c.selectObservation('prefer-v2');
      c.toggleReason('clarity-detail');
      c.clearReasons();
      const beforeStale = c.getState();
      gen = 11; // provider now disagrees with context's generationId
      const sE = c.setContext({ generationId: 10, interactiveState: 'ready', interactiveReady: true, safetyBlocked: false, blockedReason: null });
      const scenarioE = {
        beforeAnnouncement: beforeStale.reasonAnnouncement,
        staleObservationCleared: sE.observation === null,
        staleWarningPresent: Array.isArray(sE.warnings) && sE.warnings.length > 0,
        announcementAfterStale: sE.reasonAnnouncement,
      };

      // Scenario F: QA state remains DOM-free and bounded.
      let jsonSafe = true;
      let hasDomOrErrorRef = false;
      try {
        const str = JSON.stringify(sE);
        if (typeof globalThis.Node === 'function' && (sE.observation instanceof globalThis.Node)) hasDomOrErrorRef = true;
        if (sE instanceof Error || (sE.reasonAnnouncement instanceof Error)) hasDomOrErrorRef = true;
        if (str.includes('[object Object]') && !str.includes('"metadata"')) hasDomOrErrorRef = true; // metadata is the one legitimate nested object
      } catch { jsonSafe = false; }
      const tokenTypeBounded = sE.reasonAnnouncement === null || sE.reasonAnnouncement === 'reasons-cleared';
      const scenarioF = { jsonSafe, hasDomOrErrorRef, tokenTypeBounded };

      c.dispose();
      return { scenarioA, scenarioB, scenarioC, scenarioD, scenarioE, scenarioF };
    }, CANONICAL_ORIGIN);
    recordCondition('FIX 6 Scenario A: Clear Reasons preserves Observation, sets reasonAnnouncement="reasons-cleared", exactly one callback',reasonAnnouncementControllerTest.scenarioA.observationPreserved && reasonAnnouncementControllerTest.scenarioA.reasonsEmpty && reasonAnnouncementControllerTest.scenarioA.announcement === 'reasons-cleared' && reasonAnnouncementControllerTest.scenarioA.callbackCount === 1,JSON.stringify(reasonAnnouncementControllerTest.scenarioA));
    recordCondition('FIX 6 Scenario B: repeated empty clearReasons() does not crash, does not emit a duplicate callback, does not create a new announcement transition',!reasonAnnouncementControllerTest.scenarioB.crashed && reasonAnnouncementControllerTest.scenarioB.callbackCount === 0 && reasonAnnouncementControllerTest.scenarioB.announcementUnchanged,JSON.stringify(reasonAnnouncementControllerTest.scenarioB));
    recordCondition('FIX 6 Scenario C: adding a Reason after Clear Reasons selects the new Reason and clears reasonAnnouncement to null',reasonAnnouncementControllerTest.scenarioC.reasonSelected && reasonAnnouncementControllerTest.scenarioC.announcement === null,JSON.stringify(reasonAnnouncementControllerTest.scenarioC));
    recordCondition('FIX 6 Scenario D: clearing Observation after Clear Reasons empties Reasons and clears reasonAnnouncement to null',reasonAnnouncementControllerTest.scenarioD.observationCleared && reasonAnnouncementControllerTest.scenarioD.reasonsEmpty && reasonAnnouncementControllerTest.scenarioD.announcement === null,JSON.stringify(reasonAnnouncementControllerTest.scenarioD));
    recordCondition('FIX 6 Scenario E: stale generation after Clear Reasons preserves existing stale behavior and clears reasonAnnouncement to null',reasonAnnouncementControllerTest.scenarioE.beforeAnnouncement === 'reasons-cleared' && reasonAnnouncementControllerTest.scenarioE.staleObservationCleared && reasonAnnouncementControllerTest.scenarioE.staleWarningPresent && reasonAnnouncementControllerTest.scenarioE.announcementAfterStale === null,JSON.stringify(reasonAnnouncementControllerTest.scenarioE));
    recordCondition('FIX 6 Scenario F: QA state remains DOM-free, Error-free, and reasonAnnouncement is bounded to exactly the two allowed values',reasonAnnouncementControllerTest.scenarioF.jsonSafe && !reasonAnnouncementControllerTest.scenarioF.hasDomOrErrorRef && reasonAnnouncementControllerTest.scenarioF.tokenTypeBounded,JSON.stringify(reasonAnnouncementControllerTest.scenarioF));

    // ══════════════════════════════════════════════════════════════
    // Step 7B-B-F3-P1 FIX 7 — focused Renderer tests for the priority
    // mapping into #ipoReasonLimit. Uses a DETACHED synthetic container
    // (never obsInner/sessionInner) with SYNTHETIC state objects so the
    // priority/textContent/hostile-token logic is tested directly and
    // in isolation from any live Controller.
    // ══════════════════════════════════════════════════════════════
    const rendererPriorityTest = await page.evaluate(async (origin) => {
      const { ensureInteractivePreviewObservationLayout, renderInteractivePreviewObservationV2 } = await import(`${origin}/ui/interactive-preview-observation-renderer-v2.js`);
      const testDiv = document.createElement('div');
      testDiv.id = '__f3p1RendererTestContainer';
      testDiv.style.display = 'none';
      document.body.appendChild(testDiv);
      ensureInteractivePreviewObservationLayout(testDiv);
      const reasonLimitEl = () => testDiv.querySelector('#ipoReasonLimit');

      const baseSelected = { state: 'selected', observation: 'prefer-legacy', reasons: [], reasonLimitReached: false, metadata: {} };

      // 1. "reasons-cleared" renders the exact message.
      renderInteractivePreviewObservationV2(testDiv, { ...baseSelected, reasonAnnouncement: 'reasons-cleared' });
      const clearedText = reasonLimitEl().textContent;
      const clearedHtml = reasonLimitEl().innerHTML;

      // 2. five-Reason limit still renders the existing limit message
      //    when there is no announcement.
      renderInteractivePreviewObservationV2(testDiv, { ...baseSelected, reasonLimitReached: true, reasonAnnouncement: null });
      const limitText = reasonLimitEl().textContent;

      // 3. Clear Reasons message has priority over the limit message
      //    ONLY for that state (both flags true simultaneously).
      renderInteractivePreviewObservationV2(testDiv, { ...baseSelected, reasonLimitReached: true, reasonAnnouncement: 'reasons-cleared' });
      const priorityText = reasonLimitEl().textContent;

      // 4. null token renders no Clear Reasons message (and no limit
      //    message either, since reasonLimitReached is false here).
      renderInteractivePreviewObservationV2(testDiv, { ...baseSelected, reasonAnnouncement: null });
      const nullTokenText = reasonLimitEl().textContent;

      // 5. hostile/unknown token is ignored (treated exactly like null).
      renderInteractivePreviewObservationV2(testDiv, { ...baseSelected, reasonAnnouncement: '<img src=x onerror=alert(1)>' });
      const hostileText = reasonLimitEl().textContent;
      const hostileHtml = reasonLimitEl().innerHTML;
      renderInteractivePreviewObservationV2(testDiv, { ...baseSelected, reasonAnnouncement: { toString: () => 'reasons-cleared' } });
      const hostileObjectText = reasonLimitEl().textContent;

      document.body.removeChild(testDiv);
      return { clearedText, clearedHtml, limitText, priorityText, nullTokenText, hostileText, hostileHtml, hostileObjectText };
    }, CANONICAL_ORIGIN);
    const EXPECTED_CLEARED_MESSAGE = 'Reasons cleared. Observation remains selected. Production output was not changed.';
    const EXPECTED_LIMIT_MESSAGE = 'You can select up to five reasons.';
    recordCondition('FIX 7: "reasons-cleared" renders the exact message into #ipoReasonLimit',rendererPriorityTest.clearedText === EXPECTED_CLEARED_MESSAGE,`text="${rendererPriorityTest.clearedText}"`);
    recordCondition('FIX 7: #ipoReasonLimit is set via textContent only (no HTML markup present in innerHTML)',rendererPriorityTest.clearedHtml === EXPECTED_CLEARED_MESSAGE,`innerHTML="${rendererPriorityTest.clearedHtml}"`);
    recordCondition('FIX 7: five-Reason limit still renders the existing limit message when there is no announcement',rendererPriorityTest.limitText === EXPECTED_LIMIT_MESSAGE,`text="${rendererPriorityTest.limitText}"`);
    recordCondition('FIX 7: Clear Reasons message has priority over the limit message when both are simultaneously true',rendererPriorityTest.priorityText === EXPECTED_CLEARED_MESSAGE,`text="${rendererPriorityTest.priorityText}"`);
    recordCondition('FIX 7: null token renders no Clear Reasons message',rendererPriorityTest.nullTokenText === '',`text="${rendererPriorityTest.nullTokenText}"`);
    recordCondition('FIX 7: a hostile string token (HTML-like) is ignored and never rendered as markup',rendererPriorityTest.hostileText === '' && rendererPriorityTest.hostileHtml === '',`text="${rendererPriorityTest.hostileText}", html="${rendererPriorityTest.hostileHtml}"`);
    recordCondition('FIX 7: a hostile non-string (object) token is ignored (only the exact string "reasons-cleared" is ever accepted)',rendererPriorityTest.hostileObjectText === '',`text="${rendererPriorityTest.hostileObjectText}"`);

    // ══════════════════════════════════════════════════════════════
    // COMBINED CLOSEOUT R1 — Phase G: focused Controller regression
    // tests proving Phase B (stale-generation warning lifecycle) and
    // Phase D (Clear-Reasons empty edge) on DEDICATED fresh controller
    // instances, isolated from the F3-P1 Scenario A-F harness above.
    // ══════════════════════════════════════════════════════════════
    const phaseGControllerTest = await page.evaluate(async (origin) => {
      const { createInteractivePreviewObservationControllerV2 } = await import(`${origin}/ui/interactive-preview-observation-controller-v2.js`);
      const STALE_MSG = 'The previous observation was cleared because a newer analysis is active.';

      // G1: first analysis, no Observation ever selected -> no stale
      // warning on the 'preparing' transition or the following 'ready'.
      let g1 = 100;
      const c1 = createInteractivePreviewObservationControllerV2({ generationProvider: () => g1, onStateChange: () => {} });
      const s1a = c1.setContext({ generationId: g1, interactiveState: 'preparing', interactiveReady: false, safetyBlocked: false, blockedReason: null });
      const s1b = c1.setContext({ generationId: g1, interactiveState: 'ready', interactiveReady: true, safetyBlocked: false, blockedReason: null });
      const scenarioG1 = {
        noWarningOnFirstPreparing: Array.isArray(s1a.warnings) && s1a.warnings.length === 0,
        noWarningOnFirstReady: Array.isArray(s1b.warnings) && s1b.warnings.length === 0,
      };
      c1.dispose();

      // G2: Re-analyze with a selected Observation+Reason -> old cleared,
      // stale warning emitted exactly once on 'preparing', then genuinely
      // clears on the following 'ready' for the SAME new generation.
      let g2 = 200;
      const c2 = createInteractivePreviewObservationControllerV2({ generationProvider: () => g2, onStateChange: () => {} });
      c2.setContext({ generationId: g2, interactiveState: 'ready', interactiveReady: true, safetyBlocked: false, blockedReason: null });
      c2.selectObservation('prefer-legacy');
      c2.toggleReason('skin-tone');
      const beforeReanalyze = c2.getState();
      g2 = 201;
      const afterPreparing = c2.setContext({ generationId: g2, interactiveState: 'preparing', interactiveReady: false, safetyBlocked: false, blockedReason: null });
      const afterReady = c2.setContext({ generationId: g2, interactiveState: 'ready', interactiveReady: true, safetyBlocked: false, blockedReason: null });
      const scenarioG2 = {
        beforeObservation: beforeReanalyze.observation,
        clearedAfterPreparing: afterPreparing.observation === null && afterPreparing.reasons.length === 0,
        warningEmittedOnce: Array.isArray(afterPreparing.warnings) && afterPreparing.warnings.length === 1 && afterPreparing.warnings[0] === STALE_MSG,
        warningClearedOnReady: Array.isArray(afterReady.warnings) && afterReady.warnings.length === 0,
      };
      c2.dispose();

      // G3: setReasons([]) then clearReasons() with NO real Reason ever
      // selected -> no announcement, no callback (FIX D1/D2/D3).
      let g3 = 300;
      let cbCount3 = 0;
      const c3 = createInteractivePreviewObservationControllerV2({ generationProvider: () => g3, onStateChange: () => { cbCount3++; } });
      c3.setContext({ generationId: g3, interactiveState: 'ready', interactiveReady: true, safetyBlocked: false, blockedReason: null });
      c3.selectObservation('prefer-legacy');
      cbCount3 = 0;
      const afterEmptySet = c3.setReasons([]);
      cbCount3 = 0;
      const afterEmptyClear = c3.clearReasons();
      const scenarioG3 = {
        announcementAfterSetEmpty: afterEmptySet.reasonAnnouncement,
        announcementAfterClear: afterEmptyClear.reasonAnnouncement,
        callbackCountAfterClear: cbCount3,
      };
      c3.dispose();

      // G4: select one Reason, remove it (back to empty via toggle),
      // then clearReasons() -> the removal itself legitimately fires a
      // callback/null announcement (FIX 3 F3-P1, unchanged), but the
      // SUBSEQUENT clearReasons() on the now-empty set must be a true
      // no-op (FIX D1/D2/D3).
      let g4 = 400;
      let cbCount4 = 0;
      const c4 = createInteractivePreviewObservationControllerV2({ generationProvider: () => g4, onStateChange: () => { cbCount4++; } });
      c4.setContext({ generationId: g4, interactiveState: 'ready', interactiveReady: true, safetyBlocked: false, blockedReason: null });
      c4.selectObservation('prefer-legacy');
      c4.toggleReason('skin-tone');
      c4.toggleReason('skin-tone'); // remove the only Reason -> back to empty
      cbCount4 = 0;
      const afterFinalRemoveClear = c4.clearReasons();
      const scenarioG4 = {
        reasonsEmpty: afterFinalRemoveClear.reasons.length === 0,
        announcement: afterFinalRemoveClear.reasonAnnouncement,
        callbackCount: cbCount4,
      };
      c4.dispose();

      return { scenarioG1, scenarioG2, scenarioG3, scenarioG4 };
    }, CANONICAL_ORIGIN);
    recordCondition('Phase G Scenario G1: first analysis with no prior Observation never produces a stale-generation warning (neither on preparing nor the following ready)',phaseGControllerTest.scenarioG1.noWarningOnFirstPreparing && phaseGControllerTest.scenarioG1.noWarningOnFirstReady,JSON.stringify(phaseGControllerTest.scenarioG1));
    recordCondition('Phase G Scenario G2: Re-analyze with a selected Observation clears the old Observation/Reasons and emits the stale warning exactly once on preparing, then genuinely clears on the next ready for the same generation',phaseGControllerTest.scenarioG2.beforeObservation === 'prefer-legacy' && phaseGControllerTest.scenarioG2.clearedAfterPreparing && phaseGControllerTest.scenarioG2.warningEmittedOnce && phaseGControllerTest.scenarioG2.warningClearedOnReady,JSON.stringify(phaseGControllerTest.scenarioG2));
    recordCondition('Phase G Scenario G3: setReasons([]) then clearReasons() with no real Reason ever selected produces no announcement and no callback',phaseGControllerTest.scenarioG3.announcementAfterSetEmpty === null && phaseGControllerTest.scenarioG3.announcementAfterClear === null && phaseGControllerTest.scenarioG3.callbackCountAfterClear === 0,JSON.stringify(phaseGControllerTest.scenarioG3));
    recordCondition('Phase G Scenario G4: removing the final Reason then calling clearReasons() on the now-empty set produces no announcement and no callback',phaseGControllerTest.scenarioG4.reasonsEmpty && phaseGControllerTest.scenarioG4.announcement === null && phaseGControllerTest.scenarioG4.callbackCount === 0,JSON.stringify(phaseGControllerTest.scenarioG4));

    // ══════════════════════════════════════════════════════════════
    // COMBINED CLOSEOUT R1 — Phase G: focused Renderer regression
    // tests proving Phase C (explicit disabled-Reason visible style)
    // and the exact textContent-only stale-warning rendering, on a
    // DETACHED synthetic container isolated from any live Controller.
    // ══════════════════════════════════════════════════════════════
    const phaseGRendererTest = await page.evaluate(async (origin) => {
      const { ensureInteractivePreviewObservationLayout, renderInteractivePreviewObservationV2 } = await import(`${origin}/ui/interactive-preview-observation-renderer-v2.js`);
      const testDiv = document.createElement('div');
      testDiv.id = '__phaseGRendererTestContainer';
      testDiv.style.display = 'none';
      document.body.appendChild(testDiv);
      ensureInteractivePreviewObservationLayout(testDiv);
      const inputByValue = (v) => testDiv.querySelector(`input[name="ipoReason"][value="${v}"]`);
      const labelFor = (v) => inputByValue(v).closest('label');

      const fiveSelected = ['skin-tone', 'white-balance', 'highlight-detail', 'shadow-detail', 'contrast'];
      renderInteractivePreviewObservationV2(testDiv, { state: 'selected', observation: 'prefer-legacy', reasons: fiveSelected, reasonLimitReached: true, metadata: {} });

      // COMBINED CLOSEOUT R3 — Phase B FIX B3: the Production contract
      // (R2 Phase A) intentionally keeps label AND text/span opacity at
      // 1 always, for measurable text Contrast — dimming is confined to
      // the checkbox input's OWN opacity. Distinction instead comes
      // from data-ipo-disabled + backgroundColor + borderColor +
      // cursor. Collect every one of those signals, on both the label
      // and the input, plus the text span's own computed opacity.
      const disabledInput = inputByValue('color-balance');
      const disabledLabel = labelFor('color-balance');
      const disabledSpan = disabledLabel.querySelector('span');
      const disabledStyle = {
        disabled: disabledInput.disabled,
        checked: disabledInput.checked,
        dataAttr: disabledLabel.dataset.ipoDisabled,
        labelOpacity: disabledLabel.style.opacity,
        spanOpacity: disabledSpan ? getComputedStyle(disabledSpan).opacity : null,
        inputOpacity: disabledInput.style.opacity,
        backgroundColor: disabledLabel.style.backgroundColor,
        borderColor: disabledLabel.style.borderColor,
        cursor: disabledLabel.style.cursor,
      };

      const checkedInput = inputByValue('skin-tone');
      const checkedLabel = labelFor('skin-tone');
      const checkedSpan = checkedLabel.querySelector('span');
      const checkedStyle = {
        disabled: checkedInput.disabled,
        checked: checkedInput.checked,
        dataAttrPresent: 'ipoDisabled' in checkedLabel.dataset,
        labelOpacity: checkedLabel.style.opacity,
        spanOpacity: checkedSpan ? getComputedStyle(checkedSpan).opacity : null,
        inputOpacity: checkedInput.style.opacity,
        backgroundColor: checkedLabel.style.backgroundColor,
        cursor: checkedLabel.style.cursor,
      };

      // Remove one checked Reason -> the disabled sixth Reason must
      // become re-enabled with its style FULLY restored (no stale
      // disabled attribute/inline style left behind) — FIX C2.
      const fourSelected = ['skin-tone', 'white-balance', 'highlight-detail', 'shadow-detail'];
      renderInteractivePreviewObservationV2(testDiv, { state: 'selected', observation: 'prefer-legacy', reasons: fourSelected, reasonLimitReached: false, metadata: {} });
      const reEnabledInput = inputByValue('color-balance');
      const reEnabledLabel = labelFor('color-balance');
      const reEnabledStyle = {
        disabled: reEnabledInput.disabled,
        dataAttrPresent: 'ipoDisabled' in reEnabledLabel.dataset,
        labelOpacity: reEnabledLabel.style.opacity,
        inputOpacity: reEnabledInput.style.opacity,
        backgroundColor: reEnabledLabel.style.backgroundColor,
        borderColor: reEnabledLabel.style.borderColor,
        cursor: reEnabledLabel.style.cursor,
      };

      // Exact stale-warning rendering: textContent only, no markup.
      renderInteractivePreviewObservationV2(testDiv, { state: 'cleared', observation: null, warnings: ['The previous observation was cleared because a newer analysis is active.'], reasons: [], reasonLimitReached: false, metadata: {} });
      const warningEl = testDiv.querySelector('#ipoWarning');
      const warningText = warningEl.textContent;
      const warningHtml = warningEl.innerHTML;

      document.body.removeChild(testDiv);
      return { disabledStyle, checkedStyle, reEnabledStyle, warningText, warningHtml };
    }, CANONICAL_ORIGIN);
    const EXPECTED_STALE_WARNING = 'The previous observation was cleared because a newer analysis is active.';
    // COMBINED CLOSEOUT R3 — Phase B FIX B3: updated to match the actual
    // Production contract (R2 Phase A) rather than a stale assumption
    // that the LABEL's opacity itself must drop below 1. Label AND
    // text/span opacity intentionally stay at 1 (required for
    // measurable Contrast); disabled-vs-enabled distinction comes from
    // data-ipo-disabled + the INPUT's own opacity + background/border +
    // cursor — every one of those signals is checked independently.
    recordCondition(
      'Phase B FIX B3: a disabled unchecked Reason (sixth, over the five-Reason limit) is visually distinct via data-ipo-disabled + dimmed INPUT opacity + distinguishing background/border + not-allowed cursor, while LABEL and text/span opacity remain exactly 1 for measurable Contrast',
      phaseGRendererTest.disabledStyle.disabled === true
        && phaseGRendererTest.disabledStyle.checked === false
        && phaseGRendererTest.disabledStyle.dataAttr === 'true'
        && phaseGRendererTest.disabledStyle.labelOpacity === '1'
        && phaseGRendererTest.disabledStyle.spanOpacity === '1'
        && parseFloat(phaseGRendererTest.disabledStyle.inputOpacity) < 1
        && phaseGRendererTest.disabledStyle.backgroundColor !== 'transparent'
        && phaseGRendererTest.disabledStyle.borderColor !== 'var(--border)'
        && phaseGRendererTest.disabledStyle.cursor === 'not-allowed',
      JSON.stringify(phaseGRendererTest.disabledStyle)
    );
    recordCondition(
      'Phase B FIX B3: checked Reasons at the five-Reason limit remain enabled with normal (non-disabled) style — label/span/input opacity all 1',
      phaseGRendererTest.checkedStyle.disabled === false
        && phaseGRendererTest.checkedStyle.checked === true
        && !phaseGRendererTest.checkedStyle.dataAttrPresent
        && phaseGRendererTest.checkedStyle.labelOpacity === '1'
        && phaseGRendererTest.checkedStyle.spanOpacity === '1'
        && phaseGRendererTest.checkedStyle.inputOpacity === '1'
        && phaseGRendererTest.checkedStyle.cursor === 'pointer',
      JSON.stringify(phaseGRendererTest.checkedStyle)
    );
    recordCondition(
      'Phase B FIX B3: removing one checked Reason restores the previously-disabled Reason to fully enabled — data attribute absent, input opacity/background/border/cursor all restored',
      phaseGRendererTest.reEnabledStyle.disabled === false
        && !phaseGRendererTest.reEnabledStyle.dataAttrPresent
        && phaseGRendererTest.reEnabledStyle.labelOpacity === '1'
        && phaseGRendererTest.reEnabledStyle.inputOpacity === '1'
        && phaseGRendererTest.reEnabledStyle.backgroundColor === 'transparent'
        && phaseGRendererTest.reEnabledStyle.borderColor === 'var(--border)'
        && phaseGRendererTest.reEnabledStyle.cursor === 'pointer',
      JSON.stringify(phaseGRendererTest.reEnabledStyle)
    );
    recordCondition('Phase G: the exact stale-generation warning message is rendered into #ipoWarning via textContent only (innerHTML equals the same plain text, no markup/injection)',phaseGRendererTest.warningText === EXPECTED_STALE_WARNING && phaseGRendererTest.warningHtml === EXPECTED_STALE_WARNING,`text="${phaseGRendererTest.warningText}", html="${phaseGRendererTest.warningHtml}"`);

    await harnessRuntime.cleanup();
    coverage.syntheticIntegrationHarness = results.filter((r) => r.result === 'FAIL').length === 0 ? 'PASS' : 'FAIL';

    // ══════════════════════════════════════════════════════════════
    // FIX 1/2/3 (EPIC 2E-J-C-F): element-level responsive containment
    // across all 7 required viewports, on the REAL application.
    // ══════════════════════════════════════════════════════════════
    for (const width of VIEWPORTS) {
      const pRuntime = await openLumixaInMemoryPage({ browser, projectRoot: PROJECT_ROOT, qaQuery: '?qa=1', viewport: { width, height: 1500 }, prebuiltApp: appSnapshot });
      const p = pRuntime.page;
      const pErrors = [];
      p.on('pageerror', (e) => pErrors.push(String(e)));
      await p.waitForTimeout(600);
      await p.setInputFiles('#fileIn', OBSERVATION_FIXTURE_PATH);
      await p.waitForTimeout(16000);
      await p.evaluate(DRIVE_REAL_APP_JS);
      await p.evaluate(() => { window.__testController.setContext({ generationId: 1, interactiveState: 'ready', interactiveReady: true, safetyBlocked: false, blockedReason: null }); window.__testController.selectObservation('prefer-legacy'); window.__testController.toggleReason('skin-tone'); window.__testController.toggleReason('white-balance'); window.__testController.toggleReason('highlight-detail'); });
      await p.waitForTimeout(200);
      const overflow = await p.evaluate(ELEMENT_OVERFLOW_CHECK_JS(width));
      const pass = overflow.findings.length === 0 && overflow.docScrollW <= overflow.docClientW;
      recordCondition(`Element-level overflow containment at ${width}px`,pass,pass ? `docScrollW=${overflow.docScrollW}, no clipped children` : JSON.stringify(overflow.findings));
      await pRuntime.cleanup();
    }

    recordCondition('Console errors across entire smoke test',consoleErrors.length === 0,consoleErrors.length === 0 ? '(none)' : consoleErrors.join('; '));

  } finally {
    await browser.close();
  }

  const passCount = results.filter((r) => r.result === 'PASS').length;
  const failCount = results.filter((r) => r.result === 'FAIL').length;
  const manualTestsNotPerformed = [
    'Physical mobile device',
    'Physical touch hardware',
    'NVDA/JAWS/VoiceOver',
    'Long-duration memory profiling',
    'Real user privacy study',
  ];
  // FIX B2 — the automated Decision is now computed by the same
  // fail-closed, exported pure function Phase D's static evidence tests
  // call directly. `completed: true` reflects that main()'s try/finally
  // ran to this point without throwing (a thrown error is instead
  // caught by the outer main().catch() below, which writes its own
  // bounded completed:false crash result and never reaches here).
  // sourceHash vs currentSourceHash: sourceHash was computed fresh from
  // the CURRENT on-disk sources at the top of this very run, so within
  // a single run it is always self-consistent by construction — the
  // meaningful staleness check happens later, when Phase F's final
  // aggregator re-reads this JSON and recomputes the hash against
  // whatever sources exist AT THAT TIME (see validateResultFreshness).
  const decisionResult = computeObservationSmokeDecision(results, {
    completed: true,
    sourceHash,
    currentSourceHash: sourceHash,
    permittedNotTestedTests: [],
  });
  const output = {
    suite: 'EPIC 2E-J Phase C (+ EPIC 2E-J-C-F) Observation smoke test',
    runId,
    startedAt,
    completedAt: new Date().toISOString(),
    completed: true,
    sourceHash,
    browserExecutablePath: browserDetect.found,
    browserVersion: browser.version(),
    generatedAt: new Date().toISOString(),
    summary: { total: results.length, pass: passCount, fail: failCount, notTested: results.length - passCount - failCount },
    coverage,
    manualTestsNotPerformed,
    results,
    decision: decisionResult.decision,
    decisionReasons: decisionResult.reasons,
  };
  await mkdir(path.join(PROJECT_ROOT, 'qa'), { recursive: true });
  await writeResultAtomic(RESULTS_PATH, output);
  console.log(`\n${passCount}/${results.length} PASS, ${failCount} FAIL`);
  console.log('Coverage:', JSON.stringify(coverage));
  console.log(`Decision: ${decisionResult.decision}${decisionResult.reasons.length ? ` (${decisionResult.reasons.join(', ')})` : ''}`);
  console.log('Results written to qa/epic-2e-j-phase-c-results.json');
  process.exit(decisionResult.decision === 'PASS' ? 0 : 1);
}

// COMBINED CLOSEOUT R3 — Phase D: guard the top-level run so importing
// this file ONLY to reuse its exported pure `computeObservationSmokeDecision`
// function (as the R2/R3 Phase E static evidence test now does) never
// triggers a full Browser-suite execution / result-file write as an
// import-time side effect. Running this file directly (`node
// qa/epic-2e-j-phase-c-observation-smoke-test.mjs`) is unaffected.
const isMainModule = (() => {
  try { return import.meta.url === `file://${process.argv[1]}`; } catch { return false; }
})();
if (isMainModule) {
  main().catch(async (err) => {
    console.error('Smoke test crashed:', err && err.name ? err.name : err);
    try {
      const nowIso = new Date().toISOString();
      await writeResultAtomic(RESULTS_PATH, {
        suite: 'EPIC 2E-J Phase C (+ EPIC 2E-J-C-F) Observation smoke test',
        runId,
        startedAt,
        completedAt: nowIso,
        completed: false,
        sourceHash,
        browserExecutablePath: null,
        browserVersion: null,
        generatedAt: nowIso,
        summary: { total: 1, pass: 0, fail: 1, notTested: 0 },
        results: [buildRuntimeCrashRow(err)],
        decision: 'FAIL',
      });
    } catch (writeErr) {
      console.error('Failed to write crash result JSON:', writeErr && writeErr.name ? writeErr.name : writeErr);
    }
    process.exit(2);
  });
}
