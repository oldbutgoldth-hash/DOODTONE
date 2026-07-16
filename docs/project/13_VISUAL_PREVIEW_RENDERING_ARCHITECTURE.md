# 13 — VISUAL PREVIEW RENDERING ARCHITECTURE

Architecture reference for EPIC 2E-H's Isolated Visual Preview
Rendering Foundation — the Render Plan Builder, the isolated pixel
renderer, pipeline integration, and the UI controller/renderer pair —
written by inspecting the actual v1.1.8 source.

## Three-Path Diagram

```
1. Production path (unchanged by this entire EPIC):

Image Analysis
  → Decision Engine
  → Legacy Lightroom Mapping (core/lightroom-mapping-engine/index.js)
  → Existing XMP Export

2. Preview planning path (data-only, informational):

Decision Engine
  → Visual Preview Render Plan V2   (finalStyleIntent.visualPreviewRenderPlanV2)
  → Decision Report                  (tri-state capability projection)
  → Reference Transfer               (bounded, tri-state preservation)

3. Actual UI render path (browser-local, never touches core state):

Committed Analysis Result
  → Visual Preview Comparison Controller  (ui/visual-preview-comparison-controller-v2.js)
  → Legacy isolated renderer               (ui/isolated-visual-preview-renderer-v2.js)
  → Controlled V2 isolated renderer        (ui/isolated-visual-preview-renderer-v2.js)
  → Two isolated canvases                  (legacyVisualPreviewCanvasV2 / controlledV2VisualPreviewCanvasV2)
  → UI-local render state                  (never written back to finalStyleIntent)
```

Path 2 and path 3 are structurally independent — path 3 reads path 2's
canonical Render Plan object as *input*, but nothing in path 3 ever
writes back into path 2's object, and nothing in path 2 ever touches a
canvas, ImageData, or the DOM.

## Ownership

| Layer | Owns |
|---|---|
| Render Plan Builder (`core/preview-rendering/visual-preview-render-plan-v2.js`) | capability calculation only — data-only, never renders |
| Decision Engine (`core/decision-engine/index.js`) | pipeline placement, immutable `finalStyleIntent` attachment |
| Decision Report Engine | tri-state projection/presentation only, never rebuilds the plan |
| Reference Transfer Engine | bounded, safe preservation only, never rebuilds the plan |
| UI Controller (`ui/visual-preview-comparison-controller-v2.js`) | lifecycle, cancellation, sequential orchestration |
| Isolated Renderer (`ui/isolated-visual-preview-renderer-v2.js`) | pixel processing only |
| UI Renderer (`ui/visual-preview-comparison-renderer-v2.js`) | DOM presentation only, never calculates anything |

No layer duplicates another's calculation logic — confirmed by
inspection: the UI Controller never re-normalizes Legacy/V2 presets, it
only reads `renderPlan.legacyRenderPlan`/`renderPlan.v2RenderPlan` as
given.

## Boundaries (all verified via grep/code review this phase)

- **No core-to-DOM dependency** — `core/preview-rendering/visual-preview-render-plan-v2.js`
  contains zero `document`/`canvas`/`Image` references.
- **No Canvas in Decision Engine** — confirmed zero Canvas/ImageData/
  ImageBitmap/OffscreenCanvas usage in `core/decision-engine/index.js`.
- **No UI renderer imported into core** — grep-confirmed zero real
  `import` statements referencing `ui/isolated-visual-preview-renderer-v2.js`
  or `ui/visual-preview-comparison-*.js` anywhere under `core/`.
- **No preview values consumed by Mapping** — confirmed
  `visualPreviewRenderPlanV2` is never read by
  `core/lightroom-mapping-engine/index.js`.
- **No preview values consumed by XMP** — confirmed zero references in
  `preset-engine`/`xmp-validator`; live XMP byte-length unchanged
  (2962) across every EPIC 2E-H sub-stage's testing.
- **No source mutation** — verified at the pixel level: source canvas
  pixels confirmed byte-identical before/after every render (the
  renderer only ever writes to the caller-supplied *target* canvas,
  never the source).
- **No core state mutation from UI render completion** — the UI
  Controller's returned state (`{state, legacy, v2, bothRendered,
  visualComparisonAvailable, ...}`) is consumed only by
  `ui/visual-preview-comparison-renderer-v2.js` for display; it is
  never written into `finalStyleIntent`, the Side-by-Side Comparison
  object, or Review State. `sideBySidePreviewComparisonV2.canRenderLegacyPreview`/
  `canRenderV2Preview`/`canCompareVisually` remain untouched by this
  entire EPIC (confirmed — Phase C's UI layer computes its own
  separate local `visualComparisonAvailable`, never writing back to
  the canonical Side-by-Side fields, which describe a structurally
  different concept: actual rendered-image availability as reported by
  the *data-comparison* engine, not this UI layer).
- **No browser resources preserved in Reference Transfer** — the
  bounded projection carries only primitive strings/numbers/booleans/
  tri-state values; no canvas, ImageData, ImageBitmap, or function is
  ever spread into it (verified with a hand-crafted upstream object
  containing a function, which was correctly dropped).

## Render Plan Capability vs. Rendered-Image Completion

This is the single most important conceptual separation in this EPIC,
enforced at every layer:

1. **Data availability** — does `legacyRenderPlan`/`v2RenderPlan` exist
   with `available: true`?
2. **Render-plan capability** — is it `renderable: true` (does it have
   at least one genuinely non-zero, renderer-supported adjustment)?
3. **Actual image-render completion** — did the isolated renderer
   genuinely commit pixels to the target canvas this session?
   (`result.rendered === true`)
4. **Visual comparison availability** — did BOTH sides genuinely
   render this session? (`bothRendered === true`, mirrored exactly by
   `visualComparisonAvailable`)
5. **Production eligibility** — always `false` for V2, always "legacy"
   for the selected production source, regardless of 1-4 above.

Concepts 1-2 live entirely in the canonical, pipeline-integrated
Render Plan object (path 2 above) and are `null`/`false`/`true`
tri-state facts about *capability*. Concepts 3-4 are computed fresh,
UI-locally, every time `controller.render()` actually runs (path 3) —
they are never persisted, never written back to `finalStyleIntent`,
and are lost the moment the page is refreshed or a new analysis
begins. Concept 5 is a hard architectural constant enforced at the
Render Plan Builder, the Renderer, the Decision Report, and the
Reference Transfer layers independently — never derived from 1-4.

## Actual Rendering Path, Step by Step

```
runAnalysis() in ui/app.js:
  1. New analysis generation incremented.
  2. Any in-flight Visual Preview render is cancelled immediately
     (controller.clear() — disposes + recreates both isolated
     renderers, genuinely aborting in-flight pixel work).
  3. An explicit "Preparing" state is shown (distinct wording from the
     later "Rendering" state — see below).
  4. Histogram/Skin/HSL/Decision pipeline runs (unrelated to preview).
  5. buildFinalPreset() returns; finalStyleIntent.visualPreviewRenderPlanV2
     now exists (or a safe non-null fallback).
  6. Analysis result UI commits (unrelated to preview).
  7. A "Rendering" placeholder is shown immediately.
  8. controller.render({ source, renderPlan, analysisGenerationId })
     is called — fire-and-forget, NOT awaited, wrapped in a local
     try/catch (a Visual Preview failure must never fail the whole
     analysis flow).
  9. Inside the controller: Legacy renders first (sequential), then
     (only if the controller's own session is still current) V2
     renders second.
  10. The resolved state is displayed — generation-checked so a stale
      resolution can never overwrite a newer analysis's own display.
```

## Cancellation, Two Levels Deep

- **Renderer-level**: each `createIsolatedVisualPreviewRendererV2()`
  instance owns its own internal generation counter; a newer
  `.render()` call on the SAME instance supersedes an older one.
- **Controller-level**: `createVisualPreviewComparisonControllerV2()`
  owns its own `sessionId`, incremented on every `render()`/`clear()`/
  `dispose()` call. Critically, `clear()` does not merely bump this
  counter — it **disposes and recreates both underlying isolated
  renderer instances**, which is what genuinely aborts any in-flight
  pixel processing. An earlier version of this controller (before the
  EPIC 2E-H-C-F patch) only incremented the session counter without
  touching the renderers themselves, which allowed an old render's
  pixels to physically commit to the canvas *after* `clear()` had
  already run — reproduced live, then fixed and re-verified.

## Sequential Rendering

Legacy and V2 never render concurrently. The controller `await`s the
Legacy render fully (including its commit) before starting V2's. This
is a deliberate mobile-memory safety choice — the pixel renderer's
staged-commit design already means each side briefly holds one
detached staging canvas, and sequential rendering guarantees only one
such buffer ever exists at a time.

## Honesty Enforcement Across Layers

- **Render Plan**: `previewAccuracy: "approximate-browser-preview"` on
  every single object this module returns, no exceptions.
- **Renderer**: every successful render result carries a fixed set of
  honesty warnings (not Lightroom-accurate, RAW development not
  simulated, camera profiles not reproduced, local masks not
  reproduced, color-management differences may remain) — these are
  never optional.
- **UI**: an always-visible (never collapsed-only) technical
  limitations list, plus explicit per-outcome sentences ("Both
  approximate browser previews are available." / "Partial preview:
  only one side rendered successfully.") that describe completion,
  never accuracy.
- **Zero-adjustment honesty**: a rendered side with
  `visualAdjustmentsApplied: false` is never allowed to silently look
  like a successful stylistic change — flagged explicitly at both the
  per-side and overall level.

## Malformed/Hostile Input Resilience

A shared `safeGet()`-style single-read contract (one read through a
try/catch-guarded helper, stored in a local variable, never re-read
from the original property) is used consistently across:

- Decision Report Engine (`safeGetDR`)
- Reference Transfer Engine (`safeGetRT`)
- UI Controller (`safeGet`)

This was itself the subject of a real, self-caught bug during this
EPIC's patch series: an early version of the Decision Report's section
builder had the narration block and the main section object
independently re-read the same untrusted Render Plan object from two
separate code locations — even though each individual read used
`safeGet` correctly, the underlying object was still accessed twice,
which a genuinely hostile "throw on second read" getter would defeat.
Fixed by extracting the entire section-building logic into one
function computed exactly once, with both consumers reading the single
stored result.
