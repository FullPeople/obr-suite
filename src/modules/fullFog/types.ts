// fullFog — Photoshop-style fog/wall extraction editor for map images.
// Constants + shared types.

export const PLUGIN_ID = "com.obr-suite/fullFog";

// Metadata key written on the saved Path item so we can find / replace
// our output cleanly when the DM re-edits.
export const FOG_PATH_KEY = `${PLUGIN_ID}/wall`;

// Metadata key on the Path item linking it back to the source map.
export const FOG_MAP_KEY = `${PLUGIN_ID}/map`;

// Metadata key on the saved Path item that carries an array of
// map-local polylines describing the wall geometry. The fullFog
// background watcher reads this and creates corresponding native
// Wall items in OBR.scene.local on each client — Wall items live
// in the LOCAL (per-client) scene, not the shared scene, so they
// must be reconstructed at scene-ready / on path change.
export const FOG_WALL_POLYLINES_KEY = `${PLUGIN_ID}/wallPolylines`;

// Metadata key on the outline Path item that carries the
// `wallExpandPx` value used at save time. The wall watcher reads
// this, in IMAGE pixels, and erodes the sampled polylines inward
// by that distance before deriving Walls — pushing the actual
// blocking wall N pixels INTO the wall material vs the visible
// edge. See EditorPrefs.wallExpandPx for full rationale.
export const FOG_WALL_EXPAND_KEY = `${PLUGIN_ID}/wallExpandPx`;

// Modal id (for OBR.modal.open / close).
export const MODAL_ID = `${PLUGIN_ID}/edit`;

// Context menu entry id.
export const CTX_EDIT_FOG = `${PLUGIN_ID}/ctx-edit`;

// LocalStorage key for editor preferences (last-used algorithm,
// brush size, etc.). Per-client only.
export const LS_PREFS = `${PLUGIN_ID}/prefs`;

// Algorithm identifiers — keep them stable, persisted.
export type AlgorithmId =
  | "threshold"
  | "otsu"
  | "adaptive"
  | "colorDistance"
  | "colorExclude"
  | "satAware";

export interface AlgorithmParams {
  threshold: { T: number };
  otsu: { offset: number }; // T = OtsuT + offset
  adaptive: { block: number; C: number };
  colorDistance: { r: number; g: number; b: number; tol: number };
  colorExclude: { T: number };
  satAware: { T: number; maxSat: number };
}

export type ToolId =
  | "pan"
  | "brush"
  | "eraser"
  | "lasso"
  | "polygon"
  | "rectangle"
  | "line"
  | "magicWand"
  | "paintBucket"
  | "picker";

/** Tools that have a per-tool ADD / ERASE mode toggle (right-click
 *  the tool button to flip). Brush/eraser are separate tools so they
 *  don't appear here; magic-wand/bucket/picker have no mode. */
export type ShapeToolId = "lasso" | "polygon" | "rectangle" | "line";

export type ShapeMode = "add" | "erase";

export interface Vec2 { x: number; y: number; }

export interface RefinementParams {
  openK: number;        // morphological open kernel (0 = off)
  closeK: number;       // morphological close kernel (0 = off)
  minArea: number;      // remove CC < this px (0 = off)
  holeFillMaxArea: number; // selective hole-fill cap (0 = off)
  /** Removes thin grid / floor-seam lines via morphological opening
   *  with a small kernel. Run AFTER the algorithm produces an initial
   *  mask, BEFORE the user-tunable open/close. Default 0 = off. */
  thinLineK: number;
}

/** Display mode: "color" shows the source image as the base layer
 *  with mask tinted orange. "threshold" shows ONLY the fog/mask as
 *  pure B&W (white background, black where mask=255), with no source
 *  underneath — what-you-see-is-what-saves. */
export type DisplayMode = "color" | "threshold";

/** Output mode: which OBR item type(s) the save operation produces.
 *   - "wall": native Wall items (line segments) — feeds OBR's
 *     dynamic-fog vision system. Invisible by default.
 *   - "path": single Path item (filled / stroked polygons / curves)
 *     — visual obstacle representation, NOT used for vision.
 *   - "both": save Wall + Path together. Path gives visual confirm,
 *     Walls drive vision. Recommended default. */
export type OutputMode = "wall" | "path" | "both";

export interface EditorPrefs {
  algorithm: AlgorithmId;
  params: AlgorithmParams;
  refinement: RefinementParams;
  brushRadius: number;
  wandTolerance: number;
  bucketTolerance: number;
  preFilter: "none" | "gauss3" | "gauss5" | "bilateral";
  livePreview: boolean;
  displayMode: DisplayMode;
  outputMode: OutputMode;
  /** Wall expand (image pixels). Signed offset between the GM-visible
   *  Path outline (always at the original boundary) and the BLOCKING
   *  Wall items derived from it.
   *    > 0  →  Wall expands OUTWARD into the floor side. Player
   *            vision stops N pixels before reaching the precise
   *            wall edge — fog hides the exact wall outline, players
   *            only sense "there's something out there".
   *    < 0  →  Wall shrinks INWARD into the wall material. Vision
   *            passes the visible edge and stops N pixels into the
   *            wall — players see a sliver of wall texture, gaining
   *            a sense of wall thickness without seeing the far side.
   *    = 0  →  Wall flush with visible edge (legacy behaviour).
   *  Per chat consensus 2026-05-09 (MOGA's two-layer plan; SDK
   *  shader / blur approaches were ruled out). Slider range
   *  [-40, +40] px in the editor. */
  wallExpandPx: number;
  /** Cardinal-spline tension applied to contours before saving.
   *  0 = polygon edges as-is; 0.4 = smooth curves. Visually
   *  noticeable above 0.2. Stored separately from refinement
   *  because smoothing happens at OUTPUT time, not on the mask. */
  smoothingTension: number;
  /** Number of Chaikin corner-cutting iterations applied BEFORE
   *  smoothing. Each iter halves the corner sharpness. 0 = off. */
  chaikinIters: number;
  /** Output-time jaggy cleanup: kernel size for morph close + open
   *  applied to a TEMP COPY of the mask before contour tracing.
   *  Eliminates pixel-level fuzzy edges from rough mask boundaries
   *  (e.g. trees, rocks) without modifying the editing mask itself.
   *  0 = off; 3 = default (good for most maps); 5+ = very smooth. */
  outputSmoothK: number;
  /** Per-shape-tool add/erase mode. Right-click on a shape tool's
   *  toolbar button toggles its entry here. Persists to localStorage
   *  so the user's preferred mode survives reloads. */
  toolModes: Record<ShapeToolId, ShapeMode>;
  /** When true, polygon/rectangle/line endpoints snap to the map
   *  image's grid intersections. Hold Ctrl to temporarily flip
   *  during a stroke. */
  gridSnap: boolean;
}

export const DEFAULT_PREFS: EditorPrefs = {
  algorithm: "otsu",
  params: {
    threshold: { T: 110 },
    otsu: { offset: 0 },
    adaptive: { block: 51, C: 10 },
    colorDistance: { r: 0, g: 0, b: 0, tol: 80 },
    colorExclude: { T: 120 },
    satAware: { T: 110, maxSat: 80 },
  },
  refinement: {
    openK: 0,
    closeK: 0,
    minArea: 200,
    holeFillMaxArea: 0,
    thinLineK: 0,
  },
  brushRadius: 20,
  wandTolerance: 24,
  bucketTolerance: 0,
  preFilter: "none",
  livePreview: true,
  displayMode: "color",
  outputMode: "both",
  // Default 0 = Wall flush with visible edge. Direction was reversed
  // 2026-05-08 (positive used to mean inward erode; now positive
  // means outward expand into floor). Letting users pick their own
  // sign + magnitude in the editor avoids surprising existing scenes.
  wallExpandPx: 0,
  // Default everything that rounds geometry to 0: the user wants
  // saved walls/paths to match drawn pixels exactly (right-angle map
  // edges + sharp corners must be preserved). The four UI sliders
  // for these are hidden in fullfog-edit.html; the prefs remain in
  // case we need to re-expose them later.
  smoothingTension: 0,
  chaikinIters: 0,
  outputSmoothK: 0,
  toolModes: {
    lasso: "erase",
    polygon: "erase",
    rectangle: "erase",
    line: "add",
  },
  gridSnap: false,
};
