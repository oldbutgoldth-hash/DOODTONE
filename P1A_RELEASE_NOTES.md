# EPIC 2E-P1A — Release Notes

**Title:** Single Image Analysis Session Foundation + Central Analysis
Orchestrator + Canonical Evidence Ownership + Generation, Cache and
Legacy Compatibility Control

**Baseline:** EPIC 2E-P0.8A (`LU2DCD~1.ZIP`)
**Version:** `2.0.7.3` → `2.1.0`

## R3 — critical upload-lifecycle fix (real browser regression)

Real browser testing on the R2 build found a deterministic bug: every
image upload got permanently stuck showing "กำลังโหลดรูปภาพ..." (loading
image...) — not an image-size or performance issue. Root cause:
`loadFile()` created the new upload's Session (`beginUpload()`) and
*then* called `handleReset()`, which unconditionally aborts and clears
whatever Session is active — destroying the one just created. Fixed by
reordering to reset-then-create, plus a related hardening where each
upload's Session ticket is now captured locally rather than read from
a shared, reassignable variable, closing a narrower race where a slow
prior image's callback could fire after a newer upload started. Full
root-cause writeup: `P1A_UPLOAD_LIFECYCLE_FIX.md`. A new 16-case
integration test (`qa/epic-2e-p1a-r3-upload-lifecycle-integration-test.mjs`)
reproduces the real defect using the real orchestrator functions and is
verified to fail against the broken ordering and pass against the fix.
No Session architecture, Core formula, Candidate/XMP behavior,
Reference Color Match, or Production lock changed — see
`P1A_QA_REPORT.md` §4 for the re-verification.

## Summary

P1A introduces one canonical Single Image Analysis Session per uploaded
image, replacing the previous pattern of ~20 scattered `state.last*`
writes with zero generation protection. This is an architecture and
state-ownership change only — no color/tuning logic, AI model, UI
layout, or XMP mapping was touched, and Reference Color Match is fully
isolated and unmodified.

## What changed

- New `core/single-image/` module family (7 files): Session contract,
  active-Session store with generation-ownership enforcement,
  declarative 23-module analysis profile, evidence normalizer,
  dedicated analysis cache, and a one-way legacy-state compatibility
  adapter.
- `ui/app.js`'s `loadFile()`, `runAnalysis()`, and `handleReset()` now
  route every analysis result through the orchestrator before writing
  `state.last*`, closing two confirmed race conditions:
  1. Clicking Re-analyze repeatedly no longer allows two concurrent
     analysis runs to both write results — the second call's ticket is
     rejected before any Core module runs.
  2. Uploading a new image while a previous image's analysis is still
     in flight now guarantees the previous image's late-arriving
     results are silently dropped instead of overwriting the new
     image's state.
- Every existing Core module, in the same call order, with the same
  parameters and formulas — none were modified, wrapped in new logic,
  or reimplemented.

## What did not change

- Candidate/Lightroom recommendation formulas (`core/decision-engine`),
  XMP property mapping/serialization/filename/download rules
  (`core/preset-engine`, `core/xmp-validator`), slider sync
  (`applyPresetToSliders`/`readSlidersAsPreset`).
- Reference Color Match: PAIRWISE_FAST/REFINED separation, cached
  Intensity Preview rerender, RCM state machine, Candidate Preview
  Renderer, Gaussian HSL blending, float Tone Curve LUT, skin/white
  protection, Save After Image — all confirmed byte-identical to the
  P0.8A baseline for every RCM-exclusive file.
- Production safety locks (`productionSource: 'legacy'`,
  `productionWrite: false`, `controlledV2Apply: false`,
  `xmpWriteAllowed: false`, `productionActivationAllowed: false`) —
  unchanged.
- P0.8A's preview-rendering artifact repairs and posterization fixes —
  regression-verified still active (22/22 P0.8A tests re-run and
  passing as a subprocess of the P1A suite).

## Test results

- 62/62 static/integration suites passing (including the new 25/25
  P1A-specific suite and a re-run of P0.8A's 22/22 suite).
- Browser QA: written and verified to fail closed correctly
  (`BROWSER_BINARY_UNAVAILABLE`) — this sandbox cannot download
  Chromium (network allowlist blocks `cdn.playwright.dev`). See
  `P1A_QA_REPORT.md` for full detail and the exact scenarios that
  remain unverified by a live browser in this environment.

## Known limitations

- Real-browser verification of the 12 required Browser QA scenarios did
  not execute in this sandbox for the same environment reason as every
  prior EPIC 2E round (no network access to Chromium's CDN). The test
  script is complete and ready to run wherever Chromium is available —
  see `npm run` targets and `qa/epic-2e-p1a-single-image-session-browser-test.mjs`.
- `AbortSignal` support is best-effort: only Core modules that already
  accept an `AbortSignal` parameter will actually stop early on abort;
  others simply finish computing and have their result silently dropped
  by the generation-ownership check. No Core module's signature was
  changed to add `AbortSignal` support — that would have been a Core
  formula/contract change, out of P1A's scope.
