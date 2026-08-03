# P1E — Candidate Integration Note

This is the focused note (deliverable item 8) documenting the one behavior
change to `buildCandidateFromSession()` in
`core/single-image/candidate/candidate-builder.js`.

## Exact insertion point

`applyColorIntelligence(candidate, evidence, {strengthMode:
DEFAULT_STRENGTH_MODE})` is called immediately after:

- the raw reshape of `candidateRaw` into `candidate.profile/whiteBalance/
  basic/curves/hsl/grading/cal/detail/metadata` completes,
- `candidate.diagnostics.confidence`, `.safetyClamps`, `.warnings`, and
  `.sourceEvidence` are populated (these are read from the existing
  pipeline's own validation/benchmark output — P1E does not touch this
  logic),

and immediately **before**:

- the per-parameter `lineageEntries` are built (the loop that calls
  `buildParameterLineage()` for every `hsl.{dim}.{ch}`,
  `grading.{zone}.{dim}`, and `cal.{prim}Primary{dim}` path),
- the `candidate.diagnostics.autoValues` snapshot is taken (the object
  "Reset to Auto" reverts to),
- `normalizeCandidate()`, `candidate.status = AUTO_GENERATED`, and
  `validateCandidateShape()` run.

## Why this ordering is deliberate

The lineage entries and the `autoValues` snapshot are both taken by
reading `candidate.hsl`/`candidate.grading`/`candidate.cal`/
`candidate.basic` **at the time they run** — they do not distinguish
"the value the raw preset originally had" from "the value currently
sitting on the Candidate object". Running Color Intelligence before both
of these means:

1. **Lineage entries correctly attribute the enriched value.** Each
   lineage entry's `rawRecommendation`, `autoValue`, and `currentValue`
   all read the *enriched* number — which is the honest description of
   what actually ended up in the Candidate and why (the lineage's
   `sourceModules` list for HSL/Grading/Calibration fields already
   includes the real Core engines P1E reads from, via
   `_sourceEnginesFor('hsl')` etc. — unchanged from P1C).
2. **"Reset to Auto" correctly reverts to the P1E-strengthened
   recommendation, not the pre-enrichment one.** This is an intentional
   product decision, not an oversight: the enriched value *is* the new
   "auto" recommendation as of this EPIC. A user who resets a manually-
   edited slider should land back on LUMIXA's best current
   recommendation, which now includes Color Intelligence's contribution.
   Reverting instead to the pre-enrichment (legacy-dampened) value would
   silently reintroduce the near-zero-color bug this EPIC exists to fix,
   every time a user pressed Reset.

## What did NOT change in `buildCandidateFromSession()`

- The raw reshape logic itself (every `candidate.X = rawPreset.Y ?? Z`
  assignment) is byte-identical to P1C.
- `candidate.diagnostics.confidence/safetyClamps/warnings/sourceEvidence`
  computation is byte-identical.
- The lineage-building loop's own logic (which paths get an entry, which
  evidence keys/source modules are attached) is byte-identical — it now
  simply runs after enrichment instead of before, per the design above.
- The `autoValues` snapshot's own shape and which fields it captures is
  byte-identical — it now captures enriched values for the color fields
  P1E touches, and identical-to-before values for every field P1E
  doesn't touch.
- `normalizeCandidate()`, `validateCandidateShape()`, and the
  `AUTO_GENERATED`/`FAILED` status logic are byte-identical.

## New additive field

`core/single-image/candidate/candidate-schema.js`'s
`createEmptyCandidate()` gained one new key inside `diagnostics`:
`colorIntelligence: null`, mirroring the existing `autoValues: null`
pattern. It is set to the real diagnostics object returned by
`applyColorIntelligence()` immediately after that call in
`candidate-builder.js`. No existing field was renamed, removed, or
repurposed; no structural validation in `validateCandidateShape()` was
made to require this field's presence, keeping it maximally additive and
backward-compatible with any code (including every pre-P1E test fixture)
that never sets or reads it.

## Verified regression-free

`qa/epic-2e-p1c-candidate-test.mjs` (86/86, unchanged assertions
including exact HSL/Grading/Calibration values from the minimal fixture),
`qa/epic-2e-p1c-r2-candidate-lifecycle-order-test.mjs` (19/19),
`qa/epic-2e-p1c-r3-user-edit-xmp-export-test.mjs` (39/39), and
`qa/epic-2e-p1d-xmp-fidelity-gate-test.mjs` (71/71) all pass unmodified
against the integrated `candidate-builder.js`. See `P1E_QA_REPORT.md` for
the full verification methodology and the new `qa/epic-2e-p1e-color-
intelligence-test.mjs` suite (70/70) that specifically exercises this
integration point (tests 40–47, 54, 56–58).
