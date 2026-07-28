/** EPIC 2E-N5 — Local evaluation record store (image-free). */
const DB_NAME = 'lumixa-color-match-evaluation';
const DB_VERSION = 1;
const STORE = 'records';

function memoryStore() {
  const records = new Map();
  return {
    mode: 'IN_MEMORY_FALLBACK',
    async save(record) { const id = record.recordId || `match-${Date.now()}-${Math.random().toString(16).slice(2)}`; records.set(id, { ...record, recordId: id }); return records.get(id); },
    async list() { return [...records.values()].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))); },
    async clear() { records.clear(); },
  };
}

function openDatabase(factory) {
  return new Promise((resolve, reject) => {
    const request = factory.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'recordId' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB open failed'));
  });
}
function txRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
  });
}

export async function createColorMatchEvaluationStore({ indexedDBFactory = globalThis.indexedDB } = {}) {
  if (!indexedDBFactory?.open) return memoryStore();
  try {
    const db = await openDatabase(indexedDBFactory);
    return {
      mode: 'INDEXEDDB',
      async save(record) {
        const clean = JSON.parse(JSON.stringify(record));
        const recordId = clean.recordId || `match-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        clean.recordId = recordId;
        const tx = db.transaction(STORE, 'readwrite');
        await txRequest(tx.objectStore(STORE).put(clean));
        return clean;
      },
      async list() {
        const tx = db.transaction(STORE, 'readonly');
        const values = await txRequest(tx.objectStore(STORE).getAll());
        return values.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      },
      async clear() {
        const tx = db.transaction(STORE, 'readwrite');
        await txRequest(tx.objectStore(STORE).clear());
      },
    };
  } catch {
    return memoryStore();
  }
}
