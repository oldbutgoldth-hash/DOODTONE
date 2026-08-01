# EPIC 2E-P1A — Modified Files

Baseline: EPIC 2E-P0.8A (`LU2DCD~1.ZIP`). Everything below is additive
except `ui/app.js`, `qa/run-static-suites.mjs`, and
`qa/baselines/epic-2e-n1-production-invariant.json`, all three of which
are minimal, targeted edits.

## New files (7) — `core/single-image/`

| File | Lines (approx) | Purpose |
|---|---|---|
| `core/single-image/single-image-session.js` | ~230 | Session factory, status/module-state enums, `EVIDENCE_KEYS`, shape validation, mutation helpers |
| `core/single-image/single-image-session-store.js` | ~90 | Single-slot active-Session registry, generation-ownership choke-point (`updateActiveSession`) |
| `core/single-image/single-image-analysis-profile.js` | ~280 | Declarative `SINGLE_IMAGE_FULL` module table (23 real Core modules) |
| `core/single-image/evidence-normalizer.js` | ~75 | Wraps raw Core results into the stable evidence contract |
| `core/single-image/single-image-analysis-cache.js` | ~70 | Dedicated fingerprint-keyed cache, separate from RCM's `analysis-cache.js` |
| `core/single-image/legacy-state-adapter.js` | ~85 | One-way `Session.evidence → state.last*` sync (`LEGACY_MAP`) |
| `core/single-image/single-image-orchestrator.js` | ~320 | Lifecycle driver; the only new module `ui/app.js` imports |

Every one of these 7 files is imported and actually invoked from
`ui/app.js` — none is a dead scaffold. `single-image-orchestrator.js`
imports all 6 of the others; `ui/app.js` imports only the orchestrator.

## New files — QA

| File | Purpose |
|---|---|
| `qa/epic-2e-p1a-single-image-session-test.mjs` | 25 required automated test cases against real production modules |
| `qa/epic-2e-p1a-single-image-session-browser-test.mjs` | 12 required real-Chromium scenarios; fails closed (no fabricated PASS) |
| `qa/epic-2e-p1a-single-image-session-browser-results.json` | Generated result artifact from the browser test's actual (fail-closed) run |

## New files — Documentation (this deliverable)

`P1A_SOURCE_LINEAGE_AUDIT.md`, `P1A_SINGLE_IMAGE_SESSION_ARCHITECTURE.md`,
`P1A_SINGLE_IMAGE_EVIDENCE_CONTRACT.md`, `P1A_LEGACY_COMPATIBILITY_MAP.md`,
`P1A_MODIFIED_FILES.md` (this file), `P1A_RELEASE_NOTES.md`,
`P1A_QA_REPORT.md`, and the working audit notes `AUDIT_NOTES_RAW.md`.

## Edited files (3)

### `ui/app.js` (3115 → ~3150 lines)

SHA-256: `1a8c219c2365a4462e6ed224f30e57ad1da1673fef34063a4e9eed41a42516a7`
(P0.8A) → `443998f10d132a5736986838c938e93ba915cc222654ef84e4841e60a812c78b` (P1A).

All edits are additive wrapping around existing `state.last* = value`
write sites — no surrounding UI-rendering/DOM logic was touched:

1. Added `import * as singleImageOrchestrator from '../core/single-image/single-image-orchestrator.js';`
2. Added `let activeUploadTicket = null;` near the existing `analysisRenderGeneration` declaration.
3. `loadFile(file)` made `async`; calls `beginUpload(file)` right after the MIME guard, before `handleReset()`.
4. `img.onload`/`img.onerror` inside `loadFile()` call `markImageDecoded`/`markImageDecodeFailed`.
5. Top of `runAnalysis()`: calls `startAnalysisTicket()`; returns immediately if it yields no ticket (duplicate-Analyze guard).
6. Every `state.lastX = value;` write site inside `runAnalysis()` (histogram, imageAnalysisCore, palette, harmony, skinTone/whiteBalance/hsl/colorGrading/toneCurves/calibration, basicPanel, styleRecognition, styleFeatureGraph, styleFingerprint, validation, benchmark, decisionReport, referenceTransfer, processingLog — ~20 sites) now calls `commitEvidence()`/`commitFromSettled()` first; required-module failures return early exactly as the pre-existing code already did on falsy values.
7. Before `applyPresetToSliders(finalPreset)`: added `commitCandidate()` call; returns early if rejected.
8. After the Visual Preview block completes (still inside the outer `try`): `completeAnalysis(ticket)`.
9. Outer `catch (err)`: added `failAnalysis(ticket, err)`.
10. `handleReset()`: added `resetActiveSession(state)` + `activeUploadTicket = null` right after the existing `reviewConsoleController.resetTransientUiState()` call.

**Explicitly untouched inside `ui/app.js`:** the entire Visual Preview
Comparison / Controlled V2 rendering block, `applyPresetToSliders()`,
`readSlidersAsPreset()`, `handleDownload()`, `bindSliders()`,
`setupFileHandlers()`'s DOM wiring itself, and every function outside
`loadFile`/`runAnalysis`/`handleReset`.

### `qa/run-static-suites.mjs`

Added one line registering the new P1A static test in the suite list,
with a section-header comment. No other changes.

### `qa/baselines/epic-2e-n1-production-invariant.json`

Updated only the `ui/app.js` SHA-256 hash entry to reflect the
intentional, spec-required P1A edit (see above). The other 5 pinned
file hashes (`lightroom-mapping-engine/index.js`, `preset-engine/index.js`,
`xmp-validator/index.js`, `ui/ui-engine.js`,
`reference-xmp-generator.js`) and the `productionLocks` object are
unchanged — verified byte-identical to the P0.8A baseline (see
`P1A_QA_REPORT.md`).

## Regenerated (not hand-edited)

`qa/baselines/lufa42-production-lock-manifest.json` — regenerated via
`node qa/baselines/generate-production-lock-manifest.mjs`, now covering
139 files (was 132 in P0.8A; +7 for the new `core/single-image/*.js`
files).

## `package.json`

`version`: `2.0.7.3` → `2.1.0`. `description` updated to reference
EPIC 2E-P1A. No script entries removed; `test:static` now also runs the
new P1A suite via `qa/run-static-suites.mjs`.

## Confirmed untouched (byte-identical to P0.8A baseline)

`core/lightroom-mapping-engine/index.js`, `core/xmp-validator/index.js`,
`core/preset-engine/index.js`, `ui/ui-engine.js`,
`core/decision-engine/index.js`,
`core/preview-rendering/visual-preview-render-plan-v2.js`,
`core/lightroom-mapping-engine/mapping-v2-overlay-preview-sandbox.js`,
`index.html`, `ui/reference-color-match-panel.js`,
`core/color-match/reference-xmp-generator.js`,
`core/color-match/candidate-preview-renderer.js`,
`core/curve-engine/index.js`, `core/generation-control.js`,
`core/analysis-cache.js`, `core/preview-state-machine.js`,
`core/candidate-schema.js`, `core/core-runner.js`.
