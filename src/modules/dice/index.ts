import OBR from "@owlbear-rodeo/sdk";
import { DiceType, DIE_SIDES, DieResult, rollDie, sidesOf } from "./types";
import { assetUrl } from "../../asset-base";
import { onViewportResize } from "../../utils/viewportAnchor";
import {
  PANEL_IDS,
  getPanelOffset,
  getPanelSize,
  registerPanelBbox,
  BC_PANEL_DRAG_END,
  BC_PANEL_RESET,
  BC_PANEL_SIDE_HINT,
  computePanelBbox,
  type DragEndPayload,
} from "../../utils/panelLayout";

// Dice module — independent feature with two halves:
//
//   1. Visual: BROADCAST_DICE_ROLL → fullscreen modal (effect-page.ts)
//      that shows every die tumbling in, slot-machine numbers, etc.
//      Driven by the broadcast channel — every client renders its own
//      copy. Uses OBR.modal with `disablePointerEvents:true` so the
//      visual is fully click-through.
//
//   2. UI: A left-rail OBR Tool ("Dice"). Click the tool → opens a
//      popover panel (dice-panel.html) where the player composes a
//      roll (multiple dice + modifier + label), saves combos, and
//      reviews history. The panel emits the SAME BROADCAST_DICE_ROLL
//      so other modules (incl. this module's own visual half) react.
//
// Initiative still uses the broadcast directly (no panel) — see
// useInitiative.ts.

export const BROADCAST_DICE_ROLL = "com.obr-suite/dice-roll";
// Force-clear: panel's big red "强制结束" button. Every open effect
// modal listens and closes itself.
export const BC_DICE_FORCE_CLEAR = "com.obr-suite/dice-force-clear";
// Clear-all: panel's "清除" button. Each effect modal checks the
// broadcast's rollerId — if it matches their own roller, they fade
// out and close. So a clear from player A only kills A's own dice.
export const BC_DICE_CLEAR_ALL = "com.obr-suite/dice-clear-all";

// Effect modal (the in-flight dice visual)
const MODAL_PREFIX = "com.obr-suite/dice-effect-";
const EFFECT_URL = assetUrl("dice-effect.html");

// Dice panel popover (OBR manifest v1 doesn't accept a custom action
// The dice panel is the OBR action popover (manifest.json declares
// `action.popover` → dice-panel.html). We open/close it via
// `OBR.action.open()` / `close()`. The cluster's dice button + history
// row + right-click "添加到骰盘" all broadcast BC_PANEL_TOGGLE.
const BC_PANEL_TOGGLE = "com.obr-suite/dice-panel-toggle";

// Dice history popover — anchored to the BOTTOM-RIGHT, above its
// dedicated trigger button. Click the trigger to toggle. Per-player
// rows show last roll; click a row to jump the dice panel to History
// tab + filter. Background is transparent (the iframe HTML drops the
// title bar + frame so it reads as floating cards).
const HISTORY_POPOVER_ID = "com.obr-suite/dice-history";
const HISTORY_URL = assetUrl("dice-history.html");
const HISTORY_W = 320;
const HISTORY_H = 360;
// Trigger button geometry — bottom-right, mirror of the cluster
// trigger at bottom-left. Inset slightly so it doesn't overlap OBR's
// own bottom-right button.
const HISTORY_TRIGGER_POPOVER_ID = "com.obr-suite/dice-history-trigger";
const HISTORY_TRIGGER_URL = assetUrl("dice-history-trigger.html");
// Trigger iframe is 92×64 — wider than the 48×48 d20 button so the
// drag-grip can sit inside the iframe rect (anything outside is
// clipped by OBR). Mirrors the cluster-trigger sizing.
const HISTORY_TRIGGER_W = 92;
const HISTORY_TRIGGER_H = 64;
// Trigger sits 75px from the right edge (15px further left than the
// cluster trigger's mirror position). 5px bottom inset matches OBR's
// internal popover margin so the drag-preview ghost lands on the
// trigger's actual rendered position instead of the unclamped one.
const HISTORY_TRIGGER_RIGHT_OFFSET = 75;
const HISTORY_TRIGGER_BOTTOM_OFFSET = 5;
// History popover sits 5px in from the RIGHT viewport edge (was flush
// against the edge — OBR was nudging it inward at render time, which
// caused drag-preview / final-position mismatch).
const HISTORY_RIGHT_OFFSET = 5;
const HISTORY_GAP = 4;
// Trigger broadcasts its open-state so the trigger button can light
// up while the history popover is visible.
const BC_DICE_HISTORY_STATE = "com.obr-suite/dice-history-state";

// Quick-roll channel — any iframe (search, bestiary, character cards,
// 5etools-tag click handlers) can fire `BC_QUICK_ROLL` with a simple
// payload to trigger a roll. The background module parses the
// expression, rolls, broadcasts via the normal pipeline.
const BC_QUICK_ROLL = "com.obr-suite/dice-quick-roll";
// Sent by the dice-history popover's X button. Closes the popover
// WITHOUT touching the cluster's "投骰记录" toggle state — so the
// next dice roll re-opens it. The cluster toggle is the only thing
// that can permanently disable the popover.
const BC_DICE_HISTORY_DISMISS = "com.obr-suite/dice-history-dismiss";
// "Add to dice tray" shortcut. Right-click context menu → 添加到骰盘
// sends BC_PANEL_TOGGLE { open: true, prefill } and the background
// module then broadcasts BC_DICE_PANEL_FILL to the panel iframe.
export const BC_DICE_PANEL_FILL = "com.obr-suite/dice-panel-fill";
// History-popover toggle. Cluster's "投骰记录" toggle button broadcasts
// this; the dice background opens / closes the bottom-left popover
// accordingly. Per-client preference stored in localStorage.
const BC_DICE_HISTORY_TOGGLE = "com.obr-suite/dice-history-toggle";
const LS_AUTO_DICE_HISTORY = "com.obr-suite/dice-history-on";
// Auto-close request from the iframe — fires when its transient row
// list empties out (every recent entry has timed out). We close the
// popover but DON'T flip the LS flag — the next dice roll auto-opens
// it again in transient mode.
const BC_DICE_HISTORY_AUTO_CLOSE = "com.obr-suite/dice-history-auto-close";

// Replay overlay channel. The history popover broadcasts a toggle
// when a row is clicked; every client opens / closes the replay
// modal accordingly. The replay modal renders compact dice bubbles
// above each token participating in the collective roll.
const BC_DICE_REPLAY = "com.obr-suite/dice-replay";
const REPLAY_MODAL_PREFIX = "com.obr-suite/dice-replay-";
const REPLAY_URL = assetUrl("dice-replay.html");
export interface QuickRollRequest {
  // Plain dice expression: "1d20+5", "2d6+3", "1d4+1d6+2", etc. Only
  // simple sums of NdM terms + integer modifier are supported here —
  // for full adv/dis/max/burst/etc. expression syntax the user should
  // use the dice panel. The `advMode` flag below is a SHORTCUT for the
  // common "click to roll with advantage" right-click flow: every d20
  // in the parsed expression rolls twice and the loser is marked.
  expression: string;
  // Optional human-readable label shown above the dice (e.g. "命中",
  // "敏捷豁免", weapon name).
  label?: string;
  // Optional token to anchor the dice on. If null/undefined, dice
  // anchor on the viewport center.
  itemId?: string | null;
  // Dark roll — DM-only visibility (LOCAL broadcast, no REMOTE).
  hidden?: boolean;
  // If true, the camera focuses on the itemId before the roll fires.
  focus?: boolean;
  // Optional collective-id (multi-target roll grouping).
  collectiveId?: string;
  // Right-click "优势 / 劣势" shortcut. When set, every d20 in the
  // expression rolls TWICE; the higher (adv) / lower (dis) is kept and
  // the other is flagged loser. Other dice (d4/d6/...) roll once.
  advMode?: "adv" | "dis";
}

// --- Broadcast payload schema (extended for multi-type dice) ---
//
// Backwards compat: older `rolls: number[]`-shape payloads (pre-panel
// era) are coerced into the new dice-array shape on receive, treating
// every entry as a d20 face.
export interface DiceRollPayload {
  itemId: string | null;
  dice: DieResult[];        // every die rolled, with type + face value
  winnerIdx: number;        // -1 = no specific winner (panel rolls)
  modifier: number;
  label: string;
  total: number;            // sum of dice values + modifier (cached)
  rollerId: string;
  rollerName: string;
  rollerColor: string;
  rollId: string;
  ts: number;
  // Dark roll — DM-only visibility. Sender broadcasts LOCAL-only so
  // players never receive it; receiver renders it at lower opacity to
  // visually denote "hidden from players".
  hidden?: boolean;
  // Auto-dismiss — the effect modal self-closes shortly after the
  // climax (single-die punch, or final scale-pop in the rush path).
  // Used by initiative rolls so they don't linger on the canvas.
  // Panel rolls leave it false so they remain visible until the user
  // clicks Clear.
  autoDismiss?: boolean;
  // Layout / animation hints (also propagated through the URL params
  // to effect-page.ts). See panel-page.ts for the source of truth on
  // semantics.
  rowStarts?: number[];
  sameHighlight?: boolean;
  // Collective-roll grouping. Multi-target rolls assign the SAME
  // collectiveId to every emitted broadcast; the history popover
  // groups them into one row, and the click-to-replay feature uses
  // the id to find every member of the group.
  collectiveId?: string;
}

// Legacy payload shape for tolerant decoding.
interface LegacyDiceRollPayload {
  itemId?: string | null;
  rolls?: number[];
  value?: number;
  winnerIdx?: number;
  rollerId?: string;
  rollerColor?: string;
  rollId?: string;
}

const unsubs: Array<() => void> = [];

// The dice panel lives ONLY in the OBR action popover (top-left
// d20 button, declared via manifest.json `action.popover`). Earlier
// we also exposed it as an OBR.popover so cluster + 添加到骰盘 could
// open it, but having two co-existing panels was confusing — the user
// asked us to nuke the popover route and route everything through
// `OBR.action.open()` instead.
async function openActionPanel(): Promise<void> {
  try { await OBR.action.open(); } catch (e) {
    console.error("[obr-suite/dice] open action panel failed", e);
  }
}
async function closeActionPanel(): Promise<void> {
  try { await OBR.action.close(); } catch {}
}

let historyOpen = false;
let historyTriggerOpen = false;
// User dismissed the popover via its X button without flipping the
// cluster toggle. Stays true until either (a) a new dice roll arrives
// (auto-reopen) or (b) the cluster toggle is operated (explicit signal).
let historyManuallyDismissed = false;

// Dice-history bbox provider — hugs the RIGHT viewport edge, sits
// above the trigger. Always returns expected bbox so the layout
// editor can show a proxy even while the popover is closed.
registerPanelBbox(PANEL_IDS.diceHistory, async () => {
  try {
    const [vw, vh] = await Promise.all([
      OBR.viewport.getWidth(),
      OBR.viewport.getHeight(),
    ]);
    const userOff = getPanelOffset(PANEL_IDS.diceHistory);
    const sizeOverride = getPanelSize(PANEL_IDS.diceHistory);
    const w = sizeOverride?.width ?? HISTORY_W;
    const h = sizeOverride?.height ?? HISTORY_H;
    const right = HISTORY_RIGHT_OFFSET - userOff.dx;
    const bottom =
      HISTORY_TRIGGER_BOTTOM_OFFSET + HISTORY_TRIGGER_H + HISTORY_GAP - userOff.dy;
    return {
      left: vw - right - w,
      top: vh - bottom - h,
      width: w,
      height: h,
    };
  } catch { return null; }
});

async function emitSideHint(panelId: string): Promise<"left" | "right"> {
  let side: "left" | "right" = "right";
  try {
    const [bbox, vw] = await Promise.all([
      computePanelBbox(panelId),
      OBR.viewport.getWidth(),
    ]);
    if (bbox && Number.isFinite(vw) && vw > 0) {
      const center = bbox.left + bbox.width / 2;
      side = center < vw / 2 ? "right" : "left";
    }
  } catch {}
  try {
    OBR.broadcast.sendMessage(
      BC_PANEL_SIDE_HINT,
      { panelId, side },
      { destination: "LOCAL" },
    );
  } catch {}
  return side;
}

async function openHistoryTrigger(): Promise<void> {
  try {
    const [vw, vh] = await Promise.all([
      OBR.viewport.getWidth(),
      OBR.viewport.getHeight(),
    ]);
    const userOff = getPanelOffset(PANEL_IDS.diceHistoryTrigger);
    const side = await emitSideHint(PANEL_IDS.diceHistoryTrigger);
    await OBR.popover.open({
      id: HISTORY_TRIGGER_POPOVER_ID,
      url: `${HISTORY_TRIGGER_URL}?side=${side}`,
      width: HISTORY_TRIGGER_W,
      height: HISTORY_TRIGGER_H,
      anchorReference: "POSITION",
      anchorPosition: {
        left: vw - HISTORY_TRIGGER_RIGHT_OFFSET + userOff.dx,
        top: vh - HISTORY_TRIGGER_BOTTOM_OFFSET + userOff.dy,
      },
      anchorOrigin: { horizontal: "RIGHT", vertical: "BOTTOM" },
      transformOrigin: { horizontal: "RIGHT", vertical: "BOTTOM" },
      hidePaper: true,
      disableClickAway: true,
    });
    historyTriggerOpen = true;
  } catch (e) {
    console.error("[obr-suite/dice] open history trigger failed", e);
  }
}

async function closeHistoryTrigger(): Promise<void> {
  try { await OBR.popover.close(HISTORY_TRIGGER_POPOVER_ID); } catch {}
  historyTriggerOpen = false;
}

function broadcastHistoryState(open: boolean): void {
  try {
    OBR.broadcast.sendMessage(
      BC_DICE_HISTORY_STATE,
      { open },
      { destination: "LOCAL" },
    );
  } catch {}
}

async function openHistory(mode: "transient" | "all" = "transient"): Promise<void> {
  // Re-entrancy: re-anchor on viewport resize / drag-end / reset all
  // call this with `historyOpen=true` already, expecting the function
  // to update the popover in place. Don't bail on already-open.
  try {
    const [vw, vh] = await Promise.all([
      OBR.viewport.getWidth(),
      OBR.viewport.getHeight(),
    ]);
    const userOff = getPanelOffset(PANEL_IDS.diceHistory);
    const sizeOverride = getPanelSize(PANEL_IDS.diceHistory);
    const w = sizeOverride?.width ?? HISTORY_W;
    const h = sizeOverride?.height ?? HISTORY_H;
    // History popover sits ABOVE the trigger, but HUGS the RIGHT
    // viewport edge (independent of trigger's horizontal offset).
    //
    // DY SIGN: with anchorOrigin=BOTTOM, anchorTop is where the
    // popover's BOTTOM edge sits. Positive `userOff.dy` (user drag
    // DOWN) should make the popover MOVE DOWN, i.e. its bottom edge
    // gets closer to viewport bottom, i.e. the bottom-offset
    // shrinks. So we SUBTRACT dy from the bottom-offset constant
    // (matching the bbox provider's convention). Was using `+ dy`
    // which inverted the direction — drag-down would move the panel
    // up and vice versa, eventually pinning it against the opposite
    // edge of the viewport.
    const anchorRight = vw - HISTORY_RIGHT_OFFSET + userOff.dx;
    const triggerBottom = HISTORY_TRIGGER_BOTTOM_OFFSET - userOff.dy;
    const anchorTop = vh - (triggerBottom + HISTORY_TRIGGER_H + HISTORY_GAP);
    await emitSideHint(PANEL_IDS.diceHistory);
    await OBR.popover.open({
      id: HISTORY_POPOVER_ID,
      url: `${HISTORY_URL}?mode=${mode}`,
      width: w,
      height: h,
      anchorReference: "POSITION",
      anchorPosition: { left: anchorRight, top: anchorTop },
      anchorOrigin: { horizontal: "RIGHT", vertical: "BOTTOM" },
      transformOrigin: { horizontal: "RIGHT", vertical: "BOTTOM" },
      hidePaper: true,
      disableClickAway: true,
    });
    historyOpen = true;
    broadcastHistoryState(true);
  } catch (e) {
    console.error("[obr-suite/dice] open history failed", e);
  }
}
async function closeHistory(): Promise<void> {
  try { await OBR.popover.close(HISTORY_POPOVER_ID); } catch {}
  historyOpen = false;
  broadcastHistoryState(false);
}
function isHistoryAutoOn(): boolean {
  // Default ON. The toggle stores "1" / "0" in localStorage; missing
  // value is treated as on so first-time users see the popover.
  try {
    return localStorage.getItem(LS_AUTO_DICE_HISTORY) !== "0";
  } catch {
    return true;
  }
}

// --- Replay overlay state ---
let activeReplayCid: string | null = null;
async function openReplay(cid: string): Promise<void> {
  if (activeReplayCid) await closeReplay();
  activeReplayCid = cid;
  const modalId = `${REPLAY_MODAL_PREFIX}${cid}`;
  try {
    try { await OBR.modal.close(modalId); } catch {}
    await OBR.modal.open({
      id: modalId,
      url: `${REPLAY_URL}?cid=${encodeURIComponent(cid)}`,
      fullScreen: true,
      hideBackdrop: true,
      hidePaper: true,
      // Keep canvas interactive — players still need to be able to
      // pan/zoom/select while the overlay is up. Each bubble's own
      // pointer-events:auto re-enables clicks on the bubble alone.
      disablePointerEvents: true,
    });
  } catch (e) {
    console.error("[obr-suite/dice] open replay failed", e);
    activeReplayCid = null;
  }
}
async function closeReplay(): Promise<void> {
  if (!activeReplayCid) return;
  const modalId = `${REPLAY_MODAL_PREFIX}${activeReplayCid}`;
  try { await OBR.modal.close(modalId); } catch {}
  activeReplayCid = null;
}

// --- Token / world coords helpers (unchanged from earlier revisions) ---

async function tokenTopWorld(itemId: string): Promise<{ x: number; y: number } | null> {
  try {
    const items = await OBR.scene.items.getItems([itemId]);
    if (!items.length) return null;
    const item = items[0] as any;
    let halfHeight = 75;
    try {
      const sceneDpi = await OBR.scene.grid.getDpi();
      const img = item.image;
      const itemGridDpi = item.grid?.dpi;
      const scaleY = item.scale?.y ?? 1;
      if (img?.height && itemGridDpi && sceneDpi) {
        halfHeight = (img.height / itemGridDpi) * sceneDpi * scaleY / 2;
      } else if (sceneDpi) {
        halfHeight = sceneDpi / 2;
      }
    } catch {}
    return { x: item.position.x, y: item.position.y - halfHeight };
  } catch {
    return null;
  }
}

async function viewportCenterWorld(): Promise<{ x: number; y: number }> {
  const [vp, scale, vw, vh] = await Promise.all([
    OBR.viewport.getPosition(),
    OBR.viewport.getScale(),
    OBR.viewport.getWidth(),
    OBR.viewport.getHeight(),
  ]);
  return {
    x: (vw / 2 - vp.x) / scale,
    y: (vh / 2 - vp.y) / scale,
  };
}

// --- Effect modal: open on receive ---

async function showDiceEffect(p: DiceRollPayload): Promise<void> {
  const modalId = `${MODAL_PREFIX}${p.rollId}`;

  // World anchor — token top for token rolls, viewport center for free.
  let world: { x: number; y: number } | null = null;
  if (p.itemId) world = await tokenTopWorld(p.itemId);
  if (!world) world = await viewportCenterWorld();

  // Camera focus is now performed by panel-page.ts BEFORE broadcasting
  // (single token: pan only, multi-token: bounding box). Initiative
  // rolls go through useInitiative.ts which calls broadcastDiceRoll
  // directly without a panel-side focus pass — those rolls don't
  // re-frame the camera, the user can pan manually if needed.

  const dtypes = p.dice.map((d) => d.type).join(",");
  const dvalues = p.dice.map((d) => d.value).join(",");
  const dlosers = p.dice.map((d) => (d.loser ? "1" : "0")).join(",");
  // Pre-modified original values (max/min/reset) — empty string means
  // "no replacement". Sent as a parallel comma-separated list so the
  // visual can render "new(orig)".
  const doriginals = p.dice.map((d) => (typeof d.originalValue === "number" ? String(d.originalValue) : "")).join(",");
  // burst() chain parent index per die — empty string for non-burst-
  // children. The visual uses this to play parent → child fly-in
  // animations along each chain.
  const dparents = p.dice.map((d) => (typeof d.burstParent === "number" ? String(d.burstParent) : "")).join(",");
  // Subtraction-die flag (e.g. the d6 in `1d20-1d6`) — same shape as
  // dlosers. Effect-page renders these at lower opacity and prefixes
  // their chip text with "−".
  const dsubtract = p.dice.map((d) => (d.subtract ? "1" : "0")).join(",");
  const hidden = p.hidden ? "1" : "0";
  const autoDismiss = p.autoDismiss ? "1" : "0";
  // Row boundaries for repeat() — comma-separated start indices, or
  // empty if not in repeat-mode. Last row implicitly ends at dice.length.
  const rowStarts = (p.rowStarts ?? []).join(",");
  const sameHighlight = p.sameHighlight ? "1" : "0";
  const url =
    `${EFFECT_URL}?dtypes=${dtypes}` +
    `&dvalues=${dvalues}` +
    `&dlosers=${dlosers}` +
    `&doriginals=${doriginals}` +
    `&dparents=${dparents}` +
    `&dsubtract=${dsubtract}` +
    `&winner=${p.winnerIdx}` +
    `&total=${p.total}` +
    `&modifier=${p.modifier}` +
    `&label=${encodeURIComponent(p.label)}` +
    `&rollId=${encodeURIComponent(p.rollId)}` +
    `&rollerId=${encodeURIComponent(p.rollerId)}` +
    `&wx=${world.x}&wy=${world.y}` +
    `&color=${encodeURIComponent(p.rollerColor)}` +
    `&hidden=${hidden}` +
    `&autoDismiss=${autoDismiss}` +
    `&rowStarts=${rowStarts}` +
    `&same=${sameHighlight}` +
    // World coords don't contain token-id; pass it through so the
    // effect-page can keep tracking the token if it moves.
    `&itemId=${encodeURIComponent(p.itemId ?? "")}`;

  try {
    try { await OBR.modal.close(modalId); } catch {}
    await OBR.modal.open({
      id: modalId,
      url,
      fullScreen: true,
      hideBackdrop: true,
      hidePaper: true,
      disablePointerEvents: true,
    });
  } catch (e) {
    console.error("[obr-suite/dice] open effect modal failed", e);
  }
}

// --- Setup / teardown ---

export async function setupDice(): Promise<void> {
  // Open the dedicated history-trigger button at the bottom-right.
  // Stays open for the entire dice-module lifetime; clicking toggles
  // the history popover above it.
  await openHistoryTrigger();

  // Re-anchor trigger + history popover on viewport resize.
  unsubs.push(
    onViewportResize(async () => {
      if (historyTriggerOpen) await openHistoryTrigger();
      if (historyOpen) await openHistory();
    }),
  );

  // Drag-end + reset broadcasts → recompute anchor with the new stored
  // offset. openHistory reads getPanelOffset fresh, so no payload state
  // needs to thread through.
  unsubs.push(
    OBR.broadcast.onMessage(BC_PANEL_DRAG_END, async (event) => {
      const payload = event.data as DragEndPayload | undefined;
      if (
        payload?.panelId === PANEL_IDS.diceHistory ||
        payload?.panelId === PANEL_IDS.diceHistoryTrigger
      ) {
        if (historyTriggerOpen) await openHistoryTrigger();
        if (historyOpen) await openHistory();
      }
    }),
  );
  unsubs.push(
    OBR.broadcast.onMessage(BC_PANEL_RESET, async () => {
      if (historyTriggerOpen) await openHistoryTrigger();
      if (historyOpen) await openHistory();
    }),
  );

  // 1. Listen for dice-roll broadcasts → render the visual effect.
  //    Also auto-reopen the history popover if the user manually
  //    dismissed it — a new roll is the natural cue to bring it back.
  //
  //    Dedupe: the sender broadcasts LOCAL+REMOTE for non-hidden rolls.
  //    Most clients receive each rollId exactly once, but on the DM's
  //    side we've intermittently seen the same payload arrive twice —
  //    likely an OBR delivery quirk during initiative-driven rolls.
  //    A small Set keyed by `rollId` with a 10s TTL guards against the
  //    duplicate so the dice-effect modal opens at most once per roll.
  // Snapshot this client's role + player id so the dice-roll listener
  // can decide what to do with hidden (dark) rolls without an OBR
  // round-trip per broadcast.
  let myRoleForDice: "GM" | "PLAYER" = "PLAYER";
  let myPlayerIdForDice = "";
  try { myRoleForDice = (await OBR.player.getRole()) as "GM" | "PLAYER"; } catch {}
  try { myPlayerIdForDice = await OBR.player.getId(); } catch {}
  unsubs.push(
    OBR.player.onChange((p) => {
      if (p.role === "GM" || p.role === "PLAYER") myRoleForDice = p.role;
      if (p.id) myPlayerIdForDice = p.id;
    }),
  );

  const seenRolls = new Map<string, number>();
  const ROLL_DEDUPE_MS = 10_000;
  unsubs.push(
    OBR.broadcast.onMessage(BROADCAST_DICE_ROLL, (event) => {
      const data = normalizePayload(event.data);
      if (!data) return;
      const now = Date.now();
      // Sweep stale entries.
      if (seenRolls.size > 200) {
        for (const [k, t] of seenRolls) {
          if (now - t > ROLL_DEDUPE_MS) seenRolls.delete(k);
        }
      }
      if (data.rollId && seenRolls.has(data.rollId)) return;
      if (data.rollId) seenRolls.set(data.rollId, now);

      // Hidden (dark) roll on a non-DM, non-roller client: skip the
      // visual entirely and just play the SFX sequence so the table
      // HEARS the dice tumble + climax punch without seeing what was
      // hidden. (DM still gets the full translucent modal locally;
      // the roller's own client always shows their own roll too.)
      const isReceiverDmOrRoller =
        myRoleForDice === "GM" || data.rollerId === myPlayerIdForDice;
      if (data.hidden && !isReceiverDmOrRoller) {
        // Lazy-import so the SFX module loads only when actually
        // needed in this iframe.
        void (async () => {
          try {
            const mod = await import("./sfx-broadcast");
            // Tumble bursts — one per kept die, slightly staggered
            // so it sounds like a pile of dice landing.
            const kept = data.dice.filter((d) => !d.loser);
            const total = kept.length;
            for (let i = 0; i < total; i++) {
              setTimeout(() => mod.sfxParabola(), i * 80);
            }
            // Climax punch slightly after the last die would have
            // landed (matches the panel-side animation timing).
            setTimeout(() => mod.sfxScalePunch(), total * 80 + 600);
          } catch {}
        })();
        return; // skip showDiceEffect + history auto-open
      }

      showDiceEffect(data).catch(() => {});
      // Auto-open the dice-history popover on every new roll when
      // (a) the LS flag is on AND (b) the popover isn't already
      // visible. We always open in transient mode for the auto-open
      // path so the user gets the 5-second progress bar UX. Manual
      // clicks of the trigger button switch into "all" mode (see
      // BC_DICE_HISTORY_TOGGLE handler).
      if (isHistoryAutoOn() && !historyOpen) {
        historyManuallyDismissed = false;
        openHistory("transient").catch(() => {});
      }
    })
  );

  // 2. Toggle the dice panel via OBR.action (top-left d20 button).
  // The cluster's dice button + history-popover row clicks +
  // right-click "添加到骰盘" all broadcast BC_PANEL_TOGGLE. Payload
  // shape: { open?: boolean, prefill?: string }. We always favor
  // OPENing for prefill broadcasts so a typed-in expression doesn't
  // toggle the panel closed.
  unsubs.push(
    OBR.broadcast.onMessage(BC_PANEL_TOGGLE, async (event) => {
      const data = event.data as { open?: boolean; prefill?: string } | undefined;
      const wantOpen = !!(data && (data.open === true || typeof data.prefill === "string"));
      let isOpen = false;
      try { isOpen = await OBR.action.isOpen(); } catch {}
      if (wantOpen) {
        if (!isOpen) await openActionPanel();
      } else {
        if (isOpen) await closeActionPanel();
        else await openActionPanel();
      }
      if (data?.prefill) {
        // Two-phase prefill so it works on cold-start AND when the
        // action iframe is already loaded:
        //   1. Stash in localStorage so the iframe can pick it up on
        //      mount (covers the case where the broadcast races
        //      ahead of listener registration).
        //   2. Also re-broadcast after a beat so a hot iframe gets
        //      the fill via its live listener even if it loaded
        //      before the user clicked.
        try { localStorage.setItem("obr-suite/dice-pending-prefill", data.prefill); } catch {}
        setTimeout(() => {
          OBR.broadcast
            .sendMessage(
              BC_DICE_PANEL_FILL,
              { expression: data.prefill },
              { destination: "LOCAL" },
            )
            .catch(() => {});
        }, 250);
      }
    })
  );

  // 3. Bottom-right history popover. Spec change 2026-05-04: the
  // popover ALWAYS starts CLOSED on scene load (regardless of the
  // per-client LS preference). New dice rolls re-auto-open it in
  // transient mode (see the dice-roll receive handler below), and
  // the user can click the trigger to bring it back permanently in
  // "all" mode. The closed-on-load behaviour matches the user's
  // expectation that the history shouldn't pre-occupy screen space
  // when nothing has rolled yet.
  broadcastHistoryState(false);
  // Close history every time the scene re-becomes ready. Idempotent
  // when nothing's open. Symmetric guard for scenes where the
  // trigger panel itself isn't being rendered (module disabled by
  // user mid-session).
  unsubs.push(
    OBR.scene.onReadyChange(async (ready) => {
      if (ready && historyOpen) {
        await closeHistory();
      }
    }),
  );
  unsubs.push(
    OBR.broadcast.onMessage(BC_DICE_HISTORY_TOGGLE, async () => {
      historyManuallyDismissed = false;
      if (historyOpen) {
        try { localStorage.setItem(LS_AUTO_DICE_HISTORY, "0"); } catch {}
        await closeHistory();
      } else {
        try { localStorage.setItem(LS_AUTO_DICE_HISTORY, "1"); } catch {}
        // Manual user click → open in "all" mode (full history,
        // no progress bars, no auto-close). Auto-open from a new
        // dice roll uses the default "transient" path below.
        await openHistory("all");
      }
    }),
  );

  // Iframe asked us to close because its transient list emptied —
  // close the popover but leave the LS flag alone so a fresh roll
  // re-auto-opens it.
  unsubs.push(
    OBR.broadcast.onMessage(BC_DICE_HISTORY_AUTO_CLOSE, async () => {
      if (!historyOpen) return;
      await closeHistory();
    }),
  );

  // X-button inside the history popover was removed (title bar gone),
  // but the dismiss broadcast listener stays defensive — any external
  // caller can still close the popover this way.
  unsubs.push(
    OBR.broadcast.onMessage(BC_DICE_HISTORY_DISMISS, async () => {
      if (!historyOpen) return;
      historyManuallyDismissed = true;
      await closeHistory();
    }),
  );

  // OBR's action popover steals focus when it opens — clicking the
  // top-left dice button silently deselects whatever token the user
  // had selected. To preserve the user's selection across the
  // action click, we track the last non-empty selection and restore
  // it the moment the popover open-state flips true.
  let lastNonEmptySel: string[] = [];
  let emptiedAt = 0;
  unsubs.push(
    OBR.player.onChange((player) => {
      const sel = player.selection ?? [];
      if (sel.length > 0) {
        lastNonEmptySel = [...sel];
      } else if (lastNonEmptySel.length > 0) {
        emptiedAt = Date.now();
      }
    }),
  );
  unsubs.push(
    OBR.action.onOpenChange(async (isOpen) => {
      if (!isOpen) return;
      // Only restore if the selection was emptied very recently —
      // i.e. it was the action click itself that cleared it. A
      // longer-ago clear was probably intentional.
      if (lastNonEmptySel.length === 0) return;
      if (Date.now() - emptiedAt > 600) return;
      const cur = (await OBR.player.getSelection()) ?? [];
      if (cur.length > 0) return;
      try {
        await OBR.player.select([...lastNonEmptySel], true);
      } catch {}
    }),
  );

  // Replay overlay — toggle. action=close always closes, otherwise
  // toggles open/close based on whether the same cid is already
  // displayed.
  unsubs.push(
    OBR.broadcast.onMessage(BC_DICE_REPLAY, async (event) => {
      const data = event.data as { cid?: string; action?: string } | undefined;
      if (!data?.cid) return;
      if (data.action === "close") {
        if (activeReplayCid === data.cid) await closeReplay();
        return;
      }
      if (activeReplayCid === data.cid) await closeReplay();
      else await openReplay(data.cid);
    }),
  );

  // 4. Quick-roll listener — accepts a simple expression from any
  // iframe (search results, character card panel, 5etools tag click
  // handlers) and pushes through the normal dice pipeline.
  unsubs.push(
    OBR.broadcast.onMessage(BC_QUICK_ROLL, async (event) => {
      const req = event.data as QuickRollRequest | undefined;
      if (!req || typeof req.expression !== "string" || !req.expression.trim()) return;
      try {
        await handleQuickRoll(req);
      } catch (e) {
        console.error("[obr-suite/dice] quick-roll failed", e);
      }
    }),
  );
}

// Tiny parser for simple expressions ("1d20+5", "2d6+3", "+5d4-2").
// Sufficient for 5etools tags + character-card stat clicks; for full
// adv/dis/max/burst/repeat support the user should go through the
// dice panel directly. Whitespace is stripped first so 5etools-style
// "1d4 + 2" / "1d6 - 1" parse correctly (the sign would otherwise
// fail to bind to its number across a space).
function rollSimpleExpression(expr: string): { dice: DieResult[]; modifier: number } {
  const dice: DieResult[] = [];
  let modifier = 0;
  const cleaned = expr.replace(/\s+/g, "");
  const re = /([+\-]?)(?:(\d*)d(\d+)|(\d+))/gi;
  for (const m of cleaned.matchAll(re)) {
    const sign = m[1] === "-" ? -1 : 1;
    if (m[3] !== undefined) {
      const count = (m[2] ? parseInt(m[2], 10) : 1);
      const sides = parseInt(m[3], 10);
      if (!sides || sides < 2 || sides > 1000) continue;
      const type = `d${sides}`;
      for (let i = 0; i < count; i++) {
        dice.push({ type, value: rollDie(type as DiceType) });
      }
      // Negative-sign on a dice term is non-standard but we treat
      // each die's contribution as signed via modifier subtraction —
      // simpler than negative dice support.
      if (sign < 0) {
        const total = dice.slice(-count).reduce((a, d) => a + d.value, 0);
        modifier -= total;
        // mark them as loser so they're shown faded and skipped
        for (let i = dice.length - count; i < dice.length; i++) {
          dice[i].loser = true;
        }
      }
    } else if (m[4]) {
      modifier += sign * parseInt(m[4], 10);
    }
  }
  return { dice, modifier };
}

async function handleQuickRoll(req: QuickRollRequest): Promise<void> {
  const parsed = rollSimpleExpression(req.expression);
  let { dice } = parsed;
  const { modifier } = parsed;

  // Advantage / disadvantage shortcut: every d20 in the dice array
  // gets a paired roll; keep the higher (adv) / lower (dis), mark the
  // loser. Other dice are unaffected.
  if (req.advMode === "adv" || req.advMode === "dis") {
    const expanded: DieResult[] = [];
    for (const d of dice) {
      if (d.type !== "d20") {
        expanded.push(d);
        continue;
      }
      const partner: DieResult = { type: "d20", value: rollDie("d20") };
      const keepFirst =
        req.advMode === "adv"
          ? d.value >= partner.value
          : d.value <= partner.value;
      if (keepFirst) {
        expanded.push(d, { ...partner, loser: true });
      } else {
        expanded.push({ ...d, loser: true }, partner);
      }
    }
    dice = expanded;
  }

  if (!dice.length && modifier === 0) return;

  // Camera focus on the requested token (only if explicitly asked
  // AND there's a real token id — empty string means "no token").
  if (req.focus && req.itemId) {
    try {
      const [items, vw, vh, currentScale] = await Promise.all([
        OBR.scene.items.getItems([req.itemId]),
        OBR.viewport.getWidth(),
        OBR.viewport.getHeight(),
        OBR.viewport.getScale(),
      ]);
      if (items.length) {
        const p = items[0].position;
        OBR.viewport.animateTo({
          position: { x: -p.x * currentScale + vw / 2, y: -p.y * currentScale + vh / 2 },
          scale: currentScale,
        }).catch(() => {});
      }
    } catch {}
  }

  let rollerId = "";
  try { rollerId = await OBR.player.getId(); } catch {}

  await broadcastDiceRoll({
    itemId: req.itemId ?? null,
    dice,
    winnerIdx: -1,
    modifier,
    label: req.label ?? "",
    rollerId,
    hidden: !!req.hidden,
    collectiveId: req.collectiveId,
  });
}


export async function teardownDice(): Promise<void> {
  // Close the action panel if open. (OBR.action.close is idempotent.)
  await closeActionPanel();
  await closeHistory();
  await closeHistoryTrigger();
  for (const u of unsubs.splice(0)) u();
}

// --- Convenience exports for callers (initiative + the panel) ---

export function rollD20(): number {
  return rollDie("d20");
}

/** Coerce any legacy / partial payload into the canonical schema, or
 *  return null if it's unrecoverable. Used by all receivers so nobody
 *  has to special-case the old shape. */
function normalizePayload(raw: unknown): DiceRollPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Partial<DiceRollPayload> & LegacyDiceRollPayload;
  let dice: DieResult[];
  if (Array.isArray(data.dice) && data.dice.length) {
    dice = data.dice
      .filter((d) => d && typeof d === "object")
      .map((d) => {
        const die = d as DieResult;
        const out: DieResult = {
          type: die.type,
          // sidesOf() handles non-standard dice (d7, d600, ...) — using
          // DIE_SIDES[type] ?? 20 here was clamping every custom-side
          // result to a max of 20 regardless of the actual face count.
          value: clamp(die.value, 1, sidesOf(die.type)),
        };
        // Preserve the optional adv/dis loser flag, max/min/reset
        // original-value annotation, and burst() chain parent index
        // through the broadcast pipeline.
        if (die.loser) out.loser = true;
        if (typeof die.originalValue === "number") out.originalValue = die.originalValue;
        if (typeof die.burstParent === "number") out.burstParent = die.burstParent;
        if (die.subtract) out.subtract = true;
        return out;
      });
  } else if (Array.isArray(data.rolls) && data.rolls.length) {
    // Legacy: rolls: number[] (treat as d20s)
    dice = data.rolls.map((v) => ({ type: "d20" as DiceType, value: clamp(v, 1, 20) }));
  } else if (typeof data.value === "number") {
    dice = [{ type: "d20", value: clamp(data.value, 1, 20) }];
  } else {
    return null;
  }
  if (!dice.length) return null;
  if (!data.rollId) return null;
  const winnerIdx =
    typeof data.winnerIdx === "number"
      ? Math.max(-1, Math.min(dice.length - 1, data.winnerIdx))
      : 0;
  const modifier = typeof data.modifier === "number" ? data.modifier : 0;
  const total =
    typeof data.total === "number"
      ? data.total
      : dice.reduce((a, d) => a + d.value, 0) + modifier;
  return {
    itemId: data.itemId ?? null,
    dice,
    winnerIdx,
    modifier,
    label: data.label ?? "",
    total,
    rollerId: data.rollerId ?? "",
    rollerName: data.rollerName ?? "",
    rollerColor: data.rollerColor ?? "#5dade2",
    rollId: data.rollId,
    ts: data.ts ?? Date.now(),
    hidden: !!(data as any).hidden,
    ...(((data as any).autoDismiss) ? { autoDismiss: true } : {}),
    ...(Array.isArray((data as any).rowStarts) ? { rowStarts: ((data as any).rowStarts as number[]).filter((n) => Number.isFinite(n)) } : {}),
    ...(((data as any).sameHighlight) ? { sameHighlight: true } : {}),
    ...(((data as any).collectiveId) ? { collectiveId: String((data as any).collectiveId) } : {}),
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(v)));
}

/** Send a dice roll on the suite-wide channel. Goes to every client
 *  (LOCAL + REMOTE), so the sender's own visual + history both fire
 *  alongside everyone else's.
 *
 *  Returns the rollId so the caller can correlate later events
 *  (BC_DICE_FADE_START, BC_DICE_CLEAR_ALL) to this specific roll. */
export async function broadcastDiceRoll(opts: {
  itemId: string | null;
  dice: DieResult[];
  winnerIdx: number;
  modifier?: number;
  label?: string;
  rollerId: string;
  rollerName?: string;
  hidden?: boolean;
  // If provided, this rollId is used instead of an auto-generated one.
  // Initiative passes a deterministic id so it can match BC_DICE_FADE_START.
  rollId?: string;
  // If true, the effect modal self-closes shortly after the climax.
  // Used by initiative rolls (don't linger on the canvas after the
  // result is shown).
  autoDismiss?: boolean;
  // Collective-roll grouping (multi-target panel rolls). Same id on
  // every emitted broadcast; the history popover treats them as one
  // row and the click-to-replay feature retrieves all members.
  collectiveId?: string;
}): Promise<string> {
  if (!opts.dice.length) return "";
  const winnerIdx = Math.max(-1, Math.min(opts.dice.length - 1, opts.winnerIdx));

  let rollerColor = "#5dade2";
  let rollerName = opts.rollerName ?? "";
  try {
    const c = await OBR.player.getColor();
    if (typeof c === "string" && c) rollerColor = c;
    if (!rollerName) {
      const n = await OBR.player.getName();
      if (n) rollerName = n;
    }
  } catch {}
  if (!rollerName) rollerName = "投骰人";

  const modifier = opts.modifier ?? 0;
  const dice = opts.dice.map((d) => {
    const out: DieResult = { type: d.type, value: clamp(d.value, 1, sidesOf(d.type)) };
    if (d.loser) out.loser = true;
    if (typeof d.originalValue === "number") out.originalValue = d.originalValue;
    if (d.subtract) out.subtract = true;
    return out;
  });
  // Total counts only winners (adv/dis losers don't add to total).
  // Subtraction dice contribute negative (e.g. 1d20-1d6 with rolls 18
  // and 4 → 14).
  const total = dice
    .filter((d) => !d.loser)
    .reduce((a, d) => a + (d.subtract ? -d.value : d.value), 0)
    + modifier;

  const rollId = opts.rollId ?? `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const payload: DiceRollPayload = {
    itemId: opts.itemId,
    dice,
    winnerIdx,
    modifier,
    label: opts.label ?? "",
    total,
    rollerId: opts.rollerId,
    rollerName,
    rollerColor,
    rollId,
    ts: Date.now(),
    hidden: !!opts.hidden,
    ...(opts.autoDismiss ? { autoDismiss: true } : {}),
    ...(opts.collectiveId ? { collectiveId: opts.collectiveId } : {}),
  };

  try {
    if (opts.hidden) {
      // Dark roll — DM still sees their own translucent dice modal
      // locally, but the broadcast also fans out to REMOTE so every
      // player's client plays the SFX (handled in the receive listener
      // below: hidden roll on non-DM client → play tumble/punch SFX
      // but skip the modal entirely). This way the table HEARS the
      // roll without seeing what was hidden.
      await Promise.all([
        OBR.broadcast.sendMessage(BROADCAST_DICE_ROLL, payload, { destination: "LOCAL" }),
        OBR.broadcast.sendMessage(BROADCAST_DICE_ROLL, payload, { destination: "REMOTE" }),
      ]);
    } else {
      await Promise.all([
        OBR.broadcast.sendMessage(BROADCAST_DICE_ROLL, payload, { destination: "LOCAL" }),
        OBR.broadcast.sendMessage(BROADCAST_DICE_ROLL, payload, { destination: "REMOTE" }),
      ]);
    }
  } catch (e) {
    console.error("[obr-suite/dice] broadcast failed", e);
  }
  return rollId;
}
