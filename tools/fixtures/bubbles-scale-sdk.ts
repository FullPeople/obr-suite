// Host transport fixture only. All emitted geometry uses the installed SDK's
// real builders and Math2. This fixture does not emulate the canvas renderer.
import { CurveBuilder } from "../../node_modules/@owlbear-rodeo/sdk/lib/builders/CurveBuilder";
import { EffectBuilder } from "../../node_modules/@owlbear-rodeo/sdk/lib/builders/EffectBuilder";
import { ShapeBuilder } from "../../node_modules/@owlbear-rodeo/sdk/lib/builders/ShapeBuilder";
import { TextBuilder } from "../../node_modules/@owlbear-rodeo/sdk/lib/builders/TextBuilder";
export { Math2 } from "../../node_modules/@owlbear-rodeo/sdk/lib/math/Math2";
export type { Image, Item, Vector2 } from "@owlbear-rodeo/sdk";
const player: any = { id: "fixture-gm" };
export const buildCurve = () => new CurveBuilder(player);
export const buildEffect = () => new EffectBuilder(player);
export const buildShape = () => new ShapeBuilder(player);
export const buildText = () => new TextBuilder(player);
export const isImage = (item: any) => item?.type === "IMAGE";
const itemsListeners = new Set<(items: any[]) => void>();
const metaListeners = new Set<(meta: any) => void>();
const readyListeners = new Set<(ready: boolean) => void>();
const playerListeners = new Set<(player: any) => void>();
const gridListeners = new Set<(grid: any) => void>();
const broadcasts = new Map<string, Set<(event: any) => void>>();
function subscribe<T>(set: Set<T>, callback: T) { set.add(callback); return () => set.delete(callback); }
const copy = <T>(value: T): T => structuredClone(value);
export const fixture = {
  items: [] as any[], local: new Map<string, any>(), ready: true,
  metadata: { "com.obr-suite/bubbles/settings": { verticalOffset: -20, overheadMode: false } } as any,
  dpi: 150, role: "GM", readGate: null as Promise<void> | null, addGate: null as Promise<void> | null,
  roleGate: null as Promise<void> | null, readyGate: null as Promise<void> | null,
  sharedWriteGate: null as Promise<void> | null,
  failNextAdd: false,
  counts: { reads: 0, roleReads: 0, readyReads: 0, add: 0, remove: 0, update: 0, sharedWrites: 0, added: 0 },
  emitItems() { for (const fn of itemsListeners) fn(copy(fixture.items)); },
  setMetadata(meta: any) { fixture.metadata = meta; for (const fn of metaListeners) fn(copy(meta)); },
  setReady(ready: boolean) { fixture.ready = ready; for (const fn of readyListeners) fn(ready); },
  setRole(role: string) { fixture.role = role; for (const fn of playerListeners) fn({ id: player.id, role }); },
  setDpi(dpi: number) { fixture.dpi = dpi; for (const fn of gridListeners) fn({ dpi }); },
  broadcast(channel: string, data: any) { for (const fn of broadcasts.get(channel) ?? []) fn({ data }); },
  listenerCount() { return itemsListeners.size + metaListeners.size + readyListeners.size + playerListeners.size + gridListeners.size + [...broadcasts.values()].reduce((n, set) => n + set.size, 0); },
  resetCounts() { for (const key of Object.keys(fixture.counts) as Array<keyof typeof fixture.counts>) fixture.counts[key] = 0; },
};
const sdk: any = {
  player: { getRole: async () => { fixture.counts.roleReads++; const role = fixture.role; if (fixture.roleGate) await fixture.roleGate; return role; }, getId: async () => player.id, onChange: (fn: any) => subscribe(playerListeners, fn) },
  scene: {
    isReady: async () => { fixture.counts.readyReads++; const ready = fixture.ready; if (fixture.readyGate) await fixture.readyGate; return ready; },
    onReadyChange: (fn: any) => subscribe(readyListeners, fn),
    getMetadata: async () => copy(fixture.metadata),
    setMetadata: async (meta: any) => { fixture.counts.sharedWrites++; fixture.setMetadata({ ...fixture.metadata, ...meta }); },
    onMetadataChange: (fn: any) => subscribe(metaListeners, fn),
    grid: { getDpi: async () => fixture.dpi, onChange: (fn: any) => subscribe(gridListeners, fn) },
    items: {
      getItems: async () => { fixture.counts.reads++; const snapshot = copy(fixture.items); const gate = fixture.readGate; if (gate) await gate; return snapshot; },
      onChange: (fn: any) => subscribe(itemsListeners, fn),
      updateItems: async (ids: string[], update: any) => { fixture.counts.sharedWrites++; const gate = fixture.sharedWriteGate; if (gate) await gate; update(fixture.items.filter(it => ids.includes(it.id))); },
    },
    local: {
      getItems: async (filter?: any) => copy([...fixture.local.values()].filter(it => !filter || (typeof filter === "function" ? filter(it) : filter.includes(it.id)))),
      addItems: async (items: any[]) => { fixture.counts.add++; const gate = fixture.addGate; if (gate) await gate; if (fixture.failNextAdd) { fixture.failNextAdd = false; throw new Error("fixture local add failed"); } for (const it of items) fixture.local.set(it.id, copy(it)); fixture.counts.added += items.length; },
      deleteItems: async (ids: string[]) => { fixture.counts.remove++; for (const id of ids) fixture.local.delete(id); },
      updateItems: async (ids: string[], update: any) => { fixture.counts.update++; update([...fixture.local.values()].filter(it => ids.includes(it.id))); },
    },
  },
  tool: { removeMode: async () => {} },
  broadcast: { onMessage: (channel: string, fn: any) => { let set = broadcasts.get(channel); if (!set) { set = new Set(); broadcasts.set(channel, set); } return subscribe(set, fn); } },
};
export default sdk;
