/**
 * Grid-box anchoring for the HP bubbles — the `anchorMode: "box"` path.
 *
 * ── Why this exists ────────────────────────────────────────────────────
 *
 * The bar is vertically anchored to the bottom edge of the token's
 * RENDERED CANVAS:
 *
 *     origin.y = getImageCenter().y + getRenderedSize().height / 2
 *
 * `getRenderedSize` measures the whole PNG, transparent padding
 * included. Art that is not centred inside its own canvas therefore
 * pushes the bar away from the visible token — a dragon whose crown
 * reaches above the ring, a token with a baked-in drop shadow, a
 * creature drawn in the top half of a 2048² sheet. Two tokens sitting
 * on the same row then end up on two different lines, and a token whose
 * canvas is bigger than its footprint gets a proportionally bigger bar
 * than its neighbours.
 *
 * ── What it does ───────────────────────────────────────────────────────
 *
 * `anchorMode: "box"` replaces "the canvas rect" with "the token's grid
 * box", derived from the scene grid rather than from the artwork:
 *
 *   1. `occupancy` = round(rendered canvas / scene dpi) per axis, at
 *      least 1. Same unit the OBR ruler shows for a token (1×1 / 2×2),
 *      so a token that is scaled up or given a bigger image gets a
 *      proportionally bigger bar automatically.
 *
 *   2. While the token is lined up with the grid (both axes within
 *      `SNAP_TOLERANCE_CELLS` and the token is not rotated by more than
 *      `ROT_TOLERANCE_DEG`), the box is snapped to the nearest grid
 *      lines. That is the "same row ⇒ same line" property.
 *
 *   3. The snapped box is MEMORISED per token (see `anchor-memory.ts`).
 *      Once the token leaves the grid — dragged onto an intersection,
 *      nudged half a cell, rotated for a charge — the memorised box is
 *      rigidly mapped into the current frame, so the bar keeps the exact
 *      in-cell position it had while it was aligned, and follows
 *      position / scale / mirror without either flying off or jumping a
 *      whole cell the moment the tolerance is crossed.
 *
 * Rotation is deliberately NOT followed: every bubble item in this
 * module is built axis-aligned in world space (SCALE / ROTATION
 * inheritance are both disabled — see DISABLE_INHERIT), so a rotated box
 * would only inflate the bar's bounding box. The box's *centre* still
 * tracks the token; only the corner angles are ignored.
 *
 * ── Scope ──────────────────────────────────────────────────────────────
 *
 * Pure math over plain numbers — no SDK import, no DOM, no globals. The
 * frame is assembled by the caller from the same `getImageCenter` /
 * `getRenderedSize` helpers the canvas path uses, so there is exactly one
 * definition of "where is this token" in the codebase.
 *
 * `anchorMode` defaults to `"canvas"`, which reproduces the previous
 * geometry bit for bit; nothing here runs unless a table opts in.
 */

/** Where the box came from — surfaced for diagnostics / self-tests. */
export type AnchorSource = "grid" | "memory";

/** 2026-10-08 — how far off a grid line a token may sit and still count
 *  as "lined up". 0.3 cell ≈ a third of a square: loose enough to absorb
 *  hand-placed tokens and OBR's own snapping, tight enough that a token
 *  deliberately parked on an intersection (0.5 cell off) is not forced
 *  back onto a line. */
export const SNAP_TOLERANCE_CELLS = 0.3;

/** 2026-10-08 — a rotated token is never treated as "lined up", whatever
 *  its position says: the box would be a rotated square and the
 *  axis-aligned bar can't represent it. Beyond this the memorised box
 *  takes over instead. */
export const ROT_TOLERANCE_DEG = 5;

/** Occupancy sanity clamp. A 12×12 token is already absurd; the clamp
 *  only exists so a bogus `grid.dpi` (a stale import, a hand-edited
 *  scene) can't produce a bar hundreds of cells wide. */
export const MAX_OCCUPANCY = 12;

/**
 * Everything about a token that the box needs, pre-resolved by the
 * caller in WORLD units:
 *
 *   centerX / centerY — `getImageCenter()` (rotation and scale already
 *                       applied to the anchor→centre offset)
 *   width / height    — `getRenderedSize()` (the FULL canvas)
 *   px / py           — the raw `item.position`, needed to express the
 *                       memory as a token-relative offset
 *   rot / sx / sy     — `item.rotation` and `item.scale`
 */
export interface Frame {
  centerX: number;
  centerY: number;
  width: number;
  height: number;
  px: number;
  py: number;
  rot: number;
  sx: number;
  sy: number;
}

/** The box handed to `computeLayoutFromMetrics` in place of the canvas
 *  rect. Axis-aligned, world units. */
export interface AnchorBox {
  centerX: number;
  centerY: number;
  width: number;
  height: number;
  cols: number;
  rows: number;
  source: AnchorSource;
}

/** A memorised "this is where the box sat inside its cells while the
 *  token was lined up". Everything is stored in the frame it was taken
 *  in, so it can be mapped forward later. */
export interface AnchorRef {
  /** grid index of the box's top-left corner */
  gx: number;
  gy: number;
  cols: number;
  rows: number;
  /** `item.position` at snapshot time */
  px: number;
  py: number;
  rot: number;
  sx: number;
  sy: number;
}

/** Result of {@link resolveAnchorBox}. `snapshot` is non-null only on the
 *  frames where a fresh memory was taken, so the caller knows when to
 *  mark the store dirty. */
export interface AnchorResolution {
  box: AnchorBox;
  snapshot: AnchorRef | null;
}

/** Normalise degrees into (-180, 180]. */
export function normaliseDeg(deg: number): number {
  let x = Number.isFinite(deg) ? deg % 360 : 0;
  if (x > 180) x -= 360;
  if (x <= -180) x += 360;
  return x;
}

/**
 * How many cells the token covers, per axis, measured from the rendered
 * canvas. Mirrors what OBR's ruler reports for a token, so "the bar is as
 * wide as the token's footprint" stays true after a resize.
 */
export function occupancyOf(
  renderedWidth: number,
  renderedHeight: number,
  dpi: number,
): { cols: number; rows: number } {
  const cell = Number.isFinite(dpi) && dpi > 0 ? dpi : 150;
  const pick = (v: number) => {
    const n = Math.round((Number.isFinite(v) ? Math.abs(v) : 0) / cell);
    return Math.min(MAX_OCCUPANCY, Math.max(1, n || 1));
  };
  return { cols: pick(renderedWidth), rows: pick(renderedHeight) };
}

/** Nearest grid-aligned box of `occupancy` cells, plus how far it had to
 *  move to get there (in cells). */
export interface AlignTarget {
  cols: number;
  rows: number;
  gx: number;
  gy: number;
  /** in cells; 0 = the token is exactly on the lines */
  deviation: number;
  /** true when both the position and the rotation are close enough */
  aligned: boolean;
}

export function alignTarget(frame: Frame, dpi: number): AlignTarget {
  const cell = Number.isFinite(dpi) && dpi > 0 ? dpi : 150;
  const { cols, rows } = occupancyOf(frame.width, frame.height, cell);
  const w = cols * cell;
  const h = rows * cell;
  const x0 = frame.centerX - w / 2;
  const y0 = frame.centerY - h / 2;
  const gx = Math.round(x0 / cell);
  const gy = Math.round(y0 / cell);
  const deviation = Math.max(Math.abs(gx * cell - x0), Math.abs(gy * cell - y0)) / cell;
  const rotationOff = Math.abs(normaliseDeg(frame.rot)) > ROT_TOLERANCE_DEG;
  return { cols, rows, gx, gy, deviation, aligned: deviation <= SNAP_TOLERANCE_CELLS && !rotationOff };
}

/** Take the memory snapshot for a frame that is currently aligned. */
export function snapshotRef(frame: Frame, target: AlignTarget): AnchorRef {
  return {
    gx: target.gx,
    gy: target.gy,
    cols: target.cols,
    rows: target.rows,
    px: frame.px,
    py: frame.py,
    rot: frame.rot,
    sx: frame.sx,
    sy: frame.sy,
  };
}

/**
 * Map a memorised box into the current frame.
 *
 * `getImageCenter` is `world = position + R(rot) · S · p_local`, so the
 * world-space offset recorded while aligned transforms as
 *
 *     world_now = pos_now + K · (world_ref − pos_ref),   K = diag(sx/sx_ref, sy/sy_ref)
 *
 * which preserves the in-cell offset under translation, scale and mirror
 * (a mirror is just a negative scale ratio, so the box lands on the
 * mirrored side without any special case). Rotation is intentionally left
 * out — see the module header.
 */
export function followRef(
  ref: AnchorRef,
  frame: Frame,
  dpi: number,
): { centerX: number; centerY: number; width: number; height: number } {
  const cell = Number.isFinite(dpi) && dpi > 0 ? dpi : 150;
  const cols = Math.min(MAX_OCCUPANCY, Math.max(1, Math.abs(ref.cols) || 1));
  const rows = Math.min(MAX_OCCUPANCY, Math.max(1, Math.abs(ref.rows) || 1));
  const kx = Number.isFinite(ref.sx) && ref.sx !== 0 ? frame.sx / ref.sx : 1;
  const ky = Number.isFinite(ref.sy) && ref.sy !== 0 ? frame.sy / ref.sy : 1;
  // Centre of the memorised box, in the frame it was taken in.
  const refCx = ref.gx * cell + (cols * cell) / 2;
  const refCy = ref.gy * cell + (rows * cell) / 2;
  return {
    centerX: frame.px + (refCx - ref.px) * kx,
    centerY: frame.py + (refCy - ref.py) * ky,
    width: cols * cell * Math.abs(kx),
    height: rows * cell * Math.abs(ky),
  };
}

/**
 * Pick the box for this frame.
 *
 * Returns `null` when the token is neither aligned nor memorised — the
 * caller then keeps the canvas rect, which is also the whole behaviour
 * when `anchorMode` is left at `"canvas"`.
 */
export function resolveAnchorBox(
  frame: Frame,
  dpi: number,
  ref: AnchorRef | null | undefined,
): AnchorResolution | null {
  const cell = Number.isFinite(dpi) && dpi > 0 ? dpi : 150;
  const target = alignTarget(frame, cell);

  if (target.aligned) {
    const w = target.cols * cell;
    const h = target.rows * cell;
    return {
      box: {
        centerX: target.gx * cell + w / 2,
        centerY: target.gy * cell + h / 2,
        width: w,
        height: h,
        cols: target.cols,
        rows: target.rows,
        source: "grid",
      },
      snapshot: snapshotRef(frame, target),
    };
  }

  if (!ref) return null;
  const f = followRef(ref, frame, cell);
  return {
    box: { ...f, cols: Math.max(1, Math.abs(ref.cols) || 1), rows: Math.max(1, Math.abs(ref.rows) || 1), source: "memory" },
    snapshot: null,
  };
}
