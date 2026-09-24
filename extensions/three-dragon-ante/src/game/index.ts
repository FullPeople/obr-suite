import { TABLE_GESTURE } from "./gesture";
import OBR from "@owlbear-rodeo/sdk";
import { assetUrl } from "../asset-base";
import { getLocalLang } from "../locale";
import { onViewportResize } from "../viewport";
import { TABLE_COMMAND, TABLE_OPEN, TABLE_READY, TABLE_ROOM_KEY, TABLE_VIEW, type TableCommand, type TableView } from "./protocol";
import type { TableController } from "./controller";
import { localViewParts } from "./local-view";
import { createIdentity, type Identity } from "./identity";
import { sendQueued, queueState } from "./broadcast";
import { describeError, diag, throttle } from "./diagnostics";
import { TABLE_UI_RESTORE, readUIDraft, type TableDisplayMode, type TableUICommand, type TableUIDraft } from "./ui-command";

const PANEL = "com.fullpeople/three-dragon-ante/popover";
let active = false, epoch = 0, selfId = "";
/** This client's connection id, self-healing: Owlbear re-issues it on a
 *  reconnect, and a cached value would silently drop every panel command. */
let identity: Identity | null = null;
const logOnce = throttle(1000);
let consecutivePublishFailures = 0;
let controller: TableController | null = null, starting: Promise<void> | null = null;
let desiredOpen = false, panelOpen = false, geometryDirty = false, panelRequested = false;
let syncing: Promise<void> | null = null, resizeOff: (() => void) | null = null;
let errorMessage: string | undefined;
let panelInstance = "", panelClient = "", viewSequence = 0, viewRequested = false;
let publishing: Promise<void> | null = null;
let displayMode: TableDisplayMode = "full", panelMode: TableDisplayMode = "full", replacePanel = false;
let uiDraft: TableUIDraft | null = null, restoreClient = "";
const unsubs: Array<() => void> = [];

/** A burst of view requests must cost one batch, not one batch each: every
 *  batch is several LOCAL messages and Owlbear refuses the whole client once
 *  the broadcast rate is exceeded. */
const PUBLISH_MIN_INTERVAL_MS = 250;
/** A view that is byte-identical to one delivered moments ago is not sent again.
 *  The logs showed sequences climbing with a constant revision and identical
 *  bytes, which is pure rate-limit spend. */
const PUBLISH_REPEAT_MS = 3000;
let lastBatchAt = 0, lastSignature = "", lastDeliveredAt = 0;
const logRepeat = throttle(5000);
/** Cheap change detector for a ~48 KB payload; sampling is enough to notice an
 *  edit and far cheaper than hashing every byte. */
function signatureOf(packets: { payload: string }[]): string {
  let hash = 2166136261, length = 0;
  for (const packet of packets) { length += packet.payload.length; for (let index = 0; index < packet.payload.length; index += 7) { hash ^= packet.payload.charCodeAt(index); hash = Math.imul(hash, 16777619); } }
  return `${packets.length}:${length}:${(hash >>> 0).toString(36)}`;
}
async function publish(): Promise<void> {
  viewRequested = true;
  if (publishing) return publishing;
  publishing = (async () => {
    while (viewRequested) {
      viewRequested = false;
      if (!active || !panelOpen || !panelClient) return;
      const wait = Math.max(0, lastBatchAt + PUBLISH_MIN_INTERVAL_MS - Date.now());
      if (wait) {
        await new Promise(done => setTimeout(done, wait));
        // A newer view may have arrived while waiting; send that one instead.
        if (viewRequested) continue;
        if (!active || !panelOpen || !panelClient) return;
      }
      lastBatchAt = Date.now();
      const client = panelClient, instance = panelInstance, generation = epoch;
      const view: TableView = controller?.view ?? { table: null, selfPlayerId: selfId, isHost: false,
        connected: false, pending: !!starting, game: null, actionReceiptVersion: 1, message: errorMessage ?? "connecting" };
      const sequence = ++viewSequence;
      let packets;
      try { packets = localViewParts(view, client, sequence); }
      catch (error) {
        diag("pub", "could not encode the view", { sequence, error: describeError(error), connected: view.connected, message: view.message ?? "", revision: view.game && "revision" in view.game ? view.game.revision : null });
        throw error;
      }
      if (view.historyPage) controller?.consumeHistoryPage(view.historyPage);
      const signature = signatureOf(packets);
      if (signature === lastSignature && Date.now() - lastDeliveredAt < PUBLISH_REPEAT_MS) {
        if (logRepeat("repeat")) diag("pub", "identical view skipped", { sequence, sinceMs: Date.now() - lastDeliveredAt, parts: packets.length, base64: packets.reduce((sum, part) => sum + part.payload.length, 0) });
        continue;
      }
      const bytes = packets.reduce((sum, part) => sum + part.payload.length, 0);
      if (logOnce("pub")) diag("pub", "sending", { sequence, parts: packets.length, base64: bytes, revision: view.game && "revision" in view.game ? view.game.revision : null, connected: view.connected, message: view.message ?? "" });
      for (const [index, part] of packets.entries()) {
        if (!active || !panelOpen || epoch !== generation || panelClient !== client || panelInstance !== instance) { diag("pub", "batch abandoned", { sequence, part: index, reason: "panel changed" }); break; }
        const started = Date.now();
        try { await sendQueued(() => OBR.broadcast.sendMessage(TABLE_VIEW, part, { destination: "LOCAL" }).then(() => undefined)); }
        catch (error) {
          // The queue already waited out a rate limit; anything left is real.
          consecutivePublishFailures++;
          diag("pub", `part ${index + 1}/${packets.length} failed`, { sequence, base64: part.payload.length, ms: Date.now() - started, error: describeError(error), queue: queueState() });
          if (consecutivePublishFailures === 3 || consecutivePublishFailures % 20 === 0) diag("pub", "publication keeps failing", { sequence, part: index, failures: consecutivePublishFailures, panelClient, panelInstance, panelOpen, desiredOpen, connection: identity?.id ?? "", connected: view.connected, message: view.message ?? "", base64: bytes, queue: queueState() });
          throw error;
        }
        consecutivePublishFailures = 0;
      }
      lastSignature = signature; lastDeliveredAt = Date.now();
    }
  })().finally(() => { publishing = null; if (viewRequested) requestView(); });
  return publishing;
}
/** View requests coming faster than this are a loop, and the stack says who. */
let requestTimes: number[] = [];
const logBurst = throttle(10000);
function requestView(): void {
  const now = Date.now();
  requestTimes = requestTimes.filter(at => now - at < 1000);
  requestTimes.push(now);
  if (requestTimes.length >= 6 && logBurst("burst")) diag("pub", "view requested in a burst", { perSecond: requestTimes.length, stack: (new Error().stack ?? "").split(String.fromCharCode(10)).slice(2, 7) });
  // The reason must survive a screenshot, so the failure line carries a value,
  // never a collapsed object: SDK rejections are plain objects.
  void publish().catch(error => diag("pub", "panel update failed", { error: describeError(error), detail: error }));
}

/** Keep the game engine and private transport out of the idle startup path. */
function ensureController(): Promise<void> {
  if (starting) return starting;
  if (controller) return Promise.resolve();
  const generation = epoch;
  starting = (async () => {
    const { TableController } = await import("./controller");
    if (!active || generation !== epoch) return;
    const instance = new TableController(requestView, { onGesture: (seatId, gesture) => {
      if (active && panelClient && panelOpen) void sendQueued(() => OBR.broadcast.sendMessage(TABLE_GESTURE,
        { instance: panelInstance, clientId: panelClient, seatId, gesture }, { destination: "LOCAL" }).then(() => undefined)).catch(() => {});
    } });
    controller = instance;
    await instance.start();
    if (!active || generation !== epoch) { await instance.stop(); return; }
    errorMessage = undefined;
  })().catch(async error => {
    if (generation === epoch) {
      errorMessage = "requestFailed";
      const failed = controller; controller = null;
      await failed?.stop().catch(() => {});
    }
    console.warn("[three-dragon] table connection failed", error);
  }).finally(() => {
    starting = null;
    if (active && generation === epoch) requestView();
  });
  return starting;
}

function syncPanel(): Promise<void> {
  panelRequested = true;
  if (syncing) return syncing;
  syncing = (async () => {
    while (true) {
      panelRequested = false;
      if (!active || !desiredOpen) {
        resizeOff?.(); resizeOff = null;
        if (!panelOpen) return;
        await (panelMode === "full" ? OBR.modal.close(PANEL) : OBR.popover.close(PANEL)); panelOpen = false; panelClient = "";
        continue;
      }
      if (panelOpen && (panelMode !== displayMode || replacePanel)) {
        panelClient = "";
        await controller?.clearGesture();
        await (panelMode === "full" ? OBR.modal.close(PANEL) : OBR.popover.close(PANEL));
        panelOpen = false; panelClient = ""; resizeOff?.(); resizeOff = null;
        replacePanel = false; continue;
      }
      if (panelOpen && !geometryDirty) return;
      const generation = epoch;
      if (displayMode === "full") {
        geometryDirty = false; panelMode = "full"; panelInstance = crypto.randomUUID(); panelClient = ""; restoreClient = "";
        await OBR.modal.open({ id: PANEL, url: `${assetUrl("index.html")}?instance=${panelInstance}&mode=full`, fullScreen: true, hidePaper: true });
        panelOpen = true; requestView(); continue;
      }
      const [vw, vh] = await Promise.all([OBR.viewport.getWidth(), OBR.viewport.getHeight()]);
      if (!active || !desiredOpen || generation !== epoch) continue;
      const width = Math.max(160, Math.min(960, vw - 32)), height = Math.max(160, Math.min(740, vh - 64));
      geometryDirty = false;
      if (panelOpen) {
        // Resize the existing iframe so card choices and keyboard focus survive.
        await OBR.popover.setWidth(PANEL, width);
        if (active && desiredOpen && generation === epoch) await OBR.popover.setHeight(PANEL, height);
        continue;
      }
      panelInstance = crypto.randomUUID(); panelClient = ""; panelMode = "compact"; restoreClient = "";
      await OBR.popover.open({ id: PANEL, url: `${assetUrl("index.html")}?instance=${panelInstance}&mode=compact`, width, height,
        anchorReference: "POSITION", anchorPosition: { left: 16, top: 32 },
        anchorOrigin: { horizontal: "LEFT", vertical: "TOP" }, transformOrigin: { horizontal: "LEFT", vertical: "TOP" },
        disableClickAway: true, marginThreshold: 8 });
      panelOpen = true;
      resizeOff ??= onViewportResize(() => { geometryDirty = true; void syncPanel(); });
      requestView();
    }
  })().catch(error => {
    console.warn("[three-dragon] panel operation failed", error);
    if (active && desiredOpen) void OBR.notification.show(getLocalLang() === "en"
      ? "Could not open the card table. Please try again." : "牌桌暂时无法打开，请重试。", "ERROR");
  }).finally(() => { syncing = null; if (panelRequested) void syncPanel(); });
  return syncing;
}

export async function openTable(): Promise<void> {
  if (!active) return;
  // Native Escape/backdrop close destroys the iframe without an SDK closed event.
  // An explicit reopen replaces a possibly stale shell, keeping the controller.
  if (panelOpen) replacePanel = true;
  desiredOpen = true;
  void ensureController();
  await syncPanel();
}
async function localCommand(value: unknown, sender: string): Promise<void> {
  if (!active || !identity || !(await identity.matches(sender)) || !value || typeof value !== "object") {
    if (active && identity && sender !== identity.id) diag("cmd", "command from an unknown connection dropped", { sender, cached: identity.id });
    return;
  }
  const envelope = value as { instance?: unknown; clientId?: unknown; command?: unknown };
  if (envelope.instance !== panelInstance || envelope.clientId !== panelClient || !panelClient || !envelope.command || typeof envelope.command !== "object") return;
  const command = envelope.command as TableUICommand, generation = epoch;
  if (command.type === "omniscient") {
    await ensureController();
    // The inspection payload is host-local: only the serving creator can be
    // given another seat's private hand, so the capability flag decides this
    // instead of a bare ownership claim.
    // Mirror the page's own visibility rule instead of a capability field that
    // has proven unreliable in transit: the background re-validates the same
    // facts on its own view.
    const inspection = controller ? controller.view : null;
    if (active && generation === epoch && controller && inspection?.game) {
      // Only the serving client can build the payload. Every other GM must ask
      // for it; testing canEdit first sent a non-serving GM down the local path,
      // which then returned silently.
      if (inspection.isHost) controller.setOmniscient(command.enabled);
      else if (inspection.role === "GM") await controller.command({ type: "inspect", enabled: command.enabled });
    }
    requestView();
    return;
  }
  if (command.type === "remember" || command.type === "display" || command.type === "close") {
    if ("draft" in command) {
      const draft = readUIDraft(command.draft);
      if (draft && draft.tableId === controller?.view.table?.id && draft.gameId === controller?.view.game?.id) uiDraft = draft;
    }
    if (command.type === "remember") return;
    if (command.type === "display") {
      if (command.mode !== "full" && command.mode !== "compact") return;
      displayMode = command.mode; desiredOpen = true; await syncPanel(); return;
    }
  }
  if (command.type === "close") {
    desiredOpen = false; panelClient = "";
    await controller?.clearGesture();
    desiredOpen = false; await syncPanel(); return; }
  await ensureController();
  if (!active || generation !== epoch || !controller) { requestView(); return; }
  try { await controller.command(command); }
  catch (error) { console.warn("[three-dragon] command failed", error); }
  requestView();
}

export async function setupThreeDragonAnte(): Promise<void> {
  if (active) return;
  active = true; const generation = ++epoch;
  const [playerId, connection] = await Promise.all([OBR.player.getId(), OBR.player.getConnectionId()]);
  selfId = playerId;
  if (!identity) identity = createIdentity(connection, "background"); else identity.set(connection);
  identity.onChange(value => diag("conn", "background re-registered", { connection: value }));
  diag("boot", "background ready", { selfId, connection, panel: panelInstance || "(none)" });
  if (!active || generation !== epoch) return;
  errorMessage = undefined;
  unsubs.push(OBR.broadcast.onMessage(TABLE_OPEN, event => { void (async () => { if (await identity!.matches(event.connectionId)) void openTable(); })(); }));
  unsubs.push(OBR.broadcast.onMessage(TABLE_READY, event => {
    const data = event.data as { clientId?: unknown; instance?: unknown };
    void (async () => {
    if (!(await identity!.matches(event.connectionId)) || !desiredOpen || data?.instance !== panelInstance || typeof data.clientId !== "string" || !data.clientId || data.clientId.length > 64) {
      if (logOnce("ready") && event.connectionId !== identity!.id) diag("recv", "TABLE_READY from an unknown connection dropped", { sender: event.connectionId, cached: identity!.id });
      return;
    }
    panelClient = data.clientId; diag("recv", "panel registered", { client: panelClient, instance: panelInstance }); requestView();
    if (restoreClient !== panelClient) {
      restoreClient = panelClient;
      if (uiDraft) void sendQueued(() => OBR.broadcast.sendMessage(TABLE_UI_RESTORE, { instance: panelInstance, clientId: panelClient, draft: uiDraft }, { destination: "LOCAL" }).then(() => undefined)).catch(error => diag("send", "selection restore failed", { error: describeError(error) }));
    }
    })();
  }));
  unsubs.push(OBR.broadcast.onMessage(TABLE_GESTURE, event => {
    const data = event.data as { instance?: unknown; clientId?: unknown; gesture?: unknown; clear?: unknown };
    if (active && panelOpen && identity && event.connectionId === identity.id && data?.instance === panelInstance && data.clientId === panelClient && !('seatId' in data))
      void (data.clear === true ? controller?.clearGesture() : controller?.gesture(data.gesture))?.catch(() => {});
  }));
  unsubs.push(OBR.broadcast.onMessage(TABLE_COMMAND, event => { void localCommand(event.data, event.connectionId); }));
  const recoverHost = (metadata: Record<string, unknown>) => {
    const table = metadata[TABLE_ROOM_KEY] as { hostPlayerId?: unknown } | undefined;
    if (active && generation === epoch && table?.hostPlayerId === selfId) void ensureController();
  };
  unsubs.push(OBR.room.onMetadataChange(recoverHost));
  // Reopen only the host runtime after a browser refresh; the window stays closed.
  recoverHost(await OBR.room.getMetadata());
}

export async function teardownThreeDragonAnte(): Promise<void> {
  active = false; ++epoch; desiredOpen = false;
  for (const off of unsubs.splice(0)) off();
  resizeOff?.(); resizeOff = null;
  await starting;
  const previous = controller; controller = null;
  await previous?.stop();
  await syncPanel();
  await publishing;
  panelClient = panelInstance = "";
  uiDraft = null; restoreClient = ""; replacePanel = false; displayMode = "full";
  selfId = "";
}
