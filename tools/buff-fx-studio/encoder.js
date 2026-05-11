/* ffmpeg.wasm wrapper — produces VP9 WebM with alpha from a series of
 * RGBA frames.
 *
 * On first use, downloads:
 *   - ffmpeg-core.js  (~5 KB)
 *   - ffmpeg-core.wasm (~30 MB, cached forever after first load)
 *
 * Encoder invocation matches our Python generator (alpha-mode=1 +
 * yuva420p + auto-alt-ref 0 → BlockAdditional alpha in WebM).
 */

// Loaded lazily on first encode.
let _ffmpegPromise = null;

async function getFfmpeg() {
  if (_ffmpegPromise) return _ffmpegPromise;
  _ffmpegPromise = (async () => {
    // ESM import via esm.sh — no bundler needed. esm.sh sets the
    // right CORS headers for the wasm load below.
    const { FFmpeg } = await import("https://esm.sh/@ffmpeg/ffmpeg@0.12.10");
    const { fetchFile } = await import("https://esm.sh/@ffmpeg/util@0.12.1");
    const ffmpeg = new FFmpeg();
    // Single-threaded core. No SharedArrayBuffer / COOP / COEP needed.
    const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd";
    await ffmpeg.load({
      coreURL: `${baseURL}/ffmpeg-core.js`,
      wasmURL: `${baseURL}/ffmpeg-core.wasm`,
    });
    return { ffmpeg, fetchFile };
  })();
  return _ffmpegPromise;
}

/**
 * Encode a sequence of RGBA Uint8Array frames to a WebM blob.
 *
 * @param {Uint8Array[]} frames   each = width * height * 4 bytes
 * @param {number} width
 * @param {number} height
 * @param {number} fps
 * @param {(ratio:number, msg:string)=>void} [onProgress]
 * @returns {Promise<Blob>}
 */
export async function encodeWebm(frames, width, height, fps, onProgress) {
  if (frames.length === 0) throw new Error("no frames");
  const { ffmpeg } = await getFfmpeg();

  if (onProgress) onProgress(0.05, "ffmpeg loaded · concatenating frames");
  // Concatenate all RGBA frames into one big buffer.
  const frameBytes = width * height * 4;
  const total = new Uint8Array(frameBytes * frames.length);
  for (let i = 0; i < frames.length; i++) {
    total.set(frames[i], i * frameBytes);
  }

  if (onProgress) onProgress(0.15, "writing input to ffmpeg vfs");
  await ffmpeg.writeFile("input.rgba", total);

  // Progress events from libvpx — bind once. Ffmpeg-wasm reports a
  // float [0,1] in `progress` events.
  const onFfProgress = ({ progress }) => {
    if (onProgress) {
      const r = 0.20 + Math.min(0.78, progress) * 0.78;
      onProgress(r, `encoding · ${Math.round(progress * 100)}%`);
    }
  };
  ffmpeg.on("progress", onFfProgress);

  try {
    if (onProgress) onProgress(0.20, "encoding VP9 + alpha");
    await ffmpeg.exec([
      "-f", "rawvideo",
      "-pix_fmt", "rgba",
      "-s", `${width}x${height}`,
      "-r", String(fps),
      "-i", "input.rgba",
      "-c:v", "libvpx-vp9",
      "-pix_fmt", "yuva420p",
      "-b:v", "0",
      "-crf", "30",
      "-row-mt", "1",
      "-auto-alt-ref", "0",
      "-metadata:s:v:0", "alpha_mode=1",
      "output.webm",
    ]);
  } finally {
    ffmpeg.off("progress", onFfProgress);
  }

  if (onProgress) onProgress(0.99, "reading output");
  const data = await ffmpeg.readFile("output.webm");
  if (onProgress) onProgress(1.00, "done");
  return new Blob([data.buffer], { type: "video/webm" });
}

/** Pre-warm the ffmpeg.wasm download in the background (call from
 *  page idle so the user doesn't wait at click-time). */
export function prewarmEncoder() {
  // Fire-and-forget; errors are surfaced on the actual encode call.
  getFfmpeg().catch(() => {});
}
