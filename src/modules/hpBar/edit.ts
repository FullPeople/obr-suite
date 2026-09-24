import OBR from "@owlbear-rodeo/sdk";
import { BUBBLES_META_KEY, EXTERNAL_BUBBLES_META_KEY, type BubblesData } from "../../utils/statEdit";
import { bubblesFromItem, mayEditHp } from "./target";

/** A captured editor target is checked again inside the SDK's delayed draft.
 * Scoped here so the other stat editors retain their existing write contract. */
export async function writeHpStats(
  itemId: string,
  patch: Partial<BubblesData>,
  current: () => boolean,
): Promise<BubblesData | null> {
  const [role, playerId, ready] = await Promise.all([
    OBR.player.getRole(), OBR.player.getId(), OBR.scene.isReady(),
  ]);
  if (!current() || !ready) return null;
  if ("locked" in patch && role !== "GM") throw new Error("Only the GM can change HP visibility");
  let result: BubblesData | null = null;
  await OBR.scene.items.updateItems([itemId], drafts => {
    if (!current()) return;
    for (const item of drafts) {
      if (item.id !== itemId) continue;
      if (!mayEditHp(item, role === "GM", playerId)) throw new Error("HP target is no longer editable");
      const merged = { ...bubblesFromItem(item), ...patch };
      if (typeof merged.health === "number" && typeof merged["max health"] === "number") {
        merged.health = Math.min(merged.health, merged["max health"]);
      }
      if (typeof merged["temporary health"] === "number" && merged["temporary health"] < 0) merged["temporary health"] = 0;
      const externalPatch: Record<string, unknown> = { ...patch };
      if ("max health" in patch && typeof merged.health === "number") externalPatch.health = merged.health;
      if ("temporary health" in patch) externalPatch["temporary health"] = merged["temporary health"];
      const external = item.metadata[EXTERNAL_BUBBLES_META_KEY];
      item.metadata[BUBBLES_META_KEY] = merged;
      if (external != null) item.metadata[EXTERNAL_BUBBLES_META_KEY] = { ...external as object, ...externalPatch };
      result = merged;
    }
  });
  return current() ? result : null;
}
