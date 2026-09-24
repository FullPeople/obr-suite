// Port of upstream `WallReactor`.

import type { Item, Vector2 } from "@owlbear-rodeo/sdk";
import { Reactor } from "../Reactor";
import type { Reconciler } from "../Reconciler";
import { WallActor } from "../actors/WallActor";
import { OpeningReactor } from "./OpeningReactor";
import { isFogDrawing } from "../../geom/drawing";

export class WallReactor extends Reactor {
  private opening: OpeningReactor;

  constructor(reconciler: Reconciler) {
    super(reconciler, WallActor);
    const opening = reconciler.find(OpeningReactor);
    if (!opening) {
      throw Error("WallReactor requires an OpeningReactor to be registered first");
    }
    this.opening = opening;
  }

  filter(item: Item): boolean {
    return isFogDrawing(item);
  }

  /** Every wall polyline in the scene, in WORLD space — the input to
   *  `light/occlusion.ts`'s line-of-sight index. */
  worldPolylines(): Vector2[][] {
    const out: Vector2[][] = [];
    for (const actor of this.actors.values()) {
      if (actor instanceof WallActor) out.push(...actor.worldPolylines());
    }
    return out;
  }

  /** Changes whenever any actor's emitted geometry changes, so the
   *  occlusion index knows when it has to be rebuilt. */
  geometrySignature(): string {
    const parts: string[] = [];
    for (const [id, actor] of this.actors) {
      if (actor instanceof WallActor) {
        parts.push(`${id}=${actor.geometrySignature}`);
      }
    }
    parts.sort();
    return parts.join("&");
  }

  diff(a: Item, b: Item): boolean {
    // Re-evaluate every wall whenever ANY opening changed: a door on one
    // fog shape can cut a wall belonging to another. WallActor's own
    // signature check makes the no-op case cheap.
    return super.diff(a, b) || this.opening.getDidUpdate();
  }
}
