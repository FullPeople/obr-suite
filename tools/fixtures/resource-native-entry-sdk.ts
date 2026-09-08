import ToolApi from "../../node_modules/@owlbear-rodeo/sdk/lib/api/ToolApi";
import ModalApi from "../../node_modules/@owlbear-rodeo/sdk/lib/api/ModalApi";
import PlayerApi from "../../node_modules/@owlbear-rodeo/sdk/lib/api/PlayerApi";
import ViewportApi from "../../node_modules/@owlbear-rodeo/sdk/lib/api/ViewportApi";
import BroadcastApi from "../../node_modules/@owlbear-rodeo/sdk/lib/api/BroadcastApi";
import SceneApi from "../../node_modules/@owlbear-rodeo/sdk/lib/api/scene/SceneApi";
const listeners = new Map<string, Set<(data: any) => unknown>>();
const on = (key: string, fn: (data: any) => unknown) => {
  if (!listeners.has(key)) listeners.set(key, new Set()); listeners.get(key)!.add(fn);
  return () => { listeners.get(key)?.delete(fn); };
};
const emit = async (key: string, data: any) => { await Promise.all([...listeners.get(key) ?? []].map(fn => fn(data))); };
export const fixture = {
  lang: "zh" as "zh" | "en", role: "GM" as "GM" | "PLAYER", ready: false, connectionId: "self",
  calls: [] as Array<{ type: string; data: any }>, tools: new Map<string, any>(), modals: new Map<string, any>(),
  activeTool: "rodeo.owlbear.tool/move", activeMode: "move-mode", selection: ["selected-token"], metadata: { draft: "custom selection" },
  sequence: 0, hold: "", holdId: "", release: null as (() => void) | null, fail: "", failId: "", failAfterApply: "",
  language(lang: "zh" | "en") { this.lang = lang; return emit("language", lang); },
  changeRole(role: "GM" | "PLAYER") { this.role = role; return emit("OBR_PLAYER_EVENT_CHANGE", { player: { id: "self", role } }); },
  scene(ready: boolean) { this.ready = ready; return emit("OBR_SCENE_EVENT_READY_CHANGE", { ready }); },
  listeners: (key: string) => listeners.get(key)?.size ?? 0,
  event: emit,
};
function apply(type: string, data: any) {
  if (type === "OBR_TOOL_CREATE") fixture.tools.set(data.id, data);
  if (type === "OBR_TOOL_REMOVE") fixture.tools.delete(data.id);
  if (type === "OBR_TOOL_ACTIVATE") fixture.activeTool = data.id;
  if (type === "OBR_MODAL_OPEN") fixture.modals.set(data.id, { config: data, sequence: ++fixture.sequence, draft: "unconfirmed resource value" });
  if (type === "OBR_MODAL_CLOSE") fixture.modals.delete(data.id);
}
const bus = {
  on, off: (key: string, fn: any) => listeners.get(key)?.delete(fn),
  send(type: string, data: any) { fixture.calls.push({ type, data: structuredClone(data) }); apply(type, data); },
  async sendAsync(type: string, data: any) {
    fixture.calls.push({ type, data: structuredClone(data) });
    const response = type === "OBR_PLAYER_GET_ROLE" ? { role: fixture.role } : type === "OBR_PLAYER_GET_CONNECTION_ID" ? { connectionId: fixture.connectionId }
      : type === "OBR_SCENE_IS_READY" ? { ready: fixture.ready } : type === "OBR_VIEWPORT_GET_WIDTH" ? { width: 1280 } : type === "OBR_VIEWPORT_GET_HEIGHT" ? { height: 800 } : {};
    if (fixture.hold === type && (!fixture.holdId || fixture.holdId === data.id)) {
      fixture.hold = ""; fixture.holdId = "";
      await new Promise<void>(done => { fixture.release = done; }); fixture.release = null;
    }
    if (fixture.fail === type && (!fixture.failId || fixture.failId === data.id)) { fixture.fail = ""; fixture.failId = ""; throw new Error(`controlled failure ${type}`); }
    apply(type, data);
    if (fixture.failAfterApply === type) { fixture.failAfterApply = ""; throw new Error(`controlled lost reply ${type}`); }
    if (/OBR_SCENE_ITEMS_UPDATE|OBR_SCENE_SET_METADATA|OBR_BROADCAST_SEND_MESSAGE/.test(type)) throw new Error(`unexpected resource write: ${type}`);
    return response;
  },
};
export const getLocalLang = () => fixture.lang;
export const onLangChange = (fn: any) => on("language", fn);
export default { tool: new ToolApi(bus as any), modal: new ModalApi(bus as any), player: new PlayerApi(bus as any), viewport: new ViewportApi(bus as any), broadcast: new BroadcastApi(bus as any), scene: new SceneApi(bus as any), notification: { show: async () => {} } };
