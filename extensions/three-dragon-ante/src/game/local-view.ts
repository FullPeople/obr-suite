import type { TableView } from "./protocol";
import { HISTORY_WIRE_BUDGET, packPublic, packSeat, unpackPublic, unpackPublicHistoryEntry, unpackSeat } from "./wire";

import type { OmniscientView } from "./rules";
import { card } from "./rules";

/** The LOCAL channel only reaches this player's own page, which is where the
 *  host inspects the table. packSeat is the encrypted REMOTE whitelist and must
 *  never carry inspection data, so it travels here. */
function packOmniscient(view: OmniscientView, budget?: number) {
  return { ...packSeat(view, budget), omniscient: true as const,
    privateHands: Object.fromEntries(Object.entries(view.privateHands).map(([seatId, cards]) => [seatId, cards.map(value => value.id)])),
    privateCommittedAntes: Object.fromEntries(Object.entries(view.privateCommittedAntes).map(([seatId, value]) => [seatId, value?.id ?? null])),
    privateHandPowerHints: view.privateHandPowerHints,
    privateDeck: view.privateDeck?.map(value => value.id) ?? [], privateExcluded: view.privateExcluded?.map(value => value.id) ?? [] };
}
function unpackOmniscient(wire: Record<string, unknown>): OmniscientView {
  const hands = (wire.privateHands ?? {}) as Record<string, string[]>;
  const antes = (wire.privateCommittedAntes ?? {}) as Record<string, string | null>;
  const deck = (wire.privateDeck ?? []) as string[], excluded = (wire.privateExcluded ?? []) as string[];
  return { ...unpackSeat(wire as never), omniscient: true,
    privateHands: Object.fromEntries(Object.entries(hands).map(([seatId, ids]) => [seatId, ids.map(id => card(id))])),
    privateCommittedAntes: Object.fromEntries(Object.entries(antes).map(([seatId, id]) => [seatId, id ? card(id) : null])),
    privateHandPowerHints: (wire.privateHandPowerHints ?? {}) as OmniscientView["privateHandPowerHints"],
    privateDeck: deck.map(id => card(id)), privateExcluded: excluded.map(id => card(id)) };
}
export interface LocalViewPart { version: 1; clientId: string; sequence: number; part: number; total: number; payload: string }
const CHUNK = 10000, MAX_BYTES = 131072, MAX_PARTS = 18;
/** The routine view is sent on every change and every message costs one tick of
 *  Owlbear's broadcast rate limit, so it carries only the recent public log: a
 *  page of older history is requested on demand through the history command.
 *  Sixteen messages per view was enough to trip the limiter mid-session. */
const LOCAL_IDLE_HISTORY_BUDGET = 8_000;
function packTable(value:TableView["table"]):TableView["table"] {
  if(!value)return null;
  const variant=value.variant;
  return {version:value.version,id:value.id,hostPlayerId:value.hostPlayerId,hostConnectionId:value.hostConnectionId,hostName:value.hostName,stage:value.stage,
    seats:value.seats.map(seat=>({playerId:seat.playerId,seatId:seat.seatId,name:seat.name})),revision:value.revision,
    ...(variant?{variant:{ruleSetId:variant.ruleSetId,deckId:variant.deckId,...(Array.isArray(variant.specialIds)?{specialIds:[...variant.specialIds]}:{})}}:{})};
}
function packHistoryPage(value:TableView["historyPage"]):TableView["historyPage"] {
  if(!value)return undefined;
  return {gameId:value.gameId,before:value.before,entries:value.entries.map(unpackPublicHistoryEntry),historyComplete:value.historyComplete,historyStartSequence:value.historyStartSequence};
}
function unpackTable(value:unknown):TableView["table"] {
  if(value===null)return null;
  if(!value||typeof value!=="object")return null;
  const table=value as Record<string,any>,variant=table.variant&&typeof table.variant==="object"?table.variant:null;
  return {version:table.version,id:table.id,hostPlayerId:table.hostPlayerId,hostConnectionId:table.hostConnectionId,hostName:table.hostName,stage:table.stage,
    seats:Array.isArray(table.seats)?table.seats.map(seat=>({playerId:seat.playerId,seatId:seat.seatId,name:seat.name})):[],revision:table.revision,
    ...(variant?{variant:{ruleSetId:variant.ruleSetId,deckId:variant.deckId,...(Array.isArray(variant.specialIds)?{specialIds:[...variant.specialIds]}:{})}}:{})};
}
function unpackHistoryPage(value:unknown):TableView["historyPage"] {
  if(!value||typeof value!=="object")return undefined;
  const page=value as Record<string,any>;
  return {gameId:page.gameId,before:page.before,entries:Array.isArray(page.entries)?page.entries.map(unpackPublicHistoryEntry):[],historyComplete:page.historyComplete,historyStartSequence:page.historyStartSequence};
}
function unpackReceipt(value:unknown):TableView["actionReceipt"] {
  if(!value||typeof value!=="object")return undefined;
  const receipt=value as Record<string,any>;
  return {actionId:receipt.actionId,tableId:receipt.tableId,gameId:receipt.gameId,revision:receipt.revision,ok:receipt.ok,
    ...(typeof receipt.code==="string"?{code:receipt.code}:{}),...(typeof receipt.retryable==="boolean"?{retryable:receipt.retryable}:{}),...(receipt.source==="host"||receipt.source==="local"?{source:receipt.source}: {})};
}
/** LOCAL broadcasts have the same SDK byte cap as REMOTE. Encode card IDs and
 *  split bytes instead of truncating discard piles, events or legal choices.
 *
 *  The history is the elastic part: without a pending page it is allowed to fill
 *  the whole message, which puts a normal late-game envelope within a few
 *  percent of the cap. Anything extra — a sixth seat, a long discard pile, the
 *  host's inspection payload — used to push it over and *throw*, which killed
 *  every later view publication for the rest of the session. The envelope is now
 *  measured as a whole and the history shrunk until it fits, so the table keeps
 *  working with a shorter replay log instead of going blank. */
export function localViewParts(view: TableView, clientId: string, sequence: number): LocalViewPart[] {
  const inspecting = !!view.game && "omniscient" in view.game && (view.game as OmniscientView).omniscient === true;
  const encode = (historyBudget: number, includePage: boolean): { bytes: Uint8Array } => {
    const game = view.game && (inspecting ? packOmniscient(view.game as OmniscientView, historyBudget) : "selfSeatId" in view.game ? packSeat(view.game as never, historyBudget) : packPublic(view.game as never, historyBudget));
    const envelope = { actionReceiptVersion:view.actionReceiptVersion,table:packTable(view.table),selfPlayerId:view.selfPlayerId,isHost:view.isHost,role:view.role,canKick:view.canKick,canEdit:view.canEdit,connected:view.connected,
      syncing:view.syncing,pending:view.pending,game,historyPage:includePage?packHistoryPage(view.historyPage):undefined,actionReceipt:view.actionReceipt,message:view.message };
    return { bytes: new TextEncoder().encode(JSON.stringify(envelope)) };
  };
  // The LOCAL channel has a larger byte envelope than the encrypted REMOTE link,
  // and a one-shot history page has to share it.
  let historyBudget = view.historyPage ? HISTORY_WIRE_BUDGET : LOCAL_IDLE_HISTORY_BUDGET;
  let includePage = !!view.historyPage;
  let bytes = encode(historyBudget, includePage).bytes;
  while (bytes.length > MAX_BYTES) {
    if (historyBudget > 4096) historyBudget = Math.floor(historyBudget / 2);
    else if (includePage) includePage = false;
    else throw Error("viewTooLarge");
    bytes = encode(historyBudget, includePage).bytes;
  }
  let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte);
  const encoded = btoa(binary), total = Math.ceil(encoded.length / CHUNK);
  return Array.from({ length: total }, (_, part) => ({ version: 1, clientId, sequence, part, total, payload: encoded.slice(part * CHUNK, (part + 1) * CHUNK) }));
}
export class LocalViewReceiver {
  private applied = 0;
  private assembling = new Map<number, { at: number; total: number; parts: Map<number, string> }>();
  /** `onDrop` exists so a silently discarded part can name its reason: a view
   *  that never arrives looks identical to one that was rejected here. */
  constructor(private clientId: string, private onDrop: (reason: string, detail?: unknown) => void = () => {}) {}
  receive(value: unknown, now = Date.now()): TableView | undefined {
    const packet = value as LocalViewPart;
    if (!packet || typeof packet !== "object" || packet.version !== 1) { this.onDrop("shape", { value: typeof packet }); return; }
    if (packet.clientId !== this.clientId) { this.onDrop("other-client", { clientId: packet.clientId }); return; }
    if (!Number.isSafeInteger(packet.sequence) || packet.sequence <= this.applied) { this.onDrop("stale-sequence", { sequence: packet.sequence, applied: this.applied }); return; }
    if (!Number.isSafeInteger(packet.total) || packet.total < 1 || packet.total > MAX_PARTS || !Number.isSafeInteger(packet.part) || packet.part < 0 || packet.part >= packet.total) { this.onDrop("bad-part-header", { sequence: packet.sequence, part: packet.part, total: packet.total }); return; }
    if (typeof packet.payload !== "string" || !packet.payload || packet.payload.length > CHUNK || !/^[A-Za-z0-9+/]*={0,2}$/.test(packet.payload)) { this.onDrop("bad-payload", { sequence: packet.sequence, part: packet.part, length: typeof packet.payload === "string" ? packet.payload.length : null }); return; }
    for (const [sequence, entry] of this.assembling) if (now - entry.at > 15000) { this.assembling.delete(sequence); this.onDrop("assembly-timeout", { sequence, have: entry.parts.size, total: entry.total }); }
    let entry = this.assembling.get(packet.sequence);
    if (!entry) {
      if (this.assembling.size >= 3) { const oldest = Math.min(...this.assembling.keys()); this.assembling.delete(oldest); this.onDrop("assembly-overflow", { dropped: oldest }); }
      entry = { at: now, total: packet.total, parts: new Map() }; this.assembling.set(packet.sequence, entry);
    }
    if (entry.total !== packet.total || (entry.parts.has(packet.part) && entry.parts.get(packet.part) !== packet.payload)) { this.onDrop("inconsistent-part", { sequence: packet.sequence, part: packet.part }); return; }
    entry.parts.set(packet.part, packet.payload);
    if (entry.parts.size !== entry.total) return;
    this.assembling.delete(packet.sequence);
    try {
      const binary = atob(Array.from({ length: entry.total }, (_, part) => entry.parts.get(part)).join(""));
      if (binary.length > MAX_BYTES) { this.onDrop("oversize", { bytes: binary.length }); return; }
      const raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(binary, char => char.charCodeAt(0))));
      if (!raw || typeof raw.selfPlayerId !== "string" || typeof raw.connected !== "boolean" || typeof raw.isHost !== "boolean" || typeof raw.pending !== "boolean" || raw.game!==null&&(!raw.game||typeof raw.game!=="object")) { this.onDrop("bad-envelope", { keys: raw && typeof raw === "object" ? Object.keys(raw).length : 0 }); return; }
      const game = raw.game===null ? null : raw.game.omniscient===true ? unpackOmniscient(raw.game) : "selfSeatId" in raw.game ? unpackSeat(raw.game) : unpackPublic(raw.game);
      const view:TableView = { actionReceiptVersion:raw.actionReceiptVersion===1?1:undefined,table:unpackTable(raw.table),selfPlayerId:raw.selfPlayerId,isHost:raw.isHost,
        role:raw.role==="GM"||raw.role==="PLAYER"?raw.role:undefined,canKick:typeof raw.canKick==="boolean"?raw.canKick:undefined,canEdit:typeof raw.canEdit==="boolean"?raw.canEdit:undefined,
        connected:raw.connected,syncing:typeof raw.syncing==="boolean"?raw.syncing:undefined,pending:raw.pending,game,historyPage:unpackHistoryPage(raw.historyPage),
        actionReceipt:unpackReceipt(raw.actionReceipt),message:typeof raw.message==="string"?raw.message:undefined };
      this.applied = packet.sequence;
      for (const sequence of this.assembling.keys()) if (sequence <= this.applied) this.assembling.delete(sequence);
      return view;
    } catch (error) { this.onDrop("decode-failed", { error: String(error) }); return; }
  }
  clear(): void { this.assembling.clear(); }
}
