/**
 * qa/helpers/playwright-opaque-origin-cookie.mjs
 *
 * COMBINED CLOSEOUT R2 — Phase D: Opaque-Origin Cookie Compatibility.
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
