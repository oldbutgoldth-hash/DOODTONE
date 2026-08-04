# P1G Supported XMP Detail Fields

## Supported (real, Candidate-driven, round-trip verified)

| Candidate path | Legacy Preset key | XMP property | Compare mode |
|---|---|---|---|
| `detail.sharpening` | `sharp` | `crs:Sharpness` | `EXACT_INT` |
| `detail.noiseReduction` | `noise` | `crs:LuminanceSmoothing` | `EXACT_INT` |

Both entries live in `xmp-property-map.js`'s existing `BASIC_ENTRIES`
list (the same shared map P1E/P1F use — see
`P1G_DETAIL_INTELLIGENCE_ARCHITECTURE.md`), `required: true`. As of
R2, both fields also have a real Layer-B hard limit —
`HARD_LIMITS.detail` in `core/xmp-validator/index.js` — see the updated
section below. Verified end-to-end (Candidate → Legacy Preset →
`quickSafetyClamp()` → `serializeXMP()` → P1D's real Fidelity Gate
readback) by test 7 and test 46 (P1G R1) plus the full R2 suite.

## NOT supported: `detail.colorNoiseReduction`

`core/preset-engine/index.js::serializeXMP()` writes
`crs:ColorNoiseReduction="25"` as a **hardcoded literal** — it never
reads `preset.colorNoise` or any Candidate-derived value. There is
therefore no proven Candidate → Legacy Preset → Serializer → XMP export
path for Color Noise Reduction in this codebase. `detail.colorNoiseReduction`
is listed in `UNSUPPORTED_CANDIDATE_PATHS` (`xmp-property-map.js`) and
correctly excluded from `PROPERTY_MAP`/`computeExportParity()`'s
comparison surface (test 48). The Detail Plan's own
`noiseReduction.color` object still computes a `recommended` value for
Advanced-Diagnostics/lineage transparency, but always with
`supported: false` and an explicit reason string naming this exact
hardcoded literal (test 29, 30) — never fabricating an export path that
doesn't exist.

## Two-layer safety net (R2: gap closed)

As of R2, `core/xmp-validator/index.js`'s `HARD_LIMITS` has a real
`detail` entry: `{ sharpening: {min:0,max:40}, noiseReduction:
{min:0,max:40} }`. `quickSafetyClamp()` (Layer B, applied a second
time immediately before export) now protects both Sharpening and
Luminance Noise Reduction exactly as it already protected every other
panel, catching anything Layer A's one-time, pre-commit
`detail-guardrails.js` check cannot — post-commit mutations, future
bugs, or a direct manual overwrite of the Candidate. Mutation tests
M4/M4b (updated/added in R2) prove a corrupted `candidate.detail.sharpening
= 999` (or `noiseReduction = 999`) is clamped to the documented safe
maximum before export, with the P1D Fidelity Gate confirming the safe
value — never 999 — was actually written to the XMP. See
`P1G_R2_DETAIL_EXPORT_SAFETY_CLAMP.md` for the full writeup and
`P1G_KNOWN_LIMITATIONS.md` for the updated limitations list.
