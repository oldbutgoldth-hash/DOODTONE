# EPIC 2E-Q3 — Tone Curve Transfer Strength Ceiling

## Context

Third finding from the "RCM presets are close to a no-op" investigation.
Q1 fixed white balance being silently skipped when no base value was
present; Q2 fixed white balance being crushed by a confidence-quality
cliff. Neither explained a symptom visible in the user's own original
screenshot: the Tone Curve panel came out essentially linear/near-default.

## Root cause

The tone curve pipeline dampens its own output at three independent,
unaware-of-each-other layers before it reaches the exported XMP:

1. `tone-curve-transfer-engine.js`'s `_deriveMappingCurve()` — mode-based
   shadow/highlight rolloff, graduated endpoint dampening (down to 0.2x
   at the extremes), curve smoothing, and the user's Intensity setting.
2. `perceptual-pixel-transfer-engine.js`'s `monotonic()` — a hard per-point
   cap (±22 master / ±4 at endpoints, ±9 / ±3 for R/G/B channels).
3. `lightroom-candidate-mapper.js`'s `protectPixelTransferCurves()` — a
   third, independently-derived scale (`baseScale`) applied on top of the
   already-shaped curve from layers 1–2, **capped at a flat 0.78 no
   matter how large or well-evidenced the real difference was**.

Layer 3's own comment explains its real purpose: preventing CDF/histogram
matching from over-correcting a high-key wedding-style target. That is a
legitimate, narrow concern — but the fixed 0.78 ceiling applied to the
*entire* merged curve (including the already carefully-shaped percentile
component from layer 1), meaning even an unmistakably large, safe,
well-evidenced tonal difference could never express more than roughly
three-quarters strength, regardless of the user's own Intensity setting.

## Fix

Raised only the ceiling in `protectPixelTransferCurves()`'s `baseScale`
from 0.78 to 0.95. The floor (0.32, for a genuinely modest difference)
and the `matchNeed / 24` proportional ramp are unchanged — a small real
difference still correctly gets a smaller curve. Neutral-white/high-key
protection, per-channel `channelScale` (which stays intentionally more
conservative — color-cast risk from R/G/B curves is a separate, real
concern from overall tonal shape), and endpoint protection are completely
untouched.

## Verified, not just argued

For a large, well-evidenced tonal difference (matchNeedScore ≈ 26, above
the point where the old ceiling actually bound), the reconstructed pre-Q3
master curve and the new one are directly compared in
`qa/epic-2e-q3-tone-curve-ceiling-test.mjs` — the new curve's total
deviation from identity is measurably larger. For a modest difference
(matchNeedScore well under the ramp point, where the ceiling never
bound), the suite proves the output is **byte-identical** to before —
this fix only changes behavior for the specific large-difference case it
targets.

The same suite re-runs EPIC O's own high-key-wedding + already-warm-skin
regression fixture and confirms every documented safe bound still holds.

## Honest scope

This is one clearly-identified, narrow fix (a single ceiling constant) in
a three-layer dampening stack. Layers 1 and 2 (mode-based shaping,
endpoint dampening, per-point hard caps) were read and reasoned about but
deliberately not touched — they encode real stylistic/safety intent, not
an obvious cliff-style bug. If real photos still show an overly subtle
tone curve after this round, the next place to look is layer 1's
per-anchor-point dampening multipliers (0.2x at absolute endpoints, 0.4x
at adjacent points) and the smoothing pass, which were left alone this
round given no test/real-photo evidence yet pointed at them specifically.
