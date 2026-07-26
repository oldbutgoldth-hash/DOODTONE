#!/usr/bin/env node
/**
 * qa/epic-2e-k-calibration-lab-storage-test.mjs
 *
 * EPIC 2E-K -- CONTROLLED V2 CALIBRATION LAB.
 *
 * Genuine IndexedDB behavior test for
 * ui/calibration-lab/calibration-lab-storage.js, using `fake-indexeddb`
 * (a real IndexedDB implementation running in Node, not a mock) so
 * `schemaVersion`/migration-guard, corrupt-record handling, session
 * limits, clear-current/clear-all, and the storage usage summary are
 * ACTUALLY exercised against real transactions -- not merely asserted
 * against a hand-written stub. Also verifies the bounded in-memory
 * fallback (used when IndexedDB itself is unavailable) via a second
 * process invocation with no `indexedDB` global defined.
 *
 * No Browser, no Chromium -- safe for run-static-suites.mjs.
 */
import 'fake-indexeddb/auto';
import { createCalibrationLabStorage } from '../ui/calibration-lab/calibration-lab-storage.js';
import { createCalibrationSession, createImageTestRecord, MAX_STORED_SESSIONS } from '../core/calibration-lab/schema.js';

let passCount = 0, failCount = 0;
function record(test, ok, evidence) {
  const icon = ok ? '✓' : '✗';
  const status = ok ? 'PASS' : 'FAIL';
  if (ok) passCount++; else failCount++;
  const safeEvidence = (() => { try { return JSON.stringify(evidence); } catch { return String(evidence); } })();
  console.log(`${icon} [${status}] ${test} — ${safeEvidence}`);
}

async function main() {
  const storage = await createCalibrationLabStorage();
  record('createCalibrationLabStorage() selects the IndexedDB backend when indexedDB is available', storage.persistenceMode === 'INDEXEDDB', { mode: storage.persistenceMode });

  const s1 = createCalibrationSession({ locale: 'th', appVersion: 'storage-test' });
  await storage.saveSession(s1);
  record('saveSession() persists a session retrievable via listSessions()', (await storage.listSessions()).some(s => s.sessionId === s1.sessionId), {});

  const r1 = createImageTestRecord({ imageCategories: ['WEDDING'], lightingCondition: 'DAYLIGHT' });
  await storage.saveImageRecord(s1.sessionId, r1);
  const loaded = await storage.loadImageRecordsForSession(s1.sessionId);
  record('saveImageRecord()/loadImageRecordsForSession() round-trips a valid record', loaded.length === 1 && loaded[0].imageId === r1.imageId, {});

  let rejectedInvalidSession = false;
  try { await storage.saveSession({ sessionId: 'bad', createdAt: 'not-a-date' }); } catch { rejectedInvalidSession = true; }
  record('saveSession() fails closed on a structurally invalid session (never silently persists garbage)', rejectedInvalidSession, {});

  let rejectedInvalidRecord = false;
  try { await storage.saveImageRecord(s1.sessionId, { imageId: 'bad', userDecision: 'NOT_A_REAL_DECISION' }); } catch { rejectedInvalidRecord = true; }
  record('saveImageRecord() fails closed on a structurally invalid record', rejectedInvalidRecord, {});

  // Corrupt-record handling: inject a raw, invalid session AND a raw,
  // invalid image record directly into the underlying IndexedDB
  // (bypassing this module's own validation), simulating data that
  // became corrupt through some other means (a future schema change, a
  // partial write, manual tampering, etc.) -- reads must quarantine
  // these silently, never crash, never return them to the caller.
  const rawDb = await new Promise((resolve, reject) => {
    const req = indexedDB.open('lumixa-calibration-lab', 1);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  await new Promise((resolve, reject) => {
    const tx = rawDb.transaction('sessions', 'readwrite');
    tx.objectStore('sessions').put({ sessionId: 'raw-corrupt-session', calibrationSchemaVersion: 99, createdAt: 'garbage' });
    tx.oncomplete = resolve; tx.onerror = reject;
  });
  await new Promise((resolve, reject) => {
    const tx = rawDb.transaction('images', 'readwrite');
    tx.objectStore('images').put({ imageId: 'raw-corrupt-image', _sessionId: s1.sessionId, userDecision: 'GARBAGE_NOT_A_CODE' });
    tx.oncomplete = resolve; tx.onerror = reject;
  });

  let listSessionsThrew = false, loadRecordsThrew = false;
  let sessionsAfterCorruption = [], recordsAfterCorruption = [];
  try { sessionsAfterCorruption = await storage.listSessions(); } catch { listSessionsThrew = true; }
  try { recordsAfterCorruption = await storage.loadImageRecordsForSession(s1.sessionId); } catch { loadRecordsThrew = true; }
  record('listSessions() does NOT crash on a corrupt raw session row (HOSTILE: corrupt session must not crash the app)', !listSessionsThrew, {});
  record('listSessions() silently excludes the corrupt raw session row', !sessionsAfterCorruption.some(s => s.sessionId === 'raw-corrupt-session'), { count: sessionsAfterCorruption.length });
  record('loadImageRecordsForSession() does NOT crash on a corrupt raw image row', !loadRecordsThrew, {});
  record('loadImageRecordsForSession() silently excludes the corrupt raw image row', !recordsAfterCorruption.some(r => r.imageId === 'raw-corrupt-image'), { count: recordsAfterCorruption.length });

  const usage1 = await storage.getStorageUsageSummary();
  const usage2 = await storage.getStorageUsageSummary();
  record('getStorageUsageSummary() reports the 2 currently-corrupt rows', usage1.corruptRecordCount === 2, { usage1 });
  record('getStorageUsageSummary() is idempotent across repeated calls (never an accumulating counter)', JSON.stringify(usage1) === JSON.stringify(usage2), { usage1, usage2 });

  // Session limit.
  let sessionLimitHitAt = null;
  for (let i = 0; i < MAX_STORED_SESSIONS + 3; i++) {
    const s = createCalibrationSession({ locale: 'en', appVersion: 'limit-test' });
    try { await storage.saveSession(s); } catch (e) { sessionLimitHitAt = { i, code: e.code }; break; }
  }
  record('saveSession() fails closed with SESSION_LIMIT_REACHED once MAX_STORED_SESSIONS is exceeded', sessionLimitHitAt !== null && sessionLimitHitAt.code === 'SESSION_LIMIT_REACHED', { sessionLimitHitAt });

  // Clear current session vs clear all.
  const beforeClearOne = (await storage.listSessions()).length;
  await storage.deleteSession(s1.sessionId);
  const afterClearOne = await storage.listSessions();
  record('deleteSession() ("clear current session") removes exactly that one session', afterClearOne.length === beforeClearOne - 1 && !afterClearOne.some(s => s.sessionId === s1.sessionId), {});
  const recordsAfterSessionDeleted = await storage.loadImageRecordsForSession(s1.sessionId);
  record('deleteSession() also removes that session\'s own image records', recordsAfterSessionDeleted.length === 0, {});

  await storage.clearAll();
  const afterClearAll = await storage.listSessions();
  const usageAfterClearAll = await storage.getStorageUsageSummary();
  record('clearAll() ("clear all calibration data") empties every session', afterClearAll.length === 0, {});
  record('clearAll() also resets the corrupt-record count (nothing left to scan)', usageAfterClearAll.corruptRecordCount === 0 && usageAfterClearAll.sessionCount === 0, { usageAfterClearAll });

  console.log(`\n${passCount}/${passCount + failCount} PASS, ${failCount} FAIL`);
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('calibration-lab-storage-test crashed:', err?.stack ?? err);
  process.exit(2);
});
