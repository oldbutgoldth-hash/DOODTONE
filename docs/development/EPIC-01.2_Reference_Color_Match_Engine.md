# EPIC 1.2 — Reference Color Match Engine

## Goal

Add a "Reference Color Match" feature: upload a reference image, extract
its colour character (palette + tone zones), preview that character
transferred onto a separate target image, and export a Lightroom-
compatible `.xmp` — as a self-contained feature alongside the existing
Photographer Intelligence pipeline, without touching it.

## Critical Deviation From the Spec, Stated Upfront

The spec requested TypeScript files (`src/lib/color/*.ts`) and a React
component (`src/components/ReferenceColorMatchPanel.tsx`). **This was not
implemented as specified.** Per the Latest Project File Rule
("preserve current UI/responsive layout," "do not break existing
pipeline") and `docs/project/04_PROJECT_ARCHITECTURE.md`'s documented
current architecture (a static single page, zero build step, no
framework), introducing `.ts`/`.tsx` would require adding a TypeScript
compiler and a React runtime/bundler — a build toolchain this project
does not have and which none of its 30+ existing modules depend on. That
is itself an architecture change, which every EPIC in this project has
been explicitly told not to make, and directly conflicts with this same
spec's own "no heavy dependency" and "browser only" rules.

**What was actually built:** the identical feature set, implemented as
plain ES modules under `core/color-match/` and `ui/`, matching the exact
conventions every other module in this codebase already uses
(`core/*/index.js` exporting plain functions, `ui/*.js` as a DOM
controller). No functionality from the spec was dropped — every listed
feature (palette extraction, tone zone analysis, colour transfer with
intensity/mode, skin/highlight/shadow preservation, XMP generation, full
UI) is present and working, verified end-to-end below.

## Reference Files Could Not Be Studied

`host.jsx`, `lib.js`, and `panel.js` were inspected before writing any
code. All three are **JSXBIN-compiled ExtendScript bytecode** (Adobe's
binary-encoded format for compiled `.jsx` — confirmed by their content
starting with the literal marker `@JSXBIN@ES@2.0@` followed by encoded
bytes, not readable source). They cannot be read as source code by
anyone, not just "should not be copied" — there was no concept-study
possible from these three files. The implementation below is built
entirely from general, well-known photo-editing/colour-grading concepts,
not from anything in the reference files.

## Reuse-First: What Was NOT Re-implemented

Per "do not duplicate existing engines if equivalent logic already
exists," every new module in `core/color-match/` was designed AFTER
checking what the existing pipeline already does:

| New module | Reuses (unchanged) | New logic added |
|---|---|---|
| `palette-extractor.js` | `core/kmeans-engine`'s full k-means clustering (`extractPalette`) — already returns hex/rgb/hsl/luminance/population per colour, K=8 (already inside the 5–12 range) | Field renaming only (`population` → `weight`); zero new pixel analysis |
| `tone-zone-analyzer.js` | `core/histogram-engine`'s `analyzeImage()` for black/white points and contrast | New: per-zone (Shadow/Midtone/Highlight) average colour, saturation, and temperature/tint hints — histogram-engine doesn't expose this |
| `color-transfer-engine.js` | Nothing pre-existing does this | **Entirely new** — the actual point of this EPIC |
| `preserve-engine.js` | `core/skin-classifier`'s `classifySkin()` for rule-based HSL/luminance skin detection | New: deciding how much to ease deltas once skin/highlight/shadow presence is known |
| `reference-xmp-generator.js` | `core/preset-engine`'s `serializeXMP()`/`downloadXMP()`, `core/xmp-validator`'s `quickSafetyClamp()` | New: adapting a transfer profile into the preset-engine's flat object shape |

## Algorithm Summary

**Palette Extractor** — thin wrapper; no new algorithm.

**Tone Zone Analyzer** — samples the image at the same 200px max
dimension the rest of the pipeline uses, buckets each sampled pixel into
Shadow/Midtone/Highlight using `histogram-engine`'s own black/white
points as the boundary (not an arbitrary fixed split), and averages each
zone's RGB, saturation, and a lightweight temperature/tint hint
(`(R−B)/255` and `(G−(R+B)/2)/255` scaled to ±100 — a simple directional
signal, not colour-science-accurate Kelvin).

**Color Transfer Engine** — the core new logic. Computes:
- **White Balance**: reference vs target's weighted-average
  temperature/tint hint across all three zones, scaled by intensity and
  mode.
- **Tone** (Exposure/Contrast/Highlights/Shadows/Whites/Blacks): from
  per-zone brightness differences between reference and target.
- **Colour Grading**: each zone's average colour converted directly into
  a hue/saturation offset (via a standard RGB→HSL-style max/min/chroma
  calculation) — the reference's own shadow/midtone/highlight colour
  becomes the Colour Grading values almost directly.
- **HSL**: the reference palette's top non-neutral colours (saturation >
  12) are bucketed into the 8 standard HSL channels and nudge that
  channel's saturation proportionally to the colour's palette weight.
- **Presence** (Vibrance/Saturation): from the reference palette's
  overall weighted saturation versus a neutral baseline.
- **Detail** (Clarity/Dehaze/Texture): scaled lightly from the same
  contrast delta used for Tone.

Every value is clamped to `SAFE_BOUNDS` — deliberately **tighter** than
`core/xmp-validator`'s own `HARD_LIMITS` — before `intensity`/`mode`
weighting is even applied, satisfying "must avoid extreme colour damage"
as a first, conservative pass. `core/xmp-validator`'s `quickSafetyClamp`
still runs again later as the authoritative final check, mirroring the
existing pipeline's own "more than one safety net" pattern.

**5 Modes** are not a single overall multiplier each — every mode scales
a *different combination* of six sub-weights (WB, tone, colour grading,
HSL, contrast, clarity), so each genuinely produces a different kind of
look rather than the same shape at a different strength.

**Preserve Engine** — when skin is detected (via the existing
`classifySkin`), HSL Red/Orange/Yellow shifts are eased to ~30–35% of
their computed value. Highlight/Shadow protection eases the
corresponding Tone and Colour Grading saturation values to ~50–60%.

## UI Integration Summary

A new, fully self-contained section (`#rcmSec`) was added to `index.html`
directly below the existing Support section, using **the exact same
inline-style + CSS-variable design language** as the rest of the page
(no new colours, fonts, or component patterns introduced) and the
**same `.lx-2col-grid` responsive class** already established for mobile
stacking — verified at 390px width: `scrollWidth` stayed at 396px (no
overflow introduced).

`ui/reference-color-match-panel.js` is a **completely separate
controller** from `ui/app.js` — its own local `rcm` state object, its own
event listeners, zero imports from or writes to `ui/app.js`'s `state`.
Verified end-to-end: running the main analyse→export pipeline and the
Reference Color Match panel in the same page load produced zero console
errors and both worked independently.

An approximate before/after canvas preview (simple per-pixel
temperature/tint/exposure/contrast/vibrance approximation, explicitly
NOT a colour-managed Lightroom-accurate render — documented as such in
the code) gives immediate visual feedback without any heavy rendering
dependency.

## XMP Generation Summary

`buildReferenceMatchPreset()` converts a transfer profile into the exact
flat object shape `core/preset-engine`'s `serializeXMP()` already expects
(`exp`, `con`, `hi`, `sh`, `wh`, `bl`, `clarity`, `dehaze`, `texture`,
`temp`, `tint`, `vib`, `sat`, `hsl.hsl_{h,s,l}_{channel}`, `grade.grd_*`,
`cal.cal_*`) — confirmed by reading `serializeXMP`'s full source before
writing this adapter. Tone Curve anchors are left at neutral defaults
(5/128/248, matching `xmp-validator`'s own neutral midpoints) since the
transfer engine works in Basic Panel/Colour Grading/HSL space, not curve
shape. Calibration is left untouched (all zeros) — Reference Color Match
does not compute Calibration values.

**No new XMP-writing code exists anywhere in this EPIC** —
`serializeXMP`, `downloadXMP`, and `quickSafetyClamp` are the same three
functions the main pipeline's own export button calls.

## Verified End-to-End (Playwright)

- Reference image analysis: 8 palette swatches, 3 tone-zone cards
  rendered correctly.
- Target image upload auto-triggers a rebuilt profile: 7 explanatory
  reasons displayed.
- Intensity slider (tested at 85), mode selector (tested switching to
  Cinematic), and preserve toggles (tested unchecking Protect Shadows)
  all correctly trigger a profile rebuild and preview re-render.
- Generate XMP correctly reported a safety-clamp adjustment when a high
  intensity + Cinematic mode combination pushed a value to
  `xmp-validator`'s ceiling — confirming the two-layer safety design
  actually engages when needed, not just when convenient.
- Downloaded `.xmp` file verified valid (`<?xpacket`, `</x:xmpmeta>`,
  `crs:Temperature`, `crs:ColorGradeShadowHue` all present).
- **Existing main pipeline re-tested in the same page load**: image
  upload → analysis → "Travel" category detected → zero JS console
  errors, confirming this EPIC did not break the existing pipeline.
- Mobile (390px) layout: `scrollWidth` 396px, no overflow introduced by
  the new section.

## Modified / New Files

**New:**
- `core/color-match/palette-extractor.js`
- `core/color-match/tone-zone-analyzer.js`
- `core/color-match/color-transfer-engine.js`
- `core/color-match/preserve-engine.js`
- `core/color-match/reference-xmp-generator.js`
- `ui/reference-color-match-panel.js`
- `docs/development/EPIC-01.2_Reference_Color_Match_Engine.md` (this file)

**Modified (additive only):**
- `index.html` — new `#rcmSec` section added after Support; one new
  `<script type="module">` block added to wire the panel. No existing
  element, id, class, or script was altered or removed.
- `docs/project/05_PROJECT_MEMORY.md` — new stage row + risk notes.

**Not modified:** `ui/app.js`, `ui/ui-engine.js`, every renderer, every
existing `core/` module, `core/calibration-registry` (EPIC 1.1, untouched
and still not read by anything).

## Remaining Risks

- **This EPIC's TypeScript/React spec was not followed literally** — see
  the deviation note above. If a future stage genuinely needs a
  TypeScript/React build pipeline, that is an architecture decision this
  stage deliberately did not make unilaterally.
- **The before/after canvas preview is a simple per-pixel approximation**,
  not a colour-accurate simulation of what Lightroom will actually
  produce from the exported `.xmp` — the exported file's real values are
  authoritative; the preview is directional guidance only.
- **`color-transfer-engine.js`'s formulas (coefficients like ×0.8, ×0.5,
  ×0.35, ×0.25) are newly hand-reasoned**, consistent with every other
  scoring formula in this codebase — not tuned against real reference/
  target pairs.
- **Tone Zone Analyzer's temperature/tint hint is a simple directional
  signal**, not a colour-science Kelvin computation — consistent in
  spirit with `core/whitebalance-engine`'s own lighter-weight hints, but
  independently computed rather than sharing that engine's exact
  formula.
- **This feature is entirely independent of Style Vocabulary/DNA/
  Validation/Feasibility (Stage 2.4.2B.2)** — a Reference Color Match
  export carries no photographer-style label, DNA, or feasibility score.
  Integrating the two systems (e.g. classifying the reference image's
  style before transfer) was not attempted and is a natural candidate for
  a future stage.
- **No automated test suite** — all verification above was manual,
  Playwright-driven, consistent with every other stage in this project.
