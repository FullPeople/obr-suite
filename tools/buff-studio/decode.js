// Buff Studio — animated-source decoder.
//
// Turns a dropped file (GIF / animated WebP / APNG / MP4 / WebM / MOV,
// or a plain still image) into a flat list of `ImageBitmap` frames +
// per-frame durations in seconds. Everything downstream (the layer
// compositor, the WebM encoder) just sees ImageBitmaps — it never
// cares whether the source was a GIF or an MP4.
//
// GIF / WebP / APNG  → WebCodecs `ImageDecoder` (built into Chromium).
// MP4 / WebM / MOV   → a hidden <video> element, seeked frame-by-frame.
// Anything else      → decoded as a single still frame.

const IMAGE_DECODER_TYPES = ["image/gif", "image/webp", "image/apng", "image/png"];

function guessType(name) {
  const ext = String(name).toLowerCase().split(".").pop();
  return ({
    gif: "image/gif", webp: "image/webp", apng: "image/apng", png: "image/png",
    jpg: "image/jpeg", jpeg: "image/jpeg", svg: "image/svg+xml",
    mp4: "video/mp4", m4v: "video/mp4", webm: "video/webm",
    mov: "video/quicktime", ogv: "video/ogg",
  })[ext] || "";
}

// Decode a file into { frames: ImageBitmap[], durations: number[], width, height }.
export async function decodeSource(file) {
  const type = file.type || guessType(file.name);
  if (type.startsWith("video/")) return decodeVideo(file, type);
  if (typeof ImageDecoder !== "undefined" && IMAGE_DECODER_TYPES.includes(type)) {
    try {
      return await decodeImageFrames(file, type);
    } catch (e) {
      console.warn("ImageDecoder failed, falling back to still:", e);
    }
  }
  return decodeStill(file);
}

// GIF / animated WebP / APNG via WebCodecs ImageDecoder.
async function decodeImageFrames(file, type) {
  const buf = await file.arrayBuffer();
  const dec = new ImageDecoder({ data: buf, type });
  await dec.tracks.ready;
  // With a fully-buffered ArrayBuffer this resolves ~immediately and
  // makes frameCount reliable (vs. streaming, where it grows).
  try { await dec.completed; } catch { /* still usable */ }
  const track = dec.tracks.selectedTrack;
  const count = (track && track.frameCount) || 1;
  const frames = [];
  const durations = [];
  for (let i = 0; i < count; i++) {
    const { image } = await dec.decode({ frameIndex: i });
    frames.push(await createImageBitmap(image));
    // VideoFrame.duration is in microseconds; GIFs missing it → 100ms.
    durations.push((image.duration || 100000) / 1e6);
    image.close();
  }
  dec.close();
  if (!frames.length) throw new Error("没有解出任何帧");
  return { frames, durations, width: frames[0].width, height: frames[0].height };
}

// MP4 / WebM / MOV via a hidden <video>, seeked frame-by-frame. Slower
// than a real demuxer but needs zero dependencies and works on every
// file the browser itself can play.
async function decodeVideo(file, type) {
  const url = URL.createObjectURL(file);
  const v = document.createElement("video");
  v.muted = true;
  v.playsInline = true;
  v.preload = "auto";
  v.src = url;
  try {
    await new Promise((res, rej) => {
      v.onloadeddata = () => res();
      v.onerror = () => rej(new Error("浏览器无法解码该视频"));
    });
    const dur = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 1;
    const SAMPLE_FPS = 20;
    // Cap at 240 sampled frames so a long clip can't lock the tab.
    const n = Math.min(240, Math.max(1, Math.round(dur * SAMPLE_FPS)));
    const frames = [];
    const durations = [];
    for (let i = 0; i < n; i++) {
      await seekTo(v, (i / n) * dur);
      frames.push(await createImageBitmap(v));
      durations.push(dur / n);
    }
    return { frames, durations, width: v.videoWidth, height: v.videoHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function seekTo(video, t) {
  return new Promise((resolve, reject) => {
    const onSeeked = () => { cleanup(); resolve(); };
    const onErr = () => { cleanup(); reject(new Error("视频跳帧失败")); };
    const cleanup = () => {
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onErr);
    };
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("error", onErr);
    const max = (video.duration || t) - 1e-3;
    video.currentTime = Math.max(0, Math.min(t, max));
  });
}

// Plain still image (PNG / JPG / SVG / single-frame anything).
async function decodeStill(file) {
  const bmp = await createImageBitmap(file);
  return { frames: [bmp], durations: [0.1], width: bmp.width, height: bmp.height };
}
