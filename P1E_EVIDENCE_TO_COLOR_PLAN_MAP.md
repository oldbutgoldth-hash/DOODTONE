# P1E — Evidence-to-Color-Plan Map

This document maps every field P1E can touch to the exact `session.evidence`
key(s) it reads, the exact Core engine that produced that evidence, the
coverage/confidence gate that must pass before P1E acts, and the bound
applied. This is the single reference for "why did this value change" —
each entry corresponds 1:1 to logic in `color-plan-builder.js`.

## HSL (per channel: red, orange, yellow, green, aqua, blue, purple, magenta)

| Item | Value |
|---|---|
| Evidence source | `session.evidence.hsl.result.channels[channel]` |
| Core engine | `core/hsl-analyzer-engine/index.js` (`analyzeHSL()`) |
| Fields read | `coveragePct`, `hueAdj`, `satAdj`, `lumAdj` |
| Gate | `coveragePct >= MIN_MEANINGFUL_COVERAGE_PCT.hslChannel` (3%) — below this, left completely unchanged |
| Skin-adjacent channels | red, orange, yellow (`SKIN_ADJACENT_HSL_CHANNELS`) |
| Bound (non-skin) | hue ±14, saturation ±22, luminance ±18 (`BOUNDS.hsl.color`) |
| Bound (skin) | hue ±4, saturation −8/+6, luminance ±10 (`BOUNDS.hsl.skin`) |
| Extra caution | `skinCautionScale()` multiplies the restoration fraction for skin-adjacent channels only |

## Color Grading (shadows / midtones / highlights)

| Item | Value |
|---|---|
| Evidence source | `session.evidence.grading.result.{shadows,midtones,highlights}` + `.confidence` + `.look` |
| Core engine | `core/colorgrading-ai-engine/index.js` |
| Fields read | `hue`, `sat`, `balance` (mapped to Candidate `hue`/`saturation`/`luminance`) |
| Gate | `signals.grading.confidence >= MIN_GRADING_CONFIDENCE` (0.35) for ALL three zones at once (single top-level confidence; the engine does not expose per-zone coverage) |
| Bound (saturation) | ±22, plus an extra ±4 for shadows/highlights only (`BOUNDS.grading.shadowsHighlightsExtra`) — never midtones |
| Bound (luminance) | ±12 |
| Skin caution | Not directly skin-scaled (grading has no per-channel skin adjacency); global skin caution still applies lightly via the downstream Presence step |

## Calibration (red / green / blue primary)

| Item | Value |
|---|---|
| Evidence source | `session.evidence.calibration.result.{red,green,blue}` |
| Core engine | `core/calibration-engine/index.js` |
| Fields read | `coveragePct`, `hue`, `sat` |
| Gate | `coveragePct >= MIN_MEANINGFUL_COVERAGE_PCT.calibrationPrimary` (2%) per primary |
| Bound | hue ±9, saturation ±14 (`BOUNDS.calibration`) |
| Extra caution | red primary only is skin-scaled (red primary shifts affect skin more than green/blue); fraction additionally scaled ×0.8 vs. HSL/Grading (calibration is the bluntest, most global tool of the three) |

## Presence (Vibrance / Saturation)

| Item | Value |
|---|---|
| Evidence source | Derived, not owned by a single engine: `opportunityScore = min(1, fieldsBoosted.length / 6) * signals.overallColorConfidence` |
| Inputs | How many HSL/Grading/Calibration fields P1E just meaningfully touched, and the blended confidence across whichever of HSL/Grading/Calibration confidences are actually available |
| Gate | `opportunityScore > 0.05` |
| Bound (Vibrance) | ±28 (`BOUNDS.presence.vibrance`) |
| Bound (Saturation) | ±16, and additionally `× 0.7` relative to the Vibrance target (Saturation is the least skin-safe global control available; kept more conservative than Vibrance by design, matching real photographic practice) |
| Skin caution | Full `skinCautionScale()` applied to the whole Presence step |

## Skin / cast / scene signals (context, not directly written)

| Item | Value |
|---|---|
| Skin | `session.evidence.skin.result.{detected,coveragePct,confidence,isFaceCandidate}` — from `core/skin-classifier` + `core/skintone-engine`, merged into `evidence.skin` upstream |
| Color cast | `session.evidence.colorCast.result.{dominantCast,<cast>.strength,confidence}` — from `core/color-cast-detector`. Currently informational (surfaced in diagnostics reasons); does not independently gate any field in this EPIC |
| Scene | `session.evidence.scene.result.{category,confidence}` (falls back to `session.evidence.stats.result` if a dedicated scene entry is absent) — from `core/scene-classifier`. Currently informational |

## Trust rule (applies to every row above)

Only evidence entries with `status === 'COMPLETED'` or `'CACHE_HIT'` are
ever read (`_resultOf()` in `evidence-color-signals.js`). A `SOFT_FAILED`,
`FAILED`, `TIMED_OUT`, `ABORTED`, or `SKIPPED` entry — even if it happens
to carry a rich `result` shape — contributes nothing. This is re-checked
defensively inside P1E rather than trusted from the evidence-normalizer
contract alone.
