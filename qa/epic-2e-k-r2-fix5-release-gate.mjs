#!/usr/bin/env node
/** EPIC 2E-K-R2-FIX5 — fail-closed storage/release gate. */
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const RESULT_PATH = path.join(__dirname, 'epic-2e-k-r2-fix5-release-gate-results.json');
const runId = randomUUID();
const startedAt = new Date().toISOString();

function run(label, rel, args = []) {
  const result = spawnSync(process.execPath, [path.join(ROOT, rel), ...args], {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
  });
  const status = result.status === 0 ? 'PASS' : result.status === 2 ? 'NOT_VERIFIED' : 'FAIL';
  console.log(`\n=== ${label}: ${status} (exit ${result.status}) ===`);
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return { label, rel, exitCode: result.status, status, stdoutTail: (result.stdout ?? '').slice(-4000), stderrTail: (result.stderr ?? '').slice(-4000) };
}

async function readJson(rel) {
  try { return JSON.parse(await fs.readFile(path.join(ROOT, rel), 'utf8')); } catch { return null; }
}

async function hashFiles(files) {
  const hash = createHash('sha256');
  for (const rel of files) hash.update(rel).update(await fs.readFile(path.join(ROOT, rel)));
  return hash.digest('hex');
}

async function main() {
  const steps = [];
  steps.push(run('ESM Syntax', 'tools/esm-syntax-gate.mjs'));
  steps.push(run('Full Static Suites', 'qa/run-static-suites.mjs'));
  steps.push(run('FIX5 Storage Contract', 'qa/epic-2e-k-r2-fix5-storage-contract-test.mjs'));
  steps.push(run('FIX4 Preview-before-review Safety', 'qa/epic-2e-k-r2-fix4-preview-before-review-static-test.mjs'));
  steps.push(run('Native Browser IndexedDB', 'qa/epic-2e-k-r2-fix5-native-indexeddb-browser-test.mjs'));

  const storageEvidence = await readJson('qa/epic-2e-k-r2-fix5-storage-contract-results.json');
  const nativeEvidence = await readJson('qa/epic-2e-k-r2-fix5-native-indexeddb-browser-results.json');
  const fix4BrowserEvidence = await readJson('qa/epic-2e-k-r2-fix4-preview-before-review-browser-results.json');

  const xmpInvariant = fix4BrowserEvidence?.results?.find?.(item => item.test === 'Candidate approval leaves XMP exact text and SHA-256 unchanged') ?? null;
  const productionLocks = {
    productionSource: 'legacy', productionWrite: false, controlledV2Apply: false,
    previewExport: false, controlledV2ProductionActivation: false,
  };

  const forbiddenDirectories = [];
  for (const rel of ['node_modules', '.git']) {
    try {
      const stat = await fs.stat(path.join(ROOT, rel));
      if (stat.isDirectory()) forbiddenDirectories.push(rel);
    } catch { /* absent is clean */ }
  }
  const zipFiles = (await fs.readdir(ROOT)).filter(name => /\.zip$/i.test(name));
  const packageClean = forbiddenDirectories.length === 0 && zipFiles.length === 0;

  const requiredPass = steps.slice(0, 4).every(step => step.status === 'PASS')
    && storageEvidence?.decision === 'PASS'
    && storageEvidence?.completed === true
    && storageEvidence?.passCount === 24
    && storageEvidence?.failCount === 0
    && packageClean;

  const nativeStatus = steps[4].status;
  let decision = 'FAIL';
  if (requiredPass && nativeStatus === 'PASS' && nativeEvidence?.decision === 'PASS') decision = 'FINAL_PASS';
  else if (requiredPass && nativeStatus === 'NOT_VERIFIED' && nativeEvidence?.decision === 'NOT_VERIFIED') decision = 'NOT_VERIFIED';

  const sourceHash = await hashFiles([
    'ui/calibration-lab/calibration-lab-storage.js',
    'ui/calibration-lab/calibration-lab-controller.js',
    'qa/helpers/deterministic-indexeddb.mjs',
    'qa/epic-2e-k-r2-fix5-storage-contract-test.mjs',
    'qa/epic-2e-k-r2-fix5-native-indexeddb-browser-test.mjs',
    'qa/epic-2e-k-r2-fix5-release-gate.mjs',
    'package.json', 'package-lock.json',
  ]);

  const result = {
    epic: '2E-K-R2-FIX5', suite: 'RELEASE_GATE', decision, completed: true,
    runId, startedAt, completedAt: new Date().toISOString(), sourceHash,
    steps, storageEvidenceSummary: storageEvidence ? {
      decision: storageEvidence.decision, verificationMode: storageEvidence.verificationMode,
      passCount: storageEvidence.passCount, failCount: storageEvidence.failCount,
      nativeBrowserIndexedDbVerified: storageEvidence.nativeBrowserIndexedDbVerified,
    } : null,
    nativeBrowserEvidenceSummary: nativeEvidence ? {
      decision: nativeEvidence.decision, reason: nativeEvidence.reason,
      browserExecutable: nativeEvidence.browserExecutable, browserVersion: nativeEvidence.browserVersion,
      sourceHash: nativeEvidence.sourceHash,
    } : null,
    fix4XmpInvariant: xmpInvariant?.evidence ?? null,
    productionLocks,
    packageCleanliness: { packageClean, zipFiles, forbiddenDirectories, forbiddenDirectoryCount: forbiddenDirectories.length },
    boundary: decision === 'FINAL_PASS'
      ? 'Eligible to plan EPIC 2E-L Candidate Review Pilot; Production remains locked.'
      : 'Do not start EPIC 2E-L until Native Browser IndexedDB is verified in an environment that permits a persistent web origin.',
  };
  await fs.writeFile(RESULT_PATH, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(`\nFIX5 RELEASE DECISION: ${decision}`);
  console.log(`Evidence: ${path.relative(ROOT, RESULT_PATH)}`);
  process.exit(decision === 'FINAL_PASS' ? 0 : decision === 'NOT_VERIFIED' ? 2 : 1);
}

main().catch(error => {
  console.error(error?.stack ?? error);
  process.exit(1);
});
