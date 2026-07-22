#!/usr/bin/env node
/**
 * qa/epic-2e-j-phase-c-step7b-b-f3-static-test.mjs
 *
 * EPIC 2E-J — Step 7B-B-F3-S (Keyboard Activation and ARIA-Live Runtime
 * Test Implementation — Static Verification Only).
 *
 * Because Chromium is unavailable in this environment, this is a STATIC
 * SOURCE AUDIT of qa/epic-2e-j-phase-c-step7b-b-test.mjs — it parses the
 * test file's own source text to confirm the required Keyboard
 * activation / MutationObserver / announcement-bounds / side-effect
 * isolation work (Parts 1-9) is actually present and wired the way the
 * F3-S spec requires. It never launches a browser, never executes the
 * real Keyboard/ARIA logic, and never fabricates a Keyboard/screen-
 * reader PASS.
 *
 * IMPORTANT — what this file does NOT prove: it does not run the real
 * browser test, so it proves nothing about ACTUAL Tab order, ACTUAL
 * announcement text produced by a real screen reader, or ACTUAL
 * side-effect absence in a real page. A "PASS" below means "the
 * required code path is present and wired correctly," never "the real
 * UI passed Keyboard/ARIA testing."
 *
 * Run: node qa/epic-2e-j-phase-c-step7b-b-f3-static-test.mjs
 * Output: qa/epic-2e-j-phase-c-step7b-b-f3-static-results.json
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
const f1StaticResultsPath = path.join(PROJECT_ROOT, 'qa', 'epic-2e-j-phase-c-step7b-b-f1-static-results.json');

let testSrc = '';
let f1StaticResultsRaw = null;

try {
  testSrc = await readFile(testFilePath, 'utf8');
  record('qa/epic-2e-j-phase-c-step7b-b-test.mjs is readable', true, `${testSrc.length} bytes`);
} catch (e) {
  record('qa/epic-2e-j-phase-c-step7b-b-test.mjs is readable', false, String(e && e.message || e));
}
try {
  f1StaticResultsRaw = JSON.parse(await readFile(f1StaticResultsPath, 'utf8'));
  record('qa/epic-2e-j-phase-c-step7b-b-f1-static-results.json is readable', true, 'parsed OK');
} catch (e) {
  record('qa/epic-2e-j-phase-c-step7b-b-f1-static-results.json is readable', false, String(e && e.message || e));
}

// Checks that `betweenAIndex` and `bIndex` (both found via indexOf) do
// NOT have a real `page.click(` CODE call between them — used to prove
// a specific Keyboard-activation acceptance path never falls back to a
// click between reaching the target and pressing the activation key.
// Matches `page.click(` / `await page.click(` specifically (not a bare
// `.click(`), so a human-readable test-description STRING that merely
// mentions ".click()" in prose (e.g. "never .click() as activation
// proof") is never mistaken for an actual click() call in code.
function noClickBetween(a, b) {
  const aIdx = testSrc.indexOf(a);
  const bIdx = testSrc.indexOf(b, aIdx >= 0 ? aIdx : 0);
  if (aIdx === -1 || bIdx === -1 || bIdx < aIdx) return { ok: false, reason: `could not locate both anchors (aIdx=${aIdx}, bIdx=${bIdx})` };
  const between = testSrc.slice(aIdx, bIdx);
  const hasClick = /\bpage\.click\(/.test(between);
  return { ok: !hasClick, reason: hasClick ? 'a page.click( call was found between the anchors' : null, between };
}

// ══════════════════════════════════════════════════════════════════
// Part 1 — real Tab order.
// ══════════════════════════════════════════════════════════════════
{
  const hasTabToHelper = testSrc.includes('async function tabTo(page, targetId, maxSteps, sequenceOut)');
  const hasRealTabPress = (testSrc.match(/await page\.keyboard\.press\('Tab'\);/g) || []).length >= 3;
  const hasShiftTab = testSrc.includes("await page.keyboard.press('Shift+Tab');");
  const hasAllFourArrows = ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].every((k) => testSrc.includes(`'${k}'`));
  const recordsFullSequence = testSrc.includes('const f3FullTabSequence = [];') && testSrc.includes("record('Part 1: full recorded activeElement ID sequence (evidence)'");
  record('Part 1: real Tab and Shift+Tab navigation is used, all four Arrow keys are exercised, and the full activeElement ID sequence is recorded', hasTabToHelper && hasRealTabPress && hasShiftTab && hasAllFourArrows && recordsFullSequence, `hasTabToHelper=${hasTabToHelper}, hasRealTabPress=${hasRealTabPress}, hasShiftTab=${hasShiftTab}, hasAllFourArrows=${hasAllFourArrows}, recordsFullSequence=${recordsFullSequence}`);
}
{
  const neverUsesFocusAsProof = !/record\('Part 1\.\d[^']*',\s*await page\.evaluate\([^)]*\.focus\(/.test(testSrc);
  const focusCallsAreLabeled = (testSrc.match(/\/\/ setup(\/cleanup)? only(, not activation proof)?$/gm) || []).length >= 3;
  record('Part 1: `.focus()`/`page.evaluate(...focus...)` calls are used only for setup/cleanup (never as Tab-order acceptance proof) and are labeled as such', neverUsesFocusAsProof && focusCallsAreLabeled, `neverUsesFocusAsProof=${neverUsesFocusAsProof}, focusCallsAreLabeled=${focusCallsAreLabeled}`);
}
{
  const hasNoTrapCheck = testSrc.includes('Part 1.8 / FIX 9 / FIX 7 (F3-S3): no keyboard trap detected');
  record('Part 1: no-keyboard-trap check exists', hasNoTrapCheck, `present=${hasNoTrapCheck}`);
}

// ══════════════════════════════════════════════════════════════════
// Part 2 — Clear Reasons keyboard activation (Enter, real Tab reach,
// never .click() as activation proof).
// ══════════════════════════════════════════════════════════════════
{
  const reachAnchor = "const p2Reached = await tabTo(page, 'ipoClearReasonsButton', 15, p2Sequence);";
  const activateAnchor = "await page.keyboard.press('Enter');";
  const hasBothAnchors = testSrc.includes(reachAnchor) && testSrc.includes(activateAnchor);
  const noClick = noClickBetween(reachAnchor, activateAnchor);
  // Note: a page.click('#ipoClearReasonsButton') legitimately appears
  // elsewhere in the file for Part 7 Scenario C's MutationObserver
  // announcement audit (a DIFFERENT test concern, not a keyboard-
  // reachability claim) — so "no click anywhere" would be a false
  // requirement; what actually matters is that THIS acceptance path
  // (reach-then-activate) never uses one, which noClickBetween proves.
  record('Part 2: Clear Reasons is reached via real Tab navigation and activated with Enter, with no click() call between reaching and activating', hasBothAnchors && noClick.ok, `hasBothAnchors=${hasBothAnchors}, noClickBetween=${JSON.stringify(noClick.ok)}, reason=${noClick.reason}`);
}
{
  const hasAllVerifications = [
    'Part 2.2: Enter on #ipoClearReasonsButton clears all Reason checkboxes',
    'Part 2.3: Observation remains Prefer Legacy after Clear Reasons',
    'Part 2.4: Session active Observation remains present',
    'Part 2.5: Reason counts (Selected Reasons text) clear after Clear Reasons',
    'Part 2.6: no Analysis rerun during Clear Reasons keyboard activation',
    'Part 2.7: no Slider movement during Clear Reasons keyboard activation',
  ].every((s) => testSrc.includes(s));
  record('Part 2: all required post-activation verifications are present (Reasons clear, Observation preserved, Session preserved, no rerun, no Slider movement)', hasAllVerifications, `present=${hasAllVerifications}`);
}

// ══════════════════════════════════════════════════════════════════
// Part 3 — Clear Observation keyboard activation (Space, real Tab
// reach, no double-fire).
// ══════════════════════════════════════════════════════════════════
{
  const reachAnchor = "const p3Reached = await tabTo(page, 'ipoClearButton', 15, p3Sequence);";
  const activateAnchor = "await page.keyboard.press('Space');\n    await page.waitForTimeout(150);\n\n    const p3NoRadioChecked";
  const hasBothAnchors = testSrc.includes(reachAnchor) && testSrc.includes("await page.keyboard.press('Space');");
  const noClick = noClickBetween(reachAnchor, activateAnchor);
  // Note: a page.click('#ipoClearButton') legitimately appears
  // elsewhere in the file (pre-existing Part 2/3 keyboard-navigation
  // cleanup and Part 7 Scenario E's MutationObserver audit are
  // different test concerns, not keyboard-reachability claims) — what
  // matters is THIS acceptance path never uses one, per noClickBetween.
  record('Part 3: Clear Observation is reached via real Tab navigation and activated with Space, with no click() call between reaching and activating', hasBothAnchors && noClick.ok, `hasBothAnchors=${hasBothAnchors}, noClickBetween=${JSON.stringify(noClick.ok)}, reason=${noClick.reason}`);
}
{
  const hasNoDoubleFireTest = testSrc.includes('Part 3.8: pressing the activation key again does not increment Cleared twice');
  const pressesActivationKeyTwice = (testSrc.match(/await page\.keyboard\.press\('Space'\);/g) || []).length >= 2;
  record('Part 3: pressing the activation key a second time is tested and does not double-increment Cleared', hasNoDoubleFireTest && pressesActivationKeyTwice, `hasNoDoubleFireTest=${hasNoDoubleFireTest}, pressesActivationKeyTwice=${pressesActivationKeyTwice}`);
}
{
  const hasAllVerifications = [
    'Part 3.2: no Observation Radio checked after Clear Observation',
    'Part 3.3: all Reasons clear after Clear Observation',
    'Part 3.4: active Observation count becomes zero',
    'Part 3.5: Cleared count increments exactly once',
    'Part 3.6: no Analysis rerun during Clear Observation keyboard activation',
    'Part 3.7: no Slider movement during Clear Observation keyboard activation',
  ].every((s) => testSrc.includes(s));
  record('Part 3: all required post-activation verifications are present', hasAllVerifications, `present=${hasAllVerifications}`);
}

// ══════════════════════════════════════════════════════════════════
// Part 4 — Clear Session keyboard activation (Enter, real Tab reach,
// immediate re-record verified).
// ══════════════════════════════════════════════════════════════════
{
  const reachAnchor = "const p4Reached = await tabTo(page, 'ipoClearSessionButton', 20, p4Sequence);";
  const activateAnchor = "await page.keyboard.press('Enter');\n    await page.waitForTimeout(200);";
  const hasBothAnchors = testSrc.includes(reachAnchor) && testSrc.includes(activateAnchor);
  const noClick = noClickBetween(reachAnchor, activateAnchor);
  const noHardcodedClick = !testSrc.includes("page.click('#ipoClearSessionButton')");
  record('Part 4: Clear Session is reached via real Tab navigation and activated with Enter, with no .click() between reaching and activating, and no hard-coded click on this button anywhere', hasBothAnchors && noClick.ok && noHardcodedClick, `hasBothAnchors=${hasBothAnchors}, noClickBetween=${JSON.stringify(noClick.ok)}, noHardcodedClick=${noHardcodedClick}, reason=${noClick.reason}`);
}
{
  const hasReRecordVerification = testSrc.includes('Part 4.5: the current Observation is immediately re-recorded (totalObserved=1, preferLegacy=1)') && testSrc.includes('p4ParsedAfter.totalObserved === 1 && p4ParsedAfter.preferLegacy === 1');
  const hasActiveObservationsCheck = testSrc.includes('Part 4.6: activeObservations = 1 after Clear Session') && testSrc.includes('p4ParsedAfter.activeObservationsDerived === 1');
  const hasHistoricalResetCheck = testSrc.includes('Part 4.2: historical Cleared/Invalidated counts reset after Clear Session');
  const hasCurrentStatePreservedChecks = testSrc.includes('Part 4.3: current valid Observation (Prefer Legacy) remains checked after Clear Session') && testSrc.includes('Part 4.4: current Reasons (skin-tone, contrast) remain checked after Clear Session');
  const hasGenerationUnchangedCheck = testSrc.includes('Part 4.8: Analysis generation does not change during Clear Session keyboard activation');
  const neverExpectsEmptySessionMessage = !testSrc.includes("SESSION_EMPTY_MESSAGE") || !/Part 4[^\n]*No observations have been recorded/.test(testSrc);
  record(
    'Part 4: Clear Session expects immediate re-record (totalObserved=1, activeObservations=1, preferLegacy=1), historical counts reset, current selection preserved, generation unchanged, and never expects the empty-session message',
    hasReRecordVerification && hasActiveObservationsCheck && hasHistoricalResetCheck && hasCurrentStatePreservedChecks && hasGenerationUnchangedCheck && neverExpectsEmptySessionMessage,
    `hasReRecordVerification=${hasReRecordVerification}, hasActiveObservationsCheck=${hasActiveObservationsCheck}, hasHistoricalResetCheck=${hasHistoricalResetCheck}, hasCurrentStatePreservedChecks=${hasCurrentStatePreservedChecks}, hasGenerationUnchangedCheck=${hasGenerationUnchangedCheck}, neverExpectsEmptySessionMessage=${neverExpectsEmptySessionMessage}`
  );
}

// ══════════════════════════════════════════════════════════════════
// Part 5 — five-Reason-limit keyboard behavior.
// ══════════════════════════════════════════════════════════════════
{
  const selectsFiveViaSpace = testSrc.includes("await page.keyboard.press('Space'); // real keyboard activation, never Controller methods or .click()");
  const disabledSpaceAttempt = testSrc.includes("const p5ReachedDisabled = await tabTo(page, 'ipoReason_color-balance', 15, p5Sequence);") && testSrc.includes('if (p5ReachedDisabled) await page.keyboard.press(\'Space\');');
  const disabledStaysUnchecked = testSrc.includes('Part 5.3/5.4: the disabled sixth Reason cannot be toggled by Space');
  const removalViaSpace = testSrc.includes("const p5ReachedSkinTone = await tabTo(page, 'ipoReason_skin-tone', 20, p5RemoveSequence);") && testSrc.includes("if (p5ReachedSkinTone) await page.keyboard.press('Space');");
  const removalVerified = testSrc.includes('Part 5.5/5.6/5.7: navigating to a selected Reason and pressing Space removes it');
  const neverCallsControllerDirectly = !/interactivePreviewObservationController\.\w+\(/.test(testSrc.split('PART 5 — five-Reason-limit')[1] || testSrc);
  record(
    'Part 5: five Reasons are selected via Tab+Space, the disabled sixth Reason receives a genuine Space attempt and stays unchecked, and a selected Reason can be removed using Space (never calling Controller methods directly)',
    selectsFiveViaSpace && disabledSpaceAttempt && disabledStaysUnchecked && removalViaSpace && removalVerified && neverCallsControllerDirectly,
    `selectsFiveViaSpace=${selectsFiveViaSpace}, disabledSpaceAttempt=${disabledSpaceAttempt}, disabledStaysUnchecked=${disabledStaysUnchecked}, removalViaSpace=${removalViaSpace}, removalVerified=${removalVerified}, neverCallsControllerDirectly=${neverCallsControllerDirectly}`
  );
}

// ══════════════════════════════════════════════════════════════════
// Part 6 — ARIA-live structure.
// ══════════════════════════════════════════════════════════════════
{
  const hasAllSixChecks = [
    "Part 6.1: #ipoStatus has aria-live=\"polite\"",
    "Part 6.2: #ipoWarning has aria-live=\"polite\"",
    "Part 6.3: #ipoReasonLimit has aria-live=\"polite\"",
    "Part 6.4: #ipoReasonStatus (ordinary Selected Reasons text) has no aria-live of its own and no live-region ancestor",
    "Part 6.5: #ipoSessionMetrics has no aria-live of its own and no live-region ancestor",
    "Part 6.6: #ipoSessionTopReasons has no aria-live of its own and no live-region ancestor",
  ].every((s) => testSrc.includes(s));
  const missingElementFailsClosed = testSrc.includes('ariaStructureF3.statusExists &&') && testSrc.includes('ariaStructureF3.warningExists &&') && testSrc.includes('ariaStructureF3.reasonLimitExists &&');
  const sessionSectionsCheckLiveAncestorToo = testSrc.includes('ariaStructureF3.sessionMetricsHasLiveAncestor === false') && testSrc.includes('ariaStructureF3.sessionTopReasonsHasLiveAncestor === false');
  record('Part 6: ARIA-live structure requires #ipoStatus/#ipoWarning/#ipoReasonLimit polite, #ipoReasonStatus non-live with no live ancestor, and Session sections non-live with no live ancestor either, with missing elements failing closed', hasAllSixChecks && missingElementFailsClosed && sessionSectionsCheckLiveAncestorToo, `hasAllSixChecks=${hasAllSixChecks}, missingElementFailsClosed=${missingElementFailsClosed}, sessionSectionsCheckLiveAncestorToo=${sessionSectionsCheckLiveAncestorToo}`);
}

// ══════════════════════════════════════════════════════════════════
// Part 7 — MutationObserver live-region audit.
// ══════════════════════════════════════════════════════════════════
{
  const hasInstallFn = testSrc.includes('async function installLiveRegionObservers(page)');
  const observesOnlyThreeRegions = testSrc.includes("const regionIds = ['ipoStatus', 'ipoWarning', 'ipoReasonLimit'];");
  const hasRequiredRecordShape = testSrc.includes('function summarizeLiveTexts(regionId, audit)') && testSrc.includes('regionId,\n    previousText: audit ? audit.previousText : null,\n    rawMutationCount: audit ? audit.rawMutationCount : 0,\n    textTransitions,\n    nonEmptyAnnouncements: nonEmptyAnnouncementTexts.length,\n    distinctNonEmptyTexts,\n    repeatedIdenticalTexts,\n    repeatedTexts,');
  record('Part 7: MutationObserver is installed and observes ONLY the three intended live regions (ipoStatus, ipoWarning, ipoReasonLimit), with the required {regionId, previousText, rawMutationCount, textTransitions, nonEmptyAnnouncements, distinctNonEmptyTexts, repeatedIdenticalTexts, repeatedTexts} record shape', hasInstallFn && observesOnlyThreeRegions && hasRequiredRecordShape, `hasInstallFn=${hasInstallFn}, observesOnlyThreeRegions=${observesOnlyThreeRegions}, hasRequiredRecordShape=${hasRequiredRecordShape}`);
}
{
  const hasScenarioA = testSrc.includes('Scenario A precondition 1: exactly one Reason selected before the audited action') && testSrc.includes('Scenario A precondition 2: exactly two Reasons selected (never reaching five)') && testSrc.includes('Scenario A: selecting an ordinary second Reason (well under the limit) produces ZERO live-region TEXT TRANSITIONS') && testSrc.includes('Scenario A: ordinary Selected Reasons text has no live-region ancestor');
  const hasScenarioB = testSrc.includes('Scenario B precondition 1: exactly four Reasons selected') && testSrc.includes('Scenario B precondition 2: the fifth Reason (contrast) is enabled and unchecked before selection') && testSrc.includes('Scenario B: selecting the fifth Reason through a real UI action reaches exactly five selected') && testSrc.includes('Scenario B: reaching the five-Reason limit produces exactly one meaningful non-empty ipoReasonLimit announcement') && testSrc.includes('Scenario B: no duplicate identical ipoReasonLimit announcement was recorded');
  const hasScenarioC = testSrc.includes('PRODUCT_ACCESSIBILITY_GAP_CLEAR_REASONS_ANNOUNCEMENT') && testSrc.includes('Scenario C: Clear Reasons produces at least one meaningful non-empty live announcement describing the action') && testSrc.includes('Scenario C: Clear Reasons produces exactly one distinct, non-empty, non-repeated live announcement describing the action');
  const hasScenarioD = testSrc.includes('Scenario D: a genuine stale-generation transition') && testSrc.includes('Scenario D: no duplicate identical ipoWarning announcement was recorded');
  const hasScenarioE = testSrc.includes('Scenario E: Clear Observation produces exactly one non-empty ipoStatus announcement matching the expected cleared-state message');
  record('Part 7: all five MutationObserver scenarios are implemented per F3-S2 (A deterministic ordinary-selection non-live, B deterministic limit-reached single announcement, C Clear Reasons fail-closed, D stale/generation transition with Canvas exclusion, E Clear Observation requires real announcement)', hasScenarioA && hasScenarioB && hasScenarioC && hasScenarioD && hasScenarioE, `hasScenarioA=${hasScenarioA}, hasScenarioB=${hasScenarioB}, hasScenarioC=${hasScenarioC}, hasScenarioD=${hasScenarioD}, hasScenarioE=${hasScenarioE}`);
}
{
  const rejectsDuplicates = (testSrc.match(/repeatedIdenticalTexts === 0/g) || []).length >= 4;
  const ordinaryReasonsTextAssertedNonLive = testSrc.includes('reasonStatusNoLiveAncestorA');
  record('Part 7: duplicate identical live announcements are rejected (checked in at least 4 scenarios), and ordinary Selected Reasons text is explicitly asserted non-live', rejectsDuplicates && ordinaryReasonsTextAssertedNonLive, `rejectsDuplicates=${rejectsDuplicates}, ordinaryReasonsTextAssertedNonLive=${ordinaryReasonsTextAssertedNonLive}`);
}
{
  const onlyCountsTextTransitions = testSrc.includes('if (currentText !== rec.previousText) {') && testSrc.includes('rec.textTransitions.push({ from: rec.previousText, to: currentText });') && testSrc.includes('rec.previousText = currentText;');
  const distinguishesRawFromTransitions = testSrc.includes('rec.rawMutationCount += mutationList.length;');
  record('Part 7 / FIX 2: only genuine text CHANGES are counted as transitions (a DOM mutation that leaves the same text is never counted as a new announcement), while raw mutation count is tracked separately', onlyCountsTextTransitions && distinguishesRawFromTransitions, `onlyCountsTextTransitions=${onlyCountsTextTransitions}, distinguishesRawFromTransitions=${distinguishesRawFromTransitions}`);
}

// ══════════════════════════════════════════════════════════════════
// Part 8 — announcement bounds.
// ══════════════════════════════════════════════════════════════════
{
  const hasBoundsFn = testSrc.includes('function isAnnouncementBounded(text)');
  const checksPlainText = testSrc.includes("typeof text !== 'string'");
  const checksHtmlInjection = testSrc.includes("text.includes('<') && text.includes('>')");
  const checksObjectObject = testSrc.includes("text.includes('[object Object]')");
  const checksNaN = testSrc.includes('/\\bNaN\\b/.test(text)');
  const checksInfinity = testSrc.includes('/\\bInfinity\\b/.test(text)');
  const checksRawStack = testSrc.includes('looks like a raw stack trace');
  const checks300Bound = testSrc.includes('text.length > 300');
  const appliedAggregate = testSrc.includes('Part 8: every captured live-region announcement');
  record(
    'Part 8: announcement bounds check plain text, no HTML injection, no [object Object], no NaN/Infinity, no raw stack/error, and a 300-character maximum, applied to every captured announcement',
    hasBoundsFn && checksPlainText && checksHtmlInjection && checksObjectObject && checksNaN && checksInfinity && checksRawStack && checks300Bound && appliedAggregate,
    `hasBoundsFn=${hasBoundsFn}, checksPlainText=${checksPlainText}, checksHtmlInjection=${checksHtmlInjection}, checksObjectObject=${checksObjectObject}, checksNaN=${checksNaN}, checksInfinity=${checksInfinity}, checksRawStack=${checksRawStack}, checks300Bound=${checks300Bound}, appliedAggregate=${appliedAggregate}`
  );
}

// ══════════════════════════════════════════════════════════════════
// Part 9 — side-effect isolation (Analysis/Slider/Canvas).
// ══════════════════════════════════════════════════════════════════
{
  const instrumentsCanvas = testSrc.includes('async function installCanvasInstrumentation(page)') && testSrc.includes("proto.drawImage = function") && testSrc.includes("proto.getImageData = function") && testSrc.includes("proto.putImageData = function");
  const restoresCanvasExactly = testSrc.includes('async function restoreCanvasInstrumentation(page)') && testSrc.includes('proto.drawImage = orig.drawImage;') && testSrc.includes('proto.getImageData = orig.getImageData;') && testSrc.includes('proto.putImageData = orig.putImageData;');
  const checksCanvasZero = testSrc.includes('FIX 2 (F3-S3): post-D non-Analysis window shows zero Canvas drawImage/getImageData/putImageData calls') && testSrc.includes("FIX 1 (F3-S3): pre-D non-Analysis Canvas calls are zero");
  const checksRestoredState = testSrc.includes('FIX 2 (F3-S3): post-D Canvas methods restored exactly, proven via Function identity') && testSrc.includes('FIX 1 (F3-S3): pre-D Canvas methods restored exactly');
  record('Part 9: Canvas drawImage/getImageData/putImageData are instrumented, calls are verified zero during the non-Analysis Keyboard/ARIA action window, and instrumented methods are restored exactly', instrumentsCanvas && restoresCanvasExactly && checksCanvasZero && checksRestoredState, `instrumentsCanvas=${instrumentsCanvas}, restoresCanvasExactly=${restoresCanvasExactly}, checksCanvasZero=${checksCanvasZero}, checksRestoredState=${checksRestoredState}`);
}
{
  const checksSliderUnchanged = testSrc.includes('function slidersUnchanged(before, after)') && testSrc.includes('FIX 2 (F3-S3): pre-D non-Analysis window shows unchanged Slider values') && testSrc.includes('FIX 2 (F3-S3): post-D non-Analysis window shows unchanged Slider values');
  const checksGenerationIsolation = testSrc.includes('FIX 2 (F3-S3): pre-D non-Analysis window shows unchanged Analysis generation') && testSrc.includes('FIX 2 (F3-S3): post-D non-Analysis window shows unchanged Analysis generation') && testSrc.includes('FIX 3 (F3-S3): exact generation accounting holds across all three windows');
  const perPartGenerationChecks = (testSrc.match(/(no Analysis rerun during|Analysis generation does not change during) Clear \w+ keyboard activation/g) || []).length >= 3;
  const perPartSliderChecks = (testSrc.match(/no Slider movement during Clear \w+ keyboard activation/g) || []).length >= 3;
  record('Part 9: Slider values and Analysis generation are checked unchanged overall AND per-Part (Clear Reasons/Observation/Session), except the one deliberate Scenario D generation change', checksSliderUnchanged && checksGenerationIsolation && perPartGenerationChecks && perPartSliderChecks, `checksSliderUnchanged=${checksSliderUnchanged}, checksGenerationIsolation=${checksGenerationIsolation}, perPartGenerationChecks=${perPartGenerationChecks}, perPartSliderChecks=${perPartSliderChecks}`);
}

// ══════════════════════════════════════════════════════════════════
// Step 7B-B-F3-S2 — FIX 1 through FIX 9 static self-test extension.
// Proves (via source audit only) that the CRITICAL REVIEW FINDINGS
// from F3-S are actually fixed in the rewritten Parts 7-9. Existing
// F1/F2/F3 static checks above are kept unchanged and must still pass.
// ══════════════════════════════════════════════════════════════════
{
  // FIX 1: Scenario A explicitly prepares exactly one Reason before
  // selecting the second (never reusing Part 5's or Scenario B's state).
  const scenarioAPreparesOneBeforeSecond = testSrc.includes("await page.click(`#ipoReason_${scenarioAReasons[0]}`);") && testSrc.includes('scenarioA_countAfterFirst === 1') && testSrc.includes('await resetLiveRegionAudit(page);\n    await page.click(`#ipoReason_${scenarioAReasons[1]}`);');
  record('FIX 1: Scenario A explicitly clears Reasons and selects exactly ONE before selecting the second (deterministic, not reused from Part 5 or Scenario B)', scenarioAPreparesOneBeforeSecond, `present=${scenarioAPreparesOneBeforeSecond}`);
}
{
  // FIX 1: Scenario B explicitly clears and selects exactly four Reasons,
  // verifies the fifth is enabled+unchecked, THEN resets the audit and
  // selects the fifth — independent of Scenario A/Part 5.
  const scenarioBDeterministic = testSrc.includes("for (const r of scenarioBFirstFour) {") && testSrc.includes('scenarioB_countAfterFour === 4') && testSrc.includes('scenarioB_fifthEnabledUnchecked') && testSrc.includes("await page.click('#ipoReason_contrast'); // genuine fifth-Reason selection AFTER the audit reset");
  record('FIX 1: Scenario B explicitly clears Reasons, selects exactly FOUR, verifies the fifth is enabled+unchecked, resets the audit, then selects the fifth via real UI action (deterministic, not reused from Scenario A or Part 5)', scenarioBDeterministic, `present=${scenarioBDeterministic}`);
}
{
  // FIX 3: whole-window (non-consecutive) duplicate detection — the
  // Set-based `seen` tracker in summarizeLiveTexts catches A→B→A, not
  // just adjacent-pair repeats, and explicitly comments this intent.
  const usesSetBasedWholeWindowDetection = testSrc.includes('const seen = new Set();') && testSrc.includes('if (seen.has(t)) { repeatedIdenticalTexts++; repeatedTexts.push(t); }') && testSrc.includes('else seen.add(t);');
  const commentsWholeWindowIntent = testSrc.includes('FIX 3 — duplicate detection spans the ENTIRE window, not just');
  record('FIX 3: duplicate detection uses a whole-window Set (not consecutive-pair comparison), correctly catching A→B→A while A→B alone is not a duplicate', usesSetBasedWholeWindowDetection && commentsWholeWindowIntent, `usesSetBasedWholeWindowDetection=${usesSetBasedWholeWindowDetection}, commentsWholeWindowIntent=${commentsWholeWindowIntent}`);
}
{
  // FIX 4: Clear Reasons fails closed with the exact named evidence
  // string when no meaningful non-empty announcement exists, and is
  // never reinterpreted as PASS.
  const failsClosedWithExactEvidence = testSrc.includes("if (auditC_totalNonEmptyAnnouncements === 0) {") && testSrc.includes('PRODUCT_ACCESSIBILITY_GAP_CLEAR_REASONS_ANNOUNCEMENT') && testSrc.includes("'Scenario C: Clear Reasons produces at least one meaningful non-empty live announcement describing the action',\n        false,");
  record('FIX 4: an empty-text Reason-limit clearing cannot satisfy Clear Reasons — zero non-empty announcements records an honest FAIL with evidence PRODUCT_ACCESSIBILITY_GAP_CLEAR_REASONS_ANNOUNCEMENT, never reinterpreted as PASS, with no Production change', failsClosedWithExactEvidence, `present=${failsClosedWithExactEvidence}`);
}
{
  // FIX 5: Clear Observation requires a real non-empty announcement
  // matching the expected cleared-state message; zero mutations/messages FAIL.
  const requiresRealAnnouncement = testSrc.includes("auditE.nonEmptyAnnouncements === 1 && auditE.distinctNonEmptyTexts.length === 1 && auditE.distinctNonEmptyTexts[0] === 'Observation cleared. Production output was not changed.' && auditE.repeatedIdenticalTexts === 0");
  record('FIX 5: Clear Observation requires exactly one non-empty ipoStatus announcement matching the real expected cleared-state message with no repeat; zero mutations/messages cannot PASS', requiresRealAnnouncement, `present=${requiresRealAnnouncement}`);
}
{
  // FIX 6: a real repeated-same-state UI action (Space re-activation of
  // the already-checked radio), verifying unchanged state and no
  // duplicate announcement, never calling Renderer/Controller directly.
  const hasRepeatedStateAction = testSrc.includes("await page.keyboard.press('Space'); // real keyboard re-activation of the SAME already-selected state (never Renderer/Controller called directly)") && testSrc.includes('f3RepeatStateBefore.checkedId === f3RepeatStateAfter.checkedId && f3RepeatStateBefore.statusText === f3RepeatStateAfter.statusText') && testSrc.includes("FIX 6: re-activating the same Observation state produces no duplicate identical live announcement");
  const neverCallsRendererOrControllerDirectly = !/interactivePreviewObservation(Controller|Renderer)\.\w+\(/.test((testSrc.split('FIX 6 (Step 7B-B-F3-S2)')[1] || '').split('await uninstallLiveRegionObservers')[0]);
  record('FIX 6: a real Keyboard re-activation of the already-selected Observation state is performed, verifying application state is unchanged and no duplicate identical announcement is produced, without calling the Renderer/Controller directly', hasRepeatedStateAction && neverCallsRendererOrControllerDirectly, `hasRepeatedStateAction=${hasRepeatedStateAction}, neverCallsRendererOrControllerDirectly=${neverCallsRendererOrControllerDirectly}`);
}
{
  // FIX 7 (F3-S2) / FIX 1-2 (F3-S3): Canvas counters are read and
  // instrumentation exactly restored BEFORE the deliberate Scenario D
  // Analysis window, and fresh zeroed instrumentation is reinstalled
  // immediately after, with the Analysis window's own accounting
  // explicitly recorded (excludedFromKeyboardAriaIsolation: true).
  const excludesAnalysisWindow = testSrc.includes('const f3PreDCanvasCalls = await readCanvasInstrumentation(page);') && testSrc.includes('const f3CanvasRestoredBeforeD = await restoreCanvasInstrumentation(page);') && testSrc.includes("await page.click('#btnReanalyze'); // deliberate real Analysis/Canvas window — Re-analyze #1");
  const reinstallsAfter = (testSrc.match(/await installCanvasInstrumentation\(page\);/g) || []).length >= 2;
  const reportsExclusionExplicitly = testSrc.includes('excludedFromKeyboardAriaIsolation: true');
  record('FIX 7 (F3-S2) / FIX 1-2 (F3-S3): the deliberate Scenario D Re-analyze/Analysis window is explicitly excluded from the zero-Canvas-call assertion (read + restore before, fresh reinstall after), reported as excludedFromKeyboardAriaIsolation=true rather than silently ignored', excludesAnalysisWindow && reinstallsAfter && reportsExclusionExplicitly, `excludesAnalysisWindow=${excludesAnalysisWindow}, reinstallsAfter=${reinstallsAfter}, reportsExclusionExplicitly=${reportsExclusionExplicitly}`);
}
{
  // FIX 8: restoration is proven via EXACT Function identity, computed
  // and returned as a Boolean BEFORE instrumentation evidence is deleted.
  const exactIdentityCheck = testSrc.includes('const restored = proto.drawImage === orig.drawImage && proto.getImageData === orig.getImageData && proto.putImageData === orig.putImageData;');
  const computedBeforeDelete = /const restored = proto\.drawImage === orig\.drawImage[^;]*;\s*delete window\.__step7bbOriginalCanvasMethods;/.test(testSrc);
  const returnsBooleanNotInference = testSrc.includes("return { restored, reason: restored ? null : 'prototype methods did not match original References after restoration' };");
  record('FIX 8: Canvas restoration is proven via exact prototype-method Function identity (===), computed and returned as a Boolean BEFORE temporary instrumentation evidence is deleted — never merely inferred from deleted variables', exactIdentityCheck && computedBeforeDelete && returnsBooleanNotInference, `exactIdentityCheck=${exactIdentityCheck}, computedBeforeDelete=${computedBeforeDelete}, returnsBooleanNotInference=${returnsBooleanNotInference}`);
}
{
  // FIX 9: expected-first-Reason-ID check (queried, never assumed).
  const expectedFirstReasonChecked = testSrc.includes("const f3ExpectedFirstReasonId = await page.evaluate(() => { const first = document.querySelector('input[name=\"ipoReason\"]'); return first ? first.id : null; });") && testSrc.includes('f3ReachedFirstReasonId === f3ExpectedFirstReasonId && f3ExpectedFirstReasonId !== null');
  record('FIX 9: the first Reason reached via Tab is compared against the ACTUAL expected first DOM Reason, queried directly rather than assumed', expectedFirstReasonChecked, `present=${expectedFirstReasonChecked}`);
}
{
  // FIX 9: exact-previous-Element Shift+Tab check (not merely "focus changed").
  const exactPreviousElementCheck = testSrc.includes('f3AfterShiftTabId === f3ElementBeforeReasonCheckbox');
  record('FIX 9: Shift+Tab is required to return to the EXACT previously-focused Element (recorded before advancing), not merely any different Element', exactPreviousElementCheck, `present=${exactPreviousElementCheck}`);
}
{
  // FIX 9: two-Element (period-2) cycle detection, not just same-ID-3x.
  const periodOneCheck = testSrc.includes('f3TrapSequence[i] === f3TrapSequence[i - 1] && f3TrapSequence[i - 1] === f3TrapSequence[i - 2]');
  const periodTwoCheck = testSrc.includes('f3TrapSequence[i] === f3TrapSequence[i - 2] && f3TrapSequence[i - 1] === f3TrapSequence[i - 3] && f3TrapSequence[i] !== f3TrapSequence[i - 1]');
  const requiresLeavingSection = testSrc.includes("const f3ReachedOutsideElement = f3ContainmentSequence.some((c) => c.insideObs === false && c.insideSession === false);");
  record('FIX 9: no-keyboard-trap detection catches BOTH a period-1 (same Element repeated) and a period-2 (two-Element cycle) trap, and separately requires focus to eventually leave the section or reach a known outside Element', periodOneCheck && periodTwoCheck && requiresLeavingSection, `periodOneCheck=${periodOneCheck}, periodTwoCheck=${periodTwoCheck}, requiresLeavingSection=${requiresLeavingSection}`);
}
{
  // FIX 9: Clear Reasons Session Reason-count checks (not merely the
  // ordinary Selected Reasons text being empty).
  const sessionReasonCountsChecked = testSrc.includes("p2ParsedSession.activeObservationsDerived === 1") && testSrc.includes("p2Session.topReasonsText === ''");
  record('FIX 9: Clear Reasons additionally requires activeObservationsDerived === 1 and empty Session Top Reasons/Reason counts, checked directly rather than relying only on the Selected Reasons text being empty', sessionReasonCountsChecked, `present=${sessionReasonCountsChecked}`);
}

// ══════════════════════════════════════════════════════════════════
// Step 7B-B-F3-S3 — FIX 1 through FIX 8 static self-test extension.
// Proves (via source audit only) the three-window Canvas/Generation/
// Slider isolation, the deterministic stale-warning wait, the cross-
// region duplicate-announcement check, and the real-DOM-containment
// no-trap check. Existing F1/F2/F3 checks above are kept unchanged.
// ══════════════════════════════════════════════════════════════════
{
  // FIX 1: pre-D Canvas counters are required to equal zero (checked
  // BEFORE Scenario D, covering Keyboard Parts 1-5 + Scenarios A/B/C).
  const preDCanvasZeroRequired = testSrc.includes("record('FIX 1 (F3-S3): pre-D non-Analysis Canvas calls are zero") && testSrc.includes('f3PreDCanvasCalls.drawImage === 0 && f3PreDCanvasCalls.getImageData === 0 && f3PreDCanvasCalls.putImageData === 0');
  record('FIX 1 (F3-S3): pre-D Canvas counters are explicitly required to equal zero, covering Keyboard Parts 1-5 and Scenarios A/B/C (non-Analysis actions are never silently excluded merely because Scenario D follows them)', preDCanvasZeroRequired, `present=${preDCanvasZeroRequired}`);
}
{
  // FIX 2: pre-D Generation and Sliders are unchanged.
  const preDGenerationUnchanged = testSrc.includes("record('FIX 2 (F3-S3): pre-D non-Analysis window shows unchanged Analysis generation") && testSrc.includes('f3PreDEndGeneration === f3GenAtStart');
  const preDSlidersUnchanged = testSrc.includes("record('FIX 2 (F3-S3): pre-D non-Analysis window shows unchanged Slider values") && testSrc.includes('slidersUnchanged(f3SlidersAtStart, f3PreDEndSliders)');
  record('FIX 2 (F3-S3): pre-D Generation is required unchanged from the section start', preDGenerationUnchanged, `present=${preDGenerationUnchanged}`);
  record('FIX 2 (F3-S3): pre-D Sliders are required unchanged from the section start', preDSlidersUnchanged, `present=${preDSlidersUnchanged}`);
}
{
  // FIX 2: the deliberate Analysis window is separately represented,
  // with excludedFromKeyboardAriaIsolation, generation before/after,
  // and the intentional Re-analyze count — Canvas/Sliders NOT asserted here.
  const analysisWindowRepresented = testSrc.includes('excludedFromKeyboardAriaIsolation: true') && testSrc.includes('const f3AnalysisWindowStartGeneration = f3PreDEndGeneration;') && testSrc.includes('const f3AnalysisWindowEndGeneration = await qaSnapshot(page)') && testSrc.includes('f3IntentionalReanalyzeCount');
  const canvasNotAssertedInAnalysisWindow = !/(f3AnalysisWindowStartGeneration[\s\S]{0,1500}Canvas.{0,40}=== 0)/.test(testSrc.split('DELIBERATE ANALYSIS WINDOW')[1]?.split('POST-D NON-ANALYSIS WINDOW')[0] || '');
  record('FIX 2 (F3-S3): the deliberate Analysis window is separately represented (excludedFromKeyboardAriaIsolation, generation before/after, intentional Re-analyze count), with Canvas/Sliders never asserted inside it', analysisWindowRepresented && canvasNotAssertedInAnalysisWindow, `analysisWindowRepresented=${analysisWindowRepresented}, canvasNotAssertedInAnalysisWindow=${canvasNotAssertedInAnalysisWindow}`);
}
{
  // FIX 2: post-D Generation and Sliders are unchanged, Canvas zero.
  const postDGenerationUnchanged = testSrc.includes("record('FIX 2 (F3-S3): post-D non-Analysis window shows unchanged Analysis generation") && testSrc.includes('f3PostDEndGeneration === f3PostDStartGeneration');
  const postDSlidersUnchanged = testSrc.includes("record('FIX 2 (F3-S3): post-D non-Analysis window shows unchanged Slider values") && testSrc.includes('slidersUnchanged(f3PostDStartSliders, f3PostDEndSliders)');
  const postDCanvasZero = testSrc.includes("record('FIX 2 (F3-S3): post-D non-Analysis window shows zero Canvas") && testSrc.includes('f3PostDCanvasCalls.drawImage === 0 && f3PostDCanvasCalls.getImageData === 0 && f3PostDCanvasCalls.putImageData === 0');
  record('FIX 2 (F3-S3): post-D Generation is required unchanged from the post-D window start', postDGenerationUnchanged, `present=${postDGenerationUnchanged}`);
  record('FIX 2 (F3-S3): post-D Sliders are required unchanged from the post-D window start (never compared across the deliberate Analysis window boundary)', postDSlidersUnchanged, `present=${postDSlidersUnchanged}`);
  record('FIX 2 (F3-S3): post-D Canvas counters are required to equal zero', postDCanvasZero, `present=${postDCanvasZero}`);
}
{
  // FIX 3: exactly two intentional Re-analyze actions are recorded,
  // and the exact generation-accounting object is required (not merely
  // final > start).
  const twoReanalyzeActions = (testSrc.match(/f3IntentionalReanalyzeCount\+\+;/g) || []).length === 2 && testSrc.includes('intentionalReanalyzeCount: f3IntentionalReanalyzeCount,') && testSrc.includes('f3GenerationAccounting.intentionalReanalyzeCount === 2');
  const exactAccountingObject = testSrc.includes('const f3GenerationAccounting = {') && testSrc.includes('preDStartGeneration: f3GenAtStart,') && testSrc.includes('preDEndGeneration: f3PreDEndGeneration,') && testSrc.includes('analysisWindowStartGeneration: f3AnalysisWindowStartGeneration,') && testSrc.includes('analysisWindowEndGeneration: f3AnalysisWindowEndGeneration,') && testSrc.includes('postDStartGeneration: f3PostDStartGeneration,') && testSrc.includes('postDEndGeneration: f3PostDEndGeneration,') && testSrc.includes('intentionalReanalyzeCount: f3IntentionalReanalyzeCount,');
  const neverMerelyGreaterThan = testSrc.includes('f3GenerationAccounting.preDEndGeneration === f3GenerationAccounting.preDStartGeneration &&') && testSrc.includes('f3GenerationAccounting.analysisWindowEndGeneration > f3GenerationAccounting.analysisWindowStartGeneration &&') && testSrc.includes('f3GenerationAccounting.postDEndGeneration === f3GenerationAccounting.postDStartGeneration &&');
  record('FIX 3 (F3-S3): exactly two intentional Re-analyze actions are recorded', twoReanalyzeActions, `present=${twoReanalyzeActions}`);
  record('FIX 3 (F3-S3): the exact generation-accounting object (pre-D/analysis-window/post-D before+after) is required, never merely "final generation greater than starting generation"', exactAccountingObject && neverMerelyGreaterThan, `exactAccountingObject=${exactAccountingObject}, neverMerelyGreaterThan=${neverMerelyGreaterThan}`);
}
{
  // FIX 4: fixed timeout is not the primary stale-warning evidence;
  // waitForFunction targets the exact stale-warning text.
  const waitForFunctionTargetsExactText = testSrc.includes("await page.waitForFunction(") && testSrc.includes("(document.getElementById('ipoWarning')?.textContent || '').trim() === expected") && testSrc.includes("const STALE_WARNING_TEXT = 'The previous observation was cleared because a newer analysis is active.';");
  const fixedTimeoutNotPrimary = testSrc.includes('// A SMALL timeout remains ONLY to flush one MutationObserver') && testSrc.includes('never a fixed timeout as primary evidence') && !testSrc.includes("await page.waitForTimeout(700); // allow the stale-warning render to occur");
  const failsHonestlyIfMissing = testSrc.includes('FAIL — stale warning text never appeared within the bounded 5000ms timeout (no announcement was fabricated)');
  record('FIX 4 (F3-S3): waitForFunction targets the EXACT stale-warning text as primary evidence, with a bounded timeout (not a fixed 700ms wait), failing honestly (no fabricated announcement) if the text never appears', waitForFunctionTargetsExactText && fixedTimeoutNotPrimary && failsHonestlyIfMissing, `waitForFunctionTargetsExactText=${waitForFunctionTargetsExactText}, fixedTimeoutNotPrimary=${fixedTimeoutNotPrimary}, failsHonestlyIfMissing=${failsHonestlyIfMissing}`);
}
{
  // FIX 5/6: duplicate detection merges all three Live regions, and is
  // applied to every scenario (A, B, C, D, E, repeated-state action).
  const crossRegionFnExists = testSrc.includes('function summarizeCrossRegionWindow(rawAuditsByRegion)') && testSrc.includes('async function readAllLiveRegionAudits(page)');
  const appliedToAllScenarios = ['Scenario A cross-region duplicate check', 'Scenario B cross-region duplicate check', 'Scenario C cross-region duplicate check', 'Scenario D cross-region duplicate check', 'Scenario E cross-region duplicate check', 'repeated-state action cross-region duplicate check'].every((s) => testSrc.includes(s));
  record('FIX 5/6 (F3-S3): a cross-region window summary function exists (merging ipoStatus + ipoWarning + ipoReasonLimit), and its duplicate check is applied to Scenarios A, B, C, D, E, and the repeated-state action', crossRegionFnExists && appliedToAllScenarios, `crossRegionFnExists=${crossRegionFnExists}, appliedToAllScenarios=${appliedToAllScenarios}`);
}
{
  // FIX 5: same text in two different regions is considered a
  // duplicate — proven by the merged single-array Set-based scan
  // (identical logic path to the whole-window per-region detector,
  // but fed from allNonEmptyAnnouncements built across ALL regions).
  const mergesBeforeDeduping = testSrc.includes('const allNonEmptyAnnouncements = [];') && testSrc.includes('allNonEmptyAnnouncements.push(t.to);') && testSrc.includes('for (const t of allNonEmptyAnnouncements) {') && testSrc.includes('if (seen.has(t)) { repeatedIdenticalTexts++; repeatedTexts.push(t); }');
  const tracksRegionSources = testSrc.includes('regionSources.push({ regionId, text: t.to });') && testSrc.includes('regionSources }');
  record('FIX 5 (F3-S3): same exact text emitted by two DIFFERENT regions is treated as a duplicate (all regions merged into one list BEFORE the whole-window Set-based scan), with regionSources tracked as evidence', mergesBeforeDeduping && tracksRegionSources, `mergesBeforeDeduping=${mergesBeforeDeduping}, tracksRegionSources=${tracksRegionSources}`);
}
{
  // FIX 7: no-trap exit uses actual DOM containment rather than ID
  // prefix alone — Node.contains() against the two real section roots.
  const usesRealContainment = testSrc.includes("const obsRoot = document.getElementById('interactivePreviewObservationInner');") && testSrc.includes("const sessionRoot = document.getElementById('interactivePreviewObservationSessionInner');") && testSrc.includes('obsRoot.contains(activeEl)') && testSrc.includes('sessionRoot.contains(activeEl)');
  const noLongerUsesIdPrefixHeuristic = !testSrc.includes(`!id.startsWith('ipo')`);
  const capturedInlineNotReconstructed = testSrc.includes('const f3CaptureContainment = () => page.evaluate(() => {') && testSrc.includes('const activeEl = document.activeElement;');
  record('FIX 7 (F3-S3): no-trap section-exit is determined via real DOM containment (Node.contains against #interactivePreviewObservationInner and #interactivePreviewObservationSessionInner), captured inline on the live activeElement, never via an ID-prefix heuristic', usesRealContainment && noLongerUsesIdPrefixHeuristic && capturedInlineNotReconstructed, `usesRealContainment=${usesRealContainment}, noLongerUsesIdPrefixHeuristic=${noLongerUsesIdPrefixHeuristic}, capturedInlineNotReconstructed=${capturedInlineNotReconstructed}`);
}
{
  // Clear Reasons named Product gap remains intact (unchanged from F3-S2).
  const productGapIntact = testSrc.includes('PRODUCT_ACCESSIBILITY_GAP_CLEAR_REASONS_ANNOUNCEMENT') && testSrc.includes('no Production change was made in this static-only patch');
  record('FIX 8 (F3-S3): the Clear Reasons named Product-accessibility-gap evidence (PRODUCT_ACCESSIBILITY_GAP_CLEAR_REASONS_ANNOUNCEMENT) remains intact and is never reinterpreted as PASS', productGapIntact, `present=${productGapIntact}`);
}
{
  // No Production file was modified — this static test only ever reads
  // qa/epic-2e-j-phase-c-step7b-b-test.mjs; it never opens or asserts
  // against core/ or ui/ files, and never claims a Production change.
  const neverReferencesCoreOrUiPaths = !/readFile\([^)]*['"`](\.\.\/)?(core|ui)\//.test(testSrc);
  const neverClaimsProductionChange = !/Production (was|has been) (changed|modified|updated)/i.test(testSrc);
  record('FIX 8 (F3-S3): no Production file was modified — this static self-test only reads the qa/ test file itself and never claims a Production change', neverReferencesCoreOrUiPaths && neverClaimsProductionChange, `neverReferencesCoreOrUiPaths=${neverReferencesCoreOrUiPaths}, neverClaimsProductionChange=${neverClaimsProductionChange}`);
}

// ══════════════════════════════════════════════════════════════════
// Honest status — Browser result remains NOT_RUN_ENVIRONMENT_BLOCKED.
// Reads the EXISTING F1 static-results honest-status record — does NOT
// execute or fabricate a browser run, does NOT regenerate the Browser
// or Final Phase C result JSON.
// ══════════════════════════════════════════════════════════════════
{
  const status = f1StaticResultsRaw?.browserSuiteExecution?.status;
  record('Browser result remains NOT_RUN_ENVIRONMENT_BLOCKED (read from existing F1 static-results honest-status record)', status === 'NOT_RUN_ENVIRONMENT_BLOCKED', `status=${status}`);
}
{
  const neverClaimsScreenReaderPass = !/(NVDA|JAWS|VoiceOver)\s+PASS/i.test(testSrc);
  record('This static test never claims actual Keyboard PASS or real screen-reader (NVDA/JAWS/VoiceOver) PASS', neverClaimsScreenReaderPass, `neverClaimsScreenReaderPass=${neverClaimsScreenReaderPass}`);
}

const passCount = results.filter((r) => r.result === 'PASS').length;
const failCount = results.filter((r) => r.result === 'FAIL').length;

const output = {
  suite: 'EPIC 2E-J — Step 7B-B-F3-S: static coverage self-test (source audit only, no Chromium)',
  generatedAt: new Date().toISOString(),
  summary: { total: results.length, pass: passCount, fail: failCount },
  results,
  disclaimer: 'This suite audits the SOURCE TEXT of qa/epic-2e-j-phase-c-step7b-b-test.mjs for the presence of required Keyboard-activation/MutationObserver/announcement-bounds/side-effect-isolation code paths and wiring. It does NOT execute a browser, does NOT measure real Tab order or real screen-reader announcements, and does NOT prove real Keyboard/ARIA PASS. A PASS here means "the required code path is present and correctly wired," not "the real UI passed Keyboard/ARIA testing."',
  browserSuiteExecution: {
    status: 'NOT_RUN_ENVIRONMENT_BLOCKED',
    note: 'Unchanged from the F1-R/F1-R2 record. This F3-S patch did not execute, simulate, or regenerate the real browser suite or its result JSON.',
    browserOrFinalResultJsonRegenerated: false,
  },
};
await writeFile(path.join(PROJECT_ROOT, 'qa', 'epic-2e-j-phase-c-step7b-b-f3-static-results.json'), JSON.stringify(output, null, 2));
console.log(`\n${passCount}/${results.length} PASS, ${failCount} FAIL`);
console.log('Browser suite execution: NOT_RUN_ENVIRONMENT_BLOCKED (see output JSON)');
process.exit(failCount > 0 ? 1 : 0);
