# 35 — EPIC 2E-K-R2-FIX1 Release Notes: Pixel Truth, Decision Gate & Evidence Closure

## 1. Summary

EPIC 2E-K-R2-FIX1 closes 15 sections of fixes against the Controlled V2
Calibration Lab: real Controlled V2 pixel rendering with strict success
criteria, Calibration Schema V2 with a `previewEvidence` object on every
record, a Decision Eligibility Gate enforced in both UI and Controller,
an honest Readiness ladder, a real fail-closed V1→V2 migration, the
exact Browser-test false-positive bug fixed, Clear Current Answer
genuinely clearing notes, the hardcoded English nav-button label fixed,
new local QA tooling (npm scripts, a Windows BAT runner, a preflight
check), pixel-truth hostile tests, re-verified Production Safety, and an
honest Final Browser Verification attempt. This feature remains strictly
Preview/Shadow-only. **Production Mapping, Production XMP Output, and
Controlled V2 Production activation are all unchanged and unaffected by
this round** -- see Section 3 (Production Safety) below for direct
proof.

## 2. Modified Files

**New files:**
- `core/calibration-lab/preview-evidence.js` -- pure previewEvidence
  classifier + Decision Eligibility Gate (Sections 2, 3, 11)
- `core/calibration-lab/pixel-truth-capture.js` -- browser-only pixel
  capture orchestrator, reuses production rendering, never duplicates it
  (Sections 1, 6)
- `core/calibration-lab/migrate-v1-to-v2.js` -- pure, fail-closed,
  idempotent V1→V2 migration (Section 5)
- `qa/epic-2e-k-r2-fix1-pixel-truth-static-test.mjs` -- 72 hostile
  assertions covering Sections 1, 2, 3, 5, 7, 8, 11
- `qa/preflight.mjs` -- environment/dependency/fixture/hash-input gate
  (Section 10)
- `qa/calibration-full-suite.mjs` -- ordered aggregator with an explicit
  honesty contract (Section 9)
- `RUN_LUMIXA_CALIBRATION_QA_WINDOWS.bat` (project root) -- 13-step
  Windows-native QA runner (Section 9)
- `docs/project/32_EPIC_2E_K_R2_FIX1_MIGRATION_GUIDE.md`
- `docs/project/33_EPIC_2E_K_R2_FIX1_PIXEL_TRUTH_ARCHITECTURE.md`
- `docs/project/34_EPIC_2E_K_R2_FIX1_QA_REPORT.md`
- `docs/project/35_EPIC_2E_K_R2_FIX1_RELEASE_NOTES.md` (this file)

**Edited files:**
- `core/calibration-lab/codes.js` -- +`PREVIEW_TRUTH_CODES`,
  +`PIXEL_BLOCKER_REASON_CODES`, `READINESS_STATUSES` 5→8
- `core/calibration-lab/schema.js` -- `CALIBRATION_SCHEMA_VERSION` 1→2,
  +`RECORD_SCHEMA_VERSION`, `previewEvidence`/audit-flag fields,
  `legacyAuditOnlyCount`
- `core/calibration-lab/aggregate.js` -- excludes audit-only records
  from reviewed-record math
- `core/calibration-lab/readiness.js` -- new counters, 3 new ladder
  tiers, `minPixelPreviewCoverage` policy default
- `ui/calibration-lab/calibration-lab-controller.js` -- pixel-truth
  capture at ingestion, Decision Gate enforcement in
  `saveCurrentDecision()`, rewritten `clearCurrentAnswer()`,
  session-open recompute, extended QA snapshot
- `ui/calibration-lab/calibration-lab-renderer.js` -- Gate-driven
  disabled decision chips + semantic-reason banner, new readiness
  counters displayed, preview-evidence data attributes
- `ui/calibration-lab/calibration-lab-i18n.js` -- corrected TH
  `nav.openButton`, new `pixelPreview.blocker.*` and readiness keys
  (both languages, zero missing)
- `ui/calibration-lab/calibration-lab-entry.js` -- reactive nav-button
  label via `calibrationLabT`, exposes
  `window.__LUMIXA_CAL_LAB_CONTROLLER_FOR_QA__` for hostile
  direct-controller-call testing
- `ui/calibration-lab/calibration-lab-storage.js` -- `DB_VERSION` 1→2,
  new `imagesLegacyBackupV1` store, real migration wiring in both
  IndexedDB and in-memory backends
- `index.html` -- removed hardcoded `title="Calibration Lab"` and the
  literal "Calibration Lab" text node from `#calibrationLabNavBtn`
- `package.json` -- +7 npm scripts (`qa:preflight`,
  `test:calibration-browser[:report]`, `test:calibration-storage`,
  `test:calibration-migration`, `test:calibration-pixel`,
  `test:calibration-full`)
- `qa/epic-2e-k-calibration-lab-browser-test.mjs` -- fixed the exact
  Section 6 OR-shortcut false-positive bug, added Gate/Clear-Answer/nav
  hostile checks
- `qa/epic-2e-k-calibration-lab-static-test.mjs` -- readiness-status
  count 5→8, fixture updates for the new gate
- `qa/epic-2e-k-calibration-lab-storage-test.mjs` -- fixed a
  `DB_VERSION`-mismatch bug, added a full Section 5 migration test block
- `qa/phase-c-suite-source-manifest.mjs`,
  `qa/run-static-suites.mjs` -- registration of new source files/suites
- `docs/project/26_EPIC_2E_K_CALIBRATION_SCHEMA.md` -- extended
  (additive) with a new Section 12 for Schema V2; Section 8 readiness
  count corrected

**Nothing else was modified.** See the full recursive-diff proof in
`34_EPIC_2E_K_R2_FIX1_QA_REPORT.md` Section 2.

## 3. Production Safety Proof (Section 12)

- 65/65 originally-locked core/ui files (per
  `qa/baselines/lufa42-production-lock-manifest.json`) re-hashed with 0
  mismatches, including all 5 files this round's spec explicitly named.
- Real XMP generation (`buildPreset()` + `serializeXMP()`) against a
  fixed fixture, run against both the pre-FIX1 baseline `core/` tree and
  the current FIX1 `core/` tree: identical 2899-byte output, identical
  SHA-256, zero-line diff.
- `productionWriteDisabled: true` remains hardcoded in the mapping-v2
  overlay gate files, which are themselves byte-identical to baseline.

Full detail: `34_EPIC_2E_K_R2_FIX1_QA_REPORT.md` Section 5.

## 4. Known Limitations

- **Browser Verification remains unclosed in this development
  sandbox.** `detectBrowserExecutable()` finds no usable Chromium, and a
  direct `npx playwright install chromium` fails with an explicit
  network-level `403 Connection blocked by network allowlist` error --
  the same finding as R1 and R2. Every Browser-dependent suite (14 of
  17 total steps in `tools/local-gate.mjs`) honestly self-reports
  `BROWSER_BINARY_UNAVAILABLE`. This is disclosed, not worked around.
- **`core/calibration-lab/export-dataset.js` was not in this round's
  scope** and does not yet expose any `previewEvidence`/pixel-truth
  field in its JSON/CSV export allow-list (`_boundedRecord`). A
  consumer of the exported dataset today sees the same fields as
  before FIX1 -- they cannot yet see whether a given exported decision
  was pixel-truth-verified from the export alone (though the in-app
  Dashboard/Readiness views, which read the live record objects
  directly, do reflect this). Recommended for a future round if
  external pixel-truth auditing of exported data becomes a requirement.
- Migrated V1 records are permanently downgraded to audit-only
  (`legacyDecisionPreservedForAudit: true`) until a human genuinely
  re-reviews them under the new gate -- by design (see the Migration
  Guide), but it does mean any pre-FIX1 calibration data collected so
  far contributes zero weight to Readiness until re-reviewed.
- All Known Limitations from R1/R2 not specifically addressed by this
  round (the live pixel-preview cache bound of 5 images per runtime
  session, the version-badge-not-bumped convention, the pre-existing
  `05_PROJECT_MEMORY.md` header/badge documentation-drift note) remain
  as previously described.

## 5. Source Hash Manifest

`qa/baselines/lufa42-production-lock-manifest.json` continues to lock
the same 65 files it locked at the end of R2 -- this round did not
regenerate or expand that manifest's scope, since every file it
locks was independently confirmed unchanged (Section 3 above). The
Calibration Lab's own files (`core/calibration-lab/*`,
`ui/calibration-lab/*`) are covered by their own dedicated hostile
production-lock test (`qa/epic-2e-k-calibration-lab-hostile-static-test.mjs`,
19/19 PASS) rather than by this older cross-EPIC manifest, consistent
with how R1 and R2 both treated it.

`qa/phase-c-suite-source-manifest.mjs`'s `calibrationLabBrowser` staleness
list now includes all 3 new pure/browser-boundary modules added this
round, so the Browser suite's own `sourceHash` staleness check (Section
10) will correctly detect a future change to any of them.

## 6. Next Development Boundary

- **EPIC 2E-L was explicitly not started**, per the governing
  instruction for this round.
- Close Final Browser Verification (Section 13) by running
  `RUN_LUMIXA_CALIBRATION_QA_WINDOWS.bat` (or
  `node tools/local-gate.mjs`) on a machine with a real Chromium/Edge/
  Chrome install and outbound network access -- this is the single
  remaining gap before this feature can be considered fully
  Browser-verified.
- Once genuinely Browser-verified, consider extending
  `export-dataset.js` to expose `previewEvidence` fields (Known
  Limitations above) if external auditing of exported calibration data
  becomes a requirement.
- Continue collecting real calibration sessions through the Lab under
  the new, stricter pixel-truth gate; only records with
  `browserVerified === true` and a genuine
  `BOTH_RENDERED_DIFFERENT`/`BOTH_RENDERED_IDENTITY` verdict now count
  toward Readiness, so meaningful Readiness progress requires re-review
  of any pre-FIX1 sessions under the new gate (see the Migration
  Guide's audit-only behavior).
- As always: Controlled V2 Production activation remains a future,
  separately-scoped decision, never automatic and never produced by
  this Lab itself.
