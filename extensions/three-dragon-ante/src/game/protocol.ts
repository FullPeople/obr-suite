import type { GameAction, PublicView, SeatView } from "./rules";

export const TABLE_ROOM_KEY = "com.fullpeople/three-dragon-ante/table";
export const TABLE_NETWORK = "com.fullpeople/three-dragon-ante/network";
export const TABLE_OPEN = "com.fullpeople/three-dragon-ante/open";
export const TABLE_READY = "com.fullpeople/three-dragon-ante/ready";
export const TABLE_VIEW = "com.fullpeople/three-dragon-ante/view";
export const TABLE_COMMAND = "com.fullpeople/three-dragon-ante/command";

export interface TableSeat { playerId: string; seatId: string; name: string }
/** Room metadata contains seating/ownership only. Never put hands or deck here. */
export interface TableSummary {
  version: 1;
  id: string;
  hostPlayerId: string;
  hostConnectionId: string;
  hostName: string;
  stage: "lobby" | "playing" | "ended";
  seats: TableSeat[];
  revision: number;
}
export type TableError = "connecting" | "hostOffline" | "privateSync" | "storageFailed" | "roomFull" | "tableExists" | "tableFull" | "notHost" | "cannotLeave" | "tooFewPlayers" | "notSeated" | "staleTable" | "invalidCommand" | "requestFailed" | "recoveryMissing" | "protocolMismatch";
/** LOCAL-only outcome for this client's exact rules action. No card IDs.
 * Success revision is the applied rules revision; rejection revision is the
 * submitted base revision. A success also requires the matching authoritative
 * table/game projection at that revision or later before visually landing. */
export interface ActionReceipt {
  actionId: string;
  tableId: string;
  gameId: string;
  revision: number;
  ok: boolean;
  code?: string;
  retryable?: boolean;
  /** A local rejection means the controller refused this submission/retry;
   * it is not a host acknowledgement. Older views omit this for host receipts. */
  source?: "host" | "local";
}
export interface TableView {
  /** LOCAL background capability, not a room/network schema revision. Its
   * absence identifies an older live background without exact action ACKs. */
  actionReceiptVersion?: 1;
  table: TableSummary | null;
  selfPlayerId: string;
  isHost: boolean;
  connected: boolean;
  /** LOCAL: authenticated connection is alive, but publication/projection is
   * catching up. Input remains blocked; this is not a transport disconnect. */
  syncing?: boolean;
  pending: boolean;
  game: PublicView | SeatView | null;
  /** Retained until another action/retry or a table/game/lifecycle change.
   * Absence, pending=false and unrelated revisions are never success ACKs. */
  actionReceipt?: ActionReceipt;
  /** Local status/error; rule action errors also use their exported machine codes. */
  message?: TableError | string;
}
export type TableCommand =
  | { type: "create" }
  | { type: "join" }
  | { type: "leave" }
  | { type: "start" }
  | { type: "newGame" }
  | { type: "action"; action: GameAction }
  /** Optional immutable action restores a failed LOCAL page-to-background send.
   * Never generate a new action ID or rebase its revision while uncertain. */
  | { type: "retry"; tableId?: string; gameId?: string; action?: GameAction }
  | { type: "close" };
