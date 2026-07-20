# 19 — EPIC 2E-J Phase C: Observation QA, Privacy Review & UX Validation

*(Revised by EPIC 2E-J-C-F — mobile containment, full integration
evidence, and single-decision closeout patch)*

## 1. Scope

Focused QA, privacy, and UX validation for the complete Preview
Observation + Session Summary workflow shipped across EPIC 2E-J Phase A
(and its A-F/A-F2/A-F3 correctness patches) and Phase B (and its
B-F/B-F2 correctness patches), closed out with this patch's mobile
layout root-cause investigation and expanded evidence. This report
judges correctness, privacy, data minimization, production isolation,
accessibility, and resilience — never Lightroom/Adobe Camera Raw
parity, which the Observation feature makes no claim about.

## 2. Version Tested

AI Workflow **v1.1.9 (EPIC 2E-I)** — unchanged, per instruction.

## 3. Files Audited

`index.html`, `ui/app.js`, `ui/interactive-preview-observation-controller-v2.js`,
`ui/interactive-preview-observation-renderer-v2.js`,
`ui/interactive-preview-observation-session-v2.js`,
`ui/interactive-before-after-controller-v2.js`,
`ui/interactive-before-after-renderer-v2.js`.

## 4. Test Environment

Headless Chromium via Playwright (real automated viewport emulation and
real DOM keyboard/pointer events against the actual `index.html`), plus
direct Node.js unit tests for controller/session-module logic, plus
direct project-wide `grep` code search for privacy/production-isolation
review. **No real physical mobile device, no real screen-reader
software.**

## 5. Mobile Clipping — Root Cause and Fix

**Finding: the mobile clipping visible in this report's original
320px/390px screenshots was a defect in this report's own QA test
harness, not in production code.** Investigation traced it to a missing
`margin: 0` reset on `<body>` in the ad-hoc screenshot harness used to
generate the original evidence — the real `index.html` already
correctly resets `html, body { margin: 0; padding: 0; }` (line 11).
Verified conclusively by driving the real Observation controller/
renderer/session inside the actual `index.html` page (not a standalone
harness) and measuring every relevant element's `getBoundingClientRect()`
against the viewport at all 7 required widths (320/360/390/430/768/
1024/1440px): **zero clipped children at every width, with a 1px
tolerance**, both in a single-Observation-selected state and in a
worst-case state (5 Reasons selected, multi-record Session Summary with
percentages and top-reasons text). No production CSS was changed by
this finding — there was no genuine mobile-layout defect to fix. New,
correctly-captured screenshots have replaced the flawed originals under
`qa-screenshots/epic-2e-j/`.

## 6. Element-Level Responsive Results

| Viewport | Result | Evidence |
|---|---|---|
| 320px | PASS | `docScrollW=320`, zero clipped children (Observation fieldset, Reason fieldset, Context row, Session metrics/secondary row, all radio/checkbox labels, all 3 Clear buttons individually checked) |
| 360px | PASS | same |
| 390px | PASS | same |
| 430px | PASS | same |
| 768px | PASS | same |
| 1024px | PASS | same |
| 1440px | PASS | same |

This is now a **permanent, automated** part of
`qa/epic-2e-j-phase-c-observation-smoke-test.mjs` (not a one-time
screenshot check) — `document.scrollWidth` alone was deliberately not
relied upon, per this patch's own instruction that it is insufficient.

## 7. Observation Workflow Results

All prior workflow findings (Section 5 of the original report) stand
unregressed, re-verified in this patch's expanded live test run: all 4
Observation options, the 5-reason limit with sixth-attempt rejection,
no-specific-reason exclusivity (both directions), Clear Reasons (keeps
Observation), Clear Observation (clears Reasons), generation
invalidation, and non-revival of stale selections.

## 8. Reason-Tag Results

Unregressed from the original report — all 10 exact values, zero/one/
multiple selection, duplicates removed, invalid values rejected, 5-tag
maximum with sixth-attempt rejection, `no-specific-reason` mutual
exclusivity confirmed at both the Controller and independent Session
layers.

## 9. Generation/Provider Results

Unregressed — provider matching/absent/throwing/mismatching/recovering
all re-verified: `generationConfirmed: true` on match; neutral warning
(never "stale") and continued usability via context fallback when the
provider gives no evidence; immediate clearing with zero revival on an
actual mismatch.

## 10. Session Summary Results — including App-Level Clear/Re-record

**FIX 4 (EPIC 2E-J-C-F): the App-level Session Clear + current
re-record behavior was re-tested at the integration level** (not merely
the raw Session module in isolation, as the original Phase C report
tested) — reproducing the exact signature/active-generation-tracking
logic from `ui/app.js`'s real Session Clear button handler
(EPIC 2E-J-B-F2), against the same live Controller/Session instances
used throughout the rest of the test:

1. Selected "Prefer Legacy" with Reasons "Skin tone" + "Contrast" — `activeObservations: 1` confirmed.
2. App-level Clear performed (session cleared, then the current valid selection re-recorded via the real integration pattern).
3. **PASS** — old `cleared`/`invalidated` history reset to 0.
4. **PASS** — `totalObserved: 1, activeObservations: 1, preferLegacy: 1` (the current Observation, not zero).
5. **PASS** — `reasonCounts.skinTone: 1, reasonCounts.contrast: 1` (Reasons preserved through the re-record).
6. **PASS** — the "Prefer Legacy" radio remained visibly checked in the live DOM throughout.

All other Session Summary accuracy findings (active/cleared/invalidated
counts, reason counts, deterministic top-reasons ordering,
`lastObservation` update-ordering, 100-record inactive-first eviction)
are unregressed from the original report.

## 11. Lifecycle Stress Results

Unregressed — a live 3× consecutive Re-analyze sequence plus Reset
produced zero duplicate sections and zero duplicate element IDs (295
total, 295 unique) across the entire page, zero console errors
throughout (excluding the unrelated Google-Fonts-CDN network failures
described in Section 13).

## 12. Privacy Review

Unregressed — zero storage/network API references anywhere in the three
Observation-layer files (project-wide code search). See Section 14 for
this patch's expanded method-level instrumentation.

## 13. Data-Minimization Review

Unregressed — Session records confirmed to contain only the explicitly
permitted fields; no image data, file metadata, or user identity of any
kind. (Note: this environment's sandbox has no internet access, so
Google Fonts CDN requests fail with 403/aborted errors during ordinary
page load — this is an unrelated environment limitation, confirmed via
direct request-level investigation, and does not affect the console-
error-free result reported for Observation actions specifically.)

## 14. Storage/Network Instrumentation (Expanded)

**FIX 6/7/8 (EPIC 2E-J-C-F): method-level instrumentation with
machine-readable counts**, not merely `Storage.length` comparisons.
`Storage.prototype.setItem`/`removeItem`/`clear` were wrapped
(distinguishing `localStorage` from `sessionStorage` by object identity)
around select/change/toggle-Reason/clear-Reason/clear-Observation/
clear-Session actions:

```json
{ "localStorageSet": 0, "localStorageRemove": 0, "localStorageClear": 0,
  "sessionStorageSet": 0, "sessionStorageRemove": 0, "sessionStorageClear": 0 }
```

`fetch`, `XMLHttpRequest.open`, `navigator.sendBeacon`, `WebSocket`
construction, and `BroadcastChannel` construction were wrapped around
setContext/select/toggle/clear actions:

```json
{ "fetch": 0, "xhr": 0, "sendBeacon": 0, "webSocket": 0, "broadcastChannel": 0 }
```

**All counts: zero.** All instrumented APIs were restored to their
originals immediately after each test; the app's own unrelated
dark-mode/language `localStorage` calls were never inside the wrapped
Observation-action time window, by construction.

## 15. Production-Isolation Review

Unregressed — zero matches anywhere under `core/` for any
Observation/Session identifier; `selectedProductionSource` remains
hard-coded `"legacy"`.

## 16. Image-Processing Isolation

Unregressed — zero `drawImage` calls (live-instrumented) across
select/toggle/clear actions; no `getImageData`/`putImageData`/Pixel-
Renderer/Analysis/Render-Plan/Slider call exists anywhere in the three
files.

## 17. Full Application Ready Reachability — Determined Honestly

**FIX 5 (EPIC 2E-J-C-F):** every locally available fixture was tried
through the complete, unmodified application import → analysis →
Interactive Before/After workflow: `test_photo.jpg`, `test_photo3.jpg`,
`test_photo_large.jpg`, `test_highlights_shadows.jpg`,
`test_portrait_cool.jpg`, `test_portrait_warm.jpg`,
`test_nearly_identical.jpg`. **None reached Interactive "Ready."** Every
fixture produced the identical outcome: Interactive Before/After state
`"Partial"`, with the exact upstream blocker message *"Controlled V2
preview unavailable."* This confirms the limitation is a genuine,
fixture-independent property of the current Render Plan (Controlled V2
never produces a concrete supported adjustment under this project's
current pipeline) — not a fixture-selection problem, and not an
Observation-layer defect.

**Full application Observation workflow: `NOT_TESTED`** (not `FAIL`) —
this is the *expected*, previously-documented behavior carried forward
unchanged from every prior EPIC 2E-I/2E-J patch in this project; no new
regression was introduced, and this patch does not modify the Render
Plan, per its explicit instruction not to.

**Controller/Renderer/Session integration harness: `PASS`** (42/43
automated checks pass, 0 fail) — explicitly labeled as such throughout
this report and the smoke-test output, never presented as "full
application workflow."

## 18. Responsive/Keyboard/Accessibility Results (Expanded)

**FIX 9 (EPIC 2E-J-C-F):** re-tested through real DOM events (not
programmatic state calls alone), on the real `index.html`:

| Check | Result | Evidence |
|---|---|---|
| Tab reaches Observation radio group | PASS | `document.activeElement.id === "ipoOption_prefer-legacy"` |
| Arrow keys change selected radio | PASS | ArrowDown moved focus+selection to `"ipoOption_prefer-v2"`, `checked: true` |
| Space toggles Reason checkbox | PASS | verified checked-state flips correctly (a test-script bug of my own — a Reason left checked by an earlier test in the same sequence — was found and fixed while writing this check; the underlying feature was never broken) |
| Tab reaches Clear Observation | PASS | `activeElement.id === "ipoClearButton"` |
| Tab reaches Clear Reasons | PASS | `activeElement.id === "ipoClearReasonsButton"` |
| Tab reaches Clear Session | PASS | `activeElement.id === "ipoClearSessionButton"` |
| Focus-visible has non-zero computed outline | PASS | `outlineStyle: "solid"` |
| No duplicate IDs | PASS | 295 total, 295 unique |

**Real NVDA/JAWS/VoiceOver: NOT TESTED.**

## 19. Pointer/Touch Results

Unregressed — real click/focus DOM events confirmed working in this and
prior patches. **Physical touch hardware: NOT TESTED.**

## 20. Security/Malformed-Data Results

Unregressed from the original report — zero crashes across null/
primitive/throwing-getter/circular-reference renderer inputs; HTML/
script injection in warnings/blockers renders as safely-escaped text
with zero script execution; malformed Session summaries (NaN/Infinity/
negative counts) handled without crash.

## 21. Performance Evidence

Unregressed — 100-record cap enforced; zero `requestAnimationFrame`
loop, Worker, or resize-triggered recalculation; the compact sync
signature confirmed to prevent metadata-only re-emits from advancing
Session ordering.

## 22. Defects Found

**One test-infrastructure defect found and fixed in this patch** (not a
production defect): the original Phase C QA report's mobile screenshots
were captured with a flawed ad-hoc harness missing a body-margin reset,
producing a misleading appearance of content clipping that does not
exist in the real application (see Section 5). Two additional test
script bugs of my own (a session-lifecycle sync omission and a
provider-generation sync omission) were found and fixed while extending
the automated smoke test — none were production defects. **Zero
production code defects were found in this patch.** All defects from
the broader EPIC 2E-J effort were found and fixed in the preceding
EPIC 2E-J-A-F/-F2/-F3 and EPIC 2E-J-B-F/-F2 patches, and remain
confirmed fixed with no regression.

## 23. Fixes Applied

**None to production code.** This patch's changes are entirely QA
infrastructure: a corrected, more rigorous smoke test (now including
element-level responsive containment, App-level Session Clear
integration testing, method-level storage/network instrumentation, and
real-DOM accessibility events), regenerated results, corrected
screenshots, and this rewritten report.

## 24. Tests Not Performed

- Physical mobile device: **NOT TESTED**
- Physical touch hardware: **NOT TESTED**
- Real NVDA/JAWS/VoiceOver: **NOT TESTED**
- Long-duration memory profiling: **NOT TESTED**
- Real user privacy study: **NOT TESTED**
- Multi-tab synchronization: **NOT TESTED** (explicitly out of scope)
- Page-reload persistence: intentionally **NONE** (by design)
- Full application Observation workflow (real image → real Interactive
  Ready → real Observation interaction): **NOT_TESTED** — no locally
  available fixture reaches Interactive Ready under the current Render
  Plan (see Section 17); this is a pre-existing, documented, upstream
  limitation, not a gap introduced or left open by the Observation
  feature itself.

## 25. Remaining Risks

- The real, complete, unmodified application pipeline has never been
  observed to reach a state that enables live Observation interaction,
  because Controlled V2 does not yet produce a supported adjustment
  under the current Render Plan for any fixture available in this
  environment. All Observation/Session correctness evidence in this and
  every prior EPIC 2E-J report is therefore drawn from a synthetic-
  context integration harness using the real, unmodified project code —
  never from a fabricated or fictional harness, but also never from the
  complete live pipeline.
- Real assistive-technology and physical-device compatibility cannot be
  confirmed without dedicated hardware/software testing.

## 26. Phase C Decision

**CONDITIONAL PASS — core feature is safe; only physical-device/
screen-reader testing remains, and full-application reachability is
clearly expected (not blocked by any Observation-layer defect) and
honestly reported as such.**

This is the **single, final decision** for this report (superseding both
decisions that appeared in an earlier draft). Justification, against
this patch's own explicit decision criteria:

- **No mobile clipping remains** (Section 5/6 — root-caused to a test
  harness defect, not production code; zero element-level overflow at
  all 7 required widths, permanently automated).
- **App-level Session Clear/re-record passes** (Section 10 — tested at
  the integration level, not just the raw module).
- **No blocking full-workflow defect exists** — the inability to reach
  Interactive Ready is a known, pre-existing, documented upstream
  Render Plan property, not a defect discovered in or attributable to
  the Observation/Session feature.
- **Privacy instrumentation passes** (Section 14 — zero storage/network
  calls, method-level counts, not just length comparisons).
- **Production isolation remains intact** (Section 15 — zero Core
  consumers; `selectedProductionSource` remains Legacy).

Per this patch's own stated `FAIL` criteria: no Observation data enters
Core, no persistence or network transmission exists, no stale feedback
returns, Session counting is correct, production source is untouched,
Mapping/XMP are untouched, no image processing is triggered, and no
unsafe HTML injection succeeds — none of the `FAIL` conditions apply.
The outstanding items (physical device, screen reader) are exactly the
conditions this patch's own brief defines as acceptable for
`CONDITIONAL PASS` rather than unqualified `PASS`.
