# P1D — XMP Readback Schema

Source: `core/single-image/xmp-fidelity/xmp-readback-schema.js`.

```
{
  schemaVersion: 'P1D_XMP_READBACK@1',
  parseStatus: 'NOT_RUN' | 'OK' | 'PARSE_FAILED',
  sourceLength: number,
  namespaces: { x, rdf, crs },          // read from xmlns:* declarations
  profile: { name: null, treatment: null, processVersion, cameraProfile: null },
  whiteBalance: { mode, temperature /* Kelvin, raw XMP unit */, tint },
  basic: { exposure /* ×100 slider units */, contrast, highlights, shadows,
           whites, blacks, texture, clarity, dehaze, vibrance, saturation },
  curves: { rgb, red, green, blue,      // {x,y}[] or {invalid:true, reason} or null (missing)
            parametric: { shadows, midtones, highlights } },
  hsl: { hue: {8 channels}, saturation: {8 channels}, luminance: {8 channels} },
  grading: { shadows, midtones, highlights: {hue,saturation,luminance},
             blending, balance: null },
  cal: { shadowTint: null, redPrimaryHue, redPrimarySaturation,
         greenPrimaryHue, greenPrimarySaturation,
         bluePrimaryHue, bluePrimarySaturation },
  detail: { sharpening, noiseReduction, colorNoiseReduction },
  effects: {}, optics: {},              // always empty -- never serialized
  missingProperties: string[],          // Candidate paths whose XMP attribute was absent
  unknownProperties: string[],          // XMP attributes not in the property map / fixed set
  diagnostics: { parserWarnings: string[], parserErrors: string[] },
}
```

## Deviations from the illustrative spec contract

- `profile.treatment` and `profile.cameraProfile` are always `null` —
  the real serializer never emits either attribute, and
  `cameraProfile` is not even a Candidate schema field. Documented as
  unsupported rather than fabricated.
- `whiteBalance.temperature` holds the raw **Kelvin** value read from
  `crs:Temperature`, not the Candidate's slider unit — this matches
  the XMP's own unit and is what the comparator's
  `TEMPERATURE_KELVIN` mode compares against (see comparison rules).
- `basic.exposure` holds the value in "×100 slider units"
  (`Math.round(parseFloat(attr) * 100)`), matching the Candidate's own
  internal representation, not the raw EV float string.
- Missing fields are always explicit `null` (or absent from
  `missingProperties` only when genuinely present) — never `undefined`
  — per `validateReadbackValue()`'s undefined/NaN/Infinity rejection.
