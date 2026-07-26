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
import {
  createCalibrationSession, createImageTestRecord, recomputeSessionCounts, MAX_NOTES_LENGTH,
} from '../../core/calibration-lab/schema.js';
import { isValidCategoryList, isValidLightingCondition, isValidUserDecision, isValidIssueCodeList } from '../../core/calibration-lab/codes.js';
import { computeCalibrationDashboard } from '../../core/calibration-lab/aggregate.js';
import { computeReadinessReport } from '../../core/calibration-lab/readiness.js';
import { buildExportJson, buildExportCsv } from '../../core/calibration-lab/export-dataset.js';

const APP_VERSION_FALLBACK = 'unknown';

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
  async function addImage(imgElement, { imageCategories, lightingCondition }) {
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
    _notify();
    return getState();
  }

  async function clearAllData() {
    lastActionError = null;
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
  };
}
