// fullFog/door — door + window opening tools.
//
// Two tool modes registered under OBR's native fog tool:
//   - 门 (door): drag along a wall → adds a closed door entry on the
//     parent outline Path's `openings[]` metadata. Click the
//     resulting red line to toggle open/closed; double-click or
//     alt-click to delete.
//   - 窗 (window): same drag UI → adds a window entry. Always
//     see-through. Double-click or alt-click to delete.
//
// State lives on the parent outline Path's metadata, so it
// survives reloads and propagates across clients via OBR's normal
// item-sync. The wall watcher in fullFog/index.ts subtracts open
// doors + windows from the polylines used to derive Wall items, so
// vision raycasting passes through them automatically. Closed
// doors keep their wall segment.
//
// Visual overlays (red/green/blue lines + a clickable centre Shape)
// live in scene.local — they're built by a lightweight reactor
// here, not by any kind of native OBR fog primitive, so the colour
// rules are 100% under our control.

import OBR, {
  buildBillboard,
  buildPath,
  buildShape,
  Command,
  isPath,
  type Item,
  type Vector2,
  type ToolEvent,
} from "@owlbear-rodeo/sdk";
import { assetUrl } from "../../../asset-base";
import {
  PLUGIN_ID,
  FOG_PATH_KEY,
  type Vec2,
} from "../types";
import { FOG_PATH_KIND_KEY } from "../output/obrPath";
import { samplePathCommands } from "../output/samplePath";
import {
  DOOR_MODE_ID,
  WINDOW_MODE_ID,
  OPENINGS_KEY,
  OVERLAY_KEY,
  OVERLAY_OPENING_ID_KEY,
  OVERLAY_PARENT_KEY,
  SNAP_THRESHOLD,
  COLOR_DOOR_CLOSED,
  COLOR_DOOR_OPEN,
  COLOR_WINDOW,
  COLOR_HOVER_DOT,
  type Opening,
  type OpeningKind,
} from "./types";
import {
  snapToPolylines,
  subPolyline,
  worldToMapLocal,
  mapLocalToWorld,
  type SnapHit,
} from "./geometry";

const DOOR_ICON_URL = assetUrl("fullfog-door-icon.svg");
const WINDOW_ICON_URL = assetUrl("fullfog-window-icon.svg");

// Billboard images — must include explicit width/height/mime, OBR's
// buildBillboard won't probe the SVG. 80×80 matches the official
// dynamic-fog billboards we copied from.
const DOOR_CLOSED_IMAGE = {
  url: assetUrl("fullfog-door-closed.svg"),
  width: 80, height: 80, mime: "image/svg+xml",
};
const DOOR_OPEN_IMAGE = {
  url: assetUrl("fullfog-door-open.svg"),
  width: 80, height: 80, mime: "image/svg+xml",
};
const WINDOW_IMAGE = {
  url: assetUrl("fullfog-window-billboard.svg"),
  width: 80, height: 80, mime: "image/svg+xml",
};

// Cache of (pathId → polylines + parent map item) populated lazily
// during a drag. Cleared each drag so we always work with fresh
// geometry.
interface PathSample {
  pathItem: Item;
  mapItem: any;
  polylines: Vec2[][];
}
let dragSampleCache: Map<string, PathSample> | null = null;

// Hover state — populated by onToolMove BEFORE drag starts; renders
// an orange dot on the wall at the snap point. Cleared on drag start
// (replaced by drag state's start indicator) and on tool deactivate.
interface HoverState {
  pathId: string;
  hit: SnapHit;
  /** Local item id of the orange dot (Shape circle). */
  dotId: string;
}
let hoverState: HoverState | null = null;

interface DragState {
  kind: OpeningKind;
  pathId: string;
  polyIndex: number;
  startT: number;
  endT: number;
  startWorld: Vector2;
  endWorld: Vector2;
  /** Local item id of the start orange dot (kept fixed at drag-start position). */
  startDotId: string | null;
  /** Local item id of the end orange dot (tracks pointer). */
  endDotId: string | null;
  /** Local item id of the dashed sub-path along the wall. */
  previewId: string | null;
}
let dragState: DragState | null = null;

let registered = false;
const cleanups: Array<() => Promise<void> | void> = [];

// path id → array of local item ids representing its current overlays.
const overlayItemsByPath = new Map<string, string[]>();

// ---------------------------------------------------------------------------
// Outline-path helpers

async function getAllOutlinePaths(): Promise<Item[]> {
  try {
    return await OBR.scene.items.getItems((it: Item) => {
      if (!isPath(it)) return false;
      const md = (it.metadata as any) ?? {};
      if (!md[FOG_PATH_KEY]) return false;
      const kind = md[FOG_PATH_KIND_KEY];
      if (kind && kind !== "outline") return false;
      return true;
    });
  } catch {
    return [];
  }
}

async function buildSampleCache(): Promise<Map<string, PathSample>> {
  const cache = new Map<string, PathSample>();
  const paths = await getAllOutlinePaths();
  // Group by attachedTo so we only fetch each map item once.
  const mapIds = Array.from(
    new Set(paths.map((p) => (p as any).attachedTo).filter(Boolean)),
  );
  let mapItems: Item[] = [];
  if (mapIds.length > 0) {
    try {
      mapItems = await OBR.scene.items.getItems(mapIds as string[]);
    } catch {}
  }
  const mapById = new Map(mapItems.map((m) => [m.id, m]));
  for (const p of paths) {
    const cmds = (p as any).commands;
    if (!Array.isArray(cmds) || cmds.length === 0) continue;
    const mapId = (p as any).attachedTo;
    if (!mapId) continue;
    const mapItem = mapById.get(mapId);
    if (!mapItem) continue;
    const polylines = samplePathCommands(cmds, 8);
    cache.set(p.id, { pathItem: p, mapItem, polylines });
  }
  return cache;
}

/** Find the closest snap hit across all outline Paths to the given
 *  world-coord pointer position. Returns null if nothing's within
 *  SNAP_THRESHOLD. */
function snapAcrossAllPaths(
  pointerWorld: Vector2,
  cache: Map<string, PathSample>,
): { pathId: string; mapItem: any; hit: SnapHit } | null {
  let best: { pathId: string; mapItem: any; hit: SnapHit } | null = null;
  for (const [pathId, sample] of cache) {
    const local = worldToMapLocal(pointerWorld, sample.mapItem);
    const hit = snapToPolylines(local, sample.polylines);
    if (!hit) continue;
    if (!best || hit.distance < best.hit.distance) {
      best = { pathId, mapItem: sample.mapItem, hit };
    }
  }
  if (!best || best.hit.distance > SNAP_THRESHOLD) return null;
  return best;
}

// ---------------------------------------------------------------------------
// Drag preview — builds a Path item in scene.local that follows the
// dragged sub-polyline.

function colourFor(kind: OpeningKind, open: boolean): string {
  if (kind === "window") return COLOR_WINDOW;
  return open ? COLOR_DOOR_OPEN : COLOR_DOOR_CLOSED;
}

/** Whether a tool event's target is a previously-placed opening
 *  overlay (billboard or backup hit handle). When true, the door /
 *  window mode should NOT show a hover snap-dot or start a fresh
 *  draw — clicking that item should toggle / delete the opening. */
function isOpeningOverlayTarget(target: Item | undefined | null): boolean {
  if (!target) return false;
  const md = (target.metadata as any) ?? {};
  return !!md[OVERLAY_PARENT_KEY] && !!md[OVERLAY_OPENING_ID_KEY];
}

function imageFor(kind: OpeningKind, open: boolean) {
  if (kind === "window") return WINDOW_IMAGE;
  return open ? DOOR_OPEN_IMAGE : DOOR_CLOSED_IMAGE;
}

/** Build an orange-dot Shape (matches official's createControlPoint).
 *  Used for both the hover snap indicator and drag start/end dots. */
function buildSnapDot(worldPos: Vector2): any {
  return buildShape()
    .position(worldPos)
    .width(24)
    .height(24)
    .shapeType("CIRCLE")
    .fillColor(COLOR_HOVER_DOT)
    .fillOpacity(1)
    .strokeColor(COLOR_HOVER_DOT)
    .strokeOpacity(1)
    .strokeWidth(0)
    .layer("CONTROL")
    .disableHit(true)
    .locked(true)
    .build();
}

function buildOverlayPath(
  pathItem: Item,
  pts: Vec2[],
  colour: string,
  meta: Record<string, any>,
): any {
  const cmds: any[] = [];
  if (pts.length >= 2) {
    cmds.push([Command.MOVE, pts[0].x, pts[0].y]);
    for (let i = 1; i < pts.length; i++) {
      cmds.push([Command.LINE, pts[i].x, pts[i].y]);
    }
  }
  const mapId = (pathItem as any).attachedTo;
  return buildPath()
    .commands(cmds)
    .strokeColor(colour)
    .strokeOpacity(1)
    .strokeWidth(8)
    .fillOpacity(0)
    .layer("CONTROL")
    .position((pathItem as any).position ?? { x: 0, y: 0 })
    .rotation((pathItem as any).rotation ?? 0)
    .scale((pathItem as any).scale ?? { x: 1, y: 1 })
    .attachedTo(mapId)
    .disableAttachmentBehavior(["VISIBLE", "COPY"])
    .disableHit(true)
    .locked(true)
    .metadata(meta)
    .build();
}

/** Build the clickable billboard at the centre of an opening. The
 *  billboard's image swaps based on door open/closed; window uses a
 *  third image. Position is computed by converting the polyline
 *  midpoint (map-local) to WORLD coords — billboards must be in
 *  world space, not map-local. */
function buildOverlayBillboard(
  pathItem: Item,
  midLocal: Vec2,
  mapItem: any,
  kind: OpeningKind,
  open: boolean,
  meta: Record<string, any>,
): any {
  const mapId = (pathItem as any).attachedTo;
  const worldPos = mapLocalToWorld(midLocal, mapItem);
  const image = imageFor(kind, open);
  return buildBillboard(image, {
    dpi: 300,
    offset: { x: 40, y: 40 },
  })
    .position(worldPos)
    .attachedTo(mapId)
    .disableAttachmentBehavior(["SCALE", "VISIBLE", "COPY"])
    .maxViewScale(2)
    .locked(true)
    // Explicit CONTROL layer so the icon renders ABOVE the FOG layer
    // (where our outline Path lives) and clicks land on it during
    // the door tool's onToolClick — billboards default-render above
    // FOG but the explicit layer guarantees it across SDK versions.
    .layer("CONTROL")
    .metadata(meta)
    .build();
}

/** Backup hit-target — a small invisible Shape circle on CONTROL
 *  layer carrying the SAME metadata as the billboard. Reason: in
 *  some OBR builds Billboards don't deliver `event.target` to a
 *  custom tool's onToolClick handler (the click registers but
 *  target.id resolves to the parent attached item instead). The
 *  Shape circle reliably catches the click even when the billboard
 *  doesn't. Both items target the SAME (parent, openingId) pair, so
 *  the toggle/delete logic works whichever fires first. */
function buildOverlayHandle(
  pathItem: Item,
  midLocal: Vec2,
  meta: Record<string, any>,
): any {
  const mapId = (pathItem as any).attachedTo;
  return buildShape()
    .shapeType("CIRCLE")
    .width(40)
    .height(40)
    .position(midLocal)
    .strokeOpacity(0)
    .strokeWidth(0)
    .fillColor("#000000")
    .fillOpacity(0)
    .layer("CONTROL")
    .attachedTo(mapId)
    .disableAttachmentBehavior(["VISIBLE", "COPY"])
    .locked(true)
    .metadata(meta)
    .build();
}

async function clearHover(): Promise<void> {
  if (hoverState) {
    try { await OBR.scene.local.deleteItems([hoverState.dotId]); } catch {}
    hoverState = null;
  }
}

async function clearDragVisuals(): Promise<void> {
  if (!dragState) return;
  const ids: string[] = [];
  if (dragState.startDotId) ids.push(dragState.startDotId);
  if (dragState.endDotId) ids.push(dragState.endDotId);
  if (dragState.previewId) ids.push(dragState.previewId);
  if (ids.length > 0) {
    try { await OBR.scene.local.deleteItems(ids); } catch {}
  }
  dragState.startDotId = null;
  dragState.endDotId = null;
  dragState.previewId = null;
}

/** Show / update the orange hover dot at the nearest snap point on
 *  any outline path. Caches the polyline samples per move so we don't
 *  re-fetch the scene on every pointer event. Returns the resolved
 *  snap hit (or null if nothing within threshold). */
async function updateHoverDot(pointerWorld: Vector2): Promise<{
  pathId: string;
  hit: SnapHit;
} | null> {
  if (!dragSampleCache) {
    dragSampleCache = await buildSampleCache();
  }
  const snap = snapAcrossAllPaths(pointerWorld, dragSampleCache);
  if (!snap) {
    await clearHover();
    return null;
  }
  // Snap is in MAP-LOCAL coords; convert back to world for the dot.
  const worldPos = mapLocalToWorld(snap.hit.point, snap.mapItem);
  if (hoverState && hoverState.pathId === snap.pathId) {
    try {
      await OBR.scene.local.updateItems([hoverState.dotId], (drafts) => {
        for (const d of drafts) {
          (d as any).position = worldPos;
        }
      });
      hoverState.hit = snap.hit;
      return snap;
    } catch {}
  }
  await clearHover();
  const dot = buildSnapDot(worldPos);
  hoverState = { pathId: snap.pathId, hit: snap.hit, dotId: dot.id };
  try { await OBR.scene.local.addItems([dot]); } catch {}
  return snap;
}

/** Update the dashed sub-path preview that follows the wall geometry
 *  between drag start and current end. Also updates / creates the
 *  end orange dot at the snap point. */
async function refreshPreview(): Promise<void> {
  if (!dragState || !dragSampleCache) return;
  const sample = dragSampleCache.get(dragState.pathId);
  if (!sample) return;
  const poly = sample.polylines[dragState.polyIndex];
  if (!poly) return;
  const t1 = Math.min(dragState.startT, dragState.endT);
  const t2 = Math.max(dragState.startT, dragState.endT);
  const sub = subPolyline(poly, t1, t2);
  const colour = colourFor(dragState.kind, false);
  const meta = { [`${PLUGIN_ID}/openingPreview`]: true };

  // Update / create the end orange dot at the current snap point.
  const endLocal = poly.length > 0
    ? subPolyline(poly, t2, Math.min(1, t2 + 1e-6))[0] ?? null
    : null;
  // Simpler: compute end point by interpolating along the polyline at t2.
  const endPoint = sub.length > 0 ? sub[sub.length - 1] : null;
  const endWorld = endPoint
    ? mapLocalToWorld(endPoint, sample.mapItem)
    : dragState.endWorld;
  if (dragState.endDotId) {
    try {
      await OBR.scene.local.updateItems([dragState.endDotId], (drafts) => {
        for (const d of drafts) {
          (d as any).position = endWorld;
        }
      });
    } catch {}
  } else {
    const dot = buildSnapDot(endWorld);
    dragState.endDotId = dot.id;
    try { await OBR.scene.local.addItems([dot]); } catch {}
  }
  void endLocal;

  if (sub.length < 2) {
    if (dragState.previewId) {
      try { await OBR.scene.local.deleteItems([dragState.previewId]); } catch {}
      dragState.previewId = null;
    }
    return;
  }
  if (dragState.previewId) {
    try {
      await OBR.scene.local.updateItems([dragState.previewId], (drafts) => {
        for (const d of drafts) {
          if (!isPath(d)) continue;
          const cmds: any[] = [
            [Command.MOVE, sub[0].x, sub[0].y],
            ...sub.slice(1).map((p) => [Command.LINE, p.x, p.y]),
          ];
          (d as any).commands = cmds;
          (d as any).style.strokeColor = colour;
        }
      });
    } catch {}
    return;
  }
  const item = buildOverlayPath(sample.pathItem, sub, colour, meta);
  dragState.previewId = item.id;
  try { await OBR.scene.local.addItems([item]); } catch {}
}

// ---------------------------------------------------------------------------
// Persisted-overlay watcher: rebuilds local overlay items whenever
// the outline Paths' openings metadata changes.

async function syncOverlays(): Promise<void> {
  const paths = await getAllOutlinePaths();
  // Group polyline cache for efficiency.
  const cache = new Map<string, PathSample>();
  const mapIds = Array.from(
    new Set(paths.map((p) => (p as any).attachedTo).filter(Boolean)),
  );
  let mapItems: Item[] = [];
  if (mapIds.length > 0) {
    try { mapItems = await OBR.scene.items.getItems(mapIds as string[]); } catch {}
  }
  const mapById = new Map(mapItems.map((m) => [m.id, m]));

  const desiredIds = new Set(paths.map((p) => p.id));
  // Drop overlays for paths that have disappeared.
  for (const [pid, ids] of [...overlayItemsByPath.entries()]) {
    if (!desiredIds.has(pid)) {
      try { await OBR.scene.local.deleteItems(ids); } catch {}
      overlayItemsByPath.delete(pid);
    }
  }

  for (const path of paths) {
    const cmds = (path as any).commands;
    if (!Array.isArray(cmds) || cmds.length === 0) continue;
    const mapId = (path as any).attachedTo;
    if (!mapId) continue;
    const mapItem = mapById.get(mapId);
    if (!mapItem) continue;
    cache.set(path.id, {
      pathItem: path,
      mapItem,
      polylines: samplePathCommands(cmds, 8),
    });

    const md = (path.metadata as any) ?? {};
    const openings: Opening[] = Array.isArray(md[OPENINGS_KEY])
      ? md[OPENINGS_KEY]
      : [];

    // Drop existing overlay items for this path; rebuild from scratch
    // (cheap — at most a few dozen openings per path in practice).
    const prevIds = overlayItemsByPath.get(path.id) ?? [];
    if (prevIds.length > 0) {
      try { await OBR.scene.local.deleteItems(prevIds); } catch {}
    }
    overlayItemsByPath.delete(path.id);

    if (openings.length === 0) continue;
    const newItems: any[] = [];
    const sample = cache.get(path.id)!;
    for (const op of openings) {
      const poly = sample.polylines[op.polyIndex];
      if (!poly) continue;
      const t1 = Math.min(op.t1, op.t2);
      const t2 = Math.max(op.t1, op.t2);
      const sub = subPolyline(poly, t1, t2);
      if (sub.length < 2) continue;
      const colour = colourFor(op.kind, op.open);
      const overlayMeta = {
        [OVERLAY_KEY]: path.id,
        [OVERLAY_OPENING_ID_KEY]: op.id,
        [OVERLAY_PARENT_KEY]: path.id,
      };
      newItems.push(buildOverlayPath(path, sub, colour, overlayMeta));
      const midIdx = Math.floor(sub.length / 2);
      const midPt = sub[midIdx];
      newItems.push(
        buildOverlayBillboard(path, midPt, sample.mapItem, op.kind, op.open, overlayMeta),
      );
      // Backup invisible click target — see buildOverlayHandle.
      newItems.push(buildOverlayHandle(path, midPt, overlayMeta));
    }
    if (newItems.length > 0) {
      try { await OBR.scene.local.addItems(newItems); } catch {}
      overlayItemsByPath.set(path.id, newItems.map((i) => i.id));
    }
  }
}

let syncQueued = false;
function scheduleOverlaySync(): void {
  if (syncQueued) return;
  syncQueued = true;
  setTimeout(() => {
    syncQueued = false;
    void syncOverlays();
  }, 60);
}

// ---------------------------------------------------------------------------
// Tool mode handlers

async function tryToggleOrDelete(
  event: ToolEvent,
  mode: "click" | "double",
  kindFilter: OpeningKind | null,
): Promise<boolean> {
  const target = event.target;
  if (!target) return false;
  const md = (target.metadata as any) ?? {};
  const parentId = md[OVERLAY_PARENT_KEY];
  const openingId = md[OVERLAY_OPENING_ID_KEY];
  if (!parentId || !openingId) return false;

  const items = await OBR.scene.items.getItems([parentId]);
  const parent = items[0];
  if (!parent) return false;
  const pmd = (parent.metadata as any) ?? {};
  const openings: Opening[] = Array.isArray(pmd[OPENINGS_KEY])
    ? pmd[OPENINGS_KEY]
    : [];
  const idx = openings.findIndex((o) => o.id === openingId);
  if (idx < 0) return false;
  const opening = openings[idx];
  if (kindFilter && opening.kind !== kindFilter) return false;

  const altDelete = event.altKey === true;
  const wantDelete = mode === "double" || altDelete || opening.kind === "window";

  await OBR.scene.items.updateItems([parentId], (drafts) => {
    for (const d of drafts) {
      const dm = (d.metadata as any) ?? {};
      const list: Opening[] = Array.isArray(dm[OPENINGS_KEY])
        ? dm[OPENINGS_KEY]
        : [];
      const i = list.findIndex((o) => o.id === openingId);
      if (i < 0) continue;
      if (wantDelete) {
        list.splice(i, 1);
      } else {
        // Door click → toggle open.
        list[i] = { ...list[i], open: !list[i].open };
      }
      (d.metadata as any)[OPENINGS_KEY] = list;
    }
  });
  return true;
}

function makeUUID(): string {
  if (typeof crypto !== "undefined" && (crypto as any).randomUUID) {
    return (crypto as any).randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

async function dragStart(kind: OpeningKind, event: ToolEvent): Promise<void> {
  // Clear any prior drag visuals + hover dot — we'll synthesise a
  // fresh start dot at the snapped position.
  if (dragState) await clearDragVisuals();
  dragState = null;
  await clearHover();

  if (!dragSampleCache) {
    dragSampleCache = await buildSampleCache();
  }
  const snap = snapAcrossAllPaths(event.pointerPosition, dragSampleCache);
  if (!snap) return;
  const sample = dragSampleCache.get(snap.pathId);
  if (!sample) return;
  const startWorld = mapLocalToWorld(snap.hit.point, sample.mapItem);
  dragState = {
    kind,
    pathId: snap.pathId,
    polyIndex: snap.hit.polyIndex,
    startT: snap.hit.t,
    endT: snap.hit.t,
    startWorld,
    endWorld: startWorld,
    startDotId: null,
    endDotId: null,
    previewId: null,
  };
  // Place the START orange dot at the snap point — sticks there for
  // the whole drag while the END dot tracks the pointer.
  const startDot = buildSnapDot(startWorld);
  dragState.startDotId = startDot.id;
  try { await OBR.scene.local.addItems([startDot]); } catch {}
}

async function dragMove(event: ToolEvent): Promise<void> {
  if (!dragState || !dragSampleCache) return;
  const sample = dragSampleCache.get(dragState.pathId);
  if (!sample) return;
  const local = worldToMapLocal(event.pointerPosition, sample.mapItem);
  // Re-snap onto SAME polyline only (lock to the polyline picked at
  // drag start so the user can't accidentally jump to a neighbour).
  const poly = sample.polylines[dragState.polyIndex];
  if (!poly) return;
  const hit = snapToPolylines(local, [poly]);
  if (!hit) return;
  dragState.endT = hit.t;
  dragState.endWorld = event.pointerPosition;
  await refreshPreview();
}

async function dragEnd(): Promise<void> {
  if (!dragState) return;
  const ds = dragState;
  await clearDragVisuals();
  dragState = null;
  if (Math.abs(ds.startT - ds.endT) < 1e-3) return;
  const opening: Opening = {
    id: makeUUID(),
    kind: ds.kind,
    open: false,
    polyIndex: ds.polyIndex,
    t1: Math.min(ds.startT, ds.endT),
    t2: Math.max(ds.startT, ds.endT),
  };
  try {
    await OBR.scene.items.updateItems([ds.pathId], (drafts) => {
      for (const d of drafts) {
        const dm = (d.metadata as any) ?? {};
        const list: Opening[] = Array.isArray(dm[OPENINGS_KEY])
          ? dm[OPENINGS_KEY]
          : [];
        list.push(opening);
        (d.metadata as any)[OPENINGS_KEY] = list;
      }
    });
  } catch (e) {
    console.warn("[fullFog/door] persist opening failed", e);
  }
}

async function dragCancel(): Promise<void> {
  await clearDragVisuals();
  dragState = null;
  await clearHover();
}

// ---------------------------------------------------------------------------
// Setup / teardown

export async function setupFullFogDoor(): Promise<void> {
  if (registered) return;
  let role: "GM" | "PLAYER" = "PLAYER";
  try { role = (await OBR.player.getRole()) as "GM" | "PLAYER"; } catch {}

  // Tool modes — GM only. Players don't see the door / window mode
  // icons, but they STILL run the overlay watcher so they see the
  // green/red/blue indicator lines GMs have placed.
  if (role === "GM") {
    try {
      await OBR.tool.createMode({
        id: DOOR_MODE_ID,
        icons: [
          {
            icon: DOOR_ICON_URL,
            label: "门",
            filter: { activeTools: ["rodeo.owlbear.tool/fog"] },
          },
        ],
        // Cursor changes to a clickable pointer when over an existing
        // opening (billboard / backup hit handle), crosshair elsewhere.
        // Filter form mirrors the official dynamic-fog door tool.
        cursors: [
          {
            cursor: "POINTER",
            filter: {
              target: [{
                key: ["metadata", OVERLAY_PARENT_KEY],
                value: undefined,
                operator: "!=",
              }],
            },
          },
          { cursor: "CROSSHAIR" },
        ],
        async onToolClick(_, event) {
          await tryToggleOrDelete(event, "click", "door");
        },
        async onToolDoubleClick(_, event) {
          await tryToggleOrDelete(event, "double", "door");
        },
        async onToolMove(_, event) {
          if (dragState) return;
          // Hovering an existing opening — let the user know it's
          // clickable, hide the snap dot so it isn't visually
          // ambiguous with the draw flow.
          if (isOpeningOverlayTarget(event.target as Item | undefined)) {
            await clearHover();
            return;
          }
          await updateHoverDot(event.pointerPosition);
        },
        async onToolDragStart(_, event) {
          // Drag-start that originates ON an existing opening should
          // route to its click handler instead of starting a new
          // draw. Without this guard, accidentally drag-clicking the
          // billboard would draw an unwanted line over the wall.
          if (isOpeningOverlayTarget(event.target as Item | undefined)) {
            return;
          }
          await dragStart("door", event);
        },
        async onToolDragMove(_, event) { await dragMove(event); },
        async onToolDragEnd() { await dragEnd(); },
        async onToolDragCancel() { await dragCancel(); },
        async onDeactivate() {
          await dragCancel();
          await clearHover();
          dragSampleCache = null;
        },
      });
      cleanups.push(async () => {
        try { await OBR.tool.removeMode(DOOR_MODE_ID); } catch {}
      });
    } catch (e) {
      console.warn("[fullFog/door] register door mode failed", e);
    }

    try {
      await OBR.tool.createMode({
        id: WINDOW_MODE_ID,
        icons: [
          {
            icon: WINDOW_ICON_URL,
            label: "窗",
            filter: { activeTools: ["rodeo.owlbear.tool/fog"] },
          },
        ],
        cursors: [
          {
            cursor: "POINTER",
            filter: {
              target: [{
                key: ["metadata", OVERLAY_PARENT_KEY],
                value: undefined,
                operator: "!=",
              }],
            },
          },
          { cursor: "CROSSHAIR" },
        ],
        async onToolClick(_, event) {
          await tryToggleOrDelete(event, "click", "window");
        },
        async onToolDoubleClick(_, event) {
          await tryToggleOrDelete(event, "double", "window");
        },
        async onToolMove(_, event) {
          if (dragState) return;
          if (isOpeningOverlayTarget(event.target as Item | undefined)) {
            await clearHover();
            return;
          }
          await updateHoverDot(event.pointerPosition);
        },
        async onToolDragStart(_, event) {
          if (isOpeningOverlayTarget(event.target as Item | undefined)) {
            return;
          }
          await dragStart("window", event);
        },
        async onToolDragMove(_, event) { await dragMove(event); },
        async onToolDragEnd() { await dragEnd(); },
        async onToolDragCancel() { await dragCancel(); },
        async onDeactivate() {
          await dragCancel();
          await clearHover();
          dragSampleCache = null;
        },
      });
      cleanups.push(async () => {
        try { await OBR.tool.removeMode(WINDOW_MODE_ID); } catch {}
      });
    } catch (e) {
      console.warn("[fullFog/door] register window mode failed", e);
    }
  }

  // Overlay watcher — runs on every client.
  const off = OBR.scene.items.onChange(() => scheduleOverlaySync());
  cleanups.push(off);
  try {
    const offReady = OBR.scene.onReadyChange((ready) => {
      overlayItemsByPath.clear();
      if (ready) scheduleOverlaySync();
    });
    cleanups.push(offReady);
  } catch {}
  scheduleOverlaySync();

  registered = true;
}

export async function teardownFullFogDoor(): Promise<void> {
  if (!registered) return;
  await dragCancel();
  for (const c of cleanups.splice(0)) {
    try { await c(); } catch {}
  }
  // Best-effort cleanup of overlay items we created.
  const allIds: string[] = [];
  for (const ids of overlayItemsByPath.values()) allIds.push(...ids);
  if (allIds.length > 0) {
    try { await OBR.scene.local.deleteItems(allIds); } catch {}
  }
  overlayItemsByPath.clear();
  registered = false;
}

void PLUGIN_ID;
