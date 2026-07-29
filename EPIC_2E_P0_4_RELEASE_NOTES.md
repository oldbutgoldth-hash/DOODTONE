# EPIC 2E-P0.4 — Fast Critical Preview Path

## Problem
Reference Color Match Beta could remain blocked at Image Analysis Core even after Skin Tone Detection Pro was deferred. The comprehensive reporting engine still ran synchronously in the critical Reference/Target/Matched Preview path.

## Resolution
- Removed Image Analysis Core from the blocking preview path.
- Preserved an explicit deferred contribution record for audit honesty.
- Pairwise preview now relies on the fast required evidence: palette, tone zones, skin classification, histogram, white balance, tone curve, HSL, color grading, and calibration.
- Image Analysis Core remains available to the main AI Tone Extractor/reporting workflow.
- Skin Tone Detection Pro remains deferred in Reference Color Match Beta.
- Preview errors and Production locks remain unchanged.

## Verification
- ESM syntax: 242/242 PASS
- P0.4 fast-path static checks: 8/8 PASS
- Full static suites: PASS
- O8 Chromium perceptual runtime: PASS
- Production source remains Legacy and all write/activation locks remain disabled.
