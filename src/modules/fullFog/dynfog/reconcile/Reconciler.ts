// Diffs the shared scene and fans the diff out to registered Reactors.
// Port of upstream `Reconciler`, minus the CanvasKit handle.
//
// One-way binding only: reactors create LOCAL children for SHARED
// parents and never read local state back. Local children must be
// unselectable (or handled explicitly, as the opening overlay does)
// and must disable COPY attachment behaviour — anything that mutates
// them from outside this file puts the mapping out of sync.

import OBR, { type Item } from "@owlbear-rodeo/sdk";
import { Patcher } from "./Patcher";
import type { Reactor } from "./Reactor";

export class Reconciler {
  private reactors: Reactor[] = [];
  private prevItems: Map<string, Item> = new Map();
  /** The snapshot being processed right now. Actors use it to look up
   *  a sibling item (e.g. a fog Path's parent map, for its grid dpi)
   *  without an async round-trip. */
  private currentItems: Map<string, Item> = new Map();
  private subscriptions: VoidFunction[] = [];
  /** Run after every reactor has processed a pass but BEFORE the
   *  patcher flushes, so a hook can still stage local-scene changes in
   *  the same batch. Used by `light/occlusion.ts`, which needs the
   *  wall + light actors to be up to date before it can decide which
   *  lights this client may see. */
  private afterHooks: Array<() => void> = [];
  private ready = false;
  private disposed = false;
  private generation = 0;
  private readRevision = 0;

  patcher: Patcher = new Patcher();

  constructor() {
    const generation = this.generation;
    OBR.scene.isReady().then(ready => {
      if (!this.disposed && generation === this.generation) this.handleSceneReady(ready);
    }).catch(() => {});
    this.subscriptions.push(
      OBR.scene.items.onChange(items => {
        if (!this.ready || this.disposed) return;
        this.readRevision++;
        this.reconcile(items);
      }),
      OBR.scene.onReadyChange(this.handleSceneReady),
    );
  }

  /** @returns an unsubscribe function. */
  onAfterReconcile(hook: () => void): () => void {
    this.afterHooks.push(hook);
    return () => {
      const index = this.afterHooks.indexOf(hook);
      if (index >= 0) this.afterHooks.splice(index, 1);
    };
  }

  async delete(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.generation++;
    this.readRevision++;
    this.patcher.invalidate();
    for (const unsubscribe of this.subscriptions) {
      try {
        unsubscribe();
      } catch {}
    }
    this.subscriptions = [];
    this.afterHooks = [];
    for (const reactor of this.reactors) reactor.delete();
    this.reactors = [];
    this.prevItems.clear();
    this.currentItems.clear();
    await this.patcher.submitChanges();
    this.patcher.setReady(false);
  }

  private handleSceneReady = (ready: boolean) => {
    if (this.disposed) return;
    // Repeated ready notifications belong to the same local scene. Throwing
    // away its actor ids here would orphan still-visible local children.
    if (ready && this.ready) return;
    this.generation++;
    this.readRevision++;
    this.ready = ready;
    for (const reactor of this.reactors) reactor.delete();
    this.prevItems.clear();
    this.currentItems.clear();
    this.patcher.setReady(ready);
    if (ready) {
      this.readItems(false);
    }
  };

  private reconcile = (items: Item[]) => {
    if (!this.ready || this.disposed) return;
    this.currentItems.clear();
    for (const item of items) this.currentItems.set(item.id, item);

    for (const reactor of this.reactors) {
      this.processReactor(reactor, items);
    }
    this.runAfterHooks();
    void this.patcher.submitChanges();

    this.prevItems.clear();
    for (const item of items) this.prevItems.set(item.id, item);
  };

  private runAfterHooks(): void {
    for (const hook of this.afterHooks) {
      try {
        hook();
      } catch (e) {
        console.warn("[dynfog] after-reconcile hook failed", e);
      }
    }
  }

  /** Ownership and sharing changes need only new access verdicts, not a
   * destroy/recreate of every wall and light or another scene snapshot. */
  refreshAccess(): void {
    if (!this.ready || this.disposed) return;
    this.runAfterHooks();
    void this.patcher.submitChanges();
  }

  /** Look up any item in the snapshot currently being reconciled. */
  getItem(id: string | undefined): Item | null {
    if (!id) return null;
    // Missing in the current snapshot means removed, not an invitation to
    // reuse the previous owner's/ancestor's permission for one more pass.
    return this.currentItems.get(id) ?? null;
  }

  /** Force a full re-run against the current shared scene. Used when
   *  something outside the item stream changes what reactors should
   *  produce (role change, player-doors setting, grid dpi). */
  refresh() {
    this.readItems(true);
  }

  private readItems(rebuild: boolean): void {
    if (!this.ready || this.disposed) return;
    const generation = this.generation;
    const revision = ++this.readRevision;
    OBR.scene.items
      .getItems()
      .then((items) => {
        if (this.disposed || !this.ready || generation !== this.generation || revision !== this.readRevision) return;
        if (rebuild) {
          this.prevItems.clear();
          for (const reactor of this.reactors) reactor.delete();
        }
        this.reconcile(items);
      })
      .catch(() => {});
  }

  register(...reactors: Reactor[]) {
    if (this.disposed) return;
    this.reactors.push(...reactors);
    for (const reactor of reactors) {
      const added: Item[] = [];
      for (const item of this.prevItems.values()) {
        if (reactor.filter(item)) added.push(item);
      }
      reactor.process(added, [], []);
    }
    this.refreshAccess();
  }

  unregister(...reactors: Reactor[]) {
    for (const reactor of reactors) {
      const index = this.reactors.indexOf(reactor);
      if (index >= 0) {
        this.reactors.splice(index, 1);
        reactor.delete();
      }
    }
    void this.patcher.submitChanges();
  }

  find<R extends Reactor>(ReactorClass: new (...args: any[]) => R): R | null {
    return (this.reactors.find((r) => r instanceof ReactorClass) as R) ?? null;
  }

  private processReactor(reactor: Reactor, items: Item[]) {
    const added: Item[] = [];
    const deleted: Item[] = [];
    const updated: Item[] = [];

    // Start from every previously seen id and strike off the ones that
    // still match. An item that survives but stops matching (moved off
    // the FOG layer, light metadata removed) therefore lands in
    // `deleted` and gets its children cleaned up.
    const deletedIds = new Set<string>(this.prevItems.keys());
    for (const item of items) {
      if (reactor.filter(item)) {
        const prev = this.prevItems.get(item.id);
        if (prev && reactor.has(item.id)) {
          if (reactor.diff(prev, item)) updated.push(item);
        } else {
          added.push(item);
        }
        deletedIds.delete(item.id);
      }
    }

    for (const id of deletedIds) {
      const prev = this.prevItems.get(id);
      if (prev && reactor.filter(prev)) deleted.push(prev);
    }

    reactor.process(added, deleted, updated);
  }
}
