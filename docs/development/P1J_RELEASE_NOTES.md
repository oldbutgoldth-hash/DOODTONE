# P1J — Release Notes (v2.10.0)

## EPIC 2E-P1J — Tone Curve Intelligence & Point-Curve Export Wiring

### What changed for the user

Every AI-analyzed photo's point-curve recommendation — the histogram-derived
S-curve and per-channel (red/green/blue) cast-correction curve that
`generateToneCurves()` was already computing on every analysis run — now
actually reaches the exported Lightroom preset's Tone Curve
(`crs:ToneCurvePV2012[Red/Green/Blue]`). Previously this recommendation
only fed a decorative preview and the optional manual Curve Editor; the
exported XMP always fell back to a flat identity curve regardless of the
photo's actual tonal content. Photos analyzed with this build will now
carry a real, photo-specific tone curve on export.

An Advanced Diagnostics panel (collapsed by default, matching the
existing Basic Tone / Detail / White Balance panels) shows the tone
category, confidence, per-channel engagement reasons, and a
Candidate-vs-export-expected point-count table for each channel —
available in both English and Thai.

### What did not change

- The Basic Panel, Color, Detail, and White Balance Intelligence layers
  are unaffected.
- Parametric Tone Curve sliders (Shadows/Midtones/Highlights) are
  unaffected — they were never driven by an engine and remain a
  documented, explicit non-goal of this round.
- No new user-facing controls or settings were added; this is a
  wiring/root-cause fix plus its accompanying diagnostics, not a new
  feature surface.

### Safety

A new export-time safety net (`_clampToneCurvePanel()` in
`xmp-validator/index.js`) sits alongside the existing per-panel clamps
(Basic, Detail, White Balance) and keeps every exported curve point
within a calibrated safe range, independent of the plan-builder's own
internal restraint layer — the same two-layer pattern this project uses
for every AI-generated export value. Verified against the real engine's
actual output range so no legitimate photo-specific curve is ever
incorrectly clamped.

### Regression

All prior EPICs (P1A through P1I R2) re-verified independently and pass
in full — see `P1J_QA_REPORT.md` for the complete suite-by-suite
breakdown.
