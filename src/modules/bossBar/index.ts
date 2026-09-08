import OBR, { type Item } from "@owlbear-rodeo/sdk";
import { assetUrl } from "../../asset-base";
import { onViewportResize } from "../../utils/viewportAnchor";
import { BOSS_KEY, BOSS_STATE, BOSS_READY, MAX_BOSSES, bossConfig, eligibleBoss, publicBosses, type BossState } from "./model";
import { BOSS_PREFERENCES_CHANGED, BOSS_PREFERENCES_KEY, getBossPreferences } from "./preferences";
import { t } from "./text";
export { getBossPreferences, setBossPreferences } from "./preferences";

const PANEL = "com.obr-suite/boss-bar/overlay";
const CONFIG = "com.obr-suite/boss-bar/options";
const SHOW = "com.obr-suite/boss-bar/show", HIDE = "com.obr-suite/boss-bar/hide", OPTIONS = "com.obr-suite/boss-bar/options-menu";
let active = false, ready = false, role = "", epoch = 0, readVersion = 0, sceneVersion = 0, roleVersion = 0;
let state: BossState = { session: "", version: 0, bosses: [] };
let signature = "[]", open = false, anchorDirty = false, syncing: Promise<void> | null = null, requested = false;
let resizeOff: (() => void) | null = null;
const unsubs: Array<() => void> = [];

async function broadcastState(replay?: string): Promise<void> {
  try { await OBR.broadcast.sendMessage(BOSS_STATE, { ...state, ...(replay ? { replay } : {}) }, { destination: "LOCAL" }); }
  catch (error) { console.warn("[boss-bar] local state delivery failed", error); }
}
function publish(items: Item[]): void {
  const bosses = active && ready ? publicBosses(items) : [];
  const next = JSON.stringify(bosses);
  if (next === signature) return;
  signature = next;
  state = { ...state, version: state.version + 1, bosses };
  void broadcastState();
  void syncPanel();
}
async function refresh(): Promise<void> {
  const generation = epoch, request = ++readVersion;
  if (!active || !ready) return;
  try {
    const items = await OBR.scene.items.getItems();
    if (active && ready && epoch === generation && request === readVersion) publish(items);
  } catch (error) {
    if (active && epoch === generation && request === readVersion) publish([]);
    console.warn("[boss-bar] scene read failed", error);
  }
}
function wantsPanel(): boolean { return active && ready && state.bosses.length > 0 && !getBossPreferences().hidden; }

/** Compact transparent iframe: the SDK has no host pointer-events option.
 * Do not replace this with a fullscreen iframe or claim CSS crosses the iframe. */
function syncPanel(): Promise<void> {
  requested = true;
  if (syncing) return syncing;
  syncing = (async () => {
    while (true) {
      requested = false;
      if (!wantsPanel()) {
        resizeOff?.(); resizeOff = null;
        if (!open) return;
        try { await OBR.popover.close(PANEL); open = false; }
        catch (error) { console.warn("[boss-bar] overlay close failed", error); return; }
        continue;
      }
      if (open && !anchorDirty) {
        await OBR.popover.setHeight(PANEL, state.bosses.length === 1 ? 60 : state.bosses.length === 2 ? 102 : 144);
        return;
      }
      const generation = epoch;
      const viewportWidth = await OBR.viewport.getWidth();
      if (!wantsPanel() || generation !== epoch) continue;
      const width = Math.max(160, Math.min(600, viewportWidth - 32));
      anchorDirty = false;
      await OBR.popover.open({ id: PANEL, url: `${assetUrl("boss-bar.html")}?session=${encodeURIComponent(state.session)}`,
        width, height: state.bosses.length === 1 ? 60 : state.bosses.length === 2 ? 102 : 144,
        anchorReference: "POSITION", anchorPosition: { left: viewportWidth / 2, top: 18 },
        anchorOrigin: { horizontal: "CENTER", vertical: "TOP" }, transformOrigin: { horizontal: "CENTER", vertical: "TOP" },
        hidePaper: true, disableClickAway: true, marginThreshold: 8 });
      open = true;
      if (!resizeOff) resizeOff = onViewportResize(() => { anchorDirty = true; void syncPanel(); });
      await broadcastState();
    }
  })().catch(error => { console.warn("[boss-bar] overlay update failed", error); }).finally(() => {
    syncing = null;
    if (requested) void syncPanel();
  });
  return syncing;
}

async function editEnabled(id: string, enabled: boolean): Promise<void> {
  const generation = epoch;
  const current = () => active && ready && role === "GM" && generation === epoch;
  if (!current()) return;
  try {
    if (await OBR.player.getRole() !== "GM" || !current()) return;
    if (enabled) {
      const items = await OBR.scene.items.getItems();
      if (!current()) return;
      const token = items.find(item => item.id === id);
      if (!token || !eligibleBoss(token)) { await OBR.notification.show(t("needHp"), "WARNING"); return; }
      if (!bossConfig(token).enabled && items.filter(item => bossConfig(item).enabled && eligibleBoss(item)).length >= MAX_BOSSES) {
        await OBR.notification.show(t("limit"), "WARNING"); return;
      }
    }
    await OBR.scene.items.updateItems([id], drafts => {
      if (!current()) return;
      for (const item of drafts) {
        if (item.id !== id || item.type !== "IMAGE" || item.layer !== "CHARACTER" || (enabled && !eligibleBoss(item))) continue;
        const config = bossConfig(item);
        item.metadata[BOSS_KEY] = { ...config, enabled, order: config.order || Date.now() };
      }
    });
    if (current()) await refresh();
  } catch (error) { console.warn("[boss-bar] toggle failed", { id, enabled, error }); if (current()) await OBR.notification.show(t("failed"), "ERROR"); }
}

export async function setupBossBar(): Promise<void> {
  if (active) return;
  active = true; epoch++; ready = false; role = ""; signature = "[]";
  state = { session: crypto.randomUUID(), version: 0, bosses: [] };
  const session = state.session, sceneRead = sceneVersion, roleRead = roleVersion;
  const currentSetup = () => active && state.session === session;
  const onPreferences = () => { void syncPanel(); };
  const onStorage = (event: StorageEvent) => { if (event.key === BOSS_PREFERENCES_KEY) onPreferences(); };
  window.addEventListener("storage", onStorage);
  unsubs.push(() => window.removeEventListener("storage", onStorage),
    OBR.broadcast.onMessage(BOSS_PREFERENCES_CHANGED, onPreferences),
    OBR.broadcast.onMessage(BOSS_READY, event => {
      const message = event.data as { session?: string; requestId?: string } | undefined;
      if (message?.session === state.session && active) void broadcastState(typeof message.requestId === "string" ? message.requestId : undefined);
    }),
    OBR.scene.items.onChange(items => { if (active && ready) { readVersion++; publish(items); } }),
    OBR.scene.onReadyChange(next => {
      sceneVersion++; epoch++; readVersion++; ready = next;
      publish([]); void syncPanel(); void OBR.popover.close(CONFIG).catch(() => {});
      if (next) void refresh();
    }),
    OBR.player.onChange(player => {
      if (role === player.role) return;
      roleVersion++; epoch++; readVersion++; role = player.role;
      publish([]); void syncPanel(); void OBR.popover.close(CONFIG).catch(() => {});
      if (ready) void refresh();
    }));
  try {
    const [initialReady, initialRole] = await Promise.all([OBR.scene.isReady(), OBR.player.getRole()]);
    if (!currentSetup()) return;
    if (sceneVersion === sceneRead) ready = initialReady;
    if (roleVersion === roleRead) role = initialRole;
    const icon = assetUrl("status-icon.svg");
    const filter = { roles: ["GM"] as "GM"[], min: 1, max: 1, every: [{ key: "type", value: "IMAGE" }, { key: "layer", value: "CHARACTER" }] };
    await OBR.contextMenu.create({ id: SHOW, icons: [{ icon, label: t("show"), filter: { ...filter,
      every: [...filter.every, { key: ["metadata", BOSS_KEY, "enabled"], operator: "!=", value: true }] } }],
      onClick: ctx => { const id = ctx.items[0]?.id; if (id) void editEnabled(id, true); } });
    await OBR.contextMenu.create({ id: HIDE, icons: [{ icon, label: t("hide"), filter: { ...filter,
      every: [...filter.every, { key: ["metadata", BOSS_KEY, "enabled"], value: true }] } }],
      onClick: ctx => { const id = ctx.items[0]?.id; if (id) void editEnabled(id, false); } });
    await OBR.contextMenu.create({ id: OPTIONS, icons: [{ icon, label: t("configure"), filter: { ...filter,
      every: [...filter.every, { key: ["metadata", BOSS_KEY, "enabled"], value: true }] } }],
      onClick: ctx => {
        const id = ctx.items[0]?.id;
        if (!active || !ready || role !== "GM" || !id) return;
        void OBR.popover.open({ id: CONFIG, url: `${assetUrl("boss-bar.html")}?mode=config&itemId=${encodeURIComponent(id)}`,
          width: 320, height: 302, disableClickAway: false }).catch(error => console.warn("[boss-bar] options open failed", error));
      } });
    if (currentSetup()) await refresh();
  } catch (error) {
    if (currentSetup()) await teardownBossBar();
    throw error;
  }
}

export async function teardownBossBar(): Promise<void> {
  active = false; ready = false; epoch++; readVersion++;
  for (const off of unsubs.splice(0)) off();
  resizeOff?.(); resizeOff = null;
  publish([]);
  await syncPanel();
  await Promise.allSettled([OBR.popover.close(CONFIG), ...[SHOW, HIDE, OPTIONS].map(id => OBR.contextMenu.remove(id))]);
}
