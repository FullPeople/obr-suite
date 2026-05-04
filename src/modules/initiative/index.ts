import OBR from "@owlbear-rodeo/sdk";
import {
  METADATA_KEY,
  OPTED_OUT_KEY,
  COMBAT_STATE_KEY,
  BROADCAST_OPEN_PANEL,
  BROADCAST_CLOSE_PANEL,
  NEW_ITEM_DIALOG_ID,
} from "./utils/constants";
import { Lang, t } from "./utils/i18n";
import {
  startSceneSync as startSuiteSync,
  getLocalLang,
  onLangChange,
} from "../../state";
import { assetUrl } from "../../asset-base";
// `syncStealthOverlays` removed alongside the stealth context menu
// (2026-05-04 — feature was unfinished). `clearStealthOverlays` is
// kept so we can sweep legacy overlay items on scene ready.
import { clearStealthOverlays } from "./utils/visualEffects";
import { onViewportResize } from "../../utils/viewportAnchor";
// STABLE_HIDES previously gated the stealth context menu — that
// menu was deleted 2026-05-04 (see registerContextMenus). Import
// removed.
import {
  PANEL_IDS,
  getPanelOffset,
  registerPanelBbox,
  BC_PANEL_DRAG_END,
  BC_PANEL_RESET,
  type DragEndPayload,
} from "../../utils/panelLayout";

// Initiative panel bbox — CENTER/TOP anchor. Always returns the
// expected bbox even when the panel isn't open so the layout editor
// can render a proxy for pre-arrangement.
registerPanelBbox(PANEL_IDS.initiative, async () => {
  try {
    const vw = await OBR.viewport.getWidth();
    const expanded = lastExpandedState();
    const w = expanded ? EXPANDED_WIDTH : COLLAPSED_WIDTH;
    const h = expanded ? EXPANDED_HEIGHT : COLLAPSED_HEIGHT;
    const userOff = getPanelOffset(PANEL_IDS.initiative);
    const anchorX = Math.round(vw / 2) + userOff.dx;
    const anchorY = TOP_OFFSET + userOff.dy;
    return {
      left: anchorX - w / 2,
      top: anchorY,
      width: w,
      height: h,
    };
  } catch { return null; }
});

// localStorage flag (per-GM-client) controlling whether dragging a token
// into the scene during prep/combat triggers the auto-prompt to add it
// to initiative. Default ON. Read at watcher fire-time so toggling takes
// effect for the next drag without needing a re-subscribe.
const DRAG_IN_AUTO_KEY = "obr-suite/initiative/drag-in-auto";
function getDragInAutoEnabled(): boolean {
  try {
    return localStorage.getItem(DRAG_IN_AUTO_KEY) !== "0";
  } catch {
    return true;
  }
}

// Initiative Tracker module — migrated from the standalone plugin.
// Setup opens the top-center horizontal initiative strip popover, registers
// the right-click "add to initiative" / "remove from initiative" / "gather
// here" context menus, listens for broadcasts that toggle expanded state,
// and (GM only) watches scene items to prompt initiative for new tokens
// during active combat. Teardown unwinds all of the above.

const POPOVER_ID = "com.obr-suite/initiative-panel";
const PANEL_URL = assetUrl("initiative-panel.html");
const NEW_ITEM_URL = assetUrl("initiative-new-item.html");
const ICON_URL = assetUrl("initiative-icon.svg");

// Hover-ring auto-hide watchdog. The previous round tried a broadcast
// heartbeat from the panel iframe ("panel-alive"), but in practice
// the broadcast occasionally never reached this BG iframe and the
// ring stayed visible after panel close. Replaced with a metadata
// timestamp poll:
//
//   1. visualEffects.ts stamps `META_HOVER_LAST_SHOWN_TS` on the
//      hover ring's metadata every time it's (re-)shown — a single
//      additional immer-tracked field on the same updateItems call
//      that already toggles visibility/position.
//   2. This module polls scene.local every second, finds visible
//      hover rings whose timestamp is older than 3 s, and parks them
//      (visible=false, attachedTo=undefined). Costs one IPC/sec; cheap
//      and self-stops when no hover rings exist anyway since the
//      query returns zero items.
//
// The active (red) ring is left alone — its rotating turn marker
// should persist scene-wide as long as combat is running, regardless
// of panel state.
const TAG_RING_HOVER = "com.initiative-tracker/ring-hover";
const META_HOVER_LAST_SHOWN_TS = "com.initiative-tracker/ring-hover-last-shown-ts";
const HOVER_AUTO_HIDE_MS = 3000;
const HOVER_POLL_INTERVAL_MS = 1000;
// Off-map park position. Mirror of `PARK` in `utils/visualEffects.ts`
// — the ring item stays alive (creation cost is non-trivial and we
// reuse the same item across re-shows) but is parked far enough off
// any plausible scene that no rendering can reach it. Using just
// `visible = false` was empirically not enough: a faint semi-
// transparent halo still showed at the ring's last position.
const PARK_OFF_MAP = { x: -1_000_000, y: -1_000_000 };
let hoverAutoHidePoll: ReturnType<typeof setInterval> | null = null;

async function tickHoverAutoHide(): Promise<void> {
  try {
    const items = await OBR.scene.local.getItems(
      (i) => i.metadata[TAG_RING_HOVER] === true && i.visible === true,
    );
    if (items.length === 0) return;
    const now = Date.now();
    const stale: string[] = [];
    for (const it of items) {
      const ts = (it.metadata as any)[META_HOVER_LAST_SHOWN_TS];
      // Treat missing / non-numeric timestamps as instantly stale —
      // they mean either the ring was created by an older code path
      // that didn't stamp ts, or the metadata was never set.
      if (typeof ts !== "number" || now - ts > HOVER_AUTO_HIDE_MS) {
        stale.push(it.id);
      }
    }
    if (stale.length === 0) return;
    await OBR.scene.local.updateItems(stale, (drafts) => {
      for (const d of drafts) {
        d.visible = false;
        d.attachedTo = undefined;
        // Park off-map so any residual render (semi-transparent halo
        // OBR sometimes shows on `visible = false` attached items
        // — observed empirically) lands far outside the scene.
        d.position = { ...PARK_OFF_MAP };
      }
    });
  } catch {}
}

const COLLAPSED_WIDTH = 120;
const COLLAPSED_HEIGHT = 40;
const EXPANDED_WIDTH = 720;
// Reduced 184 → 154 (-30 px) per user request — the trailing 22 px
// of breathing room for the now-hidden horizontal scrollbar isn't
// needed any more (we hide the scrollbar with `scrollbar-width:
// none` and provide wheel + drag scrolling instead).
const EXPANDED_HEIGHT = 154;
const TOP_OFFSET = 45;

const CTX_TOGGLE = `${METADATA_KEY}/context-menu`;
const CTX_GATHER = `${METADATA_KEY}/gather-empty`;
// CTX_INVISIBLE removed 2026-05-04 — see registerContextMenus().

const unsubs: Array<() => void> = [];
let knownItemIds = new Set<string>();
let initiativeRole: "GM" | "PLAYER" = "PLAYER";

// Tracks whether the initiative panel is currently displayed so the
// viewport-resize handler can avoid spawning a popover when it
// shouldn't be visible (scene not ready / module disabled).
let panelIsOpen = false;
// Last expanded flag passed to openPanel — needed because the panel
// iframe owns expand/collapse via setWidth/setHeight on its own (the
// panel page persists `it-expanded` to localStorage), so when we
// re-anchor we don't have a way to query the current state from this
// module. Reading the localStorage key directly here keeps the
// re-anchored popover at the user's last expand state.
const IT_EXPANDED_KEY = "it-expanded";
function lastExpandedState(): boolean {
  try { return localStorage.getItem(IT_EXPANDED_KEY) !== "0"; } catch { return true; }
}

async function openPanel(expanded: boolean) {
  const width = expanded ? EXPANDED_WIDTH : COLLAPSED_WIDTH;
  const height = expanded ? EXPANDED_HEIGHT : COLLAPSED_HEIGHT;
  try {
    const vw = await OBR.viewport.getWidth();
    const userOff = getPanelOffset(PANEL_IDS.initiative);
    await OBR.popover.open({
      id: POPOVER_ID,
      url: `${PANEL_URL}?expanded=${expanded ? 1 : 0}`,
      width,
      height,
      anchorReference: "POSITION",
      anchorPosition: {
        left: Math.round(vw / 2) + userOff.dx,
        top: TOP_OFFSET + userOff.dy,
      },
      anchorOrigin: { horizontal: "CENTER", vertical: "TOP" },
      transformOrigin: { horizontal: "CENTER", vertical: "TOP" },
      disableClickAway: true,
      hidePaper: true,
    });
    panelIsOpen = true;
  } catch (e) {
    console.error("[obr-suite/initiative] openPanel failed", e);
  }
}

async function closePanel() {
  try { await OBR.popover.close(POPOVER_ID); } catch {}
  panelIsOpen = false;
}

async function initKnownItems() {
  try {
    if (!(await OBR.scene.isReady())) return;
    const all = await OBR.scene.items.getItems(
      (item) =>
        item.type === "IMAGE" &&
        (item.layer === "CHARACTER" || item.layer === "MOUNT")
    );
    knownItemIds.clear();
    all.forEach((i) => knownItemIds.add(i.id));
  } catch (e) {
    console.error("[obr-suite/initiative] initKnown failed", e);
  }
}

// Re-registration of context menus when the suite language flips. OBR has
// no API to "update an existing context menu's label", so we remove and
// re-create with the new lang each time. The handlers re-read lang on each
// click via the closure.
async function registerContextMenus(lang: Lang) {
  try { await OBR.contextMenu.remove(CTX_TOGGLE); } catch {}
  try { await OBR.contextMenu.remove(CTX_GATHER); } catch {}
  // Legacy CTX_INVISIBLE id — still removed on teardown so any
  // session that already had it registered cleans up properly.
  try { await OBR.contextMenu.remove(`${METADATA_KEY}/invisibility`); } catch {}

  await OBR.contextMenu.create({
    id: CTX_TOGGLE,
    icons: [
      {
        icon: ICON_URL,
        label: t(lang, "addToInitiative"),
        filter: {
          every: [
            { key: "type", value: "IMAGE" },
            { key: ["metadata", METADATA_KEY], value: undefined },
          ],
        },
      },
      {
        icon: ICON_URL,
        label: t(lang, "removeFromInitiative"),
        filter: {
          every: [{ key: "type", value: "IMAGE" }],
          some: [
            { key: ["metadata", METADATA_KEY], value: undefined, operator: "!=" },
          ],
        },
      },
    ],
    onClick: async (context) => {
      const anyHasData = context.items.some(
        (item) => item.metadata[METADATA_KEY] !== undefined
      );
      const ids = context.items.map((i) => i.id);
      if (anyHasData) {
        await OBR.scene.items.updateItems(ids, (drafts) => {
          for (const d of drafts) {
            delete d.metadata[METADATA_KEY];
            d.metadata[OPTED_OUT_KEY] = true;
          }
        });
      } else {
        await OBR.scene.items.updateItems(ids, (drafts) => {
          for (const d of drafts) {
            d.metadata[METADATA_KEY] = {
              count: 0,
              active: false,
              rolled: false,
              tiebreak: Math.random(),
              ownerId: d.createdUserId,
            };
            delete d.metadata[OPTED_OUT_KEY];
          }
        });
      }
    },
  });

  await OBR.contextMenu.create({
    id: CTX_GATHER,
    icons: [
      {
        icon: ICON_URL,
        label: t(lang, "gatherHere"),
        filter: { roles: ["GM"], min: 0, max: 0 },
      },
    ],
    onClick: async (context) => {
      const center = context.selectionBounds.center;
      const items = await OBR.scene.items.getItems(
        (item: any) =>
          item.metadata[METADATA_KEY] !== undefined && item.visible
      );
      if (items.length === 0) return;

      let dpi = 150;
      try { dpi = await OBR.scene.grid.getDpi(); } catch {}
      const spacing = dpi;

      const positions: { x: number; y: number }[] = [
        { x: center.x, y: center.y },
      ];
      let ring = 1;
      while (positions.length < items.length) {
        const count = ring * 6;
        for (let i = 0; i < count && positions.length < items.length; i++) {
          const angle = (i / count) * 2 * Math.PI - Math.PI / 2;
          positions.push({
            x: center.x + Math.cos(angle) * spacing * ring,
            y: center.y + Math.sin(angle) * spacing * ring,
          });
        }
        ring++;
      }

      const ids = items.map((i) => i.id);
      await OBR.scene.items.updateItems(ids, (drafts) => {
        drafts.forEach((d, idx) => {
          if (positions[idx]) d.position = positions[idx];
        });
      });
      // Notification removed per user feedback — silent gather.
    },
  });

  // Stealth toggle (mark invisible / reveal) deleted 2026-05-04 —
  // the underlying overlay shader was never finished, so exposing
  // a context menu that flips a flag with no visible effect is
  // user-hostile. The metadata key (`METADATA_KEY.invisible`) is
  // still read elsewhere; if any old scenes have it set, it just
  // sits there harmlessly until / unless we revive the feature.
}

export async function setupInitiative(): Promise<void> {
  // Read current per-client language and register context menus.
  startSuiteSync();
  const initialLang = (getLocalLang() as Lang) ?? "zh";
  await registerContextMenus(initialLang);

  // Re-register on language change so the right-click labels refresh.
  let lastLang = initialLang;
  unsubs.push(
    onLangChange((l) => {
      const next = (l as Lang) ?? "zh";
      if (next !== lastLang) {
        lastLang = next;
        registerContextMenus(next).catch(() => {});
      }
    })
  );

  // --- Open the panel now if scene is ready, and re-open on scene change ---
  try {
    if (await OBR.scene.isReady()) await openPanel(false);
  } catch {}
  unsubs.push(
    OBR.scene.onReadyChange(async (ready) => {
      if (ready) await openPanel(false);
      else await closePanel();
    })
  );

  // --- Broadcast: panel/expanded toggles from the panel iframe itself ---
  unsubs.push(
    OBR.broadcast.onMessage(BROADCAST_OPEN_PANEL, async () => {
      await openPanel(true);
    })
  );
  unsubs.push(
    OBR.broadcast.onMessage(BROADCAST_CLOSE_PANEL, async () => {
      await openPanel(false);
    })
  );

  // Hover-ring auto-hide poll. See `tickHoverAutoHide` comment above.
  if (hoverAutoHidePoll) clearInterval(hoverAutoHidePoll);
  hoverAutoHidePoll = setInterval(() => { void tickHoverAutoHide(); }, HOVER_POLL_INTERVAL_MS);
  unsubs.push(() => {
    if (hoverAutoHidePoll) {
      clearInterval(hoverAutoHidePoll);
      hoverAutoHidePoll = null;
    }
  });

  // Re-anchor panel on browser resize. openPanel anchors at vw/2 so a
  // window resize visibly shifts the centred popover. Use the current
  // expand state from localStorage so the resize doesn't snap us back
  // to collapsed.
  unsubs.push(
    onViewportResize(async () => {
      if (!panelIsOpen) return;
      await openPanel(lastExpandedState());
    }),
  );

  // Drag-end + reset broadcasts → re-issue openPanel so the offset takes
  // effect. lastExpandedState() preserves whatever expand mode the user
  // had at drag time.
  unsubs.push(
    OBR.broadcast.onMessage(BC_PANEL_DRAG_END, async (event) => {
      const payload = event.data as DragEndPayload | undefined;
      if (payload?.panelId !== PANEL_IDS.initiative) return;
      if (!panelIsOpen) return;
      await openPanel(lastExpandedState());
    }),
  );
  unsubs.push(
    OBR.broadcast.onMessage(BC_PANEL_RESET, async () => {
      if (!panelIsOpen) return;
      await openPanel(lastExpandedState());
    }),
  );

  // Stealth overlay sync removed 2026-05-04 along with the right-
  // click context menu — see registerContextMenus() above. Any
  // legacy `metadata.invisible: true` flags are now dormant; if
  // we revive the feature the overlay sync should be the SECOND
  // step (after the menu, since the menu is what flips the flag).
  // Sweep any stale overlay items once per scene-ready in case the
  // user is upgrading from a build that left them around.
  unsubs.push(
    OBR.scene.onReadyChange(async (ready) => {
      if (ready) {
        try { await clearStealthOverlays(); } catch {}
      }
    }),
  );
  try { if (await OBR.scene.isReady()) await clearStealthOverlays(); } catch {}

  // --- GM: track new tokens to prompt initiative during active combat ---
  try {
    initiativeRole = (await OBR.player.getRole()) as "GM" | "PLAYER";
  } catch { initiativeRole = "PLAYER"; }
  if (initiativeRole === "GM") {
    await initKnownItems();
    unsubs.push(
      OBR.scene.onReadyChange(async (ready) => {
        if (ready) await initKnownItems();
      })
    );
    unsubs.push(
      OBR.scene.items.onChange(async (sceneItems) => {
        const meta = await OBR.scene.getMetadata();
        const combat = meta[COMBAT_STATE_KEY] as any;
        const active = !!combat?.inCombat || !!combat?.preparing;

        const characterItems = sceneItems.filter(
          (i) =>
            i.type === "IMAGE" &&
            (i.layer === "CHARACTER" || i.layer === "MOUNT")
        );

        if (!active) {
          knownItemIds.clear();
          characterItems.forEach((i) => knownItemIds.add(i.id));
          return;
        }

        // Drag-in auto-add toggle (per-GM localStorage). Read each tick so
        // toggling the button takes effect immediately. When OFF we still
        // refresh the known-id set so the GM doesn't get a flood of prompts
        // when re-enabling later.
        const dragInAuto = getDragInAutoEnabled();
        if (dragInAuto) {
          for (const item of characterItems) {
            if (
              !knownItemIds.has(item.id) &&
              !item.metadata[METADATA_KEY] &&
              !item.metadata[OPTED_OUT_KEY]
            ) {
              knownItemIds.add(item.id);
              const curLang = (getLocalLang() as Lang) ?? "zh";
              OBR.modal.open({
                id: NEW_ITEM_DIALOG_ID,
                url: `${NEW_ITEM_URL}?itemId=${item.id}&itemName=${encodeURIComponent(
                  item.name
                )}&lang=${curLang}`,
                width: 300,
                height: 200,
              });
            }
          }
        }
        knownItemIds.clear();
        characterItems.forEach((i) => knownItemIds.add(i.id));
      })
    );
  }
}

export async function teardownInitiative(): Promise<void> {
  try { await OBR.contextMenu.remove(CTX_TOGGLE); } catch {}
  try { await OBR.contextMenu.remove(CTX_GATHER); } catch {}
  // Legacy CTX_INVISIBLE id — still removed on teardown so any
  // session that already had it registered cleans up properly.
  try { await OBR.contextMenu.remove(`${METADATA_KEY}/invisibility`); } catch {}
  for (const u of unsubs.splice(0)) u();
  knownItemIds.clear();
  await closePanel();
}
