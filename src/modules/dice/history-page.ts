import OBR from "@owlbear-rodeo/sdk";
import { DieResult, sidesOf } from "./types";
import { applyI18nDom, t } from "../../i18n";
import { getLocalLang, onLangChange } from "../../state";
import { bindPanelDrag } from "../../utils/panelDrag";
import { PANEL_IDS } from "../../utils/panelLayout";
import { installDebugOverlay } from "../../utils/debugOverlay";

let lang = getLocalLang();
const tt = (k: Parameters<typeof t>[1]) => t(lang, k);

// Bottom-left always-on history popover.
//
// Shows ONE row per player — the most-recent roll they've made. Click
// a row to open the dice panel jumped to the History tab with that
// player's filter pre-selected. Dark rolls are LOCAL-only on the
// sender's broadcast so non-DM clients never receive them; the DM's
// own client renders dark-roll rows with a tinted background and
// "暗" tag so the DM can see what they hid from players.
//
// Storage: shares the dice panel's localStorage key
// "obr-suite/dice/history" so the same data drives both views.

const BROADCAST_DICE_ROLL = "com.obr-suite/dice-roll";
const BC_DICE_HISTORY_FILTER = "com.obr-suite/dice-history-filter";
const BC_DICE_PANEL_TOGGLE = "com.obr-suite/dice-panel-toggle";
const BC_DICE_REPLAY = "com.obr-suite/dice-replay";
// Effect-page broadcasts this near the end of the fly-to-history
// animation; we use it to commit pending entries to the visible list
// so the row appears at the same moment the dice arrive in the
// corner.
const BC_DICE_HISTORY_REVEAL = "com.obr-suite/dice-history-reveal";

// Per-room dice history. Old shape was a single global key
// "obr-suite/dice/history" — every room's rolls piled into the same
// list, so opening a fresh room showed yesterday's session. Now we
// suffix the key with `OBR.room.id` so each room has its own scroll-
// back. The default suffix is used until OBR.onReady completes the
// initial room-id lookup, after which the key is rebuilt and the
// history reloaded in place.
const LS_HISTORY_BASE = "obr-suite/dice/history";
function safeRoomKey(rid: string): string {
  return rid.replace(/[^a-zA-Z0-9_-]/g, "_") || "default";
}
let LS_HISTORY = `${LS_HISTORY_BASE}:default`;
const HISTORY_CAP = 200;
// Hard ceiling on how long a pending entry waits for its reveal
// signal. If something goes wrong with the effect modal the entry
// still lands in history after this delay.
const PENDING_TIMEOUT_MS = 6500;

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
  // Mirrors `DiceRollPayload.rowStarts` from panel-page — present when
  // the roll was wrapped in `repeat(N, …)`. Each entry in `rowStarts`
  // is the index in `dice[]` where that row starts. Used here so the
  // strip can render `+mod × N` and a `repeat×N` tag instead of a
  // single mod chip whose math no longer matches the total.
  rowStarts?: number[];
}

// Currently-active replay's collective-id (LOCAL state — set when this
// client clicks a row, cleared when the replay closes). Used so we
// can render the active row with a "lit up" border and so a second
// click on the same row sends a CLOSE broadcast.
let activeReplayCid: string | null = null;

// Transient mode + progress bars REMOVED 2026-05-07 (round 3): the
// popover no longer self-dismisses on a 5-second timer. It stays open
// until either the user clicks the X-dismiss button OR clicks a row
// (which jumps to the dice action panel and dismisses this popover as
// part of the same broadcast). The popover's height is now fixed by
// the background module's `openHistory` call (HISTORY_H = 168), so
// the per-render resize is unnecessary.

// Pending entries — received via BROADCAST_DICE_ROLL but not yet
// committed to the visible history. Each one waits for the matching
// BC_DICE_HISTORY_REVEAL (sent by effect-page near the end of the
// fly-to-history animation) before being unshifted into `history`.
// Falls back to a timeout so a stuck modal doesn't lose history.
const pendingEntries = new Map<string, { entry: HistoryEntry; timer: number }>();

function commitPending(rollId: string): void {
  const p = pendingEntries.get(rollId);
  if (!p) return;
  pendingEntries.delete(rollId);
  clearTimeout(p.timer);
  // Dedupe — the dice panel iframe ALSO writes to localStorage on
  // BROADCAST_DICE_ROLL (eager save for its own history tab) and the
  // resulting `storage` event re-loads our `history` array. By the
  // time we commit-pending here, the entry may already be present.
  // Without this guard we'd unshift a second copy → "集体 2" of the
  // same roll, which is the duplication the user hit.
  if (history.some((h) => h.rollId === rollId)) {
    render();
    if (detailRollerKey) renderDetail();
    return;
  }
  history.unshift(p.entry);
  if (history.length > HISTORY_CAP) history.length = HISTORY_CAP;
  saveHistory();
  render();
  if (detailRollerKey) {
    const k = p.entry.rollerId || p.entry.rollerName || "?";
    if (k === detailRollerKey) renderDetail();
  }
}

let history: HistoryEntry[] = loadHistory();
let myRole: "GM" | "PLAYER" | "" = "";

const rowsEl = document.getElementById("rows") as HTMLDivElement;
// headHint was removed when the title bar was dropped from
// dice-history.html. Keep a null-safe handle so the existing call
// sites stay valid (no-op when the element isn't rendered).
const headHint = document.getElementById("headHint") as HTMLSpanElement | null;
const detailEl = document.getElementById("detail") as HTMLDivElement;
const detailSwatch = document.getElementById("detailSwatch") as HTMLDivElement;
const detailName = document.getElementById("detailName") as HTMLDivElement;
const detailCount = document.getElementById("detailCount") as HTMLDivElement;
const detailList = document.getElementById("detailList") as HTMLDivElement;
const detailBack = document.getElementById("detailBack") as HTMLButtonElement;

// Currently-displayed player in the detail view (null = list view).
// When the data layer updates we re-render the detail too if it's
// the active view.
let detailRollerKey: string | null = null;

function loadHistory(): HistoryEntry[] {
  try {
    const v = localStorage.getItem(LS_HISTORY);
    if (!v) return [];
    const p = JSON.parse(v);
    if (Array.isArray(p)) return p;
  } catch {}
  return [];
}

function saveHistory(): void {
  try {
    localStorage.setItem(LS_HISTORY, JSON.stringify(history));
  } catch {}
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatAgo(ms: number): string {
  if (ms < 5_000) return tt("diceJustNow");
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h`;
  return `${Math.floor(ms / 86_400_000)}d`;
}

// Standard die types with dedicated PNG art. Anything else falls back
// to the d100 art.
const STANDARD_TYPES = new Set(["d4", "d6", "d8", "d10", "d12", "d20", "d100"]);
function imgFor(type: string): string {
  return STANDARD_TYPES.has(type) ? type : "d100";
}

// Build a compact inline formula. Shows each kept die as a chip
// (icon + value), losers struck through, modifier at the end, total
// at the right edge.
//
// Returns the formula's INNER markup — caller wraps it in a
// `.formula` container. The dice + modifier + label + "=" sit inside
// `.dice-list` (which wraps when there are too many chips), and the
// total is a sibling that sticks to the right edge. This split lets
// long collective rolls wrap dice across multiple lines while
// keeping the total visually anchored on the right.
function chipsHtml(dice: DieResult[]): string {
  const parts: string[] = [];
  for (const d of dice) {
    const sides = sidesOf(d.type);
    const cls =
      d.loser ? "loser" :
      d.value === sides ? "crit" :
      d.value === 1 ? "fail" : "";
    // Subtraction dice show a leading "−" so users see what's being
    // deducted at a glance, plus a `subtract` class for the dimmer
    // styling (matches the effect-modal's faded subtract dice).
    const subtractCls = d.subtract ? " subtract" : "";
    const valueStr = d.subtract ? `−${d.value}` : String(d.value);
    parts.push(
      `<span class="die-chip ${cls}${subtractCls}">` +
      `<img src="/suite/${imgFor(d.type)}.png" alt="${escapeHtml(d.type)}" draggable="false">` +
      `<span>${valueStr}</span>` +
      `</span>`,
    );
  }
  return parts.join("");
}
function buildFormula(entry: HistoryEntry, showLabel = true): string {
  const chips = chipsHtml(entry.dice);
  let modStr = "";
  if (entry.modifier !== 0) {
    // For repeat(N, …) rolls the modifier is applied once per row, not
    // once total — the entry.total is dice + modifier × N. Render the
    // mod as `+5×3` so the chips → total arithmetic actually balances.
    const N = entry.rowStarts?.length ?? 0;
    const sign = entry.modifier > 0 ? "+" : "";
    modStr = N > 1
      ? `<span class="mod">${sign}${entry.modifier}×${N}</span>`
      : `<span class="mod">${sign}${entry.modifier}</span>`;
  }
  // Repeat header: `repeat(N)` so the user sees at a glance this isn't
  // a flat single roll but N independent ones.
  const repeatTag = (entry.rowStarts?.length ?? 0) > 1
    ? `<span class="label-tag" style="background:rgba(93,173,226,0.18);color:#9ad9ff">repeat×${entry.rowStarts!.length}</span>`
    : "";
  // `showLabel = false` in the detail view — the row's `.player`
  // line already shows the label as the entry's title there, so an
  // inline italic-grey duplicate would be visual noise. The
  // popover-row solo path keeps `showLabel = true` since its title
  // shows the roller's name, not the label.
  const labelStr = showLabel && entry.label
    ? `<span class="label-tag">${escapeHtml(entry.label)}</span>`
    : "";
  const list = `<div class="dice-list">${repeatTag}${chips}${modStr}${labelStr}<span class="eq">=</span></div>`;
  const total = `<span class="total">${entry.total}</span>`;
  return list + total;
}

// One member of a collective roll = one self-contained pill showing
// that token's dice + modifier + total. Used in both the popover
// row's strip (each player's latest collective) and the detail
// view's strip (the player's full history). The card itself doesn't
// own a click handler — clicks bubble to the parent .row /
// .coll-entry which owns the gesture (open detail / fire replay).
function buildMemberCard(m: HistoryEntry): string {
  const chips = chipsHtml(m.dice);
  const modStr = m.modifier !== 0
    ? `<span class="mod">${m.modifier > 0 ? `+${m.modifier}` : m.modifier}</span>`
    : "";
  // Crit / fail tinting reflects this specific member's d20 outcome
  // (so a 4-token collective with one nat-20 lights up exactly that
  // card, not the whole strip).
  const kept = m.dice.filter((d) => !d.loser);
  const isCrit = kept.some((d) => d.type === "d20" && d.value === 20);
  const isFail = kept.some((d) => d.type === "d20" && d.value === 1);
  const cardCls = ["member-card"];
  if (isCrit) cardCls.push("crit");
  else if (isFail) cardCls.push("fail");
  if (m.hidden) cardCls.push("hidden-roll");
  return `<div class="${cardCls.join(" ")}" data-rollid="${escapeHtml(m.rollId)}" data-cid="${escapeHtml(m.collectiveId ?? m.rollId)}">${chips}${modStr}<span class="eq">=</span><span class="total">${m.total}</span></div>`;
}

function buildMemberStripHtml(members: HistoryEntry[]): string {
  return `<div class="member-strip">${members.map(buildMemberCard).join("")}</div>`;
}

// `repeat(N, inner)` rolls render as N stacked member-cards (one per
// iteration) instead of a single flattened formula. Same visual
// vocabulary as a collective member-strip, but vertical because all
// rolls belong to ONE player and stacking matches the user's mental
// model ("3 separate attacks, top-to-bottom"). Each card shows the
// dice chips + modifier + per-row total — modifier is applied to
// every row, never aggregated, so the math at a glance is unambiguous.
function buildRepeatRowCard(entry: HistoryEntry, rowIdx: number, rowDice: DieResult[], rowTotal: number): string {
  const chips = chipsHtml(rowDice);
  const modStr = entry.modifier !== 0
    ? `<span class="mod">${entry.modifier > 0 ? `+${entry.modifier}` : entry.modifier}</span>`
    : "";
  const kept = rowDice.filter((d) => !d.loser);
  const isCrit = kept.some((d) => d.type === "d20" && d.value === 20);
  const isFail = kept.some((d) => d.type === "d20" && d.value === 1);
  const cls = ["member-card"];
  if (isCrit) cls.push("crit");
  else if (isFail) cls.push("fail");
  if (entry.hidden) cls.push("hidden-roll");
  return (
    `<div class="${cls.join(" ")}" data-rollid="${escapeHtml(entry.rollId)}" data-cid="${escapeHtml(entry.collectiveId ?? entry.rollId)}">` +
    `<span class="repeat-idx">#${rowIdx + 1}</span>` +
    `${chips}${modStr}<span class="eq">=</span><span class="total">${rowTotal}</span>` +
    `</div>`
  );
}

function buildRepeatStripHtml(entry: HistoryEntry, layout: "flow" | "stack" = "stack"): string {
  const rows = entry.rowStarts ?? [];
  if (rows.length === 0) return "";
  const out: string[] = [];
  for (let r = 0; r < rows.length; r++) {
    const start = rows[r];
    const end = r + 1 < rows.length ? rows[r + 1] : entry.dice.length;
    const rowDice = entry.dice.slice(start, end);
    const kept = rowDice.filter((d) => !d.loser);
    const rowTotal = kept.reduce((a, d) => a + d.value, 0) + entry.modifier;
    out.push(buildRepeatRowCard(entry, r, rowDice, rowTotal));
  }
  const cls = layout === "flow" ? "repeat-strip is-flow" : "repeat-strip is-stack";
  return `<div class="${cls}">${out.join("")}</div>`;
}

interface GroupedRow {
  // Identifier passed to the replay broadcast — collectiveId if the
  // entry is part of a collective, otherwise the rollId.
  cid: string;
  // The "head" entry (most recent member of the group) is what the
  // row label / color comes from.
  head: HistoryEntry;
  // All members (1+ entries). For collective rolls, length > 1.
  members: HistoryEntry[];
}

// Chronological flow view: every roll gets its own row in the
// popover (newest-first in DOM order, but the .rows container uses
// `column-reverse` so the bottom row is the newest one). Collective
// rolls — a single user action that fanned out N broadcasts — stay
// collapsed into ONE row so they don't visually swamp the popover.
//
// Replaces the old "latest per player" grouping per user request
// 2026-05-08: a fresh roll from player A no longer overwrites
// player A's previous row. Each record is preserved in its own slot
// until it scrolls off the top.
function chronologicalFlow(): GroupedRow[] {
  const byCid = new Map<string, HistoryEntry[]>();
  for (const h of history) {
    const cid = h.collectiveId ?? h.rollId;
    const arr = byCid.get(cid) ?? [];
    arr.push(h);
    byCid.set(cid, arr);
  }
  const seenCids = new Set<string>();
  const out: GroupedRow[] = [];
  // history is newest-first; emit each cid the first time we see it.
  // This places the newest occurrence of each cid (typically the
  // collective-head) at the front, with all members attached.
  for (const h of history) {
    const cid = h.collectiveId ?? h.rollId;
    if (seenCids.has(cid)) continue;
    seenCids.add(cid);
    const members = byCid.get(cid) ?? [h];
    out.push({ cid, head: h, members });
  }
  return out;
}

function render(): void {
  const rows = chronologicalFlow();
  if (!rows.length) {
    rowsEl.innerHTML = `<div class="empty">${tt("diceHistEmpty")}</div>`;
    if (headHint) headHint.textContent = "";
    const boxEl = document.querySelector<HTMLElement>(".box");
    if (boxEl) boxEl.classList.remove("has-rows");
    return;
  }
  if (headHint) headHint.textContent = lang === "zh" ? `${rows.length} 位` : `${rows.length}`;
  rowsEl.innerHTML = rows.map((g) => {
    const h = g.head;
    const isCollective = g.members.length > 1;
    const isRepeat = !isCollective && (h.rowStarts?.length ?? 0) > 1;
    const dmTag = h.rollerId && myRoleIsDM(h) ? `<span class="dm-tag">DM</span>` : "";
    const darkTag = h.hidden ? `<span class="dark-tag">${tt("diceHistDarkTag")}</span>` : "";
    const collTag = isCollective ? `<span class="coll-tag">${tt("diceHistColl")} ${g.members.length}</span>` : "";
    const repeatTag = isRepeat
      ? `<span class="coll-tag" style="background:rgba(93,173,226,0.18);color:#9ad9ff">×${h.rowStarts!.length}</span>`
      : "";
    const rowCls = ["row"];
    if (h.hidden) rowCls.push("hidden-roll");
    // Three render paths:
    //   collective → wrap-friendly strip of member-cards (one per token)
    //   repeat     → flow-wrap strip of member-cards (matches the
    //                in-row visual rhythm of a collective; wraps to
    //                a new line only when the strip can't fit)
    //   solo       → flat formula with chips + total
    const bodyTail = isCollective
      ? buildMemberStripHtml(g.members)
      : isRepeat
      ? buildRepeatStripHtml(h, "flow")
      : `<div class="formula">${buildFormula(h)}</div>`;
    // Progress bar removed (no transient auto-dismiss).
    const playerKey = h.rollerId || h.rollerName || "?";
    const cid = g.cid;
    return `
      <div class="${rowCls.join(" ")}" data-roller="${escapeHtml(h.rollerName)}" data-rollerid="${escapeHtml(h.rollerId)}" data-player="${escapeHtml(playerKey)}" data-cid="${escapeHtml(cid)}">
        <div class="swatch" style="--player-color:${h.rollerColor}"></div>
        <div class="body">
          <div class="line1">
            <span class="player">${dmTag}${darkTag}${collTag}${repeatTag}${escapeHtml(h.rollerName)}</span>
            <span class="ago">${formatAgo(Date.now() - h.ts)}</span>
          </div>
          ${bodyTail}
        </div>
      </div>
    `;
  }).join("");

  rowsEl.querySelectorAll<HTMLDivElement>(".row").forEach((row) => {
    row.addEventListener("click", () => {
      const playerName = row.dataset.roller ?? "";
      const cid = row.dataset.cid ?? "";
      // New behaviour (per user spec): click a row → open the dice
      // action panel jumped to History tab (filter by this player) +
      // activate the replay overlay for this roll's collective. The
      // bottom-right history popover dismisses itself afterwards so
      // the user can focus on the panel without two UIs fighting for
      // attention.
      try {
        // 1. Tell the dice action panel to switch to History tab and
        //    pre-select this player as the segmented filter.
        if (playerName) {
          OBR.broadcast.sendMessage(
            "com.obr-suite/dice-history-filter",
            { playerName },
            { destination: "LOCAL" },
          );
        }
        // 2. Open the dice action panel.
        OBR.broadcast.sendMessage(
          "com.obr-suite/dice-panel-toggle",
          { open: true },
          { destination: "LOCAL" },
        );
        // 3. Activate the replay overlay for this row's collective.
        if (cid) {
          OBR.broadcast.sendMessage(
            BC_DICE_REPLAY,
            { cid, action: "toggle" },
            { destination: "LOCAL" },
          );
          OBR.broadcast.sendMessage(
            BC_DICE_REPLAY,
            { cid, action: "toggle" },
            { destination: "REMOTE" },
          );
        }
        // 4. Dismiss this popover so it gets out of the way.
        OBR.broadcast.sendMessage(
          "com.obr-suite/dice-history-dismiss",
          {},
          { destination: "LOCAL" },
        );
      } catch {}
    });
  });

  // Toggle the .has-rows flag on the .box wrapper so the X dismiss
  // button shows/hides with the row list. The button is meaningless
  // when there's nothing to dismiss.
  const boxEl = document.querySelector<HTMLElement>(".box");
  if (boxEl) boxEl.classList.toggle("has-rows", rows.length > 0);
}

// Camera-focus the local viewport on the involved tokens. Single
// token → animateTo at current zoom; multi-token → animateToBounds.
async function focusCameraOnGroup(g: GroupedRow): Promise<void> {
  const ids = g.members.map((m) => m.itemId).filter((id): id is string => !!id);
  if (!ids.length) return;
  try {
    const items = await OBR.scene.items.getItems(ids);
    if (!items.length) return;
    if (items.length === 1) {
      const [vw, vh, scale] = await Promise.all([
        OBR.viewport.getWidth(),
        OBR.viewport.getHeight(),
        OBR.viewport.getScale(),
      ]);
      const p = items[0].position;
      OBR.viewport.animateTo({
        position: { x: -p.x * scale + vw / 2, y: -p.y * scale + vh / 2 },
        scale,
      }).catch(() => {});
      return;
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const it of items) {
      const p = (it as any).position;
      if (!p) continue;
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    if (!Number.isFinite(minX)) return;
    let dpi = 150;
    try { dpi = await OBR.scene.grid.getDpi(); } catch {}
    const padX = dpi * 1.5;
    const padY = dpi * 2;
    const min = { x: minX - padX, y: minY - padY };
    const max = { x: maxX + padX, y: maxY + padY };
    OBR.viewport.animateToBounds({
      min, max,
      width: max.x - min.x,
      height: max.y - min.y,
      center: { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2 },
    }).catch(() => {});
  } catch {}
}

// Build the detail view for one player. Filter history to that
// player's entries, render newest-first, scroll-to-top.
function openDetail(rollerKey: string, _playerName: string): void {
  detailRollerKey = rollerKey;
  renderDetail();
  detailEl.classList.add("on");
  rowsEl.classList.add("shifted");
  detailList.scrollTop = 0;
  // Popover height is now fixed by the background module; no
  // per-render resize.
}

function closeDetail(): void {
  // Going back to the main list also dismisses any active replay
  // (the replay only makes sense in detail context).
  clearActiveReplay().catch(() => {});
  detailEl.classList.remove("on");
  rowsEl.classList.remove("shifted");
  setTimeout(() => {
    detailRollerKey = null;
    render();
  }, 350);
}

function renderDetail(): void {
  if (!detailRollerKey) return;
  const entries = history.filter((h) => {
    const k = h.rollerId || h.rollerName || "?";
    return k === detailRollerKey;
  });
  if (!entries.length) {
    detailName.textContent = tt("diceHistNoEntries");
    detailCount.textContent = "";
    detailList.innerHTML = `<div class="empty">${tt("diceHistEmptyDetail")}</div>`;
    return;
  }
  const head = entries[0];
  detailName.textContent = head.rollerName || tt("diceHistPlayer");
  detailCount.textContent = lang === "zh"
    ? `${entries.length} ${tt("diceHistTimes")}`
    : `${entries.length} ${tt("diceHistTimes")}`;
  detailSwatch.style.setProperty("--player-color", head.rollerColor || "#5dade2");
  (detailSwatch.style as any).background = head.rollerColor || "#5dade2";

  // Walk entries chronologically (newest first) and pack consecutive
  // collective members into one shared container. Each individual
  // member is a tightly-stacked sub-row inside, so the user can see
  // every roll's own dice + total without each one taking a full-
  // size slot. Solo rolls (no collectiveId) render as standalone
  // entries as before.
  //
  // Earlier versions tracked "consumed" entries by setting them to
  // null in the local `entries` array, but the outer loop didn't skip
  // those nulls — so iterating into a nullified position threw
  // `Cannot read properties of null (reading 'collectiveId')` and
  // froze the detail view. Use a Set<number> of consumed indices
  // instead so the local entries array stays untouched.
  const consumedIdx = new Set<number>();
  const blocks: string[] = [];
  for (let i = 0; i < entries.length; i++) {
    if (consumedIdx.has(i)) continue;
    const h = entries[i];
    const cid = h.collectiveId ?? h.rollId;
    // Gather all entries with the same cid (anywhere in the list,
    // not just consecutively — collective broadcasts can interleave
    // with other broadcasts on the wire).
    const members: HistoryEntry[] = [];
    for (let j = i; j < entries.length; j++) {
      if (consumedIdx.has(j)) continue;
      const e = entries[j];
      if ((e.collectiveId ?? e.rollId) === cid) {
        members.push(e);
        consumedIdx.add(j);
      }
    }
    if (!members.length) continue;
    blocks.push(renderHistoryBlock(cid, members));
  }
  detailList.innerHTML = blocks.join("");

  // Per-entry click handlers (works for both solo entries and
  // collective members — every clickable .entry element gets one).
  detailList.querySelectorAll<HTMLDivElement>(".entry").forEach((el) => {
    el.addEventListener("click", async (ev) => {
      ev.stopPropagation();   // don't bubble to the empty-area handler
      const cid = el.dataset.cid ?? "";
      if (!cid) return;
      await toggleReplayForCid(cid);
    });
  });
}

// Render either a SOLO entry or a COLLECTIVE block of N members.
// Collective is rendered with the SAME `.entry` chrome as a solo
// entry (so the existing `.entry` click-to-replay handler picks it
// up automatically), with a `.member-strip` body showing each
// member as its own pill instead of a single dice formula. No
// aggregate total — per the user's design call, each token's roll
// stands on its own.
function renderHistoryBlock(cid: string, members: HistoryEntry[]): string {
  if (members.length === 1) return renderSingleEntry(members[0]);
  const head = members[0];
  const ago = formatAgo(Date.now() - head.ts);
  const cls = ["entry", "coll-entry"];
  if (cid === activeReplayCid) cls.push("replay-on");
  if (head.hidden) cls.push("hidden-roll");
  // Crit/fail tint on the parent box if any member nat-20'd / nat-1'd
  // — crit wins over fail to match the solo entry rule.
  const hasCrit = members.some((m) =>
    m.dice.some((d) => !d.loser && d.type === "d20" && d.value === 20),
  );
  const hasFail = members.some((m) =>
    m.dice.some((d) => !d.loser && d.type === "d20" && d.value === 1),
  );
  if (hasCrit) cls.push("crit");
  else if (hasFail) cls.push("fail");
  const darkTag = head.hidden ? `<span class="dark-tag">${tt("diceHistDarkTag")}</span>` : "";
  const collTag = `<span class="coll-tag">${tt("diceHistColl")} ${members.length}</span>`;
  const labelOrName = escapeHtml(head.label || head.rollerName);
  return `
    <div class="${cls.join(" ")}" data-cid="${escapeHtml(cid)}" style="--player-color:${head.rollerColor}">
      <div class="body">
        <div class="line1">
          <span class="player">${darkTag}${collTag}${labelOrName}</span>
          <span class="ago">${ago}</span>
        </div>
        ${buildMemberStripHtml(members)}
      </div>
    </div>
  `;
}

function renderSingleEntry(h: HistoryEntry): string {
  const cid = h.collectiveId ?? h.rollId;
  return renderEntryRow(h, cid, /* tight */ false);
}

function renderEntryRow(h: HistoryEntry, cid: string, tight: boolean): string {
  const ago = formatAgo(Date.now() - h.ts);
  const cls = ["entry"];
  if (tight) cls.push("entry-tight");
  const kept = h.dice.filter((d) => !d.loser);
  if (kept.some((d) => d.type === "d20" && d.value === 20)) cls.push("crit");
  if (kept.some((d) => d.type === "d20" && d.value === 1)) cls.push("fail");
  if (h.hidden && !tight) cls.push("hidden-roll");
  if (cid === activeReplayCid && !tight) cls.push("replay-on");
  // Repeat-mode entries in the DETAIL view render as a flow strip
  // (horizontal wrap), matching the latest-per-player popover row.
  // Per the user's clarification: only the floating tooltip (which
  // appears at the player's head when an entry is clicked — see
  // `replay-page.ts`) uses the vertical-stack variant. Both the
  // popover row AND the detail view stay in flow so the user can
  // scan many rolls at once.
  //
  // `showLabel = false`: the entry's `.player` line already shows
  // `h.label || h.rollerName` as the title, so duplicating the
  // label inside the formula as italic grey small-text is just
  // visual noise. The popover row keeps `showLabel = true` because
  // its title is the roller's name, never the label.
  const isRepeat = (h.rowStarts?.length ?? 0) > 1;
  const body = isRepeat
    ? buildRepeatStripHtml(h, "flow")
    : `<div class="formula">${buildFormula(h, /* showLabel */ false)}</div>`;
  return `
    <div class="${cls.join(" ")}" data-cid="${escapeHtml(cid)}" style="--player-color:${h.rollerColor}">
      <div class="body">
        <div class="line1">
          <span class="player">${h.hidden && !tight ? `<span class="dark-tag">${tt("diceHistDarkTag")}</span>` : ""}${escapeHtml(h.label || h.rollerName)}</span>
          <span class="ago">${ago}</span>
        </div>
        ${body}
      </div>
    </div>
  `;
}

async function toggleReplayForCid(cid: string): Promise<void> {
  if (activeReplayCid === cid) {
    try {
      await Promise.all([
        OBR.broadcast.sendMessage(BC_DICE_REPLAY, { cid, action: "close" }, { destination: "LOCAL" }),
        OBR.broadcast.sendMessage(BC_DICE_REPLAY, { cid, action: "close" }, { destination: "REMOTE" }),
      ]);
    } catch {}
    activeReplayCid = null;
    try { localStorage.removeItem("obr-suite/dice/active-replay-cid"); } catch {}
    renderDetail();
    return;
  }
  // Camera focus locally on the involved tokens (don't move other
  // players' cameras). Build a synthetic group for the focus helper.
  const members = history.filter((h) => (h.collectiveId ?? h.rollId) === cid);
  if (members.length) {
    const head = members[0];
    await focusCameraOnGroup({ cid, head, members });
  }
  // 2026-05-09 — was sending "toggle" which is ambiguous when the
  // receiver's local state and the sender's diverged (e.g. user clicked
  // a row in the panel, history popover never got a state update,
  // user then clicks in history popover → both flip but in opposite
  // directions → state ping-pong). Use explicit "open" so every
  // receiver lands in the same explicit state without inference.
  //
  // 2026-05-10: also broadcast `BC_PANEL_TOGGLE { open: true }` so
  // the dice action panel auto-opens if it was closed when the user
  // clicked a row here. AND stash the active cid in localStorage so
  // the dice action panel — which mounts AFTER the broadcast can no
  // longer reach it — restores the highlight on its own init.
  try { localStorage.setItem("obr-suite/dice/active-replay-cid", cid); } catch {}
  // 2026-05-10: also stash a "pending show history" flag so the dice
  // action panel — which mounts AFTER our BC_PANEL_TOGGLE arrives —
  // knows to switch to the history tab on init. Without this, the
  // panel would default to the "roll" tab even though we're trying
  // to focus a specific history row.
  try { localStorage.setItem("obr-suite/dice/pending-show-history", "1"); } catch {}
  try {
    await Promise.all([
      OBR.broadcast.sendMessage(BC_DICE_REPLAY, { cid, action: "open" }, { destination: "LOCAL" }),
      OBR.broadcast.sendMessage(BC_DICE_REPLAY, { cid, action: "open" }, { destination: "REMOTE" }),
      OBR.broadcast.sendMessage(
        "com.obr-suite/dice-panel-toggle",
        { open: true },
        { destination: "LOCAL" },
      ),
    ]);
  } catch {}
  activeReplayCid = cid;
  renderDetail();
}

async function clearActiveReplay(): Promise<void> {
  if (!activeReplayCid) return;
  const cid = activeReplayCid;
  activeReplayCid = null;
  try {
    await Promise.all([
      OBR.broadcast.sendMessage(BC_DICE_REPLAY, { cid, action: "close" }, { destination: "LOCAL" }),
      OBR.broadcast.sendMessage(BC_DICE_REPLAY, { cid, action: "close" }, { destination: "REMOTE" }),
    ]);
  } catch {}
  renderDetail();
}

// Heuristic: a roll is "from a DM" if THIS client is the DM and the
// rollerId matches the DM's id, OR if the entry's hidden flag was
// set (only DMs can dark-roll). For other players' rolls received
// over REMOTE we don't actually know their role from the payload, so
// we err on showing "DM" only for the local DM's own entries.
function myRoleIsDM(entry: HistoryEntry): boolean {
  return myRole === "GM" && entry.rollerId === myPlayerId;
}

let myPlayerId = "";

// (Removed — row click now opens the in-popover detail view instead
// of bouncing to the dice panel's history tab.)

OBR.onReady(async () => {
  installDebugOverlay();
  // Rebuild the LS key with the actual room id and reload history
  // from THIS room's slice. Skipping this step (or running it after
  // the first render) leaks yesterday's "default"-suffixed entries
  // into the new room.
  try {
    const rid = (OBR.room?.id as string | undefined) ?? "";
    LS_HISTORY = `${LS_HISTORY_BASE}:${safeRoomKey(rid)}`;
    history = loadHistory();
    render();
  } catch {}
  try {
    const role = await OBR.player.getRole();
    myRole = role === "GM" ? "GM" : "PLAYER";
    myPlayerId = await OBR.player.getId();
  } catch {}

  // Drag grip in the title bar — releases broadcast to dice/index.ts
  // which re-issues OBR.popover.open() with the new offset.
  const dragHandle = document.getElementById("drag-handle");
  if (dragHandle) bindPanelDrag(dragHandle, PANEL_IDS.diceHistory);

  // X button — dismiss the popover for this session, BUT keep the
  // cluster's "投骰记录" toggle on so the next dice roll auto-reopens
  // it. Background module owns this via BC_DICE_HISTORY_DISMISS.
  document.getElementById("btnDismiss")?.addEventListener("click", () => {
    try {
      OBR.broadcast.sendMessage(
        "com.obr-suite/dice-history-dismiss",
        {},
        { destination: "LOCAL" },
      );
    } catch {}
  });

  // Live dice-roll broadcasts → queue as PENDING. Visible entry only
  // appears when the matching BC_DICE_HISTORY_REVEAL arrives (at the
  // end of the fly-to-history animation). Dark rolls are sent
  // LOCAL-only so non-DM clients never receive them.
  OBR.broadcast.onMessage(BROADCAST_DICE_ROLL, (event) => {
    const data = event.data as HistoryEntry | undefined;
    if (!data || !Array.isArray(data.dice) || !data.rollId) return;
    // Stash. Fallback timer: if the reveal never arrives (effect
    // modal crashed / cancelled), commit anyway after PENDING_TIMEOUT_MS.
    const timer = window.setTimeout(() => commitPending(data.rollId), PENDING_TIMEOUT_MS);
    pendingEntries.set(data.rollId, { entry: data, timer });
  });

  // Reveal — commit the matching pending entry so it appears in the
  // visible history list now.
  OBR.broadcast.onMessage(BC_DICE_HISTORY_REVEAL, (event) => {
    const data = event.data as { rollId?: string } | undefined;
    if (!data?.rollId) return;
    commitPending(data.rollId);
  });

  // Back button — close detail (and any active replay).
  detailBack.addEventListener("click", () => closeDetail());

  // Click on the empty area of the detail-list (not on an entry) →
  // dismiss the active replay. This is "click outside the bubble to
  // deselect" — the user explicitly asked for it. We attach to
  // detailList so clicks on the list background bubble up here, and
  // entry click handlers stopPropagation to avoid this branch.
  detailList.addEventListener("click", () => {
    clearActiveReplay().catch(() => {});
  });

  // Replay state events from other iframes (panel-page click,
  // replay-page bubble click, BG kicking the overlay). Use explicit
  // "open" / "close" actions so this iframe's `activeReplayCid`
  // reflects the source's intended state without inference.
  OBR.broadcast.onMessage(BC_DICE_REPLAY, (event) => {
    const data = event.data as { cid?: string; action?: string } | undefined;
    if (!data?.cid) return;
    if (data.action === "close") {
      if (activeReplayCid === data.cid) {
        activeReplayCid = null;
        render();
      }
      return;
    }
    if (data.action === "open") {
      if (activeReplayCid !== data.cid) {
        activeReplayCid = data.cid;
        render();
      }
      return;
    }
    // Legacy "toggle" path (older clients) — preserved as-is.
    if (activeReplayCid && activeReplayCid !== data.cid) {
      activeReplayCid = data.cid;
      render();
    }
  });

  // Mount-time: just paint the current history. There's no transient
  // window to seed any more — the popover stays open until the user
  // clicks the X-dismiss button or clicks a row.
  applyI18nDom(lang);
  render();
});

onLangChange((next) => {
  lang = next;
  applyI18nDom(lang);
  render();
  if (detailRollerKey) renderDetail();
});

// Refresh ago labels every 30s so "刚刚" turns into "1m" without a
// re-roll. Refresh detail too if it's open.
setInterval(() => {
  render();
  if (detailRollerKey) renderDetail();
}, 30_000);

// Cross-tab refresh: when the dice-panel modifies localStorage (e.g.
// clearing history), update this view too.
window.addEventListener("storage", (e) => {
  if (e.key !== LS_HISTORY) return;
  history = loadHistory();
  render();
});
