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
  const hasNoTrapCheck = testSrc.includes('Part 1.8: no keyboard trap detected');
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
    "Part 6.5: #ipoSessionMetrics is not a live region",
    "Part 6.6: #ipoSessionTopReasons is not a live region",
  ].every((s) => testSrc.includes(s));
  const missingElementFailsClosed = testSrc.includes('ariaStructureF3.statusExists &&') && testSrc.includes('ariaStructureF3.warningExists &&') && testSrc.includes('ariaStructureF3.reasonLimitExists &&');
  record('Part 6: ARIA-live structure requires #ipoStatus/#ipoWarning/#ipoReasonLimit polite, #ipoReasonStatus non-live with no live ancestor, and Session sections non-live, with missing elements failing closed', hasAllSixChecks && missingElementFailsClosed, `hasAllSixChecks=${hasAllSixChecks}, missingElementFailsClosed=${missingElementFailsClosed}`);
}

// ══════════════════════════════════════════════════════════════════
// Part 7 — MutationObserver live-region audit.
// ══════════════════════════════════════════════════════════════════
{
  const hasInstallFn = testSrc.includes('async function installLiveRegionObservers(page)');
  const observesOnlyThreeRegions = testSrc.includes("['ipoStatus', 'ipoWarning', 'ipoReasonLimit'].forEach((id) => {");
  const hasRequiredRecordShape = testSrc.includes('function summarizeLiveTexts(regionId, texts)') && testSrc.includes('return { regionId, mutationCount: texts.length, distinctNonEmptyTexts, repeatedIdenticalTexts, nonEmptyTexts };');
  record('Part 7: MutationObserver is installed and observes ONLY the three intended live regions (ipoStatus, ipoWarning, ipoReasonLimit), with the required {regionId, mutationCount, distinctNonEmptyTexts, repeatedIdenticalTexts} record shape', hasInstallFn && observesOnlyThreeRegions && hasRequiredRecordShape, `hasInstallFn=${hasInstallFn}, observesOnlyThreeRegions=${observesOnlyThreeRegions}, hasRequiredRecordShape=${hasRequiredRecordShape}`);
}
{
  const hasScenarioA = testSrc.includes('Scenario A: selecting an ordinary Reason does not mutate any of the three real live regions') && testSrc.includes('Scenario A: ordinary Selected Reasons text has no live-region ancestor');
  const hasScenarioB = testSrc.includes('Scenario B: reaching the five-Reason limit produces exactly one meaningful non-empty ipoReasonLimit announcement') && testSrc.includes('Scenario B: no duplicate identical ipoReasonLimit announcement was recorded');
  const hasScenarioC = testSrc.includes('Scenario C: Clear Reasons creates a meaningful state-transition announcement') && testSrc.includes('Scenario C: Clear Reasons does not announce the same message repeatedly');
  const hasScenarioD = testSrc.includes('Scenario D: a genuine stale-generation transition') && testSrc.includes('Scenario D: no duplicate identical ipoWarning announcement was recorded');
  const hasScenarioE = testSrc.includes('Scenario E: Clear Observation produces a bounded status announcement that does not repeat identically without a state change');
  record('Part 7: all five MutationObserver scenarios (A ordinary selection non-live, B limit-reached single announcement, C Clear Reasons, D stale/generation transition, E Clear Observation) are implemented', hasScenarioA && hasScenarioB && hasScenarioC && hasScenarioD && hasScenarioE, `hasScenarioA=${hasScenarioA}, hasScenarioB=${hasScenarioB}, hasScenarioC=${hasScenarioC}, hasScenarioD=${hasScenarioD}, hasScenarioE=${hasScenarioE}`);
}
{
  const rejectsDuplicates = (testSrc.match(/repeatedIdenticalTexts === 0/g) || []).length >= 4;
  const ordinaryReasonsTextAssertedNonLive = testSrc.includes('reasonStatusNoLiveAncestorA');
  record('Part 7: duplicate identical live announcements are rejected (checked in at least 4 scenarios), and ordinary Selected Reasons text is explicitly asserted non-live', rejectsDuplicates && ordinaryReasonsTextAssertedNonLive, `rejectsDuplicates=${rejectsDuplicates}, ordinaryReasonsTextAssertedNonLive=${ordinaryReasonsTextAssertedNonLive}`);
}
{
  const onlyCountsTextAnnouncements = testSrc.includes("window.__step7bbLiveAudit[id].push((el.textContent || '').trim());");
  record('Part 7: only text-content mutations are counted as announcements (never unrelated DOM mutations)', onlyCountsTextAnnouncements, `present=${onlyCountsTextAnnouncements}`);
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
  const restoresCanvasExactly = testSrc.includes('async function restoreCanvasInstrumentation(page)') && testSrc.includes('proto.drawImage = orig.drawImage; proto.getImageData = orig.getImageData; proto.putImageData = orig.putImageData;');
  const checksCanvasZero = testSrc.includes('Part 9: zero Canvas drawImage/getImageData/putImageData calls occurred during Keyboard and ARIA actions');
  const checksRestoredState = testSrc.includes('Part 9: instrumented Canvas methods were restored exactly');
  record('Part 9: Canvas drawImage/getImageData/putImageData are instrumented, calls are verified zero during Keyboard/ARIA actions, and instrumented methods are restored exactly', instrumentsCanvas && restoresCanvasExactly && checksCanvasZero && checksRestoredState, `instrumentsCanvas=${instrumentsCanvas}, restoresCanvasExactly=${restoresCanvasExactly}, checksCanvasZero=${checksCanvasZero}, checksRestoredState=${checksRestoredState}`);
}
{
  const checksSliderUnchanged = testSrc.includes('function slidersUnchanged(before, after)') && testSrc.includes('Part 9: Interactive slider values were unchanged');
  const checksGenerationIsolation = testSrc.includes('Part 9: Analysis generation was unchanged across Parts 1-7 except the one deliberate Scenario D stale-generation transition');
  const perPartGenerationChecks = (testSrc.match(/(no Analysis rerun during|Analysis generation does not change during) Clear \w+ keyboard activation/g) || []).length >= 3;
  const perPartSliderChecks = (testSrc.match(/no Slider movement during Clear \w+ keyboard activation/g) || []).length >= 3;
  record('Part 9: Slider values and Analysis generation are checked unchanged overall AND per-Part (Clear Reasons/Observation/Session), except the one deliberate Scenario D generation change', checksSliderUnchanged && checksGenerationIsolation && perPartGenerationChecks && perPartSliderChecks, `checksSliderUnchanged=${checksSliderUnchanged}, checksGenerationIsolation=${checksGenerationIsolation}, perPartGenerationChecks=${perPartGenerationChecks}, perPartSliderChecks=${perPartSliderChecks}`);
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
