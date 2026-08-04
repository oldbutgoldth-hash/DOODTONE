# P1I — Performance and Sampling Policy

## Documented budget

| Parameter | Value | Rationale |
|---|---|---|
| `MAX_ANALYSIS_DIM` | 360px | Between `whitebalance-engine`'s 320px pass and `image-analysis-core`'s 480px pass — comparable cost to the existing WB engine draw, not a new heavier one |
| `PIXEL_STRIDE` | 2 | Finer than `whitebalance-engine`'s stride-3, affordable because... |
| `MAX_SAMPLES` | 20,000 | ...total ACCEPTED-sample work is hard-capped regardless of source resolution or stride |
| `MAX_SCAN` | 400,000 | Absolute ceiling on pixels even inspected, so a pathological input can never make the sampler unbounded |

At 360px on a typical (non-square) source, the full grid is well under
`MAX_SCAN`, so in practice every pixel at stride-2 is inspected once —
`MAX_SAMPLES`/`MAX_SCAN` exist as hard safety ceilings, not
expected-case throttles.

## One pass, six estimators, shared sample

`runWhiteBalanceEstimators()` draws and samples the image **exactly
once** per generation (`sampleFromImage()`/`sampleFromBuffer()`); all
six estimators (and the ensemble) consume the SAME `SampleResult` —
no estimator re-draws or re-samples independently. This is a real
saving relative to the pre-P1I state, where `whitebalance-engine` and
`color-cast-detector` already each did their OWN independent draw (see
`P1I_PIXEL_EVIDENCE_PIPELINE_AUDIT.md` §13) — P1I adds exactly one
additional draw, not six.

## No shared buffer with the other three engines

`image-analysis-core`, `whitebalance-engine`, and `color-cast-detector`
each retain their own independent draw — sharing a single buffer
across all four engines would require editing those three files
directly, which is out of P1I's strict scope (they are explicitly not
to be altered, matching the same restriction P1H operated under for
`whitebalance-engine`). This is a deliberate, documented trade-off:
P1I accepts a fourth independent draw rather than risk a cross-cutting
change to three files this EPIC is not scoped to touch.

## Run-once-per-generation guarantee

`runWhiteBalanceEstimators()` is called from exactly one place in
`ui/app.js`'s `runAnalysis()` — the same function every other
evidence-producing module is called from. It is architecturally
impossible for it to re-run on:
- **Language change** — handled by `setLang()`/
  `rerenderCurrentUiForLocale()`, which never calls `runAnalysis()`.
- **Slider edit** — handled by `updateCandidateParameter()` (P1C),
  which never calls `runAnalysis()`.
- **XMP download** — handled by `handleDownload()` (P1D), which reads
  the already-built Candidate and never calls `runAnalysis()`.
- **Advanced Diagnostics panel expansion** — a pure `<details>` toggle,
  no JS handler attached that calls `runAnalysis()`.

## Synchronous execution, no Worker

Unlike `image-analysis-core` (which offloads its heavier ~115,000-pixel
pass to a Worker specifically because of that cost — see
`P1I_PIXEL_EVIDENCE_PIPELINE_AUDIT.md` §10), P1I's pipeline runs
synchronously on the main thread, following `whitebalance-engine`'s
existing pattern (its closest architectural sibling) rather than
introducing a second Worker infrastructure. At `MAX_SAMPLES=20,000`
accepted pixels across six estimators, the total work is comparable to
or smaller than `whitebalance-engine`'s own existing synchronous pass
(~8,500 samples × 5 internal sources), which this project has run
synchronously in production since the WB engine's v4 release.

## Deterministic timing diagnostics

`runWhiteBalanceEstimators()`'s returned bundle always carries
`diagnostics.durationMs` (wall-clock, `performance.now()`-based) so a
slow run is visible in the Advanced Diagnostics panel and in trace
events (`WB_ESTIMATOR_ENSEMBLE_COMPLETED`) without needing to
instrument the browser separately.
