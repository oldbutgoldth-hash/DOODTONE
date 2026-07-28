# EPIC 2E-M — Guided Candidate Cohort Intake

## Added

- Three-step review flow: choose result, optionally mark issues, save to Cohort.
- Save buttons remain disabled until real pixel evidence is eligible and a human decision is selected.
- Sticky save bar so the primary action remains visible on long review pages.
- **Save and Go to Next Unreviewed Image** workflow.
- Semantic save receipts showing whether the image entered the Candidate Pilot Cohort.
- Current-image status: pending, saved to Cohort, or saved but excluded.
- Candidate Pilot progress indicator and shortcut to the next unreviewed image.
- Thai/English presentation strings and Browser QA semantic attributes.

## Safety boundary

- Production source remains Legacy.
- Production write remains disabled.
- Controlled V2 Apply remains disabled.
- Preview export remains disabled.
- No Production XMP behavior was changed.

## Verification

- ESM syntax: 196/196 PASS.
- Full static suites: PASS.
- Guided Cohort static: 9/9 PASS.
- Guided Cohort Browser: PASS on Chromium 144.
- Responsive widths 320–1440 px: PASS, no horizontal overflow.
- Production/XMP source invariant: PASS.
- Release decision: FINAL_PASS.
