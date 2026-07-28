#!/usr/bin/env node
/** EPIC 2E-N1 fail-closed release gate. */
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RESULT_PATH = path.join(ROOT, 'qa/epic-2e-n1-release-gate-results.json');
const startedAt = new Date().toISOString();
const runId = randomUUID();

function run(label, rel) {
  const result = spawnSync(process.execPath, [path.join(ROOT, rel)], { cwd: ROOT, encoding: 'utf8' });
  const exitCode = result.status ?? 1;
  const status = exitCode === 0 ? 'PASS' : exitCode === 2 ? 'NOT_VERIFIED' : 'FAIL';
  console.log(`\n=== ${label}: ${status} (exit ${exitCode}) ===`);
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return { label, rel, exitCode, status, stdoutTail: (result.stdout || '').slice(-5000), stderrTail: (result.stderr || '').slice(-2500) };
}
async function hashFile(rel) { return createHash('sha256').update(await fs.readFile(path.join(ROOT, rel))).digest('hex'); }
async function verifyProduction() {
  const manifest = JSON.parse(await fs.readFile(path.join(ROOT, 'qa/baselines/epic-2e-n1-production-invariant.json'), 'utf8'));
  const mismatches = [];
  for (const [rel, expected] of Object.entries(manifest.files)) {
    const actual = await hashFile(rel);
    if (actual !== expected) mismatches.push({ rel, expected, actual });
  }
  return { status: mismatches.length ? 'FAIL' : 'PASS', mismatches, productionLocks: manifest.productionLocks };
}
async function sourceHash() {
  const h = createHash('sha256');
  for (const rel of [
    'core/color-match/signature-schema.js',
    'core/color-match/reference-target-signature-engine.js',
    'core/color-match/signature-delta-engine.js',
    'core/color-match/core-color-match-analysis.js',
    'ui/reference-color-match-panel.js',
    'qa/epic-2e-n1-core-color-match-signature-static-test.mjs',
    'qa/epic-2e-n1-core-color-match-integration-static-test.mjs',
    'qa/epic-2e-n1-core-color-match-browser-test.mjs',
  ]) h.update(rel).update(await fs.readFile(path.join(ROOT, rel)));
  return h.digest('hex');
}

const steps = [
  run('ESM Syntax', 'tools/esm-syntax-gate.mjs'),
  run('Full Static Suites', 'qa/run-static-suites.mjs'),
  run('Core Color Match Browser Runtime', 'qa/epic-2e-n1-core-color-match-browser-test.mjs'),
];
const productionInvariant = await verifyProduction();
steps.push({ label: 'Production/XMP Source Invariant', rel: 'qa/baselines/epic-2e-n1-production-invariant.json', exitCode: productionInvariant.status === 'PASS' ? 0 : 1, status: productionInvariant.status, stdoutTail: JSON.stringify(productionInvariant), stderrTail: '' });
let decision = 'FINAL_PASS';
if (steps.some(step => step.status === 'FAIL')) decision = 'FAIL';
else if (steps.some(step => step.status === 'NOT_VERIFIED')) decision = 'NOT_VERIFIED';
const result = {
  epic: '2E-N1', suite: 'CORE_COLOR_MATCH_SIGNATURE_RELEASE_GATE', decision, completed: true,
  runId, startedAt, completedAt: new Date().toISOString(), sourceHash: await sourceHash(), steps, productionInvariant,
  boundary: 'Reference/Target signature and semantic delta only. N1 cannot write Lightroom Mapping, Production, preset, or XMP.',
};
await fs.writeFile(RESULT_PATH, JSON.stringify(result, null, 2) + '\n');
console.log(`\nEPIC 2E-N1 RELEASE DECISION: ${decision}`);
console.log('Evidence: qa/epic-2e-n1-release-gate-results.json');
process.exit(decision === 'FINAL_PASS' ? 0 : decision === 'NOT_VERIFIED' ? 2 : 1);
