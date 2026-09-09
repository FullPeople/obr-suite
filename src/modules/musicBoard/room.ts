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
  private sceneReady = false;
  private sceneGeneration = 0;
  private sceneState: MusicSession | null = null;
  private sceneMode = false;
  private get sceneKey(): string { return `com.obr-suite/music-board:room-${OBR.room.id}`; }
  private consider(next: MusicSession | null, scene = false): void {
    if (next && (next.author === this.writer || this.state.author !== this.writer) && next.revision >= this.state.revision) {
      this.sceneMode = scene; this.accept(next);
    }
  }
  private async readScene(): Promise<{ metadata: Record<string, unknown>; generation: number } | null> {
    if (!this.sceneReady) return null;
    const generation = this.sceneGeneration, metadata = await OBR.scene.getMetadata();
    if (!this.active || !this.sceneReady || generation !== this.sceneGeneration) throw new Error("sceneUnavailable");
    this.sceneState = normaliseSession(metadata[this.sceneKey]);
    return { metadata, generation };
  }
  private async saveScene(state: MusicSession, source: {metadata:Record<string,unknown>;generation:number} | null): Promise<void> {
    if (!source || !this.sceneReady || source.generation !== this.sceneGeneration) throw new Error("sceneUnavailable");
    // Scene metadata is separate from the small room budget. Never remove room settings,
    // other extensions' data, or a different room's music from a reused scene.
    await OBR.scene.setMetadata({[this.sceneKey]:state});
    if (!this.active || !this.sceneReady || source.generation !== this.sceneGeneration) throw new Error("sceneUnavailable");
    this.sceneState = state; this.sceneMode = true;
  }
  private ensureSceneOwner(): void {
    if(this.active&&this.sceneReady&&this.sceneMode&&this.writer===this.connectionId)
      this.queue=this.queue.then(()=>this.sceneChanged()).catch(error=>console.warn("[music-board] owner scene save failed",error));
  }
  private async sceneChanged(): Promise<void> {
    const source = await this.readScene(); if (!source) return;
    const persisted = this.sceneState;
    if (persisted && persisted.revision >= this.state.revision) this.consider(persisted, true);
    // A running room carries its saved playlist into the new scene once, not
    // on audio ticks. This preserves cross-scene music and later cold joins.
    if (this.sceneMode && this.writer === this.connectionId && (!persisted || persisted.revision < this.state.revision)) {
      await this.saveScene({...this.state,author:this.connectionId}, source);
    }
  }
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
    this.unsubs.push(OBR.party.onChange(players => { partyVersion++; this.party = players; this.changed(this.state); this.ensureSceneOwner(); }),
      OBR.player.onChange(player => { if (this.self?.id === player.id && this.self?.connectionId === player.connectionId && this.self?.role === player.role) return;
        this.self = player; this.changed(this.state); this.ensureSceneOwner(); }),
      OBR.room.onMetadataChange(metadata => {
        this.readVersion++; const next = normaliseSession(metadata[MUSIC_ROOM_KEY]);
        this.consider(next);
      }),
      OBR.scene.onReadyChange(ready => {
        this.sceneGeneration++; this.sceneReady = ready; this.sceneState = null;
        if (ready) this.queue = this.queue.then(() => this.sceneChanged()).catch(error => console.warn("[music-board] scene restore failed", error));
      }),
      OBR.scene.onMetadataChange(metadata => {
        if (!this.sceneReady) return;
        const next = normaliseSession(metadata[this.sceneKey]); this.sceneState = next;
        this.consider(next, true);
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
    if (!this.active || epoch !== this.epoch) return;
    const persisted = request === this.readVersion ? normaliseSession(metadata[MUSIC_ROOM_KEY]) : null;
    const readyGeneration=this.sceneGeneration,ready=await OBR.scene.isReady();
    if(readyGeneration===this.sceneGeneration)this.sceneReady=ready;
    if (!this.active || epoch !== this.epoch) return;
    const source = await this.readScene();
    if (!this.active || epoch !== this.epoch) return;
    // Decide once after both stores arrive; playing an obsolete room snapshot
    // first would briefly restart the wrong track on a cold join.
    const newest=[this.state,persisted,this.sceneState].filter((value): value is MusicSession => !!value).reduce((a,b)=>b.revision>a.revision?b:a);
    if(persisted||this.sceneState||newest.revision>0)this.consider(newest,newest===this.sceneState||newest===this.state&&this.sceneMode);
    else if(source)this.accept(migrateLegacy(source.metadata[MUSIC_LEGACY_KEY]));
    this.changed(this.state);
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
      const scene = await this.readScene(); if (!current()) return;
      const state = [this.state,persisted,this.sceneState].filter((value): value is MusicSession => !!value).reduce((a,b)=>b.revision>a.revision?b:a);
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
          if(new TextEncoder().encode(JSON.stringify(next)).length>48000)throw new Error("libraryFull");
          const size = new TextEncoder().encode(JSON.stringify({ ...metadata, [MUSIC_ROOM_KEY]: next })).length;
          if (!current()) return;
          if (size >= 15500 || new TextEncoder().encode(JSON.stringify(next)).length > 10500) {
            await this.saveScene(next, scene);
          } else {
            try { await OBR.room.setMetadata({ [MUSIC_ROOM_KEY]: next }); this.sceneMode = false; }
            catch(error) {
              // A concurrent extension may consume the remaining room budget.
              // Network/permission errors are not treated as quota errors.
              const reason=error instanceof Error?error.message:String(error);
              if(!/quota|too large|exceed.{0,30}(size|limit)|metadata.{0,30}(size|limit)|16\s*k/i.test(reason))throw error;
              await this.saveScene(next,scene);
            }
          }
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
