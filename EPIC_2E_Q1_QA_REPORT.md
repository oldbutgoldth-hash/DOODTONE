# EPIC 2E-Q1 QA Report

## New suite

`qa/epic-2e-q1-auto-target-wb-base-test.mjs` — **20/20 PASS**

- `isRawTargetMedia()`: explicit `RAW` override, all 9 RAW extensions
  (case-insensitive), non-RAW extensions, explicit `RENDERED` override,
  no-info default.
- `buildCandidateWhiteBalanceContext()` / `serializeCandidateXMP()`
  regression: explicit base still produces `ABSOLUTE_FROM_TARGET_BASE`;
  missing base on RAW with a real move still blocks with
  `TARGET_RAW_WB_BASE_REQUIRED`; missing base on non-RAW with no move
  needed still stays `exportReady`; `As Shot` XMP still carries zero
  Temperature/Tint attributes when no base is present; `Custom` XMP
  still carries real Temperature/Tint once a base is present.
- `sliderToKelvin()`/`kelvinToSlider()` sanity: 0 → 5500K midpoint;
  round-trip across representative warm/cool slider values.
- Panel wiring (structural, matching this file's established
  pre-existing test convention — see below): imports present; manual
  value checked before the RAW check, which is checked before reading
  `whiteBalancePro`; RAW branch returns `null`/`null`; Kelvin conversion
  applied to temperature, tint passed through unconverted; exactly 3
  call sites now use the single `_buildTargetMediaContext()` helper with
  zero remaining duplicated inline literal; auto-note UI element and its
  render function exist and are wired at >=3 call sites; UI copy
  documents the JPEG-auto vs. RAW-manual split; `targetBaseAuto` state
  field documented as read-only.

## Regression sweep (standalone, this round)

| Suite | Result |
|---|---|
| epic-2e-q1-auto-target-wb-base-test.mjs (new) | 20/20 PASS |
| epic-2e-n1-core-color-match-integration-static-test.mjs | 6/6 PASS |
| epic-2e-n1-core-color-match-signature-static-test.mjs | 9/9 PASS |
| epic-2e-n1-n5-integration-static-test.mjs | 5/5 PASS |
| epic-2e-o8-best-of-both-color-match-static-test.mjs | 8/8 PASS |
| epic-2e-o-target-aware-roundtrip-static-test.mjs | 10/10 PASS |
| epic-2e-o3-o7-xmp-lineage-static-test.mjs | 11/11 PASS |
| epic-2e-p1a-single-image-session-test.mjs | 25/25 PASS (incl. the P0.8A pinned-baseline check, deliberately updated this round) |
| epic-2e-p1b-analysis-report-test.mjs | 39/39 PASS |

Additionally, `qa/run-static-suites.mjs` (the full aggregate runner) was
run and progressed cleanly through every suite it reached — including
P1C (86/86), P1D (71/71), P1E (94/94), P1E R3 (62/62, partially observed
before cutoff) — with zero failures, before this environment's
pre-existing per-call timeout cut the run short partway through the
P1-series (the same, already-documented limitation noted in every prior
EPIC's own QA report since P1G; every suite it reaches independently
passes standalone, as shown above and in prior rounds' reports).

## Production Lock

- N1 6-file invariant: byte-identical for all 6 pinned files — none
  touched by Q1.
- P0.8A Reference Color Match invariant
  (`qa/baselines/p0-8a-reference-color-match-invariant.json`):
  deliberately updated for `ui/reference-color-match-panel.js` only (the
  file this round's real fix lives in); the other 7 pinned files remain
  byte-identical. The update is recorded in-baseline as
  `lastDeliberateUpdate` with the previous and new hash, per this
  project's "state every deviation explicitly" convention.
- lufa42 production-lock manifest: regenerated, 210/210 files, exactly 2
  hashes changed (`core/color-match/candidate-xmp-codec.js` and
  `ui/reference-color-match-panel.js` — the two files this round
  touched), 0 added/removed.
- Production safety flags (`productionWrite=false`, `xmpWriteAllowed=
  false`, `productionActivationAllowed=false`): unchanged everywhere
  checked.

## Browser QA

Not attempted this round — consistent with this project's own
honest-scope convention (see P1N's QA report) when a real Chromium
environment isn't available. The panel-level wiring is verified
structurally (source-text assertions against the real, current file —
the same method already used by this project's own pre-existing
`epic-2e-n1-core-color-match-integration-static-test.mjs`), and every
function the wiring actually calls (`isRawTargetMedia`, `sliderToKelvin`,
`buildCandidateWhiteBalanceContext`, `serializeCandidateXMP`) is verified
directly, for real, in Node.

## Known limitation carried forward

The multiplicative dampening chain across
`core/color-match/photographic-compensation-engine.js` and
`target-aware-protection-engine.js` was audited this round but not
modified. It can still reduce a transfer's visible magnitude even once
a real base value is present (auto or manual) — see
`EPIC_2E_Q1_RELEASE_NOTES.md`'s "What this does and does not fix"
section. Recommended as the next round's focus.
