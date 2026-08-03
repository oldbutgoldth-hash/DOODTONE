# EPIC 2E-P1F — Basic Value Lineage Audit

Source-verified trace of every Basic Panel parameter from raw image
evidence through to Lightroom, for the single-image Auto-Tune Candidate
pipeline (P1A-P1E). Every claim below cites the real file/line it was
verified against in the P1E R3 baseline (`lumixa_p1e_r3`, version
2.5.2) — nothing here is assumed from memory or from the user's
screenshots.

## Root cause summary (read this first)

Two independent, compounding causes make exported Basic Panel values
almost always near zero:

**Cause 1 — Architecture mismatch (the primary cause).**
`core/basic-panel-engine/index.js` was deliberately rewritten for a
different product mode than the one it is now feeding. Its own header
comment states it plainly: *"PresetForge treats the source image as an
ALREADY-EDITED, intentional look — not a raw capture that needs
correcting."* This is the correct mental model for **Reference Color
Match** (extract an existing reference photo's established style and
transfer it onto a target — in that mode, near-zero Basic values are
exactly right, because Color Grading/HSL/Calibration carry the
transferred look and Basic Panel's only job is technical safety). It is
the **wrong** mental model for the single-image Auto-Tune Candidate
pipeline (P1A-P1E), where there is no reference image — the whole
point is to recommend real tonal corrections for the user's own,
generally uncorrected, photo. The engine's `STYLE_LIMITS` (exposure
±35, contrast -20/+25, highlights -55/+10, shadows -25/+35, whites
-30/+20, blacks -35/+15) are honored faithfully everywhere downstream —
but the functions that produce values within those limits (`_exposure`,
`_contrast`, `_highlights`, `_shadows`, `_whites`, `_blacks`, all in
`core/basic-panel-engine/index.js`) default every slider to exactly `0`
and only move away from `0` for two narrow, deliberately rare triggers:
real histogram clipping (`clipHiPct`/`clipLoPct` > ~1.5%) or a
genuinely broken, near-blank frame. A normal, reasonably-exposed photo
with no clipping — the common case — produces `{value: 0}` for every
one of these six sliders by design (`core/basic-panel-engine/index.js`
lines 178-407, every `reasonKind: 'preserved'` branch).

**Cause 2 — Texture/Clarity/Dehaze are not computed from evidence at
all.** `core/lightroom-mapping-engine/index.js` lines 121-123:
```js
let clarity = isPortrait ? -5 : 0;
let dehaze  = 0;
let texture = isPortrait ? -5 : 0;
```
`dehaze` is a literal hardcoded `0` for every image, always — there is
no code path that ever changes it. `clarity`/`texture` are a hardcoded
`-5` for portraits and `0` for everything else, driven solely by an
`isPortrait` boolean, never by any histogram or haze evidence. Neither
`core/basic-panel-engine` nor any other Core module computes these
three fields from real image statistics today.

**Compounding factor.** `core/lightroom-mapping-engine/index.js`'s
`_mapBasicPanel()` (line 707) applies a further `basicDampen = 0.85`
multiplier on top of whatever `generateBasicPanel()` already returned
— so even the rare non-zero clipping-recovery nudges are shrunk again
before reaching the Candidate.

**What this audit rules out.** Nothing is dropped, silently
overwritten, or diverging between UI and XMP for these fields (see
Q3/Q4/Q10 below) — the pipeline faithfully carries near-zero-by-design
values all the way to Lightroom. The "incomplete" feeling the user
reports is real and correctly diagnosed as a genuine product gap, not a
plumbing bug: this is exactly the P1F objective (build a proper,
evidence-driven Basic Tone Intelligence layer for the single-image
Auto-Tune context, without touching the Reference Color Match engine
these files still legitimately serve).

## Per-parameter lineage table

| Parameter | Evidence source | Core input | Core output (typical) | Candidate raw path | Canonical Candidate path | Slider ID | Slider range (DOM) | Legacy Preset key | Safety clamp range (export) | XMP property | P1D readback path | Lightroom unit |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| exposure | `session.evidence.stats` (histogram-engine: `clipHiPct`,`clipLoPct`,`avgLum`,`drStops`) | `generateBasicPanel(stats)` → `_exposure()` | `0` unless clipping/broken frame | `rawPreset.exp` | `candidate.basic.exposure` | `exp` | `[-200,200]` | `exp` | `[-35,35]` (`HARD_LIMITS.basic.exposure`) | `crs:Exposure2012` = `(exp/100).toFixed(2)` | `PROPERTY_MAP` entry `basic.exposure`, mode `EXPOSURE_EV` | EV (e.g. `+0.35`) |
| contrast | `stats.contrast` (σ) | `_contrast()` | `0` unless σ<38 or σ>68 | `rawPreset.con` | `candidate.basic.contrast` | `con` | `[-100,100]` | `con` | `[-20,25]` | `crs:Contrast2012` | `basic.contrast`, `EXACT_INT` | raw slider int |
| highlights | `stats.clipHiPct`, `zones.highlights` | `_highlights()` | `0` unless clipHiPct>1.5 | `rawPreset.hi` | `candidate.basic.highlights` | `hi` | `[-100,100]` | `hi` | `[-55,10]` | `crs:Highlights2012` | `basic.highlights`, `EXACT_INT` | raw slider int |
| shadows | `stats.clipLoPct`, `zones.shadows` | `_shadows()` | `0` unless clipLoPct>1.5 | `rawPreset.sh` | `candidate.basic.shadows` | `sh` | `[-100,100]` | `sh` | `[-25,35]` | `crs:Shadows2012` | `basic.shadows`, `EXACT_INT` | raw slider int |
| whites | `stats.whitePoint`, `stats.clipHiPct` | `_whites()` | `0` unless clipHiPct>1 | `rawPreset.wh` | `candidate.basic.whites` | `wh` | `[-100,100]` | `wh` | `[-30,20]` | `crs:Whites2012` | `basic.whites`, `EXACT_INT` | raw slider int |
| blacks | `stats.blackPoint`, `stats.clipLoPct`, `toneStyle` | `_blacks()` | `0` (or `-3` if moody-dark reinforce) unless crushed | `rawPreset.bl` | `candidate.basic.blacks` | `bl` | `[-100,100]` | `bl` | `[-35,15]` | `crs:Blacks2012` | `basic.blacks`, `EXACT_INT` | raw slider int |
| texture | none — hardcoded | `mapStyleFingerprintToLightroom()` line 123 | `-5` (portrait) / `0` (else), always | `rawPreset.texture` | `candidate.basic.texture` | `texture` | `[-100,100]` | `texture` | **none** (`clampGroup: null`) | `crs:Texture` | `basic.texture`, `EXACT_INT` | raw slider int |
| clarity | none — hardcoded | same, line 121 | `-5` (portrait) / `0` (else), always | `rawPreset.clarity` | `candidate.basic.clarity` | `clarity` | `[-100,100]` | `clarity` | **none** (`clampGroup: null`) | `crs:Clarity2012` | `basic.clarity`, `EXACT_INT` | raw slider int |
| dehaze | none — hardcoded | same, line 122 | `0`, always, unconditionally | `rawPreset.dehaze` | `candidate.basic.dehaze` | `dehaze` | `[-100,100]` | `dehaze` | **none** (`clampGroup: null`) | `crs:Dehaze` | `basic.dehaze`, `EXACT_INT` | raw slider int |

All 9 `PROPERTY_MAP` entries above already exist in
`core/single-image/xmp-fidelity/xmp-property-map.js` (lines 29-37,
`required: true`) — P1D's Fidelity Gate and P1E R3's
`computeExportParity()` already compare every one of these fields; P1F
does not need to invent a new parity mechanism, only to feed real
values into the existing, already-wired pipeline.

## Answers to the 10 required questions

**1. Why are values often zero?** Two independent causes (see Root
Cause Summary): (a) `basic-panel-engine`'s Style Preservation Mode
deliberately defaults every one of the 6 tone sliders to `0` except for
clipping-recovery/broken-frame edge cases — the correct behavior for
Reference Color Match, the wrong behavior for single-image Auto-Tune;
(b) Texture/Clarity/Dehaze are hardcoded constants in
`lightroom-mapping-engine`, never evidence-driven at all.

**2. Are they genuinely generated as zero?** Yes — confirmed by
reading `_exposure`/`_contrast`/`_highlights`/`_shadows`/`_whites`/
`_blacks` in full (`core/basic-panel-engine/index.js`): every
`reasonKind: 'preserved'` branch explicitly sets `value = 0` before any
clamp is applied. This is not a side-effect of clamping or dropped
data — the function itself returns exactly `0`. Texture/Clarity/Dehaze
are `-5`/`0` literals in `lightroom-mapping-engine/index.js`, never
even reaching a computation.

**3. Are any values dropped by candidate-builder.js?** No.
`buildCandidateFromSession()` (lines 108-118) maps
`rawPreset.exp/con/hi/sh/wh/bl/texture/clarity/dehaze` straight into
`candidate.basic.*` with only a `?? 0` fallback for a missing field —
whatever `rawPreset` contains survives unchanged into the Candidate.

**4. Are any values overwritten by P1E?** No.
`core/single-image/color-intelligence/color-intelligence-engine.js`'s
own docstring (lines 21-24) states: *"Never touches:
candidate.whiteBalance, candidate.basic.exposure/..."* — confirmed by
reading the function body: it only writes `candidate.hsl.*`,
`candidate.grading.*` (excluding `balance`), `candidate.cal.*`
(excluding `shadowTint`), and `candidate.basic.vibrance`/
`candidate.basic.saturation`. All 9 audited fields
(exposure/contrast/highlights/shadows/whites/blacks/texture/clarity/
dehaze) are never written by P1E. Ownership is already clean; P1F must
preserve this boundary, not create it.

**5. Are histogram inputs valid and image-specific?**
Yes. `core/histogram-engine/index.js`'s `analyzeImage()` /`_compute()`
computes a real 256-bin luminance histogram from actual decoded pixel
data (`ctx.getImageData()`), and derives `blackPoint`/`whitePoint`
(0.5/99.5 percentiles), `median`, `drStops` (p1/p99-based dynamic
range), `contrastRatio` (p90/p10 Weber ratio), `clipHiPct`/`clipLoPct`
(real per-pixel clip counts), `avgLum`, `contrast` (σ), `avgSatPct`,
`skinPct`/`category`, and a `confidence` score — all genuinely
per-image, never filename- or UI-state-derived.

**6. Are clipped highlights and blocked shadows detected?** Yes, at
the evidence layer (`clipHiPct`/`clipLoPct`, real per-pixel counts) —
this is exactly the one signal `basic-panel-engine` already acts on.
The gap is that recovery is only two narrow bands
(clip>5%/clip>1.5%) and even then the resulting nudge is dampened
again by `basicDampen=0.85` downstream.

**7. Is exposure compensation distinguished from creative brightness?**
Partially. `basic-panel-engine` intentionally treats any non-clipping
brightness/darkness as an intentional creative choice and leaves
`exposure=0` — this is correct restraint, but it means the engine
currently has no concept of "genuinely too dark to see, but not yet
clipping" (e.g. a slightly underexposed but technically un-clipped
photo). P1F's Exposure Recommendation model (Part B) must add exactly
this middle case, conservatively, using `avgLum`/`drStops`/percentile
evidence.

**8. Does the current engine distinguish low-key, high-key, and
balanced scenes?** Yes, already — `_classifyToneStyle()`
(`core/basic-panel-engine/index.js` lines 174-207) classifies
`airy_bright`, `soft_highlight`, `matte_shadow`, `moody_dark`,
`high_contrast`, `low_contrast`, `balanced` from real zone-mass/σ/
black-point evidence. This existing classifier is a legitimate,
reusable signal; P1F's own `dynamic-range-classifier.js` is a
compatible but broader classification (adds `UNDEREXPOSED`/
`OVEREXPOSED`/`HDR`/`HAZY`/`LOW_CONFIDENCE`) built for the Auto-Tune
use case specifically, not a replacement.

**9. Does the existing safety system suppress meaningful output?**
Not directly via clamping — `quickSafetyClamp()`
(`core/xmp-validator/index.js` line 304) only clamps values that
already exceed `HARD_LIMITS.basic` (±35/±20-25/±55-10/±25-35/±30-20/
±35-15), and P1F's planned output will be designed to stay inside those
same bounds by construction (see Export-Safe Normalization in the
architecture doc), so this clamp will rarely if ever fire for
auto-generated values — same pattern P1E R3 already proved for
color fields. The real suppression is upstream, in
`basic-panel-engine`'s zero-by-design defaults and the `0.85`
dampening multiplier, not in the safety clamp.

**10. Are UI values identical to XMP readback values?** Yes for the
current, near-zero values — there is no divergence bug. `candidate.
basic.*` flows unchanged through `legacy-preset-adapter.js` →
`quickSafetyClamp()` (a no-op when already inside bounds) →
`serializeXMP()` → P1D's `xmp-readback-parser.js` → `candidate-xmp-
comparator.js`, all governed by the single `PROPERTY_MAP` table that
already lists all 9 Basic fields. The "incomplete" feeling is not a
parity bug; it is a real product gap in what value gets generated in
the first place — which is exactly what Part B of this EPIC builds.

## Known structural gap carried forward (not a P1F regression)

`quickSafetyClamp()` has **no clamp group at all** for
`clarity`/`dehaze`/`texture` (`clampGroup: null` in the P1D property
map, confirmed absent from `_clampBasicPanel()`'s `fields` map, which
only lists `exp/con/hi/sh/wh/bl`). This mirrors the same class of gap
P1E R3 documented for Color Grading Hue and Calibration Hue: the final
export-time safety net simply does not cover these fields today. P1F's
own `basic-tone-guardrails.js` must therefore be self-bounding for
these three fields (never relying on `quickSafetyClamp()` to catch an
out-of-range value), exactly as P1E R3's Color Intelligence layer is
self-bounding for the fields its own clamp doesn't cover.
