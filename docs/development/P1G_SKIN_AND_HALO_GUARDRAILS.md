# P1G Skin and Halo Guardrails

Detail work (sharpening + luminance smoothing) is the category of
adjustment most likely to visibly damage a portrait if left
unguarded — halos around high-contrast edges from oversharpening, and
"plastic skin" from oversmoothing. `detail-guardrails.js::applyDetailGuardrails()`
is the single place all of these protections are enforced, run once
per Detail Plan build, always, regardless of strength mode.

## Skin protection

- Skin coverage above `SKIN_HEAVY_COVERAGE_FRACTION` (0.15) triggers
  reduced Sharpening ceilings relative to the same evidence with low
  skin coverage (test 20).
- Even under `STRENGTH_MODE.CRISP` (the most aggressive mode), a
  skin-heavy portrait's Sharpening never exceeds ~65% of the absolute
  Sharpening bound ceiling (test 33) — CRISP remains skin-safe by
  construction, not by accident.
- Luminance NR's oversmoothing protection (see
  `P1G_NOISE_REDUCTION_POLICY.md`) caps NR strength on skin-heavy,
  high-noise images below the bucket maximum (test 27).

## Halo protection

Sharpening on genuinely soft/blurry/motion-blurred source content
produces visible halos rather than recovered detail, because there is
no real edge information to sharpen. `SOFT_FOCUS` and
`MOTION_BLUR_RISK` scene flags route Sharpening into the restrained
`NOISY_OR_SOFT` bucket (0-18) regardless of any other evidence signal
(test 13, 18, 19), and no fixture in this EPIC's 10-fixture suite —
including deliberately halo-prone scenes — is ever allowed past the
documented 0-35 absolute bound (test 22).

## The required bilingual "focus limited" diagnostic

When Sharpening is deliberately reduced because source sharpness is
genuinely limited, `FOCUS_LIMITED_TEXT` (verbatim, from
`detail-schema.js`) is surfaced in
`candidate.diagnostics.detailIntelligence.reasons` and in the UI:

- EN: "Source sharpness is limited, so sharpening was reduced to avoid halos."
- TH: "ภาพมีความคมชัดต้นฉบับจำกัด ระบบจึงลดการเพิ่มความคมเพื่อป้องกันขอบภาพแตก"

This is never a promise that missed focus can be recovered — it
explains the safety decision, matching the project's "explainability
is a product requirement" convention.

## Motion-blur protection

Distinct from (but overlapping with) halo protection:
`motionBlurProtection` is tracked as its own flag in
`candidate.diagnostics.detailIntelligence.protections`, since a
motion-blurred image can have entirely different evidence
characteristics (localized blur direction) than a globally soft-focus
image, even though both currently route through the same restrained
bucket in this phase.

## Low-detail protection

Flat/low-texture source content (sky, smooth walls, out-of-focus
backgrounds) gains nothing from aggressive sharpening and can show
visible noise amplification from it. The `LOW_DETAIL` scene flag
suppresses Sharpening pressure via `lowDetailProtection`, tracked
alongside the other protection flags.

## NaN/Infinity fail-closed handling

`applyDetailGuardrails()` explicitly checks `Number.isFinite(rawInput)`
**before** rounding/clamping (since `clamp(NaN, lo, hi)` evaluates to
`NaN`, not a safe default — confirmed by reading
`core/color-engine/index.js::clamp()`). A non-finite input is
fail-closed to 0 and an explicit adjustment-reason string
("... was not a finite number -- fail-closed to 0 ...") is always
recorded, not just when the value happened to change (mutation test
M3). This was a real latent bug found and fixed proactively during
this EPIC's own implementation, before it could surface as a test
failure.
