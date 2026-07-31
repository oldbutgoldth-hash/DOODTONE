# EPIC 2E-P0.7 — Pipeline Runtime Architecture

## Release Notes — R2

### Overview
Integrates eight new Pipeline Runtime modules into the Reference Color Match Beta panel (ui/reference-color-match-panel.js) and provides a two-layer pipeline architecture that separates fast preview from deferred refined analysis.

### New Modules
| Module | Path | Purpose |
|--------|------|---------|
| Generation Control | core/generation-control.js | Sequential generation IDs, AbortController-based cancellation, stale-guard factory |
| Analysis Cache | core/analysis-cache.js | In-memory LRU cache for Reference/Target analysis results |
| Pipeline Heartbeat | core/pipeline-heartbeat.js | 500ms monitor that detects stalls >3s without progress |
| Preview State Machine | core/preview-state-machine.js | Finite-state machine: IDLE→WAITING→ANALYZING_LAYER_1→FAST_PREVIEW_READY→ANALYZING_LAYER_2→REFINED_READY |
| Contribution Ledger | core/contribution-ledger.js | Per-generation module execution log with layer summary |
| Candidate Schema | core/candidate-schema.js | Real LUMIXA preset field definitions (exp, con, hi, sh, wh, bl, temp, tint, vib, sat, clarity, dehaze, texture, curves, hsl_*_*, grd_*_*, cal_*_*), normalization, validation, layer subset extraction |
| Pipeline Tracer | core/pipeline-tracer.js | Generation-scoped structured trace with formatTraceSummary |
| Core Runner | core/core-runner.js | runModule with cache-first strategy, timeout, fallback, abort support |

### Two-Layer Pipeline Architecture

**Layer 1 (Fast Preview):**
1. Generation token created (aborts prior in-flight work)
2. Reference evidence from cache or analysis
3. Target evidence from cache or analysis
4. Perceptual pixel transfer (cached by key)
5. Core color match pipeline fusion
6. Render target matched preview to canvas
7. Enable Save After Image immediately
8. Status: "Fast Preview · Save After Image พร้อม"

**Layer 2 (Deferred Refined Analysis):**
1. Matched after-image analysis (EVALUATION_MINIMAL profile)
2. Matched signature build
3. Evaluation (fidelity score, match need)
4. Update evaluation harness
5. Status: "Target Matched Preview พร้อม · Fidelity X.X/100"

### Intensity Slider
- Adjusting intensity reuses cached reference/target analysis
- Perceptual pixel transfer cached by generation+intensity+mode key
- No re-analysis of Core engines on intensity change
- Debounced at 140ms

### Key Fixes (vs R1)
- Heartbeat: lastProgressAt only updates on explicit update() calls, never from interval tick
- Candidate Schema: uses real LUMIXA preset fields (nested hsl/grade/cal, not flat)
- Color Harmony Engine: defensive null guard on generateHarmonies
- Panel: P0.7 runtime objects (PSM, heartbeat, ledger) initialized in initReferenceColorMatchPanel
- Test hooks exposed via window.__LUMIXA_TEST

### Production Safety Locks
- productionSource = 'legacy'
- productionWrite = false
- controlledV2Apply = false
- xmpWriteAllowed = false
- productionActivationAllowed = false

### Test Results
- Static tests: 39/39 PASS
- Browser tests: 21/21 PASS (real Chromium, synthetic images, full pipeline)

### Known Limitations
- Synthetic test images (solid-color canvas) may not exercise all Core analysis paths
- Test images have limited color variation, so HSL/Grading/Cal fields are zeroed
- No real DNG/RAW images in test suite
- Pipeline timeout for Layer 2 is implicit (depends on _analyzeEvidence duration)
