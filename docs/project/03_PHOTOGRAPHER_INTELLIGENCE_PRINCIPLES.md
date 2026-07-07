# 03 — PHOTOGRAPHER INTELLIGENCE PRINCIPLES

This document describes the Photographer Intelligence layer as it
currently exists in `core/decision-engine`, `core/decision-report-engine`,
and `core/reference-transfer-engine` — verified directly against the
source, including exact counts (17 styles, 61 DNA ingredients, 8 styles
with explicit validation rules, 5 styles with explicit feasibility rules).

## Why This Layer Exists

Colour-based reasoning alone (mood, warmth, palette hue/saturation,
contrast level) can detect that an image is "warm and low-contrast," but
a photographer doesn't think in those terms — they think "this is a Brown
Film look" or "this reads as Airy Wedding." Photographer Intelligence
sits on top of the colour-based classifier and reasons in that
vocabulary, while deliberately keeping the older colour-based classifier
untouched underneath it (per the backward-compatible-naming principle in
`02_PROJECT_DEVELOPMENT_PROTOCOL.md`) so nothing downstream that already
depends on it breaks.

## The Four-Layer Reasoning Chain

```
Style Vocabulary  →  Style DNA  →  Style DNA Validation  →  Style Feasibility
(what is it called?)  (why does it   (is the DNA           (can it actually
                       look that way?) internally logical?) transfer to XMP?)
```

Each layer answers a genuinely different question, and the current code
keeps them structurally separate rather than folding them into one score.

### Layer 1 — Style Vocabulary (`_classifyPhotographerStyle`)

A declarative table of **17 named looks** is matched against signals
already computed upstream — mood, warmth, colour cast, palette
hue/saturation, contrast level, colour-harmony scheme, skin
presence, WB transfer risk, scene category, and the style-recognition
engine's own top label. No new pixel analysis is performed; every input
already exists on the Style Fingerprint / Style Feature Graph.

The 17 supported looks: **Airy Wedding, Luxury Wedding, Brown Film, Green
Pastel, Soft Portrait, Clean Portrait, Natural Documentary, Editorial
Fashion, Moody Cinematic, Dark Forest, Fine Art Portrait, Soft Matte,
Bright Lifestyle, Muted Lifestyle, Warm Earth, Korean Clean, Japanese
Soft.**

Each style profile carries a fixed `priority` used only to break ties
between similarly-scoring styles; the actual detected style is chosen by
priority-weighted score, but **alternative candidates are displayed
sorted by raw confidence**, not by the internal tie-breaking weight, so
the report reads naturally to a human.

An explicit ambiguity warning fires when the top two candidates' weighted
scores are within 0.08 of each other — the system says "this reference
sits between two looks" rather than picking one with false confidence.

### Layer 2 — Style DNA (`_buildStyleDNA`)

Style DNA is explicitly **not** a Lightroom preset, not sliders, not a
budget, not XMP. It is a list of abstract visual ingredients that explain
*why* a style looks the way it does. A shared catalog of **61 reusable
DNA elements** (e.g. "Highlight Roll-off," "Matte Blacks," "Film Colour
Separation," "Bright Green Luminance") backs all 17 styles — many
elements are shared across styles (e.g. "Soft Contrast" appears in Airy
Wedding, Green Pastel, Soft Portrait, and Japanese Soft).

Each DNA element on a given style carries:

- `importance` (0–1, fixed per style — how central this ingredient is to
  the style's identity, independent of any one photo)
- `confidence` (0–1, computed per run — scaled up when this specific
  image's own detection signals echo the element's theme, scaled down
  otherwise; never invented)
- `description`, `preferredLightroomTools`/`avoidedLightroomTools`
  (tool **categories** only, never slider values), and a
  `photographerReason`

**Style Distance** between any two styles is computed by reusing this
same DNA (weighted Jaccard-style overlap of shared ingredients) — no new
pixel comparison. The detected style is always distance 0 from itself.

### Layer 3 — Style DNA Validation (`_validateStyleDNA`)

Asks a narrower question than Layer 2: *given* a style's DNA, is it
internally logical? Four generic checks apply to every style (duplicate
elements, missing high-importance element, confidence/importance
mismatch, contradictory tool guidance within the same style), plus
explicit required/forbidden element rules for **8 of the 17 styles**
(Airy Wedding, Brown Film, Green Pastel, Luxury Wedding, Soft Portrait,
Moody Cinematic, Fine Art Portrait, Clean Portrait) — e.g. Airy Wedding's
DNA is flagged invalid if it ever contained "Heavy Contrast" or "Crushed
Blacks."

If the detected style's DNA validation score is notably worse than an
alternative candidate's, the system raises an ambiguity warning — **it
never auto-switches the detected style**, only reports the discrepancy.

### Layer 4 — Style Feasibility (`_computeStyleFeasibility`)

Asks yet another distinct question: *can this style, even if its DNA is
perfectly logical, realistically be reproduced through global Lightroom
sliders on a different RAW file?* This is computed in
`core/reference-transfer-engine`, the first pipeline point where every
needed signal (reference complexity, transfer confidence, Lightroom
reproduction estimate, WB transfer risk, benchmark safety, validation
warning count) simultaneously exists — Decision Engine, which runs
earlier, instead attaches a lightweight preliminary
`styleFeasibilityEstimate` using only what it has at that point (DNA
validation score, average engine trust, an earlier transfer-risk proxy).
The two are documented to genuinely diverge on the same image.

Feasibility scoring combines a `lightroomFeasibility` sub-score, a
`transferFeasibility` sub-score, and a complexity penalty — **Benchmark
safety is deliberately weighted lightly and never treated as feasibility
itself**: benchmark measures internal pipeline quality, feasibility
measures real-world portability, and the code enforces that these can
disagree.

**5 of the 17 styles** (Airy Wedding, Green Pastel, Brown Film, Moody
Cinematic, Luxury Wedding) have explicit feasibility rules layered on top
of the generic scoring — e.g. Airy Wedding feasibility rises when
highlights aren't clipped and skin confidence is high, and falls when WB
transfer risk is high. Generic blockers (not tied to any specific style)
also fire for high reference complexity, extreme mixed lighting, failed
DNA validation, low Lightroom reproduction estimate, and more — always
phrased as *"localized edits beyond a global Lightroom preset may be
required"* rather than naming any specific editing tool.

## Editing Strategy and Style Budget (Colour-Based Layer, Kept Separate)

A second, older, colour-oriented classifier (`_deriveStyleVocabulary`,
predating the 17-style vocabulary above) still runs independently and
still drives two things that the newer Photographer Intelligence layer
deliberately does **not** touch:

- **`editingStrategy`** — which Lightroom tool categories to prefer/avoid
  for the detected colour family (green/warm/shadow/general), applied by
  `core/lightroom-mapping-engine`.
- **`styleBudget`** — a per-dimension mathematical scaling matrix that
  detects when multiple engines (HSL, Calibration, Colour Grading, White
  Balance, Basic Panel, Tone Curve, Vibrance/Saturation, and — whenever
  skin is present — a dedicated skin-protection dimension) are all
  pushing the same mood dimension at once, and eases back the
  lower-priority contributors more than the higher-priority ones
  (priority order: Tone Curve > Colour Grading > HSL > White Balance >
  Calibration > Basic Panel).

This is the **only** part of Photographer Intelligence that actually
changes exported slider values — everything in Layers 1–4 above (style
name, DNA, DNA validation, feasibility) is diagnostic/explanatory and has
zero effect on the generated XMP, confirmed by their complete absence
from `core/lightroom-mapping-engine` and `core/xmp-validator`.

## Explainability Surface

`core/decision-report-engine`'s `photographerIntelligence` output
surfaces all four layers together for a human reader: the detected style
name and description, its top DNA ingredients by importance, its
validation result, alternative candidates with their style distance, and
(where available) the preliminary feasibility estimate — narrated in
plain sentences, not raw numbers alone.
