# EPIC 2E-Q2 QA Report

## New suite

`qa/epic-2e-q2-minimum-visible-wb-transfer-test.mjs` — **8/8 PASS**

- Moderate-confidence case (zoneConsistency ≈ 0.70, below the old binary
  0.72 gate): new floor rescues warmth above a pre-Q2 formula
  reconstructed from the real engine's own computed intermediates
  (concrete before/after numbers, not argued from formulas alone).
- Floor applies symmetrically to tint (previously had zero floor
  mechanism).
- Floor never fires when there is no real transfer intent
  (`BLOCKED_INSUFFICIENT_EVIDENCE` keeps warmth/tint exactly 0).
- Floor never fires at intensity 0.
- Floor never fires for a trivially small/near-identical pair (no
  evidence to rescue).
- REGRESSION: EPIC O's own high-key-wedding + already-warm-skin fixture
  still meets every documented safe bound
  (`exp<=5, hi<=3, wh<=2, temp<=10, hsl_s_orange<=5`) — floor does not
  override genuine target-aware protection.
- Source-level checks: floor computed from a continuous scalar (old
  binary gate variable no longer declared); floor only touches
  confidence-side factors, never `amount`/`largeShiftDampen`/either
  target-aware protection scale.

## Regression sweep (standalone, this round)

| Suite | Result |
|---|---|
| epic-2e-q2-minimum-visible-wb-transfer-test.mjs (new) | 8/8 PASS |
| epic-2e-n2-photographic-compensation-static-test.mjs | 7/7 PASS |
| epic-2e-n3-lightroom-candidate-static-test.mjs | 5/5 PASS |
| epic-2e-n1-n5-integration-static-test.mjs | 5/5 PASS |
| epic-2e-o-target-aware-roundtrip-static-test.mjs | 10/10 PASS |
| epic-2e-o8-best-of-both-color-match-static-test.mjs | 8/8 PASS |
| epic-2e-o3-o7-xmp-lineage-static-test.mjs | 11/11 PASS |
| epic-2e-n1-core-color-match-integration-static-test.mjs | 6/6 PASS |
| epic-2e-n1-core-color-match-signature-static-test.mjs | 9/9 PASS |
| epic-2e-q1-auto-target-wb-base-test.mjs | 20/20 PASS |
| epic-2e-p1a-single-image-session-test.mjs | 25/25 PASS |
| epic-2e-p1b-analysis-report-test.mjs | 39/39 PASS |

Every suite that reads, exercises, or pins
`photographic-compensation-engine.js` (directly or via the P0.8A/lufa42
baselines) was re-run standalone and confirmed green, both before
packaging and again from a clean extraction of the delivered zip.

## Production Lock

- N1 6-file invariant: unaffected (`photographic-compensation-engine.js`
  is not one of the 6 pinned files).
- P0.8A Reference Color Match invariant: unaffected (not one of its 8
  pinned files either).
- lufa42 manifest: regenerated, 210/210 files, 1 additional hash change
  vs. the Q1 delivery (`photographic-compensation-engine.js`), 0 added/
  removed.

## Honest limitation

The floor fraction (0.65) was tuned against synthetic fixtures
constructed in this environment, not real photographs — there is no
browser/real-image pipeline available here to validate against actual
LUMIXA output end-to-end. It is demonstrated, with real before/after
numbers from the actual engine, to meaningfully rescue a realistic
moderate-confidence case without breaking the one existing safety
regression test that specifically locks in aggressive protection for a
high-key, already-warm-skin target. Real reference/target photo pairs
from actual use remain the highest-value input for the next round of
calibration, and for deciding whether Tone/Presence need an analogous
(but structurally different) treatment.
