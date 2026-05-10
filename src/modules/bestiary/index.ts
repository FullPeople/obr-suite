import OBR from "@owlbear-rodeo/sdk";
import { setupGroupSaves, teardownGroupSaves } from "./group-saves";
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
import { BC_LOCAL_CONTENT_CHANGED } from "../../utils/localContent";
import { clearMonsterCache, loadAllMonsters, getRawMonster } from "./data";
import { onStateChange, getState } from "../../state";
import { createCanvasDragMode } from "../../utils/canvasDragMode";

// Bestiary list panel bbox — RIGHT/TOP anchor. Always returns the
// expected bbox even when the panel isn't open (layout editor uses
// it for a proxy rectangle).
registerPanelBbox(PANEL_IDS.bestiaryPanel, async () => {
  try {
    const vw = await OBR.viewport.getWidth();
    const userOff = getPanelOffset(PANEL_IDS.bestiaryPanel);
    const sizeOverride = getPanelSize(PANEL_IDS.bestiaryPanel);
    const w = sizeOverride?.width ?? POPOVER_WIDTH;
    const h = sizeOverride?.height ?? POPOVER_HEIGHT;
    const anchorX = vw - RIGHT_OFFSET + userOff.dx;
    const anchorY = TOP_OFFSET + userOff.dy;
    return {
      left: anchorX - w,
      top: anchorY,
      width: w,
      height: h,
    };
  } catch { return null; }
});

// Monster info popover bbox — RIGHT/TOP anchor (since 2026-05-03 UI
// overhaul; was CENTER/TOP). Lives in the top-right corner; doesn't
// matter that it overlaps the bestiary list panel because deselecting
// a token clears it, which the user can do at any time.
registerPanelBbox(PANEL_IDS.bestiaryInfo, async () => {
  try {
    const vw = await OBR.viewport.getWidth();
    const userOff = getPanelOffset(PANEL_IDS.bestiaryInfo);
    const sizeOverride = getPanelSize(PANEL_IDS.bestiaryInfo);
    const w = sizeOverride?.width ?? INFO_WIDTH;
    const h = sizeOverride?.height ?? INFO_HEIGHT;
    const anchorRight = vw - INFO_RIGHT_OFFSET + userOff.dx;
    const anchorY = INFO_TOP_OFFSET + userOff.dy;
    return {
      left: anchorRight - w,
      top: anchorY,
      width: w,
      height: h,
    };
  } catch { return null; }
});

// Bestiary module — migrated from the standalone plugin.
//
// Setup creates the left-rail Tool icon (DM-only). When the DM activates
// the tool, the side panel opens; switching to any other tool closes it.
// Setup also wires DM-only selection-tracking that pops a monster info
// popover at top-center when a spawned monster is selected.

const PLUGIN_ID = "com.bestiary"; // backward-compat for existing scene metadata + broadcasts
const TOOL_ID = "com.obr-suite/bestiary-tool";
const POPOVER_ID = "com.obr-suite/bestiary-panel";
const INFO_POPOVER_ID = "com.obr-suite/bestiary-info";
const TOOL_ACTION_TOGGLE = "com.obr-suite/bestiary-toggle-shortcut";
const SELECT_TOOL = "rodeo.owlbear.tool/select";
const MOVE_TOOL = "rodeo.owlbear.tool/move";
const POPOVER_URL = assetUrl("bestiary-panel.html");
const INFO_URL = assetUrl("bestiary-monster-info.html");
const ICON_URL = assetUrl("bestiary-icon.svg");

const BESTIARY_SLUG_KEY = `${PLUGIN_ID}/slug`;
const BESTIARY_DATA_KEY = "com.bestiary/monsters";
const INFO_SHOW_MSG = `${PLUGIN_ID}/info-show`;

// 2026-05-10 — refresh-pass for the scene-meta `monsters` table.
// Triggered after BC_LOCAL_CONTENT_CHANGED. Walks every bound token
// and overwrites its scene-meta entry with the freshest data from
// rawBySlug (rehydrated by the loadAllMonsters call). Without this,
// a re-uploaded local JSON only updates the bestiary panel listing —
// the monster-info popover and group-saves both read from scene
// metadata and would keep showing the stale stat block.
async function refreshSharedMonsterTableFromLocal(): Promise<void> {
  // Force a fresh load of rawBySlug — the cache was just cleared.
  try { await loadAllMonsters(); } catch (e) {
    console.warn("[bestiary] refresh-from-local: loadAllMonsters failed", e);
    return;
  }
  let items: any[] = [];
  let table: Record<string, any> = {};
  try {
    const [meta, all] = await Promise.all([
      OBR.scene.getMetadata(),
      OBR.scene.items.getItems(),
    ]);
    items = all;
    table = (meta[BESTIARY_DATA_KEY] as Record<string, any>) || {};
  } catch (e) {
    console.warn("[bestiary] refresh-from-local: read failed", e);
    return;
  }
  const boundSlugs = new Set<string>();
  for (const it of items) {
    const slug = (it.metadata as any)?.[BESTIARY_SLUG_KEY];
    if (typeof slug !== "string" || !slug) continue;
    boundSlugs.add(slug);
  }
  if (boundSlugs.size === 0) return;
  const next: Record<string, any> = { ...table };
  let touched = 0;
  for (const slug of boundSlugs) {
    const raw = getRawMonster(slug);
    if (!raw) continue; // not in any enabled library — skip silently
    next[slug] = raw;
    touched++;
  }
  if (touched === 0) return;
  try {
    await OBR.scene.setMetadata({ [BESTIARY_DATA_KEY]: next });
    console.info(`[bestiary] refresh-from-local: refreshed ${touched} bound monster(s)`);
  } catch (e) {
    console.warn("[bestiary] refresh-from-local: setMetadata failed", e);
  }
}
const AUTO_POPUP_KEY = `${PLUGIN_ID}/auto-popup`;
const AUTO_POPUP_TOGGLE_MSG = `${PLUGIN_ID}/auto-popup-toggled`;
const CLOSE_MSG = `${PLUGIN_ID}/close`;

// Right-click context menu IDs (DM-only, see filter.roles below).
const CTX_BIND = "com.obr-suite/bestiary-bind";
const CTX_REBIND = "com.obr-suite/bestiary-rebind";
const CTX_UNBIND = "com.obr-suite/bestiary-unbind";
// Multi-select group variants (only show when ≥2 tokens are selected).
// Group bind = "pick a monster, apply to ALL selected, overwriting any
// previous binding". Group unbind = "remove the binding from each
// selected token that has one (untouched tokens are skipped)". Both
// sit alongside the single-select trio above so the existing UX for
// one-token operations stays exactly the same.
const CTX_GROUP_BIND = "com.obr-suite/bestiary-group-bind";
const CTX_GROUP_UNBIND = "com.obr-suite/bestiary-group-unbind";

// Picker modal — reuses the bestiary panel HTML with `?pickerForItemId=...`.
const PICKER_MODAL_ID = "com.obr-suite/bestiary-picker";

// Drag-spawn preview modal. Bestiary panel iframe broadcasts START on
// monster-card pointerdown; we open this modal with the payload baked
// into the URL hash. Modal owns the gesture and broadcasts DROP on
// release (panel iframe runs the actual spawn).
const MONSTER_DRAG_MODAL_ID = "com.obr-suite/bestiary-drag-preview";
const MONSTER_DRAG_URL = assetUrl("monster-drag-preview.html");
const BC_MONSTER_DRAG_START = "com.obr-suite/bestiary-drag-start";
const BC_MONSTER_DROP = "com.obr-suite/bestiary-drop";
const BC_MONSTER_DRAG_CANCEL = "com.obr-suite/bestiary-drag-cancel";

// Bubbles + Initiative metadata keys used when binding (must match
// spawn.ts so existing tokens look identical to freshly-spawned ones).
const BUBBLES_META = "com.obr-suite/bubbles/data";
const EXTERNAL_BUBBLES_META = "com.owlbear-rodeo-bubbles-extension/metadata";
const BUBBLES_NAME = "com.owlbear-rodeo-bubbles-extension/name";
const INITIATIVE_MODKEY = "com.initiative-tracker/dexMod";

const isAutoPopupOn = (): boolean => {
  try { return localStorage.getItem(AUTO_POPUP_KEY) !== "0"; } catch { return true; }
};

const POPOVER_WIDTH = 350;
const POPOVER_HEIGHT = 600;
const RIGHT_OFFSET = 60;
const TOP_OFFSET = 80;

const INFO_WIDTH = 520;
const INFO_HEIGHT = 340;
const INFO_TOP_OFFSET = 60;
// Right-edge inset for the info popover. Same offset as the bestiary
// list panel so they stack vertically against the right edge.
const INFO_RIGHT_OFFSET = 60;

const unsubs: Array<() => void> = [];
let isOpen = false;
let infoPopoverOpen = false;
let currentInfoSlug: string | null = null;
// Selected token id paired with currentInfoSlug. The monster info
// popover edits HP/AC on this token when the user types into the stat
// rows; we plumb it through the popover URL so the iframe knows which
// item to write to.
let currentInfoItemId: string | null = null;
let bestiaryRole: "GM" | "PLAYER" = "PLAYER";
let bestiaryMyId = "";  // own player ID — used by handleSelection's owner check
// Tracks the previous tool so CapsLock can toggle back to it when the user
// is currently on the bestiary tool.
let previousTool: string | null = null;

async function openPanel() {
  try {
    const vw = await OBR.viewport.getWidth();
    const userOff = getPanelOffset(PANEL_IDS.bestiaryPanel);
    const sizeOverride = getPanelSize(PANEL_IDS.bestiaryPanel);
    const w = sizeOverride?.width ?? POPOVER_WIDTH;
    const h = sizeOverride?.height ?? POPOVER_HEIGHT;
    await OBR.popover.open({
      id: POPOVER_ID,
      url: POPOVER_URL,
      width: w,
      height: h,
      anchorReference: "POSITION",
      anchorPosition: {
        left: vw - RIGHT_OFFSET + userOff.dx,
        top: TOP_OFFSET + userOff.dy,
      },
      anchorOrigin: { horizontal: "RIGHT", vertical: "TOP" },
      transformOrigin: { horizontal: "RIGHT", vertical: "TOP" },
      disableClickAway: true,
    });
    isOpen = true;
  } catch (e) {
    console.error("[obr-suite/bestiary] openPanel failed", e);
  }
}

async function closePanel() {
  try { await OBR.popover.close(POPOVER_ID); } catch {}
  isOpen = false;
}

async function openInfoPopoverFor(slug: string, itemId: string | null) {
  if (infoPopoverOpen) return;
  currentInfoItemId = itemId;
  try {
    const vw = await OBR.viewport.getWidth();
    const userOff = getPanelOffset(PANEL_IDS.bestiaryInfo);
    const sizeOverride = getPanelSize(PANEL_IDS.bestiaryInfo);
    const w = sizeOverride?.width ?? INFO_WIDTH;
    const h = sizeOverride?.height ?? INFO_HEIGHT;
    const itemQ = itemId ? `&itemId=${encodeURIComponent(itemId)}` : "";
    await OBR.popover.open({
      id: INFO_POPOVER_ID,
      url: `${INFO_URL}?slug=${encodeURIComponent(slug)}${itemQ}`,
      width: w,
      height: h,
      anchorReference: "POSITION",
      anchorPosition: {
        left: vw - INFO_RIGHT_OFFSET + userOff.dx,
        top: INFO_TOP_OFFSET + userOff.dy,
      },
      anchorOrigin: { horizontal: "RIGHT", vertical: "TOP" },
      transformOrigin: { horizontal: "RIGHT", vertical: "TOP" },
      hidePaper: true,
      disableClickAway: true,
    });
    infoPopoverOpen = true;
  } catch (e) {
    console.error("[obr-suite/bestiary] openInfoPopoverFor failed", e);
  }
}

async function closeInfoPopover() {
  try { await OBR.popover.close(INFO_POPOVER_ID); } catch {}
  infoPopoverOpen = false;
  currentInfoSlug = null;
  currentInfoItemId = null;
}

async function showInfoFor(slug: string, itemId: string | null) {
  if (currentInfoSlug === slug && currentInfoItemId === itemId && infoPopoverOpen) return;
  if (!infoPopoverOpen) {
    await openInfoPopoverFor(slug, itemId);
  } else {
    try {
      await OBR.broadcast.sendMessage(INFO_SHOW_MSG, { slug, itemId }, { destination: "LOCAL" });
    } catch {}
  }
  currentInfoSlug = slug;
  currentInfoItemId = itemId;
}

async function hideInfo() {
  // 2026-05-10: respect the user-driven pin via the new panel-pin
  // button. Selection-driven hide gets skipped when pinned. Explicit
  // closes (scene unload, manual teardown) call closeInfoPopover()
  // directly and bypass this guard.
  if (isMonsterInfoPinned()) return;
  if (!infoPopoverOpen && currentInfoSlug === null) return;
  await closeInfoPopover();
}

const LS_MONSTER_INFO_PINNED = "obr-suite/monster-info-pinned";
function isMonsterInfoPinned(): boolean {
  try { return localStorage.getItem(LS_MONSTER_INFO_PINNED) === "1"; } catch { return false; }
}

async function handleSelection(selection: string[] | undefined) {
  if (!isAutoPopupOn()) {
    if (currentInfoSlug) await hideInfo();
    return;
  }
  if (!selection || selection.length !== 1) {
    if (currentInfoSlug) await hideInfo();
    return;
  }
  let slug: string | null = null;
  let ownsItem = false;
  let locked = true;
  let item: any = null;
  const itemId = selection[0];
  try {
    const items = await OBR.scene.items.getItems(selection);
    item = items[0] ?? null;
    const m = item?.metadata?.[BESTIARY_SLUG_KEY];
    if (typeof m === "string") slug = m;
    const createdUserId = item?.createdUserId;
    if (item && createdUserId === bestiaryMyId) ownsItem = true;
    const bubblesMeta = item?.metadata?.[BUBBLES_META] ?? item?.metadata?.[EXTERNAL_BUBBLES_META];
    if (bubblesMeta && typeof bubblesMeta === "object") {
      const raw = (bubblesMeta as Record<string, unknown>)["locked"];
      locked = raw === undefined ? true : !!raw;
    }
  } catch (e) {
    console.warn("[obr-suite/bestiary] handleSelection getItems failed", e);
  }
  // 2026-05-12 — transient-read guard. OBR.scene.items.onChange can
  // fire MULTIPLE times per updateItems write (once during the draft
  // build, once on commit). The intra-draft read sometimes returns
  // an empty array OR a partially-applied metadata object missing
  // BESTIARY_SLUG_KEY. Without this guard the spurious "no slug" or
  // "no item" read would look like "the token was unbound /
  // disappeared" → hideInfo → closeInfoPopover → currentInfoSlug =
  // null → next firing reopens → user sees the popover flicker on
  // every resource-tracker click. The outer items.onChange already
  // debounces 30 ms so most multi-firings collapse, but if any
  // single empty/partial read still slips through and we're already
  // showing this exact itemId, treat as transient and bail.
  if (currentInfoSlug && currentInfoItemId === itemId && (!item || !slug)) {
    return;
  }
  if (!slug) {
    if (currentInfoSlug) await hideInfo();
    return;
  }
  // Permission gate — only DM and per-token owners. The global
  // "allowPlayerMonsters" flag (Settings → 全局搜索) is intentionally
  // NOT consulted here — that flag now strictly gates search-result
  // visibility, NOT the auto-popup.
  const canShow = bestiaryRole === "GM" || ownsItem;
  if (!canShow) {
    if (currentInfoSlug) await hideInfo();
    return;
  }
  // Re-issue showInfoFor whenever EITHER the slug changes or the
  // selected token changes (same monster type, different token), so
  // the iframe can re-bind its stat-row inputs to the new itemId.
  if (currentInfoSlug === slug && currentInfoItemId === itemId) {
    return;
  }
  await showInfoFor(slug, itemId);
}

export async function setupBestiary(): Promise<void> {
  // One-time migration: the legacy standalone "bestiary" / "character-
  // cards" plugins both wrote `com.bestiary/auto-popup = "0"` from
  // a UI that was visible to ALL roles. The suite hides the toggle
  // from non-GM, leaving players permanently stuck with auto-popup
  // off and no way to flip it back on. Clear the stale "0" once so
  // the new player-facing popover (owner-token) actually shows up.
  // Players + GM can now toggle it via the cluster row.
  try {
    const MIG_KEY = "obr-suite/bestiary-popup-migration-v2";
    if (localStorage.getItem(MIG_KEY) !== "done") {
      if (localStorage.getItem(AUTO_POPUP_KEY) === "0") {
        localStorage.removeItem(AUTO_POPUP_KEY);
      }
      localStorage.setItem(MIG_KEY, "done");
    }
  } catch {}
  // Local-content invalidation: when the user imports / removes a
  // homebrew JSON or MD file, drop our merged-monster cache so the
  // bestiary panel re-renders with the new entries. Also refresh
  // every bound token's scene-meta entry — the monster-info popover
  // + group-saves both read from `com.bestiary/monsters` scene
  // metadata, so without an overwrite-pass a modified local file
  // wouldn't propagate to currently-bound tokens (the user reported
  // "删除重新上传也没用 / re-upload doesn't update" 2026-05-10).
  unsubs.push(
    OBR.broadcast.onMessage(BC_LOCAL_CONTENT_CHANGED, () => {
      clearMonsterCache();
      void refreshSharedMonsterTableFromLocal();
    }),
  );

  // Library list change → also clear the monster cache. Without this
  // the panel keeps showing the old set even after a homebrew URL is
  // added/removed OR a per-source blacklist toggled in settings.
  // Signature includes baseUrl + disabledSources so both kinds of
  // mutation invalidate.
  const libSig = () => JSON.stringify(
    (getState().libraries || [])
      .filter((l) => l.enabled)
      .map((l) => `${l.baseUrl}|${(l.disabledSources ?? []).slice().sort().join(",")}`),
  );
  let lastLibSig = libSig();
  unsubs.push(
    onStateChange(() => {
      const sig = libSig();
      if (sig !== lastLibSig) {
        lastLibSig = sig;
        clearMonsterCache();
      }
    }),
  );

  // Tool: GM-only left-rail icon. Clicking activates our tool which opens
  // the panel via onToolChange below.
  await OBR.tool.create({
    id: TOOL_ID,
    icons: [
      {
        icon: ICON_URL,
        label: "怪物图鉴",
        filter: { roles: ["GM"] },
      },
    ],
    // Without `defaultMode`, OBR doesn't auto-activate any mode when
    // the tool becomes active — its modes only fire if the user
    // manually clicks one. Pointing this at our drag mode means the
    // moment the GM activates the bestiary tool, the drag handlers
    // are live.
    defaultMode: `${TOOL_ID}/mode`,
    onClick: async () => {
      await OBR.tool.activateTool(TOOL_ID);
      return false;
    },
  });

  // Browse mode — uses the shared canvasDragMode util so the GM can
  // drag tokens / box-select while the bestiary panel is open. The
  // util implements token-move + marquee + transformer no-op the
  // same way the bubble-guard mode under Select does.
  //
  // (Earlier rounds tried `preventDrag: never-match`, hoping OBR's
  // canvas-level token-move fallback would kick in. Empirically that
  // fallback doesn't run for plugin-owned tools, so token drags
  // silently no-oped. The util takes over the gesture explicitly.)
  await createCanvasDragMode({
    modeId: `${TOOL_ID}/mode`,
    toolId: TOOL_ID,
    icon: ICON_URL,
    label: "浏览",
  });

  // Track previous tool + open/close panel based on which tool is active.
  unsubs.push(
    OBR.tool.onToolChange(async (activeId) => {
      if (activeId === TOOL_ID) {
        if (!isOpen) await openPanel();
      } else {
        // Remember the tool the user was on so CapsLock can return there.
        previousTool = activeId;
        if (isOpen) await closePanel();
      }
    })
  );

  // ② CapsLock shortcut. Two paths to the same toggle:
  //   a) OBR tool action shortcut (works when keyboard focus is on OBR's
  //      main window — i.e. user hasn't clicked into the panel iframe yet)
  //   b) keydown listener inside the panel iframe (works once the user
  //      has clicked into the panel) → broadcasts to here.
  const performShortcutToggle = async () => {
    try {
      const cur = await OBR.tool.getActiveTool();
      if (cur === TOOL_ID) {
        await OBR.tool.activateTool(previousTool ?? MOVE_TOOL);
      } else {
        previousTool = cur;
        await OBR.tool.activateTool(TOOL_ID);
      }
    } catch (e) {
      console.error("[obr-suite/bestiary] CapsLock toggle failed", e);
    }
  };

  // Player clients don't get the bestiary shortcut registered — the
  // bestiary tool itself is GM-only (filter.roles = ["GM"] above), so
  // wiring up Shift+A on Select for non-GMs would just light up a
  // shortcut that activates a hidden tool. Snapshot role here; a mid-
  // session role flip is rare and the action survives a reload.
  let bestiaryRoleAtSetup: "GM" | "PLAYER" = "PLAYER";
  try { bestiaryRoleAtSetup = (await OBR.player.getRole()) as "GM" | "PLAYER"; } catch {}
  if (bestiaryRoleAtSetup === "GM") {
    try {
      await OBR.tool.createAction({
        id: TOOL_ACTION_TOGGLE,
        shortcut: "Shift+A",
        icons: [
          {
            icon: ICON_URL,
            label: "切换怪物图鉴",
            filter: { activeTools: [SELECT_TOOL, TOOL_ID] },
          },
        ],
        onClick: performShortcutToggle,
      });
    } catch (e) {
      console.error("[obr-suite/bestiary] createAction failed", e);
    }
  }

  unsubs.push(
    OBR.broadcast.onMessage("com.obr-suite/bestiary-shortcut-toggle", () => {
      performShortcutToggle();
    })
  );

  // Panel close button broadcasts → switch to default move tool.
  unsubs.push(
    OBR.broadcast.onMessage(CLOSE_MSG, async () => {
      try { await OBR.tool.activateTool("rodeo.owlbear.tool/move"); }
      catch { await closePanel(); }
    })
  );

  // --- Monster info popover (auto-popup on selection) ---
  // GM always gets it. Players also get it in two cases:
  //   1. Suite's `allowPlayerMonsters` flag is on (Settings → 全局
  //      搜索 → "允许玩家查询怪物") — global flag for the room
  //   2. The selected token's `createdUserId` matches the player's
  //      ID (i.e. DM gave them Owner permission for that token)
  // Both checks happen inside handleSelection per-selection — keeping
  // it inline means we don't need any registration-time gate.
  try { bestiaryRole = (await OBR.player.getRole()) as "GM" | "PLAYER"; } catch {}
  try { bestiaryMyId = await OBR.player.getId(); } catch {}
  // Snapshot at setup time. The OBR.player.onChange listener below
  // refreshes bestiaryRole live, but the late `if (!isGMNow) return`
  // gate uses this initial value — registering bind / spawn / group
  // -saves only matters at module load. A role flip mid-session is
  // rare enough to not warrant tearing those down.
  const isGMNow = bestiaryRole === "GM";
  // Track role / ID changes so they take effect mid-session without
  // a reload.
  unsubs.push(
    OBR.player.onChange(async (player) => {
      const nextRole = (player.role as "GM" | "PLAYER") || bestiaryRole;
      if (nextRole !== bestiaryRole) bestiaryRole = nextRole;
      if (player.id && player.id !== bestiaryMyId) bestiaryMyId = player.id;
      try { await handleSelection(player.selection); } catch (e) {
        console.warn("[obr-suite/bestiary] handleSelection from onChange threw:", e);
      }
    })
  );
  // State change (DM flips allowPlayerMonsters) → re-evaluate the
  // current selection. If it just became visible / invisible, the
  // popover opens / closes.
  unsubs.push(
    onStateChange(async () => {
      try {
        const sel = await OBR.player.getSelection();
        await handleSelection(sel);
      } catch {}
    })
  );

  // Cleanup on scene-close — harmless to register even for non-GM.
  unsubs.push(
    OBR.scene.onReadyChange(async (ready) => {
      if (!ready) await closeInfoPopover();
    })
  );

  // Initial render: if a bound monster is already selected when the
  // module mounts, show the popover (if permission allows).
  try {
    const sel = await OBR.player.getSelection();
    await handleSelection(sel);
  } catch {}

  unsubs.push(
    OBR.broadcast.onMessage(AUTO_POPUP_TOGGLE_MSG, async () => {
      try {
        const sel = await OBR.player.getSelection();
        await handleSelection(sel);
      } catch {}
    })
  );

  // 2026-05-13 — debounced items.onChange. OBR fires the listener
  // MULTIPLE times per single updateItems write (verified via diag
  // logs): once or twice during the draft-build phase + once on
  // commit. The mid-draft reads sometimes return transient empty
  // arrays or items with partially-applied metadata, which made
  // handleSelection see "slug missing" → hideInfo → closeInfoPopover
  // → next firing reopens the popover → user-visible flicker (whole
  // popover rebuilds, tab indicator slide replays, resource panel
  // gets unmounted + remounted).
  //
  // HP/AC/lock edits flickered too in principle, but their visible
  // surface (input elements + an icon) doesn't have animated state
  // changes during the rebuild, so the user only noticed the
  // resource panel's flicker (transitions on .rt-pane / .rt-pill-icon
  // / .rt-tab-indicator).
  //
  // Collapsing all firings within 30 ms into ONE handleSelection call
  // means we only ever read the FINAL committed state. The remaining
  // empty-read guards inside handleSelection are kept as defence-in-
  // depth (the resource panel's own items.onChange listener is left
  // un-debounced because its refresh() does incremental DOM diff).
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;
  unsubs.push(
    OBR.scene.items.onChange(() => {
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

  // Re-anchor popovers on viewport resize. The `isOpen` check covers
  // the bestiary list panel (GM-only — players never have it open),
  // and `infoPopoverOpen` covers the info popover (now player-
  // accessible). Always-on; internal flags gate.
  unsubs.push(
    onViewportResize(async () => {
      if (isOpen) await openPanel();
      if (infoPopoverOpen && currentInfoSlug) {
        infoPopoverOpen = false;
        await openInfoPopoverFor(currentInfoSlug, currentInfoItemId);
      }
    }),
  );

  // Drag-end + reset broadcasts → re-anchor whichever popover got
  // dragged. Same internal-flag gating.
  unsubs.push(
    OBR.broadcast.onMessage(BC_PANEL_DRAG_END, async (event) => {
      const payload = event.data as DragEndPayload | undefined;
      if (payload?.panelId === PANEL_IDS.bestiaryPanel) {
        if (isOpen) await openPanel();
      } else if (payload?.panelId === PANEL_IDS.bestiaryInfo) {
        if (infoPopoverOpen && currentInfoSlug) {
          infoPopoverOpen = false;
          await openInfoPopoverFor(currentInfoSlug, currentInfoItemId);
        }
      }
    }),
  );

  // Past this point: GM-only — bind/spawn/group-saves.
  if (!isGMNow) return;

  // --- Right-click context menu: bind / rebind / unbind ---
  // Three entries with mutually-exclusive filters keyed on the
  // `BESTIARY_SLUG_KEY` metadata so each token only ever shows the
  // entry that makes sense for its current state. Plus two more
  // (CTX_GROUP_BIND / CTX_GROUP_UNBIND) gated on min:2 for bulk
  // operations.
  const openPicker = async (itemIds: string[]) => {
    if (itemIds.length === 0) return;
    try {
      await OBR.modal.open({
        id: PICKER_MODAL_ID,
        // Comma-joined ids in a single param. The picker page reads
        // it via `pickerForItemIds` (plural), falling back to the
        // legacy `pickerForItemId` (singular) for the existing
        // single-select context menu entries.
        url: `${POPOVER_URL}?pickerForItemIds=${encodeURIComponent(itemIds.join(","))}`,
        width: 400,
        height: 600,
      });
    } catch (e) {
      console.error("[obr-suite/bestiary] open picker failed", e);
    }
  };
  try {
    // 2026-05-10: bestiary context entries are now restricted to
    // CHARACTER-layer tokens. Single-target menus (max:1) require the
    // selected item to be CHARACTER. Group menus require at least one
    // CHARACTER in the selection — handlers further filter to that
    // subset before doing anything, so a mixed box-select silently
    // skips non-character props.
    await OBR.contextMenu.create({
      id: CTX_BIND,
      icons: [
        {
          icon: ICON_URL,
          label: "绑定怪物图鉴",
          filter: {
            roles: ["GM"],
            every: [
              { key: "type", value: "IMAGE" },
              { key: "layer", value: "CHARACTER" },
              { key: ["metadata", BESTIARY_SLUG_KEY], value: undefined },
            ],
            max: 1,
          },
        },
      ],
      onClick: (ctx) => {
        const id = ctx.items[0]?.id;
        if (id) void openPicker([id]);
      },
    });
    await OBR.contextMenu.create({
      id: CTX_REBIND,
      icons: [
        {
          icon: ICON_URL,
          label: "更换怪物图鉴",
          filter: {
            roles: ["GM"],
            every: [
              { key: "type", value: "IMAGE" },
              { key: "layer", value: "CHARACTER" },
              { key: ["metadata", BESTIARY_SLUG_KEY], operator: "!=", value: undefined },
            ],
            max: 1,
          },
        },
      ],
      onClick: (ctx) => {
        const id = ctx.items[0]?.id;
        if (id) void openPicker([id]);
      },
    });
    await OBR.contextMenu.create({
      id: CTX_UNBIND,
      icons: [
        {
          icon: ICON_URL,
          label: "移除怪物图鉴绑定",
          filter: {
            roles: ["GM"],
            every: [
              { key: "type", value: "IMAGE" },
              { key: "layer", value: "CHARACTER" },
              { key: ["metadata", BESTIARY_SLUG_KEY], operator: "!=", value: undefined },
            ],
            max: 1,
          },
        },
      ],
      onClick: async (ctx) => {
        const ids = ctx.items.map((i) => i.id);
        if (ids.length === 0) return;
        try {
          await OBR.scene.items.updateItems(ids, (drafts) => {
            for (const d of drafts) {
              delete d.metadata[BESTIARY_SLUG_KEY];
              // Bubbles HP/AC and the bound name are kept — the user
              // may want to re-bind later or just continue without
              // the stat-block link. Only the slug reference is
              // removed, which is what disables the auto-popup +
              // info popover behavior.
            }
          });
        } catch (e) {
          console.error("[obr-suite/bestiary] unbind failed", e);
        }
      },
    });

    // === Group operations (≥ 2 selected tokens) ===
    await OBR.contextMenu.create({
      id: CTX_GROUP_BIND,
      icons: [
        {
          icon: ICON_URL,
          label: "群体绑定怪物图鉴",
          filter: {
            roles: ["GM"],
            // ALL selected tokens must be IMAGE; metadata state can
            // be anything (bind overwrites whatever was there). Show
            // only when at least one CHARACTER-layer token is in the
            // selection — handler trims to the character subset.
            every: [{ key: "type", value: "IMAGE" }],
            some: [{ key: "layer", value: "CHARACTER" }],
            min: 2,
          },
        },
      ],
      onClick: (ctx) => {
        const ids = ctx.items
          .filter((it) => it.layer === "CHARACTER")
          .map((i) => i.id);
        if (ids.length >= 1) void openPicker(ids);
      },
    });
    await OBR.contextMenu.create({
      id: CTX_GROUP_UNBIND,
      icons: [
        {
          icon: ICON_URL,
          label: "群体移除怪物图鉴",
          filter: {
            roles: ["GM"],
            // Show only when at least one CHARACTER-layer token in the
            // selection actually has a binding. (Both predicates apply
            // to the SAME item — `some` requires AT LEAST ONE item to
            // satisfy the AND of every condition listed inside it.)
            // The handler then iterates and removes the metadata from
            // the bound character subset only.
            every: [{ key: "type", value: "IMAGE" }],
            some: [
              { key: "layer", value: "CHARACTER" },
              { key: ["metadata", BESTIARY_SLUG_KEY], operator: "!=", value: undefined },
            ],
            min: 2,
          },
        },
      ],
      onClick: async (ctx) => {
        // Filter to character tokens with a slug — no point writing
        // to non-character props or already-unbound tokens.
        const ids = ctx.items
          .filter(
            (it) =>
              it.layer === "CHARACTER" &&
              (it.metadata as any)?.[BESTIARY_SLUG_KEY] != null,
          )
          .map((i) => i.id);
        if (ids.length === 0) return;
        try {
          await OBR.scene.items.updateItems(ids, (drafts) => {
            for (const d of drafts) {
              delete d.metadata[BESTIARY_SLUG_KEY];
            }
          });
        } catch (e) {
          console.error("[obr-suite/bestiary] group unbind failed", e);
        }
      },
    });
  } catch (e) {
    console.error("[obr-suite/bestiary] context menu register failed", e);
  }

  // (onReadyChange + player.onChange + initial handleSelection +
  // AUTO_POPUP_TOGGLE_MSG + scene.items.onChange were moved out of
  // the GM-only block earlier so player-with-permission also gets
  // the info popover. See refactor above the `if (!isGMNow) return;`
  // line.)

  // DM-only group-saves popover. Auto-shows when 2+ selected tokens
  // are all bestiary-bound monsters. Lifecycle is paired with the
  // bestiary module's own setup/teardown.
  await setupGroupSaves();

  // (onViewportResize + BC_PANEL_DRAG_END handlers moved up — they're
  // now registered always-on with internal isOpen / infoPopoverOpen
  // gates, so the player-accessible info popover gets re-anchored too.)
  unsubs.push(
    OBR.broadcast.onMessage(BC_PANEL_RESET, async () => {
      if (isOpen) await openPanel();
      if (infoPopoverOpen && currentInfoSlug) {
        infoPopoverOpen = false;
        await openInfoPopoverFor(currentInfoSlug, currentInfoItemId);
      }
    }),
  );

  // === Drag-spawn modal lifecycle ====================================
  // BC_MONSTER_DRAG_START arrives from the bestiary panel iframe when
  // the user pointer-downs a monster card and starts dragging. We open
  // a fullscreen monster-drag-preview modal with the payload baked into
  // the URL hash. The modal owns the gesture from there and broadcasts
  // BC_MONSTER_DROP / BC_MONSTER_DRAG_CANCEL on release. Both handlers
  // close us; the panel iframe (NOT this background module) runs the
  // actual spawn since it has the loaded monster list / data cache.
  let dragModalOpen = false;
  let dragSafetyTimer: ReturnType<typeof setTimeout> | null = null;
  const closeDragModal = async () => {
    if (dragSafetyTimer) {
      clearTimeout(dragSafetyTimer);
      dragSafetyTimer = null;
    }
    if (!dragModalOpen) return;
    dragModalOpen = false;
    try { await OBR.modal.close(MONSTER_DRAG_MODAL_ID); } catch {}
  };
  unsubs.push(
    OBR.broadcast.onMessage(BC_MONSTER_DRAG_START, async (event) => {
      const payload = event.data as Record<string, unknown> | undefined;
      if (!payload?.slug) return;
      const url = `${MONSTER_DRAG_URL}#${encodeURIComponent(JSON.stringify(payload))}`;
      try {
        if (dragModalOpen) await OBR.modal.close(MONSTER_DRAG_MODAL_ID);
        await OBR.modal.open({
          id: MONSTER_DRAG_MODAL_ID,
          url,
          fullScreen: true,
          hidePaper: true,
        });
        dragModalOpen = true;
        // Background safety net — even if every modal-side cancel
        // misfires, force-close after 35s. Same pattern as the panel
        // drag-preview modal.
        if (dragSafetyTimer) clearTimeout(dragSafetyTimer);
        dragSafetyTimer = setTimeout(() => {
          console.warn("[bestiary/drag] background safety: force-closing stuck modal");
          void closeDragModal();
        }, 35_000);
      } catch (e) {
        console.warn("[bestiary/drag] open failed", e);
      }
    }),
  );
  unsubs.push(
    OBR.broadcast.onMessage(BC_MONSTER_DROP, () => { void closeDragModal(); }),
  );
  unsubs.push(
    OBR.broadcast.onMessage(BC_MONSTER_DRAG_CANCEL, () => { void closeDragModal(); }),
  );
}

export async function teardownBestiary(): Promise<void> {
  await teardownGroupSaves();
  await closePanel();
  await closeInfoPopover();
  try { await OBR.modal.close(PICKER_MODAL_ID); } catch {}
  try { await OBR.tool.removeAction(TOOL_ACTION_TOGGLE); } catch {}
  try { await OBR.tool.removeMode(`${TOOL_ID}/mode`); } catch {}
  try { await OBR.tool.remove(TOOL_ID); } catch {}
  try { await OBR.contextMenu.remove(CTX_BIND); } catch {}
  try { await OBR.contextMenu.remove(CTX_REBIND); } catch {}
  try { await OBR.contextMenu.remove(CTX_UNBIND); } catch {}
  try { await OBR.contextMenu.remove(CTX_GROUP_BIND); } catch {}
  try { await OBR.contextMenu.remove(CTX_GROUP_UNBIND); } catch {}
  for (const u of unsubs.splice(0)) u();
}
