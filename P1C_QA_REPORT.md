# EPIC 2E-P1C — QA Report

## 1. Static / integration test results

- **New P1C suite** (`qa/epic-2e-p1c-candidate-test.mjs`): **86/86 PASS,
  0 FAIL**. Runs against the real production modules (`core/single-image/
  candidate/*.js`, `single-image-orchestrator.js`, `single-image-session.js`,
  `single-image-session-store.js`, `core/xmp-validator/index.js`) — no
  Core formula is duplicated inside the test. Covers, at minimum, every
  category the spec requires: schema completeness, built-from-evidence,
  session/store commit + generation gating, stale-Candidate rejection,
  completed/partial Session handling, missing-optional-evidence safe
  defaults, no undefined/NaN/Infinity, real parameter ranges,
  HSL/Grading/Calibration/Detail/Tone-Curve structural completeness,
  Candidate→Slider and Slider→Candidate mapping, single-parameter edits
  + `USER_EDITED` + no-rerun + feedback-loop guard, reset-one/reset-all,
  new-upload/Reset clearing, stale-image-cannot-overwrite, main export
  no longer calling `readSlidersAsPreset()`, export sourced from a
  validated Candidate, invalid-Candidate blocks export, Legacy Preset
  Adapter round-trip + pre/post `quickSafetyClamp()` numeric equality,
  required trace events, Report/Candidate sibling independence, and
  re-verification that P1A/P1B/P0.8A-RCM/Production-lock suites still
  pass.
- **Full existing static suite** (`npm test` / `node
  qa/run-static-suites.mjs`, 64 registered suite files including the new
  P1C one): **PASS, 0 FAIL** across every suite, confirmed by a full run
  after every fix in this EPIC landed.
- **ESM syntax gate** (`node tools/esm-syntax-gate.mjs`): **302/302
  files parsed cleanly.**

### Regressions found and fixed during this EPIC

Three legitimate, expected hash-manifest drifts were found (not code
regressions) and corrected:

1. `qa/baselines/epic-2e-n1-production-invariant.json` — the `ui/app.js`
   hash entry needed regenerating (ui/app.js is the one file in that
   manifest P1C is expected to change; every other tracked file —
   the real serializer, validator, mapping engine — verified
   byte-identical).
2. `qa/baselines/lufa42-production-lock-manifest.json` — 5 of 145
   locked-file hashes needed regenerating
   (`single-image-orchestrator.js`, `single-image-session.js`,
   `ui/i18n/en.js`, `ui/i18n/th.js`, `index.html` — exactly the files
   P1C legitimately edits; the other 140 remained byte-identical).
3. `qa/epic-2e-j-locale-switch-rerender-static-test.mjs` — its
   allowlist of known-pure re-render function calls needed
   `updateCandidateStatusBadge` added (verified pure: text/color only,
   reads only `state.lastCandidateStatus`, never rebuilds the
   Candidate).

All three were re-verified against the pre-P1C P1B baseline (confirmed
to pass cleanly there) before being changed here, to rule out a
pre-existing/unrelated defect being masked.

## 2. Node-level module-boot smoke test

`ui/app.js` (a browser-only, DOM-driven controller) was loaded
end-to-end under plain Node with a permissive DOM/canvas shim
(`document`/`window`/`canvas.getContext` stand-ins) purely to prove the
new P1C wiring — the boot-time slider-edit listener loop
(`getSupportedSliderIds()` + `addEventListener('input', ...)`), the
Candidate-status-badge initialization, and every new import — evaluates
without a runtime error. This is a structural smoke test, not a
behavioral one; it does not exercise real image upload/analysis/export.

## 3. Browser QA — honest scope statement

**Chromium was not available in this environment.** Verified concretely,
not assumed:

- `npx playwright install chromium` failed: `Download failed: server
  returned code 403 body 'Connection blocked by network allowlist'`
  (the sandbox's outbound network allowlist blocks the Playwright CDN).
- No system-installed Chromium/Chrome binary was found on `PATH` or in
  common install locations (`/usr/bin/chromium*`, `/usr/bin/google-chrome*`).
- `playwright` (npm package) is installed and importable
  (`chromium.launch` exists as a function), but launching fails with
  `Executable doesn't exist` for the same reason — no downloaded binary.

**The following 8 required real-image Browser QA scenarios were NOT
run and their outcomes are UNKNOWN:**

1. Upload a portrait — verify Report + Candidate + sliders populate and
   no duplicate analysis runs.
2. Edit the Exposure slider — verify the Candidate changes, status
   becomes `USER_EDITED`, and the analysis-run counter is unchanged.
3. Edit HSL Orange Saturation — verify only that one Candidate path
   changes, with no full rebuild and no re-run.
4. Generate XMP — verify the current Candidate's values (including any
   manual edits) appear in the exported file and the DOM was never
   re-read.
5. Upload a second image (Image B) — verify Image A's Candidate and
   sliders clear immediately and cannot be overwritten by a
   late-resolving Image A callback.
6. Change language — verify the Candidate is unchanged and no analysis
   re-runs.
7. Reset to Auto — verify Auto values are restored and the Report is
   unaffected.
8. Open Reference Color Match — verify its existing behavior is
   unchanged.

**What substitutes for this in the current package:** the 86-case
`qa/epic-2e-p1c-candidate-test.mjs` suite exercises the real underlying
logic for every one of these 8 scenarios at the module level (Candidate
build/commit, single-parameter slider edits with `USER_EDITED` +
revision bump, stale-generation/new-image rejection, XMP export
blocking/sourcing, Reset-to-Auto, trace-event no-rerun proof, and RCM/
P0.8A file-hash non-interference) — but this is not a substitute for
real pixel-level, real-DOM-event Browser verification. Anyone running
this package in an environment with Chromium available should run
`npm run test:browser` (or a dedicated P1C Playwright script following
the same pattern as `qa/epic-2e-p1b-*` Browser suites) before treating
the 8 scenarios above as confirmed.

## 4. Production Lock re-verification

- `productionSource=legacy`, `productionWrite=false`,
  `controlledV2Apply=false`, `xmpWriteAllowed=false`,
  `productionActivationAllowed=false` — unchanged; re-verified by
  `qa/epic-2e-n1-core-color-match-integration-static-test.mjs`'s
  `N1 production lock contract is fail-closed` case and by the P1C
  suite's own check 78.
- `core/preset-engine/index.js`, `core/xmp-validator/index.js`,
  `core/lightroom-mapping-engine/index.js`, `ui/ui-engine.js`,
  `core/color-match/reference-xmp-generator.js` — confirmed
  byte-identical (SHA-256) to the pre-P1C baseline.
- 140 of 145 files in the general Production-lock manifest confirmed
  byte-identical; the 5 legitimately-changed files (Candidate/Session
  wiring, i18n, index.html badge) have their hashes correctly
  regenerated and documented in `P1C_MODIFIED_FILES.md`.

## 5. Pre/post XMP numerical equivalence

Verified programmatically (P1C suite check 53): running the existing,
unmodified `quickSafetyClamp()` on (a) the original flat raw preset and
(b) that same preset round-tripped through `candidate-builder.js` →
`legacy-preset-adapter.js`, produces **identical numeric values for
every Lightroom field** — exposure, contrast, white balance, every HSL
channel, every Color Grading zone, every Calibration primary. No
difference to document.

## 6. Final acceptance status

All items verifiable without a browser are confirmed passing. Real-
browser, real-image verification (item 3 above) remains outstanding due
to environment constraints and is called out explicitly rather than
assumed.


---

# R2 — Candidate Runtime Lifecycle Order Fix

## R2.1 Bug and root cause

Real browser symptom on every real analysis run: the Candidate panel
showed **"สร้างค่า AUTO-TUNE ไม่สำเร็จ" / "Auto-Tune Candidate build
failed."** Root cause (confirmed by reading the actual pre-fix
`ui/app.js` source, not assumed): `buildAndCommitCandidate()` was
called immediately after `commitCandidate()`, roughly 500 lines
*before* `completeAnalysis()` ran in the same function. At that call
site `session.status` was still `ANALYZING`, so
`buildAndCommitCandidate()`'s own (correct, preserved) terminal-status
guard always returned `{ committed: false, reason:
'SESSION_NOT_TERMINAL' }`, and the existing `else` branch unconditionally
set the Candidate badge to `FAILED`. This was 100% reproducible on
every real analysis run, not an intermittent race.

## R2.2 Fix

The Candidate build/validate/store-commit/slider-sync block was moved
from immediately after `commitCandidate()` to immediately after
`const finalSessionStatus = singleImageOrchestrator.completeAnalysis(analysisTicket);`,
gated on `finalSessionStatus === 'COMPLETED' || finalSessionStatus === 'PARTIAL'`
— the identical pattern already used by the adjacent, already-correct
`buildAndCommitReport()` call. `commitCandidate()` itself (which
populates `session.candidateRaw`) was left in its original location, so
`candidateRaw` is still available before Session finalization.
`buildAndCommitCandidate()`'s own terminal-status guard inside
`core/single-image/single-image-orchestrator.js` was **not modified** —
the fix is a call-site reordering in `ui/app.js` only. Full detail:
`P1C_R2_RUNTIME_LIFECYCLE_FIX.md`.

## R2.3 New static/integration test

`qa/epic-2e-p1c-r2-candidate-lifecycle-order-test.mjs` — **19/19 PASS,
0 FAIL** against the fixed source. Combines source-order assertions
against the real `ui/app.js` (proving the shipped UI file itself calls
`commitCandidate → completeAnalysis → buildAndCommitCandidate` in that
order, and that the build is unreachable while ANALYZING) with
functional assertions that exercise the real
`single-image-orchestrator.js` / `single-image-session-store.js` /
`candidate/candidate-store.js` modules directly (COMPLETED builds
exactly one Candidate, PARTIAL still builds, FAILED never attempts a
build, a stale/superseded ticket never attempts a build or touches the
new active Candidate, the store always reflects only the most recent
successful analysis).

**Verified to fail on the pre-fix source**: the pre-fix `ui/app.js` was
reconstructed in a scratch location (by mechanically reversing the two
patches applied for this fix) and the same test file was run against
it with a path override — result: **15/19 PASS, 4 FAIL** (the 4
source-order/structural checks that directly encode the fix failed, as
expected; the 4 pre-existing functional checks against the
orchestrator itself passed unchanged, since that module's guard was
never broken — only its caller's ordering was). This confirms the new
test is a genuine regression guard for this specific defect, not a
tautology.

## R2.4 Full regression re-verification

- `qa/epic-2e-p1c-candidate-test.mjs`: **86/86 PASS, 0 FAIL**
  (unchanged from R1; re-run after the fix).
- `qa/epic-2e-p1c-r2-candidate-lifecycle-order-test.mjs` (new): **19/19
  PASS, 0 FAIL**.
- `qa/epic-2e-p1b-analysis-report-test.mjs`: **39/39 PASS, 0 FAIL**.
- `qa/epic-2e-p1a-single-image-session-test.mjs`: **25/25 PASS, 0
  FAIL** (includes the self-contained Reference Color Match invariant
  check).
- `qa/epic-2e-p1a-r3-upload-lifecycle-integration-test.mjs`: **16/16
  PASS, 0 FAIL**.
- `qa/epic-2e-p0-8a-preview-artifact-repair-static-test.mjs`: **22/22
  PASS, 0 FAIL**.
- Full static suite (`node qa/run-static-suites.mjs`, 75 registered
  suite files including both new-in-P1C and new-in-R2 tests): **PASS,
  0 FAIL** across every suite.
- `qa/epic-2e-n1-core-color-match-integration-static-test.mjs` +
  `qa/epic-2e-n1-n5-integration-static-test.mjs` (Reference Color
  Match / Production invariant hash suites): **PASS, 0 FAIL** after
  regenerating the `ui/app.js` hash entry in
  `qa/baselines/epic-2e-n1-production-invariant.json` (the only file
  that manifest tracks which R2 legitimately changes — every other
  tracked file remains byte-identical).
- `qa/epic-2e-j-r2-phase-e-static-test.mjs` (Production Lock manifest,
  145 files): **92/92 PASS, 0 FAIL, 0 NOT_TESTED** — `ui/app.js` is
  listed under that manifest's `allowedGeometryFiles` (deliberately
  excluded from the locked-hash set as a file expected to change), so
  **no manifest update was needed or made** for this file in
  `qa/baselines/lufa42-production-lock-manifest.json`.

## R2.5 Browser QA — honest scope statement (unchanged constraint)

**Chromium remains unavailable in this environment**, re-verified
concretely for this R2 round: `npx playwright install chromium` failed
again with `Download failed: server returned code 403 body 'Connection
blocked by network allowlist'`; no system Chromium/Chrome binary exists
on `PATH` or in common install locations. The 5 required real-browser
scenarios for this fix (upload/analyze → no red failure message,
Candidate becomes VALID/VALID_WITH_WARNINGS, sliders populate; edit
Exposure → USER_EDITED, no re-analysis; edit HSL Orange Saturation →
single-parameter update only; Download XMP → sourced from the current
Candidate including manual edits; upload Image B before Image A
finishes → Image A aborted/blocked, Image B remains active) were **NOT
run and their real-browser outcomes are UNKNOWN.** The new
`qa/epic-2e-p1c-r2-candidate-lifecycle-order-test.mjs` suite exercises
the real underlying orchestrator/session-store/candidate-store logic
for each of these 5 scenarios at the module level, and is a genuine,
verified-to-fail-before-fixed regression guard for the specific defect
reported — but this is not a substitute for real pixel-level, real-DOM
Browser verification. Per the explicit instruction for this round: this
completion is **not** claimed to include confirmed real-browser
Candidate creation — only that Candidate creation succeeds after
`completeAnalysis()` in the real, unmodified production code path, as
proven by direct execution of that code path in R2.4 above.
