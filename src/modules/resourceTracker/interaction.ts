import OBR, { type Item } from "@owlbear-rodeo/sdk";

/** UI lifetime and optional mutation guard. Read leases never acquire write
 * access; the host supplies its per-item policy for editable leases. */
export function createInteractionGuard(getItemId: () => string | null, connected: () => boolean, onInvalidate: () => void = () => {}, canWrite: (item?: Item) => boolean = () => true) {
  let active = true, revision = 0, roleRevision = 0, sceneRevision = 0, ready = false;
  let role: "GM" | "PLAYER" | null = null;
  const unsubs: Array<() => void> = [];
  const invalidate = () => { revision++; onInvalidate(); };
  unsubs.push(OBR.player.onChange((player) => {
    const next = player.role === "GM" ? "GM" : "PLAYER";
    if (next === role) return;
    roleRevision++; role = next; invalidate();
  }));
  unsubs.push(OBR.scene.onReadyChange((value) => { sceneRevision++; ready = value; invalidate(); }));
  const initialRole = roleRevision;
  void OBR.player.getRole().then((value) => {
    if (!active || initialRole !== roleRevision) return;
    role = value === "GM" ? "GM" : "PLAYER"; onInvalidate();
  }).catch(() => {});
  const initialScene = sceneRevision;
  void OBR.scene.isReady().then((value) => {
    if (!active || initialScene !== sceneRevision) return;
    if (ready !== value) { ready = value; invalidate(); }
  }).catch(() => {});
  function capture(requireGM = false, writing = true) {
    const id = getItemId(), own = revision;
    const current = (item?: Item) => active && connected() && ready && role !== null &&
      revision === own && !!id && getItemId() === id && (!item || item.id === id) && (!requireGM || role === "GM") && (!writing || canWrite(item));
    return id && current() ? { id, current } : null;
  }
  function dispose() {
    if (!active) return;
    active = false; revision++;
    for (const unsub of unsubs.splice(0)) unsub();
    window.removeEventListener("pagehide", dispose);
  }
  window.addEventListener("pagehide", dispose);
  return { capture, dispose, isGM: () => role === "GM", alive: () => active && connected(), invalidate };
}
