import { CARDS, STANDARD_CARDS, checkInvariants } from "./rules";
import type { GameState } from "./rules";
import type { SavedTable } from "./store";
import type { TableSummary } from "./protocol";

export const validText = (value: unknown, max = 160): value is string => typeof value === "string" && value.length > 0 && value.length <= max;
export const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const integer = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0;

/** Metadata is public, so validate its shape before using it as an authority. */
export function tableSummary(value: unknown): TableSummary | null {
  if (!record(value) || value.version !== 1 || !validText(value.id) || !validText(value.hostPlayerId) ||
      !validText(value.hostConnectionId) || typeof value.hostName !== "string" || value.hostName.length > 200 ||
      !["lobby", "playing", "ended"].includes(value.stage as string) || !integer(value.revision) ||
      !Array.isArray(value.seats) || value.seats.length > 6) return null;
  const seats = value.seats;
  if (seats.some(seat => !record(seat) || !validText(seat.playerId) || !validText(seat.seatId) || typeof seat.name !== "string" || seat.name.length > 200) ||
      new Set(seats.map(seat => seat.playerId)).size !== seats.length || new Set(seats.map(seat => seat.seatId)).size !== seats.length) return null;
  return { version: 1, id: value.id, hostPlayerId: value.hostPlayerId, hostConnectionId: value.hostConnectionId,
    hostName: value.hostName, stage: value.stage as TableSummary["stage"], revision: value.revision as number,
    seats: seats.map(seat => ({ playerId: seat.playerId, seatId: seat.seatId, name: seat.name })) };
}

export interface ControlReceipt { fingerprint: string; playerId: string; requestId: string }
/** Optional, private controller fields survive TableStore's structured clone.
 * Rule action receipts remain in GameState.accepted. */
export type ControllerRecord = SavedTable & { controller?: { receipts: ControlReceipt[] } };

export function validRecovery(value: SavedTable, roomId: string, summary: TableSummary): value is ControllerRecord {
  try {
    const table = tableSummary(value.table), game = value.game;
    if (!table || value.version !== 1 || value.roomId !== roomId || table.id !== summary.id || table.hostPlayerId !== summary.hostPlayerId ||
        !integer(value.serial) || value.serial < 1 || table.revision < summary.revision) return false;
    const control = (value as ControllerRecord).controller;
    if (control !== undefined && (!record(control) || !Array.isArray(control.receipts) || control.receipts.length > 128 ||
        control.receipts.some(receipt => !record(receipt) || !validText(receipt.playerId) || !validText(receipt.requestId, 64) || !validText(receipt.fingerprint, 8192)))) return false;
    if (!game) return table.stage === "lobby";
    if (game.version !== 1 || !validText(game.id) || !integer(game.revision) || !["ante", "play", "resolve", "ended", "adjudication"].includes(game.stage) ||
        game.seats.length < 2 || game.seats.length > 6 || game.seats.length !== table.seats.length ||
        game.seats.some((seat, i) => seat.id !== table.seats[i].seatId) || checkInvariants(game).length ||
        !integer(game.stakes) || !integer(game.hole) || table.stage !== gameStage(game)) return false;
    const held = game.seats.flatMap(seat => [...seat.hand, ...seat.flight.map(item => item.cardId)]);
    const pending = game.pending && ["seer-keep", "sorcerer"].includes(game.pending.task.kind) ? game.pending.task.ids ?? [] : [];
    const reserved = game.queue.filter(task => task.kind === "sorcerer-ante").flatMap(task => task.ids ?? []);
    const cards = [...game.deck, ...game.discard, ...game.ante, ...Object.values(game.committed), ...held, ...pending, ...reserved];
    if (cards.length !== 80 || game.excluded.length !== 20 || new Set([...cards, ...game.excluded]).size !== 100 ||
        [...cards, ...game.excluded].some(id => !CARDS.some(card => card.id === id)) || STANDARD_CARDS.some(card => !cards.includes(card.id))) return false;
    return game.seats.reduce((sum, seat) => sum + seat.gold, game.stakes + game.hole) === game.seats.length * game.seats.length * 10;
  } catch { return false; }
}

export function gameStage(game: GameState | null): TableSummary["stage"] { return !game ? "lobby" : game.stage === "ended" ? "ended" : "playing"; }
