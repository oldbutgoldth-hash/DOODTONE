#!/usr/bin/env node
import assert from 'node:assert/strict';

import { createGeneration, getActiveGenerationId, isStale, createGenerationGuard, cancelActiveGeneration } from '../core/generation-control.js';
import { getCachedReferenceAnalysis, setCachedReferenceAnalysis, getCachedTargetAnalysis, setCachedTargetAnalysis, getCacheStats, clearCaches, invalidateTargetCache } from '../core/analysis-cache.js';
import { createHeartbeat } from '../core/pipeline-heartbeat.js';
import { PreviewStateMachine, PREVIEW_STATE } from '../core/preview-state-machine.js';
import { ContributionLedger } from '../core/contribution-ledger.js';
import { normalizeCandidate, validateCandidate, getLayer1Subset, getLayer2Subset, markLayer, CANDIDATE_LAYER_KEYS } from '../core/candidate-schema.js';
import { createTrace, recordTrace, getTrace, closeTrace, pruneTraces, formatTraceSummary } from '../core/pipeline-tracer.js';
import { runModule, MODULE_STATUS, LAYER } from '../core/core-runner.js';

let pass = 0, fail = 0;
const test = (n, f) => { try { f(); pass++; console.log(`  [PASS] ${n}`); } catch (e) { fail++; console.error(`  [FAIL] ${n}\n${e.stack}`); } };
const testAsync = async (n, f) => { try { await f(); pass++; console.log(`  [PASS] ${n}`); } catch (e) { fail++; console.error(`  [FAIL] ${n}\n${e.stack}`); } };
const todo = (n) => { pass++; console.log(`  [TODO] ${n}`); };

/* ── Generation Control ── */
test('createGeneration returns sequential IDs', () => {
  const a = createGeneration();
  const b = createGeneration();
  assert.ok(b.generationId > a.generationId);
});

test('isStale returns true for old generation', () => {
  const oldId = createGeneration().generationId;
  const newGen = createGeneration();
  assert.ok(isStale(oldId));
  assert.ok(!isStale(newGen.generationId));
});

test('createGenerationGuard detects stale generation', () => {
  const oldId = createGeneration().generationId;
  const newGen = createGeneration();
  const oldGuard = createGenerationGuard(oldId);
  const newGuard = createGenerationGuard(newGen.generationId);
  assert.ok(oldGuard().stale);
  assert.ok(!newGuard().stale);
});

test('AbortController aborts on new generation', () => {
  const gen1 = createGeneration();
  const oldSignal = gen1.signal;
  assert.ok(!oldSignal.aborted);
  createGeneration();
  assert.ok(oldSignal.aborted);
});

/* ── Cache System ── */
test('setCachedReferenceAnalysis stores and get retrieves', () => {
  clearCaches();
  const key = { filePath: 'ref.dng', imageId: 'ref1', dimensions: '6000x4000', profileVersion: 'v1' };
  setCachedReferenceAnalysis(key, { wb: { temp: 5500 } });
  const got = getCachedReferenceAnalysis(key);
  assert.deepEqual(got, { wb: { temp: 5500 } });
});

test('setCachedTargetAnalysis stores and get retrieves', () => {
  clearCaches();
  const key = { filePath: 'tgt.dng', imageId: 'tgt1', dimensions: '6000x4000', profileVersion: 'v1' };
  setCachedTargetAnalysis(key, { histogram: { bins: [1, 2, 3] } });
  const got = getCachedTargetAnalysis(key);
  assert.deepEqual(got, { histogram: { bins: [1, 2, 3] } });
});

test('getCachedReferenceAnalysis returns null on miss', () => {
  clearCaches();
  const got = getCachedReferenceAnalysis({ filePath: 'nonexistent', imageId: 'x', dimensions: '1', profileVersion: 'v1' });
  assert.strictEqual(got, null);
});

test('getCacheStats tracks hits and misses', () => {
  clearCaches();
  const key = { filePath: 'f', imageId: 'i', dimensions: 'd', profileVersion: 'v' };
  setCachedReferenceAnalysis(key, { x: 1 });
  getCachedReferenceAnalysis(key); // hit
  getCachedReferenceAnalysis({ filePath: 'f2', imageId: 'i2', dimensions: 'd2', profileVersion: 'v' }); // miss
  getCachedReferenceAnalysis(key); // hit
  getCachedTargetAnalysis({ filePath: 'x', imageId: 'x', dimensions: 'x', profileVersion: 'v' }); // miss
  const stats = getCacheStats();
  assert.equal(stats.hits, 2);
  assert.equal(stats.misses, 2);
});

test('intensity not in cache key (same file yields same cache)', () => {
  clearCaches();
  const key1 = { filePath: 'test.dng', imageId: 'i', dimensions: '6000x4000', profileVersion: 'v1' };
  const key2 = { filePath: 'test.dng', imageId: 'i', dimensions: '6000x4000', profileVersion: 'v1' };
  setCachedReferenceAnalysis(key1, { data: 'abc' });
  const got = getCachedReferenceAnalysis(key2);
  assert.deepEqual(got, { data: 'abc' });
});

test('invalidateTargetCache clears target cache only', () => {
  clearCaches();
  const refKey = { filePath: 'r.dng', imageId: 'r', dimensions: 'd', profileVersion: 'v' };
  const tgtKey = { filePath: 't.dng', imageId: 't', dimensions: 'd', profileVersion: 'v' };
  setCachedReferenceAnalysis(refKey, { ref: true });
  setCachedTargetAnalysis(tgtKey, { tgt: true });
  invalidateTargetCache();
  assert.ok(getCachedReferenceAnalysis(refKey) !== null);
  assert.strictEqual(getCachedTargetAnalysis(tgtKey), null);
});

/* ── Heartbeat ── */
test('createHeartbeat initial state is IDLE', () => {
  const hb = createHeartbeat('test');
  assert.equal(hb.current, 'IDLE');
  hb.stop();
});

test('heartbeat start sets state to STARTED', () => {
  const hb = createHeartbeat('test');
  hb.start();
  assert.equal(hb.current, 'STARTED');
  hb.stop();
});

test('heartbeat update sets current module', () => {
  const hb = createHeartbeat('test');
  hb.update('RUNNING:kMeans');
  assert.equal(hb.current, 'RUNNING:kMeans');
  hb.stop();
});

test('heartbeat stop sets STOPPED', () => {
  const hb = createHeartbeat('test');
  hb.start();
  hb.stop();
  assert.equal(hb.current, 'STOPPED');
});

/* ── Preview State Machine ── */
test('PSM starts in IDLE', () => {
  const psm = new PreviewStateMachine();
  assert.equal(psm.state, PREVIEW_STATE.IDLE);
});

test('PSM follows valid transitions to FAST_PREVIEW_READY', () => {
  const psm = new PreviewStateMachine();
  assert.ok(psm.transition(PREVIEW_STATE.WAITING));
  assert.ok(psm.transition(PREVIEW_STATE.ANALYZING_LAYER_1));
  assert.ok(psm.transition(PREVIEW_STATE.FAST_PREVIEW_READY));
  assert.equal(psm.state, PREVIEW_STATE.FAST_PREVIEW_READY);
});

test('PSM follows valid transitions to REFINED_READY', () => {
  const psm = new PreviewStateMachine();
  psm.transition(PREVIEW_STATE.WAITING);
  psm.transition(PREVIEW_STATE.ANALYZING_LAYER_1);
  psm.transition(PREVIEW_STATE.FAST_PREVIEW_READY);
  assert.ok(psm.transition(PREVIEW_STATE.ANALYZING_LAYER_2));
  assert.ok(psm.transition(PREVIEW_STATE.REFINED_READY));
  assert.equal(psm.state, PREVIEW_STATE.REFINED_READY);
});

test('PSM rejects invalid transitions', () => {
  const psm = new PreviewStateMachine();
  assert.ok(!psm.transition(PREVIEW_STATE.REFINED_READY));
  assert.equal(psm.state, PREVIEW_STATE.IDLE);
});

test('PSM canTransition guard works', () => {
  const psm = new PreviewStateMachine();
  assert.ok(psm.canTransition(PREVIEW_STATE.WAITING));
  assert.ok(!psm.canTransition(PREVIEW_STATE.ERROR));
});

test('PSM transition callback fires', () => {
  const psm = new PreviewStateMachine();
  let fired = null;
  psm.onTransition((t) => { fired = t; });
  psm.transition(PREVIEW_STATE.WAITING);
  assert.deepEqual(fired, { from: PREVIEW_STATE.IDLE, to: PREVIEW_STATE.WAITING });
});

test('PSM supports ERROR state', () => {
  const psm = new PreviewStateMachine();
  psm.transition(PREVIEW_STATE.WAITING);
  assert.ok(psm.transition(PREVIEW_STATE.ERROR));
  assert.equal(psm.state, PREVIEW_STATE.ERROR);
});

test('PSM supports STALE state from ANALYZING_LAYER_1', () => {
  const psm = new PreviewStateMachine();
  psm.transition(PREVIEW_STATE.WAITING);
  psm.transition(PREVIEW_STATE.ANALYZING_LAYER_1);
  assert.ok(psm.transition(PREVIEW_STATE.STALE));
  assert.equal(psm.state, PREVIEW_STATE.STALE);
});

/* ── Contribution Ledger ── */
test('ContributionLedger records and summarizes', () => {
  const ledger = new ContributionLedger();
  ledger.record({ generationId: 1, moduleId: 'kMeans', layer: 'LAYER_1', status: 'COMPLETED', elapsedMs: 100 });
  ledger.record({ generationId: 1, moduleId: 'histogram', layer: 'LAYER_1', status: 'COMPLETED', elapsedMs: 50, cached: true });
  const s = ledger.getSummary(1);
  assert.equal(s.total, 2);
  assert.equal(s.completed, 2);
  assert.equal(s.cached, 1);
});

test('ContributionLedger layer summary', () => {
  const ledger = new ContributionLedger();
  ledger.record({ generationId: 2, moduleId: 'kMeans', layer: 'LAYER_1', status: 'COMPLETED', elapsedMs: 50 });
  ledger.record({ generationId: 2, moduleId: 'skinTone', layer: 'LAYER_2', status: 'COMPLETED', elapsedMs: 200 });
  ledger.record({ generationId: 2, moduleId: 'wb', layer: 'LAYER_1', status: 'COMPLETED', elapsedMs: 30, cached: true });
  const ls = ledger.getLayerSummary(2);
  assert.equal(ls.layer1.completed, 2);
  assert.equal(ls.layer2.completed, 1);
  assert.equal(ls.layer1.elapsedMs, 80);
  assert.equal(ls.layer2.elapsedMs, 200);
});

/* ── Candidate Schema ── */
test('normalizeCandidate handles null', () => {
  const n = normalizeCandidate(null);
  assert.deepEqual(n, {});
});

test('normalizeCandidate preserves safePreset fields', () => {
  const n = normalizeCandidate({ safePreset: { exp: 0.5, con: 25, curves: { master: [[0,0],[1,1]] } } });
  assert.equal(n.safePreset.exp, 0.5);
  assert.equal(n.safePreset.con, 25);
  assert.deepEqual(n.safePreset.curves, { master: [[0,0],[1,1]], red: [], green: [], blue: [] });
  assert.equal(n.safePreset.hi, 0);
});

test('validateCandidate passes when all CANDIDATE_LAYER_KEYS present', () => {
  const c = {};
  for (const k of CANDIDATE_LAYER_KEYS) c[k] = null;
  const v = validateCandidate(c);
  assert.ok(v.valid);
});

test('validateCandidate detects missing fields', () => {
  const v = validateCandidate({ exportReady: true });
  assert.ok(!v.valid);
  assert.ok(v.missing.length > 0);
  assert.ok(v.missing.includes('safePreset'));
});

test('getLayer1Subset keeps only LAYER_1_CORE preset fields', () => {
  const c = { safePreset: { exp: 0.5, con: 25, hi: -10, sh: 5, wh: 3, bl: -2, temp: 5500, tint: 3, vib: 20, sat: 10, curves: { master: [] }, clarity: 30, dehaze: 15, hsl_h_red: 5 }, exportReady: true };
  const l1 = getLayer1Subset(c);
  assert.equal(l1.safePreset.exp, 0.5);
  assert.equal(l1.safePreset.clarity, undefined);
  assert.equal(l1.safePreset.hsl_h_red, undefined);
  assert.equal(l1.exportReady, true);
});

test('getLayer2Subset keeps only LAYER_2_CORE preset fields', () => {
  const c = { safePreset: { exp: 0.5, con: 25, clarity: 30, dehaze: 15, hsl_h_red: 5 }, exportReady: true };
  const l2 = getLayer2Subset(c);
  assert.equal(l2.safePreset.clarity, 30);
  assert.equal(l2.safePreset.exp, undefined);
  assert.equal(l2.exportReady, true);
});

test('markLayer sets _pipelineLayer', () => {
  const c = markLayer({ exportReady: true }, 'LAYER_1');
  assert.equal(c._pipelineLayer, 'LAYER_1');
});

/* ── Pipeline Tracer ── */
test('createTrace and closeTrace', () => {
  const t = createTrace(42);
  assert.equal(t.generationId, 42);
  assert.equal(t.endTime, null);
  closeTrace(42);
  assert.ok(t.endTime !== null);
  pruneTraces(0);
});

test('recordTrace adds entries', () => {
  createTrace(5);
  recordTrace({ generationId: 5, stageId: 'ANALYZE', moduleId: 'kMeans', status: 'COMPLETED' });
  recordTrace({ generationId: 5, stageId: 'ANALYZE', moduleId: 'histogram', status: 'COMPLETED', detail: 'cached' });
  const t = getTrace(5);
  assert.equal(t.entries.length, 2);
  assert.equal(t.entries[0].moduleId, 'kMeans');
  assert.equal(t.entries[1].detail, 'cached');
  closeTrace(5);
});

test('formatTraceSummary contains status and module', () => {
  createTrace(7);
  recordTrace({ generationId: 7, stageId: 'LAYER_1', moduleId: 'wb', status: 'COMPLETED' });
  closeTrace(7);
  const s = formatTraceSummary(7);
  assert.ok(s.includes('wb'));
  assert.ok(s.includes('COMPLETED'));
});

/* ── Core Runner ── */
async function runCoreRunnerTests() {
  await testAsync('runModule executes successfully', async () => {
    const gen = createGeneration();
    const guard = createGenerationGuard(gen.generationId);
    const result = await runModule({
      moduleId: 'test', layer: LAYER.LAYER_1, generationId: gen.generationId,
      signal: gen.signal, isStale: () => isStale(gen.generationId), heartbeatRef: { current: '' },
      guard, timeout: 5000,
      executor: async () => ({ done: true }),
    });
    assert.ok(!result.aborted);
    assert.equal(result.moduleId, 'test');
    assert.deepEqual(result.result, { done: true });
    assert.equal(result.cached, false);
  });

  await testAsync('runModule respects abort signal', async () => {
    const gen1 = createGeneration();
    const guard1 = createGenerationGuard(gen1.generationId);
    const resultP = runModule({
      moduleId: 'slow', layer: LAYER.LAYER_2, generationId: gen1.generationId,
      signal: gen1.signal, isStale: () => isStale(gen1.generationId), heartbeatRef: { current: '' },
      guard: guard1, timeout: 10000,
      executor: async () => { await new Promise(r => setTimeout(r, 200)); return { done: true }; },
    });
    createGeneration();
    const result = await resultP;
    assert.ok(result.aborted);
  });

  await testAsync('runModule uses cache provider', async () => {
    const gen = createGeneration();
    const guard = createGenerationGuard(gen.generationId);
    let cacheCalled = false;
    const result = await runModule({
      moduleId: 'cacheTest', layer: LAYER.LAYER_1, generationId: gen.generationId,
      signal: gen.signal, isStale: () => isStale(gen.generationId), heartbeatRef: { current: '' },
      guard, timeout: 5000,
      cacheProvider: async () => { cacheCalled = true; return { from: 'cache' }; },
      executor: async () => { throw new Error('should not reach executor'); },
    });
    assert.ok(cacheCalled);
    assert.ok(result.cached);
    assert.deepEqual(result.result, { from: 'cache' });
  });

  await testAsync('runModule uses fallback on error', async () => {
    const gen = createGeneration();
    const guard = createGenerationGuard(gen.generationId);
    const result = await runModule({
      moduleId: 'fallbackTest', layer: LAYER.LAYER_1, generationId: gen.generationId,
      signal: gen.signal, isStale: () => isStale(gen.generationId), heartbeatRef: { current: '' },
      guard, timeout: 5000,
      executor: async () => { throw new Error('executor failed'); },
      fallbackProvider: async () => ({ from: 'fallback' }),
    });
    assert.ok(result.fallback);
    assert.deepEqual(result.result, { from: 'fallback' });
  });

  await testAsync('runModule times out on slow executor', async () => {
    const gen = createGeneration();
    const guard = createGenerationGuard(gen.generationId);
    const result = await runModule({
      moduleId: 'timeoutTest', layer: LAYER.LAYER_1, generationId: gen.generationId,
      signal: gen.signal, isStale: () => isStale(gen.generationId), heartbeatRef: { current: '' },
      guard, timeout: 50,
      executor: async () => { await new Promise(r => setTimeout(r, 5000)); return {}; },
    });
    assert.ok(result.error);
    assert.ok(result.error.message.includes('TIMEOUT'));
  });
}

await runCoreRunnerTests();

/* ── End ── */
console.log(`\n${pass}/${pass+fail} PASS, ${fail} FAIL`);
if (fail) process.exit(1);
