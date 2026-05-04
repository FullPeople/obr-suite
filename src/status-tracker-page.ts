// Status Tracker — full-screen modal page.
//
// Loaded into the modal opened by src/modules/statusTracker/index.ts.
// Reads viewport-visible character tokens from OBR, lays them out as
// proportional cards in the central stage, plus a side strip for the
// resource tracker (top) and buff palette (bottom).
//
// Drag-drop:
//   - palette → token card  → applies the buff (writes token metadata
//     + broadcasts to background which re-renders bubbles on canvas).
//   - bubble on token card → another token card  → moves the buff.
//   - bubble on token card → empty space        → removes the buff.

import OBR, { Image, Item, isImage } from "@owlbear-rodeo/sdk";
import {
  PLUGIN_ID,
  STATUS_BUFFS_KEY,
  STATUS_RESOURCES_KEY,
  SCENE_BUFF_CATALOG_KEY,
  DEFAULT_BUFFS,
  BuffDef,
  ResourceItem,
  textColorFor,
} from "./modules/statusTracker/types";

const MODAL_ID = "com.obr-suite/status-tracker";
const BC_REFRESH_TOKEN = `${PLUGIN_ID}/refresh-token`;

const stageEl = document.getElementById("stage") as HTMLDivElement;
const buffFilterEl = document.getElementById("buffFilter") as HTMLDivElement;
const buffGridEl = document.getElementById("buffGrid") as HTMLDivElement;
const resBodyEl = document.getElementById("resBody") as HTMLDivElement;
const resNameEl = document.getElementById("resName") as HTMLInputElement;
const resMaxEl = document.getElementById("resMax") as HTMLInputElement;
const resAddEl = document.getElementById("resAdd") as HTMLButtonElement;
const dropHintEl = document.getElementById("dropHint") as HTMLDivElement;
document.getElementById("btn-close")?.addEventListener("click", () => closeModal());
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" || e.key === "]") {
    e.preventDefault();
    closeModal();
  }
});

function closeModal() {
  try { OBR.modal.close(MODAL_ID); } catch {}
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface TokenView {
  id: string;
  name: string;
  imageUrl: string;
  /** OBR scene-coord position. */
  sx: number;
  sy: number;
  buffIds: string[];
  resources: ResourceItem[];
}

let tokens: TokenView[] = [];
let catalog: BuffDef[] = DEFAULT_BUFFS.slice();
let activeFilter = "全部";
const DRAG_TYPE_PALETTE = "palette-buff";
const DRAG_TYPE_BUBBLE = "bubble-buff";
let selectedTokenIds = new Set<string>();

// ---------------------------------------------------------------------------
// Data load / save
// ---------------------------------------------------------------------------

async function loadCatalog(): Promise<void> {
  try {
    const meta = await OBR.scene.getMetadata();
    const v = meta[SCENE_BUFF_CATALOG_KEY] as unknown;
    if (Array.isArray(v) && v.length > 0) {
      const out: BuffDef[] = [];
      for (const e of v) {
        if (e && typeof (e as any).id === "string") {
          out.push({
            id: (e as any).id,
            name: String((e as any).name ?? (e as any).id),
            color: String((e as any).color ?? "#ffffff"),
            group: typeof (e as any).group === "string" ? (e as any).group : undefined,
          });
        }
      }
      catalog = out;
      return;
    }
  } catch {}
  catalog = DEFAULT_BUFFS.slice();
}

function asTokenView(it: Item): TokenView | null {
  if (!isImage(it)) return null;
  // Filter to character tokens (CHARACTER layer is the OBR convention
  // for player + monster tokens that participate in initiative).
  if (it.layer !== "CHARACTER" && it.layer !== "MOUNT") return null;
  const buffIds: string[] = (() => {
    const v = it.metadata?.[STATUS_BUFFS_KEY];
    if (Array.isArray(v)) return v.filter((x) => typeof x === "string");
    return [];
  })();
  const resources: ResourceItem[] = (() => {
    const v = it.metadata?.[STATUS_RESOURCES_KEY];
    if (Array.isArray(v)) {
      const out: ResourceItem[] = [];
      for (const e of v) {
        if (e && typeof (e as any).id === "string") {
          out.push({
            id: (e as any).id,
            name: String((e as any).name ?? "?"),
            current: Number((e as any).current ?? 0),
            max: Number((e as any).max ?? 1),
          });
        }
      }
      return out;
    }
    return [];
  })();
  return {
    id: it.id,
    name: it.name || (it as any).text?.plainText || "(未命名)",
    imageUrl: (it as any).image?.url ?? "",
    sx: it.position.x,
    sy: it.position.y,
    buffIds,
    resources,
  };
}

async function loadTokens(): Promise<void> {
  try {
    const all = await OBR.scene.items.getItems();
    tokens = all
      .map(asTokenView)
      .filter((t): t is TokenView => !!t);
  } catch (e) {
    console.warn("[obr-suite/status-page] loadTokens failed", e);
    tokens = [];
  }
}

async function loadSelection(): Promise<void> {
  try {
    const sel = await OBR.player.getSelection();
    selectedTokenIds = new Set(sel ?? []);
  } catch {
    selectedTokenIds = new Set();
  }
}

// ---------------------------------------------------------------------------
// Layout — map scene coords → modal viewport coords.
// We shrink the spread to avoid token cards getting clipped by the
// side panel. If no tokens exist we just render an empty stage with
// a placeholder hint.
// ---------------------------------------------------------------------------

interface Bounds { minX: number; minY: number; maxX: number; maxY: number }

function tokenBounds(): Bounds | null {
  if (tokens.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const t of tokens) {
    if (t.sx < minX) minX = t.sx;
    if (t.sy < minY) minY = t.sy;
    if (t.sx > maxX) maxX = t.sx;
    if (t.sy > maxY) maxY = t.sy;
  }
  // Pad a bit in case tokens are colocated.
  if (maxX - minX < 1) { minX -= 100; maxX += 100; }
  if (maxY - minY < 1) { minY -= 100; maxY += 100; }
  return { minX, minY, maxX, maxY };
}

function stageRect(): { x: number; y: number; w: number; h: number } {
  // Side panel ~310px on right, top toolbar ~50px, leave 80px padding.
  const PADDING = 80;
  const RIGHT_RESERVED = 320;
  const TOP_RESERVED = 80;
  const w = window.innerWidth - PADDING * 2 - RIGHT_RESERVED;
  const h = window.innerHeight - PADDING * 2 - TOP_RESERVED;
  return { x: PADDING, y: TOP_RESERVED + 10, w: Math.max(200, w), h: Math.max(200, h) };
}

function renderStage(): void {
  stageEl.innerHTML = "";
  if (tokens.length === 0) {
    stageEl.innerHTML = `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#7aa;font-size:13px">当前场景没有可用角色 token</div>`;
    return;
  }
  const b = tokenBounds()!;
  const rect = stageRect();
  const dx = b.maxX - b.minX || 1;
  const dy = b.maxY - b.minY || 1;
  const CARD = 96;

  for (const t of tokens) {
    const px = rect.x + ((t.sx - b.minX) / dx) * (rect.w - CARD);
    const py = rect.y + ((t.sy - b.minY) / dy) * (rect.h - CARD);
    const el = document.createElement("div");
    el.className = "tcard";
    el.dataset.tokenId = t.id;
    el.style.left = `${Math.round(px)}px`;
    el.style.top = `${Math.round(py)}px`;
    if (t.imageUrl) el.style.backgroundImage = `url("${t.imageUrl.replace(/"/g, "&quot;")}")`;
    if (selectedTokenIds.has(t.id)) {
      el.style.borderColor = "#f5a623";
    }

    el.innerHTML = `
      <span class="tname">${escapeHtml(t.name)}</span>
      <div class="buff-orbit"></div>
    `;

    // Click selects (single)
    el.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      try {
        await OBR.player.select([t.id]);
        selectedTokenIds = new Set([t.id]);
        for (const card of stageEl.querySelectorAll<HTMLDivElement>(".tcard")) {
          card.style.borderColor = card.dataset.tokenId === t.id
            ? "#f5a623" : "rgba(93,173,226,0.6)";
        }
        renderResourcesPanel();
      } catch {}
    });

    // Drop target wiring
    el.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer!.dropEffect = "move";
      el.classList.add("drop-hover");
    });
    el.addEventListener("dragleave", () => el.classList.remove("drop-hover"));
    el.addEventListener("drop", async (e) => {
      e.preventDefault();
      el.classList.remove("drop-hover");
      const buffId = e.dataTransfer?.getData("text/plain");
      const fromToken = e.dataTransfer?.getData("from-token");
      if (!buffId) return;
      // Same-card drop = no-op
      if (fromToken && fromToken === t.id) return;
      await applyBuffToToken(t.id, buffId);
      if (fromToken) await removeBuffFromToken(fromToken, buffId);
    });

    // Render existing buff bubbles around this card
    const orbit = el.querySelector<HTMLDivElement>(".buff-orbit")!;
    renderBuffBubbles(orbit, t);

    stageEl.appendChild(el);
  }
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderBuffBubbles(orbit: HTMLDivElement, t: TokenView): void {
  // Same arc layout as bubbles.ts (top → left → right → left → ...
  // with 22° step; spillover into outer rings at 120° span max).
  const STEP = 22;
  const SPAN_HALF = 60;
  const RING_RADIUS_BASE = 70; // px from orbit center
  const RING_GAP = 28;
  // orbit element is inset:-90 so its center === card center (96/2=48
  // inside the 96+90+90 box). Card is 96×96, orbit is offset -90 each
  // direction → the orbit's local 0,0 sits at the card's -90,-90 corner.
  // Card center in orbit coords = (90+48, 90+48) = (138, 138).
  const CX = 138;
  const CY = 138;
  const placements: Array<{ ring: number; slot: number }> = [];
  const maxSlot = Math.max(1, Math.floor((2 * SPAN_HALF) / STEP));
  let remaining = t.buffIds.length;
  let ring = 0;
  while (remaining > 0) {
    const fit = Math.min(maxSlot + 1, remaining);
    for (let s = 0; s < fit; s++) placements.push({ ring, slot: s });
    remaining -= fit;
    ring += 1;
  }
  for (let i = 0; i < t.buffIds.length; i++) {
    const buff = catalog.find((b) => b.id === t.buffIds[i]);
    if (!buff) continue;
    const p = placements[i];
    // angle: slot 0 = top (-90°), slots 1,3,... = left, 2,4,... = right
    let a = 0;
    if (p.slot > 0) {
      const half = Math.ceil(p.slot / 2);
      const sign = p.slot % 2 === 1 ? -1 : 1;
      a = sign * STEP * half;
    }
    const rad = ((a - 90) * Math.PI) / 180;
    const r = RING_RADIUS_BASE + p.ring * RING_GAP;
    const x = CX + Math.cos(rad) * r;
    const y = CY + Math.sin(rad) * r;
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.draggable = true;
    bubble.dataset.buffId = buff.id;
    bubble.dataset.fromToken = t.id;
    bubble.textContent = buff.name;
    bubble.style.left = `${Math.round(x)}px`;
    bubble.style.top = `${Math.round(y)}px`;
    bubble.style.background = buff.color;
    bubble.style.color = textColorFor(buff.color);
    bubble.addEventListener("dragstart", (e) => {
      e.dataTransfer!.setData("text/plain", buff.id);
      e.dataTransfer!.setData("from-token", t.id);
      e.dataTransfer!.effectAllowed = "move";
      bubble.classList.add("is-dragging");
    });
    bubble.addEventListener("dragend", () => bubble.classList.remove("is-dragging"));
    orbit.appendChild(bubble);
  }
}

// ---------------------------------------------------------------------------
// Buff palette (bottom-right)
// ---------------------------------------------------------------------------

function renderBuffPalette(): void {
  const groups = Array.from(new Set(["全部", ...catalog.map((b) => b.group ?? "其它")]));
  buffFilterEl.innerHTML = groups
    .map((g) => `<button data-group="${escapeHtml(g)}" type="button" class="${g === activeFilter ? "on" : ""}">${escapeHtml(g)}</button>`)
    .join("");
  buffFilterEl.querySelectorAll<HTMLButtonElement>("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeFilter = btn.dataset.group ?? "全部";
      renderBuffPalette();
    });
  });

  buffGridEl.innerHTML = "";
  const list = catalog.filter((b) => activeFilter === "全部" || (b.group ?? "其它") === activeFilter);
  for (const b of list) {
    const el = document.createElement("div");
    el.className = "bubble";
    el.draggable = true;
    el.dataset.buffId = b.id;
    el.textContent = b.name;
    el.style.background = b.color;
    el.style.color = textColorFor(b.color);
    el.addEventListener("dragstart", (e) => {
      e.dataTransfer!.setData("text/plain", b.id);
      e.dataTransfer!.effectAllowed = "copy";
      dropHintEl.classList.add("on");
      el.classList.add("is-dragging");
    });
    el.addEventListener("dragend", () => {
      dropHintEl.classList.remove("on");
      el.classList.remove("is-dragging");
    });
    buffGridEl.appendChild(el);
  }
}

// Listen for drops on empty stage area → if dragging from a token,
// remove the buff. Palette drops on empty area = no-op.
stageEl.addEventListener("dragover", (e) => { e.preventDefault(); });
stageEl.addEventListener("drop", async (e) => {
  e.preventDefault();
  const buffId = e.dataTransfer?.getData("text/plain");
  const fromToken = e.dataTransfer?.getData("from-token");
  if (!buffId || !fromToken) return;
  // Only remove if drop didn't land on a card (cards stop propagation).
  // Walk up event target chain to confirm.
  let n: HTMLElement | null = e.target as HTMLElement;
  while (n && n !== stageEl) {
    if (n.classList?.contains("tcard")) return;
    n = n.parentElement;
  }
  await removeBuffFromToken(fromToken, buffId);
});

// ---------------------------------------------------------------------------
// Buff write helpers
// ---------------------------------------------------------------------------

async function applyBuffToToken(tokenId: string, buffId: string): Promise<void> {
  try {
    await OBR.scene.items.updateItems([tokenId], (drafts) => {
      for (const d of drafts) {
        const cur = (d.metadata[STATUS_BUFFS_KEY] as string[] | undefined) ?? [];
        if (!cur.includes(buffId)) cur.push(buffId);
        d.metadata[STATUS_BUFFS_KEY] = cur;
      }
    });
    notifyTokenChanged(tokenId);
  } catch (e) {
    console.warn("[obr-suite/status-page] applyBuff failed", e);
  }
}

async function removeBuffFromToken(tokenId: string, buffId: string): Promise<void> {
  try {
    await OBR.scene.items.updateItems([tokenId], (drafts) => {
      for (const d of drafts) {
        const cur = (d.metadata[STATUS_BUFFS_KEY] as string[] | undefined) ?? [];
        d.metadata[STATUS_BUFFS_KEY] = cur.filter((id) => id !== buffId);
      }
    });
    notifyTokenChanged(tokenId);
  } catch (e) {
    console.warn("[obr-suite/status-page] removeBuff failed", e);
  }
}

function notifyTokenChanged(tokenId: string): void {
  try {
    OBR.broadcast.sendMessage(
      BC_REFRESH_TOKEN,
      { tokenId },
      { destination: "LOCAL" },
    );
  } catch {}
}

// ---------------------------------------------------------------------------
// Resource tracker (top-right)
// ---------------------------------------------------------------------------

function renderResourcesPanel(): void {
  // Only show resources for currently selected tokens; if nothing
  // selected, show all party-side ones grouped by token.
  const target = tokens.filter((t) => selectedTokenIds.size === 0 || selectedTokenIds.has(t.id));
  resBodyEl.innerHTML = "";
  if (target.length === 0) {
    resBodyEl.innerHTML = `<p class="res-no-target">点击中央的角色卡以查看资源</p>`;
    return;
  }
  let any = false;
  for (const t of target) {
    if (t.resources.length === 0) continue;
    any = true;
    for (const r of t.resources) {
      const row = document.createElement("div");
      row.className = "res-row";
      row.innerHTML = `
        <span class="who" title="${escapeHtml(t.name)}">${escapeHtml(t.name)}</span>
        <span class="name" title="${escapeHtml(r.name)}">${escapeHtml(r.name)}</span>
        <span class="ctrl">
          <button data-act="dec">−</button>
          <span class="num">${r.current}/${r.max}</span>
          <button data-act="inc">＋</button>
          <button class="del" data-act="del" title="删除">✕</button>
        </span>
      `;
      row.querySelectorAll<HTMLButtonElement>("button[data-act]").forEach((b) => {
        b.addEventListener("click", async () => {
          const act = b.dataset.act;
          await mutateResource(t.id, r.id, act!);
        });
      });
      resBodyEl.appendChild(row);
    }
  }
  if (!any) {
    resBodyEl.innerHTML = `<p class="res-no-target">所选角色还没有资源 — 在下方添加。</p>`;
  }
}

async function mutateResource(tokenId: string, resourceId: string, op: string): Promise<void> {
  try {
    await OBR.scene.items.updateItems([tokenId], (drafts) => {
      for (const d of drafts) {
        const list = (d.metadata[STATUS_RESOURCES_KEY] as ResourceItem[] | undefined) ?? [];
        const out: ResourceItem[] = [];
        for (const r of list) {
          if (r.id !== resourceId) { out.push(r); continue; }
          if (op === "del") continue;
          let next = { ...r };
          if (op === "dec") next.current = Math.max(0, r.current - 1);
          if (op === "inc") next.current = Math.min(r.max, r.current + 1);
          out.push(next);
        }
        d.metadata[STATUS_RESOURCES_KEY] = out;
      }
    });
  } catch (e) {
    console.warn("[obr-suite/status-page] mutateResource failed", e);
  }
}

resAddEl.addEventListener("click", async () => {
  const name = resNameEl.value.trim();
  const max = Math.max(1, Math.min(999, Number(resMaxEl.value) || 1));
  if (!name) {
    resNameEl.focus();
    return;
  }
  const targets = Array.from(selectedTokenIds);
  if (targets.length === 0) {
    alert("请先点击一个角色卡选中目标。");
    return;
  }
  for (const tokenId of targets) {
    try {
      await OBR.scene.items.updateItems([tokenId], (drafts) => {
        for (const d of drafts) {
          const list = (d.metadata[STATUS_RESOURCES_KEY] as ResourceItem[] | undefined) ?? [];
          list.push({
            id: `r-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            name,
            current: max,
            max,
          });
          d.metadata[STATUS_RESOURCES_KEY] = list;
        }
      });
    } catch {}
  }
  resNameEl.value = "";
});

// ---------------------------------------------------------------------------
// Init + reactive refresh
// ---------------------------------------------------------------------------

OBR.onReady(async () => {
  await loadCatalog();
  await loadSelection();
  await loadTokens();
  renderStage();
  renderBuffPalette();
  renderResourcesPanel();

  OBR.scene.items.onChange(async () => {
    await loadTokens();
    renderStage();
    renderResourcesPanel();
  });
  OBR.player.onChange(async () => {
    await loadSelection();
    // Re-render stage borders + resources for new selection
    for (const card of stageEl.querySelectorAll<HTMLDivElement>(".tcard")) {
      card.style.borderColor = selectedTokenIds.has(card.dataset.tokenId ?? "")
        ? "#f5a623" : "rgba(93,173,226,0.6)";
    }
    renderResourcesPanel();
  });
  OBR.scene.onMetadataChange(async () => {
    await loadCatalog();
    renderBuffPalette();
  });
});
