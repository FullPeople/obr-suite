import OBR, { type Image } from "@owlbear-rodeo/sdk";
import { getLocalLang, onLangChange } from "../state";
import { assetUrl } from "../asset-base";
import { TIME_STOP_META, TIME_STOP_MODAL, TIME_STOP_READY, TIME_STOP_VIEW, TIME_STOP_HIDE, TIME_STOP_HIDDEN,
  TIME_STOP_RETRY, CG_FADE_MS, readTimeStop, validCgUrl } from "./timeStopProtocol";

const LEGACY_LOCK = "com.time-stop/locked-by-timestop";
const DRAG_LOCK = "com.time-stop/drag-lock";
const MENU = "com.time-stop/show-as-cg";
const ON = "com.time-stop/on", OFF = "com.time-stop/off";
const TOGGLE = "com.obr-suite/timestop-toggle", STATE = "com.obr-suite/timestop-state";
type State = ReturnType<typeof readTimeStop>;
type Session = {
  alive: boolean; ready: boolean | undefined; epoch: number; role: "GM" | "PLAYER"; roleRevision: number;
  connection: string; id: string; initialized: boolean; readRevision: number; hasMetadata: boolean;
  state: State; displayRevision: number; desiredKey: string; busy: boolean; menuTouched: boolean; menuLabel?: string;
  unsubs: Array<() => void>; drags: Set<Promise<void>>; startup?: Promise<void>;
};
type WindowLease = {
  owner: Session; id: string; nonce: string; key: string; opening: Promise<void>; closing?: Promise<void>;
  wantsClose: boolean; hidden?: () => void; forceHidden?: () => void; failed: boolean;
};
let session: Session | undefined;
const windows = new Set<WindowLease>(), retired = new Set<Session>();
let menuQueue = Promise.resolve();
const current = (own: Session) => own.alive && session === own;
const sceneCurrent = (own: Session, epoch: number) => current(own) && own.ready === true && own.epoch === epoch;
const log = (error: unknown) => console.warn("[timeStop]", error);
const local = (channel: string, data: unknown) => OBR.broadcast.sendMessage(channel, data, { destination: "LOCAL" });
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
function menuWork(work: () => Promise<void>): Promise<void> {
  const result = menuQueue.then(work); menuQueue = result.catch(log); return result;
}
async function role(own: Session) {
  const revision = own.roleRevision;
  const value = await OBR.player.getRole();
  if (current(own) && revision === own.roleRevision) own.role = value;
  return own.role;
}
async function notify(own: Session) {
  if (current(own)) await local(STATE, { active: own.ready === true && own.state.active }).catch(log);
}

/** Exact per-window ownership: old close/open replies never target a newer CG. */
function closeWindow(lease: WindowLease, animate = true): Promise<void> {
  lease.wantsClose = true;
  if (!animate) lease.forceHidden?.();
  if (lease.closing) return lease.closing;
  const work = (async () => {
    if (animate && !lease.failed) {
      await new Promise<void>(resolve => {
        let done = false;
        const finish = () => { if (done) return; done = true; clearTimeout(timer); lease.hidden = undefined; lease.forceHidden = undefined; resolve(); };
        const timer = setTimeout(finish, CG_FADE_MS + 300);
        lease.hidden = finish; lease.forceHidden = finish;
        void local(TIME_STOP_HIDE, { nonce: lease.nonce }).catch(finish);
      });
    }
    await lease.opening.catch(() => {});
    try {
      await OBR.modal.close(lease.id);
      windows.delete(lease);
      lease.failed = false;
    } catch (error) {
      // Keep the exact ID for lifecycle retry; a close error is not success.
      lease.failed = true;
      await local(TIME_STOP_VIEW, { nonce: lease.nonce, error: true }).catch(log);
      throw error;
    }
  })();
  lease.closing = work.finally(() => { lease.closing = undefined; });
  return lease.closing;
}
async function syncOverlay(own: Session, force = false) {
  if (!current(own) || !own.initialized) return;
  const key = own.ready === true && own.state.active ? JSON.stringify([own.role, own.state.cgUrl]) : "";
  const existing = [...windows].find(w => w.owner === own && !w.wantsClose && w.key === key);
  if (!force && own.desiredKey === key && (key === "" ? ![...windows].some(w => w.owner === own) : existing)) return;
  own.desiredKey = key;
  const revision = ++own.displayRevision;
  const closing = [...windows].filter(w => w.owner === own);
  for (const lease of closing) await closeWindow(lease, own.ready === true);
  if (!current(own) || revision !== own.displayRevision || !key || own.ready !== true) return;
  const epoch = own.epoch, nonce = crypto.randomUUID();
  const url = new URL(assetUrl("timestop-overlay.html"));
  url.searchParams.set("window", nonce); url.searchParams.set("lang", getLocalLang());
  if (own.state.cgUrl) url.searchParams.set("cg", own.state.cgUrl);
  try { if (localStorage.getItem("com.obr-suite/transitions/reduced-motion") === "1") url.searchParams.set("reduced", "1"); } catch {}
  const lease: WindowLease = { owner: own, id: TIME_STOP_MODAL + "/" + nonce, nonce, key,
    opening: Promise.resolve(), wantsClose: false, failed: false };
  windows.add(lease);
  lease.opening = OBR.modal.open({ id: lease.id, url: url.href, fullScreen: true, hidePaper: true, hideBackdrop: true,
    disablePointerEvents: own.role === "GM" });
  try { await lease.opening; }
  catch (error) { await closeWindow(lease, false).catch(log); throw error; }
  if (!sceneCurrent(own, epoch) || revision !== own.displayRevision) await closeWindow(lease, false);
}

/** Interrupt only this player's in-flight selection and restore only our locks. */
function interruptSelection(own: Session) {
  const epoch = own.epoch;
  const marker = crypto.randomUUID();
  let locked: string[] = [];
  const job = (async () => {
    try {
      const selected = await OBR.player.getSelection();
      if (!sceneCurrent(own, epoch) || own.role !== "PLAYER" || !selected?.length) return;
      await OBR.scene.items.updateItems(selected, drafts => {
        if (!sceneCurrent(own, epoch) || own.role !== "PLAYER") return;
        for (const item of drafts) if (!item.locked) {
          locked.push(item.id); item.locked = true;
          item.metadata[DRAG_LOCK] = { marker, at: Date.now() };
        }
      }).catch(log);
      if (sceneCurrent(own, epoch) && own.role === "PLAYER") await OBR.player.deselect().catch(log);
      await delay(250);
    } finally {
      // During same-scene teardown, the ready listener remains attached until
      // these restorations drain. A scene switch invalidates the old draft.
      if (own.ready === true && own.epoch === epoch && locked.length) {
        await OBR.scene.items.updateItems(locked, drafts => {
          if (own.ready !== true || own.epoch !== epoch) return;
          for (const item of drafts) if ((item.metadata[DRAG_LOCK] as any)?.marker === marker) {
            item.locked = false; delete item.metadata[DRAG_LOCK];
          }
        }).catch(log);
      }
    }
  })().catch(log);
  own.drags.add(job); void job.finally(() => own.drags.delete(job));
}
async function cleanLegacyLocks(own: Session) {
  const epoch = own.epoch, revision = own.roleRevision;
  if (!sceneCurrent(own, epoch) || own.role !== "GM") return;
  const expired = (value: unknown) => {
    const tag = value as { marker?: unknown; at?: unknown } | undefined;
    return typeof tag?.marker === "string" && typeof tag.at === "number" && tag.at < Date.now() - 1_000;
  };
  const items = await OBR.scene.items.getItems(item => item.metadata[LEGACY_LOCK] === true || expired(item.metadata[DRAG_LOCK]));
  if (!sceneCurrent(own, epoch) || revision !== own.roleRevision || own.role !== "GM" || !items.length) return;
  await OBR.scene.items.updateItems(items.map(i => i.id), drafts => {
    if (!sceneCurrent(own, epoch) || revision !== own.roleRevision || own.role !== "GM") return;
    for (const item of drafts) if (item.metadata[LEGACY_LOCK] === true || expired(item.metadata[DRAG_LOCK])) {
      item.locked = false; delete item.metadata[LEGACY_LOCK]; delete item.metadata[DRAG_LOCK];
    }
  });
}
function applyState(own: Session, metadata: Record<string, unknown>) {
  const wasActive = own.state.active;
  own.state = readTimeStop(metadata[TIME_STOP_META]); own.hasMetadata = true;
  if (!current(own) || own.ready !== true) return;
  if (own.state.active && !wasActive && own.role === "PLAYER") interruptSelection(own);
  void syncOverlay(own).catch(log); void notify(own);
}
async function refreshState(own: Session) {
  const epoch = own.epoch, revision = ++own.readRevision;
  const metadata = await OBR.scene.getMetadata();
  if (!sceneCurrent(own, epoch) || own.readRevision !== revision) return;
  applyState(own, metadata);
}
async function writeState(own: Session, mode: "toggle" | "on" | "cg", itemId?: string) {
  if (!current(own) || own.busy || own.ready !== true) return;
  own.busy = true;
  const epoch = own.epoch, roleRevision = own.roleRevision;
  const valid = () => sceneCurrent(own, epoch) && own.roleRevision === roleRevision && own.role === "GM";
  try {
    if (await role(own) !== "GM" || !valid()) return;
    let cgUrl: string | null = null;
    if (mode === "cg") {
      const items = await OBR.scene.items.getItems([itemId!]);
      if (!valid()) return;
      const item = items[0] as Image | undefined;
      if (!item || item.id !== itemId || item.type !== "IMAGE" || item.layer === "CHARACTER" || !validCgUrl(item.image?.url)) return;
      cgUrl = item.image.url;
    }
    const metadata = await OBR.scene.getMetadata();
    if (!valid()) return;
    const previous = readTimeStop(metadata[TIME_STOP_META]);
    if (mode === "on" && previous.active) return;
    const active = mode === "toggle" ? !previous.active : true;
    await OBR.scene.setMetadata({ [TIME_STOP_META]: { active, ...(cgUrl ? { cgUrl } : {}) } });
    if (!valid()) return;
    await OBR.broadcast.sendMessage(active ? ON : OFF, {}, { destination: "REMOTE" });
    if (!valid()) return;
    await refreshState(own);
    if (active && valid()) {
      await cleanLegacyLocks(own).catch(log);
      if (valid()) await local("com.obr-suite/cluster-row-open", {}).catch(log);
    }
  } catch (error) { log(error); }
  finally { own.busy = false; }
}
async function refreshMenu(own: Session) {
  if (!current(own) || !own.initialized || own.role !== "GM") return;
  const label = getLocalLang() === "en" ? "Show as CG" : "显示为 CG";
  if (own.menuLabel === label) return;
  own.menuTouched = true; own.menuLabel = undefined;
  await OBR.contextMenu.create({ id: MENU,
    icons: [{ icon: assetUrl("timestop-icon.svg"), label,
      filter: { roles: ["GM"], every: [{ key: "type", value: "IMAGE" }, { key: "layer", value: "CHARACTER", operator: "!=" }], min: 1, max: 1 } }],
    onClick: async context => {
      if (!current(own) || own.role !== "GM" || context.items.length !== 1) return;
      await writeState(own, "cg", context.items[0].id);
    } });
  own.menuLabel = label;
}
async function remoteHint(own: Session, sender: string) {
  const epoch = own.epoch;
  if (!sceneCurrent(own, epoch)) return;
  const peers = await OBR.party.getPlayers();
  if (!sceneCurrent(own, epoch) || !peers.some(peer => peer.connectionId === sender && peer.role === "GM")) return;
  // The broadcast is a wake-up hint; image/active values come from the scene.
  await refreshState(own);
}
export async function turnOnTimeStop(): Promise<void> {
  const own = session;
  if (own) await writeState(own, "on");
}
export async function setupTimeStop(): Promise<void> {
  if (session) return session.startup;
  const own: Session = { alive: true, ready: undefined, epoch: 0, role: "PLAYER", roleRevision: 0,
    connection: "", id: "", initialized: false, readRevision: 0, hasMetadata: false, state: { active: false, cgUrl: null },
    displayRevision: 0, desiredKey: "", busy: false, menuTouched: false, unsubs: [], drags: new Set() };
  session = own;
  own.unsubs.push(OBR.scene.onReadyChange(next => {
    own.epoch++; own.ready = next; own.readRevision++; own.hasMetadata = false;
    own.state = { active: false, cgUrl: null };
    if (!current(own)) return;
    void syncOverlay(own, true).catch(log);
    if (next && own.initialized) void refreshState(own).catch(log);
    void notify(own);
  }), OBR.scene.onMetadataChange(metadata => {
    if (!current(own) || own.ready === false) return;
    own.readRevision++; applyState(own, metadata);
  }), OBR.player.onChange(player => {
    if (!current(own)) return;
    const identityChanged = !!own.id && own.id !== player.id;
    const permissionChanged = identityChanged || own.role !== player.role;
    if (permissionChanged) own.roleRevision++;
    own.role = player.role;
    if (identityChanged) { own.state = { active: false, cgUrl: null }; own.hasMetadata = false; }
    own.id = player.id;
    if (permissionChanged) void syncOverlay(own, true).catch(log);
    if (identityChanged && own.ready === true && own.initialized) void refreshState(own).catch(log);
    void menuWork(() => refreshMenu(own)).catch(log);
  }), onLangChange(() => { if (current(own)) void menuWork(() => refreshMenu(own)).catch(log); }));
  own.startup = (async () => {
    await cleanupRetired();
    if (!current(own)) return;
    const roleRevision = own.roleRevision, epoch = own.epoch;
    const [initialRole, connection, id, ready] = await Promise.all([
      OBR.player.getRole(), OBR.player.getConnectionId(), OBR.player.getId(), OBR.scene.isReady(),
    ]);
    if (!current(own)) return;
    own.connection = connection;
    if (!own.id) own.id = id;
    if (own.roleRevision === roleRevision) own.role = initialRole;
    if (own.epoch === epoch) own.ready = ready;
    if (!connection) throw new Error("Missing time-stop connection");
    own.initialized = true;
    const windowMessage = (event: { connectionId: string; data: unknown }) => {
      if (!current(own) || event.connectionId !== own.connection) return undefined;
      const nonce = (event.data as { nonce?: unknown })?.nonce;
      return [...windows].find(w => w.owner === own && w.nonce === nonce);
    };
    own.unsubs.push(
      OBR.broadcast.onMessage(TOGGLE, event => { if (current(own) && event.connectionId === own.connection) void writeState(own, "toggle"); }),
      OBR.broadcast.onMessage(ON, event => { void remoteHint(own, event.connectionId).catch(log); }),
      OBR.broadcast.onMessage(OFF, event => { void remoteHint(own, event.connectionId).catch(log); }),
      OBR.broadcast.onMessage(TIME_STOP_READY, event => {
        const lease = windowMessage(event); if (!lease) return;
        void local(lease.wantsClose || own.ready !== true ? TIME_STOP_HIDE : TIME_STOP_VIEW, { nonce: lease.nonce }).catch(log);
      }),
      OBR.broadcast.onMessage(TIME_STOP_HIDDEN, event => { windowMessage(event)?.hidden?.(); }),
      OBR.broadcast.onMessage(TIME_STOP_RETRY, event => {
        const lease = windowMessage(event); if (!lease?.failed) return;
        void closeWindow(lease, false).then(() => syncOverlay(own, true)).catch(log);
      }),
    );
    await menuWork(() => refreshMenu(own));
    if (!current(own)) return;
    if (own.ready === true) {
      if (!own.hasMetadata) await refreshState(own);
      else {
        if (own.state.active && own.role === "PLAYER") interruptSelection(own);
        await syncOverlay(own); await notify(own);
      }
      await cleanLegacyLocks(own).catch(log);
    }
  })();
  return own.startup;
}
async function cleanupRetired() {
  const pending = [...retired];
  const results = await Promise.allSettled([
    menuWork(async () => {
      for (const own of pending) if (own.menuTouched) {
        await OBR.contextMenu.remove(MENU); own.menuTouched = false;
      }
    }),
    ...pending.map(async own => {
      for (const lease of [...windows].filter(w => w.owner === own)) await closeWindow(lease, false);
      await Promise.allSettled([...own.drags]);
      own.unsubs.splice(0).forEach(off => off());
    }),
  ]);
  for (const own of pending) if (!own.menuTouched && ![...windows].some(w => w.owner === own) && !own.unsubs.length) retired.delete(own);
  const errors = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
  if (errors.length) throw new AggregateError(errors.map(r => r.reason), "Time-stop cleanup failed");
}
export async function teardownTimeStop(): Promise<void> {
  const own = session;
  if (own) { session = undefined; own.alive = false; own.displayRevision++; own.readRevision++; retired.add(own); }
  await cleanupRetired();
}
