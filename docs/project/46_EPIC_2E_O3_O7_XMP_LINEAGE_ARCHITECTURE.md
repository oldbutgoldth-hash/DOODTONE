# EPIC 2E-O3–O7 — True Pairwise XMP Lineage Architecture

## Purpose

Repair the proven failure where the analysis pipeline appeared active but the downloaded XMP contained near-default Lightroom values. The Candidate path now proves every supported value from Reference/Target evidence through compensation, safety, serialization and XML readback.

## O3 — Data Lineage and Candidate Serializer

The Candidate XMP path is separate from the Legacy Production serializer. It records:

1. Reference minus Target delta
2. Photographic compensation intent
3. Raw Candidate value
4. Target-aware/Safety-clamped value
5. Serializer input
6. Parsed XMP readback

A mismatch returns `XMP_PARAMETER_PIPELINE_MISMATCH` and disables download.

## RAW White Balance Rule

A RAW preset needs the current Target Lightroom Temperature and Tint as its base. LUMIXA no longer invents 5500 K. The user enters the values shown by Lightroom before applying the Candidate.

The system then writes:

- final Temperature = Target base Temperature + bounded pairwise Kelvin delta
- final Tint = Target base Tint + bounded pairwise Tint delta

Missing RAW base values return `TARGET_RAW_WB_BASE_REQUIRED`.

## Camera Profile Policy

Candidate XMP omits Camera Profile and Look fields. Lightroom therefore retains the profile already selected on the Target image. Reference profile data is never copied.

## O4 — Structural Readback

After serialization, LUMIXA parses its own XMP and compares Basic Tone, HSL, Color Grading, Calibration, Tone Curves and WB. Any mismatch fails closed.

## O5 — Direction and Non-degeneracy Gate

The gate verifies that Candidate movement agrees with the Reference-to-Target direction. It also blocks high Match Need candidates with too few active parameters or insufficient effective magnitude.

## O6 — True Pairwise Preview

The Reference Color Match UI explicitly presents:

1. Reference
2. Target Original
3. Target Matched Preview

Legacy/Controlled V2 comparison remains a separate engineering console and is not used as the primary Color Match preview.

## O7 — Lightroom Verification Boundary

The Candidate remains non-Production. A real JPEG/TIFF exported from Lightroom must be re-imported for photographic fidelity measurement before any Beta/Production decision.

## Production Locks

- `productionSource = legacy`
- `productionWrite = false`
- `xmpWriteAllowed = false`
- `controlledV2Apply = false`
- `productionActivationAllowed = false`
