# EPIC 2E-P0.8A — Candidate-to-Preview Fidelity Report

## Method

Compared, field by field, against the real production source: (a) the
Candidate object built by `buildCoreColorMatchPipeline` (the
`safePreset` field, the single source of truth the spec requires), (b)
what the Preview renderer (`applyColorMatchCandidateToImageData`)
actually reads and applies, and (c) what `candidate-xmp-codec.js`
serializes into the Candidate XMP string and reads back on verification.

## Finding: Calibration was a real, confirmed fidelity gap — now closed

- **Candidate**: `lightroom-candidate-mapper.js`'s `buildCalibration()`
  computes `cal_red_h`, `cal_red_s`, `cal_green_h`, `cal_green_s`,
  `cal_blue_h`, `cal_blue_s` (each bounded, e.g. ±8° hue / ±6% sat) and
  places them on `safePreset.cal`.
- **XMP**: `candidate-xmp-codec.js` (lines ~102-104) serializes all six
  fields into the real Lightroom `RedHue`/`RedSaturation`/`GreenHue`/
  `GreenSaturation`/`BlueHue`/`BlueSaturation` XMP attributes, and reads
  them back identically on `verifyCandidateXmpReadback` (line ~131).
  **Confirmed correct, untouched, not part of this fix.**
- **Preview, pre-P0.8A**: `applyColorMatchCandidateToImageData`
  normalised `preset.cal` into a safe default (`{}` when absent) but
  never read a single `cal_*` field anywhere in its pixel loop. The
  Preview a user looked at did not reflect Calibration at all, while the
  Candidate object and the eventual XMP export both correctly carried it
  — a genuine, reproducible three-way mismatch (Candidate == XMP, but
  Preview != either).

**Fix**: Calibration is now applied as a smooth, continuously-weighted
blend of the three RGB-primary hue/saturation shifts, weighted by each
pixel's own normalised R/G/B share (`r/(r+g+b)` etc. — always continuous,
never a hard "if red dominates" branch, consistent with this round's
broader "no hard boundaries" requirement). Verified with a real,
Node-executed test (`qa/epic-2e-p0-8a-preview-artifact-repair-static-test.mjs`):
an identical red-toned pixel run through the same neutral preset with
only `cal` differing now produces a measurably different rendered output
(`diff=14` combined RGB units) — before this fix, that diff was
structurally always 0 regardless of `cal`'s contents.

## Confirmed unaffected (checked, not assumed)

- **White Balance, Exposure/Contrast, Basic Panel zones, Tone Curve, HSL,
  Grading**: all were already read and applied by the pre-P0.8A renderer
  — no additional fidelity gap found in these groups. Their *precision*
  changed (float LUT, smooth HSL blend), but their *presence* in the
  render was already correct.
- **No hidden Preview-only aggressive adjustment exists**: read the
  entire rewritten pixel loop end-to-end — every adjustment applied
  traces back to a named `preset.*` field that also appears in the
  Candidate object and (where applicable) the XMP serializer. The new
  protection damping (skin/white) and the new total-chroma-shift safety
  limit REDUCE the magnitude of existing Candidate-sourced adjustments
  for specific pixel classes — they never introduce a new adjustment the
  Candidate/XMP doesn't already carry, and they never increase magnitude
  beyond what the Candidate specifies.
- **`hslData`/`toneCurveData`/`colorGradingData`/`calibrationData`**: the
  R6-era Candidate-contract hostile check (no duplicate/shadow field
  names) still passes — re-verified as part of this round's static test
  file, 4/4 cases.

## Lightroom-exactness limitation (documented, not silently patched over)

This Preview renderer remains — as it always has been — a browser-side
*approximation* of Adobe's real RAW processing pipeline (this project's
own header comment on the file has said so since EPIC 2E-N4). P0.8A does
not and cannot make the Preview byte-identical to what Lightroom itself
would render from the same XMP, because:
- Lightroom operates on RAW/DNG linear sensor data with a colour-managed
  working space; this renderer operates on already-demosaiced,
  gamma-encoded sRGB JPEG/PNG pixels via the browser's Canvas API.
- Lightroom's actual per-module processing order, tone-mapping curves,
  and highlight-recovery algorithms are not public.

P0.8A's fixes (float precision, smooth HSL blending, real Calibration
application, protection, resolution) make the Preview a strictly more
faithful and more artifact-free representation of the SAME Candidate
values than before — they do not, and are not claimed to, close the
inherent gap between "a browser Canvas approximation" and "Lightroom's
actual RAW pipeline." No extra undocumented contrast or saturation was
introduced to compensate for this gap, consistent with the spec's
explicit instruction.
