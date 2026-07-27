# LUMIXA AI — EPIC 2E-K-R2-FIX5 QA Report

## Scope

FIX5 closes the dependency-independent Storage Contract and adds a fail-closed Native Browser IndexedDB gate. It does not change Production Mapping, the Production XMP path, Controlled V2 pixel rendering, or the Preview-before-Candidate-Review workflow completed in FIX4.

## Implemented

- Added a QA-only deterministic IndexedDB transaction harness. It exercises the exact object-store/index/request/transaction surface used by `calibration-lab-storage.js` without shipping any new runtime dependency to the app.
- Reworked the Save Gate QA to use the same shared storage-contract harness rather than failing when `fake-indexeddb` cannot be downloaded.
- Added a real Chromium/Chrome/Edge Native IndexedDB persistence test using CDP and a temporary localhost origin.
- Added a fail-closed FIX5 release gate with three decisions: `FINAL_PASS`, `FAIL`, and `NOT_VERIFIED`.
- Added a Windows runner that installs locked dependencies, runs official `fake-indexeddb`, runs Native Browser IndexedDB, and returns a non-zero code for failure or not-verified status.

## Fresh results

| Gate | Result |
|---|---:|
| ESM syntax | PASS — 185/185 |
| Full static suites | PASS |
| FIX5 Storage Contract | PASS — 24/24 |
| Save/Decision persistence gate | PASS — 20/20 |
| FIX4 Preview-before-review safety | PASS — 19/19 |
| Production lock manifest | PASS — 92/92, through the full static suite |
| Native Browser IndexedDB | NOT_VERIFIED |
| Package cleanliness | PASS |
| FIX5 release decision | **NOT_VERIFIED** |

## Native Browser limitation

Chromium was found and launched successfully:

- Executable: `/usr/bin/chromium`
- Version: `Chromium 144.0.7559.96`

The Browser policy blocked the temporary persistent web origin before page execution:

`net::ERR_BLOCKED_BY_ADMINISTRATOR`

The suite therefore returned exit code `2` and `NOT_VERIFIED`. This is not represented as a PASS and is not treated as an application defect.

## Storage Contract coverage

The 24 passing assertions cover:

- IndexedDB backend selection
- Session save/list
- Image record save/load
- Invalid session/image fail-closed behavior
- Corrupt session/image quarantine
- Stable usage summaries
- 500-image per-session limit
- 20-session limit
- Delete-session cascade
- Clear-all
- V1 → V2 session migration
- V1 → V2 image migration
- Decision/note preservation for audit
- Visual re-review requirement
- Idempotent migration
- Backup-before-migrate
- Explicit bounded in-memory fallback

## Production and XMP boundary

The FIX4 Runtime baseline remains:

- `productionSource = legacy`
- `productionWrite = false`
- `controlledV2Apply = false`
- `previewExport = false`
- Controlled V2 Candidate approval does not activate Production
- XMP before/after length: 2964 / 2964
- XMP SHA-256 before/after: `e609d864bcbb2fdab75a195bd823a86428490c8e9347f40201d3aee53168f799`

FIX5 changed QA files and package scripts only. Production-locked files remain equal to the checked-in 92-file manifest.

## Release boundary

Do not begin EPIC 2E-L until `RUN_LUMIXA_FIX5_QA_WINDOWS.bat` returns `FINAL_PASS` in a local environment where Chrome or Edge can open a localhost origin and use native IndexedDB.
