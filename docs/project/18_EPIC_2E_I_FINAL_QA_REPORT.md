# 18 — EPIC 2E-I Final QA Report (Release Closeout)

## 1. Scope

Final release-closeout audit for EPIC 2E-I (AI Workflow v1.1.9),
consolidating all QA performed across Phase A/A-F/A-F2, Phase B/B-F/B-F2,
Phase C/C-F/C-F2, plus fresh full-project verification performed in this
closeout phase (Phase D).

## 2. Version Tested

AI Workflow **v1.1.9 (EPIC 2E-I)** — the version metadata itself was
updated in this phase; all functional QA below was run against the
updated codebase.

## 3. Files Audited

All JavaScript files under `core/`, `ui/`, and `qa/` (77 files total —
see Section 4), plus `index.html` and all `docs/project/*.md` release
documentation.

## 4. Syntax Results

```
Total files checked: 77
Passed:              77
Failed:              0
```

Run fresh in this phase via `node --check` on every `.js`/`.mjs` file
under `core/`, `ui/`, and `qa/` — not limited to files modified in this
phase.

## 5. Import-Resolution Results

Verified via real ES-module `import()` in Node for every modified/new
Interactive Before/After file across the full EPIC 2E-I series (repeated
at each patch); re-confirmed in this phase that `core/project-version.js`'s
updated export still imports cleanly and that `index.html`'s dynamic
`import('./core/project-version.js')` resolves and applies correctly at
runtime (verified live: header badge renders "v1.1.9 (EPIC 2E-I)").

## 6. Runtime Smoke-Test Results

The reproducible Playwright smoke test (`qa/epic-2e-i-phase-c-smoke-test.mjs`)
was re-run fresh in this phase (not hand-edited):

```
31/31 PASS, 0 FAIL
```

Covering: Ready/Partial/Safety-Blocked state reachability, 0/50/100%
direction, keyboard (ArrowRight/Home/End), focus-visible (handle + range),
Shift+Tab non-trapping, real pointer-drag split update, dragging-class
removal, zero `drawImage`/`getImageData` calls during a full slider sweep,
document non-overflow at 320/360/390/430/768/900/1024/1440px, a 3000×2000
image's internal scrollability and non-resizing, zero duplicate IDs, and
zero console errors. Full results: `qa/epic-2e-i-phase-c-results.json`.

## 7. Responsive Results

All 8 tested widths pass with `document.documentElement.scrollWidth === clientWidth`
exactly (see Section 6). Two genuine pre-existing layout defects (an
icon-font fallback-text overflow, and a topbar responsive-breakpoint gap
between 680-900px) were found and fixed at their actual source during
EPIC 2E-I-C-F2 — not by a global overflow hide.

## 8. Split Behavior

0%/50%/100% direction verified both programmatically (clip-path values)
and with real browser screenshots showing visually-distinguishable
red(Legacy)/green(Controlled V2) test canvases — Legacy consistently left,
Controlled V2 consistently right, matching the documented split semantics
exactly.

## 9. Alignment Results

Verified: identical dimensions (exact match, no normalization needed);
same-ratio/different-dimensions (normalized once to a shared bounded
size); one-pixel/0.05%/0.5%/2% ratio differences (correctly pass/block per
the tightened 0.1% tolerance); materially mismatched ratios (correctly
blocked, `blockedReason: "alignment"`, stale prior pixels cleared).

## 10. State-Priority Results

The shared `deriveInteractiveBeforeAfterStateV2()` helper was unit-tested
directly across all 8 priority levels (stale, safety-anomaly-before-bind,
ready, partial, both-failed, blocked-preview-state, preparing,
unavailable) — all produced the exact expected `state`/`blockedReason`.

## 11. Safety-Blocking Results

All 4 anomaly conditions (`selectedProductionSource: "v2"`,
`v2Contradictory: true`, `allowExport: true`, `allowProductionWrite: true`)
verified to correctly block, including when neither preview has rendered
yet (i.e. before any canvas bind is even attempted) — confirming the
anomaly check genuinely outranks every other state.

## 12. Lifecycle Results

A full live sequence — Import image A → Re-analyze → Import image B
(different aspect ratio) → Reset → Import image C (large, requiring
downscale) — produced zero duplicate sections, zero stale pixels/
dimensions carried across steps, and zero console errors throughout.

## 13. Pointer Results

Drag-from-handle (single-processed, no duplicate movement via
`stopPropagation()`), drag-from-viewport, drag-outside-viewport-while-
captured (correctly clamps to 100), pointerup/pointercancel/
lostpointercapture (all release capture via one shared helper), Re-analyze
mid-drag (correctly cancels and resets split to 50) — all verified.

## 14. Keyboard Results

ArrowRight/Left, Home (0%/V2), End (100%/Legacy), Page Up/Down (native
range behavior, unmodified), Tab reaching the control, Shift+Tab not
trapping focus — all verified live in this phase's extended smoke test.

## 15. Focus Results

`:focus-visible` computed `outline-style: solid` confirmed on both the
handle and the range input (added in EPIC 2E-I-C-F, re-verified in this
phase's extended smoke test).

## 16. Performance Evidence

Zero `drawImage`/`getImageData` calls instrumented across a full 0→100%
slider sweep (21 discrete steps). No resize listener exists in either
Interactive file (grep-confirmed). Display-canvas copying occurs only
inside `updateSources()`, never from `setSplit()` or any pointer/keyboard
handler.

## 17. Security/Malformed-Data Evidence

HTML/script-injection warning text renders as safely-escaped plain text
with zero script execution; circular-reference warning objects are safely
dropped; hostile getters (always-throw, throw-on-second-read) at every
tested boundary (controller input, safety object, alignment object,
renderer state) produce zero uncaught exceptions; `NaN`/`Infinity`/
`-Infinity` split values correctly fall back to the documented default
(50) rather than crashing or producing an out-of-range value; repeated
`dispose()` calls are idempotent.

## 18. Production-Isolation Evidence

A project-wide search for `splitPercent`, `interactiveBeforeAfter`,
`interactive-before-after`, `displayDimensionsNormalized`, `legacyStatus`,
`v2Status` outside `ui/`/`docs/`/`qa/` returned **zero matches** anywhere
under `core/`, including `core/decision-engine`, `core/preset-engine`,
`core/xmp-validator`, `core/reference-transfer-engine`, and
`core/decision-report-engine`. The only runtime consumers found are
UI-local modules (`ui/app.js`, the Interactive controller/renderer).

## 19. Mapping/XMP Comparison

`selectedProductionSource` is **hard-coded `"legacy"`** in
`core/preview-rendering/visual-preview-render-plan-v2.js` — confirmed by
direct source inspection, including that file's own documenting comment
(`` `selectedProductionSource` is hard-coded `"legacy"`. No returned plan... ``).
XMP export was re-verified in this phase to be **byte-identical (2962
bytes)** to the pre-EPIC-2E-I baseline, using the same standard test input
used throughout this project's QA history.

Honest wording per this phase's instruction: **Production Mapping and XMP
code paths were unchanged and no Interactive viewer consumer was found.**
An exhaustive field-by-field semantic XMP diff (beyond byte-length
comparison) was **NOT TESTED** in this phase.

## 20. Tests Not Performed

- Physical mobile device: **NOT TESTED**
- Physical touch hardware: **NOT TESTED**
- Real screen-reader software (NVDA/JAWS/VoiceOver): **NOT TESTED**
- Real portrait/wedding/event photographs: **NOT TESTED** (all fixtures
  used across this EPIC were synthetic — flat-color or simple-shape test
  images; this was corrected/documented honestly in
  `docs/project/15_EPIC_2E_I_PHASE_C_REAL_IMAGE_QA.md` during EPIC
  2E-I-C-F after an initial imprecise labeling was found and fixed)
- Lightroom visual parity: **NOT TESTED** (not a goal of this feature)
- Adobe Camera Raw parity: **NOT TESTED** (not a goal of this feature)
- Exact camera-profile parity: **NOT TESTED**
- Long-duration memory profiling: **NOT TESTED**
- Exhaustive field-by-field semantic XMP diff (beyond byte-length): **NOT TESTED**

## 21. Remaining Risks

- Real-device pointer/touch edge cases (e.g. browser-specific pointer-
  capture quirks) cannot be fully ruled out without physical hardware.
- Real assistive-technology compatibility cannot be fully confirmed
  without dedicated screen-reader testing.
- Visual behavior on genuine photographic content (skin tones, fine
  detail, high dynamic range) has not been directly observed, though the
  underlying pipeline mechanics (decode, aspect-ratio preservation,
  downscale, alignment, rendering) are content-agnostic and were verified
  correct.

## 22. Release Decision

**CONDITIONAL PASS — Core release is safe; only explicitly documented
manual QA remains.**

Justification: syntax audit passes fully (77/77), all imports resolve,
the reproducible smoke test passes fully (31/31), no release-blocking
Interactive-viewer defect was found or remains, production isolation is
confirmed via exhaustive project-wide search, Mapping's
`selectedProductionSource` remains hard-coded to Legacy, and the XMP
export byte-length is unchanged. The CONDITIONAL qualifier reflects
exactly the explicitly-listed NOT TESTED items above (physical device,
screen reader, real photographic content, exhaustive semantic XMP diff) —
none of which represent a known defect, per this phase's own criteria for
when CONDITIONAL PASS (rather than FAIL) applies.
