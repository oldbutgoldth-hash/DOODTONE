# P1F Dynamic Range Classification

## Purpose

`dynamic-range-classifier.js::classifyDynamicRange({ stats, skin })`
determines the image's tonal/dynamic-range character from **real
histogram-engine evidence only** (`session.evidence.stats`) — never
from filename, UI state, or category label. Skin coverage/confidence
are passed through as structural signals for later planners, but do
**not** themselves change the classification: scene class here
describes tonal structure; skin-aware dampening is a separate concern
applied downstream by the individual planners and
`basic-tone-guardrails.js` (mirrors the equivalent separation of
concerns in P1E's `creative-tone-strategy.js`).

## The 10 scene classes

| Class | Trigger (in priority order) |
|---|---|
| `UNDEREXPOSED` | `avgLum < 70` AND `clipLoPct > 3` |
| `OVEREXPOSED` | `avgLum > 190` AND `clipHiPct > 3` |
| `HIGH_DYNAMIC_RANGE` | `drStops >= 9.5` |
| `HAZY` | `contrastRatio <= 3.2` AND `avgSatPct <= 22` AND `confidence >= 0.5` AND `2 <= drStops < 9.5` (proxy evidence — see below) |
| `HIGH_KEY` | `avgLum > 165` AND `clipHiPct <= 3` |
| `LOW_KEY` | `avgLum < 90` AND `clipLoPct <= 3` |
| `HIGH_CONTRAST` | contrast sigma `> 68` |
| `LOW_CONTRAST` | contrast sigma `< 38` |
| `BALANCED` | none of the above — avgLum/sigma/drStops all within normal range |
| `LOW_CONFIDENCE` | missing/empty stats, or `stats.confidence < MIN_EVIDENCE_CONFIDENCE (0.45)` |

Severe exposure classes (`UNDEREXPOSED`/`OVEREXPOSED`) are checked
first because real clipping evidence is the strongest, least
ambiguous signal. `HIGH_DYNAMIC_RANGE` is checked next since a wide
`drStops` spread should route to Highlight/Shadow recovery rather than
being miscategorized as haze or a key extreme. Contrast-spread classes
are checked last, after the more specific exposure/key/haze checks
have all had a chance to claim the image.

## Minimal-evidence tolerance

The classifier accepts a minimal/synthetic `stats` shape
(`{avgLum, confidence}` without `total`) — the same tolerance this
project's other evidence-consuming modules already apply (e.g. P1E's
`deriveColorSignals()`). `stats.total` is only used as an explicit
"definitely zero real pixels" signal (`stats.total === 0`); it is never
required for a usable classification. This was a real bug fixed during
this EPIC's own regression pass — see `P1F_KNOWN_LIMITATIONS.md` and
the Errors/Fixes history in this EPIC's release notes.

## Haze: proxy evidence, not a dedicated sensor

No dedicated haze/atmospheric-scattering sensor exists anywhere in
this codebase. `HAZY` is derived from a proxy: narrow `contrastRatio`
(`<= HAZE_CONTRAST_RATIO_MAX = 3.2`) combined with desaturation
(`avgSatPct <= HAZE_SAT_PCT_MAX = 22`) and a minimum evidence
confidence (`HAZE_MIN_CONFIDENCE = 0.5`). This is documented explicitly
as a proxy in both the source code and here — a future EPIC could
replace it with a true haze-density estimate without changing this
module's public contract.

## Signals consumed

`avgLum, contrast (sigma), drStops, contrastRatio, clipHiPct, clipLoPct,
blackPoint, whitePoint, avgSatPct, confidence` from `stats`, plus
`coveragePct, confidence` from `skin` (passthrough only, in
`signalsUsed`, never used to alter `sceneClass` itself).

## Testing

Covered by SCENE CLASSIFICATION tests 8-13 in
`qa/epic-2e-p1f-basic-tone-intelligence-test.mjs`, exercising all 10
scene classes against both the 10 named synthetic fixtures and
targeted inline stats objects for classes the named fixtures don't
naturally hit (`HIGH_CONTRAST`, `LOW_CONTRAST`, `BALANCED`,
`LOW_CONFIDENCE`).
