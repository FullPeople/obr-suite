// World-pack exporter — collects every item + scene metadata from
// the active scene, embeds image bytes (re-encoded under a size cap
// when necessary), and produces a downloadable .fobr blob.
//
// Two-stage flow:
//   1. snapshot the scene synchronously (items + metadata) so an item
//      added during the export doesn't wedge the manifest.
//   2. iterate Image items in parallel batches, fetching + encoding
//      each unique URL once. Progress callbacks let the UI render a
//      live counter.

import OBR from "@owlbear-rodeo/sdk";
import {
  FobrManifest,
  FOBR_VERSION,
  EMBED_PREFIX,
  hashUrl,
  packFobr,
} from "./format";
import {
  fetchAndEncode,
  EncodeOptions,
  DEFAULT_OPTS,
} from "./imageEncode";

export interface ExportProgress {
  phase: "snapshot" | "encoding" | "packing" | "done" | "error";
  doneImages: number;
  totalImages: number;
  message?: string;
}

export interface ExportOptions {
  encodeOpts?: Partial<EncodeOptions>;
  notes?: string;
  /** When true, also snapshot OBR.room.getMetadata() into the pack.
   *  Default false — the room scope is shared across scenes in the
   *  room (suite settings, contributor lists, etc.); shipping it
   *  with a scene file is occasionally useful (handing off a fully
   *  configured room to another DM) but would surprise users who
   *  just want to share one map. */
  includeRoomMetadata?: boolean;
  /** When true, fetch each image URL, re-encode under the size cap,
   *  and embed the bytes into the manifest. Default FALSE because
   *  OBR's item validator rejects `image.url` strings longer than
   *  2048 characters — and a re-encoded data: URL for any non-trivial
   *  image is far over that. We default to keeping original URLs
   *  (typically `https://files.owlbear.app/...` for OBR-uploaded
   *  assets — public CDN, fine to round-trip across rooms).
   *
   *  Embedding is still useful when the user wants a true self-
   *  contained snapshot they can archive offline; they just need to
   *  understand that a re-import via `OBR.scene.items.addItems` will
   *  reject any embedded image bigger than ~1.5KB of base64. */
  embedImages?: boolean;
  /** Called repeatedly as the export progresses; UI can render a bar. */
  onProgress?: (p: ExportProgress) => void;
}

export interface ExportResult {
  blob: Blob;
  manifest: FobrManifest;
  filename: string;
}

// Walk an item to find any image URL that should be embedded. Image
// items expose `image.url`; some homebrew item types also stash URLs
// in metadata, but we ONLY embed the canonical Image.url field here
// — embedding random metadata URLs would balloon scope (different
// plugins use different conventions) for marginal benefit.
function imageUrlOf(item: any): string | null {
  if (item?.type === "IMAGE" && item.image?.url) {
    return String(item.image.url);
  }
  return null;
}

export async function exportScene(opts: ExportOptions = {}): Promise<ExportResult> {
  const onProgress = opts.onProgress ?? (() => {});
  const encodeOpts: EncodeOptions = { ...DEFAULT_OPTS, ...(opts.encodeOpts ?? {}) };

  onProgress({ phase: "snapshot", doneImages: 0, totalImages: 0 });

  // Snapshot scene state.
  const [items, sceneMetadata, roomMetadata, sceneId, sceneName] = await Promise.all([
    OBR.scene.items.getItems(),
    OBR.scene.getMetadata(),
    opts.includeRoomMetadata
      ? OBR.room.getMetadata().catch(() => ({} as Record<string, unknown>))
      : Promise.resolve(undefined as unknown as Record<string, unknown> | undefined),
    Promise.resolve()
      .then(async () => {
        try { return await (OBR.scene as any).getId?.(); } catch { return undefined; }
      }),
    Promise.resolve()
      .then(async () => {
        try { return await (OBR.scene as any).getName?.(); } catch { return undefined; }
      }),
  ]);

  // Deep-clone items so we can rewrite image URLs without mutating
  // the live scene. JSON serialise/parse handles every OBR Item shape.
  const itemsClone = JSON.parse(JSON.stringify(items));

  // Collect unique image URLs ONLY when the user opted into embedding.
  // Default behaviour skips this entirely — items keep their original
  // image.url verbatim, which is what OBR's importer needs (long
  // data: URLs are rejected by the 2048-char length validator).
  const urlToHash = new Map<string, string>();
  if (opts.embedImages) {
    for (const it of itemsClone) {
      const url = imageUrlOf(it);
      if (!url) continue;
      if (url.startsWith("data:")) continue; // already inline
      if (url.startsWith(EMBED_PREFIX)) continue; // already embedded
      if (!urlToHash.has(url)) urlToHash.set(url, hashUrl(url));
    }
  }

  const totalImages = urlToHash.size;
  onProgress({ phase: "encoding", doneImages: 0, totalImages });

  // Encode in parallel batches of 4 — too many concurrent fetches
  // saturates the browser's HTTP/1 connection pool to a single host
  // and stalls the queue. 4 is a happy medium for kiwee + asset CDNs.
  const BATCH = 4;
  const images: FobrManifest["images"] = {};
  const failures: string[] = [];
  const urlList = Array.from(urlToHash.keys());
  let done = 0;
  for (let i = 0; i < urlList.length; i += BATCH) {
    const batch = urlList.slice(i, i + BATCH);
    await Promise.all(
      batch.map(async (url) => {
        const hash = urlToHash.get(url)!;
        try {
          const res = await fetchAndEncode(url, encodeOpts);
          if (res) {
            images[hash] = {
              mime: res.mime,
              sourceUrl: url,
              data: res.data,
              width: res.width,
              height: res.height,
              originalBytes: res.originalBytes,
              encodedBytes: res.encodedBytes,
            };
          } else {
            failures.push(url);
          }
        } catch (e) {
          console.warn("[worldPack/export] image encode failed", url, e);
          failures.push(url);
        }
        done++;
        onProgress({ phase: "encoding", doneImages: done, totalImages });
      }),
    );
  }

  // Rewrite each item's image.url to the embed sentinel where we
  // successfully embedded the source.
  for (const it of itemsClone) {
    const url = imageUrlOf(it);
    if (!url) continue;
    const hash = urlToHash.get(url);
    if (!hash) continue;
    if (!images[hash]) continue; // failed embed → keep original URL
    it.image.url = `${EMBED_PREFIX}${hash}`;
    // Also update mime so OBR knows what format the data: URL we
    // generate at import-time will be.
    it.image.mime = images[hash].mime;
  }

  const exportedAt = Date.now();
  const stats = {
    items: itemsClone.length,
    embeddedImages: Object.keys(images).length,
    totalBytes: 0, // patched after pack
  };

  const manifest: FobrManifest = {
    version: FOBR_VERSION,
    meta: {
      exportedAt,
      exporter: "obr-suite",
      sceneName: typeof sceneName === "string" ? sceneName : undefined,
      sceneId: typeof sceneId === "string" ? sceneId : undefined,
      stats,
      notes: opts.notes,
    },
    sceneMetadata,
    items: itemsClone,
    images,
    roomMetadata: roomMetadata && Object.keys(roomMetadata).length > 0
      ? roomMetadata
      : undefined,
  };

  onProgress({ phase: "packing", doneImages: done, totalImages });
  const blob = await packFobr(manifest);
  manifest.meta.stats.totalBytes = blob.size;

  // Filename — sanitised scene name + date stamp.
  const baseName = (typeof sceneName === "string" && sceneName.trim().length > 0)
    ? sceneName.trim().replace(/[\\/:*?"<>|]/g, "_").slice(0, 60)
    : "scene";
  const stamp = new Date(exportedAt).toISOString().slice(0, 10);
  const filename = `${baseName}-${stamp}.fobr`;

  if (failures.length > 0) {
    console.warn(
      `[worldPack/export] ${failures.length} image(s) couldn't be embedded — kept their original URLs:`,
      failures,
    );
  }

  onProgress({
    phase: "done",
    doneImages: done,
    totalImages,
    message: failures.length > 0
      ? `${failures.length} 张图片无法嵌入（CORS / 404），保留了原 URL`
      : undefined,
  });

  return { blob, manifest, filename };
}

// Helper: trigger the browser download via a temporary <a> tag.
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 1000);
}
