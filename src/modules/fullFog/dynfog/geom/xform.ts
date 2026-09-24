// Item ↔ world coordinate transforms.
//
// Port of upstream `src/background/util/math.ts`, plus a cached
// matrix helper so a drag loop doesn't rebuild the same matrix on
// every pointer move.

import { MathM, type Item, type Matrix, type Vector2 } from "@owlbear-rodeo/sdk";

/** Transform matrix of an item (position · rotation · scale). */
export function itemMatrix(item: Item): Matrix {
  return MathM.fromItem(item);
}

/** The do-nothing transform, for actors that have not seen a parent
 *  yet. `MathM` has no `identity()`, so build it from a zero item. */
export function identityMatrix(): Matrix {
  return MathM.fromPosition({ x: 0, y: 0 });
}

/** item-local point → world point. */
export function transformPoint(matrix: Matrix, point: Vector2): Vector2 {
  const p = MathM.fromPosition(point);
  return MathM.decompose(MathM.multiply(matrix, p)).position;
}

/** world point → item-local point. */
export function inverseTransformPoint(
  matrix: Matrix,
  point: Vector2,
): Vector2 {
  const p = MathM.fromPosition(point);
  const inverse = MathM.inverse(matrix);
  return MathM.decompose(MathM.multiply(inverse, p)).position;
}

/**
 * Same, for a whole polyline against ONE matrix.
 *
 * `inverseTransformPoint` inverts the matrix it is given, so mapping it
 * over N points inverted the same matrix N times. Cuts are re-expressed
 * in a neighbour's local space on every wall re-derivation, which is
 * every door toggle in the scene, so that multiplied up.
 *
 * The per-point arithmetic is untouched — same `multiply`, same
 * `decompose`, same order — so the output is identical, not merely
 * equivalent.
 */
export function inverseTransformPoints(
  matrix: Matrix,
  points: Vector2[],
): Vector2[] {
  const inverse = MathM.inverse(matrix);
  return points.map(
    (point) =>
      MathM.decompose(MathM.multiply(inverse, MathM.fromPosition(point)))
        .position,
  );
}

/** Uniform-ish world scale factor of a matrix, used to convert a
 *  world-space distance threshold (e.g. the door tool's 75px snap)
 *  into the item's local units. Non-uniform scales fall back to the
 *  geometric mean, which is the best single number available. */
export function matrixScaleFactor(matrix: Matrix): number {
  const { scale } = MathM.decompose(matrix);
  const sx = Math.abs(scale.x) || 1;
  const sy = Math.abs(scale.y) || 1;
  return Math.sqrt(sx * sy) || 1;
}
