// Resource Tracker — background module.
//
// Owns the lifecycle of the edit modal (resource-edit.html). The
// resource-tracker panel (mounted inside the bestiary / character-
// card / hp-bar popovers via panel.ts) broadcasts on
// `BC_RESOURCE_OPEN_EDIT` when the user clicks "+ new resource" or
// the gear icon next to a row. We open a fullscreen modal carrying
// the resource payload in its URL hash; the modal broadcasts
// SAVE / DELETE / CANCEL back, and we route SAVE / DELETE into
// `OBR.scene.items.updateItems` so the panel auto-refreshes via
// items.onChange.

import OBR from "@owlbear-rodeo/sdk";
import { assetUrl } from "../../asset-base";
import { getLocalLang, onLangChange } from "../../state";
import { readResources, commitResourceEdit } from "./storage";
import { clearEditSession, editSessionOpen } from "./session";
import { Resource, PLUGIN_ID } from "./types";

const MODAL_ID = `${PLUGIN_ID}/edit-modal`;
const MODAL_URL = assetUrl("resource-edit.html");

// 2026-05-11 — bottom-center toast overlay. Always-on full-screen
// modal with disablePointerEvents so it never blocks the canvas.
// resource-toast-page.ts subscribes to BC_RESOURCE_CHANGED and pops
// a small card every time someone in the room mutates a resource.
const TOAST_MODAL_ID = `${PLUGIN_ID}/toast-modal`;
const TOAST_URL = assetUrl("resource-toast.html");

const BC_OPEN_EDIT = `${PLUGIN_ID}/edit-open`;
const BC_SAVE = `${PLUGIN_ID}/edit-save`;
const BC_DELETE = `${PLUGIN_ID}/edit-delete`;
const BC_CANCEL = `${PLUGIN_ID}/edit-cancel`;

// 2026-05 — DM-only "全员资源总览" stats panel. A standalone toolbar
// tool (created GM-only — never registered for players) opens a
// full-screen panel listing every player character's resources with
// inline − / + / set-value edit. Sized modal (not fullScreen) so
// OBR's tool toolbar stays visible, same pattern as the cc panel.
const PANEL_MODAL_ID = `${PLUGIN_ID}/tracker-panel`;
const PANEL_URL = assetUrl("resource-tracker.html");
const PANEL_TOOL_ID = `${PLUGIN_ID}/tracker-tool`;
const PANEL_ICON_URL = assetUrl("resource-tracker-icon.svg");
// Panel open-state lives in localStorage (shared across this client's
// same-origin iframes) — the panel page clears it on every close path
// including OBR's click-outside close, where a synchronous write
// lands but an async broadcast does not. Replaces a cached boolean +
// broadcast that left the toolbar tool needing two clicks to reopen.
const PANEL_OPEN_KEY = `${PLUGIN_ID}/panel-open`;
const PANEL_SIDE_GAP = 64; // px gap each side → tool toolbar stays clickable
// 2026-05-16 — MUI's default `MuiDialog-paper` enforces
// `maxHeight: calc(100% - 64px)` even when `hidePaper: true` strips
// the visual styling. Asking OBR for height: vh would make the iframe
// taller than the clamped Paper → Paper scrolls. Subtract the margin
// up front so iframe matches Paper exactly. See cc-panel openMainPopover
// for the full diagnosis.
const MUI_DIALOG_MARGIN = 64;

const unsubs: Array<() => void> = [];
let modalOpen = false;
let enabled = false, lifecycle = 0, sceneRevision = 0, roleRevision = 0, editRevision = 0;
let sceneReady = false, role: "GM" | "PLAYER" = "PLAYER", connectionId = "";
let editSerial: Promise<void> = Promise.resolve();
interface EditSession { session: string; itemId: string; resourceId: string | null; scene: number; role: number; lifetime: number; saving: boolean }
let editor: EditSession | null = null;
function invalidateEditor() {
  editRevision++;
  if (editor) clearEditSession(editor.session);
  editor = null;
}
function sessionCurrent(value: EditSession): boolean {
  return enabled && sceneReady && editor === value && value.lifetime === lifecycle &&
    value.scene === sceneRevision && value.role === roleRevision && editSessionOpen(value.session);
}
function localMessage(message: { connectionId: string }) { return enabled && !!connectionId && message.connectionId === connectionId; }

let startup: Promise<void> | undefined;
let toolReady = false, toolTouched = false, toolOwner = 0, toolLabel: string | undefined;
let toolSerial = Promise.resolve();
function queueTool(work: () => Promise<void>): Promise<void> {
  const result = toolSerial.then(work);
  toolSerial = result.catch(() => {}); // Keep ordering after failure; the caller still sees rejection.
  return result;
}
async function removeOwnedTool(owner: number): Promise<void> {
  if (!toolTouched || toolOwner !== owner) return;
  await OBR.tool.remove(PANEL_TOOL_ID);
  toolTouched = false; toolLabel = undefined;
}
const reportEntryError = (error: unknown) => console.warn("[resources] native entry failed", error);

let toastOpen = false;
let toastSerial: Promise<void> = Promise.resolve();
function isPanelOpen(): boolean {
  try { return localStorage.getItem(PANEL_OPEN_KEY) === "1"; } catch { return false; }
}

async function closeModal(): Promise<void> {
  invalidateEditor();
  editSerial = editSerial.catch(() => {}).then(async () => {
    if (!modalOpen) return;
    modalOpen = false;
    try { await OBR.modal.close(MODAL_ID); } catch {}
  });
  await editSerial;
}

function openToastOverlay(): Promise<void> {
  const own = lifecycle, scene = sceneRevision;
  const current = () => enabled && sceneReady && own === lifecycle && scene === sceneRevision;
  toastSerial = toastSerial.catch(() => {}).then(async () => {
    if (!current() || toastOpen) return;
    try {
      await OBR.modal.close(TOAST_MODAL_ID);
      if (!current()) return;
      await OBR.modal.open({ id: TOAST_MODAL_ID, url: TOAST_URL, fullScreen: true,
        hidePaper: true, hideBackdrop: true, disablePointerEvents: true });
      if (!current()) { await OBR.modal.close(TOAST_MODAL_ID); return; }
      toastOpen = true;
    } catch (error) { console.warn("[resources] toast open failed", error); }
  });
  return toastSerial;
}
function closeToastOverlay(): Promise<void> {
  toastSerial = toastSerial.catch(() => {}).then(async () => {
    if (!toastOpen) return;
    toastOpen = false;
    try { await OBR.modal.close(TOAST_MODAL_ID); } catch {}
  });
  return toastSerial;
}

// --- DM stats panel ---

interface PanelContext { lifetime: number; scene: number; actor: number; open: boolean }
let panelIntent: PanelContext | undefined;
let panelOwner: PanelContext | undefined;
let panelTouched = false, panelOpenUnconfirmed = false;
let panelSerial = Promise.resolve();
function queuePanel(work: () => Promise<void>): Promise<void> {
  const result = panelSerial.then(work);
  panelSerial = result.catch(() => {});
  return result;
}
function panelCurrent(value: PanelContext) {
  return enabled && sceneReady && role === "GM" && value.lifetime === lifecycle && value.scene === sceneRevision && value.actor === roleRevision;
}
async function closeOwnedPanel(): Promise<void> {
  if (!panelTouched && !isPanelOpen()) return;
  await OBR.modal.close(PANEL_MODAL_ID);
  panelTouched = false; panelOpenUnconfirmed = false; panelOwner = undefined;
  try { localStorage.removeItem(PANEL_OPEN_KEY); } catch {}
}
async function openResourcePanel(target: PanelContext): Promise<void> {
  const current = () => panelCurrent(target) && panelIntent === target;
  if (!current()) return;
  if (panelTouched && (panelOpenUnconfirmed || (panelOwner && !panelCurrent(panelOwner)))) await closeOwnedPanel();
  if (!current() || isPanelOpen()) return;
  let vw = 1280, vh = 800;
  try { [vw, vh] = await Promise.all([OBR.viewport.getWidth(), OBR.viewport.getHeight()]); }
  catch { /* viewport read failed — retain the original bounded fallback */ }
  if (!current()) return;
  panelTouched = true; panelOpenUnconfirmed = true; panelOwner = target;
  try {
    await OBR.modal.open({ id: PANEL_MODAL_ID, url: PANEL_URL,
      width: Math.max(360, Math.round(vw) - PANEL_SIDE_GAP * 2),
      height: Math.max(240, Math.round(vh) - MUI_DIALOG_MARGIN),
      hideBackdrop: true, hidePaper: true });
  } catch (error) {
    // The host may have applied an open even when its acknowledgement failed.
    await closeOwnedPanel();
    throw error;
  }
  panelOpenUnconfirmed = false;
  if (!current()) { await closeOwnedPanel(); return; }
  try { localStorage.setItem(PANEL_OPEN_KEY, "1"); } catch {}
}
function closeResourcePanel(): Promise<void> {
  panelIntent = undefined;
  return queuePanel(closeOwnedPanel);
}
function toggleResourcePanel(): Promise<void> {
  if (!enabled || !sceneReady || role !== "GM") return Promise.resolve();
  const open = panelIntent && panelCurrent(panelIntent) ? !panelIntent.open : !isPanelOpen();
  const target: PanelContext = { lifetime: lifecycle, scene: sceneRevision, actor: roleRevision, open };
  panelIntent = target;
  return queuePanel(async () => {
    try {
      if (!panelCurrent(target) || panelIntent !== target) return;
      if (target.open) await openResourcePanel(target); else await closeOwnedPanel();
    } finally { if (panelIntent === target) panelIntent = undefined; }
  });
}

interface OpenPayload {
  itemId: string;
  resource?: Resource;
}

async function openModal(payload: OpenPayload): Promise<void> {
  if (!enabled || !sceneReady || !payload?.itemId) return;
  const request = ++editRevision, own = lifecycle, scene = sceneRevision, actor = roleRevision;
  const current = () => enabled && sceneReady && own === lifecycle && scene === sceneRevision && actor === roleRevision && request === editRevision;
  const items = await OBR.scene.items.getItems([payload.itemId]).catch(() => []);
  if (!current() || !items[0]) return;
  const resource = payload.resource ? readResources(items[0]).find((value) => value.id === payload.resource!.id) : undefined;
  if (payload.resource && !resource) return;
  const session: EditSession = { session: crypto.randomUUID(), itemId: payload.itemId, resourceId: resource?.id ?? null,
    scene, role: actor, lifetime: own, saving: false };
  editSerial = editSerial.catch(() => {}).then(async () => {
    if (!current()) return;
    if (editor) clearEditSession(editor.session);
    editor = null;
    if (modalOpen) { await OBR.modal.close(MODAL_ID); modalOpen = false; }
    if (!current()) return;
    editor = session;
    const hash = encodeURIComponent(JSON.stringify({ itemId: payload.itemId, resource, session: session.session }));
    await OBR.modal.open({ id: MODAL_ID, url: `${MODAL_URL}#${hash}`, fullScreen: true, hidePaper: true, hideBackdrop: true });
    if (!current()) { await OBR.modal.close(MODAL_ID); return; }
    modalOpen = true;
  });
  await editSerial.catch((error) => console.warn("[resources] editor open failed", error));
}

async function applyEditorMessage(message: {connectionId: string; data: unknown}, remove: boolean) {
  if (!localMessage(message)) return;
  const data = message.data as {session?: string; itemId?: string; resource?: Resource; resourceId?: string} | undefined;
  const target = editor;
  if (!target || !data || data.session !== target.session || data.itemId !== target.itemId || !sessionCurrent(target) || target.saving) return;
  if (remove ? !target.resourceId || data.resourceId !== target.resourceId : !data.resource || (target.resourceId && data.resource.id !== target.resourceId)) return;
  target.saving = true;
  try {
    const changed = await commitResourceEdit(target.itemId, target.resourceId, remove ? null : data.resource!, (item) => item.id === target.itemId && sessionCurrent(target));
    if (!sessionCurrent(target)) return;
    if (!changed) throw Error("Resource changed or is no longer available");
    await closeModal();
  } catch (error) {
    console.warn("[resources] editor write failed", error);
    if (sessionCurrent(target)) void OBR.notification.show(getLocalLang() === "en" ? "Resource update failed. Please retry." : "资源更新失败，请重试。", "ERROR");
  } finally { target.saving = false; }
}

function syncTool(): Promise<void> {
  const own = lifecycle;
  return queueTool(async () => {
    if (!enabled || !toolReady || own !== lifecycle || role !== "GM") return;
    // A rejected removal still owns the ID. Retry it before a new lifetime can
    // register; locale updates within one lifetime use only same-ID create.
    if (toolTouched && toolOwner !== own) await removeOwnedTool(toolOwner);
    if (!enabled || own !== lifecycle || role !== "GM") return;
    const label = getLocalLang() === "en" ? "Resource tracker" : "资源追踪";
    if (toolTouched && toolOwner === own && toolLabel === label) return;
    toolTouched = true; toolOwner = own;
    // A rejected reply can still follow a host-side label change.
    toolLabel = undefined;
    await OBR.tool.create({ id: PANEL_TOOL_ID, icons: [{ icon: PANEL_ICON_URL, label, filter: { roles: ["GM"] } }],
      onClick: async () => {
        if (!enabled || own !== lifecycle || role !== "GM") return false;
        try { await toggleResourcePanel(); } catch (error) { reportEntryError(error); }
        return false;
      } });
    toolLabel = label;
  });
}

export async function setupResourceTracker(): Promise<void> {
  if (enabled) return startup;
  enabled = true; toolReady = false; const own = ++lifecycle;
  startup = (async () => {
    let roleObserved = false;
    unsubs.push(OBR.player.onChange((player) => {
      if (!enabled || own !== lifecycle) return;
      // Even an unchanged role event is newer than the initial read, but must
      // not invalidate an editor just because the player's name/color changed.
      roleObserved = true;
      const next = player.role === "GM" ? "GM" : "PLAYER";
      if (role === next) return;
      roleRevision++; role = next; void closeModal(); void syncTool().catch(reportEntryError);
      if (role !== "GM") void closeResourcePanel().catch(reportEntryError);
    }));
    unsubs.push(OBR.scene.onReadyChange((ready) => {
      if (!enabled || own !== lifecycle) return;
      sceneRevision++; sceneReady = ready;
      void closeModal();
      if (ready) void openToastOverlay(); else { void closeToastOverlay(); void closeResourcePanel().catch(reportEntryError); }
    }));
    unsubs.push(onLangChange(() => { if (enabled && own === lifecycle) void syncTool().catch(reportEntryError); }));
    const actor = roleRevision, scene = sceneRevision;
    const [initialRole, initialConnection, initialReady] = await Promise.all([
      OBR.player.getRole(), OBR.player.getConnectionId(), OBR.scene.isReady(),
    ]);
    if (!enabled || own !== lifecycle) return;
    if (!roleObserved && actor === roleRevision) role = initialRole === "GM" ? "GM" : "PLAYER";
    if (scene === sceneRevision) sceneReady = initialReady;
    connectionId = initialConnection;
    if (!connectionId) throw new Error("[resources] missing local connection ID");
    toolReady = true;
    unsubs.push(OBR.broadcast.onMessage(BC_OPEN_EDIT, (message) => { if (localMessage(message)) void openModal(message.data as OpenPayload); }));
    unsubs.push(OBR.broadcast.onMessage(BC_SAVE, (message) => { void applyEditorMessage(message, false); }));
    unsubs.push(OBR.broadcast.onMessage(BC_DELETE, (message) => { void applyEditorMessage(message, true); }));
    unsubs.push(OBR.broadcast.onMessage(BC_CANCEL, (message) => {
      if (localMessage(message) && editor && (message.data as any)?.session === editor.session) void closeModal();
    }));
    await syncTool();
    if (enabled && own === lifecycle && sceneReady) await openToastOverlay();
  })();
  return startup;
}

export async function teardownResourceTracker(): Promise<void> {
  enabled = false; toolReady = false; lifecycle++; sceneRevision++; roleRevision++; connectionId = "";
  invalidateEditor();
  for (const unsubscribe of unsubs.splice(0)) { try { unsubscribe(); } catch {} }
  // Queue removal now, before any await can let a new lifetime register the ID.
  const owner = toolOwner;
  const nativeCleanup = queueTool(() => removeOwnedTool(owner));
  const results = await Promise.allSettled([nativeCleanup, closeResourcePanel(), closeModal(), closeToastOverlay()]);
  const failed = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failed.length) throw new AggregateError(failed.map(result => result.reason), "[resources] native entry cleanup failed");
}
