// Visual indicators for every opening on one FOG-layer Drawing:
// a coloured stretch of wall plus a clickable billboard at its centre.
//
// Port of upstream `DoorOverlayActor`, extended for windows and for the
// player-facing mode:
//
//   GM      → CONTROL layer. Sits above FOG so the GM can always see
//             and click every opening, including ones inside their own
//             unexplored fog.
//   PLAYER  → DRAWING layer. Sits below FOG so the dynamic fog occludes
//             indicators the party hasn't discovered — otherwise every
//             door in the dungeon would leak the floor plan.
//
// Items stay `locked` so they can't be dragged out of sync with their
// parent; tool events still hit locked items, which is how both the
// GM's door mode and the player's toggle tool click them.
//
// Only the BILLBOARD is clickable. The indicator line is `disableHit`,
// so a click near a door lands on the button or on nothing — dragging
// out a new opening along an existing one used to get swallowed by the
// old one's line, and on a thick fog stroke the line is a much bigger
// target than the button it is supposed to sit under.
//
// Both items carry explicit zIndexes with auto-zIndex off, because the
// line's stroke width is the parent fog shape's, which on a traced map
// is wide enough to bury the billboard completely.
//
// Entries are keyed by `Opening.id` and patched in place, so toggling a
// door recolours it rather than deleting and re-adding the billboard
// (upstream keys by array index, which mismatches billboard and path
// whenever a door in the middle of the array is deleted).

import {
  buildBillboard,
  buildPath,
  Command,
  isBillboard,
  isPath,
  type Item,
  type PathCommand,
  type Vector2,
} from "@owlbear-rodeo/sdk";
import { Actor } from "../Actor";
import type { Reconciler } from "../Reconciler";
import { isDrawing, type Drawing } from "../../geom/drawing";
import { pointAtT, subPolyline } from "../../geom/polyline";
import { itemMatrix, transformPoint } from "../../geom/xform";
import { OpeningReactor } from "../reactors/OpeningReactor";
import { openingImage } from "../../overlayAssets";
import {
  COLOR_DOOR_CLOSED,
  COLOR_DOOR_OPEN,
  COLOR_SECRET_CLOSED,
  COLOR_SECRET_OPEN,
  COLOR_WINDOW_CLOSED,
  COLOR_WINDOW_OPEN,
  OVERLAY_OPENING_KEY,
  SECRET_DASH,
} from "../../ids";
import {
  playerOperable,
  playerVisible,
  type Opening,
} from "../../opening/types";
import { isGM } from "../../runtime";

/** Minimum stroke width for the indicator so a hairline fog shape
 *  still produces something clickable. */
const MIN_STROKE = 8;

/**
 * Base zIndex for the indicator pair, which depends on the layer and
 * therefore on the role.
 *
 * PLAYER (DRAWING): must sort ABOVE `Date.now()`. That is what Owlbear
 * stamps on ordinary drawings, so a lower value buries the indicators
 * under the map's own scribbles.
 *
 * GM (CONTROL): must sort BELOW `Date.now()`. The fog tool's own snap
 * dot and drag preview are built with the SDK's default zIndex — also
 * `Date.now()`, ~1.79e12 — and live on this same layer. A base above
 * that hid the orange control points behind the very indicators the GM
 * was trying to drag a new opening past.
 */
function zBase(layer: string): number {
  return layer === "CONTROL" ? 1_000 : 9_000_000_000_000;
}

export function openingColor(opening: Opening): string {
  if (opening.kind === "window") {
    return opening.open ? COLOR_WINDOW_OPEN : COLOR_WINDOW_CLOSED;
  }
  if (opening.kind === "secret") {
    return opening.open ? COLOR_SECRET_OPEN : COLOR_SECRET_CLOSED;
  }
  return opening.open ? COLOR_DOOR_OPEN : COLOR_DOOR_CLOSED;
}

/** Secret doors get a dashed indicator so the GM can tell one from a
 *  door the party can actually see, at a glance and colour-blind-safe. */
function openingDash(opening: Opening): number[] {
  return opening.kind === "secret" ? SECRET_DASH : [];
}

interface OverlayEntry {
  /** null when this client gets no button for the opening — a player
   *  looking at a window. */
  billboard: string | null;
  path: string;
  layer: string;
}

/** Everything about one opening that the overlay draws. */
interface Visual {
  opening: Opening;
  /** Indicator path, in the parent's local space. */
  commands: PathCommand[];
  /** Billboard position, in world space. */
  centre: Vector2;
  color: string;
  dash: number[];
  /** Does this client get a clickable button for it? */
  button: boolean;
}

export class OpeningOverlayActor extends Actor {
  private entries: Map<string, OverlayEntry> = new Map();
  private opening: OpeningReactor;
  private signature = "";

  constructor(reconciler: Reconciler, parent: Item) {
    super(reconciler);
    const opening = reconciler.find(OpeningReactor);
    if (!opening) {
      throw Error(
        "OpeningOverlayActor requires an OpeningReactor to be registered first",
      );
    }
    this.opening = opening;
    if (isDrawing(parent)) this.rebuild(parent);
  }

  delete(): void {
    const ids = [...this.entries.values()].flatMap((e) =>
      e.billboard ? [e.billboard, e.path] : [e.path],
    );
    if (ids.length > 0) this.reconciler.patcher.deleteItems(...ids);
    this.entries.clear();
    this.signature = "";
  }

  update(parent: Item): void {
    if (!isDrawing(parent)) return;
    this.rebuild(parent);
  }

  private rebuild(parent: Drawing) {
    const actor = this.opening.getActor(parent.id);
    const openings = actor?.openings ?? [];
    const polylines = actor?.polylines ?? [];
    const layer = isGM() ? "CONTROL" : "DRAWING";
    const signature = [
      actor?.signature ?? "",
      parent.position.x,
      parent.position.y,
      parent.rotation,
      parent.scale.x,
      parent.scale.y,
      (parent as any).style?.strokeWidth ?? 0,
      parent.lastModified,
      layer,
    ].join("|");
    if (signature === this.signature) return;
    this.signature = signature;

    const matrix = itemMatrix(parent);
    const strokeWidth = Math.max(
      MIN_STROKE,
      (parent as any).style?.strokeWidth ?? 0,
    );

    const gm = isGM();
    const visuals: Visual[] = [];
    for (const opening of openings) {
      // A secret door is invisible to players, full stop: no indicator
      // means nothing to click, nothing to hover, and nothing in the
      // local scene for a curious player to find in the DOM.
      if (!gm && !playerVisible(opening)) continue;
      const poly = polylines[opening.polyIndex];
      if (!poly) continue;
      const t1 = Math.min(opening.t1, opening.t2);
      const t2 = Math.max(opening.t1, opening.t2);
      const local = subPolyline(poly, t1, t2);
      const centreLocal = pointAtT(poly, (t1 + t2) / 2);
      if (local.length < 2 || !centreLocal) continue;
      visuals.push({
        opening,
        commands: polylineToCommands(local),
        centre: transformPoint(matrix, centreLocal),
        color: openingColor(opening),
        dash: openingDash(opening),
        // Players see a window's line but get no button for it: a
        // window is see-through shut or open, so the toggle would be a
        // control with no observable effect. See playerOperable.
        button: gm || playerOperable(opening),
      });
    }

    // Drop entries whose opening is gone (or whose layer changed, which
    // means the role flipped and the items must be recreated).
    const wanted = new Set(visuals.map((v) => v.opening.id));
    for (const [id, entry] of [...this.entries]) {
      if (!wanted.has(id) || entry.layer !== layer) {
        this.reconciler.patcher.deleteItems(
          ...[entry.billboard, entry.path].filter(
            (v): v is string => v !== null,
          ),
        );
        this.entries.delete(id);
      }
    }

    for (const visual of visuals) {
      const existing = this.entries.get(visual.opening.id);
      if (existing) {
        this.patch(parent, visual, existing, strokeWidth);
      } else {
        this.create(parent, visual, layer, strokeWidth);
      }
    }
  }

  private patch(
    parent: Drawing,
    visual: Visual,
    entry: OverlayEntry,
    strokeWidth: number,
  ) {
    this.reconciler.patcher.updateItems([
      entry.path,
      (item) => {
        item.position = parent.position;
        item.rotation = parent.rotation;
        item.scale = parent.scale;
        if (isPath(item)) {
          item.commands = visual.commands;
          item.style.strokeColor = visual.color;
          item.style.strokeWidth = strokeWidth;
          item.style.strokeDash = visual.dash;
        }
      },
    ]);
    if (!entry.billboard) return;
    this.reconciler.patcher.updateItems(
      [
        entry.billboard,
        (item) => {
          item.position = visual.centre;
          if (isBillboard(item)) {
            item.image = openingImage(
              visual.opening.kind,
              visual.opening.open,
            );
          }
        },
      ],
    );
  }

  private create(
    parent: Drawing,
    visual: Visual,
    layer: string,
    strokeWidth: number,
  ) {
    const path = buildPath()
      .commands(visual.commands)
      .fillOpacity(0)
      .strokeColor(visual.color)
      .strokeOpacity(1)
      .strokeWidth(strokeWidth)
      .strokeDash(visual.dash)
      .layer(layer as any)
      .attachedTo(parent.id)
      .position(parent.position)
      .rotation(parent.rotation)
      .scale(parent.scale)
      .disableAttachmentBehavior(["VISIBLE", "COPY"])
      .metadata({ [OVERLAY_OPENING_KEY]: visual.opening.id })
      .locked(true)
      // The button is the only thing you can click. On a thick fog
      // stroke the line is by far the bigger target and would otherwise
      // swallow every click meant for the button under it.
      .disableHit(true)
      .disableAutoZIndex(true)
      .zIndex(zBase(layer))
      .build();

    if (!visual.button) {
      this.entries.set(visual.opening.id, {
        billboard: null,
        path: path.id,
        layer,
      });
      this.reconciler.patcher.addItems(path);
      return;
    }

    const billboard = buildBillboard(
      openingImage(visual.opening.kind, visual.opening.open),
      { dpi: 300, offset: { x: 40, y: 40 } },
    )
      .attachedTo(parent.id)
      .position(visual.centre)
      .layer(layer as any)
      .disableAttachmentBehavior(["SCALE", "VISIBLE", "COPY"])
      .metadata({ [OVERLAY_OPENING_KEY]: visual.opening.id })
      .maxViewScale(2)
      .locked(true)
      .disableAutoZIndex(true)
      // One above the line it annotates, so a wide fog stroke cannot
      // bury its own button.
      .zIndex(zBase(layer) + 1)
      .build();

    this.entries.set(visual.opening.id, {
      billboard: billboard.id,
      path: path.id,
      layer,
    });
    this.reconciler.patcher.addItems(path, billboard);
  }
}

function polylineToCommands(points: Vector2[]): PathCommand[] {
  const out: PathCommand[] = [];
  if (points.length === 0) return out;
  out.push([Command.MOVE, points[0].x, points[0].y]);
  for (let i = 1; i < points.length; i++) {
    out.push([Command.LINE, points[i].x, points[i].y]);
  }
  return out;
}
