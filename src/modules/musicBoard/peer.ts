import { safeMediaUrl, type MusicOp } from "./model";
export type PairStatus = "disconnected" | "connecting" | "connected" | "reconnecting" | "restored" | "error";
async function defaultPeerLoader(): Promise<any> {
  const dynamicImport = new Function("url", "return import(url)") as (url: string) => Promise<any>;
  const module = await dynamicImport("https://esm.sh/peerjs@1.5.4"); return module.default ?? module.Peer;
}
/** Existing Studio 1.x protocol retained. Peer loss is transport state, never
 * a stop/clear command. Reconnect bootstrap cannot replace newer room music. */
export class StudioPeer {
  private peer: any = null;
  private connection: any = null;
  private version = 0;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private attempts = 0;
  private code = "";
  private parked: MusicOp[] | null = null;
  private volumeTimer: ReturnType<typeof setTimeout> | undefined;
  private volumes = new Map<string, MusicOp>();
  status: PairStatus = "disconnected";
  constructor(private command: (op: MusicOp) => void, private changed: () => void, private loadPeer = defaultPeerLoader) {}
  async connect(code: string, restoring = false): Promise<void> {
    this.disconnect(false); this.code = code.trim().toUpperCase(); this.attempts = 0;
    if (!/^[A-Z2-9]{6}$/.test(this.code)) { this.status = "error"; this.changed(); return; }
    await this.dial(restoring);
  }
  private async dial(restoring: boolean): Promise<void> {
    const version = ++this.version;
    this.status = restoring ? "reconnecting" : "connecting"; this.changed();
    const current = () => this.version === version && !!this.code;
    const retry = () => {
      if (!current() || this.retry) return;
      this.status = "reconnecting"; this.changed();
      this.retry = setTimeout(() => { this.retry = undefined; if (!current()) return; this.version++; this.peer?.destroy(); this.peer = null; void this.dial(true); }, Math.min(30000, 1000 * 2 ** Math.min(this.attempts++, 5)));
    };
    try {
      const Peer = await this.loadPeer();
      if (!current()) return;
      this.peer = new Peer();
      this.peer.on("open", () => {
        if (!current()) return;
        const connection = this.peer.connect(`obr-music-${this.code}`, { reliable: true }); this.connection = connection;
        this.parked = restoring ? [] : null;
        connection.on("open", () => { if (!current()) return; this.attempts = 0; this.status = restoring ? "restored" : "connected"; this.changed(); });
        connection.on("data", (message: unknown) => {
          if (!current()) return; const op = studioOperation(message); if (!op) return;
          if (this.parked) {
            if (op.type === "volume") this.parked = this.parked.filter(old => old.type !== "volume" || old.bus !== op.bus);
            this.parked = [...this.parked, op].slice(-16);
          } else this.dispatch(op);
        });
        connection.on("close", retry); connection.on("error", retry);
      });
      this.peer.on("disconnected", retry); this.peer.on("error", retry);
    } catch (error) { if (current()) retry(); console.warn("[music-board] Studio transport unavailable", error); }
  }
  disconnect(notify = true): void {
    this.code = ""; this.version++; if (this.retry) clearTimeout(this.retry); this.retry = undefined;
    if (this.volumeTimer) clearTimeout(this.volumeTimer); this.volumeTimer = undefined; this.volumes.clear();
    try { this.connection?.close(); this.peer?.destroy(); } catch {}
    this.connection = null; this.peer = null; this.parked = null; this.status = "disconnected"; if (notify) this.changed();
  }
  /** Studio 1.x has no session/revision on its reconnect snapshot. Adopting it
   * explicitly avoids silently overwriting room controls after a network gap. */
  adopt(): void { if (this.status !== "restored") return; const pending = this.parked || []; this.parked = null; this.status = "connected"; for (const op of pending) this.dispatch(op); this.changed(); }
  private dispatch(op: MusicOp): void {
    if (op.type !== "volume") { this.command(op); return; }
    this.volumes.set(op.bus || "", op);
    if (this.volumeTimer) return;
    const version = this.version;
    this.volumeTimer = setTimeout(() => { this.volumeTimer = undefined; const pending = [...this.volumes.values()]; this.volumes.clear(); if (version === this.version) for (const value of pending) this.command(value); }, 120);
  }
}
export function studioOperation(value: unknown): MusicOp | null {
  if (!value || typeof value !== "object") return null;
  const message = value as Record<string, any>;
  switch (message.type) {
    case "bgm-load": return safeMediaUrl(message.url) ? { type: "play", track: { url: message.url, name: message.name, loop: !!message.loop }, position: message.position } : null;
    case "bgm-play": return { type: "resume", position: message.position };
    case "bgm-pause": return { type: "pause", position: message.position };
    case "bgm-seek": return { type: "seek", position: message.position };
    case "bgm-stop": return { type: "stop" };
    case "sfx-add": return safeMediaUrl(message.url) && typeof message.id === "string" ? { type: "sfx", playbackId: message.id.slice(0, 100), track: { url: message.url, name: message.name, loop: !!message.loop, bus: "sfx" } } : null;
    case "sfx-stop": return { type: "sfx-stop", id: message.id };
    case "sfx-stop-all": return { type: "sfx-clear" };
    case "volume": return { type: "volume", bus: message.bus, volume: message.vol };
    default: return null;
  }
}
