/**
 * core/calibration-lab/migrate-v1-to-v2.js
 *
 * EPIC 2E-K-R2-FIX1 -- Section 5: Migration V1 -> V2.
 *
 * Pure (no DOM, no IndexedDB) transformation of one raw, possibly-v1
 * Semantic Image Test Record into the schema-v2 shape (Section 2).
 * The storage layer (ui/calibration-lab/calibration-lab-storage.js)
 * is the only caller, and is responsible for the BACKUP-before-write
 * and actual persistence side effects -- this module only decides
 * "does this record need migrating" and "what does the migrated
 * record look like", so both can be exercised with plain objects in
 * Node, no fake-indexeddb required.
 *
 * GUARANTEES (Section 5's explicit requirements):
 *  - Idempotent: migrating an already-migrated (or freshly-created v2)
 *    record returns it completely unchanged (same reference even).
 *  - Fail closed: a record too malformed to safely migrate (missing
 *    imageId, not an object, etc.) is reported via `needsMigration`
 *    returning `'CORRUPT'` rather than guessed at -- the storage layer
 *    treats that as a corrupt record (excluded, counted), never
 *    silently "fixed" with invented data.
 *  - Never loses original data: every original field on the v1 record
 *    is preserved verbatim (spread first) -- only the NEW v2 fields
 *    are added/overwritten.
 *  - The original Decision is preserved for audit (never reset to
 *    NOT_REVIEWED) but flagged so it can never feed Dashboard win-rate
 *    or Readiness math (see aggregate.js/readiness.js's own exclusion
 *    of `legacyDecisionPreservedForAudit === true`).
 */

import { RECORD_SCHEMA_VERSION } from './schema.js';
import { createNotRenderedPreviewEvidence, isValidPreviewEvidence } from './preview-evidence.js';

/**
 * Classifies a raw stored record's migration need. Returns:
 *  - `'CORRUPT'` -- too malformed to migrate safely (fail closed).
 *  - `'NEEDS_MIGRATION'` -- a genuine v1-shaped record (no
 *    previewEvidence / old or missing recordSchemaVersion).
 *  - `'UP_TO_DATE'` -- already schema-v2 shaped; migrating is a no-op.
 */
export function classifyMigrationNeed(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.imageId !== 'string' || raw.imageId.length === 0) {
    return 'CORRUPT';
  }
  const hasV2Version = typeof raw.recordSchemaVersion === 'number' && raw.recordSchemaVersion >= RECORD_SCHEMA_VERSION;
  const hasEvidence = isValidPreviewEvidence(raw.previewEvidence);
  if (hasV2Version && hasEvidence) return 'UP_TO_DATE';
  return 'NEEDS_MIGRATION';
}

/** True only for a record that genuinely needs the v1->v2 migration step (never true for corrupt or already-migrated records). */
export function needsV1ToV2Migration(raw) {
  return classifyMigrationNeed(raw) === 'NEEDS_MIGRATION';
}

/**
 * Migrates one raw record. Idempotent (returns the SAME object
 * reference, unchanged, when no migration is needed) and never throws
 * -- a record classified `'CORRUPT'` is returned as `null` so the
 * caller can exclude/count it exactly like any other corrupt record.
 */
export function migrateImageRecordV1ToV2(raw) {
  const need = classifyMigrationNeed(raw);
  if (need === 'CORRUPT') return null;
  if (need === 'UP_TO_DATE') return raw;

  const hadPriorDecision = typeof raw.userDecision === 'string' && raw.userDecision !== 'NOT_REVIEWED';
  return {
    ...raw,
    recordSchemaVersion: RECORD_SCHEMA_VERSION,
    previewEvidence: isValidPreviewEvidence(raw.previewEvidence) ? raw.previewEvidence : createNotRenderedPreviewEvidence(),
    // The original `userDecision`/`issueCodes`/`notes`/`reviewedAt`
    // fields are already preserved verbatim by the spread above --
    // this migration NEVER resets or clears them. Only these two new
    // audit/gating flags are added.
    legacyDecisionPreservedForAudit: hadPriorDecision ? true : (raw.legacyDecisionPreservedForAudit === true),
    requiresVisualReReview: hadPriorDecision ? true : (raw.requiresVisualReReview === true),
  };
}
