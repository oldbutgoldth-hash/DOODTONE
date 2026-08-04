# P1I — White Balance Colour Math Policy

## Decision: gamma-encoded sRGB, not linear/XYZ/Lab

All P1I gain/ratio computation (Gray World, White Patch, Shades of
Gray, Neutral Region, Highlight/Shadow) runs directly on the
gamma-encoded sRGB bytes Canvas 2D's `getImageData()` returns —
the same convention `core/whitebalance-engine/index.js`'s existing
`_grayWorld`/`_whitePatch`/`_shadesOfGray` have always used (verified
by direct source read, see `P1I_PIXEL_EVIDENCE_PIPELINE_AUDIT.md` §3
and §11).

Considered and rejected: linearising to physical RGB or converting to
XYZ/Lab chromaticity before computing gains. Classic Gray World / White
Patch / Shades-of-Gray algorithms are white-BALANCE gain estimators
applied conventionally to camera/display RGB directly — not
photometric appearance models — so linearisation is not required for
algorithmic correctness. Introducing it here would (a) silently
diverge from `whitebalance-engine`'s existing numbers for the same
scene, breaking the "same units, comparable outputs" requirement
between P1I's estimators and P1H's existing raw evidence, and (b)
require pulling gamma-decode math into every estimator when the
project's ONE existing linearisation (`image-analysis-core/pixel-
math.js`'s `_rgbToLabL()`) is local, single-purpose (mean CIE L* only),
and not exposed for reuse.

## Where linear light IS implicitly used

Nowhere in P1I. `saturationOf()`/`luminance()` (shared via
`wb-color-math.js`, re-exported from `core/color-engine/index.js`)
compute luminance and HSL saturation directly on gamma-space RGB — the
SAME formula every other engine in this project (image-analysis-core's
`histL`, whitebalance-engine's own neutral-candidate filter,
color-cast-detector's tonal-zone split) already uses. No mixing of
gamma and linear values occurs anywhere in this module family.

## Conversions performed, and where

1. **RGB channel gains → Candidate-unit temp/tint** —
   `gainsToTempTint()` in `wb-color-math.js`. Formula
   (`rbDiff*28`/`gDiff*22`, clamped to ±100) is an intentional
   byte-for-byte mirror of `whitebalance-engine`'s private, unexported
   `_gainsToEst()` conversion — re-implemented here (not imported,
   since the source is private) specifically so every P1I estimator's
   output lands in the SAME Candidate-compatible "slider units" scale
   P1H's guardrails already operate in. Never converts to Kelvin at
   this stage — `sliderToKelvin()` remains the single, sole place
   Kelvin conversion happens, per the "Kelvin conversion occurs exactly
   once" acceptance criterion.
2. **Channel means → neutralising gains** — `meanToNeutralGains()`,
   used by every mean-based estimator (Gray World, White Patch, Shades
   of Gray's generalised-mean variant) to avoid re-deriving the
   `ref/mean` gain formula independently per estimator.

## Safety

- `safeNumber()`/`safeClamp()` sanitise NaN/Infinity to a documented
  fallback (0 for values, 1 for gains) before any arithmetic — every
  estimator's public entry point routes its final numeric output
  through these guards. Verified by mutation test M6 ("replace
  estimator output with NaN").
- No dependency beyond the project's own existing
  `core/color-engine/index.js` — no new external colour-science
  library was added, per the "do not require a large external
  dependency unless necessary" requirement; the smallest correct
  approach (reusing what already exists) was sufficient.

## Pixel-level classification thresholds (shared, not duplicated)

| Check | Threshold | Source |
|---|---|---|
| Alpha rejection | `a < 128` | Matches all 3 existing engines exactly (`ALPHA_REJECT_THRESHOLD`) |
| Near-black rejection | `luminance < 8` | New for P1I (`NEAR_BLACK_LUM`) — documented, not silently borrowed |
| Full clip rejection | all 3 channels `>= 255` | New for P1I (`FULL_CLIP_CHANNEL`) — stricter estimators (e.g. White Patch) layer additional near-white/saturation checks on top |

Every estimator imports these from `wb-color-math.js`; none re-derives
its own alpha/near-black/clip check, closing the "duplicated formulas
across modules" risk the spec calls out explicitly.
