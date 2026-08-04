# P1H — Cast Classification Reference

Ten classes (`core/single-image/white-balance-intelligence/white-balance-schema.js` `CAST_CLASS`):

| Class | Trigger (evidence-driven) |
|---|---|
| NEUTRAL | base cast label is 'neutral' and no other flag applies |
| WARM_CAST | base cast label 'warm', not classified intentional |
| COOL_CAST | base cast label 'cool', not classified intentional |
| GREEN_CAST | base cast label 'green', not object-color-biased |
| MAGENTA_CAST | base cast label 'magenta', not classified intentional |
| MIXED_LIGHT | shadow/highlight cast labels disagree, or engine's own `mixedLightingRisk` is high |
| INTENTIONAL_WARM_LIGHT | base cast 'warm' AND whitebalance-engine's own `moodPreservation.isLikelyDefect === false` |
| INTENTIONAL_COLORED_LIGHT | base cast 'magenta' or 'cool' AND `isLikelyDefect === false` |
| OBJECT_COLOR_BIAS | neutral subject/center zone + a meaningfully stronger, differently-colored border/background zone |
| LOW_CONFIDENCE | this Plan's own overall confidence < 0.30 |

Multiple flags may be set simultaneously (`classification.flags`);
`classification.primaryCast` is chosen by a fixed priority order —
OBJECT_COLOR_BIAS > MIXED_LIGHT > INTENTIONAL_WARM_LIGHT >
INTENTIONAL_COLORED_LIGHT > {GREEN,MAGENTA,WARM,COOL}_CAST > NEUTRAL >
LOW_CONFIDENCE — so that the most actionable/explanatory class always
wins as the headline label while every other true condition remains
visible in `flags`.

Never reads a filename or any user-supplied text — every flag traces
to a numeric/labeled evidence field (verified: `cast-classifier.js`
source contains no `.filename`/`.name` references).
