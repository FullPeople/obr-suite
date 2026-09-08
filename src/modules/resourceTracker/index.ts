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

async function openResourcePanel(): Promise<void> {
  if (!enabled || role !== "GM" || !sceneReady) return;
  const own = lifecycle, scene = sceneRevision, actor = roleRevision;
  try {
    let vw = 1280;
    let vh = 800;
    try {
      [vw, vh] = await Promise.all([
        OBR.viewport.getWidth(),
        OBR.viewport.getHeight(),
      ]);
    } catch { /* viewport read failed — fall back to sane defaults */ }
    if (!enabled || own !== lifecycle || scene !== sceneRevision || actor !== roleRevision || role !== "GM") return;
    await OBR.modal.open({
      id: PANEL_MODAL_ID,
      url: PANEL_URL,
      width: Math.max(360, Math.round(vw) - PANEL_SIDE_GAP * 2),
      height: Math.max(240, Math.round(vh) - MUI_DIALOG_MARGIN),
      hideBackdrop: true, // no dark overlay → side gaps stay interactive
      hidePaper: true,
    });
    if (!enabled || own !== lifecycle || scene !== sceneRevision || actor !== roleRevision) { await OBR.modal.close(PANEL_MODAL_ID); return; }
    try { localStorage.setItem(PANEL_OPEN_KEY, "1"); } catch {}
  } catch (e) {
    console.error("[obr-suite/resources] openResourcePanel failed", e);
  }
}

async function closeResourcePanel(): Promise<void> {
  try { await OBR.modal.close(PANEL_MODAL_ID); } catch {}
  try { localStorage.removeItem(PANEL_OPEN_KEY); } catch {}
}

async function toggleResourcePanel(): Promise<void> {
  if (isPanelOpen()) await closeResourcePanel();
  else await openResourcePanel();
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

async function syncTool() {
  const own = lifecycle, actor = roleRevision;
  try {
    await OBR.tool.remove(PANEL_TOOL_ID);
    if (!enabled || own !== lifecycle || actor !== roleRevision || role !== "GM") return;
    await OBR.tool.create({ id: PANEL_TOOL_ID, icons: [{icon:PANEL_ICON_URL,label:getLocalLang() === "en" ? "Resource tracker" : "资源追踪"}],
      onClick: async () => { await toggleResourcePanel(); return false; } });
    if (!enabled || own !== lifecycle || actor !== roleRevision) await OBR.tool.remove(PANEL_TOOL_ID);
  } catch (error) { console.warn("[resources] tracker tool update failed", error); }
}

export async function setupResourceTracker(): Promise<void> {
  if (enabled) return;
  enabled = true; const own = ++lifecycle;
  unsubs.push(OBR.player.onChange((player) => {
    const next = player.role === "GM" ? "GM" : "PLAYER";
    if (role === next) return;
    roleRevision++; role = next; void closeModal(); void syncTool();
    if (role !== "GM") void closeResourcePanel();
  }));
  unsubs.push(OBR.scene.onReadyChange((ready) => {
    sceneRevision++; sceneReady = ready;
    void closeModal();
    if (ready) void openToastOverlay(); else { void closeToastOverlay(); void closeResourcePanel(); }
  }));
  unsubs.push(onLangChange(() => { void syncTool(); }));
  const actor = roleRevision, scene = sceneRevision;
  const [initialRole, initialConnection, initialReady] = await Promise.all([
    OBR.player.getRole().catch(() => "PLAYER"), OBR.player.getConnectionId().catch(() => ""), OBR.scene.isReady().catch(() => false),
  ]);
  if (!enabled || own !== lifecycle) return;
  if (actor === roleRevision) role = initialRole === "GM" ? "GM" : "PLAYER";
  if (scene === sceneRevision) sceneReady = initialReady;
  connectionId = initialConnection;
  unsubs.push(OBR.broadcast.onMessage(BC_OPEN_EDIT, (message) => { if (localMessage(message)) void openModal(message.data as OpenPayload); }));
  unsubs.push(OBR.broadcast.onMessage(BC_SAVE, (message) => { void applyEditorMessage(message, false); }));
  unsubs.push(OBR.broadcast.onMessage(BC_DELETE, (message) => { void applyEditorMessage(message, true); }));
  unsubs.push(OBR.broadcast.onMessage(BC_CANCEL, (message) => {
    if (localMessage(message) && editor && (message.data as any)?.session === editor.session) void closeModal();
  }));
  await syncTool();
  if (enabled && own === lifecycle && sceneReady) await openToastOverlay();
}

export async function teardownResourceTracker(): Promise<void> {
  enabled = false; lifecycle++; sceneRevision++; roleRevision++; connectionId = "";
  invalidateEditor();
  for (const unsubscribe of unsubs.splice(0)) { try { unsubscribe(); } catch {} }
  await closeModal(); await closeToastOverlay(); await closeResourcePanel();
  try { await OBR.tool.remove(PANEL_TOOL_ID); } catch {}
}
