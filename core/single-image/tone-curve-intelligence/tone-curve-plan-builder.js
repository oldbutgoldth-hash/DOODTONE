/**
 * core/single-image/tone-curve-intelligence/tone-curve-plan-builder.js
 *
 * EPIC 2E-P1J — Tone Curve Intelligence & Point-Curve Export Wiring.
 *
 * Reads the REAL, already-computed `session.evidence.toneCurves`
 * result (core/tone-curve-ai-engine/index.js::generateToneCurves(),
 * unchanged, reuse-first) and produces a stable Tone Curve Plan whose
 * `finalValues.master/red/green/blue` are the exact point arrays
 * `candidate-builder.js` should write into `candidate.curves.rgb/red/
 * green/blue` — this is the fix for the root cause documented in
 * tone-curve-schema.js's header comment.
 *
 * Pure function: reads `evidence` (already computed upstream by the
 * existing pipeline), never calls a Core analysis module itself, never
 * touches the DOM, never mutates its input. Mirrors the architecture
 * of core/single-image/basic-tone-intelligence/basic-tone-plan-builder.js.
 */

import {
  TONE_CURVE_SCHEMA_VERSION, STRENGTH_SCALARS, DEFAULT_STRENGTH_MODE,
  MAX_POINT_DEVIATION, MIN_ENGAGEMENT_CONFIDENCE, buildEmptyToneCurvePlan,
} from './tone-curve-schema.js';

function _resultOf(evidence, key) {
  const entry = evidence?.[key];
  if (!entry || typeof entry !== 'object') return null;
  const usable = entry.status === 'COMPLETED' || entry.status === 'CACHE_HIT';
  return usable ? (entry.result ?? null) : null;
}

/** Structural validation identical in spirit to candidate-schema.js's own _validCurvePoints -- a plan must never hand candidate-builder.js a shape the Candidate validator would reject. */
function _isValidPointArray(points) {
  if (!Array.isArray(points) || points.length < 2) return false;
  let lastX = -Infinity;
  for (const pt of points) {
    if (!pt || typeof pt.x !== 'number' || typeof pt.y !== 'number') return false;
    if (!Number.isFinite(pt.x) || !Number.isFinite(pt.y)) return false;
    if (pt.x < 0 || pt.x > 255 || pt.y < 0 || pt.y > 255) return false;
    if (pt.x < lastX) return false;
    lastX = pt.x;
  }
  return true;
}

/**
 * Restrain each point's deviation from the identity line (x===y) to
 * at most `maxDeviation`, scaled by the plan's strength multiplier --
 * the independent Layer-A safety net documented in tone-curve-schema.js.
 * Never changes point count or x-ordering; only pulls an extreme y
 * value back toward x.
 *
 * @returns {{points: {x:number,y:number}[], restrainedCount: number}}
 */
function _restrainTowardIdentity(points, maxDeviation) {
  let restrainedCount = 0;
  const restrained = points.map((pt) => {
    const deviation = pt.y - pt.x;
    if (Math.abs(deviation) <= maxDeviation) return { x: pt.x, y: pt.y };
    restrainedCount++;
    const clampedDeviation = Math.sign(deviation) * maxDeviation;
    const y = Math.max(0, Math.min(255, pt.x + clampedDeviation));
    return { x: pt.x, y };
  });
  return { points: restrained, restrainedCount };
}

/**
 * @param {object} evidence  session.evidence (read-only)
 * @param {{strengthMode?: string}} [opts]
 * @returns {object} the full Tone Curve Plan
 */
export function buildToneCurvePlan(evidence, { strengthMode = DEFAULT_STRENGTH_MODE } = {}) {
  const toneCurves = _resultOf(evidence, 'toneCurves');
  if (!toneCurves || typeof toneCurves !== 'object') {
    return buildEmptyToneCurvePlan();
  }

  const confidence = Number.isFinite(toneCurves.confidence) ? toneCurves.confidence : 0;
  if (confidence < MIN_ENGAGEMENT_CONFIDENCE) {
    const empty = buildEmptyToneCurvePlan();
    empty.confidence = confidence;
    empty.category = toneCurves.category ?? null;
    empty.diagnostics.reasons = [`Tone-curve evidence confidence ${confidence.toFixed(3)} is below the engagement floor (${MIN_ENGAGEMENT_CONFIDENCE}) -- point-curve fields left null rather than force a low-confidence curve onto export.`];
    return empty;
  }

  const scalar = STRENGTH_SCALARS[strengthMode] ?? STRENGTH_SCALARS[DEFAULT_STRENGTH_MODE];
  const maxDeviation = MAX_POINT_DEVIATION * scalar;

  const channels = { master: toneCurves.master, red: toneCurves.red, green: toneCurves.green, blue: toneCurves.blue };
  const finalValues = { master: null, red: null, green: null, blue: null };
  const reasons = [];
  const warnings = Array.isArray(toneCurves.warnings) ? [...toneCurves.warnings] : [];
  let totalRestrained = 0;
  let anyEngaged = false;

  for (const [name, channelResult] of Object.entries(channels)) {
    const rawPoints = channelResult?.points ?? null;
    if (!_isValidPointArray(rawPoints)) {
      reasons.push(`${name}: no valid point-curve data from generateToneCurves() this run -- left null.`);
      continue;
    }
    const { points, restrainedCount } = _restrainTowardIdentity(rawPoints, maxDeviation);
    finalValues[name] = points;
    anyEngaged = true;
    totalRestrained += restrainedCount;
    const restraintNote = restrainedCount > 0 ? ` (${restrainedCount} point(s) restrained toward identity, exceeded ±${maxDeviation.toFixed(0)})` : '';
    reasons.push(`${name}: ${channelResult.reason ?? 'point curve applied'}${restraintNote}`);
  }

  return {
    schemaVersion: TONE_CURVE_SCHEMA_VERSION,
    strengthMode,
    confidence,
    category: toneCurves.category ?? null,
    finalValues,
    diagnostics: {
      engaged: anyEngaged,
      reasons,
      warnings,
      pointsRestrained: totalRestrained,
    },
    lineage: { sourceEngine: 'core/tone-curve-ai-engine/index.js', sourceFunction: 'generateToneCurves', evidenceKey: 'toneCurves' },
  };
}
