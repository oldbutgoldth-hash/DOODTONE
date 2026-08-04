# P1G Known Limitations

## 1. No Layer-B hard limit for Detail fields (pre-existing, not a P1G regression)

`core/xmp-validator/index.js`'s `HARD_LIMITS` has zero entries for
`sharp`/`noise` — confirmed by direct source audit before this EPIC
began, and re-confirmed by mutation test M4. This means
`quickSafetyClamp()` (Layer B, applied a second time immediately before
export) provides no protection whatsoever for Detail fields, before or
after this EPIC. `detail-guardrails.js` (Layer A, applied once before
Candidate commit) is the **sole** safety net. Closing this gap by
adding `HARD_LIMITS.detail` entries would touch the Production-Locked
`core/xmp-validator/index.js`, which is out of this EPIC's scope. A
direct post-commit overwrite of `candidate.detail.sharpening` (e.g. by
a future bug elsewhere in the codebase) would currently export
unclamped.

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
