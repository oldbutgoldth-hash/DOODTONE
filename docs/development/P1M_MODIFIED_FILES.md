# EPIC 2E-P1M — Modified / New Files

## New files

- `core/single-image/strength-mode/strength-mode-schema.js` — the
  canonical UI-facing `UI_STRENGTH_MODE` enum (NATURAL/BALANCED/DRAMATIC),
  `DEFAULT_UI_STRENGTH_MODE`, `isValidUiStrengthMode()`.
- `core/single-image/strength-mode/strength-mode-mapper.js` — the pure
  per-module translation layer, `mapUiStrengthModeToModule()` and
  `MODULE_KEY`.
- `qa/epic-2e-p1m-strength-mode-test.mjs` — 47-case automated test suite
  (schema, mapper matrix + fail-closed behavior, candidate-builder
  threading, orchestrator rebuild-without-reanalysis, UI wiring,
  regression, Production Lock).
- `docs/development/P1M_STRENGTH_MODE_AUDIT.md`,
  `P1M_QA_REPORT.md`, `P1M_MODIFIED_FILES.md`, `P1M_RELEASE_NOTES.md`,
  `P1M_KNOWN_LIMITATIONS.md` — this documentation set.

## Modified files

- `core/single-image/candidate/candidate-builder.js` — added a
  `strengthMode` parameter to `buildCandidateFromSession()` (default
  `DEFAULT_UI_STRENGTH_MODE`); every one of the 6 Intelligence-layer
  plan-builder calls now passes
  `mapUiStrengthModeToModule(strengthMode, MODULE_KEY.<X>)`; added
  `candidate.diagnostics.strengthMode = strengthMode`. Removed the
  6 now-dead `DEFAULT_STRENGTH_MODE` aliased imports that previously
  supplied each module's hardcoded default.
- `core/single-image/single-image-orchestrator.js` —
  `buildAndCommitCandidate(ticket, { legacyState, engineVersion,
  strengthMode })` gained the optional `strengthMode` parameter
  (default `undefined`), forwarded into `buildCandidateFromSession()`.
- `ui/app.js` —
  - New import: `UI_STRENGTH_MODE`, `DEFAULT_UI_STRENGTH_MODE`,
    `isValidUiStrengthMode` from `strength-mode-schema.js`.
  - `state.strengthMode` added, initialized to `DEFAULT_UI_STRENGTH_MODE`
    (a standing user preference — not reset by `handleReset()`).
  - The `runAnalysis()` completion callback's `buildAndCommitCandidate()`
    call now passes `strengthMode: state.strengthMode`, and its ~50-line
    inline post-build render block was factored into the new shared
    `applyCandidateBuildResult(candidate, { fallbackPresetName })`
    function (identical render sequence, just callable from two sites).
  - New function `setStrengthMode(mode)` — the second
    `buildAndCommitCandidate()` call site; validates the mode,
    updates `state.strengthMode`, and — only if a photo has already
    been analyzed — rebuilds the Candidate from already-completed
    evidence and re-applies the same render chain via
    `applyCandidateBuildResult()`. Exposed as `window.setStrengthMode`.
  - New function `_syncStrengthModeButtons()` — reflects
    `state.strengthMode` onto the 3 segmented-control buttons'
    `aria-pressed`/background/color/border styling; called once at
    boot alongside the existing `switchTab` wiring.
- `index.html` — new segmented-control block (3 buttons: `#strengthModeBtn_NATURAL`,
  `#strengthModeBtn_BALANCED`, `#strengthModeBtn_DRAMATIC`) inserted
  between the Preset Name input row and the tabs row, each
  `onclick="setStrengthMode('<MODE>')"`.
- `ui/i18n/en.js`, `ui/i18n/th.js` — added `strengthModeLabel`,
  `strengthModeNatural`, `strengthModeBalanced`, `strengthModeDramatic`.
- `qa/epic-2e-p1c-candidate-test.mjs` — test 69 updated: the
  "exactly one `buildAndCommitCandidate()` call site" invariant became
  "exactly two: the gated `runAnalysis()` completion path, and the P1M
  `setStrengthMode()` rebuild path" (see `P1M_QA_REPORT.md` for why this
  is a legitimate strengthening, not a loosening).
- `qa/epic-2e-p1c-r2-candidate-lifecycle-order-test.mjs` — the same
  "exactly one call site" check updated the same way; checks 7a/7b
  (slider-sync render + guard) updated to verify the shared
  `applyCandidateBuildResult()` function instead of an inline block;
  new check 7c added (both call sites invoke the shared function in
  their successful-commit branch). Suite total: 19/19 → 20/20.
- `qa/epic-2e-p1d-xmp-fidelity-gate-test.mjs`,
  `qa/epic-2e-p1e-color-intelligence-test.mjs` — their own nested
  "P1C R2 (19/19) remains passing" checks updated to 20/20 to match.
- `qa/epic-2e-p1k-serializer-effects-extension-test.mjs` — test 31's
  Production-lock manifest file-count assertion updated 208 → 210 (2
  new P1M strength-mode files auto-discovered by the manifest
  generator).
- `qa/run-static-suites.mjs` — registered the new P1M suite.
- `qa/baselines/epic-2e-n1-production-invariant.json` — `ui/app.js`'s
  pinned SHA-256 hash updated to match its P1M edits; the other 5
  pinned files (`reference-xmp-generator.js`, `lightroom-mapping-engine/index.js`,
  `preset-engine/index.js`, `xmp-validator/index.js`, `ui-engine.js`)
  are byte-identical to before.
- `qa/baselines/lufa42-production-lock-manifest.json` — regenerated;
  grew from 208 to 210 locked files (the 2 new strength-mode core
  files auto-discovered), and picked up the legitimate hash changes
  for `candidate-builder.js`, `single-image-orchestrator.js`, and
  `ui/app.js`.
- `package.json` — version bumped 2.12.0 → 2.13.0.

## Not touched

No other `core/*` engine, no `ui/i18n/*` translation beyond the 4 new
keys, no XMP serializer, no Production Lock safety flag
(`productionWrite`, `lightroomMappingAllowedByN1`, `xmpWriteAllowedByN1`
all remain `false`), and no prior EPIC's own test file beyond the
narrow, explicitly-listed count updates above.
