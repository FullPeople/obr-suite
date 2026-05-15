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
import { addResource, deleteResource, updateResource } from "./storage";
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

const unsubs: Array<() => void> = [];
let modalOpen = false;
let toastOpen = false;
function isPanelOpen(): boolean {
  try { return localStorage.getItem(PANEL_OPEN_KEY) === "1"; } catch { return false; }
}

async function closeModal(): Promise<void> {
  if (!modalOpen) return;
  modalOpen = false;
  try { await OBR.modal.close(MODAL_ID); } catch {}
}

async function openToastOverlay(): Promise<void> {
  if (toastOpen) return;
  try {
    try { await OBR.modal.close(TOAST_MODAL_ID); } catch {}
    await OBR.modal.open({
      id: TOAST_MODAL_ID,
      url: TOAST_URL,
      fullScreen: true,
      hidePaper: true,
      hideBackdrop: true,
      disablePointerEvents: true,
    });
    toastOpen = true;
  } catch (e) {
    console.warn("[obr-suite/resources] open toast overlay failed", e);
  }
}

async function closeToastOverlay(): Promise<void> {
  if (!toastOpen) return;
  toastOpen = false;
  try { await OBR.modal.close(TOAST_MODAL_ID); } catch {}
}

// --- DM stats panel ---

async function openResourcePanel(): Promise<void> {
  try {
    let vw = 1280;
    let vh = 800;
    try {
      [vw, vh] = await Promise.all([
        OBR.viewport.getWidth(),
        OBR.viewport.getHeight(),
      ]);
    } catch { /* viewport read failed — fall back to sane defaults */ }
    await OBR.modal.open({
      id: PANEL_MODAL_ID,
      url: PANEL_URL,
      width: Math.max(360, Math.round(vw) - PANEL_SIDE_GAP * 2),
      height: Math.max(240, Math.round(vh)),
      hideBackdrop: true, // no dark overlay → side gaps stay interactive
      hidePaper: true,
    });
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
  if (!payload?.itemId) return;
  if (modalOpen) await closeModal();
  const hash = encodeURIComponent(JSON.stringify(payload));
  const url = `${MODAL_URL}#${hash}`;
  try {
    await OBR.modal.open({
      id: MODAL_ID,
      url,
      fullScreen: true,
      hidePaper: true,
      hideBackdrop: true,
    });
    modalOpen = true;
  } catch (e) {
    console.error("[obr-suite/resources] openModal failed", e);
  }
}

export async function setupResourceTracker(): Promise<void> {
  // DM-only stats panel: a standalone toolbar tool, registered ONLY
  // for the GM (never shown to players). onClick returns false so the
  // tool acts as a button — toggling the panel without becoming the
  // active tool. The page broadcasts BC_PANEL_CLOSED on its own
  // X / Esc close so our cached `panelOpen` flag stays in sync.
  let role: "GM" | "PLAYER" = "PLAYER";
  try { role = (await OBR.player.getRole()) as "GM" | "PLAYER"; } catch {}
  if (role === "GM") {
    try {
      await OBR.tool.create({
        id: PANEL_TOOL_ID,
        icons: [{ icon: PANEL_ICON_URL, label: "资源追踪" }],
        onClick: async () => {
          await toggleResourcePanel();
          return false;
        },
      });
    } catch (e) {
      console.error("[obr-suite/resources] create tracker tool failed", e);
    }
  }

  unsubs.push(
    OBR.broadcast.onMessage(BC_OPEN_EDIT, async (msg) => {
      const data = msg.data as OpenPayload | undefined;
      if (!data) return;
      await openModal(data);
    }),
  );

  unsubs.push(
    OBR.broadcast.onMessage(BC_SAVE, async (msg) => {
      const data = msg.data as { itemId: string; resource: Resource } | undefined;
      if (!data?.itemId || !data.resource) {
        await closeModal();
        return;
      }
      const { itemId, resource } = data;
      try {
        // Try update first; if no existing entry, fall back to add.
        const updated = await updateResource(itemId, resource.id, () => resource);
        if (!updated) {
          await addResource(itemId, resource);
        }
      } catch (e) {
        console.error("[obr-suite/resources] save failed", e);
      }
      await closeModal();
    }),
  );

  unsubs.push(
    OBR.broadcast.onMessage(BC_DELETE, async (msg) => {
      const data = msg.data as { itemId: string; resourceId: string } | undefined;
      if (!data?.itemId || !data.resourceId) {
        await closeModal();
        return;
      }
      try {
        await deleteResource(data.itemId, data.resourceId);
      } catch (e) {
        console.error("[obr-suite/resources] delete failed", e);
      }
      await closeModal();
    }),
  );

  unsubs.push(
    OBR.broadcast.onMessage(BC_CANCEL, async () => {
      await closeModal();
    }),
  );

  // Mount the bottom-center toast overlay once. Listens for
  // BC_RESOURCE_CHANGED (LOCAL+REMOTE) emitted by mountResourcePanel's
  // onChange callback in the bestiary / cc info popovers. Re-opens
  // automatically on scene change via the scene-ready hook below.
  unsubs.push(
    OBR.scene.onReadyChange(async (ready) => {
      if (ready) await openToastOverlay();
      else await closeToastOverlay();
    }),
  );
  try {
    const ready = await OBR.scene.isReady();
    if (ready) await openToastOverlay();
  } catch {}
}

export async function teardownResourceTracker(): Promise<void> {
  await closeModal();
  await closeToastOverlay();
  await closeResourcePanel();
  try { await OBR.tool.remove(PANEL_TOOL_ID); } catch {}
  for (const u of unsubs.splice(0)) {
    try { u(); } catch {}
  }
}
