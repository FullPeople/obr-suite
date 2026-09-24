// Owns one OpeningActor per FOG-layer Drawing and exposes the merged
// view the wall + overlay reactors consume. Port of upstream
// `DoorReactor`.

import type { Item } from "@owlbear-rodeo/sdk";
import { Reactor } from "../Reactor";
import type { Reconciler } from "../Reconciler";
import { OpeningActor } from "../actors/OpeningActor";
import { isFogDrawing } from "../../geom/drawing";
import type { Cut } from "../../geom/cut";

export class OpeningReactor extends Reactor {
  /** Cuts contributed by every drawing, refreshed after each pass. */
  private cuts: Cut[] = [];
  /** Joined signature of every drawing's openings — walls rebuild when
   *  this moves, which is how a door toggle propagates to overlapping
   *  shapes owned by other actors. */
  private allSignature = "";
  private didUpdate = false;

  constructor(reconciler: Reconciler) {
    super(reconciler, OpeningActor);
  }

  filter(item: Item): boolean {
    return isFogDrawing(item);
  }

  process(added: Item[], deleted: Item[], updated: Item[]): void {
    super.process(added, deleted, updated);
    this.cuts = [];
    const parts: string[] = [];
    for (const actor of this.actors.values()) {
      if (actor instanceof OpeningActor) {
        this.cuts.push(...actor.cuts);
        if (actor.signature) parts.push(`${actor.parentId}=${actor.signature}`);
      }
    }
    parts.sort();
    this.allSignature = parts.join("&");
    this.didUpdate =
      added.length > 0 || deleted.length > 0 || updated.length > 0;
  }

  /** Every drawing's cached geometry, for the door / toggle tools. */
  getAllActors(): OpeningActor[] {
    const out: OpeningActor[] = [];
    for (const actor of this.actors.values()) {
      if (actor instanceof OpeningActor) out.push(actor);
    }
    return out;
  }

  getActor(parentId: string): OpeningActor | null {
    const actor = this.actors.get(parentId);
    return actor instanceof OpeningActor ? actor : null;
  }

  /** Every cut in the scene EXCEPT the ones owned by `parentId` —
   *  a drawing subtracts its own openings exactly, in the t-domain. */
  getForeignCuts(parentId: string): Cut[] {
    return this.cuts.filter((c) => c.parentId !== parentId);
  }

  getAllSignature(): string {
    return this.allSignature;
  }

  getDidUpdate(): boolean {
    return this.didUpdate;
  }
}
