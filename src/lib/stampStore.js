/**
 * IndexedDB persistence for user stamps (presets are not stored).
 *
 * Everything stays in this browser's IndexedDB — nothing is uploaded.
 * `createStampStore(factory)` takes the IDBFactory to use so tests can pass
 * an in-memory one; it defaults to the browser's `indexedDB`.
 */
import { cleanName, isValidStamp, normalizeStampRecord } from './stamps.js';

export const DB_NAME = 'docusync';
export const DB_VERSION = 1;
export const STORE = 'stamps';

/** Wrap an IDBRequest in a promise. */
const request = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

/** Resolve when a transaction commits (writes are durable then). */
const done = (tx) =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'));
  });

function newId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `stamp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function openDb(factory) {
  return new Promise((resolve, reject) => {
    let req;
    try {
      req = factory.open(DB_NAME, DB_VERSION);
    } catch (err) {
      reject(err);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Stamp storage is blocked by another tab'));
  });
}

/**
 * @param {IDBFactory} [factory]
 * @returns store with list / add / rename / remove / close. Every method
 *   rejects if IndexedDB is unavailable (e.g. some private-browsing modes).
 */
export function createStampStore(factory = globalThis.indexedDB) {
  let dbPromise = null;
  // Strictly increasing timestamps, so stamps saved within the same
  // millisecond still list in the order they were added.
  let lastTime = 0;
  const timestamp = () => (lastTime = Math.max(Date.now(), lastTime + 1));
  const db = () => {
    if (!factory) return Promise.reject(new Error('IndexedDB is not available'));
    dbPromise ??= openDb(factory).catch((err) => {
      dbPromise = null; // allow a retry later
      throw err;
    });
    return dbPromise;
  };

  return {
    /** All valid saved stamps, oldest first (corrupt records are skipped). */
    async list() {
      const tx = (await db()).transaction(STORE, 'readonly');
      const all = await request(tx.objectStore(STORE).getAll());
      return all
        .map(normalizeStampRecord)
        .filter(isValidStamp)
        .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
    },

    /** Save a new stamp; returns it with id and timestamps. */
    async add(stamp) {
      const now = timestamp();
      const { builtIn, ...rest } = stamp; // presets are never stored
      const record = { ...rest, id: newId(), createdAt: now, updatedAt: now };
      if (!isValidStamp(record)) throw new Error('Not a valid stamp');
      const tx = (await db()).transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(record);
      await done(tx);
      return record;
    },

    /** Change a saved stamp's name (other fields are fixed once created). */
    async rename(id, name) {
      const tx = (await db()).transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const existing = await request(store.get(id));
      if (!existing) throw new Error('That stamp no longer exists');
      const record = { ...existing, name: cleanName(name, existing.name), updatedAt: timestamp() };
      store.put(record);
      await done(tx);
      return record;
    },

    async remove(id) {
      const tx = (await db()).transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      await done(tx);
    },

    /** Close the connection (lets tests reopen, simulating a reload). */
    async close() {
      if (!dbPromise) return;
      const conn = await dbPromise.catch(() => null);
      conn?.close();
      dbPromise = null;
    },
  };
}
