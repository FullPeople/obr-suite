// Minimal async IndexedDB wrapper. Single object store keyed by string,
// value is anything `structured-clone` can serialise (the suite's
// homebrew JSON files are structured-clone-safe).
//
// Why we exist: localStorage caps a single origin at ~5–10 MB, JSON-
// stringifies everything, and runs synchronously on the main thread.
// IndexedDB lifts the cap to ~60% of free disk, stores native objects,
// and is async — perfect for our growing local-content store. See
// `src/utils/localContent.ts` for the actual cache layer that uses
// this; this file is just a tiny `idb-keyval`-style helper so the
// caller doesn't have to deal with `onupgradeneeded` / transactions /
// request callbacks directly.
//
// 2026-05-10 added — was previously inlined in localContent.ts as
// localStorage; the user reported repeated "存储失败 — localStorage
// 容量已满" errors when their player tried to import larger homebrew
// packs.

const DB_NAME = "obr-suite";
const DB_VERSION = 1;
const STORE = "local-content";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable in this context"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexedDB open failed"));
    // `onblocked` fires if another tab has the DB open at a lower
    // version. Our DB version is 1 + we never bump it, so this
    // shouldn't happen in practice — but log it just in case.
    req.onblocked = () => {
      console.warn("[obr-suite/idbStore] open blocked (another tab holds the DB)");
    };
  });
  return dbPromise;
}

/** Read a single value by key. Returns `null` when the key is absent
 *  OR when IDB itself failed to open (the catch reports + falls
 *  through so the caller can degrade gracefully). */
export async function idbGet<T = unknown>(key: string): Promise<T | null> {
  try {
    const db = await openDb();
    return await new Promise<T | null>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve((req.result as T | undefined) ?? null);
      req.onerror = () => reject(req.error ?? new Error("idbGet failed"));
    });
  } catch (e) {
    console.warn("[obr-suite/idbStore] idbGet failed", key, e);
    return null;
  }
}

/** Write `value` at `key`. Resolves when the transaction commits.
 *  Throws on quota / IDB failure so the caller can roll back its
 *  in-memory state. */
export async function idbPut(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("idbPut failed"));
    tx.onabort = () => reject(tx.error ?? new Error("idbPut aborted"));
  });
}

/** Delete a single key. Resolves whether the key existed or not. */
export async function idbDelete(key: string): Promise<void> {
  try {
    const db = await openDb();
    return await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("idbDelete failed"));
    });
  } catch (e) {
    console.warn("[obr-suite/idbStore] idbDelete failed", key, e);
  }
}

/** Read every (key, value) pair from the store. Used at init time to
 *  warm an in-memory cache. Order isn't guaranteed by the IDB spec
 *  for `getAll` / `getAllKeys`, but Chromium / Firefox both return
 *  insertion order in practice; the caller sorts where it needs to. */
export async function idbGetAll(): Promise<Array<[string, unknown]>> {
  try {
    const db = await openDb();
    return await new Promise<Array<[string, unknown]>>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const objStore = tx.objectStore(STORE);
      const keysReq = objStore.getAllKeys();
      const valsReq = objStore.getAll();
      let keys: IDBValidKey[] | null = null;
      let vals: unknown[] | null = null;
      const tryFinish = () => {
        if (keys == null || vals == null) return;
        const out: Array<[string, unknown]> = [];
        for (let i = 0; i < keys.length; i++) {
          out.push([String(keys[i]), vals[i]]);
        }
        resolve(out);
      };
      keysReq.onsuccess = () => { keys = keysReq.result as IDBValidKey[]; tryFinish(); };
      valsReq.onsuccess = () => { vals = valsReq.result as unknown[]; tryFinish(); };
      tx.onerror = () => reject(tx.error ?? new Error("idbGetAll failed"));
    });
  } catch (e) {
    console.warn("[obr-suite/idbStore] idbGetAll failed", e);
    return [];
  }
}

/** Drop every entry. Used by the "clear all imports" button in
 *  settings; the in-memory cache layer in localContent.ts also
 *  zeroes its own state in lockstep. */
export async function idbClear(): Promise<void> {
  try {
    const db = await openDb();
    return await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("idbClear failed"));
    });
  } catch (e) {
    console.warn("[obr-suite/idbStore] idbClear failed", e);
  }
}
