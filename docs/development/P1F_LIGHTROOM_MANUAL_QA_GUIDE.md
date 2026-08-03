# P1F Lightroom Manual QA Guide

Automated QA in this repository proves that the web app computes
bounded, evidence-driven Basic Panel values, writes them faithfully
into the Candidate, and serializes them into a well-formed XMP sidecar
whose Basic-panel properties match the Candidate exactly (Export
Parity + XMP Readback Fidelity Gate, tests 51-60 of
`qa/epic-2e-p1f-basic-tone-intelligence-test.mjs`). It **cannot** prove
what Adobe Lightroom itself displays after importing that XMP — no
Lightroom license/binary is available in this environment. The
following manual steps close that gap.

## Prerequisites

- Adobe Lightroom Classic (or Lightroom desktop) with XMP sidecar
  import enabled.
- A test image reachable by both the LUMIXA web app and Lightroom.

## Steps

1. **Upload a genuinely underexposed photo** (dark midtones, some real
   shadow clipping) to the LUMIXA app. Confirm the app reaches Ready
   and note the Basic Panel values shown in the app's own UI
   (Exposure should be positive; Shadows likely positive too).
2. **Open the Advanced Diagnostics → Basic Tone Intelligence** panel.
   Confirm it shows a `sceneClass` of `UNDEREXPOSED`, a confidence
   score, and a row per Basic field with an Export Expected value and
   an XMP Readback value marked as matching.
3. **Download the `.xmp` sidecar** and import it onto the same source
   image in Lightroom (right-click the image → "Read Metadata from
   File" after placing the `.xmp` beside it, or use "Sync Settings"
   from a virtual copy with the XMP applied).
4. **Compare Lightroom's own Basic Panel slider positions** (Exposure,
   Contrast, Highlights, Shadows, Whites, Blacks, Texture, Clarity,
   Dehaze) against the values shown in step 2's Advanced Diagnostics
   panel. They must match exactly (within Lightroom's own display
   rounding for Exposure, which Lightroom shows in EV to 2 decimal
   places — e.g. Candidate `exposure: 12` → Lightroom `+0.12`).
5. **Repeat with a bright/overexposed photo** (real highlight
   clipping) and confirm Highlights/Whites/Exposure are all negative
   in both the app and Lightroom, in agreement.
6. **Repeat with a hazy/low-contrast landscape** and confirm Dehaze
   and Clarity are both non-zero and positive in both the app and
   Lightroom, and that a normal, non-hazy photo shows Dehaze exactly
   `0` in both places (never a leftover non-zero value from a
   different, generic "auto contrast" heuristic).
7. **Repeat with a portrait containing visible skin** and confirm
   Texture/Clarity are visibly smaller in magnitude than the same
   values would be on a non-portrait, high-detail scene with the same
   scene classification — skin-safe scaling should be perceptible.

## What "pass" means

Every Basic Panel slider Lightroom displays after import must be
numerically identical (subject only to Lightroom's own display
rounding) to what the LUMIXA app's Advanced Diagnostics panel reported
as the Export Expected / XMP Readback value for that same field. Any
discrepancy indicates either a serialization bug (unlikely — covered
by the automated Fidelity Gate) or a genuine Lightroom-side unit/scale
misunderstanding worth filing as a follow-up defect.
