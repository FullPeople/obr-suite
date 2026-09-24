export const POINTER_ID = "com.obr-suite/shared-pointer";
export const POINTER_TOOL = `${POINTER_ID}/tool`;
export const POINTER_MODE = `${POINTER_ID}/mode`;
export const POINTER_NETWORK = `${POINTER_ID}/network`;
export const POINTER_ACTIVATE = `${POINTER_ID}/activate`;
export const POINTER_SCENE_KEY = `${POINTER_ID}/scene-key`;
export const POINTER_LOCAL_KEY = `${POINTER_ID}/local`;
export const SEND_INTERVAL = 100;
export const POINTER_TTL = 1200;
export const MAX_PEERS = 16;
export type Position = [number, number];
export type Packet = { v: 1; s: string } & (
  { k: "h"; q: string; e: string; to?: string } |
  { k: "a"; q: string; e: string; n: number; to: string } |
  { k: "p"; e: string; n: number; p: Position | null }
);
const token = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 100;
export const sceneToken = (v: unknown): v is string => token(v) && /^[\w-]+$/.test(v);
export function position(value: unknown): Position | null {
  const p = value as { x?: unknown; y?: unknown } | undefined;
  if (!p || typeof p.x !== "number" || typeof p.y !== "number" || !Number.isFinite(p.x) || !Number.isFinite(p.y) || Math.abs(p.x) > 1e8 || Math.abs(p.y) > 1e8) return null;
  return [Math.round(p.x * 2) / 2, Math.round(p.y * 2) / 2];
}
export function parsePacket(value: unknown): Packet | null {
  const p = value as Packet | undefined;
  if (!p || p.v !== 1 || !sceneToken(p.s)) return null;
  if (p.k === "h") return sceneToken(p.q) && sceneToken(p.e) && (p.to === undefined || token(p.to)) ? p : null;
  if ((p.k !== "a" && p.k !== "p") || !sceneToken(p.e) || !Number.isSafeInteger(p.n) || p.n < 0) return null;
  if (p.k === "a") return sceneToken(p.q) && token(p.to) ? p : null;
  return p.p === null || Array.isArray(p.p) && p.p.length === 2 && position({ x: p.p[0], y: p.p[1] }) ? p : null;
}
