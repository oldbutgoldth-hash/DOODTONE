# EPIC 2E-P1C — Canonical Lightroom Auto-Tune Candidate Architecture

## Problem this EPIC solves

Before P1C, the Lightroom Auto-Tune values that ended up in the exported
XMP were reconstructed from the DOM sliders at export time
(`readSlidersAsPreset()` → `quickSafetyClamp()` → `serializeXMP()`). The
DOM was a hidden, easy-to-desync source of truth: stale slider values,
missing controls silently dropping a parameter, UI rounding leaking into
export values, and no single place to answer "what is this image's
current Lightroom recommendation, and why."

P1C introduces one canonical, nested **Candidate** object as the single
source of truth for every Lightroom value from the moment analysis
completes until XMP export.

## Canonical flow

```
session.evidence ──► Candidate Builder ──► normalize ──► validate
        │                                                     │
        │                                                     ▼
        │                                          commit to session.candidate
        │                                          commit to Candidate Store
        │                                                     │
        ▼                                                     ▼
session.report (P1B, sibling — never reads/writes Candidate)   Slider Adapter
                                                                │
                                                render values into sliders
                                                                │
                                                    user edits a slider
                                                                │
                                              update ONE Candidate Store parameter
                                                                │
                                          Legacy Preset Adapter (canonical → flat)
                                                                │
                                    existing quickSafetyClamp() (unchanged)
                                                                │
                                       existing serializeXMP() / downloadXMP() (unchanged)
```

Not allowed, and removed by this EPIC: `DOM sliders → reconstruct
Candidate at export time`. The DOM remains a display/editor surface; it
is never read back as the source of exported values.

## Module map (`core/single-image/candidate/`)

| Module | Responsibility |
|---|---|
| `candidate-schema.js` | `CANDIDATE_STATUS` enum, `createEmptyCandidate()`, `validateCandidateShape()` (structural only — undefined/NaN/Infinity/required-group checks), `normalizeCandidate()`. |
| `candidate-builder.js` | Pure reshape: `session.candidateRaw` (the existing flat `buildFinalPreset()` output) + `session.evidence` → the canonical nested Candidate. Never re-runs Core analysis, never retunes a value. |
| `candidate-validator.js` | `SLIDER_RANGES` (real DOM ranges, used to clamp manual edits) + re-exported unmodified `HARD_LIMITS` (from `core/xmp-validator`, warnings only — never clamps). |
| `candidate-store.js` | Thin, generation-gated facade over `session.candidate` (no second copy of the value anywhere). `getActiveCandidate`, `setActiveCandidate`, `updateCandidateParameter`, `applyCandidatePatch`, `resetParameterToAuto`, `resetAllToAuto`, `clearActiveCandidate`, `getValidatedCandidate`, plus its own pub/sub channel. |
| `candidate-slider-adapter.js` | Pure Candidate ⇄ slider-ID mapping, zero direct `document` access (caller injects `setSlider`). `renderCandidateToSliders`, `resolveSliderEdit`, `getSupportedSliderIds`. |
| `candidate-lineage.js` | Per-parameter lineage record builder (`{parameterPath, evidenceKeys, sourceModules, rawRecommendation, autoValue, currentValue, manuallyEdited, confidence}`). |
| `legacy-preset-adapter.js` | Exact inverse of `candidate-builder.js`: canonical Candidate → the flat preset shape the existing `serializeXMP()` already expects. |

## Why `session.candidateRaw` exists

P1A's pre-existing `commitCandidate(ticket, candidate)` wrote the flat
`buildFinalPreset()` output directly into `session.candidate`. P1C
reserves `session.candidate` exclusively for the new canonical Candidate,
so that write target was renamed to `session.candidateRaw`. This is safe
— confirmed by an exhaustive grep across every `qa/*.mjs` test and every
non-`core/single-image/` module — nothing outside `core/single-image/`
ever read `session.candidate`'s old flat shape back. See
`P1C_CANDIDATE_SOURCE_LINEAGE_AUDIT.md` §13 for the full audit trail.

`session.candidate` (canonical, P1C) and `session.candidateRaw` (flat,
P1A/legacy) now coexist as clearly distinct fields with clearly distinct
owners: `candidateRaw` is written once by `commitCandidate()` right after
the existing decision/validation/benchmark pipeline finishes;
`candidate` is derived from it (plus evidence) by
`buildAndCommitCandidate()` and is the only field slider sync and XMP
export ever read.

## Source-of-truth rule (enforced)

1. The Candidate is built once per analysis generation, immediately
   after `commitCandidate()` populates `session.candidateRaw` — never on
   panel expansion, language change, Report interaction, or XMP
   download/generation.
2. Every Candidate commit is generation-gated the same way P1A's
   evidence writes already are (`isActiveGeneration` /
   `updateActiveSession`) — a stale Candidate from a previous image can
   never overwrite the current one.
3. Slider edits update exactly one Candidate parameter via
   `candidateStore.updateCandidateParameter()`, never rebuild the whole
   Candidate, never trigger analysis.
4. XMP export reads `candidateStore.getValidatedCandidate()` — if it
   returns `null` (no Candidate, or an INVALID/STALE/FAILED one), export
   is blocked with an explicit message; there is no silent fallback to
   stale slider values.

## Status model

`EMPTY → BUILDING → AUTO_GENERATED → (VALID | VALID_WITH_WARNINGS |
INVALID) → USER_EDITED` (on any manual edit) `→ (back to AUTO_GENERATED
on Reset-to-Auto)`. `STALE` and `FAILED` are terminal/defensive states
for a superseded generation or a build error.

## Report/Candidate ownership

`session.report` (P1B) and `session.candidate` (P1C) are independent
siblings of the same `session.evidence` — Report generation never reads
the Candidate, Candidate generation never reads the Report, and neither
is generated from the other's natural-language or numerical output.
Verified by static test 62 in `qa/epic-2e-p1c-candidate-test.mjs`.

## Scope explicitly NOT covered by P1C

Full XMP readback fidelity validation (round-tripping an exported XMP
file back through a parser to prove pixel-for-pixel equivalence) is
deferred to P1D. P1C only guarantees that the *input* to the unchanged
`serializeXMP()` now comes from the validated Candidate instead of the
DOM, and that the numeric values reaching that input are identical to
what the pre-P1C DOM-reconstruction path would have produced (see
`P1C_QA_REPORT.md`'s pre/post equivalence result).
