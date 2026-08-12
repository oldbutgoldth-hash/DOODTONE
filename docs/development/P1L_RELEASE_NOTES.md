# LUMIXA AI — EPIC 2E-P1L Release Notes

**Version:** 2.12.0
**EPIC:** 2E-P1L — Parametric Tone Curve Intelligence

## Summary

Adds a real analysis engine for the Parametric Tone Curve panel
(Shadows / Midtones / Highlights sliders). Previously these three fields
were always a static hardcoded fallback (5/10/15) regardless of the photo.
They now derive from the same master point-curve P1J's Tone Curve
Intelligence engine already computes, measuring how far the curve is lifted
or pulled down from identity at the shadow/midtone/highlight anchor points.

## What changed

- New `core/single-image/parametric-tone-intelligence/` module pair:
  schema + plan-builder.
- `candidate-builder.js` now writes real, photo-derived
  `candidate.curves.parametric` values when the new engine engages
  (sufficient confidence + a usable master curve), and always records
  `candidate.diagnostics.parametricToneIntelligence` for Advanced
  Diagnostics.
- `xmp-validator/index.js` gained a new Layer-B safety clamp for the
  Parametric Tone Curve fields (±60 export-safe range), matching the
  two-layer safety-net pattern already used for every other Candidate
  field this project exports.

## What did not change

- The per-channel (red/green/blue) tone curves — untouched.
- Every other Intelligence layer (Basic Tone, Detail, White Balance, Color,
  Skin) — untouched.
- The XMP serializer itself already emitted `crv_sh`/`crv_mid`/`crv_hi`;
  no serializer change was needed, only real values feeding it.

## Compatibility

Fully additive. Existing Candidates and exports for photos where the new
engine does not engage (e.g. very low analysis confidence) fall back to the
same static values as before — no behavior change in that case.
