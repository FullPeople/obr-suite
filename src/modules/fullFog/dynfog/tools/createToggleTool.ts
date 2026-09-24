// 「开关门窗」 — a standalone toolbar tool everyone gets, so players can
// work the doors and windows the GM placed without needing the fog tool
// (which Owlbear reserves for the GM).
//
// Why a whole tool rather than click-to-select on the indicator: local
// scene items would have to be unlocked to be selectable, and an
// unlocked overlay can be dragged out from under its wall. Tool events
// hit locked items, so the tool keeps the overlay tamper-proof.
//
// The GM gets the same tool — it's the quickest way to run a door
// without leaving whatever they were doing.

import OBR, { type Item } from "@owlbear-rodeo/sdk";
import { getLocalLang } from "../../../../state";
import { ICON_TOGGLE } from "../overlayAssets";
import { OVERLAY_OPENING_KEY, TOGGLE_MODE_ID, TOGGLE_TOOL_ID } from "../ids";
import { isGM } from "../runtime";
import { setOpeningState } from "../opening/mutate";
import { playerOperable } from "../opening/types";
import { requestOpeningState } from "./toggleChannel";
import type { Reconciler } from "../reconcile/Reconciler";
import { OpeningReactor } from "../reconcile/reactors/OpeningReactor";

let registered = false;

function overlayTarget(
  target?: Item,
): { itemId: string; openingId: string } | null {
  if (!target || !target.attachedTo) return null;
  const openingId = (target.metadata as Record<string, unknown> | undefined)?.[
    OVERLAY_OPENING_KEY
  ];
  if (typeof openingId !== "string") return null;
  return { itemId: target.attachedTo, openingId };
}

export async function createToggleTool(
  reconciler: Reconciler | null,
): Promise<void> {
  if (registered) return;
  const en = getLocalLang() === "en";

  /**
   * Current state of an opening, from this client's own cache.
   *
   * Returns null for anything this client may not operate, which for a
   * player includes secret doors. A player never gets an indicator for
   * one so there is nothing to click, but the opening IS in the shared
   * metadata their client caches — this keeps the tool from acting on
   * it if some other path ever surfaces it.
   */
  function currentState(itemId: string, openingId: string): boolean | null {
    const actor = reconciler?.find(OpeningReactor)?.getActor(itemId);
    const opening = actor?.openings.find((o) => o.id === openingId);
    if (!opening) return null;
    if (!isGM() && !playerOperable(opening)) return null;
    return opening.open;
  }

  try {
    await OBR.tool.create({
      id: TOGGLE_TOOL_ID,
      icons: [{ icon: ICON_TOGGLE, label: en ? "Doors" : "开关门窗" }],
      defaultMode: TOGGLE_MODE_ID,
      shortcut: "K",
    });

    await OBR.tool.createMode({
      id: TOGGLE_MODE_ID,
      icons: [
        {
          icon: ICON_TOGGLE,
          label: en ? "Open / close" : "开 / 关",
          filter: { activeTools: [TOGGLE_TOOL_ID] },
        },
      ],
      async onToolClick(_, event) {
        const overlay = overlayTarget(event.target);
        if (!overlay) return;
        const current = currentState(overlay.itemId, overlay.openingId);
        if (current === null) return;
        if (isGM()) {
          await setOpeningState(overlay.itemId, overlay.openingId, !current);
        } else {
          requestOpeningState(overlay.itemId, overlay.openingId, !current);
        }
      },
      cursors: [
        {
          cursor: "pointer",
          filter: {
            target: [
              {
                key: ["metadata", OVERLAY_OPENING_KEY],
                value: undefined,
                operator: "!=",
              },
            ],
          },
        },
        { cursor: "default", filter: {} },
      ],
    });
    registered = true;
  } catch (e) {
    console.warn("[dynfog] toggle tool registration failed", e);
  }
}

export async function removeToggleTool(): Promise<void> {
  if (!registered) return;
  registered = false;
  try {
    await OBR.tool.removeMode(TOGGLE_MODE_ID);
  } catch {}
  try {
    await OBR.tool.remove(TOGGLE_TOOL_ID);
  } catch {}
}
