import type { ControllerPlatform, TableMember } from "../../src/modules/threeDragonAnte/controller-platform";
import type { ControllerStorage } from "../../src/modules/threeDragonAnte/controller";
import type { SavedTable } from "../../src/modules/threeDragonAnte/store";

export const pause = (ms: number) => new Promise<void>(done => setTimeout(done, ms));
export async function until(check: () => boolean, label: string, ms = 4000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) { if (Date.now() > end) throw Error(`Timed out: ${label}`); await pause(5); }
}
export function gate() { let release!: () => void; const promise = new Promise<void>(done => { release = done; }); return { promise, release }; }
export class MemoryStore implements ControllerStorage {
  data = new Map<string, SavedTable>();
  failNext = false;
  delay?: ReturnType<typeof gate>;
  writes = 0;
  private queue: Promise<void> = Promise.resolve();
  async load(room: string, table: string): Promise<SavedTable | null> { return structuredClone(this.data.get(JSON.stringify([room, table])) ?? null); }
  save(value: SavedTable, expected: number | null): Promise<SavedTable> {
    const run = this.queue.then(async () => {
      const delay = this.delay; this.delay = undefined; if (delay) await delay.promise;
      if (this.failNext) { this.failNext = false; throw Error("storageFailed"); }
      const key = JSON.stringify([value.roomId, value.table.id]), old = this.data.get(key);
      if (expected === null ? !!old : old?.serial !== expected) throw Error("staleTable");
      const next = structuredClone({ ...value, serial: (expected ?? 0) + 1 }); this.data.set(key, next); this.writes++;
      return structuredClone(next);
    });
    this.queue = run.then(() => {}, () => {}); return run;
  }
  async close(): Promise<void> {}
}
export interface Traffic { from: string; to: string; value: any }
/** Only the transport/storage boundaries are simulated. Tests run the actual
 * controller, rules, projections and native WebCrypto in each instance. */
export class ControllerRoom {
  table: unknown;
  ports = new Map<string, Port>();
  traffic: Traffic[] = [];
  failWrite = false;
  drop?: (traffic: Traffic) => boolean;
  roomId = "independent-controller-room";
  port(id: string, connectionId: string): Port {
    const port = new Port(this, { id, connectionId, name: id }); this.ports.set(connectionId, port); this.membersChanged(); return port;
  }
  remove(connection: string): void { this.ports.delete(connection); this.membersChanged(); }
  membersChanged(): void { for (const port of this.ports.values()) for (const callback of port.partyCallbacks) callback([...this.ports.values()].filter(other => other !== port).map(other => other.member)); }
  setTable(value: unknown): void { this.table = structuredClone(value); for (const port of this.ports.values()) for (const callback of port.tableCallbacks) callback(structuredClone(this.table)); }
  deliver(from: string, to: string, value: unknown): void { const traffic = { from, to, value: structuredClone(value) }; this.traffic.push(traffic); if (this.drop?.(traffic)) return; for (const callback of this.ports.get(to)?.messageCallbacks ?? []) queueMicrotask(() => callback(structuredClone(value), from)); }
  broadcast(from: string, value: unknown): void { for (const to of this.ports.keys()) if (from !== to) this.deliver(from, to, value); }
  get listeners(): number { return [...this.ports.values()].reduce((n, port) => n + port.tableCallbacks.size + port.partyCallbacks.size + port.selfCallbacks.size + port.messageCallbacks.size, 0); }
}
export class Port implements ControllerPlatform {
  tableCallbacks = new Set<(value: unknown) => void>();
  partyCallbacks = new Set<(players: TableMember[]) => void>();
  selfCallbacks = new Set<(member: TableMember) => void>();
  messageCallbacks = new Set<(value: unknown, sender: string) => void>();
  delayedRead?: ReturnType<typeof gate>;
  constructor(private room: ControllerRoom, public member: TableMember) {}
  get roomId(): string { return this.room.roomId; }
  async self() { return this.member; }
  async players() { return [...this.room.ports.values()].filter(port => port !== this).map(port => port.member); }
  async readTable() { const value = structuredClone(this.room.table), delay = this.delayedRead; this.delayedRead = undefined; if (delay) await delay.promise; return value; }
  async writeTable(value: unknown) { if (this.room.failWrite) throw Error("roomFull"); this.room.setTable(value); }
  async send(value: unknown) { this.room.broadcast(this.member.connectionId, value); }
  onTable(callback: (value: unknown) => void) { this.tableCallbacks.add(callback); return () => this.tableCallbacks.delete(callback); }
  onPlayers(callback: (players: TableMember[]) => void) { this.partyCallbacks.add(callback); return () => this.partyCallbacks.delete(callback); }
  onSelf(callback: (member: TableMember) => void) { this.selfCallbacks.add(callback); return () => this.selfCallbacks.delete(callback); }
  onMessage(callback: (value: unknown, sender: string) => void) { this.messageCallbacks.add(callback); return () => this.messageCallbacks.delete(callback); }
}
