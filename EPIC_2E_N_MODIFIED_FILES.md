# EPIC 2E-N1–N5 — Modified/Added Files

## Core Color Match

- `core/color-match/core-color-match-analysis.js`
- `core/color-match/core-color-match-pipeline.js`
- `core/color-match/photographic-compensation-engine.js`
- `core/color-match/lightroom-candidate-mapper.js`
- `core/color-match/candidate-preview-renderer.js`
- `core/color-match/match-evaluation-engine.js`
- `core/color-match/evaluation-store.js`

## UI and version

- `ui/reference-color-match-panel.js`
- `index.html`
- `core/project-version.js`
- `package.json`

## QA

- `qa/epic-2e-n-core-color-match-browser-test.mjs`
- `qa/epic-2e-n1-n5-integration-static-test.mjs`
- `qa/epic-2e-n2-photographic-compensation-static-test.mjs`
- `qa/epic-2e-n3-lightroom-candidate-static-test.mjs`
- `qa/epic-2e-n4-preview-evaluation-static-test.mjs`
- `qa/epic-2e-n5-evaluation-harness-static-test.mjs`
- `qa/epic-2e-n-release-gate.mjs`
- `qa/run-static-suites.mjs`
- `qa/baselines/epic-2e-n-production-invariant.json`
- `qa/baselines/lufa42-production-lock-manifest.json`
- `qa/fixtures/core-color-match/*`
- `RUN_LUMIXA_2E_N_QA_WINDOWS.bat`

## Documentation and evidence

- `docs/project/44_EPIC_2E_N_CORE_COLOR_MATCH_N1_N5_ARCHITECTURE.md`
- `docs/project/45_EPIC_2E_N_QA_REPORT.md`
- `EPIC_2E_N_RELEASE_NOTES.md`
- `EPIC_2E_N_MODIFIED_FILES.md`
- `README_EPIC_2E_N.txt`
- `EPIC_2E_N_SOURCE_HASH_MANIFEST.json`
- fresh JSON result artifacts under `qa/`

Generated static-result JSON files may have refreshed timestamps/evidence after the full gate run; they do not represent additional Product behavior changes.
