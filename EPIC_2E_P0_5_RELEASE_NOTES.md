# EPIC 2E-P0.5 — Non-blocking Calibration Preview

## Problem
Reference Color Match could remain stuck at `Calibration Engine` because the analyzer runs synchronously on the browser main thread. A Promise timeout cannot interrupt synchronous work while the main thread is blocked.

## Fix
- Removed Calibration Engine from the synchronous Reference/Target/Matched Preview critical path.
- Recorded Calibration Engine honestly as deferred instead of pretending its output was consumed.
- Added `EVALUATION_MINIMAL` mode for Matched Preview analysis so evaluation does not rerun optional heavy cores.
- Preserved Calibration Engine in the main AI Tone Extractor and technical-analysis workflow.
- Candidate calibration values remain neutral until a future worker-based refinement pass completes.

## Verification
- P0.5 static contract: 6/6 PASS
- ESM syntax: 245/245 PASS
- P0.4 critical-path regression: 8/8 PASS
- O9 fusion static: 12/12 PASS
- Preview evaluation static: 5/5 PASS
- Chromium O8 perceptual runtime: PASS

## Production
Legacy production and all production write locks remain unchanged.
