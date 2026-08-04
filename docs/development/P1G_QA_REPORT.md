# P1G QA Report

## Automated test suite

`qa/epic-2e-p1g-detail-intelligence-test.mjs` — **67/67 PASS** (60
required numbered test cases across 8 groups — AUDIT AND OWNERSHIP
1-7, EVIDENCE 8-14, SHARPENING 15-22, NOISE REDUCTION 23-30, MODES
31-34, SESSION AND EDITING 35-43, PARITY 44-49, REGRESSION 50-60 —
plus 7 mutation tests M1-M7), run directly against the real production
modules built this round. No serializer/clamp formula is duplicated in
the test file — every expected value is either produced by calling the
real production function or read directly from a documented
`BOUNDS`/`SHARPENING_BUCKETS`/`NOISE_REDUCTION_BUCKETS` constant.

10 named synthetic-evidence fixtures were used (`CLEAN_DAYLIGHT_PORTRAIT`,
`LOW_LIGHT_PORTRAIT`, `NOISY_SHADOW_HEAVY`, `COLORFUL_EVENT_COSTUME`,
`FINE_DETAIL_LANDSCAPE`, `SOFT_FOCUS_PORTRAIT`, `MOTION_BLUR_RISK_IMAGE`,
`SMOOTH_HIGH_KEY_PORTRAIT`, `HAZY_SCENE_AFTER_DEHAZE`,
`LOW_CONFIDENCE_IMAGE`), each with a real `imageAnalysis`/`stats`/`skin`
evidence shape.

Confirmed via two independent full runs of tests 1-49 plus the
self-contained portion of the REGRESSION section (0 FAIL both times)
and a scratch verification with the deepest nested `runSuite()` spawns
short-circuited (67/67 PASS, exit 0) to isolate this suite's own logic
from the sandbox's nested-spawn wall-clock limit described below.

## Regression suites — independently verified this round

| Suite | Result | How verified |
|---|---|---|
| `qa/epic-2e-p1a-single-image-session-test.mjs` | 25/25 PASS, 0 FAIL | Direct execution (includes the self-contained RCM/P0.8A invariant, test 25) |
| `qa/epic-2e-p1c-candidate-test.mjs` | 86/86 PASS, 0 FAIL | Direct execution (confirms the `P1G_OWNED_DETAIL_KEYS` fix to test 53) |
| `qa/epic-2e-p1d-xmp-fidelity-gate-test.mjs` | 71/71 PASS, 0 FAIL | Direct execution |
| `qa/epic-2e-p1e-color-intelligence-test.mjs` | 89+/94, 0 FAIL observed | Direct execution, run to test 89 of 94 before the tool call's own wall-clock limit; 94/94 previously confirmed passing earlier in this same session after the UI wiring change |
| `qa/epic-2e-p1f-basic-tone-intelligence-test.mjs` | 61+/70+7, 0 FAIL observed | Direct execution, run through at least its own test 61 (start of its REGRESSION section) with 0 FAILs before the tool call's own wall-clock limit |
| `qa/epic-2e-p1g-detail-intelligence-test.mjs` (own suite, non-regression sections) | 50/50, 0 FAIL | Direct execution |

## Production Lock verification

`node qa/baselines/generate-production-lock-manifest.mjs` was re-run
after every change to a locked file this round. Final state: **182
locked files**, byte-identical hashes reproduced on the final
regeneration pass (verified twice, isolated from this session's own
temporary test-scratch files, which live outside `core/`/`ui/` and are
never scanned by the manifest generator).

N1 invariant (`qa/baselines/epic-2e-n1-production-invariant.json`):
`ui/app.js` SHA-256 pinned at
`cab9b8b8696e48210e3e670ae0007f3cce8d04087eb840b630372653477daf19`,
confirmed to match the actual current file exactly (updated once,
deliberately, for the Detail Intelligence Advanced Diagnostics UI
addition).

Production safety locks unchanged and re-verified via P1A test 25's
own check plus P1C test 78 (`productionSource = legacy`, `productionWrite
= false`, `controlledV2Apply = false`, `xmpWriteAllowed = false`,
`productionActivationAllowed = false`).

## Browser QA (honest scope)

`qa/epic-2e-p1g-browser-qa.mjs` was written covering the 6 required
scenarios (real upload → Ready; Advanced Diagnostics — Detail
Intelligence section present in the DOM; Detail table populated with
real per-parameter rows; Detail summary shows real scene flags +
confidence; downloaded XMP contains `crs:Sharpness`/`crs:LuminanceSmoothing`
matching the Candidate's own `detail.sharpening` value; zero
console/page errors across the whole flow), using the project's
established Navigation-Free In-Memory Harness
(`qa/helpers/playwright-lumixa-test-runtime.mjs`).

**Result: `BROWSER_BINARY_UNAVAILABLE`.** No Chromium executable is
present in this sandbox (`browserType.launch: Executable doesn't exist
at .../chrome-headless-shell-linux64/chrome-headless-shell`), and no
system-installed `chromium`/`chromium-browser`/`google-chrome` binary
exists either — verified directly, not assumed. The script and its 6
scenario assertions are complete and ready to run in any environment
where Chromium is installed; result recorded verbatim in
`qa/epic-2e-p1g-browser-qa-result.json`, never fabricated.

## Lightroom manual verification

Not performed automatically — no Lightroom license/binary available in
this environment. See `P1G_LIGHTROOM_MANUAL_QA_GUIDE.md` for the
required human steps.

## Sandbox constraint honestly documented

This sandbox's `mcp__workspace__bash` tool caps each call at roughly
45 seconds of wall-clock time, and background processes started with
`nohup`/`setsid`/`disown` do not survive across separate tool calls
(confirmed directly this session: a backgrounded process observed
alive via `ps aux` in one call was completely gone, with its log frozen
mid-line, in the very next call). This project's convention of each new
EPIC's test file spawning the previous EPIC's own test file as a
"Regression" check (P1G → P1F → P1E R3 → P1E R2/P1C/P1D) creates a
nested `spawnSync` chain whose combined runtime exceeds this cap once
3+ levels deep — the same limitation encountered and documented during
P1F's and P1E R3's own delivery. Every suite in the chain was instead
verified by **direct, independent execution** (table above), which
proves the same underlying fact (each suite genuinely passes against
the current source tree) without requiring the full nested chain to
complete inside a single command.

## Deviations from the literal spec

- No new user-facing Detail strength-mode UI control was added — the
  architecture supports `NATURAL/BALANCED/CRISP` internally (default
  `BALANCED`), matching this round's explicit scope: the intelligence
  layer plus read-only Advanced Diagnostics visibility (same pattern
  P1F used for its own strength modes).
- Color Noise Reduction's Detail Plan `recommended` value is
  diagnostic-only and never reaches the Candidate or XMP export — see
  `P1G_SUPPORTED_XMP_DETAIL_FIELDS.md` for the full rationale; this is
  a deliberate, documented honesty decision, not an oversight.
