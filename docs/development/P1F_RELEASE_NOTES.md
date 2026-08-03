# P1F Release Notes

**LUMIXA AI — EPIC 2E-P1F: Basic Tone Intelligence & Adaptive Dynamic
Range**
**Version:** 2.6.0

## Summary

Prior to this release, the Basic Panel sliders (Exposure, Contrast,
Highlights, Shadows, Whites, Blacks, Texture, Clarity, Dehaze) were
near-zero by design on almost every photo — not a bug in the export
pipeline, but a genuine architectural mismatch: `core/basic-panel-
engine`'s Style Preservation Mode (built for Reference Color Match,
where the goal is to *preserve* an existing look) was wrongly feeding
the single-image Auto-Tune Candidate pipeline, which needs real
corrections. Texture/Clarity/Dehaze were additionally hardcoded
constants in `core/lightroom-mapping-engine` (Dehaze always exactly
`0`). Full root-cause trace in `P1F_BASIC_VALUE_LINEAGE_AUDIT.md`.

This release adds a new, independently-owned **Basic Tone Intelligence**
layer that classifies each image's dynamic-range/tonal character from
real histogram-engine evidence (never filename/UI state) into one of
10 scene classes, then produces bounded, conservative, evidence-driven
recommendations for all 9 Basic fields — with structural skin
protection, white-clothing highlight protection, noise-risk-aware
Texture/Clarity capping, and a Dehaze gate so strict it never acts as a
generic contrast substitute.

## What changed

- **New root-cause fix**: Basic Panel values are now real,
  scene-appropriate, non-trivial numbers instead of near-zero
  passthroughs.
- **New Advanced Diagnostics section**: scene class, confidence,
  evidence summary, per-field Candidate/Export-Expected/XMP-Readback
  values and match status, in both English and Thai.
- **Zero regressions**: P1A through P1E R3 all still pass unmodified
  (except 7 legitimately-updated test assertions in the P1C suite that
  had hardcoded a stale raw-preset-passthrough assumption about the
  Basic fields — the underlying invariants those assertions protect
  are fully intact, only the specific literal numbers changed).
- **No new safety mechanism was needed for parity/export** — P1F's
  Basic values flow through the exact same `computeExportParity()` /
  `quickSafetyClamp()` / XMP Fidelity Gate pipeline P1E R3 already
  built.

## Composition with P1E (Color Intelligence)

P1F and P1E now compose in a strict, documented order: Evidence →
baseline Core Candidate → Basic Tone Plan (P1F) → Color Intelligence
Plan (P1E) → canonical Candidate validation → UI → XMP. Neither layer
ever writes the other's fields — enforced both by source-level
docstrings and by an automated ownership-boundary test (test 7 and 45
of the new suite). See `P1F_P1E_COMPOSITION_POLICY.md`.

## Errors found and fixed during this round

- **Minimal-evidence guard too strict**: `classifyDynamicRange()` and
  `buildBasicTonePlan()` originally required `stats.total > 0`, which
  incorrectly forced a legitimate minimal/synthetic evidence fixture
  (no `total` field) into the `LOW_CONFIDENCE` branch. Relaxed to only
  require `stats.total !== 0`, matching this project's established
  tolerance for minimal fixture shapes elsewhere (e.g. P1E's
  `deriveColorSignals()`).
- **7 stale literal assertions** in `qa/epic-2e-p1c-candidate-test.mjs`
  (tests 15, 32, 33, 37, 45, 49, 53) assumed the Basic fields were a
  pure raw-preset passthrough. Updated each to check the new, correct
  invariant with an explanatory comment citing this EPIC — no
  underlying protection was weakened.
- Production Lock manifest and the N1 `ui/app.js` invariant were
  regenerated/updated after each locked-file change in this round, as
  required by the project's own established convention.

## Testing

70 required automated test cases + 7 mutation tests, all passing
(77/77) against the real production modules. Full static suite
(70 registered suites) re-verified clean (0 failures). See
`P1F_QA_REPORT.md` for the complete breakdown.

## Known limitations

See `P1F_KNOWN_LIMITATIONS.md` — most notably, haze detection remains
a proxy (no dedicated sensor exists in this codebase yet), and Browser
QA / Lightroom manual verification could not be executed in this
delivery environment (Chromium unavailable, network allowlist blocks
download; no Lightroom license available) — both are honestly reported
rather than fabricated, with ready-to-run scripts/guides delivered for
an environment where they can be completed.
