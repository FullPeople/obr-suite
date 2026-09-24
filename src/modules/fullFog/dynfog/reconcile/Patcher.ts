// Buffers local-scene mutations for one reconcile pass and flushes
// them as a single batched update. Port of upstream `Patcher`, with
// two hardening changes:
//
//   * the buffers are captured SYNCHRONOUSLY when `submitChanges()` is
//     called, so each reconcile pass owns a consistent batch;
//   * batches are applied in order via a promise chain, so a slow first
//     flush can't let a later pass's delete land before an earlier
//     pass's add of the same id.

import OBR, { type Item } from "@owlbear-rodeo/sdk";

interface Batch {
  generation: number;
  additions: Item[];
  deletions: string[];
  updates: Map<string, ((item: Item) => void)[]>;
  restrictions: Set<string>;
}

export class Patcher {
  private additions: Item[] = [];
  private deletions: string[] = [];
  private updates: Map<string, ((item: Item) => void)[]> = new Map();
  private ready = false;
  private queue: Promise<void> = Promise.resolve();
  private generation = 0;
  private restrictions = new Set<string>();
  private guards = new Map<string, (item: Item) => void>();

  setReady(ready: boolean) {
    this.invalidate();
    this.ready = ready;
  }

  /** A new scene/lifetime never inherits queued writes or actor permissions. */
  invalidate(): void {
    this.generation++;
    this.additions = []; this.deletions = []; this.updates = new Map();
    this.restrictions = new Set(); this.guards.clear();
  }

  /** Authorization is evaluated at submission, including for queued batches
   * built before a player/party change. Only light actors install guards. */
  protectItem(id: string, guard: (item: Item) => void): void { this.guards.set(id, guard); }
  restrictItems(...ids: string[]): void { for (const id of ids) this.restrictions.add(id); }

  addItems(...items: Item[]) {
    this.additions.push(...items);
  }

  deleteItems(...ids: string[]) {
    this.deletions.push(...ids);
  }

  updateItems(...updates: [string, (item: Item) => void][]) {
    for (const [id, updater] of updates) {
      const values = this.updates.get(id);
      if (values) values.push(updater);
      else this.updates.set(id, [updater]);
    }
  }

  /** Hand the staged changes to OBR. Safe to call every pass. */
  submitChanges(): Promise<void> {
    if (
      this.additions.length === 0 &&
      this.deletions.length === 0 &&
      this.updates.size === 0 && this.restrictions.size === 0
    ) {
      return this.queue;
    }
    const batch: Batch = {
      generation: this.generation,
      additions: this.additions,
      deletions: this.deletions,
      updates: this.updates,
      restrictions: this.restrictions,
    };
    this.additions = [];
    this.deletions = [];
    this.updates = new Map();
    this.restrictions = new Set();
    this.queue = this.queue.then(() => this.flush(batch));
    return this.queue;
  }

  /**
   * Adds, then updates, then deletes — "grow before shrink".
   *
   * Each of the three is a separate round trip to the local scene and
   * Owlbear renders between them, so the ORDER decides what a player
   * sees mid-flight. Deleting first was actively harmful: closing a
   * door deletes the second wall piece and then widens the first one
   * back to a full loop, and in the frame between those two calls the
   * whole of the second piece is simply missing. Vision floods through
   * it and the party gets a one-frame look at the room they were not
   * supposed to see yet.
   *
   * Adding first inverts that. At every intermediate state the set of
   * blocking walls is a SUPERSET of the final one, so the worst case is
   * one frame of over-blocking — invisible, because over-blocking just
   * leaves the fog where it already was.
   *
   * This does mean an id cannot be deleted and re-added inside a single
   * pass. Nothing does: every actor mints a fresh id (`buildWall()` and
   * friends generate their own), so a delete + add pair is always two
   * different items.
   */
  private async flush(batch: Batch) {
    const current = () => this.ready && batch.generation === this.generation;
    if (!current()) return;
    // Fold the after-hook's updates into brand-new items BEFORE addItems.
    // Otherwise an initially permitted PRIMARY can reveal hidden rooms during
    // the round trip between addItems and the authorization update.
    for (const item of batch.additions) {
      for (const update of batch.updates.get(item.id) ?? []) update(item);
      batch.updates.delete(item.id);
      batch.restrictions.delete(item.id);
      this.guards.get(item.id)?.(item);
    }
    // Revoke old LIGHT visibility before granting new vision. Wall changes
    // still use grow-before-shrink: no wall is deleted or shortened here.
    if (batch.restrictions.size > 0) {
      try {
        await OBR.scene.local.updateItems([...batch.restrictions], items => {
          if (!current()) return;
          for (const item of items) if (item.type === "LIGHT") item.visible = false;
        });
      } catch (e) {
        console.warn("[dynfog] light restriction failed", e);
        return;
      }
    }
    if (!current()) return;
    if (batch.additions.length > 0) {
      try {
        for (const item of batch.additions) this.guards.get(item.id)?.(item);
        await OBR.scene.local.addItems(batch.additions);
      } catch (e) {
        console.warn("[dynfog] local add failed", e);
      }
    }
    if (!current()) return;
    if (batch.updates.size > 0) {
      try {
        await OBR.scene.local.updateItems([...batch.updates.keys()], (items) => {
          if (!current()) return;
          for (const item of items) {
            const fns = batch.updates.get(item.id);
            if (!fns) continue;
            for (const fn of fns) fn(item);
            this.guards.get(item.id)?.(item);
          }
        });
      } catch (e) {
        console.warn("[dynfog] local update failed", e);
      }
    }
    if (!current()) return;
    if (batch.deletions.length > 0) {
      try {
        await OBR.scene.local.deleteItems(batch.deletions);
        if (current()) for (const id of batch.deletions) this.guards.delete(id);
      } catch (e) {
        console.warn("[dynfog] local delete failed", e);
      }
    }
  }
}
