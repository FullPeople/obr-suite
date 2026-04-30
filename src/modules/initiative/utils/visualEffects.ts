import OBR, { buildImage } from "@owlbear-rodeo/sdk";
import { assetUrl } from "../../../asset-base";

// Persistent ring strategy: we keep ONE active ring and ONE hover ring alive
// for the lifetime of the scene. Showing/hiding/moving is a single updateItems
// call instead of delete+getItems+buildImage+addItems (which was 3-4 SDK
// round-trips per focus change, the root cause of the lag on hover / next-turn).

const RING_SIZE = 200;
const ACTIVE_URL = assetUrl("ring-active.svg?v=3");
const HOVER_URL = assetUrl("ring-hover.svg?v=3");

const TAG_ACTIVE = "com.initiative-tracker/ring-active";
const TAG_HOVER = "com.initiative-tracker/ring-hover";

// Park position for hidden rings — off any reasonable map.
const PARK = { x: -1000000, y: -1000000 };

// --- Active ring ---
let activeRingId: string | null = null;
let activeTargetId: string | null = null;
let rotateTimer: ReturnType<typeof setInterval> | null = null;
let rotateAngle = 0;
// Skip a rotation tick if the previous SDK call hasn't returned yet. Keeps
// the postMessage pipe clear for user-triggered updates (hover ring, etc.).
let rotateInFlight = false;

// --- Hover ring ---
let hoverRingId: string | null = null;
let hoverTargetId: string | null = null;
let hoverAutoClear: ReturnType<typeof setTimeout> | null = null;
const HOVER_TTL_MS = 3000;

// In-flight ensureRing promise per tag so concurrent callers share the work.
const ensuring = new Map<string, Promise<string | null>>();

async function ensureRing(url: string, tag: string): Promise<string | null> {
  const pending = ensuring.get(tag);
  if (pending) return pending;

  const p = (async () => {
    try {
      // Reuse an existing ring (from a previous panel load, or a sibling iframe).
      const existing = await OBR.scene.local.getItems(
        (i) => i.metadata[tag] === true
      );
      if (existing.length > 0) {
        const keepId = existing[0].id;
        if (existing.length > 1) {
          try {
            await OBR.scene.local.deleteItems(
              existing.slice(1).map((i) => i.id)
            );
          } catch {}
        }
        return keepId;
      }
      const half = RING_SIZE / 2;
      const item = buildImage(
        { width: RING_SIZE, height: RING_SIZE, url, mime: "image/svg+xml" },
        { dpi: RING_SIZE * 0.75, offset: { x: half, y: half } }
      )
        .position(PARK)
        .locked(true)
        .layer("ATTACHMENT")
        .disableHit(true)
        .visible(false)
        .metadata({ [tag]: true })
        .disableAttachmentBehavior(["VISIBLE", "LOCKED", "COPY"])
        .build();
      await OBR.scene.local.addItems([item]);
      return item.id;
    } catch {
      return null;
    }
  })();

  ensuring.set(tag, p);
  p.finally(() => ensuring.delete(tag));
  return p;
}

// --- Active ring: swap target via a single updateItems, keep rotating. ---

export async function setActiveRing(targetId: string | null) {
  if (activeTargetId === targetId && activeRingId) return;
  activeTargetId = targetId;

  if (!activeRingId) {
    activeRingId = await ensureRing(ACTIVE_URL, TAG_ACTIVE);
    if (!activeRingId) { activeTargetId = null; return; }
  }

  if (targetId === null) {
    // Park + hide + detach. Also stop the rotation timer.
    if (rotateTimer) { clearInterval(rotateTimer); rotateTimer = null; }
    try {
      await OBR.scene.local.updateItems([activeRingId], (drafts) => {
        for (const d of drafts) {
          d.visible = false;
          d.attachedTo = undefined;
          d.position = PARK;
        }
      });
    } catch {}
    return;
  }

  // OBR does NOT snap an attached item to its target on attachment change —
  // we still need to read the target's position and set it explicitly.
  let targetPos = { x: 0, y: 0 };
  try {
    const targets = await OBR.scene.items.getItems([targetId]);
    if (targets.length === 0 || activeTargetId !== targetId) return;
    targetPos = targets[0].position;
  } catch { return; }

  const ringId = activeRingId;
  try {
    await OBR.scene.local.updateItems([ringId], (drafts) => {
      for (const d of drafts) {
        d.visible = true;
        d.attachedTo = targetId;
        d.position = targetPos;
        d.rotation = 0;
      }
    });
  } catch { return; }
  rotateAngle = 0;

  // Reuse the rotation timer across target swaps — no teardown/restart.
  // 5 FPS × 10°/tick = 7.2s per full turn, close to the original 8s look.
  // 1/3 the SDK traffic of the old 15 FPS × 3° loop. The in-flight guard
  // further prevents back-pressure when OBR is slow to apply updates, so
  // hover-ring updates aren't queued behind a rotation backlog.
  if (!rotateTimer) {
    rotateTimer = setInterval(() => {
      if (rotateInFlight) return;
      if (!activeRingId || !activeTargetId) return;
      rotateAngle = (rotateAngle + 10) % 360;
      rotateInFlight = true;
      OBR.scene.local
        .updateItems([activeRingId], (drafts) => {
          for (const d of drafts) d.rotation = rotateAngle;
        })
        .catch(() => {})
        .finally(() => { rotateInFlight = false; });
    }, 200);
  }
}

// --- Hover ring: single updateItems call, no position read. ---
// OBR snaps an attached item to its target's position as soon as
// `attachedTo` is set, so we don't need to read the target's position first.
// That saves a full SDK round-trip per hover (this was the slow-down the user
// saw after the old "build ring fresh each time" path was retired — we were
// still paying for a getItems we don't actually need).

// Fire-and-forget schedule for the 3s auto-hide. Extracted so every path
// that shows the ring can re-arm it (including the "same target re-hovered"
// fast path that previously cancelled the timer without re-arming).
function armHoverAutoClear() {
  if (hoverAutoClear) clearTimeout(hoverAutoClear);
  hoverAutoClear = setTimeout(() => {
    hoverAutoClear = null;
    setHoverRing(null);
  }, HOVER_TTL_MS);
}

export async function setHoverRing(targetId: string | null) {
  if (hoverAutoClear) { clearTimeout(hoverAutoClear); hoverAutoClear = null; }
  // Same target + already shown: just re-arm the 3s auto-hide and skip the
  // SDK round-trip. Fixes the case where a duplicate call (React quirk,
  // rapid re-enter, etc.) dropped the timer and left the ring visible.
  if (hoverTargetId === targetId && hoverRingId) {
    if (targetId !== null) armHoverAutoClear();
    return;
  }
  hoverTargetId = targetId;

  if (!hoverRingId) {
    hoverRingId = await ensureRing(HOVER_URL, TAG_HOVER);
    if (!hoverRingId) { hoverTargetId = null; return; }
  }

  const ringId = hoverRingId;

  if (targetId === null) {
    try {
      await OBR.scene.local.updateItems([ringId], (drafts) => {
        for (const d of drafts) {
          d.visible = false;
          d.attachedTo = undefined;
        }
      });
    } catch {}
    return;
  }

  let targetPos = { x: 0, y: 0 };
  try {
    const targets = await OBR.scene.items.getItems([targetId]);
    if (targets.length === 0 || hoverTargetId !== targetId) return;
    targetPos = targets[0].position;
  } catch { return; }

  try {
    await OBR.scene.local.updateItems([ringId], (drafts) => {
      for (const d of drafts) {
        d.visible = true;
        d.attachedTo = targetId;
        d.position = targetPos;
      }
    });
  } catch { return; }

  armHoverAutoClear();
}

export async function clearAllRings() {
  if (rotateTimer) { clearInterval(rotateTimer); rotateTimer = null; }
  if (hoverAutoClear) { clearTimeout(hoverAutoClear); hoverAutoClear = null; }
  activeTargetId = null;
  hoverTargetId = null;
  // Park both rings (kept alive for next use — no delete).
  const ids = [activeRingId, hoverRingId].filter((x): x is string => !!x);
  if (ids.length === 0) return;
  try {
    await OBR.scene.local.updateItems(ids, (drafts) => {
      for (const d of drafts) {
        d.visible = false;
        d.attachedTo = undefined;
        d.position = PARK;
      }
    });
  } catch {}
}
