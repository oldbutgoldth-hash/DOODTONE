/**
 * core/single-image/tone-curve-intelligence/tone-curve-schema.js
 *
 * EPIC 2E-P1J — Tone Curve Intelligence & Point-Curve Export Wiring.
 *
 * Pure constants and shape helpers for the Tone Curve Plan. No
 * Session/DOM access, no Core analysis calls, no XMP knowledge --
 * mirrors core/single-image/basic-tone-intelligence/basic-tone-schema.js
 * and core/single-image/detail-intelligence/detail-schema.js in shape.
 *
 * ── Root cause this EPIC fixes (see P1J_TONE_CURVE_LINEAGE_AUDIT.md) ──
 * core/tone-curve-ai-engine/index.js::generateToneCurves() already
 * computes a real, sophisticated, per-photo point-curve recommendation
 * (histogram-derived S-curve master + per-channel R/G/B cast-correction
 * curves, confidence, warnings) on every analysis run. That result was
 * ALREADY being committed to `session.evidence.toneCurves` and used for
 * two things: (1) a decorative preview canvas, and (2) seeding the
 * OPTIONAL, separate manual Curve Editor widget (`state.curveEditor`).
 * It was NEVER read into the canonical Candidate --
 * `core/decision-engine/index.js::buildFinalPreset()` accepts
 * `toneCurves` purely as a confidence-model input and never assigns
 * `.curves` on the preset object it returns, so
 * `session.candidateRaw.curves` was always undefined, and
 * `candidate.curves.rgb/red/green/blue` were always null for every
 * AI-analyzed photo -- causing the real serializer's
 * `crs:ToneCurvePV2012*` export to always fall back to
 * `defaultCurveSet()` (a flat identity curve) regardless of the photo's
 * actual tonal content. This is the exact defect class
 * P1F_BASIC_VALUE_LINEAGE_AUDIT.md found and fixed for the Basic panel.
 *
 * ── Scope boundary (explicit, per project convention) ──────────────
 * This EPIC wires the POINT-curve arrays (master/red/green/blue) only
 * -- the ones `generateToneCurves()` actually computes and the real
 * serializer actually emits (`crs:ToneCurvePV2012[Red/Green/Blue]`,
 * confirmed in core/preset-engine/index.js). It does NOT touch
 * `candidate.curves.parametric` (shadows/midtones/highlights scalar
 * sliders) -- no existing engine computes parametric slider values,
 * inventing that math would violate reuse-first, and `0` (no
 * parametric override) is itself a legitimate, safe default distinct
 * from the point-curve null-fallback bug this EPIC fixes. See
 * P1J_TONE_CURVE_LINEAGE_AUDIT.md §5 for the full reasoning.
 */

export const TONE_CURVE_SCHEMA_VERSION = 'P1J_TONE_CURVE_PLAN@1';

/** Internal strength strategy names (architecture/extensibility -- no new user-facing panel this round). */
export const STRENGTH_MODE = Object.freeze({
  NATURAL: 'NATURAL',
  BALANCED: 'BALANCED',
  DRAMATIC: 'DRAMATIC',
});

export const DEFAULT_STRENGTH_MODE = STRENGTH_MODE.BALANCED;

/**
 * Per-mode scalar applied to how far each curve point is allowed to
 * move away from the neutral identity line (x===y) before this plan
 * restrains it back toward identity -- NOT applied inside
 * generateToneCurves() itself (that engine's own SCENE_INTENSITY
 * multipliers already shape the curve; this is an independent,
 * additive restraint layer, matching the two-layer-safety-net
 * convention used throughout this project). BALANCED=1.00 means "trust
 * the engine's own output fully, restrained only by the identity-
 * distance ceiling below."
 */
export const STRENGTH_SCALARS = Object.freeze({
  [STRENGTH_MODE.NATURAL]: 0.65,
  [STRENGTH_MODE.BALANCED]: 1.00,
  [STRENGTH_MODE.DRAMATIC]: 1.25,
});

/**
 * Local, independently-owned bounds (Layer A of the two-layer safety
 * net). Maximum |y - x| (vertical distance from the neutral identity
 * line) any single curve point may carry after this plan runs, before
 * quickSafetyClamp() (Layer B, added to xmp-validator by this same
 * EPIC) runs again at export time. Chosen conservatively: Lightroom's
 * own point-curve editor allows the full [0,255] range, but a
 * single-point deviation beyond this magnitude is far outside what any
 * scene-aware automatic recommendation should ever produce, and is far
 * more likely to indicate a confused/adversarial input than a genuine
 * creative curve.
 */
export const MAX_POINT_DEVIATION = 60;

/** Minimum evidence confidence (from generateToneCurves() itself) below which this plan does not engage at all -- falls back to null (identical to pre-P1J behavior), never forces a low-confidence curve onto the export. */
export const MIN_ENGAGEMENT_CONFIDENCE = 0.15;

export function buildEmptyToneCurvePlan() {
  return {
    schemaVersion: TONE_CURVE_SCHEMA_VERSION,
    strengthMode: DEFAULT_STRENGTH_MODE,
    confidence: null,
    category: null,
    finalValues: { master: null, red: null, green: null, blue: null },
    diagnostics: {
      engaged: false,
      reasons: ['No usable tone-curve evidence for this Session (generateToneCurves() evidence missing, soft-failed, or below the engagement-confidence floor) -- point-curve fields left null, matching pre-P1J behavior exactly.'],
      warnings: [],
      pointsRestrained: 0,
    },
    lineage: { sourceEngine: 'core/tone-curve-ai-engine/index.js', sourceFunction: 'generateToneCurves', evidenceKey: 'toneCurves' },
  };
}
