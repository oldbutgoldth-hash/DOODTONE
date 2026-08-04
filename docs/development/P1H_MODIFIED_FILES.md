# P1H — Modified / New Files

## New — core modules
- `core/single-image/white-balance-intelligence/white-balance-schema.js`
- `core/single-image/white-balance-intelligence/wb-evidence-extractor.js`
- `core/single-image/white-balance-intelligence/neutral-region-confidence.js`
- `core/single-image/white-balance-intelligence/illuminant-object-bias-separator.js`
- `core/single-image/white-balance-intelligence/skin-consistency-validator.js`
- `core/single-image/white-balance-intelligence/mixed-light-detector.js`
- `core/single-image/white-balance-intelligence/cast-classifier.js`
- `core/single-image/white-balance-intelligence/wb-guardrails.js`
- `core/single-image/white-balance-intelligence/wb-lineage.js`
- `core/single-image/white-balance-intelligence/wb-plan-builder.js`

## New — tests
- `qa/epic-2e-p1h-white-balance-intelligence-test.mjs`

## New — docs (this set, 14 files)
- `docs/development/P1H_WHITE_BALANCE_VALUE_LINEAGE_AUDIT.md`
- `docs/development/P1H_ILLUMINANT_OBJECT_BIAS_POLICY.md`
- `docs/development/P1H_P1E_WHITE_BALANCE_COLOR_OWNERSHIP.md`
- `docs/development/P1H_CANDIDATE_INTEGRATION_ORDER.md`
- `docs/development/P1H_WB_PLAN_SCHEMA_MAPPING.md`
- `docs/development/P1H_CAST_CLASSIFICATION_REFERENCE.md`
- `docs/development/P1H_MIXED_LIGHT_DETECTION.md`
- `docs/development/P1H_TEMPERATURE_TINT_GUARDRAILS.md`
- `docs/development/P1H_STRENGTH_MODES.md`
- `docs/development/P1H_ADVANCED_DIAGNOSTICS_UI.md`
- `docs/development/P1H_QA_REPORT.md`
- `docs/development/P1H_MODIFIED_FILES.md` (this file)
- `docs/development/P1H_KNOWN_LIMITATIONS.md`
- `docs/development/P1H_RELEASE_NOTES.md`

## Edited (existing files)
- `ui/app.js` — wired the pre-existing unused `colorCast` evidence slot;
  added `renderWBIntelligenceDiagnostics()` + call site.
- `ui/i18n/en.js`, `ui/i18n/th.js` — 15-17 new `wb*` keys each.
- `index.html` — new `#wbIntelDiagnostics` Advanced Diagnostics block.
- `core/single-image/candidate/candidate-builder.js` — added
  `buildWhiteBalancePlan()` call + `whiteBalance.temperature/.tint`
  overwrite + `diagnostics.whiteBalanceIntelligence` assignment.
- `qa/run-static-suites.mjs` — registered the new P1H suite.
- `qa/baselines/lufa42-production-lock-manifest.json` — regenerated
  (192 hashes).
- `qa/baselines/epic-2e-n1-production-invariant.json` — `ui/app.js`
  pinned hash deliberately updated.
- `package.json` — version → `2.8.0`, description updated.

## Explicitly NOT touched
- `core/whitebalance-engine/index.js` (legacy `analyzeWhiteBalance`,
  `sliderToKelvin`/`kelvinToSlider`) — read-only reference.
- `core/lightroom-mapping-engine/index.js` (`_mapWhiteBalance`,
  `_moodPreservation`) — read-only reference, left fully intact per
  architecture precedent.
- `core/xmp-validator/index.js` (`HARD_LIMITS`, `quickSafetyClamp`) —
  read-only reference; P1H's own guardrails stay inside these.
- Any P1E hsl/grading/cal field, any P1F basic-tone field.
