// .fobr world-pack file format.
//
// On disk: magic header + uint32 little-endian payload size + gzipped
// JSON. The header makes the file recognisable without unzipping;
// the JSON carries the actual scene + embedded images.
//
//   bytes 0–4  : "FOBR1"            (5 bytes magic)
//   bytes 5–8  : uint32 (LE)        (size of compressed payload)
//   bytes 9–N  : gzipped JSON       (see Manifest below)
//
// Embedded images live under `images[hash]` and are referenced by
// items via a sentinel URL  `fobr-embed:<hash>`  in their image.url
// field. The importer walks every Image item, swaps the sentinel back
// to a `data:` URL using the embedded base64, and lets OBR add the
// items normally — no asset upload required.
//
// Why data URLs and not asset uploads? The OBR asset API requires
// going through OBR's HTTP upload flow, which a third-party plugin
// can't drive headlessly. data: URLs are universally supported and
// keep the import path purely client-side. Cost is scene-metadata
// size — but the .fobr file already had to carry the image bytes,
// so this is a wash.

export const FOBR_MAGIC = "FOBR1";
export const FOBR_VERSION = 1;
export const EMBED_PREFIX = "fobr-embed:";

export interface FobrManifest {
  version: number;
  meta: {
    exportedAt: number;
    exporter: string; // "obr-suite/1.0.99"
    sceneName?: string;
    sceneId?: string;
    stats: {
      items: number;
      embeddedImages: number;
      totalBytes: number;
    };
    // User-supplied notes (currently unused — reserved for a
    // description / author field if we add it to the export UI).
    notes?: string;
  };
  // Scene-level metadata under OBR.scene.getMetadata(). All keys
  // (suite state, bestiary shared data, character cards list, etc.)
  // round-trip verbatim.
  sceneMetadata: Record<string, unknown>;
  // Room-level metadata under OBR.room.getMetadata(). Only present
  // when the user opted into "include room metadata" at export time
  // (it persists across all scenes in the room — clobbering it on
  // import would also clobber unrelated suite settings the importer
  // never touched). Optional; importers gate apply behind a
  // separate user toggle.
  roomMetadata?: Record<string, unknown>;
  // All scene items. Each is the raw OBR Item shape (position,
  // scale, rotation, layer, type-specific fields, metadata). Image
  // items have their image.url rewritten to `fobr-embed:<hash>`
  // when the source URL was embedded; otherwise the URL is kept as-is.
  items: any[];
  // Hash → image record. Hash is a 16-character base36 of the URL
  // (collision-resistant enough for the embed-table use case).
  images: Record<string, {
    mime: string;
    // Original source URL — kept so the importer can show the user
    // what was embedded if they want to inspect / re-host.
    sourceUrl: string;
    // Base64-encoded image bytes after re-encode.
    data: string;
    // Re-encoded dimensions in case the importer needs them.
    width: number;
    height: number;
    // Original file size pre-compression (for the export-stats UI).
    originalBytes: number;
    // Final encoded size (post compression / re-encode).
    encodedBytes: number;
  }>;
}

// Hash a URL into a short stable token. We don't need cryptographic
// strength — just collision-resistance within a single export. 64-bit
// FNV variant followed by base36 keeps the keys tiny.
export function hashUrl(url: string): string {
  let h = 0xcbf29ce484222325n;
  const PRIME = 0x100000001b3n;
  for (let i = 0; i < url.length; i++) {
    h ^= BigInt(url.charCodeAt(i));
    h = (h * PRIME) & 0xffffffffffffffffn;
  }
  return h.toString(36);
}

// Build the .fobr binary blob from a manifest. Browser-side only —
// uses CompressionStream("gzip").
export async function packFobr(manifest: FobrManifest): Promise<Blob> {
  const json = JSON.stringify(manifest);
  const jsonBytes = new TextEncoder().encode(json);

  // Gzip via CompressionStream — supported in all modern browsers.
  const cs = new CompressionStream("gzip");
  const writer = cs.writable.getWriter();
  void writer.write(jsonBytes);
  void writer.close();
  const gzipped = await new Response(cs.readable).arrayBuffer();

  // Header: magic + uint32 LE size.
  const header = new Uint8Array(FOBR_MAGIC.length + 4);
  for (let i = 0; i < FOBR_MAGIC.length; i++) header[i] = FOBR_MAGIC.charCodeAt(i);
  const sizeView = new DataView(header.buffer, FOBR_MAGIC.length, 4);
  sizeView.setUint32(0, gzipped.byteLength, true);

  return new Blob([header, gzipped], { type: "application/octet-stream" });
}

// Parse a .fobr blob back to a Manifest. Throws if the magic is
// wrong or the gzip can't be decoded.
export async function unpackFobr(blob: Blob): Promise<FobrManifest> {
  const buf = await blob.arrayBuffer();
  const view = new Uint8Array(buf);
  if (view.length < FOBR_MAGIC.length + 4) {
    throw new Error("文件太短，不是有效的 .fobr 文件");
  }
  for (let i = 0; i < FOBR_MAGIC.length; i++) {
    if (view[i] !== FOBR_MAGIC.charCodeAt(i)) {
      throw new Error(`Magic 不匹配 — 不是 .fobr 文件 (got "${String.fromCharCode(...view.slice(0, FOBR_MAGIC.length))}")`);
    }
  }
  const dv = new DataView(buf, FOBR_MAGIC.length, 4);
  const size = dv.getUint32(0, true);
  const payload = view.slice(FOBR_MAGIC.length + 4, FOBR_MAGIC.length + 4 + size);

  const ds = new DecompressionStream("gzip");
  const writer = ds.writable.getWriter();
  void writer.write(payload);
  void writer.close();
  const decompressed = await new Response(ds.readable).text();

  const manifest = JSON.parse(decompressed) as FobrManifest;
  if (typeof manifest !== "object" || manifest === null) {
    throw new Error("文件解析失败：不是 JSON");
  }
  if (manifest.version !== FOBR_VERSION) {
    throw new Error(`不支持的版本 ${manifest.version}（当前版本 ${FOBR_VERSION}）`);
  }
  return manifest;
}
