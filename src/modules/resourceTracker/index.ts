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

const BC_OPEN_EDIT = `${PLUGIN_ID}/edit-open`;
const BC_SAVE = `${PLUGIN_ID}/edit-save`;
const BC_DELETE = `${PLUGIN_ID}/edit-delete`;
const BC_CANCEL = `${PLUGIN_ID}/edit-cancel`;

const unsubs: Array<() => void> = [];
let modalOpen = false;

async function closeModal(): Promise<void> {
  if (!modalOpen) return;
  modalOpen = false;
  try { await OBR.modal.close(MODAL_ID); } catch {}
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
}

export async function teardownResourceTracker(): Promise<void> {
  await closeModal();
  for (const u of unsubs.splice(0)) {
    try { u(); } catch {}
  }
}
