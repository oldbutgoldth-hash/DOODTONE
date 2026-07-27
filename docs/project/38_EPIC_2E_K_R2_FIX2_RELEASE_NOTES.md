# EPIC 2E-K-R2-FIX2 — Release Notes

## Fixed (10 reported bugs)

1. **Controlled V2 never rendered real pixels** — fixed via the
   Calibration-only V2 Preview Plan (Section 1) + real canvas render
   (Section 2).
2. **Save Result Button remained enabled when it shouldn't** — the
   button now mirrors the Decision Chips' own eligibility flag
   (Section 6).
3. **Save Result could persist Notes with `userDecision=NOT_REVIEWED`**
   — `saveCurrentDecision()` now rejects `NOT_REVIEWED` outright with
   `DECISION_REQUIRED` (Section 6).
4. **`reviewedAt` created for a record still `NOT_REVIEWED`** — fixed by
   the same Section 6 gate (a rejected save creates nothing).
5. **`browserVerified=true` with an empty V2 canvas/null hash** —
   `browserVerified` is now computed from the same structural + hash
   checks the classifier itself uses (Section 3).
6. **`previewTruthCode=LEGACY_RENDER_FAILED` despite a genuinely
   rendered Legacy canvas** — the classifier now distinguishes "did not
   render" from "rendered but hash unavailable" (Section 4).
7. **Blocker named `V2_RENDER_FAILED` when the real cause was Sandbox
   ineligibility** — `deriveUiBlockerReasonCode()` now reads the real
   Calibration V2 Plan fields, never a hard-coded override (Section 5).
8. **Browser detection contract mismatch** (`found` vs `executablePath`
   vs `available`) — unified into one contract all callers agree on
   (Section 7).
9. **Browser suite reported `BROWSER_BINARY_UNAVAILABLE` with a real
   binary present** — direct consequence of bug #8, fixed by the same
   change.
10. **Browser Test allowed unknown/partial states to pass** — the
    OR-shortcut pattern is replaced by a pure, hostile-tested strict
    classifier (Section 9).

## Modified Files

Confirmed via `diff -rq` against the untouched FIX1 seed (excluding
`node_modules`, `qa-screenshots`):

- `core/calibration-lab/codes.js` — 4 new stable codes, new hash-mode
  enum, `CALIBRATION_V2_PREVIEW_MODE`.
- `core/calibration-lab/pixel-truth-capture.js` — rewritten: dual-path
  SHA-256, honest `browserVerified`, Calibration V2 Plan field capture.
- `core/calibration-lab/preview-evidence.js` — 12-step classifier
  reorder, `_sideStructuralStatus()`, evidence field extension,
  `deriveUiBlockerReasonCode()` signature change.
- `core/calibration-lab/run-comparison-pipeline.js` — wires the
  Calibration V2 Preview Plan into the pipeline result.
- `core/calibration-lab/build-calibration-v2-preview-plan.js` (**NEW**).
- `core/calibration-lab/sha256-pure-js.js` (**NEW**).
- `ui/calibration-lab/calibration-lab-controller.js` — Save Result Gate,
  evidence exposure in `getQaSnapshot()`.
- `ui/calibration-lab/calibration-lab-renderer.js` — Save button
  disabled state, dynamic blocker call site.
- `qa/helpers/playwright-lumixa-test-runtime.mjs` — unified Browser
  Detection Contract, Windows candidate paths.
- `qa/helpers/real-pixel-comparison-decision.mjs` (**NEW**).
- `qa/preflight.mjs` — dynamic Playwright import, unified contract read.
- `qa/epic-2e-k-calibration-lab-browser-test.mjs` — strict classifier
  wiring, 4-fixture flow, Section 11 runtime assertions.
- `qa/epic-2e-k-calibration-lab-static-test.mjs`,
  `qa/epic-2e-k-r2-fix1-pixel-truth-static-test.mjs` — fixture/assertion
  updates for the new evidence fields and code count (legitimate test
  modernization, same precedent as FIX1).
- `qa/run-static-suites.mjs` — 6 new FIX2 suites wired in.
- `RUN_LUMIXA_CALIBRATION_QA_WINDOWS.bat` — Step 4 Preflight failure now
  sets `OVERALL_FAIL=1`.
- `qa/epic-2e-k-r2-fix2-*.mjs` (**6 NEW test files** — save-gate,
  browser-contract, real-pixel-decision, calibration-v2-plan,
  hostile-closure).
- `qa/baselines/lufa42-production-lock-manifest.json` — regenerated
  (expected side effect of the manifest generator script; the 8 named
  production-critical files it covers are independently confirmed
  byte-identical via direct diff — see the QA Report, item 13).

**Never touched:** `core/lightroom-mapping-engine/index.js`,
`core/xmp-validator/index.js`, `core/preset-engine/index.js`,
`ui/app.js`, `ui/ui-engine.js`, `core/decision-engine/index.js`,
`core/preview-rendering/visual-preview-render-plan-v2.js`,
`core/lightroom-mapping-engine/mapping-v2-overlay-preview-sandbox.js`,
`index.html`.

## Known Limitations

- **No real Chromium in this sandbox.** `npx playwright install
  chromium` fails with `403 Connection blocked by network allowlist` —
  the same constraint observed in every prior round (R1 through FIX1).
  The Real Pixel Browser Test, the Section 11 runtime assertions, and
  the 4-fixture closure bar are written, wired, and syntax/import-
  verified, but have never executed against a real page here. Run
  `RUN_LUMIXA_CALIBRATION_QA_WINDOWS.bat` (or `node tools/local-gate.mjs`)
  on a machine with real Chromium and network access to close this out.
- The `qa/baselines/lufa42-production-lock-manifest.json` regeneration
  script (inherited from an earlier, unrelated EPIC) hashes every
  current `core/`+`ui/` `.js` file except a fixed geometry-EPIC allow-
  list; it does not distinguish "genuinely production-critical" files
  from "this EPIC's own in-scope files" (e.g. `core/calibration-lab/*`).
  This is a pre-existing design limitation, not introduced by FIX2 —
  Production Safety for FIX2 was verified independently via direct
  `diff` against the 8 explicitly production-critical files instead of
  relying on this manifest alone.
- All FIX1 known limitations not addressed by this round remain as
  previously documented (`export-dataset.js` CSV/JSON does not yet
  expose `previewEvidence`; migrated V1 records need re-review to count
  toward Readiness; version badge not bumped).

## Next Development Boundary

Close Final Browser Verification (the single remaining gap) on a
machine with real Chromium and network access. EPIC 2E-L remains
explicitly not started; no Deploy occurred at any point in this round;
Controlled V2 Production remains disabled throughout.
