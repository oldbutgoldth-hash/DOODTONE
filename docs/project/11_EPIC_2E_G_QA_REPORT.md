# 11 — EPIC 2E-G FINAL QA REPORT

Release audit for **AI Workflow v1.1.7 (EPIC 2E-G)**. Every result
below was actually executed in this Phase D session (Node.js
`--check`, direct module-level Node scripts against the real source,
and headless Chromium via Playwright against a local static server
serving the actual project files). No result is estimated or carried
forward without re-verification in this session, except where
explicitly noted as carried forward from a prior sub-stage session
against files that were NOT modified in this Phase D session.

| # | Test | Result | Evidence | Affected File(s) | Remaining Risk |
|---|---|---|---|---|---|
| 1 | Syntax — `node --check` on every `core/`/`ui/` JS file | PASS | 70 files scanned (standard mode), zero failures; additionally re-verified all 6 EPIC 2E-G-modified files with the stricter `.mjs`-forced ESM check | all `core/`, `ui/` | None |
| 2 | Import/export audit | PASS | All imports resolve (Python regex scan of all 70 files); `buildSideBySidePreviewComparisonV2` and `renderSideBySideComparison` exports confirmed present; zero duplicate exports across all 6 EPIC 2E-G files | listed modules | None |
| 3 | Pipeline order | PASS | grep line-number comparison in `decision-engine/index.js`: `mapped` (Legacy preset) at line 173, Side-by-Side build at line 204 — confirmed built in `buildFinalPreset()` itself (not `_buildDecision()`, which returns before `mapped` exists); Preview Sandbox (line 793) and Review State (line 839) confirmed inside `_buildDecision()`, both complete before it returns. Exactly one canonical object per run — the two `buildSideBySidePreviewComparisonV2(` call sites are mutually-exclusive try/catch branches, never both executed | `decision-engine/index.js` | None |
| 4 | Default safety | PASS | Live `buildFinalPreset()` call: `selectedProductionSource:"legacy"`, `canRenderLegacyPreview:false`, `canRenderV2Preview:false`, `canCompareVisually:false`, `rollbackPlan.available:true`, `fallbackStrategy.useLegacyMapping:true` | `decision-engine/index.js`, `mapping-v2-side-by-side-comparison.js` | None |
| 5 | Data availability tests | PASS | 5/5 sub-tests via direct Node script: empty input, Legacy-only (no V2 claim), V2-only (no Legacy claim), both-sides (15/15 dimensions produced), malformed preview objects (no crash) | `mapping-v2-side-by-side-comparison.js` | None |
| 6 | Human Review tests | PASS | 11/11 sub-tests: empty state, partial visual review, all-6-passed (approved), one `reviewed:false`, needs-adjustment, failed-without-reject (blocked), reject, failed+reject (reject priority correct), stale-approved-metadata (correctly overridden), duplicate IDs (last-wins, correctly re-verified as rejected), malformed items (no crash) | `mapping-v2-side-by-side-comparison.js` | None |
| 7 | Safety tests | PASS | 7/7: hardStops as array/number/boolean, hardStops from Sandbox-only, critical overstack (re-tested with correct `v2Preview` evidence present — confirms `saferSide:"legacy"` and `comparisonState:"blocked"`), high V2 score with missing Legacy score (`saferSide:"uncertain"`, never `"v2"`), malformed risk objects (no crash) | `mapping-v2-side-by-side-comparison.js` | None |
| 8 | Decision Report tests | PASS | Report section exists and is populated from a real pipeline run; missing-Sandbox scenario (via synthetic decision object) confirmed `previewExportDisabled`/`productionWriteDisabled` both `null`, never a false `true`; `xmpIsolation` object confirmed structurally correct (`regressionVerified:false`); `xmpUnchanged` confirmed `null` (backward-compat field, never falsely `true`); `developerSummary` confirmed compact | `decision-report-engine/index.js` | None |
| 9 | Reference Transfer | PASS | `sideBySideComparisonContext` present and `available:true` on a real pipeline run; confirmed the canonical `finalStyleIntent.sideBySidePreviewComparisonV2` reference is the same object both before and after (no rebuild, no second conflicting object) | `reference-transfer-engine/index.js` | None |
| 10 | UI tests | PASS | Real pipeline run via Playwright: section renders after analysis, exactly 1 button (the Review-Console navigation link — verified zero Export/Apply/Activate controls), Re-analyze produces no duplicate section, new-image import correctly refreshes the section. Insufficient-evidence/blocked/partial/reviewed/Legacy-only/V2-only/both-sides/malformed-comparisonMatrix/null-item/unknown-status/invalid-similarity/malformed-risks/circular-blocker/long-text/HTML-injection scenarios were exhaustively verified in the EPIC 2E-G-C-F/C-F2 sessions against this same, unmodified-since renderer file | `side-by-side-comparison-renderer.js` | Keyboard-navigation of the collapsible developer-details `<details>`/`<summary>` element was verified this session (programmatic click on `summary` correctly expanded the panel and revealed `canRenderLegacyPreview:false` etc.) — real Tab-key keyboard traversal was not independently re-verified in this specific session (native `<details>`/`<summary>` and `<button>` are keyboard-accessible by HTML specification, but this project has no automated keyboard-focus test) |
| 11 | Visual honesty | PASS | Live rendered text scanned: no "preview image exists", "V2 looks better", "V2 is visually safer", or "ready for production" phrasing found anywhere; `canRenderLegacyPreview`/`canRenderV2Preview`/`canCompareVisually` confirmed `false` in the expanded Developer Details panel of a real analysis result | `side-by-side-comparison-renderer.js` | None |
| 12 | Production isolation search | PASS | grep: zero references to `sideBySidePreviewComparisonV2` or `side-by-side-comparison-renderer` in `core/lightroom-mapping-engine/index.js`, `core/preset-engine/`, `core/xmp-validator/` | production modules (untouched) | None |
| 13 | XMP regression | PASS (byte-length + schema comparison only — see remaining risk) | Live browser test: XMP downloaded after a full analysis with the Side-by-Side Comparison section rendered — byte length identical to the pre-EPIC-2E-G baseline (2962), `crs:` schema markers intact, no `sideBySide`/`comparisonState`/`reviewItem`/`approvalState` substrings present in the XMP output | production XMP path (untouched) | This was a byte-length + substring-absence + schema-marker check, not an exhaustive field-by-field semantic diff against a saved pre-EPIC-2E-G reference file — the Decision Report's own `xmpIsolation.regressionVerified:false` field already documents this honestly rather than overclaiming a full regression suite |
| 14 | Mutation audit | PASS | JSON-snapshot-before/after comparison on `buildFinalPreset()`'s own `inputs` object (unchanged); determinism re-confirmed (two `buildFinalPreset()` calls with identical input produce byte-identical output, `_decision` excluded) | `decision-engine/index.js`, `mapping-v2-side-by-side-comparison.js` | Per-stage exhaustive mutation audit of all 12 pipeline stages individually was performed at each stage's own original QA pass, not re-run exhaustively in this single Phase D session for the 11 stages unmodified since — no code in those files changed, so no regression is expected |
| 15 | Storage audit | PASS | grep: zero storage-API calls in `side-by-side-comparison-renderer.js` and `mapping-v2-side-by-side-comparison.js`. Confirmed the only `localStorage` usage anywhere in `ui/app.js` is the pre-existing, unrelated dark-mode/language keys | listed modules | None |
| 16 | Version audit | PASS (after fix) | **Found and fixed a real bug during this audit**: header/footer static HTML title fallback was stuck at "Lightroom Mapping V2 — Overlay Preview Sandbox" — this had NEVER been updated across the entire EPIC 2E-F cycle either (a deeper, older drift than the one caught in the EPIC 2E-F Phase D audit, which only caught the version-number/status-line fallback, not the title fallback). Also found the `upgradedSystems` static list missing the two new EPIC 2E-G feature names. All fixed and re-verified live in-browser: header reads exactly `v1.1.7 (EPIC 2E-G)`, sidebar reads `v1.1.7 · Side-by-Side Data Comparison`, zero remaining `v1.1.6`/`v1.1.5` or active-UI `EPIC 2E-F` matches (two `EPIC 2E-F` matches found in `index.html` are historical code COMMENTS describing when a feature was originally built, not active UI strings, and are correctly left as-is per this phase's own instruction not to treat historical references as stale UI strings) | `core/project-version.js`, `index.html` | None remaining |

## Manual/Browser Tests Not Independently Re-run in This Session

Being explicit per the "do not mark manual tests PASS unless actually
verified" instruction:

- Real physical mobile device testing (only a 390px emulated Playwright
  viewport has ever been used, across every EPIC 2E-G sub-stage).
- Real Tab-key keyboard-focus traversal of the `<details>`/`<summary>`
  disclosure and the navigation button (programmatic `.click()` was
  used instead — functionally verifies the same code path, since
  native `<details>`/`<summary>` and `<button>` are keyboard-operable
  by HTML specification, but this is not identical to an actual
  keyboard-driven Tab/Enter test).
- Real screen-reader software testing (aria attributes were verified
  present via DOM inspection only).
- An exhaustive, field-by-field semantic XMP diff against a saved
  pre-EPIC-2E-G reference file (byte-length + schema-marker + absence
  of comparison-specific substrings was verified instead — see Test 13).
- A dedicated exhaustive per-stage mutation re-audit of all 11
  EPIC-2E-F-era pipeline stages in a single pass (each stage's own
  original QA session performed this individually; not re-run
  collectively here since none of those files changed in this session).

These are marked **NOT INDEPENDENTLY RE-VERIFIED**, not FAIL — the
underlying functionality was tested when the relevant code was written
(or, for UI tests, in the immediately-preceding EPIC 2E-G-C-F/C-F2
sessions against this exact, unmodified-since file) and has not
regressed since.

## Root Cause Note: The Deeper Stale-Title Bug (Test 16)

Worth documenting honestly: the EPIC 2E-F Phase D audit caught and
fixed a stale version-number/status-line fallback that had drifted
since "before Phase B" — but it did NOT catch the title fallback
("Lightroom Mapping V2 — Overlay Preview Sandbox"), which had actually
been stale for far longer — arguably since before EPIC 2E-F even
started, since that title string references EPIC 2E-E's feature name,
not EPIC 2E-F's. This means the EPIC 2E-F Phase D "stale version"
sweep was incomplete: it fixed the fields it happened to grep for
(`v1.1.4`, `EPIC 2E-E`, the status line) but missed the separate
`aiWorkflowHeaderTitle`/`aiWorkflowTitle` fields entirely, because they
weren't in that session's specific search list. This Phase D session's
grep was broader (search for the actual CURRENT title string as well
as version numbers) and caught it. The lesson reinforced again: a
stale-version sweep needs to check literally every field the dynamic
script writes to, not just the ones that happen to be top-of-mind for
that particular release.

## Release Decision

**CONDITIONAL PASS — Safe but manual QA remains.**

Justification against the release-decision criteria:

- No syntax errors exist (Test 1: 70/70 files pass, both check methods).
- No import failures (Test 2).
- Production source does not change (Test 4, 10, 11: `selectedProductionSource` stays `"legacy"` in every tested scenario, including full Human Review approval).
- Visual renderability never becomes true (Test 11: `canRenderLegacyPreview`/`canRenderV2Preview`/`canCompareVisually` confirmed `false` in every scenario).
- Preview Export/Production Write never become active (Test 4, 8: tri-state evidence, never a false "confirmed enabled").
- XMP did not change unexpectedly (Test 13: byte-length/schema/substring-absence verified, though not an exhaustive semantic diff — documented as a residual gap, not hidden).
- The comparison never enters the production path (Test 3, 12: built after `mapped`, zero production-file references).
- Injected HTML cannot execute (verified in the EPIC 2E-G-C-F/C-F2 sessions against this exact, unmodified renderer).
- The UI never falsely claims preview images exist (Test 11).
- All required files are present (verified during ZIP packaging below).

The CONDITIONAL qualifier reflects the explicitly-documented remaining
gaps: no real-device mobile testing, no real-keyboard/screen-reader
testing, no exhaustive semantic XMP diff, and no persisted/automated
browser test suite. None of these gaps are release-BLOCKING per the
stated criteria, but none should be considered fully closed either.
