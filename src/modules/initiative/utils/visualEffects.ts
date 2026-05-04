import OBR, { buildImage, buildEffect, Image } from "@owlbear-rodeo/sdk";
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
// Stamped onto the hover ring every time it's (re-)shown so a
// long-lived watchdog in the BG iframe can fade-park the ring even
// when the panel iframe was torn down before its own auto-clear
// timer could fire (the SDK call inside the React-cleanup path is
// async and doesn't always survive iframe destruction).
export const META_HOVER_LAST_SHOWN_TS = "com.initiative-tracker/ring-hover-last-shown-ts";

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
          // Park off-map. `visible = false` alone leaves a faint
          // halo in OBR's renderer at the ring's last position —
          // moving the geometry far outside any plausible scene
          // makes the residual render unobservable.
          d.position = PARK;
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
        // Stamp the show timestamp — bg poll uses this as the
        // "freshness" marker. While the panel is open and re-firing
        // hover events, the ts stays fresh and the bg watchdog skips
        // the ring. When the panel closes (or the iframe is otherwise
        // wedged), ts goes stale and the bg auto-hides ~3s later.
        (d.metadata as any)[META_HOVER_LAST_SHOWN_TS] = Date.now();
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

// === Stealth overlays =====================================================
// Per-client local Effect attached to each invisibility-flagged token. DM
// gets a translucent shimmer (token visible underneath); players get an
// opaque cover (token hidden visually). Both sides drive iTime via a
// shared animation timer so the shader actually moves.

const TAG_STEALTH = "com.initiative-tracker/stealth-overlay";

// Translucent rippling shimmer with chromatic warping. DM-side. Soft
// circular mask so it doesn't look like a hard square.
const STEALTH_SHADER_DM = `
half4 main(float2 fragCoord) {
  float2 uv = fragCoord / iSize;
  float2 c = uv - 0.5;
  float r = length(c);
  float ripple = sin(r * 28.0 - iTime * 3.5) * 0.5 + 0.5;
  float warp = sin(uv.y * 16.0 + iTime * 2.0) * 0.5 + 0.5;
  float mask = 1.0 - smoothstep(0.40, 0.50, r);
  float a = mask * (0.20 + 0.30 * ripple) * 0.75;
  half3 color = half3(0.40 + 0.20 * warp, 0.85, 1.0);
  return half4(color * a, a);
}
`;

// Player-side cover. Same ripple pattern but fully opaque inside the token
// area so the underlying token is hidden. Edge fades out softly so the
// cover doesn't look like a sharp disk.
const STEALTH_SHADER_PLAYER = `
half4 main(float2 fragCoord) {
  float2 uv = fragCoord / iSize;
  float2 c = uv - 0.5;
  float r = length(c);
  float mask = 1.0 - smoothstep(0.45, 0.50, r);
  float ripple = sin(r * 18.0 - iTime * 1.8) * 0.05 + 0.95;
  half3 color = half3(0.04, 0.08, 0.16) * ripple;
  return half4(color * mask, mask);
}
`;

// tokenId → effectId, mirroring per-client overlay state.
const stealthByToken = new Map<string, string>();
let stealthAnimTimer: ReturnType<typeof setInterval> | null = null;
let stealthAnimStart = Date.now();
let stealthRoleIsGM = false;

function startStealthAnim(): void {
  if (stealthAnimTimer) return;
  if (stealthByToken.size === 0) return;
  stealthAnimStart = Date.now();
  stealthAnimTimer = setInterval(() => {
    const ids = Array.from(stealthByToken.values());
    if (ids.length === 0) {
      stopStealthAnim();
      return;
    }
    const t = (Date.now() - stealthAnimStart) / 1000;
    OBR.scene.local
      .updateItems(ids, (drafts) => {
        for (const d of drafts) {
          const eff = d as any;
          if (!Array.isArray(eff.uniforms)) continue;
          for (const u of eff.uniforms) {
            if (u.name === "iTime") { u.value = t; break; }
          }
        }
      })
      .catch(() => {});
  }, 80);
}

function stopStealthAnim(): void {
  if (stealthAnimTimer) {
    clearInterval(stealthAnimTimer);
    stealthAnimTimer = null;
  }
}

// Best-effort token bbox: image rendered size = (image.width / image.dpi)
// * sceneDpi * item.scale.x. Falls back to 150×150 when the call fails or
// the item isn't an Image — not all initiative tokens are images, but the
// bestiary / character flow only adds images so this is mostly defensive.
async function tokenRenderedSize(tokenId: string): Promise<{ w: number; h: number }> {
  try {
    const items = await OBR.scene.items.getItems([tokenId]);
    const item = items[0] as Image | undefined;
    if (!item || item.type !== "IMAGE") return { w: 150, h: 150 };
    const sceneDpi = await OBR.scene.grid.getDpi().catch(() => 150);
    // Image type stores grid info on the item itself (item.grid), not
    // nested under item.image. item.image holds the intrinsic pixel
    // size of the asset.
    const imgDpi = item.grid?.dpi ?? sceneDpi;
    const sx = item.scale?.x ?? 1;
    const sy = item.scale?.y ?? 1;
    const dpiRatio = sceneDpi / imgDpi;
    const w = Math.abs(item.image.width * dpiRatio * sx);
    const h = Math.abs(item.image.height * dpiRatio * sy);
    return { w: Math.max(40, w), h: Math.max(40, h) };
  } catch {
    return { w: 150, h: 150 };
  }
}

async function buildStealthOverlay(tokenId: string): Promise<string | null> {
  try {
    const { w, h } = await tokenRenderedSize(tokenId);
    const sksl = stealthRoleIsGM ? STEALTH_SHADER_DM : STEALTH_SHADER_PLAYER;
    // Position is auto-snapped to the token by OBR when `attachedTo` is
    // set on a fresh add. Width/height are the shader's rasterization
    // canvas — sized to (slightly larger than) the token bbox so the
    // soft mask edges fit inside.
    const canvas = Math.max(w, h) * 1.05;
    const eff = buildEffect()
      .effectType("STANDALONE")
      .blendMode("SRC_OVER")
      .width(canvas)
      .height(canvas)
      .sksl(sksl)
      .uniforms([
        { name: "iTime", value: 0 },
        { name: "iSize", value: { x: canvas, y: canvas } },
      ])
      .position({ x: 0, y: 0 })
      .attachedTo(tokenId)
      .locked(true)
      .disableHit(true)
      .layer("ATTACHMENT")
      .disableAutoZIndex(true)
      .zIndex(50_000)
      .visible(true)
      .disableAttachmentBehavior(["LOCKED", "COPY"])
      .metadata({ [TAG_STEALTH]: true })
      .build();
    await OBR.scene.local.addItems([eff]);
    return eff.id;
  } catch (e) {
    console.warn("[obr-suite/initiative] buildStealthOverlay failed", e);
    return null;
  }
}

/**
 * Reconcile stealth overlays against the current invisible-token list.
 * Called from the bg iframe whenever scene items change. Adds overlays for
 * newly-invisible tokens, removes overlays for tokens whose flag was
 * cleared (or that are no longer in the scene). Idempotent.
 */
export async function syncStealthOverlays(
  invisibleIds: Set<string>,
  isGM: boolean,
): Promise<void> {
  // Role flip (rare, but possible when OBR re-broadcasts player change):
  // tear down all existing overlays so they get rebuilt with the
  // role-correct shader on next sync.
  if (stealthRoleIsGM !== isGM && stealthByToken.size > 0) {
    const oldIds = Array.from(stealthByToken.values());
    stealthByToken.clear();
    stopStealthAnim();
    try { await OBR.scene.local.deleteItems(oldIds); } catch {}
  }
  stealthRoleIsGM = isGM;

  // Clean up overlays for any token that's no longer invisible.
  const toRemove: string[] = [];
  for (const [tokenId, effectId] of stealthByToken.entries()) {
    if (!invisibleIds.has(tokenId)) {
      toRemove.push(effectId);
      stealthByToken.delete(tokenId);
    }
  }
  if (toRemove.length > 0) {
    try { await OBR.scene.local.deleteItems(toRemove); } catch {}
  }

  // Add overlays for newly-invisible tokens.
  const toAdd: string[] = [];
  for (const tokenId of invisibleIds) {
    if (!stealthByToken.has(tokenId)) toAdd.push(tokenId);
  }
  for (const tokenId of toAdd) {
    const effectId = await buildStealthOverlay(tokenId);
    if (effectId) stealthByToken.set(tokenId, effectId);
  }

  if (stealthByToken.size > 0) startStealthAnim();
  else stopStealthAnim();
}

/**
 * Tear down all stealth overlays. Called on scene change so we don't leak
 * effect items from one scene into another.
 */
export async function clearStealthOverlays(): Promise<void> {
  stopStealthAnim();
  const ids = Array.from(stealthByToken.values());
  stealthByToken.clear();
  if (ids.length === 0) return;
  try { await OBR.scene.local.deleteItems(ids); } catch {}
}
