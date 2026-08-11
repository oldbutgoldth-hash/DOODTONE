# P1J — Export Safety Clamp Calibration (Layer B)

## What changed in `core/xmp-validator/index.js`

1. Added `_clampToneCurvePanel(p, limits, adjustments)`, wired into
   `quickSafetyClamp()` immediately after the existing
   `_clampDetailPanel()` call (same position in the panel-clamp sequence
   established by P1G R2).
2. Recalibrated the **pre-existing but completely unused** `HARD_LIMITS.curve`
   constant (confirmed via `grep` returning zero other references before
   this round) from
   `{ shadowY: [0, 60], midY: [80, 180], highlightY: [180, 255] }` to
   `{ shadowY: [0, 100], midY: [70, 190], highlightY: [140, 255] }`, with
   the x-position zone cutoffs moved from `x<85/170` to `x<96/160`.

## Why the original bounds were wrong

`HARD_LIMITS.curve` existed in the codebase already but had never been
wired into `quickSafetyClamp()`, so its values had never been checked
against the real engine's actual output range. Tracing
`core/tone-curve-ai-engine/index.js`'s own `clamp()` calls directly (not
assumed) gives the true legitimate range at each of the engine's five
fixed x-positions:

| x   | real range (from source)          | old bound            | new bound             |
|-----|------------------------------------|-----------------------|------------------------|
| 0   | `clamp(shadowY, 0, 25)`             | shadowY [0,60]  OK    | shadowY [0,100]  OK    |
| 64  | `clamp(..., 40, 85)` (master) / `clamp(..., 30, 90)` (channel) | shadowY [0,60] **too tight** (real max 90 > 60) | shadowY [0,100] OK |
| 128 | `clamp(128+midShift, 100, 155)`     | midY [80,180]  OK     | midY [70,190]  OK      |
| 192 | `clamp(..., 175, 215)` (master) / `clamp(..., 160, 220)` (channel) | highlightY [180,255] **too tight** (real min 160 < 180) | highlightY [140,255] OK |
| 255 | `clamp(hilY, 230, 255)`              | highlightY [180,255] OK | highlightY [140,255] OK |

The old bounds would have **incorrectly clamped legitimate,
engine-generated curve points** at x=64 (real per-channel max y=90 vs.
old ceiling 60) and x=192 (real per-channel min y=160 vs. old floor 180)
— violating this project's explicit "Layer B must never touch
auto-generated Candidates" principle (the same standard P1G R2 and P1H
established for their own `HARD_LIMITS.detail`/`HARD_LIMITS.wb`).

Zone cutoffs were moved to `x<96` and `x<160` — the midpoints between the
engine's fixed x-positions (64↔128 and 128↔192) — so every point is
checked against the bound for the nearest fixed x-position it could
legitimately originate from.

## Verification (real, not assumed)

A direct `quickSafetyClamp()` call, run twice:

1. **Legitimate boundary points** (`x=64,y=90` and `x=192,y=160` — the
   real engine's exact per-channel extremes) — confirmed to pass through
   **unclamped**, with zero Tone Curve adjustment message.
2. **Genuinely adversarial input** (`x=0,y=255` / `x=255,y=0`) —
   confirmed to be clamped into `[shadowY[1], highlightY[0]]` with an
   adjustment message recorded.
3. **Non-finite point** (`y: NaN`) — confirmed dropped fail-closed, never
   passed through.
4. **Absent/null `curves`** — confirmed left untouched (no-op).

All four cases are covered by automated tests (P1J suite checks 43-48).

## Structural behavior

`_clampToneCurvePanel()` iterates `['master','red','green','blue']`. For
each channel's point array, every point's `x` is clamped to `[0,255]`
first, then its `y` is clamped to the bound for whichever zone (`shadowY`
/`midY`/`highlightY`) its `x` falls into. Non-finite points are dropped
entirely (fail-closed). If fewer than 2 points survive, the channel is
set to `null` (a Candidate schema-valid state) rather than emitting a
degenerate 0- or 1-point array.
