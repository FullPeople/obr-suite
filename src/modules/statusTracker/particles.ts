// Status Tracker — image-based particle effects.
//
// Each particle is a scene.local IMAGE item showing a user-provided
// (or default) PNG/SVG. Animation runs in JS via setInterval (NOT
// requestAnimationFrame, which the browser pauses in non-visible
// iframes — that's why earlier rAF-based ticks only fired briefly
// during drag/select).
//
// Why scene.local: same as before — only this client (the GM) sees
// the particles, satisfying both the OBR API constraint and the
// "hidden tokens only show effects to DM" requirement.
//
// Why Image items, not Text/Effect:
//   • Text items can't be tinted by buff colour cleanly.
//   • SkSL Effect items can't sample arbitrary user-supplied
//     textures (OBR's `Uniform.value` is `number | Vector2 |
//     Vector3 | Matrix` — no sampler type), so PNG/emoji glyphs
//     are unreachable from the shader path.
//   • Image items render arbitrary URLs the user picks (or pastes),
//     and OBR caches them via its image-fetcher.
//
// Trade-off: Image-based particles run on the JS tick (not GPU) so
// smoothness is bounded by IPC latency. ~25fps is achievable on
// desktop. Mobile is forced into "no animation" mode below — the
// per-tick cost on mobile browsers is too unreliable, and our
// static curved-band bubble (rendered via bubbles.ts) gives mobile
// users the same buff-state information without needing animation.
//
// Caching:
//   • OBR-asset URLs (returned by OBR.assets.downloadImages) are
//     persistent — once OBR has uploaded the file the URL stays
//     valid across sessions, so we just remember the URL string.
//   • External URLs are cached at the HTTP layer by the browser.
//   • Image dimensions are queried via a hidden `new Image()` once
//     per URL and memoised in `dimCache` so subsequent particle
//     creations skip the DOM probe.

import OBR, { buildImage, Item } from "@owlbear-rodeo/sdk";
import { PLUGIN_ID, BuffDef, BuffEffect } from "./types";
import { assetUrl } from "../../asset-base";

const OWNER_KEY = `${PLUGIN_ID}/buff-owner`;
const ROLE_KEY = `${PLUGIN_ID}/buff-role`;
const BUFF_ID_KEY = `${PLUGIN_ID}/buff-id`;

const TARGET_FPS = 25;
const TICK_INTERVAL_MS = Math.round(1000 / TARGET_FPS);

// Mobile UA detection. Mobile browsers throttle setInterval more
// aggressively when the active tab loses partial focus (e.g. user
// scrolls), and per-tick IPC bandwidth tends to be tighter on
// mobile. We just skip particle rendering on mobile entirely; the
// static curved-band bubble (bubbles.ts) is enough to communicate
// buff state.
function isMobile(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

// === Default particle asset =========================================
// Bundled at /suite{,-dev}/particle.svg. White 4-point sparkle —
// works as a generic "magic effect" particle on any background.
// Users who want per-buff colour identification upload their own
// coloured PNGs via the palette ✎ popup.
function defaultImageUrl(): string { return assetUrl("particle.svg"); }

function mimeFromUrl(url: string): string {
  if (/\.svg(\?|#|$)/i.test(url)) return "image/svg+xml";
  if (/\.png(\?|#|$)/i.test(url)) return "image/png";
  if (/\.(jpe?g)(\?|#|$)/i.test(url)) return "image/jpeg";
  if (/\.webp(\?|#|$)/i.test(url)) return "image/webp";
  if (/\.gif(\?|#|$)/i.test(url)) return "image/gif";
  return "image/png";
}

// === Image dimension cache ==========================================

const dimCache = new Map<string, { w: number; h: number }>();
const dimInflight = new Map<string, Promise<{ w: number; h: number }>>();

async function getImageDims(url: string, hintW?: number, hintH?: number): Promise<{ w: number; h: number }> {
  if (typeof hintW === "number" && typeof hintH === "number" && hintW > 0 && hintH > 0) {
    return { w: hintW, h: hintH };
  }
  const cached = dimCache.get(url);
  if (cached) return cached;
  const inflight = dimInflight.get(url);
  if (inflight) return inflight;
  const p = new Promise<{ w: number; h: number }>((resolve) => {
    if (typeof Image === "undefined") {
      resolve({ w: 100, h: 100 });
      return;
    }
    const img = new Image();
    img.onload = () => {
      const dims = {
        w: img.naturalWidth || 100,
        h: img.naturalHeight || 100,
      };
      dimCache.set(url, dims);
      dimInflight.delete(url);
      resolve(dims);
    };
    img.onerror = () => {
      dimInflight.delete(url);
      resolve({ w: 100, h: 100 });
    };
    img.src = url;
  });
  dimInflight.set(url, p);
  return p;
}

// === Defaults =======================================================

function defaultParticleCount(eff: BuffEffect): number {
  switch (eff) {
    case "float":   return 5;
    case "drop":    return 5;
    case "flicker": return 4;
    case "curve":   return 6;
    case "spread":  return 8;
    default:        return 0;
  }
}

function isBelowToken(eff: BuffEffect): boolean {
  return eff === "curve" || eff === "spread";
}

// === Per-particle state =============================================

interface ParticleSpec {
  speed: number;
  phaseOffset: number;
  xOff: number;
  yOff: number;
  baseSize: number;
  baseAngle: number;
  ringIdx: number;
}

interface ParticleSet {
  tokenId: string;
  buffId: string;
  effectMode: BuffEffect;
  imageUrl: string;
  imageW: number;
  imageH: number;
  itemIds: string[];
  specs: ParticleSpec[];
  cx: number; cy: number;
  tokenW: number; tokenH: number;
  ringRadius: number;
  baseSize: number;
  speedMul: number;
  flickerCache: Map<number, { px: number; py: number }>;
}

const sets = new Map<string, ParticleSet>();
let intervalId: ReturnType<typeof setInterval> | null = null;
let ticking = false;
const t0 = performance.now();

function setKey(tokenId: string, buffId: string): string {
  return `${tokenId}|${buffId}`;
}

function hash3(a: string, b: string, c: number): number {
  let h = 5381;
  for (let i = 0; i < a.length; i++) h = ((h << 5) + h + a.charCodeAt(i)) | 0;
  for (let i = 0; i < b.length; i++) h = ((h << 5) + h + b.charCodeAt(i)) | 0;
  h = ((h << 5) + h + c) | 0;
  return Math.abs(h);
}

function makeSpecs(tokenId: string, buffId: string, count: number): ParticleSpec[] {
  const out: ParticleSpec[] = [];
  for (let i = 0; i < count; i++) {
    const h = hash3(tokenId, buffId, i);
    const r1 = (h & 0xff) / 0xff;
    const r2 = ((h >> 8) & 0xff) / 0xff;
    const r3 = ((h >> 16) & 0xff) / 0xff;
    const r4 = ((h >> 24) & 0xff) / 0xff;
    out.push({
      speed: 0.7 + r1 * 0.6,
      phaseOffset: r2,
      xOff: 0.15 + r3 * 0.7,
      yOff: 0.15 + r4 * 0.7,
      baseSize: 0.7 + r1 * 0.6,
      baseAngle: r2 * Math.PI * 2,
      ringIdx: i % 3,
    });
  }
  return out;
}

function uuidV4(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function smoothstep01(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// === Animation per effect mode ======================================
// Returns the desired position + scale for one particle at the
// current time. Scale doubles as opacity since OBR Image items
// don't have a fillOpacity / alpha field — shrinking to 0 reads
// visually as fading out, growing from 0 reads as fading in.

interface ParticleUpdate { x: number; y: number; scale: number; }

function computeUpdate(set: ParticleSet, spec: ParticleSpec, now: number): ParticleUpdate {
  const { effectMode, cx, cy, tokenW, tokenH, ringRadius, baseSize, speedMul } = set;
  const tw = Math.max(20, tokenW);
  const th = Math.max(20, tokenH);
  let x = cx, y = cy, scale = 0;

  switch (effectMode) {
    case "float": {
      const t = (now * 0.4 * spec.speed * speedMul + spec.phaseOffset) % 1;
      x = cx + (spec.xOff - 0.5) * tw * 0.85;
      y = (cy + th * 0.6) + ((cy - th * 0.6) - (cy + th * 0.6)) * t;
      const s = Math.sin(t * Math.PI);
      scale = baseSize * spec.baseSize * (0.4 + 0.7 * s);
      break;
    }
    case "drop": {
      const t = (now * 0.4 * spec.speed * speedMul + spec.phaseOffset) % 1;
      x = cx + (spec.xOff - 0.5) * tw * 0.85;
      y = (cy - th * 0.6) + ((cy + th * 0.6) - (cy - th * 0.6)) * t;
      const s = Math.sin(t * Math.PI);
      scale = baseSize * spec.baseSize * (0.4 + 0.7 * s);
      break;
    }
    case "flicker": {
      const period = 1.0 + spec.baseSize * 0.5;
      const phaseT = now / period + spec.phaseOffset;
      const t = phaseT - Math.floor(phaseT);
      const cycle = Math.floor(phaseT);
      let pos = set.flickerCache.get(cycle * 100 + spec.ringIdx);
      if (!pos) {
        const h = hash3(set.tokenId, set.buffId, cycle * 100 + spec.ringIdx);
        pos = {
          px: ((h & 0xff) / 0xff - 0.5) * tw * 0.7,
          py: (((h >> 8) & 0xff) / 0xff - 0.5) * th * 0.7,
        };
        set.flickerCache.set(cycle * 100 + spec.ringIdx, pos);
        if (set.flickerCache.size > 24) {
          const oldestKey = set.flickerCache.keys().next().value;
          if (oldestKey !== undefined) set.flickerCache.delete(oldestKey);
        }
      }
      x = cx + pos.px;
      y = cy + pos.py;
      const pulse = t < 0.2 ? t / 0.2 : t < 0.7 ? 1.0 : Math.max(0, 1 - (t - 0.7) / 0.3);
      scale = baseSize * spec.baseSize * pulse;
      break;
    }
    case "curve": {
      const t = (now * 0.32 * spec.speed * speedMul + spec.phaseOffset) % 1;
      const wobble = Math.sin(t * Math.PI * 4 + spec.baseAngle) * 0.25 * t;
      const ang = spec.baseAngle + wobble;
      const maxR = ringRadius + Math.max(tw, th) * 0.3;
      const radius = t * maxR;
      x = cx + Math.cos(ang) * radius;
      y = cy + Math.sin(ang) * radius;
      const fade = t < 0.15 ? t / 0.15 : 1 - smoothstep01(0.6, 1.0, t);
      scale = baseSize * spec.baseSize * fade;
      break;
    }
    case "spread": {
      const t = (now * 0.4 * spec.speed * speedMul + spec.phaseOffset + spec.ringIdx / 3) % 1;
      const maxR = ringRadius + Math.max(tw, th) * 0.4;
      const radius = t * maxR;
      x = cx + Math.cos(spec.baseAngle) * radius;
      y = cy + Math.sin(spec.baseAngle) * radius;
      const fade = t < 0.15 ? t / 0.15 : 1 - smoothstep01(0.7, 1.0, t);
      scale = baseSize * spec.baseSize * fade;
      break;
    }
    default: scale = 0;
  }

  return { x, y, scale: Math.max(0, scale) };
}

// === Public API =====================================================

interface EnsureGeom {
  cx: number; cy: number;
  tokenW: number; tokenH: number;
  ringRadius: number;
}

export async function syncForToken(
  tokenId: string,
  buffsWithEffect: BuffDef[],
  geom: EnsureGeom,
): Promise<void> {
  // Mobile: skip particle creation. Static bubbles still render.
  if (isMobile()) {
    await clearForToken(tokenId);
    return;
  }

  const wantedKeys = new Set(buffsWithEffect.map((b) => setKey(tokenId, b.id)));
  const toDelete: string[] = [];
  for (const [k] of sets) {
    if (!k.startsWith(`${tokenId}|`)) continue;
    if (!wantedKeys.has(k)) toDelete.push(k);
  }
  for (const k of toDelete) {
    const set = sets.get(k);
    if (!set) continue;
    sets.delete(k);
    try { await OBR.scene.local.deleteItems(set.itemIds); } catch {}
  }

  for (const buff of buffsWithEffect) {
    await ensureSet(tokenId, buff, geom);
  }

  if (sets.size > 0) startTickIfNeeded();
  else stopTick();
}

async function ensureSet(tokenId: string, buff: BuffDef, geom: EnsureGeom): Promise<void> {
  const eff = buff.effect ?? "default";
  if (eff === "default") return;

  const k = setKey(tokenId, buff.id);
  const ep = buff.effectParams ?? {};
  const imageUrl = (ep.imageUrl ?? "").trim() || defaultImageUrl();
  const count = clampInt(ep.count, 1, 12, defaultParticleCount(eff));
  const speedMul = clampFloat(ep.speed, 0.2, 4.0, 1.0);
  const baseSize = Math.max(0.05, Math.min(geom.tokenW, geom.tokenH) * 0.18);

  // Resolve image dimensions (cached after first probe per URL).
  const dims = await getImageDims(imageUrl, ep.imageWidth, ep.imageHeight);

  const existing = sets.get(k);
  if (existing &&
      existing.effectMode === eff &&
      existing.imageUrl === imageUrl &&
      existing.specs.length === count) {
    // Hot path: refresh geom + speed mul, keep items.
    existing.cx = geom.cx;
    existing.cy = geom.cy;
    existing.tokenW = geom.tokenW;
    existing.tokenH = geom.tokenH;
    existing.ringRadius = geom.ringRadius;
    existing.baseSize = baseSize;
    existing.speedMul = speedMul;
    existing.imageW = dims.w;
    existing.imageH = dims.h;
    return;
  }

  if (existing) {
    sets.delete(k);
    try { await OBR.scene.local.deleteItems(existing.itemIds); } catch {}
  }

  const specs = makeSpecs(tokenId, buff.id, count);
  const layer = isBelowToken(eff) ? "DRAWING" : "ATTACHMENT";
  const mime = mimeFromUrl(imageUrl);
  const items: Item[] = [];
  const ids: string[] = [];

  // Image grid.dpi = image.width makes the rendered scene-coord
  // size of the image equal to one full grid cell. We then control
  // visual size via the item's `scale` factor (animated each tick).
  const gridDpi = Math.max(8, dims.w);

  for (let i = 0; i < count; i++) {
    const id = uuidV4();
    ids.push(id);
    items.push(
      buildImage(
        { url: imageUrl, width: dims.w, height: dims.h, mime },
        { dpi: gridDpi, offset: { x: 0, y: 0 } },
      )
        .id(id)
        .position({ x: geom.cx, y: geom.cy })
        .scale({ x: 0, y: 0 })           // spawn invisible; tick fades in
        .layer(layer)
        .locked(true)
        .disableHit(true)
        .visible(true)
        .disableAttachmentBehavior(["SCALE", "ROTATION"])
        .metadata({
          [OWNER_KEY]: tokenId,
          [ROLE_KEY]: "particle",
          [BUFF_ID_KEY]: buff.id,
        })
        .build(),
    );
  }

  try {
    await OBR.scene.local.addItems(items);
  } catch (e) {
    console.warn("[obr-suite/status] particle addItems failed", e);
    return;
  }

  sets.set(k, {
    tokenId,
    buffId: buff.id,
    effectMode: eff,
    imageUrl,
    imageW: dims.w,
    imageH: dims.h,
    itemIds: ids,
    specs,
    cx: geom.cx,
    cy: geom.cy,
    tokenW: geom.tokenW,
    tokenH: geom.tokenH,
    ringRadius: geom.ringRadius,
    baseSize,
    speedMul,
    flickerCache: new Map(),
  });
}

function clampInt(v: unknown, min: number, max: number, def: number): number {
  if (typeof v !== "number" || !isFinite(v)) return def;
  return Math.max(min, Math.min(max, Math.floor(v)));
}
function clampFloat(v: unknown, min: number, max: number, def: number): number {
  if (typeof v !== "number" || !isFinite(v)) return def;
  return Math.max(min, Math.min(max, v));
}

export async function clearAll(): Promise<void> {
  const allIds: string[] = [];
  for (const set of sets.values()) allIds.push(...set.itemIds);
  sets.clear();
  stopTick();
  if (allIds.length > 0) {
    try { await OBR.scene.local.deleteItems(allIds); } catch {}
  }
}

export async function clearForToken(tokenId: string): Promise<void> {
  const ids: string[] = [];
  const keys: string[] = [];
  for (const [k, set] of sets) {
    if (k.startsWith(`${tokenId}|`)) {
      keys.push(k);
      ids.push(...set.itemIds);
    }
  }
  for (const k of keys) sets.delete(k);
  if (sets.size === 0) stopTick();
  if (ids.length > 0) {
    try { await OBR.scene.local.deleteItems(ids); } catch {}
  }
}

// === Tick loop ======================================================

function startTickIfNeeded(): void {
  if (intervalId !== null || sets.size === 0) return;
  intervalId = setInterval(() => { void tick(); }, TICK_INTERVAL_MS);
}

function stopTick(): void {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

async function tick(): Promise<void> {
  if (ticking) return;
  if (sets.size === 0) {
    stopTick();
    return;
  }
  ticking = true;
  try {
    const sceneTime = (performance.now() - t0) / 1000;
    const ids: string[] = [];
    const updateFor = new Map<string, ParticleUpdate>();
    for (const set of sets.values()) {
      for (let i = 0; i < set.specs.length; i++) {
        const id = set.itemIds[i];
        ids.push(id);
        updateFor.set(id, computeUpdate(set, set.specs[i], sceneTime));
      }
    }
    if (ids.length === 0) return;
    try {
      await OBR.scene.local.updateItems(ids, (drafts) => {
        for (const draft of drafts) {
          const u = updateFor.get(draft.id);
          if (!u) continue;
          // Image item position is the top-left of the rendered
          // image bbox. To centre at (u.x, u.y) we offset by half
          // the rendered size. Rendered size in scene units =
          // (image.width / grid.dpi) * scene.dpi * scale. We set
          // grid.dpi = image.width earlier so (img.w / gridDpi) =
          // 1, leaving rendered_size = scene.dpi * scale. We don't
          // know scene.dpi here without another async call, so we
          // approximate by anchoring at u.x/u.y directly and
          // letting the visual centre drift slightly (acceptable
          // for ambient particles).
          (draft as any).position = { x: u.x, y: u.y };
          (draft as any).scale = { x: u.scale, y: u.scale };
        }
      });
    } catch {
      // Swallow tick errors — likely transient race during teardown.
    }
  } finally {
    ticking = false;
  }
}
