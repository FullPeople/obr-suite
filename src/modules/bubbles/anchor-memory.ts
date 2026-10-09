/**
 * Persistence for the grid-box anchoring memory (`anchorMode: "box"`).
 *
 * The memory records, per token, where the bar's box sat inside its cells
 * on the last frame the token was lined up with the grid. It has to
 * survive a scene reload and mean the same thing on every client, so it
 * lives in SCENE metadata — next to the other DM-synced bubble settings
 * (`SCENE_BUBBLES_SETTINGS_KEY`), and written by the GM only, exactly
 * like those. Players read it; nobody but the GM writes.
 *
 * The stored shape is deliberately the plain JSON of `AnchorRef` — the
 * metadata inspector shows it verbatim, and a table that wants to reset a
 * single token can just delete its entry.
 *
 * Nothing in here talks to the SDK: the caller owns the read / write and
 * this module only does the (de)serialisation and the pruning, so the
 * codec is unit-testable without a room.
 */

import type { AnchorRef } from "./anchor-box";
import { MAX_OCCUPANCY } from "./anchor-box";

/** Scene-metadata key. Sibling of `com.obr-suite/bubbles/settings`. */
export const BUBBLE_ANCHORS_KEY = "com.obr-suite/bubbles/anchors";

/**
 * Upper bound on stored entries. A scene with more tokens than this is
 * far past the point where an in-cell calibration matters, and scene
 * metadata is replicated to every client on every change — the cap keeps
 * the blob (and its write traffic) bounded. Oldest snapshot wins the
 * eviction, and `Map` insertion order plus the re-insert on update gives
 * that for free.
 */
export const MAX_ANCHORS = 120;

const num = (v: unknown, d: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

/** One raw entry → `AnchorRef`, or `null` when it is not usable. */
function decodeRef(raw: unknown): AnchorRef | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const gx = Number(o.gx);
  const gy = Number(o.gy);
  const cols = Number(o.cols);
  const rows = Number(o.rows);
  const px = Number(o.px);
  const py = Number(o.py);
  const rot = Number(o.rot);
  const sx = Number(o.sx);
  const sy = Number(o.sy);
  // Position and cell index are the only fields the follow maths cannot
  // do without; the rest fall back to the identity.
  if (!Number.isFinite(gx) || !Number.isFinite(gy)) return null;
  if (!Number.isFinite(px) || !Number.isFinite(py)) return null;
  const clampCells = (v: number) => Math.min(MAX_OCCUPANCY, Math.max(1, Math.abs(v) || 1));
  return {
    gx,
    gy,
    cols: Number.isFinite(cols) ? clampCells(cols) : 1,
    rows: Number.isFinite(rows) ? clampCells(rows) : 1,
    px,
    py,
    rot: num(rot, 0),
    sx: num(sx, 1),
    sy: num(sy, 1),
  };
}

/**
 * Read the anchor table out of scene metadata. Unreadable entries are
 * dropped rather than fatal — a corrupted blob degrades to "canvas" for
 * the affected tokens instead of breaking the sync loop.
 */
export function readAnchors(meta: Record<string, unknown> | undefined | null): Map<string, AnchorRef> {
  const out = new Map<string, AnchorRef>();
  const raw = meta ? (meta as Record<string, unknown>)[BUBBLE_ANCHORS_KEY] : undefined;
  if (!raw || typeof raw !== "object") return out;
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    const ref = decodeRef(value);
    if (ref) out.set(id, ref);
  }
  return out;
}

/**
 * Drop entries for tokens that are no longer in the scene, then enforce
 * the cap. `liveIds === null` means "unknown, don't prune by identity"
 * (used right after setup, before the first item read).
 */
export function pruneAnchors(
  map: Map<string, AnchorRef>,
  liveIds: Set<string> | null,
  limit = MAX_ANCHORS,
): boolean {
  let changed = false;
  if (liveIds) {
    for (const id of [...map.keys()]) {
      if (!liveIds.has(id)) {
        map.delete(id);
        changed = true;
      }
    }
  }
  while (map.size > limit) {
    const oldest = map.keys().next();
    if (oldest.done) break;
    map.delete(oldest.value);
    changed = true;
  }
  return changed;
}

/** `Map` → the JSON blob to hand to `OBR.scene.setMetadata`. */
export function encodeAnchors(
  map: Map<string, AnchorRef>,
  limit = MAX_ANCHORS,
): Record<string, AnchorRef> {
  const out: Record<string, AnchorRef> = {};
  // `Map` iterates in insertion order and every update re-inserts, so the
  // tail is the most recently calibrated — keep that end.
  const entries = [...map.entries()].slice(Math.max(0, map.size - limit));
  for (const [id, ref] of entries) out[id] = ref;
  return out;
}

/** Cheap structural equality, used to skip no-op metadata writes. */
export function sameRef(a: AnchorRef | undefined, b: AnchorRef | undefined): boolean {
  if (!a || !b) return a === b;
  return (
    a.gx === b.gx &&
    a.gy === b.gy &&
    a.cols === b.cols &&
    a.rows === b.rows &&
    a.px === b.px &&
    a.py === b.py &&
    a.rot === b.rot &&
    a.sx === b.sx &&
    a.sy === b.sy
  );
}
