# EPIC 2E-P1L — QA Report

## New test suite

`qa/epic-2e-p1l-parametric-tone-curve-test.mjs` — **21/21 PASS**

1. Schema + empty-plan fallback (4 checks): default shape, missing evidence,
   low-confidence evidence, missing/invalid master points all correctly fall
   back to `buildEmptyParametricTonePlan()` with `finalValues = {0,0,0}` and
   `diagnostics.engaged = false`.
2. Real derivation from master-curve deviation (5 checks): a synthetic
   lifted-shadows / rolled-highlights master curve
   (`LIFTED_SHADOWS_ROLLED_HIGHLIGHTS`) produces correctly-signed,
   correctly-scaled Shadows/Midtones/Highlights values; an identity curve
   (`IDENTITY_CURVE`) produces exactly `{0,0,0}` and `engaged = false`.
3. Layer-A bound + strength-mode scaling (3 checks): an adversarial/extreme
   deviation is restrained to the `MAX_PARAMETRIC_DEVIATION = 45` ceiling;
   NATURAL/BALANCED/DRAMATIC strength modes scale the same input
   monotonically (0.65× / 1.00× / 1.25×).
4. Layer-B safety clamp (4 checks): out-of-range values (e.g. 999) clamp to
   ±60; non-finite (NaN-like) values fail closed to 0; the clamp does not
   mutate the caller's original object; in-range values pass through
   unchanged.
5. Full round-trip export (4 checks): legacy-preset-adapter →
   `quickSafetyClamp()` → `serializeXMP()` → XMP readback parser →
   candidate-XMP comparator — the exported `crv_sh`/`crv_mid`/`crv_hi`
   attributes match the Candidate's `curves.parametric` values exactly, and
   an out-of-range Candidate value is genuinely clamped before export (not
   just in isolation).
6. candidate-builder.js wiring (1 check): `buildParametricTonePlan()` is
   actually imported and called, writes `diagnostics.parametricToneIntelligence`,
   and the new block does not touch `curves.rgb`/`red`/`green`/`blue`.

## Regression suites re-run standalone this round

Per this project's bounded-runtime convention (nested `execSync` nested
suite spawns exceed the sandbox's ~120-180s per-command cap), every
downstream suite was run as its own standalone command:

| Suite | Result |
|---|---|
| `qa/epic-2e-p1d-xmp-fidelity-gate-test.mjs` | 71/71 PASS |
| `qa/epic-2e-p1k-serializer-effects-extension-test.mjs` | 36/36 PASS |
| `qa/epic-2e-p1c-candidate-test.mjs` | 86/86 PASS |
| `qa/epic-2e-p1c-r3-user-edit-xmp-export-test.mjs` | 39/39 PASS |
| `qa/epic-2e-p1b-analysis-report-test.mjs` | 39/39 PASS |
| `qa/epic-2e-p1l-parametric-tone-curve-test.mjs` | 21/21 PASS |

## Production-lock re-verification

- N1 6-file invariant (`qa/baselines/epic-2e-n1-production-invariant.json`):
  direct SHA-256 diff against the pinned baseline, run **before** any fix,
  confirmed exactly one file differed — `core/xmp-validator/index.js` (this
  round's third deliberate edit). All 5 other pinned files
  (`reference-xmp-generator.js`, `lightroom-mapping-engine/index.js`,
  `preset-engine/index.js`, `ui/app.js`, `ui/ui-engine.js`) were confirmed
  byte-identical. The one changed hash was updated; suite re-run confirmed
  green.
- 206→208-file manifest (`qa/baselines/lufa42-production-lock-manifest.json`):
  direct SHA-256 diff, run **before** regeneration, confirmed exactly two
  files differed — `core/xmp-validator/index.js` and
  `core/single-image/candidate/candidate-builder.js` — matching exactly the
  files intentionally edited this round, no silent scope creep. Regenerated
  via `node qa/baselines/generate-production-lock-manifest.mjs`, which
  auto-discovers the 2 new parametric-tone-intelligence files
  (206 → 208 locked files). Suites re-run confirmed green.
- Production safety locks (`productionWrite=false`,
  `lightroomMappingAllowedByN1=false`, `xmpWriteAllowedByN1=false`) confirmed
  unchanged.

## Verification method note

Every new/modified `.js` file was checked with both `node --check` and a
real ESM `import()` (not `node --check` alone), per this project's
established convention — `node --check` alone has previously missed
comment-block/brace-mismatch errors introduced by string-replace edits.
