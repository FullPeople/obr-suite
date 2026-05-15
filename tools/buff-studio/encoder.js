/* ffmpeg.wasm wrapper — produces VP8 WebM with alpha from a series of
 * PNG-encoded frames (see encodeWebm).
 *
 * On first use, downloads ffmpeg-core.js + ffmpeg-core.wasm (~30 MB,
 * cached by the browser after the first load).
 *
 * Codec is VP8 (libvpx), not VP9: libvpx-vp9's alpha (yuva420p) path
 * crashes the single-threaded wasm core with "memory access out of
 * bounds" on the very first frame. VP8 + yuva420p is the long-stable
 * WebM-with-alpha encoding and every browser decodes it fine.
 */

// Loaded lazily on first encode.
let _ffmpegPromise = null;

async function getFfmpeg() {
  if (_ffmpegPromise) return _ffmpegPromise;
  _ffmpegPromise = (async () => {
    // Load the ESM builds straight from unpkg's RAW package files —
    // NOT esm.sh. esm.sh bundles the package and drops the `worker.js`
    // sibling, so ffmpeg.wasm's `new URL("./worker.js", import.meta.url)`
    // resolves to a 404 there. unpkg keeps the original dist/ layout,
    // so every relative import — worker.js and the core's siblings
    // included — resolves.
    const FFMPEG_ESM = "https://unpkg.com/@ffmpeg/ffmpeg@0.12.10/dist/esm";
    const CORE_ESM = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm";
    const { FFmpeg } = await import(`${FFMPEG_ESM}/index.js`);
    const { toBlobURL } = await import(
      "https://unpkg.com/@ffmpeg/util@0.12.1/dist/esm/index.js",
    );
    const ffmpeg = new FFmpeg();

    // ffmpeg.wasm always spawns its worker as `{type:"module"}` from a
    // URL on unpkg — cross-origin to obr.dnd.center, which browsers
    // forbid for `new Worker()`. A plain blob of worker.js won't do
    // either: worker.js has relative imports that must resolve against
    // unpkg, not a blob: URL. The shim is a tiny same-origin module
    // worker that just `import`s the real one — cross-origin *import*
    // (unlike Worker construction) is allowed, and worker.js's own
    // imports then resolve against its unpkg URL.
    const workerShim = new Blob(
      [`import ${JSON.stringify(`${FFMPEG_ESM}/worker.js`)};`],
      { type: "text/javascript" },
    );
    const classWorkerURL = URL.createObjectURL(workerShim);

    // Single-threaded core. No SharedArrayBuffer / COOP / COEP needed.
    // The worker runs as a module, so its `importScripts(coreURL)`
    // throws and it falls back to `import(coreURL)` + `.default` — that
    // path needs the ESM core build (the UMD build has no ESM export
    // and would throw ERROR_IMPORT_FAILURE). core.js + wasm are fetched
    // to same-origin blob: URLs; the ESM core is self-contained, so the
    // worker's `import(blobURL)` resolves with no sibling lookups.
    await ffmpeg.load({
      classWorkerURL,
      coreURL: await toBlobURL(`${CORE_ESM}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(`${CORE_ESM}/ffmpeg-core.wasm`, "application/wasm"),
    });
    return { ffmpeg };
  })();
  // A failed load (offline, CDN hiccup) shouldn't poison every future
  // attempt — drop the cached promise on rejection so a retry is fresh.
  _ffmpegPromise.catch(() => { _ffmpegPromise = null; });
  return _ffmpegPromise;
}

/**
 * Encode a sequence of PNG-encoded frames to a VP9+alpha WebM blob.
 *
 * Frames arrive already PNG-compressed (see app.js). Raw RGBA would be
 * width*height*4 bytes each — hundreds of MB across a full clip — and
 * handing ffmpeg.wasm one buffer that big overruns its heap ("memory
 * access out of bounds"). PNG frames written as an image sequence keep
 * the wasm FS footprint small enough to encode at any canvas size.
 *
 * @param {Uint8Array[]} pngFrames  each = one PNG file's bytes
 * @param {number} fps
 * @param {(ratio:number, msg:string)=>void} [onProgress]
 * @returns {Promise<Blob>}
 */
export async function encodeWebm(pngFrames, fps, onProgress) {
  if (pngFrames.length === 0) throw new Error("no frames");
  const { ffmpeg } = await getFfmpeg();
  const written = [];

  try {
    // Write each frame as f00001.png, f00002.png, … for ffmpeg's
    // image2 demuxer (`-i f%05d.png`).
    for (let i = 0; i < pngFrames.length; i++) {
      const name = `f${String(i + 1).padStart(5, "0")}.png`;
      await ffmpeg.writeFile(name, pngFrames[i]);
      written.push(name);
      if (onProgress && i % 12 === 0) {
        onProgress(0.05 + (i / pngFrames.length) * 0.12, `写入帧 ${i + 1}/${pngFrames.length}`);
      }
    }

    // Progress events from libvpx — float [0,1] in `progress` events.
    const onFfProgress = ({ progress }) => {
      if (onProgress) {
        const r = 0.18 + Math.min(0.80, progress) * 0.80;
        onProgress(r, `编码 · ${Math.round(progress * 100)}%`);
      }
    };
    ffmpeg.on("progress", onFfProgress);
    try {
      if (onProgress) onProgress(0.18, "编码 VP8 + alpha");
      await ffmpeg.exec([
        "-framerate", String(fps),
        "-start_number", "1",
        "-i", "f%05d.png",
        // VP8 (libvpx), not VP9 — libvpx-vp9's yuva420p path crashes
        // this single-threaded wasm core ("memory access out of bounds"
        // at frame 1). VP8 + yuva420p is the stable WebM-alpha codec.
        // realtime + cpu-used 8 keeps the encode fast in-browser;
        // -row-mt is dropped (it needs threads the wasm core lacks).
        "-c:v", "libvpx",
        "-pix_fmt", "yuva420p",
        "-deadline", "realtime",
        "-cpu-used", "8",
        "-b:v", "1M",
        "-crf", "16",
        "-auto-alt-ref", "0",
        "-metadata:s:v:0", "alpha_mode=1",
        "output.webm",
      ]);
    } finally {
      ffmpeg.off("progress", onFfProgress);
    }

    if (onProgress) onProgress(0.99, "读取输出");
    const data = await ffmpeg.readFile("output.webm");

    // Clean the wasm FS so frames don't pile up across repeated encodes
    // (getFfmpeg caches one ffmpeg instance for the whole page).
    for (const n of written) { try { await ffmpeg.deleteFile(n); } catch {} }
    try { await ffmpeg.deleteFile("output.webm"); } catch {}

    if (onProgress) onProgress(1.00, "完成");
    return new Blob([data.buffer], { type: "video/webm" });
  } catch (e) {
    // A wasm abort / "memory access out of bounds" leaves the core
    // instance unusable — drop the cached promise so the next encode
    // spins up a fresh worker instead of reusing a dead one.
    _ffmpegPromise = null;
    // ffmpeg.wasm rejects with a plain string, not an Error — wrap it
    // so callers can rely on `.message`.
    throw e instanceof Error ? e : new Error(String(e));
  }
}

/** Pre-warm the ffmpeg.wasm download in the background (call from
 *  page idle so the user doesn't wait at click-time). */
export function prewarmEncoder() {
  // Fire-and-forget; errors are surfaced on the actual encode call.
  getFfmpeg().catch(() => {});
}
