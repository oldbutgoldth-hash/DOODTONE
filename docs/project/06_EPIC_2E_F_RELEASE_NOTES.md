# 06 — EPIC 2E-F RELEASE NOTES

**AI Workflow v1.1.6 (EPIC 2E-F)** — "Lightroom Mapping V2 — Controlled Preview Human Review"
Status: Legacy Active · Human Review Console Ready · XMP Unchanged

This release closes out EPIC 2E-F: the Controlled Overlay Preview
Sandbox, the Human Review State Engine, and — new in this release — an
interactive Controlled Preview Review Console. All of it remains
strictly non-production. Production Lightroom output is unchanged by
this entire EPIC.

## Core Additions

- **Controlled Overlay Preview Sandbox** (`mapping-v2-overlay-preview-sandbox.js`)
  — builds a separate, non-production preview object describing what
  the (still-inactive) V2 mapping would abstractly change, with a
  Preview Risk Review and a 16-check eligibility gate.
- **Human Review State Engine** (`mapping-v2-preview-review-state.js`)
  — a pure, immutable state machine for a 10-item human review
  checklist (`createPreviewReviewStateV2`, `updatePreviewReviewItemV2`,
  `resetPreviewReviewStateV2`, `evaluatePreviewReviewStateV2`).
- **Review State pipeline integration** — wired into
  `decision-engine/index.js` as the final stage (#11), attached to
  `finalStyleIntent.controlledPreviewReviewStateV2`.
- **Existing Review State input plumbing** — `buildFinalPreset()` now
  accepts an optional `controlledPreviewReviewStateV2` input so a
  caller can hand prior review progress back into the pipeline.
- **Controlled Preview Review Console** (`review-console-renderer.js`)
  — a tri-state-honest UI (Confirmed / Anomaly / Unknown, never a false
  green checkmark) showing the safety strip, Preview Risk Review,
  review progress, and full checklist.
- **Interactive checklist controls** (`review-console-controller.js`,
  new in this release) — Pass / Fail / Needs Adjustment / Pending
  buttons, reviewer notes (500-char, textarea), and a Reset Review
  control, all routed exclusively through the existing Review State
  Engine — no approval logic duplicated in the UI.
- **Same-image Re-analyze preservation** — review progress and notes
  survive Re-analyze; the engine re-normalizes stale approval against
  the freshly-computed Preview Sandbox.
- **New-image Review State reset** — a different image never inherits
  a previous image's review progress, notes, or armed confirmation
  prompts.
- **Malformed-data safety** — the console renderer and controller
  tolerate null/wrong-type/circular-reference/malformed input
  throughout without throwing, verified across dozens of scenarios.
- **Honesty and resilience patches** (multiple rounds) — replaced
  several always-true hard-coded safety claims with evidence-derived
  tri-state confirmations; fixed real crash bugs (non-Node values
  passed to `appendChild`, circular-reference `JSON.stringify`, null
  array entries).
- **Canvas first-render fixes** — corrected a first-import canvas
  sizing bug (unrelated to the Review Console, released alongside it)
  where the canvas measured a parent section's border-box width
  instead of its own content width.

## Safety Confirmation

- Legacy Mapping remains the active, sole producer of XMP output.
- Preview Export remains disabled — hard-coded `false`, not merely
  flag-gated; verified this cannot be forced true by any flag
  combination.
- Production Write remains disabled — same hard-coded guarantee.
- XMP output is unchanged — verified byte-identical before and after
  heavy Review Console interaction, using the same analysis input.
- No preset mutation — the legacy preset object is never touched by
  any V2 stage (verified via before/after snapshot comparison).
- No input mutation — `buildFinalPreset()`'s inputs, and every engine
  function's own inputs, are provably untouched after each call.
- No local persistence — zero `localStorage`/`sessionStorage`/
  `indexedDB`/cookie usage anywhere in the Review Console or Preview
  Sandbox code (pre-existing, unrelated dark-mode/language settings are
  out of scope and unaffected).
- No backend or API dependency — this remains a fully client-side,
  single-page, no-build-step application.

## Known Limitations

- Preview is not Lightroom-accurate — it shows abstract, normalized
  risk/change information, not a rendered image preview.
- Human Review is entirely manual; there is no automated verification
  of a reviewer's judgment.
- Review State is in-memory only, for the lifetime of the page.
- **Refreshing the page loses all Review State with no warning.**
- Approval does not activate export — even a fully "approved" Review
  State does not enable any production output.
- Preview Export is not implemented anywhere in this codebase.
- Production Mapping V2 is not activated and has no activation path.
- Real-image regression testing is still required — all QA in this
  EPIC used synthetic test images and hand-built mock inputs.
- Preview Risk Review and human-review-gate thresholds remain
  hand-calibrated, not validated against real edited photos.
- Mobile layout has been verified at a 390px emulated viewport only —
  ongoing real-device testing is recommended.
- No automated, persisted, re-runnable browser test suite exists yet —
  every QA pass in this EPIC was a one-time manual script.

## Release Decision

**CONDITIONAL PASS** — see `08_EPIC_2E_F_QA_REPORT.md` for full
evidence and reasoning. Safe to ship: no syntax errors, Production
Mapping and XMP are confirmed unchanged, Preview Export/Production
Write cannot become active, Review State does not leak across new
images, and injected HTML/script does not execute. Manual, real-device
and real-photo QA remains recommended before treating this as fully
production-hardened.

## Next Recommended EPIC

**EPIC 2E-G — Side-by-Side Preview Comparison** — compare Legacy
Preview and the V2 Controlled Preview visually, remaining non-production,
to support (not replace) the human review decisions introduced in this
release. Not implemented as part of EPIC 2E-F.
