# P1I — Multi-Estimator Ensemble Policy

`core/single-image/white-balance-estimators/estimator-ensemble.js`

## Preserve everything, discard nothing silently

`buildEstimatorEnsemble()` always returns `usableEstimatorIds`,
`outlierEstimatorIds`, AND `rejectedEstimatorIds` as three DISTINCT
lists — every one of the six individual `EstimatorResult` objects
(including rejected ones, with their exact rejection reason) is
returned unmodified on the bundle's `estimators` map. Nothing is ever
deleted; "outlier" means down-weighted in the consensus, not removed
from the record.

## Hierarchy, modulated by confidence — not a fixed priority order

Base hierarchy weights: Neutral Region `1.4` > White Patch `1.2` >
Shades of Gray `1.0` > Gray World `0.9` > Highlight/Shadow `0.5` each
(the latter two are illuminant-BAND readings, not whole-scene
estimates, so they contribute less to the primary consensus and exist
mainly to feed mixed-light evidence). Each estimator's actual
consensus weight is `confidence × hierarchyWeight` — so a
low-confidence Neutral Region (e.g. `DOMINATED_BY_SKIN`-adjacent, weak
support) does NOT automatically outrank a high-confidence Gray World
reading; the hierarchy sets DEFAULT priority, confidence adjusts it,
exactly as the spec requires ("But confidence and scene conditions may
alter weighting").

## Outlier detection (two-pass)

Pass 1 computes a provisional weighted consensus from all usable
estimators. Pass 2 computes each usable estimator's Euclidean distance
from that provisional consensus; any estimator beyond `30` Candidate-
unit distance is flagged as a statistical outlier and its consensus
weight is multiplied by `0.3` (not zeroed — a genuine one-estimator to
five-estimator vote should still register at partial weight, avoiding
a hard binary "in/out" cliff). The FINAL consensus is computed from
these adjusted weights. `agreement` (see
`P1I_ESTIMATOR_CONFIDENCE_MODEL.md`'s `agreementScore()`) is always
computed on the RAW usable set, independent of the outlier
down-weighting, so it remains an honest "how much do the estimators
actually agree" signal.

## Ensemble confidence

```
confidence = 0.40 * agreement
           + 0.35 * mean(usable estimators' own confidence)
           + 0.25 * coverageFactor   (usable count / 4, capped at 1)
```
Further multiplied by `0.85` if any outlier was detected. Zero usable
estimators → confidence `0`, consensus `{0,0}`, status
`UNAVAILABLE` — the documented conservative fallback (test #39),
never a fabricated non-zero guess.

## Object-color-bias evidence (`computeObjectBiasEvidence()`)

Compares the "biased subset" (Gray World + Shades of Gray — the two
whole-frame mean-based estimators most susceptible to a dominant
object colour) against the "reference subset" (Neutral Region + White
Patch — the two estimators that already filter for near-neutral
pixels before averaging). `estimatorDisagreement` is the normalised
vector distance between these two subsets' mean readings.
`objectBiasProbability` combines dominant-hue-ratio (40%), that
disagreement (35%), and whether a trustworthy Neutral Region override
actually exists (25%) — all three together, not any single signal
alone, because a dominant hue with NO disagreement (the reference
estimators genuinely agree the cast is real) should NOT be flagged as
object bias.

## Mixed-light evidence (`computeMixedLightEvidence()`)

Wraps `compareIlluminants()` (from the highlight/shadow module) with
one additional corroboration flag:
`corroboratedBySpatialDisagreement` — true when the SAME
estimator-cluster disagreement used for object-bias evidence is also
elevated (≥0.4), on the reasoning that both symptoms (whole-frame vs.
localized-region disagreement, AND highlight-band vs. shadow-band
disagreement) pointing the same direction is stronger corroboration
than either alone. This evidence is descriptive only — P1H's
mixed-light-detector.js remains the sole place a correction-reduction
decision is made.

## What the ensemble deliberately does NOT do

- Does not average incompatible illuminants into one aggressive
  correction — outlier down-weighting and the confidence penalty for
  disagreement both push toward a SMALLER, more conservative consensus
  magnitude when estimators disagree, never a larger one.
- Does not write to `session.candidate` — see
  `P1I_P1H_INTEGRATION_POLICY.md`.
- Does not decide strength mode, mood preservation, or intentional-
  light protection — all P1H's existing responsibilities, unchanged.
