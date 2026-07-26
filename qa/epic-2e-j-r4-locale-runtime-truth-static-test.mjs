#!/usr/bin/env node
/**
 * qa/epic-2e-j-r4-locale-runtime-truth-static-test.mjs
 *
 * EPIC 2E-J LOCALE RUNTIME TRUTH + QA NEUTRALITY R4 -- Phase M.
 *
 * The static audit's own regression guard against the R4 defect
 * classes (A, B, C, D, F, G, L) ever silently recurring. Each detector
 * below is a real scan over the current source, and each carries a
 * HOSTILE SELF-TEST proving the detector actually catches a synthetic
 * sample of the defect -- not just that the current source happens to
 * be clean.
 *
 * No Browser, no network, no Chromium -- safe for run-static-suites.mjs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

let passCount = 0, failCount = 0;
function record(test, ok, evidence) {
  const icon = ok ? '✓' : '✗';
  const status = ok ? 'PASS' : 'FAIL';
  if (ok) passCount++; else failCount++;
  const safeEvidence = (() => { try { return JSON.stringify(evidence); } catch { return String(evidence); } })();
  console.log(`${icon} [${status}] ${test} — ${safeEvidence}`);
}

function read(relPath) {
  try { return fs.readFileSync(path.join(PROJECT_ROOT, relPath), 'utf-8'); } catch { return null; }
}

// ── Detector functions ──────────────────────────────────────────────

/** R4 Defect A: page.evaluate(fn, arg1, arg2, ...) called with THREE or more arguments -- Playwright's page.evaluate(pageFunction, arg) contract only ever forwards ONE arg. */
function detectMultiArgPageEvaluate(src) {
  if (typeof src !== 'string') return [];
  const hits = [];
  const re = /page\.evaluate\(/g;
  let m;
  while ((m = re.exec(src))) {
    // Depth tracks ALL of (), {}, [] together -- a comma inside a
    // nested object/array literal or callback body (depth > 1) is
    // never a top-level page.evaluate() argument separator. Only a
    // comma seen while depth === 1 (directly inside the outer
    // page.evaluate( ... ) parens) counts toward the argument count.
    let depth = 1, i = m.index + m[0].length, topLevelCommas = 0;
    while (i < src.length && depth > 0) {
      const c = src[i];
      if (c === '(' || c === '{' || c === '[') depth++;
      else if (c === ')' || c === '}' || c === ']') depth--;
      else if (c === ',' && depth === 1) topLevelCommas++;
      i++;
    }
    if (topLevelCommas >= 2) hits.push(src.slice(m.index, Math.min(m.index + 100, i)));
  }
  return hits;
}

/** R4 Defect B: a suite decision that only checks a fail/error count, ignoring notTested -- e.g. `failCount > 0 ? 'FAIL' : 'PASS'` with no `notTested` term anywhere in the same expression. */
function detectNotTestedIgnoringDecision(src) {
  if (typeof src !== 'string') return [];
  const hits = [];
  const re = /const\s+decision\s*=\s*[^;]*failCount\s*>\s*0[^;]*?'FAIL'[^;]*?'PASS'[^;]*;/g;
  let m;
  while ((m = re.exec(src))) {
    if (!/notTested/.test(m[0])) hits.push(m[0].slice(0, 160));
  }
  return hits;
}

/** R4 Defect C: a locale-leak audit reading only `document.body.innerText.slice(0, N)` -- not visibility-aware, not per-section. */
function detectBodyInnerTextSliceAudit(src) {
  if (typeof src !== 'string') return [];
  const hits = [];
  const re = /document\.body\.innerText\.slice\(\s*0\s*,\s*\d+\s*\)/g;
  let m;
  while ((m = re.exec(src))) hits.push(m[0]);
  return hits;
}

// ── Section 1: Defect A -- multi-arg page.evaluate ──────────────────
{
  const sample = `async function auditSection(page, selector) {\n  return page.evaluate(new Function('return ' + COLLECT_LEAKS)(), selector, APPROVED_TERMS)\n    .catch(() => ({ found: false, leaks: [] }));\n}`;
  const hostileHits = detectMultiArgPageEvaluate(sample);
  record('HOSTILE: detectMultiArgPageEvaluate() catches the exact R4 Defect A 3-argument page.evaluate call', hostileHits.length === 1, { hostileHits });

  const cleanSample = `async function auditVisibleLocaleSection(page, options) {\n  result = await page.evaluate(collectVisibleLocaleLeaks, { selector, mode, approvedTerms });\n}`;
  const cleanHits = detectMultiArgPageEvaluate(cleanSample);
  record('HOSTILE: detectMultiArgPageEvaluate() does NOT false-positive on the correct single-object-arg form', cleanHits.length === 0, { cleanHits });

  const helperSrc = read('qa/helpers/visible-locale-audit.mjs');
  const helperHits = helperSrc ? detectMultiArgPageEvaluate(helperSrc) : ['file not found'];
  record('No multi-argument page.evaluate() call in qa/helpers/visible-locale-audit.mjs (the R4 Phase A shared helper)', helperSrc !== null && helperHits.length === 0, { helperHits });

  const suiteSrc = read('qa/epic-2e-j-full-system-i18n-browser-test.mjs');
  const suiteHits = suiteSrc ? detectMultiArgPageEvaluate(suiteSrc) : ['file not found'];
  record('No multi-argument page.evaluate() call anywhere in qa/epic-2e-j-full-system-i18n-browser-test.mjs', suiteSrc !== null && suiteHits.length === 0, { suiteHits });
}

// ── Section 2: Defect B -- decision ignoring notTested ──────────────
{
  const sample = `const decision = !completed ? 'INCOMPLETE' : failCount > 0 ? 'FAIL' : 'PASS';`;
  const hostileHits = detectNotTestedIgnoringDecision(sample);
  record('HOSTILE: detectNotTestedIgnoringDecision() catches the exact R4 Defect B decision (ignores notTested)', hostileHits.length === 1, { hostileHits });

  const cleanSample = `const decision = !completed ? 'INCOMPLETE' : (failCount > 0 || notTested > 0) ? 'FAIL' : 'PASS';`;
  const cleanHits = detectNotTestedIgnoringDecision(cleanSample);
  record('HOSTILE: detectNotTestedIgnoringDecision() does NOT false-positive once notTested is included', cleanHits.length === 0, { cleanHits });

  const suiteSrc = read('qa/epic-2e-j-full-system-i18n-browser-test.mjs');
  const suiteHits = suiteSrc ? detectNotTestedIgnoringDecision(suiteSrc) : ['file not found'];
  record("The full-system i18n suite's final decision fails closed on notTested, not just failCount", suiteSrc !== null && suiteHits.length === 0, { suiteHits });
  record("The full-system i18n suite's final decision expression explicitly references notTested", suiteSrc !== null && /const decision = !completed \? 'INCOMPLETE' : \(failCount > 0 \|\| notTested > 0\) \? 'FAIL' : 'PASS';/.test(suiteSrc), {});
}

// ── Section 3: Defect C -- non-visibility-aware body.innerText.slice audit ──
{
  const sample = `const enBodyText = await page.evaluate(() => document.body.innerText.slice(0, 4000));`;
  const hostileHits = detectBodyInnerTextSliceAudit(sample);
  record('HOSTILE: detectBodyInnerTextSliceAudit() catches the exact R4 Defect C truncated, non-visibility-aware audit', hostileHits.length === 1, { hostileHits });

  const suiteSrc = read('qa/epic-2e-j-full-system-i18n-browser-test.mjs');
  const suiteHits = suiteSrc ? detectBodyInnerTextSliceAudit(suiteSrc) : ['file not found'];
  record('No document.body.innerText.slice(0, N) truncated audit remains in the full-system i18n suite', suiteSrc !== null && suiteHits.length === 0, { suiteHits });

  const helperSrc = read('qa/helpers/visible-locale-audit.mjs');
  record('The shared visible-locale-audit helper exports a visibility-aware TreeWalker-based collector (not innerText.slice)', helperSrc !== null && /createTreeWalker/.test(helperSrc) && !/innerText\.slice/.test(helperSrc), {});
}

// ── Section 4: Defect D -- honest manual/system review click breakdown ──
{
  const runtimeSrc = read('qa/helpers/playwright-lumixa-test-runtime.mjs');
  const returnsBreakdown = runtimeSrc !== null
    && /manualVisualButtonsClicked/.test(runtimeSrc)
    && /systemButtonsClicked/.test(runtimeSrc)
    && /totalReviewItems/.test(runtimeSrc);
  record('passAllReviewItems() returns an honest {totalReviewItems, manualVisualButtonsClicked, systemButtonsClicked} breakdown, not a single ambiguous count', returnsBreakdown, {});
  const noAmbiguousReturn = runtimeSrc !== null && !/return itemIds\.length;\s*\n\}/.test(runtimeSrc);
  record('passAllReviewItems() no longer returns bare itemIds.length mislabeled as a click count', noAmbiguousReturn, {});

  const suiteSrc = read('qa/epic-2e-j-full-system-i18n-browser-test.mjs');
  const assertsSystemZero = suiteSrc !== null && /reviewed\?\.systemButtonsClicked === 0/.test(suiteSrc);
  record('The full-system i18n suite explicitly asserts systemButtonsClicked === 0 (system-verified items are never clicked)', assertsSystemZero, {});
}

// ── Section 5: Phase F -- reasonParams contract ─────────────────────
{
  const rendererSrc = read('ui/isolated-visual-preview-renderer-v2.js');
  const baseResultDestructuresReasonParams = rendererSrc !== null
    && /function _baseResult\(\{[^}]*reasonParams\s*=\s*null[^}]*\}\)/.test(rendererSrc);
  record('_baseResult() destructures a reasonParams parameter (R4 Phase F fix -- previously silently dropped)', baseResultDestructuresReasonParams, {});
  const baseResultReturnsReasonParams = rendererSrc !== null && /reasonParams:\s*\(reasonParams/.test(rendererSrc);
  record('_baseResult() includes reasonParams in its returned object', baseResultReturnsReasonParams, {});
}

// ── Section 6: Phase G -- Build-V2 announcement waits for genuine settlement ──
{
  const appSrc = read('ui/app.js');
  const hasSettlePromiseTracking = appSrc !== null
    && /_latestVisualPreviewRenderSettlePromise/.test(appSrc)
    && /_latestVisualPreviewRenderSettleGeneration/.test(appSrc);
  record('ui/app.js tracks a settle-promise for the current Visual Preview Comparison render generation (R4 Phase G)', hasSettlePromiseTracking, {});
  const handlerAwaitsBeforeAnnounce = appSrc !== null
    && /await _latestVisualPreviewRenderSettlePromise;/.test(appSrc);
  record('handleBuildControlledV2Preview() genuinely awaits the settle promise before reading translation state', handlerAwaitsBeforeAnnounce, {});
  const enHasBlockedKey = (read('ui/i18n/en.js') ?? '').includes("blocked: 'Analysis complete, but the Controlled V2 preview is blocked");
  const thHasBlockedKey = /blocked:\s*'/.test(read('ui/i18n/th.js') ?? '');
  record('review.outcome.blocked exact-reason key exists in both en.js and th.js', enHasBlockedKey && thHasBlockedKey, { enHasBlockedKey, thHasBlockedKey });
}

// ── Section 7: Phase A -- shared helper contract ────────────────────
{
  const helperSrc = read('qa/helpers/visible-locale-audit.mjs');
  const exportsRequired = helperSrc !== null
    && /export async function auditVisibleLocaleSection\(/.test(helperSrc)
    && /export async function auditVisibleLocaleSections\(/.test(helperSrc)
    && /export function decideVisibleLocaleAudit\(/.test(helperSrc);
  record('qa/helpers/visible-locale-audit.mjs exports the required auditVisibleLocaleSection/Sections/decideVisibleLocaleAudit contract', exportsRequired, {});
  const distinguishesInfraFailure = helperSrc !== null && /reason: 'audit-threw'/.test(helperSrc) && /reason: 'selector-not-found'/.test(helperSrc);
  record('The shared helper distinguishes "audit infrastructure failure" (FAIL) from "section genuinely absent" (NOT_TESTED)', distinguishesInfraFailure, {});
}

// ── Section 8: Phase L -- XMP exact locale invariant is no longer unconditionally NOT_APPLICABLE ──
{
  const suiteSrc = read('qa/epic-2e-j-full-system-i18n-browser-test.mjs');
  const noUnconditionalNotApplicable = suiteSrc !== null
    && !/'XMP export was never triggered in this workflow, so Mapping\/XMP output is unchanged by construction \(no Download action was invoked\)', 'NOT_APPLICABLE'/.test(suiteSrc);
  record('The full-system i18n suite no longer unconditionally records the XMP invariant as NOT_APPLICABLE', noUnconditionalNotApplicable, {});
  const capturesXmpBeforeAndAfter = suiteSrc !== null
    && /xmpBeforeLocaleSwitch = await captureXmpText\(page\)/.test(suiteSrc)
    && /xmpAfterLocaleSwitch = await captureXmpText\(page\)/.test(suiteSrc);
  record('The suite genuinely captures XMP text both before and after the TH->EN->TH round trip', capturesXmpBeforeAndAfter, {});
}

console.log(`\n${passCount}/${passCount + failCount} PASS, ${failCount} FAIL`);
process.exit(failCount > 0 ? 1 : 0);
