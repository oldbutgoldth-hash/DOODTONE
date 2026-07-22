import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * qa/helpers/playwright-opaque-origin-cookie.mjs
 *
 * COMBINED CLOSEOUT R2 — Phase D: Opaque-Origin Cookie Compatibility.
 * COMBINED CLOSEOUT R3 — Phase A: exact descriptor lifecycle (FIX
 * A1-A3) plus a real-Browser runtime self-test (FIX A4), runnable
 * directly via `node qa/helpers/playwright-opaque-origin-cookie.mjs`.
 *
 * `about:blank` (the only navigation target the In-Memory App Harness
 * ever uses) has an OPAQUE origin. Real Chromium throws a SecurityError
 * the instant `document.cookie` is even READ on an opaque origin. The
 * Step 7B-A suite reads `document.cookie` during its instrumentation
 * setup (to record a before/after comparison and to wrap the native
 * cookie setter) and previously crashed as a result.
 *
 * This module is a TEST-ONLY compatibility layer, following the exact
 * same pattern as qa/helpers/playwright-opaque-origin-storage.mjs: pure,
 * self-contained functions (no captured outer-scope references) so each
 * can be unit-tested directly in Node with a fake `document`-like object
 * AND stringified via Function.prototype.toString() for real execution
 * inside a Playwright Page bound to the real browser `document`. Same
 * source, both places — never a separate "test version"/"real version".
 *
 * Installs NOTHING when native `document.cookie` access already works
 * (status NATIVE_COOKIE_AVAILABLE) — the compatibility layer is a
 * fallback, never a replacement for genuine native behavior. Never
 * touches disk or the Network, never persists across Contexts, and
 * never modifies any Production file.
 */

// ══════════════════════════════════════════════════════════════════
// PART 1 — cookie access probe. Only `.name` is ever read off a caught
// error (never the full message/stack), matching the required bounded
// evidence schema.
// ══════════════════════════════════════════════════════════════════
export function probeCookieAccess(documentLike) {
  try {
    void documentLike.cookie;
    return { cookieAccessible: true, errorName: null };
  } catch (e) {
    return { cookieAccessible: false, errorName: (e && e.name) || 'UnknownError' };
  }
}

// ══════════════════════════════════════════════════════════════════
// PART 2 — probe, then install a Test-only in-memory cookie ONLY when
// native access genuinely throws. Idempotent (safe to invoke more than
// once against the same document). The installed getter/setter never
// touches disk or the Network, never persists beyond this single
// in-memory Document (no cross-Context persistence), and is
// `configurable: true` so it can be removed for exact cleanup later.
// ══════════════════════════════════════════════════════════════════
export function ensureCookieCompatibility(documentLike) {
  let cookieAccessible = false;
  let errorName = null;
  try {
    void documentLike.cookie;
    cookieAccessible = true;
  } catch (e) {
    errorName = (e && e.name) || 'UnknownError';
  }

  if (cookieAccessible) {
    return { status: 'NATIVE_COOKIE_AVAILABLE', cookieAccessibleBefore: true, cookieErrorNameBefore: null, alreadyInstalled: false };
  }

  if (documentLike.__opaqueOriginCookieInstalled === true) {
    return { status: 'OPAQUE_ORIGIN_MEMORY_COOKIE_INSTALLED', cookieAccessibleBefore: false, cookieErrorNameBefore: errorName, alreadyInstalled: true };
  }

  let memoryCookie = '';
  Object.defineProperty(documentLike, 'cookie', {
    get() { return memoryCookie; },
    set(v) { memoryCookie = String(v); },
    configurable: true,
    enumerable: true,
  });
  documentLike.__opaqueOriginCookieInstalled = true;
  return { status: 'OPAQUE_ORIGIN_MEMORY_COOKIE_INSTALLED', cookieAccessibleBefore: false, cookieErrorNameBefore: errorName, alreadyInstalled: false };
}

// ══════════════════════════════════════════════════════════════════
// PART 3 — exact cleanup: removes the own-property compatibility
// descriptor ONLY when this module installed one, restoring the
// original "no own property on document" shape. Never touches a
// genuinely pre-existing own property this module did not create, and
// is a safe no-op when the native cookie was accessible all along.
// ══════════════════════════════════════════════════════════════════
export function removeOpaqueOriginMemoryCookie(documentLike) {
  if (documentLike.__opaqueOriginCookieInstalled !== true) {
    return { removed: false, reason: 'not installed by this module (native cookie was accessible, or already removed)' };
  }
  delete documentLike.cookie;
  delete documentLike.__opaqueOriginCookieInstalled;
  const hasOwnAfter = Object.prototype.hasOwnProperty.call(documentLike, 'cookie');
  return { removed: true, reason: null, hasOwnPropertyAfterRemoval: hasOwnAfter };
}

// ══════════════════════════════════════════════════════════════════
// Invocation-source builders — each returns a self-contained expression
// string that stringifies the target function and immediately invokes
// it bound to the real browser `document` global, for use with
// page.evaluate(). Never captures any outer-scope reference.
// ══════════════════════════════════════════════════════════════════
export function buildProbeInvocationSource() {
  return `(${probeCookieAccess.toString()})(document)`;
}
export function buildEnsureCompatibilityInvocationSource() {
  return `(${ensureCookieCompatibility.toString()})(document)`;
}
export function buildRemoveCompatibilityInvocationSource() {
  return `(${removeOpaqueOriginMemoryCookie.toString()})(document)`;
}

// ══════════════════════════════════════════════════════════════════
// Full runtime verification (mirrors playwright-opaque-origin-storage's
// runFullStorageVerification pattern): proves the compatibility getter/
// setter round-trips a value, is instrumentable and exactly restorable,
// and that cleanup genuinely restores the no-own-property shape.
// ══════════════════════════════════════════════════════════════════
export function runFullCookieVerification(documentLike) {
  const checks = [];
  function check(test, pass, evidence) {
    checks.push({ test, result: pass ? 'PASS' : 'FAIL', evidence });
  }

  const hadOwnBefore = Object.prototype.hasOwnProperty.call(documentLike, 'cookie');
  const compat = ensureCookieCompatibility(documentLike);
  check('Compatibility install status is a recognized value', compat.status === 'NATIVE_COOKIE_AVAILABLE' || compat.status === 'OPAQUE_ORIGIN_MEMORY_COOKIE_INSTALLED', `status=${compat.status}`);

  if (compat.status === 'OPAQUE_ORIGIN_MEMORY_COOKIE_INSTALLED') {
    check('Installed memory cookie starts empty', documentLike.cookie === '', `got=${JSON.stringify(documentLike.cookie)}`);
    documentLike.cookie = 'a=1';
    check('Memory cookie setter/getter round-trips a String-coerced value', documentLike.cookie === 'a=1', `got=${JSON.stringify(documentLike.cookie)}`);
    documentLike.cookie = 42;
    check('Memory cookie setter String-coerces a non-string value', documentLike.cookie === '42', `got=${JSON.stringify(documentLike.cookie)}`);

    // Instrumentation compatibility: the effective (own) descriptor can
    // be wrapped for call counting and exactly restored afterward.
    const effectiveDescBefore = Object.getOwnPropertyDescriptor(documentLike, 'cookie');
    let setterCalls = 0;
    Object.defineProperty(documentLike, 'cookie', {
      configurable: true,
      enumerable: true,
      get: effectiveDescBefore.get,
      set(v) { setterCalls++; return effectiveDescBefore.set.call(documentLike, v); },
    });
    documentLike.cookie = 'b=2';
    check('Wrapped setter is invoked exactly once per assignment', setterCalls === 1, `setterCalls=${setterCalls}`);
    Object.defineProperty(documentLike, 'cookie', { configurable: true, enumerable: true, get: effectiveDescBefore.get, set: effectiveDescBefore.set });
    const effectiveDescAfter = Object.getOwnPropertyDescriptor(documentLike, 'cookie');
    check('Exact effective descriptor getter/setter restored by reference', effectiveDescAfter.get === effectiveDescBefore.get && effectiveDescAfter.set === effectiveDescBefore.set, 'checked');

    const removal = removeOpaqueOriginMemoryCookie(documentLike);
    check('removeOpaqueOriginMemoryCookie() reports removed=true', removal.removed === true, JSON.stringify(removal));
    check('No own "cookie" property remains after removal (original shape restored)', Object.prototype.hasOwnProperty.call(documentLike, 'cookie') === hadOwnBefore, `hadOwnBefore=${hadOwnBefore}, hasOwnAfter=${Object.prototype.hasOwnProperty.call(documentLike, 'cookie')}`);
  } else {
    check('Native cookie available — compatibility layer correctly installs nothing', documentLike.__opaqueOriginCookieInstalled !== true, 'checked');
  }

  const allPassed = checks.every((c) => c.result === 'PASS');
  return { checks, allPassed };
}

export function buildFullVerificationInvocationSource() {
  return `(${runFullCookieVerification.toString()})(document)`;
}

// ══════════════════════════════════════════════════════════════════
// COMBINED CLOSEOUT R3 — Phase A: exact Cookie descriptor lifecycle.
//
// These four functions are the SINGLE shared source of truth for how a
// Cookie setter is patched, evaluated, and restored — used identically
// by qa/epic-2e-j-phase-c-step7b-a-test.mjs (via toString() inlining
// into its page.evaluate() strings) and by the real-Browser self-test
// below (FIX A4), so the exact same logic is proven twice: once against
// a fake Document in plain Node, once against the real browser
// `document` on the real opaque `about:blank` origin.
// ══════════════════════════════════════════════════════════════════

/**
 * FIX A1 — Cookie setter instrumentation is successfully "patched" only
 * when ALL of the following hold:
 *   - the GETTER is PRESERVED (the exact same function reference as the
 *     effective descriptor being wrapped — never replaced)
 *   - the SETTER is CHANGED (a new wrapper function — never the same
 *     reference as the original setter)
 *   - both get and set are actually Functions
 *   - configurable/enumerable are unchanged from the effective
 *     descriptor being wrapped
 * Each condition is recorded independently so a caller can see exactly
 * which one failed, rather than a single opaque boolean.
 */
export function evaluateCookiePatchSuccess(patchedDescriptor, effectiveDescriptor) {
  const getterPreserved = !!patchedDescriptor && !!effectiveDescriptor && patchedDescriptor.get === effectiveDescriptor.get;
  const setterChanged = !!patchedDescriptor && !!effectiveDescriptor && patchedDescriptor.set !== effectiveDescriptor.set;
  const bothFunctions = !!patchedDescriptor && typeof patchedDescriptor.get === 'function' && typeof patchedDescriptor.set === 'function';
  const descriptorFlagsPreserved = !!patchedDescriptor && !!effectiveDescriptor
    && patchedDescriptor.configurable === effectiveDescriptor.configurable
    && patchedDescriptor.enumerable === effectiveDescriptor.enumerable;
  return {
    getterPreserved,
    setterChanged,
    bothFunctions,
    descriptorFlagsPreserved,
    setterPatched: getterPreserved && setterChanged && bothFunctions && descriptorFlagsPreserved,
  };
}

/**
 * Installs the counting wrapper around `documentLike`'s "cookie"
 * property, preserving `effectiveDescriptor.get` EXACTLY (same
 * reference) and replacing only the setter with a counting wrapper that
 * still forwards to the original setter via `.call(documentLike, v)`.
 * `counterObj` is mutated in place (never reassigned) so a caller who
 * already exposed `counterObj` elsewhere (e.g. `window.__x.cookie`)
 * keeps observing live updates through that same reference.
 */
export function installCookieSetterCountingWrapper(documentLike, effectiveDescriptor, counterObj) {
  Object.defineProperty(documentLike, 'cookie', {
    configurable: true,
    enumerable: true,
    get: effectiveDescriptor.get,
    set(v) { counterObj.setterCalls++; return effectiveDescriptor.set.call(documentLike, v); },
  });
  const patchedDescriptor = Object.getOwnPropertyDescriptor(documentLike, 'cookie');
  const evidence = evaluateCookiePatchSuccess(patchedDescriptor, effectiveDescriptor);
  return { patchedDescriptor, evidence };
}

/**
 * FIX A2/A3 STAGE 1 — instrumentation restoration ONLY: undoes the
 * counting wrapper, restoring EXACTLY the descriptor that existed right
 * before the counting wrapper was installed (`originalOwnDescriptor`
 * when one existed, i.e. the compatibility-installed own property in
 * the opaque-origin case) — or, when no own property existed before
 * instrumentation (the genuinely-native case, where the counting
 * wrapper was a NEW own property shadowing the prototype), deletes the
 * shadow entirely so lookup falls back to the prototype again.
 *
 * Always builds the descriptor passed to Object.defineProperty() using
 * the valid `{ get, set, configurable, enumerable }` keys — NEVER a
 * `{ getter, setter }` shaped object, which Object.defineProperty()
 * silently ignores (producing a corrupt `value: undefined` data
 * property instead of restoring the accessor).
 *
 * This stage says nothing about whether Test-only compatibility itself
 * is removed — that is STAGE 2, `verifyCompatibilityCleanup()` below.
 */
export function restoreCookieInstrumentation(documentLike, { hadOwnBefore, originalOwnDescriptor }) {
  if (hadOwnBefore) {
    Object.defineProperty(documentLike, 'cookie', {
      get: originalOwnDescriptor.get,
      set: originalOwnDescriptor.set,
      configurable: originalOwnDescriptor.configurable,
      enumerable: originalOwnDescriptor.enumerable,
    });
    const restored = Object.getOwnPropertyDescriptor(documentLike, 'cookie');
    const instrumentationRestoredExactly = !!restored
      && restored.get === originalOwnDescriptor.get
      && restored.set === originalOwnDescriptor.set
      && restored.configurable === originalOwnDescriptor.configurable
      && restored.enumerable === originalOwnDescriptor.enumerable;
    return { instrumentationRestoredExactly, hasOwnAfter: true };
  }
  delete documentLike.cookie;
  const hasOwnAfter = Object.prototype.hasOwnProperty.call(documentLike, 'cookie');
  return { instrumentationRestoredExactly: hasOwnAfter === false, hasOwnAfter };
}

/**
 * FIX A3 STAGE 2 — compatibility cleanup ONLY: call this AFTER Stage 1
 * instrumentation restoration has already run. Verifies the Test-only
 * compatibility own property and its `__opaqueOriginCookieInstalled`
 * marker are both gone, and that the shape now matches the ORIGINAL
 * pristine shape captured BEFORE `ensureCookieCompatibility()` ever
 * touched `documentLike` (`hadOwnPropertyBeforeAnyInstallation`) — never
 * compared against the temporary compatibility descriptor itself, which
 * is by definition gone by this point.
 */
export function verifyCompatibilityCleanup(documentLike, removalResult, { hadOwnPropertyBeforeAnyInstallation }) {
  const markerRemoved = documentLike.__opaqueOriginCookieInstalled !== true
    && !Object.prototype.hasOwnProperty.call(documentLike, '__opaqueOriginCookieInstalled');
  const hasOwnCookieAfter = Object.prototype.hasOwnProperty.call(documentLike, 'cookie');
  const compatibilityDescriptorRemoved = !!removalResult && removalResult.removed === true && hasOwnCookieAfter === false;
  const originalShapeRestored = hasOwnCookieAfter === hadOwnPropertyBeforeAnyInstallation;
  return { markerRemoved, compatibilityDescriptorRemoved, originalShapeRestored };
}

export function buildInstallCookieSetterCountingWrapperInvocationSource() {
  return installCookieSetterCountingWrapper.toString();
}
export function buildRestoreCookieInstrumentationInvocationSource() {
  return restoreCookieInstrumentation.toString();
}
export function buildVerifyCompatibilityCleanupInvocationSource() {
  return verifyCompatibilityCleanup.toString();
}
export function buildEvaluateCookiePatchSuccessInvocationSource() {
  return evaluateCookiePatchSuccess.toString();
}

// ══════════════════════════════════════════════════════════════════
// FIX A4 — real Chromium/about:blank runtime self-test. Proves, against
// a REAL browser (never only a fake Document object in Node), all ten
// required facts:
//   1. native Cookie access throws SecurityError on the opaque origin
//   2. compatibility installs
//   3. getter/setter round-trip works
//   4. setter wrapper counts exactly once
//   5. compatibility descriptor restores by exact Function reference
//   6. helper removes the compatibility descriptor
//   7. no own cookie property remains
//   8. the marker is removed
//   9. a second Page begins clean (no leakage across Pages/Contexts)
//   10. no Cookie value is ever written into the Result JSON
//
// Runnable directly: `node qa/helpers/playwright-opaque-origin-cookie.mjs`
// — this keeps the real-Browser self-test inside this ALLOWED helper
// file rather than requiring a new standalone QA script.
// ══════════════════════════════════════════════════════════════════
export async function runRealBrowserCookieSelfTest({ detectPlaywrightPackage, detectBrowserExecutable, REQUIRED_LAUNCH_ARGS }) {
  const results = [];
  function record(test, pass, evidence) {
    const result = pass === 'NOT_TESTED' ? 'NOT_TESTED' : pass ? 'PASS' : 'FAIL';
    results.push({ test, result, evidence });
  }

  const pkg = await detectPlaywrightPackage();
  if (pkg.status !== 'PLAYWRIGHT_PACKAGE_AVAILABLE') {
    return { environment: 'PLAYWRIGHT_PACKAGE_UNAVAILABLE', reason: pkg.error, results };
  }
  const { chromium } = pkg.mod;
  const browserDetect = await detectBrowserExecutable(chromium);
  if (!browserDetect.found) {
    return { environment: 'BROWSER_BINARY_UNAVAILABLE', reason: JSON.stringify(browserDetect.attempts), results };
  }

  const browser = await chromium.launch({ executablePath: browserDetect.found, args: REQUIRED_LAUNCH_ARGS });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto('about:blank');

    // 1. Native Cookie access throws SecurityError on this opaque origin.
    const probeSrc = `(${probeCookieAccess.toString()})(document)`;
    const probe = await page.evaluate(probeSrc);
    record('1. Native document.cookie access throws SecurityError on the opaque about:blank origin', probe.cookieAccessible === false && probe.errorName === 'SecurityError', JSON.stringify(probe));

    // 2. Compatibility installs.
    const ensureSrc = `(${ensureCookieCompatibility.toString()})(document)`;
    const compat = await page.evaluate(ensureSrc);
    record('2. Compatibility installs (OPAQUE_ORIGIN_MEMORY_COOKIE_INSTALLED)', compat.status === 'OPAQUE_ORIGIN_MEMORY_COOKIE_INSTALLED', JSON.stringify(compat));

    // 3. Getter/setter round-trip works (never asserting on the actual
    // string VALUE in the returned evidence — only booleans).
    const roundTripSrc = `
      (() => {
        document.cookie = 'selftest=1';
        const roundTrips = document.cookie === 'selftest=1';
        document.cookie = 'selftest=2';
        const updates = document.cookie === 'selftest=2';
        return { roundTrips, updates };
      })()
    `;
    const roundTrip = await page.evaluate(roundTripSrc);
    record('3. Getter/setter round-trip works', roundTrip.roundTrips === true && roundTrip.updates === true, JSON.stringify(roundTrip));

    // 4/5/6/7/8. Patch, count, restore, clean up — all via the SAME
    // shared functions used by the real Step 7B-A suite.
    const fullCycleSrc = `
      (() => {
        ${evaluateCookiePatchSuccess.toString()}
        ${installCookieSetterCountingWrapper.toString()}
        ${restoreCookieInstrumentation.toString()}
        ${removeOpaqueOriginMemoryCookie.toString()}
        ${verifyCompatibilityCleanup.toString()}

        const hadOwnPropertyBeforeAnyInstallation = false; // compatibility was already installed by this point in the real sequence; captured separately in the real suite. Here we reconstruct the pre-instrumentation-only shape.
        const hadOwnBeforeInstrumentation = Object.prototype.hasOwnProperty.call(document, 'cookie');
        const originalOwnDescriptor = hadOwnBeforeInstrumentation ? Object.getOwnPropertyDescriptor(document, 'cookie') : null;
        const effectiveDescriptor = originalOwnDescriptor;

        const counterObj = { setterCalls: 0 };
        const wrap = installCookieSetterCountingWrapper(document, effectiveDescriptor, counterObj);
        document.cookie = 'countme=1';
        const setterCallsAfterOneWrite = counterObj.setterCalls;

        const stage1 = restoreCookieInstrumentation(document, { hadOwnBefore: hadOwnBeforeInstrumentation, originalOwnDescriptor });

        const removal = removeOpaqueOriginMemoryCookie(document);
        const stage2 = verifyCompatibilityCleanup(document, removal, { hadOwnPropertyBeforeAnyInstallation: false });

        return {
          patchEvidence: wrap.evidence,
          setterCallsAfterOneWrite,
          stage1,
          stage2,
        };
      })()
    `;
    const fullCycle = await page.evaluate(fullCycleSrc);
    record('4. Setter wrapper counts exactly once per assignment', fullCycle.setterCallsAfterOneWrite === 1, `setterCallsAfterOneWrite=${fullCycle.setterCallsAfterOneWrite}`);
    record('4b. Patch detection: getter preserved, setter changed, both Functions, flags preserved', fullCycle.patchEvidence.setterPatched === true, JSON.stringify(fullCycle.patchEvidence));
    record('5. Compatibility descriptor restores by exact Function reference (Stage 1)', fullCycle.stage1.instrumentationRestoredExactly === true, JSON.stringify(fullCycle.stage1));
    record('6. Helper removes the compatibility descriptor (Stage 2)', fullCycle.stage2.compatibilityDescriptorRemoved === true, JSON.stringify(fullCycle.stage2));
    record('7. No own cookie property remains after cleanup', fullCycle.stage2.originalShapeRestored === true, JSON.stringify(fullCycle.stage2));
    record('8. The __opaqueOriginCookieInstalled marker is removed', fullCycle.stage2.markerRemoved === true, JSON.stringify(fullCycle.stage2));

    // 9. A second Page begins clean — no compatibility leakage across
    // Pages/Contexts (a fresh Page must independently throw natively).
    const page2 = await context.newPage();
    await page2.goto('about:blank');
    const probe2 = await page2.evaluate(probeSrc);
    record('9. A second, independent Page begins clean (native SecurityError again, no cross-Page leakage)', probe2.cookieAccessible === false && probe2.errorName === 'SecurityError', JSON.stringify(probe2));
    await page2.close();
    await context.close();

    // 10. No Cookie VALUE ever appears in this function's own bounded
    // result set — every evidence string above is a JSON-stringified
    // boolean/status object, never document.cookie's actual text.
    const anyRowContainsCookieValueText = results.some((r) => /selftest=|countme=/.test(r.evidence));
    record('10. No Cookie value is written into this self-test\'s own Result rows', !anyRowContainsCookieValueText, `checked ${results.length} rows`);

    return { environment: 'BROWSER_AVAILABLE', browserExecutablePath: browserDetect.found, browserVersion: browser.version(), results };
  } finally {
    await browser.close();
  }
}

// ══════════════════════════════════════════════════════════════════
// Standalone runner: `node qa/helpers/playwright-opaque-origin-cookie.mjs`
// executes runRealBrowserCookieSelfTest() against a real Browser and
// writes an atomic, fail-closed result JSON — following the exact same
// pattern (runId/sourceHash/writeResultAtomic/writeBrowserUnavailableResult/
// crash handler) as every other real-Browser QA suite in this project.
// Only runs when this file is the Node entry point (never when merely
// imported by step7b-a-test.mjs or a static test).
// ══════════════════════════════════════════════════════════════════
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RESULTS_PATH = path.join(__dirname, '..', 'epic-2e-j-r3-cookie-compat-browser-selftest-results.json');
const SOURCE_HASH_INPUTS = [
  path.join(__dirname, 'playwright-opaque-origin-cookie.mjs'),
  path.join(__dirname, 'playwright-lumixa-test-runtime.mjs'),
];

async function runAsScript() {
  const {
    detectPlaywrightPackage,
    detectBrowserExecutable,
    REQUIRED_LAUNCH_ARGS,
    generateRunId,
    computeSourceHash,
    writeResultAtomic,
    buildRuntimeCrashRow,
    writeBrowserUnavailableResult,
  } = await import('./playwright-lumixa-test-runtime.mjs');

  const runId = generateRunId();
  const startedAt = new Date().toISOString();
  const sourceHash = await computeSourceHash(SOURCE_HASH_INPUTS);
  const suite = 'COMBINED CLOSEOUT R3 — Phase A FIX A4: Cookie compatibility real-Browser self-test';

  try {
    const outcome = await runRealBrowserCookieSelfTest({ detectPlaywrightPackage, detectBrowserExecutable, REQUIRED_LAUNCH_ARGS });
    if (outcome.environment !== 'BROWSER_AVAILABLE') {
      await writeBrowserUnavailableResult(RESULTS_PATH, { suite, status: outcome.environment, reason: outcome.reason });
      console.log(`Final decision: ${outcome.environment}`);
      console.log('qa/epic-2e-j-r3-cookie-compat-browser-selftest-results.json updated with a current environment result (never PASS, no stale prior result left behind).');
      process.exit(0);
    }
    const passCount = outcome.results.filter((r) => r.result === 'PASS').length;
    const failCount = outcome.results.filter((r) => r.result === 'FAIL').length;
    const notTestedCount = outcome.results.filter((r) => r.result === 'NOT_TESTED').length;
    const decision = failCount === 0 && notTestedCount === 0 && passCount === outcome.results.length ? 'PASS' : 'FAIL';
    const output = {
      suite,
      runId,
      startedAt,
      completedAt: new Date().toISOString(),
      completed: true,
      sourceHash,
      browserExecutablePath: outcome.browserExecutablePath,
      browserVersion: outcome.browserVersion,
      generatedAt: new Date().toISOString(),
      summary: { total: outcome.results.length, pass: passCount, fail: failCount, notTested: notTestedCount },
      results: outcome.results,
      decision,
    };
    await writeResultAtomic(RESULTS_PATH, output);
    console.log(`\n${passCount}/${outcome.results.length} PASS, ${failCount} FAIL, ${notTestedCount} NOT_TESTED`);
    console.log(`Final decision: ${decision}`);
    process.exit(decision === 'FAIL' ? 1 : 0);
  } catch (err) {
    console.error('Cookie compatibility self-test crashed:', err && err.name ? err.name : err);
    try {
      const nowIso = new Date().toISOString();
      await writeResultAtomic(RESULTS_PATH, {
        suite,
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
  }
}

const isMainModule = (() => {
  try {
    return import.meta.url === `file://${process.argv[1]}`;
  } catch {
    return false;
  }
})();
if (isMainModule) {
  await runAsScript();
}
