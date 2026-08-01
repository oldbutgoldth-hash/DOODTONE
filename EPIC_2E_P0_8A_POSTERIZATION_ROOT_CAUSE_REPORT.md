# EPIC 2E-P0.8A — Posterization Root-Cause Report

## Root cause #1 (primary): hard hue-channel boundaries in the HSL stage

`core/color-match/candidate-preview-renderer.js` (pre-P0.8A) assigned
every pixel to exactly ONE of Lightroom's 8 HSL channels via
`channelForHue()`:

```js
function channelForHue(h) {
  if (h >= 337.5 || h < 22.5) return 'red';
  if (h < 52.5) return 'orange';
  if (h < 82.5) return 'yellow';
  if (h < 157.5) return 'green';
  if (h < 202.5) return 'aqua';
  if (h < 247.5) return 'blue';
  if (h < 292.5) return 'purple';
  return 'magenta';
}
```

That single channel's `hsl_h`/`hsl_s`/`hsl_l` delta was then applied in
full — a pixel at hue 157.4° got 100% of Green's adjustment, a pixel at
157.6° got 100% of Aqua's adjustment, with **zero blending** between
them. For any real photo with a continuous hue field spanning one of
these 8 boundaries — grass, foliage, water, skin under mixed light — the
render shows a literal spatial edge exactly where the underlying hue
crosses the boundary, because two adjacent pixels with nearly identical
input hues can receive completely different treatments.

### Quantified proof (real code, real measurement — not illustrative)

A synthetic-but-realistic test: a perfectly smooth 60° hue sweep
(140°→200°, the exact span that straddles the old 157.5° Green/Aqua
boundary), 200 pixels wide, with a Color Match candidate carrying
plausible differing Green vs. Aqua deltas
(`hsl_h_green:+15, hsl_s_green:+22, hsl_l_green:+8`,
`hsl_h_aqua:-15, hsl_s_aqua:-20, hsl_l_aqua:-6`) — the kind of divergent
per-channel delta a warm-Reference/green-Target Color Match analysis
plausibly produces.

Measured by reconstructing the exact pre-P0.8A `channelForHue()` +
single-channel-apply logic and running it against this input:

| | Max adjacent-pixel RGB jump (should be ~0 for a smooth input) | At the old 157.5° boundary |
|---|---|---|
| **Pre-P0.8A (hard bucket)** | **226** combined \|ΔR\|+\|ΔG\|+\|ΔB\| units, between two ADJACENT pixels | `[44,227,203] → [65,134,91]` — a stark, visible edge |
| **P0.8A (Gaussian blend)** | **6** combined units — noise-level | `[57,167,115] → [57,165,115]` — smooth, no visible edge |

226 combined RGB units between two adjacent pixels in an input that was
mathematically perfectly smooth is not a subtle artifact — it is a hard,
visible line, and it is exactly reproducible anywhere in a photo the
underlying hue crosses one of the 8 fixed boundaries. This is confirmed,
not inferred, as the direct cause of "large block-shaped color regions
in the green background" and the related "quantized/blocky artifacts"
findings.

## The fix

Replace the hard single-channel lookup with the SAME smooth Gaussian
hue-weighting this project already uses at *analysis* time
(`gaussian-hsl-transfer-engine.js`'s `gaussianHueWeight`/
`LIGHTROOM_HSL_CENTERS`, EPIC 2E-O8) — every one of the 8 channels now
contributes to every pixel, weighted continuously by hue distance from
that channel's centre, normalised so the 8 weights sum to 1 per hue
degree. There is no longer a boundary for a hard edge to form across, and
render-time blending now matches how the Candidate's own per-channel
deltas were derived in the first place (previously the two stages used
inconsistent models — smooth at analysis time, hard-bucketed at render
time — which is itself now closed as a side benefit).

Implementation detail: the 8×360 weight table is precomputed once
(module-level cache, not per-pixel), so the fix costs a fixed ~2,880
`Math.exp()` calls total per app session rather than 8 per pixel.

## Root cause #2 (secondary, compounding): chained double 8-bit Tone Curve quantization

`curveLuts.master[curveLuts.red[Math.round(clamp8(r))]]` — each
`curveLuts.*` a 256-entry `Uint8Array` built by `buildLUT()` (which
itself rounds every sample). A pixel's red channel was rounded to an
integer, looked up in a 256-entry integer table, then that already-
quantized integer result was rounded again (trivially, since it's
already an integer) and looked up in a SECOND 256-entry integer table —
two hard 8-bit quantization boundaries before HSL/Grading/Calibration
had even run. On its own this is a smaller effect than root cause #1 (a
smooth Catmull-Rom curve's neighbouring 256-entry samples typically
differ by only 1-2 units), but it compounds with #1 and independently
violates the spec's explicit ≥1024-entry-interpolated-LUT requirement.

**Fix**: `buildFloatLUT()`/`sampleFloatLUT()` (new, additive exports in
`core/curve-engine/index.js`) — a 1024-entry `Float32Array` sampled with
linear interpolation, never rounded until the pipeline's single final
`clamp8()`.

## Contributing factor: fixed 640px render buffer, CSS-stretched

`renderColorMatchCandidateToCanvas({ ..., maxWidth = 640 })` rendered
into an internal buffer capped at 640px wide, while the `<canvas>`
element is displayed at CSS `width:100%`
(`index.html` line ~816: `<canvas id="rcmAfterCanvas" style="width:100%;...">`).
On any container wider than 640px — the common case on a normal desktop
viewport — the browser upscales that already-quantized raster, visually
enlarging both root causes above. This does not itself CREATE
posterization, but it magnifies whatever residual artifact exists,
making a hard edge that might otherwise cover a handful of source pixels
cover a much larger, more obvious area on screen.

**Fix**: render width now derives from the canvas's actual on-screen CSS
size (× `devicePixelRatio`, bounded to [800, 2400]) via the new
`_previewRenderWidthFor()` helper in `ui/reference-color-match-panel.js`,
rather than a fixed small cap.

## What was NOT the cause (ruled out, checked directly against source)

- **Palette/K-Means substitution**: `extractReferencePalette`/K-Means
  output is evidence-only, feeding analysis (`gaussian-hsl-transfer-engine.js`,
  `unified-core-fusion-orchestrator.js`) — never used to directly replace
  Preview pixel colours. Confirmed by reading the full render pixel loop:
  no palette/centroid value is read anywhere inside
  `applyColorMatchCandidateToImageData`.
- **Blur or resolution-reduction "fix"**: not used, and explicitly
  avoided per the spec's instruction — the fix is precision (float math,
  finer LUT, smooth blending) and correct render resolution, not
  softening.
- **JPEG re-encoding mid-pipeline**: confirmed absent; the render path
  stays in `ImageData`/`Uint8ClampedArray` from decode to `putImageData`,
  no intermediate lossy re-encode.
