export class ContributionLedger {
  constructor() {
    this._entries = [];
  }

  record({ generationId, moduleId, layer, status, elapsedMs, cached, fallback, resultKeys }) {
    this._entries.push({
      generationId,
      moduleId,
      layer,
      status,
      elapsedMs,
      cached: !!cached,
      fallback: !!fallback,
      resultKeys: resultKeys || [],
      ts: Date.now(),
    });
  }

  getSummary(generationId) {
    const filtered = generationId ? this._entries.filter(e => e.generationId === generationId) : this._entries;
    const completed = filtered.filter(e => e.status === 'COMPLETED');
    const totalMs = completed.reduce((s, e) => s + (e.elapsedMs || 0), 0);
    return {
      total: filtered.length,
      completed: completed.length,
      totalMs,
      cached: filtered.filter(e => e.cached).length,
      fallback: filtered.filter(e => e.fallback).length,
      modules: completed.map(e => ({ moduleId: e.moduleId, elapsedMs: e.elapsedMs, cached: e.cached })),
    };
  }

  getLayerSummary(generationId) {
    const filtered = generationId ? this._entries.filter(e => e.generationId === generationId) : this._entries;
    const l1 = filtered.filter(e => e.layer === 'LAYER_1');
    const l2 = filtered.filter(e => e.layer === 'LAYER_2');
    return {
      layer1: { total: l1.length, completed: l1.filter(e => e.status === 'COMPLETED').length, elapsedMs: l1.reduce((s, e) => s + (e.elapsedMs || 0), 0) },
      layer2: { total: l2.length, completed: l2.filter(e => e.status === 'COMPLETED').length, elapsedMs: l2.reduce((s, e) => s + (e.elapsedMs || 0), 0) },
    };
  }

  clear() { this._entries = []; }
}

export const globalLedger = new ContributionLedger();
