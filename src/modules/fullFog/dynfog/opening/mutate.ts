// Writes to the shared `Opening[]` on a FOG-layer Drawing.
//
// Only the GM can update FOG-layer items, so every mutation goes
// through here and players reach it via the broadcast in
// `tools/toggleChannel.ts`.
//
// Any write also MIGRATES a drawing that still carries the official
// extension's `rodeo.owlbear.dynamic-fog/doors` array: `readOpenings`
// converts it on the way in, and the upstream key is dropped on the way
// out so the two representations can't drift apart.

import OBR, { type Item } from "@owlbear-rodeo/sdk";
import { OPENINGS_KEY } from "../ids";
import { isDrawing, drawingToPolylines } from "../geom/drawing";
import { UPSTREAM_DOORS_KEY, readOpenings, serialiseOpenings } from "./read";
import { playerOperable, type Opening } from "./types";

function currentOpenings(item: Item): Opening[] {
  // Upstream's shape stores ABSOLUTE arc length, so converting it needs
  // the drawing's contours.
  const polylines = isDrawing(item) ? drawingToPolylines(item) : undefined;
  return readOpenings(item, polylines);
}

async function editOpenings(
  itemId: string,
  edit: (openings: Opening[]) => Opening[] | null,
): Promise<void> {
  try {
    await OBR.scene.items.updateItems([itemId], (items) => {
      const item = items[0];
      if (!item) return;
      const next = edit(currentOpenings(item));
      if (!next) return;
      const metadata = item.metadata as Record<string, unknown>;
      metadata[OPENINGS_KEY] = serialiseOpenings(next);
      if (UPSTREAM_DOORS_KEY in metadata) delete metadata[UPSTREAM_DOORS_KEY];
    });
  } catch (e) {
    console.warn("[dynfog] opening update failed", e);
  }
}

export async function addOpening(
  itemId: string,
  opening: Opening,
): Promise<void> {
  await editOpenings(itemId, (openings) => [...openings, opening]);
}

export async function toggleOpening(
  itemId: string,
  openingId: string,
): Promise<void> {
  await editOpenings(itemId, (openings) => {
    let hit = false;
    const next = openings.map((o) => {
      if (o.id !== openingId) return o;
      hit = true;
      return { ...o, open: !o.open };
    });
    return hit ? next : null;
  });
}

export async function setOpeningState(
  itemId: string,
  openingId: string,
  open: boolean,
): Promise<void> {
  await editOpenings(itemId, (openings) => {
    let changed = false;
    const next = openings.map((o) => {
      if (o.id !== openingId || o.open === open) return o;
      changed = true;
      return { ...o, open };
    });
    return changed ? next : null;
  });
}

/**
 * Apply a toggle a PLAYER asked for.
 *
 * Runs on the GM's client, from the broadcast listener. Identical to
 * `setOpeningState` except it refuses openings a player is not allowed
 * to see — a secret door. The player's client never draws an indicator
 * for one, so this only matters against a hand-rolled broadcast, but
 * "the client hides it" is not a permission check and this is where the
 * permission actually lives.
 *
 * @returns true when the opening was changed.
 */
export async function applyPlayerOpeningState(
  itemId: string,
  openingId: string,
  open: boolean,
): Promise<boolean> {
  let applied = false;
  await editOpenings(itemId, (openings) => {
    let changed = false;
    const next = openings.map((o) => {
      if (o.id !== openingId) return o;
      // playerOperable, not playerVisible: a player can SEE a window
      // but must not be able to work its shutters.
      if (!playerOperable(o)) return o;
      if (o.open === open) return o;
      changed = true;
      return { ...o, open };
    });
    applied = changed;
    return changed ? next : null;
  });
  return applied;
}

export async function deleteOpening(
  itemId: string,
  openingId: string,
): Promise<void> {
  await editOpenings(itemId, (openings) => {
    const next = openings.filter((o) => o.id !== openingId);
    return next.length === openings.length ? null : next;
  });
}
