import OBR from "@owlbear-rodeo/sdk";
import { assetUrl } from "../../asset-base";
import { getLocalLang } from "../../state";
import { onViewportResize } from "../../utils/viewportAnchor";
import { TABLE_COMMAND, TABLE_OPEN, TABLE_READY, TABLE_ROOM_KEY, TABLE_VIEW, type TableCommand, type TableView } from "./protocol";
import type { TableController } from "./controller";
import { localViewParts } from "./local-view";
import { TABLE_UI_RESTORE, readUIDraft, type TableDisplayMode, type TableUICommand, type TableUIDraft } from "./ui-command";

const PANEL = "com.obr-suite/three-dragon-ante/popover";
let active = false, epoch = 0, selfId = "", connectionId = "";
let controller: TableController | null = null, starting: Promise<void> | null = null;
let desiredOpen = false, panelOpen = false, geometryDirty = false, panelRequested = false;
let syncing: Promise<void> | null = null, resizeOff: (() => void) | null = null;
let errorMessage: string | undefined;
let panelInstance = "", panelClient = "", viewSequence = 0, viewRequested = false;
let publishing: Promise<void> | null = null;
let displayMode: TableDisplayMode = "full", panelMode: TableDisplayMode = "full", replacePanel = false;
let uiDraft: TableUIDraft | null = null, restoreClient = "";
const unsubs: Array<() => void> = [];

async function publish(): Promise<void> {
  viewRequested = true;
  if (publishing) return publishing;
  publishing = (async () => {
    while (viewRequested) {
      viewRequested = false;
      if (!active || !panelOpen || !panelClient) return;
      const client = panelClient, instance = panelInstance, generation = epoch;
      const view: TableView = controller?.view ?? { table: null, selfPlayerId: selfId, isHost: false,
        connected: false, pending: !!starting, game: null, message: errorMessage ?? "connecting" };
      for (const part of localViewParts(view, client, ++viewSequence)) {
        if (!active || !panelOpen || epoch !== generation || panelClient !== client || panelInstance !== instance) break;
        await OBR.broadcast.sendMessage(TABLE_VIEW, part, { destination: "LOCAL" });
      }
    }
  })().finally(() => { publishing = null; if (viewRequested) requestView(); });
  return publishing;
}
function requestView(): void { void publish().catch(error => console.warn("[three-dragon] panel update failed", error)); }

/** Keep the game engine and private transport out of the idle startup path. */
function ensureController(): Promise<void> {
  if (starting) return starting;
  if (controller) return Promise.resolve();
  const generation = epoch;
  starting = (async () => {
    const { TableController } = await import("./controller");
    if (!active || generation !== epoch) return;
    const instance = new TableController(requestView);
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
        await (panelMode === "full" ? OBR.modal.close(PANEL) : OBR.popover.close(PANEL));
        panelOpen = false; panelClient = ""; resizeOff?.(); resizeOff = null;
        replacePanel = false; continue;
      }
      if (panelOpen && !geometryDirty) return;
      const generation = epoch;
      if (displayMode === "full") {
        geometryDirty = false; panelMode = "full"; panelInstance = crypto.randomUUID(); panelClient = ""; restoreClient = "";
        await OBR.modal.open({ id: PANEL, url: `${assetUrl("three-dragon-ante.html")}?instance=${panelInstance}&mode=full`, fullScreen: true, hidePaper: true });
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
      await OBR.popover.open({ id: PANEL, url: `${assetUrl("three-dragon-ante.html")}?instance=${panelInstance}&mode=compact`, width, height,
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

async function openTable(): Promise<void> {
  if (!active) return;
  // Native Escape/backdrop close destroys the iframe without an SDK closed event.
  // An explicit reopen replaces a possibly stale shell, keeping the controller.
  if (panelOpen) replacePanel = true;
  desiredOpen = true;
  void ensureController();
  await syncPanel();
}
async function localCommand(value: unknown, sender: string): Promise<void> {
  if (!active || sender !== connectionId || !value || typeof value !== "object") return;
  const envelope = value as { instance?: unknown; clientId?: unknown; command?: unknown };
  if (envelope.instance !== panelInstance || envelope.clientId !== panelClient || !panelClient || !envelope.command || typeof envelope.command !== "object") return;
  const command = envelope.command as TableUICommand, generation = epoch;
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
  if (command.type === "close") { desiredOpen = false; await syncPanel(); return; }
  await ensureController();
  if (!active || generation !== epoch || !controller) { requestView(); return; }
  try { await controller.command(command); }
  catch (error) { console.warn("[three-dragon] command failed", error); }
  requestView();
}

export async function setupThreeDragonAnte(): Promise<void> {
  if (active) return;
  active = true; const generation = ++epoch;
  [selfId, connectionId] = await Promise.all([OBR.player.getId(), OBR.player.getConnectionId()]);
  if (!active || generation !== epoch) return;
  errorMessage = undefined;
  unsubs.push(OBR.broadcast.onMessage(TABLE_OPEN, event => { if (event.connectionId === connectionId) void openTable(); }));
  unsubs.push(OBR.broadcast.onMessage(TABLE_READY, event => {
    const data = event.data as { clientId?: unknown; instance?: unknown };
    if (event.connectionId !== connectionId || !desiredOpen || data?.instance !== panelInstance || typeof data.clientId !== "string" || !data.clientId || data.clientId.length > 64) return;
    panelClient = data.clientId; requestView();
    if (restoreClient !== panelClient) {
      restoreClient = panelClient;
      if (uiDraft) void OBR.broadcast.sendMessage(TABLE_UI_RESTORE, { instance: panelInstance, clientId: panelClient, draft: uiDraft }, { destination: "LOCAL" }).catch(error => console.warn("[three-dragon] local selection restore failed", error));
    }
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
  selfId = connectionId = "";
}
