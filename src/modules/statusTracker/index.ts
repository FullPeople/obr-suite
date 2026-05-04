// Status Tracker — full-screen modal that shows every visible
// character on the current viewport, lets the DM drag buffs
// from a palette onto each token, and edits per-token consumable
// resources from a side panel.
//
// Tool integration:
//   - tool.createAction on the Select tool with shortcut "BracketRight"
//     (the `]` key) toggles the modal open/closed.
//
// On-token visualisation: see bubbles.ts.

import OBR, {
  Image,
  Item,
  isImage,
} from "@owlbear-rodeo/sdk";
import { assetUrl } from "../../asset-base";
import {
  PLUGIN_ID,
  STATUS_BUFFS_KEY,
  SCENE_BUFF_CATALOG_KEY,
  DEFAULT_BUFFS,
  BuffDef,
} from "./types";
import { syncTokenBuffs, readTokenBuffIds } from "./bubbles";

const MODAL_ID = "com.obr-suite/status-tracker";
const MODAL_URL = assetUrl("status-tracker.html");
const TOOL_ACTION_ID = "com.obr-suite/status-tracker-toggle";
const SELECT_TOOL = "rodeo.owlbear.tool/select";
const ICON_URL = assetUrl("status-icon.svg");

// LOCAL broadcast — the in-modal iframe asks us to refresh a token's
// buff bubbles on the canvas after the DM drags / drops in the modal.
const BC_REFRESH_TOKEN = `${PLUGIN_ID}/refresh-token`;
const BC_TOGGLE = `${PLUGIN_ID}/toggle`;

let isOpen = false;
const unsubs: Array<() => void> = [];

async function openModal(): Promise<void> {
  if (isOpen) return;
  try {
    await OBR.modal.open({
      id: MODAL_ID,
      url: MODAL_URL,
      fullScreen: true,
      hidePaper: true,
      hideBackdrop: false,
    });
    isOpen = true;
  } catch (e) {
    console.warn("[obr-suite/status] openModal failed", e);
  }
}

async function closeModal(): Promise<void> {
  try { await OBR.modal.close(MODAL_ID); } catch {}
  isOpen = false;
}

async function toggleModal(): Promise<void> {
  if (isOpen) await closeModal();
  else await openModal();
}

// Lookup a buff def by id, falling back to scene catalog if a
// custom buff was added by the DM and isn't in DEFAULT_BUFFS.
async function getCatalog(): Promise<BuffDef[]> {
  try {
    const meta = await OBR.scene.getMetadata();
    const v = meta[SCENE_BUFF_CATALOG_KEY] as unknown;
    if (Array.isArray(v)) {
      const out: BuffDef[] = [];
      for (const e of v) {
        if (e && typeof (e as any).id === "string") {
          out.push({
            id: (e as any).id,
            name: String((e as any).name ?? (e as any).id),
            color: String((e as any).color ?? "#ffffff"),
            group: typeof (e as any).group === "string" ? (e as any).group : undefined,
          });
        }
      }
      if (out.length) return out;
    }
  } catch {}
  return DEFAULT_BUFFS;
}

async function refreshTokenBuffs(tokenId: string): Promise<void> {
  try {
    const items = await OBR.scene.items.getItems([tokenId]);
    const token = items[0];
    if (!token || !isImage(token)) return;
    const buffIds = readTokenBuffIds(token);
    const cat = await getCatalog();
    const buffs = buffIds
      .map((id) => cat.find((b) => b.id === id))
      .filter((b): b is BuffDef => !!b);
    await syncTokenBuffs(token as Image, buffs);
  } catch (e) {
    console.warn("[obr-suite/status] refreshTokenBuffs failed", e);
  }
}

// Watch ALL tokens for metadata changes — when the buff list on
// any token changes, re-render its bubbles. This way buffs added
// by the modal AND buffs added via direct metadata writes both
// stay visible.
let lastBuffSnapshot = new Map<string, string>();
async function syncAllVisibleTokens(): Promise<void> {
  try {
    const items = await OBR.scene.items.getItems();
    const next = new Map<string, string>();
    for (const it of items) {
      if (!isImage(it)) continue;
      const ids = readTokenBuffIds(it);
      if (ids.length === 0) {
        if (lastBuffSnapshot.has(it.id)) {
          // Cleared — drop bubbles.
          await syncTokenBuffs(it as Image, []);
        }
        continue;
      }
      const key = ids.join("|");
      next.set(it.id, key);
      if (lastBuffSnapshot.get(it.id) === key) continue;
      const cat = await getCatalog();
      const buffs = ids
        .map((id) => cat.find((b) => b.id === id))
        .filter((b): b is BuffDef => !!b);
      await syncTokenBuffs(it as Image, buffs);
    }
    lastBuffSnapshot = next;
  } catch (e) {
    console.warn("[obr-suite/status] syncAllVisibleTokens failed", e);
  }
}

export async function setupStatusTracker(): Promise<void> {
  // Tool action — registered on the Select tool. The shortcut
  // "BracketRight" matches the `]` key on US/CN keyboards. Same
  // action button visible on the Select toolbar so it's also
  // clickable (the spec calls this the "in tool, registered as
  // toggleable" path).
  try {
    await OBR.tool.createAction({
      id: TOOL_ACTION_ID,
      shortcut: "BracketRight",
      icons: [
        {
          icon: ICON_URL,
          label: "状态追踪",
          filter: { activeTools: [SELECT_TOOL] },
        },
      ],
      onClick: async () => { await toggleModal(); },
    });
  } catch (e) {
    console.warn("[obr-suite/status] createAction failed", e);
  }

  // The modal iframe broadcasts these so we can react without it
  // owning OBR scene-write permissions on its own.
  unsubs.push(
    OBR.broadcast.onMessage(BC_REFRESH_TOKEN, (event) => {
      const tokenId = (event.data as any)?.tokenId as string | undefined;
      if (!tokenId) return;
      void refreshTokenBuffs(tokenId);
    }),
  );
  unsubs.push(
    OBR.broadcast.onMessage(BC_TOGGLE, () => { void toggleModal(); }),
  );

  // Background watch — keeps bubbles in sync with token metadata
  // even when the modal isn't open (other plugins or manual edits).
  unsubs.push(OBR.scene.items.onChange(() => { void syncAllVisibleTokens(); }));
  // Initial pass once the scene is ready.
  if (await OBR.scene.isReady()) {
    void syncAllVisibleTokens();
  }
  unsubs.push(
    OBR.scene.onReadyChange((ready) => {
      if (ready) void syncAllVisibleTokens();
      else lastBuffSnapshot.clear();
    }),
  );
}

export async function teardownStatusTracker(): Promise<void> {
  for (const u of unsubs.splice(0)) {
    try { u(); } catch {}
  }
  try { await OBR.tool.removeAction(TOOL_ACTION_ID); } catch {}
  await closeModal();
}
