# EPIC 2E-P0.8A — QA Report

## 1. Full static/structural suite gate

`node qa/run-static-suites.mjs` — **60/60 suite files PASS**, 0 FAIL
(every prior round's suite, EPIC 2E-I through EPIC 2E-P0.7-R6, re-run
unmodified and still passing, plus this round's new suite). Exit code 0.

## 2. This round's new suite in detail

`qa/epic-2e-p0-8a-preview-artifact-repair-static-test.mjs` —
**22/22 PASS, 0 FAIL**:

| # | Assertion | Result |
|---|---|---|
| 1-2 | Float LUT resolution ≥1024 + true fractional-x interpolation | PASS |
| 3 | Smooth-step interpolation proof (no LUT-quantization staircase, max step delta <1.0) | PASS |
| 4 | Hostile: old hard-bucket `channelForHue()` no longer exists | PASS |
| 5-6 | Gaussian hue-weight imports/table wired in; loop iterates all 8 channels | PASS |
| 7 | **Quantified block-artifact regression**: max adjacent-pixel jump <20 (measured **6**) vs. reconstructed old-code **226** | PASS |
| 8-9 | Calibration now measurably applied (diff=14); `cal_*` fields referenced in loop | PASS |
| 10-11 | Skin protection functional (skinDiff=8.767 < nonSkinDiff=24.957); continuous, not boolean | PASS |
| 12 | White protection functional (whiteDiff=5.149 < midDiff=9.092) | PASS |
| 13-14 | Chroma-shift safety limit present; stacked-saturation output stays bounded [255,68,25] | PASS |
| 15-18 | `DEFAULT_PREVIEW_MAX_WIDTH` raised; explicit high-quality smoothing; `_previewRenderWidthFor` defined and used at all 3 call sites | PASS |
| 19 | Every render call uses `image: rcm.targetImg` (original source, never a proxy) | PASS |
| 20 | Neutral preset still produces 0 changed pixels (identity preserved) | PASS |
| 21 | `metrics` field contract preserved (all 15 pre-existing fields present) | PASS |

## 3. Pre-existing regression suites, individually re-confirmed

- `qa/epic-2e-n4-preview-evaluation-static-test.mjs` (the direct
  pre-existing regression suite for this round's central file):
  **5/5 PASS**, file itself unmodified.
- `qa/epic-2e-p0-7-r5-*` (2 files), `qa/epic-2e-p0-7-r6-*` (2 files) —
  all individually re-run within the full suite, all still PASS,
  confirming Intensity cache repair, Preview State Machine, and
  Fast/Refined critical-path separation are untouched by this round's
  changes.

## 4. Full local gate (`npm run test:local-gate`)

| Step | Name | Result |
|---|---|---|
| 1 | ESM syntax | **PASS** |
| 2 | Focused Core smoke | **PASS** |
| 3 | Static suites (all 60) | **PASS** |
| 4-14 | Browser-dependent suites (In-Memory startup, Upload baseline, Live App, Observation Smoke, Step 7B-A/B, Decoder/Full-app geometry, Controlled V2, i18n, Calibration Lab) | **FAIL — `BROWSER_BINARY_UNAVAILABLE`** |

Steps 4-14 fail for the same, pre-existing, environment reason every
prior round in this project's history has hit: no Chromium binary and
(this round specifically) no installed `playwright` npm package in this
fresh working copy. This is an environment limitation, not a P0.8A
regression — confirmed by checking that these exact same steps fail
the same way against the unmodified R6 baseline in this same sandbox.
The local gate's own fail-closed design correctly reports overall
`LOCAL GATE: FAIL` rather than silently passing — this is the intended,
honest behavior, not a bug.

## 5. Real-image Chromium QA (P0.8A-specific)

`node qa/epic-2e-p0-8a-real-image-artifact-browser-test.mjs`:

```json
{
  "suite": "EPIC 2E-P0.8A — Preview Rendering Artifact Repair Browser Test",
  "completed": false,
  "decision": "REAL_IMAGES_UNAVAILABLE",
  "reason": "Reference and Target real photograph file(s) not found...",
  "pass": 0, "fail": 0, "total": 0
}
```

**Status: NOT EXECUTED.** Two independent blockers, both confirmed
directly (not assumed): (a) no real Reference/Target photograph files
are present anywhere in this sandbox — the only recent image upload
available in this session was re-checked and is the same blank
"Image Analysis Core" loading screenshot carried over from the prior
R6 conversation, not a posterized result or a usable Reference/Target
pair; (b) the `playwright` npm package is not installed in this fresh
`r1_work` copy's `node_modules` (confirmed via a direct
`import('playwright')` check that raised `Cannot find package`).

Per the user's own explicit instruction ("Start the code audit now,
image later") this was accepted as the working scope for this delivery
— the fix and its quantified synthetic proof were completed now, and
the real-image test is delivered ready to run once real files and a
Playwright/Chromium install are available. **This suite intentionally
fails closed rather than fabricating a PASS or substituting a synthetic
image for the required real-image acceptance test.**

Consequently, the 6 required Intensity sweep points (0/25/50/60/75/100)
also could not be captured against a real photograph in this session —
see `EPIC_2E_P0_8A_BEFORE_AFTER_QA.md` for what synthetic, quantified
evidence IS delivered in its place, and `EPIC_2E_P0_8A_KNOWN_LIMITATIONS.md`
for exactly how to complete this once real files/environment are
available.

## 6. Production Lock verification

Re-verified two ways:
1. **Direct file diff** — all 9 named production-critical files
   (`core/lightroom-mapping-engine/index.js`, `core/xmp-validator/index.js`,
   `core/preset-engine/index.js`, `ui/app.js`, `ui/ui-engine.js`,
   `core/decision-engine/index.js`,
   `core/preview-rendering/visual-preview-render-plan-v2.js`,
   `core/lightroom-mapping-engine/mapping-v2-overlay-preview-sandbox.js`,
   `index.html`) confirmed **byte-identical** to a fresh extraction of
   the R6 seed ZIP via `diff -q`.
2. **Field verification** — `productionSource = "legacy"`,
   `productionWrite = false`, `controlledV2Apply = false`,
   `xmpWriteAllowed = false`, `productionActivationAllowed = false`
   all confirmed present and unchanged in their source locations.
3. **Manifest regeneration** — `qa/baselines/lufa42-production-lock-manifest.json`
   regenerated (132 files, same count as R6), the expected side effect
   of this round's 3 intentional file edits, matching this project's
   standing convention.

## 7. Overall gate decision for THIS delivery

**Code-level fix: verified complete** (60/60 static suites, 22/22
new assertions, Production Lock intact, quantified root-cause proof).
**Real-photo acceptance test: NOT_VERIFIED, blocked on environment/file
availability, not on the fix itself.** Per the spec's closing
constraint, this delivery does not claim "no posterization visible in
the attached real-image test" as satisfied — it could not be attached
or tested. It claims the specific, named, quantifiable defect has been
fixed and proven on a purpose-built reproduction of that exact defect
class, with the real-image test ready to confirm it end-to-end as soon
as real files are available.
