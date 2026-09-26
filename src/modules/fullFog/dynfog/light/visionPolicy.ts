import type { Item } from "@owlbear-rodeo/sdk";
import { dynfogId } from "../ids";

export const VISION_KEY = dynfogId("vision");
export const CARD_LIST_KEY = "com.character-cards/list";
export const CARD_BIND_KEY = "com.character-cards/boundCardId";
const MONSTER_BIND_KEY = "com.bestiary/slug";

export interface VisionOwnership {
  /** `all` is an explicit grant to every player in the party pool; `gm` and
   *  `owners` restrict. `auto` means "infer the owner" and writes nothing. */
  mode: "auto" | "gm" | "owners" | "all";
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
    // The former party option now uses automatic player ownership too.
    // Read old scenes without rewriting their metadata merely by opening UI.
    // A "team" written by an older build is a MERGED automatic value, so it
    // must not silently become an explicit all-players grant here.
    mode: mode === "team" ? "auto" : mode === "auto" || mode === "owners" || mode === "all" ? mode : "gm",
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

/** Explicit restrictions win over automatic ownership. The room's sharing
 * setting can share any visible automatic source, including GM-created NPCs
 * and lights without a bound token. Personal vision still resolves card
 * owners or the token creator. Hidden attachments and DM-only cards never
 * participate; the consumer applies the room sharing switch to `team`. */
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
    team: shareable && ownerIds.length > 0,
    publicAmbient: false,
  });
  if (ownership) {
    if (ownership.mode === "gm") return deny;
    if (ownership.mode === "owners") return fromOwners(ownership.ownerIds, true);
    if (ownership.mode === "all") {
      // Every player in the party pool owns this light, so it needs neither a
      // bound card nor the global sharing switch. An unknown local identity
      // (or a GM-only client with no player id) still borrows nothing.
      return { visible, personal: context.playerIds.has(context.playerId), team: true, publicAmbient: false };
    }
  }
  const bound = chain.find(node => CARD_BIND_KEY in node.metadata);
  if (bound) {
    const id = bound.metadata[CARD_BIND_KEY];
    const card = typeof id === "string" ? context.cards.get(id) : undefined;
    if (!card || card.visibility === "dm") return deny;
    // Card-detail privacy does not disable the GM's shared-vision setting.
    // DM-only cards were excluded above; no card fields are shared here.
    if (!card.ownerIds.length) {
      // No explicit owner list. Nothing in the suite ever writes `owner_ids`
      // (the card panel only cycles public/dm), so this is the normal case and
      // resolving it to an empty set left every card-bound light dark for the
      // whole room. Fall back to the token's creator for the personal view —
      // the same rule the character-cards popover uses — and mark the source
      // shareable so the selector's "已共享" label is true. The consumer still
      // gates the party view on the room's shared-vision switch, so a source
      // with no online owner does not become a party eye while sharing is off.
      const creator = typeof bound.createdUserId === "string" ? bound.createdUserId : "";
      return {
        visible,
        personal: !!creator && creator === context.playerId && context.playerIds.has(context.playerId),
        team: true,
        publicAmbient: card.visibility === "public",
      };
    }
    return { ...fromOwners(card.ownerIds, true), publicAmbient: card.visibility === "public" };
  }
  if (chain.some(node => MONSTER_BIND_KEY in node.metadata)) return { ...deny, team: true, publicAmbient: true };
  const token = chain.find(node => node.layer === "CHARACTER" || node.layer === "MOUNT");
  return { ...(token ? fromOwners([token.createdUserId], true) : deny), team: true, publicAmbient: true };
}
