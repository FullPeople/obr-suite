// A Reactor declares which shared items it cares about and maps each
// to an Actor. Port of upstream `Reactor`.

import type { Item } from "@owlbear-rodeo/sdk";
import type { Actor } from "./Actor";
import type { Reconciler } from "./Reconciler";

export abstract class Reactor {
  protected reconciler: Reconciler;
  /** parent item id → its actor. */
  protected actors: Map<string, Actor> = new Map();
  private ActorClass: new (reconciler: Reconciler, parent: Item) => Actor;

  constructor(
    reconciler: Reconciler,
    ActorClass: new (reconciler: Reconciler, parent: Item) => Actor,
  ) {
    this.reconciler = reconciler;
    this.ActorClass = ActorClass;
  }

  /** True when this reactor should own an actor for `item`. */
  abstract filter(item: Item): boolean;

  delete(): void {
    for (const actor of this.actors.values()) actor.delete();
    this.actors.clear();
  }

  process(added: Item[], deleted: Item[], updated: Item[]): void {
    for (const parent of added) {
      const actor = new this.ActorClass(this.reconciler, parent);
      this.actors.set(parent.id, actor);
    }
    for (const parent of deleted) {
      const actor = this.actors.get(parent.id);
      if (actor) {
        actor.delete();
        this.actors.delete(parent.id);
      }
    }
    for (const parent of updated) {
      const actor = this.actors.get(parent.id);
      if (actor) actor.update(parent);
    }
  }

  /** Whether an incoming item counts as changed. Default: OBR's own
   *  `lastModified` stamp. */
  diff(a: Item, b: Item): boolean {
    try {
      return new Date(a.lastModified).valueOf() !== new Date(b.lastModified).valueOf();
    } catch {
      return false;
    }
  }

  has(id: string): boolean {
    return this.actors.has(id);
  }
}
