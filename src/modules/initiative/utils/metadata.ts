import OBR, { Item, Image } from "@owlbear-rodeo/sdk";
import { InitiativeData, InitiativeItem, CombatState } from "../types";
import { METADATA_KEY, COMBAT_STATE_KEY } from "./constants";

// 2026-05-14 (#5 sortfix) — modifier-biased tiebreak generator.
//
// The initiative sort is 2-level now: total (count+modifier) DESC,
// then `tiebreak` ASC. The old 3-level sort had a "modifier DESC"
// middle tier so a higher initiative modifier won same-total ties —
// but that tier made manual reorder unable to slot a card between
// two equal-total cards with different modifiers. We dropped the
// tier and instead BAKE the modifier priority into the tiebreak
// VALUE here:
//
//   tiebreak = 0.5 − modifier × 0.01 + jitter
//
// Higher modifier → smaller tiebreak → sorts earlier (ASC), so the
// D&D "higher Dex wins the tie" convention is preserved as the
// DEFAULT. The jitter (< one modifier step) breaks ties between
// equal-modifier cards randomly but stably. Manual reorder writes an
// explicit tiebreak that simply overrides whatever this produced.
//
// Clamped to (0,1) so even absurd modifiers stay in range.
export function genTiebreak(modifier: number = 0): number {
  const m = Number.isFinite(modifier) ? modifier : 0;
  const base = 0.5 - m * 0.01 + Math.random() * 0.008;
  return Math.max(0.001, Math.min(0.999, base));
}

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
  // Pull HP fields from the shared bubbles-extension metadata namespace
  // so the panel can render a small numberless HP track above each
  // count chip without standing up an independent data source.
  const BUBBLES_KEY = "com.owlbear-rodeo-bubbles-extension/metadata";
  const bm = (item.metadata as any)?.[BUBBLES_KEY];
  let hp = -1;
  let maxHp = -1;
  let bubblesLocked = true;
  if (bm && typeof bm === "object") {
    const hpRaw = Number(bm["health"]);
    const maxRaw = Number(bm["max health"]);
    if (Number.isFinite(maxRaw) && maxRaw > 0) {
      maxHp = maxRaw;
      hp = Number.isFinite(hpRaw) ? Math.max(0, Math.min(hpRaw, maxRaw)) : maxRaw;
    }
    bubblesLocked = bm["locked"] === undefined ? true : !!bm["locked"];
  }
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
    invisible: !!data.invisible,
    hp,
    maxHp,
    bubblesLocked,
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
