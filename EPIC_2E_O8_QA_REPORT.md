# EPIC 2E-O8 QA Report

## Final release gate

- Release decision: FINAL_PASS
- ESM syntax gate: 235/235 PASS
- Full static suites: PASS
- O8 perceptual integration: 8/8 PASS
- Production/XMP locked-file mismatches: 0

## Perceptual and transfer validation

- CIEDE2000 published Sharma reference vector: PASS
- D65 sRGB to Lab white reference: PASS
- Gaussian hue wraparound at 0/360 degrees: PASS
- Production Gaussian HSL transfer path: PASS
- 13-point master and per-channel tone curves reach the Candidate mapper: PASS
- CDF histogram evidence is merged into bounded Candidate curves: PASS
- Candidate Preview applies the same point curves used by Candidate XMP: PASS
- Candidate curve to XMP to structural parser readback: PASS

## Chromium runtime

- Browser: Chromium 144.0.7559.96
- Perceptual pixel transfer: PASS
- Gaussian HSL production engine: PASS
- Point curves applied to Preview: PASS
- Point curves read back exactly from XMP: PASS
- Match Need: 14.12 → 7.92
- Overall reduction: 55.80%
- Tone reduction: 55.97%
- Palette reduction: 60.17%
- Newly clipped highlights: 0%
- Newly clipped shadows: 0%
- Production source: legacy
- Production write: false

## Honest validation boundary

The automated Lightroom round-trip branch uses deterministic same-signature evidence to verify evaluator plumbing. It is not Adobe Camera Raw rendering and does not replace a real Lightroom export test. Photographic acceptance still requires applying the Candidate XMP to the actual Target in Lightroom, exporting JPEG/TIFF, and returning that image to LUMIXA for drift measurement.
