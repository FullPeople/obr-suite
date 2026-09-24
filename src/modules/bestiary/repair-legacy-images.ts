import OBR, { Image, isImage, Item } from "@owlbear-rodeo/sdk";
import { TRANSFORM_STACK_KEY } from "../transform/shared";

// 2026-08-20 — one-shot repair for scenes created before the kiwee image
// migration (stable 1.1.10). Tokens spawned by the bestiary — both this
// suite and the old standalone plugin — bake the image URL into the scene
// item, so the code-side IMG_BASE switch never reaches them and they keep
// pointing at the retired obr.dnd.center proxy. Transform snapshots carry
// the same baked URL and would restore it on 解除变身.
//
// IMG_BASE was `https://obr.dnd.center/5etools-img` from the first bestiary
// release (2026-04-27) until the kiwee switch, so this single prefix covers
// every historical token. External homebrew URLs are left untouched.
const LEGACY_IMG_PREFIXES = [
  "https://obr.dnd.center/5etools-img/",
  "http://obr.dnd.center/5etools-img/",
];
const NEW_IMG_PREFIX = "https://5e.kiwee.top/img/";

/** Returns the migrated URL when `url` uses a legacy prefix, else null.
 *  Only the prefix changes — path and extension survive, so the stored
 *  mime type stays valid. */
export function migrateLegacyImageUrl(url: unknown): string | null {
  if (typeof url !== "string") return null;
  for (const prefix of LEGACY_IMG_PREFIXES) {
    if (url.startsWith(prefix)) return NEW_IMG_PREFIX + url.slice(prefix.length);
  }
  return null;
}

type TransformSnapshot = { image?: { url?: unknown } };

function readTransformStack(item: Item): TransformSnapshot[] {
  const raw = (item.metadata as Record<string, unknown> | undefined)?.[
    TRANSFORM_STACK_KEY
  ];
  return Array.isArray(raw) ? (raw as TransformSnapshot[]) : [];
}

export interface RepairLegacyImagesResult {
  /** Items whose live image URL was rewritten. */
  imagesTouched: number;
  /** Transform-stack snapshots whose stored image URL was rewritten. */
  snapshotsTouched: number;
  /** Distinct items updated (image and/or snapshots). */
  itemsTouched: number;
  /** Items scanned in the current scene. */
  total: number;
}

/** Rewrite every legacy bestiary image URL in the current scene — the live
 *  `image.url` of tokens plus the URLs inside transform snapshots — to the
 *  kiwee mirror. Scene-scoped: OBR only exposes the open scene, so the DM
 *  runs this once per affected scene. Errors propagate to the caller so the
 *  settings page can surface them; nothing is swallowed here. */
export async function repairLegacyBestiaryImages(): Promise<RepairLegacyImagesResult> {
  const items = await OBR.scene.items.getItems();

  const targetIds: string[] = [];
  let imagesTouched = 0;
  let snapshotsTouched = 0;
  const evidence: { id: string; from: string; to: string }[] = [];

  for (const it of items) {
    let hit = false;
    if (isImage(it)) {
      const next = migrateLegacyImageUrl(it.image.url);
      if (next) {
        hit = true;
        imagesTouched++;
        evidence.push({ id: it.id, from: it.image.url, to: next });
      }
    }
    for (const snap of readTransformStack(it)) {
      const next = migrateLegacyImageUrl(snap.image?.url);
      if (next) {
        hit = true;
        snapshotsTouched++;
        evidence.push({ id: it.id, from: String(snap.image!.url), to: next });
      }
    }
    if (hit) targetIds.push(it.id);
  }

  if (targetIds.length === 0) {
    return { imagesTouched: 0, snapshotsTouched: 0, itemsTouched: 0, total: items.length };
  }

  // Evidence trail before mutating, so a failed updateItems still leaves
  // the exact old→new mapping in the console.
  console.info(
    `[obr-suite/bestiary] repairing ${imagesTouched} token image(s) + ${snapshotsTouched} transform snapshot(s) on ${targetIds.length} item(s)`,
    evidence,
  );

  await OBR.scene.items.updateItems(targetIds, (drafts) => {
    for (const d of drafts) {
      if (isImage(d as Item)) {
        const di = d as Image;
        const next = migrateLegacyImageUrl(di.image.url);
        if (next) di.image = { ...di.image, url: next };
      }
      const stack = (d.metadata as Record<string, unknown> | undefined)?.[
        TRANSFORM_STACK_KEY
      ];
      if (Array.isArray(stack)) {
        for (const snap of stack as TransformSnapshot[]) {
          const next = migrateLegacyImageUrl(snap.image?.url);
          if (next) snap.image!.url = next;
        }
      }
    }
  });

  return {
    imagesTouched,
    snapshotsTouched,
    itemsTouched: targetIds.length,
    total: items.length,
  };
}
