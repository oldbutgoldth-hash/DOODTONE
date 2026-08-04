# P1I — Highlight/Shadow Illuminant Estimator Model

`core/single-image/white-balance-estimators/highlight-shadow-illuminant-estimator.js`

## Purpose

Measure the highlight band's and shadow band's chromatic tendency
INDEPENDENTLY, so mixed lighting (warm tungsten interior + cool window
daylight) is detected as a real, quantified disagreement between two
separately-measured illuminant readings — not merely inferred from
`color-cast-detector`'s existing shadow/highlight LABEL comparison,
which has no magnitude or confidence weighting of its own.

## Bands

Highlight band = top-tercile luminance (≥67th percentile) among
accepted pixels; shadow band = bottom-tercile (≤33rd percentile).
Both bands additionally reject: any-channel-clipped pixels (highlight
only — a shadow band is not at risk of highlight clipping), and mean
saturation above `0.25` (`SAT_CAP` — looser than Neutral Region's
`0.14`, since illuminant chromaticity bands are not required to be
literally neutral, only clearly not object-coloured).

## Confidence models (independent per band)

**Highlight:**
```
confidence = 0.35 * sampleCountFactor(n, 200)
           + 0.30 * (1 - clippingRate)
           + 0.20 * spatialCoverage
           + 0.15 * (1 - meanSat/0.25)
```

**Shadow:**
```
confidence = 0.35 * sampleCountFactor(n, 200)
           + 0.30 * (1 - noiseRatio)
           + 0.20 * spatialCoverage
           + 0.15 * (1 - meanSat/0.25)
```

`noiseRatio` is shadow-specific: the band's internal luminance
standard deviation relative to its own dynamic-range width. Dark,
low-signal regions are inherently noisier (sensor read noise
dominates), so a wide internal spread inside what should be a tight
low-luminance band is treated as evidence of shadow noise, not
illuminant signal — reducing confidence, never treated as a real
colour cast.

## Mixed-light comparison (`compareIlluminants()`)

Purely descriptive, never a correction decision. Requires BOTH bands
to clear a `0.3` confidence floor before comparing at all (otherwise
returns `compatible:true, isMixedLight:false` — "insufficient evidence"
is not the same as "confirmed compatible"). Computes the Euclidean
distance between the two bands' `{temperature, tint}` readings;
`isMixedLight=true` when that distance ≥18 (Candidate slider units),
or ≥10.8 combined with a categorical cast-axis mismatch (e.g. highlight
reads "warm", shadow reads "cool"). This feeds Mixed-Light V2's
ensemble-level evidence (see `P1I_MULTI_ESTIMATOR_ENSEMBLE_POLICY.md`)
— P1H still owns the actual correction-reduction decision.
