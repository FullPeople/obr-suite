// fullFog module — context menu + modal entry + wall watcher.
//
// Right-click a MAP-layer image → "编辑地图迷雾" → opens the
// fullscreen editor modal. The heavy lifting (image decode,
// algorithms, mask editing, save) lives in editor-page.ts.
//
// Wall watcher: OBR's `Wall` items live in the LOCAL (per-client)
// scene only — they aren't valid for the shared `OBR.scene.items`.
// So the editor saves a Path (carrying wall polylines as metadata)
// to the shared scene, and this watcher reconstitutes Wall items
// in `OBR.scene.local` on every client whenever the scene becomes
// ready or the underlying paths change. Each client owns its own
// wall set; they're rebuilt deterministically from the shared
// data, so they always agree.

import OBR, { isPath, type Item } from "@owlbear-rodeo/sdk";
import { assetUrl } from "../../asset-base";
import { CTX_EDIT_FOG, MODAL_ID, PLUGIN_ID, FOG_PATH_KEY, FOG_WALL_EXPAND_KEY } from "./types";
import { buildFogWalls } from "./output/obrWalls";
import { samplePathCommands } from "./output/samplePath";
import { FOG_PATH_KIND_KEY } from "./output/obrPath";
import { safeWallOffset } from "./output/wallOffset";
import { setupLight, teardownLight } from "./light";
import { setupFullFogDoor, teardownFullFogDoor } from "./door";
import { OPENINGS_KEY, type Opening } from "./door/types";
import { splitPolylineByOpenings } from "./door/geometry";

const ICON_URL = assetUrl("fullfog-icon.svg");
const EDIT_PAGE_URL = assetUrl("fullfog-edit.html");

let registered = false;
const watcherUnsubs: Array<() => void> = [];

// Track which local-scene wall ids we created for each shared path,
// alongside a `signature` derived from the inputs that influence
// wall geometry (commands + wallExpandPx + openings). When the
// signature changes we rebuild — keeps walls in sync with door
// toggles, expand-slider tweaks, etc., without burning a rebuild
// on every unrelated items.onChange tick.
interface WallEntry {
  ids: string[];
  signature: string;
}
const wallsByPath = new Map<string, WallEntry>();

async function syncLocalWalls(): Promise<void> {
  let sharedItems: Item[];
  try {
    sharedItems = await OBR.scene.items.getItems((it: Item) => {
      if (!isPath(it)) return false;
      const md = (it.metadata as any) ?? {};
      if (!md[FOG_PATH_KEY]) return false;
      // Only the outline Path drives walls. Legacy scenes may
      // still carry "darkFog-outer" / "darkFog-inner" overlay
      // Paths from the now-removed edge-feather feature — skip
      // them so we don't double-count walls (outer matches
      // outline; inner gives wrong, eroded wall geometry).
      const kind = md[FOG_PATH_KIND_KEY];
      if (kind === "darkFog-outer" || kind === "darkFog-inner") return false;
      return true;
    });
  } catch (e) {
    console.warn("[fullFog/watcher] getItems failed", e);
    return;
  }

  const desiredIds = new Set(sharedItems.map((p) => p.id));

  // Remove walls for paths that no longer exist or were unsaved.
  for (const [pathId, entry] of [...wallsByPath.entries()]) {
    if (!desiredIds.has(pathId)) {
      try { await OBR.scene.local.deleteItems(entry.ids); } catch {}
      wallsByPath.delete(pathId);
    }
  }

  // (Re)build walls for any path whose signature has changed (or
  // hasn't been built yet). We DERIVE the wall polylines from the
  // path's `commands` field (a top-level item field with a much
  // higher size limit than `metadata`) by sampling each cubic/quad
  // bezier into ~8 line segments. The path's coords are already in
  // MAP-LOCAL space (matching the wall convention), so no
  // reprojection is needed.
  for (const path of sharedItems) {
    const commands = (path as any).commands;
    if (!Array.isArray(commands) || commands.length === 0) continue;

    // Build a cheap signature of the inputs that influence wall
    // geometry. If unchanged from last sync, skip the rebuild.
    const md = (path.metadata as any) ?? {};
    const expandSig = String(md[FOG_WALL_EXPAND_KEY] ?? 0);
    const openingsRaw = Array.isArray(md[OPENINGS_KEY]) ? md[OPENINGS_KEY] : [];
    const openingsSig = JSON.stringify(
      openingsRaw.map((o: any) => [
        o.kind, !!o.open, o.polyIndex,
        Math.round(((o.t1 ?? 0) as number) * 10000),
        Math.round(((o.t2 ?? 0) as number) * 10000),
      ]),
    );
    const signature = `${commands.length}:${expandSig}:${openingsSig}`;
    const cached = wallsByPath.get(path.id);
    if (cached && cached.signature === signature) continue;
    if (cached) {
      try { await OBR.scene.local.deleteItems(cached.ids); } catch {}
      wallsByPath.delete(path.id);
    }

    const mapItemId = (path as any).attachedTo;
    if (!mapItemId) continue;
    let mapItem: any | null = null;
    try {
      const mapItems = await OBR.scene.items.getItems([mapItemId]);
      if (mapItems.length === 0) continue;
      mapItem = mapItems[0];
    } catch { continue; }

    const polylines = samplePathCommands(commands, 8);
    if (polylines.length === 0) continue;

    // Wall-expand. User-facing convention (matches the 中文 label
    // 「墙体外扩」):
    //   wallExpandPx > 0  →  polygon expands OUTWARD into the floor
    //                         side, i.e. the BLOCKING wall sits N
    //                         pixels OUTSIDE the visible edge. Player
    //                         vision stops before reaching the precise
    //                         wall boundary — fog hides the exact
    //                         wall outline.
    //   wallExpandPx < 0  →  polygon shrinks INWARD into the wall
    //                         material; vision passes the visible
    //                         edge and stops N pixels into the wall
    //                         — players see a sliver of wall texture.
    //   wallExpandPx = 0  →  Wall flush with the visible edge.
    //
    // Note `erodePolygon`'s own sign convention is the opposite (its
    // positive = inward erode), so we negate the value when handing
    // it off below.
    const expandImgPx = Number(md[FOG_WALL_EXPAND_KEY] ?? 0);
    let wallPolylines = polylines;
    if (Number.isFinite(expandImgPx) && expandImgPx !== 0) {
      // map-local distance per image pixel (matches the conversion
      // in imagePxToMapLocal: scene-dpi / image-grid-dpi).
      let sceneDpi = mapItem.grid?.dpi ?? 0;
      try { sceneDpi = await OBR.scene.grid.getDpi(); } catch {}
      const imgDpi = mapItem.grid?.dpi || sceneDpi;
      const ratio = imgDpi > 0 ? (sceneDpi / imgDpi) : 1;
      const expandLocal = expandImgPx * ratio;
      // samplePathCommands closes loops by appending the start
      // vertex; safeWallOffset expects N distinct vertices, so strip
      // that duplicate before offsetting and re-append after.
      const stripped: typeof polylines = polylines.map((p) => {
        if (p.length >= 3) {
          const first = p[0], last = p[p.length - 1];
          if (Math.abs(first.x - last.x) < 1e-6 &&
              Math.abs(first.y - last.y) < 1e-6) {
            return p.slice(0, -1);
          }
        }
        return p;
      });
      const offset = safeWallOffset(stripped, expandLocal, ratio);
      wallPolylines = offset.map((p) =>
        (p.length >= 1 ? [...p, { x: p[0].x, y: p[0].y }] : p),
      );
    }
    if (wallPolylines.length === 0) continue;

    // Doors / windows: subtract see-through openings (open doors +
    // all windows) from the polylines BEFORE turning them into Walls.
    // Closed doors stay as walls; open doors / windows split the
    // polyline so vision raycasting passes through the gap.
    const openings: Opening[] = Array.isArray(md[OPENINGS_KEY])
      ? md[OPENINGS_KEY]
      : [];
    let finalPolylines = wallPolylines;
    if (openings.length > 0) {
      const split: typeof wallPolylines = [];
      for (let pi = 0; pi < wallPolylines.length; pi++) {
        const ops = openings.filter((o) => o.polyIndex === pi);
        if (ops.length === 0) {
          split.push(wallPolylines[pi]);
          continue;
        }
        const pieces = splitPolylineByOpenings(wallPolylines[pi], ops);
        for (const p of pieces) split.push(p);
      }
      finalPolylines = split;
    }
    if (finalPolylines.length === 0) continue;

    const walls = buildFogWalls(finalPolylines, mapItem);
    if (walls.length === 0) continue;
    try {
      await OBR.scene.local.addItems(walls);
      wallsByPath.set(path.id, {
        ids: walls.map((w: any) => w.id),
        signature,
      });
    } catch (e) {
      console.warn("[fullFog/watcher] add walls failed for path", path.id, e);
    }
  }
}

let syncQueued = false;
function scheduleWallSync(): void {
  if (syncQueued) return;
  syncQueued = true;
  // Microtask + 50ms debounce — items.onChange fires multiple times
  // during a save (delete old + add new). Coalesce so we sync once.
  setTimeout(() => {
    syncQueued = false;
    void syncLocalWalls();
  }, 50);
}

async function openEditor(mapItemId: string): Promise<void> {
  try { await OBR.modal.close(MODAL_ID); } catch {}
  const url = `${EDIT_PAGE_URL}?id=${encodeURIComponent(mapItemId)}`;
  try {
    await OBR.modal.open({
      id: MODAL_ID,
      url,
      fullScreen: true,
      hidePaper: true,
    });
  } catch (e) {
    console.error("[fullFog] open editor failed", e);
  }
}

export async function setupFullFog(): Promise<void> {
  if (registered) return;
  let role: "GM" | "PLAYER" = "PLAYER";
  try { role = (await OBR.player.getRole()) as "GM" | "PLAYER"; } catch {}

  // GM gets the editor entry; ALL clients run the wall watcher so
  // every player's local scene gets the OBR-native walls (which
  // drive their per-client dynamic fog rendering).
  if (role === "GM") {
    try {
      await OBR.contextMenu.create({
        id: CTX_EDIT_FOG,
        icons: [{
          icon: ICON_URL,
          label: "编辑地图迷雾",
          filter: {
            every: [
              { key: "type", value: "IMAGE" },
              { key: "layer", value: "MAP" },
            ],
            max: 1,
          },
        }],
        onClick: async (ctx) => {
          if (ctx.items.length > 0) await openEditor(ctx.items[0].id);
        },
      });
    } catch (e) {
      console.warn("[fullFog] contextMenu.create failed", e);
    }
  }

  // Initial wall sync + change subscription.
  watcherUnsubs.push(
    OBR.scene.items.onChange(() => scheduleWallSync()),
  );
  // Scene-ready cycle: when the GM swaps maps, local items are
  // wiped — re-sync from shared paths.
  try {
    watcherUnsubs.push(
      OBR.scene.onReadyChange((ready) => {
        wallsByPath.clear();
        if (ready) scheduleWallSync();
      }),
    );
  } catch {}
  // Kick off an initial sync (idempotent).
  scheduleWallSync();

  // Light subsystem — 添加光源 / 光源设置 / 移除光源 context menu
  // + a watcher that mirrors any token tagged with LIGHT_KEY into a
  // native OBR `Light` item via `buildLight()` in scene.local. The
  // native Light items integrate with OBR's fog/visibility renderer
  // automatically, so filling fog via the OBR fog tool now produces
  // proper illumination + wall-clipping (matches the upstream
  // dynamic-fog plugin's behaviour).
  await setupLight();

  // Door / window tool modes (under OBR's native fog tool) +
  // per-client overlay watcher that paints red/green/blue
  // indicators along the openings the GM has placed.
  await setupFullFogDoor();

  registered = true;
}

export async function teardownFullFog(): Promise<void> {
  if (!registered) return;
  try { await OBR.contextMenu.remove(CTX_EDIT_FOG); } catch {}
  for (const u of watcherUnsubs.splice(0)) {
    try { u(); } catch {}
  }
  // Best-effort cleanup of local walls we created.
  const allIds: string[] = [];
  for (const entry of wallsByPath.values()) allIds.push(...entry.ids);
  if (allIds.length > 0) {
    try { await OBR.scene.local.deleteItems(allIds); } catch {}
  }
  wallsByPath.clear();
  await teardownLight();
  await teardownFullFogDoor();
  registered = false;
}

void PLUGIN_ID;
