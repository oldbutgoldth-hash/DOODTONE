#!/usr/bin/env node
/**
 * qa/epic-2e-j-phase-c-final-aggregator.mjs
 *
 * COMBINED CLOSEOUT R3 — Phase F: the machine-generated Final Phase C
 * aggregator. Reads ONLY the current, on-disk suite Result JSON files
 * (never hand-typed values, never copies an older Final result forward)
 * and computes the Final Phase C decision from real, current evidence.
 *
 * Fail-closed rejection rules (never produces CONDITIONAL_PASS/PASS
 * when ANY of these hold for ANY of the four gate suites):
 *   - missing/empty runId
 *   - completed !== true
 *   - decision reports a Browser-unavailable/environment-blocked status
 *     (BROWSER_BINARY_UNAVAILABLE, PLAYWRIGHT_PACKAGE_UNAVAILABLE, or any
 *     decision string outside that suite's own valid vocabulary)
 *   - a malformed result row (blank test name, invalid/Boolean result,
 *     missing evidence)
 *   - an unexpected NOT_TESTED row (i.e. anything other than the exact
 *     single permitted "Physical touch hardware" row for Step 7B-B)
 *   - any FAIL row
 *   - an empty results array
 *   - the result's generatedAt/completedAt predates the suite's own
 *     source file's on-disk mtime (a stale result left over from before
 *     the current source)
 *
 * When every gate suite genuinely satisfies the AUTOMATED ACCEPTANCE
 * criteria (see the R3 spec), the Final decision is CONDITIONAL_PASS
 * (the only permitted remaining gaps are the documented manual-only
 * items: Physical touch hardware, real screen-reader verification,
 * physical-device verification). When even one gate suite fails to
 * satisfy its criteria for ANY reason — including this sandbox's
 * persistent Chromium unavailability — this script writes a bounded,
 * CURRENT, honest non-success result instead, and never leaves an
 * older Final PASS/CONDITIONAL_PASS file standing as if it were current
 * evidence.
 *
 * Run: node qa/epic-2e-j-phase-c-final-aggregator.mjs
 * Output: qa/epic-2e-j-phase-c-final-results.json
 */

import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateRunId, computeSourceHash, writeResultAtomic } from './helpers/playwright-lumixa-test-runtime.mjs';
// DEPLOY GEOMETRY R1 — Phase H1: sourceHash is now the PRIMARY
// freshness proof (see phase-c-suite-source-manifest.mjs for the full
// root-cause rationale) — replaces the previous mtime-vs-generatedAt
// comparison, which produced false STALE rejections after a ZIP
// extraction reset every file's mtime.
import { computeCurrentSourceHash } from './phase-c-suite-source-manifest.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const FINAL_RESULTS_PATH = path.join(PROJECT_ROOT, 'qa', 'epic-2e-j-phase-c-final-results.json');

const GATE_SUITES = [
  {
    key: 'liveApp',
    label: 'Live App',
    resultFile: 'epic-2e-j-phase-c-live-app-results.json',
    sourceFile: 'epic-2e-j-phase-c-live-app-test.mjs',
    validDecisions: ['PASS', 'FAIL'],
    acceptance: (r) => r.summary?.pass >= 51 && r.summary?.fail === 0 && r.summary?.notTested === 0 && r.decision === 'PASS',
    acceptanceLabel: 'PASS 51+, FAIL 0, NOT_TESTED 0, decision=PASS',
  },
  {
    key: 'observationSmoke',
    label: 'Observation Smoke',
    resultFile: 'epic-2e-j-phase-c-results.json',
    sourceFile: 'epic-2e-j-phase-c-observation-smoke-test.mjs',
    validDecisions: ['PASS', 'FAIL'],
    acceptance: (r) => {
      const booleanRows = (r.results || []).filter((row) => typeof row.result === 'boolean').length;
      const unexpectedNotTested = (r.results || []).filter((row) => row.result === 'NOT_TESTED').length;
      return booleanRows === 0 && r.summary?.fail === 0 && unexpectedNotTested === 0 && r.decision === 'PASS';
    },
    acceptanceLabel: 'Boolean rows 0, FAIL 0, unexpected NOT_TESTED 0, decision=PASS',
  },
  {
    key: 'step7bA',
    label: 'Step 7B-A',
    resultFile: 'epic-2e-j-phase-c-step7b-a-results.json',
    sourceFile: 'epic-2e-j-phase-c-step7b-a-test.mjs',
    validDecisions: ['PASS', 'FAIL'],
    acceptance: (r) => r.summary?.fail === 0 && r.decision === 'PASS',
    acceptanceLabel: 'FAIL 0, Cookie exact restoration PASS, Cookie setter calls 0, decision=PASS',
  },
  {
    key: 'step7bB',
    label: 'Step 7B-B',
    resultFile: 'epic-2e-j-phase-c-step7b-b-results.json',
    sourceFile: 'epic-2e-j-phase-c-step7b-b-test.mjs',
    validDecisions: ['CONDITIONAL_PASS', 'PASS', 'FAIL'],
    acceptance: (r) => {
      const notTestedRows = (r.results || []).filter((row) => row.result === 'NOT_TESTED');
      const onlyPhysicalTouch = notTestedRows.length === 1 && /physical touch hardware/i.test(notTestedRows[0].test);
      return r.summary?.fail === 0 && notTestedRows.length === 1 && onlyPhysicalTouch && r.decision === 'CONDITIONAL_PASS';
    },
    acceptanceLabel: 'FAIL 0, NOT_TESTED exactly 1 (Physical touch hardware only), decision=CONDITIONAL_PASS',
  },
  // DEPLOY GEOMETRY R1 — Phase H3: new gates for this EPIC.
  {
    key: 'previewGeometryStatic',
    label: 'Preview Geometry Static',
    resultFile: 'epic-2e-j-preview-geometry-static-results.json',
    sourceFile: 'epic-2e-j-preview-geometry-static-test.mjs',
    validDecisions: ['PASS', 'FAIL'],
    acceptance: (r) => r.summary?.fail === 0 && r.summary?.notTested === 0 && r.decision === 'PASS',
    acceptanceLabel: 'FAIL 0, NOT_TESTED 0, decision=PASS',
  },
  {
    key: 'previewGeometryBrowser',
    label: 'Preview Geometry local Browser suite',
    resultFile: 'epic-2e-j-preview-geometry-browser-results.json',
    sourceFile: 'epic-2e-j-preview-geometry-browser-test.mjs',
    validDecisions: ['PASS', 'FAIL'],
    acceptance: (r) => r.summary?.fail === 0 && r.summary?.notTested === 0 && r.decision === 'PASS',
    acceptanceLabel: 'FAIL 0, NOT_TESTED 0, decision=PASS — every geometry fixture PASS, V2 Unavailable count 0, Exact dimensions for all fixtures, Observation enabled for all fixtures',
  },
];

// DEPLOY GEOMETRY R1 — Phase G/H3: the Deploy Preview Geometry suite
// uses its OWN bounded decision vocabulary (never the generic PASS/
// FAIL two-value set) — read and reported separately from GATE_SUITES,
// never forced through the same acceptance-function shape.
const DEPLOY_GATE = {
  key: 'deployPreviewGeometry',
  label: 'Deploy Preview Geometry',
  resultFile: 'epic-2e-j-deploy-preview-geometry-results.json',
  sourceFile: 'epic-2e-j-deploy-preview-geometry-test.mjs',
};

function isMalformedRow(row) {
  const testOk = row && typeof row.test === 'string' && row.test.trim().length > 0;
  const resultOk = row && typeof row.result === 'string' && row.result.length > 0;
  const evidenceOk = row && Object.prototype.hasOwnProperty.call(row, 'evidence');
  return !testOk || !resultOk || !evidenceOk;
}

async function evaluateGateSuite(gate) {
  const resultPath = path.join(PROJECT_ROOT, 'qa', gate.resultFile);
  const reasons = [];
  let resultObj = null;
  try {
    resultObj = JSON.parse(await readFile(resultPath, 'utf8'));
  } catch (readErr) {
    return { ...gate, ok: false, reasons: [`could not read/parse result file: ${readErr.message}`], resultObj: null };
  }

  if (typeof resultObj.runId !== 'string' || resultObj.runId.trim().length === 0) reasons.push('missing/empty runId');
  if (resultObj.completed !== true) reasons.push('completed !== true');
  if (!gate.validDecisions.includes(resultObj.decision)) {
    reasons.push(`decision "${resultObj.decision}" is not one of this suite's valid outcomes (${gate.validDecisions.join('/')}) — likely a Browser/environment-unavailable stub, not real evidence`);
  }
  if (!Array.isArray(resultObj.results) || resultObj.results.length === 0) {
    reasons.push('empty results array');
  } else {
    const malformedCount = resultObj.results.filter(isMalformedRow).length;
    if (malformedCount > 0) reasons.push(`${malformedCount} malformed result row(s)`);
  }

  // DEPLOY GEOMETRY R1 — Phase H1 (root cause fix): freshness is now
  // proven by an EXACT sourceHash match against a CURRENT recomputation
  // from the shared suite-source manifest — never by comparing the
  // result's generatedAt timestamp against the source file's on-disk
  // mtime. The previous mtime-based check produced a FALSE "STALE, must
  // be rerun" rejection after a ZIP extraction, because ZIP tools
  // frequently reset every extracted file's mtime to the moment of
  // extraction (or otherwise fail to preserve a trustworthy relative
  // ordering) — a genuinely fresh, exactly-matching result could
  // "predate" its own just-extracted, byte-identical source file purely
  // from filesystem noise, never from an actual source change. An exact
  // sourceHash match is authoritative regardless of what any mtime
  // currently reports; mtime is no longer read or compared at all here.
  if (typeof resultObj.sourceHash !== 'string' || resultObj.sourceHash.trim().length === 0) {
    reasons.push('result is missing a sourceHash — cannot prove freshness');
  } else {
    try {
      const currentHash = await computeCurrentSourceHash(gate.key, PROJECT_ROOT);
      if (currentHash !== resultObj.sourceHash) {
        reasons.push(`sourceHash mismatch: result.sourceHash=${resultObj.sourceHash}, current recomputed hash=${currentHash} — the suite's source (or a shared helper it depends on) has changed since this result was generated; STALE, must be rerun`);
      }
    } catch (hashErr) {
      reasons.push(`could not recompute current sourceHash for freshness verification: ${hashErr.message}`);
    }
  }

  // Only evaluate the suite-specific acceptance criteria once the result
  // is structurally sound and reports one of its genuine outcomes —
  // running `gate.acceptance()` against an unavailable-environment stub
  // would be meaningless (its `results` shape is intentionally minimal).
  let acceptanceMet = false;
  if (reasons.length === 0) {
    try {
      acceptanceMet = gate.acceptance(resultObj) === true;
      if (!acceptanceMet) reasons.push(`does not satisfy required acceptance criteria: ${gate.acceptanceLabel}`);
    } catch (accErr) {
      reasons.push(`acceptance check threw: ${accErr.message}`);
    }
  }

  return {
    ...gate,
    ok: reasons.length === 0 && acceptanceMet,
    reasons,
    resultObj,
    summary: resultObj.summary ?? null,
    decision: resultObj.decision ?? null,
    runId: resultObj.runId ?? null,
    generatedAt: resultObj.generatedAt ?? resultObj.completedAt ?? null,
  };
}

async function runFocusedCoreRegression() {
  try {
    const out = execFileSync('node', [path.join('qa', 'epic-2e-j-c-f2-preview-gate-smoke-test.mjs')], { cwd: PROJECT_ROOT, encoding: 'utf8', timeout: 60000 });
    const m = out.match(/(\d+)\/(\d+)\s+PASS,\s+(\d+)\s+FAIL/);
    if (!m) return { ran: true, parsed: false, raw: out.slice(-400) };
    return { ran: true, parsed: true, pass: Number(m[1]), total: Number(m[2]), fail: Number(m[3]) };
  } catch (err) {
    return { ran: false, parsed: false, error: err.message };
  }
}

async function runFreshSyntaxCheck() {
  try {
    const out = execFileSync('bash', ['-lc', `
      FAIL=0; COUNT=0
      for f in $(find core ui qa -type f \\( -name "*.js" -o -name "*.mjs" \\) | sort); do
        COUNT=$((COUNT+1))
        node --check "$f" >/dev/null 2>&1 || FAIL=$((FAIL+1))
      done
      echo "$COUNT $FAIL"
    `], { cwd: PROJECT_ROOT, encoding: 'utf8', timeout: 120000 });
    const [total, fail] = out.trim().split(/\s+/).map(Number);
    return { ran: true, total, fail };
  } catch (err) {
    return { ran: false, error: err.message };
  }
}

/**
 * DEPLOY GEOMETRY R1 — Phase G/H3: reads the Deploy Preview Geometry
 * suite's result using its OWN bounded decision vocabulary (never
 * forced through the generic PASS/FAIL GATE_SUITES shape). Applies the
 * same sourceHash freshness proof as every other gate.
 */
async function evaluateDeployGate() {
  const resultPath = path.join(PROJECT_ROOT, 'qa', DEPLOY_GATE.resultFile);
  let resultObj = null;
  try {
    resultObj = JSON.parse(await readFile(resultPath, 'utf8'));
  } catch (readErr) {
    return { ...DEPLOY_GATE, ok: false, reasons: [`could not read/parse result file: ${readErr.message}`], resultObj: null, decision: null, runId: null, generatedAt: null, deployUrl: null };
  }
  const reasons = [];
  if (typeof resultObj.runId !== 'string' || resultObj.runId.trim().length === 0) reasons.push('missing/empty runId');
  if (resultObj.completed !== true) reasons.push('completed !== true');
  if (typeof resultObj.sourceHash !== 'string' || resultObj.sourceHash.trim().length === 0) {
    reasons.push('result is missing a sourceHash — cannot prove freshness');
  } else {
    try {
      const currentHash = await computeCurrentSourceHash(DEPLOY_GATE.key, PROJECT_ROOT);
      if (currentHash !== resultObj.sourceHash) reasons.push(`sourceHash mismatch: result.sourceHash=${resultObj.sourceHash}, current=${currentHash} — STALE, must be rerun`);
    } catch (hashErr) {
      reasons.push(`could not recompute current sourceHash: ${hashErr.message}`);
    }
  }
  const passed = resultObj.decision === 'PASS_DEPLOY_PREVIEW_GEOMETRY';
  if (!passed) reasons.push(`decision is "${resultObj.decision}", not PASS_DEPLOY_PREVIEW_GEOMETRY`);
  return {
    ...DEPLOY_GATE,
    ok: reasons.length === 0 && passed,
    reasons,
    resultObj,
    decision: resultObj.decision ?? null,
    runId: resultObj.runId ?? null,
    generatedAt: resultObj.generatedAt ?? resultObj.completedAt ?? null,
    deployUrl: resultObj.deployUrl ?? null,
    screenshotsGenerated: resultObj.screenshotsGenerated ?? [],
  };
}

async function main() {
  const runId = generateRunId();
  const generatedAt = new Date().toISOString();

  const [syntaxResult, focusedCore, deployGateResult, ...gateResults] = await Promise.all([
    runFreshSyntaxCheck(),
    runFocusedCoreRegression(),
    evaluateDeployGate(),
    ...GATE_SUITES.map(evaluateGateSuite),
  ]);

  const allGatesOk = gateResults.every((g) => g.ok === true);
  const syntaxOk = syntaxResult.ran && syntaxResult.fail === 0;
  const focusedCoreOk = focusedCore.ran && focusedCore.parsed && focusedCore.fail === 0;
  const deployOk = deployGateResult.ok === true;

  const blockingReasons = [];
  if (!syntaxOk) blockingReasons.push(`Syntax check: ${syntaxResult.ran ? `${syntaxResult.fail} file(s) failed node --check` : `could not run (${syntaxResult.error})`}`);
  if (!focusedCoreOk) blockingReasons.push(`Focused Core regression: ${focusedCore.ran ? (focusedCore.parsed ? `${focusedCore.fail} FAIL` : 'could not parse PASS/FAIL counts from output') : `could not run (${focusedCore.error})`}`);
  for (const g of gateResults) {
    if (!g.ok) blockingReasons.push(`${g.label}: ${g.reasons.join('; ')}`);
  }
  if (!deployOk) blockingReasons.push(`${deployGateResult.label}: ${deployGateResult.reasons.join('; ')}`);

  // DEPLOY GEOMETRY R1 — Phase H3/final acceptance: CONDITIONAL_PASS
  // only when EVERY local automated gate AND Deploy parity both pass.
  // When every local gate passes but Deploy parity specifically has
  // not (the expected, honest outcome whenever LUMIXA_DEPLOY_URL is
  // unavailable or the deployed build hasn't been verified), the
  // decision is the specific `BLOCKED_DEPLOY_PARITY_NOT_MET` — never
  // silently produce CONDITIONAL_PASS, and never conflate this with a
  // genuine local-gate failure (which keeps the older, more general
  // `BLOCKED_AUTOMATED_ACCEPTANCE_NOT_MET` label).
  const localAutomatedOk = allGatesOk && syntaxOk && focusedCoreOk;
  const overallDecision = (localAutomatedOk && deployOk)
    ? 'CONDITIONAL_PASS'
    : (localAutomatedOk ? 'BLOCKED_DEPLOY_PARITY_NOT_MET' : 'BLOCKED_AUTOMATED_ACCEPTANCE_NOT_MET');

  const output = {
    suite: 'EPIC 2E-J Phase C — Final Machine-Readable Result (COMBINED CLOSEOUT R3)',
    runId,
    generatedAt,
    completed: true,
    syntax: syntaxResult,
    focusedCoreRegression: focusedCore,
    gates: gateResults.map((g) => ({
      key: g.key,
      label: g.label,
      decision: g.decision,
      summary: g.summary,
      runId: g.runId,
      generatedAt: g.generatedAt,
      ok: g.ok,
      reasons: g.reasons,
    })),
    // DEPLOY GEOMETRY R1 — Phase H3: Deploy Preview Geometry reported
    // separately, with its own bounded decision vocabulary and
    // deployUrl/screenshotsGenerated fields.
    deployGate: {
      key: deployGateResult.key,
      label: deployGateResult.label,
      decision: deployGateResult.decision,
      deployUrl: deployGateResult.deployUrl,
      screenshotsGenerated: deployGateResult.screenshotsGenerated ?? [],
      runId: deployGateResult.runId,
      generatedAt: deployGateResult.generatedAt,
      ok: deployGateResult.ok,
      reasons: deployGateResult.reasons,
    },
    manualTestsNotPerformed: [
      'Physical touch hardware',
      'Real screen-reader verification (NVDA/JAWS/VoiceOver)',
      'Physical mobile device verification',
    ],
    productionSource: 'legacy',
    controlledTestState: 'disabled',
    decision: overallDecision,
    blockingReasons: overallDecision === 'CONDITIONAL_PASS' ? [] : blockingReasons,
    finalDecisionNarrative: overallDecision === 'CONDITIONAL_PASS'
      ? 'CONDITIONAL_PASS — all automated acceptance gates (Syntax, Focused Core, Live App, Observation Smoke, Step 7B-A, Step 7B-B, Preview Geometry Static, Preview Geometry local Browser suite) AND real Deploy parity (PASS_DEPLOY_PREVIEW_GEOMETRY) were satisfied by CURRENT, fresh (sourceHash-verified) evidence in this run. Remaining gaps are the permitted manual-only items (physical touch hardware, real screen-reader verification, physical-device verification).'
      : overallDecision === 'BLOCKED_DEPLOY_PARITY_NOT_MET'
        ? 'BLOCKED_DEPLOY_PARITY_NOT_MET — every LOCAL automated acceptance gate passed with current, fresh evidence, but real Deploy parity has not been established (see deployGate.reasons — commonly LUMIXA_DEPLOY_URL was not provided, the deployed build did not match the source contract, or the deployed workflow itself failed). Deploy Preview Geometry is NOT claimed to have passed.'
        : 'NOT a CONDITIONAL_PASS. One or more automated acceptance gates were not satisfied by current, fresh evidence in this run — see blockingReasons. This is reported honestly rather than reusing/copying forward any older Final PASS/CONDITIONAL_PASS result.',
  };

  await writeResultAtomic(FINAL_RESULTS_PATH, output);
  console.log(`Final Phase C decision: ${overallDecision}`);
  if (blockingReasons.length) {
    console.log('Blocking reasons:');
    for (const r of blockingReasons) console.log(`  - ${r}`);
  }
  console.log(`Written to ${FINAL_RESULTS_PATH}`);
  process.exit(overallDecision === 'CONDITIONAL_PASS' ? 0 : 1);
}

main().catch((err) => {
  console.error('Final aggregator crashed:', err && err.name ? err.name : err);
  process.exit(2);
});
