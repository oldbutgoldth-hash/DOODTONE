# EPIC 2E-P1E R3 — Lightroom Manual Verification Guide

This round's automated tests (94/94 P1E R2, 62/62 new P1E R3, 86/86
P1C, 71/71 P1D, plus the full 69-suite static gate) prove, from real
source and real Node execution: the Candidate's own color values, the
export-safe-clamped preset, the serialized XMP string, and the
readback-parsed values are all numerically identical for every
P1E-authored field. **What automated testing in this sandbox cannot
prove is what Adobe Lightroom itself displays after importing the
generated `.xmp` file** — that requires a human, with real Lightroom,
performing the steps below.

## Why this step is required (honest scope)

- No Lightroom license/binary is available in this environment.
- Chromium/Playwright browser automation (attempted for this round,
  see `P1E_R3_QA_REPORT.md`) can prove the web UI renders the Advanced
  Diagnostics panel and downloads a well-formed `.xmp` file, but cannot
  open or drive Lightroom itself.
- Automated XMP-string parsing (P1D's Fidelity Gate) proves the file's
  attribute values match what was intended — it does not prove
  Lightroom's own preset importer interprets each attribute exactly as
  Adobe's public schema implies. Lightroom version differences,
  regional settings, or undocumented importer behavior are outside
  what any test in this codebase can observe.

## Steps to manually verify

1. Open the LUMIXA AI app in a browser, upload a real photo, and let
   analysis complete.
2. Open the **Advanced Diagnostics — Export Parity** section (below the
   sliders). Note the "Candidate current" value for at least: Red
   Saturation, Green Saturation, Red Luminance, Orange Luminance, one
   Color Grading zone's Hue/Saturation/Luminance, and one Calibration
   primary's Saturation.
3. Click **Download .xmp**.
4. In Lightroom Classic (or Lightroom Desktop with XMP preset import),
   import the downloaded `.xmp` as a new user preset (User Presets
   folder, or via the Develop module's preset import).
5. Apply the preset to any raw/JPEG and open the **Basic**, **HSL /
   Color**, **Color Grading**, and **Camera Calibration** panels.
6. For each value noted in step 2, confirm Lightroom's own slider
   reads the SAME whole number as the app's "Candidate current" /
   "Export expected" column (they should be identical for an
   unedited, auto-generated Candidate, per this round's parity
   guarantee).
7. If any manual slider edit was made in the app before export, repeat
   step 6 specifically for the edited field(s) — this is the one
   scenario where "Export expected" may legitimately differ from
   "Candidate current" (a safety clamp fired); confirm Lightroom shows
   the "Export expected" value, not the raw pre-clamp "Candidate
   current" value.
8. Record the comparison (screenshot or table) — this is the only
   remaining, honestly-out-of-automated-scope step for this round's
   acceptance criteria.

## What NOT to conclude from a mismatch, if one occurs

A mismatch would indicate either: (a) a Lightroom version-specific
interpretation of a documented-but-edge-case XMP attribute, or (b) a
genuine regression in this codebase not caught by the 62 automated R3
tests. Report the exact field, the app's displayed value, and
Lightroom's displayed value — do not assume which cause applies without
first re-running `qa/epic-2e-p1e-r3-parity-creative-tone-test.mjs` to
confirm the automated suite still reports the app-side value as
correct.
