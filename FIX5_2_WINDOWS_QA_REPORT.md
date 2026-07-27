# EPIC 2E-K-R2-FIX5.2 — Windows QA Evidence Closure

## Root causes corrected

1. The Calibration Lab hostile static suite recursively launched the complete Local Gate. On Windows this could time out or contend with a real Edge/Chrome QA session, producing an environment-dependent false failure.
2. Release Gate displayed `nativeBrowserIndexedDbVerified: false` from the deterministic storage-contract result even after the real Native Browser IndexedDB suite passed.
3. Edge could report `Opening in existing browser session.` for `--version`; Windows file metadata is now used as a truthful version fallback.

## Fixes

- Added one shared cross-platform source-hash freshness guard used by both Local Gate and hostile QA.
- Replaced recursive Local Gate spawning with deterministic tests against that exact guard.
- Native Browser IndexedDB verification is derived from fresh browser evidence: seed round-trip, reload persistence, delete cascade, no page errors, and no console errors.
- Browser version evidence attempts Windows executable file-version metadata when command output is not a numeric version.

## Safety boundary

- Production source remains Legacy.
- Production write remains disabled.
- Controlled V2 apply remains disabled.
- Preview export remains disabled.
- Candidate Review never activates Production or writes XMP.
