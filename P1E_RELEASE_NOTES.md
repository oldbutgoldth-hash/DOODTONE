# P1E — Release Notes

**EPIC 2E-P1E — Color Intelligence & Creative Tone Candidate**
Version 2.5.0. Baseline: EPIC 2E-P1D R2.

## What's new

Auto-Tune Candidate color recommendations are meaningfully stronger for
images with real color-grading opportunity, while remaining bounded and
skin-safe. Previously, HSL shifts, Color Grading saturation, Calibration
moves, and Vibrance/Saturation values were often technically valid but
close to zero — visually flat even for colorful scenes. A new Color
Intelligence layer now restores a bounded, evidence-driven fraction of the
gap between what the Core analysis engines originally recommended and
what the existing legacy pipeline's scene-trust dampening actually left
in the Candidate — never inventing new color, never overshooting the
Core engines' own recommendations, and never weakening skin protection.

- HSL, Color Grading, Calibration, and Presence (Vibrance/Saturation)
  values are strengthened per-channel/zone/primary when the image shows
  real, sufficiently-covered color in that channel and (for Grading) the
  engine's own confidence clears a trust threshold.
- Skin-adjacent HSL channels (red/orange/yellow) and the red Calibration
  primary receive additional, confidence-and-coverage-weighted caution on
  top of already-tighter bounds — verified to produce visibly smaller
  pushes on skin-heavy scenes than on skin-free scenes with comparable
  evidence magnitude.
- "Reset to Auto" now reverts to the Color-Intelligence-strengthened
  recommendation (the new, better "auto"), not the pre-enrichment value.
- A new `candidate.diagnostics.colorIntelligence` field (additive,
  defaults to `null`) records what the layer did and why, for future
  UI/debugging use — no new user-facing panel is added in this EPIC.

## What did NOT change

The Candidate architecture (P1C), the XMP serializer and its Tone Curve
codec, `quickSafetyClamp()`, the Candidate→legacy-preset adapter, the P1D
XMP Readback Fidelity Gate mechanism, the Production legacy path
(`core/decision-engine`), Reference Color Match, the P0.8A preview
pipeline, and every P1A/P1B Session/Report behavior are byte-identical to
P1D R2. No Production write path was activated; no Production Safety Lock
flag changed.

## Internal architecture (no new UI this round)

An internal `STRENGTH_MODE` (NATURAL/BALANCED/CINEMATIC/STRONG) exists for
extensibility — the new default (BALANCED) is intentionally stronger than
a conservative baseline while remaining bounded; the other three modes are
exercised by tests but not yet exposed in the UI. See
`P1E_COLOR_INTELLIGENCE_ARCHITECTURE.md`.

## Verification

70/70 checks in the new `qa/epic-2e-p1e-color-intelligence-test.mjs`
suite, covering pure schema/signal/plan-builder unit behavior, real
`buildCandidateFromSession()` integration (including a permanent
regression test against the exact minimal-evidence fixture used by
`qa/epic-2e-p1c-candidate-test.mjs`), full pipeline export + P1D Fidelity
Gate checks for both a colorful and a heavy-skin scene, user-edit-after-
enrichment behavior, upload/reset lifecycle, source-level purity/hostile
checks, and delegated regression to P1A/P1A R3/P1B/P1C R2/RCM/Production-
lock/ESM-gate suites. All 68 suites in `qa/run-static-suites.mjs` were
individually verified to exit 0 (same "run each suite individually, then
apply the aggregator's own exit logic" methodology established in P1D
R2 — the aggregate command itself exceeds this tool's single-call time
limit). See `P1E_QA_REPORT.md` for full detail, including the
delegated-regression re-verification of
`qa/epic-2e-p1c-candidate-test.mjs` (86/86),
`qa/epic-2e-p1c-r2-candidate-lifecycle-order-test.mjs` (19/19),
`qa/epic-2e-p1c-r3-user-edit-xmp-export-test.mjs` (39/39), and
`qa/epic-2e-p1d-xmp-fidelity-gate-test.mjs` (71/71), all run standalone.

## Known limitations

See the "Known limitations" section of `P1E_QA_REPORT.md` — most notably,
Grading's confidence gate is necessarily all-or-nothing across its three
zones (the engine exposes one confidence value, not per-zone coverage),
and browser QA could not be executed in this environment (Chromium
unavailable, same finding as every prior round) — no browser-only
scenario is claimed as verified.
