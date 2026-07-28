# EPIC 2E-M — Guided Candidate Cohort Intake Architecture

The feature is a presentation and workflow layer over the existing Calibration Lab and Candidate Pilot.

## Flow

1. Real Legacy and Controlled V2 evidence must already be eligible.
2. The reviewer selects one canonical decision code.
3. Optional issue codes and notes are added.
4. The controller persists the record.
5. `buildCohortSaveReceipt()` evaluates strict Candidate Pilot eligibility.
6. The UI shows a semantic save result and updates Cohort progress.
7. The reviewer may jump to the next `NOT_REVIEWED` record.

## Canonical state

The new result codes are:

- `DECISION_SAVED_TO_COHORT`
- `DECISION_SAVED_EXCLUDED`
- `CURRENT_ANSWER_CLEARED`
- `IMAGE_ADDED_TO_SESSION`

Localized sentences are presentation-only and are never stored as canonical decisions.

## Production boundary

The receipt and QA snapshot hard-lock:

- `productionSource = legacy`
- `productionWrite = false`
- `controlledV2Apply = false`
- `previewExport = false`

No code path in this EPIC serializes, downloads, applies, or activates XMP/Controlled V2 Production output.
