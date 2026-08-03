# P1E — Modified Files

**EPIC 2E-P1E — Color Intelligence & Creative Tone Candidate**
Version 2.5.1 (R2). Baseline: EPIC 2E-P1E R1 (v2.5.0).

## R2 -- Circular Grading Hue fix

- `core/single-image/color-intelligence/color-plan-builder.js` -- added
  two new pure helpers, `normalizeHue(value)` and
  `restoreCircularHue(current, target, fraction)` (both exported, for
  direct unit testing). Changed exactly one call site: Color Grading
  Hue restoration for `shadows`/`midtones`/`highlights` now uses
  `restoreCircularHue()` (gated on `evid.sat !== 0`, else the current
  hue is preserved unchanged) instead of the generic
  `_restoreTowardEvidence()`. No other line in this file changed --
  HSL Hue, Calibration Hue, Grading Saturation, Grading Luminance, and
  every other formula are byte-identical to R1. See
  `P1E_R2_CIRCULAR_GRADING_HUE_FIX.md` for the full before/after and
  rationale.
- `qa/epic-2e-p1e-color-intelligence-test.mjs` -- added one new import
  (`restoreCircularHue`, `normalizeHue`) and one new test section
  (checks 71-90, 24 checks total including lettered sub-cases) covering
  all 18 required circular-hue scenarios. Checks 1-70 (R1) are
  unmodified.
- `package.json` -- version `2.5.0` -> `2.5.1`, description updated.
- `qa/baselines/p1e_r2_full_static_suite_results.txt` (new) --
  per-suite exit-code evidence log from re-running all 68
  `qa/run-static-suites.mjs` suites individually after the fix, from a
  freshly extracted R2 ZIP.
- `P1E_QA_REPORT.md`, `P1E_MODIFIED_FILES.md`, `P1E_RELEASE_NOTES.md`,
  `P1E_CREATIVE_TONE_HEURISTICS.md` -- updated (this document is one of
  them). `P1E_R2_CIRCULAR_GRADING_HUE_FIX.md` -- new.

No other P1E module
(`core/single-image/color-intelligence/color-intelligence-schema.js`,
`evidence-color-signals.js`, `color-intelligence-engine.js`), no
`candidate-builder.js`/`candidate-schema.js` integration point, no
Candidate/Session/XMP/Fidelity-Gate file, and no file from the R1 list
below was touched in R2.

## New files (R1)

- `core/single-image/color-intelligence/color-intelligence-schema.js` —
  pure constants: `STRENGTH_MODE`, `STRENGTH_SCALARS`,
  `DEFAULT_STRENGTH_MODE`, `BOUNDS` (Layer A, independently owned — never
  imports/duplicates `xmp-validator`'s `HARD_LIMITS`),
  `MIN_MEANINGFUL_COVERAGE_PCT`, `MIN_GRADING_CONFIDENCE`,
  `SKIN_ADJACENT_HSL_CHANNELS`, `skinCautionScale()`,
  `buildEmptyColorPlan()`.
- `core/single-image/color-intelligence/evidence-color-signals.js` —
  `deriveColorSignals(evidence)`: pure, read-only, defensive reshape of
  `session.evidence` into a small "color signals" object. Never throws;
  a minimal/soft-failed evidence entry yields "no usable signal", never
  an error or a fabricated default.
- `core/single-image/color-intelligence/color-plan-builder.js` —
  `buildColorPlan({candidateColorFields, signals, strengthMode})`: the
  "restoration toward evidence" math for HSL/Grading/Calibration/Presence.
  Pure function, no Session/DOM/Core-analysis access.
- `core/single-image/color-intelligence/color-intelligence-engine.js` —
  `applyColorIntelligence(candidate, evidence, {strengthMode})`: the
  single entry point called once by `candidate-builder.js`. Mutates only
  `candidate.hsl`, `candidate.grading` (excl. `balance`), `candidate.cal`
  (excl. `shadowTint`), and `candidate.basic.vibrance`/`saturation`.
  Returns a diagnostics object.
- `qa/epic-2e-p1e-color-intelligence-test.mjs` (70/70 checks): schema/
  evidence-signals/plan-builder/engine unit tests, real
  `buildCandidateFromSession()` integration tests (including the exact
  minimal-evidence regression fixture from P1C), full-pipeline export +
  P1D Fidelity Gate tests for both a colorful scene and a heavy-skin
  scene, user-edit-after-enrichment + upload/reset lifecycle tests,
  purity/hostile source-inspection checks, and delegated regression
  against P1A/P1A R3/P1B/P1C R2/RCM/Production-lock/ESM-gate suites.
- `qa/baselines/p1e_full_static_suite_results.txt` — per-suite exit-code
  evidence log from running all 68 `qa/run-static-suites.mjs` suites
  individually in declared order (same methodology established in P1D
  R2; see `P1E_QA_REPORT.md`).
- `P1E_MODIFIED_FILES.md`, `P1E_RELEASE_NOTES.md`, `P1E_QA_REPORT.md`,
  `P1E_COLOR_INTELLIGENCE_ARCHITECTURE.md`,
  `P1E_EVIDENCE_TO_COLOR_PLAN_MAP.md`, `P1E_CREATIVE_TONE_HEURISTICS.md`,
  `P1E_CANDIDATE_INTEGRATION_NOTE.md` (this document and its six
  companions).

## Modified files (R1)

- `core/single-image/candidate/candidate-builder.js` — header doc comment
  updated to honestly describe the function as "a pure reshape PLUS one
  deliberate, bounded, evidence-driven Color Intelligence enrichment
  step". Added two imports (`applyColorIntelligence`,
  `DEFAULT_STRENGTH_MODE`). Added one call to `applyColorIntelligence()`
  plus one line storing its diagnostics onto
  `candidate.diagnostics.colorIntelligence`, inserted between the raw
  reshape and the lineage-building loop. No other line changed — see
  `P1E_CANDIDATE_INTEGRATION_NOTE.md` for the exact before/after and
  rationale.
- `core/single-image/candidate/candidate-schema.js` — added one additive
  key, `colorIntelligence: null`, to `createEmptyCandidate()`'s
  `diagnostics` object, mirroring the existing `autoValues: null`
  pattern. No existing key renamed, removed, or repurposed; no
  structural validation changed.
- `qa/run-static-suites.mjs` — registered the new
  `qa/epic-2e-p1e-color-intelligence-test.mjs` suite.
- `package.json` — version `2.4.1` → `2.5.0`, description updated.

## Explicitly untouched (verified via the tests in `P1E_QA_REPORT.md`)

`core/decision-engine/index.js` (Production legacy path),
`core/xmp-validator/index.js` (`quickSafetyClamp`/`validateFinalPreset`),
`core/preset-engine/index.js` (`serializeXMP`), `core/curve-engine/index.js`,
`core/single-image/xmp-fidelity/*` (P1D Fidelity Gate — mechanism
untouched, only sees stronger input values),
`core/single-image/candidate/legacy-preset-adapter.js`,
`core/single-image/candidate/candidate-store.js`,
`core/single-image/candidate/candidate-slider-adapter.js`,
`core/single-image/candidate/candidate-lineage.js`,
`core/single-image/single-image-session.js`,
`core/single-image/single-image-orchestrator.js`, Reference Color Match
(`core/color-match/*`), P0.8A Preview rendering modules, `ui/app.js`,
`index.html`, all i18n files, all Production Safety Lock flags, and all
145 files in the Production-lock manifest (re-verified unchanged — see
`P1E_QA_REPORT.md`).
