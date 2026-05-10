// Resource Tracker — self-contained UI component.
//
// `mountResourcePanel(container, getItemId)` renders the resource
// list + click-to-modify icons into the given container element.
// Edit / create flows broadcast to the background module which opens
// a separate fullscreen modal (resource-edit.html) with the form.
//
// === Update strategy: optimistic DOM patching =============================
//
// On every click we MUTATE THE DOM IN PLACE (toggle .full/.spent on
// the affected pills, update progress-bar width / label, etc) — we
// do NOT call `render()` again. After the optimistic patch we kick
// off `updateResource()` which writes scene metadata; that fires
// `items.onChange` which calls `refresh()`. `refresh()` compares
// the freshly-fetched array against `currentRender` (deep-equal via
// JSON.stringify) and SKIPS the full re-render when they match. The
// upshot: clicks feel instant, the icon's CSS transition + the
// .pulse animation play uninterrupted, and the only re-renders that
// actually happen are for EXTERNAL changes (someone else editing
// the same token, edit modal save, resource added / removed).
//
// === Click semantics, by ResourceType =====================================
//
//   • count   — N icons rendered, 1-indexed by `data-pos`. Click
//               position N: if N > current → fill up to N (current
//               := N); if N <= current → consume down to N-1
//               (current := N-1). This matches a typical spell-
//               slot tracker, and avoids the previous bug where
//               clicking ANY icon at current=0 reset to max.
//   • bar     — single icon + horizontal progress bar. Click bar
//               left half = -1, right half = +1. Click icon at
//               current=0 resets to max.
//   • number  — single icon + "current / max" text. Click icon =
//               -1 (clamped to 0). Right-click = +1 (clamped to max).
//               Click icon at current=0 resets to max.

import OBR, { Item } from "@owlbear-rodeo/sdk";
import { Resource, IconId, PLUGIN_ID } from "./types";
import { ICON_LIBRARY } from "./icons";
import { readResources, updateResource } from "./storage";

const BC_OPEN_EDIT = `${PLUGIN_ID}/edit-open`;

export interface MountOptions {
  container: HTMLElement;
  getItemId: () => string | null;
  onChange?: (msg: ChangeNotice) => void;
}

export interface ChangeNotice {
  resourceName: string;
  delta: number;
  current: number;
  max: number;
}

export function mountResourcePanel(opts: MountOptions): {
  refresh: () => Promise<void>;
  unmount: () => void;
} {
  const { container, getItemId, onChange } = opts;
  let currentRender: Resource[] = [];
  let lastSnapshotJson = "";

  ensureStyles();

  const itemsUnsub = OBR.scene.items.onChange(() => { void refresh(); });

  async function refresh(): Promise<void> {
    const id = getItemId();
    if (!id) {
      container.innerHTML = `<div class="rt-empty">未选中任何 token</div>`;
      currentRender = [];
      lastSnapshotJson = "";
      return;
    }
    let items: Item[] = [];
    try { items = await OBR.scene.items.getItems([id]); } catch {}
    const item = items[0] ?? null;
    const next = readResources(item);
    const nextJson = JSON.stringify(next);
    if (nextJson === lastSnapshotJson) {
      // External / our-own commit landed; data identical to what's
      // already on screen → skip the full innerHTML rewrite. This is
      // the path that prevents flicker on click: we already mutated
      // the DOM optimistically, the metadata write echoes back via
      // items.onChange, the pulled state matches local state, no
      // re-render fires.
      currentRender = next;
      return;
    }
    currentRender = next;
    lastSnapshotJson = nextJson;
    render();
  }

  function render(): void {
    const id = getItemId();
    if (!id) {
      container.innerHTML = `<div class="rt-empty">未选中任何 token</div>`;
      return;
    }
    if (currentRender.length === 0) {
      container.innerHTML = `
        <div class="rt-empty-state">
          <div class="rt-empty-msg">该 token 还没有任何资源</div>
          <button class="rt-add-first" type="button">＋ 创建资源</button>
        </div>
      `;
      container.querySelector<HTMLButtonElement>(".rt-add-first")
        ?.addEventListener("click", () => openCreate());
      return;
    }
    const sorted = [...currentRender].sort((a, b) => {
      const oa = a.order ?? Number.MAX_SAFE_INTEGER;
      const ob = b.order ?? Number.MAX_SAFE_INTEGER;
      return oa - ob;
    });
    container.innerHTML = `
      <div class="rt-list">${sorted.map(renderResourceRow).join("")}</div>
      <button class="rt-add" type="button">＋ 新增资源</button>
    `;
    bindRowEvents();
  }

  // --- row markup ----------------------------------------------------------

  function renderResourceRow(r: Resource): string {
    let pillsHtml = "";
    switch (r.type) {
      case "count":  pillsHtml = renderCountPills(r); break;
      case "bar":    pillsHtml = renderBarPill(r); break;
      case "number": pillsHtml = renderNumberPill(r); break;
    }
    return `
      <div class="rt-row" data-id="${escapeAttr(r.id)}">
        <div class="rt-row-head">
          <div class="rt-row-name" title="${escapeAttr(r.name)}">${escapeHtml(r.name || "(未命名)")}</div>
          <div class="rt-row-meta" data-meta>${r.current} / ${r.max}</div>
          <button class="rt-row-edit" type="button" data-edit-id="${escapeAttr(r.id)}" title="编辑">⚙</button>
        </div>
        <div class="rt-pills">${pillsHtml}</div>
      </div>
    `;
  }

  function renderCountPills(r: Resource): string {
    const max = Math.max(0, Math.floor(r.max));
    const cur = Math.max(0, Math.min(max, Math.floor(r.current)));
    const cells: string[] = [];
    for (let i = 1; i <= max; i++) {
      const filled = i <= cur;
      cells.push(`
        <span class="rt-pill rt-pill-icon ${filled ? "full" : "spent"}"
              data-action="count-toggle"
              data-rid="${escapeAttr(r.id)}"
              data-pos="${i}"
              title="${escapeAttr(r.name)} · 点 ${i} ${filled ? "→ " + (i - 1) : "→ " + i} · 右键归满">
          ${ICON_LIBRARY[r.icon as IconId] ?? ICON_LIBRARY.gem}
        </span>
      `);
    }
    if (max === 0) {
      cells.push(`<span class="rt-pill-empty">最大值为 0（点 ⚙ 设置）</span>`);
    }
    return cells.join("");
  }

  function renderBarPill(r: Resource): string {
    const max = Math.max(1, r.max);
    const cur = Math.max(0, Math.min(max, r.current));
    const ratio = (cur / max) * 100;
    return `
      <span class="rt-pill rt-pill-icon full"
            data-action="bar-reset"
            data-rid="${escapeAttr(r.id)}"
            title="${escapeAttr(r.name)} ${cur}/${max} · 左键 = 重置/-1，右键 = +1">
        ${ICON_LIBRARY[r.icon as IconId] ?? ICON_LIBRARY.gem}
      </span>
      <div class="rt-bar"
           data-action="bar-step"
           data-rid="${escapeAttr(r.id)}"
           title="左半 = -1，右半 = +1">
        <div class="rt-bar-fill" data-bar-fill style="width:${ratio.toFixed(1)}%"></div>
        <div class="rt-bar-label" data-bar-label>${cur} / ${max}</div>
      </div>
    `;
  }

  function renderNumberPill(r: Resource): string {
    const cur = r.current;
    const max = r.max;
    return `
      <span class="rt-pill rt-pill-icon ${cur <= 0 ? "spent" : "full"}"
            data-action="number-step"
            data-rid="${escapeAttr(r.id)}"
            title="${escapeAttr(r.name)} ${cur}/${max} · 左键 = -1，右键 = +1，归零再点 = 重置">
        ${ICON_LIBRARY[r.icon as IconId] ?? ICON_LIBRARY.gem}
      </span>
      <div class="rt-num-text" data-num-text>${cur} <span class="rt-num-sep">/</span> ${max}</div>
    `;
  }

  // --- optimistic DOM patcher ---------------------------------------------

  /** Apply the new state of `r` to the existing DOM nodes, without
   *  re-rendering the full panel. The pill that the user clicked
   *  (passed as `pulseEl`) gets a one-shot scale-pulse so the
   *  feedback is unmistakable. */
  function patchRow(r: Resource, pulseEl: HTMLElement | null): void {
    const row = container.querySelector<HTMLElement>(`.rt-row[data-id="${cssEscape(r.id)}"]`);
    if (!row) return;
    const meta = row.querySelector<HTMLElement>("[data-meta]");
    if (meta) meta.textContent = `${r.current} / ${r.max}`;
    if (r.type === "count") {
      const max = Math.max(0, Math.floor(r.max));
      const cur = Math.max(0, Math.min(max, Math.floor(r.current)));
      row.querySelectorAll<HTMLElement>('[data-action="count-toggle"]').forEach((p) => {
        const pos = parseInt(p.dataset.pos ?? "0", 10);
        const filled = pos <= cur;
        p.classList.toggle("full", filled);
        p.classList.toggle("spent", !filled);
      });
    } else if (r.type === "bar") {
      const max = Math.max(1, r.max);
      const cur = Math.max(0, Math.min(max, r.current));
      const ratio = (cur / max) * 100;
      const fill = row.querySelector<HTMLElement>("[data-bar-fill]");
      const label = row.querySelector<HTMLElement>("[data-bar-label]");
      if (fill) fill.style.width = `${ratio.toFixed(1)}%`;
      if (label) label.textContent = `${cur} / ${max}`;
    } else if (r.type === "number") {
      const txt = row.querySelector<HTMLElement>("[data-num-text]");
      if (txt) txt.innerHTML = `${r.current} <span class="rt-num-sep">/</span> ${r.max}`;
      const icon = row.querySelector<HTMLElement>('[data-action="number-step"]');
      if (icon) {
        icon.classList.toggle("full", r.current > 0);
        icon.classList.toggle("spent", r.current <= 0);
      }
    }
    // Pulse the clicked element (or the row's primary icon if not given).
    if (pulseEl) firePulse(pulseEl);
  }

  function firePulse(el: HTMLElement): void {
    el.classList.remove("rt-pulse");
    // Force reflow so the same element can re-trigger the animation
    // on rapid repeat clicks.
    void el.offsetWidth;
    el.classList.add("rt-pulse");
    setTimeout(() => el.classList.remove("rt-pulse"), 280);
  }

  // --- event wiring --------------------------------------------------------

  function bindRowEvents(): void {
    const id = getItemId();
    if (!id) return;
    container.querySelectorAll<HTMLElement>('[data-action="count-toggle"]').forEach((el) => {
      el.addEventListener("click", () => void onCountClick(id, el));
      el.addEventListener("contextmenu", (e) => { e.preventDefault(); void onCountReset(id, el); });
    });
    container.querySelectorAll<HTMLElement>('[data-action="bar-step"]').forEach((el) => {
      el.addEventListener("click", (e) => void onBarStep(id, el, e as MouseEvent));
      el.addEventListener("contextmenu", (e) => e.preventDefault());
    });
    container.querySelectorAll<HTMLElement>('[data-action="bar-reset"]').forEach((el) => {
      el.addEventListener("click", () => void onIconReset(id, el));
      el.addEventListener("contextmenu", (e) => { e.preventDefault(); void onIconStep(id, el, +1); });
    });
    container.querySelectorAll<HTMLElement>('[data-action="number-step"]').forEach((el) => {
      el.addEventListener("click", () => void onNumberClickLeft(id, el));
      el.addEventListener("contextmenu", (e) => { e.preventDefault(); void onIconStep(id, el, +1); });
    });
    container.querySelectorAll<HTMLButtonElement>(".rt-row-edit").forEach((b) => {
      b.addEventListener("click", () => {
        const rid = b.dataset.editId ?? "";
        const r = currentRender.find((x) => x.id === rid);
        if (r) openEdit(r);
      });
    });
    container.querySelector<HTMLButtonElement>(".rt-add")?.addEventListener("click", () => openCreate());
  }

  // --- click reducers ------------------------------------------------------
  //
  // Each handler computes the next `current`, optimistically patches
  // the DOM (no re-render), then persists. items.onChange echo skips
  // re-render because the metadata-fetched state matches local state.

  /** Position-aware count click. Click position N:
   *    • If N > current  → fill: current := N
   *    • If N <= current → consume: current := N - 1
   *  Net effect: clicking the boundary toggles by 1; clicking far
   *  positions jumps directly there. Replaces the older "any click
   *  at current=0 resets to max" footgun. */
  async function onCountClick(itemId: string, el: HTMLElement): Promise<void> {
    const rid = el.dataset.rid!;
    const pos = parseInt(el.dataset.pos ?? "0", 10);
    const r = currentRender.find((x) => x.id === rid);
    if (!r) return;
    const next = pos > r.current ? pos : pos - 1;
    if (next === r.current) return;
    await applyChange(itemId, r, next, next - r.current, el);
  }
  async function onCountReset(itemId: string, el: HTMLElement): Promise<void> {
    const rid = el.dataset.rid!;
    const r = currentRender.find((x) => x.id === rid);
    if (!r || r.current >= r.max) return;
    await applyChange(itemId, r, r.max, r.max - r.current, el);
  }
  async function onBarStep(itemId: string, el: HTMLElement, e: MouseEvent): Promise<void> {
    const rid = el.dataset.rid!;
    const r = currentRender.find((x) => x.id === rid);
    if (!r) return;
    const rect = el.getBoundingClientRect();
    const left = (e.clientX - rect.left) < rect.width / 2;
    const next = left ? Math.max(0, r.current - 1) : Math.min(r.max, r.current + 1);
    if (next === r.current) return;
    await applyChange(itemId, r, next, next - r.current, el);
  }
  async function onIconReset(itemId: string, el: HTMLElement): Promise<void> {
    const rid = el.dataset.rid!;
    const r = currentRender.find((x) => x.id === rid);
    if (!r) return;
    if (r.current >= r.max) {
      const next = Math.max(0, r.current - 1);
      if (next !== r.current) await applyChange(itemId, r, next, next - r.current, el);
      return;
    }
    await applyChange(itemId, r, r.max, r.max - r.current, el);
  }
  async function onIconStep(itemId: string, el: HTMLElement, dir: 1 | -1): Promise<void> {
    const rid = el.dataset.rid!;
    const r = currentRender.find((x) => x.id === rid);
    if (!r) return;
    const next = dir > 0 ? Math.min(r.max, r.current + 1) : Math.max(0, r.current - 1);
    if (next === r.current) return;
    await applyChange(itemId, r, next, next - r.current, el);
  }
  async function onNumberClickLeft(itemId: string, el: HTMLElement): Promise<void> {
    const rid = el.dataset.rid!;
    const r = currentRender.find((x) => x.id === rid);
    if (!r) return;
    if (r.current <= 0) {
      await applyChange(itemId, r, r.max, r.max, el);
    } else {
      await applyChange(itemId, r, r.current - 1, -1, el);
    }
  }

  async function applyChange(
    itemId: string,
    r: Resource,
    next: number,
    delta: number,
    pulseEl: HTMLElement | null,
  ): Promise<void> {
    if (next === r.current) return;
    // 1. Optimistically update local state.
    const idx = currentRender.findIndex((x) => x.id === r.id);
    if (idx < 0) return;
    const nextRow: Resource = { ...r, current: next };
    currentRender = currentRender.map((x, i) => (i === idx ? nextRow : x));
    lastSnapshotJson = JSON.stringify(currentRender);
    // 2. Patch DOM in place + run pulse animation. No re-render.
    patchRow(nextRow, pulseEl);
    // 3. Notifier hook (host pages can pop a "consumed N" toast).
    onChange?.({ resourceName: r.name || "(未命名)", delta, current: next, max: r.max });
    // 4. Persist. items.onChange echoes back; refresh() compares
    //    JSON snapshots and skips the re-render path.
    await updateResource(itemId, r.id, () => nextRow);
  }

  // --- modal open dispatchers ---------------------------------------------

  function openCreate(): void {
    const id = getItemId();
    if (!id) return;
    try {
      OBR.broadcast.sendMessage(BC_OPEN_EDIT, { itemId: id }, { destination: "LOCAL" });
    } catch (e) {
      console.warn("[resource-tracker] openCreate broadcast failed", e);
    }
  }

  function openEdit(r: Resource): void {
    const id = getItemId();
    if (!id) return;
    try {
      OBR.broadcast.sendMessage(BC_OPEN_EDIT, { itemId: id, resource: r }, { destination: "LOCAL" });
    } catch (e) {
      console.warn("[resource-tracker] openEdit broadcast failed", e);
    }
  }

  return {
    refresh,
    unmount: () => {
      try { itemsUnsub(); } catch {}
      container.innerHTML = "";
    },
  };
}

// --- helpers -----------------------------------------------------------------

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
function escapeAttr(s: string): string { return escapeHtml(s); }
function cssEscape(s: string): string {
  // querySelector-safe escape for arbitrary id strings (resource ids
  // contain timestamps + dots from Math.random()). Using CSS.escape
  // when available, falling back to a basic char filter.
  if (typeof (window as any).CSS?.escape === "function") return (window as any).CSS.escape(s);
  return s.replace(/([!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, "\\$1");
}

// --- styling -----------------------------------------------------------------

let stylesInjected = false;
function ensureStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;
  const css = `
    .rt-empty, .rt-empty-msg { font-size:11.5px; color:#9aa0b3; padding:10px 6px; text-align:center }
    .rt-empty-state { display:flex; flex-direction:column; align-items:center; gap:8px; padding:14px 6px }
    .rt-add, .rt-add-first {
      height:28px; padding:0 14px; border-radius:6px;
      background:rgba(46,204,113,0.18);
      border:1px solid rgba(46,204,113,0.5);
      color:#7eecaf; font-size:12px; cursor:pointer;
      font-family:inherit; font-weight:600;
    }
    .rt-add:hover, .rt-add-first:hover { background:rgba(46,204,113,0.3); border-color:rgba(46,204,113,0.7) }
    .rt-add { display:block; margin:8px auto 0 }
    .rt-list { display:flex; flex-direction:column; gap:8px }
    .rt-row {
      background:rgba(255,255,255,0.04);
      border:1px solid rgba(255,255,255,0.08);
      border-radius:6px;
      padding:8px 10px;
    }
    .rt-row-head { display:flex; align-items:center; gap:8px; margin-bottom:6px }
    .rt-row-name { flex:1; font-size:12px; font-weight:600; color:#e6e8ee; overflow:hidden; text-overflow:ellipsis; white-space:nowrap }
    .rt-row-meta { font-size:11px; color:#9aa0b3; font-variant-numeric:tabular-nums; transition:color .18s }
    .rt-row-edit {
      background:none; border:none; cursor:pointer; color:#9aa0b3;
      font-size:14px; padding:2px 4px; border-radius:4px;
      transition:background .12s, color .12s;
    }
    .rt-row-edit:hover { background:rgba(255,255,255,0.08); color:#e6e8ee }
    .rt-pills { display:flex; flex-wrap:wrap; gap:5px; align-items:center }
    .rt-pill-icon {
      display:inline-flex; align-items:center; justify-content:center;
      width:28px; height:28px;
      cursor:pointer;
      transition:filter .25s ease, opacity .25s ease, transform .15s ease;
      user-select:none;
    }
    .rt-pill-icon.full { filter:saturate(1) brightness(1); opacity:1 }
    .rt-pill-icon.spent { filter:saturate(0.15) brightness(0.55); opacity:0.55 }
    .rt-pill-icon:hover { transform:scale(1.12) }
    .rt-pill-icon svg { width:24px; height:24px; pointer-events:none }
    /* One-shot scale pulse fired by JS on click. The transform
       animation runs in addition to the .full / .spent crossfade so
       the user gets unambiguous feedback even when the colour change
       is small. */
    .rt-pill-icon.rt-pulse {
      animation:rt-pulse 0.28s cubic-bezier(.34,1.56,.64,1);
    }
    @keyframes rt-pulse {
      0%   { transform:scale(1); }
      40%  { transform:scale(1.45); }
      100% { transform:scale(1); }
    }
    .rt-pill-empty { font-size:11px; color:#9aa0b3; font-style:italic }
    .rt-bar {
      flex:1; min-width:80px;
      height:18px;
      background:rgba(255,255,255,0.06);
      border:1px solid rgba(255,255,255,0.10);
      border-radius:9px; position:relative; overflow:hidden;
      cursor:pointer; user-select:none;
    }
    .rt-bar-fill {
      position:absolute; inset:0 auto 0 0;
      background:linear-gradient(90deg, #16a34a, #4ade80);
      transition:width .18s ease-out;
    }
    .rt-bar-label {
      position:relative; z-index:1;
      font-size:11px; color:#fff; font-weight:600;
      text-align:center; line-height:18px;
      text-shadow:0 1px 2px rgba(0,0,0,0.5);
      font-variant-numeric:tabular-nums;
    }
    .rt-num-text {
      font-size:14px; font-weight:700; color:#e6e8ee;
      font-variant-numeric:tabular-nums;
      padding:2px 8px;
    }
    .rt-num-sep { color:#9aa0b3; font-weight:400; margin:0 2px }
  `;
  const tag = document.createElement("style");
  tag.id = "obr-suite-resource-tracker-styles";
  tag.textContent = css;
  document.head.appendChild(tag);
}
