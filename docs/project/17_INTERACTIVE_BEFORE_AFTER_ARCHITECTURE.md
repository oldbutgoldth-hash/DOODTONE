# 17 — Interactive Before/After: Architecture

## 1. Purpose

A read-only, browser-side split-comparison viewer for the two already-
rendered approximate browser previews (Legacy and Controlled V2) produced
by the existing Visual Preview Comparison feature. It exists purely to let
a person visually compare the two previews with a draggable divider; it
has no production write path of any kind.

## 2. Module Map

| File | Role |
|---|---|
| `ui/interactive-before-after-controller-v2.js` | State machine, pixel-copy, pointer/keyboard/RAF lifecycle, alignment computation, safety-anomaly evaluation. Exports `createInteractiveBeforeAfterControllerV2()` and the pure helper `deriveInteractiveBeforeAfterStateV2()`. |
| `ui/interactive-before-after-renderer-v2.js` | Pure DOM builder/updater. Exports `ensureInteractiveBeforeAfterLayout`, `renderInteractiveBeforeAfterStatus`, `clearInteractiveBeforeAfterDisplay`. No state of its own. |
| `ui/app.js` (`_syncInteractiveBeforeAfter`) | Integration glue: normalizes the Visual Preview Comparison result into a compact, safe input and calls either `updateSources()` (when both sides are ready) or `prepareState()` (otherwise). |

## 3. Data Flow

```
Analysis
  ↓
Visual Preview Render Plan V2
  ↓
Legacy Preview Canvas
Controlled V2 Preview Canvas
  ↓
Visual Preview Comparison Result
  ↓
Compact normalized UI evidence   (ui/app.js: safe single-read projection)
  ↓
Interactive Before/After Controller
  ↓
One-time Display Canvas Copy    (only when a NEW generation binds)
  ↓
CSS Clip Split Viewer            (all subsequent split movement is CSS-only)
```

## 4. Visual Preview Source Ownership

Visual Preview Comparison owns: actual Legacy/V2 render completion state,
renderer warnings/failures, render performance metadata, and the current
analysis generation ID. The Interactive controller never re-derives or
second-guesses these — it reads them once, through safe getters, into a
compact shape.

## 5. Interactive Controller Ownership

Owns only: `splitPercent`, display-canvas readiness/availability,
alignment computation and result, safety-evidence-derived blocking,
pointer/RAF/generation lifecycle, and the UI-local warning/blocker list.
It never writes into `finalStyleIntent` or any core analysis object.

## 6. Interactive Renderer Ownership

Pure function of the state object it's given: builds/updates the DOM
(badges, status line, alignment info, technical details) and never reads
from or writes to the controller directly — all communication is via the
`state` object passed into `renderInteractiveBeforeAfterStatus()`.

## 7. Source Canvas Immutability

The Legacy/Controlled-V2 *source* preview canvases (owned by Visual
Preview Comparison) are only ever read via `drawImage()`; the Interactive
controller never sets their dimensions, never calls `getContext` on them
for writing, and never mutates their pixels. Verified live: pixel sampling
before/after a bind shows the source canvas unchanged.

## 8. One-Time Display Copy

`updateSources()` copies each source canvas into its own display canvas
exactly once, only when a new (non-stale) generation is bound. Slider
movement afterward never re-copies pixels.

## 9. CSS-Only Split Movement

`setSplit()` only ever touches: `overlayWrapper.style.clipPath`, a
`--comparison-split` custom property, the divider/handle's `left` style,
and `aria-valuenow`. No canvas API is touched.

## 10. Split Semantics

`clip-path: inset(0 0 0 <split>%)` on the Controlled-V2 overlay layer,
which sits on top of the Legacy base layer. At 0% nothing is clipped (V2
fills the viewport); at 100% everything is clipped (Legacy fills the
viewport). Verified with real screenshots at 0/50/100%.

## 11. Alignment Validation

`_computeAlignment()` computes both sources' aspect ratios and their
relative difference; `sameAspectRatio` requires the difference to be
within `ASPECT_RATIO_TOLERANCE` (0.1%, tightened from an initial 2%
during development — ordinary integer-rounding differences on
reasonably-sized images still pass; materially different geometry does
not).

## 12. Display Normalization

When both sources pass alignment but have different pixel dimensions, a
single bounded common display size is chosen (Legacy's aspect ratio
preserved, width bounded by the smaller source's width — never upscaling
either side), and both display canvases are set to that identical size
before copying.

## 13. Generation Safety

Every `updateSources()` call checks the proposed generation against the
live `generationProvider()` at five distinct points (before any copy,
after dimension validation, after the Legacy copy, after the V2 copy,
immediately before declaring ready) — a stale generation at any of these
points aborts with a `cancelled` result and clears both display canvases.

## 14. Pointer Lifecycle

Pointer capture is acquired on the handle's `pointerdown` and released via
a single shared `_releaseActivePointerCapture()` helper used identically
by `pointerup`/`pointercancel`/`lostpointercapture`/`clear()`/`dispose()`/
a mid-drag rebind — none of these depend on receiving an Event object.
`stopPropagation()` on the handle prevents the viewport's own listener
from double-processing the same press.

## 15. RAF Lifecycle

At most one `requestAnimationFrame` is ever pending (`pendingRafId`
guard); `cancelAnimationFrame` is genuinely called (not merely a boolean
flag) on clear/dispose/rebind, verified live: starting a drag and
immediately rebinding new sources before the frame fires never lets the
old frame affect the new pair.

## 16. Keyboard/Range Accessibility

The visible divider handle is a native-pattern `role="slider"` element
(`tabindex="0"`) synchronized with a real `<input type="range">`; both are
independently fully keyboard-operable. No custom key handling overrides
native range behavior (Arrow/Home/End/Page Up/Down all work natively). A
`:focus-visible` outline was added for both controls.

## 17. State Priority

A single exported pure function, `deriveInteractiveBeforeAfterStateV2()`,
is the sole priority ruleset, used both by the controller internally
(after a real pixel bind, with real alignment data) and by `ui/app.js`
(before any bind, for Partial/Failed/Blocked/Preparing/Unavailable) via
`controller.prepareState()`. Priority: disposed → stale/cancelled → safety
anomaly → ready → partial → failed → blocked (with an explicit
`blockedReason`: `"safety"` / `"alignment"` / `"preview-state"`) →
preparing → unavailable.

## 18. Safety Evidence

Reads `selectedProductionSource`, `allowExport`, `allowProductionWrite`,
`v2Contradictory` from Visual Preview Comparison's own canonical evidence,
normalized once via a shared `_normalizeSafetyEvidence()` helper. An
anomaly (`selectedProductionSource === "v2"`, either boolean flag `true`,
or `v2Contradictory === true`) blocks interaction outright, even before
any canvas is bound. Missing (not contradictory) evidence only adds a
neutral advisory warning.

## 19. Warning Normalization

All warnings/blockers pass through a shared dedup helper: safe string
extraction (from a string or a `.message`/`.warning`/`.reason`/`.text`
property), a 300-character cap, and a 6-item cap, with duplicates removed.

## 20. Hostile Getter Boundaries

Every untrusted property — on the Visual Preview result, the safety
object, the alignment object, and the renderer's own `state` parameter —
is read exactly once through a `safeGet`-style helper (`try`/`catch`
around a single property access), verified live with throw-always and
throw-on-second-read hostile getters at every one of these boundaries: no
uncaught exception in any case.

## 21. Responsive Containment

Handled entirely in `index.html`'s stylesheet, scoped to the actual
offending elements discovered during EPIC 2E-I-C-F2's QA (a Material
Symbols icon-font fallback-text overflow, and a topbar responsive-
breakpoint gap between 680–900px) — never via a global `overflow-x: hidden`
on `html`/`body`.

## 22. Large-Image Internal Scrolling

`#viewerViewport` (the separate, pre-existing full-resolution image
viewer, not part of the Interactive Before/After viewer itself) uses its
own `overflow: auto` to let a large image be viewed/scrolled at true 1:1
resolution. Verified this remains fully functional after the responsive
fix: a 3000×2000 image's viewer remains internally horizontally
scrollable, and the image is never resized to satisfy any overflow
containment.

## 23. Performance Constraints

No `getImageData`/`drawImage` during drag (instrumented, live-verified: 0
calls across a full slider sweep); no canvas backing-dimension changes
during drag; no image analysis or Pixel Renderer invocation from any
Interactive-viewer code path; no window-resize listener exists anywhere
in either file.

## 24. Security Constraints

Warnings/blockers containing HTML or script-like text render as safely-
escaped plain text (`textContent`, never `innerHTML` with untrusted
input) — live-verified: zero `<script>`/`<img>` elements created, zero JS
dialogs fired, from a warning list containing literal `<script>alert()</script>`
and `<img onerror=...>` strings.

## 25. Production Isolation

`splitPercent`, `interactiveBeforeAfter`, `displayDimensionsNormalized`,
`legacyStatus`, `v2Status` — none of these identifiers appear anywhere
under `core/` (verified via project-wide search). `selectedProductionSource`
remains hard-coded `"legacy"` in the Visual Preview Render Plan.

## 26. Known Limitations

- Compares approximate browser previews only; makes no Lightroom/ACR/
  RAW-development/camera-profile accuracy claim.
- All QA in this EPIC used synthetic (not real photographic) fixtures.
- Real physical device and real screen-reader testing were not performed.

## 27. Future Extension Points

The next EPIC (2E-J, not implemented here) is scoped for an optional,
UI-local-only "Legacy preferred / V2 preferred / No visible difference"
observation capture — explicitly with no production activation, no
Mapping/XMP write, and no automatic model decision. Any future Zoom/Pan
or synchronized-navigation feature would be a separate, later scope
decision, not implied by this architecture.
