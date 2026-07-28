# EPIC 2E-O — Target-aware Color Match & Lightroom Round-trip Fidelity

## Why this release exists
A real wedding test showed that an XMP derived from a warm, dark portrait could
push a high-key wedding target too warm and bright. Whites, skin and object
colours require target-aware protection; a browser approximation must also be
measured against the actual Lightroom return rather than treated as Adobe RAW.

## Added
- High-key and neutral-white protection driven by the **target** signature.
- Skin warmth and saturation dampening for already-warm targets.
- Per-channel transferability so scene-object colour populations are not copied as style.
- Lightroom compatibility profile for RAW and rendered-image targets.
- Lightroom round-trip evaluator and UI import slot for an exported JPEG/TIFF/PNG.
- Separate source-clipping, newly-created clipping and recovered-clipping metrics.
- Neutral-white and skin regression diagnostics in Match Evaluation.

## Candidate behaviour
The same bounded safe preset remains the single source for Candidate Preview and
Candidate XMP. The Candidate is still memory-only and cannot activate Production.

## Honest limitation
Browser QA validates the round-trip evaluator using deterministic same-signature
return evidence. It does **not** prove Adobe Lightroom rendering equivalence.
Real Lightroom exports from real RAW targets remain required for calibration.
