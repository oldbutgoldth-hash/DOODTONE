# EPIC 2E-J Phase C — Final QA Report (DEPLOY GEOMETRY R1)

**Run ID:** 5157e5da-c3b9-435a-9c6e-8a4b8d3dd887
**Generated:** 2026-07-22T19:56:08.066Z
**Result file:** `qa/epic-2e-j-phase-c-final-results.json`
**Final decision:** `BLOCKED_AUTOMATED_ACCEPTANCE_NOT_MET`

## Summary

This report reflects a genuine, freshly-executed run of every automated gate in this sandbox. It is reported honestly rather than reused or copied forward from any prior PASS/CONDITIONAL_PASS result. The decision is `BLOCKED_AUTOMATED_ACCEPTANCE_NOT_MET`, not `CONDITIONAL_PASS`, because several gates could not produce real evidence in this environment.

## Foundational checks

- Syntax (`node --check`, 108 files): 108/108 PASS, 0 FAIL.
- Focused Core regression: 137/137 PASS, 0 FAIL.

## Gate-by-gate results

| Gate | Decision | Notes |
|---|---|---|
| Live App | BROWSER_BINARY_UNAVAILABLE | No Chromium binary in this sandbox; result carries no sourceHash and is not treated as evidence. |
| Observation Smoke | BROWSER_BINARY_UNAVAILABLE | Same root cause. |
| Step 7B-A | BROWSER_BINARY_UNAVAILABLE | Same root cause. |
| Step 7B-B | BROWSER_BINARY_UNAVAILABLE | Same root cause; valid outcomes for this gate are CONDITIONAL_PASS/PASS/FAIL. |
| Preview Geometry Static | PASS | 35/35 PASS, 0 FAIL — fixture manifest, independent EXIF cross-check, decision self-test, and companion Browser-file syntax check all pass. |
| Preview Geometry local Browser suite | BROWSER_BINARY_UNAVAILABLE | Same root cause. |
| Deploy Preview Geometry | DEPLOY_URL_REQUIRED | `LUMIXA_DEPLOY_URL` is unset; this suite never hard-codes or guesses a deployed URL. |

## Root cause: Browser unavailability

Across the full history of this project (this round and all prior EPIC rounds), no working Chromium/Chrome executable has ever been present in this sandbox. Playwright's Node package resolves correctly (`import("playwright")` succeeds), but no candidate binary exists among the six checked locations (bundled Playwright Chromium, `/usr/bin/chromium`, `/usr/bin/chromium-browser`, `/usr/bin/google-chrome`, `/usr/bin/google-chrome-stable`, `/opt/google/chrome/chrome`). Every Browser-dependent suite fails closed to `BROWSER_BINARY_UNAVAILABLE` rather than fabricating a PASS. This is a pre-existing, previously-documented sandbox constraint, not a defect introduced or discovered this round.

## Privacy and Production/XMP invariants (verified this round)

- `previewGeometryDiagnostics` and `canonicalSourceGeometry` (new QA snapshot fields) are built exclusively through `_qaSafeNum` / `_qaSafeBool` / `_qaSafeStr` / `_qaSafeStrArray` / `_qaSafeCount` / `_qaSafeReasons` / `_qaSafeGenerationId` — every field is a bounded primitive (number, boolean, or closed-vocabulary string) or a small array of strings/counts. Verified by direct code read: no raw image bytes, base64 image data, filenames, local paths, full EXIF blocks, or user data appear anywhere in these structures. `decodePath` is a closed enum (`unavailable` / `stale-discarded` / `createImageBitmap` / `html-image-element-fallback`) — never a filesystem path.
- No `localStorage`/`sessionStorage`/`indexedDB` write was added by this round's code; grep across all modified/new geometry files confirms zero live calls (only doc comments stating the no-persistence guarantee).
- Production invariants remain hard-coded at their source of truth, all inside the 70-file Production-lock scope this EPIC never touched: `selectedOutputSource = 'legacy'` (hard-coded in 3 places), `allowProductionWrite: false`, `allowExport: false`, `appliedToProduction: false` (hard-coded throughout `core/decision-engine`, `core/lightroom-mapping-engine`, `core/preview-rendering`). No XMP-writing code path exists in any file this EPIC was allowed to touch.
- `qa/epic-2e-j-r2-phase-e-static-test.mjs` (R3 Evidence Static): 92/92 PASS, confirming byte-for-byte match of all 70 locked core/ui/index.html files against the checked-in Production-lock manifest — i.e., independent proof that this round's edits stayed confined to the allowed geometry/preview files.

## Blocking reasons (verbatim from the aggregator)

- Live App: decision "BROWSER_BINARY_UNAVAILABLE" is not one of this suite's valid outcomes (PASS/FAIL) — likely a Browser/environment-unavailable stub, not real evidence; result is missing a sourceHash — cannot prove freshness
- Observation Smoke: same
- Step 7B-A: same
- Step 7B-B: decision "BROWSER_BINARY_UNAVAILABLE" is not one of this suite's valid outcomes (CONDITIONAL_PASS/PASS/FAIL) — same
- Preview Geometry local Browser suite: same
- Deploy Preview Geometry: decision is "DEPLOY_URL_REQUIRED", not PASS_DEPLOY_PREVIEW_GEOMETRY

## Manual verification gaps (not automatable in any environment)

- Physical touch hardware
- Real screen-reader verification (NVDA/JAWS/VoiceOver)
- Physical mobile device verification

These are permitted `NOT_TESTED` items independent of the Browser-binary constraint above.
