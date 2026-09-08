import { migratePortalIconDraft, needsPortalIconMigration, readLibraryImage } from "../../src/modules/portals/appearance";
import { enablePatches, produceWithPatches } from "immer";
enablePatches();
const copy = (value: any) => structuredClone(value);
const listeners = new Map<string, Set<(event: any) => void>>();
function on(name: string, fn: (event: any) => void) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name)!.add(fn); return () => listeners.get(name)!.delete(fn); }
const seed = (window as any).portalSeed ?? {};
const key = "com.obr-suite/portals/data";
const defaultUrl = `${location.origin}/suite/portal-icon.svg`;
const defaultItem = { id: "portal", type: "IMAGE", layer: "PROP", position: { x: 340, y: 280 }, scale: { x: 1.4, y: 1.4 }, rotation: 27, visible: false, locked: true, image: { width: 64, height: 64, mime: "image/svg+xml", url: defaultUrl }, grid: { dpi: 64, offset: { x: 32, y: 32 } }, text: { plainText: "North gate" }, metadata: { [key]: { name: "North gate", tag: "gate-007", radius: 105, effect: "fade", showName: true, visible: false, locked: true }, "other-extension": { keep: 1 } } };
const m = (window as any).portalMock = {
  role: seed.role ?? "GM", ready: true, item: copy(seed.item ?? defaultItem), listeners,
  pickerCalls: [] as any[], writes: [] as any[], patches: [] as any[], pendingPicker: [] as ((images: any[]) => void)[], pendingWrites: [] as (() => void)[],
  holdWrites: false, failWrite: false, language: "en", languageCallbacks: new Set<(lang: any) => void>(),
  pendingRoles: [] as (() => void)[], holdRole: seed.holdRole ?? false,
  failRoleReads: seed.failRoleReads ?? 0,
  emit(name: string, event: any) { for (const callback of [...listeners.get(name) ?? []]) callback(event); },
  setRole(role: string) { this.role = role; this.emit("player", { role }); },
  scene(ready: boolean) { this.ready = ready; this.emit("ready", ready); },
  items() { this.emit("items", this.item ? [copy(this.item)] : []); },
  choose(images: any[]) { this.pendingPicker.shift()?.(images); },
  flush() { for (const callback of this.pendingWrites.splice(0)) callback(); },
  lang(language: string) { this.language = language; for (const callback of this.languageCallbacks) callback(language); },
  migrate(item: any) { migratePortalIconDraft(item, defaultUrl); return item; },
  needsMigration(item: any) { return needsPortalIconMigration(item, defaultUrl); },
  validImage: readLibraryImage,
};
export const getLocalLang = () => m.language;
export const onLangChange = (fn: any) => { m.languageCallbacks.add(fn); return () => m.languageCallbacks.delete(fn); };
export const assetUrl = (name: string) => `${location.origin}/suite/${name}`;
export const PANEL_IDS = { portalEdit: "portal-edit" };
export const bindPanelDrag = () => {};
export default {
  onReady: (callback: () => void) => queueMicrotask(callback),
  room: { id: "room" },
  player: { getRole: async () => { if (m.failRoleReads > 0) { m.failRoleReads--; throw Error("Injected initial role read failure"); } const role = m.role; if (m.holdRole) await new Promise<void>(resolve => m.pendingRoles.push(resolve)); return role; }, onChange: (fn: any) => on("player", fn) },
  scene: {
    isReady: async () => m.ready, onReadyChange: (fn: any) => on("ready", fn),
    items: {
      getItems: async () => m.item ? [copy(m.item)] : [], onChange: (fn: any) => on("items", fn),
      updateItems: async (_ids: string[], callback: (drafts: any[]) => void) => {
        if (m.holdWrites) await new Promise<void>(resolve => m.pendingWrites.push(resolve));
        if (m.failWrite) throw Error("Injected host write failure");
        const [next, patches] = produceWithPatches(m.item ? [copy(m.item)] : [], callback);
        if (patches.length) { m.item = copy(next[0]); m.patches.push(copy(patches)); m.writes.push(copy(next[0])); m.items(); }
      },
    },
  },
  assets: { downloadImages: (...args: any[]) => { m.pickerCalls.push(args); return new Promise<any[]>(resolve => m.pendingPicker.push(resolve)); } },
  broadcast: { sendMessage: async () => {} },
  popover: { close: async () => {} },
};
