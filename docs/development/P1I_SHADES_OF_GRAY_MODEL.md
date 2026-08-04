# P1I — Shades of Gray Estimator Model

`core/single-image/white-balance-estimators/shades-of-gray-estimator.js`

## Algorithm and p value

Minkowski `p`-norm mean per channel: `((Σ x^p)/n)^(1/p)`, with
**p = 6** (`SOG_P`), applied to the RAW, unweighted accepted-pixel set
(deliberately no saturation weighting — see below). `p=6` matches
`whitebalance-engine`'s existing private `_shadesOfGray()` constant
exactly, kept identical for cross-estimator comparability (a different
exponent would make outputs not meaningfully comparable to that
existing, already-proven-in-production value). `p=1` reduces to plain
Gray World; larger `p` approaches Max-RGB/White-Patch behaviour;
`p=6` is the well-established middle-ground choice in the Shades-of-
Gray literature (Finlayson & Trezzi, 2004) this project already made.

## Why this is independent of Gray World, not "a weighted Gray World result"

Gray World (`gray-world-estimator.js`) applies saturation-based
DOWN-weighting before averaging. Shades of Gray here applies NO
saturation weighting at all — its distinguishing statistical property
is purely the p-norm's inherent bias toward brighter channel values
(the p-norm mean is always ≥ the arithmetic mean for non-negative
values, with the gap growing as the channel distribution's variance
increases). Test #22 verifies these two estimators diverge on a
dominant-color-scene fixture where the difference is measurable.

## Confidence model

```
confidence = 0.35 * sampleCountFactor         (accepted/400, capped at 1)
           + 0.25 * spatialCoverage
           + 0.20 * (1 - dominanceRatio)       (same hue-bucket signal as Gray World)
           + 0.20 * (1 - divergence)
```

`divergence` is SOG's own independent signal: the mean absolute
difference between the p-norm result and a plain arithmetic mean over
the same accepted set, normalised. A large divergence indicates a
non-uniform, potentially dominated brightness distribution, and pulls
confidence down independently of the shared hue-dominance check.

## Determinism

Pure per-channel exponentiation and summation over a fixed pixel list
— no iteration order dependency (the sum is computed via a single
left-to-right reduce, matching JS's deterministic floating-point
summation order for a given input array), verified by test #23.
