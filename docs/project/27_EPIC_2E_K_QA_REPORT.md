# 27 — EPIC 2E-K QA Report: Controlled V2 Calibration Lab

## 1. Scope

This report covers everything genuinely executed in this development
environment for the Controlled V2 Calibration Lab (EPIC 2E-K), and lists
explicitly what could not be executed here and why. No result in this
document is fabricated; every PASS/FAIL line below is drawn from a real
tool invocation logged during development.

## 2. Environment Constraint (carried forward, unchanged from every
   prior EPIC in this project)

This sandbox has no usable Chromium binary
(`detectBrowserExecutable()` finds zero candidates). Every
Browser-dependent suite -- including the two written for this EPIC --
correctly reports `BROWSER_BINARY_UNAVAILABLE` and exits 0 (a
non-failing, honest "cannot prove this here" result), per this project's
established convention. This is a pre-existing environment limitation,
not a defect introduced by this EPIC.

## 3. Node-Executable Static Test Results (real, ran to completion)

| Suite | Result |
|---|---|
| `qa/epic-2e-k-calibration-lab-static-test.mjs` | 61/61 PASS, 0 FAIL |
| `qa/epic-2e-k-calibration-lab-storage-test.mjs` (real IndexedDB via `fake-indexeddb`) | 16/16 PASS, 0 FAIL |
| `qa/epic-2e-k-calibration-lab-hostile-static-test.mjs` (Section 17, all 9 items) | 19/19 PASS, 0 FAIL, 0 NOT_TESTED |
| `node qa/run-static-suites.mjs` (full project static suite, all suites incl. the three above) | All static suites PASSED, exit 0 |

`qa/epic-2e-k-calibration-lab-static-test.mjs` covers: stable-code counts
and validators; session/record schema including the hostile
Thai-sentence-as-decision rejection; bounded snapshot extractors
including the raw-prose-never-leaks hostile check; dashboard aggregate
math across multiple scenarios; the Calibration Policy and Readiness
ladder across multiple scenarios including a proof that
`PRODUCTION_READY` can never be produced; the export contract including
the smuggled-field (`imageBase64`/`localFilePath`/
`originalImageDataUrl`) rejection; and scoped EN/TH dictionary coverage.

`qa/epic-2e-k-calibration-lab-storage-test.mjs` covers a genuine
IndexedDB round-trip (via `fake-indexeddb`, a real IndexedDB
implementation runnable in Node, not a mock); fail-closed rejection of
invalid session/record data; corrupt-row injection directly via raw
`indexedDB` transactions for both the `sessions` and `images` stores,
confirming `listSessions()`/`loadImageRecordsForSession()` never crash
and silently exclude the corrupt rows; `getStorageUsageSummary()`
idempotency across repeated calls (this specifically re-verifies the
accumulating-counter bug described in section 11 stays fixed);
`MAX_STORED_SESSIONS` enforcement; `deleteSession()` (clear current
session); and `clearAll()` (clear all data, including resetting the
corrupt-record count to 0).

## 4. Section 17 Hostile Test Results (all 9 required items)

| # | Requirement | Result |
|---|---|---|
| 1 | Calibration Decision cannot write Production values | PASS |
| 2 | Calibration Export cannot create XMP | PASS |
| 3 | Controlled V2 Record cannot become Production Mapping | PASS |
| 4 | Localized Sentence is never stored as Canonical Decision | PASS |
| 5 | Raw Core Prose never leaks to the main UI | PASS |
| 6 | Dataset never has Image Base64 | PASS |
| 7 | Dataset never has Local File Path | PASS |
| 8 | Corrupt Session never crashes the app | PASS |
| 9 | Stale QA Evidence never passes the Local Gate | PASS (see section 8 below for detail) |

## 5. Browser Suite (written, honestly not executable here)

`qa/epic-2e-k-calibration-lab-browser-test.mjs` is complete and covers:
nav button opens the dialog with correct ARIA; Session Creation;
Multi-image Navigation (add 2 images via the deterministic
`qa/fixtures/epic-2e-j/neutral-balanced.png` and
`warm-portrait-synthetic.png` fixtures, prev/next); Decision Persistence
and Issue Code Persistence; Save and Restore (end session, reopen,
confirm `imageCount` restored); TH -> EN -> TH visible-locale audit
scoped to `#calibrationLabRoot` only (reusing the existing
`auditVisibleLocaleSections`/`decideVisibleLocaleAudit` helper); 7 mobile
viewport widths (320/360/390/430/768/1024/1440px) checked for
`scrollWidth <= clientWidth + 2`; Keyboard Tab-reach, Escape-closes, and
focus-restored-to-nav-button; Production Locks Unchanged (both the main
app's `qaSnapshot()` and the Calibration Lab's own snapshot); XMP Exact
Invariant Unchanged (`captureXmpText`/`sha256XmpText` before/after using
the Lab); and a 0-console/0-page-error check.

Running it in this sandbox produces the honest result
`BROWSER_BINARY_UNAVAILABLE`, exit 0 -- consistent with every other
Browser suite in this project's history in this environment. It has not
been run against a real Chromium in this session; it should be run on a
machine with Playwright/Chromium installed before this feature is
considered browser-verified.

## 6. Local Gate

`tools/local-gate.mjs` now has 14 steps. Steps 1-3 (ESM syntax,
project-wide import resolution, full static suite) pass in this
environment. Steps 4-14 (all Browser-dependent, including the new Step
14 for this EPIC's Browser suite) each fail closed with
`BROWSER_BINARY_UNAVAILABLE`, honestly reflecting this sandbox's lack of
Chromium -- not a defect in the gate or the new suite.

## 7. Bugs Found and Fixed During Development (see Architecture doc for
   more detail)

- **Accumulating `corruptRecordCount`**: the IndexedDB storage backend
  originally used a shared mutable counter incremented on every scan,
  so 3 repeated `getStorageUsageSummary()` calls against the same
  still-corrupt row would report a climbing count instead of a stable
  one. Fixed by replacing it with fresh, non-mutating scan functions;
  re-verified 3 repeated calls now produce byte-identical JSON.
- **`arguments.callee` in an arrow function** (renderer's original
  category-chip toggle plan): caught via code review before any test ran
  (arrow functions have no `arguments`, and it is additionally forbidden
  under the strict mode all ES modules run in). Fixed by having each
  chip own and toggle its own `aria-pressed` attribute directly, with no
  external mutable array or recursive rebuild needed.
- **Shared Browser-test harness regression**: adding this feature's
  second `<script type="module" src="...">` tag to `index.html` broke
  `qa/helpers/playwright-in-memory-app.mjs`'s hardcoded single-tag regex
  (confirmed via a pristine-baseline re-extraction that the regression
  was genuinely introduced by this EPIC's `index.html` edit, not
  pre-existing). Fixed by generalizing both the HTML-transform regex and
  the entry-point discovery to handle any number of module-script tags;
  re-verified the module graph now correctly includes all 93 modules
  (full `core/calibration-lab/*`/`ui/calibration-lab/*` tree) with zero
  rejections and zero duplicate canonical IDs.

## 8. Item 9 in Detail: Stale Evidence vs. the Local Gate

The hostile test's Item 9 plants a tampered result file (a fabricated
`PASS` row with a deliberately wrong `sourceHash`) for this EPIC's own
Browser-suite result file, then spawns a real, separate
`node tools/local-gate.mjs` child process. Investigation during
development (reading `tools/local-gate.mjs`'s `runStep()`) showed the
gate does not merely detect a stale `sourceHash` and reject it -- it
unconditionally re-runs each suite's own script fresh *before* ever
reading the result file, which is a stronger guarantee: the tampered
file is overwritten by a genuine re-run before it could ever be
evaluated. The test's assertion was corrected mid-development to match
this discovery: it checks that the result file's `runId` after the gate
run differs from the tampered fixture's fabricated `runId` (proving
genuine regeneration occurred), and that the tampered
`'fabricated PASS row'` text never appears in the gate's own stdout. The
test always restores the original honest result file in a `finally`
block, verified post-run.

Because this test spawns a real `node tools/local-gate.mjs`, and that
gate's own Step 3 re-runs `qa/run-static-suites.mjs` (which itself
includes this very hostile test file), a recursion guard environment
variable (`LUMIXA_CAL_LAB_HOSTILE_TEST_GATE_SPAWN_IN_PROGRESS`) is set
on the spawned child's environment; a nested invocation of the hostile
test reached only through that chain detects the guard and skips the
recursive sub-test (recorded as `NOT_TESTED`, non-fatal) rather than
spawning another generation. This was verified directly: a full
`node qa/run-static-suites.mjs` run completes without hanging or
exhausting resources, and the outermost hostile-test invocation still
performs the real gate-spawn check.

## 9. Privacy / Dataset Content Verification

Structurally verified (both the static test and the hostile test): the
export allow-list (`_boundedRecord`) in `export-dataset.js` only ever
reads a fixed set of fields from an input record, so a smuggled
`imageBase64`, `localFilePath`, or `originalImageDataUrl` field never
reaches either JSON or CSV output, even when explicitly present on the
in-memory record object passed to the exporter in the test. No original
image file, Base64 image data, or local file path is ever written to
IndexedDB by the storage layer's own schema (`schema.js`'s
`createImageTestRecord()` has no such field to begin with).

## 10. Accessibility Verification (structural, Browser-suite-pending for
    live confirmation)

Focus trap, Escape-close, and focus-restore logic verified via direct
code review of `_trapFocus`/`open()`/`close()`; `min-height`/`min-width:
44px` verified present in the injected stylesheet for every interactive
class; `prefers-reduced-motion` and the 700px stacking breakpoint
verified present in the injected `<style>` block. Live keyboard/
screen-reader/viewport verification is covered by the written Browser
suite (section 5) and remains pending a real-Chromium run.

## 11. What Was NOT Tested in This Environment

- Any real-browser execution of the Calibration Lab UI (nav button
  click, dialog open, image upload, slider interaction, live keyboard
  navigation) -- blocked by the sandbox's lack of Chromium, as with
  every prior EPIC.
- Real screen-reader software (NVDA/JAWS/VoiceOver).
- Physical mobile/touch devices.
- Real photographic content (wedding/portrait/event photos) -- the two
  reused fixtures are synthetic test images, same as prior EPICs.

## 12. Release Decision

**CONDITIONAL PASS for this development environment**: every check that
can be genuinely executed in Node (schema/validation/aggregate/
readiness/export/storage/hostile-static logic, 96 total assertions
across the three new suites, all PASS) does pass, and the production
locks (Section 1/17 requirements) are structurally verified to hold. The
Browser-dependent checks (Section 5) must be run on a machine with a
real Chromium/Playwright install before this feature is considered
fully browser-verified -- this is the same conditional status every
prior EPIC in this project has honestly carried in this sandbox.
