# P1E — Creative Tone Heuristics

This document explains the specific heuristics behind each bound and gate
in `color-intelligence-schema.js` and `color-plan-builder.js`, and why none
of them is a brittle "always +N" constant.

## 1. Restoration fraction, not a fixed offset

Every field's new value is computed as:

```
gap = evidenceTarget - currentValue
restored = currentValue + gap * fraction
```

`fraction` = `STRENGTH_SCALARS[strengthMode] * extraCaution`. Because this
is a *fraction of the gap to a real, evidence-derived target* rather than
a flat addition, an image with little real color-grading opportunity
(most gaps near zero) receives almost no push, while an image with a
genuinely strong, well-covered color signal (a large gap between the
dampened Candidate value and the Core engine's own recommendation)
receives a proportionally larger, still-bounded push. This directly
satisfies the "no near-zero output for images with real grading
opportunity, but no brittle hardcoded push either" requirement.

## 2. Never overshoot, never flip sign

```
boundedByEvidence = |restored| > |evidenceTarget| ? evidenceTarget : restored
```

P1E's own authority never exceeds what the Core engine itself already
decided was reasonable for that channel/zone/primary. If the current
(legacy-dampened) Candidate value and the fresh evidence recommendation
disagree in sign — a real, if rare, situation where the legacy pipeline's
own scene-trust weighting pushed a channel one way while a fresh read of
the same evidence would push it the other — P1E treats this as a signal
of genuine uncertainty and stays at the current value, clamped to the
Layer A bound, rather than picking a side on its own authority.

## 3. Coverage gates: never fabricate a hue that isn't there

`MIN_MEANINGFUL_COVERAGE_PCT.hslChannel = 3` and `.calibrationPrimary = 2`.
These thresholds come from the same coverage percentages the Core engines
themselves already use to classify a channel's `dominance` as `minimal`
(the `hsl-analyzer-engine`'s own `DOM.accent = 2` threshold) — P1E's gate
sits just above "accent" so a channel with only a couple of stray pixels
never gets a confident push, while a channel that's genuinely present in
the image (even as a secondary/accent color, not just the dominant one)
is eligible.

## 4. Grading confidence gate: trust the whole zone set, or none of it

`MIN_GRADING_CONFIDENCE = 0.35`. Unlike HSL/Calibration (which expose
per-channel/per-primary coverage), `colorgrading-ai-engine` exposes a
single top-level `confidence` covering all three zones together — a
by-product of it selecting one scene-appropriate "look" as a whole,
not three independent per-zone decisions. Gating on this single number,
applied identically to all three zones, is the only honest option: there
is no per-zone signal to differentiate trust further.

## 5. Skin caution is a curve, not a threshold

```js
if (skinCoveragePct <= 2) return 1.0;
if (skinCoveragePct >= 25) return 0.30 * confidenceFactor + 0.05;
if (skinCoveragePct >= 10) return 0.45 * confidenceFactor + 0.10;
return 0.65 * confidenceFactor + 0.15;
```

Real portraits vary continuously from "a hand in frame" to "a full-frame
headshot" — a single on/off skin flag would either under-protect large
skin regions or over-suppress incidental skin. The scale is additionally
weighted by the skin module's own confidence (`confidenceFactor`, floored
at 0.4 so a low-confidence skin read is never treated as "definitely no
skin"), and the missing-evidence case (`skinCoveragePct === null`)
defaults to 0.5 — moderately cautious — rather than 1.0, because assuming
"definitely no skin" just because the module didn't report is exactly the
mistake this project's "skin protection has structural priority"
convention exists to prevent.

## 6. Asymmetric skin HSL bounds (satLow ≠ satHigh)

`BOUNDS.hsl.skin = { hue: 4, satLow: 8, satHigh: 6, luminance: 10 }`.
A small amount of extra desaturation on skin-adjacent hues reads as a
gentle, safe softening; the same magnitude of *oversaturation* reads as
sunburnt/orange/plastic far more readily. The asymmetric bound (allowing
slightly more room in the desaturating direction than the saturating one)
encodes this real photographic asymmetry directly in the limit, rather
than relying on the restoration math to happen to land on the safe side.

## 7. Calibration is the bluntest tool — most conservative fraction

Calibration primaries shift the whole image's red/green/blue channel
definitions, not a local hue range the way HSL does, nor a tonal zone the
way Grading does. Its restoration fraction is deliberately scaled `×0.8`
relative to HSL/Grading's fraction, and only the red primary receives
additional skin caution (green/blue primary shifts have negligible
visible effect on skin tones by comparison).

## 8. Presence (Vibrance/Saturation) is derived, never a flat constant

There is no single Core engine that owns global Vibrance/Saturation the
way HSL/Grading/Calibration own their own fields. Rather than hardcoding
"+20 vibrance whenever color evidence exists" (explicitly forbidden by
the EPIC brief), P1E derives an `opportunityScore` from how many other
field families it just found real, meaningful work to do
(`fieldsBoosted.length`) and the blended confidence across whichever of
HSL/Grading/Calibration actually reported a confidence
(`overallColorConfidence`). An image where P1E found nothing else to
strengthen also gets no Presence push; an image where several field
families were genuinely engaged gets a proportionally larger, still
bounded Presence lift. Saturation is additionally kept at `×0.7` of the
Vibrance target, because global Saturation (unlike Vibrance, which
protects already-saturated tones and skin to a degree even in Lightroom's
own implementation) offers no such protection and is the least skin-safe
control available in the supported export set.

## 9. Internal strength modes are linear scalars over the same bounds

`STRENGTH_SCALARS = { NATURAL: 0.35, BALANCED: 0.70, CINEMATIC: 1.00,
STRONG: 1.30 }`. These multiply the restoration *fraction*, never the
hard *bound* — so even at `STRONG`, no field can ever exceed the same
Layer A ceiling `BALANCED` or `NATURAL` would also respect. This keeps a
future user-facing intensity control (out of scope for this EPIC) purely
additive: exposing it later would never require touching any bound.
