# EPIC 2E-P1B — Evidence-to-Report Field Map

Source of truth for every field below: the real evidence keys committed
to `session.evidence` by the P1A orchestrator (`core/single-image/`)
and read exclusively via `_readEvidence()` in
`core/single-image/report/analysis-report-builder.js`. Nothing here is
assumed from the spec — every key name matches the actual Production
Core module output shape as audited before implementation.

## 1. Evidence keys read

| Evidence key | Core module | Report section(s) that use it | Legacy fallback key |
|---|---|---|---|
| `stats` | `core/histogram-engine` | exposure, dynamicRange, tone, color (partial), scene (partial) | `state.lastStats` |
| `wb` | `core/whitebalance-engine` | whiteBalance | `state.lastWB` |
| `colorCast` | `core/color-cast-detector` | whiteBalance | none (documented — no legacy mirror exists for this key in P1A) |
| `skin` | `core/skintone-engine` + `core/skin-classifier` | skin | `state.lastSkin` |
| `palette` | `core/kmeans-engine` | color | `state.lastPalette` |
| `harmony` | `core/color-harmony-engine` | color | `state.lastHarmony` |
| `hsl` | `core/hsl-analyzer-engine` | color | `state.lastHSL` |
| `scene` | `core/scene-classifier` | scene, exposure (category hint only) | none (documented — no legacy mirror) |

An evidence entry is only used if `entry.status` is `COMPLETED` or
`CACHE_HIT` (both are `MODULE_STATE` values from
`core/single-image/single-image-session.js`) and `entry.result` is
non-null. `SOFT_FAILED`/`FAILED`/`TIMED_OUT`/`ABORTED` entries are
treated as absent evidence for report purposes — the corresponding
section becomes `UNAVAILABLE`, and the module's key is recorded in
`report.diagnostics.softFailedModules`.

## 2. Legacy fallback (documented, and only a fallback)

`LEGACY_FALLBACK_KEY` maps 6 of the 8 evidence keys (`stats`, `wb`,
`skin`, `palette`, `harmony`, `hsl`) to their pre-P1A `state.last*`
mirror. `colorCast` and `scene` have **no** legacy mirror — this matches
P1A's own documented limitation (both are P1A-native evidence keys with
no pre-existing legacy equivalent). If either is genuinely missing, the
affected section is `UNAVAILABLE` with no fallback attempted; this is
correct, not a gap.

Every fallback use sets `fallbackUsed: true` on the relevant
`_readEvidence()` result, which propagates into both the section's
`fallbackUsed` flag and `lineage.<section>.fallbackUsed` — visible to
the user only inside Advanced Diagnostics, never presented as
first-class evidence.

## 3. Section-by-section field derivation

### exposure
Built by `classifyExposure({stats, sceneCategory})`. Uses
`stats.meanLuminance` (or equivalent), `stats.clipping.highlights`/
`.shadows`, `stats.histogram` tone-zone distribution, and
`sceneCategory` (from `scene.category`, falling back to
`stats.category`) jointly — never mean luminance alone. This is what
lets a high-key wedding photo with protected highlights classify as
`highKey`, not `overexposed`.

### dynamicRange
Built by `classifyDynamicRange({stats})`. Uses `stats` histogram spread
and clipping percentages.

### whiteBalance
Built by `classifyWhiteBalance({wb, colorCast})`. Uses `wb`'s neutral-
point evidence and confidence, and `colorCast.bgGreenDominant` /
`colorCast.subjectNeutral` / `colorCast.border.label` to distinguish a
likely illuminant cast from a dominant-background color (the explicit
green-outdoor-background example from the spec) — see
`P1B_CONFIDENCE_MODEL.md` §3 for the exact decision logic.

### tone
Built by `classifyTone({stats})`. Uses `stats` tone-zone histogram.

### color
Built by `classifyColor({stats, palette, harmony, hsl, colorCast})`.
Section status is `UNAVAILABLE` only if `stats` AND all of
`palette`/`harmony`/`hsl` are missing; a subset of missing color
evidence degrades the section to `PARTIAL`, not `UNAVAILABLE` — matching
the spec's "missing optional Core must not break the complete report."

### skin
Built by `classifySkin({skin})`. If `skin` is null/missing, the section
is unconditionally `UNAVAILABLE` and reports "Not detected" — never an
invented skin tone or protection value.

### scene
Built by `classifyScene({scene, stats})`. Uses `scene.category` and
`stats` as a corroborating signal.

## 4. Technical issues and creative characteristics

`buildTechnicalIssues({stats, wb, colorCast, skin})` only emits a
`technicalIssues[]` entry when the specific evidence backing that issue
code exists and supports it (e.g. `HIGHLIGHT_CLIPPING` requires
`stats.clipping.highlights` above its threshold; `WB_LOW_CONFIDENCE`
requires `wb.confidence` below threshold) — see
`P1B_PHOTOGRAPHER_LANGUAGE_GUIDE.md` for the full code list and their
exact evidence preconditions.

`buildCreativeCharacteristics({exposureSection, colorSection,
wbSection})` derives creative-characteristic entries only from already-
built section results (never re-reads raw evidence), keeping this a
second-order aggregation with no independent evidence path to audit
separately.

## 5. What is never used as report evidence

DOM values, current slider positions, freshly-invoked Core module calls,
hard-coded sample data, and synthetic placeholder evidence are never
read by the builder — `buildAnalysisReportFromSession(session,
{legacyState})`'s only inputs are the passed `session` object and the
optional `legacyState` fallback object. This is enforced structurally
(the function takes no other arguments) and verified by P1B test cases
1-3.
