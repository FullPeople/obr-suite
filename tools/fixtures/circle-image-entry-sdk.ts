import BroadcastApi from "../../node_modules/@owlbear-rodeo/sdk/lib/api/BroadcastApi";
import ToolApi from "../../node_modules/@owlbear-rodeo/sdk/lib/api/ToolApi";
import PopoverApi from "../../node_modules/@owlbear-rodeo/sdk/lib/api/PopoverApi";
import PlayerApi from "../../node_modules/@owlbear-rodeo/sdk/lib/api/PlayerApi";
import ViewportApi from "../../node_modules/@owlbear-rodeo/sdk/lib/api/ViewportApi";

// Only the host message bus and local language store are replaced. Registration,
// callback replacement, URL normalization and role subscriptions use SDK 3.1.0.
const listeners = new Map<string, Set<(data: any) => unknown>>();
const on = (key: string, fn: (data: any) => unknown) => {
  if (!listeners.has(key)) listeners.set(key, new Set());
  listeners.get(key)!.add(fn);
  return () => { listeners.get(key)?.delete(fn); };
};
const emit = async (key: string, data: any) => { await Promise.all([...listeners.get(key) ?? []].map(fn => fn(data))); };
type Hold = { type: string; resolve: () => void; reject: () => void };
export const fixture = {
  connectionId: "local-connection", lang: "zh" as "zh" | "en", role: "GM" as "GM" | "PLAYER", width: 1201,
  calls: [] as Array<{ type: string; data: any }>, tools: new Map<string, any>(), popovers: new Map<string, any>(),
  activeTool: "rodeo.owlbear.tool/move", activeMode: "existing-mode", selection: ["selected-token"],
  toolMetadata: { retained: "user selection" }, opens: 0, closes: 0,
  holdNext: "", held: null as Hold | null, failNext: "", failAfterApply: "",
  language(lang: "en" | "zh") { this.lang = lang; return emit("language", lang); },
  changeRole(role: "GM" | "PLAYER") { this.role = role; return emit("OBR_PLAYER_EVENT_CHANGE", { player: { id: "self", name: "Fixture", role } }); },
  listenerCount: (key: string) => listeners.get(key)?.size ?? 0,
  event: emit,
};
function apply(type: string, data: any) {
  if (type === "OBR_TOOL_CREATE") fixture.tools.set(data.id, data);
  if (type === "OBR_TOOL_REMOVE") fixture.tools.delete(data.id);
  if (type === "OBR_TOOL_ACTIVATE") fixture.activeTool = data.id;
  if (type === "OBR_POPOVER_OPEN") {
    fixture.popovers.set(data.id, { config: data, instance: ++fixture.opens, draft: "unsaved crop and image" });
  }
  if (type === "OBR_POPOVER_CLOSE") { fixture.closes++; fixture.popovers.delete(data.id); }
}
const bus = {
  on, off: (key: string, fn: any) => listeners.get(key)?.delete(fn),
  send(type: string, data: any) { fixture.calls.push({ type, data: structuredClone(data) }); apply(type, data); },
  async sendAsync(type: string, data: any) {
    fixture.calls.push({ type, data: structuredClone(data) });
    // A held query captures the host value at dispatch, including a now-stale GM role.
    const response = type === "OBR_PLAYER_GET_CONNECTION_ID" ? { connectionId: fixture.connectionId } : type === "OBR_PLAYER_GET_ROLE" ? { role: fixture.role } : type === "OBR_VIEWPORT_GET_WIDTH" ? { width: fixture.width } : {};
    if (fixture.holdNext === type) {
      fixture.holdNext = "";
      await new Promise<void>((resolve, reject) => { fixture.held = { type, resolve, reject: () => reject(new Error(`controlled rejection: ${type}`)) }; });
      fixture.held = null;
    }
    if (fixture.failNext === type) { fixture.failNext = ""; throw new Error(`controlled rejection: ${type}`); }
    apply(type, data);
    if (fixture.failAfterApply === type) { fixture.failAfterApply = ""; throw new Error(`controlled lost reply: ${type}`); }
    return response;
  },
};
export const getLocalLang = () => fixture.lang;
export const onLangChange = (fn: any) => on("language", fn);
export default { broadcast: new BroadcastApi(bus as any), tool: new ToolApi(bus as any), popover: new PopoverApi(bus as any), player: new PlayerApi(bus as any), viewport: new ViewportApi(bus as any) };
