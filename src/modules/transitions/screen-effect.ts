import OBR, { buildEffect, type Effect } from "@owlbear-rodeo/sdk";
import { prefersReducedMotion, TRANSITIONS_ID } from "./protocol";

export type ScreenTransition = "blink" | "fade";
const EFFECT_TAG = `${TRANSITIONS_ID}/screen`;
const EFFECT_OWNER = `${TRANSITIONS_ID}/screen-owner`;
// Original geometric shader. No textures, scene sampling or third-party art.
// VIEWPORT coordinates follow the official Effects reference's view transform.
export const SCREEN_SHADER = `
uniform vec2 size;
uniform mat3 view;
uniform float phase;
uniform float blink;
half4 main(float2 coord) {
  vec2 uv = (vec3(coord, 1.0) * view).xy / max(size, vec2(1.0));
  float coverage = clamp(phase, 0.0, 1.0);
  float edge = abs(uv.y - 0.5) * 2.0;
  float lid = smoothstep(1.0 - coverage - 0.025, 1.0 - coverage, edge);
  float alpha = mix(coverage, lid * step(0.001, coverage), blink);
  return half4(0.0, 0.0, 0.0, alpha * 0.96);
}`;
export function screenPhase(elapsed: number, duration: number): number {
  const progress = Math.max(0, Math.min(1, elapsed / duration));
  return progress < 0.45 ? progress / 0.45 : progress > 0.55 ? (1 - progress) / 0.45 : 1;
}
let active: { id: string; owner: string; cancel: () => void } | null = null;

/** Finite, local-only, non-interactive scene effect. Resolves at its visual apex. */
export async function playScreenTransition(
  kind: ScreenTransition, duration = 1_200, signal?: AbortSignal, owner = "portal",
): Promise<void> {
  if (prefersReducedMotion() || signal?.aborted) return;
  active?.cancel();
  if (signal?.aborted) return;
  const effect = buildEffect().effectType("VIEWPORT").sksl(SCREEN_SHADER)
    .uniforms([{ name: "phase", value: 0 }, { name: "blink", value: kind === "blink" ? 1 : 0 }])
    .layer("POINTER").zIndex(100_000).disableAutoZIndex(true).disableHit(true).locked(true)
    .metadata({ [EFFECT_TAG]: true, [EFFECT_OWNER]: owner }).build();
  let cancelled = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let safety: ReturnType<typeof setTimeout> | undefined;
  let apexTimer: ReturnType<typeof setTimeout> | undefined;
  let resolveApex!: () => void;
  const apex = new Promise<void>((resolve) => { resolveApex = resolve; });
  const cleanup = () => {
    if (cancelled) return;
    cancelled = true;
    if (timer) clearInterval(timer);
    if (safety) clearTimeout(safety);
    if (apexTimer) clearTimeout(apexTimer);
    signal?.removeEventListener("abort", cleanup);
    if (active?.id === effect.id) active = null;
    resolveApex();
    // Clear visual alpha before deletion as a second independent recovery path.
    void OBR.scene.local.updateItems<Effect>([effect.id], (items) => {
      for (const item of items) item.visible = false;
    }).catch(() => {});
    void OBR.scene.local.deleteItems([effect.id]).catch(() => {});
  };
  active = { id: effect.id, owner, cancel: cleanup };
  signal?.addEventListener("abort", cleanup, { once: true });
  // Arm before addItems: even a stalled SDK call cannot leave ownership latched.
  safety = setTimeout(cleanup, duration + 1_000);
  try {
    const add = OBR.scene.local.addItems([effect]);
    const added = await Promise.race([add.then(() => true), apex.then(() => false)]);
    if (!added) {
      void add.then(() => OBR.scene.local.deleteItems([effect.id])).catch(() => {});
      return;
    }
    if (cancelled || signal?.aborted) {
      void OBR.scene.local.deleteItems([effect.id]).catch(() => {});
      cleanup();
      return;
    }
    const started = performance.now();
    let inFlight = false;
    timer = setInterval(() => {
      const elapsed = performance.now() - started;
      if (elapsed >= duration) { cleanup(); return; }
      if (inFlight || cancelled) return;
      inFlight = true;
      const phase = screenPhase(elapsed, duration);
      void OBR.scene.local.updateItems<Effect>([effect.id], (items) => {
        for (const item of items) {
          if (cancelled) { item.visible = false; continue; }
          for (const uniform of item.uniforms) if (uniform.name === "phase") uniform.value = phase;
        }
      // Effect uniforms are not listed among the SDK's fast-update fields.
      // Use the normal local update path, with at most one write in flight.
      }).catch(cleanup).finally(() => { inFlight = false; });
    }, 33);
    apexTimer = setTimeout(resolveApex, duration * 0.5);
    await apex;
  } catch (error) {
    cleanup();
    console.warn("[transitions] screen effect unavailable", error);
  }
}

export async function stopScreenTransition(owner?: string): Promise<void> {
  if (active && (owner === undefined || active.owner === owner)) active.cancel();
}
export async function removeOrphanScreenTransitions(includePortals = false): Promise<void> {
  if (active && (includePortals || active.owner !== "portal")) active.cancel();
  try {
    const items = await OBR.scene.local.getItems((item) => item.metadata[EFFECT_TAG] === true
      && (includePortals || item.metadata[EFFECT_OWNER] !== "portal"));
    if (items.length) await OBR.scene.local.deleteItems(items.map((item) => item.id));
  } catch {}
}

/** Banner iframe's independent watchdog also works if its background stops. */
export async function removeScreenTransitionForOwner(owner: string): Promise<void> {
  try {
    const items = await OBR.scene.local.getItems((item) => item.metadata[EFFECT_TAG] === true && item.metadata[EFFECT_OWNER] === owner);
    if (items.length) await OBR.scene.local.deleteItems(items.map((item) => item.id));
  } catch {}
}
