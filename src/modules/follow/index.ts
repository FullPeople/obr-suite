// Follow plugin — see types.ts for the data model.
//
// Flow:
//  1. GM right-clicks a CHARACTER/MOUNT token → context menu "跟随"
//     → ctxAddFollow caches the source id, activates the follow tool,
//     and shows a notification.
//  2. The follow tool's mode draws a dashed binding line from the
//     source's world position to the cursor, updated in onToolMove.
//  3. First left-click on any other token (in the same scene) →
//     bindFollow: compute offset, write FollowConfig to source's
//     metadata, clear the line, switch back to the move tool.
//  4. Watcher (every client): items.onChange compares each follower's
//     position against `target.position + offset`. Mismatch → update
//     the follower. Idempotency check makes 2-cycles converge in one
//     pass; longer cycles are rejected at bind time.

import OBR, {
  buildPath,
  Command,
  type Item,
} from "@owlbear-rodeo/sdk";
import { assetUrl } from "../../asset-base";
import {
  FOLLOW_PLUGIN_ID,
  FOLLOW_KEY,
  FOLLOW_TOOL_ID,
  FOLLOW_MODE_ID,
  CTX_FOLLOW_ADD,
  CTX_FOLLOW_REMOVE,
  type FollowConfig,
} from "./types";
import { findPath, wallsToSegments, type WallSegment } from "./pathfinding";

const ICON_URL = assetUrl("follow-icon.svg");

let registered = false;
const unsubs: Array<() => void> = [];

// Local state during the binding-line phase.
let pendingSourceId: string | null = null;
let bindingLineId: string | null = null;

// Last seen target positions — used to skip work when nothing moved.
const lastTargetPositions = new Map<string, { x: number; y: number }>();

// ---------------------------------------------------------------------------
// Context menu handlers

async function ctxAddFollow(itemIds: string[]): Promise<void> {
  if (itemIds.length === 0) return;
  pendingSourceId = itemIds[0];
  try {
    await OBR.tool.activateTool(FOLLOW_TOOL_ID);
  } catch (e) {
    console.warn("[follow] activate tool failed", e);
  }
  try {
    await OBR.notification.show(
      "请左键点击要跟随的目标 token（按 Esc 取消）",
      "INFO",
    );
  } catch {}
}

async function ctxRemoveFollow(itemIds: string[]): Promise<void> {
  if (itemIds.length === 0) return;
  try {
    await OBR.scene.items.updateItems(itemIds, (drafts) => {
      for (const d of drafts) {
        const meta = (d.metadata as any) ?? {};
        if (FOLLOW_KEY in meta) {
          delete meta[FOLLOW_KEY];
          d.metadata = meta;
        }
      }
    });
  } catch (e) {
    console.warn("[follow] remove follow failed", e);
  }
}

// ---------------------------------------------------------------------------
// Binding line

async function clearBindingLine(): Promise<void> {
  if (bindingLineId) {
    try { await OBR.scene.local.deleteItems([bindingLineId]); } catch {}
    bindingLineId = null;
  }
}

async function ensureBindingLine(targetWorld: {
  x: number;
  y: number;
}): Promise<void> {
  if (!pendingSourceId) return;
  let sourcePos: { x: number; y: number } | null = null;
  try {
    const items = await OBR.scene.items.getItems([pendingSourceId]);
    if (items.length === 0) return;
    sourcePos = (items[0] as any).position ?? null;
  } catch { return; }
  if (!sourcePos) return;
  const cmds: any[] = [
    [Command.MOVE, sourcePos.x, sourcePos.y],
    [Command.LINE, targetWorld.x, targetWorld.y],
  ];
  if (bindingLineId) {
    try {
      await OBR.scene.local.updateItems([bindingLineId], (drafts) => {
        for (const d of drafts) {
          (d as any).commands = cmds;
        }
      });
    } catch {}
    return;
  }
  const path = buildPath()
    .commands(cmds)
    .strokeColor("#5dade2")
    .strokeWidth(6)
    .strokeOpacity(0.85)
    .strokeDash([12, 8])
    .fillOpacity(0)
    .layer("CONTROL")
    .disableHit(true)
    .locked(true)
    .build();
  bindingLineId = path.id;
  try { await OBR.scene.local.addItems([path]); } catch {}
}

// ---------------------------------------------------------------------------
// Cycle detection + bind

async function wouldCreateCycle(
  sourceId: string,
  newTargetId: string,
): Promise<boolean> {
  // Walk the existing follow chain starting from newTargetId. If we
  // revisit sourceId, the new bind would close a cycle.
  const visited = new Set<string>([sourceId]);
  let cur = newTargetId;
  for (let safety = 0; safety < 64; safety++) {
    if (visited.has(cur)) return true;
    visited.add(cur);
    let nextTarget: string | null = null;
    try {
      const items = await OBR.scene.items.getItems([cur]);
      if (items.length === 0) return false;
      const cfg = (items[0].metadata as any)?.[FOLLOW_KEY] as
        | FollowConfig
        | undefined;
      nextTarget = cfg?.targetId ?? null;
    } catch { return false; }
    if (!nextTarget) return false;
    cur = nextTarget;
  }
  return true;
}

async function bindFollow(sourceId: string, targetId: string): Promise<void> {
  if (sourceId === targetId) return;
  if (await wouldCreateCycle(sourceId, targetId)) {
    try {
      await OBR.notification.show(
        "跟随会形成循环，无法绑定",
        "ERROR",
      );
    } catch {}
    return;
  }
  let sp: { x: number; y: number } | null = null;
  let tp: { x: number; y: number } | null = null;
  let sourceName = "源";
  let targetName = "目标";
  try {
    const items = await OBR.scene.items.getItems([sourceId, targetId]);
    const source = items.find((i) => i.id === sourceId);
    const target = items.find((i) => i.id === targetId);
    if (!source || !target) return;
    sp = (source as any).position ?? null;
    tp = (target as any).position ?? null;
    sourceName = (source as any).name ?? sourceName;
    targetName = (target as any).name ?? targetName;
  } catch { return; }
  if (!sp || !tp) return;
  const offset = { x: sp.x - tp.x, y: sp.y - tp.y };
  try {
    await OBR.scene.items.updateItems([sourceId], (drafts) => {
      for (const d of drafts) {
        const meta = (d.metadata as any) ?? {};
        meta[FOLLOW_KEY] = { targetId, offset } satisfies FollowConfig;
        d.metadata = meta;
      }
    });
    try {
      await OBR.notification.show(
        `已绑定跟随：${sourceName} → ${targetName}`,
        "SUCCESS",
      );
    } catch {}
  } catch (e) {
    console.warn("[follow] bind failed", e);
  }
}

// ---------------------------------------------------------------------------
// DM-side per-frame follow animation via OBR.interaction.
//
// Earlier draft: every client computed A* and pushed updateItems
// commits 130 ms apart. Felt choppy + every commit fired a fresh
// items.onChange that re-triggered the planner ⇒ "时灵时不灵".
//
// New approach:
//  - Only the GM client runs the planner / animator. Players just
//    observe the follow movement through OBR's normal scene sync.
//  - The GM uses `OBR.interaction.startItemInteraction(follower)` to
//    push 60 fps position updates. Other clients see the smooth
//    in-flight motion (the same machinery OBR uses internally for
//    drag-to-move on tokens).
//  - The path is sampled every requestAnimationFrame and lerped
//    between adjacent waypoints, so the animation is independent of
//    waypoint count — long paths stay smooth, short paths still
//    take ~CELL_DURATION_MS per cell.

interface Animation {
  followerId: string;
  path: Array<{ x: number; y: number }>;
  /** Wall-clock time the animation started. */
  startTs: number;
  /** Total animation duration in ms. */
  totalMs: number;
  /** Target position the path was planned for; if the target drifts
   *  more than half a cell we'll replan from the current position. */
  plannedTargetPos: { x: number; y: number };
  plannedWallCount: number;
  /** OBR interaction handle. */
  interaction: { update: (fn: (d: any) => void) => any; stop: () => void };
  /** Latest interpolated position pushed via interaction.update.
   *  Used as the planning start when we replan mid-animation —
   *  reading follower.position via getItems would return the OLD
   *  pre-interaction value (interaction state isn't committed) and
   *  cause a visible snap-back-then-replay. */
  lastInterpolatedPos: { x: number; y: number };
  /** Frame timer id (setInterval). rAF in a background iframe gets
   *  throttled hard; setInterval keeps a steady ~60 fps cadence. */
  intervalId: number | null;
}

const animations = new Map<string, Animation>();
const CELL_DURATION_MS = 110;
const FRAME_INTERVAL_MS = 16;
/** Replan if target has moved further than half a cell since the last
 *  plan. Matches the A* cell granularity. */
const REPATH_THRESHOLD_RATIO = 0.5;
/** Path-clearance from walls in cells. 0.4 keeps the follower at
 *  least 40% of a cell away from any wall — wide enough to avoid
 *  the "glued to wall corner" failure mode the user reported. */
const CLEARANCE_CELLS = 0.4;

async function fetchSceneWalls(): Promise<WallSegment[]> {
  let raw: any[] = [];
  try {
    raw = await OBR.scene.local.getItems((it: any) => it.type === "WALL");
  } catch {}
  return wallsToSegments(raw);
}

async function getSceneDpi(): Promise<number> {
  try { return await OBR.scene.grid.getDpi(); } catch { return 150; }
}

function cancelAnimation(followerId: string): void {
  const anim = animations.get(followerId);
  if (!anim) return;
  if (anim.intervalId != null) {
    clearInterval(anim.intervalId);
    anim.intervalId = null;
  }
  try { anim.interaction.stop(); } catch {}
  animations.delete(followerId);
}

/** Compute the world-space position at time `t` (0..1) along a piece-
 *  wise-linear path. Each segment is treated as equal duration —
 *  matches the way A* gives equal-cell-cost waypoints. */
function lerpAlongPath(path: Array<{ x: number; y: number }>, t: number): { x: number; y: number } {
  if (path.length === 0) return { x: 0, y: 0 };
  if (path.length === 1) return { ...path[0] };
  const clamped = Math.max(0, Math.min(1, t));
  const idx = clamped * (path.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.min(lo + 1, path.length - 1);
  const f = idx - lo;
  return {
    x: path[lo].x * (1 - f) + path[hi].x * f,
    y: path[lo].y * (1 - f) + path[hi].y * f,
  };
}

async function planAndStart(
  follower: Item,
  startOverride: { x: number; y: number } | null,
  targetPos: { x: number; y: number },
  offset: { x: number; y: number },
  walls: WallSegment[],
  dpi: number,
): Promise<void> {
  // Plan from the LATEST visible position, not from getItems' stale
  // pre-interaction value. The caller passes `startOverride` =
  // existing animation's lastInterpolatedPos when replanning, so the
  // new path picks up exactly where the current one is rendering.
  const start = startOverride ?? (follower as any).position;
  if (!start) return;
  const goal = { x: targetPos.x + offset.x, y: targetPos.y + offset.y };
  if (Math.hypot(goal.x - start.x, goal.y - start.y) < dpi * 0.5) {
    cancelAnimation(follower.id);
    return;
  }
  const path = findPath(start, goal, walls, dpi, dpi * CLEARANCE_CELLS);
  if (!path || path.length < 2) {
    cancelAnimation(follower.id);
    return;
  }
  cancelAnimation(follower.id);

  // Spin up an OBR.interaction so other clients see smooth motion.
  // Pass the CURRENT follower with the patched start position so
  // the interaction doesn't visibly snap to follower.position.
  const baseItem = startOverride
    ? { ...(follower as any), position: { x: start.x, y: start.y } }
    : follower;
  let manager;
  try {
    manager = await OBR.interaction.startItemInteraction(baseItem as Item);
  } catch (e) {
    console.warn("[follow] startItemInteraction failed", e);
    return;
  }
  const [update, stop] = manager;

  const totalMs = Math.max(150, (path.length - 1) * CELL_DURATION_MS);
  const anim: Animation = {
    followerId: follower.id,
    path,
    startTs: performance.now(),
    totalMs,
    plannedTargetPos: { x: targetPos.x, y: targetPos.y },
    plannedWallCount: walls.length,
    interaction: { update, stop },
    lastInterpolatedPos: { x: start.x, y: start.y },
    intervalId: null,
  };
  animations.set(follower.id, anim);

  const tick = () => {
    const cur = animations.get(follower.id);
    if (!cur) return;
    const elapsed = performance.now() - cur.startTs;
    const t = Math.min(1, elapsed / cur.totalMs);
    const pos = lerpAlongPath(cur.path, t);
    cur.lastInterpolatedPos = { x: pos.x, y: pos.y };
    try {
      cur.interaction.update((d: any) => { d.position = pos; });
    } catch {}
    if (t >= 1) {
      if (cur.intervalId != null) {
        clearInterval(cur.intervalId);
        cur.intervalId = null;
      }
      try { cur.interaction.stop(); } catch {}
      animations.delete(follower.id);
      // Final commit so the follower's "real" position is stored —
      // interaction.stop() commits the last interaction state, but
      // an explicit updateItems is belt-and-braces against any race.
      void OBR.scene.items.updateItems([follower.id], (drafts) => {
        for (const d of drafts) (d as any).position = pos;
      }).catch(() => {});
    }
  };
  anim.intervalId = window.setInterval(tick, FRAME_INTERVAL_MS);
  // Fire one tick synchronously so the very first frame doesn't wait
  // 16 ms — slight perceived latency reduction at the animation start.
  tick();
}

async function onItemsChange(items: Item[]): Promise<void> {
  // Only the GM runs the planner / animator. Other clients see the
  // motion via the GM's OBR.interaction broadcast.
  if (myRoleForFollow !== "GM") return;

  const followers: Array<{ source: Item; cfg: FollowConfig }> = [];
  for (const it of items) {
    const cfg = (it.metadata as any)?.[FOLLOW_KEY] as FollowConfig | undefined;
    if (cfg && typeof cfg.targetId === "string" && cfg.offset) {
      followers.push({ source: it, cfg });
    }
  }
  if (followers.length === 0) return;
  const itemMap = new Map(items.map((i) => [i.id, i]));

  const walls = await fetchSceneWalls();
  const dpi = await getSceneDpi();

  for (const f of followers) {
    const target = itemMap.get(f.cfg.targetId);
    if (!target) {
      cancelAnimation(f.source.id);
      continue;
    }
    const targetPos = (target as any).position;
    if (!targetPos) continue;
    const sourcePos = (f.source as any).position;
    if (!sourcePos) continue;
    const desired = {
      x: targetPos.x + f.cfg.offset.x,
      y: targetPos.y + f.cfg.offset.y,
    };
    // Already where we should be → cancel any in-flight animation.
    if (
      Math.abs(sourcePos.x - desired.x) < 0.5 &&
      Math.abs(sourcePos.y - desired.y) < 0.5
    ) {
      cancelAnimation(f.source.id);
      lastTargetPositions.set(f.cfg.targetId, { x: targetPos.x, y: targetPos.y });
      continue;
    }
    // Replan only if the TARGET drifted meaningfully since last plan,
    // AND there isn't already an animation in flight whose plan still
    // matches. Keeps us from spamming A* every items.onChange tick
    // (the animation itself doesn't fire onChange — interaction is
    // a separate channel — but other unrelated scene edits still do).
    const existing = animations.get(f.source.id);
    let startOverride: { x: number; y: number } | null = null;
    if (existing) {
      const dx = targetPos.x - existing.plannedTargetPos.x;
      const dy = targetPos.y - existing.plannedTargetPos.y;
      if (
        Math.hypot(dx, dy) < dpi * REPATH_THRESHOLD_RATIO &&
        existing.plannedWallCount === walls.length
      ) {
        continue;
      }
      // Replanning mid-animation: keep the visible follower position
      // pinned to wherever the current interpolation has it, so the
      // new path picks up smoothly without a snap-back.
      startOverride = { ...existing.lastInterpolatedPos };
    }
    await planAndStart(f.source, startOverride, targetPos, f.cfg.offset, walls, dpi);
    lastTargetPositions.set(f.cfg.targetId, { x: targetPos.x, y: targetPos.y });
  }
}

let myRoleForFollow: "GM" | "PLAYER" = "PLAYER";

// ---------------------------------------------------------------------------
// Setup / teardown

export async function setupFollow(): Promise<void> {
  if (registered) return;
  registered = true;

  let role: "GM" | "PLAYER" = "PLAYER";
  try { role = (await OBR.player.getRole()) as "GM" | "PLAYER"; } catch {}
  myRoleForFollow = role;
  // Track future role changes so the planner switches on/off without
  // requiring a teardown/setup cycle.
  unsubs.push(
    OBR.player.onChange((p) => {
      if (p.role === "GM" || p.role === "PLAYER") myRoleForFollow = p.role;
    }),
  );

  // Context menus + tool — GM only. Players still run the watcher
  // (so their local view shows the GM's auto-follows), but they can't
  // create / remove bindings.
  if (role === "GM") {
    try {
      await OBR.contextMenu.create({
        id: CTX_FOLLOW_ADD,
        icons: [{
          icon: ICON_URL,
          label: "跟随",
          filter: {
            every: [
              { key: "type", value: "IMAGE" },
              { key: "layer", value: "CHARACTER" },
            ],
            // Show "跟随" only when the token does NOT already have a
            // follow config — pairs with the symmetric "取消跟随"
            // entry below.
            some: [
              {
                key: ["metadata", FOLLOW_KEY],
                value: undefined,
                operator: "==",
              },
            ],
            max: 1,
          },
        }],
        onClick: async (ctx) => {
          await ctxAddFollow(ctx.items.map((i) => i.id));
        },
      });
    } catch (e) {
      console.warn("[follow] add ctx menu failed", e);
    }

    try {
      await OBR.contextMenu.create({
        id: CTX_FOLLOW_REMOVE,
        icons: [{
          icon: ICON_URL,
          label: "取消跟随",
          filter: {
            every: [
              { key: "type", value: "IMAGE" },
              {
                key: ["metadata", FOLLOW_KEY],
                value: undefined,
                operator: "!=",
              },
            ],
          },
        }],
        onClick: async (ctx) => {
          await ctxRemoveFollow(ctx.items.map((i) => i.id));
        },
      });
    } catch (e) {
      console.warn("[follow] remove ctx menu failed", e);
    }

    // Custom tool + its single mode. Tool sits in the sidebar so the
    // GM can re-enter the binding flow without bouncing through the
    // context menu, but the activation typically comes from the
    // ctxAddFollow path which sets pendingSourceId first.
    try {
      await OBR.tool.create({
        id: FOLLOW_TOOL_ID,
        icons: [{
          icon: ICON_URL,
          label: "跟随绑定",
        }],
      });
      await OBR.tool.createMode({
        id: FOLLOW_MODE_ID,
        icons: [{
          icon: ICON_URL,
          label: "绑定目标",
          filter: { activeTools: [FOLLOW_TOOL_ID] },
        }],
        cursors: [{ cursor: "crosshair" }],
        async onToolMove(_, event) {
          if (!pendingSourceId) return;
          await ensureBindingLine(event.pointerPosition);
        },
        async onToolClick(_, event) {
          if (!pendingSourceId) {
            // No source set — switch back to select tool, the user
            // probably opened this from the sidebar without a context
            // menu source.
            try {
              await OBR.tool.activateTool("rodeo.owlbear.tool/move");
            } catch {}
            return;
          }
          const targetId = event.target?.id;
          if (!targetId || targetId === pendingSourceId) return;
          const sourceId = pendingSourceId;
          pendingSourceId = null;
          await clearBindingLine();
          await bindFollow(sourceId, targetId);
          try {
            await OBR.tool.activateTool("rodeo.owlbear.tool/move");
          } catch {}
        },
        async onDeactivate() {
          await clearBindingLine();
          pendingSourceId = null;
        },
      });
    } catch (e) {
      console.warn("[follow] tool create failed", e);
    }
  }

  // Watcher (everyone). When a target moves we update its followers
  // so the GM's view + every player's view all see the same offset.
  unsubs.push(
    OBR.scene.items.onChange((items) => {
      void onItemsChange(items);
    }),
  );

  // Esc cancels the binding flow if the user changes their mind.
  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key === "Escape" && pendingSourceId) {
      pendingSourceId = null;
      void clearBindingLine();
      try { void OBR.tool.activateTool("rodeo.owlbear.tool/move"); } catch {}
    }
  };
  window.addEventListener("keydown", onKey);
  unsubs.push(() => window.removeEventListener("keydown", onKey));
}

export async function teardownFollow(): Promise<void> {
  if (!registered) return;
  try { await OBR.contextMenu.remove(CTX_FOLLOW_ADD); } catch {}
  try { await OBR.contextMenu.remove(CTX_FOLLOW_REMOVE); } catch {}
  try { await OBR.tool.remove(FOLLOW_TOOL_ID); } catch {}
  for (const u of unsubs.splice(0)) u();
  await clearBindingLine();
  pendingSourceId = null;
  lastTargetPositions.clear();
  // Cancel every in-flight follow animation.
  for (const id of [...animations.keys()]) cancelAnimation(id);
  registered = false;
}

void FOLLOW_PLUGIN_ID;
