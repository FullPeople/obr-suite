import ToolApi from "../../node_modules/@owlbear-rodeo/sdk/lib/api/ToolApi";
import ContextMenuApi from "../../node_modules/@owlbear-rodeo/sdk/lib/api/ContextMenuApi";
const listeners = new Map<string, Set<(data: any) => unknown>>();
const on = (key: string, fn: (data: any) => unknown) => {
  if (!listeners.has(key)) listeners.set(key, new Set());
  listeners.get(key)!.add(fn); return () => { listeners.get(key)?.delete(fn); };
};
const emit = async (key: string, data: any) => { await Promise.all([...listeners.get(key) ?? []].map(fn => fn(data))); };
export const fixture = {
  lang: "zh" as "zh" | "en", calls: [] as Array<{ type: string; data: any }>, tools: new Map<string, any>(), menus: new Map<string, any>(),
  activeTool: "rodeo.owlbear.tool/select", popovers: new Set<string>(), modal: null as any, opens: 0, closes: 0, writes: 0,
  item: { id: "token", type: "IMAGE", layer: "CHARACTER", name: "自定义角色", metadata: {} } as any,
  hold: "", release: null as null | (() => void),
  language(lang: "en" | "zh") { this.lang = lang; return emit("language", lang); },
  event: emit,
};
const bus = {
  on, off: (key: string, fn: any) => listeners.get(key)?.delete(fn), send: (type: string, data: any) => { fixture.calls.push({ type, data }); },
  async sendAsync(type: string, data: any) {
    fixture.calls.push({ type, data: structuredClone(data) });
    if (fixture.hold === type) { fixture.hold = ""; await new Promise<void>(done => { fixture.release = done; }); fixture.release = null; }
    if (["OBR_TOOL_CREATE", "OBR_TOOL_MODE_CREATE", "OBR_TOOL_ACTION_CREATE"].includes(type)) fixture.tools.set(data.id, data);
    if (["OBR_TOOL_REMOVE", "OBR_TOOL_MODE_REMOVE", "OBR_TOOL_ACTION_REMOVE"].includes(type)) fixture.tools.delete(data.id);
    if (type === "OBR_CONTEXT_MENU_CREATE") fixture.menus.set(data.id, data);
    if (type === "OBR_CONTEXT_MENU_REMOVE") fixture.menus.delete(data.id);
    if (type === "OBR_TOOL_ACTIVATE") { fixture.activeTool = data.id; await emit("OBR_TOOL_ACTIVE_EVENT_CHANGE", { id: data.id }); }
    if (type === "OBR_TOOL_GET_ACTIVE") return { id: fixture.activeTool };
    return {};
  },
};
export const getLocalLang = () => fixture.lang;
export const onLangChange = (fn: any) => on("language", fn);
export const IS_MOBILE = false;
export const syncTokenBuffs = async () => {};
export const readTokenBuffIds = () => [];
export const readTokenBuffRounds = () => ({});
export const sweepAllOurItems = async () => {};
export const invalidateAllBuffCaches = () => {};
export const getTokenCircleSpec = () => ({ cx: 0, cy: 0, radius: 20 });
export const PANEL_IDS = { statusPalette: "status" };
export const getPanelOffset = () => ({ dx: 0, dy: 0 });
export const registerPanelBbox = () => {};
export const BC_PANEL_DRAG_END = "panel-drag-end", BC_PANEL_RESET = "panel-reset";
export default {
  tool: new ToolApi(bus as any), contextMenu: new ContextMenuApi(bus as any),
  player: { getRole: async () => "PLAYER", onChange: (fn: any) => on("player", fn) },
  viewport: { getWidth: async () => 1200, getHeight: async () => 800 },
  popover: { open: async (config: any) => { fixture.opens++; fixture.popovers.add(config.id); }, close: async (id: string) => { fixture.closes++; fixture.popovers.delete(id); } },
  modal: { open: async (config: any) => { fixture.modal = config; }, close: async () => { fixture.modal = null; } },
  broadcast: { sendMessage: async (name: string, data: any) => { fixture.calls.push({ type: name, data: structuredClone(data) }); }, onMessage: (key: string, fn: any) => on(key, fn) },
  scene: { isReady: async () => true, onReadyChange: (fn: any) => on("ready", fn), getMetadata: async () => ({}), onMetadataChange: (fn: any) => on("metadata", fn),
    items: { onChange: (fn: any) => on("items", fn), getItems: async () => [structuredClone(fixture.item)], updateItems: async (_ids: string[], fn: any) => { fixture.writes++; fn([fixture.item]); } },
  },
};
