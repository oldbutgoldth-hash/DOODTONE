# P1I — Pixel Evidence Pipeline Audit (Part A)

Real source audit of the LUMIXA AI codebase as delivered in the P1H R1
baseline (`LUMIXA_EPIC_2E_P1H_WHITE_BALANCE_INTELLIGENCE_R1.zip`, the
most recent verified project state — see "Source Baseline Deviation"
below). Every claim below is cited against the actual file and line
range read for this audit; nothing here is inferred from documentation
alone.

## Source baseline deviation

The spec names `LUD09F~1.ZIP` as the mandatory baseline. That file is
not present in this session's uploads (verified: `ls uploads/` shows no
file matching `LUD09F*`, only prior-EPIC archives). Per the project's
own "Latest Project File Rule," the most recent verified project state
available is the P1H R1 delivery this same session just produced and
confirmed (723-file SHA-256 manifest, 118/118 P1H tests passing from a
clean extraction). That tree is used as the P1I implementation baseline
and this deviation is logged explicitly, exactly as the equivalent
substitution was logged in P1H's own audit.

## 1. Where decoded RGB pixel data currently exists

Nowhere persistently. Three separate engines each do their own
independent, **transient** canvas draw + `getImageData()` call and
never export or cache the raw buffer:

- `core/image-analysis-core/index.js` `_drawToBuffer(img, maxDim)`
  (lines 262-271) — draws twice (`MAX_DIM=480` main pass,
  `SHARPNESS_DIM=600` quality pass), returns `{data, w, h}` to the
  caller, which either Transfers the buffers into a Worker
  (`_runInWorker`, lines 68-115) or calls `runFromBuffers()`
  (`pixel-math.js`) in-process. The raw `Uint8ClampedArray` is
  discarded after that single pass; only aggregate stats
  (histograms, averages, scores) survive on the returned
  `ImageAnalysisResult`.
- `core/whitebalance-engine/index.js` `_sample(img)` (lines 562-575) —
  draws at `MAX_DIM=320`, strides every 3rd pixel (`STEP=3`), skips
  alpha<128, and returns a plain `pixels: [r,g,b][]` array local to
  that one `_analyze()` call. Never stored on the result object.
- `core/color-cast-detector/index.js` `_detect(img)` (lines 62-71) —
  draws at `MAX_DIM=280`, strides every 3rd pixel, accumulates
  per-zone sums inline and discards the buffer immediately after the
  loop (lines 87-107).

**Consequence for P1I:** there is no existing "pixel evidence" object
to subscribe to. P1I's `wb-pixel-sampler.js` must perform its own
canvas draw (documented in Part B/Performance policy), exactly as
every other pixel-consuming engine in this project already does
independently — this is consistent with, not a deviation from, the
project's existing architecture.

## 2. Pixel format and range

Standard Canvas 2D `ImageData.data`: a `Uint8ClampedArray` in RGBA
order, 4 bytes per pixel, each channel in `[0, 255]`. Confirmed
identically in all three engines above (`ctx.getImageData(0,0,w,h).data`).

## 3. Gamma-encoded sRGB or linearized

**Gamma-encoded (display-referred sRGB), not linearized**, as returned
by the browser's Canvas 2D `getImageData()` by specification. The one
place this project does linearize is entirely local and single-purpose:
`image-analysis-core/pixel-math.js` `_rgbToLabL()` (lines 36-40) applies
the sRGB piecewise gamma decode (`c<=0.04045 ? c/12.92 :
((c+0.055)/1.055)**2.4`) purely to compute one scalar (mean CIE L*) —
the linearized values are never retained or exposed. No shared
linear-RGB or XYZ/Lab pixel buffer exists anywhere in the codebase.

## 4. Current analysis resolution

Three different resolutions, chosen independently per engine, all via
the same `Math.min(1, maxDim / max(naturalWidth, naturalHeight))`
proportional-scale pattern:

| Engine | maxDim | Pixel stride |
|---|---|---|
| `image-analysis-core` (main pass) | 480 | 1 (every pixel) |
| `image-analysis-core` (quality pass) | 600 | 1 |
| `whitebalance-engine` | 320 | 3 |
| `color-cast-detector` | 280 | 3 |

## 5. Downsampling behavior

Identical pattern in all three: compute `scale = min(1, maxDim /
max(naturalWidth, naturalHeight))`, round both dimensions, draw the
full source image into a canvas sized to the scaled-down dimensions
(`ctx.drawImage(img, 0, 0, w, h)`) — the browser's own bilinear/bicubic
resampling performs the actual downscale during that single
`drawImage` call; none of these engines implement their own resampling
filter.

## 6. Alpha handling

- `image-analysis-core/pixel-math.js` `mainPass()`: `if (data[i+3] <
  128) continue;` — skips the pixel entirely (line 65 area).
- `whitebalance-engine/index.js` `_sample()`: `if(data[o+3]<128)
  continue;` (line 571).
- `color-cast-detector/index.js` `_detect()`: `if (a<128) continue;`
  (line 91).

All three use the identical `alpha < 128` half-threshold rejection
rule. P1I's pixel sampler reuses this exact threshold for consistency
(documented in `P1I_WHITE_BALANCE_COLOR_MATH.md`).

## 7. Clipped pixel handling

Inconsistent and estimator-specific, not centralized:

- `whitebalance-engine._whitePatch()`: rejects any channel `>250`
  (near-clip) and luminance `>245` (line 472).
- `whitebalance-engine._filterNeutralCandidates()`: rejects luminance
  `>235` (line 381).
- `image-analysis-core/pixel-math.js`: defines `CLIP_HI=250`/`CLIP_LO=5`
  purely to compute the `clipHiPct`/`clipLoPct` diagnostic stats — does
  NOT reject pixels from any other calculation.
- `color-cast-detector`: no clipping exclusion at all — every non-
  transparent pixel is accumulated into its zone regardless of
  clipping.

P1I's estimators each define and document their own clip-rejection
threshold appropriate to their algorithm (see each model doc) rather
than inventing one shared threshold that would silently change
existing engines' behavior.

## 8. Current skin mask or skin probability access

`core/skin-classifier/index.js` `classifySkin(img)` returns
`{skinPct, coveragePct, confidence, isFaceCandidate, clusterRatio}` —
a **coverage-ratio classifier**: it reports how much of the frame is
skin-toned and how confident that estimate is, but does **not** expose
a retained per-pixel mask or per-pixel skin probability map.
Separately, `whitebalance-engine._skinRefinement()` (lines 412-436)
independently re-derives its own YCbCr-threshold skin-pixel filter
inline from its own already-drawn `pixels` array — this is a second,
duplicate skin-pixel classification, not a reuse of
`skin-classifier`'s result. P1I's Skin Validation V2 reuses the
existing `skin-classifier` coverage/confidence output (per the spec's
explicit "do not build a new face detector" instruction) and does not
introduce a third independent skin-pixel filter.

## 9. Current saturation, luminance and histogram access

`image-analysis-core` computes and returns: `histL/histR/histG/histB`
(256-bucket `Uint32Array` each), `avgSatPct`, `satHistogram` (20-bucket
percentage array), `avgLum`, `avgLabL`, `median`, `blackPoint`,
`whitePoint`, `dynamicRange`/`drStops`. All of these are **aggregate
scalars/histograms over the entire 480px-downsampled frame** — none is
addressable per-region (no "top 5% by luminance, restricted to the
lower-left quadrant" query is possible from this data), which is why a
genuine highlight/shadow-band or neutral-region estimator needs its own
pixel-level pass rather than reading these existing histograms.

## 10. Worker-thread availability

Only `image-analysis-core` uses a real Worker (`worker.js` +
`pixel-math.js`, wired through `_getWorker()`/`_runInWorker()` in
`index.js`, lines 44-115), with a documented 20-second timeout and
`terminate()`-based hard cancellation. `whitebalance-engine` and
`color-cast-detector` both run synchronously on the main thread, merely
wrapped in `setTimeout(fn, 0)` — this yields one macrotask tick before
starting, but the pixel loop itself is still a single uninterruptible
synchronous block once it starts. P1I's estimator pipeline follows the
same synchronous-with-yield pattern as `whitebalance-engine` (its
closest architectural sibling) rather than introducing a second Worker
infrastructure, given the smaller expected pixel-loop cost at P1I's
resolution (see `P1I_PERFORMANCE_AND_SAMPLING_POLICY.md`).

## 11. Existing Gray World, White Patch or Shades of Gray code

**Yes — real, working pixel-level implementations already exist**,
all private (unexported) inside `whitebalance-engine/index.js`:

- `_grayWorld(pixels)` (lines 460-466) — classic channel-mean gray-world.
- `_whitePatch(pixels)` (lines 468-493) — near-white candidate filter +
  mean.
- `_shadesOfGray(pixels)` (lines 495-503) — Minkowski `p=6` norm
  (`SOG_P=6`, line 39).
- `_grayEdge(pixels)` (lines 442-456) — low-saturation "gradient-cue"
  approximation (not a true Sobel-gradient gray-edge, see
  `P1I_GRAY_WORLD_MODEL.md` for the distinction P1I preserves).
- `_skinRefinement(pixels)` (lines 412-436) — skin-zone warmth
  correction.

These already run on real accepted-pixel arrays and are **not
proxies**. What they lack, which is exactly P1I's gap to close:

1. No independent, per-estimator confidence/rejection-reason contract
   — all sources are blended through one shared, fixed-weight formula
   (lines 110-122) before ever reaching evidence.
2. No neutral-region (spatially-aggregated) estimator distinct from
   `_filterNeutralCandidates`'s flat pixel list.
2. No highlight/shadow-band SEPARATE illuminant comparison (only a
   single whole-frame result per source).
3. Confidence for `grayWorld`/`whitePatch`/`shadesOfGray` individually
   is a **fixed constant `0.5`** (`_gainsToEst()`, line 520) — not
   derived from that source's own sample count, spatial coverage, or
   clipping rate.
4. The per-source results ARE already surfaced on the `wb` evidence
   object (`grayWorld`, `whitePatch`, `shadesOfGray` fields, confirmed
   in `_analyze()`'s return statement, lines 213-235) but P1H's
   `wb-evidence-extractor.js` never reads them — it only reads
   `wb.consensus` (confirmed: `extractWBEvidence()` line 46-47 reads
   `wb.consensus.temperature`/`.tint` exclusively).

## 12. Real vs. proxy implementations

| Component | Real or proxy |
|---|---|
| Gray World / White Patch / Shades of Gray (existing) | **Real** pixel computation |
| Gray Edge (existing) | Real, but a low-saturation heuristic, not a true image-gradient gray-edge algorithm (documented limitation, unchanged by P1I) |
| Skin refinement (existing, inside whitebalance-engine) | Real pixel computation, duplicate of skin-classifier's own logic |
| P1H skin-consistency-validator.js | **Proxy** — reads `wbIntent.skinWarmth` (a scalar derived from the engine's internal skin refinement), never touches pixels directly |
| P1H object-bias/mixed-light evidence | **Proxy** — reads `color-cast-detector`'s already-aggregated zone labels, has no independent pixel-level corroboration or estimator-disagreement signal |
| Per-source confidence (existing) | **Proxy** — fixed `0.5` constant, not sample/coverage/clip-derived |

## 13. Performance cost for typical input sizes

`whitebalance-engine` at 320px/stride-3 samples roughly
`(320×240)/9 ≈ 8,500` pixel triplets for a typical 4:3-ish source —
well under `image-analysis-core`'s 480px/stride-1 pass (~115,000
pixels, offloaded to a Worker specifically because of this larger
cost). `color-cast-detector` at 280px/stride-3 is cheaper still
(~6,500 samples). All three currently run as **three separate full
canvas draws + getImageData calls per analysis generation** — no
buffer sharing exists between them today. P1I's own pixel sampler adds
a **fourth** independent draw at a comparable or smaller resolution
(documented budget in `P1I_PERFORMANCE_AND_SAMPLING_POLICY.md`);
sharing a single buffer across all four engines would require touching
`whitebalance-engine`/`color-cast-detector`/`image-analysis-core`
internals, which is out of P1I's strict scope (those files are
explicitly not to be altered — see the P1H precedent of leaving
`whitebalance-engine` untouched).

## 14. Deterministic reproducibility of estimator outputs

Yes. All three existing engines are pure functions of the drawn pixel
buffer — no randomness, no timing-dependent branching, no external
state. Given byte-identical input pixels, `_grayWorld`/`_whitePatch`/
`_shadesOfGray`/`_castFromAcc` etc. always produce byte-identical
output. This determinism is exactly what makes it possible (and is
the design P1I follows) to build **DOM-free synthetic pixel-buffer
test fixtures** — mirroring `image-analysis-core/pixel-math.js`'s own
"pure, DOM-free pixel math extracted... so the exact same algorithm can
run either on the main thread or inside a Worker" pattern (see that
file's own header comment) — so P1I's 88 required automated tests can
call real production estimator functions directly on
`{data, width, height}` buffers without needing a browser or `<img>`
element.

## Summary: what P1I must build vs. reuse

**Reuse, do not duplicate:** the existing alpha<128 rejection
convention, the existing per-engine downsample-scale pattern, the
existing `luminance()`/`rgbToHsl()`/`clamp()` helpers from
`core/color-engine/index.js`, the existing `sliderToKelvin()`/
`kelvinToSlider()` Kelvin conversion (never re-derive, never double-
convert), the existing `skin-classifier` coverage/confidence output,
and the existing `color-cast-detector` per-zone cast labels.

**Build new:** an independent pixel sampler with its own
accept/reject/evidence contract; Gray World / White Patch / Shades of
Gray estimators that produce the REQUIRED stable contract (confidence,
evidence, diagnostics, rejection reasons) rather than the legacy
fixed-0.5-confidence blend; a genuine neutral-REGION (not just
neutral-pixel-list) estimator; a genuine highlight/shadow SEPARATE
illuminant comparison; an ensemble layer that preserves every
individual estimator result and computes real cross-estimator
agreement; and wiring this bundle into P1H's evidence extraction as an
additional, optional, higher-quality evidence source — with P1H
remaining the sole Temperature/Tint decision owner throughout.
