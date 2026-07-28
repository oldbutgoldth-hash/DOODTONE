# EPIC 2E-O8 — Best-of-Both Perceptual True Color Match

This release integrates the useful OpenCode color-transfer concepts into LUMIXA's latest pairwise Candidate/XMP safety architecture.

## Integrated into the real pipeline

- D65 sRGB → XYZ → Lab conversion
- Oklab conversion and perceptual distance utilities
- CIEDE2000 implementation verified with a published reference vector
- Gaussian HSL channel transfer with sigma 25° and correct 0°/360° wraparound
- 13-point percentile tone-curve transfer
- Per-channel R/G/B tone curves
- Per-channel CDF histogram matching
- Bounded merge of histogram and tone-curve evidence
- Target-aware curve dampening for high-key and neutral-white scenes
- Exact same point-curve set used by Candidate Preview and Candidate XMP
- Candidate XMP structural readback verifies all four curves

## Kept from the LUMIXA safety architecture

- Reference + Target pairwise analysis
- Target RAW Temperature/Tint base requirement
- Target camera-profile preservation by XMP omission
- XMP data lineage
- Match-direction gate
- Near-empty/degenerate XMP blocking
- Neutral-white, skin and scene-object protection
- Lightroom round-trip evaluator
- Legacy Production hard lock

## Honest boundary

Browser Preview remains an approximation and not Adobe Camera Raw. Real photographic validation still requires applying the Candidate XMP in Lightroom and returning the exported JPEG/TIFF to LUMIXA.
