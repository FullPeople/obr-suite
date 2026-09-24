import OBR from "@owlbear-rodeo/sdk";
import { openTable, setupThreeDragonAnte, teardownThreeDragonAnte } from "./game";
import { TABLE_ACTIVATE } from "./activation";
import { getLocalLang } from "./locale";

let alive = true, runtimeReady = false;
let starting: Promise<void> | undefined, opening: Promise<void> | undefined;
let cancellation = 0, actionRevision = 0;
let pending: number | undefined, current: number | undefined;
const unsubs: Array<() => void> = [];
const log = (error: unknown) => console.warn("[three-dragon] activation failed", error);

/** Install activation independently of the dealer's first SDK reads. A failed
 * setup may already own listeners, so clear it before a user-requested retry. */
function ensureRuntime(): Promise<void> {
  if (runtimeReady) return Promise.resolve();
  if (starting) return starting;
  starting = (async () => {
    try {
      await setupThreeDragonAnte();
      if (!alive) { await teardownThreeDragonAnte(); return; }
      runtimeReady = true;
    } catch (error) {
      runtimeReady = false;
      await teardownThreeDragonAnte();
      throw error;
    }
  })().finally(() => { starting = undefined; });
  return starting;
}
function requestOpen(ticket = cancellation): void {
  if (!alive || ticket !== cancellation || pending === ticket || current === ticket) return;
  pending = ticket;
  drain();
}
function drain(): void {
  if (opening) return;
  opening = (async () => {
    while (alive && pending !== undefined) {
      const ticket = pending; pending = undefined; current = ticket;
      const wanted = () => alive && ticket === cancellation;
      try {
        await ensureRuntime();
        if (!wanted()) continue;
        await openTable();
        if (wanted()) await OBR.action.close();
      } catch (error) {
        log(error);
        if (wanted()) void OBR.notification.show(getLocalLang() === "en"
          ? "Could not open the card table. Select its action or Open table to retry."
          : "牌桌暂时无法打开，请再次点击原生入口或“打开牌桌”重试。", "ERROR").catch(log);
      } finally { current = undefined; }
    }
  })().finally(() => { opening = undefined; if (alive && pending !== undefined) drain(); });
}

OBR.onReady(() => {
  if (!alive) return;
  unsubs.push(OBR.action.onOpenChange(value => {
    actionRevision++;
    if (value) requestOpen();
    else { cancellation++; pending = undefined; }
  }), OBR.broadcast.onMessage(TABLE_ACTIVATE, event => {
    const ticket = cancellation;
    // The retry listener exists even if setup's getId/getMetadata failed. Check
    // the actual local connection without trusting a caller-supplied identity.
    void OBR.player.getConnectionId().then(connection => {
      if (alive && ticket === cancellation && event.connectionId === connection) requestOpen(ticket);
    }).catch(log);
  }));
  const revision = actionRevision;
  void OBR.action.isOpen().then(value => {
    if (alive && revision === actionRevision && value) requestOpen();
  }).catch(log);
  // Host recovery stays idle/invisible. No retry timer: the next explicit
  // action or launcher click retries a failed bootstrap.
  void ensureRuntime().catch(log);
});
window.addEventListener("pagehide", () => {
  alive = false; runtimeReady = false; cancellation++; pending = undefined;
  for (const off of unsubs.splice(0)) off();
  // The existing shell handles a modal open which settles after teardown.
  void teardownThreeDragonAnte().catch(log);
}, { once: true });
