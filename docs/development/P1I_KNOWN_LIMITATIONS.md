# P1I — Known Limitations

## 1. No live browser verification in this build environment

The sandbox used to build this round has no Chromium/Chrome binary
installed, and its network allowlist blocks Playwright's own browser
CDN download. Every P1I module was verified via `node --check` and a
real ESM `import()` smoke test, and the full 98-case automated suite
exercises the real production math against synthetic pixel-array
fixtures — but no actual `<canvas>`/`ImageData` render on a real decoded
photo, and no visual/layout check of the new Advanced Diagnostics panel,
has been performed. See `P1I_BROWSER_QA_ATTEMPT.md` for the full
account. **Recommendation:** run a manual pass using
`P1I_LIGHTROOM_MANUAL_QA_GUIDE.md` in an environment with a real browser
before treating this as fully browser-verified.

## 2. Synthetic fixtures, not real photographs

The 23 pixel-array fixtures used by the test suite are deterministic,
seeded, synthetic scenes (uniform bands with controlled noise) chosen to
exercise specific estimator behaviors (gray-world bias, clipping,
neutral-region detection, mixed-light bands, noise-sensitivity). They
are not decoded real photographs, and do not capture the full
statistical texture (sensor noise correlation, compression artifacts,
non-uniform gradients) of an actual camera image. Real-photo behavior
should be spot-checked manually per the limitation above.

## 3. Confidence model is a heuristic, not learned

Per-estimator confidence (sample-count factor, dominance-penalty
multiplier, agreement score) is a hand-tuned heuristic formula, the same
approach used throughout this project's prior estimator-style features
(see `photographer-style-intelligence` design pattern). It is
internally consistent and tested against known-correct synthetic cases,
but is not calibrated against a labeled real-world dataset. A confidence
value from this system should be read as "how much does the pixel
evidence agree with itself," not as a statistically calibrated
probability.

## 4. Highlight/shadow band split can misclassify on scenes without a clear tonal spread

`estimateHighlightIlluminant()`/`estimateShadowIlluminant()` select bands
by luminance percentile (67th/33rd) over the whole accepted-pixel
population. On a scene with very little tonal range (e.g. a flat,
evenly-lit subject), the "highlight" and "shadow" bands may end up
statistically similar, which is expected and handled (confidence drops
accordingly, `compareIlluminants()` won't force a mixed-light flag on
genuinely uniform light) — but it means this specific estimator
contributes little useful evidence on such scenes. This is a property of
the percentile-based approach, not a bug, and is the reason the ensemble
weighs six independent estimators rather than relying on any one.

## 5. Object-color bias is guarded, not eliminated

The Gray World and Shades of Gray estimators are guarded against strong
single-hue dominance (e.g. a scene that is mostly green foliage or pink
clothing) via `dominancePenaltyMultiplier()` and the green-foliage/pink-
clothing restraint tests (85/86), which keep the ensemble consensus tint
within ±25 units even on these adversarial scenes. This reduces, but does
not perfectly eliminate, the classical gray-world assumption's known
weakness on scenes dominated by a single non-neutral color — a very
strongly saturated, edge-to-edge single-hue scene could still bias the
consensus somewhat. P1H's own decision layer, which treats P1I as one
evidence source among several, is the final safeguard against this.

## 6. Ensemble weighting is fixed, not scene-adaptive beyond confidence

The six estimators are combined via `combineWeighted()` using each
estimator's own confidence as its weight — there is no additional
scene-classification step that, say, disables the White Patch estimator
entirely on scenes with no genuine specular highlight. In practice this
is handled implicitly (a White Patch estimate with no valid unclipped
bright pixel reports low confidence or `UNAVAILABLE`, per test coverage),
but it means the ensemble's behavior on unusual scene types is governed
entirely by the confidence heuristics in Limitation #3, not by explicit
scene-type rules.


## 7. (R2) Skin sample size is often small, and confidence reflects that honestly

Real photos frequently contain a small amount of skin, or skin under
conditions (heavy shadow, extreme highlight, colored stage light) that
this module deliberately rejects rather than trusts. In those cases
`sampleQualityConfidence` is low or the result is `UNAVAILABLE` by
design — this is the intended, conservative behavior (spec item:
"don't trust every YCbCr-classified pixel"), not a defect. A photo with
a small, clean headshot region will produce a usable but modestly
confident result; a photo with no visible skin, or skin only under
adverse conditions, will correctly fall back to R1's existing proxy
behavior rather than fabricate a pixel-level answer from too little
data.

## 8. (R2) The Temp/Tint-to-gain inverse used for simulation is approximate by construction

`_inverseTempTintToGains()` in `skin-correction-plausibility.js` is a
necessarily approximate inverse of `gainsToTempTint()`: temperature and
tint compress three RGB gain degrees of freedom into two scalars, so no
exact inverse exists. The mean-gain-preserving convention chosen (see
`P1I_R2_SKIN_CORRECTION_PLAUSIBILITY.md` §2) was verified to round-trip
exactly through the real `gainsToTempTint()` for the tested cases and to
produce genuine, correctly-signed hue shifts for pure-tint corrections —
but it remains a documented approximation used only for this
plausibility simulation, never exported for reuse, and never a source
of truth for how the real Preview/Candidate pipeline renders a
correction.

## 9. (R2) The neutral-region conflict signal is a moderate, bounded reduction — not a second decision-maker

When skin plausibility disagrees with a confident neutral-region
reading, confidence is multiplied by `CONFLICT_PENALTY_MULTIPLIER =
0.75` — a single, fixed, moderate reduction, not a re-adjudication
between the two signals. This was a deliberate design choice per the
spec's explicit requirement ("conflicts... get recorded and moderately
reduce confidence, never a blind override") rather than, e.g., a
weighted vote or a second consensus computation — the ensemble's own
six-estimator consensus mechanism already exists for that purpose, and
duplicating it here for one validator signal was judged unnecessary
complexity for a signal that is itself optional, additive evidence.

## 10. (R2) `qa/run-static-suites.mjs` was not executed as one literal blocking command in this sandbox

This sandbox enforces a hard ceiling of roughly 43-45 seconds per shell
command with no way to persist a background process across separate
commands. Several suites in this project's existing dependency chain
recursively re-run earlier suites in full via `spawnSync` (e.g. P1F
re-runs P1E R3, which itself re-runs P1E R2), and the combined cost of
that chain exceeds the per-command ceiling — a structural property of
this sandbox, not of the suites or the code under test. Every suite was
independently verified passing (see `P1I_QA_REPORT.md`'s R2 addendum
§3 for the full methodology and result table); the literal aggregate
exit code of one single `node qa/run-static-suites.mjs` invocation was
not captured, and this is disclosed here rather than assumed.
