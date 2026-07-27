/**
 * Deterministic IndexedDB contract harness for QA only.
 *
 * This is intentionally small and implements only the IndexedDB surface
 * exercised by LUMIXA's Calibration Lab storage module. It is NOT shipped
 * to the application and it is NOT represented as native Browser IndexedDB.
 * Its purpose is to verify transaction/object-store/index behavior when the
 * npm registry is unavailable and `fake-indexeddb` cannot be installed.
 */

function clone(value) {
  return value == null ? value : structuredClone(value);
}

class NameList {
  constructor(getNames) { this._getNames = getNames; }
  contains(name) { return this._getNames().includes(name); }
  item(index) { return this._getNames()[index] ?? null; }
  get length() { return this._getNames().length; }
  [Symbol.iterator]() { return this._getNames()[Symbol.iterator](); }
}

class Request {
  constructor(executor, transaction = null) {
    this.result = undefined;
    this.error = null;
    this.onsuccess = null;
    this.onerror = null;
    if (transaction) transaction._startRequest();
    queueMicrotask(() => {
      try {
        this.result = executor();
        queueMicrotask(() => this.onsuccess?.({ target: this }));
      } catch (error) {
        this.error = error;
        queueMicrotask(() => this.onerror?.({ target: this }));
        transaction?._fail(error);
      } finally {
        transaction?._finishRequest();
      }
    });
  }
}

class Index {
  constructor(transaction, storeMeta, indexMeta) {
    this._tx = transaction;
    this._store = storeMeta;
    this._index = indexMeta;
  }
  getAll(range) {
    return new Request(() => {
      const expected = range?.value;
      return [...this._store.rows.values()]
        .filter(row => row?.[this._index.keyPath] === expected)
        .map(clone);
    }, this._tx);
  }
  getAllKeys(range) {
    return new Request(() => {
      const expected = range?.value;
      const out = [];
      for (const [primaryKey, row] of this._store.rows.entries()) {
        if (row?.[this._index.keyPath] === expected) out.push(primaryKey);
      }
      return out;
    }, this._tx);
  }
}

class ObjectStore {
  constructor(transaction, meta) {
    this._tx = transaction;
    this._meta = meta;
  }
  createIndex(name, keyPath, options = {}) {
    if (this._meta.indexes.has(name)) throw new Error(`ConstraintError: index ${name} already exists`);
    this._meta.indexes.set(name, { name, keyPath, unique: Boolean(options.unique) });
    return new Index(this._tx, this._meta, this._meta.indexes.get(name));
  }
  index(name) {
    const meta = this._meta.indexes.get(name);
    if (!meta) throw new Error(`NotFoundError: index ${name}`);
    return new Index(this._tx, this._meta, meta);
  }
  put(value) {
    return new Request(() => {
      if (this._tx.mode !== 'readwrite' && !this._tx._upgrade) throw new Error('ReadOnlyError');
      const key = value?.[this._meta.keyPath];
      if (key == null) throw new Error(`DataError: missing keyPath ${this._meta.keyPath}`);
      this._meta.rows.set(key, clone(value));
      return key;
    }, this._tx);
  }
  get(key) { return new Request(() => clone(this._meta.rows.get(key)), this._tx); }
  getAll() { return new Request(() => [...this._meta.rows.values()].map(clone), this._tx); }
  delete(key) {
    return new Request(() => {
      if (this._tx.mode !== 'readwrite' && !this._tx._upgrade) throw new Error('ReadOnlyError');
      this._meta.rows.delete(key);
      return undefined;
    }, this._tx);
  }
  clear() {
    return new Request(() => {
      if (this._tx.mode !== 'readwrite' && !this._tx._upgrade) throw new Error('ReadOnlyError');
      this._meta.rows.clear();
      return undefined;
    }, this._tx);
  }
}

class Transaction {
  constructor(db, storeNames, mode = 'readonly', upgrade = false) {
    this.db = db;
    this.mode = mode;
    this.error = null;
    this.oncomplete = null;
    this.onerror = null;
    this.onabort = null;
    this._upgrade = upgrade;
    this._pending = 0;
    this._failed = false;
    this._completeScheduled = false;
    this._storeNames = Array.isArray(storeNames) ? storeNames : [storeNames];
    queueMicrotask(() => this._scheduleComplete());
  }
  objectStore(name) {
    if (!this._storeNames.includes(name) && !this._upgrade) throw new Error(`NotFoundError: store ${name} not in transaction`);
    const meta = this.db._meta.stores.get(name);
    if (!meta) throw new Error(`NotFoundError: store ${name}`);
    return new ObjectStore(this, meta);
  }
  _startRequest() { this._pending += 1; }
  _finishRequest() { this._pending = Math.max(0, this._pending - 1); this._scheduleComplete(); }
  _fail(error) {
    if (this._failed) return;
    this._failed = true;
    this.error = error;
    queueMicrotask(() => this.onerror?.({ target: this }));
  }
  _scheduleComplete() {
    if (this._completeScheduled || this._failed || this._pending > 0) return;
    this._completeScheduled = true;
    setTimeout(() => {
      this._completeScheduled = false;
      if (!this._failed && this._pending === 0) this.oncomplete?.({ target: this });
      else if (!this._failed) this._scheduleComplete();
    }, 0);
  }
}

class Database {
  constructor(meta) {
    this._meta = meta;
    this.name = meta.name;
    this.version = meta.version;
    this.objectStoreNames = new NameList(() => [...meta.stores.keys()]);
  }
  createObjectStore(name, options = {}) {
    if (this._meta.stores.has(name)) throw new Error(`ConstraintError: store ${name} already exists`);
    const meta = { name, keyPath: options.keyPath ?? null, rows: new Map(), indexes: new Map() };
    this._meta.stores.set(name, meta);
    const tx = this._meta.activeUpgradeTransaction;
    return new ObjectStore(tx, meta);
  }
  transaction(storeNames, mode = 'readonly') {
    return new Transaction(this, storeNames, mode, false);
  }
  close() {}
}

class OpenRequest {
  constructor(factory, name, requestedVersion) {
    this.result = undefined;
    this.error = null;
    this.transaction = null;
    this.onupgradeneeded = null;
    this.onsuccess = null;
    this.onerror = null;
    setTimeout(() => this._run(factory, name, requestedVersion), 0);
  }
  _run(factory, name, requestedVersion) {
    try {
      let meta = factory._databases.get(name);
      const version = requestedVersion == null ? (meta?.version ?? 1) : Number(requestedVersion);
      if (meta && version < meta.version) throw new Error('VersionError');
      const isNew = !meta;
      if (!meta) {
        meta = { name, version: 0, stores: new Map(), activeUpgradeTransaction: null };
        factory._databases.set(name, meta);
      }
      const needsUpgrade = isNew || version > meta.version;
      const db = new Database(meta);
      this.result = db;
      if (needsUpgrade) {
        const oldVersion = meta.version;
        meta.version = version;
        db.version = version;
        const upgradeTx = new Transaction(db, [...meta.stores.keys()], 'versionchange', true);
        meta.activeUpgradeTransaction = upgradeTx;
        this.transaction = upgradeTx;
        this.onupgradeneeded?.({ target: this, oldVersion, newVersion: version });
        meta.activeUpgradeTransaction = null;
      }
      queueMicrotask(() => this.onsuccess?.({ target: this }));
    } catch (error) {
      this.error = error;
      queueMicrotask(() => this.onerror?.({ target: this }));
    }
  }
}

export class DeterministicIndexedDBFactory {
  constructor() { this._databases = new Map(); }
  open(name, version) { return new OpenRequest(this, name, version); }
  deleteDatabase(name) {
    return new Request(() => { this._databases.delete(name); return undefined; });
  }
}

export const DeterministicIDBKeyRange = Object.freeze({
  only(value) { return Object.freeze({ type: 'only', value }); },
});

export function createDeterministicIndexedDbEnvironment() {
  return {
    indexedDB: new DeterministicIndexedDBFactory(),
    IDBKeyRange: DeterministicIDBKeyRange,
    verificationMode: 'DETERMINISTIC_IDB_CONTRACT',
  };
}
