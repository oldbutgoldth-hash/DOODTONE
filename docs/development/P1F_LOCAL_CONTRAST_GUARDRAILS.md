# P1F Local Contrast Guardrails (Texture / Clarity / Dehaze)

## Why this trio gets special treatment

`texture`, `clarity`, and `dehaze` are the **only** 3 of the 9 Basic
fields for which `core/xmp-validator::quickSafetyClamp()` has no clamp
at all (`clampGroup: null` in `xmp-property-map.js`'s `PROPERTY_MAP`
entries for these 3 properties — see
`P1F_BASIC_VALUE_LINEAGE_AUDIT.md`'s "known structural gap" section).
For these fields, `basic-tone-guardrails.js`'s Layer A bound is the
**only** safety net that will ever run — there is no Layer B behind it.

## Texture

`computeLocalContrastDetail()`'s texture branch: a bounded positive
value (`0..BOUNDS.texture.hi`) only for `HIGH_CONTRAST`/`BALANCED`
scenes — scenes with real clothing/environment/architectural detail
worth accentuating. Scaled by `skinScale` so skin-heavy portraits never
get meaningful skin-texture sharpening (texture on skin reads as
pores/blemishes, not "detail"). Zero for every other scene class,
including `LOW_CONTRAST`/`HAZY` (verified test 35).

## Clarity

Same function's clarity branch: a bounded positive value only for
`LOW_CONTRAST`/`HAZY` scenes — genuine local-contrast deficiency.
Also skin-scaled (halo-safe: aggressive Clarity around skin edges
produces visible haloing). Zero for `HIGH_CONTRAST`/`BALANCED`
(verified test 37).

## Dehaze — strictly gated, never a generic contrast substitute

Dehaze is **only ever non-zero when `sceneClass === HAZY`**, and even
then only when a derived haze-confidence proxy
(`(3.2 - contrastRatio)/3.2 + (22 - avgSatPct)/22`, averaged and
clamped to `[0,1]`) meets `HAZE_MIN_CONFIDENCE (0.5)`. Below that
threshold, Dehaze is honestly left at 0 — "zero is the correct, honest
default" is the explicit non-negotiable requirement this EPIC's spec
called out (a common failure mode elsewhere is using Dehaze as a
cheap global-contrast booster on *any* underwhelming image; this
implementation never does that — verified across all 10 named
fixtures in test 38, where every non-`HAZY` fixture produces exactly
0 Dehaze, and test 39, where a borderline-low haze-confidence `HAZY`
case still correctly yields 0).

## Guardrails (Layer A)

`applyBasicToneGuardrails(fields, { noiseRisk })`:

- Clamps all 9 fields to `basic-tone-schema.BOUNDS`, logging an
  adjustment reason whenever a raw value needed clamping.
- Fails closed on non-finite input (`NaN`/`undefined`/`Infinity` →
  treated as `0` before clamping) — verified by mutation test M3,
  which floods every field with `NaN` and confirms zero leakage into
  the Candidate.
- `noiseRisk` (set by the plan builder when `sceneClass` is
  `UNDEREXPOSED` or `LOW_KEY`): further caps Texture/Clarity to 50% of
  their normal max — lifted shadow regions carry amplified sensor
  noise, and sharpening that noise (via Texture/Clarity) would make it
  more visible, not less.

## Testing

Tests 34-39 in
`qa/epic-2e-p1f-basic-tone-intelligence-test.mjs`, plus mutation test
M3 for the NaN fail-closed guarantee.
