# EPIC 2E-P1A — Modified Files

Baseline: EPIC 2E-P0.8A (`LU2DCD~1.ZIP`). Everything below is additive
except `ui/app.js`, `qa/run-static-suites.mjs`, and
`qa/baselines/epic-2e-n1-production-invariant.json`, all three of which
are minimal, targeted edits.

## R3 correction (this revision) — real browser-verified regression

Real browser testing found a deterministic bug: every image upload got
permanently stuck on the loading indicator. Root cause (see
`P1A_UPLOAD_LIFECYCLE_FIX.md` for the full writeup): `ui/app.js`'s
`loadFile()` called `singleImageOrchestrator.beginUpload(file)` BEFORE
`handleReset()`, but `handleReset()` unconditionally calls
`singleImageOrchestrator.resetActiveSession(state)`, which aborts and
clears the active Session — destroying the Session `beginUpload()` had
just created and nulling `activeUploadTicket`. Every subsequent
`img.onload -> runAnalysis()` call then found no ticket and returned
immediately, with no code path to move the UI out of "loading".

Fixed in R3:

- **Edited:** `ui/app.js` — `loadFile()` reordered to call
  `handleReset()` first, then `beginUpload()`, per the required fix.
  Additionally, the new upload's ticket is now captured into a local
  `const uploadTicket` that `img.onload`/`img.onerror` reference
  directly (instead of the shared, reassignable `activeUploadTicket`
  module variable), closing a narrower related race where a
  slow-resolving prior image's callback could fire after a newer
  upload had already reassigned the shared ticket. `runAnalysis()` was
  extended to accept an optional `callerTicket` parameter (default
  `null`, falling back to `activeUploadTicket`) so `loadFile()`'s
  `img.onload` can pass its own captured ticket while
  `handleReanalyze()`'s existing no-arg call site is unchanged in
  behavior.
- **New file:** `qa/epic-2e-p1a-r3-upload-lifecycle-integration-test.mjs`
  (16 cases) — reproduces the real bug using the real orchestrator
  functions in both the broken and fixed call orders, and statically
  confirms the shipped `ui/app.js` source uses the fixed order.
  Verified to FAIL (13/16, exit 1) against the actual R2 `ui/app.js`
  and PASS (16/16, exit 0) against the R3 fix.
- **New file:** `P1A_UPLOAD_LIFECYCLE_FIX.md` — root-cause writeup.
- **Edited:** `qa/run-static-suites.mjs` — registers the new test.
- **Edited:** `qa/baselines/epic-2e-n1-production-invariant.json` —
  `ui/app.js` hash updated again to
  `92dbc5d406eef59254aaa29c2a5b5767cb7709e044bef1199adbcba37cd57472`
  (was `443998f10d132a5736986838c938e93ba915cc222654ef84e4841e60a812c78b`
  in R2), reflecting this intentional, in-scope change. The other 5
  pinned files re-verified byte-identical to the P0.8A baseline before
  this update — see `P1A_QA_REPORT.md` §4.
- **Regenerated:** `qa/baselines/lufa42-production-lock-manifest.json`
  (still 139 files locked — no files added or removed, only content
  hashes for the changed file).
- **Edited:** `P1A_QA_REPORT.md`, `P1A_RELEASE_NOTES.md` — updated to
  describe this fix and its verification.

No Session architecture, Core formula, Candidate/XMP behavior,
Reference Color Match source, P0.8A preview renderer, or Production
lock changed in R3 — confirmed by the same regression suites that
verified R1/R2, all still passing, plus the new test's explicit
Production Lock re-check (§4 of the QA report).

## R2 correction (prior revision)

R1's `qa/epic-2e-p1a-single-image-session-test.mjs` test 25 depended on
an external directory (`../../lumixa_p08a/r1_work`) that existed in the
working session but was **not included in the shipped R1 ZIP**. A fresh
extraction of R1 therefore produced `24/25 PASS, 1 FAIL` and a
non-zero exit from `qa/run-static-suites.mjs` — contradicting R1's own
`P1A_QA_REPORT.md` claim of 25/25 and 62/62. This is fixed in R2:

- **New file:** `qa/baselines/p0-8a-reference-color-match-invariant.json`
  — a pinned SHA-256 baseline for the 8 RCM-exclusive files, generated
  from the verified P0.8A source before any P1A edit, and shipped
  inside the package.
- **Edited:** `qa/epic-2e-p1a-single-image-session-test.mjs` — test 25
  now hashes the current files with Node's `crypto` module and compares
  against the pinned baseline above. No external directory dependency
  remains anywhere in the test suite. Verified to PASS on match, FAIL
  with the exact mismatched filename + expected/actual SHA-256 on a
  content change, FAIL with the exact filename + expected SHA-256 on a
  missing file, and FAIL cleanly (not crash) if the baseline itself is
  missing — see `P1A_QA_REPORT.md` §1a for the three verification
  drills.
- **New files:** `qa/results/epic-2e-p1a-single-image-session-test-r2-output.txt`
  and `qa/results/run-static-suites-r2-output.txt` — saved, real command
  output from both required commands, run both inside the working
  repository and (authoritative) from a standalone extraction of this
  R2 ZIP into an empty directory with no sibling project folders
  present — see §"Fresh-extraction verification" below.
- **Edited:** `P1A_QA_REPORT.md` — corrected to describe the
  self-contained mechanism and to stop claiming results that weren't
  reproducible from the delivered package alone.

No other file changed in R2. P1A Session architecture, `ui/app.js`
integration behavior, Core formulas, Candidate/XMP behavior, Reference
Color Match source, the P0.8A preview renderer, and all Production
locks are untouched — confirmed by re-running test 25 itself (which now
proves RCM's 8 exclusive files are unchanged) plus a diff of every
other file against the R1 package.

## Fresh-extraction verification (R3)

```
$ unzip -q LUMIXA_EPIC_2E_P1A_SINGLE_IMAGE_SESSION_R3.zip -d /tmp/isolated_verify_r3
$ cd /tmp/isolated_verify_r3/LUMIXA_EPIC_2E_P1A
$ node qa/epic-2e-p1a-single-image-session-test.mjs; echo "exit: $?"
... 25/25 PASS, 0 FAIL
exit: 0
$ node qa/run-static-suites.mjs; echo "exit: $?"
... 16/16 PASS, 0 FAIL   (qa/epic-2e-p1a-r3-upload-lifecycle-integration-test.mjs, the new suite)
All static suites PASSED.
exit: 0
$ node qa/epic-2e-p1a-r3-upload-lifecycle-integration-test.mjs; echo "exit: $?"
... 16/16 PASS, 0 FAIL
exit: 0
```

Run from a directory containing nothing but the extracted ZIP contents
— no `lumixa_p08a`, `lumixa_r1`/`r2`, or any other sibling project
folder anywhere on the filesystem the test could have accidentally
resolved against. All three commands exit 0.

## New files (7) — `core/single-image/`

| File | Lines (approx) | Purpose |
|---|---|---|
| `core/single-image/single-image-session.js` | ~230 | Session factory, status/module-state enums, `EVIDENCE_KEYS`, shape validation, mutation helpers |
| `core/single-image/single-image-session-store.js` | ~90 | Single-slot active-Session registry, generation-ownership choke-point (`updateActiveSession`) |
| `core/single-image/single-image-analysis-profile.js` | ~280 | Declarative `SINGLE_IMAGE_FULL` module table (23 real Core modules) |
| `core/single-image/evidence-normalizer.js` | ~75 | Wraps raw Core results into the stable evidence contract |
| `core/single-image/single-image-analysis-cache.js` | ~70 | Dedicated fingerprint-keyed cache, separate from RCM's `analysis-cache.js` |
| `core/single-image/legacy-state-adapter.js` | ~85 | One-way `Session.evidence → state.last*` sync (`LEGACY_MAP`) |
| `core/single-image/single-image-orchestrator.js` | ~320 | Lifecycle driver; the only new module `ui/app.js` imports |

Every one of these 7 files is imported and actually invoked from
`ui/app.js` — none is a dead scaffold. `single-image-orchestrator.js`
imports all 6 of the others; `ui/app.js` imports only the orchestrator.

## New files — QA

| File | Purpose |
|---|---|
| `qa/epic-2e-p1a-single-image-session-test.mjs` | 25 required automated test cases against real production modules |
| `qa/epic-2e-p1a-single-image-session-browser-test.mjs` | 12 required real-Chromium scenarios; fails closed (no fabricated PASS) |
| `qa/epic-2e-p1a-single-image-session-browser-results.json` | Generated result artifact from the browser test's actual (fail-closed) run |

## New files — Documentation (this deliverable)

`P1A_SOURCE_LINEAGE_AUDIT.md`, `P1A_SINGLE_IMAGE_SESSION_ARCHITECTURE.md`,
`P1A_SINGLE_IMAGE_EVIDENCE_CONTRACT.md`, `P1A_LEGACY_COMPATIBILITY_MAP.md`,
`P1A_MODIFIED_FILES.md` (this file), `P1A_RELEASE_NOTES.md`,
`P1A_QA_REPORT.md`, and the working audit notes `AUDIT_NOTES_RAW.md`.

## Edited files (3)

### `ui/app.js` (3115 → ~3150 lines)

SHA-256: `1a8c219c2365a4462e6ed224f30e57ad1da1673fef34063a4e9eed41a42516a7`
(P0.8A) → `443998f10d132a5736986838c938e93ba915cc222654ef84e4841e60a812c78b` (P1A).

All edits are additive wrapping around existing `state.last* = value`
write sites — no surrounding UI-rendering/DOM logic was touched:

1. Added `import * as singleImageOrchestrator from '../core/single-image/single-image-orchestrator.js';`
2. Added `let activeUploadTicket = null;` near the existing `analysisRenderGeneration` declaration.
3. `loadFile(file)` made `async`; calls `beginUpload(file)` right after the MIME guard, before `handleReset()`.
4. `img.onload`/`img.onerror` inside `loadFile()` call `markImageDecoded`/`markImageDecodeFailed`.
5. Top of `runAnalysis()`: calls `startAnalysisTicket()`; returns immediately if it yields no ticket (duplicate-Analyze guard).
6. Every `state.lastX = value;` write site inside `runAnalysis()` (histogram, imageAnalysisCore, palette, harmony, skinTone/whiteBalance/hsl/colorGrading/toneCurves/calibration, basicPanel, styleRecognition, styleFeatureGraph, styleFingerprint, validation, benchmark, decisionReport, referenceTransfer, processingLog — ~20 sites) now calls `commitEvidence()`/`commitFromSettled()` first; required-module failures return early exactly as the pre-existing code already did on falsy values.
7. Before `applyPresetToSliders(finalPreset)`: added `commitCandidate()` call; returns early if rejected.
8. After the Visual Preview block completes (still inside the outer `try`): `completeAnalysis(ticket)`.
9. Outer `catch (err)`: added `failAnalysis(ticket, err)`.
10. `handleReset()`: added `resetActiveSession(state)` + `activeUploadTicket = null` right after the existing `reviewConsoleController.resetTransientUiState()` call.

**Explicitly untouched inside `ui/app.js`:** the entire Visual Preview
Comparison / Controlled V2 rendering block, `applyPresetToSliders()`,
`readSlidersAsPreset()`, `handleDownload()`, `bindSliders()`,
`setupFileHandlers()`'s DOM wiring itself, and every function outside
`loadFile`/`runAnalysis`/`handleReset`.

### `qa/run-static-suites.mjs`

Added one line registering the new P1A static test in the suite list,
with a section-header comment. No other changes.

### `qa/baselines/epic-2e-n1-production-invariant.json`

Updated only the `ui/app.js` SHA-256 hash entry to reflect the
intentional, spec-required P1A edit (see above). The other 5 pinned
file hashes (`lightroom-mapping-engine/index.js`, `preset-engine/index.js`,
`xmp-validator/index.js`, `ui/ui-engine.js`,
`reference-xmp-generator.js`) and the `productionLocks` object are
unchanged — verified byte-identical to the P0.8A baseline (see
`P1A_QA_REPORT.md`).

## Regenerated (not hand-edited)

`qa/baselines/lufa42-production-lock-manifest.json` — regenerated via
`node qa/baselines/generate-production-lock-manifest.mjs`, now covering
139 files (was 132 in P0.8A; +7 for the new `core/single-image/*.js`
files).

## `package.json`

`version`: `2.0.7.3` → `2.1.0`. `description` updated to reference
EPIC 2E-P1A. No script entries removed; `test:static` now also runs the
new P1A suite via `qa/run-static-suites.mjs`.

## Confirmed untouched (byte-identical to P0.8A baseline)

`core/lightroom-mapping-engine/index.js`, `core/xmp-validator/index.js`,
`core/preset-engine/index.js`, `ui/ui-engine.js`,
`core/decision-engine/index.js`,
`core/preview-rendering/visual-preview-render-plan-v2.js`,
`core/lightroom-mapping-engine/mapping-v2-overlay-preview-sandbox.js`,
`index.html`, `ui/reference-color-match-panel.js`,
`core/color-match/reference-xmp-generator.js`,
`core/color-match/candidate-preview-renderer.js`,
`core/curve-engine/index.js`, `core/generation-control.js`,
`core/analysis-cache.js`, `core/preview-state-machine.js`,
`core/candidate-schema.js`, `core/core-runner.js`.
