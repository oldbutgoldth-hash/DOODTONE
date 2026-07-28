# EPIC 2E-P0 Modified Files

- `ui/reference-color-match-panel.js`
  - added Reference Color Match Beta workflow namespace
  - automatic Reference analysis when both images are present
  - explicit matched-preview state machine
  - stale-generation guard
  - deterministic preview error codes and fail-visible UI
  - Canvas reset on pair reset/error
- `index.html`
  - added matched-preview status overlay
- `core/project-version.js`
  - version 2.0.0 / EPIC 2E-P0
- `package.json`, `package-lock.json`
  - release identity update
- `qa/epic-2e-p0-dual-workflow-preview-static-test.mjs`
  - P0 workflow/preview contract tests
- `qa/baselines/lufa42-production-lock-manifest.json`
  - refreshed for reviewed source changes
