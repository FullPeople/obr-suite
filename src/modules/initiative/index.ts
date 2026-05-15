import OBR from "@owlbear-rodeo/sdk";
// 2026-05-14 — drag-in auto-roll uses broadcastDiceRoll directly so
// the dice value lands on canvas (visual animation + history entry)
// instead of being a silent metadata write. Hidden flag mirrors
// CTX_INVISIBLE behaviour: invisible tokens get a dark roll.
import { broadcastDiceRoll, isGlobalDarkRollEnabled } from "../dice/index";
import {
  METADATA_KEY,
  OPTED_OUT_KEY,
  COMBAT_STATE_KEY,
  BROADCAST_OPEN_PANEL,
  BROADCAST_CLOSE_PANEL,
  CTX_INVISIBLE,
  CTX_INVISIBLE_ADD,
} from "./utils/constants";
// 2026-05-14 — auto-roll initiative on drag-in needs the dex-mod
// metadata key that bind-page seeds when binding a character card.
// Source-of-truth is utils/metadata.ts; we inline the string here to
// avoid a circular import.
const INIT_DEXMOD_META = "com.initiative-tracker/dexMod";
import { Lang, t } from "./utils/i18n";
// 2026-05-14 (#5 sortfix) — shared modifier-biased tiebreak generator.
// Lives in utils/metadata.ts (a pure util file) so this background
// module can import it without pulling in the React-hook file.
import { genTiebreak } from "./utils/metadata";
import {
  startSceneSync as startSuiteSync,
  getLocalLang,
  onLangChange,
} from "../../state";
import { assetUrl } from "../../asset-base";
// `clearStealthOverlays` is still imported as a one-shot sweep for any
// session that's upgrading from the shader-based flow (2026-05-09 morning).
// `syncStealthOverlays` is no longer called — see the inline comment in
// setupInitiative() about retiring the shader path in favour of native
// `item.visible = false`.
import { clearStealthOverlays } from "./utils/visualEffects";
import { onViewportResize } from "../../utils/viewportAnchor";
// 2026-05-14 — defer the gather move into the portals module's blink
// handshake so the position update happens AT eyelid apex. Without
// this, fog/wall plugins (Dynamic Fog, Smoke & Spectre) reject any
// token carrying a light/vision source — the wall plugin sees a
// straight line from origin to gather point and snaps the token back.
// openBlinkAndGather strips meta + hides attachments + hides tokens
// while the eyelid is closed, identical to a portal teleport.
import { openBlinkAndGather } from "../portals/index";
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
// 2026-05-14 — initiative-new-item.html (set-initiative modal) is no
// longer opened from this module; drag-in now auto-rolls without a
// popup. The HTML file is kept on disk for backward compat in case
// any older surface still links to it, but no JS in this module
// references it.
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
// CTX_INVISIBLE id is the same string as the legacy 2026-05-04 menu —
// kept identical so a session that already had a registration cleans up
// to the same id we now create.

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
  try { await OBR.contextMenu.remove(CTX_INVISIBLE); } catch {}
  try { await OBR.contextMenu.remove(CTX_INVISIBLE_ADD); } catch {}

  await OBR.contextMenu.create({
    id: CTX_TOGGLE,
    icons: [
      {
        icon: ICON_URL,
        label: t(lang, "addToInitiative"),
        // 2026-05-10: limit initiative-tracker context entries to
        // selections that include at least one CHARACTER-layer token.
        // The handler further filters operations to character tokens
        // so a mixed box-select still works — non-character props are
        // simply skipped instead of being silently added to initiative.
        filter: {
          every: [
            { key: ["metadata", METADATA_KEY], value: undefined },
          ],
          some: [
            { key: "layer", value: "CHARACTER" },
          ],
        },
      },
      {
        icon: ICON_URL,
        label: t(lang, "removeFromInitiative"),
        filter: {
          // At least one selected item must (a) already be in initiative
          // AND (b) be a character. Non-character items in the selection
          // are skipped by the handler.
          some: [
            { key: ["metadata", METADATA_KEY], value: undefined, operator: "!=" },
            { key: "layer", value: "CHARACTER" },
          ],
        },
      },
    ],
    onClick: async (context) => {
      // Only operate on CHARACTER-layer tokens. Non-character items
      // that happened to be in the box-select get ignored; they never
      // had an initiative entry to begin with (under the new guard) so
      // there's nothing to remove either.
      const charItems = context.items.filter(
        (item) => item.layer === "CHARACTER"
      );
      if (charItems.length === 0) return;
      const anyHasData = charItems.some(
        (item) => item.metadata[METADATA_KEY] !== undefined
      );
      const ids = charItems.map((i) => i.id);
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
            // 2026-05-14 (#5 sortfix) — modifier-biased tiebreak so
            // same-total ties default to "higher initiative modifier
            // first" (the dropped 3rd sort tier's job). dexMod is
            // read off the token's own metadata.
            const dexMod = typeof (d.metadata as any)[INIT_DEXMOD_META] === "number"
              ? (d.metadata as any)[INIT_DEXMOD_META] as number : 0;
            d.metadata[METADATA_KEY] = {
              count: 0,
              active: false,
              rolled: false,
              tiebreak: genTiebreak(dexMod),
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

      // 2026-05-14 — defer the actual position update into the blink
      // handshake (openBlinkAndGather opens the blink modal, then at
      // eyelid apex runs the fog-bypass move recipe identical to a
      // portal teleport). Without this the move happens BEFORE the
      // eyelid covers the screen, so:
      //   1. Players see the token snap visibly before the blink.
      //   2. Tokens with light sources / vision (Dynamic Fog, Smoke &
      //      Spectre) get rejected and snapped back by the wall plugin.
      // Each client honours its own LS_BLINK_KEY:
      //   • DM blink ON — eyelid + instant camera + fog-bypass move at apex
      //   • DM blink OFF — fog-bypass move + smooth camera (no eyelid)
      //   • Player blink ON — eyelid + instant camera setPosition at apex
      //     (positions sync from DM's updateItems during their blink)
      //   • Player blink OFF — smooth camera animateTo (no eyelid)
      // The REMOTE broadcast is camera-only blink; the DM's
      // moveTokensWithFogBypass syncs positions to all players via
      // OBR's normal item replication.
      try {
        const payload = { x: center.x, y: center.y };
        await OBR.broadcast.sendMessage(
          "com.obr-suite/portals/blink-and-focus",
          payload,
          { destination: "REMOTE" },
        );
      } catch (e) {
        console.warn("[obr-suite/initiative] gather REMOTE broadcast failed", e);
      }
      // DM (this client): open blink + do the actual move + camera.
      try {
        await openBlinkAndGather(ids, positions, center);
      } catch (e) {
        console.error("[obr-suite/initiative] openBlinkAndGather failed", e);
      }
    },
  });

  // Stealth toggle (mark invisible / reveal). 2026-05-09 revival —
  // GM-only. Operates only on items that ARE in initiative
  // (`metadata[METADATA_KEY] !== undefined`); marking a token
  // invisible without an initiative entry would have no observable
  // effect since the panel filtering is the primary visual cue.
  await OBR.contextMenu.create({
    id: CTX_INVISIBLE,
    icons: [
      {
        icon: ICON_URL,
        label: t(lang, "makeInvisible"),
        filter: {
          roles: ["GM"],
          every: [
            { key: ["metadata", METADATA_KEY], value: undefined, operator: "!=" },
            { key: ["metadata", METADATA_KEY, "invisible"], value: true, operator: "!=" },
          ],
          // 2026-05-10: invisible toggle only applies to character
          // tokens (the rest of the initiative pipeline does too).
          some: [
            { key: "layer", value: "CHARACTER" },
          ],
        },
      },
      {
        icon: ICON_URL,
        label: t(lang, "revealInvisible"),
        filter: {
          roles: ["GM"],
          every: [
            { key: ["metadata", METADATA_KEY, "invisible"], value: true },
          ],
          some: [
            { key: "layer", value: "CHARACTER" },
          ],
        },
      },
    ],
    onClick: async (context) => {
      // Use the FIRST selected item's current invisible state as the
      // batch decision — mirrors the add/remove menu pattern. If any
      // currently-marked-invisible token is in the selection, the
      // click toggles them all OFF; otherwise it turns them all ON.
      // Filter to characters only — non-character items in a mixed
      // box-select are skipped (they aren't in initiative anyway).
      const charItems = context.items.filter(
        (item) => item.layer === "CHARACTER"
      );
      if (charItems.length === 0) return;
      const anyInvisible = charItems.some((item) => {
        const data = (item.metadata as any)[METADATA_KEY];
        return data && typeof data === "object" && data.invisible === true;
      });
      const willBeInvisible = !anyInvisible;
      const ids = charItems.map((i) => i.id);

      // Two writes happen in one updateItems call:
      //   1. data.invisible flag flip — drives panel filtering / gray
      //      ring / "有人在暗处" overlay broadcasts.
      //   2. item.visible flip — drives OBR's NATIVE per-client
      //      visibility. OBR hides items with visible=false from every
      //      client EXCEPT the GM and the token's createdUserId
      //      (owner). That's exactly the "DM normal, owner normal,
      //      everyone else can't see" matrix in the stealth spec, so
      //      we lean on it instead of trying to do per-client shader
      //      cover (which the user reported as ineffective on player
      //      clients in the previous attempt).
      //
      // Companion: useInitiative's panel filter is amended to KEEP
      // items where data.invisible === true even when item.visible
      // === false, so an invisible token still shows up in the GM /
      // owner panel.
      await OBR.scene.items.updateItems(ids, (drafts) => {
        for (const d of drafts) {
          const existing = (d.metadata as any)[METADATA_KEY];
          if (existing && typeof existing === "object") {
            (d.metadata as any)[METADATA_KEY] = {
              ...existing,
              invisible: willBeInvisible,
            };
          }
          // Toggle native visibility in lockstep. Reveal restores
          // visible=true; mark-invisible flips it false.
          d.visible = !willBeInvisible;
        }
      });
    },
  });

  // 2026-05-14 — "隐形加入先攻" GM-only context menu. For tokens not
  // yet in initiative, this is a one-click "add to initiative + flip
  // invisible". Filter mirrors CTX_TOGGLE's add path (no METADATA_KEY)
  // but restricts to GM. Handler does both writes in one updateItems
  // call so the panel sees a single state transition.
  await OBR.contextMenu.create({
    id: CTX_INVISIBLE_ADD,
    icons: [
      {
        icon: ICON_URL,
        label: t(lang, "invisibleAddToInitiative"),
        filter: {
          roles: ["GM"],
          every: [
            { key: ["metadata", METADATA_KEY], value: undefined },
          ],
          some: [
            { key: "layer", value: "CHARACTER" },
          ],
        },
      },
    ],
    onClick: async (context) => {
      const charItems = context.items.filter(
        (item) => item.layer === "CHARACTER",
      );
      if (charItems.length === 0) return;
      const ids = charItems.map((i) => i.id);
      // Single write: add the standard initiative metadata blob with
      // `invisible: true` baked in, AND flip item.visible = false so
      // OBR's native per-client visibility hides the token from
      // non-GM / non-owner clients (same matrix CTX_INVISIBLE uses
      // for marking an existing initiative entry stealth).
      await OBR.scene.items.updateItems(ids, (drafts) => {
        for (const d of drafts) {
          // 2026-05-14 (#5 sortfix) — modifier-biased tiebreak (see
          // the CTX_TOGGLE add path above for the rationale).
          const dexMod = typeof (d.metadata as any)[INIT_DEXMOD_META] === "number"
            ? (d.metadata as any)[INIT_DEXMOD_META] as number : 0;
          d.metadata[METADATA_KEY] = {
            count: 0,
            active: false,
            rolled: false,
            tiebreak: genTiebreak(dexMod),
            ownerId: d.createdUserId,
            invisible: true,
          };
          delete d.metadata[OPTED_OUT_KEY];
          d.visible = false;
        }
      });
    },
  });
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

  // 2026-05-09 update: shader-overlay path retired. The player-side
  // opaque cover never visually obscured the token in user testing —
  // suspected reasons (Effect position relative to attached parent
  // not snapping correctly, or zIndex collision with the
  // CHARACTER-layer token sprite) were diagnosed but not solved
  // before deciding the simpler fix is to ride OBR's NATIVE
  // visibility model: the CTX_INVISIBLE handler now toggles
  // `item.visible` alongside `data.invisible`, and OBR's renderer
  // hides the token on every non-GM non-owner client for free.
  //
  // We still sweep any STALE overlay items left over from a previous
  // session that did create them, so clients upgrading mid-session
  // don't carry orphan local Effect items into the new flow. The
  // sweep is a one-shot at scene-ready; no re-subscription needed.
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

        // Auto-add toggle (per-GM localStorage). Read each tick so
        // toggling the button takes effect immediately. When OFF we still
        // refresh the known-id set so the GM doesn't get a flood of prompts
        // when re-enabling later.
        //
        // 2026-05-14 — replaced the old modal popup with an auto-roll:
        // each new token enters with a fresh 1d20 + dex-mod result and
        // is added straight into initiative. If the token landed
        // already invisible (`item.visible === false` — e.g. dragged in
        // from a hidden zone), it joins with `data.invisible = true`
        // so the panel hides its value from non-owner clients (same
        // matrix CTX_INVISIBLE uses for marking an existing entry).
        const dragInAuto = getDragInAutoEnabled();
        if (dragInAuto) {
          // Collect IDs first so we can batch one updateItems call —
          // multiple drag-ins at the same time (e.g. selecting a party
          // and dropping it on the map) shouldn't fire N writes.
          type Entry = { id: string; mod: number; invisible: boolean };
          const toAdd: Entry[] = [];
          for (const item of characterItems) {
            if (
              !knownItemIds.has(item.id) &&
              !item.metadata[METADATA_KEY] &&
              !item.metadata[OPTED_OUT_KEY]
            ) {
              knownItemIds.add(item.id);
              const m = (item.metadata as any)[INIT_DEXMOD_META];
              const mod = typeof m === "number" && Number.isFinite(m) ? m : 0;
              toAdd.push({
                id: item.id,
                mod,
                invisible: item.visible === false,
              });
            }
          }
          if (toAdd.length > 0) {
            // Roll the d20 for each token UP FRONT so the metadata
            // write and the broadcast use the exact same number — if
            // we rolled twice (once in metadata, once in broadcast)
            // the dice on canvas would show one number while the panel
            // showed another. We attach the roll to each entry then
            // both consumers read from there.
            type EntryWithRoll = Entry & { d20: number };
            const rolled: EntryWithRoll[] = toAdd.map((e) => ({
              ...e,
              d20: Math.floor(Math.random() * 20) + 1,
            }));
            const ids = rolled.map((e) => e.id);
            await OBR.scene.items.updateItems(ids, (drafts) => {
              for (const d of drafts) {
                const entry = rolled.find((e) => e.id === d.id);
                if (!entry) continue;
                // 2026-05-14 (#5 sortfix) — store the RAW d20 as
                // `count`. The panel + sort add `modifier` (the dex
                // mod) on top at display/sort time, so storing
                // d20+mod here would DOUBLE-COUNT the modifier
                // (total = count + modifier = d20 + 2·mod). This
                // matches bestiary fireInitiative + rollInitiativeLocal,
                // which both store raw d20.
                d.metadata[METADATA_KEY] = {
                  count: entry.d20,
                  active: false,
                  rolled: true,
                  // modifier-biased tiebreak — same-total ties default
                  // to "higher dex first".
                  tiebreak: genTiebreak(entry.mod),
                  ownerId: d.createdUserId,
                  invisible: entry.invisible,
                };
                delete d.metadata[OPTED_OUT_KEY];
                // If the token is already invisible at drag-in, leave
                // item.visible alone — the GM set it that way on
                // purpose. data.invisible = true ensures the panel
                // hides the entry from non-owner clients.
              }
            });
            // Fire one dice broadcast per token so each gets its own
            // canvas dice animation anchored to its position. Hidden
            // (dark) roll when the token is invisible — players don't
            // see the value, but their clients still play the SFX.
            // autoDismiss so the dice fade away after climax rather
            // than lingering. Errors here are non-fatal — the
            // metadata write above is the source of truth.
            let rollerId = "";
            try { rollerId = await OBR.player.getId(); } catch {}
            // Dark roll when the token is invisible OR when the DM
            // has 全局暗骰 toggle on — same gate every other roll
            // path uses so players don't see auto-init values that
            // the DM is currently hiding.
            const globalDark = isGlobalDarkRollEnabled();
            for (const entry of rolled) {
              try {
                await broadcastDiceRoll({
                  itemId: entry.id,
                  dice: [{ type: "d20", value: entry.d20 }],
                  winnerIdx: 0,
                  modifier: entry.mod,
                  label: t(lastLang, "initiative"),
                  rollerId,
                  hidden: entry.invisible || globalDark,
                  autoDismiss: true,
                });
              } catch (e) {
                console.warn("[obr-suite/initiative] auto-roll broadcast failed", e);
              }
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
  try { await OBR.contextMenu.remove(CTX_INVISIBLE); } catch {}
  try { await OBR.contextMenu.remove(CTX_INVISIBLE_ADD); } catch {}
  for (const u of unsubs.splice(0)) u();
  knownItemIds.clear();
  try { await clearStealthOverlays(); } catch {}
  await closePanel();
}
