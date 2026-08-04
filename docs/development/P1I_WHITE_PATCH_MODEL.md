# P1I — White Patch Estimator Model

`core/single-image/white-balance-estimators/white-patch-estimator.js`

## Algorithm

1. Take the top 10% of accepted pixels by luminance (90th percentile
   threshold of the accepted-pixel luminance distribution — NOT a
   fixed byte threshold, so it adapts to each scene's actual dynamic
   range) as the highlight candidate band.
2. Exclude any candidate with ANY channel at the 255 clip ceiling
   (`isAnyChannelClipped`) — stricter than the sampler's own
   "all three channels clipped" rejection, because a highlight with
   even one blown channel cannot yield a trustworthy neutral colour.
3. Reject the whole estimate (not just down-weight) if the surviving
   candidates are too saturated to be a credible near-white surface —
   two tiers: `HIGHLIGHTS_TOO_SATURATED` (mean sat > 0.18) and, when
   combined with strong single-hue dominance (≥60% of candidates
   share one hue bucket) at higher saturation (> 0.35),
   `COLORED_LIGHT_SUSPECTED` — the scene's brightest region is a
   colored light source, not a white/neutral highlight.
4. Require ≥15 surviving candidates AND a minimum spatial footprint
   (`INSUFFICIENT_SPATIAL_COVERAGE` otherwise) — this is the direct
   mechanism that rejects "a single bright pixel" (specular noise):
   one pixel can never satisfy either the count or spread requirement.
5. Mean the surviving candidates' RGB, convert to neutralising gains
   and Candidate-unit temp/tint exactly as Gray World does.

## Rejection reasons (exact codes)

`NO_VALID_HIGHLIGHT_REGION` (no accepted pixels at all),
`HIGHLIGHTS_CLIPPED` (every candidate in the luminance band has a
clipped channel), `HIGHLIGHTS_TOO_SATURATED`, `COLORED_LIGHT_SUSPECTED`,
`INSUFFICIENT_SPATIAL_COVERAGE`.

## Confidence model

```
confidence = 0.30 * sampleFactor          (candidates/150, capped at 1)
           + 0.25 * spatialCoverage*10    (bounding-box fraction, scaled — highlight regions are naturally small)
           + 0.25 * saturationCleanliness (1 - meanSat/0.18, capped at 0-1)
           + 0.20 * luminanceStability    (1 - stddev(lum)/40, capped at 0-1)
```

## Known limitation

The 90th-percentile threshold is scene-relative: a very dark, low-
dynamic-range scene can still produce a "highlight band" that is not
truly bright in absolute terms. The saturation-based rejection layer
is the primary defence against treating such a band as a reliable
white reference; it is not a substitute for genuine exposure metadata
(which this project does not have access to at the pixel-buffer
level).
