// Vision module — main lifecycle.
//
// Responsibilities:
//   1. Read every Image item in the scene; pick out those with a
//      `LIGHT_KEY` metadata and treat them as light sources.
//   2. Collect walls (OBR fog + our collision walls).
//   3. Compute per-light visibility polygons.
//   4. Apply the per-client gating rule (shared vs owner-only) and
//      ask render.ts to draw the fog mask + tints.
//   5. Subscribe to scene-item changes (token moved, light added /
//      edited / removed, walls drawn / removed) and re-sync.
//   6. Register OBR context-menu items: 添加光源 / 编辑光源 /
//      移除光源 on tokens; 绘制碰撞图 on map items.

import OBR, { isImage, Item } from "@owlbear-rodeo/sdk";
import { assetUrl } from "../../asset-base";
import {
  LIGHT_KEY,
  COLLISION_MAP_KEY,
  LS_VISION_SHARED,
  LightSource,
  Vec2,
  PLUGIN_ID,
} from "./types";
import { collectWalls } from "./walls";
import { visibilityPolygon } from "./geom";
import { renderFog, clearFog, LightInstance } from "./render";

const CTX_ADD_LIGHT = `${PLUGIN_ID}/ctx-add-light`;
const CTX_EDIT_LIGHT = `${PLUGIN_ID}/ctx-edit-light`;
const CTX_REMOVE_LIGHT = `${PLUGIN_ID}/ctx-remove-light`;
const CTX_DRAW_COLLISION = `${PLUGIN_ID}/ctx-draw-collision`;

const POPOVER_LIGHT_EDIT = `${PLUGIN_ID}/light-edit`;
const MODAL_COLLISION_EDIT = `${PLUGIN_ID}/collision-edit`;

const ICON_URL = assetUrl("vision-icon.svg");

// Default light when "添加光源" is clicked on a token without one.
const DEFAULT_LIGHT: LightSource = {
  colorRadius: 30,
  darkRadius: 30,
  color: "#ffd479",
  falloff: 8,
  rays: 240,
};

// LocalStorage helpers for the shared/owner-only toggle.
function readShared(): boolean {
  try {
    const v = localStorage.getItem(LS_VISION_SHARED);
    if (v === "0") return false;
    if (v === "1") return true;
  } catch {}
  return true; // default: shared (everyone sees what any token sees)
}

const unsubs: Array<() => void> = [];
let myPlayerId: string | null = null;
let myRole: "GM" | "PLAYER" = "PLAYER";
let syncQueued = false;
let syncRunning = false;

// Read center of an image item in scene units.
function imageCenter(item: any): Vec2 {
  // Approximate: position + half * scale (we ignore image.grid.offset
  // for the center because the typical token has center=position
  // already; if the token is image-anchored differently the center
  // is off by a few pixels, harmless for vision).
  const w = (item.image?.width ?? 0) * (item.scale?.x ?? 1) / 2;
  const h = (item.image?.height ?? 0) * (item.scale?.y ?? 1) / 2;
  return { x: item.position.x, y: item.position.y };
  // (We deliberately use position; the small offset in non-centered
  // tokens is rarely relevant for "where does my torch sit" since
  // OBR's grid system snaps tokens by position too.)
  void w; void h;
}

function readLightFromItem(item: Item): LightSource | null {
  const m = (item.metadata as any)?.[LIGHT_KEY];
  if (!m || typeof m !== "object") return null;
  const colorRadius = Number(m.colorRadius);
  if (!Number.isFinite(colorRadius) || colorRadius <= 0) return null;
  return {
    colorRadius,
    darkRadius: typeof m.darkRadius === "number" && m.darkRadius > 0 ? m.darkRadius : undefined,
    color: typeof m.color === "string" ? m.color : "#ffd479",
    falloff: typeof m.falloff === "number" ? m.falloff : 8,
    rays: typeof m.rays === "number" ? m.rays : 240,
  };
}

// Convert scene-unit radius to world-coord radius. OBR's grid DPI =
// pixels per cell; "feet per cell" is the user setting (default 5).
// Light radii are stored in feet, but raycast uses raw scene
// coordinates. Scale: scenePixelsPerFoot = grid.dpi / scale.parsed
// where `scale` is the "5ft" string. We approximate as grid.dpi/5 if
// we can't parse — typical 5e default.
async function feetToScenePx(): Promise<number> {
  try {
    const dpi = await OBR.scene.grid.getDpi();
    let scaleStr = "5ft";
    try { scaleStr = await OBR.scene.grid.getScale().then((s) => s?.parsed?.unit ?? "ft").catch(() => "ft") as any; } catch {}
    const m = /([\d.]+)/.exec(typeof scaleStr === "string" ? scaleStr : "5");
    const ftPerCell = m ? Number(m[1]) || 5 : 5;
    return dpi / ftPerCell;
  } catch {
    return 30; // fallback ~150dpi/5ft
  }
}

async function syncOnce(): Promise<void> {
  if (syncRunning) {
    syncQueued = true;
    return;
  }
  syncRunning = true;
  try {
    const shared = readShared();
    const items = await OBR.scene.items.getItems();
    const wallsRes = await collectWalls();
    const walls = wallsRes.walls;
    const pxPerFt = await feetToScenePx();

    const lights: LightInstance[] = [];
    for (const it of items) {
      if (!isImage(it)) continue;
      const light = readLightFromItem(it);
      if (!light) continue;

      // Shared/owner gating. When shared OFF and we're a player,
      // only render lights from tokens we own. GMs always see all.
      if (myRole !== "GM" && !shared) {
        const ownerId = (it as any).createdUserId as string | undefined;
        if (!ownerId || ownerId !== myPlayerId) continue;
      }

      const origin = imageCenter(it);
      const colorRadiusPx = light.colorRadius * pxPerFt;
      const darkRadiusPx = (light.darkRadius ?? 0) * pxPerFt;
      const totalRadiusPx = colorRadiusPx + darkRadiusPx;

      const colorPoly = visibilityPolygon(origin, colorRadiusPx, walls, light.rays ?? 240);
      let darkPoly: Vec2[] | undefined;
      if (totalRadiusPx > colorRadiusPx) {
        darkPoly = visibilityPolygon(origin, totalRadiusPx, walls, light.rays ?? 240);
      }

      lights.push({ light, origin, colorPoly, darkPoly });
    }

    await renderFog(lights);
  } catch (e) {
    console.error("[vision] sync failed", e);
  } finally {
    syncRunning = false;
    if (syncQueued) {
      syncQueued = false;
      void syncOnce();
    }
  }
}

let syncTimer: number | null = null;
function scheduleSync(): void {
  if (syncTimer != null) return;
  syncTimer = window.setTimeout(() => {
    syncTimer = null;
    void syncOnce();
  }, 50);
}

// --- Context-menu actions --------------------------------------------

async function ctxAddLight(targets: string[]): Promise<void> {
  if (targets.length === 0) return;
  await OBR.scene.items.updateItems(targets, (drafts) => {
    for (const d of drafts) {
      // Don't overwrite existing light.
      const cur = (d.metadata as any)?.[LIGHT_KEY];
      if (!cur || typeof cur !== "object") {
        (d.metadata as any)[LIGHT_KEY] = { ...DEFAULT_LIGHT };
      }
    }
  });
  // Open the editor for the first target so the DM can immediately
  // tweak radii / color.
  await openLightEditor(targets[0]);
}

async function ctxRemoveLight(targets: string[]): Promise<void> {
  if (targets.length === 0) return;
  await OBR.scene.items.updateItems(targets, (drafts) => {
    for (const d of drafts) {
      delete (d.metadata as any)[LIGHT_KEY];
    }
  });
}

async function openLightEditor(itemId: string): Promise<void> {
  try {
    await OBR.popover.close(POPOVER_LIGHT_EDIT);
  } catch {}
  const url = `${assetUrl("vision-light-edit.html")}?id=${encodeURIComponent(itemId)}`;
  try {
    await OBR.popover.open({
      id: POPOVER_LIGHT_EDIT,
      url,
      width: 320,
      height: 380,
      hidePaper: true,
      disableClickAway: false,
    });
  } catch (e) {
    console.error("[vision] open light editor failed", e);
  }
}

async function openCollisionEditor(mapItemId: string): Promise<void> {
  try {
    await OBR.modal.close(MODAL_COLLISION_EDIT);
  } catch {}
  const url = `${assetUrl("vision-collision-edit.html")}?id=${encodeURIComponent(mapItemId)}`;
  try {
    await OBR.modal.open({
      id: MODAL_COLLISION_EDIT,
      url,
      fullScreen: true,
      hidePaper: true,
    });
  } catch (e) {
    console.error("[vision] open collision editor failed", e);
  }
}

// --- Setup / teardown ------------------------------------------------

export async function setupVision(): Promise<void> {
  try { myRole = (await OBR.player.getRole()) as "GM" | "PLAYER"; } catch {}
  try { myPlayerId = await OBR.player.getId(); } catch {}

  // Watch role / id changes.
  unsubs.push(
    OBR.player.onChange((p) => {
      const nr = (p.role as "GM" | "PLAYER") || myRole;
      if (nr !== myRole) myRole = nr;
      if (p.id && p.id !== myPlayerId) myPlayerId = p.id;
      scheduleSync();
    }),
  );

  // Watch scene items — anything could affect vision (walls, tokens
  // moving, lights changing). 50ms debounce in scheduleSync absorbs
  // bursts (drag-move events fire many times per second).
  unsubs.push(OBR.scene.items.onChange(() => scheduleSync()));

  // Watch grid changes — DPI affects feet→pixels.
  try {
    unsubs.push(OBR.scene.grid.onChange(() => scheduleSync()));
  } catch {}

  // Watch storage for the shared / owner-only toggle.
  const onStorage = (e: StorageEvent) => {
    if (e.key === LS_VISION_SHARED) scheduleSync();
  };
  window.addEventListener("storage", onStorage);
  unsubs.push(() => window.removeEventListener("storage", onStorage));

  // Context-menu: actions on Image items.
  // Three entries on tokens (Image items): 添加光源 / 编辑光源 /
  // 移除光源. The icon filter shows the right one based on whether
  // the item already has a LIGHT_KEY.
  if (myRole === "GM") {
    try {
      await OBR.contextMenu.create({
        id: CTX_ADD_LIGHT,
        icons: [{
          icon: ICON_URL,
          label: "添加光源",
          filter: {
            every: [
              { key: "type", value: "IMAGE" },
              { key: ["metadata", LIGHT_KEY], value: undefined },
            ],
          },
        }],
        onClick: async (ctx) => {
          await ctxAddLight(ctx.items.map((i) => i.id));
        },
      });
      await OBR.contextMenu.create({
        id: CTX_EDIT_LIGHT,
        icons: [{
          icon: ICON_URL,
          label: "编辑光源",
          filter: {
            every: [{ key: "type", value: "IMAGE" }],
            some: [{ key: ["metadata", LIGHT_KEY], operator: "!=", value: undefined }],
            max: 1,
          },
        }],
        onClick: async (ctx) => {
          if (ctx.items.length > 0) await openLightEditor(ctx.items[0].id);
        },
      });
      await OBR.contextMenu.create({
        id: CTX_REMOVE_LIGHT,
        icons: [{
          icon: ICON_URL,
          label: "移除光源",
          filter: {
            every: [{ key: "type", value: "IMAGE" }],
            some: [{ key: ["metadata", LIGHT_KEY], operator: "!=", value: undefined }],
          },
        }],
        onClick: async (ctx) => {
          await ctxRemoveLight(ctx.items.map((i) => i.id));
        },
      });
      // Collision-map editor entry — only on items in the MAP layer
      // (which is where battlemaps live by default).
      await OBR.contextMenu.create({
        id: CTX_DRAW_COLLISION,
        icons: [{
          icon: ICON_URL,
          label: "绘制碰撞图（自动识别墙壁）",
          filter: {
            every: [
              { key: "type", value: "IMAGE" },
              { key: "layer", value: "MAP" },
            ],
            max: 1,
          },
        }],
        onClick: async (ctx) => {
          if (ctx.items.length > 0) await openCollisionEditor(ctx.items[0].id);
        },
      });
    } catch (e) {
      console.warn("[vision] contextMenu.create failed", e);
    }
  }

  // First-pass paint on setup.
  scheduleSync();
}

export async function teardownVision(): Promise<void> {
  for (const u of unsubs.splice(0)) {
    try { u(); } catch {}
  }
  if (syncTimer != null) {
    clearTimeout(syncTimer);
    syncTimer = null;
  }
  await clearFog();
  for (const id of [CTX_ADD_LIGHT, CTX_EDIT_LIGHT, CTX_REMOVE_LIGHT, CTX_DRAW_COLLISION]) {
    try { await OBR.contextMenu.remove(id); } catch {}
  }
}

// Export the unused suppression for COLLISION_MAP_KEY which the
// collision editor (separate iframe) is the actual consumer.
void COLLISION_MAP_KEY;
