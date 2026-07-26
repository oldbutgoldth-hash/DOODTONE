# 28 -- EPIC 2E-K Release Notes: Controlled V2 Calibration Lab

## 1. Release Identity

- **Feature:** Controlled V2 Calibration Lab
- **EPIC:** EPIC 2E-K
- **Scope:** Preview/Shadow-only internal QA tool. Does not change the
  displayed "AI Workflow" version badge (see section 13 for why).
- **Production status:** Unchanged. Legacy Lightroom Mapping remains the
  sole production output path. Controlled V2 remains disabled in every
  workflow. XMP export remains byte-identical to the pre-EPIC baseline.

## 2. Scope

This release adds a new, fully separate Calibration Lab for collecting
structured Legacy-vs-Controlled-V2 comparisons across many images, so a
future decision about Controlled V2's production readiness can be made
from real calibration data. It does not enable Controlled V2 in
production, does not change Production Mapping, and does not change XMP
Production Output. No Deploy action was taken as part of this EPIC.

## 3. What Was Added

- A new nav button ("Calibration Lab") opening a full-screen dialog,
  separate from the main analysis workflow.
- Session management: start new, resume existing, end session; each
  session tracks image/reviewed/legacy-win/v2-win/tie/both-rejected/
  pending counts.
- Per-image workflow: add an image (captures a Legacy vs. Controlled V2
  numeric snapshot using the exact same pipeline the production preview
  already uses), navigate prev/next, choose a comparison decision (6
  stable codes), select issue codes (20 stable codes, multi-select),
  write free-text notes, save or clear the current image's answer.
- A before/after slider showing the source image with the real
  Legacy/V2 snapshot numbers displayed alongside (see Known Limitations,
  section 9, for why this is not yet a pixel-differentiated preview).
- Local persistence via IndexedDB, with an explicit bounded in-memory
  fallback and honest status reporting if IndexedDB is unavailable.
- A Calibration Dashboard (win/tie/both-unacceptable rates, category and
  lighting breakdowns, issue frequency, safety/low-confidence/mixed-
  light/skin-tone-issue counts) and a Controlled V2 Readiness Report
  (5 stable readiness codes, never `PRODUCTION_READY`, plus a separate,
  purely informational Calibration Policy check).
- "Export Calibration Data" -- JSON and CSV export, both scoped to a
  fixed field allow-list that structurally excludes the original image,
  any Base64 image data, and any local file path.
- Full keyboard/focus-trap/reduced-motion/44px-touch-target
  accessibility support, and a scoped English/Thai dictionary that
  follows the main app's language switch reactively.
- A Semantic QA Snapshot (`window.__LUMIXA_QA__.getCalibrationLabSnapshot()`)
  plus `data-cal-*` DOM attributes, for Browser QA.

## 4. Explicitly Not Changed

- `ui/app.js` was not edited.
- Production Mapping (`core/lightroom-mapping-engine`) was not touched.
- XMP serialization (`serializeXMP`/`downloadXMP`) is not imported
  anywhere in the new module tree.
- No production flag was flipped: `controlledV2Apply`, `productionWrite`,
  `previewExport`, `controlledTestActivation`, and
  `controlledV2ProductionActivation` all remain `false`, confirmed both
  structurally (source inspection) and via the existing production-lock
  QA snapshot, unchanged before/after this EPIC.
- Nothing was deployed. No hosting/CI configuration was touched.

## 5. Modified Files (existing files touched, all additive)

| File | Nature of change |
|---|---|
| `index.html` | Added a nav button, an empty mount `<div id="calibrationLabRoot">`, and a second `<script type="module" src="ui/calibration-lab/calibration-lab-entry.js">` tag placed after `ui/app.js`'s own script tag. No existing element, script tag, or attribute was removed or altered. |
| `qa/helpers/playwright-in-memory-app.mjs` | Generalized a previously hardcoded single-module-script-tag regex/discovery to handle any number of `<script type="module" src="...">` tags (needed because this EPIC added a second one). Existing single-tag behavior (`ui/app.js` specifically must be present) is preserved exactly. |
| `qa/phase-c-suite-source-manifest.mjs` | Added a new `calibrationLabBrowser` manifest entry listing this EPIC's Browser suite and its source files, for staleness detection. |
| `tools/local-gate.mjs` | Added Step 14 for this EPIC's Browser suite. Steps 1-13 unchanged. |
| `qa/run-static-suites.mjs` | Added the three new static/storage/hostile suites for this EPIC to the existing `STATIC_SUITES` array. |
| `package.json` | Added `fake-indexeddb` as a devDependency (test tooling only, not shipped to the browser -- mirrors the existing `playwright` devDependency precedent). |

## 6. New Files

- `core/calibration-lab/codes.js`, `schema.js`, `run-comparison-pipeline.js`,
  `aggregate.js`, `readiness.js`, `export-dataset.js` (6 files, ~960 lines)
- `ui/calibration-lab/calibration-lab-storage.js`, `-i18n.js`,
  `-controller.js`, `-renderer.js`, `-entry.js` (5 files, ~1,344 lines)
- `qa/epic-2e-k-calibration-lab-static-test.mjs`
- `qa/epic-2e-k-calibration-lab-storage-test.mjs`
- `qa/epic-2e-k-calibration-lab-hostile-static-test.mjs`
- `qa/epic-2e-k-calibration-lab-browser-test.mjs`
- `docs/project/25_EPIC_2E_K_CALIBRATION_LAB_ARCHITECTURE.md`
- `docs/project/26_EPIC_2E_K_CALIBRATION_SCHEMA.md`
- `docs/project/27_EPIC_2E_K_QA_REPORT.md`
- `docs/project/28_EPIC_2E_K_RELEASE_NOTES.md` (this file)

## 7. Tests Performed (real, see QA Report for full detail)

- `qa/epic-2e-k-calibration-lab-static-test.mjs`: 61/61 PASS
- `qa/epic-2e-k-calibration-lab-storage-test.mjs` (real IndexedDB via
  `fake-indexeddb`): 16/16 PASS
- `qa/epic-2e-k-calibration-lab-hostile-static-test.mjs` (all 9
  Section-17 items): 19/19 PASS
- Full `node qa/run-static-suites.mjs`: all static suites PASSED
- `node --check` on every new/modified file

## 8. Tests Not Performed (honest, environment-blocked)

- `qa/epic-2e-k-calibration-lab-browser-test.mjs` could not be executed
  against a real browser in this sandbox (no Chromium binary available);
  it correctly self-reports `BROWSER_BINARY_UNAVAILABLE` rather than a
  fabricated PASS. This is the same constraint every prior EPIC in this
  project has hit in this environment.
- Real screen reader, physical mobile device, and real photographic
  content testing were not performed (same as every prior EPIC).

## 9. Known Limitations

- **Before/after preview is not pixel-differentiated.** The slider shows
  the same source image on both sides, with the real numeric
  Legacy-vs-V2 snapshot table displayed alongside it, rather than an
  actually-rendered Controlled V2 pixel preview. Building a genuine
  pixel-differentiated preview here would require duplicating the
  production pixel-preview pipeline outside a real analysis run, which
  risks producing a subtly wrong preview -- deliberately deferred rather
  than risking that.
- **Migration scaffold is empty.** `SESSION_MIGRATIONS` has no entries
  because only schema v1 exists; a real v1-to-v2 migration function has
  never been exercised end-to-end (only the fail-closed rejection path
  for unknown/future versions has been tested).
- **Version badge not bumped.** Unlike EPIC 2E-H/2E-I (which added
  production-adjacent preview capability to the main app), this EPIC
  deliberately did not bump `core/project-version.js` -- the Calibration
  Lab is an internal QA/calibration tool, not a capability of the photo
  editor itself, and the user's spec for this EPIC did not request a
  version change. This is a scope decision, not an oversight.
- **A pre-existing documentation drift was found, not fixed.**
  `docs/project/05_PROJECT_MEMORY.md`'s "Current Version" header section
  still read v1.1.8/EPIC 2E-H at the start of this EPIC, while
  `core/project-version.js` already said v1.1.9/EPIC 2E-I and the file's
  own later EPIC 2E-I section correctly described v1.1.9. This mismatch
  predates this EPIC and was left as-is (out of this EPIC's stated
  scope) rather than silently corrected; it is noted here so it is not
  lost.
- **Browser suite is unverified in this environment** (section 8).

## 10. Next Development Boundary

The following are explicitly **not** part of this EPIC and should be
scoped fresh if pursued:

- Running the Browser suite (`qa/epic-2e-k-calibration-lab-browser-test.mjs`)
  against a real Chromium install and confirming its result.
- Deciding whether/when to enable Controlled V2 in production -- this
  EPIC deliberately builds only the measurement tool, not the decision
  itself; `computeReadinessReport()` can never return
  `PRODUCTION_READY` by construction, and no report from this Lab
  should be read as authorization to flip `controlledV2ProductionActivation`
  or any other production flag.
- A genuinely pixel-differentiated before/after preview for the
  Calibration Lab (see Known Limitations above).
- Reconciling the pre-existing version-header documentation drift noted
  above.
- A real schema v1-to-v2 migration, if/when the Calibration Schema
  needs to change in a way existing stored sessions can't already
  represent.

## 11. Rollback Notes

Reverting this EPIC is a pure subtraction: delete
`core/calibration-lab/`, `ui/calibration-lab/`, the four new
`qa/epic-2e-k-*` files, the three new `docs/project/25-28` files, remove
the two additive lines plus the script tag from `index.html`, remove the
`calibrationLabBrowser` manifest entry and Step 14 from the local gate,
remove the three new suite entries from `qa/run-static-suites.mjs`,
revert `qa/helpers/playwright-in-memory-app.mjs`'s generalized regex (or
leave it -- it is backward-compatible with the single-tag case and does
not depend on the Calibration Lab existing), and remove the
`fake-indexeddb` devDependency. No production file requires any reversal
because none was changed.

## 12. Release Decision

**CONDITIONAL PASS**, matching this project's established convention:
everything genuinely executable in this development sandbox passes (96
assertions across 3 new Node-executable suites, 0 failures; full project
static suite green; production locks structurally verified unchanged);
the Browser suite is written and ready but requires a real
Chromium/Playwright environment to execute, which this sandbox does not
have.
