#!/usr/bin/env node
/**
 * qa/epic-2e-j-phase-c-step7b-b-test.mjs
 *
 * EPIC 2E-J-C-F2 Step 7B-B — Keyboard, Accessibility, Security and
 * Final Phase C Closeout. Launches the REAL, complete, unmodified
 * application in real Chromium, drives it through real keyboard
 * events (never `locator.focus()` as a substitute for Tab), audits
 * accessibility structure/ARIA/contrast/touch-targets, and tests the
 * real Observation/Session renderers directly against malformed and
 * hostile input plus HTML/script injection strings.
 *
 * EPIC 2E-J ENV-B2: the application is loaded through the
 * Navigation-Free In-Memory Harness (qa/helpers/playwright-in-memory-app.mjs
 * + qa/helpers/playwright-opaque-origin-storage.mjs, wired together via
 * qa/helpers/playwright-lumixa-test-runtime.mjs's openLumixaInMemoryPage())
 * — every Page this suite opens navigates ONLY to "about:blank?qa=1",
 * never localhost/127.0.0.1/a private IP/a local HTTP server/a public
 * deployment. The real project fixture image is still supplied via the
 * genuine Playwright file-input API (page.setInputFiles against a real
 * disk path) — Node/Playwright reads that file directly; the Browser
 * itself never navigates to file:.
 *
 * Run: node qa/epic-2e-j-phase-c-step7b-b-test.mjs
 * Output: qa/epic-2e-j-phase-c-step7b-b-results.json (written ONLY when
 * the real Browser suite actually ran to completion)
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeStep7BBDecision, isAllowedExternalFontUrl } from './epic-2e-j-phase-c-step7b-b-f1-decision.mjs';
import {
  detectPlaywrightPackage,
  detectBrowserExecutable,
  REQUIRED_LAUNCH_ARGS,
  buildLumixaAppSnapshot,
  openLumixaInMemoryPage,
  observeAppStorageKeys,
  classifyStorageKeyPrivacyRisk,
  computeInMemoryHarnessDecision,
} from './helpers/playwright-lumixa-test-runtime.mjs';
import { CANONICAL_ORIGIN } from './helpers/playwright-in-memory-app.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const FIXTURES_DIR = path.join(PROJECT_ROOT, 'qa', 'fixtures', 'epic-2e-j');
const SCREENSHOTS_DIR = path.join(PROJECT_ROOT, 'qa', 'screenshots', 'epic-2e-j-step7b-b');

const results = [];
let contrastResults = [];
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

// Relative luminance / contrast ratio per WCAG.
function relLuminance([r, g, b]) {
  const chan = [r, g, b].map((c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  return 0.2126 * chan[0] + 0.7152 * chan[1] + 0.0722 * chan[2];
}
function contrastRatio(rgb1, rgb2) {
  const l1 = relLuminance(rgb1), l2 = relLuminance(rgb2);
  const [lighter, darker] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (lighter + 0.05) / (darker + 0.05);
}
function parseRgb(str) {
  const m = str.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  return m ? [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)] : null;
}
// Step 7B-B-F2-S3 FIX 5 — Node-side RGBA parse (mirrors the browser-side
// parseRgbaLocal exactly) so the Focus indicator's own color alpha can be
// genuinely composited over its resolved adjacent background, never
// discarded.
function parseRgbaNode(str) {
  const m = str && str.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
  if (!m) return null;
  const r = parseFloat(m[1]), g = parseFloat(m[2]), b = parseFloat(m[3]);
  const a = m[4] !== undefined ? parseFloat(m[4]) : 1;
  return [r, g, b, a];
}
// Step 7B-B-F2-S3 FIX 6 — splits a computed `box-shadow` value into its
// individual shadow layers, splitting only on top-level commas (never
// inside an rgba(...)/rgb(...) color's own commas), so a specific
// Focus-introduced layer can be isolated rather than guessed at.
function splitBoxShadowLayers(str) {
  if (!str || str === 'none') return [];
  const layers = [];
  let depth = 0;
  let current = '';
  for (const ch of str) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      layers.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) layers.push(current.trim());
  return layers;
}

// Step 7B-B-F2-S2 — shared decision logic for one Contrast entry
// (reused by the main sweep AND the standalone Warning check, so both
// apply IDENTICAL FAIL/NOT_TESTED/PASS rules). `entry` is the raw data
// shape returned by the browser-side `collect()` helper: { missing,
// colorRaw, fgRgba, bg:{undeterminable|rgb}, opacityResolvable,
// opacityValue, opacityReason, fontSize, fontWeight, isLargeText, text }.
function recordContrastEntry(label, entry, contrastResultsList) {
  if (!entry || entry.missing) {
    record(`Contrast: ${label}`, false, 'required element not found in DOM, or required non-empty text was not present — FAIL (never NOT_TESTED for a missing required element or empty required text, never PASS merely because the element exists)');
    return;
  }
  if (entry.notVisible) {
    // FIX 3 (F2-S3): a required target that is display:none,
    // visibility:hidden/collapse, zero-size, effectively zero-opacity,
    // or has no rendered client rects is FAIL, never NOT_TESTED — a
    // hidden non-empty Element is never treated as measurable.
    record(`Contrast: ${label}`, false, entry.notVisibleReason);
    return;
  }
  if (!entry.fgRgba) {
    // FIX 1 (F2-S): a normal opaque foreground color that fails to parse is FAIL, not NOT_TESTED.
    record(`Contrast: ${label}`, false, `foreground color could not be parsed (color=${entry.colorRaw}) — FAIL, not NOT_TESTED`);
    return;
  }
  if (entry.bg.undeterminable) {
    // FIX 1 (F2-S2): the ONLY permitted background-side NOT_TESTED path
    // — a genuinely non-computable gradient/background-image case on a
    // contributing element, with explicit evidence.
    record(`Contrast: ${label}`, 'NOT_TESTED', entry.bg.reason);
    return;
  }
  if (!entry.opacityResolvable) {
    // FIX 2 (F2-S2/F2-S3): computed opacity on the target or a
    // contributing ancestor could not be parsed reliably — NOT_TESTED
    // with bounded evidence, never a silent assumption of opacity=1.
    record(`Contrast: ${label}`, 'NOT_TESTED', entry.opacityReason);
    return;
  }
  if (entry.opacityValue !== 1) {
    // FIX 2 (F2-S3): CSS opacity on the target or an ancestor applies to
    // the WHOLE rendered group — background layers AND descendants
    // together — not just the foreground text color's own alpha. It is
    // never safe to model this as `foregroundAlpha * ancestorOpacity`
    // against a background that was resolved independently, without
    // equivalent group compositing of that same background. Rather than
    // fabricate a Ratio from a partial/incorrect model, this is honestly
    // NOT_TESTED whenever any target/ancestor computed opacity is below 1.
    record(`Contrast: ${label}`, 'NOT_TESTED', 'CSS group opacity requires full foreground/background group compositing');
    return;
  }
  // opacityValue === 1 for the target and every ancestor: normal, correct
  // RGBA foreground composition using ONLY the foreground's own alpha
  // channel (never multiplied by ancestor opacity, which by construction
  // contributes nothing further here).
  const fgAlpha = entry.fgRgba[3];
  const compositedFg = fgAlpha >= 1
    ? [entry.fgRgba[0], entry.fgRgba[1], entry.fgRgba[2]]
    : [0, 1, 2].map((i) => Math.round(entry.fgRgba[i] * fgAlpha + entry.bg.rgb[i] * (1 - fgAlpha)));
  const ratio = contrastRatio(compositedFg, entry.bg.rgb);
  const threshold = entry.isLargeText ? 3.0 : 4.5;
  if (contrastResultsList) contrastResultsList.push({ label, ratio: +ratio.toFixed(2), threshold, isLargeText: entry.isLargeText, fontSize: entry.fontSize, fontWeight: entry.fontWeight, text: entry.text, fgAlpha: +fgAlpha.toFixed(3) });
  record(`Contrast: ${label} meets ${threshold}:1 (WCAG AA ${entry.isLargeText ? 'large' : 'normal'} text)`, ratio >= threshold, `ratio=${ratio.toFixed(2)}:1, fontSize=${entry.fontSize}px, fontWeight=${entry.fontWeight}, fgAlpha=${fgAlpha.toFixed(3)}, compositedFg=rgb(${compositedFg.join(',')}), resolvedBg=rgb(${entry.bg.rgb.join(',')}) [hadOpaqueBase=${entry.bg.hadOpaqueBase}, layers=${entry.bg.layerCount}], text="${entry.text}"`);
}

// Step 7B-B-F2-S2 — the corrected effective-background resolver
// (FIX 1) and effective-opacity resolver (FIX 2) are duplicated
// verbatim inside each page.evaluate() callback that needs them
// (Contrast sweep, standalone Warning check, Focus indicator) — a
// page.evaluate() callback is serialized by source text and executed
// in the browser realm, so it cannot close over or `import` a Node.js
// function defined out here. Each copy below is kept byte-identical by
// construction; if one changes, all three must.

// Step 7B-B-F3-S — shared helpers for real-keyboard-only activation
// proof, MutationObserver-based live-region auditing, announcement
// bounds checking, and side-effect isolation instrumentation.

// Presses real Tab keys until `document.activeElement.id` equals
// `targetId` or `maxSteps` is exhausted. Never uses `.focus()` as
// reachability proof — every step is a genuine Tab keypress. Returns
// whether the target was reached; the ID sequence (when a `sequenceOut`
// array is supplied) is the actual evidence of real navigation.
async function tabTo(page, targetId, maxSteps, sequenceOut) {
  for (let i = 0; i < maxSteps; i++) {
    await page.keyboard.press('Tab');
    const id = await page.evaluate(() => (document.activeElement ? document.activeElement.id : null));
    if (sequenceOut) sequenceOut.push(id);
    if (id === targetId) return true;
  }
  return false;
}

// Clicks an element ONLY for test setup/cleanup (never as Keyboard
// activation proof for anything asserted afterward) — e.g. resetting
// Reasons/Observation state before a Part begins.
async function safeClickIfEnabled(page, id) {
  const canClick = await page.evaluate((elId) => { const el = document.getElementById(elId); return !!el && el.disabled !== true; }, id);
  if (canClick) await page.click(`#${id}`);
  return canClick;
}

// ══════════════════════════════════════════════════════════════════
// EPIC 2E-J ENV-B2-F1 — shared browser-side test utilities.
//
// FIX 4: persistent Focus identity. A Window-scoped WeakMap<Element,
// number> assigns each real DOM Element a unique, stable sequential
// identity the FIRST time it is observed, so two different anonymous
// (id-less) BUTTON Elements can never compare equal merely because
// they share a tagName — only genuinely re-observing the SAME Element
// reference produces the SAME identity. Identity format: the
// Element's own id when present, otherwise "TAGNAME#focus-node-N".
//
// FIX 1/2/3: real focusable-order computation, respecting visibility,
// disabled/aria-hidden state, and native radio-group roving-tabindex
// semantics (a named radio group occupies exactly ONE Tab stop — the
// checked radio, or the first if none is checked — never one stop per
// radio input).
// ══════════════════════════════════════════════════════════════════
const STEP7BB_TEST_UTILS_SRC = `(() => {
  if (window.__step7bbTestUtils) return;
  const identityMap = new WeakMap();
  let identitySeq = 0;
  function identify(el) {
    if (!el) return null;
    if (!identityMap.has(el)) {
      identitySeq += 1;
      identityMap.set(el, identitySeq);
    }
    const seq = identityMap.get(el);
    return el.id ? el.id : (el.tagName + '#focus-node-' + seq);
  }
  function isVisible(el) {
    if (!(el instanceof Element)) return false;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    return true;
  }
  // FIX 1 (ENV-B2-F2) — exclude inert Elements and their descendants,
  // and aria-hidden="true" Elements and their descendants. Walked from
  // the candidate up to the document root (bounded by real DOM depth).
  function isInertOrAriaHidden(el) {
    let cur = el;
    while (cur) {
      if (cur.inert) return true;
      if (cur.getAttribute && cur.getAttribute('aria-hidden') === 'true') return true;
      cur = cur.parentElement;
    }
    return false;
  }
  // FIX 1 (ENV-B2-F2) — a CLOSED <details> hides every descendant from
  // sequential focus except its own first <summary> child, which is
  // ALWAYS a real, native Tab stop regardless of the details' open/
  // closed state (this is ROOT CAUSE 1: the previous model omitted
  // SUMMARY entirely, so the real Chromium predecessor of the
  // Observation radio group — a <summary> — was never modeled).
  function isHiddenInsideClosedDetails(el) {
    const details = el.closest ? el.closest('details') : null;
    if (!details) return false;
    if (details.open) return false;
    const firstSummary = details.querySelector('summary');
    if (el === firstSummary) return false;
    return !(firstSummary && firstSummary.contains(el));
  }
  function parsedTabIndex(el) {
    const attr = el.getAttribute('tabindex');
    if (attr === null) return null;
    const n = parseInt(attr, 10);
    return Number.isNaN(n) ? null : n;
  }
  function isFirstSummaryOfDetails(el) {
    if (el.tagName !== 'SUMMARY') return false;
    const details = el.parentElement;
    return !!(details && details.tagName === 'DETAILS' && details.querySelector('summary') === el);
  }
  // FIX 1 (ENV-B2-F2) — the native-focusability check recognizes the
  // full required element set: input/button/select/textarea (enabled,
  // non-hidden-type), a[href], area[href], iframe, object, embed,
  // audio[controls], video[controls], and the first <summary> child of
  // a <details> element.
  function isNativelyFocusable(el) {
    const tag = el.tagName;
    if (tag === 'INPUT') return el.type !== 'hidden' && !el.disabled;
    if (tag === 'BUTTON') return !el.disabled;
    if (tag === 'SELECT') return !el.disabled;
    if (tag === 'TEXTAREA') return !el.disabled;
    if (tag === 'A') return el.hasAttribute('href');
    if (tag === 'AREA') return el.hasAttribute('href');
    if (tag === 'IFRAME') return true;
    if (tag === 'OBJECT') return true;
    if (tag === 'EMBED') return true;
    if (tag === 'AUDIO') return el.hasAttribute('controls');
    if (tag === 'VIDEO') return el.hasAttribute('controls');
    if (tag === 'SUMMARY') return isFirstSummaryOfDetails(el);
    return false;
  }
  function isContentEditable(el) {
    const v = el.getAttribute('contenteditable');
    return v !== null && v !== 'false';
  }
  function isKeyboardFocusable(el) {
    if (!(el instanceof Element)) return false;
    if (el.hasAttribute('disabled')) return false;
    if (isInertOrAriaHidden(el)) return false;
    if (isHiddenInsideClosedDetails(el)) return false;
    const ti = parsedTabIndex(el);
    if (ti !== null) {
      if (ti < 0) return false;
      return isVisible(el); // [tabindex] where parsed tabindex >= 0
    }
    if (isContentEditable(el)) return isVisible(el);
    if (!isNativelyFocusable(el)) return false;
    return isVisible(el);
  }
  function computeFocusableOrder() {
    const all = Array.from(document.querySelectorAll('*'));
    const focusable = all.filter(isKeyboardFocusable);
    // FIX 1 (ENV-B2-F2) — support positive tabindex ordering: positive
    // tabindex Elements come FIRST, in ascending tabindex order (equal
    // tabindex preserves DOM order); tabindex=0 and every native
    // focusable then follow in real DOM order — matching the actual
    // Chromium sequential focus navigation algorithm.
    const withMeta = focusable.map((el, domIndex) => ({ el, domIndex, ti: parsedTabIndex(el) }));
    withMeta.sort((a, b) => {
      const aPositive = a.ti !== null && a.ti > 0;
      const bPositive = b.ti !== null && b.ti > 0;
      if (aPositive && bPositive) return a.ti !== b.ti ? a.ti - b.ti : a.domIndex - b.domIndex;
      if (aPositive && !bPositive) return -1;
      if (!aPositive && bPositive) return 1;
      return a.domIndex - b.domIndex;
    });
    // FIX 1 (ENV-B2-F2) — retain native named-radio-group behavior: a
    // named Radio group is ONE Tab stop (the checked enabled Radio, or
    // otherwise the first ENABLED Radio); a disabled Radio never
    // becomes the group Tab stop; a group with every Radio disabled
    // contributes no Tab stop at all. Dedup is applied AFTER the
    // positive-tabindex sort so relative ordering stays correct.
    const filtered = [];
    const seenRadioGroups = new Set();
    for (const { el } of withMeta) {
      if (el.tagName === 'INPUT' && el.type === 'radio' && el.name) {
        if (seenRadioGroups.has(el.name)) continue;
        seenRadioGroups.add(el.name);
        const groupEls = Array.from(document.getElementsByName(el.name)).filter((r) => r.type === 'radio' && !r.disabled);
        const checked = groupEls.find((r) => r.checked);
        const stop = checked || groupEls[0];
        if (!stop) continue;
        filtered.push(stop);
        continue;
      }
      filtered.push(el);
    }
    const obsRoot = document.getElementById('interactivePreviewObservationInner');
    const sessionRoot = document.getElementById('interactivePreviewObservationSessionInner');
    return filtered.map((el, idx) => ({
      index: idx,
      element: el,
      identity: identify(el),
      id: el.id || null,
      insideObs: !!(obsRoot && obsRoot.contains(el)),
      insideSession: !!(sessionRoot && sessionRoot.contains(el)),
    }));
  }
  window.__step7bbTestUtils = { identify, isVisible, isKeyboardFocusable, computeFocusableOrder };
})();`;

async function installStep7bbTestUtils(page) {
  await page.evaluate(STEP7BB_TEST_UTILS_SRC);
}

/**
 * FIX 2 (ENV-B2-F2) — prepares a known, UNCHECKED Observation state
 * through the REAL Clear Observation UI (never `.checked = false`
 * direct assignment, never Controller/Renderer internals). If nothing
 * is currently selected, Clear Observation is disabled and this is a
 * safe no-op (safeClickIfEnabled never fabricates a click on a
 * disabled control).
 */
async function resetObservationStateViaRealUI(page) {
  await safeClickIfEnabled(page, 'ipoClearButton'); // setup only
  await page.waitForTimeout(120);
  return page.evaluate(() => {
    const radios = Array.from(document.querySelectorAll('input[name="ipoObservation"]'));
    const reasons = Array.from(document.querySelectorAll('input[name="ipoReason"]'));
    return {
      allRadiosUnchecked: radios.length > 0 && radios.every((r) => r.checked === false),
      allReasonsCleared: reasons.length > 0 && reasons.every((r) => r.checked === false),
      radioCount: radios.length,
      reasonCount: reasons.length,
    };
  });
}

/**
 * FIX 1/2 (ENV-B2-F2) — deterministic Tab entry into the Observation
 * radio group. FIX 2 requires every independent scenario to prepare
 * its OWN Radio-group state (never inherit a checked Radio from a
 * previous Arrow scenario): the group is reset to unchecked through
 * the real Clear Observation UI first, both the unchecked state and
 * the cleared Reasons are verified, and the first Radio becoming the
 * native radio-group Tab stop is verified — all BEFORE computing the
 * real predecessor and pressing the one acceptance Tab. FIX 1 supplies
 * the spec-aware focusable-order computation this entry relies on
 * (including native SUMMARY Tab stops per ROOT CAUSE 1), so the
 * computed real predecessor now matches the real Chromium Tab
 * predecessor.
 */
async function enterObservationRadioGroupDeterministically(page) {
  const targetId = 'ipoOption_prefer-legacy';
  const resetState = await resetObservationStateViaRealUI(page);
  const stopCheck = await page.evaluate((targetId) => {
    const order = window.__step7bbTestUtils.computeFocusableOrder();
    return { firstRadioIsTabStop: order.some((o) => o.id === targetId) };
  }, targetId);
  const setup = await page.evaluate((targetId) => {
    const order = window.__step7bbTestUtils.computeFocusableOrder();
    const targetIndex = order.findIndex((o) => o.id === targetId);
    if (targetIndex === -1) return { ok: false, reason: 'target-not-found-in-focusable-order', targetIndex: -1, orderLength: order.length };
    let previousIndex = -1;
    for (let i = targetIndex - 1; i >= 0; i--) {
      if (!order[i].insideObs && !order[i].insideSession) { previousIndex = i; break; }
    }
    if (previousIndex === -1) return { ok: false, reason: 'no-preceding-focusable-element-outside-both-observation-roots', targetIndex };
    order[previousIndex].element.focus(); // setup only — never the radio itself
    return {
      ok: true,
      targetFocusableIndex: targetIndex,
      previousFocusableIndex: previousIndex,
      previousFocusableIdentity: order[previousIndex].identity,
      previousFocusableId: order[previousIndex].id,
    };
  }, targetId);
  if (!setup.ok) {
    return { ok: false, targetId, resetState, stopCheck, previousFocusableIdentity: null, previousFocusableId: null, previousFocusableIndex: setup.previousFocusableIndex ?? null, targetFocusableIndex: setup.targetFocusableIndex ?? null, actualAfterTabIdentity: null, reason: setup.reason };
  }
  await page.keyboard.press('Tab'); // the ONE real Tab acceptance action
  const actualAfterTabIdentity = await page.evaluate(() => window.__step7bbTestUtils.identify(document.activeElement));
  return {
    ok: actualAfterTabIdentity === targetId && resetState.allRadiosUnchecked && resetState.allReasonsCleared && stopCheck.firstRadioIsTabStop,
    targetId,
    resetState,
    stopCheck,
    previousFocusableIdentity: setup.previousFocusableIdentity,
    previousFocusableId: setup.previousFocusableId,
    previousFocusableIndex: setup.previousFocusableIndex,
    targetFocusableIndex: setup.targetFocusableIndex,
    actualAfterTabIdentity,
  };
}

/**
 * FIX 8 (ENV-B2-F2) — variant of the deterministic entry for scenarios
 * where the Radio group must ALREADY have a checked Radio as its
 * native Tab stop (e.g. Part 3's Cleared-count scenario, which
 * deliberately selects Prefer Legacy as its own baseline setup BEFORE
 * entering the group — resetting it here would destroy that baseline).
 * Never resets the group first, unlike
 * enterObservationRadioGroupDeterministically(). Requires the checked
 * Radio (targetId) to genuinely already be the real Tab stop; if
 * nothing is checked, or the checked Radio differs from targetId, this
 * fails closed (ok:false) rather than silently accepting whatever
 * Radio Tab happens to land on.
 */
async function enterObservationRadioGroupWithCurrentSelection(page, targetId) {
  const stopCheck = await page.evaluate((targetId) => {
    const checked = document.getElementById(targetId);
    return { targetChecked: !!checked && checked.checked === true };
  }, targetId);
  const setup = await page.evaluate((targetId) => {
    const order = window.__step7bbTestUtils.computeFocusableOrder();
    const targetIndex = order.findIndex((o) => o.id === targetId);
    if (targetIndex === -1) return { ok: false, reason: 'target-not-found-in-focusable-order', targetIndex: -1, orderLength: order.length };
    let previousIndex = -1;
    for (let i = targetIndex - 1; i >= 0; i--) {
      if (!order[i].insideObs && !order[i].insideSession) { previousIndex = i; break; }
    }
    if (previousIndex === -1) return { ok: false, reason: 'no-preceding-focusable-element-outside-both-observation-roots', targetIndex };
    order[previousIndex].element.focus(); // setup only — never the radio itself
    return { ok: true, targetFocusableIndex: targetIndex, previousFocusableIndex: previousIndex, previousFocusableIdentity: order[previousIndex].identity, previousFocusableId: order[previousIndex].id };
  }, targetId);
  if (!setup.ok) {
    return { ok: false, targetId, stopCheck, previousFocusableIdentity: null, previousFocusableId: null, previousFocusableIndex: setup.previousFocusableIndex ?? null, targetFocusableIndex: setup.targetFocusableIndex ?? null, actualAfterTabIdentity: null, reason: setup.reason };
  }
  await page.keyboard.press('Tab'); // the ONE real Tab acceptance action
  const actualAfterTabIdentity = await page.evaluate(() => window.__step7bbTestUtils.identify(document.activeElement));
  return {
    ok: actualAfterTabIdentity === targetId && stopCheck.targetChecked,
    targetId,
    stopCheck,
    previousFocusableIdentity: setup.previousFocusableIdentity,
    previousFocusableId: setup.previousFocusableId,
    previousFocusableIndex: setup.previousFocusableIndex,
    targetFocusableIndex: setup.targetFocusableIndex,
    actualAfterTabIdentity,
  };
}

/**
 * FIX 3 (ENV-B2-F2) — canonical independent Arrow-key scenario. Never
 * inherits focus state OR checked Radio from any preceding scenario:
 * performs its own state reset + deterministic entry (FIX 2), records
 * the initial active Radio, then exercises ALL FOUR required Arrow-key
 * names (ArrowDown x3 — enough forward movement alone to visit every
 * one of the four Radio IDs — then ArrowRight, ArrowUp, ArrowLeft for
 * full key-name coverage), recording {key, activeId, checkedIds,
 * checkedCount} after every single action, and requiring
 * checkedCount === 1 after EVERY action plus that every expected Radio
 * ID was genuinely visited. Never uses click()/focus()/direct checked
 * assignment as Arrow-acceptance proof.
 */
async function runIndependentArrowScenario(page) {
  const entry = await enterObservationRadioGroupDeterministically(page);
  const initialActiveId = entry.actualAfterTabIdentity;
  const keySequence = ['ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft'];
  const steps = [];
  const visitedIds = new Set(initialActiveId ? [initialActiveId] : []);
  for (const key of keySequence) {
    await page.keyboard.press(key);
    const state = await page.evaluate(() => {
      const radios = Array.from(document.querySelectorAll('input[name="ipoObservation"]'));
      const checked = radios.filter((r) => r.checked);
      return { activeId: document.activeElement.id, checkedIds: checked.map((r) => r.id), checkedCount: checked.length };
    });
    visitedIds.add(state.activeId);
    steps.push({ key, activeId: state.activeId, checkedIds: state.checkedIds, checkedCount: state.checkedCount });
  }
  const expectedIds = ['ipoOption_prefer-legacy', 'ipoOption_prefer-v2', 'ipoOption_no-visible-difference', 'ipoOption_unsure'];
  const allFourKeyNamesExercised = ['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft'].every((k) => keySequence.includes(k));
  const allExpectedVisited = expectedIds.every((id) => visitedIds.has(id));
  const allExactlyOneChecked = steps.length === keySequence.length && steps.every((s) => s.checkedCount === 1);
  return {
    entry,
    initialActiveId,
    keySequence,
    steps,
    visitedIds: Array.from(visitedIds),
    expectedIds,
    allFourKeyNamesExercised,
    allExpectedVisited,
    allExactlyOneChecked,
    // retained for continuity with prior evidence consumers
    matchesExpectedOrder: allExpectedVisited,
    exactlyOneCheckedPerStep: steps.map((s) => s.checkedCount === 1),
  };
}

/**
 * FIX 3 (ENV-B2-F2) helper — a bounded maximum Tab count derived from
 * the real, CURRENT (live-queried) focusable-order distance between
 * two Elements (never a hard-coded guess). Used by every Tab-traversal
 * loop in this suite. FIX 6: when either ID cannot be located in the
 * current order, `derived:false` is returned — the caller must fail
 * closed and never treat the `maxTabs:40` fallback as PASS evidence;
 * the fallback exists only so evidence collection can still occur.
 */
async function computeBoundedMaxTabs(page, fromId, toId, margin = 5) {
  const bounds = await page.evaluate(({ fromId, toId }) => {
    const order = window.__step7bbTestUtils.computeFocusableOrder();
    return { fromIndex: order.findIndex((o) => o.id === fromId), toIndex: order.findIndex((o) => o.id === toId) };
  }, { fromId, toId });
  if (bounds.fromIndex === -1 || bounds.toIndex === -1) {
    // The DOM-derived bound itself is unavailable (one of the two IDs
    // wasn't found in the current focusable order) — this is recorded
    // honestly via the returned `bounds` object rather than silently
    // substituting an arbitrary large number without evidence.
    return { maxTabs: 40, bounds, derived: false };
  }
  return { maxTabs: Math.max(1, bounds.toIndex - bounds.fromIndex) + margin, bounds, derived: true };
}

/**
 * FIX 4/5/6 (ENV-B2-F2) — canonical Observation-selection + Reason +
 * Clear-button scenario, and THE single canonical evidence source for
 * Tab entry / first Reason / Reason Space activation / Shift+Tab
 * reversal / Clear Reasons / Clear Observation / Clear Session (FIX 7).
 *
 * Reasons and Clear Observation are DISABLED until an Observation is
 * genuinely selected — so any bound computed before selection is
 * invalid evidence (this was the ENV-B2-F1 defect). This scenario:
 *   1. resets + enters the Radio group (FIX 2), then selects Prefer
 *      Legacy via a real Space press (never .click()/.checked).
 *   2. verifies Prefer Legacy checked, exactly one Radio checked,
 *      Reason controls enabled, Clear Observation enabled.
 *   3. recomputes the focusable order AFTER that state change and
 *      derives every subsequent Tab bound from THIS post-selection
 *      order (FIX 6 — computeBoundedMaxTabs re-queries the live DOM on
 *      every call, so it is never stale).
 *   4. observes (never assumes) the real order: Clear Observation,
 *      first Reason, remaining Reasons, Clear Reasons, Clear Session.
 *   5. reaches the first Reason via real Tab, records the immediately
 *      previous focused Element's persistent identity, presses Space,
 *      verifies checked, presses Shift+Tab, requires Focus returns to
 *      the EXACT previous Element (identity, not just ID/tagName —
 *      FIX 5), Tabs forward again, and continues to Clear Reasons /
 *      Clear Session.
 * When a bound cannot be derived, `boundsAllDerived` is false and the
 * acceptance result must be treated as FAIL by the caller — the
 * maxTabs:40 fallback exists only to allow evidence collection to
 * continue, never as substitute PASS evidence (FIX 6).
 */
async function runObservationSelectionReasonAndClearScenario(page) {
  const entry = await enterObservationRadioGroupDeterministically(page);

  await page.keyboard.press('Space'); // real Space activation — never .click()/.checked assignment
  await page.waitForTimeout(120);
  const afterSelect = await page.evaluate(() => {
    const radios = Array.from(document.querySelectorAll('input[name="ipoObservation"]'));
    const clearObs = document.getElementById('ipoClearButton');
    const firstReason = document.querySelector('input[name="ipoReason"]');
    return {
      preferLegacyChecked: document.getElementById('ipoOption_prefer-legacy')?.checked === true,
      checkedCount: radios.filter((r) => r.checked).length,
      clearObservationEnabled: !!clearObs && !clearObs.disabled,
      firstReasonEnabled: !!firstReason && !firstReason.disabled,
    };
  });
  const selectionOk = entry.ok && afterSelect.preferLegacyChecked && afterSelect.checkedCount === 1 && afterSelect.clearObservationEnabled && afterSelect.firstReasonEnabled;

  const expectedFirstReasonId = await page.evaluate(() => {
    const first = document.querySelector('input[name="ipoReason"]');
    return first ? first.id : null;
  });

  // FIX 4 — focusable order recomputed AFTER the state change.
  const postSelectOrder = await page.evaluate(() => window.__step7bbTestUtils.computeFocusableOrder().map((o) => ({ index: o.index, id: o.id, identity: o.identity })));
  const radioIndex = postSelectOrder.findIndex((o) => o.id === 'ipoOption_prefer-legacy');
  const clearObsIndex = postSelectOrder.findIndex((o) => o.id === 'ipoClearButton');
  const firstReasonIndex = expectedFirstReasonId ? postSelectOrder.findIndex((o) => o.id === expectedFirstReasonId) : -1;
  const clearReasonsIndex = postSelectOrder.findIndex((o) => o.id === 'ipoClearReasonsButton');
  const clearSessionIndex = postSelectOrder.findIndex((o) => o.id === 'ipoClearSessionButton');
  const observedOrderCorrect = radioIndex >= 0 && clearObsIndex > radioIndex && firstReasonIndex > clearObsIndex && clearReasonsIndex > firstReasonIndex && clearSessionIndex > clearReasonsIndex;

  // FIX 6 — bounds derived from the CURRENT post-selection order.
  const boundToFirstReason = expectedFirstReasonId ? await computeBoundedMaxTabs(page, 'ipoOption_prefer-legacy', expectedFirstReasonId) : { maxTabs: 0, bounds: {}, derived: false };
  const boundReasonToClearSession = expectedFirstReasonId ? await computeBoundedMaxTabs(page, expectedFirstReasonId, 'ipoClearSessionButton') : { maxTabs: 0, bounds: {}, derived: false };
  const boundsAllDerived = boundToFirstReason.derived === true && boundReasonToClearSession.derived === true;

  // ── Phase A: real Tab forward from the selected Radio to the first Reason. ──
  let reachedClearObs = false;
  let reachedFirstReasonId = null;
  const sequenceA = [entry.actualAfterTabIdentity];
  let previousIdentity = entry.actualAfterTabIdentity;
  let firstReasonPreviousIdentity = null;
  for (let i = 0; i < boundToFirstReason.maxTabs && reachedFirstReasonId === null; i++) {
    await page.keyboard.press('Tab');
    const state = await page.evaluate(() => ({ id: document.activeElement.id, identity: window.__step7bbTestUtils.identify(document.activeElement) }));
    sequenceA.push(state.id);
    if (state.id === 'ipoClearButton') reachedClearObs = true;
    if (reachedFirstReasonId === null && state.id && state.id.startsWith('ipoReason_')) {
      reachedFirstReasonId = state.id;
      firstReasonPreviousIdentity = previousIdentity;
    }
    previousIdentity = state.identity;
  }

  // ── Phase B (FIX 5): Space on the Reason, Shift+Tab identity reversal. ──
  let reasonSpaceResult = null;
  if (reachedFirstReasonId !== null) {
    await page.keyboard.press('Space');
    await page.waitForTimeout(100);
    const reasonChecked = await page.evaluate((id) => document.getElementById(id)?.checked === true, reachedFirstReasonId);
    await page.keyboard.press('Shift+Tab');
    const afterShiftTabIdentity = await page.evaluate(() => window.__step7bbTestUtils.identify(document.activeElement));
    const shiftTabReturnsToExactPreviousElement = firstReasonPreviousIdentity !== null && afterShiftTabIdentity === firstReasonPreviousIdentity;
    await page.keyboard.press('Tab'); // Tab forward again (back onto the Reason) before continuing
    reasonSpaceResult = { reasonId: reachedFirstReasonId, reasonChecked, previousIdentity: firstReasonPreviousIdentity, afterShiftTabIdentity, shiftTabReturnsToExactPreviousElement };
  }

  // ── Phase C: continue real Tab forward to Clear Reasons / Clear Session. ──
  let reachedClearReasons = false;
  let reachedClearSession = false;
  const sequenceC = [];
  for (let i = 0; i < boundReasonToClearSession.maxTabs && !(reachedClearReasons && reachedClearSession); i++) {
    await page.keyboard.press('Tab');
    const id = await page.evaluate(() => document.activeElement.id);
    sequenceC.push(id);
    if (id === 'ipoClearReasonsButton') reachedClearReasons = true;
    if (id === 'ipoClearSessionButton') reachedClearSession = true;
  }

  return {
    entry, selectionOk, afterSelect,
    expectedFirstReasonId, reachedFirstReasonId,
    firstReasonMatchesExpected: reachedFirstReasonId !== null && reachedFirstReasonId === expectedFirstReasonId,
    postSelectOrder: { radioIndex, clearObsIndex, firstReasonIndex, clearReasonsIndex, clearSessionIndex },
    observedOrderCorrect,
    boundToFirstReason, boundReasonToClearSession, boundsAllDerived,
    reachedClearObs, reachedClearReasons, reachedClearSession,
    sequence: [...sequenceA, ...(reasonSpaceResult ? [`SPACE(${reasonSpaceResult.reasonId})`, 'Shift+Tab', 'Tab'] : []), ...sequenceC],
    reasonSpaceResult,
  };
}

// Step 7B-B-F3-S2 FIX 2 — a TEXT-TRANSITION observer: distinguishes the
// raw DOM mutation count from the actual text-transition count. A
// transition is only recorded when the trimmed text genuinely differs
// from the previously-recorded text — a DOM replacement that leaves the
// SAME text is never counted as a new announcement. `previousText` is
// seeded from the REAL current text at install time (never assumed
// empty), and is updated after every genuine transition only.
async function installLiveRegionObservers(page) {
  await page.evaluate(() => {
    const regionIds = ['ipoStatus', 'ipoWarning', 'ipoReasonLimit'];
    window.__step7bbLiveAudit = {};
    window.__step7bbLiveObservers = [];
    regionIds.forEach((id) => {
      const el = document.getElementById(id);
      window.__step7bbLiveAudit[id] = { previousText: el ? (el.textContent || '').trim() : '', rawMutationCount: 0, textTransitions: [] };
      if (!el) return;
      const obs = new MutationObserver((mutationList) => {
        const rec = window.__step7bbLiveAudit[id];
        rec.rawMutationCount += mutationList.length;
        const currentText = (el.textContent || '').trim();
        if (currentText !== rec.previousText) {
          rec.textTransitions.push({ from: rec.previousText, to: currentText });
          rec.previousText = currentText;
        }
      });
      obs.observe(el, { childList: true, characterData: true, subtree: true });
      window.__step7bbLiveObservers.push(obs);
    });
  });
}
async function uninstallLiveRegionObservers(page) {
  await page.evaluate(() => {
    (window.__step7bbLiveObservers || []).forEach((o) => o.disconnect());
    window.__step7bbLiveObservers = [];
  });
}
// Clears the recorded transitions/count for a fresh audit WINDOW —
// `previousText` is deliberately PRESERVED (it reflects the actual
// current DOM text, not a reset baseline), so a subsequent same-text
// mutation still correctly fails to count as a new transition.
async function resetLiveRegionAudit(page) {
  await page.evaluate(() => {
    if (!window.__step7bbLiveAudit) return;
    for (const id of Object.keys(window.__step7bbLiveAudit)) {
      window.__step7bbLiveAudit[id].rawMutationCount = 0;
      window.__step7bbLiveAudit[id].textTransitions = [];
    }
  });
}
async function readLiveRegionAudit(page, regionId) {
  return page.evaluate((rid) => (window.__step7bbLiveAudit ? JSON.parse(JSON.stringify(window.__step7bbLiveAudit[rid])) : null), regionId);
}
// Required record shape (Step 7B-B-F3-S2 FIX 2/3):
// { regionId, previousText, rawMutationCount, textTransitions: [{from,to}],
//   nonEmptyAnnouncements, distinctNonEmptyTexts, repeatedIdenticalTexts,
//   repeatedTexts }
// FIX 3 — duplicate detection spans the ENTIRE window, not just
// consecutive pairs: the first occurrence of an exact non-empty
// announcement text is allowed; every LATER occurrence of that same
// text counts as a duplicate, even when a different message occurred
// in between (A -> B -> A must be caught; A -> B alone must not).
function summarizeLiveTexts(regionId, audit) {
  const textTransitions = audit ? audit.textTransitions : [];
  const nonEmptyAnnouncementTexts = textTransitions.filter((t) => t.to && t.to.length > 0).map((t) => t.to);
  const distinctNonEmptyTexts = Array.from(new Set(nonEmptyAnnouncementTexts));
  const seen = new Set();
  const repeatedTexts = [];
  let repeatedIdenticalTexts = 0;
  for (const t of nonEmptyAnnouncementTexts) {
    if (seen.has(t)) { repeatedIdenticalTexts++; repeatedTexts.push(t); }
    else seen.add(t);
  }
  return {
    regionId,
    previousText: audit ? audit.previousText : null,
    rawMutationCount: audit ? audit.rawMutationCount : 0,
    textTransitions,
    nonEmptyAnnouncements: nonEmptyAnnouncementTexts.length,
    distinctNonEmptyTexts,
    repeatedIdenticalTexts,
    repeatedTexts,
  };
}

// Step 7B-B-F3-S3 FIX 5 — a CROSS-REGION window summary: duplicate
// detection must span ipoStatus + ipoWarning + ipoReasonLimit TOGETHER,
// not per-region in isolation. The same exact text emitted once by
// ipoStatus and once by ipoWarning is a duplicate; A -> B -> A across
// different regions is a duplicate; A -> B (different texts, any
// regions) is not. Accepts the RAW per-region audits (as returned by
// readLiveRegionAudit), keyed by region id.
function summarizeCrossRegionWindow(rawAuditsByRegion) {
  const allNonEmptyAnnouncements = [];
  const regionSources = [];
  for (const [regionId, audit] of Object.entries(rawAuditsByRegion || {})) {
    const textTransitions = audit ? audit.textTransitions : [];
    for (const t of textTransitions) {
      if (t.to && t.to.length > 0) {
        allNonEmptyAnnouncements.push(t.to);
        regionSources.push({ regionId, text: t.to });
      }
    }
  }
  const distinctNonEmptyAnnouncements = Array.from(new Set(allNonEmptyAnnouncements));
  const seen = new Set();
  const repeatedTexts = [];
  let repeatedIdenticalTexts = 0;
  for (const t of allNonEmptyAnnouncements) {
    if (seen.has(t)) { repeatedIdenticalTexts++; repeatedTexts.push(t); }
    else seen.add(t);
  }
  return { allNonEmptyAnnouncements, distinctNonEmptyAnnouncements, repeatedIdenticalTexts, repeatedTexts, regionSources };
}
// Reads all three intended live regions' RAW audits at once — used as
// the input to summarizeCrossRegionWindow (and individually to
// summarizeLiveTexts) so a single MutationObserver read serves both
// the per-region and the cross-region duplicate checks.
async function readAllLiveRegionAudits(page) {
  return {
    ipoStatus: await readLiveRegionAudit(page, 'ipoStatus'),
    ipoWarning: await readLiveRegionAudit(page, 'ipoWarning'),
    ipoReasonLimit: await readLiveRegionAudit(page, 'ipoReasonLimit'),
  };
}

// Step 7B-B-F3-S Part 8 — plain text only, no HTML injection, no
// [object Object], no NaN/Infinity, no raw stack/error text, bounded to
// 300 characters.
function isAnnouncementBounded(text) {
  if (typeof text !== 'string') return { ok: false, reason: `not a plain string (typeof=${typeof text})` };
  if (text.includes('<') && text.includes('>')) return { ok: false, reason: 'possible HTML injection (contains "<" and ">")' };
  if (text.includes('[object Object]')) return { ok: false, reason: 'contains [object Object]' };
  if (/\bNaN\b/.test(text)) return { ok: false, reason: 'contains NaN' };
  if (/\bInfinity\b/.test(text)) return { ok: false, reason: 'contains Infinity' };
  if (/at\s+\S+\s+\(.*:\d+:\d+\)/.test(text) || /^(Error|TypeError|RangeError|SyntaxError):/.test(text)) return { ok: false, reason: 'looks like a raw stack trace / error string' };
  if (text.length > 300) return { ok: false, reason: `exceeds 300 characters (length=${text.length})` };
  return { ok: true, reason: null };
}

// Step 7B-B-F3-S Part 9 — instruments the three named Canvas methods on
// the REAL CanvasRenderingContext2D prototype (never a mock canvas),
// counts calls, and restores the original methods exactly afterward.
async function installCanvasInstrumentation(page) {
  await page.evaluate(() => {
    if (window.__step7bbOriginalCanvasMethods) return; // already installed
    window.__step7bbCanvasCalls = { drawImage: 0, getImageData: 0, putImageData: 0 };
    const proto = CanvasRenderingContext2D.prototype;
    window.__step7bbOriginalCanvasMethods = { drawImage: proto.drawImage, getImageData: proto.getImageData, putImageData: proto.putImageData };
    proto.drawImage = function (...args) { window.__step7bbCanvasCalls.drawImage++; return window.__step7bbOriginalCanvasMethods.drawImage.apply(this, args); };
    proto.getImageData = function (...args) { window.__step7bbCanvasCalls.getImageData++; return window.__step7bbOriginalCanvasMethods.getImageData.apply(this, args); };
    proto.putImageData = function (...args) { window.__step7bbCanvasCalls.putImageData++; return window.__step7bbOriginalCanvasMethods.putImageData.apply(this, args); };
  });
}
async function readCanvasInstrumentation(page) {
  return page.evaluate(() => (window.__step7bbCanvasCalls ? { ...window.__step7bbCanvasCalls } : null));
}
// Step 7B-B-F3-S2 FIX 8 — restoration is proven via EXACT Function
// identity (prototype.drawImage === original.drawImage, etc.), computed
// and returned BEFORE the temporary instrumentation evidence is
// deleted — never inferred merely because the instrumentation
// variables were deleted.
async function restoreCanvasInstrumentation(page) {
  return page.evaluate(() => {
    const proto = CanvasRenderingContext2D.prototype;
    const orig = window.__step7bbOriginalCanvasMethods;
    if (!orig) return { restored: false, reason: 'no instrumentation was installed to restore' };
    proto.drawImage = orig.drawImage;
    proto.getImageData = orig.getImageData;
    proto.putImageData = orig.putImageData;
    const restored = proto.drawImage === orig.drawImage && proto.getImageData === orig.getImageData && proto.putImageData === orig.putImageData;
    delete window.__step7bbOriginalCanvasMethods;
    delete window.__step7bbCanvasCalls;
    return { restored, reason: restored ? null : 'prototype methods did not match original References after restoration' };
  });
}

const STEP7BB_SLIDER_IDS = ['exp', 'con', 'hi', 'sh', 'wh', 'bl', 'temp', 'tint', 'vib', 'sat', 'sharp', 'noise', 'clarity', 'dehaze', 'texture'];
async function snapshotSliderValues(page) {
  return page.evaluate((ids) => {
    const out = {};
    for (const id of ids) { const el = document.getElementById(id); out[id] = el ? el.value : null; }
    return out;
  }, STEP7BB_SLIDER_IDS);
}
function slidersUnchanged(before, after) {
  if (!before || !after) return false;
  return Object.keys(before).every((k) => before[k] === after[k]);
}

// Parses the REAL rendered "Observed: N" / "Prefer Legacy: N (P%)" /
// "Prefer V2: N (P%)" / "No visible difference: N (P%)" / "Unsure: N
// (P%)" lines produced by
// renderInteractivePreviewObservationSessionV2() in
// ui/interactive-preview-observation-renderer-v2.js. activeObservations
// is never fabricated — it is DERIVED as the sum of the four real
// rendered category counts, exactly matching how getSummary() computes
// it internally.
function parseSessionSummary(lines) {
  const patterns = {
    totalObserved: /^Observed:\s*(\d+)$/,
    preferLegacy: /^Prefer Legacy:\s*(\d+)/,
    preferV2: /^Prefer V2:\s*(\d+)/,
    noVisibleDifference: /^No visible difference:\s*(\d+)/,
    unsure: /^Unsure:\s*(\d+)/,
  };
  const out = { totalObserved: null, preferLegacy: null, preferV2: null, noVisibleDifference: null, unsure: null };
  for (const line of lines) {
    for (const [key, re] of Object.entries(patterns)) {
      const m = line.match(re);
      if (m) out[key] = parseInt(m[1], 10);
    }
  }
  const knownActiveParts = [out.preferLegacy, out.preferV2, out.noVisibleDifference, out.unsure].filter((v) => v !== null);
  out.activeObservationsDerived = knownActiveParts.length === 4 ? knownActiveParts.reduce((a, b) => a + b, 0) : null;
  return out;
}
async function readSessionMetricsText(page) {
  return page.evaluate(() => {
    const metricsEl = document.getElementById('ipoSessionMetrics');
    const secondaryEl = document.getElementById('ipoSessionSecondary');
    const topReasonsEl = document.getElementById('ipoSessionTopReasons');
    return {
      lines: metricsEl ? Array.from(metricsEl.children).map((c) => (c.textContent || '').trim()) : [],
      secondaryText: secondaryEl ? (secondaryEl.textContent || '').trim() : '',
      topReasonsText: topReasonsEl ? (topReasonsEl.textContent || '').trim() : '',
    };
  });
}
function parseSessionSecondary(secondaryText) {
  const clearedMatch = secondaryText.match(/Cleared:\s*(\d+)/);
  const invalidatedMatch = secondaryText.match(/Invalidated:\s*(\d+)/);
  return { cleared: clearedMatch ? parseInt(clearedMatch[1], 10) : null, invalidated: invalidatedMatch ? parseInt(invalidatedMatch[1], 10) : null };
}

async function main() {
  // ── PART 8 (ENV-B2) — Browser detection: env var -> bundled ->
  // common system paths, in that order. Never downloads a Browser
  // binary. When unavailable, the results JSON is NEVER regenerated —
  // this suite exits honestly before any test runs. ──
  const pkg = await detectPlaywrightPackage();
  if (pkg.status !== 'PLAYWRIGHT_PACKAGE_AVAILABLE') {
    console.log(`Playwright Node package unavailable: ${pkg.error}`);
    console.log('Final decision: PLAYWRIGHT_PACKAGE_UNAVAILABLE');
    console.log('qa/epic-2e-j-phase-c-step7b-b-results.json was NOT regenerated (honest environment-blocked exit).');
    process.exit(0);
  }
  const { chromium } = pkg.mod;
  const browserDetect = await detectBrowserExecutable(chromium);
  if (!browserDetect.found) {
    console.log(`No usable Browser executable found among ${browserDetect.attempts.length} candidates (never downloaded one): ${JSON.stringify(browserDetect.attempts)}`);
    console.log('Final decision: BROWSER_BINARY_UNAVAILABLE');
    console.log('qa/epic-2e-j-phase-c-step7b-b-results.json was NOT regenerated (honest environment-blocked exit).');
    process.exit(0);
  }

  const browser = await chromium.launch({ executablePath: browserDetect.found, args: REQUIRED_LAUNCH_ARGS });
  // FIX 7 (ENV-B2-F1): captured once, immediately after launch, so it
  // remains available for the bounded `environment` metadata block even
  // after the Browser is closed in the `finally` block below.
  const browserVersion = browser.version();
  // Built ONCE per project snapshot (PART 1 step 1) and shared by every
  // in-memory Page this suite opens (the main Page and Part 7's fresh
  // Page), instead of re-reading/re-scanning every project file twice.
  const appSnapshot = await buildLumixaAppSnapshot(PROJECT_ROOT);
  const consoleErrors = [];
  // FIX 2: resource-load failures (real HTTP status / real network
  // failure) tracked separately from console text, and NO LONGER
  // silently dropped for matching "Failed to load resource" — that text
  // match previously discarded evidence instead of using it.
  const resourceErrors = [];

  // FIX 2: install pageerror/console/response/requestfailed listeners
  // BEFORE navigation, on every page this suite opens. A console.error
  // is only excused from counting when it can be CONCLUSIVELY tied to
  // an allowed Google Fonts host via the isAllowedExternalFontUrl()
  // allowlist parsed out of the message text itself — never by broadly
  // matching the phrase "Failed to load resource" against arbitrary
  // console text, which could hide a genuine same-origin asset failure
  // behind a font-shaped excuse. The authoritative source of truth for
  // "was this actually a font request" is the real response/
  // requestfailed URL, not the console text.
  function extractUrlFromText(text) {
    const m = typeof text === 'string' ? text.match(/https?:\/\/\S+/) : null;
    return m ? m[0].replace(/[)\]},.;'"]+$/, '') : null;
  }
  function attachErrorListeners(p, context) {
    p.on('pageerror', (e) => consoleErrors.push({ context, type: 'pageerror', error: String(e) }));
    p.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      const urlInText = extractUrlFromText(text);
      if (urlInText && isAllowedExternalFontUrl(urlInText)) return; // conclusively an allowed Google Fonts host
      consoleErrors.push({ context, type: 'console.error', text });
    });
    p.on('response', (res) => {
      if (res.status() < 400) return;
      if (isAllowedExternalFontUrl(res.url())) return;
      resourceErrors.push({ context, url: res.url(), status: res.status() });
    });
    p.on('requestfailed', (req) => {
      if (isAllowedExternalFontUrl(req.url())) return;
      resourceErrors.push({ context, url: req.url(), reason: req.failure()?.errorText ?? 'unknown' });
    });
  }

  let mainRuntime = null;
  let part7Runtime = null;
  // FIX 7 (ENV-B2-F1): hoisted so these remain available for the
  // bounded `environment` metadata block after the try/finally below.
  let storageKeysAtReady = null;
  let privacyRisk = null;
  let mainPageUrl = null;
  try {
    // ══════════════════════════════════════════════════════════════
    // PART 1 — Reach Ready through the real application (no forced state).
    // Loaded via the Navigation-Free In-Memory Harness — the only
    // navigation target is "about:blank?qa=1", never localhost.
    // ══════════════════════════════════════════════════════════════
    mainRuntime = await openLumixaInMemoryPage({
      browser,
      projectRoot: PROJECT_ROOT,
      qaQuery: '?qa=1',
      viewport: { width: 1440, height: 1400 },
      prebuiltApp: appSnapshot,
    });
    const page = mainRuntime.page;
    attachErrorListeners(page, 'main');
    await installStep7bbTestUtils(page); // FIX 4 (ENV-B2-F1): persistent Focus identity + real focusable-order computation, installed once, reused throughout

    record('ENV-B2 PART 1/5-7: In-Memory runtime storage compatibility for the main Page (native accessible or shim installed, verified before app load)', mainRuntime.storageAccessVerified ? 'PASS' : 'FAIL', `storageStatus=${mainRuntime.storageStatus}, nativeStorageAvailable=${mainRuntime.nativeStorageAvailable}, storageAccessVerified=${mainRuntime.storageAccessVerified}`);
    record('ENV-B2 PART 7: window.localStorage/sessionStorage are read-only Window properties (a replacement assignment never silently replaces the object; a strict-mode throw is also acceptable evidence)', mainRuntime.readOnlyCheck.localStorageReadOnly && mainRuntime.readOnlyCheck.sessionStorageReadOnly && mainRuntime.readOnlyCheck.localIdentityPreserved && mainRuntime.readOnlyCheck.sessionIdentityPreserved ? 'PASS' : 'FAIL', JSON.stringify(mainRuntime.readOnlyCheck));

    await page.waitForTimeout(600);
    const { completed, snapshot } = await reachReady(page, 'neutral-balanced.png');
    record('Real application reaches Ready with Observation enabled', completed && snapshot?.observation?.enabled === true, `completed=${completed}, observationEnabled=${snapshot?.observation?.enabled}`);
    await page.evaluate(() => { const el = document.getElementById('interactivePreviewObservationSection'); if (el) el.scrollIntoView(); });
    await page.waitForTimeout(300);

    // ── PART 9 (ENV-B2) — real screenshot generation. ──
    await mkdir(SCREENSHOTS_DIR, { recursive: true });
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '01-ready-state.png') }).catch(() => {});

    // ── PART 6 (ENV-B2) — Storage privacy key detection. Key NAMES
    // only, never values. Theme ("dm") / language ("lang") writes
    // remain allowed; anything that looks like Observation/Session
    // persistence is flagged. ──
    storageKeysAtReady = await observeAppStorageKeys(page);
    privacyRisk = classifyStorageKeyPrivacyRisk(storageKeysAtReady.allKeys);
    record(
      'ENV-B2 PART 6: no Observation/Session/interactivePreview/ipo-shaped key appears in Storage at Ready state (Theme "dm" / Language "lang" writes are normal and allowed) — key NAMES only, never values',
      privacyRisk.safe ? 'PASS' : 'FAIL',
      `allKeys=${JSON.stringify(storageKeysAtReady.allKeys)}, flagged=${JSON.stringify(privacyRisk.flagged)}`
    );

    // ══════════════════════════════════════════════════════════════
    // PART 2 — Real keyboard navigation (actual Tab/Shift+Tab/Arrow/
    // Space presses — never `locator.focus()` as a Tab substitute).
    // ══════════════════════════════════════════════════════════════
    console.log('=== Keyboard navigation (real key presses) ===');

    // FIX 1/2 (ENV-B2-F2) — deterministic Tab entry into the
    // Observation radio group: the real preceding focusable Element
    // (outside both Observation roots), located via the spec-aware
    // focusable-order model (ROOT CAUSE 1: SUMMARY is now modeled as a
    // real Tab stop), is focused for setup only; the Radio group is
    // first reset to a known unchecked state through the real Clear
    // Observation UI; then exactly ONE real Tab press is the
    // acceptance action.
    const fix1Entry = await enterObservationRadioGroupDeterministically(page);
    record(
      'FIX 1/2 (ENV-B2-F2): deterministic Tab entry into the Observation radio group (Radio-group state reset through the real Clear Observation UI first, spec-aware real preceding focusable Element located and focused for setup only, exactly one real Tab press is the acceptance action, never .focus() on the radio itself, never .checked assignment)',
      fix1Entry.ok,
      JSON.stringify(fix1Entry)
    );

    // FIX 3 (ENV-B2-F2) — canonical independent Arrow-key scenario:
    // performs its OWN state reset + deterministic entry (never
    // inherits a checked Radio from any previous scenario), exercises
    // all four required Arrow-key names, and requires exactly one
    // Radio checked after EVERY Arrow action plus that every expected
    // Radio ID was genuinely visited.
    const fix2Arrow = await runIndependentArrowScenario(page);
    record(
      'FIX 3 (ENV-B2-F2): independent Arrow-key scenario — first Radio active after its OWN state reset + deterministic entry (never inherits the checked Radio from a previous scenario)',
      fix2Arrow.entry.ok,
      JSON.stringify(fix2Arrow.entry)
    );
    record(
      'FIX 3 (ENV-B2-F2): all four required Arrow-key names (ArrowDown, ArrowRight, ArrowUp, ArrowLeft) are exercised, and every expected Observation Radio ID (prefer-legacy, prefer-v2, no-visible-difference, unsure) is genuinely visited',
      fix2Arrow.allFourKeyNamesExercised && fix2Arrow.allExpectedVisited,
      JSON.stringify({ keySequence: fix2Arrow.keySequence, visitedIds: fix2Arrow.visitedIds, expectedIds: fix2Arrow.expectedIds })
    );
    record(
      'FIX 3 (ENV-B2-F2): exactly one Radio remains checked after EVERY individual Arrow action (not only at the end)',
      fix2Arrow.allExactlyOneChecked,
      JSON.stringify(fix2Arrow.steps)
    );

    // FIX 4/5/6 (ENV-B2-F2) — canonical Observation-selection + Reason
    // + Clear-button scenario. SUPERSEDES the prior ENV-B2-F1 "FIX 3"
    // scenario, which entered the Radio group but never SELECTED an
    // Observation — Reasons/Clear Observation stay disabled until
    // selected, so any bound computed beforehand was invalid evidence.
    // This is now the ONE canonical evidence source (FIX 7) for: first
    // Reason, Reason Space activation, Shift+Tab reversal, Clear
    // Reasons, Clear Observation, and Clear Session. The old hard-coded
    // 10-Tab loop, 25-Tab loop, non-identity Shift+Tab check, and
    // weak-identity no-trap loop that previously followed here are
    // removed; their historic Test names are mapped onto this
    // canonical scenario's evidence below instead of being computed
    // twice by unrelated ad hoc loops.
    const canonicalReasonClear = await runObservationSelectionReasonAndClearScenario(page);
    record(
      'FIX 4 (ENV-B2-F2): Observation genuinely selected via real Space activation before any Reason/Clear bound is computed (Prefer Legacy checked, exactly one Radio checked, Reason controls enabled, Clear Observation enabled)',
      canonicalReasonClear.selectionOk,
      JSON.stringify({ entryOk: canonicalReasonClear.entry.ok, afterSelect: canonicalReasonClear.afterSelect })
    );
    record(
      'FIX 4 (ENV-B2-F2): the real post-selection focusable order is OBSERVED (never assumed) to be Clear Observation -> first Reason -> remaining Reasons -> Clear Reasons -> Clear Session',
      canonicalReasonClear.observedOrderCorrect,
      JSON.stringify(canonicalReasonClear.postSelectOrder)
    );
    record(
      'FIX 6 (ENV-B2-F2): every Tab bound (Radio->first Reason, first Reason->Clear Session) is derived from the CURRENT post-selection focusable order — when a bound cannot be derived this fails closed (never a fallback-40-as-PASS)',
      canonicalReasonClear.boundsAllDerived,
      JSON.stringify({ boundToFirstReason: canonicalReasonClear.boundToFirstReason, boundReasonToClearSession: canonicalReasonClear.boundReasonToClearSession })
    );
    // Historic Test name, mapped to the canonical scenario's evidence.
    record('Tab exits radio group and reaches Reason checkboxes in DOM order', canonicalReasonClear.boundsAllDerived && canonicalReasonClear.reachedClearObs && canonicalReasonClear.reachedFirstReasonId !== null, `reachedClearObs=${canonicalReasonClear.reachedClearObs}, focusedId=${canonicalReasonClear.reachedFirstReasonId}`);
    // Historic Test name, mapped to the canonical scenario's evidence.
    record('Space toggles a Reason checkbox', canonicalReasonClear.reasonSpaceResult != null && canonicalReasonClear.reasonSpaceResult.reasonChecked === true, `id=${canonicalReasonClear.reasonSpaceResult?.reasonId}, checked=${canonicalReasonClear.reasonSpaceResult?.reasonChecked}`);
    // Historic Test names, mapped to the canonical scenario's evidence
    // (each ANDs in boundsAllDerived per FIX 6 — a fallback bound never
    // counts as PASS evidence even if the loop happened to reach the
    // target).
    record('Tab reaches Clear Reasons button', canonicalReasonClear.boundsAllDerived && canonicalReasonClear.reachedClearReasons, `reached=${canonicalReasonClear.reachedClearReasons}, sequence=${JSON.stringify(canonicalReasonClear.sequence)}`);
    record('Tab reaches Clear Observation button', canonicalReasonClear.boundsAllDerived && canonicalReasonClear.reachedClearObs, `reached=${canonicalReasonClear.reachedClearObs}, sequence=${JSON.stringify(canonicalReasonClear.sequence)}`);
    record('Tab reaches Clear Session button', canonicalReasonClear.boundsAllDerived && canonicalReasonClear.reachedClearSession, `reached=${canonicalReasonClear.reachedClearSession}, sequence=${JSON.stringify(canonicalReasonClear.sequence)}`);
    // FIX 5 (ENV-B2-F2) — historic Test name 'Shift+Tab reverses
    // navigation', now an identity-based exact-return proof (never
    // merely "the ID changed") — the required Shift+Tab assertion.
    record(
      'FIX 5 (ENV-B2-F2): Shift+Tab from the first Reason returns Focus to the EXACT previous Element (persistent identity comparison, never only an ID or tagName)',
      canonicalReasonClear.reasonSpaceResult != null && canonicalReasonClear.reasonSpaceResult.shiftTabReturnsToExactPreviousElement === true,
      JSON.stringify(canonicalReasonClear.reasonSpaceResult)
    );

    // No keyboard trap: Tab forward past Clear Session must keep
    // advancing focus (never get stuck repeating the exact same
    // Element), for several consecutive presses. Uses the same
    // persistent-identity utility as every other Focus comparison in
    // this suite (never a weaker tagName/child-index description).
    await page.evaluate(() => document.getElementById('ipoClearSessionButton')?.focus()); // setup only, not activation proof
    let noTrapDetected = true;
    let previousIdentity = null;
    const visitedIdentities = [];
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Tab');
      const identity = await page.evaluate(() => window.__step7bbTestUtils.identify(document.activeElement));
      visitedIdentities.push(identity);
      if (previousIdentity !== null && identity === previousIdentity) { noTrapDetected = false; break; }
      previousIdentity = identity;
    }
    record('No keyboard trap after Clear Session (focus keeps advancing, proven via persistent Element identity)', noTrapDetected, `sequence=${JSON.stringify(visitedIdentities)}`);

    // Five-Reason limit: sixth reason disabled, selected ones remain removable.
    await page.evaluate(() => { const el = document.getElementById('ipoOption_prefer-legacy'); if (el) el.click(); });
    await page.waitForTimeout(150);
    const clearReasonsBtnEnabled = await page.evaluate(() => document.getElementById('ipoClearReasonsButton') && !document.getElementById('ipoClearReasonsButton').disabled);
    if (clearReasonsBtnEnabled) { await page.click('#ipoClearReasonsButton'); await page.waitForTimeout(150); }
    const reasonIds = ['skin-tone', 'white-balance', 'highlight-detail', 'shadow-detail', 'contrast'];
    for (const r of reasonIds) {
      const alreadyChecked = await page.evaluate((rid) => document.getElementById(`ipoReason_${rid}`)?.checked === true, r);
      if (!alreadyChecked) await page.click(`#ipoReason_${r}`);
    }
    await page.waitForTimeout(150);
    const sixthDisabled = await page.evaluate(() => document.getElementById('ipoReason_color-balance')?.disabled === true);
    record('Disabled sixth Reason cannot be toggled at five-Reason limit', sixthDisabled, `disabled=${sixthDisabled}`);
    const firstStillRemovable = await page.evaluate(() => { const el = document.getElementById('ipoReason_skin-tone'); const before = el.checked; el.click(); const after = el.checked; return before === true && after === false; });
    record('Selected Reasons remain removable at the five-Reason limit', firstStillRemovable, `removable=${firstStillRemovable}`);
    await page.click('#ipoClearButton');
    await page.waitForTimeout(150);

    // ══════════════════════════════════════════════════════════════
    // PART 3 — Focus validation across all controls.
    // ══════════════════════════════════════════════════════════════
    console.log('=== Focus validation ===');
    await page.click('#ipoOption_prefer-legacy');
    await page.waitForTimeout(150);
    const focusTargets = ['ipoOption_prefer-legacy', 'ipoOption_prefer-v2', 'ipoOption_no-visible-difference', 'ipoOption_unsure',
      'ipoReason_skin-tone', 'ipoReason_white-balance', 'ipoReason_highlight-detail', 'ipoReason_shadow-detail', 'ipoReason_contrast',
      'ipoReason_color-balance', 'ipoReason_saturation', 'ipoReason_natural-look', 'ipoReason_clarity-detail', 'ipoReason_no-specific-reason',
      'ipoClearButton', 'ipoClearReasonsButton', 'ipoClearSessionButton'];
    const radioOrCheckboxIds = new Set(focusTargets.filter((id) => id.startsWith('ipoOption_') || id.startsWith('ipoReason_')));
    let allFocusVisible = true;
    const focusFailures = [];
    for (const id of focusTargets) {
      const elExists = await page.evaluate((elId) => !!document.getElementById(elId), id);
      if (!elExists) continue;
      const isDisabled = await page.evaluate((elId) => document.getElementById(elId)?.disabled === true, id);
      if (isDisabled) continue; // a genuinely disabled control cannot receive focus at all — not a focus-indicator defect
      if (radioOrCheckboxIds.has(id) && id.startsWith('ipoOption_')) {
        // Native radio groups use roving tabindex — Tab only ever
        // focuses the CHECKED radio. Click to select it first, so the
        // subsequent keyboard focus check targets a genuinely
        // Tab-reachable element (never fabricating focus via .focus()
        // alone as proof).
        await page.click(`#${id}`);
        await page.waitForTimeout(80);
      } else {
        await page.evaluate((elId) => document.getElementById(elId)?.focus({ preventScroll: true }), id);
        await page.keyboard.press('Shift+Tab');
        await page.keyboard.press('Tab');
      }
      const info = await page.evaluate((elId) => {
        const target = document.getElementById(elId);
        // The real CSS rule targets the enclosing <label> via
        // `label:focus-within` for radios/checkboxes, and the control
        // itself via `:focus-visible` for buttons — check the element
        // that actually receives the visible outline in each case.
        const styledEl = target.closest('label') || target;
        const style = getComputedStyle(styledEl);
        const outlineWidth = parseFloat(style.outlineWidth) || 0;
        const outlineStyle = style.outlineStyle;
        const boxShadow = style.boxShadow;
        const hasVisibleIndicator = (outlineWidth > 0 && outlineStyle !== 'none') || (boxShadow && boxShadow !== 'none');
        return { isFocused: document.activeElement === target, hasVisibleIndicator, outlineWidth, outlineStyle };
      }, id);
      if (!info.isFocused || !info.hasVisibleIndicator) { allFocusVisible = false; focusFailures.push({ id, ...info }); }
    }
    record('All interactive controls show a visible, non-zero focus indicator', allFocusVisible, allFocusVisible ? 'all pass' : JSON.stringify(focusFailures));

    // ══════════════════════════════════════════════════════════════
    // PART 4 — Accessibility structure + ARIA.
    // ══════════════════════════════════════════════════════════════
    console.log('=== Accessibility structure + ARIA ===');
    const structureCheck = await page.evaluate(() => {
      const findings = [];
      const obsFieldset = document.getElementById('ipoFieldset');
      const reasonFieldset = document.getElementById('ipoReasonFieldset');
      if (!obsFieldset || obsFieldset.tagName !== 'FIELDSET') findings.push('Observation is not a <fieldset>');
      if (!obsFieldset?.querySelector('legend')) findings.push('Observation fieldset missing <legend>');
      if (!reasonFieldset || reasonFieldset.tagName !== 'FIELDSET') findings.push('Reason group is not a <fieldset>');
      if (!reasonFieldset?.querySelector('legend')) findings.push('Reason fieldset missing <legend>');

      const radios = Array.from(document.querySelectorAll('input[name="ipoObservation"]'));
      if (radios.length !== 4 || radios.some((r) => r.type !== 'radio')) findings.push('Observation radios are not exactly 4 native radio inputs');
      const checkboxes = Array.from(document.querySelectorAll('input[name="ipoReason"]'));
      if (checkboxes.length !== 10 || checkboxes.some((c) => c.type !== 'checkbox')) findings.push('Reason checkboxes are not exactly 10 native checkbox inputs');

      const allInputs = [...radios, ...checkboxes];
      const unlabeled = allInputs.filter((inp) => !inp.closest('label') && !inp.labels?.length && !document.querySelector(`label[for="${inp.id}"]`));
      if (unlabeled.length > 0) findings.push(`${unlabeled.length} input(s) without an associated label`);

      const allIds = Array.from(document.querySelectorAll('[id]')).map((e) => e.id);
      if (new Set(allIds).size !== allIds.length) findings.push('Duplicate element IDs found');

      const clearBtns = ['ipoClearButton', 'ipoClearReasonsButton', 'ipoClearSessionButton'].map((id) => document.getElementById(id));
      const btnsWithoutAccessibleName = clearBtns.filter((b) => b && !(b.textContent.trim() || b.getAttribute('aria-label')));
      if (btnsWithoutAccessibleName.length > 0) findings.push(`${btnsWithoutAccessibleName.length} Clear button(s) without an accessible name`);

      // Invalid ARIA / broken aria-describedby.
      const describedByEls = Array.from(document.querySelectorAll('[aria-describedby]'));
      const brokenDescribedBy = describedByEls.filter((el) => !document.getElementById(el.getAttribute('aria-describedby')));
      if (brokenDescribedBy.length > 0) findings.push(`${brokenDescribedBy.length} element(s) with broken aria-describedby`);

      // Duplicate live-region ownership (same element id referenced by multiple aria-live announcers is fine; flag actual duplicate IDs on live regions).
      const liveRegions = Array.from(document.querySelectorAll('[aria-live]'));
      const liveRegionIds = liveRegions.map((el) => el.id).filter(Boolean);
      if (new Set(liveRegionIds).size !== liveRegionIds.length) findings.push('Duplicate aria-live region IDs');

      return { findings, radioCount: radios.length, checkboxCount: checkboxes.length, liveRegionCount: liveRegions.length };
    });
    record('Accessibility structure (fieldset/legend/native-inputs/labels/unique-IDs/accessible-names)', structureCheck.findings.length === 0, structureCheck.findings.length === 0 ? `radios=${structureCheck.radioCount}, checkboxes=${structureCheck.checkboxCount}, liveRegions=${structureCheck.liveRegionCount}` : JSON.stringify(structureCheck.findings));

    // ARIA-live behavior.
    const ariaLiveCheck = await page.evaluate(() => {
      const status = document.getElementById('ipoStatus');
      const reasonLimit = document.getElementById('ipoReasonLimit');
      const selectedReasonsList = document.querySelector('#ipoReasonFieldset [data-selected-reasons], #ipoFieldset ~ div');
      return {
        statusIsPolite: status ? status.getAttribute('aria-live') === 'polite' : null,
        reasonLimitLiveOrAbsent: reasonLimit ? (reasonLimit.getAttribute('aria-live') === 'polite' || reasonLimit.getAttribute('aria-live') === null) : true,
      };
    });
    record('Main Observation status uses polite live region', ariaLiveCheck.statusIsPolite === true, `statusIsPolite=${ariaLiveCheck.statusIsPolite}`);

    // ══════════════════════════════════════════════════════════════
    // PART 4B (Step 7B-B-F3-S) — Keyboard Activation, MutationObserver
    // Live-Region Audit, Announcement Bounds, and Side-Effect Isolation.
    // Real keyboard input (Tab/Shift+Tab/Arrow*/Space/Enter) is the ONLY
    // accepted proof of navigation/activation throughout this section.
    // Every `.focus()`/`page.evaluate(...focus...)` call below is used
    // SOLELY to establish a known starting point for setup — never as
    // activation/reachability proof — and is labeled "(setup/cleanup
    // only, not activation proof)" at each use. Side-effect
    // instrumentation (Canvas + Slider + Analysis generation) is
    // installed once here and read back at the end of this section.
    // ══════════════════════════════════════════════════════════════
    console.log('=== Keyboard Activation, ARIA-Live Runtime, and Side-Effect Isolation (Step 7B-B-F3-S) ===');
    const f3GenAtStart = await qaSnapshot(page).then((s) => s?.analysisGeneration ?? null);
    const f3SlidersAtStart = await snapshotSliderValues(page);
    await installCanvasInstrumentation(page);
    const f3AllCapturedLiveTexts = []; // aggregated for the Part 8 bounds check

    // ── F3-S PART 6 — extended ARIA-live structure ──────────────────
    console.log('--- Part 6: ARIA-live structure ---');
    const ariaStructureF3 = await page.evaluate(() => {
      const get = (id) => document.getElementById(id);
      const status = get('ipoStatus');
      const warning = get('ipoWarning');
      const reasonLimit = get('ipoReasonLimit');
      const reasonStatus = get('ipoReasonStatus');
      const sessionMetrics = get('ipoSessionMetrics');
      const sessionTopReasons = get('ipoSessionTopReasons');
      function hasLiveAncestor(el) {
        let cur = el;
        while (cur) { if (cur.hasAttribute && cur.hasAttribute('aria-live')) return true; cur = cur.parentElement; }
        return false;
      }
      return {
        statusExists: !!status, statusLive: status ? status.getAttribute('aria-live') : null,
        warningExists: !!warning, warningLive: warning ? warning.getAttribute('aria-live') : null,
        reasonLimitExists: !!reasonLimit, reasonLimitLive: reasonLimit ? reasonLimit.getAttribute('aria-live') : null,
        reasonStatusExists: !!reasonStatus, reasonStatusOwnLive: reasonStatus ? reasonStatus.getAttribute('aria-live') : null, reasonStatusHasLiveAncestor: reasonStatus ? hasLiveAncestor(reasonStatus) : null,
        sessionMetricsExists: !!sessionMetrics, sessionMetricsLive: sessionMetrics ? sessionMetrics.getAttribute('aria-live') : null, sessionMetricsHasLiveAncestor: sessionMetrics ? hasLiveAncestor(sessionMetrics) : null,
        sessionTopReasonsExists: !!sessionTopReasons, sessionTopReasonsLive: sessionTopReasons ? sessionTopReasons.getAttribute('aria-live') : null, sessionTopReasonsHasLiveAncestor: sessionTopReasons ? hasLiveAncestor(sessionTopReasons) : null,
      };
    });
    record('Part 6.1: #ipoStatus has aria-live="polite"', ariaStructureF3.statusExists && ariaStructureF3.statusLive === 'polite', JSON.stringify(ariaStructureF3));
    record('Part 6.2: #ipoWarning has aria-live="polite"', ariaStructureF3.warningExists && ariaStructureF3.warningLive === 'polite', `warningExists=${ariaStructureF3.warningExists}, warningLive=${ariaStructureF3.warningLive}`);
    record('Part 6.3: #ipoReasonLimit has aria-live="polite"', ariaStructureF3.reasonLimitExists && ariaStructureF3.reasonLimitLive === 'polite', `reasonLimitExists=${ariaStructureF3.reasonLimitExists}, reasonLimitLive=${ariaStructureF3.reasonLimitLive}`);
    record('Part 6.4: #ipoReasonStatus (ordinary Selected Reasons text) has no aria-live of its own and no live-region ancestor', ariaStructureF3.reasonStatusExists && ariaStructureF3.reasonStatusOwnLive === null && ariaStructureF3.reasonStatusHasLiveAncestor === false, `reasonStatusExists=${ariaStructureF3.reasonStatusExists}, ownLive=${ariaStructureF3.reasonStatusOwnLive}, hasLiveAncestor=${ariaStructureF3.reasonStatusHasLiveAncestor}`);
    record('Part 6.5: #ipoSessionMetrics has no aria-live of its own and no live-region ancestor (no documented bounded reason exists for it to be a live region)', ariaStructureF3.sessionMetricsExists && ariaStructureF3.sessionMetricsLive === null && ariaStructureF3.sessionMetricsHasLiveAncestor === false, `sessionMetricsExists=${ariaStructureF3.sessionMetricsExists}, sessionMetricsLive=${ariaStructureF3.sessionMetricsLive}, sessionMetricsHasLiveAncestor=${ariaStructureF3.sessionMetricsHasLiveAncestor}`);
    record('Part 6.6: #ipoSessionTopReasons has no aria-live of its own and no live-region ancestor (no documented bounded reason exists for it to be a live region)', ariaStructureF3.sessionTopReasonsExists && ariaStructureF3.sessionTopReasonsLive === null && ariaStructureF3.sessionTopReasonsHasLiveAncestor === false, `sessionTopReasonsExists=${ariaStructureF3.sessionTopReasonsExists}, sessionTopReasonsLive=${ariaStructureF3.sessionTopReasonsLive}, sessionTopReasonsHasLiveAncestor=${ariaStructureF3.sessionTopReasonsHasLiveAncestor}`);

    // ── Stable starting state (cleanup only, not activation proof) ──
    await safeClickIfEnabled(page, 'ipoClearSessionButton');
    await page.waitForTimeout(120);
    await safeClickIfEnabled(page, 'ipoClearReasonsButton');
    await page.waitForTimeout(100);
    await safeClickIfEnabled(page, 'ipoClearButton');
    await page.waitForTimeout(100);

    // ── F3-S PART 1 — real Tab order, full ID sequence recorded ─────
    console.log('--- Part 1: real Tab order ---');
    // FIX 7 (ENV-B2-F2): this section now reuses the SAME canonical
    // scenario functions as PART 2 above — never a separate ad hoc
    // Tab-loop implementation — as a fresh, independent re-run at this
    // later point in the suite (after Canvas instrumentation + ARIA-
    // live structure checks). The historic Part 1.1-1.8 Test names are
    // mapped onto this one canonical evidence source instead of being
    // computed twice by unrelated hard-coded loops (the old 10-Tab and
    // 20/25-Tab loops that used to live here are gone).
    const f3Entry = await enterObservationRadioGroupDeterministically(page);
    record('Part 1.1 / FIX 1/2 (ENV-B2-F2): Tab enters the Observation radio group via deterministic entry (Radio-group state reset through the real Clear Observation UI first, spec-aware real preceding focusable Element, exactly one real Tab press)', f3Entry.ok, JSON.stringify(f3Entry));

    const f3Arrow = await runIndependentArrowScenario(page);
    record('Part 1.2 / FIX 3 (ENV-B2-F2): all four required Arrow-key names are exercised and every expected Observation Radio ID is genuinely visited', f3Arrow.allFourKeyNamesExercised && f3Arrow.allExpectedVisited, JSON.stringify({ keySequence: f3Arrow.keySequence, visitedIds: f3Arrow.visitedIds, expectedIds: f3Arrow.expectedIds }));
    record('Part 1.3 / FIX 3 (ENV-B2-F2): exactly one Radio remains checked after EVERY individual Arrow action', f3Arrow.allExactlyOneChecked, JSON.stringify(f3Arrow.steps));

    const f3ReasonClear = await runObservationSelectionReasonAndClearScenario(page);
    record('Part 1.4/1.5 / FIX 4 (ENV-B2-F2): Observation genuinely selected via real Space activation, and Tab exits the Radio group to reach Reason checkboxes in the real (observed, never assumed) DOM order', f3ReasonClear.selectionOk && f3ReasonClear.reachedFirstReasonId !== null, `selectionOk=${f3ReasonClear.selectionOk}, firstReasonId=${f3ReasonClear.reachedFirstReasonId}`);
    record('FIX 4 (ENV-B2-F2): the first Reason reached via Tab matches the ACTUAL expected first DOM Reason (queried directly, never assumed)', f3ReasonClear.firstReasonMatchesExpected, `expectedFirstReasonId=${f3ReasonClear.expectedFirstReasonId}, actualFirstReasonId=${f3ReasonClear.reachedFirstReasonId}`);
    record('Part 1.6 / FIX 5 (ENV-B2-F2): Shift+Tab reverses navigation', f3ReasonClear.reasonSpaceResult != null && f3ReasonClear.reasonSpaceResult.afterShiftTabIdentity !== f3ReasonClear.reasonSpaceResult.reasonId, JSON.stringify(f3ReasonClear.reasonSpaceResult));
    record('FIX 5 (ENV-B2-F2): Shift+Tab returns to the EXACT expected previous Element (persistent identity comparison, recorded before advancing), not merely a different Element', f3ReasonClear.reasonSpaceResult != null && f3ReasonClear.reasonSpaceResult.shiftTabReturnsToExactPreviousElement === true, JSON.stringify(f3ReasonClear.reasonSpaceResult));
    record('Part 1.7 / FIX 6 (ENV-B2-F2): Tab reaches Clear Reasons, Clear Observation, and Clear Session within a bound derived from the CURRENT post-selection focusable order (fails closed when not derivable, never a fallback-40-as-PASS)', f3ReasonClear.boundsAllDerived && f3ReasonClear.reachedClearReasons && f3ReasonClear.reachedClearObs && f3ReasonClear.reachedClearSession, `boundsAllDerived=${f3ReasonClear.boundsAllDerived}, reachedClearReasons=${f3ReasonClear.reachedClearReasons}, reachedClearObs=${f3ReasonClear.reachedClearObs}, reachedClearSession=${f3ReasonClear.reachedClearSession}`);

    const f3FullTabSequence = [f3Entry.actualAfterTabIdentity, ...f3Arrow.steps.map((s) => `${s.key}->${s.activeId}`), ...f3ReasonClear.sequence];

    // FIX 9 (Step 7B-B-F3-S2) — no-trap detection is strengthened beyond
    // "same ID three times": it also detects a period-2 (two-Element)
    // cycle (A,B,A,B,...). Step 7B-B-F3-S3 FIX 7 — section-exit is now
    // determined by ACTUAL DOM containment (Node.contains / .closest())
    // against the two REAL section roots (#interactivePreviewObservationInner,
    // #interactivePreviewObservationSessionInner), never by an ID-prefix
    // heuristic: an Element inside either section whose id does not
    // happen to start with "ipo" must never be mistaken for a real exit.
    let f3NoTrap = true;
    let f3TrapReason = null;
    // FIX 7 (Step 7B-B-F3-S3) — containment is captured INLINE, on the
    // live document.activeElement, at the exact moment it is focused —
    // never reconstructed afterward via getElementById(id) (which would
    // silently fail for focusable Elements with no id). Each captured
    // entry carries both its label (id, or tagName when no id exists)
    // AND real Node.contains()-based containment against the two actual
    // section roots (#interactivePreviewObservationInner,
    // #interactivePreviewObservationSessionInner) — never an ID-prefix
    // heuristic.
    // FIX 4 (ENV-B2-F1): the tagName-only fallback previously used here
    // conflated distinct anonymous (id-less) Elements sharing the same
    // tagName, corrupting period-1/period-2 trap-cycle detection.
    // Replaced with the shared window.__step7bbTestUtils.identify()
    // (installed once via installStep7bbTestUtils(page) at Page
    // setup), which assigns each real DOM Element a persistent, unique
    // sequential identity via a Window-scoped WeakMap<Element, number>,
    // formatted as e.g. "BUTTON#focus-node-17" (or element.id when
    // present) — so distinct anonymous Elements are never confused.
    const f3CaptureContainment = () => page.evaluate(() => {
      const obsRoot = document.getElementById('interactivePreviewObservationInner');
      const sessionRoot = document.getElementById('interactivePreviewObservationSessionInner');
      const activeEl = document.activeElement;
      const label = window.__step7bbTestUtils.identify(activeEl);
      const insideObs = !!(obsRoot && activeEl && obsRoot.contains(activeEl));
      const insideSession = !!(sessionRoot && activeEl && sessionRoot.contains(activeEl));
      return { label, insideObs, insideSession, obsRootExists: !!obsRoot, sessionRootExists: !!sessionRoot };
    });
    const f3TrapSequence = [];
    const f3ContainmentSequence = [];
    const first = await f3CaptureContainment();
    f3TrapSequence.push(first.label);
    f3ContainmentSequence.push(first);
    for (let i = 0; i < 14; i++) {
      await page.keyboard.press('Tab');
      const cap = await f3CaptureContainment();
      f3TrapSequence.push(cap.label);
      f3ContainmentSequence.push(cap);
      f3FullTabSequence.push(cap.label);
    }
    for (let i = 2; i < f3TrapSequence.length; i++) {
      if (f3TrapSequence[i] === f3TrapSequence[i - 1] && f3TrapSequence[i - 1] === f3TrapSequence[i - 2]) { f3NoTrap = false; f3TrapReason = `period-1 cycle (same Element repeated) at index ${i}`; break; }
    }
    if (f3NoTrap) {
      for (let i = 3; i < f3TrapSequence.length; i++) {
        if (f3TrapSequence[i] === f3TrapSequence[i - 2] && f3TrapSequence[i - 1] === f3TrapSequence[i - 3] && f3TrapSequence[i] !== f3TrapSequence[i - 1]) { f3NoTrap = false; f3TrapReason = `period-2 cycle (two-Element trap: ${f3TrapSequence[i - 1]} <-> ${f3TrapSequence[i]}) at index ${i}`; break; }
      }
    }
    // FIX 7 — an Element counts as "outside both sections" only when
    // real DOM containment proves it is NOT inside #interactivePreviewObservationInner
    // AND NOT inside #interactivePreviewObservationSessionInner — an
    // Element that merely lacks an "ipo"-prefixed id, but is still
    // physically contained within one of the two section roots, must
    // never be mistaken for successful exit.
    const f3ReachedOutsideElement = f3ContainmentSequence.some((c) => c.insideObs === false && c.insideSession === false);
    const f3RootsExist = f3ContainmentSequence.every((c) => c.obsRootExists && c.sessionRootExists);
    if (f3NoTrap && !f3ReachedOutsideElement) { f3NoTrap = false; f3TrapReason = 'focus never left either section (no Element found NOT contained by #interactivePreviewObservationInner or #interactivePreviewObservationSessionInner via real DOM containment)'; }
    record('Part 1.8 / FIX 9 / FIX 7 (F3-S3): no keyboard trap detected — focus eventually reaches a real Element outside BOTH section roots (proven via Node.contains DOM containment, not an ID-prefix heuristic), with no period-1 or period-2 (two-Element) cycle', f3NoTrap && f3RootsExist, `sequence=${JSON.stringify(f3TrapSequence)}, reachedOutsideElement=${f3ReachedOutsideElement}, containmentSequence=${JSON.stringify(f3ContainmentSequence)}, rootsExist=${f3RootsExist}, trapReason=${f3TrapReason}`);
    record('Part 1: full recorded activeElement ID sequence (evidence)', f3FullTabSequence.length > 0, `fullTabSequence=${JSON.stringify(f3FullTabSequence)}`);

    // ── F3-S PART 2 — Clear Reasons keyboard activation (Enter) ─────
    console.log('--- Part 2: Clear Reasons keyboard activation ---');
    await safeClickIfEnabled(page, 'ipoClearReasonsButton'); // setup/cleanup only, not activation proof
    await page.waitForTimeout(100);
    await page.evaluate(() => { const el = document.getElementById('ipoOption_prefer-legacy'); if (el) el.click(); }); // setup only
    await page.waitForTimeout(100);
    for (const r of ['skin-tone', 'contrast']) {
      const already = await page.evaluate((rid) => document.getElementById(`ipoReason_${rid}`)?.checked === true, r);
      if (!already) await page.click(`#ipoReason_${r}`); // setup only
    }
    await page.waitForTimeout(150);

    const p2GenBefore = await qaSnapshot(page).then((s) => s?.analysisGeneration ?? null);
    const p2SlidersBefore = await snapshotSliderValues(page);

    // Setup/cleanup only, not activation proof: establishes a known
    // starting point before the real Tab-navigation acceptance proof.
    await page.evaluate(() => document.getElementById('ipoOption_prefer-legacy')?.focus());
    const p2Sequence = [];
    const p2Reached = await tabTo(page, 'ipoClearReasonsButton', 15, p2Sequence);
    record('Part 2.1: real Tab navigation reaches #ipoClearReasonsButton (never .click() as activation proof)', p2Reached, `sequence=${JSON.stringify(p2Sequence)}`);

    await page.keyboard.press('Enter');
    await page.waitForTimeout(150);

    const p2AllReasonsCleared = await page.evaluate(() => Array.from(document.querySelectorAll('input[name="ipoReason"]')).every((c) => c.checked === false));
    const p2ObservationStillLegacy = await page.evaluate(() => document.getElementById('ipoOption_prefer-legacy')?.checked === true);
    const p2ReasonStatusText = await page.evaluate(() => (document.getElementById('ipoReasonStatus')?.textContent || '').trim());
    const p2Session = await readSessionMetricsText(page);
    const p2GenAfter = await qaSnapshot(page).then((s) => s?.analysisGeneration ?? null);
    const p2SlidersAfter = await snapshotSliderValues(page);

    const p2ParsedSession = parseSessionSummary(p2Session.lines);
    record('Part 2.2: Enter on #ipoClearReasonsButton clears all Reason checkboxes', p2AllReasonsCleared, `allCleared=${p2AllReasonsCleared}`);
    record('Part 2.3: Observation remains Prefer Legacy after Clear Reasons', p2ObservationStillLegacy, `stillLegacy=${p2ObservationStillLegacy}`);
    record('Part 2.4: Session active Observation remains present (Observed count > 0)', p2Session.lines.some((l) => /^Observed:\s*[1-9]/.test(l)), `lines=${JSON.stringify(p2Session.lines)}`);
    record('Part 2.5: Reason counts (Selected Reasons text) clear after Clear Reasons', p2ReasonStatusText === '', `reasonStatusText="${p2ReasonStatusText}"`);
    record('FIX 9: Clear Reasons leaves activeObservationsDerived === 1 (the Observation itself remains active; only Reasons were cleared)', p2ParsedSession.activeObservationsDerived === 1, JSON.stringify(p2ParsedSession));
    record('FIX 9: Session Top Reasons / Reason counts are empty after Clear Reasons (checked directly, not merely inferred from the ordinary Selected Reasons text being empty)', p2Session.topReasonsText === '', `topReasonsText="${p2Session.topReasonsText}"`);
    record('Part 2.6: no Analysis rerun during Clear Reasons keyboard activation', p2GenAfter === p2GenBefore, `before=${p2GenBefore}, after=${p2GenAfter}`);
    record('Part 2.7: no Slider movement during Clear Reasons keyboard activation', slidersUnchanged(p2SlidersBefore, p2SlidersAfter), `before=${JSON.stringify(p2SlidersBefore)}, after=${JSON.stringify(p2SlidersAfter)}`);

    // ── F3-S PART 3 — Clear Observation keyboard activation (Space) ─
    // FIX 5 (ENV-B2-F1): Session counts Cleared at most once per
    // generation (a sticky `clearedCounted` flag prevents double-count
    // when the same cleared generation is activated again). The
    // previous version of this scenario asserted a relative "+1"
    // increment from a baseline inherited from earlier Parts, which is
    // not a safe assumption once a sticky per-generation cap exists.
    // Rebuilt per FIX 5's exact deterministic spec: (1) ensure a valid
    // Observation is selected, (2) Clear Session as isolated setup —
    // this yields a known Cleared=0 baseline while leaving the current
    // valid Observation checked and immediately re-recorded, (3)
    // verify activeObservationsDerived===1 && cleared===0 BEFORE the
    // tested action, (4) reach Clear Observation via real Tab (bound
    // derived from the real focusable order), (5) activate with Space,
    // (6) verify activeObservationsDerived===0 && cleared===1, (7)
    // press activation again, verify cleared remains 1. This does not
    // change Session Production semantics and does not expect more
    // than one Cleared event per generation.
    console.log('--- Part 3: Clear Observation keyboard activation ---');
    await page.evaluate(() => { const el = document.getElementById('ipoOption_prefer-legacy'); if (el) el.click(); }); // setup only: ensure a valid Observation is selected
    await page.waitForTimeout(100);
    for (const r of ['skin-tone', 'contrast']) {
      const already = await page.evaluate((rid) => document.getElementById(`ipoReason_${rid}`)?.checked === true, r);
      if (!already) await page.click(`#ipoReason_${r}`); // setup only
    }
    await page.waitForTimeout(150);

    await safeClickIfEnabled(page, 'ipoClearSessionButton'); // setup only: establishes a known Cleared=0 baseline for this isolated scenario
    await page.waitForTimeout(150);

    // Clear Session leaves the current valid Observation checked and
    // immediately re-records it (see Part 4.3/4.5 below); re-select it
    // explicitly here too, since this scenario's baseline must not
    // depend on incidental state carried over from a different Part.
    await page.evaluate(() => { const el = document.getElementById('ipoOption_prefer-legacy'); if (el) el.click(); }); // setup only
    await page.waitForTimeout(100);
    for (const r of ['skin-tone', 'contrast']) {
      const already = await page.evaluate((rid) => document.getElementById(`ipoReason_${rid}`)?.checked === true, r);
      if (!already) await page.click(`#ipoReason_${r}`); // setup only
    }
    await page.waitForTimeout(150);

    const p3SessionBaseline = await readSessionMetricsText(page);
    const p3ParsedBaseline = parseSessionSummary(p3SessionBaseline.lines);
    const p3SecondaryBaseline = parseSessionSecondary(p3SessionBaseline.secondaryText);
    record('Part 3.0 / FIX 5 (ENV-B2-F1): known baseline BEFORE the tested action — current Observation re-recorded and Cleared=0 (Clear Session used as isolated setup)', p3ParsedBaseline.activeObservationsDerived === 1 && p3SecondaryBaseline.cleared === 0, JSON.stringify({ parsed: p3ParsedBaseline, secondary: p3SecondaryBaseline }));

    const p3GenBefore = await qaSnapshot(page).then((s) => s?.analysisGeneration ?? null);
    const p3SlidersBefore = await snapshotSliderValues(page);

    // FIX 8 (ENV-B2-F2): Part 3 deliberately selects Prefer Legacy as
    // its OWN baseline setup above — the generic
    // enterObservationRadioGroupDeterministically() would reset that
    // selection away before this scenario even runs, destroying the
    // baseline just verified in Part 3.0. This variant instead supports
    // the CURRENTLY CHECKED Prefer Legacy Radio as the native
    // radio-group Tab stop (never resetting it), then a bound on the
    // subsequent Tab distance to #ipoClearButton derived from the real
    // focusable order (never a hard-coded 15).
    const p3Entry = await enterObservationRadioGroupWithCurrentSelection(page, 'ipoOption_prefer-legacy');
    record('Part 3.0b / FIX 8 (ENV-B2-F2): deterministic entry into the Observation radio group, supporting the currently checked Prefer Legacy Radio as the native Tab stop (never reset), before Part 3\'s tested action', p3Entry.ok, JSON.stringify(p3Entry));
    const p3Bound = await computeBoundedMaxTabs(page, p3Entry.targetId, 'ipoClearButton');
    const p3Sequence = [p3Entry.actualAfterTabIdentity];
    const p3Reached = await tabTo(page, 'ipoClearButton', p3Bound.maxTabs, p3Sequence);
    record('Part 3.1 / FIX 3 (ENV-B2-F1): real Tab navigation reaches #ipoClearButton within a bound derived from the real focusable-order distance (never a hard-coded 15) (never .click() as activation proof)', p3Reached, `sequence=${JSON.stringify(p3Sequence)}, maxTabs=${p3Bound.maxTabs}, bounds=${JSON.stringify(p3Bound.bounds)}`);

    await page.keyboard.press('Space');
    await page.waitForTimeout(150);

    const p3NoRadioChecked = await page.evaluate(() => Array.from(document.querySelectorAll('input[name="ipoObservation"]')).every((r) => r.checked === false));
    const p3AllReasonsClearedAfter = await page.evaluate(() => Array.from(document.querySelectorAll('input[name="ipoReason"]')).every((c) => c.checked === false));
    const p3SessionAfterFirst = await readSessionMetricsText(page);
    const p3ParsedAfterFirst = parseSessionSummary(p3SessionAfterFirst.lines);
    const p3ClearedAfterFirst = parseSessionSecondary(p3SessionAfterFirst.secondaryText).cleared;
    const p3GenAfterFirst = await qaSnapshot(page).then((s) => s?.analysisGeneration ?? null);
    const p3SlidersAfterFirst = await snapshotSliderValues(page);

    record('Part 3.2: no Observation Radio checked after Clear Observation', p3NoRadioChecked, `noneChecked=${p3NoRadioChecked}`);
    record('Part 3.3: all Reasons clear after Clear Observation', p3AllReasonsClearedAfter, `allCleared=${p3AllReasonsClearedAfter}`);
    record('Part 3.4 / FIX 5 (ENV-B2-F1): active Observation count becomes zero and Cleared becomes exactly 1, verified against the known 0/1 baseline established in Part 3.0 (never a relative "+1" assumption)', p3ParsedAfterFirst.activeObservationsDerived === 0 && p3ClearedAfterFirst === 1, JSON.stringify({ parsed: p3ParsedAfterFirst, clearedAfterFirst: p3ClearedAfterFirst }));
    record('Part 3.6: no Analysis rerun during Clear Observation keyboard activation', p3GenAfterFirst === p3GenBefore, `before=${p3GenBefore}, after=${p3GenAfterFirst}`);
    record('Part 3.7: no Slider movement during Clear Observation keyboard activation', slidersUnchanged(p3SlidersBefore, p3SlidersAfterFirst), `before=${JSON.stringify(p3SlidersBefore)}, after=${JSON.stringify(p3SlidersAfterFirst)}`);

    // Part 3.8 — pressing the activation key again must not increment
    // the Cleared count past 1 (the sticky `clearedCounted` flag caps
    // Cleared at most once per generation). Whatever currently has
    // focus receives a genuine second Space press (the button itself
    // becomes disabled once rawObservation is null, so it is naturally
    // no longer the active element — this is the real, honest
    // post-condition, not simulated).
    await page.keyboard.press('Space');
    await page.waitForTimeout(150);
    const p3SessionAfterSecond = await readSessionMetricsText(page);
    const p3ClearedAfterSecond = parseSessionSecondary(p3SessionAfterSecond.secondaryText).cleared;
    record('Part 3.8 / FIX 5 (ENV-B2-F1): pressing the activation key again does not increment Cleared past 1 (sticky clearedCounted flag)', p3ClearedAfterFirst === 1 && p3ClearedAfterSecond === 1, `afterFirst=${p3ClearedAfterFirst}, afterSecond=${p3ClearedAfterSecond}`);

    // ── F3-S PART 4 — Clear Session keyboard activation (Enter) ─────
    console.log('--- Part 4: Clear Session keyboard activation ---');
    await page.evaluate(() => { const el = document.getElementById('ipoOption_prefer-legacy'); if (el) el.click(); }); // setup only
    await page.waitForTimeout(100);
    for (const r of ['skin-tone', 'contrast']) {
      const already = await page.evaluate((rid) => document.getElementById(`ipoReason_${rid}`)?.checked === true, r);
      if (!already) await page.click(`#ipoReason_${r}`); // setup only
    }
    await page.waitForTimeout(150);
    // Ensure the Session contains historical records before Clear
    // Session (Part 3 above already produced at least one Cleared
    // record, and this reselection produces an active one).
    const p4SessionBeforeClear = await readSessionMetricsText(page);
    const p4SecondaryBeforeClear = parseSessionSecondary(p4SessionBeforeClear.secondaryText);
    record('Part 4 precondition: Session contains historical records before Clear Session', (p4SecondaryBeforeClear.cleared ?? 0) > 0, JSON.stringify(p4SecondaryBeforeClear));

    const p4GenBefore = await qaSnapshot(page).then((s) => s?.analysisGeneration ?? null);
    const p4SlidersBefore = await snapshotSliderValues(page);

    await page.evaluate(() => document.getElementById('ipoOption_prefer-legacy')?.focus()); // setup only
    // FIX 3 (ENV-B2-F1): bounded maximum derived from the real
    // focusable-order distance (never a hard-coded 20).
    const p4Bound = await computeBoundedMaxTabs(page, 'ipoOption_prefer-legacy', 'ipoClearSessionButton');
    const p4Sequence = [];
    const p4Reached = await tabTo(page, 'ipoClearSessionButton', p4Bound.maxTabs, p4Sequence);
    record('Part 4.1 / FIX 3 (ENV-B2-F1): real Tab navigation reaches #ipoClearSessionButton within a bound derived from the real focusable-order distance (never a hard-coded 20) (never .click() as activation proof)', p4Reached, `sequence=${JSON.stringify(p4Sequence)}, maxTabs=${p4Bound.maxTabs}, bounds=${JSON.stringify(p4Bound.bounds)}`);

    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);

    const p4SessionAfter = await readSessionMetricsText(page);
    const p4ParsedAfter = parseSessionSummary(p4SessionAfter.lines);
    const p4SecondaryAfter = parseSessionSecondary(p4SessionAfter.secondaryText);
    const p4CurrentObservationChecked = await page.evaluate(() => document.getElementById('ipoOption_prefer-legacy')?.checked === true);
    const p4CurrentReasonsChecked = await page.evaluate(() => document.getElementById('ipoReason_skin-tone')?.checked === true && document.getElementById('ipoReason_contrast')?.checked === true);
    const p4GenAfter = await qaSnapshot(page).then((s) => s?.analysisGeneration ?? null);

    record('Part 4.2: historical Cleared/Invalidated counts reset after Clear Session', p4SecondaryAfter.cleared === 0 && p4SecondaryAfter.invalidated === 0, JSON.stringify(p4SecondaryAfter));
    record('Part 4.3: current valid Observation (Prefer Legacy) remains checked after Clear Session', p4CurrentObservationChecked, `checked=${p4CurrentObservationChecked}`);
    record('Part 4.4: current Reasons (skin-tone, contrast) remain checked after Clear Session', p4CurrentReasonsChecked, `checked=${p4CurrentReasonsChecked}`);
    record('Part 4.5: the current Observation is immediately re-recorded (totalObserved=1, preferLegacy=1)', p4ParsedAfter.totalObserved === 1 && p4ParsedAfter.preferLegacy === 1, JSON.stringify(p4ParsedAfter));
    record('Part 4.6: activeObservations = 1 after Clear Session (derived from the real rendered per-category counts)', p4ParsedAfter.activeObservationsDerived === 1, JSON.stringify(p4ParsedAfter));
    record('Part 4.7: current Reason counts are present (Skin tone and Contrast appear in Top reasons)', p4SessionAfter.topReasonsText.includes('Skin tone') && p4SessionAfter.topReasonsText.includes('Contrast'), `topReasonsText="${p4SessionAfter.topReasonsText}"`);
    record('Part 4.8: Analysis generation does not change during Clear Session keyboard activation', p4GenAfter === p4GenBefore, `before=${p4GenBefore}, after=${p4GenAfter}`);
    const p4SlidersAfter = await snapshotSliderValues(page);
    record('Part 4.9: no Slider movement during Clear Session keyboard activation', slidersUnchanged(p4SlidersBefore, p4SlidersAfter), `before=${JSON.stringify(p4SlidersBefore)}, after=${JSON.stringify(p4SlidersAfter)}`);

    // ── F3-S PART 5 — five-Reason-limit keyboard behavior ───────────
    console.log('--- Part 5: five-Reason limit keyboard behavior ---');
    await safeClickIfEnabled(page, 'ipoClearReasonsButton'); // setup/cleanup only
    await page.waitForTimeout(100);
    await page.evaluate(() => { const el = document.getElementById('ipoOption_prefer-legacy'); if (el) el.click(); }); // setup only
    await page.waitForTimeout(100);

    const p5TargetReasonIds = ['skin-tone', 'white-balance', 'highlight-detail', 'shadow-detail', 'contrast'];
    await page.evaluate(() => document.getElementById('ipoOption_prefer-legacy')?.focus()); // setup only
    let p5TabGuard = 0;
    let p5SelectedCount = 0;
    while (p5SelectedCount < p5TargetReasonIds.length && p5TabGuard < 40) {
      await page.keyboard.press('Tab');
      p5TabGuard++;
      const id = await page.evaluate(() => document.activeElement.id);
      const bareId = id ? id.replace('ipoReason_', '') : null;
      if (id && id.startsWith('ipoReason_') && p5TargetReasonIds.includes(bareId)) {
        const already = await page.evaluate(() => document.activeElement.checked === true);
        if (!already) {
          await page.keyboard.press('Space'); // real keyboard activation, never Controller methods or .click()
          p5SelectedCount++;
        }
      }
    }
    const p5FiveSelected = await page.evaluate(() => Array.from(document.querySelectorAll('input[name="ipoReason"]')).filter((c) => c.checked).length === 5);
    record('Part 5.1: exactly five Reasons selected via real keyboard (Tab+Space)', p5FiveSelected, `selectedViaSpace=${p5SelectedCount}, tabPresses=${p5TabGuard}`);

    const p5SixthDisabled = await page.evaluate(() => document.getElementById('ipoReason_color-balance')?.disabled === true);
    record('Part 5.2: the sixth Reason (color-balance) is genuinely disabled', p5SixthDisabled, `disabled=${p5SixthDisabled}`);

    // Part 5.3/5.4 — attempt Space on the disabled sixth Reason through
    // the appropriate keyboard-navigation path (real Tab presses). A
    // genuinely `disabled` input is removed from the native Tab order
    // by the browser itself, so Tab cannot land real focus on it — this
    // loop proves that honestly (never fabricating focus), and if focus
    // somehow did land there, Space is still pressed and the checked
    // state is still verified.
    const p5Sequence = [];
    const p5ReachedDisabled = await tabTo(page, 'ipoReason_color-balance', 15, p5Sequence);
    if (p5ReachedDisabled) await page.keyboard.press('Space');
    const p5DisabledStillUnchecked = await page.evaluate(() => document.getElementById('ipoReason_color-balance')?.checked === false);
    const p5StillFiveSelected = await page.evaluate(() => Array.from(document.querySelectorAll('input[name="ipoReason"]')).filter((c) => c.checked).length === 5);
    record(
      'Part 5.3/5.4: the disabled sixth Reason cannot be toggled by Space (native disabled semantics remove it from Tab order; it remains unchecked and selection stays at exactly five)',
      !p5ReachedDisabled && p5DisabledStillUnchecked && p5StillFiveSelected,
      `reachedDisabledViaTab=${p5ReachedDisabled}, sequence=${JSON.stringify(p5Sequence)}, disabledStillUnchecked=${p5DisabledStillUnchecked}, stillFiveSelected=${p5StillFiveSelected}`
    );

    // Part 5.5/5.6/5.7 — navigate to an already-selected Reason and
    // press Space to remove it.
    await page.evaluate(() => document.getElementById('ipoOption_prefer-legacy')?.focus()); // setup only
    const p5RemoveSequence = [];
    const p5ReachedSkinTone = await tabTo(page, 'ipoReason_skin-tone', 20, p5RemoveSequence);
    if (p5ReachedSkinTone) await page.keyboard.press('Space');
    await page.waitForTimeout(120);
    const p5SkinToneRemoved = await page.evaluate(() => document.getElementById('ipoReason_skin-tone')?.checked === false);
    const p5FourSelected = await page.evaluate(() => Array.from(document.querySelectorAll('input[name="ipoReason"]')).filter((c) => c.checked).length === 4);
    const p5SixthReEnabled = await page.evaluate(() => document.getElementById('ipoReason_color-balance')?.disabled === false);
    record(
      'Part 5.5/5.6/5.7: navigating to a selected Reason and pressing Space removes it (selected count becomes four, previously disabled sixth Reason becomes enabled again)',
      p5ReachedSkinTone && p5SkinToneRemoved && p5FourSelected && p5SixthReEnabled,
      `reached=${p5ReachedSkinTone}, sequence=${JSON.stringify(p5RemoveSequence)}, removed=${p5SkinToneRemoved}, fourSelected=${p5FourSelected}, sixthReEnabled=${p5SixthReEnabled}`
    );

    // ── F3-S PART 7 — MutationObserver live-region audit (A-E) ──────
    // Step 7B-B-F3-S2 FIX 1 — Scenarios A and B each prepare their OWN
    // exact, deterministic Reason state through real UI controls,
    // verifying the resulting checked count at every step — neither
    // reuses whatever state Part 5 (or the other Scenario) left behind.
    console.log('--- Part 7: MutationObserver live-region audit ---');
    await installLiveRegionObservers(page);

    // Scenario A — deterministic state: exactly ONE ordinary Reason,
    // then exactly TWO (never five; independent of Part 5/Scenario B).
    const scenarioAReasons = ['saturation', 'natural-look'];
    await safeClickIfEnabled(page, 'ipoClearReasonsButton');
    await page.waitForTimeout(120);
    await page.click(`#ipoReason_${scenarioAReasons[0]}`);
    await page.waitForTimeout(100);
    const scenarioA_countAfterFirst = await page.evaluate(() => Array.from(document.querySelectorAll('input[name="ipoReason"]')).filter((c) => c.checked).length);
    record('Scenario A precondition 1: exactly one Reason selected before the audited action (deterministic setup, not reused from any previous Part)', scenarioA_countAfterFirst === 1, `count=${scenarioA_countAfterFirst}`);

    await resetLiveRegionAudit(page);
    await page.click(`#ipoReason_${scenarioAReasons[1]}`);
    await page.waitForTimeout(150);
    const scenarioA_countAfterSecond = await page.evaluate(() => Array.from(document.querySelectorAll('input[name="ipoReason"]')).filter((c) => c.checked).length);
    const scenarioA_limitInactive = await page.evaluate(() => (document.getElementById('ipoReasonLimit')?.textContent || '').trim() === '');
    record('Scenario A precondition 2: exactly two Reasons selected (never reaching five)', scenarioA_countAfterSecond === 2, `count=${scenarioA_countAfterSecond}`);
    record('Scenario A precondition 3: Reason limit remains inactive at two selected Reasons', scenarioA_limitInactive, `limitInactive=${scenarioA_limitInactive}`);

    const auditA_raw = await readAllLiveRegionAudits(page);
    const auditA_status = summarizeLiveTexts('ipoStatus', auditA_raw.ipoStatus);
    const auditA_warning = summarizeLiveTexts('ipoWarning', auditA_raw.ipoWarning);
    const auditA_reasonLimit = summarizeLiveTexts('ipoReasonLimit', auditA_raw.ipoReasonLimit);
    const auditA_cross = summarizeCrossRegionWindow(auditA_raw);
    f3AllCapturedLiveTexts.push(...auditA_status.distinctNonEmptyTexts, ...auditA_warning.distinctNonEmptyTexts, ...auditA_reasonLimit.distinctNonEmptyTexts);
    const reasonStatusNoLiveAncestorA = await page.evaluate(() => { let cur = document.getElementById('ipoReasonStatus'); while (cur) { if (cur.hasAttribute && cur.hasAttribute('aria-live')) return false; cur = cur.parentElement; } return true; });
    record('Scenario A: selecting an ordinary second Reason (well under the limit) produces ZERO live-region TEXT TRANSITIONS on all three real live regions', auditA_status.textTransitions.length === 0 && auditA_warning.textTransitions.length === 0 && auditA_reasonLimit.textTransitions.length === 0, `status=${JSON.stringify(auditA_status)}, warning=${JSON.stringify(auditA_warning)}, reasonLimit=${JSON.stringify(auditA_reasonLimit)}`);
    record('Scenario A: ordinary Selected Reasons text has no live-region ancestor (never an unintended live announcement of the full selected-Reasons list)', reasonStatusNoLiveAncestorA, `noLiveAncestor=${reasonStatusNoLiveAncestorA}`);
    record('FIX 5/6 (F3-S3): Scenario A cross-region duplicate check (ipoStatus+ipoWarning+ipoReasonLimit combined) shows no duplicate announcement', auditA_cross.repeatedIdenticalTexts === 0, JSON.stringify(auditA_cross));

    // Scenario B — deterministic state: exactly FOUR Reasons (verified),
    // fifth Reason confirmed enabled+unchecked, THEN select the fifth
    // after an audit reset (independent of Scenario A/Part 5's state).
    const scenarioBFirstFour = ['skin-tone', 'white-balance', 'highlight-detail', 'shadow-detail'];
    await safeClickIfEnabled(page, 'ipoClearReasonsButton');
    await page.waitForTimeout(120);
    for (const r of scenarioBFirstFour) {
      await page.click(`#ipoReason_${r}`);
      await page.waitForTimeout(80);
    }
    const scenarioB_countAfterFour = await page.evaluate(() => Array.from(document.querySelectorAll('input[name="ipoReason"]')).filter((c) => c.checked).length);
    const scenarioB_fifthEnabledUnchecked = await page.evaluate(() => { const el = document.getElementById('ipoReason_contrast'); return !!el && el.disabled === false && el.checked === false; });
    record('Scenario B precondition 1: exactly four Reasons selected (deterministic setup, not reused from any previous Part)', scenarioB_countAfterFour === 4, `count=${scenarioB_countAfterFour}`);
    record('Scenario B precondition 2: the fifth Reason (contrast) is enabled and unchecked before selection', scenarioB_fifthEnabledUnchecked, `enabledAndUnchecked=${scenarioB_fifthEnabledUnchecked}`);

    await resetLiveRegionAudit(page);
    await page.click('#ipoReason_contrast'); // genuine fifth-Reason selection AFTER the audit reset
    await page.waitForTimeout(150);
    const scenarioB_countAfterFive = await page.evaluate(() => Array.from(document.querySelectorAll('input[name="ipoReason"]')).filter((c) => c.checked).length);
    const scenarioB_othersDisabled = await page.evaluate(() => Array.from(document.querySelectorAll('input[name="ipoReason"]')).filter((c) => !c.checked).every((c) => c.disabled === true));
    record('Scenario B: selecting the fifth Reason through a real UI action reaches exactly five selected', scenarioB_countAfterFive === 5, `count=${scenarioB_countAfterFive}`);
    record('Scenario B: all unchecked additional Reasons become disabled at the five-Reason limit', scenarioB_othersDisabled, `othersDisabled=${scenarioB_othersDisabled}`);

    const auditB_raw = await readAllLiveRegionAudits(page);
    const auditB = summarizeLiveTexts('ipoReasonLimit', auditB_raw.ipoReasonLimit);
    const auditB_cross = summarizeCrossRegionWindow(auditB_raw);
    f3AllCapturedLiveTexts.push(...auditB.distinctNonEmptyTexts);
    record('Scenario B: reaching the five-Reason limit produces exactly one meaningful non-empty ipoReasonLimit announcement', auditB.nonEmptyAnnouncements === 1 && auditB.distinctNonEmptyTexts.length === 1 && auditB.distinctNonEmptyTexts[0] === 'You can select up to five reasons.', JSON.stringify(auditB));
    record('Scenario B: no duplicate identical ipoReasonLimit announcement was recorded', auditB.repeatedIdenticalTexts === 0, JSON.stringify(auditB));
    record('FIX 5/6 (F3-S3): Scenario B cross-region duplicate check (ipoStatus+ipoWarning+ipoReasonLimit combined) shows no duplicate announcement', auditB_cross.repeatedIdenticalTexts === 0, JSON.stringify(auditB_cross));

    // Scenario C — Clear Reasons (current state: five selected from
    // Scenario B). Step 7B-B-F3-P1 FIX 8: Production now contains the
    // bounded accessibility fix (reasonAnnouncement="reasons-cleared"
    // rendered into #ipoReasonLimit) — the named Product-gap honest-FAIL
    // branch is REMOVED because the actual bounded Production fix now
    // exists (previously PRODUCT_ACCESSIBILITY_GAP_CLEAR_REASONS_ANNOUNCEMENT).
    // PASS requires EXACTLY the bounded message, one distinct
    // announcement, no duplicate within the region, no duplicate across
    // all three regions, Observation remains selected, Reason counts
    // empty, and no Analysis/Slider/Canvas side effect (checked in Part
    // 9's pre-D window, since Scenario C falls inside it).
    const REASONS_CLEARED_ANNOUNCEMENT_TEXT = 'Reasons cleared. Observation remains selected. Production output was not changed.';
    await resetLiveRegionAudit(page);
    await page.click('#ipoClearReasonsButton');
    await page.waitForTimeout(150);
    const auditC_raw = await readAllLiveRegionAudits(page);
    const auditC_status = summarizeLiveTexts('ipoStatus', auditC_raw.ipoStatus);
    const auditC_warning = summarizeLiveTexts('ipoWarning', auditC_raw.ipoWarning);
    const auditC_reasonLimit = summarizeLiveTexts('ipoReasonLimit', auditC_raw.ipoReasonLimit);
    const auditC_cross = summarizeCrossRegionWindow(auditC_raw);
    const auditC_allDistinctNonEmpty = [...auditC_status.distinctNonEmptyTexts, ...auditC_warning.distinctNonEmptyTexts, ...auditC_reasonLimit.distinctNonEmptyTexts];
    f3AllCapturedLiveTexts.push(...auditC_allDistinctNonEmpty);
    record(
      'Scenario C / FIX 8 (F3-P1): Clear Reasons produces EXACTLY the bounded accessible message "Reasons cleared. Observation remains selected. Production output was not changed." — one distinct non-empty announcement, no duplicate within ipoReasonLimit',
      auditC_reasonLimit.nonEmptyAnnouncements === 1 && auditC_reasonLimit.distinctNonEmptyTexts.length === 1 && auditC_reasonLimit.distinctNonEmptyTexts[0] === REASONS_CLEARED_ANNOUNCEMENT_TEXT && auditC_reasonLimit.repeatedIdenticalTexts === 0 && auditC_status.nonEmptyAnnouncements === 0 && auditC_warning.nonEmptyAnnouncements === 0,
      `status=${JSON.stringify(auditC_status)}, warning=${JSON.stringify(auditC_warning)}, reasonLimit=${JSON.stringify(auditC_reasonLimit)}`
    );
    record('FIX 5/6 (F3-S3) / FIX 8 (F3-P1): Scenario C cross-region duplicate check (ipoStatus+ipoWarning+ipoReasonLimit combined) shows no duplicate announcement', auditC_cross.repeatedIdenticalTexts === 0 && auditC_allDistinctNonEmpty.length === 1, JSON.stringify(auditC_cross));
    const scenarioC_observationAndReasonsState = await page.evaluate(() => ({
      observationStillChecked: document.querySelector('input[name="ipoObservation"]:checked')?.id === 'ipoOption_prefer-legacy',
      reasonCount: Array.from(document.querySelectorAll('input[name="ipoReason"]')).filter((c) => c.checked).length,
    }));
    record('FIX 8 (F3-P1): after Clear Reasons, the Observation remains selected and Reason counts are empty', scenarioC_observationAndReasonsState.observationStillChecked && scenarioC_observationAndReasonsState.reasonCount === 0, JSON.stringify(scenarioC_observationAndReasonsState));

    // ── Step 7B-B-F3-S3 FIX 1/2/3 — PRE-D NON-ANALYSIS WINDOW close ──
    // The pre-D window spans Keyboard Parts 1-5 AND Scenarios A, B, C
    // (all non-Analysis actions since instrumentation was installed at
    // the very top of this section, f3GenAtStart/f3SlidersAtStart).
    // These must NOT be silently excluded merely because Scenario D
    // follows them — Canvas counters, Analysis generation, and Slider
    // values are all checked here, BEFORE Scenario D's real Analysis
    // window begins.
    const f3PreDEndGeneration = await qaSnapshot(page).then((s) => s?.analysisGeneration ?? null);
    const f3PreDEndSliders = await snapshotSliderValues(page);
    const f3PreDCanvasCalls = await readCanvasInstrumentation(page);
    record('FIX 1 (F3-S3): pre-D non-Analysis Canvas calls are zero (Keyboard Parts 1-5 + Scenarios A/B/C produced zero drawImage/getImageData/putImageData calls)', !!f3PreDCanvasCalls && f3PreDCanvasCalls.drawImage === 0 && f3PreDCanvasCalls.getImageData === 0 && f3PreDCanvasCalls.putImageData === 0, `preDCanvasCalls=${JSON.stringify(f3PreDCanvasCalls)}`);
    record('FIX 2 (F3-S3): pre-D non-Analysis window shows unchanged Analysis generation (Keyboard Parts 1-5 + Scenarios A/B/C never triggered a real re-analysis)', f3GenAtStart !== null && f3PreDEndGeneration === f3GenAtStart, `preDStartGeneration=${f3GenAtStart}, preDEndGeneration=${f3PreDEndGeneration}`);
    record('FIX 2 (F3-S3): pre-D non-Analysis window shows unchanged Slider values', slidersUnchanged(f3SlidersAtStart, f3PreDEndSliders), `atStart=${JSON.stringify(f3SlidersAtStart)}, preDEnd=${JSON.stringify(f3PreDEndSliders)}`);
    const f3CanvasRestoredBeforeD = await restoreCanvasInstrumentation(page);
    record('FIX 1 (F3-S3): pre-D Canvas methods restored exactly (Function identity proven, recorded SEPARATELY from the zero-calls result above)', f3CanvasRestoredBeforeD.restored === true, JSON.stringify(f3CanvasRestoredBeforeD));

    // ── Step 7B-B-F3-S3 FIX 2 — DELIBERATE ANALYSIS WINDOW ───────────
    // Includes ONLY the real Re-analyze, Human Review completion, and
    // the second real Re-analyze required to restore Ready. Canvas
    // calls and Slider values are intentionally NOT asserted zero/
    // unchanged inside this window — it is explicitly excluded from
    // Keyboard/ARIA side-effect isolation, never silently ignored.
    const f3AnalysisWindowStartGeneration = f3PreDEndGeneration;
    let f3IntentionalReanalyzeCount = 0;

    await resetLiveRegionAudit(page);
    await page.evaluate(() => { const el = document.getElementById('ipoOption_prefer-legacy'); if (el) el.click(); });
    await page.waitForTimeout(100);
    const p7dGen0 = await qaSnapshot(page).then((s) => s?.analysisGeneration ?? 0);
    await page.click('#btnReanalyze'); // deliberate real Analysis/Canvas window — Re-analyze #1
    f3IntentionalReanalyzeCount++;

    // FIX 4 (F3-S3) — deterministic stale-warning wait: waitForFunction
    // targets the EXACT expected stale-warning text as the primary
    // evidence (never a fixed timeout). A bounded timeout is used so a
    // genuinely missing Warning FAILS honestly rather than hanging.
    const STALE_WARNING_TEXT = 'The previous observation was cleared because a newer analysis is active.';
    let f3StaleWarningObserved = true;
    let f3StaleWarningError = null;
    try {
      await page.waitForFunction(
        (expected) => (document.getElementById('ipoWarning')?.textContent || '').trim() === expected,
        STALE_WARNING_TEXT,
        { timeout: 5000 }
      );
    } catch (e) {
      f3StaleWarningObserved = false;
      f3StaleWarningError = String((e && e.message) || e);
    }
    record(
      'FIX 4 (F3-S3): the stale-generation warning text is awaited deterministically via waitForFunction targeting the exact expected text (never a fixed timeout as primary evidence)',
      f3StaleWarningObserved,
      f3StaleWarningObserved ? `stale warning text observed via waitForFunction: "${STALE_WARNING_TEXT}"` : `FAIL — stale warning text never appeared within the bounded 5000ms timeout (no announcement was fabricated): ${f3StaleWarningError}`
    );
    // A SMALL timeout remains ONLY to flush one MutationObserver
    // delivery turn after the condition is already true — it is not the
    // primary evidence, which is the waitForFunction resolution above.
    await page.waitForTimeout(50);
    const auditD_raw = await readAllLiveRegionAudits(page);
    const auditD = summarizeLiveTexts('ipoWarning', auditD_raw.ipoWarning);
    const auditD_cross = summarizeCrossRegionWindow(auditD_raw);
    f3AllCapturedLiveTexts.push(...auditD.distinctNonEmptyTexts);
    record('Scenario D: a genuine stale-generation transition (real Re-analyze while an Observation was selected) produces exactly one meaningful ipoWarning announcement', auditD.nonEmptyAnnouncements === 1 && auditD.distinctNonEmptyTexts.length === 1 && auditD.distinctNonEmptyTexts[0] === STALE_WARNING_TEXT, JSON.stringify(auditD));
    record('Scenario D: no duplicate identical ipoWarning announcement was recorded during the stale-generation transition', auditD.repeatedIdenticalTexts === 0, JSON.stringify(auditD));
    record('FIX 5/6 (F3-S3): Scenario D cross-region duplicate check (ipoStatus+ipoWarning+ipoReasonLimit combined) shows no duplicate announcement', auditD_cross.repeatedIdenticalTexts === 0, JSON.stringify(auditD_cross));
    // Restore a fully stable, review-approved Ready state (mirrors the
    // proven two-phase pattern from reachReady()) — this entire wait/
    // review/reanalyze cycle remains INSIDE the deliberate, excluded
    // Analysis window.
    await waitForAnalysisCompletion(page, p7dGen0);
    const p7dGenBeforeReview = await qaSnapshot(page).then((s) => s?.analysisGeneration ?? p7dGen0);
    await passAllReviewItems(page);
    await page.click('#btnReanalyze'); // deliberate real Analysis/Canvas window — Re-analyze #2 (restores Ready)
    f3IntentionalReanalyzeCount++;
    await waitForAnalysisCompletion(page, p7dGenBeforeReview);
    const f3AnalysisWindowEndGeneration = await qaSnapshot(page).then((s) => s?.analysisGeneration ?? null);
    record(
      'FIX 2 (F3-S3): deliberate Analysis window is separately represented (excludedFromKeyboardAriaIsolation=true), with generation before/after and the intentional Re-analyze count recorded — Canvas calls and Sliders are NOT asserted here',
      true,
      JSON.stringify({ excludedFromKeyboardAriaIsolation: true, generationBefore: f3AnalysisWindowStartGeneration, generationAfter: f3AnalysisWindowEndGeneration, intentionalReanalyzeCount: f3IntentionalReanalyzeCount })
    );

    // ── Step 7B-B-F3-S3 FIX 2 — POST-D NON-ANALYSIS WINDOW open ──────
    // Reinstall FRESH zeroed Canvas instrumentation now that the
    // deliberate Analysis window has fully completed; only calls from
    // this point forward count toward the post-D zero-Canvas assertion.
    // Sliders are snapshotted fresh here too — they are never compared
    // across the deliberate Analysis window boundary.
    await installCanvasInstrumentation(page);
    const f3PostDStartGeneration = f3AnalysisWindowEndGeneration;
    const f3PostDStartSliders = await snapshotSliderValues(page);

    // Scenario E — Clear Observation. Requires a genuine non-empty
    // ipoStatus announcement matching the real expected cleared-state
    // message; zero mutations/messages FAIL.
    await page.evaluate(() => { const el = document.getElementById('ipoOption_prefer-legacy'); if (el) el.click(); });
    await page.waitForTimeout(100);
    await resetLiveRegionAudit(page);
    await safeClickIfEnabled(page, 'ipoClearButton');
    await page.waitForTimeout(150);
    const auditE_raw = await readAllLiveRegionAudits(page);
    const auditE = summarizeLiveTexts('ipoStatus', auditE_raw.ipoStatus);
    const auditE_cross = summarizeCrossRegionWindow(auditE_raw);
    f3AllCapturedLiveTexts.push(...auditE.distinctNonEmptyTexts);
    record(
      'Scenario E: Clear Observation produces exactly one non-empty ipoStatus announcement matching the expected cleared-state message, with no repeated identical announcement (zero mutations/messages FAIL)',
      auditE.nonEmptyAnnouncements === 1 && auditE.distinctNonEmptyTexts.length === 1 && auditE.distinctNonEmptyTexts[0] === 'Observation cleared. Production output was not changed.' && auditE.repeatedIdenticalTexts === 0,
      JSON.stringify(auditE)
    );
    record('FIX 5/6 (F3-S3): Scenario E cross-region duplicate check (ipoStatus+ipoWarning+ipoReasonLimit combined) shows no duplicate announcement', auditE_cross.repeatedIdenticalTexts === 0, JSON.stringify(auditE_cross));

    // FIX 6 (Step 7B-B-F3-S2) — a real UI action that attempts to
    // render the SAME Observation state again: re-activating the
    // already-selected Prefer Legacy radio through real keyboard input
    // (Space), never calling the Renderer/Controller directly.
    await page.evaluate(() => { const el = document.getElementById('ipoOption_prefer-legacy'); if (el) el.click(); }); // setup only — establish the state to repeat
    await page.waitForTimeout(120);
    await resetLiveRegionAudit(page);
    const f3RepeatStateBefore = await page.evaluate(() => ({ checkedId: document.querySelector('input[name="ipoObservation"]:checked')?.id ?? null, statusText: (document.getElementById('ipoStatus')?.textContent || '').trim() }));
    await page.evaluate(() => document.getElementById('ipoOption_prefer-legacy')?.focus()); // setup only, not activation proof — real keyboard focus on the already-checked radio
    await page.keyboard.press('Space'); // real keyboard re-activation of the SAME already-selected state (never Renderer/Controller called directly)
    await page.waitForTimeout(150);
    const f3RepeatStateAfter = await page.evaluate(() => ({ checkedId: document.querySelector('input[name="ipoObservation"]:checked')?.id ?? null, statusText: (document.getElementById('ipoStatus')?.textContent || '').trim() }));
    const auditRepeat_raw = await readAllLiveRegionAudits(page);
    const auditRepeat_status = summarizeLiveTexts('ipoStatus', auditRepeat_raw.ipoStatus);
    const auditRepeat_cross = summarizeCrossRegionWindow(auditRepeat_raw);
    f3AllCapturedLiveTexts.push(...auditRepeat_status.distinctNonEmptyTexts);
    record('FIX 6: re-activating the already-selected Observation radio via real Keyboard input leaves application state unchanged', f3RepeatStateBefore.checkedId === f3RepeatStateAfter.checkedId && f3RepeatStateBefore.statusText === f3RepeatStateAfter.statusText, `before=${JSON.stringify(f3RepeatStateBefore)}, after=${JSON.stringify(f3RepeatStateAfter)}`);
    record('FIX 6: re-activating the same Observation state produces no duplicate identical live announcement', auditRepeat_status.repeatedIdenticalTexts === 0, JSON.stringify(auditRepeat_status));
    record('FIX 5/6 (F3-S3): repeated-state action cross-region duplicate check (ipoStatus+ipoWarning+ipoReasonLimit combined) shows no duplicate announcement', auditRepeat_cross.repeatedIdenticalTexts === 0, JSON.stringify(auditRepeat_cross));

    await uninstallLiveRegionObservers(page);

    // ── F3-S PART 8 — announcement bounds (aggregated) ──────────────
    console.log('--- Part 8: announcement bounds ---');
    const p8Violations = f3AllCapturedLiveTexts.map((t) => ({ text: t.slice(0, 80), ...isAnnouncementBounded(t) })).filter((r) => !r.ok);
    record(`Part 8: every captured live-region announcement (${f3AllCapturedLiveTexts.length} checked) is plain text, HTML-injection-free, no [object Object]/NaN/Infinity/raw-stack, and bounded to 300 characters`, p8Violations.length === 0, p8Violations.length === 0 ? `checked=${f3AllCapturedLiveTexts.length}` : JSON.stringify(p8Violations));

    // ── F3-S PART 9 — side-effect isolation (POST-D window close) ───
    console.log('--- Part 9: side-effect isolation ---');
    const f3PostDEndGeneration = await qaSnapshot(page).then((s) => s?.analysisGeneration ?? null);
    const f3PostDEndSliders = await snapshotSliderValues(page);
    const f3PostDCanvasCalls = await readCanvasInstrumentation(page);
    const f3CanvasRestoredFinal = await restoreCanvasInstrumentation(page);

    // FIX 3 (F3-S3) — exact generation accounting across all three
    // windows. Never merely "final > start"; each window's own
    // before/after values are recorded and checked on their own terms.
    const f3GenerationAccounting = {
      preDStartGeneration: f3GenAtStart,
      preDEndGeneration: f3PreDEndGeneration,
      analysisWindowStartGeneration: f3AnalysisWindowStartGeneration,
      analysisWindowEndGeneration: f3AnalysisWindowEndGeneration,
      postDStartGeneration: f3PostDStartGeneration,
      postDEndGeneration: f3PostDEndGeneration,
      intentionalReanalyzeCount: f3IntentionalReanalyzeCount,
    };
    const f3GenerationAccountingValid =
      f3GenerationAccounting.preDEndGeneration === f3GenerationAccounting.preDStartGeneration &&
      f3GenerationAccounting.analysisWindowEndGeneration !== null &&
      f3GenerationAccounting.analysisWindowStartGeneration !== null &&
      f3GenerationAccounting.analysisWindowEndGeneration > f3GenerationAccounting.analysisWindowStartGeneration &&
      f3GenerationAccounting.postDEndGeneration === f3GenerationAccounting.postDStartGeneration &&
      f3GenerationAccounting.intentionalReanalyzeCount === 2;
    record('FIX 3 (F3-S3): exact generation accounting holds across all three windows (pre-D unchanged, Analysis window strictly increased, post-D unchanged, exactly two intentional Re-analyze actions)', f3GenerationAccountingValid, JSON.stringify(f3GenerationAccounting));

    record('FIX 2 (F3-S3): post-D non-Analysis window shows unchanged Analysis generation (Scenario E + FIX 6 never triggered a real re-analysis)', f3PostDStartGeneration !== null && f3PostDEndGeneration === f3PostDStartGeneration, `postDStartGeneration=${f3PostDStartGeneration}, postDEndGeneration=${f3PostDEndGeneration}`);
    record('FIX 2 (F3-S3): post-D non-Analysis window shows unchanged Slider values (never compared across the deliberate Analysis window boundary)', slidersUnchanged(f3PostDStartSliders, f3PostDEndSliders), `postDStart=${JSON.stringify(f3PostDStartSliders)}, postDEnd=${JSON.stringify(f3PostDEndSliders)}`);
    record('FIX 2 (F3-S3): post-D non-Analysis window shows zero Canvas drawImage/getImageData/putImageData calls (Scenario E + FIX 6 performed no image-processing side effects)', !!f3PostDCanvasCalls && f3PostDCanvasCalls.drawImage === 0 && f3PostDCanvasCalls.getImageData === 0 && f3PostDCanvasCalls.putImageData === 0, `postDCanvasCalls=${JSON.stringify(f3PostDCanvasCalls)}`);
    record('FIX 2 (F3-S3): post-D Canvas methods restored exactly, proven via Function identity (never merely inferred from deleted instrumentation state)', f3CanvasRestoredFinal.restored === true, JSON.stringify(f3CanvasRestoredFinal));

    // ══════════════════════════════════════════════════════════════
    // PART 5 PREP-A (Step 7B-B-F2-S2 FIX 3) — genuine Re-analyze
    // workflow to produce real Warning text. Selects an Observation,
    // then triggers an ACTUAL new analysis generation via the real
    // Re-analyze button so the controller's own stale-generation-
    // clearing logic fires (the real STALE_WARNING_MESSAGE) — never a
    // DOM-mutated fake warning string. The Warning's Contrast is
    // measured IN THE MOMENT it is observed non-empty (it is expected
    // to be transient), using the exact same FAIL/NOT_TESTED/PASS rules
    // as every other Contrast target via `recordContrastEntry`.
    // ══════════════════════════════════════════════════════════════
    console.log('=== Producing genuine Warning text via real Re-analyze workflow (Step 7B-B-F2-S2 FIX 3) ===');
    await page.evaluate(() => { const el = document.getElementById('ipoOption_prefer-legacy'); if (el) el.click(); });
    await page.waitForTimeout(150);
    const f2WarningGen0 = await qaSnapshot(page).then((s) => s?.analysisGeneration ?? 0);
    await page.click('#btnReanalyze');
    let warningEntry = null;
    for (let i = 0; i < 20 && !warningEntry; i++) {
      const captured = await page.evaluate(() => {
        function parseRgbaLocal(str) {
          const m = str && str.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
          if (!m) return null;
          const r = parseFloat(m[1]), g = parseFloat(m[2]), b = parseFloat(m[3]);
          const a = m[4] !== undefined ? parseFloat(m[4]) : 1;
          return [r, g, b, a];
        }
        function resolveEffectiveBackground(startEl) {
          const layers = [];
          let contributingBgImage = null;
          let el = startEl;
          let foundOpaque = false;
          while (el) {
            const style = getComputedStyle(el);
            if (style.backgroundImage && style.backgroundImage !== 'none' && contributingBgImage === null) contributingBgImage = style.backgroundImage;
            const rgba = parseRgbaLocal(style.backgroundColor);
            if (rgba && rgba[3] > 0) { layers.push(rgba); if (rgba[3] >= 1) { foundOpaque = true; break; } }
            el = el.parentElement;
          }
          if (contributingBgImage) return { undeterminable: true, reason: `background-image present ("${contributingBgImage.slice(0, 80)}") on a contributing element — cannot be safely ignored even though an opaque color exists` };
          let r = 255, g = 255, b = 255;
          for (let i = layers.length - 1; i >= 0; i--) { const [lr, lg, lb, la] = layers[i]; r = lr * la + r * (1 - la); g = lg * la + g * (1 - la); b = lb * la + b * (1 - la); }
          return { undeterminable: false, rgb: [Math.round(r), Math.round(g), Math.round(b)], hadOpaqueBase: foundOpaque, layerCount: layers.length };
        }
        function resolveEffectiveOpacity(startEl) {
          let el = startEl, product = 1, steps = 0;
          const MAX_STEPS = 25;
          while (el && steps < MAX_STEPS) {
            const raw = getComputedStyle(el).opacity;
            const val = parseFloat(raw);
            if (!Number.isFinite(val) || val < 0 || val > 1) return { resolvable: false, reason: `computed opacity "${raw}" could not be parsed reliably (bounded walk stopped after ${steps} step(s))` };
            product *= val; el = el.parentElement; steps += 1;
          }
          if (steps >= MAX_STEPS && el) return { resolvable: false, reason: `ancestor chain exceeds ${MAX_STEPS} elements — opacity could not be resolved reliably within a bounded walk` };
          return { resolvable: true, value: product };
        }
        function isProvenLargeText(fontSizePx, fontWeight) { return fontSizePx >= 24 || (fontSizePx >= 18.66 && fontWeight >= 700); }

        const el = document.getElementById('ipoWarning');
        const text = el ? (el.textContent || '').trim() : '';
        if (!el || text.length === 0) return { missing: true };
        // FIX 3 (F2-S3) — a hidden/zero-size Warning Element with
        // non-empty text is never treated as measurable: display:none,
        // visibility:hidden/collapse, zero-size, effectively-zero
        // opacity, or no rendered client rects all fail closed to FAIL
        // (via recordContrastEntry's notVisible branch), never keep
        // silently polling forever and never NOT_TESTED.
        const cs = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        const clientRectCount = el.getClientRects().length;
        const opacityResult = resolveEffectiveOpacity(el);
        const isZeroOpacity = opacityResult.resolvable && opacityResult.value === 0;
        if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse' || rect.width <= 0 || rect.height <= 0 || clientRectCount === 0 || isZeroOpacity) {
          return {
            missing: false, notVisible: true,
            notVisibleReason: `Warning text is present but the element is hidden or zero-size and cannot be measured — display=${cs.display}, visibility=${cs.visibility}, rect=${rect.width}x${rect.height}, clientRects=${clientRectCount}, effectiveOpacityZero=${isZeroOpacity} — FAIL (never NOT_TESTED, never treated as measurable)`,
          };
        }
        const fontSize = parseFloat(cs.fontSize) || 0;
        const fontWeight = parseInt(cs.fontWeight, 10) || 400;
        return {
          missing: false, colorRaw: cs.color, fgRgba: parseRgbaLocal(cs.color),
          fontSize, fontWeight, text: text.slice(0, 80), isLargeText: isProvenLargeText(fontSize, fontWeight),
          bg: resolveEffectiveBackground(el),
          opacityResolvable: opacityResult.resolvable, opacityValue: opacityResult.resolvable ? opacityResult.value : null, opacityReason: opacityResult.resolvable ? null : opacityResult.reason,
        };
      });
      if (!captured.missing) { warningEntry = captured; break; }
      await page.waitForTimeout(100);
    }
    if (!warningEntry) {
      record('Contrast: Warning', false, 'genuine Re-analyze workflow never produced non-empty Warning text within a ~2s poll window — FAIL (never calculated against an empty element, never marked PASS merely because the element exists)');
    } else {
      recordContrastEntry('Warning', warningEntry, contrastResults);
    }
    // Bring the app back to a fully stable Ready state (a fresh
    // analysis generation needs its own Review-console approval before
    // Observation/Reasons become available again) — mirrors the exact
    // real-workflow pattern already proven in reachReady() above.
    await waitForAnalysisCompletion(page, f2WarningGen0);
    const f2WarningGenBeforeReview = await qaSnapshot(page).then((s) => s?.analysisGeneration ?? f2WarningGen0);
    await passAllReviewItems(page);
    await page.click('#btnReanalyze');
    await waitForAnalysisCompletion(page, f2WarningGenBeforeReview);

    // ══════════════════════════════════════════════════════════════
    // PART 5 PREP-B (Step 7B-B-F2-S3 FIX 1) — real UI workflow to reach
    // the five-Reason limit state, capturing the SAME "color-balance"
    // Reason control's own computed style BEFORE it becomes disabled
    // (only four Reasons selected, color-balance still enabled and
    // unchecked) and AFTER it becomes disabled (the fifth Reason
    // selected, color-balance now disabled and still unchecked) — never
    // comparing it against a DIFFERENT, already-checked Reason, which
    // cannot isolate what the disabled transition itself actually
    // changed. This also drives a genuine recordObservation() call into
    // the Session for the current generation, so Session Metrics/Top
    // Reasons carry real content by the time the Contrast sweep runs.
    // ══════════════════════════════════════════════════════════════
    console.log('=== Reaching five-Reason-limit state, capturing color-balance before/after disabling (Step 7B-B-F2-S3 FIX 1) ===');
    await page.evaluate(() => { const el = document.getElementById('ipoOption_prefer-legacy'); if (el) el.click(); });
    await page.waitForTimeout(150);

    function snapReasonControl(inputId) {
      const input = document.getElementById(inputId);
      if (!input) return null;
      const label = input.closest('label');
      const span = label ? label.querySelector('span') : null;
      const inputStyle = getComputedStyle(input);
      const labelStyle = label ? getComputedStyle(label) : null;
      const spanStyle = span ? getComputedStyle(span) : null;
      return {
        disabled: input.disabled === true,
        checked: input.checked === true,
        inputOpacity: inputStyle.opacity,
        labelOpacity: labelStyle ? labelStyle.opacity : null,
        spanOpacity: spanStyle ? spanStyle.opacity : null,
        color: spanStyle ? spanStyle.color : (labelStyle ? labelStyle.color : null),
        backgroundColor: labelStyle ? labelStyle.backgroundColor : null,
        borderColor: labelStyle ? labelStyle.borderColor : null,
        filter: labelStyle ? labelStyle.filter : inputStyle.filter,
        textDecoration: labelStyle ? labelStyle.textDecoration : (spanStyle ? spanStyle.textDecoration : null),
        // Captured for evidence only — FIX 1 (F2-S3) deliberately never
        // counts cursor or className as visual distinction on their
        // own: neither is visible page content a user actually sees.
        cursor: labelStyle ? labelStyle.cursor : inputStyle.cursor,
        className: `${label ? label.className : ''}|${input.className}`,
      };
    }

    const f2FirstFourReasonIds = ['skin-tone', 'white-balance', 'highlight-detail', 'shadow-detail'];
    for (const r of f2FirstFourReasonIds) {
      const alreadyChecked = await page.evaluate((rid) => document.getElementById(`ipoReason_${rid}`)?.checked === true, r);
      if (!alreadyChecked) await page.click(`#ipoReason_${r}`);
    }
    await page.waitForTimeout(150);

    // Snapshot #1 — color-balance while still ENABLED (only four
    // Reasons selected so far; the fifth slot is still open).
    const colorBalanceEnabledSnap = await page.evaluate(snapReasonControl, 'ipoReason_color-balance');
    record('color-balance captured while enabled (four Reasons selected, real UI workflow, not simulated)', colorBalanceEnabledSnap?.disabled === false, `snap=${JSON.stringify(colorBalanceEnabledSnap)}`);

    // Select the fifth Reason — the real UI action that transitions
    // color-balance from enabled to disabled.
    const f2FifthReasonAlreadyChecked = await page.evaluate(() => document.getElementById('ipoReason_contrast')?.checked === true);
    if (!f2FifthReasonAlreadyChecked) await page.click('#ipoReason_contrast');
    await page.waitForTimeout(150);

    // Snapshot #2 — the SAME color-balance control, now DISABLED.
    const colorBalanceDisabledSnap = await page.evaluate(snapReasonControl, 'ipoReason_color-balance');
    record('Five-Reason limit re-established for Contrast/Touch-target audits (real UI workflow, not simulated)', colorBalanceDisabledSnap?.disabled === true, `disabled=${colorBalanceDisabledSnap?.disabled}`);
    record('color-balance captured while disabled (fifth Reason selected, SAME control as the enabled snapshot above)', colorBalanceDisabledSnap?.disabled === true, `snap=${JSON.stringify(colorBalanceDisabledSnap)}`);

    // ══════════════════════════════════════════════════════════════
    // FIX 1 (Step 7B-B-F2-S3) — disabled Reason visual distinction,
    // isolated to color-balance's OWN before/after transition (never a
    // different Reason as a stand-in reference). Only genuinely visible
    // properties count as distinguishing evidence — cursor, className,
    // and the `disabled` property itself are deliberately excluded from
    // the comparison set used to decide PASS/NOT_TESTED, since none of
    // them is visible page content.
    // ══════════════════════════════════════════════════════════════
    console.log('=== Disabled Reason visual distinction — same control, before vs. after (Step 7B-B-F2-S3 FIX 1) ===');
    if (!colorBalanceEnabledSnap || !colorBalanceDisabledSnap) {
      record('color-balance same-control before/after comparison requires both snapshots', false, `enabledSnap=${JSON.stringify(colorBalanceEnabledSnap)}, disabledSnap=${JSON.stringify(colorBalanceDisabledSnap)}`);
    } else {
      const enabledStateCorrect = colorBalanceEnabledSnap.disabled === false;
      const disabledStateCorrect = colorBalanceDisabledSnap.disabled === true;
      const bothUnchecked = colorBalanceEnabledSnap.checked === false && colorBalanceDisabledSnap.checked === false;
      record('color-balance enabled snapshot has disabled === false', enabledStateCorrect, `disabled=${colorBalanceEnabledSnap.disabled}`);
      record('color-balance disabled snapshot has disabled === true', disabledStateCorrect, `disabled=${colorBalanceDisabledSnap.disabled}`);
      record('color-balance remains unchecked (checked === false) in both the enabled and disabled snapshots', bothUnchecked, `enabledChecked=${colorBalanceEnabledSnap.checked}, disabledChecked=${colorBalanceDisabledSnap.checked}`);

      // Only genuinely visible properties count toward distinction —
      // cursor/className/disabled are captured above for evidence only
      // and are deliberately never included in this comparison set.
      const propsToCompare = ['inputOpacity', 'labelOpacity', 'spanOpacity', 'color', 'backgroundColor', 'borderColor', 'filter', 'textDecoration'];
      const differences = propsToCompare.filter((p) => colorBalanceEnabledSnap[p] !== colorBalanceDisabledSnap[p]);
      if (!enabledStateCorrect || !disabledStateCorrect || !bothUnchecked) {
        record('Disabled sixth Reason (color-balance) is visually distinguishable from its own enabled state (measurable via computed style)', false, 'the before/after snapshots did not isolate a genuine disabled-only transition of the same control — FAIL');
      } else if (differences.length > 0) {
        record('Disabled sixth Reason (color-balance) is visually distinguishable from its own enabled state (measurable via computed style)', true, `differing VISIBLE properties: ${JSON.stringify(differences)}, enabledSnap=${JSON.stringify(colorBalanceEnabledSnap)}, disabledSnap=${JSON.stringify(colorBalanceDisabledSnap)}`);
      } else {
        record('Disabled sixth Reason (color-balance) is visually distinguishable from its own enabled state (measurable via computed style)', 'NOT_TESTED', `all ${propsToCompare.length} compared VISIBLE computed-style properties are identical between color-balance's own enabled and disabled snapshots (${JSON.stringify(propsToCompare)}) — cursor/className/the disabled property itself are deliberately excluded from this comparison since they are not visible page content — this application's CSS authors no explicit disabled style for these labels, and native browser disabled-checkbox rendering is not reliably introspectable via getComputedStyle — reported honestly as a tool limitation, never fabricated as PASS, and no CSS/class was added merely to force a pass`);
      }
    }

    // ══════════════════════════════════════════════════════════════
    // PART 5 — Contrast audit (Step 7B-B-F2-S2: FIX 1 background-image
    // fail-closed correctness, FIX 2 foreground-alpha/opacity
    // composition, FIX 3 required non-empty dynamic text). Warning is
    // NOT re-tested here — it was already measured in its genuine
    // transient window in PREP-A above, per the exact same
    // recordContrastEntry rules.
    // ══════════════════════════════════════════════════════════════
    console.log('=== Contrast audit (Step 7B-B-F2-S2 complete target list) ===');
    const contrastAudit = await page.evaluate(() => {
      function parseRgbaLocal(str) {
        const m = str && str.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
        if (!m) return null;
        const r = parseFloat(m[1]), g = parseFloat(m[2]), b = parseFloat(m[3]);
        const a = m[4] !== undefined ? parseFloat(m[4]) : 1;
        return [r, g, b, a];
      }
      // FIX 1 — inspects backgroundImage BEFORE the opaque-color break,
      // on EVERY contributing element (including the one that supplies
      // the opaque base itself) — a gradient/image cannot be ignored
      // merely because an opaque color exists on that same element or a
      // nearer ancestor.
      function resolveEffectiveBackground(startEl) {
        const layers = [];
        let contributingBgImage = null;
        let el = startEl;
        let foundOpaque = false;
        while (el) {
          const style = getComputedStyle(el);
          if (style.backgroundImage && style.backgroundImage !== 'none' && contributingBgImage === null) contributingBgImage = style.backgroundImage;
          const rgba = parseRgbaLocal(style.backgroundColor);
          if (rgba && rgba[3] > 0) { layers.push(rgba); if (rgba[3] >= 1) { foundOpaque = true; break; } }
          el = el.parentElement;
        }
        if (contributingBgImage) return { undeterminable: true, reason: `background-image present ("${contributingBgImage.slice(0, 80)}") on a contributing element (this element or an ancestor at/inside the opaque base) — cannot be safely ignored even though an opaque color exists` };
        let r = 255, g = 255, b = 255;
        for (let i = layers.length - 1; i >= 0; i--) { const [lr, lg, lb, la] = layers[i]; r = lr * la + r * (1 - la); g = lg * la + g * (1 - la); b = lb * la + b * (1 - la); }
        return { undeterminable: false, rgb: [Math.round(r), Math.round(g), Math.round(b)], hadOpaqueBase: foundOpaque, layerCount: layers.length };
      }
      // FIX 2 — bounded ancestor-opacity walk; unresolvable (never
      // silently assumed 1) surfaces as an explicit NOT_TESTED upstream.
      function resolveEffectiveOpacity(startEl) {
        let el = startEl, product = 1, steps = 0;
        const MAX_STEPS = 25;
        while (el && steps < MAX_STEPS) {
          const raw = getComputedStyle(el).opacity;
          const val = parseFloat(raw);
          if (!Number.isFinite(val) || val < 0 || val > 1) return { resolvable: false, reason: `computed opacity "${raw}" on ${el === startEl ? 'the target element' : 'a contributing ancestor'} could not be parsed reliably (bounded walk stopped after ${steps} step(s))` };
          product *= val; el = el.parentElement; steps += 1;
        }
        if (steps >= MAX_STEPS && el) return { resolvable: false, reason: `ancestor chain exceeds ${MAX_STEPS} elements — opacity could not be resolved reliably within a bounded walk` };
        return { resolvable: true, value: product };
      }
      function isProvenLargeText(fontSizePx, fontWeight) { return fontSizePx >= 24 || (fontSizePx >= 18.66 && fontWeight >= 700); }

      // FIX 3 (F2-S3) — `requireNonEmptyText` targets are treated as
      // `missing` (never PASS merely because the element exists) when
      // their rendered text is empty at measurement time. Every target
      // — required text or not — must also pass a real-visibility gate
      // (display, visibility, non-zero rendered size, non-zero
      // effective opacity, rendered client rects) BEFORE contrast is
      // calculated: a hidden/zero-size Element is never measurable.
      function collect(elOrNull, label, requireNonEmptyText) {
        if (!elOrNull) return { label, missing: true };
        const style = getComputedStyle(elOrNull);
        const rect = elOrNull.getBoundingClientRect();
        const clientRectCount = elOrNull.getClientRects().length;
        const opacityResult = resolveEffectiveOpacity(elOrNull);
        const isZeroOpacity = opacityResult.resolvable && opacityResult.value === 0;
        if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || rect.width <= 0 || rect.height <= 0 || clientRectCount === 0 || isZeroOpacity) {
          return {
            label, missing: false, notVisible: true,
            notVisibleReason: `required target "${label}" is hidden or zero-size and cannot be measured — display=${style.display}, visibility=${style.visibility}, rect=${rect.width}x${rect.height}, clientRects=${clientRectCount}, effectiveOpacityZero=${isZeroOpacity} — FAIL (never NOT_TESTED for a hidden/zero-size required target, never treated as measurable)`,
          };
        }
        const text = (elOrNull.textContent || '').trim().slice(0, 80);
        if (requireNonEmptyText && text.length === 0) return { label, missing: true };
        const fontSize = parseFloat(style.fontSize) || 0;
        const fontWeight = parseInt(style.fontWeight, 10) || 400;
        return {
          label, missing: false, colorRaw: style.color, fgRgba: parseRgbaLocal(style.color),
          fontSize, fontWeight, text, isLargeText: isProvenLargeText(fontSize, fontWeight),
          bg: resolveEffectiveBackground(elOrNull),
          opacityResolvable: opacityResult.resolvable, opacityValue: opacityResult.resolvable ? opacityResult.value : null, opacityReason: opacityResult.resolvable ? null : opacityResult.reason,
        };
      }

      const out = [];
      out.push(collect(document.querySelector('#interactivePreviewObservationSection h4'), 'Observation title', false));
      out.push(collect(document.querySelector('#interactivePreviewObservationSection p'), 'Observation subtitle', false));
      out.push(collect(document.getElementById('ipoStatus'), 'Observation status', false));
      out.push(collect(document.getElementById('ipoSafetyNote'), 'Safety note', false));
      out.push(collect(document.getElementById('ipoSafetyNote')?.previousElementSibling ?? null, 'Privacy/session-only note', false));

      Array.from(document.querySelectorAll('input[name="ipoObservation"]')).forEach((r, i) => {
        out.push(collect(r.closest('label')?.querySelector('span') ?? null, `Observation radio label ${i} (${r.value})`, false));
      });
      Array.from(document.querySelectorAll('input[name="ipoReason"]')).forEach((c, i) => {
        out.push(collect(c.closest('label')?.querySelector('span') ?? null, `Reason label ${i} (${c.value})${c.disabled ? ' [disabled]' : ''}`, false));
      });

      // FIX 3 — Reason-limit message / Selected Reasons text must be
      // non-empty (the real five-Reason-limit workflow in PREP-B above
      // guarantees this at measurement time).
      out.push(collect(document.getElementById('ipoReasonLimit'), 'Reason-limit message', true));
      out.push(collect(document.getElementById('ipoReasonStatus'), 'Selected Reasons text', true));

      // Real DOM structure combines label+value (and label+count) into
      // a SINGLE text node per row — one measurement per row covers
      // both required categories. FIX 3: each row's own text must be
      // non-empty too.
      const metricsEl = document.getElementById('ipoSessionMetrics');
      const metricsChildren = metricsEl ? Array.from(metricsEl.children) : [];
      if (metricsChildren.length === 0) {
        out.push({ label: 'Session metric labels/values', missing: true });
      } else {
        metricsChildren.forEach((child, i) => out.push(collect(child, `Session metric row ${i} (label+value combined in one text node)`, true)));
      }
      const topReasonsEl = document.getElementById('ipoSessionTopReasons');
      const topReasonsChildren = topReasonsEl ? Array.from(topReasonsEl.children) : [];
      if (topReasonsChildren.length === 0) {
        out.push({ label: 'Top Reasons labels/counts', missing: true });
      } else {
        topReasonsChildren.forEach((child, i) => out.push(collect(child, `Top Reasons row ${i} (label+count combined in one text node)`, true)));
      }

      out.push(collect(document.getElementById('ipoClearButton'), 'Clear Observation button', false));
      out.push(collect(document.getElementById('ipoClearReasonsButton'), 'Clear Reasons button', false));
      out.push(collect(document.getElementById('ipoClearSessionButton'), 'Clear Session button', false));
      return out;
    });

    for (const entry of contrastAudit) recordContrastEntry(entry.label, entry, contrastResults);

    // ══════════════════════════════════════════════════════════════
    // PART 5B — Focus indicator contrast (Step 7B-B-F2-S3 FIX 4/5/6).
    // FIX 4: style is captured TWICE per target — once genuinely
    // UNFOCUSED, once genuinely FOCUSED via real keyboard input — and
    // the Focus indicator must be NEWLY present or MEASURABLY CHANGED
    // between those two captures; a static/decorative outline or
    // box-shadow present unchanged in both states never counts. FIX 5:
    // the active indicator's color is parsed as RGBA and, when its own
    // alpha is below 1, genuinely composited over the resolved adjacent
    // background (via the same robust, gradient/image-aware resolver
    // used by the Contrast audit) — alpha is never discarded. FIX 6:
    // when the indicator is a box-shadow, the SPECIFIC shadow layer
    // introduced/changed by focus is isolated by diffing the unfocused
    // and focused box-shadow layer lists; if that isolation is not
    // reliable (ambiguous layer counts, more than one layer differing),
    // this is honestly NOT_TESTED — never assuming the first RGB value
    // and never falling back to an unrelated outlineColor.
    // ══════════════════════════════════════════════════════════════
    console.log('=== Focus indicator contrast (real keyboard focus, before/after comparison) ===');

    // Defined once and reused as the SAME function reference for both
    // the unfocused and focused captures below, so the two snapshots
    // are guaranteed to be produced by byte-identical logic.
    function captureFocusStyle(elId) {
      const el = document.getElementById(elId);
      const styledEl = el.closest('label') || el;
      const style = getComputedStyle(styledEl);
      const ownOverflow = style.overflow;
      const parentOverflow = styledEl.parentElement ? getComputedStyle(styledEl.parentElement).overflow : 'visible';
      return {
        isFocused: document.activeElement === el,
        outlineWidth: parseFloat(style.outlineWidth) || 0,
        outlineStyle: style.outlineStyle,
        outlineColorRaw: style.outlineColor,
        boxShadow: style.boxShadow,
        notClipped: !/hidden|clip/.test(ownOverflow) && !/hidden|clip/.test(parentOverflow),
      };
    }
    function resolveAdjacentBackground(elId) {
      function parseRgbaLocal(str) {
        const m = str && str.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
        if (!m) return null;
        return [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]), m[4] !== undefined ? parseFloat(m[4]) : 1];
      }
      function resolveEffectiveBackground(startEl) {
        const layers = [];
        let contributingBgImage = null;
        let el = startEl;
        let foundOpaque = false;
        while (el) {
          const style = getComputedStyle(el);
          if (style.backgroundImage && style.backgroundImage !== 'none' && contributingBgImage === null) contributingBgImage = style.backgroundImage;
          const rgba = parseRgbaLocal(style.backgroundColor);
          if (rgba && rgba[3] > 0) { layers.push(rgba); if (rgba[3] >= 1) { foundOpaque = true; break; } }
          el = el.parentElement;
        }
        if (contributingBgImage) return { undeterminable: true, reason: `background-image present ("${contributingBgImage.slice(0, 80)}") on a contributing element — cannot be safely ignored even though an opaque color exists` };
        let r = 255, g = 255, b = 255;
        for (let i = layers.length - 1; i >= 0; i--) { const [lr, lg, lb, la] = layers[i]; r = lr * la + r * (1 - la); g = lg * la + g * (1 - la); b = lb * la + b * (1 - la); }
        return { undeterminable: false, rgb: [Math.round(r), Math.round(g), Math.round(b)], hadOpaqueBase: foundOpaque, layerCount: layers.length };
      }
      const el = document.getElementById(elId);
      const styledEl = el.closest('label') || el;
      return resolveEffectiveBackground(styledEl.parentElement || styledEl);
    }

    const focusIndicatorTargets = [
      { id: 'ipoOption_prefer-legacy', label: 'Observation radio (prefer-legacy)', isRadio: true },
      { id: 'ipoReason_skin-tone', label: 'Reason checkbox (skin-tone)', isRadio: false },
      { id: 'ipoClearButton', label: 'Clear Observation button', isRadio: false },
      { id: 'ipoClearReasonsButton', label: 'Clear Reasons button', isRadio: false },
      { id: 'ipoClearSessionButton', label: 'Clear Session button', isRadio: false },
    ];
    for (const target of focusIndicatorTargets) {
      const elExists = await page.evaluate((elId) => !!document.getElementById(elId), target.id);
      if (!elExists) { record(`Focus indicator: ${target.label}`, false, 'required element not found in DOM — FAIL'); continue; }

      // FIX 4 — establish a genuinely UNFOCUSED baseline first (blur if
      // some earlier step left focus on this exact element), then
      // capture its "before" style.
      await page.evaluate((elId) => { const el = document.getElementById(elId); if (document.activeElement === el) document.body.focus(); }, target.id);
      await page.waitForTimeout(30);
      const unfocusedInfo = await page.evaluate(captureFocusStyle, target.id);

      // Real keyboard focus landing (unchanged technique): for the
      // radio, a click first selects it within its roving-tabindex
      // group (radios cannot be reached by Tab unless checked), then a
      // genuine Shift+Tab/Tab pair lands real keyboard focus on it.
      if (target.isRadio) {
        await page.click(`#${target.id}`);
        await page.waitForTimeout(80);
      } else {
        await page.evaluate((elId) => document.getElementById(elId)?.focus({ preventScroll: true }), target.id);
      }
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Tab');
      const focusedInfo = await page.evaluate(captureFocusStyle, target.id);

      if (!focusedInfo.isFocused) { record(`Focus indicator: ${target.label}`, false, `element did not receive real keyboard focus — unfocused=${JSON.stringify(unfocusedInfo)}, focused=${JSON.stringify(focusedInfo)}`); continue; }

      // FIX 4 — the indicator must be NEWLY present or MEASURABLY
      // CHANGED between the unfocused and focused captures. A static
      // decorative outline/box-shadow that exists identically in both
      // states is never accepted as evidence of a real Focus indicator.
      const focusedHasOutline = focusedInfo.outlineWidth > 0 && focusedInfo.outlineStyle !== 'none';
      const unfocusedHasOutline = unfocusedInfo.outlineWidth > 0 && unfocusedInfo.outlineStyle !== 'none';
      const outlineUnchanged = focusedHasOutline && unfocusedHasOutline && unfocusedInfo.outlineWidth === focusedInfo.outlineWidth && unfocusedInfo.outlineStyle === focusedInfo.outlineStyle && unfocusedInfo.outlineColorRaw === focusedInfo.outlineColorRaw;
      const usingOutline = focusedHasOutline && !outlineUnchanged;

      const focusedHasBoxShadow = !!focusedInfo.boxShadow && focusedInfo.boxShadow !== 'none';
      const boxShadowUnchanged = focusedHasBoxShadow && unfocusedInfo.boxShadow === focusedInfo.boxShadow;
      const usingBoxShadow = !usingOutline && focusedHasBoxShadow && !boxShadowUnchanged;

      if (!usingOutline && !usingBoxShadow) {
        record(`Focus indicator: ${target.label}`, false, `no newly-introduced or measurably-changed Focus indicator between the unfocused and focused captures — a static/decorative indicator present unchanged in both states does not count (unfocused=${JSON.stringify(unfocusedInfo)}, focused=${JSON.stringify(focusedInfo)})`);
        continue;
      }
      if (!focusedInfo.notClipped) { record(`Focus indicator: ${target.label}`, false, 'indicator is clipped by an ancestor overflow:hidden/clip'); continue; }

      let indicatorColorRaw = null;
      let indicatorSource = null;
      if (usingOutline) {
        indicatorColorRaw = focusedInfo.outlineColorRaw;
        indicatorSource = 'outline (newly present or changed vs. unfocused state)';
      } else {
        // FIX 6 — isolate the SPECIFIC box-shadow layer introduced or
        // changed by focus, splitting on top-level commas only (never
        // inside an rgba(...)'s own commas) so multi-shadow values are
        // handled correctly.
        const unfocusedLayers = splitBoxShadowLayers(unfocusedInfo.boxShadow);
        const focusedLayers = splitBoxShadowLayers(focusedInfo.boxShadow);
        let ambiguousEvidence = null;
        if (focusedLayers.length === unfocusedLayers.length) {
          const diffIdx = [];
          for (let i = 0; i < focusedLayers.length; i++) if (focusedLayers[i] !== unfocusedLayers[i]) diffIdx.push(i);
          if (diffIdx.length === 1) {
            indicatorColorRaw = (focusedLayers[diffIdx[0]].match(/rgba?\([^)]*\)/) || [null])[0];
            indicatorSource = `box-shadow (layer ${diffIdx[0]} changed vs. unfocused state)`;
          } else {
            ambiguousEvidence = `${diffIdx.length} box-shadow layers differ between the unfocused and focused captures (expected exactly 1) — cannot isolate the Focus-introduced layer reliably`;
          }
        } else if (focusedLayers.length === unfocusedLayers.length + 1) {
          const newLayers = focusedLayers.filter((l) => !unfocusedLayers.includes(l));
          if (newLayers.length === 1) {
            indicatorColorRaw = (newLayers[0].match(/rgba?\([^)]*\)/) || [null])[0];
            indicatorSource = 'box-shadow (newly added layer isolated vs. unfocused state)';
          } else {
            ambiguousEvidence = `the focused capture has exactly one more box-shadow layer than the unfocused capture, but ${newLayers.length} layers are not present in the unfocused set (expected exactly 1 new layer) — cannot isolate reliably`;
          }
        } else {
          ambiguousEvidence = `box-shadow layer counts (unfocused=${unfocusedLayers.length}, focused=${focusedLayers.length}) do not match a simple single-layer-added or single-layer-changed pattern — cannot isolate the Focus-introduced component reliably`;
        }
        if (ambiguousEvidence) {
          record(`Focus indicator: ${target.label} contrast against adjacent background meets 3:1`, 'NOT_TESTED', `${ambiguousEvidence} (never assuming the first RGB value, never falling back to an unrelated outlineColor) — unfocusedBoxShadow="${unfocusedInfo.boxShadow}", focusedBoxShadow="${focusedInfo.boxShadow}"`);
          continue;
        }
      }
      if (!indicatorColorRaw) {
        record(`Focus indicator: ${target.label}`, false, `could not parse the ACTUAL active indicator color (source=${indicatorSource}, raw=${indicatorColorRaw}) — FAIL, not NOT_TESTED`);
        continue;
      }
      const indicatorRgba = parseRgbaNode(indicatorColorRaw);
      if (!indicatorRgba) {
        record(`Focus indicator: ${target.label}`, false, `could not parse the ACTUAL active indicator color as RGBA (source=${indicatorSource}, raw=${indicatorColorRaw}) — FAIL, not NOT_TESTED`);
        continue;
      }

      const adjacentBgResult = await page.evaluate(resolveAdjacentBackground, target.id);
      if (adjacentBgResult.undeterminable) {
        // FIX 5 — fail closed: never fabricate a ratio against a
        // genuinely non-computable background.
        record(`Focus indicator: ${target.label} contrast against adjacent background meets 3:1`, 'NOT_TESTED', adjacentBgResult.reason);
        continue;
      }

      // FIX 5 — parse the indicator color as RGBA and, when its own
      // alpha is below 1, composite it over the resolved adjacent
      // background — never discard alpha, never treat a semi-
      // transparent indicator as opaque.
      const [ir, ig, ib, ia] = indicatorRgba;
      const compositedIndicator = ia >= 1
        ? [ir, ig, ib]
        : [0, 1, 2].map((i) => Math.round(indicatorRgba[i] * ia + adjacentBgResult.rgb[i] * (1 - ia)));
      const ratio = contrastRatio(compositedIndicator, adjacentBgResult.rgb);
      record(`Focus indicator: ${target.label} contrast against adjacent background meets 3:1`, ratio >= 3.0, `ratio=${ratio.toFixed(2)}:1, indicatorSource=${indicatorSource}, indicatorColorRaw=${indicatorColorRaw}, indicatorAlpha=${ia.toFixed(3)}, compositedIndicator=rgb(${compositedIndicator.join(',')}), adjacentBg=rgb(${adjacentBgResult.rgb.join(',')}) [hadOpaqueBase=${adjacentBgResult.hadOpaqueBase}, layers=${adjacentBgResult.layerCount}], notClipped=${focusedInfo.notClipped}`);
    }

    // ══════════════════════════════════════════════════════════════
    // PART 6 — Touch target sizes (Step 7B-B-F2 FIX 6: 43.5px on BOTH
    // width and height, all 17 required targets enumerated and
    // recorded individually).
    // ══════════════════════════════════════════════════════════════
    console.log('=== Touch target sizes (Step 7B-B-F2: MIN=43.5, width+height, 17 targets) ===');
    const touchTargetCheck = await page.evaluate(() => {
      const MIN = 43.5;
      const out = [];
      const check = (elt, id) => {
        if (!elt) { out.push({ id, width: null, height: null, pass: false, missing: true }); return; }
        const r = elt.getBoundingClientRect();
        const width = +r.width.toFixed(2);
        const height = +r.height.toFixed(2);
        out.push({ id, width, height, pass: width >= MIN && height >= MIN, missing: false });
      };
      const radios = Array.from(document.querySelectorAll('input[name="ipoObservation"]'));
      radios.forEach((r, i) => check(r.closest('label'), `radio-label-${i}-${r.value}`));
      const reasons = Array.from(document.querySelectorAll('input[name="ipoReason"]'));
      reasons.forEach((c, i) => check(c.closest('label'), `reason-label-${i}-${c.value}`));
      check(document.getElementById('ipoClearButton'), 'clear-observation-btn');
      check(document.getElementById('ipoClearReasonsButton'), 'clear-reasons-btn');
      check(document.getElementById('ipoClearSessionButton'), 'clear-session-btn');
      return out;
    });
    for (const t of touchTargetCheck) {
      if (t.missing) { record(`Touch target: ${t.id}`, false, 'required target element not found — FAIL (never NOT_TESTED for a missing required target)'); continue; }
      record(`Touch target: ${t.id} >= 43.5x43.5px`, t.pass, `width=${t.width}, height=${t.height}, pass=${t.pass}`);
    }
    const touchTargetsAllPass = touchTargetCheck.every((t) => t.pass);
    record('All 17 touch targets pass width>=43.5 AND height>=43.5 (radio/reason labels, Clear buttons)', touchTargetsAllPass && touchTargetCheck.length === 17, `count=${touchTargetCheck.length}, allPass=${touchTargetsAllPass}, targets=${JSON.stringify(touchTargetCheck)}`);
    record('Physical touch hardware', 'NOT_TESTED', 'genuine physical touch hardware was not used');

    // FIX 7 (ENV-B2-F1): captured before cleanup() closes the Page, so
    // the bounded `environment` metadata block below can report the
    // real navigated URL (key/value only — never source or bytes).
    mainPageUrl = page.url();

    await mainRuntime.cleanup();

    // ══════════════════════════════════════════════════════════════
    // PART 7 — Malformed renderer state + HTML/script injection.
    // Executed through the real browser DOM (page.evaluate + dynamic
    // import of the REAL renderer functions) — never a fake Node.js
    // container, since the renderer expects genuine DOM APIs. A fresh
    // in-memory Page (its own Context, its own about:blank?qa=1
    // navigation), reusing the same project snapshot built once at
    // the top of main() — no rebuild, no re-scan of project files.
    // ══════════════════════════════════════════════════════════════
    console.log('=== Malformed renderer state + injection safety (real browser DOM, real renderer functions) ===');

    part7Runtime = await openLumixaInMemoryPage({
      browser,
      projectRoot: PROJECT_ROOT,
      qaQuery: '?qa=1',
      prebuiltApp: appSnapshot,
    });
    const part7Page = part7Runtime.page;
    attachErrorListeners(part7Page, 'part7-malformed-injection');
    record('ENV-B2 PART 1/5-7: In-Memory runtime storage compatibility for the Part 7 Page (independent Context, independent verification)', part7Runtime.storageAccessVerified ? 'PASS' : 'FAIL', `storageStatus=${part7Runtime.storageStatus}, storageAccessVerified=${part7Runtime.storageAccessVerified}`);
    await part7Page.waitForTimeout(300);

  const malformedResult = await part7Page.evaluate(async (canonicalOrigin) => {
    // Rewritten for ENV-B2: the real renderer module is already part of
    // the in-memory module graph's Import Map under its canonical ID —
    // no local HTTP server, no absolute "/ui/..." path (which would
    // have no origin to resolve against on this opaque about:blank
    // document — there is no server behind it to even attempt).
    const { renderInteractivePreviewObservationV2, renderInteractivePreviewObservationSessionV2 } = await import(`${canonicalOrigin}/ui/interactive-preview-observation-renderer-v2.js`);
    const makeContainer = () => document.createElement('div');

    const malformedInputs = [
      ['null', null],
      ['undefined', undefined],
      ['primitive string', 'not-an-object'],
      ['primitive number', 42],
      ['circular object', (() => { const o = { state: 'selected' }; o.self = o; return o; })()],
      ['throwing getter', (() => { const o = {}; Object.defineProperty(o, 'state', { get() { throw new Error('evil'); } }); return o; })()],
      ['getter succeeds once then throws', (() => { let n = 0; const o = {}; Object.defineProperty(o, 'state', { get() { n++; if (n > 1) throw new Error('evil2'); return 'selected'; } }); return o; })()],
      ['hostile Reasons array', { state: 'selected', observation: 'prefer-legacy', reasons: (() => { const arr = ['skin-tone']; Object.defineProperty(arr, '1', { get() { throw new Error('evil3'); } }); Object.defineProperty(arr, 'length', { value: 2 }); return arr; })() }],
      ['NaN/Infinity in metadata', { state: 'selected', observation: 'prefer-legacy', reasons: [], reasonCount: NaN, reasonLimit: Infinity }],
      ['negative counts', { state: 'selected', observation: 'prefer-legacy', reasons: [], reasonCount: -5 }],
      ['extremely long string', { state: 'selected', observation: 'x'.repeat(50000), reasons: [] }],
    ];
    let malformedNoneCrashed = true;
    const malformedFailures = [];
    for (const [label, input] of malformedInputs) {
      try { renderInteractivePreviewObservationV2(makeContainer(), input); }
      catch (e) { malformedNoneCrashed = false; malformedFailures.push({ label, error: String(e).slice(0, 200) }); }
    }

    const malformedSummaries = [
      ['null summary', null],
      ['NaN counts', { totalObserved: NaN, activeObservations: NaN, cleared: NaN, invalidated: NaN, reasonCounts: {} }],
      ['Infinity counts', { totalObserved: Infinity, activeObservations: Infinity, cleared: 0, invalidated: 0, reasonCounts: {} }],
      ['negative counts', { totalObserved: -1, activeObservations: -1, cleared: -1, invalidated: -1, reasonCounts: {} }],
      ['malformed topReasons', { totalObserved: 1, activeObservations: 1, cleared: 0, invalidated: 0, reasonCounts: {}, topReasons: 'not-an-array' }],
      ['hostile Summary getter', (() => { const o = {}; Object.defineProperty(o, 'totalObserved', { get() { throw new Error('evil4'); } }); return o; })()],
    ];
    let summaryNoneCrashed = true;
    const summaryFailures = [];
    for (const [label, input] of malformedSummaries) {
      try { renderInteractivePreviewObservationSessionV2(makeContainer(), input); }
      catch (e) { summaryNoneCrashed = false; summaryFailures.push({ label, error: String(e).slice(0, 200) }); }
    }

    const injectionStrings = ['<script>alert(1)</script>', '<img src=x onerror=alert(2)>', '"><svg onload=alert(3)>', 'javascript:alert(4)', '&lt;script&gt;alert(5)&lt;/script&gt;'];
    let injectionSafe = true;
    const injectionFindings = [];
    for (const payload of injectionStrings) {
      const container = makeContainer();
      try {
        renderInteractivePreviewObservationV2(container, { state: 'blocked', observation: null, reasons: [], warnings: [payload], metadata: { blockers: [payload] } });
        const html = container.innerHTML;
        // Check via REAL DOM parsing, not text regex — a safely
        // HTML-escaped payload (e.g. "&lt;img onerror=...&gt;",
        // rendered as literal, inert text) must NOT be flagged; only an
        // actual live <script> element or a real element carrying a
        // genuine onerror/onload/onload-style attribute counts as
        // unsafe injection.
        const hasLiveScriptTag = !!container.querySelector('script');
        const hasLiveEventHandlerAttr = Array.from(container.querySelectorAll('*')).some((el) => Array.from(el.attributes).some((attr) => /^on/i.test(attr.name)));
        if (hasLiveScriptTag || hasLiveEventHandlerAttr) { injectionSafe = false; injectionFindings.push({ payload, htmlSnippet: html.slice(0, 200), hasLiveScriptTag, hasLiveEventHandlerAttr }); }
      } catch (e) { injectionSafe = false; injectionFindings.push({ payload, error: String(e).slice(0, 200) }); }
    }

    return {
      malformedNoneCrashed, malformedFailures, malformedCount: malformedInputs.length,
      summaryNoneCrashed, summaryFailures, summaryCount: malformedSummaries.length,
      injectionSafe, injectionFindings, injectionCount: injectionStrings.length,
    };
  }, CANONICAL_ORIGIN);

  record('Observation renderer: no uncaught exception on any malformed/hostile state', malformedResult.malformedNoneCrashed, malformedResult.malformedNoneCrashed ? `${malformedResult.malformedCount} cases tested, zero crashes` : JSON.stringify(malformedResult.malformedFailures));
  record('Session summary renderer: no uncaught exception on any malformed/hostile summary', malformedResult.summaryNoneCrashed, malformedResult.summaryNoneCrashed ? `${malformedResult.summaryCount} cases tested, zero crashes` : JSON.stringify(malformedResult.summaryFailures));
  record('HTML/script injection: no script/event-handler execution or raw injection in renderer output', malformedResult.injectionSafe, malformedResult.injectionSafe ? `${malformedResult.injectionCount} payloads tested, all safely handled` : JSON.stringify(malformedResult.injectionFindings));

  await mkdir(SCREENSHOTS_DIR, { recursive: true });
  await part7Page.screenshot({ path: path.join(SCREENSHOTS_DIR, '02-part7-malformed-injection.png') }).catch(() => {});

  await part7Runtime.cleanup();

  } finally {
    if (mainRuntime) await mainRuntime.cleanup().catch(() => {});
    if (part7Runtime) await part7Runtime.cleanup().catch(() => {});
    await browser.close();
  }


  // ══════════════════════════════════════════════════════════════
  // PART 8 — Security source audit + Production isolation audit.
  // ══════════════════════════════════════════════════════════════
  console.log('=== Security source audit + Production isolation audit ===');
  const observationFiles = ['ui/interactive-preview-observation-controller-v2.js', 'ui/interactive-preview-observation-renderer-v2.js', 'ui/interactive-preview-observation-session-v2.js'];
  const dangerousPatterns = ['innerHTML', 'insertAdjacentHTML', 'eval(', 'new Function', 'document.write', 'fetch(', 'XMLHttpRequest', 'sendBeacon', 'WebSocket', 'localStorage.', 'sessionStorage.', 'indexedDB.', 'document.cookie', 'postMessage(', 'navigator.clipboard', 'createObjectURL'];
  const securityFindings = [];
  for (const file of observationFiles) {
    const src = await readFile(path.join(PROJECT_ROOT, file), 'utf8');
    const lines = src.split('\n');
    for (const pattern of dangerousPatterns) {
      lines.forEach((line, idx) => {
        if (line.includes(pattern)) {
          const trimmed = line.trim();
          const isCommentOnly = trimmed.startsWith('*') || trimmed.startsWith('//');
          if (!isCommentOnly) securityFindings.push({ file, line: idx + 1, pattern, text: trimmed.slice(0, 120) });
        }
      });
    }
  }
  record('Security source audit: zero non-comment dangerous-API consumers in Observation/Session modules', securityFindings.length === 0, securityFindings.length === 0 ? 'zero matches outside comments' : JSON.stringify(securityFindings));

  const productionPatterns = ['interactivePreviewObservation', 'observationSession', 'prefer-v2', 'reasonCounts', 'topReasons', 'activeObservationSessionGenerationId'];
  const { execSync } = await import('node:child_process');
  const productionFindings = [];
  for (const pattern of productionPatterns) {
    try {
      const out = execSync(`grep -rl "${pattern}" core/ 2>/dev/null || true`, { cwd: PROJECT_ROOT }).toString().trim();
      if (out) productionFindings.push({ pattern, filesFound: out.split('\n') });
    } catch { /* grep returning nonzero on no-match is expected, ignore */ }
  }
  record('Production isolation: zero Observation/Session identifiers found in core/', productionFindings.length === 0, productionFindings.length === 0 ? 'zero matches in core/' : JSON.stringify(productionFindings));

  // FIX 3 — required result rows. Both must be PASS for the suite to
  // pass; neither has a NOT_TESTED escape hatch. resourceErrors/
  // consoleErrors were captured throughout the ENTIRE run above
  // (attached before navigation on every page this suite opened).
  record('Zero non-font console/page errors', consoleErrors.length === 0, consoleErrors.length === 0 ? 'zero non-font console/page errors observed' : JSON.stringify(consoleErrors));
  record('Zero non-font resource/network failures', resourceErrors.length === 0, resourceErrors.length === 0 ? 'zero non-font resource/network failures observed' : JSON.stringify(resourceErrors));

  // ══════════════════════════════════════════════════════════════
  // FIX 6 (ENV-B2-F1): merge the PRE-load Runtime collectors — built
  // by openLumixaInMemoryPage and attached BEFORE any navigation or
  // setContent (main Page + Part 7 Page) — together with the POST-load
  // consoleErrors/resourceErrors captured by attachErrorListeners
  // above, into ONE final decision. Any HTTP/HTTPS/file/unexpected-
  // scheme request observed by EITHER collector is an unconditional
  // FAIL; no Google-Fonts exception is needed here because the
  // In-Memory Harness is required to make ZERO external requests.
  // ══════════════════════════════════════════════════════════════
  const preLoadPageErrors = [...mainRuntime.collectors.pageErrors, ...part7Runtime.collectors.pageErrors];
  const preLoadConsoleErrors = [...mainRuntime.collectors.consoleErrors, ...part7Runtime.collectors.consoleErrors];
  const preLoadRequestFailures = [...mainRuntime.collectors.requestFailures, ...part7Runtime.collectors.requestFailures];
  const preLoadNonAllowedNetworkRequests = [...mainRuntime.collectors.nonAllowedNetworkRequests, ...part7Runtime.collectors.nonAllowedNetworkRequests];
  const mergedPageConsoleErrorCount = preLoadPageErrors.length + preLoadConsoleErrors.length + consoleErrors.length;
  const mergedRequestFailureCount = preLoadRequestFailures.length + resourceErrors.length;

  record(
    'FIX 6 (ENV-B2-F1): zero pre-load+post-load page/console errors (pre-load: Runtime collectors on the main + Part 7 Pages, captured before any navigation/setContent; post-load: attachErrorListeners)',
    mergedPageConsoleErrorCount === 0,
    mergedPageConsoleErrorCount === 0 ? 'zero pre-load+post-load page/console errors observed' : JSON.stringify({ preLoadPageErrors, preLoadConsoleErrors, postLoadConsoleErrors: consoleErrors })
  );
  record(
    'FIX 6 (ENV-B2-F1): zero pre-load+post-load request failures (pre-load: Runtime collectors on the main + Part 7 Pages; post-load: attachErrorListeners resourceErrors)',
    mergedRequestFailureCount === 0,
    mergedRequestFailureCount === 0 ? 'zero pre-load+post-load request failures observed' : JSON.stringify({ preLoadRequestFailures, postLoadResourceErrors: resourceErrors })
  );
  record(
    'FIX 6 (ENV-B2-F1): zero non-allowed (non data:/about:) network requests observed by the pre-load Runtime collectors on any Page this suite opened — no Google-Fonts exception needed, the In-Memory Harness must make zero external requests',
    preLoadNonAllowedNetworkRequests.length === 0,
    preLoadNonAllowedNetworkRequests.length === 0 ? 'zero pre-load non-allowed network requests observed' : JSON.stringify(preLoadNonAllowedNetworkRequests)
  );

  const passCount = results.filter((r) => r.result === 'PASS').length;
  const failCount = results.filter((r) => r.result === 'FAIL').length;
  const notTestedCount = results.filter((r) => r.result === 'NOT_TESTED').length;
  // FIX 1 — true fail-closed decision, factored into a pure function
  // (qa/epic-2e-j-phase-c-step7b-b-f1-decision.mjs) so it is unit-
  // testable without Chromium. Only the exact test name
  // 'Physical touch hardware' is a permitted NOT_TESTED for this suite;
  // Contrast, Clear Session, a missing element, and the new
  // Console/Resource rows above are all NOT permitted and force FAIL.
  const finalDecision = computeStep7BBDecision(results);

  // ══════════════════════════════════════════════════════════════
  // FIX 7 (ENV-B2-F1): bounded `environment` metadata block — key
  // NAMES/counts only, never values, source, data URLs, image bytes,
  // or full stacks. `inMemoryHarnessDecision` reuses the SAME canonical
  // fail-closed function (computeInMemoryHarnessDecision) that FIX 8
  // wires into the in-memory smoke test, applied here to the harness-
  // level checks this suite itself observed (storage verified on both
  // Pages, zero pre-load non-allowed network requests).
  // ══════════════════════════════════════════════════════════════
  // FIX 11 (ENV-B2-F2): computeInMemoryHarnessDecision() now requires
  // every row to include a bounded, non-empty `test` name — every
  // internal harnessCheckResults row below is updated accordingly.
  const harnessCheckResults = [
    { test: 'main Page Storage access verified', result: mainRuntime.storageAccessVerified ? 'PASS' : 'FAIL' },
    { test: 'Part 7 Page Storage access verified', result: part7Runtime.storageAccessVerified ? 'PASS' : 'FAIL' },
    { test: 'zero pre-load non-allowed network requests', result: preLoadNonAllowedNetworkRequests.length === 0 ? 'PASS' : 'FAIL' },
    { test: 'zero merged pre-load+post-load page/console errors', result: mergedPageConsoleErrorCount === 0 ? 'PASS' : 'FAIL' },
    { test: 'zero merged pre-load+post-load request failures', result: mergedRequestFailureCount === 0 ? 'PASS' : 'FAIL' },
  ];
  const environmentMetadata = {
    browserExecutablePath: browserDetect.found,
    browserVersion,
    pageUrl: mainPageUrl,
    moduleCount: mainRuntime.evidence.moduleCount,
    importEdgeCount: mainRuntime.evidence.importEdgeCount,
    storageStatus: mainRuntime.storageStatus,
    storageReadOnly: !!(mainRuntime.readOnlyCheck.localStorageReadOnly && mainRuntime.readOnlyCheck.sessionStorageReadOnly),
    // FIX 10 (ENV-B2-F2): a bounded Array of key NAMES (never values),
    // in the same deterministic order `classifyStorageKeyPrivacyRisk`
    // produced them; an empty-safe result is `[]`, never `null`.
    storagePrivacyKeysObserved: privacyRisk ? privacyRisk.flagged : [],
    networkRequestCount: preLoadNonAllowedNetworkRequests.length,
    inMemoryHarnessDecision: computeInMemoryHarnessDecision(harnessCheckResults),
  };

  const output = {
    suite: 'EPIC 2E-J-C-F2 Step 7B-B - Keyboard, Accessibility, Security and Final Phase C Closeout',
    generatedAt: new Date().toISOString(),
    summary: { total: results.length, pass: passCount, fail: failCount, notTested: notTestedCount },
    contrastResults,
    consoleErrors,
    resourceErrors,
    environment: environmentMetadata,
    results,
    decision: finalDecision,
  };
  await mkdir(path.join(PROJECT_ROOT, 'qa'), { recursive: true });
  await writeFile(path.join(PROJECT_ROOT, 'qa', 'epic-2e-j-phase-c-step7b-b-results.json'), JSON.stringify(output, null, 2));
  console.log(`\n${passCount}/${results.length} PASS, ${failCount} FAIL, ${notTestedCount} NOT_TESTED`);
  console.log(`Step 7B-B Decision: ${output.decision}`);
  process.exit(finalDecision === 'FAIL' ? 1 : 0);
}

main().catch((err) => {
  console.error('Step 7B-B test crashed:', err);
  process.exit(2);
});
