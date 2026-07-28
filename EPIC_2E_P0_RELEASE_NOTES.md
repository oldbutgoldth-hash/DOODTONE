# EPIC 2E-P0 — Dual Workflow Separation Foundation & Target Preview Repair

## Fixed

- Target Matched Preview no longer fails silently when Target is selected before Reference analysis.
- When Reference and Target are both present, Reference analysis runs automatically.
- Preview now exposes stable states: waiting, reference analysis, target analysis, pairwise fusion, rendering, ready, and error.
- Added stable error codes including `STALE_GENERATION`, `MATCH_CANDIDATE_UNAVAILABLE`, `TARGET_RENDER_SURFACE_MISSING`, `TARGET_RENDER_EMPTY`, and `TARGET_RENDER_FAILED`.
- Preview Canvas is cleared on reset and failure to prevent stale imagery.

## Workflow boundary

This release explicitly namespaces the panel as `REFERENCE_COLOR_MATCH_BETA`. It remains separate from the single-image AI Tone Extractor workflow.

## Validation

- ESM syntax: 239/239 PASS
- P0 static contract: 8/8 PASS
- Full static suite: PASS
- O8 Chromium perceptual runtime: PASS
- Production remains Legacy and write-locked.
