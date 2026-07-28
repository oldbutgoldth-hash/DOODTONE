#!/usr/bin/env node
/** EPIC 2E-N1..N5 fail-closed release gate. */
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RESULT_PATH = path.join(ROOT, 'qa/epic-2e-n-release-gate-results.json');
const BROWSER_RESULT = path.join(ROOT, 'qa/epic-2e-n-core-color-match-browser-results.json');
const startedAt = new Date().toISOString();
const runId = randomUUID();

function run(label, rel) {
  const result = spawnSync(process.execPath, [path.join(ROOT, rel)], { cwd: ROOT, encoding: 'utf8', timeout: 180000 });
  const exitCode = result.status ?? 1;
  const status = exitCode === 0 ? 'PASS' : exitCode === 2 ? 'NOT_VERIFIED' : 'FAIL';
  console.log(`\n=== ${label}: ${status} (exit ${exitCode}) ===`);
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return { label, rel, exitCode, status, stdoutTail: (result.stdout || '').slice(-8000), stderrTail: (result.stderr || '').slice(-4000) };
}
async function hashFile(rel) {
  return createHash('sha256').update(await fs.readFile(path.join(ROOT, rel))).digest('hex');
}
async function verifyProduction() {
  const rel = 'qa/baselines/epic-2e-n-production-invariant.json';
  const manifest = JSON.parse(await fs.readFile(path.join(ROOT, rel), 'utf8'));
  const mismatches = [];
  for (const [file, expected] of Object.entries(manifest.files)) {
    let actual = null;
    try { actual = await hashFile(file); } catch {}
    if (actual !== expected) mismatches.push({ file, expected, actual });
  }
  return { status: mismatches.length ? 'FAIL' : 'PASS', manifest: rel, mismatches, productionLocks: manifest.productionLocks };
}
async function verifyBrowserEvidence() {
  let result = null;
  try { result = JSON.parse(await fs.readFile(BROWSER_RESULT, 'utf8')); } catch {}
  const checks = result?.result?.checks ?? {};
  const requiredChecks = [
    'candidateMapped', 'xmpSerialized', 'previewChanged', 'afterAnalysed',
    'evaluationComplete', 'recordSaved', 'noProduction', 'xmpSingleSource',
    'styleDistanceReduced', 'whiteBalanceImproved', 'fidelityThreshold',
    'previewNoClipping', 'noPrivateData',
  ];
  const missingChecks = requiredChecks.filter(key => checks[key] !== true);
  const pass = result?.completed === true && result?.decision === 'PASS' &&
    typeof result?.runId === 'string' && result.runId.length > 0 &&
    typeof result?.sourceHash === 'string' && result.sourceHash.length === 64 &&
    typeof result?.browserExecutable === 'string' && result.browserExecutable.length > 0 &&
    missingChecks.length === 0;
  return {
    status: pass ? 'PASS' : result?.decision === 'NOT_VERIFIED' ? 'NOT_VERIFIED' : 'FAIL',
    missingChecks,
    browserExecutable: result?.browserExecutable ?? null,
    browserVersion: result?.browserVersion ?? null,
    fidelityScore: result?.result?.evaluation?.fidelity ?? null,
    styleBefore: result?.result?.evaluation?.styleBefore ?? null,
    styleAfter: result?.result?.evaluation?.styleAfter ?? null,
    preview: result?.result?.preview ?? null,
  };
}
async function verifyPackageCleanliness() {
  const forbidden = ['node_modules', '.git', '__pycache__'];
  const found = [];
  for (const name of forbidden) {
    try { const stat = await fs.stat(path.join(ROOT, name)); if (stat) found.push(name); } catch {}
  }
  const rootFiles = await fs.readdir(ROOT);
  const zipFiles = rootFiles.filter(name => /\.zip$/i.test(name));
  return { status: found.length || zipFiles.length ? 'FAIL' : 'PASS', forbiddenDirectories: found, zipFiles };
}
async function sourceHash() {
  const files = [
    'core/color-match/signature-schema.js',
    'core/color-match/reference-target-signature-engine.js',
    'core/color-match/signature-delta-engine.js',
    'core/color-match/core-color-match-analysis.js',
    'core/color-match/photographic-compensation-engine.js',
    'core/color-match/lightroom-candidate-mapper.js',
    'core/color-match/candidate-preview-renderer.js',
    'core/color-match/match-evaluation-engine.js',
    'core/color-match/evaluation-store.js',
    'core/color-match/core-color-match-pipeline.js',
    'ui/reference-color-match-panel.js',
    'index.html',
    'core/project-version.js',
    'package.json',
  ];
  const h = createHash('sha256');
  for (const rel of files) h.update(rel).update(await fs.readFile(path.join(ROOT, rel)));
  return h.digest('hex');
}

const steps = [
  run('ESM Syntax', 'tools/esm-syntax-gate.mjs'),
  run('Full Static Suites', 'qa/run-static-suites.mjs'),
  run('Core Color Match N1-N5 Browser Runtime', 'qa/epic-2e-n-core-color-match-browser-test.mjs'),
];
const browserEvidence = await verifyBrowserEvidence();
steps.push({ label: 'Fresh Browser Evidence', rel: 'qa/epic-2e-n-core-color-match-browser-results.json', exitCode: browserEvidence.status === 'PASS' ? 0 : browserEvidence.status === 'NOT_VERIFIED' ? 2 : 1, status: browserEvidence.status, stdoutTail: JSON.stringify(browserEvidence), stderrTail: '' });
const productionInvariant = await verifyProduction();
steps.push({ label: 'Legacy Production/XMP Invariant', rel: productionInvariant.manifest, exitCode: productionInvariant.status === 'PASS' ? 0 : 1, status: productionInvariant.status, stdoutTail: JSON.stringify(productionInvariant), stderrTail: '' });
const packageCleanliness = await verifyPackageCleanliness();
steps.push({ label: 'Package Cleanliness', rel: '.', exitCode: packageCleanliness.status === 'PASS' ? 0 : 1, status: packageCleanliness.status, stdoutTail: JSON.stringify(packageCleanliness), stderrTail: '' });

let decision = 'FINAL_PASS';
if (steps.some(step => step.status === 'FAIL')) decision = 'FAIL';
else if (steps.some(step => step.status === 'NOT_VERIFIED')) decision = 'NOT_VERIFIED';
const result = {
  epic: '2E-N1-N5', suite: 'CORE_REFERENCE_TARGET_COLOR_MATCH_RELEASE_GATE', decision, completed: true,
  runId, startedAt, completedAt: new Date().toISOString(), sourceHash: await sourceHash(),
  steps, browserEvidence, productionInvariant, packageCleanliness,
  releaseBoundary: {
    coreN1N5CandidateImplementationComplete: decision === 'FINAL_PASS',
    referenceColorMatchBetaStarted: false,
    productionSource: 'legacy',
    productionWrite: false,
    candidateXmpInMemoryOnly: true,
    productionActivationAllowed: false,
    requiresRealPhotoAndLightroomValidationBeforeProduction: true
  }
};
await fs.writeFile(RESULT_PATH, JSON.stringify(result, null, 2) + '\n');
console.log(`\nEPIC 2E-N1-N5 RELEASE DECISION: ${decision}`);
console.log('Evidence: qa/epic-2e-n-release-gate-results.json');
process.exit(decision === 'FINAL_PASS' ? 0 : decision === 'NOT_VERIFIED' ? 2 : 1);
