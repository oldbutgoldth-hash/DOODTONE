# 30 -- EPIC 2E-K-R2 QA Report: Real Pixel Comparison & Browser Verification Closure

## 1. Scope

Covers everything genuinely executed for R2 in this development
environment, and states plainly what could not be executed and why. No
result below is fabricated.

## 2. Source Provenance

Development started from the exact ZIP delivered at the end of the R1
round (`EPIC-2E-K-CONTROLLED-V2-CALIBRATION-LAB-R1.zip`), extracted into
a fresh working directory and diffed byte-for-byte against the prior
round's own working copy to confirm it was genuinely the same latest
source (zero differences outside `node_modules`, which the ZIP
correctly excludes).

## 3. Browser Verification Closure Attempt (Section title requirement)

- `detectBrowserExecutable()` again found zero usable Chromium
  candidates in this sandbox, consistent with every prior round.
- A direct attempt was made to install a real Chromium via
  `npx playwright install chromium`. This failed with an explicit,
  unambiguous network-level error:
  `Download failed: server returned code 403 body 'Connection blocked
  by network allowlist'` -- this sandbox's outbound network allowlist
  blocks the Playwright CDN, not merely "no binary present." This is
  new information this round did not have before (R1 only confirmed no
  local binary existed; R2 confirms it cannot be fetched here either).
- **Conclusion: Browser Verification Closure could not be achieved in
  this development sandbox.** This is an environment constraint, not a
  defect in the Calibration Lab or its test suites. Every Browser
  suite in this project (14 local-gate steps) continues to self-report
  the honest `BROWSER_BINARY_UNAVAILABLE` status rather than a
  fabricated PASS. Closure requires running
  `qa/epic-2e-k-calibration-lab-browser-test.mjs` (and ideally the full
  `node tools/local-gate.mjs`) on a machine with a real Chromium/
  Playwright install and network access, or with Chromium pre-installed
  in the sandbox image.

## 4. Node-Executable Static Test Results (real, ran to completion)

| Suite | Result |
|---|---|
| `qa/epic-2e-k-calibration-lab-static-test.mjs` (unchanged from R1) | 61/61 PASS |
| `qa/epic-2e-k-calibration-lab-storage-test.mjs` (unchanged from R1) | 16/16 PASS |
| `qa/epic-2e-k-calibration-lab-hostile-static-test.mjs` (unchanged from R1, re-verified against the R2 code) | 19/19 PASS, 0 NOT_TESTED |
| `qa/epic-2e-k-r2-real-pixel-comparison-static-test.mjs` (NEW this round) | 34/34 PASS |
| `node tools/esm-syntax-gate.mjs` | 166/166 files PASS |
| `node qa/run-static-suites.mjs` (full project static suite) | All static suites PASSED, exit 0 |
| `node tools/local-gate.mjs` (14 steps) | Steps 1-3 PASS; Steps 4-14 honestly FAIL with `BROWSER_BINARY_UNAVAILABLE` |

The new suite's 34 assertions cover: the pure `createBoundedLruCache`
module (capacity eviction order, recency-on-access reordering,
overwrite-evicts-old-value, identical-value-no-evict, `clear()` firing
`onEvict` for every entry, a throwing `onEvict` never breaking the
cache, and 6 hostile invalid-`maxSize` inputs all falling back to a
safe bound); that the transient Render Plan field can never reach
`schema.js`, `export-dataset.js`, `getState()`, or `getQaSnapshot()`;
that all four session-lifecycle functions
(`startNewSession`/`openSession`/`clearAllData`/`endSession`) clear the
live-image cache; and that the entire reused production
pixel-rendering chain contains no reference to
`serializeXMP`/`downloadXMP`/`buildLightroomControlledActivationV2`.

## 5. Regression Check (R1 functionality unaffected)

All three of R1's own Calibration Lab suites (static/storage/hostile)
were re-run against the R2 codebase with zero code changes to the
suites themselves and produced byte-for-byte the same pass counts as
before R2 (61/61, 16/16, 19/19) -- confirming the R2 changes are
additive and did not alter any R1-verified behavior.

## 6. Production Lock Verification

Every one of the 65 locked core/ui files listed in the checked-in
`qa/baselines/lufa42-production-lock-manifest.json` baseline was
re-hashed (SHA-256) against the current R2 source tree: **0 mismatches,
0 missing files.** `core/preset-engine/index.js` (XMP serialization) and
`core/lightroom-mapping-engine/index.js` (Production Mapping) are both
included in this locked set and both confirmed byte-identical -- direct
proof that R2 did not touch either.

`ui/visual-preview-comparison-controller-v2.js` and
`ui/isolated-visual-preview-renderer-v2.js` (the two production files
this round's real-pixel-comparison feature calls into) are excluded
from the locked-file manifest (they are on the pre-existing
`ALLOWED_GEOMETRY_FILES` list from an earlier EPIC) but were confirmed
via direct diff to be byte-identical to the R1 baseline copy as well --
R2 reads/imports them, it does not modify them.

## 7. Files Changed This Round

See `31_EPIC_2E_K_R2_RELEASE_NOTES.md` section "Modified/New Files" for
the complete list. In summary: one brand-new pure module
(`core/calibration-lab/bounded-lru-cache.js`), targeted additive edits
to three existing Calibration Lab files
(`run-comparison-pipeline.js`, `calibration-lab-controller.js`,
`calibration-lab-renderer.js`, `calibration-lab-i18n.js`), one new
static test file, and small registration edits to
`qa/run-static-suites.mjs` and `qa/phase-c-suite-source-manifest.mjs`.
No file outside `core/calibration-lab/`, `ui/calibration-lab/`, and
`qa/` was modified.

## 8. What Was NOT Tested in This Environment

- Real-browser execution of the actual pixel rendering (the visual
  slider, the two canvases genuinely receiving different Legacy/V2
  pixel content, the async render-status badge) -- blocked by the
  confirmed lack of any reachable Chromium in this sandbox (section 3).
  The Browser suite is fully written and ready (see
  `qa/epic-2e-k-calibration-lab-browser-test.mjs`'s new Real Pixel
  Comparison assertions) but unverified here.
- Real screen-reader software, physical mobile devices, real
  photographic content -- same as every prior round.

## 9. Release Decision

**CONDITIONAL PASS**, same standing convention as every prior round in
this project: everything genuinely executable in Node passes (130
assertions across the 4 Calibration Lab Node suites combined, 0
failures; full project static suite green; production lock verified
unchanged). The Browser-dependent verification of the actual rendered
pixels remains open and requires a machine with real Chromium access --
this round additionally confirmed that network-level restrictions, not
merely a missing local binary, are the blocker in this specific
sandbox.
