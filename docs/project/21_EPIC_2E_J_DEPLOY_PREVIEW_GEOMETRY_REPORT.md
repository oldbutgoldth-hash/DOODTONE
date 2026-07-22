# DEPLOY GEOMETRY R1 — Deploy Preview Geometry Report

## Scope

Implements DEPLOY_GEOMETRY_R1_SPEC.txt Phases A-J: Preview Plan eligibility diagnostics, canonical EXIF-aware image decode, exact-pixel-dimension parity between Legacy and Controlled V2 rendering, a stricter Observation gate, deterministic synthetic geometry fixtures, a local real-Browser suite, a real Deploy-parity suite, and portable (sourceHash- and manifest-based) evidence freshness.

## Files modified (all within the ALLOWED PRODUCTION FILES list)

- `ui/app.js` — added `_buildPreviewGeometryDiagnostics()`, wired `previewGeometryDiagnostics`/`canonicalSourceGeometry` into `getPreviewPipelineSnapshot()`, added canonical-decode call site in `runAnalysis()`, retained-File lifecycle (`state.currentRetainedFile`), and stricter Observation-context wiring.
- `ui/preview-source-geometry-normalizer-v2.js` (new) — canonical `createImageBitmap`-based decode with EXIF-safe fallback, in-memory only, generation-scoped release.
- `ui/isolated-visual-preview-renderer-v2.js` — accepts `sharedDevicePixelRatio` to close a DPR-timing race between Legacy/V2 renders.
- `ui/visual-preview-comparison-controller-v2.js` — computes one shared DPR and canonical source per generation, threads both into Legacy and V2 render calls.
- `ui/visual-preview-comparison-renderer-v2.js` — Identity Preview text now reads exactly "Identity preview — no supported browser adjustment was applied" on the V2 side.
- `ui/interactive-before-after-controller-v2.js` — added spec-named alignment fields (`legacyPixelWidth/Height`, `v2PixelWidth/Height`, `canonicalWidth/Height`).
- `ui/interactive-preview-observation-controller-v2.js` / `-renderer-v2.js` — new `'pixel-mismatch'` gate reason, and Observation now requires `exactSourcePixelMatch === true` (stricter than IBA's own "ready" state).

## New QA infrastructure

- `qa/fixtures/preview-geometry/` — 6 deterministic fixtures (orientation 1 landscape/portrait, orientation 3, orientation 6, orientation 8, no-EXIF PNG baseline), `generate_fixtures.py`, `manifest.json`.
- `qa/helpers/exif-orientation-reader.mjs` — dependency-free JPEG EXIF Orientation parser, used as an independent cross-check against the Python fixture generator.
- `qa/epic-2e-j-preview-geometry-static-test.mjs` — no-Browser static suite (35/35 PASS).
- `qa/epic-2e-j-preview-geometry-browser-test.mjs` — real-Browser local suite (per-fixture exact-dimension, marker-color, Observation-gate, and cross-fixture-isolation checks).
- `qa/epic-2e-j-deploy-preview-geometry-test.mjs` — real Deploy-parity suite, gated strictly behind `LUMIXA_DEPLOY_URL`.
- `qa/baselines/generate-production-lock-manifest.mjs` + `qa/baselines/lufa42-production-lock-manifest.json` — portable, checked-in SHA-256 manifest of all 70 locked files, replacing a prior hard-coded sibling-directory dependency.
- `qa/phase-c-suite-source-manifest.mjs` — shared sourceHash input list, replacing mtime-based freshness (which produced false STALE results after ZIP extraction).

## Local (non-deployed) results

- Preview Geometry Static: **35/35 PASS**, decision PASS.
- Preview Geometry local Browser suite: **BROWSER_BINARY_UNAVAILABLE** — no Chromium binary exists in this sandbox (confirmed across 6 candidate paths); this is an environment constraint, not a fixture or code defect. No exact-dimension, marker-color, or Observation-gate result was live-verified in a real browser this round — only the static, non-Browser proof of fixture correctness ran.

## Deploy results

- Deploy Preview Geometry: **DEPLOY_URL_REQUIRED** — `LUMIXA_DEPLOY_URL` is not set. No deployed URL was contacted, no build marker was read, and no screenshots were generated, because this suite refuses to hard-code or guess a deployment target.

## Final Phase C decision

`BLOCKED_AUTOMATED_ACCEPTANCE_NOT_MET` — see `20_EPIC_2E_J_PHASE_C_FINAL_QA_REPORT.md` for the full gate table and blocking reasons. This is the honest result given the current environment; it is not a fabricated CONDITIONAL_PASS.

## What is needed to complete the geometry acceptance

1. A sandbox/environment with a working Chromium (or other Playwright-supported) browser binary, to run the local Preview Geometry Browser suite and the pre-existing Live App / Observation Smoke / Step 7B-A / Step 7B-B suites for real.
2. A value for `LUMIXA_DEPLOY_URL` pointing at an actual deployed build, to run the Deploy Preview Geometry suite for real and generate its screenshots.

Neither gap can be closed from inside this sandbox; both are pre-existing constraints of this environment, not new defects introduced by this round's work.
