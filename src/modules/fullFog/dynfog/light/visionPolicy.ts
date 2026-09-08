import type { Item } from "@owlbear-rodeo/sdk";
import { dynfogId } from "../ids";

export const VISION_KEY = dynfogId("vision");
export const CARD_LIST_KEY = "com.character-cards/list";
export const CARD_BIND_KEY = "com.character-cards/boundCardId";
const MONSTER_BIND_KEY = "com.bestiary/slug";

export interface VisionOwnership {
  mode: "auto" | "team" | "gm" | "owners";
  ownerIds: string[];
}
export interface VisionCard {
  ownerIds: string[];
  visibility: "public" | "owners" | "dm";
}
export interface VisionContext {
  playerId: string;
  playerIds: ReadonlySet<string>;
  cards: ReadonlyMap<string, VisionCard>;
}
export interface VisionSource {
  visible: boolean;
  personal: boolean;
  team: boolean;
  /** An automatic ambient light may remain public; explicit restrictions win. */
  publicAmbient: boolean;
}

export function readVisionOwnership(raw: unknown): VisionOwnership {
  if (raw === undefined) return { mode: "auto", ownerIds: [] };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { mode: "gm", ownerIds: [] };
  const value = raw as Record<string, unknown>;
  const mode = value.mode;
  return {
    mode: mode === "auto" || mode === "team" || mode === "owners" ? mode : "gm",
    ownerIds: Array.isArray(value.ownerIds) ? [...new Set(value.ownerIds.filter((id): id is string => typeof id === "string" && id.length > 0))] : [],
  };
}

export function readVisionCards(raw: unknown): Map<string, VisionCard> {
  const result = new Map<string, VisionCard>();
  if (!Array.isArray(raw)) return result;
  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || typeof entry.id !== "string") continue;
    result.set(entry.id, {
      ownerIds: Array.isArray(entry.owner_ids) ? entry.owner_ids.filter((id: unknown): id is string => typeof id === "string" && id.length > 0) : [],
      visibility: entry.visibility === undefined || entry.visibility === "public" ? "public" : entry.visibility === "owners" ? "owners" : "dm",
    });
  }
  return result;
}

/** Explicit ownership > bound card > narrowly inferred player-created token.
 * Creator id alone is NOT a general ownership boundary: GM-created player
 * tokens work via their card/override; maps and NPCs never become party eyes. */
export function resolveVisionSource(
  item: Item,
  context: VisionContext,
  getItem: (id: string | undefined) => Item | null,
): VisionSource {
  const chain: Item[] = [];
  const seen = new Set<string>();
  let current: Item | null = item;
  while (current && chain.length < 32) {
    if (seen.has(current.id)) return { visible: false, personal: false, team: false, publicAmbient: false };
    seen.add(current.id); chain.push(current);
    if (!current.attachedTo) break;
    current = getItem(current.attachedTo);
    if (!current) return { visible: false, personal: false, team: false, publicAmbient: false };
  }
  const visible = chain.every(node => node.visible) && !(chain.length === 32 && current?.attachedTo);
  const deny = { visible, personal: false, team: false, publicAmbient: false };
  const ownership = chain.map(node => readVisionOwnership(node.metadata[VISION_KEY])).find(value => value.mode !== "auto");
  const fromOwners = (ownerIds: string[], shareable: boolean): VisionSource => ({
    visible,
    personal: context.playerIds.has(context.playerId) && ownerIds.includes(context.playerId),
    team: shareable && ownerIds.some(id => context.playerIds.has(id)),
    publicAmbient: false,
  });
  if (ownership) {
    if (ownership.mode === "gm") return deny;
    if (ownership.mode === "owners") return fromOwners(ownership.ownerIds, true);
    // A deliberately public party source contributes only with sharing ON.
    return { visible, personal: false, team: true, publicAmbient: false };
  }
  const bound = chain.find(node => CARD_BIND_KEY in node.metadata);
  if (bound) {
    const id = bound.metadata[CARD_BIND_KEY];
    const card = typeof id === "string" ? context.cards.get(id) : undefined;
    if (!card || card.visibility === "dm") return deny;
    return { ...fromOwners(card.ownerIds, card.visibility === "public"), publicAmbient: card.visibility === "public" };
  }
  if (chain.some(node => MONSTER_BIND_KEY in node.metadata)) return { ...deny, publicAmbient: true };
  const token = chain.find(node => node.layer === "CHARACTER" || node.layer === "MOUNT");
  return { ...(token ? fromOwners([token.createdUserId], true) : deny), publicAmbient: true };
}
