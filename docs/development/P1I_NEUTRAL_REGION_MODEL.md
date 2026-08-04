# P1I — Neutral Region Estimator Model

`core/single-image/white-balance-estimators/neutral-region-estimator.js`

## Algorithm

1. **Grid**: accepted pixels are bucketed into a coarse `12px × 12px`
   grid (`CELL_SIZE`) at analysis resolution.
2. **Cell classification**: a cell qualifies as a neutral candidate if
   it has ≥3 accepted pixels, mean saturation ≤ 0.14, and mean
   luminance within `[40, 235]` (the same non-clipped, non-near-black
   band `whitebalance-engine`'s existing `_filterNeutralCandidates()`
   uses, reused for consistency rather than inventing a second band).
3. **Region grouping**: neutral-candidate cells are grouped into
   connected regions via 4-connectivity flood fill over the cell grid
   — this is the genuine "region-level aggregation... prefer region-
   level aggregation over isolated pixels" the spec requires, distinct
   from `_filterNeutralCandidates()`'s flat pixel list.
4. **Region filters** (in order): total region size ≥ 60 pixels
   (`REGION_TOO_SMALL` otherwise); region must span ≥2 cells in BOTH
   x and y (rejects thin one-cell slivers — the mechanism behind
   `SPECULAR_ONLY`, since a genuine specular highlight is spatially
   tiny even if individually bright); region's skin-pixel ratio < 50%
   (`DOMINATED_BY_SKIN` otherwise, using the same YCbCr skin-tone
   check already used twice elsewhere in this codebase).
5. **Primary region** = the largest surviving region by pixel count.
   Its mean RGB becomes the estimate.

## Confidence model

```
confidence = 0.30 * sizeFactor          (primary region pixels / 300, capped at 1)
           + 0.25 * areaFactor          (total valid neutral area / total accepted pixels)
           + 0.25 * cleanlinessFactor   (1 - meanSaturation/0.14)
           + 0.20 * regionCountFactor   (# surviving regions / 3, capped at 1 — MORE corroborating regions = more confidence)
```

## Why a valid neutral estimate can override scene palette dominance

Unlike Gray World/Shades of Gray (whole-frame statistics that a
dominant object colour directly skews), Neutral Region's estimate
comes ONLY from cells that already passed a strict saturation filter
— a green-foliage or pink-clothing pixel never enters the candidate
pool in the first place, regardless of how much of the frame it
covers. This is what test #30 verifies: a valid Neutral Region
estimate is unaffected by how much of the rest of the frame a
dominant object colour occupies, and the ensemble (see
`P1I_MULTI_ESTIMATOR_ENSEMBLE_POLICY.md`) ranks it above
palette-sensitive estimators specifically for this reason.

## Known limitation

The 12px grid is coarse relative to the analysis resolution
(`MAX_ANALYSIS_DIM=360`) — a genuinely neutral region narrower than
~24px at analysis scale (e.g. a thin doorframe) may not accumulate
enough whole-cell support to register as its own region. This is an
intentional performance/precision tradeoff (see
`P1I_PERFORMANCE_AND_SAMPLING_POLICY.md`); it does not affect
correctness for the common case (walls, backdrops, large neutral
clothing/props) this estimator targets.
