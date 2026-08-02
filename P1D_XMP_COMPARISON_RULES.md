# P1D — XMP Comparison Rules

Source: `core/single-image/xmp-fidelity/candidate-xmp-comparator.js`.

## Expected value source (the single most important rule)

The comparator NEVER compares readback against the pre-clamp Candidate
value when `quickSafetyClamp()` legitimately altered it. "Expected"
always means the value actually handed to `serializeXMP()` — i.e. the
flat preset object AFTER `quickSafetyClamp()`. The pre-clamp Candidate
value is preserved separately as `candidateOriginalValue` on every
comparison row, for lineage/diagnostics only, never as the comparison
target.

## Exact equality (tolerance 0)

Every integer Lightroom parameter (Contrast, Highlights, Shadows,
Whites, Blacks, Clarity, Dehaze, Texture, Parametric Curve points,
Sharpness, Noise Reduction, Vibrance, Saturation), Tint, all HSL
integer values, all Calibration integer values, all Color Grading
integer values, Tone Curve point order, and Tone Curve point count.

## Tolerance-based equality

Only `crs:Exposure2012`, because it is the one field the real
serializer formats through a decimal string
(`(exp/100).toFixed(2)`). Tolerance = 1 slider unit (×100 EV), applied
after both sides are normalized back to the same integer unit. In
practice this tolerance is never actually exercised with real integer
Candidate data — the round-trip is provably exact for every integer
input — it exists as a documented safety margin, not a workaround for
observed imprecision.

`crs:Temperature` is compared in **Kelvin** (the XMP's own unit): the
expected slider value is forward-converted via the same
`sliderToKelvin()` used by the real serializer (never a duplicated
formula), and compared with tolerance 0 — the slider↔Kelvin round-trip
was verified exact for every integer value in [-100, 100] during the
serialization audit.

## Missing / mismatched / unsupported

- Missing a REQUIRED property → `MISSING`, severity CRITICAL → FAIL.
- Value differs beyond tolerance → `MISMATCH`, severity CRITICAL → FAIL.
- A documented-unsupported Candidate path (23 total, see the Property
  Map) → `UNSUPPORTED`, severity INFO. This is informational only and
  never contributes to FAIL or PASS_WITH_WARNINGS — it is a permanent,
  structural characteristic of the current serializer's coverage, not
  a per-export anomaly (see `P1D_XMP_FIDELITY_GATE_POLICY.md`,
  "Design note on PASS_WITH_WARNINGS").
- An extra XMP attribute not referenced by the property map, curve
  list, or fixed-literal set → recorded in `unknownProperties`,
  informational, never a comparison row.

## Tone Curve rules

- Correct property name per channel (falls back to `master` when the
  Candidate's per-channel array is `null`, exactly matching
  `core/preset-engine::_curveStr`'s own fallback).
- Point count must match exactly.
- Point order must match exactly (x-ascending, per index).
- NaN/non-numeric tokens, odd token counts, out-of-range values
  (outside [0,255]), and exact-duplicate consecutive points are all
  classified `INVALID` by the strict parser before comparison even
  runs (`strictParseCurveString()` — deliberately independent of
  `core/curve-engine::parseCurvePoints()`, which silently falls back
  to a default linear curve on malformed input; see audit §8).

## Invalid values

`NaN`, `Infinity`, or a non-numeric string in place of a number is
never silently coerced to 0 or a default — the parser records the
property as unparseable (placed as `null` in the readback, i.e. it
behaves the same as a missing property), which the comparator then
classifies `MISSING`/CRITICAL.
