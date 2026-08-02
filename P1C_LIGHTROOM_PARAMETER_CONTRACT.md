# EPIC 2E-P1C — Lightroom Parameter Contract

Every range below is read directly from the existing, already-shipped
project source — nothing here is invented for P1C. Two independent
range sources exist and are both preserved unmodified:

1. **`SLIDER_RANGES`** (`core/single-image/candidate/candidate-validator.js`)
   — the real DOM `min`/`max` attributes each slider has always used
   (audited against `index.html` and `ui/ui-engine.js`'s
   `renderHSLPanel`/`renderGradingPanel`/`renderCalibrationPanel`). Used
   to clamp a manual slider edit — a manual edit can never exceed what
   the slider's own `min`/`max` already allowed before P1C.
2. **`HARD_LIMITS`** — re-exported **unmodified** from
   `core/xmp-validator/index.js`. This is the same, tighter "modest
   range" safety ceiling `quickSafetyClamp()`/`validateFinalPreset()`
   already enforce at export time. `candidate-validator.js` reuses it
   only to raise **warnings** on a built Candidate — it never clamps a
   value itself (no formula tuning happens in P1C; `quickSafetyClamp()`
   remains the one authoritative clamp, run again unmodified at export
   time).

## `SLIDER_RANGES` (real DOM ranges — used for manual-edit clamping)

| Key | Range | Lightroom parameter(s) |
|---|---|---|
| `exp` | [-200, 200] | Exposure (stored as ×100, e.g. +0.25 EV → 25) |
| `con` | [-100, 100] | Contrast |
| `hi` | [-100, 100] | Highlights |
| `sh` | [-100, 100] | Shadows |
| `wh` | [-100, 100] | Whites |
| `bl` | [-100, 100] | Blacks |
| `temp` | [-100, 100] | White Balance Temperature |
| `tint` | [-100, 100] | White Balance Tint |
| `vib` | [-100, 100] | Vibrance |
| `sat` | [-100, 100] | Saturation |
| `sharp` | [0, 150] | Sharpening |
| `noise` | [0, 100] | Noise Reduction (luminance) |
| `clarity` | [-100, 100] | Clarity |
| `dehaze` | [-100, 100] | Dehaze |
| `texture` | [-100, 100] | Texture |
| `hsl_h` | [-100, 100] | HSL Hue, all 8 channels |
| `hsl_s` | [-100, 100] | HSL Saturation, all 8 channels |
| `hsl_l` | [-100, 100] | HSL Luminance, all 8 channels |
| `grd_h` | [0, 360] | Color Grading Hue, all 3 zones |
| `grd_s` | [0, 100] | Color Grading Saturation, all 3 zones |
| `grd_l` | [-100, 100] | Color Grading Luminance, all 3 zones |
| `grd_blend` | [0, 100] | Color Grading Blending |
| `cal_h` | [-100, 100] | Camera Calibration Primary Hue (R/G/B) |
| `cal_s` | [-100, 100] | Camera Calibration Primary Saturation (R/G/B) |

Tone Curve parametric points (`crv_hi`/`crv_mid`/`crv_sh`) have no
`SLIDER_RANGES` entry in the current pipeline (no dedicated slider
range constant existed for them pre-P1C either) — they are passed
through and rely on the existing serializer/curve-editor's own bounds,
unchanged by P1C.

## `HARD_LIMITS` (re-exported from `core/xmp-validator/index.js`, unmodified)

Not duplicated here — this file intentionally does not re-list
`HARD_LIMITS`'s numeric values, to avoid ever letting a P1C document
drift out of sync with the one real, authoritative copy. Read
`core/xmp-validator/index.js`'s `HARD_LIMITS` export directly; P1C's
`candidate-validator.js` imports and re-exports it verbatim (verified
by static test 26 in `qa/epic-2e-p1c-candidate-test.mjs`, which asserts
identity, not a re-derived copy).

## Parameter → range-key mapping

See `P1C_SLIDER_MAPPING.md` for the exact slider-ID → Candidate
parameter-path → range-key table (`buildSliderParameterMap()` output).
