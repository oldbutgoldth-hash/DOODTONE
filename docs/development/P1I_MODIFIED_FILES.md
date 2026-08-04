# P1I — Modified / New Files

## New module area: `core/single-image/white-balance-estimators/`

| File | Lines | Purpose |
|---|---|---|
| `wb-pixel-sampler.js` | 138 | Samples a bounded, deterministic set of pixels from a decoded image buffer (MAX_SAMPLES/MAX_SCAN ceilings), rejects invalid channels (NaN/Infinity), single shared sample pass reused by all six estimators. |
| `wb-color-math.js` | 231 | Pure color-math shared by every estimator: mean-to-neutral gain computation, `gainsToTempTint()`, `castAxisFromTempTint()`, HSL saturation helpers, clipping detection. |
| `wb-estimator-schema.js` | 102 | Stable per-estimator result contract (status/estimate/confidence/diagnostics), `unavailableResult()`, `createEmptyBundle()`. |
| `gray-world-estimator.js` | 128 | Gray World assumption estimator. |
| `white-patch-estimator.js` | 135 | White Patch (brightest-pixel) assumption estimator, with clipping guard. |
| `shades-of-gray-estimator.js` | 142 | Minkowski-norm generalization of Gray World. |
| `neutral-region-estimator.js` | 189 | Detects and averages genuinely low-saturation ("neutral") regions, with a specular-sliver rejection guard. |
| `highlight-shadow-illuminant-estimator.js` | 228 | Percentile-based highlight/shadow band separation + `compareIlluminants()` mixed-light detector. |
| `estimator-confidence.js` | 71 | Shared confidence primitives: `sampleCountFactor()`, `dominancePenaltyMultiplier()`, `agreementScore()`. |
| `estimator-ensemble.js` | 245 | `buildEstimatorEnsemble()`, `computeObjectBiasEvidence()`, `computeMixedLightEvidence()`, `combineWeighted()`, and the top-level `runWhiteBalanceEstimators()` entry point. Zero imports from Candidate/session-writing modules by design (see M9/M9b). |

10 files, 1,609 lines total — all new.

## Modified files

| File | Change |
|---|---|
| `core/single-image/white-balance-intelligence/wb-evidence-extractor.js` | Extended (existing P1H module) to accept the P1I estimator bundle as additional evidence input alongside the existing P1H signals, never as a replacement for them. Preserves R1 fallback: if the P1I bundle is unavailable, extraction behaves exactly as it did in P1H. |
| `core/single-image/single-image-analysis-profile.js` | Registers the new estimator pipeline stage in the analysis profile so it runs as part of the existing analysis sequence (no new top-level pipeline stage — added inside the existing White Balance stage per the project's frozen-pipeline-order rule). |
| `core/single-image/single-image-orchestrator.js` | Invokes `runWhiteBalanceEstimators()` during analysis and wires `traceWbEstimatorPipeline()` for bounded diagnostic trace events, including the stale-generation guard (see M7). |
| `core/single-image/single-image-session.js` | Adds `session.whiteBalanceEstimators` as a new, additive field carrying the P1I bundle for UI/diagnostics consumption. No existing session fields removed or repurposed. |
| `ui/i18n/en.js` | Added English strings for the new Advanced Diagnostics pixel-estimator panel. |
| `ui/i18n/th.js` | Added Thai strings for the same panel (parity with `en.js`). |
| `ui/app.js` | Wired the new Advanced Diagnostics panel rendering and data binding to `session.whiteBalanceEstimators`. |
| `index.html` | Additive markup hook for the new diagnostics panel container. |
| `package.json` | Version bumped `2.8.0` → `2.9.0`; description updated to reference EPIC 2E-P1I. |

## Test / QA files

| File | Purpose |
|---|---|
| `qa/fixtures/epic-2e-p1i/synthetic-pixel-fixtures.mjs` | Deterministic (seeded) synthetic pixel-array fixtures for all 23 test scenes used by the P1I suite. |
| `qa/epic-2e-p1i-pixel-multi-estimator-wb-test.mjs` | 88 numbered test cases + 9 mutation tests (M1–M9b) against real production modules — 98/98 passing. |
| `qa/run-static-suites.mjs` | Registered the new P1I suite in `STATIC_SUITES`. |

## Baseline/manifest maintenance (expected per-round housekeeping, not scope creep)

| File | Change |
|---|---|
| `qa/baselines/lufa42-production-lock-manifest.json` | Regenerated: 192 → 202 locked files, reflecting the 10 new estimator files plus this round's legitimate edits to the files listed above. |
| `qa/baselines/epic-2e-n1-production-invariant.json` | Only the `ui/app.js` hash entry updated (expected every round); the other 5 protected engine-file hashes are unchanged. |

## Untouched (explicitly verified)

`core/lightroom-mapping-engine/index.js`, `core/preset-engine/index.js`, `core/xmp-validator/index.js`, `ui/ui-engine.js`, `core/color-match/reference-xmp-generator.js` — byte-identical, confirmed via the RCM/N1 invariant manifest re-check.
