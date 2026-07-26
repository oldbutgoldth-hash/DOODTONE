/**
 * ui/calibration-lab/calibration-lab-storage.js
 *
 * EPIC 2E-K -- CONTROLLED V2 CALIBRATION LAB
 *
 * Local persistence for Calibration Sessions + Semantic Image Test
 * Records (R1 Section 9). IndexedDB-backed by default; falls back to a
 * bounded in-memory store (same limits, same API, explicit
 * `persistenceMode: 'IN_MEMORY_FALLBACK'`) when IndexedDB is
 * unavailable -- storage NEVER silently pretends to persist data it
 * cannot actually persist, and every caller can always read the
 * current `persistenceMode` to know which backend is active.
 *
 * This module never imports from `ui/app.js` and never touches
 * anything the main Production pipeline reads -- it is a fully
 * separate IndexedDB database (`lumixa-calibration-lab`), never the
 * same object store or key namespace Production code uses (Production
 * uses no IndexedDB at all).
 */

import {
  CALIBRATION_SCHEMA_VERSION, MAX_STORED_SESSIONS, MAX_IMAGES_PER_SESSION,
  validateSession, validateImageRecord,
} from '../../core/calibration-lab/schema.js';
import { PERSISTENCE_MODES } from '../../core/calibration-lab/codes.js';

const DB_NAME = 'lumixa-calibration-lab';
const DB_VERSION = 1;
const SESSIONS_STORE = 'sessions';
const IMAGES_STORE = 'images';
const IMAGES_BY_SESSION_INDEX = 'bySessionId';

// Schema-version migration guard. Currently only v1 exists, so this is
// an honest empty scaffold -- a session/record whose stored
// `calibrationSchemaVersion` is NEWER than `CALIBRATION_SCHEMA_VERSION`
// (this code is older than the data) or older but has no registered
// migration step is treated as corrupt and quarantined, never guessed
// at or silently coerced.
const SESSION_MIGRATIONS = Object.freeze({});

function _isIndexedDbAvailable() {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}

function _migrateRecordIfNeeded(raw, migrations) {
  if (!raw || typeof raw !== 'object' || typeof raw.calibrationSchemaVersion !== 'number') return null;
  let version = raw.calibrationSchemaVersion;
  let current = raw;
  if (version > CALIBRATION_SCHEMA_VERSION) return null; // data from a newer, unknown schema -- fail closed
  while (version < CALIBRATION_SCHEMA_VERSION) {
    const step = migrations[version];
    if (typeof step !== 'function') return null; // no migration path -- fail closed, quarantine
    current = step(current);
    version += 1;
  }
  return current;
}

function _openIndexedDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(SESSIONS_STORE)) {
        db.createObjectStore(SESSIONS_STORE, { keyPath: 'sessionId' });
      }
      if (!db.objectStoreNames.contains(IMAGES_STORE)) {
        const imagesStore = db.createObjectStore(IMAGES_STORE, { keyPath: 'imageId' });
        imagesStore.createIndex(IMAGES_BY_SESSION_INDEX, '_sessionId', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
}

function _promisifyRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

/**
 * IndexedDB-backed implementation. Every method fails closed: a
 * transaction error rejects rather than returning a fabricated empty
 * success, and any record that fails `validateSession`/
 * `validateImageRecord` (or has no valid migration path) is silently
 * excluded from reads and counted in `diagnostics.corruptRecordCount`
 * -- it is never handed to the controller, and never crashes the read.
 */
function _createIndexedDbBackend(db) {
  // `corruptRecordCount` is always computed FRESH from a single scan
  // (see `_scanSessions` / `getStorageUsageSummary` below) -- never a
  // shared accumulator that would otherwise grow every time an
  // unrelated read happens to pass over the same still-corrupt row.

  async function _scanSessions() {
    const tx = db.transaction(SESSIONS_STORE, 'readonly');
    const all = await _promisifyRequest(tx.objectStore(SESSIONS_STORE).getAll());
    const valid = [];
    let corruptCount = 0;
    for (const raw of all) {
      const migrated = _migrateRecordIfNeeded(raw, SESSION_MIGRATIONS);
      if (migrated && validateSession(migrated)) valid.push(migrated);
      else corruptCount += 1;
    }
    return { valid, corruptCount };
  }

  async function listSessions() {
    const { valid } = await _scanSessions();
    return valid.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }

  async function saveSession(session) {
    if (!validateSession(session)) throw new Error('calibration-lab-storage: refused to save a structurally invalid session');
    const existing = await listSessions();
    const alreadyStored = existing.some(s => s.sessionId === session.sessionId);
    if (!alreadyStored && existing.length >= MAX_STORED_SESSIONS) {
      const err = new Error('calibration-lab-storage: session limit reached');
      err.code = 'SESSION_LIMIT_REACHED';
      throw err;
    }
    const tx = db.transaction(SESSIONS_STORE, 'readwrite');
    tx.objectStore(SESSIONS_STORE).put(session);
    await _promisifyRequest(tx.objectStore(SESSIONS_STORE).get(session.sessionId));
    return session;
  }

  async function deleteSession(sessionId) {
    const tx = db.transaction([SESSIONS_STORE, IMAGES_STORE], 'readwrite');
    tx.objectStore(SESSIONS_STORE).delete(sessionId);
    const idx = tx.objectStore(IMAGES_STORE).index(IMAGES_BY_SESSION_INDEX);
    const keysReq = idx.getAllKeys(IDBKeyRange.only(sessionId));
    const keys = await _promisifyRequest(keysReq);
    for (const key of keys) tx.objectStore(IMAGES_STORE).delete(key);
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
  }

  async function clearAll() {
    const tx = db.transaction([SESSIONS_STORE, IMAGES_STORE], 'readwrite');
    tx.objectStore(SESSIONS_STORE).clear();
    tx.objectStore(IMAGES_STORE).clear();
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
  }

  async function saveImageRecord(sessionId, record) {
    if (!validateImageRecord(record)) throw new Error('calibration-lab-storage: refused to save a structurally invalid image record');
    const existingCount = (await loadImageRecordsForSession(sessionId)).length;
    const tx0 = db.transaction(IMAGES_STORE, 'readonly');
    const existingRaw = await _promisifyRequest(tx0.objectStore(IMAGES_STORE).get(record.imageId));
    if (!existingRaw && existingCount >= MAX_IMAGES_PER_SESSION) {
      const err = new Error('calibration-lab-storage: image-per-session limit reached');
      err.code = 'IMAGE_LIMIT_REACHED';
      throw err;
    }
    const tx = db.transaction(IMAGES_STORE, 'readwrite');
    tx.objectStore(IMAGES_STORE).put({ ...record, _sessionId: sessionId });
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
    return record;
  }

  async function _scanImageRecords(sessionId) {
    const tx = db.transaction(IMAGES_STORE, 'readonly');
    const idx = tx.objectStore(IMAGES_STORE).index(IMAGES_BY_SESSION_INDEX);
    const all = await _promisifyRequest(idx.getAll(IDBKeyRange.only(sessionId)));
    const valid = [];
    let corruptCount = 0;
    for (const raw of all) {
      const { _sessionId, ...rest } = raw;
      if (validateImageRecord(rest)) valid.push(rest);
      else corruptCount += 1;
    }
    return { valid, corruptCount };
  }

  async function loadImageRecordsForSession(sessionId) {
    const { valid } = await _scanImageRecords(sessionId);
    return valid;
  }

  async function _scanAllImageRecordsAcrossAllSessions() {
    const tx = db.transaction(IMAGES_STORE, 'readonly');
    const all = await _promisifyRequest(tx.objectStore(IMAGES_STORE).getAll());
    let validCount = 0, corruptCount = 0, approxBytes = 0;
    for (const raw of all) {
      const { _sessionId, ...rest } = raw;
      if (validateImageRecord(rest)) { validCount += 1; approxBytes += JSON.stringify(rest).length; }
      else corruptCount += 1;
    }
    return { validCount, corruptCount, approxBytes };
  }

  async function getStorageUsageSummary() {
    const sessionScan = await _scanSessions();
    const imageScan = await _scanAllImageRecordsAcrossAllSessions();
    const approxBytes = imageScan.approxBytes + sessionScan.valid.reduce((sum, s) => sum + JSON.stringify(s).length, 0);
    let quotaEstimate = null;
    try {
      if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
        const est = await navigator.storage.estimate();
        quotaEstimate = { usage: est.usage ?? null, quota: est.quota ?? null };
      }
    } catch { quotaEstimate = null; }
    return {
      sessionCount: sessionScan.valid.length,
      imageRecordCount: imageScan.validCount,
      approxBytes,
      corruptRecordCount: sessionScan.corruptCount + imageScan.corruptCount,
      quotaEstimate,
    };
  }

  return { persistenceMode: 'INDEXEDDB', listSessions, saveSession, deleteSession, clearAll, saveImageRecord, loadImageRecordsForSession, getStorageUsageSummary };
}

/**
 * Bounded in-memory fallback -- used only when IndexedDB itself is
 * unavailable in this browser/context. Same external API, same
 * MAX_STORED_SESSIONS/MAX_IMAGES_PER_SESSION limits, but nothing here
 * survives a page reload -- `persistenceMode: 'IN_MEMORY_FALLBACK'` is
 * always reported explicitly so the UI can warn the user rather than
 * implying real persistence.
 */
function _createInMemoryBackend() {
  const sessions = new Map();
  const imagesBySession = new Map();

  async function listSessions() {
    return [...sessions.values()].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }
  async function saveSession(session) {
    if (!validateSession(session)) throw new Error('calibration-lab-storage: refused to save a structurally invalid session');
    if (!sessions.has(session.sessionId) && sessions.size >= MAX_STORED_SESSIONS) {
      const err = new Error('calibration-lab-storage: session limit reached');
      err.code = 'SESSION_LIMIT_REACHED';
      throw err;
    }
    sessions.set(session.sessionId, { ...session });
    if (!imagesBySession.has(session.sessionId)) imagesBySession.set(session.sessionId, new Map());
    return session;
  }
  async function deleteSession(sessionId) {
    sessions.delete(sessionId);
    imagesBySession.delete(sessionId);
  }
  async function clearAll() {
    sessions.clear();
    imagesBySession.clear();
  }
  async function saveImageRecord(sessionId, record) {
    if (!validateImageRecord(record)) throw new Error('calibration-lab-storage: refused to save a structurally invalid image record');
    if (!imagesBySession.has(sessionId)) imagesBySession.set(sessionId, new Map());
    const bucket = imagesBySession.get(sessionId);
    if (!bucket.has(record.imageId) && bucket.size >= MAX_IMAGES_PER_SESSION) {
      const err = new Error('calibration-lab-storage: image-per-session limit reached');
      err.code = 'IMAGE_LIMIT_REACHED';
      throw err;
    }
    bucket.set(record.imageId, { ...record });
    return record;
  }
  async function loadImageRecordsForSession(sessionId) {
    const bucket = imagesBySession.get(sessionId);
    return bucket ? [...bucket.values()] : [];
  }
  async function getStorageUsageSummary() {
    let imageRecordCount = 0, approxBytes = 0;
    for (const bucket of imagesBySession.values()) {
      imageRecordCount += bucket.size;
      for (const r of bucket.values()) approxBytes += JSON.stringify(r).length;
    }
    for (const s of sessions.values()) approxBytes += JSON.stringify(s).length;
    return { sessionCount: sessions.size, imageRecordCount, approxBytes, corruptRecordCount: 0, quotaEstimate: null };
  }

  return { persistenceMode: 'IN_MEMORY_FALLBACK', listSessions, saveSession, deleteSession, clearAll, saveImageRecord, loadImageRecordsForSession, getStorageUsageSummary };
}

/**
 * Creates the storage backend, feature-detecting IndexedDB availability
 * once. Never throws -- if `indexedDB.open()` itself rejects (e.g. a
 * browser that reports the API as present but blocks it, such as some
 * private-browsing modes), this still degrades to the bounded
 * in-memory fallback rather than leaving the Calibration Lab
 * unusable.
 */
export async function createCalibrationLabStorage() {
  if (_isIndexedDbAvailable()) {
    try {
      const db = await _openIndexedDb();
      return _createIndexedDbBackend(db);
    } catch {
      return _createInMemoryBackend();
    }
  }
  return _createInMemoryBackend();
}

export { PERSISTENCE_MODES };
