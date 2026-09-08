import OBR, { type Player } from "@owlbear-rodeo/sdk";
import { MUSIC_ACK, MUSIC_COMMAND, MUSIC_LEGACY_KEY, MUSIC_ROOM_KEY, emptySession, migrateLegacy, normaliseSession, reduceMusic, type MusicOp, type MusicSession } from "./model";
export function electedWriter(players: Array<Pick<Player, "connectionId" | "role">>): string {
  return [...players].sort((a, b) => Number(b.role === "GM") - Number(a.role === "GM") || a.connectionId.localeCompare(b.connectionId))[0]?.connectionId || "";
}
interface Request { requestId: string; op: MusicOp }
export class RoomMusic {
  state = emptySession();
  private self: Player | null = null;
  private party: Player[] = [];
  private active = false;
  private epoch = 0;
  private readVersion = 0;
  private queue = Promise.resolve();
  private unsubs: Array<() => void> = [];
  private pending = new Map<string, { resolve: () => void; reject: (error: Error) => void; timeout: ReturnType<typeof setTimeout> }>();
  constructor(private changed: (state: MusicSession) => void) {}
  get connectionId(): string { return this.self?.connectionId || ""; }
  get isGM(): boolean { return this.self?.role === "GM"; }
  get canControl(): boolean { return this.isGM || this.state.allowPlayers; }
  get writer(): string { return electedWriter(this.players()); }
  private players(): Player[] { return [...new Map([...this.party, ...(this.self ? [this.self] : [])].map(player => [player.connectionId, player])).values()]; }
  async start(): Promise<void> {
    if (this.active) return; this.active = true; const epoch = ++this.epoch;
    const [id, connectionId, role] = await Promise.all([OBR.player.getId(), OBR.player.getConnectionId(), OBR.player.getRole()]);
    if (!this.active || epoch !== this.epoch) return;
    this.self = { id, connectionId, role } as Player;
    let partyVersion = 0;
    this.unsubs.push(OBR.party.onChange(players => { partyVersion++; this.party = players; this.changed(this.state); }),
      OBR.player.onChange(player => { if (this.self?.id === player.id && this.self?.connectionId === player.connectionId && this.self?.role === player.role) return;
        this.self = player; this.changed(this.state); }),
      OBR.room.onMetadataChange(metadata => {
        this.readVersion++; const next = normaliseSession(metadata[MUSIC_ROOM_KEY]);
        if (next && (next.author === this.writer || this.state.author !== this.writer) && next.revision >= this.state.revision) this.accept(next);
      }),
      OBR.broadcast.onMessage(MUSIC_COMMAND, event => {
        const data = event.data as Request;
        if (!data || typeof data.requestId !== "string" || data.requestId.length > 100 || !data.op || typeof data.op.type !== "string") return;
        if (!this.active || this.writer !== this.connectionId) return;
        this.queue = this.queue.then(() => this.execute(data, event.connectionId)).catch(error => console.warn("[music-board] command queue failed", error));
      }),
      OBR.broadcast.onMessage(MUSIC_ACK, event => {
        const result = event.data as { requestId?: string; receiver?: string; ok?: boolean; error?: string };
        if (event.connectionId !== this.writer || result?.receiver !== this.connectionId || !result.requestId) return;
        const pending = this.pending.get(result.requestId); if (!pending) return;
        clearTimeout(pending.timeout); this.pending.delete(result.requestId); result.ok ? pending.resolve() : pending.reject(new Error(result.error || "failed"));
      }));
    const readParty = partyVersion, players = await OBR.party.getPlayers();
    if (!this.active || epoch !== this.epoch) return;
    if (readParty === partyVersion) this.party = players;
    const request = ++this.readVersion, metadata = await OBR.room.getMetadata();
    if (!this.active || epoch !== this.epoch || request !== this.readVersion) return;
    const persisted = normaliseSession(metadata[MUSIC_ROOM_KEY]);
    if (persisted) this.accept(persisted);
    else {
      const legacyRequest = this.readVersion;
      if (await OBR.scene.isReady()) {
        const scene = await OBR.scene.getMetadata();
        if (!this.active || epoch !== this.epoch || legacyRequest !== this.readVersion) return;
        this.accept(migrateLegacy(scene[MUSIC_LEGACY_KEY]));
      } else this.changed(this.state);
    }
  }
  private accept(state: MusicSession): void { if (JSON.stringify(this.state) === JSON.stringify(state)) return; this.state = state; this.changed(state); }
  async submit(op: MusicOp, requestId: string = crypto.randomUUID()): Promise<void> {
    if (!this.active) throw new Error("unavailable");
    if (new TextEncoder().encode(JSON.stringify({ requestId, op })).length > 14000) throw new Error("libraryFull");
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => { this.pending.delete(requestId); reject(new Error("noWriter")); }, 7000);
      this.pending.set(requestId, { resolve, reject, timeout });
      void OBR.broadcast.sendMessage(MUSIC_COMMAND, { requestId, op }, { destination: "ALL" }).catch(error => { clearTimeout(timeout); this.pending.delete(requestId); reject(error); });
    });
  }
  private async execute(request: Request, senderId: string): Promise<void> {
    const epoch = this.epoch, current = () => this.active && epoch === this.epoch && this.writer === this.connectionId;
    if (!current()) return;
    let ok = false, error = "failed";
    try {
      const metadata = await OBR.room.getMetadata(); if (!current()) return;
      const persisted = normaliseSession(metadata[MUSIC_ROOM_KEY]);
      const state = persisted && persisted.revision >= this.state.revision ? persisted : this.state;
      const sender = this.players().find(player => player.connectionId === senderId);
      const automatic = request.op.type === "ended" || request.op.type === "duration";
      if (!sender || (!automatic && sender.role !== "GM" && (!state.allowPlayers || request.op.type === "allowPlayers"))) throw new Error("permission");
      // A GM-only control policy does not stop an already-playing queue after the last GM leaves.
      if (automatic && senderId !== this.writer) throw new Error("permission");
      if (state.recent.includes(request.requestId)) ok = true;
      else {
        const next = reduceMusic(state, request.op, request.requestId);
        if (next !== state) {
          next.author = this.connectionId;
          const size = new TextEncoder().encode(JSON.stringify({ ...metadata, [MUSIC_ROOM_KEY]: next })).length;
          if (size >= 15500 || new TextEncoder().encode(JSON.stringify(next)).length > 10500) throw new Error("roomFull");
          if (!current()) return;
          await OBR.room.setMetadata({ [MUSIC_ROOM_KEY]: next });
          if (!current()) return;
          this.accept(next);
        }
        ok = true;
      }
    } catch (failure) { error = failure instanceof Error ? failure.message : "failed"; console.warn("[music-board] room command rejected", { type: request.op.type, error }); }
    if (current()) await OBR.broadcast.sendMessage(MUSIC_ACK, { requestId: request.requestId, receiver: senderId, ok, error: ok ? undefined : error }, { destination: "ALL" });
  }
  async stop(): Promise<void> {
    this.active = false; this.epoch++; for (const off of this.unsubs.splice(0)) off();
    for (const pending of this.pending.values()) { clearTimeout(pending.timeout); pending.reject(new Error("unavailable")); } this.pending.clear();
    await this.queue;
    // Deliberately no metadata writes: room playback/queue survive this client.
  }
}
