# EPIC 2E-P1E R3 — Modified Files

## New files

| File | Purpose |
|---|---|
| `core/single-image/color-intelligence/creative-tone-strategy.js` | Scene classification (`classifyScene`) + bounded per-family multipliers (`getFamilyMultiplier`/`getAllFamilyMultipliers`) for the stronger Creative Tone engine (Objective B). |
| `core/single-image/candidate/candidate-export-parity.js` | `computeExportParity()` / `getExportParityMismatches()` — the Candidate-vs-export-safe-range parity check (Objective A). |
| `qa/epic-2e-p1e-r3-parity-creative-tone-test.mjs` | Dedicated R3 test suite: 55 required cases + 7 mutation tests, registered in `qa/run-static-suites.mjs`. |
| `docs/development/P1E_R3_*.md` (10 files, this set) | Round documentation. |

## Edited files

| File | Change |
|---|---|
| `core/single-image/color-intelligence/color-plan-builder.js` | Added `_roundClean()` export-safe integer normalization (applied to every P1E-computed HSL/Grading/Calibration/Presence field); added scene-classification call + `plan.sceneClass`/`plan.sceneReasons`/`plan.layers`; folded the bounded scene multiplier into every existing restoration `fraction` expression (HSL non-skin, Grading, Calibration, Presence). No existing formula removed or duplicated. |
| `core/single-image/color-intelligence/color-intelligence-engine.js` | Propagated `plan.sceneClass`/`plan.sceneReasons`/`plan.layers` onto the `diagnostics` object returned to `candidate-builder.js` — previously dropped here, meaning `candidate.diagnostics.colorIntelligence.sceneClass` was always `null` despite `buildColorPlan()` computing a real value. Genuine latent gap found and fixed during this round's own test-writing (test 36/38 of the new R3 suite). |
| `core/single-image/single-image-orchestrator.js` | (Production-Locked, intentionally modified + disclosed) Added `computeExportParity()` import; added `CREATIVE_TONE_PLAN_CREATED` / `COLOR_PARITY_AUDIT_STARTED` / `COLOR_EXPORT_SAFE_ADJUSTMENT` / `COLOR_PARITY_MATCH`\|`COLOR_PARITY_MISMATCH` / `COLOR_PARITY_AUDIT_COMPLETED` / `CREATIVE_TONE_PLAN_APPLIED` trace events plus `candidate.diagnostics.exportParity` population inside `buildAndCommitCandidate()`, immediately after the existing `CANDIDATE_NORMALIZED` trace. No existing behavior changed. |
| `ui/app.js` | Added `computeExportParity` import; added `renderExportParityDiagnostics(candidate)`; wired the call right after `renderCandidateToSliders()` in the analyze-success path. |
| `index.html` | Added `<details id="exportParityDiagnostics">` Advanced Diagnostics block (notice div + table with `Parameter`/`Candidate current`/`Export expected`/`Match status` columns, `<tbody id="exportParityTableBody">`), inserted after `#successMsg`. Collapsed/opt-in — main UI unchanged. |
| `ui/i18n/en.js`, `ui/i18n/th.js` | Added `exportParityAdvancedDiagnostics`, `exportParitySafeAdjustmentNotice` (exact required bilingual text), `exportParityParameter`, `exportParityCandidateCurrent`, `exportParityExportExpected`, `exportParityMatchStatus`, `exportParityMatchYes`, `exportParityMatchNo` under `appShell`. |
| `core/single-image/candidate/candidate-schema.js` | Added `exportParity: null` to the `diagnostics` object in `createEmptyCandidate()` (additive-only, right after `colorIntelligence: null`). |
| `qa/epic-2e-p1e-color-intelligence-test.mjs` | Test 87 updated to compute its expected Grading Saturation value via the real `classifyScene()`/`getFamilyMultiplier()` functions (instead of a hand-duplicated literal), reflecting the intentional R3 scene-multiplier addition; wrapped expected values in `Math.round()` to match the new `_roundClean()` behavior. Still 94/94 PASS. |
| `qa/run-static-suites.mjs` | Registered `qa/epic-2e-p1e-r3-parity-creative-tone-test.mjs`. |
| `package.json` | Version `2.5.1` → `2.5.2`; description updated to "LUMIXA AI EPIC 2E-P1E R3 — XMP Color Parity Repair and Stronger Creative Tone Engine". No script changes — all existing `npm run` commands still work unmodified. |
| `qa/baselines/lufa42-production-lock-manifest.json` | Regenerated (164 locked files) to reflect the legitimate edits to `single-image-orchestrator.js`, `ui/app.js`, and `index.html` — standard end-of-round regeneration, per this project's established convention (confirmed via `generate-production-lock-manifest.mjs`'s own doc comments), not a lock violation. |
| `qa/baselines/epic-2e-n1-production-invariant.json` | Updated the recorded `ui/app.js` SHA-256 (the only tracked file this round's edits touched) from the pre-round hash to the new, correct one. All other 5 tracked file hashes unchanged. |

## Files examined, NOT modified (confirmed correct/untouched)

`core/xmp-validator/index.js` (Production-Locked — `HARD_LIMITS`,
`quickSafetyClamp()`, `validateFinalPreset()`), `core/preset-engine/index.js`
(Production-Locked — `serializeXMP()`), `core/single-image/candidate/legacy-preset-adapter.js`,
`core/single-image/candidate/candidate-slider-adapter.js`,
`core/single-image/candidate/candidate-validator.js`,
`core/single-image/xmp-fidelity/candidate-xmp-comparator.js`,
`core/single-image/xmp-fidelity/xmp-property-map.js`,
`core/single-image/xmp-fidelity/xmp-fidelity-gate.js`,
`core/single-image/color-intelligence/evidence-color-signals.js`,
`core/single-image/color-intelligence/color-intelligence-schema.js`.
