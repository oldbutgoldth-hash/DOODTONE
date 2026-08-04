# P1H — QA Report

## New suite

`qa/epic-2e-p1h-white-balance-intelligence-test.mjs` — **118/118 PASS**.

Sections: 1 Audit & Ownership (1-8), 2 Evidence Extraction (9-18),
3 Neutral-Reference Confidence (19-23), 4 Illuminant/Object-Color-Bias
Separation (24-32), 5 Skin-Consistency Validation (33-39), 6 Mixed-Light
Detection (40-47), 7 Cast Classification (48-56), 8 Temp/Tint Model &
Guardrails (57-66), 9 Strength Modes (67-71), 10 Candidate Integration
(72-82), 11 Export/Parity/XMP (83-90), 12 Regression (91-98) + Mutation
Tests M1-M10.

Registered in `qa/run-static-suites.mjs`.

## Fixed during development

Check 26 ("non-green background + neutral subject also classified as
object-color bias") initially failed: the spatial-separation-only term
in `bgObjectColorRisk` contributed only +0.4, below the 0.5
classification threshold, for a pure red/warm-background case (no
`bgGreenDominant` flag). Raised that term's weight to +0.6 in
`wb-evidence-extractor.js`. Re-run: 118/118 pass.

## Full regression (all pre-existing suites, zero new failures)

P1G R2, P1G R1, P1F, P1E R3, P1D, P1C, P1C R2, P1C R3, P1A R3, P1B — all
pass unchanged. P1D/P1C/P1C R3's own nested checks independently
re-confirm P1A and P0.8A/RCM invariants remain intact.

## Production Lock

- `qa/baselines/generate-production-lock-manifest.mjs` re-run: "Wrote
  192 locked-file hashes" (reflects the `index.html` diagnostics-panel
  addition).
- `qa/baselines/epic-2e-n1-production-invariant.json`: `ui/app.js`
  pinned hash deliberately updated to the new file's real SHA-256 (the
  documented per-EPIC-round convention — see P1G R2 checks 59-60 for
  precedent). All other pinned hashes/locks unchanged and re-verified
  correct.
- Locks confirmed still exactly: `productionSource=legacy,
  productionWrite=false, controlledV2Apply=false, xmpWriteAllowed=false,
  productionActivationAllowed=false`.

## Syntax/ESM verification

- `node --check` passes on every edited/new file.
- `node --input-type=module -e "import(...)"` passes on every new
  `core/` module and on `candidate-builder.js`.
- `ui/app.js` ESM import fails with `localStorage is not defined` under
  plain Node — reproduced identically against the untouched P1G R2
  baseline, confirming this is a pre-existing, browser-only-execution
  condition, not a P1H regression.
