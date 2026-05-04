import OBR from "@owlbear-rodeo/sdk";
import { DieResult, sidesOf } from "./types";

// Replay overlay modal — opens when a player clicks a row in the
// dice-history popover. Reads localStorage history (shared key with
// the panel + history popover), filters by collectiveId from URL,
// and renders ONE compact "speech bubble" above each token's head:
// dice icons + values + modifier + label + total, in the roller's
// color.
//
// All clients that received the BC_DICE_REPLAY broadcast open this
// modal — so EVERYONE sees the overlay on canvas. Closing is handled
// by either:
//   - clicking a bubble (this iframe broadcasts BC_DICE_REPLAY to
//     toggle), or
//   - the user clicking the same history row again (the history
//     popover broadcasts the toggle directly), or
//   - clicking a different row (the dice background closes this
//     modal before opening the new one).

const params = new URLSearchParams(location.search);
const cid = params.get("cid") ?? "";

const LS_HISTORY = "obr-suite/dice/history";
const BC_DICE_REPLAY = "com.obr-suite/dice-replay";

interface HistoryEntry {
  itemId: string | null;
  dice: DieResult[];
  winnerIdx: number;
  modifier: number;
  label: string;
  total: number;
  rollerId: string;
  rollerName: string;
  rollerColor: string;
  rollId: string;
  ts: number;
  hidden?: boolean;
  collectiveId?: string;
  // Mirrors `DiceRollPayload.rowStarts` — present when the roll was
  // wrapped in `repeat(N, …)`. Each entry is the index in `dice[]`
  // where the corresponding iteration starts. The tooltip renders
  // these as vertical rows (one per iteration) instead of one
  // grand-total line, per the user's spec for the floating
  // "玩家头顶骰子记录悬浮框".
  rowStarts?: number[];
}

function loadHistory(): HistoryEntry[] {
  try {
    const v = localStorage.getItem(LS_HISTORY);
    if (!v) return [];
    const p = JSON.parse(v);
    if (Array.isArray(p)) return p;
  } catch {}
  return [];
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const STANDARD_TYPES = new Set(["d4", "d6", "d8", "d10", "d12", "d20", "d100"]);
function imgFor(type: string): string {
  return STANDARD_TYPES.has(type) ? type : "d100";
}

function chipsFor(slice: DieResult[]): string {
  return slice.map((d) => {
    const sides = sidesOf(d.type);
    const cls =
      d.loser ? "loser" :
      d.value === sides ? "crit" :
      d.value === 1 ? "fail" : "";
    return `<span class="die ${cls}"><img src="/suite/${imgFor(d.type)}.png" alt="">${d.value}</span>`;
  }).join("");
}

function buildBubbleInner(entry: HistoryEntry): string {
  const label = entry.label
    ? `<div class="label">${escapeHtml(entry.label)}</div>`
    : "";
  const mod = entry.modifier !== 0
    ? `<span class="mod">${entry.modifier > 0 ? `+${entry.modifier}` : entry.modifier}</span>`
    : "";

  // repeat(N, …): stack one row per iteration. No grand-total row,
  // per user's spec — the tooltip shows each individual roll
  // standalone instead of mashing them into a single line + sum.
  const rows = entry.rowStarts ?? [];
  if (rows.length > 1) {
    const out: string[] = [];
    for (let r = 0; r < rows.length; r++) {
      const start = rows[r];
      const end = r + 1 < rows.length ? rows[r + 1] : entry.dice.length;
      const slice = entry.dice.slice(start, end);
      const kept = slice.filter((d) => !d.loser);
      const rowSum = kept.reduce((a, d) => a + d.value, 0) + entry.modifier;
      out.push(
        `<div class="row1 repeat-row">` +
        `<span class="repeat-idx">#${r + 1}</span>` +
        `${chipsFor(slice)}${mod}` +
        `<span class="eq">=</span><span class="total">${rowSum}</span>` +
        `</div>`,
      );
    }
    return `${label}<div class="repeat-stack">${out.join("")}</div>`;
  }

  // Single roll (default).
  return `${label}<div class="row1">${chipsFor(entry.dice)}${mod}<span class="eq">=</span><span class="total">${entry.total}</span></div>`;
}

const stage = document.getElementById("stage") as HTMLDivElement;
const hint = document.getElementById("hint") as HTMLDivElement;

interface OverlaySlot {
  el: HTMLDivElement;
  itemId: string;
  entry: HistoryEntry;
}
const overlays: OverlaySlot[] = [];

function buildOverlays(): void {
  const history = loadHistory();
  const members = history.filter((h) => h.collectiveId === cid || h.rollId === cid);
  if (!members.length) {
    // No data to replay — close immediately.
    OBR.broadcast.sendMessage(BC_DICE_REPLAY, { cid, action: "close" }, { destination: "LOCAL" }).catch(() => {});
    return;
  }
  for (const entry of members) {
    if (!entry.itemId) continue;       // tokenless dark roll → no anchor
    const el = document.createElement("div");
    el.className = "overlay";
    el.innerHTML = `<div class="bubble" style="--player-color:${entry.rollerColor}">${buildBubbleInner(entry)}</div>`;
    el.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Click any bubble → broadcast a toggle to close (LOCAL + REMOTE
      // so all clients close together).
      OBR.broadcast.sendMessage(BC_DICE_REPLAY, { cid, action: "close" }, { destination: "LOCAL" }).catch(() => {});
      OBR.broadcast.sendMessage(BC_DICE_REPLAY, { cid, action: "close" }, { destination: "REMOTE" }).catch(() => {});
    });
    stage.appendChild(el);
    overlays.push({ el, itemId: entry.itemId, entry });
  }
}

// --- Per-frame position update (anchor each overlay at its token's
// top-of-head screen position; updates on viewport pan/zoom). ---
let updateInFlight = false;
let trackingActive = true;
async function updatePositions(): Promise<void> {
  if (updateInFlight) return;
  updateInFlight = true;
  try {
    const ids = overlays.map((o) => o.itemId);
    const [items, vp, scale, dpi] = await Promise.all([
      OBR.scene.items.getItems(ids),
      OBR.viewport.getPosition(),
      OBR.viewport.getScale(),
      OBR.scene.grid.getDpi().catch(() => 150),
    ]);
    const byId = new Map<string, any>();
    for (const it of items) byId.set(it.id, it);
    for (const o of overlays) {
      const item = byId.get(o.itemId);
      if (!item) {
        o.el.style.display = "none";
        continue;
      }
      o.el.style.display = "";
      // Compute the token's top in world coords. Same logic the
      // effect-page uses for its dice anchor.
      let halfHeight = 75;
      try {
        const img = item.image;
        const itemDpi = item.grid?.dpi;
        const sy = item.scale?.y ?? 1;
        if (img?.height && itemDpi && dpi) {
          halfHeight = (img.height / itemDpi) * dpi * sy / 2;
        } else if (dpi) {
          halfHeight = dpi / 2;
        }
      } catch {}
      const wx = item.position.x;
      const wy = item.position.y - halfHeight;
      const sx = wx * scale + vp.x;
      const sy = wy * scale + vp.y;
      o.el.style.left = `${sx}px`;
      o.el.style.top = `${sy}px`;
    }
  } catch {}
  updateInFlight = false;
}

function frame(): void {
  if (!trackingActive) return;
  updatePositions();
  requestAnimationFrame(frame);
}

OBR.onReady(async () => {
  buildOverlays();
  await updatePositions();
  // Reveal after first paint so overlays don't flash at (0,0).
  requestAnimationFrame(() => {
    for (const o of overlays) o.el.classList.add("show");
    hint.classList.add("show");
    setTimeout(() => hint.classList.remove("show"), 2400);
  });
  requestAnimationFrame(frame);

  // External "close" broadcasts (history row clicked again, or another
  // row clicked which kicks the existing replay before opening a new
  // one). The dice background module orchestrates the actual modal
  // close — this iframe just stops its rAF loop.
  OBR.broadcast.onMessage(BC_DICE_REPLAY, () => {
    trackingActive = false;
  });
});
