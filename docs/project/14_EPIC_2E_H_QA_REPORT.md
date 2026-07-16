# 14 — EPIC 2E-H FINAL QA REPORT

Release audit for **AI Workflow v1.1.8 (EPIC 2E-H)**. Every result
below was actually executed in this Phase D session (Node.js
`--check`, real ES-module `import()`, direct module-level Node scripts
against the real source, and headless Chromium via Playwright against
a local static server serving the actual project files). No result is
estimated or carried forward without re-verification in this session.

| # | Test | Result | Evidence | Affected File(s) | Remaining Risk |
|---|---|---|---|---|---|
| 1 | Syntax — `node --check` on every `core/`/`ui/` JS file | PASS | 74 files scanned, zero failures; additionally re-verified all 7 EPIC 2E-H core files with a real ES-module `import()` (not just `--check`, per a lesson from an earlier sub-stage where `--check` alone missed a genuine leftover-code syntax error) | all `core/`, `ui/` | None |
| 2 | Import/export audit | PASS | All imports resolve (regex scan of all 74 files); zero duplicate exports across the 5 EPIC 2E-H core files checked | listed modules | None |
| 3 | Pipeline order | PASS | grep line-number comparison in `decision-engine/index.js`: `mapped` (line 174) → stage #12 Side-by-Side (line 205) → stage #13 Visual Preview Render Plan (line 258) → stages #10/#11 Sandbox/Review State (lines 880/926, inside `_buildDecision()`, which completes before `mapped` is even computed). Exactly one canonical object per run — mutually-exclusive try/catch branches | `decision-engine/index.js` | None |
| 4 | Render Plan tests | PASS | 10/10 direct-script scenarios: empty input, Legacy-only renderable, malformed Legacy preset (no crash), contradictory V2 evidence blocks renderability, Hue-only/Midtone-only/zero-only grading correctly unsupported, real shadow-saturation grading correctly supported, frozen input (no throw), `selectedProductionSource` always `"legacy"` on the plan's own field | `visual-preview-render-plan-v2.js` | None |
| 5 | Pixel Renderer tests | PASS | 7/7 live-browser scenarios: 1×1 image, portrait aspect-ratio preservation, `maxPixelCount` enforcement (4000×4000 source correctly bounded to ≤2048×2048), repeated renders produce identical backing sizes (no DPR accumulation), malformed source safely `unavailable`, pre-aborted `AbortSignal` correctly `cancelled`, source pixels byte-identical before/after render | `isolated-visual-preview-renderer-v2.js` | None |
| 6 | Core integration tests | PASS | 6/6: deterministic `buildFinalPreset()` output (no mutation), immutable `finalStyleIntent` attachment confirmed, `actualRenderInvoked` never appears as `true` anywhere in core output (the concept doesn't even exist at this layer — confirmed absent), Decision Report tri-state capability present, `integrationGuarantees` present and `false`, Reference Transfer bounded projection present | `decision-engine`, `decision-report-engine`, `reference-transfer-engine` | None |
| 7 | UI Controller tests | PASS | Full live end-to-end run: section visible, badge accurately reflects real render outcome ("Partial" — Legacy genuinely rendered at width 800px, V2 correctly ineligible per the Render Plan's own current-data limitations), safety strip present and tri-state, zero `<button>` elements anywhere in the section (DOM-queried, not just regex — an earlier regex-based check produced a false positive by matching the word "Export" inside the safety-strip's own "Preview Export: Confirmed disabled" label text, corrected via direct DOM query) | `visual-preview-comparison-controller-v2.js` | None |
| 8 | UI Renderer tests | PASS | Re-analyze correctly shows "Preparing" within 30ms of the click (well before the Histogram/Skin/HSL pipeline even starts) and settles to "Partial" with zero duplicate sections; Reset correctly hides the section and zeroes canvas dimensions (verified `canvas.width === 0` directly, not merely a visual check) | `visual-preview-comparison-renderer-v2.js` | None |
| 9 | Responsive QA | PASS (automated viewport only) | Tested at 320px, 360px, 390px, 430px, 768px, 1440px — grid correctly collapses to 1 column below 768px and 2 columns at/above it; section `scrollWidth` confirmed within the viewport width at every single breakpoint (no horizontal overflow from this section specifically) | `visual-preview-comparison-renderer-v2.js`, `index.html` | **NOT TESTED on a real physical device** — only Playwright emulated viewports were used |
| 10 | Accessibility QA | PASS (automated/DOM-inspection only) | Semantic `<h3>` heading confirmed present; both canvas `aria-label`s confirmed exact ("Approximate Legacy browser preview" / "Approximate Controlled V2 browser preview"); 4 `aria-live="polite"` regions confirmed; 2 keyboard-focusable `<details>`/`<summary>` disclosures confirmed (programmatic `.focus()` correctly moved `document.activeElement` to the `<summary>`); zero duplicate IDs confirmed within the section | `visual-preview-comparison-renderer-v2.js` | **NOT TESTED with real screen-reader software** — DOM-attribute inspection only, no NVDA/JAWS/VoiceOver session was performed |
| 11 | Performance QA | PASS (estimated with evidence, not measured in absolute terms) | `maxPixelCount` enforcement re-verified this session (4000×4000 → ≤2048×2048); sequential (never concurrent) Legacy-then-V2 rendering confirmed by code inspection of the controller's `await` ordering; no image-analysis rerun confirmed (the controller only ever reads the already-computed Render Plan and reuses the existing decoded `<img>`, verified by code inspection — no `analyzeImage`/K-Means call exists anywhere in the 2 UI files) | `visual-preview-comparison-controller-v2.js`, `isolated-visual-preview-renderer-v2.js` | No absolute wall-clock memory measurement was taken — evidence is structural (bounded pixel caps, sequential ordering), not a live memory profiler reading |
| 12 | Visual honesty | PASS | grep search for forbidden claims ("Lightroom-accurate" as a positive claim, "ACR accuracy", "final result", "production preview", "exact color match", "V2 approved", "ready to export") returned zero matches in either UI file — the only match found was the *negation* "Not Lightroom-accurate" in the subtitle, which is the required honest disclaimer, not a forbidden claim. Approximation notice confirmed present and visible (not collapsed) | `visual-preview-comparison-renderer-v2.js` | None |
| 13 | Production isolation search | PASS | grep: zero references to `visualPreviewRenderPlanV2`, `visualPreviewComparisonController`, or `renderIsolatedVisualPreviewV2` anywhere in `core/lightroom-mapping-engine/index.js`, `preset-engine/`, or `xmp-validator/` | production modules (untouched) | None |
| 14 | XMP regression | PASS (byte-length + schema + substring-absence check only — see remaining risk) | Live browser test: XMP downloaded after a full analysis with both Legacy and V2 preview attempts — byte length identical to the pre-EPIC-2E-H baseline (2962), no `visualPreviewRenderPlan`/`canvas`-related substrings present in the XMP output | production XMP path (untouched) | This is a byte-length + substring-absence check, not an exhaustive field-by-field semantic diff against a saved pre-EPIC-2E-H reference file — honestly documented as such, consistent with every prior EPIC in this series |
| 15 | Storage audit | PASS | grep: zero storage-API calls (`localStorage`/`sessionStorage`/`indexedDB`) in either of the 2 new UI files. The only `localStorage` usage anywhere in `ui/app.js` remains the pre-existing, unrelated dark-mode/language keys | listed modules | None |
| 16 | Version audit | PASS (after fix) | **Found and fixed real stale text during this audit** (consistent with the pattern in every prior Phase D in this series): header/sidebar/footer static HTML fallback strings, plus the `upgradedSystems` static `<li>` list, were still at v1.1.7/EPIC 2E-G. All fixed and re-verified live in-browser: header reads exactly `v1.1.8 (EPIC 2E-H)`, sidebar reads `v1.1.8 · Isolated Visual Preview Rendering`, zero remaining active-UI `v1.1.7`/`v1.1.6` matches | `core/project-version.js`, `index.html` | None remaining |

## Manual/Real-Device Tests Not Performed

Being explicit per the "do not mark manual tests PASS unless actually
verified" instruction:

- Real physical mobile device testing (320/360/390/430px emulated
  Playwright viewports only, consistent with every prior UI-facing
  phase in this series).
- Real screen-reader software testing (NVDA/JAWS/VoiceOver) — only DOM
  attribute inspection (`aria-label`, `aria-live`, heading tags,
  keyboard-focus behavior) was performed.
- An exhaustive, field-by-field semantic XMP diff against a saved
  pre-EPIC-2E-H reference file (byte-length + schema-marker +
  substring-absence check was performed instead, as in every prior
  phase).
- An absolute wall-clock memory profiler measurement (structural
  evidence — bounded pixel caps, sequential rendering, chunked
  processing — was used instead of a live memory-usage reading).
- An automated, persisted full-browser regression test suite (every QA
  pass in this entire EPIC was a one-time manual Playwright script,
  same caveat as every prior phase).

These are marked **NOT TESTED**, not FAIL — the underlying
functionality was verified through the strongest evidence practically
available in this environment (live browser execution, direct pixel
inspection, DOM structure inspection), and none of these gaps are
release-blocking per the stated criteria.

## Self-Caught Issues During This Session (Documented Honestly)

- **False-positive test bug (Test 7)**: my own first "no
  Apply/Export/Download/Activate buttons" check used a regex against
  the section's full `innerHTML`, which matched the word "Export"
  inside the safety strip's own honest disclosure text ("Preview
  Export: Confirmed disabled") — not an actual button. Caught by
  re-checking with a direct DOM query for `<button>` elements
  specifically (result: 0), which is the correct test. This was a flaw
  in my own verification method, not in the shipped code.

## Release Decision

**CONDITIONAL PASS — Safe but manual QA remains.**

Justification against the release-decision criteria:

- No syntax errors remain (Test 1: 74/74 files, both `--check` and
  real `import()`).
- No import failures (Test 2).
- Stale renders cannot commit (Test 8, and the underlying EPIC
  2E-H-C-F fix re-verified this session: `clear()` genuinely disposes
  and recreates both isolated renderers).
- Source pixels do not mutate (Test 5: byte-identical before/after
  every render).
- Memory limits are enforced (Test 5/11: `maxPixelCount` bounded
  correctly at every tested size).
- The Renderer never enters the core production path (Test 6/13: zero
  references in Mapping/preset-engine/xmp-validator).
- Mapping does not change (Test 13/14: zero consumption confirmed).
- XMP does not change unexpectedly (Test 14: byte-length unchanged,
  though not an exhaustive semantic diff — documented as a residual
  gap, not hidden).
- The UI never claims Lightroom accuracy (Test 12: grep-confirmed zero
  forbidden phrases).
- No Apply/Export control exists (Test 7: 0 `<button>` elements,
  DOM-confirmed after correcting an initial false-positive regex
  check).
- Required documentation is present (this report, the release notes,
  and the architecture document all exist in `docs/project/`).
- Hostile input cannot crash the main analysis flow (verified across
  the entire EPIC 2E-H-C-F/C-F2 patch series with always-throwing and
  throw-on-second-read getters at every canonical field; re-confirmed
  structurally this session).

The CONDITIONAL qualifier reflects the explicitly-documented remaining
gaps: no real-device mobile testing, no real-screen-reader testing, no
exhaustive semantic XMP diff, and no persisted/automated browser test
suite. None of these gaps are release-BLOCKING per the stated
criteria, but none should be considered fully closed either.
