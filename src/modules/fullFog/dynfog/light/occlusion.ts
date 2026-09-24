// Per-client authorization and illumination are separate. PRIMARY and
// AUXILIARY can reveal only authorized personal/team sources. Other lights
// become SECONDARY: they may illuminate an already authorized PRIMARY view,
// with optional non-transitive wall reachability filtering. An automatic
// ambient light keeps its deliberate public vision exemption; explicit owner
// restrictions and private cards take precedence. Hidden ancestors never
// reveal. The GM sees visible sources. This pass runs on committed changes,
// not per frame, and does not approximate or record historical fog.

import type { Reconciler } from "../reconcile/Reconciler";
import { LightReactor, SelfLightReactor } from "../reconcile/reactors/LightReactor";
import { WallReactor } from "../reconcile/reactors/WallReactor";
import {
  getLightOcclusionEnabled,
  getSceneDpi,
  getShareVisionEnabled,
  getVisionContext,
  isGM,
} from "../runtime";
import { EMPTY_WALL_INDEX, WallIndex } from "./wallIndex";
import { resolveVisionSource } from "./visionPolicy";

/**
 * How far into the sight line to ignore walls, as a fraction of one
 * grid cell. A wall sconce token sits ON the wall it hangs from, and a
 * torchbearer standing in a doorway sits between two wall stubs —
 * without this both would be permanently self-occluded.
 */
const TRIM_CELLS = 0.18;

export class LightOcclusion {
  private reconciler: Reconciler;
  private index: WallIndex = EMPTY_WALL_INDEX;
  /** `WallReactor.geometrySignature()` the index was built from. null
   *  means "no index held". */
  private indexSignature: string | null = null;

  constructor(reconciler: Reconciler) {
    this.reconciler = reconciler;
  }

  /** Drop the cached index — call when occlusion is switched off or the
   *  engine is torn down, so a big traced map is not pinned in memory. */
  reset(): void {
    this.index = EMPTY_WALL_INDEX;
    this.indexSignature = null;
  }

  run(): void {
    const lights = this.reconciler.find(LightReactor);
    if (!lights) return;
    const actors = lights.getActors();
    const selfLights = this.reconciler.find(SelfLightReactor)?.getActors() ?? [];
    if (actors.length === 0 && selfLights.length === 0) return;

    const context = getVisionContext();
    const shared = getShareVisionEnabled();
    const gm = isGM();
    const occlude = getLightOcclusionEnabled();
    const sources = new Map(actors.map(actor => {
      const parent = this.reconciler.getItem(actor.parentId);
      const source = parent ? resolveVisionSource(parent, context, id => this.reconciler.getItem(id))
        : { visible: false, personal: false, team: false, publicAmbient: false };
      return [actor, source] as const;
    }));
    // SECONDARY illuminates a PRIMARY's field; AUXILIARY reveals but does
    // not activate SECONDARY. Neither is an extra primary sight-line anchor.
    const own = actors.filter(actor => {
      const source = sources.get(actor)!;
      return source.visible && actor.lightType === "PRIMARY" && (source.personal || (context.playerIds.has(context.playerId) && shared && source.team));
    });
    const index = !gm && occlude ? this.ensureIndex() : EMPTY_WALL_INDEX;
    if (gm || !occlude) this.reset();
    const trim = getSceneDpi() * TRIM_CELLS;

    const verdict = new Map<string, boolean>();
    for (const actor of actors) {
      const source = sources.get(actor)!;
      const authorized = gm || source.personal || (context.playerIds.has(context.playerId) && shared && source.team) || (actor.ambient && source.publicAmbient);
      const reveals = source.visible && authorized && actor.lightType !== "SECONDARY";
      const allowed = source.visible && (gm || authorized || !occlude ||
        own.some(origin => !index.blocked(origin.position, actor.position, trim)));
      // Foreign revealing lights may still illuminate an authorized PRIMARY's
      // view. Turning off light occlusion never grants them independent vision.
      actor.setAccess(allowed, reveals);
      verdict.set(actor.parentId, allowed && reveals);
    }

    // A self light reveals fog too: illumination-only permission is not enough.
    for (const actor of selfLights) {
      actor.setAllowed(verdict.get(actor.parentId) ?? false);
    }
  }

  private ensureIndex(): WallIndex {
    const walls = this.reconciler.find(WallReactor);
    if (!walls) return EMPTY_WALL_INDEX;
    const signature = walls.geometrySignature();
    if (this.indexSignature === signature) return this.index;
    this.index = WallIndex.build(walls.worldPolylines());
    this.indexSignature = signature;
    return this.index;
  }
}
