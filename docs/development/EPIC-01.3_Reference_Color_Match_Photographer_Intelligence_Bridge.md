# EPIC 1.3 — Reference Color Match × Photographer Intelligence Bridge

## Goal

Turn Reference Color Match (EPIC 1.2) into an additional evidence source
for Photographer Intelligence (Stage 2.4.2A/B/B.1/B.2) — never a
replacement. Every acceptance criterion in the spec used the words
"support," "supporting evidence," "never overwrite," "never replace,"
"never decrease confidence directly" — this stage was built to make that
literally true, verified by direct comparison (see Task 4 below).

## Source-of-Truth Verification (per Latest Project File Rule)

All 5 `docs/project/*.md` files were confirmed present before starting.
Before writing any code, the actual current return shapes of
`palette-extractor.js`, `tone-zone-analyzer.js`, `color-transfer-engine.js`,
`preserve-engine.js`, `decision-engine`'s `buildFinalPreset`/`_buildDecision`
signatures, and `_classifyPhotographerStyle`'s output shape were all
`grep`/`view`-verified directly against the current source — not assumed
from memory of earlier EPICs.

## Architecture

```
Reference Image
  → Palette Extractor + Tone Zone Analyzer (EPIC 1.2, unchanged)
  → color-match-intelligence-bridge.js  ← NEW (Tasks 1–3)
      → referenceColorIntelligence { paletteSignature, toneZoneSignature,
          colorMood, dominantHueFamilies, dominantLuminancePattern,
          dominantContrastStyle, dominantSaturationStyle, temperatureIntent,
          tintIntent, highlightCharacter, shadowCharacter, styleHints,
          confidence, risks, reasons }
  → (optional) passed into Decision Engine's buildFinalPreset()
      → compared against the ALREADY-DETECTED photographerStyle.top
      → attaches `referenceColorSupport` — additive only
  → Decision Report surfaces it (Task 5)
  → Reference Transfer Report explains transferConfidence with it (Task 6)
  → Reference Color Match Panel displays it compactly (Task 7)
```

Lightroom Mapping, XMP generation, existing analysis engines, benchmark
logic, UI layout/responsive system, and branding were **not touched** —
confirmed by `git`-equivalent file-modification-time checks and by
re-running the full existing test suite (below) with identical results.

## Task 1–3: Reference Color Intelligence (`color-match-intelligence-bridge.js`)

Deliberately does **not** call `core/decision-engine`'s
`_classifyPhotographerStyle()` — that classifier needs a full Style
Feature Graph (histogram, HSL analysis, skin/scene classification, colour
harmony), none of which Reference Color Match computes. Instead this
module produces its own, independent, much lighter `styleHints` guess
from colour evidence alone, named with the *same* 17-style vocabulary so
the two can be compared by name without duplicating the classifier
itself.

**Palette Signature** — names each palette colour in plain photographer
language (a heuristic hue/saturation/lightness naming table — "Muted
Green," "Warm Brown," "Cream White," "Golden Skin," consistent in spirit
with `tone-zone-analyzer.js`'s own "directional hint, not colour science"
precedent) and groups them into primary/secondary/neutral/accent by
weight and saturation.

**Color Mood Intelligence** — 15 named moods (all from the spec's list:
Warm Luxury, Luxury Wedding, Dreamy, Soft Portrait, Moody Film, Clean
Commercial, Natural Documentary, Golden Hour, High Key, Low Key,
Editorial, Minimal, Muted Film, Pastel, Earth Tone) via a declarative rule
table over derived signals (hue families, luminance pattern, contrast
style, saturation style, temperature intent) — the same "table of rules
over a shared signals object" pattern `_classifyPhotographerStyle` itself
uses, applied independently here.

**Verified with a synthetic "Luxury Wedding"-shaped input** (cream
whites, golden-skin midtones, muted green accent, high-key/soft-flat
tone): initially misfired as the more generic "High Key" (both rules
matched; near-equal weights). Fixed by re-ordering/re-weighting so
specific named looks are checked ahead of generic catch-alls — re-tested,
now correctly reads `"Luxury Wedding"` with `styleHints: ["Luxury
Wedding", "Airy Wedding"]`.

## Task 4 — How Style DNA Is Supported (verified never to change anything)

`core/decision-engine`'s `buildFinalPreset()` gained one new optional
input, `referenceColorIntelligence = null` — every existing caller that
doesn't pass it is completely unaffected (this is the same
optional-additive-parameter pattern used for every prior stage's ctx
extensions). When supplied, `_buildReferenceColorSupport()` checks
whether the bridge's own `styleHints` name the *already-detected* style
and attaches a `referenceColorSupport` object with a plain-language
`reason` — supported or not, honestly, in either case.

**Concretely verified, not just designed:** ran `buildFinalPreset()`
twice with identical inputs — once without `referenceColorIntelligence`,
once with a matching one — and confirmed:
```
photographerStyle.top.confidence            — IDENTICAL in both runs
photographerStyle.top.styleDNAValidation.score — IDENTICAL in both runs
```
Only `referenceColorSupport` differed (`undefined` vs. a populated
object). This is the literal, tested proof that Style DNA/Validation/
Feasibility are untouched — not just an architectural claim.

## Task 5 — Decision Report Changes

`_buildPhotographerIntelligenceSummary()`'s `photographerStyle` object
gained `referenceColorSupport` (mirrored at both the embedded `detected`
level and top level, matching the existing `styleDNAValidation` exposure
pattern from Stage 2.4.2B.1) plus one narrated `reasons` line explaining
*why* the reference does or doesn't support the detected style.

## Task 6 — Reference Transfer Integration

`core/reference-transfer-engine`'s `_buildRecommendations()` reads the
same `referenceColorSupport` (already attached to
`ctx.decisionStrategy.finalStyleIntent.photographerStyle.top` by Decision
Engine) and adds one explanatory recommendation connecting it to
`transferConfidence` — e.g. corroborating colour evidence alongside high
transfer confidence, or ambiguous colour evidence alongside low transfer
confidence. **The transfer algorithm itself — every formula computing
`transferConfidence`, `complexity`, `wbTransferRisk` — was not touched.**
This is explanation layered on top of an unchanged calculation.

## Task 7 — UI (compact, no layout redesign)

`index.html` is **not** in this EPIC's allowed-directories list, so the
new "Photographer Intelligence" section is built entirely via
`document.createElement`/`innerHTML` from within
`ui/reference-color-match-panel.js` (which *is* allowed) and appended
into the existing Palette/Tone-Zones card — reusing the exact same CSS
custom properties (`var(--surface-2)`, `var(--accent)`, `var(--font-mono)`,
etc.) already established elsewhere on the page, so it needs no new
layout or responsive rules of its own. Verified rendering live:

```
PHOTOGRAPHER INTELLIGENCE
Mood: Earth Tone        Likely Style: Warm Earth        Reference Strength: 66%
Palette signature: Brown + Brown
Supporting evidence: Warm Earth (68%), Brown Film (53%)
⚠ Palette extraction confidence is low — ...
```

## Modified / New Files

**New:**
- `core/color-match/color-match-intelligence-bridge.js`
- `docs/development/EPIC-01.3_Reference_Color_Match_Photographer_Intelligence_Bridge.md`

**Modified (additive only, verified backward-compatible):**
- `core/decision-engine/index.js` — optional `referenceColorIntelligence`
  parameter on `buildFinalPreset`/`_buildDecision`; new
  `_buildReferenceColorSupport()`; `referenceColorSupport` attached to
  `finalStyleIntent.photographerStyle.top`.
- `core/decision-report-engine/index.js` — `referenceColorSupport`
  surfaced in `photographerIntelligence.photographerStyle`.
- `core/reference-transfer-engine/index.js` — one additive recommendation
  connecting `referenceColorSupport` to `transferConfidence`.
- `ui/reference-color-match-panel.js` — new import, `analyzeReference()`
  now also builds and renders Reference Color Intelligence.
- `docs/project/05_PROJECT_MEMORY.md` — new stage row + risk notes.

**Not modified:** `core/lightroom-mapping-engine`, `core/xmp-validator`,
every pixel-analysis engine, `core/style-benchmark-engine`, `index.html`,
`ui/app.js`, `ui/ui-engine.js`, any renderer.

## Verified End-to-End (no regressions)

- Reference Color Match's own existing features (Intensity dual-slider
  sync, Save After Image, Generate/Download XMP with safety-clamp
  reporting) — all still work identically after this stage's changes.
- Main pipeline (unrelated to Reference Color Match) — full analyse →
  export flow, zero console errors, XMP still valid.
- Mobile (390px) — `scrollWidth` 396px, unchanged, no overflow introduced
  by the new JS-injected section.

## Remaining Risks

- **`styleHints` is a genuinely separate, lighter-weight classifier from
  `_classifyPhotographerStyle`** — the two can and will sometimes
  disagree on the same reference, by design (documented, not a bug). A
  future stage could tighten agreement by sharing more signals, but that
  would mean Reference Color Match computing more of the full analysis
  pipeline, which is out of scope here.
- **The live UI does not yet wire "this is also my main pipeline's
  reference image" between the two independent upload flows** — Decision
  Engine's `referenceColorIntelligence` parameter is a tested *capability*
  (verified via direct calls with synthetic ctx), but `ui/app.js` (which
  owns the main pipeline's actual call to `buildFinalPreset`) is outside
  this EPIC's allowed directories, so no UI-level connection between "the
  photo I uploaded to Reference Color Match" and "the photo the main
  pipeline analyzed" exists yet. This is an explicit scope boundary, not
  an oversight.
- **Color Mood rule weights/ordering are hand-reasoned**, consistent with
  every other scoring table in this project — the Luxury-Wedding-vs-
  High-Key tie was caught and fixed by one concrete test case; other
  overlapping pairs among the 15 moods likely exist and haven't all been
  individually tested.
- **`_nameColor`'s hue/saturation/lightness naming table is a heuristic**,
  not a colorimetric standard — "Brown + Brown" (a real observed output
  on a flat-colour synthetic test image) shows it can degenerate when the
  palette lacks real variety; on real photographs with genuine colour
  diversity this reads better, but hasn't been tested against a large
  photo sample.
