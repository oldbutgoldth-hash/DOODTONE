# EPIC 2E-P1A — Source Lineage Audit

Baseline: `LU2DCD~1.ZIP` (the EPIC 2E-P0.8A project — verified present via
`EPIC_2E_P0_8A_RELEASE_NOTES.md`, `EPIC_2E_P0_8A_MODIFIED_FILES.md`,
`EPIC_2E_P0_8A_QA_REPORT.md`, `EPIC_2E_P0_8A_POSTERIZATION_ROOT_CAUSE_REPORT.md`,
`qa/epic-2e-p0-8a-*`, `core/color-match/candidate-preview-renderer.js`,
`core/curve-engine/index.js`, all confirmed present before any P1A edit).

This document is the formal deliverable version of the repository audit
required before any P1A design/implementation work began. It was
produced by directly reading `ui/app.js` (3115 lines) and every Core
module it imports, line by line — not by assumption. No source files
were modified while gathering this audit. All findings below were the
factual basis for the Session contract, module structure, and
integration points implemented in P1A.

---

## 1. Single-image upload entry point

`setupFileHandlers()` (`ui/app.js:1148-1163`), called once from
`waitForRoot()` (`ui/app.js:660`). Two file inputs (`fileIn`, `fileIn2`)
and one drop zone (`dropZone`) all funnel into **`loadFile(file)`**
(`ui/app.js:1163-1191`), which rejects non-image MIME types, calls
`handleReset()` unconditionally first, sets `state.currentRetainedFile`,
decodes via `FileReader.readAsDataURL`, and calls `runAnalysis()` from
`img.onload`.

## 2. The real "Analyze" action

There is no separate Analyze button for the initial run — analysis
starts automatically from `img.onload` inside `loadFile()`. The only
explicit re-trigger is **Re-analyze** (`handleReanalyze()`,
`ui/app.js:2950-2953`), which calls `runAnalysis()`
(`ui/app.js:2035`, `async function runAnalysis()`, no parameters — it
reads `<img id="previewImg">` and the `state` closure directly).

## 3. Every Core module invocation in the single-image path (call order)

1. `analyzeImage(img)` — `core/histogram-engine/index.js` → `state.lastStats`
2. `analyzeImageCore(img)` — `core/image-analysis-core/index.js` (Worker-backed, fire-and-forget) → `state.lastImageAnalysis`
3. `extractPalette(img)` — `core/kmeans-engine/index.js` (fire-and-forget, parallel with #2) → `state.lastPalette`
4. `generateHarmonies(palette)` — `core/color-harmony-engine/index.js` (chained after #3) → `state.lastHarmony`
5. `classifySkin(img)` + `detectColorCast(img)` — `core/skin-classifier`, `core/color-cast-detector`, via `Promise.allSettled`
6. `classifyScene(stats, skinClassRes)` — `core/scene-classifier/index.js` (local var only, no legacy mirror)
7. Seven engines via one `Promise.allSettled`: `analyzeSkinTone` (→ merged into `state.lastSkin`), `analyzeWhiteBalance` (→ `state.lastWB`), `analyzeHSL` (→ `state.lastHSL`), `analyzeColorGrading` (`core/colorgrading-ai-engine`, → `state.lastGrading`), `generateToneCurves` (`core/tone-curve-ai-engine`, → `state.lastToneCurves`), `analyzeCalibration` (→ `state.lastCalibration`), `recognizeStyle` (→ `state.lastStyleRecognition`)
8. `generateBasicPanel(stats)` — synchronous — → `state.lastBasic`
9. `buildStyleFeatureGraph(fusionCtx)` — `core/feature-fusion-engine` → `state.lastStyleFeatureGraph`
10. `buildStyleFingerprint({...})` — `core/style-fingerprint` → `state.lastStyleFingerprint`
11. `buildFinalPreset({...})` — `core/decision-engine/index.js:146` — the single-image Candidate builder
12. `validateFinalPreset(...)` / `quickSafetyClamp(...)` — `core/xmp-validator`
13. `benchmarkStylePreservation({...})` — `core/style-benchmark-engine` → `state.lastBenchmark`
14. `buildDecisionReport({...})` — `core/decision-report-engine` → `state.lastDecisionReport`
15. `buildReferenceTransferReport({...})` — `core/reference-transfer-engine` → `state.lastReferenceTransfer` (part of the single-image pipeline's own output, NOT Reference Color Match)

Modules named in illustrative specs that do **not** exist/are not called
as named: `core/colorgrading-engine` (unused; real import is
`colorgrading-ai-engine`), `core/image-analysis` (not an engine;
real module is `core/image-analysis-core`).

## 4. Mutable state variables holding analysis results

`const state = {...}` (`ui/app.js:93-149`) declares ~26 `last*` fields
up front; several more (`lastStyleFingerprint`, `lastValidationReport`,
`lastSideBySideComparison`, etc.) are declared implicitly by first
assignment. All are cleared in `handleReset()`. Full write-site list
captured in the P1A working notes and mirrored 1:1 by
`EVIDENCE_KEYS`/`LEGACY_MAP` — see `P1A_LEGACY_COMPATIBILITY_MAP.md`.

## 5. Candidate construction

`buildFinalPreset(inputs)` (`core/decision-engine/index.js:146`, called
`ui/app.js:2349`) reads `stats`, `basic`, `wb`, `skin`, `hsl`,
`calibration`, `grading`, `toneCurves`, `scene`, `cast`,
`styleRecognition`, `palette`, `harmony`, `styleFingerprint`. Output
passes through `validateFinalPreset()` and optionally
`quickSafetyClamp()` to produce `finalPreset`. **`finalPreset` is never
run through `core/candidate-schema.js`** — that module is exclusive to
`ui/reference-color-match-panel.js`. The single-image Candidate has no
schema-validation step of that kind; P1A does not add one (out of
scope — would be a Candidate-schema change).

## 6. Slider synchronization

`applyPresetToSliders(preset)` (analysis → sliders, called once from
`runAnalysis()`). `readSlidersAsPreset()` (sliders → export preset,
reads live DOM values, NOT `state.lastX`). These two functions were not
modified by P1A.

## 7. XMP serialization and download

`handleDownload()` (`ui/app.js:2930-2948`) calls
`readSlidersAsPreset()` → `quickSafetyClamp()` → `serializeXMP()` →
`downloadXMP()` (`core/preset-engine`). It never reads
`state.lastDecisionReport`/`finalPreset`/any Session evidence directly,
and it triggers no analysis. P1A left this function untouched — verified
by grep showing zero `singleImageOrchestrator` references inside it.

## 8. Reset / new-image behavior

`handleReset()` (`ui/app.js:2955-3057`) nulls ~26 `state.last*` fields,
releases preview-geometry resources, hides/shows DOM sections, and
resets both file inputs. P1A added exactly two lines immediately after
the existing `reviewConsoleController.resetTransientUiState()` call:
`singleImageOrchestrator.resetActiveSession(state)` and
`activeUploadTicket = null`.

## 9. Generation/abort mechanism

`core/generation-control.js` exists but **`ui/app.js` never imports
it** — confirmed by grep. The single-image path instead uses a
hand-rolled `analysisRenderGeneration` counter (`ui/app.js:2141`) that
guards only the Visual Preview/Interactive-Before-After **render**
callbacks, not the `state.last*` **write** sites. `generation-control.js`'s
sole real consumer is `ui/reference-color-match-panel.js`. This gap —
Core-write races with zero generation protection — is the confirmed
architectural defect P1A's generation-ownership pattern (Session store's
`updateActiveSession()`) closes.

## 10. Analysis cache

`core/analysis-cache.js` exists (`getCachedReferenceAnalysis`/
`getCachedTargetAnalysis`/etc. — named for the two-image Reference Color
Match workflow) but **`ui/app.js` never imports it**. The single-image
path re-runs every Core engine from scratch on every `runAnalysis()`
call. Sole real consumer: `ui/reference-color-match-panel.js`. P1A's
`single-image-analysis-cache.js` is a dedicated, separate cache — it
does not touch or extend `analysis-cache.js`.

## 11. Image fingerprint/hash function

No fingerprint or hash function exists anywhere in the single-image path
prior to P1A. `state.currentRetainedFile` (the raw `File` object) was
the only per-upload identity, and it was never hashed. P1A's
`computeImageFingerprint()` in `single-image-orchestrator.js` is new.

## 12. Web Worker for Image Analysis Core

Fully internal to `core/image-analysis-core/index.js` (`_getWorker()`,
`_runInWorker()`, 20s timeout, sticky fallback to synchronous
`pixel-math.js` on Worker failure). `ui/app.js` has no awareness of the
Worker at all and P1A does not touch it.

## 13. Async control flow and overlapping-call guards

`runAnalysis()` is one large `async function` with sequential `await`s
for stages 1-2, two fire-and-forget promise chains kicked off early and
awaited later, and a nested `try` around Visual Preview rendering that
swallows its own errors. **No overlapping-call guard existed** for
either `handleReanalyze()` (no disabled-state/re-entrancy check) or the
file input/drop handlers (uploading image B while image A's
`runAnalysis()` is in flight starts a second, fully concurrent
`runAnalysis()`; `handleReset()` nulls `state.last*` synchronously but
does not cancel image A's in-flight promises, which can still write into
`state.last*` after image B has started). This is the exact race P1A's
`startAnalysisTicket()`/generation-ownership checks close.

## 14. package.json (pre-P1A values)

```json
"name": "lumixa-epic-2e-p0-7-pipeline-runtime",
"version": "2.0.7.3",
"description": "LUMIXA AI P0.7 R3 — Pipeline Runtime Architecture: ..."
```

## Boundary confirmation: Reference Color Match's exclusive dependencies

`core-runner.js`, `generation-control.js`, `analysis-cache.js`,
`preview-state-machine.js`, `candidate-schema.js` are imported **only**
by `ui/reference-color-match-panel.js`. `core/export-manager.js` has no
consumer anywhere. `ui/app.js` (single-image controller) imports none of
these six modules, before or after P1A. P1A's new `core/single-image/*`
modules are entirely separate infrastructure and do not import from, or
get imported by, any of the six RCM-exclusive modules.
