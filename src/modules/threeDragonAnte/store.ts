import type { TableSummary } from "./protocol";
import type { GameState } from "./rules";
export interface SavedTable { version: 1; roomId: string; table: TableSummary; game: GameState | null; serial: number }
const DATABASE = "obr-suite-three-dragon-ante", STORE = "host-tables";
/** Host recovery remains in this browser. The control iframe never owns it.
 * Serial comparison and the write share one IndexedDB transaction, so a stale
 * second tab cannot overwrite a newer action in the same browser profile. */
export class TableStore {
  private database?: Promise<IDBDatabase>;
  private open(): Promise<IDBDatabase> {
    if (!this.database) {
      this.database = new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(DATABASE, 1);
        request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE); };
        request.onerror = () => reject(Error("storageFailed"));
        request.onblocked = () => reject(Error("storageFailed"));
        request.onsuccess = () => {
          const db = request.result;
          db.onversionchange = () => { db.close(); this.database = undefined; };
          resolve(db);
        };
      }).catch(error => { this.database = undefined; throw error; });
    }
    return this.database;
  }
  private key(roomId: string, tableId: string): string { return JSON.stringify([roomId, tableId]); }
  async load(roomId: string, tableId: string): Promise<SavedTable | null> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, "readonly");
      const request = transaction.objectStore(STORE).get(this.key(roomId, tableId));
      transaction.oncomplete = () => {
        const value = request.result as SavedTable | undefined;
        if (!value) { resolve(null); return; }
        if (value.version !== 1 || value.roomId !== roomId || value.table?.id !== tableId || !Number.isSafeInteger(value.serial) || value.serial < 1) { reject(Error("recoveryMissing")); return; }
        resolve(value);
      };
      transaction.onerror = transaction.onabort = () => reject(Error("storageFailed"));
    });
  }
  async save(value: SavedTable, expectedSerial: number | null): Promise<SavedTable> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, "readwrite");
      const store = transaction.objectStore(STORE), request = store.get(this.key(value.roomId, value.table.id));
      let next: SavedTable | undefined, conflict = false;
      request.onsuccess = () => {
        const old = request.result as SavedTable | undefined;
        if ((expectedSerial === null && old) || (expectedSerial !== null && old?.serial !== expectedSerial)) { conflict = true; transaction.abort(); return; }
        next = structuredClone({ ...value, serial: (expectedSerial ?? 0) + 1 });
        try { store.put(next, this.key(value.roomId, value.table.id)); }
        catch { transaction.abort(); }
      };
      transaction.oncomplete = () => next ? resolve(next) : reject(Error("storageFailed"));
      transaction.onerror = transaction.onabort = () => reject(Error(conflict ? "staleTable" : "storageFailed"));
    });
  }
  async close(): Promise<void> { const pending = this.database; this.database = undefined; if (pending) (await pending).close(); }
}
