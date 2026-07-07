# EPIC 1.5 — Intent Hierarchy & Intent Strength

## Goal

Upgrade EPIC 1.4's flat `photographerIntent` label into a structured
hierarchy (which family, how strongly expressed, what supports/conflicts
with it, and future budget-allocation hints) — while keeping every EPIC
1.4 field working identically for backward compatibility.

## Core Distinction: Strength ≠ Confidence

This stage's central requirement, stated explicitly in the spec: these
are two genuinely different numbers.

```
confidence = how sure the system is that this label is the right one
strength   = how visually dominant that intent reads in the image
```

**Verified concretely, not just designed:** ran `_computeIntentStrength()`
twice with an identical `topScore` (0.8) and identical everything else
except conflict severity (`none` vs. `high`) — `strength` moved from
**0.76 → 0.41** while `confidence` (computed elsewhere, from `topScore ×
overallConf` alone) would have stayed exactly the same for both. This is
the literal proof the two measures are structurally independent, not
just differently-named copies of the same formula.

## Task 1 — Intent Hierarchy Architecture

`INTENT_FAMILY_MEMBERSHIP` implements the 7 families from the spec
exactly, as a **many-to-many** table — several intents (Romantic,
Modern, Clean, Muted, Bold, Cinematic, Filmic) legitimately belong to
more than one family. Two intents referenced by the family definitions
but not present in EPIC 1.4's original 19 — **Elegant** (luxury-clean)
and **Commercial** (minimal-commercial) — were added as two new,
fully-detectable `INTENT_PROFILES` entries (additive; the original 19
are untouched) so the family system has real profiles behind every
member it names, not phantom references.

`_resolveIntentFamily(primaryIntent, secondaryIntents)` scores every
family by how many of the *whole detected intent set* (primary + up to 3
secondaries) it contains — primary-intent membership counts double, so
the family still usually follows the primary intent, with secondaries
only breaking ties — and returns `{family, familyMembers,
matchedFamilyIntents, alternativeFamilies}`. **Verified live:** a
Dreamy-primary result with High Key/Romantic among its secondaries
correctly resolved to the `"soft-emotional"` family (which contains all
three), with `luxury-clean` and `minimal-commercial` reported as
lower-overlap alternatives — exactly the kind of contextual resolution a
fixed 1:1 lookup couldn't produce.

## Task 2 — Intent Strength Calculation

```
strength = topScore × 0.45                         (raw evidence match)
         + sourceDiversity × 0.25                  (Rule: multiple independent sources increase strength)
         + feasibilityBonus × 0.15                 (Rule: high feasibility supports strength)
         − conflictPenalty                         (Rule: conflicting cues reduce strength)
         − validationPenalty                       (Rule: high validation risk reduces strength)
```

`sourceDiversity` counts distinct `evidence[].source` values (capped at
3 for full credit) — directly implementing "strong evidence from
multiple independent sources." `feasibilityBonus` reads the already-
computed `styleFeasibilityEstimate.level`. `conflictPenalty` reads the
already-computed intent conflict severity. `validationPenalty` reads the
detected style's own `styleDNAValidation.score`. **No new signals were
computed** — every input to strength already existed somewhere in this
file before this stage.

`strengthLevel` bands: `subtle` (<0.35), `moderate` (0.35–0.6), `strong`
(0.6–0.85), `dominant` (≥0.85) — chosen so the spec's own worked examples
land correctly (0.82 → strong, 0.91 → dominant, 0.45 → moderate/"mild").

## Task 3 — Intent Relationship Map

**Supporting:** `INTENT_STYLE_SUPPORT` implements all 6 named pairs
(Premium→Luxury Wedding, Dreamy→Airy Wedding/Soft Portrait, Filmic→Brown
Film/Moody Cinematic, Clean→Luxury Wedding/Clean Portrait, Muted→Brown
Film/Green Pastel, Romantic→Airy Wedding/Luxury Wedding).
`_buildSupportingIntents()` checks each supported style against the
*actually detected* `photographerStyle` and flags a match — **verified
live:** a Dreamy/Airy-Wedding reference correctly flagged
`matchesDetectedStyle: true` for "Airy Wedding" specifically.

**Conflicting:** extends EPIC 1.4's `INTENT_CONFLICT_RULES` with the 9th
named rule from this stage (`Minimal` vs. "Excessive Palette
Complexity") — the other 8 rules were already present from EPIC 1.4 and
required no changes. **Never auto-corrects** — same report-only
convention as EPIC 1.4.

## Task 4 — Intent Budget Hints (explanation-only, verified inert)

`INTENT_BUDGET_HINTS` provides `tonalPriority`/`colorPriority`/
`skinPriority`/`contrastPriority`/`toolPreferenceHints`/
`toolAvoidanceHints` for every one of the 21 intents (19 original + 2
new). Every returned hint object's own `reasons[]` field states in plain
language that it does not affect any slider until a future stage reads
it — and **this is structurally true, not just asserted**: confirmed
that `core/lightroom-mapping-engine` was not touched anywhere in this
stage, and re-ran the full XMP export pipeline with identical output.

## Task 5 — Intent Conflict Validation

`_buildIntentConflictValidation()` wraps the existing conflict-detection
result with the additional `affectedIntent`/`affectedStyle` fields the
spec asks for, as a **new, additive field** (`intentConflictValidation`)
— the original `conflicts` field from EPIC 1.4 is kept completely
unchanged alongside it for backward compatibility, rather than being
restructured or removed.

## Decision Report Changes (Task 6)

`photographerIntent` gained `intentStrength`, `strengthLevel`,
`intentHierarchy`, `supportingIntents`, `conflictingIntents`,
`intentConflictValidation`, `intentBudgetHints` — all additive, sitting
alongside every EPIC 1.4 field unchanged. Narration gained a
dedicated strength sentence, explicitly separate from the confidence
sentence, plus a supporting-evidence sentence when the detected style
matches a known intent-style relationship.

## Reference Transfer Integration (Task 7)

`_buildRecommendations()` gained one additional recommendation
explaining whether the intent reads as subtle or dominant, and what that
implies for how assertively a *future* Style Budget stage should apply
it — phrased as forward-looking guidance, since Style Budget for Intent
does not exist yet (explicitly out of scope this stage). **The transfer
algorithm itself was not touched.**

## Modified / New Files

**Modified (additive only, verified backward-compatible):**
- `core/decision-engine/index.js` — 2 new `INTENT_PROFILES` entries
  (Elegant, Commercial); new `Minimal` conflict rule;
  `INTENT_FAMILY_MEMBERSHIP`, `_resolveIntentFamily()`,
  `_computeIntentStrength()`, `INTENT_STYLE_SUPPORT`,
  `_buildSupportingIntents()`, `INTENT_BUDGET_HINTS`,
  `_buildIntentBudgetHints()`, `_buildIntentConflictValidation()`;
  `_buildPhotographerIntent()` extended (all EPIC 1.4 fields kept).
- `core/decision-report-engine/index.js` — new fields surfaced, new
  narration lines added.
- `core/reference-transfer-engine/index.js` — one additional
  strength-aware recommendation.

**New:**
- `docs/development/EPIC-01.5_Intent_Hierarchy_and_Strength.md` (this
  file).

**Not modified:** `core/lightroom-mapping-engine`, `core/xmp-validator`,
every pixel-analysis engine, `core/color-match/*`, `index.html`,
`ui/*.js`.

## Verified End-to-End (no regressions)

- `photographerIntent`'s EPIC 1.4 fields (`primaryIntent`, `confidence`,
  `emotionalDirection`, `conflicts`, `evidence`) all read identically to
  before this stage on the same test input.
- EPIC 1.3's Reference Color Match × Photographer Intelligence Bridge —
  JS-injected UI section, Generate/Download XMP — still works
  identically.
- Main pipeline — full analyse → export flow, zero console errors, XMP
  still valid.
- Mobile (390px) — unchanged, `scrollWidth` 396px.

## Remaining Risks

- **Family resolution can still tie** when a reference's detected
  intents spread evenly across families with no clear majority — the
  `alternativeFamilies` list is meant to surface this honestly, but no
  explicit "ambiguous family" warning is raised the way Style Vocabulary
  (Stage 2.4.2A) raises an ambiguous-style warning; a future refinement
  could add one.
- **Intent Budget Hints are static, hand-authored text per intent**, not
  derived from any Style Budget math — when a real Style Budget stage
  for Intent is eventually built, these hints will need to be validated
  against (or possibly superseded by) whatever that stage actually
  computes.
- **Strength formula weights (0.45/0.25/0.15 plus penalty terms) are
  newly hand-reasoned**, consistent with every other scoring formula in
  this project — not tuned against a labelled sample of real references
  with known "how dominant is this look" ground truth.
- **`INTENT_STYLE_SUPPORT` only covers 6 of the now-21 intents** — the
  other 15 return an empty `supportingIntents` array, which is correct
  (no invented relationships) but means this relationship map is
  currently sparse.
- **`Elegant` and `Commercial` are new intents added purely to complete
  the family system** — unlike the original 19, they were not
  independently requested as detectable creative intents in EPIC 1.4;
  their own `match()` heuristics have not been tested as extensively as
  the original 19's have been across this project's history.
