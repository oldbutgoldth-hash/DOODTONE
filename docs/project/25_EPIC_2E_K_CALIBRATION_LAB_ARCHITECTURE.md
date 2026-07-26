# 25 — EPIC 2E-K Calibration Lab Architecture

## 1. Purpose

The Controlled V2 Calibration Lab is a standalone, Preview/Shadow-only
tool for collecting structured human comparisons between Legacy and
Controlled V2 output across many images, so that a future decision about
Controlled V2's production readiness can be based on real calibration
data instead of a single reviewer's impression on a single photo. It does
not itself make Controlled V2 production-ready, does not enable it in
any workflow, and cannot write to Production Mapping or XMP output.

## 2. Module Map

```
core/calibration-lab/
  codes.js                    stable enums + validators (no I/O, no DOM)
  schema.js                   session/record factories + structural validators
  run-comparison-pipeline.js  snapshot extraction from existing production pipeline
  aggregate.js                dashboard math (pure functions of records[])
  readiness.js                Calibration Policy + Readiness Report (pure functions)
  export-dataset.js           JSON/CSV export builders (pure, bounded field allow-list)

ui/calibration-lab/
  calibration-lab-storage.js     IndexedDB backend + bounded in-memory fallback
  calibration-lab-i18n.js        scoped EN/TH dictionary + lookup
  calibration-lab-controller.js  state machine, orchestrates storage + core modules
  calibration-lab-renderer.js    DOM rendering, dialog, accessibility, before/after view
  calibration-lab-entry.js       bootstrap, MutationObserver locale sync, QA snapshot merge
```

Every file under `core/calibration-lab/` and `ui/calibration-lab/` is new.
Nothing under any existing `core/*-engine` directory or `ui/app.js`
was modified to build this feature — see §12.

## 3. Data Flow

1. User opens the Calibration Lab from its own nav button (`#calibrationLabNavBtn`).
2. User starts or resumes a session (`createCalibrationSession`).
3. User adds an image. The controller calls
   `runCalibrationComparisonPipeline(imgElement, ...)`, which re-runs the
   same analysis/decision/mapping/preview-plan pipeline `ui/app.js`
   already runs for a normal analysis (same engines, same call order),
   then reads the Legacy and Controlled V2 numbers straight out of the
   resulting `finalPreset._decision.finalStyleIntent
   .visualPreviewRenderPlanV2` and `.lightroomSafetyClampV2` — the exact
   objects the production Visual Preview / Side-by-Side UI already
   reads. It never re-derives or approximates these numbers a second way.
4. The pipeline's raw output is reduced to a bounded, stable-coded
   Semantic Image Test Record (see `26_EPIC_2E_K_CALIBRATION_SCHEMA.md`)
   and persisted via the storage layer.
5. User records a comparison decision + issue codes + notes. This is
   pure local state (IndexedDB or in-memory) — selecting a decision never
   calls Apply, Export Preset, or XMP generation; there is no such call
   anywhere in this module tree (verified, see QA report §7/§8).
6. Dashboard/Readiness/Export read the same in-memory `records[]` array
   via the pure functions in `aggregate.js`/`readiness.js`/`export-dataset.js`.

## 4. Reuse of the Existing Production Pipeline (never re-derivation)

`core/calibration-lab/run-comparison-pipeline.js` imports the identical
engine functions `ui/app.js`'s `runAnalysis()` already calls
(`analyzeImage`, `extractPalette`, `analyzeWhiteBalance`,
`analyzeSkinTone`, `generateBasicPanel`, `analyzeHSL`,
`analyzeColorGrading`, `generateToneCurves`, `analyzeCalibration`,
`recognizeStyle`, `generateHarmonies`, `buildFinalPreset`, `classifySkin`,
`buildStyleFingerprint`, `buildStyleFeatureGraph`, `validateFinalPreset`,
`quickSafetyClamp`, `benchmarkStylePreservation`, `classifyScene`,
`detectColorCast`) and calls them in the same order. This was a
deliberate design choice: any drift between what the Calibration Lab
measures and what the real app actually computes would make the
calibration data worthless. There is exactly one place that computes
Legacy/V2 adjustment numbers for a given image, reused by both the
production preview UI and this lab.

- `extractLegacySnapshot(finalPreset, benchmark)` reads
  `visualPreviewRenderPlanV2.legacyRenderPlan.adjustmentModel` and
  `.confidence`, plus `benchmark.safetyScore`.
- `extractControlledV2Snapshot(finalPreset)` reads
  `visualPreviewRenderPlanV2.v2RenderPlan.adjustmentModel`, `.confidence`,
  `.controlledV2Translation.mode`, and
  `lightroomSafetyClampV2.globalSafetyScore`.
- `extractSafetySnapshot(finalPreset, benchmark)` reduces
  `lightroomSafetyClampV2.hardStops[]` / `.softCaps[]` /
  `.photographerSummary` (all human-readable prose) down to
  `{ legacySafetyWarningCount, v2HardStopCount, v2SoftCapCount,
  severeIssueDetected }` — counts and booleans only. The raw prose
  strings are never copied into the snapshot, the session, the export,
  or the DOM (Hostile Item 5, verified — see QA report).
- `computeContainsSkin(skin, skinPctAccurate)` returns a boolean
  (`pct >= 5 || skin?.isFaceCandidate === true`).
- `computeImageFingerprint(imgElement)` computes a 64-bit difference hash
  (dHash) from a 9x8 canvas downsample of the image's own pixel content —
  never derived from the file name or path — returned as
  `dhash-<16 hex chars>`; returns `null` (never throws) if Canvas is
  unavailable.

`runCalibrationComparisonPipeline` (the orchestrator) and
`computeImageFingerprint` are inherently browser-only (Canvas/image
decode), exactly like every existing `core/*-engine` module that already
assumes a DOM; they are exercised only by the Playwright Browser suite.
Every other function in `run-comparison-pipeline.js` is a pure function
of an already-computed `finalPreset`/`benchmark` object and is
Node-testable with synthetic mock objects — this is what
`qa/epic-2e-k-calibration-lab-static-test.mjs` actually exercises.

## 5. Storage Layer

`ui/calibration-lab/calibration-lab-storage.js` exposes one factory,
`createCalibrationLabStorage()`, which feature-detects `indexedDB` and
returns one of two backends with an identical external API:

```
{ persistenceMode, listSessions, saveSession, deleteSession, clearAll,
  saveImageRecord, loadImageRecordsForSession, getStorageUsageSummary }
```

- `_createIndexedDbBackend(db)` -- `persistenceMode: 'INDEXEDDB'`. Own
  database (`lumixa-calibration-lab`), two object stores (`sessions`,
  `images`, the latter indexed by `sessionId`). `SESSION_MIGRATIONS` is
  an intentionally empty frozen map (only schema v1 exists today);
  `_migrateRecordIfNeeded()` fails closed -- quarantines (excludes, never
  crashes on) any record whose `calibrationSchemaVersion` is newer than
  the running code, or older with no registered migration step.
- `_createInMemoryBackend()` -- `persistenceMode: 'IN_MEMORY_FALLBACK'`,
  Map-based, used when `indexedDB` is absent or `_openIndexedDb()`
  itself rejects (e.g. private-browsing mode).
- Both backends enforce `MAX_STORED_SESSIONS` (20) and
  `MAX_IMAGES_PER_SESSION` (500), throwing an `Error` with
  `.code = 'SESSION_LIMIT_REACHED'` / `'IMAGE_LIMIT_REACHED'` rather than
  silently evicting data.
- `getStorageUsageSummary()`'s `corruptRecordCount` is recomputed from a
  fresh scan (`_scanSessions()` / `_scanAllImageRecordsAcrossAllSessions()`)
  on every call -- a real bug (an accumulating shared counter that grew
  on every repeated call) was found and fixed during development; see
  the QA report for the before/after verification.

## 6. Controller / Renderer Split

`calibration-lab-controller.js` owns all state (`session`, `records`,
`currentIndex`, `persistenceMode`, `calibrationMode`, ...) and exposes a
pub-sub `subscribe(fn)`. `calibration-lab-renderer.js` is a pure DOM
builder that re-renders from `controller.getState()` whenever notified --
it holds no calibration data of its own beyond the transient in-memory
image preview (see section 9). This mirrors the existing project
convention of keeping state and DOM rendering in separate files
(`ui/app.js`'s own `ui-engine.js` split).

## 7. Accessibility

- The Lab mounts as a `role="dialog" aria-modal="true"` overlay with a
  full focus trap (`_trapFocus`: Tab/Shift+Tab cycle within
  `FOCUSABLE_SELECTOR` matches, Escape closes) and focus restoration to
  whatever was focused before opening.
- All interactive controls (`.cal-btn`, `.cal-icon-btn`, `.cal-chip`,
  `.cal-check-label`) are styled `min-height:44px; min-width:44px`.
- `@media (prefers-reduced-motion: reduce)` disables all
  transitions/animations in the injected stylesheet.
- `@media (max-width: 700px)` stacks the two-column comparison grid into
  a single column; verified with no horizontal overflow at 320/360/390/
  430/768/1024/1440px (see QA report).

## 8. Semantic QA Snapshot

`getQaSnapshot()` on the controller returns exactly the Section-14
contract: `calibrationMode, sessionState, persistenceMode, imageCount,
reviewedCount, pendingCount, currentImageId, currentDecisionCode,
selectedIssueCodes, readinessCode, productionSource, productionWrite,
controlledV2Apply, previewExport`. The last four fields are literal
hardcoded values in the controller's source (`productionSource:
'legacy', productionWrite: false, controlledV2Apply: false,
previewExport: false`) -- not derived from any mutable variable -- so no
runtime state change anywhere in this module can ever cause them to
report anything else. This is merged onto the existing
`window.__LUMIXA_QA__` object additively at runtime
(`window.__LUMIXA_QA__ = { ...(window.__LUMIXA_QA__ || {}),
getCalibrationLabSnapshot: () => controller.getQaSnapshot() }`) -- the
main app's own QA snapshot function is never touched or wrapped. The
render function also stamps redundant `data-cal-*` attributes directly
onto `#calibrationLabRoot` for Browser-QA robustness.

## 9. Image Handling (Preview, Not Persistence)

The Lab keeps at most one live `<img>`/object-URL in memory at a time
(`currentImgElement` / `currentImgObjectUrl` / `currentImgRecordId` in
the renderer), revoked via `URL.revokeObjectURL()` on navigation away or
dialog close. The before/after comparison view shows the same source
image on both sides of the slider, with the real numeric Legacy-vs-V2
snapshot table displayed alongside -- see the Release Notes' Known
Limitations for why a pixel-differentiated Controlled V2 preview was
deliberately not attempted here. The original image file, any Base64
encoding of it, and any local file path are never written to IndexedDB,
never included in `getState()`'s persisted shape, and never included in
JSON/CSV export (verified structurally, see QA report).

## 10. Locale Integration Without Touching app.js

`ui/app.js`'s `setLang()` already sets
`document.documentElement.lang = normalizedLang` for accessibility
reasons unrelated to this feature. `calibration-lab-entry.js` attaches a
`MutationObserver` to `document.documentElement` with
`attributeFilter: ['lang']` and re-renders the open Lab UI when it
changes. This is a read-only, one-directional, non-invasive coupling --
the Lab never writes to `document.documentElement.lang` itself, and
`ui/app.js` has no knowledge the Lab exists.

## 11. Theming

`#calibrationLabRoot` is mounted inside `#lumixaApp`, which already
carries the app's inline `--bg`/`--accent`/etc. CSS custom properties (no
separate `:root` theme block exists in this codebase). The Lab therefore
follows the app's current dark/light theme automatically with zero
additional wiring.

## 12. Production Isolation (structural, not just tested)

- `ui/app.js` was not edited. The only change to any existing file that
  the main app loads is the two additive lines in `index.html` (a nav
  button + an empty mount div + a second `<script type="module">` tag,
  placed after `ui/app.js`'s own tag).
- No file under `core/calibration-lab/` or `ui/calibration-lab/` imports
  `serializeXMP`, `downloadXMP`, or `mapping-v2-activation-controller.js`
  / `buildLightroomControlledActivationV2` (grepped and asserted by the
  hostile static test).
- `READINESS_STATUSES` (5 members) explicitly excludes
  `'PRODUCTION_READY'`; `FORBIDDEN_READINESS_STATUS` +
  `isValidReadinessStatus()` reject it even if a caller tries to smuggle
  it through; `computeReadinessReport()`'s own source contains no
  `'PRODUCTION_READY'` string literal anywhere (verified via
  `String(fn).includes(...)`), so no code path in this module can ever
  produce it.
- The Calibration Lab's own IndexedDB database
  (`lumixa-calibration-lab`) is distinct from any production storage.

## 13. Known Extension Points

- A genuinely pixel-differentiated Controlled V2 preview (currently the
  slider shows the same source image on both sides) would require
  duplicating the production pixel-preview pipeline in a way that risks
  a subtly-wrong preview; deferred, disclosed as a Known Limitation.
- `SESSION_MIGRATIONS` is ready to receive a v1-to-v2 migration function
  the day `CALIBRATION_SCHEMA_VERSION` needs to increase.
- The Readiness Report's `CALIBRATION_POLICY_DEFAULTS` thresholds are
  exposed as a parameter to `computeReadinessReport(records, policy)`,
  so a future stage could make them user-configurable without touching
  the ladder logic itself.
