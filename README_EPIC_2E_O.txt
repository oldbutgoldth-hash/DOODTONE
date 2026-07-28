LUMIXA AI — EPIC 2E-O
TARGET-AWARE COLOR MATCH + LIGHTROOM ROUND-TRIP FIDELITY

Purpose
-------
Correct the real photographic failure mode found when a warm/dark portrait
reference was transferred to a bright wedding RAW target: excessive warmth,
white contamination, skin/orange pressure, and insufficient distinction
between browser Preview and Adobe Lightroom rendering.

Implemented
-----------
1. Target-aware high-key and neutral-white protection.
2. Target skin warmth/saturation protection.
3. Scene-object channel transferability guard.
4. RAW vs rendered Lightroom compatibility profile.
5. Preview-to-Lightroom round-trip import/evaluation workflow.
6. Newly-created clipping metrics (separate from clipping already present in source).
7. Protection-regression diagnostics in N4/N5 evaluation.

Important boundary
------------------
The browser Preview is not an Adobe Camera Raw renderer. The included Browser QA
verifies the evaluator with deterministic simulated return evidence. A real
Lightroom-exported JPEG/TIFF must still be imported into LUMIXA for photographic
round-trip calibration before Reference Color Match Beta or Production.

Production remains locked
-------------------------
productionSource = legacy
productionWrite = false
controlledV2Apply = false
previewExport = false
controlledV2ProductionActivation = false
candidateXmpInMemoryOnly = true

Windows QA
----------
Run RUN_LUMIXA_2E_O_QA_WINDOWS_KEEP_OPEN.bat
Expected final result: EPIC 2E-O RELEASE DECISION: FINAL_PASS
