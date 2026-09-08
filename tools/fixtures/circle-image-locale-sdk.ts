import AssetsApi from "../../node_modules/@owlbear-rodeo/sdk/lib/api/AssetsApi";
import PopoverApi from "../../node_modules/@owlbear-rodeo/sdk/lib/api/PopoverApi";

const listeners = new Set<(lang: "zh" | "en") => void>();
const readyCallbacks: Array<() => void> = [];
const params = new URLSearchParams(location.search);
export const fixture = {
  lang: params.get("lang") === "zh" ? "zh" as const : "en" as const,
  hold: false, reject: "", ready: params.get("wait") !== "1",
  calls: [] as Array<{ type: string; data: any }>,
  release: null as null | (() => void),
  language(lang: "zh" | "en") { this.lang = lang; listeners.forEach(fn => fn(lang)); },
  listenerCount: () => listeners.size,
  becomeReady() { this.ready = true; readyCallbacks.splice(0).forEach(fn => fn()); },
};
const bus = {
  async sendAsync(type: string, data: unknown) {
    fixture.calls.push({ type, data: structuredClone(data) });
    if (type === "OBR_ASSETS_UPLOAD_IMAGES") {
      if (fixture.hold) await new Promise<void>(done => { fixture.release = done; });
      fixture.release = null;
      if (fixture.reject) throw { data: { message: fixture.reject } };
    }
    return {};
  },
};
export const getLocalLang = () => fixture.lang;
export const onLangChange = (fn: (lang: "zh" | "en") => void) => { listeners.add(fn); return () => listeners.delete(fn); };
(globalThis as any).__circleHost = fixture;
export default {
  assets: new AssetsApi(bus as any), popover: new PopoverApi(bus as any),
  onReady(fn: () => void) { if (fixture.ready) queueMicrotask(fn); else readyCallbacks.push(fn); },
};
