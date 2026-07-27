# 26 — EPIC 2E-K Calibration Schema Reference

This is the authoritative reference for the Calibration Lab's data model.
Source of truth for all of it is `core/calibration-lab/codes.js` and
`core/calibration-lab/schema.js` -- if this document and the source code
ever disagree, the source code wins (per project convention); re-derive
this document from source rather than trusting stale prose.

`CALIBRATION_SCHEMA_VERSION = 2` (in `schema.js`) as of EPIC 2E-K-R2-FIX1. Sections 1-11 below describe the V1 shape, which every V2 record still contains in full (additive-only) -- see Section 12 for exactly what V2 adds, and `32_EPIC_2E_K_R2_FIX1_MIGRATION_GUIDE.md` for how a V1 record already in storage becomes a V2 record.

## 1. Calibration Session

```
{
  sessionId: string,            // crypto.randomUUID() (bounded fallback if unavailable)
  createdAt: ISO-8601 string,
  updatedAt: ISO-8601 string,
  locale: 'en' | 'th',
  appVersion: string,
  calibrationSchemaVersion: 1,
  imageCount: integer >= 0,
  reviewedCount: integer >= 0,
  legacyWins: integer >= 0,
  v2Wins: integer >= 0,
  ties: integer >= 0,
  bothRejected: integer >= 0,
  pendingCount: integer >= 0,
}
```

All counters are derived, never hand-edited: `recomputeSessionCounts(session,
records)` is the sole place session counters are computed from the
backing `records[]`, and it returns a new object rather than mutating
its input.

## 2. Semantic Image Test Record

```
{
  imageId: string,
  imageFingerprint: string | null,     // 'dhash-<16 hex chars>', pixel-derived only
  imageCategories: ImageCategory[],    // 1..N of section 3, no duplicates
  lightingCondition: LightingCondition,// exactly one of section 4
  containsSkin: boolean,
  analysisGenerationId: string | number,
  legacySnapshot: {
    temperature: number, tint: number, confidence: number (0..1),
    safetyScore: number, category: string | null,
  },
  controlledV2Snapshot: {
    temperature: number, tint: number, confidence: number (0..1),
    safetyScore: number, translationMode: string | null,
  },
  safetySnapshot: {
    legacySafetyWarningCount: integer >= 0,
    v2HardStopCount: integer >= 0,
    v2SoftCapCount: integer >= 0,
    severeIssueDetected: boolean,
  },
  userDecision: UserDecision,          // section 6, default NOT_REVIEWED
  issueCodes: IssueCode[],             // 0..N of section 7, no duplicates
  notes: string,                       // <= MAX_NOTES_LENGTH (2000)
  reviewedAt: ISO-8601 string | null,
}
```

Every core field above is a stable code, a real number, or a boolean --
never a Thai or English sentence. `validateImageRecord()` structurally
rejects any record whose `userDecision`, `issueCodes`, `imageCategories`,
or `lightingCondition` is not a recognized code (including a Thai or
English free-text sentence used in place of a decision code -- this is
explicitly covered by both the static test suite and the Section-17
hostile test suite).

## 3. Image Categories (14, multi-select)

`WEDDING, PORTRAIT, GRADUATION, ORDINATION, EVENT, INDOOR, OUTDOOR,
MIXED_LIGHT, NIGHT, BACKLIT, SKIN_DOMINANT, LANDSCAPE, PRODUCT, OTHER`

## 4. Lighting Conditions (9, single-select)

`DAYLIGHT, SHADE, TUNGSTEN, FLUORESCENT, LED, MIXED, FLASH, LOW_LIGHT,
UNKNOWN`

## 5. Session / Persistence States

```
SESSION_STATES     = NO_SESSION | ACTIVE | ENDED
PERSISTENCE_MODES  = INDEXEDDB | IN_MEMORY_FALLBACK | UNAVAILABLE
CALIBRATION_MODES  = CLOSED | REVIEW | DASHBOARD | READINESS
```

## 6. User Decisions (6)

`LEGACY_BETTER, V2_BETTER, ABOUT_EQUAL, BOTH_UNACCEPTABLE, NOT_SURE,
NOT_REVIEWED`

Selecting any of these values never triggers Apply, Export Preset, or
XMP generation -- there is no code path from `saveCurrentDecision()` to
any XMP/production-write function (verified by the hostile static test).

## 7. Issue Codes (20, multi-select, translated EN+TH)

`WB_TOO_WARM, WB_TOO_COOL, TINT_TOO_MAGENTA, TINT_TOO_GREEN,
SKIN_TONE_UNNATURAL, SKIN_TOO_ORANGE, SKIN_TOO_PALE,
OBJECT_COLOR_MISREAD_AS_LIGHT, MIXED_LIGHT_FAILURE,
EXPOSURE_TOO_BRIGHT, EXPOSURE_TOO_DARK, HIGHLIGHT_LOSS, SHADOW_LOSS,
CONTRAST_TOO_HIGH, CONTRAST_TOO_LOW, SATURATION_TOO_HIGH,
SATURATION_TOO_LOW, COLOR_SHIFT, VISUAL_RESULT_UNSTABLE, OTHER`

`SKIN_ISSUE_CODES` (used by the dashboard's skin-tone-issue counter) is
the subset: `SKIN_TONE_UNNATURAL, SKIN_TOO_ORANGE, SKIN_TOO_PALE`.

## 8. Readiness Statuses (8 as of FIX1 -- PRODUCTION_READY is structurally excluded)

`INSUFFICIENT_DATA, NEEDS_MORE_COVERAGE, NEEDS_CALIBRATION,
PROMISING_NOT_READY, READY_FOR_CANDIDATE_REVIEW, NEEDS_BROWSER_VERIFICATION,
NEEDS_PIXEL_PREVIEW, NEEDS_REVIEW_REFRESH`

The last three were added by EPIC 2E-K-R2-FIX1 (Section 4, "Readiness
Honesty") specifically so that `READY_FOR_CANDIDATE_REVIEW` can never be
reached on unverified evidence -- see Section 12 below and the ladder
order in `core/calibration-lab/readiness.js`.

`FORBIDDEN_READINESS_STATUS = 'PRODUCTION_READY'` is a named constant
specifically so that both `isValidReadinessStatus()` and any future code
reviewer can grep for the one string that must never appear as a
producible value. See the Architecture doc section 12 for the source-level
proof that no code path can produce it.

## 9. Calibration Policy Defaults (informational only, never wired to
   Production Activation)

```
minReviewedSamples: 50
minSkinImages: 15
minMixedLightImages: 10
minCategoryCoverage: 5
maxSevereIssueRate: 0.05
maxSafetyWarningRateVsLegacyRatio: 1.0   // V2 must not exceed Legacy's rate
minInsufficientDataFloor: 10            // below this, status is always INSUFFICIENT_DATA
```

## 10. Export Contract

`buildExportJson(session, records)` and `buildExportCsv(session, records)`
both read through a single allow-list, `_boundedRecord(record)`, so an
unexpected extra field on an input record (e.g. a smuggled
`imageBase64`, `localFilePath`, or `originalImageDataUrl`) can never
reach either output format, even if such a field somehow existed on the
in-memory record object. Allowed record fields: `imageId,
imageFingerprint, imageCategories, lightingCondition, containsSkin,
userDecision, issueCodes, notes, legacyConfidence, v2Confidence,
legacySafetyScore, v2SafetyScore, legacyTemperature, v2Temperature,
legacyTint, v2Tint, reviewedAt`.

CSV column order (`CSV_COLUMNS`, fixed): `sessionId, imageId,
imageCategories, lightingCondition, containsSkin, userDecision,
issueCodes, legacyConfidence, v2Confidence, legacySafetyScore,
v2SafetyScore, legacyTemperature, v2Temperature, legacyTint, v2Tint,
reviewedAt`. Array-valued cells (`imageCategories`, `issueCodes`) are
joined with `;`; cells are CSV-escaped (quotes doubled, wrapped when they
contain a comma/quote/newline); line endings are `\r\n`.

## 11. Storage Limits

`MAX_NOTES_LENGTH = 2000`, `MAX_IMAGES_PER_SESSION = 500`,
`MAX_STORED_SESSIONS = 20`. Both storage backends enforce these by
throwing (`.code = 'SESSION_LIMIT_REACHED'` / `'IMAGE_LIMIT_REACHED'`),
never by silently evicting older data.

## 12. Schema V2 -- `previewEvidence` (EPIC 2E-K-R2-FIX1)

Every Semantic Image Test Record (Section 2) gains one additive field,
`previewEvidence`, plus two audit-trail flags. Nothing in Sections 1-11
above was removed or renumbered -- a V2 record is a strict superset of
a V1 record.

```
{
  ...(all Section 2 fields, unchanged)...
  recordSchemaVersion: 2,
  previewEvidence: {
    previewTruthCode: PreviewTruthCode,             // see below, 10 codes
    legacyPreviewState: string,                      // e.g. 'rendered' | 'unknown' | 'failed'
    controlledV2PreviewState: string,
    legacyTransformed: boolean,
    controlledV2Transformed: boolean,
    sameSourceGeometry: boolean,
    sourceWidth: integer | null,
    sourceHeight: integer | null,
    legacyOutputWidth: integer | null,
    legacyOutputHeight: integer | null,
    controlledV2OutputWidth: integer | null,
    controlledV2OutputHeight: integer | null,
    legacyPixelHash: string (sha256 hex) | null,
    controlledV2PixelHash: string (sha256 hex) | null,
    legacyNonTransparentPixelCount: integer | null,
    controlledV2NonTransparentPixelCount: integer | null,
    pixelDifferenceDetected: boolean | null,
    browserVerified: boolean,
    visualDecisionEligible: boolean,
    sourceFingerprintMatch: boolean,
    renderGenerationId: string | number | null,
    verifiedAt: ISO-8601 string | null,
  },
  legacyDecisionPreservedForAudit: boolean,   // true only for migrated V1 records
  requiresVisualReReview: boolean,            // true only for migrated V1 records
}
```

**`previewTruthCode` (10 codes, `core/calibration-lab/codes.js` ->
`PREVIEW_TRUTH_CODES`):** `BOTH_RENDERED_DIFFERENT, BOTH_RENDERED_IDENTITY,
LEGACY_RENDER_FAILED, V2_RENDER_FAILED, V2_EMPTY_CANVAS, GEOMETRY_MISMATCH,
SOURCE_MISMATCH, STALE_GENERATION, SOURCE_UNAVAILABLE, NOT_RENDERED`.

`previewEvidence` is built exclusively by
`buildPreviewEvidence()`/`classifyPreviewTruth()` in
`core/calibration-lab/preview-evidence.js` (100% pure, no DOM) from
measurements taken by `core/calibration-lab/pixel-truth-capture.js`
(the sole browser-only orchestrator -- see
`33_EPIC_2E_K_R2_FIX1_PIXEL_TRUTH_ARCHITECTURE.md`). `previewEvidence`
NEVER contains a raw canvas, blob, base64 string, object URL, file path,
filename, or the original image -- only stable codes, booleans,
integers, and SHA-256 hex hashes. This is enforced structurally (no
function in the module ever reads or forwards such a value) and proven
by the hostile static test suite.

**Decision Eligibility Gate** (Section 3 of the FIX1 spec):
`isDecisionAllowedForEvidence(decisionCode, previewEvidence)` --
exported from the same `preview-evidence.js` module and imported by
BOTH `ui/calibration-lab/calibration-lab-controller.js` (authoritative
enforcement inside `saveCurrentDecision()`) and
`ui/calibration-lab/calibration-lab-renderer.js` (UI-level chip
disabling) -- is the single source of truth for which `UserDecision`
values a given `previewEvidence` object may legally pair with:

- `LEGACY_BETTER` / `V2_BETTER` require `previewTruthCode ===
  'BOTH_RENDERED_DIFFERENT'` AND every other evidence field proving
  genuine, matching, non-stale rendering on both sides.
- `ABOUT_EQUAL` / `BOTH_UNACCEPTABLE` / `NOT_SURE` are allowed for
  `BOTH_RENDERED_DIFFERENT` or `BOTH_RENDERED_IDENTITY` only.
- Every other `previewTruthCode` allows only `NOT_REVIEWED` --
  Decision Controls and Save are disabled in the UI AND rejected by the
  Controller even when called directly, bypassing the UI (verified by
  a hostile direct-controller-call test in
  `qa/epic-2e-k-calibration-lab-browser-test.mjs`).
