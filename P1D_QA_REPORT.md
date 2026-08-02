# P1D — QA Report

## R2 — Full static suite regressions found in R1 and fixed

R1's QA report reported the *delegated* regression suites (the ones
`qa/epic-2e-p1d-xmp-fidelity-gate-test.mjs` itself spawns, plus a
manually-selected list of P1A/P1B/P1C/N1/P0.8A/Production-Lock
suites) as clean, and that claim was accurate for those specific
suites. It did **not** constitute running the full aggregate
`node qa/run-static-suites.mjs` (67 suites, everything in the
project's history), which R1 never completed — the honest
"environment timeout" note in R1's report explained why, but the
report should have stated plainly that the full aggregate had not
actually been run to a verified exit code, rather than implying
general cleanliness. Running it for real (see methodology below)
surfaced exactly 2 genuine regressions, both introduced by P1D:

1. **`qa/epic-2e-j-locale-switch-rerender-static-test.mjs`** (28/29 →
   now 29/29) — this suite asserts that every function called inside
   `rerenderCurrentUiForLocale()` is on a reviewed allowlist of pure,
   side-effect-free re-render functions. P1D's `renderXmpFidelityStatus()`
   call (added to re-render the Fidelity status line's text on a
   language switch, without rerunning analysis or reserializing) was
   never added to that allowlist, so the suite correctly flagged it as
   an unreviewed new call.
   **Fix**: verified by direct source inspection that
   `renderXmpFidelityStatus()` — when called from
   `rerenderCurrentUiForLocale()` — only calls
   `document.getElementById`/`document.createElement`/`.appendChild`
   and the centralized `t()` lookup, reading exclusively from the
   already-stored `state.lastXmpFidelityUiStatus` /
   `state.lastXmpFidelityReport` / `state.lastXmpFidelityXml`. It never
   calls `serializeXMP()`, `runXmpFidelityCheck()`, `downloadXMP()`,
   `runAnalysis()`, or `buildAndCommitCandidate()`, and performs no
   network/file I/O. Added `'renderXmpFidelityStatus'` to the
   allowlist in `qa/epic-2e-j-locale-switch-rerender-static-test.mjs`
   with a written justification — the only change made to that file.
2. **`qa/epic-2e-j-i18n-visible-text-audit-static-test.mjs`** (18/20 →
   now 20/20) — flagged `icon.textContent = 'hourglass_top'` (set
   inside `renderXmpFidelityStatus()` while a Fidelity check is
   running) as visible English prose, because the detector requires
   ≥2 alphabetic words to count as prose and the snake_case
   `hourglass_top` splits into two. The adjacent icon glyphs in the
   same function (`verified`, `warning`, `error`) are single words and
   were never flagged. No existing icon-rendering helper exists in
   this project to route Material Symbols glyph names through (the
   other four glyphs use the identical raw
   `icon.textContent = '...'` pattern) — there was no "convention" to
   reuse.
   **Fix**: added a single, individually-justified entry for
   `hourglass_top` to `FILE_ALLOWLIST['ui/app.js']` in
   `qa/i18n/visible-text-audit-allowlist.mjs`, explaining it is a
   Material Symbols icon glyph identifier, not photographer-facing
   text (the visible label text next to it is sourced from
   `t('appShell.xmpFidelityChecking', ...)`, not this string). The
   allowlist total grew from 9 to 10 entries (bound is 40). The
   detector's matching logic itself was not changed.

### Full static suite verification methodology (R2)

`node qa/run-static-suites.mjs` cannot complete within this tool's
hard 45-second single-command timeout (confirmed: the timeout cannot
be raised past 45000ms, and background/`nohup`'d processes do not
survive past the end of the launching call because each shell call
runs in its own torn-down PID namespace). Measured wall-clock time for
all 67 suites run sequentially: **63.9 seconds**.

To verify the aggregate's actual exit code without being able to
execute the single command in one shot, every one of the 67 suites in
`STATIC_SUITES` was extracted from `qa/run-static-suites.mjs` in its
exact declared order and run individually
(`node <suite-path>`, capturing its real process exit code) across
several chunked tool calls. `qa/run-static-suites.mjs`'s own exit
logic (read directly from its source) is exactly: `spawnSync` each
suite in that same list and order, in-process; if any exits non-zero,
set `anyFailed = true`; exit `1` if `anyFailed`, else exit `0`. There
is no additional aggregate-only check beyond that loop. Running each
suite individually via `node <suite>` is process-identical to what
`spawnSync(process.execPath, [suite])` does internally.

**Result: all 67/67 suites exited 0.** Raw exit-code/timing log saved
at `qa/baselines/p1d_r2_full_static_suite_results.txt` (format:
`<exit_code> <milliseconds> <suite path>`, one line per suite, in
run order). This makes `node qa/run-static-suites.mjs`'s exit code
deterministically `0` per its own source logic above — it was not
possible to also capture the single aggregate command's own process
exit code directly in this environment, so this is the strongest
verification obtainable here, not a substitute for it.

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
| `qa/epic-2e-j-locale-switch-rerender-static-test.mjs` (R2 fix) | 29/29 PASS |
| `qa/epic-2e-j-i18n-visible-text-audit-static-test.mjs` (R2 fix) | 20/20 PASS |
| **All 67 suites in `qa/run-static-suites.mjs`, run individually in declared order (R2)** | **67/67 exit 0** |

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
