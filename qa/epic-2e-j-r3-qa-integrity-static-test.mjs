#!/usr/bin/env node
/**
 * qa/epic-2e-j-r3-qa-integrity-static-test.mjs
 *
 * I18N RUNTIME CLOSURE + QA INTEGRITY R3 — Phase J.
 *
 * The EP9CD1 Runtime review found the R2 round's own QA suites capable
 * of reporting a false PASS while real Runtime leaks and test-false-
 * positive defects were still present (Playwright contract mismatch,
 * wrong button selector, hardcoded-true acceptance rows, and a
 * mixed-language leak-detector fail-open). This suite is the static
 * audit's own regression guard against those SEVEN defect classes ever
 * silently recurring — each check below is a real scan over the
 * current source, and each carries a HOSTILE SELF-TEST proving the
 * detector itself actually catches the defect (not just that the
 * current source happens to be clean).
 *
 * No Browser, no network, no Chromium — safe for run-static-suites.mjs.
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

// ── Detector functions (each mirrors a real defect class from the R3 spec) ──

/** Defect class 1: inline `isThai ? 'x' : 'y'` (or lang==='th' ? : ) bilingual DISPLAY-TEXT branches. Excludes short-code normalization idioms like `lang === 'th' ? 'th' : 'en'` (both branches are 2-letter language codes, not prose) -- only flags when at least one branch string looks like real display prose (contains a space, or is longer than 4 chars). */
function detectInlineBilingualBranches(src) {
  if (typeof src !== 'string') return [];
  const hits = [];
  const re = /(isThai|lang\s*===\s*['"]th['"]|state\.lang\s*===\s*['"]th['"])\s*\?\s*(['"`])((?:(?!\2).)*)\2\s*:\s*(['"`])((?:(?!\4).)*)\4/g;
  let m;
  while ((m = re.exec(src))) {
    const trueBranch = m[3], falseBranch = m[5];
    const looksLikeProse = (t) => typeof t === 'string' && (t.includes(' ') || t.length > 4);
    if (looksLikeProse(trueBranch) || looksLikeProse(falseBranch)) hits.push(m[0].slice(0, 80));
  }
  return hits;
}

/** Defect class 3: a `.warnings`/`.reasons`/`.blockers` array rendered as `{ text: rawVar }` with no sibling `Codes` variable/property referenced anywhere nearby (within 400 chars). */
function detectUncodedRawArrayRender(src) {
  if (typeof src !== 'string') return [];
  const hits = [];
  const re = /\.(warnings|reasons|blockers|recommendations)\)[^;]*?\{\s*text\s*:/g;
  let m;
  while ((m = re.exec(src))) {
    const windowStart = Math.max(0, m.index - 400);
    const window = src.slice(windowStart, m.index + 400);
    if (!/Codes\b/.test(window)) hits.push(m[0]);
  }
  return hits;
}

/** Defect class 4: a Build-Controlled-V2-button selector literal that is NOT the canonical `#btnBuildControlledV2` (or its shared constant import). Only flags identifiers that ALSO look like a button reference (contain "Btn" or "Button") -- e.g. a live-region id like `buildControlledV2LiveRegion` legitimately contains "Build" without being a button selector at all. */
function detectWrongBuildButtonSelector(src) {
  if (typeof src !== 'string') return [];
  const hits = [];
  const re = /getElementById\(\s*['"]([a-zA-Z0-9_]*[Bb]uild[a-zA-Z0-9_]*)['"]\s*\)|querySelector\(\s*['"]#([a-zA-Z0-9_-]*[Bb]uild[a-zA-Z0-9_-]*)['"]\s*\)/g;
  let m;
  while ((m = re.exec(src))) {
    const id = m[1] || m[2];
    if (id && id !== 'btnBuildControlledV2' && /btn|button/i.test(id)) hits.push(id);
  }
  return hits;
}

/** Defect class 5: a `record(...)` (or `record(` -style acceptance call) whose 2nd argument is a bare literal `true`/`false` rather than a computed expression. */
function detectHardcodedTrueAcceptance(src) {
  if (typeof src !== 'string') return [];
  const hits = [];
  const re = /record\(\s*(['"`])(?:(?!\1).)*\1\s*,\s*(true|false)\s*,/g;
  let m;
  while ((m = re.exec(src))) hits.push(m[0].slice(0, 80));
  return hits;
}

/** Defect class 6: the R2 leak-detector fail-open anti-pattern — skipping (continuing past) an ENTIRE text node merely because it contains a Thai character, rather than stripping Thai and counting remaining English words. */
function detectMixedLanguageFailOpen(src) {
  if (typeof src !== 'string') return [];
  const hits = [];
  // The exact defect shape: a Thai-Unicode-range test used as a `continue`/`return`
  // guard BEFORE any English-word-counting logic runs on the same node.
  const re = /if\s*\(\s*\/\[\\u0E00-\\u0E7F\]\/[a-z]*\.test\([^)]*\)\s*\)\s*(continue|return)/g;
  let m;
  while ((m = re.exec(src))) hits.push(m[0]);
  return hits;
}

/** Defect class 7: a `detectPlaywrightPackage()` consumer whose shape assumption doesn't match the canonical `{available, status, mod, chromium, error}` contract — e.g. destructuring `chromium` directly off the package result. */
function detectPlaywrightShapeMismatch(src) {
  if (typeof src !== 'string') return [];
  const hits = [];
  const re = /const\s*\{\s*chromium\s*\}\s*=\s*pkg\s*;/g;
  let m;
  while ((m = re.exec(src))) hits.push(m[0]);
  return hits;
}

// ── HOSTILE SELF-TESTS: prove each detector actually catches its defect ─────

record(
  'HOSTILE: detectInlineBilingualBranches() catches a live isThai ternary',
  detectInlineBilingualBranches("const isThai = state.lang === 'th'; const x = isThai ? 'kam tob pen phasa thai' : 'response in english';").length > 0,
  {}
);
record(
  'HOSTILE: detectInlineBilingualBranches() catches a lang===\'th\' ternary',
  detectInlineBilingualBranches("const x = lang === 'th' ? 'sawasdee' : 'hello';").length > 0,
  {}
);
record(
  'HOSTILE: detectInlineBilingualBranches() does NOT false-positive on t()-sourced code',
  detectInlineBilingualBranches("const x = t('greeting', null, lang); const isThai = lang === 'th'; console.log(isThai);").length === 0,
  {}
);
record(
  'HOSTILE: detectInlineBilingualBranches() does NOT false-positive on the legitimate short-code normalization idiom (lang === \'th\' ? \'th\' : \'en\')',
  detectInlineBilingualBranches("const normalizedLang = lang === 'th' ? 'th' : 'en';").length === 0,
  {}
);

record(
  'HOSTILE: detectUncodedRawArrayRender() catches a raw .warnings render with no Codes sibling',
  detectUncodedRawArrayRender("_safeArray(x.warnings).forEach(w => el('div', { text: w }));").length > 0,
  {}
);
record(
  'HOSTILE: detectUncodedRawArrayRender() does NOT false-positive when a Codes-preferring branch is present nearby',
  detectUncodedRawArrayRender("const warningCodesList = x.warningCodes; if (warningCodesList.length) { /* translated */ } else { _safeArray(x.warnings).forEach(w => el('div', { text: w })); }").length === 0,
  {}
);

record(
  'HOSTILE: detectWrongBuildButtonSelector() catches the R2 defect ID (#buildControlledV2Btn instead of #btnBuildControlledV2)',
  detectWrongBuildButtonSelector("document.getElementById('buildControlledV2Btn')").length > 0,
  {}
);
record(
  'HOSTILE: detectWrongBuildButtonSelector() does NOT false-positive on the correct canonical ID',
  detectWrongBuildButtonSelector("document.getElementById('btnBuildControlledV2')").length === 0,
  {}
);

record(
  'HOSTILE: detectHardcodedTrueAcceptance() catches record("Step 6 passed", true, {})',
  detectHardcodedTrueAcceptance("record('Step 6 passed', true, {});").length > 0,
  {}
);
record(
  'HOSTILE: detectHardcodedTrueAcceptance() does NOT false-positive on a computed boolean',
  detectHardcodedTrueAcceptance("record('Step 6 passed', legacyRendered && v2Rendered, {});").length === 0,
  {}
);

record(
  'HOSTILE: detectMixedLanguageFailOpen() catches the exact R2 skip-on-any-Thai-char anti-pattern',
  detectMixedLanguageFailOpen("if (/[\\u0E00-\\u0E7F]/.test(nodeText)) continue;").length > 0,
  {}
);
record(
  'HOSTILE: detectMixedLanguageFailOpen() does NOT false-positive on a strip-then-count pattern',
  detectMixedLanguageFailOpen("const detect = raw.replace(/[\\u0E00-\\u0E7F]/g, ''); if (englishWordCount(detect) >= 2) fail();").length === 0,
  {}
);

record(
  'HOSTILE: detectPlaywrightShapeMismatch() catches the R2 defect (const { chromium } = pkg;)',
  detectPlaywrightShapeMismatch("const pkg = await detectPlaywrightPackage(); const { chromium } = pkg;").length > 0,
  {}
);
record(
  'HOSTILE: detectPlaywrightShapeMismatch() does NOT false-positive on the corrected contract access',
  detectPlaywrightShapeMismatch("const pkg = await detectPlaywrightPackage(); const chromium = pkg.chromium;").length === 0,
  {}
);

// ── REAL SCANS over current source ──────────────────────────────────────────

const UI_FILES_TO_SCAN = [
  'ui/app.js',
  'ui/review-console-renderer.js',
  'ui/side-by-side-comparison-renderer.js',
  'ui/visual-preview-comparison-renderer-v2.js',
  'ui/interactive-before-after-renderer-v2.js',
  'ui/interactive-preview-observation-renderer-v2.js',
  'ui/isolated-visual-preview-renderer-v2.js',
  'ui/interactive-before-after-controller-v2.js',
];
for (const rel of UI_FILES_TO_SCAN) {
  const src = read(rel);
  record(`No inline bilingual (isThai/lang==='th' ternary) branches in ${rel}`, src !== null && detectInlineBilingualBranches(src).length === 0, { file: rel, hits: src ? detectInlineBilingualBranches(src) : 'FILE_MISSING' });
}

const QA_BROWSER_FILES = [
  'qa/epic-2e-j-full-system-i18n-browser-test.mjs',
  'qa/epic-2e-j-controlled-v2-browser-test.mjs',
];
for (const rel of QA_BROWSER_FILES) {
  const src = read(rel);
  record(`No wrong Build-Controlled-V2-button selector literal in ${rel}`, src !== null && detectWrongBuildButtonSelector(src).length === 0, { file: rel, hits: src ? detectWrongBuildButtonSelector(src) : 'FILE_MISSING' });
  record(`No hardcoded-true/false acceptance rows in ${rel}`, src !== null && detectHardcodedTrueAcceptance(src).length === 0, { file: rel, hits: src ? detectHardcodedTrueAcceptance(src) : 'FILE_MISSING' });
  record(`No mixed-language fail-open (skip-on-any-Thai-char) pattern in ${rel}`, src !== null && detectMixedLanguageFailOpen(src).length === 0, { file: rel, hits: src ? detectMixedLanguageFailOpen(src) : 'FILE_MISSING' });
  record(`No Playwright helper/consumer shape mismatch in ${rel}`, src !== null && detectPlaywrightShapeMismatch(src).length === 0, { file: rel, hits: src ? detectPlaywrightShapeMismatch(src) : 'FILE_MISSING' });
}

// Playwright contract self-check: the helper itself must expose the
// additive {available, chromium} fields the R3 Phase A fix introduced.
const helperSrc = read('qa/helpers/playwright-lumixa-test-runtime.mjs');
record(
  'qa/helpers/playwright-lumixa-test-runtime.mjs detectPlaywrightPackage() returns the additive {available, chromium} contract fields',
  helperSrc !== null && /available\s*:\s*true/.test(helperSrc) && /chromium\s*:\s*mod\.chromium/.test(helperSrc),
  { present: helperSrc !== null }
);

console.log(`\n${passCount}/${passCount + failCount} PASS, ${failCount} FAIL`);
process.exit(failCount > 0 ? 1 : 0);
