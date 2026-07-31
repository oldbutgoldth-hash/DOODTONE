const PRESET_FIELDS = [
  'exp', 'con', 'hi', 'sh', 'wh', 'bl', 'temp', 'tint', 'vib', 'sat',
  'clarity', 'dehaze', 'texture', 'sharp', 'noise',
  'curves',
];

const HSL_CHANNELS = ['red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'magenta'];
const HSL_AXES = ['h', 's', 'l'];
const GRADE_ZONES = ['sh', 'mid', 'hi'];
const GRADE_AXES = ['h', 's', 'l'];
const CAL_CHANNELS = ['red', 'green', 'blue'];
const CAL_AXES = ['h', 's'];

for (const ch of HSL_CHANNELS) for (const ax of HSL_AXES) PRESET_FIELDS.push(`hsl_${ax}_${ch}`);
for (const z of GRADE_ZONES) for (const ax of GRADE_AXES) PRESET_FIELDS.push(`grd_${z}_${ax}`);
PRESET_FIELDS.push('grd_blend');
for (const ch of CAL_CHANNELS) for (const ax of CAL_AXES) PRESET_FIELDS.push(`cal_${ch}_${ax}`);

const CANDIDATE_LAYER_KEYS = [
  'rawPreset', 'fusedPreset', 'safePreset',
  'candidateXmp', 'candidateXmpLength', 'exportReady',
  'xmpCodec', 'xmpReadback', 'directionGate', 'dataLineage',
  'transferEvidence', 'unifiedCoreFusion', 'reasonTrace',
  'fidelityContract', 'compatibilityProfile',
  'candidateState', 'stage', 'kind', 'schemaVersion',
  'analysisGenerationId', 'safetyAdjustments',
  'serializerPreset', 'production',
];

const LAYER_1_CORE = ['exp', 'con', 'hi', 'sh', 'wh', 'bl', 'temp', 'tint', 'vib', 'sat', 'curves'];
const LAYER_2_CORE = ['clarity', 'dehaze', 'texture', ...PRESET_FIELDS.filter(f => f.startsWith('hsl_') || f.startsWith('grd_') || f.startsWith('cal_')), 'grd_blend'];

export function normalizePreset(preset) {
  if (!preset || typeof preset !== 'object') preset = {};
  const out = {};
  for (const f of PRESET_FIELDS) {
    if (f === 'curves') {
      out.curves = preset.curves ? { master: preset.curves.master || [], red: preset.curves.red || [], green: preset.curves.green || [], blue: preset.curves.blue || [] } : null;
    } else {
      out[f] = preset[f] !== undefined ? preset[f] : 0;
    }
  }
  return out;
}

export function normalizeCandidate(candidate) {
  if (!candidate || typeof candidate !== 'object') return {};
  const out = { ...candidate };
  if (out.safePreset) out.safePreset = normalizePreset(out.safePreset);
  if (out.fusedPreset) out.fusedPreset = normalizePreset(out.fusedPreset);
  if (out.rawPreset) out.rawPreset = normalizePreset(out.rawPreset);
  return out;
}

export function validatePreset(preset) {
  if (!preset || typeof preset !== 'object') return { valid: false, errors: ['preset is null or non-object'] };
  const missing = PRESET_FIELDS.filter(f => preset[f] === undefined);
  return { valid: missing.length === 0, missing };
}

export function getLayer1Subset(candidate) {
  if (!candidate?.safePreset) return null;
  const subset = { ...candidate };
  subset.safePreset = { ...candidate.safePreset };
  for (const f of LAYER_2_CORE) delete subset.safePreset[f];
  for (const f of PRESET_FIELDS) if (!LAYER_1_CORE.includes(f)) delete subset.safePreset[f];
  return subset;
}

export function getLayer2Subset(candidate) {
  if (!candidate?.safePreset) return null;
  const subset = { ...candidate };
  subset.safePreset = { ...candidate.safePreset };
  for (const f of LAYER_1_CORE) delete subset.safePreset[f];
  return subset;
}

export function validateCandidate(candidate) {
  if (!candidate || typeof candidate !== 'object') return { valid: false, errors: ['candidate is null or non-object'], missing: CANDIDATE_LAYER_KEYS };
  const missing = CANDIDATE_LAYER_KEYS.filter(k => !(k in candidate));
  return { valid: missing.length === 0, missing };
}

export function markLayer(candidate, layer) {
  return { ...candidate, _pipelineLayer: layer };
}

export { PRESET_FIELDS, LAYER_1_CORE, LAYER_2_CORE, CANDIDATE_LAYER_KEYS };
