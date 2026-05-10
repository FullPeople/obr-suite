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
// 2026-05-11 — fire on every value commit so the bottom-center
// toast overlay (resource-toast.html, bg-mounted by index.ts) shows
// a card. LOCAL+REMOTE so all players in the room see the change.
const BC_RESOURCE_CHANGED = `${PLUGIN_ID}/changed`;

// Mirror of the metadata keys the hp-bar / cc-info / bestiary modules
// write. Duplicated here so this file (which mounts inside multiple
// iframes) doesn't import from those modules.
const CC_BIND_KEY = "com.character-cards/boundCardId";
const CC_LIST_KEY = "com.character-cards/list";
const BUBBLES_NAME_KEY = "com.owlbear-rodeo-bubbles-extension/name";

async function resolveTokenDisplayName(itemId: string): Promise<string> {
  let item: any = null;
  try {
    const items = await OBR.scene.items.getItems([itemId]);
    item = items[0] ?? null;
  } catch {}
  if (!item) return "";
  const meta = (item.metadata ?? {}) as Record<string, unknown>;
  // 2026-05-12 — name priority per user spec: 角色卡名 > 怪物图鉴绑定名
  // > 图片 (item) 名. Same priority as the standalone hp-bar popover.
  // 1. CC binding → look up scene's `com.character-cards/list` for
  //    the card's display name.
  const cardId = meta[CC_BIND_KEY];
  if (typeof cardId === "string" && cardId) {
    try {
      const sceneMeta = await OBR.scene.getMetadata();
      const list = sceneMeta[CC_LIST_KEY];
      if (Array.isArray(list)) {
        const card = (list as any[]).find((c) => c && c.id === cardId);
        if (card && typeof card.name === "string" && card.name.trim()) {
          return String(card.name).trim();
        }
      }
    } catch {}
  }
  // 2. Bestiary monster name (BUBBLES_NAME meta is set by bestiary
  //    bind / writeBubbleStats).
  const bubblesName = meta[BUBBLES_NAME_KEY];
  if (typeof bubblesName === "string" && bubblesName.trim()) {
    return String(bubblesName).trim();
  }
  // 3. OBR item name (the image's filename or whatever the user
  //    renamed it to).
  if (typeof item.name === "string" && item.name.trim()) {
    return String(item.name).trim();
  }
  return "";
}

async function broadcastChanged(
  itemId: string,
  resource: Resource,
  delta: number,
  prevValue: number,
): Promise<void> {
  if (delta === 0) return;
  const tokenName = await resolveTokenDisplayName(itemId);
  try {
    const payload = { tokenId: itemId, tokenName, resource, delta, prevValue };
    await Promise.all([
      OBR.broadcast.sendMessage(BC_RESOURCE_CHANGED, payload, { destination: "LOCAL" }),
      OBR.broadcast.sendMessage(BC_RESOURCE_CHANGED, payload, { destination: "REMOTE" }),
    ]);
  } catch {}
}

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
  // 2026-05-12 — "we just touched it" window. Earlier round relied
  // solely on JSON.stringify equality between optimistic snapshot and
  // metadata echo to skip render(); user reported clicks still
  // sometimes triggered a full re-render (innerHTML rewrite, scroll
  // reset, slide animation replay). The snapshot-eq fast-path is
  // probably fine in steady state but races on rapid clicks. This
  // flag is set on every commit and held for ~800 ms — refresh()
  // sees it and updates internal state from the echo without
  // rebuilding the DOM, regardless of whether the JSON snapshots
  // happen to align. External writes (other clients, edit modal
  // save / delete, resource added) come AFTER this window expires
  // and re-render normally.
  let suppressRenderUntil = 0;
  const SUPPRESS_RENDER_MS = 800;

  ensureStyles();

  const itemsUnsub = OBR.scene.items.onChange(() => { void refresh(); });

  // Patch every row in `currentRender` against the live DOM without
  // re-rendering. Used by the suppress-render path so external-shape
  // drift (e.g. metadata roundtrip flips field order in JSON.stringify)
  // doesn't visually leak — we still apply the canonical state to
  // existing pills/bars/text but skip the innerHTML rewrite that
  // would reset scroll position and replay the slide animation.
  function patchAllRowsFromCurrent(): void {
    for (const r of currentRender) {
      // patchRow is a no-op when the row's DOM doesn't exist (e.g.
      // first render before items.onChange fires), so this is safe
      // to call defensively.
      try { patchRow(r, null); } catch {}
    }
  }

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
      // Identical state — fast bail.
      currentRender = next;
      return;
    }
    // 2026-05-12 — strictly avoid innerHTML rewrite when only values
    // changed. Earlier round used a 800 ms "suppress" window; user
    // reported flicker still happening so the suppress fallback was
    // either racing (window expired before echo arrived in some
    // cases) or the JSON snapshots failed to match for reasons
    // unrelated to suppression. Now we make it unconditional: if
    // the .rt-list DOM exists AND the resource ID set is unchanged,
    // we patch values in place and never touch innerHTML. Only adds
    // / deletes (set-of-ids changed) and cold-start (no DOM yet)
    // take the full render path.
    const prevIds = currentRender.map((r) => r.id).sort().join("|");
    const nextIds = next.map((r) => r.id).sort().join("|");
    const structureChanged = prevIds !== nextIds;
    const haveListDom = !!container.querySelector(".rt-list");
    void suppressRenderUntil; // legacy, no longer drives the gate

    if (haveListDom && !structureChanged && next.length > 0) {
      currentRender = next;
      lastSnapshotJson = nextJson;
      patchAllRowsFromCurrent();
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
              title="${escapeAttr(r.name)} · 第 ${i} 格 · 点击赋值 ${i}（已为 ${i} 时减 1）· 右键归满">
          ${ICON_LIBRARY[r.icon as IconId] ?? ICON_LIBRARY.gem}
        </span>
      `);
    }
    if (max === 0) {
      cells.push(`<span class="rt-pill-empty">最大值为 0（点 ⚙ 设置）</span>`);
    }
    return cells.join("");
  }

  // 进度 (bar) — number-prefix label + draggable bar with the
  // selected icon as the moving thumb. The number sits at the front
  // of the bar so the icon can't cover it during slide.
  function renderBarPill(r: Resource): string {
    const max = Math.max(1, r.max);
    const cur = Math.max(0, Math.min(max, r.current));
    const ratio = (cur / max) * 100;
    return `
      <div class="rt-bar-num" data-bar-num>${cur} / ${max}</div>
      <div class="rt-bar"
           data-action="bar-drag"
           data-rid="${escapeAttr(r.id)}"
           title="${escapeAttr(r.name)} · 左键拖动设置进度，右键 +1 / 归满">
        <div class="rt-bar-fill" data-bar-fill style="width:${ratio.toFixed(1)}%"></div>
        <span class="rt-bar-thumb"
              data-bar-thumb
              style="left:${ratio.toFixed(2)}%">
          ${ICON_LIBRARY[r.icon as IconId] ?? ICON_LIBRARY.gem}
        </span>
      </div>
    `;
  }

  // 数字 (number) — bar layout: [MIN] [−] [○ icon + number] [+] [MAX].
  // Center has a circle wrapping a large icon with the number
  // overlayed (stroke for legibility). Left/right ends show min/max
  // values as static labels.
  function renderNumberPill(r: Resource): string {
    const min = 0;                   // current schema doesn't have a free min; pin at 0
    const max = Math.max(0, r.max);
    const cur = r.current;
    return `
      <div class="rt-num-bar">
        <span class="rt-num-end" data-num-end="min" title="跳到最小（${min}）">${min}</span>
        <button class="rt-num-step rt-num-minus"
                data-action="num-step"
                data-rid="${escapeAttr(r.id)}"
                data-dir="-1"
                type="button"
                title="${escapeAttr(r.name)} −1">−</button>
        <span class="rt-num-orb"
              data-action="num-orb"
              data-rid="${escapeAttr(r.id)}"
              title="${escapeAttr(r.name)} ${cur}/${max} · 点击重置归满 / 归零再点也归满">
          <span class="rt-num-orb-icon">${ICON_LIBRARY[r.icon as IconId] ?? ICON_LIBRARY.gem}</span>
          <span class="rt-num-orb-val" data-num-val>${cur}</span>
        </span>
        <button class="rt-num-step rt-num-plus"
                data-action="num-step"
                data-rid="${escapeAttr(r.id)}"
                data-dir="+1"
                type="button"
                title="${escapeAttr(r.name)} +1">+</button>
        <span class="rt-num-end" data-num-end="max" title="跳到最大（${max}）">${max}</span>
      </div>
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
      const num = row.querySelector<HTMLElement>("[data-bar-num]");
      const thumb = row.querySelector<HTMLElement>("[data-bar-thumb]");
      if (fill) fill.style.width = `${ratio.toFixed(1)}%`;
      if (num) num.textContent = `${cur} / ${max}`;
      if (thumb) thumb.style.left = `${ratio.toFixed(2)}%`;
    } else if (r.type === "number") {
      const val = row.querySelector<HTMLElement>("[data-num-val]");
      if (val) val.textContent = String(r.current);
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
    // Bar = drag-anywhere on the bar to set progress. Pointer events
    // give us pointerdown / pointermove / pointerup with capture so a
    // drag that exits the bar still tracks. Right-click = +1 / fill.
    container.querySelectorAll<HTMLElement>('[data-action="bar-drag"]').forEach((el) => {
      el.addEventListener("pointerdown", (e) => onBarPointerDown(id, el, e as PointerEvent));
      el.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        void onBarRightClick(id, el);
      });
    });
    // Number ±/orb buttons.
    container.querySelectorAll<HTMLElement>('[data-action="num-step"]').forEach((el) => {
      el.addEventListener("click", () => {
        const dir = el.dataset.dir === "+1" ? 1 : -1;
        void onNumberStep(id, el, dir as 1 | -1);
      });
    });
    container.querySelectorAll<HTMLElement>('[data-action="num-orb"]').forEach((el) => {
      // Click → if 0, refill to max; else decrement by 1.
      el.addEventListener("click", () => void onNumberOrbClick(id, el));
      el.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        void onNumberOrbReset(id, el);
      });
    });
    // Click min/max labels jumps the current to that bound.
    container.querySelectorAll<HTMLElement>('[data-num-end]').forEach((el) => {
      el.addEventListener("click", () => void onNumberEndJump(id, el));
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

  /** Position-aware count click. New spec (2026-05-11):
   *    • If position N === current → consume to N-1
   *    • Otherwise               → set to N
   *  e.g. 6/6 click 5 → 5/6 (set), 5/6 click 5 → 4/6 (consume).
   *  Replaces the previous `pos > current ? pos : pos-1` formula
   *  which mis-bumped to N-2 in the user's "click 5 at 6/6" case.
   */
  async function onCountClick(itemId: string, el: HTMLElement): Promise<void> {
    const rid = el.dataset.rid!;
    const pos = parseInt(el.dataset.pos ?? "0", 10);
    const r = currentRender.find((x) => x.id === rid);
    if (!r) return;
    const next = pos === r.current ? pos - 1 : pos;
    if (next === r.current) return;
    await applyChange(itemId, r, next, next - r.current, el);
  }
  async function onCountReset(itemId: string, el: HTMLElement): Promise<void> {
    const rid = el.dataset.rid!;
    const r = currentRender.find((x) => x.id === rid);
    if (!r || r.current >= r.max) return;
    await applyChange(itemId, r, r.max, r.max - r.current, el);
  }

  // Bar drag — pointer-capture-driven. Clicking at any X on the bar
  // sets current to round(ratio × max); subsequent moves track the
  // pointer. We optimistically patch on every move (no scene-write
  // burst) and only persist on pointerup (single updateResource).
  function onBarPointerDown(itemId: string, el: HTMLElement, ev: PointerEvent): void {
    if (ev.button !== 0) return;
    const rid = el.dataset.rid!;
    const r = currentRender.find((x) => x.id === rid);
    if (!r) return;
    ev.preventDefault();
    el.setPointerCapture(ev.pointerId);
    const startCurrent = r.current;
    const max = Math.max(1, r.max);
    const computeAt = (clientX: number): number => {
      const rect = el.getBoundingClientRect();
      const t = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      return Math.round(t * max);
    };
    let lastApplied = startCurrent;
    const initial = computeAt(ev.clientX);
    if (initial !== startCurrent) {
      // Optimistic patch only — no scene write yet (would burst on every move).
      const idx = currentRender.findIndex((x) => x.id === r.id);
      if (idx >= 0) {
        const nextRow = { ...r, current: initial };
        currentRender = currentRender.map((x, i) => (i === idx ? nextRow : x));
        patchRow(nextRow, null);
        lastApplied = initial;
      }
    }
    const onMove = (e: PointerEvent) => {
      const v = computeAt(e.clientX);
      if (v === lastApplied) return;
      const idx = currentRender.findIndex((x) => x.id === r.id);
      if (idx < 0) return;
      const nextRow = { ...r, current: v };
      currentRender = currentRender.map((x, i) => (i === idx ? nextRow : x));
      patchRow(nextRow, null);
      lastApplied = v;
    };
    const onUp = (_e: PointerEvent) => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      try { el.releasePointerCapture(ev.pointerId); } catch {}
      // Persist final value if it differs from the start.
      if (lastApplied !== startCurrent) {
        const final = currentRender.find((x) => x.id === r.id);
        if (final) {
          lastSnapshotJson = JSON.stringify(currentRender);
          // Open suppress-render window for the metadata echo.
          suppressRenderUntil = Date.now() + SUPPRESS_RENDER_MS;
          firePulse(el);
          onChange?.({ resourceName: r.name || "(未命名)", delta: lastApplied - startCurrent, current: lastApplied, max: r.max });
          void broadcastChanged(itemId, final, lastApplied - startCurrent, startCurrent);
          void updateResource(itemId, r.id, () => final);
        }
      }
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
  }
  async function onBarRightClick(itemId: string, el: HTMLElement): Promise<void> {
    const rid = el.dataset.rid!;
    const r = currentRender.find((x) => x.id === rid);
    if (!r) return;
    // Right-click: +1 (or fill if already at 0). Saves a manual
    // drag-to-max for the common "I rested, top up" case.
    const next = r.current >= r.max ? r.max : r.current + 1;
    if (next === r.current) return;
    await applyChange(itemId, r, next, next - r.current, el);
  }

  // Number mode: − / + buttons on either side of the orb. The orb
  // itself click-cycles 0 → max → 0. Min/max ends jump to bounds.
  async function onNumberStep(itemId: string, el: HTMLElement, dir: 1 | -1): Promise<void> {
    const rid = el.dataset.rid!;
    const r = currentRender.find((x) => x.id === rid);
    if (!r) return;
    const next = dir > 0 ? Math.min(r.max, r.current + 1) : Math.max(0, r.current - 1);
    if (next === r.current) return;
    await applyChange(itemId, r, next, next - r.current, el);
  }
  async function onNumberOrbClick(itemId: string, el: HTMLElement): Promise<void> {
    const rid = el.dataset.rid!;
    const r = currentRender.find((x) => x.id === rid);
    if (!r) return;
    // 0 → max (refill); otherwise → 0 (consume to zero).
    const next = r.current <= 0 ? r.max : 0;
    if (next === r.current) return;
    await applyChange(itemId, r, next, next - r.current, el);
  }
  async function onNumberOrbReset(itemId: string, el: HTMLElement): Promise<void> {
    const rid = el.dataset.rid!;
    const r = currentRender.find((x) => x.id === rid);
    if (!r) return;
    if (r.current >= r.max) return;
    await applyChange(itemId, r, r.max, r.max - r.current, el);
  }
  async function onNumberEndJump(itemId: string, el: HTMLElement): Promise<void> {
    const end = el.dataset.numEnd;
    const row = el.closest<HTMLElement>(".rt-row");
    const rid = row?.dataset.id ?? "";
    const r = currentRender.find((x) => x.id === rid);
    if (!r) return;
    const next = end === "max" ? r.max : 0;
    if (next === r.current) return;
    await applyChange(itemId, r, next, next - r.current, el);
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
    // Open the suppress-render window so the metadata echo doesn't
    // trigger a full innerHTML rewrite (kills scroll position +
    // replays the parent's slide animation).
    suppressRenderUntil = Date.now() + SUPPRESS_RENDER_MS;
    // 2. Patch DOM in place + run pulse animation. No re-render.
    patchRow(nextRow, pulseEl);
    // 3. Notifier hook + room-wide toast broadcast.
    onChange?.({ resourceName: r.name || "(未命名)", delta, current: next, max: r.max });
    void broadcastChanged(itemId, nextRow, delta, r.current);
    // 4. Persist. items.onChange echoes back; refresh() runs but
    //    skips render() because we're in the suppress window.
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

    /* ===== 进度 (bar) — number-prefix label + draggable thumb ====== */
    .rt-bar-num {
      flex:0 0 auto;
      font-size:11px; font-weight:700; color:#e6e8ee;
      font-variant-numeric:tabular-nums;
      letter-spacing:0.3px;
      padding:0 4px;
      min-width:42px;
      text-align:center;
    }
    .rt-bar {
      flex:1; min-width:80px;
      height:22px;
      background:rgba(255,255,255,0.06);
      border:1px solid rgba(255,255,255,0.10);
      border-radius:11px; position:relative;
      cursor:grab; user-select:none;
      touch-action:none;
    }
    .rt-bar:active{cursor:grabbing}
    .rt-bar-fill {
      position:absolute; inset:0 auto 0 0;
      border-radius:11px 0 0 11px;
      background:linear-gradient(90deg, #16a34a, #4ade80);
      pointer-events:none;
    }
    .rt-bar-thumb {
      position:absolute; top:50%;
      width:26px; height:26px;
      transform:translate(-50%, -50%);
      display:inline-flex; align-items:center; justify-content:center;
      background:#1f2230;
      border:2px solid #4ade80;
      border-radius:50%;
      box-shadow:0 2px 6px rgba(0,0,0,0.4);
      color:#e6e8ee;
      pointer-events:none;
      z-index:1;
    }
    .rt-bar-thumb svg { width:18px; height:18px }
    /* Click-scale pulse for the bar — fires when a drag commits.
       Same animation as count-mode .rt-pulse but applied to .rt-bar. */
    .rt-bar.rt-pulse { animation: rt-bar-pulse 0.18s ease-out }
    @keyframes rt-bar-pulse {
      0% { transform: scale(1); }
      45% { transform: scale(1.03); }
      100% { transform: scale(1); }
    }

    /* ===== 数字 (number) — bar layout: MIN [−] orb [+] MAX ====== */
    .rt-num-bar {
      flex:1;
      display:grid;
      grid-template-columns:auto auto 1fr auto auto;
      gap:6px;
      align-items:center;
      padding:0 4px;
    }
    .rt-num-end {
      font-size:10.5px; font-weight:700; color:#9aa0b3;
      font-variant-numeric:tabular-nums;
      cursor:pointer;
      padding:2px 4px; border-radius:4px;
      transition:background .12s, color .12s;
    }
    .rt-num-end:hover { background:rgba(255,255,255,0.08); color:#e6e8ee }
    .rt-num-step {
      width:24px; height:24px;
      background:rgba(255,255,255,0.06);
      border:1px solid rgba(255,255,255,0.12);
      border-radius:6px;
      color:#e6e8ee;
      font-size:14px; font-weight:800; line-height:1;
      font-family:inherit;
      cursor:pointer;
      display:flex; align-items:center; justify-content:center;
      transition:background .12s, border-color .12s, transform .12s;
    }
    .rt-num-step:hover { background:rgba(93,173,226,0.15); border-color:rgba(93,173,226,0.45); color:#7ec8f0 }
    .rt-num-step:active { transform:scale(0.94) }
    .rt-num-step.rt-pulse { animation: rt-pulse 0.22s ease-out }
    /* 2026-05-12 — orb redesign per user feedback. The previous round
       wrapped the icon in a 48px circle; user wanted the icon plain.
       Now the orb is just a transparent square sized to the icon, with
       the number overlayed using a layered text-shadow stroke that
       reads cleanly on any icon (the previous -webkit-text-stroke
       approach displayed poorly because it stroked the FILL not the
       outside, blurring the digit edges). */
    .rt-num-orb {
      justify-self:center;
      position:relative;
      width:44px; height:44px;
      display:inline-flex; align-items:center; justify-content:center;
      cursor:pointer;
      transition:transform .12s ease, filter .15s;
    }
    .rt-num-orb:hover { filter:brightness(1.18) }
    .rt-num-orb:active { transform:scale(0.94) }
    .rt-num-orb-icon {
      position:absolute; inset:0;
      display:flex; align-items:center; justify-content:center;
      color:#cbd5e1;
    }
    .rt-num-orb-icon svg { width:38px; height:38px; filter:drop-shadow(0 1px 2px rgba(0,0,0,0.65)) }
    /* Number overlay — pure layered-shadow stroke. Eight 1-px solid
       black offsets form a clean outline around the white digit; a
       4-px soft halo behind that lifts it off coloured icons.
       (-webkit-text-stroke was tried earlier; it strokes from the
       inside out and clips the strokes against the glyph fill,
       producing a thin/uneven look. Layered text-shadow stays
       outside the fill and reads sharp.) */
    .rt-num-orb-val {
      position:absolute; inset:0;
      display:flex; align-items:center; justify-content:center;
      font-family:ui-monospace,Consolas,monospace;
      font-size:18px; font-weight:900;
      color:#fff;
      text-shadow:
        -1px -1px 0 #000, 1px -1px 0 #000,
        -1px  1px 0 #000, 1px  1px 0 #000,
        -1px  0   0 #000, 1px  0   0 #000,
         0  -1px 0 #000, 0   1px 0 #000,
         0 0 4px rgba(0,0,0,0.95);
      font-variant-numeric:tabular-nums;
      pointer-events:none;
    }
    .rt-num-orb.rt-pulse { animation: rt-pulse 0.28s cubic-bezier(.34,1.56,.64,1) }
  `;
  const tag = document.createElement("style");
  tag.id = "obr-suite-resource-tracker-styles";
  tag.textContent = css;
  document.head.appendChild(tag);
}
