// Caches everything derived from one FOG-layer Drawing that other
// reactors need: its contour polylines (the arc-length space openings
// are addressed in) and the world-space cut geometry of its OPEN
// openings.
//
// Equivalent of upstream's `DoorActor`, which kept a Skia path per door.
// It creates no local items of its own — it's pure cached geometry.

import { type Item, type Vector2 } from "@owlbear-rodeo/sdk";
import { Actor } from "../Actor";
import type { Reconciler } from "../Reconciler";
import { drawingToPolylines, isDrawing, type Drawing } from "../../geom/drawing";
import { itemMatrix, matrixScaleFactor, transformPoint } from "../../geom/xform";
import { pointAtT, subPolyline } from "../../geom/polyline";
import { bboxOf, type BBox, type Cut } from "../../geom/cut";
import { openingsSignature, readOpenings } from "../../opening/read";
import { cutsWall, type Opening } from "../../opening/types";

/** Extra half-width added to a cut so it reliably clears the wall it is
 *  supposed to open, even when the two shapes only roughly align.
 *  Upstream adds a flat +20 to the door's stroke width for the same
 *  reason; we halve it because we work with radii. */
const CUT_PADDING = 10;

export class OpeningActor extends Actor {
  readonly parentId: string;

  /** Contours in the parent's LOCAL space. */
  polylines: Vector2[][] = [];
  /** Local-space bounds per contour, so the door tool can reject most
   *  contours with two comparisons instead of a full nearest-point
   *  sweep — a 50k-vertex traced map would otherwise be scanned in
   *  full on every pointer move. */
  polyBoxes: BBox[] = [];
  openings: Opening[] = [];
  /** World-space cut regions for the openings that are currently open. */
  cuts: Cut[] = [];
  /** `openingsSignature` of `openings`, for cheap change detection. */
  signature = "";
  /** The parent's `lastModified` when this cache was built. */
  stamp = "";

  constructor(reconciler: Reconciler, parent: Item) {
    super(reconciler);
    this.parentId = parent.id;
    this.rebuild(parent);
  }

  delete(): void {
    this.polylines = [];
    this.polyBoxes = [];
    this.openings = [];
    this.cuts = [];
  }

  update(parent: Item): void {
    this.rebuild(parent);
  }

  private rebuild(parent: Item) {
    if (!isDrawing(parent)) {
      this.polylines = [];
      this.polyBoxes = [];
      this.openings = [];
      this.cuts = [];
      this.signature = "";
      return;
    }
    const drawing = parent as Drawing;
    this.stamp = parent.lastModified;
    this.polylines = drawingToPolylines(drawing);
    this.polyBoxes = this.polylines.map((p) => bboxOf(p));
    this.openings = readOpenings(parent, this.polylines);
    this.cuts = this.buildCuts(drawing);
    this.signature = this.computeSignature(drawing);
  }

  /**
   * Cheap change key. It is `openingsSignature` PLUS this drawing's
   * transform and stroke width, but only when the drawing actually
   * contributes cuts.
   *
   * The transform matters to OTHER drawings, not to this one: every
   * WallActor folds `OpeningReactor.getAllSignature()` into its own key
   * so that a door on an overlapping shape re-cuts its neighbours. With
   * only the opening LIST in there, moving or resizing a shape that
   * owns an open door — or changing its stroke width, which is the cut
   * radius — left the neighbour's WallActor early-returning on an
   * unchanged signature, so the hole in its wall stayed at the old
   * position. Two overlapping rooms sharing a doorway: nudge the left
   * one and the right one keeps a gap where the door used to be, and
   * blocks the doorway where it now is.
   *
   * The `cuts.length` guard keeps this from undoing the flicker fix. A
   * drawing with nothing open contributes no cuts, so its transform
   * cannot affect any neighbour and must NOT bump the global signature
   * — otherwise dragging any fog shape would re-derive every wall in
   * the scene.
   */
  private computeSignature(drawing: Drawing): string {
    const base = openingsSignature(this.openings);
    if (this.cuts.length === 0) return base;
    const style = (drawing as any).style?.strokeWidth ?? 0;
    return [
      base,
      drawing.position.x,
      drawing.position.y,
      drawing.rotation,
      drawing.scale.x,
      drawing.scale.y,
      style,
    ].join("~");
  }

  /** World-space capsule chains for every OPEN opening on this drawing.
   *  currently REMOVES its stretch of wall — every open door / secret
   *  door, and every window regardless of its shutter state.
   *  Foreign drawings subtract these so a door on a shared wall opens
   *  both overlapping fog shapes. */
  private buildCuts(drawing: Drawing): Cut[] {
    const open = this.openings.filter(cutsWall);
    if (open.length === 0) return [];

    const matrix = itemMatrix(drawing);
    const scale = matrixScaleFactor(matrix);
    const strokeWidth = (drawing as any).style?.strokeWidth ?? 0;
    const radius = (strokeWidth / 2 + CUT_PADDING) * scale;

    const cuts: Cut[] = [];
    for (const opening of open) {
      const poly = this.polylines[opening.polyIndex];
      if (!poly) continue;
      const t1 = Math.min(opening.t1, opening.t2);
      const t2 = Math.max(opening.t1, opening.t2);
      let local = subPolyline(poly, t1, t2);
      if (local.length < 2) {
        const mid = pointAtT(poly, (t1 + t2) / 2);
        if (!mid) continue;
        local = [mid];
      }
      const points = local.map((p) => transformPoint(matrix, p));
      cuts.push({
        openingId: opening.id,
        parentId: this.parentId,
        points,
        radius,
        bbox: bboxOf(points, radius),
      });
    }
    return cuts;
  }
}
