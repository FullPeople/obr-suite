// Reading openings off a Drawing's metadata, tolerantly.
//
// Three shapes are accepted:
//
//   1. Ours — `{id, kind, open, polyIndex, t1, t2}`.
//   2. Ours, pre-`id` (scenes authored by the 2026-05 door tool) —
//      same minus `id`; a deterministic id is synthesised from the
//      array index so overlays stay stable within a session.
//   3. Upstream dynamic-fog — `{open, start:{index,distance},
//      end:{index,distance}}` where `distance` is ABSOLUTE arc length
//      on the contour. Converted with the contour's own length. Read
//      only; we never write this shape back.

import type { Item, Vector2 } from "@owlbear-rodeo/sdk";
import { OPENINGS_KEY } from "../ids";
import { polylineLength } from "../geom/polyline";
import { type Opening, type OpeningKind } from "./types";

/** Metadata key the official Owlbear extension writes doors under. */
export const UPSTREAM_DOORS_KEY = "rodeo.owlbear.dynamic-fog/doors";

function asKind(value: unknown): OpeningKind {
  if (value === "window") return "window";
  if (value === "secret") return "secret";
  return "door";
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/**
 * Normalise whatever is on `item.metadata` into `Opening[]`.
 *
 * `polylines` is only needed to convert the upstream absolute-distance
 * shape; pass the drawing's contours when you have them.
 */
export function readOpenings(
  item: Item,
  polylines?: Vector2[][],
): Opening[] {
  const md = item.metadata as Record<string, unknown> | undefined;
  if (!md) return [];

  const out: Opening[] = [];

  const own = md[OPENINGS_KEY];
  if (Array.isArray(own)) {
    for (let i = 0; i < own.length; i++) {
      const raw = own[i] as Record<string, unknown> | null;
      if (!raw || typeof raw !== "object") continue;
      const polyIndex = Number(raw.polyIndex);
      const t1 = Number(raw.t1);
      const t2 = Number(raw.t2);
      if (!Number.isFinite(polyIndex) || polyIndex < 0) continue;
      if (!Number.isFinite(t1) || !Number.isFinite(t2)) continue;
      out.push({
        id: typeof raw.id === "string" && raw.id ? raw.id : `legacy-${i}`,
        kind: asKind(raw.kind),
        open: raw.open === true,
        polyIndex: Math.floor(polyIndex),
        t1: clamp01(t1),
        t2: clamp01(t2),
      });
    }
  }

  // Our own array wins outright: once a drawing has been written by this
  // engine the upstream key is stale (and `mutate.ts` deletes it), so
  // reading both would show every migrated door twice.
  const upstream = md[UPSTREAM_DOORS_KEY];
  if (
    out.length === 0 &&
    Array.isArray(upstream) &&
    polylines &&
    polylines.length > 0
  ) {
    for (let i = 0; i < upstream.length; i++) {
      const raw = upstream[i] as Record<string, any> | null;
      if (!raw || typeof raw !== "object") continue;
      const start = raw.start;
      const end = raw.end;
      if (!start || !end) continue;
      const index = Number(start.index);
      if (!Number.isFinite(index) || index !== Number(end.index)) continue;
      const poly = polylines[index];
      if (!poly) continue;
      const total = polylineLength(poly);
      if (total < 1e-6) continue;
      out.push({
        id: `upstream-${i}`,
        kind: "door",
        open: raw.open === true,
        polyIndex: index,
        t1: clamp01(Number(start.distance) / total),
        t2: clamp01(Number(end.distance) / total),
      });
    }
  }

  return out;
}

/** Cheap change-detection key. Two arrays with the same signature
 *  produce identical walls and identical overlays. */
export function openingsSignature(openings: Opening[]): string {
  if (openings.length === 0) return "";
  return openings
    .map(
      (o) =>
        `${o.id}|${o.kind}|${o.open ? 1 : 0}|${o.polyIndex}|` +
        `${Math.round(o.t1 * 100000)}|${Math.round(o.t2 * 100000)}`,
    )
    .join(";");
}

/** The `Opening[]` value to persist — strips anything not in the wire
 *  shape so a stray field can't bloat scene metadata. */
export function serialiseOpenings(openings: Opening[]): Opening[] {
  return openings.map((o) => ({
    id: o.id,
    kind: o.kind,
    open: o.open,
    polyIndex: o.polyIndex,
    t1: o.t1,
    t2: o.t2,
  }));
}
