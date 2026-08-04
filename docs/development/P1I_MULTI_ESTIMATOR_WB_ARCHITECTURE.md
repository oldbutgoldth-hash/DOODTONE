# P1I — Multi-Estimator White Balance V2 Architecture

## Module map

`core/single-image/white-balance-estimators/`

| File | Responsibility |
|---|---|
| `wb-color-math.js` | Shared, documented colour math (gain↔temp/tint conversion, pixel classification, hue-dominance, spatial coverage, skin check) |
| `wb-pixel-sampler.js` | Deterministic pixel sampling: `sampleFromBuffer()` (pure/DOM-free, unit-testable) + `sampleFromImage()` (browser canvas draw) |
| `wb-estimator-schema.js` | The stable per-estimator result contract + bundle shape |
| `gray-world-estimator.js` | Saturation-weighted channel-mean estimator with hue-dominance confidence penalty |
| `white-patch-estimator.js` | Percentile highlight-band estimator with clip/saturation/spatial rejection |
| `shades-of-gray-estimator.js` | Minkowski p=6 norm estimator, unweighted, independent of Gray World |
| `neutral-region-estimator.js` | Grid + flood-fill connected-region neutral estimator |
| `highlight-shadow-illuminant-estimator.js` | Independent highlight-band / shadow-band estimators + `compareIlluminants()` |
| `estimator-confidence.js` | Shared confidence-term building blocks (sample count, dominance penalty, weighted blend, cross-estimator agreement) |
| `estimator-ensemble.js` | `buildEstimatorEnsemble()`, `computeObjectBiasEvidence()`, `computeMixedLightEvidence()`, and the top-level `runWhiteBalanceEstimators()` entrypoint |

## Required flow (as specified, implemented exactly)

```
Decoded analysis pixels
  -> wb-pixel-sampler.js (sampleFromBuffer/sampleFromImage)
  -> six independent estimators (gray-world, white-patch, shades-of-gray,
     neutral-region, highlight, shadow)
  -> estimator-confidence.js (per-estimator confidence, computed inside
     each estimator using these shared building blocks)
  -> estimator-ensemble.js (consensus + object-bias + mixed-light evidence)
  -> [P1H] wb-evidence-extractor.js consumes the bundle when present
  -> [P1H] wb-plan-builder.js (unchanged decision logic, now fed richer evidence)
  -> Canonical Candidate (P1C, unchanged owner: P1H only)
  -> UI (P1H's existing Advanced Diagnostics panel, extended)
  -> XMP (P1D fidelity gate, unchanged)
```

## Ownership boundary (repeated here for visibility; full detail in P1I_P1H_INTEGRATION_POLICY.md)

**P1I owns:** pixel-level estimator execution, individual estimator
results, individual estimator confidence, the ensemble consensus,
object-bias evidence, mixed-light evidence.

**P1H owns:** the final Temperature/Tint decision, mood preservation,
intentional-light protection, guardrails, Candidate integration, UI
and XMP lineage. P1I's `estimator-ensemble.js` never imports or calls
anything from `core/single-image/white-balance-intelligence/` (P1H's
own directory) or `core/single-image/candidate/` — verified by static
import-graph check in the test suite (test #57/#59).

## Why six estimators, not fewer

Each covers a distinct failure mode the others don't: Gray World is
whole-frame but object-colour-sensitive; White Patch needs a genuine
highlight but is blind if the scene has none; Shades of Gray is a
different statistical lens on the whole frame (catches cases where
Gray World and White Patch happen to agree on a wrong reading — an
extremely rare but possible failure Shades of Gray, with a distinct
"exponent bias," would not always reproduce identically); Neutral
Region requires genuine spatial neutral evidence and is the most
resistant to dominant object colour; Highlight/Shadow are the only
pair that can DETECT (not just guess at) mixed lighting via direct
band-vs-band comparison. No single estimator is ever treated as
absolute truth — this is the explicit, hard acceptance criterion the
ensemble's outlier/agreement/confidence machinery exists to satisfy.
