# 32 — EPIC 2E-K-R2-FIX1 Migration Guide (Calibration Schema V1 → V2)

Source of truth: `core/calibration-lab/migrate-v1-to-v2.js` (100% pure,
no DOM, fully Node-testable). If this document and that file ever
disagree, the source code wins.

## 1. Why a migration exists

Every Calibration Lab record created before EPIC 2E-K-R2-FIX1 has no
`previewEvidence` field at all -- the Real Pixel Comparison feature (R2)
rendered pixels for on-screen display, but never captured or persisted
proof of that rendering as structured evidence. FIX1 makes
`previewEvidence` the single source of truth for whether a decision is
allowed (see `26_EPIC_2E_K_CALIBRATION_SCHEMA.md` Section 12). A record
missing that field is not an error -- it is exactly what every
pre-FIX1 record legitimately looks like -- so a real, tested migration
path is required rather than treating old data as corrupt.

## 2. Classification: `classifyMigrationNeed(raw)`

Every stored session/record is classified into exactly one of:

- `UP_TO_DATE` -- already `recordSchemaVersion`/`calibrationSchemaVersion
  === 2` with a structurally valid `previewEvidence`. No action taken.
- `NEEDS_MIGRATION` -- a structurally valid V1 shape (all Section 1/2
  fields of the V1 schema present and well-typed) missing only the V2
  additions. Eligible for migration.
- `CORRUPT` -- fails even the V1 structural check (e.g. `userDecision`
  is not a recognized code, `imageId` is missing). Never migrated,
  never silently repaired -- a migrated-but-still-invalid record is
  treated as `CORRUPT` and is never persisted (see Section 5, fail-closed).

## 3. What migration adds (additive only)

For an image record, exactly three things are added -- nothing already
on the record is altered or removed:

```
recordSchemaVersion: 2
previewEvidence: createNotRenderedPreviewEvidence()   // previewTruthCode = NOT_RENDERED,
                                                       // browserVerified = false,
                                                       // visualDecisionEligible = false,
                                                       // pixelDifferenceDetected = null,
                                                       // verifiedAt = null
legacyDecisionPreservedForAudit: true
requiresVisualReReview: true
```

The record's original `userDecision`, `notes`, `reviewedAt`, and every
snapshot field are preserved byte-for-byte. The decision is not
discarded -- it is explicitly flagged as **audit-only**: it remains
visible for historical audit, but is excluded from Dashboard and
Readiness math (`aggregate.js`'s `_reviewedRecords()` and
`readiness.js`'s `_reviewed()` both filter out
`legacyDecisionPreservedForAudit === true` rows) until a human
genuinely re-reviews the image under the new pixel-truth gate.

For a session, migration adds `calibrationSchemaVersion: 2` and a new
derived counter, `legacyAuditOnlyCount`, via
`recomputeSessionCounts()` -- again additive, never replacing an
existing counter.

## 4. Idempotency

Running migration twice on the same record produces byte-identical
output the second time -- `classifyMigrationNeed()` on an
already-migrated record returns `UP_TO_DATE`, so
`migrateImageRecordV1ToV2()` is never called a second time on the same
row. Verified directly in `qa/epic-2e-k-calibration-lab-storage-test.mjs`
(Section 5 block): loading the same session twice produces the same
migrated record both times, and exactly one backup row is written (see
Section 6), never two.

## 5. Fail-closed guarantee

Both storage backends validate the migrated shape with
`isValidPreviewEvidence()`/`validateImageRecord()` **before** writing
it back. A record whose V1 shape was itself broken in a way migration
cannot repair (e.g. garbage `userDecision`) is correctly classified
`CORRUPT`, is never migrated, and is never written to storage in a
migrated form. This was a concrete defect found and fixed during this
round's own testing (see the Errors/Fixes note in this round's QA
report) -- a garbage-but-otherwise-plausible row was, before the fix,
merged with migration fields and written despite still failing overall
validation; the fix inserts the validate-before-persist check in both
the IndexedDB backend's `_migrateImageRecordRowIfNeeded()` and the
in-memory backend's `loadImageRecordsForSession()`.

## 6. Backup before migration

Before a record is overwritten with its migrated form, the IndexedDB
backend copies the untouched original into a new object store,
`imagesLegacyBackupV1` (added via `DB_VERSION` 1 → 2's
`onupgradeneeded`), keyed by `imageId` with `_sessionId` and
`_backedUpAt` metadata attached. The backup check is itself
idempotent -- a second load does not re-write the backup if one already
exists for that `imageId`. No original data is ever lost: the backup
plus the audit-preserved `userDecision`/`notes` together mean a V1
record's full original content can always be reconstructed.

## 7. Where migration runs

`_migrateImageRecordRowIfNeeded()` (IndexedDB backend) is wired into
both `_scanImageRecords()` (single-session load) and
`_scanAllImageRecordsAcrossAllSessions()` (cross-session scan, used by
Readiness/Dashboard aggregation) -- so migration happens transparently
on read, the first time any code path touches an old record, and never
requires a separate manual "migrate now" action. The in-memory fallback
backend (used when IndexedDB is unavailable) mirrors the same
classify -> backup -> migrate -> validate-before-persist sequence with
its own `legacyBackupV1` Map.

## 8. Testing

`qa/epic-2e-k-calibration-lab-storage-test.mjs` Section 5 seeds a real
v1 session and record via real `fake-indexeddb` transactions (not
mocked), then verifies: migration occurs, the migrated record's
`previewEvidence` matches `createNotRenderedPreviewEvidence()` exactly,
the original notes/decision are preserved verbatim, the audit flags are
set, migration is idempotent across repeated loads, and exactly one
backup row exists for the migrated `imageId`. 24/24 assertions in that
file pass (see this round's QA report,
`34_EPIC_2E_K_R2_FIX1_QA_REPORT.md`).
