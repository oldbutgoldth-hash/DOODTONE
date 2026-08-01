# LUMIXA AI — Single-Image Analysis Workflow: Raw Structural Audit
Date: 2026-08-01
Scope: `ui/app.js` (3115 lines) and the Core modules it drives for the
SINGLE-IMAGE analysis workflow. Reference Color Match
(`ui/reference-color-match-panel.js`) is noted only where relevant as a
boundary marker — it is not otherwise audited here.

All line numbers below refer to the files as they exist right now in
`/work`. No files were modified.

---

## 1. Single-image upload entry point

File input + drop handler are both wired inside `setupFileHandlers()`,
`ui/app.js:1148-1163`, called once from the `waitForRoot()` bootstrap at
`ui/app.js:660`.

```js
// ui/app.js:1149-1150
document.getElementById('fileIn')?.addEventListener('change',  e => loadFile(e.target.files[0]));
document.getElementById('fileIn2')?.addEventListener('change', e => loadFile(e.target.files[0]));

// ui/app.js:1152-1160 (drop zone)
const zone = document.getElementById('dropZone');
if (zone) {
  zone.addEventListener('dragover',  ...);
  zone.addEventListener('dragleave', ...);
  zone.addEventListener('drop', e => {
    e.preventDefault(); ...
    loadFile(e.dataTransfer.files[0]);
  });
}
```

Both the `change` handlers (two separate `<input type=file>` elements,
`fileIn` and `fileIn2`) and the drop handler funnel into the same
function: **`loadFile(file)`**, `ui/app.js:1163-1191`.

`loadFile()`:
- Rejects non-image MIME types.
- Calls `handleReset()` unconditionally first (`ui/app.js:1177`) — even
  on the very first upload — to clear all `state.last*` fields before
  starting a new decode.
- Sets `state.currentRetainedFile = file`.
- Uses `FileReader.readAsDataURL`, sets `img.src`, and on `img.onload`
  sets `state.imageLoaded = true` and calls `runAnalysis()`
  (`ui/app.js:1189`).

## 2. The real "Analyze" action

There is no dedicated "Analyze" button separate from upload — analysis
is triggered automatically by `img.onload` inside `loadFile()`
(`ui/app.js:1189`). The only explicit re-trigger is the **Re-analyze**
button:

```js
// ui/app.js:1163 (handler wiring)
document.getElementById('btnReanalyze')?.addEventListener('click', handleReanalyze);
```

`handleReanalyze()`, `ui/app.js:2950-2953`:
```js
function handleReanalyze() {
  const img = document.getElementById('previewImg');
  if (state.imageLoaded && img?.complete && img.naturalWidth) runAnalysis();
}
```

The actual analysis engine entry point is:

```js
// ui/app.js:2035
async function runAnalysis() { ... }
```
Signature: `async function runAnalysis()` — **no parameters**. It reads
the current `<img id="previewImg">` element and `state` closure
variables directly; it is not passed a file/image/candidate argument.

## 3. Every Core module invocation in the single-image path, in call order

All of the following are called from inside `runAnalysis()`
(`ui/app.js:2035-2757`), imported at the top of `ui/app.js` (lines
10-66). Order given is call order inside `runAnalysis()`, not import
order.

1. **`analyzeImage(img)`** — `core/histogram-engine/index.js`
   → `ui/app.js:2160` (`const stats = await analyzeImage(img);`)
   Result written to `state.lastStats`.

2. **`analyzeImageCore(img)`** — `core/image-analysis-core/index.js`
   → `ui/app.js:2175` (fired async, not awaited immediately;
   `.then()` writes `state.lastImageAnalysis`). Internally this module
   uses a **Web Worker** (`core/image-analysis-core/worker.js`) — see
   Q12 below.

3. **`extractPalette(img)`** — `core/kmeans-engine/index.js`
   → `ui/app.js:2190` (fired async in parallel with #2; writes
   `state.lastPalette`).

4. **`generateHarmonies(palette)`** — `core/color-harmony-engine/index.js`
   → `ui/app.js:2207`, inside the `extractPalette(...).then()` chain,
   after palette resolves. Writes `state.lastHarmony`.

5. **`classifySkin(img)`** and **`detectColorCast(img)`** —
   `core/skin-classifier/index.js` and `core/color-cast-detector/index.js`
   → `ui/app.js:2233-2236`, run together via
   `Promise.allSettled([classifySkin(img), detectColorCast(img)])`.
   `classifySkin` result feeds `skinClassRes`; `detectColorCast` feeds
   `castRes`. Neither is a `state.last*` alone — `skinClassRes` is later
   merged into `state.lastSkin` (see #7).

6. **`classifyScene(stats, skinClassRes)`** — `core/scene-classifier/index.js`
   → `ui/app.js:2257` (`const sceneRes = classifyScene(stats, skinClassRes);`).
   Not stored on `state` directly; held in local `sceneRes`, later
   passed into decision/report builders.

7. **`analyzeSkinTone(img)`**, **`analyzeWhiteBalance(img, {...})`**,
   **`analyzeHSL(img, {...})`**, **`analyzeColorGrading(img, {...})`**,
   **`generateToneCurves(img, stats)`**, **`analyzeCalibration(img, {...})`**,
   **`recognizeStyle(img)`** — 7 engines run together via a single
   `Promise.allSettled([...])` at `ui/app.js:2269-2277`:
   - `analyzeSkinTone` → `core/skintone-engine/index.js` (merged with
     `skinClassRes` into `state.lastSkin`, `ui/app.js:2283-2284`)
   - `analyzeWhiteBalance` → `core/whitebalance-engine/index.js` →
     `state.lastWB` (`ui/app.js:2285`)
   - `analyzeHSL` → `core/hsl-analyzer-engine/index.js` →
     `state.lastHSL` (`ui/app.js:2287`)
   - `analyzeColorGrading` → `core/colorgrading-ai-engine/index.js`
     (**not** `core/colorgrading-engine` — see note below) →
     `state.lastGrading` (`ui/app.js:2288`)
   - `generateToneCurves` → `core/tone-curve-ai-engine/index.js` →
     `state.lastToneCurves` (`ui/app.js:2289`)
   - `analyzeCalibration` → `core/calibration-engine/index.js` →
     `state.lastCalibration` (`ui/app.js:2290`)
   - `recognizeStyle` → `core/style-recognition-engine/index.js` →
     `state.lastStyleRecognition` (`ui/app.js:2292`)

8. **`generateBasicPanel(stats)`** — `core/basic-panel-engine/index.js`
   → `ui/app.js:2291` (`const basic = state.lastBasic = generateBasicPanel(stats);`).
   Note: unlike the other 7, this one is a synchronous, pure call on
   already-computed `stats` — not run inside the `Promise.allSettled`.

9. **`buildStyleFeatureGraph(fusionCtx)`** — `core/feature-fusion-engine/index.js`
   → `ui/app.js:2325` → `state.lastStyleFeatureGraph`.

10. **`buildStyleFingerprint({...})`** — `core/style-fingerprint/index.js`
    → `ui/app.js:2335` → `state.lastStyleFingerprint`.

11. **`buildFinalPreset({...})`** — `core/decision-engine/index.js`
    → `ui/app.js:2349` (signature `export function buildFinalPreset(inputs)`,
    `core/decision-engine/index.js:146`). This is the single-image
    Candidate builder — see Q5.

12. **`validateFinalPreset(rawPreset, styleFingerprint)`** and
    **`quickSafetyClamp(...)`** — `core/xmp-validator/index.js`
    → `ui/app.js:2373` and (conditionally, on `benchmark.details.extremelyUnsafe`)
    `ui/app.js:2402`.

13. **`benchmarkStylePreservation({...})`** — `core/style-benchmark-engine/index.js`
    → `ui/app.js:2382` → `state.lastBenchmark`.

14. **`buildDecisionReport({...})`** — `core/decision-report-engine/index.js`
    → `ui/app.js:2440` → `state.lastDecisionReport`.

15. **`buildReferenceTransferReport({...})`** — `core/reference-transfer-engine/index.js`
    → `ui/app.js:2460` → `state.lastReferenceTransfer`. (Despite the
    name, this is part of the single-image pipeline's own output —
    NOT the separate Reference Color Match feature. It builds a report
    describing how well the single-image preset would transfer/hold up,
    not a cross-image color match.)

### Modules named in the audit brief that do NOT exist / are NOT called in this repo as named

- `core/colorgrading-engine` — **exists as a file**
  (`core/colorgrading-engine/index.js`) but is **not imported by
  `ui/app.js`**. The single-image path imports from
  `core/colorgrading-ai-engine/index.js` instead
  (`ui/app.js:29`, `import { analyzeColorGrading } from '../core/colorgrading-ai-engine/index.js';`).
  `colorgrading-engine` (non-AI) appears to be legacy/unused by the
  live UI; not proven dead here beyond "not imported by app.js".
- `core/image-analysis` — exists as a directory but contains only
  `capture-capability-model.js`, not an `index.js` analysis engine, and
  is not imported by `ui/app.js`. Do not confuse with
  `core/image-analysis-core`, which IS the real engine used (Q3 item 2).
- `core/decision-engine` and `core/decision-report-engine` — both exist
  and ARE called (items 11 and 14 above); listed here only to confirm
  they are real, not to flag as missing.

## 4. Mutable state variables holding analysis results

Declared as one flat object literal `const state = {...}`,
`ui/app.js:93-149`. Real field names (verbatim) and declaration lines:

```js
lastStats:   null,                    // ui/app.js:100
lastPalette: null,                    // ui/app.js:101
lastWB:      null,                    // ui/app.js:102
lastSkin:    null,                    // ui/app.js:103
lastBasic:   null,                    // ui/app.js:104
lastHSL:     null,                    // ui/app.js:105
lastGrading: null,                    // ui/app.js:106
lastToneCurves: null,                 // ui/app.js:107
lastCalibration: null,                // ui/app.js:108
lastHarmony:     null,                // ui/app.js:109
lastImageAnalysis: null,              // ui/app.js:110
lastStyleRecognition: null,           // ui/app.js:111
lastStyleFeatureGraph: null,          // ui/app.js:112
lastBenchmark: null,                  // ui/app.js:113
lastDecisionReport: null,             // ui/app.js:114
lastReferenceTransfer: null,          // ui/app.js:115
lastPreviewSandbox: null,             // ui/app.js:120
lastPreviewReviewState: null,         // ui/app.js:121
lastPreviewReviewGenerationId: null,  // ui/app.js:123
candidateReviewAuditHistory: [],      // ui/app.js:124
lastAnalysisBoxSummaryData: null,     // ui/app.js:130
lastReviewAnnouncement: null,         // ui/app.js:131
lastBuildAnnouncement: null,          // ui/app.js:132
lastProcessingLog: null,              // ui/app.js:133
curveEditor: null,                    // ui/app.js:134
currentRetainedFile: null,            // ui/app.js:139
lastCanonicalSourceEvidence: null,    // ui/app.js:145
lastRenderOutcomeEvidence: null,      // ui/app.js:150
```
Also present but declared implicitly by first assignment (not in the
initial literal — a real inconsistency worth noting for the refactor):
`state.lastStyleFingerprint` (first write `ui/app.js:2336`),
`state.lastValidationReport` (first write `ui/app.js:2378`),
`state.lastSideBySideComparison` (first write `ui/app.js:2588`),
`state.lastVisualPreviewComparisonState`, `state.lastFinalStyleIntent`,
`state.lastResolvedVisualState`, `state.lastVisualPreviewInfoForComparisonNote`,
`state.lastComparisonInnerEl`, `state.curveEditor` reused later. These
are all still cleared explicitly in `handleReset()` (Q8) even though
not declared up front — confirmed by reading `handleReset()` line by
line (`ui/app.js:2955-3057`).

Write sites for the fields exercised by the single-image pipeline —
all inside `runAnalysis()`:
- `state.lastStats` — `ui/app.js:2161`
- `state.lastImageAnalysis` — `ui/app.js:2176` (inside `.then()`)
- `state.lastPalette` — `ui/app.js:2191` (inside `.then()`)
- `state.lastHarmony` — `ui/app.js:2209` (inside same `.then()`, nested try)
- `state.lastSkin` — `ui/app.js:2284`
- `state.lastWB` — `ui/app.js:2285`
- `state.lastHSL` — `ui/app.js:2287`
- `state.lastGrading` — `ui/app.js:2288`
- `state.lastToneCurves` — `ui/app.js:2289`
- `state.lastCalibration` — `ui/app.js:2290`
- `state.lastBasic` — `ui/app.js:2291`
- `state.lastStyleRecognition` — `ui/app.js:2292`
- `state.lastStyleFeatureGraph` — `ui/app.js:2325`
- `state.lastStyleFingerprint` — `ui/app.js:2336`
- `state.lastValidationReport` — `ui/app.js:2378`
- `state.lastBenchmark` — `ui/app.js:2394`
- `state.lastDecisionReport` — `ui/app.js:2450`
- `state.lastReferenceTransfer` — `ui/app.js:2470`
- `state.lastProcessingLog` — `ui/app.js:2475`
- `state.lastAnalysisBoxSummaryData` — `ui/app.js:2534`

All of these are cleared to `null` in `handleReset()`
(`ui/app.js:2955` onward — see Q8).

## 5. Where the Candidate object is constructed (single-image, not Reference Color Match)

Function: **`buildFinalPreset(inputs)`**, `core/decision-engine/index.js:146`,
called from `ui/app.js:2349`:

```js
// ui/app.js:2349-2365
const rawPreset = buildFinalPreset({
  stats, basic, wb, skin, hsl, calibration, grading, toneCurves,
  scene: sceneRes, cast: castRes, styleRecognition,
  palette: state.lastPalette, harmony: state.lastHarmony,
  fingerprint: styleFingerprint,
  controlledPreviewReviewStateV2: null,
});
```

It reads: `stats` (histogram-engine), `basic` (basic-panel-engine),
`wb` (whitebalance-engine), `skin` (merged skin-classifier +
skintone-engine), `hsl` (hsl-analyzer-engine), `calibration`
(calibration-engine), `grading` (colorgrading-ai-engine), `toneCurves`
(tone-curve-ai-engine), `sceneRes` (scene-classifier), `castRes`
(color-cast-detector), `styleRecognition` (style-recognition-engine),
`state.lastPalette` (kmeans-engine), `state.lastHarmony`
(color-harmony-engine), and `styleFingerprint` (style-fingerprint,
itself built from a feature-fusion-engine graph). This raw preset is
then passed through `validateFinalPreset()` (xmp-validator) to produce
`validatedPreset`, then optionally `quickSafetyClamp()`'d if
`benchmark.details.extremelyUnsafe`, producing `finalPreset`
(`ui/app.js:2373-2409`).

**Important: `finalPreset` is never itself run through
`core/candidate-schema.js`'s `normalizeCandidate`/`validateCandidate`.**
`candidate-schema.js` is imported and used exclusively by
`ui/reference-color-match-panel.js` (see Q9/Q10 below) — the
single-image "Candidate" (`finalPreset`) has no formal schema
validation of that kind at all.

## 6. Slider synchronization

Two directions:
- **Analysis → sliders**: `applyPresetToSliders(preset)`,
  `ui/app.js:2897-2911`, called once from `runAnalysis()` at
  `ui/app.js:2409` (`applyPresetToSliders(finalPreset);`). Iterates
  every slider id and calls `setSlider(id, val)` (imported from
  `ui/ui-engine.js:24`) for each field of `finalPreset`, including the
  nested `preset.hsl`, `preset.grade`, `preset.cal` sub-objects.
- **Slider binding (user → live update)**: `bindSliders(document.body)`,
  called once at `ui/app.js:672` inside the `waitForRoot()` bootstrap
  (`bindSliders` defined in `ui/ui-engine.js:33`).
- **Sliders → preset object (for export)**: `readSlidersAsPreset()`,
  `ui/app.js:3060-3084`, reads back the CURRENT DOM slider `.value`s
  (not `state.lastX`/`finalPreset`) into a fresh preset object. This is
  what `handleDownload()` actually exports — see Q7's note.

## 7. XMP serialization and download (single-image workflow)

`handleDownload()`, `ui/app.js:2930-2948`, wired to
`document.getElementById('btnDownload')` at `ui/app.js:1162`:

```js
function handleDownload() {
  let preset = readSlidersAsPreset();       // ui/app.js:2931
  const safety = quickSafetyClamp(preset);  // ui/app.js:2933 (core/xmp-validator)
  preset = safety.preset;
  ...
  const xmp    = serializeXMP(preset);      // ui/app.js:2944 (core/preset-engine)
  const name   = document.getElementById('presetName')?.value || 'AI Preset';
  downloadXMP(xmp, name);                   // ui/app.js:2946 (core/preset-engine)
  flashSuccess();
}
```
`serializeXMP` and `downloadXMP` are both imported from
`core/preset-engine/index.js` (`ui/app.js:11`).

**Structural note (factual, not a fix suggestion):** `handleDownload()`
does not read `state.lastDecisionReport`/`finalPreset`/any `state.last*`
analysis result at all. It rebuilds the exported preset entirely from
whatever the DOM sliders currently show, via `readSlidersAsPreset()`.
The only path from "Core-computed Candidate" to "exported XMP" is
therefore: `buildFinalPreset()` → `applyPresetToSliders()` → (user may
or may not touch sliders) → `readSlidersAsPreset()` → `quickSafetyClamp()`
→ `serializeXMP()`. There is no direct call from `handleDownload()` back
into `buildFinalPreset`'s output object.

Also note: `buildPreset` is imported from `core/preset-engine/index.js`
at `ui/app.js:11` (`import { buildPreset, serializeXMP, downloadXMP } ...`)
but **`buildPreset` itself is never called anywhere in `ui/app.js`** —
confirmed by `grep -n "buildPreset(" ui/app.js` returning zero matches
beyond the import line. It is a dead import for this file.

## 8. Reset / new-image behavior

Function: **`handleReset()`**, `ui/app.js:2955-3057`, wired to
`document.getElementById('btnReset')` at `ui/app.js:1164`, and also
called unconditionally at the top of `loadFile()` (`ui/app.js:1177`)
on every new upload (not just via the Reset button).

It clears, in order: `reviewConsoleController.resetTransientUiState()`
(if present), then sets to `null`/initial: `state.imageLoaded`,
`state.lastStats`, `state.lastPalette`, `state.lastWB`,
`state.lastCurveSet`, `state.lastSkin`, `state.lastBasic`,
`state.lastHSL`, `state.lastGrading`, `state.lastToneCurves`,
`state.lastCalibration`, `state.lastHarmony`, `state.lastImageAnalysis`,
`state.lastStyleRecognition`, `state.lastProcessingLog`,
`state.lastStyleFingerprint`, `state.lastStyleFeatureGraph`,
`state.lastValidationReport`, `state.lastBenchmark`,
`state.lastDecisionReport`, `state.lastReferenceTransfer`,
`state.lastPreviewSandbox`, `state.lastPreviewReviewState`,
`state.lastPreviewReviewGenerationId`, `state.lastSideBySideComparison`,
`state.currentRetainedFile`, `state.lastCanonicalSourceEvidence`,
`state.lastRenderOutcomeEvidence`. Then calls
`previewSourceGeometryNormalizer.releaseAll()`,
`state.curveEditor?.resetAll()`, hides/shows the relevant DOM sections
(`uploadWrap`, `previewWrap`, `sliders`, `aiBox`, `analysisGroups`,
`reviewConsoleSection`, `sideBySideComparisonSection`,
`visualPreviewComparisonSection`, `interactiveBeforeAfterSection`,
`interactivePreviewObservationSection`), clears
`visualPreviewComparisonController`, `interactiveBeforeAfterController`,
`interactivePreviewObservationController` (via their own `.clear()`/
`.reset()` methods, not destroyed), resets the active analysis tab back
to `'overview'`, hides all per-engine analysis sections
(`basicSection`, `toneCurveAISection`, `calibrationSection`,
`harmonySection`, `colorGradingSection`, `hslAnalyzerSection`,
`histSection`, `paletteSection`, `wbSection`, `skinSection`,
`imageAnalysisSection`), and finally resets both file inputs' `.value`
(`fileIn`, `fileIn2`).

## 9. Generation/abort mechanism for single-image path

`core/generation-control.js` (115 lines) exports:
```js
export function createGeneration() { ... }              // line 4
export function getActiveGenerationId() { ... }          // line 13
export function getAbortSignal() { ... }                 // line 17
export function isStale(generationId) { ... }             // line 21
export function cancelActiveGeneration() { ... }          // line 25
export function createGenerationGuard(generationId) { ... } // line 30
export function createNamedGeneration(name) { ... }        // line 86
export function getActiveNamedGeneration(name) { ... }     // line 92
export function isNamedTokenStale(name, id) { ... }        // line 97
export function createFastPreviewGeneration() { ... }      // line 103
export function isFastPreviewStale(id) { ... }              // line 104
export function createRefinedAnalysisTask() { ... }         // line 106
export function isRefinedAnalysisStale(id) { ... }           // line 107
export function createIntensityRenderGeneration() { ... }    // line 109
export function isIntensityRenderStale(id) { ... }            // line 110
export function getNamedGenerationSnapshot() { ... }          // line 113
```
**`ui/app.js` never imports `core/generation-control.js` at all** —
confirmed: `grep -n "generation-control" ui/app.js` returns zero
matches. The single-image path has its own, entirely separate,
hand-rolled generation counter instead:
```js
// ui/app.js:2141
let analysisRenderGeneration = 0;
...
// ui/app.js:2071
const renderGeneration = ++analysisRenderGeneration;
```
This local counter is used only to guard the Visual Preview
Comparison / Interactive Before-After / Data Comparison RENDER
callbacks against staleness (repeated checks like
`if (renderGeneration !== analysisRenderGeneration) return;` at e.g.
`ui/app.js:2181, 2199, 2823, 2848, 2874`) — it does **not** guard the
Core-engine calls themselves (`analyzeImage`, `classifySkin`, etc. have
no generation/abort check at all), and it does not use
`AbortController`/`AbortSignal` anywhere. `core/generation-control.js`'s
real-only consumer is `ui/reference-color-match-panel.js` (confirmed:
`grep -rln "generation-control.js" ui core` → only
`ui/reference-color-match-panel.js` and the file itself).

## 10. Analysis cache for single-image path

`core/analysis-cache.js` (138 lines) exports:
```js
export function getCachedReferenceAnalysis({ filePath, imageId, dimensions, profileVersion }) { ... } // line 11
export function setCachedReferenceAnalysis(...) { ... }   // line 19
export function getCachedTargetAnalysis(...) { ... }       // line 25
export function setCachedTargetAnalysis(...) { ... }        // line 33
export function clearCaches() { ... }                        // line 39
export function invalidateTargetCache() { ... }               // line 46
export function getCacheStats() { ... }                        // line 50
export function buildEvidenceCacheKey({ fingerprint, dimensions, proxyDimensions, profile, engineVersion }) { ... } // line 106
export function getEvidenceCache(storeName, keyParts) { ... }   // line 110
export function setEvidenceCache(storeName, keyParts, value) { ... } // line 118
export function clearEvidenceCaches() { ... }                        // line 125
export function getEvidenceCacheStats() { ... }                       // line 132
```
**`ui/app.js` never imports `core/analysis-cache.js`** — confirmed:
zero matches for `analysis-cache` in `ui/app.js`. The single-image
path re-runs every Core engine from scratch on every `runAnalysis()`
call (upload or Re-analyze) — there is no memoization/caching layer at
all for it. The naming (`getCachedReferenceAnalysis` /
`getCachedTargetAnalysis`) itself signals this module was built for the
two-image Reference Color Match workflow ("reference" image vs
"target" image), not the single-image workflow. Confirmed sole
consumer: `ui/reference-color-match-panel.js`
(`import { ... getEvidenceCache, setEvidenceCache, getEvidenceCacheStats } from '../core/analysis-cache.js';`).

## 11. Image fingerprint/hash function

No fingerprint/hash function is used anywhere in the single-image path
(`ui/app.js`'s `runAnalysis`/`loadFile`/`handleReset`). Grepping
`core/` and `ui/` for fingerprint/hash-related file names turns up:
- `core/style-fingerprint/index.js` — this is a **style** fingerprint
  (mood/warmth/contrast descriptor), not an image content hash; it IS
  used in the single-image path (`buildStyleFingerprint`, Q3 item 10).
  Not a hash/dedup mechanism.
- `core/calibration-lab/sha256-pure-js.js` — a real SHA-256
  implementation, but scoped to `core/calibration-lab/` (the QA/
  Calibration Lab tooling), not imported by `ui/app.js` or the
  single-image pipeline.
- `core/decision-engine/index.js`, `core/lightroom-mapping-engine/index.js`,
  `core/xmp-validator/index.js` contain the word "hash"/"fingerprint"
  only in comments/variable names unrelated to image content hashing
  (confirmed by the grep matching those files only for the search
  terms, not for an exported hash function signature).
No `imageHash`, `computeFingerprint`, `perceptualHash`, or similar
function exists in `ui/` at all. `state.currentRetainedFile` (the raw
`File` object) is the only per-upload identity the single-image path
retains, and it is not hashed — see `DEPLOY GEOMETRY R1 — Phase B1`
comments at `ui/app.js:137-141`.

## 12. Web Worker for Image Analysis Core

Yes — internal to `core/image-analysis-core/index.js`, not something
`ui/app.js` sets up itself. `ui/app.js` just calls
`analyzeImageCore(img)` (`ui/app.js:2175`) and awaits/`.then()`s the
result; the Worker is entirely encapsulated inside the engine module.

```js
// core/image-analysis-core/index.js:45-58
const WORKER_TIMEOUT_MS = 20000;
let _sharedWorker = null;
let _workerFailed = false;
let _jobSeq = 0;

function _getWorker() {
  if (_workerFailed) return null;
  if (_sharedWorker) return _sharedWorker;
  if (typeof Worker === 'undefined') { _workerFailed = true; return null; }
  try {
    _sharedWorker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    return _sharedWorker;
  } catch (error) {
    ...
    _workerFailed = true;
    _sharedWorker = null;
    return null;
  }
}
```
The heavy per-pixel pass is offloaded via `_runInWorker(buffers)`
(defined immediately after `_getWorker`), with a 20s timeout that
`terminate()`s the worker on hang. `postMessage`/`onmessage` wiring
lives inside `_runInWorker` and `core/image-analysis-core/worker.js`
itself — both fully internal to that Core module; `ui/app.js` has no
awareness of the Worker at all. Falls back to synchronous main-thread
analysis (`pixel-math.js`'s `runFromBuffers`) if `Worker` is unavailable
or fails once (sticky `_workerFailed` flag).

## 13. Async control flow of "Analyze" and overlapping-call guards

`runAnalysis()` (`ui/app.js:2035-2757`) is one large `async function`
with an outer `try { ... } catch (err) { setAnalysisBox('error', ...) }`
(`ui/app.js:2159` try-open, `ui/app.js:2754` catch). Inside the `try`,
the flow is a mix of:
- sequential `await`s for stage 1 (`analyzeImage`) and stage 2
  (`Promise.allSettled([classifySkin, detectColorCast])`, then
  `Promise.allSettled([7 color engines])`),
- two intentionally **fire-and-forget** promise chains kicked off early
  (`imageAnalysisCorePromise` at `ui/app.js:2175`,
  `paletteHarmonyPromise` at `ui/app.js:2190`) and only `await`ed later
  via `Promise.allSettled([paletteHarmonyPromise])` at `ui/app.js:2312`
  and `Promise.allSettled([imageAnalysisCorePromise])` at
  `ui/app.js:2459`,
- a nested nested-`try` around the Visual Preview Comparison rendering
  block (`ui/app.js:2686-2822`) that deliberately swallows its own
  errors so a preview-render failure never bubbles to the outer catch.

**No overlapping-call guard exists for the single-image path.**
Specifically:
- `btnReanalyze`'s click handler (`handleReanalyze`, `ui/app.js:2950`)
  has no disabled-state check and no re-entrancy guard — clicking it
  twice quickly starts two concurrent `runAnalysis()` invocations, both
  of which write to the same `state.last*` fields (Q4) with no
  generation check on those writes (the `renderGeneration` counter, Q9,
  only gates the Visual Preview/Interactive render callbacks, not the
  Core-engine result assignments like `state.lastStats = stats;` at
  `ui/app.js:2161`, `state.lastSkin = skinMerged;` at `ui/app.js:2284`,
  etc.).
- The file `change`/`drop` handlers (Q1) call `loadFile()` directly
  with no "is an analysis currently running" check; uploading image B
  while image A's `runAnalysis()` is still in flight starts a second,
  fully concurrent `runAnalysis()` call. `loadFile()` does call
  `handleReset()` first (`ui/app.js:1177`), which nulls out all
  `state.last*` fields synchronously, but this does not cancel or
  await the in-flight image-A `runAnalysis()` — its pending
  `Promise.allSettled(...)` calls and `.then()` callbacks continue
  running and will still write into `state.last*` once they resolve,
  potentially after image B's `handleReset()`/`runAnalysis()` has
  already started, racing with image B's writes to the same fields.
- Only the DOM/canvas RENDER side of this (not the state-write side) is
  protected, via the `renderGeneration !== analysisRenderGeneration`
  checks described in Q9.
- The only `.disabled = true` button-guard in the whole file
  (`ui/app.js:1367`) belongs to `handleBuildControlledV2Preview()` /
  `btnBuildControlledV2` (the Controlled V2 Preview build flow, part of
  the Review Console feature), not to `btnReanalyze` or file upload.

## 14. package.json (current values, for later updating)

```json
"name": "lumixa-epic-2e-p0-7-pipeline-runtime",
"version": "2.0.7.3",
"description": "LUMIXA AI P0.7 R3 — Pipeline Runtime Architecture: generation control, cache, heartbeat, PSM, ledger, tracer, core runner, two-layer pipeline with deferred Layer 2.",
```
File: `package.json` (repo root), `"type": "module"`.

---

## Boundary confirmation: Reference Color Match's exclusive Core dependencies

Confirmed by `grep -rln "core-runner.js|generation-control.js|analysis-cache.js|preview-state-machine.js|candidate-schema.js|export-manager.js" ui core`:
only two files reference any of these six modules by import path:
- `ui/reference-color-match-panel.js` imports `generation-control.js`,
  `analysis-cache.js`, `preview-state-machine.js`, `candidate-schema.js`,
  and `core-runner.js` (all five, lines 39/41/43/45/47 of that file).
- `core/export-manager.js` mentions its own path only in its own JSDoc
  header comment (`core/export-manager.js:13`) — it has **no consumer
  at all** anywhere in `ui/` or `core/`. It is dead code from the
  perspective of both the single-image workflow and Reference Color
  Match.

`ui/app.js` (the single-image controller) imports **none** of
`core-runner.js`, `generation-control.js`, `analysis-cache.js`,
`preview-state-machine.js`, `candidate-schema.js`, or
`export-manager.js`.
