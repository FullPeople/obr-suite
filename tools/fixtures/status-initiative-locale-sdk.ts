import { useEffect, useState } from "preact/hooks";
import { ShapeBuilder } from "../../node_modules/@owlbear-rodeo/sdk/lib/builders/ShapeBuilder";
import { DEFAULT_BUFFS } from "../../src/modules/statusTracker/types";
import { statusName } from "../../src/modules/statusTracker/localization";
const seed = (window as any).localeSeed ?? {};
const events = new Map<string, Set<(data: any) => void>>();
const on = (event: string, callback: (data: any) => void) => { if (!events.has(event)) events.set(event, new Set()); events.get(event)!.add(callback); return () => events.get(event)?.delete(callback); };
const emit = (event: string, data: any) => { for (const callback of [...events.get(event) ?? []]) callback(data); };
let language: "en" | "zh" = seed.lang ?? "en";
const copy = <T>(value: T): T => structuredClone(value);
const cloneDefault = (id: string) => copy(DEFAULT_BUFFS.find(buff => buff.id === id)!);
const catalog = seed.custom ? [
  ...DEFAULT_BUFFS.filter(buff => !["u_stunned", "u_bardic", "u_hex"].includes(buff.id)),
  { ...cloneDefault("u_stunned"), name: "作者眩晕" },
  { ...cloneDefault("u_bardic"), color: "#123456" },
  { ...cloneDefault("u_hex"), webmOff: true, webmAsset: undefined },
  { id: "custom-identical-name", name: "麻痹 ⚡", color: "#cafe00", group: "自定义分类" },
] : copy(DEFAULT_BUFFS);
localStorage.setItem("obr-suite/status/defaults-version", "6");
localStorage.setItem("obr-suite/status/buff-catalog", JSON.stringify({ version: 2, buffs: catalog, groupOrder: [...new Set(catalog.map(buff => buff.group))] }));
localStorage.setItem("it-expanded", "1");
const item = (id: string, count: number, ownerId = "me") => ({ id, name: id === "hero" ? "Hero" : "作者角色", count, modifier: 3, active: id === "hero", rolled: true, imageUrl: "", inCombat: false, visible: true, hp: 15, maxHp: 20, bubblesLocked: false, bubblesHide: false, ownerId, invisible: false, tiebreak: 0 });
let initiative = { items: [item("hero", 15), item("other", 11, "other-player")], combatState: { preparing: true, inCombat: false, round: 1 }, isGM: seed.role !== "PLAYER", diceRolling: false };
const readyCallbacks: Array<() => void> = [];
const sdk = {
  onReady: (callback: () => void) => { if (seed.holdReady) readyCallbacks.push(callback); else queueMicrotask(callback); },
  player: { getId: async () => "me", getRole: async () => seed.role ?? "GM", onChange: (callback: any) => on("player", callback) },
  scene: {
    isReady: async () => true, onReadyChange: (callback: any) => on("ready", callback), getMetadata: async () => ({}), onMetadataChange: (callback: any) => on("metadata", callback), grid: { getDpi: async () => 150 },
    items: { getItems: async () => [{ id: "token", type: "IMAGE", name: "Author Token", metadata: { "com.obr-suite/status/buffs": catalog.map(buff => buff.id), "com.obr-suite/status/buff-rounds": { u_paralyzed: 3 } } }], onChange: (callback: any) => on("items", callback), updateItems: async () => { mock.writes.push("scene items"); } },
  },
  broadcast: { onMessage: (name: string, callback: any) => on(name, callback), sendMessage: async (channel: string, data: any, options: any) => { mock.broadcasts.push({ channel, data: copy(data), options }); } },
  popover: { open: async (value: any) => { mock.windows.push(["open", value]); }, close: async (id: any) => { mock.windows.push(["close", id]); }, setWidth: async () => {}, setHeight: async () => {} },
  modal: { close: async (id: any) => { mock.windows.push(["modal-close", id]); } },
  viewport: { getScale: async () => 1, transformPoint: async (point: any) => point },
  notification: { show: async (message: any) => { mock.notifications.push(message); } }, assets: { downloadImages: async () => [] },
};
export const mock = (window as any).localeMock = {
  defaults: copy(DEFAULT_BUFFS), catalog: copy(catalog), writes: [] as any[], commands: [] as any[], windows: [] as any[], broadcasts: [] as any[], notifications: [] as any[],
  lang: (value: "en" | "zh") => { language = value; emit("lang", value); },
  ready: () => { readyCallbacks.splice(0).forEach(callback => callback()); },
  model: (patch: any) => { initiative = { ...initiative, ...patch }; emit("initiative", initiative); },
  listenerCount: () => events.get("lang")?.size ?? 0,
  statusName: (buff: any, lang: "en" | "zh") => statusName(buff, lang),
  mutableDefaultDisplay: () => { const buff = DEFAULT_BUFFS[0], old = buff.color; try { buff.color = "#123456"; return statusName(buff, "en"); } finally { buff.color = old; } },
};
export const getLocalLang = () => language;
export const onLangChange = (callback: any) => on("lang", callback);
export const startSceneSync = () => {};
export const getState = () => ({ initiativeHidePercentHpBar: false });
export const onStateChange = (callback: any) => on("state", callback);
export const installDebugOverlay = () => {};
export const installPanelZoom = () => {};
export const subscribeToSfx = () => {};
export const bindPanelDrag = () => () => {};
export const PANEL_IDS = { initiative: "initiative", status: "status" };
export const setActiveRing = () => {};
export const setHoverRing = () => {};
export const clearAllRings = () => {};
export const buildShape = () => new ShapeBuilder({ id: "fixture" } as any);
export const isImage = () => false;
export type RollType = "normal" | "advantage" | "disadvantage";
export function useInitiative() {
  const [current, set] = useState(initiative);
  useEffect(() => on("initiative", set), []);
  const command = (name: string) => (...args: any[]) => { mock.commands.push([name, ...args]); };
  return { ...current, canEdit: (item: any) => current.isGM || item.ownerId === "me", focusItem: command("focus"), updateCount: command("count"), updateModifier: command("modifier"), setSortKey: command("sort"), rollInitiativeLocal: command("roll"), rollInitiativeDicePlus: command("diceplus"), startPreparation: command("prepare"), startCombat: command("start"), cancelPreparation: command("cancel"), nextTurn: command("next"), prevTurn: command("prev"), endCombat: command("end"), clearAllInitiative: command("clear"), requestEndTurn: command("endturn"), dicePlusAvailable: false, resolveOwnerColor: () => "#77bbff" };
}
export default sdk;
