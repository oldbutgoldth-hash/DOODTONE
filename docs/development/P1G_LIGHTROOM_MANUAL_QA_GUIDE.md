# P1G Lightroom Manual QA Guide

Automated QA in this repository proves that the web app computes
bounded, evidence-driven Detail values, writes them faithfully into
the Candidate, and serializes them into a well-formed XMP sidecar
whose Detail properties match the Candidate exactly (Export Parity +
XMP Readback Fidelity Gate, tests 44-49 of
`qa/epic-2e-p1g-detail-intelligence-test.mjs`). It **cannot** prove
what Adobe Lightroom itself displays after importing that XMP — no
Lightroom license/binary is available in this environment. The
following manual steps close that gap.

## Prerequisites

- Adobe Lightroom Classic (or Lightroom desktop) with XMP sidecar
  import enabled.
- A test image reachable by both the LUMIXA web app and Lightroom.

## Steps

1. **Upload a genuinely detailed, clean, low-noise landscape photo**
   (fine texture, sharp focus). Confirm the app reaches Ready and note
   the Detail values shown in the app's own UI (Sharpening should be
   relatively high, e.g. in the 18-35 range; Noise Reduction should be
   low, close to 0).
2. **Open the Advanced Diagnostics → Detail Intelligence** panel.
   Confirm it shows real scene flags (e.g. `CLEAN_HIGH_DETAIL` or
   `FINE_TEXTURE`), a confidence score, and rows for Sharpening and
   Noise Reduction each with a rationale, plus a Color Noise Reduction
   note explicitly stating it is unsupported/diagnostic-only.
3. **Download the `.xmp` sidecar** and import it onto the same source
   image in Lightroom.
4. **Compare Lightroom's own Detail panel slider positions**
   (Sharpening, Noise Reduction — Luminance) against the values shown
   in step 2's Advanced Diagnostics panel. They must match exactly —
   both are plain integer Lightroom slider values with no
   unit-conversion ambiguity (unlike Exposure's EV notation).
5. **Repeat with a noisy, low-light, motion-blurred or soft-focus
   photo.** Confirm Sharpening stays restrained (bounded to 0-18 in
   both the app and Lightroom) and Noise Reduction is visibly higher
   than in step 1, in agreement between the app and Lightroom.
6. **Repeat with a skin-heavy portrait shot at high ISO/noisy
   conditions.** Confirm Noise Reduction never reaches the strongest
   bucket's ceiling (oversmoothing protection) and that the resulting
   skin does not look artificially smoothed/plastic when previewed in
   Lightroom's Develop module — this is the one check that requires
   genuine human visual judgment, not just a numeric comparison.
7. **Confirm Color Noise Reduction in Lightroom always shows `25`**
   regardless of what the Advanced Diagnostics panel's diagnostic-only
   `recommended` value says — this is expected and correct: the
   serializer always hardcodes `25` for this field, and the app never
   claims otherwise once you read the panel's explicit unsupported
   note.

## What "pass" means

Every Detail Panel slider (Sharpening, Noise Reduction) Lightroom
displays after import must be numerically identical to what the
LUMIXA app's Advanced Diagnostics panel reported as the Export
Expected / XMP Readback value for that same field. Step 6's visual
skin-quality check requires human judgment and cannot be automated,
but should show a natural (not plastic) result. Any numeric
discrepancy indicates either a serialization bug (unlikely — covered
by the automated Fidelity Gate) or a genuine Lightroom-side unit/scale
misunderstanding worth filing as a follow-up defect.
