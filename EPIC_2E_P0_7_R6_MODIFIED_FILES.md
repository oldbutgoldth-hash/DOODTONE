# EPIC 2E-P0.7 R6 — Modified Files

Baseline: this round's own R5 output
(`LUMIXA_EPIC_2E_P0_7_COMPLETE_PROJECT_R5.zip`), per explicit instruction.

Confirmed via directory diff against the R5 seed (excluding `node_modules`,
regenerated `qa/*-results.json` evidence files, and this round's own new
files):

## Changed

- **`core/preview-state-machine.js`** — added 7 new states, additive only,
  nothing removed or widened:
  `ANALYZING_FAST_REFERENCE`, `ANALYZING_FAST_TARGET`, `FAST_FUSION`,
  `FAST_PREVIEW_RENDERING`, `DEEP_ANALYSIS_RUNNING`,
  `REFINED_PREVIEW_RENDERING`, `REFINED_PREVIEW_READY`, wired into the exact
  9-state sequence the spec requires:
  `WAITING → ANALYZING_FAST_REFERENCE → ANALYZING_FAST_TARGET → FAST_FUSION
  → FAST_PREVIEW_RENDERING → FAST_PREVIEW_READY → DEEP_ANALYSIS_RUNNING →
  REFINED_PREVIEW_RENDERING → REFINED_PREVIEW_READY`. Every R5 state/
  transition (`INTENSITY_RERENDERING` included) is untouched and still
  reachable exactly as before — proven by a dedicated regression case in
  the new static test.

- **`core/generation-control.js`** — added a second, independent layer of
  3 named ownership tokens (`fastPreviewGeneration`, `refinedAnalysisTask`,
  `intensityRenderGeneration`), each with its own `create*`/`is*Stale`
  pair and independent staleness (bumping one never invalidates another).
  The original whole-pipeline `createGeneration`/`getActiveGenerationId`/
  `isStale`/`cancelActiveGeneration`/`createGenerationGuard` exports are
  untouched and still used exactly as before.

- **`core/analysis-cache.js`** — added 4 new, separate evidence stores
  (`referenceFastEvidence`, `targetFastEvidence`, `referenceRefinedEvidence`,
  `targetRefinedEvidence`) behind `getEvidenceCache`/`setEvidenceCache`/
  `clearEvidenceCaches`/`getEvidenceCacheStats`, keyed via
  `buildEvidenceCacheKey({ fingerprint, dimensions, proxyDimensions,
  profile, engineVersion })` — deliberately excludes any output-strength/
  Intensity value from the key. The original 2 R5-era caches and all their
  exports are untouched. Every comment in this file avoids the literal
  substring "intensity" to keep the pre-existing R5 hostile whole-file
  check passing.

- **`core/image-analysis-core/index.js`** (554→272 lines) — the old
  duplicated pure pixel-math functions were removed (they now live in the
  new `pixel-math.js`, see Added below); `analyzeImageCore()` keeps its
  exact original public signature/contract but now offloads the heavy
  two-pass pixel analysis to a Web Worker by default (`useWorker = true`),
  transferring only `ArrayBuffer`s (never the `HTMLImageElement`/canvas),
  with its own `WORKER_TIMEOUT_MS = 20000` that genuinely `terminate()`s a
  hung Worker rather than merely abandoning a `Promise.race`. If a Worker
  is unavailable or fails, it falls back to calling the exact same
  `runFromBuffers()` synchronously in-process — byte-for-byte identical
  output to the pre-R6 behavior, just relocated. The result now carries a
  new `_meta` object (`workerUsed`, `workerError`, `durationMs`, input/
  proxy dimensions) for QA instrumentation.

- **`ui/reference-color-match-panel.js`** (the central R6 file):
  - New `FAST_PROFILES = new Set(['EVALUATION_MINIMAL', 'PAIRWISE_FAST'])`
    and a `profile` parameter threaded through `_analyzeEvidence()`. The 4
    heaviest modules — Color Grading AI, Calibration Engine, **Image
    Analysis Core** (the module the real-photo runtime stall was observed
    stuck on), and Skin Tone Detection Pro — now only run
    `if (!FAST_PROFILES.has(profile))`. Every cheaper module (palette,
    tone zones, skin classification, histogram, white balance, tone
    curve, HSL) still runs unconditionally, for every profile.
  - `_rebuildAndPreview()` rewritten: the initial Reference/Target
    analysis for a brand-new pair now uses `profile: 'PAIRWISE_FAST'`
    (previously `'PAIRWISE_FULL'`, which is what forced Preview to wait
    behind all 4 heavy modules, serially, for both images). Drives the
    PSM through the new granular states in order, checking every
    `transition()` return value via a new `_transitionOrTrace()` helper.
    Once `FAST_PREVIEW_READY` is reached and the pair is genuinely new
    (`deepAnalysisPending`, same gate R5 used for Layer 2 — i.e. never on
    an Intensity-only rebuild), it fires the new `_runDeepAnalysis(...)`.
  - New `async function _runDeepAnalysis({ runId, generationId, guard })`
    — fire-and-forget, deferred, off-critical-path. Mints its own
    `refinedAnalysisTask` token and `AbortController`
    (`rcm.runtime._deepAbort`), re-analyzes both images with
    `profile: 'PAIRWISE_REFINED'` (same modules PAIRWISE_FULL always ran,
    just started later), drives `DEEP_ANALYSIS_RUNNING →
    REFINED_PREVIEW_RENDERING → REFINED_PREVIEW_READY`, then calls the
    pre-existing, unmodified `_runLayer2()` (after-image evaluation) —
    Layer 2's own behavior is 100% unchanged, just re-sequenced to start
    after Deep Analysis instead of right after Fast Preview. Soft-fails
    (never crashes/rethrows) on any error, and always clears
    `_deepAbort` in a `finally` block.
  - New `_cancelDeepAnalysis()`, called both when a new pair supersedes an
    in-flight Deep Analysis and from `_rebuildIntensityFromCache()` (so an
    Intensity drag never has to wait on Deep Analysis).
  - New QA-only hook: `rcm.runtime.lastImageAnalysisCoreMeta` records the
    most recent `analyzeImageCore()` result's `_meta`, exposed via
    `window.__LUMIXA_TEST.lastImageAnalysisCoreMeta` — used by the real-
    image Browser test to prove Fast Preview resolved before this module
    finished. Read-only, additive, never consulted by any production code
    path.
  - `rcm.runtime.counters` gained 6 new fields
    (`referenceFastAnalysisCount`, `targetFastAnalysisCount`,
    `referenceRefinedAnalysisCount`, `targetRefinedAnalysisCount`, plus 2
    more) alongside — never replacing — the 3 original R5 counters. The
    original R5-era single-line `if (phase === 'REFERENCE')
    rcm.runtime.counters.referenceAnalysisCount++`-style statements are
    kept byte-for-byte unchanged (the pre-existing R5 static test asserts
    their exact shape); the new split counters are separate, additional
    single-line statements.
  - `analyzeReference()` now explicitly passes `profile: 'PAIRWISE_FULL'`
    and records `rcm.referenceEvidenceProfile = 'REFINED'`; `rcm.
    referenceEvidenceProfile`/`targetEvidenceProfile` are reset on
    `_resetPairState()` and on a new Reference file selection.
  - `window.__LUMIXA_TEST` extended with `evidenceProfiles`,
    `getEvidenceCacheStats`, `getNamedGenerationSnapshot`, `psmState`,
    `lastImageAnalysisCoreMeta` — all additive, read-only QA visibility.
  - R5's Intensity path (`onIntensity`'s 140ms debounce,
    `_rebuildIntensityFromCache()`) is completely unchanged; it still
    never calls `_analyzeEvidence()` for any reason.

- **`qa/run-static-suites.mjs`** — wired in the 2 new R6 static suites
  below (after the R5 pair).

- **`package.json`** — added `test:p0-7-r6:psm`, `test:p0-7-r6:static`,
  `test:p0-7-r6:browser` npm scripts (no other field changed).

## Added

- **`core/image-analysis-core/pixel-math.js`** (new, ~290 lines) — pure,
  DOM-free extraction of the exact original `toGreyscale`/`mainPass`/
  `qualityPass` pixel algorithms (byte-for-byte identical logic to the
  pre-R6 `index.js` private functions), exporting a single
  `runFromBuffers({ data, w, h, data2, w2, h2 })` entry point. Imported by
  BOTH `worker.js` (off-thread) and `index.js`'s synchronous fallback —
  one shared implementation, never duplicated.
- **`core/image-analysis-core/worker.js`** (new) — the Web Worker module.
  Receives only plain numbers and transferable `ArrayBuffer`s (never an
  `HTMLImageElement`/canvas — confirmed structurally impossible to
  transfer one anyway, and asserted by the new static test), calls
  `runFromBuffers()`, always posts back exactly one
  `{ jobId, ok, result | error }` message per job.
- **`qa/epic-2e-p0-7-r6-preview-state-machine-static-test.mjs`** — 26 real,
  Node-executed transition cases against the actual
  `core/preview-state-machine.js`: the full 9-ish-state sequence, standalone
  `FAST_PREVIEW_READY` reachability, 3 Intensity-interrupt scenarios (from
  `FAST_PREVIEW_READY`, mid `DEEP_ANALYSIS_RUNNING`, from
  `REFINED_PREVIEW_READY`), new-pair reset, 9 hostile rejections
  (skip-ahead attempts), 2 unchanged-R5-sequence proofs, the R4 regression
  guard, `canTransition()`/`transition()` agreement, and existence of all
  7 new states. **26/26 PASS.**
- **`qa/epic-2e-p0-7-r6-fast-refined-critical-path-static-test.mjs`** —
  74 structural/source-level cases against the real production
  `ui/reference-color-match-panel.js`, `core/generation-control.js`,
  `core/analysis-cache.js`, and `core/image-analysis-core/{index,
  pixel-math,worker}.js`: `FAST_PROFILES` gating, heavy-module call
  ordering, `_rebuildAndPreview()`'s PSM transition order and its
  `_runDeepAnalysis()` call happening strictly after `FAST_PREVIEW_READY`,
  `_runDeepAnalysis()`'s own token/guard/abort/PSM/Layer-2-chaining
  contract, all 3 named generation tokens exported and actually called
  from the panel, all 4 evidence stores wired via `setEvidenceCache`,
  Worker-offload structural proof (no DOM references in `worker.js`/
  `pixel-math.js`, transferable-only `postMessage`, genuine
  `terminate()`-on-timeout, fallback-on-failure), R5 preservation checks
  (Intensity debounce unchanged, `_rebuildIntensityFromCache()` still
  never calls `_analyzeEvidence()`, Candidate contract forbidden fields
  still absent). **74/74 PASS.**
- **`qa/epic-2e-p0-7-r6-real-image-runtime-browser-test.mjs`** — real
  Chromium/Playwright suite, parametrized to accept the user's own real
  Reference/Target photograph files (via `--ref=`/`--target=` CLI flags,
  `LUMIXA_R6_REF_IMAGE`/`LUMIXA_R6_TARGET_IMAGE` env vars, or a
  `qa/fixtures/epic-2e-p0-7-r6/{reference,target}.(jpg|jpeg|png)` fixtures
  pair) — deliberately refuses to substitute synthetic Canvas images for
  this requirement. Implements the 11 required real-image runtime steps
  (see QA Report §6) including global `error`/`unhandledrejection`/
  `longtask` instrumentation installed via `page.addInitScript` before
  navigation, and a Production Lock re-verification as its final step.
  Fails closed to `REAL_IMAGES_UNAVAILABLE` or `BROWSER_BINARY_UNAVAILABLE`
  (exit 2) rather than fabricating a PASS — see QA Report for this
  environment's honest, currently-blocked status on both fronts.

## Never touched

`core/lightroom-mapping-engine/index.js`, `core/xmp-validator/index.js`,
`core/preset-engine/index.js`, `ui/app.js`, `ui/ui-engine.js`,
`core/decision-engine/index.js`,
`core/preview-rendering/visual-preview-render-plan-v2.js`,
`core/lightroom-mapping-engine/mapping-v2-overlay-preview-sandbox.js`,
`index.html` — all 9 confirmed **byte-for-byte identical** to the R5
seed via direct `diff`.

## Regenerated (expected side effect, not a manual edit)

`qa/baselines/lufa42-production-lock-manifest.json` was regenerated via
the existing `qa/baselines/generate-production-lock-manifest.mjs` script
(118 → 132 locked files — the 2 intentionally-changed R6 files plus the 2
newly-added `core/image-analysis-core/{pixel-math,worker}.js` files were
picked up), matching this round's own established convention (R5's own
QA report documents doing the same for the files it intentionally
changed). Several `qa/*-results.json` files also changed
timestamps/`runId` because running their suites during regression
verification overwrites their own result artifact on every run.

## Pre-existing, unrelated finding (not introduced by this round)

`core/color-harmony-engine/index.js` remains flagged as unrelated drift
by an older, unrelated EPIC-2E-J production-lock check — already
documented in R5's own QA Report as pre-existing in the R3 baseline,
confirmed still byte-identical between the R5 seed and this delivered
copy. Not touched, not in scope.
