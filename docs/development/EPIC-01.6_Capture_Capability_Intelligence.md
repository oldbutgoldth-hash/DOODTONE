# EPIC 1.6 — Capture Capability Intelligence (RAW-Aware)

## Goal

Answer a question no prior stage asked: **"what is this source capture
realistically capable of reproducing, before any style is even
considered?"** — distinct from Style DNA/Feasibility (which ask "is the
DETECTED STYLE reproducible?") and from Photographer Intent (which asks
"what creative direction is intended?"). Capture Capability is about the
RAW FILE's own technical ceiling.

## Directory Discrepancy Found and Resolved

The spec's "Allowed directories" named `core/image-analysis/` — this
**did not exist** in the current codebase; only `core/image-analysis-core/`
(an existing pixel-analysis engine) was present. Rather than assume a
typo and modify the existing engine (explicitly forbidden — "Do NOT
modify existing analysis engines"), a genuinely new folder
`core/image-analysis/` was created, following the exact precedent EPIC
1.3 set with `core/color-match/color-match-intelligence-bridge.js`: a
new AGGREGATION/INTERPRETATION module, not a new pixel-analysis engine.
`core/capture-capability-model.js` reads already-computed signals; it
performs no new pixel work of its own.

## Architecture

```
core/histogram-engine (stats: drStops, clipHiPct, clipLoPct, whitePoint,
                        blackPoint, avgSatPct, rbDiff, gDiff) — unchanged
core/image-analysis-core (noiseScore, sharpnessScore) — unchanged
        ↓ (both already existed; read, never duplicated)
core/image-analysis/capture-capability-model.js  ← NEW
   buildCaptureCapability()      — Tasks 1–4
   buildIntentCompatibility()    — Task 5
   buildCaptureBudgetHints()     — Task 9
        ↓
Decision Engine   : preliminary  (imageAnalysisCore not yet resolved)
Reference Transfer: authoritative (imageAnalysisCore available)
        ↓
Decision Report + Reference Transfer Report expose both
```

**Same circular-dependency pattern as Style Feasibility** (Stage
2.4.2B.2) and Reference Color Intelligence (EPIC 1.3): `core/image-
analysis-core`'s noise/sharpness data isn't resolved yet when Decision
Engine runs (confirmed directly in `core/reference-transfer-engine`'s
own JSDoc: `imageAnalysisCore: object|null, // ... if resolved by this
point`). Rather than write two separate scoring implementations for
"preliminary" and "authoritative," **the exact same
`buildCaptureCapability()` function is called from both places** — only
its inputs differ (`imageAnalysisCore: null` at Decision Engine time vs.
the real object at Reference Transfer time). This guarantees the two
callers can never silently drift into different logic.

## Capability Scoring (Tasks 1–3)

Nine 0–1 dimensions, each derived from an existing signal:

| Field | Derived from |
|---|---|
| `dynamicRange` | `stats.drStops / 9` |
| `highlightRecovery` | `1 - clipHiPct/15` |
| `shadowRecovery` | `1 - clipLoPct/15` |
| `noiseTolerance` | `1 - noiseScore/55` (or neutral 0.55 default pre-resolution) |
| `whiteBalanceLatitude` | `1 - (|rbDiff|+|gDiff|)/35` (colour cast strength) |
| `colorLatitude` | eases off above 55% average saturation (headroom before clipping) |
| `skinReliability` | passed-through skin confidence, or neutral 0.6 default |
| `highlightLatitude` | blend of `(255-whitePoint)` headroom and `highlightRecovery` |
| `shadowLatitude` | blend of `blackPoint` headroom and `shadowRecovery` |

`overallScore` is a weighted blend of all nine (weights favour dynamic
range and noise tolerance slightly). `overallCapability` bands:
Excellent (≥0.85) / Very Good (≥0.70) / Good (≥0.50) / Limited (≥0.30) /
Poor (below).

**Verified with two contrasting synthetic captures:**
- Clean, wide-DR, low-noise input → `Excellent` (0.926), 5 strengths
  listed, confidence 0.9.
- Heavily-clipped, high-noise, strong-cast input → `Poor` (0.19), all 5
  expected limitations correctly triggered (highlight clipping, shadow
  clipping, colour cast, elevated noise, saturation ceiling).

## Editing Headroom (Task 4)

Deliberately a **different weighted blend** from `overallScore` —
emphasising recoverability/latitude (what's left to push) over raw
technical cleanliness (noise), since "how much room is there to grade"
is a distinct question from "how clean is this file technically":

```
editingHeadroom = highlightRecovery×0.25 + shadowRecovery×0.25
                + whiteBalanceLatitude×0.20 + colorLatitude×0.15 + dynamicRange×0.15
```

**Verified degrading gracefully across the circular-dependency
boundary:** called with `imageAnalysisCore: null` (Decision Engine's
situation), `noiseTolerance` correctly fell back to a neutral 0.55 (not
an optimistic guess), and `confidence` correctly dropped from 0.9 to 0.55
— reflecting the genuine uncertainty of not yet having real noise data,
rather than silently pretending the estimate is as reliable as the
later authoritative one.

## Intent Compatibility Algorithm (Task 5)

`INTENT_CAPABILITY_REQUIREMENTS` gives 10 of the 21 intents (Premium,
Elegant, Dreamy, Cinematic, Low Key, High Key, Editorial, Bold, Filmic,
Commercial) a specific, explainable minimum-capability profile; the rest
fall back to a generic overall-score-only check. Each requirement is
checked against the just-built `captureCapability`; `score` is
High/Medium/Low based on pass ratio, `compatible` at ≥60% pass.

**Verified with the same two contrasting captures:** Premium intent
against the Excellent capture → `compatible: true, Medium`; against the
Poor capture → `compatible: false, Low`, with the exact two failing
checks named (`skinReliability 0.30 < 0.6`, `highlightLatitude 0.00 <
0.5`) — concrete, actionable limitations, not a bare score.

## Capture Budget Hints (Task 9)

`buildCaptureBudgetHints()` maps capability latitudes directly onto
6 named budget priorities (`highlightBudget`, `shadowBudget`,
`wbBudget`, `colorBudget`, `contrastBudget`, `textureBudget`) — every
returned object's `reasons[]` states explicitly these are priorities for
**a future EPIC 1.7 stage**, and change nothing here. Verified: on the
Poor-capture test, `highlightBudget`/`shadowBudget`/`wbBudget` all
correctly read nearly 0 (matching that capture's near-total lack of
recovery latitude), while `colorBudget` (0.625) correctly stayed higher
since saturation headroom was less exhausted than highlight/shadow/WB
latitude in that specific synthetic case.

## Style Feasibility Extension (Task 6)

`buildCaptureCapability()` accepts an optional `styleFeasibility` input
purely to **compare, never overwrite**: if Capture Capability's own
`overallScore` and the existing feasibility score diverge by more than
0.3, a `warnings[]` entry flags the discrepancy for review; otherwise a
`reasons[]` entry notes the two are consistent — corroborating language
only, no numeric interaction with the existing feasibility score
anywhere in this stage.

## Decision Report Changes (Task 7)

Three new top-level fields: `captureCapability` (explicitly labelled
"Preliminary estimate" with a pointer to the authoritative version),
`intentCompatibility`, `captureBudgetHints`. New narration: a capture-
capability sentence (photographer-facing) plus a `[dev]`-tagged
compatibility-limitation sentence when intent compatibility is not
"High" — mirroring the existing `[dev]`-tag convention used for other
developer-facing asides in this file.

## Reference Transfer Report Changes (Task 8)

Adds the **authoritative** `captureCapability`, `intentCompatibility`,
`captureBudgetHints` to the return object, plus one new recommendation
explicitly answering "why is transfer easy/medium/hard" from a capture-
capability standpoint (`overallScore` ≥0.7/≥0.45/below → easy/medium/
hard) — a distinct explanation from the existing complexity/WB-risk-
based recommendation already in this file, not a replacement for it.

## Modified / New Files

**New:**
- `core/image-analysis/capture-capability-model.js`
- `docs/development/EPIC-01.6_Capture_Capability_Intelligence.md` (this
  file).

**Modified (additive only, verified backward-compatible):**
- `core/decision-engine/index.js` — new import; preliminary
  `captureCapabilityEstimate`/`intentCompatibilityEstimate`/
  `captureBudgetHints` computed after `photographerIntent`, all EPIC
  1.4/1.5 fields kept unchanged.
- `core/reference-transfer-engine/index.js` — new import; authoritative
  `captureCapability`/`intentCompatibility`/`captureBudgetHints` added
  to the return object; one new recommendation.
- `core/decision-report-engine/index.js` — 3 new top-level fields, 2 new
  narration lines.

**Not modified:** `core/lightroom-mapping-engine`, `core/xmp-validator`,
`core/histogram-engine`, `core/image-analysis-core`, every other
pixel-analysis engine, `index.html`, `ui/*.js`.

## Self Review (per spec's explicit checklist)

- **Imports:** verified `core/decision-engine` and `core/reference-
  transfer-engine`'s new imports both resolve; project-wide import scan
  (comment-filtered) reports all imports resolve.
- **Syntax:** `node --check` + real ESM `import()` passed for all 4
  touched/new files.
- **Backward compatibility:** re-ran `buildFinalPreset()` with the same
  test input used throughout EPICs 1.4/1.5 — `photographerIntent.
  primaryIntent`/`intentStrength` read identically to before this stage.
- **Decision Report:** verified new fields present and populated.
- **Reference Report:** verified new fields present and populated.
- **Project Memory:** updated (see `05_PROJECT_MEMORY.md`).
- **XMP export:** full end-to-end browser test — main pipeline analyse →
  export produced a valid XMP with zero console errors; EPIC 1.3's
  Reference Color Match panel (separately) also still generates/
  downloads valid XMP. Mobile layout unchanged (390px, no overflow).

## Remaining Risks

- **`INTENT_CAPABILITY_REQUIREMENTS` covers only 10 of 21 intents** — the
  other 11 use a generic overall-score-only check, which is honest (no
  invented specific requirements) but less precise.
- **Capability scoring weights/thresholds are newly hand-reasoned**,
  consistent with every other scoring formula in this project — not
  tuned against real RAW files with known, measured recoverability.
- **The preliminary (Decision Engine) estimate always lacks real noise/
  sharpness data** — its `noiseTolerance` is a neutral guess, not a
  measurement, until the authoritative Reference Transfer version
  supersedes it. Any code reading `captureCapabilityEstimate` alone
  (without also checking the authoritative `captureCapability`) should
  treat its noise-related fields with reduced trust.
- **`captureBudgetHints` are explicitly inert this stage** — EPIC 1.7 is
  the stage that would need to actually consume them; until then they
  are pure documentation/explanation with no code path reading them
  back into any decision.
- **No UI surface for Capture Capability** — like EPIC 1.4/1.5, this
  stage's allowed directories didn't include a UI file, so this is
  report-level integration only.
