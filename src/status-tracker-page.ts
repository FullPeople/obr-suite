// Status Tracker — palette popover.
//
// APPLY mode (default): flat grid of buff bubbles. Left/right
// pointer-down on a bubble fires the capture overlay (drag = apply
// or paint-toggle on tokens).
//
// EDIT mode (toggle ✎ in the toolbar): same flat grid, but every
// element morphs into an editable affordance:
//   • Category buttons in the filter row become click-to-rename,
//     drag-to-reorder, and drop-targets for buffs (drop = move
//     buff into that category). A trailing "+" button replaces
//     itself with an inline <input> on click for adding a new
//     category.
//   • Buff bubbles open a small floating popup on click — colour
//     picker + name input + delete + cancel + save. The popup is
//     pinned inside the panel so it can't escape during a viewport
//     resize. Bubbles are also draggable: drop on another bubble to
//     reorder (left half = insert before, right half = insert
//     after); drop on a category button to recategorize.
//   • A "+ 新 buff" trailing pill inserts a fresh buff into the
//     active filter group (or "未分类" if "全部" is active) and
//     auto-opens its edit popup.
//
// Catalog persistence shape (scene metadata):
//   v1 (legacy) — bare BuffDef[] array
//   v2 (new)    — { version: 2, buffs: BuffDef[], groupOrder?: string[] }
//
// We accept either on read; we always write v2 on save.

import OBR from "@owlbear-rodeo/sdk";
import { installDebugOverlay } from "./utils/debugOverlay";
import {
  PLUGIN_ID,
  SCENE_BUFF_CATALOG_KEY,
  STATUS_EFFECTS_ENABLED,
  DEFAULT_BUFFS,
  BuffDef,
  BuffEffect,
  textColorFor,
} from "./modules/statusTracker/types";
import { bindPanelDrag } from "./utils/panelDrag";
import { PANEL_IDS } from "./utils/panelLayout";
import { assetUrl } from "./asset-base";

// 2026-05-14 — variant manifest cached after first fetch. Lists every
// pre-baked WebM the editor can offer (id / template / emoji / path).
// File at `public/buff-fx/manifest.json` is rebuilt by
// tools/buff-fx-gen/build_all.sh.
interface BuffFxVariant {
  id: string;
  template: string;
  emoji: string;
  asset: string;
  size_kb?: number;
}
let variantManifestCache: BuffFxVariant[] | null = null;
async function getVariantManifest(): Promise<BuffFxVariant[]> {
  if (variantManifestCache) return variantManifestCache;
  try {
    const url = assetUrl("buff-fx/manifest.json");
    const r = await fetch(url, { cache: "force-cache" });
    if (!r.ok) return [];
    const j = await r.json();
    if (Array.isArray(j?.variants)) {
      variantManifestCache = j.variants as BuffFxVariant[];
      return variantManifestCache;
    }
  } catch (e) {
    console.warn("[status/palette] buff-fx manifest fetch failed", e);
  }
  return [];
}
function shortNameForAsset(asset: string | undefined): string {
  if (!asset) return "无";
  return asset.replace(/^buff-fx\//, "").replace(/\.webm$/, "");
}

const BC_DRAG_START = `${PLUGIN_ID}/drag-start`;
const BC_DRAG_END = `${PLUGIN_ID}/drag-end`;
const BC_TOGGLE = `${PLUGIN_ID}/toggle`;

const dragHandle = document.getElementById("dragHandle") as HTMLDivElement;
const btnClose = document.getElementById("btnClose") as HTMLButtonElement;
const btnEdit = document.getElementById("btnEdit") as HTMLButtonElement;
const btnExport = document.getElementById("btnExport") as HTMLButtonElement;
const btnImport = document.getElementById("btnImport") as HTMLButtonElement;
const fileImport = document.getElementById("fileImport") as HTMLInputElement;
const filtersEl = document.getElementById("filters") as HTMLDivElement;
const gridEl = document.getElementById("grid") as HTMLDivElement;
const popupEl = document.getElementById("popup") as HTMLDivElement;
const footEl = document.getElementById("foot") as HTMLDivElement;
const cardEl = document.getElementById("card") as HTMLDivElement;

interface CatalogFile {
  version: 2;
  buffs: BuffDef[];
  groupOrder: string[];
}

const UNCATEGORIZED = "未分类";

// Per-client persistence of the active category filter. The user's
// reasonable expectation is that picking "Buffs" stays selected
// after closing + reopening the palette, instead of always resetting
// to "All". Stored under a per-client localStorage key; survives
// scene reloads and browser restarts.
const LS_ACTIVE_FILTER = "com.obr-suite/status/active-filter";
function readPersistedFilter(): string | null {
  try {
    const v = localStorage.getItem(LS_ACTIVE_FILTER);
    if (typeof v === "string" && v.length > 0) return v;
  } catch {}
  return null;
}
function writePersistedFilter(v: string | null): void {
  try {
    if (v == null || v === "") localStorage.removeItem(LS_ACTIVE_FILTER);
    else localStorage.setItem(LS_ACTIVE_FILTER, v);
  } catch {}
}

let buffs: BuffDef[] = DEFAULT_BUFFS.slice();
let groupOrder: string[] = [];
let activeFilter: string | null = readPersistedFilter();
let editMode = false;

// Newly-created buffs (via "+ 新 buff" in edit mode) start with an
// empty name and an auto-opened edit popup. If the user closes the
// popup (cancel / outside-click / Escape) without entering a name,
// the placeholder buff is deleted from the catalog so we don't leave
// an unnamed entry behind. The set is the bookkeeping for that —
// add on creation, remove on save (committed) or on the close-side
// cleanup (rolled back).
const newlyCreatedBuffIds = new Set<string>();

// Inline "+ category" input is open when this is true. Replaces the
// "+" button in the filter row with an <input>.
let addCatPending = false;
// Active edit popup target (buff id), or null if popup is closed.
let popupBuffId: string | null = null;

// === Catalog load / save ====================================================
//
// 2026-05-09: catalog moved from scene-metadata (shared) to
// localStorage (per-client) so each player can customise their own
// palette independently. Applied-buff metadata on tokens stays shared
// — that's actual game state. Customising the palette only changes
// what THIS browser sees in the popover + the colours/effects this
// browser uses to render bubbles for the buff IDs it knows about.
//
// Migration: on first run with empty LS, fall back to ANY existing
// scene-metadata catalog so upgrading users don't lose customisation.

const LS_BUFF_CATALOG = "obr-suite/status/buff-catalog";

async function loadCatalog(): Promise<void> {
  // 1) Local storage — primary source post-2026-05-09.
  try {
    const raw = localStorage.getItem(LS_BUFF_CATALOG);
    if (raw) {
      const parsed = parseCatalog(JSON.parse(raw));
      if (parsed) {
        buffs = parsed.buffs;
        groupOrder = parsed.groupOrder;
        if (!popupBuffId) render();
        return;
      }
    }
  } catch {}
  // 2) One-time migration from scene metadata when LS is empty.
  try {
    const meta = await OBR.scene.getMetadata();
    const v = meta[SCENE_BUFF_CATALOG_KEY] as unknown;
    const parsed = parseCatalog(v);
    if (parsed) {
      buffs = parsed.buffs;
      groupOrder = parsed.groupOrder;
      // Persist locally so the migration only runs once.
      try {
        const file: CatalogFile = { version: 2, buffs, groupOrder };
        localStorage.setItem(LS_BUFF_CATALOG, JSON.stringify(file));
      } catch {}
    }
  } catch {}
  if (!popupBuffId) render();
}

function parseCatalog(v: unknown): { buffs: BuffDef[]; groupOrder: string[] } | null {
  if (Array.isArray(v)) {
    const list = parseBuffArray(v);
    if (list.length === 0) return null;
    return { buffs: list, groupOrder: deriveGroupOrder(list) };
  }
  if (v && typeof v === "object" && Array.isArray((v as any).buffs)) {
    const list = parseBuffArray((v as any).buffs);
    if (list.length === 0) return null;
    const order = Array.isArray((v as any).groupOrder)
      ? (v as any).groupOrder.filter((g: any): g is string => typeof g === "string")
      : deriveGroupOrder(list);
    return { buffs: list, groupOrder: order };
  }
  return null;
}

const VALID_EFFECTS: ReadonlyArray<BuffEffect> = ["default", "float", "drop", "flicker", "curve", "spread"];

function parseEffect(v: unknown): BuffEffect | undefined {
  if (typeof v !== "string") return undefined;
  return VALID_EFFECTS.includes(v as BuffEffect) ? (v as BuffEffect) : undefined;
}

function parseBuffArray(arr: any[]): BuffDef[] {
  const out: BuffDef[] = [];
  for (const e of arr) {
    if (!e || typeof e.id !== "string") continue;
    const def: BuffDef = {
      id: String(e.id),
      name: String(e.name ?? e.id),
      color: typeof e.color === "string" ? e.color : "#ffffff",
      group: typeof e.group === "string" && e.group.length > 0 ? e.group : undefined,
    };
    const rounds = Math.floor(Number(e.rounds));
    if (Number.isFinite(rounds) && rounds > 0) def.rounds = rounds;
    const eff = parseEffect(e.effect);
    if (eff && eff !== "default") def.effect = eff;
    // effectParams: imageUrl (+ cached dims) / speed / count
    const ep = (e as any).effectParams;
    if (ep && typeof ep === "object") {
      const params: any = {};
      if (typeof ep.imageUrl === "string" && ep.imageUrl.length > 0) params.imageUrl = ep.imageUrl;
      if (typeof ep.imageWidth === "number" && isFinite(ep.imageWidth)) params.imageWidth = ep.imageWidth;
      if (typeof ep.imageHeight === "number" && isFinite(ep.imageHeight)) params.imageHeight = ep.imageHeight;
      if (typeof ep.speed === "number" && isFinite(ep.speed)) params.speed = ep.speed;
      if (typeof ep.count === "number" && isFinite(ep.count)) params.count = ep.count;
      if (Object.keys(params).length > 0) (def as any).effectParams = params;
    }
    // 2026-05-14 — preserve webmAsset across the parse↔save roundtrip
    // (editor used to drop it; that would silently revert customised
    // WebM effect choices on every save).
    const wa = (e as any).webmAsset;
    if (typeof wa === "string" && wa.length > 0) {
      (def as any).webmAsset = wa;
    }
    out.push(def);
  }
  return out;
}

function deriveGroupOrder(list: BuffDef[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const b of list) {
    const g = b.group ?? UNCATEGORIZED;
    if (!seen.has(g)) {
      seen.add(g);
      out.push(g);
    }
  }
  return out;
}

async function saveCatalog(): Promise<void> {
  const order = mergedGroupOrder(groupOrder, buffs);
  const file: CatalogFile = { version: 2, buffs, groupOrder: order };
  groupOrder = order;
  // Per-client LS instead of shared scene metadata. Also broadcast a
  // local "catalog changed" event so the background renderer (in the
  // same browser) re-syncs token bubbles immediately.
  try {
    localStorage.setItem(LS_BUFF_CATALOG, JSON.stringify(file));
    try {
      OBR.broadcast.sendMessage(
        "com.obr-suite/status/catalog-changed",
        {},
        { destination: "LOCAL" },
      );
    } catch {}
  } catch (e) {
    console.warn("[status/palette] saveCatalog failed", e);
  }
}

function mergedGroupOrder(prior: string[], list: BuffDef[]): string[] {
  // Preserve every group the user has explicitly added to `prior`,
  // even if it currently has zero buffs. Auto-discovered groups
  // (encountered on a buff but not yet in `prior`) get appended at
  // the end. Explicit deletion happens in onRenameCategory's
  // "rename to empty" branch which does its own confirm + filter —
  // this function is the WRITE path, not the cleanup path.
  //
  // Earlier the filter was `g === UNCATEGORIZED || list.some(b =>
  // b.group === g)` which silently dropped any user-created empty
  // category on the very next save, breaking the new-category flow
  // (user clicks +, types name, presses Enter — saveCatalog runs,
  // mergedGroupOrder strips the empty group, write goes out without
  // it, render shows old groups).
  const seen = new Set(prior);
  const out = prior.slice();
  for (const b of list) {
    const g = b.group ?? UNCATEGORIZED;
    if (!seen.has(g)) {
      seen.add(g);
      out.push(g);
    }
  }
  return out;
}

// === Helpers ================================================================

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!),
  );
}

function genId(): string {
  return `buff-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// === Filters row ============================================================

function renderFilters(): void {
  const groups = mergedGroupOrder(groupOrder, buffs);

  // In APPLY mode the "全部" pseudo-filter unfilters; in EDIT mode
  // we drop it because edit mode shows all buffs anyway (no filter).
  let html = "";
  if (!editMode) {
    html += `<button class="cat-btn ${activeFilter === null ? "on" : ""}" data-g="">全部</button>`;
  }
  for (const g of groups) {
    // Category-button drag (re-order categories) is edit-mode only,
    // and so is the buff-drop receiver. The 2026-05-08 attempt to
    // also accept buff drops in apply mode broke drag-to-token and
    // got reverted (see renderGrid + onBubblePointerDown comments).
    const dragAttr = editMode ? `draggable="true"` : "";
    const isOn = (!editMode && activeFilter === g) ? "on" : "";
    html += `<button class="cat-btn ${isOn}" data-g="${escapeHtml(g)}" ${dragAttr}>${escapeHtml(g)}</button>`;
  }
  if (editMode) {
    if (addCatPending) {
      html += `<input class="cat-input" id="cat-add-input" type="text" placeholder="新分类名" maxlength="16"/>`;
    } else {
      html += `<button class="cat-add" id="cat-add-btn" type="button" title="添加分类">+</button>`;
    }
  }
  filtersEl.innerHTML = html;

  // Wire all category buttons
  filtersEl.querySelectorAll<HTMLButtonElement>(".cat-btn").forEach((b) => {
    const g = b.dataset.g || "";

    if (!editMode) {
      // Apply mode: click filters (persisted per-client). No
      // dragover/drop receiver wiring — apply-mode bubbles aren't
      // `draggable="true"` (see renderGrid for why), so there's no
      // dragged buff-id payload that could reach this handler. The
      // 2026-05-08 attempt to also accept buff drops here was part
      // of the same regression that broke drag-to-token in apply
      // mode and got reverted.
      b.addEventListener("click", () => {
        activeFilter = g === "" ? null : g;
        writePersistedFilter(activeFilter);
        render();
      });
      return;
    }

    // Edit mode: empty data-g shouldn't appear, but guard anyway.
    if (g === "") {
      b.addEventListener("click", () => {
        activeFilter = null;
        writePersistedFilter(null);
        render();
      });
      return;
    }

    // Editable category: click = rename, drag = reorder, drop = recategorize.
    // Use a flag that dragstart sets so click can suppress on a drag.
    let dragged = false;
    b.addEventListener("click", () => {
      if (dragged) { dragged = false; return; }
      onRenameCategory(g);
    });
    b.addEventListener("dragstart", (e) => {
      dragged = true;
      e.dataTransfer?.setData("text/cat-name", g);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
      b.classList.add("dragging");
    });
    b.addEventListener("dragend", () => {
      b.classList.remove("dragging");
      filtersEl.querySelectorAll(".cat-btn.drop-target").forEach((x) =>
        x.classList.remove("drop-target"),
      );
      // Clear the dragged-flag a tick later so the synthetic click
      // (which fires AFTER dragend in some browsers) gets ignored.
      setTimeout(() => { dragged = false; }, 0);
    });
    b.addEventListener("dragover", (e) => {
      const types = e.dataTransfer?.types;
      if (!types) return;
      if (types.includes("text/buff-id") || types.includes("text/cat-name")) {
        e.preventDefault();
        b.classList.add("drop-target");
      }
    });
    b.addEventListener("dragleave", (e) => {
      const rt = e.relatedTarget as Node | null;
      if (rt && b.contains(rt)) return;
      b.classList.remove("drop-target");
    });
    b.addEventListener("drop", (e) => {
      e.preventDefault();
      b.classList.remove("drop-target");
      const buffId = e.dataTransfer?.getData("text/buff-id");
      const catName = e.dataTransfer?.getData("text/cat-name");
      if (buffId) {
        void onMoveBuff(buffId, g);
      } else if (catName && catName !== g) {
        void onReorderCategory(catName, g);
      }
    });
  });

  // "+" button → open inline input
  if (editMode && !addCatPending) {
    const addBtn = filtersEl.querySelector<HTMLButtonElement>("#cat-add-btn");
    addBtn?.addEventListener("click", () => {
      addCatPending = true;
      render();
      requestAnimationFrame(() => {
        const inp = filtersEl.querySelector<HTMLInputElement>("#cat-add-input");
        inp?.focus();
      });
    });
  }

  // Inline category input — commit on Enter / blur, cancel on Escape.
  if (editMode && addCatPending) {
    const inp = filtersEl.querySelector<HTMLInputElement>("#cat-add-input");
    if (inp) {
      const commit = async (): Promise<void> => {
        if (!addCatPending) return; // already committed
        const name = inp.value.trim();
        addCatPending = false;
        if (name && name !== UNCATEGORIZED && !groupOrder.includes(name)) {
          groupOrder.push(name);
          await saveCatalog();
        }
        render();
      };
      inp.addEventListener("blur", () => { void commit(); });
      inp.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          void commit();
        } else if (e.key === "Escape") {
          addCatPending = false;
          render();
        }
      });
    }
  }
}

// === Bubble grid ============================================================

function renderGrid(): void {
  // Edit mode shows all buffs; apply mode honours activeFilter.
  const list = editMode
    ? buffs.slice()
    : buffs.filter((b) =>
        activeFilter === null ? true : (b.group ?? UNCATEGORIZED) === activeFilter,
      );

  let html = "";
  if (!editMode) {
    html += `<div class="bubble eraser" data-id="__clear__">✕  清除该角色全部 buff</div>`;
    // 🛠 Manage pill: drag onto a token, on release the capture
    // overlay broadcasts BC_OPEN_MANAGE → background opens a popover
    // anchored on the token listing its current buffs. From there
    // each buff is independently draggable to remove or transfer.
    html += `<div class="bubble manage" data-id="__manage__">🛠  管理该角色 buff</div>`;
  }
  for (const b of list) {
    const fg = textColorFor(b.color);
    // Edit-mode-only `draggable="true"`. The 2026-05-08 attempt to
    // also enable HTML5 drag in apply mode (so users could drop a
    // buff on a category to change groups) broke the apply-mode
    // drag-to-token flow: the browser starts an HTML5 drag the
    // moment the cursor moves, fires `pointercancel`, the global
    // pointercancel handler broadcasts BC_DRAG_END, and the capture
    // overlay closes before the user finishes dragging onto a
    // token. The two interactions share the same pointerdown gesture
    // and there's no in-browser way to disambiguate after the drag
    // has already started — drag-to-category in apply mode needs a
    // different gesture (right-click menu, long-press, modifier
    // key, etc.) which we'll revisit separately.
    const dragAttr = editMode ? `draggable="true"` : "";
    const cls = editMode ? "bubble editable" : "bubble";
    // 2026-05-10: pass the buff colour through `--bubble-bg` so the
    // jelly CSS can apply 80%-alpha + a glassy highlight overlay.
    // Plain inline `background:` was opaque; color-mix in the
    // stylesheet now handles the translucency.
    html += `<div class="${cls}"
                  data-id="${escapeHtml(b.id)}"
                  ${dragAttr}
                  style="--bubble-bg:${escapeHtml(b.color)};color:${escapeHtml(fg)}">
               ${escapeHtml(b.name)}
             </div>`;
  }
  if (editMode) {
    html += `<div class="bubble add-pill" id="add-buff-pill">+ 新 buff</div>`;
  }
  gridEl.innerHTML = html;

  gridEl.querySelectorAll<HTMLElement>(".bubble").forEach((el) => {
    const id = el.dataset.id ?? "";
    if (el.id === "add-buff-pill") {
      el.addEventListener("click", () => { void onAddBuff(); });
      return;
    }

    if (!editMode) {
      el.addEventListener("pointerdown", (e) => onBubblePointerDown(e, el));
      el.addEventListener("contextmenu", (e) => e.preventDefault());
      return;
    }
    if (id === "__clear__") return; // shouldn't render in edit mode
    el.addEventListener("contextmenu", (e) => e.preventDefault());

    let dragged = false;
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      if (dragged) { dragged = false; return; }
      openEditPopup(id, el);
    });
    el.addEventListener("dragstart", (e) => {
      dragged = true;
      e.dataTransfer?.setData("text/buff-id", id);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
      el.classList.add("dragging");
    });
    el.addEventListener("dragend", () => {
      el.classList.remove("dragging");
      gridEl.querySelectorAll(".bubble.drop-before, .bubble.drop-after")
        .forEach((b) => b.classList.remove("drop-before", "drop-after"));
      setTimeout(() => { dragged = false; }, 0);
    });
    el.addEventListener("dragover", (e) => {
      if (!e.dataTransfer?.types.includes("text/buff-id")) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const before = (e.clientX - rect.left) < rect.width / 2;
      gridEl.querySelectorAll(".bubble.drop-before, .bubble.drop-after")
        .forEach((b) => b.classList.remove("drop-before", "drop-after"));
      el.classList.add(before ? "drop-before" : "drop-after");
    });
    el.addEventListener("dragleave", (e) => {
      const rt = e.relatedTarget as Node | null;
      if (rt && el.contains(rt)) return;
      el.classList.remove("drop-before", "drop-after");
    });
    el.addEventListener("drop", (e) => {
      e.preventDefault();
      const draggedId = e.dataTransfer?.getData("text/buff-id");
      const rect = el.getBoundingClientRect();
      const before = (e.clientX - rect.left) < rect.width / 2;
      gridEl.querySelectorAll(".bubble.drop-before, .bubble.drop-after")
        .forEach((b) => b.classList.remove("drop-before", "drop-after"));
      if (draggedId && draggedId !== id) {
        void onReorderBuff(draggedId, id, before);
      }
    });
  });
}

// === Apply-mode pointer (drag start) ========================================

async function onBubblePointerDown(e: PointerEvent, el: HTMLElement): Promise<void> {
  if (editMode) return;
  if (e.button !== 0 && e.button !== 2) return;
  // preventDefault is critical here: it stops the browser from
  // initiating an HTML5 drag (which would fire pointercancel and
  // cause the global handler to broadcast BC_DRAG_END, slamming the
  // capture overlay shut before the user finishes dragging onto a
  // token). The trade-off is that apply-mode bubbles can't use
  // HTML5 drag for cross-group moves; that gesture needs a separate
  // mechanism (TODO: long-press / right-click menu).
  e.preventDefault();
  e.stopPropagation();
  const id = el.dataset.id ?? "";
  if (!id) return;
  const isEraser = id === "__clear__";
  const isManage = id === "__manage__";
  const buff = (isEraser || isManage) ? null : buffs.find((b) => b.id === id) ?? null;
  if (!isEraser && !isManage && !buff) return;
  // Both eraser AND buff bubbles split by mouse button:
  //   left  → "drop"          (apply / clear ONE token on release)
  //   right → "paint-toggle"  (apply / clear EVERY token in the path)
  // Manage pill is drop-only — paint-toggle would open a popover for
  // every token the cursor passes, which is not useful.
  const mode: "drop" | "paint-toggle" =
    isManage ? "drop" : (e.button === 2 ? "paint-toggle" : "drop");
  try {
    let payload: any;
    if (isEraser)      payload = { kind: "clear", mode };
    else if (isManage) payload = { kind: "manage", mode };
    else               payload = { kind: "buff", buff, mode };
    await OBR.broadcast.sendMessage(BC_DRAG_START, payload, { destination: "LOCAL" });
  } catch (err) {
    console.warn("[status/palette] BC_DRAG_START failed", err);
  }
}

// === Stuck-cursor safety net (palette side) =================================
//
// The capture overlay opens asynchronously after BC_DRAG_START is
// broadcast. If the user releases the click BEFORE the modal is
// listening (very short tap on a buff with no drag), the pointerup
// can land on this palette popover instead of the modal — and the
// modal then never sees a release event, so it sticks open until
// browser refresh.
//
// Mitigation: ANY pointerup on the palette also broadcasts
// BC_DRAG_END as a "just in case" message. The capture overlay's
// background handler closes the modal regardless of who broadcast
// the end. If no modal is open, the broadcast is harmless.
window.addEventListener("pointerup", async () => {
  try {
    await OBR.broadcast.sendMessage(BC_DRAG_END, {}, { destination: "LOCAL" });
  } catch {}
});
window.addEventListener("pointercancel", async () => {
  try {
    await OBR.broadcast.sendMessage(BC_DRAG_END, {}, { destination: "LOCAL" });
  } catch {}
});

// === Edit popup =============================================================

// Display labels for the experimental effect modes. Drives both the
// segmented picker in the popup AND the persistence on save.
const EFFECT_LABELS: Array<{ id: BuffEffect; label: string; hint: string }> = [
  { id: "default", label: "默认", hint: "静态气泡（不带特效）" },
  { id: "float",   label: "漂浮", hint: "粒子从角色脚下随机漂浮上升" },
  { id: "drop",    label: "下降", hint: "粒子从角色头顶随机降落" },
  { id: "flicker", label: "闪烁", hint: "随机位置闪烁淡入淡出" },
  { id: "curve",   label: "悠扬", hint: "曲线从角色背后散播（渲染于角色下方）" },
  { id: "spread",  label: "扩散", hint: "同心圆扩散（渲染于角色下方）" },
];

/**
 * Variant browser modal — fullscreen overlay listing every WebM in
 * the manifest, filterable by template. Resolves to the picked
 * variant's `asset` path, or null if dismissed. Called from
 * openEditPopup's "更换…" button.
 */
async function openVariantPicker(currentAsset: string | undefined): Promise<string | null> {
  const variants = await getVariantManifest();
  if (variants.length === 0) {
    return null;   // manifest unavailable → silently no-op
  }
  // Group by template for filter buttons.
  const templates = Array.from(new Set(variants.map((v) => v.template)));

  return new Promise<string | null>((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "buff-fx-picker-overlay";
    overlay.innerHTML = `
      <div class="bfp-card">
        <div class="bfp-hdr">
          <span class="bfp-title">选择特效（${variants.length} 个变体）</span>
          <button class="bfp-x" type="button" aria-label="关闭">×</button>
        </div>
        <div class="bfp-filters">
          <button class="bfp-tmpl on" data-tmpl="" type="button">全部</button>
          ${templates.map((t) => `<button class="bfp-tmpl" data-tmpl="${escapeHtml(t)}" type="button">${escapeHtml(t)}</button>`).join("")}
        </div>
        <div class="bfp-grid">
          <div class="bfp-cell bfp-cell-none ${currentAsset ? "" : "bfp-current"}" data-asset="" data-tmpl="">
            <div class="bfp-none-icon">∅</div>
            <div class="bfp-cell-label">无特效<br><em>回退弧形带</em></div>
          </div>
          ${variants.map((v) => `
            <div class="bfp-cell ${currentAsset === v.asset ? "bfp-current" : ""}"
                 data-asset="${escapeHtml(v.asset)}"
                 data-tmpl="${escapeHtml(v.template)}">
              <video class="bfp-thumb" src="${escapeHtml(assetUrl(v.asset))}"
                     autoplay loop muted playsinline preload="metadata"></video>
              <div class="bfp-cell-label">${escapeHtml(v.template)}<br><em>${escapeHtml(v.emoji)}</em></div>
            </div>
          `).join("")}
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    // Force-trigger autoplay on grid videos (some browsers throttle
    // many simultaneous <video>s; muted + autoplay should still work).
    overlay.querySelectorAll<HTMLVideoElement>(".bfp-thumb").forEach((v) => {
      v.play().catch(() => { /* user-gesture not yet given; loop start on first interaction */ });
    });

    const cleanup = (result: string | null): void => {
      overlay.remove();
      resolve(result);
    };

    overlay.querySelector<HTMLButtonElement>(".bfp-x")?.addEventListener("click", () => cleanup(null));
    overlay.addEventListener("click", (e) => { if (e.target === overlay) cleanup(null); });
    document.addEventListener("keydown", function onEsc(e) {
      if (e.key === "Escape") {
        document.removeEventListener("keydown", onEsc);
        cleanup(null);
      }
    });

    overlay.querySelectorAll<HTMLButtonElement>(".bfp-tmpl").forEach((btn) => {
      btn.addEventListener("click", () => {
        const sel = btn.dataset.tmpl ?? "";
        overlay.querySelectorAll<HTMLButtonElement>(".bfp-tmpl").forEach((b) => b.classList.toggle("on", b === btn));
        overlay.querySelectorAll<HTMLElement>(".bfp-cell").forEach((c) => {
          // Always show the "无特效" cell regardless of filter.
          if (c.classList.contains("bfp-cell-none")) return;
          (c as HTMLElement).style.display = (sel === "" || c.dataset.tmpl === sel) ? "" : "none";
        });
      });
    });

    overlay.querySelectorAll<HTMLElement>(".bfp-cell").forEach((cell) => {
      cell.addEventListener("click", () => {
        const a = cell.dataset.asset ?? "";
        cleanup(a === "" ? "" : a);   // "" sentinel → clear (caller treats as undefined)
      });
    });
  });
}

function openEditPopup(id: string, anchor: HTMLElement): void {
  const buff = buffs.find((b) => b.id === id);
  if (!buff) return;
  popupBuffId = id;
  // Pending state for the segmented picker — read on save.
  let pendingEffect: BuffEffect = buff.effect ?? "default";
  let pendingImageUrl: string = buff.effectParams?.imageUrl ?? "";
  let pendingImageW: number | undefined = buff.effectParams?.imageWidth;
  let pendingImageH: number | undefined = buff.effectParams?.imageHeight;
  // 2026-05-14 — WebM-backed buff effect. Pre-baked catalog lives in
  // public/buff-fx/; the picker (openVariantPicker) sets this.
  let pendingWebmAsset: string | undefined = buff.webmAsset;
  const fxButtons = EFFECT_LABELS.map((e) => `
    <button class="pop-fx-seg ${pendingEffect === e.id ? "on" : ""}"
            data-fx="${e.id}"
            type="button"
            title="${escapeHtml(e.hint)}">${escapeHtml(e.label)}</button>
  `).join("");
  const showImg = pendingEffect !== "default";
  // Effects UI is gated on STATUS_EFFECTS_ENABLED. While the
  // feature is deferred, the popup just shows colour + name +
  // delete/save — no effect picker, no image URL row. Catalog
  // values for `effect`/`effectParams` are preserved on save (we
  // simply don't surface them); flipping the flag back to true
  // restores everything.
  const effectsBlock = STATUS_EFFECTS_ENABLED
    ? `
    <div class="pop-fx-label">实验性 · 视觉特效（仅 GM / 桌面端）</div>
    <div class="pop-fx-row">${fxButtons}</div>
    <div class="pop-row pop-img-row" style="${showImg ? "" : "display:none"}">
      <input class="pop-img-url" type="text"
             value="${escapeHtml(pendingImageUrl)}"
             placeholder="粒子图片 URL（留空 = 默认 ✨）"/>
      <button class="pop-img-pick" type="button" title="从 OBR 资源库选择">📁</button>
    </div>`
    : "";
  // 2026-05-14 — WebM effect picker. Renders ALWAYS (the legacy
  // particle system above is feature-gated; WebMs are stable).
  const webmBlock = `
    <div class="pop-fx-label">特效</div>
    <div class="pop-webm-row">
      <div class="pop-webm-preview" data-pop-webm-preview>
        ${pendingWebmAsset
          ? `<video src="${escapeHtml(assetUrl(pendingWebmAsset))}" autoplay loop muted playsinline></video>`
          : `<div class="pop-webm-none">无</div>`}
      </div>
      <div class="pop-webm-info">
        <div class="pop-webm-name" data-pop-webm-name>${escapeHtml(shortNameForAsset(pendingWebmAsset))}</div>
        <div class="pop-webm-buttons">
          <button class="pop-webm-change" type="button">更换…</button>
          <button class="pop-webm-clear" type="button" ${pendingWebmAsset ? "" : "disabled"}>清除</button>
        </div>
      </div>
    </div>`;
  popupEl.innerHTML = `
    <div class="pop-row">
      <input class="pop-color" type="color" value="${escapeHtml(buff.color)}"/>
      <input class="pop-name" type="text" maxlength="20" value="${escapeHtml(buff.name)}" placeholder="名称"/>
    </div>
    <div class="pop-row rounds">
      <span class="pop-rounds-label">持续轮数</span>
      <input class="pop-rounds" type="number" min="0" max="99" step="1"
             value="${buff.rounds ?? ""}" placeholder="0"/>
      <span class="pop-rounds-label">0=不限</span>
    </div>
    ${effectsBlock}
    ${webmBlock}
    <div class="pop-row pop-actions">
      <button class="pop-del" type="button">删除</button>
      <span style="flex:1"></span>
      <button class="pop-cancel" type="button">取消</button>
      <button class="pop-save" type="button">保存</button>
    </div>
  `;
  // Position popup just below the anchor bubble, clamped inside the
  // card so it can't fly off-screen on small panels.
  const cardRect = cardEl.getBoundingClientRect();
  const aRect = anchor.getBoundingClientRect();
  popupEl.classList.add("open");
  // Measure popup AFTER making it visible (display:flex).
  const pw = popupEl.offsetWidth;
  const ph = popupEl.offsetHeight;
  let left = aRect.left - cardRect.left;
  let top = aRect.bottom - cardRect.top + 4;
  if (left + pw > cardRect.width - 6) left = cardRect.width - pw - 6;
  if (left < 6) left = 6;
  if (top + ph > cardRect.height - 6) {
    // Flip above the anchor if there's no room below.
    top = aRect.top - cardRect.top - ph - 4;
    if (top < 6) top = 6;
  }
  popupEl.style.left = `${left}px`;
  popupEl.style.top = `${top}px`;

  const nameInp = popupEl.querySelector<HTMLInputElement>(".pop-name")!;
  const colorInp = popupEl.querySelector<HTMLInputElement>(".pop-color")!;
  const roundsInp = popupEl.querySelector<HTMLInputElement>(".pop-rounds")!;
  const save = popupEl.querySelector<HTMLButtonElement>(".pop-save")!;
  const cancel = popupEl.querySelector<HTMLButtonElement>(".pop-cancel")!;
  const del = popupEl.querySelector<HTMLButtonElement>(".pop-del")!;
  const fxSegs = popupEl.querySelectorAll<HTMLButtonElement>(".pop-fx-seg");
  const imgRow = popupEl.querySelector<HTMLDivElement>(".pop-img-row");
  const imgInp = popupEl.querySelector<HTMLInputElement>(".pop-img-url");
  const imgPick = popupEl.querySelector<HTMLButtonElement>(".pop-img-pick");
  fxSegs.forEach((seg) => {
    seg.addEventListener("click", () => {
      const fx = seg.dataset.fx as BuffEffect | undefined;
      if (!fx) return;
      pendingEffect = fx;
      fxSegs.forEach((s) => s.classList.toggle("on", s.dataset.fx === fx));
      if (imgRow) imgRow.style.display = (fx === "default") ? "none" : "";
    });
  });
  if (imgInp) {
    imgInp.addEventListener("input", () => {
      pendingImageUrl = imgInp.value;
      // Manually-typed URL invalidates the cached dims — they'll
      // be re-probed by particles.ts on next sync.
      pendingImageW = undefined;
      pendingImageH = undefined;
    });
  }
  // 2026-05-14 — WebM picker buttons.
  const webmPreview = popupEl.querySelector<HTMLElement>('[data-pop-webm-preview]');
  const webmName    = popupEl.querySelector<HTMLElement>('[data-pop-webm-name]');
  const webmChange  = popupEl.querySelector<HTMLButtonElement>('.pop-webm-change');
  const webmClear   = popupEl.querySelector<HTMLButtonElement>('.pop-webm-clear');
  const updateWebmUI = (): void => {
    if (webmPreview) {
      webmPreview.innerHTML = pendingWebmAsset
        ? `<video src="${escapeHtml(assetUrl(pendingWebmAsset))}" autoplay loop muted playsinline></video>`
        : `<div class="pop-webm-none">无</div>`;
    }
    if (webmName) webmName.textContent = shortNameForAsset(pendingWebmAsset);
    if (webmClear) {
      if (pendingWebmAsset) webmClear.removeAttribute("disabled");
      else webmClear.setAttribute("disabled", "true");
    }
  };
  if (webmChange) {
    webmChange.addEventListener("click", async () => {
      const picked = await openVariantPicker(pendingWebmAsset);
      // null = dismissed (no change); "" = explicit "无特效" cell;
      // non-empty string = picked asset path.
      if (picked === null) return;
      pendingWebmAsset = picked === "" ? undefined : picked;
      updateWebmUI();
    });
  }
  if (webmClear) {
    webmClear.addEventListener("click", () => {
      pendingWebmAsset = undefined;
      updateWebmUI();
    });
  }

  if (imgPick) {
    imgPick.addEventListener("click", async () => {
      // OBR.assets.downloadImages opens OBR's library picker.
      // Returns ImageContent[] with URL + dims already populated,
      // so we save the dims to skip the DOM re-probe later.
      try {
        const images = await OBR.assets.downloadImages(false, "");
        if (Array.isArray(images) && images.length > 0) {
          const img = images[0] as any;
          if (typeof img.url === "string") {
            pendingImageUrl = img.url;
            pendingImageW = typeof img.width === "number" ? img.width : undefined;
            pendingImageH = typeof img.height === "number" ? img.height : undefined;
            if (imgInp) imgInp.value = img.url;
          }
        }
      } catch (e) {
        console.warn("[status/palette] downloadImages failed", e);
      }
    });
  }

  const close = (): void => {
    const dropped = discardUnnamedBuffIfPending(id);
    popupBuffId = null;
    popupEl.classList.remove("open");
    popupEl.innerHTML = "";
    if (dropped) render();
  };

  save.addEventListener("click", async () => {
    const name = nameInp.value.trim();
    if (!name) {
      // Empty-name save also closes the popup and discards a
      // newly-created placeholder buff. Differs from existing buffs
      // (which never get a save with empty name because their input
      // pre-fills with the real name) — those would stay open if the
      // user manually cleared their name and clicked save, but that's
      // an edge case the user accepted.
      close();
      return;
    }
    // User committed a real name — drop the new-buff placeholder
    // tracking BEFORE we mutate the catalog so the close handler
    // doesn't re-delete the buff if something goes wrong.
    newlyCreatedBuffIds.delete(id);
    const target = buffs.find((b) => b.id === id);
    if (target) {
      target.name = name;
      target.color = colorInp.value;
      const rounds = Math.floor(Number(roundsInp.value));
      if (Number.isFinite(rounds) && rounds > 0) target.rounds = rounds;
      else delete target.rounds;
      target.effect = pendingEffect === "default" ? undefined : pendingEffect;
      // 2026-05-14 — persist webmAsset. Empty = no webm effect
      // (renderer falls back to legacy curved band / particle).
      if (pendingWebmAsset) target.webmAsset = pendingWebmAsset;
      else delete (target as any).webmAsset;
      // effectParams: persist imageUrl + cached dims when user has
      // configured a particle image. Empty URL → no effectParams,
      // particles fall back to the bundled default sparkle.
      const cleanUrl = pendingImageUrl.trim();
      if (target.effect && cleanUrl.length > 0) {
        const params: any = { imageUrl: cleanUrl };
        if (typeof pendingImageW === "number") params.imageWidth = pendingImageW;
        if (typeof pendingImageH === "number") params.imageHeight = pendingImageH;
        (target as any).effectParams = params;
      } else {
        // No effect, or no image configured — clear any leftover
        // imageUrl so the catalog JSON stays terse.
        const ep = (target as any).effectParams;
        if (ep) {
          const { imageUrl: _, imageWidth: __, imageHeight: ___, ...rest } = ep;
          if (Object.keys(rest).length > 0) (target as any).effectParams = rest;
          else delete (target as any).effectParams;
        }
      }
      await saveCatalog();
    }
    close();
    render();
  });
  cancel.addEventListener("click", close);
  del.addEventListener("click", async () => {
    if (!window.confirm(`删除「${buff.name}」？`)) return;
    buffs = buffs.filter((b) => b.id !== id);
    await saveCatalog();
    close();
    render();
  });
  nameInp.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); save.click(); }
    else if (e.key === "Escape") close();
  });

  requestAnimationFrame(() => nameInp.focus());
}

// Close popup when user clicks anywhere outside the popup AND outside
// a bubble (clicking another bubble re-opens the popup at that
// target, so we let that path through).
function handleOutsidePopupClick(e: MouseEvent): void {
  if (!popupEl.classList.contains("open")) return;
  const tgt = e.target as Node | null;
  if (!tgt) return;
  if (popupEl.contains(tgt)) return;
  const bubble = (tgt as HTMLElement).closest?.(".bubble.editable");
  if (bubble) return;
  // Same close-side cleanup as the popup's own close(): discard a
  // newly-created placeholder buff whose name was never filled in.
  let dropped = false;
  if (popupBuffId) dropped = discardUnnamedBuffIfPending(popupBuffId);
  popupBuffId = null;
  popupEl.classList.remove("open");
  popupEl.innerHTML = "";
  if (dropped) render();
}
window.addEventListener("click", handleOutsidePopupClick, true);

// === Edit-mode actions ======================================================

async function onRenameCategory(oldName: string): Promise<void> {
  const next = window.prompt(`重命名分类「${oldName}」（留空=删除）`, oldName);
  if (next === null) return;
  const trimmed = next.trim();
  if (trimmed === "") {
    // Refuse to delete the last named group — the user must always
    // have somewhere to drop new buffs into. (UNCATEGORIZED still
    // exists implicitly but isn't a "named" group the user can
    // rename / reorder, so leaving zero named groups breaks the
    // create-buff-into-active-filter UX.)
    if (groupOrder.length <= 1) {
      window.alert(`至少保留一个分组，无法删除「${oldName}」。`);
      return;
    }
    if (!window.confirm(`删除分类「${oldName}」？该分类下的 buff 会移到「${UNCATEGORIZED}」。`)) return;
    for (const b of buffs) if ((b.group ?? UNCATEGORIZED) === oldName) b.group = undefined;
    groupOrder = groupOrder.filter((g) => g !== oldName);
    if (activeFilter === oldName) activeFilter = null;
    await saveCatalog();
    render();
    return;
  }
  if (trimmed === oldName) return;
  if (trimmed === UNCATEGORIZED) return;
  for (const b of buffs) if ((b.group ?? UNCATEGORIZED) === oldName) b.group = trimmed;
  const idx = groupOrder.indexOf(oldName);
  if (idx >= 0) groupOrder[idx] = trimmed;
  else groupOrder.push(trimmed);
  if (activeFilter === oldName) activeFilter = trimmed;
  await saveCatalog();
  render();
}

async function onReorderCategory(dragName: string, dropOnName: string): Promise<void> {
  if (dragName === dropOnName) return;
  const order = mergedGroupOrder(groupOrder, buffs);
  const idxFrom = order.indexOf(dragName);
  if (idxFrom < 0) return;
  // Remove from old position; recompute target index AFTER removal so
  // the splice math stays right regardless of relative direction.
  order.splice(idxFrom, 1);
  const idxTo = order.indexOf(dropOnName);
  if (idxTo < 0) return;
  order.splice(idxTo, 0, dragName);
  groupOrder = order;
  await saveCatalog();
  render();
}

async function onMoveBuff(id: string, targetGroup: string): Promise<void> {
  const target = buffs.find((b) => b.id === id);
  if (!target) return;
  const nextGroup = targetGroup === UNCATEGORIZED ? undefined : targetGroup;
  if ((target.group ?? UNCATEGORIZED) === (nextGroup ?? UNCATEGORIZED)) return;
  target.group = nextGroup;
  await saveCatalog();
  render();
}

async function onReorderBuff(dragId: string, dropOnId: string, before: boolean): Promise<void> {
  if (dragId === dropOnId) return;
  const fromIdx = buffs.findIndex((b) => b.id === dragId);
  const toIdx0 = buffs.findIndex((b) => b.id === dropOnId);
  if (fromIdx < 0 || toIdx0 < 0) return;
  const [moved] = buffs.splice(fromIdx, 1);
  // Recompute drop-on index after splice (it shifts if from < to).
  const toIdx = buffs.findIndex((b) => b.id === dropOnId);
  // Inherit the drop target's group so that dragging across groups
  // also moves the buff into the destination's category — matches
  // user expectation that drag-to-reorder visually lands the buff
  // wherever it drops.
  const dropTarget = buffs[toIdx];
  if (dropTarget) moved.group = dropTarget.group;
  buffs.splice(before ? toIdx : toIdx + 1, 0, moved);
  await saveCatalog();
  render();
}

async function onAddBuff(): Promise<void> {
  // New buffs land in the active filter group (apply-side activeFilter
  // doesn't apply in edit mode, but we still respect it as the last
  // user intent), or UNCATEGORIZED otherwise.
  const group = activeFilter && activeFilter !== UNCATEGORIZED ? activeFilter : undefined;
  const id = genId();
  const newBuff: BuffDef = {
    id,
    // Default name intentionally empty (user request 2026-05-08): the
    // popup auto-opens with focus on the name field, so the user types
    // a real name before saving. If they bail out without naming, the
    // close-side cleanup (newlyCreatedBuffIds) drops the placeholder.
    name: "",
    color: "#5dade2",
    group,
  };
  buffs.push(newBuff);
  newlyCreatedBuffIds.add(id);
  await saveCatalog();
  render();
  // Auto-open the edit popup so the user can rename / recolour
  // immediately. Need to wait for the new <div> to land in the DOM.
  requestAnimationFrame(() => {
    const el = gridEl.querySelector<HTMLElement>(`.bubble[data-id="${cssEscape(id)}"]`);
    if (el) openEditPopup(id, el);
  });
}

/** Drop a newly-created buff from the catalog if its name is still
 *  empty when the popup closes. Called from EVERY close path of the
 *  edit popup (save-with-empty bail, cancel, outside-click, escape).
 *  Returns true if a buff was actually deleted (so the caller can
 *  re-render). */
function discardUnnamedBuffIfPending(id: string): boolean {
  if (!newlyCreatedBuffIds.has(id)) return false;
  newlyCreatedBuffIds.delete(id);
  const buff = buffs.find((b) => b.id === id);
  if (!buff) return false;
  if (buff.name.trim() !== "") return false;
  buffs = buffs.filter((b) => b.id !== id);
  void saveCatalog();
  return true;
}

// CSS.escape polyfill for the auto-open bubble lookup. CSS.escape
// is widely supported but a tiny safe shim avoids any edge case.
function cssEscape(value: string): string {
  if (typeof (window as any).CSS?.escape === "function") {
    return (window as any).CSS.escape(value);
  }
  return value.replace(/([!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, "\\$1");
}

// === Render dispatcher ======================================================

// Footer text is split into one line per affordance so each
// reads on its own row inside the cramped 340px panel — much less
// eye-strain than a long " · "-joined run-on string.
const FOOT_APPLY_LINES = [
  `<b>左键</b>拖到目标释放 = 应用 buff`,
  `<b>右键</b>拖过角色 = 路径切换 (有则去)`,
  `<b>左键</b>拖红色 ✕ = 单个清除`,
  `<b>右键</b>拖红色 ✕ = 路径全清`,
  `<kbd>]</kbd> 关闭面板`,
];
const FOOT_EDIT_LINES = [
  `<b>点击</b>分类 = 重命名（清空 = 删除）`,
  `<b>拖</b>分类 = 排序`,
  `<b>点击</b> buff = 颜色 / 名字 / 特效编辑`,
  `<b>拖</b> buff 到分类 = 切换分组`,
  `<kbd>]</kbd> 退出编辑`,
];

function setFooter(lines: string[]): void {
  footEl.innerHTML = lines.map((l) => `<div class="foot-line">${l}</div>`).join("");
}

function render(): void {
  if (editMode) {
    btnEdit.classList.add("on");
    document.body.classList.add("edit-mode");
    footEl.classList.add("edit-foot");
    setFooter(FOOT_EDIT_LINES);
  } else {
    btnEdit.classList.remove("on");
    document.body.classList.remove("edit-mode");
    footEl.classList.remove("edit-foot");
    addCatPending = false;
    setFooter(FOOT_APPLY_LINES);
  }
  renderFilters();
  renderGrid();
  // Mode toggle invalidates any open popup (its anchor may be gone).
  popupBuffId = null;
  popupEl.classList.remove("open");
  popupEl.innerHTML = "";
}

btnEdit.addEventListener("click", () => {
  editMode = !editMode;
  render();
});

// === Toolbar / shortcuts ====================================================

window.addEventListener("contextmenu", (e) => e.preventDefault());

bindPanelDrag(dragHandle, PANEL_IDS.statusPalette);

btnClose.addEventListener("click", async () => {
  try { await OBR.broadcast.sendMessage(BC_TOGGLE, {}, { destination: "LOCAL" }); } catch {}
});
window.addEventListener("keydown", async (e) => {
  if (e.key === "]" || e.key === "Escape") {
    if (popupBuffId) {
      popupBuffId = null;
      popupEl.classList.remove("open");
      popupEl.innerHTML = "";
      return;
    }
    if (addCatPending) {
      addCatPending = false;
      render();
      return;
    }
    e.preventDefault();
    try { await OBR.broadcast.sendMessage(BC_TOGGLE, {}, { destination: "LOCAL" }); } catch {}
  }
});

// === JSON import / export ===================================================

btnExport.addEventListener("click", () => {
  const file: CatalogFile = {
    version: 2,
    buffs,
    groupOrder: mergedGroupOrder(groupOrder, buffs),
  };
  const blob = new Blob([JSON.stringify(file, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "status-buff-catalog.json";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1000);
});

btnImport.addEventListener("click", () => {
  fileImport.value = "";
  fileImport.click();
});
fileImport.addEventListener("change", async () => {
  const f = fileImport.files?.[0];
  if (!f) return;
  try {
    const text = await f.text();
    const parsed = parseCatalog(JSON.parse(text));
    if (!parsed) {
      window.alert("JSON 文件格式错误：应为 buff 数组或 { buffs, groupOrder } 对象。");
      return;
    }
    buffs = parsed.buffs;
    groupOrder = parsed.groupOrder;
    await saveCatalog();
    render();
  } catch (e: any) {
    window.alert(`导入失败：${e?.message ?? String(e)}`);
  }
});

// === Boot ===================================================================

OBR.onReady(async () => {
  installDebugOverlay();
  await loadCatalog();
  // Cross-tab refresh — same client, two iframes (e.g. palette popover
  // + manage popover) editing the catalog. The `storage` event fires
  // when the OTHER tab writes localStorage; reload + render here.
  window.addEventListener("storage", (e) => {
    if (e.key === LS_BUFF_CATALOG) void loadCatalog();
  });
});
