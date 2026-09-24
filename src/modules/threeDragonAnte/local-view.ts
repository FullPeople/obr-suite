import type { TableView } from "./protocol";
import { packPublic, packSeat, unpackPublic, unpackSeat } from "./wire";

export interface LocalViewPart { version: 1; clientId: string; sequence: number; part: number; total: number; payload: string }
const CHUNK = 10000, MAX_BYTES = 131072, MAX_PARTS = 18;
/** LOCAL broadcasts have the same SDK byte cap as REMOTE. Encode card IDs and
 * split bytes instead of truncating discard piles, events or legal choices. */
export function localViewParts(view: TableView, clientId: string, sequence: number): LocalViewPart[] {
  const game = view.game && ("selfSeatId" in view.game ? packSeat(view.game) : packPublic(view.game));
  const bytes = new TextEncoder().encode(JSON.stringify({ ...view, game }));
  if (bytes.length > MAX_BYTES) throw Error("viewTooLarge");
  let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte);
  const encoded = btoa(binary), total = Math.ceil(encoded.length / CHUNK);
  return Array.from({ length: total }, (_, part) => ({ version: 1, clientId, sequence, part, total, payload: encoded.slice(part * CHUNK, (part + 1) * CHUNK) }));
}
export class LocalViewReceiver {
  private applied = 0;
  private assembling = new Map<number, { at: number; total: number; parts: Map<number, string> }>();
  constructor(private clientId: string) {}
  receive(value: unknown, now = Date.now()): TableView | undefined {
    const packet = value as LocalViewPart;
    if (!packet || packet.version !== 1 || packet.clientId !== this.clientId || !Number.isSafeInteger(packet.sequence) || packet.sequence <= this.applied ||
      !Number.isSafeInteger(packet.total) || packet.total < 1 || packet.total > MAX_PARTS || !Number.isSafeInteger(packet.part) || packet.part < 0 || packet.part >= packet.total ||
      typeof packet.payload !== "string" || !packet.payload || packet.payload.length > CHUNK || !/^[A-Za-z0-9+/]*={0,2}$/.test(packet.payload)) return;
    for (const [sequence, entry] of this.assembling) if (now - entry.at > 15000) this.assembling.delete(sequence);
    let entry = this.assembling.get(packet.sequence);
    if (!entry) {
      if (this.assembling.size >= 3) this.assembling.delete(Math.min(...this.assembling.keys()));
      entry = { at: now, total: packet.total, parts: new Map() }; this.assembling.set(packet.sequence, entry);
    }
    if (entry.total !== packet.total || (entry.parts.has(packet.part) && entry.parts.get(packet.part) !== packet.payload)) return;
    entry.parts.set(packet.part, packet.payload);
    if (entry.parts.size !== entry.total) return;
    this.assembling.delete(packet.sequence);
    try {
      const binary = atob(Array.from({ length: entry.total }, (_, part) => entry.parts.get(part)).join(""));
      if (binary.length > MAX_BYTES) return;
      const view = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(binary, char => char.charCodeAt(0))));
      if (!view || typeof view.selfPlayerId !== "string" || typeof view.connected !== "boolean" || typeof view.isHost !== "boolean" || typeof view.pending !== "boolean") return;
      if (view.game !== null) view.game = "selfSeatId" in view.game ? unpackSeat(view.game) : unpackPublic(view.game);
      this.applied = packet.sequence;
      for (const sequence of this.assembling.keys()) if (sequence <= this.applied) this.assembling.delete(sequence);
      return view;
    } catch { return; }
  }
  clear(): void { this.assembling.clear(); }
}
