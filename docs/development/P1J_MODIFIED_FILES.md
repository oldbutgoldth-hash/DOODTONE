# P1J — Modified / Added Files

## New files

- `core/single-image/tone-curve-intelligence/tone-curve-schema.js`
- `core/single-image/tone-curve-intelligence/tone-curve-plan-builder.js`
- `qa/epic-2e-p1j-tone-curve-intelligence-test.mjs`
- `docs/development/P1J_TONE_CURVE_LINEAGE_AUDIT.md`
- `docs/development/P1J_TONE_CURVE_INTELLIGENCE_ARCHITECTURE.md`
- `docs/development/P1J_EXPORT_SAFETY_CLAMP_CALIBRATION.md`
- `docs/development/P1J_QA_REPORT.md`
- `docs/development/P1J_MODIFIED_FILES.md` (this file)
- `docs/development/P1J_RELEASE_NOTES.md`
- `docs/development/P1J_KNOWN_LIMITATIONS.md`

## Edited files

- `core/single-image/candidate/candidate-builder.js` — added the P1J
  block: imports `buildToneCurvePlan`/`DEFAULT_STRENGTH_MODE`, calls
  `buildToneCurvePlan(evidence, {strengthMode})` after the pre-existing
  (documented, unremoved) `rawPreset.curves` fallback, overwrites
  `candidate.curves.rgb/red/green/blue` when engaged, stashes
  `candidate.diagnostics.toneCurveIntelligence`.
- `core/xmp-validator/index.js` — added `_clampToneCurvePanel()`, wired
  into `quickSafetyClamp()` after `_clampDetailPanel()`; recalibrated the
  pre-existing, previously-unused `HARD_LIMITS.curve` constant (see
  `P1J_EXPORT_SAFETY_CLAMP_CALIBRATION.md`).
- `ui/app.js` — added `renderToneCurveIntelligenceDiagnostics()` +
  `TONE_CURVE_INTEL_CHANNELS` + `_pointArraysEqual()`, wired the call
  site into the existing candidate-render sequence immediately after
  `renderDetailIntelligenceDiagnostics()`.
- `index.html` — added the `#toneCurveIntelDiagnostics` Advanced
  Diagnostics `<details>` section, mirroring the existing Detail/White
  Balance panels' structure exactly (same CSS classes, same disclosure
  convention).
- `ui/i18n/en.js` / `ui/i18n/th.js` — added `toneCurve*` bilingual key
  set (13 keys each: `toneCurveAdvancedDiagnostics`, `toneCurveChannel`,
  `toneCurveCandidatePoints`, `toneCurveExportPoints`,
  `toneCurveCategory`, `toneCurveConfidence`, `toneCurveEngaged`,
  `toneCurveNoAdjustment`, `toneCurvePointsRestrained`,
  `toneCurveExportSafeAdjustmentNotice`, `toneCurveParametricUnsupported`).
- `qa/run-static-suites.mjs` — registered
  `qa/epic-2e-p1j-tone-curve-intelligence-test.mjs`.
- `qa/baselines/epic-2e-n1-production-invariant.json` — updated two
  pinned SHA-256 hashes (`ui/app.js`, `core/xmp-validator/index.js`) to
  match this round's deliberate, documented edits; every other pinned
  file confirmed unchanged.
- `package.json` — version `2.9.1` → `2.10.0`; description updated to
  reference this EPIC.

## Confirmed untouched (production-locked)

- `core/preset-engine/index.js` (the one real, protected XMP serializer)
- `core/color-match/reference-xmp-generator.js`
- `core/lightroom-mapping-engine/index.js`
- `ui/ui-engine.js`
- `core/tone-curve-ai-engine/index.js` (the real engine this round
  reuses, byte-for-byte unmodified — reuse-first, never touched)
- `core/decision-engine/index.js`
- `core/single-image/candidate/legacy-preset-adapter.js`
- `core/single-image/xmp-fidelity/xmp-property-map.js`

All confirmed via direct SHA-256 comparison against the pre-round
baseline, not assumed.
