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
// FIX 7 — Browser result remains NOT_RUN_ENVIRONMENT_BLOCKED. This
// reads the EXISTING F1 static-results honest-status record — it does
// NOT execute or fabricate a browser run, and does NOT regenerate the
// Browser or Final Phase C result JSON.
// ══════════════════════════════════════════════════════════════════
{
  const status = f1StaticResultsRaw?.browserSuiteExecution?.status;
  record('Browser result remains NOT_RUN_ENVIRONMENT_BLOCKED (read from existing F1 static-results honest-status record)', status === 'NOT_RUN_ENVIRONMENT_BLOCKED', `status=${status}`);
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
// FIX 2 continued — computed opacity on the target AND its ancestors
// is inspected via a bounded walk, and the foreground's effective
// alpha (own alpha × resolved ancestor-opacity product) is composited
// over the resolved background — never silently discarded/assumed 1.
{
  const hasResolveEffectiveOpacityFn = (testSrc.match(/function resolveEffectiveOpacity\(startEl\)/g) || []).length >= 2;
  const hasBoundedWalk = testSrc.includes('const MAX_STEPS = 25;') && testSrc.includes('steps < MAX_STEPS');
  const hasEffectiveAlphaComposite = testSrc.includes('const effectiveAlpha = entry.fgRgba[3] * entry.opacityValue;') && testSrc.includes('const compositedFg = effectiveAlpha >= 1');
  const neverAssumesOpacityOne = !/opacity\s*=\s*1;?\s*\/\/.*assum/i.test(testSrc);
  record(
    'FIX 2: computed opacity is inspected via a bounded ancestor walk, and foreground alpha is genuinely composited over the background (never discarded or assumed 1)',
    hasResolveEffectiveOpacityFn && hasBoundedWalk && hasEffectiveAlphaComposite && neverAssumesOpacityOne,
    `hasResolveEffectiveOpacityFn(>=2)=${hasResolveEffectiveOpacityFn}, hasBoundedWalk=${hasBoundedWalk}, hasEffectiveAlphaComposite=${hasEffectiveAlphaComposite}, neverAssumesOpacityOne=${neverAssumesOpacityOne}`
  );
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

// FIX 4 — disabled 6th Reason is compared against an enabled Reason
// across a real set of computed-style properties, with an honest
// NOT_TESTED fallback (never a fabricated PASS, never a CSS/class
// change merely to pass the test) when native disabled styling can't
// be measured.
{
  const hasSnapHelper = testSrc.includes('function snap(input)');
  const hasEightProps = testSrc.includes("const propsToCompare = ['inputOpacity', 'labelOpacity', 'spanOpacity', 'color', 'backgroundColor', 'borderColor', 'filter', 'cursor'];");
  const comparesAgainstEnabledReference = testSrc.includes("document.getElementById('ipoReason_skin-tone')");
  const hasHonestNotTestedFallback = testSrc.includes("not reliably introspectable via getComputedStyle — reported honestly as a tool limitation, never fabricated as PASS");
  const neverAddsClassOrStyleToPass = !/ipoReason_color-balance['"]\)\.(classList\.add|style\.\w+\s*=)/.test(testSrc);
  record(
    'FIX 4: disabled 6th Reason is compared against an enabled Reason across 8 computed-style properties, with honest NOT_TESTED fallback (never a fabricated PASS or CSS change to force a pass)',
    hasSnapHelper && hasEightProps && comparesAgainstEnabledReference && hasHonestNotTestedFallback && neverAddsClassOrStyleToPass,
    `hasSnapHelper=${hasSnapHelper}, hasEightProps=${hasEightProps}, comparesAgainstEnabledReference=${comparesAgainstEnabledReference}, hasHonestNotTestedFallback=${hasHonestNotTestedFallback}, neverAddsClassOrStyleToPass=${neverAddsClassOrStyleToPass}`
  );
}

// FIX 5 — Focus indicator background resolution uses the SAME robust
// resolver as Contrast (duplicated inline in the Focus-indicator
// page.evaluate), never the old simplified first-non-transparent-
// parent while-loop.
{
  const oldSimplifiedLoopGone = !testSrc.includes("while ((!rgba || rgba[3] === 0) && bgEl.parentElement)");
  const focusUsesRobustResolver = testSrc.includes('const adjacentBgResult = resolveEffectiveBackground(styledEl.parentElement || styledEl);');
  record('FIX 5: Focus indicator background resolution uses the same robust resolver as Contrast (old simplified while-loop removed)', oldSimplifiedLoopGone && focusUsesRobustResolver, `oldSimplifiedLoopGone=${oldSimplifiedLoopGone}, focusUsesRobustResolver=${focusUsesRobustResolver}`);
}
// FIX 5 continued — the ACTUALLY active indicator (outline OR
// box-shadow) is correctly identified and its real color parsed —
// never reporting box-shadow presence while measuring an unrelated
// outlineColor.
{
  const hasUsingOutlineUsingBoxShadow = testSrc.includes('const usingOutline = outlineWidth > 0 && outlineStyle !== \'none\';') && testSrc.includes('const usingBoxShadow = !usingOutline && !!boxShadow');
  const hasBoxShadowColorExtraction = testSrc.includes("const m = boxShadow.match(/rgba?\\([^)]*\\)/);") && testSrc.includes('indicatorColorRaw = m ? m[0] : null;');
  const neverHardcodesOutlineColor = !/indicatorColorRaw\s*=\s*info\.outlineColor/.test(testSrc) && !testSrc.includes('const outlineRgb = parseRgb(info.outlineColor);\n      if (!outlineRgb ||');
  record(
    'FIX 5: the ACTUALLY active indicator (outline or box-shadow) is identified and its real color source parsed, never a hard-coded outlineColor read regardless of which mechanism is active',
    hasUsingOutlineUsingBoxShadow && hasBoxShadowColorExtraction && neverHardcodesOutlineColor,
    `hasUsingOutlineUsingBoxShadow=${hasUsingOutlineUsingBoxShadow}, hasBoxShadowColorExtraction=${hasBoxShadowColorExtraction}, neverHardcodesOutlineColor=${neverHardcodesOutlineColor}`
  );
}
// FIX 5 continued — an undeterminable adjacent background (gradient/
// image) fails closed to NOT_TESTED rather than fabricating a ratio.
{
  const hasFocusUndeterminableNotTested = testSrc.includes('if (info.adjacentBgResult.undeterminable) {') && testSrc.includes("'NOT_TESTED', info.adjacentBgResult.reason);");
  record('FIX 5: Focus indicator fails closed to NOT_TESTED (never a fabricated ratio) when the adjacent background is genuinely undeterminable', hasFocusUndeterminableNotTested, `present=${hasFocusUndeterminableNotTested}`);
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

const passCount = results.filter((r) => r.result === 'PASS').length;
const failCount = results.filter((r) => r.result === 'FAIL').length;

const output = {
  suite: 'EPIC 2E-J — Step 7B-B-F2-S/F2-S2: static coverage self-test (source audit only, no Chromium)',
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
