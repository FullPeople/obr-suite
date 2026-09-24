// Raw bestiary content cache.
//
// Why: the mirror serves ~107 `bestiary-*.json` files totalling ~11 MB, and the
// panel, the bind picker and the transform picker are three separate iframes.
// Without a shared cache every open — including every "bind a monster to this
// token" — re-downloaded the whole library and sat on 「正在读取」 for seconds.
//
// This keeps the raw per-file `monster` arrays in its own IndexedDB database.
// It is deliberately NOT the local-content store: that store's idbGetAll() warms
// an in-memory cache of the user's imports, so 11 MB of remote data parked there
// would be re-parsed on every start as if the user had imported it.
//
// Two entries per source: a few-hundred-byte meta (validators + the index
// payload) so the cheap check happens before the multi-megabyte file read.
//
// Validity is decided by index.json, never by a blind TTL: the mirror
// regenerates every data file in one batch (all files carry the same
// Last-Modified), so the index validator plus the index payload is a sound
// signal for the whole dataset. A missing validator, a changed one, a different
// payload, or an entry past the backstop TTL all fall back to a real download.
const DB_NAME = "obr-suite-bestiary-content";
const STORE = "sources";
const META_PREFIX = "meta:";
const FILES_PREFIX = "files:";
const BACKSTOP_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface ContentCacheMeta {
  /** When the entry was written, for the backstop TTL. */
  at: number;
  /** index.json as a stable serialisation, so a shape change also invalidates. */
  index: string;
  /** index.json response validators; an empty etag/lastModified is never used. */
  etag: string;
  lastModified: string;
}

function isMeta(value: unknown): value is ContentCacheMeta {
  if (!value || typeof value !== "object") return false;
  const meta = value as ContentCacheMeta;
  return typeof meta.at === "number" && typeof meta.index === "string" &&
    typeof meta.etag === "string" && typeof meta.lastModified === "string";
}

let dbPromise: Promise<IDBDatabase> | null = null;
function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") { reject(new Error("IndexedDB unavailable")); return; }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("bestiary cache open failed"));
  });
  return dbPromise;
}

async function readKey(key: string): Promise<unknown> {
  const db = await openDb();
  return await new Promise<unknown>((resolve, reject) => {
    const request = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("bestiary cache read failed"));
  });
}

/** `null` when there is nothing usable: absent, stale, unreadable, or IDB is
 *  unavailable in this context. Every caller treats that as "download". */
export async function readContentMeta(key: string): Promise<ContentCacheMeta | null> {
  try {
    const value = await readKey(META_PREFIX + key);
    if (!isMeta(value)) return null;
    if (Date.now() - value.at > BACKSTOP_TTL_MS) return null;
    return value;
  } catch (error) {
    console.warn("[bestiary] content cache unavailable", error);
    return null;
  }
}

/** The cached raw payload: filename -> `monster` array exactly as served. */
export async function readContentFiles(key: string): Promise<Record<string, unknown[]> | null> {
  try {
    const value = await readKey(FILES_PREFIX + key);
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown[]> : null;
  } catch (error) {
    console.warn("[bestiary] content cache read failed", error);
    return null;
  }
}

/** Writes both entries and drops every other source: each payload is several
 *  megabytes, so an entry for an abandoned library must not accumulate. */
export async function writeContentCache(
  key: string, meta: ContentCacheMeta, files: Record<string, unknown[]>, keepKeys: readonly string[],
): Promise<void> {
  try {
    const db = await openDb();
    const keep = new Set([META_PREFIX + key, FILES_PREFIX + key]);
    for (const other of keepKeys) { keep.add(META_PREFIX + other); keep.add(FILES_PREFIX + other); }
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      store.put(meta, META_PREFIX + key);
      store.put(files, FILES_PREFIX + key);
      const keys = store.getAllKeys();
      keys.onsuccess = () => { for (const existing of keys.result) if (!keep.has(String(existing))) store.delete(existing); };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("bestiary cache write failed"));
      tx.onabort = () => reject(tx.error ?? new Error("bestiary cache write aborted"));
    });
  } catch (error) {
    // A full disk or a private-mode denial must never break the loaded list.
    console.warn("[bestiary] content cache write skipped", error);
  }
}

/** Forget everything. Called by every explicit reload path (the panel's refresh
 *  control, a library change, a local-content import), so a user who believes
 *  the content is out of date always has a way to force a download. */
export async function dropContentCache(): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("bestiary cache clear failed"));
    });
  } catch (error) {
    console.warn("[bestiary] content cache clear skipped", error);
  }
}
