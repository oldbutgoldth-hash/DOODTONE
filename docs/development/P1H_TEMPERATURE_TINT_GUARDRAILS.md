# P1H — Temperature / Tint Planning Guardrails

## Existing, unmodified export ceiling (core/xmp-validator HARD_LIMITS.wb)

```
tempCap: 40, tintGreenFloor: -12, tintMagentaCeil: 30,
tintGreenFloorIntentional: -25
```
`quickSafetyClamp()` additionally hard-caps at `tempCap*1.5=60` and
floors/ceils tint at `tintGreenFloorIntentional`/`tintMagentaCeil` as
an absolute last resort. P1H does not touch any of these — they
remain exactly as P1G R2 (and earlier rounds) left them.

## P1H's own planning ranges (`wb-guardrails.js`), BALANCED strength

| Confidence tier | Temp cap | Tint cap |
|---|---|---|
| high | ±35 | ±18 |
| moderate | ±20 | ±10 |
| low | ±8 | ±4 |

Strength-mode multipliers: CONSERVATIVE ×0.6, BALANCED ×1.0, CORRECTIVE
×1.3 — always further clamped to a safety ceiling of 38 (temp) /
[-11, 29] (tint), comfortably inside the validator's 40 / [-12..-25,
30] ceiling, mirroring the exact "planner stays under the validator"
convention P1G R2 established for Sharpening/Noise Reduction.

## Confidence tier derivation

`wb-plan-builder.js`'s own `planConfidence` is a weighted blend of:
`0.35 × neutralReferenceConfidence + 0.30 × estimatorAgreement + 0.15 ×
(skin confidence, if trusted) + 0.20 × (1 - max(objectBiasScore,
mixedLightScore))`, further discounted by `(1 - 0.3 × transferRiskScore)`.
This is P1H's OWN confidence signal — related to, but distinct from,
`whitebalance-engine`'s own `confidence` field (which only measures how
well the engine understood THIS image, not how safely that reading
should drive an export-facing correction).

## Correction computation

`correction = round(rawConsensusReading × moodFactor)`, where
`moodFactor` is `whitebalance-engine`'s own
`moodPreservation.preservationFactor` ONLY when the cast is classified
intentional (never re-derived), or `1.0` otherwise — then capped at
the confidence-tier guardrail, then further reduced 0.4× for
object-color-bias and/or 0.6× for mixed light. This deliberately
applies at most ONE mood-preservation-style multiplicative factor
before the guardrail cap, instead of the legacy path's three
compounding factors (`pf × intensityScale × wbDampen`) — see
`P1H_WHITE_BALANCE_VALUE_LINEAGE_AUDIT.md` §1 for the full root-cause
analysis this design directly addresses.
