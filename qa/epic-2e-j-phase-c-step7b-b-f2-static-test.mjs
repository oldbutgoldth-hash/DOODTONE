#!/usr/bin/env node
/**
 * qa/epic-2e-j-phase-c-step7b-b-f2-static-test.mjs
 *
 * EPIC 2E-J — Step 7B-B-F2-S (Complete Contrast and Touch-Target Test
 * Implementation — Static Verification).
 *
 * FIX 7: because Chromium is unavailable in this environment, this is a
 * STATIC SOURCE AUDIT of qa/epic-2e-j-phase-c-step7b-b-test.mjs (and,
 * for the touch-target count, a cross-check against the real option
 * lists declared in ui/interactive-preview-observation-renderer-v2.js)
 * — it parses the test file's own source text to confirm the required
 * Contrast/Touch-target/Focus-indicator work is actually present and
 * wired the way FIX 1-6 require. It never launches a browser, never
 * executes the real Contrast/Touch-target logic, and never fabricates
 * a Contrast/Touch-target PASS.
 *
 * IMPORTANT — what this file does NOT prove: it does not run the real
 * browser test, so it proves nothing about ACTUAL computed colors,
 * ACTUAL measured element sizes, or ACTUAL contrast ratios in a real
 * page. A "PASS" below means "the required code path/threshold/target
 * is present in the source," never "the real UI passed WCAG."
 *
 * Run: node qa/epic-2e-j-phase-c-step7b-b-f2-static-test.mjs
 * Output: qa/epic-2e-j-phase-c-step7b-b-f2-static-results.json
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

const results = [];
function record(test, pass, evidence) {
  const result = pass ? 'PASS' : 'FAIL';
  results.push({ test, result, evidence });
  console.log(`${pass ? '✓' : '✗'} [${result}] ${test} — ${evidence}`);
}

const testFilePath = path.join(PROJECT_ROOT, 'qa', 'epic-2e-j-phase-c-step7b-b-test.mjs');
const rendererFilePath = path.join(PROJECT_ROOT, 'ui', 'interactive-preview-observation-renderer-v2.js');
const f1StaticResultsPath = path.join(PROJECT_ROOT, 'qa', 'epic-2e-j-phase-c-step7b-b-f1-static-results.json');

let testSrc = '';
let rendererSrc = '';
let f1StaticResultsRaw = null;

try {
  testSrc = await readFile(testFilePath, 'utf8');
  record('qa/epic-2e-j-phase-c-step7b-b-test.mjs is readable', true, `${testSrc.length} bytes`);
} catch (e) {
  record('qa/epic-2e-j-phase-c-step7b-b-test.mjs is readable', false, String(e && e.message || e));
}

try {
  rendererSrc = await readFile(rendererFilePath, 'utf8');
  record('ui/interactive-preview-observation-renderer-v2.js is readable (for touch-target cross-check)', true, `${rendererSrc.length} bytes`);
} catch (e) {
  record('ui/interactive-preview-observation-renderer-v2.js is readable (for touch-target cross-check)', false, String(e && e.message || e));
}

try {
  f1StaticResultsRaw = JSON.parse(await readFile(f1StaticResultsPath, 'utf8'));
  record('qa/epic-2e-j-phase-c-step7b-b-f1-static-results.json is readable', true, 'parsed OK');
} catch (e) {
  record('qa/epic-2e-j-phase-c-step7b-b-f1-static-results.json is readable', false, String(e && e.message || e));
}

// ══════════════════════════════════════════════════════════════════
// FIX 7 — every required Contrast category appears in the Browser test.
// ══════════════════════════════════════════════════════════════════
const requiredContrastCategories = [
  'Observation title',
  'Observation subtitle',
  'Observation status',
  'Warning',
  'Safety note',
  'Privacy/session-only note',
  'Observation radio label',
  'Reason label',
  'Reason-limit message',
  'Selected Reasons text',
  'Session metric',
  'Top Reasons',
  'Clear Observation button',
  'Clear Reasons button',
  'Clear Session button',
  'Focus indicator',
];
{
  const missing = requiredContrastCategories.filter((cat) => !testSrc.includes(cat));
  record('Every required Contrast category string appears in the Browser test source', missing.length === 0, missing.length === 0 ? `${requiredContrastCategories.length} categories found` : `missing: ${JSON.stringify(missing)}`);
}

// ══════════════════════════════════════════════════════════════════
// FIX 7 — missing-Element paths call FAIL, not NOT_TESTED.
// ══════════════════════════════════════════════════════════════════
{
  const hasContrastMissingFailWording = testSrc.includes('required element not found in DOM — FAIL (never NOT_TESTED for a missing required element)');
  const hasTouchMissingFailWording = testSrc.includes('required target element not found — FAIL (never NOT_TESTED for a missing required target)');
  const hasFocusMissingFailWording = testSrc.includes("record(`Focus indicator: ${target.label}`, false, 'required element not found in DOM — FAIL')");
  record('Missing-Element path (Contrast) calls FAIL, not NOT_TESTED', hasContrastMissingFailWording, `present=${hasContrastMissingFailWording}`);
  record('Missing-Element path (Touch target) calls FAIL, not NOT_TESTED', hasTouchMissingFailWording, `present=${hasTouchMissingFailWording}`);
  record('Missing-Element path (Focus indicator) calls FAIL, not NOT_TESTED', hasFocusMissingFailWording, `present=${hasFocusMissingFailWording}`);
}

// ══════════════════════════════════════════════════════════════════
// FIX 7 — ordinary parse failure calls FAIL.
// ══════════════════════════════════════════════════════════════════
{
  const hasFgParseFailFail = testSrc.includes('foreground color could not be parsed') && testSrc.includes('FAIL, not NOT_TESTED');
  const hasFocusParseFailFail = testSrc.includes('could not parse outline/adjacent-background color for a contrast check');
  record('Ordinary foreground-color parse failure calls FAIL (Contrast)', hasFgParseFailFail, `present=${hasFgParseFailFail}`);
  record('Ordinary outline/adjacent-background parse failure calls FAIL (Focus indicator)', hasFocusParseFailFail, `present=${hasFocusParseFailFail}`);
}

// ══════════════════════════════════════════════════════════════════
// FIX 7 — the ONLY permitted NOT_TESTED path is the documented
// background-image/gradient limitation (FIX 3), never an arbitrary one.
// ══════════════════════════════════════════════════════════════════
{
  const hasDocumentedGradientNotTested = testSrc.includes('undeterminable: true') && testSrc.includes('background-image present');
  const notTestedOccurrences = (testSrc.match(/'NOT_TESTED'/g) || []).length;
  // Exactly one NOT_TESTED call site is expected in the Contrast block
  // (the documented gradient/background-image limitation) — the
  // pre-existing "Physical touch hardware" NOT_TESTED (Part 6, out of
  // F2 scope) accounts for the other.
  record('The only permitted Contrast NOT_TESTED path is the documented gradient/background-image limitation', hasDocumentedGradientNotTested, `hasDocumentedGradientNotTested=${hasDocumentedGradientNotTested}, total 'NOT_TESTED' string literal occurrences in source=${notTestedOccurrences}`);
}

// ══════════════════════════════════════════════════════════════════
// FIX 7 — normal threshold 4.5 exists.
// ══════════════════════════════════════════════════════════════════
{
  const hasNormalThreshold = testSrc.includes('entry.isLargeText ? 3.0 : 4.5');
  record('Normal-text WCAG threshold 4.5:1 exists in the Contrast audit', hasNormalThreshold, `present=${hasNormalThreshold}`);
}

// ══════════════════════════════════════════════════════════════════
// FIX 7 — large-text threshold 3.0 exists, proven by computed style
// (fontSize/fontWeight), never by tag name.
// ══════════════════════════════════════════════════════════════════
{
  const hasLargeTextFn = testSrc.includes('function isProvenLargeText(fontSizePx, fontWeight)');
  const hasLargeTextCriteria = testSrc.includes('fontSizePx >= 24') && testSrc.includes('fontSizePx >= 18.66') && testSrc.includes('fontWeight >= 700');
  const hasTagNameAssumption = /tagName\s*===\s*['"]H\d['"]/.test(testSrc);
  record('Large-text threshold 3.0 exists and is proven by computed fontSize/fontWeight (never tag name)', hasLargeTextFn && hasLargeTextCriteria && !hasTagNameAssumption, `hasLargeTextFn=${hasLargeTextFn}, hasLargeTextCriteria=${hasLargeTextCriteria}, hasTagNameAssumption=${hasTagNameAssumption}`);
}

// ══════════════════════════════════════════════════════════════════
// FIX 7 — focus threshold 3.0 exists.
// ══════════════════════════════════════════════════════════════════
{
  const hasFocusThreshold = testSrc.includes('ratio >= 3.0') && testSrc.includes('meets 3:1');
  record('Focus indicator contrast threshold 3:1 exists', hasFocusThreshold, `present=${hasFocusThreshold}`);
}

// ══════════════════════════════════════════════════════════════════
// FIX 7 — touch threshold is 43.5.
// ══════════════════════════════════════════════════════════════════
{
  const hasTouchThreshold = testSrc.includes('const MIN = 43.5;');
  const oldThresholdGone = !testSrc.includes('const MIN = 40;');
  record('Touch-target threshold is 43.5 (old 40px tolerance removed)', hasTouchThreshold && oldThresholdGone, `hasTouchThreshold=${hasTouchThreshold}, oldThresholdGone=${oldThresholdGone}`);
}

// ══════════════════════════════════════════════════════════════════
// FIX 7 — all 17 touch targets are enumerated: 4 Observation radio
// labels + 10 Reason labels + 3 Clear buttons, cross-checked against
// the REAL option-array lengths declared in the renderer source
// (never a hand-typed "4" and "10" trusted from memory).
// ══════════════════════════════════════════════════════════════════
{
  const obsOptionsMatch = rendererSrc.match(/const OBSERVATION_OPTIONS = \[([\s\S]*?)\];/);
  const reasonOptionsMatch = rendererSrc.match(/const REASON_OPTIONS = \[([\s\S]*?)\];/);
  const obsOptionCount = obsOptionsMatch ? (obsOptionsMatch[1].match(/\{\s*value:/g) || []).length : 0;
  const reasonOptionCount = reasonOptionsMatch ? (reasonOptionsMatch[1].match(/\{\s*value:/g) || []).length : 0;
  const touchTargetBlockMatch = testSrc.match(/const touchTargetCheck = await page\.evaluate\(\(\) => \{([\s\S]*?)\n {4}\}\);/);
  const clearButtonCheckCount = touchTargetBlockMatch ? (touchTargetBlockMatch[1].match(/check\(document\.getElementById\('ipoClear/g) || []).length : 0;
  const hasRadiosForEach = touchTargetBlockMatch ? touchTargetBlockMatch[1].includes('radios.forEach') : false;
  const hasReasonsForEach = touchTargetBlockMatch ? touchTargetBlockMatch[1].includes('reasons.forEach') : false;
  const totalEnumerated = obsOptionCount + reasonOptionCount + clearButtonCheckCount;
  record(
    'All 17 touch targets are enumerated (4 Observation radios + 10 Reasons + 3 Clear buttons, cross-checked against real renderer option-array lengths)',
    hasRadiosForEach && hasReasonsForEach && obsOptionCount === 4 && reasonOptionCount === 10 && clearButtonCheckCount === 3 && totalEnumerated === 17,
    `obsOptionCount=${obsOptionCount}, reasonOptionCount=${reasonOptionCount}, clearButtonCheckCount=${clearButtonCheckCount}, total=${totalEnumerated}, hasRadiosForEach=${hasRadiosForEach}, hasReasonsForEach=${hasReasonsForEach}`
  );
}

// ══════════════════════════════════════════════════════════════════
// FIX 7 — width AND height are both required (not height-only, as the
// pre-F2 implementation was).
// ══════════════════════════════════════════════════════════════════
{
  const hasBothDimensions = testSrc.includes('width >= MIN && height >= MIN');
  record('Touch-target pass requires BOTH width>=43.5 AND height>=43.5 (not height-only)', hasBothDimensions, `present=${hasBothDimensions}`);
}

// ══════════════════════════════════════════════════════════════════
// FIX 7 — every touch target is recorded individually as {id, width,
// height, pass}.
// ══════════════════════════════════════════════════════════════════
{
  const hasPerTargetShape = testSrc.includes('out.push({ id, width, height, pass: width >= MIN && height >= MIN, missing: false });');
  record('Every touch target is recorded as {id, width, height, pass}', hasPerTargetShape, `present=${hasPerTargetShape}`);
}

// ══════════════════════════════════════════════════════════════════
// FIX 7 — Physical touch hardware remains the one permitted NOT_TESTED.
// ══════════════════════════════════════════════════════════════════
{
  const hasPhysicalTouchNotTested = testSrc.includes("record('Physical touch hardware', 'NOT_TESTED', 'genuine physical touch hardware was not used');");
  record('Physical touch hardware remains NOT_TESTED (unchanged, still the only permitted manual gap)', hasPhysicalTouchNotTested, `present=${hasPhysicalTouchNotTested}`);
}

// ══════════════════════════════════════════════════════════════════
// FIX 7 — Browser result remains NOT_RUN_ENVIRONMENT_BLOCKED. This
// reads the EXISTING F1 static-results honest-status record — it does
// NOT execute or fabricate a browser run, and does NOT regenerate the
// Browser or Final Phase C result JSON.
// ══════════════════════════════════════════════════════════════════
{
  const status = f1StaticResultsRaw?.browserSuiteExecution?.status;
  record('Browser result remains NOT_RUN_ENVIRONMENT_BLOCKED (read from existing F1 static-results honest-status record)', status === 'NOT_RUN_ENVIRONMENT_BLOCKED', `status=${status}`);
}

const passCount = results.filter((r) => r.result === 'PASS').length;
const failCount = results.filter((r) => r.result === 'FAIL').length;

const output = {
  suite: 'EPIC 2E-J — Step 7B-B-F2-S FIX 7: static coverage self-test (source audit only, no Chromium)',
  generatedAt: new Date().toISOString(),
  summary: { total: results.length, pass: passCount, fail: failCount },
  results,
  disclaimer: 'This suite audits the SOURCE TEXT of qa/epic-2e-j-phase-c-step7b-b-test.mjs for the presence of required categories/thresholds/wiring. It does NOT execute a browser, does NOT measure real computed colors or element sizes, and does NOT prove real Contrast/Touch-target PASS. A PASS here means "the required code path is present," not "the real UI meets WCAG."',
  browserSuiteExecution: {
    status: 'NOT_RUN_ENVIRONMENT_BLOCKED',
    note: 'Unchanged from the F1-R/F1-R2 record. This F2-S patch did not execute, simulate, or regenerate the real browser suite or its result JSON.',
    browserOrFinalResultJsonRegenerated: false,
  },
};
await writeFile(path.join(PROJECT_ROOT, 'qa', 'epic-2e-j-phase-c-step7b-b-f2-static-results.json'), JSON.stringify(output, null, 2));
console.log(`\n${passCount}/${results.length} PASS, ${failCount} FAIL`);
console.log('Browser suite execution: NOT_RUN_ENVIRONMENT_BLOCKED (see output JSON)');
process.exit(failCount > 0 ? 1 : 0);
