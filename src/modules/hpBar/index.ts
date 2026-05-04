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
const BUBBLES_META_KEY = "com.owlbear-rodeo-bubbles-extension/metadata";

const CTX_ADD = "com.obr-suite/hp-bar-add";
const CTX_REMOVE = "com.obr-suite/hp-bar-remove";

// Popover dimensions. Small — just the stat banner row.
const POPOVER_W = 250;
const POPOVER_H = 56;
// Default anchor: top-right with a 20px right inset and a 100px
// top inset, so it doesn't collide with the bestiary list panel
// (which sits at vw - 60).
const RIGHT_OFFSET = 20;
const TOP_OFFSET = 100;

const unsubs: Array<() => void> = [];
let popoverOpen = false;
let currentItemId: string | null = null;

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
  const m = (item?.metadata || {})[BUBBLES_META_KEY];
  if (!m || typeof m !== "object") return false;
  const r = m as Record<string, unknown>;
  // Any of: health, max health, temp HP, AC. Even a 0-value AC
  // counts (the user explicitly set it).
  return r["health"] != null
    || r["max health"] != null
    || r["temporary health"] != null
    || r["armor class"] != null;
}

async function handleSelection(selection: string[] | undefined): Promise<void> {
  if (!selection || selection.length !== 1) {
    if (popoverOpen) await closePopover();
    return;
  }
  const id = selection[0];
  let item: any = null;
  try {
    const items = await OBR.scene.items.getItems([id]);
    item = items[0];
  } catch {}
  if (!item) {
    if (popoverOpen) await closePopover();
    return;
  }
  // Image tokens only — abilities/areas don't need an HP bar.
  if (item.type !== "IMAGE") {
    if (popoverOpen) await closePopover();
    return;
  }
  const meta = (item.metadata || {}) as Record<string, unknown>;
  // Defer to bestiary / character-card popovers ONLY when their
  // own auto-popup is enabled — those modules will show their
  // own HP editor in that case, so the standalone HP bar would
  // be redundant clutter. When the user has disabled either auto-
  // popup (Settings → 怪物图鉴 / 角色卡 → 自动弹出) the standalone
  // HP bar takes over so the user still gets a quick HP/AC editor.
  if (meta[BESTIARY_SLUG_KEY] != null) {
    if (isBestiaryAutoPopupOn()) {
      if (popoverOpen) await closePopover();
      return;
    }
    // Bestiary auto-popup OFF → fall through to HP bar.
  }
  if (meta[CC_BIND_KEY] != null) {
    if (isCcAutoPopupOn()) {
      if (popoverOpen) await closePopover();
      return;
    }
    // CC auto-popup OFF → fall through to HP bar.
  }
  // Auto-add: when the token already has bubbles displayed (HP/AC
  // metadata) but no HP_BAR_FLAG_KEY, set the flag now so the
  // popover opens for it. This lifts the explicit right-click
  // "add HP bar component" for the common case — a player or DM
  // can just select the token and the bar appears. The right-
  // click menu is still useful for tokens that DON'T yet have
  // bubbles, but selecting plain decoration tokens won't pop the
  // bar (`hasBubblesMetadata` is the gate).
  if (!meta[HP_BAR_FLAG_KEY]) {
    if (!hasBubblesMetadata(item)) {
      if (popoverOpen) await closePopover();
      return;
    }
    // Set the flag, but don't await the resulting onChange before
    // opening the popover — we already know the conditions match.
    try {
      await OBR.scene.items.updateItems([id], (drafts) => {
        for (const d of drafts) {
          (d.metadata as any)[HP_BAR_FLAG_KEY] = true;
        }
      });
    } catch (e) {
      console.warn("[hp-bar] auto-add flag failed", e);
      // Even if the write fails (player without permission on
      // this token), still open the popover — the popover only
      // reads/writes the bubbles metadata, which the player may
      // still be able to edit.
    }
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
            // Every token must be eligible (image, no other binding).
            every: [
              { key: "type", value: "IMAGE" },
              { key: ["metadata", BESTIARY_SLUG_KEY], value: undefined },
              { key: ["metadata", CC_BIND_KEY], value: undefined },
            ],
            // At least one must not yet have the flag — otherwise
            // nothing to do and the menu would just be noise.
            some: [
              { key: ["metadata", HP_BAR_FLAG_KEY], value: undefined },
            ],
          },
        },
      ],
      onClick: async (ctx) => {
        // Filter to tokens that DON'T already have the flag — adding
        // is idempotent so writing again is harmless, but skipping
        // saves a metadata write per redundant token.
        const ids = ctx.items
          .filter((it) => !(it.metadata as any)?.[HP_BAR_FLAG_KEY])
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
            // Show only when at least one has the flag — otherwise
            // there's nothing to remove.
            some: [
              { key: ["metadata", HP_BAR_FLAG_KEY], operator: "!=", value: undefined },
            ],
          },
        },
      ],
      onClick: async (ctx) => {
        // Only touch tokens that actually have the flag; leave
        // untouched the ones that don't (they were caught up in
        // the multi-select but aren't HP-bar-flagged).
        const ids = ctx.items
          .filter((it) => (it.metadata as any)?.[HP_BAR_FLAG_KEY] != null)
          .map((i) => i.id);
        if (ids.length === 0) return;
        try {
          await OBR.scene.items.updateItems(ids, (drafts) => {
            for (const d of drafts) {
              delete (d.metadata as any)[HP_BAR_FLAG_KEY];
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
