# EPIC 2E-P0.7 R5 — Release Notes

**Intensity Cached Preview Repair + State Machine Closure + Clean Complete
Project Packaging.**

## Fixed

1. **Target Matched Preview did not update automatically after moving
   Intensity — the user had to click ANALYZE REFERENCE.** Fixed with a new
   cached Intensity-only rebuild path (`_rebuildIntensityFromCache()`) wired
   directly to the slider's debounced `input` handler. ANALYZE REFERENCE is
   no longer required after the first Preview exists.
2. **R4's PSM defect: `PSM: invalid transition REFINED_READY ->
   ANALYZING_LAYER_1` / `REFINED_READY -> FAST_PREVIEW_READY`.** Root cause:
   R4's fast-path transitioned the state machine directly into
   `ANALYZING_LAYER_1`/`FAST_PREVIEW_READY` without going through the
   existing `_resetPsmToWaiting()` dance, which is invalid from
   `REFINED_READY`. Fixed by adding a **dedicated `INTENSITY_RERENDERING`
   state** (never `ANALYZING_LAYER_1/2` — those legitimately mean real Core
   analysis is running, which an Intensity rerender never does) with valid
   transitions from `FAST_PREVIEW_READY`, `ANALYZING_LAYER_2`, and
   `REFINED_READY`, out to `FAST_PREVIEW_READY`, and to `ERROR` on failure.
3. **R4's ZIP flattened the entire directory structure.** Not applicable
   here — R3's structure was used as the untouched baseline throughout;
   only R4's *idea* (debounced cache-reuse rebuild) was reused, rewritten
   against R3's real file layout and its exact production call sites.
4. **Every `psm.transition()` call in the new code path checks its return
   value.** A `false` return records a `_trace('INTENSITY',
   'STATE_TRANSITION_FAILED', {...})` entry and fails the operation closed
   (never silently continues in an unknown state).

## Added

- `core/preview-state-machine.js`: `PREVIEW_STATE.INTENSITY_RERENDERING`
  and its transition table entries.
- `ui/reference-color-match-panel.js`:
  - `_rebuildIntensityFromCache()` — reuses cached Reference/Target
    evidence, rebuilds only pairwise fusion → Candidate → Preview render
    (+ optional Layer 2 restart from cache), never reruns Core analysis.
  - `rcm.runtime.counters` — `referenceAnalysisCount`, `targetAnalysisCount`,
    `intensityRenderCount`, exposed via `window.__LUMIXA_TEST.counters`.
  - `rcm.runtime.queuedReason` — a rapid slider drag that arrives while a
    rebuild is already running is remembered by *kind*, so the eventual
    queued rerun goes through the correct path and always reflects the
    LATEST slider value.
- Two new static Node test suites (49 real assertions total, 0 requiring a
  Browser) and one new Chromium Browser test suite covering all 4 required
  real-photographic scenes — see `EPIC_2E_P0_7_R5_MODIFIED_FILES.md` for
  the full list and `EPIC_2E_P0_7_R5_QA_REPORT.md` for results.

## Intensity Workflow (as implemented)

```
Reference selected -> Reference analysis -> Reference evidence cached
Target selected     -> Target analysis    -> Target evidence cached
                     -> Initial Target Matched Preview (full pipeline, once)

Intensity changed (input event)
  -> _trace('INTENSITY','CHANGE',{value})
  -> debounce 140ms (cancels any previous pending debounce)
  -> _trace('INTENSITY','DEBOUNCED',{value})
  -> _rebuildIntensityFromCache()
       -> reuse Reference evidence (no re-analysis)
       -> reuse Target evidence (no re-analysis)
       -> _trace('INTENSITY','CACHE_REUSED',{reference:true,target:true})
       -> cancel any obsolete Layer 2 task
       -> PSM: (FAST_PREVIEW_READY|ANALYZING_LAYER_2|REFINED_READY) -> INTENSITY_RERENDERING
       -> rebuild pixel transfer (only if Intensity/mode changed) + Candidate
       -> _trace('INTENSITY','CANDIDATE_REBUILT',{value})
       -> render Target Matched Preview
       -> PSM: INTENSITY_RERENDERING -> FAST_PREVIEW_READY
       -> intensityRenderCount++
       -> Save After Image stays enabled
       -> _trace('INTENSITY','PREVIEW_RERENDERED',{value})
       -> optionally restart Layer 2 refinement from cached evidence
ANALYZE REFERENCE is never required for an Intensity update.
```

## State Machine Repair

```
FAST_PREVIEW_READY   -> INTENSITY_RERENDERING -> FAST_PREVIEW_READY   (valid)
ANALYZING_LAYER_2     -> INTENSITY_RERENDERING -> FAST_PREVIEW_READY   (valid)
REFINED_READY         -> INTENSITY_RERENDERING -> FAST_PREVIEW_READY   (valid)
INTENSITY_RERENDERING -> ERROR                                        (valid)

REFINED_READY -> ANALYZING_LAYER_1     -- still, correctly, REJECTED
REFINED_READY -> FAST_PREVIEW_READY    -- still, correctly, REJECTED
IDLE/WAITING/ANALYZING_LAYER_1/ERROR/STALE -> INTENSITY_RERENDERING -- REJECTED
```
Proven by 15 real, Node-executed transition assertions (see QA Report).

## Slider Event / Rapid-Drag Behaviour

- Listens on the `input` event (Preview follows live movement).
- Debounce: 140ms (within the required 120–180ms window); the previous
  timer is always cancelled before scheduling a new one.
- A rebuild request arriving while one is already running is queued by
  *kind* (`queuedReason`), not blindly re-run as a generic `'QUEUED'`
  reason — and since both rebuild paths always read the live
  `rcm.intensity`, the queued rerun necessarily reflects whichever value
  was last set, satisfying "only the latest slider value may commit UI
  state" without needing to track intermediate values explicitly.

## Cache / Counters

- `getCachedReferenceAnalysis` / `getCachedTargetAnalysis`
  (`core/analysis-cache.js`) are unmodified — Intensity was already, and
  remains, absent from the cache key (`filePath:imageId:dimensions:profileVersion`).
- `referenceAnalysisCount` / `targetAnalysisCount` increment only inside
  `_analyzeEvidence()`, gated by `phase`; the cached Intensity path never
  calls that function at all — proven structurally (34/34 static test) and
  behaviourally (Browser test counters-unchanged assertions per Intensity
  value, once run on a machine with Chromium).
- `intensityRenderCount` increments once per completed cached Intensity
  rerender.

## Candidate Contract

No new/parallel Candidate schema was introduced. The cached Intensity path
reuses the exact same `buildCoreColorMatchPipeline()` call (identical
argument shape) and `core/candidate-schema.js` normalizer already used by
the full pipeline — proven by direct source comparison (see Modified Files)
and a structural check that `hslData` / `toneCurveData` /
`colorGradingData` / `calibrationData` do not exist anywhere in the
modified source.

## Production Lock

Unchanged: `productionSource=legacy`, `productionWrite=false`,
`controlledV2Apply=false`, `xmpWriteAllowed=false`,
`productionActivationAllowed=false`. Reference Color Match remains
Beta/candidate-only. All 9 named production-critical files are
byte-for-byte identical to the untouched R3 seed (see QA Report, Production
Lock section).

## Known Limitations

- **No real Chromium in this sandbox.** The bundled Playwright Chromium
  download is blocked by this environment's network allowlist (`403
  Connection blocked by network allowlist`), and no system
  Chrome/Chromium/Edge binary is present — the same constraint documented
  continuously across every prior EPIC 2E round in this project. The new
  Browser test (`epic-2e-p0-7-r5-intensity-cache-repair-browser-test.mjs`)
  is written, wired to all 4 required scenes, and syntax/import-verified,
  but has never executed against a real page here. It correctly reports
  `BROWSER_BINARY_UNAVAILABLE` and exits 2 rather than fabricating a PASS.
  Run it (or `npm run test:p0-7-r5:browser`) on a machine with real
  Chromium to close this out — this project has previously confirmed real
  Chromium (144.0.7559.96) works on the user's own machine for closely
  related suites.
- **Pre-existing, unrelated:** `core/color-harmony-engine/index.js`
  already differed from the checked-in production-lock manifest in the
  R3 seed itself, before this round began. Confirmed unrelated and left
  untouched (see Modified Files).
- The `LUMIXA_EPIC_2E_P0_7_COMPLETE_PROJECT_R2` folder bundled inside the
  R3 seed (an older, complete project snapshot, ~19MB) and the generated
  `qa-screenshots/` directory are excluded from the delivered R5 ZIP per
  the packaging spec's "duplicate package files" / "obsolete screenshots"
  exclusion — neither is required as evidence for this round.

## Next Development Boundary

No Deploy occurred. Controlled V2 Production remains disabled. Reference
Color Match remains Beta/candidate-only. Closing the Browser QA gap
(running the new suite on a machine with real Chromium) is the only
remaining step before this round can be called fully, empirically closed.
