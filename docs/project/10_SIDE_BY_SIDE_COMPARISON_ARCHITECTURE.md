# 10 — SIDE-BY-SIDE COMPARISON ARCHITECTURE

Architecture reference for the EPIC 2E-G Side-by-Side Preview
Comparison Data Model, its pipeline integration, and its read-only
UI — written by inspecting the actual v1.1.7 source.

## Flow Diagram

```
1. Production path (unchanged by this entire EPIC):

decision.styleBudget
  → Legacy Lightroom Mapping (core/lightroom-mapping-engine/index.js)
  → Existing XMP Export

2. V2 comparison path (informational only):

Image Analysis
  → Decision Engine
    → V2 Shadow Pipeline (stages 1-9, see 05_PROJECT_MEMORY.md)
    → Preview Sandbox                (finalStyleIntent.controlledOverlayPreviewSandboxV2)
    → Human Review State             (finalStyleIntent.controlledPreviewReviewStateV2)
    → Side-by-Side Comparison        (finalStyleIntent.sideBySidePreviewComparisonV2)
    → Read-only Comparison UI        (ui/side-by-side-comparison-renderer.js)
```

Nothing in path 2 has an arrow back into path 1 — that absence is
deliberate and repeatedly verified (see Production Isolation in
`11_EPIC_2E_G_QA_REPORT.md`).

## Data Model Ownership

`core/lightroom-mapping-engine/mapping-v2-side-by-side-comparison.js`
exports one function, `buildSideBySidePreviewComparisonV2(input)`,
which owns 100% of the comparison logic: similarity/divergence
calculation, safer-side determination, evidence scoring, and Human
Review recalculation. No other file — not the Decision Engine
integration, not the Decision Report section, not the UI renderer —
duplicates any of this logic. Every consumer only ever reads fields
off the object this function returns.

## Decision Engine Integration — a Genuine Architectural Constraint

Unlike every other V2 pipeline stage, Side-by-Side Comparison could
NOT be built inside `_buildDecision()`. The reason is structural, not
stylistic: the comparison needs `legacyPreset` — the REAL production
Legacy preset (`exp`/`con`/`hi`/`sh`/`temp`/`tint`/`vib`/`sat`, from
`mapStyleFingerprintToLightroom`) — and that value (`mapped` in
`buildFinalPreset()`) does not exist until AFTER `_buildDecision()` has
already returned.

The solution: Side-by-Side Comparison is built in `buildFinalPreset()`
itself, immediately after `mapped` is computed, by mutating
`decision.finalStyleIntent` — the EXACT SAME object reference
`_buildDecision()` already returned (JavaScript objects are passed by
reference). This makes the new field automatically visible to every
downstream reader (Decision Report, Reference Transfer) with zero
rebuild — verified directly, not assumed.

```js
// Inside buildFinalPreset(), after mapped is computed:
try {
  decision.finalStyleIntent.sideBySidePreviewComparisonV2 =
    buildSideBySidePreviewComparisonV2({ legacyPreset: mapped, ... });
} catch (e) {
  // Falls back to the engine's OWN safe empty-input result —
  // never a hand-duplicated shape.
  decision.finalStyleIntent.sideBySidePreviewComparisonV2 =
    buildSideBySidePreviewComparisonV2({});
}
```

## Separation: Data Availability vs. Visual Renderability

This is the single most important honesty boundary in this EPIC. Two
genuinely different concepts are kept structurally separate everywhere
in the codebase:

- **Data availability** (`legacyPreview.dataAvailable` /
  `v2Preview.dataAvailable`) — do the numbers/values needed for an
  abstract comparison exist?
- **Visual renderability** (`canRenderLegacyPreview` /
  `canRenderV2Preview` / `canCompareVisually`) — does a rendered image
  a person could look at exist?

The second set is **hard-coded `false` everywhere** in this EPIC —
never derived from the first, never inferred, never defaulted to
`true`. This codebase has no image-rendering pipeline anywhere; a
"comparison" in EPIC 2E-G is always a data-level comparison, never a
visual one. This was itself the subject of a real, self-caught bug
(EPIC 2E-G-C-F): an earlier UI empty-state check accidentally
read `!_isRecord(cmp.legacyPreview)?.dataAvailable` — a no-op, since
`_isRecord()` returns a boolean and booleans have no `.dataAvailable`
property — which was fixed to use the actually-normalized
`legacyDataAvailable`/`v2DataAvailable` values.

## Decision Report Integration

`core/decision-report-engine/index.js` adds a "Side-by-Side Preview
Comparison" section under `photographerIntelligence`, reading only
canonical fields (comparison state, availability, dimension coverage,
similarity/divergence, safer side, evidence level, Human Review
status, blockers/warnings/recommendations, fallback/rollback). Two
honesty rules enforced here specifically (EPIC 2E-G-B-F):

- `previewExportDisabled`/`productionWriteDisabled` are tri-state
  (`true`/`false`/`null`) — missing Sandbox evidence produces `null`,
  never a false "confirmed disabled" `true`.
- `xmpIsolation: {comparisonModuleHasNoWritePath: true,
  regressionVerified: false, status: "structurally-isolated"}` —
  replacing an earlier `xmpUnchanged: true` that implied a runtime
  regression check had been performed. It hadn't; this integration
  only proves the comparison module has no XMP write path at all
  (structural fact), which is a different and weaker claim than "we
  ran the export twice and diffed the bytes" (which this release did
  do manually via browser testing, but not as an automated, exhaustive
  semantic comparison — see the QA report).

## Reference Transfer Preservation

`core/reference-transfer-engine/index.js` never rebuilds
`finalStyleIntent` — it is a pure pass-through reader
(`dec?.finalStyleIntent?.sideBySidePreviewComparisonV2 ?? null`), so
the canonical comparison object is preserved automatically with zero
extra code required. A compact `sideBySideComparisonContext` was added
anyway, purely for consistency with the established per-object-context
pattern already used for `reviewStateContext` etc. — not because
preservation required it.

## UI Read-Only Boundary

`ui/side-by-side-comparison-renderer.js` is a pure display function:
it never calls the Comparison Engine, never calls
`buildSideBySidePreviewComparisonV2` itself, never recalculates
similarity/divergence/saferSide/approval/evidence-score/preferred-side
— every value shown is read directly from the canonical object. The
module contains exactly ONE interactive element in its entirety: a
"Go to Review Console" button that only calls `scrollIntoView()` on
the existing Review Console section — it changes no data, mutates no
state, calls no engine. There are no Export, Apply, Activate V2,
preview-image, slider, zoom, or pan controls anywhere, by design.

## No Visual Renderer Boundary

There is no image-rendering code anywhere in this EPIC's scope — not
in the comparison engine, not in the Decision Report, not in the UI.
`canRenderLegacyPreview`/`canRenderV2Preview`/`canCompareVisually` are
literal hard-coded `false` values in the comparison engine's return
object, re-displayed as-is (never re-derived) by every downstream
consumer. Building an actual preview renderer is explicitly deferred
to the recommended next EPIC (2E-H).

## No Production Consumer

Confirmed via repeated grep audits, across every EPIC 2E-G sub-stage
and again in this Phase D release audit, that
`sideBySidePreviewComparisonV2` is never read by
`core/lightroom-mapping-engine/index.js`
(`mapStyleFingerprintToLightroom`), `preset-engine`, `xmp-validator`,
or any production output-selection logic.

## Fallback to Legacy / Rollback Behavior

Every comparison result — even a completely empty/malformed one —
includes:

```js
rollbackPlan: { available: true, restoreSource: 'legacy', productionMutationDetected: false, steps: [...] }
fallbackStrategy: { useLegacyMapping: true, safeMode: true, reason: '...' }
selectedProductionSource: 'legacy' // hard-coded, never derived
```

If `buildSideBySidePreviewComparisonV2` throws unexpectedly, the
integration boundary in `buildFinalPreset()` falls back to calling the
SAME function with an empty input object (`buildSideBySidePreviewComparisonV2({})`)
rather than hand-constructing a duplicate result shape — this
guarantees the fallback object always matches the engine's own actual
contract, even if that contract changes in the future.

## Malformed-Data Normalization

Both the engine and the UI treat every external input as untrusted:

- Arrays are validated with `Array.isArray()` before any
  `.filter`/`.map`/`.slice`/spread use (`_safeArray()` in both files)
  — a lesson learned the hard way (EPIC 2E-G-A-F): `x ?? []` does NOT
  guard a truthy non-array value like a string, so `"invalid".slice(0,5).map(...)`
  would have thrown before this fix.
- Risk levels normalize to exactly `low`/`medium`/`high`/`critical`/
  `unknown` — an unrecognized value is always `unknown`, never
  silently mapped to `low` (the UI layer is intentionally even
  stricter than the engine here — see EPIC 2E-G-C-F).
- Object messages are never dumped as raw JSON — `_safeText()` in the
  UI tries known human-readable keys first, falling back to a neutral
  message for anything else, including circular references (never
  `JSON.stringify`, which would throw on a circular object).

## Immutable Update Pattern

`buildSideBySidePreviewComparisonV2` never mutates any of its inputs —
verified via byte-identical JSON snapshots of `legacyPreset`, the
Preview Sandbox, and the Review State object, taken before and after
each call. Returned arrays (`comparisonMatrix`) are always new array
references containing new object references, built via object spread
— never `JSON.parse(JSON.stringify(...))`, which the spec for this
module explicitly forbids.

## Tri-State Evidence Semantics

Every safety-relevant field in both the Decision Report and the UI
follows the same three-way pattern, established for the Review
Console's safety strip and extended consistently through this EPIC:

- **Confirmed** — explicit evidence proves the safe state.
- **Anomaly** — explicit evidence proves an UNEXPECTED, unsafe state
  (flagged honestly, never hidden — this should never happen given the
  engine's own hard-coded guarantees, but the UI/Report layer never
  assumes that guarantee holds without checking).
- **Unknown** — no evidence exists either way; never assumed safe.

A concrete example fixed in EPIC 2E-G-C-F2: `appliedToProduction`
(meaning "not currently applied") was initially conflated with
`canWriteProduction` (meaning "writing is explicitly disabled") — two
different concepts that happened to often both be `false` together,
which made the bug easy to miss until explicitly tested for.

## Stale Human Review Metadata Recalculation

The Side-by-Side Comparison module does NOT trust an incoming Review
State object's own top-level `approvalState`/`canApprovePreview`/
`reviewProgress` fields as truth (EPIC 2E-G-A-F2) — it recalculates all
three from the canonical `reviewItems` array using the same
canonical-ID `Map`-based approach the Review State Engine itself uses,
with a corrected priority order (EPIC 2E-G-A-F3): reject >
needs-adjustment > blocked (failed without reject) > approved >
in-progress. This was necessary specifically because a
`{approvalState:"approved", canApprovePreview:true,
visualReviewComplete:false}` contradiction was a REAL, reachable bug
before this fix — not a hypothetical one.
