type Message = { data: unknown; connectionId: string };
const handlers = new Map<string, Set<(message: any) => void>>();
const listen = (key: string, fn: (message: any) => void) => {
  if (!handlers.has(key)) handlers.set(key, new Set());
  handlers.get(key)!.add(fn);
  return () => { handlers.get(key)?.delete(fn); };
};
export const fixture = {
  role: (globalThis as any).__transitionInitialRole ?? "GM", ready: true, language: (globalThis as any).__transitionInitialLang ?? "en", playerId: "local-player", connectionId: "local-connection",
  metadata: { "com.obr-suite/transitions/scene-key": "scene-one" } as Record<string, unknown>,
  peers: [{ id: "gm", connectionId: "gm-connection", role: "GM", name: "Mira" }, { id: "player", connectionId: "player-connection", role: "PLAYER", name: "Alex" }],
  sent: [] as Array<{ channel: string; data: any; destination: string }>,
  opened: [] as any[], closed: [] as string[], items: new Map<string, any>(),
  portal: { id: "portal-one", locked: false, visible: true, text: { plainText: "Gate" }, metadata: {
    "com.obr-suite/portals/data": { name: "Gate", tag: "001", radius: 70, effect: "fade" },
  } } as any,
  add: null as null | (() => Promise<void>), update: null as null | (() => Promise<void>), open: null as null | (() => Promise<void>),
  roleRead: null as null | (() => Promise<"GM" | "PLAYER">),
  async emit(channel: string, data: unknown, connectionId = "local-connection") {
    for (const fn of handlers.get(channel) ?? []) fn({ data, connectionId });
    await this.flush();
  },
  async flush() { for (let i = 0; i < 80; i++) await Promise.resolve(); },
  async scene(ready: boolean) { this.ready = ready; for (const fn of handlers.get("scene") ?? []) fn(ready); await this.flush(); },
  async changeRole(role: "GM" | "PLAYER") {
    this.role = role;
    for (const fn of handlers.get("player") ?? []) fn({ id: this.playerId, connectionId: this.connectionId, role });
    await this.flush();
  },
  listenerCount() { return [...handlers.values()].reduce((sum, group) => sum + group.size, 0); },
};
const OBR = {
  onReady(fn: () => void) { queueMicrotask(fn); },
  player: {
    getRole: async () => fixture.roleRead ? fixture.roleRead() : fixture.role, getId: async () => fixture.playerId, getConnectionId: async () => fixture.connectionId,
    onChange: (fn: () => void) => listen("player", fn),
  },
  party: { getPlayers: async () => fixture.peers, onChange: (fn: () => void) => listen("party", fn) },
  viewport: { getWidth: async () => 1280, getHeight: async () => 800 },
  scene: {
    isReady: async () => fixture.ready, onReadyChange: (fn: (ready: boolean) => void) => listen("scene", fn),
    getMetadata: async () => fixture.metadata,
    setMetadata: async (data: any) => { Object.assign(fixture.metadata, data); },
    items: {
      getItems: async () => [fixture.portal],
      updateItems: async (_ids: string[], update: (items: any[]) => void) => { update([fixture.portal]); },
    },
    local: {
      getItems: async (filter?: (item: any) => boolean) => [...fixture.items.values()].filter(filter ?? (() => true)),
      addItems: async (items: any[]) => { if (fixture.add) await fixture.add(); for (const item of items) fixture.items.set(item.id, item); },
      deleteItems: async (ids: string[]) => { for (const id of ids) fixture.items.delete(id); },
      updateItems: async (ids: string[], update: (items: any[]) => void) => {
        if (fixture.update) await fixture.update();
        update(ids.map((id) => fixture.items.get(id)).filter(Boolean));
      },
    },
  },
  popover: {
    open: async (options: any) => { if (fixture.open) await fixture.open(); fixture.opened.push(options); },
    close: async (id: string) => { fixture.closed.push(id); },
    setHeight: async (_id: string, _height: number) => {},
  },
  broadcast: {
    onMessage: (channel: string, fn: (message: Message) => void) => listen(channel, fn),
    sendMessage: async (channel: string, data: any, options: { destination: string }) => {
      fixture.sent.push({ channel, data, destination: options.destination });
      if (options.destination !== "REMOTE") for (const fn of handlers.get(channel) ?? []) fn({ data, connectionId: fixture.connectionId });
    },
  },
};
export function buildEffect() {
  const item: any = { id: crypto.randomUUID(), type: "EFFECT", metadata: {}, visible: true };
  const builder: any = { build: () => item };
  for (const name of ["effectType", "sksl", "uniforms", "layer", "zIndex", "disableAutoZIndex", "disableHit", "locked", "metadata"]) {
    builder[name] = (value: any) => { item[name] = value; return builder; };
  }
  return builder;
}
(globalThis as any).__transitionFixture = fixture;
export default OBR;
