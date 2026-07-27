# EPIC 2E-K-R2-FIX4 — Release Notes

## Preview-first workflow

- Controlled V2 Preview now generates from Safety/Render eligibility before Candidate Review.
- Candidate Review controls remain disabled until both current-generation preview canvases are rendered.
- Candidate Review starts pending and cannot be auto-approved by system evidence.
- The preview control is now view-only; it never re-runs Analysis.
- New analysis generations invalidate prior Candidate Review and preserve bounded audit history.

## Candidate-only approval

- Approval updates only Candidate Review state.
- Even complete approval keeps Production source on Legacy.
- Production write, Controlled V2 apply, Preview export, Production activation, and XMP mutation remain disabled.
- UI wording now explicitly says Candidate Review approval does not enable Production/XMP.

## QA hardening

- Added FIX4 static/functional test coverage.
- Browser detection NOT-FOUND tests no longer depend on whether the host machine has Chromium.
- Updated locale tests for the new view-only preview control.
- Added real Chromium CDP result evidence and exact XMP invariant.

## Known environment limitation

`fake-indexeddb` and Playwright packages were not available in the execution environment, and registry installation was unavailable. Storage-dependent Node suites are therefore marked not verified rather than falsely passed.
