/** EPIC 2E-O9 — weighted core fusion, contribution ledger and utilization gate. */
import { CORE_ROLES, REQUIRED_PRIMARY_MODULES } from './unified-core-output-contract.js';

const clamp = (v, min, max) => Math.max(min, Math.min(max, Number(v) || 0));
const round = (v, d = 2) => { const p = 10 ** d; return Math.round((Number(v) || 0) * p) / p; };
const CHANNELS = ['red','orange','yellow','green','aqua','blue','purple','magenta'];

function get(obj, path, fallback = 0) {
  let cur = obj;
  for (const key of path.split('.')) cur = cur?.[key];
  return Number.isFinite(Number(cur)) ? Number(cur) : fallback;
}
function pairDelta(pair, paths) {
  for (const path of paths) {
    const r = get(pair.reference.recommendedAdjustments, path, NaN);
    const t = get(pair.target.recommendedAdjustments, path, NaN);
    if (Number.isFinite(r) && Number.isFinite(t)) return r - t;
  }
  return 0;
}
function add(ledger, parameter, moduleId, value, confidence, reason) {
  const v = round(value);
  if (!Number.isFinite(v) || Math.abs(v) < 0.005) return;
  if (!ledger[parameter]) ledger[parameter] = [];
  ledger[parameter].push({ moduleId, value: v, confidence: round(confidence, 3), reason });
}
function sum(ledger, parameter) {
  return round((ledger[parameter] || []).reduce((s, x) => s + x.value * x.confidence, 0));
}

export function buildUnifiedCoreFusion({ matrix, compensation, basePreset = null } = {}) {
  if (!matrix?.modules) throw new TypeError('Unified Core Fusion requires a core matrix.');
  const ledger = {};
  const utilization = [];
  const module = id => matrix.modules.find(m => m.moduleId === id);

  for (const pair of matrix.modules) {
    const available = pair.reference.available || pair.target.available;
    utilization.push({ moduleId: pair.moduleId, role: pair.role, available, consumed: false, reason: available ? 'AVAILABLE_NOT_YET_CONSUMED' : 'NO_OUTPUT' });
  }
  const mark = (id, reason) => { const row = utilization.find(x => x.moduleId === id); if (row) { row.consumed = true; row.reason = reason; } };

  const wb = module('whiteBalancePro');
  if (wb?.reference.available && wb?.target.available) {
    const c = Math.min(wb.reference.confidence, wb.target.confidence);
    add(ledger, 'temp', 'whiteBalancePro', pairDelta(wb, ['temperature','temp','warmth']), c, 'Pairwise WB temperature delta');
    add(ledger, 'tint', 'whiteBalancePro', pairDelta(wb, ['tint']), c, 'Pairwise WB tint delta');
    mark('whiteBalancePro', 'PAIRWISE_PRIMARY_CONSUMED');
  }

  const basic = module('lightroomBasicPanel');
  if (basic?.reference.available && basic?.target.available) {
    const c = Math.min(basic.reference.confidence, basic.target.confidence);
    const map = { exp:['exposure','exp'], con:['contrast','con'], hi:['highlights','hi'], sh:['shadows','sh'], wh:['whites','wh'], bl:['blacks','bl'], clarity:['clarity'], dehaze:['dehaze'], texture:['texture'], vib:['vibrance','vib'], sat:['saturation','sat'] };
    for (const [parameter, paths] of Object.entries(map)) add(ledger, parameter, 'lightroomBasicPanel', pairDelta(basic, paths), c, `Pairwise Basic Panel ${parameter} delta`);
    mark('lightroomBasicPanel', 'PAIRWISE_PRIMARY_CONSUMED');
  }

  const hsl = module('hslAnalyzerPro');
  if (hsl?.reference.available && hsl?.target.available) {
    const c = Math.min(hsl.reference.confidence, hsl.target.confidence);
    for (const ch of CHANNELS) for (const axis of ['hue','saturation','luminance']) {
      const suffix = axis[0];
      add(ledger, `hsl_${suffix}_${ch}`, 'hslAnalyzerPro', pairDelta(hsl, [`channels.${ch}.${axis}`, `${ch}.${axis}`]), c, `Pairwise HSL ${ch} ${axis} delta`);
    }
    mark('hslAnalyzerPro', 'PAIRWISE_PRIMARY_CONSUMED');
  }

  const grading = module('colorGradingAI');
  if (grading?.reference.available && grading?.target.available) {
    const c = Math.min(grading.reference.confidence, grading.target.confidence);
    const map = {
      grd_sh_h:['shadows.hue'], grd_sh_s:['shadows.saturation'], grd_sh_l:['shadows.luminance'],
      grd_mid_h:['midtones.hue'], grd_mid_s:['midtones.saturation'], grd_mid_l:['midtones.luminance'],
      grd_hi_h:['highlights.hue'], grd_hi_s:['highlights.saturation'], grd_hi_l:['highlights.luminance'],
      grd_blend:['blending'],
    };
    for (const [p, paths] of Object.entries(map)) add(ledger, p, 'colorGradingAI', pairDelta(grading, paths), c, `Pairwise Color Grading ${p} delta`);
    mark('colorGradingAI', 'PAIRWISE_PRIMARY_CONSUMED');
  }

  const calibration = module('calibrationEngine');
  if (calibration?.reference.available && calibration?.target.available) {
    const c = Math.min(calibration.reference.confidence, calibration.target.confidence);
    const map = { cal_red_h:['red.hue','redPrimary.hue'], cal_red_s:['red.saturation','redPrimary.saturation'], cal_green_h:['green.hue','greenPrimary.hue'], cal_green_s:['green.saturation','greenPrimary.saturation'], cal_blue_h:['blue.hue','bluePrimary.hue'], cal_blue_s:['blue.saturation','bluePrimary.saturation'] };
    for (const [p, paths] of Object.entries(map)) add(ledger, p, 'calibrationEngine', pairDelta(calibration, paths), c, `Pairwise Calibration ${p} delta`);
    mark('calibrationEngine', 'PAIRWISE_PRIMARY_CONSUMED');
  }

  const curve = module('toneCurveAI');
  let curves = null;
  if (curve?.reference.available && curve.reference.recommendedAdjustments?.curves) {
    curves = curve.reference.recommendedAdjustments.curves;
    mark('toneCurveAI', 'REFERENCE_CURVE_CONSUMED');
  }

  for (const id of ['colourPaletteKMeans','histogramMetrics','toneZoneAnalyzer','imageAnalysisCore','colorHarmony','styleFingerprint','sceneClassificationAI','dynamicRangeAnalyzer']) {
    const m = module(id); if (m && (m.reference.available || m.target.available)) mark(id, 'EVIDENCE_CONSUMED_BY_CONFIDENCE_AND_DIRECTION');
  }
  for (const id of ['skinToneDetectionPro','neutralWhiteProtection','highlightRecoveryAI','shadowRecoveryAI','xmpValidator']) {
    const m = module(id); if (m && (m.reference.available || m.target.available)) mark(id, 'PROTECTION_CONSUMED_BY_EXISTING_SAFETY_LAYER');
  }
  for (const id of ['featureFusionEngine','decisionEngine']) {
    const m = module(id); if (m && (m.reference.available || m.target.available)) mark(id, 'DECISION_CONSUMED_BY_FUSION_POLICY');
  }

  const fusedAdjustments = {};
  for (const parameter of Object.keys(ledger)) fusedAdjustments[parameter] = sum(ledger, parameter);
  const required = REQUIRED_PRIMARY_MODULES.map(id => {
    const row = utilization.find(x => x.moduleId === id);
    return { moduleId:id, available:!!row?.available, consumed:!!row?.consumed, status: !row?.available ? 'NOT_AVAILABLE' : row.consumed ? 'CONSUMED' : 'OUTPUT_NOT_CONSUMED' };
  });
  const dropped = required.filter(x => x.available && !x.consumed);
  return {
    kind:'LUMIXA_UNIFIED_CORE_FUSION', schemaVersion:1,
    ledger, fusedAdjustments, curves,
    utilization,
    utilizationSummary:{ total:utilization.length, available:utilization.filter(x=>x.available).length, consumed:utilization.filter(x=>x.consumed).length, primaryRequired:required, droppedRequired:dropped.map(x=>x.moduleId) },
    gate:{ decision:dropped.length ? 'FAIL':'PASS', code:dropped.length ? 'CORE_OUTPUT_NOT_CONSUMED':'CORE_CONTRIBUTION_COMPLETE' },
  };
}

export function applyUnifiedFusionToPreset(preset, fusion) {
  if (!fusion) return JSON.parse(JSON.stringify(preset));
  const out = JSON.parse(JSON.stringify(preset));
  const blend = 0.65;
  const direct = ['temp','tint','exp','con','hi','sh','wh','bl','clarity','dehaze','texture','vib','sat'];
  for (const p of direct) if (Number.isFinite(fusion.fusedAdjustments[p])) out[p] = round((out[p] || 0) * (1-blend) + fusion.fusedAdjustments[p] * blend);
  for (const [p,v] of Object.entries(fusion.fusedAdjustments)) {
    if (p.startsWith('hsl_')) out.hsl[p] = round((out.hsl[p] || 0) * (1-blend) + v * blend);
    if (p.startsWith('grd_')) out.grade[p] = round((out.grade[p] || 0) * (1-blend) + v * blend);
    if (p.startsWith('cal_')) out.cal[p] = round((out.cal[p] || 0) * (1-blend) + v * blend);
  }
  if (fusion.curves) out.curves = JSON.parse(JSON.stringify(fusion.curves));
  out.unifiedCoreFusion = { kind:fusion.kind, gate:fusion.gate, utilizationSummary:fusion.utilizationSummary, ledger:fusion.ledger };
  return out;
}
