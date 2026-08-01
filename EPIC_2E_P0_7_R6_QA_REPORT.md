# EPIC 2E-P0.7 R6 — QA Report

**Scope:** True Preview-Critical Path Separation + Deferred Heavy Core
Execution + Real-Image Runtime Stall Repair. Baseline: this round's own
R5 output (`LUMIXA_EPIC_2E_P0_7_COMPLETE_PROJECT_R5.zip`).

## 1. Root-Cause Diagnosis

Read directly from the pre-R6 production source (not assumed from the bug
report alone):

1. `_rebuildAndPreview()` called `_analyzeEvidence()` for Reference then
   Target **serially**, each with `profile: 'PAIRWISE_FULL'` — running
   all ~12 analysis modules, 4 of them heavy (Color Grading AI,
   Calibration Engine, **Image Analysis Core**, Skin Tone Detection Pro),
   before Preview ever had a chance to render.
2. Separately, `analyzeImageCore()`'s entire two-pass pixel computation
   ran as **one unbroken synchronous block** inside a single `setTimeout`
   callback. A `Promise.race`+`setTimeout` safety timeout in the caller
   cannot actually preempt this: JavaScript is single-threaded, so the
   timeout's own callback cannot fire while `_run()` is still mid-loop —
   it can only fire *after*, once the synchronous block finally yields.

Together these precisely explain the reported symptom: the UI shows
"กำลังวิเคราะห์ภาพต้นแบบ / Image Analysis Core" and appears to hang,
because on a real multi-megapixel photo this module's pixel math is long
enough that nothing else — not the next analysis step, not the UI, not
even a safety timeout — can run until it finishes.

**Not claimed:** that Image Analysis Core is the *only* contributor
(the serial Full-profile-for-both-images sequencing before it is an
equally real contributor), and **not claimed:** that the R5 Intensity
repair has any bearing on this defect (R5 only touched the
already-cached, already-analyzed Intensity-rerender path; this defect is
entirely in the *first* Reference/Target analysis, which R5 never
altered).

## 2. Fix Summary

- **Two profiles**: `PAIRWISE_FAST` (the 4 heavy modules skipped) and
  `PAIRWISE_REFINED` (identical module set to the pre-existing
  `PAIRWISE_FULL` — the difference is *when* it runs, not *what* it
  computes).
- **9-state granular PSM sequence**, additive on top of R5's states,
  giving `FAST_PREVIEW_READY` a real, independently-observable milestone
  distinct from `DEEP_ANALYSIS_RUNNING`/`REFINED_PREVIEW_READY`.
- **Deep Analysis deferred**: `_runDeepAnalysis()` only starts *after*
  `FAST_PREVIEW_READY` is reached, reusing the exact off-critical-path
  pattern (own `AbortController`, own generation token) R5-era Layer 2
  already established — extended, not reinvented.
- **Worker offload**: the heavy pixel math (now `pixel-math.js`, pure and
  DOM-free) runs in a Web Worker by default, transferring only
  `ArrayBuffer`s. A genuine `worker.terminate()` on timeout is the actual
  fix for the un-preemptable-synchronous-work problem — not a
  relabeled `Promise.race`. Falls back to the identical synchronous
  function in-process if Workers are unavailable.
- **3 named generation tokens**, **4 evidence caches** — see Modified
  Files for the full contract.

## 3. Syntax Gate

`node --check` + real ESM `import()` on every touched/added file — all
clean:
- `core/preview-state-machine.js`, `core/generation-control.js`,
  `core/analysis-cache.js`, `core/image-analysis-core/index.js`,
  `core/image-analysis-core/pixel-math.js`,
  `core/image-analysis-core/worker.js`,
  `ui/reference-color-match-panel.js` — all pass `node --check` and a
  real `import()` (the latter catches comment/brace defects `--check`
  alone can miss, per this project's established convention).

## 4. State Machine Transition Evidence

```
$ node qa/epic-2e-p0-7-r6-preview-state-machine-static-test.mjs
26/26 PASS, 0 FAIL
```

Covers: the full 9-state sequence end-to-end; standalone
`FAST_PREVIEW_READY` reachability without ever touching
`DEEP_ANALYSIS_RUNNING`; 3 Intensity-interrupt scenarios (from
`FAST_PREVIEW_READY`, mid-`DEEP_ANALYSIS_RUNNING`, from
`REFINED_PREVIEW_READY` — all correctly resolve back to
`FAST_PREVIEW_READY`); new-pair reset from `REFINED_PREVIEW_READY`; 7
hostile skip-ahead rejections (cannot jump from `WAITING` straight into
any granular fast-preview or heavy-module state); `DEEP_ANALYSIS_RUNNING`
cannot be entered before `FAST_PREVIEW_READY`; `REFINED_PREVIEW_READY`
cannot be entered before `REFINED_PREVIEW_RENDERING`; both original R5
sequences (full-analysis and Intensity-from-`FAST_PREVIEW_READY`)
completely unchanged; the R4 regression guard (`REFINED_READY ->
ANALYZING_LAYER_1` still rejected) still holds; `canTransition()` agrees
with `transition()`; existence of all 7 new states.

## 5. Fast/Refined Critical-Path Structural Test

```
$ node qa/epic-2e-p0-7-r6-fast-refined-critical-path-static-test.mjs
74/74 PASS, 0 FAIL
```

Runs against the **real, unmodified-elsewhere** production source (not a
reimplemented stub). Key groups: `FAST_PROFILES` gating (heavy modules
only called after the gate, cheap modules unconditional) — 12 cases;
`_rebuildAndPreview()` uses `PAIRWISE_FAST` for both images, hostile
check it never uses `PAIRWISE_FULL` for the initial pair, PSM transitions
occur in strict required order, `_runDeepAnalysis()` is only called
*after* `FAST_PREVIEW_READY` in source order, every transition checked
via `_transitionOrTrace`, `_cancelDeepAnalysis()` called on a new pair —
6 cases; `_runDeepAnalysis()`'s own contract (profile, token, guard,
abort, 3 checked PSM transitions, Layer-2 chaining, soft-fail catch,
`finally`-cleanup) — 10 cases; Intensity-only rebuilds never trigger
`_runDeepAnalysis()` — 1 case; all 6 named-token functions
exported+called — 12 cases + live snapshot shape — 1 case; all 4
evidence stores wired via `setEvidenceCache` + key formula excludes
Intensity — 9 cases; Worker-offload structural proof (no DOM refs in
`worker.js`/`pixel-math.js`, transferable-only `postMessage`, genuine
`terminate()` on timeout, real-Error rejection, fallback-on-failure,
`_meta` instrumentation, shared `runFromBuffers()`, default
`useWorker=true`, old duplicated functions removed from `index.js`) — 10
cases; R5 preservation (Intensity debounce unchanged,
`_rebuildIntensityFromCache()` still never calls `_analyzeEvidence()`,
new counters additive, Candidate contract forbidden fields still absent)
— 7 cases.

## 6. Real-Image Runtime Browser Test

**Environment status: blocked on two independent fronts in this sandbox
— neither is a defect in the delivered code.**

```
$ node qa/epic-2e-p0-7-r6-real-image-runtime-browser-test.mjs
Final decision: REAL_IMAGES_UNAVAILABLE — Reference and Target real
photograph file(s) not found. ...
$ echo $?
2
```

Two separate, independently-verified blockers:

1. **The real photographs are not accessible as files in this sandbox.**
   The user pasted two images (Reference: a portrait subject; Target: a
   bride in a wedding dress) directly inline into chat messages. These
   are visible to the assistant via multimodal vision, but — confirmed
   via exhaustive filesystem search after each paste — pasting an image
   inline does **not** produce an accessible file path in this sandbox,
   unlike a genuine file upload (which does land under an
   `/uploads/`-style path). This is a sandbox/session limitation, not
   something the delivered code can work around.
2. **No real Chromium/Chrome/Edge binary is available.** `playwright` is
   not even present in `node_modules` in this working copy (network
   installation of the npm package itself, not just the browser
   download, is blocked in this environment) — consistent with every
   prior EPIC 2E round in this project.

The suite is written to require **real** files (CLI flags, env vars, or
a fixtures directory — see Modified Files) and explicitly refuses to
substitute synthetic Canvas images, per the release spec's explicit
instruction. It implements all 11 required real-image runtime steps
(full step list is documented in the file's own header comment):
loading the real files via the actual `<input type=file>`; recording the
`FAST_PREVIEW_READY` timestamp and confirming a visible Preview renders
by then; a `requestAnimationFrame` responsiveness probe between Fast and
Refined Preview; confirming `DEEP_ANALYSIS_RUNNING` starts strictly after
`FAST_PREVIEW_READY`; confirming Image Analysis Core's resolution
timestamp is strictly after `FAST_PREVIEW_READY` (the literal proof the
spec requires); confirming `REFINED_PREVIEW_READY` is eventually reached;
zero PSM warnings/unhandled errors/rejections (via global listeners
installed through `page.addInitScript` before navigation); the R5
Intensity slider still working after Deep Analysis completes; Worker-
offload instrumentation cross-checked against a `PerformanceObserver`
longtask trace; and a final Production Lock re-verification.

**To close this out**, run on a machine with both real Chromium and the
two real photo files:
```
npm run test:p0-7-r6:browser -- --ref=/path/to/reference.jpg --target=/path/to/target.jpg
```
or place the files at
`qa/fixtures/epic-2e-p0-7-r6/reference.jpg` and
`qa/fixtures/epic-2e-p0-7-r6/target.jpg` and run
`npm run test:p0-7-r6:browser` with no flags.

**No claim of PASS is made for this suite in this environment.** Per this
project's established Exit Code Contract (0 = PASS, 1 = FAIL, 2 =
NOT_VERIFIED), it correctly reports `REAL_IMAGES_UNAVAILABLE` and exits
2 — an honest environment limitation, not a fabricated result.

## 7. Regression — Full Static Suite

```
$ node qa/run-static-suites.mjs
```
All 69 static suites in this project's full regression list pass
(`node qa/run-static-suites.mjs` exits 0, "All static suites PASSED."),
including the 2 new R6 suites and both pre-existing R5 suites
(`epic-2e-p0-7-r5-preview-state-machine-static-test.mjs` 15/15,
`epic-2e-p0-7-r5-intensity-cache-repair-static-test.mjs` 34/34) and the
underlying `epic-2e-p0-7-pipeline-runtime-static-test.mjs` (39/39,
unchanged). **Zero regressions.**

## 8. Production Lock Verification

All 9 named production-critical files confirmed **byte-for-byte
identical** to the R5 seed via direct `diff`:

| File | Result |
|---|---|
| `core/lightroom-mapping-engine/index.js` | IDENTICAL |
| `core/xmp-validator/index.js` | IDENTICAL |
| `core/preset-engine/index.js` | IDENTICAL |
| `ui/app.js` | IDENTICAL |
| `ui/ui-engine.js` | IDENTICAL |
| `core/decision-engine/index.js` | IDENTICAL |
| `core/preview-rendering/visual-preview-render-plan-v2.js` | IDENTICAL |
| `core/lightroom-mapping-engine/mapping-v2-overlay-preview-sandbox.js` | IDENTICAL |
| `index.html` | IDENTICAL |

A full directory diff against the untouched R5 seed (excluding
`node_modules`, regenerated `qa/*-results.json` evidence, and this
round's own new files) shows changes in **exactly**:
`core/preview-state-machine.js`, `core/generation-control.js`,
`core/analysis-cache.js`, `core/image-analysis-core/index.js`,
`ui/reference-color-match-panel.js`, `qa/run-static-suites.mjs`,
`package.json`, plus the 2 new `core/image-analysis-core/{pixel-math,
worker}.js` files and the 3 new `qa/epic-2e-p0-7-r6-*` test files —
nothing else. `package.json`'s diff is limited to exactly the 3 new npm
scripts. The Candidate contract's forbidden field names (`hslData`,
`toneCurveData`, `colorGradingData`, `calibrationData`) remain absent
from `ui/reference-color-match-panel.js` — verified structurally (§5).

One pre-existing, unrelated finding carried forward from R5: the older
EPIC-2E-J production-lock manifest also flags
`core/color-harmony-engine/index.js` as mismatched against its own
checked-in SHA-256 manifest. Re-confirmed **byte-identical** between the
R5 seed and this delivered copy — the drift already existed before R5,
unrelated to this round, out of scope.

## 9. Package Cleanliness

Excluded from the delivered ZIP: `node_modules/`, `.git/` (none
present), `qa-screenshots/`, the nested
`LUMIXA_EPIC_2E_P0_7_COMPLETE_PROJECT_R2/` folder (a bundled duplicate of
an older project snapshot, carried over from the R5 seed — not part of
this round's deliverable), and this round's own scratch verification
copy (`r5_seed_check/` — used only to diff against the untouched R5 seed,
never part of the deliverable).

## Final Gate Verdict

**FINAL_PASS** for every item provable without real Chromium and the
real photo files: root-cause diagnosis, Syntax Gate, State Machine
transition evidence, Fast/Refined critical-path structural evidence,
full-project regression (69/69 static suites), Production Lock, Package
Cleanliness.

**NOT_VERIFIED** for the Real-Image Runtime Browser QA (§6) — an honest,
doubly-confirmed environment limitation (the real photo files are not
accessible in this sandbox; no real Chromium binary is available here
either), not a defect in the delivered fix. Per this project's
established three-state Release Decision convention (`FINAL_PASS` /
`FAIL` / `NOT_VERIFIED` — never a fabricated PASS, never "CONDITIONAL
COMPLETE"), and consistent with how R5's own Browser QA was reported.
