# 16 — EPIC 2E-I Release Notes: AI Workflow v1.1.9

## 1. Release Identity

- **Version:** v1.1.9
- **EPIC:** EPIC 2E-I
- **Release title:** Lightroom Mapping V2 — Interactive Before/After Visual Comparison
- **Status line:** Legacy Active · Interactive Browser Preview Available · V2 Non-Production · XMP Unchanged
- **Compact/mobile status:** AI v1.1.9

## 2. Scope

This release adds a read-only, browser-side **Interactive Before/After
split viewer** on top of the existing Legacy/Controlled-V2 approximate
browser previews shipped in v1.1.8. It does not change what gets written
to disk: Legacy Mapping remains the sole production output path, and XMP
export is byte-identical to the pre-EPIC baseline.

## 3. User-Facing Improvements

- A draggable, single split-line comparison view: Legacy on the left,
  Controlled V2 on the right, instead of only the prior side-by-side
  panels.
- Clear split-position guidance ("0% V2 · 100% Legacy") and a live
  percentage/direction readout.
- Friendly source-status badges (Legacy: Rendered / Controlled V2: No
  supported adjustment / etc.) instead of raw internal state.
- Honest alignment status ("Alignment: Exact dimensions" / "Normalized
  once" / "Blocked geometry").
- A visible keyboard-focus outline on the divider handle and range input.
- Improved text contrast on all Interactive-viewer status text.

## 4. Interactive Comparison Behavior

The viewer binds the two already-rendered Legacy/Controlled-V2 preview
canvases from the existing Visual Preview Comparison feature and copies
each into its own display canvas **once** per analysis generation. It
never re-runs image analysis, never re-invokes the Pixel Renderer, and
never mutates the source preview canvases.

## 5. Split Semantics

- **0%** → Controlled V2 fills the viewport.
- **50%** → Legacy visible on the left half, Controlled V2 on the right half.
- **100%** → Legacy fills the viewport.

This direction is fixed and was verified with real screenshots (visually
distinguishable red/green test canvases), not just code inspection.

## 6. Source Ownership

- **Visual Preview Comparison** owns: actual Legacy/V2 render completion,
  renderer warnings/failures, and the current analysis generation.
- **Interactive Before/After** owns only: split percentage, display-copy
  readiness, alignment state, pointer/keyboard interaction, and UI-local
  warnings. It never reinterprets or overwrites core preview results.

## 7. Alignment Behavior

- Aspect-ratio tolerance: **0.1%** (tightened from an initial 2% during
  development), documented and enforced consistently.
- When source dimensions differ but are aspect-ratio-compatible, both
  display canvases are normalized to one shared, bounded size (never
  upscaling beyond either source).
- When geometry differs beyond the tolerance, interaction is blocked
  rather than silently stretching the comparison.

## 8. State Model

Deterministic priority: disposed → stale/cancelled generation → critical
safety anomaly → ready (both rendered & aligned) → partial (one side
rendered) → failed (both sides explicitly failed) → blocked (safety /
alignment / preview-side blocker, each with a distinct, honest message) →
preparing → unavailable. A single shared pure function
(`deriveInteractiveBeforeAfterStateV2`) is used by both the app-integration
layer and the controller itself, so there is exactly one priority ruleset
in the codebase.

## 9. Safety Blocking

Interaction is blocked when: the resolved production source reports `"v2"`,
V2 evidence is contradictory, or export/production-write flags report
`true`. These conditions outrank every other state, including before any
preview canvas has even been bound. Missing (not contradictory) safety
evidence never blocks — it shows a neutral advisory note instead.

## 10. No-op Behavior

When one or both sides carry explicit evidence of no supported visual
adjustment, a neutral (never green "success") badge and a matching warning
are shown, so the person understands why the two previews may look
similar. Missing adjustment evidence is never presented as a successful
adjustment.

## 11. Pointer and Keyboard Support

Full Pointer Events support (mouse + touch-capable browsers) with correct
capture/release lifecycle, single-processing of a handle-initiated drag
(no duplicate movement), and a real `requestAnimationFrame` guard (at most
one pending frame, cancelled on rebind/clear/dispose). Native `<input type="range">`
keyboard behavior (Arrow keys, Home, End, Page Up/Down, Tab/Shift+Tab) is
preserved as-is; no custom key handling overrides it. A visible
`:focus-visible` outline was added in this release.

## 12. Responsive/Mobile Behavior

Verified with automated viewport emulation at 320/360/390/430/768/900/1024/1440px:
the document itself never scrolls horizontally at any of these widths. Two
genuine, unrelated pre-existing layout defects were found and fixed during
this EPIC's QA closeout (an icon-font fallback text overflow, and a
topbar responsive-breakpoint gap) — both fixed at their actual source,
not by globally hiding overflow.

## 13. Performance Behavior

Slider movement is CSS-only (a `clip-path`/custom-property update). No
`drawImage`/`getImageData` call occurs during a drag — verified via live
instrumentation across a full 0→100% sweep (0 calls to either). Pixel
copying happens only once per newly-bound analysis generation.

## 14. Accessibility Behavior

Section heading, visible Legacy/Controlled-V2 labels, an accessible name
on the range input, status text outside the canvas, `aria-live="polite"`
used only for discrete state transitions (never spammed per pointer
movement), keyboard-accessible `<details>/<summary>` technical details,
and no duplicate IDs. Real screen-reader software testing was **not**
performed (see Section 19).

## 15. Production Isolation

An exhaustive project-wide search for Interactive-viewer state consumers
(`splitPercent`, `interactiveBeforeAfter`, `displayDimensionsNormalized`,
`legacyStatus`, `v2Status`) outside `ui/`/`docs/`/`qa/` found **zero**
matches in `core/`, including `core/decision-engine`, `core/preset-engine`,
`core/xmp-validator`, `core/reference-transfer-engine`, and
`core/decision-report-engine`.

## 16. Mapping/XMP Status

`selectedProductionSource` remains **hard-coded `"legacy"`** in
`core/preview-rendering/visual-preview-render-plan-v2.js` (confirmed via
direct source inspection, including the file's own documenting comment) —
there is no code path by which the Interactive viewer, or Controlled V2 in
general, can influence which source is written to production. XMP export
was re-verified byte-identical (2962 bytes) to the pre-EPIC baseline at
the end of this release closeout.

## 17. Known Limitations

- The Interactive viewer compares **approximate browser previews only**.
  It does not prove Lightroom, Adobe Camera Raw, RAW-development, or
  camera-profile accuracy, and makes no such claim.
- Controlled V2 remains non-production; there is no Apply, Export,
  Download, or Activate-V2 control anywhere in the Interactive viewer.
- All real-image QA in this EPIC used synthetic (flat-color or
  simple-shape) fixtures — no real photographs were available in this
  environment. See Section 19.

## 18. Tests Performed

- Full JavaScript syntax audit: 77/77 files pass `node --check` (see
  Final QA Report for the complete breakdown).
- A reproducible, automated Playwright smoke test: 31/31 checks pass,
  covering Ready/Partial/Safety-Blocked states, 0/50/100% direction,
  keyboard, focus-visible, pointer drag, 8 responsive widths, internal
  large-image scrolling, no duplicate IDs, and zero console errors.
- Manual (scripted, headless-browser) verification of alignment,
  no-op messaging, lifecycle stress sequences (Import → Re-analyze →
  Import → Reset → Import), security/malformed-data handling (HTML/script
  injection, circular objects, hostile getters, NaN/Infinity), and
  production isolation.

## 19. Tests Not Performed

- **Physical mobile device:** NOT TESTED.
- **Physical touch hardware:** NOT TESTED.
- **Real screen-reader software (NVDA/JAWS/VoiceOver):** NOT TESTED.
- **Real portrait/wedding/event photographs:** NOT TESTED — all fixtures
  used were synthetic.
- **Lightroom visual parity:** NOT TESTED (and not a goal of this feature).
- **Adobe Camera Raw parity:** NOT TESTED (and not a goal of this feature).
- **Exact camera-profile parity:** NOT TESTED.
- **Long-duration memory profiling:** NOT TESTED.

None of these are treated as release blockers for this read-only,
browser-preview Early Access feature, since no concrete defect is known in
any of these areas — they are simply unverified.

## 20. Upgrade Notes

No data migration, no configuration change, and no new external
dependency is required. The only visible change on load is the version
badge (now v1.1.9 / EPIC 2E-I) and the new Interactive Before/After section
appearing beneath the existing Visual Preview Comparison panel once an
image has been analyzed.

## 21. Rollback Notes

Rollback is a pure code revert: `core/project-version.js`'s version
metadata and `index.html`'s static fallback badge text are the only
version-identifying changes; all Interactive Before/After files are new,
additive modules with no production write path, so removing/reverting
them has no effect on Mapping or XMP behavior.

## 22. Next EPIC

**EPIC 2E-J — Interactive Preview Observation & User Feedback Layer**
(optional local-only "Legacy preferred / V2 preferred / No visible
difference" observation capture, UI-local only, no production activation,
no Mapping/XMP write, no automatic model decision). Not implemented in
this release.
