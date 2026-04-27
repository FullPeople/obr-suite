import OBR from "@owlbear-rodeo/sdk";
import {
  METADATA_KEY,
  OPTED_OUT_KEY,
  COMBAT_STATE_KEY,
  BROADCAST_OPEN_PANEL,
  BROADCAST_CLOSE_PANEL,
  NEW_ITEM_DIALOG_ID,
} from "./utils/constants";
import { Lang, t } from "./utils/i18n";
import {
  startSceneSync as startSuiteSync,
  getState as getSuiteState,
  onStateChange as onSuiteStateChange,
} from "../../state";

// Initiative Tracker module — migrated from the standalone plugin.
// Setup opens the top-center horizontal initiative strip popover, registers
// the right-click "add to initiative" / "remove from initiative" / "gather
// here" context menus, listens for broadcasts that toggle expanded state,
// and (GM only) watches scene items to prompt initiative for new tokens
// during active combat. Teardown unwinds all of the above.

const POPOVER_ID = "com.obr-suite/initiative-panel";
const PANEL_URL = "https://obr.dnd.center/suite/initiative-panel.html";
const NEW_ITEM_URL = "https://obr.dnd.center/suite/initiative-new-item.html";
const ICON_URL = "https://obr.dnd.center/suite/initiative-icon.svg";

const COLLAPSED_WIDTH = 120;
const COLLAPSED_HEIGHT = 40;
const EXPANDED_WIDTH = 720;
const EXPANDED_HEIGHT = 184;
const TOP_OFFSET = 40;

const CTX_TOGGLE = `${METADATA_KEY}/context-menu`;
const CTX_GATHER = `${METADATA_KEY}/gather-empty`;

const unsubs: Array<() => void> = [];
let knownItemIds = new Set<string>();
let initiativeRole: "GM" | "PLAYER" = "PLAYER";

async function openPanel(expanded: boolean) {
  const width = expanded ? EXPANDED_WIDTH : COLLAPSED_WIDTH;
  const height = expanded ? EXPANDED_HEIGHT : COLLAPSED_HEIGHT;
  try {
    const vw = await OBR.viewport.getWidth();
    await OBR.popover.open({
      id: POPOVER_ID,
      url: `${PANEL_URL}?expanded=${expanded ? 1 : 0}`,
      width,
      height,
      anchorReference: "POSITION",
      anchorPosition: { left: Math.round(vw / 2), top: TOP_OFFSET },
      anchorOrigin: { horizontal: "CENTER", vertical: "TOP" },
      transformOrigin: { horizontal: "CENTER", vertical: "TOP" },
      disableClickAway: true,
      hidePaper: true,
    });
  } catch (e) {
    console.error("[obr-suite/initiative] openPanel failed", e);
  }
}

async function closePanel() {
  try { await OBR.popover.close(POPOVER_ID); } catch {}
}

async function initKnownItems() {
  try {
    if (!(await OBR.scene.isReady())) return;
    const all = await OBR.scene.items.getItems(
      (item) =>
        item.type === "IMAGE" &&
        (item.layer === "CHARACTER" || item.layer === "MOUNT")
    );
    knownItemIds.clear();
    all.forEach((i) => knownItemIds.add(i.id));
  } catch (e) {
    console.error("[obr-suite/initiative] initKnown failed", e);
  }
}

// Re-registration of context menus when the suite language flips. OBR has
// no API to "update an existing context menu's label", so we remove and
// re-create with the new lang each time. The handlers re-read lang on each
// click via the closure.
async function registerContextMenus(lang: Lang) {
  try { await OBR.contextMenu.remove(CTX_TOGGLE); } catch {}
  try { await OBR.contextMenu.remove(CTX_GATHER); } catch {}

  await OBR.contextMenu.create({
    id: CTX_TOGGLE,
    icons: [
      {
        icon: ICON_URL,
        label: t(lang, "addToInitiative"),
        filter: {
          every: [
            { key: "type", value: "IMAGE" },
            { key: ["metadata", METADATA_KEY], value: undefined },
          ],
        },
      },
      {
        icon: ICON_URL,
        label: t(lang, "removeFromInitiative"),
        filter: {
          every: [{ key: "type", value: "IMAGE" }],
          some: [
            { key: ["metadata", METADATA_KEY], value: undefined, operator: "!=" },
          ],
        },
      },
    ],
    onClick: async (context) => {
      // Re-read language from suite state so notifications reflect the
      // most recent setting even if the user swapped languages between
      // re-registrations.
      const curLang = (getSuiteState().language as Lang) ?? "zh";
      const anyHasData = context.items.some(
        (item) => item.metadata[METADATA_KEY] !== undefined
      );
      const ids = context.items.map((i) => i.id);
      if (anyHasData) {
        await OBR.scene.items.updateItems(ids, (drafts) => {
          for (const d of drafts) {
            delete d.metadata[METADATA_KEY];
            d.metadata[OPTED_OUT_KEY] = true;
          }
        });
        OBR.notification.show(t(curLang, "removed"));
      } else {
        await OBR.scene.items.updateItems(ids, (drafts) => {
          for (const d of drafts) {
            d.metadata[METADATA_KEY] = {
              count: 0,
              active: false,
              rolled: false,
              tiebreak: Math.random(),
              ownerId: d.createdUserId,
            };
            delete d.metadata[OPTED_OUT_KEY];
          }
        });
        OBR.notification.show(t(curLang, "added"));
      }
    },
  });

  await OBR.contextMenu.create({
    id: CTX_GATHER,
    icons: [
      {
        icon: ICON_URL,
        label: t(lang, "gatherHere"),
        filter: { roles: ["GM"], min: 0, max: 0 },
      },
    ],
    onClick: async (context) => {
      const center = context.selectionBounds.center;
      const items = await OBR.scene.items.getItems(
        (item: any) =>
          item.metadata[METADATA_KEY] !== undefined && item.visible
      );
      if (items.length === 0) return;

      let dpi = 150;
      try { dpi = await OBR.scene.grid.getDpi(); } catch {}
      const spacing = dpi;

      const positions: { x: number; y: number }[] = [
        { x: center.x, y: center.y },
      ];
      let ring = 1;
      while (positions.length < items.length) {
        const count = ring * 6;
        for (let i = 0; i < count && positions.length < items.length; i++) {
          const angle = (i / count) * 2 * Math.PI - Math.PI / 2;
          positions.push({
            x: center.x + Math.cos(angle) * spacing * ring,
            y: center.y + Math.sin(angle) * spacing * ring,
          });
        }
        ring++;
      }

      const ids = items.map((i) => i.id);
      await OBR.scene.items.updateItems(ids, (drafts) => {
        drafts.forEach((d, idx) => {
          if (positions[idx]) d.position = positions[idx];
        });
      });
      // Notification removed per user feedback — silent gather.
    },
  });
}

export async function setupInitiative(): Promise<void> {
  // Read current language from suite state and register context menus.
  startSuiteSync();
  const initialLang = (getSuiteState().language as Lang) ?? "zh";
  await registerContextMenus(initialLang);

  // Re-register on language change so the right-click labels refresh.
  let lastLang = initialLang;
  unsubs.push(
    onSuiteStateChange((s) => {
      const next = (s.language as Lang) ?? "zh";
      if (next !== lastLang) {
        lastLang = next;
        registerContextMenus(next).catch(() => {});
      }
    })
  );

  // --- Open the panel now if scene is ready, and re-open on scene change ---
  try {
    if (await OBR.scene.isReady()) await openPanel(false);
  } catch {}
  unsubs.push(
    OBR.scene.onReadyChange(async (ready) => {
      if (ready) await openPanel(false);
      else await closePanel();
    })
  );

  // --- Broadcast: panel/expanded toggles from the panel iframe itself ---
  unsubs.push(
    OBR.broadcast.onMessage(BROADCAST_OPEN_PANEL, async () => {
      await openPanel(true);
    })
  );
  unsubs.push(
    OBR.broadcast.onMessage(BROADCAST_CLOSE_PANEL, async () => {
      await openPanel(false);
    })
  );

  // --- GM: track new tokens to prompt initiative during active combat ---
  try {
    initiativeRole = (await OBR.player.getRole()) as "GM" | "PLAYER";
  } catch { initiativeRole = "PLAYER"; }
  if (initiativeRole === "GM") {
    await initKnownItems();
    unsubs.push(
      OBR.scene.onReadyChange(async (ready) => {
        if (ready) await initKnownItems();
      })
    );
    unsubs.push(
      OBR.scene.items.onChange(async (sceneItems) => {
        const meta = await OBR.scene.getMetadata();
        const combat = meta[COMBAT_STATE_KEY] as any;
        const active = !!combat?.inCombat || !!combat?.preparing;

        const characterItems = sceneItems.filter(
          (i) =>
            i.type === "IMAGE" &&
            (i.layer === "CHARACTER" || i.layer === "MOUNT")
        );

        if (!active) {
          knownItemIds.clear();
          characterItems.forEach((i) => knownItemIds.add(i.id));
          return;
        }

        for (const item of characterItems) {
          if (
            !knownItemIds.has(item.id) &&
            !item.metadata[METADATA_KEY] &&
            !item.metadata[OPTED_OUT_KEY]
          ) {
            knownItemIds.add(item.id);
            const curLang = getStoredLang();
            OBR.modal.open({
              id: NEW_ITEM_DIALOG_ID,
              url: `${NEW_ITEM_URL}?itemId=${item.id}&itemName=${encodeURIComponent(
                item.name
              )}&lang=${curLang}`,
              width: 300,
              height: 200,
            });
          }
        }
        knownItemIds.clear();
        characterItems.forEach((i) => knownItemIds.add(i.id));
      })
    );
  }
}

export async function teardownInitiative(): Promise<void> {
  try { await OBR.contextMenu.remove(CTX_TOGGLE); } catch {}
  try { await OBR.contextMenu.remove(CTX_GATHER); } catch {}
  for (const u of unsubs.splice(0)) u();
  knownItemIds.clear();
  await closePanel();
}
