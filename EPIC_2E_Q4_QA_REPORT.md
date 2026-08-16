# EPIC 2E-Q4 QA Report

## New suite

`qa/epic-2e-q4-graceful-skin-protection-test.mjs` — **7/7 PASS**

- Coverage at/above the classifier's 4% threshold: `skinPresence=1`,
  confirmed byte-identical to before.
- Borderline coverage (3%, below the old hard cliff): protection is now
  real and non-zero (previously exactly zero).
- Protection strength ramps monotonically across 1%/2%/3%/4.5% coverage.
- Genuinely zero coverage still gets genuinely zero protection.
- `target-aware-protection-engine.js`: same ramp behavior, and
  `preserveSkinTone: false` still fully disables protection regardless
  of coverage.
- `target-aware-protection-engine.js`: full-coverage case confirmed
  `skinPresence === 1` (the condition that guarantees byte-identical
  output to the pre-Q4 formula).
- Source-level check: the `skinPresence` ramp is present in both
  engines, gated on `coveragePct / 4`, not the boolean `detected` flag.

## Regression sweep (standalone, this round)

| Suite | Result |
|---|---|
| epic-2e-q4-graceful-skin-protection-test.mjs (new) | 7/7 PASS |
| epic-2e-q1-auto-target-wb-base-test.mjs | 20/20 PASS |
| epic-2e-q2-minimum-visible-wb-transfer-test.mjs | 8/8 PASS |
| epic-2e-q3-tone-curve-ceiling-test.mjs | 4/4 PASS |
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

Every suite that reads, exercises, or pins either changed file was
re-run standalone and confirmed green, both before packaging and again
from a clean extraction of the delivered zip. Notably, the existing
"Skin protection dampens red/orange/yellow transfer" test in the N2
suite (which compares a confidently-detected vs. a not-detected skin
case) remains green — the comparison it makes (`<=`) still holds even
though the not-detected case in that specific fixture happens to carry
substantial `coveragePct` and now receives meaningful protection too.

## Production Lock

- N1 6-file invariant: unaffected.
- P0.8A Reference Color Match invariant: unaffected.
- lufa42 manifest: regenerated, 210/210 files, 1 additional hash change
  vs. the Q3 delivery (`target-aware-protection-engine.js`), 0 added/
  removed.

## Honest limitation

As with Q1–Q3: verified against synthetic fixtures in this environment,
not real photographs. The skin *classifier's* own per-pixel accuracy
(as opposed to how its output is consumed) was deliberately left
untouched — see the release notes for why that specific area needs real
ground-truth photos before it should be touched at all.
