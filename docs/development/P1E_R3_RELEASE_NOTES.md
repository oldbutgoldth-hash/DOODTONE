# EPIC 2E-P1E R3 — Release Notes

**Version:** 2.5.1 → 2.5.2
**Title:** XMP Color Parity Repair + Stronger Creative Tone Engine

## Summary

R3 delivers two objectives on top of the P1E R2 baseline: (A) a full,
source-verified audit of the Color Plan → Candidate → UI → XMP
pipeline proving where UI-vs-export divergence can and cannot occur,
plus a new parity-checking utility and trace events; (B) a
scene-aware, skin-safe, bounded creative-tone strengthening layer for
scenes that are technically correct but visually flat.

## Objective A — Parity

- Traced all 8 named value stages per color parameter from source; see
  `P1E_R3_COLOR_VALUE_PARITY_AUDIT.md`.
- Conclusion: P1E-authored (auto-generated) values can never trigger
  `quickSafetyClamp()` — P1E's own `BOUNDS` are proven strictly
  tighter than every clamp cap they can reach. The one real
  divergence path is a manual out-of-bounds slider edit.
- New `computeExportParity()` / `getExportParityMismatches()`
  (`core/single-image/color-intelligence/candidate-export-parity.js`):
  recomputes the export-safe preset fresh from the live Candidate and
  diffs it field-by-field, independent of P1D's existing Fidelity
  Gate (which instead compares exported-preset vs. parsed-XMP
  readback). The two layers are complementary, not redundant.
- New Advanced Diagnostics panel (opt-in, UI) surfaces any parity
  mismatch in plain language — never raw XML.
- New trace events: `COLOR_PARITY_AUDIT_STARTED`,
  `COLOR_EXPORT_SAFE_ADJUSTMENT`, `COLOR_PARITY_MATCH` /
  `COLOR_PARITY_MISMATCH`, `COLOR_PARITY_AUDIT_COMPLETED`.
- **Genuine defect found and fixed**: fractional color values (e.g.
  `18.099999999999998`) were serialized verbatim into XMP since
  `serializeXMP()` never rounded them. Fixed via `_roundClean()` in
  `color-plan-builder.js` — every P1E-authored field is now a clean
  integer end-to-end.

## Objective B — Creative Tone Strength

- New `core/single-image/color-intelligence/creative-tone-strategy.js`:
  `classifyScene()` (skin protection checked first, structural
  priority) + `getFamilyMultiplier()`, bounded to `[0.5, 1.3]` per
  family (`hslNonSkin`, `presenceVibrance`, `presenceSaturation`,
  `grading`, `calibration`) across 6 scene classes (Portrait/Skin,
  Green Outdoor, Colorful Costume, Already Saturated, Low Saturation,
  Generic).
- 4 strength modes — NATURAL (0.35), BALANCED (0.70, default),
  CINEMATIC (1.00), STRONG (1.30) — composed into the existing
  restoration-fraction math (`fraction = strengthScalar × sceneMult ×
  skinCaution`), never a parallel/duplicate computation.
- `plan.layers.technicalCorrection` / `plan.layers.creativeTone` now
  carry an explainable record of what was applied and why.
- **Genuine defect found and fixed**: `color-intelligence-engine.js`'s
  `diagnostics` object silently dropped `plan.sceneClass` /
  `plan.sceneReasons` / `plan.layers`, so `sceneClass` was always
  `null` in production despite being computed correctly. Fixed by
  adding the 3 fields to the diagnostics object.

## New files

- `core/single-image/color-intelligence/creative-tone-strategy.js`
- `core/single-image/color-intelligence/candidate-export-parity.js`
- `qa/epic-2e-p1e-r3-parity-creative-tone-test.mjs` (62 cases: 55
  numbered + 7 mutation tests)
- `qa/epic-2e-p1e-r3-browser-qa.mjs` +
  `qa/epic-2e-p1e-r3-browser-qa-result.json`
- 10 documentation files under `docs/development/` (this file plus 9
  others — see `P1E_R3_MODIFIED_FILES.md` for the full list)

See `P1E_R3_MODIFIED_FILES.md` for the complete new/edited/untouched
file inventory, and `P1E_R3_KNOWN_LIMITATIONS.md` for scope
boundaries (manual-edit divergence remains possible by design;
Grading/Calibration-Hue have no export-time clamp; no Lightroom
binary was available for direct verification).

## Test results (see `P1E_R3_QA_REPORT.md` for full detail)

62/62 new R3 cases PASS, 94/94 P1E, 86/86 P1C, 71/71 P1D, 19/19 P1C
R2, 39/39 P1C R3 all still PASS, 69/69 full static suite PASS,
Production Lock manifest stable at 164 files (0 drift), N1 invariant
hash confirmed current. Browser QA honestly reports
`BROWSER_BINARY_UNAVAILABLE` (no Chromium in this sandbox).
