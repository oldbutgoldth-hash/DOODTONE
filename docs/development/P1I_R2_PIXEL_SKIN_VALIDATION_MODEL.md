# P1I R2 — Pixel Skin Validation Model

## 1. Purpose and scope

P1I R1 shipped six pixel-level illuminant estimators plus one **proxy**
skin-consistency signal inside P1H (`skinWarmth.confidence × skin
coverage` — a colorimetric approximation, never actual per-pixel
validation). This round replaces that proxy, where usable, with a real
pixel-level skin sample extraction and validation layer.

**This module is a validator, never an estimator.** It does not
propose a Temperature/Tint value of its own, is never added to
`ESTIMATOR_ID`, and never participates in `combineWeighted()`'s
consensus math. Its only job is to answer: *given the ensemble's
already-computed proposed correction, does the skin in this photo
support it, contradict it, or say nothing either way?*

## 2. Where it sits in the pipeline

```
wb-pixel-sampler.js            (ONE shared pixel sample -- already taken for the six estimators)
        |
        v
buildEstimatorEnsemble()       (UNCHANGED -- computes consensus from the six estimators, exactly as R1)
        |
        v
validateSkinCorrection(sample, ensemble.consensus, { neutralRegionResult })   <-- NEW, called from runWhiteBalanceEstimators() AFTER the ensemble exists
        |
        +-- extractValidatedSkinSamples(sample)          (skin-sample-validator.js)
        |         reuses isLikelySkinPixelYCbCr() on the SAME sample.accepted list
        |         rejects clipped / oversaturated / near-shadow candidates
        |
        +-- evaluateCorrectionPlausibility(acceptedPixels, consensus, opts)  (skin-correction-plausibility.js)
                  simulates the consensus correction on the validated pixels only
                  (pure, temporary, in-memory -- never touches Candidate)
                  scores before/after skin-band plausibility
        |
        v
skinValidation  (added to the returned bundle, alongside gray-world/white-patch/.../ensemble/objectBias/mixedLight)
        |
        v
[P1H] wb-evidence-extractor.js  reads wbEstimators.skinValidation when usable,
                                 replaces the R1 proxy skinConsistencyConfidence
```

`buildEstimatorEnsemble()` itself is completely untouched — `estimator-ensemble.js`
only adds a `try { validateSkinCorrection(...) } catch { UNAVAILABLE-shape }`
block and one new key on the return object. See `P1I_MULTI_ESTIMATOR_WB_ARCHITECTURE.md`
for how this fits the existing R1 diagram.

## 3. Sample extraction and rejection (skin-sample-validator.js)

The **same** pixel sample the six R1 estimators consumed (`sample.accepted`,
from `wb-pixel-sampler.js`) is reused — no second pixel scan. Candidate
skin pixels are found with `isLikelySkinPixelYCbCr(r,g,b)`, the one
canonical skin-chrominance classifier this codebase already uses
(`whitebalance-engine`'s `_skinRefinement()`, `neutral-region-estimator.js`,
and now this module — a fourth reuse, never a new formula).

Each candidate is then checked, in this priority order (each pixel
counted toward exactly one bucket):

1. **Clipped** (`isAnyChannelClipped`) — an unrecoverable highlight
   distorts any downstream color read regardless of its saturation,
   so this is checked first and is disqualifying on its own.
2. **Oversaturated** (`saturationOf(r,g,b) > SKIN_SAT_MAX = 0.62`) —
   catches colored/stage-light-on-skin cases that still pass the
   chrominance band (see Calibration below).
3. **Too close to the classifier's own shadow floor**
   (`luminance(r,g,b) < SKIN_SHADOW_LUM_MIN = 95`) — a second, stricter
   floor above `isLikelySkinPixelYCbCr()`'s own `Y > 80` requirement,
   because the narrow 80-95 band is close enough to the noise floor
   that a WB-correction simulation on it is not trustworthy, even
   though the classifier itself still calls it "skin."

If **zero** candidates exist at all (true deep shadow already excluded
by the classifier's own `Y > 80`, or the scene's skin — if any — falls
outside the Cb/Cr band entirely, e.g. strongly colored/magenta stage
light), the result is `UNAVAILABLE` with `rejectionReason:
NO_SKIN_DETECTED` and R1/P1H behavior is preserved exactly (see
§6 below).

If candidates exist but too few survive (`acceptedSkinPixels <
MIN_SKIN_SAMPLE_COUNT = 40`) or the surviving pixels are too spatially
concentrated (`spatialCoverageOf(...) < MIN_SKIN_SPATIAL_COVERAGE =
0.004`), the result is `UNAVAILABLE` with the corresponding rejection
reason. **The classifier being right about a pixel is not, by itself,
enough to trust it** — this is the required "don't trust every
YCbCr-classified pixel" behavior (spec item 3).

`sampleQualityConfidence` (0-1) is composed from three real,
documented terms — never a fixed number:

```
countFactor        = clamp(acceptedSkinPixels / (MIN_SKIN_SAMPLE_COUNT * 3), 0, 1)
coverageFactor      = clamp(spatialCoverage / (MIN_SKIN_SPATIAL_COVERAGE * 5), 0, 1)
cleanlinessFactor   = clamp(acceptedSkinPixels / candidateSkinPixels, 0, 1)
sampleQualityConfidence = 0.40*countFactor + 0.30*coverageFactor + 0.30*cleanlinessFactor
```

## 4. Calibration provenance (numbers were measured, not guessed)

Every threshold above was derived by running throwaway Node scripts
against the **real** production functions (`isLikelySkinPixelYCbCr`,
`saturationOf`, `luminance`, `isAnyChannelClipped`) over brute-force RGB
grids, per this project's calibration-before-coding convention:

- **`SKIN_SAT_MAX = 0.62`**: a brute-force scan of every RGB triple
  passing `isLikelySkinPixelYCbCr` showed natural, well-lit skin across
  the full light/medium/deep tone range tops out around 0.58
  saturation (computed via the same `saturationOf()` every other P1I
  estimator uses), while triples the chrominance band still admits but
  that are not skin-like (near-zero-blue olive tones, strongly colored
  gel light landing just inside the band) can reach saturation up to
  1.0. `0.62` sits just above the real skin ceiling and below the
  colored-light region, closing that gap.
- **`SKIN_SHADOW_LUM_MIN = 95`**: chosen as a deliberate second floor
  above the classifier's own `Y > 80`, verified by hand-computing YCbCr
  for near-shadow synthetic skin pixels in the 80-95 luminance band and
  confirming they still pass `isLikelySkinPixelYCbCr` (so this module,
  not the classifier, is responsible for excluding them).
- **`MIN_SKIN_SAMPLE_COUNT = 40` / `MIN_SKIN_SPATIAL_COVERAGE = 0.004`**:
  chosen in the same order of magnitude as the analogous thresholds
  already used by `neutral-region-estimator.js` for its own region
  acceptance, scaled for the 220x160 synthetic fixture geometry used in
  this round's test suite.
- **Magenta/stage-light skin (an "in-band, rejected-by-saturation"
  test case) does not exist as an RGB triple.** An exhaustive
  brute-force search over the 260-340 degree hue range against
  `isLikelySkinPixelYCbCr` found **zero** RGB triples that pass the
  classifier at all in that hue range — the classifier's own Cb/Cr band
  already excludes magenta before saturation filtering is ever reached.
  This is documented and accepted as the correct, even-stronger
  rejection path (see the test suite's magenta-stage-light case, which
  asserts `!isLikelySkinPixelYCbCr(...)` directly rather than forcing
  an artificial in-band example).

## 5. Ethnicity-neutral design (spec requirement, explicit)

No personal-attribute, ethnicity, or fixed-hue input exists anywhere in
either module. Both the sample validator and the plausibility scorer
operate only on the pixel's own `r,g,b` values through the **same**
documented Cb/Cr chrominance band `isLikelySkinPixelYCbCr()` already
uses across the codebase — a band wide enough to admit the realistic
range of human skin tones at a given lighting condition, not a single
target hue or reference tone. Static test coverage (R2 suite test 19)
strips comments before scanning for ethnicity-related identifiers, so
documentation prose describing the absence does not itself trip the
check — only executable code is scanned, and none is found.

## 6. Unavailability preserves R1/P1H behavior exactly

When `extractValidatedSkinSamples()` returns `UNAVAILABLE` (no skin
detected, or an insufficient sample), `validateSkinCorrection()` short-
circuits and returns `{status:'UNAVAILABLE', confidence:0,
plausibility:null, ...}` without ever calling
`evaluateCorrectionPlausibility()`. P1H's `wb-evidence-extractor.js`
treats this identically to a missing key — the R1 proxy formula
(`skinWarmth.confidence x skin coverage`) is used unmodified, and
`rawTemperature`/`rawTint`/every other P1H field is byte-identical to
R1 behavior (verified directly — R2 suite tests 21/26).

## 7. Never the sole estimator, never overrides

`validateSkinCorrection()`'s result never feeds `combineWeighted()`,
never appears in `ensemble.consensus`, and is never written to
`Candidate` by any code path (verified structurally — R2 suite test
20, a source-grep across every touched file for any Candidate-writing
call). Its only consumer is P1H's evidence extraction, which — per
`P1I_R2_SKIN_CORRECTION_PLAUSIBILITY.md` §5 — only ever nudges an
existing confidence value up (bounded) or down (bounded), never
assigns a raw Temperature/Tint of its own.
