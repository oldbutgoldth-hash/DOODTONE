/**
 * ui/calibration-lab/calibration-lab-controller.js
 *
 * EPIC 2E-K -- CONTROLLED V2 CALIBRATION LAB
 *
 * Owns the Calibration Lab's OWN, fully independent state -- session
 * lifecycle, the current image list/cursor, and the storage backend.
 * Never imports from or mutates `ui/app.js`'s `state` object; the only
 * things it reads from the rest of the app are read-only calls into
 * `core/*` analysis engines via `runCalibrationComparisonPipeline`.
 *
 * Simple pub-sub: every mutating method calls `_notify()` after
 * updating internal state, so the renderer can subscribe once and
 * re-render on every change without polling.
 */

import { createCalibrationLabStorage } from './calibration-lab-storage.js';
import { runCalibrationComparisonPipeline } from '../../core/calibration-lab/run-comparison-pipeline.js';
import { createBoundedLruCache } from '../../core/calibration-lab/bounded-lru-cache.js';
import {
  createCalibrationSession, createImageTestRecord, recomputeSessionCounts, MAX_NOTES_LENGTH,
} from '../../core/calibration-lab/schema.js';
import { isValidCategoryList, isValidLightingCondition, isValidUserDecision, isValidIssueCodeList } from '../../core/calibration-lab/codes.js';
import { computeCalibrationDashboard } from '../../core/calibration-lab/aggregate.js';
import { computeReadinessReport } from '../../core/calibration-lab/readiness.js';
import { buildExportJson, buildExportCsv } from '../../core/calibration-lab/export-dataset.js';
// EPIC 2E-K-R2-FIX1 -- PIXEL TRUTH, DECISION GATE AND EVIDENCE CLOSURE
import { capturePixelTruthEvidence } from '../../core/calibration-lab/pixel-truth-capture.js';
import { isDecisionAllowedForEvidence, deriveUiBlockerReasonCode, createNotRenderedPreviewEvidence } from '../../core/calibration-lab/preview-evidence.js';

const APP_VERSION_FALLBACK = 'unknown';

// EPIC 2E-K-R2 -- REAL PIXEL COMPARISON: how many recently-added
// images keep their decoded <img> element + transient Render Plan in
// memory (bounded, never persisted) so the before/after view can call
// the SAME production isolated pixel renderer the main app's own
// Visual Preview Comparison uses. Bounded exactly like every other
// Calibration Lab limit (MAX_STORED_SESSIONS, MAX_IMAGES_PER_SESSION)
// -- never unlimited. Images beyond this bound, or images belonging to
// a session RESTORED from storage (a fresh page load never re-decodes
// the original photo), honestly report PIXEL_PREVIEW_UNAVAILABLE_NOT_IN_SESSION
// rather than pretending a live preview exists.
export const MAX_LIVE_PIXEL_PREVIEW_CACHE_SIZE = 5;
export const PIXEL_PREVIEW_UNAVAILABLE_NOT_IN_SESSION = 'PIXEL_PREVIEW_UNAVAILABLE_NOT_IN_SESSION';

export function createCalibrationLabController({ locale = 'th', appVersion = APP_VERSION_FALLBACK } = {}) {
  let storage = null;
  let persistenceMode = 'UNAVAILABLE';
  let calibrationMode = 'CLOSED';
  let sessionState = 'NO_SESSION';
  let session = null;
  let records = [];
  let currentIndex = -1;
  let lastActionError = null;
  let currentLocale = locale === 'en' ? 'en' : 'th';

  // Keyed by imageId -> { imgElement, objectUrl, renderPlan, analysisGenerationId }.
  // The bounded-LRU mechanics themselves (recency, capacity eviction)
  // are fully delegated to the pure, Node-testable
  // createBoundedLruCache() -- this controller only supplies the
  // eviction side-effect (revoking `objectUrl`, when present). NEVER
  // exposed via getState()/getQaSnapshot() -- read only through
  // getPixelPreviewInput() below.
  function _revokeCacheEntry(entry) {
    if (entry?.objectUrl) { try { URL.revokeObjectURL(entry.objectUrl); } catch { /* ignore */ } }
  }
  const pixelPreviewCache = createBoundedLruCache(MAX_LIVE_PIXEL_PREVIEW_CACHE_SIZE, { onEvict: _revokeCacheEntry });

  function _cachePixelPreviewInput(imageId, entry) {
    pixelPreviewCache.set(imageId, entry);
  }

  /** Real pixel preview input for `imageId`, or an honest unavailable reason. Never throws. Marks the entry as most-recently-used on hit (LRU, via the pure cache's own get()). */
  function getPixelPreviewInput(imageId) {
    if (!imageId || !pixelPreviewCache.has(imageId)) {
      return { available: false, reasonCode: PIXEL_PREVIEW_UNAVAILABLE_NOT_IN_SESSION };
    }
    const entry = pixelPreviewCache.get(imageId);
    return {
      available: true,
      imgElement: entry.imgElement,
      renderPlan: entry.renderPlan,
      analysisGenerationId: entry.analysisGenerationId,
    };
  }

  function _clearPixelPreviewCache() {
    pixelPreviewCache.clear();
  }

  const listeners = new Set();
  function _notify() { for (const fn of listeners) { try { fn(getState()); } catch { /* a listener failure must never break the controller */ } } }

  function getState() {
    return {
      calibrationMode, sessionState, persistenceMode,
      session: session ? { ...session } : null,
      records: records.map(r => ({ ...r })),
      currentIndex,
      currentRecord: currentIndex >= 0 && currentIndex < records.length ? { ...records[currentIndex] } : null,
      lastActionError,
      locale: currentLocale,
    };
  }

  function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

  function setLocale(lang) { currentLocale = lang === 'en' ? 'en' : 'th'; _notify(); }

  async function init() {
    storage = await createCalibrationLabStorage();
    persistenceMode = storage.persistenceMode;
    _notify();
    return getState();
  }

  async function startNewSession() {
    lastActionError = null;
    _clearPixelPreviewCache(); // a new session starts with zero live images
    try {
      const newSession = createCalibrationSession({ locale: currentLocale, appVersion });
      await storage.saveSession(newSession);
      session = newSession;
      records = [];
      currentIndex = -1;
      sessionState = 'ACTIVE';
      calibrationMode = 'REVIEW';
    } catch (e) {
      lastActionError = e?.code ?? 'SAVE_FAILED';
    }
    _notify();
    return getState();
  }

  async function listAvailableSessions() {
    return storage.listSessions();
  }

  async function openSession(sessionId) {
    lastActionError = null;
    // Opening ANY session (even the one that was just active) never
    // has live decoded images available -- a resumed session's records
    // came back from storage, never from a freshly-decoded <img> in
    // this runtime. Real pixel preview is honestly unavailable until
    // the user re-adds an image in the current runtime.
    _clearPixelPreviewCache();
    try {
      const all = await storage.listSessions();
      const found = all.find(s => s.sessionId === sessionId);
      if (!found) { lastActionError = 'SESSION_NOT_FOUND'; _notify(); return getState(); }
      session = found;
      records = await storage.loadImageRecordsForSession(sessionId);
      currentIndex = records.length > 0 ? 0 : -1;
      sessionState = 'ACTIVE';
      calibrationMode = 'REVIEW';
      // EPIC 2E-K-R2-FIX1 -- Section 5: loading records can silently
      // migrate one or more of them (V1 -> V2 -- see
      // calibration-lab-storage.js), which changes which decisions are
      // allowed to count toward legacyWins/v2Wins/ties/bothRejected
      // (Section 4's honesty rule excludes `legacyDecisionPreservedForAudit`
      // records). The session's own rollup counters must be
      // recomputed and re-persisted immediately after every load --
      // never left stale from before a migration ran.
      session = recomputeSessionCounts(session, records);
      await storage.saveSession(session);
    } catch {
      lastActionError = 'OPEN_FAILED';
    }
    _notify();
    return getState();
  }

  /**
   * Adds one already-decoded `<img>` element to the current session:
   * runs the read-only comparison pipeline, builds a bounded Semantic
   * Image Test Record, and persists it. `imageCategories`/
   * `lightingCondition` are the user's own classification for this
   * image, supplied by the caller (the renderer's "add image" form).
   * The `imgElement`/original file are never retained past this call.
   */
  async function addImage(imgElement, { imageCategories, lightingCondition, objectUrl = null } = {}) {
    lastActionError = null;
    if (!session || sessionState !== 'ACTIVE') { lastActionError = 'NO_ACTIVE_SESSION'; _notify(); return getState(); }
    if (!isValidCategoryList(imageCategories)) { lastActionError = 'INVALID_CATEGORY_LIST'; _notify(); return getState(); }
    if (!isValidLightingCondition(lightingCondition)) { lastActionError = 'INVALID_LIGHTING_CONDITION'; _notify(); return getState(); }
    try {
      const pipelineResult = await runCalibrationComparisonPipeline(imgElement, { analysisGenerationId: `${session.sessionId}-${records.length + 1}` });
      // EPIC 2E-K-R2-FIX1 -- Section 1/2: capture REAL pixel-truth
      // evidence for THIS image right now, at ingestion time -- never
      // deferred until the user happens to open the comparison slider.
      // Uses two temporary, never-displayed canvases (see
      // pixel-truth-capture.js) so every record's previewEvidence is
      // populated before it is ever persisted, and Readiness/Dashboard
      // gating (Section 3/4) never has to guess about an image the
      // user has not yet looked at.
      let previewEvidence;
      try {
        previewEvidence = await capturePixelTruthEvidence({
          imgElement,
          renderPlan: pipelineResult.renderPlanForPixelPreviewTransientOnly,
          // EPIC 2E-K-R2-FIX2 -- Section 5: the Calibration V2 Preview
          // Plan's own contract (mode/available/renderable), so
          // pixel-truth-capture.js can populate previewEvidence's real
          // calibrationV2Plan* fields honestly, never inferred.
          calibrationV2PreviewPlan: pipelineResult.calibrationV2PreviewPlanTransientOnly,
          analysisGenerationId: pipelineResult.analysisGenerationId,
          expectedImageFingerprint: pipelineResult.imageFingerprint,
        });
      } catch {
        // A capture failure is never silently treated as success --
        // fail closed to the honest "not rendered" evidence shape.
        previewEvidence = createNotRenderedPreviewEvidence();
      }
      const record = createImageTestRecord({
        imageFingerprint: pipelineResult.imageFingerprint,
        imageCategories, lightingCondition,
        containsSkin: pipelineResult.containsSkin,
        analysisGenerationId: pipelineResult.analysisGenerationId,
        legacySnapshot: pipelineResult.legacySnapshot,
        controlledV2Snapshot: pipelineResult.controlledV2Snapshot,
        safetySnapshot: pipelineResult.safetySnapshot,
        previewEvidence,
      });
      await storage.saveImageRecord(session.sessionId, record);
      records = [...records, record];
      currentIndex = records.length - 1;
      session = recomputeSessionCounts(session, records);
      await storage.saveSession(session);
      // EPIC 2E-K-R2 -- cache the decoded element + transient Render
      // Plan for REAL pixel preview, keyed by the record's own imageId
      // (never the persisted record itself -- schema.js has no field
      // for either of these, so there is no path by which this cache
      // could leak into storage or export). Ownership of `objectUrl`'s
      // lifecycle moves here from the caller once this call succeeds.
      _cachePixelPreviewInput(record.imageId, {
        imgElement, objectUrl,
        renderPlan: pipelineResult.renderPlanForPixelPreviewTransientOnly,
        analysisGenerationId: pipelineResult.analysisGenerationId,
      });
    } catch (e) {
      lastActionError = e?.code ?? 'ADD_IMAGE_FAILED';
    }
    _notify();
    return getState();
  }

  function goToPrevious() {
    if (currentIndex > 0) currentIndex -= 1;
    _notify();
    return getState();
  }
  function goToNext() {
    if (currentIndex < records.length - 1) currentIndex += 1;
    _notify();
    return getState();
  }

  async function saveCurrentDecision({ userDecision, issueCodes = [], notes = '' }) {
    lastActionError = null;
    if (currentIndex < 0 || !records[currentIndex]) { lastActionError = 'NO_CURRENT_IMAGE'; _notify(); return getState(); }
    if (!isValidUserDecision(userDecision)) { lastActionError = 'INVALID_DECISION'; _notify(); return getState(); }
    if (!isValidIssueCodeList(issueCodes)) { lastActionError = 'INVALID_ISSUE_CODES'; _notify(); return getState(); }
    // EPIC 2E-K-R2-FIX2 -- Section 6: NOT_REVIEWED is a valid record
    // state (initial, Clear Current Answer, Migration, Reset) but is
    // NEVER a valid *Save Result* action -- a caller must actually pick
    // a decision to persist one. Rejecting here, before the Evidence
    // Eligibility Gate below, guarantees this holds even when Evidence
    // IS eligible (previously, isDecisionAllowedForEvidence('NOT_REVIEWED', ...)
    // unconditionally returned true, so Save silently persisted
    // NOT_REVIEWED + created a bogus reviewedAt timestamp -- reported
    // bugs #3 and #4). This check intentionally does not touch
    // clearCurrentAnswer(), which sets NOT_REVIEWED directly and never
    // calls saveCurrentDecision().
    if (userDecision === 'NOT_REVIEWED') { lastActionError = 'DECISION_REQUIRED'; _notify(); return getState(); }
    // EPIC 2E-K-R2-FIX1 -- Section 3: the Decision Eligibility Gate is
    // checked HERE, in the Controller, using the exact same pure
    // isDecisionAllowedForEvidence() the renderer uses to grey out
    // buttons -- so a caller that bypasses the UI entirely (a test, a
    // future bug in the renderer, anything) can never save V2_BETTER/
    // LEGACY_BETTER/etc. against evidence that was not genuinely
    // proven. This is deliberately NOT trusted to the UI's `disabled`
    // attribute alone (per the spec's explicit requirement).
    const currentEvidence = records[currentIndex]?.previewEvidence ?? null;
    if (!isDecisionAllowedForEvidence(userDecision, currentEvidence)) {
      lastActionError = 'DECISION_NOT_ELIGIBLE';
      _notify();
      return getState();
    }
    const boundedNotes = typeof notes === 'string' ? notes.slice(0, MAX_NOTES_LENGTH) : '';
    try {
      const updated = { ...records[currentIndex], userDecision, issueCodes: [...issueCodes], notes: boundedNotes, reviewedAt: new Date().toISOString() };
      await storage.saveImageRecord(session.sessionId, updated);
      records = records.map((r, i) => (i === currentIndex ? updated : r));
      session = recomputeSessionCounts(session, records);
      await storage.saveSession(session);
    } catch (e) {
      lastActionError = e?.code ?? 'SAVE_DECISION_FAILED';
    }
    _notify();
    return getState();
  }

  /**
   * EPIC 2E-K-R2-FIX1 -- Section 7: clears the CURRENT image's answer
   * completely -- `userDecision` back to NOT_REVIEWED, `issueCodes`
   * emptied, `notes` genuinely emptied (the R2 implementation
   * incorrectly re-supplied the OLD notes value here, which is exactly
   * the "Clear Current Answer does not clear Notes" bug reported).
   * `reviewedAt` is reset to null directly (never left at its previous
   * timestamp) since NOT_REVIEWED is always gate-allowed and bypasses
   * saveCurrentDecision()'s own `reviewedAt = now` behavior.
   * Analysis/Legacy/Controlled-V2/Preview-Evidence snapshots are never
   * touched by this function -- only the human-authored review fields.
   */
  async function clearCurrentAnswer() {
    lastActionError = null;
    if (currentIndex < 0 || !records[currentIndex]) { lastActionError = 'NO_CURRENT_IMAGE'; _notify(); return getState(); }
    try {
      const updated = { ...records[currentIndex], userDecision: 'NOT_REVIEWED', issueCodes: [], notes: '', reviewedAt: null };
      await storage.saveImageRecord(session.sessionId, updated);
      records = records.map((r, i) => (i === currentIndex ? updated : r));
      session = recomputeSessionCounts(session, records);
      await storage.saveSession(session);
    } catch (e) {
      lastActionError = e?.code ?? 'CLEAR_ANSWER_FAILED';
    }
    _notify();
    return getState();
  }

  async function endSession() {
    sessionState = 'ENDED';
    calibrationMode = 'CLOSED';
    _clearPixelPreviewCache(); // no further edits to this session; release live images now
    _notify();
    return getState();
  }

  async function clearAllData() {
    lastActionError = null;
    _clearPixelPreviewCache();
    try {
      await storage.clearAll();
      session = null; records = []; currentIndex = -1; sessionState = 'NO_SESSION'; calibrationMode = 'CLOSED';
    } catch {
      lastActionError = 'CLEAR_ALL_FAILED';
    }
    _notify();
    return getState();
  }

  function getDashboard() { return computeCalibrationDashboard(records); }
  function getReadinessReport() { return computeReadinessReport(records); }

  function exportJson() { return buildExportJson(session, records); }
  function exportCsv() { return buildExportCsv(session, records); }

  function setMode(mode) { calibrationMode = mode; _notify(); return getState(); }

  async function getStorageUsageSummary() { return storage.getStorageUsageSummary(); }

  /**
   * Semantic QA Snapshot (R1 Section 14) -- Browser QA must read this
   * or `[data-*]` attributes the renderer sets from it, never visible
   * Thai/English text. `productionSource`/`productionWrite`/
   * `controlledV2Apply`/`previewExport` are HARD-CODED here to their
   * always-safe values -- this controller has no code path that could
   * ever change them, by construction (see the module doc above).
   */
  function getQaSnapshot() {
    const current = currentIndex >= 0 ? records[currentIndex] : null;
    const currentEvidence = current?.previewEvidence ?? null;
    return {
      calibrationMode, sessionState, persistenceMode,
      imageCount: records.length,
      reviewedCount: records.filter(r => r.userDecision !== 'NOT_REVIEWED').length,
      pendingCount: records.filter(r => r.userDecision === 'NOT_REVIEWED').length,
      currentImageId: current ? current.imageId : null,
      currentDecisionCode: current ? current.userDecision : null,
      selectedIssueCodes: current ? [...current.issueCodes] : [],
      readinessCode: getReadinessReport().readinessStatus,
      productionSource: 'legacy',
      productionWrite: false,
      controlledV2Apply: false,
      previewExport: false,
      // EPIC 2E-K-R2-FIX1 -- Section 3/6: the exact evidence fields the
      // Browser QA suite must read to prove the Decision Gate is
      // genuinely enforced -- never derived from visible text.
      currentPreviewTruthCode: currentEvidence?.previewTruthCode ?? null,
      currentBrowserVerified: currentEvidence?.browserVerified ?? false,
      currentVisualDecisionEligible: currentEvidence?.visualDecisionEligible ?? false,
      // EPIC 2E-K-R2-FIX2 -- Section 5: no hard-coded v2RenderPlanAvailable
      // override -- the real Calibration V2 Preview Plan fields already
      // live on currentEvidence itself (populated by pixel-truth-capture.js).
      currentPixelBlockerReasonCode: deriveUiBlockerReasonCode(currentEvidence),
      // EPIC 2E-K-R2-FIX2 -- Section 9/11: the Browser QA suite's strict
      // Real Pixel Comparison classifier (see
      // qa/helpers/real-pixel-comparison-decision.mjs) needs the FULL
      // previewEvidence object -- pixel counts, hashes, geometry-match
      // flags -- not just the three summary fields above. Exposed as a
      // single additive field (never replacing the individual
      // current*/* fields above, which existing tests already read).
      currentPreviewEvidence: currentEvidence ? { ...currentEvidence } : null,
      calibrationSchemaVersion: 2,
    };
  }

  return {
    init, getState, subscribe, setLocale, setMode,
    startNewSession, listAvailableSessions, openSession,
    addImage, goToPrevious, goToNext,
    saveCurrentDecision, clearCurrentAnswer, endSession, clearAllData,
    getDashboard, getReadinessReport, exportJson, exportCsv,
    getStorageUsageSummary, getQaSnapshot,
    // EPIC 2E-K-R2 -- REAL PIXEL COMPARISON
    getPixelPreviewInput, clearPixelPreviewCache: _clearPixelPreviewCache,
  };
}
