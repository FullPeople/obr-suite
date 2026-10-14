type Token = {id: string; metadata: Record<string, any>};
type Receipt = {signature: string; cardId?: string; revision?: number; confirmed: boolean};

/** Compare the values consumed by the local renderer, never a whole scene. */
export function bubbleValueSignature(item: Token): string {
  const value = item.metadata['com.obr-suite/bubbles/data']
    ?? item.metadata['com.owlbear-rodeo-bubbles-extension/metadata'] ?? {};
  return JSON.stringify(['health', 'max health', 'temporary health', 'armor class']
    .map(key => value[key] ?? null));
}

/** In-process receipts after the renderer's local SDK writes complete.
 * This is not a remote-player acknowledgement or a GPU/pixel receipt. */
export class BubblePresentation {
  private active = false;
  private generation = 0;
  private values = new Map<string, Receipt>();
  private listeners = new Set<() => void>();
  private refresh?: (items: Token[]) => void;

  setRefresh(handler?: (items: Token[]) => void) { this.refresh = handler; }
  request(items: Token[]) { if (this.active) this.refresh?.(items); }

  start() { this.active = true; this.invalidate(); }
  stop() { this.active = false; this.invalidate(); }
  invalidate() { this.generation++; this.values.clear(); this.notify(); }
  onChange(listener: () => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  private notify() { for (const listener of this.listeners) listener(); }
  pending(items: Token[]) {
    return this.active && items.some(item => {
      const receipt = this.values.get(item.id), baseline = item.metadata['com.obr-suite/workbench/runtime-baseline'];
      if (receipt?.signature === bubbleValueSignature(item)) return false;
      return !(receipt?.confirmed && baseline?.version === 1 && receipt.cardId === baseline.cardId
        && Number.isSafeInteger(baseline.revision) && receipt.revision! > baseline.revision);
    });
  }
  commit(items: Token[]) {
    if (!this.active) return;
    const next = new Map<string, Receipt>(items.map(item => {
      const signature = bubbleValueSignature(item), baseline = item.metadata['com.obr-suite/workbench/runtime-baseline'];
      const confirmed = baseline?.version === 1 && Number.isSafeInteger(baseline.revision)
        && !!baseline.value?.stats && signature === bubbleValueSignature({id: item.id,
          metadata: {'com.obr-suite/bubbles/data': baseline.value.stats}});
      return [item.id, {signature, confirmed, cardId: baseline?.cardId, revision: baseline?.revision}];
    }));
    const changed = next.size !== this.values.size
      || [...next].some(([id, value]) => {
        const old = this.values.get(id);
        return !old || old.signature !== value.signature || old.cardId !== value.cardId
          || old.revision !== value.revision || old.confirmed !== value.confirmed;
      });
    this.values = next;
    if (changed) this.notify();
  }
  waitFor(items: Token[], timeoutMs = 2000): Promise<void> {
    if (!this.pending(items)) return Promise.resolve();
    const generation = this.generation;
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout>;
      const finish = (error?: Error) => {
        clearTimeout(timer); unsubscribe();
        error ? reject(error) : resolve();
      };
      const check = () => {
        if (!this.active) finish();
        else if (generation !== this.generation) finish(Error('场景或血条会话已改变，显示结果待核对'));
        else if (!this.pending(items)) finish();
      };
      const unsubscribe = this.onChange(check);
      timer = setTimeout(() => finish(Error('资料已保存，血条显示更新尚未确认')), timeoutMs);
      check();
    });
  }
}

export const bubblePresentation = new BubblePresentation();
