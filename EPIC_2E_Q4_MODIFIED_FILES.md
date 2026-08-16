# EPIC 2E-Q4 Modified / Added Files

## Added

- qa/epic-2e-q4-graceful-skin-protection-test.mjs
- EPIC_2E_Q4_RELEASE_NOTES.md
- EPIC_2E_Q4_MODIFIED_FILES.md
- EPIC_2E_Q4_QA_REPORT.md

## Updated

- core/color-match/photographic-compensation-engine.js — `deriveSkinModel()`:
  added `skinPresence = clamp(coveragePct / 4, 0, 1)`; `protectionStrength`,
  `active`, `skinChannelTransferStrength`, `globalWbTransferStrength` now
  scale by/gate on `skinPresence` instead of the boolean `detected`. New
  `skinPresence` field added to the returned object (additive).
- core/color-match/target-aware-protection-engine.js — `deriveTargetSkinProtection()`:
  same treatment; early-return condition changed from `!detected` to
  `skinPresence <= 0`, `strength` scales by `skinPresence`. New
  `skinPresence` field added to the returned object (additive).
- qa/run-static-suites.mjs — registered the new Q4 suite.
- qa/baselines/lufa42-production-lock-manifest.json — regenerated (210
  files, 1 additional hash change vs. the Q3 delivery:
  `core/color-match/target-aware-protection-engine.js`; note
  `photographic-compensation-engine.js` was already changed in the Q2
  delivery and changed again here; 0 added/removed).
- package.json — version 2.17.0 → 2.18.0, description updated.

## Not touched

- `core/skin-classifier/index.js` — read and audited in full (YCbCr/HSV/
  chroma triple-model thresholds, spatial coherence check) but zero
  lines changed. See "Honest scope" in the release notes for why tuning
  these without real photographic ground truth was deliberately avoided.
- `core/skintone-engine/index.js` — not read this round; a different,
  separate engine (used by the main single-image pipeline, not RCM's
  `classifySkin()` — confirmed via the same import-boundary check used
  throughout this investigation).
- The N1 6-file production invariant and the P0.8A Reference Color Match
  invariant — neither pins either changed file; both remain
  byte-identical to their Q3-round state.
