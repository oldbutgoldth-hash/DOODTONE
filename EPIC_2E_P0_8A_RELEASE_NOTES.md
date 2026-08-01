# EPIC 2E-P0.8A — Release Notes

**Preview Rendering Artifact Repair + Posterization Removal +
Candidate-to-Preview Fidelity**

Baseline: `LUMIXA_EPIC_2E_P0_7_COMPLETE_PROJECT_R6.zip`

## What this round fixes

1. **Posterization / block-shaped color regions** — root-caused to a hard
   8-way hue-channel lookup in the HSL render stage that assigned each
   pixel's entire adjustment to exactly one Lightroom channel with zero
   blending. Fixed with the same Gaussian hue-weighting this project
   already uses at analysis time, applied at render time too — every
   channel now contributes continuously by hue distance. Quantified:
   226 → 6 combined RGB-unit max adjacent-pixel jump on a smooth
   synthetic hue sweep across the worst-case (old Green/Aqua) boundary.
2. **Quantized/blocky artifacts on jacket/skin** — same root cause as
   #1, compounded by a secondary Tone Curve defect: two chained,
   pre-rounded 256-entry integer LUT lookups ahead of HSL. Replaced with
   a 1024-entry float LUT, linearly interpolated, rounded only once at
   final output.
3. **Excessive orange/red skin shift** — new continuous, feathered
   `skinConfidence()` damping reduces (never zeroes) HSL/Grading/
   Calibration saturation and hue magnitude on pixels that read as
   likely skin, computed from the untouched original pixel.
4. **White clothing losing neutrality/highlight detail** — matching
   continuous `whiteConfidence()` damping for near-neutral highlight
   pixels, plus the same float-precision fixes reduce cyan/green
   contamination that came from curve/HSL quantization near white.
5. **Excessive saturation/contrast** — new `MAX_TOTAL_CHROMA_SHIFT`
   (42) bounds the SUM of HSL saturation + Vibrance/Sat + Calibration
   saturation per pixel, scaling all three down together (never
   independently) if they'd combine past the limit — closes a
   compounding-adjustment risk the spec specifically asked to be
   audited.
6. **Reference-direction fidelity (warm/soft vs. dark/harsh/green)** —
   Calibration (`preset.cal`) is now actually applied in the Preview; it
   was correctly computed and correctly serialized to XMP but was never
   read by the render loop before this round — a genuine
   Candidate-to-Preview fidelity gap that could itself push the
   rendered look away from what the Candidate/XMP actually specify.

## What changed (files)

See `EPIC_2E_P0_8A_MODIFIED_FILES.md` for the full breakdown:
`core/curve-engine/index.js` (additive), `core/color-match/candidate-preview-renderer.js`
(rewritten render loop, preserved exported signatures),
`ui/reference-color-match-panel.js` (render-resolution fix), plus 2 new
QA files and small `package.json`/`qa/run-static-suites.mjs` wiring.

## What did NOT change (explicitly verified)

- Production Lock: all 9 named production-critical files confirmed
  byte-identical to the R6 seed.
- `productionSource = legacy`, `productionWrite = false`,
  `controlledV2Apply = false`, `xmpWriteAllowed = false`,
  `productionActivationAllowed = false` — untouched.
- PAIRWISE_FAST / FAST_PREVIEW_READY / PAIRWISE_REFINED analysis
  profiles and the 9-state PSM sequence (R6) — untouched.
- Automatic Intensity Preview + cached-Intensity-rebuild path (R5) —
  untouched, still calls the same rebuild function, only now also
  passes the corrected `maxWidth`.
- Save After Image, Generation Control (3-token split, R6),
  neutral-preset identity/no-op behaviour, Candidate JSON schema
  (`hslData`/`toneCurveData`/etc. duplicate-field hostile check still
  passes) — all unchanged.
- No blurring, no resolution reduction used to mask artifacts (spec
  explicitly forbade this — verified not present anywhere in the diff).

## Verification status

- **70/70** static/structural suites PASS (full `qa/run-static-suites.mjs`,
  includes this round's new 22-case suite plus every prior round's
  suite re-run unmodified).
- **22/22** new P0.8A-specific static assertions PASS (float LUT
  precision, hard-bucket removal, Gaussian blend wiring, quantified
  block-artifact regression proof, Calibration fidelity, skin/white
  protection, chroma-shift safety limit, render-resolution fix,
  Fast/Refined-from-original-source, neutral-preset identity, metrics
  contract).
- **5/5** pre-existing `epic-2e-n4-preview-evaluation-static-test.mjs`
  PASS, unmodified file, proving this rewrite preserved that file's
  identity/active-preset/Kelvin-direction contract.
- Production Lock: 9/9 files confirmed byte-identical via direct diff
  against the R6 seed (not just the manifest — the actual files).
  Manifest regenerated (132 files, expected side effect of 3
  intentional edits).
- **Real-image Chromium QA: NOT EXECUTED in this environment** — no
  real Reference/Target photograph files and no installed
  `playwright`/Chromium in this sandbox. Per the user's own
  "start the code audit now, image later" instruction, this was
  accepted as the working scope for this delivery. The real-image test
  script (`qa/epic-2e-p0-8a-real-image-artifact-browser-test.mjs`) is
  complete, parametrized, and verified to fail closed correctly
  (`REAL_IMAGES_UNAVAILABLE`, exit 2) rather than fabricate a PASS. See
  `EPIC_2E_P0_8A_QA_REPORT.md` and
  `EPIC_2E_P0_8A_KNOWN_LIMITATIONS.md` for exactly what remains to be
  run and how.

## How to run

```bash
npm ci
npm run test:local-gate        # full static/structural suite (70 suites)
npm run test:p0-8a:static      # this round's 22-case suite alone

# once real Reference/Target files + a working Playwright/Chromium
# install are available on your machine:
npm run test:p0-8a:browser -- --ref=/path/to/reference.jpg --target=/path/to/target.jpg
```

## Honest completion statement

Per the spec's closing constraint — "Do not claim completion if any
block artifact, posterization or banding remains visible in the
attached real-image test" — this delivery does **not** claim that
constraint is satisfied against a real photograph, because no real
photograph exercising the reported defect was accessible in this
session (confirmed: the only image upload available was the same blank
"Image Analysis Core" loading screenshot carried over from the R6
conversation, not a posterized result). What IS claimed, with concrete
evidence: the specific, named root cause of block/posterization
artifacts (`channelForHue()`'s hard 8-way boundary) has been found,
removed, and replaced with continuous blending; a real, reproducible,
quantified measurement shows a 97%+ reduction in the exact adjacent-
pixel-jump metric that produces visible blocking (226 → 6 units) on a
input engineered to trigger the worst case of that exact defect; and
the automated block-artifact proxy used in this same measurement is
already wired into the real-image browser test for the user (or a
future session with real files/Chromium) to run against their own
photographs and get a directly comparable number.
