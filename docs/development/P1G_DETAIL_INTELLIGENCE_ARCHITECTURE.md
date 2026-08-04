# P1G Detail Intelligence Architecture

## Purpose

EPIC 2E-P1G replaces the two hardcoded Detail literals this project's
own audit traced to `core/lightroom-mapping-engine/index.js`
(`sharp = 40`, `noise = isPortrait ? 20 : 10`) with an evidence-driven
Detail Plan, following the exact architectural pattern P1F established
for the Basic panel and P1E established for Color: a pure,
`candidate`-free planning layer that `candidate-builder.js` alone
writes into the Candidate.

## Module map (`core/single-image/detail-intelligence/`)

| Module | Responsibility |
|---|---|
| `detail-schema.js` | Constants only — `STRENGTH_MODE`, `STRENGTH_SCALARS`, `DETAIL_SCENE_FLAGS`, `SHARPENING_BUCKETS`, `NOISE_REDUCTION_BUCKETS`, `BOUNDS`, thresholds, `buildEmptyDetailPlan()`. |
| `detail-evidence-extractor.js` | Turns raw `session.evidence` (imageAnalysis, skin, stats) into bounded 0-1 Detail evidence scalars. |
| `edge-detail-classifier.js` | Non-exclusive scene-flag classification (`classifyDetailScene()`) from the extracted evidence. |
| `noise-profile-estimator.js` | Bucket selection + base-strength estimate for Luminance Noise Reduction. |
| `sharpening-planner.js` | `planSharpening()` — bucket + strength math for Sharpening. |
| `noise-reduction-planner.js` | `planNoiseReduction()` — bucket + strength math for Luminance/Color Noise Reduction. |
| `detail-guardrails.js` | `applyDetailGuardrails()` — the SOLE safety net (Layer A) for both fields; fail-closed on NaN/Infinity, skin/motion-blur/low-detail caps. |
| `detail-lineage.js` | `buildDetailLineage()` / `summarizeDetailDiagnostics()` — explainability records for the Advanced Diagnostics panel. |
| `detail-plan-builder.js` | `buildDetailPlan(evidence, opts)` — orchestrates all of the above. Pure; takes no `candidate` argument. |

## Data flow

```
session.evidence.{imageAnalysis, skin, stats}
  + candidate.diagnostics.basicToneIntelligence (P1F, read-only)
  + candidate.basic.texture / .clarity (P1F, already-final, read-only)
       │
       ▼
extractDetailEvidence()  →  classifyDetailScene()
       │                          │
       ▼                          ▼
planSharpening()            planNoiseReduction()
       │                          │
       └────────────┬─────────────┘
                     ▼
          applyDetailGuardrails()   (Layer A — the only safety net)
                     │
                     ▼
            buildDetailPlan() return value
                     │
                     ▼  (candidate-builder.js writes this, and only this)
   candidate.detail.sharpening / candidate.detail.noiseReduction
   candidate.diagnostics.detailIntelligence
```

## Composition order

`candidate-builder.js`'s `buildCandidateFromSession()` runs, in this
exact order: raw-preset reshape → P1F's `buildBasicTonePlan()` writes
`candidate.basic.*` → P1E's `applyColorIntelligence()` writes
`candidate.hsl/.grading/.cal/.basic.vibrance/.saturation` → **P1G's
`buildDetailPlan()` writes `candidate.detail.sharpening/.noiseReduction`**
→ lineage entries / `autoValues` snapshot / `validateCandidate()`. See
`P1G_P1F_DETAIL_COORDINATION_POLICY.md` for the full ownership-boundary
rationale.

## Why `buildDetailPlan()` never touches other Candidate fields

`buildDetailPlan(evidence, opts)` takes no `candidate` parameter at
all — structurally, not just by convention, it cannot write to
`candidate.basic/.hsl/.grading/.cal/.whiteBalance`. Only
`candidate-builder.js` itself assigns the plan's `finalValues` onto
`candidate.detail.sharpening`/`.noiseReduction`. This is verified by
test 1 in `qa/epic-2e-p1g-detail-intelligence-test.mjs` (source-level,
with comments stripped, so the module's own doc comments describing
what it must NOT do can't produce a false match).

## What P1G never touches

`core/lightroom-mapping-engine/index.js` (the literal root-cause file
— left untouched, exactly like P1F left its own root-cause file
untouched, since `candidate-builder.js` overwrites the passthrough
downstream), `core/xmp-validator/index.js`, `core/preset-engine/index.js`,
`core/color-match/*` (Reference Color Match), the Preview/pixel
pipeline, and P1D's Fidelity Gate mechanics. `candidate.detail.colorNoiseReduction`
remains the pre-existing hardcoded `25` — see
`P1G_SUPPORTED_XMP_DETAIL_FIELDS.md`.
