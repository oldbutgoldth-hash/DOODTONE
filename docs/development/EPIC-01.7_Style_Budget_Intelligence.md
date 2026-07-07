# EPIC 1.7 — Style Budget Intelligence

## Goal

Answer: **"Given the photographer intent, style DNA, feasibility, and
capture capability, how should editing EFFORT be distributed?"** — an
abstract resource-allocation layer sitting between Capture Capability
(EPIC 1.6) and a future Lightroom Mapping V2. Every value produced here
is a 0–1 priority; nothing in this stage generates a Lightroom slider
value or touches the XMP generator.

## Naming Collision Found and Resolved

Per the risk already flagged in `05_PROJECT_MEMORY.md` before this stage
began: a **different, older** `styleBudget` already exists in
`core/decision-engine` (Stage 2.4C's `_buildStyleBudget` — a simple
4-category colour-mood budget, e.g. `{name:'balancedBudget', hsl:0.2,
calibration:0.2, colorGrading:0.3, wb:0.15, curve:0.15}`, that genuinely
DOES feed `core/lightroom-mapping-engine` today). This stage's entire
new system is named **`styleBudgetIntelligence`** everywhere — a
distinct field, distinct file, distinct export — specifically to avoid
clobbering or being confused with that existing system.

**Verified directly, not just designed around:** ran `buildFinalPreset()`
and printed `decision.styleBudget` (legacy) alongside
`finalStyleIntent.styleBudgetIntelligence` (new) in the same test run —
the legacy object came back completely unchanged
(`{"name":"balancedBudget","total":1,"hsl":0.2,...}`), confirming zero
interference.

## Architecture

```
core/decision-engine/style-budget-model.js  ← NEW
   buildStyleBudgetIntelligence()  — Tasks 1, 3-8
        ↓
Decision Engine   : preliminary  (styleFeasibilityEstimate, captureCapabilityEstimate)
Reference Transfer: authoritative (styleFeasibility, captureCapability — real data)
        ↓
Decision Report + Reference Transfer Report expose both
```

Same "one function, two call sites" pattern verified working in EPIC
1.6: `core/reference-transfer-engine` imports the SAME
`buildStyleBudgetIntelligence()` from `core/decision-engine/style-budget-
model.js` rather than duplicating its logic — only the inputs differ
(preliminary vs. authoritative Style Feasibility/Capture Capability).

## Task 2 — Inputs (existing signals only)

Reads: `photographerIntent` (primaryIntent, intentFamily, intentStrength,
confidence, conflicts), `photographerStyle.top.styleDNA` /
`styleDNAValidation`, `styleFeasibility` (score or level), 
`captureCapability` (all 9 dimensions + confidence),
`referenceColorIntelligence.confidence` (optional), `engineTrustWeights`
(optional, contextual only). **`calibrationRegistry` was checked and
deliberately NOT used**: its 12 existing `style-budget`-category entries
all belong to the legacy Stage 2.4C system (`owner:
'lightroom-mapping-engine'`) and don't correspond to this stage's 11 new
budget dimensions — inventing new registry keys for a system explicitly
forbidden from touching Lightroom Mapping seemed more likely to create
confusion than clarity, so this is logged as a risk instead (see below).

## Task 3 — Intent-Aware Allocation

`INTENT_BUDGET_ALLOCATION` implements all 6 named examples from the spec
(Premium, Dreamy, Filmic, Editorial, Cinematic, Natural) exactly as
specified. Every other intent among EPIC 1.4/1.5's 21 falls back to its
own **family's** allocation via `FAMILY_BUDGET_ALLOCATION` (e.g. "Elegant"
→ `luxury-clean` family → Premium's allocation), and any intent with no
family match falls back to a neutral `DEFAULT_BUDGET_ALLOCATION` — every
intent produces a sensible budget, none silently fall through to
undefined values.

## Task 4 — Capture-Aware Adjustment (verified with contrasting inputs)

Implements all 6 named rules from the spec exactly (low highlight
recovery → reduce tonal, raise safety; low shadow recovery → reduce
contrast, raise safety; low noise tolerance → reduce detail, raise
safety; low WB latitude → reduce WB; low colour latitude → reduce
HSL/calibration, raise safety; low skin reliability → raise skin, reduce
colour).

**Verified concretely:** ran the identical Premium+Clean-Whites-DNA
input through an Excellent capture and a Poor capture —
`tonalBudget` correctly dropped from 0.85 → 0.70 and `safetyBudget`
correctly rose to its clamped maximum of 1.0 purely from the capture
capability difference, with nothing else in the inputs changed.

## Task 5 — Style DNA-Aware Reinforcement

`DNA_BUDGET_RULES` reads DNA element **names** already produced by
`_buildStyleDNA` (Stage 2.4.2B) — never recomputes DNA. Implements all
DNA elements named across the spec's 3 worked examples (Airy Wedding:
Clean Whites, Highlight Roll-off, Open Shadows, Neutral Warm Skin; Brown
Film: Brown Midtones, Matte Blacks, Muted Green, Warm Skin, Film Color
Separation; Green Pastel: Bright Green Luminance, Reduced Green
Saturation, Pastel Palette, Soft Contrast) as named rules — 13 in total.

**Verified against the spec's own example almost verbatim:** a synthetic
Green-Pastel-DNA input produced a suppressed area of
`{area: "green saturation", reason: "Reduced Green Saturation DNA
prefers luminance over saturation.", source: "Style DNA: Reduced Green
Saturation"}` — matching the spec's own worked phrase ("green saturation
suppressed because Green Pastel DNA prefers luminance over saturation")
almost exactly.

## Task 6 — Over-Stacking Detection (verified triggering correctly)

`STACKING_RULES` implements all 5 named patterns from the spec. Each
rule only fires when its full multi-condition threshold is met (deliberately
not overly sensitive) — **verified both a non-triggering case** (budgets
at 0.5-0.55, below the 0.65 threshold — correctly reported `hasRisk:
false`) **and a triggering case** (hslBudget 0.75 + calibrationBudget 0.7
+ colorGradingBudget 0.8, all above 0.65 — correctly reported `hasRisk:
true, severity: "high"` naming exactly the 3 affected budgets and the
reasoning). Never auto-corrects — only ever returns
recommendations/reasons.

## Task 7 — Budget Suppression

`suppressedAreas[]` combines DNA-driven suppressions (Task 5) with
capture-driven suppressions (checked directly against
`captureCapability`'s own dimensions — e.g. `highlightRecovery < 0.35` →
"aggressive highlight recovery" suppressed) and budget-driven
suppressions (e.g. a deliberately-low `calibrationBudget` → "aggressive
calibration" suppressed). Every entry carries the required
`{area, reason, source, severity}` shape. **Verified: the Poor-capture
test correctly produced 5 suppressed areas** spanning capture, DNA, and
budget sources in one combined list.

## Task 8 — Budget Confidence (verified genuinely separate from intent confidence)

```
budgetConfidence = intentConfidence×0.20 + intentStrength×0.15
                 + dnaValidationScore×0.20 + feasibilityScore×0.20
                 + captureConfidence×0.15 + refColorConfidence×0.10
                 − conflictPenalty − stackingPenalty
```

**Verified concretely, not just designed:** constructed a test case with
intent confidence fixed at 0.85 but deliberately low DNA validation
(0.5) and low feasibility (0.3) — budget confidence came back at
**0.578**, clearly distinct from the 0.85 intent confidence, proving the
spec's explicit requirement ("Do NOT reuse intent confidence directly")
holds structurally, not just by omission.

## Decision Report Changes (Task 9)

New top-level field `styleBudgetIntelligence` (all 11 budgets,
confidence, priorities, suppressedAreas, budgetStackingRisk, risks,
warnings) — explicitly labelled "Preliminary estimate" with a pointer to
the authoritative version, following the same convention EPIC 1.6
established for `captureCapability`. New narration lines: a
photographer-facing "Style Budget prioritizes X, Y, Z" sentence (in the
style of the spec's own worked example), a suppressed-areas sentence,
and a `[dev]`-tagged stacking-risk sentence when applicable.

## Reference Transfer Report Changes (Task 10)

Adds the **authoritative** `styleBudgetIntelligence` to the return
object, plus two new recommendations: one explaining whether the budget
suggests a conservative or expressive transfer (directly preparing for
"EPIC 2 Lightroom Mapping V2" as the spec's Task 10 purpose states), and
a `[dev]`-tagged one when stacking risk is present. **The transfer
algorithm itself was not touched anywhere in this file.**

## Modified / New Files

**New:**
- `core/decision-engine/style-budget-model.js`
- `docs/development/EPIC-01.7_Style_Budget_Intelligence.md` (this file).

**Modified (additive only, verified backward-compatible):**
- `core/decision-engine/index.js` — new import; preliminary
  `styleBudgetIntelligence` computed after `captureBudgetHints`; the
  EXISTING, unrelated `styleBudget` (Stage 2.4C) verified completely
  unchanged.
- `core/reference-transfer-engine/index.js` — new imports; authoritative
  `styleBudgetIntelligence` added to the return object; 2 new
  recommendations.
- `core/decision-report-engine/index.js` — 1 new top-level field, 3 new
  narration lines.

**Not modified:** `core/lightroom-mapping-engine` (confirmed via direct
grep — zero references to any EPIC 1.7 symbol anywhere in that
directory), `core/xmp-validator`, every pixel-analysis engine,
`index.html`, `ui/*.js`, EPIC 1.2's Reference Color Match UI.

## Self Review (per spec's explicit checklist)

- **Imports:** new imports in both `decision-engine` and
  `reference-transfer-engine` verified to resolve; project-wide
  comment-filtered import scan reports all imports resolve.
- **Syntax:** `node --check` + real ESM `import()` passed for the new
  file and all 3 modified files.
- **Backward compatibility:** legacy `decision.styleBudget` verified
  byte-identical to its pre-EPIC-1.7 shape; EPIC 1.4/1.5/1.6 fields
  (`photographerIntent.primaryIntent`, `captureCapabilityEstimate.
  overallCapability`) verified still present and correct.
- **Decision Report:** verified new field present and populated.
- **Reference Report:** verified new field present and populated.
- **Project Memory:** updated (see `05_PROJECT_MEMORY.md`).
- **XMP export:** full end-to-end browser test — main pipeline
  (analyse → decision-engine → lightroom-mapping-engine → XMP) produced
  valid output with zero console errors; EPIC 1.2/1.3's Reference Color
  Match panel separately still generates/downloads valid XMP.
- **No UI regression:** mobile 390px unchanged, `scrollWidth` 396px.
- **No Lightroom Mapping changes:** confirmed via direct grep — no
  symbol from this stage appears anywhere in
  `core/lightroom-mapping-engine`.

## Remaining Risks

- **Calibration Registry was not read from** — the 12 existing
  `style-budget`-category entries belong to the unrelated legacy system;
  no new registry keys were added for this stage's 11 dimensions. A
  future stage could add them if Style Budget Intelligence itself needs
  tunable constants beyond its current hand-authored tables.
- **`INTENT_BUDGET_ALLOCATION` only has 6 hand-written entries** (of 21
  intents) — the rest rely on family-level fallback, which is reasonable
  but less precise than an intent-specific profile would be.
- **`DNA_BUDGET_RULES` covers 13 named DNA elements** — any DNA element
  not in this list is silently ignored (correct behaviour — no invented
  reinforcement — but means coverage is partial across the full DNA
  vocabulary).
- **Budget allocation weights/thresholds are newly hand-reasoned**,
  consistent with every other scoring system in this project — not
  tuned against real edited-photo outcomes.
- **`styleBudgetIntelligence` is entirely inert with respect to Lightroom
  Mapping** — by design, per this stage's explicit constraints. A future
  "Lightroom Mapping V2" (named in the spec's own Architecture Position
  diagram) would be the stage that actually consumes this budget to
  produce slider values — that stage does not exist yet.
- **The preliminary (Decision Engine) estimate's Capture Capability input
  always lacks real noise data** (per EPIC 1.6's own documented
  limitation) — this cascades into `styleBudgetIntelligence`'s
  preliminary version too; the authoritative Reference Transfer version
  should be preferred wherever both are available.

---

## EPIC 1.7F — Cleanup Patch (Production Hardening)

A focused cleanup patch applied after this stage, before EPIC 2. Scope
was strictly limited to `core/decision-engine/style-budget-model.js`
(+ small, necessary follow-on edits in `reference-transfer-engine` and
`decision-report-engine` report text). **Legacy `decision.styleBudget`
was not touched; Lightroom Mapping and XMP generation were not touched.**

### Patch 1 — `budgetLevel` vocabulary fixed

`assertive` was replaced everywhere with `expressive`. A 4th value,
`aggressive-risky`, was added as a **warning label only** — it never
changes any budget value or feeds Lightroom Mapping — surfaced when a
high overall budget (`≥0.54`) coincides with a real risk signal (low
safety budget, high stacking-risk severity, or limited capture
capability).

**Threshold calibration note:** the originally-planned `≥0.7` threshold
for "high budget" was found, on testing, to be unreachable in practice —
`overallBudget` is an 11-dimension average, and several dimensions
(`detailBudget`, `calibrationBudget`) are deliberately kept low by
nearly every intent allocation. The realistic ceiling across all 6 named
intents, even with full DNA reinforcement and an excellent capture, is
~0.57. The threshold was recalibrated to `0.54` — verified against all 6
named intents under both typical and excellent capture conditions to
confirm it's meaningfully reachable without being trivially easy to
reach.

### Patch 2 — `priorities[]` upgraded

Each entry now has `{area, dimension, value, level, reason, source}`.
`dimension`/`value` are kept unchanged for backward compatibility;
`area` is a human-readable label (e.g. "tonal control", "skin
protection"), `level` is low/medium/high/critical, `reason` explains WHY
(pulling the most specific applicable adjustment reason — DNA, capture,
or noise — rather than a generic filler), and `source` names the
originating signal category (Photographer Intent / Style DNA / Capture
Capability / etc.).

### Patch 3 — Fallback confidence lowered when inputs are missing

An explicit `missingInputCount` (0-6, across photographerIntent,
styleDNA, styleDNAValidation, styleFeasibility, captureCapability,
referenceColorIntelligence) now directly penalises confidence — at 4+
missing, confidence is capped at `0.38 - 0.04×(count-4)`, landing
squarely in the required 0.25-0.38 band. **Verified: calling with a
completely empty `{}` input produced confidence 0.3, budgetLevel
"conservative"** — previously this could have drifted back up near 0.5
purely from neutral per-field defaults compounding positively.

### Patch 4 — Noise uncertainty handling added

New `noiseReliability {status, source, confidence, reason}` field —
`status` is `measured` / `estimated` / `unavailable`, determined
honestly: `unavailable` when no `captureCapability` object exists at
all; `estimated` when `captureCapability` exists but its own
`warnings[]` shows the "not yet available" text from EPIC 1.6 (meaning
its noise figure is a neutral default, not a measurement); `measured`
otherwise. Noise-aware budget adjustment now branches on this status —
`unavailable` never aggressively cuts `detailBudget` (conservative cap
only), `estimated` applies a mild, explicitly-labelled easing, and only
`measured` applies the full original reduction + suppresses "harsh
clarity"/"aggressive texture". **Verified both branches produce their
required warning text** ("Noise tolerance unavailable; detail budget
uses conservative fallback." / "Noise-related budget is preliminary
because noise source is not confirmed.").

### Patch 5 — Report text updated

`decision-report-engine` narration now reads `priorities[].area` (not
raw dimension keys), phrases `budgetLevel` using the new vocabulary, and
adds an explicit noise-reliability sentence when status isn't
`measured` — following the spec's own worked photographer/developer
explanation examples. `reference-transfer-engine`'s Task 10
recommendation branches on all 4 `budgetLevel` values (previously only
2), and adds a noise-reliability note.

### Patch 6 — Documentation

This section. `05_PROJECT_MEMORY.md` updated accordingly (see below).

### QA Results (all verified, not just asserted)

| Check | Result |
|---|---|
| `decision.styleBudget` legacy still exists, unchanged | ✓ `{"name":"balancedBudget",...}` byte-identical |
| `finalStyleIntent.styleBudgetIntelligence` still exists | ✓ |
| `styleBudgetIntelligence` absent from `core/lightroom-mapping-engine` | ✓ grep confirms zero matches |
| No Lightroom Mapping changes | ✓ file untouched |
| No XMP generation changes | ✓ file untouched |
| Empty input → low-confidence conservative fallback | ✓ confidence 0.3, budgetLevel "conservative" |
| `budgetLevel` never returns `assertive` | ✓ grep confirms zero logic-level matches |
| `priorities[]` include area/level/reason/source | ✓ all 6 required fields present on every entry |
| Noise uncertainty warning appears when source missing/estimated | ✓ both branches verified |
| Full end-to-end (main pipeline + EPIC 1.2/1.3 RCM UI) | ✓ zero regressions, XMP valid both paths, mobile unchanged |

