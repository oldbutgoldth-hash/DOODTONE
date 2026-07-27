# LUMIXA AI — Release Notes R5

## EPIC 2E-J — Final Locale Closure + Semantic QA

This local-first release closes the remaining Thai/English presentation leaks and removes language-dependent QA decisions without changing Production Mapping or XMP output.

## Added

- Complete centralized EN/TH presentation coverage for the app shell, Analysis, support/payment dialogs, Review Console and Data Comparison.
- Stable code-based presenters for known Core dimensions, reasons, recommendations and rollback instructions.
- Semantic live-region state using code, parameters, category and generation ID.
- Locale-neutral Visual Preview QA attributes and evidence.
- Precise 18-region full-system locale audit with fail-closed `visibleNodeCount` coverage.
- Hostile static tests for raw Core prose reaching photographer-facing UI.
- Fail-closed Browser suite runner and local gate result validation.

## Changed

- Locale switching rerenders cached Analysis and UI presentation only; it does not rerun image Analysis.
- Live App tests verify semantic Product truth rather than English wording.
- Step 7B-B verifies Session counters and reason codes through the QA snapshot rather than localized labels.
- Observation warning presentation now uses stable codes.
- Geometry and smoke-test result contracts now distinguish valid not-applicable states from failures.

## Preserved

- Production source: Legacy
- Controlled Test: disabled
- Production write: disabled
- Preview export: disabled
- Production Mapping: unchanged
- XMP: exact unchanged
- Public version label: unchanged

## Verified

- Full-system i18n: 74/74 PASS
- Live App: 51/51 PASS
- Step 7B-B: 183/184 PASS, 0 FAIL, 1 Physical touch NOT_TESTED
- Observation Smoke: 64/64 PASS
- Upload: 18/18 PASS
- Controlled V2: 58/58 PASS
- Local Gate: 13/13 required steps PASS

## Packaging

- No deployment
- No `.git`
- No `node_modules`
- No nested ZIP archives
- No temporary diagnostic files

## EPIC 2E-K-R2-FIX4

Preview is now generated before Candidate Review. Review approval controls only Candidate status and cannot enable Production, Controlled V2 apply, Preview export, or XMP write. No deployment was performed.
