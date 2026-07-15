# 07 — CONTROLLED PREVIEW REVIEW ARCHITECTURE

Architecture reference for the EPIC 2E-F Controlled Overlay Preview
Sandbox, Human Review State Engine, and Controlled Preview Review
Console — written by inspecting the actual v1.1.6 source.

## Flow Diagram

The V2 shadow pipeline (informational only) runs alongside, never
inside, the production path:

```
Image Analysis
  → Decision Engine
    → V2 Shadow Pipeline
      (Style Budget Intelligence → Mapping V2 Planner → Translation V2
       → Safety Clamp V2 → Shadow Compare V2 → Controlled Activation V2
       → Legacy Safety Overlay V2 → Overlay Simulation V2
       → Controlled Overlay Test Gate V2)
      → Preview Sandbox            (finalStyleIntent.controlledOverlayPreviewSandboxV2)
      → Human Review State         (finalStyleIntent.controlledPreviewReviewStateV2)
      → Review Console             (ui/review-console-renderer.js + review-console-controller.js)
```

The production path remains completely separate:

```
decision.styleBudget
  → Legacy Lightroom Mapping (core/lightroom-mapping-engine/index.js)
  → Existing XMP Export
```

**The Review Console does not feed production output.** Nothing in the
diagram above has an arrow back into the production path — that
absence is deliberate and verified (see Production Isolation in
`08_EPIC_2E_F_QA_REPORT.md`).

## Separation: Legacy Mapping vs. V2 Shadow Pipeline

`core/lightroom-mapping-engine/index.js`'s `mapStyleFingerprintToLightroom`
reads only `decision.styleBudget` and the style fingerprint — it has no
awareness that `finalStyleIntent.*` exists. Every V2 stage attaches its
own object to `finalStyleIntent` (a sibling of `styleBudget` on the
decision object), wrapped in its own try/catch so a failure in any one
V2 stage can never break analysis or silently fall back to an unsafe
default — it just leaves that one field absent, and every downstream
reader (Decision Report, Reference Transfer Report, the Review Console)
treats a missing/malformed field as "unavailable", never as "safe by
default".

## Separation: Preview Sandbox vs. XMP Export

`simulatedPreviewPreset` inside the Sandbox object contains only
abstract, normalized 0-1 "changes" on a hand-chosen severity scale —
never a real Lightroom slider value, never an XMP-schema value. Three
booleans are hard-coded directly in
`mapping-v2-overlay-preview-sandbox.js`'s own source, not derived from
any flag or gate check:

```js
canExportPreview: false
canWriteProduction: false
selectedOutputSource: 'legacy'
```

Every sub-stage of EPIC 2E-F re-verified (via a "dangerous flag test" —
manually forcing every export/write/mutation flag to `true`) that these
three values never move. This is a deliberate double-guarantee: even if
a future flag default were accidentally changed, these three lines
would still need a separate, explicit code change.

## Separation: Review State Engine vs. UI

All approval, progress, blocker, and summary calculation happens
exclusively inside `core/lightroom-mapping-engine/mapping-v2-preview-review-state.js`.
`ui/review-console-controller.js` calls only two of its exports —
`updatePreviewReviewItemV2(state, itemId, update)` and
`resetPreviewReviewStateV2(state)` — and renders whatever they return.
No approval/progress logic is duplicated client-side. Every visual
review item (`source-image-reviewed`, `skin-tones-reviewed`,
`highlights-reviewed`, `shadows-reviewed`, `white-balance-reviewed`,
`color-stacking-reviewed`) defaults to `pending` and is never
auto-passed by any code path.

## UI State Ownership

`ui/app.js` holds the single editable Review State for the currently
active analysis result in `state.lastPreviewReviewState`. The
controller never owns this state itself — it reads it via a
`getState()` closure and commits new values via `setState()`, both
supplied by `app.js`. Every engine call (`updatePreviewReviewItemV2`/
`resetPreviewReviewStateV2`) returns a **new** state object; the
controller never mutates the object `getState()` returns.

## Same-Image Re-analyze Flow

```
handleReanalyze() → runAnalysis()
  → buildFinalPreset({ ..., controlledPreviewReviewStateV2: state.lastPreviewReviewState })
  → pipeline normalizes the EXISTING state against the FRESH Preview Sandbox
  → state.lastPreviewReviewState = the newly returned, re-normalized state
```

`handleReanalyze()` never calls `handleReset()`, so the current review
progress and notes survive. If the freshly-computed Sandbox is no
longer eligible (e.g. `canGeneratePreview` flipped to `false`), the
engine — not the UI — recalculates `canApprovePreview` down to `false`;
stale approval can never bypass a newly-blocked Sandbox.

## New-Image Reset Flow

```
loadFile() → handleReset()  [ALWAYS called first]
  → state.lastPreviewReviewState = null
  → reviewConsoleController.resetTransientUiState()  [clears armed "Confirm Fail?"/Reset prompts]
  → runAnalysis()
  → buildFinalPreset({ ..., controlledPreviewReviewStateV2: null })
  → a genuinely fresh Review State is created
```

Because `handleReset()` is called unconditionally before every new
image import, a different image can never inherit a previous image's
approval, notes, or armed confirmation UI — even though every image
shares the same fixed set of canonical review item IDs.

## Immutable Update Pattern

Every state-producing function in `mapping-v2-preview-review-state.js`
follows the same rule: read the incoming state (if any) as **untrusted
input**, normalize every field defensively, and return a **brand-new**
object — the caller's old reference is never mutated in place. This was
verified via byte-identical JSON snapshots of the input object taken
before and after each call, across every sub-stage's QA pass.

## Event Delegation and AbortController Lifecycle

`review-console-controller.js` attaches exactly **one** delegated
listener set (`click`, `focusout`, `input`) to the persistent
`#reviewConsoleInner` container, exactly **once** per page session —
not once per render. This works because only the container's
*children* are replaced on each render (`container.replaceChildren()`
inside the renderer); the container element itself is never destroyed
or recreated, so a listener attached to it continues to correctly
catch events on freshly-rendered children indefinitely. The
`AbortController`-scoped `attach()`/`destroy()` pair exists as a
defensive API for any future teardown need, but ordinary Re-analyze and
new-image-import cycles never call `destroy()` — verified via a
MutationObserver-based test showing exactly one DOM mutation per one
user click, even after three consecutive Re-analyzes.

A closely related bug, fixed in EPIC 2E-F-C-B-F: `focusout`'s
note-commit used to call `rerender()` immediately, which could destroy
a `click`-target button before its `click` event ever fired (browser
event order is `focusout` → `focus` → `click`). The fix defers the
re-render to the subsequent click handler whenever `focusout.relatedTarget`
is another review action control, while still committing the note to
state immediately — so the click action always operates on the
just-saved note, and only one final render occurs.

## No Local Persistence Boundary

Review State exists only in the `state.lastPreviewReviewState`
JavaScript variable inside the running page — there is no
`localStorage`, `sessionStorage`, `indexedDB`, cookie, or backend/API
write path anywhere in the Review Console or Preview Sandbox code
(confirmed via grep, every sub-stage). Refreshing the page loses all
review progress. The pre-existing, unrelated dark-mode and language
`localStorage` keys in `ui/app.js` predate this EPIC and are explicitly
out of scope.

## Rollback and Fail-Safe Behavior

Every V2 stage's `rollbackPlan` reports `restoreSource:"legacy"` and
`available:true` — Legacy Mapping is always the fallback, never a
secondary path that needs activating. If
`updatePreviewReviewItemV2`/`resetPreviewReviewStateV2` throws
unexpectedly, the controller preserves the last valid state, shows a
concise message (never a raw stack trace), and never falls back to an
approved-looking state. If the Review Console renderer itself
encounters malformed data it cannot handle, it clears any partial DOM
and shows a neutral fallback message rather than leaving a half-built
or crashed console on screen — verified this can never throw an
uncaught exception out of the module regardless of input shape.
