// Status Tracker — capture overlay (transient, opens during drag).
//
// URL params (set by the background when it spawns this iframe):
//   kind = "buff" | "clear"
//   mode = "drop" | "paint-toggle"
//   buff = encoded JSON of BuffDef (when kind=buff)
//
// Behaviour by mode:
//   click-place   — the buff is "carried" on the cursor (no button
//                   held). The NEXT pointerdown places it: on a
//                   token's ring = apply, on empty space = discard.
//                   Used for LEFT-click on palette buffs / eraser /
//                   manage pill. (The pickup click itself completes
//                   back on the palette; the pickup's release is a
//                   no-op here.)
//   drop          — track cursor while a button is held; on pointerup
//                   apply to whichever single token's ring the cursor
//                   is over. Still used by the manage-transfer drag
//                   out of the manage popover.
//   paint-toggle  — drag-paint as cursor crosses each token's ring.
//                   For each token entered, TOGGLE the buff (apply
//                   if missing, remove if present). Used for right-
//                   click drags AND for the eraser pill (which uses
//                   "clear" kind to wipe all buffs from a token).
//
// During drag the ring NAMES are hidden (per user spec); only the
// circular outlines remain so the drop targets stay legible without
// occluding the scene.

import OBR, { Image, isImage } from "@owlbear-rodeo/sdk";
import {
  PLUGIN_ID,
  STATUS_BUFFS_KEY,
  STATUS_BUFF_ROUNDS_KEY,
  BuffDef,
  textColorFor,
} from "./modules/statusTracker/types";
import { getTokenCircleSpec } from "./modules/statusTracker/circles";

const MODAL_ID = `${PLUGIN_ID}/capture`;
const BC_DRAG_END = `${PLUGIN_ID}/drag-end`;
const BC_OPEN_MANAGE = `${PLUGIN_ID}/open-manage`;

const params = new URLSearchParams(location.search);
type DragKind = "buff" | "clear" | "manage" | "manage-transfer" | "preset";
const kind = (params.get("kind") || "buff") as DragKind;
const mode = (params.get("mode") || "drop") as "drop" | "paint-toggle" | "click-place";
// Source token id — only set when kind === "manage-transfer". The
// buff was dragged out of the manage popover, which we use to look
// up the originating token so we can remove from it on drop.
const sourceTokenId = params.get("source") || null;
// Preset id — only set when kind === "preset". The capture page does
// NOT carry the preset's buff list (the palette page holds it); on
// drop we broadcast {presetId, tokenId} back to the palette page
// which then applies the buffs.
const presetId = params.get("preset") || null;
const presetName = params.get("presetName") ? decodeURIComponent(params.get("presetName")!) : "";
const presetCount = Number(params.get("presetCount") || 0);
const BC_PRESET_DROP = `${PLUGIN_ID}/preset-drop`;
const buff: BuffDef | null = (() => {
  if (kind === "clear" || kind === "manage" || kind === "preset") return null;
  const raw = params.get("buff");
  if (!raw) return null;
  try {
    const p = JSON.parse(decodeURIComponent(raw));
    if (p && typeof p.id === "string") return p as BuffDef;
  } catch {}
  return null;
})();

const ringsEl = document.getElementById("rings") as HTMLDivElement;
const cursorEl = document.getElementById("cursor") as HTMLDivElement;

// 2026-05-15 — emoji → SVG sweep. Inline SVGs match the palette page's
// SVG_CROSS / SVG_WRENCH glyphs so the cursor ghost reads as a unified
// affordance with the source pill the user just dragged.
const CURSOR_SVG_CROSS =
  `<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" fill="none"`
  + ` stroke="currentColor" stroke-width="1.8" stroke-linecap="round"`
  + ` style="vertical-align:-2px;margin-right:5px">`
  + `<path d="M4 4l8 8M12 4l-8 8"/></svg>`;
const CURSOR_SVG_WRENCH =
  `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none"`
  + ` stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"`
  + ` style="vertical-align:-2px;margin-right:5px">`
  + `<path d="M11 3.5a3 3 0 0 1-4.2 4.2L3 11.5l1.5 1.5 3.8-3.8a3 3 0 0 1 4.2-4.2l-2 2 .5 1.5 1.5.5z"/></svg>`;

// Strip pictographic emoji from displayed buff names — same logic as
// the palette page's stripEmoji. Buff data still carries the legacy
// "麻痹 ⚡" / etc.; only the rendered cursor label drops them.
function stripEmoji(s: string): string {
  return s.replace(/\p{Extended_Pictographic}/gu, "")
          .replace(/[\u{FE0E}\u{FE0F}\u{200D}]/gu, "")
          .replace(/[\u{1F3FB}-\u{1F3FF}]/gu, "")
          .replace(/\s+/g, " ")
          .trim();
}
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

// Cursor ghost setup — solid color matching the dragged buff.
if (kind === "clear") {
  cursorEl.classList.add("eraser");
  cursorEl.innerHTML = `${CURSOR_SVG_CROSS}清除全部 buff`;
} else if (kind === "manage") {
  // Reuse the warning-orange "manage" cue from the palette pill so
  // the user sees a consistent visual for "you're about to manage
  // this token". CSS class added below in style overrides.
  cursorEl.classList.add("manage");
  cursorEl.innerHTML = `${CURSOR_SVG_WRENCH}管理 buff`;
} else if (kind === "preset") {
  // Preset chip cursor — green-accent pill matching the palette's
  // .preset-chip family. The right-side count badge mirrors the chip
  // so the user keeps seeing "战斗起始 (3)" while dragging.
  cursorEl.classList.add("preset");
  cursorEl.innerHTML =
    `${escapeHtml(presetName || "预设")}` +
    (presetCount > 0 ? `<span style="margin-left:5px;font-size:9.5px;opacity:0.75">×${presetCount}</span>` : "");
} else if (buff) {
  // Set the buff colour as a CSS variable so the stylesheet's
  // `color-mix(... var(--bubble-bg) 80%, transparent)` flat-tint
  // rule kicks in. Setting `background` directly would override the
  // colour-mix lookup with an opaque fill, which the user reported
  // as the "old / 90s" look in 2026-05-10 feedback.
  cursorEl.style.setProperty("--bubble-bg", buff.color);
  cursorEl.style.color = textColorFor(buff.color);
  // 2026-05-18 — prepend a small inline preview of the buff visual
  // (webm or static icon) so the drag ghost matches what'll actually
  // land on the token. Falls through to text-only when the buff has
  // neither — preserves backward compat for legacy text buffs.
  const buffAny = buff as any;
  const webmUrl = typeof buffAny.webmAsset === "string" && buffAny.webmAsset
    ? `${location.origin}${import.meta.env.BASE_URL}${buffAny.webmAsset}` : "";
  const visualHtml = webmUrl
    ? `<video src="${escapeHtml(webmUrl)}" autoplay loop muted playsinline preload="auto"
              style="width:22px;height:22px;object-fit:contain;vertical-align:middle;margin-right:5px;border-radius:3px;pointer-events:none"
              aria-hidden="true"></video>`
    : buffAny.iconAsset
    ? `<img src="${escapeHtml(buffAny.iconAsset)}" alt=""
            style="width:22px;height:22px;object-fit:contain;vertical-align:middle;margin-right:5px;border-radius:3px">`
    : "";
  cursorEl.innerHTML = `${visualHtml}${escapeHtml(stripEmoji(buff.name))}`;
}
cursorEl.style.left = "-1000px";
cursorEl.style.top = "-1000px";

interface RingState {
  tokenId: string;
  // Cached buff snapshot at last refresh — used by paint-toggle so
  // we can decide apply-vs-remove without re-reading the token's
  // metadata mid-stroke (which would race with our own writes).
  buffIds: string[];
  // Screen coords + screen radius (synced on viewport.onChange).
  screenX: number;
  screenY: number;
  screenRadius: number;
  el: HTMLDivElement;
  /** "Cursor was inside this ring during the previous pointermove."
   *  paint-toggle uses this for EDGE detection: a toggle fires only
   *  on the outside→inside transition, NOT on every pointermove
   *  while the cursor is still inside. Re-entry after leaving the
   *  ring fires another toggle, so a stroke that crosses the same
   *  token twice flip-flops the buff (apply, leave, re-enter →
   *  remove). */
  wasInside: boolean;
}

const rings = new Map<string, RingState>();

async function refreshRings(): Promise<void> {
  let items;
  try { items = await OBR.scene.items.getItems(); }
  catch { return; }

  const tokens: Image[] = items.filter((it): it is Image =>
    isImage(it) &&
    (it.layer === "CHARACTER" || it.layer === "MOUNT" || it.layer === "PROP"),
  );

  let vpScale = 1;
  try { vpScale = await OBR.viewport.getScale(); } catch {}
  let sceneDpi = 150;
  try { sceneDpi = await OBR.scene.grid.getDpi(); } catch {}

  const wantedIds = new Set<string>();
  for (const tok of tokens) {
    wantedIds.add(tok.id);
    const spec = getTokenCircleSpec(tok, sceneDpi);
    let screen;
    try {
      screen = await OBR.viewport.transformPoint({ x: spec.cx, y: spec.cy });
    } catch { continue; }
    const screenRadius = spec.radius * vpScale;

    // Read current buff list so toggle-mode knows current state.
    const cur = (tok.metadata as any)[STATUS_BUFFS_KEY];
    const buffIds: string[] = Array.isArray(cur) ? cur.filter((x: any) => typeof x === "string") : [];

    let r = rings.get(tok.id);
    if (!r) {
      const el = document.createElement("div");
      el.className = "ring";
      ringsEl.appendChild(el);
      r = {
        tokenId: tok.id,
        buffIds,
        screenX: screen.x,
        screenY: screen.y,
        screenRadius,
        el,
        wasInside: false,
      };
      rings.set(tok.id, r);
    } else {
      r.screenX = screen.x;
      r.screenY = screen.y;
      r.screenRadius = screenRadius;
      r.buffIds = buffIds;
    }
    r.el.style.left = `${r.screenX}px`;
    r.el.style.top = `${r.screenY}px`;
    r.el.style.width = `${r.screenRadius * 2}px`;
    r.el.style.height = `${r.screenRadius * 2}px`;
  }

  // Drop rings for tokens that disappeared mid-drag.
  for (const [id, r] of rings) {
    if (!wantedIds.has(id)) {
      r.el.remove();
      rings.delete(id);
    }
  }
}

// --- Apply / remove / clear helpers ---

async function applyBuff(tokenId: string): Promise<void> {
  if (!buff) return;
  try {
    await OBR.scene.items.updateItems([tokenId], (drafts) => {
      for (const d of drafts) {
        const cur = (d.metadata as any)[STATUS_BUFFS_KEY];
        const list: string[] = Array.isArray(cur) ? cur.filter((x: any) => typeof x === "string") : [];
        if (!list.includes(buff.id)) list.push(buff.id);
        (d.metadata as any)[STATUS_BUFFS_KEY] = list;
        const rounds = Math.floor(Number(buff.rounds ?? 0));
        if (Number.isFinite(rounds) && rounds > 0) {
          const curRounds = (d.metadata as any)[STATUS_BUFF_ROUNDS_KEY];
          const map = curRounds && typeof curRounds === "object" && !Array.isArray(curRounds)
            ? { ...(curRounds as Record<string, number>) }
            : {};
          map[buff.id] = rounds;
          (d.metadata as any)[STATUS_BUFF_ROUNDS_KEY] = map;
        }
      }
    });
  } catch (e) {
    console.warn("[status/capture] applyBuff failed", tokenId, e);
  }
}

async function removeBuff(tokenId: string): Promise<void> {
  if (!buff) return;
  try {
    await OBR.scene.items.updateItems([tokenId], (drafts) => {
      for (const d of drafts) {
        const cur = (d.metadata as any)[STATUS_BUFFS_KEY];
        const list: string[] = Array.isArray(cur) ? cur.filter((x: any) => typeof x === "string") : [];
        const idx = list.indexOf(buff.id);
        if (idx >= 0) list.splice(idx, 1);
        (d.metadata as any)[STATUS_BUFFS_KEY] = list;
        const curRounds = (d.metadata as any)[STATUS_BUFF_ROUNDS_KEY];
        if (curRounds && typeof curRounds === "object" && !Array.isArray(curRounds)) {
          const map = { ...(curRounds as Record<string, number>) };
          delete map[buff.id];
          (d.metadata as any)[STATUS_BUFF_ROUNDS_KEY] = map;
        }
      }
    });
  } catch (e) {
    console.warn("[status/capture] removeBuff failed", tokenId, e);
  }
}

async function clearAll(tokenId: string): Promise<void> {
  try {
    await OBR.scene.items.updateItems([tokenId], (drafts) => {
      for (const d of drafts) {
        (d.metadata as any)[STATUS_BUFFS_KEY] = [];
        (d.metadata as any)[STATUS_BUFF_ROUNDS_KEY] = {};
      }
    });
  } catch (e) {
    console.warn("[status/capture] clearAll failed", tokenId, e);
  }
}

// Remove a specific buff id from a token's metadata (without
// mutating module-level `buff`). Used by manage-transfer to clear
// the source token in addition to the target add.
async function removeBuffById(tokenId: string, buffId: string): Promise<void> {
  try {
    await OBR.scene.items.updateItems([tokenId], (drafts) => {
      for (const d of drafts) {
        const cur = (d.metadata as any)[STATUS_BUFFS_KEY];
        const list: string[] = Array.isArray(cur) ? cur.filter((x: any) => typeof x === "string") : [];
        const idx = list.indexOf(buffId);
        if (idx >= 0) list.splice(idx, 1);
        (d.metadata as any)[STATUS_BUFFS_KEY] = list;
        const curRounds = (d.metadata as any)[STATUS_BUFF_ROUNDS_KEY];
        if (curRounds && typeof curRounds === "object" && !Array.isArray(curRounds)) {
          const map = { ...(curRounds as Record<string, number>) };
          delete map[buffId];
          (d.metadata as any)[STATUS_BUFF_ROUNDS_KEY] = map;
        }
      }
    });
  } catch (e) {
    console.warn("[status/capture] removeBuffById failed", tokenId, buffId, e);
  }
}

// Toggle dispatch by kind/mode. Caller must ensure dedupe via
// touchedThisDrag so a single pass through a ring fires once.
async function actOnToken(r: RingState): Promise<void> {
  if (kind === "clear") {
    await clearAll(r.tokenId);
    return;
  }
  if (kind === "manage") {
    // Don't write any metadata. Just signal the background to open
    // the manage popover anchored on this token. The pointerup
    // handler closes the capture overlay; the popover takes over.
    try {
      await OBR.broadcast.sendMessage(
        BC_OPEN_MANAGE,
        { tokenId: r.tokenId },
        { destination: "LOCAL" },
      );
    } catch {}
    return;
  }
  if (kind === "manage-transfer") {
    if (!buff || !sourceTokenId) return;
    // Drop on the source itself = revert (no metadata change).
    if (r.tokenId === sourceTokenId) return;
    // Else transfer: remove from source, add to target.
    await removeBuffById(sourceTokenId, buff.id);
    await applyBuff(r.tokenId);
    return;
  }
  if (kind === "preset") {
    if (!presetId) return;
    // The capture page doesn't carry the preset's buff list — it just
    // signals "drop happened on this token". The palette page (which
    // owns presets) listens for BC_PRESET_DROP and applies the buffs.
    try {
      await OBR.broadcast.sendMessage(
        BC_PRESET_DROP,
        { presetId, tokenId: r.tokenId },
        { destination: "LOCAL" },
      );
    } catch {}
    return;
  }
  if (!buff) return;
  // kind === "buff": original apply/toggle behaviour.
  if (r.buffIds.includes(buff.id)) {
    await removeBuff(r.tokenId);
    r.buffIds = r.buffIds.filter((x) => x !== buff.id);
  } else {
    await applyBuff(r.tokenId);
    r.buffIds = [...r.buffIds, buff.id];
  }
}

function pointerToRing(x: number, y: number): RingState | null {
  for (const r of rings.values()) {
    const dx = x - r.screenX;
    const dy = y - r.screenY;
    if (dx * dx + dy * dy <= r.screenRadius * r.screenRadius) return r;
  }
  return null;
}

function paintRingHover(activeId: string | null): void {
  for (const r of rings.values()) {
    r.el.classList.remove("hover-add", "hover-clear", "hover-remove");
    if (r.tokenId !== activeId) continue;
    if (kind === "clear") {
      r.el.classList.add("hover-clear");
    } else if (mode === "paint-toggle") {
      // Hint the toggle direction visually: red ring if buff present
      // (would be removed), warm orange if absent (would be applied).
      if (buff && r.buffIds.includes(buff.id)) {
        r.el.classList.add("hover-remove");
      } else {
        r.el.classList.add("hover-add");
      }
    } else {
      // drop mode — single-target preview, always orange.
      r.el.classList.add("hover-add");
    }
  }
}

// --- Pointer handling ---

window.addEventListener("pointermove", (e) => {
  cursorEl.style.left = `${e.clientX}px`;
  cursorEl.style.top = `${e.clientY}px`;
  // click-place carries the buff on the cursor with NO button held,
  // so a released button is the NORMAL state — never end on it.
  // drop / paint-toggle are press-drag gestures: a released button
  // means the user already let go, so end the drag.
  if (mode !== "click-place" && (e.buttons & 0b11) === 0) {
    void endDrag();
    return;
  }
  const hit = pointerToRing(e.clientX, e.clientY);
  if (mode === "paint-toggle") {
    // EDGE detection: per-ring `wasInside` flag tracks whether the
    // cursor was inside this ring on the previous tick. We trigger
    // exactly once on outside→inside transitions; leaving the ring
    // resets the flag so a re-entry will toggle again. This makes
    // a single stroke "apply on first cross, remove on next cross,
    // apply on third cross…" per the user's edge-toggle spec.
    for (const r of rings.values()) {
      const insideNow = (r === hit);
      if (insideNow && !r.wasInside) {
        void actOnToken(r);
      }
      r.wasInside = insideNow;
    }
  }
  paintRingHover(hit ? hit.tokenId : null);
});

window.addEventListener("pointerup", async (e) => {
  // click-place: pointerup is either the PICKUP release or a
  // PLACEMENT click's release — both are no-ops here. The carry must
  // survive a button release, and placement is handled on
  // pointerdown below.
  if (mode === "click-place") return;
  // Drop mode applies on release if cursor is over a ring.
  if (mode === "drop" && kind !== "clear") {
    const hit = pointerToRing(e.clientX, e.clientY);
    if (hit) {
      await actOnToken(hit);
    } else if (kind === "manage-transfer" && buff && sourceTokenId) {
      // No ring hit + manage-transfer = drag-out-of-popover-bounds
      // semantics: remove the buff from the source token.
      await removeBuffById(sourceTokenId, buff.id);
    }
    // kind === "manage" with no hit: just close, nothing to manage.
  }
  // Drop mode + eraser: also apply on release (single token wipe).
  if (mode === "drop" && kind === "clear") {
    const hit = pointerToRing(e.clientX, e.clientY);
    if (hit) await clearAll(hit.tokenId);
  }
  await endDrag();
});

// click-place placement: the buff was picked up by a left-click on
// the palette (that click completed back on the palette window), so
// the FIRST pointerdown the overlay sees is the PLACEMENT. A click
// on a token's ring applies / clears / manages it; a click on empty
// space just discards the carried buff. Either way the carry ends.
window.addEventListener("pointerdown", async (e) => {
  if (mode !== "click-place") return;
  const hit = pointerToRing(e.clientX, e.clientY);
  if (hit) await actOnToken(hit);
  await endDrag();
});

window.addEventListener("pointercancel", () => { void endDrag(); });
window.addEventListener("blur", () => { void endDrag(); });
window.addEventListener("contextmenu", (e) => e.preventDefault());

// === Stuck-cursor safety nets ===========================================
//
// Symptom: every once in a while a buff drag "sticks" on the cursor —
// the capture modal stays open, swallowing all clicks, and only a
// browser refresh recovers. Most common when the buff bubble was
// positioned right over a character (so the OBR scene's own pointer
// handlers compete with the modal for the pointerup).
//
// We can't be 100% sure WHY the pointerup is being lost (could be
// the modal iframe losing focus mid-gesture, the popover closing on
// drop firing pointer-capture release, OBR consuming the event in
// its scene layer, etc.). So instead of trying to find the one true
// race, we layer multiple recovery mechanisms:
//
//   1. Idle watchdog — if no pointer event lands for >5s, close.
//      Real drags are <1s; 5s of silence means "user already let go,
//      we just didn't hear it".
//   2. Absolute timer — 30s hard cap regardless.
//      No legitimate drag takes that long.
//   3. visibilitychange — if the modal page becomes hidden, close.
//      Tab switch / OBR popover close hides our iframe.
//   4. Window-level click listener (capture phase) — any click that
//      isn't part of a tracked pointer gesture closes us. This
//      catches the case where the user, frustrated by a stuck
//      cursor, clicks again to dismiss it.
//   5. Mouse-up fallback — listen for plain `mouseup` (in addition
//      to `pointerup`) since some browsers fire one but not the
//      other in cross-iframe scenarios.

let lastPointerActivity = Date.now();
function bumpPointerActivity(): void { lastPointerActivity = Date.now(); }
window.addEventListener("pointermove", bumpPointerActivity, true);
window.addEventListener("pointerdown", bumpPointerActivity, true);
window.addEventListener("pointerup", bumpPointerActivity, true);

const dragStartedAt = Date.now();
// click-place is a deliberate "carry until you click" gesture — the
// user may legitimately pause to decide where to place — so it gets
// far more generous watchdog limits than a press-drag (which is
// always a sub-second gesture).
const IDLE_LIMIT_MS = mode === "click-place" ? 20000 : 5000;
const CAP_LIMIT_MS = mode === "click-place" ? 120000 : 30000;
const watchdogId = setInterval(() => {
  const now = Date.now();
  // Idle watchdog: no pointer activity for a while → assume the
  // pointerup was lost in transit (press-drag) or the carry was
  // forgotten (click-place).
  if (now - lastPointerActivity > IDLE_LIMIT_MS) {
    console.warn(`[status/capture] watchdog: no pointer activity in ${IDLE_LIMIT_MS}ms, closing`);
    void endDrag();
    return;
  }
  // Absolute timer: no interaction legitimately takes this long.
  if (now - dragStartedAt > CAP_LIMIT_MS) {
    console.warn(`[status/capture] watchdog: ${CAP_LIMIT_MS}ms cap reached, closing`);
    void endDrag();
    return;
  }
}, 250);

window.addEventListener("mouseup", () => { void endDrag(); }, true);

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    void endDrag();
  }
});

// Click fallback: if the user clicks anywhere AFTER the initial drag
// gesture has completed (pointerup fired or buttons released), but the
// modal somehow stayed up, the next click closes us. We use a small
// post-drag delay so the gesture's own pointerup→click sequence
// doesn't immediately self-cancel.
window.addEventListener("click", () => {
  if (Date.now() - dragStartedAt > 200) {
    void endDrag();
  }
}, true);

// Escape key — manual safety lever. There's a low-probability bug
// (suspected race during the popover→modal handoff) where the
// pointerup event lands on the wrong window so neither the modal's
// pointerup nor pointercancel fires, leaving the capture overlay
// stuck on screen capturing all clicks. Esc is the user's "get me
// out of this" escape hatch.
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    void endDrag();
  }
}, true);

let ending = false;
async function endDrag(): Promise<void> {
  if (ending) return;
  ending = true;
  try { clearInterval(watchdogId); } catch {}
  try {
    await OBR.broadcast.sendMessage(BC_DRAG_END, {}, { destination: "LOCAL" });
  } catch {}
  try { await OBR.modal.close(MODAL_ID); } catch {}
}

// --- Live-track viewport / token changes during drag. ---
//
// `OBR.viewport.onChange` doesn't exist in this SDK version (only
// getScale / getPosition / transformPoint are exposed) — calling it
// throws "t.viewport.onChange is not a function" and tears down the
// entire capture overlay's init. We poll instead. 10× per second is
// plenty smooth for the transient drag overlay and doesn't melt the
// CPU since `refreshRings` is a cheap getItems + transformPoint pass.
const unsubs: Array<() => void> = [];

OBR.onReady(async () => {
  await refreshRings();
  unsubs.push(OBR.scene.items.onChange(() => { void refreshRings(); }));
  const pollId = setInterval(() => { void refreshRings(); }, 100);
  unsubs.push(() => clearInterval(pollId));
});

window.addEventListener("beforeunload", () => {
  for (const u of unsubs.splice(0)) try { u(); } catch {}
});
