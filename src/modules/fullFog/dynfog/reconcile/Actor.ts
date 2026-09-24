// One Actor is bound to one item in the SHARED scene and owns whatever
// derived state that item needs — cached geometry, local child items,
// or both. Port of upstream `Actor`.

import type { Item } from "@owlbear-rodeo/sdk";
import type { Reconciler } from "./Reconciler";

export abstract class Actor {
  protected reconciler: Reconciler;

  constructor(reconciler: Reconciler) {
    this.reconciler = reconciler;
  }

  abstract delete(): void;
  abstract update(parent: Item): void;
}
