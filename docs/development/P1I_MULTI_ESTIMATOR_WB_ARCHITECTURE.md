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
| `skin-sample-validator.js` **(R2)** | Extracts a trusted subset of skin-toned pixels from the shared sample; not a seventh WB estimator -- see `P1I_R2_PIXEL_SKIN_VALIDATION_MODEL.md` |
| `skin-correction-plausibility.js` **(R2)** | Simulates the ensemble's proposed correction on validated skin pixels and scores plausibility; see `P1I_R2_SKIN_CORRECTION_PLAUSIBILITY.md` |

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


## R2 addendum -- Pixel Skin Validation (additive only)

R2 adds a validation-only layer that never changes the flow above:
`buildEstimatorEnsemble()` (and everything upstream of it) is completely
untouched. After the ensemble's consensus exists,
`runWhiteBalanceEstimators()` calls `validateSkinCorrection(sample,
ensemble.consensus, { neutralRegionResult })`, wrapped in a `try/catch`
that falls back to an `UNAVAILABLE`-shaped result on any error, and adds
one new key -- `skinValidation` -- to the returned bundle, alongside the
existing six estimator results, `ensemble`, `objectBias`, and
`mixedLight`. See `P1I_R2_PIXEL_SKIN_VALIDATION_MODEL.md` and
`P1I_R2_SKIN_CORRECTION_PLAUSIBILITY.md` for the full model, and
`P1I_P1H_INTEGRATION_POLICY.md`'s R2 addendum for how P1H consumes it.

This is a **validator**, not a seventh estimator: it never appears in
`ESTIMATOR_ID`, never participates in `combineWeighted()`, and never
influences `ensemble.consensus`. It answers a different question than
the six estimators do -- not "what illuminant does this evidence
suggest," but "does the skin in this photo support the correction the
ensemble already proposed."
