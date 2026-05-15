// Resource Tracker — full-screen stats panel.
//
// A DM-only overview of every player character in one place. Opened
// from the resource-tracker toolbar tool (registered GM-only in
// modules/resourceTracker/index.ts). Lists every CHARACTER-layer token
// owned by a player; each card shows that character's name, an
// editable HP / temp HP / AC / lock stat banner, and a full resource
// panel.
//
// 2026-05-15 — each card's stat banner AND resource section are the
// SAME components the character-card info popover (cc-info) shows:
// `mountStatBanner` + `mountResourcePanel`. So the UI here is
// byte-identical to cc-info's and stays in sync automatically — all
// read/write the same per-token metadata, add/edit/delete route
// through the same `resource-edit` modal, and HP/AC edits go through
// the same statEdit.ts parse/clamp/patch path. The card name uses
// cc-info's resolver too.

import OBR, { isImage, type Item } from "@owlbear-rodeo/sdk";
import {
  resolveTokenDisplayName,
  mountResourcePanel,
} from "./modules/resourceTracker/panel";
import { mountStatBanner } from "./utils/statBanner";
import type { BubblesData } from "./utils/statEdit";
import {
  type Resource,
  RESOURCES_KEY,
} from "./modules/resourceTracker/types";
import { writeResources, readResources } from "./modules/resourceTracker/storage";

const PANEL_MODAL_ID = "com.obr-suite/resources/tracker-panel";
// Shared open-state key — the background's toolbar tool reads it to
// decide open-vs-close. Cleared on every close path (X / Esc, plus
// pagehide/beforeunload for OBR's click-outside close). A synchronous
// localStorage write is reliable on unload; the async OBR broadcast
// this replaced was not — the click-twice-to-reopen bug.
const PANEL_OPEN_KEY = "com.obr-suite/resources/panel-open";

// Bubbles metadata — same field shape as the Stat Bubbles extension
// ({ health, "max health", "temporary health", "armor class", locked }).
// The suite writes its own key; some tokens still carry the legacy
// external one, so read both.
const BUBBLES_KEY = "com.obr-suite/bubbles/data";
const EXTERNAL_BUBBLES_KEY = "com.owlbear-rodeo-bubbles-extension/metadata";

const bodyEl = document.getElementById("rtBody") as HTMLDivElement;
const subEl = document.getElementById("rtSub") as HTMLSpanElement;
const closeBtn = document.getElementById("rtClose") as HTMLButtonElement;

let myId = "";

// ---- data ------------------------------------------------------------------
interface CharEntry {
  id: string;
  name: string;
  owner: string;
  // The token's bubbles metadata snapshot, handed to the stat banner
  // for a flicker-free initial paint.
  live: BubblesData;
}

async function gather(): Promise<CharEntry[]> {
  let items: Item[] = [];
  try { items = await OBR.scene.items.getItems(); } catch { return []; }

  // Currently-connected players, for the owner badge.
  const nameById = new Map<string, string>();
  try {
    const players = await OBR.party.getPlayers();
    for (const p of players) {
      if (p.role === "PLAYER") nameById.set(p.id, p.name || "玩家");
    }
  } catch { /* offline / no party — owner badge falls back to "玩家" */ }

  const out: CharEntry[] = [];
  for (const it of items) {
    if (!isImage(it)) continue;
    if (it.layer !== "CHARACTER") continue;
    const owner = it.createdUserId;
    // "Player-owned" = created by someone other than this GM. An empty
    // createdUserId (very old items) is treated as not player-owned.
    if (!owner || owner === myId) continue;
    const live = ((it.metadata[BUBBLES_KEY] ?? it.metadata[EXTERNAL_BUBBLES_KEY]) as
      BubblesData | undefined) ?? {};
    // Name follows the same priority as the character panel —
    // 角色卡名 > 怪物图鉴绑定名 > 图片名 — by reusing panel.ts's own
    // resolver, so the standalone tracker and cc-info never disagree.
    const name = (await resolveTokenDisplayName(it.id)) || it.name || "(未命名)";
    out.push({
      id: it.id,
      name,
      owner: nameById.get(owner) || "玩家",
      live,
    });
  }
  // Stable sort by owner then name so the grid doesn't jump on rerender.
  out.sort((a, b) => a.owner.localeCompare(b.owner) || a.name.localeCompare(b.name));
  return out;
}

// ---- render ----------------------------------------------------------------

// Per-character card. Persisted across renders so the mounted stat
// banner + resource panel — both self-subscribe to scene.items.onChange
// — aren't torn down + re-created on every scene change. The card head
// is owned by this page (re-rendered from gather()); the stat banner
// and resource section are live components.
interface CardState {
  el: HTMLDivElement;
  nameEl: HTMLElement;
  ownerEl: HTMLElement;
  stat: { refresh: () => Promise<void>; unmount: () => void };
  res: { refresh: () => Promise<void>; unmount: () => void };
}
const cards = new Map<string, CardState>();

function createCard(c: CharEntry): CardState {
  const el = document.createElement("div");
  el.className = "rt-char";
  el.dataset.tokenId = c.id;
  // Per-card "+ 存为预设" button — snapshots THIS character's current
  // resources into a named preset (stored in localStorage). Sits in
  // the head row, only visible on card hover so it doesn't clutter.
  el.innerHTML =
    `<div class="rt-char-head">` +
      `<span class="rt-char-name"></span>` +
      `<span class="rt-char-owner"></span>` +
      `<button class="rt-char-save-preset" type="button" title="把该角色当前所有资源存为一个预设">+ 存为预设</button>` +
    `</div>` +
    `<div class="rt-stat-mount"></div>` +
    `<div class="rt-res-mount"></div>`;
  const nameEl = el.querySelector(".rt-char-name") as HTMLElement;
  const ownerEl = el.querySelector(".rt-char-owner") as HTMLElement;
  const statEl = el.querySelector(".rt-stat-mount") as HTMLElement;
  const resEl = el.querySelector(".rt-res-mount") as HTMLElement;
  const cid = c.id;
  const savePresetBtn = el.querySelector(".rt-char-save-preset") as HTMLButtonElement;
  savePresetBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    void saveCharacterAsPreset(cid);
  });
  // Mount the SAME components the character-card info popover uses —
  // an editable HP / temp HP / AC / lock stat banner + the resource
  // panel. Identical UI + behaviour, auto-synced (all read/write the
  // same per-token metadata). isGM:true — the resource tracker is a
  // DM-only tool, so the lock button always shows.
  const stat = mountStatBanner({
    container: statEl,
    getItemId: () => cid,
    isGM: true,
    initialLive: c.live,
  });
  void stat.refresh();
  const res = mountResourcePanel({ container: resEl, getItemId: () => cid });
  void res.refresh();
  return { el, nameEl, ownerEl, stat, res };
}

function unmountCard(st: CardState): void {
  try { st.stat.unmount(); } catch {}
  try { st.res.unmount(); } catch {}
}

function render(chars: CharEntry[]): void {
  if (chars.length === 0) {
    for (const [, st] of cards) unmountCard(st);
    cards.clear();
    bodyEl.innerHTML = `<div class="rt-empty">没有找到玩家拥有的角色 token。<br>玩家把自己的角色拖进场景后，这里会列出他们的资源。</div>`;
    subEl.textContent = "全员资源总览";
    return;
  }
  // The empty-state notice isn't a card — drop it before reconciling.
  bodyEl.querySelector(".rt-empty")?.remove();

  const seen = new Set<string>();
  for (const c of chars) {
    seen.add(c.id);
    let st = cards.get(c.id);
    if (!st) {
      st = createCard(c);
      cards.set(c.id, st);
    }
    st.nameEl.textContent = c.name;
    st.ownerEl.textContent = c.owner;
    // The stat banner + resource panel are live components — they
    // self-sync on scene changes, so render() only touches the head.
  }
  // Drop cards for characters no longer in the scene — unmount their
  // components so the scene-change subscriptions don't leak.
  for (const [id, st] of cards) {
    if (!seen.has(id)) {
      unmountCard(st);
      st.el.remove();
      cards.delete(id);
    }
  }
  // Re-attach in sorted order (appendChild moves an existing child).
  for (const c of chars) {
    const st = cards.get(c.id);
    if (st) bodyEl.appendChild(st.el);
  }
  subEl.textContent = `${chars.length} 个角色 · 血量 / 资源可直接增删改，与角色面板实时同步`;
}

// ---- Presets (2026-05-15) -------------------------------------------------
//
// A resource-preset is a named bundle of Resource entries — a snapshot
// of one character's resource list at the moment of "save". Lives in
// localStorage so it's per-DM, never touches the scene.
//
//   • Each character card in the panel has a "+ 存为预设" button (visible
//     on hover) that snapshots that character's current resources.
//   • Saved presets render as chips in the panel's preset bar. Click a
//     chip → action menu (overwrite-all / merge-all / rename / delete).
//     "全员" targets every character listed in the panel (already pre-
//     filtered to player-owned CHARACTER-layer tokens).
//   • Drag a chip → drop on a single card to apply just to that one
//     (always merge — overwrite-single is too surprising via drag).
//   • JSON export/import: bundles the whole preset library.

interface ResourcePreset {
  id: string;
  name: string;
  resources: Resource[];
}

const RT_PRESETS_KEY = "obr-suite/resources/bundle-presets";

const presetsListEl = document.getElementById("rtPresetsList") as HTMLSpanElement;
const presetsEmptyEl = document.getElementById("rtPresetsEmpty") as HTMLSpanElement;
const presetExportBtn = document.getElementById("rtPresetExport") as HTMLButtonElement;
const presetImportBtn = document.getElementById("rtPresetImport") as HTMLButtonElement;
const presetFileInput = document.getElementById("rtPresetFile") as HTMLInputElement;

let rtPresets: ResourcePreset[] = [];

function rtEsc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

function loadRtPresets(): void {
  try {
    const raw = localStorage.getItem(RT_PRESETS_KEY);
    if (!raw) { rtPresets = []; return; }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) { rtPresets = []; return; }
    rtPresets = parsed.filter((p): p is ResourcePreset =>
      p && typeof p === "object"
      && typeof p.id === "string" && typeof p.name === "string"
      && Array.isArray(p.resources)
    );
  } catch { rtPresets = []; }
}
function saveRtPresets(): void {
  try { localStorage.setItem(RT_PRESETS_KEY, JSON.stringify(rtPresets)); }
  catch (e) { console.warn("[resources/presets] save failed", e); }
}
function newPresetId(): string {
  return `rp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function renderPresetsBar(): void {
  if (rtPresets.length === 0) {
    presetsEmptyEl.style.display = "";
    presetsListEl.innerHTML = "";
    return;
  }
  presetsEmptyEl.style.display = "none";
  presetsListEl.innerHTML = rtPresets.map((p) =>
    `<button class="rt-preset-chip" type="button" draggable="true"
             data-preset-id="${rtEsc(p.id)}"
             title="点击：应用菜单（覆盖/叠加全员）· 拖到角色卡：仅给那一张">${rtEsc(p.name)}<span class="pre-count">${p.resources.length}</span></button>`
  ).join("");
}

// Save THIS character's current resources as a named preset. Read the
// live token metadata (not a cached snapshot) so the preset captures
// the EDITED state, not the initial-load state.
async function saveCharacterAsPreset(tokenId: string): Promise<void> {
  let item: Item | null = null;
  try {
    const [it] = await OBR.scene.items.getItems([tokenId]);
    item = it ?? null;
  } catch { /* network blip */ }
  if (!item) return;
  const resources = readResources(item);
  if (resources.length === 0) {
    window.alert("该角色当前没有可保存的资源。先在卡片上添加几个资源再来。");
    return;
  }
  const defaultName = await resolveTokenDisplayName(tokenId)
    .catch(() => "")
    || "我的预设";
  const name = window.prompt(
    `保存为预设（${resources.length} 个资源）。给它起个名字：`,
    defaultName,
  );
  if (!name || !name.trim()) return;
  // Deep-clone so subsequent edits to the live token don't mutate the
  // saved preset's resource entries.
  const cloned = resources.map((r) => ({ ...r }));
  rtPresets.push({ id: newPresetId(), name: name.trim(), resources: cloned });
  saveRtPresets();
  renderPresetsBar();
}

function closePresetMenu(): void {
  document.querySelectorAll<HTMLElement>(".rt-preset-menu").forEach((el) => el.remove());
}

function openPresetMenu(chip: HTMLElement, preset: ResourcePreset): void {
  closePresetMenu();
  const menu = document.createElement("div");
  menu.className = "rt-preset-menu";
  menu.innerHTML =
    `<button data-act="overwrite">覆盖应用到全员（替换现有资源）</button>` +
    `<button data-act="merge">叠加应用到全员（按 id 去重合并）</button>` +
    `<button data-act="rename">重命名预设</button>` +
    `<button class="danger" data-act="delete">删除预设</button>`;
  document.body.appendChild(menu);
  const r = chip.getBoundingClientRect();
  menu.style.left = `${Math.round(r.left)}px`;
  menu.style.top = `${Math.round(r.bottom + 4)}px`;
  menu.addEventListener("click", async (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-act]");
    if (!btn) return;
    const act = btn.dataset.act;
    closePresetMenu();
    if (act === "overwrite" || act === "merge") {
      const count = await applyPresetToAll(preset, act);
      try {
        await OBR.notification.show(
          `预设「${preset.name}」已${act === "overwrite" ? "覆盖" : "叠加"}应用到 ${count} 个角色`,
          "SUCCESS",
        );
      } catch { /* notification best-effort */ }
    } else if (act === "rename") {
      const next = window.prompt("新名字：", preset.name);
      if (next && next.trim()) {
        preset.name = next.trim();
        saveRtPresets();
        renderPresetsBar();
      }
    } else if (act === "delete") {
      if (window.confirm(`删除预设「${preset.name}」？`)) {
        rtPresets = rtPresets.filter((p) => p.id !== preset.id);
        saveRtPresets();
        renderPresetsBar();
      }
    }
  });
  setTimeout(() => {
    const off = (ev: MouseEvent) => {
      if (!menu.contains(ev.target as Node)) {
        closePresetMenu();
        document.removeEventListener("mousedown", off, true);
      }
    };
    document.addEventListener("mousedown", off, true);
  }, 0);
}

// Apply a preset to every character in the panel (already filtered to
// player-owned CHARACTER tokens). overwrite = replace the whole array;
// merge = union by id (preserves user-tweaked current/max on existing
// resources, just adds any preset resource not already there).
async function applyPresetToAll(preset: ResourcePreset, mode: "overwrite" | "merge"): Promise<number> {
  const tokenIds = [...cards.keys()];
  let n = 0;
  for (const tid of tokenIds) {
    let item: Item | null = null;
    try {
      const [it] = await OBR.scene.items.getItems([tid]);
      item = it ?? null;
    } catch {}
    if (!item) continue;
    const cur = readResources(item);
    const next = mode === "overwrite"
      ? preset.resources.map((r) => ({ ...r }))
      : (() => {
          const byId = new Map(cur.map((r) => [r.id, r]));
          for (const r of preset.resources) {
            if (!byId.has(r.id)) byId.set(r.id, { ...r });
          }
          return [...byId.values()];
        })();
    try { await writeResources(tid, next); n++; } catch {}
  }
  return n;
}

async function applyPresetToToken(preset: ResourcePreset, tokenId: string): Promise<void> {
  let item: Item | null = null;
  try {
    const [it] = await OBR.scene.items.getItems([tokenId]);
    item = it ?? null;
  } catch {}
  if (!item) return;
  // Drop-on-card is always MERGE — overwriting a single character via
  // drag would be too surprising. "覆盖" lives in the click-menu only.
  const cur = readResources(item);
  const byId = new Map(cur.map((r) => [r.id, r]));
  for (const r of preset.resources) {
    if (!byId.has(r.id)) byId.set(r.id, { ...r });
  }
  try { await writeResources(tokenId, [...byId.values()]); } catch {}
  try {
    await OBR.notification.show(
      `预设「${preset.name}」已合并到 ${(await resolveTokenDisplayName(tokenId)) || "该角色"}`,
      "SUCCESS",
    );
  } catch {}
}

// Chip click → action menu; chip dragstart → wire drop targets on
// every character card (handled below).
presetsListEl.addEventListener("click", (e) => {
  const chip = (e.target as HTMLElement).closest<HTMLElement>(".rt-preset-chip");
  if (!chip) return;
  const id = chip.dataset.presetId;
  const p = rtPresets.find((x) => x.id === id);
  if (p) openPresetMenu(chip, p);
});

// HTML5 drag-and-drop: drag a chip, hover lights cards green, drop
// applies the preset to that token only.
let _draggingPreset: ResourcePreset | null = null;
presetsListEl.addEventListener("dragstart", (e) => {
  const chip = (e.target as HTMLElement).closest<HTMLElement>(".rt-preset-chip");
  if (!chip) return;
  const id = chip.dataset.presetId;
  _draggingPreset = rtPresets.find((x) => x.id === id) ?? null;
  if (!_draggingPreset) return;
  try { e.dataTransfer?.setData("text/plain", `rt-preset:${_draggingPreset.id}`); } catch {}
  if (e.dataTransfer) e.dataTransfer.effectAllowed = "copy";
});
presetsListEl.addEventListener("dragend", () => {
  _draggingPreset = null;
  document.querySelectorAll<HTMLElement>(".rt-char.drop-target")
    .forEach((el) => el.classList.remove("drop-target"));
});
bodyEl.addEventListener("dragover", (e) => {
  if (!_draggingPreset) return;
  const card = (e.target as HTMLElement).closest<HTMLElement>(".rt-char");
  if (!card) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  // Light up THIS card, dim others.
  document.querySelectorAll<HTMLElement>(".rt-char.drop-target")
    .forEach((el) => { if (el !== card) el.classList.remove("drop-target"); });
  card.classList.add("drop-target");
});
bodyEl.addEventListener("dragleave", (e) => {
  const card = (e.target as HTMLElement).closest<HTMLElement>(".rt-char");
  if (card && !card.contains(e.relatedTarget as Node)) card.classList.remove("drop-target");
});
bodyEl.addEventListener("drop", (e) => {
  if (!_draggingPreset) return;
  const card = (e.target as HTMLElement).closest<HTMLElement>(".rt-char");
  if (!card) return;
  e.preventDefault();
  card.classList.remove("drop-target");
  const tid = card.dataset.tokenId;
  if (!tid) return;
  const preset = _draggingPreset;
  _draggingPreset = null;
  void applyPresetToToken(preset, tid);
});

// JSON export / import for the entire preset library.
presetExportBtn.addEventListener("click", () => {
  const blob = new Blob(
    [JSON.stringify({ version: 1, presets: rtPresets }, null, 2)],
    { type: "application/json;charset=utf-8" },
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "resource-presets.json";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1000);
});
presetImportBtn.addEventListener("click", () => {
  presetFileInput.value = "";
  presetFileInput.click();
});
presetFileInput.addEventListener("change", async () => {
  const f = presetFileInput.files?.[0];
  if (!f) return;
  try {
    const text = await f.text();
    const json = JSON.parse(text);
    const arr = Array.isArray(json) ? json
      : (json && Array.isArray(json.presets) ? json.presets : null);
    if (!arr) {
      window.alert("JSON 格式错误：应为预设数组，或包含 { presets: [...] }。");
      return;
    }
    const incoming: ResourcePreset[] = [];
    for (const p of arr) {
      if (!p || typeof p !== "object") continue;
      if (typeof p.id !== "string" || typeof p.name !== "string") continue;
      if (!Array.isArray(p.resources)) continue;
      incoming.push({
        id: p.id || newPresetId(),
        name: p.name,
        resources: p.resources.filter((r: any) => r && typeof r === "object"),
      });
    }
    if (incoming.length === 0) {
      window.alert("JSON 里没有有效的预设条目。");
      return;
    }
    // Merge by name — don't silently overwrite the user's existing
    // presets. Same-name imports replace; new names get appended.
    const byName = new Map(rtPresets.map((p) => [p.name, p]));
    for (const p of incoming) byName.set(p.name, p);
    rtPresets = [...byName.values()];
    saveRtPresets();
    renderPresetsBar();
    try {
      await OBR.notification.show(
        `已导入 ${incoming.length} 个预设`, "SUCCESS",
      );
    } catch {}
  } catch (e: any) {
    window.alert(`导入失败：${e?.message ?? String(e)}`);
  }
});

// Used by the parent block (RESOURCES_KEY referenced for side-effect of
// import — without this the tsc unused-import sweep flags it). The
// constant is reserved for a future per-token quick-snapshot read.
void RESOURCES_KEY;

// ---- live refresh + lifecycle ---------------------------------------------
let renderTimer: number | null = null;
function scheduleRender(): void {
  if (renderTimer != null) return;
  renderTimer = window.setTimeout(async () => {
    renderTimer = null;
    try { render(await gather()); } catch (err) {
      console.warn("[obr-suite/resources] tracker render failed", err);
    }
  }, 60);
}

async function closePanel(): Promise<void> {
  // Clear the shared open-state key (synchronous, reliable) so the
  // background's toolbar tool sees the panel as closed. Replaces an
  // async OBR broadcast that got killed mid-unload — the click-twice
  // bug. Same lesson as the character-card panel.
  try { localStorage.removeItem(PANEL_OPEN_KEY); } catch {}
  try { await OBR.modal.close(PANEL_MODAL_ID); } catch {}
}
closeBtn.addEventListener("click", () => { void closePanel(); });
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { e.preventDefault(); void closePanel(); }
});

OBR.onReady(async () => {
  try { myId = await OBR.player.getId(); } catch {}
  loadRtPresets();
  renderPresetsBar();
  // Cross-iframe storage sync — if the user has the panel open in two
  // tabs and saves a preset in one, the other refreshes automatically.
  window.addEventListener("storage", (e) => {
    if (e.key === RT_PRESETS_KEY) { loadRtPresets(); renderPresetsBar(); }
  });
  scheduleRender();

  const offs: Array<() => void> = [];
  offs.push(OBR.scene.items.onChange(() => scheduleRender()));
  try { offs.push(OBR.party.onChange(() => scheduleRender())); } catch { /* no party.onChange in this SDK */ }
  try {
    offs.push(OBR.scene.onReadyChange((ready) => { if (ready) scheduleRender(); }));
  } catch { /* ignore */ }

  // Clear the shared open-state key on EVERY unload path — OBR's
  // click-outside close removes this iframe (firing pagehide, and
  // usually beforeunload) and never goes through closePanel(). Also
  // unmount every card's components so their scene subscriptions
  // don't leak.
  const onPanelUnload = () => {
    for (const off of offs.splice(0)) { try { off(); } catch { /* ignore */ } }
    for (const [, st] of cards) unmountCard(st);
    cards.clear();
    try { localStorage.removeItem(PANEL_OPEN_KEY); } catch {}
  };
  window.addEventListener("pagehide", onPanelUnload);
  window.addEventListener("beforeunload", onPanelUnload);
});
