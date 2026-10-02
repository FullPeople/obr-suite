/** Owlbear Set Owner changes Item.createdUserId. This is the same field used
 * by the legacy popup (eb7141a, characterCards/index.ts:336–364).
 * Card importer/owner_ids and retired card-editors metadata are not grants. */
export interface NativeToken { createdUserId?: unknown; metadata?: Record<string, unknown> }
export const CARD_BINDING = "com.character-cards/boundCardId";
export function ownsNativeToken(item: NativeToken | undefined, playerId: string): boolean {
  return !!playerId && typeof item?.createdUserId === "string" && item.createdUserId === playerId;
}
export function nativeCardOwners(items: NativeToken[], cardId: string): string[] {
  return [...new Set(items.filter(item => item.metadata?.[CARD_BINDING] === cardId)
    .map(item => item.createdUserId).filter((id): id is string => typeof id === "string" && !!id))];
}
export function canReadNativeCard(card: {locked?: unknown; visibility?: unknown}, owners: string[], playerId: string, isGM: boolean): boolean {
  if (isGM || !!playerId && owners.includes(playerId)) return true;
  if (card.visibility !== undefined && card.visibility !== "public") return false;
  return card.locked === false || card.locked === undefined;
}
export function canReadNativePopup(item: NativeToken | undefined, cardId: string,
  card: {locked?: unknown; visibility?: unknown} | undefined, playerId: string, isGM: boolean, tokenLocked: unknown): boolean {
  if (!item || item.metadata?.[CARD_BINDING] !== cardId || !card) return false;
  if (isGM || ownsNativeToken(item, playerId)) return true;
  return canReadNativeCard(card, [], playerId, false) && tokenLocked === false
    && typeof item.createdUserId === "string" && !!item.createdUserId;
}
