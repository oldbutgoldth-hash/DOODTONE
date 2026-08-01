# EPIC 2E-P1A R3 — Upload Lifecycle Ordering Fix

## Verified root cause

`ui/app.js`'s `loadFile()`, as shipped in R2, called the Session
lifecycle functions in this order:

```js
activeUploadTicket = await singleImageOrchestrator.beginUpload(file);
handleReset();
```

`beginUpload()` creates the new canonical Session and returns its
ticket. But `handleReset()` unconditionally calls:

```js
singleImageOrchestrator.resetActiveSession(state);
activeUploadTicket = null;
```

`resetActiveSession()` (`core/single-image/single-image-orchestrator.js`)
aborts whatever Session is active, clears its data, and — critically —
calls `clearActiveSession()`, which empties the active-Session store
slot entirely. Calling it immediately after `beginUpload()` destroys
the Session that was just created and nulls the ticket that referenced
it.

Every subsequent step depended on that ticket: `previewImg.onload`
called `singleImageOrchestrator.markImageDecoded(activeUploadTicket,
...)` guarded by `if (activeUploadTicket)`, and `runAnalysis()`'s first
line was `const analysisTicket = activeUploadTicket ?
startAnalysisTicket(...) : null; if (!analysisTicket) return;`. With
`activeUploadTicket` null, `markImageDecoded()` was skipped and
`runAnalysis()` returned immediately — but the DOM had already been set
to `setAnalysisBox('loading', ...)` moments earlier in the `FileReader`
`onload` handler. Nothing ever moved it out of that state. The UI hung
on "กำลังโหลดรูปภาพ..." (loading image...) permanently, for every
single upload — this was deterministic, not related to image size or
performance.

## The fix

`loadFile()` now runs reset preparation and Session creation in the
correct order:

```js
async function loadFile(file) {
  if (!file?.type.startsWith('image/')) return;
  handleReset();
  const uploadTicket = await singleImageOrchestrator.beginUpload(file);
  activeUploadTicket = uploadTicket;
  state.currentRetainedFile = file;
  // existing FileReader/decode flow continues, using uploadTicket
}
```

`handleReset()` still aborts and clears whatever was previously active
— it just runs *before* the new Session exists, so it can never touch
it. `beginUpload()` also independently calls `abortActiveSession()` as
its own first step (defensive, in case some future caller invokes it
without a preceding reset) — with `handleReset()` now running first,
that internal call is a safe no-op (there's nothing left to abort),
not a duplicate side effect.

## A second, related hardening: per-call ticket capture

The literal reorder above is sufficient to fix the reported hang, but
it leaves a narrower race in place: `previewImg.onload` and
`.onerror` read the shared, module-level `activeUploadTicket` variable
at the moment they *fire*, not the moment they were *defined*. If a
slow-resolving image A's decode completes after a newer image B upload
has already reassigned `activeUploadTicket`, image A's callback would
read ticket B and could write image A's pixel dimensions into Session
B's `image` metadata.

R3 closes this too: `loadFile()` now captures its own upload's ticket
into a local `const uploadTicket`, and the `img.onload`/`img.onerror`
closures reference that local constant directly instead of the shared
`activeUploadTicket`:

```js
const uploadTicket = await singleImageOrchestrator.beginUpload(file);
activeUploadTicket = uploadTicket; // still kept current for Re-analyze
...
img.onload = () => {
  if (uploadTicket) singleImageOrchestrator.markImageDecoded(uploadTicket, {...});
  runAnalysis(uploadTicket);
};
img.onerror = () => {
  if (uploadTicket) singleImageOrchestrator.markImageDecodeFailed(uploadTicket, ...);
};
```

`runAnalysis()` was extended to accept an optional ticket
(`async function runAnalysis(callerTicket = null)`), falling back to
`activeUploadTicket` when no explicit ticket is given — this preserves
`handleReanalyze()`'s existing no-arg call, which correctly wants
"whatever Session is current right now", while `loadFile()`'s own
`img.onload` now always uses the exact ticket it captured.

Even with a stale captured ticket, every orchestrator function it calls
independently rejects the write via the same generation-ownership check
in `single-image-session-store.js`'s `updateActiveSession()` — so this
change removes an unnecessary window for a subtle bug rather than
patching a currently-provable failure. Both properties are now covered
by an automated test (see below).

## Regression coverage

`qa/epic-2e-p1a-r3-upload-lifecycle-integration-test.mjs` (new, 16
cases) exercises the real `core/single-image/single-image-orchestrator.js`
functions in the exact sequence `loadFile()`/`runAnalysis()` use —
verified to fail (13/16, exit 1) against a copy of the actual R2
`ui/app.js` and pass (16/16, exit 0) against the corrected R3 source.
See `P1A_QA_REPORT.md` §1b for the full before/after transcript.
