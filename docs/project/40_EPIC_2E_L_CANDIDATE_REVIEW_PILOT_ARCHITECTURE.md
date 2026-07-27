# EPIC 2E-L — Controlled V2 Candidate Review Pilot

## Purpose

EPIC 2E-L adds a read-only Candidate Review Pilot on top of the verified Calibration Lab records created in EPIC 2E-K. The Pilot answers a narrow question: **does Controlled V2 show sufficiently consistent improvement across a verified and covered cohort to justify further human candidate evaluation?**

It does not approve Production. The strongest status is `PILOT_CANDIDATE_EVALUATION_READY`.

## Eligible cohort

A record enters the Pilot cohort only when all of the following are true:

- The human decision is not `NOT_REVIEWED`.
- It is not a migrated audit-only decision and does not require visual re-review.
- `previewEvidence.browserVerified === true`.
- `previewEvidence.visualDecisionEligible === true`.
- Preview truth is `BOTH_RENDERED_DIFFERENT` or `BOTH_RENDERED_IDENTITY`.
- Legacy and Controlled V2 have real non-transparent pixels and valid SHA-256 pixel hashes.
- Source fingerprint, geometry, and analysis generation are current and consistent.

Unverified records remain visible in the Calibration Session but are excluded from Pilot statistics.

## Pilot gates

The default Pilot policy checks:

- Verified reviewed samples and decisive comparisons.
- Skin, mixed-light, category, and lighting coverage.
- Severe issues, safety hard stops, both-unacceptable outcomes, and low confidence.
- Per-category regression.
- Controlled V2 net advantage over Legacy.
- Wilson confidence interval for V2 preference among decisive comparisons.

Possible statuses:

- `PILOT_NOT_STARTED`
- `PILOT_INSUFFICIENT_VERIFIED_SAMPLES`
- `PILOT_COVERAGE_GAPS`
- `PILOT_SAFETY_HALT`
- `PILOT_REGRESSION_HALT`
- `PILOT_NEEDS_MORE_EVIDENCE`
- `PILOT_CANDIDATE_EVALUATION_READY`

`PRODUCTION_READY` is not a valid status.

## UI and export

The Calibration Lab now has a `Candidate Pilot` mode showing:

- Verified and excluded sample counts.
- V2/Legacy wins, ties, and both-unacceptable outcomes.
- Net advantage and Wilson lower bound.
- Coverage, safety, low-confidence, and regression data.
- Every policy criterion with semantic `data-cal-*` evidence.

`Export Candidate Pilot Report` exports only bounded semantic results and cohort hashes. It refuses image payload, Base64, object URL, local file path, pixel buffer, preset, or XMP-shaped fields.

## Production boundary

Hard-coded Pilot locks remain:

- `productionSource = legacy`
- `productionWrite = false`
- `controlledV2Apply = false`
- `previewExport = false`
- `controlledV2ProductionActivation = false`

Candidate Pilot status cannot mutate the Preview Sandbox, Production Mapping, preset engine, or XMP path.
