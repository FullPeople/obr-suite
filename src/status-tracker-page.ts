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

// Inline "+ category" input is open when this is true. Replaces the
// "+" button in the filter row with an <input>.
let addCatPending = false;
// Active edit popup target (buff id), or null if popup is closed.
let popupBuffId: string | null = null;

// === Catalog load / save ====================================================

async function loadCatalog(): Promise<void> {
  try {
    const meta = await OBR.scene.getMetadata();
    const v = meta[SCENE_BUFF_CATALOG_KEY] as unknown;
    const parsed = parseCatalog(v);
    if (parsed) {
      buffs = parsed.buffs;
      groupOrder = parsed.groupOrder;
    }
  } catch {}
  render();
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
  try {
    await OBR.scene.setMetadata({ [SCENE_BUFF_CATALOG_KEY]: file });
  } catch (e) {
    console.warn("[status/palette] saveCatalog failed", e);
  }
}

function mergedGroupOrder(prior: string[], list: BuffDef[]): string[] {
  const seen = new Set(prior);
  const out = prior.slice();
  for (const b of list) {
    const g = b.group ?? UNCATEGORIZED;
    if (!seen.has(g)) {
      seen.add(g);
      out.push(g);
    }
  }
  // Drop empty groups (except UNCATEGORIZED, which we keep as a
  // landing pad even when no buffs occupy it).
  return out.filter((g) =>
    g === UNCATEGORIZED || list.some((b) => (b.group ?? UNCATEGORIZED) === g),
  );
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
      // Apply mode: click filters (persisted per-client).
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
    const dragAttr = editMode ? `draggable="true"` : "";
    const cls = editMode ? "bubble editable" : "bubble";
    html += `<div class="${cls}"
                  data-id="${escapeHtml(b.id)}"
                  ${dragAttr}
                  style="background:${escapeHtml(b.color)};color:${escapeHtml(fg)}">
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

function openEditPopup(id: string, anchor: HTMLElement): void {
  const buff = buffs.find((b) => b.id === id);
  if (!buff) return;
  popupBuffId = id;
  // Pending state for the segmented picker — read on save.
  let pendingEffect: BuffEffect = buff.effect ?? "default";
  let pendingImageUrl: string = buff.effectParams?.imageUrl ?? "";
  let pendingImageW: number | undefined = buff.effectParams?.imageWidth;
  let pendingImageH: number | undefined = buff.effectParams?.imageHeight;
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
  popupEl.innerHTML = `
    <div class="pop-row">
      <input class="pop-color" type="color" value="${escapeHtml(buff.color)}"/>
      <input class="pop-name" type="text" maxlength="20" value="${escapeHtml(buff.name)}" placeholder="名称"/>
    </div>
    ${effectsBlock}
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
    popupBuffId = null;
    popupEl.classList.remove("open");
    popupEl.innerHTML = "";
  };

  save.addEventListener("click", async () => {
    const name = nameInp.value.trim();
    if (!name) return;
    const target = buffs.find((b) => b.id === id);
    if (target) {
      target.name = name;
      target.color = colorInp.value;
      target.effect = pendingEffect === "default" ? undefined : pendingEffect;
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
  popupBuffId = null;
  popupEl.classList.remove("open");
  popupEl.innerHTML = "";
}
window.addEventListener("click", handleOutsidePopupClick, true);

// === Edit-mode actions ======================================================

async function onRenameCategory(oldName: string): Promise<void> {
  const next = window.prompt(`重命名分类「${oldName}」（留空=删除）`, oldName);
  if (next === null) return;
  const trimmed = next.trim();
  if (trimmed === "") {
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
    name: "新 buff",
    color: "#5dade2",
    group,
  };
  buffs.push(newBuff);
  await saveCatalog();
  render();
  // Auto-open the edit popup so the user can rename / recolour
  // immediately. Need to wait for the new <div> to land in the DOM.
  requestAnimationFrame(() => {
    const el = gridEl.querySelector<HTMLElement>(`.bubble[data-id="${cssEscape(id)}"]`);
    if (el) openEditPopup(id, el);
  });
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
    await OBR.scene.setMetadata({
      [SCENE_BUFF_CATALOG_KEY]: { version: 2, buffs: parsed.buffs, groupOrder: parsed.groupOrder } as CatalogFile,
    });
    buffs = parsed.buffs;
    groupOrder = parsed.groupOrder;
    render();
  } catch (e: any) {
    window.alert(`导入失败：${e?.message ?? String(e)}`);
  }
});

// === Boot ===================================================================

OBR.onReady(async () => {
  await loadCatalog();
  OBR.scene.onMetadataChange(() => { void loadCatalog(); });
});
