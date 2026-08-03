# P1F Exposure & Recovery Model

## Scope

Covers `exposure-recommendation.js` (Exposure) and
`highlight-shadow-recovery.js` (Highlights/Shadows recovery).

## Exposure

`computeExposureRecommendation({ stats, sceneClass, strengthScalar,
plannedShadowRecoveryValue })` — conservative, scene-aware:

- `UNDEREXPOSED`: bounded `+8..+22` lift proportional to how dark
  `avgLum` is, only when real shadow clipping accompanies the
  darkness (the scene classifier already required this to reach
  `UNDEREXPOSED`).
- `OVEREXPOSED`: bounded `-8..-20` pullback, mirror logic for real
  highlight clipping.
- `HIGH_KEY`: kept at 0 — a bright-but-unclipped scene is preserved,
  not darkened.
- `LOW_KEY`: kept at 0 (intentional darkness preserved) **unless** the
  frame is a near-blank capture defect (`drStops < 1.2` AND
  `avgLum < 15`), which gets a small `+12` safety lift. This
  distinction — genuinely broken frame vs. intentional moody shot — is
  the same "protect against real technical data loss, never against
  intentional style" principle `core/basic-panel-engine` already uses.
- `HIGH_DYNAMIC_RANGE` / `HAZY`: left at 0 — handled by Highlight/Shadow
  recovery and Contrast/Dehaze respectively, so Exposure doesn't
  double-correct the same problem from a different angle.
- `BALANCED`/`LOW_CONTRAST`/`HIGH_CONTRAST`: only a small (`0..10`)
  conservative move for genuinely dim/bright but **unclipped**
  midtones — deliberately smaller and more conservative than the
  clipping-backed `UNDEREXPOSED`/`OVEREXPOSED` cases.

Two coordination rules apply after the scene-specific value is chosen:

1. **Highlight protection**: if `clipHiPct > 3` and Exposure would
   brighten, the brightening is suppressed entirely.
2. **Shadow-recovery coordination**: if Shadow recovery is already
   contributing `>= 10`, Exposure's own lift is halved — avoids the
   common failure mode of two different sliders each independently
   "fixing" the same dark-shadow problem to the point of over-
   correction. Verified in test 18
   (`qa/epic-2e-p1f-basic-tone-intelligence-test.mjs`).

Low evidence confidence (`< 0.6`) additionally halves the final value.

## Highlights / Shadows

`computeHighlightRecovery()` / `computeShadowRecovery()` — gated on
**real clipping evidence first** (`clipHiPct`/`clipLoPct`), with a
small additional scene-class structural component layered on top:

- Real clipping evidence always triggers *some* recovery regardless of
  scene class — data-loss protection outranks style preservation, the
  same convention `core/basic-panel-engine` already applies. Even a
  `LOW_KEY` (intentionally dark) scene still gets Shadow recovery if
  real shadow clipping is present.
- Severe clipping (`>5%`) produces a larger bounded recovery than minor
  clipping (`1.5-5%`).
- `OVEREXPOSED` adds a further `-8` structural Highlights pullback;
  `HIGH_DYNAMIC_RANGE` adds `-6` Highlights / `+12` Shadows to
  coordinate the two ends of the tonal range together.
- Low confidence (`<0.6`) reduces the magnitude (Shadows especially,
  since lifting noisy/uncertain shadow measurements risks amplifying
  sensor noise).

## Avoiding the "-50/+50 on every image" failure mode

The single most common failure this model was explicitly built to
avoid: a fixed, scene-blind `-50` Highlights / `+50` Shadows applied to
nearly every photo. Verified directly in test 23: a clean `BALANCED`
scene with no clipping keeps both Highlights and Shadows near 0, and an
`HIGH_DYNAMIC_RANGE` scene's two recommendations are independently-
derived, non-equal magnitudes — never a fixed mirrored pair.

## Bounds

All 6 fields (`exposure, highlights, shadows` here; `contrast, whites,
blacks` in the companion docs) are clamped to
`basic-tone-schema.BOUNDS`, which sit strictly inside
`core/xmp-validator::HARD_LIMITS.basic`.
