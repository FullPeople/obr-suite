// canvasDragMode — register an OBR tool mode that re-implements
// drag-to-move tokens + drag-to-marquee box-select on top of an
// existing tool (e.g. Select), without inheriting the host tool's
// default mode behavior. Used by:
//
//   - bubbles (mode under Select), so the user can scale tokens
//     without OBR's transformer corrupting the HP-bar snapshot
//   - bestiary (mode under its own custom tool), so the GM can drag
//     tokens around while browsing the monster panel
//
// Design points worth knowing:
//
//   • `preventDrag: undefined` — by SDK default this means "consume
//     ALL drags." We rely on it: transformer drags get intercepted
//     here too, and our handler ignores them, so OBR's native
//     scale/rotate doesn't run.
//
//   • All position updates use `requestAnimationFrame` throttling.
//     `updateItems` is fire-and-forget (no await) — OBR's message
//     bus serialises the updates in order. Each rAF tick reads the
//     LATEST pointer delta and dispatches once. A bare-minimum
//     dispatch on every onToolDragMove was visibly stuttery (we
//     suspect because it stacks promises faster than the bus can
//     drain).
//
//   • Marquee rect is a `scene.local` Shape with `disableHit` so it
//     doesn't intercept its own pointer events.
//
//   • Multi-token drag: when user grabs a selected token, the cached
//     selection is dragged together. Anchor token's start position
//     is seeded synchronously from `event.target.position`; sibling
//     positions arrive a frame or two later via `getItems`.
//
//   • Limitations (deliberate, v1): no snap-to-grid, no alt-clone,
//     no shift/ctrl-add-to-selection, no rotation handling. Marquee
//     selects items whose `position` falls inside the rect (anchor
//     check, not bounding-box overlap).

import OBR, {
  buildShape,
  Item,
  Vector2,
} from "@owlbear-rodeo/sdk";

export interface CanvasDragModeOptions {
  /** Globally-unique mode id (e.g. "com.obr-suite/bubbles/guard-mode"). */
  modeId: string;
  /** Tool id under which the mode lives (e.g. "rodeo.owlbear.tool/select"
   *  or a plugin's own tool id). Used for the icon's default visibility
   *  filter and as the `toolId` arg to `OBR.tool.activateMode`. */
  toolId: string;
  /** Asset URL for the toolbar icon. */
  icon: string;
  /** Toolbar tooltip / accessibility label. */
  label: string;
  /** Override the icon's visibility filter. Default: visible whenever
   *  `toolId` is the active tool. */
  iconFilter?: any;
  /** Optional cleanup hook fired when the mode is deactivated mid-drag,
   *  in addition to the built-in marquee/state cleanup. */
  onDeactivate?: () => void;
}

const DRAG_THRESHOLD_SQ = 16; // (4 scene-coord units)²

function isMovableImage(it: Item | undefined): boolean {
  if (!it) return false;
  if ((it as any).type !== "IMAGE") return false;
  const layer = (it as any).layer;
  return layer === "CHARACTER" || layer === "MOUNT" || layer === "PROP";
}

type DragState =
  | { kind: "transformer-noop" }
  | {
      kind: "token";
      anchor: Vector2;
      ids: string[];
      starts: Map<string, Vector2>;
    }
  | {
      kind: "marquee";
      anchor: Vector2;
      rectId: string | null;
    }
  | null;

/** Register the drag mode. Returns nothing — caller should keep
 *  `OBR.tool.removeMode(modeId)` paired with their own teardown. */
export async function createCanvasDragMode(
  opts: CanvasDragModeOptions,
): Promise<void> {
  let state: DragState = null;
  // Mirror of the player's selection so onToolDragStart can read it
  // synchronously to decide multi-token vs single-token drag.
  let cachedSel: string[] = [];
  // Latest pointer delta from onToolDragMove. The rAF loop reads this
  // each frame and dispatches if it's changed since the last sent.
  let lastDelta: { dx: number; dy: number } | null = null;
  let lastSentDelta: { dx: number; dy: number } | null = null;
  let rafHandle: number | null = null;

  // Subscribe to player changes — each mode gets its own subscription;
  // it's cheap. The subscription survives until the page unloads, which
  // matches the typical mode lifetime.
  OBR.player.onChange((p) => {
    cachedSel = Array.isArray(p.selection) ? p.selection : [];
  });
  try {
    cachedSel = (await OBR.player.getSelection()) ?? [];
  } catch {}

  // Continuous rAF loop — runs every frame WHILE a token drag is
  // active. Reads the latest pointer delta and dispatches updateItems
  // only if it changed since the last frame (saves no-op bus traffic
  // if pointer hasn't moved). This produces a metronomic 60Hz update
  // cadence regardless of how often pointer events fire (high-refresh
  // mice can fire 240Hz+, which would have flooded the bus on the
  // previous on-demand rAF setup).
  function rafTick(): void {
    rafHandle = null;
    if (!state || state.kind !== "token") return;
    const cur = lastDelta;
    if (cur && (!lastSentDelta || cur.dx !== lastSentDelta.dx || cur.dy !== lastSentDelta.dy)) {
      lastSentDelta = { dx: cur.dx, dy: cur.dy };
      const ids = Array.from(state.starts.keys());
      if (ids.length > 0) {
        const startsCopy = new Map(state.starts);
        // Fire-and-forget: don't await — OBR's message bus serialises
        // updates in order. Awaiting was caps below 60Hz on slow links.
        OBR.scene.items
          .updateItems(ids, (drafts) => {
            for (const d of drafts) {
              const s = startsCopy.get(d.id);
              if (s) d.position = { x: s.x + cur.dx, y: s.y + cur.dy };
            }
          })
          .catch(() => {});
      }
    }
    rafHandle = requestAnimationFrame(rafTick);
  }

  function startRafLoop(): void {
    if (rafHandle != null) return;
    rafHandle = requestAnimationFrame(rafTick);
  }
  function stopRafLoop(): void {
    if (rafHandle != null) {
      cancelAnimationFrame(rafHandle);
      rafHandle = null;
    }
    lastDelta = null;
    lastSentDelta = null;
  }

  function cleanup(): void {
    stopRafLoop();
    if (state?.kind === "marquee" && state.rectId) {
      const rid = state.rectId;
      OBR.scene.local.deleteItems([rid]).catch(() => {});
    }
    state = null;
  }

  await OBR.tool.createMode({
    id: opts.modeId,
    icons: [
      {
        icon: opts.icon,
        label: opts.label,
        filter: opts.iconFilter ?? { activeTools: [opts.toolId] },
      },
    ],
    cursors: [
      // OBR uses an internal cursor enum (uppercase). Other suite
      // modes use forms like "POINTER", "CROSSHAIR", "MOVE" — anything
      // CSS-y like "grab" / "grabbing" / "default" doesn't seem to
      // resolve. `key` arrays are how fullFog's door mode does its
      // hover-over-overlay filter; single-string keys may not work.
      { cursor: "GRABBING", filter: { dragging: true } as any },
      {
        cursor: "GRAB",
        filter: { target: [{ key: ["type"], value: "IMAGE" }] },
      },
      { cursor: "DEFAULT" },
    ],
    // preventDrag: undefined → SDK default = "consume all drags."
    // Transformer drags hit our handler too, where we ignore them so
    // OBR's native scale/rotate doesn't run.
    onToolDragStart: (_ctx, event) => {
      const ev = event as any;
      if (ev.transformer) {
        state = { kind: "transformer-noop" };
        return;
      }
      const t = ev.target as Item | undefined;
      if (isMovableImage(t)) {
        const anchorTok = t!;
        const ids = cachedSel.includes(anchorTok.id)
          ? cachedSel.slice()
          : [anchorTok.id];
        const starts = new Map<string, Vector2>();
        starts.set(anchorTok.id, {
          x: anchorTok.position.x,
          y: anchorTok.position.y,
        });
        state = {
          kind: "token",
          anchor: { x: ev.pointerPosition.x, y: ev.pointerPosition.y },
          ids,
          starts,
        };
        // Spin up the rAF loop for the duration of this drag.
        startRafLoop();
        // Async-fill sibling positions for multi-select drag.
        if (ids.length > 1) {
          OBR.scene.items
            .getItems(ids)
            .then((items) => {
              if (!state || state.kind !== "token") return;
              for (const it of items) {
                if (!state.starts.has(it.id)) {
                  state.starts.set(it.id, {
                    x: it.position.x,
                    y: it.position.y,
                  });
                }
              }
            })
            .catch(() => {});
        }
        return;
      }
      // Empty space → marquee. Rect built lazily on first move past
      // the threshold so a bare click doesn't leave a 0-size rect.
      state = {
        kind: "marquee",
        anchor: { x: ev.pointerPosition.x, y: ev.pointerPosition.y },
        rectId: null,
      };
    },

    onToolDragMove: (_ctx, event) => {
      if (!state || state.kind === "transformer-noop") return;
      const ev = event as any;
      const dx = ev.pointerPosition.x - state.anchor.x;
      const dy = ev.pointerPosition.y - state.anchor.y;
      const distSq = dx * dx + dy * dy;

      if (state.kind === "token") {
        // The continuous rAF loop reads this each frame and dispatches.
        lastDelta = { dx, dy };
        return;
      }

      // marquee
      if (!state.rectId && distSq < DRAG_THRESHOLD_SQ) return;
      const x0 = Math.min(state.anchor.x, ev.pointerPosition.x);
      const y0 = Math.min(state.anchor.y, ev.pointerPosition.y);
      const w = Math.abs(dx);
      const h = Math.abs(dy);
      if (!state.rectId) {
        const rect = buildShape()
          .shapeType("RECTANGLE")
          .position({ x: x0, y: y0 })
          .width(w)
          .height(h)
          .strokeColor("#4dabf7")
          .strokeOpacity(0.95)
          .strokeWidth(2)
          .fillColor("#4dabf7")
          .fillOpacity(0.12)
          .layer("CONTROL")
          .locked(true)
          .disableHit(true)
          .visible(true)
          .build();
        state.rectId = rect.id;
        OBR.scene.local.addItems([rect]).catch(() => {});
      } else {
        const id = state.rectId;
        OBR.scene.local
          .updateItems([id], (drafts) => {
            const d = drafts[0] as any;
            if (!d) return;
            d.position = { x: x0, y: y0 };
            d.width = w;
            d.height = h;
          })
          .catch(() => {});
      }
    },

    onToolDragEnd: (_ctx, event) => {
      const cur = state;
      if (!cur) return;

      if (cur.kind === "token") {
        // Final dispatch — make sure the last frame's pointer delta
        // actually lands. Otherwise a too-quick release (within one
        // rAF tick of the last move) leaves the token at the previous
        // frame's position.
        if (lastDelta) {
          const { dx, dy } = lastDelta;
          const ids = Array.from(cur.starts.keys());
          const startsCopy = new Map(cur.starts);
          if (ids.length > 0) {
            OBR.scene.items
              .updateItems(ids, (drafts) => {
                for (const d of drafts) {
                  const s = startsCopy.get(d.id);
                  if (s) d.position = { x: s.x + dx, y: s.y + dy };
                }
              })
              .catch(() => {});
          }
        }
        cleanup();
        return;
      }

      if (cur.kind === "transformer-noop") {
        cleanup();
        return;
      }

      // marquee — finalise selection
      const ev = event as any;
      const x0 = Math.min(cur.anchor.x, ev.pointerPosition.x);
      const y0 = Math.min(cur.anchor.y, ev.pointerPosition.y);
      const x1 = Math.max(cur.anchor.x, ev.pointerPosition.x);
      const y1 = Math.max(cur.anchor.y, ev.pointerPosition.y);
      cleanup();
      // Stray click — leave selection alone (OBR's click-select on
      // the underlying down/up event already ran).
      if (x1 - x0 < 2 && y1 - y0 < 2) return;
      void selectInRect(x0, y0, x1, y1);
    },

    onToolDragCancel: () => {
      cleanup();
    },

    onDeactivate: () => {
      cleanup();
      opts.onDeactivate?.();
    },
  });
}

async function selectInRect(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): Promise<void> {
  let items: Item[] = [];
  try {
    items = await OBR.scene.items.getItems();
  } catch {
    return;
  }
  const inside: string[] = [];
  for (const it of items) {
    if (!isMovableImage(it)) continue;
    const p = it.position;
    if (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1) inside.push(it.id);
  }
  try {
    if (inside.length > 0) await OBR.player.select(inside, true);
    else await OBR.player.deselect();
  } catch {}
}
