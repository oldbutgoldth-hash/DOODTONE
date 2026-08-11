# P1J — Tone Curve Intelligence Architecture

## Module layout

```
core/single-image/tone-curve-intelligence/
  tone-curve-schema.js         constants, STRENGTH_MODE, buildEmptyToneCurvePlan()
  tone-curve-plan-builder.js   buildToneCurvePlan(evidence, {strengthMode}) — pure function
```

Mirrors `core/single-image/basic-tone-intelligence/` and
`core/single-image/detail-intelligence/` in shape exactly, per this
project's established Evidence → Plan → Candidate pattern.

## Data flow

```
session.evidence.toneCurves           (generateToneCurves(), unmodified, real per-photo output)
        |
        v
buildToneCurvePlan(evidence, opts)    (NEW, pure — no DOM, no Core calls, no mutation)
        |  finalValues.{master,red,green,blue}
        v
candidate-builder.js                  (EDITED — writes into candidate.curves.rgb/red/green/blue
        |                              when plan.diagnostics.engaged; stashes diagnostics summary)
        v
candidate.curves.rgb/red/green/blue   (ROOT CAUSE FIXED — was always null before this round)
        |
        v
legacy-preset-adapter.js              (unmodified — P1C R3's shell-vs-null logic already correct)
        |
        v
quickSafetyClamp()                    (EDITED — new _clampToneCurvePanel(), Layer B)
        |
        v
serializeXMP()                        (unmodified — crs:ToneCurvePV2012[Red/Green/Blue])
```

## Engagement gating

`buildToneCurvePlan()` only engages when:
1. `evidence.toneCurves` has status `COMPLETED` or `CACHE_HIT` (the same
   `_resultOf()` convention used by every prior Intelligence-layer plan
   builder in this project).
2. `confidence >= MIN_ENGAGEMENT_CONFIDENCE` (0.15) — below this floor,
   the plan falls back to `buildEmptyToneCurvePlan()`, reproducing the
   exact pre-P1J behavior (`candidate.curves.* = null`) rather than
   forcing a low-confidence curve onto export.

Each of the four channels (master/red/green/blue) is validated
**independently** via `_isValidPointArray()` (array length >= 2, each
point's `x`/`y` finite and in `[0,255]`, non-decreasing `x`). A single
invalid channel is left `null` while the others still engage — this
project's established "partial degradation, not all-or-nothing failure"
convention.

## Layer-A restraint (independent safety net, before Layer B)

`_restrainTowardIdentity(points, maxDeviation)` clamps each point's
`|y - x|` deviation from the neutral identity line to at most
`MAX_POINT_DEVIATION * STRENGTH_SCALARS[strengthMode]` (60 points at
BALANCED = 1.00). This never changes point count or x-ordering — only
pulls an extreme `y` back toward `x`. It is intentionally independent of,
and runs before, the Layer-B `quickSafetyClamp()` export-time clamp added
to `xmp-validator/index.js` — the two-layer-safety-net pattern this
project uses everywhere an AI-generated value reaches export.

## Strength modes

`STRENGTH_MODE.{NATURAL,BALANCED,DRAMATIC}` with scalars `0.65/1.00/1.25`
exist for architecture/extensibility (no new user-facing panel this
round — `DEFAULT_STRENGTH_MODE = BALANCED` is used unconditionally by
`candidate-builder.js`, matching every prior Intelligence layer's
first-round scope).

## Diagnostics contract

`candidate.diagnostics.toneCurveIntelligence` = `{ schemaVersion,
strengthMode, confidence, category, engaged, reasons, warnings,
pointsRestrained, lineage }` — read by the Advanced Diagnostics UI panel
(`ui/app.js::renderToneCurveIntelligenceDiagnostics()`), never exposes raw
point arrays to the DOM, only channel-level point counts and match status
via the shared `computeExportParity()` utility's `exportExpectedPreset`
return value.
