// Kill a token drag that is already in flight.
//
// Owlbear has no "cancel the current gesture" API. The trick that works
// is to LOCK whatever the player has selected — the drag system drops a
// gesture on a locked item — deselect, then unlock again once the drag
// has had time to die.
//
// Callers use it before doing something that would fight a live drag:
// moving the camera out from under the player (focus.ts) or dropping a
// full-screen overlay over the scene (timeStop.ts). Both had their own
// identical copy of this before, and both land in the background chunk.

import OBR from "@owlbear-rodeo/sdk";

/** How long to leave the selection locked.
 *
 *  Long enough for Owlbear's drag system to notice the lock and cancel
 *  the gesture; short enough that it does not visibly delay the
 *  player's next click. */
const UNLOCK_DELAY_MS = 250;

export async function interruptInFlightDrag(): Promise<void> {
  try {
    const sel = await OBR.player.getSelection();
    if (!sel || sel.length === 0) return;
    const ids = [...sel];
    try {
      await OBR.scene.items.updateItems(ids, (drafts) => {
        for (const d of drafts) d.locked = true;
      });
    } catch {
      // No write permission on the selection — skip the lock and still
      // deselect, which is the half of the trick a player can always do.
    }
    try {
      await OBR.player.deselect();
    } catch {}
    setTimeout(() => {
      OBR.scene.items
        .updateItems(ids, (drafts) => {
          for (const d of drafts) d.locked = false;
        })
        .catch(() => {});
    }, UNLOCK_DELAY_MS);
  } catch {}
}
