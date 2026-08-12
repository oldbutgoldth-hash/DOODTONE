# EPIC 2E-P1L — Modified / New Files

## New files (2)

- `core/single-image/parametric-tone-intelligence/parametric-tone-schema.js`
  — schema version, strength modes/scalars, `PIXEL_TO_SLIDER_SCALE`,
  `MAX_PARAMETRIC_DEVIATION` (Layer-A bound), `buildEmptyParametricTonePlan()`.
- `core/single-image/parametric-tone-intelligence/parametric-tone-plan-builder.js`
  — `buildParametricTonePlan(evidence, {strengthMode})`, deriving
  Shadows/Midtones/Highlights slider values from the existing master
  point-curve's deviation from identity at x=64/128/192.

## Modified files (2)

- `core/single-image/candidate/candidate-builder.js` — imports
  `buildParametricTonePlan` + `DEFAULT_STRENGTH_MODE`; adds a new block
  (additive, placed after the existing P1J tone-curve diagnostics block)
  that calls the plan builder and, only when the plan engages, overwrites
  `candidate.curves.parametric` with the derived values (replacing the old
  static `rawPreset.crv_sh ?? 0` fallback for that case); always writes
  `candidate.diagnostics.parametricToneIntelligence`.
- `core/xmp-validator/index.js` — adds `HARD_LIMITS.parametricCurve`
  (shadows/midtones/highlights, ±60) and a new `_clampParametricCurvePanel()`
  function, called from `quickSafetyClamp()` right after the existing
  `_clampEffectsPanel()` call (Layer-B safety net, third deliberate edit to
  this file this EPIC-2E round — first was P1J's point-curve clamp, second
  was P1K's effects clamp).

- `ui/app.js` -- `renderToneCurveIntelligenceDiagnostics()`'s Parametric note
  now branches on `candidate.diagnostics.parametricToneIntelligence.engaged`
  instead of always showing the old "not supported" text (which became
  false once P1L's engine engages). Second deliberate edit to this file
  this EPIC-2E round.
- `ui/i18n/en.js`, `ui/i18n/th.js` -- added `toneCurveParametricEngaged` and
  `toneCurveParametricNotEngaged` keys (bilingual); the old
  `toneCurveParametricUnsupported` key is left in place, unused, per the
  additive-only-changes convention.

## Test infrastructure

- `qa/epic-2e-p1l-parametric-tone-curve-test.mjs` (new, 21 checks) —
  schema/empty-plan fallback, real derivation from master-curve deviation,
  Layer-A bound + strength-mode scaling, Layer-B safety clamp, full
  round-trip export (legacy-preset-adapter → quickSafetyClamp →
  serializeXMP → readback → comparator), candidate-builder wiring.
- `qa/run-static-suites.mjs` — registered the new P1L suite after the P1K
  entry.
- `qa/epic-2e-p1k-serializer-effects-extension-test.mjs` — test 31's
  hardcoded locked-manifest file count updated from 206 to 208 (P1L
  legitimately added 2 new locked files; the byte-identical hash check,
  the safety-critical part of the assertion, is unchanged).

## Production-lock baselines (updated, not code)

- `qa/baselines/epic-2e-n1-production-invariant.json` — `core/xmp-validator/index.js`
  hash updated to reflect its third deliberate edit this EPIC-2E round.
  All 5 other pinned files (`reference-xmp-generator.js`,
  `lightroom-mapping-engine/index.js`, `preset-engine/index.js`, `ui/app.js`,
  `ui/ui-engine.js`) verified byte-identical before and after — untouched.
- `qa/baselines/lufa42-production-lock-manifest.json` — regenerated via
  `node qa/baselines/generate-production-lock-manifest.mjs`; grew from 206
  to 208 locked files (picks up the 2 new parametric-tone-intelligence
  files); `core/xmp-validator/index.js` and
  `core/single-image/candidate/candidate-builder.js` hashes updated to
  match this round's deliberate edits. Every other one of the 206
  pre-existing entries verified byte-identical before regeneration.

## package.json

- `version`: `2.11.0` → `2.12.0`.
