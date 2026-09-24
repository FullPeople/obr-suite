// Player → GM door/window toggle channel.
//
// FOG-layer items are GM-writable only, so a player can't flip an
// opening directly no matter what the UI lets them click. They ask; the
// GM's background applies. The GM is also the single point where the
// "players may open doors" permission is enforced — a hand-rolled
// message can't bypass it.
//
// The request carries the DESIRED state rather than "flip it", because
// every GM client in the room receives the broadcast and a flip applied
// twice would cancel itself out.
//
// Two things are enforced GM-side and cannot be bypassed from a player
// client: the "players may open doors" setting, and the rule that a
// SECRET door is not a player-operable opening.

import OBR from "@owlbear-rodeo/sdk";
import { BC_TOGGLE_OPENING, type ToggleRequest } from "../ids";
import { applyPlayerOpeningState } from "../opening/mutate";
import { getPlayerOpeningsEnabled, isGM } from "../runtime";

let unsubscribe: (() => void) | null = null;

/** Ask the GM to put an opening into `open`. */
export function requestOpeningState(
  itemId: string,
  openingId: string,
  open: boolean,
): void {
  const payload: ToggleRequest = { itemId, openingId, open };
  try {
    OBR.broadcast.sendMessage(BC_TOGGLE_OPENING, payload as any, {
      destination: "REMOTE",
    });
  } catch (e) {
    console.warn("[dynfog] toggle broadcast failed", e);
  }
}

/** GM side: listen for requests and apply them. Idempotent. */
export function startToggleListener(): void {
  if (unsubscribe) return;
  try {
    unsubscribe = OBR.broadcast.onMessage(BC_TOGGLE_OPENING, async (event) => {
      if (!isGM()) return;
      if (!getPlayerOpeningsEnabled()) return;
      const data = event.data as ToggleRequest | undefined;
      if (
        !data ||
        typeof data.itemId !== "string" ||
        typeof data.openingId !== "string" ||
        typeof data.open !== "boolean"
      ) {
        return;
      }
      // `applyPlayerOpeningState` — not `setOpeningState` — so a
      // hand-rolled broadcast can't work a secret door.
      await applyPlayerOpeningState(data.itemId, data.openingId, data.open);
    });
  } catch (e) {
    console.warn("[dynfog] toggle listener failed", e);
  }
}

export function stopToggleListener(): void {
  if (!unsubscribe) return;
  try {
    unsubscribe();
  } catch {}
  unsubscribe = null;
}
