# EPIC 2E-P0.3 — Skin Core Critical-Path Removal

- Removed `Skin Tone Detection Pro` from the blocking Reference/Target/Matched Preview analysis path.
- Pairwise preview now uses fast `Skin Classification` safety evidence.
- Skin Tone Pro is marked deferred/optional and cannot block Candidate or Target Matched Preview generation.
- Existing Production locks remain unchanged.
