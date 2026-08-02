# P1D — XMP Property Map

Source: `core/single-image/xmp-fidelity/xmp-property-map.js`, built
strictly from `P1D_XMP_SERIALIZATION_AUDIT.md`. 58 scalar entries + 4
Tone Curve entries + 23 documented-unsupported entries = 85 total
comparisons per full export.

## Scalar properties (58)

| Candidate path | Legacy preset key | XMP property | Type | Tolerance | Transform |
|---|---|---|---|---|---|
| basic.exposure | exp | crs:Exposure2012 | EXPOSURE_EV | ±1 (slider units) | `(v/100).toFixed(2)` |
| basic.contrast | con | crs:Contrast2012 | EXACT_INT | 0 | none |
| basic.highlights | hi | crs:Highlights2012 | EXACT_INT | 0 | none |
| basic.shadows | sh | crs:Shadows2012 | EXACT_INT | 0 | none |
| basic.whites | wh | crs:Whites2012 | EXACT_INT | 0 | none |
| basic.blacks | bl | crs:Blacks2012 | EXACT_INT | 0 | none |
| basic.clarity | clarity | crs:Clarity2012 | EXACT_INT | 0 | none |
| basic.dehaze | dehaze | crs:Dehaze | EXACT_INT | 0 | none |
| basic.texture | texture | crs:Texture | EXACT_INT | 0 | none |
| curves.parametric.shadows | crv_sh | crs:ParametricShadows | EXACT_INT | 0 | none |
| curves.parametric.midtones | crv_mid | crs:ParametricMidtones | EXACT_INT | 0 | none |
| curves.parametric.highlights | crv_hi | crs:ParametricHighlights | EXACT_INT | 0 | none |
| detail.sharpening | sharp | crs:Sharpness | EXACT_INT | 0 | none |
| detail.noiseReduction | noise | crs:LuminanceSmoothing | EXACT_INT | 0 | none |
| whiteBalance.temperature | temp | crs:Temperature | TEMPERATURE_KELVIN | 0 | `sliderToKelvin(v)` |
| whiteBalance.tint | tint | crs:Tint | EXACT_INT | 0 | none |
| basic.vibrance | vib | crs:Vibrance | EXACT_INT | 0 | none |
| basic.saturation | sat | crs:Saturation | EXACT_INT | 0 | none |
| grading.{shadows,midtones,highlights}.{hue,saturation,luminance} (9) | grade.grd_{sh,mid,hi}_{h,s,l} | crs:ColorGrade{Shadow,Midtone,Highlight}{Hue,Sat,Lum} | EXACT_INT | 0 | none |
| grading.blending | grade.grd_blend | crs:ColorGradeBlending | EXACT_INT | 0 | none |
| cal.{red,green,blue}PrimaryHue/Saturation (6) | cal.cal_{red,green,blue}_{h,s} | crs:{Red,Green,Blue}{Hue,Saturation} | EXACT_INT | 0 | none |
| hsl.{hue,saturation,luminance}.{8 channels} (24) | hsl.hsl_{h,s,l}_{channel} | crs:{Hue,Saturation,Luminance}Adjustment{Channel} | EXACT_INT | 0 | none |

## Tone Curve array properties (4)

| Curve channel | Candidate path | Legacy preset key | XMP property |
|---|---|---|---|
| master | curves.rgb | master | crs:ToneCurvePV2012 |
| red | curves.red | red | crs:ToneCurvePV2012Red (falls back to master if null) |
| green | curves.green | green | crs:ToneCurvePV2012Green (falls back to master if null) |
| blue | curves.blue | blue | crs:ToneCurvePV2012Blue (falls back to master if null) |

Format: `"x, y, x, y, ..."`, integers, x-ascending. See
`P1D_XMP_COMPARISON_RULES.md`.

## Fixed literal attributes (never Candidate-derived, never compared)

`crs:ProcessVersion="11.0"`, `crs:PresetType="Normal"`,
`crs:SupportsAmount="False"`, `crs:SupportsColor="True"`,
`crs:SupportsMonochrome="False"`, `crs:SupportsHighDynamicRange="True"`,
`crs:SupportsNormalDynamicRange="True"`, `crs:SupportsSceneReferred="True"`,
`crs:SupportsOutputReferred="True"`, `crs:CameraModelRestriction=""`,
`crs:Copyright=""`, `crs:ColorNoiseReduction="25"`,
`crs:WhiteBalance="Custom"`.

## Unsupported Candidate paths (23, documented, never a fidelity failure)

`detail.colorNoiseReduction`, `detail.radius`, `detail.detail`,
`detail.masking`, `detail.noiseReductionDetail`,
`detail.colorNoiseReductionDetail`, `detail.colorNoiseReductionSmoothness`,
`profile.name`, `profile.treatment`, `profile.processVersion`,
`grading.balance`, `cal.shadowTint`, `effects.postCropVignetteAmount`,
`effects.postCropVignetteMidpoint`, `effects.postCropVignetteRoundness`,
`effects.postCropVignetteFeather`, `effects.grainAmount`,
`effects.grainSize`, `effects.grainFrequency`,
`optics.removeChromaticAberration`, `optics.enableProfileCorrections`,
`optics.distortion`, `optics.vignette`.
