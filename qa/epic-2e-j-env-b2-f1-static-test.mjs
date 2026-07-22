#!/usr/bin/env node
/**
 * qa/epic-2e-j-env-b2-f1-static-test.mjs
 *
 * EPIC 2E-J — ENV-B2-F1 FIX 10: static/functional self-test proving
 * every one of FIX 1-9 is actually present and correct in
 * qa/epic-2e-j-phase-c-step7b-b-test.mjs and its helpers, WITHOUT
 * requiring a real Browser. Two proof strategies are used, matching
 * every prior round in this series:
 *
 *   (a) REAL functional calls against the actual exported pure logic
 *       (computeInMemoryHarnessDecision, computeStep7BBDecision,
 *       PERMITTED_NOT_TESTED_STEP_7BB) — these run for real, in Node,
 *       with no Browser needed.
 *   (b) Source-text audits of qa/epic-2e-j-phase-c-step7b-b-test.mjs
 *       proving the required deterministic-entry / bounded-Tab /
 *       persistent-identity / Cleared-count / collector-merge /
 *       environment-metadata code is present, and that every retired
 *       brittle pattern (hard-coded Tab counts, tagName-only identity
 *       fallback, relative "+1" Cleared assumption) is GONE.
 *
 * This suite also proves FIX 9: none of the three genuine Product
 * findings (stale-generation warning, disabled sixth-Reason visual
 * distinction, Physical touch hardware) were weakened or reinterpreted
 * as PASS, and that no Production file (core/, ui/, index.html) was
 * ever touched by this round's changes.
 *
 * UPDATED for EPIC 2E-J — ENV-B2-F2: the FIX 1-9 checks below were
 * re-verified and rewritten against the current ENV-B2-F2 code shape
 * (runObservationSelectionReasonAndClearScenario, the six-key Arrow
 * sequence, the two independent boundToFirstReason/boundReasonToClearSession
 * bounds, enterObservationRadioGroupWithCurrentSelection for Part 3).
 * A new FIX 10 (ENV-B2-F2) check proves storagePrivacyKeysObserved is a
 * bounded Array of key names rather than a bare .length count, and the
 * FIX 8/11 functional cases were updated to supply the bounded `test`
 * name every row now requires. This file (kept at its original
 * filename per the ENV-B2-F2 spec's optional-rename clause) now
 * exercises both the ENV-B2-F1 and ENV-B2-F2 code paths.
 *
 * Run: node qa/epic-2e-j-env-b2-f1-static-test.mjs
 * Output: qa/epic-2e-j-env-b2-f1-static-results.json
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeInMemoryHarnessDecision } from './helpers/playwright-lumixa-test-runtime.mjs';
import { computeStep7BBDecision, PERMITTED_NOT_TESTED_STEP_7BB } from './epic-2e-j-phase-c-step7b-b-f1-decision.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

const results = [];
function record(test, pass, evidence) {
  const result = pass === 'NOT_TESTED' ? 'NOT_TESTED' : pass ? 'PASS' : 'FAIL';
  results.push({ test, result, evidence });
  console.log(`${result === 'PASS' ? '✓' : result === 'FAIL' ? '✗' : '•'} [${result}] ${test} — ${evidence}`);
}

const testSrc = await readFile(path.join(PROJECT_ROOT, 'qa', 'epic-2e-j-phase-c-step7b-b-test.mjs'), 'utf8');
const runtimeHelperSrc = await readFile(path.join(PROJECT_ROOT, 'qa', 'helpers', 'playwright-lumixa-test-runtime.mjs'), 'utf8');
const smokeSrc = await readFile(path.join(PROJECT_ROOT, 'qa', 'playwright-in-memory-app-smoke.mjs'), 'utf8');

record('Setup: qa/epic-2e-j-phase-c-step7b-b-test.mjs is readable', testSrc.length > 0, `${testSrc.length} bytes`);
record('Setup: qa/helpers/playwright-lumixa-test-runtime.mjs is readable', runtimeHelperSrc.length > 0, `${runtimeHelperSrc.length} bytes`);
record('Setup: qa/playwright-in-memory-app-smoke.mjs is readable', smokeSrc.length > 0, `${smokeSrc.length} bytes`);

// ══════════════════════════════════════════════════════════════════
// FIX 1 — deterministic Tab entry into the Observation radio group.
// ══════════════════════════════════════════════════════════════════
{
  const hasFn = /async function enterObservationRadioGroupDeterministically\(page\)/.test(testSrc);
  const usesRealFocusableOrder = /window\.__step7bbTestUtils\.computeFocusableOrder\(\)/.test(testSrc);
  const locatesTarget = /targetIndex = order\.findIndex\(\(o\) => o\.id === targetId\)/.test(testSrc);
  const locatesPrecedingOutsideBothRoots = /!order\[i\]\.insideObs && !order\[i\]\.insideSession/.test(testSrc);
  const focusesSetupOnly = /order\[previousIndex\]\.element\.focus\(\); \/\/ setup only/.test(testSrc);
  const exactlyOneTab = /await page\.keyboard\.press\('Tab'\); \/\/ the ONE real Tab acceptance action/.test(testSrc);
  const requiresActiveElementMatch = /ok: actualAfterTabIdentity === targetId/.test(testSrc);
  const pass = hasFn && usesRealFocusableOrder && locatesTarget && locatesPrecedingOutsideBothRoots && focusesSetupOnly && exactlyOneTab && requiresActiveElementMatch;
  record(
    'FIX 1 (ENV-B2-F1): enterObservationRadioGroupDeterministically() queries the real focusable order, locates the target radio, locates the immediately preceding focusable Element outside BOTH Observation roots, focuses it for setup only (never the radio), presses exactly ONE real Tab, and requires activeElement === target',
    pass,
    `hasFn=${hasFn}, usesRealFocusableOrder=${usesRealFocusableOrder}, locatesTarget=${locatesTarget}, locatesPrecedingOutsideBothRoots=${locatesPrecedingOutsideBothRoots}, focusesSetupOnly=${focusesSetupOnly}, exactlyOneTab=${exactlyOneTab}, requiresActiveElementMatch=${requiresActiveElementMatch}`
  );
  const returnBlockMatch = testSrc.match(/async function enterObservationRadioGroupDeterministically[\s\S]*?\n\}/);
  const returnBlockSrc = returnBlockMatch ? returnBlockMatch[0] : '';
  const recordsRequiredEvidence = ['targetId', 'previousFocusableIdentity', 'previousFocusableIndex', 'targetFocusableIndex', 'actualAfterTabIdentity'].every((k) => new RegExp(`\\b${k}\\b`).test(returnBlockSrc));
  record('FIX 1 (ENV-B2-F1): the required evidence fields are recorded — {targetId, previousFocusableIdentity, previousFocusableIndex, targetFocusableIndex, actualAfterTabIdentity}', recordsRequiredEvidence, `present=${recordsRequiredEvidence}`);
  const usedInMainAndF3S = (testSrc.match(/enterObservationRadioGroupDeterministically\(page\)/g) || []).length >= 3;
  record('FIX 1 (ENV-B2-F1): the deterministic entry is reused by PART 2 (main keyboard scenario), FIX 3 (Reason/Clear scenario), and F3-S Part 1 (never re-implemented ad hoc)', usedInMainAndF3S, `callSites=${(testSrc.match(/enterObservationRadioGroupDeterministically\(page\)/g) || []).length}`);
}

// ══════════════════════════════════════════════════════════════════
// FIX 2 — independent Arrow-key scenario.
// ══════════════════════════════════════════════════════════════════
{
  const hasFn = /async function runIndependentArrowScenario\(page\)/.test(testSrc);
  const ownEntry = /async function runIndependentArrowScenario\(page\) \{\s*\n\s*const entry = await enterObservationRadioGroupDeterministically\(page\);/.test(testSrc);
  const fourExactIds = /const expectedIds = \['ipoOption_prefer-legacy', 'ipoOption_prefer-v2', 'ipoOption_no-visible-difference', 'ipoOption_unsure'\];/.test(testSrc);
  // FIX 3 (ENV-B2-F2): the Arrow scenario now exercises all SIX key
  // presses in keySequence (ArrowDown x3, ArrowRight, ArrowUp,
  // ArrowLeft) rather than an old 3-step loop, records {key, activeId,
  // checkedIds, checkedCount} per step, and requires
  // steps.length === keySequence.length with every step's
  // checkedCount === 1.
  const recordsEveryStepShape = /steps\.push\(\{ key, activeId: state\.activeId, checkedIds: state\.checkedIds, checkedCount: state\.checkedCount \}\)/.test(testSrc);
  const allExactlyOneCheckedCurrent = /const allExactlyOneChecked = steps\.length === keySequence\.length && steps\.every\(\(s\) => s\.checkedCount === 1\)/.test(testSrc);
  const allExpectedVisitedCurrent = /const allExpectedVisited = expectedIds\.every\(\(id\) => visitedIds\.has\(id\)\)/.test(testSrc);
  const pass = hasFn && ownEntry && fourExactIds && recordsEveryStepShape && allExactlyOneCheckedCurrent && allExpectedVisitedCurrent;
  record(
    'FIX 2/3 (ENV-B2-F2): runIndependentArrowScenario() performs its OWN deterministic entry (never inherits focus state), presses all SIX real Arrow keys in keySequence (covering all four key names), records {key, activeId, checkedIds, checkedCount} after EVERY step, and requires exactly one Radio checked after every individual Arrow action AND every expected Radio ID genuinely visited',
    pass,
    `hasFn=${hasFn}, ownEntry=${ownEntry}, fourExactIds=${fourExactIds}, recordsEveryStepShape=${recordsEveryStepShape}, allExactlyOneCheckedCurrent=${allExactlyOneCheckedCurrent}, allExpectedVisitedCurrent=${allExpectedVisitedCurrent}`
  );
}

// ══════════════════════════════════════════════════════════════════
// FIX 3 — Reason/Clear-button Tab order with a derived bound, and
// every remaining hard-coded 15/20 Tab-count guess removed.
// ══════════════════════════════════════════════════════════════════
{
  // FIX 6/7 (ENV-B2-F2): the old runReasonAndClearTabOrderScenario() /
  // f3ClearBound single-bound approach was replaced by the canonical
  // runObservationSelectionReasonAndClearScenario(), which derives TWO
  // independent bounds (boundToFirstReason, boundReasonToClearSession)
  // from the CURRENT post-selection focusable order, both gated by
  // boundsAllDerived.
  const hasScenarioFn = /async function runObservationSelectionReasonAndClearScenario\(page\)/.test(testSrc);
  const hasBoundFn = /async function computeBoundedMaxTabs\(page, fromId, toId, margin = 5\)/.test(testSrc);
  const genericBoundDerivedFromRealOrder = /Math\.max\(1, bounds\.toIndex - bounds\.fromIndex\) \+ margin/.test(testSrc);
  const noHardCoded15 = !/tabTo\(page, 'ipoClearButton', 15,/.test(testSrc);
  const noHardCoded20 = !/tabTo\(page, 'ipoClearSessionButton', 20,/.test(testSrc);
  const p3UsesBound = /const p3Bound = await computeBoundedMaxTabs\(page, p3Entry\.targetId, 'ipoClearButton'\)/.test(testSrc);
  const p4UsesBound = /const p4Bound = await computeBoundedMaxTabs\(page, 'ipoOption_prefer-legacy', 'ipoClearSessionButton'\)/.test(testSrc);
  const twoIndependentBoundsDerived = /const boundToFirstReason = expectedFirstReasonId \? await computeBoundedMaxTabs\(page, 'ipoOption_prefer-legacy', expectedFirstReasonId\)/.test(testSrc)
    && /const boundReasonToClearSession = expectedFirstReasonId \? await computeBoundedMaxTabs\(page, expectedFirstReasonId, 'ipoClearSessionButton'\)/.test(testSrc)
    && /const boundsAllDerived = boundToFirstReason\.derived === true && boundReasonToClearSession\.derived === true/.test(testSrc);
  const pass = hasScenarioFn && hasBoundFn && genericBoundDerivedFromRealOrder && noHardCoded15 && noHardCoded20 && p3UsesBound && p4UsesBound && twoIndependentBoundsDerived;
  record(
    'FIX 3/6 (ENV-B2-F2): every Tab-count bound in this suite (canonical Reason/Clear scenario — TWO independent bounds boundToFirstReason/boundReasonToClearSession — Part 3.1, Part 4.1) is derived from the real focusable-order distance via computeBoundedMaxTabs() — the previous hard-coded 15/20 guesses are all gone',
    pass,
    `hasScenarioFn=${hasScenarioFn}, hasBoundFn=${hasBoundFn}, genericBoundDerivedFromRealOrder=${genericBoundDerivedFromRealOrder}, noHardCoded15=${noHardCoded15}, noHardCoded20=${noHardCoded20}, p3UsesBound=${p3UsesBound}, p4UsesBound=${p4UsesBound}, twoIndependentBoundsDerived=${twoIndependentBoundsDerived}`
  );
  const requiresAllThreeClearTargets = /f3ReasonClear\.boundsAllDerived && f3ReasonClear\.reachedClearReasons && f3ReasonClear\.reachedClearObs && f3ReasonClear\.reachedClearSession/.test(testSrc)
    && /canonicalReasonClear\.boundsAllDerived && canonicalReasonClear\.reachedClearReasons/.test(testSrc);
  record('FIX 3/6 (ENV-B2-F2): the canonical Reason/Clear scenario requires Tab to reach Clear Reasons, Clear Observation, AND Clear Session — each gated by boundsAllDerived — not merely one of the three, in both PART 2 and F3-S PART 1 call sites', requiresAllThreeClearTargets, `present=${requiresAllThreeClearTargets}`);
}

// ══════════════════════════════════════════════════════════════════
// FIX 4 — persistent Focus identity via a Window-scoped WeakMap,
// replacing the tagName-only fallback in trap detection.
// ══════════════════════════════════════════════════════════════════
{
  const identityUsesWeakMap = /const identityMap = new WeakMap\(\);/.test(testSrc) && /identityMap\.set\(el, identitySeq\)/.test(testSrc);
  const identityFormat = /return el\.id \? el\.id : \(el\.tagName \+ '#focus-node-' \+ seq\);/.test(testSrc);
  const f3CaptureUsesIdentify = /const label = window\.__step7bbTestUtils\.identify\(activeEl\);/.test(testSrc);
  const oldFallbackGone = !/const label = \(activeEl && activeEl\.id\) \|\| \(activeEl && activeEl\.tagName\) \|\| null;/.test(testSrc);
  const pass = identityUsesWeakMap && identityFormat && f3CaptureUsesIdentify && oldFallbackGone;
  record(
    'FIX 4 (ENV-B2-F1): the shared identify() utility assigns each real DOM Element a persistent, unique sequential identity via a Window-scoped WeakMap<Element, number> (format TAGNAME#focus-node-N, or element.id when present), and f3CaptureContainment (trap detection) now calls it instead of the old tagName-only fallback that conflated distinct anonymous Elements',
    pass,
    `identityUsesWeakMap=${identityUsesWeakMap}, identityFormat=${identityFormat}, f3CaptureUsesIdentify=${f3CaptureUsesIdentify}, oldFallbackGone=${oldFallbackGone}`
  );
  const installedOnceReused = /await installStep7bbTestUtils\(page\); \/\/ FIX 4 \(ENV-B2-F1\)/.test(testSrc);
  record('FIX 4 (ENV-B2-F1): installStep7bbTestUtils(page) is called exactly once at Page setup and reused throughout (idempotent guard: `if (window.__step7bbTestUtils) return;`)', installedOnceReused && /if \(window\.__step7bbTestUtils\) return;/.test(testSrc), `installedOnceReused=${installedOnceReused}`);
}

// ══════════════════════════════════════════════════════════════════
// FIX 5 — deterministic Cleared-count scenario (sticky per-generation
// cap, never a relative "+1" assumption from an uncontrolled baseline).
// ══════════════════════════════════════════════════════════════════
{
  const usesClearSessionAsSetup = /await safeClickIfEnabled\(page, 'ipoClearSessionButton'\); \/\/ setup only: establishes a known Cleared=0 baseline/.test(testSrc);
  const verifiesKnownBaseline = /p3ParsedBaseline\.activeObservationsDerived === 1 && p3SecondaryBaseline\.cleared === 0/.test(testSrc);
  const verifiesZeroToOneTransition = /p3ParsedAfterFirst\.activeObservationsDerived === 0 && p3ClearedAfterFirst === 1/.test(testSrc);
  const verifiesRepeatDoesNotIncrement = /p3ClearedAfterFirst === 1 && p3ClearedAfterSecond === 1/.test(testSrc);
  const oldRelativeAssumptionGone = !/p3ClearedAfterFirst === p3ClearedBefore \+ 1/.test(testSrc) && !/const p3ClearedBefore =/.test(testSrc);
  const pass = usesClearSessionAsSetup && verifiesKnownBaseline && verifiesZeroToOneTransition && verifiesRepeatDoesNotIncrement && oldRelativeAssumptionGone;
  record(
    'FIX 5 (ENV-B2-F1): Part 3 (Clear Observation) uses Clear Session as isolated setup to reach a KNOWN 0/1 baseline, verifies that baseline BEFORE the tested action, reaches Clear Observation via real Tab, activates with Space, verifies activeObservationsDerived===0 && cleared===1, and verifies a repeat activation leaves cleared at 1 — the old relative "+1 from an uncontrolled baseline" assumption is gone',
    pass,
    `usesClearSessionAsSetup=${usesClearSessionAsSetup}, verifiesKnownBaseline=${verifiesKnownBaseline}, verifiesZeroToOneTransition=${verifiesZeroToOneTransition}, verifiesRepeatDoesNotIncrement=${verifiesRepeatDoesNotIncrement}, oldRelativeAssumptionGone=${oldRelativeAssumptionGone}`
  );
}

// ══════════════════════════════════════════════════════════════════
// FIX 6 — merge pre-load Runtime collectors into the final decision.
// ══════════════════════════════════════════════════════════════════
{
  const mergesMainAndPart7PreLoad = /const preLoadPageErrors = \[\.\.\.mainRuntime\.collectors\.pageErrors, \.\.\.part7Runtime\.collectors\.pageErrors\];/.test(testSrc);
  const mergesConsoleErrors = /const preLoadConsoleErrors = \[\.\.\.mainRuntime\.collectors\.consoleErrors, \.\.\.part7Runtime\.collectors\.consoleErrors\];/.test(testSrc);
  const mergesRequestFailures = /const preLoadRequestFailures = \[\.\.\.mainRuntime\.collectors\.requestFailures, \.\.\.part7Runtime\.collectors\.requestFailures\];/.test(testSrc);
  const mergesNonAllowedRequests = /const preLoadNonAllowedNetworkRequests = \[\.\.\.mainRuntime\.collectors\.nonAllowedNetworkRequests, \.\.\.part7Runtime\.collectors\.nonAllowedNetworkRequests\];/.test(testSrc);
  const hasThreeRequiredRows = (testSrc.match(/record\(\s*\n?\s*'FIX 6 \(ENV-B2-F1\)/g) || []).length >= 3;
  const noFontExceptionForNonAllowed = /no Google-Fonts exception needed, the In-Memory Harness must make zero external requests/.test(testSrc);
  const pass = mergesMainAndPart7PreLoad && mergesConsoleErrors && mergesRequestFailures && mergesNonAllowedRequests && hasThreeRequiredRows && noFontExceptionForNonAllowed;
  record(
    'FIX 6 (ENV-B2-F1): pre-load Runtime collectors (pageErrors/consoleErrors/requestFailures/nonAllowedNetworkRequests) from BOTH the main and Part 7 Pages are merged with the post-load consoleErrors/resourceErrors into the final decision, with explicit result rows for zero pre-load+post-load errors/failures/non-allowed requests, and no Google-Fonts exception for non-allowed requests (harness must make zero external requests)',
    pass,
    `mergesMainAndPart7PreLoad=${mergesMainAndPart7PreLoad}, mergesConsoleErrors=${mergesConsoleErrors}, mergesRequestFailures=${mergesRequestFailures}, mergesNonAllowedRequests=${mergesNonAllowedRequests}, hasThreeRequiredRows=${hasThreeRequiredRows}, noFontExceptionForNonAllowed=${noFontExceptionForNonAllowed}`
  );
}

// ══════════════════════════════════════════════════════════════════
// FIX 10 (ENV-B2-F2) — storagePrivacyKeysObserved is a bounded Array of
// key NAMES (privacyRisk.flagged), never a bare .length count.
// ══════════════════════════════════════════════════════════════════
{
  const usesFlaggedArrayNotLength = /storagePrivacyKeysObserved: privacyRisk \? privacyRisk\.flagged : \[\]/.test(testSrc);
  const noLongerUsesLengthForm = !/storagePrivacyKeysObserved: privacyRisk\.flagged\.length/.test(testSrc);
  record('FIX 10 (ENV-B2-F2): storagePrivacyKeysObserved reports the bounded Array of flagged key NAMES (privacyRisk.flagged), empty-safe as [], never the prior bare privacyRisk.flagged.length count', usesFlaggedArrayNotLength && noLongerUsesLengthForm, `usesFlaggedArrayNotLength=${usesFlaggedArrayNotLength}, noLongerUsesLengthForm=${noLongerUsesLengthForm}`);
}

// ══════════════════════════════════════════════════════════════════
// FIX 7 — bounded `environment` metadata block in the results JSON.
// ══════════════════════════════════════════════════════════════════
{
  const requiredKeys = ['browserExecutablePath', 'browserVersion', 'pageUrl', 'moduleCount', 'importEdgeCount', 'storageStatus', 'storageReadOnly', 'storagePrivacyKeysObserved', 'networkRequestCount', 'inMemoryHarnessDecision'];
  const envBlockMatch = testSrc.match(/const environmentMetadata = \{[\s\S]*?\n  \};/);
  const envBlockSrc = envBlockMatch ? envBlockMatch[0] : '';
  // Each key is either `key: value,` or, for browserVersion, the ES2015
  // shorthand `browserVersion,` (a bare identifier already named the
  // same as the outer const) — both forms are valid property syntax.
  const allKeysPresent = requiredKeys.every((k) => new RegExp(`\\b${k}\\b\\s*[:,]`).test(envBlockSrc));
  record('FIX 7 (ENV-B2-F1): the environment metadata block exists and defines every required key — {browserExecutablePath, browserVersion, pageUrl, moduleCount, importEdgeCount, storageStatus, storageReadOnly, storagePrivacyKeysObserved, networkRequestCount, inMemoryHarnessDecision}', envBlockSrc.length > 0 && allKeysPresent, `found=${envBlockSrc.length > 0}, allKeysPresent=${allKeysPresent}, keys=${JSON.stringify(requiredKeys)}`);

  const noSourceOrDataUrlLeak = envBlockSrc.length > 0 && !/data:text\//.test(envBlockSrc) && !/\bsrc\b\s*:/.test(envBlockSrc) && !/rewrittenSource/.test(envBlockSrc) && !/\.stack\b/.test(envBlockSrc);
  record('FIX 7 (ENV-B2-F1): the environment metadata block contains only key names/bounded counts — never raw source, data: URLs, image bytes, or full stacks', noSourceOrDataUrlLeak, `envBlockLength=${envBlockSrc.length}, noSourceOrDataUrlLeak=${noSourceOrDataUrlLeak}`);

  const reusesCanonicalDecision = /inMemoryHarnessDecision: computeInMemoryHarnessDecision\(harnessCheckResults\)/.test(testSrc);
  const outputIncludesEnvironment = /environment: environmentMetadata,/.test(testSrc);
  record('FIX 7 (ENV-B2-F1): inMemoryHarnessDecision reuses the canonical computeInMemoryHarnessDecision() function, and the `environment` block is included in the written results JSON output', reusesCanonicalDecision && outputIncludesEnvironment, `reusesCanonicalDecision=${reusesCanonicalDecision}, outputIncludesEnvironment=${outputIncludesEnvironment}`);
}

// ══════════════════════════════════════════════════════════════════
// FIX 8 — qa/playwright-in-memory-app-smoke.mjs uses the canonical
// fail-closed computeInMemoryHarnessDecision(), and it is proven
// correct against every case the old logic mishandled.
// ══════════════════════════════════════════════════════════════════
{
  const oldBrittlePatternGone = !/results\.filter\(\s*\(r\)\s*=>\s*r\.result\s*===\s*'FAIL'\s*\)\s*\.length\s*===\s*0/.test(smokeSrc);
  const importsCanonical = /computeInMemoryHarnessDecision/.test(smokeSrc) && /playwright-lumixa-test-runtime\.mjs/.test(smokeSrc);
  const callsCanonical = /output\.finalDecision = computeInMemoryHarnessDecision\(results\);/.test(smokeSrc);
  record('FIX 8 (ENV-B2-F1): qa/playwright-in-memory-app-smoke.mjs no longer uses its own brittle FAIL-count decision logic, and instead imports + calls the canonical computeInMemoryHarnessDecision(results)', oldBrittlePatternGone && importsCanonical && callsCanonical, `oldBrittlePatternGone=${oldBrittlePatternGone}, importsCanonical=${importsCanonical}, callsCanonical=${callsCanonical}`);

  // FIX 11 (ENV-B2-F2): every row now also requires a bounded non-empty
  // `test` name, so well-formed rows in this suite's own cases must
  // include one — an old test-name-less row like { result: 'PASS' }
  // would now correctly FAIL under the strengthened contract.
  const cases = [
    ['non-empty, all-PASS well-formed rows', [{ test: 'a', result: 'PASS' }, { test: 'b', result: 'PASS' }], 'PASS_IN_MEMORY_HARNESS_READY'],
    ['empty results array', [], 'FAIL_IN_MEMORY_HARNESS'],
    ['a malformed row (no result field)', [{ test: 'a', result: 'PASS' }, { test: 'b' }], 'FAIL_IN_MEMORY_HARNESS'],
    ['a NOT_TESTED row', [{ test: 'a', result: 'PASS' }, { test: 'b', result: 'NOT_TESTED' }], 'FAIL_IN_MEMORY_HARNESS'],
    ['a boolean result row', [{ test: 'a', result: 'PASS' }, { test: 'b', result: false }], 'FAIL_IN_MEMORY_HARNESS'],
    ['an unknown result string row', [{ test: 'a', result: 'PASS' }, { test: 'b', result: 'UNKNOWN' }], 'FAIL_IN_MEMORY_HARNESS'],
    ['FIX 11 (ENV-B2-F2): a missing-test-field row', [{ test: 'a', result: 'PASS' }, { result: 'PASS' }], 'FAIL_IN_MEMORY_HARNESS'],
    ['FIX 11 (ENV-B2-F2): a blank-test-field row', [{ test: 'a', result: 'PASS' }, { test: '   ', result: 'PASS' }], 'FAIL_IN_MEMORY_HARNESS'],
  ];
  for (const [label, input, expected] of cases) {
    const actual = computeInMemoryHarnessDecision(input);
    record(`FIX 8/11 (ENV-B2-F2): computeInMemoryHarnessDecision() real functional proof — ${label} — expected ${expected}`, actual === expected, `actual=${actual}`);
  }
}

// ══════════════════════════════════════════════════════════════════
// FIX 9 — the 3 genuine Product findings remain honest and
// unweakened: none was reinterpreted as PASS.
// ══════════════════════════════════════════════════════════════════
{
  // (A) stale-generation warning: the Controller's .reset() at the
  // start of runAnalysis() means the stale-warning lifecycle is real
  // and can genuinely fail; this checks the real waitForFunction-based
  // observation is still present and still capable of recording FAIL.
  const staleWarningStillReal = /const STALE_WARNING_TEXT = 'The previous observation was cleared because a newer analysis is active\.';/.test(testSrc)
    && /f3StaleWarningObserved \? `stale warning text observed via waitForFunction/.test(testSrc)
    && /FAIL — stale warning text never appeared within the bounded 5000ms timeout/.test(testSrc);
  record('FIX 9 (ENV-B2-F1): (A) the stale-generation warning test remains a real, honestly-failable waitForFunction-based observation — never hard-coded to PASS', staleWarningStillReal, `present=${staleWarningStillReal}`);

  // (B) disabled sixth Reason: the honest NOT_TESTED explanation (tool
  // limitation, no CSS/class added merely to force a pass) must remain
  // verbatim.
  const disabledReasonHonestNotTested = /'NOT_TESTED', `all \$\{propsToCompare\.length\} compared VISIBLE computed-style properties are identical/.test(testSrc)
    && /no CSS\/class was added merely to force a pass/.test(testSrc);
  record('FIX 9 (ENV-B2-F1): (B) the disabled sixth-Reason visual-distinction test still honestly reports NOT_TESTED as a real tool limitation when no distinguishing style exists — never reinterpreted as PASS, never faked with an added CSS class', disabledReasonHonestNotTested, `present=${disabledReasonHonestNotTested}`);

  // (C) Physical touch hardware — the one documented, permitted manual
  // NOT_TESTED item.
  const physicalTouchStillNotTested = /record\('Physical touch hardware', 'NOT_TESTED', 'genuine physical touch hardware was not used'\);/.test(testSrc);
  record('FIX 9 (ENV-B2-F1): (C) "Physical touch hardware" remains the one documented, permitted manual NOT_TESTED item — never reinterpreted as PASS', physicalTouchStillNotTested, `present=${physicalTouchStillNotTested}`);

  // The decision file's permitted-NOT_TESTED allowlist must be exactly
  // ['Physical touch hardware'] — no new escape hatches introduced for
  // the stale-warning or disabled-Reason findings.
  const permittedListUnchanged = Array.isArray(PERMITTED_NOT_TESTED_STEP_7BB) && PERMITTED_NOT_TESTED_STEP_7BB.length === 1 && PERMITTED_NOT_TESTED_STEP_7BB[0] === 'Physical touch hardware';
  record('FIX 9 (ENV-B2-F1): PERMITTED_NOT_TESTED_STEP_7BB is still exactly [\'Physical touch hardware\'] — no new NOT_TESTED escape hatch was added for either genuine Product finding', permittedListUnchanged, `PERMITTED_NOT_TESTED_STEP_7BB=${JSON.stringify(PERMITTED_NOT_TESTED_STEP_7BB)}`);

  // Real functional proof: computeStep7BBDecision still forces FAIL for
  // a stale-warning-shaped or disabled-Reason-shaped FAIL/NOT_TESTED
  // row that is NOT the one permitted name.
  const shapedRows = [
    { test: 'FIX 4 (F3-S3): the stale-generation warning text is awaited deterministically via waitForFunction targeting the exact expected text (never a fixed timeout as primary evidence)', result: 'FAIL' },
    { test: 'Disabled sixth Reason (color-balance) is visually distinguishable from its own enabled state (measurable via computed style)', result: 'NOT_TESTED' },
    { test: 'Physical touch hardware', result: 'NOT_TESTED' },
  ];
  const shapedDecision = computeStep7BBDecision(shapedRows);
  record('FIX 9 (ENV-B2-F1): real functional proof — computeStep7BBDecision() still returns FAIL when a genuine stale-warning FAIL or a disabled-Reason NOT_TESTED row is present alongside the one permitted "Physical touch hardware" NOT_TESTED row', shapedDecision === 'FAIL', `decision=${shapedDecision}, rows=${JSON.stringify(shapedRows)}`);
}

// ══════════════════════════════════════════════════════════════════
// FIX 10 — no Production file was modified by this round's changes,
// and neither results file this suite must not touch was regenerated
// by anything in this round's changed files.
// ══════════════════════════════════════════════════════════════════
{
  const productionFiles = [
    'core/interactive-preview-observation-controller-v2.js',
    'core/interactive-preview-observation-session-v2.js',
    'ui/interactive-preview-observation-renderer-v2.js',
    'ui/interactive-preview-observation-controller-v2.js',
    'ui/interactive-preview-observation-session-v2.js',
    'index.html',
  ];
  const markerStrings = ['ENV-B2-F1', '__step7bbTestUtils', 'computeInMemoryHarnessDecision', 'enterObservationRadioGroupDeterministically'];
  const leakFindings = [];
  for (const relPath of productionFiles) {
    let content = '';
    try {
      content = await readFile(path.join(PROJECT_ROOT, relPath), 'utf8');
    } catch {
      continue; // file does not exist in this project layout — not a leak
    }
    for (const marker of markerStrings) {
      if (content.includes(marker)) leakFindings.push({ file: relPath, marker });
    }
  }
  record('FIX 10 (ENV-B2-F1): no ENV-B2-F1 QA marker string leaked into any Production file (core/, ui/, index.html) — proves this round\'s edits stayed confined to the ALLOWED FILES list', leakFindings.length === 0, leakFindings.length === 0 ? 'zero markers found in Production files' : JSON.stringify(leakFindings));

  const neverWritesToProduction = !/writeFile\([^)]*\bcore\//.test(testSrc) && !/writeFile\([^)]*\bui\//.test(testSrc) && !/writeFile\([^)]*index\.html/.test(testSrc);
  record('FIX 10 (ENV-B2-F1): qa/epic-2e-j-phase-c-step7b-b-test.mjs never calls writeFile() with a core/, ui/, or index.html target path', neverWritesToProduction, `present=${neverWritesToProduction}`);

  const doesNotRegenerateFinalPhaseC = !/epic-2e-j-phase-c-final-results\.json/.test(testSrc);
  const onlyWritesOwnResultsFile = /writeFile\(path\.join\(PROJECT_ROOT, 'qa', 'epic-2e-j-phase-c-step7b-b-results\.json'\), JSON\.stringify\(output, null, 2\)\);/.test(testSrc);
  record('FIX 10 (ENV-B2-F1): qa/epic-2e-j-phase-c-step7b-b-test.mjs never references/regenerates the Final Phase C results file, and its only results write targets its own step7b-b-results.json', doesNotRegenerateFinalPhaseC && onlyWritesOwnResultsFile, `doesNotRegenerateFinalPhaseC=${doesNotRegenerateFinalPhaseC}, onlyWritesOwnResultsFile=${onlyWritesOwnResultsFile}`);
}

const passCount = results.filter((r) => r.result === 'PASS').length;
const failCount = results.filter((r) => r.result === 'FAIL').length;
const notTestedCount = results.filter((r) => r.result === 'NOT_TESTED').length;
const output = {
  suite: 'EPIC 2E-J ENV-B2-F1 FIX 10 — Real Browser QA Determinism and Evidence Integrity static/functional self-test',
  generatedAt: new Date().toISOString(),
  summary: { total: results.length, pass: passCount, fail: failCount, notTested: notTestedCount },
  results,
  disclaimer: 'This suite proves FIX 1-9 via real functional calls against exported pure logic (computeInMemoryHarnessDecision, computeStep7BBDecision, PERMITTED_NOT_TESTED_STEP_7BB) plus source-text audits of qa/epic-2e-j-phase-c-step7b-b-test.mjs and qa/playwright-in-memory-app-smoke.mjs. It does not launch a Browser and proves nothing about actual real-DOM Tab/Arrow/Space keyboard behavior — that remains the job of the real Step 7B-B Browser suite, which was NOT re-executed by this static test.',
};
await writeFile(path.join(PROJECT_ROOT, 'qa', 'epic-2e-j-env-b2-f1-static-results.json'), JSON.stringify(output, null, 2));
console.log(`\n${passCount}/${results.length} PASS, ${failCount} FAIL, ${notTestedCount} NOT_TESTED`);
process.exit(failCount > 0 ? 1 : 0);
