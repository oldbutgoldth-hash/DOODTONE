/**
 * EPIC 2E-P1C — Canonical Lightroom Auto-Tune Candidate: schema contract.
 *
 * Defines the stable, nested Candidate shape, its status/enum values,
 * and a pure structural validator. This module performs NO analysis
 * and reads no Session/evidence — it only describes and checks shape.
 *
 * Field surface note: the real XMP mapper (core/preset-engine's
 * serializeXMP + core/xmp-validator) supports a specific, audited
 * subset of the fields the spec's illustrative contract lists — see
 * P1C_LIGHTROOM_PARAMETER_CONTRACT.md and
 * P1C_CANDIDATE_SOURCE_LINEAGE_AUDIT.md §12. Groups/fields the current
 * Production pipeline does not produce (detail.radius/detail/masking/
 * noiseReductionDetail/colorNoiseReductionDetail/
 * colorNoiseReductionSmoothness, all of `effects`, all of `optics`,
 * `grading.balance`, `cal.shadowTint`) remain structurally present but
 * are always `null` — never a fabricated value — and are documented as
 * unsupported rather than silently omitted.
 */

export const CANDIDATE_SCHEMA_VERSION = 'P1C_CANDIDATE@1';

export const CANDIDATE_STATUS = Object.freeze({
  EMPTY: 'EMPTY',
  BUILDING: 'BUILDING',
  AUTO_GENERATED: 'AUTO_GENERATED',
  VALID: 'VALID',
  VALID_WITH_WARNINGS: 'VALID_WITH_WARNINGS',
  INVALID: 'INVALID',
  USER_EDITED: 'USER_EDITED',
  STALE: 'STALE',
  FAILED: 'FAILED',
});

export const HSL_CHANNEL_IDS = Object.freeze(['red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'magenta']);
export const GRADING_ZONE_IDS = Object.freeze(['shadows', 'midtones', 'highlights']);
export const CAL_PRIMARY_IDS = Object.freeze(['red', 'green', 'blue']);

// Fields the real Production pipeline does not currently produce.
// Always null on a built Candidate — listed here once so builder,
// validator, and docs stay in sync with a single source of truth.
export const UNSUPPORTED_FIELD_PATHS = Object.freeze([
  'detail.radius', 'detail.detail', 'detail.masking',
  'detail.noiseReductionDetail', 'detail.colorNoiseReductionDetail', 'detail.colorNoiseReductionSmoothness',
  'grading.balance', 'cal.shadowTint',
  'effects.postCropVignetteAmount', 'effects.postCropVignetteMidpoint', 'effects.postCropVignetteRoundness', 'effects.postCropVignetteFeather',
  'effects.grainAmount', 'effects.grainSize', 'effects.grainFrequency',
  'optics.removeChromaticAberration', 'optics.enableProfileCorrections', 'optics.distortion', 'optics.vignette',
]);

function _zeroHslGroup() {
  const g = {};
  for (const ch of HSL_CHANNEL_IDS) g[ch] = 0;
  return g;
}

function _zeroGradeZone() {
  return { hue: 0, saturation: 0, luminance: 0 };
}

/** A schema-valid, empty (no values yet computed) Candidate. */
export function createEmptyCandidate({ sessionId = null, generationId = null, candidateId = null } = {}) {
  return {
    candidateId,
    sessionId,
    generationId,
    schemaVersion: CANDIDATE_SCHEMA_VERSION,
    status: CANDIDATE_STATUS.EMPTY,
    createdAt: null,
    updatedAt: null,
    revision: 0,
    profile: { name: null, treatment: 'Color', processVersion: '11.0' },
    whiteBalance: { mode: 'Custom', temperature: 0, tint: 0 },
    basic: {
      exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0,
      texture: 0, clarity: 0, dehaze: 0, vibrance: 0, saturation: 0,
    },
    curves: {
      rgb: null, red: null, green: null, blue: null,
      parametric: { shadows: 0, midtones: 0, highlights: 0 },
    },
    hsl: { hue: _zeroHslGroup(), saturation: _zeroHslGroup(), luminance: _zeroHslGroup() },
    grading: {
      shadows: _zeroGradeZone(), midtones: _zeroGradeZone(), highlights: _zeroGradeZone(),
      blending: 50, balance: null,
    },
    cal: {
      shadowTint: null,
      redPrimaryHue: 0, redPrimarySaturation: 0,
      greenPrimaryHue: 0, greenPrimarySaturation: 0,
      bluePrimaryHue: 0, bluePrimarySaturation: 0,
    },
    detail: {
      sharpening: 0, radius: null, detail: null, masking: null,
      noiseReduction: 0, noiseReductionDetail: null,
      colorNoiseReduction: 25, colorNoiseReductionDetail: null, colorNoiseReductionSmoothness: null,
    },
    effects: {
      postCropVignetteAmount: null, postCropVignetteMidpoint: null,
      postCropVignetteRoundness: null, postCropVignetteFeather: null,
      grainAmount: null, grainSize: null, grainFrequency: null,
    },
    optics: {
      removeChromaticAberration: null, enableProfileCorrections: null,
      distortion: null, vignette: null,
    },
    metadata: { sourceFilename: null, generatedBy: 'LUMIXA AI', engineVersion: null, profileVersion: null },
    diagnostics: {
      confidence: { score: null, level: 'UNAVAILABLE' },
      sourceEvidence: [],
      safetyClamps: [],
      warnings: [],
      manualEdits: { changedParameters: [], revision: 0, lastEditedAt: null },
      lineage: {},
      autoValues: null,
      // EPIC 2E-P1E — additive-only field. Holds the diagnostics object
      // returned by applyColorIntelligence() (see
      // core/single-image/color-intelligence/color-intelligence-engine.js)
      // describing what the Color Intelligence layer did/did not change
      // and why. null until candidate-builder.js runs it; never read by
      // any pre-P1E code path, so its absence/presence cannot break
      // existing validation or serialization.
      colorIntelligence: null,
      // EPIC 2E-P1E R3 — additive-only field. Holds computeExportParity()'s
      // summary (core/single-image/candidate/candidate-export-parity.js):
      // whether this Candidate's own current color values already
      // satisfy quickSafetyClamp()'s export-time thresholds, and the
      // exact before/after of any field that would be adjusted at
      // export. null until single-image-orchestrator.js's
      // buildAndCommitCandidate() computes it; never read by any
      // pre-R3 code path.
      exportParity: null,
    },
  };
}

// ─── Validation ──────────────────────────────────────────────────────

function _isUnsafeNumber(v) {
  return typeof v === 'number' && (Number.isNaN(v) || !Number.isFinite(v));
}

/**
 * Deep-walk for undefined/NaN/Infinity and genuine circular references
 * (ancestor-path tracking, matching the P1B report schema validator's
 * fixed algorithm — a value legitimately shared across two branches is
 * NOT circular).
 */
function _walkForUnsafeValues(value, path, errors, seen) {
  if (value === undefined) { errors.push(`undefined value at ${path}`); return; }
  if (_isUnsafeNumber(value)) { errors.push(`unsafe number (NaN/Infinity) at ${path}`); return; }
  const t = typeof value;
  if (t === 'object' && value !== null) {
    if (seen.has(value)) { errors.push(`circular reference at ${path}`); return; }
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach((v, i) => _walkForUnsafeValues(v, `${path}[${i}]`, errors, seen));
    } else {
      for (const k of Object.keys(value)) _walkForUnsafeValues(value[k], `${path}.${k}`, errors, seen);
    }
    seen.delete(value);
  }
}

const REQUIRED_TOP_LEVEL_GROUPS = [
  'profile', 'whiteBalance', 'basic', 'curves', 'hsl', 'grading', 'cal',
  'detail', 'effects', 'optics', 'metadata', 'diagnostics',
];

function _requireHslGroup(hslSub, groupName, errors) {
  if (!hslSub || typeof hslSub !== 'object') { errors.push(`hsl.${groupName} missing`); return; }
  for (const ch of HSL_CHANNEL_IDS) {
    if (typeof hslSub[ch] !== 'number') errors.push(`hsl.${groupName}.${ch} must be a number`);
  }
}

function _requireGradeZone(zone, zoneName, errors) {
  if (!zone || typeof zone !== 'object') { errors.push(`grading.${zoneName} missing`); return; }
  for (const f of ['hue', 'saturation', 'luminance']) {
    if (typeof zone[f] !== 'number') errors.push(`grading.${zoneName}.${f} must be a number`);
  }
}

function _validCurvePoints(points, label, errors) {
  if (points === null) return; // legitimately unavailable — not an error
  if (!Array.isArray(points)) { errors.push(`${label} must be an array or null`); return; }
  let lastX = -Infinity;
  points.forEach((pt, i) => {
    if (!pt || typeof pt.x !== 'number' || typeof pt.y !== 'number') {
      errors.push(`${label}[${i}] must be {x,y} numbers`); return;
    }
    if (pt.x < 0 || pt.x > 255 || pt.y < 0 || pt.y > 255) errors.push(`${label}[${i}] out of [0,255] range`);
    if (pt.x < lastX) errors.push(`${label} points must be x-ordered (violated at index ${i})`);
    lastX = pt.x;
  });
}

/**
 * Structural validation only — no formula/range tuning happens here
 * beyond checking against the Candidate Validator's already-audited
 * ranges (see candidate-validator.js, which calls this first).
 * @returns {{status:string, errors:string[], warnings:string[], normalizedCandidate:object|null}}
 */
export function validateCandidateShape(candidate) {
  const errors = [];
  const warnings = [];

  if (!candidate || typeof candidate !== 'object') {
    return { status: CANDIDATE_STATUS.INVALID, errors: ['candidate is not an object'], warnings, normalizedCandidate: null };
  }
  if (!candidate.candidateId) errors.push('candidateId missing');
  if (!candidate.sessionId) errors.push('sessionId missing');
  if (candidate.generationId === null || candidate.generationId === undefined) errors.push('generationId missing');
  if (candidate.schemaVersion !== CANDIDATE_SCHEMA_VERSION) errors.push(`schemaVersion mismatch: ${candidate.schemaVersion}`);
  if (!Object.values(CANDIDATE_STATUS).includes(candidate.status)) errors.push(`invalid status: ${candidate.status}`);

  for (const g of REQUIRED_TOP_LEVEL_GROUPS) {
    if (!(g in candidate) || candidate[g] === undefined) errors.push(`required group "${g}" missing`);
  }

  if (candidate.hsl) {
    _requireHslGroup(candidate.hsl.hue, 'hue', errors);
    _requireHslGroup(candidate.hsl.saturation, 'saturation', errors);
    _requireHslGroup(candidate.hsl.luminance, 'luminance', errors);
  }
  if (candidate.grading) {
    for (const zone of GRADING_ZONE_IDS) _requireGradeZone(candidate.grading[zone], zone, errors);
    if (typeof candidate.grading.blending !== 'number') errors.push('grading.blending must be a number');
  }
  if (candidate.curves) {
    _validCurvePoints(candidate.curves.rgb, 'curves.rgb', errors);
    _validCurvePoints(candidate.curves.red, 'curves.red', errors);
    _validCurvePoints(candidate.curves.green, 'curves.green', errors);
    _validCurvePoints(candidate.curves.blue, 'curves.blue', errors);
    if (!candidate.curves.parametric) errors.push('curves.parametric missing');
  }
  if (candidate.cal) {
    for (const prim of CAL_PRIMARY_IDS) {
      if (typeof candidate.cal[`${prim}PrimaryHue`] !== 'number') errors.push(`cal.${prim}PrimaryHue must be a number`);
      if (typeof candidate.cal[`${prim}PrimarySaturation`] !== 'number') errors.push(`cal.${prim}PrimarySaturation must be a number`);
    }
  }
  if (candidate.profile && typeof candidate.profile.processVersion !== 'string') errors.push('profile.processVersion must be a string');
  if (candidate.metadata) {
    try { JSON.stringify(candidate.metadata); } catch { errors.push('metadata not serializable'); }
  }
  if (candidate.diagnostics) {
    try { JSON.stringify(candidate.diagnostics); } catch { errors.push('diagnostics not serializable'); }
    if (candidate.diagnostics.confidence) {
      const s = candidate.diagnostics.confidence.score;
      if (s !== null && (typeof s !== 'number' || s < 0 || s > 100)) errors.push('diagnostics.confidence.score must be null or 0-100');
    }
  }

  const seen = new Set();
  _walkForUnsafeValues(candidate, 'candidate', errors, seen);

  const status = errors.length > 0
    ? CANDIDATE_STATUS.INVALID
    : (warnings.length > 0 ? CANDIDATE_STATUS.VALID_WITH_WARNINGS : CANDIDATE_STATUS.VALID);

  return { status, errors, warnings, normalizedCandidate: errors.length === 0 ? candidate : null };
}

/**
 * Normalize a partially-built Candidate: fills any missing numeric leaf
 * with 0 (never with a non-zero fabricated value) so downstream code
 * never sees `undefined`. Does not touch fields already present.
 */
export function normalizeCandidate(candidate) {
  const c = candidate;
  for (const ch of HSL_CHANNEL_IDS) {
    c.hsl.hue[ch] = c.hsl.hue[ch] ?? 0;
    c.hsl.saturation[ch] = c.hsl.saturation[ch] ?? 0;
    c.hsl.luminance[ch] = c.hsl.luminance[ch] ?? 0;
  }
  for (const zone of GRADING_ZONE_IDS) {
    c.grading[zone].hue = c.grading[zone].hue ?? 0;
    c.grading[zone].saturation = c.grading[zone].saturation ?? 0;
    c.grading[zone].luminance = c.grading[zone].luminance ?? 0;
  }
  c.grading.blending = c.grading.blending ?? 50;
  c.curves.parametric.shadows = c.curves.parametric.shadows ?? 0;
  c.curves.parametric.midtones = c.curves.parametric.midtones ?? 0;
  c.curves.parametric.highlights = c.curves.parametric.highlights ?? 0;
  return c;
}
