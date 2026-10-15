/** Conflicting entities keep their order; room-wide writes form a barrier.
 * Receipts and permission checks remain inside the queued operation. */
export function operationLanes() {
  const lanes = new Map<string, Promise<void>>();
  let barrier = Promise.resolve();
  return {
    run<T>(keys: readonly string[] | null, operation: () => Promise<T>): Promise<T> {
      const targets = keys && [...new Set(keys)].sort();
      const dependencies = targets?.length
        ? [barrier, ...targets.map(key => lanes.get(key) ?? Promise.resolve())]
        : [barrier, ...lanes.values()];
      const result = Promise.all(dependencies).then(operation);
      const settled = result.then(() => {}, () => {});
      if (targets?.length) {
        for (const key of targets) lanes.set(key, settled);
        void settled.then(() => {
          for (const key of targets) if (lanes.get(key) === settled) lanes.delete(key);
        });
      } else {
        barrier = settled;
        lanes.clear();
      }
      return result;
    },
  };
}
