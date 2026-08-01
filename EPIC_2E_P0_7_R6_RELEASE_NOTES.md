# EPIC 2E-P0.7 R6 — Release Notes

**True Preview-Critical Path Separation + Deferred Heavy Core Execution +
Real-Image Runtime Stall Repair**

## What this round fixes

Real photographs (not synthetic test images) could get stuck on
**"กำลังวิเคราะห์ภาพต้นแบบ / Image Analysis Core"** and never reach a
Preview. Two compounding causes, both now fixed:

1. Reference and Target were each run through the *full* analysis
   profile — all ~12 modules, 4 of them heavy — **before Preview ever
   rendered**, serially, for both images.
2. Image Analysis Core's heaviest pixel math ran as one unbroken
   synchronous block. A safety timeout around it could not actually help
   — JavaScript is single-threaded, so the timeout callback cannot fire
   while that block is still running.

## What changed

- A first Preview now renders from a **Fast** analysis pass that skips
  only the 4 heaviest modules (Color Grading AI, Calibration Engine,
  Image Analysis Core, Skin Tone Detection Pro). Every other module —
  palette, tone zones, skin detection, histogram, white balance, tone
  curve, HSL — still runs, so the Fast Preview is a real, usable result,
  not a placeholder.
- Once that Fast Preview is showing, a **Refined** pass runs the same 4
  heavy modules in the background and upgrades the Preview when it's
  done — the user is never blocked waiting for it.
- Image Analysis Core's pixel math now runs in a **Web Worker** by
  default, so it genuinely cannot block the page, and a job that somehow
  still hangs is force-terminated rather than just timed out and ignored.
  Falls back to the exact same computation in-process if Workers aren't
  available.

## What did not change

- The R5 Intensity slider behavior — instant, cached re-render with no
  re-analysis — is untouched.
- Every existing analysis module, the Candidate data contract, and all 9
  production-critical files (mapping engine, XMP validator, preset
  engine, app shell, decision engine, preview render plan, index.html)
  are byte-for-byte identical to before this round.
- Nothing was removed. This is a purely additive change to *when* the
  heavy modules run, not *what* they compute.

## Verification status

- **Verified in this environment**: root-cause diagnosis, state-machine
  transition correctness (26 cases), source-level structural correctness
  of the Fast/Refined split, Worker-offload, and generation/cache
  isolation (74 cases), full 69-suite project regression, Production
  Lock.
- **Not verified in this environment** (honest limitation, not a
  defect): the real-image Chromium runtime test. This sandbox has
  neither a real Chromium binary nor accessible copies of the two real
  photographs used to originally reproduce the stall (they were pasted
  inline in chat, which doesn't produce a file this environment can
  read). The test is fully written and ready — run
  `npm run test:p0-7-r6:browser -- --ref=<path> --target=<path>` on a
  machine with real Chromium and the actual photo files to close this
  out. See the QA Report §6 for full detail.

## How to run this round's checks yourself

```
npm run test:p0-7-r6:psm       # PSM transition test (26 cases)
npm run test:p0-7-r6:static    # Fast/Refined structural test (74 cases)
npm run test:p0-7-r6:browser   # Real-image runtime test (needs real Chromium + real photos)
node qa/run-static-suites.mjs  # full project regression (69 suites)
```
