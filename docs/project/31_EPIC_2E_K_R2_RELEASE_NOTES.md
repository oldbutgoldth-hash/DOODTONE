# 31 -- EPIC 2E-K-R2 Release Notes: Real Pixel Comparison & Browser Verification Closure

## 1. Release Identity

- **Feature:** Controlled V2 Calibration Lab -- Real Pixel Comparison
- **EPIC:** EPIC 2E-K-R2
- **Scope:** Preview/Shadow-only, same as R1. Does not change the
  displayed "AI Workflow" version badge (same reasoning as R1 -- this
  is an internal QA/calibration tool, not a photo-editor capability).
- **Production status:** Unchanged. Legacy Lightroom Mapping remains
  the sole production output path. Controlled V2 remains disabled in
  every workflow. XMP export remains byte-identical (production lock
  manifest: 65/65 locked files unchanged, 0 mismatches).

## 2. Scope

Per the user's request, this round covers exactly two things: (1)
replace the Calibration Lab's "same source image on both sides"
before/after placeholder with a genuinely pixel-differentiated Legacy
vs. Controlled V2 render, by reusing the production Visual Preview
Comparison pipeline rather than duplicating it; (2) attempt to close
out the Browser-suite verification that every prior round in this
project has left honestly open due to no Chromium being available in
this development sandbox. No Deploy action was taken. Controlled V2 was
not enabled in Production. Production Mapping and Production XMP
Output were not changed. EPIC 2E-L was not started.

## 3. What Was Added

- **Real pixel rendering** in the Calibration Lab's before/after
  slider: two `<canvas>` elements, painted by the exact same
  `createVisualPreviewComparisonControllerV2` /
  `renderIsolatedVisualPreviewV2` functions the main app's own preview
  feature uses, bound to the Calibration Lab's own canvases only. The
  same drag/keyboard slider interaction from R1 is preserved unchanged.
- A translated status line beneath the slider reporting each side's
  render state (`rendered`/`blocked`/`unavailable`/`failed`/`cancelled`)
  using only stable codes -- never raw English diagnostic prose.
- A bounded, session-scoped live-image cache
  (`core/calibration-lab/bounded-lru-cache.js`, a new pure module) that
  keeps up to 5 most-recently-touched images' decoded `<img>` + Render
  Plan in memory (never persisted) so Previous/Next navigation between
  recently-added images still shows real pixels, while a session
  resumed from storage (which never re-decodes the original photo)
  honestly shows an "unavailable in this session" message instead of a
  stale or fabricated preview.
- New Browser-suite assertions (in the existing
  `qa/epic-2e-k-calibration-lab-browser-test.mjs`) proving the two
  canvases exist and receive real backing pixel data for a just-added
  image, and that the honest fallback message appears after a
  Save-and-Restore round-trip.
- A new Node-executable static suite,
  `qa/epic-2e-k-r2-real-pixel-comparison-static-test.mjs` (34
  assertions), covering the pure LRU cache's behavior plus structural
  proofs that the transient Render Plan can never reach storage/export
  and that the reused rendering chain never touches XMP or
  Production-activation code.

## 4. Explicitly Not Changed

- `ui/app.js`, `ui/visual-preview-comparison-controller-v2.js`,
  `ui/isolated-visual-preview-renderer-v2.js`, and
  `core/preview-rendering/visual-preview-render-plan-v2.js` were READ
  (imported/called) by this round's changes, never modified --
  confirmed via direct diff against the R1 baseline copy.
- No production flag changed: `controlledV2Apply`, `productionWrite`,
  `previewExport`, `controlledTestActivation`, and
  `controlledV2ProductionActivation` remain hardcoded `false`.
- Nothing was deployed.
- EPIC 2E-L was not started, per explicit instruction.

## 5. Modified / New Files

| File | Nature of change |
|---|---|
| `core/calibration-lab/bounded-lru-cache.js` | **New.** Pure, generic bounded LRU cache (no DOM dependency). |
| `core/calibration-lab/run-comparison-pipeline.js` | Additive: return value gained `renderPlanForPixelPreviewTransientOnly` (transient-only, documented, never persisted). |
| `ui/calibration-lab/calibration-lab-controller.js` | Additive: bounded live-image cache (`getPixelPreviewInput`, `clearPixelPreviewCache`), wired into `addImage`/`startNewSession`/`openSession`/`clearAllData`/`endSession`. `addImage()` gained an optional `objectUrl` parameter. |
| `ui/calibration-lab/calibration-lab-renderer.js` | The before/after view now renders two real `<canvas>` elements via the reused production controller instead of two `<img>` clones; `close()`/re-render dispose the pixel-compare controller instance correctly. |
| `ui/calibration-lab/calibration-lab-i18n.js` | Additive: new `pixelPreview` namespace (EN+TH), plus an explicit coverage check for it. |
| `qa/epic-2e-k-calibration-lab-browser-test.mjs` | Additive: new Real Pixel Comparison assertions; `SOURCE_HASH_INPUTS` extended. |
| `qa/epic-2e-k-r2-real-pixel-comparison-static-test.mjs` | **New.** 34-assertion static suite (section 4 of the R2 QA report). |
| `qa/run-static-suites.mjs` | Registered the new static test file. |
| `qa/phase-c-suite-source-manifest.mjs` | `calibrationLabBrowser` manifest entry extended with the 4 newly-reused/new source files. |

No file outside `core/calibration-lab/`, `ui/calibration-lab/`, and
`qa/` was modified. `index.html` was **not** touched this round (R1's
nav button/mount div/script tag are unchanged and sufficient).

## 6. Tests Performed (real, see QA report for full detail)

- `qa/epic-2e-k-r2-real-pixel-comparison-static-test.mjs`: 34/34 PASS
- All 3 pre-existing Calibration Lab suites re-verified against the R2
  code with zero regressions: 61/61, 16/16, 19/19 PASS
- `node tools/esm-syntax-gate.mjs`: 166/166 PASS
- Full `node qa/run-static-suites.mjs`: all static suites PASSED
- Production-lock SHA-256 re-verification: 65/65 unchanged, 0
  mismatches

## 7. Tests Not Performed (honest, environment-blocked)

- The actual Browser-rendered pixel comparison
  (`qa/epic-2e-k-calibration-lab-browser-test.mjs`, including this
  round's new Real Pixel Comparison assertions) could not be executed:
  no Chromium binary is present, and a live download attempt via
  `npx playwright install chromium` was explicitly blocked by this
  sandbox's network allowlist (`403 Connection blocked by network
  allowlist`). This is the same class of constraint every prior round
  has hit, now additionally confirmed to be network-level, not merely
  "binary absent."

## 8. Known Limitations

- **Live pixel preview is session- and recency-bounded.** Only the 5
  most-recently-touched images (within the current runtime, since the
  page was last loaded/the session last opened) can show a real
  pixel-rendered comparison; anything else honestly falls back to the
  translated "unavailable in this session" message. This is a
  deliberate, disclosed bound, matching this project's established
  "bounded, never unlimited" convention for this feature.
- **Browser verification remains genuinely open** (section 7) --
  unlike prior rounds, this is now confirmed to be a network-allowlist
  restriction in this specific sandbox, not merely an absent local
  binary; running on a different machine/sandbox with real
  Chromium/network access should resolve it without further code
  changes.
- All Known Limitations carried over from R1 that are NOT addressed by
  this round (schema migration scaffold still empty, version badge not
  bumped, the pre-existing R1 documentation-drift note) remain as
  described in `28_EPIC_2E_K_RELEASE_NOTES.md`.

## 9. Next Development Boundary

- Run `qa/epic-2e-k-calibration-lab-browser-test.mjs` (and ideally the
  full `node tools/local-gate.mjs`) on a machine with real Chromium and
  outbound network access, to genuinely close out Browser verification
  for both R1 and R2 functionality together.
- EPIC 2E-L, if/when scoped, should NOT be started as part of this
  round (explicit instruction) -- this document intentionally stops
  short of proposing its scope.
- Deciding Controlled V2's actual production readiness remains entirely
  out of scope for this Lab, per R1's Section 12/13 design (the
  Readiness Report can never return `PRODUCTION_READY`, and this holds
  unchanged after R2).

## 10. Rollback Notes

Reverting R2 alone (keeping R1) is a pure subtraction: delete
`core/calibration-lab/bounded-lru-cache.js` and
`qa/epic-2e-k-r2-real-pixel-comparison-static-test.mjs`; revert the
additive edits to `run-comparison-pipeline.js`,
`calibration-lab-controller.js`, `calibration-lab-renderer.js`,
`calibration-lab-i18n.js`, `qa/run-static-suites.mjs`, and
`qa/phase-c-suite-source-manifest.mjs`, and the `SOURCE_HASH_INPUTS`/new
assertions in `qa/epic-2e-k-calibration-lab-browser-test.mjs`. No
production file requires any reversal because none was changed.

## 11. Release Decision

**CONDITIONAL PASS**, matching R1's own standing decision: all
Node-executable verification passes (130 assertions across 4 suites, 0
failures); production locks structurally and hash-verified unchanged;
the Browser-rendered pixel comparison itself is written and ready but
requires a real Chromium/network-capable environment to execute, which
this sandbox does not have.
