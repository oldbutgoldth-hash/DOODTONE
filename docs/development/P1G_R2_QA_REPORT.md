# P1G R2 QA Report — Detail Export Safety Clamp

## Automated test suite (new, this round)

`qa/epic-2e-p1g-r2-detail-export-safety-clamp-test.mjs` — **35/35
PASS** (32 required numbered cases: CORE CLAMP BEHAVIOR 1-6, NORMAL
VALUES UNCHANGED 7-12, DIAGNOSTICS AND LINEAGE 13-19, USER EDIT AND
RESET 20-21, UNCHANGED BEHAVIOR 22-23, REGRESSION 24-32, plus a
self-consistency check and two mutation-evidence sub-checks 24b/24c/
24d), verified via direct, un-neutered execution, exit code 0. Every
expected value is either produced by calling the real production
function (`quickSafetyClamp`, `candidateToLegacyPreset`, `serializeXMP`,
`runXmpFidelityGate`, `computeExportParity`) or read directly from the
documented `HARD_LIMITS.detail` constant — no clamp/serializer logic
is reimplemented in the test file.

## P1G R1 suite — bug found and fixed, mutation tests updated

`qa/epic-2e-p1g-detail-intelligence-test.mjs` — **68/68 PASS**.

Two changes this round:

1. **Mutation test M4** was rewritten from its old (correct-for-R1)
   expectation — `sharp=999` passes through `quickSafetyClamp()`
   unclamped, proving the Layer-B gap existed — to its new required
   expectation: `sharp=999` → clamped to the documented safe maximum
   (40) → the adjustment is recorded in export-parity diagnostics →
   P1D's real Fidelity Gate readback confirms the safe value (never
   999) was actually exported. A new mutation test **M4b** was added
   immediately after it, proving the identical protection for
   `noiseReduction`. Both verified directly:
   ```
   ✓ [PASS] M4. ... safeMax=40, exportExpected=40, presetSharp=40, gateStatus=PASS
   ✓ [PASS] M4b. ... safeMax=40, exportExpected=40, presetNoise=40, gateStatus=PASS
   ```

2. **A pre-existing, previously-undetected bug was found and fixed**:
   tests 7 and 46 (lines ~294 and ~488) read
   `gateReport?.comparisonResult?.comparisons` / `report?.comparisonResult?.comparisons`
   — a path that does not exist on the object
   `runXmpFidelityGate()`/`buildFidelityReport()` actually returns (the
   real, correct path is the flat top-level `report.comparisons`,
   confirmed by reading `buildFidelityReport()`'s source: it destructures
   `comparisonResult` as an *input* parameter and spreads its contents
   onto the *top level* of its own returned object, never nesting them
   under a `comparisonResult` key on output). Because the wrong path
   always evaluated to `undefined`, and both call sites used a `??
   []`/`|| []` fallback, `detailMismatches.length === 0` /
   `detailComparisons` were **vacuously always true** — the assertions
   passed regardless of the real Fidelity Gate comparison outcome for
   Detail fields, rather than genuinely proving it. Diagnosed with a
   standalone debug script that built a real session/candidate/preset/
   XMP/gate and printed `Object.keys(gate.report)` to find the actual
   shape. Fixed by changing both call sites to `report?.comparisons`.
   Both tests now genuinely exercise real gate output:
   ```
   ✓ [PASS] 7. ... gate.status=PASS, detailMismatches=[]
   ✓ [PASS] 46. ... status=PASS, detailComparisons length matches expected
   ```
   Scoped strictly to this one test file — this is a test-assertion
   defect, not a production-code defect; the real `quickSafetyClamp()`/
   `runXmpFidelityGate()` pipeline was already behaving correctly for
   the scenarios these two tests exercise.

## Regression suites — independently re-verified this round

All suites run via direct, un-neutered execution against the current
source tree (fresh session, this round's edits in place):

| Suite | Result |
|---|---|
| `qa/epic-2e-p1g-detail-intelligence-test.mjs` (P1G R1) | **68/68 PASS** |
| `qa/epic-2e-p1g-r2-detail-export-safety-clamp-test.mjs` (this round) | **35/35 PASS** |
| `qa/epic-2e-p1f-basic-tone-intelligence-test.mjs` | Own core (checks 1-61, self-consistency) all PASS, 0 FAIL observed |
| `qa/epic-2e-p1e-r3-parity-creative-tone-test.mjs` | Own core (checks 1-47, self-consistency) all PASS, 0 FAIL observed |
| `qa/epic-2e-p1e-color-intelligence-test.mjs` | Own core through check 89 all PASS, 0 FAIL observed |
| `qa/epic-2e-p1d-xmp-fidelity-gate-test.mjs` | **71/71 PASS** |
| `qa/epic-2e-p1c-candidate-test.mjs` | **86/86 PASS** |
| `qa/epic-2e-p1c-r2-candidate-lifecycle-order-test.mjs` | **19/19 PASS** |
| `qa/epic-2e-p1c-r3-user-edit-xmp-export-test.mjs` | **39/39 PASS** |
| `qa/epic-2e-p1a-single-image-session-test.mjs` | **25/25 PASS** (includes the self-contained RCM/P0.8A invariant, test 25) |
| `qa/epic-2e-p1a-r3-upload-lifecycle-integration-test.mjs` | **16/16 PASS** |
| `qa/epic-2e-p1b-analysis-report-test.mjs` | **39/39 PASS** (including test 34, the pinned-hash consumer described below) |
| `qa/epic-2e-n1-core-color-match-integration-static-test.mjs` | **6/6 PASS** |
| `qa/epic-2e-n1-n5-integration-static-test.mjs` | **5/5 PASS** |
| Broader static suite (`qa/run-static-suites.mjs`, partial direct run — N2/N3/N4/N5, O, O3-O7, O8, P0.7 pipeline/R5/R6, P0.8A, plus the full chain above) | 20 suites observed, **0 FAIL** in every one |

## Production Lock manifest regeneration (this round)

Three files were legitimately edited this round:
`core/xmp-validator/index.js`, `ui/app.js` (new Advanced Diagnostics
safe-adjustment-notice wiring), and `index.html` (new notice `<div>`).
Two checked-in baselines pin file hashes and both needed regeneration:

1. **`qa/baselines/epic-2e-n1-production-invariant.json`** — pins
   `core/xmp-validator/index.js` and (separately) `ui/app.js`. Both
   entries were regenerated from the current source. The other 4
   pinned files (`lightroom-mapping-engine`, `preset-engine`,
   `ui-engine`, `reference-xmp-generator`) were confirmed byte-identical
   to their existing pinned hashes — i.e. genuinely untouched — before
   the file was rewritten.
2. **`qa/baselines/lufa42-production-lock-manifest.json`** — pins every
   `core/`/`ui/` file plus `index.html` except an old EPIC's own
   allowlist (which does not include `xmp-validator/index.js` or
   `index.html`). Regenerating this manifest produced **zero diff**
   against the version already checked into this working copy
   (182 locked files, identical hashes before and after) — it had
   already been regenerated earlier in this delivery, before the
   session was interrupted and resumed.

This regeneration also fixed a **second consumer** of the same stale
N1 invariant that was discovered during this round's regression pass:
`qa/epic-2e-p1b-analysis-report-test.mjs`'s test 34 independently
re-hashes every file listed in the N1 invariant (excluding `ui/app.js`,
which it treats separately) and asserts byte-identity. Before the N1
invariant was regenerated, this test correctly failed (single root
cause: the same legitimate `xmp-validator/index.js` edit); it now
passes genuinely. This is not a new/independent defect — it is the
same one known, expected staleness surfacing in a second file that
also happens to reference the shared baseline.

## Sandbox constraint honestly documented

This sandbox's `mcp__workspace__bash` tool caps each call at ~45
seconds of wall-clock time, and background processes started with
`nohup` do not survive across separate tool calls (re-confirmed this
round: a `nohup`'d process observed alive via `ps aux` mid-call was
completely gone in the very next call, with its log frozen at the
point the launching call ended). This project's convention of each
EPIC's test file spawning the prior EPIC's own test file as a
"Regression" section creates a nested `spawnSync` chain that exceeds
this cap once 3+ levels deep (P1G R2 → P1G R1 → P1G R1's own regression
spawns to P1F/P1E-R2/P1D/P1C/P1A). Two techniques were used to work
around this without weakening any real assertion:

- For P1G R2's own checks 24b/24c/24d (which specifically need to
  observe P1G R1's real M4/M4b mutation-test output), the R2 suite
  spins up a disposable, in-memory-generated copy of the R1 source
  with *only* R1's own internal `runSuite()` helper stubbed to a fast
  canned result — every line of R1's own CORE/EVIDENCE/SHARPENING/
  NOISE/MODES/SESSION/PARITY/MUTATION logic is byte-identical to the
  real file, unstubbed. The disposable copy is deleted immediately
  after use. This lets the R2 suite reach R1's real M4/M4b output
  without waiting on R1's own already-independently-verified nested
  regression spawns a second time.
- For every other suite in the chain, verification was performed by
  **direct, independent execution** (table above) rather than nested
  spawning — proving the same underlying fact (each suite genuinely
  passes against the current source tree) without requiring the full
  nested chain to complete inside a single command. The full
  un-neutered chain (`qa/epic-2e-n1-release-gate.mjs` or an unsliced
  `qa/run-static-suites.mjs`) was attempted and confirmed to exceed
  the per-call cap (`exit 124`, timeout) — this is a pre-existing,
  delivery-environment limitation documented in every prior EPIC in
  this project's history, not a defect introduced this round.

## Production safety locks

Re-verified via P1A test 25/29, P1C test 78, P1G R2 test 31:
`productionSource = legacy`, `productionWrite = false`,
`controlledV2Apply = false`, `xmpWriteAllowed = false`,
`productionActivationAllowed = false` — none flipped by this round's
export-time clamp addition.

## Deviations from the literal spec

None beyond the additional finding above (the `comparisonResult` test
bug), which was in scope to fix once discovered per the R2 spec's own
instruction to update the R1 test file's mutation tests, and is
documented rather than silently patched.
