# EPIC 2E-P1K — Serializer Lineage Audit: Post-Crop Vignette + Grain

## Scope

User-directed priority (single consolidated `AskUserQuestion` round, Auto
Mode): extend `core/preset-engine/index.js::serializeXMP` to support the
`effects.*` group (Post-Crop Vignette + Grain) — the highest-leverage of
four selected items, chosen first because it touches the one protected,
never-before-edited real XMP serializer.

## What existed before this round

- `candidate-schema.js`'s `createEmptyCandidate()` already defined all 7
  `effects.*` fields (`postCropVignetteAmount/Midpoint/Roundness/Feather`,
  `grainAmount/Size/Frequency`), always `null` — structurally present,
  never fabricated, per this project's established convention.
- `xmp-property-map.js`'s `UNSUPPORTED_CANDIDATE_PATHS` listed all 7
  paths, documenting (correctly) that the real serializer emitted zero
  attributes for them.
- `core/preset-engine/index.js::serializeXMP` — read in full before any
  edit — confirmed zero `crs:PostCropVignette*`/`crs:Grain*` attributes
  anywhere in its fixed template-literal output. This was a genuine
  serializer capability gap, not a wiring gap (the P1F–P1J defect class
  is exhausted; this is a different class: export-path-incapability).
- `legacy-preset-adapter.js::candidateToLegacyPreset()` produced no
  `effects` key at all in its flat output object.
- The P1D XMP Fidelity Gate (`xmp-property-map.js`, `xmp-readback-
  schema.js`, `xmp-readback-parser.js`, `candidate-xmp-comparator.js`)
  correctly classified all 7 fields as `UNSUPPORTED` (informational,
  never a fidelity failure).
- `xmp-validator/index.js`'s `HARD_LIMITS` had no `effects` group; no
  Layer-B clamp existed for these fields.

## Nine files touched this round (first-ever deliberate edits to two of them)

1. `core/preset-engine/index.js` — **first deliberate edit in the
   project's history**. Adds 7 `crs:` attributes + 1 fixed literal
   (`crs:PostCropVignetteStyle="1"`) after the existing 4 Tone Curve
   attributes, before the closing tag. Every pre-existing attribute
   verified byte-for-byte unchanged (test 14 in the P1K suite).
2. `core/xmp-validator/index.js` — second deliberate edit (first was
   P1J's Tone Curve clamp). Adds `HARD_LIMITS.effects` + Layer-B
   `_clampEffectsPanel()`, wired into `quickSafetyClamp()`.
3. `core/single-image/candidate/candidate-schema.js` — moves the 7
   `effects.*` paths out of `UNSUPPORTED_FIELD_PATHS` (now
   serializer-supported); Candidate defaults themselves stay `null`
   (no Intelligence layer populates them yet — that is future P1L+
   scope, not this round's).
4. `core/single-image/candidate/legacy-preset-adapter.js` — adds a flat
   `effects` object to the adapter's output, mirroring the existing
   `grade`/`cal` pattern exactly.
5. `core/single-image/candidate/candidate-export-parity.js` — one-line
   fix (plus explanatory comment) to `computeExportParity()`: a `null`
   Candidate value is no longer scored as a parity mismatch (see
   P1K_QA_REPORT.md §"Real regression found and fixed").
6. `core/single-image/xmp-fidelity/xmp-property-map.js` — 7 new
   `PROPERTY_MAP` entries; 7 paths removed from
   `UNSUPPORTED_CANDIDATE_PATHS`; 1 new `XMP_FIXED_ATTRIBUTES` entry.
7. `core/single-image/xmp-fidelity/xmp-readback-schema.js` — populates
   the previously-empty `effects: {}` placeholder with 7 named `null`
   fields.
8. `core/single-image/xmp-fidelity/xmp-readback-parser.js` — adds an
   `effects` branch to `_placeReadbackValue()`.
9. `core/single-image/xmp-fidelity/candidate-xmp-comparator.js` — adds
   an `effects` branch to `_readbackScalar()`.

## Explicitly out of scope this round

`optics.*` (4 fields: chromatic aberration, profile corrections,
distortion, lens vignette) remains fully `UNSUPPORTED` — the user's
selection was specifically "Vignette/Grain", not the full Effects/Optics
surface. Verified by test 34–35 in the P1K suite (optics attribute
count unchanged at 4; generated XMP contains zero optics-related
strings).
