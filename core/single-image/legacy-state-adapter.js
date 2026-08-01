/**
 * EPIC 2E-P1A — Legacy Compatibility Adapter
 *
 * One-way sync: Session evidence -> ui/app.js's existing `state.last*`
 * fields. This is the ONLY place `state.last*` should be written from
 * during single-image analysis going forward — see
 * P1A_LEGACY_COMPATIBILITY_MAP.md for the full mapping table and the
 * exact `ui/app.js` call sites this replaces.
 *
 * Rules (verified by tests in qa/epic-2e-p1a-legacy-adapter-test.mjs):
 *  - Session is written first (by the orchestrator, via
 *    evidence-normalizer.js), legacy state second, always through
 *    syncSessionToLegacyState().
 *  - Legacy state is a MIRROR only. Nothing in this file ever reads
 *    from `state.last*` to decide what to write into the Session.
 *  - A stale Session (one that is no longer the active session in
 *    single-image-session-store.js) must never reach this function —
 *    that check is the orchestrator's responsibility, enforced via
 *    single-image-session-store.js's updateActiveSession().
 */

// Session evidence key -> legacy `state.last*` field name.
// `null` means "no legacy UI field exists for this evidence key today"
// (confirmed in P1A_SOURCE_LINEAGE_AUDIT.md §3/§4 — `scene` and
// `colorCast` are held only in local variables inside runAnalysis(),
// never assigned to `state`).
export const LEGACY_MAP = Object.freeze({
  stats: 'lastStats',
  imageAnalysis: 'lastImageAnalysis',
  palette: 'lastPalette',
  harmony: 'lastHarmony',
  skin: 'lastSkin',
  colorCast: null,
  scene: null,
  wb: 'lastWB',
  hsl: 'lastHSL',
  grading: 'lastGrading',
  toneCurves: 'lastToneCurves',
  calibration: 'lastCalibration',
  styleRecognition: 'lastStyleRecognition',
  basic: 'lastBasic',
  styleFeatureGraph: 'lastStyleFeatureGraph',
  styleFingerprint: 'lastStyleFingerprint',
  validationReport: 'lastValidationReport',
  benchmark: 'lastBenchmark',
  decisionReport: 'lastDecisionReport',
  referenceTransfer: 'lastReferenceTransfer',
  processingLog: 'lastProcessingLog',
});

/**
 * Sync ONE evidence key's normalized `.result` into its legacy
 * `state.last*` mirror, if a mirror exists for that key.
 * @param {object} legacyState - the real `ui/app.js` `state` object.
 * @param {string} evidenceKey
 * @param {object} normalizedEntry - the evidence-normalizer.js wrapper.
 * @returns {boolean} true if a legacy field was written.
 */
export function syncEvidenceKeyToLegacyState(legacyState, evidenceKey, normalizedEntry) {
  const legacyField = LEGACY_MAP[evidenceKey];
  if (!legacyField) return false;
  legacyState[legacyField] = normalizedEntry ? normalizedEntry.result : null;
  return true;
}

/**
 * Sync an entire Session's evidence bundle into legacy `state`. Only
 * ever call this for the currently-active Session (the orchestrator
 * checks staleness before calling this — see
 * single-image-orchestrator.js's commitEvidence()/syncLegacyState()).
 * @returns {string[]} the legacy field names that were written.
 */
export function syncSessionToLegacyState(session, legacyState) {
  const written = [];
  for (const [evidenceKey, entry] of Object.entries(session.evidence)) {
    if (entry === null) continue;
    if (syncEvidenceKeyToLegacyState(legacyState, evidenceKey, entry)) {
      written.push(LEGACY_MAP[evidenceKey]);
    }
  }
  return written;
}

/**
 * Clear every legacy field this adapter knows how to write. Used by
 * Reset flows so legacy state cannot outlive its Session.
 */
export function clearLegacyMirrors(legacyState) {
  for (const legacyField of Object.values(LEGACY_MAP)) {
    if (legacyField) legacyState[legacyField] = null;
  }
}
