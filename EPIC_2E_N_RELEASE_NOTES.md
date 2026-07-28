# LUMIXA AI v1.5.0 — EPIC 2E-N1–N5 Release Notes

## Completed

- N1 comparable Reference/Target signatures and semantic delta.
- N2 illuminant/object-bias compensation, skin protection and dynamic-range safeguards.
- N3 bounded Lightroom Candidate and in-memory Candidate XMP.
- N4 Kelvin-calibrated preview, matched re-analysis and fidelity evaluation.
- N5 local evaluation harness with privacy-safe records.
- Reference Color Match panel now runs the complete N1–N5 path.
- Dedicated real Chromium QA and fail-closed release gate.

## Important behavior

- The system does not copy Reference values directly to the Target.
- Candidate XMP is explicit and isolated from Production XMP.
- A preview can be evaluated before any Production decision.
- Object distribution is not treated as a command to recolor scene objects.

## Release boundary

- Legacy Production remains active.
- Production write remains disabled.
- Controlled V2 application remains disabled.
- Reference Color Match Beta has not started.
- Real-photo and Lightroom fidelity validation are required before Production work.
