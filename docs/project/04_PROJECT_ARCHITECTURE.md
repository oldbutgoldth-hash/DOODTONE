# 04 — PROJECT ARCHITECTURE

Verified directly against `ui/app.js`'s actual call sequence and every
`core/*/index.js` file in this package — not reconstructed from memory.

## High-Level Pipeline

```
Reference Image (Canvas ImageData, in-browser only)
        │
        ├─ Skin Classifier ─────────┐  (parallel)
        └─ Colour Cast Detector ────┘
        │
        ▼
Scene Classifier
        │
        ├─ Skin Tone Engine ─────────┐
        ├─ White Balance Engine ─────┤
        ├─ HSL Analyzer Engine ──────┤  (parallel, Promise.allSettled)
        ├─ Colour Grading AI Engine ─┤
        ├─ Calibration Engine ───────┤
        └─ Style Recognition Engine ─┘
        │
        ├─ Palette (k-means) ────────┐  (awaited once needed)
        └─ Colour Harmony ───────────┘
        │
        ▼
Feature Fusion Engine  →  Style Feature Graph
        │
        ▼
Style Fingerprint
        │
        ▼
Decision Engine  (strategy, trust weights, Photographer Intelligence,
        │         Style Vocabulary/DNA/Validation/Feasibility-estimate)
        ▼
Lightroom Mapping Engine  (the ONLY place that computes actual slider
        │                  values — intent-aware, cross-slider optimised,
        │                  style-budget enforced)
        ▼
Pre-XMP Validation (Layer A — fingerprint-aware clamping)
        │
        ▼
Style Benchmark  (Benchmark Lite — internal pipeline-quality score)
        │
        ├──────────────────────────────► Sliders updated in the UI
        │
        ▼
Decision Report  (narrated explainability — reads what already exists,
        │         computes nothing new)
        ▼
Reference Transfer Intelligence  (Reference Confidence / Transfer
        │                         Confidence / Lightroom Reproduction /
        │                         WB Transfer Risk / Style Feasibility —
        │                         the authoritative versions)
        ▼
XMP Export (Pre-XMP Validation Layer B — hard-ceiling safety clamp runs
             again immediately before the file is written)
```

Two Pre-XMP Validation passes exist by design: Layer A runs right after
mapping (fingerprint-aware), Layer B runs again at the moment of export
(hard ceilings only, no fingerprint dependency) — the same value can be
checked twice.

## Module Inventory (29 modules under `core/`)

**Pixel/analysis engines** (produce raw measurements from image data):
`histogram-engine`, `image-analysis-core`, `kmeans-engine` (palette),
`color-harmony-engine`, `skin-classifier`, `skintone-engine`,
`scene-classifier`, `color-cast-detector`, `whitebalance-engine`,
`hsl-analyzer-engine`, `colorgrading-ai-engine`, `calibration-engine`,
`tone-curve-ai-engine`, `style-recognition-engine`, `basic-panel-engine`.

**Orchestration / reasoning layers** (combine and interpret the above,
compute nothing from raw pixels themselves):
`feature-fusion-engine`, `style-fingerprint`, `decision-engine`,
`lightroom-mapping-engine`, `xmp-validator`, `style-benchmark-engine`,
`decision-report-engine`, `reference-transfer-engine`.

**Utilities / legacy support**: `color-engine` (shared math helpers),
`curve-engine`, `hsl-engine` and `colorgrading-engine` (earlier-generation
defaults still used as fallbacks by their `-ai`/`-analyzer` successors),
`preset-engine` (XMP serialisation), `processing-log` (singleton audit
log consumed by the in-app debug panel).

## Decision Engine's Internal Structure

`core/decision-engine`'s `buildFinalPreset()` is the single call site
`ui/app.js` uses; internally it performs, in order: adaptive scene
strategy selection → engine trust weighting → transfer-risk estimation →
Style Vocabulary/DNA/Validation classification (Photographer
Intelligence) → Editing Strategy + Style Budget selection (the older,
colour-based classifier) → a call into `core/lightroom-mapping-engine`
for the actual slider computation. It returns one flat preset object plus
an attached `_decision` debug trace and `_mappingTrace`.

## Lightroom Mapping Engine's Internal Structure

The **only** module permitted to compute actual Lightroom slider values.
Internally: Basic Panel mapping (heavily dampened, direction-guarded) →
White Balance mapping (via `wbIntent`, not raw correction) → Vibrance/
Detail → Tone Curve anchors → HSL mapping → Colour Grading mapping →
Calibration mapping → Editing Strategy application → Style Budget
enforcement (priority-weighted, per-dimension) → Cross-slider
optimisation (Exposure↔Highlights↔Whites, Contrast↔Curve, Temp↔Tint,
Texture↔Clarity, Saturation↔Vibrance↔HSL, Calibration↔HSL, the
"high-contrast + lifted blacks" contradiction check) → Final
cross-section validation (Basic Panel vs Colour Grading mood direction,
Tone Curve vs detected mood). Every adjustment made by these last three
passes is logged into `_mappingTrace` for Decision Report to narrate.

## UI Architecture

**Entry point:** `index.html` — a single static page, no build step, no
framework. Styling is entirely inline `style="..."` attributes plus one
`<style>` block for animations, responsive `@media` rules, and the image
viewer's scrollbar/glassmorphism styling (no external `styles.css`).
`ui/app.js` is loaded as `<script type="module">`.

**Branding:** "LUMIXA AI — Reference Colour Intelligence" (page title),
warm graphite/espresso dark theme (`--bg:#15110c`, `--accent:#c9a24b`
gold), Cormorant Garamond (display) + Public Sans (UI) + JetBrains Mono
(data/labels), footer reads "© 2026 LUMIXA AI · Professional Grade
Analysis".

**Layout:** a sticky top header (logo, nav links, plan badge, language/
theme toggles) above a three-column flex layout — a left navigation
sidebar (272px), a flexible main content column (the actual upload/
analyze/slider/export workflow), and a right sidebar (288px). Below
900px width, both sidebars hide and the layout stacks to a single column
(`.lx-sidebar-left`, `.lx-sidebar-right`, `.lx-main-layout` classes)
so the core workflow remains fully usable on tablet/mobile.

**Analysis display:** four tabs (`data-group="overview|tone|colour|
detail"`) reveal/hide grouped analysis panels (histogram, palette, white
balance, skin, HSL, colour grading, calibration, tone curve, harmony,
style recognition, image-analysis-core) once analysis completes.

**Image Preview Viewer:** the upload preview (`#previewWrap` /
`#previewImg`) is a purpose-built scrollable viewer, not a plain
`<img>` — a sticky glassmorphism toolbar (image dimensions label + "change
photo" button) above a `overflow:auto` viewport that displays the image at
its actual decoded resolution (never stretched/cropped), auto-centres the
image only when it is smaller than the viewport in both dimensions
(toggled by JS, never via unconditional CSS flex-centering — that
combination is documented in the CSS as silently breaking scroll bounds
for oversized content), supports Shift+wheel horizontal scrolling via an
explicit instant-scroll handler, and exposes a `--lx-zoom` CSS custom
property intended for a future zoom control (not yet implemented).

**File selection re-analysis:** `loadFile()` calls the existing
`handleReset()` unconditionally before starting a new analysis on every
file selection (not only the first), clearing all `state.last*` fields
so a newly-selected image can never show stale analysis results while the
new pipeline resolves asynchronously.

## Data Flow Boundaries

- No network calls of any kind occur during analysis or export — Google
  Fonts/Material Symbols are the only external resources the page loads,
  and only for typography/icons.
- `state` (a single module-level object in `ui/app.js`) is the only piece
  of mutable UI state; every `core/*` function is a pure function of its
  inputs (documented as a hard requirement throughout the codebase —
  "Nothing here reads the DOM").
