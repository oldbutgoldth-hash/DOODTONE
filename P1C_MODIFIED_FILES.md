# EPIC 2E-P1C — Modified/New Files

Diffed against the confirmed EPIC 2E-P1B baseline
(`LUMIXA_EPIC_2E_P1B_...` working copy).

## New files (7 Candidate modules)

- `core/single-image/candidate/candidate-schema.js`
- `core/single-image/candidate/candidate-builder.js`
- `core/single-image/candidate/candidate-validator.js`
- `core/single-image/candidate/candidate-store.js`
- `core/single-image/candidate/candidate-slider-adapter.js`
- `core/single-image/candidate/candidate-lineage.js`
- `core/single-image/candidate/legacy-preset-adapter.js`

## New files (tests + docs)

- `qa/epic-2e-p1c-candidate-test.mjs` — 86 real-module static/integration test cases (registered in `qa/run-static-suites.mjs`).
- `P1C_CANDIDATE_ARCHITECTURE.md`
- `P1C_CANDIDATE_SCHEMA.md`
- `P1C_CANDIDATE_SOURCE_LINEAGE_AUDIT.md`
- `P1C_LIGHTROOM_PARAMETER_CONTRACT.md`
- `P1C_SLIDER_MAPPING.md`
- `P1C_LEGACY_PRESET_MIGRATION_MAP.md`
- `P1C_MODIFIED_FILES.md` (this file)
- `P1C_RELEASE_NOTES.md`
- `P1C_QA_REPORT.md`

## Edited files

| File | What changed |
|---|---|
| `core/single-image/single-image-orchestrator.js` | Added imports for the new Candidate modules; renamed `commitCandidate()`'s write target `s.candidate` → `s.candidateRaw` (with an explanatory comment); added `buildAndCommitCandidate(ticket, opts)`; added `traceXmpExportUsingCandidate()`/`traceXmpExportBlocked()`; `completeAnalysis()`'s cache write now also stores `candidateRaw`. |
| `core/single-image/single-image-session.js` | Added `candidateRaw: null` field to `createEmptySession()`; added `'candidateRaw'` to `validateSessionShape()`'s required-keys list; `resetSessionData()` now also nulls `candidateRaw`. |
| `ui/app.js` | Imports for the Candidate modules; two new `state` fields (`lastCandidateStatus`, `_candidateSliderSyncGuard`); Candidate-status-badge clear at the start of `runAnalysis()` and in its `catch` block; the Candidate-commit block now calls `buildAndCommitCandidate()` and renders sliders via `renderCandidateToSliders()` instead of `applyPresetToSliders()`; `handleReset()` now also clears the Candidate Store; `handleDownload()` rewritten to source from `candidateStore.getValidatedCandidate()`; the locale re-render function now also re-renders the Candidate status badge (text/color only); a new boot-time slider-edit listener wires `resolveSliderEdit()` + `candidateStore.updateCandidateParameter()`; `readSlidersAsPreset()` and `applyPresetToSliders()` marked as deprecated, unused compatibility functions (not deleted). |
| `ui/i18n/en.js` / `ui/i18n/th.js` | Added `appShell.downloadBlockedNoCandidate` and a new `candidateStatus.*` key group (7 keys) for the status badge text, in both languages. |
| `index.html` | Added one new, minimal `#candidateStatusBadge` `<div>` immediately before the sliders panel — no other markup changed. |
| `qa/epic-2e-j-locale-switch-rerender-static-test.mjs` | Added `updateCandidateStatusBadge` to the allowlist of known-pure re-render functions the locale switch is permitted to call (it re-renders only from `state.lastCandidateStatus`, never rebuilds the Candidate). |
| `qa/run-static-suites.mjs` | Registered the new `qa/epic-2e-p1c-candidate-test.mjs` suite. |
| `qa/baselines/epic-2e-n1-production-invariant.json` | Regenerated the `ui/app.js` hash entry only (ui/app.js is the one file this manifest tracks that P1C legitimately changes — every other tracked file, including the real serializer/validator/mapping-engine, remains byte-identical, verified programmatically). |
| `qa/baselines/lufa42-production-lock-manifest.json` | Regenerated hash entries for the 5 files P1C legitimately changed (`single-image-orchestrator.js`, `single-image-session.js`, `ui/i18n/en.js`, `ui/i18n/th.js`, `index.html`) — all 140 other locked files remain byte-identical, verified programmatically. |
| `package.json` | Version `2.2.0` → `2.3.0`; description updated for EPIC 2E-P1C. |

## Files confirmed byte-identical (never touched)

`core/preset-engine/index.js` (serializer/downloader),
`core/xmp-validator/index.js` (`HARD_LIMITS`/`quickSafetyClamp`/
`validateFinalPreset`), `core/lightroom-mapping-engine/index.js`,
`ui/ui-engine.js`, `core/color-match/reference-xmp-generator.js`, and
every Reference Color Match / P0.8A pixel-pipeline file — verified by
the pre-existing production-invariant and production-lock-manifest hash
suites, both of which still pass unmodified (see `P1C_QA_REPORT.md`).

## Incidental regenerated files (not hand-edited)

Several `qa/*-static-results.json` snapshot files and
`package-lock.json` differ only because running the existing test
suites / `npm install` regenerates them with a fresh timestamp/run —
their content reflects the current (passing) run, not an intentional
edit.


---

# R2 — Candidate Runtime Lifecycle Order Fix

## Edited files (R2)

| File | What changed |
|---|---|
| `ui/app.js` | Moved the Candidate build/validate/store-commit/slider-sync block from immediately after `commitCandidate()` (while the Session was still `ANALYZING`) to immediately after `completeAnalysis()`, gated on the real `finalSessionStatus` it returns (`COMPLETED`/`PARTIAL` only) — the root-cause fix for the "Auto-Tune Candidate build failed" runtime bug. `commitCandidate()` itself was left in place. Added a `try/finally`-wrapped slider-sync guard (was previously a plain sequential set/render/unset). Added the required `console.error('[P1C Candidate Build Failed]', {...})` diagnostic with all 7 required fields, never image/binary data. Added explicit `candidateStore.clearActiveCandidate(...)` handling for both the "build attempted but failed on a terminal Session" and the "Session is FAILED/ABORTED/stale" branches. |
| `qa/run-static-suites.mjs` | Registered the new `qa/epic-2e-p1c-r2-candidate-lifecycle-order-test.mjs` suite. |
| `qa/baselines/epic-2e-n1-production-invariant.json` | Regenerated the `ui/app.js` hash entry only — the one file this manifest tracks that this fix legitimately changes; every other tracked file (the real serializer, validator, mapping engine) verified byte-identical. |
| `package.json` | Version `2.3.0` → `2.3.1`; description updated for EPIC 2E-P1C R2. |

## New files (R2)

- `qa/epic-2e-p1c-r2-candidate-lifecycle-order-test.mjs`
- `P1C_R2_RUNTIME_LIFECYCLE_FIX.md`

## Not changed for R2

`qa/baselines/lufa42-production-lock-manifest.json` — `ui/app.js` is
listed under that manifest's `allowedGeometryFiles` (deliberately
excluded from its locked-hash set), so no update was needed there.
`core/single-image/single-image-orchestrator.js` — its
`buildAndCommitCandidate()` terminal-status guard was read and
confirmed correct, but was **not** edited; the defect was purely in its
caller's ordering. No Core analysis formula, Candidate schema,
Candidate-to-slider mapping, XMP serializer, Legacy Preset Adapter
mapping, P1B Report calculation, P1A upload lifecycle, Reference Color
Match file, P0.8A Preview renderer, or Production safety lock was
touched.
