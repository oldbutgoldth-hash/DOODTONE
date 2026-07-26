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
      const record = createImageTestRecord({
        imageFingerprint: pipelineResult.imageFingerprint,
        imageCategories, lightingCondition,
        containsSkin: pipelineResult.containsSkin,
        analysisGenerationId: pipelineResult.analysisGenerationId,
        legacySnapshot: pipelineResult.legacySnapshot,
        controlledV2Snapshot: pipelineResult.controlledV2Snapshot,
        safetySnapshot: pipelineResult.safetySnapshot,
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

  async function clearCurrentAnswer() {
    return saveCurrentDecision({ userDecision: 'NOT_REVIEWED', issueCodes: [], notes: records[currentIndex]?.notes ?? '' });
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
    return {
      calibrationMode, sessionState, persistenceMode,
      imageCount: records.length,
      reviewedCount: records.filter(r => r.userDecision !== 'NOT_REVIEWED').length,
      pendingCount: records.filter(r => r.userDecision === 'NOT_REVIEWED').length,
      currentImageId: currentIndex >= 0 && records[currentIndex] ? records[currentIndex].imageId : null,
      currentDecisionCode: currentIndex >= 0 && records[currentIndex] ? records[currentIndex].userDecision : null,
      selectedIssueCodes: currentIndex >= 0 && records[currentIndex] ? [...records[currentIndex].issueCodes] : [],
      readinessCode: getReadinessReport().readinessStatus,
      productionSource: 'legacy',
      productionWrite: false,
      controlledV2Apply: false,
      previewExport: false,
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
