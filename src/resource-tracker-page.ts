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
import { isDegenerateResourceId, stableResourceId } from "./modules/resourceTracker/id";

/** Merge preset resources into a token's current array without letting
 *  id collisions cross-link rows (checklist §2): a preset entry whose
 *  id is degenerate, or already taken by a DIFFERENT-named resource on
 *  the token, falls back to NAME matching (occurrence-aware) against
 *  the token's rows — only when no same-named row exists is it inserted
 *  under a fresh deterministic id. Idempotent: re-applying the same
 *  preset never grows the array (the old degenerate-id fallthrough
 *  pushed a new copy on EVERY apply). */
function mergePresetResources(cur: Resource[], preset: Resource[]): Resource[] {
  const next = cur.map((r) => ({ ...r }));
  const byId = new Map(next.map((r) => [r.id, r]));
  const usedIds = new Set(next.map((r) => r.id));
  const byNameQueue = new Map<string, Resource[]>();
  for (const r of next) {
    const list = byNameQueue.get(r.name) ?? [];
    list.push(r);
    byNameQueue.set(r.name, list);
  }
  const nameConsumed = new Map<string, number>();
  for (const r of preset) {
    const clash = byId.get(r.id);
    if (clash && clash.name === r.name) continue; // already present — keep live state
    if (!clash && !isDegenerateResourceId(r.id)) {
      // Trustworthy unique id not on the token — plain insert.
      next.push({ ...r });
      byId.set(r.id, next[next.length - 1]);
      usedIds.add(r.id);
      continue;
    }
    // Untrustworthy id (degenerate, or taken by a different-named
    // row): match by name + occurrence. A same-named row already on
    // the token — including one pushed by a PREVIOUS apply of this
    // preset — absorbs the entry (keep live state, no insert).
    const queue = byNameQueue.get(r.name) ?? [];
    const idx = nameConsumed.get(r.name) ?? 0;
    nameConsumed.set(r.name, idx + 1);
    if (idx < queue.length) continue;
    const reid = { ...r, id: stableResourceId(r.name, usedIds) };
    console.info("[obr-suite/resources] preset entry re-id'd to avoid collision", {
      name: r.name, oldId: r.id, newId: reid.id,
    });
    next.push(reid);
    byId.set(reid.id, reid);
    queue.push(reid);
    byNameQueue.set(r.name, queue);
  }
  return next;
}
import { applyI18nDom, t } from "./i18n";
import { getLocalLang, onLangChange } from "./state";

// i18n: static text via data-i18n attributes (applyI18nDom); dynamic
// strings (names, preset dialogs, toasts) via T(). Module script is
// deferred (DOM ready), so translate static chrome immediately + on
// language change.
let lang = getLocalLang();
const T = (k: Parameters<typeof t>[1]) => t(lang, k);
try { applyI18nDom(lang); } catch {}
onLangChange((l) => {
  lang = l;
  try { applyI18nDom(lang); } catch {}
  try { scheduleRender(); } catch {}
  try { renderPresetsBar(); } catch {}
});

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
// Character-card binding marker — a token counts as a "玩家" (player
// character) only when it's player-owned AND carries this. Same key
// the character-cards module + status tracker use.
const CC_BIND_KEY = "com.character-cards/boundCardId";
const EXTERNAL_BUBBLES_KEY = "com.owlbear-rodeo-bubbles-extension/metadata";

// 2026-05-15 (#11) — initiative-tracker metadata. GM-owned tokens
// (typically bestiary monsters) join the resource tracker the moment
// they get added to initiative, and drop out the moment their
// initiative entry is removed. Mirrors the constant in
// modules/initiative/utils/constants.ts so the tracker doesn't have
// to import from a TSX module at the page-script entry point.
const INITIATIVE_METADATA_KEY = "com.initiative-tracker/data";

const bodyEl = document.getElementById("rtBody") as HTMLDivElement;
const subEl = document.getElementById("rtSub") as HTMLSpanElement;
const closeBtn = document.getElementById("rtClose") as HTMLButtonElement;
const tabPlayerBtn = document.getElementById("rtTabPlayer") as HTMLButtonElement | null;
const tabMonsterBtn = document.getElementById("rtTabMonster") as HTMLButtonElement | null;
const tabPlayerN = document.getElementById("rtTabPlayerN") as HTMLSpanElement | null;
const tabMonsterN = document.getElementById("rtTabMonsterN") as HTMLSpanElement | null;

// Player/Monster tab — which group is shown. Persisted per DM.
const LS_RT_TAB = "obr-suite/resources/active-tab";
let activeTab: "player" | "monster" = "player";
try { if (localStorage.getItem(LS_RT_TAB) === "monster") activeTab = "monster"; } catch {}
// Cache of the latest gather() result so a tab switch re-renders WITHOUT
// re-querying the scene (and without re-mounting the live components).
let lastChars: CharEntry[] = [];

let myId = "";

// ---- data ------------------------------------------------------------------
interface CharEntry {
  id: string;
  name: string;
  owner: string;
  // 2026-05-16 — kind drives section grouping in render(): "player"
  // tokens go in the first section ("玩家"), "monster" tokens (GM-owned
  // tokens currently in the initiative tracker) go in the second
  // ("先攻中的怪物").
  kind: "player" | "monster";
  // The token's bubbles metadata snapshot, handed to the stat banner
  // for a flicker-free initial paint.
  live: BubblesData;
}

async function gather(): Promise<CharEntry[]> {
  let items: Item[] = [];
  try { items = await OBR.scene.items.getItems(); } catch { return []; }

  // Classify the connected party by role so we can tell a player-owned
  // token from a GM/monster token by its createdUserId. getPlayers()
  // returns the OTHER connected members (not self); self is the GM.
  const nameById = new Map<string, string>();
  const playerIds = new Set<string>();
  let partyKnown = false;
  try {
    const players = await OBR.party.getPlayers();
    partyKnown = true;
    for (const p of players) {
      if (p.role === "PLAYER") {
        playerIds.add(p.id);
        nameById.set(p.id, p.name || "玩家");
      }
    }
  } catch { /* offline / no party — fall back to the "not me" heuristic */ }

  // "Has player permission" = the token is owned by a non-GM player.
  // When the party is known we match the owner against the connected
  // PLAYER ids precisely (this is what keeps GM scenery / stale-import
  // tokens OUT of the panel — the loose `owner !== myId` test used to
  // let them in). If the party call failed we degrade to that old
  // heuristic so the panel still works offline.
  const hasPlayerPermission = (owner: string | undefined): boolean => {
    if (!owner) return false;
    if (partyKnown) return playerIds.has(owner);
    return owner !== myId;
  };

  const out: CharEntry[] = [];
  for (const it of items) {
    if (!isImage(it)) continue;
    if (it.layer !== "CHARACTER") continue;
    const owner = it.createdUserId;
    const playerOwned = hasPlayerPermission(owner);
    const inInitiative = it.metadata[INITIATIVE_METADATA_KEY] != null;
    const hasCard = typeof it.metadata[CC_BIND_KEY] === "string"
      && (it.metadata[CC_BIND_KEY] as string).length > 0;
    // Inclusion (per user spec 2026-05-21): any token that has a
    // character card, OR is player-owned, OR is in the current
    // initiative. Everything else (GM scenery, untracked decorations)
    // is excluded.
    if (!hasCard && !playerOwned && !inInitiative) continue;
    // Categorisation (per user spec): ANY token with a bound character
    // card is a "玩家" — even a GM-made NPC with a card. Everything else
    // (player-owned but card-less, or an initiative monster) is "怪物".
    const isPlayerChar = hasCard;
    const live = ((it.metadata[BUBBLES_KEY] ?? it.metadata[EXTERNAL_BUBBLES_KEY]) as
      BubblesData | undefined) ?? {};
    // Name follows the same priority as the character panel —
    // 角色卡名 > 怪物图鉴绑定名 > 图片名 — by reusing panel.ts's own
    // resolver, so the standalone tracker and cc-info never disagree.
    const name = (await resolveTokenDisplayName(it.id)) || it.name || T("rtUnnamed");
    // Owner badge: the owning player's display name when we know it
    // (player-owned card token); "角色卡" for a GM-owned card NPC;
    // "怪物" for the monster group.
    const ownerLabel = isPlayerChar
      ? (nameById.get(owner!) || T("rtOwnerCardNpc"))
      : T("rtTabMonsters");
    out.push({
      id: it.id,
      name,
      owner: ownerLabel,
      kind: isPlayerChar ? "player" : "monster",
      live,
    });
  }
  // 2026-05-16 — players first, then monsters; alphabetical within
  // each group. render() inserts a divider between the two groups so
  // the DM can tell at a glance which row is whose.
  out.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "player" ? -1 : 1;
    return a.owner.localeCompare(b.owner) || a.name.localeCompare(b.name);
  });
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
      `<button class="rt-char-save-preset" type="button" title="${rtEsc(T("rtSavePresetTitle"))}">${rtEsc(T("rtSavePreset"))}</button>` +
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
  lastChars = chars;
  const players = chars.filter((c) => c.kind === "player");
  const monsters = chars.filter((c) => c.kind === "monster");

  // Tab badges + active state.
  if (tabPlayerN) tabPlayerN.textContent = String(players.length);
  if (tabMonsterN) tabMonsterN.textContent = String(monsters.length);
  tabPlayerBtn?.classList.toggle("on", activeTab === "player");
  tabMonsterBtn?.classList.toggle("on", activeTab === "monster");

  // Reconcile the card POOL against ALL chars (both tabs) so switching
  // tabs only detaches/re-attaches DOM — the live stat-banner + resource
  // components are never torn down + re-created (no flicker, no refetch).
  const seen = new Set(chars.map((c) => c.id));
  for (const c of chars) {
    let st = cards.get(c.id);
    if (!st) { st = createCard(c); cards.set(c.id, st); }
    st.nameEl.textContent = c.name;
    st.ownerEl.textContent = c.owner;
  }
  // Drop cards for tokens no longer present at all — unmount so their
  // scene subscriptions don't leak.
  for (const [id, st] of cards) {
    if (!seen.has(id)) { unmountCard(st); st.el.remove(); cards.delete(id); }
  }

  // Detach non-card leftovers + every card, then re-attach only the
  // active tab's cards (kept mounted while detached).
  bodyEl.querySelectorAll(".rt-empty, .rt-section-divider").forEach((d) => d.remove());
  for (const [, st] of cards) st.el.remove();

  const shown = activeTab === "player" ? players : monsters;
  for (const c of shown) {
    const st = cards.get(c.id);
    if (st) bodyEl.appendChild(st.el);
  }

  if (chars.length === 0) {
    const e = document.createElement("div");
    e.className = "rt-empty";
    e.innerHTML = T("rtEmptyAll");
    bodyEl.appendChild(e);
  } else if (shown.length === 0) {
    const e = document.createElement("div");
    e.className = "rt-empty";
    e.textContent = activeTab === "player" ? T("rtEmptyPlayers") : T("rtEmptyMonsters");
    bodyEl.appendChild(e);
  }

  subEl.textContent = `${T("rtTabPlayers")} ${players.length} · ${T("rtTabMonsters")} ${monsters.length} · ${T("rtSubTail")}`;
}

function setRtTab(tab: "player" | "monster"): void {
  if (activeTab === tab) return;
  activeTab = tab;
  try { localStorage.setItem(LS_RT_TAB, tab); } catch {}
  render(lastChars); // re-render from cache — no re-gather, no re-mount
}
tabPlayerBtn?.addEventListener("click", () => setRtTab("player"));
tabMonsterBtn?.addEventListener("click", () => setRtTab("monster"));

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
             title="${rtEsc(T("rtPresetChipTitle"))}">${rtEsc(p.name)}<span class="pre-count">${p.resources.length}</span></button>`
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
    window.alert(T("rtPresetNoRes"));
    return;
  }
  const defaultName = await resolveTokenDisplayName(tokenId)
    .catch(() => "")
    || T("rtPresetDefaultName");
  const name = window.prompt(
    T("rtPresetSavePrompt").replace("{n}", String(resources.length)),
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
    `<button data-act="overwrite">${rtEsc(T("rtPresetMenuOverwrite"))}</button>` +
    `<button data-act="merge">${rtEsc(T("rtPresetMenuMerge"))}</button>` +
    `<button data-act="rename">${rtEsc(T("rtPresetMenuRename"))}</button>` +
    `<button class="danger" data-act="delete">${rtEsc(T("rtPresetMenuDelete"))}</button>`;
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
          T("rtPresetAppliedZh")
            .replace("{name}", preset.name)
            .replace("{act}", act === "overwrite" ? T("rtActOverwrite") : T("rtActMerge"))
            .replace("{count}", String(count)),
          "SUCCESS",
        );
      } catch { /* notification best-effort */ }
    } else if (act === "rename") {
      const next = window.prompt(T("rtPresetRenamePrompt"), preset.name);
      if (next && next.trim()) {
        preset.name = next.trim();
        saveRtPresets();
        renderPresetsBar();
      }
    } else if (act === "delete") {
      if (window.confirm(T("rtPresetDeleteConfirm").replace("{name}", preset.name))) {
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
      : mergePresetResources(cur, preset.resources);
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
  try { await writeResources(tokenId, mergePresetResources(cur, preset.resources)); } catch {}
  try {
    await OBR.notification.show(
      T("rtPresetMergedTo")
        .replace("{name}", preset.name)
        .replace("{target}", (await resolveTokenDisplayName(tokenId)) || T("rtThisChar")),
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
      window.alert(T("rtImportErrFormat"));
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
      window.alert(T("rtImportErrEmpty"));
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
        T("rtImportOk").replace("{n}", String(incoming.length)), "SUCCESS",
      );
    } catch {}
  } catch (e: any) {
    window.alert(T("rtImportFail").replace("{e}", e?.message ?? String(e)));
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
