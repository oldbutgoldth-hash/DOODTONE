/**
 * EPIC 2E-P1D — XMP Readback Schema
 *
 * The normalized, adapted-from-spec shape a parsed XMP string is
 * reduced to before comparison. Pure data contract -- no parsing, no
 * comparison logic lives here. Adapted to the REAL serializer's
 * actual supported fields (see P1D_XMP_SERIALIZATION_AUDIT.md):
 * `profile.cameraProfile` and `profile.treatment` are always null --
 * the real serializer never emits either.
 */

export const READBACK_SCHEMA_VERSION = 'P1D_XMP_READBACK@1';

export const PARSE_STATUS = Object.freeze({
  NOT_RUN: 'NOT_RUN',
  OK: 'OK',
  PARSE_FAILED: 'PARSE_FAILED',
});

function _zeroHslGroup() {
  const g = {};
  for (const ch of ['red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'magenta']) g[ch] = null;
  return g;
}

function _emptyGradeZone() {
  return { hue: null, saturation: null, luminance: null };
}

/** A schema-valid, empty (nothing parsed yet) readback result. */
export function buildEmptyReadback() {
  return {
    schemaVersion: READBACK_SCHEMA_VERSION,
    parseStatus: PARSE_STATUS.NOT_RUN,
    sourceLength: 0,
    namespaces: { x: null, rdf: null, crs: null },
    profile: { name: null, treatment: null, processVersion: null, cameraProfile: null },
    whiteBalance: { mode: null, temperature: null, tint: null },
    basic: {
      exposure: null, contrast: null, highlights: null, shadows: null, whites: null, blacks: null,
      texture: null, clarity: null, dehaze: null, vibrance: null, saturation: null,
    },
    curves: { rgb: null, red: null, green: null, blue: null, parametric: { shadows: null, midtones: null, highlights: null } },
    hsl: { hue: _zeroHslGroup(), saturation: _zeroHslGroup(), luminance: _zeroHslGroup() },
    grading: { shadows: _emptyGradeZone(), midtones: _emptyGradeZone(), highlights: _emptyGradeZone(), blending: null, balance: null },
    cal: {
      shadowTint: null,
      redPrimaryHue: null, redPrimarySaturation: null,
      greenPrimaryHue: null, greenPrimarySaturation: null,
      bluePrimaryHue: null, bluePrimarySaturation: null,
    },
    detail: { sharpening: null, noiseReduction: null, colorNoiseReduction: null },
    effects: {},
    optics: {},
    missingProperties: [],
    unknownProperties: [],
    diagnostics: { parserWarnings: [], parserErrors: [] },
  };
}

function _isUnsafeNumber(v) {
  return typeof v === 'number' && (Number.isNaN(v) || !Number.isFinite(v));
}

/**
 * Reject undefined/NaN/Infinity anywhere in a readback value. Missing
 * fields must stay explicitly `null` (preserved missing-field
 * information), never `undefined` and never silently dropped.
 * @returns {string[]} errors (empty = safe)
 */
export function validateReadbackValue(value, path = 'readback') {
  const errors = [];
  const walk = (v, p) => {
    if (v === undefined) { errors.push(`undefined value at ${p}`); return; }
    if (_isUnsafeNumber(v)) { errors.push(`unsafe number (NaN/Infinity) at ${p}`); return; }
    if (v && typeof v === 'object') {
      if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${p}[${i}]`));
      else for (const k of Object.keys(v)) walk(v[k], `${p}.${k}`);
    }
  };
  walk(value, path);
  return errors;
}
