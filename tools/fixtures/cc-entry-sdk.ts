const copy = <T>(value: T): T => structuredClone(value);
export function deferred<T>(value: T) { let release!: () => void; const promise = new Promise<T>(resolve => { release = () => resolve(copy(value)); }); return { promise, release }; }
const listeners = new Map<string, Set<(value: any) => unknown>>();
const on = (key: string, callback: (value: any) => unknown) => { let group = listeners.get(key); if (!group) listeners.set(key, group = new Set()); group.add(callback); return () => group!.delete(callback); };
const storage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) } });
export const m = {
  role: "GM", id: "player", connection: "connection", room: "room", ready: true, selection: ["A"],
  items: {} as Record<string, any>, metadata: {} as Record<string, any>, listeners,
  holds: { items: false, selection: false, viewport: false, open: false, close: false, role: false, updates: false, fetch: false },
  pending: { items: [] as ReturnType<typeof deferred<any>>[], selection: [] as ReturnType<typeof deferred<any>>[], viewport: [] as ReturnType<typeof deferred<any>>[], open: [] as (() => void)[], close: [] as (() => void)[], role: [] as ReturnType<typeof deferred<any>>[], updates: [] as (() => void)[], fetch: [] as { url: string; value: any; release: (value?: any) => void }[] },
  counts: { selection: 0, items: 0, metadata: 0, viewport: 0 },
  popovers: new Map<string, any>(), modals: new Map<string, any>(), tools: new Map<string, any>(), menus: new Map<string, any>(),
  opens: [] as any[], closes: [] as string[], sent: [] as { topic: string; data: any; options: any }[], writes: [] as any[], fetches: [] as string[],
  stats: { core_stats: { hp: { max: 30 }, ac: 16, initiative: 4 } },
  emit(key: string, value: any) { for (const callback of [...listeners.get(key) ?? []]) void callback(value); },
  player(selection = this.selection, role = this.role) { this.selection = [...selection]; this.role = role; this.emit("player", { id: this.id, connectionId: this.connection, role, selection: [...selection] }); },
  scene(ready: boolean) { this.ready = ready; this.emit("ready", ready); },
  sceneItems() { this.emit("items", copy(Object.values(this.items))); },
  sceneMetadata() { this.emit("metadata", copy(this.metadata)); },
  broadcast(topic: string, data = {}, connectionId = this.connection) { this.emit(topic, { data, connectionId }); },
  release(kind: "items" | "selection" | "viewport" | "role") { for (const pending of this.pending[kind].splice(0)) pending.release(); },
  flush(kind: "open" | "close" | "updates") { for (const release of this.pending[kind].splice(0)) release(); },
  reset() {
    this.role = "GM"; this.id = "player"; this.room = "room"; this.ready = true; this.selection = ["A"];
    this.metadata = { "com.character-cards/list": [{ id: "card", visibility: "public", owner_ids: ["player"] }, { id: "other", visibility: "public", owner_ids: ["player"] }] };
    const item = (id: string, card = "card") => ({ id, type: "IMAGE", layer: "CHARACTER", createdUserId: "gm", position: { x: 0, y: 0 }, metadata: { "com.character-cards/boundCardId": card, "com.obr-suite/bubbles/data": { health: 7, "max health": 20, "temporary health": 2, "armor class": 12, locked: true } } });
    this.items = { A: item("A"), B: item("B"), C: item("C", "other") };
    for (const key of Object.keys(this.holds)) (this.holds as any)[key] = false;
    this.opens = []; this.closes = []; this.sent = []; this.writes = []; this.fetches = [];
    this.counts = { selection: 0, items: 0, metadata: 0, viewport: 0 }; storage.clear(); storage.set("character-cards/auto-info", "1");
  },
};
m.reset();
Object.defineProperty(globalThis, "fetch", { configurable: true, value: async (url: string) => {
  m.fetches.push(url); const value = copy(m.stats);
  if (m.holds.fetch) return new Promise(resolve => m.pending.fetch.push({ url, value, release: (next = value) => resolve({ ok: true, json: async () => copy(next) }) }));
  return { ok: true, json: async () => value };
} });
export const getLocalLang = () => "en";
export const assetUrl = (path: string) => path;
export const onViewportResize = (callback: () => void) => on("resize", callback);
export const PANEL_IDS = { ccInfo: "cc-info" };
export const getPanelOffset = () => ({ dx: 0, dy: 0 });
export const getPanelSize = () => null;
export const registerPanelBbox = () => {};
export const BC_PANEL_DRAG_END = "drag-end", BC_PANEL_RESET = "panel-reset";
export default {
  room: { get id() { return m.room; } },
  player: {
    getRole: async () => { if (m.holds.role) { const wait = deferred(m.role); m.pending.role.push(wait); return wait.promise; } return m.role; },
    getId: async () => m.id, getConnectionId: async () => m.connection,
    getSelection: async () => { m.counts.selection++; if (m.holds.selection) { const wait = deferred(m.selection); m.pending.selection.push(wait); return wait.promise; } return copy(m.selection); },
    onChange: (callback: any) => on("player", callback),
  },
  scene: {
    isReady: async () => m.ready, onReadyChange: (callback: any) => on("ready", callback),
    getMetadata: async () => { m.counts.metadata++; return copy(m.metadata); }, onMetadataChange: (callback: any) => on("metadata", callback),
    items: {
      getItems: async (filter: string[] | ((item: any) => boolean)) => { m.counts.items++; const value = copy(Object.values(m.items).filter(item => typeof filter === "function" ? filter(item) : filter.includes(item.id)));
        if (m.holds.items) { const wait = deferred(value); m.pending.items.push(wait); return wait.promise; } return value; },
      onChange: (callback: any) => on("items", callback),
      updateItems: async (ids: string[], callback: (drafts: any[]) => void) => {
        const write = () => { const drafts = ids.map(id => m.items[id]).filter(Boolean).map(copy), before = JSON.stringify(drafts); callback(drafts); if (before !== JSON.stringify(drafts)) { for (const draft of drafts) m.items[draft.id] = draft; m.writes.push(copy(drafts)); } };
        if (m.holds.updates) await new Promise<void>(resolve => m.pending.updates.push(() => { write(); resolve(); })); else write();
      },
    },
  },
  viewport: { getWidth: async () => { m.counts.viewport++; if (m.holds.viewport) { const wait = deferred(1200); m.pending.viewport.push(wait); return wait.promise; } return 1200; }, getHeight: async () => 800 },
  popover: {
    open: async (options: any) => { m.opens.push(copy(options)); const open = () => m.popovers.set(options.id, copy(options)); if (m.holds.open) await new Promise<void>(resolve => m.pending.open.push(() => { open(); resolve(); })); else open(); },
    close: async (id: string) => { m.closes.push(id); const close = () => m.popovers.delete(id); if (m.holds.close) await new Promise<void>(resolve => m.pending.close.push(() => { close(); resolve(); })); else close(); },
  },
  modal: { open: async (options: any) => { m.modals.set(options.id, copy(options)); }, close: async (id: string) => { m.modals.delete(id); } },
  tool: { create: async (tool: any) => { m.tools.set(tool.id, tool); }, remove: async (id: string) => { m.tools.delete(id); } },
  contextMenu: { create: async (menu: any) => { m.menus.set(menu.id, menu); }, remove: async (id: string) => { m.menus.delete(id); } },
  broadcast: { onMessage: (topic: string, callback: any) => on(topic, callback), sendMessage: async (topic: string, data: any, options: any) => { m.sent.push({ topic, data: copy(data), options }); } },
};
