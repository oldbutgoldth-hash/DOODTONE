# P1H — Candidate Build Pipeline Order

## Final order (in `candidate-builder.js`, `buildCandidateFromSession()`)

1. Pure raw-preset reshape (`rawPreset.*` -> `candidate.*`, unchanged
   from P1C) — this INCLUDES a first-pass `candidate.whiteBalance.temperature/.tint
   = rawPreset.temp/.tint` assignment, which is then overwritten in
   step 2.
2. **P1F — Basic Tone Plan** (`buildBasicTonePlan()`) — writes the nine
   Basic fields.
3. **P1H — White Balance Plan** (`buildWhiteBalancePlan()`) — OVERWRITES
   `candidate.whiteBalance.temperature`/`.tint` with its own
   evidence-driven, guardrail-capped values, replacing the value the
   step-1 reshape set from the legacy `_mapWhiteBalance()`-computed
   `rawPreset.temp`/`.tint`. Writes
   `candidate.diagnostics.whiteBalanceIntelligence`.
4. **P1E — Color Intelligence enrichment** (`applyColorIntelligence()`)
   — writes `candidate.hsl`/`.grading`/`.cal`/`.basic.vibrance`/`.saturation`.
5. **P1G — Detail Plan** (`buildDetailPlan()`) — writes
   `candidate.detail.sharpening`/`.noiseReduction`.
6. Per-parameter lineage entries + `autoValues` snapshot (unchanged
   structure, now reflecting P1H's finalValues for the two WB fields).

This matches the spec's requested order (Evidence -> P1F Basic Tone
Plan -> P1H White Balance Plan -> P1E Color Plan -> P1G Detail Plan ->
Candidate validation -> UI -> XMP) exactly — no reordering of the
already-established P1F/P1E/P1G steps was needed; P1H's own step was
inserted between P1F and P1E.

## Why this order, specifically

- **After P1F, before P1E**: P1F's Basic fields do not depend on White
  Balance in any way (verified: `basic-tone-plan-builder.js` never
  reads `evidence.wb`), so ordering relative to P1F is free. P1E's own
  evidence-gate DOES read `evidence.wb`/`evidence.colorCast` (for its
  own, separate technical-correction heuristics) but never reads
  `candidate.whiteBalance.*` — so P1H writing before P1E is not
  required for correctness, but keeps the composition order consistent
  with "evidence-derived Plans run before creative enrichment,"
  matching the P1F-before-P1E precedent.
- **Before P1G**: unrelated fields; no dependency either direction.

## Generation gating

`buildWhiteBalancePlan()` is called exactly once per
`buildCandidateFromSession()` invocation, which is itself gated by the
Session's generation ID via the orchestrator's existing
`isActiveGeneration()` check (unchanged, P1A-era mechanism). A stale
generation's `buildAndCommitCandidate()` call returns
`committed:false` before ever reaching `candidate-builder.js` — proven
in the P1H test suite's M7 mutation test.
