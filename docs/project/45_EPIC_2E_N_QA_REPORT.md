# EPIC 2E-N1–N5 — QA Report

## Decision

`FINAL_PASS` for the isolated Core Color Match candidate implementation.

This decision does **not** mean Production-ready. Production remains Legacy and real-photo/Lightroom validation is still required.

## Fresh gate evidence

- ESM syntax: 217/217 PASS
- Full static suites: PASS
- N1 Signature: 9/9 PASS
- N1 Integration: 6/6 PASS
- N2 Compensation: 7/7 PASS
- N3 Lightroom Candidate: 5/5 PASS
- N4 Preview/Evaluation: 5/5 PASS
- N5 Evaluation Harness: 4/4 PASS
- N1–N5 Integration: 5/5 PASS
- Real Chromium runtime: PASS
- Production/XMP source invariant: PASS, 0 mismatches
- Package cleanliness: PASS

## Deterministic browser fixture result

Browser: Chromium 144.0.7559.96

The fixture uses the same synthetic scene rendered as a warm editorial Reference and a cool/flat Target.

- Candidate state: `MAPPED_CANDIDATE`
- Evaluation state: `MATCH_CANDIDATE_STRONG`
- Photographic style distance: 19.673 → 5.909
- Overall reduction: 69.96%
- White-balance reduction: 83.62%
- Tone reduction: 48.86%
- Transferable-color reduction: 61.12%
- Fidelity score: 80.73/100
- Preview pixels changed: 172,800/172,800
- Mean absolute channel difference: 20.539
- Highlight clipping: 0%
- Shadow clipping: 0%
- Page/runtime failure: none reported by the dedicated test

The deterministic fixture proves pipeline execution and regression behavior. It does not replace validation with the user's real photographic work.

## Safety evidence

- Low evidence blocks compensation fail-closed.
- Object-color bias dampens WB transfer.
- Skin evidence reduces risky red/orange/yellow movement.
- Highlight/shadow risk reduces tone transfer.
- Candidate XMP cannot mutate Production state.
- Evaluation records contain no image payload or local path.
- Production engine source hashes remain equal to the N1 baseline.

## Required before Production

1. Validate diverse real Reference/Target pairs.
2. Import Candidate XMP into Lightroom and compare against LUMIXA Preview.
3. Record mismatches by WB, tone, HSL, skin and clipping.
4. Calibrate preview-to-Lightroom fidelity where needed.
5. Complete Reference Color Match Beta only after the Core results are stable.
