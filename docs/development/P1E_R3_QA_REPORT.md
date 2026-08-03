# EPIC 2E-P1E R3 — QA Report

## Automated test results (all real, Node-executed, this round)

| Suite | Result |
|---|---|
| `qa/epic-2e-p1e-r3-parity-creative-tone-test.mjs` (NEW, this round) | **55/55 required cases + 7/7 mutation tests = 62/62 PASS, 0 FAIL** |
| `qa/epic-2e-p1e-color-intelligence-test.mjs` (P1E R1/R2) | 94/94 PASS, 0 FAIL — unmodified except test 87's expected-value derivation updated to call the real `classifyScene()`/`getFamilyMultiplier()` functions (documented in `P1E_R3_MODIFIED_FILES.md`) |
| `qa/epic-2e-p1d-xmp-fidelity-gate-test.mjs` | 71/71 PASS, 0 FAIL |
| `qa/epic-2e-p1c-candidate-test.mjs` | 86/86 PASS, 0 FAIL |
| `qa/epic-2e-p1c-r2-candidate-lifecycle-order-test.mjs` | 19/19 PASS, 0 FAIL |
| `qa/epic-2e-p1c-r3-user-edit-xmp-export-test.mjs` | 39/39 PASS, 0 FAIL |
| **Full static suite** (`qa/run-static-suites.mjs`, 69 suites) | **69/69 suites PASS, exit 0** — every suite individually re-run and confirmed this round (see run log below), including all P1A/P1B/P0.8A/RCM/N1-N5/O/Calibration Lab/i18n suites unrelated to this round's own files |

### Full static suite — per-suite confirmation (chunked due to real runtime; every suite individually confirmed PASS)

All 69 registered suites in `qa/run-static-suites.mjs` were run to completion this round (in slices, due to the combined ~3-minute real runtime of the heaviest suites) — every suite reported its own internal `N/N PASS, 0 FAIL` (or, for the 3 pre-existing Browser-dependent static self-tests, the honest `BROWSER_BINARY_UNAVAILABLE` decision that suite has always reported in this sandbox, unrelated to this round). No suite outside `qa/epic-2e-p1e-color-intelligence-test.mjs` (test 87 fix only) and the two new P1E R3 files required any change.

## Production Lock re-verification

- `qa/baselines/lufa42-production-lock-manifest.json` regenerated twice
  this round (once after `single-image-orchestrator.js` was edited,
  once more after `ui/app.js`/`index.html` were also final) — now 164
  locked files, confirmed by a THIRD, final regeneration producing a
  byte-for-byte identical `files` hash map (0 diffs) — no untracked
  drift exists at delivery time.
- `qa/baselines/epic-2e-n1-production-invariant.json`'s `ui/app.js`
  hash updated to the file's real, current SHA-256
  (`18f38ed653f7893c0042f330818ab350949f3aa9219046cc37d7a0b0c73b744a`),
  independently re-verified via a fresh `crypto.createHash` computation
  during this round's own test-file verification (test 54 of the new
  R3 suite).
- Production safety locks (`productionSource=legacy`,
  `productionWrite=false`, `controlledV2Apply=false`,
  `xmpWriteAllowed=false`, `productionActivationAllowed=false`)
  confirmed unchanged — every regression suite re-run above includes
  its own assertion of these flags, all passing.

## Root cause and mismatched-parameter findings

See `P1E_R3_COLOR_VALUE_PARITY_AUDIT.md` for the full, source-verified
investigation. Summary: for P1E-authored (auto-generated) color
values, no UI-vs-Lightroom divergence is currently reachable (P1E's
own BOUNDS are proven strictly tighter than every corresponding
`quickSafetyClamp()` hard cap for every clamp-guarded field family).
The one real, reproducible divergence scenario is a manual slider edit
past P1E's bounds but within the DOM's looser range — now checkable
via the new Advanced Diagnostics panel and `computeExportParity()`.
A separate, genuine latent defect (unrounded fractional color values
reaching the XMP verbatim) was found and fixed at the source
(`_roundClean()`).

## Mutation test results

All 7 required mutation scenarios caught, each with an exact
diagnostic reason, split across the two real detection layers this
codebase actually has:

| # | Mutation | Caught by | Result |
|---|---|---|---|
| M1 | Red Saturation → 40 (past skin cap) after commit | `computeExportParity()` | PASS |
| M2 | Green Saturation → 55 (past color cap) | `computeExportParity()` | PASS |
| M3 | Red/Orange Luminance swapped in generated XMP | P1D Fidelity Gate | PASS |
| M4 | Calibration Blue Saturation sign flipped in XMP | P1D Fidelity Gate | PASS |
| M5 | Grading Hue changed after XMP already generated (stale export) | P1D Fidelity Gate | PASS |
| M6 | Stale Candidate ticket used after newer generation active | Orchestrator (`STALE_GENERATION`) | PASS |
| M7 | `crs:SaturationAdjustmentRed` modified directly in XMP | P1D Fidelity Gate | PASS |

## Browser QA (honest scope)

Attempted via the project's established Navigation-Free In-Memory
Harness (`qa/helpers/playwright-lumixa-test-runtime.mjs`), new script
`qa/epic-2e-p1e-r3-browser-qa.mjs`, covering 7 required scenarios
(real image upload → Ready, Advanced Diagnostics panel present +
populated, QA snapshot bridge intact, real XMP download, Color
Intelligence attributes present in the generated XMP, zero
console/page errors). **Result: `BROWSER_BINARY_UNAVAILABLE`** — no
Chromium executable is present in this sandbox at delivery time
(`detectBrowserExecutable()` returned `available:false`), consistent
with every prior round's honest reporting when this environment lacks
a browser binary. The script and its 7 scenario assertions are
complete and ready to run in any environment where Chromium is
installed; result recorded verbatim in
`qa/epic-2e-p1e-r3-browser-qa-result.json`, never fabricated.

## Lightroom manual verification

Not performed automatically — no Lightroom license/binary available
in this environment. See
`P1E_R3_LIGHTROOM_MANUAL_VERIFICATION_GUIDE.md` for the required
human steps. Stated honestly, per the round's explicit instruction not
to fabricate Lightroom QA.
