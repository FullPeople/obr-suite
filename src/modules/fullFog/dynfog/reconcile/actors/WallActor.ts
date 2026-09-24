// One FOG-layer Drawing → N local `Wall` items.
//
// Walls live in `OBR.scene.local`, i.e. per client — they're never part
// of the shared scene. Every client derives them from the same shared
// drawings, so everyone agrees without any sync traffic.
//
// The geometry itself lives in `geom/wallGeometry.ts`; this class is the
// item plumbing around it. Port of upstream `WallActor`.

import {
  buildWall,
  isWall,
  type Item,
  type Matrix,
  type Vector2,
  type Wall,
} from "@owlbear-rodeo/sdk";
import { Actor } from "../Actor";
import type { Reconciler } from "../Reconciler";
import { isDrawing, type Drawing } from "../../geom/drawing";
import { deriveWallPolylines, expandContours } from "../../geom/wallGeometry";
import { remapT, subPolyline } from "../../geom/polyline";
import type { Cut } from "../../geom/cut";
import {
  identityMatrix,
  inverseTransformPoints,
  itemMatrix,
  matrixScaleFactor,
  transformPoint,
} from "../../geom/xform";
import { OpeningReactor } from "../reactors/OpeningReactor";
import {
  FOG_PATH_KEY,
  FOG_WALL_EXPAND_KEY,
  FOG_WALL_EXPAND_LOCAL_KEY,
} from "../../ids";
import { getSceneDpi } from "../../runtime";

// Confirmed in the native host: invisible walls retain movement collision.
const WINDOW_COLLISION_KEY = "com.obr-suite/fullFog/windowCollisionWall";

export class WallActor extends Actor {
  private walls: string[] = [];
  private windowWalls = new Map<string, {
    id: string;
    points: Vector2[];
    blocking: boolean;
    transform: string;
  }>();
  private opening: OpeningReactor;
  /** Inputs hash of the last emitted geometry — skips redundant work
   *  when an unrelated fog item changes. */
  private signature = "";
  /** The polylines currently emitted as Wall items, in the parent's
   *  LOCAL space, plus the transform that puts them in world space.
   *  Read by `light/occlusion.ts` to build its line-of-sight index —
   *  it must see exactly the geometry Owlbear is blocking light with,
   *  including every door that is currently open. */
  private derived: Vector2[][] = [];
  private derivedMatrix: Matrix = identityMatrix();
  /** Memoised 墙体外扩 result — see `expandedContours`. */
  private expandedCache: { key: string; polys: Vector2[][] } | null = null;
  /** The transform last written onto the wall items, so an update that
   *  only changed a door somewhere else does not have to rewrite it. */
  private appliedTransform = "";

  constructor(reconciler: Reconciler, parent: Item) {
    super(reconciler);
    const opening = reconciler.find(OpeningReactor);
    if (!opening) {
      throw Error("WallActor requires an OpeningReactor to be registered first");
    }
    this.opening = opening;
    if (isDrawing(parent)) {
      const polylines = this.computePolylines(parent);
      this.signature = this.computeSignature(parent);
      this.derived = polylines;
      this.derivedMatrix = itemMatrix(parent);
      this.appliedTransform = transformKey(parent);
      const items = polylines.map((p) => this.polylineToWall(parent, p));
      this.walls = items.map((i) => i.id);
      if (items.length > 0) this.reconciler.patcher.addItems(...items);
      this.syncWindowWalls(parent);
    }
  }

  delete(): void {
    if (this.walls.length > 0) {
      this.reconciler.patcher.deleteItems(...this.walls);
    }
    this.walls = [];
    if (this.windowWalls.size > 0) {
      this.reconciler.patcher.deleteItems(
        ...[...this.windowWalls.values()].map((wall) => wall.id),
      );
      this.windowWalls.clear();
    }
    this.derived = [];
    this.expandedCache = null;
  }

  /** What this actor currently blocks vision with, in WORLD space.
   *  Recomputed on demand rather than cached, because the only caller
   *  rebuilds its index just as rarely as this geometry changes. */
  worldPolylines(): Vector2[][] {
    if (this.derived.length === 0) return [];
    const matrix = this.derivedMatrix;
    return this.derived.map((poly) =>
      poly.map((p) => transformPoint(matrix, p)),
    );
  }

  /** Cheap "has anything I emit changed" token, for cache invalidation
   *  in consumers. */
  get geometrySignature(): string {
    return this.signature;
  }

  update(parent: Item): void {
    if (!isDrawing(parent)) return;
    const signature = this.computeSignature(parent);
    if (signature === this.signature) return;
    this.signature = signature;

    const previous = this.derived;
    const next = this.computePolylines(parent);
    const transform = transformKey(parent);
    const moved = transform !== this.appliedTransform;
    this.derived = next;
    this.derivedMatrix = itemMatrix(parent);
    this.appliedTransform = transform;

    const ids = this.walls;

    // GROW FIRST, SHRINK LAST — with the Patcher flushing adds before
    // deletes, that keeps the blocking set a superset of the target at
    // every intermediate state. See Patcher.flush.
    const grownFrom = ids.length;
    for (let i = grownFrom; i < next.length; i++) {
      const wall = this.polylineToWall(parent, next[i]);
      ids.push(wall.id);
      this.reconciler.patcher.addItems(wall);
    }

    // Patch only what actually moved.
    //
    // A door toggle anywhere in the scene bumps every WallActor's
    // signature, because an opening on an overlapping shape can cut
    // this one (see computeSignature). Without this test every wall in
    // the scene would be rewritten on every toggle — on a traced map
    // that is thousands of items per click, and the resulting stall is
    // long enough to see as a flicker.
    const keep = Math.min(grownFrom, next.length);
    for (let i = 0; i < keep; i++) {
      const points = next[i];
      if (!moved && samePolyline(previous[i], points)) continue;
      this.reconciler.patcher.updateItems([
        ids[i],
        (item) => {
          if (!isWall(item)) return;
          item.points = points;
          item.position = parent.position;
          item.rotation = parent.rotation;
          item.scale = parent.scale;
        },
      ]);
    }

    if (ids.length > next.length) {
      const removed = ids.splice(next.length, ids.length - next.length);
      if (removed.length > 0) this.reconciler.patcher.deleteItems(...removed);
    }
    this.syncWindowWalls(parent);
  }

  /** The normal opaque walls still have a window-shaped gap. Keep a separate
   * native WALL there with visible=false and blocking=!open. Never include
   * this collision wall in the suite's line-of-sight index. */
  private syncWindowWalls(parent: Drawing): void {
    const actor = this.opening.getActor(parent.id);
    const raw = actor?.polylines ?? [];
    const { expandLocal, expandMinPx } = this.wallExpand(parent);
    const expanded = this.expandedContours(parent, raw, expandLocal, expandMinPx);
    const transform = transformKey(parent);
    const live = new Set<string>();
    for (const opening of actor?.openings ?? []) {
      if (opening.kind !== "window") continue;
      const source = raw[opening.polyIndex];
      const poly = expanded[opening.polyIndex];
      if (!source || !poly) continue;
      const start = expanded === raw ? opening.t1 : remapT(source, poly, opening.t1);
      const end = expanded === raw ? opening.t2 : remapT(source, poly, opening.t2);
      const points = subPolyline(poly, Math.min(start, end), Math.max(start, end));
      if (points.length < 2) continue;
      live.add(opening.id);
      const blocking = !opening.open;
      const previous = this.windowWalls.get(opening.id);
      if (!previous) {
        const wall = this.polylineToWall(parent, points);
        wall.name = "Window collision";
        wall.visible = false;
        wall.blocking = blocking;
        wall.metadata = { ...wall.metadata, [WINDOW_COLLISION_KEY]: opening.id };
        this.windowWalls.set(opening.id, { id: wall.id, points, blocking, transform });
        this.reconciler.patcher.addItems(wall);
      } else if (
        previous.blocking !== blocking || previous.transform !== transform ||
        !samePolyline(previous.points, points)
      ) {
        this.reconciler.patcher.updateItems([previous.id, (item) => {
          if (!isWall(item)) return;
          item.points = points;
          item.position = parent.position;
          item.rotation = parent.rotation;
          item.scale = parent.scale;
          item.visible = false;
          item.blocking = blocking;
        }]);
        this.windowWalls.set(opening.id, { id: previous.id, points, blocking, transform });
      }
    }
    for (const [openingId, wall] of this.windowWalls) {
      if (live.has(openingId)) continue;
      this.reconciler.patcher.deleteItems(wall.id);
      this.windowWalls.delete(openingId);
    }
  }

  /** Everything that can change the emitted walls, cheaply hashed. */
  private computeSignature(parent: Item): string {
    const actor = this.opening.getActor(parent.id);
    return [
      parent.lastModified,
      parent.position.x,
      parent.position.y,
      parent.rotation,
      parent.scale.x,
      parent.scale.y,
      actor?.signature ?? "",
      // A door toggled on ANY drawing must re-evaluate this one, since
      // openings cut across overlapping fog shapes. Bounding-box
      // filtering inside the cut maths keeps that cheap.
      this.opening.getAllSignature(),
    ].join("|");
  }

  private computePolylines(parent: Drawing): Vector2[][] {
    const actor = this.opening.getActor(parent.id);
    const raw = actor?.polylines ?? [];
    if (raw.length === 0) return [];

    const { expandLocal, expandMinPx } = this.wallExpand(parent);
    const foreign = this.opening.getForeignCuts(parent.id);

    return deriveWallPolylines({
      polylines: raw,
      openings: actor?.openings ?? [],
      foreignCuts: foreign.length > 0 ? this.toLocalCuts(parent, foreign) : [],
      expandLocal,
      expandMinPx,
      expanded: this.expandedContours(parent, raw, expandLocal, expandMinPx),
    });
  }

  /**
   * 墙体外扩, memoised.
   *
   * The offset raycasts every vertex against every non-adjacent edge of
   * its contour, so it is O(n²) per contour — on a traced map it dwarfs
   * everything else in this class. It depends only on the drawing's own
   * geometry, while `computePolylines` re-runs whenever ANY door in the
   * scene moves (a door on an overlapping shape can cut this wall). Not
   * caching it would turn every door toggle anywhere into a full
   * re-offset of every expanded map in the scene.
   */
  private expandedContours(
    parent: Drawing,
    raw: Vector2[][],
    expandLocal: number,
    expandMinPx: number,
  ): Vector2[][] {
    if (expandLocal === 0) return raw;
    const key = `${parent.lastModified}|${expandLocal}|${expandMinPx}`;
    if (this.expandedCache && this.expandedCache.key === key) {
      return this.expandedCache.polys;
    }
    const polys = expandContours(raw, expandLocal, expandMinPx);
    this.expandedCache = { key, polys };
    return polys;
  }

  /**
   * The fog editor stores `wallExpandPx` (in IMAGE pixels) on its
   * outline Path so the BLOCKING wall can sit inside or outside the
   * visible outline. Only that item carries the marker, so hand-drawn
   * fog is untouched.
   */
  private wallExpand(parent: Drawing): {
    expandLocal: number;
    expandMinPx: number;
  } {
    const md = parent.metadata as Record<string, unknown> | undefined;
    if (!md || md[FOG_PATH_KEY] !== true) {
      return { expandLocal: 0, expandMinPx: 1 };
    }

    // Preferred: the editor already converted it (saves since
    // 2026-08-25). Works for bound and unbound saves alike.
    const local = Number(md[FOG_WALL_EXPAND_LOCAL_KEY]);
    if (Number.isFinite(local) && local !== 0) {
      return { expandLocal: local, expandMinPx: 1 };
    }

    const expandImgPx = Number(md[FOG_WALL_EXPAND_KEY] ?? 0);
    if (!Number.isFinite(expandImgPx) || expandImgPx === 0) {
      return { expandLocal: 0, expandMinPx: 1 };
    }
    // Legacy: the value is in IMAGE pixels while the Path's commands
    // are in MAP-LOCAL units (`imagePx × sceneDpi / imageGridDpi`), so
    // the ratio has to come from the map the Path is attached to.
    const sceneDpi = getSceneDpi();
    const map = this.reconciler.getItem(parent.attachedTo) as any;
    const imgDpi = map?.grid?.dpi || sceneDpi;
    const ratio = imgDpi > 0 ? sceneDpi / imgDpi : 1;
    return { expandLocal: expandImgPx * ratio, expandMinPx: ratio };
  }

  /** Re-express world-space cuts in the parent's local units so the
   *  proximity test runs in the same space as the polylines. */
  private toLocalCuts(parent: Drawing, cuts: Cut[]): Cut[] {
    const matrix = itemMatrix(parent);
    const scale = matrixScaleFactor(matrix) || 1;
    return cuts.map((cut) => {
      const points = inverseTransformPoints(matrix, cut.points);
      const radius = cut.radius / scale;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const p of points) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
      return {
        ...cut,
        points,
        radius,
        bbox: Number.isFinite(minX)
          ? {
              minX: minX - radius,
              minY: minY - radius,
              maxX: maxX + radius,
              maxY: maxY + radius,
            }
          : { minX: 0, minY: 0, maxX: 0, maxY: 0 },
      };
    });
  }

  private polylineToWall(parent: Drawing, points: Vector2[]): Wall {
    return buildWall()
      .points(points)
      .doubleSided(true)
      .blocking(true)
      .attachedTo(parent.id)
      .position(parent.position)
      .rotation(parent.rotation)
      .scale(parent.scale)
      .disableAttachmentBehavior(["VISIBLE", "COPY"])
      .build();
  }
}

/** Everything about the parent that gets written onto its wall items. */
function transformKey(parent: Item): string {
  return [
    parent.position.x,
    parent.position.y,
    parent.rotation,
    parent.scale.x,
    parent.scale.y,
  ].join(",");
}

/** Exact equality. `computePolylines` rebuilds its arrays every pass so
 *  reference equality never fires, but the VALUES are identical for any
 *  contour the change did not touch — which, on a door toggle, is all
 *  of them but one. */
function samePolyline(a: Vector2[] | undefined, b: Vector2[]): boolean {
  if (!a || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].x !== b[i].x || a[i].y !== b[i].y) return false;
  }
  return true;
}
