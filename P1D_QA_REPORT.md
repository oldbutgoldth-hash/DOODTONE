# P1D — QA Report

## Static / integration tests

`node qa/epic-2e-p1d-xmp-fidelity-gate-test.mjs` — **71/71 PASS, 0
FAIL**, run against the real production modules (`serializeXMP`,
`quickSafetyClamp`, `candidateToLegacyPreset`, the real orchestrator,
the real Candidate Store). Covers: parser accept/reject/safety (8),
property-map coverage (3), export-preset creation (2), Single
Serialization Rule (5), full round-trip fidelity for every
Basic/WB/Presence/Detail/Parametric/HSL/Grading/Calibration/Curve
field (7 checks spanning 62 individual property comparisons), missing/
mismatched/invalid-value FAIL cases (5), PASS/PASS_WITH_WARNINGS/FAIL
policy (3), session integration and staleness (7), user-edit
invalidation and revision tagging (6), never-reruns-analysis proof
(2), USER_EDITED Candidate support (1), edited-value round-trips (3),
transactional-rejection isolation (1), trace events + error codes (3),
UI wiring (3), i18n coverage (1), and 7 mutation tests.

## Mutation tests (7/7, all against a genuinely generated XMP string; production serializer never altered)

| # | Mutation | Result |
|---|---|---|
| 1 | Remove `crs:Exposure2012` entirely | FAIL / REQUIRED_PROPERTY_MISSING |
| 2 | Change `crs:Tint` value | FAIL / PROPERTY_VALUE_MISMATCH |
| 3 | Swap Orange/Yellow HSL saturation values | FAIL (both channels reported as mismatches) |
| 4 | Reorder Tone Curve points | FAIL / INVALID_CURVE |
| 5 | Replace a number with NaN-like text | FAIL |
| 6 | Change `crs:ProcessVersion` | still PASS (correctly not a compared field) |
| 7 | Strip the `crs:` namespace prefix from Exposure | FAIL / REQUIRED_PROPERTY_MISSING |

## Delegated regression re-verification (all clean after this round's manifest regeneration)

| Suite | Result |
|---|---|
| `qa/epic-2e-p1c-r3-user-edit-xmp-export-test.mjs` | 39/39 PASS |
| `qa/epic-2e-p1c-r2-candidate-lifecycle-order-test.mjs` | 19/19 PASS |
| `qa/epic-2e-p1c-candidate-test.mjs` | 86/86 PASS |
| `qa/epic-2e-p1b-analysis-report-test.mjs` | PASS |
| `qa/epic-2e-p1a-single-image-session-test.mjs` | PASS |
| `qa/epic-2e-p1a-r3-upload-lifecycle-integration-test.mjs` | 16/16 PASS |
| `qa/epic-2e-n1-core-color-match-integration-static-test.mjs` (RCM) | 6/6 PASS |
| `qa/epic-2e-n1-n5-integration-static-test.mjs` (RCM) | 5/5 PASS |
| `qa/epic-2e-p0-8a-preview-artifact-repair-static-test.mjs` | 22/22 PASS |
| `qa/epic-2e-j-r2-phase-e-static-test.mjs` (145-file Production Lock) | 92/92 PASS |

Before manifest regeneration, exactly 5 files showed a hash mismatch
in the Production Lock check — all 5 are files this round legitimately
edited (`core/single-image/single-image-orchestrator.js`,
`core/single-image/single-image-session.js`, `ui/i18n/en.js`,
`ui/i18n/th.js`, `index.html`) — and 1 file
(`ui/app.js`, already an allowed-geometry exclusion) in the N1
Production Invariant baseline. No unexpected file appeared in either
diff. Both baselines were regenerated for exactly those entries; every
other tracked file verified byte-identical.

## Browser QA — honest scope

`npx playwright install chromium` fails with `Download failed: server
returned code 403 body 'Connection blocked by network allowlist'`,
reproducing the identical finding from every prior P1A/P1B/P1C round.
No system Chrome/Chromium binary is present
(`which chromium chromium-browser google-chrome google-chrome-stable`
→ empty). The 7 required scenarios below could not be executed in a
real browser this round:

1. Upload + download with no edits (expect PASS/PASS_WITH_WARNINGS + download) — **NOT VERIFIED (browser)**, verified at the module level via test 16 (full pipeline round-trips clean).
2. Edit Exposure, download again (expect USER_EDITED, cleared old report, new check, matching readback, download) — **NOT VERIFIED (browser)**, verified via tests 37-39, 42.
3. Edit HSL Orange Saturation (expect new revision, new report, matching value, download) — **NOT VERIFIED (browser)**, verified via test 43.
4. Edit Temperature + Tint (expect finite values, matching readback, download) — **NOT VERIFIED (browser)**, verified via test 44.
5. Synthetic mismatch in dev mode (expect Gate reports mismatch, download blocked, Candidate intact) — **NOT VERIFIED (browser)**, verified via tests 26-29, 45, and the 7 mutation tests.
6. Upload Image B during Image A validation (expect A's report stale/cannot trigger download, B active) — **NOT VERIFIED (browser)**, verified via tests 34-35 (generation-gated rejection at the orchestrator level).
7. Change language (expect Fidelity UI rerenders, no analysis rerun, no Candidate rebuild, no new serialization unless Download is clicked) — **NOT VERIFIED (browser)**. `rerenderCurrentUiForLocale()` now re-renders the Fidelity status line's text from `state.lastXmpFidelityUiStatus`/`state.lastXmpFidelityReport` (set by `renderXmpFidelityStatus()` on every call) when the element is currently visible -- a pure text re-render, wired the same way the existing `successMsg`/Analysis-panel locale re-render blocks are, immediately above it in `ui/app.js`. It never calls `runXmpFidelityCheck()`, `serializeXMP()`, or any Candidate-build function. Verified via source inspection only (no browser); real click-through behavior is unverified.

No fabricated results are reported for any of the 7 scenarios.

## Production Safety Locks

`productionSource = legacy`, `productionWrite = false`,
`controlledV2Apply = false`, `xmpWriteAllowed = false`,
`productionActivationAllowed = false` — all verified unchanged (test
78/86 in `qa/epic-2e-p1c-candidate-test.mjs`, "Bonus" in R3 suite).
The local XMP Fidelity Gate never calls any Production-write function
and never sets any of these flags.
