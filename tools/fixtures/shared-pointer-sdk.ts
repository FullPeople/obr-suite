import ToolApi from "../../node_modules/@owlbear-rodeo/sdk/lib/api/ToolApi";
import BroadcastApi from "../../node_modules/@owlbear-rodeo/sdk/lib/api/BroadcastApi";
import SceneLocalApi from "../../node_modules/@owlbear-rodeo/sdk/lib/api/scene/SceneLocalApi";
import { PointerBuilder } from "../../node_modules/@owlbear-rodeo/sdk/lib/builders/PointerBuilder";
import { LabelBuilder } from "../../node_modules/@owlbear-rodeo/sdk/lib/builders/LabelBuilder";
import type { PointerClock } from "../../src/modules/sharedPointer/index";
import { POINTER_NETWORK, POINTER_MODE, POINTER_TOOL } from "../../src/modules/sharedPointer/protocol";
const copy = <T>(value: T): T => structuredClone(value);
const target = new EventTarget();
(globalThis as any).window = Object.assign(target, { location: { origin: "https://suite.test" } });
export const getLocalLang = () => "en";
export const buildPointer = () => new PointerBuilder({ id: "local-builder" } as any);
export const buildLabel = () => new LabelBuilder({ id: "local-builder" } as any);
export default {} as any;
export const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
export class TestClock implements PointerClock {
  value = 0; next = 1; timers = new Map<number, { at: number; fn: () => void }>();
  now = () => this.value;
  set = (fn: () => void, delay: number): any => { const id = this.next++; this.timers.set(id, { at: this.value + delay, fn }); return id; };
  clear = (id: any) => { this.timers.delete(id); };
  async advance(ms: number) {
    const end = this.value + ms; await flush();
    while (true) {
      const next = [...this.timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      this.value = next[1].at; this.timers.delete(next[0]); next[1].fn(); await flush();
    }
    this.value = end; await flush();
  }
}
export class Room {
  clients: Client[] = []; metadata: any = {}; metadataWrites = 0; failMetadata = false;
  constructor(public time = new TestClock()) {}
  publishParty() { for (const client of this.clients) client.emit("party", this.clients.filter(other => other !== client).map(other => copy(other.player))); }
  setReady(value: boolean) { for (const client of this.clients) { client.ready = value; client.emit("ready", value); if (!value) client.local.clear(); } }
}
export class Client {
  handlers = new Map<string, Set<(value: any) => void>>(); local = new Map<string, any>(); log: any[] = []; network: any[] = [];
  mode = "native-move"; ready = true; sendDelay = 0; inFlight = 0; maxInFlight = 0; holdAdd = false; pendingAdd: (() => void)[] = [];
  failDeletes = 0; invalidFastUpdates = 0; roleRead: (() => Promise<string>) | null = null;
  failModeRemove = 0; failToolRemove = 0; registeredModes = new Set<string>(); registeredTools = new Set<string>();
  notifications: string[] = []; sdk: any;
  player: any;
  constructor(public room: Room, id: string, role: "GM" | "PLAYER" = "PLAYER") {
    this.player = { id: `player-${id}`, connectionId: `connection-${id}`, role, name: `Name ${id}`, color: role === "GM" ? "#ffaa55" : "#55aaff", metadata: {}, syncView: false };
    room.clients.push(this);
    this.sdk = { tool: new ToolApi(this as any), broadcast: new BroadcastApi(this as any), room: { id: "room" },
      player: { getId: async () => this.player.id, getConnectionId: async () => this.player.connectionId, getName: async () => this.player.name, getColor: async () => this.player.color, getRole: async () => this.roleRead ? this.roleRead() : this.player.role, onChange: (fn: any) => this.subscribe("player", fn) },
      party: { getPlayers: async () => room.clients.filter(other => other !== this).map(other => copy(other.player)), onChange: (fn: any) => this.subscribe("party", fn) },
      scene: { isReady: async () => this.ready, onReadyChange: (fn: any) => this.subscribe("ready", fn), getMetadata: async () => copy(room.metadata), setMetadata: async (patch: any) => {
        if (room.failMetadata) throw Error("Metadata unavailable"); room.metadataWrites++; Object.assign(room.metadata, patch); for (const client of room.clients) client.emit("meta", copy(room.metadata));
      }, onMetadataChange: (fn: any) => this.subscribe("meta", fn), local: new SceneLocalApi(this as any), items: new Proxy({}, { get() { throw Error("Forbidden shared scene.items access"); } }) },
      notification: { show: async (message: string) => { this.notifications.push(message); return "notice"; } },
    };
  }
  on(name: string, fn: any) { if (!this.handlers.has(name)) this.handlers.set(name, new Set()); this.handlers.get(name)!.add(fn); }
  off(name: string, fn: any) { this.handlers.get(name)?.delete(fn); }
  subscribe(name: string, fn: any) { this.on(name, fn); return () => this.off(name, fn); }
  emit(name: string, data: any) { for (const fn of [...this.handlers.get(name) ?? []]) fn(data); }
  send(type: string, data: any) { this.log.push({ type, data: copy(data), at: this.room.time.now() }); }
  async sendAsync(type: string, data: any): Promise<any> {
    this.send(type, data);
    if (type === "OBR_TOOL_CREATE") this.registeredTools.add(data.id);
    if (type === "OBR_TOOL_MODE_CREATE") this.registeredModes.add(data.id);
    if (type === "OBR_TOOL_MODE_REMOVE") { if (this.failModeRemove > 0) { this.failModeRemove--; throw Error("Mode removal unavailable"); } this.registeredModes.delete(data.id); }
    if (type === "OBR_TOOL_REMOVE") { if (this.failToolRemove > 0) { this.failToolRemove--; throw Error("Tool removal unavailable"); } this.registeredTools.delete(data.id); }
    if (type === "OBR_TOOL_MODE_GET_ACTIVE") return { id: this.mode };
    if (type === "OBR_TOOL_MODE_ACTIVATE") { this.mode = data.modeId; this.emit("OBR_TOOL_MODE_EVENT_ACTIVATE", { id: this.mode, context: this.context() }); }
    if (type === "OBR_BROADCAST_SEND_MESSAGE") {
      this.inFlight++; this.maxInFlight = Math.max(this.maxInFlight, this.inFlight); this.network.push({ ...copy(data), at: this.room.time.now() });
      if (this.sendDelay) await new Promise<void>(resolve => this.room.time.set(resolve, this.sendDelay));
      for (const client of this.room.clients) if (client !== this) client.receive(data.data, this.player.connectionId, data.channel);
      this.inFlight--;
    }
    if (type === "OBR_SCENE_LOCAL_GET_ALL_ITEMS") return { items: [...this.local.values()].map(copy) };
    if (type === "OBR_SCENE_LOCAL_GET_ITEMS") return { items: data.ids.map((id: string) => this.local.get(id)).filter(Boolean).map(copy) };
    if (type === "OBR_SCENE_LOCAL_ADD_ITEMS") {
      if (this.holdAdd) await new Promise<void>(resolve => this.pendingAdd.push(resolve));
      for (const item of data.items) this.local.set(item.id, copy(item));
    }
    if (type === "OBR_SCENE_LOCAL_UPDATE_ITEMS") for (const update of data.updates) {
      if (data.fastUpdate && Object.keys(update).some(key => !["id", "type", "position"].includes(key))) { this.invalidFastUpdates++; throw Error("Pointer fixture refuses appearance writes through the documented position-only fast path"); }
      const old = this.local.get(update.id); if (old) this.local.set(update.id, { ...old, ...copy(update) });
    }
    if (type === "OBR_SCENE_LOCAL_DELETE_ITEMS") { if (this.failDeletes > 0) { this.failDeletes--; throw Error("Local delete unavailable"); } for (const id of data.ids) this.local.delete(id); }
    return {};
  }
  context() { return { activeTool: this.mode === POINTER_MODE ? POINTER_TOOL : "native-move", activeMode: this.mode, metadata: {} }; }
  move(x: number, y = 0, modeId = POINTER_MODE) { this.emit("OBR_TOOL_MODE_EVENT_TOOL_MOVE", { id: modeId, context: this.context(), event: { pointerPosition: { x, y }, altKey: false, shiftKey: false, ctrlKey: false, metaKey: false } }); }
  receive(data: any, sender: string, channel = POINTER_NETWORK) { this.emit(`OBR_BROADCAST_MESSAGE_${channel}`, { data: copy(data), connectionId: sender }); }
  switchTool() { this.mode = "native-move"; this.emit("OBR_TOOL_MODE_ACTIVE_EVENT_CHANGE", { id: this.mode }); }
}
