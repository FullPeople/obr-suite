import { GESTURE_INTERVAL_MS, isClearGesture, readHandGesture, type HandGesture } from "./gesture";
import { createPrivateIdentity, PrivateLink } from "./private-channel";
import type { KeyHello, PrivateIdentity } from "./private-channel";
import { TableStore } from "./store";
import type { SavedTable } from "./store";
import { applyAction, createGame, projectPublic, projectSeat } from "./rules";
import type { GameAction, GameState, PublicView, SeatView } from "./rules";
import { packPublic, packSeat, unpackPublic, unpackSeat } from "./wire";
import type { PublicWire, SeatWire } from "./wire";
import type { ActionReceipt, TableCommand, TableSummary, TableView } from "./protocol";
import { sdkTablePlatform } from "./controller-platform";
import type { ControllerPlatform, TableMember } from "./controller-platform";
import { gameStage, record, tableSummary, validRecovery, validText } from "./controller-validation";
import type { ControllerRecord } from "./controller-validation";

export interface ControllerStorage {
  load(roomId: string, tableId: string): Promise<SavedTable | null>;
  save(value: SavedTable, expectedSerial: number | null): Promise<SavedTable>;
  close(): Promise<void>;
}
export interface ControllerOptions {
  onGesture?(seatId: string, gesture: HandGesture | null): void;
  platform?: ControllerPlatform;
  storage?: ControllerStorage;
  retryMs?: number;
  heartbeatMs?: number;
  timeoutMs?: number;
  creationSettleMs?: number;
}
type RemoteCommand = Exclude<TableCommand, { type: "create" | "retry" | "close" }>;
interface Request { kind: "command"; requestId: string; command: RemoteCommand; tableId: string; tableRevision: number; gameId: string | null }
interface PendingRequest { request: Request; at: number; attempts: number; busy: boolean }
interface Receipt { requestId: string; ok: boolean; error?: string }
interface LocalActionRetry { tableId: string; gameId: string; action: GameAction }
interface Offer { kind: "hello-reply"; version: 1; tableId: string; to: string; requestId: string; sessionId: string; hello: KeyHello }
interface Session { link: PrivateLink; sessionId: string; requestId: string; at: number; offer?: Offer }
interface PendingHostSession { requestId: string; sessionId: string; at: number; offer?: Offer; link?: PrivateLink }
interface GestureEnvelope { kind: "gesture"; version: 1; tableId: string; tableRevision: number; playerId: string; seatId: string; gesture: HandGesture }
interface ReceivedGesture { envelope: GestureEnvelope; sequence: number; at: number; pending: boolean; timer?: ReturnType<typeof setTimeout> }
const clone = <T>(value: T): T => structuredClone(value);
const errorCode = (error: unknown, fallback = "requestFailed") => error instanceof Error &&
  ["storageFailed", "staleTable", "roomFull", "recoveryMissing", "protocolMismatch"].includes(error.message) ? error.message : fallback;
const transient = (code: string) => ["storageFailed", "roomFull", "requestFailed", "hostOffline", "privateSync"].includes(code);
// Same fields as the rules engine's idempotency fingerprint; never projected.
const actionFingerprint = (action: GameAction) => JSON.stringify([action.seatId, action.revision, action.kind, action.cardId ?? null, action.choiceId ?? null, action.optionIds ?? null]);

/** Owns the table for the lifetime of the background extension, not its panel.
 * Ports are injectable for multi-instance tests; production uses SDK + IDB. */
export class TableController {
  private platform!: ControllerPlatform;
  private storage: ControllerStorage;
  private running = false;
  private ready = false;
  private epoch = 0;
  private tableEpoch = 0;
  private roomRead = 0;
  private selfRead = 0;
  private partyRead = 0;
  private disposers: (() => void)[] = [];
  private timer?: ReturnType<typeof setTimeout>;
  private work: Promise<void> = Promise.resolve();
  private queued = 0;
  private self: TableMember = { id: "", connectionId: "", name: "" };
  private players: TableMember[] = [];
  private summary: TableSummary | null = null;
  private incompatible = false;
  private saved: ControllerRecord | null = null;
  private dirty = false;
  private recovering = false;
  private resetSerial: number | null | undefined;
  private identity?: Promise<PrivateIdentity>;
  private active = new Map<string, Session>();
  private hostPending = new Map<string, PendingHostSession[]>();
  private seenHello = new Map<string, string[]>();
  private hello?: { requestId: string; at: number; attempts: number; deriving: boolean; candidate?: Session };
  private game: PublicView | SeatView | null = null;
  private gameTableRevision = -1;
  private pending?: PendingRequest;
  private actionReceipt?: ActionReceipt;
  private actionResults = new Map<string, { fingerprint: string; receipt: ActionReceipt }>();
  private actionRetry?: { key: string; promise: Promise<void> };
  private message: string | undefined;
  private lastPulse = 0;
  private gestureReceived = new Map<string, ReceivedGesture>();
  private gestureSentAt = -Infinity;
  private gestureSequence = 0;
  private gesturePending?: GestureEnvelope;
  private gestureLast?: GestureEnvelope;
  private gestureTimer?: ReturnType<typeof setTimeout>;
  private gestureFlush?: Promise<void>;
  private gestureResolve?: () => void;
  private creation?: { id: string; contenders: Map<string, string> };
  private readonly retryMs: number;
  private readonly heartbeatMs: number;
  private readonly timeoutMs: number;

  constructor(private changed: (view: TableView) => void, private options: ControllerOptions = {}) {
    this.storage = options.storage ?? new TableStore();
    this.retryMs = options.retryMs ?? 3000;
    this.heartbeatMs = options.heartbeatMs ?? 12000;
    this.timeoutMs = options.timeoutMs ?? 24000;
  }
  get view(): TableView {
    const table = this.saved && this.summary?.id === this.saved.table.id && this.saved.table.hostConnectionId === this.self.connectionId ? this.saved.table : this.summary;
    const host = !!table && table.hostPlayerId === this.self.id;
    const connected = this.connected();
    const session = this.summary && this.active.get(this.summary.hostConnectionId);
    const syncing = !connected && !this.incompatible && (this.serving() ||
      !!session && Date.now() - session.at < this.timeoutMs && !!this.summary && this.present(this.summary.hostConnectionId, this.summary.hostPlayerId));
    return clone({ actionReceiptVersion: 1 as const, table, selfPlayerId: this.self.id, isHost: host, connected,
      syncing,
      pending: !!this.creation || this.recovering || !!this.pending?.busy,
      game: this.game, ...(this.actionReceipt ? { actionReceipt: this.actionReceipt } : {}), ...(this.message ? { message: this.message } : {}) });
  }
  private connected(): boolean {
    const connection = this.summary && this.active.get(this.summary.hostConnectionId);
    return this.ready && !this.incompatible && !this.summary || this.serving() && !this.dirty ||
      !!connection && Date.now() - connection.at < this.timeoutMs && this.gameTableRevision >= (this.summary?.revision ?? 0);
  }
  private emit(): void { this.pruneGestures(); if (this.running) this.changed(this.view); }
  private fail(code: string): void { this.message = code; this.emit(); }
  private alive(epoch: number, tableEpoch?: number): boolean { return this.running && this.epoch === epoch && (tableEpoch === undefined || this.tableEpoch === tableEpoch); }
  private member(connection: string): TableMember | undefined { return this.self.connectionId === connection ? this.self : this.players.find(player => player.connectionId === connection); }
  private present(connection: string, playerId: string): boolean { return this.member(connection)?.id === playerId; }
  private serving(): boolean {
    return !!this.saved && !!this.summary && this.summary.id === this.saved.table.id && this.summary.hostPlayerId === this.self.id &&
      this.summary.hostConnectionId === this.self.connectionId && this.saved.table.hostConnectionId === this.self.connectionId && !this.recovering;
  }
  private canClaim(): boolean {
    return !!this.summary && this.summary.hostPlayerId === this.self.id &&
      (this.summary.hostConnectionId === this.self.connectionId || !this.present(this.summary.hostConnectionId, this.summary.hostPlayerId));
  }
  private enqueue(job: () => Promise<void>): Promise<void> {
    if (this.queued >= 64) return Promise.resolve();
    this.queued++;
    const epoch = this.epoch;
    const next = this.work.then(async () => { if (this.alive(epoch)) await job(); });
    this.work = next.catch(error => { if (this.alive(epoch)) this.fail(errorCode(error)); }).finally(() => { this.queued--; });
    return this.work;
  }
  private resetLinks(): void {
    this.tableEpoch++;
    for (const session of this.active.values()) session.link.dispose();
    for (const sessions of this.hostPending.values()) for (const session of sessions) session.link?.dispose();
    this.hello?.candidate?.link.dispose();
    this.active.clear(); this.hostPending.clear(); this.seenHello.clear(); this.hello = undefined; this.identity = undefined;
    this.lastPulse = 0; this.resetGestures();
  }
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true; this.ready = false; const epoch = ++this.epoch;
    try {
      this.platform = this.options.platform ?? await sdkTablePlatform();
      if (!this.alive(epoch)) return;
      const readRoom = ++this.roomRead, readSelf = ++this.selfRead, readParty = ++this.partyRead;
      this.disposers = [
        this.platform.onTable(value => { if (this.alive(epoch)) { this.roomRead++; this.observe(value); } }),
        this.platform.onPlayers(players => { if (this.alive(epoch)) { this.partyRead++; this.players = players; this.membersChanged(); } }),
        this.platform.onSelf(player => { if (this.alive(epoch)) { this.selfRead++; this.setSelf(player); } }),
        this.platform.onMessage((data, sender) => { if (this.alive(epoch)) void this.receive(data, sender).catch(() => {}); }),
      ];
      const [self, players, summary] = await Promise.all([this.platform.self(), this.platform.players(), this.platform.readTable()]);
      if (!this.alive(epoch)) return;
      if (readSelf === this.selfRead) this.setSelf(self);
      if (readParty === this.partyRead) this.players = players;
      if (readRoom === this.roomRead) this.observe(summary);
      this.ready = true;
      await this.enqueue(() => this.reconcile()); this.emit(); this.schedule();
    } catch (error) { if (this.alive(epoch)) this.fail(errorCode(error)); }
  }
  async stop(): Promise<void> {
    if (!this.running) return;
    await this.clearGesture();
    this.running = false; this.ready = false; this.epoch++; this.roomRead++; this.selfRead++; this.partyRead++;
    if (this.timer) clearTimeout(this.timer); this.timer = undefined;
    for (const dispose of this.disposers.splice(0)) dispose();
    this.resetLinks(); this.creation = undefined; this.pending = undefined; this.actionReceipt = undefined; this.actionResults.clear(); this.actionRetry = undefined;
    await this.work; await this.storage.close();
    this.saved = null; this.summary = null; this.game = null; this.recovering = false; this.dirty = false; this.gameTableRevision = -1;
  }
  private setSelf(player: TableMember): void {
    if (!validText(player.id) || !validText(player.connectionId)) return;
    if (this.self.id && (this.self.id !== player.id || this.self.connectionId !== player.connectionId)) {
      this.actionReceipt = undefined;
      this.actionResults.clear(); this.actionRetry = undefined;
      this.resetLinks(); this.saved = null; this.resetSerial = undefined; this.game = null; this.gameTableRevision = -1;
      if (this.self.id !== player.id) this.pending = undefined;
    }
    this.self = { id: player.id, connectionId: player.connectionId, name: player.name.slice(0, 200) };
    this.membersChanged();
  }
  private observe(value: unknown): void {
    if (!this.running) return;
    const next = value === undefined || value === null ? null : tableSummary(value);
    if (value != null && !next) { this.incompatible = true; this.resetLinks(); this.saved = null; this.game = null; this.pending = undefined; this.actionReceipt = undefined; this.actionResults.clear(); this.actionRetry = undefined; this.fail("protocolMismatch"); return; }
    this.incompatible = false;
    if (next && this.summary?.id === next.id && next.revision < this.summary.revision) return;
    const changed = next?.id !== this.summary?.id || next?.hostConnectionId !== this.summary?.hostConnectionId;
    if (changed) {
      const sameTable = next?.id === this.summary?.id;
      this.resetLinks(); this.saved = null; this.resetSerial = undefined;
      if (!sameTable) { this.game = null; this.gameTableRevision = -1; this.pending = undefined; this.actionReceipt = undefined; this.actionResults.clear(); this.actionRetry = undefined; }
      else if (this.pending) this.pending.busy = false;
    }
    this.summary = next;
    if (!next) this.message = undefined;
    void this.enqueue(() => this.reconcile()); this.emit(); this.schedule();
  }
  private membersChanged(): void {
    if (!this.running) return;
    for (const [connection, session] of this.active) if (!this.member(connection)) { session.link.dispose(); this.active.delete(connection); }
    for (const [connection, sessions] of this.hostPending) if (!this.member(connection)) { sessions.forEach(session => session.link?.dispose()); this.hostPending.delete(connection); this.seenHello.delete(connection); }
    if (this.summary && !this.present(this.summary.hostConnectionId, this.summary.hostPlayerId)) {
      this.hello?.candidate?.link.dispose(); this.hello = undefined;
      if (this.pending) this.pending.busy = false;
      this.message = "hostOffline";
    }
    void this.enqueue(() => this.reconcile()); this.emit();
  }
  private async reconcile(): Promise<void> {
    if (!this.summary || !this.self.id || this.incompatible) return;
    if (this.canClaim()) {
      if (!this.saved && !this.recovering) await this.recover();
      if (this.saved) { this.updateHostView(); if (this.dirty) await this.publish(); }
    } else if (this.present(this.summary.hostConnectionId, this.summary.hostPlayerId)) {
      if (!this.active.has(this.summary.hostConnectionId) && !this.hello) await this.handshake();
    } else this.fail("hostOffline");
  }
  private async recover(): Promise<void> {
    const summary = this.summary!;
    this.resetLinks();
    const epoch = this.epoch, tableEpoch = this.tableEpoch;
    this.recovering = true; this.message = "connecting"; this.emit();
    try {
      const loaded = await this.storage.load(this.platform.roomId, summary.id);
      if (!this.alive(epoch, tableEpoch) || !this.canClaim()) return;
      this.resetSerial = loaded?.serial ?? null;
      if (!loaded || !validRecovery(loaded, this.platform.roomId, summary)) throw Error("recoveryMissing");
      if (loaded.table.hostConnectionId !== this.self.connectionId && this.present(loaded.table.hostConnectionId, loaded.table.hostPlayerId)) { this.fail("hostOffline"); return; }
      let saved = loaded;
      if (loaded.table.hostConnectionId !== this.self.connectionId) {
        saved = await this.storage.save({ ...loaded, table: { ...loaded.table, hostConnectionId: this.self.connectionId, hostName: this.self.name, revision: loaded.table.revision + 1 } }, loaded.serial) as ControllerRecord;
      }
      if (!this.alive(epoch, tableEpoch) || !this.canClaim()) return;
      this.saved = saved; this.dirty = saved.table.revision !== summary.revision || saved.table.hostConnectionId !== summary.hostConnectionId;
      // Make our own metadata callback recognize the recovered connection as
      // the same authority. Other clients still see a normal connection change.
      if (saved.table.hostConnectionId !== summary.hostConnectionId) this.summary = { ...summary, hostConnectionId: saved.table.hostConnectionId };
      this.message = undefined;
      if (this.dirty) await this.publish();
      this.updateHostView();
    } catch (error) { if (this.alive(epoch, tableEpoch)) this.fail(errorCode(error, "recoveryMissing")); }
    finally { if (this.alive(epoch, tableEpoch)) { this.recovering = false; this.emit(); } }
  }
  private updateHostView(): void {
    if (!this.saved) return;
    const seat = this.saved.table.seats.find(seat => seat.playerId === this.self.id);
    this.adoptGame(!this.saved.game ? null : seat ? projectSeat(this.saved.game, seat.seatId) : projectPublic(this.saved.game), this.saved.table.revision);
    this.emit();
  }
  /** Only an authoritative projection invalidates an old game's outstanding
   * action. A temporary disconnect may still recover and retry that action. */
  private adoptGame(game: PublicView | SeatView | null, tableRevision: number): void {
    if (this.game?.id !== game?.id) { this.actionResults.clear(); this.actionRetry = undefined; }
    if (this.actionReceipt && this.actionReceipt.gameId !== game?.id) this.actionReceipt = undefined;
    if (this.pending?.request.command.type === "action" && this.pending.request.gameId !== game?.id) this.pending = undefined;
    this.game = game; this.gameTableRevision = tableRevision;
  }
  /** Save precedes publication. A failed metadata write leaves this exact saved
   * result dirty and retryable; it never rolls back or deals another game. */
  private async publish(): Promise<void> {
    if (!this.saved || !this.canClaim()) throw Error("staleTable");
    const saved = this.saved, epoch = this.epoch, tableEpoch = this.tableEpoch;
    try {
      const before = tableSummary(await this.platform.readTable());
      if (!this.alive(epoch, tableEpoch)) return;
      const initialLobby = !before && !saved.game && saved.table.revision === 1;
      if (!initialLobby && (!before || before.id !== saved.table.id || before.hostPlayerId !== this.self.id ||
          (before.hostConnectionId !== this.self.connectionId && this.present(before.hostConnectionId, before.hostPlayerId)) ||
          before.revision > saved.table.revision)) {
        this.observe(before); throw Error("staleTable");
      }
      await this.platform.writeTable(clone(saved.table));
      if (!this.alive(epoch, tableEpoch)) return;
      const value = tableSummary(await this.platform.readTable());
      if (!this.alive(epoch, tableEpoch)) return;
      if (!value || value.id !== saved.table.id || value.hostConnectionId !== this.self.connectionId || value.revision > saved.table.revision) { this.observe(value); throw Error("staleTable"); }
      this.summary = value; this.dirty = value.revision !== saved.table.revision;
      if (this.dirty) throw Error("roomFull");
      this.message = undefined; this.updateHostView();
    } catch (error) { if (this.alive(epoch, tableEpoch)) { this.dirty = true; this.message = errorCode(error); this.emit(); } throw error; }
  }
  private key(): Promise<PrivateIdentity> { return this.identity ??= createPrivateIdentity().catch(error => { this.identity = undefined; throw error; }); }
  private async send(session: Session, value: unknown): Promise<void> {
    const epoch = this.epoch, tableEpoch = this.tableEpoch;
    const packets = await session.link.seal(value);
    for (const packet of packets) { if (!this.alive(epoch, tableEpoch)) return; await this.platform.send(packet); }
  }
  private async handshake(): Promise<void> {
    if (!this.summary || this.canClaim() || !this.present(this.summary.hostConnectionId, this.summary.hostPlayerId)) return;
    const epoch = this.epoch, tableEpoch = this.tableEpoch;
    const hello = { requestId: crypto.randomUUID(), at: Date.now(), attempts: 0, deriving: false };
    this.hello?.candidate?.link.dispose(); this.hello = hello;
    this.message = "privateSync"; this.emit();
    const identity = await this.key();
    if (!this.alive(epoch, tableEpoch) || this.hello !== hello) return;
    await this.sendHello(identity);
  }
  private async sendHello(identity?: PrivateIdentity): Promise<void> {
    if (!this.hello || !this.summary) return;
    const hello = this.hello, epoch = this.epoch, tableEpoch = this.tableEpoch;
    const own = identity ?? await this.key();
    if (!this.alive(epoch, tableEpoch) || this.hello !== hello) return;
    hello.at = Date.now(); hello.attempts++;
    await this.platform.send({ kind: "hello", version: 1, tableId: this.summary.id, requestId: hello.requestId, hello: own.hello });
  }
  private async hostHello(data: Record<string, unknown>, sender: string): Promise<void> {
    if (!this.serving() || !validText(data.requestId, 64) || !record(data.hello)) return;
    const epoch = this.epoch, tableEpoch = this.tableEpoch, requestId = data.requestId;
    const active = this.active.get(sender), pending = this.hostPending.get(sender) ?? [];
    const existing = active?.requestId === requestId ? active : pending.find(session => session.requestId === requestId);
    if (existing) { if (existing.offer) await this.platform.send(existing.offer); return; }
    if (pending.filter(session => !session.link).length >= 2) return;
    const seen = this.seenHello.get(sender) ?? [];
    if (seen.includes(requestId)) return;
    seen.push(requestId); if (seen.length > 32) seen.shift(); this.seenHello.set(sender, seen);
    const candidate: PendingHostSession = { requestId, sessionId: crypto.randomUUID(), at: Date.now() };
    pending.push(candidate); if (pending.length > 2) pending.shift()?.link?.dispose(); this.hostPending.set(sender, pending);
    try {
      const own = await this.key();
      const link = await PrivateLink.create({ roomId: this.platform.roomId, tableId: this.summary!.id, sessionId: candidate.sessionId, localConnectionId: this.self.connectionId, remoteConnectionId: sender }, own, data.hello as unknown as KeyHello);
      if (!this.alive(epoch, tableEpoch) || !this.serving() || !this.member(sender) || !this.hostPending.get(sender)?.includes(candidate)) { link.dispose(); return; }
      candidate.link = link;
      candidate.offer = { kind: "hello-reply", version: 1, tableId: this.summary!.id, to: sender, requestId, sessionId: candidate.sessionId, hello: own.hello };
      await this.platform.send(candidate.offer);
    } catch { candidate.link?.dispose(); this.hostPending.set(sender, (this.hostPending.get(sender) ?? []).filter(value => value !== candidate)); }
  }
  private async clientOffer(data: Record<string, unknown>, sender: string): Promise<void> {
    const hello = this.hello;
    if (!hello || !this.summary || sender !== this.summary.hostConnectionId || data.to !== this.self.connectionId || data.requestId !== hello.requestId ||
        !validText(data.sessionId) || !record(data.hello) || hello.deriving) return;
    if (hello.candidate) { if (hello.candidate.sessionId === data.sessionId) await this.send(hello.candidate, { kind: "sync", requestId: hello.requestId }); return; }
    hello.deriving = true; const epoch = this.epoch, tableEpoch = this.tableEpoch;
    try {
      const own = await this.key();
      const link = await PrivateLink.create({ roomId: this.platform.roomId, tableId: this.summary.id, sessionId: data.sessionId, localConnectionId: this.self.connectionId, remoteConnectionId: sender }, own, data.hello as unknown as KeyHello);
      if (!this.alive(epoch, tableEpoch) || this.hello !== hello) { link.dispose(); return; }
      hello.candidate = { link, sessionId: data.sessionId, requestId: hello.requestId, at: Date.now() };
      await this.send(hello.candidate, { kind: "sync", requestId: hello.requestId });
    } finally { if (this.hello === hello) hello.deriving = false; }
  }
  async gesture(value: unknown): Promise<void> {
    const gesture = readHandGesture(value);
    const seat = this.summary?.seats.find(s => s.playerId === this.self.id);
    const visible = this.game?.seats.find(s => s.id === seat?.seatId);
    if (!this.running || !this.connected() || !this.summary || !seat || !visible || !gesture || !this.game || !("selfSeatId" in this.game) || this.game.selfSeatId !== seat.seatId || gesture.gameId !== this.game.id ||
      gesture.revision !== this.game.revision || gesture.count !== visible.handCount) return;
    await this.queueGesture({ kind: "gesture", version: 1, tableId: this.summary.id, tableRevision: this.summary.revision,
      playerId: this.self.id, seatId: seat.seatId, gesture });
  }
  /** Close/page replacement clears even immediately after a hover. It waits
   * for the next 125 ms slot instead of being discarded by the rate limit. */
  async clearGesture(): Promise<void> {
    const previous = this.gesturePending ?? this.gestureLast;
    if (!this.running || !previous) return;
    if (isClearGesture(previous.gesture)) { if (this.gesturePending) await this.gestureFlush; return; }
    await this.queueGesture({ ...previous, gesture: { ...previous.gesture, hover: null, selected: [] } });
  }
  private queueGesture(envelope: GestureEnvelope): Promise<void> {
    this.gesturePending = envelope;
    // All events coalesced into this slot share one promise, not an unbounded
    // list of waiters supplied by arbitrary LOCAL messages.
    const result = this.gestureFlush ??= new Promise<void>(done => { this.gestureResolve = done; });
    if (!this.gestureTimer) {
      const delay = Math.max(0, GESTURE_INTERVAL_MS - (performance.now() - this.gestureSentAt));
      this.gestureTimer = setTimeout(() => { this.gestureTimer = undefined; void this.flushGesture(); }, Math.ceil(delay));
    }
    return result;
  }
  private async flushGesture(): Promise<void> {
    const remaining = GESTURE_INTERVAL_MS - (performance.now() - this.gestureSentAt);
    if (remaining > 0 && this.gesturePending) { this.gestureTimer = setTimeout(() => { this.gestureTimer = undefined; void this.flushGesture(); }, Math.ceil(remaining)); return; }
    const envelope = this.gesturePending, resolve = this.gestureResolve; this.gesturePending = undefined;
    this.gestureFlush = undefined; this.gestureResolve = undefined;
    try {
      if (!envelope || !this.gestureCurrent(envelope, this.self.connectionId)) return;
      // UI clocks/page instances are not a wire ordering authority.
      envelope.gesture = { ...envelope.gesture, sequence: this.gestureSequence = Math.max(this.gestureSequence + 1, Date.now()) };
      this.gestureLast = envelope;
      this.gestureSentAt = performance.now();
      await this.platform.send(envelope);
    } catch { /* Ephemeral gesture loss cannot affect the game or its saves. */ }
    finally { resolve?.(); }
  }
  private gestureCurrent(envelope: GestureEnvelope, connection: string): boolean {
    const member = this.member(connection), seat = this.summary?.seats.find(s => s.playerId === member?.id);
    const visible = this.game?.seats.find(s => s.id === seat?.seatId), g = envelope.gesture;
    return this.running && this.connected() && envelope.tableId === this.summary?.id && envelope.tableRevision === this.summary.revision &&
      member?.id === envelope.playerId && seat?.seatId === envelope.seatId && !!visible &&
      g.gameId === this.game?.id && g.revision === this.game.revision && g.count === visible.handCount;
  }
  private forgetGesture(connection: string): void {
    const entry = this.gestureReceived.get(connection); if (!entry) return;
    clearTimeout(entry.timer); this.gestureReceived.delete(connection);
    this.options.onGesture?.(entry.envelope.seatId, null);
  }
  private pruneGestures(): void {
    for (const [connection, entry] of this.gestureReceived) if (!this.gestureCurrent(entry.envelope, connection)) this.forgetGesture(connection);
    if (this.gesturePending && !this.gestureCurrent(this.gesturePending, this.self.connectionId)) this.cancelGestureSend();
    if (this.gestureLast && !this.gestureCurrent(this.gestureLast, this.self.connectionId)) this.gestureLast = undefined;
  }
  private cancelGestureSend(): void {
    clearTimeout(this.gestureTimer); this.gestureTimer = undefined; this.gesturePending = undefined;
    this.gestureResolve?.(); this.gestureResolve = undefined; this.gestureFlush = undefined;
  }
  private resetGestures(): void {
    this.cancelGestureSend(); this.gestureLast = undefined;
    for (const connection of this.gestureReceived.keys()) this.forgetGesture(connection);
  }
  private receiveGesture(value: Record<string, unknown>, sender: string): void {
    const gesture = readHandGesture(value.gesture);
    if (!gesture || !validText(value.playerId) || !validText(value.seatId) || !Number.isSafeInteger(value.tableRevision)) return;
    const envelope: GestureEnvelope = { kind: "gesture", version: 1, tableId: this.summary!.id, tableRevision: value.tableRevision as number,
      playerId: value.playerId, seatId: value.seatId, gesture };
    if (!this.gestureCurrent(envelope, sender)) return;
    let entry = this.gestureReceived.get(sender);
    if (entry && gesture.sequence <= entry.sequence) return;
    if (!entry) { entry = { envelope, sequence: gesture.sequence, at: -Infinity, pending: true }; this.gestureReceived.set(sender, entry); }
    else { entry.envelope = envelope; entry.sequence = gesture.sequence; entry.pending = true; }
    if (entry.timer) return;
    const received = entry;
    const deliver = () => {
      received.timer = undefined;
      if (this.gestureReceived.get(sender) !== received || !received.pending) return;
      if (!this.gestureCurrent(received.envelope, sender)) { this.forgetGesture(sender); return; }
      received.pending = false; received.at = performance.now();
      this.options.onGesture?.(received.envelope.seatId, received.envelope.gesture);
    };
    const delay = GESTURE_INTERVAL_MS - (performance.now() - received.at);
    if (delay <= 0) deliver(); else received.timer = setTimeout(deliver, Math.ceil(delay));
  }
  private async receive(value: unknown, sender: string): Promise<void> {
    if (!this.running || !record(value) || !this.member(sender) || sender === this.self.connectionId) return;
    if (value.kind === "claim" && value.version === 1 && this.creation && validText(value.tableId)) {
      const first = !this.creation.contenders.has(sender);
      this.creation.contenders.set(sender, value.tableId);
      if (first) await this.platform.send({ kind: "claim", version: 1, tableId: this.creation.id });
      return;
    }
    if (!this.summary || value.tableId !== this.summary.id) return;
    if (value.version !== 1) { if (sender === this.summary.hostConnectionId) this.fail("protocolMismatch"); return; }
    if (value.kind === "gesture") {
      this.receiveGesture(value, sender); return;
    }
    if (value.kind === "hello") { await this.hostHello(value, sender); return; }
    if (value.kind === "hello-reply") { await this.clientOffer(value, sender); return; }
    if (value.kind !== "private") return;
    const epoch = this.epoch, tableEpoch = this.tableEpoch;
    const active = this.active.get(sender);
    const pending = this.serving() ? this.hostPending.get(sender)?.find(session => session.sessionId === value.sessionId) : undefined;
    const offered = this.hello?.candidate;
    const candidate = sender === this.summary.hostConnectionId && offered?.sessionId === value.sessionId ? offered : undefined;
    const session = active?.sessionId === value.sessionId ? active : pending?.link ? { ...pending, link: pending.link } : candidate;
    if (!session) return;
    const payload = await session.link.receive(value, sender);
    if (!this.alive(epoch, tableEpoch) || !this.member(sender) || !record(payload)) return;
    if (this.serving()) {
      if (pending) {
        if (payload.kind !== "sync" || payload.requestId !== pending.requestId || !this.hostPending.get(sender)?.includes(pending)) return;
        active?.link.dispose(); this.active.set(sender, session);
        for (const other of this.hostPending.get(sender) ?? []) if (other !== pending) other.link?.dispose();
        this.hostPending.delete(sender);
      } else if (this.active.get(sender)?.link !== session.link) return;
      session.at = Date.now();
      if (payload.kind === "sync") { await this.enqueue(() => this.snapshot(sender)); return; }
      if (payload.kind === "pulse") return;
      if (payload.kind === "command") await this.enqueue(() => this.hostCommand(payload as unknown as Request, sender));
    } else if (sender === this.summary.hostConnectionId) {
      if (candidate) {
        if (payload.kind !== "snapshot" || payload.requestId !== candidate.requestId || this.hello?.candidate !== candidate) return;
        active?.link.dispose(); this.active.set(sender, candidate); this.hello = undefined;
      } else if (this.active.get(sender)?.link !== session.link) return;
      session.at = Date.now();
      if (payload.kind === "snapshot") this.acceptSnapshot(payload);
      else if (payload.kind === "receipt") this.acceptReceipt(payload as unknown as Receipt);
      else if (payload.kind === "pulse") {
        await this.send(session, { kind: "pulse" });
        if (payload.tableRevision !== this.gameTableRevision || payload.gameId !== (this.game?.id ?? null) || payload.gameRevision !== (this.game?.revision ?? null)) await this.send(session, { kind: "sync", requestId: session.requestId });
      }
    }
  }
  private async snapshot(connection: string, receipt?: Receipt): Promise<void> {
    const session = this.active.get(connection), member = this.member(connection), saved = this.saved;
    if (!session || !member || !saved || !this.serving() || this.dirty) return;
    const seat = saved.table.seats.find(seat => seat.playerId === member.id);
    const game = !saved.game ? null : seat ? packSeat(projectSeat(saved.game, seat.seatId)) : packPublic(projectPublic(saved.game));
    await this.send(session, { kind: "snapshot", requestId: session.requestId, table: saved.table, game, ...(receipt ? { receipt } : {}) });
  }
  private async broadcastViews(): Promise<void> { await Promise.allSettled([...this.active.keys()].map(connection => this.snapshot(connection))); }
  private acceptSnapshot(payload: Record<string, unknown>): void {
    const table = tableSummary(payload.table);
    if (!table || !this.summary || table.id !== this.summary.id || table.hostPlayerId !== this.summary.hostPlayerId || table.hostConnectionId !== this.summary.hostConnectionId) return;
    if (table.revision < this.summary.revision || table.revision < this.gameTableRevision) return;
    try {
      let game: PublicView | SeatView | null = null;
      const seat = table.seats.find(seat => seat.playerId === this.self.id);
      if (payload.game !== null) {
        if (!record(payload.game) || payload.game.version !== 1 || !validText(payload.game.id) || !Number.isSafeInteger(payload.game.revision)) throw Error("protocolMismatch");
        const wire = payload.game;
        if (seat) {
          if (wire.selfSeatId !== seat.seatId || !Array.isArray(wire.hand) || wire.hand.length > 10 || !Array.isArray(wire.actions)) throw Error("privateSync");
          game = unpackSeat(wire as unknown as SeatWire);
        } else { if ("hand" in wire || "actions" in wire || "selfSeatId" in wire) throw Error("protocolMismatch"); game = unpackPublic(wire as unknown as PublicWire); }
        if (game.seats.length !== table.seats.length || game.seats.some((member, index) => member.id !== table.seats[index].seatId)) throw Error("protocolMismatch");
        if (this.game?.id === game.id && game.revision < this.game.revision) return;
        if (this.game && this.game.id !== game.id && table.revision === this.gameTableRevision) return;
      } else if (table.stage !== "lobby" || (this.game && table.revision === this.gameTableRevision)) return;
      this.summary = table; this.adoptGame(game, table.revision); this.message = undefined;
      // Never acknowledge an action from a stale/invalid snapshot or emit its
      // receipt alongside the previous hand. Apply both in one local update.
      if (record(payload.receipt)) this.acceptReceipt(payload.receipt as unknown as Receipt, false);
      this.emit();
      if (this.pending && !this.pending.busy) void this.sendPending();
    } catch (error) { this.fail(error instanceof Error ? error.message : "protocolMismatch"); }
  }
  private acceptReceipt(receipt: Receipt, emit = true): void {
    if (!this.running || !this.pending || receipt.requestId !== this.pending.request.requestId || typeof receipt.ok !== "boolean") return;
    const request = this.pending.request;
    if (request.tableId !== this.summary?.id) return;
    if (request.command.type === "action") {
      const action = request.command.action;
      if (!request.gameId || request.gameId !== this.game?.id || (receipt.ok && this.game.revision < action.revision + 1)) return;
      const code = typeof receipt.error === "string" ? receipt.error : "requestFailed";
      this.actionReceipt = { actionId: action.id, tableId: request.tableId, gameId: request.gameId,
        revision: action.revision + (receipt.ok ? 1 : 0), ok: receipt.ok, source: "host",
        ...(!receipt.ok ? { code, retryable: transient(code) } : {}) };
      if (receipt.ok || !transient(code)) {
        this.actionResults.set(action.id, { fingerprint: actionFingerprint(action), receipt: clone(this.actionReceipt) });
        if (this.actionResults.size > 64) this.actionResults.delete(this.actionResults.keys().next().value!);
      }
    }
    if (receipt.ok) { this.pending = undefined; this.message = undefined; }
    else {
      const code = typeof receipt.error === "string" ? receipt.error : "requestFailed";
      if (transient(code)) this.pending.busy = false; else this.pending = undefined;
      this.message = code;
    }
    if (emit) this.emit();
  }
  private rejectLocalAction(retry: LocalActionRetry, code: string, retryable = false): void {
    this.actionReceipt = { actionId: retry.action.id, tableId: retry.tableId, gameId: retry.gameId,
      revision: retry.action.revision, ok: false, code, retryable, source: "local" };
    this.fail(code);
  }
  /** Recover a LOCAL delivery failure without guessing whether the original
   * command reached us. Existing pending requests and known host outcomes take
   * precedence over the current (possibly already advanced) game revision. */
  private async retryAction(retry: LocalActionRetry): Promise<void> {
    const fingerprint = actionFingerprint(retry.action), key = JSON.stringify([retry.tableId, retry.gameId, retry.action.id, fingerprint]);
    if (this.actionRetry?.key === key) { await this.actionRetry.promise; return; }
    const epoch = this.epoch;
    // Deferring one microtask installs the in-flight retry guard before any
    // synchronous host/LOCAL callbacks; duplicate clicks join the same work.
    const attempt = { key, promise: Promise.resolve().then(async () => {
      if (!this.alive(epoch)) return;
      const pending = this.pending;
      if (!pending) {
        const seat = this.summary?.seats.find(seat => seat.playerId === this.self.id);
        if (retry.tableId !== this.summary?.id || retry.gameId !== this.game?.id) { this.rejectLocalAction(retry, "staleTable"); return; }
        if (!seat || retry.action.seatId !== seat.seatId) { this.rejectLocalAction(retry, "notSeated"); return; }
        const known = this.actionResults.get(retry.action.id);
        if (known) {
          if (known.fingerprint !== fingerprint) { this.rejectLocalAction(retry, "ACTION_ID_CONFLICT"); return; }
          this.actionReceipt = clone(known.receipt); this.message = known.receipt.code; this.emit(); return;
        }
        if (retry.action.revision !== this.game!.revision) { this.rejectLocalAction(retry, "STALE_REVISION"); return; }
        await this.command({ type: "action", action: retry.action }); return;
      }
      const request = pending.request;
      if (request.command.type !== "action" || request.tableId !== retry.tableId || request.gameId !== retry.gameId || request.command.action.id !== retry.action.id) {
        this.rejectLocalAction(retry, "requestFailed"); return;
      }
      if (actionFingerprint(request.command.action) !== fingerprint) {
        // The original immutable request is still uncertain. A conflicting
        // retry must not turn it into a definite rejection or change its data.
        this.rejectLocalAction(retry, "ACTION_ID_CONFLICT", true); return;
      }
      this.message = undefined; pending.attempts = 0; pending.busy = false;
      await this.enqueue(async () => { await this.reconcile(); if (this.serving() && this.dirty) await this.publish(); });
      if (this.alive(epoch) && this.pending === pending) await this.sendPending();
    }) };
    this.actionRetry = attempt;
    try { await attempt.promise; } finally { if (this.actionRetry === attempt) this.actionRetry = undefined; }
  }
  async command(command: TableCommand): Promise<void> {
    if (!this.running || !record(command)) return;
    if (command.type === "retry" && (!this.self.id || !this.platform)) { await this.stop(); await this.start(); return; }
    if (!this.self.id) return;
    if (command.type === "close") return;
    if (command.type === "retry" && ("action" in command || "tableId" in command || "gameId" in command)) {
      if (!validText(command.tableId) || !validText(command.gameId) || !record(command.action) || !validText(command.action.id, 128) || !Number.isSafeInteger(command.action.revision)) {
        this.fail("invalidCommand"); return;
      }
      await this.retryAction({ tableId: command.tableId, gameId: command.gameId, action: clone(command.action) }); return;
    }
    if (command.type === "retry") {
      this.message = undefined;
      if (this.pending) { this.pending.attempts = 0; this.pending.busy = false; }
      await this.enqueue(async () => { await this.reconcile(); if (this.serving() && this.dirty) await this.publish(); });
      if (this.pending) await this.sendPending(); else if (this.summary && !this.canClaim()) await this.handshake();
      return;
    }
    if (this.pending) { this.fail("requestFailed"); return; }
    if (command.type === "action") this.actionReceipt = undefined;
    if (command.type === "create") { await this.enqueue(() => this.create()); return; }
    if (!["join", "leave", "start", "newGame", "action"].includes(command.type) || !this.summary) { this.fail("invalidCommand"); return; }
    if (command.type === "action") {
      const seat = this.summary.seats.find(seat => seat.playerId === this.self.id);
      if (!seat || !command.action || command.action.seatId !== seat.seatId || !this.game || command.action.revision !== this.game.revision) { this.fail("notSeated"); return; }
    }
    const request: Request = { kind: "command", requestId: crypto.randomUUID(), command: clone(command as RemoteCommand), tableId: this.summary.id, tableRevision: this.summary.revision, gameId: this.game?.id ?? null };
    this.pending = { request, at: 0, attempts: 0, busy: false };
    if (command.type === "newGame" && !this.saved && this.message === "recoveryMissing" && this.canClaim()) {
      this.pending.busy = true; this.pending.at = Date.now(); this.emit();
      await this.enqueue(() => this.resetMissingGame(request));
    } else await this.sendPending();
  }
  /** The UI confirms this destructive command. It returns to a fresh lobby
   * and never claims to recover the lost deck. Ordinary retry cannot call it. */
  private async resetMissingGame(request: Request): Promise<void> {
    if (!this.summary || !this.canClaim() || this.resetSerial === undefined || this.saved) return;
    const epoch = this.epoch, tableEpoch = this.tableEpoch, summary = this.summary;
    try {
      const observed = tableSummary(await this.platform.readTable());
      if (!this.alive(epoch, tableEpoch) || !this.canClaim()) return;
      if (!observed || observed.id !== summary.id || observed.revision !== summary.revision || observed.hostPlayerId !== this.self.id ||
          (observed.hostConnectionId !== this.self.connectionId && this.present(observed.hostConnectionId, observed.hostPlayerId))) throw Error("staleTable");
      const game = null;
      const table = { ...summary, hostConnectionId: this.self.connectionId, hostName: this.self.name, revision: summary.revision + 1, stage: gameStage(game) };
      const fingerprint = JSON.stringify([this.self.id, request.tableId, request.tableRevision, request.gameId, request.command]);
      const next: ControllerRecord = { version: 1, roomId: this.platform.roomId, table, game, serial: this.resetSerial ?? 0,
        controller: { receipts: [{ playerId: this.self.id, requestId: request.requestId, fingerprint }] } };
      const saved = await this.storage.save(next, this.resetSerial) as ControllerRecord;
      if (!this.alive(epoch, tableEpoch) || !this.canClaim()) return;
      this.saved = saved; this.summary = { ...summary, hostConnectionId: this.self.connectionId }; this.dirty = true;
      this.updateHostView(); await this.publish();
      this.acceptReceipt({ requestId: request.requestId, ok: true });
    } catch (error) { this.acceptReceipt({ requestId: request.requestId, ok: false, error: errorCode(error) }); }
  }
  private async sendPending(): Promise<void> {
    const pending = this.pending;
    if (!pending || pending.busy || !this.summary || pending.request.tableId !== this.summary.id) return;
    if (pending.request.command.type === "action") this.actionReceipt = undefined;
    pending.busy = true; pending.at = Date.now(); pending.attempts++; this.message = undefined; this.emit();
    try {
      if (pending.request.command.type === "newGame" && !this.saved && this.canClaim() && this.resetSerial !== undefined) await this.enqueue(() => this.resetMissingGame(pending.request));
      else if (this.serving()) await this.enqueue(() => this.hostCommand(pending.request, this.self.connectionId));
      else {
        const session = this.active.get(this.summary.hostConnectionId);
        if (!session || !this.present(this.summary.hostConnectionId, this.summary.hostPlayerId)) { pending.busy = false; this.fail("hostOffline"); if (!this.hello) await this.handshake(); return; }
        await this.send(session, pending.request);
      }
    } catch (error) { if (this.pending === pending) { pending.busy = false; this.fail(errorCode(error)); } }
  }
  private async hostCommand(request: Request, connection: string): Promise<void> {
    const member = this.member(connection);
    if (!this.serving() || !this.saved || !member || !record(request) || request.kind !== "command" || !validText(request.requestId, 64) ||
        request.tableId !== this.saved.table.id || !Number.isSafeInteger(request.tableRevision) || !record(request.command)) return;
    const epoch = this.epoch, tableEpoch = this.tableEpoch;
    const respond = async (receipt: Receipt) => {
      if (!this.alive(epoch, tableEpoch)) return;
      if (connection === this.self.connectionId) this.acceptReceipt(receipt);
      else if (receipt.ok) await this.snapshot(connection, receipt);
      else { const session = this.active.get(connection); if (session) await this.send(session, { kind: "receipt", ...receipt }); }
    };
    const reject = (error: string) => respond({ requestId: request.requestId, ok: false, error });
    const command = request.command;
    if (!["join", "leave", "start", "newGame", "action"].includes(command.type)) { await reject("invalidCommand"); return; }
    const fingerprint = JSON.stringify([member.id, request.tableId, request.tableRevision, request.gameId, command]);
    const receipts = this.saved.controller?.receipts ?? [];
    const receipt = receipts.find(receipt => receipt.playerId === member.id && receipt.requestId === request.requestId);
    if (receipt && receipt.fingerprint !== fingerprint) { await reject("invalidCommand"); return; }
    try {
      const metadata = tableSummary(await this.platform.readTable());
      if (!this.alive(epoch, tableEpoch) || !this.member(connection)) return;
      if (!metadata || metadata.id !== this.saved!.table.id || metadata.hostConnectionId !== this.self.connectionId || metadata.hostPlayerId !== this.self.id) { this.observe(metadata); return; }
      if (this.dirty) await this.publish();
      if (!this.alive(epoch, tableEpoch) || !this.serving()) return;
      if (receipt) { await respond({ requestId: request.requestId, ok: true }); return; }
      const saved = this.saved!; let game = saved.game; const table = clone(saved.table);
      const seat = table.seats.find(seat => seat.playerId === member.id);
      if (command.type === "action") {
        if (!seat || !game || request.gameId !== game.id || command.action?.seatId !== seat.seatId) { await reject("notSeated"); return; }
        const result = applyAction(game, command.action);
        if (!result.ok) { await reject(result.error.code); return; }
        if (result.duplicate) { await respond({ requestId: request.requestId, ok: true }); return; }
        game = result.state;
      } else if (command.type === "join") {
        if (seat) { await respond({ requestId: request.requestId, ok: true }); return; }
        if (game) { await reject("cannotLeave"); return; }
        if (table.seats.length >= 6) { await reject("tableFull"); return; }
        table.seats.push({ playerId: member.id, seatId: crypto.randomUUID(), name: member.name.slice(0, 200) });
      } else if (command.type === "leave") {
        if (!seat) { await respond({ requestId: request.requestId, ok: true }); return; }
        if (game) { await reject("cannotLeave"); return; }
        table.seats = table.seats.filter(seat => seat.playerId !== member.id);
      } else {
        // The creator may control the table from another authenticated window.
        // This serving connection still owns persistence and game execution.
        if (member.id !== table.hostPlayerId) { await reject("notHost"); return; }
        if (command.type === "start" && game) { await respond({ requestId: request.requestId, ok: true }); return; }
        if (request.tableRevision !== table.revision || request.gameId !== (game?.id ?? null)) { await reject("staleTable"); return; }
        if (command.type === "start" && table.seats.length < 2) { await reject("tooFewPlayers"); return; }
        game = command.type === "newGame" ? null : createGame({ id: crypto.randomUUID(), seats: table.seats.map(seat => ({ id: seat.seatId, name: seat.name })) });
      }
      table.revision++; table.stage = gameStage(game);
      const control = command.type === "action" ? receipts : [...receipts, { playerId: member.id, requestId: request.requestId, fingerprint }].slice(-128);
      const next: ControllerRecord = { ...saved, table, game, controller: { receipts: control } };
      const persisted = await this.storage.save(next, saved.serial) as ControllerRecord;
      if (!this.alive(epoch, tableEpoch) || !this.serving()) return;
      this.saved = persisted; this.dirty = true; this.updateHostView();
      await this.publish();
      if (!this.alive(epoch, tableEpoch)) return;
      await respond({ requestId: request.requestId, ok: true }); await this.broadcastViews();
    } catch (error) {
      const code = errorCode(error); if (code === "staleTable") { this.saved = null; this.resetLinks(); }
      await reject(code);
    }
  }
  private async create(): Promise<void> {
    if (this.summary || this.incompatible) { this.fail(this.incompatible ? "protocolMismatch" : "tableExists"); return; }
    const epoch = this.epoch, id = crypto.randomUUID();
    const creation = { id, contenders: new Map([[this.self.connectionId, id]]) }; this.creation = creation; this.emit();
    try {
      const existing = await this.platform.readTable();
      if (!this.alive(epoch)) return;
      if (existing != null) { this.observe(existing); this.fail("tableExists"); return; }
      await this.platform.send({ kind: "claim", version: 1, tableId: id });
      await new Promise(done => setTimeout(done, this.options.creationSettleMs ?? 250));
      if (!this.alive(epoch) || this.creation !== creation) return;
      const winner = [...creation.contenders.entries()].filter(([connection]) => this.member(connection)).sort(([a], [b]) => a.localeCompare(b))[0];
      if (winner?.[0] !== this.self.connectionId) { this.fail("tableExists"); return; }
      const before = await this.platform.readTable();
      if (!this.alive(epoch)) return;
      if (before != null) { this.observe(before); this.fail("tableExists"); return; }
      const table: TableSummary = { version: 1, id, hostPlayerId: this.self.id, hostConnectionId: this.self.connectionId, hostName: this.self.name, stage: "lobby", revision: 1,
        seats: [{ playerId: this.self.id, seatId: crypto.randomUUID(), name: this.self.name }] };
      const initial: ControllerRecord = { version: 1, roomId: this.platform.roomId, table, game: null, serial: 0, controller: { receipts: [] } };
      const saved = await this.storage.save(initial, null) as ControllerRecord;
      if (!this.alive(epoch)) return;
      this.resetLinks(); this.summary = table; this.saved = saved; this.dirty = true; this.game = null; this.gameTableRevision = 1;
      await this.publish(); this.updateHostView();
    } catch (error) { if (this.alive(epoch)) this.fail(errorCode(error)); }
    finally { if (this.creation === creation) { this.creation = undefined; this.emit(); this.schedule(); } }
  }
  private schedule(): void {
    if (this.timer || !this.running || !this.summary) return;
    this.timer = setTimeout(() => { this.timer = undefined; void this.tick().catch(error => this.fail(errorCode(error))).finally(() => this.schedule()); }, Math.min(this.retryMs, this.heartbeatMs));
  }
  private async tick(): Promise<void> {
    if (!this.running || !this.summary) return;
    const now = Date.now();
    for (const [connection, sessions] of this.hostPending) {
      const alive = sessions.filter(session => now - session.at < this.timeoutMs);
      sessions.filter(session => !alive.includes(session)).forEach(session => session.link?.dispose());
      if (alive.length) this.hostPending.set(connection, alive); else this.hostPending.delete(connection);
    }
    if (this.serving()) {
      if (this.dirty) await this.enqueue(async () => { await this.publish(); await this.broadcastViews(); });
      if (now - this.lastPulse >= this.heartbeatMs) {
        this.lastPulse = now;
        await Promise.allSettled([...this.active.values()].map(session => this.send(session, { kind: "pulse", tableRevision: this.saved!.table.revision, gameId: this.saved!.game?.id ?? null, gameRevision: this.saved!.game?.revision ?? null })));
      }
    } else if (this.present(this.summary.hostConnectionId, this.summary.hostPlayerId)) {
      const active = this.active.get(this.summary.hostConnectionId);
      if (active && now - active.at > this.timeoutMs) { active.link.dispose(); this.active.delete(this.summary.hostConnectionId); this.fail("hostOffline"); }
      if (this.hello && now - this.hello.at >= this.retryMs) {
        if (this.hello.attempts < 3) await this.sendHello();
        else { this.hello.candidate?.link.dispose(); this.hello = undefined; this.fail("requestFailed"); }
      } else if (!active && !this.hello && this.message !== "recoveryMissing") await this.handshake();
    }
    if (this.pending && now - this.pending.at >= this.retryMs) {
      this.pending.busy = false;
      if (this.pending.attempts < 3) await this.sendPending(); else this.fail("requestFailed");
    }
    this.emit();
  }
}
