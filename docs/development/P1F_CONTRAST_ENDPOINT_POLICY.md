# P1F Contrast & Endpoint Policy

## Scope

Covers `local-contrast-planner.js::computeContrastRecommendation()`
(Contrast) and `black-white-point-planner.js` (Whites/Blacks
endpoints).

## Contrast

`computeContrastRecommendation({ stats, sceneClass, skinScale,
strengthScalar })`:

- `LOW_CONTRAST` (or raw sigma `< 38`): bounded positive lift.
- `HIGH_CONTRAST` (or raw sigma `> 68`): bounded negative ease —
  deliberately relies on Highlight/Shadow recovery to relieve an
  already-high-contrast scene, rather than crushing global contrast
  further.
- `HIGH_KEY` / `LOW_KEY`: any otherwise-computed move is **dampened**
  (x0.4), never nulled — softness/tonal intent is preserved but a
  genuine contrast signal is not silently discarded.
- Skin-heavy portraits: the whole Contrast move is scaled by
  `skinScale` (from `basic-tone-schema.skinCautionScale()`) — harsh
  global contrast changes damage skin tonal transitions.
- Low evidence confidence (`<0.6`): additional 0.6x reduction.

## Whites

`computeWhitesRecommendation({ stats, sceneClass, strengthScalar,
whiteClothingProtection })`:

- Real highlight clipping (`clipHiPct > 3%`): bounded negative
  pullback to reduce data loss (larger clipping → larger pullback).
- Minor clipping (`1-3%`): smaller pullback for headroom.
- No clipping and real headroom (`whitePoint < 240`): bounded positive
  "brilliance" boost.
- `whiteClothingProtection` flag (set by the plan builder when the
  scene is skin-heavy **and** bright — `isSkinHeavy && (avgLum > 165
  || sceneClass === HIGH_KEY)`): scales any positive boost down to
  0.4x, protecting bridal/white-clothing highlight detail from being
  blown out by an otherwise-reasonable brilliance boost. Verified in
  test 26.

## Blacks

`computeBlacksRecommendation({ stats, sceneClass, strengthScalar })`:

- Real shadow crushing (`clipLoPct > 4%`): bounded positive lift to
  recover texture.
- `HIGH_KEY` / `LOW_KEY` scenes: the black point is treated as
  **intentional** (matte/faded elevated black point, or moody deep
  black point) and is never adjusted on the basis of its raw numeric
  value alone — only real crushing evidence (handled by the branch
  above, which is checked first) moves it. Verified in test 28.
- Otherwise, a raw black point lacking a real anchor (`blackPoint >
  15`) gets a bounded negative "deepen for definition" move.

## Why endpoints are handled separately from Highlights/Shadows

Whites/Blacks set the *tonal endpoints* of the image (where pure white
and pure black land), while Highlights/Shadows recover mid-range detail
near those endpoints. Conflating the two was judged likely to produce
compounding, hard-to-reason-about combinations — keeping them as
separate planner functions with independent evidence gates (clipping
percentage vs. raw black/white point) keeps each one's logic legible
and independently testable (tests 19-28).
