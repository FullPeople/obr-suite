// Geometry self-test for the dynfog engine.
//
// The wall/door maths is pure and deterministic, so it can be checked
// without a running Owlbear session. `tools/dynfog-selftest.mjs`
// bundles this with rolldown and runs it under node; it also runs in a
// browser console via `runDynfogSelfTest()`.
//
// Worth keeping honest: every opening in every existing scene is
// addressed in the arc-length space these functions define. A silent
// change here moves doors.

import { Command, type Curve, type Line, type Path, type Shape } from "@owlbear-rodeo/sdk";
import { commandsToPolylines, drawingToPolylines } from "./geom/drawing";
import { cardinalSplineToCommands } from "./geom/cardinal";
import {
  pointAtT,
  polylineLength,
  remapT,
  snapToPolyline,
  snapToPolylines,
  splitPolylineByRanges,
  subPolyline,
} from "./geom/polyline";
import { bboxOf, cutRangesForPolyline, type Cut } from "./geom/cut";
import { deriveWallPolylines, expandContours } from "./geom/wallGeometry";
import { safeWallOffset } from "../output/wallOffset";
import {
  WallGrid,
  isSafeLandingPointExhaustive,
  landingCellSize,
  type WallSegment as PortalWall,
} from "../../portals/landing";
import {
  close as morphClose,
  dilate as morphDilate,
  erode as morphErode,
  open as morphOpen,
  _morphologyReference,
} from "../refinement/morphology";
import { readOpenings } from "./opening/read";
import { WallIndex } from "./light/wallIndex";
import {
  inverseTransformPoint,
  inverseTransformPoints,
  itemMatrix,
} from "./geom/xform";
import {
  blocksVision,
  playerOperable,
  playerVisible,
  type Opening,
  type OpeningKind,
} from "./opening/types";

export interface TestResult {
  name: string;
  ok: boolean;
  detail: string;
}

const results: TestResult[] = [];

function check(name: string, ok: boolean, detail = ""): void {
  results.push({ name, ok, detail });
}

function near(a: number, b: number, tol = 1e-6): boolean {
  return Math.abs(a - b) <= tol;
}

function baseItem(overrides: Record<string, unknown> = {}): any {
  return {
    id: "test",
    type: "SHAPE",
    name: "test",
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
    ...overrides,
  };
}

function rectShape(width: number, height: number): Shape {
  return baseItem({
    type: "SHAPE",
    shapeType: "RECTANGLE",
    width,
    height,
    style: {
      fillColor: "#000",
      fillOpacity: 0,
      strokeColor: "#000",
      strokeOpacity: 1,
      strokeWidth: 10,
      strokeDash: [],
    },
  }) as Shape;
}

export function runDynfogSelfTest(): TestResult[] {
  results.length = 0;

  // --- contour derivation ---------------------------------------------------

  {
    const polys = drawingToPolylines(rectShape(100, 60));
    const poly = polys[0] ?? [];
    check(
      "rectangle → one closed contour of 5 points",
      polys.length === 1 && poly.length === 5,
      `contours=${polys.length} points=${poly.length}`,
    );
    check(
      "rectangle perimeter = 2(w+h)",
      near(polylineLength(poly), 320, 1e-9),
      `${polylineLength(poly)}`,
    );
    check(
      "rectangle closes back on its origin",
      poly.length === 5 &&
        near(poly[0].x, poly[4].x) &&
        near(poly[0].y, poly[4].y),
      "",
    );
  }

  {
    // The same rectangle expressed as a Path must give the SAME
    // arc-length space — this is what lets the fog editor's traced
    // outline and a hand-drawn shape share one door model.
    const path = baseItem({
      type: "PATH",
      fillRule: "evenodd",
      commands: [
        [Command.MOVE, 0, 0],
        [Command.LINE, 100, 0],
        [Command.LINE, 100, 60],
        [Command.LINE, 0, 60],
        [Command.CLOSE],
      ],
      style: {
        fillColor: "#000",
        fillOpacity: 0,
        strokeColor: "#000",
        strokeOpacity: 1,
        strokeWidth: 10,
        strokeDash: [],
      },
    }) as Path;
    const poly = drawingToPolylines(path)[0] ?? [];
    check(
      "path rectangle matches shape rectangle",
      poly.length === 5 && near(polylineLength(poly), 320, 1e-9),
      `points=${poly.length} len=${polylineLength(poly)}`,
    );
  }

  {
    const line = baseItem({
      type: "LINE",
      startPosition: { x: 0, y: 0 },
      endPosition: { x: 30, y: 40 },
      style: {
        strokeColor: "#000",
        strokeOpacity: 1,
        strokeWidth: 8,
        strokeDash: [],
      },
    }) as Line;
    const poly = drawingToPolylines(line)[0] ?? [];
    check(
      "line → 2 points, length 50",
      poly.length === 2 && near(polylineLength(poly), 50, 1e-9),
      `points=${poly.length} len=${polylineLength(poly)}`,
    );
  }

  {
    const circle = baseItem({
      type: "SHAPE",
      shapeType: "CIRCLE",
      width: 200,
      height: 200,
      style: {
        fillColor: "#000",
        fillOpacity: 0,
        strokeColor: "#000",
        strokeOpacity: 1,
        strokeWidth: 10,
        strokeDash: [],
      },
    }) as Shape;
    const poly = drawingToPolylines(circle)[0] ?? [];
    const perimeter = polylineLength(poly);
    const exact = 2 * Math.PI * 100;
    check(
      "circle perimeter within 0.5% of 2πr",
      Math.abs(perimeter - exact) / exact < 0.005,
      `${perimeter.toFixed(2)} vs ${exact.toFixed(2)}`,
    );
  }

  {
    const curve = baseItem({
      type: "CURVE",
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ],
      style: {
        fillColor: "#000",
        fillOpacity: 0,
        strokeColor: "#000",
        strokeOpacity: 1,
        strokeWidth: 10,
        strokeDash: [],
        tension: 0,
        closed: true,
      },
    }) as Curve;
    const poly = drawingToPolylines(curve)[0] ?? [];
    check(
      "closed zero-tension curve → polygon through its points",
      poly.length === 5 && near(polylineLength(poly), 400, 1e-9),
      `points=${poly.length} len=${polylineLength(poly)}`,
    );

    const smooth = cardinalSplineToCommands(curve.points, 0.5, true);
    check(
      "tensioned spline emits cubic segments and closes",
      smooth.some((c) => c[0] === Command.CUBIC) &&
        smooth[smooth.length - 1][0] === Command.CLOSE,
      `commands=${smooth.length}`,
    );
    const smoothPoly = commandsToPolylines(smooth)[0] ?? [];
    check(
      "tensioned spline samples into a closed contour",
      smoothPoly.length > 5 &&
        near(smoothPoly[0].x, smoothPoly[smoothPoly.length - 1].x, 1e-6),
      `points=${smoothPoly.length}`,
    );
  }

  // --- arc-length addressing ------------------------------------------------

  {
    const poly = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];
    const hit = snapToPolyline({ x: 25, y: 17 }, poly);
    check(
      "snap projects onto the segment and reports t",
      !!hit && near(hit.t, 0.25, 1e-9) && near(hit.distance, 17, 1e-9),
      hit ? `t=${hit.t} d=${hit.distance}` : "no hit",
    );
    const mid = pointAtT(poly, 0.5);
    check(
      "pointAtT walks arc length",
      !!mid && near(mid.x, 50) && near(mid.y, 0),
      mid ? `${mid.x},${mid.y}` : "null",
    );
    const sub = subPolyline(poly, 0.25, 0.75);
    check(
      "subPolyline extracts the requested stretch",
      sub.length === 2 && near(polylineLength(sub), 50, 1e-9),
      `len=${polylineLength(sub)}`,
    );
  }

  {
    // A door carved out of one wall of a 100×60 rectangle. The
    // rectangle's perimeter is 320, so a 40-unit door is t-width 0.125.
    const poly = drawingToPolylines(rectShape(100, 60))[0] ?? [];
    const pieces = splitPolylineByRanges(poly, [{ t1: 0.1, t2: 0.225 }]);
    const total = pieces.reduce((sum, p) => sum + polylineLength(p), 0);
    check(
      "open door removes exactly its stretch of wall",
      pieces.length === 2 && near(total, 320 - 40, 1e-6),
      `pieces=${pieces.length} remaining=${total}`,
    );
  }

  {
    const poly = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];
    const pieces = splitPolylineByRanges(poly, [
      { t1: 0.2, t2: 0.4 },
      { t1: 0.35, t2: 0.5 },
    ]);
    const total = pieces.reduce((sum, p) => sum + polylineLength(p), 0);
    check(
      "overlapping openings merge instead of double-cutting",
      pieces.length === 2 && near(total, 70, 1e-6),
      `pieces=${pieces.length} remaining=${total}`,
    );
  }

  {
    const poly = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];
    const shifted = poly.map((p) => ({ x: p.x, y: p.y + 5 }));
    check(
      "remapT survives a pure translation",
      near(remapT(poly, shifted, 0.3), 0.3, 1e-6),
      `${remapT(poly, shifted, 0.3)}`,
    );
    check(
      "remapT falls back when vertex counts differ",
      near(remapT(poly, [...shifted, { x: 200, y: 5 }], 0.3), 0.3, 1e-9),
      "",
    );
  }

  // --- cross-drawing cuts ---------------------------------------------------

  {
    // A wall along y=0 and a door owned by a DIFFERENT drawing sitting
    // across it at x≈50 with radius 15 — the overlapping-fog-shapes case
    // upstream gets from Skia path ops.
    const wall = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];
    const cutPoints = [
      { x: 50, y: -20 },
      { x: 50, y: 20 },
    ];
    const cut: Cut = {
      openingId: "o",
      parentId: "other",
      points: cutPoints,
      radius: 15,
      bbox: bboxOf(cutPoints, 15),
    };
    const ranges = cutRangesForPolyline(wall, [cut]);
    const pieces = splitPolylineByRanges(wall, ranges);
    const total = pieces.reduce((sum, p) => sum + polylineLength(p), 0);
    check(
      "a door on an overlapping shape cuts this wall too",
      ranges.length === 1 && pieces.length === 2 && Math.abs(total - 70) < 1.0,
      `ranges=${ranges.length} pieces=${pieces.length} remaining=${total.toFixed(2)}`,
    );

    const far: Cut = {
      openingId: "o2",
      parentId: "other",
      points: [
        { x: 500, y: -20 },
        { x: 500, y: 20 },
      ],
      radius: 15,
      bbox: bboxOf(
        [
          { x: 500, y: -20 },
          { x: 500, y: 20 },
        ],
        15,
      ),
    };
    check(
      "a distant door leaves the wall alone",
      cutRangesForPolyline(wall, [far]).length === 0,
      "",
    );
  }

  // --- full wall derivation -------------------------------------------------

  const rectPolys = drawingToPolylines(rectShape(100, 60));
  const door = (over: Partial<Opening> = {}): Opening => ({
    id: "d",
    kind: "door",
    open: false,
    polyIndex: 0,
    t1: 0.1,
    t2: 0.225,
    ...over,
  });

  {
    const walls = deriveWallPolylines({
      polylines: rectPolys,
      openings: [door()],
      foreignCuts: [],
    });
    const total = walls.reduce((sum, p) => sum + polylineLength(p), 0);
    check(
      "a CLOSED door leaves the wall whole",
      walls.length === 1 && near(total, 320, 1e-6),
      `pieces=${walls.length} len=${total}`,
    );
  }

  {
    const walls = deriveWallPolylines({
      polylines: rectPolys,
      openings: [door({ open: true })],
      foreignCuts: [],
    });
    const total = walls.reduce((sum, p) => sum + polylineLength(p), 0);
    check(
      "an OPEN door punches a hole in the wall",
      walls.length === 2 && near(total, 280, 1e-6),
      `pieces=${walls.length} len=${total}`,
    );
  }

  {
    // A window is glass: shut or open, you can see through it. Both
    // states must punch the same hole in the wall — the open/shut flag
    // says whether a creature can pass, which Owlbear cannot express.
    const openWindow = deriveWallPolylines({
      polylines: rectPolys,
      openings: [door({ kind: "window", open: true })],
      foreignCuts: [],
    });
    const shutWindow = deriveWallPolylines({
      polylines: rectPolys,
      openings: [door({ kind: "window", open: false })],
      foreignCuts: [],
    });
    const openLen = openWindow.reduce((s, p) => s + polylineLength(p), 0);
    const shutLen = shutWindow.reduce((s, p) => s + polylineLength(p), 0);
    check(
      "a window is see-through in BOTH states",
      openWindow.length === 2 &&
        shutWindow.length === 2 &&
        near(openLen, shutLen, 1e-9) &&
        near(openLen, 280, 1e-6),
      `open=${openWindow.length}/${openLen} shut=${shutWindow.length}/${shutLen}`,
    );
  }

  {
    // A secret door is a door for every geometric purpose. What makes
    // it secret lives in the overlay + the GM-side toggle listener,
    // not here.
    const shut = deriveWallPolylines({
      polylines: rectPolys,
      openings: [door({ kind: "secret", open: false })],
      foreignCuts: [],
    });
    const ajar = deriveWallPolylines({
      polylines: rectPolys,
      openings: [door({ kind: "secret", open: true })],
      foreignCuts: [],
    });
    check(
      "a secret door blocks like a door when shut and opens like one",
      shut.length === 1 && ajar.length === 2,
      `shut=${shut.length} ajar=${ajar.length}`,
    );
  }

  {
    // The three predicates that encode the whole table in
    // opening/types.ts, asserted directly so a future refactor of the
    // geometry can't quietly change the rules.
    const cases: Array<[OpeningKind, boolean, boolean, boolean, boolean]> = [
      // kind, open, blocksVision, playerVisible, playerOperable
      //
      // The last column is the one worth staring at: a player SEES a
      // window but cannot work it, because a window is see-through in
      // both states and the toggle would do nothing they could observe.
      ["door", false, true, true, true],
      ["door", true, false, true, true],
      ["secret", false, true, false, false],
      ["secret", true, false, false, false],
      ["window", false, false, true, false],
      ["window", true, false, true, false],
    ];
    let ok = true;
    let detail = "";
    for (const [kind, open, wantBlock, wantVisible, wantOperable] of cases) {
      const o = door({ kind, open });
      if (
        blocksVision(o) !== wantBlock ||
        playerVisible(o) !== wantVisible ||
        playerOperable(o) !== wantOperable
      ) {
        ok = false;
        detail += ` ${kind}/${open}`;
      }
    }
    check("opening semantics table holds", ok, detail);

    // Nothing a player can operate may be invisible to them, or they
    // would be clicking a button that isn't there.
    const consistent = cases.every(
      ([kind, open]) => {
        const o = door({ kind, open });
        return !playerOperable(o) || playerVisible(o);
      },
    );
    check("player-operable implies player-visible", consistent);
  }

  {
    // 墙体外扩: the visible outline stays put, the blocking wall moves.
    // Vertex counts must survive so remapT can carry the door across.
    const expanded = expandContours(rectPolys, 5, 1);
    check(
      "wall-expand preserves vertex counts and closure",
      expanded.length === rectPolys.length &&
        expanded[0].length === rectPolys[0].length &&
        near(expanded[0][0].x, expanded[0][expanded[0].length - 1].x) &&
        near(expanded[0][0].y, expanded[0][expanded[0].length - 1].y),
      `${expanded[0]?.length} vs ${rectPolys[0]?.length}`,
    );
    const perimeter = polylineLength(expanded[0]);
    check(
      "wall-expand actually moves the contour",
      Math.abs(perimeter - 320) > 1,
      `perimeter=${perimeter.toFixed(2)}`,
    );

    const walls = deriveWallPolylines({
      polylines: rectPolys,
      openings: [door({ open: true })],
      foreignCuts: [],
      expandLocal: 5,
      expandMinPx: 1,
    });
    const total = walls.reduce((sum, p) => sum + polylineLength(p), 0);
    const gap = perimeter - total;
    check(
      "the door gap survives wall-expand at roughly its drawn width",
      walls.length === 2 && Math.abs(gap - 40) < 6,
      `pieces=${walls.length} gap=${gap.toFixed(2)}`,
    );
  }

  {
    // WallActor memoises the (O(n²)) offset and hands it back in, so a
    // door toggled elsewhere in the scene doesn't re-offset the map.
    // The cached path must land on exactly the same walls.
    const args = {
      polylines: rectPolys,
      openings: [door({ open: true })],
      foreignCuts: [],
      expandLocal: 5,
      expandMinPx: 1,
    };
    const fresh = deriveWallPolylines(args);
    const cached = deriveWallPolylines({
      ...args,
      expanded: expandContours(rectPolys, 5, 1),
    });
    check(
      "pre-computed wall-expand matches computing it inline",
      JSON.stringify(fresh) === JSON.stringify(cached),
      `${fresh.length} vs ${cached.length} pieces`,
    );
  }

  {
    // Two overlapping rooms sharing a wall along y=0: a door drawn on
    // room A must also open room B's wall.
    const roomB = [
      { x: -20, y: 0 },
      { x: 120, y: 0 },
    ];
    const cutPoints = [
      { x: 40, y: 0 },
      { x: 60, y: 0 },
    ];
    const cut: Cut = {
      openingId: "shared",
      parentId: "roomA",
      points: cutPoints,
      radius: 12,
      bbox: bboxOf(cutPoints, 12),
    };
    const walls = deriveWallPolylines({
      polylines: [roomB],
      openings: [],
      foreignCuts: [cut],
    });
    check(
      "a shared-wall door opens the overlapping room too",
      walls.length === 2,
      `pieces=${walls.length}`,
    );
  }

  // --- metadata reading -----------------------------------------------------

  {
    const item = baseItem({
      metadata: {
        "com.obr-suite/fullFog/openings": [
          {
            id: "a",
            kind: "window",
            open: true,
            polyIndex: 0,
            t1: 0.1,
            t2: 0.2,
          },
          { kind: "door", open: false, polyIndex: 0, t1: 0.5, t2: 0.6 },
          { kind: "door", open: false, polyIndex: "nope", t1: 0, t2: 1 },
        ],
      },
    });
    const openings = readOpenings(item);
    check(
      "openings read, malformed entries dropped, missing ids synthesised",
      openings.length === 2 &&
        openings[0].kind === "window" &&
        openings[1].id === "legacy-1",
      JSON.stringify(openings.map((o) => o.id)),
    );
  }

  {
    // Upstream shape: absolute arc length on a contour of length 320.
    const item = baseItem({
      metadata: {
        "rodeo.owlbear.dynamic-fog/doors": [
          {
            open: true,
            start: { distance: 32, index: 0 },
            end: { distance: 64, index: 0 },
          },
        ],
      },
    });
    const poly = drawingToPolylines(rectShape(100, 60))[0] ?? [];
    const openings = readOpenings(item, [poly]);
    check(
      "upstream dynamic-fog doors convert to normalised t",
      openings.length === 1 &&
        near(openings[0].t1, 0.1, 1e-9) &&
        near(openings[0].t2, 0.2, 1e-9) &&
        openings[0].open === true,
      JSON.stringify(openings),
    );
  }

  // --- wall churn (the door-toggle flicker) ---------------------------------

  {
    // WallActor skips patching a wall whose points did not change, and
    // that skip is what stops a door toggle from rewriting every wall
    // in the scene. It is only sound if re-deriving identical inputs
    // gives value-identical output — no jitter from floating-point
    // accumulation, no reordering.
    const inputs = () => ({
      polylines: drawingToPolylines(rectShape(100, 60)),
      openings: [door({ open: true })],
      foreignCuts: [] as Cut[],
    });
    const a = deriveWallPolylines(inputs());
    const b = deriveWallPolylines(inputs());
    let identical = a.length === b.length;
    if (identical) {
      for (let i = 0; i < a.length && identical; i++) {
        if (a[i].length !== b[i].length) {
          identical = false;
          break;
        }
        for (let j = 0; j < a[i].length; j++) {
          if (a[i][j].x !== b[i][j].x || a[i][j].y !== b[i][j].y) {
            identical = false;
            break;
          }
        }
      }
    }
    check(
      "re-deriving the same inputs is bit-identical",
      identical,
      `pieces=${a.length}`,
    );
  }

  {
    // The other half of the same claim: a door opening on a shape far
    // away contributes a cut, but must leave this shape's walls exactly
    // as they were — otherwise every toggle really would touch every
    // wall and the skip could never fire.
    const polylines = drawingToPolylines(rectShape(100, 60));
    const before = deriveWallPolylines({
      polylines,
      openings: [],
      foreignCuts: [],
    });
    const faraway: Cut[] = [
      {
        openingId: "elsewhere",
        parentId: "other",
        points: [
          { x: 5000, y: 5000 },
          { x: 5040, y: 5000 },
        ],
        radius: 20,
        bbox: bboxOf(
          [
            { x: 5000, y: 5000 },
            { x: 5040, y: 5000 },
          ],
          20,
        ),
      },
    ];
    const after = deriveWallPolylines({
      polylines,
      openings: [],
      foreignCuts: faraway,
    });
    let same = before.length === after.length;
    for (let i = 0; i < before.length && same; i++) {
      same =
        before[i].length === after[i].length &&
        before[i].every(
          (p, j) => p.x === after[i][j].x && p.y === after[i][j].y,
        );
    }
    check(
      "a door on a distant shape leaves this shape's walls untouched",
      same,
      `before=${before.length} after=${after.length}`,
    );
  }

  {
    // A neighbour's door MOVING has to change this drawing's walls.
    //
    // This is the invariant behind OpeningActor.computeSignature folding
    // in the transform whenever the drawing contributes cuts. WallActor
    // early-returns on an unchanged signature, so if a moved foreign cut
    // did not move the signature, the hole would stay where the door used
    // to be — the wall opens in the wrong place and blocks the right one.
    const polylines = drawingToPolylines(rectShape(200, 140));
    const mk = (offsetX: number): Cut => {
      const points = [
        { x: 40 + offsetX, y: 0 },
        { x: 90 + offsetX, y: 0 },
      ];
      return {
        openingId: "shared",
        parentId: "neighbour",
        points,
        radius: 14,
        bbox: bboxOf(points, 14),
      };
    };
    const at0 = deriveWallPolylines({
      polylines,
      openings: [],
      foreignCuts: [mk(0)],
    });
    const at60 = deriveWallPolylines({
      polylines,
      openings: [],
      foreignCuts: [mk(60)],
    });
    const flat = (ps: { x: number; y: number }[][]) =>
      ps.map((p) => p.map((q) => `${q.x.toFixed(3)},${q.y.toFixed(3)}`).join(" ")).join("|");
    check(
      "moving a neighbour's open door moves the hole in this wall",
      flat(at0) !== flat(at60),
      `pieces ${at0.length} -> ${at60.length}`,
    );
  }

  {
    // Regression cover for the snap maths, which had none. A rewrite to
    // a result object per SEGMENT — on a traced map that was ~100k
    // short-lived objects per pointer move. The rewrite has to be
    // BIT-identical, not merely close: `t` feeds straight into an
    // opening's stored position, so a last-place-digit difference would
    // move doors by a hair on every re-derivation.
    //
    // This fuzzes both against a straightforward reference written the
    // old way — fresh object per segment, first-of-equals wins.
    type Vec = { x: number; y: number };
    interface RefHit {
      polyIndex: number;
      t: number;
      point: { x: number; y: number };
      distance: number;
    }
    function refClosest(p: Vec, a: Vec, b: Vec) {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const lenSq = dx * dx + dy * dy;
      if (lenSq < 1e-9) {
        return {
          u: 0,
          point: { x: a.x, y: a.y },
          distance: Math.hypot(p.x - a.x, p.y - a.y),
        };
      }
      let u = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
      if (u < 0) u = 0;
      else if (u > 1) u = 1;
      const qx = a.x + u * dx;
      const qy = a.y + u * dy;
      return {
        u,
        point: { x: qx, y: qy },
        distance: Math.hypot(p.x - qx, p.y - qy),
      };
    }
    function refSnapAll(p: Vec, polys: Vec[][]): RefHit | null {
      let best: RefHit | null = null;
      for (let pi = 0; pi < polys.length; pi++) {
        const poly = polys[pi];
        if (poly.length < 2) continue;
        let total = 0;
        for (let i = 0; i < poly.length - 1; i++) {
          total += Math.hypot(poly[i + 1].x - poly[i].x, poly[i + 1].y - poly[i].y);
        }
        if (total < 1e-6) continue;
        let arc = 0;
        for (let i = 0; i < poly.length - 1; i++) {
          const a = poly[i];
          const b = poly[i + 1];
          const segLen = Math.hypot(b.x - a.x, b.y - a.y);
          if (segLen < 1e-9) continue;
          const c = refClosest(p, a, b);
          if (best === null || c.distance < best.distance) {
            best = {
              polyIndex: pi,
              t: (arc + c.u * segLen) / total,
              point: c.point,
              distance: c.distance,
            };
          }
          arc += segLen;
        }
      }
      return best;
    }

    // Deterministic LCG — no Math.random, so a failure is reproducible.
    let seed = 0x2f6e2b1;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x100000000;
    };

    let mismatches = 0;
    let compared = 0;
    let sawDegenerate = false;
    for (let trial = 0; trial < 400 && mismatches === 0; trial++) {
      const polys: Vec[][] = [];
      const nPolys = 1 + Math.floor(rnd() * 3);
      for (let k = 0; k < nPolys; k++) {
        const n = 2 + Math.floor(rnd() * 14);
        const poly: Vec[] = [];
        let x = rnd() * 400 - 200;
        let y = rnd() * 400 - 200;
        for (let i = 0; i < n; i++) {
          poly.push({ x, y });
          // Every so often emit a hairline segment: long enough to pass
          // the caller's segLen guard, short enough to hit the squared
          // -length degenerate branch. That asymmetry is exactly what a
          // careless rewrite would drop.
          if (rnd() < 0.12) {
            sawDegenerate = true;
            x += 1e-6;
            y += 1e-6;
          } else {
            x += rnd() * 80 - 40;
            y += rnd() * 80 - 40;
          }
        }
        polys.push(poly);
      }
      const p: Vec = { x: rnd() * 500 - 250, y: rnd() * 500 - 250 };

      const got = snapToPolylines(p, polys);
      const want = refSnapAll(p, polys);
      compared++;
      const same =
        (got === null && want === null) ||
        (got !== null &&
          want !== null &&
          got.polyIndex === want.polyIndex &&
          got.t === want.t &&
          got.point.x === want.point.x &&
          got.point.y === want.point.y &&
          got.distance === want.distance);
      if (!same) {
        mismatches++;
        console.log(
          "     mismatch on trial " + trial + ": got=" + JSON.stringify(got) +
            " want=" + JSON.stringify(want),
        );
      }

      // Single-contour path, which has its own copy of the loop.
      const one = snapToPolyline(p, polys[0]);
      const wantOne = refSnapAll(p, [polys[0]]);
      const sameOne =
        (one === null && wantOne === null) ||
        (one !== null &&
          wantOne !== null &&
          one.t === wantOne.t &&
          one.point.x === wantOne.point.x &&
          one.point.y === wantOne.point.y &&
          one.distance === wantOne.distance);
      if (!sameOne) {
        mismatches++;
        console.log("     snapToPolyline mismatch on trial " + trial);
      }
    }
    check(
      "snap matches an independent reference implementation",
      mismatches === 0 && sawDegenerate,
      `${compared} random cases, hairline segments exercised: ${sawDegenerate}`,
    );

    // Random floats never tie exactly, so the fuzz above cannot pin
    // down which of two EQUALLY close candidates wins. Pin it: two
    // parallel contours straddling the query point are exactly the same
    // distance away, and the original kept the FIRST (`<`, not `<=`).
    //
    // A symmetric V does NOT test this — at its apex both arms return
    // the same point and the same t, so the tie is invisible. It has to
    // be two candidates whose ANSWERS differ.
    const above: Vec[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];
    const below: Vec[] = [
      { x: 0, y: 20 },
      { x: 100, y: 20 },
    ];
    const midway = snapToPolylines({ x: 50, y: 10 }, [above, below]);
    const midwayRef = refSnapAll({ x: 50, y: 10 }, [above, below]);
    check(
      "equidistant candidates keep the FIRST match",
      midway !== null &&
        midwayRef !== null &&
        midway.polyIndex === 0 &&
        midway.polyIndex === midwayRef.polyIndex &&
        midway.point.y === 0 &&
        midway.distance === midwayRef.distance,
      midway
        ? `polyIndex=${midway.polyIndex} y=${midway.point.y} d=${midway.distance}`
        : "no hit",
    );
  }

  {
    // inverseTransformPoints exists only to hoist ONE matrix inversion
    // out of a per-point loop. It has to agree with the per-point
    // function exactly — cut geometry is re-expressed through it on
    // every wall re-derivation, so a drifting last digit would creep
    // door positions on overlapping shapes.
    const item: any = {
      position: { x: 137.5, y: -84.25 },
      rotation: 31.7,
      scale: { x: 1.37, y: 0.82 },
    };
    const matrix = itemMatrix(item);
    const pts = [
      { x: 0, y: 0 },
      { x: 12.5, y: -7.25 },
      { x: -400, y: 900.125 },
      { x: 1e-7, y: -1e-7 },
    ];
    const oneByOne = pts.map((p) => inverseTransformPoint(matrix, p));
    const batched = inverseTransformPoints(matrix, pts);
    const same =
      batched.length === oneByOne.length &&
      batched.every(
        (b, i) => b.x === oneByOne[i].x && b.y === oneByOne[i].y,
      );
    check(
      "batched inverse transform equals the per-point one, exactly",
      same,
      `${pts.length} points`,
    );
  }

  {
    // 墙体外扩 used to test every vertex against every edge — O(n²) per
    // contour, ~640 ms on a 45k-vertex traced dungeon, paid on every
    // save and every move of the map. It now indexes the edges in a
    // uniform grid sized to the furthest a ray can usefully travel.
    //
    // That is only legitimate if the grid hands back a SUPERSET of the
    // edges the brute-force loop would have tested: the clamp takes a
    // MIN over whatever qualifies, and min over a superset in any order
    // is the same number. Fuzz the two against each other over shapes
    // with the features that make offsetting hard — thin necks, sharp
    // spikes, near-duplicate vertices.
    let seed = 0x51ed5;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x100000000;
    };

    let worst = 0;
    let cases = 0;
    let bigEnoughForGrid = false;
    for (let trial = 0; trial < 60; trial++) {
      // Ring with a radius that swings in and out, which produces the
      // pinches the clamp exists for. >=64 vertices so the grid path is
      // actually taken (below that the code stays brute force).
      const n = 80 + Math.floor(rnd() * 140);
      if (n >= 64) bigEnoughForGrid = true;
      const poly: { x: number; y: number }[] = [];
      const lobes = 2 + Math.floor(rnd() * 5);
      const spike = rnd() < 0.4;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        let r = 120 + 70 * Math.sin(a * lobes);
        // Occasional near-zero radius: a thin neck through the middle.
        if (spike && i % 17 === 0) r *= 0.12;
        poly.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
      }
      // A couple of duplicate vertices, which the degenerate guards care about.
      poly.splice(5, 0, { x: poly[5].x, y: poly[5].y });

      // Deliberately awkward distances: the grid cell is |distance| and a
      // vertex queries ceil(reach / cell) rings, so ratios that are NOT
      // whole numbers are the ones that tell ceil apart from floor.
      for (const dist of [3, 6, -4, 12, 2.7, 5.3, -3.1, 9.4, 0.9, 17.2]) {
        const indexed = safeWallOffset([poly], dist, 1, true);
        const brute = safeWallOffset([poly], dist, 1, false);
        cases++;
        if (indexed.length !== brute.length || indexed[0].length !== brute[0].length) {
          worst = Infinity;
          break;
        }
        for (let i = 0; i < brute[0].length; i++) {
          const dx = Math.abs(indexed[0][i].x - brute[0][i].x);
          const dy = Math.abs(indexed[0][i].y - brute[0][i].y);
          if (dx > worst) worst = dx;
          if (dy > worst) worst = dy;
        }
      }
    }
    check(
      "edge-grid offset is identical to the brute-force offset",
      worst === 0 && bigEnoughForGrid,
      `${cases} shape/distance pairs, max coordinate difference ${worst}`,
    );
  }

  {
    // Morphology got a binary fast path (running counts) alongside the
    // general monotonic-queue implementation, picked by checking the
    // input. Fuzz the two against each other on masks that stress the
    // things separable morphology gets wrong: borders, where the window
    // is CLAMPED not padded; single isolated pixels; full rows; even vs
    // odd kernels; and kernels wider than the mask itself.
    let seed = 0xbeef01;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x100000000;
    };

    const ops = ["dilate", "erode", "open", "close"] as const;
    const run = (
      op: (typeof ops)[number],
      m: Uint8Array,
      w: number,
      h: number,
      k: number,
    ) =>
      op === "dilate"
        ? morphDilate(m, w, h, k)
        : op === "erode"
          ? morphErode(m, w, h, k)
          : op === "open"
            ? morphOpen(m, w, h, k)
            : morphClose(m, w, h, k);

    let bad = 0;
    let cases = 0;
    let sawBorderHit = false;
    for (let trial = 0; trial < 60 && bad === 0; trial++) {
      // Widths must straddle the 32-bit word boundary the bitset
      // implementation packs rows into: with w <= 23 every row fits in
      // ONE word and the cross-word carry logic in spreadCols never
      // runs, while the real editor traces 3000px-wide masks.
      // 31/32/33 and 63/64/65 are the interesting ones.
      const widths = [1, 2, 7, 23, 31, 32, 33, 40, 63, 64, 65, 80];
      const w = widths[Math.floor(rnd() * widths.length)];
      const h = 1 + Math.floor(rnd() * 23);
      const mask = new Uint8Array(w * h);
      const density = rnd();
      for (let i = 0; i < mask.length; i++) mask[i] = rnd() < density ? 255 : 0;
      // Guarantee some cases with set pixels hard against an edge, which
      // is where a padded-vs-clamped mix-up shows up.
      if (trial % 3 === 0) {
        for (let x = 0; x < w; x++) mask[x] = 255;
        for (let y = 0; y < h; y++) mask[y * w] = 255;
        sawBorderHit = true;
      }
      // The editor sliders cap kernels at 25, but the implementation
      // is written for any k and should not quietly break if that cap
      // is raised. k=200 gives r=100, which is the only way the
      // doubling ever emits a column shift of a FULL WORD or more
      // (s reaches 32 only once reach has passed 63) — the wordShift
      // branch in spreadCols is dead below that.
      for (const k of [2, 3, 4, 5, 9, 31, 71, 200]) {
        for (const op of ops) {
          const got = run(op, mask, w, h, k);
          const want = _morphologyReference(mask, w, h, k, op);
          cases++;
          if (got.length !== want.length) {
            bad++;
            break;
          }
          for (let i = 0; i < want.length; i++) {
            if (got[i] !== want[i]) {
              bad++;
              console.log(
                `     ${op} k=${k} ${w}x${h} differs at ${i}: ${got[i]} vs ${want[i]}`,
              );
              break;
            }
          }
          if (bad > 0) break;
        }
        if (bad > 0) break;
      }
    }
    check(
      "binary morphology matches the general implementation",
      bad === 0 && sawBorderHit,
      `${cases} mask/kernel/op combinations`,
    );

    // One WIDE case, because nothing above reaches the bitset's
    // whole-word column shift.
    //
    // That branch only runs when the doubling emits s >= 32, which
    // needs r >= 63 — and it only CHANGES the answer when the mask is
    // also much wider than the reach, otherwise the dilation saturates
    // the row and a dropped word-shift is invisible. 300 wide with
    // k=141 (r=70) satisfies both. Without this the branch was dead
    // under test: zeroing wordShift left every other case green.
    {
      const w = 300;
      const h = 9;
      const wide = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) {
        wide[y * w + 5] = 255;
        wide[y * w + 150] = 255;
        wide[y * w + w - 3] = 255;
      }
      let wideOk = true;
      for (const op of ops) {
        const got = run(op, wide, w, h, 141);
        const want = _morphologyReference(wide, w, h, 141, op);
        for (let i = 0; i < want.length; i++) {
          if (got[i] !== want[i]) wideOk = false;
        }
      }
      check("bitset whole-word column shift matches the reference", wideOk);
    }

    // A mask carrying values other than 0/255 must fall back to the
    // general path rather than being silently rounded to binary.
    const grey = new Uint8Array(6 * 5);
    for (let i = 0; i < grey.length; i++) grey[i] = (i * 37) % 256;
    let greyOk = true;
    for (const op of ops) {
      const got = run(op, grey, 6, 5, 3);
      const want = _morphologyReference(grey, 6, 5, 3, op);
      for (let i = 0; i < want.length; i++) {
        if (got[i] !== want[i]) greyOk = false;
      }
    }
    check("non-binary masks still take the general path", greyOk);
  }

  {
    // Portal landing search: the grid must answer exactly what the
    // exhaustive scan answers. It prunes on the claim that a wall
    // outside the query box cannot fail either safety test, so the
    // cases that matter are the ones near a box edge — a wall just
    // inside `clearance`, and a wall the sight line only just clips.
    let seed = 0x10c8ce;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x100000000;
    };

    const walls: PortalWall[] = [];
    for (let room = 0; room < 12; room++) {
      const x = rnd() * 1200;
      const y = rnd() * 900;
      const w = 80 + rnd() * 200;
      const h = 80 + rnd() * 200;
      const step = 11;
      for (let i = 0; i < w; i += step) {
        walls.push({ a: { x: x + i, y }, b: { x: x + i + step, y } });
        walls.push({ a: { x: x + i, y: y + h }, b: { x: x + i + step, y: y + h } });
      }
      for (let i = 0; i < h; i += step) {
        walls.push({ a: { x, y: y + i }, b: { x, y: y + i + step } });
        walls.push({ a: { x: x + w, y: y + i }, b: { x: x + w, y: y + i + step } });
      }
    }

    let mismatches = 0;
    let probes = 0;
    let sawUnsafe = false;
    let sawSafe = false;
    const spacing = 90;
    const scratch: number[] = [];
    for (let trial = 0; trial < 30 && mismatches === 0; trial++) {
      const origin = { x: rnd() * 1400, y: rnd() * 1100 };
      // Clearances spanning well under and well over the cell size, so
      // the disc query is exercised both inside one cell and across
      // several.
      const clearance = [3, 18, 55, 140][trial % 4];
      const grid = new WallGrid(walls, landingCellSize(spacing));
      for (let ring = 0; ring <= 6; ring++) {
        const count = ring === 0 ? 1 : ring * 6;
        for (let i = 0; i < count; i++) {
          const a = (i / count) * 2 * Math.PI - Math.PI / 2;
          const p =
            ring === 0
              ? { x: origin.x, y: origin.y }
              : {
                  x: origin.x + Math.cos(a) * spacing * ring,
                  y: origin.y + Math.sin(a) * spacing * ring,
                };
          const want = isSafeLandingPointExhaustive(p, origin, clearance, walls);
          const got = grid.isSafeLandingPoint(p, origin, clearance, scratch);
          probes++;
          if (want) sawSafe = true;
          else sawUnsafe = true;
          if (want !== got) mismatches++;
        }
      }
    }
    check(
      "portal landing grid matches the exhaustive scan",
      mismatches === 0 && sawSafe && sawUnsafe,
      `${probes} probes over ${walls.length} segments`,
    );
  }

  // --- line of sight (light occlusion) --------------------------------------

  {
    // One wall down the middle of an otherwise open field.
    const wall = [
      { x: 100, y: -1000 },
      { x: 100, y: 1000 },
    ];
    const index = WallIndex.build([wall]);
    check(
      "a wall between two lights blocks the sight line",
      index.blocked({ x: 0, y: 0 }, { x: 200, y: 0 }),
      `segments=${index.size}`,
    );
    check(
      "two lights on the same side of a wall can see each other",
      !index.blocked({ x: 0, y: 0 }, { x: 90, y: 400 }),
      "",
    );
    check(
      "distance alone never blocks — only walls do",
      !index.blocked({ x: 0, y: 0 }, { x: -50_000, y: 30_000 }),
      "",
    );
  }

  {
    // The same wall, but with a doorway cut out of it between y=-40 and
    // y=40 — exactly what `deriveWallPolylines` emits for an open door.
    const index = WallIndex.build([
      [
        { x: 100, y: -1000 },
        { x: 100, y: -40 },
      ],
      [
        { x: 100, y: 40 },
        { x: 100, y: 1000 },
      ],
    ]);
    check(
      "an open doorway lets the sight line through",
      !index.blocked({ x: 0, y: 0 }, { x: 200, y: 0 }),
      "",
    );
    check(
      "the wall either side of the doorway still blocks",
      index.blocked({ x: 0, y: 300 }, { x: 200, y: 300 }),
      "",
    );
  }

  {
    // A sconce token sits ON the wall it hangs from. Without the trim
    // it would occlude itself forever and never light anything.
    const index = WallIndex.build([
      [
        { x: 100, y: -1000 },
        { x: 100, y: 1000 },
      ],
    ]);
    const onWall = { x: 100, y: 0 };
    check(
      "a light sitting on a wall self-occludes without a trim",
      index.blocked({ x: 40, y: 0 }, onWall, 0),
      "",
    );
    check(
      "…and does not once the endpoints are trimmed",
      !index.blocked({ x: 40, y: 0 }, onWall, 30),
      "",
    );
    check(
      "the trim does not reopen a wall crossed mid-line",
      index.blocked({ x: 0, y: 0 }, { x: 400, y: 0 }, 30),
      "",
    );
  }

  {
    // Many segments spread over a wide area: exercises the grid march
    // rather than the single-cell fast path.
    const polylines: { x: number; y: number }[][] = [];
    for (let i = 0; i < 400; i++) {
      const x = i * 25;
      polylines.push([
        { x, y: 0 },
        { x, y: 20 },
      ]);
    }
    const index = WallIndex.build(polylines);
    check(
      "grid march finds a hit far from the query origin",
      index.blocked({ x: 5000, y: 10 }, { x: 5040, y: 10 }),
      `segments=${index.size}`,
    );
    check(
      "grid march reports clear when the line runs past every segment",
      !index.blocked({ x: -100, y: 500 }, { x: 12_000, y: 500 }),
      "",
    );
  }

  return results.slice();
}

/** Console-friendly summary. Returns true when everything passed. */
export function reportDynfogSelfTest(): boolean {
  const all = runDynfogSelfTest();
  let failed = 0;
  for (const result of all) {
    if (!result.ok) failed++;
    const mark = result.ok ? "PASS" : "FAIL";
    const suffix = result.detail ? `  (${result.detail})` : "";
    console.log(`${mark}  ${result.name}${suffix}`);
  }
  console.log(`\n${all.length - failed}/${all.length} passed`);
  return failed === 0;
}
