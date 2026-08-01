# EPIC 2E-P1A — QA Report

**R2 correction notice:** R1's `P1A_QA_REPORT.md` claimed 25/25 and
62/62 based on a test run inside the working repository, where test 25
("Reference Color Match behavior remains unchanged") silently resolved
an external directory (`../../lumixa_p08a/r1_work`) that existed on
disk at the time but was never included in the shipped R1 ZIP. Anyone
extracting the R1 ZIP standalone got `24/25 PASS, 1 FAIL` on that test,
and `qa/run-static-suites.mjs` exited non-zero as a result — the R1
report's claims did not hold for the delivered package itself. This was
a real defect, not a flaky/environmental issue, and it has been fixed in
R2: test 25 now compares against a SHA-256 baseline pinned inside
`qa/baselines/p0-8a-reference-color-match-invariant.json`, which ships
in the ZIP. See `P1A_MODIFIED_FILES.md` for the exact diff. The results
below are from a run of the corrected test **against a fresh,
standalone extraction of the R2 ZIP** — not the working repository —
confirming the fix holds for the actual delivered package.

## 1. Automated tests (25 required cases) — `qa/epic-2e-p1a-single-image-session-test.mjs`

Imports the real production modules directly (no fakes/mocks of Core
formulas — a `fakeFile()` helper only stands in for a browser `File`
object, since Node has no `File` global). Test 25 is now self-contained
— see §1a below.

```
1.  Session schema completeness .................. PASS
2.  Unique sessionId for each new upload .......... PASS
3.  Unique generationId per analysis generation ... PASS
4.  New upload aborts old Session ................. PASS
5.  Stale Session cannot update active Session .... PASS
6.  Duplicate Analyze calls do not duplicate Core . PASS
7.  Each Core module runs at most once per Session  PASS
8.  Decode occurs once per Session ................ PASS
9.  Analysis proxy created once per Session ....... PASS
10. Optional Core failure -> normalized null evid.  PASS
11. Required decode failure -> FAILED Session ..... PASS
12. Reset aborts active work ...................... PASS
13. Legacy mirrors Session evidence correctly ..... PASS
14. Legacy state cannot overwrite Session ......... PASS
15. UI tab changes do not trigger analysis ........ PASS
16. Candidate generation does not trigger analysis  PASS
17. XMP generation does not trigger analysis ...... PASS
18. XMP download does not trigger analysis ........ PASS
19. Compatible cache key reuses evidence .......... PASS
20. Different fingerprint does not reuse evidence . PASS
21. Engine/profile change invalidates cache ....... PASS
22. Session lifecycle always terminates ........... PASS
23. Production locks remain unchanged ............. PASS
24. P0.8A regression tests remain passing ......... PASS (22/22 subprocess)
25. Reference Color Match behavior unchanged ...... PASS (8/8 files byte-identical)

25/25 PASS, 0 FAIL
```

## 1a. Self-contained Reference Color Match invariant (test 25 — R2 fix)

Baseline: `qa/baselines/p0-8a-reference-color-match-invariant.json`,
pinning SHA-256 hashes for the 8 files confirmed to be Reference Color
Match's exclusive dependencies (sole consumer:
`ui/reference-color-match-panel.js`), computed from the verified P0.8A
source before any P1A edit:

```
core/generation-control.js
core/analysis-cache.js
core/preview-state-machine.js
core/candidate-schema.js
core/core-runner.js
ui/reference-color-match-panel.js
core/color-match/candidate-preview-renderer.js
core/curve-engine/index.js
```

Test 25 hashes the current copy of each file with Node's `crypto`
module and compares against the pinned value — no external directory,
no dependency on anything outside the shipped ZIP. It:

- **PASSes** when all 8 files match their pinned hash.
- **FAILs** when any file's content differs, printing the exact
  filename plus both the expected and actual SHA-256.
- **FAILs** when a pinned file is missing, printing the filename and
  the expected SHA-256 (no silent skip).
- **FAILs** cleanly (not a crash) if the baseline JSON itself is
  missing.

Verified with three deliberate-failure drills in an isolated scratch
copy before packaging: (1) appending a byte to
`core/generation-control.js` → FAIL with printed
`MISMATCH (expected sha256=..., actual sha256=...)`; (2) removing
`core/candidate-schema.js` → FAIL with printed
`MISSING (expected sha256=...)`; (3) removing the baseline JSON itself
→ FAIL with `pinned baseline missing: ... — cannot verify`, exit
non-zero, no crash. Restoring the original files brought the suite back
to 25/25 in all three drills.

## 2. Full static/integration regression

```
62/62 suites PASSED, 0 FAILED
```

Full per-suite breakdown available by running
`node qa/run-static-suites.mjs`; a saved copy of this exact run's output
is included at `qa/results/run-static-suites-r2-output.txt`, and the
saved test-25/full-suite test output is at
`qa/results/epic-2e-p1a-single-image-session-test-r2-output.txt`. This
result was reproduced **twice**: once inside the working repository,
and once again from a completely fresh, standalone extraction of this
R2 ZIP into an empty directory with no `lumixa_p08a` or other sibling
project folder present anywhere on disk — see §8 below. Both runs exit
code 0.

## 3. Browser QA — honest scope

Script: `qa/epic-2e-p1a-single-image-session-browser-test.mjs`.
Implements all 12 required scenarios (upload, one-Session
verification, Analyze/progress, existing UI still displays results,
repeated-click duplicate-Analyze guard, upload-during-analysis
overlap/abort, panel switching, XMP generate/download no-reanalysis,
Reset, Reference Color Match still opens) against the real
`index.html`/`ui/app.js` via a local static HTTP server, using a
3-layer fail-closed contract:

1. `playwright` package import — **available** in this environment
   (confirmed via `node -e "import('playwright')..."`).
2. Chromium binary launch — **unavailable**:
   ```
   browserType.launch: Executable doesn't exist at
   /sessions/.../ms-playwright/chromium_headless_shell-1228/...
   ```
   `npx playwright install chromium` was attempted 4 times; every
   attempt failed identically:
   ```
   Error: Download failed: server returned code 403 body
   'Connection blocked by network allowlist'.
   URL: https://cdn.playwright.dev/builds/cft/149.0.7827.55/linux64/chrome-linux64.zip
   ```
3. (Would-be) real fixture image check — not reached, since step 2
   fails first.

**Result: `BROWSER_BINARY_UNAVAILABLE`, exit code 2.** No PASS was
fabricated. The JSON result artifact
(`qa/epic-2e-p1a-single-image-session-browser-results.json`) records
`completed: false`, `pass: 0`, `fail: 0`, `total: 12`, `scenarios: []`
— this is an honest "not executed," not a false positive.

This is the same category of environment limitation encountered in
every prior EPIC 2E round (P0.7-R5, P0.7-R6, P0.8A) — this sandbox's
network allowlist blocks `cdn.playwright.dev`. The script is complete,
parametrized (`LUMIXA_P1A_IMAGE_A`/`LUMIXA_P1A_IMAGE_B` env vars or
`qa/fixtures/epic-2e-p1a/`), and ready to run as-is in an environment
with Chromium available.

**Unverified-by-live-browser items** (would be scenarios 1-12 in the
script once Chromium is available): visual confirmation that
`aiBox`/`sliders` render correctly during and after analysis, that the
Reset button visibly restores the upload screen, and that the
Reference Color Match panel still visually opens and behaves per
P0.8A. All of these are covered indirectly by the 25/25 static suite
(which asserts the underlying state-machine/DOM-call-site behavior via
source inspection and direct module invocation) but not by an actual
rendered page.

## 4. Production Lock verification

Confirmed via direct grep of the real source (not inference):

```
core/lightroom-mapping-engine/mapping-v2-preview-review-state.js:508-509
  productionSource: 'legacy', productionWrite: false, controlledV2Apply: false,

core/color-match/core-color-match-pipeline.js:49-50
  productionSource: 'legacy', productionWrite: false, xmpWriteAllowed: false,
  candidateXmpInMemoryOnly: true, productionActivationAllowed: false,
```

All 5 locked fields present with their required (unchanged) values.

**Byte-diff of every production-critical file against the P0.8A
baseline** (excluding `ui/app.js`, whose change is the explicit,
in-scope subject of this EPIC):

```
IDENTICAL: core/lightroom-mapping-engine/index.js
IDENTICAL: core/xmp-validator/index.js
IDENTICAL: core/preset-engine/index.js
IDENTICAL: ui/ui-engine.js
IDENTICAL: core/decision-engine/index.js
IDENTICAL: core/preview-rendering/visual-preview-render-plan-v2.js
IDENTICAL: core/lightroom-mapping-engine/mapping-v2-overlay-preview-sandbox.js
IDENTICAL: index.html
IDENTICAL: ui/reference-color-match-panel.js
DIFFERS (expected, in-scope): ui/app.js
```

`qa/baselines/epic-2e-n1-production-invariant.json`'s SHA-256 pinning
test for `ui/app.js` was updated to the new hash after confirming (via
this same diff) that no other pinned file was accidentally touched.
`qa/baselines/lufa42-production-lock-manifest.json` was regenerated
(139 files locked, +7 for the new `core/single-image/*.js` modules) via
the project's standard
`node qa/baselines/generate-production-lock-manifest.mjs` convention.

## 5. P0.8A regression verification

Re-ran `qa/epic-2e-p0-8a-preview-artifact-repair-static-test.mjs`
directly and as test 24 of the P1A suite: **22/22 PASS** both times.
Confirms Gaussian/continuous HSL blending, ≥1024-entry interpolated
float Tone Curve LUT, continuous skin/white-neutral protection, and
Preview-from-original-source rendering all remain active and
unmodified.

## 6. Reference Color Match regression verification

Test 25 of the P1A suite hashes 8 RCM-exclusive files
(`core/generation-control.js`, `core/analysis-cache.js`,
`core/preview-state-machine.js`, `core/candidate-schema.js`,
`core/core-runner.js`, `ui/reference-color-match-panel.js`,
`core/color-match/candidate-preview-renderer.js`,
`core/curve-engine/index.js`) and compares each against the pinned
SHA-256 baseline in `qa/baselines/p0-8a-reference-color-match-invariant.json`
(§1a) — all 8 confirmed matching. This check is self-contained: it
requires nothing beyond the files already inside this ZIP, and was
re-verified from a standalone extraction of the package (§8), not just
the working repository.

## 7. Net verdict

All static/integration evidence (62/62 suites, 25/25 P1A-specific
cases) supports the full 18-item final acceptance checklist, and — per
the R2 correction — this evidence has now been reproduced from a fresh,
standalone extraction of the delivered ZIP itself, not only from the
working repository. The one item that could not be verified in this
sandbox is live-browser visual confirmation — blocked by the network
allowlist, not by any known or suspected defect in the implementation.
No PASS is claimed for anything not actually executed.

## 8. Fresh-extraction verification (R2)

To catch exactly the class of defect reported against R1 (a test
passing only because of an external directory that happened to still
exist on the machine that built the ZIP), R2 was verified by: building
the ZIP, extracting it into a brand-new empty directory with no sibling
`lumixa_p08a`/`lumixa_r*` project folders anywhere on the filesystem,
and running both required commands from inside that extracted copy
only. See `P1A_MODIFIED_FILES.md` for the exact command transcript and
exit codes from that run.
