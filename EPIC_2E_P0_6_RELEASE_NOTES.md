# EPIC 2E-P0.6 — Pipeline Runtime Root-Cause Repair

- Restored Color Grading AI, Calibration Engine, Image Analysis Core and Skin Tone Detection Pro to Reference/Target analysis.
- All full Core analysis runs against a bounded 512px proxy rather than full-resolution photographs.
- Reference and Target Core results are cached; Intensity changes reuse the cache.
- Added generation guards, queued rebuilds, runtime trace events and slider debounce.
- Matched-preview evaluation remains a smaller 320px evaluation pass.
- Production remains Legacy/read-only.
