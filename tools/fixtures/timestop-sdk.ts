import ContextMenuApi from "../../node_modules/@owlbear-rodeo/sdk/lib/api/ContextMenuApi";
import ModalApi from "../../node_modules/@owlbear-rodeo/sdk/lib/api/ModalApi";
const handlers = new Map<string, Set<(v: any) => void>>();
function listen(key: string, fn: (v: any) => void) {
  if (!handlers.has(key)) handlers.set(key, new Set()); handlers.get(key)!.add(fn);
  return () => { handlers.get(key)?.delete(fn); };
}
export const f = {
  role: (globalThis as any).__timeStopRole ?? "GM", id: "local-player", connection: "local-connection", ready: true, lang: "en",
  failConnectionReads: (globalThis as any).__timeStopFailConnection ?? 0, failRoleReads: (globalThis as any).__timeStopFailRole ?? 0,
  metadata: {} as Record<string, unknown>, items: [] as any[], selected: [] as string[],
  sent: [] as any[], native: [] as any[], writes: [] as any[], updates: [] as string[][], deselected: 0,
  metadataRead: null as null | (() => Promise<any>), roleRead: null as null | (() => Promise<any>),
  selectionRead: null as null | (() => Promise<any>), itemsRead: null as null | (() => Promise<any>),
  connectionRead: null as null | (() => Promise<any>), updateWait: null as null | (() => Promise<void>),
  openWait: null as null | (() => Promise<void>), closeWait: null as null | (() => Promise<void>), removeWait: null as null | (() => Promise<void>),
  async flush() { for (let n = 0; n < 120; n++) await Promise.resolve(); },
  async emit(key: string, data: unknown, connectionId = this.connection) {
    for (const fn of handlers.get(key) ?? []) fn({ data, connectionId }); await this.flush();
  },
  async scene(ready: boolean) { this.ready = ready; for (const fn of handlers.get("scene") ?? []) fn(ready); await this.flush(); },
  async snapshot(meta: Record<string, unknown>) { this.metadata = structuredClone(meta); for (const fn of handlers.get("meta") ?? []) fn(this.metadata); await this.flush(); },
  async player(role = this.role, id = this.id) {
    this.role = role; this.id = id;
    for (const fn of handlers.get("player") ?? []) fn({ role, id, connectionId: this.connection }); await this.flush();
  },
  async language(lang: string) { this.lang = lang; for (const fn of handlers.get("lang") ?? []) fn(lang); await this.flush(); },
  async click(items: any[]) { for (const fn of handlers.get("OBR_CONTEXT_MENU_EVENT_CLICK") ?? []) fn({ id: "com.time-stop/show-as-cg", context: {items} }); await this.flush(); },
  listenerCount() { return [...handlers.entries()].filter(([key]) => !key.startsWith("OBR_")).reduce((n, [, value]) => n + value.size, 0); },
};
const bus = {
  on: listen,
  async sendAsync(channel: string, data: any) {
    f.native.push({ channel, data });
    if (channel === "OBR_MODAL_OPEN") await f.openWait?.();
    if (channel === "OBR_MODAL_CLOSE") await f.closeWait?.();
    if (channel === "OBR_CONTEXT_MENU_REMOVE") await f.removeWait?.();
    return {};
  },
};
const OBR = {
  onReady(fn: () => void) { queueMicrotask(fn); },
  contextMenu: new ContextMenuApi(bus as any), modal: new ModalApi(bus as any),
  player: {
    getRole: async () => { if(f.failRoleReads>0){f.failRoleReads--;throw Error("initial role failed");}return f.roleRead ? f.roleRead() : f.role; },
    getId: async () => f.id, getConnectionId: async () => { if(f.failConnectionReads>0){f.failConnectionReads--;throw Error("initial connection failed");}return f.connectionRead ? f.connectionRead() : f.connection; },
    getSelection: async () => f.selectionRead ? f.selectionRead() : f.selected,
    deselect: async () => { f.deselected++; }, onChange: (fn: any) => listen("player", fn),
  },
  party: { getPlayers: async () => [{id: "gm", role: "GM", connectionId: "gm-connection"}, {id: "other", role: "PLAYER", connectionId: "player-connection"}] },
  scene: {
    isReady: async () => f.ready, onReadyChange: (fn: any) => listen("scene", fn),
    getMetadata: async () => f.metadataRead ? f.metadataRead() : structuredClone(f.metadata),
    setMetadata: async (patch: any) => { f.writes.push(patch); Object.assign(f.metadata, patch); },
    onMetadataChange: (fn: any) => listen("meta", fn),
    items: {
      getItems: async (filter?: string[] | ((item: any) => boolean)) => f.itemsRead ? f.itemsRead() : structuredClone(f.items.filter(item => !filter || (Array.isArray(filter) ? filter.includes(item.id) : filter(item)))),
      updateItems: async (ids: string[], fn: (items: any[]) => void) => { f.updates.push(ids); await f.updateWait?.(); fn(f.items.filter(item => ids.includes(item.id))); },
    },
  },
  broadcast: {
    onMessage: (key: string, fn: any) => listen(key, fn),
    sendMessage: async (channel: string, data: any, options: any) => {
      f.sent.push({channel, data, destination: options.destination});
      if (options.destination === "LOCAL") for (const fn of handlers.get(channel) ?? []) fn({data, connectionId: f.connection});
    },
  },
};
export const getLocalLang = () => f.lang;
export const onLangChange = (fn: any) => listen("lang", fn);
(globalThis as any).__timeStopFixture = f;
export default OBR;
