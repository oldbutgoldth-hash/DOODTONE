#!/usr/bin/env node
/** EPIC 2E-O fail-closed release gate. */
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RESULT_PATH = path.join(ROOT, 'qa/epic-2e-o8-release-gate-results.json');
const BROWSER_RESULT_PATH = path.join(ROOT, 'qa/epic-2e-o8-best-of-both-browser-results.json');
const PRODUCTION_MANIFEST = 'qa/baselines/epic-2e-n-production-invariant.json';
const startedAt = new Date().toISOString();
const runId = randomUUID();

const BROWSER_HASH_FILES = [
  'core/color-match/reference-target-signature-engine.js',
  'core/color-match/signature-delta-engine.js',
  'core/color-match/photographic-compensation-engine.js',
  'core/color-match/lightroom-candidate-mapper.js',
  'core/color-match/candidate-preview-renderer.js',
  'core/color-match/match-evaluation-engine.js',
  'core/color-match/evaluation-store.js',
  'core/color-match/target-aware-protection-engine.js',
  'core/color-match/lightroom-compatibility-profile.js',
  'core/color-match/lightroom-roundtrip-fidelity-engine.js',
  'core/color-match/core-color-match-pipeline.js',
  'core/color-match/candidate-xmp-codec.js',
  'core/color-match/color-match-direction-gate.js',
  'core/color-match/xmp-data-lineage.js',
  'core/color-match/perceptual-color-science.js',
  'core/color-match/gaussian-hsl-transfer-engine.js',
  'core/color-match/tone-curve-transfer-engine.js',
  'core/color-match/histogram-matching-engine.js',
  'core/color-match/perceptual-pixel-transfer-engine.js',
];
const RELEASE_HASH_FILES = [
  ...BROWSER_HASH_FILES,
  'ui/reference-color-match-panel.js',
  'core/project-version.js',
  'index.html',
  'package.json',
  'qa/epic-2e-o-target-aware-roundtrip-static-test.mjs',
  'qa/epic-2e-o8-best-of-both-browser-test.mjs',
  'qa/epic-2e-o3-o7-xmp-lineage-static-test.mjs',
  'qa/epic-2e-o8-best-of-both-color-match-static-test.mjs',
];

function run(label, rel, timeout = 300000) {
  const result = spawnSync(process.execPath, [path.join(ROOT, rel)], { cwd: ROOT, encoding: 'utf8', timeout });
  const exitCode = Number.isInteger(result.status) ? result.status : 1;
  const status = exitCode === 0 ? 'PASS' : exitCode === 2 ? 'NOT_VERIFIED' : 'FAIL';
  console.log(`\n=== ${label}: ${status} (exit ${exitCode}) ===`);
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return {
    label, rel, exitCode, status,
    stdoutTail: (result.stdout || '').slice(-12000),
    stderrTail: (result.stderr || '').slice(-6000),
  };
}
async function hashFile(rel) {
  return createHash('sha256').update(await fs.readFile(path.join(ROOT, rel))).digest('hex');
}
async function hashSet(files) {
  const h = createHash('sha256');
  for (const rel of files) h.update(rel).update(await fs.readFile(path.join(ROOT, rel)));
  return h.digest('hex');
}
async function verifyProductionInvariant() {
  const manifest = JSON.parse(await fs.readFile(path.join(ROOT, PRODUCTION_MANIFEST), 'utf8'));
  const mismatches = [];
  for (const [rel, expected] of Object.entries(manifest.files || {})) {
    let actual = null;
    try { actual = await hashFile(rel); } catch {}
    if (actual !== expected) mismatches.push({ file: rel, expected, actual });
  }
  const locks = manifest.productionLocks || {};
  const lockPass = locks.productionSource === 'legacy' && locks.productionWrite === false &&
    locks.controlledV2Apply === false && locks.previewExport === false &&
    locks.controlledV2ProductionActivation === false;
  return {
    status: mismatches.length === 0 && lockPass ? 'PASS' : 'FAIL',
    manifest: PRODUCTION_MANIFEST,
    mismatches,
    productionLocks: locks,
  };
}
async function verifyBrowserEvidence() {
  let result = null;
  try { result = JSON.parse(await fs.readFile(BROWSER_RESULT_PATH, 'utf8')); } catch {}
  const checks = result?.result?.checks || {};
  const requiredChecks = [
    'perceptualPixelTransfer', 'gaussianHsl', 'pointCurvesApplied', 'curveReadback',
    'candidateMapped', 'xmpSerialized', 'xmpReadback', 'directionValid', 'dataLineage', 'targetWbBase', 'profilePreserved', 'meaningfulXmp', 'previewChanged', 'afterAnalysed',
    'evaluationComplete', 'recordSaved', 'neutralWhiteProtection',
    'highKeyDetected', 'skinProtection', 'sceneTransferDampened',
    'newClippingBounded', 'rawCompatibility', 'roundTripVerified',
    'noProduction', 'xmpSingleSource', 'noPrivateData',
  ];
  const missingChecks = requiredChecks.filter(key => checks[key] !== true);
  const currentSourceHash = await hashSet(BROWSER_HASH_FILES);
  const fresh = result?.sourceHash === currentSourceHash;
  const pass = result?.completed === true && result?.decision === 'PASS' &&
    typeof result?.runId === 'string' && result.runId.length > 0 &&
    typeof result?.startedAt === 'string' && typeof result?.completedAt === 'string' &&
    typeof result?.browserExecutable === 'string' && result.browserExecutable.length > 0 &&
    typeof result?.browserVersion === 'string' && result.browserVersion.length > 0 &&
    fresh && missingChecks.length === 0;
  const status = pass ? 'PASS' : result?.decision === 'NOT_VERIFIED' ? 'NOT_VERIFIED' : 'FAIL';
  return {
    status, fresh, expectedSourceHash: currentSourceHash, actualSourceHash: result?.sourceHash ?? null,
    missingChecks, browserExecutable: result?.browserExecutable ?? null,
    browserVersion: result?.browserVersion ?? null,
    candidatePreset: result?.result?.candidate?.preset ?? null,
    previewMetrics: result?.result?.preview ?? null,
    evaluation: result?.result?.evaluation ?? null,
    roundTrip: result?.result?.roundTrip ?? null,
    note: 'Browser round-trip uses a deterministic same-signature Lightroom-return simulation to verify the evaluator. A real Lightroom export remains required for photographic calibration.',
  };
}
async function verifyPackageCleanliness() {
  const forbidden = ['.git', '__pycache__', '.cache'];
  const forbiddenDirectories = [];
  for (const name of forbidden) {
    try { if ((await fs.stat(path.join(ROOT, name))).isDirectory()) forbiddenDirectories.push(name); } catch {}
  }
  let workspaceNodeModulesPresent = false;
  try { workspaceNodeModulesPresent = (await fs.stat(path.join(ROOT, 'node_modules'))).isDirectory(); } catch {}
  const zipFiles = (await fs.readdir(ROOT)).filter(name => /\.zip$/i.test(name));
  const releaseExclusions = ['node_modules', '.git', '*.zip', 'Browser Cache', 'User Sessions', 'Lightroom Exports'];
  return {
    status: forbiddenDirectories.length === 0 && zipFiles.length === 0 ? 'PASS' : 'FAIL',
    forbiddenDirectories,
    zipFiles,
    workspaceNodeModulesPresent,
    releaseExclusions,
    nodeModulesExcludedFromRelease: true,
  };
}

const steps = [
  run('ESM Syntax', 'tools/esm-syntax-gate.mjs'),
  run('Full Static Suites', 'qa/run-static-suites.mjs'),
  run('2E-O3..O7 XMP Lineage', 'qa/epic-2e-o3-o7-xmp-lineage-static-test.mjs'),
  run('2E-O Target-aware Browser Runtime', 'qa/epic-2e-o8-best-of-both-browser-test.mjs'),
];
const browserEvidence = await verifyBrowserEvidence();
steps.push({
  label: 'Fresh Browser Evidence', rel: 'qa/epic-2e-o8-best-of-both-browser-results.json',
  exitCode: browserEvidence.status === 'PASS' ? 0 : browserEvidence.status === 'NOT_VERIFIED' ? 2 : 1,
  status: browserEvidence.status, stdoutTail: JSON.stringify(browserEvidence), stderrTail: '',
});
const productionInvariant = await verifyProductionInvariant();
steps.push({ label: 'Legacy Production/XMP Invariant', rel: PRODUCTION_MANIFEST, exitCode: productionInvariant.status === 'PASS' ? 0 : 1, status: productionInvariant.status, stdoutTail: JSON.stringify(productionInvariant), stderrTail: '' });
const packageCleanliness = await verifyPackageCleanliness();
steps.push({ label: 'Package Cleanliness', rel: '.', exitCode: packageCleanliness.status === 'PASS' ? 0 : 1, status: packageCleanliness.status, stdoutTail: JSON.stringify(packageCleanliness), stderrTail: '' });

let decision = 'FINAL_PASS';
if (steps.some(step => step.status === 'FAIL')) decision = 'FAIL';
else if (steps.some(step => step.status === 'NOT_VERIFIED')) decision = 'NOT_VERIFIED';
const output = {
  epic: '2E-O8', suite: 'BEST_OF_BOTH_TRUE_COLOR_MATCH_RELEASE_GATE', decision, completed: true,
  runId, startedAt, completedAt: new Date().toISOString(), sourceHash: await hashSet(RELEASE_HASH_FILES),
  steps, browserEvidence, productionInvariant, packageCleanliness,
  releaseBoundary: {
    targetAwareCompensationImplemented: decision === 'FINAL_PASS',
    neutralWhiteProtectionImplemented: decision === 'FINAL_PASS',
    skinProtectionImplemented: decision === 'FINAL_PASS',
    browserPreviewFidelityInspectorImplemented: decision === 'FINAL_PASS',
    realLightroomRoundTripPhotographicallyVerified: false,
    referenceColorMatchBetaStarted: false,
    productionSource: 'legacy',
    productionWrite: false,
    controlledV2Apply: false,
    previewExport: false,
    productionActivationAllowed: false,
    candidateXmpInMemoryOnly: true,
  },
};
await fs.writeFile(RESULT_PATH, JSON.stringify(output, null, 2) + '\n');
console.log(`\nEPIC 2E-O RELEASE DECISION: ${decision}`);
console.log('Evidence: qa/epic-2e-o8-release-gate-results.json');
process.exit(decision === 'FINAL_PASS' ? 0 : decision === 'NOT_VERIFIED' ? 2 : 1);
