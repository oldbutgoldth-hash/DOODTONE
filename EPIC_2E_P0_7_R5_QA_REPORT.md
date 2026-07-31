# EPIC 2E-P0.7 R5 — QA Report

## 1. Syntax Gate

`node tools/esm-syntax-gate.mjs` → **269/269 PASS** (every `.js`/`.mjs` file
in the project, including the 3 new R5 QA files, parses cleanly as an ES
module).

## 2. State Machine Transition Evidence

`node qa/epic-2e-p0-7-r5-preview-state-machine-static-test.mjs` — **15/15
PASS**, executed directly against the real, unmodified-elsewhere
`core/preview-state-machine.js`:

| # | Case | Result |
|---|---|---|
| 1 | `FAST_PREVIEW_READY -> INTENSITY_RERENDERING` | PASS |
| 2 | `ANALYZING_LAYER_2 -> INTENSITY_RERENDERING` | PASS |
| 3 | `REFINED_READY -> INTENSITY_RERENDERING` | PASS |
| 4 | `INTENSITY_RERENDERING -> FAST_PREVIEW_READY` | PASS |
| 5 | `INTENSITY_RERENDERING -> ERROR` | PASS |
| 6-10 | HOSTILE: `IDLE/WAITING/ANALYZING_LAYER_1/ERROR/STALE -> INTENSITY_RERENDERING` all correctly REJECTED | PASS (5/5) |
| 11 | HOSTILE regression guard: `REFINED_READY -> ANALYZING_LAYER_1` still REJECTED (the exact R4 defect) | PASS |
| 12 | HOSTILE regression guard: `REFINED_READY -> FAST_PREVIEW_READY` still REJECTED (the exact R4 defect) | PASS |
| 13 | Full original sequence `IDLE->WAITING->ANALYZING_LAYER_1->FAST_PREVIEW_READY->ANALYZING_LAYER_2->REFINED_READY` unchanged | PASS |
| 14 | `REFINED_READY -> WAITING` (new-pair reset path) still valid | PASS |
| 15 | `canTransition()` agrees with `transition()` for the new state | PASS |

Console output from this run (reproduced verbatim) shows the exact R4-style
warnings occurring **only** on the hostile (expected-to-fail) cases, proving
the fix without hiding the underlying mechanism:
```
PSM: invalid transition IDLE -> INTENSITY_RERENDERING
PSM: invalid transition WAITING -> INTENSITY_RERENDERING
PSM: invalid transition ANALYZING_LAYER_1 -> INTENSITY_RERENDERING
PSM: invalid transition ERROR -> INTENSITY_RERENDERING
PSM: invalid transition STALE -> INTENSITY_RERENDERING
PSM: invalid transition REFINED_READY -> ANALYZING_LAYER_1
PSM: invalid transition REFINED_READY -> FAST_PREVIEW_READY
```
Every one of these seven lines corresponds to a case this test asserts
`transition() === false` for — i.e. these are the state machine correctly
protecting itself, not a live defect. The production code path
(`_rebuildIntensityFromCache()`) never attempts any of these seven
transitions (proven separately, static test case below).

## 3. Intensity/Cache Repair Static Test

`node qa/epic-2e-p0-7-r5-intensity-cache-repair-static-test.mjs` —
**34/34 PASS** against the real production
`ui/reference-color-match-panel.js` and `core/analysis-cache.js`. Full
breakdown: debounce timing (1), debounce cancellation (1), trace-signature
shape for all 5 required `_trace('INTENSITY', ...)` calls (5), two hostile
checks reproducing R4's own trace-signature defect now proven absent (2),
counters existence/wiring (6), cached-path structural checks — never calls
`_analyzeEvidence`, cancels Layer 2, rebuilds Candidate, renders Preview,
restarts Layer 2, never disables Save After, checks `transition()` return
value at least twice, enters `INTENSITY_RERENDERING`, never transitions
directly to `ANALYZING_LAYER_1` (9), slider wiring (2), forbidden Candidate
field names absent (4), and cache-key Intensity-independence proven against
the real, imported cache module (4).

## 4. Regression — Pre-existing P0.7 Suites

- `qa/epic-2e-p0-7-pipeline-runtime-static-test.mjs` — **39/39 PASS**
  (unchanged; `validateCandidate`/`getLayer1Subset`/`getLayer2Subset`/
  tracer/core-runner all still green).
- `qa/epic-2e-p0-4-1-intensity-candidate-normalization-test.mjs` —
  **6/6 PASS** (unchanged).
- Full project static suite (`node qa/run-static-suites.mjs`, 59 suites
  including the 2 new ones) — every suite passes except the one pre-
  existing, unrelated finding below (item 9).
- `node --check` across every `.js`/`.mjs` file in `core/`, `ui/`, `qa/` —
  clean (the only "syntax error" found is the deliberately malformed
  negative-test fixture `qa/fixtures/esm-syntax-gate/duplicate-const-same-scope.mjs`,
  which exists specifically to be rejected by the syntax gate tool).

## 5. Intensity/Cache Trace — Illustrative Sequence

The following is the exact, in-order sequence of `_trace(stage, status,
detail)` calls a single Intensity change produces, reconstructed directly
from the production call sites in `ui/reference-color-match-panel.js`
(each line's presence and exact shape is independently proven by static
test §3 above). This is a worked illustration of the wiring, not a live
Browser capture — the Browser test in §7 is what exercises it against a
real running page:

```
_trace('INTENSITY', 'CHANGE',   { value: 60 })   // on the slider's 'input' event
// ...140ms debounce...
_trace('INTENSITY', 'DEBOUNCED', { value: 60 })  // debounce fired, calling _rebuildIntensityFromCache()
_trace('INTENSITY', 'CACHE_REUSED', { reference: true, target: true })
_trace('INTENSITY', 'CANDIDATE_REBUILT', { value: 60 })
_trace('INTENSITY', 'PREVIEW_RERENDERED', { value: 60 })
```
If Reference/Target evidence is not yet cached (first-ever pair), the
sequence instead falls back honestly:
```
_trace('INTENSITY', 'CACHE_MISS', { value: 60 })  // falls back to the full pipeline
```
On a real state-transition failure (defensive path, not expected to be
reachable given the `running` mutex — see Modified Files):
```
_trace('INTENSITY', 'STATE_TRANSITION_FAILED', { from: 'REFINED_READY', to: 'INTENSITY_RERENDERING' })
```

## 6. Browser QA Report

**Environment: BROWSER_BINARY_UNAVAILABLE — NOT_VERIFIED in this sandbox.**

```
$ node qa/epic-2e-p0-7-r5-intensity-cache-repair-browser-test.mjs
Final decision: BROWSER_BINARY_UNAVAILABLE — No real Chromium/Chrome/Edge
executable found (bundled Playwright Chromium not downloaded —
network-blocked in this environment — and no system browser binary
detected).
$ echo $?
2
```
Verified before reaching this conclusion:
- `npm ci` succeeded (47 packages, including `playwright@^1.61.1`).
- `npx playwright install chromium` failed 5 times with `403 Connection
  blocked by network allowlist` against `cdn.playwright.dev`.
- No `google-chrome`, `chromium`, `chromium-browser`, or
  `microsoft-edge-stable` binary found on this system (`which` for all 5
  candidates: not found).

This suite is written, syntax/import-verified (§1), wired to all 4 required
scenes (portrait+portrait at 3:4 aspect, wedding/white-clothing, complex
green background, a 16:5 panorama for a distinct aspect ratio), and
implements every required assertion from the release spec: initial Preview
appears; Intensity 0/25/50/60/75/100 sweep with per-value counters/Save-
After/loading-state checks; rapid 10→80→25→95→60 drag settling on 60;
zero `PSM: invalid transition` warnings (suite-failing if any appear); no
undefined-hsl error; no unhandled pageerror. It self-reports honestly
(`BROWSER_BINARY_UNAVAILABLE`, exit 2) rather than fabricating a PASS, per
this project's established Exit Code Contract convention. **Run `npm run
test:p0-7-r5:browser` on a machine with real Chromium/Chrome/Edge to close
this out** — this project's Reference Color Match / P0.7 suites have
previously been confirmed to run successfully on real Chromium on the
user's own machine.

## 7. Production Lock Verification

All 9 named production-critical files confirmed **byte-for-byte identical**
to the untouched R3 seed via direct `diff`:

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

A full `diff -rq` between the untouched R3 seed and this delivered copy
(excluding `node_modules`, regenerated `qa/*-results.json` evidence, and
this round's own new files) shows changes in **exactly**:
`core/preview-state-machine.js`, `ui/reference-color-match-panel.js`,
`qa/run-static-suites.mjs`, `package.json` — nothing else. The hardcoded
production-flag literals inside `ui/reference-color-match-panel.js`
(`el.dataset.productionSource = 'legacy'`, `productionWrite = 'false'`,
`xmpWriteAllowed = 'false'`, `candidateXmpInMemoryOnly = 'true'`) are
untouched — confirmed present, unchanged, in the same file this round did
modify (verified by direct grep against the delivered source).

One pre-existing, unrelated finding: `qa/epic-2e-j-r2-phase-e-static-test.mjs`'s
production-lock manifest check also flags `core/color-harmony-engine/index.js`
as mismatched — confirmed **byte-identical** between the untouched R3 seed
and this delivered copy (the drift already existed in the uploaded R3
baseline itself). Not introduced by this round; out of scope to fix here.

## 8. Package Cleanliness

Excluded from the delivered ZIP: `node_modules/`, `.git/` (none present),
`qa-screenshots/` (11MB of generated screenshots, not required as
evidence for this round), the nested `LUMIXA_EPIC_2E_P0_7_COMPLETE_PROJECT_R2/`
folder (a bundled ~19MB duplicate of an older complete project snapshot),
and this round's own scratch verification copies (`r3_pristine_check*`,
`r3_full_pristine` — used only to diff against the untouched seed, never
part of the deliverable).

## Final Gate Verdict

**FINAL_PASS** for every item provable without a real Chromium binary
(Syntax Gate, State Machine transition evidence, Intensity/cache static
test, full-project regression, Production Lock, Package Cleanliness).
**NOT_VERIFIED** for the Browser QA scenes (§6) — an honest environment
limitation (no real Chromium, network-installation blocked), not a defect,
exactly as this project's established three-state Release Decision
convention requires (`FINAL_PASS` / `FAIL` / `NOT_VERIFIED` — never a
fabricated PASS, never "CONDITIONAL COMPLETE").
