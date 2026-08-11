# EPIC 2E-P1K — XMP Attribute Name + Default Calibration

## Real Adobe Camera Raw attribute names used

No file in this codebase previously defined Post-Crop Vignette/Grain
`crs:` attribute names (unlike every other group, which was traced from
the real, already-shipped `serializeXMP()` output). Per this project's
"calibration-before-coding" discipline, these 8 names/defaults are
calibrated against Adobe Camera Raw's well-established, publicly
documented Develop-module Effects-panel XMP schema (the same `crs:`
namespace every other attribute in this serializer already uses):

| Candidate field | Flat legacy key | Real `crs:` attribute | Real LR default |
|---|---|---|---|
| `effects.postCropVignetteAmount` | `fx_vignette_amount` | `crs:PostCropVignetteAmount` | 0 |
| `effects.postCropVignetteMidpoint` | `fx_vignette_midpoint` | `crs:PostCropVignetteMidpoint` | 50 |
| `effects.postCropVignetteRoundness` | `fx_vignette_roundness` | `crs:PostCropVignetteRoundness` | 0 |
| `effects.postCropVignetteFeather` | `fx_vignette_feather` | `crs:PostCropVignetteFeather` | 50 |
| — (no Candidate field; fixed literal) | — | `crs:PostCropVignetteStyle` | `1` (Highlight Priority) |
| `effects.grainAmount` | `fx_grain_amount` | `crs:GrainAmount` | 0 |
| `effects.grainSize` | `fx_grain_size` | `crs:GrainSize` | 25 |
| `effects.grainFrequency` | `fx_grain_frequency` | `crs:GrainFrequency` | 50 |

`crs:PostCropVignetteStyle` has no corresponding Candidate field (the
schema was never asked to carry a vignette-style enum) and is emitted
as a fixed literal, exactly mirroring the pre-existing
`crs:WhiteBalance="Custom"` convention in the same function.

## Naming-convention cross-check (why this mapping is trustworthy, not guessed)

Every other group in `serializeXMP()` shows an exact 1:1 correspondence
between the Candidate field's camelCase suffix and the real `crs:`
attribute name minus its group prefix — e.g. `grading.shadows.hue` →
`crs:ColorGradeShadowHue`, `cal.redPrimaryHue` → `crs:RedHue`,
`hsl.hue.red` → `crs:HueAdjustmentRed`. The `effects.*` Candidate field
names (`postCropVignetteAmount`, `grainSize`, etc.) already read as
camelCase versions of the real Adobe attribute names before this round
started — strong independent evidence the original schema author
derived the field names FROM the real attribute names, which is exactly
what P1K's mapping now completes.

## Value-range calibration (Layer-B `HARD_LIMITS.effects`)

Unlike Detail (P1G R2) and Tone Curve (P1J), no Layer-A planner exists
yet for this group — no Intelligence layer computes real values (that
is explicitly future work, not part of the user's 4-item selection for
this round). Without a legitimate-output range to sit "comfortably
above" (this file's usual calibration philosophy), the Layer-B bounds
instead pin directly to Lightroom's own real Develop-module Effects-
panel UI slider ranges:

- Vignette Amount: `[-100, 100]`
- Vignette Midpoint: `[0, 100]`
- Vignette Roundness: `[-100, 100]`
- Vignette Feather: `[0, 100]`
- Grain Amount / Size / Frequency: `[0, 100]` each

This still protects export from a corrupted or out-of-range Candidate
(fail-closed on non-finite, mirrors `_clampDetailPanel()`'s convention
exactly) even though every value defaults to 0/50/0/50/0/25/50 today.
