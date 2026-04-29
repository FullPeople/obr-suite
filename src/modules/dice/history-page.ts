import OBR from "@owlbear-rodeo/sdk";
import { DieResult, sidesOf } from "./types";
import { applyI18nDom, t } from "../../i18n";
import { getLocalLang, onLangChange } from "../../state";

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

const LS_HISTORY = "obr-suite/dice/history";
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
}

// Currently-active replay's collective-id (LOCAL state — set when this
// client clicks a row, cleared when the replay closes). Used so we
// can render the active row with a "lit up" border and so a second
// click on the same row sends a CLOSE broadcast.
let activeReplayCid: string | null = null;

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
const headHint = document.getElementById("headHint") as HTMLSpanElement;
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
    parts.push(
      `<span class="die-chip ${cls}">` +
      `<img src="/suite/${imgFor(d.type)}.png" alt="${escapeHtml(d.type)}" draggable="false">` +
      `<span>${d.value}</span>` +
      `</span>`,
    );
  }
  return parts.join("");
}
function buildFormula(entry: HistoryEntry): string {
  const chips = chipsHtml(entry.dice);
  let modStr = "";
  if (entry.modifier !== 0) {
    modStr = `<span class="mod">${entry.modifier > 0 ? `+${entry.modifier}` : entry.modifier}</span>`;
  }
  const labelStr = entry.label
    ? `<span class="label-tag">${escapeHtml(entry.label)}</span>`
    : "";
  const list = `<div class="dice-list">${chips}${modStr}${labelStr}<span class="eq">=</span></div>`;
  const total = `<span class="total">${entry.total}</span>`;
  return list + total;
}

// Aggregated formula for the collective-roll popover row. Concatenates
// every member's dice into one wrap-friendly chip strip and shows the
// sum-of-totals on the right. Modifiers are intentionally NOT shown
// separately — each member's modifier is already baked into its
// per-row total, so summing the totals gives the correct value
// without the visual noise of "+5+5+5+5" stacking up.
function buildFormulaForGroup(members: HistoryEntry[]): string {
  const allDice: DieResult[] = [];
  let totalSum = 0;
  for (const m of members) {
    for (const d of m.dice) allDice.push(d);
    totalSum += m.total;
  }
  const chips = chipsHtml(allDice);
  // Pull the head's label (if any) so labels like "命中" / "敏捷豁免"
  // still show, but suppress per-member labels (would just repeat).
  const head = members[0];
  const labelStr = head?.label
    ? `<span class="label-tag">${escapeHtml(head.label)}</span>`
    : "";
  const list = `<div class="dice-list">${chips}${labelStr}<span class="eq">∑</span></div>`;
  const total = `<span class="total coll-sum-total">${totalSum}</span>`;
  return list + total;
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

// Latest-per-player view, with collective rolls collapsed into ONE
// row each. When a player has both solo rolls AND collective rolls,
// only their MOST RECENT roll (whichever it was) is shown.
function latestPerPlayer(): GroupedRow[] {
  // Build a map of cid → all entries (for collective grouping).
  const byCid = new Map<string, HistoryEntry[]>();
  for (const h of history) {
    const cid = h.collectiveId ?? h.rollId;
    const arr = byCid.get(cid) ?? [];
    arr.push(h);
    byCid.set(cid, arr);
  }
  const seen = new Set<string>();
  const out: GroupedRow[] = [];
  for (const h of history) {
    const playerKey = h.rollerId || h.rollerName || "?";
    if (seen.has(playerKey)) continue;
    seen.add(playerKey);
    const cid = h.collectiveId ?? h.rollId;
    const members = byCid.get(cid) ?? [h];
    out.push({ cid, head: h, members });
  }
  return out;
}

function render(): void {
  const rows = latestPerPlayer();
  if (!rows.length) {
    rowsEl.innerHTML = `<div class="empty">${tt("diceHistEmpty")}</div>`;
    headHint.textContent = "";
    return;
  }
  headHint.textContent = lang === "zh" ? `${rows.length} 位` : `${rows.length}`;
  rowsEl.innerHTML = rows.map((g) => {
    const h = g.head;
    const isCollective = g.members.length > 1;
    const dmTag = h.rollerId && myRoleIsDM(h) ? `<span class="dm-tag">DM</span>` : "";
    const darkTag = h.hidden ? `<span class="dark-tag">${tt("diceHistDarkTag")}</span>` : "";
    const collTag = isCollective ? `<span class="coll-tag">${tt("diceHistColl")} ${g.members.length}</span>` : "";
    const rowCls = ["row"];
    if (h.hidden) rowCls.push("hidden-roll");
    // Collective row aggregates every member's dice into one wrap-
    // friendly chip strip with the sum total on the right. Solo rolls
    // use the per-entry formula as before.
    const formulaHtml = isCollective ? buildFormulaForGroup(g.members) : buildFormula(h);
    return `
      <div class="${rowCls.join(" ")}" data-roller="${escapeHtml(h.rollerName)}" data-rollerid="${escapeHtml(h.rollerId)}">
        <div class="swatch" style="--player-color:${h.rollerColor}"></div>
        <div class="body">
          <div class="line1">
            <span class="player">${dmTag}${darkTag}${collTag}${escapeHtml(h.rollerName)}</span>
            <span class="ago">${formatAgo(Date.now() - h.ts)}</span>
          </div>
          <div class="formula">${formulaHtml}</div>
        </div>
      </div>
    `;
  }).join("");

  rowsEl.querySelectorAll<HTMLDivElement>(".row").forEach((row) => {
    row.addEventListener("click", () => {
      const playerName = row.dataset.roller ?? "";
      const rollerId = row.dataset.rollerid ?? "";
      // Slide in the detail view for this player. The replay overlay
      // is triggered later — only by clicking a SPECIFIC entry inside
      // the detail view (not by clicking the player row itself).
      openDetail(rollerId || playerName, playerName);
    });
  });
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
function openDetail(rollerKey: string, playerName: string): void {
  detailRollerKey = rollerKey;
  renderDetail();
  detailEl.classList.add("on");
  rowsEl.classList.add("shifted");
  detailList.scrollTop = 0;
}

function closeDetail(): void {
  // Going back to the main list also dismisses any active replay
  // (the replay only makes sense in detail context).
  clearActiveReplay().catch(() => {});
  detailEl.classList.remove("on");
  rowsEl.classList.remove("shifted");
  setTimeout(() => { detailRollerKey = null; }, 350);
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
// Collective members live in a tight container with shared border
// + a header strip showing "集体 N · 总和 X".
function renderHistoryBlock(cid: string, members: HistoryEntry[]): string {
  if (members.length === 1) return renderSingleEntry(members[0]);
  const head = members[0];
  const totalSum = members.reduce((a, m) => a + (m.total ?? 0), 0);
  const containerCls = ["coll-box"];
  if (cid === activeReplayCid) containerCls.push("replay-on");
  if (head.hidden) containerCls.push("hidden-roll");
  return `
    <div class="${containerCls.join(" ")}" style="--player-color:${head.rollerColor}">
      <div class="coll-head">
        <span class="coll-tag">${tt("diceHistColl")} ${members.length}</span>
        <span class="coll-label">${escapeHtml(head.label || "")}</span>
        <span class="coll-sum">∑ ${totalSum}</span>
      </div>
      <div class="coll-members">
        ${members.map((m) => renderEntryRow(m, cid, /* tight */ true)).join("")}
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
  return `
    <div class="${cls.join(" ")}" data-cid="${escapeHtml(cid)}" style="--player-color:${h.rollerColor}">
      <div class="body">
        <div class="line1">
          <span class="player">${h.hidden && !tight ? `<span class="dark-tag">${tt("diceHistDarkTag")}</span>` : ""}${escapeHtml(h.label || h.rollerName)}</span>
          <span class="ago">${ago}</span>
        </div>
        <div class="formula">${buildFormula(h)}</div>
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
  try {
    await Promise.all([
      OBR.broadcast.sendMessage(BC_DICE_REPLAY, { cid, action: "toggle" }, { destination: "LOCAL" }),
      OBR.broadcast.sendMessage(BC_DICE_REPLAY, { cid, action: "toggle" }, { destination: "REMOTE" }),
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
  try {
    const role = await OBR.player.getRole();
    myRole = role === "GM" ? "GM" : "PLAYER";
    myPlayerId = await OBR.player.getId();
  } catch {}

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

  // Replay close events (from another client clicking close, or from
  // the overlay's bubble-click). Sync local active state so the row
  // border de-highlights.
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
    // toggle: if same cid → opening was already done by us OR by
    // another client; if different, this client's active state may
    // need to clear (overlay was closed by background to make room).
    if (activeReplayCid && activeReplayCid !== data.cid) {
      activeReplayCid = data.cid;
      render();
    }
  });

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
