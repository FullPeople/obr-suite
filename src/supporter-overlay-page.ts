/* Supporter overlay — fullscreen ambient backdrop with floating names.
 *
 * Lifecycle (owned by cluster-row.ts):
 *   - Opened as fullscreen modal alongside settings popover.
 *   - Stays at opacity 0 until settings broadcasts visibility=true
 *     (user is on the Support / Feedback tab).
 *   - On visibility=false, fades names out + scene opacity to 0.
 *   - When settings popover closes, cluster-row.ts closes this modal
 *     entirely.
 *
 * Visual:
 *   - Black radial gradient backdrop (only when visible)
 *   - All supporters' names floating at random positions OUTSIDE the
 *     centred 640×580 settings popover bbox.
 *   - Each name has tier-coloured glow + fade-in / hold / fade-out
 *     cycle. New names spawn continuously to refresh the wall.
 *   - Pointer events are disabled (passed-through to canvas) by OBR's
 *     modal config `disablePointerEvents: true`.
 */

import OBR from "@owlbear-rodeo/sdk";
import { assetUrl } from "./asset-base";

interface Supporter { name: string; amount: number; }

const BC_VISIBILITY = "com.obr-suite/supporter-overlay/visibility";

// === Tier / size helpers (mirror of settings.ts) ===================

function supporterTier(amount: number): "t1" | "t2" | "t3" | "t4" | "t5" {
  if (amount >= 100) return "t5";
  if (amount >= 50)  return "t4";
  if (amount >= 30)  return "t3";
  if (amount >= 20)  return "t2";
  return "t1";
}

function supporterFontSize(amount: number): number {
  // Same sqrt curve as settings.ts. Slightly LARGER ceiling on the
  // overlay because we're on a fullscreen backdrop instead of a
  // 640px popup — bigger names read better at that scale.
  const raw = 10 + 2.5 * Math.sqrt(Math.max(0, amount));
  return Math.max(13, Math.min(46, Math.round(raw * 10) / 10));
}

// 2026-05-14 — per-name colour palette. The user wanted the
// supporter wall to be colourful rather than an all-amber gradient.
// `tier` still drives font weight / size / glow (so donation amount
// still reads at a glance), but the HUE is now picked per name from
// this diverse palette — deterministically, so a given supporter
// always shows the same colour. All ten are tuned for legibility on
// the overlay's near-black backdrop.
const SUPPORTER_PALETTE = [
  "#f5d76e", // gold
  "#ff8c6b", // coral
  "#5fd6c4", // teal
  "#6cb6ff", // sky
  "#c89bff", // lavender
  "#a8e063", // lime
  "#ff8fb3", // rose
  "#ffb347", // amber
  "#7fe0a8", // mint
  "#8c9eff", // periwinkle
];
function supporterColor(name: string): string {
  // Tiny stable string hash → palette index.
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) | 0;
  }
  return SUPPORTER_PALETTE[Math.abs(h) % SUPPORTER_PALETTE.length];
}

// 2026-05-18 — supporter avatar lookup (mirror of settings.ts). Names
// in /shared/pics/ are deployed to public/supporter-avatars/. If a
// supporter has a matching pic, placeSlot prepends a small round
// `<img>` before the name. The map MUST stay in sync with the one in
// src/settings.ts — both render the same supporter list.
const SUPPORTER_AVATARS: Record<string, string> = {
  "Dino":                       "supporter-avatars/Dino.jpg",
  "St.Monk":                    "supporter-avatars/St_Monk.png",
  "lingkkkkuang":               "supporter-avatars/lingkkkkuang.png",
  "不周":                        "supporter-avatars/不周.png",
  "凸守早苗":                    "supporter-avatars/凸守早苗.png",
  "咖啡":                        "supporter-avatars/咖啡.png",
  "姜川安.":                     "supporter-avatars/姜川安.jpg",
  "折云":                        "supporter-avatars/折云.jpg",
  "桌角剧团的囧神":              "supporter-avatars/桌角剧团的囧神.png",
  "武御":                        "supporter-avatars/武御.png",
  "蚀星ErosionStar":             "supporter-avatars/蚀星Erosionstar.png",
  "跑冰风谷水群被抓的某位":      "supporter-avatars/跑冰风谷水群被抓的某位.png",
  "鱼喵":                        "supporter-avatars/鱼喵.png",
};

function findSupporterAvatar(name: string): string | null {
  const exact = SUPPORTER_AVATARS[name];
  if (exact) return exact;
  const norm = name.toLowerCase().replace(/[.\s]+$/, "");
  for (const [k, v] of Object.entries(SUPPORTER_AVATARS)) {
    if (k.toLowerCase().replace(/[.\s]+$/, "") === norm) return v;
  }
  return null;
}

// === Load supporter list ===========================================

let supporters: Supporter[] = [];

async function loadSupporters(lang: string): Promise<void> {
  const file = lang === "en" ? "supporters.en.json" : "supporters.zh.json";
  try {
    const r = await fetch(assetUrl(file), { cache: "no-cache" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const arr = await r.json();
    if (Array.isArray(arr)) {
      supporters = arr
        .map((v: any) => {
          if (!v || typeof v.name !== "string") return null;
          const a = Number(v.amount);
          return { name: v.name.trim(), amount: Number.isFinite(a) ? a : 10 };
        })
        .filter((v: any): v is Supporter => !!v && v.name.length > 0);
    }
  } catch (e) {
    console.warn("[supporter-overlay] supporter load failed", e);
    supporters = [];
  }
}

// === Popup "hole" computation =====================================
//
// Settings popover is anchored at viewport centre, 640×580. We
// reserve a slightly-larger rectangle around it so names don't
// crowd the visible edges of the panel.

function getHoleRect(): { x: number; y: number; w: number; h: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const popupW = 640;
  const popupH = 580;
  const margin = 24;  // safety padding so names don't peek under the panel border
  const w = popupW + margin * 2;
  const h = popupH + margin * 2;
  return {
    x: (vw - w) / 2,
    y: (vh - h) / 2,
    w, h,
  };
}

// === Name placement ================================================
//
// Pick a random point in the viewport that's OUTSIDE the popup
// rectangle AND keeps the entire name on-screen (using an estimate
// of the name's rendered width).

function pickPosition(
  estimatedW: number,
  estimatedH: number,
  existingRects: Array<{ x: number; y: number; w: number; h: number }> = [],
): { x: number; y: number } | null {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const hole = getHoleRect();
  const maxX = Math.max(0, vw - estimatedW);
  const maxY = Math.max(0, vh - estimatedH);

  for (let attempt = 0; attempt < 40; attempt++) {
    const x = Math.random() * maxX;
    const y = Math.random() * maxY;
    const candidate = { x, y, w: estimatedW, h: estimatedH };
    if (
      candidate.x + candidate.w < hole.x ||
      candidate.x > hole.x + hole.w ||
      candidate.y + candidate.h < hole.y ||
      candidate.y > hole.y + hole.h
    ) {
      if (!existingRects.some((rect) => rectsIntersect(candidate, rect))) {
        return { x, y };
      }
    }
  }

  const padding = 12;
  const fallbacks = [
    { x: padding, y: padding },
    { x: maxX - padding, y: padding },
    { x: padding, y: maxY - padding },
    { x: maxX - padding, y: maxY - padding },
    { x: padding, y: hole.y - estimatedH - padding },
    { x: hole.x - estimatedW - padding, y: padding },
  ];

  for (const pos of fallbacks) {
    const candidate = { x: Math.max(0, Math.min(maxX, pos.x)), y: Math.max(0, Math.min(maxY, pos.y)), w: estimatedW, h: estimatedH };
    if (
      candidate.x + candidate.w < hole.x ||
      candidate.x > hole.x + hole.w ||
      candidate.y + candidate.h < hole.y ||
      candidate.y > hole.y + hole.h
    ) {
      if (!existingRects.some((rect) => rectsIntersect(candidate, rect))) {
        return { x: candidate.x, y: candidate.y };
      }
    }
  }

  return { x: Math.min(maxX, padding), y: Math.min(maxY, padding) };
}

// Rough estimate of a name's bounding box — used by pickPosition
// before the element is in the DOM. Good enough for placement
// (overshoots slightly which makes names err on the spread side).
function estimateBox(s: Supporter): { w: number; h: number } {
  const fs = supporterFontSize(s.amount);
  // ~0.65 of fontSize per glyph for CJK + a bit, plus padding.
  const charW = fs * 0.85;
  const w = Math.max(60, s.name.length * charW + 16);
  const h = fs * 1.4 + 4;
  return { w, h };
}

// === Animated name pool ============================================
//
// A pool of N "slots" — each slot independently picks a random
// supporter, fades in, holds, fades out, then re-rolls. Continuous
// rotation keeps the wall feeling alive without doing one mass
// flash.

const sceneEl = document.getElementById("scene") as HTMLDivElement;

interface Slot {
  el: HTMLDivElement;
  state: "void" | "in" | "hold" | "out";
  stateUntil: number;       // ms timestamp
  current: Supporter | null;
  rect: { x: number; y: number; w: number; h: number } | null;
}

const slots: Slot[] = [];

function makeSlot(): Slot {
  const el = document.createElement("div");
  el.className = "name";
  sceneEl.appendChild(el);
  return { el, state: "void", stateUntil: 0, current: null, rect: null };
}

function rectsIntersect(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function activeRects(excludeSlot?: Slot): Array<{ x: number; y: number; w: number; h: number }> {
  return slots
    .filter((slot) => slot !== excludeSlot && slot.rect && slot.state !== "void")
    .map((slot) => slot.rect!);
}

function pickSupporter(): Supporter | null {
  if (supporters.length === 0) return null;
  const activeNames = new Set(
    slots
      .filter((slot) => slot.current && slot.state !== "void")
      .map((slot) => slot.current!.name),
  );
  const pool = supporters.filter((s) => !activeNames.has(s.name));
  if (pool.length === 0) return null;

  let total = 0;
  for (const s of pool) total += 1 + Math.sqrt(s.amount);
  let pick = Math.random() * total;
  for (const s of pool) {
    const w = 1 + Math.sqrt(s.amount);
    if (pick < w) return s;
    pick -= w;
  }
  return pool[pool.length - 1];
}

function placeSlot(slot: Slot, s: Supporter): void {
  const tier = supporterTier(s.amount);
  const fs = supporterFontSize(s.amount);
  slot.el.className = `name ${tier}`;
  slot.el.style.fontSize = `${fs}px`;
  // 2026-05-14 — per-name colour (overrides the tier class's colour).
  // tier still controls weight / size / glow via the class.
  slot.el.style.color = supporterColor(s.name);
  slot.el.style.opacity = "0";
  // 2026-05-18 — when a supporter has a matching pic in
  // /shared/pics/, prepend a small round image scaled to the name's
  // computed font-size. Using innerHTML (vs textContent) so the
  // child <img> survives; the name itself is escaped manually to
  // dodge accidental HTML in supporter names. has-avatar enables
  // the inline-flex baseline + gap rule in supporter-overlay.html.
  const avatarUrl = findSupporterAvatar(s.name);
  if (avatarUrl) {
    slot.el.classList.add("has-avatar");
    const safeName = s.name
      .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    const src = assetUrl(avatarUrl);
    const safeSrc = src.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
    slot.el.innerHTML =
      `<img class="name-avatar" src="${safeSrc}" alt="" loading="lazy" decoding="async" ` +
        `style="width:${fs}px;height:${fs}px">` +
      `<span class="name-text">${safeName}</span>`;
  } else {
    slot.el.classList.remove("has-avatar");
    slot.el.textContent = s.name;
  }
  slot.el.style.left = "0px";
  slot.el.style.top = "0px";

  const measured = slot.el.getBoundingClientRect();
  const box = {
    w: Math.max(60, Math.ceil(measured.width) + 8),
    h: Math.max(Math.ceil(measured.height), 24),
  };
  const pos = pickPosition(box.w, box.h, activeRects(slot)) ?? { x: 20, y: 20 };

  slot.el.style.left = `${pos.x}px`;
  slot.el.style.top = `${pos.y}px`;
  slot.current = s;
  slot.rect = { x: pos.x, y: pos.y, w: box.w, h: box.h };
}

function tickSlot(slot: Slot, now: number): void {
  if (slot.state === "void") {
    // Pick a new supporter, place it, start fade-in.
    const s = pickSupporter();
    if (!s) return;
    placeSlot(slot, s);
    // Force a reflow so the opacity transition kicks in from 0 → 1.
    void slot.el.offsetWidth;
    slot.el.style.opacity = "1";
    // Tier 5 → longer hold (special supporters get more screen time).
    const tier = supporterTier(s.amount);
    const holdMs = tier === "t5" ? 6500
                 : tier === "t4" ? 5500
                 : tier === "t3" ? 4500
                 : 3500;
    slot.state = "in";
    slot.stateUntil = now + 1200 + holdMs;  // 1.2 s fade-in + hold
    // After hold, schedule fade-out.
    setTimeout(() => {
      slot.el.style.opacity = "0";
      slot.state = "out";
      slot.stateUntil = now + 1200 + holdMs + 1500;  // 1.5 s fade-out window
    }, 1200 + holdMs);
    return;
  }
  if (slot.state === "out" && now >= slot.stateUntil) {
    slot.state = "void";
    slot.stateUntil = now + Math.random() * 800;  // brief pause before respawn
    slot.rect = null;
    slot.current = null;
  }
}

// === Animation loop ================================================

let _rafHandle = 0;
function loop() {
  const now = performance.now();
  for (const s of slots) tickSlot(s, now);
  _rafHandle = requestAnimationFrame(loop);
}

function startLoop() {
  if (_rafHandle) return;
  loop();
}
function stopLoop() {
  if (_rafHandle) {
    cancelAnimationFrame(_rafHandle);
    _rafHandle = 0;
  }
}

// === Visibility coordination ======================================

// 2026-05-12c — setVisible is now IDEMPOTENT. The previous version
// wiped all 100 slots every call, which combined with the 500 ms
// heartbeat made the names restart their fade-in cycle twice per
// second — visible as rapid flicker. Now if visibility hasn't
// changed, we just update the heartbeat timestamp via noteHeartbeat
// elsewhere and return immediately.
let _currentVisible = false;
function setVisible(visible: boolean): void {
  if (visible === _currentVisible) return;
  _currentVisible = visible;
  if (visible) {
    sceneEl.classList.add("visible");
    // Stagger initial slot spawns over the first ~3.5 seconds so all
    // names don't pop in on the same frame. Putting each slot in
    // "out" state with a random stateUntil makes the rAF loop trigger
    // spawn (void state) at a randomised time.
    const now = performance.now();
    for (const s of slots) {
      s.state = "out";
      s.stateUntil = now + Math.random() * 3500;
      s.el.style.opacity = "0";
    }
    startLoop();
  } else {
    sceneEl.classList.remove("visible");
    setTimeout(() => {
      if (!sceneEl.classList.contains("visible")) {
        stopLoop();
        for (const s of slots) {
          s.el.style.opacity = "0";
          s.state = "void";
          s.stateUntil = 0;
          s.current = null;
          s.rect = null;
        }
      }
    }, 700);
  }
}

// === Resize handler ===============================================
// Re-anchor the popup-hole rectangle on viewport resize. Existing
// names stay where they are; new spawns use the updated hole.
// (Cheap to leave existing names possibly overlapping the new hole
// for a few seconds — they'll cycle out and respawn in valid spots.)
window.addEventListener("resize", () => { /* getHoleRect reads live */ });

// === Heartbeat watchdog ===========================================
//
// pagehide / beforeunload in OBR popover iframes are unreliable —
// OBR can tear down the iframe before any broadcast actually
// flushes through the message channel. So we can't rely on a "I'm
// closing" broadcast from settings.ts to trigger our cleanup.
//
// Instead settings.ts sends a "still alive" heartbeat every 500 ms.
// We track the timestamp of the most recent one; if more than 2 s
// elapse without a heartbeat AND we've ever received one (so we
// don't fire on page load before settings has booted), this iframe
// calls OBR.modal.close on itself.
//
// (cluster-row.ts has a parallel close-on-broadcast path that still
// triggers when broadcasts DO flush properly. The watchdog is the
// belt-and-suspenders for when they don't.)

const MODAL_ID = "com.obr-suite/supporter-overlay";
const HEARTBEAT_TIMEOUT_MS = 2000;
let _lastHeartbeatAt = 0;
let _watchdogClosed = false;

function noteHeartbeat(): void {
  _lastHeartbeatAt = performance.now();
}

function startHeartbeatWatchdog(): void {
  setInterval(() => {
    if (_watchdogClosed) return;
    if (_lastHeartbeatAt === 0) return;   // never received one — settings not loaded yet
    if (performance.now() - _lastHeartbeatAt > HEARTBEAT_TIMEOUT_MS) {
      _watchdogClosed = true;
      // Hide names BEFORE closing the modal so there's no flash.
      setVisible(false);
      // Small delay so the scene fade-out plays before iframe tears down.
      setTimeout(() => {
        OBR.modal.close(MODAL_ID).catch(() => {});
      }, 650);
    }
  }, 500);
}

// === Boot =========================================================

const SLOT_COUNT = 100;   // 100 names visible+cycling simultaneously

OBR.onReady(async () => {
  // Default to ZH; broadcast carries the actual choice from settings.
  await loadSupporters("zh");

  // Build the slot pool now that we know we have supporters.
  for (let i = 0; i < SLOT_COUNT; i++) slots.push(makeSlot());

  OBR.broadcast.onMessage(BC_VISIBILITY, async (event) => {
    const data = event.data as { visible?: boolean; lang?: string } | undefined;
    if (!data) return;
    noteHeartbeat();
    // Reload supporters list only if lang actually changed. Compare
    // BEFORE updating `_lastLoadedLang` so the equality check works.
    if ((data.lang === "zh" || data.lang === "en") && data.lang !== _lastLoadedLang) {
      _lastLoadedLang = data.lang;
      await loadSupporters(data.lang);
    }
    setVisible(!!data.visible);
  });

  startHeartbeatWatchdog();
});

let _lastLoadedLang: "zh" | "en" = "zh";
