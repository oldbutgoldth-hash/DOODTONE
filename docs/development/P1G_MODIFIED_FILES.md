# P1G Modified Files

## New files (11)

| File | Purpose |
|---|---|
| `core/single-image/detail-intelligence/detail-schema.js` | Constants, `BOUNDS`, `SHARPENING_BUCKETS`, `NOISE_REDUCTION_BUCKETS`, `DETAIL_SCENE_FLAGS`, strength scalars, `buildEmptyDetailPlan()` |
| `core/single-image/detail-intelligence/detail-evidence-extractor.js` | `extractDetailEvidence()` |
| `core/single-image/detail-intelligence/edge-detail-classifier.js` | `classifyDetailScene()` |
| `core/single-image/detail-intelligence/noise-profile-estimator.js` | `selectNoiseBucket()` / `estimateBaseNoiseStrength()` |
| `core/single-image/detail-intelligence/sharpening-planner.js` | `planSharpening()` |
| `core/single-image/detail-intelligence/noise-reduction-planner.js` | `planNoiseReduction()` |
| `core/single-image/detail-intelligence/detail-guardrails.js` | `applyDetailGuardrails()` |
| `core/single-image/detail-intelligence/detail-lineage.js` | `buildDetailLineage()` / `summarizeDetailDiagnostics()` |
| `core/single-image/detail-intelligence/detail-plan-builder.js` | `buildDetailPlan()` orchestrator |
| `qa/epic-2e-p1g-detail-intelligence-test.mjs` | 60 required numbered test cases + 7 mutation tests (67/67 PASS) |
| `qa/epic-2e-p1g-browser-qa.mjs` | 6-scenario Browser QA script (honest `BROWSER_BINARY_UNAVAILABLE` in this sandbox) |

## Edited files (8)

| File | Change |
|---|---|
| `core/single-image/candidate/candidate-builder.js` | Added `buildDetailPlan()` import + call, writing `candidate.detail.{sharpening,noiseReduction}` and `candidate.diagnostics.detailIntelligence`, positioned between P1E's `applyColorIntelligence()` call and the lineage-entries/`autoValues` snapshot block |
| `core/single-image/single-image-orchestrator.js` | Added the `DETAIL_*` bounded trace-event block (`DETAIL_ANALYSIS_STARTED` … `DETAIL_EXPORT_PARITY_MISMATCH`) inside `buildAndCommitCandidate()`, immediately after `CREATIVE_TONE_PLAN_APPLIED` and before `CANDIDATE_VALIDATION_STARTED` |
| `ui/app.js` | Added `renderDetailIntelligenceDiagnostics(candidateResult.candidate)` call plus the full `renderDetailIntelligenceDiagnostics()` function and `DETAIL_INTEL_FIELDS` constant, placed immediately before `renderXmpFidelityStatus()` |
| `index.html` | Added `<details id="detailIntelDiagnostics">` Advanced Diagnostics section (summary, `#detailIntelSummary`, `#detailIntelEvidence`, 4-column table with `#detailIntelTableBody`, `#detailIntelColorNrNote`), placed immediately before the existing P1D XMP Fidelity status block |
| `ui/i18n/en.js` | Added 12 new keys under a new "EPIC 2E-P1G — Detail Intelligence Advanced Diagnostics" comment block |
| `ui/i18n/th.js` | Added the same 12 keys (Thai), including the exact required bilingual `FOCUS_LIMITED_TEXT` string |
| `qa/epic-2e-p1c-candidate-test.mjs` | Test 53's pre/post equivalence check extended with `P1G_OWNED_DETAIL_KEYS = new Set(['sharp','noise'])` in its exclusion set — Detail fields now intentionally diverge from the raw-preset passthrough, same class of change P1F made to this test previously. Still 86/86 PASS |
| `qa/run-static-suites.mjs` | Registered `qa/epic-2e-p1g-detail-intelligence-test.mjs` |
| `package.json` | `version` → `2.7.0`; `description` → "LUMIXA AI EPIC 2E-P1G — Detail Intelligence, Sharpening and Noise Reduction" |

## Regenerated (not hand-edited)

| File | Reason |
|---|---|
| `qa/baselines/lufa42-production-lock-manifest.json` | File count 173 → 182 (9 new detail-intelligence modules); re-verified byte-stable at 182 after every subsequent locked-file edit in this EPIC |
| `qa/baselines/epic-2e-n1-production-invariant.json` | `files['ui/app.js']` SHA-256 updated once, deliberately, for the Detail Intelligence Advanced Diagnostics UI addition |

## Never touched (R1 scope)

`core/lightroom-mapping-engine/index.js` (root-cause file — left
untouched; `candidate-builder.js` overwrites its passthrough
downstream, exactly like P1F's and P1E's own root-cause files),
`core/xmp-validator/index.js` (**edited in R2 — see below**),
`core/preset-engine/index.js`,
`core/color-match/*` (Reference Color Match), the Preview/pixel
pipeline, P1D's Fidelity Gate mechanics
(`core/single-image/xmp-fidelity/*`),
`core/single-image/candidate/candidate-export-parity.js`,
`core/single-image/candidate/legacy-preset-adapter.js`,
`core/single-image/basic-tone-intelligence/*`,
`core/single-image/color-intelligence/*` — root cause is fully
contained in the new detail-intelligence modules plus the two single,
documented, additive insertion points in `candidate-builder.js` and
`single-image-orchestrator.js`.

---

## EPIC 2E-P1G R2 — Detail Export Safety Clamp: modified files

### Edited (4)

| File | Change |
|---|---|
| `core/xmp-validator/index.js` | The one Production-Locked file this round is allowed to touch. Added `HARD_LIMITS.detail = {sharpening:{min:0,max:40}, noiseReduction:{min:0,max:40}}`; added `_clampDetailPanel(p, HARD_LIMITS.detail, adjustments)` call inside `quickSafetyClamp()` immediately after the existing `_clampBasicPanel(...)` call; added the `_clampDetailPanel()` helper itself, right after `_clampBasicPanel()`'s own definition. No existing Basic/WB/HSL/Calibration/Presence rule was touched. |
| `index.html` | Added `<div id="detailIntelSafeAdjustmentNotice">` inside the existing `#detailIntelDiagnostics` Advanced Diagnostics section, between `#detailIntelSummary` and `#detailIntelEvidence`. |
| `ui/app.js` | `renderDetailIntelligenceDiagnostics()`: added the `safeAdjustmentNoticeEl` lookup; hoisted the `computeExportParity(candidate).entries` computation to function scope so it's shared; added a block that shows/hides and sets the bilingual notice text based on whether either Detail field's `candidateVsExportMatch` is `false` in a freshly-recomputed parity result (not a stale build-time snapshot). |
| `ui/i18n/en.js`, `ui/i18n/th.js` | Added one new key each — `detailExportSafeAdjustmentNotice` — under a new "EPIC 2E-P1G R2" comment block. |

### New (2)

| File | Purpose |
|---|---|
| `qa/epic-2e-p1g-r2-detail-export-safety-clamp-test.mjs` | 35/35 PASS — 32 required numbered test cases + self-consistency check + mutation-evidence sub-checks, run against real production modules |
| `docs/development/P1G_R2_DETAIL_EXPORT_SAFETY_CLAMP.md`, `P1G_R2_QA_REPORT.md` | This round's primary writeup + QA report |

### Edited (test file, 1)

| File | Change |
|---|---|
| `qa/epic-2e-p1g-detail-intelligence-test.mjs` | Mutation test M4 rewritten (old: proved the Layer-B gap existed / new: proves it's fixed); new mutation test M4b added (identical proof for Noise Reduction); fixed a pre-existing, unrelated bug at tests 7 and 46 (`gateReport?.comparisonResult?.comparisons` → `gateReport?.comparisons`, the real return-object path) — both were previously vacuously passing. See `P1G_R2_QA_REPORT.md` for detail. |
| `qa/run-static-suites.mjs` | Registered `qa/epic-2e-p1g-r2-detail-export-safety-clamp-test.mjs`. |
| `package.json` | `version` → `2.7.1`; `description` → "LUMIXA AI EPIC 2E-P1G R2 — Detail Export Safety Clamp". |

### Regenerated (not hand-edited)

| File | Reason |
|---|---|
| `qa/baselines/epic-2e-n1-production-invariant.json` | `files['core/xmp-validator/index.js']` and `files['ui/app.js']` SHA-256 updated to reflect this round's legitimate edits. The other 4 pinned entries (`lightroom-mapping-engine`, `preset-engine`, `ui-engine`, `reference-xmp-generator`) confirmed byte-identical (genuinely untouched) before regeneration. |
| `qa/baselines/lufa42-production-lock-manifest.json` | Regenerated; 182 locked files, hashes for `core/xmp-validator/index.js` and `index.html` reflect this round's edits (`ui/app.js` is separately allowlisted in this particular manifest from an earlier EPIC and tracked via the N1 invariant instead). |

### Never touched (R2 scope)

P1G evidence extraction, scene classification, the Sharpening/Noise
Reduction planners, `core/lightroom-mapping-engine/index.js`, P1F's
Basic-tone formulas, P1E's color formulas, the Candidate Store,
`core/preset-engine/index.js` (serializer property names unchanged),
P1D's Fidelity Gate mechanics/comparison policy,
`core/single-image/candidate/candidate-export-parity.js` (zero code
changes needed — it already called `quickSafetyClamp()` internally),
`core/color-match/*` (Reference Color Match), the Preview/pixel
pipeline, every Production-write safety flag.
