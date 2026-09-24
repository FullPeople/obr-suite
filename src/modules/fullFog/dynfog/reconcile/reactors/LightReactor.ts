// Ports of upstream `LightReactor` + `SelfLightReactor`.

import type { Item } from "@owlbear-rodeo/sdk";
import { Reactor } from "../Reactor";
import type { Reconciler } from "../Reconciler";
import { LightActor } from "../actors/LightActor";
import { SelfLightActor } from "../actors/SelfLightActor";
import { LIGHT_KEY } from "../../ids";
import { normaliseLightConfig } from "../../light/config";

export class LightReactor extends Reactor {
  constructor(reconciler: Reconciler) {
    super(reconciler, LightActor);
  }

  filter(item: Item): boolean {
    return LIGHT_KEY in item.metadata;
  }

  /** Every live light, for the occlusion pass. */
  getActors(): LightActor[] {
    const out: LightActor[] = [];
    for (const actor of this.actors.values()) {
      if (actor instanceof LightActor) out.push(actor);
    }
    return out;
  }
}

export class SelfLightReactor extends Reactor {
  constructor(reconciler: Reconciler) {
    super(reconciler, SelfLightActor);
  }

  filter(item: Item): boolean {
    if (!(LIGHT_KEY in item.metadata)) return false;
    const config = normaliseLightConfig(
      (item.metadata as Record<string, unknown>)[LIGHT_KEY],
    );
    if (!config) return false;
    // Only cone-shaped PRIMARY lights need a self light.
    return (
      config.outerAngle !== undefined &&
      config.outerAngle !== 360 &&
      (config.lightType === "PRIMARY" || config.lightType === undefined)
    );
  }

  getActors(): SelfLightActor[] {
    const out: SelfLightActor[] = [];
    for (const actor of this.actors.values()) {
      if (actor instanceof SelfLightActor) out.push(actor);
    }
    return out;
  }
}
