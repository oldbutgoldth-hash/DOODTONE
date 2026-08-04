# P1I — Gray World Estimator Model

`core/single-image/white-balance-estimators/gray-world-estimator.js`

## Algorithm

Saturation-weighted channel mean over the pixel sampler's accepted
pixels (already excludes fully-clipped and near-black — see
`wb-pixel-sampler.js`). Each pixel's contribution weight is
`max(0.15, 1 - saturation)` — highly saturated (colourful) pixels
still contribute (never fully silenced, since a genuinely saturated
scene may still carry real illuminant information) but count for
proportionally less than near-neutral pixels. The weighted mean is
converted to neutralising gains (`meanToNeutralGains()`) and then to
Candidate-unit temperature/tint (`gainsToTempTint()`, both in
`wb-color-math.js`).

## Why this is NOT the legacy `_grayWorld()`

`whitebalance-engine`'s private `_grayWorld()` is an unweighted
arithmetic mean with a fixed `0.5` confidence regardless of scene
content (see `P1I_PIXEL_EVIDENCE_PIPELINE_AUDIT.md` §11). P1I's
version adds saturation weighting AND a real, scene-dependent
confidence model — required specifically to satisfy "must not force a
green forest toward magenta merely because green dominates."

## Confidence model

```
confidence = 0.30 * sampleCountFactor      (accepted/400, capped at 1)
           + 0.25 * spatialCoverage        (bounding-box area / frame area)
           + 0.25 * saturationDiversity    (stddev of saturation / 0.3, capped at 1)
           + 0.20 * (1 - dominanceRatio)   (see below)
```

**Dominance penalty** (the core anti-"green forest" mechanism):
accepted pixels with saturation ≥ 0.12 are bucketed into 12 x 30°
hue bins (`hueDominance()`, shared in `wb-color-math.js`).
`dominanceRatio` = the largest bucket's share of all hue-eligible
pixels. When `dominanceRatio ≥ 0.65`, confidence is further multiplied
by `0.4` and status becomes `DEGRADED`; when `≥ 0.45`, multiplied by
`0.7`. A frame dominated by green foliage or pink/red clothing
therefore reports LOW Gray World confidence — the ensemble is
expected to down-weight it accordingly rather than trust its
correction at face value (verified by tests #11/#12/#41/#42).

## Rejection

Only one hard rejection: fewer than 40 accepted pixels
(`INSUFFICIENT_SAMPLE_COUNT`) — below this, no mean is statistically
meaningful. All other conditions degrade confidence rather than reject
outright, since Gray World's whole-frame character makes a hard reject
less appropriate than for White Patch/Neutral Region.

## Known limitation

Hue-bucket dominance is a coarse, whole-accepted-set signal — it
cannot distinguish "one large green object" from "many small green
objects scattered across the frame" (both produce the same
dominanceRatio). This is a deliberate simplification consistent with
the spec's explicit non-goal ("do not promise 100% accuracy... never
rely on one estimator as absolute truth") — the ensemble's
cross-estimator agreement (see `P1I_MULTI_ESTIMATOR_ENSEMBLE_POLICY.md`)
is the actual safety net, not Gray World alone.
