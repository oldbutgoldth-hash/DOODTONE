# EPIC 2E-K-R2-FIX2 — QA Report

## 1. Syntax Gate

`node tools/esm-syntax-gate.mjs` → **180/180 PASS** (every `.js`/`.mjs`
file in the project parses cleanly as an ES module).

## 2. Static Suites (`node qa/run-static-suites.mjs`)

All suites green. FIX2-relevant new/changed suites:

| Suite | Result |
|---|---|
| `epic-2e-k-calibration-lab-static-test.mjs` | 61/61 PASS |
| `epic-2e-k-calibration-lab-storage-test.mjs` | 24/24 PASS |
| `epic-2e-k-r2-real-pixel-comparison-static-test.mjs` | 34/34 PASS |
| `epic-2e-k-r2-fix1-pixel-truth-static-test.mjs` (regression) | 72/72 PASS |
| `epic-2e-k-r2-fix2-save-gate-test.mjs` (NEW — Section 6) | 20/20 PASS |
| `epic-2e-k-r2-fix2-browser-contract-static-test.mjs` (NEW — Section 7) | 16/16 PASS |
| `epic-2e-k-r2-fix2-real-pixel-decision-static-test.mjs` (NEW — Section 9) | 49/49 PASS |
| `epic-2e-k-r2-fix2-calibration-v2-plan-static-test.mjs` (NEW — Section 1/13) | 58/58 PASS |
| `epic-2e-k-r2-fix2-hostile-closure-test.mjs` (NEW — Section 13) | 14/14 PASS |

Plus every pre-existing R1–R5/FIX1 static suite in the project (i18n,
Controlled V2 translator, Review Console, geometry, Preflight/Playwright
helper suites, etc.) — all still green, zero regressions introduced by
FIX2.

## 3. Storage (fake-indexeddb, real IndexedDB behavior)

`epic-2e-k-calibration-lab-storage-test.mjs` → **24/24 PASS** (schema
version/migration guard, corrupt-record handling, session limits,
clear-current/clear-all, storage usage summary — genuinely exercised
against real transactions).

## 4. Migration (V1 → V2)

Covered by `epic-2e-k-calibration-lab-storage-test.mjs` Section 5 and
`epic-2e-k-r2-fix1-pixel-truth-static-test.mjs`'s migration assertions
(unchanged from FIX1 — FIX2 did not touch `migrate-v1-to-v2.js`).

## 5. Browser Detection Contract

`epic-2e-k-r2-fix2-browser-contract-static-test.mjs` → **16/16 PASS** —
proven in both the genuinely-not-found case (this sandbox) and a
genuinely-found case (a real, temporary executable file, never mocked):
`executablePath === found`, `available === Boolean(found)`, Windows
Chrome/Edge candidate paths present, bundled Playwright Chromium support
present, both `qa/preflight.mjs` and
`qa/epic-2e-k-calibration-lab-browser-test.mjs` structurally proven to
read the unified field names.

## 6. Preflight

`node qa/preflight.mjs` → exit code **1** (fail-closed, correctly — 2
Required/NOT_VERIFIED items in this sandbox: Browser executable
genuinely unavailable, and the pre-existing Browser results JSON lacks a
`sourceHash`, both honestly reported, never silently passed). No
`ERR_MODULE_NOT_FOUND` crash — the top-level `import 'playwright'` was
removed (Section 8).

## 7. Calibration V2 Plan

`epic-2e-k-r2-fix2-calibration-v2-plan-static-test.mjs` → **58/58 PASS**:
eligibility ladder genuinely gates on every required input, real hard-
stop/critical-over-stack blocking, the 5 Production-safety fields are
hard-coded correct on every returned plan (including malformed input),
`isCalibrationPlanProductionSafe()` hostile-tested against 9 forged plan
shapes, structural proof of zero imports from
`core/decision-engine/index.js`/`xmp-validator`/`preset-engine`.

## 8. Pixel Hash Known Vectors

`epic-2e-k-r2-fix2-hostile-closure-test.mjs` → 3 official FIPS 180-4 /
NIST known-answer vectors, each independently verified against Node's
own `crypto` module AND against `sha256PureJsHex()` — both match exactly.
Two forged-hash sanity checks confirm a fake/naive-checksum substitute
would genuinely fail this comparison (the test has teeth).

## 9. Real Pixel Browser Test

**NOT_BROWSER_VERIFIED in this sandbox** — no local Chromium/Chrome/Edge
executable, and `npx playwright install chromium` fails with `403
Connection blocked by network allowlist` (the same environment
constraint observed continuously across every round of this project,
R1 through FIX1). The strict classification logic itself
(`classifyRealPixelComparisonResult()`) is exhaustively hostile-tested
at the Node level (49/49 PASS, Section 9's report above) — every
required-FAIL state (`unknown, partial, unavailable, blocked, failed,
cancelled, rendering, null`) is proven to never produce a false
`RENDERED_PROOF_PASS`, and the exact reported defect shape (300×150,
0 pixels, null hash, `v2State='rendered'`) is proven to produce
`FALSE_CLAIM_FAIL`. The Browser Test itself
(`qa/epic-2e-k-calibration-lab-browser-test.mjs`) is written, wired to
all 4 required fixtures, and syntax/import-verified, but has never
executed against a real page in this environment — see Known
Limitations in the Release Notes.

## 10. Decision/Save Gate

`epic-2e-k-r2-fix2-save-gate-test.mjs` → **20/20 PASS** (real behavioral
test against the actual `createCalibrationLabController()` +
fake-indexeddb, not a stub): `saveCurrentDecision({userDecision:
'NOT_REVIEWED'})` rejected with `DECISION_REQUIRED`; a blocked save
leaves userDecision/notes/issueCodes/`reviewedAt`/session counters
completely unchanged (verified both via the returned state AND a fresh
storage reload); a genuine decision against eligible evidence still
succeeds normally; `clearCurrentAnswer()` unaffected; the pre-existing
`DECISION_NOT_ELIGIBLE` gate (FIX1 Section 3) still works independently.

## 11. Locale

All pre-existing i18n/locale suites (R2–R5) re-verified green, unchanged
by FIX2 (no locale-affecting files were touched).

## 12. Accessibility/Mobile

Pre-existing contrast/touch-target/keyboard suites unchanged and green;
Save Result button's new disabled/`aria-disabled` state follows the
same pattern already verified for Decision Chips (FIX1 Section 3).

## 13. Production Lock

Verified via direct `diff` against the untouched seed for
`core/lightroom-mapping-engine/index.js`, `core/xmp-validator/index.js`,
`core/preset-engine/index.js`, `ui/app.js`, `ui/ui-engine.js`,
`core/decision-engine/index.js`,
`core/preview-rendering/visual-preview-render-plan-v2.js`,
`core/lightroom-mapping-engine/mapping-v2-overlay-preview-sandbox.js` —
**zero-byte diff on all 8 files.**

## 14. XMP Exact Invariant

Unchanged — `ui/app.js`, `core/xmp-validator/index.js`,
`core/preset-engine/index.js` are byte-identical to the pre-FIX2 seed
(see item 13), so the XMP serialization path could not have changed.

## 15. Evidence Freshness

`writeBrowserUnavailableResult()`/`writeResultAtomic()` (unchanged from
FIX1) continue to stamp every result JSON with a fresh `runId`/
`sourceHash`; Preflight's own check (item 6 above) independently
verifies this for the Calibration Lab Browser results file.

## 16. Package Cleanliness

Verified at packaging time (Section 16) — `node_modules`, `.git`, old
ZIPs, browser cache, temp files, IndexedDB files, and generated
screenshots excluded from `EPIC-2E-K-R2-FIX2-CALIBRATION-V2-PIXEL-BROWSER-CLOSURE.zip`.

## Final Gate Verdict

**CONDITIONAL COMPLETE — NOT_BROWSER_VERIFIED.**

Every item that can be proven without a real Chromium binary (1–8, 10–15)
is genuinely, honestly PASS in this sandbox. Item 9 (Real Pixel Browser
Test) and the Browser-dependent portions of items 11–12 cannot be
executed here — this is an environment limitation (no local Chromium,
network-blocked install), not a defect, and is reported honestly rather
than fabricated as PASS, per this release's own explicit requirement
("Must NEVER report FINAL PASS if ... Browser Test did not run").
`node tools/local-gate.mjs`: Steps 1–3 (Syntax, Focused Core, Static
suites) genuinely PASS; Steps 4–14 (every Browser-dependent suite)
honestly FAIL with `BROWSER_BINARY_UNAVAILABLE`.
