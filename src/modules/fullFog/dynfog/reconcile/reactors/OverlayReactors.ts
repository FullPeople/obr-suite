// Reactors for the two indicator layers. Registered / unregistered as
// the fog tool comes and goes (GM) or as the player-openings setting
// flips (players) — see `dynfog/overlay.ts`.

import type { Item } from "@owlbear-rodeo/sdk";
import { Reactor } from "../Reactor";
import type { Reconciler } from "../Reconciler";
import { OpeningOverlayActor } from "../actors/OpeningOverlayActor";
import { LightOverlayActor } from "../actors/LightOverlayActor";
import { OpeningReactor } from "./OpeningReactor";
import { isFogDrawing } from "../../geom/drawing";
import { LIGHT_KEY } from "../../ids";

export class OpeningOverlayReactor extends Reactor {
  private opening: OpeningReactor;

  constructor(reconciler: Reconciler) {
    super(reconciler, OpeningOverlayActor);
    const opening = reconciler.find(OpeningReactor);
    if (!opening) {
      throw Error(
        "OpeningOverlayReactor requires an OpeningReactor to be registered first",
      );
    }
    this.opening = opening;
  }

  filter(item: Item): boolean {
    return isFogDrawing(item);
  }

  diff(a: Item, b: Item): boolean {
    return super.diff(a, b) || this.opening.getDidUpdate();
  }
}

export class LightOverlayReactor extends Reactor {
  constructor(reconciler: Reconciler) {
    super(reconciler, LightOverlayActor);
  }

  filter(item: Item): boolean {
    return LIGHT_KEY in item.metadata;
  }
}
