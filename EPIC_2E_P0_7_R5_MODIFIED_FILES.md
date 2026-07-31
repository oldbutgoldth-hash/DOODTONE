# EPIC 2E-P0.7 R5 — Modified Files

Baseline: `LUMIXA_EPIC_2E_P0_7_COMPLETE_PROJECT_R3.zip` (complete, structured project).
Reference-only source for the Intensity idea: `LUMIXA_EPIC_2E_P0_7_COMPLETE_PROJECT_R4.zip`
(flattened, invalid directory structure — never used as a baseline; only its
Intensity cached-preview *concept* was reused, rewritten from scratch against
R3's real file layout and fixed for its two verified defects).

Confirmed via `diff -rq` against the untouched R3 seed (excluding
`node_modules`, regenerated `qa/*-results.json` evidence files, and this
round's own new files):

## Changed

- **`core/preview-state-machine.js`** — added the `INTENSITY_RERENDERING`
  state and its transitions:
  - `FAST_PREVIEW_READY | ANALYZING_LAYER_2 | REFINED_READY -> INTENSITY_RERENDERING`
  - `INTENSITY_RERENDERING -> FAST_PREVIEW_READY`
  - `INTENSITY_RERENDERING -> ERROR`
  No existing transition was removed or widened. `REFINED_READY ->
  ANALYZING_LAYER_1` and `REFINED_READY -> FAST_PREVIEW_READY` (the exact two
  transitions R4's flattened build logged as invalid) remain correctly
  rejected — proven by a hostile regression test.

- **`ui/reference-color-match-panel.js`**:
  - New `_rebuildIntensityFromCache()` — the cached Intensity-only rebuild.
    Never calls `_analyzeEvidence()`. Reuses `rcm.referenceEvidence` /
    `rcm.targetEvidence` as-is, cancels any in-flight Layer 2
    (`_cancelLayer2()`), bumps a run token within the SAME generation, drives
    the PSM through `INTENSITY_RERENDERING` (checking every `transition()`
    return value — a `false` return fails the operation closed and is
    traced as `STATE_TRANSITION_FAILED`, never silently ignored), rebuilds
    only the pixel transfer (if the Intensity/mode key changed) + Candidate
    (`buildCoreColorMatchPipeline`) + render (`renderColorMatchCandidateToCanvas`),
    then optionally restarts Layer 2 refinement from the same cached
    evidence via the existing `_runLayer2()` (which already verifies
    generation/run-token ownership before every state commit).
  - `onIntensity` slider handler now traces `_trace('INTENSITY', 'CHANGE',
    { value })` on every `input` event, debounces 140ms (within the
    required 120–180ms window), traces `_trace('INTENSITY', 'DEBOUNCED', {
    value })` when the debounce fires, and calls
    `_rebuildIntensityFromCache()` instead of the full pipeline.
  - New `rcm.runtime.counters = { referenceAnalysisCount, targetAnalysisCount,
    intensityRenderCount }`. `referenceAnalysisCount` /
    `targetAnalysisCount` increment only inside `_analyzeEvidence()` by
    `phase`; `intensityRenderCount` increments only on a completed cached
    Intensity rerender. Exposed via `window.__LUMIXA_TEST.counters`.
  - `rcm.runtime.queuedReason` replaces the old always-`'QUEUED'` requeue:
    a rebuild request that arrives while another is running now remembers
    *which kind* it was (`'INTENSITY_CACHED'` vs. a full-pipeline reason),
    so the queued rerun after the current one finishes goes through the
    correct path and always reflects the LATEST slider value (since both
    paths read `rcm.intensity` fresh, never a captured stale value).
  - `window.__LUMIXA_TEST` gained a `counters` getter.

- **`qa/run-static-suites.mjs`** — wired in the 2 new static suites below.

- **`package.json`** — added `test:p0-7-r5:psm`, `test:p0-7-r5:static`,
  `test:p0-7-r5:browser` npm scripts (no other field changed; JSON parses
  cleanly).

## Added

- `qa/epic-2e-p0-7-r5-preview-state-machine-static-test.mjs` — 15 real,
  Node-executed cases against the actual `core/preview-state-machine.js`
  (no DOM needed): every valid `INTENSITY_RERENDERING` entry/exit, every
  hostile forbidden entry, a direct regression reproduction of both exact
  R4-reported warnings (now still correctly rejected), and the unchanged
  original full-analysis sequence. **15/15 PASS.**
- `qa/epic-2e-p0-7-r5-intensity-cache-repair-static-test.mjs` — 34
  structural/source-level cases against the real production
  `ui/reference-color-match-panel.js` and `core/analysis-cache.js`:
  debounce timing, exact `_trace(stage, status, detail)` call shapes
  (including two hostile checks reproducing R4's own defect —
  object-as-status and raw-value-as-status — now proven absent), counters,
  the cached path never calling `_analyzeEvidence()`, Layer 2
  cancel/restart wiring, Save After Image never disabled during Intensity
  rerender, the forbidden Candidate field names, and cache-key
  Intensity-independence proven against the real, imported
  `core/analysis-cache.js` (not a re-implemented stub). **34/34 PASS.**
- `qa/epic-2e-p0-7-r5-intensity-cache-repair-browser-test.mjs` — real
  Chromium/Playwright suite covering all 4 required scenes (portrait+
  portrait, wedding/white-clothing, complex green background, a different
  aspect ratio), the full 0/25/50/60/75/100 Intensity sweep, the rapid
  10→80→25→95→60 drag (asserting the final Preview reflects 60), counters,
  zero `PSM: invalid transition` warnings, no undefined-hsl error, no
  stale-generation commit, no permanent loading state, and Save After Image
  usability. Syntax/import-verified; see the QA Report for this
  environment's honest execution status.

## Never touched

`core/lightroom-mapping-engine/index.js`, `core/xmp-validator/index.js`,
`core/preset-engine/index.js`, `ui/app.js`, `ui/ui-engine.js`,
`core/decision-engine/index.js`,
`core/preview-rendering/visual-preview-render-plan-v2.js`,
`core/lightroom-mapping-engine/mapping-v2-overlay-preview-sandbox.js`,
`index.html` — all 9 confirmed **byte-for-byte identical** to the untouched
R3 seed via direct `diff`.

## Regenerated (expected side effect, not a manual edit)

Several `qa/*-results.json` files changed timestamps/`runId` because
running their suites (to verify no regression) overwrites their own result
artifact on every run — the same "fresh evidence, never stale" convention
established since EPIC 2E-K-R2. No suite's *source* file was touched
outside the list above.

## Pre-existing, unrelated finding (not introduced by this round)

`qa/epic-2e-j-r2-phase-e-static-test.mjs`'s Production-lock manifest check
(`R3-12`) also flags `core/color-harmony-engine/index.js` as mismatched
against its checked-in SHA-256 manifest. This file is **byte-identical**
between the untouched R3 seed and this delivered copy — the drift already
existed in the uploaded R3 baseline itself, before any R5 work began, and
is unrelated to the Intensity repair. Not fixed here (out of this round's
scope; `core/color-harmony-engine` was never a focus file).
