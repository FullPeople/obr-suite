// Read / write per-token resource arrays from OBR scene metadata.
//
// All resources for a token live in a single array under
// `RESOURCES_KEY`. Updates go through OBR.scene.items.updateItems
// which broadcasts to every client — small payload, no broadcast
// limit issues even with dozens of resources.

import OBR, { Item } from "@owlbear-rodeo/sdk";
import { Resource, RESOURCES_KEY } from "./types";

export type ResourceWriteGuard = (item: Item) => boolean;

/** One edit session uses one atomic operation. An edit of a deleted resource
 * never falls through to create, and duplicate saves never append twice. */
export async function commitResourceEdit(itemId: string, resourceId: string | null, resource: Resource | null, shouldApply: ResourceWriteGuard): Promise<boolean> {
  let changed = false;
  await OBR.scene.items.updateItems([itemId], (drafts) => {
    const item = drafts[0];
    if (!item || !shouldApply(item)) return;
    const raw = item.metadata[RESOURCES_KEY];
    const values = Array.isArray(raw) ? raw : [];
    const index = resourceId ? values.findIndex((value: any) => value?.id === resourceId) : -1;
    if (resourceId && index < 0) return;
    if (!resource) {
      if (!resourceId) return;
      item.metadata[RESOURCES_KEY] = values.filter((value: any) => value?.id !== resourceId);
    } else {
      if (!normaliseResource(resource) || (resourceId && resource.id !== resourceId)) return;
      if (resourceId) values[index] = { ...values[index], ...resource };
      else {
        if (values.some((value: any) => value?.id === resource.id)) return;
        values.push(resource);
      }
      item.metadata[RESOURCES_KEY] = values;
    }
    changed = true;
  });
  return changed;
}

/** Read the resources array from a token's metadata. Returns [] if
 *  none configured or metadata malformed. */
export function readResources(item: Item | null | undefined): Resource[] {
  if (!item) return [];
  const raw = (item.metadata as any)?.[RESOURCES_KEY];
  if (!Array.isArray(raw)) return [];
  return raw
    .map(normaliseResource)
    .filter((r): r is Resource => r !== null);
}

function normaliseResource(raw: unknown): Resource | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as any;
  if (typeof r.id !== "string" || !r.id) return null;
  if (typeof r.name !== "string") return null;
  if (r.type !== "count" && r.type !== "bar" && r.type !== "number") return null;
  const cur = Number(r.current);
  const max = Number(r.max);
  if (!Number.isFinite(cur) || !Number.isFinite(max)) return null;
  return {
    id: r.id,
    name: r.name,
    type: r.type,
    current: cur,
    max: max,
    icon: typeof r.icon === "string" ? r.icon : "gem",
    order: typeof r.order === "number" ? r.order : undefined,
  };
}

/** Replace the entire resources array for one token. */
export async function writeResources(
  itemId: string,
  next: Resource[],
  shouldApply?: ResourceWriteGuard,
): Promise<void> {
  try {
    await OBR.scene.items.updateItems([itemId], (drafts) => {
      const d = drafts[0];
      if (!d || (shouldApply && !shouldApply(d))) return;
      (d.metadata as any)[RESOURCES_KEY] = next;
    });
  } catch (e) {
    console.error("[obr-suite/resources] writeResources failed", e);
  }
}

/** Mutate one resource and write back. The reducer receives the
 *  current resource and returns the next state; the resource is
 *  matched by id. Used by every click-to-modify action. */
export async function updateResource(
  itemId: string,
  resourceId: string,
  reducer: (cur: Resource) => Resource,
  shouldApply?: ResourceWriteGuard,
): Promise<Resource | null> {
  let next: Resource | null = null;
  try {
    await OBR.scene.items.updateItems([itemId], (drafts) => {
      const d = drafts[0];
      if (!d || (shouldApply && !shouldApply(d))) return;
      const arr = (d.metadata as any)?.[RESOURCES_KEY];
      if (!Array.isArray(arr)) return;
      const i = arr.findIndex((r: any) => r?.id === resourceId);
      if (i < 0) return;
      const cur = normaliseResource(arr[i]);
      if (!cur) return;
      const upd = reducer(cur);
      arr[i] = { ...arr[i], ...upd };
      next = arr[i];
    });
  } catch (e) {
    console.error("[obr-suite/resources] updateResource failed", e);
  }
  return next;
}

/** Reordering changes order only; concurrent values, added resources and
 * legacy repair markers remain in the latest SDK draft. */
export async function reorderResources(itemId: string, orderedIds: string[], shouldApply?: ResourceWriteGuard): Promise<void> {
  await OBR.scene.items.updateItems([itemId], (drafts) => {
    const item = drafts[0];
    if (!item || (shouldApply && !shouldApply(item))) return;
    const resources = item.metadata[RESOURCES_KEY];
    if (!Array.isArray(resources)) return;
    const rank = new Map(orderedIds.map((id, index) => [id, index]));
    const sorted = [...resources].sort((a, b) => (rank.get(a?.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b?.id) ?? Number.MAX_SAFE_INTEGER));
    item.metadata[RESOURCES_KEY] = sorted.map((resource, order) => ({ ...resource, order }));
  });
}

/** Add a new resource to the end of the array. */
export async function addResource(
  itemId: string,
  resource: Resource,
  shouldApply?: ResourceWriteGuard,
): Promise<void> {
  try {
    await OBR.scene.items.updateItems([itemId], (drafts) => {
      const d = drafts[0];
      if (!d || (shouldApply && !shouldApply(d))) return;
      const arr = (d.metadata as any)?.[RESOURCES_KEY];
      const next = Array.isArray(arr) ? [...arr] : [];
      next.push(resource);
      (d.metadata as any)[RESOURCES_KEY] = next;
    });
  } catch (e) {
    console.error("[obr-suite/resources] addResource failed", e);
  }
}

// Written by the character-card bind flow before it repairs legacy
// degenerate/duplicate resource ids (checklist §2). Mirrored in
// characterCards/bind-page.ts — keep the literal in sync.
export const RESOURCES_BACKUP_KEY = "com.obr-suite/resources/backup-pre-idfix";

/** Roll back the resource-id repair as an ID-ONLY inverse: every entry
 *  stamped with `legacyId` gets that id back (and the stamp removed);
 *  current/max values, resources added since the repair, and every
 *  untouched entry are preserved. Restoring the full backup snapshot
 *  instead would silently destroy all state accrued since the repair
 *  — the snapshot stays in metadata purely as audit evidence until the
 *  rollback deletes it. Returns the reverted-entry count, or null when
 *  there is nothing to revert / the write fails. */
export async function restoreResourceIdBackup(itemId: string, shouldApply?: ResourceWriteGuard): Promise<number | null> {
  let reverted: number | null = null;
  try {
    await OBR.scene.items.updateItems([itemId], (drafts) => {
      const d = drafts[0];
      if (!d || (shouldApply && !shouldApply(d))) return;
      const arr = (d.metadata as any)?.[RESOURCES_KEY];
      const hasBackup = RESOURCES_BACKUP_KEY in (d.metadata as any);
      if (!Array.isArray(arr) && !hasBackup) return;
      let n = 0;
      if (Array.isArray(arr)) {
        for (const r of arr) {
          if (r && typeof r === "object" && typeof (r as any).legacyId === "string") {
            (r as any).id = (r as any).legacyId;
            delete (r as any).legacyId;
            n++;
          }
        }
      }
      if (hasBackup) delete (d.metadata as any)[RESOURCES_BACKUP_KEY];
      reverted = n;
    });
    if (reverted === null) {
      console.warn("[obr-suite/resources] restoreResourceIdBackup: nothing to revert on item", { itemId });
    } else {
      console.info("[obr-suite/resources] reverted resource-id repair (id-only)", { itemId, entries: reverted });
    }
  } catch (e) {
    console.error("[obr-suite/resources] restoreResourceIdBackup failed", { itemId, error: e });
    return null;
  }
  return reverted;
}

/** Remove a resource by id. */
export async function deleteResource(
  itemId: string,
  resourceId: string,
  shouldApply?: ResourceWriteGuard,
): Promise<void> {
  try {
    await OBR.scene.items.updateItems([itemId], (drafts) => {
      const d = drafts[0];
      if (!d || (shouldApply && !shouldApply(d))) return;
      const arr = (d.metadata as any)?.[RESOURCES_KEY];
      if (!Array.isArray(arr)) return;
      (d.metadata as any)[RESOURCES_KEY] = arr.filter((r: any) => r?.id !== resourceId);
    });
  } catch (e) {
    console.error("[obr-suite/resources] deleteResource failed", e);
  }
}
