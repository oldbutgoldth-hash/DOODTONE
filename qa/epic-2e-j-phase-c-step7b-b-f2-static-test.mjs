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
import { detectPlaywrightPackage, detectBrowserExecutable } from './helpers/playwright-lumixa-test-runtime.mjs';

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
  // Step 7B-B-F2-S2: wording updated so the same shared path also
  // covers "required non-empty text was not present" (FIX 3) — the
  // underlying behavior (FAIL, never NOT_TESTED, never PASS merely
  // because the element exists) is unchanged.
  const hasContrastMissingFailWording = testSrc.includes('required element not found in DOM, or required non-empty text was not present — FAIL (never NOT_TESTED for a missing required element or empty required text, never PASS merely because the element exists)');
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
  // Step 7B-B-F2-S2 FIX 5: wording updated to reflect that the ACTUAL
  // active indicator color source (outline OR box-shadow) is what gets
  // parsed and can fail to parse — never a hard-coded "outline" name.
  const hasFocusParseFailFail = testSrc.includes('could not parse the ACTUAL active indicator color') && testSrc.includes('FAIL, not NOT_TESTED');
  record('Ordinary foreground-color parse failure calls FAIL (Contrast)', hasFgParseFailFail, `present=${hasFgParseFailFail}`);
  record('Ordinary outline/box-shadow indicator-color parse failure calls FAIL (Focus indicator)', hasFocusParseFailFail, `present=${hasFocusParseFailFail}`);
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
// FIX 7 (COMBINED CLOSEOUT R1 revision) — Browser suite status is
// LIVE-DETECTED in this file, not read as a retired literal. This does
// NOT execute or fabricate a browser run, and does NOT regenerate the
// Browser or Final Phase C result JSON — it only detects whether a
// Playwright package/Chromium binary is currently present.
// ══════════════════════════════════════════════════════════════════
const livePkgStatus = await detectPlaywrightPackage();
const liveExeStatus = await detectBrowserExecutable(livePkgStatus.mod ? livePkgStatus.mod.chromium : null);
const liveBrowserStatus = liveExeStatus.found ? 'BROWSER_BINARY_AVAILABLE' : 'BROWSER_BINARY_UNAVAILABLE';
{
  const ownSrc = await readFile(fileURLToPath(import.meta.url), 'utf8');
  // Scan only the output-object construction (after this diagnostic block's
  // own source, which legitimately mentions the retired literal as a string
  // for comparison purposes) to avoid a self-referential false match.
  const outputBlockSrc = ownSrc.slice(ownSrc.lastIndexOf('const output = {'));
  const outputUsesLiveStatus = outputBlockSrc.includes('status: liveBrowserStatus') && !outputBlockSrc.includes("status: 'NOT_RUN_ENVIRONMENT_BLOCKED'");
  const f1Status = f1StaticResultsRaw?.browserSuiteExecution?.status;
  const f1IsRecognizedLiveValue = f1Status === 'BROWSER_BINARY_AVAILABLE' || f1Status === 'BROWSER_BINARY_UNAVAILABLE';
  record(
    'Browser result is live-detected as BROWSER_BINARY_AVAILABLE/UNAVAILABLE (retired NOT_RUN_ENVIRONMENT_BLOCKED literal no longer emitted; consistent with F1 static-results honest-status record)',
    outputUsesLiveStatus && f1IsRecognizedLiveValue,
    `liveBrowserStatus=${liveBrowserStatus}, outputUsesLiveStatus=${outputUsesLiveStatus}, f1Status=${f1Status}`
  );
}

// ══════════════════════════════════════════════════════════════════
// Step 7B-B-F2-S2 FIX 6 — new static assertions covering FIX 1-5.
// ══════════════════════════════════════════════════════════════════

// FIX 1 — background-image is inspected UNCONDITIONALLY on every
// visited element, before/regardless of any opaque-color break — the
// old F2-S gated pattern ("!foundOpaque && ... bgImageBeforeOpaque
// === null") must be gone, and the corrected unconditional check must
// be present in all THREE page.evaluate() call sites that resolve an
// effective background (Warning capture, main Contrast sweep, Focus
// indicator).
{
  const oldGatedPatternGone = !testSrc.includes('!foundOpaque && style.backgroundImage');
  const unconditionalCheckOccurrences = (testSrc.match(/if \(style\.backgroundImage && style\.backgroundImage !== 'none' && contributingBgImage === null\) contributingBgImage = style\.backgroundImage;/g) || []).length;
  record(
    'FIX 1: background-image is checked unconditionally on every visited element, before any opaque-color break (old gated pattern removed)',
    oldGatedPatternGone && unconditionalCheckOccurrences === 3,
    `oldGatedPatternGone=${oldGatedPatternGone}, unconditionalCheckOccurrences=${unconditionalCheckOccurrences} (expected 3: Warning capture, main Contrast sweep, Focus indicator)`
  );
}
// FIX 1 continued — a contributing background-image can no longer be
// silently cleared just because an opaque color was eventually found
// on a later ancestor (the old "if (bgImageBeforeOpaque && !foundOpaque)"
// gate is gone; the corrected check is unconditional on
// contributingBgImage alone).
{
  const oldClearingGateGone = !testSrc.includes('if (bgImageBeforeOpaque && !foundOpaque)');
  const unconditionalUndeterminableOccurrences = (testSrc.match(/if \(contributingBgImage\) return \{ undeterminable: true/g) || []).length;
  record(
    'FIX 1: a contributing background-image is never silently cleared once an opaque ancestor is later found',
    oldClearingGateGone && unconditionalUndeterminableOccurrences === 3,
    `oldClearingGateGone=${oldClearingGateGone}, unconditionalUndeterminableOccurrences=${unconditionalUndeterminableOccurrences} (expected 3)`
  );
}

// FIX 2 — foreground color is parsed as RGBA (4-tuple with alpha),
// never just a 3-component opaque color.
{
  const hasParseRgbaLocal = (testSrc.match(/function parseRgbaLocal\(str\)/g) || []).length >= 3;
  const capturesFgRgba = testSrc.includes('fgRgba: parseRgbaLocal(style.color)');
  record('FIX 2: foreground color is parsed as RGBA (4-tuple with alpha), not just opaque RGB', hasParseRgbaLocal && capturesFgRgba, `parseRgbaLocalOccurrences>=3=${hasParseRgbaLocal}, capturesFgRgba=${capturesFgRgba}`);
}
// FIX 2 continued — computed opacity on the target AND its ancestors is
// inspected via a bounded walk. Step 7B-B-F2-S3 FIX 2: ancestor opacity
// is NEVER multiplied into the foreground's own alpha (CSS group
// opacity applies to the whole rendered group, not just the foreground
// text color) — the old `fgRgba[3] * opacityValue` composite is gone;
// composition now uses ONLY the foreground's own alpha, and only when
// opacityValue is exactly 1 everywhere.
{
  const hasResolveEffectiveOpacityFn = (testSrc.match(/function resolveEffectiveOpacity\(startEl\)/g) || []).length >= 2;
  const hasBoundedWalk = testSrc.includes('const MAX_STEPS = 25;') && testSrc.includes('steps < MAX_STEPS');
  const oldAncestorOpacityMultiplicationGone = !testSrc.includes('entry.fgRgba[3] * entry.opacityValue');
  const usesOwnAlphaOnly = testSrc.includes('const fgAlpha = entry.fgRgba[3];') && testSrc.includes('const compositedFg = fgAlpha >= 1');
  record(
    'FIX 2 (F2-S3): computed opacity is inspected via a bounded ancestor walk, and ancestor opacity is NEVER multiplied into the foreground alpha (old fgRgba[3]*opacityValue composite removed; composition uses the foreground\'s own alpha only)',
    hasResolveEffectiveOpacityFn && hasBoundedWalk && oldAncestorOpacityMultiplicationGone && usesOwnAlphaOnly,
    `hasResolveEffectiveOpacityFn(>=2)=${hasResolveEffectiveOpacityFn}, hasBoundedWalk=${hasBoundedWalk}, oldAncestorOpacityMultiplicationGone=${oldAncestorOpacityMultiplicationGone}, usesOwnAlphaOnly=${usesOwnAlphaOnly}`
  );
}
// FIX 2 continued (F2-S3) — any target/ancestor opacity below 1 is
// honestly NOT_TESTED ("CSS group opacity requires full
// foreground/background group compositing") rather than fabricating a
// Ratio from a partial/incorrect model.
{
  const hasGroupOpacityNotTested = testSrc.includes("if (entry.opacityValue !== 1) {") && testSrc.includes("record(`Contrast: ${label}`, 'NOT_TESTED', 'CSS group opacity requires full foreground/background group compositing');");
  record('FIX 2 (F2-S3): any target/ancestor opacity below 1 is honestly NOT_TESTED ("CSS group opacity requires full foreground/background group compositing"), never used to fabricate a Ratio', hasGroupOpacityNotTested, `present=${hasGroupOpacityNotTested}`);
}
// FIX 2 continued — an unresolvable opacity chain is honestly
// NOT_TESTED with bounded evidence, never silently treated as
// opacity=1.
{
  const hasOpacityNotTestedPath = testSrc.includes('if (!entry.opacityResolvable) {') && testSrc.includes("record(`Contrast: ${label}`, 'NOT_TESTED', entry.opacityReason);");
  record('FIX 2: an unresolvable opacity chain is honestly NOT_TESTED with bounded evidence, never silently assumed to be 1', hasOpacityNotTestedPath, `present=${hasOpacityNotTestedPath}`);
}

// FIX 3 — Warning, Reason-limit message, Selected Reasons text,
// Session metrics, and Top Reasons all require non-empty visible text
// BEFORE contrast is calculated (empty => missing => FAIL, never PASS
// merely because the element exists).
{
  const requireTrueOccurrences = [
    "collect(document.getElementById('ipoReasonLimit'), 'Reason-limit message', true)",
    "collect(document.getElementById('ipoReasonStatus'), 'Selected Reasons text', true)",
    "metricsChildren.forEach((child, i) => out.push(collect(child, `Session metric row ${i} (label+value combined in one text node)`, true)));",
    "topReasonsChildren.forEach((child, i) => out.push(collect(child, `Top Reasons row ${i} (label+count combined in one text node)`, true)));",
  ].every((s) => testSrc.includes(s));
  const collectFailsClosedOnEmptyText = testSrc.includes('if (requireNonEmptyText && text.length === 0) return { label, missing: true };');
  record('FIX 3: Reason-limit / Selected Reasons / Session metrics / Top Reasons all require non-empty text before contrast is calculated', requireTrueOccurrences && collectFailsClosedOnEmptyText, `requireTrueOccurrences=${requireTrueOccurrences}, collectFailsClosedOnEmptyText=${collectFailsClosedOnEmptyText}`);
}
// FIX 3 continued — Warning is measured via a dedicated GENUINE
// Re-analyze workflow (never a DOM-mutated fake string), polling for
// real non-empty text and honestly recording FAIL if the genuine
// workflow never produces it. Warning must NOT be part of the main
// sweep's `collect()` list (it is measured separately, in its
// transient window).
{
  const hasGenuineWarningWorkflow = testSrc.includes("await page.click('#btnReanalyze');") && testSrc.includes('let warningEntry = null;') && testSrc.includes('for (let i = 0; i < 20 && !warningEntry; i++)');
  const hasHonestWarningFailFallback = testSrc.includes("record('Contrast: Warning', false, 'genuine Re-analyze workflow never produced non-empty Warning text within a ~2s poll window — FAIL");
  const warningNotInMainSweepCollectCalls = !testSrc.includes("collect(document.getElementById('ipoWarning')");
  const neverAssignsWarningTextContent = !/ipoWarning['"]\)\.textContent\s*=/.test(testSrc);
  record(
    'FIX 3: Warning text is produced by a genuine Re-analyze workflow (never DOM-mutated), measured in its real transient window, honestly FAILed if never produced',
    hasGenuineWarningWorkflow && hasHonestWarningFailFallback && warningNotInMainSweepCollectCalls && neverAssignsWarningTextContent,
    `hasGenuineWarningWorkflow=${hasGenuineWarningWorkflow}, hasHonestWarningFailFallback=${hasHonestWarningFailFallback}, warningNotInMainSweepCollectCalls=${warningNotInMainSweepCollectCalls}, neverAssignsWarningTextContent=${neverAssignsWarningTextContent}`
  );
}

// FIX 4 (F2-S2, superseded by F2-S3 FIX 1) — disabled 6th Reason
// distinction is now isolated to color-balance's OWN before/after
// transition rather than a different enabled Reason as a stand-in. See
// the dedicated F2-S3 FIX 1 block below for the current assertions;
// this block confirms the OLD cross-control comparison approach is
// genuinely gone.
{
  const oldSnapHelperGone = !testSrc.includes('function snap(input)');
  const oldCrossControlComparisonGone = !testSrc.includes("disabledSnap: snap(document.getElementById('ipoReason_color-balance')), enabledSnap: snap(document.getElementById('ipoReason_skin-tone'))");
  record(
    'FIX 4 (superseded by F2-S3 FIX 1): the old cross-control comparison (disabled color-balance vs. a DIFFERENT enabled Reason) is gone',
    oldSnapHelperGone && oldCrossControlComparisonGone,
    `oldSnapHelperGone=${oldSnapHelperGone}, oldCrossControlComparisonGone=${oldCrossControlComparisonGone}`
  );
}

// FIX 5 (F2-S2, superseded by F2-S3 FIX 4/5/6) — Focus indicator no
// longer measures a single static capture; it now captures unfocused
// AND focused style and requires a genuine change. This block confirms
// the OLD single-capture approach is gone; the dedicated F2-S3 FIX
// 4/5/6 block below covers the current implementation.
{
  const oldSimplifiedLoopGone = !testSrc.includes("while ((!rgba || rgba[3] === 0) && bgEl.parentElement)");
  // The old F2-S2 Focus-indicator single-capture callback began with
  // an inline parseRgbaLocal definition immediately inside the
  // page.evaluate((elId) => {...}) body — a distinct fingerprint from
  // the unrelated Part 3 keyboard-focus-validation block elsewhere in
  // the file, which also declares `const info = await page.evaluate(...)`
  // but never defines parseRgbaLocal inside it.
  const oldSingleCaptureInfoGone = !testSrc.includes('const info = await page.evaluate((elId) => {\n        function parseRgbaLocal(str) {');
  record('FIX 5 (superseded by F2-S3 FIX 4/5/6): the old single-capture (no unfocused/focused comparison) Focus indicator approach is gone', oldSimplifiedLoopGone && oldSingleCaptureInfoGone, `oldSimplifiedLoopGone=${oldSimplifiedLoopGone}, oldSingleCaptureInfoGone=${oldSingleCaptureInfoGone}`);
}

// FIX 6 — a single shared decision function (`recordContrastEntry`)
// applies identical FAIL/NOT_TESTED/PASS rules to every Contrast
// target, including the standalone Warning check — so the main sweep
// and Warning can never silently diverge in their pass/fail logic.
{
  const hasSharedRecordFn = testSrc.includes('function recordContrastEntry(label, entry, contrastResultsList)');
  const mainSweepUsesSharedFn = testSrc.includes('for (const entry of contrastAudit) recordContrastEntry(entry.label, entry, contrastResults);');
  const warningUsesSharedFn = testSrc.includes("recordContrastEntry('Warning', warningEntry, contrastResults);");
  record('FIX 6: a single shared recordContrastEntry() applies identical decision rules to the main Contrast sweep and the standalone Warning check', hasSharedRecordFn && mainSweepUsesSharedFn && warningUsesSharedFn, `hasSharedRecordFn=${hasSharedRecordFn}, mainSweepUsesSharedFn=${mainSweepUsesSharedFn}, warningUsesSharedFn=${warningUsesSharedFn}`);
}

// ══════════════════════════════════════════════════════════════════
// Step 7B-B-F2-S3 FIX 7 — new static assertions covering FIX 1-6.
// ══════════════════════════════════════════════════════════════════

// FIX 1 — the SAME color-balance control is captured before (enabled)
// and after (disabled) selecting the fifth Reason, via a single shared
// snapReasonControl() helper reused for both snapshots.
{
  const hasSharedSnapFn = testSrc.includes('function snapReasonControl(inputId)');
  const enabledSnapCall = testSrc.includes("const colorBalanceEnabledSnap = await page.evaluate(snapReasonControl, 'ipoReason_color-balance');");
  const disabledSnapCall = testSrc.includes("const colorBalanceDisabledSnap = await page.evaluate(snapReasonControl, 'ipoReason_color-balance');");
  const selectsFourThenFifth = testSrc.includes("const f2FirstFourReasonIds = ['skin-tone', 'white-balance', 'highlight-detail', 'shadow-detail'];") && testSrc.includes("document.getElementById('ipoReason_contrast')?.checked === true");
  record(
    'FIX 1: the SAME color-balance control is captured before (four Reasons selected, enabled) and after (fifth Reason selected, disabled) via one shared snap function',
    hasSharedSnapFn && enabledSnapCall && disabledSnapCall && selectsFourThenFifth,
    `hasSharedSnapFn=${hasSharedSnapFn}, enabledSnapCall=${enabledSnapCall}, disabledSnapCall=${disabledSnapCall}, selectsFourThenFifth=${selectsFourThenFifth}`
  );
}
// FIX 1 continued — color-balance is verified unchecked in BOTH
// snapshots (never conflating a checked-state change with the
// disabled-state change being isolated).
{
  const hasBothUncheckedCheck = testSrc.includes("const bothUnchecked = colorBalanceEnabledSnap.checked === false && colorBalanceDisabledSnap.checked === false;") && testSrc.includes("'color-balance remains unchecked (checked === false) in both the enabled and disabled snapshots'");
  record('FIX 1: color-balance is verified unchecked (checked === false) in both the enabled and disabled snapshots', hasBothUncheckedCheck, `present=${hasBothUncheckedCheck}`);
}
// FIX 1 continued — cursor and className are captured for evidence
// only and are NEVER included in the comparison set used to decide
// visual distinction (only genuinely visible properties count).
{
  const propsToCompareLine = testSrc.match(/const propsToCompare = \[[^\]]*\];\s*\n\s*const differences = propsToCompare\.filter\(\(p\) => colorBalanceEnabledSnap/);
  const cursorExcludedFromComparison = !!propsToCompareLine && !propsToCompareLine[0].includes("'cursor'");
  const classNameExcludedFromComparison = !!propsToCompareLine && !propsToCompareLine[0].includes("'className'");
  const disabledExcludedFromComparison = !!propsToCompareLine && !propsToCompareLine[0].includes("'disabled'");
  const capturedForEvidenceOnly = testSrc.includes('Captured for evidence only — FIX 1 (F2-S3) deliberately never');
  record(
    'FIX 1: cursor, className, and the disabled property itself are captured for evidence only and never counted as visual distinction on their own',
    cursorExcludedFromComparison && classNameExcludedFromComparison && disabledExcludedFromComparison && capturedForEvidenceOnly,
    `cursorExcludedFromComparison=${cursorExcludedFromComparison}, classNameExcludedFromComparison=${classNameExcludedFromComparison}, disabledExcludedFromComparison=${disabledExcludedFromComparison}, capturedForEvidenceOnly=${capturedForEvidenceOnly}`
  );
}
// FIX 1 continued — no CSS/class is added merely to force a pass, and
// the NOT_TESTED fallback is honest when all visible properties match.
{
  const neverAddsClassOrStyleToPass = !/ipoReason_color-balance['"]\)\.(classList\.add|style\.\w+\s*=)/.test(testSrc);
  const hasHonestNotTestedFallback = testSrc.includes('reported honestly as a tool limitation, never fabricated as PASS, and no CSS/class was added merely to force a pass');
  record('FIX 1: no CSS/class is added to color-balance merely to force a pass; the NOT_TESTED fallback is honest', neverAddsClassOrStyleToPass && hasHonestNotTestedFallback, `neverAddsClassOrStyleToPass=${neverAddsClassOrStyleToPass}, hasHonestNotTestedFallback=${hasHonestNotTestedFallback}`);
}

// FIX 3 — every Contrast target (main sweep's collect() AND the
// standalone Warning capture) checks display, visibility, and
// non-zero rendered rect/client-rects before contrast is calculated;
// hidden/zero-size targets FAIL, never NOT_TESTED.
{
  const visibilityChecksInSource = (testSrc.match(/style\.display === 'none' \|\| style\.visibility === 'hidden' \|\| style\.visibility === 'collapse' \|\| rect\.width <= 0 \|\| rect\.height <= 0 \|\| clientRectCount === 0 \|\| isZeroOpacity/g) || []).length;
  const warningVisibilityCheck = testSrc.includes("cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse' || rect.width <= 0 || rect.height <= 0 || clientRectCount === 0 || isZeroOpacity");
  const hiddenTargetsFailNotNotTested = testSrc.includes('FAIL (never NOT_TESTED for a hidden/zero-size required target, never treated as measurable)') && testSrc.includes('FAIL (never NOT_TESTED, never treated as measurable)');
  record(
    'FIX 3: every Contrast target (main sweep + Warning) checks display/visibility/non-zero rect/client-rects before measurement; hidden/zero-size targets FAIL, never NOT_TESTED',
    visibilityChecksInSource >= 1 && warningVisibilityCheck && hiddenTargetsFailNotNotTested,
    `visibilityChecksInSource=${visibilityChecksInSource}, warningVisibilityCheck=${warningVisibilityCheck}, hiddenTargetsFailNotNotTested=${hiddenTargetsFailNotNotTested}`
  );
}
// FIX 3 continued — recordContrastEntry() itself fails closed on the
// notVisible flag before ever attempting a color/ratio calculation.
{
  const hasNotVisibleGate = testSrc.includes('if (entry.notVisible) {') && testSrc.includes('record(`Contrast: ${label}`, false, entry.notVisibleReason);');
  record('FIX 3: recordContrastEntry() fails closed on a notVisible target before any color/ratio calculation is attempted', hasNotVisibleGate, `present=${hasNotVisibleGate}`);
}

// FIX 4 — Focus style is captured BEFORE (genuinely unfocused, via an
// explicit blur-if-focused step) and AFTER (genuinely focused, via
// real keyboard input) using the SAME captureFocusStyle function
// reference for both captures.
{
  const hasSharedCaptureFn = testSrc.includes('function captureFocusStyle(elId)');
  const hasExplicitBlurStep = testSrc.includes("if (document.activeElement === el) document.body.focus();");
  const unfocusedCapture = testSrc.includes('const unfocusedInfo = await page.evaluate(captureFocusStyle, target.id);');
  const focusedCapture = testSrc.includes('const focusedInfo = await page.evaluate(captureFocusStyle, target.id);');
  record(
    'FIX 4: Focus style is captured before (genuine unfocused baseline) and after (real keyboard focus) using the same captureFocusStyle function for both',
    hasSharedCaptureFn && hasExplicitBlurStep && unfocusedCapture && focusedCapture,
    `hasSharedCaptureFn=${hasSharedCaptureFn}, hasExplicitBlurStep=${hasExplicitBlurStep}, unfocusedCapture=${unfocusedCapture}, focusedCapture=${focusedCapture}`
  );
}
// FIX 4 continued — the focused style must genuinely DIFFER from the
// unfocused style (outline newly present/changed, or box-shadow newly
// present/changed) — a decorative indicator unchanged in both states
// is explicitly rejected, never counted as PASS evidence.
{
  const hasOutlineUnchangedCheck = testSrc.includes('const outlineUnchanged = focusedHasOutline && unfocusedHasOutline && unfocusedInfo.outlineWidth === focusedInfo.outlineWidth');
  const hasBoxShadowUnchangedCheck = testSrc.includes('const boxShadowUnchanged = focusedHasBoxShadow && unfocusedInfo.boxShadow === focusedInfo.boxShadow;');
  const rejectsUnchangedIndicator = testSrc.includes('a static/decorative indicator present unchanged in both states does not count');
  record(
    'FIX 4: focused style must genuinely differ from unfocused style; a decorative indicator unchanged in both states is explicitly rejected',
    hasOutlineUnchangedCheck && hasBoxShadowUnchangedCheck && rejectsUnchangedIndicator,
    `hasOutlineUnchangedCheck=${hasOutlineUnchangedCheck}, hasBoxShadowUnchangedCheck=${hasBoxShadowUnchangedCheck}, rejectsUnchangedIndicator=${rejectsUnchangedIndicator}`
  );
}

// FIX 5 — the Focus indicator's own color is parsed as RGBA (via the
// Node-side parseRgbaNode) and its alpha is genuinely composited over
// the resolved adjacent background when below 1 — never discarded.
{
  const hasParseRgbaNodeFn = testSrc.includes('function parseRgbaNode(str)');
  const indicatorParsedAsRgba = testSrc.includes('const indicatorRgba = parseRgbaNode(indicatorColorRaw);');
  const hasIndicatorAlphaComposite = testSrc.includes('const compositedIndicator = ia >= 1') && testSrc.includes('indicatorRgba[i] * ia + adjacentBgResult.rgb[i] * (1 - ia)');
  const neverDiscardsAlpha = testSrc.includes('never discard alpha, never treat a semi-') || testSrc.includes('never discard alpha');
  record(
    'FIX 5: Focus indicator color is parsed as RGBA and its alpha is genuinely composited over the resolved adjacent background when below 1 (never discarded)',
    hasParseRgbaNodeFn && indicatorParsedAsRgba && hasIndicatorAlphaComposite && neverDiscardsAlpha,
    `hasParseRgbaNodeFn=${hasParseRgbaNodeFn}, indicatorParsedAsRgba=${indicatorParsedAsRgba}, hasIndicatorAlphaComposite=${hasIndicatorAlphaComposite}, neverDiscardsAlpha=${neverDiscardsAlpha}`
  );
}

// FIX 6 — multiple/ambiguous box-shadow layers fail closed to
// NOT_TESTED (never assuming the first RGB value, never falling back
// to outlineColor), via a dedicated layer-splitting helper that
// respects nested rgba(...) commas.
{
  const hasSplitBoxShadowLayersFn = testSrc.includes('function splitBoxShadowLayers(str)');
  const respectsNestedCommas = testSrc.includes("if (ch === '(') depth++;") && testSrc.includes("if (ch === ')') depth--;") && testSrc.includes("if (ch === ',' && depth === 0)");
  const hasAmbiguousNotTestedPath = testSrc.includes('if (ambiguousEvidence) {') && testSrc.includes("'NOT_TESTED', `${ambiguousEvidence}");
  const neverAssumesFirstRgbOrOutlineFallback = testSrc.includes('never assuming the first RGB value, never falling back to an unrelated outlineColor');
  record(
    'FIX 6: multiple/ambiguous box-shadow layers fail closed to NOT_TESTED, never assuming the first RGB value or falling back to outlineColor',
    hasSplitBoxShadowLayersFn && respectsNestedCommas && hasAmbiguousNotTestedPath && neverAssumesFirstRgbOrOutlineFallback,
    `hasSplitBoxShadowLayersFn=${hasSplitBoxShadowLayersFn}, respectsNestedCommas=${respectsNestedCommas}, hasAmbiguousNotTestedPath=${hasAmbiguousNotTestedPath}, neverAssumesFirstRgbOrOutlineFallback=${neverAssumesFirstRgbOrOutlineFallback}`
  );
}
// FIX 6 continued — a decorative, unchanged box-shadow present in both
// the unfocused and focused captures cannot satisfy usingBoxShadow.
{
  const hasBoxShadowUnchangedExclusion = testSrc.includes('const usingBoxShadow = !usingOutline && focusedHasBoxShadow && !boxShadowUnchanged;');
  record('FIX 6: a decorative box-shadow present unchanged in both unfocused and focused captures cannot satisfy usingBoxShadow (cannot pass as a Focus indicator)', hasBoxShadowUnchangedExclusion, `present=${hasBoxShadowUnchangedExclusion}`);
}

const passCount = results.filter((r) => r.result === 'PASS').length;
const failCount = results.filter((r) => r.result === 'FAIL').length;

const output = {
  suite: 'EPIC 2E-J — Step 7B-B-F2-S/F2-S2/F2-S3: static coverage self-test (source audit only, no Chromium)',
  generatedAt: new Date().toISOString(),
  summary: { total: results.length, pass: passCount, fail: failCount },
  results,
  disclaimer: 'This suite audits the SOURCE TEXT of qa/epic-2e-j-phase-c-step7b-b-test.mjs for the presence of required categories/thresholds/wiring. It does NOT execute a browser, does NOT measure real computed colors or element sizes, and does NOT prove real Contrast/Touch-target PASS. A PASS here means "the required code path is present," not "the real UI meets WCAG."',
  browserSuiteExecution: {
    status: liveBrowserStatus,
    packageStatus: livePkgStatus.status,
    note: 'COMBINED CLOSEOUT R1 Phase F: live-detected every run, replacing the retired NOT_RUN_ENVIRONMENT_BLOCKED literal. This F2-S/S2/S3 patch did not execute, simulate, or regenerate the real browser suite or its result JSON — Browser availability is reported here for diagnostic purposes only.',
    browserOrFinalResultJsonRegenerated: false,
  },
};
await writeFile(path.join(PROJECT_ROOT, 'qa', 'epic-2e-j-phase-c-step7b-b-f2-static-results.json'), JSON.stringify(output, null, 2));
console.log(`\n${passCount}/${results.length} PASS, ${failCount} FAIL`);
console.log(`Browser suite execution: ${liveBrowserStatus} (see output JSON)`);
process.exit(failCount > 0 ? 1 : 0);
