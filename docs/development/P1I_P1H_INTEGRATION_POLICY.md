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
