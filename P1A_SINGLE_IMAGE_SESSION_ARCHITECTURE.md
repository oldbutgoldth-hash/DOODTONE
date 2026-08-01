# EPIC 2E-P1A — Single Image Analysis Session Architecture

## Goal

One canonical Session per uploaded image: one decode, one analysis
proxy, each Core module runs at most once, all evidence stored
centrally, and the existing UI/Lightroom/XMP behavior is unchanged.
P1A is architecture and state-ownership only — it does not tune color,
does not add an AI model, does not redesign the UI, and does not touch
Reference Color Match.

## The confirmed problem (see P1A_SOURCE_LINEAGE_AUDIT.md §9, §13)

`ui/app.js` writes ~20 `state.last*` fields directly from inside
`runAnalysis()`, with **no generation check on those writes**. The
existing `analysisRenderGeneration` counter only guards render
callbacks. Two concrete failure modes were confirmed possible before
P1A: (1) clicking Re-analyze twice starts two concurrent
`runAnalysis()` calls that both write into the same fields; (2)
uploading Image B while Image A is still analyzing does not cancel
Image A's in-flight promises, which can write into `state.last*` after
Image B has already started.

## Module structure (`core/single-image/`)

| File | Responsibility |
|---|---|
| `single-image-session.js` | Session factory (`createSingleImageSession`), status/module-state enums, `EVIDENCE_KEYS`, shape validation, status/warning/error mutation helpers, `resetSessionData`. Owns the *shape*, not the lifecycle. |
| `single-image-session-store.js` | Single-slot active-Session registry. `updateActiveSession(sessionId, generationId, updaterFn)` is the sole choke-point every write must pass through — it silently rejects (no-op) writes from a session/generation that is no longer active. |
| `single-image-orchestrator.js` | Lifecycle driver and the only module `ui/app.js` imports directly. `beginUpload`, `markImageDecoded`/`markImageDecodeFailed`, `startAnalysisTicket`, `commitEvidence`/`commitFromSettled`, `commitCandidate`, `completeAnalysis`/`failAnalysis`, `abortActiveSession`, `resetActiveSession`, `computeImageFingerprint`. |
| `single-image-analysis-profile.js` | Declarative table (`SINGLE_IMAGE_FULL`, 23 entries) of every real Core module this workflow runs: `{moduleId, required, dependencies, executionMode, timeoutMs, evidenceKey, fallbackPolicy}`. No invented modules — every `moduleId` maps to a real import already present in `ui/app.js`. |
| `evidence-normalizer.js` | Wraps a Core module's raw result in the stable `{status, result, confidence, diagnostics, warnings, errors, sourceModule, startedAt, completedAt}` shape. Never alters the underlying numeric result. |
| `single-image-analysis-cache.js` | Dedicated `Map`-based cache keyed on fingerprint + profile version + engine version + proxy size. Entirely separate from `core/analysis-cache.js` (which is Reference-Color-Match-exclusive — see audit §10). |
| `legacy-state-adapter.js` | One-way `Session.evidence → state.last*` sync (`LEGACY_MAP`). Legacy state is a mirror only; nothing here ever reads `state.last*` to decide what to write into a Session. |

Every one of these modules is imported and actually called from
`ui/app.js` — none is a dead scaffold file. See
`P1A_MODIFIED_FILES.md` for the exact call-site list.

## Session status lifecycle

```
CREATED → IMAGE_DECODING → IMAGE_READY → ANALYSIS_QUEUED → ANALYZING
                                                              ├─→ COMPLETED
                                                              ├─→ PARTIAL   (optional module soft-failed)
                                                              └─→ FAILED    (required module/decode failed)
(any state) → ABORTING → ABORTED   (new upload supersedes this session)
(any state) → RESET                (user clicks Reset / uploads clears state)
```

The orchestrator guarantees every analysis run resolves to exactly one
of `COMPLETED` / `PARTIAL` / `FAILED` / `ABORTED` — `runAnalysis()`'s
own outer `try/catch` calls `failAnalysis()` on any thrown error, so a
Session can never sit indefinitely in `ANALYZING`.

## Generation-ownership pattern (the core fix)

Every `ui/app.js` write site that used to write directly into
`state.last*` now instead calls `singleImageOrchestrator.commitEvidence(
ticket, moduleId, outcome, state)`. Internally this:

1. Normalizes the outcome via `evidence-normalizer.js`.
2. Calls `single-image-session-store.js`'s `updateActiveSession(
   ticket.sessionId, ticket.generationId, updaterFn)`.
3. `updateActiveSession` compares the ticket's `{sessionId,
   generationId}` against the store's current active Session. If they
   don't match — because a newer upload has since superseded it — the
   updater never runs, `{applied: false, reason: 'STALE_GENERATION'}`
   is returned, and **nothing is written**, to either the Session or
   the legacy `state` mirror.
4. If they match, the updater writes the evidence into
   `session.evidence[evidenceKey]`, then calls
   `legacy-state-adapter.js`'s `syncEvidenceKeyToLegacyState` so
   `state.last*` stays in sync (Session first, legacy second, per the
   spec's ordering rule).

`ui/app.js` call sites that return a falsy `.committed` from a
*required* evidence commit (`histogram`, `basicPanel`, `validation`) or
from `commitCandidate` now `return` immediately, exactly mirroring the
existing early-return-on-failure style already used elsewhere in
`runAnalysis()`.

## Duplicate-Analyze prevention

`startAnalysisTicket(sessionId, generationId)` is called at the top of
`runAnalysis()`, immediately replacing the point where the pre-existing
`renderGeneration` counter logic began. If the Session referenced by
`activeUploadTicket` is no longer the store's active Session (e.g. a
second click already advanced it), `startAnalysisTicket` returns `null`
and `runAnalysis()` returns immediately — before any Core module runs.
This closes the audit's confirmed "clicking Re-analyze twice starts two
concurrent runs" gap without adding a DOM `disabled` flag (which would
have been a UI-visible behavior change outside P1A's scope).

## Upload-during-analysis (Image A / Image B race)

`beginUpload(file)` creates a brand-new Session (new `sessionId` +
`generationId`) and — critically — this alone is sufficient to make
Image A's ticket stale in the store, without needing to explicitly
cancel Image A's in-flight promises. When Image A's `.then()` callbacks
eventually resolve and call `commitEvidence` with Image A's now-stale
ticket, `updateActiveSession` rejects the write. Image A's
`AbortController` (`session.runtime.abortController`) is also aborted
via `abortActiveSession()`, for Core modules that support
`AbortSignal` (per the spec's "support AbortSignal where possible"
requirement — not all wrapped engines accept one today; those simply
finish computing and have their result silently dropped by the
generation check instead).

## What P1A deliberately left unchanged

The entire Visual Preview Comparison / Controlled V2 rendering block
(`ui/app.js`, inside `runAnalysis()`) was left untouched. It writes to
state fields outside `EVIDENCE_KEYS` (`lastPreviewSandbox`,
`lastPreviewReviewState`, etc.) and is already protected by the
pre-existing `renderGeneration !== analysisRenderGeneration` guards —
duplicating that protection would have been scope creep into P0.8A's
territory. `applyPresetToSliders`, `readSlidersAsPreset`,
`handleDownload`, and Reference Color Match are all unmodified — see
`P1A_LEGACY_COMPATIBILITY_MAP.md` and `P1A_QA_REPORT.md` for the
regression verification.
