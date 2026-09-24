/* ffmpeg.wasm audio encoder for the music studio.
 *
 * Same load pattern as buff-studio/encoder.js — the worker-shim trick
 * (cross-origin import inside a same-origin module worker) lets us run
 * ffmpeg.wasm from unpkg without SharedArrayBuffer / COOP / COEP.
 *
 * Audio is much simpler than video: one input file → one output file,
 * no PNG-sequence dance. We:
 *   1. write the input bytes to ffmpeg's FS
 *   2. run `ffmpeg -ss start -to end -i in.<ext> -c:a libopus -b:a NNk
 *      -ac N -application audio out.opus`
 *   3. read out.opus back and wrap it as a Blob
 *
 * libopus is part of the standard ffmpeg.wasm core build — no extra
 * config needed. OPUS at 64 kbps mono ≈ 480 KB / minute, fits the
 * "small enough to host on a small server" constraint.
 *
 * `-application audio` (vs voip / lowdelay) hints opusenc to prefer
 * music-quality psychoacoustic settings. The default is "voip" which
 * sounds notably worse on BGM.
 */

import { t as T } from "./i18n.js";

let _ffmpegPromise = null;

async function getFfmpeg() {
  if (_ffmpegPromise) return _ffmpegPromise;
  _ffmpegPromise = (async () => {
    // NB: same unpkg / blob-shim pattern as buff-studio. See that file
    // for the long-form reasoning — short version: unpkg keeps the
    // original dist/ layout (worker.js sibling intact), and the shim is
    // needed because Worker construction is forbidden cross-origin even
    // though module *import* is allowed.
    const FFMPEG_ESM = "https://unpkg.com/@ffmpeg/ffmpeg@0.12.10/dist/esm";
    const CORE_ESM   = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm";
    const { FFmpeg } = await import(`${FFMPEG_ESM}/index.js`);
    const { toBlobURL } = await import(
      "https://unpkg.com/@ffmpeg/util@0.12.1/dist/esm/index.js",
    );
    const ffmpeg = new FFmpeg();

    const workerShim = new Blob(
      [`import ${JSON.stringify(`${FFMPEG_ESM}/worker.js`)};`],
      { type: "text/javascript" },
    );
    const classWorkerURL = URL.createObjectURL(workerShim);

    await ffmpeg.load({
      classWorkerURL,
      coreURL: await toBlobURL(`${CORE_ESM}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(`${CORE_ESM}/ffmpeg-core.wasm`, "application/wasm"),
    });
    return { ffmpeg };
  })();
  _ffmpegPromise.catch(() => { _ffmpegPromise = null; });
  return _ffmpegPromise;
}

/** Pick the input filename extension for ffmpeg.
 *  The actual decoder is auto-detected from container — we just need
 *  the FS write to use a sensible extension so the format prober
 *  doesn't sniff a wrong codec. */
function pickExt(file) {
  const n = (file.name || "input").toLowerCase();
  const m = n.match(/\.([a-z0-9]{1,5})$/);
  if (m) return m[1];
  // Fall back to mime sub-type when name has no extension.
  const mime = (file.type || "").toLowerCase();
  if (mime.includes("mpeg")) return "mp3";
  if (mime.includes("wav"))  return "wav";
  if (mime.includes("ogg"))  return "ogg";
  if (mime.includes("flac")) return "flac";
  if (mime.includes("webm")) return "webm";
  if (mime.includes("mp4") || mime.includes("aac")) return "m4a";
  return "bin";
}

/**
 * Encode a clip of an input audio file to OPUS.
 *
 * @param {File|Blob} file
 * @param {object} opts
 * @param {number}  opts.trimStart   seconds (default 0)
 * @param {number}  opts.trimEnd     seconds (default = file end)
 * @param {number}  opts.bitrate     kbps (default 64)
 * @param {1|2}     opts.channels    (default 1)
 * @param {(ratio:number,msg:string)=>void} [opts.onProgress]
 * @returns {Promise<Blob>}  the encoded .opus blob
 */
export async function encodeOpus(file, opts = {}) {
  const trimStart = Math.max(0, opts.trimStart ?? 0);
  const trimEnd   = opts.trimEnd ?? null;
  const bitrate   = Math.max(8, Math.min(256, opts.bitrate ?? 64));
  const channels  = opts.channels === 2 ? 2 : 1;
  const onProg    = typeof opts.onProgress === "function" ? opts.onProgress : null;

  if (onProg) onProg(0.02, T("muEncLoadFfmpeg"));
  const { ffmpeg } = await getFfmpeg();

  const ext = pickExt(file);
  const inName  = `in.${ext}`;
  const outName = "out.opus";

  // Wire progress events. ffmpeg's `progress` ratio is fractional
  // relative to the input's total duration — for trimmed clips this
  // can overshoot 1.0, so clamp.
  const onProgEvt = ({ progress }) => {
    if (onProg) onProg(Math.min(0.98, 0.05 + Math.max(0, progress) * 0.92), T("muEncEncoding"));
  };
  ffmpeg.on("progress", onProgEvt);

  try {
    if (onProg) onProg(0.05, T("muEncWriting"));
    const ab = await file.arrayBuffer();
    await ffmpeg.writeFile(inName, new Uint8Array(ab));

    // Build args. -ss / -to BEFORE -i means input-side seek, which is
    // both faster (skips decoding skipped frames) and accurate for
    // common formats (mp3/m4a/ogg/wav) given the decoder seek tables.
    const args = ["-y"];
    if (trimStart > 0)        args.push("-ss", String(trimStart));
    if (trimEnd != null && trimEnd > trimStart) args.push("-to", String(trimEnd));
    args.push("-i", inName);
    args.push("-vn");                   // ignore embedded cover art
    args.push("-c:a", "libopus");
    args.push("-b:a", `${bitrate}k`);
    args.push("-ac", String(channels));
    args.push("-application", "audio"); // music-quality psychoacoustics
    args.push("-frame_duration", "20"); // 20ms frames — std for music
    args.push(outName);

    await ffmpeg.exec(args);

    if (onProg) onProg(0.99, T("muEncReading"));
    const data = await ffmpeg.readFile(outName);
    const out = new Blob([data.buffer], { type: "audio/ogg; codecs=opus" });
    if (onProg) onProg(1, T("muEncDone"));
    return out;
  } finally {
    // Always try to clean up the FS so repeat encodes don't accumulate.
    ffmpeg.off("progress", onProgEvt);
    try { await ffmpeg.deleteFile(inName);  } catch {}
    try { await ffmpeg.deleteFile(outName); } catch {}
  }
}

/** Heuristic bytes estimate without actually encoding. Good enough for
 *  the "预计大小" readout in the UI — uses OPUS's nominal bitrate plus
 *  a small fixed overhead for the OGG container. */
export function estimateOpusBytes(seconds, kbps) {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  const payload = seconds * (kbps * 1000) / 8;
  return Math.round(payload + 4096); // ~4 KB OGG header / page overhead
}
