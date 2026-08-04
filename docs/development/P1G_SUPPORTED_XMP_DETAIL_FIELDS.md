# P1G Supported XMP Detail Fields

## Supported (real, Candidate-driven, round-trip verified)

| Candidate path | Legacy Preset key | XMP property | Compare mode |
|---|---|---|---|
| `detail.sharpening` | `sharp` | `crs:Sharpness` | `EXACT_INT` |
| `detail.noiseReduction` | `noise` | `crs:LuminanceSmoothing` | `EXACT_INT` |

Both entries live in `xmp-property-map.js`'s existing `BASIC_ENTRIES`
list (the same shared map P1E/P1F use — see
`P1G_DETAIL_INTELLIGENCE_ARCHITECTURE.md`), with `clampGroup: null`
(no Layer-B hard limit — see the two-layer safety-net gap section
below), `required: true`. Verified end-to-end (Candidate → Legacy
Preset → `quickSafetyClamp()` → `serializeXMP()` → P1D's real Fidelity
Gate readback) by test 7 and test 46.

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

## Two-layer safety-net gap (pre-existing, documented, not a P1G regression)

`core/xmp-validator/index.js`'s `HARD_LIMITS` has **zero entries** for
any Detail field, before and after this EPIC — confirmed by direct
source grep in the original audit and re-confirmed by mutation test M4.
This means Layer B (`quickSafetyClamp()`, applied a second time
immediately before export) provides no protection whatsoever for
Sharpening or Luminance Noise Reduction. `detail-guardrails.js` (Layer
A, applied once before Candidate commit) is therefore the **sole**
safety net for both fields. This gap pre-dates P1G and is not
introduced by it — P1G's own Layer-A guardrails are the actual fix
already shipped for it, but a direct post-commit overwrite of
`candidate.detail.sharpening` still passes through unclamped at export
time (M4). Closing this gap by adding `HARD_LIMITS.detail` entries is
out of this EPIC's scope (it would touch the Production-Locked
`xmp-validator/index.js`) and is recorded as a known limitation — see
`P1G_KNOWN_LIMITATIONS.md`.
