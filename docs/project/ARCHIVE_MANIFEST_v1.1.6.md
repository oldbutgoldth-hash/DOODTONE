# Archive Manifest — LUMIXA_AI_v1.1.6_EPIC_2E_F_FINAL.zip

- **Archive name:** LUMIXA_AI_v1.1.6_EPIC_2E_F_FINAL.zip
- **Version:** AI Workflow v1.1.6 (EPIC 2E-F)
- **Date:** 2026-07-15
- **Archive size:** 520K
- **File count:** 126
- **SHA-256:** `407f8f2c13d048d6e884a9379a92b0916351242e1b01972f3fca1b4a5eb366b7`

## Important Files (verified present in archive)

- `lumixa-new/index.html`
- `lumixa-new/core/project-version.js`
- `lumixa-new/ui/review-console-renderer.js`
- `lumixa-new/ui/review-console-controller.js`
- `lumixa-new/core/lightroom-mapping-engine/mapping-v2-overlay-preview-sandbox.js`
- `lumixa-new/core/lightroom-mapping-engine/mapping-v2-preview-review-state.js`
- `lumixa-new/core/lightroom-mapping-engine/mapping-v2-flags.js`
- `lumixa-new/core/decision-engine/index.js`
- `lumixa-new/core/decision-report-engine/index.js`
- `lumixa-new/core/reference-transfer-engine/index.js`
- `lumixa-new/ui/app.js`
- `lumixa-new/docs/project/05_PROJECT_MEMORY.md`
- `lumixa-new/docs/project/06_EPIC_2E_F_RELEASE_NOTES.md`
- `lumixa-new/docs/project/07_CONTROLLED_PREVIEW_REVIEW_ARCHITECTURE.md`
- `lumixa-new/docs/project/08_EPIC_2E_F_QA_REPORT.md`

## Excluded Files

- `.git/` (version control metadata, not part of the shippable project)
- `*.DS_Store` (macOS metadata — none present, excluded defensively)
- `*~`, `*.bak` (editor backup files — none present, excluded defensively)
- No `node_modules/` exists in this project (no build step, no npm
  dependencies — vanilla ES modules only) so none was excluded because
  none existed.
- No old/duplicate ZIP or RAR archives were included (this packaging
  step zips only the live `lumixa-new/` working directory, not any
  previously-produced output archive).

## Packaging Method

Created via `zip -rX` against the live, already-tested
`/home/claude/lumixa-new/` working directory. No source file was
modified as part of this packaging step — every file inside this
archive is byte-identical to the version that passed the QA audit in
`08_EPIC_2E_F_QA_REPORT.md`.
