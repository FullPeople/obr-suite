// A stable iframe receives a versioned target; no edits are enabled from a URL.
import OBR, { type Item } from "@owlbear-rodeo/sdk";
import { installDebugOverlay } from "./utils/debugOverlay";
import { bindPanelDrag } from "./utils/panelDrag";
import { PANEL_IDS } from "./utils/panelLayout";
import { installPanelZoom } from "./utils/panelZoom";
import { parseStatInput, clampStat, type BubblesData } from "./utils/statEdit";
import {
  HP_BAR_TARGET, HP_BAR_READY, HpTargetLease, type HpBarTarget,
  bubblesFromItem, hpViewSignature, mayEditHp, CC_BIND_KEY, CC_LIST_KEY, BUBBLES_NAME_KEY,
} from "./modules/hpBar/target";
import { writeHpStats } from "./modules/hpBar/edit";

const lease = new HpTargetLease(new URLSearchParams(location.search).get("session") ?? "");
const dragHandle = document.getElementById("dragHandle") as HTMLDivElement;
const hpPillEl = document.getElementById("hpPill") as HTMLDivElement;
const lockBtn = document.getElementById("lockBtn") as HTMLButtonElement | null;
const pinBtn = document.getElementById("panelPinBtn") as HTMLButtonElement | null;
const resetBtn = document.getElementById("resetBtn") as HTMLButtonElement | null;
const nameRowEl = document.getElementById("nameRow") as HTMLDivElement | null;
const inputs = Array.from(document.querySelectorAll<HTMLInputElement>(".stat-input"));
const LS_PINNED = "obr-suite/hp-bar-pinned";
const BC_PIN_CHANGED = "com.obr-suite/hp-bar-pin-changed";
let live: BubblesData = {};
let item: Item | undefined;
let isGM = false;
let playerId = "";
let loaded = false;
let saving = false;
let saveVersion = 0;
let viewVersion = 0;
let nameVersion = 0;
let nameSignature = "";
let signature = "";
let roleVersion = 0;
let sceneAvailable = true;
const edits = new WeakMap<HTMLInputElement, NonNullable<ReturnType<HpTargetLease["capture"]>>>();

function fmt(value: unknown): string { return String(typeof value === "number" ? value : 0); }

function controls(): void {
  const disabled = !sceneAvailable || !loaded || saving || lease.state.pending || !mayEditHp(item, isGM, playerId);
  for (const input of inputs) input.disabled = disabled;
  if (lockBtn) lockBtn.disabled = disabled || !isGM;
  if (resetBtn) resetBtn.disabled = disabled;
  document.body.classList.toggle("is-player", !isGM);
  document.body.setAttribute("aria-busy", String(!loaded || saving || lease.state.pending));
}

function paint(): void {
  for (const input of inputs) {
    if (document.activeElement !== input) input.value = fmt(live[input.dataset.field as keyof BubblesData]);
  }
  const hp = live.health ?? 0;
  const max = live["max health"] ?? 0;
  hpPillEl.style.setProperty("--hp-ratio", String(max > 0 ? Math.max(0, Math.min(1, hp / max)) : 1));
  if (lockBtn) {
    const locked = live.locked === undefined ? true : !!live.locked;
    lockBtn.dataset.locked = String(locked);
    lockBtn.title = locked
      ? "已锁定：战斗外玩家看不到血条详情。点击解锁让所有人可见。"
      : "已解锁：所有人可见血条与 AC。点击锁定恢复战斗外隐藏。";
  }
  controls();
}

function paintName(name: string): void {
  if (!nameRowEl || (nameRowEl.textContent === (name || "—") && nameRowEl.title === name)) return;
  nameRowEl.textContent = name || "—";
  nameRowEl.title = name;
}

function fallbackName(target: Item): string {
  const named = target.metadata[BUBBLES_NAME_KEY];
  return typeof named === "string" && named.trim() ? named.trim() : target.name?.trim() ?? "";
}

function nameFromCards(target: Item, metadata: Record<string, unknown>): string {
  const cards = metadata[CC_LIST_KEY];
  const cardId = target.metadata[CC_BIND_KEY];
  if (typeof cardId === "string" && Array.isArray(cards)) {
    const card = cards.find(value => value && typeof value === "object" && value.id === cardId);
    if (card && typeof card.name === "string" && card.name.trim()) return card.name.trim();
  }
  return fallbackName(target);
}

async function updateName(target: Item): Promise<void> {
  const current = lease.capture();
  const version = ++nameVersion;
  const cardId = target.metadata[CC_BIND_KEY];
  if (typeof cardId !== "string" || !cardId) { paintName(fallbackName(target)); return; }
  try {
    const metadata = await OBR.scene.getMetadata();
    if (current?.current() && version === nameVersion) paintName(nameFromCards(target, metadata));
  } catch (error) {
    console.warn("[hp-bar] card name read failed", { itemId: target.id, cardId, error });
    if (current?.current() && version === nameVersion) paintName(fallbackName(target));
  }
}

function applySnapshot(next: Item | undefined): void {
  const nextSignature = hpViewSignature(next);
  if (nextSignature === signature) return;
  // Consume this fresh event now, invalidating any older getItems response.
  lease.beginRead();
  signature = nextSignature;
  viewVersion++;
  item = next;
  loaded = !!next && mayEditHp(next, isGM, playerId);
  live = loaded ? bubblesFromItem(next) : {};
  if (!loaded) {
    lease.invalidate();
    for (const input of inputs) { edits.delete(input); input.value = ""; }
    nameVersion++;
    nameSignature = "";
    paintName("");
  } else if (next) {
    const nameKey = JSON.stringify([next.id, next.name, next.metadata[CC_BIND_KEY], next.metadata[BUBBLES_NAME_KEY]]);
    if (nameKey !== nameSignature) { nameSignature = nameKey; void updateName(next); }
  }
  paint();
}

async function refresh(): Promise<void> {
  const target = lease.capture();
  const current = lease.beginRead();
  if (!sceneAvailable || !target || !current) return;
  try {
    const items = await OBR.scene.items.getItems([target.itemId]);
    if (current()) applySnapshot(items.find(value => value.id === target.itemId));
  } catch (error) {
    console.warn("[hp-bar] target read failed", { itemId: target.itemId, error });
    if (current()) { loaded = false; paintName("读取失败，请重新选择"); controls(); }
  }
}

function acceptTarget(value: unknown): void {
  if (!value || typeof value !== "object" || !lease.accept(value as HpBarTarget)) return;
  // Invalidate drafts BEFORE disabling/blurring: blur must not write A after B.
  for (const input of inputs) {
    edits.delete(input);
    input.value = "";
    if (document.activeElement === input) input.blur();
  }
  loaded = false;
  saving = false;
  saveVersion++;
  nameVersion++;
  nameSignature = "";
  signature = "";
  item = undefined;
  live = {};
  paintName(lease.state.itemId ? "…" : "");
  controls();
  if (!lease.state.pending && lease.state.itemId) void refresh();
}

async function commitPatch(target: NonNullable<ReturnType<HpTargetLease["capture"]>>, patch: Partial<BubblesData>): Promise<void> {
  if (!target.current() || !loaded || saving) return;
  const operation = ++saveVersion;
  const before = viewVersion;
  saving = true;
  controls();
  try {
    const updated = await writeHpStats(target.itemId, patch, () => sceneAvailable && target.current() && loaded);
    // A newer SDK event wins over an older write reply on the same token too.
    if (updated && target.current() && before === viewVersion) {
      live = updated;
      paint();
    }
  } catch (error) {
    console.warn("[hp-bar] stat write failed", { itemId: target.itemId, fields: Object.keys(patch), error });
    if (target.current()) {
      void OBR.notification.show("血条更新失败，请重试", "ERROR").catch(error => console.warn("[hp-bar] notification failed", error));
    }
  } finally {
    if (operation === saveVersion) { saving = false; paint(); }
  }
}

async function commit(input: HTMLInputElement): Promise<void> {
  const target = edits.get(input);
  edits.delete(input);
  if (!target?.current() || !loaded || saving) return;
  const field = input.dataset.field as keyof BubblesData;
  const parsed = parseStatInput(input.value, (live[field] as number | undefined) ?? 0);
  if (parsed === null) { input.value = fmt(live[field]); return; }
  await commitPatch(target, { [field]: clampStat(field, parsed) });
}

for (const input of inputs) {
  input.addEventListener("focus", () => {
    const target = lease.capture();
    if (target && loaded) edits.set(input, target);
    input.select();
  });
  input.addEventListener("blur", () => { void commit(input); });
  input.addEventListener("keydown", event => {
    if (event.key === "Enter") { event.preventDefault(); input.blur(); }
    else if (event.key === "Escape") {
      event.preventDefault();
      edits.delete(input);
      input.value = fmt(live[input.dataset.field as keyof BubblesData]);
      input.blur();
    }
  });
}

lockBtn?.addEventListener("click", () => {
  const target = lease.capture();
  if (!isGM || !target) return;
  void commitPatch(target, { locked: !(live.locked === undefined ? true : !!live.locked) });
});

resetBtn?.addEventListener("click", async () => {
  const target = lease.capture();
  if (!target || !loaded || saving) return;
  try {
    await OBR.broadcast.sendMessage("com.obr-suite/bubbles-reset-token", { tokenId: target.itemId }, { destination: "LOCAL" });
    if (!target.current()) return;
    resetBtn.classList.add("flash");
    setTimeout(() => resetBtn.classList.remove("flash"), 400);
  } catch (error) { console.warn("[hp-bar] reset broadcast failed", { itemId: target.itemId, error }); }
});

function paintPin(): void {
  if (!pinBtn) return;
  let pinned = false;
  try { pinned = localStorage.getItem(LS_PINNED) === "1"; } catch {}
  pinBtn.classList.toggle("pinned", pinned);
  pinBtn.setAttribute("aria-pressed", String(pinned));
  pinBtn.title = pinned ? "已置顶（取消则恢复随选择关闭）" : "置顶面板（取消选中也保持显示）";
}

pinBtn?.addEventListener("click", async event => {
  event.preventDefault();
  event.stopPropagation();
  let pinned = false;
  try { pinned = localStorage.getItem(LS_PINNED) !== "1"; localStorage.setItem(LS_PINNED, pinned ? "1" : "0"); } catch {}
  paintPin();
  try { await OBR.broadcast.sendMessage(BC_PIN_CHANGED, { pinned }, { destination: "LOCAL" }); }
  catch (error) { console.warn("[hp-bar] pin broadcast failed", { error }); }
});

paintPin();
controls();
bindPanelDrag(dragHandle, PANEL_IDS.hpBar);
window.addEventListener("contextmenu", event => event.preventDefault());
window.addEventListener("pagehide", () => { lease.invalidate(); loaded = false; });

OBR.onReady(async () => {
  installDebugOverlay();
  installPanelZoom({ baseWidth: 320, baseHeight: 78 });
  OBR.broadcast.onMessage(HP_BAR_TARGET, event => acceptTarget(event.data));
  OBR.scene.items.onChange(items => {
    if (!sceneAvailable || !lease.state.itemId || lease.state.pending) return;
    applySnapshot(items.find(value => value.id === lease.state.itemId));
  });
  OBR.scene.onMetadataChange(metadata => {
    if (!item || !loaded || !item.metadata[CC_BIND_KEY]) return;
    nameVersion++;
    paintName(nameFromCards(item, metadata));
  });
  OBR.scene.onReadyChange(ready => {
    sceneAvailable = ready;
    if (!ready) { lease.invalidate(); loaded = false; item = undefined; controls(); }
  });
  OBR.player.onChange(player => {
    if (isGM === (player.role === "GM") && playerId === player.id) return;
    roleVersion++;
    isGM = player.role === "GM";
    playerId = player.id;
    lease.invalidate();
    loaded = false;
    signature = "";
    nameSignature = "";
    controls();
    void refresh();
  });
  const version = roleVersion;
  try {
    const [role, id] = await Promise.all([OBR.player.getRole(), OBR.player.getId()]);
    if (version === roleVersion) { isGM = role === "GM"; playerId = id; }
  } catch (error) { console.warn("[hp-bar] identity read failed", { error }); }
  // A background target can arrive while the initial identity read is pending.
  // Re-evaluate it now; the handshake reply may have the same target version.
  if (lease.state.itemId && !lease.state.pending && !loaded) {
    signature = "";
    void refresh();
  }
  // Request the current target even if an earlier broadcast was lost at boot.
  try { await OBR.broadcast.sendMessage(HP_BAR_READY, { session: lease.state.session }, { destination: "LOCAL" }); }
  catch (error) { console.warn("[hp-bar] target handshake failed", { error }); }
});
