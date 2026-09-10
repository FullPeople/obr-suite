// 添加光源 / 光源设置 context menu. Port of upstream `createLightMenu`,
// with the suite's bilingual labels and its own asset paths.
//
// "Remove light" is not a separate menu entry — it lives at the bottom
// of the settings panel, exactly like upstream.

import OBR from "@owlbear-rodeo/sdk";
import { assetUrl } from "../../../../asset-base";
import { getLocalLang } from "../../../../state";
import { ICON_LIGHT } from "../overlayAssets";
import { CTX_LIGHT_ADD, CTX_LIGHT_SETTINGS, LIGHT_KEY } from "../ids";
import {
  DEFAULT_FALLOFF,
  DEFAULT_RANGE_CELLS,
  DEFAULT_SOURCE_RADIUS,
} from "./config";

const SETTINGS_URL = assetUrl("fullfog-light-edit.html");

export async function createLightMenu(): Promise<void> {
  const en = getLocalLang() === "en";
  const addLabel = en ? "Add Light" : "添加光源";
  const settingsLabel = en ? "Light Settings" : "光源设置";

  await OBR.contextMenu.create({
    id: CTX_LIGHT_ADD,
    icons: [
      {
        icon: ICON_LIGHT,
        label: addLabel,
        filter: {
          every: [
            { key: "type", value: "IMAGE" },
            { key: ["metadata", LIGHT_KEY], value: undefined },
          ],
          permissions: ["UPDATE"],
        },
      },
      {
        icon: ICON_LIGHT,
        label: addLabel,
        filter: {
          every: [
            { key: "type", value: "SHAPE" },
            { key: "shapeType", value: "CIRCLE" },
            { key: ["metadata", LIGHT_KEY], value: undefined },
          ],
          permissions: ["UPDATE"],
        },
      },
    ],
    async onClick(context) {
      if ((await OBR.player.getRole()) !== "GM") return;
      let dpi = 150;
      try {
        dpi = await OBR.scene.grid.getDpi();
      } catch {}
      const attenuationRadius = DEFAULT_RANGE_CELLS * dpi;
      await OBR.scene.items.updateItems(context.items, (items) => {
        for (const item of items) {
          (item.metadata as Record<string, unknown>)[LIGHT_KEY] = {
            attenuationRadius,
            sourceRadius: DEFAULT_SOURCE_RADIUS,
            falloff: DEFAULT_FALLOFF,
          };
        }
      });
    },
  });

  await OBR.contextMenu.create({
    id: CTX_LIGHT_SETTINGS,
    icons: [
      {
        icon: ICON_LIGHT,
        label: settingsLabel,
        filter: {
          every: [
            {
              key: ["metadata", LIGHT_KEY],
              value: undefined,
              operator: "!=",
            },
          ],
          permissions: ["UPDATE"],
        },
      },
    ],
    embed: {
      url: SETTINGS_URL,
      // Basic light controls plus the single ownership selector.
      height: 254,
    },
  });
}

export async function removeLightMenu(): Promise<void> {
  for (const id of [CTX_LIGHT_ADD, CTX_LIGHT_SETTINGS]) {
    try {
      await OBR.contextMenu.remove(id);
    } catch {}
  }
}
