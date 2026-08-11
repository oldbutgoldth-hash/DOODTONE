# P1I → P1H Integration Policy

## Ownership boundary (unchanged from the spec, verified in the real code)

**P1I owns** (`core/single-image/white-balance-estimators/`): pixel-
level estimator execution, individual estimator results and
confidence, the estimator ensemble, object-bias evidence, mixed-light
evidence. Stored at `session.evidence.wbEstimators`.

**P1H owns** (`core/single-image/white-balance-intelligence/`): the
final Temperature/Tint decision (`wb-plan-builder.js`, completely
unchanged this round — zero lines edited), mood preservation,
intentional-light protection, guardrails, Candidate integration
(`candidate-builder.js`, unchanged), UI and XMP lineage.

`core/single-image/white-balance-estimators/estimator-ensemble.js`
never imports anything from `white-balance-intelligence/` or
`candidate/` — verified by the test suite's static import-graph check
(test #57/#59). P1I evidence flows in exactly one direction: pixel
buffer → estimators → ensemble → `wb-evidence-extractor.js` (P1H) →
`wb-plan-builder.js` (P1H, unchanged) → Candidate.

## Where the wiring happens (the ONLY files touched for integration)

1. `core/single-image/single-image-session.js` — added `'wbEstimators'`
   to `EVIDENCE_KEYS` (additive; automatically null'd by the existing
   `_emptyEvidence()`/`resetActiveSession()` machinery on every new
   upload or Reset — no new reset logic needed, closing tests #61/#62
   for free).
2. `core/single-image/single-image-analysis-profile.js` — added one
   new module descriptor (`moduleId:'wbEstimators'`,
   `evidenceKey:'wbEstimators'`, `fallbackPolicy:'SOFT_FAIL'`,
   `required:false`) declaring `dependencies:['whiteBalance','colorCast']`
   for documentation/ordering purposes.
3. `ui/app.js` — one `import`, and one `try/catch`-wrapped synchronous
   call to `runWhiteBalanceEstimators(img, {generationId})` placed
   immediately after the existing `whiteBalance` evidence commit,
   followed by one `commitEvidence(analysisTicket, 'wbEstimators', ...)`
   call using the exact same fail-closed `SOFT_FAILED`-on-error pattern
   every other optional module in this pipeline already uses.
4. `core/single-image/white-balance-intelligence/wb-evidence-extractor.js`
   — the ONLY P1H file touched. Reads the new `wbEstimators` evidence
   key (optional), and when usable, blends `rawTemperature`/`rawTint`
   toward the ensemble consensus (confidence-weighted average, never a
   silent override) and corroborates `neutralReferenceConfidence`,
   `bgObjectColorRisk`, and `mixedLightingRisk` with P1I's own signals
   for those same fields. `wb-plan-builder.js`, `cast-classifier.js`,
   `wb-guardrails.js`, `mixed-light-detector.js`, and every other P1H
   decision-layer file are **untouched** — P1I only changes what
   evidence LOOKS like, never how P1H decides what to do with it.

## Deviation from the spec's suggested field name

The spec suggests `session.whiteBalanceEstimators` as a dedicated
top-level Session field. This project's established convention (set by
P1A and reused by every subsequent EPIC including P1H's own
`colorCast` wiring) is that ALL analysis evidence lives under
`session.evidence.<key>`, gated through the SAME `commitEvidence()`/
`EVIDENCE_KEYS` machinery that already provides generation-gating,
stale-ticket rejection, and reset-clearing for every other evidence
type. Inventing a second, parallel storage location for P1I would
duplicate that machinery for no benefit and risk the exact class of
bug P1A's Session design was built to prevent (a value that outlives
its generation). `session.evidence.wbEstimators` is used instead,
logged here explicitly as the intentional, equivalent-architecture
substitution the spec permits ("Equivalent architecture is acceptable
if responsibilities stay clear").

## Fallback behavior (proven, not just asserted)

Verified by direct execution (see also test #56): when
`wbEstimators` evidence is absent, `SOFT_FAILED`, or present but its
`ensemble.usableEstimatorIds` is empty, `extractWBEvidence()`'s P1I
branch never executes — `rawTemperature`, `rawTint`,
`neutralReferenceConfidence`, `bgObjectColorRisk`, and
`mixedLightingRisk` all retain their EXACT R1 values, and `source`
stays `"whitebalance-engine[+color-cast-detector]"` with no
`+pixel-multi-estimator` suffix. This was confirmed with a real
UNAVAILABLE-status bundle producing byte-identical extractor output to
the no-`wbEstimators`-key case.

## Generation gating

`runWhiteBalanceEstimators()` is called once per `runAnalysis()`
invocation (once per generation), exactly like every other evidence
module in this pipeline — no separate re-run trigger exists for it,
so it cannot re-run on language change, slider edit, XMP download, or
panel expansion (those code paths never call `runAnalysis()` at all).
Its result is committed via the same `commitEvidence()` stale-ticket
check every other module uses, so a late-resolving call from a
superseded generation can never attach its bundle to a newer Session
(test #63).


## R2 addendum -- Skin Validation V2 integration (additive only)

R1 shipped `skinConsistencyConfidence` as a **proxy** signal in
`wb-evidence-extractor.js`: `skinWarmth.confidence x skin coverage`, a
colorimetric approximation with no real per-pixel skin validation
behind it. R2 replaces that proxy, only when a usable result is
available, with the real pixel-level result from
`wbEstimators.skinValidation` (see `P1I_R2_PIXEL_SKIN_VALIDATION_MODEL.md`
and `P1I_R2_SKIN_CORRECTION_PLAUSIBILITY.md`).

The change in `wb-evidence-extractor.js` is a single, additive
substitution inside the existing `if (p1iUsable) { ... }` block:

```js
const skinValidation = wbEstimators.skinValidation ?? null;
const skinValidationUsable = !!(skinValidation
  && skinValidation.status !== 'UNAVAILABLE'
  && Number.isFinite(skinValidation.confidence));
if (skinValidationUsable) {
  skinConsistencyConfidence = _clamp01(skinValidation.confidence);
}
```

**When `skinValidation` is absent, `UNAVAILABLE`, or has a non-finite
confidence, the R1 proxy formula computes `skinConsistencyConfidence`
completely unmodified** -- this is the fallback path required by the
spec, and it was verified directly (not just asserted): a real
`UNAVAILABLE`-status `wbEstimators` bundle produces a byte-identical
`skinConsistencyConfidence` value to the pre-R2 code path (R2 suite
tests 21/26).

`p1iSummary` gains one new, purely additive sub-object,
`p1iSummary.skinValidation`, carrying `status`, `confidence`,
`acceptedSkinPixels`, `spatialCoverage`, `correctionSupported`, and
`conflictWithNeutral` for diagnostics/UI consumption -- populated only
when `skinValidationUsable` is true, `null` otherwise.

**Every other line of `wb-evidence-extractor.js`, and every line of
`wb-plan-builder.js`, `cast-classifier.js`, `wb-guardrails.js`,
`mixed-light-detector.js`, and `skin-consistency-validator.js`, is
untouched.** P1H's final ownership of the Temperature/Tint decision is
unchanged by this round: Skin Validation V2 only changes what one
input confidence value LOOKS like when real pixel evidence is
available, never how P1H decides what to do with it -- the exact same
principle this document already establishes for P1I R1's own evidence
in the section above.

### Storage location (documented deviation, same convention as R1)

The spec suggests `session.whiteBalanceEstimators.skinValidation` (or
an equivalent clearly-documented field) as the storage location. Per
this document's own R1 precedent (see "Deviation from the spec's
suggested field name" above), this project stores ALL P1I evidence
inside the single `wbEstimators` bundle already committed to
`session.evidence.wbEstimators` by `commitEvidence()`. `skinValidation`
is simply one more additive key on that SAME bundle --
`session.evidence.wbEstimators.skinValidation` -- rather than a second,
parallel storage location. This reuses the exact generation-gating,
stale-ticket rejection, and reset-clearing machinery the R1 bundle
already has (see "Generation gating" above), which a second top-level
field would have had to duplicate for no benefit.
