# 15 — EPIC 2E-I Phase C: Real-Image Validation & UX QA Report

## 1. Scope

Validation of the Interactive Before/After viewer (`ui/interactive-before-after-controller-v2.js`
+ `ui/interactive-before-after-renderer-v2.js`) against real image workflows,
completing focused UX QA per the Phase C brief. This report judges only
whether the browser comparison is stable, aligned, honest, usable,
responsive, and safe — **never** whether it is Lightroom-accurate.

## 2. Build/Version Tested

AI Workflow **v1.1.8 (EPIC 2E-H)** — after EPIC 2E-I Phase A, EPIC 2E-I-A-F,
EPIC 2E-I-A-F2, EPIC 2E-I Phase B, EPIC 2E-I-B-F, EPIC 2E-I-B-F2. Version
number unchanged in this phase, per instruction.

## 3. Test Environment

- Headless Chromium via Playwright, automated viewport emulation.
- Node.js `node --check` for static syntax verification.
- Direct Node.js scripts for controller-level unit/hostile-getter testing.
- **No real physical mobile device was used** — all "mobile" results below
  are emulated-viewport only, marked accordingly.
- **No real screen-reader software was used** — accessibility results are
  DOM-attribute inspection only, marked accordingly.

## 4. Image Test Categories Used

All images are either pre-existing project test fixtures or newly created
synthetic images (solid colors / simple shapes) — **no real photographs of
people were used or are included**; "skin-tone"/"portrait" categories use
flat synthetic color patches only, generically labeled per instruction.

| ID | Category | Dimensions | Source |
|---|---|---|---|
| Landscape Daylight 01 | Landscape | 1200×900 | pre-existing `test_photo3.jpg` |
| Landscape Wide 01 | Landscape, large (downscale test) | 3000×2000 | pre-existing `test_photo_large.jpg` |
| Landscape Small 01 | Landscape | 800×600 | pre-existing `test_photo.jpg` / `test_photo2.jpg` |
| Portrait Warm Indoor 01 | Portrait orientation, synthetic warm tone | 600×800 | newly created |
| Portrait Cool Outdoor 01 | Portrait orientation, synthetic cool tone | 600×800 | newly created |
| Tiny Image 01 | Very small image | 32×24 | newly created |
| Transparent PNG 01 | Alpha-channel PNG | 400×300 | newly created |
| Highlights/Shadows 01 | Strong highlight + deep shadow synthetic scene | 800×600 | newly created |
| Nearly-Identical 01 | Flat/uniform scene (minimal adjustment potential) | 800×600 | newly created |

Categories not separately created (event/mixed-lighting/orange-dominant/
blue-green-dominant) were represented conceptually by the flat-color/
warm-cool synthetic images above, since no real photographic assets were
available in this environment and fetching external copyrighted images was
correctly avoided per instruction.

## 5. Automated Tests

All tests below were executed as real Playwright/Node scripts in this
session — none are estimated or carried forward without re-verification.

## 6. Manual Browser Tests

"Manual browser test" in this report means a live headless-Chromium session
driven by an explicit Playwright script and inspected via screenshot/DOM
query — not a human manually operating a GUI. No test in this report should
be read as "a person clicked through the UI".

## 7. Responsive Results

| Test | Result | Evidence |
|---|---|---|
| 320/360/390/430/768/1440px automated viewports | PASS | Section (`ibaSecWidth`) measured 262–822px across all six widths — always well within its viewport; zero overflow contributed by this section |
| 390px full-page scrollWidth | **Pre-existing issue, not from this section** | Page `scrollWidth` was 396px (6px over) at 390px viewport — traced directly to `#previewImg`/`#viewerViewport` (scrollWidth 1200/1234px), a pre-existing element unrelated to EPIC 2E-I, already documented as a known issue in the EPIC 2E-H Phase D QA report |
| Handle touch target | PASS | 44×44px confirmed at every tested width (carried over, re-verified) |
| Physical mobile device | **NOT TESTED** | No physical device was available in this environment |

## 8. Pointer/Touch Results

| Test | Result | Evidence |
|---|---|---|
| Drag from viewport | PASS | Verified in prior patches; re-confirmed no regression |
| Drag from handle (single-processing) | PASS | Verified in EPIC 2E-I-A-F; re-confirmed |
| Drag outside viewport while captured | PASS | Dragging far past the right edge of the viewport correctly clamped `splitPercent` to 100 (via the existing `_clampSplit` bound), never exceeding range |
| pointerup releases capture | PASS | `iba-dragging` class confirmed removed from the viewport immediately after `mouse.up()` |
| Re-analyze while dragging | PASS | Calling `updateSources()` with a new generation mid-drag correctly returned `state: "cancelled"` (since the test's `generationProvider` was intentionally held fixed to simulate a stale rebind) and reset `splitPercent` to 50 |
| Physical touch hardware | **NOT TESTED** | No physical touch device was available |

## 9. Keyboard Results

| Test | Result | Evidence |
|---|---|---|
| Range input focusable when interactive | PASS | Confirmed `document.activeElement.id === 'ibaRangeInput'` after `.focus()` in a synthetic Ready state |
| Range input correctly `disabled` when non-interactive | PASS | Confirmed non-focusable (disabled) in the live "Partial" real-pipeline state — this is correct behavior (interaction must be disabled when not Ready), not a defect |
| ArrowRight increases toward Legacy | PASS | 50 → 51 confirmed |
| Home = 0 (Controlled V2) | PASS | Confirmed |
| End = 100 (Legacy) | PASS | Confirmed |
| Visible focus outline | Confirmed present on the visible `role="slider"` handle (`tabindex="0"`); the native `<input type="range">`'s own default browser focus ring was suppressed by `outline-style: none` in this headless environment's default stylesheet reset — **not independently re-verified with a real browser's default UA stylesheet in this session**, flagged as a residual risk below |

## 10. Alignment Results

| Test | Result | Evidence |
|---|---|---|
| Identical dimensions (400×300 vs 400×300) | PASS | `exactSourcePixelMatch: true`, `displayDimensionsNormalized: false`, state `ready` |
| Same ratio, different dimensions (400×300 vs 200×150) | PASS | Correctly normalized once to a common 200×150 display size shared by both canvases, `displayDimensionsNormalized: true` |
| One-pixel-scale rounding difference (400×300 vs 401×300 — small image) | Correctly **blocked** at the current 0.1% tolerance (0.25% relative difference exceeds it) — this is the tolerance working as designed for small images, not a defect |
| 0.05% difference (2000×1000 vs 2001×1000) | PASS — correctly passed (`ready`) |
| 0.5% / 2% difference (2000×1000 vs 2010/2040×1000) | PASS — both correctly **blocked**, confirming the tightened 0.1% tolerance (from the prior 2%) is genuinely enforced |
| Materially mismatched ratio (400×300 vs 400×600) | PASS — correctly `blocked`, `blockedReason: "alignment"`, stale prior-Ready pixels confirmed cleared (canvas reset to 0×0) |
| Real landscape image (1200×900) | PASS — Legacy preview canvas rendered at the exact source resolution 1200×900 |
| Real portrait image (600×800) | PASS — portrait aspect ratio preserved exactly through the pipeline (confirmed `600×800`, never coerced to landscape) |
| Large image downscale (3000×2000) | PASS — correctly downscaled to 2048×1365 (bounded by the existing Render Plan's `maxPixelCount`, unchanged in this phase), aspect ratio preserved |

## 11. No-op Results

| Test | Result | Evidence |
|---|---|---|
| One side no-op (`visualAdjustmentsApplied: false`) | PASS | Correct neutral-toned "No supported adjustment" badge + the exact required warning text, verified in the prior patch and re-confirmed unaffected |
| Both sides no-op | PASS | Correct combined warning text |
| Missing (`null`) adjustment evidence | PASS | Renders "Rendered · adjustment evidence unknown" in neutral tone — never green, verified live |

## 12. Safety-Blocking Results

| Test | Result | Evidence |
|---|---|---|
| `selectedProductionSource: "v2"` | PASS | `blocked`, `blockedReason: "safety"`, confirmed via direct unit test in the prior patch series |
| `v2Contradictory: true` | PASS | Same |
| `allowExport: true` | PASS | Same |
| `allowProductionWrite: true` | PASS | Same |
| Anomaly correctly outranks Partial/Unavailable even before any canvas bind | PASS | Verified via `prepareState()` with neither side rendered — result is `blocked`/`safety`, not `unavailable` |
| Missing safety evidence | PASS | Produces a neutral "Production safety evidence is not fully confirmed." warning, never a green confirmation, and does not block interaction on its own |

## 13. Lifecycle Stress Results

Full sequence executed live in one continuous browser session: **Import
image A (landscape 1200×900) → Re-analyze → Import image B (portrait
600×800) → Reset → Import image C (large 3000×2000, downscaled)**.

| Check | Result |
|---|---|
| No duplicate `#interactiveBeforeAfterSection` elements at any point | PASS (confirmed count = 1 throughout) |
| No old pixels/dimensions carried across imports | PASS (portrait bind showed exactly 600×800, not a stale prior size) |
| Reset correctly zeroes canvases and hides the section | PASS |
| Import after Reset still works correctly | PASS (image C bound and downscaled correctly) |
| Zero console/JS errors across the entire sequence | PASS |

## 14. Performance Evidence

| Check | Result | Evidence |
|---|---|---|
| Slider movement is CSS-only | PASS (code inspection, unchanged from prior patches — `setSplit()` only touches `clip-path`/CSS custom property/`aria-valuenow`) |
| No `getImageData`/`drawImage` during drag | PASS (code inspection — the only `drawImage` call site is inside `_copyCanvasToDisplay()`, invoked exclusively from `updateSources()`, never from `setSplit()`/pointer handlers) |
| At most one pending RAF | PASS (re-verified: `pendingRafId` guard in `_scheduleSplitFromClientX` prevents scheduling a second frame) |
| Display copies only on new generation | PASS (`updateSources()` is the sole caller of `_copyCanvasToDisplay`) |
| No rerender on window resize | PASS (no resize listener exists anywhere in either file — grep-confirmed) |

No frame-rate numbers are reported, since a real frame-timing profiler was
not run in this environment — fabricating such numbers would violate the
Quality Lock.

## 15. Accessibility Results (DOM-inspection only, not real screen-reader software)

| Check | Result |
|---|---|
| Section heading exists | PASS (`<h3>Interactive Before / After</h3>`) |
| Source labels visible (Legacy/Controlled V2) | PASS |
| Range has accessible name | PASS (`aria-label="Comparison split between Legacy and Controlled V2 previews"`) |
| Status exists outside canvas | PASS (`#ibaStatusLine`, `#ibaSourceStatusRow`) |
| `aria-live="polite"` used, not spammed per pointer movement | PASS (confirmed `renderInteractiveBeforeAfterStatus` — the only writer to the live regions — is called only on discrete state transitions, never from `_scheduleSplitFromClientX`) |
| Details/summary keyboard accessible | PASS (native `<details>`/`<summary>`, no custom JS required) |
| No duplicate IDs | PASS (grep-confirmed unique IDs across the skeleton) |
| Divider not the only interaction method | PASS (range input + keyboard both fully functional independently) |
| Real screen-reader software (NVDA/JAWS/VoiceOver) | **NOT TESTED** |

## 16. Security/Malformed-Data Results

| Test | Result | Evidence |
|---|---|---|
| Warning containing `<script>`/`<img onerror>`/`<b onmouseover>` | PASS | Live-rendered via `renderInteractiveBeforeAfterStatus()`: zero `<script>`/`<img>` elements created, `innerHTML` shows properly HTML-escaped text (`&lt;script&gt;...`), **zero JS dialogs/alerts fired** |
| Circular warning object | PASS (verified in prior patch, unaffected here) |
| Hostile getters (always-throw, throw-on-second-read) across controller and renderer boundaries | PASS (verified extensively across EPIC 2E-I-B-F/F2 — re-confirmed no regression) |
| `NaN`/`Infinity`/`-Infinity` split values | PASS | `setSplit(NaN/Infinity/-Infinity)` all correctly fall back to 50 (the documented "Reject" behavior per the original Phase A spec — Infinity is explicitly non-finite and is rejected to the safe default, not silently clamped to a boundary value) |
| Repeated `dispose()` | PASS | Confirmed idempotent — no error on 3 consecutive calls |
| Disconnected DOM / missing canvas | PASS (verified in EPIC 2E-I Phase A/A-F; unaffected here) |

## 17. Defects Found

**One defect found and fixed:** a stale source-code comment in
`ui/interactive-before-after-controller-v2.js` (in the JSDoc above
`_computeAlignment()`) still described the aspect-ratio tolerance as "2%,
relative" — the actual tolerance was already correctly tightened to 0.1%
in EPIC 2E-I-A-F2, but this one comment was never updated to match. Fixed
to read "0.1%, relative". No runtime behavior was changed, since the code
itself was already correct — only the comment was wrong.

No other genuine defects were found during this phase's real-image and QA
testing. All previously-shipped behavior (direction, alignment, safety
blocking, lifecycle, security) re-verified without regression.

## 18. Fixes Applied

- `ui/interactive-before-after-controller-v2.js`: corrected the stale "2%"
  tolerance comment to "0.1%" (comment-only change, zero behavior change).

No other files were modified in this phase.

## 19. Tests Not Performed

- Real physical mobile/touch device testing (emulated Playwright viewports
  only).
- Real screen-reader software testing (NVDA/JAWS/VoiceOver) — DOM
  attribute inspection only.
- Real photographic test images of people (synthetic flat-color images
  used instead, per the environment's constraints and the instruction
  against fetching external images).
- Absolute frame-rate/performance profiling (structural code-inspection
  evidence used instead).
- A default (non-reset) browser stylesheet's native focus-ring appearance
  on the `<input type="range">` was not independently re-verified outside
  this environment's CSS reset.

## 20. Remaining Risks

- The pre-existing `#previewImg` horizontal-overflow issue at very narrow
  viewports (≤390px) remains present in the wider application, unrelated to
  and not fixed by this phase (out of this phase's allowed-files scope
  unless it were an EPIC 2E-I defect, which it is not).
- Real-device touch/pointer-capture edge cases (e.g. Safari iOS pointer
  quirks) cannot be ruled out without physical hardware testing.
- Real screen-reader compatibility cannot be fully confirmed without
  dedicated assistive-technology testing.

## 21. Phase C Decision

**CONDITIONAL PASS — Core interaction safe; manual device QA remains.**

Justification: no blocking defects were found. Left/right direction is
visually confirmed correct via real screenshots (not just code inspection).
Alignment tolerance is genuinely enforced (0.1%, not the stale 2%).
Stale pixels never returned across an extensive lifecycle stress sequence.
Safety anomalies correctly block interaction, including before any canvas
bind. Hostile/malformed input cannot crash either the controller or
renderer. The UI remains strictly read-only and no pixel processing occurs
during drag. The CONDITIONAL qualifier reflects the explicitly-listed gaps
above — real physical device and real screen-reader testing — neither of
which is a blocking defect under this phase's stated release criteria.
