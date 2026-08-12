/**
 * core/single-image/parametric-tone-intelligence/parametric-tone-plan-builder.js
 *
 * EPIC 2E-P1L — Parametric Tone Curve Intelligence.
 *
 * Reads the REAL, already-computed `session.evidence.toneCurves`
 * result (same evidence key P1J's tone-curve-plan-builder.js already
 * reads) and derives `candidate.curves.parametric.{shadows,midtones,
 * highlights}` from the master point-curve's deviation from identity
 * at x=64/128/192 -- see parametric-tone-schema.js's header comment
 * for the full reuse-first rationale.
 *
 * Pure function: reads `evidence` (already computed upstream by the
 * existing pipeline), never calls a Core analysis module itself, never
 * touches the DOM, never mutates its input. Mirrors the architecture
 * of tone-curve-plan-builder.js exactly.
 */

import {
  PARAMETRIC_TONE_SCHEMA_VERSION, STRENGTH_SCALARS, DEFAULT_STRENGTH_MODE,
  PIXEL_TO_SLIDER_SCALE, MAX_PARAMETRIC_DEVIATION, MIN_ENGAGEMENT_CONFIDENCE,
  buildEmptyParametricTonePlan,
} from './parametric-tone-schema.js';

function _resultOf(evidence, key) {
  const entry = evidence?.[key];
  if (!entry || typeof entry !== 'object') return null;
  const usable = entry.status === 'COMPLETED' || entry.status === 'CACHE_HIT';
  return usable ? (entry.result ?? null) : null;
}

/** Nearest-x lookup, robust to any point count/arrangement (mirrors _clampToneCurvePanel()'s x-zone-based, not index-based, convention). */
function _pointNearX(points, targetX) {
  if (!Array.isArray(points) || points.length === 0) return null;
  let best = null, bestDist = Infinity;
  for (const pt of points) {
    if (!pt || typeof pt.x !== 'number' || typeof pt.y !== 'number' || !Number.isFinite(pt.x) || !Number.isFinite(pt.y)) continue;
    const dist = Math.abs(pt.x - targetX);
    if (dist < bestDist) { bestDist = dist; best = pt; }
  }
  return best;
}

/**
 * Deviation from identity (y - x) at the point nearest targetX,
 * converted to a bounded slider-unit delta. Returns 0 if no usable
 * point exists near targetX (fail-closed to "no override", never a
 * fabricated adjustment).
 */
function _sliderDelta(points, targetX, scale, maxDeviation) {
  const pt = _pointNearX(points, targetX);
  if (!pt) return { value: 0, engaged: false, rawDeviation: 0 };
  const rawDeviation = pt.y - pt.x;
  const scaled = rawDeviation * scale;
  const clamped = Math.max(-maxDeviation, Math.min(maxDeviation, Math.round(scaled)));
  return { value: clamped, engaged: clamped !== 0, rawDeviation, restrained: Math.abs(scaled) > maxDeviation };
}

/**
 * @param {object} evidence  session.evidence (read-only)
 * @param {{strengthMode?: string}} [opts]
 * @returns {object} the full Parametric Tone Plan
 */
export function buildParametricTonePlan(evidence, { strengthMode = DEFAULT_STRENGTH_MODE } = {}) {
  const toneCurves = _resultOf(evidence, 'toneCurves');
  if (!toneCurves || typeof toneCurves !== 'object') {
    return buildEmptyParametricTonePlan();
  }

  const confidence = Number.isFinite(toneCurves.confidence) ? toneCurves.confidence : 0;
  if (confidence < MIN_ENGAGEMENT_CONFIDENCE) {
    const empty = buildEmptyParametricTonePlan();
    empty.confidence = confidence;
    empty.category = toneCurves.category ?? null;
    empty.diagnostics.reasons = [`Tone-curve evidence confidence ${confidence.toFixed(3)} is below the engagement floor (${MIN_ENGAGEMENT_CONFIDENCE}) -- parametric fields left at 0 rather than force a low-confidence adjustment onto export.`];
    return empty;
  }

  const masterPoints = toneCurves.master?.points ?? null;
  if (!Array.isArray(masterPoints) || masterPoints.length < 2) {
    const empty = buildEmptyParametricTonePlan();
    empty.confidence = confidence;
    empty.category = toneCurves.category ?? null;
    empty.diagnostics.reasons = ['No valid master point-curve data from generateToneCurves() this run -- parametric fields left at 0.'];
    return empty;
  }

  const scalar = STRENGTH_SCALARS[strengthMode] ?? STRENGTH_SCALARS[DEFAULT_STRENGTH_MODE];
  const scale = PIXEL_TO_SLIDER_SCALE * scalar;
  const maxDeviation = MAX_PARAMETRIC_DEVIATION;

  const shadows = _sliderDelta(masterPoints, 64, scale, maxDeviation);
  const midtones = _sliderDelta(masterPoints, 128, scale, maxDeviation);
  const highlights = _sliderDelta(masterPoints, 192, scale, maxDeviation);

  const anyEngaged = shadows.engaged || midtones.engaged || highlights.engaged;
  const restrainedCount = [shadows, midtones, highlights].filter((d) => d.restrained).length;

  const reasons = [
    `Shadows: master curve deviation ${shadows.rawDeviation.toFixed(1)}px at x≈64 -> ${shadows.value} slider units${shadows.restrained ? ' (restrained to ceiling)' : ''}.`,
    `Midtones: master curve deviation ${midtones.rawDeviation.toFixed(1)}px at x≈128 -> ${midtones.value} slider units${midtones.restrained ? ' (restrained to ceiling)' : ''}.`,
    `Highlights: master curve deviation ${highlights.rawDeviation.toFixed(1)}px at x≈192 -> ${highlights.value} slider units${highlights.restrained ? ' (restrained to ceiling)' : ''}.`,
  ];

  return {
    schemaVersion: PARAMETRIC_TONE_SCHEMA_VERSION,
    strengthMode,
    confidence,
    category: toneCurves.category ?? null,
    finalValues: { shadows: shadows.value, midtones: midtones.value, highlights: highlights.value },
    diagnostics: {
      engaged: anyEngaged,
      reasons,
      warnings: Array.isArray(toneCurves.warnings) ? [...toneCurves.warnings] : [],
      deviationsRestrained: restrainedCount,
    },
    lineage: {
      sourceEngine: 'core/tone-curve-ai-engine/index.js', sourceFunction: 'generateToneCurves',
      evidenceKey: 'toneCurves', derivedFrom: 'master.points deviation from identity at x=64/128/192',
    },
  };
}
