// Reuse only the host/read/broadcast boundary. All editable components are real.
import sdk from "../cc-info-dom-sdk";
import { enablePatches, produceWithPatches } from "immer";
enablePatches();
const m = (window as any).ccMock;
const copy = <T>(value: T): T => structuredClone(value);
sdk.scene.items.updateItems = async (ids: string[], update: (items: any[]) => void) => {
  const write = () => {
    const current = ids.map(id => m.items[id]).filter(Boolean).map(copy);
    const [next, patches] = produceWithPatches(current, update);
    m.writeCallbacks++;
    if (!patches.length) return;
    for (const draft of next) m.items[draft.id] = copy(draft);
    m.writes.push({ ids: copy(ids), patches: copy(patches), drafts: copy(next) });
    m.emit("items", Object.values(m.items).map(copy));
  };
  if (m.holdUpdates) await new Promise<void>(resolve => m.heldUpdates.push(() => { write(); resolve(); }));
  else write();
};
export default sdk;
