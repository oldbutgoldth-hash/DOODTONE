# EPIC 2E-Q1 Modified / Added Files

## Added

- qa/epic-2e-q1-auto-target-wb-base-test.mjs
- EPIC_2E_Q1_RELEASE_NOTES.md
- EPIC_2E_Q1_QA_REPORT.md
- EPIC_2E_Q1_MODIFIED_FILES.md

## Updated

- core/color-match/candidate-xmp-codec.js — factored the existing inline
  RAW-detection regex out of `buildCandidateWhiteBalanceContext()` into a
  new exported `isRawTargetMedia({ mediaType, fileName })`, so the panel
  can reuse the exact same rule instead of re-deriving it. Behavior of
  `buildCandidateWhiteBalanceContext()`/`serializeCandidateXMP()` is
  byte-identical to before this round (see regression tests).
- ui/reference-color-match-panel.js —
  - imports `sliderToKelvin` (already-imported `analyzeWhiteBalance`'s
    sibling export) and the new `isRawTargetMedia`.
  - adds `_effectiveTargetBase()`: manual value wins if present; else,
    for non-RAW targets only, converts the already-computed
    `targetEvidence.coreOutputs.whiteBalancePro` reading via
    `sliderToKelvin()`; else `null` (unchanged fallback).
  - adds `_buildTargetMediaContext()`, the single source of truth for
    the `targetMediaContext` object, replacing 3 previously
    byte-identical inline literals at the 3 pipeline call sites.
  - adds `rcm.targetBaseAuto` (read-only, QA/UI visibility only).
  - adds a `#rcmTargetBaseAutoNote` UI element and
    `_renderTargetBaseAutoNote()`, refreshed after both full-pipeline
    completion points and on Target media-type change, showing the user
    which base is in effect (manual / auto-pixel-analysis / RAW requires
    manual / no evidence yet) and why.
  - updates the "TARGET LIGHTROOM BASE VALUES" description copy to
    document the JPEG-auto vs. RAW-manual distinction.
- qa/run-static-suites.mjs — registered the new Q1 suite.
- qa/baselines/lufa42-production-lock-manifest.json — regenerated (210
  files, 2 hash changes: the two files above; 0 added/removed).
- qa/baselines/p0-8a-reference-color-match-invariant.json — deliberately
  updated the pinned hash for `ui/reference-color-match-panel.js` (the
  only one of its 8 pinned files this round touched), with an explicit
  `lastDeliberateUpdate` note recording the previous/new hash and why.

## Not touched

- The N1 6-file production invariant (`ui/app.js`,
  `core/color-match/reference-xmp-generator.js`,
  `core/lightroom-mapping-engine/index.js`, `core/preset-engine/index.js`,
  `core/xmp-validator/index.js`, `ui/ui-engine.js`) — all 6 remain
  byte-identical; no update needed to
  `qa/baselines/epic-2e-n1-production-invariant.json`.
- `core/color-match/photographic-compensation-engine.js`,
  `target-aware-protection-engine.js`, `lightroom-candidate-mapper.js` —
  read and audited this round but not modified; the dampening-chain
  concern they carry is documented as a follow-up, not fixed here.
- `core/whitebalance-engine/index.js` — read-only; `sliderToKelvin()`
  reused exactly as already exported, zero lines changed.
- No P1-series single-image pipeline file (`core/single-image/*`,
  `core/decision-engine`, etc.) — RCM is a fully separate feature and
  this round's scope never touched it.
