# 01 — PROJECT VISION

## What LUMIXA AI Is

LUMIXA AI is a **fully client-side, browser-based Lightroom preset
(.xmp) generator**. A photographer uploads a single reference image; the
system analyses it entirely in-browser (Canvas ImageData API, no server,
no upload of the photo anywhere) and produces a downloadable `.xmp`
preset intended to recreate that reference's look on the photographer's
own RAW files.

This document reflects the **current implementation**, verified directly
against the source code in this package (`core/`, `ui/`, `index.html`) —
not against any prior planning document or memory of earlier builds.

## Core Philosophy: Reference Tone Extraction, Not Auto-Correction

LUMIXA AI is explicitly **not** an auto-exposure / auto white-balance
tool. Its purpose is to extract the *style, mood, colour relationships,
and photographic intent* of a reference image and translate that into a
Lightroom-compatible preset — prioritising **transfer fidelity and
explainability** over aggressive automatic correction.

This shows up concretely in the current code in several ways:

- **Basic Panel is a supporting signal, never the primary style driver.**
  `core/basic-panel-engine` produces modest exposure/contrast/highlight
  values; `core/decision-engine` and `core/lightroom-mapping-engine`
  actively dampen its influence relative to colour-driving engines
  (Colour Grading, HSL, Tone Curve) and explicitly guard against it
  brightening a moody-dark reference or darkening an airy-bright one.
- **White Balance transfers *intent*, not raw Temp/Tint.**
  `core/whitebalance-engine` computes a structured `wbIntent` (mood
  warmth, ambient colour, green-bounce/mixed-lighting/transfer risk) and
  `core/lightroom-mapping-engine` scales Temp/Tint by that intent's
  computed "intensity" rather than copying the raw correction — a
  reference whose lighting looks scene-specific transfers *less*
  aggressively on purpose.
- **Skin protection has structural priority.** Every colour-mapping stage
  (`_mapHSL`, `_mapCalibration`, White Balance mapping) tightens its
  bounds when skin is detected and portrait context is confirmed,
  independent of whatever the raw analysis suggested.
- **Multiple safety nets, not one.** `core/xmp-validator` runs both
  immediately after mapping (fingerprint-aware clamping) and again right
  before export (hard-ceiling safety clamp) — the same value can be
  checked twice by design.

## Photographer Intelligence: Thinking Like an Editor, Not Just an Engine

Beyond colour-based reasoning, the current pipeline reasons in
**photographer vocabulary**. `core/decision-engine` classifies each
reference into one of 17 named looks (Airy Wedding, Brown Film, Green
Pastel, Moody Cinematic, Korean Clean, and others), each backed by a
**Style DNA** — an explicit list of abstract visual ingredients (e.g.
"Highlight Roll-off", "Matte Blacks", "Film Colour Separation") with a
declared importance, a per-run confidence, and named Lightroom tool
preferences. This DNA is validated for internal consistency
(`_validateStyleDNA`) and — separately — assessed for real-world
**Style Feasibility**: can this specific look actually be reproduced
through global Lightroom sliders, or does it likely depend on localised
edits a preset can't reach? See `03_PHOTOGRAPHER_INTELLIGENCE_PRINCIPLES.md`
for the full reasoning chain.

## Explainability Is a Product Requirement, Not a Debug Feature

Every stage of the pipeline produces *reasons*, not just numbers.
`core/decision-report-engine` assembles a narrated Decision Report (which
engines drove the result and why, what was clamped and why, how
confident the system is and why) intended to be read by both a developer
debugging the pipeline and a photographer judging whether to trust the
output. `core/reference-transfer-engine` separately and deliberately
distinguishes **three concepts that must never be conflated**:

1. **Reference Confidence** — how well was *this* image understood?
2. **Transfer Confidence** — how safely does the detected style generalise
   to a *different* RAW photo?
3. **Lightroom Reproduction** — of the transferable part, how much can
   global Lightroom sliders alone actually recreate?

A reference can score high on (1) and still score low on (2) or (3) —
this is treated as a feature of honest reporting, not a bug to hide.

## Product Scope Boundaries (What LUMIXA AI Deliberately Does Not Do)

- No server-side processing, no account system beyond a static "Unlimited
  plan" display — everything runs in the browser tab.
- No machine-learning training loop. `core/style-benchmark-engine` is
  explicitly "Benchmark Lite" — hand-written, explainable scoring, not a
  trained model.
- No claim of detecting *which* editing tool produced a complex look.
  Where a reference likely contains localised edits beyond a global
  preset's reach, the system says so in plain language ("localized edits
  beyond a global Lightroom preset may be required") without naming
  Photoshop or any specific tool.
- No zoom/pan editing tools in the image preview (the current viewer
  supports scroll and is architecturally zoom-ready, but zoom itself is
  not implemented).

## Who This Is For

A working photographer (wedding, portrait, editorial, documentary,
lifestyle) who has a reference image whose *look* they want to replicate
on their own catalogue of photos, and wants an honest, explained starting
preset rather than a black-box "AI enhance" button.
