# EPIC 2E-P0.8A — Known Limitations

## 1. Real-image acceptance test not executed in this session

**Cause**: no real Reference/Target photograph files were accessible
(the only image upload present was the same blank "Image Analysis
Core" loading screenshot carried over from the prior R6 conversation),
and this working copy has no installed `playwright` package or
Chromium binary.

**Impact**: the spec's real-image acceptance test (no posterization/
block regions/pixelation visible at Intensity 0/25/50/60/75/100,
smooth green background, preserved white detail, natural skin, closer-
to-Reference warmth) has not been run against an actual photograph.
The code-level fix and a quantified, real-code reproduction of the
exact defect mechanism (226 → 6 combined-unit adjacent-pixel jump) have
been completed and verified instead — see
`EPIC_2E_P0_8A_BEFORE_AFTER_QA.md`.

**To resolve**: on a machine with Chromium/Playwright installed
(`npm install playwright && npx playwright install chromium`), run:
```bash
npm run test:p0-8a:browser -- --ref=/path/to/reference.jpg --target=/path/to/target.jpg
```
This will produce real PNG screenshots at all 6 required Intensity
values plus a pass/fail JSON using the same block-artifact proxy metric
already validated in this delivery.

## 2. Browser-dependent local-gate steps (4-14) fail in this sandbox

Same root cause as #1 (no Chromium/Playwright). This is a pre-existing,
environment-level constraint that has affected every round of this
project's QA since it began requiring real browser verification — not
new to, or introduced by, P0.8A. Steps 1-3 (ESM syntax, Focused Core
smoke, all 60 static suites) pass cleanly and cover everything that can
be proven without a real browser.

## 3. Lightroom-exactness gap (pre-existing, out of scope)

The Preview renderer is a browser-Canvas approximation of Adobe's RAW
processing pipeline (documented in this file's own header comment since
EPIC 2E-N4) — it works on already-demosaiced, gamma-encoded sRGB pixels
via `ImageData`, not RAW/DNG linear sensor data through a colour-managed
pipeline. P0.8A makes this approximation strictly more faithful to the
SAME Candidate values (float precision, smooth blending, real
Calibration application) but cannot and does not claim to close this
inherent gap. No extra undocumented contrast/saturation was added to
compensate for it, per the spec's explicit instruction.

## 4. Color-managed working space not implemented

The pipeline assumes sRGB throughout with no ICC profile handling. This
was true before P0.8A and remains true after — out of this round's
declared scope (Preview artifact/posterization repair), not attempted.

## 5. Protection confidence functions are heuristic, not learned

`skinConfidence()`/`whiteConfidence()` are threshold-based (reusing this
project's existing YCbCr skin-classifier thresholds and a luma+
saturation heuristic for white/highlight), smoothed with continuous
ramps rather than hard cutoffs. They are demonstrably more accurate than
a hard binary mask (see the quantified skin/white damping results in
the Before/After QA doc) but are not a learned/ML classifier and can
still misjudge unusual lighting or skin tones outside the classifier's
tuned range. This is a reasoned default, not tuned against a labeled
real-photo dataset — flagged honestly, consistent with this project's
existing convention for its other heuristic thresholds.

## 6. `MAX_TOTAL_CHROMA_SHIFT = 42` is a reasoned default

Chosen to keep the worst-case stacked-saturation scenario bounded within
valid RGB range with headroom (verified: a maximally-stacked preset
still produces valid output), but the exact numeric value was not tuned
against a corpus of real photos — it is a safety ceiling, not a
perceptually-calibrated constant. If real-photo testing (once available)
shows a case that still looks over-saturated below this ceiling, the
constant is a single, clearly-named, isolated value to retune.
