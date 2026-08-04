# P1H — Illuminant vs. Object-Color-Bias Policy

## The problem

A strongly-colored object in the frame (green foliage, a red/pink
costume, a blue wall, a stage backdrop) is not the same thing as a
scene-wide illuminant cast. Auto-WB algorithms that only look at the
whole-image average color cannot tell the two apart, and will happily
generate a strong opposite-direction Temperature/Tint correction to
try to neutralize the object color — which visibly damages the actual
subject's rendering for no benefit.

## What already existed (pre-P1H)

`core/whitebalance-engine/index.js` already attenuates correction
strength when `core/color-cast-detector`'s `bgGreenDominant` flag is
set (0.35x when the subject is also neutral, 0.6x otherwise) — but
this protection is GREEN-ONLY. A red costume, blue wall, or any other
strongly-colored non-green background received no equivalent
protection before this round.

## What P1H adds

`core/single-image/white-balance-intelligence/illuminant-object-bias-separator.js`
generalizes the SAME spatial-separation signal color-cast-detector
already measures (`center` = likely subject, `border` = likely
background) to any color, not just green:

- If `center.label === 'neutral'` and `border.label` is meaningfully
  non-neutral and stronger than the center's cast, the scene is
  classified `OBJECT_COLOR_BIAS`, regardless of which hue direction
  the border cast points.
- When this flag is set, `wb-plan-builder.js` reduces the planned
  correction to 40% of what it would otherwise be — never zero (a
  small amount of genuine ambient bleed is still plausible), never
  full strength (the correction should not chase a background/object
  color).

## What P1H does NOT do

- It does not attempt full physical illuminant estimation (multi-light
  source separation, spectral analysis) — that is out of scope for a
  browser-only, Canvas-based pipeline.
- It does not change `core/color-cast-detector/index.js` or
  `core/whitebalance-engine/index.js` themselves — the separation is a
  new, additive interpretation layer built on TOP of their existing,
  real per-zone measurements.
- It does not claim 100% accuracy. A busy multi-object scene with no
  clear single dominant background color will simply not trigger the
  `OBJECT_COLOR_BIAS` flag, and the correction falls back to the
  standard confidence-tiered guardrail behavior.

## Verified behavior

See test suite Section 4 (checks 24-32) — proven against both a
green-foliage fixture (the pre-existing case) and a red-costume
fixture (the newly-generalized case), plus a plan-level check that
`|correction|` after the guard is measurably smaller than the raw
reading's magnitude in both cases.
