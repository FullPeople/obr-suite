import SceneItemsApi from "../../node_modules/@owlbear-rodeo/sdk/lib/api/scene/SceneItemsApi";
const listeners = new Map<string, Set<(data: any) => void>>();
const on = (key: string, fn: (data: any) => void) => { if (!listeners.has(key)) listeners.set(key, new Set()); listeners.get(key)!.add(fn); return () => listeners.get(key)?.delete(fn); };
const emit = (key: string, data: any) => { for (const fn of [...listeners.get(key) ?? []]) fn(data); };
const copy = <T>(value: T): T => structuredClone(value);
const player = { id: "me", role: "PLAYER", color: "#99ccff", name: "Me" };
const makeItem = (id: string, owner: string) => ({ id, type: "IMAGE", name: id, visible: true, createdUserId: owner, position: { x: 0, y: 0 }, image: { url: "" }, metadata: { "com.initiative-tracker/data": { count: 15, active: id === "owned", rolled: true, ownerId: owner, tiebreak: id === "owned" ? 0.5 : 0.6 }, "com.initiative-tracker/dexMod": 3 } });
export const mock = (window as any).editMock = {
  items: [makeItem("owned", "me"), makeItem("other", "other-player")] as any[], writes: [] as any[], reads: 0, holdAt: 0, pending: [] as Array<() => void>, failWrites: false, sceneReady: true,
  role(value: string) { player.role = value; emit("player", copy(player)); },
  setOwner(id: string, owner: string, publish = true) { const item = this.items.find(item => item.id === id); if (item) item.createdUserId = owner; if (publish) this.publish(); },
  publish() { emit("OBR_SCENE_ITEMS_EVENT_CHANGE", { items: copy(this.items) }); },
  release() { this.holdAt = 0; this.pending.splice(0).forEach(resolve => resolve()); },
  ready(value: boolean) { this.sceneReady = value; emit("ready", value); },
};
const bus = {
  on: (key: string, fn: any) => { on(key, fn); }, off: (key: string, fn: any) => { listeners.get(key)?.delete(fn); }, send: () => {},
  async sendAsync(type: string, data: any) {
    if (type === "OBR_SCENE_ITEMS_GET_ITEMS" || type === "OBR_SCENE_ITEMS_GET_ALL_ITEMS") {
      mock.reads++; if (mock.reads === mock.holdAt) await new Promise<void>(resolve => mock.pending.push(resolve));
      return { items: copy(type.endsWith("GET_ALL_ITEMS") ? mock.items : mock.items.filter(item => data.ids.includes(item.id))) };
    }
    if (type === "OBR_SCENE_ITEMS_UPDATE_ITEMS") {
      if (mock.failWrites) throw Error("Host write unavailable");
      mock.writes.push(copy(data.updates)); for (const update of data.updates) { const item = mock.items.find(item => item.id === update.id); if (item) Object.assign(item, copy(update)); }
      mock.publish();
    }
    return {};
  },
};
export const getLocalLang = () => "en";
export const broadcastDiceRoll = async () => {};
export const isGlobalDarkRollEnabled = () => false;
export const readFixedRoll = () => null;
export const consumeFixedRoll = () => {};
export const randIntInclusive = () => 1;
export const sfxNextTurn = () => {};
export default {
  player: { getId: async () => player.id, getRole: async () => player.role, getColor: async () => player.color, onChange: (fn: any) => on("player", fn) },
  party: { getPlayers: async () => [], onChange: (fn: any) => on("party", fn) },
  scene: { isReady: async () => mock.sceneReady, onReadyChange: (fn: any) => on("ready", fn), items: new SceneItemsApi(bus as any), getMetadata: async () => ({ "com.initiative-tracker/combat": { preparing: true, inCombat: false, round: 0 } }), onMetadataChange: (fn: any) => on("metadata", fn) },
  broadcast: { onMessage: (name: string, fn: any) => on(name, fn), sendMessage: async () => {} },
};
