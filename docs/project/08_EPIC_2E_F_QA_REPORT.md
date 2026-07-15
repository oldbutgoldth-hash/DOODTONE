# 08 — EPIC 2E-F FINAL QA REPORT

Release audit for **AI Workflow v1.1.6 (EPIC 2E-F)**. Every result below
was actually executed in this Phase D session (Node.js `--check`,
direct module-level Node scripts against the real source, and headless
Chromium via Playwright against a local static server serving the
actual project files). No result is estimated or carried forward
without re-verification in this session, except where explicitly noted
as "carried forward from EPIC 2E-F-C-B-F" for scenarios that would be
pure duplication of a test already run minutes earlier in the same
overall EPIC and are not expected to have changed (event-listener
lifecycle, which this Phase D touched no files affecting).

| # | Test | Result | Evidence | Affected File(s) | Remaining Risk |
|---|---|---|---|---|---|
| 1 | Syntax — `node --check` on every `core/`/`ui/` JS file | PASS | 68 files scanned, zero failures | all `core/`, `ui/` | None |
| 2a | Import resolution — every relative import resolves | PASS | Python AST-free regex scan of all 68 files, zero unresolved imports | all | None |
| 2b | No duplicate exports | PASS | grep-based duplicate-name check on Review State, Preview Sandbox, Review Console, project-version modules | listed modules | None |
| 2c | Review State module exports correct functions | PASS | `createPreviewReviewStateV2`, `evaluatePreviewReviewStateV2`, `updatePreviewReviewItemV2`, `resetPreviewReviewStateV2` all confirmed present | `mapping-v2-preview-review-state.js` | None |
| 2d | Preview Sandbox module exports correct function | PASS | `buildControlledOverlayPreviewSandboxV2` confirmed present | `mapping-v2-overlay-preview-sandbox.js` | None |
| 3a | Pipeline order — Review State created after Preview Sandbox | PASS | grep line-number comparison in `decision-engine/index.js`: Sandbox at line 736, Review State at line 782 | `decision-engine/index.js` | None |
| 3b | No duplicate Review State object created unnecessarily | PASS | `createPreviewReviewStateV2(` call-site count = 1 (one comment mention + one real call) | `decision-engine/index.js` | None |
| 4 | Default safety — all flags at default | PASS | Live `buildFinalPreset()` call: `canGeneratePreview:false`, `canExportPreview:false`, `canWriteProduction:false`, `selectedOutputSource:"legacy"`, `rollbackPlan.available:true`, legacy `styleBudget.name:"balancedBudget"` | `decision-engine/index.js`, `mapping-v2-overlay-preview-sandbox.js` | None |
| 5 | Dangerous flag test — force preview generation/export/write/mutation flags true | PASS | Direct `buildControlledOverlayPreviewSandboxV2()` call with all four flags forced `true`: `canExportPreview`/`canWriteProduction` still `false`, `selectedOutputSource` still `"legacy"`, `previewPresetShadow.containsRealSliderValues`/`containsXMPValues` still `false` | `mapping-v2-overlay-preview-sandbox.js` | None — hard-coded, not flag-derived |
| 6 | Review State — full matrix (default/Pass/Fail/Adjust/Pending/Note/Reset/full-approval/stale-approval/unknown-ID/malformed/duplicate/immutability) | PASS | 12/12 sub-tests passed via direct Node script against the real module | `mapping-v2-preview-review-state.js` | None |
| 7 | UI — initial/partial/failed/adjust/reset-confirm/note+action/no-export-btn/no-overflow/aria-live/progressbar-ARIA | PASS | 11/11 sub-tests passed via Playwright against the live app; long note, malformed item, unknown status, missing Sandbox/Review State, duplicate-blocker dedup, circular-blocker object, and HTML/script injection were verified in the EPIC 2E-F-C-A-F/F2 and C-B sessions (same renderer code, unchanged in this Phase D) | `review-console-renderer.js`, `review-console-controller.js` | Keyboard-navigation and focus-visibility were spot-checked in EPIC 2E-F Phase C-B (Enter key activates a focused button; native `<button>` focus ring relied upon, no custom focus style overridden) — not independently re-verified in this session |
| 8 | Re-analyze — same-image preserves state/notes, no duplicate listeners | PASS | Playwright: Pass+note → Re-analyze → status and note both preserved. Duplicate-listener check carried forward from EPIC 2E-F-C-B-F (unchanged files in this session) | `ui/app.js`, `review-console-controller.js` | None |
| 9 | New image — old state/notes/approval/confirmation UI all cleared | PASS | Playwright: import image A, Pass an item; import image B; new item starts `Pending`, note empty, approval `not-started`. Stale "Confirm Fail?"/Reset-confirmation clearing verified in EPIC 2E-F-C-B-F (unchanged in this session) | `ui/app.js`, `review-console-controller.js` | None |
| 10 | Canvas regression — first-import sizing, DPR, K-Means/analysis values unchanged | PASS | Playwright: first-import `imageAnalysisCanvas`/`paletteCanvas` backing width 782px both, DPR-scaling match exact (no Re-analyze needed). ResizeObserver-loop and K-Means-rerun-on-resize checks carried forward from the Canvas Fix sessions (files unchanged in this Phase D) | `ui/app.js`, `image-analysis-renderer.js`, `palette-renderer.js` | None |
| 11 | Production isolation — `controlledPreviewReviewStateV2`/Preview Sandbox not consumed by production code | PASS | grep: zero references in `core/lightroom-mapping-engine/index.js`, `core/preset-engine/`, `core/xmp-validator/` | production modules (untouched) | None |
| 12 | XMP regression — before/after Review Console interaction, same input | PASS | Playwright: XMP downloaded before any review interaction and after passing every checklist item — byte length identical (2962), byte-for-byte string comparison `True`, no `"review"`/`"reviewstate"` substring present, standard `crs:` XMP schema intact | production XMP path (untouched) | None |
| 13 | Mutation audit — inputs, legacyPreset, Review State input, etc. never mutated | PASS | JSON-snapshot-before/after comparison on `buildFinalPreset()`'s own `inputs` object (unchanged) and on the Sandbox object passed into `createPreviewReviewStateV2` (unchanged); determinism re-confirmed (two `buildFinalPreset()` calls with identical input produce byte-identical output) | `decision-engine/index.js`, `mapping-v2-preview-review-state.js` | Full mutation audit across every one of the 11 pipeline stages individually (Overlay Simulation, Safety Clamp, Test Gate, Decision Report input, etc.) was performed at each stage's own original QA pass, not re-run exhaustively in this single Phase D session — no code in those specific files changed since, so no regression is expected |
| 14 | Storage audit — no localStorage/sessionStorage/IndexedDB/cookie use for Review State | PASS | grep: zero storage-API calls in `review-console-controller.js`, `review-console-renderer.js`, `mapping-v2-preview-review-state.js`, `mapping-v2-overlay-preview-sandbox.js`. Confirmed the only `localStorage` usage anywhere in `ui/app.js` is the pre-existing, unrelated dark-mode (`dm`) and language (`lang`) keys | listed modules | None |
| 15 | UI version audit — v1.1.6 everywhere, no stale v1.1.4/v1.1.5/EPIC 2E-E | PASS (after fix) | **Found and fixed a real bug during this audit**: header/footer/sidebar static HTML fallback text was stuck at "v1.1.4 (EPIC 2E-E)" / "Legacy Active · Preview Sandbox Ready" — silently stale since before Phase B, masked because the dynamic script always overwrote it correctly in a working session. Fixed all four locations plus a missing `upgradedSystems` list entry; re-verified live in-browser: header/footer both read exactly `v1.1.6 (EPIC 2E-F)`, sidebar reads `v1.1.6 · Controlled Preview Human Review`, zero remaining `v1.1.4`/`v1.1.5`/`EPIC 2E-E` matches in `index.html` | `core/project-version.js`, `index.html` | None remaining — but see note below on why this drifted undetected for multiple sub-stages |

## Manual/Browser Tests Not Independently Re-run in This Session

Being explicit per the "do not mark manual tests PASS unless actually
verified" instruction — the following were verified in **prior EPIC
2E-F sub-stage sessions**, against files that were **not modified** in
this Phase D session, and were not re-executed here:

- Real physical mobile device testing (only a 390px emulated Playwright
  viewport has ever been used, in this and every prior sub-stage).
- Screen-reader software testing (aria-label/aria-live/aria-pressed
  attributes were verified present and correctly valued via DOM
  inspection; actual screen-reader software — e.g. NVDA/VoiceOver — was
  never used).
- A dedicated exhaustive per-stage mutation audit re-run for all 11
  V2 pipeline stages in a single pass (each stage's own original QA
  session performed this for that stage individually; not re-run
  collectively here since none of those 9 untouched stage files changed
  in this session).

These are marked **NOT INDEPENDENTLY RE-VERIFIED**, not FAIL — the
underlying functionality was tested when the relevant code was written
and has not been modified since.

## Root Cause Note: The Stale-Version Bug (Test 15)

This is the one genuine defect found during this release audit, and is
worth documenting honestly rather than glossing over: the static HTML
fallback strings for the version badge are a NECESSARY safety net (if
`core/project-version.js`'s dynamic script ever fails to load, the page
should still show *something* rather than a blank badge) — but that
same safety net means a stale fallback string is invisible in every
normal working session, because the dynamic script always overwrites
it correctly before a person ever sees the page. The bug can only be
caught by direct source inspection (grep) or by deliberately breaking
the module import, neither of which happened during the individual
sub-stage sessions between Phase B and this Phase D release. The
"search for stale versions" discipline that was already documented
(first noted at EPIC 2E-E) needs to be treated as a mandatory
release-audit step, not just a per-stage courtesy — which is exactly
what this Phase D audit did, and exactly how this bug was caught.

## Release Decision

**CONDITIONAL PASS — Safe but manual QA remains.**

Justification against the release-decision criteria:

- No syntax errors exist (Test 1: 68/68 files pass).
- Mapping and XMP did not change unexpectedly (Tests 11, 12, 13: byte-identical XMP, zero production consumers of any V2/Preview/Review object).
- Production Write cannot become true (Test 5: hard-coded, verified against forced-dangerous flags).
- Preview Export cannot become active (Test 5: same hard-coded guarantee).
- Review State does not leak across new images (Test 9: verified this session).
- Stale approval does not bypass the current Sandbox (Test 6, sub-test 9: verified this session).
- UI cannot execute injected HTML (verified in the EPIC 2E-F-C-A-F/C-B sessions; renderer/controller code unchanged since).
- All required files are present (verified during ZIP packaging below).

The CONDITIONAL qualifier reflects the explicitly-documented remaining
gaps: no real-device mobile testing, no real screen-reader software
testing, no real-photo regression dataset, and no persisted/automated
browser test suite (all QA in this EPIC was manual, one-time Playwright
scripts). None of these gaps are release-BLOCKING per the stated
criteria, but none of them should be considered fully closed either.
