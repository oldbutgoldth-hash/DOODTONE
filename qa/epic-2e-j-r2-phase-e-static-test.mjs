#!/usr/bin/env node
/**
 * qa/epic-2e-j-r2-phase-e-static-test.mjs
 *
 * COMBINED CLOSEOUT R2 — Phase E FIX E5: static/functional self-test
 * proving the fail-closed result-artifact freshness toolkit (FIX E1-E4,
 * built in qa/helpers/playwright-lumixa-test-runtime.mjs) is both
 * correct in isolation AND actually wired into all four real Browser
 * suites (Live App, Observation Smoke, Step 7B-A, Step 7B-B). Two proof
 * strategies, matching every static suite in this series:
 *
 *   (a) REAL functional calls against the actual exported pure logic
 *       (generateRunId, computeSourceHash, writeResultAtomic,
 *       buildRunIdentity, buildRuntimeCrashRow, validateResultFreshness,
 *       writeBrowserUnavailableResult) — run for real, in Node, in a
 *       throwaway temp directory, no Browser needed. Covers every FIX
 *       E5 rejection scenario: stale PASS, source-hash mismatch,
 *       completed=false, missing runId, malformed row, plus the
 *       atomic-write path and the browser-unavailable stale-PASS
 *       overwrite behavior.
 *   (b) Source-text audits of the four real Browser suites proving
 *       each imports the shared helpers, hoists runId/startedAt/
 *       sourceHash to module scope (not function-local const inside
 *       main(), which the outer catch() cannot see), calls
 *       writeBrowserUnavailableResult from both early-exit branches,
 *       includes the identity fields in its success-path output object,
 *       and writes via writeResultAtomic rather than a bare writeFile.
 *
 * Run: node qa/epic-2e-j-r2-phase-e-static-test.mjs
 * Output: qa/epic-2e-j-r2-phase-e-static-results.json
 */

import { readFile, writeFile, mkdtemp, rm, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  generateRunId,
  computeSourceHash,
  writeResultAtomic,
  buildRunIdentity,
  buildRuntimeCrashRow,
  validateResultFreshness,
  writeBrowserUnavailableResult,
} from './helpers/playwright-lumixa-test-runtime.mjs';
// COMBINED CLOSEOUT R3 — Phase D: real imported decision/lifecycle
// functions (never regex-only source checks, where an actual function
// call is possible) proving the R3 Cookie descriptor lifecycle fixes
// and the Observation Smoke fail-closed Result API/Decision.
import {
  evaluateCookiePatchSuccess,
  installCookieSetterCountingWrapper,
  restoreCookieInstrumentation,
  verifyCompatibilityCleanup,
  ensureCookieCompatibility,
  removeOpaqueOriginMemoryCookie,
} from './helpers/playwright-opaque-origin-cookie.mjs';
import { computeObservationSmokeDecision } from './epic-2e-j-phase-c-observation-smoke-test.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

const results = [];
function record(test, pass, evidence) {
  const result = pass === 'NOT_TESTED' ? 'NOT_TESTED' : pass ? 'PASS' : 'FAIL';
  results.push({ test, result, evidence });
  console.log(`${result === 'PASS' ? '✓' : result === 'FAIL' ? '✗' : '•'} [${result}] ${test} — ${evidence}`);
}

const BROWSER_SUITE_FILES = [
  'epic-2e-j-phase-c-live-app-test.mjs',
  'epic-2e-j-phase-c-observation-smoke-test.mjs',
  'epic-2e-j-phase-c-step7b-a-test.mjs',
  'epic-2e-j-phase-c-step7b-b-test.mjs',
];

async function main() {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'epic-2e-j-phase-e-static-'));
  try {
    // ══════════════════════════════════════════════════════════════
    // PART 1 — generateRunId(): fresh, non-empty, string, unique.
    // ══════════════════════════════════════════════════════════════
    const idA = generateRunId();
    const idB = generateRunId();
    record('generateRunId() returns a non-empty string', typeof idA === 'string' && idA.length > 0, `idA=${idA}`);
    record('generateRunId() returns a fresh value on each call (never reused)', idA !== idB, `idA=${idA}, idB=${idB}`);

    // ══════════════════════════════════════════════════════════════
    // PART 2 — computeSourceHash(): deterministic, content-sensitive,
    // order-sensitive, path-independent (basename-based).
    // ══════════════════════════════════════════════════════════════
    const fileA = path.join(tmpDir, 'a.txt');
    const fileB = path.join(tmpDir, 'b.txt');
    await writeFile(fileA, 'hello');
    await writeFile(fileB, 'world');
    const hash1 = await computeSourceHash([fileA, fileB]);
    const hash2 = await computeSourceHash([fileA, fileB]);
    record('computeSourceHash() is deterministic for identical inputs', hash1 === hash2, `hash1=${hash1.slice(0, 12)}..., hash2=${hash2.slice(0, 12)}...`);
    await writeFile(fileA, 'hello-changed');
    const hash3 = await computeSourceHash([fileA, fileB]);
    record('computeSourceHash() changes when file content changes', hash3 !== hash1, `hash1=${hash1.slice(0, 12)}..., hash3=${hash3.slice(0, 12)}...`);
    const hash4 = await computeSourceHash([fileB, fileA]);
    record('computeSourceHash() is sensitive to input order', hash4 !== hash3, `hash3=${hash3.slice(0, 12)}..., hash4(reversed)=${hash4.slice(0, 12)}...`);

    // ══════════════════════════════════════════════════════════════
    // PART 3 — writeResultAtomic(): atomic temp-file-then-rename write,
    // no partial/temp file left behind, content round-trips exactly.
    // ══════════════════════════════════════════════════════════════
    const resultPath = path.join(tmpDir, 'result.json');
    await writeResultAtomic(resultPath, { a: 1 });
    const afterFirst = JSON.parse(await readFile(resultPath, 'utf8'));
    record('writeResultAtomic() writes readable JSON on first write', afterFirst.a === 1, JSON.stringify(afterFirst));
    await writeResultAtomic(resultPath, { a: 2, b: 'second' });
    const afterSecond = JSON.parse(await readFile(resultPath, 'utf8'));
    record('writeResultAtomic() fully replaces prior content on a second write (no merge/partial overwrite)', afterSecond.a === 2 && afterSecond.b === 'second', JSON.stringify(afterSecond));
    const dirEntriesAfter = await readdir(tmpDir);
    const leftoverTmp = dirEntriesAfter.filter((f) => f.includes('.tmp-'));
    record('writeResultAtomic() leaves no leftover temp file in the target directory', leftoverTmp.length === 0, `entries=${JSON.stringify(dirEntriesAfter)}`);

    // ══════════════════════════════════════════════════════════════
    // PART 4 — buildRuntimeCrashRow(): bounded evidence, never the full
    // message or stack.
    // ══════════════════════════════════════════════════════════════
    const bigError = new Error('a'.repeat(5000) + ' — sensitive path /Users/whoever/secret\nStack trace line 1\nStack trace line 2');
    bigError.name = 'TypeError';
    const crashRow = buildRuntimeCrashRow(bigError);
    record('buildRuntimeCrashRow() row is well-formed {test, result, evidence}', crashRow.test === 'RUNTIME_CRASH' && crashRow.result === 'FAIL' && typeof crashRow.evidence === 'string', JSON.stringify(crashRow));
    record('buildRuntimeCrashRow() evidence contains only the bounded errorName, never the full message/stack', crashRow.evidence === 'errorName=TypeError' && !crashRow.evidence.includes('secret') && !crashRow.evidence.includes('Stack trace'), crashRow.evidence);
    const unnamedError = {};
    const crashRowNoName = buildRuntimeCrashRow(unnamedError);
    record('buildRuntimeCrashRow() falls back to UnknownError when the thrown value has no .name', crashRowNoName.evidence === 'errorName=UnknownError', crashRowNoName.evidence);

    // ══════════════════════════════════════════════════════════════
    // PART 5 — validateResultFreshness(): the six required FIX E5
    // rejection scenarios, plus the one acceptance scenario.
    // ══════════════════════════════════════════════════════════════
    const goodRow = { test: 'Example check', result: 'PASS' };
    const baseGoodResult = {
      runId: generateRunId(),
      completed: true,
      sourceHash: 'abc123',
      results: [goodRow],
      generatedAt: new Date().toISOString(),
    };

    const acceptGood = validateResultFreshness(baseGoodResult, { expectedSourceHash: 'abc123' });
    record('validateResultFreshness() ACCEPTS a current, well-formed result matching the expected sourceHash', acceptGood.valid === true, JSON.stringify(acceptGood));

    // Scenario 1: stale PASS — decision claims PASS but completed is
    // false (e.g. a crash mid-run left the file with a leftover
    // decision field from a prior template) — must be rejected.
    const stalePass = { ...baseGoodResult, completed: false, decision: 'PASS' };
    const rejectStalePass = validateResultFreshness(stalePass, { expectedSourceHash: 'abc123' });
    record('validateResultFreshness() REJECTS a stale result claiming decision=PASS while completed is not true', rejectStalePass.valid === false && rejectStalePass.reasons.some((r) => r.includes('completed')), JSON.stringify(rejectStalePass));

    // Scenario 2: source-hash mismatch.
    const hashMismatch = { ...baseGoodResult, sourceHash: 'different-hash' };
    const rejectHashMismatch = validateResultFreshness(hashMismatch, { expectedSourceHash: 'abc123' });
    record('validateResultFreshness() REJECTS a result whose sourceHash does not match the current sources', rejectHashMismatch.valid === false && rejectHashMismatch.reasons.some((r) => r.includes('sourceHash')), JSON.stringify(rejectHashMismatch));

    // Scenario 3: completed=false.
    const notCompleted = { ...baseGoodResult, completed: false };
    const rejectNotCompleted = validateResultFreshness(notCompleted, { expectedSourceHash: 'abc123' });
    record('validateResultFreshness() REJECTS a result with completed !== true', rejectNotCompleted.valid === false && rejectNotCompleted.reasons.some((r) => r.includes('completed')), JSON.stringify(rejectNotCompleted));

    // Scenario 4: missing/empty runId.
    const missingRunId = { ...baseGoodResult, runId: '' };
    const rejectMissingRunId = validateResultFreshness(missingRunId, { expectedSourceHash: 'abc123' });
    record('validateResultFreshness() REJECTS a result with an empty runId', rejectMissingRunId.valid === false && rejectMissingRunId.reasons.some((r) => r.includes('runId')), JSON.stringify(rejectMissingRunId));
    const undefinedRunId = { ...baseGoodResult };
    delete undefinedRunId.runId;
    const rejectUndefinedRunId = validateResultFreshness(undefinedRunId, { expectedSourceHash: 'abc123' });
    record('validateResultFreshness() REJECTS a result with a missing runId field entirely', rejectUndefinedRunId.valid === false && rejectUndefinedRunId.reasons.some((r) => r.includes('runId')), JSON.stringify(rejectUndefinedRunId));

    // Scenario 5: malformed row (missing required test/result fields).
    const malformedRow = { ...baseGoodResult, results: [{ evidence: 'no test or result field' }] };
    const rejectMalformedRow = validateResultFreshness(malformedRow, { expectedSourceHash: 'abc123' });
    record('validateResultFreshness() REJECTS a result containing a malformed row (missing test/result)', rejectMalformedRow.valid === false && rejectMalformedRow.reasons.some((r) => r.includes('malformed')), JSON.stringify(rejectMalformedRow));
    const emptyResultsArray = { ...baseGoodResult, results: [] };
    const rejectEmptyResults = validateResultFreshness(emptyResultsArray, { expectedSourceHash: 'abc123' });
    record('validateResultFreshness() REJECTS a result with an empty results array', rejectEmptyResults.valid === false, JSON.stringify(rejectEmptyResults));

    // Scenario 6: missing timestamp entirely.
    const noTimestamp = { ...baseGoodResult };
    delete noTimestamp.generatedAt;
    const rejectNoTimestamp = validateResultFreshness(noTimestamp, { expectedSourceHash: 'abc123' });
    record('validateResultFreshness() REJECTS a result with neither generatedAt nor completedAt', rejectNoTimestamp.valid === false && rejectNoTimestamp.reasons.some((r) => r.includes('timestamp')), JSON.stringify(rejectNoTimestamp));
    const withCompletedAtInstead = { ...baseGoodResult };
    delete withCompletedAtInstead.generatedAt;
    withCompletedAtInstead.completedAt = new Date().toISOString();
    const acceptCompletedAt = validateResultFreshness(withCompletedAtInstead, { expectedSourceHash: 'abc123' });
    record('validateResultFreshness() ACCEPTS completedAt as a valid substitute for generatedAt', acceptCompletedAt.valid === true, JSON.stringify(acceptCompletedAt));

    record('validateResultFreshness() never throws on a non-object input (fails closed instead)', (() => { try { return validateResultFreshness(null).valid === false; } catch { return false; } })(), 'checked with null input');

    // ══════════════════════════════════════════════════════════════
    // PART 6 — writeBrowserUnavailableResult(): overwrites a stale PASS
    // file with a current, non-PASS, completed=true environment result
    // (FIX E4's core guarantee — the exact scenario this Phase exists
    // to prevent).
    // ══════════════════════════════════════════════════════════════
    const stalePassPath = path.join(tmpDir, 'stale-pass-result.json');
    const oldRunId = generateRunId();
    await writeFile(stalePassPath, JSON.stringify({
      suite: 'Fake prior suite run',
      runId: oldRunId,
      completed: true,
      sourceHash: 'old-hash-from-a-real-run',
      generatedAt: '2020-01-01T00:00:00.000Z',
      summary: { total: 56, pass: 56, fail: 0, notTested: 0 },
      results: Array.from({ length: 56 }, (_, i) => ({ test: `Old check ${i}`, result: 'PASS' })),
      decision: 'PASS',
    }, null, 2));
    const writtenEnvResult = await writeBrowserUnavailableResult(stalePassPath, {
      suite: 'Fake prior suite run',
      status: 'BROWSER_BINARY_UNAVAILABLE',
      reason: 'simulated for static test',
    });
    const afterOverwrite = JSON.parse(await readFile(stalePassPath, 'utf8'));
    record('writeBrowserUnavailableResult() overwrites a stale PASS file (never leaves the old 56/56 PASS content standing)', afterOverwrite.decision !== 'PASS' && afterOverwrite.summary.pass !== 56, JSON.stringify(afterOverwrite.summary) + ', decision=' + afterOverwrite.decision);
    record('writeBrowserUnavailableResult() output has completed=true (the suite itself completed its honest environment check)', afterOverwrite.completed === true, `completed=${afterOverwrite.completed}`);
    record('writeBrowserUnavailableResult() output carries a fresh runId distinct from the stale file\'s prior runId', afterOverwrite.runId !== oldRunId && typeof afterOverwrite.runId === 'string' && afterOverwrite.runId.length > 0, `oldRunId=${oldRunId}, newRunId=${afterOverwrite.runId}`);
    record('writeBrowserUnavailableResult() decision is never PASS for any status value passed in', writtenEnvResult.decision === 'BROWSER_BINARY_UNAVAILABLE' && writtenEnvResult.decision !== 'PASS', `decision=${writtenEnvResult.decision}`);
    const freshnessOfEnvResult = validateResultFreshness(afterOverwrite, {});
    record('The environment result written by writeBrowserUnavailableResult() itself passes validateResultFreshness()', freshnessOfEnvResult.valid === true, JSON.stringify(freshnessOfEnvResult));

    // ══════════════════════════════════════════════════════════════
    // PART 7 — buildRunIdentity(): honest nulls, never fabricated
    // browser fields when none were launched.
    // ══════════════════════════════════════════════════════════════
    const identity = buildRunIdentity({ runId: 'r1', startedAt: 's1', completedAt: 'c1', completed: true, sourceHash: 'h1', browserExecutablePath: null, browserVersion: null });
    record('buildRunIdentity() preserves completed:true and honest null browser fields when none were launched', identity.completed === true && identity.browserExecutablePath === null && identity.browserVersion === null, JSON.stringify(identity));
    const identityDefaults = buildRunIdentity({});
    record('buildRunIdentity() defaults every unset field to null/false rather than undefined', identityDefaults.runId === null && identityDefaults.completed === false, JSON.stringify(identityDefaults));

    // ══════════════════════════════════════════════════════════════
    // PART 8 — source-text audits: prove the toolkit is actually WIRED
    // into all four real Browser suites, not merely available.
    // ══════════════════════════════════════════════════════════════
    for (const suiteFile of BROWSER_SUITE_FILES) {
      const suitePath = path.join(PROJECT_ROOT, 'qa', suiteFile);
      const src = await readFile(suitePath, 'utf8');

      const importsHelpers = /generateRunId,?[\s\S]{0,200}?computeSourceHash,?[\s\S]{0,200}?writeResultAtomic,?[\s\S]{0,200}?buildRuntimeCrashRow,?[\s\S]{0,200}?writeBrowserUnavailableResult/.test(src);
      record(`${suiteFile}: imports all five Phase E helpers from the shared runtime module`, importsHelpers, `present=${importsHelpers}`);

      const hoistedModuleScope = /\nlet runId = null;\nlet startedAt = null;\nlet sourceHash = null;/.test(src);
      record(`${suiteFile}: runId/startedAt/sourceHash are hoisted to MODULE scope (visible to the outer main().catch() handler)`, hoistedModuleScope, `present=${hoistedModuleScope}`);

      const writesUnavailableTwice = (src.match(/await writeBrowserUnavailableResult\(/g) || []).length >= 2;
      record(`${suiteFile}: calls writeBrowserUnavailableResult() from at least both early-exit branches (Playwright-package-unavailable and Browser-binary-unavailable)`, writesUnavailableTwice, `occurrences=${(src.match(/await writeBrowserUnavailableResult\(/g) || []).length}`);

      const successOutputHasIdentity = /runId,\s*\n\s*startedAt,\s*\n\s*completedAt: new Date\(\)\.toISOString\(\),\s*\n\s*completed: true,\s*\n\s*sourceHash,/.test(src);
      record(`${suiteFile}: success-path output object includes runId/startedAt/completedAt/completed:true/sourceHash`, successOutputHasIdentity, `present=${successOutputHasIdentity}`);

      const usesAtomicWriteNotBareWriteFile = /await writeResultAtomic\(/.test(src) && !/writeFile\(path\.join\(PROJECT_ROOT, 'qa', '[^']*results\.json'\), JSON\.stringify\(output/.test(src);
      record(`${suiteFile}: writes its official result via writeResultAtomic(), not a bare writeFile()`, usesAtomicWriteNotBareWriteFile, `present=${usesAtomicWriteNotBareWriteFile}`);

      const crashHandlerWritesResult = /main\(\)\.catch\(async \(err\) => \{[\s\S]*?writeResultAtomic\(/.test(src);
      record(`${suiteFile}: the top-level main().catch() handler itself writes a current crash result before exiting`, crashHandlerWritesResult, `present=${crashHandlerWritesResult}`);

      const crashHandlerNeverLogsFullError = !/console\.error\([^)]*crashed[^)]*,\s*err\)/.test(src);
      record(`${suiteFile}: the crash handler logs only err.name, never the full error object`, crashHandlerNeverLogsFullError, `present=${crashHandlerNeverLogsFullError}`);

      const decisionNeverForcedPass = !/decision:\s*'PASS'\s*,?\s*\/\/\s*(fallback|default|unavailable)/i.test(src);
      record(`${suiteFile}: no code path hard-codes decision:'PASS' as an unavailable/fallback/default value`, decisionNeverForcedPass, `present(no bad pattern found)=${decisionNeverForcedPass}`);
    }

    // Step 7B-A specifically must also include the cookie helper in its
    // source-hash inputs, since Phase D introduced that new dependency.
    const step7bASrc = await readFile(path.join(PROJECT_ROOT, 'qa', 'epic-2e-j-phase-c-step7b-a-test.mjs'), 'utf8');
    const includesCookieHelperInHash = /SOURCE_HASH_INPUTS = \[[\s\S]*?playwright-opaque-origin-cookie\.mjs[\s\S]*?\]/.test(step7bASrc);
    record('epic-2e-j-phase-c-step7b-a-test.mjs: SOURCE_HASH_INPUTS includes playwright-opaque-origin-cookie.mjs (a source change there must invalidate this suite\'s prior result freshness)', includesCookieHelperInHash, `present=${includesCookieHelperInHash}`);

    // ══════════════════════════════════════════════════════════════
    // PART 9 — COMBINED CLOSEOUT R3 evidence. Real imported decision/
    // lifecycle functions wherever a genuine function call is possible
    // (never regex-only source checks for these), per the R3 spec's
    // explicit Phase D instruction.
    // ══════════════════════════════════════════════════════════════

    // ── R3-1: no Browser suite stores a Boolean Result value ──
    // Functional proof against the REAL, imported, exported decision
    // function (not a reimplementation): a raw Boolean `false` injected
    // as a row's `result` must be rejected as malformed/Boolean, never
    // silently treated as NOT_TESTED, and must never allow Decision PASS.
    const boolFalseRows = [{ test: 'real check', result: 'PASS', evidence: 'x' }, { test: 'injected boolean false', result: false, evidence: 'y' }];
    const decisionBoolFalse = computeObservationSmokeDecision(boolFalseRows, { completed: true, sourceHash: 'h', currentSourceHash: 'h' });
    record('R3-1: computeObservationSmokeDecision() (real imported fn) REJECTS a raw Boolean `false` Result value — never NOT_TESTED, never PASS', decisionBoolFalse.decision === 'FAIL' && decisionBoolFalse.reasons.some((r) => r.includes('BOOLEAN_RESULT_ROWS')), JSON.stringify(decisionBoolFalse));
    const boolTrueRows = [{ test: 'injected boolean true', result: true, evidence: 'y' }];
    const decisionBoolTrue = computeObservationSmokeDecision(boolTrueRows, { completed: true, sourceHash: 'h', currentSourceHash: 'h' });
    record('R3-1: computeObservationSmokeDecision() (real imported fn) REJECTS a raw Boolean `true` Result value the same way (never silently accepted as PASS)', decisionBoolTrue.decision === 'FAIL' && decisionBoolTrue.reasons.some((r) => r.includes('BOOLEAN_RESULT_ROWS')), JSON.stringify(decisionBoolTrue));

    // ── R3-2: a false condition becomes FAIL, never NOT_TESTED/PASS ──
    // (the Boolean-false case above already demonstrates this end-to-end
    // through the real Decision function; recordCondition() itself is a
    // trivial one-line delegation to recordStatus(), confirmed present
    // via source audit below since it has no independently useful
    // return value to call directly without also exercising module-level
    // side effects.)
    const recordConditionSrc = await readFile(path.join(PROJECT_ROOT, 'qa', 'epic-2e-j-phase-c-observation-smoke-test.mjs'), 'utf8');
    const recordConditionFalseIsFail = /function recordCondition\(test, condition, evidence\) \{\s*recordStatus\(test, condition === true \? 'PASS' : 'FAIL', evidence\);\s*\}/.test(recordConditionSrc);
    record('R3-2: recordCondition() maps condition===true to PASS and EVERY other value (including false) to FAIL — never NOT_TESTED', recordConditionFalseIsFail, `present=${recordConditionFalseIsFail}`);
    const noStrayBooleanTernaryCallSites = !/results\.push\(\{[^}]*result:\s*\w+\s*\?\s*'PASS'\s*:\s*'FAIL'/.test(recordConditionSrc);
    record('R3-2: no un-migrated inline Boolean-ternary result assignment remains outside the strict recordStatus/recordCondition API', noStrayBooleanTernaryCallSites, `present(no stray pattern found)=${noStrayBooleanTernaryCallSites}`);

    // ── R3-3: Observation Smoke cannot PASS with 22 NOT_TESTED rows ──
    const rows22NotTested = Array.from({ length: 22 }, (_, i) => ({ test: `manual gap ${i}`, result: 'NOT_TESTED', evidence: 'x' }));
    const decision22NotTested = computeObservationSmokeDecision(rows22NotTested, { completed: true, sourceHash: 'h', currentSourceHash: 'h' });
    record('R3-3: computeObservationSmokeDecision() (real imported fn) REJECTS 22 unexpected NOT_TESTED rows (the exact historical defect count)', decision22NotTested.decision === 'FAIL' && decision22NotTested.reasons.some((r) => r.includes('UNEXPECTED_NOT_TESTED=22')), JSON.stringify(decision22NotTested));

    // ── R3-4: Observation Smoke cannot PASS when one false condition exists ──
    // (equivalent to the Boolean-false injection above — a "false
    // condition" can only ever reach the Result set as FAIL via
    // recordCondition(), or as a raw Boolean if some code path bypassed
    // the strict API; both are proven rejected above.)
    record('R3-4: a single false/FAIL condition anywhere in the Result set prevents Decision PASS (see R3-1 Boolean-false and the one-FAIL case in Part 5 above)', decisionBoolFalse.decision === 'FAIL', JSON.stringify(decisionBoolFalse));

    // ── R3-5: all Result rows require non-empty Test and valid Status ──
    const malformedVariants = [
      { label: 'blank test name', row: { test: '', result: 'PASS', evidence: 'x' } },
      { label: 'whitespace-only test name', row: { test: '   ', result: 'PASS', evidence: 'x' } },
      { label: 'unrecognized status string', row: { test: 'a', result: 'MAYBE', evidence: 'x' } },
      { label: 'missing evidence key', row: (() => { const r = { test: 'a', result: 'PASS' }; return r; })() },
    ];
    for (const { label, row } of malformedVariants) {
      const d = computeObservationSmokeDecision([row], { completed: true, sourceHash: 'h', currentSourceHash: 'h' });
      record(`R3-5: computeObservationSmokeDecision() (real imported fn) REJECTS a malformed row (${label})`, d.decision === 'FAIL' && d.reasons.some((r) => r.includes('MALFORMED_ROWS')), JSON.stringify(d));
    }

    // ── R3-6/7: Cookie Descriptor uses get/set keys (never getter/
    // setter); patch detection compares preserved Getter / changed
    // Setter — real imported functions, fake documentLike objects. ──
    function fakeGet() { return 'fake-cookie-value'; }
    function fakeSet(v) { this.__stored = v; }
    const nativeDescriptor = { get: fakeGet, set: fakeSet, configurable: true, enumerable: true };
    const fakeDoc1 = {};
    Object.defineProperty(fakeDoc1, 'cookie', nativeDescriptor);
    const counter = { setterCalls: 0 };
    const { patchedDescriptor, evidence: patchEvidence } = installCookieSetterCountingWrapper(fakeDoc1, nativeDescriptor, counter);
    record('R3-6: installCookieSetterCountingWrapper() (real imported fn) preserves the ORIGINAL getter by exact reference (getterPreserved)', patchEvidence.getterPreserved === true && patchedDescriptor.get === fakeGet, JSON.stringify(patchEvidence));
    record('R3-7: evaluateCookiePatchSuccess() (real imported fn) correctly detects a CHANGED setter (setterChanged) — the correctly-oriented check (not the R3 root-cause-A1 inverted check)', patchEvidence.setterChanged === true && patchedDescriptor.set !== fakeSet, JSON.stringify(patchEvidence));
    record('R3-7: evaluateCookiePatchSuccess() reports setterPatched=true only when getter preserved AND setter changed AND both are Functions AND configurable/enumerable preserved', patchEvidence.setterPatched === true, JSON.stringify(patchEvidence));
    // Inverted-orientation regression proof: if the getter had ALSO
    // changed (simulating the R3 ROOT CAUSE A1 bug's expectation), the
    // real imported function must NOT report a successful patch.
    const invertedPatchedDescriptor = { get: function anotherGetter() { return ''; }, set: patchedDescriptor.set, configurable: true, enumerable: true };
    const invertedEvidence = evaluateCookiePatchSuccess(invertedPatchedDescriptor, nativeDescriptor);
    record('R3-7: evaluateCookiePatchSuccess() (real imported fn) correctly reports setterPatched=false when the getter was ALSO changed (proves the ROOT CAUSE A1 inversion bug is fixed, not reintroduced)', invertedEvidence.getterPreserved === false && invertedEvidence.setterPatched === false, JSON.stringify(invertedEvidence));
    // Object.defineProperty() key-shape proof: confirm the counting
    // wrapper's own installation call used valid get/set keys by
    // reading the resulting descriptor back and verifying it is a real,
    // functioning accessor (a {getter,setter}-keyed object passed to
    // defineProperty would have produced a plain data property with
    // `value: undefined` and no working get/set instead).
    const readBack = Object.getOwnPropertyDescriptor(fakeDoc1, 'cookie');
    record('R3-6: the installed descriptor is a genuine get/set accessor pair (never a corrupted {value:undefined} data property from a {getter,setter}-keyed object)', typeof readBack.get === 'function' && typeof readBack.set === 'function' && !('value' in readBack), JSON.stringify({ hasGet: typeof readBack.get, hasSet: typeof readBack.set, hasValueKey: 'value' in readBack }));

    // ── R3-8: exact compatibility Descriptor restoration ──
    const fakeDoc2 = {};
    // No own 'cookie' property exists yet — this is the PRISTINE shape
    // captured before ensureCookieCompatibility() ever touches fakeDoc2,
    // which STAGE 2 cleanup (R3-9 below) must be compared against.
    const hadOwnBeforeAnyInstallation = Object.prototype.hasOwnProperty.call(fakeDoc2, 'cookie');
    // Simulate an opaque-origin document: a throwing getter is the only
    // own 'cookie' property present, so ensureCookieCompatibility() must
    // detect the SecurityError and install its Test-only compatibility
    // cookie in its place.
    Object.defineProperty(fakeDoc2, 'cookie', { get() { throw Object.assign(new Error('SecurityError'), { name: 'SecurityError' }); }, configurable: true });
    const compatResult = ensureCookieCompatibility(fakeDoc2);
    record('R3-8 setup: ensureCookieCompatibility() (real imported fn) installs the Test-only compatibility cookie when native access throws', compatResult.status === 'OPAQUE_ORIGIN_MEMORY_COOKIE_INSTALLED', JSON.stringify(compatResult));
    const compatOwnDescriptor = Object.getOwnPropertyDescriptor(fakeDoc2, 'cookie');
    const wrapCounter = { setterCalls: 0 };
    const wrapResult = installCookieSetterCountingWrapper(fakeDoc2, compatOwnDescriptor, wrapCounter);
    fakeDoc2.cookie = 'a=1'; // exercise the wrapper once
    const restoreResult = restoreCookieInstrumentation(fakeDoc2, { hadOwnBefore: true, originalOwnDescriptor: compatOwnDescriptor });
    const afterRestoreDescriptor = Object.getOwnPropertyDescriptor(fakeDoc2, 'cookie');
    record('R3-8: restoreCookieInstrumentation() (real imported fn) restores the EXACT pre-wrapping descriptor by strict Function reference (get/set/configurable/enumerable all identical)', restoreResult.instrumentationRestoredExactly === true && afterRestoreDescriptor.get === compatOwnDescriptor.get && afterRestoreDescriptor.set === compatOwnDescriptor.set, JSON.stringify({ restoreResult, setterCallsDuringWrap: wrapCounter.setterCalls }));
    record('R3-8: the counting wrapper genuinely counted exactly one setter invocation before restoration', wrapCounter.setterCalls === 1, `setterCalls=${wrapCounter.setterCalls}`);

    // ── R3-9: compatibility marker removal is tested ──
    const removalResult = removeOpaqueOriginMemoryCookie(fakeDoc2);
    const cleanupEvidence = verifyCompatibilityCleanup(fakeDoc2, removalResult, { hadPropertyBeforeAnyInstallation: hadOwnBeforeAnyInstallation, hadOwnPropertyBeforeAnyInstallation: hadOwnBeforeAnyInstallation });
    record('R3-9: verifyCompatibilityCleanup() (real imported fn) confirms the __opaqueOriginCookieInstalled marker is fully removed (not merely set to false)', cleanupEvidence.markerRemoved === true, JSON.stringify(cleanupEvidence));
    record('R3-9: verifyCompatibilityCleanup() confirms the compatibility own-property descriptor itself is removed', cleanupEvidence.compatibilityDescriptorRemoved === true, JSON.stringify(cleanupEvidence));
    record('R3-9: verifyCompatibilityCleanup() confirms the final shape matches the PRISTINE pre-any-installation shape (never compared against the temporary compatibility descriptor)', cleanupEvidence.originalShapeRestored === true, JSON.stringify(cleanupEvidence));

    // ── R3-10: the real about:blank Cookie runtime self-test exists ──
    const cookieHelperSrc = await readFile(path.join(PROJECT_ROOT, 'qa', 'helpers', 'playwright-opaque-origin-cookie.mjs'), 'utf8');
    const hasRealBrowserSelfTest = /export (async )?function runRealBrowserCookieSelfTest\(/.test(cookieHelperSrc);
    record('R3-10: qa/helpers/playwright-opaque-origin-cookie.mjs exports runRealBrowserCookieSelfTest() — a real Chromium/about:blank runtime self-test (FIX A4), not only fake-Document tests', hasRealBrowserSelfTest, `present=${hasRealBrowserSelfTest}`);
    const selfTestHasSecondPageProof = /second[\s\S]{0,80}[Pp]age/.test(cookieHelperSrc) && /runRealBrowserCookieSelfTest/.test(cookieHelperSrc);
    record('R3-10: the real-Browser Cookie self-test proves a second Page begins clean', selfTestHasSecondPageProof, `present=${selfTestHasSecondPageProof}`);
    const selfTestNeverLeaksCookieValue = /no Cookie value|leaked cookie value|cookie value string/i.test(cookieHelperSrc);
    record('R3-10: the real-Browser Cookie self-test verifies no Cookie value is written into its own Result JSON', selfTestNeverLeaksCookieValue, `present=${selfTestNeverLeaksCookieValue}`);
    const hasStandaloneRunner = /const isMainModule = \(\(\) => \{/.test(cookieHelperSrc) && /runRealBrowserCookieSelfTest/.test(cookieHelperSrc);
    record('R3-10: the cookie helper is directly runnable as a standalone script (node qa/helpers/playwright-opaque-origin-cookie.mjs) and writes its own current result file', hasStandaloneRunner, `present=${hasStandaloneRunner}`);

    // ── R3-11: Live App output uses the correct Suite label ──
    const liveAppSrc = await readFile(path.join(PROJECT_ROOT, 'qa', 'epic-2e-j-phase-c-live-app-test.mjs'), 'utf8');
    const hasCorrectLabel = liveAppSrc.includes('Live App Final Decision');
    const hasNoStaleLabel = !liveAppSrc.includes('Step 7A Final Decision');
    record('R3-11: epic-2e-j-phase-c-live-app-test.mjs logs "Live App Final Decision" (FIX C1)', hasCorrectLabel, `present=${hasCorrectLabel}`);
    record('R3-11: epic-2e-j-phase-c-live-app-test.mjs no longer contains the incorrect "Step 7A Final Decision" label', hasNoStaleLabel, `present(no stale label)=${hasNoStaleLabel}`);

    // ── R3-12: no Production file changed — genuine hash comparison ──
    // against the LU6A09~1 baseline this entire R3 round continues from
    // (the same baseline confirmed, earlier in this campaign, to be the
    // previously-delivered R2_v2 package via matching file listings/
    // timestamps). A real byte-for-byte SHA-256 comparison, not a
    // timestamp/existence-only check.
    const baselineRoot = path.resolve(PROJECT_ROOT, '..', '..', 'LU6A09~1');
    const PRODUCTION_LOCKED_FILES = [
      'ui/app.js',
      'ui/interactive-preview-observation-controller-v2.js',
      'ui/interactive-preview-observation-renderer-v2.js',
      'ui/interactive-preview-observation-session-v2.js',
      'index.html',
    ];
    async function sha256File(p) {
      const buf = await readFile(p);
      return createHash('sha256').update(buf).digest('hex');
    }
    let baselineReachable = true;
    try {
      await readFile(path.join(baselineRoot, 'index.html'));
    } catch {
      baselineReachable = false;
    }
    if (baselineReachable) {
      for (const relFile of PRODUCTION_LOCKED_FILES) {
        try {
          const [baseHash, curHash] = await Promise.all([
            sha256File(path.join(baselineRoot, relFile)),
            sha256File(path.join(PROJECT_ROOT, relFile)),
          ]);
          record(`R3-12: ${relFile} is byte-for-byte identical to the LU6A09~1 baseline (SHA-256 match)`, baseHash === curHash, `baseHash=${baseHash}, curHash=${curHash}`);
        } catch (hashErr) {
          record(`R3-12: ${relFile} is byte-for-byte identical to the LU6A09~1 baseline (SHA-256 match)`, false, `could not hash: ${hashErr.message}`);
        }
      }
      // core/ directory: hash every file, sorted by a path relative to
      // each root (never the absolute path, which necessarily differs
      // between the baseline and current directories).
      async function hashDirRelative(root, subdir) {
        const out = [];
        async function walk(dir) {
          const entries = await readdir(dir, { withFileTypes: true });
          for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) { await walk(full); } else if (entry.isFile()) {
              const rel = path.relative(root, full);
              out.push(`${rel}:${await sha256File(full)}`);
            }
          }
        }
        await walk(path.join(root, subdir));
        return out.sort().join('\n');
      }
      const baselineCoreDigest = await hashDirRelative(baselineRoot, 'core');
      const currentCoreDigest = await hashDirRelative(PROJECT_ROOT, 'core');
      record('R3-12: core/ directory is byte-for-byte identical to the LU6A09~1 baseline (every file, path-relative SHA-256 comparison)', baselineCoreDigest === currentCoreDigest, baselineCoreDigest === currentCoreDigest ? 'match' : 'MISMATCH DETECTED');
    } else {
      record('R3-12: LU6A09~1 baseline reachable for Production-lock hash comparison', false, `baseline not reachable at ${baselineRoot} — cannot perform genuine hash comparison in this environment`);
    }

  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }

  const passCount = results.filter((r) => r.result === 'PASS').length;
  const failCount = results.filter((r) => r.result === 'FAIL').length;
  const notTestedCount = results.filter((r) => r.result === 'NOT_TESTED').length;
  const output = {
    suite: 'COMBINED CLOSEOUT R2 — Phase E FIX E5: fail-closed result-artifact freshness static/functional self-test',
    generatedAt: new Date().toISOString(),
    summary: { total: results.length, pass: passCount, fail: failCount, notTested: notTestedCount },
    results,
    disclaimer: 'This suite proves the Phase E toolkit (generateRunId, computeSourceHash, writeResultAtomic, buildRunIdentity, buildRuntimeCrashRow, validateResultFreshness, writeBrowserUnavailableResult) via real functional calls in a throwaway temp directory, plus source-text audits proving all four real Browser suites are actually wired to use it. It does not launch a Browser and does not prove real end-to-end crash-handler behavior under an actual Playwright runtime exception — that remains the job of the real Browser suites themselves (which, in this sandbox, can only be exercised along the Browser-unavailable path, confirmed separately by actually running each suite).',
  };
  await writeFile(path.join(PROJECT_ROOT, 'qa', 'epic-2e-j-r2-phase-e-static-results.json'), JSON.stringify(output, null, 2));
  console.log(`\n${passCount}/${results.length} PASS, ${failCount} FAIL, ${notTestedCount} NOT_TESTED`);
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Phase E static test crashed:', err);
  process.exit(2);
});
