# EPIC 2E-Q3 QA Report

## New suite

`qa/epic-2e-q3-tone-curve-ceiling-test.mjs` — **4/4 PASS**

- Well-evidenced large difference (matchNeedScore > 24, above the point
  where the old 0.78 ceiling actually bound): new master curve has
  measurably larger total deviation from identity than the reconstructed
  pre-Q3 curve, using the real engine's own computed intermediates.
- Modest difference (matchNeedScore below the ramp point, ceiling never
  engages): output is byte-identical to the reconstructed pre-Q3 curve —
  proves the fix is scoped to exactly the large-difference case it
  targets.
- REGRESSION: EPIC O's own high-key-wedding + already-warm-skin fixture
  still meets every documented safe candidate bound.
- Source-level check: only the ceiling constant changed (0.78 → 0.95);
  floor, ramp divisor, neutral-protection multiplier, and `channelScale`
  are asserted byte-identical.

## Regression sweep (standalone, this round)

| Suite | Result |
|---|---|
| epic-2e-q3-tone-curve-ceiling-test.mjs (new) | 4/4 PASS |
| epic-2e-q1-auto-target-wb-base-test.mjs | 20/20 PASS |
| epic-2e-q2-minimum-visible-wb-transfer-test.mjs | 8/8 PASS |
| epic-2e-n2-photographic-compensation-static-test.mjs | 7/7 PASS |
| epic-2e-n3-lightroom-candidate-static-test.mjs | 5/5 PASS |
| epic-2e-n1-n5-integration-static-test.mjs | 5/5 PASS |
| epic-2e-o-target-aware-roundtrip-static-test.mjs | 10/10 PASS |
| epic-2e-o8-best-of-both-color-match-static-test.mjs | 8/8 PASS |
| epic-2e-o3-o7-xmp-lineage-static-test.mjs | 11/11 PASS |
| epic-2e-n1-core-color-match-integration-static-test.mjs | 6/6 PASS |
| epic-2e-n1-core-color-match-signature-static-test.mjs | 9/9 PASS |
| epic-2e-p1a-single-image-session-test.mjs | 25/25 PASS |
| epic-2e-p1b-analysis-report-test.mjs | 39/39 PASS |

Every suite that reads, exercises, or pins
`lightroom-candidate-mapper.js` (directly or via the P0.8A/lufa42
baselines) was re-run standalone and confirmed green, both before
packaging and again from a clean extraction of the delivered zip.

## Production Lock

- N1 6-file invariant: unaffected.
- P0.8A Reference Color Match invariant: unaffected.
- lufa42 manifest: regenerated, 210/210 files, 1 additional hash change
  vs. the Q2 delivery (`lightroom-candidate-mapper.js`), 0 added/removed.

## Honest limitation

Same as Q1/Q2: tuned and verified against synthetic fixtures in this
environment, not real photographs. See the "Honest scope" section of
`EPIC_2E_Q3_RELEASE_NOTES.md` for exactly which parts of the tone-curve
dampening stack were deliberately left untouched this round, and why.
