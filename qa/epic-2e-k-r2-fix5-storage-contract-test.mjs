#!/usr/bin/env node
/**
 * EPIC 2E-K-R2-FIX5 — Storage Contract + Migration Gate.
 *
 * This suite verifies the IndexedDB-backed LUMIXA storage logic against a
 * deterministic QA-only transaction harness. It does not claim native Browser
 * IndexedDB verification; that is reported separately and fail-closed.
 */
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCalibrationLabStorage } from '../ui/calibration-lab/calibration-lab-storage.js';
import {
  createCalibrationSession,
  createImageTestRecord,
  MAX_STORED_SESSIONS,
  MAX_IMAGES_PER_SESSION,
} from '../core/calibration-lab/schema.js';
import { createDeterministicIndexedDbEnvironment } from './helpers/deterministic-indexeddb.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const RESULT_PATH = path.join(__dirname, 'epic-2e-k-r2-fix5-storage-contract-results.json');
const env = createDeterministicIndexedDbEnvironment();
globalThis.indexedDB = env.indexedDB;
globalThis.IDBKeyRange = env.IDBKeyRange;
const databaseName = 'lumixa-calibration-lab';

let passCount = 0;
let failCount = 0;
const assertions = [];

function record(test, ok, evidence = {}) {
  const result = ok ? 'PASS' : 'FAIL';
  if (ok) passCount += 1; else failCount += 1;
  assertions.push({ test, result, evidence });
  console.log(`${ok ? '✓' : '✗'} [${result}] ${test} — ${JSON.stringify(evidence)}`);
}

function openRaw(version) {
  return new Promise((resolve, reject) => {
    const req = env.indexedDB.open(databaseName, version);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function waitTransaction(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'));
  });
}

async function writeRaw(storeName, value) {
  const db = await openRaw(2);
  const tx = db.transaction(storeName, 'readwrite');
  tx.objectStore(storeName).put(value);
  await waitTransaction(tx);
  db.close();
}

async function readRawAll(storeName) {
  const db = await openRaw(2);
  const tx = db.transaction(storeName, 'readonly');
  const req = tx.objectStore(storeName).getAll();
  const rows = await new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return rows;
}

async function sourceHash() {
  const files = [
    'ui/calibration-lab/calibration-lab-storage.js',
    'core/calibration-lab/schema.js',
    'core/calibration-lab/migrate-v1-to-v2.js',
    'qa/helpers/deterministic-indexeddb.mjs',
    'qa/epic-2e-k-r2-fix5-storage-contract-test.mjs',
  ];
  const hash = createHash('sha256');
  for (const rel of files) hash.update(rel).update(await fs.readFile(path.join(ROOT, rel)));
  return hash.digest('hex');
}

async function main() {
  const startedAt = new Date().toISOString();
  const runId = randomUUID();
  const storage = await createCalibrationLabStorage();

  record('QA harness selects the IndexedDB backend rather than memory fallback', storage.persistenceMode === 'INDEXEDDB', {
    persistenceMode: storage.persistenceMode,
    verificationMode: env.verificationMode,
  });

  const session = createCalibrationSession({ locale: 'th', appVersion: 'fix5-contract' });
  await storage.saveSession(session);
  record('Session save/list round-trip', (await storage.listSessions()).some(row => row.sessionId === session.sessionId));

  const image = createImageTestRecord({ imageCategories: ['WEDDING'], lightingCondition: 'DAYLIGHT' });
  await storage.saveImageRecord(session.sessionId, image);
  const loadedImages = await storage.loadImageRecordsForSession(session.sessionId);
  record('Image record save/load round-trip', loadedImages.length === 1 && loadedImages[0].imageId === image.imageId, {
    loaded: loadedImages.length,
  });

  let invalidSessionRejected = false;
  try { await storage.saveSession({ sessionId: 'bad', createdAt: 'bad' }); } catch { invalidSessionRejected = true; }
  record('Invalid session fails closed', invalidSessionRejected);

  let invalidImageRejected = false;
  try { await storage.saveImageRecord(session.sessionId, { imageId: 'bad', userDecision: 'INVALID' }); } catch { invalidImageRejected = true; }
  record('Invalid image record fails closed', invalidImageRejected);

  await writeRaw('sessions', { sessionId: 'raw-corrupt-session', calibrationSchemaVersion: 99, createdAt: 'garbage' });
  await writeRaw('images', { imageId: 'raw-corrupt-image', _sessionId: session.sessionId, userDecision: 'GARBAGE' });
  let listThrew = false;
  let loadThrew = false;
  let sessionsAfterCorruption = [];
  let imagesAfterCorruption = [];
  try { sessionsAfterCorruption = await storage.listSessions(); } catch { listThrew = true; }
  try { imagesAfterCorruption = await storage.loadImageRecordsForSession(session.sessionId); } catch { loadThrew = true; }
  record('Corrupt session row never crashes listSessions()', !listThrew);
  record('Corrupt session row is quarantined', !sessionsAfterCorruption.some(row => row.sessionId === 'raw-corrupt-session'));
  record('Corrupt image row never crashes loadImageRecordsForSession()', !loadThrew);
  record('Corrupt image row is quarantined', !imagesAfterCorruption.some(row => row.imageId === 'raw-corrupt-image'));

  const usageA = await storage.getStorageUsageSummary();
  const usageB = await storage.getStorageUsageSummary();
  record('Usage summary counts corrupt rows exactly once per scan', usageA.corruptRecordCount === 2, { usageA });
  record('Usage summary is idempotent', JSON.stringify(usageA) === JSON.stringify(usageB));

  const imageLimitSession = createCalibrationSession({ locale: 'en', appVersion: 'fix5-image-limit' });
  await storage.saveSession(imageLimitSession);
  for (let index = 0; index < MAX_IMAGES_PER_SESSION; index += 1) {
    await storage.saveImageRecord(imageLimitSession.sessionId, createImageTestRecord({
      imageCategories: ['OTHER'], lightingCondition: 'UNKNOWN',
    }));
  }
  let imageLimitCode = null;
  try {
    await storage.saveImageRecord(imageLimitSession.sessionId, createImageTestRecord({
      imageCategories: ['OTHER'], lightingCondition: 'UNKNOWN',
    }));
  } catch (error) { imageLimitCode = error?.code ?? null; }
  record('Image-per-session limit fails closed', imageLimitCode === 'IMAGE_LIMIT_REACHED', {
    imageLimitCode, max: MAX_IMAGES_PER_SESSION,
  });

  await storage.clearAll();
  let sessionLimitCode = null;
  for (let index = 0; index < MAX_STORED_SESSIONS; index += 1) {
    await storage.saveSession(createCalibrationSession({ locale: 'en', appVersion: 'fix5-session-limit' }));
  }
  try {
    await storage.saveSession(createCalibrationSession({ locale: 'en', appVersion: 'fix5-session-limit' }));
  } catch (error) { sessionLimitCode = error?.code ?? null; }
  record('Stored-session limit fails closed', sessionLimitCode === 'SESSION_LIMIT_REACHED', {
    sessionLimitCode, max: MAX_STORED_SESSIONS,
  });

  await storage.clearAll();
  const deleteSession = createCalibrationSession({ locale: 'th', appVersion: 'fix5-delete' });
  await storage.saveSession(deleteSession);
  await storage.saveImageRecord(deleteSession.sessionId, createImageTestRecord({ imageCategories: ['EVENT'], lightingCondition: 'LED' }));
  await storage.deleteSession(deleteSession.sessionId);
  record('deleteSession removes the selected session', !(await storage.listSessions()).some(row => row.sessionId === deleteSession.sessionId));
  record('deleteSession cascades to its image records', (await storage.loadImageRecordsForSession(deleteSession.sessionId)).length === 0);

  const clearA = createCalibrationSession({ locale: 'th', appVersion: 'fix5-clear' });
  const clearB = createCalibrationSession({ locale: 'en', appVersion: 'fix5-clear' });
  await storage.saveSession(clearA);
  await storage.saveSession(clearB);
  await storage.clearAll();
  const usageAfterClear = await storage.getStorageUsageSummary();
  record('clearAll removes all sessions and records', (await storage.listSessions()).length === 0 && usageAfterClear.imageRecordCount === 0, {
    usageAfterClear,
  });

  const v1Session = {
    sessionId: 'cal-session-fix5-v1', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    locale: 'th', appVersion: 'v1', calibrationSchemaVersion: 1,
    imageCount: 1, reviewedCount: 1, legacyWins: 0, v2Wins: 1, ties: 0,
    bothRejected: 0, pendingCount: 0,
  };
  const v1Record = {
    imageId: 'cal-image-fix5-v1', imageFingerprint: 'dhash-fix5', imageCategories: ['EVENT'],
    lightingCondition: 'MIXED', containsSkin: false, analysisGenerationId: 'gen-v1',
    legacySnapshot: null, controlledV2Snapshot: null, safetySnapshot: null,
    userDecision: 'V2_BETTER', issueCodes: [], notes: 'preserve this note',
    reviewedAt: '2025-01-01T00:00:00.000Z', _sessionId: 'cal-session-fix5-v1',
  };
  await writeRaw('sessions', v1Session);
  await writeRaw('images', v1Record);

  const migratedSession = (await storage.listSessions()).find(row => row.sessionId === v1Session.sessionId);
  const migratedRecords = await storage.loadImageRecordsForSession(v1Session.sessionId);
  const migrated = migratedRecords[0];
  record('V1 session migrates to schema v2', migratedSession?.calibrationSchemaVersion === 2, { migratedSession });
  record('V1 image gains NOT_RENDERED preview evidence', migrated?.previewEvidence?.previewTruthCode === 'NOT_RENDERED');
  record('V1 decision and notes are preserved for audit', migrated?.userDecision === 'V2_BETTER' && migrated?.notes === 'preserve this note');
  record('Migrated V1 decision requires visual re-review', migrated?.legacyDecisionPreservedForAudit === true && migrated?.requiresVisualReReview === true);

  const migratedAgain = (await storage.loadImageRecordsForSession(v1Session.sessionId))[0];
  record('Migration is idempotent', JSON.stringify(migrated) === JSON.stringify(migratedAgain));

  const backups = await readRawAll('imagesLegacyBackupV1');
  const matchingBackups = backups.filter(row => row.imageId === v1Record.imageId);
  record('Backup-before-migrate preserves the untouched V1 row', matchingBackups.length === 1 && matchingBackups[0].notes === 'preserve this note', {
    backupCount: matchingBackups.length,
  });

  const savedIndexedDB = globalThis.indexedDB;
  const savedIDBKeyRange = globalThis.IDBKeyRange;
  delete globalThis.indexedDB;
  delete globalThis.IDBKeyRange;
  const fallback = await createCalibrationLabStorage();
  globalThis.indexedDB = savedIndexedDB;
  globalThis.IDBKeyRange = savedIDBKeyRange;
  record('Unavailable IndexedDB selects explicit bounded memory fallback', fallback.persistenceMode === 'IN_MEMORY_FALLBACK', {
    persistenceMode: fallback.persistenceMode,
  });
  const fallbackSession = createCalibrationSession({ locale: 'th', appVersion: 'fix5-fallback' });
  await fallback.saveSession(fallbackSession);
  record('Memory fallback remains usable and explicit', (await fallback.listSessions()).length === 1);

  const result = {
    epic: '2E-K-R2-FIX5',
    suite: 'STORAGE_CONTRACT',
    verificationMode: env.verificationMode,
    nativeBrowserIndexedDbVerified: false,
    decision: failCount === 0 ? 'PASS' : 'FAIL',
    completed: true,
    runId,
    startedAt,
    completedAt: new Date().toISOString(),
    sourceHash: await sourceHash(),
    passCount,
    failCount,
    assertions,
  };
  await fs.writeFile(RESULT_PATH, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(`\n${passCount}/${passCount + failCount} PASS, ${failCount} FAIL`);
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch(async error => {
  console.error(error?.stack ?? error);
  try {
    await fs.writeFile(RESULT_PATH, `${JSON.stringify({
      epic: '2E-K-R2-FIX5', suite: 'STORAGE_CONTRACT', decision: 'FAIL', completed: true,
      completedAt: new Date().toISOString(), error: error?.stack ?? String(error),
    }, null, 2)}\n`, 'utf8');
  } catch {}
  process.exit(2);
});
