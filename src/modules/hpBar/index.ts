// Standalone HP bar module.
//
// Right-click context menus add/remove a per-token flag. Automatic selection
// excludes bestiary/card bindings because they already have an HP editor.
// When an eligible flagged token is selected, a draggable mini-popover appears
// showing the same HP/Temp/AC pills as the bestiary info popover —
// editing in the popover writes to the bubbles metadata key, which
// is the same source the on-token HP bar / heater shield reads
// from, so all three views (popover, on-token bar, bubbles plugin)
// stay in sync.
//
// Unless pinned, the popover closes when selection is no longer eligible.
// Switching between eligible tokens updates the same iframe. Drag it by its
// grip handle to reposition; offset is persisted via the standard
// panelLayout system.

import OBR, { type Item } from "@owlbear-rodeo/sdk";
import {
  HP_BAR_FLAG_KEY, HP_BAR_TARGET, HP_BAR_READY, eligibilitySignature,
  hpEligibility, mayEditHp, type HpBarTarget,
} from "./target";
export { HP_BAR_FLAG_KEY } from "./target";
import { getLocalLang } from "../../state";
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
let active = false;
let sceneReady = false;
let selection: string[] = [];
let selectionVersion = 0;
let selectedSignature = "";
let desiredItemId: string | null = null;
let reanchor = false;
let panelQueue: Promise<void> | null = null;
let panelRequested = false;
let target: HpBarTarget = { session: "", version: 0, itemId: null, pending: true };

function publishTarget(itemId: string | null, pending: boolean): void {
  if (target.itemId === itemId && target.pending === pending) return;
  target = { ...target, version: target.version + 1, itemId, pending };
  void sendTarget();
}

async function sendTarget(): Promise<void> {
  try { await OBR.broadcast.sendMessage(HP_BAR_TARGET, target, { destination: "LOCAL" }); }
  catch (error) { console.warn("[hp-bar] target broadcast failed", { itemId: target.itemId, version: target.version, error }); }
}

async function popoverAnchor(): Promise<{ left: number; top: number }> {
  let vw = 1280, vh = 720;
  try { [vw, vh] = await Promise.all([OBR.viewport.getWidth(), OBR.viewport.getHeight()]); } catch {}
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
  desiredItemId = itemId;
  currentItemId = itemId;
  publishTarget(itemId, false);
  await syncPanel();
}

/** Only one open/close can be in flight. A -> B updates the existing iframe;
 * a ready handshake recovers the latest target if its first message was early. */
function syncPanel(): Promise<void> {
  panelRequested = true;
  if (panelQueue) return panelQueue;
  panelQueue = (async () => {
    while (true) {
      panelRequested = false;
      if (!desiredItemId || !active || !sceneReady) {
        if (!popoverOpen) return;
        try { await OBR.popover.close(POPOVER_ID); }
        catch (error) { console.warn("[hp-bar] close failed", { error }); return; }
        popoverOpen = false;
        continue;
      }
      if (popoverOpen && !reanchor) return;
      const session = target.session;
      const anchor = await popoverAnchor();
      if (!desiredItemId || !active || !sceneReady || target.session !== session) continue;
      reanchor = false;
      try {
        await OBR.popover.open({
          id: POPOVER_ID,
          url: `${POPOVER_URL}?session=${encodeURIComponent(session)}`,
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
        await sendTarget();
      } catch (error) {
        console.warn("[hp-bar] open failed", { itemId: desiredItemId, error });
        return;
      }
    }
  })().finally(() => {
    panelQueue = null;
    if (panelRequested) void syncPanel();
  });
  return panelQueue;
}

async function closePopover(): Promise<void> {
  desiredItemId = null;
  currentItemId = null;
  publishTarget(null, true);
  await syncPanel();
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

async function handleSelection(nextSelection: string[] | undefined, snapshot?: Item | null): Promise<void> {
  selection = [...(nextSelection ?? [])];
  const version = ++selectionVersion;
  const current = () => active && sceneReady && version === selectionVersion;
  if (!current()) return;
  // Pin-aware close helper: when pinned, keep the popover up even if
  // the new selection doesn't qualify (no token / wrong type / no
  // bubbles meta). When unpinned, fall through to normal close.
  const pinned = readHpBarPinned();
  const closeIfNotPinned = async (): Promise<void> => {
    if (!current()) return;
    if (!pinned) await closePopover();
    else publishTarget(currentItemId, false);
  };

  if (!selection || selection.length !== 1) {
    selectedSignature = "";
    await closeIfNotPinned();
    return;
  }
  const id = selection[0];
  let item: Item | undefined = snapshot ?? undefined;
  if (snapshot === undefined) {
    selectedSignature = "";
    publishTarget(currentItemId, true);
    try { item = (await OBR.scene.items.getItems([id]))[0]; }
    catch (error) {
      console.warn("[hp-bar] selected item read failed", { itemId: id, version, error });
      if (current()) await closePopover();
      return;
    }
  }
  if (!current()) return;
  selectedSignature = eligibilitySignature(item);
  const eligibility = hpEligibility(item, hpBarIsGM, hpBarPlayerId);
  if (eligibility === "none") {
    await closeIfNotPinned();
    return;
  }
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
  if (eligibility === "enable") {
    let accepted = false;
    try {
      await OBR.scene.items.updateItems([id], (drafts) => {
        for (const d of drafts) {
          if (current() && d.id === id) {
            const latest = hpEligibility(d, hpBarIsGM, hpBarPlayerId);
            if (latest === "enable") d.metadata[HP_BAR_FLAG_KEY] = true;
            accepted = latest !== "none";
          }
        }
      });
    } catch (e) {
      console.warn("[hp-bar] auto-add flag failed", { itemId: id, error: e });
      if (current()) await closePopover();
      return;
    }
    if (!accepted) { await closeIfNotPinned(); return; }
  }
  if (current()) await openPopoverFor(id);
}

export async function setupHpBar(): Promise<void> {
  if (active) return;
  active = true;
  target = { session: crypto.randomUUID(), version: 0, itemId: null, pending: true };
  selection = [];
  selectedSignature = "";
  selectionVersion++;
  const en = getLocalLang() === "en";
  try {
    const [ready, role, id] = await Promise.all([OBR.scene.isReady(), OBR.player.getRole(), OBR.player.getId()]);
    sceneReady = ready;
    hpBarIsGM = role === "GM";
    hpBarPlayerId = id;
  } catch (error) {
    active = false;
    console.warn("[hp-bar] setup identity/scene read failed", { error });
    throw error;
  }
  unsubs.push(OBR.broadcast.onMessage(HP_BAR_READY, event => {
    if ((event.data as { session?: string } | undefined)?.session === target.session) void sendTarget();
  }));
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
          label: en ? "Add HP bar" : "添加血条组件",
          filter: {
            // Keep the existing bulk context menu available on images;
            // bound tokens remain excluded from automatic popup selection.
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
          // Re-read only this explicit action's target, never on unrelated edits.
          await handleSelection(selection);
        } catch (e) {
          console.error("[hp-bar] add failed", { itemIds: ids, error: e });
        }
      },
    });
    await OBR.contextMenu.create({
      id: CTX_REMOVE,
      icons: [
        {
          icon: assetUrl("status-icon.svg"),
          label: en ? "Remove HP bar" : "移除血条组件",
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
            selectionVersion++;
            await closePopover();
          }
        } catch (e) {
          console.error("[hp-bar] remove failed", { itemIds: ids, error: e });
        }
      },
    });
  } catch (e) {
    console.warn("[hp-bar] context menu register failed", e);
  }

  // Selection listener.
  unsubs.push(
    OBR.player.onChange(async (player) => {
      const nextSelection = player.selection ?? [];
      const changed = hpBarIsGM !== (player.role === "GM")
        || (!!player.id && hpBarPlayerId !== player.id)
        || selection.join("\0") !== nextSelection.join("\0");
      hpBarIsGM = player.role === "GM";
      hpBarPlayerId = player.id || hpBarPlayerId;
      if (!changed) return;
      try { await handleSelection(nextSelection); } catch (e) {
        console.warn("[hp-bar] handleSelection threw:", e);
      }
    }),
  );

  // Items change listener — handles flag-flip mid-selection AND
  // catches the case where the selected token gets bound to a
  // bestiary monster / character card while the popover is open
  // (we should close in that case to avoid duplicate UI).
  unsubs.push(
    OBR.scene.items.onChange((items) => {
      if (!active || !sceneReady) return;
      // These are current full snapshots, consumed synchronously before any
      // await. A later relevant snapshot invalidates an outstanding read.
      if (currentItemId) {
        const shown = items.find(item => item.id === currentItemId);
        if (!mayEditHp(shown, hpBarIsGM, hpBarPlayerId)) {
          publishTarget(null, true);
          void closePopover(); // Pin never preserves deleted/revoked targets.
        }
      }
      if (selection.length !== 1) return;
      const item = items.find(item => item.id === selection[0]);
      if (eligibilitySignature(item) === selectedSignature) return;
      void handleSelection(selection, item ?? null).catch(error => {
        console.warn("[hp-bar] item snapshot handling failed", { itemId: item?.id, error });
      });
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
      await handleSelection(selection);
    }),
  );

  // Scene-ready: re-evaluate selection so popover opens if needed.
  unsubs.push(
    OBR.scene.onReadyChange(async (ready) => {
      sceneReady = ready;
      selectionVersion++;
      selectedSignature = "";
      if (!ready) { selection = []; await closePopover(); }
      else {
        const version = selectionVersion;
        try {
          const sel = await OBR.player.getSelection();
          if (active && sceneReady && version === selectionVersion) await handleSelection(sel);
        } catch (error) { console.warn("[hp-bar] scene selection read failed", { error }); }
      }
    }),
  );

  // Initial pass.
  try {
    const version = selectionVersion;
    const sel = await OBR.player.getSelection();
    if (active && sceneReady && version === selectionVersion) await handleSelection(sel);
  } catch (error) { console.warn("[hp-bar] initial selection read failed", { error }); }

  // Re-anchor on viewport resize, drag-end, and panel reset.
  unsubs.push(
    onViewportResize(async () => {
      if (popoverOpen && currentItemId) {
        reanchor = true;
        await syncPanel();
      }
    }),
  );
  unsubs.push(
    OBR.broadcast.onMessage(BC_PANEL_DRAG_END, async (event) => {
      const payload = event.data as DragEndPayload | undefined;
      if (payload?.panelId !== PANEL_IDS.hpBar) return;
      if (popoverOpen && currentItemId) {
        reanchor = true;
        await syncPanel();
      }
    }),
  );
  unsubs.push(
    OBR.broadcast.onMessage(BC_PANEL_RESET, async () => {
      if (popoverOpen && currentItemId) {
        reanchor = true;
        await syncPanel();
      }
    }),
  );
}

export async function teardownHpBar(): Promise<void> {
  active = false;
  sceneReady = false;
  selectionVersion++;
  selection = [];
  for (const u of unsubs.splice(0)) {
    try { u(); } catch {}
  }
  try { await OBR.contextMenu.remove(CTX_ADD); } catch {}
  try { await OBR.contextMenu.remove(CTX_REMOVE); } catch {}
  await closePopover();
}
