import OBR, { buildPointer, buildLabel, type Item, type Player, type ToolContext, type ToolEvent } from "@owlbear-rodeo/sdk";
import { getLocalLang } from "../../state";
import { POINTER_ID, POINTER_TOOL, POINTER_MODE, POINTER_NETWORK, POINTER_ACTIVATE, POINTER_SCENE_KEY, POINTER_LOCAL_KEY,
  SEND_INTERVAL, POINTER_TTL, MAX_PEERS, sceneToken, position, parsePacket, type Packet, type Position } from "./protocol";

type Timer = ReturnType<typeof setTimeout>;
export interface PointerClock { now(): number; set(callback: () => void, delay: number): Timer; clear(timer: Timer): void }
const clock: PointerClock = { now: () => performance.now(), set: (fn, ms) => setTimeout(fn, ms), clear: id => clearTimeout(id) };
type View = { p: Position; name: string; color: string; owner: string; until: number };
type Lease = { epoch: string; sequence: number };
const icon = new URL("./icon.svg", import.meta.url).href;
const identity = (player: Player) => ({ name: String(player.name || (getLocalLang() === "en" ? "Player" : "玩家")).replace(/[\u0000-\u001f]/g, "").slice(0, 48),
  color: /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(player.color) ? player.color : "#78bced", owner: player.id });

/** Runtime owner. The injected SDK/clock only provide test boundaries; production uses OBR. */
export class SharedPointerController {
  private running = false;
  private ready = false;
  private revision = 0;
  private selfRevision = 0;
  private partyRevision = 0;
  private sceneRevision = 0;
  private modeRevision = 0;
  private metadataRevision = 0;
  private self: Player | null = null;
  private party: Player[] = [];
  private peers = new Map<string, Player>();
  private key = "";
  private epoch = "";
  private sequence = 0;
  private modeActive = false;
  private toolRegistered = false;
  private modeRegistered = false;
  private pendingPoint: Position | null | undefined;
  private control = new Map<string, Packet>();
  private sendTimer: Timer | undefined;
  private sending = false;
  private lastSend = -Infinity;
  private handshakeTimes = new Map<string, number>();
  private pendingHello = new Map<string, string>();
  private leases = new Map<string, Lease>();
  private desired = new Map<string, View>();
  private rendered = new Map<string, Item[]>();
  // Retired UUIDs are never reused by another scene/lifetime, even after a late host add.
  private pendingDeletes = new Set<string>();
  private drawFailures = 0;
  private drawTimer: Timer | undefined;
  private drawing: Promise<void> | null = null;
  private stopping: Promise<void> | null = null;
  private drawAgain = false;
  private expiry: Timer | undefined;
  private retries: Timer[] = [];
  private unsubs: Array<() => void> = [];
  private initializing: Promise<void> | null = null;
  private warned = false;
  constructor(private sdk: typeof OBR = OBR, private time: PointerClock = clock) {}
  get isRunning() { return this.running; }

  async start(): Promise<void> {
    if (this.running) return;
    if (this.stopping) await this.stopping;
    if (this.pendingDeletes.size) await this.deleteRetired();
    if (this.running) return;
    this.running = true; const run = ++this.revision;
    const alive = () => this.running && this.revision === run;
    const sv = this.selfRevision, pv = this.partyRevision, rv = this.sceneRevision;
    this.unsubs.push(
      this.sdk.player.onChange(player => { if (!alive()) return; this.selfRevision++; this.self = player; this.updatePeers(); }),
      this.sdk.party.onChange(players => { if (!alive()) return; this.partyRevision++; this.party = players; this.updatePeers(); }),
      this.sdk.scene.onReadyChange(ready => { if (!alive()) return; this.sceneRevision++; this.ready = ready; this.resetScene(); if (ready) void this.readScene(); }),
      this.sdk.scene.onMetadataChange(meta => { if (!alive() || !this.ready) return; this.metadataRevision++; this.acceptKey(meta[POINTER_SCENE_KEY]); }),
      this.sdk.broadcast.onMessage(POINTER_NETWORK, event => { if (alive()) this.receive(event.data, event.connectionId); }),
      this.sdk.broadcast.onMessage(POINTER_ACTIVATE, event => { if (alive() && event.connectionId === this.self?.connectionId) void this.activate(); }),
      this.sdk.tool.onToolChange(id => { if (!alive()) return; this.modeRevision++; if (id !== POINTER_TOOL) this.deactivate(); }),
      this.sdk.tool.onToolModeChange(id => { if (!alive()) return; this.modeRevision++; if (id !== POINTER_MODE) this.deactivate(); }),
    );
    const [id, connectionId, name, color, role, players, ready] = await Promise.all([this.sdk.player.getId(), this.sdk.player.getConnectionId(), this.sdk.player.getName(), this.sdk.player.getColor(), this.sdk.player.getRole(), this.sdk.party.getPlayers(), this.sdk.scene.isReady()]);
    if (!alive()) return;
    if (sv === this.selfRevision) this.self = { id, connectionId, name, color, role, metadata: {}, syncView: false };
    if (pv === this.partyRevision) this.party = players;
    if (rv === this.sceneRevision) this.ready = ready;
    this.updatePeers();
    const label = getLocalLang() === "en" ? "Share pointer · move to indicate, pause to hide" : "共享指针 · 移动指示，停留隐藏";
    this.toolRegistered = true;
    await this.sdk.tool.create({ id: POINTER_TOOL, icons: [{ icon, label }], defaultMode: POINTER_MODE });
    if (!alive()) { this.toolRegistered = true; await this.removeTool(); return; }
    const activeContext = (context: ToolContext) => alive() && context.activeTool === POINTER_TOOL && context.activeMode === POINTER_MODE;
    const point = (context: ToolContext, event: ToolEvent) => { if (activeContext(context)) this.move(event.pointerPosition); };
    this.modeRegistered = true;
    await this.sdk.tool.createMode({ id: POINTER_MODE, icons: [{ icon, label }], cursors: [{ cursor: "crosshair" }], preventDrag: {},
      onActivate: context => { if (activeContext(context)) void this.enterMode(); },
      onDeactivate: () => { if (alive()) this.deactivate(); },
      onToolMove: point, onToolDown: point,
      onToolUp: context => { if (activeContext(context)) this.endPoint(); },
      onToolDragCancel: context => { if (activeContext(context)) this.endPoint(); },
      onKeyDown: (context, event) => { if (activeContext(context) && event.key === "Escape") this.endPoint(); },
      onToolClick: () => true, onToolDoubleClick: () => true,
    });
    if (!alive()) { this.modeRegistered = true; await this.removeMode(); return; }
    const pagehide = () => { void this.stop().catch(error => console.warn("[shared-pointer] exit cleanup failed", error)); };
    const blur = () => this.endPoint();
    window.addEventListener("pagehide", pagehide); window.addEventListener("blur", blur);
    this.unsubs.push(() => { window.removeEventListener("pagehide", pagehide); window.removeEventListener("blur", blur); });
    // A prior iframe crash may have left only this module's local items behind.
    try {
      const old = await this.sdk.scene.local.getItems(item => item.metadata[POINTER_LOCAL_KEY] === true);
      if (alive()) {
        const owned = new Set([...this.rendered.values()].flat().map(item => item.id));
        for (const item of old) if (!owned.has(item.id)) this.pendingDeletes.add(item.id);
        this.requestDraw();
      }
    } catch (error) { console.warn("[shared-pointer] orphan lookup failed", error); }
    if (alive() && this.ready) await this.readScene();
  }

  private updatePeers() {
    if (!this.self) return;
    const previous = new Set(this.peers.keys());
    const sorted = [...this.party.filter(player => player.connectionId !== this.self!.connectionId), this.self].sort((a, b) => a.connectionId.localeCompare(b.connectionId));
    this.peers = new Map(sorted.slice(0, MAX_PEERS).map(player => [player.connectionId, player]));
    for (const sender of this.leases.keys()) if (!this.peers.has(sender)) this.leases.delete(sender);
    for (const sender of this.pendingHello.keys()) if (!this.peers.has(sender)) this.pendingHello.delete(sender);
    for (const sender of this.handshakeTimes.keys()) if (!this.peers.has(sender.replace(/^ask:/, ""))) this.handshakeTimes.delete(sender);
    for (const sender of this.desired.keys()) {
      const player = this.peers.get(sender);
      if (!player) this.desired.delete(sender);
      else this.desired.set(sender, { ...this.desired.get(sender)!, ...identity(player) });
    }
    this.requestDraw();
    if (this.key) { for (const sender of this.peers.keys()) if (sender !== this.self.connectionId && !previous.has(sender)) this.hello(sender); }
    else if (this.ready) void this.ensureSceneKey();
  }
  private async readScene() {
    const scene = this.sceneRevision, run = this.revision, metadata = this.metadataRevision;
    try {
      const meta = await this.sdk.scene.getMetadata();
      if (!this.running || !this.ready || scene !== this.sceneRevision || run !== this.revision) return;
      if (metadata === this.metadataRevision) this.acceptKey(meta[POINTER_SCENE_KEY]);
      if (!this.key) await this.ensureSceneKey();
      await this.confirmMode();
    } catch { /* A later GM/metadata event or tool activation retries. */ }
  }
  private acceptKey(value: unknown) {
    const key = sceneToken(value) ? value : "";
    if (key === this.key) return;
    this.resetScene(); this.key = key;
    if (key) {
      this.epoch = crypto.randomUUID(); this.warned = false; this.hello();
      for (const delay of [600, 1800]) this.retries.push(this.time.set(() => { if (this.running && this.key === key) this.hello(); }, delay));
    }
  }
  private ensureSceneKey(): Promise<void> {
    if (this.initializing) return this.initializing;
    const scene = this.sceneRevision, run = this.revision;
    const valid = () => this.running && this.ready && this.revision === run && this.sceneRevision === scene && !this.key;
    const leader = () => [...this.peers.values()].filter(player => player.role === "GM").sort((a, b) => a.connectionId.localeCompare(b.connectionId))[0]?.connectionId === this.self?.connectionId;
    if (!valid() || !leader()) return Promise.resolve();
    this.initializing = (async () => {
      try {
        const meta = await this.sdk.scene.getMetadata();
        if (!valid()) return;
        if (sceneToken(meta[POINTER_SCENE_KEY])) { this.acceptKey(meta[POINTER_SCENE_KEY]); return; }
        if (await this.sdk.player.getRole() !== "GM" || !valid() || this.self?.role !== "GM" || !leader()) return;
        await this.sdk.scene.setMetadata({ [POINTER_SCENE_KEY]: crypto.randomUUID() });
        if (!valid()) return;
        const saved = await this.sdk.scene.getMetadata();
        if (valid()) this.acceptKey(saved[POINTER_SCENE_KEY]);
      } catch { /* Does not block startup. Tool activation can retry. */ }
    })().finally(() => {
      this.initializing = null;
      if (this.running && this.ready && !this.key && scene !== this.sceneRevision) void this.ensureSceneKey();
    });
    return this.initializing;
  }
  private resetScene() {
    this.endPoint(false); this.key = ""; this.epoch = ""; this.sequence = 0; this.pendingPoint = undefined; this.control.clear(); this.leases.clear(); this.handshakeTimes.clear(); this.pendingHello.clear(); this.desired.clear();
    for (const timer of this.retries) this.time.clear(timer); this.retries = [];
    if (this.sendTimer) this.time.clear(this.sendTimer); this.sendTimer = undefined;
    if (this.expiry) this.time.clear(this.expiry); this.expiry = undefined;
    for (const items of this.rendered.values()) for (const item of items) this.pendingDeletes.add(item.id);
    this.rendered.clear();
    this.requestDraw();
  }
  async activate() {
    if (!this.running) return;
    if (!this.key && this.ready) await this.readScene();
    if (!this.running) return;
    await this.sdk.tool.activateMode(POINTER_TOOL, POINTER_MODE);
    await this.enterMode();
  }
  private async enterMode() {
    await this.confirmMode();
    if (!this.key && this.ready) await this.readScene();
    if (!this.running) return;
    if (!this.key && !this.warned) {
      this.warned = true;
      const gm = [...this.peers.values()].some(player => player.role === "GM");
      const message = gm ? (getLocalLang() === "en" ? "Shared pointer could not initialize this scene. Select the tool again to retry." : "共享指针暂时无法初始化此场景，请再点一次工具重试。") :
        (getLocalLang() === "en" ? "Shared pointer is waiting for a GM to initialize this scene. It will become available automatically." : "共享指针正在等待 DM 初始化此场景，完成后会自动可用。");
      void this.sdk.notification.show(message).catch(() => {});
    }
  }
  private async confirmMode() {
    const revision = ++this.modeRevision, run = this.revision;
    try { const mode = await this.sdk.tool.getActiveToolMode(); if (this.running && run === this.revision && revision === this.modeRevision) this.modeActive = mode === POINTER_MODE; } catch {}
  }
  private deactivate() { this.modeActive = false; this.endPoint(); }
  private move(value: unknown) {
    if (!this.running || !this.ready || !this.modeActive || !this.key || !this.self || !this.peers.has(this.self.connectionId)) return;
    const p = position(value); if (!p) return;
    const old = this.desired.get(this.self.connectionId);
    if (old && old.p[0] === p[0] && old.p[1] === p[1]) return;
    this.desired.set(this.self.connectionId, { p, ...identity(this.self), until: this.time.now() + POINTER_TTL });
    this.pendingPoint = p; this.scheduleSend(); this.requestDraw(); this.scheduleExpiry();
  }
  private endPoint(broadcast = true) {
    if (!this.self) return;
    const existed = this.desired.delete(this.self.connectionId);
    if (broadcast && this.running && this.key && (existed || this.pendingPoint !== undefined)) { this.pendingPoint = null; this.scheduleSend(); }
    else this.pendingPoint = undefined;
    if (existed) this.requestDraw();
  }
  private hello(to?: string) {
    if (!this.running || !this.ready || !this.key || !this.epoch) return;
    const q = crypto.randomUUID();
    for (const sender of this.peers.keys()) if (sender !== this.self?.connectionId && (!to || to === sender)) this.pendingHello.set(sender, q);
    this.queueControl({ v: 1, k: "h", s: this.key, q, e: this.epoch, ...(to ? { to } : {}) });
  }
  private queueControl(packet: Packet) {
    const id = packet.k === "a" ? `a:${packet.to}` : packet.k === "h" ? `h:${packet.to ?? "all"}` : "";
    if (!this.control.has(id) && this.control.size >= MAX_PEERS * 2 + 1) return;
    this.control.set(id, packet); this.scheduleSend();
  }
  private scheduleSend() {
    if (!this.running || !this.ready || !this.key || this.sending || this.sendTimer || (!this.control.size && this.pendingPoint === undefined)) return;
    this.sendTimer = this.time.set(() => { this.sendTimer = undefined; void this.sendNext(); }, Math.max(0, this.lastSend + SEND_INTERVAL - this.time.now()));
  }
  private async sendNext() {
    if (!this.running || !this.ready || !this.key || this.sending) return;
    let packet: Packet | undefined;
    const first = this.control.entries().next().value;
    if (first) { this.control.delete(first[0]); packet = first[1]; }
    else if (this.pendingPoint !== undefined) { packet = { v: 1, k: "p", s: this.key, e: this.epoch, n: ++this.sequence, p: this.pendingPoint }; this.pendingPoint = undefined; }
    if (!packet || packet.s !== this.key) { this.scheduleSend(); return; }
    this.sending = true; this.lastSend = this.time.now();
    try { await this.sdk.broadcast.sendMessage(POINTER_NETWORK, packet, { destination: "REMOTE" }); } catch {}
    finally { this.sending = false; this.scheduleSend(); }
  }
  private receive(value: unknown, sender: string) {
    if (!this.running || !this.ready || !this.key || !this.epoch || sender === this.self?.connectionId) return;
    const peer = this.peers.get(sender), packet = parsePacket(value);
    if (!peer || !packet || packet.s !== this.key) return;
    if (packet.k === "h") {
      if (packet.to && packet.to !== this.self?.connectionId) return;
      const now = this.time.now(), last = this.handshakeTimes.get(sender) ?? -Infinity;
      if (now - last < 400) return;
      this.handshakeTimes.set(sender, now);
      this.queueControl({ v: 1, k: "a", s: this.key, q: packet.q, e: this.epoch, n: this.sequence, to: sender });
      if (this.leases.get(sender)?.epoch !== packet.e && !this.pendingHello.has(sender)) this.hello(sender);
    } else if (packet.k === "a") {
      if (packet.to !== this.self?.connectionId || packet.q !== this.pendingHello.get(sender)) return;
      this.pendingHello.delete(sender);
      const old = this.leases.get(sender);
      if (old?.epoch !== packet.e) {
        this.desired.delete(sender); this.requestDraw();
        const own = this.self && this.desired.get(this.self.connectionId);
        if (own && own.until > this.time.now()) { this.pendingPoint = own.p; this.scheduleSend(); }
      }
      this.leases.set(sender, { epoch: packet.e, sequence: old?.epoch === packet.e ? Math.max(old.sequence, packet.n) : packet.n });
    } else {
      const lease = this.leases.get(sender);
      if (!lease || lease.epoch !== packet.e) {
        const now = this.time.now(); if (now - (this.handshakeTimes.get(`ask:${sender}`) ?? -Infinity) > 500) { this.handshakeTimes.set(`ask:${sender}`, now); this.hello(sender); }
        return;
      }
      if (packet.n <= lease.sequence) return;
      lease.sequence = packet.n;
      if (packet.p === null) this.desired.delete(sender);
      else this.desired.set(sender, { p: packet.p, ...identity(peer), until: this.time.now() + POINTER_TTL });
      this.requestDraw(); this.scheduleExpiry();
    }
  }
  private scheduleExpiry() {
    if (this.expiry) this.time.clear(this.expiry); this.expiry = undefined;
    if (!this.running || !this.desired.size) return;
    const nearest = Math.min(...[...this.desired.values()].map(view => view.until));
    this.expiry = this.time.set(() => {
      this.expiry = undefined;
      if (!this.running) return;
      for (const [sender, view] of this.desired) if (view.until <= this.time.now()) {
        if (sender === this.self?.connectionId) this.endPoint(); else this.desired.delete(sender);
      }
      this.requestDraw(); this.scheduleExpiry();
    }, Math.max(1, nearest - this.time.now()));
  }
  private requestDraw(delay = 34) {
    this.drawAgain = true;
    if (this.drawing || this.drawTimer) return;
    if (!this.desired.size && !this.rendered.size && !this.pendingDeletes.size) { this.drawAgain = false; return; }
    this.drawTimer = this.time.set(() => { this.drawTimer = undefined; void this.draw(); }, delay);
  }
  private async deleteRetired() {
    const ids = [...this.pendingDeletes];
    if (!ids.length) return;
    await this.sdk.scene.local.deleteItems(ids);
    for (const id of ids) this.pendingDeletes.delete(id);
  }
  private async removeMode() {
    if (!this.modeRegistered) return;
    await this.sdk.tool.removeMode(POINTER_MODE);
    this.modeRegistered = false;
  }
  private async removeTool() {
    if (!this.toolRegistered) return;
    await this.sdk.tool.remove(POINTER_TOOL);
    this.toolRegistered = false;
  }
  private draw(): Promise<void> {
    if (this.drawing) return this.drawing;
    this.drawAgain = false;
    this.drawing = (async () => {
      const scene = this.sceneRevision, epoch = this.epoch, run = this.revision;
      const valid = () => this.running && this.ready && this.revision === run && this.sceneRevision === scene && this.epoch === epoch;
      const want = this.running && this.ready ? new Map(this.desired) : new Map<string, View>();
      const removed = [...this.rendered].filter(([sender]) => !want.has(sender));
      for (const [sender, items] of removed) { for (const item of items) this.pendingDeletes.add(item.id); this.rendered.delete(sender); }
      await this.deleteRetired();
      if (!valid()) return;
      const added: Item[] = [], updates: Item[] = [], nextBySender = new Map<string, Item[]>(), addedBySender = new Map<string, Item[]>();
      let appearanceChanged = false;
      for (const [sender, view] of want) {
        const old = this.rendered.get(sender), p = { x: view.p[0], y: view.p[1] };
        const point = buildPointer().color(view.color).radius(7).position(p).disableHit(true).locked(true).metadata({ [POINTER_LOCAL_KEY]: true }).createdUserId(view.owner).build();
        const label = buildLabel().plainText(view.name).fontSize(12).fontWeight(600).fillColor(view.color).padding(4).backgroundColor("#192235").backgroundOpacity(0.85).cornerRadius(4).pointerWidth(0).pointerHeight(0)
          .position({ x: p.x + 12, y: p.y - 18 }).layer("POINTER").disableHit(true).locked(true).metadata({ [POINTER_LOCAL_KEY]: true }).createdUserId(view.owner).build();
        const next = old ? [{ ...point, id: old[0].id }, { ...label, id: old[1].id }] : [point, label];
        if (!old) { added.push(...next); addedBySender.set(sender, next); }
        else {
          const changed = JSON.stringify(old.map(item => item.type === "POINTER" ? (item as any).color : (item as any).text)) !== JSON.stringify(next.map(item => item.type === "POINTER" ? (item as any).color : (item as any).text));
          if (changed || JSON.stringify(old.map(item => item.position)) !== JSON.stringify(next.map(item => item.position))) updates.push(...old);
          appearanceChanged ||= changed;
        }
        nextBySender.set(sender, next);
      }
      if (added.length) {
        // A rejected request might still have reached the host. Retain its UUIDs until
        // success is known, and retire all of them if the scene changed while awaiting it.
        for (const item of added) this.pendingDeletes.add(item.id);
        await this.sdk.scene.local.addItems(added);
        if (!valid()) { this.drawAgain = true; return; }
        for (const [sender, next] of addedBySender) if (this.desired.has(sender)) {
          for (const item of next) this.pendingDeletes.delete(item.id);
          this.rendered.set(sender, next);
        }
        if (this.pendingDeletes.size) this.drawAgain = true;
      }
      if (!valid()) return;
      if (updates.length) {
        const byId = new Map([...nextBySender.values()].flat().map(item => [item.id, item]));
        await this.sdk.scene.local.updateItems(updates, drafts => { if (!valid()) return; for (const draft of drafts) { const next = byId.get(draft.id); if (!next) continue; draft.position = next.position;
          if (draft.type === "POINTER") { if ((draft as any).color !== (next as any).color) (draft as any).color = (next as any).color; }
          else if (JSON.stringify((draft as any).text) !== JSON.stringify((next as any).text)) (draft as any).text = (next as any).text;
        } }, !appearanceChanged); // The host fast path only promises position, not pointer color or text style.
        if (valid()) for (const [sender, next] of nextBySender) {
          if (this.rendered.get(sender)?.[0].id === next[0].id) this.rendered.set(sender, next);
        }
      }
    })().then(() => { this.drawFailures = 0; }).catch(error => {
      this.drawFailures++; this.drawAgain = this.drawFailures < 3;
      console.warn("[shared-pointer] local rendering failed; owned UUIDs retained for cleanup", error);
    }).finally(() => {
      this.drawing = null; if (this.running && this.drawAgain) this.requestDraw(this.drawFailures ? this.drawFailures * 200 : 34);
    });
    return this.drawing;
  }
  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.running = false; this.revision++; this.sceneRevision++; this.modeActive = false;
    for (const off of this.unsubs.splice(0)) off();
    this.resetScene();
    if (this.drawTimer) this.time.clear(this.drawTimer); this.drawTimer = undefined;
    this.stopping = (async () => {
      await this.drawing;
      let failure: unknown;
      for (let attempt = 0; attempt < 3 && this.pendingDeletes.size; attempt++) {
        try { await this.deleteRetired(); failure = undefined; } catch (error) { failure = error; }
      }
      let toolFailure: unknown;
      try { await this.removeMode(); } catch (error) { toolFailure = error; }
      try { await this.removeTool(); } catch (error) { toolFailure ??= error; }
      // Keep IDs and let a later teardown/setup retry; never claim successful cleanup.
      if (this.pendingDeletes.size) throw failure ?? new Error("Shared pointer cleanup incomplete");
      if (this.modeRegistered || this.toolRegistered) throw toolFailure ?? new Error("Shared pointer tool cleanup incomplete");
    })().finally(() => { this.stopping = null; });
    return this.stopping;
  }
}

let controller: SharedPointerController | null = null;
export async function setupSharedPointer() {
  if (controller?.isRunning) return;
  if (controller) { await controller.stop(); controller = null; }
  const next = new SharedPointerController(); controller = next;
  try { await next.start(); } catch (error) { await next.stop(); if (controller === next) controller = null; throw error; }
}
export async function teardownSharedPointer() { const previous = controller; await previous?.stop(); if (controller === previous) controller = null; }
export async function activateSharedPointer() { await controller?.activate(); }
export { POINTER_ACTIVATE, POINTER_ID } from "./protocol";
