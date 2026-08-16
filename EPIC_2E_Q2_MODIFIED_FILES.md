# EPIC 2E-Q2 Modified / Added Files

## Added

- qa/epic-2e-q2-minimum-visible-wb-transfer-test.mjs
- EPIC_2E_Q2_RELEASE_NOTES.md
- EPIC_2E_Q2_MODIFIED_FILES.md
- EPIC_2E_Q2_QA_REPORT.md

## Updated

- core/color-match/photographic-compensation-engine.js —
  `buildSemanticIntents()`: replaced the binary `consistentIlluminant`
  gate + warmth-only `warmthFloor` with a continuous
  `illuminantEvidenceStrength` scalar and a `confidenceSideFloor`
  applied to `wbStrength` itself (affects both `finalWarmthIntent` and
  `rawTintIntent` symmetrically). `neutral.whiteBalanceScale`,
  `targetSkin.globalWarmthScale`, `amount`, and `largeShiftDampen` are
  completely untouched. `transferFloorApplied` diagnostic recomputed
  against the new mechanism (same field name, no consumer elsewhere
  referenced it before this round — grepped to confirm).
- qa/run-static-suites.mjs — registered the new Q2 suite.
- qa/baselines/lufa42-production-lock-manifest.json — regenerated (210
  files, 1 additional hash change vs. the Q1 update:
  `core/color-match/photographic-compensation-engine.js`; 0 added/
  removed).
- package.json — version 2.15.0 → 2.16.0, description updated.

## Not touched

- `core/color-match/target-aware-protection-engine.js` — read and
  reasoned about extensively this round, but zero lines changed. Its
  neutral-white and skin protection scales remain the deciding factor
  for targets that genuinely cannot safely take a move; the Q2 floor is
  designed to never fight them (see regression test using EPIC O's own
  fixture).
- Tone/Presence/HSL dampening inside `buildSemanticIntents()` — audited
  and found to be dampened by legitimate protection (clip-risk,
  large-shift caution, channel overlap), not by the same confidence-cliff
  artifact WB had. See "Honest scope" in the release notes.
- The N1 6-file production invariant and the P0.8A Reference Color Match
  invariant — neither pins `photographic-compensation-engine.js`; both
  remain byte-identical to their Q1-round state.
