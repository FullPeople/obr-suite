import OBR, { type Item } from "@owlbear-rodeo/sdk";
import { assetUrl } from "../../asset-base";
import { readScenePlayerThreshold, DEFAULT_PLAYER_THRESHOLD } from "../bubbles/display-policy";
import { setPresentedBosses, bossReplacesHealthBar } from "./suppression";
import { validObstacle } from "./layout";
import { BOSS_KEY, BOSS_STATE, BOSS_READY, BOSS_PRESENTED, MAX_BOSSES, bossConfig, eligibleBoss, publicBosses, type BossState, type BossObstacle } from "./model";
import { BOSS_PREFERENCES_CHANGED, BOSS_PREFERENCES_KEY } from "./preferences";
import { t } from "./text";
export { getBossPreferences, setBossPreferences } from "./preferences";

const PANEL = "com.obr-suite/boss-bar/overlay";
const CONFIG = "com.obr-suite/boss-bar/options";
const SHOW = "com.obr-suite/boss-bar/show", HIDE = "com.obr-suite/boss-bar/hide", OPTIONS = "com.obr-suite/boss-bar/options-menu";
let active = false, ready = false, role = "", epoch = 0, readVersion = 0, sceneVersion = 0, roleVersion = 0;
let state: BossState = { session: "", version: 0, bosses: [] };
let signature = "[]", openedSession = "", syncing: Promise<void> | null = null, requested = false;
let playerId = "", threshold = DEFAULT_PLAYER_THRESHOLD, metadataVersion = 0;
let lastItems: Item[] = [];
let obstacles: BossObstacle[] = [];
let menuSerial: Promise<void> = Promise.resolve();
function queueMenu(work: () => Promise<void>): Promise<void> {
  const result = menuSerial.then(work); menuSerial = result.catch(() => {}); return result;
}
/** Supply only rectangles of currently open host panels, in viewport pixels. */
export function setBossBarObstacles(value: readonly BossObstacle[]): void {
  const next = value.filter(validObstacle).slice(0, 32).map(box => ({ ...box }));
  if (JSON.stringify(next) === JSON.stringify(obstacles)) return;
  obstacles = next;
  state = { ...state, version: state.version + 1, obstacles };
  if (active) void broadcastState();
}
const unsubs: Array<() => void> = [];

async function broadcastState(replay?: string): Promise<void> {
  try { await OBR.broadcast.sendMessage(BOSS_STATE, { ...state, ...(replay ? { replay } : {}) }, { destination: "LOCAL" }); }
  catch (error) { console.warn("[boss-bar] local state delivery failed", error); }
}
function publish(items: Item[]): void {
  lastItems = items;
  const bosses = active && ready ? publicBosses(items, { role, playerId, threshold }) : [];
  const next = JSON.stringify(bosses);
  if (next === signature) return;
  signature = next;
  setPresentedBosses(bosses.filter(boss => bossReplacesHealthBar(boss.id)).map(boss => boss.id));
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
function wantsPanel(): boolean { return active && ready && state.bosses.length > 0; }

/** Host-level pointer/touch pass-through, identical to the existing Time Stop
 * and resource-toast modal contract. CSS transparency alone cannot provide it. */
function syncPanel(): Promise<void> {
  requested = true;
  if (syncing) return syncing;
  syncing = (async () => {
    while (true) {
      requested = false;
      if (openedSession && (!wantsPanel() || openedSession !== state.session)) {
        setPresentedBosses([]);
        await OBR.modal.close(PANEL);
        openedSession = "";
        continue;
      }
      if (!wantsPanel()) { setPresentedBosses([]); return; }
      if (openedSession === state.session) return;
      const opening = state.session;
      // Mark a dispatched open even if its ACK fails; the recovery path closes
      // only this module's ID before any newer session can open it.
      openedSession = opening;
      try {
        await OBR.modal.open({ id: PANEL, url: `${assetUrl("boss-bar.html")}?session=${encodeURIComponent(opening)}`,
          fullScreen: true, hidePaper: true, hideBackdrop: true, disablePointerEvents: true });
      } catch (error) {
        await OBR.modal.close(PANEL); openedSession = ""; throw error;
      }
      if (!wantsPanel() || opening !== state.session) continue;
      await broadcastState();
      return;
    }
  })().catch(error => { setPresentedBosses([]); console.warn("[boss-bar] overlay update failed", error); }).finally(() => {
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
  state = { session: crypto.randomUUID(), version: 0, bosses: [], obstacles };
  lastItems = []; playerId = ""; threshold = DEFAULT_PLAYER_THRESHOLD; setPresentedBosses([]);
  const session = state.session, sceneRead = sceneVersion, roleRead = roleVersion, metadataRead = metadataVersion;
  const currentSetup = () => active && state.session === session;
  const onPreferences = () => { if (!wantsPanel()) setPresentedBosses([]); void syncPanel(); };
  const onStorage = (event: StorageEvent) => { if (event.key === BOSS_PREFERENCES_KEY) onPreferences(); };
  window.addEventListener("storage", onStorage);
  unsubs.push(() => window.removeEventListener("storage", onStorage),
    OBR.broadcast.onMessage(BOSS_PREFERENCES_CHANGED, onPreferences),
    OBR.broadcast.onMessage(BOSS_PRESENTED, event => {
      const value = event.data as { session?: unknown; version?: unknown; ids?: unknown } | undefined;
      if (!wantsPanel() || value?.session !== state.session || value.version !== state.version || !Array.isArray(value.ids)) return;
      const eligible = new Set(state.bosses.map(boss => boss.id));
      if (value.ids.every(id => typeof id === "string" && eligible.has(id))) setPresentedBosses(value.ids);
    }),
    OBR.scene.onMetadataChange(meta => {
      metadataVersion++;
      const next = readScenePlayerThreshold(meta);
      if (threshold !== next) { threshold = next; publish(lastItems); }
    }),
    OBR.broadcast.onMessage(BOSS_READY, event => {
      const message = event.data as { session?: string; requestId?: string } | undefined;
      if (message?.session === state.session && active) void broadcastState(typeof message.requestId === "string" ? message.requestId : undefined);
    }),
    OBR.scene.items.onChange(items => { if (active && ready) { readVersion++; publish(items); } }),
    OBR.scene.onReadyChange(next => {
      sceneVersion++; epoch++; readVersion++; ready = next; setPresentedBosses([]);
      publish([]); void syncPanel(); void OBR.popover.close(CONFIG).catch(() => {});
      if (next) void refresh();
    }),
    OBR.player.onChange(player => {
      roleVersion++;
      if (role === player.role && (!player.id || playerId === player.id)) return;
      epoch++; readVersion++; role = player.role; playerId = player.id || playerId; setPresentedBosses([]);
      publish([]); void syncPanel(); void OBR.popover.close(CONFIG).catch(() => {});
      if (ready) void refresh();
    }));
  try {
    const [initialReady, initialRole, initialId, initialMeta] = await Promise.all([OBR.scene.isReady(), OBR.player.getRole(), OBR.player.getId(), OBR.scene.getMetadata()]);
    if (!currentSetup()) return;
    if (sceneVersion === sceneRead) ready = initialReady;
    if (roleVersion === roleRead) { role = initialRole; playerId = initialId; }
    if (metadataVersion === metadataRead) threshold = readScenePlayerThreshold(initialMeta);
    const icon = assetUrl("status-icon.svg");
    const filter = { roles: ["GM"] as "GM"[], min: 1, max: 1, every: [{ key: "type", value: "IMAGE" }, { key: "layer", value: "CHARACTER" }] };
    await queueMenu(async () => { if (!currentSetup()) return; await OBR.contextMenu.create({ id: SHOW, icons: [{ icon, label: t("show"), filter: { ...filter,
      every: [...filter.every, { key: ["metadata", BOSS_KEY, "enabled"], operator: "!=", value: true }] } }],
      onClick: ctx => { const id = ctx.items[0]?.id; if (id) void editEnabled(id, true); } }); });
    await queueMenu(async () => { if (!currentSetup()) return; await OBR.contextMenu.create({ id: HIDE, icons: [{ icon, label: t("hide"), filter: { ...filter,
      every: [...filter.every, { key: ["metadata", BOSS_KEY, "enabled"], value: true }] } }],
      onClick: ctx => { const id = ctx.items[0]?.id; if (id) void editEnabled(id, false); } }); });
    await queueMenu(async () => { if (!currentSetup()) return; await OBR.contextMenu.create({ id: OPTIONS, icons: [{ icon, label: t("configure"), filter: { ...filter,
      every: [...filter.every, { key: ["metadata", BOSS_KEY, "enabled"], value: true }] } }],
      onClick: ctx => {
        const id = ctx.items[0]?.id;
        if (!active || !ready || role !== "GM" || !id) return;
        void OBR.popover.open({ id: CONFIG, url: `${assetUrl("boss-bar.html")}?mode=config&itemId=${encodeURIComponent(id)}`,
          width: 320, height: 302, disableClickAway: false }).catch(error => console.warn("[boss-bar] options open failed", error));
      } }); });
    if (currentSetup()) await refresh();
  } catch (error) {
    if (currentSetup()) await teardownBossBar();
    throw error;
  }
}

export async function teardownBossBar(): Promise<void> {
  active = false; ready = false; epoch++; readVersion++;
  for (const off of unsubs.splice(0)) off();
  setPresentedBosses([]);
  publish([]);
  await syncPanel();
  await Promise.allSettled([OBR.popover.close(CONFIG), queueMenu(async () => {
    for (const id of [SHOW, HIDE, OPTIONS]) await OBR.contextMenu.remove(id);
  })]);
}
