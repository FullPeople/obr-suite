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
export interface TableView {
  table: TableSummary | null;
  selfPlayerId: string;
  isHost: boolean;
  connected: boolean;
  pending: boolean;
  game: PublicView | SeatView | null;
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
  | { type: "retry" }
  | { type: "close" };
