# P1F QA Report

## Automated test suite

`qa/epic-2e-p1f-basic-tone-intelligence-test.mjs` — **77/77 PASS**
(70 required numbered test cases across 11 groups — AUDIT AND
OWNERSHIP 1-7, SCENE CLASSIFICATION 8-13, EXPOSURE 14-18,
HIGHLIGHTS/SHADOWS 19-23, WHITES/BLACKS 24-28, CONTRAST 29-33, LOCAL
CONTRAST 34-39, MODES 40-42, SESSION AND EDITING 43-50, PARITY 51-60,
REGRESSION 61-70 — plus 7 mutation tests M1-M7), run directly against
the real production modules built this round. No serializer/clamp
formula is duplicated in the test file — every expected value is
either produced by calling the real production function or read
directly from a documented `BOUNDS`/`HARD_LIMITS` constant.

10 named synthetic-evidence fixtures were used (`BALANCED_PORTRAIT`,
`UNDEREXPOSED_PORTRAIT`, `OVEREXPOSED_WHITE_CLOTHING`,
`HIGH_KEY_BRIDAL`, `LOW_KEY_PORTRAIT`, `COLORFUL_EVENT_COSTUME`,
`GREEN_OUTDOOR_PORTRAIT`, `HAZY_LANDSCAPE`, `LOW_CONTRAST_INDOOR`,
`HDR_SCENE`), each with a full histogram-engine-shaped `stats` object
(`avgLum, contrast, drStops, contrastRatio, clipHiPct, clipLoPct,
blackPoint, whitePoint, avgSatPct, confidence, total, category`).

## Full static suite verification

All **70 suites** registered in `qa/run-static-suites.mjs` (including
the newly-added `epic-2e-p1f-basic-tone-intelligence-test.mjs`) were
run to completion this round — every suite reported its own internal
`N/N PASS, 0 FAIL` (or, for the pre-existing Browser-dependent static
self-tests, the honest `BROWSER_BINARY_UNAVAILABLE` decision those
suites have always reported in this sandbox, unrelated to this round).
Zero failures across all 70 suites. Key regression suites of direct
relevance to this EPIC:

| Suite | Result |
|---|---|
| `qa/epic-2e-p1a-single-image-session-test.mjs` | 25/25 PASS |
| `qa/epic-2e-p1c-candidate-test.mjs` | 86/86 PASS (7 assertions updated this round for the now-real Basic values — see `P1F_MODIFIED_FILES.md`) |
| `qa/epic-2e-p1c-r2-candidate-lifecycle-order-test.mjs` | 19/19 PASS |
| `qa/epic-2e-p1c-r3-user-edit-xmp-export-test.mjs` | 39/39 PASS |
| `qa/epic-2e-p1d-xmp-fidelity-gate-test.mjs` | 71/71 PASS |
| `qa/epic-2e-p1e-color-intelligence-test.mjs` | 94/94 PASS |
| `qa/epic-2e-p1e-r3-parity-creative-tone-test.mjs` | 62/62 PASS |
| `qa/epic-2e-p1f-basic-tone-intelligence-test.mjs` | 77/77 PASS |

## Production Lock verification

`node qa/baselines/generate-production-lock-manifest.mjs` was
re-run after every change to a locked file this round. Final state:
**173 locked files**, byte-identical hashes reproduced on the final
regeneration pass (no drift since the last legitimate update).

N1 invariant (`qa/baselines/epic-2e-n1-production-invariant.json`):
`ui/app.js` SHA-256 pinned at
`c9795818364d6d9d6f1e11172aa7bf2a2a93a9eda2d21bc13bba88ce1e80b7fe`,
confirmed to match the actual current file exactly (updated once,
deliberately, for the Advanced Diagnostics UI addition).

Production safety locks unchanged and re-verified: `productionSource
= legacy`, `productionWrite = false`, `controlledV2Apply = false`,
`xmpWriteAllowed = false`, `productionActivationAllowed = false`.

## Browser QA (honest scope)

`qa/epic-2e-p1f-browser-qa.mjs` was written covering the 6 required
scenarios (real upload → Ready; Advanced Diagnostics — Basic Tone
Intelligence section present in the DOM; Basic Tone table populated
with real per-parameter rows; Basic Tone summary shows a real scene
class + confidence; downloaded XMP contains all 9 real Basic-panel
properties matching the Candidate's own `basic.exposure` value; zero
console/page errors across the whole flow), using the project's
established Navigation-Free In-Memory Harness
(`qa/helpers/playwright-lumixa-test-runtime.mjs`).

**Result: `BROWSER_BINARY_UNAVAILABLE`.** No Chromium executable is
present in this sandbox, and `npx playwright install chromium` fails
with `403 Connection blocked by network allowlist` when attempting to
download one — verified directly, not assumed. The script and its 6
scenario assertions are complete and ready to run in any environment
where Chromium is installed; result recorded verbatim in
`qa/epic-2e-p1f-browser-qa-result.json`, never fabricated.

## Lightroom manual verification

Not performed automatically — no Lightroom license/binary available in
this environment. See `P1F_LIGHTROOM_MANUAL_QA_GUIDE.md` for the
required human steps.

## Deviations from the literal spec

- The spec referenced an uploaded baseline archive ("LU7099~1.ZIP")
  that was not present in this session's uploads folder. Per Auto Mode
  convention, the just-delivered, fully-verified P1E R3 project was
  used as the baseline instead, since it already contained every file
  the spec's audit required.
- No new user-facing Basic Tone strength-mode UI control was added —
  the architecture supports `NATURAL/BALANCED/DRAMATIC` internally
  (default `BALANCED`), but this round's explicit scope was the
  intelligence layer plus read-only Advanced Diagnostics visibility.
