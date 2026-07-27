# EPIC 2E-K-R2-FIX2 — Calibration V2 Preview Architecture, Pixel Evidence Schema, Browser Detection Contract

## 1. Scope

FIX2 closes the 10 bugs reported against FIX1's Calibration Lab: Controlled
V2 never rendered real pixels; Save Result could persist
`userDecision=NOT_REVIEWED`; `reviewedAt`/Notes were created/persisted on a
blocked Save; `browserVerified` could be `true` with an empty V2 canvas;
`previewTruthCode` could contradict a genuinely-rendered Legacy canvas
(`LEGACY_RENDER_FAILED` despite real pixels); the Blocker reason could
name `V2_RENDER_FAILED` when the real cause was Sandbox/Plan
ineligibility; the Browser Detection contract had three different,
mutually-incompatible property names across three call sites; the Browser
suite reported `BROWSER_BINARY_UNAVAILABLE` even when a real binary
existed; and the Browser Test used OR-shortcut conditions that let
unknown/blocked/failed states silently pass.

**Absolute constraints held throughout:** EPIC 2E-L not started, no
Deploy, Controlled V2 Production not enabled, Production Mapping/XMP
Output unchanged, Global Human Review / Production Activation Gate
untouched.

## 2. Calibration-only Controlled V2 Preview Plan (Section 1)

`core/calibration-lab/build-calibration-v2-preview-plan.js` (NEW) builds
a genuinely eligible V2 preview plan for the Calibration Lab *only*, by
calling the exact same, unmodified `buildControlledOverlayPreviewSandboxV2()`
and `buildVisualPreviewRenderPlanV2()` Production itself calls — no new
editing algorithm, no change to the Global Sandbox.

**Root cause it fixes:** the Calibration Lab always passed
`controlledPreviewReviewStateV2: null` (it has no Human Review workflow),
so the Sandbox's `human-review-complete` gate never passed and V2 was
permanently unrenderable regardless of image safety. The fix is a single
supported override: `flags: { requireHumanReviewForPreview: false }` —
this disables a *workflow-completion* gate (did a human click approve?),
never a *safety* gate. Every other required check (no hard stops, no
critical over-stack, Overlay Simulation present, Safety Clamp present,
source fingerprint/generation stamped) runs exactly as Production
evaluates it.

**Hard-coded, never-derived safety fields** on every returned plan,
regardless of upstream data: `previewOnly: true, exportEligible: false,
appliedToProduction: false, productionWrite: false, productionSource:
'legacy'`. `isCalibrationPlanProductionSafe(plan)` is the structural guard
hostile tests use to confirm this; it is a genuine field-by-field check
(hostile-tested with forged plan shapes), not a rubber stamp.

Contract shape: `{mode:"CALIBRATION_PREVIEW_ONLY", available, renderable,
adjustmentModel, sourceGenerationId, sourceFingerprint, safetyVerified,
noHardStops, noCriticalOverstack, previewOnly, exportEligible,
appliedToProduction, productionWrite, productionSource, reasons,
warnings, renderPlanForPixelPreview}`. `renderPlanForPixelPreview` is
transient-only (no field for it on `schema.js`'s `createImageTestRecord()`
— no path to storage/export).

## 3. Real Controlled V2 canvas render (Section 2)

`run-comparison-pipeline.js` now builds the Calibration V2 Preview Plan
per image and feeds its `renderPlanForPixelPreview` to the existing
isolated pixel renderer (same call the FIX1 Real Pixel Comparison already
used for Legacy) — no CSS filter, no duplicate source image, no fake
pixel hash, no placeholder canvas, no Production XMP rendering path
touched.

## 4. Pixel Hash for opaque-origin harnesses (Section 3)

`core/calibration-lab/sha256-pure-js.js` (NEW): `sha256PureJsHex(bytes)`,
a standard FIPS 180-4 SHA-256 implementation (64 round constants, 8
initial hash words, correct multi-block padding), used when
`crypto.subtle` is unavailable (an `about:blank` opaque-origin harness is
not a Secure Context). Verified byte-identical to Node's own `crypto`
module across the official NIST known-answer vectors and an 800×600×4
real canvas buffer (see `qa/epic-2e-k-r2-fix2-hostile-closure-test.mjs`).
New field `pixelHashVerificationMode`: `WEB_CRYPTO_SHA256 |
PURE_JS_SHA256 | HASH_UNAVAILABLE`.

`browserVerified` is now computed honestly in
`core/calibration-lab/pixel-truth-capture.js`: true only when both
sides' hash is valid, both sides' pixel count is > 0, source/generation/
geometry all match, and both canvases genuinely rendered — never merely
from `document`/`OffscreenCanvas` existing.

## 5. Preview Truth Classification reorder (Section 4)

`core/calibration-lab/preview-evidence.js`'s `classifyPreviewTruth()` now
follows a strict 12-step order (Source Available → Generation Current →
Fingerprint Match → Legacy State Rendered → Legacy Pixel Count → Legacy
Hash Verified → Calibration V2 Plan Available → V2 State Rendered → V2
Pixel Count → V2 Hash Verified → Same Geometry → Pixel Difference/
Identity). The key architectural change is `_sideStructuralStatus()`,
which separates "did this side genuinely render real pixels" (state +
geometry + count + not-default-blank) from "was the hash cryptographically
verified" — returning one of `'FAILED' | 'UNVERIFIED_HASH' | 'OK'`. A
`null` hash (an infra gap) now maps to `PIXEL_HASH_UNAVAILABLE`, never
`LEGACY_RENDER_FAILED`, while a forged/inconsistent hash still correctly
fails (hostile-test guarantee preserved — see
`qa/epic-2e-k-r2-fix2-hostile-closure-test.mjs`).

Four new stable codes added to `PREVIEW_TRUTH_CODES` (10 → 14):
`PIXEL_HASH_UNAVAILABLE`, `CALIBRATION_V2_PLAN_UNAVAILABLE`,
`CALIBRATION_V2_PLAN_BLOCKED`, `CALIBRATION_V2_RENDER_FAILED`.

## 6. Evidence fields + dynamic blocker (Section 5)

`buildPreviewEvidence()` now carries 6 new fields:
`calibrationV2PlanAvailable`, `calibrationV2PlanRenderable`,
`calibrationV2PlanMode`, `pixelHashVerificationMode`,
`legacyHashVerified`, `controlledV2HashVerified`. All optional/backward-
compatible (an `undefined` value skips the new classification branches,
so pre-FIX2 hostile-test fixtures keep passing unmodified).

`deriveUiBlockerReasonCode(previewEvidence)` **no longer accepts a second
argument** — the previous hard-coded
`deriveUiBlockerReasonCode(evidence, {v2RenderPlanAvailable: true})`
call sites (Controller, Renderer ×2) are gone; the function now reads
the real `calibrationV2PlanAvailable`/`calibrationV2PlanRenderable`
fields directly. Hostile-tested: calling it with a fake second argument
today has zero effect on the output (see
`qa/epic-2e-k-r2-fix2-hostile-closure-test.mjs`).

## 7. Save Result Gate (Section 6)

`ui/calibration-lab/calibration-lab-controller.js`'s `saveCurrentDecision()`
now rejects `userDecision === 'NOT_REVIEWED'` with `DECISION_REQUIRED`,
checked *before* the pre-existing Decision Eligibility Gate
(`DECISION_NOT_ELIGIBLE`, unchanged from FIX1). A rejected save mutates
nothing: record, notes, issueCodes, `reviewedAt`, and session counters
are all left exactly as they were. `clearCurrentAnswer()` is unaffected —
it never calls `saveCurrentDecision()` and may still legitimately set
`NOT_REVIEWED` directly.

`ui/calibration-lab/calibration-lab-renderer.js`'s Save Result button now
mirrors the Decision Chips' own evidence check: disabled (`disabled`,
`aria-disabled="true"`) whenever `previewEvidence.visualDecisionEligible
!== true`, using the identical flag the chips already use — never a
second, divergent condition.

## 8. Browser Detection Contract (Section 7)

`qa/helpers/playwright-lumixa-test-runtime.mjs`'s `detectBrowserExecutable()`
now always returns `{found, executablePath, available, versionOutput,
attempts}` where `executablePath === found` and `available ===
Boolean(found)` — both fields are new, `found` is unchanged. Every
caller (`qa/preflight.mjs`, `qa/epic-2e-k-calibration-lab-browser-test.mjs`)
already read `executablePath`/`available` respectively; only the
producer was wrong before. Windows Chrome/Edge candidate paths
(`process.platform === 'win32'`) were added alongside the existing Linux
paths for parity with `RUN_LUMIXA_CALIBRATION_QA_WINDOWS.bat`'s own
detection. Verified with a real (non-mocked) executable file in both the
"not found" and "found" cases — see
`qa/epic-2e-k-r2-fix2-browser-contract-static-test.mjs`.

## 9. Preflight fail-closed fixes (Section 8)

`qa/preflight.mjs` no longer imports `{ chromium } from 'playwright'` at
the top level (which would crash the entire script with
`ERR_MODULE_NOT_FOUND` before any check could report). It now calls
`detectPlaywrightPackage()` (a dynamic `await import('playwright')`,
already fail-closed) and reports genuine `PLAYWRIGHT_PACKAGE_AVAILABLE`/
`PLAYWRIGHT_PACKAGE_UNAVAILABLE` and `BROWSER_BINARY_AVAILABLE`/
`BROWSER_BINARY_UNAVAILABLE` statuses. Any Required item that is
Missing/NOT_VERIFIED already produced a non-zero exit code (unchanged);
`RUN_LUMIXA_CALIBRATION_QA_WINDOWS.bat`'s Step 4 previously downgraded
that non-zero exit to a mere `[WARN]` and left `OVERALL_FAIL` untouched —
this is fixed: a non-zero Preflight exit now sets `OVERALL_FAIL=1`.

## 10. Real Pixel Comparison strict classification (Section 9)

`qa/helpers/real-pixel-comparison-decision.mjs` (NEW): a pure, Node-
testable `classifyRealPixelComparisonResult()` factored out of the
Browser Test specifically so its decision logic can be hostile-tested
without a real Chromium runtime. Replaces the OR-shortcut pattern
(`!v2ClaimsRendered || pixelsAreValid`, trivially true for any non-
`'rendered'` state) with a positive, all-of proof for
`RENDERED_PROOF_PASS`, and a separate, honestly-gated `HONEST_BLOCKED`
verdict for a genuine non-render outcome whose `previewTruthCode`
independently confirms it (never merely because `v2State !== 'rendered'`).
Any other combination is `FALSE_CLAIM_FAIL` (a claim of `'rendered'`
that fails the strict proof) or `INDETERMINATE_FAIL` (neither a proven
pass nor a recognized honest block) — both are hard FAILs, never a
silent pass. See `qa/epic-2e-k-r2-fix2-real-pixel-decision-static-test.mjs`
for the full hostile matrix (49 assertions).

## 11. 4-fixture closure (Section 10)

`qa/epic-2e-k-calibration-lab-browser-test.mjs` now runs the Real Pixel
Comparison check against all 4 required fixtures (`neutral-balanced.png`,
`warm-portrait-synthetic.png`, `cool-shadow-synthetic.png`,
`highlight-shadow-range.png`) via a shared `runRealPixelComparisonCheck()`
helper, and asserts the release closure bar explicitly: at least 2 of 4
fixtures must reach `RENDERED_PROOF_PASS`.

## 12. Runtime assertions (Section 11)

Extended with: Save Result button disabled state exactly matches its own
`data-cal-save-eligible` flag; `aria-disabled="true"` when ineligible; a
direct (UI-bypassing) `saveCurrentDecision({userDecision:'NOT_REVIEWED'})`
call is rejected with `DECISION_REQUIRED` and mutates nothing. All
written against the real running app; genuinely exercised only on a
machine with real Chromium (see Known Limitations in the Release Notes).

## 13. Production Safety (Section 12)

Verified via direct `diff` against the untouched FIX1 seed (`EP53A9~1`):
`core/lightroom-mapping-engine/index.js`, `core/xmp-validator/index.js`,
`core/preset-engine/index.js`, `ui/app.js`, `ui/ui-engine.js`,
`core/decision-engine/index.js`,
`core/preview-rendering/visual-preview-render-plan-v2.js`, and
`core/lightroom-mapping-engine/mapping-v2-overlay-preview-sandbox.js` are
all byte-identical — zero drift. `productionSource=legacy`,
`productionWrite=false`, `controlledV2Apply=false`, `previewExport=false`
remain hard-coded in `getQaSnapshot()`, unchanged.
