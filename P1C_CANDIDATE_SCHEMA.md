# EPIC 2E-P1C — Canonical Candidate Schema

Source of truth: `core/single-image/candidate/candidate-schema.js`
(`CANDIDATE_SCHEMA_VERSION = 'P1C_CANDIDATE@1'`).

Every field below is either populated from a real Production field (the
existing flat preset the serializer already consumes, via
`session.candidateRaw`) or left `null` with a comment in
`candidate-builder.js` explaining that no Production source exists yet.
Nothing here is fabricated.

```
Candidate {
  candidateId: string
  sessionId: string
  generationId: string
  schemaVersion: 'P1C_CANDIDATE@1'
  status: CANDIDATE_STATUS            // see below
  revision: number                    // bumped on every parameter edit/patch
  createdAt: number (ms)
  updatedAt: number (ms)

  profile: {
    name: string|null                 // from rawPreset.name (Preset Name field)
    treatment: string|null            // fixed 'Color' — no Production Monochrome path exists
    processVersion: string|null       // fixed '11.0' — matches serializeXMP()
  }

  whiteBalance: { mode, temperature, tint }        // rawPreset.temp / .tint

  basic: {
    exposure, contrast, highlights, shadows, whites, blacks,
    texture, clarity, dehaze, vibrance, saturation
  }                                                 // rawPreset.exp/con/hi/sh/wh/bl/texture/clarity/dehaze/vib/sat

  curves: {
    rgb, red, green, blue             // from rawPreset.curves (master/red/green/blue) — null if absent
    parametric: { shadows, midtones, highlights }   // rawPreset.crv_sh/crv_mid/crv_hi
  }

  hsl: {
    hue:        { red, orange, yellow, green, aqua, blue, purple, magenta }
    saturation: { red, orange, yellow, green, aqua, blue, purple, magenta }
    luminance:  { red, orange, yellow, green, aqua, blue, purple, magenta }
  }                                                 // rawPreset.hsl.hsl_{h,s,l}_<channel>

  grading: {
    shadows:   { hue, saturation, luminance }
    midtones:  { hue, saturation, luminance }
    highlights:{ hue, saturation, luminance }
    blending: number                                // rawPreset.grade.grd_blend
    balance: null                                    // no Production field exists
  }                                                 // rawPreset.grade.grd_{sh,mid,hi}_{h,s,l}

  cal: {
    shadowTint: null                                 // no Production field/slider exists
    redPrimaryHue, redPrimarySaturation,
    greenPrimaryHue, greenPrimarySaturation,
    bluePrimaryHue, bluePrimarySaturation
  }                                                 // rawPreset.cal.cal_{red,green,blue}_{h,s}

  detail: {
    sharpening: number            // rawPreset.sharp
    radius: null                  // no Production field
    detail: null                  // no Production field
    masking: null                 // no Production field
    noiseReduction: number        // rawPreset.noise
    noiseReductionDetail: null    // no Production field
    colorNoiseReduction: 25       // fixed — hardcoded constant in serializeXMP() itself
    colorNoiseReductionDetail: null
    colorNoiseReductionSmoothness: null
  }

  effects: { postCropVignetteAmount, postCropVignetteMidpoint,
             postCropVignetteRoundness, postCropVignetteFeather,
             grainAmount, grainSize, grainFrequency }  // all null — unsupported by current pipeline

  optics: { removeChromaticAberration, enableProfileCorrections,
            distortion, vignette }                    // all null — unsupported by current pipeline

  metadata: {
    sourceFilename: string|null       // session.image.filename
    generatedBy: 'LUMIXA AI'
    engineVersion: string|null        // package.json version, passed in by the caller
    profileVersion: string            // single-image-analysis-profile.js PROFILE_VERSION
  }

  diagnostics: {
    confidence: { score, level, ... }      // confidenceFromRaw(evidence.styleFeatureGraph...) — reused from P1B
    sourceEvidence: string[]                // evidence keys that actually completed
    safetyClamps: object[]                  // from the EXISTING validation/benchmark/reclamp output — never recomputed
    warnings: object[]                      // from the EXISTING style-fingerprint violations + benchmark warnings
    manualEdits: { changedParameters: string[], revision, lastEditedAt }
    lineage: { [parameterPath]: LineageEntry }   // see candidate-lineage.js
    autoValues: { whiteBalance, basic, curves, hsl, grading, cal, detail }  // snapshot for Reset-to-Auto
  }
}
```

## CANDIDATE_STATUS enum

`EMPTY | BUILDING | AUTO_GENERATED | VALID | VALID_WITH_WARNINGS |
INVALID | USER_EDITED | STALE | FAILED`

- `EMPTY` — no `candidateRaw` yet, or the Session hasn't reached a
  terminal (COMPLETED/PARTIAL) status.
- `AUTO_GENERATED` — freshly built from evidence, not yet validated (or
  validated and clean, before any manual edit).
- `VALID` / `VALID_WITH_WARNINGS` / `INVALID` — set by
  `buildAndCommitCandidate()`'s call to `validateCandidate()`.
- `USER_EDITED` — set the moment any single slider parameter is edited;
  cleared back to `AUTO_GENERATED` only when every changed parameter has
  been reset to its Auto value.
- `STALE` — reserved for a superseded generation (in practice a stale
  Candidate simply never commits — see
  `CANDIDATE_STALE_REJECTED`/`STALE_GENERATION` handling in
  `single-image-orchestrator.js` and `candidate-store.js`).
- `FAILED` — a structural validation error occurred during build.

## Field-name policy

Field names inside `hsl`/`grading`/`cal`/`curves` are the canonical,
already-camelCased names shown above — there are no parallel aliases
(no `hslData`, `gradingData`, `calibrationData`, `toneCurveData`
anywhere in this module tree). The flat, underscore-prefixed slider IDs
(`hsl_h_orange`, `grd_sh_h`, `cal_red_s`, ...) exist only at the DOM/
slider boundary and inside `session.candidateRaw`/the legacy preset
shape — see `P1C_SLIDER_MAPPING.md` for the exact translation table.
