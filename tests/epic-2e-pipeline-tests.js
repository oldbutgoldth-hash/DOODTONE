/* global describe, it, assert */
/* eslint-env mocha, browser */

import { createGeneration, getActiveGenerationId, isStale, createGenerationGuard } from '../core/generation-control.js';
import { getCachedReferenceAnalysis, setCachedReferenceAnalysis, getCachedTargetAnalysis, setCachedTargetAnalysis, getCacheStats, clearCaches } from '../core/analysis-cache.js';
import { createHeartbeat } from '../core/pipeline-heartbeat.js';
import { PreviewStateMachine, PREVIEW_STATE } from '../core/preview-state-machine.js';
import { ContributionLedger } from '../core/contribution-ledger.js';
import { normalizeCandidate, validateCandidate, getLayer1Subset, getLayer2Subset } from '../core/candidate-schema.js';
import { createTrace, recordTrace, getTrace, closeTrace, pruneTraces, formatTraceSummary } from '../core/pipeline-tracer.js';
import { runModule, MODULE_STATUS, LAYER } from '../core/core-runner.js';

describe('EPIC 2E / P0.7 — Pipeline Runtime Architecture', function () {
  this.timeout(10000);

  /* ── Generation Control ── */
  describe('Generation Control', () => {
    it('creates sequential generation IDs', () => {
      const a = createGeneration();
      const b = createGeneration();
      assert.strictEqual(b.generationId, a.generationId + 1);
    });

    it('marks old generations as stale', () => {
      const oldId = createGeneration().generationId;
      const newGen = createGeneration();
      assert.ok(isStale(oldId));
      assert.ok(!isStale(newGen.generationId));
    });

    it('guard returns stale for old generations', () => {
      const oldId = createGeneration().generationId;
      const newGen = createGeneration();
      const oldGuard = createGenerationGuard(oldId);
      const newGuard = createGenerationGuard(newGen.generationId);
      assert.ok(oldGuard().stale);
      assert.ok(!newGuard().stale);
    });

    it('abort controller cancels active', () => {
      const gen = createGeneration();
      const { signal } = gen;
      assert.ok(!signal.aborted);
      gen.abort();
      assert.ok(signal.aborted);
    });
  });

  /* ── Cache System ── */
  describe('Analysis Cache', () => {
    beforeEach(() => clearCaches());

    it('stores and retrieves reference analysis', () => {
      const key = { filePath: 'ref.dng', imageId: 'ref1', dimensions: '6000x4000', profileVersion: 'v1' };
      const data = { wb: { temp: 5500 } };
      setCachedReferenceAnalysis(key, data);
      const got = getCachedReferenceAnalysis(key);
      assert.deepStrictEqual(got, data);
    });

    it('stores and retrieves target analysis', () => {
      const key = { filePath: 'tgt.dng', imageId: 'tgt1', dimensions: '6000x4000', profileVersion: 'v1' };
      const data = { histogram: { bins: [] } };
      setCachedTargetAnalysis(key, data);
      const got = getCachedTargetAnalysis(key);
      assert.deepStrictEqual(got, data);
    });

    it('returns null for cache miss', () => {
      const got = getCachedReferenceAnalysis({ filePath: 'nonexistent', imageId: 'x', dimensions: '1', profileVersion: 'v1' });
      assert.strictEqual(got, null);
    });

    it('tracks cache hit/miss stats', () => {
      const key = { filePath: 'f', imageId: 'i', dimensions: 'd', profileVersion: 'v' };
      setCachedReferenceAnalysis(key, { x: 1 });
      getCachedReferenceAnalysis(key);
      getCachedReferenceAnalysis({ filePath: 'f2', imageId: 'i2', dimensions: 'd2', profileVersion: 'v' });
      const stats = getCacheStats();
      assert.strictEqual(stats.hits, 3);
      assert.strictEqual(stats.misses, 2);
    });

    it('intensity NOT in cache key', () => {
      // Same file/dimensions but different intensity — should be same cache key
      const key1 = { filePath: 'test.dng', imageId: 'i', dimensions: '6000x4000', profileVersion: 'v1' };
      const key2 = { filePath: 'test.dng', imageId: 'i', dimensions: '6000x4000', profileVersion: 'v1' };
      setCachedReferenceAnalysis(key1, { data: 'abc' });
      const got = getCachedReferenceAnalysis(key2);
      assert.deepStrictEqual(got, { data: 'abc' });
    });
  });

  /* ── Heartbeat ── */
  describe('Pipeline Heartbeat', () => {
    it('creates heartbeat with IDLE state', () => {
      const hb = createHeartbeat('test');
      assert.strictEqual(hb.current, 'IDLE');
      hb.stop();
    });

    it('tracks current module', () => {
      const hb = createHeartbeat('test');
      hb.update('RUNNING:kMeans');
      assert.strictEqual(hb.current, 'RUNNING:kMeans');
      hb.stop();
    });

    it('start sets state to STARTED', () => {
      const hb = createHeartbeat('test');
      hb.start();
      assert.strictEqual(hb.current, 'STARTED');
      hb.stop();
    });

    it('stop sets state to STOPPED', () => {
      const hb = createHeartbeat('test');
      hb.start();
      hb.stop();
      assert.strictEqual(hb.current, 'STOPPED');
    });
  });

  /* ── Preview State Machine ── */
  describe('Preview State Machine', () => {
    it('starts in IDLE', () => {
      const psm = new PreviewStateMachine();
      assert.strictEqual(psm.state, PREVIEW_STATE.IDLE);
    });

    it('follows valid transitions', () => {
      const psm = new PreviewStateMachine();
      assert.ok(psm.transition(PREVIEW_STATE.WAITING));
      assert.strictEqual(psm.state, PREVIEW_STATE.WAITING);
      assert.ok(psm.transition(PREVIEW_STATE.ANALYZING_LAYER_1));
      assert.strictEqual(psm.state, PREVIEW_STATE.ANALYZING_LAYER_1);
      assert.ok(psm.transition(PREVIEW_STATE.FAST_PREVIEW_READY));
      assert.strictEqual(psm.state, PREVIEW_STATE.FAST_PREVIEW_READY);
      assert.ok(psm.transition(PREVIEW_STATE.ANALYZING_LAYER_2));
      assert.strictEqual(psm.state, PREVIEW_STATE.ANALYZING_LAYER_2);
      assert.ok(psm.transition(PREVIEW_STATE.REFINED_READY));
      assert.strictEqual(psm.state, PREVIEW_STATE.REFINED_READY);
    });

    it('rejects invalid transitions', () => {
      const psm = new PreviewStateMachine();
      assert.ok(!psm.transition(PREVIEW_STATE.REFINED_READY));
      assert.strictEqual(psm.state, PREVIEW_STATE.IDLE);
    });

    it('supports canTransition guard', () => {
      const psm = new PreviewStateMachine();
      assert.ok(psm.canTransition(PREVIEW_STATE.WAITING));
      assert.ok(!psm.canTransition(PREVIEW_STATE.ERROR));
    });

    it('notifies on transition', () => {
      const psm = new PreviewStateMachine();
      let notified = null;
      psm.onTransition((t) => { notified = t; });
      psm.transition(PREVIEW_STATE.WAITING);
      assert.deepStrictEqual(notified, { from: PREVIEW_STATE.IDLE, to: PREVIEW_STATE.WAITING });
    });

    it('supports error state', () => {
      const psm = new PreviewStateMachine();
      psm.transition(PREVIEW_STATE.WAITING);
      psm.transition(PREVIEW_STATE.ERROR);
      assert.strictEqual(psm.state, PREVIEW_STATE.ERROR);
    });
  });

  /* ── Contribution Ledger ── */
  describe('Contribution Ledger', () => {
    it('records entries', () => {
      const ledger = new ContributionLedger();
      ledger.record({ generationId: 1, moduleId: 'kMeans', layer: 'LAYER_1', status: 'COMPLETED', elapsedMs: 100 });
      const s = ledger.getSummary(1);
      assert.strictEqual(s.total, 1);
      assert.strictEqual(s.completed, 1);
    });

    it('summarizes by layer', () => {
      const ledger = new ContributionLedger();
      ledger.record({ generationId: 2, moduleId: 'kMeans', layer: 'LAYER_1', status: 'COMPLETED', elapsedMs: 50 });
      ledger.record({ generationId: 2, moduleId: 'skinTone', layer: 'LAYER_2', status: 'COMPLETED', elapsedMs: 200 });
      const ls = ledger.getLayerSummary(2);
      assert.strictEqual(ls.layer1.completed, 1);
      assert.strictEqual(ls.layer2.completed, 1);
      assert.strictEqual(ls.layer1.elapsedMs, 50);
      assert.strictEqual(ls.layer2.elapsedMs, 200);
    });

    it('tracks cache hits', () => {
      const ledger = new ContributionLedger();
      ledger.record({ generationId: 3, moduleId: 'histogram', layer: 'LAYER_1', status: 'COMPLETED', elapsedMs: 0, cached: true });
      const s = ledger.getSummary(3);
      assert.strictEqual(s.cached, 1);
    });
  });

  /* ── Candidate Schema ── */
  describe('Candidate Schema', () => {
    it('normalizes null candidate', () => {
      const n = normalizeCandidate(null);
      assert.ok(n.kMeansData === null);
    });

    it('normalizes partial candidate', () => {
      const c = { kMeansData: { clusters: [] } };
      const n = normalizeCandidate(c);
      assert.deepStrictEqual(n.kMeansData, { clusters: [] });
      assert.strictEqual(n.histogramData, null);
    });

    it('validates complete candidate', () => {
      const c = {};
      for (const k of ['kMeansData', 'histogramData', 'toneZoneData', 'wbData', 'basicPanelData', 'toneCurveData', 'hslData', 'colorTransferData', 'toneCurveTransferData', 'histogramMatchingData', 'preserveData', 'fusionData', 'skinToneData', 'imgAnalysisData', 'colorGradingData', 'calibrationData', 'colorHarmonyData', 'featureFusionData', 'decisionData', 'extendedProtectionData']) {
        c[k] = null;
      }
      const v = validateCandidate(c);
      assert.ok(v.valid);
    });

    it('detects missing fields', () => {
      const v = validateCandidate({ kMeansData: {} });
      assert.ok(!v.valid);
      assert.ok(v.missing.length > 0);
    });

    it('getLayer1Subset only includes layer 1 keys', () => {
      const c = { kMeansData: { a: 1 }, skinToneData: { b: 2 }, fusionData: { c: 3 } };
      const l1 = getLayer1Subset(c);
      assert.deepStrictEqual(l1.kMeansData, { a: 1 });
      assert.strictEqual(l1.skinToneData, undefined);
      assert.deepStrictEqual(l1.fusionData, { c: 3 });
    });

    it('getLayer2Subset only includes layer 2 keys', () => {
      const c = { kMeansData: { a: 1 }, skinToneData: { b: 2 } };
      const l2 = getLayer2Subset(c);
      assert.strictEqual(l2.kMeansData, undefined);
      assert.deepStrictEqual(l2.skinToneData, { b: 2 });
    });
  });

  /* ── Pipeline Tracer ── */
  describe('Pipeline Tracer', () => {
    afterEach(() => pruneTraces(0));

    it('creates and closes trace', () => {
      const t = createTrace(1);
      assert.strictEqual(t.generationId, 1);
      assert.strictEqual(t.endTime, null);
      closeTrace(1);
      assert.ok(t.endTime !== null);
    });

    it('records entries', () => {
      createTrace(5);
      recordTrace({ generationId: 5, stageId: 'ANALYZE', moduleId: 'kMeans', status: 'COMPLETED' });
      const t = getTrace(5);
      assert.strictEqual(t.entries.length, 1);
      assert.strictEqual(t.entries[0].moduleId, 'kMeans');
    });

    it('formatTraceSummary returns string', () => {
      createTrace(7);
      recordTrace({ generationId: 7, stageId: 'LAYER_1', moduleId: 'wb', status: 'COMPLETED' });
      closeTrace(7);
      const s = formatTraceSummary(7);
      assert.ok(s.includes('wb'));
      assert.ok(s.includes('COMPLETED'));
    });
  });
});
