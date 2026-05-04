// Image fetch + re-encode helpers for the world pack.
//
// Goal: shrink large maps without losing detail. We:
//   1. Fetch the original image as a Blob via fetch() (skipping CORS-
//      blocked URLs gracefully — those stay as-is in the export).
//   2. Decode via createImageBitmap so we can re-encode without DOM
//      manipulation.
//   3. If the longest side exceeds `maxDimension`, downscale
//      proportionally (high-quality drawImage with imageSmoothingQuality
//      = "high"). For battlemaps this preserves grid lines and feature
//      edges while halving the byte count.
//   4. Re-encode as JPEG at progressively lower quality until the
//      result is under `targetBytes`. JPEG (not WebP) for compatibility
//      — every browser decodes JPEG; WebP is universal in OBR but a
//      few exotic environments (older Safari forks) still struggle.
//   5. PNG-input images that look like grids / line art (small palette,
//      lots of identical pixels) skip the re-encode and pass through
//      gzipped instead — JPEG would smear pixel art.
//
// Returns base64 data, mime, dimensions, and byte counts so the
// caller can update the manifest's `images` map directly.

export interface EncodeResult {
  data: string; // base64
  mime: string;
  width: number;
  height: number;
  originalBytes: number;
  encodedBytes: number;
  /** True when re-encoding actually changed the bytes (vs. pass-through). */
  reencoded: boolean;
}

export interface EncodeOptions {
  /** Cap on the longest side in pixels. Larger images get downscaled. */
  maxDimension: number; // default 2048
  /** Per-image target file size in bytes. We'll lower JPEG quality
   *  until the encoded blob fits under this. */
  targetBytes: number; // default 1.5 MB
  /** Initial JPEG quality. Drops in 0.1 steps until target met. */
  initialQuality: number; // default 0.9
  /** Floor for the JPEG quality. Don't go below this even if the
   *  target isn't met — preserves a usable image. */
  minQuality: number; // default 0.55
}

export const DEFAULT_OPTS: EncodeOptions = {
  maxDimension: 2048,
  targetBytes: 1.5 * 1024 * 1024,
  initialQuality: 0.9,
  minQuality: 0.55,
};

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const r = reader.result as string;
      // FileReader returns "data:image/png;base64,XXXX" — strip the
      // prefix; the manifest stores the mime separately.
      const comma = r.indexOf(",");
      resolve(comma >= 0 ? r.slice(comma + 1) : r);
    };
    reader.readAsDataURL(blob);
  });
}

// Detect "pixel-arty" images that should NOT go through JPEG. Heuristic:
// a small image (≤256px) with PNG input + lots of repeated pixels is
// almost certainly a token sprite or icon and benefits from gzipped
// PNG over a smeary JPEG. We just check the input mime + dimensions.
function shouldPassthrough(mime: string, w: number, h: number): boolean {
  if (mime === "image/svg+xml") return true; // SVG: never re-encode
  if (mime === "image/png" && Math.max(w, h) <= 256) return true;
  return false;
}

export async function fetchAndEncode(
  url: string,
  opts: EncodeOptions = DEFAULT_OPTS,
): Promise<EncodeResult | null> {
  // Skip data: URLs — they're already inline. The caller can embed
  // the raw data: string into the manifest as-is via a separate path.
  if (url.startsWith("data:")) return null;
  // Skip our own embed sentinel — happens when re-exporting a scene
  // that was originally imported from a .fobr.
  if (url.startsWith("fobr-embed:")) return null;

  let blob: Blob;
  try {
    const res = await fetch(url, { cache: "no-cache", mode: "cors" });
    if (!res.ok) return null;
    blob = await res.blob();
  } catch {
    // CORS / 404 / network — skip silently. The export still works,
    // just leaves the URL as-is in the item.
    return null;
  }

  const originalBytes = blob.size;
  const inputMime = blob.type || "image/png";

  // Decode for dimensions / re-encoding decisions.
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    return null;
  }
  const w0 = bitmap.width;
  const h0 = bitmap.height;

  // Pass-through path — no scaling, no re-encode. Just embed the
  // original blob bytes as base64 (still gzipped at the manifest level).
  if (shouldPassthrough(inputMime, w0, h0) || originalBytes <= opts.targetBytes / 2) {
    const data = await blobToBase64(blob);
    return {
      data,
      mime: inputMime,
      width: w0,
      height: h0,
      originalBytes,
      encodedBytes: blob.size,
      reencoded: false,
    };
  }

  // Compute target dimensions.
  const longest = Math.max(w0, h0);
  const scale = longest > opts.maxDimension ? opts.maxDimension / longest : 1;
  const W = Math.round(w0 * scale);
  const H = Math.round(h0 * scale);

  // Render to an offscreen canvas. OffscreenCanvas where available;
  // fall back to a normal HTMLCanvasElement.
  const canvas =
    typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(W, H)
      : (() => { const c = document.createElement("canvas"); c.width = W; c.height = H; return c; })();
  const ctx = (canvas as any).getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) return null;
  (ctx as any).imageSmoothingEnabled = true;
  (ctx as any).imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, W, H);
  bitmap.close?.();

  // Quality ladder — start at initialQuality, drop until we fit.
  let q = opts.initialQuality;
  let outBlob: Blob | null = null;
  // PNG input with transparency stays PNG (the canvas can serialise
  // PNG too). Otherwise JPEG.
  const outMime = inputMime === "image/png" ? "image/png" : "image/jpeg";
  while (q >= opts.minQuality) {
    if ((canvas as any).convertToBlob) {
      outBlob = await (canvas as OffscreenCanvas).convertToBlob({
        type: outMime,
        quality: outMime === "image/jpeg" ? q : undefined,
      });
    } else {
      outBlob = await new Promise<Blob | null>((resolve) => {
        (canvas as HTMLCanvasElement).toBlob(
          (b) => resolve(b),
          outMime,
          outMime === "image/jpeg" ? q : undefined,
        );
      });
    }
    if (!outBlob) return null;
    if (outBlob.size <= opts.targetBytes) break;
    if (outMime !== "image/jpeg") break; // PNG quality slider doesn't exist; one shot
    q -= 0.1;
  }
  if (!outBlob) return null;
  const data = await blobToBase64(outBlob);
  return {
    data,
    mime: outMime,
    width: W,
    height: H,
    originalBytes,
    encodedBytes: outBlob.size,
    reencoded: true,
  };
}
