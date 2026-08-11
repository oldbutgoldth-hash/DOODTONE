# LUMIXA AI — EPIC 2E-P1I Release Notes

**Version:** 2.9.0
**Title:** Pixel-Level Multi-Estimator White Balance V2

## Summary

P1I adds a second, independent layer of White Balance evidence, computed
directly from real decoded pixel data, that feeds into the existing P1H
White Balance decision layer as additional evidence — it never overrides
or bypasses P1H's own decision-making, and never writes to Candidate
directly.

Six deterministic pixel-level estimators now run during analysis:

- **Gray World** — classic average-scene-is-gray assumption.
- **White Patch** — brightest-pixel assumption, with a clipping guard so
  blown highlights can't skew the estimate.
- **Shades of Gray** — a Minkowski-norm generalization of Gray World that
  sits between Gray World and White Patch.
- **Neutral Region** — finds genuinely low-saturation regions of the
  image and averages those directly, with a guard against being fooled
  by small specular highlights.
- **Highlight/Shadow Illuminant** — separately estimates the illuminant
  color in the image's highlight band and shadow band, and flags when
  they disagree enough to suggest mixed lighting.

Each estimator's result carries a confidence score, informed by sample
count, color dominance in the scene, and (for the highlight/shadow pair)
agreement between bands. An ensemble policy combines all six into a
single weighted consensus, which is handed to P1H's evidence extractor
as one more input alongside P1H's existing signals.

## What this fixes / improves

Previously, P1H's White Balance decisions relied on a single evidence
source. P1I gives the decision layer independent, pixel-grounded
corroboration (or disagreement) it can weigh — without changing what
P1H is allowed to decide or how it decides it.

## What this explicitly does NOT change

- P1I never makes the final Temp/Tint decision — that remains entirely
  P1H's responsibility.
- P1I never writes to Candidate. Verified structurally: the ensemble
  module has zero imports from `candidate-builder.js` or
  `single-image-session.js` (tests M9/M9b).
- P1H's R1 fallback behavior is preserved exactly: if the P1I bundle is
  unavailable for any reason, P1H's evidence extraction behaves exactly
  as it did before this round.
- No existing Session, Candidate, or XMP field was removed or
  repurposed — `session.whiteBalanceEstimators` is a purely additive
  field.
- Green-foliage and pink-clothing scenes are explicitly guarded against
  producing an excessive Magenta/Green push (tests 85/86: consensus
  tint stays within ±25 units on both scene types, versus the ±100
  slider range).

## Safety / bounded behavior

- Pixel sampling is bounded (`MAX_SAMPLES`/`MAX_SCAN` ceilings) regardless
  of source image size — verified to complete a realistic-size buffer run
  in under 3 seconds (test 72).
- All six estimators share a single pixel sample pass, not six separate
  passes (test 75).
- The full pipeline never throws — verified against neutral, green-
  foliage, pink-clothing, blue-wall-with-skin, sunset, low-confidence
  monochromatic, empty-buffer, and NaN/Infinity-poisoned inputs (tests
  76–84); any of these degrade to `UNAVAILABLE` per-estimator rather
  than crashing the analysis pipeline.
- Ensemble consensus temperature/tint are always clamped within
  [-100, 100], matching the Candidate slider's own unit range (test 87).
- Advanced Diagnostics trace events are bounded and stale-generation
  aware — a bundle computed for a previous image/generation is detected
  and discarded rather than silently attached to a new session
  (mutation test M7).

## UI

Advanced Diagnostics gained a new, collapsible pixel-estimator panel
(English and Thai) showing each of the six estimators' status,
confidence, and diagnostics, plus the ensemble consensus and any
mixed-light flag — for transparency into how the White Balance evidence
was derived. This panel is purely informational; it has no controls that
write back into the pipeline.

## Testing

98/98 automated tests passing (88 numbered cases across 15 categories +
9 mutation tests, `M1`–`M9b`) against the real production estimator,
ensemble, and evidence-extraction modules — no re-implemented or
duplicated math inside the test suite itself. See
`P1I_QA_REPORT.md` for the full regression summary and
`P1I_BROWSER_QA_ATTEMPT.md` for the honest browser-QA scope note.

## Known limitations

See `P1I_KNOWN_LIMITATIONS.md`.


---

# R2 — Pixel Skin Validation and WB Correction Plausibility

**Version:** 2.9.1
**Title:** Pixel Skin Validation and WB Correction Plausibility

## Summary

R1 shipped six pixel-level illuminant estimators feeding P1H's White
Balance decision, plus a documented **proxy** skin-consistency signal
inside P1H itself (`skinWarmth.confidence x skin coverage` — a
colorimetric approximation, never real per-pixel validation). R2 closes
that gap: a new, real pixel-level Skin Validation layer extracts a
trusted subset of skin-toned pixels from the same shared P1I sample,
simulates the ensemble's proposed correction on those pixels only, and
scores whether the correction still looks like plausible skin
afterward — before vs. after, on a continuous, ethnicity-neutral
0-1 scale.

This is a **validator, not a seventh estimator**. It never proposes its
own Temperature/Tint value, never participates in the ensemble
consensus, and its result only ever nudges an existing confidence value
— corroborating, reducing, or leaving it unchanged — never overriding
any other estimator or writing to Candidate directly.

## What's new

- **`skin-sample-validator.js`** — reuses the codebase's one existing
  skin-chrominance classifier (`isLikelySkinPixelYCbCr()`) on the
  already-sampled pixel set, then rejects clipped, oversaturated
  (colored/stage-light-on-skin), and near-shadow candidates before
  trusting the rest. Requires a minimum sample count AND minimum
  spatial coverage, not just a nonzero pixel count.
- **`skin-correction-plausibility.js`** — simulates the proposed
  correction on the validated pixels in a pure, temporary, in-memory
  calculation (never touching Candidate or Session), and scores
  before/after skin-band plausibility using the same continuous
  Cb/Cr-distance measure across the full realistic range of skin tones
  — never one fixed target hue.
- **P1H integration** — when a usable Skin Validation result exists,
  it replaces the R1 proxy `skinConsistencyConfidence`; when unusable
  (no skin detected, insufficient sample), R1's proxy behavior is
  preserved exactly, byte-for-byte.
- **Advanced Diagnostics UI** — one new line in the existing WB
  estimator details panel, showing the skin validation status and
  whether the proposed correction was supported (English + Thai).

## What did not change

`buildEstimatorEnsemble()`, all six R1 estimators, P1H's
`wb-plan-builder.js`/`cast-classifier.js`/`wb-guardrails.js`/
`mixed-light-detector.js`, the Candidate schema, the XMP serializer,
the Fidelity Gate, Reference Color Match, Preview, and all production
safety locks are untouched. See `P1I_R2_PIXEL_SKIN_VALIDATION_MODEL.md`,
`P1I_R2_SKIN_CORRECTION_PLAUSIBILITY.md`, and the R2 addenda in
`P1I_MULTI_ESTIMATOR_WB_ARCHITECTURE.md` / `P1I_P1H_INTEGRATION_POLICY.md`
for full detail.

## Testing

30/30 new automated checks (`qa/epic-2e-p1i-r2-pixel-skin-validation-test.mjs`),
full regression across the whole P1-series and Production Lock (see
`P1I_QA_REPORT.md`'s R2 addendum for the complete table and an honest
disclosure of the one sandbox-structural limitation encountered while
verifying `qa/run-static-suites.mjs`'s full nested-spawn chain).
