/**
 * qa/helpers/i18n-fake-dom.mjs
 *
 * FULL-SYSTEM I18N COMPLETION R2 — shared minimal DOM shim.
 *
 * Several photographer-facing renderer modules reference the browser
 * globals `document`/`window` at module scope, so they cannot be
 * imported under plain Node without a minimal stand-in. This shim
 * exists ONLY to make those modules importable so their PURE exported
 * functions (e.g. buildReviewSystemEvidence) can be unit-tested
 * directly. It deliberately implements the smallest possible surface
 * and is never used to assert rendering behaviour.
 */
export function installMinimalDomForModuleImport() {
  if (typeof globalThis.document !== 'undefined') return globalThis.document;
  const el = () => ({
    style: {}, dataset: {}, children: [],
    classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} },
    appendChild(c) { this.children.push(c); return c; },
    append() {}, replaceChildren() { this.children = []; },
    setAttribute() {}, getAttribute() { return null; }, removeAttribute() {},
    addEventListener() {}, removeEventListener() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
    closest() { return null; }, scrollIntoView() {}, focus() {},
    set textContent(_v) {}, get textContent() { return ''; },
    set innerHTML(_v) {}, get innerHTML() { return ''; },
  });
  globalThis.document = {
    createElement: el, createTextNode: el,
    getElementById() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; },
    body: el(), documentElement: el(), addEventListener() {},
  };
  globalThis.window = { addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }), getComputedStyle: () => ({ getPropertyValue: () => '' }) };
  globalThis.Node = function Node() {};
  globalThis.HTMLElement = function HTMLElement() {};
  globalThis.localStorage = { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } };
  return globalThis.document;
}
