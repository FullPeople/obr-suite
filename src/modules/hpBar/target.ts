import type { Item } from "@owlbear-rodeo/sdk";
import {
  BUBBLES_META_KEY, EXTERNAL_BUBBLES_META_KEY, type BubblesData,
} from "../../utils/statEdit";

export const HP_BAR_FLAG_KEY = "com.obr-suite/hp-bar/enabled";
export const HP_BAR_TARGET = "com.obr-suite/hp-bar/target";
export const HP_BAR_READY = "com.obr-suite/hp-bar/ready";
export const CC_BIND_KEY = "com.character-cards/boundCardId";
export const CC_LIST_KEY = "com.character-cards/list";
export const BUBBLES_NAME_KEY = "com.owlbear-rodeo-bubbles-extension/name";
const BESTIARY_SLUG_KEY = "com.bestiary/slug";

export interface HpBarTarget {
  session: string;
  version: number;
  itemId: string | null;
  pending: boolean;
}

export function bubblesFromItem(item: Item | undefined): BubblesData {
  const meta = item?.metadata;
  const own = meta?.[BUBBLES_META_KEY];
  if (own && typeof own === "object") return { ...own as BubblesData };
  const external = meta?.[EXTERNAL_BUBBLES_META_KEY];
  return external && typeof external === "object" ? { ...external as BubblesData } : {};
}

export function mayEditHp(item: Item | undefined, gm: boolean, playerId: string): boolean {
  return !!item && item.type === "IMAGE" && !bubblesFromItem(item).hide
    && (gm || (!!playerId && item.createdUserId === playerId));
}

export function hpEligibility(item: Item | undefined, gm: boolean, playerId: string): "show" | "enable" | "none" {
  if (!mayEditHp(item, gm, playerId)) return "none";
  const meta = item!.metadata;
  // Bound cards/monsters keep their own editors, including explicit HP flags.
  if ([CC_BIND_KEY, BESTIARY_SLUG_KEY].some(key => typeof meta[key] === "string" && meta[key].length > 0)) return "none";
  const flag = meta[HP_BAR_FLAG_KEY];
  if (flag !== undefined) return flag ? "show" : "none";
  const stats = bubblesFromItem(item);
  return [stats.health, stats["max health"], stats["temporary health"], stats["armor class"]]
    .some(value => value != null) ? "enable" : "none";
}

/** Only fields that change the background's visibility/auto-enable decision. */
export function eligibilitySignature(item: Item | undefined): string {
  if (!item) return "missing";
  const meta = item.metadata;
  const stats = bubblesFromItem(item);
  return JSON.stringify([item.id, item.type, item.createdUserId, !!stats.hide,
    meta[HP_BAR_FLAG_KEY], meta[CC_BIND_KEY], meta[BESTIARY_SLUG_KEY],
    [stats.health, stats["max health"], stats["temporary health"], stats["armor class"]].some(value => value != null)]);
}

/** No position, rotation or unrelated metadata: dragging does not repaint inputs. */
export function hpViewSignature(item: Item | undefined): string {
  if (!item) return "missing";
  const stats = bubblesFromItem(item);
  return JSON.stringify([item.id, item.type, item.createdUserId, item.name,
    item.metadata[CC_BIND_KEY], item.metadata[BUBBLES_NAME_KEY],
    stats.health, stats["max health"], stats["temporary health"], stats["armor class"], stats.hide, stats.locked]);
}

/** Reject out-of-order target replies and reads, including A -> B -> A. */
export class HpTargetLease {
  private epoch = 0;
  private request = 0;
  state: HpBarTarget;

  constructor(session: string) {
    this.state = { session, version: -1, itemId: null, pending: true };
  }

  accept(value: HpBarTarget): boolean {
    if (value.session !== this.state.session || !Number.isSafeInteger(value.version)
      || value.version <= this.state.version
      || (value.itemId !== null && typeof value.itemId !== "string")
      || typeof value.pending !== "boolean") return false;
    this.state = { ...value };
    this.epoch++;
    this.request++;
    return true;
  }

  invalidate(): void { this.epoch++; this.request++; }

  capture(): { itemId: string; current: () => boolean } | null {
    const { itemId, pending } = this.state;
    if (!itemId || pending) return null;
    const epoch = this.epoch;
    return { itemId, current: () => epoch === this.epoch && !this.state.pending };
  }

  beginRead(): (() => boolean) | null {
    const lease = this.capture();
    if (!lease) return null;
    const request = ++this.request;
    return () => lease.current() && request === this.request;
  }
}
