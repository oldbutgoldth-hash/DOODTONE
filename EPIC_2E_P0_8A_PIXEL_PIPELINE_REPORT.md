# EPIC 2E-P0.8A — Preview Pixel-Pipeline Report

Traced directly against the real production source (not from memory or
documentation) as of the R6 baseline, before any P0.8A change.

## The exact path

```
Target original pixels (rcm.targetImg — the decoded HTMLImageElement, full
resolution, never a downscaled proxy)
  → ctx.drawImage(image, 0, 0, width, height)     [core/color-match/candidate-preview-renderer.js:renderColorMatchCandidateToCanvas]
  → ctx.getImageData(0, 0, width, height)          — Uint8ClampedArray, 4 x 8-bit channels
  → applyColorMatchCandidateToImageData(imageData, preset)
       for each pixel:
         White Balance (temp/tint)                 — float math
         Exposure / Contrast                        — float math
         Zone-aware Basic Panel (sh/bl/hi/wh)        — float math
         Tone Curve (per-channel then master)        — ⚠ pre-P0.8A: TWO chained
                                                        256-entry integer LUT
                                                        lookups, each preceded by
                                                        Math.round(clamp8(x))
         HSL (8-channel Lightroom model)              — ⚠ pre-P0.8A: single
                                                        nearest-channel hard
                                                        bucket, zero blending
         Color Grading (3-way, shadow/mid/highlight)  — float math, soft weights
         Calibration (RGB primary hue/sat)            — ⚠ pre-P0.8A: computed,
                                                        normalised, NEVER applied
       clamp8() → Uint8ClampedArray                   — the ONLY correct hard
                                                        quantization point
  → ctx.putImageData(rendered.imageData, 0, 0)
  → <canvas id="rcmAfterCanvas" style="width:100%">   — ⚠ pre-P0.8A: internal
                                                        buffer capped at a fixed
                                                        maxWidth=640, then
                                                        CSS-stretched to fill
                                                        whatever the container's
                                                        actual width is
  → Save After Image (unrelated code path, reads the same canvas's current
    pixel data — not independently re-processed)
```

## Recorded findings, item by item

- **Input bit depth**: 8-bit per channel throughout (`Uint8ClampedArray`
  in, `Uint8ClampedArray` out) — correct and unavoidable for Canvas
  ImageData; the question is only what happens to precision *between* the
  in and out boundaries.
- **Working array type, pre-P0.8A**: `Uint8ClampedArray` for the pixel
  buffer (correct, that's the Canvas contract), but the Tone Curve stage
  additionally read/wrote through `Uint8Array` 256-entry LUTs mid-loop —
  a SEPARATE, avoidable 8-bit quantization boundary in the middle of
  otherwise-float math.
- **Number of processing passes over the same pixel**: one (the loop
  runs once per pixel, applying all stages sequentially in-register — not
  the concern; the concern was intra-stage quantization, not pass count).
- **Rounding locations, pre-P0.8A**: (1) `Math.round(clamp8(r))` before
  each per-channel curve LUT lookup, (2) an implicit second round inside
  `evaluateCurve`'s own `Math.round()` when the 256-entry LUT was built,
  (3) the same again for the master curve LUT lookup, (4) the single,
  correct final `clamp8()` write to the output buffer. Rounding location
  count: **3 avoidable + 1 necessary**, all inside the Tone Curve stage.
- **Clamping locations**: `clamp8()` at the very end (correct); HSL's own
  internal `hslToRgb` does not clamp mid-formula (correct — clamping
  belongs at output only).
- **Float/uint8 conversions, pre-P0.8A**: WB → Exposure/Contrast → Zone
  Lift stay in float (JS numbers are always double-precision; no issue).
  The Tone Curve stage converted to a *rounded* 8-bit integer twice
  before HSL/Grading/Calibration ever ran — the exact defect fixed in
  P0.8A (see the curve-engine additions and the renderer's
  `sampleCurve()`/`floatCurves` usage).
- **Resize operations**: exactly one, in `renderColorMatchCandidateToCanvas`'s
  `ctx.drawImage(image, 0, 0, width, height)` — a single browser-native
  downscale from the original decoded image to the internal render
  buffer. `imageSmoothingEnabled`/`imageSmoothingQuality` were relying on
  Canvas defaults (already high-quality bilinear/bicubic, never
  nearest-neighbour) — P0.8A makes this explicit rather than implicit so
  the contract cannot silently regress.
- **Interpolation mode**: browser default (`imageSmoothingQuality:
  'high'` now set explicitly) for the `drawImage` downscale; Catmull-Rom
  spline for the Tone Curve shape itself (unchanged — the curve's own
  *shape* was never the defect, only how finely/precisely it was sampled).
- **Color-space assumptions**: sRGB throughout, no colour-managed
  conversion — consistent with the rest of this project's Preview
  renderer (a documented, pre-existing approximation of Lightroom's RAW
  pipeline, not something P0.8A's scope covers).
- **Canvas encoding format**: `ImageData`/`putImageData`, no intermediate
  JPEG/PNG re-encode inside the render loop (a re-encode would be a
  separate, much worse quantization source; confirmed absent).

## Where continuous tones became discrete color blocks

Two independent points, both now fixed (full detail and quantified
before/after evidence in the companion Posterization Root-Cause Report):

1. **The HSL stage's hard hue-channel boundary** (`channelForHue()`,
   8 fixed cutoffs, zero blending) — the dominant, spatially-visible
   cause. A pixel's ENTIRE HSL adjustment discontinuously switched
   between two different channels' deltas depending on which side of a
   boundary its hue fell on, with no interpolation across the switch —
   producing a real, visible edge in the rendered image wherever the
   underlying photo's hue crossed that boundary. This is the direct
   mechanism behind "large block-shaped color regions in the green
   background."
2. **The Tone Curve's chained double-integer-LUT quantization**, a
   secondary contributor that compounded whatever the curve stage
   changed before HSL ever ran.

Two further gaps found and closed while tracing this pipeline (not
themselves posterization causes, but real defects against the P0.8A
scope):

3. Calibration (`preset.cal`) was computed and serialized to XMP but
   never applied to a single pixel in the Preview — a Candidate-to-Preview
   fidelity gap (see the fidelity report).
4. The Preview's internal render buffer was capped at a fixed 640px
   width regardless of its actual CSS display size, then CSS-stretched —
   magnifying whatever residual pixel-level artifact existed.
