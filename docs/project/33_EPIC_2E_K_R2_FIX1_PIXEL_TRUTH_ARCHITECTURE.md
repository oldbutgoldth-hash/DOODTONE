# 33 — EPIC 2E-K-R2-FIX1 Pixel Truth Architecture

Source of truth: `core/calibration-lab/preview-evidence.js` (pure
classifier) and `core/calibration-lab/pixel-truth-capture.js` (the sole
browser-only orchestrator). If this document and the source code ever
disagree, the source code wins.

## 1. The defect this replaces

Before FIX1, the Calibration Lab's Browser test could report a
"Conditional Pass" for Real Pixel Comparison even when the Controlled V2
side had never genuinely rendered anything. Root cause, found by reading
`ui/visual-preview-comparison-controller-v2.js`'s `render()` in full:
when `v2Eligible` is false, `v2Result` stays `null` and the V2 canvas is
never touched -- it silently keeps its default 300×150 HTML backing
size with zero non-transparent pixels. The old check,
`v2State !== 'rendered' || v2BackingSize > 0`, is an OR: an untouched,
still-default canvas satisfies `v2BackingSize > 0` is false... but the
bug was that in some code paths the check was structured so that ANY
non-`'rendered'` state combined with an unrelated truthy condition could
still pass. The fix is architectural, not a patched condition: every
"did this side genuinely render" check is now a positive AND-chain of
independently-verified proofs, never an OR-shortcut.

## 2. Two-module split (pure vs. browser-only)

**`core/calibration-lab/preview-evidence.js` -- 100% pure, no DOM.**
Fully unit-testable in plain Node. Owns:

- `classifyPreviewTruth(measured)` -- the core classifier. Given a
  `measured` object (already-captured facts about both canvases), walks
  a strict priority order: `sourceAvailable` -> `staleGeneration` ->
  `sourceFingerprintMatch` -> `legacyOk` (via `_sideGenuinelyRendered`)
  -> `v2ClaimsRendered`/`v2Ok` -> `sameSourceGeometry` ->
  `pixelDifferenceDetected`, producing exactly one of the 10
  `previewTruthCode` values (Section 26.12).
- `_sideGenuinelyRendered(side)` (internal) -- the AND-chain itself: a
  side only counts as genuinely rendered if its claimed state is
  `'rendered'` AND its backing canvas size is non-default AND it has a
  non-zero non-transparent pixel count AND its pixel hash is plausible
  AND (if a known blank-canvas-of-this-size hash exists) the hash is
  NOT that blank hash. Any one of these failing means "not rendered" --
  there is no path where a partial/unknown/claims-only state passes.
- `computeVisualDecisionEligibility(measured, previewTruthCode)`,
  `buildPreviewEvidence(...)`, `isDecisionAllowedForEvidence(...)` (the
  Gate -- see doc 26 Section 12), `deriveUiBlockerReasonCode(...)`,
  `createNotRenderedPreviewEvidence()`, `isValidPreviewEvidence(...)`.

**`core/calibration-lab/pixel-truth-capture.js` -- the sole
browser-only orchestrator.** Never reimplements rendering: it reuses
`createVisualPreviewComparisonControllerV2` (the exact same production
function the main app's Visual Preview Comparison feature calls)
against two TEMPORARY canvases created via `_createTempCanvas()` (tries
`OffscreenCanvas`, falls back to a detached
`document.createElement('canvas')`) that are never attached to the
DOM. After `.render()` resolves, `_measureCanvas()` reads real
`getImageData()` pixels from each canvas, counts non-transparent
pixels, and computes a real SHA-256 hash (`sha256Hex()`, Web Crypto --
works identically in Node and browsers) of the pixel buffer plus a
"what would a truly blank canvas of this exact size hash to"
reference (`computeBlankReferenceHash()`), so a canvas that merely
exists but was silently left blank can be distinguished from one that
was genuinely drawn to and happens to be visually uniform.

This split means the entire classification logic (the part most likely
to have a subtle correctness bug) is provable with plain
`node --check` + real assertions, with zero DOM/browser dependency --
while the one genuinely browser-only concern (measuring real canvas
pixels) is isolated to the smallest possible surface.

## 3. What counts as a "real render" (Section 1 of the FIX1 spec)

A side is never treated as successfully rendered merely because a
`<canvas>` element exists. All of the following must independently
hold:

1. `v2State === 'rendered'` (or the equivalent claimed-state field for
   Legacy) -- the claim itself.
2. `canvas.width > 0 && canvas.height > 0` AND the size is not the
   HTML-spec default unrendered backing size (`DEFAULT_BLANK_CANVAS_WIDTH
   = 300`, `DEFAULT_BLANK_CANVAS_HEIGHT = 150`) unless the real source
   geometry is genuinely 300×150.
3. `nonTransparentPixelCount > 0` -- a fully transparent canvas (every
   alpha byte zero) fails even if its backing size is non-default.
4. `renderGenerationId` matches the generation the request was issued
   for -- a stale, superseded render is rejected
   (`V2_STALE_GENERATION`), never silently accepted as current.
5. Source fingerprint matches -- the canvas must be proven to have been
   rendered from the same source image, not a leftover from a previous
   image (`V2_SOURCE_MISMATCH`).
6. Geometry match -- Legacy and Controlled V2 must agree on source
   geometry for a difference/identity verdict to be meaningful
   (`GEOMETRY_MISMATCH` otherwise).
7. A real pixel hash computed from a real `ImageData` buffer -- never a
   hash of a placeholder string, a CSS-filter description, or a
   screenshot of the page chrome.

Failure codes are stable, never prose:
`V2_RENDER_PLAN_UNAVAILABLE, V2_RENDER_FAILED, V2_EMPTY_CANVAS,
V2_STALE_GENERATION, V2_SOURCE_MISMATCH, GEOMETRY_MISMATCH` (plus the
symmetric Legacy-side codes folded into `previewTruthCode`).

## 4. Hostile scenarios this architecture defeats (Section 11)

All of the following are proven, by test, to FAIL (never Conditional
Pass, never silently upgraded to eligible):

- V2 state `'unknown'` with a plausible-looking pixel count.
- An empty, untouched 300×150 default canvas.
- A non-default-size canvas where every alpha byte is zero.
- One side genuinely rendered, the other failed -- decision stays
  disabled, never "best effort" half-eligible.
- A fabricated/blank-canvas pixel hash presented for a non-blank claimed
  render.
- Mismatched fingerprint, mismatched generation, or mismatched geometry
  between the two sides.
- Evidence built from CSS-filter-only or full-page-screenshot capture
  (rejected structurally -- these never pass through
  `pixel-truth-capture.js`'s real `getImageData()` path at all).
- A V1 (pre-FIX1) record with no real evidence -- structurally
  excluded from Readiness math (see doc 26 Section 8 and the Migration
  Guide, doc 32).
- Calling the Controller's `saveCurrentDecision()` directly, bypassing
  the UI entirely, with an ineligible `previewEvidence` -- still
  rejected, because the Gate function is the SAME function the UI
  itself calls, not a UI-only convenience check.

## 5. Never persisted

`previewEvidence` never contains a raw canvas, `Blob`, base64 image
string, object URL, file path, filename, or the original image --
verified structurally (no function in either module ever reads or
forwards such a value) and by the hostile static test suite.
