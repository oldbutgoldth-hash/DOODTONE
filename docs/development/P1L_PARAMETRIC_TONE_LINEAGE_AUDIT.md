# EPIC 2E-P1L — Parametric Tone Curve Lineage Audit

## Scope

Before P1L, the Adobe Camera Raw Parametric Tone Curve sliders
(`crs:ParametricShadows`, `crs:ParametricMidtones`, `crs:ParametricHighlights`
— flat legacy-preset keys `crv_sh`, `crv_mid`, `crv_hi`) had **no engine**.
Their only source was a static hardcoded fallback in `index.html`'s hidden
inputs (`crv_sh=5`, `crv_mid=10`, `crv_hi=15`), read by `ui/app.js` and
carried through unchanged regardless of the analyzed photo.

Grep of `core/*/index.js` and `core/single-image/**` before this round
confirmed: no function anywhere computed a Parametric Tone Curve value from
image evidence. `candidate.curves.parametric` in `candidate-builder.js` was
built directly from `rawPreset.crv_sh ?? 0` etc. — i.e. straight from the
static fallback.

## Why P1J deliberately left this alone

`tone-curve-schema.js` (P1J, EPIC 2E-P1J) has a header comment stating
P1J did not touch `candidate.curves.parametric`, reasoning that "no existing
engine computes parametric slider values, inventing that math would violate
reuse-first, and 0 (no parametric override) is itself a legitimate, safe
default." P1L's design directly respects this: rather than inventing new,
independent math from raw histogram `stats`, P1L reuses P1J's own
already-computed, already-verified master point-curve.

## P1L's approach: derive from the existing master curve, not from scratch

`core/tone-curve-ai-engine/index.js::generateToneCurves(img, stats)` already
computes a 5-point master S-curve at x = 0, 64, 128, 192, 255 (`_masterCurve()`
→ `_buildSCurve()`, clamping the y-value at x=64 to [40,85], at x=128 to
[100,155], at x=192 to [175,215]). This curve is already wired, tested, and
verified correct by P1J's own test suite and Advanced Diagnostics UI.

P1L's `parametric-tone-plan-builder.js` reads that same master curve
(`evidence.toneCurves.result.master.points`, via the standard
`_resultOf(evidence, 'toneCurves')` pattern already used by every other
single-image plan-builder) and measures each anchor point's **deviation from
the identity line** (`y − x`) at x = 64 (Shadows), x = 128 (Midtones), and
x = 192 (Highlights). A positive deviation (curve lifted above identity)
maps to a positive parametric slider value; a negative deviation (curve
pulled below identity) maps to a negative slider value.

This is genuinely new engineering work — converting point-curve evidence
into parametric-slider units is a real transformation nobody had built —
but it is not independently-invented image analysis. It reuses the exact
signal P1J's engine already produces and that a photographer reviewing
Advanced Diagnostics can already see and cross-check.

## Pixel-to-slider calibration

The real ACR Parametric Tone Curve slider range is −100..100. The master
curve's own internal clamp ranges (traced from `_buildSCurve()`) bound how
far any anchor point can plausibly deviate from identity. `PIXEL_TO_SLIDER_SCALE
= 1.2` was calibrated from those clamp ranges so that a curve near the
engine's typical deviation ceiling maps to a slider value well inside the
Layer-A bound (`MAX_PARAMETRIC_DEVIATION = 45`), leaving headroom rather than
saturating at the Layer-A ceiling for ordinary photos.

## Two-layer safety net

- **Layer A** (`parametric-tone-schema.js`): `MAX_PARAMETRIC_DEVIATION = 45`,
  applied per-field inside `_sliderDelta()` before the plan is ever returned.
- **Layer B** (`xmp-validator/index.js`): new `HARD_LIMITS.parametricCurve`
  (±60 per field) + new `_clampParametricCurvePanel()`, wired into
  `quickSafetyClamp()` immediately after the existing `_clampEffectsPanel()`
  call (P1K's effects clamp). Operates on the flat `p.crv_sh` / `p.crv_mid`
  / `p.crv_hi` keys — the same shape `serializeXMP()` has always read —
  fails closed to 0 on non-finite input, never mutates the caller's object.

## What P1L intentionally did not touch

- Per-channel (`red`/`green`/`blue`) tone curves — out of scope, unrelated
  to the Parametric panel.
- `basic-tone-intelligence` / other Intelligence layers — untouched.
- The static fallback values (5/10/15) in `index.html`'s hidden inputs
  remain as a legacy default; they are now only used when the new plan
  does not engage (e.g. low confidence, missing evidence, or identity-curve
  photos where all three deviations are exactly zero).
