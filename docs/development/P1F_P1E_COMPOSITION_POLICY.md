# P1F / P1E Composition Policy

## The ownership boundary

P1F (Basic Tone Intelligence) and P1E (Color Intelligence & Creative
Tone) run back-to-back inside `candidate-builder.js`, on the same
Candidate object, and must never write each other's fields.

| Layer | Writes | Never writes |
|---|---|---|
| P1F | `candidate.basic.{exposure,contrast,highlights,shadows,whites,blacks,texture,clarity,dehaze}` | `candidate.hsl`, `candidate.grading`, `candidate.cal`, `candidate.basic.vibrance`/`saturation`, `candidate.whiteBalance` |
| P1E | `candidate.hsl`, `candidate.grading` (excl. `balance`), `candidate.cal` (excl. `shadowTint`), `candidate.basic.vibrance`/`saturation` | any of the 9 Basic fields P1F owns |

## Composition order

```
Evidence
  → baseline Core Candidate (raw-preset reshape)
  → Basic Tone Plan            (P1F — this EPIC)
  → Color Intelligence Plan    (P1E R3, unchanged)
  → canonical Candidate validation
  → UI
  → XMP
```

`candidate-builder.js` calls `buildBasicTonePlan()` immediately after
the raw-preset reshape and immediately before
`applyColorIntelligence()`. This ordering was chosen (not arbitrary)
so that:

1. P1F's lineage/diagnostics can still reference what the legacy
   pipeline originally produced (`rawPreset.exp` etc.) if ever useful,
   without any dependency on P1E's output.
2. P1E's Color Intelligence enrichment sees the **final** P1F Basic
   values already in place on `candidate.basic` before it runs —
   though P1E never reads or writes those fields, so this is a
   documentation/traceability convenience, not a functional
   dependency.
3. The `diagnostics.autoValues` snapshot (used by Reset-to-Auto) is
   taken **after both** P1F and P1E have run, so Reset-to-Auto
   correctly restores the full, final auto-generated state for every
   field — confirmed in test 48 of
   `qa/epic-2e-p1f-basic-tone-intelligence-test.mjs`.

## How the boundary is enforced and verified

- **Source-level docstrings**: both `candidate-builder.js`'s P1F block
  and its P1E block carry an explicit comment stating exactly which
  fields they write and reminding the reader which fields belong to
  the other layer.
- **Grep-verifiable**: `color-plan-builder.js` and the
  `applyColorIntelligence()` call site in `candidate-builder.js`
  contain no assignment to any of the 6 clamp-covered Basic fields —
  checked programmatically in test 7 of the P1F suite (regex search
  for `candidate.basic.(exposure|contrast|highlights|shadows|whites|
  blacks)\s*=`).
- **Independent recomputation proof**: test 45 rebuilds the Basic Tone
  Plan directly from the same evidence a full session build used, and
  asserts the built Candidate's `basic.*` values still exactly match —
  proving P1E's enrichment step (which runs immediately after P1F in
  the same function) never touched them.

## Strength-mode independence

P1F's `STRENGTH_MODE.{NATURAL,BALANCED,DRAMATIC}` (scalars `0.60/1.00/
1.35`) governs **tonal structure only** and is deliberately **not**
wired to P1E's own color `STRENGTH_MODE`/`STRENGTH_SCALARS`. The
original EPIC spec allowed unifying the two "if architecture clearly
supports a unified intent model" — it does not (the two strength
concepts control genuinely different things: tonal correction strength
vs. creative color strength), so they were kept independently owned
this round. Verified by test 42 (no actual import/shared state between
`basic-tone-schema.js` and `color-intelligence-schema.js` beyond a
documentation cross-reference in comments).

## Reused parity/export infrastructure

P1F introduces **no new parity mechanism**. `candidate-export-parity.js`
(P1E R3) and its underlying `PROPERTY_MAP` (P1D) already covered all 9
Basic fields before this EPIC (they were simply near-zero in practice).
P1F's Basic values flow through the exact same
`computeExportParity()` / `quickSafetyClamp()` / `runXmpFidelityGate()`
pipeline P1E R3 built, with zero new code in that path — verified by
tests 51-60 (Export Parity + XMP Readback Fidelity).
