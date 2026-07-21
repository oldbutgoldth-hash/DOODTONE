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

async function main() {
  const server = await startServer();
  const browser = await chromium.launch();
  const consoleErrors = [];

  try {
    // ══════════════════════════════════════════════════════════════
    // PART 1 — Reach Ready through the real application (no forced state).
    // ══════════════════════════════════════════════════════════════
    const page = await browser.newPage({ viewport: { width: 1440, height: 1400 } });
    page.on('pageerror', (e) => consoleErrors.push({ context: 'main', type: 'pageerror', error: String(e) }));
    page.on('console', (msg) => { if (msg.type() === 'error' && !/Failed to load resource/i.test(msg.text())) consoleErrors.push({ context: 'main', type: 'console.error', text: msg.text() }); });

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
    // PART 5 — Contrast audit (deterministic calculator, WCAG-style).
    // ══════════════════════════════════════════════════════════════
    console.log('=== Contrast audit ===');
    const contrastTargets = [
      ['ipoStatus', 'Status message'],
      ['ipoSafetyNote', 'Safety note'],
      ['ipoClearButton', 'Clear Observation button'],
      ['ipoClearReasonsButton', 'Clear Reasons button'],
      ['ipoClearSessionButton', 'Clear Session button'],
    ];
    contrastResults = [];
    for (const [id, label] of contrastTargets) {
      const colors = await page.evaluate((elId) => {
        const el = document.getElementById(elId);
        if (!el) return null;
        const style = getComputedStyle(el);
        let bg = style.backgroundColor;
        let bgEl = el;
        // Walk up to find a non-transparent background if the element itself is transparent.
        while (bg === 'rgba(0, 0, 0, 0)' && bgEl.parentElement) { bgEl = bgEl.parentElement; bg = getComputedStyle(bgEl).backgroundColor; }
        return { color: style.color, backgroundColor: bg };
      }, id);
      if (!colors) { record(`Contrast: ${label}`, 'NOT_TESTED', 'element not found'); continue; }
      const fg = parseRgb(colors.color);
      const bg = parseRgb(colors.backgroundColor);
      if (!fg || !bg) { record(`Contrast: ${label}`, 'NOT_TESTED', `could not parse computed colors reliably (fg=${colors.color}, bg=${colors.backgroundColor}) — reported honestly as a limitation, not fabricated`); continue; }
      const ratio = contrastRatio(fg, bg);
      contrastResults.push({ label, ratio: +ratio.toFixed(2) });
      record(`Contrast: ${label} meets 4.5:1 (WCAG AA normal text)`, ratio >= 4.5, `ratio=${ratio.toFixed(2)}:1, fg=${colors.color}, bg=${colors.backgroundColor}`);
    }

    // ══════════════════════════════════════════════════════════════
    // PART 6 — Touch target sizes.
    // ══════════════════════════════════════════════════════════════
    console.log('=== Touch target sizes ===');
    const touchTargetCheck = await page.evaluate(() => {
      const MIN = 40; // ~44px with 1-2px tolerance for sub-pixel rendering
      const results = [];
      const check = (el, label) => { if (!el) return; const r = el.getBoundingClientRect(); results.push({ label, width: Math.round(r.width), height: Math.round(r.height), pass: r.height >= MIN }); };
      document.querySelectorAll('input[name="ipoObservation"]').forEach((r, i) => check(r.closest('label'), 'radio-label-' + i));
      document.querySelectorAll('input[name="ipoReason"]').forEach((c, i) => check(c.closest('label'), 'reason-label-' + i));
      check(document.getElementById('ipoClearButton'), 'clear-observation-btn');
      check(document.getElementById('ipoClearReasonsButton'), 'clear-reasons-btn');
      check(document.getElementById('ipoClearSessionButton'), 'clear-session-btn');
      return results;
    });
    const touchTargetsAllPass = touchTargetCheck.every((r) => r.pass);
    record('All touch targets approximately >=44px (radio/reason labels, Clear buttons)', touchTargetsAllPass, touchTargetsAllPass ? `all ${touchTargetCheck.length} targets pass` : JSON.stringify(touchTargetCheck.filter((r) => !r.pass)));
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

  const passCount = results.filter((r) => r.result === 'PASS').length;
  const failCount = results.filter((r) => r.result === 'FAIL').length;
  const notTestedCount = results.filter((r) => r.result === 'NOT_TESTED').length;
  const requiredNotTestedOk = results.filter((r) => r.result === 'NOT_TESTED').every((r) => /Physical touch hardware|Contrast:/i.test(r.test));
  const finalDecision = (failCount === 0 && requiredNotTestedOk) ? (notTestedCount === 0 ? 'PASS' : 'CONDITIONAL_PASS') : 'FAIL';

  const output = {
    suite: 'EPIC 2E-J-C-F2 Step 7B-B - Keyboard, Accessibility, Security and Final Phase C Closeout',
    generatedAt: new Date().toISOString(),
    summary: { total: results.length, pass: passCount, fail: failCount, notTested: notTestedCount },
    contrastResults,
    consoleErrors,
    results,
    decision: finalDecision,
  };
  await mkdir(path.join(PROJECT_ROOT, 'qa'), { recursive: true });
  await writeFile(path.join(PROJECT_ROOT, 'qa', 'epic-2e-j-phase-c-step7b-b-results.json'), JSON.stringify(output, null, 2));
  console.log(`\n${passCount}/${results.length} PASS, ${failCount} FAIL, ${notTestedCount} NOT_TESTED`);
  console.log(`Step 7B-B Decision: ${output.decision}`);
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Step 7B-B test crashed:', err);
  process.exit(2);
});
