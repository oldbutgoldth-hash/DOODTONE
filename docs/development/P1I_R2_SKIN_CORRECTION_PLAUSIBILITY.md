# P1I R2 — Skin Correction Plausibility Model

This document covers `skin-correction-plausibility.js`: given a set of
already-validated skin pixels (see `P1I_R2_PIXEL_SKIN_VALIDATION_MODEL.md`)
and the ensemble's proposed Temperature/Tint correction, how the module
decides whether that correction is *supported*, *unsupported*, or in
*conflict* with a confident neutral-region reading.

## 1. The simulation is pure, temporary, and local-only

`evaluateCorrectionPlausibility()` never touches Candidate, Session, or
any shared pixel data. It:

1. Converts the proposed `{temperature, tint}` into a simulated RGB
   gain triple via `_inverseTempTintToGains()` (see §2).
2. Clamps that gain to a safety range (`GAIN_MIN=0.05, GAIN_MAX=4`) —
   unrelated to any Candidate/XMP export clamp, purely to keep the
   simulation numerically sane for extreme proposed corrections.
3. Applies the gain to each validated skin pixel **in a local array
   copy**, scores the result, and discards it. Nothing here is ever
   assigned back to `sample`, `Candidate`, or any Session field.

## 2. Why an inverse of `gainsToTempTint()` is needed, and how it was derived

The ensemble's consensus is expressed as `{temperature, tint}` — the
same two scalars P1H's decision layer works in — but simulating a
correction's effect on pixel colors requires RGB gains. `wb-color-math.js`
already has a forward `gainsToTempTint(gains)`; this module adds a
**local, pure, approximate** inverse, used only here and never exported
for reuse by Candidate-writing code.

**The inverse is genuinely approximate, not exact, by construction**:
temperature/tint compress three RGB gain degrees of freedom into two
scalars, so an infinite family of gain triples maps to any given
`(temperature, tint)` pair. A convention had to be chosen to pick one
specific member of that family.

The first attempt (a naive split of `rbDiff` symmetrically around `gG`
with `gG` held at some derived value not tied to `tint`) was wrong: it
made pure-tint corrections (`temperature=0`, `tint != 0`) degenerate into
uniform brightness scaling — the exact opposite of a tint shift, which
should shift red/blue in *opposite* directions while leaving overall
lightness roughly constant. Tracing through the forward formula showed
why: `tint` in `gainsToTempTint()` depends on the **absolute** value of
`gG`, not a ratio, while `temperature` depends on `(gR-gB)/gG`.

The formula actually used instead:

```js
function _inverseTempTintToGains(temperature, tint) {
  const g = 1 - tint / 22;
  const rbDiff = temperature / 28;
  const r = (3 - g + rbDiff * g) / 2;
  const b = (3 - g - rbDiff * g) / 2;
  return { r, g, b };
}
```

This resolves the residual degree of freedom with a **mean-gain-
preserving convention**: for temperature-only corrections, `r+g+b ≈ 3`
stays centered, so brightness is left alone and only the red/blue
balance shifts. Verified with a round-trip test in the automated suite:
`gainsToTempTint(_inverseTempTintToGains(t, n))` reproduces `(t, n)`
exactly across 11 tested `(temperature, tint)` pairs, and a pure-tint
input now correctly produces opposing R/B shifts (a genuine hue change)
rather than uniform scaling.

## 3. Ethnicity-neutral plausibility scoring

`_skinBandScore(r,g,b)` computes a **continuous 0-1** "how centered
inside the skin chrominance band" score — never the classifier's hard
boolean, and never a single target hue:

```
Y  = 0.299r + 0.587g + 0.114b
Cb = 128 - 0.168736r - 0.331264g + 0.5b
Cr = 128 + 0.5r - 0.418688g - 0.081312b
cbDist = |Cb - 102| / 25        // same band center/half-width as isLikelySkinPixelYCbCr's Cb 77-127
crDist = |Cr - 153| / 20        // same band center/half-width as isLikelySkinPixelYCbCr's Cr 133-173
score  = clamp(1 - max(cbDist, crDist), 0, 1)
if (Y < 80 || Y > 235) score *= 0.5   // OUT_OF_TONE_PENALTY
```

This is the exact same Cb/Cr band `isLikelySkinPixelYCbCr()` uses
elsewhere in the codebase, re-expressed as a distance-to-center measure
so a correction that pushes a pixel further from the center (but still
technically inside the band) is scored as less plausible than one that
pushes it toward the center — without ever declaring one specific hue
"correct." `beforeScore`/`afterScore` are the mean of this score across
all validated pixels, before and after the simulated correction.

**A correction that makes an already well-centered skin sample worse is
a real, expected finding, not a bug.** This was confirmed directly: a
small `temperature=+5` nudge on already-centered natural skin measurably
*reduced* `afterScore` (0.878 -> 0.414 in one calibration run), because
pushing already-centered skin further in one direction genuinely moves
it away from center — verified by hand-computing the Y/Cb/Cr shift. The
suite's "correction improves plausibility" test case therefore uses a
dedicated, deliberately off-center ("cool-shifted") fixture, and
separately confirms the improvement reverses again at a large enough
correction (overcorrection), which is the expected, monotonic-then-
reversing shape of this scoring function.

## 4. Supported vs. unsupported vs. conflict

```js
correctionSupported =
  !gainClamped
  && afterScore >= (beforeScore - SUPPORT_TOLERANCE)   // 0.05 -- measurement-noise margin
  && afterScore >= MIN_AFTER_SCORE_FLOOR;               // 0.30 -- implausible regardless of delta
```

`conflictWithNeutral` is set only when BOTH: the neutral-region estimator
itself reports a confident (`>= 0.35`) result, AND the correction is not
supported. It is a recorded signal only — turned into a bounded
confidence penalty (see §5), never a full override.

## 5. Confidence composition — bounded in both directions, never a fixed number

```js
let confidence = sampleQualityConfidence;               // from skin-sample-validator.js
if (correctionSupported) {
  confidence += clamp(improvement, 0, MAX_CORROBORATION_BOOST);  // 0.15 cap
} else {
  confidence *= UNSUPPORTED_PENALTY_MULTIPLIER;                  // 0.5 -- more than halves, never zeroes
}
if (conflictWithNeutral) {
  confidence *= CONFLICT_PENALTY_MULTIPLIER;                     // 0.75 -- one further moderate reduction
}
```

This mirrors the project's existing multiplier-based confidence idiom
(e.g. `estimator-ensemble.js`'s `OUTLIER_DOWNWEIGHT = 0.3`): a bounded
corroboration boost that can never dominate, a substantial-but-not-total
penalty for an unsupported correction, and one further moderate
reduction — never a hard zero, never a full override of any other
estimator's evidence — for a conflict with a confident neutral-region
signal. `status` is `'OK'` only when the correction is supported AND
confidence clears `0.35`; otherwise `'DEGRADED'`.

## 6. What this module deliberately does not do

- It does not classify or infer ethnicity, personal attributes, or any
  fixed "target" skin tone — see §3.
- It does not modify `Candidate`, `session.evidence`, or any pixel
  array — the simulation is discarded after scoring.
- It does not run when skin sample validation itself is `UNAVAILABLE`
  (see `P1I_R2_PIXEL_SKIN_VALIDATION_MODEL.md` §6) — R1/P1H behavior is
  preserved exactly in that case.
- It is never the sole source of a Temperature/Tint decision — its
  entire output is one optional corroboration/reduction signal consumed
  by P1H's evidence extraction, never a replacement decision path.
