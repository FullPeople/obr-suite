// Long Rest — recovery planning and application.
//
// Triggered by the transitions module when the GM plays the "long rest"
// cutscene (kind: "long", non-preview). The GM first sees a picker
// (picker-page.ts) listing every scene unit that has something to
// recover; whatever stays checked gets restored here:
//
//   • HP — bubbles `health` topped to `max health`. Works for
//     character-card bindings, bestiary bindings and plain HP bars,
//     because all three keep their live HP in the same bubbles object.
//   • Resources — every resource-tracker entry flagged `longRest`
//     topped to `max`. This is how spell slots are tracked in the
//     suite (per-token count resources), so a checked unit's spell
//     slots come back too.
//
// Monster spellcasting entries in the shared bestiary table are
// display-only (no usage state), so there is nothing to restore for
// them. Character-card JSON lives on the card server and is read-only
// from the plugin — its live HP is the bubbles object above.
//
// Everything here is idempotent: units already at max produce no
// write, so re-running a long rest is safe.

import OBR, { type Item } from "@owlbear-rodeo/sdk";
import { BUBBLES_META_KEY, EXTERNAL_BUBBLES_META_KEY } from "../../utils/statEdit";
import { CARD_BINDING } from "../characterCards/native-owner";
import { BUBBLES_NAME_KEY } from "../hpBar/target";
import { readResources } from "../resourceTracker/storage";
import { RESOURCES_KEY } from "../resourceTracker/types";

/** Bestiary binding key — mirrors modules/bestiary/spawn.ts. */
const BESTIARY_SLUG_KEY = "com.bestiary/slug";

/** One unit's planned changes. `null` plan = nothing to recover. */
export interface RestorePlan {
  /** HP top-up, when the unit has bubbles stats below max. */
  hp?: { from: number; to: number };
  /** Long-rest resources below max, in tracker order. */
  resources: Array<{ id: string; name: string; from: number; to: number }>;
}

export interface RestoreCandidate {
  item: Item;
  /** Display name — item name, bubbles name, or a placeholder. */
  name: string;
  /** Bound to a character card (player). */
  card: boolean;
  /** Bound to a bestiary entry (monster). */
  bestiary: boolean;
  plan: RestorePlan;
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function bubblesOf(item: Item): Record<string, unknown> {
  const meta = item.metadata as Record<string, unknown>;
  const own = meta[BUBBLES_META_KEY];
  if (own && typeof own === "object") return own as Record<string, unknown>;
  const external = meta[EXTERNAL_BUBBLES_META_KEY];
  return external && typeof external === "object" ? external as Record<string, unknown> : {};
}

/** Compute what a long rest would change for one item. Pure — no writes. */
export function planRestore(item: Item): RestorePlan | null {
  const plan: RestorePlan = { resources: [] };

  const bubbles = bubblesOf(item);
  const health = finite(bubbles.health);
  const maxHealth = finite(bubbles["max health"]);
  if (health !== null && maxHealth !== null && maxHealth > 0 && health < maxHealth) {
    plan.hp = { from: health, to: maxHealth };
  }

  for (const resource of readResources(item)) {
    if (resource.longRest !== true) continue;
    if (!(resource.current < resource.max)) continue;
    plan.resources.push({
      id: resource.id,
      name: resource.name,
      from: resource.current,
      to: resource.max,
    });
  }

  if (!plan.hp && plan.resources.length === 0) return null;
  return plan;
}

/**
 * Every scene unit a long rest would change, with the plan attached.
 *
 * Units with nothing to recover (full HP, no spent long-rest
 * resources) are omitted — listing them would only make the GM
 * wonder why clicking them does nothing.
 */
export function collectCandidates(items: Item[]): RestoreCandidate[] {
  const candidates: RestoreCandidate[] = [];
  for (const item of items) {
    const plan = planRestore(item);
    if (!plan) continue;
    const meta = item.metadata as Record<string, unknown>;
    const bubblesName = typeof meta[BUBBLES_NAME_KEY] === "string" ? meta[BUBBLES_NAME_KEY] as string : "";
    candidates.push({
      item,
      name: item.name || bubblesName || "（未命名）",
      card: typeof meta[CARD_BINDING] === "string" && (meta[CARD_BINDING] as string).length > 0,
      bestiary: typeof meta[BESTIARY_SLUG_KEY] === "string" && (meta[BESTIARY_SLUG_KEY] as string).length > 0,
      plan,
    });
  }
  return candidates;
}

/**
 * Apply the planned restores to every candidate except `excluded`.
 *
 * One atomic `updateItems` call for the whole selection: the write is
 * small (a few numbers per token) and a single call keeps the scene
 * consistent even if the GM checks dozens of units.
 *
 * @returns how many units were actually written.
 */
export async function applyLongRest(candidates: RestoreCandidate[], excluded: ReadonlySet<string>): Promise<number> {
  const selected = candidates.filter((candidate) => !excluded.has(candidate.item.id));
  if (selected.length === 0) return 0;
  const plans = new Map(selected.map((candidate) => [candidate.item.id, candidate.plan]));
  const ids = selected.map((candidate) => candidate.item.id);
  let written = 0;
  await OBR.scene.items.updateItems(ids, (drafts) => {
    for (const draft of drafts) {
      const plan = plans.get(draft.id);
      if (!plan) continue;
      const meta = draft.metadata as Record<string, unknown>;
      if (plan.hp) {
        // Follow statEdit's two-namespace convention: the suite key is
        // replaced with the full merged state (we own it entirely), and
        // the upstream Bubbles extension key is shallow-merged ONLY if
        // it already exists — so its own fields (dm only, name, …)
        // survive and neither UI shows a stale HP.
        const ownPrev = (meta[BUBBLES_META_KEY] as Record<string, unknown> | undefined) ?? null;
        const extPrev = (meta[EXTERNAL_BUBBLES_META_KEY] as Record<string, unknown> | undefined) ?? null;
        const base = ownPrev && typeof ownPrev === "object" ? ownPrev
          : extPrev && typeof extPrev === "object" ? extPrev : {};
        meta[BUBBLES_META_KEY] = { ...base, health: plan.hp.to };
        if (extPrev != null && typeof extPrev === "object") {
          meta[EXTERNAL_BUBBLES_META_KEY] = { ...extPrev, health: plan.hp.to };
        }
      }
      if (plan.resources.length > 0) {
        const raw = meta[RESOURCES_KEY];
        const values = Array.isArray(raw) ? raw : [];
        const tops = new Map(plan.resources.map((resource) => [resource.id, resource.to]));
        // Spread-merge per entry so unknown fields (order, unlimited…)
        // survive; only `current` moves.
        meta[RESOURCES_KEY] = values.map((value: unknown) => {
          const entry = value as { id?: unknown } | null;
          const id = entry && typeof entry.id === "string" ? entry.id : "";
          return tops.has(id) ? { ...entry, current: tops.get(id) } : value;
        });
      }
      written++;
    }
  });
  return written;
}
