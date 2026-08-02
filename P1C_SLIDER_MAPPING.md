# EPIC 2E-P1C — Candidate ⇄ Slider Mapping

Source of truth: `buildSliderParameterMap()` in
`core/single-image/candidate/candidate-slider-adapter.js` (audited
against every real DOM slider `id` in `index.html` / rendered by
`ui/ui-engine.js`'s `renderHSLPanel`/`renderGradingPanel`/
`renderCalibrationPanel`).

## Candidate → Slider (`renderCandidateToSliders`)

For every entry below, `renderCandidateToSliders(candidate, { setSlider
})` reads `candidate.<path>`, rounds it **only for the slider's display
value** (the stored Candidate value itself is never rounded/mutated),
and calls `setSlider(id, roundedValue)`. A slider with no matching DOM
element present is skipped — it is never an error, and the Candidate
value is never deleted or altered because of it.

## Slider → Candidate (`resolveSliderEdit`)

On a real `input` event from slider `id` with raw value `v`,
`resolveSliderEdit(id, v)` returns `{parameterPath, clampedValue,
wasClamped}` — `clampedValue` is `v` clamped to the listed range key's
`SLIDER_RANGES` bound (see `P1C_LIGHTROOM_PARAMETER_CONTRACT.md`). The
caller (`ui/app.js`'s boot-time listener) then calls
`candidateStore.updateCandidateParameter(sessionId, generationId,
parameterPath, clampedValue)`, which updates **only** that one
parameter, sets status `USER_EDITED`, and bumps `revision`.

## Full table

| Slider ID | Candidate parameter path | Range key |
|---|---|---|
| `exp` | `basic.exposure` | `exp` |
| `con` | `basic.contrast` | `con` |
| `hi` | `basic.highlights` | `hi` |
| `sh` | `basic.shadows` | `sh` |
| `wh` | `basic.whites` | `wh` |
| `bl` | `basic.blacks` | `bl` |
| `temp` | `whiteBalance.temperature` | `temp` |
| `tint` | `whiteBalance.tint` | `tint` |
| `vib` | `basic.vibrance` | `vib` |
| `sat` | `basic.saturation` | `sat` |
| `clarity` | `basic.clarity` | `clarity` |
| `dehaze` | `basic.dehaze` | `dehaze` |
| `texture` | `basic.texture` | `texture` |
| `sharp` | `detail.sharpening` | `sharp` |
| `noise` | `detail.noiseReduction` | `noise` |
| `crv_hi` | `curves.parametric.highlights` | (none — passthrough) |
| `crv_mid` | `curves.parametric.midtones` | (none — passthrough) |
| `crv_sh` | `curves.parametric.shadows` | (none — passthrough) |
| `hsl_h_red` | `hsl.hue.red` | `hsl_h` |
| `hsl_s_red` | `hsl.saturation.red` | `hsl_s` |
| `hsl_l_red` | `hsl.luminance.red` | `hsl_l` |
| `hsl_h_orange` | `hsl.hue.orange` | `hsl_h` |
| `hsl_s_orange` | `hsl.saturation.orange` | `hsl_s` |
| `hsl_l_orange` | `hsl.luminance.orange` | `hsl_l` |
| `hsl_h_yellow` | `hsl.hue.yellow` | `hsl_h` |
| `hsl_s_yellow` | `hsl.saturation.yellow` | `hsl_s` |
| `hsl_l_yellow` | `hsl.luminance.yellow` | `hsl_l` |
| `hsl_h_green` | `hsl.hue.green` | `hsl_h` |
| `hsl_s_green` | `hsl.saturation.green` | `hsl_s` |
| `hsl_l_green` | `hsl.luminance.green` | `hsl_l` |
| `hsl_h_aqua` | `hsl.hue.aqua` | `hsl_h` |
| `hsl_s_aqua` | `hsl.saturation.aqua` | `hsl_s` |
| `hsl_l_aqua` | `hsl.luminance.aqua` | `hsl_l` |
| `hsl_h_blue` | `hsl.hue.blue` | `hsl_h` |
| `hsl_s_blue` | `hsl.saturation.blue` | `hsl_s` |
| `hsl_l_blue` | `hsl.luminance.blue` | `hsl_l` |
| `hsl_h_purple` | `hsl.hue.purple` | `hsl_h` |
| `hsl_s_purple` | `hsl.saturation.purple` | `hsl_s` |
| `hsl_l_purple` | `hsl.luminance.purple` | `hsl_l` |
| `hsl_h_magenta` | `hsl.hue.magenta` | `hsl_h` |
| `hsl_s_magenta` | `hsl.saturation.magenta` | `hsl_s` |
| `hsl_l_magenta` | `hsl.luminance.magenta` | `hsl_l` |
| `grd_sh_h` | `grading.shadows.hue` | `grd_h` |
| `grd_sh_s` | `grading.shadows.saturation` | `grd_s` |
| `grd_sh_l` | `grading.shadows.luminance` | `grd_l` |
| `grd_mid_h` | `grading.midtones.hue` | `grd_h` |
| `grd_mid_s` | `grading.midtones.saturation` | `grd_s` |
| `grd_mid_l` | `grading.midtones.luminance` | `grd_l` |
| `grd_hi_h` | `grading.highlights.hue` | `grd_h` |
| `grd_hi_s` | `grading.highlights.saturation` | `grd_s` |
| `grd_hi_l` | `grading.highlights.luminance` | `grd_l` |
| `grd_blend` | `grading.blending` | `grd_blend` |
| `cal_red_h` | `cal.redPrimaryHue` | `cal_h` |
| `cal_red_s` | `cal.redPrimarySaturation` | `cal_s` |
| `cal_green_h` | `cal.greenPrimaryHue` | `cal_h` |
| `cal_green_s` | `cal.greenPrimarySaturation` | `cal_s` |
| `cal_blue_h` | `cal.bluePrimaryHue` | `cal_h` |
| `cal_blue_s` | `cal.bluePrimarySaturation` | `cal_s` |

## Notes

- Tone Curve parametric sliders (`crv_hi`/`crv_mid`/`crv_sh`) have no
  `SLIDER_RANGES` entry (`(none — passthrough)` above) — this matches
  the pre-P1C pipeline, which never had a dedicated range constant for
  them either; their bounds are enforced by the existing curve editor/
  serializer, unchanged by P1C.
- `grd_blend` (Color Grading Blending) and each `grd_*_h`/`grd_*_s`/
  `grd_*_l` triple map to one of the three `grading` zone objects
  (`shadows`/`midtones`/`highlights`) via the `sh`/`mid`/`hi` DOM-ID
  abbreviation — the same abbreviation the pre-P1C sliders already used.
- `cal_red_h`/`cal_red_s` etc. map to `cal.redPrimaryHue`/
  `cal.redPrimarySaturation` etc. — camelCased canonical names, never a
  parallel `calibrationData` alias.
