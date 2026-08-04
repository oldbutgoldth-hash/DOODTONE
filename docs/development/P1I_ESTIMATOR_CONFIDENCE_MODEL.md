# P1I — Estimator Confidence Model

`core/single-image/white-balance-estimators/estimator-confidence.js`

## Principle

No estimator confidence in P1I is ever a fixed constant (unlike the
legacy `_gainsToEst()`'s fixed `0.5` — see
`P1I_PIXEL_EVIDENCE_PIPELINE_AUDIT.md` §11 point 3). Every confidence
score is a real, documented function of that estimator's own actual
sample.

## Shared building blocks (centralised, not duplicated per estimator)

- **`sampleCountFactor(count, sufficientAt)`** — `count/sufficientAt`
  clamped to `[0,1]`. Used by Gray World (`sufficientAt=400`), Shades
  of Gray (`400`), Highlight/Shadow (`200` per band). White Patch and
  Neutral Region use their own locally-scaled sample thresholds
  (documented in their own model docs) since a highlight band or a
  neutral region is naturally much smaller than the whole accepted set.
- **`dominancePenaltyMultiplier(dominanceRatio, opts)`** — the shared
  two-tier hue-dominance severity curve (warn/severe ratio + warn/
  severe multiplier, each estimator may tune its own multiplier
  strength) used by Gray World and Shades of Gray.
- **`combineWeighted(terms)`** — generic weighted-blend combinator,
  available for any estimator/consumer that wants a
  `[{value,weight}]` → clamped `[0,1]` result without re-deriving the
  normalise-by-total-weight arithmetic.
- **`agreementScore(points)`** — the cross-estimator spread/agreement
  computation used by the ensemble (`estimator-ensemble.js`) to derive
  consensus confidence from however many individual estimator readings
  are available.

## Per-estimator confidence inputs (documented per spec's required list)

| Estimator | Sample count | Spatial coverage | Clipping rate | Saturation | Stability/agreement | Dominance/object-bias risk |
|---|---|---|---|---|---|---|
| Gray World | ✓ | ✓ | (excluded upstream) | ✓ (diversity) | — | ✓ (hue dominance) |
| White Patch | ✓ | ✓ | ✓ (rejection, not just penalty) | ✓ (cleanliness) | ✓ (luminance stability) | — |
| Shades of Gray | ✓ | ✓ | (excluded upstream) | — | ✓ (p-norm/arith divergence) | ✓ (hue dominance) |
| Neutral Region | ✓ (region size) | ✓ (area fraction) | (excluded upstream) | ✓ (cleanliness) | ✓ (region count = corroboration) | — |
| Highlight | ✓ | ✓ | ✓ | ✓ | — | — |
| Shadow | ✓ | ✓ | (n/a) | ✓ | ✓ (noise ratio) | — |

Every row above maps to a real, inspectable code path — none of these
inputs is decorative; each is used in the confidence formula printed
in that estimator's own model doc.
