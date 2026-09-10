import OBR, { fixture } from "./suite-wiring-sdk";
export * from "./suite-wiring-sdk";
const sdk: any = OBR;
const listeners = new Set<(items: any[]) => void>();
const state = {
  items: new Map<string, any>(), reads: {} as Record<string, number>, writeDelay: 0, failWrite: false, readyReadDelay: 0,
  writes: 0, callbacks: 0, notifications: [] as string[], tools: new Map<string, any>(), modals: new Map<string, any>(),
  emitItems() { for (const listener of listeners) listener([...this.items.values()]); },
};
sdk.scene.isReady = async () => {
  const ready = fixture.ready;
  if (state.readyReadDelay) await new Promise((done) => setTimeout(done, state.readyReadDelay));
  return ready;
};
sdk.scene.items.getItems = async (ids?: string[]) => {
  const items = [...state.items.values()].filter((item) => !ids || ids.includes(item.id));
  const snapshot = structuredClone(items);
  const delay = Math.max(0, ...items.map((item) => state.reads[item.id] ?? 0));
  if (delay) await new Promise((done) => setTimeout(done, delay));
  return snapshot;
};
sdk.scene.items.onChange = (listener: (items: any[]) => void) => { listeners.add(listener); return () => listeners.delete(listener); };
sdk.scene.items.updateItems = async (ids: string[], update: (items: any[]) => void) => {
  if (state.writeDelay) await new Promise((done) => setTimeout(done, state.writeDelay));
  if (state.failWrite) throw Error("Delayed SDK write failed");
  const drafts = structuredClone(ids.map((id) => state.items.get(id)).filter(Boolean));
  const before = JSON.stringify(drafts); state.callbacks++; update(drafts);
  if (before !== JSON.stringify(drafts)) {
    state.writes++; for (const draft of drafts) state.items.set(draft.id, draft); state.emitItems();
  }
};
sdk.tool = { create: async (tool: any) => { state.tools.set(tool.id, tool); }, remove: async (id: string) => { state.tools.delete(id); } };
sdk.modal = {
  open: async (options: any) => { if (fixture.open) await fixture.open(); fixture.opened.push(options); state.modals.set(options.id, options); },
  close: async (id: string) => { fixture.closed.push(id); state.modals.delete(id); },
};
sdk.notification.show = async (message: string) => { state.notifications.push(message); return "notification"; };
(globalThis as any).__resourceSdk = state;
(globalThis as any).__resourceFixture = fixture;
export default sdk;
