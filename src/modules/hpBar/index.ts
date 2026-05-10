// Standalone HP bar module.
//
// Right-click context menu adds a per-token "hp-bar-enabled" flag,
// but ONLY for tokens that have neither a bestiary binding nor a
// character-card binding (since both of those already render their
// own HP/AC editors via their own info popovers). When such a flagged
// token is selected, a draggable mini-popover appears next to it
// showing the same HP/Temp/AC pills as the bestiary info popover —
// editing in the popover writes to the bubbles metadata key, which
// is the same source the on-token HP bar / heater shield reads
// from, so all three views (popover, on-token bar, bubbles plugin)
// stay in sync.
//
// The popover closes automatically on deselect or when the
// selection changes to a different token. Drag the popover by its
// grip handle to reposition; offset is persisted via the standard
// panelLayout system.

import OBR from "@owlbear-rodeo/sdk";
import { assetUrl } from "../../asset-base";
import { onViewportResize } from "../../utils/viewportAnchor";
import {
  PANEL_IDS,
  getPanelOffset,
  registerPanelBbox,
  BC_PANEL_DRAG_END,
  BC_PANEL_RESET,
  type DragEndPayload,
} from "../../utils/panelLayout";

const PLUGIN_ID = "com.obr-suite/hp-bar";
const POPOVER_ID = `${PLUGIN_ID}/popover`;
const POPOVER_URL = assetUrl("hp-bar.html");

// Per-token metadata key — when present (any truthy value), the
// right-click menu shows "remove HP bar" instead of "add", and
// selecting the token auto-pops the bar.
export const HP_BAR_FLAG_KEY = `${PLUGIN_ID}/enabled`;

// Bindings we mutually exclude with — both have their own info
// popover that already includes an HP editor, so showing the
// standalone bar on top would be redundant clutter.
const BESTIARY_SLUG_KEY = "com.bestiary/slug";
const CC_BIND_KEY = "com.character-cards/boundCardId";

// Bubbles plugin's metadata key. Tokens with this key set (HP/AC
// values present) are the ones the bubbles module renders an HP
// bar over. The HP bar component is now tied to this — selecting
// any token that already has bubbles + no other binding auto-
// enables the HP bar component on the fly.
const BUBBLES_META_KEY = "com.obr-suite/bubbles/data";
const EXTERNAL_BUBBLES_META_KEY = "com.owlbear-rodeo-bubbles-extension/metadata";

const CTX_ADD = "com.obr-suite/hp-bar-add";
const CTX_REMOVE = "com.obr-suite/hp-bar-remove";

// Popover dimensions. 2026-05-10c — bumped width 250→320 to fit
// 3-digit/3-digit HP (e.g. "150/250") in the pill without truncation,
// and bumped height 56→78 to make room for the new name row above
// the stat banner. Both sizes are eyeballed on the dev font stack;
// the panel-layout offset persistence still applies on top.
const POPOVER_W = 320;
const POPOVER_H = 78;
// Default anchor: top-right with a 20px right inset and a 100px
// top inset, so it doesn't collide with the bestiary list panel
// (which sits at vw - 60).
const RIGHT_OFFSET = 20;
const TOP_OFFSET = 100;

const unsubs: Array<() => void> = [];
let popoverOpen = false;
let currentItemId: string | null = null;
let hpBarIsGM = false;
let hpBarPlayerId = "";

async function popoverAnchor(): Promise<{ left: number; top: number }> {
  let vw = 1280, vh = 720;
  try { vw = await OBR.viewport.getWidth(); } catch {}
  try { vh = await OBR.viewport.getHeight(); } catch {}
  const off = getPanelOffset(PANEL_IDS.hpBar);
  // RIGHT-anchored: anchor X is the right edge of the popover.
  // dx > 0 pulls the popover LEFTWARDS, matching the convention
  // used by other right-anchored panels.
  const baseLeft = vw - POPOVER_W - RIGHT_OFFSET;
  const baseTop = TOP_OFFSET;
  const left = Math.min(Math.max(8, baseLeft + off.dx), vw - POPOVER_W - 8);
  const top = Math.min(Math.max(8, baseTop + off.dy), vh - POPOVER_H - 8);
  return { left, top };
}

async function openPopoverFor(itemId: string): Promise<void> {
  // If we're already showing the right token, do nothing — re-issuing
  // popover.open() would force a flicker on selection-flip-flop.
  if (popoverOpen && currentItemId === itemId) return;
  // If we're showing a DIFFERENT token, close first so the new one
  // opens at the correct anchor.
  if (popoverOpen && currentItemId !== itemId) {
    await closePopover();
  }
  currentItemId = itemId;
  const anchor = await popoverAnchor();
  try {
    await OBR.popover.open({
      id: POPOVER_ID,
      url: `${POPOVER_URL}?itemId=${encodeURIComponent(itemId)}`,
      width: POPOVER_W,
      height: POPOVER_H,
      anchorReference: "POSITION",
      anchorPosition: anchor,
      anchorOrigin: { horizontal: "LEFT", vertical: "TOP" },
      transformOrigin: { horizontal: "LEFT", vertical: "TOP" },
      hidePaper: true,
      disableClickAway: true,
    });
    popoverOpen = true;
  } catch (e) {
    console.warn("[hp-bar] open failed", e);
    popoverOpen = false;
    currentItemId = null;
  }
}

async function closePopover(): Promise<void> {
  if (!popoverOpen) return;
  popoverOpen = false;
  currentItemId = null;
  try { await OBR.popover.close(POPOVER_ID); } catch {}
}

// Decide what to do based on the user's current selection. Called
// from `OBR.player.onChange` and `OBR.scene.items.onChange` — the
// latter handles the case where a selected token's metadata gets
// the flag added/removed mid-selection.
/** Returns true if the token has any HP/AC bubble values written
 *  to it (i.e. the bubbles plugin renders something for it). */
function hasBubblesMetadata(item: any): boolean {
  const meta = item?.metadata || {};
  const m = meta[BUBBLES_META_KEY] ?? meta[EXTERNAL_BUBBLES_META_KEY];
  if (!m || typeof m !== "object") return false;
  const r = m as Record<string, unknown>;
  // Any of: health, max health, temp HP, AC. Even a 0-value AC
  // counts (the user explicitly set it).
  return r["health"] != null
    || r["max health"] != null
    || r["temporary health"] != null
    || r["armor class"] != null;
}

function isBubblesLocked(item: any): boolean {
  const meta = item?.metadata || {};
  const m = meta[BUBBLES_META_KEY] ?? meta[EXTERNAL_BUBBLES_META_KEY];
  if (!m || typeof m !== "object") return true;
  const raw = (m as Record<string, unknown>)["locked"];
  return raw === undefined ? true : !!raw;
}

function isBubblesHidden(item: any): boolean {
  const meta = item?.metadata || {};
  const m = meta[BUBBLES_META_KEY] ?? meta[EXTERNAL_BUBBLES_META_KEY];
  if (!m || typeof m !== "object") return false;
  return !!(m as Record<string, unknown>)["hide"];
}

// 2026-05-10: pin-panel state — when the user toggles the pin in the
// hp-bar.html popover, that script broadcasts BC_HP_BAR_PIN_CHANGED
// LOCAL with `{ pinned: boolean }`, and writes the same flag to
// localStorage. We mirror it here so handleSelection knows whether
// to keep the popover open after a deselect / disqualifying selection.
const LS_HP_BAR_PINNED = "obr-suite/hp-bar-pinned";
const BC_HP_BAR_PIN_CHANGED = "com.obr-suite/hp-bar-pin-changed";
function readHpBarPinned(): boolean {
  try { return localStorage.getItem(LS_HP_BAR_PINNED) === "1"; } catch { return false; }
}

async function handleSelection(selection: string[] | undefined): Promise<void> {
  // Pin-aware close helper: when pinned, keep the popover up even if
  // the new selection doesn't qualify (no token / wrong type / no
  // bubbles meta). When unpinned, fall through to normal close.
  const pinned = readHpBarPinned();
  const closeIfNotPinned = async (): Promise<void> => {
    if (popoverOpen && !pinned) await closePopover();
  };

  if (!selection || selection.length !== 1) {
    await closeIfNotPinned();
    return;
  }
  const id = selection[0];
  let item: any = null;
  try {
    const items = await OBR.scene.items.getItems([id]);
    item = items[0];
  } catch {}
  if (!item) {
    await closeIfNotPinned();
    return;
  }
  // Image tokens only — abilities/areas don't need an HP bar.
  if (item.type !== "IMAGE") {
    await closeIfNotPinned();
    return;
  }
  const meta = (item.metadata || {}) as Record<string, unknown>;
  const ownsItem = !!hpBarPlayerId && (item as any).createdUserId === hpBarPlayerId;
  if (!hpBarIsGM && (!ownsItem || isBubblesHidden(item))) {
    await closeIfNotPinned();
    return;
  }
  if (hpBarIsGM && isBubblesHidden(item)) {
    await closeIfNotPinned();
    return;
  }
  // 2026-05-10c — was unconditional skip on CC / bestiary binding,
  // which made the popover never follow CC- or bestiary-bound
  // characters even when the user wanted exactly that. Per user's
  // 2026-05-10 spec ("血条组件的数据需要和当前聚焦角色同步和修改"),
  // the bar now follows ALL valid character selections and lives
  // alongside whatever popover the bestiary / cc-info module also
  // opens. Users who want it OFF on a CC-bound or bestiary-bound
  // token can right-click → 移除血条组件 once; the flag becomes
  // `false` and the auto-add gate respects it.
  void BESTIARY_SLUG_KEY; void CC_BIND_KEY;
  // Auto-add: when the token has NEVER had the flag (undefined) AND
  // already has bubbles metadata, opt the token into the standalone
  // HP bar by setting the flag. This is the "select a vanilla token
  // with HP and the bar appears" affordance.
  //
  // 2026-05-10 fix: the previous gate was `if (!meta[HP_BAR_FLAG_KEY])`
  // which also matched `false` (the value the right-click "remove
  // 血条组件" handler now writes), so removing the bar instantly
  // re-added it on the next items.onChange. Using `=== undefined`
  // restricts auto-add to first-touch only — explicit removal sets
  // the flag to `false` and that wins.
  const flagState = meta[HP_BAR_FLAG_KEY];
  if (flagState === undefined) {
    if (!hasBubblesMetadata(item)) {
      await closeIfNotPinned();
      return;
    }
    try {
      await OBR.scene.items.updateItems([id], (drafts) => {
        for (const d of drafts) {
          (d.metadata as any)[HP_BAR_FLAG_KEY] = true;
        }
      });
    } catch (e) {
      console.warn("[hp-bar] auto-add flag failed", e);
    }
  } else if (flagState === false || !flagState) {
    // Explicitly removed — respect the user's choice and don't open.
    await closeIfNotPinned();
    return;
  }
  await openPopoverFor(id);
}

// Auto-popup flags from the bestiary / character-cards modules.
// Both default to ON when the localStorage key is absent. Users
// flip these via Settings → 怪物图鉴 / 角色卡.
function isBestiaryAutoPopupOn(): boolean {
  try { return localStorage.getItem("com.bestiary/auto-popup") !== "0"; }
  catch { return true; }
}
function isCcAutoPopupOn(): boolean {
  try { return localStorage.getItem("character-cards/auto-info") !== "0"; }
  catch { return true; }
}

export async function setupHpBar(): Promise<void> {
  try { hpBarIsGM = (await OBR.player.getRole()) === "GM"; } catch {}
  try { hpBarPlayerId = await OBR.player.getId(); } catch {}
  // Bbox for layout editor / drag preview.
  registerPanelBbox(PANEL_IDS.hpBar, async () => {
    if (!popoverOpen) return null; // hide from editor when closed
    const { left, top } = await popoverAnchor();
    return { left, top, width: POPOVER_W, height: POPOVER_H };
  });

  // Right-click context menu — supports BOTH single-select and
  // bulk multi-select. The two entries are mutually-exclusive
  // metadata-wise: "Add" requires every selected token to be HP-bar-
  // -eligible (no bestiary / cc binding) AND at least one to lack
  // the flag; "Remove" requires at least one to have the flag.
  // 2026-05-05 spec change: dropped the `max: 1` cap so a 5-token
  // group-select can flag (or unflag) all of them at once. Adding
  // is idempotent — tokens that already have the flag are skipped.
  // Removing only writes to tokens that actually have the flag, so
  // tokens without it stay untouched (the union/intersection
  // semantics the user asked for).
  try {
    await OBR.contextMenu.create({
      id: CTX_ADD,
      icons: [
        {
          icon: assetUrl("status-icon.svg"),
          label: "添加血条组件",
          filter: {
            // 2026-05-10c — dropped the BESTIARY_SLUG / CC_BIND
            // exclusions in `every`. Now that the hp-bar popover
            // follows CC / bestiary bound characters too, users on
            // those tokens need a way to re-add the bar after an
            // explicit "移除" (flag = false). The menu now shows on
            // every IMAGE.
            every: [
              { key: "type", value: "IMAGE" },
            ],
            // 2026-05-10b — at least one CHARACTER-layer item whose
            // flag is NOT explicitly true. Originally `value: undefined`,
            // but after the "remove sticks" fix the flag becomes `false`
            // on explicit removal; that meant `undefined` no longer
            // matched and the user couldn't re-add. Operator `!=` with
            // `value: true` covers both "never set (undefined)" AND
            // "explicitly removed (false)" while still hiding the menu
            // when the bar is already enabled (true).
            some: [
              { key: "layer", value: "CHARACTER" },
              { key: ["metadata", HP_BAR_FLAG_KEY], operator: "!=", value: true },
            ],
          },
        },
      ],
      onClick: async (ctx) => {
        // Filter to CHARACTER-layer tokens whose flag is NOT true —
        // matches the menu filter (covers undefined + false). Adding
        // is idempotent so a stray re-add wouldn't break, but we still
        // skip the obvious tokens to save a write each.
        const ids = ctx.items
          .filter(
            (it) =>
              it.layer === "CHARACTER" &&
              (it.metadata as any)?.[HP_BAR_FLAG_KEY] !== true,
          )
          .map((i) => i.id);
        if (ids.length === 0) return;
        try {
          await OBR.scene.items.updateItems(ids, (drafts) => {
            for (const d of drafts) {
              (d.metadata as any)[HP_BAR_FLAG_KEY] = true;
            }
          });
          // If the user had ONE of the affected tokens selected when
          // they enabled the flag, the popover should pop immediately.
          // For multi-select, only the "current selection" matters —
          // OBR's selection is always a list, and our handleSelection
          // only opens for single-token selections anyway.
          try {
            const sel = await OBR.player.getSelection();
            await handleSelection(sel);
          } catch {}
        } catch (e) {
          console.error("[hp-bar] add failed", e);
        }
      },
    });
    await OBR.contextMenu.create({
      id: CTX_REMOVE,
      icons: [
        {
          icon: assetUrl("status-icon.svg"),
          label: "移除血条组件",
          filter: {
            every: [
              { key: "type", value: "IMAGE" },
            ],
            // 2026-05-10: at least one CHARACTER token whose flag is
            // currently truthy. Filter targets `=== true` because
            // explicit-disabled tokens (flag === false, see "remove
            // sticks" fix below) shouldn't surface the remove menu —
            // they're already removed.
            some: [
              { key: "layer", value: "CHARACTER" },
              { key: ["metadata", HP_BAR_FLAG_KEY], value: true },
            ],
          },
        },
      ],
      onClick: async (ctx) => {
        // Only touch CHARACTER-layer tokens whose flag is currently
        // truthy. Tokens with no flag or flag=false are left alone.
        const ids = ctx.items
          .filter(
            (it) =>
              it.layer === "CHARACTER" &&
              (it.metadata as any)?.[HP_BAR_FLAG_KEY] === true,
          )
          .map((i) => i.id);
        if (ids.length === 0) return;
        try {
          await OBR.scene.items.updateItems(ids, (drafts) => {
            for (const d of drafts) {
              // 2026-05-10 — write FALSE instead of `delete`. The
              // handleSelection auto-add path uses `=== undefined`
              // to detect "first encounter" tokens, so explicit
              // removal must persist a non-undefined value (false)
              // to suppress the next auto-add. Earlier rounds used
              // `delete`, which made the bar instantly re-pop on
              // the next items.onChange.
              (d.metadata as any)[HP_BAR_FLAG_KEY] = false;
            }
          });
          // If the popover is showing one of the just-removed tokens,
          // close it (the flag-gate inside handleSelection would
          // close on the next selection change anyway, but doing it
          // eagerly here feels snappier).
          if (popoverOpen && currentItemId && ids.includes(currentItemId)) {
            await closePopover();
          }
        } catch (e) {
          console.error("[hp-bar] remove failed", e);
        }
      },
    });
  } catch (e) {
    console.warn("[hp-bar] context menu register failed", e);
  }

  // Selection listener.
  unsubs.push(
    OBR.player.onChange(async (player) => {
      hpBarIsGM = player.role === "GM";
      hpBarPlayerId = player.id || hpBarPlayerId;
      try { await handleSelection(player.selection); } catch (e) {
        console.warn("[hp-bar] handleSelection threw:", e);
      }
    }),
  );

  // Items change listener — handles flag-flip mid-selection AND
  // catches the case where the selected token gets bound to a
  // bestiary monster / character card while the popover is open
  // (we should close in that case to avoid duplicate UI).
  unsubs.push(
    OBR.scene.items.onChange(async () => {
      try {
        const sel = await OBR.player.getSelection();
        await handleSelection(sel);
      } catch {}
    }),
  );

  // 2026-05-10: pin-state broadcast listener. The hp-bar popover
  // (hp-bar-page.ts) toggles localStorage + LOCAL-broadcasts when the
  // user clicks the pin button. We don't have to act on the message
  // itself (handleSelection re-reads localStorage on every call), but
  // we DO want to re-evaluate the current selection if pin was just
  // toggled OFF while showing on a deselected token — otherwise the
  // popover lingers until the next selection change.
  unsubs.push(
    OBR.broadcast.onMessage(BC_HP_BAR_PIN_CHANGED, async (event) => {
      const data = event.data as { pinned?: boolean } | undefined;
      // Only re-check on PIN-OFF; turning pin ON shouldn't disturb
      // the open popover.
      if (data?.pinned !== false) return;
      try {
        const sel = await OBR.player.getSelection();
        await handleSelection(sel);
      } catch {}
    }),
  );

  // Scene-ready: re-evaluate selection so popover opens if needed.
  unsubs.push(
    OBR.scene.onReadyChange(async (ready) => {
      if (!ready) await closePopover();
      else {
        try {
          const sel = await OBR.player.getSelection();
          await handleSelection(sel);
        } catch {}
      }
    }),
  );

  // Initial pass.
  try {
    const sel = await OBR.player.getSelection();
    await handleSelection(sel);
  } catch {}

  // Re-anchor on viewport resize, drag-end, and panel reset.
  unsubs.push(
    onViewportResize(async () => {
      if (popoverOpen && currentItemId) {
        const id = currentItemId;
        popoverOpen = false;
        currentItemId = null;
        await openPopoverFor(id);
      }
    }),
  );
  unsubs.push(
    OBR.broadcast.onMessage(BC_PANEL_DRAG_END, async (event) => {
      const payload = event.data as DragEndPayload | undefined;
      if (payload?.panelId !== PANEL_IDS.hpBar) return;
      if (popoverOpen && currentItemId) {
        const id = currentItemId;
        popoverOpen = false;
        currentItemId = null;
        await openPopoverFor(id);
      }
    }),
  );
  unsubs.push(
    OBR.broadcast.onMessage(BC_PANEL_RESET, async () => {
      if (popoverOpen && currentItemId) {
        const id = currentItemId;
        popoverOpen = false;
        currentItemId = null;
        await openPopoverFor(id);
      }
    }),
  );
}

export async function teardownHpBar(): Promise<void> {
  for (const u of unsubs.splice(0)) {
    try { u(); } catch {}
  }
  try { await OBR.contextMenu.remove(CTX_ADD); } catch {}
  try { await OBR.contextMenu.remove(CTX_REMOVE); } catch {}
  await closePopover();
}
