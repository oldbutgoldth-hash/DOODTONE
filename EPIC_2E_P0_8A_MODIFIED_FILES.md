# EPIC 2E-P0.8A — Modified Files

Baseline: `LUMIXA_EPIC_2E_P0_7_COMPLETE_PROJECT_R6.zip` (this project's own
prior R6 deliverable), per explicit instruction. Confirmed via directory
diff against the extracted R6 seed (excluding `node_modules`, regenerated
`qa/*-results.json` evidence, `qa-screenshots/`, and this round's own new
files).

## Changed

- **`core/curve-engine/index.js`** — added `FLOAT_LUT_RESOLUTION` (1024),
  `buildFloatLUT(pts, resolution)` (returns a `Float32Array`), and
  `sampleFloatLUT(lut, x)` (linear interpolation between neighbouring
  samples). All additive: `LINEAR_CURVE`, `defaultCurve`,
  `defaultCurveSet`, `scenePreset`, `evaluateCurve`, `buildLUT`,
  `serializeCurvePoints`, `parseCurvePoints`, `insertPoint`,
  `removeNearestPoint`, `movePoint` are byte-for-byte untouched and still
  used exactly as before by `core/tone-curve-ai-engine/index.js` and
  `ui/tone-curve-editor.js`/`ui/tone-curve-renderer.js` (the interactive
  curve editor legitimately wants an 8-bit-indexed integer table for
  on-screen point editing — that contract is preserved).

- **`core/color-match/candidate-preview-renderer.js`** — the central
  P0.8A file, rewritten pixel loop inside `applyColorMatchCandidateToImageData`:
  - Removed `channelForHue()` (hard 8-bucket hue lookup). Replaced with a
    precomputed, cached 8×360 Gaussian hue-weight table
    (`getHueWeightTable()`, using the SAME `gaussianHueWeight`/
    `LIGHTROOM_HSL_CENTERS` the analysis-time Gaussian HSL transfer engine
    already uses) — every one of Lightroom's 8 HSL channels now
    contributes to every pixel, weighted continuously by hue distance,
    normalised to sum to 1 per hue-degree.
  - Tone Curve sampling switched from the old
    `curveLuts.master[curveLuts.red[Math.round(clamp8(r))]]` chained
    256-entry integer LUT lookup to `sampleCurve(floatCurves.master,
    sampleCurve(floatCurves.red, clamp(r,0,255)))` — float, 1024-entry,
    linearly interpolated, no hard rounding until the pipeline's single
    final `clamp8()`. The original 256-entry `candidateCurveLut()` is
    kept only for `pointCurveMagnitude`'s pre-existing identity/no-op
    detection, unchanged.
  - Calibration (`preset.cal`) is now actually applied — a smooth blend
    of the 3 RGB-primary hue/saturation shifts weighted by each pixel's
    own continuous, normalised R/G/B share. Previously normalised but
    never read in the pixel loop (a real Candidate-to-Preview fidelity
    gap — see the fidelity report).
  - New continuous (feathered, non-hard-masked) `skinConfidence()`/
    `whiteConfidence()` functions damp — never fully zero — the
    saturation/hue/luminance magnitude of HSL, Grading and Calibration
    for pixels that read as likely skin or likely white/near-neutral
    highlight. Computed from the untouched original pixel, before any
    adjustment.
  - New `MAX_TOTAL_CHROMA_SHIFT` (42) bounded total-chroma-shift safety
    limit: HSL saturation + vibrance/sat + Calibration saturation are
    summed and scaled down together (never independently) if their
    combined magnitude would exceed it.
  - `renderColorMatchCandidateToCanvas`'s `maxWidth` default raised from
    640 to 1600 (`DEFAULT_PREVIEW_MAX_WIDTH`), and the function now
    explicitly sets `imageSmoothingEnabled = true` /
    `imageSmoothingQuality = 'high'` on the downscale draw context.
  - `metrics` return shape, `applyColorMatchCandidateToImageData`'s and
    `renderColorMatchCandidateToCanvas`'s exported signatures, and the
    identity-preset/Kelvin-direction behaviour all unchanged — re-proven
    by the pre-existing `qa/epic-2e-n4-preview-evaluation-static-test.mjs`
    (still 5/5 PASS, unmodified file) and this round's own new test.

- **`ui/reference-color-match-panel.js`**:
  - New `_previewRenderWidthFor(canvas)` — derives the Preview render
    width from the canvas's actual on-screen CSS size (×
    `devicePixelRatio`, bounded to [800, 2400]) instead of a fixed small
    cap.
  - All 3 `renderColorMatchCandidateToCanvas(...)` call sites (initial
    render, cached Intensity rebuild, Deep Analysis refined render) now
    pass `maxWidth: _previewRenderWidthFor(afterCanvas)`.
  - Nothing else in this file changed — R6's Fast/Refined split,
    generation control, evidence caches, and R5's Intensity debounce/
    cached-rebuild path are untouched (re-proven by the full R6/R5
    regression re-run, see the QA Report).

- **`qa/run-static-suites.mjs`** — wired in the 1 new P0.8A static suite.

- **`package.json`** — added `test:p0-8a:static`, `test:p0-8a:browser`
  npm scripts (no other field changed).

## Added

- **`qa/epic-2e-p0-8a-preview-artifact-repair-static-test.mjs`** — 22
  real, Node-executed cases against the actual production
  `core/curve-engine/index.js` and
  `core/color-match/candidate-preview-renderer.js`: float LUT resolution
  and true interpolation (2), hostile absence of the old hard-bucket
  `channelForHue()` (1), Gaussian hue-weight utilities wired in (2), the
  real quantified block-artifact regression proof — 226-unit pre-fix jump
  vs. <20-unit post-fix jump on the same smooth-gradient input (1),
  Calibration now measurably applied (2), skin protection functionally
  active (2), white-clothing protection functionally active (1), bounded
  chroma-shift safety limit (2), render-resolution fixes (4), Fast/
  Refined-from-original-source preservation (1), neutral-preset identity
  regression (1), metrics contract stability (1). **22/22 PASS.**
- **`qa/epic-2e-p0-8a-real-image-artifact-browser-test.mjs`** — real
  Chromium/Playwright suite, parametrized to accept the user's own real
  Reference/Target photograph files (CLI flags, env vars, a dedicated
  P0.8A fixtures dir, or falling back to the R6 fixtures dir since it's
  the same real pair this defect was reported against). Captures a PNG
  screenshot of the rendered Preview at each of the 6 required Intensity
  values (0/25/50/60/75/100) as the delivered Before/After QA images, and
  computes a quantitative block-artifact proxy directly from the real
  rendered canvas pixels (adjacent-pixel jump scan, both axes, hard-edge
  density). Also re-runs the R6 regression checklist (PSM warnings,
  counters, Save After Image, no permanent loading state) against the
  real pair. Fails closed to `REAL_IMAGES_UNAVAILABLE` or
  `BROWSER_BINARY_UNAVAILABLE` rather than fabricating a PASS — see the
  QA Report for this environment's honest, currently-blocked status.

## Never touched

`core/lightroom-mapping-engine/index.js`, `core/xmp-validator/index.js`,
`core/preset-engine/index.js`, `ui/app.js`, `ui/ui-engine.js`,
`core/decision-engine/index.js`,
`core/preview-rendering/visual-preview-render-plan-v2.js`,
`core/lightroom-mapping-engine/mapping-v2-overlay-preview-sandbox.js`,
`index.html` — all 9 confirmed **byte-for-byte identical** to the R6
seed via direct `diff`. Also confirmed unchanged (not part of the
Production Lock list, but explicitly checked given they're R6's own
central deliverables): `core/preview-state-machine.js`,
`core/generation-control.js`, `core/analysis-cache.js`,
`core/image-analysis-core/{index,pixel-math,worker}.js`.

## Regenerated (expected side effect, not a manual edit)

`qa/baselines/lufa42-production-lock-manifest.json` was regenerated via
the existing `qa/baselines/generate-production-lock-manifest.mjs` script
(132 → 132 locked files — same count, since no new `core/`/`ui/` module
files were added this round, only 3 existing ones intentionally
modified), matching the convention this project has followed every round
since EPIC 2E-K-R2.
