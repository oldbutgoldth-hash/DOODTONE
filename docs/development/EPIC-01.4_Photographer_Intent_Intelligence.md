# EPIC 1.4 — Photographer Intent Intelligence

## Goal

Add a dimension Photographer Intelligence didn't have before:
`photographerStyle` answers "what look category is this?" (Luxury
Wedding, Brown Film). `photographerIntent` answers a genuinely different
question: "what feeling or creative direction is the photographer trying
to create?" (Dreamy, Premium, Editorial). The same style can carry
different intents — a Luxury Wedding photo could read as "Premium" or
as "Romantic" — so this had to be built as a structurally separate
classification, never a relabeling of style.

## Source Verification

All 5 `docs/project/*.md` files confirmed present before starting. Before
writing any code, `_buildStyleSignals`, `_classifyPhotographerStyle`,
and the exact ordering of `photographerStyle` →
`referenceColorSupport` (EPIC 1.3) → `styleFeasibilityEstimate` (Stage
2.4.2B.2) computation inside `_buildDecision` were all re-verified
directly against the current source — Photographer Intent was placed
*after* all three, so it can use every one of them as an input signal
without needing to duplicate any of their own computation.

## Architecture

```
Style Fingerprint / Style Feature Graph / WB Intent   (unchanged, reused)
        ↓
photographerStyle (Stage 2.4.2A)             — look category
        ↓
referenceColorSupport (EPIC 1.3, optional)   — colour-evidence corroboration
        ↓
styleFeasibilityEstimate (Stage 2.4.2B.2)    — preliminary transferability
        ↓
photographerIntent (EPIC 1.4)  ← NEW          — creative/emotional direction
   reads ALL of the above as input signals, invents no new pixel analysis
```

`_buildIntentSignals()` reuses the exact same underlying fingerprint/
graph/wbIntent fields `_buildStyleSignals()` already reads, and adds the
already-computed `photographerStyle`, its DNA validation score,
`styleFeasibilityEstimate`, and (optionally) `referenceColorIntelligence`
from EPIC 1.3 — satisfying "Do NOT perform new image analysis" literally:
every signal Intent reads already existed in this file before this stage.

## Intent Vocabulary (19, all from the spec's list)

Dreamy, Premium, Clean, Editorial, Natural, Emotional, Minimal, Romantic,
Cinematic, Bold, Muted, Warm, Soft, Classic, Modern, Documentary, Filmic,
High Key, Low Key.

Implemented as a declarative `INTENT_PROFILES` table — the same "shared
signals object + per-entry `match()`" pattern `STYLE_PROFILES` already
uses (chosen for the same "cleanest maintainable" reasoning that pattern
was picked for originally). Each entry carries the Task 1/3 static
fields (`description`, `emotionalDirection`, `visualDirection`,
`preferredCues`, `conflictingCues`, `styleDNARelationship`,
`feasibilityNotes`) plus a `match()` returning a score and **structured**
hits (not plain strings) — each hit is already shaped as
`{source, signal, weight, reason}`, which Task 4's evidence output reads
directly with no extra transformation step.

## How Intent Is Inferred

`_buildPhotographerIntent()` runs every profile's `match()` against one
shared signals object, ranks by raw score (unlike Style Vocabulary, no
separate priority-weighted tie-break was needed — intents don't have the
same "common vs. rare" tension named styles do), and returns:

- `primaryIntent` / `secondaryIntents` (top 3 above a 0.2 floor)
- `confidence` — scaled by the Style Fingerprint's own
  `overallConfidence`, exactly the same formula shape used for Style
  Vocabulary's confidence (`score × (0.5 + 0.5 × overallConf)`), for
  consistency across both classifiers.
- `evidence[]` — each hit's weight converted into a per-evidence
  confidence share (`confidence × hit.weight / topScore`).

**Verified live:** an Airy Wedding-shaped input correctly produced
primary intent `"Dreamy"` (secondary: High Key, Romantic, Clean) with
4 structured evidence entries citing Style Fingerprint, Style Feature
Graph, Skin Analysis, and Photographer Style as sources — matching the
spec's own worked example almost exactly in shape.

## Evidence Weight Calculation (Task 4)

```
evidence.weight     = the static contribution this signal makes to match() (fixed per rule)
evidence.confidence = clamp01(intentConfidence × (weight / topProfileScore))
```

This is explanation-only, exactly as required — `evidence` is read by
Decision Report (Task 6) and nothing else; it never feeds back into
scoring, DNA, feasibility, or (this stage) Lightroom Mapping.

## Conflict Detection (Task 5)

`INTENT_CONFLICT_RULES` covers all 8 named examples from the spec
(Dreamy+Heavy Contrast, Clean+Dirty Whites, Premium+Harsh Skin,
Natural+Extreme Color Grading, Editorial+Very Low Confidence,
High Key+Crushed Blacks, Low Key+Over-opened Whites, Filmic+Neon
Saturation) — the same "required/forbidden rule table" pattern
`STYLE_DNA_RULES` (Stage 2.4.2B.1) already established.

**Verified against all 3 non-trivial cases with isolated synthetic
signals** (not just designed and assumed correct):
- High Key + `contrastLevel:'high', moodTag:'moody_dark'` → correctly
  flagged "Crushed Blacks," severity high.
- Premium + `skinDetected:true, skinConfidence:0.2` → correctly flagged
  "Harsh Skin," severity high.
- Filmic + `paletteSat:85` → correctly flagged "Neon Saturation,"
  severity high.

**Never auto-corrects** — `intentConflicts.recommendations` only ever
suggests reviewing the read, exactly as the spec requires.

## Decision Report Changes (Task 6)

`photographerIntent` is exposed as a **separate top-level field**,
deliberately NOT nested under `photographerStyle` — the spec's core
distinction (style ≠ intent) would be undermined by nesting one inside
the other. New narration lines: primary intent + confidence + emotional
direction, secondary intents with scores, and any conflict warnings —
mirroring the existing `photographerStyle`/`styleDNAValidation`
narration style for consistency.

## Reference Transfer Integration (Task 7)

`_buildRecommendations()` reads the already-computed `photographerIntent`
(via `ctx.decisionStrategy.finalStyleIntent.photographerIntent` — the
same access pattern already used for `referenceColorSupport`) and adds:
- A plain-language intent + feasibility-notes line.
- A `[dev]`-tagged conflict warning when one exists.
- A specific "likely needs localized editing" note when a
  complexity-sensitive intent (Filmic/Cinematic/Editorial) combines with
  high reference complexity, versus a "strong global-preset candidate"
  note when a simpler intent (Clean/Natural/Minimal/Classic) combines
  with low complexity — directly answering the spec's "why is transfer
  easy or difficult" question. **The transfer algorithm's own formulas
  were not touched anywhere in this file.**

## Modified / New Files

**Modified (additive only):**
- `core/decision-engine/index.js` — `_buildIntentSignals()`,
  `INTENT_PROFILES` (19 entries), `INTENT_CONFLICT_RULES`,
  `_detectIntentConflicts()`, `_buildPhotographerIntent()`; wired into
  `_buildDecision()` after `styleFeasibilityEstimate`.
- `core/decision-report-engine/index.js` — `photographerIntent` surfaced
  as a new top-level field + narration.
- `core/reference-transfer-engine/index.js` — intent-aware recommendation
  additions in `_buildRecommendations()`.

**New:**
- `docs/development/EPIC-01.4_Photographer_Intent_Intelligence.md` (this
  file).

**Not modified:** `core/lightroom-mapping-engine`, `core/xmp-validator`,
every pixel-analysis engine, `core/color-match/*` (Task 1's "Allowed
directories" included `core/color-match/` but no change was needed there
— Intent reads `referenceColorIntelligence`'s existing output as-is),
`index.html`, `ui/*.js`, all styling/branding.

## Verified End-to-End (no regressions)

- EPIC 1.3's Reference Color Match × Photographer Intelligence Bridge
  (JS-injected Photographer Intelligence section, Generate/Download XMP)
  — still works identically.
- Main pipeline — full analyse → export flow, zero console errors, XMP
  still valid.
- Mobile (390px) — unchanged, `scrollWidth` 396px.

## Remaining Risks

- **19 hand-written intent profiles inevitably overlap** — e.g. Dreamy
  and Romantic, or Classic and Natural, share several match conditions
  and could plausibly both fire strongly on the same reference; only the
  8 named conflict pairs from the spec have been individually verified,
  not every possible pair among 19 intents.
- **Intent confidence/evidence weights are newly hand-reasoned**,
  consistent with every other scoring table in this project — not tuned
  against a labelled sample.
- **`photographerIntent` is not yet read anywhere in Style DNA
  Validation or Style Feasibility's own scoring** — per the spec's
  explicit "must NOT override Style DNA" / "must NOT change Lightroom
  Mapping yet" constraints, this stage deliberately built Intent as a
  read-only consumer of those systems, not a contributor back into them.
  A future stage could explore Intent informing Style Budget once
  Lightroom Mapping changes are back in scope.
- **No UI surface for `photographerIntent` yet** — Decision Report and
  Reference Transfer Report both expose it programmatically, but no
  visual panel displays it (Task 6/7 were report-level integration only;
  the spec's allowed directories didn't include a UI file for this
  EPIC).
