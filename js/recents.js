/**
 * MJ PDF Viewer — recent documents (IndexedDB)
 *
 * Everything stays on the device. Each entry remembers enough to reopen the
 * file instantly (blob, while quotas allow), plus reading progress and a
 * small rendered cover so the home screen feels like a shelf, not a log.
 *
 * Size governance:
 *   • at most MAX_ENTRIES documents
 *   • blobs above MAX_BLOB_PER_FILE are dropped (metadata is kept)
 *   • total stored blob bytes stay under MAX_TOTAL_BYTES (oldest evicted)
 */

const DB_NAME = 'mjpdf-viewer';
const STORE = 'recents';
const DB_VERSION = 1;

const MAX_ENTRIES = 12;
const MAX_BLOB_PER_FILE = 60 * 1024 * 1024;   // 60 MB
const MAX_TOTAL_BYTES = 220 * 1024 * 1024;    // 220 MB

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        const store = req.result.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('openedAt', 'openedAt');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    const out = fn(store);
    t.oncomplete = () => resolve(out?.result ?? out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

/** Stable, privacy-friendly id for a file source. */
export function sourceId({ name, size, lastModified, url }) {
  if (url) return `url:${url}`;
  const lm = lastModified ? String(lastModified) : 'x';
  return `f:${name}:${size}:${lm}`;
}

export const recents = {
  /** All entries, most recently opened first. */
  async list() {
    const all = await tx('readonly', (s) => s.getAll());
    return (all || []).sort((a, b) => (b.openedAt || 0) - (a.openedAt || 0));
  },

  async get(id) {
    return tx('readonly', (s) => s.get(id));
  },

  /**
   * Insert/update an entry and enforce the governance limits.
   * `blob` is optional — omitted for documents too big to keep.
   */
  async put(entry) {
    const all = await this.list();
    const others = all.filter((e) => e.id !== entry.id);

    if (entry.blob && entry.blob.size > MAX_BLOB_PER_FILE) {
      entry = { ...entry, blob: undefined, blobDropped: true };
    }

    let pool = [...others, entry];
    // cap count + total bytes, evicting least-recently-opened first
    pool.sort((a, b) => (b.openedAt || 0) - (a.openedAt || 0));
    let bytes = pool.reduce((sum, e) => sum + (e.blob?.size || 0), 0);
    while (pool.length > MAX_ENTRIES) pool.pop();
    while (bytes > MAX_TOTAL_BYTES && pool.length > 1) {
      const evicted = pool.pop();
      bytes -= evicted.blob?.size || 0;
    }

    await tx('readwrite', (s) => {
      const keep = new Set(pool.map((e) => e.id));
      for (const e of all) if (!keep.has(e.id)) s.delete(e.id);
      for (const e of pool) s.put(e);
    });
    return entry;
  },

  /** Patch a few fields on an existing entry (e.g. reading progress). */
  async patch(id, fields) {
    const entry = await this.get(id);
    if (!entry) return null;
    const updated = { ...entry, ...fields };
    await tx('readwrite', (s) => s.put(updated));
    return updated;
  },

  async remove(id) {
    await tx('readwrite', (s) => s.delete(id));
  },

  async clear() {
    await tx('readwrite', (s) => s.clear());
  },

  async usage() {
    const all = await this.list();
    return {
      count: all.length,
      bytes: all.reduce((sum, e) => sum + (e.blob?.size || 0), 0),
    };
  },
};
