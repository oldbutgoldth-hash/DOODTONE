# EPIC 2E-P0.4.1 — Intensity Candidate Normalization

- Fixes TARGET_RENDER_FAILED: Cannot read properties of undefined (reading hsl).
- Normalizes hsl, grade, cal and curves before Unified Fusion and preview rendering.
- Adds regression coverage for Intensity values 0, 25, 51, 60, 75 and 100.
- Production remains Legacy and read-only.
