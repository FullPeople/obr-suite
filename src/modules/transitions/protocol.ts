export const TRANSITIONS_ID = "com.obr-suite/transitions";
export const BC_TRANSITIONS_OPEN = `${TRANSITIONS_ID}/open`;
export const BC_TRANSITIONS_RUN = `${TRANSITIONS_ID}/run`;
export const BC_TRANSITIONS_PLAY = `${TRANSITIONS_ID}/play`;
export const BC_TRANSITIONS_STATUS = `${TRANSITIONS_ID}/status`;
export const BC_TRANSITIONS_DISMISS = `${TRANSITIONS_ID}/dismiss`;
export const SCENE_KEY = `${TRANSITIONS_ID}/scene-key`;
export const REDUCED_MOTION_KEY = `${TRANSITIONS_ID}/reduced-motion`;
export const CONTROL_ID = `${TRANSITIONS_ID}/control`;
export const DISPLAY_ID = `${TRANSITIONS_ID}/display`;
// Includes the longer night-to-dawn sequence and a small iframe startup margin.
export const TRANSITION_TTL_MS = 12_000;
export const transitionDuration = (kind: TransitionKind, reduced = false) => reduced ? 3_400 : kind === "long" ? 8_800 : kind === "short" ? 6_000 : 5_800;
export type TransitionKind = "short" | "long" | "text";
export interface TransitionEvent {
  version: 1;
  id: string;
  sceneKey: string;
  issuedAt: number;
  expiresAt: number;
  kind: TransitionKind;
  text: string;
  targets: "all" | string[];
}
export interface TransitionPeer { id: string; connectionId: string; role: "GM" | "PLAYER" }
export function parseTransition(value: unknown): TransitionEvent | null {
  if (!value || typeof value !== "object") return null;
  const v = value as TransitionEvent;
  if (v.version !== 1 || typeof v.id !== "string" || v.id.length < 8 || v.id.length > 100
    || typeof v.sceneKey !== "string" || !v.sceneKey || v.sceneKey.length > 100
    || !["short", "long", "text"].includes(v.kind)
    || typeof v.text !== "string" || v.text.length > 120
    || !Number.isFinite(v.issuedAt) || !Number.isFinite(v.expiresAt)
    || v.expiresAt <= v.issuedAt || v.expiresAt - v.issuedAt > TRANSITION_TTL_MS
    || (v.targets !== "all" && (!Array.isArray(v.targets) || v.targets.length > 100
      || v.targets.some((id) => typeof id !== "string" || id.length > 100)))) return null;
  return v;
}
export function createTransitionGate() {
  const seen = new Map<string, number>();
  return {
    accept(value: unknown, senderConnection: string, context: {
      now: number; readyAt: number; sceneKey: string; playerId: string; peers: TransitionPeer[];
    }): TransitionEvent | null {
      for (const [id, expiry] of seen) if (expiry <= context.now) seen.delete(id);
      const event = parseTransition(value);
      if (!event || event.sceneKey !== context.sceneKey || event.expiresAt <= context.now
        || event.issuedAt > context.now + 1_000 || event.issuedAt < context.readyAt
        || !context.peers.some((peer) => peer.connectionId === senderConnection && peer.role === "GM")
        || (event.targets !== "all" && !event.targets.includes(context.playerId))
        || seen.has(event.id)) return null;
      seen.set(event.id, event.expiresAt);
      if (seen.size > 128) seen.delete(seen.keys().next().value!);
      return event;
    },
    clear() { seen.clear(); },
  };
}
export function prefersReducedMotion(): boolean {
  try {
    return localStorage.getItem(REDUCED_MOTION_KEY) === "1"
      || globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
  } catch { return false; }
}
