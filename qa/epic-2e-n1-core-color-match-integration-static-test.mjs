#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log(`✓ [PASS] ${name}`); }
  catch (error) { console.error(`✗ [FAIL] ${name}\n${error.stack}`); process.exitCode = 1; }
}
const read = rel => fs.readFile(path.join(ROOT, rel), 'utf8');
const hash = async rel => createHash('sha256').update(await fs.readFile(path.join(ROOT, rel))).digest('hex');

await test('N1 core modules never import Lightroom Mapping, Preset Engine, or XMP serializer', async () => {
  for (const rel of [
    'core/color-match/signature-schema.js',
    'core/color-match/reference-target-signature-engine.js',
    'core/color-match/signature-delta-engine.js',
    'core/color-match/core-color-match-analysis.js',
  ]) {
    const source = await read(rel);
    assert.equal(/lightroom-mapping-engine|preset-engine|xmp-validator|serializeXMP|downloadXMP/.test(source), false, rel);
  }
});

await test('Reference Color Match panel preserves N1 signatures inside the complete N1-N5 candidate pipeline', async () => {
  const source = await read('ui/reference-color-match-panel.js');
  assert.match(source, /buildCoreColorMatchPipeline/);
  assert.match(source, /corePipeline\.analysis\.referenceSignature/);
  assert.match(source, /N1 → N5/);
  assert.match(source, /Production.*Legacy/);
  assert.match(source, /xmpWriteAllowed/);
});

await test('N1 UI inspector exposes explicit Legacy and no-write semantic state', async () => {
  const source = await read('ui/reference-color-match-panel.js');
  assert.match(source, /dataset\.productionSource/);
  assert.match(source, /dataset\.productionWrite/);
  assert.match(source, /dataset\.xmpWriteAllowed/);
});

await test('Production and XMP source files retain exact baseline hashes', async () => {
  const manifest = JSON.parse(await read('qa/baselines/epic-2e-n1-production-invariant.json'));
  for (const [rel, expected] of Object.entries(manifest.files)) assert.equal(await hash(rel), expected, rel);
});

await test('N1 production lock contract is fail-closed', async () => {
  const manifest = JSON.parse(await read('qa/baselines/epic-2e-n1-production-invariant.json'));
  assert.deepEqual(manifest.productionLocks, {
    productionSource: 'legacy',
    productionWrite: false,
    xmpWriteAllowedByN1: false,
    lightroomMappingAllowedByN1: false,
  });
});

await test('N1 package does not claim Production readiness', async () => {
  const sources = await Promise.all([
    read('core/color-match/core-color-match-analysis.js'),
    read('core/color-match/signature-delta-engine.js'),
    read('core/project-version.js'),
  ]);
  assert.equal(sources.join('\n').includes('PRODUCTION_READY'), false);
});

console.log(`\n${pass}/6 PASS, ${process.exitCode ? 1 : 0} FAIL`);
if (process.exitCode) process.exit(process.exitCode);
