// Undo/redo history — snapshots of the mask buffer.
//
// We capture before each destructive operation. Capped so memory
// stays bounded; large maps + 12 snapshots = ~30 MB worst case.

const CAP = 16;

export class History {
  private undoStack: Uint8Array[] = [];
  private redoStack: Uint8Array[] = [];

  push(snapshot: Uint8Array): void {
    this.undoStack.push(new Uint8Array(snapshot));
    if (this.undoStack.length > CAP) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  /** Pop a snapshot to apply on top of `current`. Returns the prior
   *  state (caller writes back into mask). */
  undo(current: Uint8Array): Uint8Array | null {
    if (this.undoStack.length === 0) return null;
    this.redoStack.push(new Uint8Array(current));
    if (this.redoStack.length > CAP) this.redoStack.shift();
    return this.undoStack.pop()!;
  }

  redo(current: Uint8Array): Uint8Array | null {
    if (this.redoStack.length === 0) return null;
    this.undoStack.push(new Uint8Array(current));
    if (this.undoStack.length > CAP) this.undoStack.shift();
    return this.redoStack.pop()!;
  }

  canUndo(): boolean { return this.undoStack.length > 0; }
  canRedo(): boolean { return this.redoStack.length > 0; }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }
}
