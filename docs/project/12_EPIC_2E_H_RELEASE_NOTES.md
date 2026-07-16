# 12 — EPIC 2E-H RELEASE NOTES

**AI Workflow v1.1.8 (EPIC 2E-H)** — "Lightroom Mapping V2 — Isolated
Visual Preview Rendering"
Status: Legacy Active · Browser Preview Available · V2 Non-Production · XMP Unchanged

This release closes out EPIC 2E-H: the first actual browser-rendered
preview layer, built on top of EPIC 2E-G's data-level Side-by-Side
comparison. Legacy and Controlled V2 previews now render as real
pixels on screen — approximate, non-production, and fully isolated
from Production Mapping and XMP.

## Render Plan (Core)

- **Legacy/V2 capability modeling** — data-only, never reads canvas
  pixels, allocates ImageData, or invokes the pixel renderer.
- **Normalized adjustment model** (-1..1) derived from the real,
  verified Legacy clamp ranges — never guessed scales.
- **Supported/unsupported separation** — Color Grading is supported
  only for a genuinely non-zero shadow or highlight saturation value;
  Hue-only and Midtone-only grading are honestly unsupported (the
  renderer never applies them), preserved in the model but excluded
  from `supportedAdjustments`.
- **Non-production V2 evidence** — `exportEligible`/`appliedToProduction`
  always hard-coded `false` on the plan's own guarantee, with the real
  upstream evidence preserved separately and tri-state (never silently
  discarded even when anomalous).
- **Conservative constraints** — `maxInputWidth`/`maxInputHeight`
  2048px, `maxPixelCount` 2048×2048, `maxDevicePixelRatio` 2,
  `allowProductionWrite`/`allowExport` always `false`.
- **Rollback/fallback metadata** — every plan carries
  `restoreSource:"legacy"` and `useLegacyMapping:true`.
- **Malformed-data fallback** — a safe, non-null fallback object
  matching the module's own contract shape is used if the primary
  builder throws, and again if even the empty-input fallback throws.

## Renderer (UI)

- **Canvas 2D pixel processing** — exposure, highlights/shadows,
  whites/blacks, contrast, limited tone-curve approximation,
  temperature/tint approximation, saturation/vibrance approximation,
  clarity/dehaze approximation, limited shadow/highlight saturation
  grading.
- **Alpha preservation** — captured before any RGB transform, restored
  exactly afterward.
- **Uint8ClampedArray channel safety** — every write clamped; no raw
  unbounded values ever reach pixel data.
- **Bounded preview dimensions** — DPR-aware `maxPixelCount`
  enforcement (verified: 2048×2048 CSS at DPR 2 correctly stays at
  2048×2048 backing pixels, never 4096×4096).
- **HTML image decode readiness** — `await image.decode()` before
  reading dimensions or drawing, with rejection handling.
- **Chunked main-thread processing** — ~100,000-pixel chunks, yielding
  to the event loop and re-checking cancellation after every chunk
  (verified: cancellation reliably lands mid-stage on a real
  4096×4096 render).
- **Stale-generation protection at two levels** — each renderer's own
  internal generation counter, plus the UI controller's own session
  counter layered on top.
- **Dispose lifecycle** — `disposeIsolatedVisualPreviewRendererV2`
  aborts in-flight work and releases references.
- **Staged best-effort commit** — the fully-processed output is built
  in a detached staging canvas first; only a short final
  resize-and-draw touches the caller's real target canvas.
  Pixel-content restoration after a commit failure is honestly
  unsupported (`pixelContentRestorationSupported: false`) — only
  dimensions are restored, never silently claimed otherwise.
- **Resource cleanup** — temporary canvases/ImageData dereferenced in
  `finally` blocks on every path (success, failure, cancellation,
  disposal).

## Integration

- **Pipeline stage #13** — `finalStyleIntent.visualPreviewRenderPlanV2`,
  built immediately after stage #12 (Side-by-Side Comparison), for the
  same structural reason: both need the real Legacy Mapping output
  (`mapped`), which doesn't exist inside `_buildDecision()`.
- **Canonical, single object per run** — mutually-exclusive try/catch
  branches guarantee exactly one.
- **Immutable attachment** — `decision.finalStyleIntent = {...decision.finalStyleIntent, visualPreviewRenderPlanV2}`
  (fixed a real bug: an earlier version mutated the object directly).
- **Non-null canonical fallback** — a final local safe object is used
  if both the primary and empty-input builder calls throw; the
  canonical path can never resolve to `null`.
- **Decision Report projection** — tri-state capability
  (`legacyRenderable`/`v2Renderable`/`bothRenderable`, `null` when
  unknown, never coerced to `false`), canonical V2 evidence exposed
  separately from Phase B's own architectural `integrationGuarantees`
  (always `false`), evidence-driven photographer wording (a `"v2"`
  production-source value is treated as a **critical anomaly**, never
  described the same as merely "unavailable").
- **Reference Transfer preservation** — bounded, tri-state, primitive-only
  projection; a hand-crafted upstream object containing a function was
  verified to have the function correctly dropped.
- **Hostile-getter safety** — a shared `safeGet()`/`safeGetDR`/`safeGetRT`
  single-read contract is used throughout both Decision Report and
  Reference Transfer; verified against always-throwing and
  throw-on-second-read getters at every field.

## UI

- **Two isolated target canvases** —
  `legacyVisualPreviewCanvasV2` / `controlledV2VisualPreviewCanvasV2`,
  never reused for anything else, persisting across re-renders via a
  skeleton/metadata separation pattern (the canvas elements are built
  once and never recreated).
- **Sequential rendering** — Legacy first, released, then V2 — never
  two large staging buffers held simultaneously.
- **Real render cancellation** — `clear()` disposes and recreates both
  underlying isolated renderers (fixed a real bug: an earlier version
  only incremented a session counter, letting an old render's pixels
  commit to the canvas *after* `clear()` had already run — reproduced
  and re-verified fixed live).
- **Preparing → Rendering → outcome states** — a genuine "Preparing"
  state (distinct wording from the sequential-render "preparing")
  shows immediately when a new analysis starts, before the Render Plan
  even exists.
- **Source/canvas validation** — honest type/dimension/canvas-target
  checks with specific blockers (unsupported type, zero dimensions,
  missing canvas) — the isolated renderer is never invoked with an
  invalid target.
- **Evidence-driven safety strip** — Production Mapping / Preview
  Export / Production Write each shown as confirmed / anomaly / not
  confirmed, never inferring "safe" from missing evidence; the Legacy
  panel's "production-source" badge appears only when evidence
  explicitly confirms it.
- **Read-only throughout** — zero Apply/Export/Download/Activate/Slider/
  Zoom/Pan/persistence controls anywhere (grep- and DOM-confirmed: 0
  `<button>` elements in the entire section).
- **Failure isolation** — a malformed canonical getter, unsupported
  source, or any Preview UI error affects only the Visual Preview
  section; the main analysis result, Review Console, and Data
  Comparison remain fully visible and unaffected.

## UX Polish (this phase)

- Added explicit overall-outcome sentences: "Both approximate browser
  previews are available." / "Partial preview: only one side rendered
  successfully." / cancellation and failure wording per spec.
- Added a memory-downscale notice ("Preview resolution was reduced for
  memory safety.") when either side's render was downscaled.
- Added an always-visible (not collapsed-only) technical limitations
  list: RAW development, camera profiles, local masks, full ICC
  proofing, sharpening/noise reduction, partial Color Grading support,
  and unsupported Midtone/Hue rendering.

## Safety Confirmation

- Legacy remains the selected production source in every tested
  scenario, including full Human Review approval and both previews
  rendering successfully.
- No Preview Export, no Production Write — verified tri-state, never a
  false "confirmed enabled" claim.
- No Mapping V2 activation anywhere in this codebase.
- No input/source mutation — verified via before/after snapshot
  comparison at every integration boundary, including the pixel-level
  renderer (byte-identical source pixels after every render).
- No local persistence — zero `localStorage`/`sessionStorage`/
  `indexedDB`/cookie usage anywhere in the new Render Plan or UI files.
- No backend or API dependency — fully client-side, unchanged.
- XMP output confirmed byte-identical (length 2962) before and after a
  full analysis + both-sides-rendered Visual Preview session.

## Known Limitations

- Browser preview is not Lightroom-accurate; results may differ from
  Lightroom and Adobe Camera Raw.
- No RAW development, camera-profile reproduction, local/AI masks, or
  complete ICC proofing.
- No exact tone-curve, Highlight, or Shadow parity with Lightroom.
- Color Grading support is partial — only shadow/highlight saturation;
  Hue rendering and Midtone grading remain unsupported.
- Sharpening, noise reduction, lens corrections, and geometry
  transforms are not reproduced.
- Rendering remains main-thread only (no Web Workers).
- Large images are downscaled for memory safety.
- Actual rendered-canvas state is UI-local only — never written back
  into `finalStyleIntent`, Side-by-Side Comparison, or Review State.
- No Before/After slider, zoom, pan, or synchronized views exist yet
  (planned for EPIC 2E-I).
- No persistence of any Visual Preview state.
- No automated, persisted full-browser regression suite exists.
- Real physical mobile device testing and real screen-reader software
  testing remain outstanding (only emulated viewports were used).
- Exact XMP semantic regression still requires a dedicated comparison
  tool — byte-length/schema/substring-absence checks were used
  instead, honestly documented as such.
- Preview/Review/Comparison approval of any kind never activates V2 in
  any way.

## Release Decision

**CONDITIONAL PASS** — see `14_EPIC_2E_H_QA_REPORT.md` for full
evidence. No release-blocking issues found: no syntax errors, all
imports resolve, Production Mapping and XMP confirmed unchanged,
visual-accuracy claims never appear, no Apply/Export controls exist,
and hostile input cannot crash the main analysis flow (verified with
always-throwing and throw-on-second-read getters at every canonical
field). Manual real-device and real-screen-reader QA remain
recommended before treating this as fully production-hardened.

## Next Recommended EPIC

**EPIC 2E-I — Interactive Before/After Visual Comparison** — add a safe
Before/After slider comparing the two already-rendered Legacy/V2
canvases interactively, with optional synchronized view behavior,
preserving read-only state and keeping Export/Production Write
disabled throughout. Not implemented as part of EPIC 2E-H.
