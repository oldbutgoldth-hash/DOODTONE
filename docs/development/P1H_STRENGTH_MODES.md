# P1H — Strength Modes

Three modes (`STRENGTH_MODE` in `white-balance-schema.js`):

- **CONSERVATIVE** (×0.6 multiplier on guardrail caps): favors
  preserving the reference's existing look; smaller corrections even
  for high-confidence defect readings.
- **BALANCED** (×1.0, `DEFAULT_STRENGTH_MODE`): the caps documented in
  `P1H_TEMPERATURE_TINT_GUARDRAILS.md`.
- **CORRECTIVE** (×1.3): allows a larger correction for high-confidence
  readings, but is STILL bounded (safety-ceiling-clamped to
  38/[-11,29]) and STILL respects the object-color-bias and
  mixed-light guards — CORRECTIVE strength never bypasses either
  protection (verified: P1H test suite check 70).

No user-facing mode-selection UI was added this round (the spec
explicitly does not require "complex public UI" for this); the mode is
currently fixed at `DEFAULT_STRENGTH_MODE` (BALANCED) at the
`candidate-builder.js` call site, exactly like P1F's and P1G's own
strength-mode defaults. Wiring a UI toggle (mirroring P1E R3's
technical/creative strength selector, if one exists) is a reasonable
follow-up but is out of this round's scope.
