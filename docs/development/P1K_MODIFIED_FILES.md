# EPIC 2E-P1K — Modified Files

## Core (9 files — exact set confirmed against the Production Lock manifest diff)

1. `core/preset-engine/index.js` — **first-ever deliberate edit**. `serializeXMP()` gains 7 `crs:` attributes + 1 fixed literal.
2. `core/xmp-validator/index.js` — second deliberate edit. New `HARD_LIMITS.effects` + `_clampEffectsPanel()`, wired into `quickSafetyClamp()`. Also fixes a latent mutation-safety gap (added `effects` to the function's shallow-copy set).
3. `core/single-image/candidate/candidate-schema.js` — `UNSUPPORTED_FIELD_PATHS` shrinks 19→12 (effects.* removed); doc comment updated.
4. `core/single-image/candidate/legacy-preset-adapter.js` — new flat `effects` object in `candidateToLegacyPreset()`'s output.
5. `core/single-image/candidate/candidate-export-parity.js` — null-safety fix in `computeExportParity()` (see P1K_QA_REPORT.md).
6. `core/single-image/xmp-fidelity/xmp-property-map.js` — `PROPERTY_MAP` 58→65; `UNSUPPORTED_CANDIDATE_PATHS` 23→16; `XMP_FIXED_ATTRIBUTES` +1.
7. `core/single-image/xmp-fidelity/xmp-readback-schema.js` — `effects: {}` populated with 7 named fields.
8. `core/single-image/xmp-fidelity/xmp-readback-parser.js` — `_placeReadbackValue()` gains an `effects` branch.
9. `core/single-image/xmp-fidelity/candidate-xmp-comparator.js` — `_readbackScalar()` gains an `effects` branch.

## QA

10. `qa/epic-2e-p1k-serializer-effects-extension-test.mjs` — new, 36 checks.
11. `qa/epic-2e-p1d-xmp-fidelity-gate-test.mjs` — 3 hard-coded count assertions updated (58/23/62 → 65/16/69).
12. `qa/run-static-suites.mjs` — new suite registered.
13. `qa/baselines/epic-2e-n1-production-invariant.json` — 2 hashes updated.
14. `qa/baselines/lufa42-production-lock-manifest.json` — regenerated (9 hashes updated, 197 confirmed unchanged).

## Metadata

15. `package.json` — version 2.10.0 → 2.11.0; description updated.

## Explicitly NOT modified

`optics.*` fields/paths, `ui/app.js`, `ui/ui-engine.js`,
`core/color-match/reference-xmp-generator.js`,
`core/lightroom-mapping-engine/index.js`, and every P1F/P1G/P1H/P1I/P1J
module — confirmed via direct SHA-256 comparison before and after this
round's edits.
