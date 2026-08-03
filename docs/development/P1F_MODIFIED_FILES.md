# P1F Modified Files

## New files (10)

| File | Purpose |
|---|---|
| `core/single-image/basic-tone-intelligence/basic-tone-schema.js` | Constants, BOUNDS, SCENE_CLASS, strength scalars |
| `core/single-image/basic-tone-intelligence/dynamic-range-classifier.js` | `classifyDynamicRange()` |
| `core/single-image/basic-tone-intelligence/exposure-recommendation.js` | `computeExposureRecommendation()` |
| `core/single-image/basic-tone-intelligence/highlight-shadow-recovery.js` | `computeHighlightRecovery()` / `computeShadowRecovery()` |
| `core/single-image/basic-tone-intelligence/black-white-point-planner.js` | `computeWhitesRecommendation()` / `computeBlacksRecommendation()` |
| `core/single-image/basic-tone-intelligence/local-contrast-planner.js` | `computeContrastRecommendation()` / `computeLocalContrastDetail()` |
| `core/single-image/basic-tone-intelligence/basic-tone-guardrails.js` | `applyBasicToneGuardrails()` |
| `core/single-image/basic-tone-intelligence/basic-tone-lineage.js` | `buildBasicToneLineage()` / `summarizeBasicToneDiagnostics()` |
| `core/single-image/basic-tone-intelligence/basic-tone-plan-builder.js` | `buildBasicTonePlan()` orchestrator |
| `qa/epic-2e-p1f-basic-tone-intelligence-test.mjs` | 70 required test cases + 7 mutation tests (77/77 PASS) |
| `qa/epic-2e-p1f-browser-qa.mjs` | 6-scenario Browser QA script (honest `BROWSER_BINARY_UNAVAILABLE` in this sandbox) |

## Edited files (7)

| File | Change |
|---|---|
| `core/single-image/candidate/candidate-builder.js` | Added `buildBasicTonePlan()` import + call, writing `candidate.basic.{exposure,contrast,highlights,shadows,whites,blacks,texture,clarity,dehaze}` and `candidate.diagnostics.basicToneIntelligence`, positioned between the raw-preset reshape and P1E's `applyColorIntelligence()` call |
| `ui/app.js` | Added `renderBasicToneDiagnostics(candidateResult.candidate)` call plus the full `renderBasicToneDiagnostics()` function (reusing the already-imported `computeExportParity`) |
| `index.html` | Added `<details id="basicToneDiagnostics">` Advanced Diagnostics section (summary, `#basicToneSummary`, table with `#basicToneTableBody`), placed immediately after the existing `exportParityDiagnostics` block |
| `ui/i18n/en.js` | Added 6 new `appShell.basicTone*` keys |
| `ui/i18n/th.js` | Added 6 new `appShell.basicTone*` keys (Thai) |
| `qa/epic-2e-p1c-candidate-test.mjs` | 7 assertions (tests 15, 32, 33, 37, 45, 49, 53) updated with explanatory comments — Basic fields are now P1F-computed, not raw-preset passthroughs; underlying invariants unchanged, only the stale literal expectations were corrected. Still 86/86 PASS |
| `qa/run-static-suites.mjs` | Registered `qa/epic-2e-p1f-basic-tone-intelligence-test.mjs` |
| `package.json` | `version` → `2.6.0`; `description` → "LUMIXA AI EPIC 2E-P1F — Basic Tone Intelligence and Adaptive Dynamic Range" |

## Regenerated (not hand-edited)

| File | Reason |
|---|---|
| `qa/baselines/lufa42-production-lock-manifest.json` | File count 164 → 173 (9 new basic-tone-intelligence modules); re-verified byte-stable at 173 after every subsequent locked-file edit in this EPIC |
| `qa/baselines/epic-2e-n1-production-invariant.json` | `files['ui/app.js']` SHA-256 updated once, deliberately, for the Advanced Diagnostics UI addition |

## Never touched

`core/basic-panel-engine/index.js`, `core/lightroom-mapping-engine/index.js`,
`core/xmp-validator/index.js`, `core/preset-engine/index.js`,
`core/single-image/color-intelligence/*`, `core/single-image/xmp-fidelity/*`,
`core/single-image/candidate/candidate-export-parity.js`,
`core/single-image/candidate/legacy-preset-adapter.js`,
`core/single-image/candidate/candidate-schema.js` — root cause is fully
contained in the new modules plus the single, documented, additive
insertion point in `candidate-builder.js`.
