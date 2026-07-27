# EPIC 2E-K-R2-FIX5 Release Notes

## Added

- Dependency-independent IndexedDB Storage Contract QA
- Native Browser IndexedDB persistence QA through CDP
- Fail-closed FIX5 release gate
- Windows end-to-end QA runner
- Fresh structured QA evidence for Storage Contract, Native Browser, and Release Gate

## Changed

- `test:calibration-storage` now runs the deterministic Storage Contract.
- `test:calibration-storage:official` retains the official `fake-indexeddb` implementation test after `npm ci`.
- Save Gate QA no longer crashes when registry dependencies are unavailable.
- Full static suites include FIX5 Storage Contract.

## Safety

No Production Mapping, XMP generation, Controlled V2 activation, Preview export, or Candidate Review behavior was changed.

## Current status

`NOT_VERIFIED` — all code-level and deterministic storage gates pass, but Native Browser IndexedDB could not execute because this environment blocks the required localhost origin by administrator policy.


## FIX5.1 Windows QA closure
- Corrected Windows Chrome/Edge paths with `path.join()`; previous template literals removed path separators.
- Added Chrome for Testing / Playwright cache discovery and PATH discovery.
- Native IndexedDB runner now passes Playwright Chromium into the unified detector.
- Browser contract static test now uses `process.execPath`, making it deterministic on Windows/macOS/Linux.
- `node_modules` is allowed in the QA workspace after `npm ci` and remains explicitly excluded from release ZIPs.
