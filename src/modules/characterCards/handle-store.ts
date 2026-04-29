// Persistent storage for File System Access API handles. We keep one
// `FileSystemFileHandle` per cardId so the user can re-read the same
// local xlsx without re-prompting.
//
// IndexedDB serializes handle objects natively — the browser stores
// them with an opaque internal reference. After a page reload (or
// even browser restart in most cases) the handle is still alive, but
// the *permission grant* may need to be re-requested before reading.
//
// API surface:
//   await getHandle(cardId)               → FileSystemFileHandle | null
//   await setHandle(cardId, handle)       → void
//   await deleteHandle(cardId)            → void
//   await ensureReadPermission(handle)    → boolean (true = ok to read)
//   isLocalLinkSupported()                → boolean (gated on window.showOpenFilePicker)

const DB_NAME = "obr-suite-cc";
const DB_VERSION = 1;
const STORE_NAME = "handles";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T> | T,
): Promise<T> {
  const db = await openDB();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    const result = fn(store);
    if (result instanceof IDBRequest) {
      result.onsuccess = () => resolve(result.result);
      result.onerror = () => reject(result.error);
    } else {
      tx.oncomplete = () => resolve(result as T);
      tx.onerror = () => reject(tx.error);
    }
  });
}

export async function getHandle(cardId: string): Promise<FileSystemFileHandle | null> {
  try {
    const v = await withStore<FileSystemFileHandle | undefined>("readonly", (s) =>
      s.get(cardId) as IDBRequest<FileSystemFileHandle | undefined>,
    );
    return v ?? null;
  } catch {
    return null;
  }
}

export async function setHandle(cardId: string, handle: FileSystemFileHandle): Promise<void> {
  try {
    await withStore("readwrite", (s) => s.put(handle, cardId) as IDBRequest<IDBValidKey>);
  } catch (e) {
    console.error("[cc/handle-store] setHandle failed", e);
  }
}

export async function deleteHandle(cardId: string): Promise<void> {
  try {
    await withStore("readwrite", (s) => s.delete(cardId) as IDBRequest<undefined>);
  } catch {}
}

// Probe + ask for read permission on a handle. Returns false if the
// user denied or the API isn't available; true means the handle is
// safe to call `getFile()` on.
export async function ensureReadPermission(
  handle: FileSystemFileHandle,
): Promise<boolean> {
  try {
    const opts = { mode: "read" as const };
    // Spec types: queryPermission / requestPermission.
    const cur = await (handle as any).queryPermission?.(opts);
    if (cur === "granted") return true;
    const next = await (handle as any).requestPermission?.(opts);
    return next === "granted";
  } catch {
    return false;
  }
}

// Feature-detect — gates the "Link Local File" button visibility.
export function isLocalLinkSupported(): boolean {
  return typeof (window as any).showOpenFilePicker === "function";
}
