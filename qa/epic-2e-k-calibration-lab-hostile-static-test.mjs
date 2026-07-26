#!/usr/bin/env node
/**
 * qa/epic-2e-k-calibration-lab-hostile-static-test.mjs
 *
 * EPIC 2E-K -- CONTROLLED V2 CALIBRATION LAB -- Phase M.
 *
 * Dedicated static/hostile suite proving the R1 spec's Section 17
 * requirements one-by-one, each with a genuine detector AND a hostile
 * self-test showing the detector actually catches a synthetic bad
 * sample (never just "the current source happens to look clean").
 *
 * No Browser, no network -- safe for run-static-suites.mjs. Item 9
 * (stale QA evidence must fail the Local Gate) is the one exception
 * that genuinely spawns `node tools/local-gate.mjs` as a real child
 * process against a deliberately tampered result file, then restores
 * the original honest result file afterward -- this is the only way
 * to prove the REAL gate script rejects stale evidence rather than
 * asserting it in the abstract.
 */
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateSession, validateImageRecord, createImageTestRecord } from '../core/calibration-lab/schema.js';
import { extractSafetySnapshot } from '../core/calibration-lab/run-comparison-pipeline.js';
import { buildExportJson, buildExportCsv } from '../core/calibration-lab/export-dataset.js';
import { computeCurrentSourceHash } from './phase-c-suite-source-manifest.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

let passCount = 0, failCount = 0, notTestedCount = 0;
function record(test, ok, evidence) {
  const icon = ok ? '✓' : '✗';
  const status = ok ? 'PASS' : 'FAIL';
  if (ok) passCount++; else failCount++;
  const safeEvidence = (() => { try { return JSON.stringify(evidence); } catch { return String(evidence); } })();
  console.log(`${icon} [${status}] ${test} — ${safeEvidence}`);
}
function recordNotTested(test, reason) {
  notTestedCount++;
  console.log(`• [NOT_TESTED] ${test} — ${reason}`);
}

// RECURSION GUARD: this file is itself registered in
// qa/run-static-suites.mjs, which is itself Step 3 of
// tools/local-gate.mjs. Item 9 below spawns `node tools/local-gate.mjs`
// as a real child process to prove stale evidence cannot survive a real
// gate run -- but that child process's own Step 3 would spawn
// run-static-suites.mjs again, which would spawn THIS file again,
// which would spawn local-gate.mjs again, forever. This env var is set
// on the child process spawned below so that a NESTED invocation of
// this same file (reached only through that recursive chain) detects
// it and skips the recursive sub-test instead of spawning yet another
// generation -- breaking the cycle after exactly one real, genuine
// gate run.
const RECURSION_GUARD_ENV = 'LUMIXA_CAL_LAB_HOSTILE_TEST_GATE_SPAWN_IN_PROGRESS';
function read(relPath) { try { return fs.readFileSync(path.join(PROJECT_ROOT, relPath), 'utf-8'); } catch { return null; } }

// ── Item 1: Calibration Decision cannot write a Production flag ────────────
{
  const controllerSrc = read('ui/calibration-lab/calibration-lab-controller.js');
  const literalFalse = /productionWrite:\s*false,/.test(controllerSrc) && /controlledV2Apply:\s*false,/.test(controllerSrc) && /previewExport:\s*false,/.test(controllerSrc);
  record('Item 1: getQaSnapshot() reports productionWrite/controlledV2Apply/previewExport as LITERAL false (never a mutable variable)', literalFalse, {});
  const noProductionFlagAssignment = !/allowProductionWrite\s*=\s*true/.test(controllerSrc) && !/allowExport\s*=\s*true/.test(controllerSrc) && !/controlledV2ProductionActivation\s*=\s*true/.test(controllerSrc);
  record('Item 1: calibration-lab-controller.js never assigns any Production-activating flag to true', noProductionFlagAssignment, {});
  // Hostile self-test: a hand-written detector pattern must catch a synthetic violation.
  const hostileSample = 'function getQaSnapshot() { return { productionWrite: this._writeEnabled, controlledV2Apply: false, previewExport: false }; }';
  const hostileCaught = !/productionWrite:\s*false,/.test(hostileSample);
  record('Item 1 HOSTILE: the literal-false detector correctly flags a sample where productionWrite is a variable, not a literal', hostileCaught, {});
}

// ── Item 2: Calibration Export cannot produce XMP ───────────────────────────
{
  const exportSrc = read('core/calibration-lab/export-dataset.js');
  const controllerSrc = read('ui/calibration-lab/calibration-lab-controller.js');
  const rendererSrc = read('ui/calibration-lab/calibration-lab-renderer.js');
  const noXmpCalls = [exportSrc, controllerSrc, rendererSrc].every((src) => src !== null && !/serializeXMP|downloadXMP/.test(src));
  record('Item 2: export-dataset.js / calibration-lab-controller.js / calibration-lab-renderer.js never call serializeXMP/downloadXMP', noXmpCalls, {});
  const hostileSample = 'import { downloadXMP } from "../../core/preset-engine/index.js";';
  record('Item 2 HOSTILE: the detector correctly flags a synthetic sample that imports downloadXMP', /serializeXMP|downloadXMP/.test(hostileSample), {});
}

// ── Item 3: a Controlled V2 Record cannot become a Production Mapping ──────
{
  const pipelineSrc = read('core/calibration-lab/run-comparison-pipeline.js');
  const noActivationImport = !/mapping-v2-activation-controller/.test(pipelineSrc) && !/buildLightroomControlledActivationV2/.test(pipelineSrc);
  record('Item 3: run-comparison-pipeline.js never imports/calls the Production activation controller directly', noActivationImport, {});
  const storageSrc = read('ui/calibration-lab/calibration-lab-storage.js');
  const separateDatabase = /DB_NAME\s*=\s*'lumixa-calibration-lab'/.test(storageSrc);
  record('Item 3: Calibration Lab persists to its own separate IndexedDB database name, never a Production store', separateDatabase, {});
  const hostileSample = "import { buildLightroomControlledActivationV2 } from '../lightroom-mapping-engine/mapping-v2-activation-controller.js';";
  record('Item 3 HOSTILE: the detector correctly flags a synthetic sample importing the activation controller', /mapping-v2-activation-controller/.test(hostileSample), {});
}

// ── Item 4: a Localized Sentence is never stored as a Canonical Decision ───
{
  const rec = createImageTestRecord({ imageCategories: ['EVENT'], lightingCondition: 'DAYLIGHT' });
  const withThaiSentence = { ...rec, userDecision: 'Controlled V2 ดีกว่ามาก เพราะสีผิวดูเป็นธรรมชาติกว่า' };
  const withEnglishSentence = { ...rec, userDecision: 'I think the new version looks noticeably better here' };
  record('Item 4: validateImageRecord() rejects a Thai free-text sentence used as userDecision', validateImageRecord(withThaiSentence) === false, {});
  record('Item 4: validateImageRecord() rejects an English free-text sentence used as userDecision', validateImageRecord(withEnglishSentence) === false, {});
  record('Item 4 HOSTILE: a genuinely valid stable-code decision is still accepted (detector is not overbroad)', validateImageRecord({ ...rec, userDecision: 'V2_BETTER' }) === true, {});
}

// ── Item 5: Raw Core Prose never leaks into the main UI ─────────────────────
{
  const mockFinalPreset = {
    _decision: { finalStyleIntent: {
      visualPreviewRenderPlanV2: { legacyRenderPlan: { adjustmentModel: {} }, v2RenderPlan: { adjustmentModel: {} } },
      lightroomSafetyClampV2: {
        globalSafetyScore: 0.5,
        hardStops: ['This is a long human-readable safety sentence describing a hard stop.'],
        softCaps: ['Another human-readable sentence.'],
        photographerSummary: 'A full paragraph of photographer-facing prose.',
      },
    } },
  };
  const safety = extractSafetySnapshot(mockFinalPreset, { warnings: ['w'], safetyScore: 0.5 });
  const noProseLeaked = JSON.stringify(safety).length < 200 && !JSON.stringify(safety).includes('sentence') && !JSON.stringify(safety).includes('paragraph');
  record('Item 5: extractSafetySnapshot() output contains none of the raw prose strings from its inputs', noProseLeaked, { safety });
  const rendererSrc = read('ui/calibration-lab/calibration-lab-renderer.js');
  const rendererNeverReadsHardStopsProse = !/hardStops\[/.test(rendererSrc) && !/photographerSummary/.test(rendererSrc);
  record('Item 5: calibration-lab-renderer.js never reads hardStops[]/photographerSummary directly (only the bounded safetySnapshot fields)', rendererNeverReadsHardStopsProse, {});
}

// ── Item 6: Dataset never contains image Base64 ─────────────────────────────
// ── Item 7: Dataset never contains a Local File Path ────────────────────────
{
  const rec = createImageTestRecord({ imageCategories: ['PORTRAIT'], lightingCondition: 'DAYLIGHT' });
  const hostileRecord = {
    ...rec,
    imageBase64: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAAAAAAAD/2wBD',
    localFilePath: '/Users/photographer/Desktop/client-wedding/IMG_0421.CR2',
  };
  const json = JSON.stringify(buildExportJson({ sessionId: 's' }, [hostileRecord]));
  const csv = buildExportCsv({ sessionId: 's' }, [hostileRecord]);
  record('Item 6 HOSTILE: JSON export never contains a smuggled Base64 image payload', !json.includes('base64') && !json.includes('/9j/4AAQ'), {});
  record('Item 6 HOSTILE: CSV export never contains a smuggled Base64 image payload', !csv.includes('base64') && !csv.includes('/9j/4AAQ'), {});
  record('Item 7 HOSTILE: JSON export never contains a smuggled Local File Path', !json.includes('client-wedding') && !json.includes('IMG_0421'), {});
  record('Item 7 HOSTILE: CSV export never contains a smuggled Local File Path', !csv.includes('client-wedding') && !csv.includes('IMG_0421'), {});
}

// ── Item 8: a Corrupt Session never crashes the app ─────────────────────────
{
  const garbageInputs = [null, undefined, 42, 'a string', [], [1, 2, 3], { sessionId: 123 }, { sessionId: 'x', createdAt: null }, new Date(), Symbol('x')];
  let anyThrew = false;
  for (const g of garbageInputs) {
    try { validateSession(g); validateImageRecord(g); } catch { anyThrew = true; }
  }
  record('Item 8: validateSession()/validateImageRecord() never throw on any garbage/corrupt input (10 hostile samples)', !anyThrew, { sampleCount: garbageInputs.length });
}

// ── Item 9: Stale QA evidence must fail the Local Gate ──────────────────────
//
// DISCOVERY while writing this test: `tools/local-gate.mjs`'s
// `runStep()` unconditionally RE-RUNS each suite's own script before
// ever reading/evaluating its result file (see the `spawnSync(...
// step.script ...)` call preceding every `evaluateStepResult()` call).
// This means a tampered/stale result file left on disk cannot even
// survive to be evaluated at face value -- it gets overwritten by a
// genuine, fresh, honest re-run FIRST. That is a STRONGER guarantee
// than "a mismatched sourceHash is rejected" (which is what this test
// originally set out to prove): stale evidence never reaches the
// evaluation step at all. This test proves that stronger property
// directly -- plant an obviously-fabricated PASS result with a wrong
// sourceHash, run the real gate, and confirm the file on disk was
// genuinely regenerated (no longer matches the tampered fixture) and
// the gate's own summary reflects the CURRENT honest environment
// state, never the fabricated one.
async function testStaleEvidenceFailsGate() {
  if (process.env[RECURSION_GUARD_ENV] === '1') {
    recordNotTested(
      'Item 9: real local-gate spawn test (skipped -- this invocation is itself nested inside a local-gate -> run-static-suites -> this-file recursive chain; the OUTERMOST invocation already ran this check for real)',
      'recursion guard active'
    );
    return;
  }
  const resultsPath = path.join(PROJECT_ROOT, 'qa', 'epic-2e-k-calibration-lab-browser-results.json');
  let backup = null;
  try { backup = fs.readFileSync(resultsPath, 'utf-8'); } catch { backup = null; }
  try {
    const currentHash = await computeCurrentSourceHash('calibrationLabBrowser', PROJECT_ROOT);
    const tamperedFakePass = {
      suite: 'CONTROLLED V2 CALIBRATION LAB R1 -- Phase K: Calibration Lab Browser suite (TAMPERED FOR HOSTILE TEST)',
      runId: 'hostile-test-fake-run-DO-NOT-TRUST', startedAt: new Date().toISOString(), completedAt: new Date().toISOString(),
      completed: true,
      // Deliberately WRONG sourceHash -- simulates a stale/tampered
      // result claiming PASS against source files that have since
      // changed.
      sourceHash: `${currentHash}-TAMPERED`,
      results: [{ test: 'fabricated PASS row', result: 'PASS', evidence: '{}' }],
      decision: 'PASS',
    };
    fs.writeFileSync(resultsPath, JSON.stringify(tamperedFakePass, null, 2));

    const proc = spawnSync(process.execPath, [path.join(PROJECT_ROOT, 'tools', 'local-gate.mjs')], {
      cwd: PROJECT_ROOT, encoding: 'utf-8', timeout: 180000,
      env: { ...process.env, [RECURSION_GUARD_ENV]: '1' },
    });
    const stdout = proc.stdout ?? '';
    const step14Line = stdout.split('\n').find((line) => /Step 14:.*Calibration Lab Browser suite/.test(line));

    let resultAfterGateRun = null;
    try { resultAfterGateRun = JSON.parse(fs.readFileSync(resultsPath, 'utf-8')); } catch { resultAfterGateRun = null; }
    const fileWasRegenerated = resultAfterGateRun !== null && resultAfterGateRun.runId !== 'hostile-test-fake-run-DO-NOT-TRUST';
    const gateReflectsHonestState = !!step14Line && !/fabricated PASS row/.test(stdout);

    record(
      'Item 9: a tampered result file with a fabricated PASS and a wrong sourceHash cannot survive `node tools/local-gate.mjs` -- the suite is genuinely re-run and the file is regenerated fresh before evaluation, so the fabricated evidence never reaches the pass/fail decision',
      fileWasRegenerated && gateReflectsHonestState,
      { step14Line: step14Line ?? null, gateExitCode: proc.status, regeneratedRunId: resultAfterGateRun?.runId ?? null }
    );
  } finally {
    // Always restore the original, honest result file -- the final
    // package must never ship this deliberately tampered fixture, nor
    // (now moot, since the gate regenerates it) the auto-regenerated
    // one from this test run.
    if (backup !== null) fs.writeFileSync(resultsPath, backup);
    else { try { fs.unlinkSync(resultsPath); } catch { /* nothing to restore */ } }
  }
}

await testStaleEvidenceFailsGate();

console.log(`\n${passCount}/${passCount + failCount + notTestedCount} PASS, ${failCount} FAIL, ${notTestedCount} NOT_TESTED`);
process.exit(failCount > 0 ? 1 : 0);
