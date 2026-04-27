import OBR, { Item, Image } from "@owlbear-rodeo/sdk";
import { InitiativeData, InitiativeItem, CombatState } from "../types";
import { METADATA_KEY, COMBAT_STATE_KEY } from "./constants";

export function getInitiativeData(item: Item): InitiativeData | undefined {
  const data = item.metadata[METADATA_KEY];
  if (data && typeof data === "object") {
    return data as InitiativeData;
  }
  return undefined;
}

export function getImageUrl(item: Item): string {
  if (item.type === "IMAGE") {
    const img = item as Image;
    return img.image.url;
  }
  return "";
}

export function itemToInitiativeItem(item: Item): InitiativeItem | null {
  const data = getInitiativeData(item);
  if (!data) return null;
  const modKey = "com.initiative-tracker/dexMod";
  const mod = typeof item.metadata[modKey] === "number" ? item.metadata[modKey] as number : 0;
  return {
    id: item.id,
    name: item.name,
    count: data.count,
    modifier: mod,
    active: data.active,
    rolled: !!data.rolled,
    visible: item.visible,
    imageUrl: getImageUrl(item),
    tiebreak: typeof data.tiebreak === "number" ? data.tiebreak : 0,
    // Prefer the live `item.createdUserId` — that's what OBR's "Give
    // Ownership to Player" updates. The stored `data.ownerId` was captured
    // at add-to-initiative time and goes stale if the GM later reassigns
    // the character to a player, which caused delegated owners to lose
    // their roll / edit buttons.
    ownerId: item.createdUserId || data.ownerId || "",
  };
}

export async function setInitiativeData(
  itemId: string,
  data: Partial<InitiativeData>
) {
  await OBR.scene.items.updateItems([itemId], (items) => {
    for (const item of items) {
      const existing = getInitiativeData(item) || { count: 0, active: false };
      item.metadata[METADATA_KEY] = { ...existing, ...data };
    }
  });
}

export async function removeInitiativeData(itemId: string) {
  await OBR.scene.items.updateItems([itemId], (items) => {
    for (const item of items) {
      delete item.metadata[METADATA_KEY];
    }
  });
}

export async function getCombatState(): Promise<CombatState> {
  const metadata = await OBR.scene.getMetadata();
  const state = metadata[COMBAT_STATE_KEY];
  if (state && typeof state === "object") {
    return state as CombatState;
  }
  return { inCombat: false, preparing: false, round: 0 };
}

export async function setCombatState(state: Partial<CombatState>) {
  const current = await getCombatState();
  await OBR.scene.setMetadata({
    [COMBAT_STATE_KEY]: { ...current, ...state },
  });
}
