# EPIC 2E-P1B — QA Report

## 1. Automated static/integration tests (35 required + 1 bonus)

`qa/epic-2e-p1b-analysis-report-test.mjs`, run directly against the real
Production modules (no mock Core formulas). Fresh run from this exact
working copy:

```
39/39 PASS, 0 FAIL
```

| # | Case | Result |
|---|---|---|
| 1 | Report schema completeness — errors=[] | PASS |
| 2 | Report built from active session.evidence | PASS |
| 3 | Report stored in session.report | PASS |
| 4 | Report sessionId matches active Session | PASS |
| 5 | Report generationId matches active Session | PASS |
| 6 | Stale Session report cannot commit | PASS |
| 7 | Completed Session -> COMPLETE report | PASS |
| 8 | Partial Session -> PARTIAL report | PASS |
| 9 | Missing optional evidence -> UNAVAILABLE section | PASS |
| 10 | Missing evidence -> confidence stays null/UNAVAILABLE, never fabricated | PASS |
| 11 | Confidence values stay within 0-100 | PASS |
| 12 | Low WB neutral evidence -> caution warning | PASS |
| 13 | Dominant green background alone -> background note, not global WB cast claim | PASS |
| 14 | Skin section reflects real detection evidence | PASS |
| 15 | High-key protected-highlight image classified highKey, not overexposed | PASS |
| 16 | Dark scene with limited crushing classified lowKey, not underexposed | PASS |
| 17 | Observations and recommendations are separate arrays with no overlapping codes | PASS |
| 18 | Technical issues only generated when evidence supports them | PASS |
| 19 | No undefined values anywhere in the built report | PASS |
| 20 | No NaN or Infinity anywhere in the built report | PASS |
| 21 | Language change re-renders report from snapshot, never rebuilds/reruns analysis | PASS |
| 22 | Report renderer never calls analysis/build functions when rendering/toggling sections | PASS |
| 23 | Advanced Diagnostics block reads only the already-built report, never re-runs analysis | PASS |
| 24 | Candidate generation (buildFinalPreset) never called from any P1B report module | PASS |
| 25 | XMP generation (serializeXMP/validateFinalPreset) never called from any P1B report module | PASS |
| 26 | handleDownload() never calls runAnalysis or buildAndCommitReport | PASS |
| 27 | New upload clears the old report via handleReset() before the new Session begins | PASS |
| 28a-c | session.report lifecycle across reset (present -> UI cleared -> nulled) | PASS |
| 29, 29b | reportBuildCount tracked; buildAndCommitReport() called exactly once per runAnalysis() | PASS |
| 30 | Report lineage references real evidence keys and source modules | PASS |
| 31 | Existing P1A R3 suites (25/25 + 16/16) still pass unmodified | PASS |
| 32 | P0.8A / RCM pinned-baseline invariant test passes | PASS |
| 33 | RCM files remain byte-identical to the pinned P0.8A baseline | PASS |
| 34 | Candidate/XMP-path files byte-identical; P1B modules never imported by them | PASS |
| 35 | Production safety locks remain locked | PASS |
| Bonus | Every report i18n key resolves in both Thai and English | PASS |

Full static suite (`node qa/run-static-suites.mjs`): **63/63 suites
PASSED** (62 P1A-era suites + the new P1B suite), fresh re-run from this
working copy, exit code 0.

## 2. Locale-switch allowlist maintenance (not a regression)

`qa/epic-2e-j-locale-switch-rerender-static-test.mjs` maintains an
explicit allowlist of functions `rerenderCurrentUiForLocale()` may call.
Adding the report's locale re-render branch initially failed this test
(`unexpectedCalls: ["renderSingleImageReport"]`) — correctly, since this
is a genuinely new call. Fixed by adding
`'renderSingleImageReport'` to the allowlist with an explanatory
comment; `renderSingleImageReport` is independently verified pure (no
analysis/build calls) by P1B cases 21-23. Re-run: 29/29 PASS.

## 3. P1A R3 regression re-verification

Re-ran, unmodified, from this working copy:
- P1A core suite: 25/25 PASS.
- P1A R3 upload-lifecycle integration suite: 16/16 PASS.

Confirms: reset-before-beginUpload ordering, per-upload ticket capture,
duplicate-Analyze prevention, and stale-callback rejection all remain
exactly as P1A R3 shipped them — `ui/app.js`'s additive P1B edits do not
touch any of these code paths (see the diff excerpt in
`P1B_MODIFIED_FILES.md`).

## 4. P0.8A / Reference Color Match invariant verification

- `qa/epic-2e-p0-8a-preview-artifact-repair-static-test.mjs`: re-run,
  passing, unmodified.
- Every RCM-exclusive file (PAIRWISE_FAST/REFINED profiles, Preview
  State Machine, cached Intensity rerender, Candidate Preview Renderer,
  Gaussian HSL blending, float Tone Curve LUT, skin/white protection,
  Save After Image) confirmed byte-identical to the pinned P0.8A
  baseline — verified by test case 33, which byte-diffs each file
  directly rather than trusting a hash alone.

## 5. Candidate/XMP isolation verification

Test case 34 confirms, by direct byte-diff against the P1A R3 baseline:
`core/decision-engine`, `core/preset-engine`, `core/xmp-validator`, and
`core/lightroom-mapping-engine` are unchanged, and none of them import
anything from `core/single-image/report/` — the report can describe a
recommendation in its text but has no code path that can modify a
Candidate or XMP value.

## 6. Production safety lock verification

Test case 35 re-confirms: `productionSource: 'legacy'`,
`productionWrite: false`, `controlledV2Apply: false`,
`xmpWriteAllowed: false`, `productionActivationAllowed: false` — all at
their locked values in the real `ui/app.js` runtime configuration, not
just in a baseline file.

`qa/baselines/epic-2e-n1-production-invariant.json`: the `ui/app.js`
hash was updated (expected — editing that file always invalidates its
own pinned hash, exactly as every prior EPIC 2E round that touched
`ui/app.js` did). The other 5 pinned files
(`core/lightroom-mapping-engine/index.js`, `core/preset-engine/index.js`,
`core/xmp-validator/index.js`, `ui/ui-engine.js`,
`core/color-match/reference-xmp-generator.js`) were confirmed
byte-identical via `diff -q` against the P1A R3 originals **before**
updating the manifest.

`qa/baselines/lufa42-production-lock-manifest.json`: regenerated via
the project's own generator script; now locks 145 files (up from 139),
the 6 new entries being the 5 new report modules plus the new renderer.

## 7. Browser QA — honest status

This sandbox cannot execute a real browser, confirmed by two
independent checks, consistent with every prior EPIC 2E round in this
project:

1. `node qa/preflight.mjs` reports `binaryStatus:
   "BROWSER_BINARY_UNAVAILABLE"` — all 6 checked Chromium/Chrome paths
   (Playwright's bundled Chromium, `/usr/bin/chromium`,
   `/usr/bin/chromium-browser`, `/usr/bin/google-chrome`,
   `/usr/bin/google-chrome-stable`, `/opt/google/chrome/chrome`) report
   `exists: false`.
2. `timeout 15 node qa/epic-2e-p1b-analysis-report-browser-test.mjs`
   (the new P1B browser suite) fails closed correctly and quickly:

```json
{
  "decision": "BROWSER_BINARY_UNAVAILABLE",
  "reason": "Chromium failed to launch: browserType.launch: Executable doesn't exist at .../chrome-headless-shell-linux64/chrome-headless-shell ... Run: npx playwright install chromium (requires network access to cdn.playwright.dev, which this session's sandbox blocks).",
  "pass": 0, "fail": 0, "total": 8
}
```

No PASS was fabricated for any scenario; every one of the 8 required
scenarios below is reported `NOT_VERIFIED` with the same honest reason.

### Required scenarios — unverified in this environment

| # | Scenario | Expected outcome (unverified here) |
|---|---|---|
| 1 | Portrait image | Skin section available, report completes, no rerun from report interaction |
| 2 | High-key wedding image | Highlight info shown, not auto-classified overexposed, WB confidence honest |
| 3 | Green outdoor image | Dominant green reported, no unsupported "green WB cast" claim |
| 4 | Low-key image | Low-key scene recognized, not auto-marked failed exposure |
| 5 | Image without a person | Skin section "not detected," no invented skin values |
| 6 | Image B uploaded during Image A analysis | Image A aborted; Image A's report cannot render into Image B's Session |
| 7 | Language change | Report text changes; analysis/report-build counters unchanged |
| 8 | Generate + download XMP | No new analysis triggered; existing XMP behavior unchanged |

`qa/epic-2e-p1b-analysis-report-browser-test.mjs` is complete and ready
to run wherever Chromium is available — see `npm run test:p1b:browser`.
The unit-level equivalents of scenarios 2, 3, 5, and 7 (WB safety
phrasing, background-color-vs-cast distinction, skin-absent handling,
locale-only re-render) are independently covered at the pure-function
level by static test cases 12, 13, 14, and 21 — those specific claims
are verified, just not yet end-to-end in a real rendered page in this
sandbox.

## 8. Final acceptance checklist

| # | Item | Status |
|---|---|---|
| 1 | Report built only from session.evidence | Verified (case 2) |
| 2 | No DOM/slider/synthetic evidence read | Verified (builder signature audit + case 2) |
| 3 | Report stored on session.report, generation-gated | Verified (cases 3-6) |
| 4 | Report never rebuilt on UI interaction | Verified (cases 21-26, 29b) |
| 5 | Schema validation catches undefined/NaN/Infinity/circular | Verified (cases 19-20 + schema unit checks) |
| 6 | Confidence never inflated; documented method | Verified (case 11 + `P1B_CONFIDENCE_MODEL.md`) |
| 7 | WB background-vs-cast safety example holds | Verified (case 13) |
| 8 | High-key/low-key not misclassified | Verified (cases 15-16) |
| 9 | Skin "not detected" never invents values | Verified (case 14) |
| 10 | Technical issues only when evidence supports them | Verified (case 18) |
| 11 | Observation/recommendation separation | Verified (case 17) |
| 12 | Thai/English coverage complete | Verified (Bonus case) |
| 13 | Report clears on new upload / reset | Verified (cases 27, 28a-c) |
| 14 | P1A R3 lifecycle unaffected | Verified (case 31, 25/25 + 16/16) |
| 15 | P0.8A/RCM untouched | Verified (cases 32-33) |
| 16 | Candidate/XMP untouched | Verified (case 34) |
| 17 | Production locks unchanged | Verified (case 35) |
| 18 | Final ZIP passes tests from a clean extraction | Verified in packaging step, see delivery message |

Browser QA (item not numbered above, covered separately in §7) remains
honestly unverified in this sandbox — every other item is verified by
an automated, reproducible test against real Production source.
