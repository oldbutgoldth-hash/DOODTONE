# EPIC 2E-P1B — Release Notes

**Title:** AI Image Analysis Report + Normalized Report Contract +
Photographer-Friendly Interpretation + Confidence and Safety
Communication

**Baseline:** EPIC 2E-P1A R3 (`LUMIXA~3(1).ZIP`)
**Version:** `2.1.0` → `2.2.0`

## Summary

P1B adds a single, canonical **AI Image Analysis Report** built once
per completed (or partial) analysis from the P1A Session's already-
committed `evidence` — never from DOM, sliders, or a re-run of any Core
module. The report is validated against a strict schema, stored on
`session.report`, and rendered in photographer-friendly Thai/English
language, with raw diagnostic detail available separately in a
collapsed Advanced section. Confidence is combined conservatively
(disagreement lowers it, weak sources can't average into false
confidence) and every observation is explicitly separated from every
recommendation.

## What changed

- 5 new pure modules under `core/single-image/report/`: schema
  contract + validator, confidence aggregator, photographer
  interpretation engine, lineage builder, and the report builder
  itself.
- 1 new renderer, `ui/single-image-report-renderer.js`.
- `core/single-image/single-image-orchestrator.js` gained one new
  exported function, `buildAndCommitReport()`, using the exact same
  generation-ownership commit pattern P1A already established for
  evidence.
- `ui/app.js` gained 6 additive hooks wiring the report into the real
  upload/analyze/reset/locale-change flow — no existing line changed.
- `index.html` gained one report container, correctly placed between
  the uploaded-image/analysis-progress area and the existing Auto-Tune
  controls/XMP actions.
- Thai and English gained ~145 new i18n keys each under `report:` — no
  existing key touched.
- 39 new static/integration test cases (35 required + 1 bonus i18n
  coverage) verified against the real Production modules, registered in
  `qa/run-static-suites.mjs` (now 63 suites total).
- A new Browser QA suite covering the 8 required scenarios, written and
  ready to run wherever Chromium is available (see Known limitations).

## What did not change

- Every Core analysis module (`histogram-engine`, `whitebalance-engine`,
  `color-cast-detector`, `skin-classifier`, `skintone-engine`,
  `scene-classifier`, `kmeans-engine`, `color-harmony-engine`,
  `hsl-analyzer-engine`), Candidate construction
  (`core/decision-engine`), slider sync, and XMP mapping/serialization/
  download (`core/preset-engine`, `core/xmp-validator`,
  `core/lightroom-mapping-engine`) — byte-identical, verified.
- Reference Color Match (P0.8A): every RCM-exclusive file confirmed
  byte-identical to its pinned baseline.
- P1A R3's upload lifecycle: reset-before-beginUpload ordering, ticket
  capture, duplicate-Analyze prevention, stale-callback rejection — all
  re-verified passing (25/25 + 16/16, unmodified).
- Production safety locks (`productionSource: 'legacy'`,
  `productionWrite: false`, `controlledV2Apply: false`,
  `xmpWriteAllowed: false`, `productionActivationAllowed: false`) —
  unchanged, re-verified (test case 35).

## Test results

- 39/39 P1B-specific static/integration cases passing.
- Full static suite: 63/63 suites passing (up from 62 in P1A R3), a
  clean re-run from this exact working copy.
- Browser QA: written and verified to fail closed correctly
  (`BROWSER_BINARY_UNAVAILABLE`) — same environment constraint as every
  prior EPIC 2E round (no network access to Chromium's CDN, no
  system-installed browser in this sandbox). See `P1B_QA_REPORT.md`.

## Known limitations

- Real-browser verification of the 8 required Browser QA scenarios did
  not execute in this sandbox, for the same environment reason as every
  prior round. `qa/epic-2e-p1b-analysis-report-browser-test.mjs` is
  complete and fails closed honestly; the real per-scenario page-drive
  logic is scaffolded but unexercised here — see `P1B_QA_REPORT.md` for
  the exact, honest status and what remains unverified.
- `NOISE_RISK` and `SHARPNESS_RISK` (2 of the spec's 11 example
  technical-issue categories) are not implemented: no Core module in
  this codebase currently measures noise or sharpness, and the spec's
  own rule ("only generate an issue when evidence supports it")
  forbids fabricating a value with no backing evidence. See
  `P1B_PHOTOGRAPHER_LANGUAGE_GUIDE.md` §4.
- `colorCast` and `scene` evidence keys have no legacy-state fallback
  (matching P1A's own documented limitation for these two P1A-native
  keys) — if either is genuinely absent, the affected report section is
  `UNAVAILABLE` with no fallback attempted, which is correct behavior,
  not a gap to close.
