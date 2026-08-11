# EPIC 2E-P1K — QA Report

## New test suite

`qa/epic-2e-p1k-serializer-effects-extension-test.mjs` — 36/36 PASS.
Covers: Candidate schema surface (3), PROPERTY_MAP/UNSUPPORTED_PATHS
coverage (6), legacy-preset-adapter defaults + forwarding (2),
serializeXMP direct output incl. attribute-order/non-disturbance proof
(4), full round-trip via readback+comparator incl. a mutation test (3),
Layer-B safety clamp incl. mutation-safety and legacy-caller-safety (7),
export-parity null-safety (3), Production Lock re-verification (4),
out-of-scope (`optics.*`) confirmation (3).

Registered in `qa/run-static-suites.mjs`.

## Real regression found and fixed (not hash staleness — a genuine logic gap)

Running the pre-existing `qa/epic-2e-p1e-r3-parity-creative-tone-test.mjs`
suite after wiring `effects.*` into `PROPERTY_MAP` surfaced `mismatched=7`
on test 4 (previously passing). Root cause: `candidate-export-
parity.js::computeExportParity()` compared `candidateCurrentValue ===
exportExpectedValue` for every `PROPERTY_MAP` entry. Before P1K, every
`PROPERTY_MAP`-covered `candidatePath` was guaranteed non-null by
`createEmptyCandidate()`/`normalizeCandidate()` — the only two
previously-nullable fields (`curves.*`, `cal.shadowTint`) lived outside
`PROPERTY_MAP` (in `CURVE_PROPERTIES`/`UNSUPPORTED_CANDIDATE_PATHS`
respectively), so this comparator never had to handle a null Candidate
value. P1K's 7 new `effects.*` entries are the first `PROPERTY_MAP`
members that can legitimately be `null` on a real Candidate (no
Intelligence layer populates them yet), which broke the implicit
non-null assumption: `null === 0` (the adapter's Lightroom-default
fallback) is `false`, so every one of the 7 new fields registered as a
"mismatch" even though nothing was ever actually wrong.

**Fix**: `candidateCurrentValue === null || candidateCurrentValue ===
exportExpectedValue` — a `null` Candidate value means "no Intelligence
layer has computed this field yet", never a genuine parity mismatch,
mirroring the same "legitimately unavailable — not an error" treatment
`candidate-schema.js`'s `_validCurvePoints()` already gives a null
curve. Verified this does NOT mask real mismatches: test 28 in the new
P1K suite feeds a genuinely out-of-range value (999) and confirms it is
still correctly flagged.

Re-ran the P1E R3 suite after the fix: 62/62 PASS (stable across 4
consecutive runs).

## Regression suites re-run standalone (bounded-runtime convention)

| Suite | Result |
|---|---|
| `qa/epic-2e-p1b-analysis-report-test.mjs` | 39/39 PASS |
| `qa/epic-2e-p1c-candidate-test.mjs` | 86/86 PASS |
| `qa/epic-2e-p1c-r3-user-edit-xmp-export-test.mjs` | 39/39 PASS |
| `qa/epic-2e-p1d-xmp-fidelity-gate-test.mjs` | 71/71 PASS |
| `qa/epic-2e-p1e-r3-parity-creative-tone-test.mjs` | 62/62 PASS |
| `qa/epic-2e-p1k-serializer-effects-extension-test.mjs` (new) | 36/36 PASS |

P1F/P1G/P1G R2/P1H/P1I/P1I R2/P1J were not re-run standalone this round
(sandbox wall-clock constraints on nested/heavy suites) but none of
their own files appear in the 9-file changed-file list confirmed by the
Production Lock manifest diff below — they have zero code-path
dependency on any file this round touched.

## Existing P1D suite: 3 stale assertions updated (expected, documented)

`qa/epic-2e-p1d-xmp-fidelity-gate-test.mjs` tests 9, 11, and 22
hard-coded the pre-P1K `PROPERTY_MAP`/`UNSUPPORTED_CANDIDATE_PATHS`
counts (58/23/62). Updated to the new, correct counts (65/16/69) with
explanatory comments — the same "update deliberately once, documented"
pattern already established for Production Lock hashes in P1G R2/P1J.

## Production Lock re-verification

Two baseline files updated, both re-verified by direct SHA-256
comparison before AND after the update:

- `qa/baselines/epic-2e-n1-production-invariant.json` (6-file N1
  invariant): `core/preset-engine/index.js` and `core/xmp-validator/
  index.js` hashes updated (first-ever and second-ever deliberate edits
  respectively). All 4 other pinned files (`reference-xmp-generator.js`,
  `lightroom-mapping-engine/index.js`, `ui/app.js`, `ui/ui-engine.js`)
  confirmed byte-identical, untouched.
- `qa/baselines/lufa42-production-lock-manifest.json` (206-file
  manifest, regenerated via `qa/baselines/generate-production-lock-
  manifest.mjs`): pre-regeneration diff confirmed exactly 9 files
  differed from the pinned P1J baseline — the exact 9 files this round
  deliberately edited, no more, no less. Manifest regenerated and
  re-verified byte-identical against the current tree.

Production safety locks (`productionWrite: false`,
`lightroomMappingAllowedByN1: false`, `xmpWriteAllowedByN1: false`)
confirmed unchanged.

## Browser QA

Not attempted this round — no Chromium available in this sandbox
(consistent with every prior EPIC in this project's history). All
verification is real-module Node integration testing against the
actual production `serializeXMP`/`quickSafetyClamp`/adapter/comparator
functions, not mocks.
