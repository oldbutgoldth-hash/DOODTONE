# EPIC 2E-P1B — AI Image Analysis Report: Schema Contract

Defined in `core/single-image/report/analysis-report-schema.js`.
`REPORT_SCHEMA_VERSION = 'P1B_REPORT@1'`.

## 1. Top-level shape

```js
{
  reportId: string,          // uuid, unique per build
  sessionId: string,         // owning Session id
  generationId: number,      // owning Session generation at build time
  schemaVersion: 'P1B_REPORT@1',
  status: REPORT_STATUS,     // see §2
  createdAt: string,         // ISO timestamp
  image: { width, height, fileName: null, aspectRatio },
  summary: { shortDescription: {code, params}, ... },
  exposure: Section,
  dynamicRange: Section,
  whiteBalance: Section,
  tone: Section,
  color: Section,
  skin: Section,
  scene: Section,
  technicalIssues: Issue[],
  creativeCharacteristics: Characteristic[],
  recommendedCorrections: { technical: [...], creative: [...], safety: [...] },
  safetyWarnings: Warning[],
  lineage: { <sectionId>: LineageEntry, ... },
  diagnostics: { reportBuildCount, evidenceKeysSeen: [...], rawEvidenceSnapshot: {...} },
}
```

`image.fileName` is always `null` in the report — file names are never
copied into the report or its diagnostics export (spec requirement: no
filenames/binary data in diagnostics).

## 2. Status enums

```js
REPORT_STATUS = {
  WAITING_FOR_ANALYSIS, BUILDING, COMPLETE, PARTIAL, FAILED, STALE,
}
SECTION_STATUS = {
  AVAILABLE, PARTIAL, LOW_CONFIDENCE, UNAVAILABLE, FAILED,
}
CONFIDENCE_LEVEL = { HIGH, MEDIUM, LOW, UNAVAILABLE }
ISSUE_SEVERITY = { INFO, CAUTION, WARNING, CRITICAL }
ANALYSIS_SECTION_IDS = ['exposure','dynamicRange','whiteBalance','tone','color','skin','scene']
```

`report.status` is derived from the owning Session's status at build
time (`COMPLETED` -> `COMPLETE`, `PARTIAL` -> `PARTIAL`) and independently
downgraded to `FAILED` if `validateReportShape()` rejects the built
object — see §5.

## 3. Section shape

Every one of the 7 `ANALYSIS_SECTION_IDS` uses the same shape
(`createEmptySection()`):

```js
{
  status: SECTION_STATUS,
  confidence: { score: number|null, level: CONFIDENCE_LEVEL },
  observations: [{code, params}],
  fields: { <fieldName>: value, ... },   // section-specific, see evidence map doc
  fallbackUsed: boolean,
  warnings: [{code, params}],
}
```

A section with no supporting evidence is `UNAVAILABLE`, `confidence:
{score: null, level: 'UNAVAILABLE'}`, empty `observations`/`fields`, and
carries no positive claim of any kind — never a placeholder value.

## 4. Issue / Characteristic / Warning shape

```js
// technicalIssues[]
{ code, severity, titleKey, descriptionKey, confidence, sourceEvidence: [string], recommendationKey }

// creativeCharacteristics[]
{ code, labelKey, params, confidence }

// safetyWarnings[]
{ code, params, severity }
```

`code` values are drawn from a fixed vocabulary (see
`P1B_PHOTOGRAPHER_LANGUAGE_GUIDE.md` for the full list); `titleKey`/
`descriptionKey`/`recommendationKey`/`labelKey` are i18n key suffixes
under `report.issues.<code>.*` / `report.creative.<code>` resolved at
render time — never a hardcoded string in the builder or engine.

## 5. Validation (`validateReportShape(report)`)

Returns `{ valid: boolean, errors: string[] }`. Checks, in order:

1. `reportId`, `sessionId`, `generationId`, `schemaVersion` all present
   and correctly typed.
2. Every key in `ANALYSIS_SECTION_IDS` exists on the report and has the
   Section shape from §3.
3. Deep-walks the entire report (`_walkForUnsafeValues`) rejecting any
   `undefined`, `NaN`, or `Infinity` value at any depth, and any
   genuine circular reference (ancestor-path tracking, not a global
   "visited" set — a value legitimately referenced from two different
   branches, e.g. a shared confidence object, is not an error).
4. Every `confidence.score` is `null` or a number in `[0, 100]`.
   Every `confidence.level` is one of `CONFIDENCE_LEVEL`.
5. Every `technicalIssues[].severity` is one of `ISSUE_SEVERITY`.
6. `report.status` is one of `REPORT_STATUS`.
7. `technicalIssues`, `creativeCharacteristics`, `safetyWarnings`, and
   each section's `observations`/`warnings` are real arrays.
8. `lineage` is JSON-serializable (round-tripped through
   `JSON.stringify`/`JSON.parse` and diffed for shape).

If any check fails, the builder sets `report.status = 'FAILED'` and the
UI shows the exact validation error via
`report.diagnostics.validationErrors` — the app does not crash, and no
partially-valid report is committed as if it were trustworthy.

## 6. `createEmptyReport({sessionId, generationId, reportId})`

Produces a `WAITING_FOR_ANALYSIS`-status report with every section
`UNAVAILABLE` and no issues/characteristics/warnings — this is what
`ui/app.js` shows (via the renderer's `clearSingleImageReportDisplay`)
before any analysis has run, and is itself schema-valid (verified by
P1B test case 4).
