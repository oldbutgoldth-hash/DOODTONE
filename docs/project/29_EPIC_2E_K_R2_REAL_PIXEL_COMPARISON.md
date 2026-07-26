# 29 -- EPIC 2E-K-R2 Architecture Addendum: Real Pixel Comparison

This addendum extends `25_EPIC_2E_K_CALIBRATION_LAB_ARCHITECTURE.md` --
read that document first. It covers only what changed in R2
("Controlled V2 Calibration Lab -- Real Pixel Comparison & Browser
Verification Closure"): the before/after view now renders genuinely
different Legacy vs Controlled V2 pixels for images added in the
current runtime session, instead of showing the same source image on
both sides.

## 1. What Changed and Why

R1's Known Limitation stated that building a pixel-differentiated
Controlled V2 preview would require duplicating the production pixel
pipeline outside a real analysis run, risking a subtly-wrong preview.
R2 resolves this without duplicating anything: it directly reuses
`createVisualPreviewComparisonControllerV2` (from
`ui/visual-preview-comparison-controller-v2.js`) and
`renderIsolatedVisualPreviewV2` (from
`ui/isolated-visual-preview-renderer-v2.js`) -- the exact same
functions the main app's own Visual Preview Comparison feature calls --
bound to two Calibration-Lab-owned canvases. No new pixel-processing
logic was written; the risk the R1 limitation was guarding against
(reimplementation drift) does not apply because nothing was
reimplemented.

## 2. Data Flow (extends Architecture doc section 3/4)

`core/calibration-lab/run-comparison-pipeline.js`'s
`runCalibrationComparisonPipeline()` already computed
`finalPreset._decision.finalStyleIntent.visualPreviewRenderPlanV2` for
the bounded numeric snapshot. R2 additionally returns this FULL object
as `renderPlanForPixelPreviewTransientOnly` -- named and commented
explicitly as transient-only, never to be persisted. The Calibration
Lab controller (`ui/calibration-lab/calibration-lab-controller.js`)
caches it, keyed by the newly-created record's `imageId`, alongside the
decoded `<img>` element and `analysisGenerationId`, in a bounded
in-memory cache (never IndexedDB, never export).

## 3. The Bounded Live-Image Cache

`core/calibration-lab/bounded-lru-cache.js` is a new, small, fully pure
module (`createBoundedLruCache(maxSize, { onEvict })`) with zero DOM
dependency -- a generic LRU with capacity eviction, recency-on-access,
and an eviction callback. It is Node-testable in complete isolation
(see `qa/epic-2e-k-r2-real-pixel-comparison-static-test.mjs` Section 1),
following this project's established pure-logic/browser-orchestrator
split.

The controller uses one instance,
`MAX_LIVE_PIXEL_PREVIEW_CACHE_SIZE = 5`, keyed by `imageId`, storing
`{ imgElement, objectUrl, renderPlan, analysisGenerationId }`. The
`onEvict` callback revokes `objectUrl` (when supplied) -- this is the
ONLY place in the Calibration Lab that revokes a live image's object
URL, so ownership of that lifecycle has exactly one location.
`getPixelPreviewInput(imageId)` is the sole read path; it returns
`{ available: false, reasonCode: 'PIXEL_PREVIEW_UNAVAILABLE_NOT_IN_SESSION' }`
for any `imageId` not currently cached -- which is always true for a
session resumed from storage (`openSession()`), a brand-new session
(`startNewSession()`), after `clearAllData()`, after `endSession()`, or
for an image evicted by the LRU bound. This is a deliberate, disclosed
limit: "genuinely bounded, not unlimited" is this project's standing
convention for this feature (see `MAX_STORED_SESSIONS`,
`MAX_IMAGES_PER_SESSION` in the R1 schema), extended here to live
in-memory image handles for the same reason.

## 4. Rendering (extends Architecture doc section 9)

`ui/calibration-lab/calibration-lab-renderer.js`'s
`_renderComparisonView()` now does one of two things per image:

- **Available** (image added this runtime session): creates two fresh
  `<canvas class="cal-compare-canvas">` elements, creates a FRESH
  `createVisualPreviewComparisonControllerV2({ legacyCanvas, v2Canvas })`
  instance (bound to these two canvases only -- never the main app's
  own canvases or controller instance), and calls its `.render({
  source, renderPlan, analysisGenerationId })`. The existing CSS
  `clip-path` slider mechanic (pointer drag + Arrow-key adjustment) now
  clips the two canvases instead of two `<img>` clones -- the
  interaction model is unchanged, only the rendered content is real.
- **Unavailable**: shows the translated
  `pixelPreview.unavailableNotInSession` message, exactly as R1 did
  for every case (now narrowed to only the genuinely-unavailable case).

Because `render()` (the outer Calibration Lab render function) rebuilds
the entire DOM subtree on every call (`root.innerHTML = ''`), the two
canvases are brand new on every re-render -- so the pixel-compare
controller instance bound to the PREVIOUS canvases is explicitly
disposed (`_disposePixelCompareCtrl()`) before a new one is created,
and again on dialog `close()`. This mirrors the existing
dispose-and-recreate pattern the main app's own comparison controller
already uses for its own renderer replacement (see Architecture doc
section 5 / R1's "IPO controller replaced via dispose+recreate"
precedent).

A small status note beneath the slider (`data-cal-role="pixel-preview-status"`)
shows a translated summary once the async `.render()` call resolves,
using only the STABLE state codes the reused controller already returns
(`'rendered' | 'blocked' | 'unavailable' | 'failed' | 'cancelled'` for
each side) -- never the underlying English `reasons`/`warnings` prose
arrays, consistent with the "stable codes only" rule (Architecture doc
section 8 / Schema doc section 2).

## 5. Production Isolation (extends Architecture doc section 12)

- The reused chain (`ui/visual-preview-comparison-controller-v2.js`,
  `ui/isolated-visual-preview-renderer-v2.js`,
  `core/preview-rendering/visual-preview-render-plan-v2.js`) was
  grepped and confirmed to contain no reference to `serializeXMP`,
  `downloadXMP`, or `buildLightroomControlledActivationV2` anywhere
  (see the static test's Section 4 hostile checks) -- reusing it
  introduces no new path to Production Mapping or XMP output.
- `renderPlanForPixelPreviewTransientOnly` has no corresponding field in
  `core/calibration-lab/schema.js`'s `createImageTestRecord()` and is
  never referenced by `core/calibration-lab/export-dataset.js` -- there
  is no schema or export path by which it could reach IndexedDB, JSON,
  or CSV output.
- `getState()` and `getQaSnapshot()` were grepped to confirm neither
  function body references `pixelPreviewCache` -- the live-image cache
  is never exposed through either of the controller's two public
  read-state surfaces.
- No production file was modified: `ui/app.js`,
  `ui/visual-preview-comparison-controller-v2.js`,
  `ui/isolated-visual-preview-renderer-v2.js`, and
  `core/preview-rendering/visual-preview-render-plan-v2.js` are all
  READ (imported/called), never written to, by this round's changes --
  confirmed via the checked-in production-lock manifest (65/65 files
  byte-identical; see the QA report).

## 6. Known Limitations Carried Forward / Updated

- Live pixel preview is scoped to the current runtime session and
  bounded to the 5 most-recently-touched images -- a session resumed
  from storage, or an image pushed out by the LRU bound, honestly shows
  the unavailable message rather than a stale or fabricated preview.
- The actual pixel-level rendering (Canvas, real `<img>` decode) could
  not be exercised in this sandbox (no Chromium) -- see the R2 QA
  report and Release Notes for the Browser Verification Closure
  attempt and its outcome.
