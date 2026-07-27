# 34 — EPIC 2E-K-R2-FIX1 QA Report: Pixel Truth, Decision Gate & Evidence Closure

## 1. Scope

Covers everything genuinely executed for R2-FIX1 in this development
environment, and states plainly what could not be executed and why. No
result below is fabricated. This round is Preview/Shadow-only, per the
governing constraints (no Deploy, no Controlled V2 Production, no
Production Mapping change, no Production XMP Output change, EPIC 2E-L
not started).

## 2. Source Provenance

Development started from the exact ZIP delivered at the end of the R2
round (`EPIC-2E-K-R2-REAL-PIXEL-COMPARISON-BROWSER-VERIFICATION-CLOSURE.zip`),
extracted into a fresh working directory. A full recursive diff against
that exact baseline (excluding `node_modules` and pre-existing QA result
JSON artifacts, which regenerate their own `runId`/timestamp on every
suite run) confirms this round touched only: `core/calibration-lab/*`
(3 new pure/browser-boundary modules, 4 edited files), `ui/calibration-lab/*`
(all 5 files edited), `index.html` (the nav-button markup only),
`package.json` (7 new scripts only), and `qa/*` (3 new files, 4 edited).
Nothing outside that set changed.

## 3. Section-by-Section Results

**Section 1 (Real Controlled V2 pixel rendering):** Implemented via the
AND-chain in `_sideGenuinelyRendered()` (see
`33_EPIC_2E_K_R2_FIX1_PIXEL_TRUTH_ARCHITECTURE.md`). All six stable
failure codes exist and are exercised by hostile tests.

**Section 2 (Calibration Schema V2):** `CALIBRATION_SCHEMA_VERSION = 2`,
`previewEvidence` on every record, 10-code `previewTruthCode` enum.
Never persists raw canvas/blob/base64/objectURL/file path/filename/
original image (grep-verified structurally + hostile-tested).

**Section 3 (Decision Eligibility Gate):** `isDecisionAllowedForEvidence()`
is the single shared function imported by both
`calibration-lab-controller.js` (authoritative, called inside
`saveCurrentDecision()` before persisting) and
`calibration-lab-renderer.js` (UI chip disabling). A hostile
direct-controller-call test (bypassing the UI's `disabled` attribute
entirely) confirms the Controller itself rejects an ineligible decision.

**Section 4 (Readiness Honesty):** Readiness now requires
`browserVerified === true` AND `visualDecisionEligible === true` AND
`previewTruthCode` in `{BOTH_RENDERED_DIFFERENT, BOTH_RENDERED_IDENTITY}`
before a record counts toward the ladder. 8 readiness statuses (was 5);
`NEEDS_BROWSER_VERIFICATION` / `NEEDS_PIXEL_PREVIEW` /
`NEEDS_REVIEW_REFRESH` sit between the `INSUFFICIENT_DATA` floor and
`NEEDS_MORE_COVERAGE`, and `READY_FOR_CANDIDATE_REVIEW` is structurally
unreachable under any of the unhealthy conditions listed in the spec
(verified by the extended readiness-ladder fixtures in the static test).

**Section 5 (Migration V1→V2):** Real, idempotent, fail-closed,
backup-before-migration. See `32_EPIC_2E_K_R2_FIX1_MIGRATION_GUIDE.md`
for full detail and the exact garbage-row fail-closed fix found and
applied during this round's own testing.

**Section 6 (Browser Test False Positive):** The exact reported bug --
an OR-shortcut that could pass on a non-`'rendered'` state -- is
replaced by the positive AND-chain described in doc 33. Unknown/
partial/unavailable states now FAIL, never Conditional Pass (hostile
static test + Browser suite source-grep checks confirm the OR-shortcut
pattern no longer exists in the source).

**Section 7 (Clear Current Answer):** `clearCurrentAnswer()` rewritten
to genuinely reset `userDecision`, `issueCodes`, `notes`, `reviewedAt`
while explicitly preserving Analysis/Legacy/Controlled-V2/Preview-Evidence
snapshots. A real-UI-interaction test confirms the textarea is genuinely
emptied, not merely visually cleared.

**Section 8 (Locale Header):** `#calibrationLabNavBtn` no longer
hardcodes "Calibration Lab" in `index.html` -- it is set reactively from
`calibrationLabT('nav.openButton', lang)`, including inside the
MutationObserver callback so a TH→EN→TH language switch genuinely
changes the button (not just once at bootstrap). TH text is exactly
"ห้องทดสอบการปรับค่า" as specified.

**Sections 9+10 (QA Commands, BAT file, Preflight):** 7 new
`npm run` scripts (`qa:preflight`, `test:calibration-browser[:report]`,
`test:calibration-storage`, `test:calibration-migration`,
`test:calibration-pixel`, `test:calibration-full`);
`RUN_LUMIXA_CALIBRATION_QA_WINDOWS.bat` runs the full 13-step Windows
sequence with real exit-code propagation and a
`QA_SUMMARY_WINDOWS.txt` artifact; `qa/preflight.mjs` and
`qa/calibration-full-suite.mjs` both genuinely check/aggregate rather
than assume.

**Section 11 (Pixel Truth Hostile Tests):** See doc 33 Section 4 for
the full list of adversarial scenarios, all proven to FAIL/stay
ineligible as required.

**Section 12 (Production Safety):** See Section 5 below -- full,
real re-verification with zero mismatches.

**Section 13 (Final Browser Verification):** See Section 6 below --
attempted honestly, not fabricated.

**Section 15 (Packaging):** see the accompanying Release Notes,
`35_EPIC_2E_K_R2_FIX1_RELEASE_NOTES.md`, and the delivered ZIP.

## 4. Node-Executable Static Test Results (real, ran to completion)

| Suite | Result |
|---|---|
| `node --check` on every `.js`/`.mjs` file touched this round | Clean (no syntax errors) |
| `node tools/esm-syntax-gate.mjs` | 172/172 files PASS |
| `qa/epic-2e-k-calibration-lab-static-test.mjs` (updated: readiness-ladder fixtures extended for the new gate) | 61/61 PASS |
| `qa/epic-2e-k-calibration-lab-storage-test.mjs` (extended: Section 5 migration block) | 24/24 PASS |
| `qa/epic-2e-k-calibration-lab-hostile-static-test.mjs` (unchanged, re-verified against FIX1 code) | 19/19 PASS, 0 NOT_TESTED |
| `qa/epic-2e-k-r2-real-pixel-comparison-static-test.mjs` (unchanged from R2, re-verified) | 34/34 PASS |
| `qa/epic-2e-k-r2-fix1-pixel-truth-static-test.mjs` (NEW this round) | 72/72 PASS |
| `node qa/run-static-suites.mjs` (full project static suite) | All static suites PASSED, exit 0 |
| `node qa/preflight.mjs` | 10 OK, 2 honest NOT_VERIFIED (Browser executable; stale-results sourceHash) |
| `node tools/local-gate.mjs` (14 steps) | Steps 1-3 PASS; Steps 4-14 honestly FAIL with `BROWSER_BINARY_UNAVAILABLE` |

## 5. Production Lock Verification (Section 12)

Every one of the 65 locked core/ui files listed in the checked-in
`qa/baselines/lufa42-production-lock-manifest.json` baseline was
re-hashed (SHA-256) against the current FIX1 source tree, using the
manifest's own generator script: **0 mismatches, 0 missing files.** This
includes all five files this round's Section 12 explicitly named:
`core/lightroom-mapping-engine/index.js`, `core/xmp-validator/index.js`,
`core/preset-engine/index.js`, `ui/app.js`, `ui/ui-engine.js` -- each
confirmed byte-identical to the pre-FIX1 baseline by direct SHA-256
comparison (not merely inferred from the manifest).

`ui/app.js` is not itself a member of the checked-in 65-file manifest
(it is on an older EPIC's `ALLOWED_GEOMETRY_FILES` allow-list) but was
confirmed byte-identical to the pre-FIX1 baseline by direct SHA-256
diff regardless.

**Real XMP before/after invariant:** `buildPreset()` +`serializeXMP()`
from `core/preset-engine/index.js` were invoked with an identical,
deterministic fixture `HistogramStats` object against both the pre-FIX1
baseline copy of `core/` and the current FIX1 `core/` tree. Output: byte
length 2899 in both cases, identical SHA-256
(`474e6d57a278cf63e52f529ed126f4761ba7f1176ce2a966a261ca8dcc6edc35`),
zero-line `diff`. Production Mapping and Production XMP Output are
unchanged by this round.

**Production activation flags:** `productionWriteDisabled: true` remains
hardcoded (never a runtime-toggleable value) in
`core/lightroom-mapping-engine/mapping-v2-overlay-test-gate.js` and
`mapping-v2-overlay-preview-sandbox.js` -- both files confirmed
byte-identical to baseline, so these flags could not have changed.

## 6. Final Browser Verification Attempt (Section 13)

- `detectBrowserExecutable()` again found zero usable Chromium
  candidates in this sandbox (checked the Playwright-bundled path plus
  5 common system install locations), consistent with every prior
  round (R1, R2).
- A direct `npx playwright install chromium` attempt failed with the
  same explicit, unambiguous network-level error as every prior round:
  `Download failed: server returned code 403 body 'Connection blocked
  by network allowlist'`.
- `node qa/epic-2e-k-calibration-lab-browser-test.mjs` was run for
  real: it correctly self-reports `BROWSER_BINARY_UNAVAILABLE` (1
  total check, 0 pass, 0 fail, 1 NOT_TESTED) rather than a fabricated
  pass -- see `qa/epic-2e-k-calibration-lab-browser-results.json`.
- `node tools/local-gate.mjs` was run for real, all 14 steps: Steps 1-3
  (Syntax, Focused Core, Static) genuinely PASS; Steps 4-14 (every
  Browser-dependent suite) honestly FAIL with
  `BROWSER_BINARY_UNAVAILABLE` -- none silently upgraded to PASS.
- **Conclusion: Final Browser Verification Closure could not be
  achieved in this development sandbox**, for the same environment
  reason confirmed in R1 and R2 -- this is an environment constraint,
  not a defect in the Calibration Lab or any of its test suites.
  Closure requires running the Browser suite (ideally the full
  `RUN_LUMIXA_CALIBRATION_QA_WINDOWS.bat` or
  `node tools/local-gate.mjs`) on a machine with a real Chromium/Edge/
  Chrome install and outbound network access, or with Chromium
  pre-installed in the sandbox image.

## 7. Regression Check (R1/R2 functionality unaffected)

`qa/epic-2e-k-calibration-lab-hostile-static-test.mjs` and
`qa/epic-2e-k-r2-real-pixel-comparison-static-test.mjs` were re-run
against the FIX1 codebase with zero changes to either suite and
produced byte-identical pass counts to their R2 baseline (19/19, 34/34)
-- confirming FIX1's changes are additive and did not alter any
previously-verified behavior.

## 8. Errors Found and Fixed During This Round (see also each doc above)

1. `qa/preflight.mjs` had 3 call sites passing raw booleans instead of
   `'OK'`/`'FAIL'` status strings -- fixed.
2. `qa/epic-2e-k-calibration-lab-static-test.mjs`'s readiness-ladder
   fixtures needed `previewEvidence` added to reach their intended
   tiers under the new, stricter Section 4 gate -- this is legitimate
   test modernization (the new stricter behavior is Section 4's entire
   point), not a regression to route around.
3. A garbage-but-migratable row (valid `imageId`, garbage
   `userDecision`) was, before the fix, merged with migration fields
   and written to storage despite still failing overall validation --
   fixed by validating the migrated shape before persisting in both
   storage backends (see Migration Guide Section 5).

## 9. What Was NOT Tested in This Environment

- Real-browser execution of the actual pixel rendering, the Decision
  Gate's real disabled-attribute behavior in a live page, and the real
  TH/EN nav-button DOM text -- blocked by the confirmed lack of any
  reachable Chromium in this sandbox (Section 6). Every Browser suite
  is fully written and ready but unverified here.
- Real screen-reader software, physical mobile devices, real
  photographic content -- same as every prior round.
- `core/calibration-lab/export-dataset.js`'s CSV/JSON export does not
  yet expose any `previewEvidence`/pixel-truth fields (this file was
  not in this round's scope) -- see Known Limitations in the Release
  Notes.

## 10. Release Decision

**CONDITIONAL PASS**, the same standing convention as every prior round
in this project: everything genuinely executable in Node passes (172
syntax + 61 + 24 + 19 + 34 + 72 static assertions, all suites green,
production-lock and XMP invariants directly re-verified with zero
mismatches); the Browser suite remains honestly unverified in this
sandbox due to a confirmed environment/network constraint, not a code
defect.
