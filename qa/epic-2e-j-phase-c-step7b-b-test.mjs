#!/usr/bin/env node
/**
 * qa/epic-2e-j-phase-c-step7b-b-test.mjs
 *
 * EPIC 2E-J-C-F2 Step 7B-B — Keyboard, Accessibility, Security and
 * Final Phase C Closeout. Launches the REAL, complete, unmodified
 * application in headless Chromium, drives it through real keyboard
 * events (never `locator.focus()` as a substitute for Tab), audits
 * accessibility structure/ARIA/contrast/touch-targets, and tests the
 * real Observation/Session renderers directly against malformed and
 * hostile input plus HTML/script injection strings.
 *
 * Run: node qa/epic-2e-j-phase-c-step7b-b-test.mjs
 * Output: qa/epic-2e-j-phase-c-step7b-b-results.json
 */

import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { computeStep7BBDecision, isAllowedExternalFontUrl } from './epic-2e-j-phase-c-step7b-b-f1-decision.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PORT = 19992;
const FIXTURES_DIR = path.join(PROJECT_ROOT, 'qa', 'fixtures', 'epic-2e-j');

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

async function main() {
  const server = await startServer();
  const browser = await chromium.launch();
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

  try {
    // ══════════════════════════════════════════════════════════════
    // PART 1 — Reach Ready through the real application (no forced state).
    // ══════════════════════════════════════════════════════════════
    const page = await browser.newPage({ viewport: { width: 1440, height: 1400 } });
    attachErrorListeners(page, 'main');

    await page.goto(`http://localhost:${PORT}/index.html?qa=1`);
    await page.waitForTimeout(600);
    const { completed, snapshot } = await reachReady(page, 'neutral-balanced.png');
    record('Real application reaches Ready with Observation enabled', completed && snapshot?.observation?.enabled === true, `completed=${completed}, observationEnabled=${snapshot?.observation?.enabled}`);
    await page.evaluate(() => { const el = document.getElementById('interactivePreviewObservationSection'); if (el) el.scrollIntoView(); });
    await page.waitForTimeout(300);

    // ══════════════════════════════════════════════════════════════
    // PART 2 — Real keyboard navigation (actual Tab/Shift+Tab/Arrow/
    // Space presses — never `locator.focus()` as a Tab substitute).
    // ══════════════════════════════════════════════════════════════
    console.log('=== Keyboard navigation (real key presses) ===');

    // Start from a known focusable element BEFORE Observation, then Tab forward.
    await page.evaluate(() => document.getElementById('btnReanalyze')?.focus());
    let reachedRadioGroup = false;
    let focusedId = null;
    for (let i = 0; i < 110 && !reachedRadioGroup; i++) {
      await page.keyboard.press('Tab');
      focusedId = await page.evaluate(() => document.activeElement.id);
      if (focusedId === 'ipoOption_prefer-legacy') reachedRadioGroup = true;
    }
    record('Tab reaches Observation radio group naturally (real Tab presses)', reachedRadioGroup, `focusedId=${focusedId}`);

    await page.keyboard.press('ArrowDown');
    const afterArrowDown = await page.evaluate(() => ({ id: document.activeElement.id, checked: document.activeElement.checked }));
    record('ArrowDown moves between native radios', afterArrowDown.id !== 'ipoOption_prefer-legacy' && afterArrowDown.checked === true, JSON.stringify(afterArrowDown));
    await page.keyboard.press('ArrowRight');
    const afterArrowRight = await page.evaluate(() => ({ id: document.activeElement.id, checked: document.activeElement.checked }));
    record('ArrowRight moves between native radios', afterArrowRight.checked === true, JSON.stringify(afterArrowRight));
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowLeft');
    const exactlyOneChecked = await page.evaluate(() => Array.from(document.querySelectorAll('input[name="ipoObservation"]')).filter((r) => r.checked).length === 1);
    record('Exactly one radio remains checked after Arrow navigation', exactlyOneChecked, `oneChecked=${exactlyOneChecked}`);

    // Tab out of the radio group into the Reason fieldset. Note the
    // REAL DOM order: the Observation fieldset (containing Clear
    // Observation) is appended BEFORE the Reason fieldset, so Clear
    // Observation is passed through during this very loop — it must be
    // recorded here, not only in the later loop.
    let reachedFirstReasonCheckbox = false;
    let reachedClearObsInFirstLoop = false;
    for (let i = 0; i < 10 && !reachedFirstReasonCheckbox; i++) {
      await page.keyboard.press('Tab');
      focusedId = await page.evaluate(() => document.activeElement.id);
      if (focusedId === 'ipoClearButton') reachedClearObsInFirstLoop = true;
      if (focusedId && focusedId.startsWith('ipoReason_')) reachedFirstReasonCheckbox = true;
    }
    record('Tab exits radio group and reaches Reason checkboxes in DOM order', reachedFirstReasonCheckbox, `focusedId=${focusedId}`);

    const firstReasonId = focusedId;
    await page.keyboard.press('Space');
    const firstReasonChecked = await page.evaluate((id) => document.getElementById(id).checked, firstReasonId);
    record('Space toggles a Reason checkbox', firstReasonChecked === true, `id=${firstReasonId}, checked=${firstReasonChecked}`);

    // Tab through remaining reason checkboxes, then to Clear Reasons/Session.
    let reachedClearReasons = false, reachedClearObs = reachedClearObsInFirstLoop, reachedClearSession = false;
    const tabSequence = [];
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press('Tab');
      focusedId = await page.evaluate(() => document.activeElement.id);
      tabSequence.push(focusedId);
      if (focusedId === 'ipoClearReasonsButton') reachedClearReasons = true;
      if (focusedId === 'ipoClearButton') reachedClearObs = true;
      if (focusedId === 'ipoClearSessionButton') reachedClearSession = true;
      if (reachedClearReasons && reachedClearObs && reachedClearSession) break;
    }
    record('Tab reaches Clear Reasons button', reachedClearReasons, `reached=${reachedClearReasons}, sequence=${JSON.stringify(tabSequence)}`);
    record('Tab reaches Clear Observation button', reachedClearObs, `reached=${reachedClearObs}, sequence=${JSON.stringify(tabSequence)}`);
    record('Tab reaches Clear Session button', reachedClearSession, `reached=${reachedClearSession}, sequence=${JSON.stringify(tabSequence)}`);

    // Shift+Tab reverses navigation.
    const beforeShiftTab = await page.evaluate(() => document.activeElement.id);
    await page.keyboard.press('Shift+Tab');
    const afterShiftTab = await page.evaluate(() => document.activeElement.id);
    record('Shift+Tab reverses navigation', afterShiftTab !== beforeShiftTab, `before=${beforeShiftTab}, after=${afterShiftTab}`);

    // No keyboard trap: Tab forward past Clear Session must keep
    // advancing focus (never get stuck repeating the exact same
    // element), for several consecutive presses.
    await page.evaluate(() => document.getElementById('ipoClearSessionButton')?.focus());
    let noTrapDetected = true;
    let previousElementHandle = null;
    const visitedDescriptions = [];
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Tab');
      const isSameElementAsBefore = await page.evaluate((prevWasNull) => {
        if (prevWasNull) return false;
        return document.activeElement === window.__step7bbPrevFocused;
      }, previousElementHandle === null);
      const description = await page.evaluate(() => { window.__step7bbPrevFocused = document.activeElement; return document.activeElement.id || `${document.activeElement.tagName}[${Array.from(document.activeElement.parentElement?.children ?? []).indexOf(document.activeElement)}]`; });
      visitedDescriptions.push(description);
      if (isSameElementAsBefore) { noTrapDetected = false; break; }
      previousElementHandle = true;
    }
    record('No keyboard trap after Clear Session (focus keeps advancing)', noTrapDetected, `sequence=${JSON.stringify(visitedDescriptions)}`);

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

    await page.close();

    // ══════════════════════════════════════════════════════════════
    // PART 7 — Malformed renderer state + HTML/script injection.
    // Executed through the real browser DOM (page.evaluate + dynamic
    // import of the REAL renderer functions) — never a fake Node.js
    // container, since the renderer expects genuine DOM APIs. Moved
    // inside this try block (before browser.close() in `finally`) so
    // `browser` is still open when a fresh page is created here.
    // ══════════════════════════════════════════════════════════════
    console.log('=== Malformed renderer state + injection safety (real browser DOM, real renderer functions) ===');

    const part7Page = await browser.newPage();
    attachErrorListeners(part7Page, 'part7-malformed-injection');
    await part7Page.goto(`http://localhost:${PORT}/index.html?qa=1`);
    await part7Page.waitForTimeout(300);

  const malformedResult = await part7Page.evaluate(async () => {
    const { renderInteractivePreviewObservationV2, renderInteractivePreviewObservationSessionV2 } = await import('/ui/interactive-preview-observation-renderer-v2.js');
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
  });

  record('Observation renderer: no uncaught exception on any malformed/hostile state', malformedResult.malformedNoneCrashed, malformedResult.malformedNoneCrashed ? `${malformedResult.malformedCount} cases tested, zero crashes` : JSON.stringify(malformedResult.malformedFailures));
  record('Session summary renderer: no uncaught exception on any malformed/hostile summary', malformedResult.summaryNoneCrashed, malformedResult.summaryNoneCrashed ? `${malformedResult.summaryCount} cases tested, zero crashes` : JSON.stringify(malformedResult.summaryFailures));
  record('HTML/script injection: no script/event-handler execution or raw injection in renderer output', malformedResult.injectionSafe, malformedResult.injectionSafe ? `${malformedResult.injectionCount} payloads tested, all safely handled` : JSON.stringify(malformedResult.injectionFindings));

  await part7Page.close();

  } finally {
    await browser.close();
    server.close();
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

  const output = {
    suite: 'EPIC 2E-J-C-F2 Step 7B-B - Keyboard, Accessibility, Security and Final Phase C Closeout',
    generatedAt: new Date().toISOString(),
    summary: { total: results.length, pass: passCount, fail: failCount, notTested: notTestedCount },
    contrastResults,
    consoleErrors,
    resourceErrors,
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
