# EPIC 2E-P1A — Legacy Compatibility Map

`core/single-image/legacy-state-adapter.js`'s `LEGACY_MAP`: the one-way
mapping from a Session evidence key to its `ui/app.js` `state.last*`
mirror. Verified against the real, current field names in
`ui/app.js:93-149` and the actual write sites documented in
`P1A_SOURCE_LINEAGE_AUDIT.md` §4 — not the P1A spec's illustrative names.

| Session `evidence` key | legacy `state.*` field | pre-P1A write site (`ui/app.js`) |
|---|---|---|
| `stats` | `lastStats` | line 2161 |
| `imageAnalysis` | `lastImageAnalysis` | line 2176 (inside `.then()`) |
| `palette` | `lastPalette` | line 2191 (inside `.then()`) |
| `harmony` | `lastHarmony` | line 2209 |
| `skin` | `lastSkin` | line 2284 (merge of `classifySkin` + `analyzeSkinTone`) |
| `colorCast` | *(none)* | never assigned to `state` — local `castRes` only |
| `scene` | *(none)* | never assigned to `state` — local `sceneRes` only |
| `wb` | `lastWB` | line 2285 |
| `hsl` | `lastHSL` | line 2287 |
| `grading` | `lastGrading` | line 2288 |
| `toneCurves` | `lastToneCurves` | line 2289 |
| `calibration` | `lastCalibration` | line 2290 |
| `styleRecognition` | `lastStyleRecognition` | line 2292 |
| `basic` | `lastBasic` | line 2291 |
| `styleFeatureGraph` | `lastStyleFeatureGraph` | line 2325 |
| `styleFingerprint` | `lastStyleFingerprint` | line 2336 |
| `validationReport` | `lastValidationReport` | line 2378 |
| `benchmark` | `lastBenchmark` | line 2394 |
| `decisionReport` | `lastDecisionReport` | line 2450 |
| `referenceTransfer` | `lastReferenceTransfer` | line 2470 |
| `processingLog` | `lastProcessingLog` | line 2475 |

`session.candidate` (built by `decisionCandidate`/`buildFinalPreset`)
has no `LEGACY_MAP` entry — it was never assigned to a `state.last*`
field before P1A either. It flows Session → `applyPresetToSliders()`
exactly as `finalPreset` did before, via
`singleImageOrchestrator.commitCandidate(ticket, finalPreset)`
immediately followed by the pre-existing
`applyPresetToSliders(finalPreset)` call — unchanged signature, unchanged
behavior, only now gated on generation ownership first.

## Rules enforced by this adapter

1. **Session first, legacy second.** `commitEvidence()` always writes
   `session.evidence[key]` inside the same `updateActiveSession()`
   transaction that calls `syncEvidenceKeyToLegacyState()` — there is no
   code path that writes legacy state without first writing the Session.
2. **Legacy state is never authoritative.** Nothing in
   `legacy-state-adapter.js` reads `state.last*` to decide what to write
   into a Session; the adapter is strictly Session → legacy, one
   direction, always.
3. **Stale Sessions never reach the adapter.** `updateActiveSession()`
   in `single-image-session-store.js` rejects the write before
   `syncEvidenceKeyToLegacyState` is ever called, for any ticket whose
   `{sessionId, generationId}` no longer matches the active Session.
4. **Reset clears both.** `resetActiveSession()` in the orchestrator
   calls `resetSessionData(session)` (nulls Session evidence/report/
   candidate/validation/xmp) and `clearLegacyMirrors(legacyState)`
   (nulls every `LEGACY_MAP` target field) together, matching
   `handleReset()`'s existing behavior of nulling all `state.last*`
   fields.

## What this map deliberately does not cover

`state.lastPreviewSandbox`, `state.lastPreviewReviewState`,
`state.lastPreviewReviewGenerationId`, `state.lastSideBySideComparison`,
`state.lastVisualPreviewComparisonState`, and related Visual-Preview/
Controlled-V2-Review fields are **not** in `EVIDENCE_KEYS` or
`LEGACY_MAP` — they belong to the P0.7/P0.8A Visual Preview Comparison
pipeline, already protected by its own `renderGeneration` guard, and are
out of P1A's scope per the spec's "P1A must not tune or redesign
Reference Color Match" / architecture-only boundary. They continue to
be written exactly as before.
