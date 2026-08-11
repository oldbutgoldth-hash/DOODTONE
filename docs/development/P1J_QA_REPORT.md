# P1J — QA Report

## New test suite

`qa/epic-2e-p1j-tone-curve-intelligence-test.mjs` — 48 own checks
(schema, plan-builder engagement gating, per-channel validation, Layer-A
restraint + strength modes, real `buildAndCommitCandidate()` integration,
Layer-B export-safety clamp), plus a Regression section spawning 10 prior
EPIC suites directly. All 48 own checks pass; every spawned regression
suite also independently re-run and confirmed green (see below).
Registered in `qa/run-static-suites.mjs`.

## Own-suite results (48/48)

- Schema (8/8): version string, STRENGTH_MODE enum, scalars ordering,
  MAX_POINT_DEVIATION/MIN_ENGAGEMENT_CONFIDENCE bounds,
  `buildEmptyToneCurvePlan()` shape.
- Plan builder engagement gating (8/8): missing evidence, FAILED status,
  below/at confidence floor, valid engagement, category/confidence
  passthrough, reason text passthrough.
- Plan builder per-channel validation (8/8): null points, too-short
  array, non-ascending x, out-of-range y, NaN, all-channels-invalid,
  CACHE_HIT status, warnings passthrough.
- Layer-A restraint + strength modes (8/8): restraint engages on extreme
  deviation, `pointsRestrained` count, restraint note in reasons,
  realistic points pass unrestrained, NATURAL restrains more tightly than
  DRAMATIC, strengthMode passthrough, point count/order preserved.
- Candidate integration (8/8): real `buildAndCommitCandidate()` end to
  end — VALID status, all four channels populated, diagnostics populated,
  parametric fields untouched by P1J, export-parity match for legitimate
  output, no-evidence path stays null exactly like pre-P1J.
- Layer-B export safety clamp (8/8): `HARD_LIMITS.curve` calibration
  bounds, legitimate boundary points pass unclamped, adversarial points
  clamped, NaN dropped fail-closed, null curves untouched.

## Regression: prior EPIC suites (independently re-run, standalone)

| Suite | Result |
|---|---|
| P1A (Single Image Session) | spawned via chain, unmodified |
| P1B (Analysis Report) | 39/39 PASS |
| P1C (Candidate) | 86/86 PASS |
| P1C R3 (User-Edit XMP Export) | spawned via chain, unmodified |
| P1D (XMP Fidelity Gate) | 71/71 PASS |
| P1E (Color Intelligence) | 94/94 PASS |
| P1E R3 (Parity + Creative Tone) | 62/62 PASS |
| P1F (Basic Tone Intelligence) | 77/77 PASS |
| P1G (Detail Intelligence) | 68/68 PASS |
| P1G R2 (Detail Export Safety Clamp) | 35/35 PASS |
| P1H (White Balance Intelligence) | 118/118 PASS |
| P1I (Pixel Multi-Estimator WB) | 98/98 PASS |
| P1I R2 (Pixel Skin Validation) | 30/30 PASS |

Zero failures across the entire chain after the Production Lock hash
correction described below.

## Production Lock re-verification

Two pinned-hash entries in the shared baseline
`qa/baselines/epic-2e-n1-production-invariant.json` were stale relative
to this round's real, deliberate edits, and were updated exactly once,
with the difference traced to its cause before updating (never updated
blind):

1. **`ui/app.js`** — changed by this round's new Advanced Diagnostics UI
   section (`renderToneCurveIntelligenceDiagnostics()` + the wiring call
   site). Same pattern P1H documented for its own UI addition.
2. **`core/xmp-validator/index.js`** — changed by this round's
   `_clampToneCurvePanel()` + recalibrated `HARD_LIMITS.curve` (Layer B).

Every other pinned file (`core/color-match/reference-xmp-generator.js`,
`core/lightroom-mapping-engine/index.js`, `core/preset-engine/index.js`,
`ui/ui-engine.js`) was independently re-hashed and confirmed
**byte-identical** to its pinned value — proving this round touched
nothing outside its declared scope.

Production safety flags (`productionSource: 'legacy'`,
`productionWrite: false`, `xmpWriteAllowedByN1: false`,
`lightroomMappingAllowedByN1: false`) confirmed unchanged by every
regression suite's own dedicated check.

## Browser QA

Not attempted this round (sandbox has no persistent Chromium session
available in the current environment) — honestly scoped as such, matching
this project's established convention of reporting real environment
constraints rather than a fabricated pass. All verification in this round
is real Node-level integration testing against the actual production
modules (`buildToneCurvePlan()`, `buildAndCommitCandidate()`,
`quickSafetyClamp()`, `computeExportParity()`), not simulated shapes.
