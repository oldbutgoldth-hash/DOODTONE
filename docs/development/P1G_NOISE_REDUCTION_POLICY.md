# P1G Noise Reduction Policy

## Luminance Noise Reduction (supported, Candidate-driven)

`noise-reduction-planner.js::planNoiseReduction()`, backed by
`noise-profile-estimator.js`, buckets Luminance NR by measured
`luminanceNoise`:

| Bucket | Range | Routed when |
|---|---|---|
| `CLEAN` | 0-8 | low measured noise |
| `MILD` | 6-18 | mild noise |
| `MODERATE` | 14-28 | moderate noise (test 25) |
| `STRONG` | 22-35 | heavy noise ("strong noise max 35 this phase") |

Absolute Layer-A bound: **0-35**, same union-of-buckets convention as
Sharpening.

## What increases Luminance NR

- Higher measured `luminanceNoise` (direct, from `imageAnalysis.noiseScore`).
- P1F's shadow-lift risk signal — an image whose Basic Tone Plan
  already lifted shadows carries more amplified noise in those
  shadows, so Detail's NR compensates upward for the same base noise
  evidence (test 26).
- High-detail *and* noisy images balance both fields rather than
  leaving either at 0 — Sharpening stays restrained while NR increases
  (test 28).

## Oversmoothing protection (portrait safety)

A skin-heavy image with very high measured noise never reaches the
noise bucket's own maximum — `oversmoothingProtection` engages and
caps Luminance NR below the bucket ceiling, because full-strength
Luminance NR on skin produces the "plastic skin" look this project's
skill conventions explicitly warn against (test 27). This mirrors the
skin-protection philosophy already established for Sharpening and for
P1F's own Basic panel.

## Color Noise Reduction — diagnostic-only, never Candidate-driven

`planNoiseReduction()` computes a `color.recommended` value purely for
diagnostics/lineage (visible in the Advanced Diagnostics panel), but
`color.supported` is **always `false`**. `candidate.detail.colorNoiseReduction`
is never touched by this EPIC's integration — it remains the
pre-existing hardcoded literal
`crs:ColorNoiseReduction="25"` set directly in
`core/preset-engine/index.js::serializeXMP()`, which never reads the
Candidate at all (test 29, 30; full rationale in
`P1G_SUPPORTED_XMP_DETAIL_FIELDS.md`). This is a permanent limitation
of the current serializer, not a P1G oversight — recommending a value
the system cannot actually export would be dishonest.
