# EPIC 2E-P1E R3 — Evidence-to-Creative-Tone Map

Maps each required scene-aware behavior from the spec to its real,
existing-evidence-only implementation. No fabricated signals — every
row cites the exact `signals.*` or `candidate.*` field it reads.

## Portrait / skin-heavy

- **Requirement**: protect Red/Orange, prefer Vibrance, gentle Orange
  luminance, allow background shaping.
- **Implementation**: `classifyScene()` → `PORTRAIT_SKIN` when
  `signals.skin.coveragePct >= 15`. Red/Orange/Yellow (`SKIN_ADJACENT_HSL_CHANNELS`)
  NEVER receive the `hslNonSkin` scene multiplier — only their
  always-active `skinCautionScale()` applies, unconditionally
  regardless of scene class (structural priority, unchanged from
  R1/R2). `presenceVibrance` multiplier is 1.15 (boosted);
  `presenceSaturation` is 0.75 (dampened — "Saturation is the least
  skin-safe control", per `color-plan-builder.js`'s own comment).
  Non-skin channels (background) get a mild 1.05 `hslNonSkin` boost —
  "allow background shaping" without touching skin.

## Green outdoor

- **Requirement**: prevent fluorescent green, use Green Hue/Luminance
  separation, keep skin independent.
- **Implementation**: `classifyScene()` → `GREEN_OUTDOOR` when scene
  confidence ≥ 0.40 and `signals.scene.category` matches the
  outdoor/nature/foliage pattern. `hslNonSkin` multiplier 1.15 (the
  strongest non-skin HSL boost of any scene class) — green channel
  restoration (hue/luminance separation) is the SAME
  `_restoreTowardEvidence()` math as every other channel, just given a
  larger fraction of its already-BOUNDS-capped gap to close, so it can
  never overshoot into an unnatural/fluorescent result. Skin channels
  are structurally unaffected (checked first in `classifyScene()`; a
  green-outdoor classification can never simultaneously apply to a
  skin-heavy image, since `PORTRAIT_SKIN` takes priority).

## Travel / colorful costume

- **Requirement**: allow stronger non-skin HSL, preserve costume color
  identity, avoid near-zero decorative colors, controlled Calibration.
- **Implementation**: `classifyScene()` → `COLORFUL_COSTUME` when scene
  confidence ≥ 0.40 and category matches
  travel/costume/festival/market/culture/parade/carnival/street.
  `hslNonSkin` multiplier 1.20 (highest of any scene class — "allow
  stronger non-skin HSL"). Calibration multiplier 1.05 (mild boost,
  not unbounded — "controlled Calibration"). "Avoid near-zero
  decorative colors" is handled by the existing, unchanged
  `MIN_MEANINGFUL_COVERAGE_PCT` gate in `color-plan-builder.js` (a
  channel below real coverage threshold is left untouched, never
  invented) combined with the boosted multiplier making genuinely
  present decorative colors restore further toward their real evidence
  target rather than staying dampened.

## Low-saturation image

- **Requirement**: increase Vibrance more than Saturation, avoid
  noise/cast boost, no fabricated nonzero channels.
- **Implementation**: `classifyScene()` → `LOW_SATURATION` when the
  sum of `|candidate.hsl.saturation[ch]|` across all 8 channels ≤ 8.
  `presenceVibrance` multiplier 1.25 (highest of any family/scene
  combination in the whole table); `presenceSaturation` multiplier
  0.90 (deliberately lower than Vibrance's boost — "increase Vibrance
  more than Saturation"). "No fabricated nonzero channels" is the same
  unchanged `MIN_MEANINGFUL_COVERAGE_PCT` gate — a channel with no real
  coverage stays exactly at its current (often zero) value regardless
  of scene class.

## Already-saturated image

- **Requirement**: reduce/limit global saturation, selective HSL not
  global boost.
- **Implementation**: `classifyScene()` → `ALREADY_SATURATED` when the
  same saturation-magnitude sum is ≥ 40. This is the ONLY scene class
  whose multipliers are ALL below 1.0: `hslNonSkin` 0.70,
  `presenceVibrance` 0.70, `presenceSaturation` 0.60 (the lowest value
  in the entire table), `grading` 0.85, `calibration` 0.90 —
  represented explicitly as `technicalCorrection.appliesRestraint: true`
  in `plan.layers` for explainability. "Selective HSL not global boost"
  is inherent to the architecture: each HSL channel is restored
  independently based on its OWN evidence coverage/target, never as a
  single global multiplier applied uniformly.

## Basic Tone support (audited, not redesigned)

Per the instruction "do not turn P1E R3 into a full Basic Panel
rewrite" and "if Core genuinely produced zero, do not invent arbitrary
values inside the Color Intelligence module" — the R3 audit confirmed
`basic-panel-engine`'s conservative/zero output for low-confidence or
flat-scene input is a genuine, intentional design choice (project
philosophy: "Basic Panel is a supporting signal, never primary"), not
a P1E defect. No change was made to Basic Panel logic this round. A
documented recommendation for a possible future Basic Tone phase is
filed in `P1E_R3_KNOWN_LIMITATIONS.md`.
