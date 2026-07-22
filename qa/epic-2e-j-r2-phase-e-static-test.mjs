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
