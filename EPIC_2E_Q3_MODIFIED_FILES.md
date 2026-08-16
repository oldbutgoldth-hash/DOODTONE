# EPIC 2E-Q3 Modified / Added Files

## Added

- qa/epic-2e-q3-tone-curve-ceiling-test.mjs
- EPIC_2E_Q3_RELEASE_NOTES.md
- EPIC_2E_Q3_MODIFIED_FILES.md
- EPIC_2E_Q3_QA_REPORT.md

## Updated

- core/color-match/lightroom-candidate-mapper.js — `protectPixelTransferCurves()`:
  `baseScale`'s ceiling raised from 0.78 to 0.95
  (`clamp(matchNeed / 24, 0.32, 0.95)`). Floor, ramp divisor,
  neutral-protection multiplier, `channelScale`, and endpoint protection
  are byte-identical to before (verified by source-level test).
- qa/run-static-suites.mjs — registered the new Q3 suite.
- qa/baselines/lufa42-production-lock-manifest.json — regenerated (210
  files, 1 additional hash change vs. the Q2 delivery:
  `core/color-match/lightroom-candidate-mapper.js`; 0 added/removed).
- package.json — version 2.16.0 → 2.17.0, description updated.

## Not touched

- `core/color-match/tone-curve-transfer-engine.js`,
  `perceptual-pixel-transfer-engine.js` — read and audited (layers 1–2 of
  the three-layer dampening stack) but zero lines changed; see "Honest
  scope" in the release notes for why.
- `channelScale`, endpoint protection, neutral-white protection inside
  `protectPixelTransferCurves()` — read, reasoned about, left exactly as
  before.
- The N1 6-file production invariant and the P0.8A Reference Color Match
  invariant — neither pins `lightroom-candidate-mapper.js`; both remain
  byte-identical to their Q2-round state.
