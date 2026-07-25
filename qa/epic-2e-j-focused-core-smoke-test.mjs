#!/usr/bin/env node
/**
 * qa/epic-2e-j-focused-core-smoke-test.mjs
 *
 * LOCAL-FIRST GEOMETRY R3 -- Phase E2, local-gate step 2 ("Focused
 * Core"). A fast, dependency-free, no-Browser regression check: dynamic-
 * imports every core/<engine>/index.js analysis-engine entry point
 * directly in plain Node (never through a Browser page) and confirms
 * each module evaluates without throwing and exports at least one
 * named binding. This is deliberately narrow -- it proves each engine's
 * module graph loads cleanly (syntax, top-level references, internal
 * imports all resolve), not that its analysis output is correct (the
 * Browser suites cover real behavior). It exists so a plain
 * `node qa/epic-2e-j-focused-core-smoke-test.mjs` gives fast everyday
 * feedback on core/ without needing Chromium at all.
 *
 * Run: node qa/epic-2e-j-focused-core-smoke-test.mjs
 * Output: qa/epic-2e-j-focused-core-smoke-results.json
 */

import { readdir, stat, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateRunId, computeSourceHash, writeResultAtomic, buildRuntimeCrashRow } from './helpers/playwright-lumixa-test-runtime.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const CORE_DIR = path.join(PROJECT_ROOT, 'core');
const RESULTS_PATH = path.join(__dirname, 'epic-2e-j-focused-core-smoke-results.json');
const SUITE_NAME = 'LOCAL-FIRST GEOMETRY R3 -- Focused Core smoke test (no-Browser, plain Node import)';

const ALLOWED_STATUSES = new Set(['PASS', 'FAIL', 'NOT_TESTED', 'NOT_APPLICABLE']);
const results = [];
function recordCondition(test, condition, evidence) {
  const status = condition === true ? 'PASS' : 'FAIL';
  results.push({ test, result: status, evidence: String(evidence) });
  console.log(`${status === 'PASS' ? '✓' : '✗'} [${status}] ${test} — ${evidence}`);
}

export function computeFocusedCoreDecision(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return 'FAIL';
  const wellFormed = rows.every((r) => r && typeof r.test === 'string' && typeof r.result === 'string' && ALLOWED_STATUSES.has(r.result));
  if (!wellFormed) return 'FAIL';
  return rows.every((r) => r.result === 'PASS') ? 'PASS' : 'FAIL';
}

async function main() {
  const runId = generateRunId();
  const startedAt = new Date().toISOString();

  const entries = await readdir(CORE_DIR, { withFileTypes: true });
  const engineDirs = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const indexPath = path.join(CORE_DIR, entry.name, 'index.js');
    try {
      const st = await stat(indexPath);
      if (st.isFile()) engineDirs.push(entry.name);
    } catch { /* no index.js in this dir — not an engine entry point, skip */ }
  }
  engineDirs.sort();

  if (engineDirs.length === 0) {
    recordCondition('At least one core engine index.js discovered', false, 'zero core/*/index.js files found — discovery itself is broken');
  } else {
    recordCondition(`Discovered ${engineDirs.length} core engine entry points`, engineDirs.length >= 25, `engines=${JSON.stringify(engineDirs)}`);
  }

  for (const dir of engineDirs) {
    const modUrl = `file://${path.join(CORE_DIR, dir, 'index.js')}`;
    try {
      const mod = await import(modUrl);
      const exportNames = Object.keys(mod);
      recordCondition(`core/${dir}/index.js imports cleanly with real exports`, exportNames.length > 0, `exports=${JSON.stringify(exportNames)}`);
    } catch (e) {
      recordCondition(`core/${dir}/index.js imports cleanly with real exports`, false, `${e.constructor.name}: ${e.message}`);
    }
  }

  const sourceHash = await computeSourceHash([path.join(__dirname, 'epic-2e-j-focused-core-smoke-test.mjs'), CORE_DIR].filter((p) => p !== CORE_DIR));
  const passCount = results.filter((r) => r.result === 'PASS').length;
  const failCount = results.filter((r) => r.result === 'FAIL').length;
  const decision = computeFocusedCoreDecision(results);
  const output = {
    suite: SUITE_NAME,
    runId, startedAt, completedAt: new Date().toISOString(), completed: true, sourceHash,
    generatedAt: new Date().toISOString(),
    summary: { total: results.length, pass: passCount, fail: failCount, notTested: results.length - passCount - failCount },
    results,
    decision,
  };
  await mkdir(__dirname, { recursive: true });
  await writeResultAtomic(RESULTS_PATH, output);
  console.log(`\n${passCount}/${results.length} PASS, ${failCount} FAIL`);
  console.log(`Decision: ${decision}`);
  process.exit(decision === 'PASS' ? 0 : 1);
}

const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main().catch(async (err) => {
    console.error('Focused Core smoke test crashed:', err?.name ?? err);
    try {
      await writeResultAtomic(RESULTS_PATH, {
        suite: SUITE_NAME, completed: false,
        summary: { total: 1, pass: 0, fail: 1, notTested: 0 },
        results: [buildRuntimeCrashRow(err)],
        decision: 'FAIL',
        generatedAt: new Date().toISOString(),
      });
    } catch { /* best-effort */ }
    process.exit(2);
  });
}
