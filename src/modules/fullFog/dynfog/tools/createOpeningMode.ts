// 门 / 窗 / 密门 modes under Owlbear's fog tool (GM only).
//
// Behaviour matches upstream's door tool:
//   hover  → an orange dot marks where on the wall you'd start
//   drag   → an orange preview traces the stretch of wall you're carving
//   release→ the opening is written to that drawing's metadata
//   click  → toggle an existing opening open/closed
//   alt-click / double-click → delete it
//   click a light billboard → select that light
//
// Three differences from upstream, all deliberate:
//   1. Snapping searches every fog drawing rather than requiring the
//      pointer to be over `event.target` — see `snap.ts`.
//   2. A WINDOW mode. A window never blocks vision, open or shut, so
//      its toggle carries only the "can a creature pass" half.
//   3. A SECRET DOOR mode. Identical to a door for vision, but its
//      indicator is never built on a player's client and the GM-side
//      toggle listener refuses player requests against one.

import OBR, {
  buildPath,
  buildShape,
  Command,
  isPath,
  type Item,
  type PathCommand,
  type ToolEvent,
  type Vector2,
} from "@owlbear-rodeo/sdk";
import { getLocalLang } from "../../../../state";
import type { Reconciler } from "../reconcile/Reconciler";
import { OpeningReactor } from "../reconcile/reactors/OpeningReactor";
import { subPolyline } from "../geom/polyline";
import { findWallSnap, type WallSnap } from "./snap";
import { ICON_DOOR, ICON_SECRET, ICON_WINDOW } from "../overlayAssets";
import {
  COLOR_CONTROL,
  DOOR_MODE_ID,
  LIGHT_OVERLAY_KEY,
  OBR_FOG_TOOL,
  OVERLAY_OPENING_KEY,
  SECRET_MODE_ID,
  WINDOW_MODE_ID,
} from "../ids";
import {
  defaultOpenState,
  newOpeningId,
  type OpeningKind,
} from "../opening/types";
import { addOpening, deleteOpening, toggleOpening } from "../opening/mutate";

/** Local control items currently on screen for one mode. */
interface Controls {
  startDot: string | null;
  endDot: string | null;
  preview: string | null;
}

interface DragState {
  parentId: string;
  polyIndex: number;
  startT: number;
  endT: number;
}

function createControlPoint(position: Vector2) {
  return buildShape()
    .position(position)
    .width(24)
    .height(24)
    .shapeType("CIRCLE")
    .fillColor(COLOR_CONTROL)
    .strokeColor(COLOR_CONTROL)
    .layer("CONTROL")
    .disableHit(true)
    .build();
}

function polylineToCommands(points: Vector2[]): PathCommand[] {
  const out: PathCommand[] = [];
  if (points.length === 0) return out;
  out.push([Command.MOVE, points[0].x, points[0].y]);
  for (let i = 1; i < points.length; i++) {
    out.push([Command.LINE, points[i].x, points[i].y]);
  }
  return out;
}

function createPreview(parent: Item, commands: PathCommand[]) {
  return buildPath()
    .commands(commands)
    .position(parent.position)
    .rotation(parent.rotation)
    .scale(parent.scale)
    .fillOpacity(0)
    .strokeWidth(Math.max(8, (parent as any).style?.strokeWidth ?? 0))
    .strokeColor(COLOR_CONTROL)
    .layer("CONTROL")
    .disableHit(true)
    .build();
}

/** The opening (if any) an overlay item belongs to. */
function overlayTarget(target?: Item): { itemId: string; openingId: string } | null {
  if (!target || !target.attachedTo) return null;
  const openingId = (target.metadata as Record<string, unknown> | undefined)?.[
    OVERLAY_OPENING_KEY
  ];
  if (typeof openingId !== "string") return null;
  return { itemId: target.attachedTo, openingId };
}

function lightTarget(target?: Item): string | null {
  if (!target || !target.attachedTo) return null;
  const flag = (target.metadata as Record<string, unknown> | undefined)?.[
    LIGHT_OVERLAY_KEY
  ];
  return flag ? target.attachedTo : null;
}

// Both modes share this state. Only one tool mode can be active at a
// time, and sharing it means either mode's onActivate clears anything
// the other left behind — a safety net for the case where Owlbear
// doesn't deliver onDeactivate (switching tools rather than modes).
const controls: Controls = { startDot: null, endDot: null, preview: null };
let hover: WallSnap | null = null;
let drag: DragState | null = null;
// Pointer events arrive far faster than a local-scene round trip.
// Without these, two in-flight updates can each decide the indicator
// does not exist yet and add a second one that nothing owns.
let hoverBusy = false;
let dragBusy = false;

async function clearControls() {
  const ids = [controls.startDot, controls.endDot, controls.preview].filter(
    (v): v is string => Boolean(v),
  );
  controls.startDot = null;
  controls.endDot = null;
  controls.preview = null;
  hover = null;
  drag = null;
  if (ids.length > 0) {
    try {
      await OBR.scene.local.deleteItems(ids);
    } catch {}
  }
}

/** Per-kind toolbar identity. Shortcuts O / I / U don't collide with
 *  the suite's other tools (Shift+A, CapsLock, K, BracketRight); O is
 *  upstream dynamic-fog's door shortcut. */
const MODE_SPEC: Record<
  OpeningKind,
  (en: boolean) => { id: string; label: string; icon: string; shortcut: string }
> = {
  door: (en) => ({
    id: DOOR_MODE_ID,
    label: en ? "Door" : "门",
    icon: ICON_DOOR,
    shortcut: "O",
  }),
  window: (en) => ({
    id: WINDOW_MODE_ID,
    label: en ? "Window" : "窗户",
    icon: ICON_WINDOW,
    shortcut: "I",
  }),
  secret: (en) => ({
    id: SECRET_MODE_ID,
    label: en ? "Secret door" : "密门",
    icon: ICON_SECRET,
    shortcut: "U",
  }),
};

export function createOpeningMode(
  reconciler: Reconciler,
  kind: OpeningKind,
): Promise<void> {
  const en = getLocalLang() === "en";
  const { id, label, icon, shortcut } = MODE_SPEC[kind](en);

  /** Sub-polyline between two t values on the drag target, in the
   *  parent's local space. */
  function dragPreviewPoints(state: DragState): Vector2[] | null {
    const reactor = reconciler.find(OpeningReactor);
    const actor = reactor?.getActor(state.parentId);
    const poly = actor?.polylines[state.polyIndex];
    if (!poly) return null;
    const t1 = Math.min(state.startT, state.endT);
    const t2 = Math.max(state.startT, state.endT);
    const points = subPolyline(poly, t1, t2);
    return points.length >= 2 ? points : null;
  }

  async function updateHoverDot(event: ToolEvent) {
    const snap = findWallSnap(reconciler, event.pointerPosition);
    hover = snap;
    if (!snap) {
      if (controls.startDot) {
        const id = controls.startDot;
        controls.startDot = null;
        try {
          await OBR.scene.local.deleteItems([id]);
        } catch {}
      }
      return;
    }
    if (controls.startDot) {
      const id = controls.startDot;
      try {
        await OBR.scene.local.updateItems(
          [id],
          (items) => {
            for (const item of items) item.position = snap.world;
          },
          true,
        );
      } catch {}
    } else {
      const dot = createControlPoint(snap.world);
      controls.startDot = dot.id;
      try {
        await OBR.scene.local.addItems([dot]);
      } catch {
        controls.startDot = null;
      }
    }
  }

  return OBR.tool.createMode({
    id,
    icons: [
      {
        icon,
        label,
        filter: { activeTools: [OBR_FOG_TOOL], roles: ["GM"] },
      },
    ],

    async onToolClick(_, event) {
      const overlay = overlayTarget(event.target);
      if (overlay) {
        if (event.altKey) {
          await deleteOpening(overlay.itemId, overlay.openingId);
        } else {
          await toggleOpening(overlay.itemId, overlay.openingId);
        }
        return;
      }
      const light = lightTarget(event.target);
      if (light) {
        try {
          await OBR.player.select([light], true);
        } catch {}
      }
    },

    async onToolDoubleClick(_, event) {
      const overlay = overlayTarget(event.target);
      if (overlay) await deleteOpening(overlay.itemId, overlay.openingId);
    },

    async onToolMove(_, event) {
      if (drag || hoverBusy) return;
      hoverBusy = true;
      try {
        await updateHoverDot(event);
      } finally {
        hoverBusy = false;
      }
    },

    async onToolDragStart(_, event) {
      hoverBusy = true;
      try {
        await updateHoverDot(event);
      } finally {
        hoverBusy = false;
      }
      const snap = hover;
      if (!snap) return;

      drag = {
        parentId: snap.parentId,
        polyIndex: snap.polyIndex,
        startT: snap.t,
        endT: snap.t,
      };

      const endDot = createControlPoint(snap.world);
      controls.endDot = endDot.id;
      const points = dragPreviewPoints(drag);
      const preview = createPreview(
        snap.parent,
        points ? polylineToCommands(points) : [],
      );
      controls.preview = preview.id;
      try {
        await OBR.scene.local.addItems([preview, endDot]);
      } catch {
        controls.endDot = null;
        controls.preview = null;
      }
    },

    async onToolDragMove(_, event) {
      if (!drag || dragBusy) return;
      // Stay on the contour the drag started on — an opening can't
      // straddle two contours, same rule as upstream.
      const snap = findWallSnap(
        reconciler,
        event.pointerPosition,
        Number.POSITIVE_INFINITY,
        drag.parentId,
      );
      if (!snap || snap.polyIndex !== drag.polyIndex) return;
      drag.endT = snap.t;

      const points = dragPreviewPoints(drag);
      const ids = [controls.endDot, controls.preview].filter(
        (v): v is string => Boolean(v),
      );
      if (ids.length === 0) return;
      dragBusy = true;
      try {
        await OBR.scene.local.updateItems(
          ids,
          (items) => {
            for (const item of items) {
              if (item.id === controls.endDot) {
                item.position = snap.world;
              } else if (item.id === controls.preview && isPath(item) && points) {
                item.commands = polylineToCommands(points);
              }
            }
          },
          true,
        );
      } catch {
      } finally {
        dragBusy = false;
      }
    },

    async onToolDragEnd() {
      const state = drag;
      await clearControls();
      if (!state) return;
      const t1 = Math.min(state.startT, state.endT);
      const t2 = Math.max(state.startT, state.endT);
      // Reject a click-sized drag: a zero-length opening carves nothing
      // and just litters the metadata.
      if (t2 - t1 < 1e-4) return;
      await addOpening(state.parentId, {
        id: newOpeningId(),
        kind,
        open: defaultOpenState(kind),
        polyIndex: state.polyIndex,
        t1,
        t2,
      });
    },

    async onToolDragCancel() {
      await clearControls();
    },

    async onActivate() {
      // Clears anything the other mode left behind.
      await clearControls();
    },

    async onDeactivate() {
      await clearControls();
    },

    cursors: [
      {
        cursor: "pointer",
        filter: {
          target: [
            {
              key: ["metadata", OVERLAY_OPENING_KEY],
              value: undefined,
              operator: "!=",
              coordinator: "||",
            },
            {
              key: ["metadata", LIGHT_OVERLAY_KEY],
              value: undefined,
              operator: "!=",
            },
          ],
        },
      },
      { cursor: "crosshair", filter: {} },
    ],

    shortcut,
  });
}

export async function removeOpeningModes(): Promise<void> {
  for (const id of [DOOR_MODE_ID, WINDOW_MODE_ID, SECRET_MODE_ID]) {
    try {
      await OBR.tool.removeMode(id);
    } catch {}
  }
}
