/**
 * core/curve-engine/index.js
 *
 * Tone Curve engine — Bezier spline interpolation over control points.
 *
 * Lightroom uses a Parametric + Point curve system.
 * This engine handles the Point Curve (ToneCurvePV2012) which maps
 * input luminance → output luminance via a Catmull-Rom spline through
 * user-defined control points.
 *
 * Public API
 * ──────────
 *   defaultCurve(channel?)         → CurveState
 *   curveFromPreset(preset)        → { master, red, green, blue }
 *   evaluateCurve(points, x)       → y ∈ [0,255]
 *   buildLUT(points)               → Uint8Array[256]
 *   serializeCurvePoints(points)   → XMP point string  "0,0,64,70,..."
 *   parseCurvePoints(str)          → Point[]
 *   scenePreset(category)          → { master, red, green, blue }
 */

import { clamp } from '../color-engine/index.js';

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * @typedef {{ x: number, y: number }} Point   both ∈ [0, 255]
 * @typedef {Point[]}                  CurvePoints
 * @typedef {{ master: CurvePoints, red: CurvePoints, green: CurvePoints, blue: CurvePoints }} CurveSet
 */

// ─── Defaults ─────────────────────────────────────────────────────────────────

/** Linear (identity) curve — two anchor points only */
export const LINEAR_CURVE = [{ x: 0, y: 0 }, { x: 255, y: 255 }];

/** Default curve for each channel */
export function defaultCurve() {
  return [{ x: 0, y: 0 }, { x: 255, y: 255 }];
}

/** Full default CurveSet (all linear) */
export function defaultCurveSet() {
  return {
    master: defaultCurve(),
    red:    defaultCurve(),
    green:  defaultCurve(),
    blue:   defaultCurve(),
  };
}

// ─── Scene presets ────────────────────────────────────────────────────────────

const SCENE_CURVES = {
  Portrait: {
    master: [
      { x: 0,   y: 8   },   // lift blacks slightly
      { x: 64,  y: 70  },   // open shadows
      { x: 128, y: 130 },   // gentle midtone lift
      { x: 192, y: 195 },   // mild highlight roll-off
      { x: 255, y: 248 },   // protect highlights
    ],
    red:   [{ x: 0, y: 5  }, { x: 128, y: 133 }, { x: 255, y: 253 }],
    green: [{ x: 0, y: 2  }, { x: 128, y: 128 }, { x: 255, y: 254 }],
    blue:  [{ x: 0, y: 0  }, { x: 128, y: 124 }, { x: 255, y: 248 }],
  },
  Wedding: {
    master: [
      { x: 0,   y: 10  },
      { x: 64,  y: 72  },
      { x: 128, y: 132 },
      { x: 192, y: 198 },
      { x: 255, y: 250 },
    ],
    red:   [{ x: 0, y: 8  }, { x: 128, y: 135 }, { x: 255, y: 255 }],
    green: [{ x: 0, y: 3  }, { x: 128, y: 128 }, { x: 255, y: 252 }],
    blue:  [{ x: 0, y: 0  }, { x: 128, y: 122 }, { x: 255, y: 245 }],
  },
  Landscape: {
    master: [
      { x: 0,   y: 0   },
      { x: 64,  y: 58  },   // deeper shadows
      { x: 128, y: 128 },
      { x: 192, y: 200 },   // punch highlights
      { x: 255, y: 255 },
    ],
    red:   [{ x: 0, y: 0  }, { x: 128, y: 128 }, { x: 255, y: 252 }],
    green: [{ x: 0, y: 2  }, { x: 128, y: 130 }, { x: 255, y: 255 }],
    blue:  [{ x: 0, y: 5  }, { x: 128, y: 132 }, { x: 255, y: 255 }],
  },
  Travel: {
    master: [
      { x: 0,   y: 5   },
      { x: 64,  y: 66  },
      { x: 128, y: 130 },
      { x: 192, y: 196 },
      { x: 255, y: 253 },
    ],
    red:   [{ x: 0, y: 3  }, { x: 128, y: 130 }, { x: 255, y: 254 }],
    green: [{ x: 0, y: 2  }, { x: 128, y: 128 }, { x: 255, y: 253 }],
    blue:  [{ x: 0, y: 0  }, { x: 128, y: 125 }, { x: 255, y: 250 }],
  },
  General: {
    master: [
      { x: 0,   y: 4   },
      { x: 64,  y: 68  },
      { x: 128, y: 130 },
      { x: 192, y: 194 },
      { x: 255, y: 252 },
    ],
    red:   defaultCurve(),
    green: defaultCurve(),
    blue:  defaultCurve(),
  },
};

/** Get scene-aware curve preset */
export function scenePreset(category) {
  return SCENE_CURVES[category] ?? SCENE_CURVES.General;
}

// ─── Catmull-Rom spline evaluation ───────────────────────────────────────────

/**
 * Evaluate the curve at a given input x using Catmull-Rom interpolation.
 * Points must be sorted by x ascending.
 *
 * @param {CurvePoints} pts   sorted control points
 * @param {number}      x     input value ∈ [0, 255]
 * @returns {number}          output value ∈ [0, 255]
 */
export function evaluateCurve(pts, x) {
  if (pts.length < 2) return x;
  if (x <= pts[0].x) return pts[0].y;
  if (x >= pts[pts.length - 1].x) return pts[pts.length - 1].y;

  // Find segment
  let i = 1;
  while (i < pts.length - 1 && pts[i].x < x) i++;
  const p0 = pts[Math.max(0, i - 2)];
  const p1 = pts[i - 1];
  const p2 = pts[i];
  const p3 = pts[Math.min(pts.length - 1, i + 1)];

  const t = (x - p1.x) / (p2.x - p1.x || 1);
  return clamp(Math.round(_catmullRom(p0.y, p1.y, p2.y, p3.y, t)), 0, 255);
}

/** Catmull-Rom basis */
function _catmullRom(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (
    (2 * p1) +
    (-p0 + p2) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
    (-p0 + 3 * p1 - 3 * p2 + p3) * t3
  );
}

// ─── LUT ─────────────────────────────────────────────────────────────────────

/**
 * Build a 256-entry Look-Up Table for the curve.
 * @param {CurvePoints} pts
 * @returns {Uint8Array}
 */
export function buildLUT(pts) {
  const lut = new Uint8Array(256);
  for (let i = 0; i < 256; i++) lut[i] = evaluateCurve(pts, i);
  return lut;
}

/**
 * EPIC 2E-P0.8A — high-resolution FLOAT curve evaluation, additive to the
 * 256-entry integer `buildLUT`/`evaluateCurve` pair above (those are kept
 * byte-for-byte unchanged for their existing callers — the Tone Curve AI
 * engine and the interactive curve editor UI, both of which legitimately
 * want an 8-bit-indexed integer table for on-screen editing).
 *
 * `buildLUT`'s 256-entry `Uint8Array` rounds every sample to an integer
 * (`evaluateCurve` itself calls `Math.round`), and a caller that then
 * indexes it with `Math.round(x)` performs a SECOND independent rounding.
 * Chaining two of these (e.g. a per-channel curve feeding a master curve)
 * quantizes twice before any other pixel math has even happened — the
 * exact "small-step LUT, no interpolation" pattern the P0.8A spec calls
 * out as a posterization risk. `buildFloatLUT`/`sampleFloatLUT` replace
 * that with a >=1024-entry Float32 table plus linear interpolation
 * between neighbouring samples, so a curve lookup never introduces a
 * hard integer step of its own — any remaining stepping is only the
 * curve's own shape, sampled far finer than the eventual 8-bit output.
 */
export const FLOAT_LUT_RESOLUTION = 1024;

/**
 * @param {CurvePoints} pts
 * @param {number} [resolution]
 * @returns {Float32Array} `resolution`-entry table spanning input x ∈ [0,255]
 */
export function buildFloatLUT(pts, resolution = FLOAT_LUT_RESOLUTION) {
  const n = Math.max(2, resolution | 0);
  const lut = new Float32Array(n);
  const step = 255 / (n - 1);
  for (let i = 0; i < n; i++) {
    lut[i] = _evaluateCurveFloat(pts, i * step);
  }
  return lut;
}

/**
 * Sample a `buildFloatLUT` table at a continuous float x ∈ [0,255] using
 * linear interpolation between the two nearest table entries. Never
 * rounds the input, never rounds the output — the caller decides when
 * (if ever) to quantize.
 * @param {Float32Array} lut
 * @param {number} x
 * @returns {number} y ∈ [0,255], float
 */
export function sampleFloatLUT(lut, x) {
  const n = lut.length;
  const step = 255 / (n - 1);
  const pos = clamp(x, 0, 255) / step;
  const i0 = Math.floor(pos);
  const i1 = Math.min(n - 1, i0 + 1);
  const t = pos - i0;
  const y0 = lut[i0] ?? lut[n - 1];
  const y1 = lut[i1] ?? lut[n - 1];
  return y0 + (y1 - y0) * t;
}

/**
 * Same Catmull-Rom evaluation as `evaluateCurve`, but returns a raw float
 * (no `Math.round`, no integer clamp) — the private core `buildFloatLUT`
 * samples from. Not exported directly; go through `buildFloatLUT` +
 * `sampleFloatLUT` so every caller shares one precomputed table per
 * curve instead of re-walking control points per pixel.
 */
function _evaluateCurveFloat(pts, x) {
  if (pts.length < 2) return x;
  if (x <= pts[0].x) return pts[0].y;
  if (x >= pts[pts.length - 1].x) return pts[pts.length - 1].y;
  let i = 1;
  while (i < pts.length - 1 && pts[i].x < x) i++;
  const p0 = pts[Math.max(0, i - 2)];
  const p1 = pts[i - 1];
  const p2 = pts[i];
  const p3 = pts[Math.min(pts.length - 1, i + 1)];
  const t = (x - p1.x) / (p2.x - p1.x || 1);
  return clamp(_catmullRom(p0.y, p1.y, p2.y, p3.y, t), 0, 255);
}

// ─── XMP serialisation ────────────────────────────────────────────────────────

/**
 * Serialize control points to Lightroom XMP format.
 * e.g. "0, 0, 64, 72, 128, 130, 255, 252"
 * @param {CurvePoints} pts
 * @returns {string}
 */
export function serializeCurvePoints(pts) {
  return pts.map(p => `${Math.round(p.x)}, ${Math.round(p.y)}`).join(', ');
}

/**
 * Parse XMP curve string back to Point array.
 * @param {string} str
 * @returns {CurvePoints}
 */
export function parseCurvePoints(str) {
  const nums = str.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
  const pts  = [];
  for (let i = 0; i + 1 < nums.length; i += 2)
    pts.push({ x: clamp(nums[i], 0, 255), y: clamp(nums[i + 1], 0, 255) });
  return pts.length >= 2 ? pts : defaultCurve();
}

// ─── Utility ──────────────────────────────────────────────────────────────────

/**
 * Insert a control point into a sorted array (no duplicates within ±4 px).
 * @param {CurvePoints} pts
 * @param {Point}       pt
 * @returns {CurvePoints}  new sorted array
 */
export function insertPoint(pts, pt) {
  const filtered = pts.filter(p => Math.abs(p.x - pt.x) > 4);
  const next = [...filtered, { x: clamp(pt.x, 0, 255), y: clamp(pt.y, 0, 255) }];
  return next.sort((a, b) => a.x - b.x);
}

/**
 * Remove the control point nearest to (x, y), ignoring the two anchors (0 and 255).
 * @param {CurvePoints} pts
 * @param {number}      x
 * @param {number}      y
 * @returns {CurvePoints}
 */
export function removeNearestPoint(pts, x, y) {
  let best = -1, bestD = Infinity;
  for (let i = 0; i < pts.length; i++) {
    if (pts[i].x === 0 || pts[i].x === 255) continue;
    const d = (pts[i].x - x) ** 2 + (pts[i].y - y) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  if (best === -1) return pts;
  return pts.filter((_, i) => i !== best);
}

/**
 * Move an existing control point, clamping to canvas and honouring anchor rules.
 * @param {CurvePoints} pts
 * @param {number}      index
 * @param {number}      newX
 * @param {number}      newY
 * @returns {CurvePoints}
 */
export function movePoint(pts, index, newX, newY) {
  const next = pts.map((p, i) => {
    if (i !== index) return p;
    // Anchors (first / last) can only move Y
    if (i === 0)               return { x: 0,   y: clamp(newY, 0, 255) };
    if (i === pts.length - 1) return { x: 255, y: clamp(newY, 0, 255) };
    // Interior points: constrain x between neighbours
    const lo = pts[i - 1].x + 2;
    const hi = pts[i + 1].x - 2;
    return { x: clamp(Math.round(newX), lo, hi), y: clamp(Math.round(newY), 0, 255) };
  });
  return next;
}
