# 15 — EPIC 2E-I Phase C: Real-Image Validation & UX QA Report

**Updated by EPIC 2E-I-C-F** — this revision corrects an honesty issue in
the original Phase C report (Section 4) and adds mobile-overflow,
contrast, and focus-visible fixes plus reproducible machine-readable QA
evidence. See the "EPIC 2E-I-C-F Addendum" at the end for the delta.

## 1. Scope

Validation of the Interactive Before/After viewer (`ui/interactive-before-after-controller-v2.js`
+ `ui/interactive-before-after-renderer-v2.js`) against test image workflows,
completing focused UX QA. This report judges only whether the browser
comparison is stable, aligned, honest, usable, responsive, and safe —
**never** whether it is Lightroom-accurate.

## 2. Build/Version Tested

AI Workflow **v1.1.8 (EPIC 2E-H)** — after EPIC 2E-I Phase A/A-F/A-F2,
Phase B/B-F/B-F2, Phase C, and this closeout patch EPIC 2E-I-C-F. Version
number unchanged, per instruction.

## 3. Test Environment

- Headless Chromium via Playwright, automated viewport emulation.
- Node.js `node --check` for static syntax verification.
- A reproducible Playwright smoke-test script (`qa/epic-2e-i-phase-c-smoke-test.mjs`),
  producing machine-readable results (`qa/epic-2e-i-phase-c-results.json`).
- **No real physical mobile device was used.**
- **No real screen-reader software was used** — accessibility results are
  DOM-attribute inspection only.

## 4. Image Test Categories Used — CORRECTED (see EPIC 2E-I-C-F Addendum)

**Important honesty correction:** the original version of this report
labeled several test fixtures "Landscape Daylight 01" / "Portrait Warm
Indoor 01" etc. in a way that could be misread as real photographs. Pixel
analysis performed in this closeout patch confirms:

| Fixture | Dimensions | Actual content | Classification |
|---|---|---|---|
| `test_photo.jpg` / `test_photo2.jpg` | 800x600 | Single flat color (`unique_colors=1`) | **Synthetic flat fixture**, not a photograph |
| `test_photo3.jpg` | 1200x900 | Single flat color (`unique_colors=1`) | **Synthetic flat fixture**, not a photograph |
| `test_photo_large.jpg` | 3000x2000 | Single flat color (`unique_colors=1`) | **Synthetic flat fixture**, not a photograph |
| `test_portrait_warm.jpg` | 600x800 | Simple drawn shapes, ~1,374 unique colors (ellipse + rectangle) | **Synthetic multi-region fixture**, not a photograph |
| `test_portrait_cool.jpg` | 600x800 | Simple drawn shapes, ~1,812 unique colors | **Synthetic multi-region fixture**, not a photograph |
| `test_highlights_shadows.jpg` | 800x600 | Simple drawn shapes, ~924 unique colors | **Synthetic multi-region fixture**, not a photograph |
| `test_nearly_identical.jpg` | 800x600 | Single flat color | **Synthetic flat fixture** |
| `test_transparent.png` | 400x300 | 2 flat colors with alpha | **Synthetic flat fixture** |
| `test_tiny.jpg` | 32x24 | Single flat color | **Synthetic flat fixture** |

**No real photographic fixtures (of landscapes, portraits, or events) were
available in this environment**, and per instruction, none were downloaded
to artificially satisfy the checklist. All "portrait"/"landscape"/"event"
terminology in the original report described the fixture's *aspect ratio
and intended test purpose*, not its actual photographic content — this was
an imprecise label, now corrected.

**Real photographic testing (landscape/portrait/mixed-light) is marked
NOT TESTED** in this revision, per FIX 6's explicit instruction rather than
claiming synthetic patches represent it.

What genuinely WAS validated using these synthetic fixtures: pipeline
mechanics -- decode success, aspect-ratio preservation through the full
pipeline, downscale behavior, alignment computation, and rendering
correctness -- all of which are content-agnostic and do not require real
photographic detail to verify correctly.

## 5. Automated Tests

All tests were executed as real Playwright/Node scripts -- none are
estimated or carried forward without re-verification. See
`qa/epic-2e-i-phase-c-smoke-test.mjs` and its output
`qa/epic-2e-i-phase-c-results.json` (19/19 PASS at time of this patch) for
the reproducible, machine-readable subset.

## 6. Manual Browser Tests

"Manual browser test" in this report means a live headless-Chromium
session driven by an explicit Playwright script and inspected via
screenshot/DOM query -- not a human manually operating a GUI.

## 7. Responsive Results

| Test | Result | Evidence |
|---|---|---|
| **Full-page horizontal overflow at 320/360/390/430px** | **PASS (FIXED in EPIC 2E-I-C-F)** | Previously `document.documentElement.scrollWidth` exceeded `clientWidth` by ~6px at 390px, traced to `#previewImg`/`#viewerViewport`'s intentional `overflow:auto` (for 1:1-scale scrollable image viewing) leaking into document-level scroll-width calculation. Fixed via a single `overflow-x: hidden` rule on `html, body` (see Section 20 below for root-cause detail). Re-verified via the smoke test: `scrollWidth === clientWidth` exactly at all of 320/360/390/430px |
| Interactive section's own width | PASS | Confirmed well within its viewport at every tested width (unchanged from original Phase C finding) |
| Viewer's intentional horizontal scroll (for viewing large images at 1:1) still functional | PASS | Re-verified after the fix: dragging `viewerViewport.scrollLeft` on a 3000x2000 image on a desktop viewport still correctly scrolls to the requested position |
| Physical mobile device | **NOT TESTED** | No physical device was available |

## 8. Pointer/Touch Results

Unchanged from the original Phase C report -- all PASS, re-verified without
regression in this patch's smoke test (drawImage/getImageData
instrumentation during a full 0-100% split sweep: 0 calls to either).

## 9. Keyboard Results

| Test | Result | Evidence |
|---|---|---|
| Range/handle focusable when interactive | PASS | Re-confirmed |
| ArrowRight/Home/End | PASS | Re-confirmed via the reproducible smoke test (`qa/epic-2e-i-phase-c-results.json`) |
| **Visible keyboard focus outline** | **PASS (FIXED in EPIC 2E-I-C-F)** | The original report flagged that no explicit focus style existed anywhere in the renderer (confirmed via `grep` -- zero `outline`/`focus` occurrences). Added a scoped `:focus-visible` rule for `#ibaHandle` and `#ibaRangeInput` using the theme's `--accent` color. Re-verified live: pressing Tab lands on `#ibaHandle` and produces a computed `outline-style: solid`, `outline-width: 3px` |

## 10. Alignment Results

Unchanged from the original Phase C report -- all PASS. Note: since the
underlying fixtures are synthetic (per Section 4's correction), these
results validate the alignment *pipeline mechanics* (aspect-ratio
computation, tolerance enforcement, common-dimension normalization) -- not
"visual alignment of real photographic content", which was never claimed
and remains untested with real photographs.

## 11. No-op Results

Unchanged from the original Phase C report -- all PASS (verified via
synthetic tri-state metadata, not dependent on real image content).

## 12. Safety-Blocking Results

Unchanged from the original Phase C report -- all PASS. Additionally
re-verified in this patch's reproducible smoke test: a `selectedProductionSource: "v2"`
anomaly with neither side rendered correctly produces `state: "blocked"`,
`blockedReason: "safety"` (see `qa/epic-2e-i-phase-c-results.json`).

## 13. Lifecycle Stress Results

Unchanged from the original Phase C report -- all PASS, no regression
introduced by this patch's comment-only and CSS-only changes.

## 14. Performance Evidence

| Check | Result | Evidence |
|---|---|---|
| No `drawImage` during slider movement | PASS | Instrumented in the reproducible smoke test: `CanvasRenderingContext2D.prototype.drawImage` wrapped, a full 0-100% sweep (21 discrete `setSplit` calls) produced exactly 0 calls |
| No `getImageData` during slider movement | PASS | Same instrumentation, 0 calls |
| Other performance checks | Unchanged from original report (code-inspection evidence) |

## 15. Accessibility Results (DOM-inspection only)

Unchanged from the original Phase C report, **plus** the new focus-visible
fix (Section 9). Real screen-reader software testing remains **NOT TESTED**.

## 16. Security/Malformed-Data Results

Unchanged from the original Phase C report -- all PASS, re-confirmed no
regression.

## 17. Defects Found (this patch)

1. **Full-page mobile horizontal overflow** (~6px at 320-430px) -- real
   defect, root-caused and fixed (Section 20).
2. **Text contrast defect**: `var(--text-faint)` (`#7d6c52`) was used for
   multiple small (10-11px) informational text elements in the Interactive
   viewer -- computed WCAG contrast against the app's actual `--surface-1`/`--surface-2`/`--bg`
   backgrounds is only 3.28-3.70:1, below the 4.5:1 required for normal-size
   text (it only clears the 3:1 "large text" threshold, which does not
   apply to 10px text). This was a genuine UI defect in the real
   application stylesheet, not an artifact of an incomplete test harness --
   confirmed by computing the actual `--text-faint`/`--surface-1` hex
   values from `index.html`'s own variable definitions.
   **Fixed** by switching all 8 affected occurrences to `var(--text-dim)`
   (`#b9a582`), which computes to 6.95-7.85:1 against the same real
   backgrounds -- comfortably clearing WCAG AA for normal text.
3. **No visible keyboard focus style** -- confirmed via `grep` that zero
   `outline`/`focus` rules existed anywhere in the renderer. **Fixed** by
   adding a scoped `:focus-visible` rule.
4. **Stale "2%" tolerance comment** (found and fixed in the original Phase
   C patch, already documented there).

## 18. Fixes Applied (this patch)

- `index.html`: added `overflow-x: hidden` to the `html, body` base reset
  rule (1 line changed).
- `ui/interactive-before-after-renderer-v2.js`: replaced all 8 occurrences
  of `var(--text-faint)` with `var(--text-dim)`; added a `:focus-visible`
  CSS rule for the handle and range input inside the existing dynamically-injected
  `<style>` element.
- `docs/project/15_EPIC_2E_I_PHASE_C_REAL_IMAGE_QA.md`: this document,
  corrected per FIX 6/7's honesty requirement.
- Created `qa/epic-2e-i-phase-c-smoke-test.mjs` and
  `qa/epic-2e-i-phase-c-results.json`.
- Created screenshot evidence (see Section 21).

## 19. Tests Not Performed

- Real physical mobile/touch device testing.
- Real screen-reader software testing (NVDA/JAWS/VoiceOver).
- **Real photographic fixture testing of any kind** (landscape, portrait,
  or event/mixed-light) -- no real photographs were available in this
  environment; all fixtures used are synthetic, per the corrected Section
  4 above. This is now explicitly NOT TESTED rather than implied by
  loosely-named synthetic fixtures.
- Absolute frame-rate/performance profiling.

## 20. Root Cause of the Mobile Overflow Fix (technical detail)

`#viewerViewport` (`.lx-viewer-viewport`) intentionally uses `overflow: auto`
so a decoded image can be viewed and scrolled at its true 1:1 resolution
without being stretched (`.lx-viewer-viewport img { max-width: none; }`).
This is correct, intentional behavior -- large images are *supposed* to be
horizontally scrollable within that one container. However, a nested
scroll container's actual content width was still being reflected in
`document.documentElement.scrollWidth`/`document.body.scrollWidth` by a
few pixels, even though the element's own visible (`getBoundingClientRect().width`)
size never exceeded its parent. This is a subtle, well-known browser
layout-measurement quirk rather than a visible rendering defect -- nothing
ever visibly overflowed the page, but the *reported* document scroll width
technically exceeded the viewport width, which some strict overflow checks
(including this project's own QA) flag as a failure. The fix -- a single
`overflow-x: hidden` on `html, body` -- stops the document itself from ever
offering horizontal scroll, while leaving `#viewerViewport`'s own internal
`overflow: auto` completely untouched and still fully functional (verified:
programmatically setting `scrollLeft` on a 3000x2000 test image still works
correctly after the fix).

## 21. Screenshot Evidence (this patch)

All captured using the real application stylesheet/CSS variables (not an
incomplete test harness):

- `ready_50pct_readable.png` -- Ready state with corrected `--text-dim` contrast.
- `split_0pct_v2.png` / `split_100pct_legacy.png` -- carried over from the
  original Phase C patch (direction was already correct; not re-captured).
- `partial.png` -- Partial state.
- `safety_blocked.png` -- Safety-anomaly Blocked state.
- `mobile_320px.png` -- 320px viewport, post-overflow-fix.
- `portrait.png` -- a portrait-orientation (600x800) synthetic fixture bound
  through the real Visual Preview Comparison pipeline.
- `landscape.png` -- a landscape-orientation (1200x900) synthetic fixture
  bound through the real Visual Preview Comparison pipeline.

None of these depict real photographs; all are synthetic fixtures, per
Section 4.

## 22. Phase C Final Decision

**CONDITIONAL PASS -- Core interaction safe; manual device QA remains.**

Justification: the two release-blocking-adjacent UI defects found during
this closeout (mobile overflow, text contrast) have both been fixed and
re-verified with reproducible evidence (a machine-readable 19/19 PASS smoke
test plus screenshots). The keyboard focus-visibility gap has also been
fixed. No blocking defect remains under the stated release criteria (left/right
direction correct, no visible geometry misalignment, no stale pixels, safety
anomalies correctly block, no pixel processing during drag, no stuck pointer
capture, keyboard input works, mobile overflow resolved, hostile input
cannot crash the viewer, read-only boundary intact). The CONDITIONAL
qualifier reflects the explicitly-listed untested items: real physical
device testing, real screen-reader testing, and real photographic-content
testing -- none of which are blocking defects under this phase's stated
criteria, but none of which should be considered closed either.

---

## EPIC 2E-I-C-F Addendum (this patch's summary)

This patch found and fixed 3 genuine defects (mobile overflow, text
contrast, missing focus style), added a reproducible automated smoke test
with machine-readable JSON results, captured 7 new/updated screenshots
using the real application stylesheet, and corrected an honesty gap in the
original report's image-fixture terminology. No pixel-processing,
Render-Plan, Mapping, or XMP behavior was touched. The Phase C decision is
now backed by concrete before/after evidence for both fixed defects.

---

## EPIC 2E-I-C-F2 Addendum — Scoped Overflow Containment

This final Phase C closeout patch replaces the previous (EPIC 2E-I-C-F)
global `html, body { overflow-x: hidden; }` fix with a properly scoped,
root-cause fix, and substantially extends the reproducible smoke-test
evidence.

### Root cause correction

The prior patch's global fix worked, but masked the *actual* cause rather
than correcting it. Element-by-element investigation of the real overflow
chain (from `#previewImg` up to `<html>`) found **two distinct, genuine
layout defects**, neither of which was the preview viewer itself:

1. **Material Symbols icon font fallback.** When the "Material Symbols
   Outlined" web font fails to load (no network access to Google Fonts in
   this environment), the browser renders the literal ligature text (e.g.
   `"light_mode"`, `"palette"`) instead of a single icon glyph — this text
   is far wider than the intended ~19px icon box. Fixed with a scoped rule:
   `.material-symbols-outlined { display:inline-block; width:1em; height:1em; overflow:hidden; white-space:nowrap; vertical-align:middle; }`.
   This clips any oversized fallback text to the icon's intended box and
   has zero effect when the font loads normally (a real glyph never
   exceeds this box).
2. **A topbar responsive-breakpoint gap.** The sidebar-hiding breakpoint
   was `900px`, but the topbar's nav-links-hiding breakpoint was a
   separate, narrower `680px` — leaving a genuine unhandled gap between
   680–900px (e.g. at 768px) where the full topbar row (logo + 4 nav links
   + AI-workflow badge + language/dark-mode buttons + plan badge)
   genuinely does not fit. Fixed by moving `.lx-topbar-nav`/`.lx-plan-badge`
   hiding to share the same `900px` breakpoint as the sidebar hiding,
   closing the gap.

**`#viewerViewport`'s own `overflow: auto` was never the actual cause** —
it was already correctly self-contained (its own `getBoundingClientRect().width`
never exceeded its parent at any tested width); this was verified again in
this patch via the internal-scroll test below.

### Internal viewer scroll verification (FIX 2)

With a 3000×2000 fixture loaded at a 1440px viewport:

| Metric | Value |
|---|---|
| Document `scrollWidth` / `clientWidth` | 1440 / 1440 (no overflow) |
| `#viewerViewport` `scrollWidth` / `clientWidth` | 3034 / 788 (correctly still internally scrollable) |
| `scrollLeft` after programmatically setting to 150 | 150 (confirmed functional after smooth-scroll settles) |
| Image `naturalWidth` vs. displayed `clientWidth` | 3000 vs. 3000 (never resized to satisfy overflow containment) |

### Extended reproducible smoke test (FIX 3)

`qa/epic-2e-i-phase-c-smoke-test.mjs` was extended from 19 to **31**
automated checks, adding: focus-visible computed outline on both the
handle and the range input, Shift+Tab non-trapping verification, real
pointer-drag split verification, dragging-class removal on pointerup,
viewport overflow checks at 768/900/1024px (closing the exact gap that
caused the original defect), and the 3000×2000 internal-scroll/no-resize
verification above. **Result: 31/31 PASS, 0 FAIL** (`qa/epic-2e-i-phase-c-results.json`).

### Evidence distinction (FIX 4)

- **Current smoke-test evidence (this patch):** the 31 checks in
  `qa/epic-2e-i-phase-c-results.json`, all executed live in this session.
- **Prior Phase C/C-F evidence:** alignment, safety-blocking, no-op,
  lifecycle-stress, and security results carried forward unchanged (no
  code touched by this patch affects them) — see the original sections
  above.
- **Code-inspection evidence:** performance claims (no resize listener, no
  `drawImage` outside `updateSources()`) remain code-inspection based,
  clearly labeled as such above.
- **NOT TESTED:** real physical device, real screen-reader software, real
  photographic content — unchanged, still explicitly not claimed.

### Screenshot evidence (FIX 5)

`mobile_390px.png` re-captured after the scoped fix — confirmed no
page-level clipping is concealing any genuinely overflowing card (the
scoped fix corrects the actual offending elements rather than hiding
overflow at the document level, so if a card were still genuinely
overflowing, it would show as a real horizontal scrollbar, not be
silently clipped).

### Revised Phase C Decision

**PASS — Ready for EPIC 2E-I Phase D Release Closeout.**

Justification: the scoped root-cause containment now works correctly at
every tested width (320/360/390/430/768/900/1024/1440px) without any
global `overflow-x: hidden` on `html`/`body`. All 31 reproducible smoke
tests pass. The internal 1:1 image-scrolling feature remains fully
functional and unresized. Focus visibility, pointer behavior, and keyboard
behavior are all verified. No blocking defect remains.

---

## Phase D Closeout Note

This report's "Build/Version Tested" (Section 2) correctly reflects
**v1.1.8 (EPIC 2E-H)**, since project version metadata was intentionally
not updated during Phase C/C-F/C-F2 per instruction. The project version
was subsequently updated to **v1.1.9 (EPIC 2E-I)** during EPIC 2E-I Phase
D (Release Closeout) — see `docs/project/18_EPIC_2E_I_FINAL_QA_REPORT.md`
for the version-1.1.9 final release audit, which re-ran this report's
underlying smoke test fresh against the updated codebase (still 31/31
PASS).
