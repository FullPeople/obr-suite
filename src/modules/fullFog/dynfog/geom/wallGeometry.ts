// The pure half of wall derivation: contours + openings + foreign cuts
// → the polylines that become `Wall` items.
//
// Split out of WallActor so it can be exercised without OBR, a
// Reconciler or a live scene — see `dynfog/selftest.ts`. WallActor keeps
// the item plumbing; everything geometric lives here.

import type { Vector2 } from "@owlbear-rodeo/sdk";
import { remapT, splitPolylineByRanges, type TRange } from "./polyline";
import { cutRangesForPolyline, type Cut } from "./cut";
import { safeWallOffset } from "../../output/wallOffset";
import { cutsWall, type Opening } from "../opening/types";

export interface WallDerivationInput {
  /** Contours in the drawing's local space, from `drawingToPolylines`. */
  polylines: Vector2[][];
  /** Openings stored on this drawing. */
  openings: Opening[];
  /** Open openings owned by OTHER drawings, already expressed in THIS
   *  drawing's local space. */
  foreignCuts: Cut[];
  /** 墙体外扩 distance in the drawing's local units. 0 disables it. */
  expandLocal?: number;
  /** Minimum clearance the offset keeps from the opposite wall of a
   *  thin feature. Local units. */
  expandMinPx?: number;
  /**
   * Pre-computed result of `expandContours(polylines, expandLocal, …)`.
   *
   * The offset is O(n²) per contour (each vertex raycasts against every
   * non-adjacent edge), so on a traced map it is by far the most
   * expensive step here — and it only depends on the drawing's own
   * geometry, never on any opening. Callers that re-derive walls
   * because a door moved SOMEWHERE ELSE in the scene should cache it
   * and pass it back in. Must be identical to what `expandContours`
   * would return, including vertex counts (`remapT` relies on the 1:1
   * correspondence).
   */
  expanded?: Vector2[][];
}

/**
 * Offset closed contours outward / inward, preserving vertex counts so
 * `remapT` can still relate the two. Returns the input untouched when
 * there's nothing to do.
 */
export function expandContours(
  polys: Vector2[][],
  expandLocal: number,
  minPx: number,
): Vector2[][] {
  if (!Number.isFinite(expandLocal) || expandLocal === 0) return polys;

  // `safeWallOffset` wants N distinct vertices; our closed contours
  // repeat the first point at the end. Strip, offset, re-append.
  const closed: boolean[] = [];
  const stripped = polys.map((p) => {
    if (p.length >= 3) {
      const first = p[0];
      const last = p[p.length - 1];
      if (
        Math.abs(first.x - last.x) < 1e-6 &&
        Math.abs(first.y - last.y) < 1e-6
      ) {
        closed.push(true);
        return p.slice(0, -1);
      }
    }
    closed.push(false);
    return p;
  });

  const offset = safeWallOffset(stripped, expandLocal, minPx);
  return offset.map((p, i) =>
    closed[i] && p.length >= 1 ? [...p, { x: p[0].x, y: p[0].y }] : p,
  );
}

/**
 * The polylines that should become Wall items.
 *
 * Openings on this drawing are removed exactly, in the t-domain.
 * Openings owned by other drawings are removed by proximity, which is
 * how a door on a shared wall opens both overlapping fog shapes.
 */
export function deriveWallPolylines(
  input: WallDerivationInput,
): Vector2[][] {
  const { polylines: raw, openings, foreignCuts } = input;
  if (raw.length === 0) return [];

  const expanded =
    input.expanded ??
    expandContours(raw, input.expandLocal ?? 0, input.expandMinPx ?? 1);
  const offsetApplied = expanded !== raw;

  const out: Vector2[][] = [];
  for (let pi = 0; pi < expanded.length; pi++) {
    const poly = expanded[pi];
    if (poly.length < 2) continue;

    const ranges: TRange[] = [];
    for (const opening of openings) {
      if (!cutsWall(opening) || opening.polyIndex !== pi) continue;
      const source = raw[pi];
      if (offsetApplied && source) {
        ranges.push({
          t1: remapT(source, poly, opening.t1),
          t2: remapT(source, poly, opening.t2),
        });
      } else {
        ranges.push({ t1: opening.t1, t2: opening.t2 });
      }
    }
    if (foreignCuts.length > 0) {
      ranges.push(...cutRangesForPolyline(poly, foreignCuts));
    }

    if (ranges.length === 0) {
      out.push(poly);
      continue;
    }
    for (const piece of splitPolylineByRanges(poly, ranges)) out.push(piece);
  }
  return out;
}
