# P1F Basic Tone Intelligence — Architecture

## Purpose

EPIC 2E-P1F adds a new, independently-owned analysis layer —
**Basic Tone Intelligence** — that produces real, evidence-driven,
bounded recommendations for the 9 Lightroom Basic Panel fields
(`exposure`, `contrast`, `highlights`, `shadows`, `whites`, `blacks`,
`texture`, `clarity`, `dehaze`), replacing the near-zero-by-design
values the P1E R3 baseline inherited from `core/basic-panel-engine`'s
Style Preservation Mode (root cause documented in
`P1F_BASIC_VALUE_LINEAGE_AUDIT.md`).

## Module layout

```
core/single-image/basic-tone-intelligence/
├── basic-tone-schema.js            constants, BOUNDS, SCENE_CLASS, strength scalars
├── dynamic-range-classifier.js     classifyDynamicRange() — 10-way scene classification
├── exposure-recommendation.js      computeExposureRecommendation()
├── highlight-shadow-recovery.js    computeHighlightRecovery() / computeShadowRecovery()
├── black-white-point-planner.js    computeWhitesRecommendation() / computeBlacksRecommendation()
├── local-contrast-planner.js       computeContrastRecommendation() / computeLocalContrastDetail()
├── basic-tone-guardrails.js        applyBasicToneGuardrails() — Layer A safety net
├── basic-tone-lineage.js           buildBasicToneLineage() / summarizeBasicToneDiagnostics()
└── basic-tone-plan-builder.js      buildBasicTonePlan() — the orchestrator
```

Every module in this directory mirrors the shape and conventions
already established by `core/single-image/color-intelligence/` (P1E):
pure functions, no Session/DOM access, no Core analysis calls, no
mutation of inputs.

## Data flow

```
session.evidence.stats (histogram-engine)
session.evidence.skin  (skin-classifier, merged)
        │
        ▼
classifyDynamicRange() ──► sceneClass, confidence, reasons
        │
        ├─► computeShadowRecovery()   ──► shadows
        ├─► computeExposureRecommendation() (reads shadows for coordination) ──► exposure
        ├─► computeHighlightRecovery()  ──► highlights
        ├─► computeWhitesRecommendation()  ──► whites
        ├─► computeBlacksRecommendation()  ──► blacks
        ├─► computeContrastRecommendation() ──► contrast
        └─► computeLocalContrastDetail() ──► texture, clarity, dehaze
        │
        ▼
applyBasicToneGuardrails()  (Layer A — independently-owned bound check)
        │
        ▼
buildBasicToneLineage() / summarizeBasicToneDiagnostics()
        │
        ▼
{ schemaVersion, strengthMode, sceneClass, confidence, evidence,
  technicalCorrection, tonalCharacter, protections, finalValues,
  lineage, diagnostics }   ◄── the Basic Tone Plan
```

`buildBasicTonePlan(evidence, { strengthMode })` in
`basic-tone-plan-builder.js` is the single entry point
`candidate-builder.js` calls. It reads `evidence.stats` and
`evidence.skin` only (via the same `_resultOf()`
COMPLETED/CACHE_HIT-gated helper pattern P1E's `color-plan-builder.js`
established), and returns the full plan object — never touching
Session, DOM, or any other Core module.

## Integration point

`core/single-image/candidate/candidate-builder.js` calls
`buildBasicTonePlan()` once per build, immediately after the raw-preset
reshape and immediately **before** P1E's `applyColorIntelligence()`
call (see `P1F_P1E_COMPOSITION_POLICY.md` for the full ownership-
boundary contract). The plan's `finalValues` are written into
`candidate.basic.{exposure,contrast,highlights,shadows,whites,blacks,
texture,clarity,dehaze}`, and the full plan summary is stored at
`candidate.diagnostics.basicToneIntelligence` for the Advanced
Diagnostics UI.

## Two-layer safety net

- **Layer A** (`basic-tone-guardrails.js`, this EPIC): re-clamps every
  field to `basic-tone-schema.BOUNDS` regardless of what the individual
  planners already produced — the same "always check again even though
  it shouldn't fire" convention this project uses everywhere.
- **Layer B** (`core/xmp-validator::quickSafetyClamp()`, pre-existing,
  Production-Locked): the final, authoritative export-time clamp.

For `exposure/contrast/highlights/shadows/whites/blacks`, Layer A's
bounds sit strictly inside Layer B's `HARD_LIMITS.basic` ranges, so
normal P1F output never depends on Layer B to save it from an
unreasonable value. For `texture/clarity/dehaze` — which
`quickSafetyClamp()` does not clamp at all (`clampGroup: null` in the
P1D property map) — Layer A is the **only** safety net those three
fields get.

## Strength modes

`STRENGTH_MODE.{NATURAL,BALANCED,DRAMATIC}` with scalars
`{0.60, 1.00, 1.35}` (default `BALANCED`) scale every recommended
magnitude before guardrail bounding. These are deliberately **not**
wired to P1E's color `STRENGTH_MODE` — see `P1F_P1E_COMPOSITION_POLICY.md`
for why the two strength models were kept independent this round.

## Testing

`qa/epic-2e-p1f-basic-tone-intelligence-test.mjs` — 70 required cases
(AUDIT AND OWNERSHIP, SCENE CLASSIFICATION, EXPOSURE,
HIGHLIGHTS/SHADOWS, WHITES/BLACKS, CONTRAST, LOCAL CONTRAST, MODES,
SESSION AND EDITING, PARITY, REGRESSION) plus 7 mutation tests
(M1-M7), all passing against the real production modules
(77/77 PASS). Registered in `qa/run-static-suites.mjs`.
