import { CARDS, STANDARD_CARDS, checkInvariants, parseVariant, sameVariant } from "./rules";
import type { GameState, PublicReplayFrame } from "./rules";
import type { SavedTable } from "./store";
import type { TableSummary } from "./protocol";

export const validText = (value: unknown, max = 160): value is string => typeof value === "string" && value.length > 0 && value.length <= max;
export const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const integer = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0;
const cardId = (value: unknown) => typeof value === "string" && CARDS.some(card => card.id === value);
const cardIds = (value: unknown, max = 100) => Array.isArray(value) && value.length <= max && value.every(cardId);
const seatRef = (value: unknown, seatIds: Set<string>) => value === null || value === undefined || typeof value === "string" && seatIds.has(value);

/** Validate the intentionally lossy public state attached to a history event.
 * This is shared by save recovery and paged history receipts so a frame can
 * never turn into a second private-hand channel. */
export function validPublicReplayFrame(value: unknown, seatIds: Set<string>): value is PublicReplayFrame {
  if (!record(value) || !["ante", "play", "resolve", "ended", "adjudication", "choice"].includes(value.phase as string) ||
      !integer(value.gambit) || (value.gambit as number) < 1 || !integer(value.round) || !integer(value.stakes) || !integer(value.hole) || !integer(value.deckCount) ||
      !seatRef(value.leaderSeatId, seatIds) || !seatRef(value.activeSeatId, seatIds) || !Array.isArray(value.waitingSeatIds) || value.waitingSeatIds.some(id => typeof id !== "string" || !seatIds.has(id)) ||
      !cardIds(value.ante) || !cardIds(value.discard, 12) || !integer(value.discardCount) || (value.discardCount as number) < (value.discard as unknown[]).length || !cardIds(value.revealed) || !Array.isArray(value.seats) || value.seats.length !== seatIds.size ||
      !Array.isArray(value.resolutionStack) || value.resolutionStack.length > 128 || !Array.isArray(value.winners) || value.winners.length > seatIds.size || value.winners.some(id => typeof id !== "string" || !seatIds.has(id)) || !Array.isArray(value.effects) ||
      value.issue !== null && value.issue !== undefined && !validText(value.issue, 128)) return false;
  const origins = value.anteOrigins;
  if (origins !== undefined && (!Array.isArray(origins) || origins.length > seatIds.size || origins.some(origin => !record(origin) || typeof origin.seatId !== "string" || !seatIds.has(origin.seatId) || !cardId(origin.cardId)) ||
      new Set(origins.map(origin => origin.cardId)).size !== origins.length || new Set(origins.map(origin => origin.seatId)).size !== origins.length)) return false;
  if (value.seats.some(seat => !record(seat) || typeof seat.id !== "string" || !seatIds.has(seat.id) || typeof seat.name !== "string" || seat.name.length > 200 ||
      !integer(seat.gold) || !integer(seat.debt) || !integer(seat.handCount) || (seat.handCount as number) > 10 || !integer(seat.strength) || !integer(seat.scoringStrength) ||
      typeof seat.committed !== "boolean" || typeof seat.archmage !== "boolean" || !Array.isArray(seat.flight) || seat.flight.length > 10 ||
      seat.flight.some(flight => !record(flight) || !cardId(flight.cardId) || flight.wild !== undefined && typeof flight.wild !== "boolean" || flight.rider !== undefined && typeof flight.rider !== "boolean")) ||
      new Set(value.seats.map(seat => seat.id)).size !== value.seats.length) return false;
  if (value.choice !== null && (!record(value.choice) || !validText(value.choice.id, 128) || !seatIds.has(value.choice.seatId as string) || !validText(value.choice.code, 128) ||
      value.choice.sourceCardId !== undefined && !cardId(value.choice.sourceCardId) || value.choice.beneficiarySeatId !== undefined && !seatIds.has(value.choice.beneficiarySeatId as string))) return false;
  if (value.resolutionStack.some(step => !record(step) || !validText(step.id, 128) || !validText(step.kind, 128) || !["active", "queued"].includes(step.status as string) ||
      step.seatId !== undefined && !seatIds.has(step.seatId as string) || step.targetSeatId !== undefined && !seatIds.has(step.targetSeatId as string) ||
      step.sourceCardId !== undefined && !cardId(step.sourceCardId) || step.amount !== undefined && !Number.isSafeInteger(step.amount) || step.code !== undefined && !validText(step.code, 128))) return false;
  if (value.effects.some(effect => !record(effect) || !["druid", "priest", "merchant", "warlord", "monarch", "dracolich"].includes(effect.kind as string) || !seatIds.has(effect.seatId as string) || effect.sourceCardId !== undefined && !cardId(effect.sourceCardId))) return false;
  if (value.lastGambit !== null) {
    const result = value.lastGambit;
    if (!record(result) || !integer(result.number) || !validText(result.reason, 128) || !Array.isArray(result.winners) || result.winners.some(id => typeof id !== "string" || !seatIds.has(id)) ||
        !record(result.strengths) || Object.entries(result.strengths).some(([id, strength]) => !seatIds.has(id) || !Number.isSafeInteger(strength) || (strength as number) < 0) || !integer(result.stakes)) return false;
  }
  return true;
}

/** Metadata is public, so validate its shape before using it as an authority. */
export function tableSummary(value: unknown): TableSummary | null {
  if (!record(value) || value.version !== 1 || !validText(value.id) || !validText(value.hostPlayerId) ||
      !validText(value.hostConnectionId) || typeof value.hostName !== "string" || value.hostName.length > 200 ||
      !["lobby", "playing", "ended"].includes(value.stage as string) || !integer(value.revision) ||
      !Array.isArray(value.seats) || value.seats.length > 6) return null;
  const seats = value.seats;
  if (seats.some(seat => !record(seat) || !validText(seat.playerId) || !validText(seat.seatId) || typeof seat.name !== "string" || seat.name.length > 200) ||
      new Set(seats.map(seat => seat.playerId)).size !== seats.length || new Set(seats.map(seat => seat.seatId)).size !== seats.length) return null;
  if (value.variant !== undefined && !parseVariant(value.variant)) return null;
  return { version: 1, id: value.id, hostPlayerId: value.hostPlayerId, hostConnectionId: value.hostConnectionId,
    hostName: value.hostName, stage: value.stage as TableSummary["stage"], revision: value.revision as number,
    seats: seats.map(seat => ({ playerId: seat.playerId, seatId: seat.seatId, name: seat.name })),
    ...(value.variant === undefined ? {} : { variant: parseVariant(value.variant)! }) };
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
    if (game.variant !== undefined && !parseVariant(game.variant)) return false;
    if (table.variant !== undefined && game.variant !== undefined && !sameVariant(table.variant, game.variant)) return false;
    if (game.version !== 1 || !validText(game.id) || !integer(game.revision) || !["ante", "play", "resolve", "ended", "adjudication"].includes(game.stage) ||
        game.seats.length < 2 || game.seats.length > 6 || game.seats.length !== table.seats.length ||
        game.seats.some((seat, i) => seat.id !== table.seats[i].seatId) || checkInvariants(game).length ||
        !integer(game.stakes) || !integer(game.hole) || table.stage !== gameStage(game)) return false;
    if (game.historyComplete !== undefined && typeof game.historyComplete !== "boolean") return false;
    if (game.history !== undefined) {
      if (!Array.isArray(game.history)) return false;
      let previousSequence = 0;
      for (const entry of game.history) {
        if (!record(entry) || !integer(entry.sequence) || entry.sequence < 1 || entry.sequence <= previousSequence ||
            !integer(entry.revision) || entry.revision > game.revision || !["ante", "play", "resolve", "ended", "adjudication", "choice"].includes(entry.phase as string) ||
            !integer(entry.gambit) || entry.gambit < 1 || !integer(entry.round) ||
            (entry.activeSeatId !== null && entry.activeSeatId !== undefined && !game.seats.some(seat => seat.id === entry.activeSeatId)) ||
            !record(entry.event) || !validText(entry.event.code, 128) ||
            (entry.event.seatId !== undefined && !game.seats.some(seat => seat.id === entry.event.seatId)) ||
            (entry.event.targetSeatId !== undefined && !game.seats.some(seat => seat.id === entry.event.targetSeatId)) ||
            (entry.event.cardIds !== undefined && (!Array.isArray(entry.event.cardIds) || entry.event.cardIds.some(id => !CARDS.some(card => card.id === id)))) ||
            (entry.event.amount !== undefined && !Number.isSafeInteger(entry.event.amount)) ||
            (entry.frame !== undefined && !validPublicReplayFrame(entry.frame, new Set(game.seats.map(seat => seat.id))))) return false;
        previousSequence = entry.sequence;
      }
      if (game.historyComplete === true && game.history.length > 0 && game.history[0].sequence !== 1) return false;
    }
    const held = game.seats.flatMap(seat => [...seat.hand, ...seat.flight.map(item => item.cardId)]);
    if (game.anteOrigins !== undefined && (!Array.isArray(game.anteOrigins) || game.anteOrigins.length > game.seats.length ||
        game.anteOrigins.some(origin => !record(origin) || !game.seats.some(seat => seat.id === origin.seatId) || !CARDS.some(card => card.id === origin.cardId)) ||
        new Set(game.anteOrigins.map(origin => origin.cardId)).size !== game.anteOrigins.length ||
        new Set(game.anteOrigins.map(origin => origin.seatId)).size !== game.anteOrigins.length)) return false;
    const pending = game.pending && ["seer-keep", "sorcerer"].includes(game.pending.task.kind) ? game.pending.task.ids ?? [] : [];
    const reserved = game.queue.filter(task => task.kind === "sorcerer-ante").flatMap(task => task.ids ?? []);
    const cards = [...game.deck, ...game.discard, ...game.ante, ...Object.values(game.committed), ...held, ...pending, ...reserved];
    if (cards.length !== 80 || game.excluded.length !== 20 || new Set([...cards, ...game.excluded]).size !== 100 ||
        [...cards, ...game.excluded].some(id => !CARDS.some(card => card.id === id)) || STANDARD_CARDS.some(card => !cards.includes(card.id))) return false;
    const count=game.seats.length,budget=game.initialGold??count*count*10;
    // The budget must stay a sane total. Its divisibility by the seat count
    // only holds for an untouched starting configuration, and a host-side table
    // edit deliberately moves it, so the sum below is the law that still holds.
    if(!Number.isSafeInteger(budget)||budget<count*10||budget>count*1000000)return false;
    return game.seats.reduce((sum, seat) => sum + seat.gold, game.stakes + game.hole) === budget;
  } catch { return false; }
}

export function gameStage(game: GameState | null): TableSummary["stage"] { return !game ? "lobby" : game.stage === "ended" ? "ended" : "playing"; }
