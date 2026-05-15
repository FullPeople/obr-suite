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
import { readResources, updateResource, writeResources } from "./storage";

// 2026-05-14 — small expression parser for click-to-input on bar /
// number rows. Accepts:
//   • Plain numbers: "10", "3.5", "-2"
//   • Relative deltas: "+5" → current+5, "-3" → current-3
//   • Special tokens: "current" | "cur" | "max" substituted at parse
//     time. So "max-2", "current/2", "max*0.5+1" all work.
//   • Pure arithmetic: +, -, *, /, parens. No exponents / functions.
//
// Returns null on parse failure (caller falls back to "no change").
function parseValueExpression(
  text: string,
  current: number,
  max: number,
): number | null {
  const trimmed = (text || "").trim();
  if (!trimmed) return null;
  // Relative shortcut — "+5" or "-3" means current ± delta. We special-
  // case this BEFORE substitution so "+5" doesn't get treated as an
  // arithmetic expression with no LHS.
  if (/^[+\-]\s*[\d.]+$/.test(trimmed)) {
    const delta = Number(trimmed);
    if (Number.isFinite(delta)) return current + delta;
  }
  // Substitute keywords. Order matters: replace "current" before "cur"
  // so we don't end up with "currentent".
  const substituted = trimmed
    .replace(/current/gi, `(${current})`)
    .replace(/cur/gi, `(${current})`)
    .replace(/max/gi, `(${max})`);
  // Whitelist chars to keep the Function() eval safe — only arithmetic
  // primitives. Anything else aborts.
  if (!/^[\d.\s+\-*/()]+$/.test(substituted)) return null;
  try {
    // eslint-disable-next-line no-new-func
    const v = new Function(`return (${substituted})`)();
    if (typeof v === "number" && Number.isFinite(v)) return v;
  } catch {}
  return null;
}

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

export async function resolveTokenDisplayName(itemId: string): Promise<string> {
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
  // 2026-05-14 — JS-side mirror of the active drag's source id. Some
  // browsers don't deliver dataTransfer payload to drop events inside
  // OBR popover iframes (cross-frame DataTransferItemList sanitisation),
  // so we maintain our own copy that survives the whole drag.
  let currentDraggedId: string | null = null;

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
      currentRender = next;
      return;
    }
    void suppressRenderUntil; // legacy field, no longer drives the gate.

    // 2026-05-12 — ALL refresh paths now update the DOM incrementally
    // when possible. Earlier rounds went through a full innerHTML
    // rewrite for adds/deletes which the user reported as visible
    // flicker. New flow:
    //   1. List DOM doesn't exist OR transitioning to/from empty
    //      → full render() (cold start path).
    //   2. Otherwise diff by id:
    //      • Remove rows whose id is gone.
    //      • Append rows whose id is new (bind events on the
    //        appended row only).
    //      • Patch all surviving rows in place.
    //   No global innerHTML rewrite ever happens once a list is on
    //   screen, regardless of whether the change was a value tweak,
    //   an add, or a delete.

    const list = container.querySelector<HTMLElement>(".rt-list");
    const wasEmpty = currentRender.length === 0;
    const isEmpty = next.length === 0;

    if (!list || (wasEmpty && !isEmpty) || (!wasEmpty && isEmpty)) {
      // No live list yet, or transitioning between empty / non-empty
      // → full render. (Cold start, last resource removed, first
      // resource added on a previously-empty token.)
      currentRender = next;
      lastSnapshotJson = nextJson;
      render();
      return;
    }

    // === Incremental diff path ===========================================

    const prevById = new Map(currentRender.map((r) => [r.id, r]));
    const nextById = new Map(next.map((r) => [r.id, r]));

    // 1. Remove rows whose id disappeared from `next`.
    for (const id of prevById.keys()) {
      if (!nextById.has(id)) {
        const row = list.querySelector<HTMLElement>(`.rt-row[data-id="${cssEscape(id)}"]`);
        row?.remove();
      }
    }

    // 2. Append rows whose id is new. Insert in the order they
    //    appear in `next` (already sorted by `order`) — we walk
    //    next, and for each new row append it in sequence.
    const sorted = [...next].sort((a, b) => {
      const oa = a.order ?? Number.MAX_SAFE_INTEGER;
      const ob = b.order ?? Number.MAX_SAFE_INTEGER;
      return oa - ob;
    });
    // 2026-05-12 — user bug #17: when the user changes a resource's
    // TYPE via the edit modal (count → bar → number), the row id
    // stays the same but the DOM markup for the old type doesn't
    // match the new type's expected nodes — patchRow's `if r.type
    // === "count"` branch updates pills that no longer represent
    // the canonical state because the row is now supposed to be a
    // bar. Detect type change here and FULL-replace the row's HTML
    // instead of trying to patch.
    for (const r of sorted) {
      let row = list.querySelector<HTMLElement>(`.rt-row[data-id="${cssEscape(r.id)}"]`);
      if (!row) {
        const tmp = document.createElement("div");
        tmp.innerHTML = renderResourceRow(r);
        row = tmp.firstElementChild as HTMLElement;
        list.appendChild(row);
        bindRowEvents(row);
        continue;
      }
      // Detect type change vs the row's CURRENT DOM (which still
      // reflects the previous render).
      const prev = prevById.get(r.id);
      if (prev && prev.type !== r.type) {
        const tmp = document.createElement("div");
        tmp.innerHTML = renderResourceRow(r);
        const fresh = tmp.firstElementChild as HTMLElement;
        row.replaceWith(fresh);
        bindRowEvents(fresh);
      }
    }

    // 3. Update internal state + patch every surviving row.
    currentRender = next;
    lastSnapshotJson = nextJson;
    patchAllRowsFromCurrent();
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
    // 2026-05-14 — drag-reorder. Only the `.rt-row-grip` element is
    // `draggable="true"`; the row itself is NOT. Earlier round had
    // `draggable="true"` on the row + a guard that cancelled dragstart
    // when the mousedown target wasn't the grip — user reported the
    // guard didn't work and drag still initiated from the row body
    // without producing any reorder. Restricting `draggable` to the
    // grip span is the simpler, robust fix: the browser literally
    // won't start a drag from anywhere else.
    //
    // Cross-target wiring: the grip carries the drag-source role
    // (records the row's id on dragstart), while the ROW carries the
    // drop-target role (dragover / drop fire on the row so the user
    // can drop ANYWHERE on the target row, not just its tiny grip).
    return `
      <div class="rt-row" data-id="${escapeAttr(r.id)}">
        <div class="rt-row-head">
          <span class="rt-row-grip"
                data-action="row-grip"
                data-rid="${escapeAttr(r.id)}"
                draggable="true"
                title="拖动以重新排序">≡</span>
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
  //
  // 2026-05-14 — the number text (rt-bar-num) is now click-to-edit:
  // clicking opens an inline input that accepts numbers, deltas
  // (+5 / -3), or expressions (current+5, max/2, etc). See
  // openValueEditor() for the parse rules.
  function renderBarPill(r: Resource): string {
    const max = Math.max(1, r.max);
    const cur = Math.max(0, Math.min(max, r.current));
    const ratio = (cur / max) * 100;
    return `
      <div class="rt-bar-num"
           data-bar-num
           data-action="value-edit"
           data-rid="${escapeAttr(r.id)}"
           title="点击编辑：可输入数字 / +5 -3 / current+5 / max-2 等表达式">${cur} / ${max}</div>
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
  // values as proper buttons (user request 2026-05-14).
  //
  // 2026-05-14 — the centre orb number (rt-num-orb-val) is now click-
  // to-edit; the orb's own click is rebound to the orb's icon. min/max
  // ends are full buttons (styling lift; their click behaviour is
  // unchanged — jump to 0 / jump to max).
  function renderNumberPill(r: Resource): string {
    const min = 0;                   // current schema doesn't have a free min; pin at 0
    const max = Math.max(0, r.max);
    const cur = r.current;
    return `
      <div class="rt-num-bar">
        <button class="rt-num-end" data-num-end="min" type="button" title="跳到最小（${min}）">${min}</button>
        <button class="rt-num-step rt-num-minus"
                data-action="num-step"
                data-rid="${escapeAttr(r.id)}"
                data-dir="-1"
                type="button"
                title="${escapeAttr(r.name)} −1">−</button>
        <span class="rt-num-orb"
              data-rid="${escapeAttr(r.id)}"
              title="${escapeAttr(r.name)} ${cur}/${max}">
          <span class="rt-num-orb-icon">${ICON_LIBRARY[r.icon as IconId] ?? ICON_LIBRARY.gem}</span>
          <span class="rt-num-orb-val"
                data-num-val
                data-action="value-edit"
                data-rid="${escapeAttr(r.id)}"
                title="点击编辑：可输入数字 / +5 -3 / current+5 / max-2 等表达式">${cur}</span>
        </span>
        <button class="rt-num-step rt-num-plus"
                data-action="num-step"
                data-rid="${escapeAttr(r.id)}"
                data-dir="+1"
                type="button"
                title="${escapeAttr(r.name)} +1">+</button>
        <button class="rt-num-end" data-num-end="max" type="button" title="跳到最大（${max}）">${max}</button>
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

  // 2026-05-12 — bindRowEvents factored to bind on a SCOPE element
  // (default: container). Lets the partial-DOM-update path bind
  // handlers on a freshly-appended single row without touching the
  // already-bound rows. The "+ 新增资源" button binding stays
  // attached to the container's last child (only one of those).
  function bindRowEvents(scope?: HTMLElement): void {
    const id = getItemId();
    if (!id) return;
    const root = scope ?? container;
    root.querySelectorAll<HTMLElement>('[data-action="count-toggle"]').forEach((el) => {
      el.addEventListener("click", () => void onCountClick(id, el));
      el.addEventListener("contextmenu", (e) => { e.preventDefault(); void onCountReset(id, el); });
    });
    root.querySelectorAll<HTMLElement>('[data-action="bar-drag"]').forEach((el) => {
      el.addEventListener("pointerdown", (e) => onBarPointerDown(id, el, e as PointerEvent));
      el.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        void onBarRightClick(id, el);
      });
    });
    root.querySelectorAll<HTMLElement>('[data-action="num-step"]').forEach((el) => {
      el.addEventListener("click", () => {
        const dir = el.dataset.dir === "+1" ? 1 : -1;
        void onNumberStep(id, el, dir as 1 | -1);
      });
    });
    root.querySelectorAll<HTMLElement>('[data-action="num-orb"]').forEach((el) => {
      el.addEventListener("click", () => void onNumberOrbClick(id, el));
      el.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        void onNumberOrbReset(id, el);
      });
    });
    root.querySelectorAll<HTMLElement>('[data-num-end]').forEach((el) => {
      el.addEventListener("click", () => void onNumberEndJump(id, el));
    });
    // 2026-05-14 — click-to-input on bar number + number orb value.
    // Both use data-action="value-edit" with the resource id on data-rid.
    root.querySelectorAll<HTMLElement>('[data-action="value-edit"]').forEach((el) => {
      el.addEventListener("click", (e) => {
        e.stopPropagation(); // don't bubble into parent orb / bar handlers
        void openValueEditor(id, el);
      });
    });
    root.querySelectorAll<HTMLButtonElement>(".rt-row-edit").forEach((b) => {
      b.addEventListener("click", () => {
        const rid = b.dataset.editId ?? "";
        const r = currentRender.find((x) => x.id === rid);
        if (r) openEdit(r);
      });
    });
    // 2026-05-14 — HTML5 drag-reorder, source-grip + target-row split.
    //
    // Drag SOURCE: each `.rt-row-grip` is `draggable="true"`. On
    // dragstart it stashes its parent row's id into dataTransfer +
    // adds .rt-dragging to the row for visual feedback. Restricting
    // `draggable` to just the grip is the robust way to prevent
    // accidental row-body drags — the earlier mousedown-guard
    // approach wasn't reliable.
    //
    // Drag TARGET: each `.rt-row` accepts dragover / drop. The drop
    // zone is the whole row (not just its grip) so the user has a
    // wide hit area. dragover decides above-vs-below based on the
    // cursor's Y relative to the row's vertical midpoint.
    //
    // We rely on a module-scoped fallback (currentDraggedId) too —
    // some browsers don't deliver dataTransfer payload to drop events
    // inside iframes, so we keep a JS-side copy as backup.
    root.querySelectorAll<HTMLElement>('[data-action="row-grip"]').forEach((grip) => {
      grip.addEventListener("dragstart", (ev) => {
        const e = ev as DragEvent;
        const rid = grip.dataset.rid || "";
        const row = grip.closest<HTMLElement>(".rt-row");
        if (!rid || !row) {
          e.preventDefault();
          return;
        }
        currentDraggedId = rid;
        try {
          e.dataTransfer?.setData("text/plain", rid);
          // Some browsers refuse to start a drag without setData on a
          // supported type; text/plain is universally accepted.
        } catch {}
        if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
        row.classList.add("rt-dragging");
      });
      grip.addEventListener("dragend", () => {
        const row = grip.closest<HTMLElement>(".rt-row");
        row?.classList.remove("rt-dragging");
        container.querySelectorAll(".rt-row").forEach((r) => {
          r.classList.remove("rt-drop-above", "rt-drop-below");
        });
        currentDraggedId = null;
      });
    });
    root.querySelectorAll<HTMLElement>(".rt-row").forEach((row) => {
      row.addEventListener("dragover", (ev) => {
        // Only react if we're tracking an in-flight drag.
        if (!currentDraggedId) return;
        const e = ev as DragEvent;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
        // Hovering over the row that's BEING dragged → no slot.
        if ((row as HTMLElement).dataset.id === currentDraggedId) {
          row.classList.remove("rt-drop-above", "rt-drop-below");
          return;
        }
        const rect = (row as HTMLElement).getBoundingClientRect();
        const isAbove = (e.clientY - rect.top) < rect.height / 2;
        row.classList.toggle("rt-drop-above", isAbove);
        row.classList.toggle("rt-drop-below", !isAbove);
      });
      row.addEventListener("dragleave", () => {
        row.classList.remove("rt-drop-above", "rt-drop-below");
      });
      row.addEventListener("drop", (ev) => {
        const e = ev as DragEvent;
        e.preventDefault();
        // dataTransfer.getData inside iframe drops returns empty on
        // some browsers — fall back to the JS-side mirror.
        const draggedId = (e.dataTransfer?.getData("text/plain") || currentDraggedId || "").trim();
        const targetId = (row as HTMLElement).dataset.id || "";
        const isAbove = row.classList.contains("rt-drop-above");
        row.classList.remove("rt-drop-above", "rt-drop-below");
        currentDraggedId = null;
        if (!draggedId || !targetId || draggedId === targetId) return;
        void commitReorder(id, draggedId, targetId, isAbove ? "before" : "after");
      });
    });
    // The "+ 新增资源" button only ever has one instance — bind on
    // the unscoped container so re-binds during partial updates
    // don't multiply listeners.
    if (!scope) {
      container.querySelector<HTMLButtonElement>(".rt-add")?.addEventListener("click", () => openCreate());
    }
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

  // 2026-05-14 — inline value editor for bar number + number orb.
  // Replaces the target element with an <input> bound to a fresh
  // expression. Enter commits, Esc cancels, blur commits. The input
  // is sized to the element it replaced so layout doesn't jump.
  async function openValueEditor(itemId: string, el: HTMLElement): Promise<void> {
    const rid = el.dataset.rid;
    if (!rid) return;
    const r = currentRender.find((x) => x.id === rid);
    if (!r) return;
    // Avoid double-entry — if the user double-clicks fast we'd
    // otherwise stack inputs.
    if (el.querySelector("input")) return;
    const originalHtml = el.innerHTML;
    const originalContent = el.textContent || "";
    // Build the input. Style inline to avoid a CSS round-trip.
    const input = document.createElement("input");
    input.type = "text";
    input.className = "rt-value-input";
    input.value = String(r.current);
    input.placeholder = "+5 / -3 / max/2 / 10";
    input.spellcheck = false;
    input.autocomplete = "off";
    // Replace element content with the input.
    el.textContent = "";
    el.appendChild(input);
    input.focus();
    input.select();

    let committed = false;
    const restore = () => {
      // Restore via textContent (atomic — clears any child input first).
      // patchRow() later overwrites this when applyChange lands, so we
      // only need to put SOMETHING legible here in case the user cancels.
      el.textContent = originalContent;
    };
    const commit = async () => {
      if (committed) return;
      committed = true;
      const text = input.value;
      const parsed = parseValueExpression(text, r.current, r.max);
      restore();
      if (parsed == null) return; // bad expression — no change
      // Round to 2 decimals, clamp to [0, max]. Bar mode enforces
      // strict integers visually but we accept fractional for users
      // who do something like "max/3"; resource icons coerce to int
      // when rendering count anyway.
      const clamped = Math.max(0, Math.min(r.max, Math.round(parsed * 100) / 100));
      if (clamped === r.current) return;
      const delta = clamped - r.current;
      await applyChange(itemId, r, clamped, delta, null);
    };
    const cancel = () => {
      if (committed) return;
      committed = true;
      restore();
    };
    // originalHtml unused after the rewrite — kept as a hook for any
    // future "restore exact markup" variant; suppress unused-var via
    // void.
    void originalHtml;
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); void commit(); }
      else if (e.key === "Escape") { e.preventDefault(); cancel(); }
    });
    input.addEventListener("blur", () => { void commit(); });
  }

  // 2026-05-14 — drag-reorder commit. Computes a new ordering, re-
  // stamps every resource's `order` field to match the new index, and
  // writes the entire array in one scene update so all clients see a
  // single atomic transition.
  async function commitReorder(
    itemId: string,
    draggedId: string,
    targetId: string,
    position: "before" | "after",
  ): Promise<void> {
    const sorted = [...currentRender].sort((a, b) => {
      const oa = a.order ?? Number.MAX_SAFE_INTEGER;
      const ob = b.order ?? Number.MAX_SAFE_INTEGER;
      return oa - ob;
    });
    const draggedIdx = sorted.findIndex((r) => r.id === draggedId);
    if (draggedIdx < 0) return;
    const [dragged] = sorted.splice(draggedIdx, 1);
    let targetIdx = sorted.findIndex((r) => r.id === targetId);
    if (targetIdx < 0) {
      // Target gone after our splice — append at end as fallback.
      sorted.push(dragged);
    } else {
      if (position === "after") targetIdx += 1;
      sorted.splice(targetIdx, 0, dragged);
    }
    // Re-stamp order to match new index, gap-free.
    const next: Resource[] = sorted.map((r, i) => ({ ...r, order: i }));
    // Optimistic local update so the user doesn't see a flash before
    // the scene-sync echo. Open the suppress window so the echo
    // doesn't trigger a re-render.
    currentRender = next;
    lastSnapshotJson = JSON.stringify(next);
    suppressRenderUntil = Date.now() + SUPPRESS_RENDER_MS;
    // Apply DOM ordering to match next.
    const list = container.querySelector<HTMLElement>(".rt-list");
    if (list) {
      for (const r of next) {
        const row = list.querySelector<HTMLElement>(`.rt-row[data-id="${cssEscape(r.id)}"]`);
        if (row) list.appendChild(row);
      }
    }
    // Persist.
    try {
      await writeResources(itemId, next);
    } catch (e) {
      console.error("[obr-suite/resources] commitReorder failed", e);
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
      transition:background .12s, border-color .12s, transform .12s, opacity .12s;
    }
    /* 2026-05-14 — drag-reorder visual feedback. */
    .rt-row.rt-dragging {
      opacity:0.35;
      background:rgba(93,173,226,0.08);
      border-color:rgba(93,173,226,0.45);
    }
    .rt-row.rt-drop-above {
      box-shadow:0 -3px 0 0 #5dade2 inset;
    }
    .rt-row.rt-drop-below {
      box-shadow:0 3px 0 0 #5dade2 inset;
    }
    .rt-row-grip {
      cursor:grab;
      color:#9aa0b3;
      font-size:14px;
      line-height:1;
      padding:2px 4px;
      border-radius:4px;
      user-select:none;
      transition:background .12s, color .12s;
    }
    .rt-row-grip:hover { background:rgba(255,255,255,0.08); color:#e6e8ee }
    .rt-row-grip:active { cursor:grabbing }
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
      padding:2px 6px;
      min-width:54px;
      text-align:center;
      cursor:pointer;
      border-radius:4px;
      transition:background .12s, color .12s;
    }
    /* 2026-05-14 — click-to-edit hover state for bar number. */
    .rt-bar-num:hover { background:rgba(93,173,226,0.15); color:#a3d1ec }
    /* Inline expression input — replaces the static number when
       clicked. Sized to roughly the same width so the bar doesn't
       jump in layout. */
    .rt-value-input {
      width:100%;
      min-width:64px;
      box-sizing:border-box;
      background:#1a1c24;
      color:#e6e8ee;
      border:1px solid #5dade2;
      border-radius:4px;
      padding:2px 4px;
      font-family:inherit;
      font-size:11px;
      font-weight:700;
      text-align:center;
      outline:none;
    }
    .rt-value-input:focus { border-color:#7ec8f0; box-shadow:0 0 0 1px rgba(126,200,240,0.4) }
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
    /* 2026-05-14 — promoted from <span> to <button>; styled to look
       like a peer to the rt-num-step ± buttons. Jumps current to 0
       (min) or max on click. */
    .rt-num-end {
      min-width:28px; height:24px;
      background:rgba(255,255,255,0.04);
      border:1px solid rgba(255,255,255,0.10);
      border-radius:6px;
      color:#cbd5e1;
      font-size:11px; font-weight:700;
      font-family:inherit;
      font-variant-numeric:tabular-nums;
      cursor:pointer;
      padding:0 6px;
      display:inline-flex; align-items:center; justify-content:center;
      transition:background .12s, border-color .12s, color .12s, transform .12s;
    }
    .rt-num-end:hover {
      background:rgba(93,173,226,0.15);
      border-color:rgba(93,173,226,0.45);
      color:#7ec8f0;
    }
    .rt-num-end:active { transform:scale(0.94) }
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
      /* 2026-05-14 — was pointer-events:none. Removed so click on the
         orb (which the user perceives as clicking the icon, since val
         sits on top of the icon at inset:0) actually triggers the
         value-edit handler. Previously the click bypassed val into
         the orb wrapper which has no JS handler, only the CSS :active
         scale animation — producing the "anim but no input" bug. */
      cursor:text;
    }
    .rt-num-orb.rt-pulse { animation: rt-pulse 0.28s cubic-bezier(.34,1.56,.64,1) }
  `;
  const tag = document.createElement("style");
  tag.id = "obr-suite-resource-tracker-styles";
  tag.textContent = css;
  document.head.appendChild(tag);
}
