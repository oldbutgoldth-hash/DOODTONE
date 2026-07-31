import assert from 'node:assert/strict';
import { applyUnifiedFusionToPreset } from '../core/color-match/unified-core-fusion-orchestrator.js';

const fusion = {
  fusedAdjustments: {
    hsl_s_orange: 12,
    grd_hi_s: 8,
    cal_blue_h: -4,
    temp: 20,
  },
  curves: null,
  kind: 'TEST_FUSION',
  gate: { decision: 'PASS' },
  utilizationSummary: {},
  ledger: {},
};

for (const intensityCase of [0, 25, 51, 60, 75, 100]) {
  const partial = { temp: intensityCase / 5 };
  const out = applyUnifiedFusionToPreset(partial, fusion);
  assert.equal(typeof out.hsl, 'object');
  assert.equal(typeof out.grade, 'object');
  assert.equal(typeof out.cal, 'object');
  assert.ok(Number.isFinite(out.hsl.hsl_s_orange));
  assert.ok(Number.isFinite(out.grade.grd_hi_s));
  assert.ok(Number.isFinite(out.cal.cal_blue_h));
}
console.log('P0.4.1 intensity candidate normalization: 6/6 PASS');
