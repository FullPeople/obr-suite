import OBR from "@owlbear-rodeo/sdk";
import { assetUrl } from "../../asset-base";
import { onViewportResize } from "../../utils/viewportAnchor";
import {
  PANEL_IDS,
  getPanelOffset,
  getPanelSize,
  registerPanelBbox,
  BC_PANEL_DRAG_END,
  BC_PANEL_RESET,
  type DragEndPayload,
} from "../../utils/panelLayout";

// Character-card info popover bbox — RIGHT/BOTTOM anchor. Always
// returns the expected bbox so the layout editor can render a
// proxy for it regardless of whether a card is currently bound.
registerPanelBbox(PANEL_IDS.ccInfo, async () => {
  try {
    const [vw, vh] = await Promise.all([
      OBR.viewport.getWidth(),
      OBR.viewport.getHeight(),
    ]);
    const buttonTop = vh - (BOTTOM_OFFSET + 48 + 8);
    const anchorTop = buttonTop - INFO_GAP;
    const userOff = getPanelOffset(PANEL_IDS.ccInfo);
    const sizeOverride = getPanelSize(PANEL_IDS.ccInfo);
    const w = sizeOverride?.width ?? INFO_WIDTH;
    const h = sizeOverride?.height ?? INFO_HEIGHT;
    const anchorRight = vw - RIGHT_OFFSET + userOff.dx;
    const anchorBottom = anchorTop + userOff.dy;
    return {
      left: anchorRight - w,
      top: anchorBottom - h,
      width: w,
      height: h,
    };
  } catch { return null; }
});

// Character Cards module — migrated from the standalone plugin.
//
// Components:
//   1. Main panel popover — 64×64 floating button at bottom-right that
//      opens into a fullscreen panel via internal popover.setWidth/Height.
//      The cluster's "角色卡界面按钮" broadcasts a panel-open event the
//      iframe listens for to maximize.
//   2. Info popover — small floating preview that opens above the main
//      button when a bound character token is selected. DM + players see
//      it (subject to the auto-info localStorage toggle, which the
//      cluster's "角色卡悬浮" toggle also writes to).
//   3. Bind modal — opened from the right-click context menu (GM only),
//      lets the GM bind/rebind/unbind a card to a character token.
//
// The "controls" popover from the standalone plugin (the two popup
// toggles) is intentionally NOT migrated — those toggles already live
// in the suite cluster.

const PLUGIN_ID = "com.character-cards"; // backward-compat for scene metadata + broadcasts
// The main panel uses OBR.modal (NOT popover) so it opens/closes
// instantly without popover's built-in fade-in/fade-out transition.
// disablePointerEvents stays false so the panel buttons work.
const PANEL_MODAL_ID = "com.obr-suite/cc-panel";
const INFO_POPOVER_ID = "com.obr-suite/cc-info";
const BIND_MODAL_ID = "com.obr-suite/cc-bind-picker";
const PANEL_URL = assetUrl("cc-panel.html");
const INFO_URL = assetUrl("cc-info.html");
const BIND_URL = assetUrl("cc-bind.html");
const ICON_URL = assetUrl("cc-icon.svg");

const BIND_META = `${PLUGIN_ID}/boundCardId`;
const SCENE_META_KEY = `${PLUGIN_ID}/list`;
const BUBBLES_META_KEY = "com.obr-suite/bubbles/data";
const EXTERNAL_BUBBLES_META_KEY = "com.owlbear-rodeo-bubbles-extension/metadata";
const INIT_DEXMOD_META = "com.initiative-tracker/dexMod";
const AUTO_INFO_KEY = "character-cards/auto-info";
const TOGGLE_MSG = `${PLUGIN_ID}/auto-info-toggled`;
const INFO_SHOW_MSG = `${PLUGIN_ID}/info-show`;
const CTX_BIND = "com.obr-suite/cc-bind-menu";

// 2026-05-14 — BC_CARD_UPDATED is broadcast by panel-page (xlsx
// upload / refresh) and fullscreen-page (JSON import). When we
// receive it we propagate the new card stats to every token bound
// to that cardId, so the bubbles overlay + initiative dex-mod stay
// in sync without the user manually re-binding. CURRENT HP is left
// alone — mid-session HP edits shouldn't be wiped by a passive
// refresh.
const BC_CARD_UPDATED = "com.obr-suite/cc-card-updated";
const SERVER_ORIGIN = "https://obr.dnd.center";

// Standalone TOOL id — a top-level button in OBR's tool toolbar
// (alongside Move / Select / Measure / …), NOT an action nested
// under another tool. Its onClick returns false so clicking it just
// toggles the character-card panel without switching the active
// tool. Replaces the old suite-cluster "角色卡界面" button.
const CC_TOOL_ID = "com.obr-suite/cc-panel-tool";

const POPOVER_BOX = 64;
const BOTTOM_OFFSET = 160;
const RIGHT_OFFSET = 12;
const INFO_WIDTH = 320;
// 2026-05-15 — was 360. Reduced to 260 because info-page.ts now
// auto-shrinks to the actual content height after first render, and
// most cards measure ~180-240 px. The smaller default means the
// first paint (before adjustHeight lands) doesn't block as much
// canvas. setHeight can still grow to the user's saved size on a
// resized popover; this is just the un-resized default.
const INFO_HEIGHT = 260;
const INFO_GAP = 8;

const unsubs: Array<() => void> = [];
let infoPopoverOpen = false;
let currentInfoCard: string | null = null;
// Last itemId passed to openInfoPopoverFor — needed so the viewport-
// resize handler can re-issue the popover with the same URL (different
// URL would force OBR to reload the iframe).
let currentInfoItemId: string | null = null;
// Panel open-state is tracked in localStorage (shared across this
// client's same-origin iframes), NOT a cached boolean. The panel
// iframe clears the key on EVERY close path — including OBR's
// click-outside close, which only fires pagehide/beforeunload, where a
// synchronous localStorage write lands reliably but an async OBR
// broadcast does not. That async-broadcast unreliability was the root
// of the long-standing "click the tool twice to reopen" bug.
const PANEL_OPEN_KEY = "com.obr-suite/cc-panel-open";
function isPanelOpen(): boolean {
  try { return localStorage.getItem(PANEL_OPEN_KEY) === "1"; } catch { return false; }
}
let ccMyId = "";
let ccRole: "GM" | "PLAYER" = "PLAYER";

function isAutoInfoEnabled(): boolean {
  try {
    return localStorage.getItem(AUTO_INFO_KEY) !== "0";
  } catch { return true; }
}

// The main panel opens as a SIZED modal (NOT fullScreen), leaving a
// gap on each side so OBR's left tool toolbar stays visible and
// clickable while the panel is open — the panel is now launched from
// a toolbar action, and the user wants the toolbar reachable
// underneath (this is the pattern a future big status/resource stats
// panel will reuse). OBR's Modal type exposes only width/height (no
// inset/position), and modals are centred, so the gap is symmetric
// left+right; `hideBackdrop` keeps those side strips interactive.
//
// 2026-05-16 — MUI gotcha. `hidePaper: true` only hides the visual
// paper styling (background, shadow) — the `MuiDialog-paper` element
// is still present and still carries MUI's default
// `maxHeight: calc(100% - 64px)`. If we ask OBR for height = vh, the
// iframe is sized to vh but the Paper clamps to vh-64; iframe taller
// than Paper → Paper scrolls (= the "div.panel 919 但内容溢出 →
// 外滚动条" the user reported even though our internal CSS had
// overflow:hidden everywhere). The 64px is split as 32 top + 32
// bottom by MUI's vertical centering, so the same effect applies
// horizontally — width clamps to vw-64 if we asked for vw.
// Subtract MUI's margin BEFORE handing the size to OBR so the
// iframe matches Paper exactly and nothing scrolls.
const PANEL_SIDE_GAP = 64;
const MUI_DIALOG_MARGIN = 64;
async function openMainPopover() {
  try {
    let vw = 1280;
    let vh = 800;
    try {
      [vw, vh] = await Promise.all([
        OBR.viewport.getWidth(),
        OBR.viewport.getHeight(),
      ]);
    } catch { /* viewport read failed — fall back to sane defaults */ }
    // 2026-05-16 — width already shrinks by PANEL_SIDE_GAP * 2 = 128,
    // which is wider than MUI's 64 horizontal margin so the side
    // toolbar stays visible AND the width fits MUI's max. Height
    // needs the MUI_DIALOG_MARGIN subtracted to match Paper's max.
    await OBR.modal.open({
      id: PANEL_MODAL_ID,
      url: PANEL_URL,
      width: Math.max(360, Math.round(vw) - PANEL_SIDE_GAP * 2),
      height: Math.max(240, Math.round(vh) - MUI_DIALOG_MARGIN),
      hideBackdrop: true, // no dark overlay → the side gaps stay interactive
      hidePaper: true,    // no Material paper background / shadow
      // disablePointerEvents stays default (false) — panel buttons need clicks
    });
    try { localStorage.setItem(PANEL_OPEN_KEY, "1"); } catch {}
  } catch (e) {
    console.error("[obr-suite/character-cards] openMainPopover failed", e);
  }
}

async function closeMainPopover() {
  try { await OBR.modal.close(PANEL_MODAL_ID); } catch {}
  try { localStorage.removeItem(PANEL_OPEN_KEY); } catch {}
}

async function toggleMainPanel() {
  if (isPanelOpen()) await closeMainPopover();
  else await openMainPopover();
}

async function openInfoPopoverFor(cardId: string, roomId: string, itemId: string | null) {
  if (infoPopoverOpen) return;
  currentInfoItemId = itemId;
  try {
    const [vw, vh] = await Promise.all([
      OBR.viewport.getWidth(),
      OBR.viewport.getHeight(),
    ]);
    const buttonTop = vh - (BOTTOM_OFFSET + 48 + 8);
    // `desiredBottom` is the screen-y the popover SHOULD bottom-out at
    // (the inset above the action button). With BOTTOM anchor we passed
    // this as `anchorPosition.top` directly; with TOP anchor (used here
    // since 2026-05-16) we compute the TOP from it: top = bottom - h.
    const desiredBottom = buttonTop - INFO_GAP;
    const itemParam = itemId ? `&itemId=${encodeURIComponent(itemId)}` : "";
    const userOff = getPanelOffset(PANEL_IDS.ccInfo);
    const sizeOverride = getPanelSize(PANEL_IDS.ccInfo);
    const w = sizeOverride?.width ?? INFO_WIDTH;
    const h = sizeOverride?.height ?? INFO_HEIGHT;
    // 2026-05-16 — switched to TOP-anchored vertical alignment so the
    // popover's TOP edge stays fixed when info-page.ts auto-shrinks it
    // via OBR.popover.setHeight (e.g. when switching tabs to a shorter
    // pane). Previously the BOTTOM was fixed and a shrink visibly
    // pulled the top down ("突兀变下面去了" — user). The initial open
    // is at the same visual position as before because we compute
    // `top = desiredBottom - h` so the open-time bottom still lands
    // at `desiredBottom`. Later shrinks keep the top put and let the
    // bottom move up instead.
    await OBR.popover.open({
      id: INFO_POPOVER_ID,
      url: `${INFO_URL}?cardId=${encodeURIComponent(cardId)}&roomId=${encodeURIComponent(
        roomId
      )}${itemParam}`,
      width: w,
      height: h,
      anchorReference: "POSITION",
      anchorPosition: {
        left: vw - RIGHT_OFFSET + userOff.dx,
        top: desiredBottom - h + userOff.dy,
      },
      anchorOrigin: { horizontal: "RIGHT", vertical: "TOP" },
      transformOrigin: { horizontal: "RIGHT", vertical: "TOP" },
      hidePaper: true,
      disableClickAway: true,
    });
    infoPopoverOpen = true;
  } catch (e) {
    console.error("[obr-suite/character-cards] openInfoPopoverFor failed", e);
  }
}

async function closeInfoPopover() {
  try { await OBR.popover.close(INFO_POPOVER_ID); } catch {}
  infoPopoverOpen = false;
  currentInfoCard = null;
  currentInfoItemId = null;
}

async function showInfoFor(cardId: string, itemId: string | null = null) {
  if (currentInfoCard === cardId && infoPopoverOpen) {
    // Even if the same card stays open, the bound token might've
    // changed (different token with same card binding selected).
    // Re-broadcast so info-page updates its rollable target.
    try {
      await OBR.broadcast.sendMessage(
        INFO_SHOW_MSG,
        { cardId, roomId: OBR.room.id || "default", itemId },
        { destination: "LOCAL" }
      );
    } catch {}
    return;
  }
  const roomId = OBR.room.id || "default";
  if (!infoPopoverOpen) {
    await openInfoPopoverFor(cardId, roomId, itemId);
  } else {
    try {
      await OBR.broadcast.sendMessage(
        INFO_SHOW_MSG,
        { cardId, roomId, itemId },
        { destination: "LOCAL" }
      );
    } catch {}
  }
  currentInfoCard = cardId;
}

async function hideInfo() {
  // 2026-05-10: when the user has pinned the panel via the new
  // panel-pin button, selection-driven close is suppressed. Explicit
  // closes (closeInfoPopover via panel-close action, scene unload)
  // still go through.
  if (isCcInfoPinned()) return;
  if (!infoPopoverOpen && currentInfoCard === null) return;
  await closeInfoPopover();
}

const LS_CC_INFO_PINNED = "obr-suite/cc-info-pinned";
function isCcInfoPinned(): boolean {
  try { return localStorage.getItem(LS_CC_INFO_PINNED) === "1"; } catch { return false; }
}

async function getSceneCardIds(): Promise<Set<string>> {
  try {
    const meta = await OBR.scene.getMetadata();
    const list = meta[SCENE_META_KEY];
    if (Array.isArray(list))
      return new Set(list.map((c: any) => c.id).filter(Boolean));
  } catch {}
  return new Set();
}

async function handleSelection(selection: string[] | undefined) {
  if (!isAutoInfoEnabled()) {
    if (currentInfoCard) await hideInfo();
    return;
  }
  if (!selection || selection.length !== 1) {
    if (currentInfoCard) await hideInfo();
    return;
  }
  let boundId: string | null = null;
  let ownsItem = false;
  let hasAnyPlayerOwner = false;
  let locked = true; // default locked
  let item: any = null;
  const itemId = selection[0];
  try {
    const items = await OBR.scene.items.getItems(selection);
    item = items[0] ?? null;
    const m = item?.metadata?.[BIND_META];
    if (typeof m === "string") boundId = m;
    const createdUserId = (item as any)?.createdUserId;
    if (item && createdUserId === ccMyId) ownsItem = true;
    if (typeof createdUserId === "string" && createdUserId.length > 0) hasAnyPlayerOwner = true;
    // Check bubbles lock state
    const bubblesMeta = item?.metadata?.[BUBBLES_META_KEY] ?? item?.metadata?.[EXTERNAL_BUBBLES_META_KEY];
    if (bubblesMeta && typeof bubblesMeta === "object" && "locked" in bubblesMeta) {
      locked = !!bubblesMeta.locked;
    }
  } catch {}
  // 2026-05-12 — transient-read guard (mirror of bestiary/index.ts).
  // OBR can fire items.onChange mid-write with a transient empty
  // read OR a partial-metadata read missing the bound card id; without
  // this guard we'd hideInfo → reopen on the next onChange →
  // user-visible popover flicker on every resource-tracker click.
  // The outer items.onChange already debounces 30 ms so most multi-
  // firings collapse, but this is a belt-and-suspenders backstop.
  if (currentInfoCard && currentInfoItemId === itemId && (!item || !boundId)) {
    return;
  }
  if (!boundId) {
    if (currentInfoCard) await hideInfo();
    return;
  }
  const known = await getSceneCardIds();
  if (!known.has(boundId)) {
    if (currentInfoCard) await hideInfo();
    return;
  }
  const canShow = ccRole === "GM" || ownsItem || (!locked && hasAnyPlayerOwner);
  if (!canShow) {
    if (currentInfoCard) await hideInfo();
    return;
  }
  if (currentInfoCard === boundId) {
    // Same card, but the selected token may differ — refresh the
    // info-page's bound-token for quick-rolls.
    await showInfoFor(boundId, selection[0] ?? null);
    return;
  }
  await showInfoFor(boundId, selection[0] ?? null);
}

// 2026-05-14 — fetch the minimal card stats we need to push to bound
// tokens after a refresh / import / save. Server URL pattern mirrors
// `bind-page.ts`. Returns null on any failure (network, parse, missing
// fields) so callers can early-return without writing stale data.
async function fetchCardSnapshot(cardId: string): Promise<{
  maxHp: number | null;
  ac: number | null;
  initBonus: number | null;
} | null> {
  try {
    const roomId = (OBR.room?.id || "default").replace(/[^a-zA-Z0-9_-]/g, "_");
    const url = `${SERVER_ORIGIN}/characters/${encodeURIComponent(roomId)}/${encodeURIComponent(cardId)}/data.json`;
    // cache:'no-store' so multi-edit roundtrips don't see the previous
    // version sitting in HTTP cache. The data.json is small (typically
    // < 50 KB) so the per-edit fetch is cheap.
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const d = await res.json();
    const cs = d?.core_stats || {};
    const hp = cs.hp || {};
    return {
      maxHp: typeof hp.max === "number" ? hp.max : null,
      ac: typeof cs.ac === "number" ? cs.ac : null,
      initBonus: typeof cs.initiative === "number" ? cs.initiative : null,
    };
  } catch {
    return null;
  }
}

// Find every token bound to `cardId` and push the refreshed stats
// (max HP / AC / initiative dex-mod) into their metadata. CURRENT HP
// is preserved — see comment at BC_CARD_UPDATED above. GM-only, because
// the GM has write access to every bound token regardless of who owns
// it; players run their own copies of this listener but bail at the
// role gate so we don't fight over the same writes.
async function propagateCardRefresh(cardId: string): Promise<void> {
  if (ccRole !== "GM") return;
  const snap = await fetchCardSnapshot(cardId);
  if (!snap) return;
  // No-op if nothing meaningful to push (server returned a parseable
  // but empty data.json — avoids spurious metadata churn).
  if (snap.maxHp == null && snap.ac == null && snap.initBonus == null) return;
  try {
    const boundTokens = await OBR.scene.items.getItems(
      (it: any) =>
        (it.metadata as Record<string, unknown> | undefined)?.[BIND_META] === cardId,
    );
    if (boundTokens.length === 0) return;
    const ids = boundTokens.map((it: any) => it.id);
    await OBR.scene.items.updateItems(ids, (drafts: any[]) => {
      for (const d of drafts) {
        // Bubbles seed: merge new max/ac into whichever shape already
        // exists on the token (suite key takes priority, fall through
        // to legacy Stat-Bubbles external key). Preserves all other
        // bubble fields (current hp, temp hp, hide flag, lock flag).
        const cur = d.metadata[BUBBLES_META_KEY] as Record<string, unknown> | undefined;
        const ext = d.metadata[EXTERNAL_BUBBLES_META_KEY] as Record<string, unknown> | undefined;
        const existing = cur ?? ext ?? {};
        const next: Record<string, unknown> = { ...existing };
        if (snap.maxHp != null) next["max health"] = snap.maxHp;
        if (snap.ac != null) next["armor class"] = snap.ac;
        if (!("temporary health" in next)) next["temporary health"] = 0;
        d.metadata[BUBBLES_META_KEY] = next;
        if (d.metadata[EXTERNAL_BUBBLES_META_KEY] != null) {
          d.metadata[EXTERNAL_BUBBLES_META_KEY] = next;
        }
        if (snap.initBonus != null) {
          d.metadata[INIT_DEXMOD_META] = snap.initBonus;
        }
      }
    });
  } catch (e) {
    console.warn("[obr-suite/character-cards] propagateCardRefresh failed", e);
  }
}

export async function setupCharacterCards(): Promise<void> {
  try {
    const p = await OBR.player.getRole();
    ccRole = (p as "GM" | "PLAYER") || "PLAYER";
    ccMyId = await OBR.player.getId();
  } catch {}

  // The main panel opens/closes on broadcast from the cluster button or
  // from the Shift keyboard shortcut registered below.
  unsubs.push(
    OBR.broadcast.onMessage("com.character-cards/panel-open", async () => {
      await openMainPopover();
    })
  );

  // 角色卡界面 — a standalone TOOL in OBR's toolbar (its own top-level
  // icon, not an action nested under Select/etc.). `onClick` returns
  // false so the tool is never actually "selected" — the active tool
  // stays whatever it was; clicking just toggles the panel like a
  // button. CapsLock triggers it too. Replaces the cluster button.
  try {
    await OBR.tool.create({
      id: CC_TOOL_ID,
      shortcut: "CapsLock",
      icons: [
        {
          icon: ICON_URL,
          label: "角色卡界面",
        },
      ],
      onClick: async () => {
        await toggleMainPanel();
        return false; // don't switch the active tool — act as a button
      },
    });
  } catch (e) {
    console.error("[obr-suite/character-cards] create tool failed", e);
  }

  // CapsLock from inside the panel iframe also toggles (panel listens
  // for window keydown and broadcasts).
  unsubs.push(
    OBR.broadcast.onMessage("com.obr-suite/cc-shortcut-toggle", () => {
      toggleMainPanel();
    })
  );

  // Close the panel + info popover if scene unloads.
  unsubs.push(
    OBR.scene.onReadyChange(async (ready) => {
      if (!ready) {
        await closeMainPopover();
        await closeInfoPopover();
      }
    })
  );

  // Right-click context menu (GM only) to bind a card. Restricted to
  // CHARACTER-layer tokens — non-character props can't be bound to
  // a character card (2026-05-10).
  await OBR.contextMenu.create({
    id: CTX_BIND,
    icons: [
      {
        icon: ICON_URL,
        label: "绑定角色卡",
        filter: {
          roles: ["GM"],
          every: [
            { key: "type", value: "IMAGE" },
            { key: "layer", value: "CHARACTER" },
          ],
          max: 1,
        },
      },
    ],
    onClick: async (context) => {
      const id = context.items[0]?.id;
      if (!id) return;
      try {
        await OBR.modal.open({
          id: BIND_MODAL_ID,
          url: `${BIND_URL}?itemId=${encodeURIComponent(id)}`,
          width: 360,
          height: 480,
        });
      } catch (e) {
        console.error("[obr-suite/character-cards] open bind modal failed", e);
      }
    },
  });

  // Selection-based info popover.
  unsubs.push(
    OBR.player.onChange(async (player) => {
      try { await handleSelection(player.selection); } catch {}
    })
  );
  try {
    const sel = await OBR.player.getSelection();
    await handleSelection(sel);
  } catch {}

  // Auto-info toggle changes (cluster's popup toggle writes to the same
  // localStorage key + sends the same broadcast).
  unsubs.push(
    OBR.broadcast.onMessage(TOGGLE_MSG, async () => {
      try {
        const sel = await OBR.player.getSelection();
        await handleSelection(sel);
      } catch {}
    })
  );

  // 2026-05-14 — propagate refreshed card stats to bound tokens. Fires
  // on every BC_CARD_UPDATED, which panel-page broadcasts after xlsx
  // upload / xlsx refresh, and fullscreen-page broadcasts after JSON
  // import. Both sources now send LOCAL+REMOTE so the originating
  // client (often the GM) ALSO propagates — without LOCAL, only
  // remote viewers would see the new stats, and the DM would still
  // need to re-bind.
  unsubs.push(
    OBR.broadcast.onMessage(BC_CARD_UPDATED, async (event) => {
      const data = event.data as { cardId?: string } | undefined;
      if (!data?.cardId) return;
      await propagateCardRefresh(data.cardId);
    }),
  );

  // Hide info if the bound card was deleted from scene metadata, or its
  // host token was removed.
  unsubs.push(
    OBR.scene.onMetadataChange(async (meta) => {
      if (!currentInfoCard) return;
      if (!("com.character-cards/list" in meta)) return;
      const known = await getSceneCardIds();
      if (!known.has(currentInfoCard)) await hideInfo();
    })
  );
  // 2026-05-13 — debounced items.onChange. Mirror of bestiary/index.ts
  // (see comment there). OBR fires onChange multiple times per
  // updateItems with mid-draft empty / partial reads; debouncing
  // 30 ms collapses them so handleSelection only sees the final
  // committed state. Prevents the resource-panel flicker on every
  // resource-tracker click.
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;
  unsubs.push(
    OBR.scene.items.onChange(() => {
      if (!currentInfoCard) return;
      if (pendingTimer) clearTimeout(pendingTimer);
      pendingTimer = setTimeout(async () => {
        pendingTimer = null;
        try {
          const sel = await OBR.player.getSelection();
          await handleSelection(sel);
        } catch {}
      }, 30);
    })
  );

  // Re-anchor the info popover on browser resize. The popover anchors at
  // bottom-right, so a window resize visibly drifts it. Re-open with the
  // same URL (cardId + itemId) so OBR updates position without reloading
  // the iframe.
  const reanchorInfoPopover = async () => {
    if (!infoPopoverOpen || !currentInfoCard) return;
    const roomId = OBR.room.id || "default";
    // openInfoPopoverFor short-circuits when infoPopoverOpen is true,
    // so flip the flag and let it run the open path.
    infoPopoverOpen = false;
    await openInfoPopoverFor(currentInfoCard, roomId, currentInfoItemId);
  };
  unsubs.push(onViewportResize(reanchorInfoPopover));

  // Drag-end + reset → recompute anchor with new offset.
  unsubs.push(
    OBR.broadcast.onMessage(BC_PANEL_DRAG_END, async (event) => {
      const payload = event.data as DragEndPayload | undefined;
      if (payload?.panelId !== PANEL_IDS.ccInfo) return;
      await reanchorInfoPopover();
    }),
  );
  unsubs.push(
    OBR.broadcast.onMessage(BC_PANEL_RESET, async () => {
      await reanchorInfoPopover();
    }),
  );
}

export async function teardownCharacterCards(): Promise<void> {
  await closeMainPopover();
  await closeInfoPopover();
  try { await OBR.contextMenu.remove(CTX_BIND); } catch {}
  try { await OBR.tool.remove(CC_TOOL_ID); } catch {}
  for (const u of unsubs.splice(0)) u();
}
