# EPIC 2E-P1E R3 — Export-Safe Value Policy

## Policy statement

Every color value P1E itself computes and writes onto the Candidate
(HSL Hue/Saturation/Luminance ×8 channels, Color Grading
Hue/Saturation/Luminance ×3 zones, Calibration Hue/Saturation ×3
primaries, Vibrance, Saturation) is:

1. Bounded by P1E's own module-local `BOUNDS`
   (`color-intelligence-schema.js`) — proven, per parameter family, to
   sit strictly under `quickSafetyClamp()`'s corresponding hard cap
   (see the table in `P1E_R3_COLOR_VALUE_PARITY_AUDIT.md` §1-§4).
2. Rounded to the nearest whole Lightroom slider unit via the new
   `_roundClean(v) { return Math.round(v); }` helper in
   `color-plan-builder.js`, applied at the exact point every field is
   assigned onto `plan.*` — never left as a raw floating-point
   restoration result.

Both properties together guarantee: for any P1E-authored (non-manually
-edited) Candidate, `candidate value == quickSafetyClamp() output ==
serializeXMP() input == parseXmpReadback() output == what Lightroom's
own slider displays`. This is proven, not assumed — see
`qa/epic-2e-p1e-r3-parity-creative-tone-test.mjs` tests 1-23.

## Why rounding was added this round (genuine latent defect found)

Before this fix, `_restoreTowardEvidence()`'s fractional arithmetic
(e.g. `2 + 20 * 0.805 = 18.1`, or worse, a float artifact like
`18.099999999999998`) was stored on the Candidate and serialized into
the XMP string verbatim — `core/preset-engine/index.js::serializeXMP()`
never rounds `hsl_s_*`/`grd_*_s`/`cal_*_s` etc. (confirmed by full
source read, unchanged Production-Locked file). Lightroom's own preset
importer would then round or otherwise reinterpret that non-integer
attribute value on its own terms, silently reintroducing exactly the
class of UI-vs-Lightroom divergence this whole round exists to close —
independent of, and in addition to, the quickSafetyClamp() divergence
risk. This was discovered during the R3 parity audit (via test 49's
regression failure trail — see `P1E_R3_RELEASE_NOTES.md`'s Errors and
Fixes) and closed at the production level with `_roundClean()`, not
patched around in a test.

## What is NOT covered by this policy

- **Manual slider edits** (`updateCandidateParameter()`, P1C R3) can
  still push a value past P1E's BOUNDS but within the looser DOM
  `SLIDER_RANGES` — `quickSafetyClamp()` legitimately fires in this
  case, and this is the one real, reproducible divergence scenario.
  The Advanced Diagnostics panel and `computeExportParity()` exist
  specifically to make this checkable and visible, not to eliminate it
  (removing `quickSafetyClamp()`'s ability to fire on user edits would
  remove a real safety net, which the round's instructions explicitly
  forbid).
- **Color Grading and Calibration Hue/Luminance** have NO export-time
  hard clamp at all in `quickSafetyClamp()` (documented gap, see the
  audit §3-§4 and `P1E_R3_KNOWN_LIMITATIONS.md`). Their only safety net
  is Layer A (`BOUNDS`), applied once at Color Plan build time.
- **Basic Panel fields** (Exposure/Contrast/etc.) are out of scope for
  this policy — they are not produced by P1E's Color Intelligence
  module.

## Layer relationship (unchanged two-layer pattern)

- **Layer A** — `BOUNDS` in `color-intelligence-schema.js`, applied
  once, at Color Plan build time, inside `_restoreTowardEvidence()`'s
  own `_clamp(..., hardBound)` call. Tighter than Layer B for every
  field family this round touches.
- **Layer B** — `quickSafetyClamp()` in the Production-Locked
  `core/xmp-validator/index.js`, applied once, at export time, as the
  final authoritative pass before `serializeXMP()`. Unchanged,
  unremoved, imported read-only by `computeExportParity()`.

Both layers are intentional, per this project's established
validation convention (see the `lumixa-ai-development` skill's
Validation Rules §6) — this round strengthens Layer A's guarantee
(rounding) and adds a new, non-blocking diagnostic READ of Layer B's
output (`computeExportParity()`), but does not remove, weaken, or
duplicate either layer's own logic.
