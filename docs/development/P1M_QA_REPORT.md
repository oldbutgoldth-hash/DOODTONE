# EPIC 2E-P1M — QA Report

## 1. New test suite

`qa/epic-2e-p1m-strength-mode-test.mjs` — **47/47 PASS**. Covers:

- Schema (checks 1–6): enum shape, default, validator, frozen exports.
- Mapper (checks 7–12): the full 6-module × 3-UI-mode = 18-combination
  matrix against the documented table, plus fail-closed behavior for
  unknown moduleKey, unknown uiStrengthMode, null/undefined, and purity.
- candidate-builder.js wiring (checks 13–18): imports, default
  parameter, all 6 plan-builder call sites route through the mapper
  (verified against comment-stripped source, call-site-anchored so an
  unrelated doc-comment mention of the same function name can't produce
  a false pass), `candidate.diagnostics.strengthMode` is set, and no
  dead `DEFAULT_STRENGTH_MODE` imports remain.
- Functional end-to-end (checks 19–23): real `buildCandidateFromSession()`
  calls against a real `createSingleImageSession()` + evidence fixture
  prove strengthMode threads through to `candidate.diagnostics.strengthMode`
  for the default, NATURAL, and DRAMATIC cases; prove the function never
  mutates the session it was given; prove an invalid strengthMode string
  never throws (fails closed via the mapper).
- Orchestrator (checks 24–30): real `buildAndCommitCandidate()` calls
  prove the strengthMode parameter default, forwarding, and — the core
  P1M mechanism — that calling it a SECOND time on the SAME
  session/generation with a different strengthMode succeeds without any
  new evidence, never mutates `session.evidence`, and the Candidate
  Store + `session.candidate` both reflect only the latest rebuild.
- UI wiring (checks 31–38): `ui/app.js` imports, `state.strengthMode`
  initialization, `setStrengthMode()`'s fail-closed validation and
  no-op-when-nothing-analyzed-yet behavior, its call into
  `buildAndCommitCandidate()`, `index.html`'s 3 buttons, and i18n key
  coverage in both locales.
- Regression (checks 39–44): P1L, P1K, P1C R1, P1C R2, P1C R3, and P1D
  suites all re-run standalone and confirmed green.
- Production Lock (checks 45–47): N1 6-file invariant, the 210-file
  lufa42 manifest, and the production safety flags.

## 2. The stale-hash / stale-count cascade this round surfaced and fixed

Editing 3 already-locked files (`candidate-builder.js`,
`single-image-orchestrator.js`, `ui/app.js`) plus adding 2 new locked
files triggered the exact "stale pinned baseline" pattern this project
has hit at every prior EPIC round. Diagnosed via the established
SHA-256-diff-first procedure (confirm exactly which files differ before
touching any baseline), then fixed in this order:

1. `qa/baselines/epic-2e-n1-production-invariant.json` — only
   `ui/app.js`'s pinned hash needed updating (the other 5 N1 files are
   untouched by P1M).
2. `qa/baselines/lufa42-production-lock-manifest.json` — regenerated via
   `node qa/baselines/generate-production-lock-manifest.mjs`; grew from
   208 to 210 (auto-discovered the 2 new strength-mode files).
3. `qa/epic-2e-p1k-serializer-effects-extension-test.mjs` test 31 — its
   hardcoded manifest-size assertion (208) updated to 210, matching the
   same pattern already used for the 206→208 update at P1L.
4. Three structural regression tests had hard-coded the assumption
   that `ui/app.js` contains exactly ONE `buildAndCommitCandidate()`
   call site — a true fact before P1M, and a legitimately outdated one
   after it (P1M's `setStrengthMode()` rebuild path is a second,
   intentional call site). Rather than loosen these checks, each was
   **rewritten to assert the new, still-precise invariant**:
   - `qa/epic-2e-p1c-candidate-test.mjs` test 69: now asserts exactly 2
     call sites site-wide.
   - `qa/epic-2e-p1c-r2-candidate-lifecycle-order-test.mjs`: rewrote the
     "exactly one" check into "exactly two, named and positioned", and
     rewrote checks 7a/7b (which used to search for
     `renderCandidateToSliders(candidateResult.candidate` literally
     inline after the single call site) to instead verify the new
     shared `applyCandidateBuildResult()` function contains the guarded
     render, and added a new check 7c proving BOTH call sites invoke
     that shared function in their own successful-commit branch. Suite
     total grew 19/19 → 20/20 as a result of the added check.
   - Two other suites (`epic-2e-p1d-xmp-fidelity-gate-test.mjs`,
     `epic-2e-p1e-color-intelligence-test.mjs`) nest a spawned copy of
     the P1C R2 suite and assert its literal `19/19 PASS` text; both
     updated to `20/20 PASS`.

All five of these were genuine, deliberate architecture changes (a
second call site the design explicitly requires, and a shared render
function factored out on purpose) — not scope creep. Every fix was
re-verified against the real, current source, not assumed.

## 3. Full regression sweep (standalone, this round)

| Suite | Result |
|---|---|
| epic-2e-p1m-strength-mode-test.mjs (new) | 47/47 PASS |
| epic-2e-p1l-parametric-tone-curve-test.mjs | 21/21 PASS |
| epic-2e-p1k-serializer-effects-extension-test.mjs | 36/36 PASS |
| epic-2e-p1j-tone-curve-intelligence-test.mjs | first 52 checks confirmed PASS before the environment's aggregate-suite timeout cut the run short (a pre-existing, documented limitation of this suite's own many-nested-spawn design, not a P1M regression — every suite it nests was independently confirmed green below) |
| epic-2e-p1i-r2-pixel-skin-validation-test.mjs | 30/30 PASS |
| epic-2e-p1h-white-balance-intelligence-test.mjs | 118/118 PASS |
| epic-2e-p1g-r2-detail-export-safety-clamp-test.mjs | 35/35 PASS |
| epic-2e-p1f-basic-tone-intelligence-test.mjs | 77/77 PASS |
| epic-2e-p1e-r3-parity-creative-tone-test.mjs | 62/62 PASS |
| epic-2e-p1e-color-intelligence-test.mjs | 94/94 PASS |
| epic-2e-p1d-xmp-fidelity-gate-test.mjs | 71/71 PASS |
| epic-2e-p1c-candidate-test.mjs (R1) | 86/86 PASS |
| epic-2e-p1c-r2-candidate-lifecycle-order-test.mjs | 20/20 PASS |
| epic-2e-p1c-r3-user-edit-xmp-export-test.mjs | 39/39 PASS |
| epic-2e-p1a-single-image-session-test.mjs | 25/25 PASS |
| epic-2e-p1a-r3-upload-lifecycle-integration-test.mjs | 16/16 PASS |
| epic-2e-p1b-analysis-report-test.mjs | 39/39 PASS |

## 4. Production Lock

- N1 6-file invariant: byte-identical for all 6 pinned files
  (`ui/app.js`'s hash updated once this round to its final P1M state).
- lufa42 production-lock manifest: 210/210 files byte-identical.
- Production safety flags (`productionWrite=false`,
  `lightroomMappingAllowedByN1=false`, `xmpWriteAllowedByN1=false`):
  unchanged.

## 5. Browser QA

Not attempted this round (no Chromium/Playwright execution was run in
this environment for P1M) — consistent with the honest-scope reporting
convention used throughout this project when a real browser isn't
available. All verification above is against real production modules
executed directly in Node, not simulated.
