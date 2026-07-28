# EPIC 2E-N1–N5 — Core Reference-to-Target Color Match Architecture

## Purpose

LUMIXA receives a Reference image and a Target image, describes both through one comparable signature contract, calculates the transferable photographic difference, maps only bounded/safe adjustments to a Lightroom candidate, renders a matched preview, re-analyzes the result, and records human evaluation evidence.

This EPIC completes the **candidate implementation path**. It does not activate Production. The active Production source remains Legacy.

## Pipeline

### N1 — Reference/Target Signature and Delta

- Both images use `LUMIXA_COLOR_MATCH_SIGNATURE` schema v1.
- Evidence covers white-balance tendencies by tone zone, luminance/tone structure, eight Lightroom-oriented color channels, neutral share, skin evidence, capture risk and evidence confidence.
- Circular hue arithmetic handles red-boundary cases such as 359° vs 1°.
- `LUMIXA_COLOR_MATCH_DELTA` reports signed differences and stable reason/risk codes.
- N1 cannot import Lightroom Mapping, Preset Engine or XMP serialization.

### N2 — Photographic Compensation

- Separates likely illuminant differences from object/scene-color bias.
- Uses only tone zones with real pixel coverage; an empty zone cannot masquerade as neutral evidence.
- Dampens WB transfer when zones disagree or one object color dominates.
- Applies skin-aware red/orange/yellow protection.
- Protects highlight/shadow headroom and low dynamic-range targets.
- Produces semantic intentions only; it has no Production or XMP write authority.

### N3 — Bounded Lightroom Candidate

- Maps N2 intentions to bounded Basic Panel, WB, HSL and Color Grading values.
- Runs the existing pre-XMP safety clamp.
- Serializes an in-memory **Candidate XMP** from the exact safe candidate preset.
- Adds a parameter-level reason trace showing evidence and safety intervention.
- Candidate XMP is explicit and separate from Production XMP.

### N4 — Preview, Re-analysis and Fidelity

- Renders the Candidate preset to a browser canvas for inspection.
- White-balance preview uses the same 2000–50000 K slider contract as XMP serialization instead of a tiny arbitrary RGB offset.
- Measures changed pixels, mean channel difference and clipping.
- Re-analyzes the matched preview into the same Target signature schema.
- Evaluates transferable photographic style: WB, tone, shared-color behavior and skin evidence.
- Object distribution has diagnostic weight only; the engine must not recolor a blue shirt merely because the Reference contains an orange wall.

### N5 — Evaluation Harness

- Stores Reference signature, Target signature, delta, compensation, bounded candidate values, fidelity result, reviewer decision, issue codes and notes.
- Does not store original images, Base64, Blob URLs, local paths or Candidate XMP body.
- Uses IndexedDB with bounded in-memory fallback.
- Supports local JSON evaluation export.

## Production boundary

The following values are mandatory throughout N1–N5:

```text
productionSource = legacy
productionWrite = false
controlledV2Apply = false
previewExport = false
controlledV2ProductionActivation = false
candidateXmpInMemoryOnly = true
```

Candidate Review, a strong fidelity score, or Candidate XMP generation cannot change these locks.

## Honest limitations

- Browser preview is a deterministic approximation of Adobe Camera Raw/Lightroom, not Adobe's RAW renderer.
- Actual XMP fidelity must be validated in Lightroom with real RAW/JPEG pairs before Production activation is considered.
- Reference Color Match Beta, cloud/API assistance and batch Production rollout remain outside this EPIC.
