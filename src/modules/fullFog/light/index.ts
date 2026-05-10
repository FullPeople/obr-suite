// Light source orchestration — context menu (添加光源 / 光源设置 /
// 移除光源) + a per-client Light reactor that mirrors any token
// carrying LIGHT_KEY metadata into a NATIVE OBR `Light` item via
// `buildLight()`.
//
// History note: an earlier iteration tried a custom STANDALONE SKSL
// shader for "see-through-one-wall" peek behaviour (the user's E
// requirement). It worked partially but introduced four hard
// regressions — A: player couldn't select tokens (Effect bbox
// intercepted the click-drag init even with disableHit); C: walls
// didn't block player movement (OBR engine only acts on native
// Light + Wall items, not custom Effects); D: light didn't follow
// the token in real time during a drag (OBR.scene.items.onChange
// doesn't fire mid-drag, only at commit, so uniform updates lagged
// the drag). On top of that, Skia's silent shader-compile budget
// hit at >32 walls and produced a "square white box" no-op render.
// We reverted to native Light + Wall, which has all four behaviours
// correct out of the box. The "see-through-one-wall" effect is now
// solved at a different layer: feathered fog edges in the fullFog
// editor (output/obrPath.ts emits two Paths — solid inner + 50%
// outer ring — so the rim of fog-covered objects shows ghosted
// hints).
//
// Architecture (matches upstream Owlbear Rodeo dynamic-fog +
// Smoke & Spectre conventions):
//   1. Add Light context menu sets metadata `${pluginId}/light`
//      = { attenuationRadius, sourceRadius, falloff, … }.
//   2. A reactor watches scene.items.onChange.
//   3. For every tagged token, a native `buildLight().attachedTo(
//      parent.id)…` item is created in scene.local (per-client).
//   4. OBR's native fog/visibility renderer reads those Light
//      items and produces real illumination — properly clipped
//      by walls, fully integrated with the fog tool.

import OBR, { buildLight, type Item } from "@owlbear-rodeo/sdk";
import { assetUrl } from "../../../asset-base";
import {
  CTX_LIGHT_ADD,
  CTX_LIGHT_EDIT,
  CTX_LIGHT_REMOVE,
  LIGHT_KEY,
  DEFAULT_LIGHT_FALLOFF,
  DEFAULT_LIGHT_SOURCE_RADIUS,
  DEFAULT_LIGHT_RADIUS_CELLS,
  type LightConfig,
} from "./types";

const ICON_URL = assetUrl("fullfog-light-icon.svg");
const EDIT_URL = assetUrl("fullfog-light-edit.html");

let role: "GM" | "PLAYER" = "PLAYER";
let registered = false;

// parent token id → local Light item id. Each Light is `attachedTo`
// the parent with POSITION inheritance, so OBR auto-tracks token
// movement during drag without needing items.onChange to fire.
const lightByParent = new Map<string, string>();
const watcherUnsubs: Array<() => void> = [];

async function defaultLightConfig(): Promise<LightConfig> {
  let dpi = 150;
  try { dpi = await OBR.scene.grid.getDpi(); } catch {}
  return {
    attenuationRadius: DEFAULT_LIGHT_RADIUS_CELLS * dpi,
    sourceRadius: DEFAULT_LIGHT_SOURCE_RADIUS,
    falloff: DEFAULT_LIGHT_FALLOFF,
  };
}

async function ctxAddLight(targets: string[]): Promise<void> {
  if (targets.length === 0) return;
  const cfg = await defaultLightConfig();
  await OBR.scene.items.updateItems(targets, (drafts) => {
    for (const d of drafts) {
      const cur = (d.metadata as any)?.[LIGHT_KEY];
      if (!cur || typeof cur !== "object") {
        (d.metadata as any)[LIGHT_KEY] = { ...cfg };
      }
    }
  });
}

async function ctxRemoveLight(targets: string[]): Promise<void> {
  if (targets.length === 0) return;
  await OBR.scene.items.updateItems(targets, (drafts) => {
    for (const d of drafts) {
      delete (d.metadata as any)[LIGHT_KEY];
    }
  });
}

function readLightConfig(item: Item): LightConfig | null {
  const raw = (item.metadata as any)?.[LIGHT_KEY];
  if (!raw || typeof raw !== "object") return null;
  return {
    attenuationRadius: typeof raw.attenuationRadius === "number" && Number.isFinite(raw.attenuationRadius) && raw.attenuationRadius > 0
      ? raw.attenuationRadius
      : DEFAULT_LIGHT_RADIUS_CELLS * 150,
    sourceRadius: typeof raw.sourceRadius === "number" && Number.isFinite(raw.sourceRadius) && raw.sourceRadius > 0
      ? raw.sourceRadius
      : DEFAULT_LIGHT_SOURCE_RADIUS,
    falloff: typeof raw.falloff === "number" && Number.isFinite(raw.falloff) && raw.falloff > 0
      ? raw.falloff
      : DEFAULT_LIGHT_FALLOFF,
  };
}

/** Sync local native Light items to match parents tagged with
 *  LIGHT_KEY. Idempotent — adds missing, removes orphans, updates
 *  changed configs. Token motion follows automatically via the
 *  Light's `attachedTo` POSITION inheritance, so this only runs
 *  when items.onChange fires (token tagged / config edited /
 *  scene-ready cycle), not per drag frame. */
async function syncLights(): Promise<void> {
  let allItems: Item[] = [];
  try {
    allItems = await OBR.scene.items.getItems();
  } catch (e) {
    console.warn("[fullFog/light] getItems failed", e);
    return;
  }

  const taggedConfigs = new Map<string, LightConfig>();
  const parentItems = new Map<string, Item>();
  for (const it of allItems) {
    const cfg = readLightConfig(it);
    if (cfg) {
      taggedConfigs.set(it.id, cfg);
      parentItems.set(it.id, it);
    }
  }

  // Delete Light items whose parent lost the tag (or was removed).
  const toDelete: string[] = [];
  for (const [parentId, lightId] of [...lightByParent.entries()]) {
    if (!taggedConfigs.has(parentId)) {
      toDelete.push(lightId);
      lightByParent.delete(parentId);
    }
  }
  if (toDelete.length > 0) {
    try { await OBR.scene.local.deleteItems(toDelete); } catch (e) {
      console.warn("[fullFog/light] deleteItems failed", e);
    }
  }

  // Create Light items for newly tagged parents.
  const toAdd: any[] = [];
  for (const [parentId, cfg] of taggedConfigs) {
    if (lightByParent.has(parentId)) continue;
    const parent = parentItems.get(parentId)!;
    const light = buildLight()
      .attenuationRadius(cfg.attenuationRadius)
      .sourceRadius(cfg.sourceRadius)
      .falloff(cfg.falloff)
      .attachedTo(parentId)
      .position((parent as any).position ?? { x: 0, y: 0 })
      .rotation((parent as any).rotation ?? 0)
      .visible((parent as any).visible ?? true)
      // Disable SCALE so a 2× ogre doesn't double the light radius;
      // disable COPY so duplicating the parent doesn't duplicate
      // our local-only Light. POSITION + ROTATION + VISIBLE inherit
      // (matches upstream dynamic-fog defaults).
      .disableAttachmentBehavior(["SCALE", "COPY"])
      .build();
    lightByParent.set(parentId, light.id);
    toAdd.push(light);
  }
  if (toAdd.length > 0) {
    try { await OBR.scene.local.addItems(toAdd); } catch (e) {
      console.warn("[fullFog/light] addItems failed", e);
    }
  }

  // Update existing Light items whose config changed.
  const updates: Array<[string, LightConfig]> = [];
  for (const [parentId, lightId] of lightByParent.entries()) {
    const cfg = taggedConfigs.get(parentId);
    if (!cfg) continue;
    updates.push([lightId, cfg]);
  }
  if (updates.length > 0) {
    const cfgById = new Map(updates);
    try {
      await OBR.scene.local.updateItems(
        updates.map(([id]) => id),
        (drafts) => {
          for (const d of drafts) {
            const cfg = cfgById.get(d.id);
            if (!cfg) continue;
            const lt = d as any;
            if (lt.attenuationRadius !== cfg.attenuationRadius) lt.attenuationRadius = cfg.attenuationRadius;
            if (lt.sourceRadius !== cfg.sourceRadius) lt.sourceRadius = cfg.sourceRadius;
            if (lt.falloff !== cfg.falloff) lt.falloff = cfg.falloff;
          }
        },
      );
    } catch (e) {
      console.warn("[fullFog/light] updateItems failed", e);
    }
  }
}

let syncTimer: number | null = null;
function scheduleSync(): void {
  if (syncTimer != null) return;
  syncTimer = window.setTimeout(() => {
    syncTimer = null;
    void syncLights();
  }, 60);
}

export async function setupLight(): Promise<void> {
  if (registered) return;
  try { role = (await OBR.player.getRole()) as "GM" | "PLAYER"; } catch {}

  if (role === "GM") {
    try {
      await OBR.contextMenu.create({
        id: CTX_LIGHT_ADD,
        icons: [
          {
            icon: ICON_URL,
            label: "添加光源",
            filter: {
              every: [
                { key: "type", value: "IMAGE" },
                { key: ["metadata", LIGHT_KEY], value: undefined },
              ],
              max: 1,
            },
          },
          {
            icon: ICON_URL,
            label: "添加光源",
            filter: {
              every: [
                { key: "type", value: "SHAPE" },
                { key: "shapeType", value: "CIRCLE" },
                { key: ["metadata", LIGHT_KEY], value: undefined },
              ],
              max: 1,
            },
          },
        ],
        onClick: async (ctx) => {
          await ctxAddLight(ctx.items.map((i) => i.id));
        },
      });

      // Light Settings — INLINE EMBED in the context menu.
      await OBR.contextMenu.create({
        id: CTX_LIGHT_EDIT,
        icons: [
          {
            icon: ICON_URL,
            label: "光源设置",
            filter: {
              every: [
                { key: "type", value: "IMAGE" },
                { key: ["metadata", LIGHT_KEY], value: undefined, operator: "!=" },
              ],
              max: 1,
            },
          },
          {
            icon: ICON_URL,
            label: "光源设置",
            filter: {
              every: [
                { key: "type", value: "SHAPE" },
                { key: ["metadata", LIGHT_KEY], value: undefined, operator: "!=" },
              ],
              max: 1,
            },
          },
        ],
        embed: {
          url: EDIT_URL,
          height: 244,
        },
      });

      await OBR.contextMenu.create({
        id: CTX_LIGHT_REMOVE,
        icons: [{
          icon: ICON_URL,
          label: "移除光源",
          filter: {
            every: [
              { key: ["metadata", LIGHT_KEY], value: undefined, operator: "!=" },
            ],
          },
        }],
        onClick: async (ctx) => {
          await ctxRemoveLight(ctx.items.map((i) => i.id));
        },
      });
    } catch (e) {
      console.warn("[fullFog/light] contextMenu.create failed", e);
    }
  }

  watcherUnsubs.push(OBR.scene.items.onChange(() => scheduleSync()));
  try {
    watcherUnsubs.push(
      OBR.scene.onReadyChange((ready) => {
        lightByParent.clear();
        if (ready) scheduleSync();
      }),
    );
  } catch {}
  scheduleSync();

  registered = true;
}

export async function teardownLight(): Promise<void> {
  if (!registered) return;
  for (const u of watcherUnsubs.splice(0)) {
    try { u(); } catch {}
  }
  if (syncTimer != null) { clearTimeout(syncTimer); syncTimer = null; }
  for (const id of [CTX_LIGHT_ADD, CTX_LIGHT_EDIT, CTX_LIGHT_REMOVE]) {
    try { await OBR.contextMenu.remove(id); } catch {}
  }
  const itemIds = [...lightByParent.values()];
  if (itemIds.length > 0) {
    try { await OBR.scene.local.deleteItems(itemIds); } catch {}
  }
  lightByParent.clear();
  registered = false;
}
