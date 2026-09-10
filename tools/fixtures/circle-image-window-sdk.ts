// A shared simulated host connects the actual background and editor iframe.
// All outward SDK messages are handled in this browser; no room/API is contacted.
import ToolApi from "../../node_modules/@owlbear-rodeo/sdk/lib/api/ToolApi";
import PopoverApi from "../../node_modules/@owlbear-rodeo/sdk/lib/api/PopoverApi";
import PlayerApi from "../../node_modules/@owlbear-rodeo/sdk/lib/api/PlayerApi";
import ViewportApi from "../../node_modules/@owlbear-rodeo/sdk/lib/api/ViewportApi";
import BroadcastApi from "../../node_modules/@owlbear-rodeo/sdk/lib/api/BroadcastApi";
import AssetsApi from "../../node_modules/@owlbear-rodeo/sdk/lib/api/AssetsApi";
const root = window.parent as any;
const listeners = new Map<string, Set<(data: any) => unknown>>();
const on = (key: string, fn: (data: any) => unknown) => {
  if (!listeners.has(key)) listeners.set(key, new Set());
  listeners.get(key)!.add(fn); return () => { listeners.get(key)?.delete(fn); };
};
const endpoint = { emit: (key: string, value: any) => { for (const fn of listeners.get(key) ?? []) fn(value); }, count: (key: string) => listeners.get(key)?.size ?? 0 };
if (!root.__circleWindowHost) {
  root.__circleWindowHost = {
    languageValue: "en", calls: [], endpoints: [], tool: null, activeTool: "rodeo.owlbear.tool/move",
    failClose: false, failSend: false, failConnection: false, holdClose: false, releaseClose: null, failCloseReply: false,
    framesOpened: 0, actualCloses: 0,
    emit(key: string, data: any) { for (const target of this.endpoints) target.emit(key, data); },
    language(lang: string) { this.languageValue = lang; this.emit("language", lang); },
    click() { this.emit("OBR_TOOL_EVENT_CLICK", { id: "com.obr-suite/circleimage/tool", context: { activeTool: this.activeTool, metadata: {} } }); },
    message(channel: string, data: any, connectionId = "this-client") { this.emit(`OBR_BROADCAST_MESSAGE_${channel}`, { data, connectionId }); },
    async send(type: string, data: any) {
      this.calls.push({ type, data: structuredClone(data) });
      if (type === "OBR_PLAYER_GET_ROLE") return { role: "GM" };
      if (type === "OBR_PLAYER_GET_CONNECTION_ID") {
        if (this.failConnection) { this.failConnection = false; throw new Error("controlled connection read rejection"); }
        return { connectionId: "this-client" };
      }
      if (type === "OBR_VIEWPORT_GET_WIDTH") return { width: 960 };
      if (type === "OBR_TOOL_CREATE") this.tool = data;
      if (type === "OBR_TOOL_REMOVE") this.tool = null;
      if (type === "OBR_TOOL_ACTIVATE") this.activeTool = data.id;
      if (type === "OBR_POPOVER_OPEN") {
        document.querySelector("iframe")?.remove();
        const iframe = document.createElement("iframe");
        iframe.id = "editor"; iframe.style.cssText = "width:420px;height:600px;border:0";
        iframe.src = data.url; document.body.append(iframe); this.framesOpened++;
      }
      if (type === "OBR_POPOVER_CLOSE") {
        if (this.holdClose) await new Promise<void>(resolve => { this.releaseClose = resolve; });
        this.releaseClose = null;
        if (this.failClose) throw new Error("controlled host close rejection");
        document.querySelector("iframe")?.remove(); this.actualCloses++;
      }
      if (type === "OBR_BROADCAST_SEND_MESSAGE") {
        if (this.failSend) { this.failSend = false; throw new Error("controlled local send rejection"); }
        if (data.options?.destination !== "LOCAL") throw new Error("test forbids broadcasts to other clients");
        if (!this.failCloseReply || !data.channel.endsWith("window-close-result")) this.message(data.channel, data.data);
      }
      return {};
    },
  };
}
const host = root.__circleWindowHost;
host.endpoints.push(endpoint);
window.addEventListener("pagehide", () => { host.endpoints = host.endpoints.filter((item: any) => item !== endpoint); }, { once: true });
const bus = {
  on, off: (key: string, fn: any) => listeners.get(key)?.delete(fn),
  send(type: string, data: any) { void host.send(type, data); },
  sendAsync: (type: string, data: any) => host.send(type, data),
};
export const getLocalLang = () => host.languageValue;
export const onLangChange = (fn: any) => on("language", fn);
(window as any).__circleWindowEndpoint = endpoint;
export default {
  tool: new ToolApi(bus as any), popover: new PopoverApi(bus as any), player: new PlayerApi(bus as any),
  viewport: new ViewportApi(bus as any), broadcast: new BroadcastApi(bus as any), assets: new AssetsApi(bus as any),
  onReady: (fn: () => void) => queueMicrotask(fn),
};
