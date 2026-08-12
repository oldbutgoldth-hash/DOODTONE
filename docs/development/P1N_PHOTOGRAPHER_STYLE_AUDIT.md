# EPIC 2E-P1N — Photographer Style Intelligence: Audit and Design

## 1. Goal

Wire the project's existing named photographer-style classification
into the P1B Report and its UI, per this project's own task
description: "audit existing style-recognition-engine/style-
fingerprint/style-benchmark-engine modules, design how output surfaces
on session.report and UI, wire in, test, document, package."

## 2. Audit: three modules, three different jobs

Grepping `core/` for every style-related file surfaced three distinct
modules, all pre-dating the 2E-P1-series:

- **`core/style-recognition-engine/index.js`** — `recognizeStyle(img)`.
  A Layer-1-shaped declarative classifier: a `PROFILES` table of 10
  named categories (Wedding, Portrait, Landscape, Travel, Food, Street,
  Fashion, Documentary, Vintage, Luxury), each with feature-range/
  weight gates read against a 20-dimension feature vector extracted
  directly from Canvas pixels. Returns `{styles[], top, second,
  features, summary, confidence, warnings, reason}`, softmax-normalized,
  with built-in ambiguity/low-confidence warning generation. **This is
  the actual named-style vocabulary** — the thing a photographer means
  by "what style is this."
- **`core/style-fingerprint/index.js`** — `buildStyleFingerprint(ctx)`.
  A much older, larger system that summarizes mood/warmth/contrast/
  palette/skin intent by fusing ~22 analysis engines (via
  `core/feature-fusion-engine`'s Style Feature Graph) into one
  descriptive fingerprint. It is the ground truth `core/xmp-validator`
  checks the final preset against — a technical/creative summary, not
  a named category.
- **`core/style-benchmark-engine/index.js`** — `benchmarkStylePreservation(ctx)`.
  A diagnostic/reporting layer that runs AFTER Decision/Lightroom
  Mapping/Pre-XMP Validation, scoring how well the final generated
  preset preserved the Style Fingerprint (`overallStyleSimilarity`,
  `safetyScore`, and a `photographerAcceptance` usability estimate).
  It never mutates anything — pure diagnostic output.

## 3. Discrepancy with the `photographer-style-intelligence` skill

The `anthropic-skills:photographer-style-intelligence` skill (which
this project's own layered-classification pattern was extracted from
in an earlier round) describes "17 photographer styles, 61 shared DNA
ingredients." Direct inspection of the current
`core/style-recognition-engine/index.js` found exactly **10** category
profiles (its own header comment claims 11 — an unrelated,
pre-existing, unresolved off-by-one in that file's own comment, not
touched this round) and **no** shared "DNA ingredient" catalog
anywhere in this codebase. Per this project's "Latest Project File
Rule," the skill's numbers are **not** treated as fact for this
specific codebase — they describe a different, larger iteration the
pattern was generalized from. P1N does not build a new Layer-2 DNA
catalog, Layer-3 validation, or Layer-4 feasibility model this round;
`style-recognition-engine` (Layer 1) plus `style-fingerprint`/
`style-benchmark-engine` as supporting context is exactly what the
task's own scope ("wire ... into Report/UI") calls for, and building
new classification layers would be scope creep beyond it.

## 4. The real gap: evidence already flows, nothing reads it

Tracing `recognizeStyle()`'s call site in `ui/app.js`'s ColorEngines
stage (and `benchmarkStylePreservation()`'s in the Decision stage)
found all three modules **already wired end-to-end**:

- `ui/app.js` already calls `recognizeStyle(img)`, `buildStyleFingerprint()`,
  and `benchmarkStylePreservation()`.
- All three results are already committed via
  `singleImageOrchestrator.commitEvidence(analysisTicket, '<key>', ...)`
  into `session.evidence.styleRecognition` /
  `session.evidence.styleFingerprint` / `session.evidence.benchmark` —
  reserved evidence slots that already existed in
  `single-image-session.js` (`// <- state.lastStyleRecognition
  (style-recognition-engine)`, etc.) and in
  `single-image-analysis-profile.js`'s module table.
- `commitEvidence()` also auto-syncs each into its documented legacy
  mirror (`state.lastStyleRecognition`/`.lastStyleFingerprint`/
  `.lastBenchmark`) via `syncEvidenceKeyToLegacyState()`.

So P1N's job was **not** "close a wiring gap so evidence reaches
Session" (it already did) — it was "read already-flowing evidence and
surface it in the Report/UI," a lighter lift than the task's own
original phrasing implied. Confirmed by grep: zero references to
`styleRecognition`/`styleFingerprint`/`benchmark` existed anywhere in
`core/single-image/report/` or `ui/single-image-report-renderer.js`
before this round.

## 5. Design: one new Report section, reusing all three evidence keys

- **`core/single-image/report/photographer-interpretation-engine.js`**
  gains `classifyPhotographerStyle({ styleRecognition, styleFingerprint,
  benchmark })`, following this file's exact existing conventions
  (`{code, params}` observations resolved through i18n `t()` at render
  time, `SECTION_STATUS`, null-safe on any missing input).
  `styleRecognition` is the section's one required input (a missing/
  soft-failed entry makes the section UNAVAILABLE, matching every
  other section's behavior); `styleFingerprint` and `benchmark` are
  optional supporting context that degrade gracefully when absent.
- Ambiguity (top/second margin < 5) and low-confidence (top < 25) flags
  are **recomputed here** directly from `styleRecognition.top`/
  `.second`, not by reusing the engine's own raw English `.warnings`
  strings — keeping the section on this project's i18n convention
  instead of leaking untranslated English into a Thai UI.
- **`core/single-image/report/analysis-report-schema.js`**: added
  `'photographerStyle'` to `ANALYSIS_SECTION_IDS` and
  `REQUIRED_TOP_KEYS`, plus its empty-section shape in
  `createEmptyReport()`. Additive only — no existing section id,
  required key, or field renamed/removed.
- **`core/single-image/report/analysis-report-builder.js`**: reads
  `styleRecognition`/`styleFingerprint`/`benchmark` evidence (with the
  same documented legacy-fallback pattern as `stats`/`wb`/etc.),
  builds the section, assigns `report.photographerStyle`, and records
  a `lineage.photographerStyle` entry referencing all 3 evidence keys
  and their 3 source modules. `report.safetyWarnings` deliberately does
  **not** include this section's warnings — an ambiguous style
  classification is not an export-safety risk in the sense that array
  represents (clipping, cast, low WB confidence, etc.).
- **`ui/single-image-report-renderer.js`**: one new `_sectionBlock()`
  call, placed immediately after the existing Scene section, reusing
  the same generic renderer every other section already uses. `topStyle`/
  `alternates[].style` are rendered as raw category names, matching
  this renderer's existing precedent for `report.scene.primaryType`
  (also never translated).
- **`ui/i18n/en.js` / `ui/i18n/th.js`**: new `report.section.
  photographerStyle`, 4 new `report.field.*` keys, and the full set of
  `report.observations/recommendations/warnings.photographerStyle.*`
  codes, in both locales.

## 6. What was deliberately NOT built this round

- No new Layer-2 DNA ingredient catalog, Layer-3 internal-consistency
  validator, or Layer-4 feasibility model for `style-recognition-engine`
  itself (see §3 — out of P1N's actual scope).
- No change to `style-recognition-engine`'s 10-category `PROFILES`
  table, its feature extraction, or its confidence/warning computation.
- No change to `style-fingerprint` or `style-benchmark-engine`'s own
  logic — both are read purely as pre-existing evidence.
- No re-run of any Core module — the Report continues to read only
  already-committed `session.evidence`, per every prior P1-series
  round's reuse-first convention.
