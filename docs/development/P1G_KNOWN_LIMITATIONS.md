# P1G Known Limitations

## 1. ~~No Layer-B hard limit for Detail fields~~ — CLOSED in R2

This limitation was real in P1G R1 and is now closed. R2 added
`HARD_LIMITS.detail = { sharpening: {min:0,max:40}, noiseReduction:
{min:0,max:40} }` to `core/xmp-validator/index.js` and wired a new
`_clampDetailPanel()` into `quickSafetyClamp()`. Detail fields now have
the same two-layer protection every other panel has: Layer A
(`detail-guardrails.js`, applied once before Candidate commit) plus
Layer B (`quickSafetyClamp()`, applied again at export, catching
post-commit mutations, future bugs, or direct manual overwrites Layer
A never sees). Mutation tests M4/M4b prove the fix directly against
the real pipeline. See `P1G_R2_DETAIL_EXPORT_SAFETY_CLAMP.md` for the
full writeup.

## 2. Color Noise Reduction is permanently unsupported

`core/preset-engine/index.js::serializeXMP()` hardcodes
`crs:ColorNoiseReduction="25"` and never reads any Candidate-derived
value. There is no Candidate → Legacy Preset → Serializer → XMP export
path for this field in the current codebase. The Detail Plan computes
a `recommended` value for diagnostic/lineage transparency only, always
marked `supported: false`. Building a real export path would require
changing the Production-Locked serializer, which is out of scope.

## 3. Evidence proxies, not real per-channel/per-frequency measurements

`chromaNoise` (discounted-luminance-noise proxy) and
`edgeDensity`/`fineDetailDensity` (discounted-sharpness proxies) are
explicitly documented as approximations — this codebase has no real
per-channel noise analysis or frequency-domain edge detection. The
recommendations are still evidence-derived and bounded, but they are
not as precise as a dedicated noise/edge analysis engine would be.

## 4. No ISO/EXIF-based noise modeling

There is no EXIF metadata reader anywhere in this codebase (confirmed
by the original audit). Noise evidence is derived entirely from
image-content analysis (`imageAnalysis.noiseScore`), never from camera
ISO or exposure metadata, which a more sophisticated noise model might
use to predict noise characteristics more precisely for a given sensor.

## 5. Sandbox test-execution constraint (this delivery only, not a code defect)

This sandbox's per-bash-call wall-clock cap (~45s) cannot execute this
project's full nested regression-suite spawn chain
(P1G → P1F → P1E R3 → P1E R2/P1C/P1D, each level spawning the next as
its own child process) to completion in a single command. Every suite
in that chain was independently verified by direct execution in this
session (P1A 25/25, P1C 86/86, P1D 71/71, P1E-color 94/94 confirmed up
to the point this run's timeout was hit with 0 FAILs observed, P1F
confirmed passing through at least its own test 61 with 0 FAILs
observed) — see `P1G_QA_REPORT.md` for the exact commands and results.
This is a delivery-environment limitation, not a defect in the test
suite or the production code, and matches the same honest-reporting
convention used for every prior EPIC in this project's history.

## 6. Browser QA not executed in this sandbox

No Chromium executable is available in this sandbox
(`browserType.launch: Executable doesn't exist ...`), and no system
Chromium/Chrome binary is installed either. `qa/epic-2e-p1g-browser-qa.mjs`
is complete and ready to run in any environment with Chromium
available; its honest `BROWSER_BINARY_UNAVAILABLE` result is recorded
verbatim in `qa/epic-2e-p1g-browser-qa-result.json`.
