/**
 * qa/helpers/playwright-opaque-origin-storage.mjs
 *
 * EPIC 2E-J — ENV-B1B-F1: Opaque-Origin In-Memory Storage Compatibility
 * Lock.
 *
 * `about:blank` (the only navigation target the In-Memory App Harness
 * ever uses — see qa/helpers/playwright-in-memory-app.mjs) has an
 * OPAQUE origin. Real Chromium throws a SecurityError the instant
 * `window.localStorage` / `window.sessionStorage` are even READ on an
 * opaque origin — before ui/app.js's own module body ever gets a
 * chance to run, since app.js unconditionally touches localStorage
 * during its own startup (theme/language preference, "dm"/"lang"
 * keys). This module is a TEST-ONLY compatibility layer that installs
 * a page-memory-only Storage-prototype-compatible replacement so the
 * real App can boot inside the opaque-origin in-memory harness.
 *
 * Every function below is a plain, self-contained function with no
 * captured outer-scope references (no closures over module-level
 * state) specifically so it can be:
 *   (a) unit-tested directly in Node, by passing in a fake `window`-
 *       like object and a fake `Storage`-like constructor, and
 *   (b) stringified via Function.prototype.toString() and evaluated
 *       for real inside a Playwright Page bound to the REAL browser
 *       `window` / `Storage` globals (which do not exist in Node).
 * The exact same source runs in both places — there is no separate
 * "test version" and "real version" to drift apart.
 *
 * This module never imports 'playwright' and never touches the
 * filesystem or network — pure, dependency-injected logic only.
 */

// ══════════════════════════════════════════════════════════════════
// PART 1 — storage access detection. Only `.name` is ever read off a
// caught error (never the full message/stack), matching the required
// result schema.
// ══════════════════════════════════════════════════════════════════
export function probeStorageAccess(windowLike) {
  const result = {
    localStorageAccessible: false,
    sessionStorageAccessible: false,
    localStorageErrorName: null,
    sessionStorageErrorName: null,
  };
  try {
    void windowLike.localStorage.length;
    result.localStorageAccessible = true;
  } catch (e) {
    result.localStorageErrorName = (e && e.name) || 'UnknownError';
  }
  try {
    void windowLike.sessionStorage.length;
    result.sessionStorageAccessible = true;
  } catch (e) {
    result.sessionStorageErrorName = (e && e.name) || 'UnknownError';
  }
  return result;
}

// ══════════════════════════════════════════════════════════════════
// PARTS 2/3/4 — the compatibility layer itself. Installs getItem/
// setItem/removeItem/clear/key/length on StorageCtor.prototype (never
// as own properties on the instances — that would make them
// un-instrumentable by a future test that reassigns
// Storage.prototype.setItem), backed by a WeakMap<instance, Map> so
// the two instances never share values despite sharing a prototype.
// Idempotent (safe to invoke more than once against the same window).
// ══════════════════════════════════════════════════════════════════
export function installOpaqueOriginStorage(windowLike, StorageCtor) {
  if (windowLike.__opaqueOriginStorageInstalled === true) {
    return { installed: false, reason: 'already installed' };
  }
  if (typeof StorageCtor !== 'function' || !StorageCtor.prototype) {
    return { installed: false, reason: 'no usable Storage constructor available' };
  }

  const backing = new WeakMap();
  function getMap(self) {
    let m = backing.get(self);
    if (!m) {
      m = new Map();
      backing.set(self, m);
    }
    return m;
  }

  Object.defineProperty(StorageCtor.prototype, 'getItem', {
    value: function getItem(key) {
      const m = getMap(this);
      const k = String(key);
      return m.has(k) ? m.get(k) : null;
    },
    writable: true,
    configurable: true,
    enumerable: false,
  });
  Object.defineProperty(StorageCtor.prototype, 'setItem', {
    value: function setItem(key, value) {
      const m = getMap(this);
      m.set(String(key), String(value));
    },
    writable: true,
    configurable: true,
    enumerable: false,
  });
  Object.defineProperty(StorageCtor.prototype, 'removeItem', {
    value: function removeItem(key) {
      const m = getMap(this);
      m.delete(String(key));
    },
    writable: true,
    configurable: true,
    enumerable: false,
  });
  Object.defineProperty(StorageCtor.prototype, 'clear', {
    value: function clear() {
      getMap(this).clear();
    },
    writable: true,
    configurable: true,
    enumerable: false,
  });
  Object.defineProperty(StorageCtor.prototype, 'key', {
    value: function key(index) {
      const m = getMap(this);
      const keys = Array.from(m.keys());
      return Number.isInteger(index) && index >= 0 && index < keys.length ? keys[index] : null;
    },
    writable: true,
    configurable: true,
    enumerable: false,
  });
  Object.defineProperty(StorageCtor.prototype, 'length', {
    get: function length() {
      return getMap(this).size;
    },
    configurable: true,
    enumerable: false,
  });

  function makeStorageInstance() {
    const obj = Object.create(StorageCtor.prototype);
    getMap(obj); // eagerly create its own isolated Map — deterministic, never lazily shared
    return obj;
  }

  const localStorageShim = makeStorageInstance();
  const sessionStorageShim = makeStorageInstance();

  for (const entry of [
    ['localStorage', localStorageShim],
    ['sessionStorage', sessionStorageShim],
  ]) {
    const propName = entry[0];
    const value = entry[1];
    Object.defineProperty(windowLike, propName, {
      value,
      configurable: true, // required: PART 3
      enumerable: true, // matches real Browser window.localStorage/sessionStorage enumerability
      writable: false, // read-only reference: assigning a replacement silently no-ops, never replaces it
    });
  }

  windowLike.__opaqueOriginStorageInstalled = true;
  return { installed: true, reason: null };
}

/** Returns a self-contained expression-string that stringifies `installOpaqueOriginStorage` and immediately invokes it bound to the real browser `window` and `Storage` globals — for use with page.evaluate()/addInitScript(). Never captures any outer-scope reference. */
export function buildInstallerInvocationSource() {
  return `(${installOpaqueOriginStorage.toString()})(window, typeof Storage !== 'undefined' ? Storage : null)`;
}

/** Same pattern for probeStorageAccess — bound to the real browser `window` at invocation time. */
export function buildProbeInvocationSource() {
  return `(${probeStorageAccess.toString()})(window)`;
}

// ══════════════════════════════════════════════════════════════════
// PARTS 4/7 — full runtime verification: prototype identity, the A-F
// functional self-test, and the setItem/removeItem/clear
// instrumentation-compatibility proof (store original reference,
// install a counting wrapper, call through the instance, restore the
// exact original reference, assert strict reference equality).
// ══════════════════════════════════════════════════════════════════
export function runFullStorageVerification(windowLike, StorageCtor) {
  const checks = [];
  function check(test, pass, evidence) {
    checks.push({ test, result: pass ? 'PASS' : 'FAIL', evidence });
  }

  const localStorageObj = windowLike.localStorage;
  const sessionStorageObj = windowLike.sessionStorage;

  // ── prototype identity (PART 7-F) ──
  check('F. localStorage instanceof Storage', localStorageObj instanceof StorageCtor, 'checked');
  check('F. sessionStorage instanceof Storage', sessionStorageObj instanceof StorageCtor, 'checked');
  check('F. Object.getPrototypeOf(localStorage) === Storage.prototype', Object.getPrototypeOf(localStorageObj) === StorageCtor.prototype, 'checked');
  check(
    'PART 4 (no bypass): localStorage/sessionStorage define no own getItem/setItem/removeItem/clear (they resolve only through Storage.prototype)',
    !Object.prototype.hasOwnProperty.call(localStorageObj, 'getItem') &&
      !Object.prototype.hasOwnProperty.call(localStorageObj, 'setItem') &&
      !Object.prototype.hasOwnProperty.call(localStorageObj, 'removeItem') &&
      !Object.prototype.hasOwnProperty.call(localStorageObj, 'clear') &&
      !Object.prototype.hasOwnProperty.call(sessionStorageObj, 'getItem') &&
      !Object.prototype.hasOwnProperty.call(sessionStorageObj, 'setItem') &&
      !Object.prototype.hasOwnProperty.call(sessionStorageObj, 'removeItem') &&
      !Object.prototype.hasOwnProperty.call(sessionStorageObj, 'clear'),
    'checked'
  );

  // ── A. Basic localStorage ──
  localStorageObj.clear();
  sessionStorageObj.clear();
  check('A. length initially 0', localStorageObj.length === 0, `length=${localStorageObj.length}`);
  localStorageObj.setItem('a', 1);
  check('A. getItem("a") === "1" after setItem("a", 1) (String coercion)', localStorageObj.getItem('a') === '1', `got=${JSON.stringify(localStorageObj.getItem('a'))}`);
  check('A. length === 1', localStorageObj.length === 1, `length=${localStorageObj.length}`);
  check('A. key(0) === "a"', localStorageObj.key(0) === 'a', `got=${JSON.stringify(localStorageObj.key(0))}`);

  // ── B. Overwrite ──
  localStorageObj.setItem('a', 2);
  check('B. getItem("a") === "2" after overwrite', localStorageObj.getItem('a') === '2', `got=${JSON.stringify(localStorageObj.getItem('a'))}`);
  check('B. length remains 1 after overwriting an existing key', localStorageObj.length === 1, `length=${localStorageObj.length}`);

  // ── C. Isolation ──
  check('C. sessionStorage.getItem("a") === null (never shares values with localStorage)', sessionStorageObj.getItem('a') === null, `got=${JSON.stringify(sessionStorageObj.getItem('a'))}`);
  sessionStorageObj.setItem('b', 3);
  check('C. localStorage.getItem("b") === null (write to sessionStorage never leaks into localStorage)', localStorageObj.getItem('b') === null, `got=${JSON.stringify(localStorageObj.getItem('b'))}`);

  // ── D. Remove and clear ──
  localStorageObj.removeItem('a');
  check('D. getItem("a") === null after removeItem', localStorageObj.getItem('a') === null, `got=${JSON.stringify(localStorageObj.getItem('a'))}`);
  let removeMissingThrew = false;
  try { localStorageObj.removeItem('does-not-exist'); } catch { removeMissingThrew = true; }
  check('D. removeItem on a missing key does not throw', !removeMissingThrew, `threw=${removeMissingThrew}`);
  localStorageObj.setItem('x', 1);
  localStorageObj.setItem('y', 2);
  localStorageObj.clear();
  check('D. length === 0 after clear()', localStorageObj.length === 0, `length=${localStorageObj.length}`);
  check('D. getItem on any key returns null after clear()', localStorageObj.getItem('x') === null && localStorageObj.getItem('y') === null, 'checked');

  // ── E. Type behavior ──
  localStorageObj.clear();
  localStorageObj.setItem(10, false);
  check('E. setItem(10, false) → getItem("10") === "false" (numeric key + boolean value both String-coerced)', localStorageObj.getItem('10') === 'false', `got=${JSON.stringify(localStorageObj.getItem('10'))}`);
  check('E. missing getItem returns null', localStorageObj.getItem('never-set') === null, `got=${JSON.stringify(localStorageObj.getItem('never-set'))}`);
  check('E. out-of-range key(index) returns null', localStorageObj.key(999) === null && localStorageObj.key(-1) === null, 'checked');

  localStorageObj.clear();
  sessionStorageObj.clear();

  // ── PART 4 — instrumentation compatibility proof (setItem, removeItem, clear) ──
  for (const methodName of ['setItem', 'removeItem', 'clear']) {
    const original = StorageCtor.prototype[methodName];
    let wrapperCalls = 0;
    StorageCtor.prototype[methodName] = function wrapped(...args) {
      wrapperCalls++;
      return original.apply(this, args);
    };
    if (methodName === 'setItem') localStorageObj.setItem('probe', '1');
    else if (methodName === 'removeItem') localStorageObj.removeItem('probe');
    else localStorageObj.clear();
    const wrapperInvoked = wrapperCalls === 1;
    StorageCtor.prototype[methodName] = original;
    const restoredExactly = StorageCtor.prototype[methodName] === original;
    check(
      `PART 4: Storage.prototype.${methodName} can be wrapped, the wrapper is invoked via localStorage.${methodName}(), and the exact original reference is restorable`,
      wrapperInvoked && restoredExactly,
      `wrapperCalls=${wrapperCalls}, restoredExactly=${restoredExactly}`
    );
  }
  localStorageObj.clear();

  const allPassed = checks.every((c) => c.result === 'PASS');
  return { checks, allPassed };
}

export function buildFullVerificationInvocationSource() {
  return `(${runFullStorageVerification.toString()})(window, typeof Storage !== 'undefined' ? Storage : null)`;
}
