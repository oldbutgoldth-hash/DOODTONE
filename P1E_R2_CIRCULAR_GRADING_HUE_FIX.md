# P1E R2 — Circular Grading Hue Fix

**EPIC 2E-P1E R2 — Color Grading Hue circular-interpolation repair**
Version 2.5.1. Baseline: EPIC 2E-P1E R1 (v2.5.0).

## The defect

`core/single-image/color-intelligence/color-plan-builder.js` restored
Color Grading Hue for each zone (shadows/midtones/highlights) using the
same generic helper as every other signed, relative field:

```js
const newHue = _restoreTowardEvidence(curZone.hue ?? 0, evid.hue, fraction, 359);
```

Lightroom Color Grading Hue is an **absolute, cyclic 0–359 degree
angle** — 359 and 0 are adjacent, not 359 apart. `_restoreTowardEvidence()`
computes a plain linear gap (`evidenceTarget - current`), which is correct
for a signed relative adjustment but wrong for a cyclic absolute angle:
going from a current hue of 350 to a target of 10 is a genuine 20-degree
warm-hue nudge (350 → 360/0 → 10), but the linear formula computed a gap
of `10 - 350 = -340` and, at a 0.7 restoration fraction, produced a
result of 112 — a value nowhere near either 350 or 10, landing instead in
an unrelated green/cyan region of the hue wheel. A small, intentional
warm-hue adjustment could therefore be silently turned into a completely
different, unintended color direction whenever a zone's current and
target hues happened to straddle the 0/360 boundary.

## The fix

Two new pure helpers were added to `color-plan-builder.js`:

```js
function normalizeHue(value) {
  const v = Number.isFinite(value) ? value : 0;
  return ((v % 360) + 360) % 360;
}

function restoreCircularHue(current, target, fraction) {
  const currentHue = normalizeHue(current);
  const targetHue = normalizeHue(target);
  const shortestDelta = ((targetHue - currentHue + 540) % 360) - 180;
  return normalizeHue(currentHue + shortestDelta * fraction);
}
```

`restoreCircularHue()` is used **only** for
`grading.{shadows,midtones,highlights}.hue`. The call site now reads:

```js
const curHueNorm = normalizeHue(curZone.hue ?? 0);
const newHue = (evid.sat ?? 0) === 0
  ? curHueNorm
  : restoreCircularHue(curHueNorm, evid.hue, fraction);
```

Re-running the reported example confirms the fix: `restoreCircularHue(350,
10, 0.7)` now returns exactly `4` — matching the "correct shortest circular
movement is +20 degrees, producing a result near 4 degrees after wrapping"
expectation in the bug report, in place of the old, wrong `112`.

## Scope discipline — what did NOT change

Per the fix request's explicit boundaries:

- **HSL Hue** (`hsl.hue.{channel}`) is left on the original
  `_restoreTowardEvidence()` path. HSL Hue is a signed relative
  adjustment (e.g. "shift this channel's hue by +6 degrees"), not an
  absolute angle — there is no cyclic-boundary defect to fix here, and
  routing it through `restoreCircularHue()` would be incorrect (it would
  treat a small negative adjustment near 0 as if it needed to "wrap
  around" a 360-degree circle it was never placed on).
- **Calibration Hue** (`cal.{primary}Hue`) is likewise left on the
  original signed-linear path, for the identical reason.
- **Color Grading Saturation and Luminance** formulas are byte-identical
  to R1 — still `_restoreTowardEvidence(curZone.saturation ?? 0,
  evid.sat, fraction, satBound)` and `_restoreTowardEvidence(curZone.
  luminance ?? 0, evid.balance, fraction, lumBound)`, same bound
  expressions, same fraction. Verified both at the source level and
  numerically (test 87/87b in the updated suite reproduce the exact R1
  saturation/luminance values for the same rich-evidence fixture).
- **P1E bounds and the default BALANCED strength mode** are unchanged —
  `BOUNDS`, `STRENGTH_SCALARS`, and `DEFAULT_STRENGTH_MODE` in
  `color-intelligence-schema.js` were not touched.
- **Color evidence extraction, skin protection, HSL bounds, Calibration
  bounds, the Vibrance/Saturation strategy, the Candidate Store, slider
  synchronization, the XMP serializer, the P1D Fidelity Gate, Reference
  Color Match, the Preview pipeline, and all Production locks** were not
  touched — verified by the full regression re-run described in
  `P1E_QA_REPORT.md`.

## One documented interpretation decision

The fix request's item 5 ("If grading saturation is zero or the grading
evidence is unavailable, preserve existing behavior") is handled in two
places:

1. **Grading evidence unavailable for a zone** (`!evid`): already
   preserved unchanged by the pre-existing `if (!evid) { plan.grading[zone]
   = { ...curZone }; continue; }` guard, which preserves the entire zone
   (hue included) — no new code was needed for this half of the rule.
2. **Grading saturation is zero**: interpreted as the evidence's own
   target saturation for that zone (`evid.sat === 0`) — if the evidence
   itself carries no saturation intent for a zone, there is no meaningful
   color direction to rotate the hue toward either, so the current hue is
   preserved unchanged (normalized, but not rotated) rather than
   circular-restoring toward a hue that has no associated color
   intensity. This is stated explicitly here per this project's "state
   every deviation from a literal spec explicitly" convention, since the
   fix request did not specify whether "saturation" in that rule meant
   the current, evidence, or resulting value.

## Documented tie-break rule (exact 180-degree separation)

At an exact 180-degree separation, `((targetHue - currentHue + 540) %
360) - 180` deterministically evaluates to `-180` regardless of which
hue is "current" and which is "target" (verified: both `restoreCircularHue
(10, 190, 0.5)` and `restoreCircularHue(190, 10, 0.5)` resolve via a `-180`
delta measured from their own respective `current`). The documented rule
is therefore: **an exact 180-degree tie always rotates in the
decreasing-degree direction from the current hue.** At fraction 1 this
tie-break is moot — both directions land on the same target point.

## Verification

24 new checks (tests 71–90, some with lettered sub-cases) were added to
`qa/epic-2e-p1e-color-intelligence-test.mjs`, covering all 18 scenarios
requested in the fix report: the exact reported defect case (350→10),
its reverse, both directions across the 359/1 red boundary, two ordinary
non-wrapping interpolations in both directions, a wide sweep proving the
output always stays in `[0, 360)`, fraction 0 and fraction 1 boundary
behavior (including out-of-range inputs), fraction > 1 under the internal
STRONG strength scalar, the exact-180-degree tie-break in both directions,
source-level proof that HSL Hue and Calibration Hue still use the generic
signed helper, and both a source-level and numeric proof that Grading
Saturation/Luminance are untouched. The suite's own R1 checks (1–70) all
still pass unmodified, and both `qa/epic-2e-p1c-candidate-test.mjs`
(86/86) and `qa/epic-2e-p1d-xmp-fidelity-gate-test.mjs` (71/71) were
re-run standalone and still fully pass. See `P1E_QA_REPORT.md` for the
complete verification record, including the fresh-ZIP-extraction
re-confirmation.
