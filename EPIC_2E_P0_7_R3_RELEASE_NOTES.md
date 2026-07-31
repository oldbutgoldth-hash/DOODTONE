# EPIC 2E-P0.7 R3 — Pipeline Runtime Architecture Release Notes

## Fixed: Preview State Machine Transition Sequence
- All PSM transitions now follow the correct sequence: `IDLE → WAITING → ANALYZING_LAYER_1 → FAST_PREVIEW_READY → ANALYZING_LAYER_2 → REFINED_READY`
- Added `_resetPsmToWaiting()` helper that handles any current state (IDLE, FAST_PREVIEW_READY, ANALYZING_LAYER_2, REFINED_READY, ERROR, STALE) and routes to WAITING via valid transition paths
- Browser test assertion confirms zero PSM warnings across all real-image scenes

## Fixed: Layer 2 is Now Truly Deferred
- After `FAST_PREVIEW_READY`, the main runtime lock is released immediately (`running = false`), allowing new Intensity calls to proceed
- Layer 2 runs as a separately controlled asynchronous task (`_runLayer2`) with its own `AbortController` for independent cancellation
- Intensity changes cancel in-flight Layer 2 work via `_cancelLayer2()` before starting fresh Layer 1
- `_runLayer2` checks obsolescence at each stage (abort signal, stale generation, stale run ID, guard)
- Heartbeat and trace lifecycle now end in `_runLayer2` (or error handler), not in `_rebuildAndPreview` finally block

## New: Real-Image Browser Test (20/20 PASS)
Four photographic scenes with comprehensive verification:

| Scene | Verifications |
|-------|--------------|
| Portrait with visible skin | Skin Tone Detection Pro completes, Fast Preview appears |
| Wedding with white clothing | Pipeline completes, Save After Image enabled at FAST_PREVIEW_READY |
| Warm Reference + Cool Target | WB detects warm temperature, Color Grading produces evidence, Calibration produces evidence |
| Complex multicolor background | Palette extracts 3+ colors, pipeline completes |

Cross-scene checks:
- **Zero PSM warnings** across all scenes
- Cache HIT messages confirm Reference/Target analysis is not re-run
- Heartbeat instance present throughout
- Production locks: `productionSource=legacy`, `productionWrite=false`, `xmpWriteAllowed=false`
- Final evaluation produces non-zero fidelity score
- No permanent loading state (afterUpdating opacity=0)

## Test Results
- Static tests: All suites pass (expected: 1 production-lock SHA mismatch for intentionally modified files)
- Pipeline Runtime Browser Test: **21/21 PASS**
- Real-Image Browser Test: **20/20 PASS**
