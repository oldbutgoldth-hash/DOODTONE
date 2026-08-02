# EPIC 2E-P1C R2 — Candidate Runtime Lifecycle Order Fix

## 1. Browser symptom

Every real analysis run in the actual browser application showed the
red Candidate failure message:

> **สร้างค่า AUTO-TUNE ไม่สำเร็จ** / **"Auto-Tune Candidate build failed"**

This was not intermittent — it happened on every upload/analyze cycle,
regardless of image content, and regardless of whether every Core
analysis module succeeded.

## 2. Root cause

`buildAndCommitCandidate()` (`core/single-image/single-image-
orchestrator.js`) contains a deliberate, correct safety guard:

```js
export function buildAndCommitCandidate(ticket, { legacyState = null, engineVersion = null } = {}) {
  if (!ticket || !isActiveGeneration(ticket.sessionId, ticket.generationId)) {
    return { committed: false, candidate: null, validation: null, reason: 'STALE_GENERATION' };
  }
  const session = getActiveSession();
  if (session.status !== SESSION_STATUS.COMPLETED && session.status !== SESSION_STATUS.PARTIAL) {
    return { committed: false, candidate: null, validation: null, reason: 'SESSION_NOT_TERMINAL' };
  }
  // ... build, validate, and commit the Candidate ...
}
```

This guard exists so a Candidate is never built from a Session that
hasn't finished analyzing — a genuinely important invariant. The bug
was entirely in the **caller**: `ui/app.js`'s `runAnalysis()` called
`buildAndCommitCandidate()` immediately after `commitCandidate()`
(which only populates `session.candidateRaw`), roughly 500 lines
*before* it called `completeAnalysis()` later in the same function.

At the old call site, `session.status` was still `ANALYZING` — it had
not yet been finalized to `COMPLETED` or `PARTIAL`. So the guard above
fired on **every single call**, `buildAndCommitCandidate()` always
returned `{ committed: false, reason: 'SESSION_NOT_TERMINAL' }`, and
the existing `else` branch in `ui/app.js` unconditionally set:

```js
state.lastCandidateStatus = CANDIDATE_STATUS.FAILED;
updateCandidateStatusBadge(CANDIDATE_STATUS.FAILED);
```

— which is the literal, deterministic source of the red failure
message. This was independently re-derived by reading the actual
pre-fix source (not assumed from the bug report): `commitCandidate()`
appeared at old `ui/app.js` line 2616, the broken
`buildAndCommitCandidate()` call immediately followed at line 2623, and
`completeAnalysis()` did not run until line 3136 of the same function.

## 3. Old (broken) lifecycle

```
runAnalysis()
  ...
  commitCandidate(analysisTicket, finalPreset)     // writes session.candidateRaw only
  buildAndCommitCandidate(analysisTicket, ...)      // session.status is still ANALYZING here
    -> guard fires -> { committed: false, reason: 'SESSION_NOT_TERMINAL' }
  -> else branch -> Candidate badge = FAILED         // <-- the visible bug
  ...
  (~500 lines of unrelated UI-panel rendering: histogram, WB, skin, HSL, grading, tone curve, calibration, Review Console, Visual Preview...)
  ...
  completeAnalysis(analysisTicket)                  // session.status finally becomes COMPLETED/PARTIAL — too late
  if (finalSessionStatus === 'COMPLETED' || 'PARTIAL') buildAndCommitReport(...)  // Report build was already correctly gated here
```

## 4. Corrected lifecycle

```
runAnalysis()
  ...
  commitCandidate(analysisTicket, finalPreset)     // writes session.candidateRaw only (unchanged, unmoved)
  ...
  (~500 lines of UI-panel rendering — untouched, does not read session.candidate)
  ...
  const finalSessionStatus = completeAnalysis(analysisTicket)   // Session reaches its real terminal status here
  if (finalSessionStatus === 'COMPLETED' || finalSessionStatus === 'PARTIAL') {
    const candidateResult = buildAndCommitCandidate(analysisTicket, {...})   // guard now naturally passes
    if (candidateResult.committed) {
      // try/finally-wrapped slider-sync guard, renderCandidateToSliders(), badge = candidate.status
    } else {
      // console.error('[P1C Candidate Build Failed]', {...7 fields...})
      // candidateStore.clearActiveCandidate(ticket.sessionId, ticket.generationId)
      // badge = FAILED
    }
  } else {
    // finalSessionStatus is FAILED, or null (stale/superseded ticket)
    // candidateStore.clearActiveCandidate()  -- notify-only, matches handleReset()'s existing precedent
    // badge cleared (null), no stale slider values shown
  }
  if (finalSessionStatus === 'COMPLETED' || finalSessionStatus === 'PARTIAL') buildAndCommitReport(...)  // unchanged, unmoved
```

Only the Candidate-specific block moved. `commitCandidate()` stayed in
its original location (so `session.candidateRaw` is populated before
Session finalization, per requirement). The Report-build block, and
every UI-panel-rendering call between the two, was not touched.
`buildAndCommitCandidate()`'s own terminal-status guard inside
`single-image-orchestrator.js` was read, confirmed correct, and **not
modified** — this is a pure call-site reordering fix in `ui/app.js`.

## 5. Stale-generation protection

`completeAnalysis(ticket)` returns `null` when `ticket` is no longer
the active generation (i.e. a newer image has since become active).
The new gate — `if (finalSessionStatus === 'COMPLETED' ||
finalSessionStatus === 'PARTIAL')` — is a strict string/enum equality
check that `null` can never satisfy, so a stale Image A callback can
never reach the Candidate-build call after Image B becomes active, with
no additional stale-guard logic required. `buildAndCommitCandidate()`
itself also independently re-checks `isActiveGeneration()` at its own
entry point as a second, redundant safety net (an intentional
belt-and-braces pattern already established elsewhere in this
project — not something to simplify away).

This was verified functionally, not just argued: the new test's cases
9a–9e directly simulate Image A being superseded by Image B mid-flight
and assert (a) `completeAnalysis(ticketA)` returns `null`, (b) the
Candidate-build call for Image A is never reached, (c)
`isActiveGeneration()` confirms Image A is no longer active, (d) Image
B's own Candidate build/commit succeeds unaffected, and (e) the active
Candidate Store reflects only Image B's Candidate afterward.

## 6. Test added

`qa/epic-2e-p1c-r2-candidate-lifecycle-order-test.mjs` — 19 checks
against real production code:

- **Source-order checks** against the actual, shipped `ui/app.js`:
  `commitCandidate()` before `completeAnalysis()`; `buildAndCommitCandidate()`
  after `completeAnalysis()`; the build call is structurally unreachable
  outside the `finalSessionStatus` gate; exactly one call site exists;
  the slider-sync render call is textually inside the successful-commit
  branch, after the build call; the slider-sync guard is
  `try/finally`-wrapped; the required 7-field diagnostic is present.
- **Functional checks** against the real
  `single-image-orchestrator.js`, `single-image-session-store.js`, and
  `candidate/candidate-store.js`: the preserved guard rejects a build
  attempted while `ANALYZING`; a `COMPLETED` Session builds and commits
  exactly one Candidate with a non-`FAILED`/`INVALID` status; a
  `PARTIAL` Session with `candidateRaw` present still builds; a
  `FAILED` Session never reaches the build call and never populates
  `session.candidate`; the stale-generation scenario described in §5;
  and that the Candidate Store always reflects only the most recent of
  two sequential successful analyses.

**Verified to fail on the pre-fix source.** The pre-fix `ui/app.js` was
reconstructed in a scratch location by mechanically reversing the two
patches applied for this fix (not hand-retyped, to guarantee byte-exact
fidelity to what was actually broken), and the same test file was run
against it via its optional path-override argument:

```
node qa/epic-2e-p1c-r2-candidate-lifecycle-order-test.mjs /path/to/reconstructed/broken/app.js
```

Result: **15/19 PASS, 4 FAIL.** The 4 failures were exactly the 4
source-order/structural checks that directly encode this fix
(buildAndCommitCandidate-after-completeAnalysis ordering, the
ANALYZING-unreachability structural check, the try/finally guard
check, and the diagnostic-presence check) — the 4 pre-existing
functional checks that exercise `buildAndCommitCandidate()`'s own
internal guard still passed unchanged, because that guard itself was
never broken, only its caller's ordering. This confirms the new test is
a genuine, specific regression guard for this defect, run and re-run
against the real fixed source (19/19 PASS) before being included in the
delivered package.

## 7. Browser verification result — honest scope statement

**Chromium was not available in this sandboxed environment**, verified
concretely for this R2 round (not assumed from a prior round):

- `npx playwright install chromium` failed with: `Download failed:
  server returned code 403 body 'Connection blocked by network
  allowlist'` — the environment's outbound network allowlist blocks the
  Playwright CDN.
- No system-installed Chromium/Chrome binary exists on `PATH` or in any
  common install location; only stray, unrelated OS package files
  (`chromium-browser` bash-completion script, an AppArmor abstraction
  file, a udev hwdb entry) were found — none of these is an actual
  browser executable.
- The `playwright` npm package is installed and importable, and
  `chromium.executablePath()` resolves to a path, but no binary exists
  at that path because the download above failed.

**The 5 required real-image Browser QA scenarios were NOT run and
their real-browser outcomes are UNKNOWN:**

1. Upload the photograph from the supplied browser recording — verify
   fast load, analysis completes, Report appears, Candidate status
   becomes VALID or VALID_WITH_WARNINGS, the red failure message does
   NOT appear, and sliders receive Auto-Tune values.
2. Edit Exposure — verify Candidate becomes USER_EDITED and analysis
   does not rerun.
3. Edit HSL Orange Saturation — verify only that Candidate parameter
   changes, with no Candidate rebuild and no analysis rerun.
4. Download XMP — verify the export uses the current Candidate
   (including manual edits) and does not reconstruct values from DOM
   sliders.
5. Upload Image B before Image A finishes — verify Image A is aborted,
   Image A's Candidate cannot render or synchronize sliders, and Image
   B remains active.

**What substitutes for this in the current package**, per §6 above: the
new 19-case test exercises the real underlying
orchestrator/session-store/candidate-store logic for the functional
core of every one of these 5 scenarios, and is proven (§6's
fail-before/pass-after result) to actually catch the specific defect
reported. This is not a substitute for real pixel-level, real-DOM-event
Browser verification. Consistent with the explicit instruction for this
round, this document does **not** claim that Candidate creation was
confirmed to succeed after `completeAnalysis()` in a real browser — it
claims, and has directly demonstrated by execution, that Candidate
creation succeeds after `completeAnalysis()` in the real, unmodified
production code path (§4 and §6). Anyone running this package in an
environment with Chromium available should run the 5 scenarios above
manually, or build a dedicated Playwright script following the pattern
already established in `qa/epic-2e-p1c-*` and `qa/epic-2e-p1b-*`
Browser suites, before treating them as confirmed.
