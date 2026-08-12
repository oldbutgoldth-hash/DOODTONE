# EPIC 2E-P1N — Release Notes (v2.14.0)

## What's new

The AI Image Analysis Report now includes a **Photographer Style**
section, right after Scene. It shows:

- The closest matching photographer style out of 10 named categories
  (Wedding, Portrait, Landscape, Travel, Food, Street, Fashion,
  Documentary, Vintage, Luxury), with a match confidence and the
  traits that drove the match.
- Up to two alternate styles that were also considered.
- A plain-language mood summary (overall mood, warmth, contrast) when
  available.
- An estimate of how well the generated preset preserves that style —
  "strong," "draft," or "rough" — with a plain-language note when more
  manual work is likely.

If the top two style matches are very close, or the top match's
confidence is low, the section flags this explicitly rather than
presenting an uncertain guess as a firm answer.

## How it works

This section reads evidence that was **already being produced** during
analysis (the style classifier, the style/mood summary, and the
preset-preservation estimate all already ran) — P1N does not add any
new analysis step or re-run anything. It simply gives that existing
evidence a place to be seen in the Report, the same way Exposure,
White Balance, Tone, Color, Skin, and Scene are already shown.

## Under the hood

- `core/single-image/report/photographer-interpretation-engine.js`
  gained `classifyPhotographerStyle()`, following the exact same
  `{code, params}` + i18n convention every other Report section
  already uses.
- The section degrades gracefully: if the style classifier's result
  isn't available for a given image, the section reads "Unavailable"
  rather than breaking the rest of the Report.
- Fully bilingual (English/Thai) from day one, like every other Report
  section.

## Compatibility

Purely additive. No existing Report field, Candidate field, or XMP
property changed shape. A report built before this release (or from
an image analyzed without style evidence) simply shows the new section
as "Unavailable" — proven by the full regression suite, especially
P1B's own 39/39 suite remaining unmodified and P1M's 47/47 suite
(which shares the Candidate-building call sites) also remaining
unaffected.
