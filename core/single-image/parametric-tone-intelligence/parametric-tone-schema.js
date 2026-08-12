/**
 * core/single-image/parametric-tone-intelligence/parametric-tone-schema.js
 *
 * EPIC 2E-P1L — Parametric Tone Curve Intelligence.
 *
 * Pure constants and shape helpers for the Parametric Tone Plan. No
 * Session/DOM access, no Core analysis calls, no XMP knowledge --
 * mirrors core/single-image/tone-curve-intelligence/tone-curve-schema.js
 * in shape (same STRENGTH_MODE/SCALARS convention, same engagement-
 * confidence-floor pattern, same Layer-A-bound-then-Layer-B-clamp
 * two-layer safety net).
 *
 * ── Why this engine exists (see P1L_PARAMETRIC_TONE_ARCHITECTURE.md) ──
 * P1J deliberately left `candidate.curves.parametric` (the
 * `crv_sh`/`crv_mid`/`crv_hi` -> `crs:ParametricShadows/Midtones/
 * Highlights` Lightroom sliders) untouched: "no existing engine
 * computes parametric slider values, inventing that math would violate
 * reuse-first" (tone-curve-schema.js's own header comment). This EPIC
 * is the user-directed follow-up that builds that engine -- but still
 * reuse-first, NOT inventing fresh math from raw histogram stats.
 *
 * ── Reuse-first derivation ──────────────────────────────────────────
 * `core/tone-curve-ai-engine/index.js::generateToneCurves()` already
 * computes a real, per-photo, histogram-derived MASTER point-curve
 * (`_masterCurve()` -- 5 points at x=0/64/128/192/255) and this exact
 * result is already committed to `session.evidence.toneCurves` and
 * already read by `tone-curve-plan-builder.js` (P1J). Rather than
 * re-deriving shadow/midtone/highlight tonal judgments from raw
 * `stats` independently (a second, parallel, potentially-disagreeing
 * analysis of the same photo), this plan reads the ALREADY-COMPUTED
 * master curve's points and measures each point's vertical deviation
 * from the neutral identity line (y===x) at x=64 (shadows), x=128
 * (midtones), and x=192 (highlights) -- the exact same real,
 * already-tested photographic judgment `generateToneCurves()` already
 * made for the point-curve export, reused as the source signal for a
 * SECOND, DIFFERENT Lightroom control (the parametric sliders), not
 * duplicated math for the same one.
 */

export const PARAMETRIC_TONE_SCHEMA_VERSION = 'P1L_PARAMETRIC_TONE_PLAN@1';

/** Same 3-mode architecture as every other Intelligence layer -- no new user-facing panel this round (P1M's job). */
export const STRENGTH_MODE = Object.freeze({
  NATURAL: 'NATURAL',
  BALANCED: 'BALANCED',
  DRAMATIC: 'DRAMATIC',
});

export const DEFAULT_STRENGTH_MODE = STRENGTH_MODE.BALANCED;

export const STRENGTH_SCALARS = Object.freeze({
  [STRENGTH_MODE.NATURAL]: 0.65,
  [STRENGTH_MODE.BALANCED]: 1.00,
  [STRENGTH_MODE.DRAMATIC]: 1.25,
});

/**
 * Pixel-deviation-to-slider-unit scale factor. Calibrated from
 * `_buildSCurve()`'s own `clamp()` calls in tone-curve-ai-engine
 * (traced from source, never guessed): at x=64 the real output range
 * is `clamp(...,40,85)` -> deviation from identity (64) spans roughly
 * -24..+21; at x=128, `clamp(...,100,155)` -> deviation from identity
 * (128) spans roughly -28..+27; at x=192, `clamp(...,175,215)` ->
 * deviation from identity (192) spans roughly -17..+23. Typical
 * |deviation| therefore sits around 20-30 pixel units. A scale of 1.2
 * maps this onto a modest 24-36 slider-unit range at BALANCED (1.00x)
 * strength -- deliberately restrained, since the Parametric Tone Curve
 * sliders are a SECONDARY/fine-tuning control relative to the Basic
 * Panel (P1F) and the point-curve (P1J), never the primary style
 * driver (matches this project's "Basic Panel is a supporting signal,
 * never primary" philosophy, extended here to the even-more-secondary
 * parametric sliders).
 */
export const PIXEL_TO_SLIDER_SCALE = 1.2;

/**
 * Local, independently-owned bounds (Layer A). Comfortably above
 * BALANCED-mode's typical ~24-36 output (so ordinary auto-generated
 * Candidates are essentially never touched by this ceiling), catches
 * only DRAMATIC-mode outliers and adversarial/corrupted evidence.
 * Real Lightroom UI range is -100..100; this is a much tighter,
 * independently-chosen restraint, not the raw UI ceiling.
 */
export const MAX_PARAMETRIC_DEVIATION = 45;

/** Same engagement floor convention as tone-curve-schema.js -- below this, the plan does not engage at all (falls back to 0, the pre-P1L behavior's own safe default). */
export const MIN_ENGAGEMENT_CONFIDENCE = 0.15;

export function buildEmptyParametricTonePlan() {
  return {
    schemaVersion: PARAMETRIC_TONE_SCHEMA_VERSION,
    strengthMode: DEFAULT_STRENGTH_MODE,
    confidence: null,
    category: null,
    finalValues: { shadows: 0, midtones: 0, highlights: 0 },
    diagnostics: {
      engaged: false,
      reasons: ['No usable tone-curve evidence for this Session (generateToneCurves() evidence missing, soft-failed, or below the engagement-confidence floor) -- parametric fields left at 0 (no override), matching pre-P1L behavior.'],
      warnings: [],
      deviationsRestrained: 0,
    },
    lineage: {
      sourceEngine: 'core/tone-curve-ai-engine/index.js', sourceFunction: 'generateToneCurves',
      evidenceKey: 'toneCurves', derivedFrom: 'master.points deviation from identity at x=64/128/192',
    },
  };
}
