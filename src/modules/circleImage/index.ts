// Circle-image native entry. Same-ID label updates leave the user's active
// canvas tool and the editor's in-progress image alone.
import OBR, { type Tool } from "@owlbear-rodeo/sdk";
import { assetUrl } from "../../asset-base";
import { getLocalLang, onLangChange } from "../../state";
import { PLUGIN_ID, POPOVER_ID } from "./types";
import { WINDOW_QUERY, WINDOW_CLOSE, WINDOW_CLOSE_RESULT, readWindowMessage } from "./window-protocol";

const TOOL_ID = `${PLUGIN_ID}/tool`;
const ICON_URL = assetUrl("circleimage-icon.svg");
const POPOVER_URL = assetUrl("circleimage.html");
const entryLabel = () => getLocalLang() === "en" ? "Circle crop / Remove background" : "圆形图片 / 去底";

type Session = {
  alive: boolean;
  role?: "GM" | "PLAYER";
  roleRevision: number;
  connectionId?: string;
  entryReady: boolean;
  windowNonce?: string;
  tool: Tool;
  nativeTouched: boolean;
  registered: boolean;
  label?: string;
  wantsPopover: boolean;
  popoverTouched: boolean;
  popoverOpen: boolean;
  unsubs: Array<() => void>;
  startup?: Promise<void>;
};
let session: Session | undefined;
let entryQueue = Promise.resolve();
let popoverQueue = Promise.resolve();
const retired = new Set<Session>();
let cleanupRun: Promise<void> | undefined;
const isCurrent = (own: Session) => own.alive && session === own;

// Keep the SDK's callback registry and native IDs in the same order, including
// an old create/remove completing after teardown and immediate re-enabling.
function queueEntry(work: () => Promise<void>, propagateError = false): Promise<void> {
  const operation = entryQueue.then(work);
  entryQueue = operation.catch(error => console.warn("[circleImage] native entry failed", error));
  return propagateError ? operation : entryQueue;
}
function queuePopover(work: () => Promise<void>, propagateError = false): Promise<void> {
  const operation = popoverQueue.then(work);
  popoverQueue = operation.catch(error => console.warn("[circleImage] editor window failed", error));
  return propagateError ? operation : popoverQueue;
}

async function refreshEntry(own: Session): Promise<void> {
  if (!isCurrent(own) || !own.entryReady || own.role !== "GM" || !own.connectionId) return;
  const label = entryLabel();
  if (own.registered && own.label === label) return;
  // A failed SDK reply can still follow a host-side registration. Teardown
  // must attempt removal even when create did not acknowledge success.
  own.nativeTouched = true;
  // The host may apply this label even if its reply is lost.
  own.label = undefined;
  await OBR.tool.create({ ...own.tool, icons: [{ icon: ICON_URL, label, filter: { roles: ["GM"] } }] });
  own.registered = true;
  own.label = label;
}

async function closeOwnedPopover(own: Session): Promise<void> {
  if (!own.popoverTouched) return;
  try {
    await OBR.popover.close(POPOVER_ID);
    own.popoverOpen = false;
    own.popoverTouched = false;
    own.windowNonce = undefined;
  } catch (error) {
    // A rejected close must not make the next click reopen and reset a live
    // editor. Restore the open intent so that click retries closing it.
    if (isCurrent(own) && own.role === "GM") own.wantsPopover = own.popoverOpen;
    throw error;
  }
}

async function syncPopover(own: Session): Promise<void> {
  const shouldOpen = () => isCurrent(own) && own.role === "GM" && own.wantsPopover;
  if (!shouldOpen()) { await closeOwnedPopover(own); return; }
  if (own.popoverOpen) return;
  const width = await OBR.viewport.getWidth();
  if (!shouldOpen()) return;
  own.windowNonce = crypto.randomUUID();
  const url = new URL(POPOVER_URL);
  url.searchParams.set(WINDOW_QUERY, own.windowNonce);
  own.popoverTouched = true;
  try {
    await OBR.popover.open({
      id: POPOVER_ID, url: url.href, width: 420, height: 600,
      anchorReference: "POSITION",
      anchorPosition: { left: Math.round(width / 2), top: 60 },
      anchorOrigin: { horizontal: "CENTER", vertical: "TOP" },
      transformOrigin: { horizontal: "CENTER", vertical: "TOP" },
      hidePaper: true, disableClickAway: true,
    });
    own.popoverOpen = true;
  } catch (error) {
    own.wantsPopover = false;
    await closeOwnedPopover(own);
    throw error;
  }
  // SDK opens cannot be canceled once dispatched. Drain/close this session's
  // late open before the next session can open the same popover ID.
  if (!shouldOpen()) await closeOwnedPopover(own);
}

export async function setupCircleImage(): Promise<void> {
  if (session) return session.startup;
  const own: Session = {
    alive: true, entryReady: false, roleRevision: 0, nativeTouched: false, registered: false,
    wantsPopover: false, popoverTouched: false, popoverOpen: false, unsubs: [],
    tool: { id: TOOL_ID, icons: [] },
  };
  session = own;
  own.tool.onClick = async () => {
    if (!isCurrent(own) || own.role !== "GM") return false;
    own.wantsPopover = !own.wantsPopover;
    await queuePopover(() => syncPopover(own));
    return false; // Preserve the current canvas tool; this icon opens an editor.
  };
  own.unsubs.push(onLangChange(() => { if (isCurrent(own)) void queueEntry(() => refreshEntry(own)); }));
  own.unsubs.push(OBR.player.onChange(player => {
    if (!isCurrent(own)) return;
    ++own.roleRevision;
    own.role = player.role;
    if (own.role !== "GM") {
      own.wantsPopover = false;
      void queuePopover(() => syncPopover(own));
    }
    // The existing native GM filter hides a registered entry from players;
    // promotion also handles a module first enabled while this client was a player.
    void queueEntry(() => refreshEntry(own));
  }));
  own.unsubs.push(OBR.broadcast.onMessage(WINDOW_CLOSE, event => {
    const request = readWindowMessage(event.data);
    if (!isCurrent(own) || own.role !== "GM" || !own.connectionId || event.connectionId !== own.connectionId
      || !request
      || request.windowNonce !== own.windowNonce) return;
    // Close in the background: the page may be destroyed before an SDK close
    // acknowledgement, so it cannot reliably notify us after closing itself.
    own.wantsPopover = false;
    void queuePopover(async () => {
      if (!isCurrent(own) || request.windowNonce !== own.windowNonce) return;
      try { await closeOwnedPopover(own); }
      catch {
        if (isCurrent(own) && request.windowNonce === own.windowNonce) {
          await OBR.broadcast.sendMessage(WINDOW_CLOSE_RESULT, { windowNonce: request.windowNonce, requestId: request.requestId, status: "error" }, { destination: "LOCAL" });
        }
      }
    });
  }));
  own.startup = (async () => {
    // A failed earlier removal still owns these native/window IDs. The existing
    // lifecycle manager retries cleanup before setup; immediate callers do too.
    await cleanupRetired();
    if (!isCurrent(own)) return;
    const revision = own.roleRevision;
    const results = await Promise.allSettled([OBR.player.getRole(), OBR.player.getConnectionId()]);
    if (!isCurrent(own)) return;
    const [role, connection] = results;
    if (connection.status === "rejected") throw connection.reason;
    if (role.status === "rejected" && revision === own.roleRevision) throw role.reason;
    own.connectionId = connection.value;
    if (!own.connectionId) throw new Error("[circleImage] missing local connection ID");
    if (revision === own.roleRevision && role.status === "fulfilled") own.role = role.value;
    own.entryReady = true;
    await queueEntry(() => refreshEntry(own), true);
  })();
  return own.startup;
}

function cleanupRetired(): Promise<void> {
  if (cleanupRun) return cleanupRun;
  if (!retired.size) return Promise.resolve();
  const pending = [...retired];
  const nativeCleanup = queueEntry(async () => {
    for (const own of pending) {
      if (!own.nativeTouched) continue;
      await OBR.tool.remove(TOOL_ID);
      own.nativeTouched = false;
      own.registered = false;
    }
  }, true);
  const windowCleanup = queuePopover(async () => {
    for (const own of pending) await closeOwnedPopover(own);
  }, true);
  const work = Promise.allSettled([nativeCleanup, windowCleanup]).then(results => {
    // A session retired while waiting for this cleanup cannot acquire an ID:
    // its callbacks/startup are invalidated before it joins the retired set.
    for (const own of retired) {
      if (!own.nativeTouched && !own.popoverTouched) retired.delete(own);
    }
    const errors = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    if (errors.length) throw new AggregateError(errors.map(result => result.reason), "[circleImage] editor cleanup failed");
  });
  cleanupRun = work.finally(() => { cleanupRun = undefined; });
  return cleanupRun;
}

export function teardownCircleImage(): Promise<void> {
  const own = session;
  if (own) {
    session = undefined;
    own.alive = false;
    own.wantsPopover = false;
    for (const off of own.unsubs.splice(0)) { try { off(); } catch {} }
    retired.add(own);
  }
  // Repeated teardown after a failure retries only the still-owned resources.
  return cleanupRetired();
}
