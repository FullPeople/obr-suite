import type { GameAction, OmniscientView, PublicHistoryEntry, PublicView, SeatView, TableEdit, TableVariant } from "./rules";

// This pack changes actual rules. Keep older installed backgrounds/tables on
// their original channel rather than silently mixing different card values.
// Old room metadata and private saves remain untouched and recoverable there.
const PACK_CHANNEL = "com.fullpeople/three-dragon-ante/pack-20260910";
export const TABLE_ROOM_KEY = `${PACK_CHANNEL}/table`;
export const TABLE_NETWORK = `${PACK_CHANNEL}/network`;
export const TABLE_OPEN = `${PACK_CHANNEL}/open`;
export const TABLE_READY = `${PACK_CHANNEL}/ready`;
export const TABLE_VIEW = `${PACK_CHANNEL}/view`;
export const TABLE_COMMAND = `${PACK_CHANNEL}/command`;

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
  /** Public setup summary. Omitted only on tables created by an older build. */
  variant?: TableVariant;
}
export type TableError = "connecting" | "hostOffline" | "privateSync" | "storageFailed" | "roomFull" | "tableExists" | "tableFull" | "notHost" | "notAllowed" | "gameStarted" | "invalidEdit" | "cannotLeave" | "tooFewPlayers" | "notSeated" | "staleTable" | "invalidCommand" | "requestFailed" | "recoveryMissing" | "protocolMismatch";
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
/** A bounded, public-only response to an older-history cursor request. It is
 * carried as a one-shot LOCAL view field after the encrypted host response. */
export interface TableHistoryPage {
  gameId: string;
  before: number;
  entries: PublicHistoryEntry[];
  historyComplete: boolean;
  historyStartSequence: number;
}
export interface TableView {
  /** LOCAL background capability, not a room/network schema revision. Its
   * absence identifies an older live background without exact action ACKs. */
  actionReceiptVersion?: 1;
  table: TableSummary | null;
  selfPlayerId: string;
  isHost: boolean;
  /** LOCAL: the viewer's own Owlbear role, read from the SDK on this client.
   *  It is a display/authorization hint only; the host re-checks the role of
   *  any requester against its own party read before acting. */
  role?: "GM" | "PLAYER";
  /** LOCAL: this viewer may remove a seat while the table is still in its lobby. */
  canKick?: boolean;
  /** LOCAL: this viewer may use the host-side table editor. Only the creator
   *  holds the private hands, so this is never granted on an unseated client. */
  canEdit?: boolean;
  connected: boolean;
  /** LOCAL: authenticated connection is alive, but publication/projection is
   * catching up. Input remains blocked; this is not a transport disconnect. */
  syncing?: boolean;
  pending: boolean;
  game: PublicView | SeatView | OmniscientView | null;
  historyPage?: TableHistoryPage;
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
  | { type: "start"; options?: { startingGold?: number; startingHand?: number; variant?: TableVariant } }
  | { type: "newGame" }
  | { type: "history"; before: number }
  /** Ask the serving host to share its local inspection payload. Authorized by
   *  the host from its own party read, never from anything the sender claims. */
  | { type: "inspect"; enabled: boolean }
  /** Lobby-only removal of another player's seat. The host authorizes it from
   *  the requester's authenticated connection plus the room party read, never
   *  from anything the requester claims about itself. */
  | { type: "kick"; playerId: string }
  /** Host-only table edit with automatic accounting. */
  | { type: "edit"; edit: TableEdit }
  | { type: "action"; action: GameAction }
  /** Optional immutable action restores a failed LOCAL page-to-background send.
   * Never generate a new action ID or rebase its revision while uncertain. */
  | { type: "retry"; tableId?: string; gameId?: string; action?: GameAction }
  | { type: "close" };
