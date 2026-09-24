// Renders the REAL wall-derivation output to an SVG, so the engine can
// be eyeballed without an Owlbear session.
//
// Everything drawn here comes from `drawingToPolylines` +
// `deriveWallPolylines` — the same functions the WallActor calls. If a
// door doesn't open in the picture, it doesn't open in the game.
//
// Run: `node tools/dynfog-visual.mjs [out.svg]`

import { Command, type Path, type Shape } from "@owlbear-rodeo/sdk";
import { drawingToPolylines } from "./geom/drawing";
import { deriveWallPolylines } from "./geom/wallGeometry";
import { pointAtT, subPolyline } from "./geom/polyline";
import { bboxOf, type Cut } from "./geom/cut";
import type { Opening } from "./opening/types";
import {
  COLOR_DOOR_CLOSED,
  COLOR_DOOR_OPEN,
  COLOR_SECRET_CLOSED,
  COLOR_SECRET_OPEN,
  COLOR_WINDOW_CLOSED,
  COLOR_WINDOW_OPEN,
} from "./ids";

interface Vec {
  x: number;
  y: number;
}

function item(overrides: Record<string, unknown>): any {
  return {
    id: "x",
    type: "SHAPE",
    name: "x",
    visible: true,
    locked: false,
    createdUserId: "u",
    zIndex: 0,
    lastModified: new Date(0).toISOString(),
    lastModifiedUserId: "u",
    position: { x: 0, y: 0 },
    rotation: 0,
    scale: { x: 1, y: 1 },
    metadata: {},
    layer: "FOG",
    style: {
      fillColor: "#000",
      fillOpacity: 0,
      strokeColor: "#000",
      strokeOpacity: 1,
      strokeWidth: 8,
      strokeDash: [],
    },
    ...overrides,
  };
}

function rect(width: number, height: number, at: Vec): Shape {
  return item({
    shapeType: "RECTANGLE",
    width,
    height,
    position: at,
  }) as Shape;
}

function poly(points: Vec[], at: Vec = { x: 0, y: 0 }): Path {
  const commands: any[] = [[Command.MOVE, points[0].x, points[0].y]];
  for (let i = 1; i < points.length; i++) {
    commands.push([Command.LINE, points[i].x, points[i].y]);
  }
  return item({ type: "PATH", fillRule: "evenodd", commands, position: at }) as Path;
}

function opening(over: Partial<Opening>): Opening {
  return {
    id: "o",
    kind: "door",
    open: false,
    polyIndex: 0,
    t1: 0,
    t2: 0.1,
    ...over,
  };
}

function openingColor(o: Opening): string {
  if (o.kind === "window") {
    return o.open ? COLOR_WINDOW_OPEN : COLOR_WINDOW_CLOSED;
  }
  if (o.kind === "secret") {
    return o.open ? COLOR_SECRET_OPEN : COLOR_SECRET_CLOSED;
  }
  return o.open ? COLOR_DOOR_OPEN : COLOR_DOOR_CLOSED;
}

function path(points: Vec[], offset: Vec): string {
  return points
    .map(
      (p, i) =>
        `${i === 0 ? "M" : "L"}${(p.x + offset.x).toFixed(2)} ${(
          p.y + offset.y
        ).toFixed(2)}`,
    )
    .join(" ");
}

interface Panel {
  title: string;
  note: string;
  /** Drawn faintly: the fog shape as the GM sees it. */
  outline: Vec[][];
  /** Drawn solid: what actually blocks vision. */
  walls: Vec[][];
  /** Indicator stripes. */
  markers: { points: Vec[]; color: string }[];
}

function buildPanels(): Panel[] {
  const panels: Panel[] = [];
  const origin = { x: 0, y: 0 };

  // 1 — every opening kind at once, in the state that best shows what
  //     it does to the wall.
  {
    const room = rect(200, 140, origin);
    const contours = drawingToPolylines(room);
    const openings: Opening[] = [
      opening({ id: "closed", kind: "door", open: false, t1: 0.04, t2: 0.12 }),
      opening({ id: "open", kind: "door", open: true, t1: 0.28, t2: 0.36 }),
      // Shut, and STILL a gap: that is the whole point of a window.
      opening({ id: "win", kind: "window", open: false, t1: 0.52, t2: 0.6 }),
      opening({ id: "secret", kind: "secret", open: false, t1: 0.76, t2: 0.84 }),
    ];
    const walls = deriveWallPolylines({
      polylines: contours,
      openings,
      foreignCuts: [],
    });
    panels.push({
      title: "All four opening kinds on one fog rectangle",
      note: "shut door + shut secret door keep their wall · open door and SHUT window both cut a gap",
      outline: contours,
      walls,
      markers: openings.map((o) => ({
        points: subPolyline(
          contours[o.polyIndex],
          Math.min(o.t1, o.t2),
          Math.max(o.t1, o.t2),
        ),
        color: openingColor(o),
      })),
    });
  }

  // 2 — two overlapping rooms sharing a wall, one door drawn on the
  //     left room. Upstream gets the cross-shape cut from Skia path
  //     ops; we reproduce it with a world-space capsule.
  {
    const left = rect(160, 140, origin);
    const right = rect(160, 140, { x: 160, y: 0 });
    const leftContours = drawingToPolylines(left);
    const rightContours = drawingToPolylines(right);

    // The shared wall is the left room's right edge, i.e. x = 160.
    const door = opening({
      id: "shared",
      kind: "door",
      open: true,
      polyIndex: 0,
      t1: 160 / 600 + 0.05,
      t2: 160 / 600 + 0.14,
    });

    const cutLocal = subPolyline(leftContours[0], door.t1, door.t2);
    const cutWorld = cutLocal.map((p) => ({ x: p.x, y: p.y }));
    const cut: Cut = {
      openingId: door.id,
      parentId: "left",
      points: cutWorld,
      radius: 14,
      bbox: bboxOf(cutWorld, 14),
    };

    const leftWalls = deriveWallPolylines({
      polylines: leftContours,
      openings: [door],
      foreignCuts: [],
    });
    // The right room sees the door as a FOREIGN cut, expressed in its
    // own local space (it sits 160 to the right).
    const foreign: Cut = {
      ...cut,
      points: cutWorld.map((p) => ({ x: p.x - 160, y: p.y })),
      bbox: bboxOf(
        cutWorld.map((p) => ({ x: p.x - 160, y: p.y })),
        14,
      ),
    };
    const rightWalls = deriveWallPolylines({
      polylines: rightContours,
      openings: [],
      foreignCuts: [foreign],
    });

    panels.push({
      title: "A door on a shared wall opens BOTH overlapping rooms",
      note: "left room owns the door · right room loses the same stretch",
      outline: [
        ...leftContours,
        ...rightContours.map((c) => c.map((p) => ({ x: p.x + 160, y: p.y }))),
      ],
      walls: [
        ...leftWalls,
        ...rightWalls.map((c) => c.map((p) => ({ x: p.x + 160, y: p.y }))),
      ],
      markers: [{ points: cutLocal, color: COLOR_DOOR_OPEN }],
    });
  }

  // 3 — an L-shaped corridor drawn as a Path, with a door mid-run and
  //     the wall-expand offset applied.
  {
    const shape = poly(
      [
        { x: 0, y: 0 },
        { x: 220, y: 0 },
        { x: 220, y: 60 },
        { x: 80, y: 60 },
        { x: 80, y: 150 },
        { x: 0, y: 150 },
        { x: 0, y: 0 },
      ],
      origin,
    );
    const contours = drawingToPolylines(shape);
    const door = opening({ id: "mid", kind: "door", open: true, t1: 0.2, t2: 0.28 });
    const walls = deriveWallPolylines({
      polylines: contours,
      openings: [door],
      foreignCuts: [],
      expandLocal: 6,
      expandMinPx: 1,
    });
    panels.push({
      title: "Wall-expand keeps the door where it was drawn",
      note: "faint = drawn outline · solid = blocking wall offset 6px inward",
      outline: contours,
      walls,
      markers: [
        {
          points: subPolyline(contours[0], door.t1, door.t2),
          color: COLOR_DOOR_OPEN,
        },
      ],
    });
  }

  // 4 — a freehand Curve, to prove tensioned strokes derive walls too.
  {
    const curve = item({
      type: "CURVE",
      points: [
        { x: 10, y: 120 },
        { x: 70, y: 20 },
        { x: 150, y: 130 },
        { x: 220, y: 30 },
      ],
      style: {
        fillColor: "#000",
        fillOpacity: 0,
        strokeColor: "#000",
        strokeOpacity: 1,
        strokeWidth: 8,
        strokeDash: [],
        tension: 0.5,
        closed: false,
      },
    });
    const contours = drawingToPolylines(curve);
    const win = opening({ id: "w", kind: "window", open: false, t1: 0.4, t2: 0.55 });
    const walls = deriveWallPolylines({
      polylines: contours,
      openings: [win],
      foreignCuts: [],
    });
    panels.push({
      title: "Freehand curve walls, with a shut window in the middle",
      note: "cardinal spline sampled the same way Owlbear renders it — the window is see-through shut",
      outline: contours,
      walls,
      markers: [
        {
          points: subPolyline(contours[0], win.t1, win.t2),
          color: COLOR_WINDOW_CLOSED,
        },
      ],
    });
  }

  return panels;
}

const PANEL_W = 380;
const PANEL_H = 250;
const COLS = 2;

export function renderDynfogSvg(): string {
  const panels = buildPanels();
  const rows = Math.ceil(panels.length / COLS);
  const width = COLS * PANEL_W;
  const height = rows * PANEL_H + 44;

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="ui-sans-serif, system-ui, sans-serif">`,
  );
  parts.push(`<rect width="${width}" height="${height}" fill="#14161c"/>`);
  parts.push(
    `<text x="16" y="28" fill="#e6e8ee" font-size="15" font-weight="600">dynfog — wall derivation output</text>`,
  );
  parts.push(
    `<text x="${width - 16}" y="28" fill="#7d8494" font-size="11" text-anchor="end">faint = drawn fog · white = vision-blocking wall · coloured = opening indicator</text>`,
  );

  panels.forEach((panel, index) => {
    const col = index % COLS;
    const row = Math.floor(index / COLS);
    const ox = col * PANEL_W + 26;
    const oy = row * PANEL_H + 76;

    parts.push(
      `<text x="${col * PANEL_W + 16}" y="${row * PANEL_H + 60}" fill="#f5a623" font-size="12" font-weight="600">${index + 1}. ${panel.title}</text>`,
    );
    parts.push(
      `<text x="${col * PANEL_W + 16}" y="${row * PANEL_H + 74}" fill="#7d8494" font-size="10">${panel.note}</text>`,
    );

    for (const contour of panel.outline) {
      parts.push(
        `<path d="${path(contour, { x: ox, y: oy })}" fill="none" stroke="#3b4150" stroke-width="1" stroke-dasharray="3 3"/>`,
      );
    }
    for (const marker of panel.markers) {
      if (marker.points.length < 2) continue;
      parts.push(
        `<path d="${path(marker.points, { x: ox, y: oy })}" fill="none" stroke="${marker.color}" stroke-width="7" stroke-linecap="round" opacity="0.9"/>`,
      );
    }
    for (const wall of panel.walls) {
      parts.push(
        `<path d="${path(wall, { x: ox, y: oy })}" fill="none" stroke="#ffffff" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>`,
      );
    }
    const wallCount = panel.walls.length;
    parts.push(
      `<text x="${col * PANEL_W + 16}" y="${row * PANEL_H + PANEL_H + 52}" fill="#5b6373" font-size="10">${wallCount} wall segment${wallCount === 1 ? "" : "s"}</text>`,
    );
  });

  parts.push("</svg>");
  return parts.join("\n");
}

/** Midpoint of an opening, exported for callers that want to annotate. */
export function openingMidpoint(
  contour: Vec[],
  o: Opening,
): Vec | null {
  return pointAtT(contour, (o.t1 + o.t2) / 2);
}
