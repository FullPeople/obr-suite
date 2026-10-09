import { duration, hasContent, parseConfig, type TextEffectConfig } from './model';
export const PREFIX = 'com.obr-suite/text-effects/';
export const REQUEST = PREFIX + 'request', STATUS = PREFIX + 'status', PLAY = PREFIX + 'play', STOP = PREFIX + 'stop', OPEN = PREFIX + 'open';
export const SCENE_KEY = PREFIX + 'scene-key', DISPLAY_ID = PREFIX + 'display', CONTROL_ID = PREFIX + 'control';
export interface EffectEvent { version: 1; id: string; sceneKey: string; order: number; issuedAt: number; startsAt: number; expiresAt: number; config: TextEffectConfig }
export interface StopEvent { version: 1; id: string; sceneKey: string; issuedAt: number }
export interface Peer { connectionId: string; role: 'GM' | 'PLAYER' }
export const identifier = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9-]{8,100}$/.test(v);
export function parseEvent(value: unknown): EffectEvent | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as EffectEvent, config = parseConfig(v.config);
  if (v.version !== 1 || !identifier(v.id) || !identifier(v.sceneKey) || !Number.isSafeInteger(v.order) || v.order < 1 || !config || !hasContent(config)
    || !Number.isFinite(v.issuedAt) || !Number.isFinite(v.startsAt) || !Number.isFinite(v.expiresAt)
    || v.startsAt < v.issuedAt || v.startsAt - v.issuedAt > 1000
    || v.expiresAt !== v.startsAt + duration(config) + 500) return null;
  return { version: 1, id: v.id, sceneKey: v.sceneKey, order: v.order, issuedAt: v.issuedAt, startsAt: v.startsAt, expiresAt: v.expiresAt, config };
}
export function parseStop(value: unknown): StopEvent | null {
  const v = value as StopEvent;
  return v && v.version === 1 && identifier(v.id) && identifier(v.sceneKey) && Number.isFinite(v.issuedAt)
    ? { version: 1, id: v.id, sceneKey: v.sceneKey, issuedAt: v.issuedAt } : null;
}
export function createEventGate() {
  const seen = new Map<string, number>(), orders = new Map<string, number>();
  let latest = -Infinity;
  return {
    accept(value: unknown, sender: string, c: { now: number; readyAt: number; sceneKey: string; peers: Peer[] }): EffectEvent | null {
      for (const [id, expires] of seen) if (expires <= c.now) seen.delete(id);
      const event = parseEvent(value);
      if (!event || event.sceneKey !== c.sceneKey || event.expiresAt <= c.now || event.issuedAt < c.readyAt
        || event.issuedAt > c.now + 1000 || c.now - event.issuedAt > 4000 || event.issuedAt < latest
        || !c.peers.some(p => p.connectionId === sender && p.role === 'GM') || seen.has(event.id) || event.order <= (orders.get(sender) || 0)) return null;
      latest = event.issuedAt; seen.set(event.id, event.expiresAt); orders.set(sender, event.order);
      if (seen.size > 128) seen.delete(seen.keys().next().value!);
      return event;
    },
    clear() { seen.clear(); orders.clear(); latest = -Infinity; },
  };
}
