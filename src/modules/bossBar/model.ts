import type { Item } from "@owlbear-rodeo/sdk";
import { BUBBLES_META_KEY, EXTERNAL_BUBBLES_META_KEY, type BubblesData } from "../../utils/statEdit";

export const BOSS_KEY = "com.obr-suite/boss-bar/config";
export const BOSS_STATE = "com.obr-suite/boss-bar/state";
export const BOSS_READY = "com.obr-suite/boss-bar/ready";
export const MAX_BOSSES = 3;
export interface BossConfig { enabled: boolean; exact: boolean; phase: string; segments: number; order: number }
export interface PublicBoss { id: string; name: string; ratio: number; phase: string; segments: number; numbers?: { hp: number; max: number } }
export interface BossState { session: string; version: number; bosses: PublicBoss[]; replay?: string }

export function bossConfig(item: Item): BossConfig {
  const value = item.metadata[BOSS_KEY] as Partial<BossConfig> | null;
  return { enabled: value?.enabled === true, exact: value?.exact === true,
    phase: typeof value?.phase === "string" ? value.phase.trim().slice(0, 48) : "",
    segments: typeof value?.segments === "number" && Number.isFinite(value.segments) ? Math.max(1, Math.min(5, Math.round(value.segments))) : 1,
    order: typeof value?.order === "number" && Number.isFinite(value.order) ? value.order : 0 };
}

export function bossStats(item: Item): BubblesData {
  const own = item.metadata[BUBBLES_META_KEY];
  const external = item.metadata[EXTERNAL_BUBBLES_META_KEY];
  return own && typeof own === "object" ? own as BubblesData : external && typeof external === "object" ? external as BubblesData : {};
}

export function eligibleBoss(item: Item): boolean {
  const stats = bossStats(item);
  return item.type === "IMAGE" && item.layer === "CHARACTER" && item.visible === true && !stats.hide
    && typeof stats.health === "number" && Number.isFinite(stats.health)
    && typeof stats["max health"] === "number" && Number.isFinite(stats["max health"]) && stats["max health"] > 0;
}

/** Produces only public presentation data. No current/max HP leaves this
 * projection unless the DM explicitly enabled exact numbers on this token. */
export function publicBosses(items: Item[]): PublicBoss[] {
  return items.filter(item => bossConfig(item).enabled && eligibleBoss(item))
    .sort((a, b) => bossConfig(a).order - bossConfig(b).order || a.id.localeCompare(b.id))
    .slice(0, MAX_BOSSES).map(item => {
      const config = bossConfig(item), stats = bossStats(item);
      const hp = Math.max(0, stats.health!), max = stats["max health"]!;
      const named = item.metadata["com.owlbear-rodeo-bubbles-extension/name"];
      const name = (typeof named === "string" && named.trim() ? named : item.name).trim().slice(0, 120);
      return { id: item.id, name, ratio: Math.max(0, Math.min(1, hp / max)), phase: config.phase, segments: config.segments,
        ...(config.exact ? { numbers: { hp, max } } : {}) };
    });
}

export function validPublicBoss(value: unknown): value is PublicBoss {
  if (!value || typeof value !== "object") return false;
  const boss = value as PublicBoss;
  return typeof boss.id === "string" && typeof boss.name === "string" && boss.name.length <= 120
    && typeof boss.ratio === "number" && Number.isFinite(boss.ratio) && boss.ratio >= 0 && boss.ratio <= 1
    && typeof boss.phase === "string" && boss.phase.length <= 48 && Number.isInteger(boss.segments) && boss.segments >= 1 && boss.segments <= 5
    && (!boss.numbers || (Number.isFinite(boss.numbers.hp) && Number.isFinite(boss.numbers.max) && boss.numbers.max > 0));
}
