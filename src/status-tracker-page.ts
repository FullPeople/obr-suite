// Status Tracker — palette popover.
//
// APPLY mode (default): flat grid of buff bubbles. Left-click a bubble
// to select it, then left-click tokens on the canvas to apply/toggle.
// Right-click cancels the current selection.
//
// EDIT mode (toggle ✎ in the toolbar): same flat grid, but every
// element morphs into an editable affordance:
//   • Category buttons in the filter row become click-to-rename,
//     drag-to-reorder, and drop-targets for buffs (drop = move
//     buff into that category). A trailing "+" button replaces
//     itself with an inline <input> on click for adding a new
//     category.
//   • Buff bubbles open a small floating popup on click — colour
//     picker + name input + delete + cancel + save. The popup is
//     pinned inside the panel so it can't escape during a viewport
//     resize. Bubbles are also draggable: drop on another bubble to
//     reorder (left half = insert before, right half = insert
//     after); drop on a category button to recategorize.
//   • A "+ 新 buff" trailing pill inserts a fresh buff into the
//     active filter group (or "未分类" if "全部" is active) and
//     auto-opens its edit popup.
//
// Catalog persistence shape (scene metadata):
//   v1 (legacy) — bare BuffDef[] array
//   v2 (new)    — { version: 2, buffs: BuffDef[], groupOrder?: string[] }
//
// We accept either on read; we always write v2 on save.

import OBR from "@owlbear-rodeo/sdk";
import { installDebugOverlay } from "./utils/debugOverlay";
import { installPanelZoom } from "./utils/panelZoom";
import {
  PLUGIN_ID,
  SCENE_BUFF_CATALOG_KEY,
  STATUS_BUFFS_KEY,
  STATUS_EFFECTS_ENABLED,
  DEFAULT_BUFFS,
  BuffDef,
  BuffEffect,
  textColorFor,
  getStatusRenderMode,
  setStatusRenderMode,
  type StatusRenderMode,
} from "./modules/statusTracker/types";
import { DEFAULT_BUFF_RETIRED_IDS } from "./modules/statusTracker/defaultsMigration";
import { bindPanelDrag } from "./utils/panelDrag";
import { PANEL_IDS } from "./utils/panelLayout";
import { t, applyI18nDom } from "./i18n";
import { getLocalLang, onLangChange } from "./state";
import { statusName, statusGroup } from "./modules/statusTracker/localization";

// i18n — most text here is built dynamically in JS, so read the active
// language fresh on each render via T(). (Group/category names are
// user/stored data and are intentionally NOT translated.)
const T = (k: Parameters<typeof t>[1]) => t(getLocalLang(), k);
import { assetUrl } from "./asset-base";

const BC_DRAG_START = `${PLUGIN_ID}/drag-start`;
const BC_DRAG_END = `${PLUGIN_ID}/drag-end`;
const BC_TOGGLE = `${PLUGIN_ID}/toggle`;
const BC_REFRESH_TOKEN = `${PLUGIN_ID}/refresh-token`;
const BC_SELECT_APPLY = `${PLUGIN_ID}/select-apply`;
const BC_SELECT_CANCEL = `${PLUGIN_ID}/select-cancel`;
const BC_SELECT_STATE = `${PLUGIN_ID}/select-state`;

let selectedApplyKey: string | null = null;

const dragHandle = document.getElementById("dragHandle") as HTMLDivElement;
const btnClose = document.getElementById("btnClose") as HTMLButtonElement;
const btnEdit = document.getElementById("btnEdit") as HTMLButtonElement;
const btnRenderMode = document.getElementById("btnRenderMode") as HTMLButtonElement | null;
const btnExport = document.getElementById("btnExport") as HTMLButtonElement;
const btnImport = document.getElementById("btnImport") as HTMLButtonElement;
const fileImport = document.getElementById("fileImport") as HTMLInputElement;
const presetsBarEl = document.getElementById("presetsBar") as HTMLDivElement;
const filtersEl = document.getElementById("filters") as HTMLDivElement;
const gridEl = document.getElementById("grid") as HTMLDivElement;
const popupEl = document.getElementById("popup") as HTMLDivElement;
const footEl = document.getElementById("foot") as HTMLDivElement;
const cardEl = document.getElementById("card") as HTMLDivElement;
// 2026-05-18 — hover-preview pane refs. Optional in markup; checks
// below null-guard so old cached status-tracker.html still loads.
const previewEl = document.getElementById("buff-preview") as HTMLDivElement | null;
const previewMediaEl = document.getElementById("bp-media") as HTMLDivElement | null;
const previewLabelEl = document.getElementById("bp-label") as HTMLDivElement | null;

let _previewHideTimer: number | null = null;
let _previewActiveId: string | null = null;

// 2026-05-18 — warm browser cache for buff webms so the first hover
// has frame 0 ready instead of fetching cold. Called once after
// catalog loads; the fetch is fire-and-forget and uses `force-cache`
// so subsequent <video src> creations resolve from cache instantly.
//
// Also reuses a SHARED <video> element pool keyed by webm URL —
// reusing the same element across re-hovers avoids creating a fresh
// HTMLMediaElement (which involves codec setup) every time and keeps
// the first-hover "blank video" symptom from recurring.
const prewarmedWebms = new Set<string>();
const previewVideoCache = new Map<string, HTMLVideoElement>();
function prewarmBuffPreviews(): void {
  for (const b of buffs) {
    const buffAny = b as any;
    if (typeof buffAny.webmAsset !== "string" || !buffAny.webmAsset) continue;
    if (prewarmedWebms.has(buffAny.webmAsset)) continue;
    prewarmedWebms.add(buffAny.webmAsset);
    const url = `${location.origin}${import.meta.env.BASE_URL}${buffAny.webmAsset}`;
    // fire-and-forget HEAD-equivalent (full GET is fine; webms are ~50KB).
    // `cache: 'force-cache'` so subsequent <video src> picks up the
    // cached response without a second download.
    fetch(url, { cache: "force-cache" }).catch(() => {});
  }
}
function getPreviewVideo(url: string): HTMLVideoElement {
  let v = previewVideoCache.get(url);
  if (v) return v;
  v = document.createElement("video");
  v.src = url;
  v.loop = true;
  v.muted = true;
  v.playsInline = true;
  v.preload = "auto";
  v.setAttribute("aria-hidden", "true");
  // Hold the element off-DOM but loaded — first time it gets attached
  // for hover preview, frame 0 is already decoded.
  previewVideoCache.set(url, v);
  return v;
}

function showBuffPreview(buffId: string): void {
  if (!previewEl || !previewMediaEl || !previewLabelEl) return;
  if (_previewHideTimer != null) {
    window.clearTimeout(_previewHideTimer);
    _previewHideTimer = null;
  }
  if (_previewActiveId === buffId) return; // already showing
  const b = buffs.find((x) => x.id === buffId);
  if (!b) return;
  const buffAny = b as any;
  const webm = typeof buffAny.webmAsset === "string" && buffAny.webmAsset ? buffAny.webmAsset : "";
  const icon = typeof buffAny.iconAsset === "string" && buffAny.iconAsset ? buffAny.iconAsset : "";
  // 2026-05-18 — text-only buffs (no webm AND no icon) skip the
  // preview pane entirely per user request. The pane would just
  // show a colour swatch + name, which the buff button already
  // conveys; popping a pane for those just adds noise.
  if (!webm && !icon) {
    hideBuffPreviewDeferred();
    return;
  }
  _previewActiveId = buffId;
  // Re-use a long-lived <video> per URL (created on first hover,
  // kept in previewVideoCache) so the codec doesn't reinit each
  // hover. Detach from previous mount + clear previous content,
  // then attach the cached element.
  previewMediaEl.innerHTML = "";
  if (webm) {
    const url = `${location.origin}${import.meta.env.BASE_URL}${webm}`;
    const v = getPreviewVideo(url);
    v.currentTime = 0;
    previewMediaEl.appendChild(v);
    // Explicit play(). Browser autoplay policy allows muted video; the
    // promise can still reject if the document hasn't fully loaded —
    // a no-op .catch keeps it silent.
    void v.play().catch(() => {});
  } else if (icon) {
    const img = document.createElement("img");
    img.src = icon;
    img.alt = "";
    img.loading = "lazy";
    img.decoding = "async";
    previewMediaEl.appendChild(img);
  }
  previewLabelEl.innerHTML =
    `<span class="bp-name">${escapeHtml(statusName(b, getLocalLang()))}</span>` +
    `<span class="bp-hint">${b.group ? escapeHtml(groupLabel(b.group)) + " · " : ""}${T("stHoverPreview")}</span>`;
  previewEl.classList.add("is-active");
}

function hideBuffPreviewDeferred(): void {
  if (!previewEl) return;
  if (_previewHideTimer != null) window.clearTimeout(_previewHideTimer);
  // 180 ms grace so sweeping the cursor between adjacent pills
  // doesn't flicker the pane closed-then-open.
  _previewHideTimer = window.setTimeout(() => {
    _previewHideTimer = null;
    _previewActiveId = null;
    previewEl.classList.remove("is-active");
    // 2026-05-18 — DON'T tear down the <video> element. Removing it
    // from DOM resets the decoder state; on next hover the user
    // would see the "blank-then-loads" flicker again. Pause the
    // active video instead — keeps decoder warm for instant
    // re-attach. Detaching from DOM doesn't pause modern browsers'
    // <video> elements; calling .pause() explicitly stops the
    // decode loop while preserving the loaded buffer.
    setTimeout(() => {
      if (!previewEl.classList.contains("is-active") && previewMediaEl) {
        const v = previewMediaEl.querySelector("video");
        if (v) v.pause();
        // The <video> stays in the cache (previewVideoCache); just
        // detach from the mount so the next show can re-attach to
        // either the same or a different cached video.
        while (previewMediaEl.firstChild) previewMediaEl.removeChild(previewMediaEl.firstChild);
      }
    }, 220);
  }, 180);
}

interface CatalogFile {
  version: 2;
  buffs: BuffDef[];
  groupOrder: string[];
}

const UNCATEGORIZED = "未分类";

// "未分类" is the STORED group sentinel — never translate the stored
// value (saved catalogs / presets reference it literally). This helper
// maps it to a localized DISPLAY label only; user-defined group names
// pass through unchanged.
const groupLabel = (g: string): string => (g === UNCATEGORIZED ? T("stCatUncategorized") : statusGroup(g, buffs, getLocalLang()));

// Per-client persistence of the active category filter. The user's
// reasonable expectation is that picking "Buffs" stays selected
// after closing + reopening the palette, instead of always resetting
// to "All". Stored under a per-client localStorage key; survives
// scene reloads and browser restarts.
const LS_ACTIVE_FILTER = "com.obr-suite/status/active-filter";
function readPersistedFilter(): string | null {
  try {
    const v = localStorage.getItem(LS_ACTIVE_FILTER);
    if (typeof v === "string" && v.length > 0) return v;
  } catch {}
  return null;
}
function writePersistedFilter(v: string | null): void {
  try {
    if (v == null || v === "") localStorage.removeItem(LS_ACTIVE_FILTER);
    else localStorage.setItem(LS_ACTIVE_FILTER, v);
  } catch {}
}

let buffs: BuffDef[] = DEFAULT_BUFFS.slice();
let groupOrder: string[] = [];
let activeFilter: string | null = readPersistedFilter();
let editMode = false;

// Newly-created buffs (via "+ 新 buff" in edit mode) start with an
// empty name and an auto-opened edit popup. If the user closes the
// popup (cancel / outside-click / Escape) without entering a name,
// the placeholder buff is deleted from the catalog so we don't leave
// an unnamed entry behind. The set is the bookkeeping for that —
// add on creation, remove on save (committed) or on the close-side
// cleanup (rolled back).
const newlyCreatedBuffIds = new Set<string>();

// Inline "+ category" input is open when this is true. Replaces the
// "+" button in the filter row with an <input>.
let addCatPending = false;
// Active edit popup target (buff id), or null if popup is closed.
let popupBuffId: string | null = null;

// === Catalog load / save ====================================================
//
// 2026-05-09: catalog moved from scene-metadata (shared) to
// localStorage (per-client) so each player can customise their own
// palette independently. Applied-buff metadata on tokens stays shared
// — that's actual game state. Customising the palette only changes
// what THIS browser sees in the popover + the colours/effects this
// browser uses to render bubbles for the buff IDs it knows about.
//
// Migration: on first run with empty LS, fall back to ANY existing
// scene-metadata catalog so upgrading users don't lose customisation.

const LS_BUFF_CATALOG = "obr-suite/status/buff-catalog";

// 2026-05-18 — bump when DEFAULT_BUFFS changes shape and we want the
// migration below to run again on existing clients. The version is
// stored in localStorage alongside the catalog; mismatched value
// triggers `migrateDefaultsInPlace`.
// v3: revert from the 76-entry public/buff-fx auto-list back to the
// 12-entry user-curated set; expand DEFAULT_BUFF_RETIRED_IDS to cover
// every retired id from BOTH the original 32 and the v2 76-list so
// matching-untouched users get cleaned up regardless of which
// version they previously migrated to.
// v4: drop every retired id UNCONDITIONALLY (was: only when buff
// state matched the original default signature). User: "原本的那
// 32个旧buff需要删掉" — explicit removal even if the user
// customised the buff with their own webm / color / name. The new
// 12 defaults use `u_*` prefixed ids so they don't collide with any
// retired id; user-created buffs that happen to use a colliding id
// (rare) need to be re-added under a different id.
// v5: force-refresh u_* entries from DEFAULT_BUFFS. v4 catalogs had
// the new 12 defaults appended WITHOUT the webmIntrinsicW/H fields
// I added afterwards, so bubbles.ts fell back to the 192 default
// against the 256×256 actual files and the buff rendered drifting
// bottom-right. The u_* id prefix is reserved for built-in defaults
// so blanket-replacing them won't clobber user-created buffs.
// v6: webms re-encoded to 192×192 with alpha-preserving VP8. Drop
// the webmIntrinsicW/H overrides (now files match the 192 default).
// Same force-refresh path strips the stale 256 overrides from v5
// catalogs.
const DEFAULTS_MIGRATION_VERSION = 6;
const LS_DEFAULTS_VERSION = "obr-suite/status/defaults-version";

/**
 * Merge the new DEFAULT_BUFFS into a user's existing catalog:
 *  - Any buff whose id is in DEFAULT_BUFF_RETIRED_IDS is REMOVED
 *    UNCONDITIONALLY (was: only when matching the old default
 *    signature). 2026-05-18 v4 — user wants the 32 old built-in
 *    buffs gone regardless of whether they tweaked the colour /
 *    name / webm. The new defaults use `u_*` prefixed ids so they
 *    don't collide with anything users may have legitimately
 *    created themselves.
 *  - Any buff in DEFAULT_BUFFS not already present in the catalog
 *    (by id) is appended.
 * Returns the merged buff list + the original groupOrder, padded with
 * any new groups introduced by the appended defaults.
 */
function migrateDefaultsInPlace(
  existing: BuffDef[],
  existingOrder: string[],
): { buffs: BuffDef[]; groupOrder: string[] } {
  // Pass 1: drop every retired-default id.
  const kept = existing.filter((b) => !DEFAULT_BUFF_RETIRED_IDS.has(b.id));
  // Pass 2: append new defaults that aren't already there (by id) AND
  // force-refresh any u_* entry already in the catalog from the
  // latest DEFAULT_BUFFS shape. The u_* prefix is reserved for
  // built-in defaults — user-created buffs use other id schemes — so
  // overwriting them with the freshest defaults is safe and lets us
  // ship a schema change (e.g. adding webmIntrinsicW) without users
  // needing to manually re-add every default.
  const defaultIds = new Set(DEFAULT_BUFFS.map((d) => d.id));
  const existingIds = new Set(kept.map((b) => b.id));
  for (let i = 0; i < kept.length; i++) {
    const b = kept[i];
    if (b.id.startsWith("u_") && defaultIds.has(b.id)) {
      const fresh = DEFAULT_BUFFS.find((d) => d.id === b.id);
      if (fresh) kept[i] = { ...fresh };
    }
  }
  for (const def of DEFAULT_BUFFS) {
    if (!existingIds.has(def.id)) {
      kept.push({ ...def });
      existingIds.add(def.id);
    }
  }
  // Pass 3: pad groupOrder with any new groups (preserves user's prior
  // group ordering so they don't see their layout reshuffled). Also
  // PRUNE groups that no longer have any buffs after the retirement.
  const finalOrder: string[] = [];
  const seenGroups = new Set<string>();
  const usedGroups = new Set<string>();
  for (const b of kept) if (b.group) usedGroups.add(b.group);
  for (const g of existingOrder) {
    if (usedGroups.has(g) && !seenGroups.has(g)) {
      finalOrder.push(g);
      seenGroups.add(g);
    }
  }
  for (const b of kept) {
    const g = b.group;
    if (g && !seenGroups.has(g)) {
      finalOrder.push(g);
      seenGroups.add(g);
    }
  }
  return { buffs: kept, groupOrder: finalOrder };
}

async function loadCatalog(): Promise<void> {
  let loaded: { buffs: BuffDef[]; groupOrder: string[] } | null = null;
  let source: "ls" | "scene" | "default" = "default";
  // 1) Local storage — primary source post-2026-05-09.
  try {
    const raw = localStorage.getItem(LS_BUFF_CATALOG);
    if (raw) {
      const parsed = parseCatalog(JSON.parse(raw));
      if (parsed) { loaded = parsed; source = "ls"; }
    }
  } catch {}
  // 2) One-time migration from scene metadata when LS is empty.
  if (!loaded) {
    try {
      const meta = await OBR.scene.getMetadata();
      const v = meta[SCENE_BUFF_CATALOG_KEY] as unknown;
      const parsed = parseCatalog(v);
      if (parsed) { loaded = parsed; source = "scene"; }
    } catch {}
  }
  // 3) If still nothing, the constructor-initialised `buffs` already
  //    holds DEFAULT_BUFFS.slice(); just record the version stamp so
  //    the migration doesn't try to re-run on the first save.
  if (!loaded) {
    try { localStorage.setItem(LS_DEFAULTS_VERSION, String(DEFAULTS_MIGRATION_VERSION)); } catch {}
    if (!popupBuffId) render();
    return;
  }
  // 4) Run the defaults migration if this client hasn't seen the
  //    current version yet. Idempotent — version stamp prevents
  //    repeated runs.
  let storedVersion = 0;
  try {
    const raw = localStorage.getItem(LS_DEFAULTS_VERSION);
    if (raw) storedVersion = Number(raw) || 0;
  } catch {}
  if (storedVersion < DEFAULTS_MIGRATION_VERSION) {
    loaded = migrateDefaultsInPlace(loaded.buffs, loaded.groupOrder);
    // Persist + stamp.
    try {
      const file: CatalogFile = { version: 2, buffs: loaded.buffs, groupOrder: loaded.groupOrder };
      localStorage.setItem(LS_BUFF_CATALOG, JSON.stringify(file));
      localStorage.setItem(LS_DEFAULTS_VERSION, String(DEFAULTS_MIGRATION_VERSION));
    } catch {}
  } else if (source === "scene") {
    // First-run scene → LS migration (legacy path) — persist as before.
    try {
      const file: CatalogFile = { version: 2, buffs: loaded.buffs, groupOrder: loaded.groupOrder };
      localStorage.setItem(LS_BUFF_CATALOG, JSON.stringify(file));
    } catch {}
  }
  buffs = loaded.buffs;
  groupOrder = loaded.groupOrder;
  // 2026-05-18 — warm the browser cache for every buff's webm so the
  // first hover-preview opens with frame 0 ready (instead of a 200-
  // 800 ms blank while the file fetches + decodes). Fire-and-forget.
  prewarmBuffPreviews();
  if (!popupBuffId) render();
}

function parseCatalog(v: unknown): { buffs: BuffDef[]; groupOrder: string[] } | null {
  if (Array.isArray(v)) {
    const list = parseBuffArray(v);
    if (list.length === 0) return null;
    return { buffs: list, groupOrder: deriveGroupOrder(list) };
  }
  if (v && typeof v === "object" && Array.isArray((v as any).buffs)) {
    const list = parseBuffArray((v as any).buffs);
    if (list.length === 0) return null;
    const order = Array.isArray((v as any).groupOrder)
      ? (v as any).groupOrder.filter((g: any): g is string => typeof g === "string")
      : deriveGroupOrder(list);
    return { buffs: list, groupOrder: order };
  }
  return null;
}

const VALID_EFFECTS: ReadonlyArray<BuffEffect> = ["default", "float", "drop", "flicker", "curve", "spread"];

function parseEffect(v: unknown): BuffEffect | undefined {
  if (typeof v !== "string") return undefined;
  return VALID_EFFECTS.includes(v as BuffEffect) ? (v as BuffEffect) : undefined;
}

function parseBuffArray(arr: any[]): BuffDef[] {
  const out: BuffDef[] = [];
  for (const e of arr) {
    if (!e || typeof e.id !== "string") continue;
    const def: BuffDef = {
      id: String(e.id),
      name: String(e.name ?? e.id),
      color: typeof e.color === "string" ? e.color : "#ffffff",
      group: typeof e.group === "string" && e.group.length > 0 ? e.group : undefined,
    };
    const rounds = Math.floor(Number(e.rounds));
    if (Number.isFinite(rounds) && rounds > 0) def.rounds = rounds;
    const eff = parseEffect(e.effect);
    if (eff && eff !== "default") def.effect = eff;
    // effectParams: imageUrl (+ cached dims) / speed / count
    const ep = (e as any).effectParams;
    if (ep && typeof ep === "object") {
      const params: any = {};
      if (typeof ep.imageUrl === "string" && ep.imageUrl.length > 0) params.imageUrl = ep.imageUrl;
      if (typeof ep.imageWidth === "number" && isFinite(ep.imageWidth)) params.imageWidth = ep.imageWidth;
      if (typeof ep.imageHeight === "number" && isFinite(ep.imageHeight)) params.imageHeight = ep.imageHeight;
      if (typeof ep.speed === "number" && isFinite(ep.speed)) params.speed = ep.speed;
      if (typeof ep.count === "number" && isFinite(ep.count)) params.count = ep.count;
      if (Object.keys(params).length > 0) (def as any).effectParams = params;
    }
    // 2026-05-14 — preserve webmAsset across the parse↔save roundtrip
    // (editor used to drop it; that would silently revert customised
    // WebM effect choices on every save). Same for webmScale.
    const wa = (e as any).webmAsset;
    if (typeof wa === "string" && wa.length > 0) {
      (def as any).webmAsset = wa;
    }
    const ws = (e as any).webmScale;
    if (typeof ws === "number" && Number.isFinite(ws) && ws > 0) {
      (def as any).webmScale = ws;
    }
    // 2026-05-18 — preserve per-buff intrinsic webm dims. These tell
    // bubbles.ts how to anchor + scale the webm on a token; without
    // them OBR's offset interpretation uses the file's real pixels
    // which can drift off-centre when our default 192 doesn't match.
    const iw = (e as any).webmIntrinsicW;
    if (typeof iw === "number" && Number.isFinite(iw) && iw > 0) {
      (def as any).webmIntrinsicW = iw;
    }
    const ih = (e as any).webmIntrinsicH;
    if (typeof ih === "number" && Number.isFinite(ih) && ih > 0) {
      (def as any).webmIntrinsicH = ih;
    }
    // 2026-05-18 — preserve rotation across save/load. Set by the
    // "以此创建状态" flow when the source token was pre-rotated.
    const rot = (e as any).rotation;
    if (typeof rot === "number" && Number.isFinite(rot)) {
      (def as any).rotation = rot;
    }
    // 2026-05 — webmOff: explicit "this built-in buff's effect is
    // turned off". Lets the re-seed below distinguish "user disabled
    // it" from "an old catalog never stored the asset".
    if ((e as any).webmOff === true) (def as any).webmOff = true;
    // Re-seed a built-in buff's default WebM effect when the stored
    // catalog lacks it. Older catalogs (saved before webmAsset was
    // persisted) would otherwise show every built-in status as 无 even
    // though it ships with an effect. Skipped when the user has
    // explicitly turned the effect off (webmOff).
    if (!(def as any).webmAsset && !(def as any).webmOff) {
      const builtin = DEFAULT_BUFFS.find((b) => b.id === def.id);
      const bwa = builtin && (builtin as any).webmAsset;
      if (typeof bwa === "string" && bwa.length > 0) {
        (def as any).webmAsset = bwa;
      }
    }
    // 2026-05-14 (#2) — same round-trip preservation for the static
    // image-icon fields, so editing any buff in the palette doesn't
    // strip a "以此创建状态" buff's image.
    const ia = (e as any).iconAsset;
    if (typeof ia === "string" && ia.length > 0) {
      (def as any).iconAsset = ia;
      const im = (e as any).iconMime;
      if (typeof im === "string" && im.length > 0) (def as any).iconMime = im;
      const iw = (e as any).iconWidth;
      if (typeof iw === "number" && Number.isFinite(iw) && iw > 0) (def as any).iconWidth = iw;
      const ih = (e as any).iconHeight;
      if (typeof ih === "number" && Number.isFinite(ih) && ih > 0) (def as any).iconHeight = ih;
    }
    out.push(def);
  }
  return out;
}

function deriveGroupOrder(list: BuffDef[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const b of list) {
    const g = b.group ?? UNCATEGORIZED;
    if (!seen.has(g)) {
      seen.add(g);
      out.push(g);
    }
  }
  return out;
}

async function saveCatalog(): Promise<void> {
  const order = mergedGroupOrder(groupOrder, buffs);
  const file: CatalogFile = { version: 2, buffs, groupOrder: order };
  groupOrder = order;
  // Per-client LS instead of shared scene metadata. Also broadcast a
  // local "catalog changed" event so the background renderer (in the
  // same browser) re-syncs token bubbles immediately.
  try {
    localStorage.setItem(LS_BUFF_CATALOG, JSON.stringify(file));
    try {
      OBR.broadcast.sendMessage(
        "com.obr-suite/status/catalog-changed",
        {},
        { destination: "LOCAL" },
      );
    } catch {}
  } catch (e) {
    console.warn("[status/palette] saveCatalog failed", e);
  }
}

// === Presets (2026-05-15) ===================================================
//
// A preset is a named bundle of buff ids. The user can:
//   • click a chip → action menu: overwrite-all / merge-all / delete.
//     "overwrite-all" / "merge-all" target every CHARACTER-CARD-BOUND
//     token in the scene (`com.character-cards/boundCardId` metadata
//     is a non-empty string). Tokens without bound cards are skipped
//     so monsters and props don't get accidentally buffed.
//   • drag a chip onto a token → applies just that preset's buffs to
//     that one token (drop-to-target path, see preset drag handler).
//   • "+ 保存当前活动 buffs 为预设" button → save the currently filtered
//     buff group as a preset under a prompted name.
//
// Per-client storage in localStorage (alongside the catalog). Presets
// are bundled into the JSON export/import file under `presets` so a
// user's preset library round-trips with the catalog.

interface BuffPreset {
  id: string;
  name: string;
  buffIds: string[];     // ids that must exist in the local catalog
  rounds?: Record<string, number>; // optional per-buff round override
}

const LS_PRESETS = "obr-suite/status/buff-presets";
const CC_BIND_KEY = "com.character-cards/boundCardId";

let presets: BuffPreset[] = [];

function parsePresets(raw: unknown): BuffPreset[] {
  if (!Array.isArray(raw)) return [];
  const out: BuffPreset[] = [];
  for (const e of raw) {
    if (!e || typeof e !== "object") continue;
    const id = (e as any).id;
    const name = (e as any).name;
    const buffIds = (e as any).buffIds;
    if (typeof id !== "string" || typeof name !== "string" || !Array.isArray(buffIds)) continue;
    const cleanIds = buffIds.filter((s): s is string => typeof s === "string");
    if (cleanIds.length === 0) continue;
    const r = (e as any).rounds;
    const cleanRounds: Record<string, number> = {};
    if (r && typeof r === "object") {
      for (const [k, v] of Object.entries(r)) {
        if (typeof v === "number" && Number.isFinite(v) && v > 0) cleanRounds[k] = Math.floor(v);
      }
    }
    out.push({
      id, name, buffIds: cleanIds,
      ...(Object.keys(cleanRounds).length ? { rounds: cleanRounds } : {}),
    });
  }
  return out;
}

function loadPresets(): void {
  try {
    const raw = localStorage.getItem(LS_PRESETS);
    if (raw) presets = parsePresets(JSON.parse(raw));
  } catch { presets = []; }
}

function savePresets(): void {
  try { localStorage.setItem(LS_PRESETS, JSON.stringify(presets)); }
  catch (e) { console.warn("[status/presets] save failed", e); }
}

function newPresetId(): string {
  return `pre-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function renderPresets(): void {
  if (!presetsBarEl) return;
  let html = `<span class="presets-lbl">${T("stPresetsLbl")}</span>`;
  if (presets.length === 0) {
    html += `<span class="presets-empty">${T("stPresetsEmpty")}</span>`;
  } else {
    html += presets.map((p) => {
      const count = p.buffIds.length;
      return `<button class="preset-chip" type="button" draggable="true"
                      data-preset-id="${escapeHtml(p.id)}"
                      title="${escapeHtml(T("stPresetChipTitle"))}">${escapeHtml(p.name)}<span class="pre-count">${count}</span></button>`;
    }).join("");
  }
  html += `<button class="preset-save" id="presetSave" type="button" title="${escapeHtml(T("stPresetSaveTitle"))}">${T("stPresetSave")}</button>`;
  presetsBarEl.innerHTML = html;
}

function closePresetMenu(): void {
  document.querySelectorAll<HTMLElement>(".preset-menu").forEach((el) => el.remove());
}

function openPresetMenu(chip: HTMLElement, preset: BuffPreset): void {
  closePresetMenu();
  const menu = document.createElement("div");
  menu.className = "preset-menu";
  menu.innerHTML =
    `<button data-act="overwrite">${T("stPresetOverwrite")}</button>` +
    `<button data-act="merge">${T("stPresetMerge")}</button>` +
    `<button data-act="rename">${T("stPresetRename")}</button>` +
    `<button class="danger" data-act="delete">${T("stPresetDelete")}</button>`;
  document.body.appendChild(menu);
  const r = chip.getBoundingClientRect();
  menu.style.left = `${Math.round(r.left)}px`;
  menu.style.top = `${Math.round(r.bottom + 4)}px`;

  menu.addEventListener("click", async (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-act]");
    if (!btn) return;
    const act = btn.dataset.act;
    closePresetMenu();
    if (act === "overwrite" || act === "merge") {
      const mode: "overwrite" | "merge" = act;
      const count = await applyPresetToCharacterCardTokens(preset, mode);
      try {
        await OBR.notification.show(
          T("stPresetApplied")
            .replace("{name}", preset.name)
            .replace("{mode}", mode === "overwrite" ? T("stModeOverwrite") : T("stModeMerge"))
            .replace("{count}", String(count)),
          "SUCCESS",
        );
      } catch { /* notification best-effort */ }
    } else if (act === "rename") {
      const next = window.prompt(T("stRenamePromptNew"), preset.name);
      if (next && next.trim()) {
        preset.name = next.trim();
        savePresets();
        renderPresets();
      }
    } else if (act === "delete") {
      if (window.confirm(T("stPresetDeleteConfirm").replace("{name}", preset.name))) {
        presets = presets.filter((p) => p.id !== preset.id);
        savePresets();
        renderPresets();
      }
    }
  });
  // Close on outside click (one-shot).
  setTimeout(() => {
    const off = (ev: MouseEvent) => {
      if (!menu.contains(ev.target as Node)) {
        closePresetMenu();
        document.removeEventListener("mousedown", off, true);
      }
    };
    document.addEventListener("mousedown", off, true);
  }, 0);
}

// Apply a preset to every CHARACTER-CARD-BOUND token in the scene.
// `overwrite` replaces each token's full buff list with the preset's
// ids; `merge` adds the preset's ids on top (deduped). Returns the
// number of tokens updated for the user toast.
async function applyPresetToCharacterCardTokens(
  preset: BuffPreset,
  mode: "overwrite" | "merge",
): Promise<number> {
  let tokens: Array<{ id: string }> = [];
  try {
    tokens = await OBR.scene.items.getItems((it) => {
      const bound = it.metadata?.[CC_BIND_KEY];
      return typeof bound === "string" && bound.length > 0;
    });
  } catch (e) {
    console.warn("[status/presets] getItems failed", e);
    return 0;
  }
  if (tokens.length === 0) return 0;
  try {
    await OBR.scene.items.updateItems(tokens.map((t) => t.id), (drafts) => {
      for (const d of drafts) {
        const cur = Array.isArray((d.metadata as any)[STATUS_BUFFS_KEY])
          ? ((d.metadata as any)[STATUS_BUFFS_KEY] as string[])
          : [];
        const next = mode === "overwrite"
          ? preset.buffIds.slice()
          : Array.from(new Set([...cur, ...preset.buffIds]));
        (d.metadata as any)[STATUS_BUFFS_KEY] = next;
      }
    });
  } catch (e) {
    console.warn("[status/presets] updateItems failed", e);
    return 0;
  }
  return tokens.length;
}

// Apply preset to a single token (used by drag-to-token).
async function applyPresetToToken(preset: BuffPreset, tokenId: string): Promise<void> {
  try {
    await OBR.scene.items.updateItems([tokenId], (drafts) => {
      for (const d of drafts) {
        const cur = Array.isArray((d.metadata as any)[STATUS_BUFFS_KEY])
          ? ((d.metadata as any)[STATUS_BUFFS_KEY] as string[])
          : [];
        // Single-token drop is always merge — overwriting one token
        // via drag would be too surprising. "覆盖全员" is for the
        // bulk path through the action menu.
        const next = Array.from(new Set([...cur, ...preset.buffIds]));
        (d.metadata as any)[STATUS_BUFFS_KEY] = next;
      }
    });
  } catch (e) {
    console.warn("[status/presets] applyPresetToToken failed", e);
  }
}

if (presetsBarEl) {
  presetsBarEl.addEventListener("click", (e) => {
    const saveBtn = (e.target as HTMLElement).closest("#presetSave");
    if (saveBtn) {
      // Save currently filtered buffs (active filter); when filter is
      // null ("全部") save the whole catalog. Excludes blank-name
      // placeholders / empty rows.
      const list = activeFilter === null
        ? buffs.slice()
        : buffs.filter((b) => (b.group ?? UNCATEGORIZED) === activeFilter);
      const ids = list.filter((b) => b.name.trim() !== "").map((b) => b.id);
      if (ids.length === 0) {
        window.alert(T("stPresetNoBuffs"));
        return;
      }
      const def = activeFilter === null ? T("stCatAll") : groupLabel(activeFilter);
      const name = window.prompt(T("stPresetNamePrompt").replace("{count}", String(ids.length)), def);
      if (!name || !name.trim()) return;
      presets.push({ id: newPresetId(), name: name.trim(), buffIds: ids });
      savePresets();
      renderPresets();
      return;
    }
    const chip = (e.target as HTMLElement).closest<HTMLElement>(".preset-chip");
    if (chip) {
      const id = chip.dataset.presetId;
      const p = presets.find((x) => x.id === id);
      if (p) openPresetMenu(chip, p);
    }
  });

  // Drag-to-token: dispatch BC_DRAG_START with a `preset` kind so the
  // capture overlay knows to render a preset-pill cursor and route the
  // drop into applyPresetToToken. Local-only event — works in the same
  // browser (which is where the palette runs anyway).
  presetsBarEl.addEventListener("dragstart", (e) => {
    const chip = (e.target as HTMLElement).closest<HTMLElement>(".preset-chip");
    if (!chip) return;
    const id = chip.dataset.presetId;
    const p = presets.find((x) => x.id === id);
    if (!p) return;
    // dataTransfer is required for an HTML5 drag to actually start;
    // we don't read from it on drop — applyPresetToToken is called
    // directly from the BC_PRESET_DROP listener registered below.
    try { e.dataTransfer?.setData("text/plain", `preset:${p.id}`); } catch {}
    try {
      OBR.broadcast.sendMessage(
        BC_DRAG_START,
        { kind: "preset", presetId: p.id, presetName: p.name, count: p.buffIds.length },
        { destination: "LOCAL" },
      );
    } catch {}
  });
  presetsBarEl.addEventListener("dragend", () => {
    try {
      OBR.broadcast.sendMessage(BC_DRAG_END, {}, { destination: "LOCAL" });
    } catch {}
  });
}

// Capture overlay reports the drop target via this channel. Format:
//   { kind: "preset", presetId: string, tokenId: string }
const BC_PRESET_DROP = `${PLUGIN_ID}/preset-drop`;
try {
  OBR.broadcast.onMessage(BC_PRESET_DROP, async (msg) => {
    const data = msg.data as { presetId?: string; tokenId?: string } | undefined;
    if (!data?.presetId || !data?.tokenId) return;
    const p = presets.find((x) => x.id === data.presetId);
    if (!p) return;
    await applyPresetToToken(p, data.tokenId);
    try {
      await OBR.notification.show(
        T("stPresetAppliedMerge").replace("{name}", p.name), "SUCCESS",
      );
    } catch {}
  });
} catch { /* OBR not ready yet — listener attaches when palette mounts */ }

try {
  OBR.broadcast.onMessage(BC_SELECT_STATE, (msg) => {
    const data = msg.data as { key?: string | null } | undefined;
    setSelectedApplyKey(data?.key ?? null);
  });
} catch { /* OBR not ready yet — palette can still set its local state */ }

function mergedGroupOrder(prior: string[], list: BuffDef[]): string[] {
  // Preserve every group the user has explicitly added to `prior`,
  // even if it currently has zero buffs. Auto-discovered groups
  // (encountered on a buff but not yet in `prior`) get appended at
  // the end. Explicit deletion happens in onRenameCategory's
  // "rename to empty" branch which does its own confirm + filter —
  // this function is the WRITE path, not the cleanup path.
  //
  // Earlier the filter was `g === UNCATEGORIZED || list.some(b =>
  // b.group === g)` which silently dropped any user-created empty
  // category on the very next save, breaking the new-category flow
  // (user clicks +, types name, presses Enter — saveCatalog runs,
  // mergedGroupOrder strips the empty group, write goes out without
  // it, render shows old groups).
  const seen = new Set(prior);
  const out = prior.slice();
  for (const b of list) {
    const g = b.group ?? UNCATEGORIZED;
    if (!seen.has(g)) {
      seen.add(g);
      out.push(g);
    }
  }
  return out;
}

// === Helpers ================================================================

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!),
  );
}

function genId(): string {
  return `buff-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// 2026-05-15 — strip pictographic emoji + variation selectors + ZWJ +
// skin-tone modifiers from a buff name when rendering. Doesn't touch
// the saved data: legacy buff libraries with "麻痹 ⚡" / "魅惑 💘" /
// etc. still load fine; only the rendered label drops the emoji
// decoration so the palette reads as text + the WebM / iconAsset
// becomes the unambiguous visual indicator (matches the user spec
// "状态追踪界面 emoji → SVG 全部替换").
function stripEmoji(s: string): string {
  return s.replace(/\p{Extended_Pictographic}/gu, "")
          .replace(/[\u{FE0E}\u{FE0F}\u{200D}]/gu, "")
          .replace(/[\u{1F3FB}-\u{1F3FF}]/gu, "")
          .replace(/\s+/g, " ")
          .trim();
}

function setSelectedApplyKey(key: string | null): void {
  selectedApplyKey = key;
  if (!editMode) renderGrid();
}

async function cancelApplySelection(): Promise<void> {
  if (!selectedApplyKey) return;
  selectedApplyKey = null;
  renderGrid();
  try {
    await OBR.broadcast.sendMessage(BC_SELECT_CANCEL, {}, { destination: "LOCAL" });
  } catch {}
}

async function selectApplyBubble(id: string): Promise<void> {
  if (editMode) return;
  popupEl.classList.remove("open");
  hideBuffPreviewDeferred();
  let payload: any | null = null;
  if (id === "__clear__") {
    payload = { kind: "clear", key: "__clear__" };
  } else if (id === "__manage__") {
    payload = { kind: "manage", key: "__manage__" };
  } else {
    const buff = buffs.find((b) => b.id === id) ?? null;
    if (!buff) return;
    payload = { kind: "buff", key: id, buff };
  }
  selectedApplyKey = id;
  renderGrid();
  try {
    await OBR.broadcast.sendMessage(BC_SELECT_APPLY, payload, { destination: "LOCAL" });
  } catch (err) {
    console.warn("[status/palette] BC_SELECT_APPLY failed", err);
  }
}

// Inline SVG icons used in place of emoji in the user-visible UI.
// All are 14px stroke-based monochrome and inherit `currentColor`
// so they pick up the surrounding bubble/text colour.
const SVG_WRENCH =
  `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none"`
  + ` stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"`
  + ` style="vertical-align:-2px;margin-right:5px">`
  + `<path d="M11 3.5a3 3 0 0 1-4.2 4.2L3 11.5l1.5 1.5 3.8-3.8a3 3 0 0 1 4.2-4.2l-2 2 .5 1.5 1.5.5z"/>`
  + `</svg>`;
const SVG_CROSS =
  `<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" fill="none"`
  + ` stroke="currentColor" stroke-width="1.8" stroke-linecap="round"`
  + ` style="vertical-align:-2px;margin-right:5px">`
  + `<path d="M4 4l8 8M12 4l-8 8"/>`
  + `</svg>`;
const SVG_FOLDER =
  `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none"`
  + ` stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">`
  + `<path d="M2 4.5h4l1.5 1.5H14v6.5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z"/>`
  + `</svg>`;

// === Filters row ============================================================

function renderFilters(): void {
  const groups = mergedGroupOrder(groupOrder, buffs);

  // In APPLY mode the "全部" pseudo-filter unfilters; in EDIT mode
  // we drop it because edit mode shows all buffs anyway (no filter).
  let html = "";
  if (!editMode) {
    html += `<button class="cat-btn ${activeFilter === null ? "on" : ""}" data-g="">${T("stCatAll")}</button>`;
  }
  for (const g of groups) {
    // Category-button drag (re-order categories) is edit-mode only,
    // and so is the buff-drop receiver. The 2026-05-08 attempt to
    // also accept buff drops in apply mode broke the old token-apply
    // gesture and got reverted.
    const dragAttr = editMode ? `draggable="true"` : "";
    const isOn = (!editMode && activeFilter === g) ? "on" : "";
    html += `<button class="cat-btn ${isOn}" data-g="${escapeHtml(g)}" ${dragAttr}>${escapeHtml(groupLabel(g))}</button>`;
  }
  if (editMode) {
    if (addCatPending) {
      html += `<input class="cat-input" id="cat-add-input" type="text" placeholder="${escapeHtml(T("stNewCatPh"))}" maxlength="16"/>`;
    } else {
      html += `<button class="cat-add" id="cat-add-btn" type="button" title="${escapeHtml(T("stAddCat"))}">+</button>`;
    }
  }
  filtersEl.innerHTML = html;

  // Wire all category buttons
  filtersEl.querySelectorAll<HTMLButtonElement>(".cat-btn").forEach((b) => {
    const g = b.dataset.g || "";

    if (!editMode) {
      // Apply mode: click filters (persisted per-client). No
      // dragover/drop receiver wiring — apply-mode bubbles aren't
      // `draggable="true"` (see renderGrid for why), so there's no
      // dragged buff-id payload that could reach this handler. The
      // 2026-05-08 attempt to also accept buff drops here was part
      // of the same regression that broke drag-to-token in apply
      // mode and got reverted.
      b.addEventListener("click", () => {
        activeFilter = g === "" ? null : g;
        writePersistedFilter(activeFilter);
        render();
      });
      return;
    }

    // Edit mode: empty data-g shouldn't appear, but guard anyway.
    if (g === "") {
      b.addEventListener("click", () => {
        activeFilter = null;
        writePersistedFilter(null);
        render();
      });
      return;
    }

    // Editable category: click = rename, drag = reorder, drop = recategorize.
    // Use a flag that dragstart sets so click can suppress on a drag.
    let dragged = false;
    b.addEventListener("click", () => {
      if (dragged) { dragged = false; return; }
      onRenameCategory(g);
    });
    b.addEventListener("dragstart", (e) => {
      dragged = true;
      e.dataTransfer?.setData("text/cat-name", g);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
      b.classList.add("dragging");
    });
    b.addEventListener("dragend", () => {
      b.classList.remove("dragging");
      filtersEl.querySelectorAll(".cat-btn.drop-target").forEach((x) =>
        x.classList.remove("drop-target"),
      );
      // Clear the dragged-flag a tick later so the synthetic click
      // (which fires AFTER dragend in some browsers) gets ignored.
      setTimeout(() => { dragged = false; }, 0);
    });
    b.addEventListener("dragover", (e) => {
      const types = e.dataTransfer?.types;
      if (!types) return;
      if (types.includes("text/buff-id") || types.includes("text/cat-name")) {
        e.preventDefault();
        b.classList.add("drop-target");
      }
    });
    b.addEventListener("dragleave", (e) => {
      const rt = e.relatedTarget as Node | null;
      if (rt && b.contains(rt)) return;
      b.classList.remove("drop-target");
    });
    b.addEventListener("drop", (e) => {
      e.preventDefault();
      b.classList.remove("drop-target");
      const buffId = e.dataTransfer?.getData("text/buff-id");
      const catName = e.dataTransfer?.getData("text/cat-name");
      if (buffId) {
        void onMoveBuff(buffId, g);
      } else if (catName && catName !== g) {
        void onReorderCategory(catName, g);
      }
    });
  });

  // "+" button → open inline input
  if (editMode && !addCatPending) {
    const addBtn = filtersEl.querySelector<HTMLButtonElement>("#cat-add-btn");
    addBtn?.addEventListener("click", () => {
      addCatPending = true;
      render();
      requestAnimationFrame(() => {
        const inp = filtersEl.querySelector<HTMLInputElement>("#cat-add-input");
        inp?.focus();
      });
    });
  }

  // Inline category input — commit on Enter / blur, cancel on Escape.
  if (editMode && addCatPending) {
    const inp = filtersEl.querySelector<HTMLInputElement>("#cat-add-input");
    if (inp) {
      const commit = async (): Promise<void> => {
        if (!addCatPending) return; // already committed
        const name = inp.value.trim();
        addCatPending = false;
        if (name && name !== UNCATEGORIZED && !groupOrder.includes(name)) {
          groupOrder.push(name);
          await saveCatalog();
        }
        render();
      };
      inp.addEventListener("blur", () => { void commit(); });
      inp.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          void commit();
        } else if (e.key === "Escape") {
          addCatPending = false;
          render();
        }
      });
    }
  }
}

// === Bubble grid ============================================================

function renderGrid(): void {
  // Edit mode shows all buffs; apply mode honours activeFilter.
  const list = editMode
    ? buffs.slice()
    : buffs.filter((b) =>
        activeFilter === null ? true : (b.group ?? UNCATEGORIZED) === activeFilter,
      );

  let html = "";
  if (!editMode) {
    const eraserSelected = selectedApplyKey === "__clear__" ? " selected" : "";
    const manageSelected = selectedApplyKey === "__manage__" ? " selected" : "";
    html += `<div class="bubble eraser${eraserSelected}" data-id="__clear__">${SVG_CROSS}${T("stClearAllBuffs")}</div>`;
    // Manage pill: select it, then click a token to open that token's
    // management popover. From there each buff is independently
    // draggable to remove or transfer.
    html += `<div class="bubble manage${manageSelected}" data-id="__manage__">${SVG_WRENCH}${T("stManageBuffs")}</div>`;
  }
  for (const b of list) {
    const fg = textColorFor(b.color);
    // Edit-mode-only `draggable="true"`. The 2026-05-08 attempt to
    // also enable HTML5 drag in apply mode (so users could drop a
    // buff on a category to change groups) broke the apply-mode
    // drag-to-token flow: the browser starts an HTML5 drag the
    // moment the cursor moves, fires `pointercancel`, the global
    // pointercancel handler broadcasts BC_DRAG_END, and the capture
    // overlay closes before the user finishes dragging onto a
    // token. The two interactions share the same pointerdown gesture
    // and there's no in-browser way to disambiguate after the drag
    // has already started — drag-to-category in apply mode needs a
    // different gesture (right-click menu, long-press, modifier
    // key, etc.) which we'll revisit separately.
    const dragAttr = editMode ? `draggable="true"` : "";
    const selectedCls = !editMode && selectedApplyKey === b.id ? " selected" : "";
    const cls = editMode ? "bubble editable" : `bubble${selectedCls}`;
    // 2026-05-18 — REVERTED the inline thumbnails (both <img> for
    // iconAsset and <video> for webmAsset). The <video> element
    // renders a solid BLACK fill until its first frame paints, which
    // visibly broke the palette's transparent jelly tint. The user
    // also asked for a HOVER preview pane at the bottom of the
    // palette instead — see the #buff-preview rig wired below.
    const iconHtml = "";
    // 2026-05-10: pass the buff colour through `--bubble-bg` so the
    // jelly CSS can apply 80%-alpha + a glassy highlight overlay.
    // Plain inline `background:` was opaque; color-mix in the
    // stylesheet now handles the translucency.
    html += `<div class="${cls}"
                  data-id="${escapeHtml(b.id)}"
                  ${dragAttr}
                  style="--bubble-bg:${escapeHtml(b.color)};color:${escapeHtml(fg)}">
               ${iconHtml}${escapeHtml(stripEmoji(statusName(b, getLocalLang())))}
             </div>`;
  }
  if (editMode) {
    html += `<div class="bubble add-pill" id="add-buff-pill">${T("stNewBuffPill")}</div>`;
  }
  gridEl.innerHTML = html;

  gridEl.querySelectorAll<HTMLElement>(".bubble").forEach((el) => {
    const id = el.dataset.id ?? "";
    if (el.id === "add-buff-pill") {
      el.addEventListener("click", () => { void onAddBuff(); });
      return;
    }

    // 2026-05-18 — hover-preview wiring (both apply + edit modes).
    // pointerenter shows the buff's actual webm/icon in the
    // #buff-preview pane below the grid; pointerleave hides it after
    // a short delay so quickly sweeping the cursor across pills
    // doesn't strobe the pane open/closed. Skipped for the
    // synthetic eraser / manage pills (no buff to preview).
    if (id !== "__clear__" && id !== "__manage__") {
      el.addEventListener("pointerenter", () => showBuffPreview(id));
      el.addEventListener("pointerleave", () => hideBuffPreviewDeferred());
    }

    if (!editMode) {
      el.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        void selectApplyBubble(id);
      });
      el.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        e.stopPropagation();
        void cancelApplySelection();
      });
      return;
    }
    if (id === "__clear__") return; // shouldn't render in edit mode
    el.addEventListener("contextmenu", (e) => e.preventDefault());

    let dragged = false;
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      if (dragged) { dragged = false; return; }
      openEditPopup(id, el);
    });
    el.addEventListener("dragstart", (e) => {
      dragged = true;
      e.dataTransfer?.setData("text/buff-id", id);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
      el.classList.add("dragging");
    });
    el.addEventListener("dragend", () => {
      el.classList.remove("dragging");
      gridEl.querySelectorAll(".bubble.drop-before, .bubble.drop-after")
        .forEach((b) => b.classList.remove("drop-before", "drop-after"));
      setTimeout(() => { dragged = false; }, 0);
    });
    el.addEventListener("dragover", (e) => {
      if (!e.dataTransfer?.types.includes("text/buff-id")) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const before = (e.clientX - rect.left) < rect.width / 2;
      gridEl.querySelectorAll(".bubble.drop-before, .bubble.drop-after")
        .forEach((b) => b.classList.remove("drop-before", "drop-after"));
      el.classList.add(before ? "drop-before" : "drop-after");
    });
    el.addEventListener("dragleave", (e) => {
      const rt = e.relatedTarget as Node | null;
      if (rt && el.contains(rt)) return;
      el.classList.remove("drop-before", "drop-after");
    });
    el.addEventListener("drop", (e) => {
      e.preventDefault();
      const draggedId = e.dataTransfer?.getData("text/buff-id");
      const rect = el.getBoundingClientRect();
      const before = (e.clientX - rect.left) < rect.width / 2;
      gridEl.querySelectorAll(".bubble.drop-before, .bubble.drop-after")
        .forEach((b) => b.classList.remove("drop-before", "drop-after"));
      if (draggedId && draggedId !== id) {
        void onReorderBuff(draggedId, id, before);
      }
    });
  });
}

// === Edit popup =============================================================

// Display labels for the experimental effect modes. Drives both the
// segmented picker in the popup AND the persistence on save.
type I18nKey = Parameters<typeof t>[1];
const EFFECT_LABELS: Array<{ id: BuffEffect; labelKey: I18nKey; hintKey: I18nKey }> = [
  { id: "default", labelKey: "stFxDefault", hintKey: "stFxDefaultHint" },
  { id: "float",   labelKey: "stFxFloat",   hintKey: "stFxFloatHint" },
  { id: "drop",    labelKey: "stFxDrop",    hintKey: "stFxDropHint" },
  { id: "flicker", labelKey: "stFxFlicker", hintKey: "stFxFlickerHint" },
  { id: "curve",   labelKey: "stFxCurve",   hintKey: "stFxCurveHint" },
  { id: "spread",  labelKey: "stFxSpread",  hintKey: "stFxSpreadHint" },
];

function openEditPopup(id: string, anchor: HTMLElement): void {
  const buff = buffs.find((b) => b.id === id);
  if (!buff) return;
  const displayedName = statusName(buff, getLocalLang());
  popupBuffId = id;
  // Pending state for the segmented picker — read on save.
  let pendingEffect: BuffEffect = buff.effect ?? "default";
  let pendingImageUrl: string = buff.effectParams?.imageUrl ?? "";
  let pendingImageW: number | undefined = buff.effectParams?.imageWidth;
  let pendingImageH: number | undefined = buff.effectParams?.imageHeight;
  // 2026-05 — WebM-backed buff effect. Built-in buffs (id present in
  // DEFAULT_BUFFS with a baked-in webmAsset) get a 2-way 无 / 默认特效
  // toggle; custom buffs get no picker at all (just a hint pointing
  // at the right-click-a-scene-webm flow). The prebuilt-variant
  // LIBRARY + 更换 button were removed per user request.
  let pendingWebmAsset: string | undefined = buff.webmAsset;
  let pendingWebmOff: boolean = buff.webmOff === true;
  const builtinDef = DEFAULT_BUFFS.find((b) => b.id === buff.id);
  const defaultWebm: string | undefined =
    builtinDef && typeof builtinDef.webmAsset === "string" && builtinDef.webmAsset.length > 0
      ? builtinDef.webmAsset
      : undefined;
  const isBuiltInFx = !!defaultWebm;
  const fxButtons = EFFECT_LABELS.map((e) => `
    <button class="pop-fx-seg ${pendingEffect === e.id ? "on" : ""}"
            data-fx="${e.id}"
            type="button"
            title="${escapeHtml(T(e.hintKey))}">${escapeHtml(T(e.labelKey))}</button>
  `).join("");
  const showImg = pendingEffect !== "default";
  // Effects UI is gated on STATUS_EFFECTS_ENABLED. While the
  // feature is deferred, the popup just shows colour + name +
  // delete/save — no effect picker, no image URL row. Catalog
  // values for `effect`/`effectParams` are preserved on save (we
  // simply don't surface them); flipping the flag back to true
  // restores everything.
  const effectsBlock = STATUS_EFFECTS_ENABLED
    ? `
    <div class="pop-fx-label">${escapeHtml(T("stFxLabel"))}</div>
    <div class="pop-fx-row">${fxButtons}</div>
    <div class="pop-row pop-img-row" style="${showImg ? "" : "display:none"}">
      <input class="pop-img-url" type="text"
             value="${escapeHtml(pendingImageUrl)}"
             placeholder="${escapeHtml(T("stFxParticleUrlPh"))}"/>
      <button class="pop-img-pick" type="button" title="${escapeHtml(T("stFxPickFromLib"))}">${SVG_FOLDER}</button>
    </div>`
    : "";
  // 2026-05 — WebM effect. Built-in buffs: a 2-way 无 / 默认特效
  // toggle. Custom buffs: no toggle (no built-in default to offer).
  // Both get the grey hint pointing at the "drag a webm into the
  // scene → right-click → 以此创建状态" flow for arbitrary WebMs.
  const webmBlock = isBuiltInFx
    ? `
    <div class="pop-fx-label">${escapeHtml(T("stEffectLabel"))}</div>
    <div class="pop-webm-seg-row">
      <button class="pop-webm-seg ${pendingWebmAsset ? "" : "on"}" data-webm="none" type="button">${escapeHtml(T("stWebmNone"))}</button>
      <button class="pop-webm-seg ${pendingWebmAsset ? "on" : ""}" data-webm="default" type="button">${escapeHtml(T("stWebmDefault"))}</button>
    </div>
    <div class="pop-webm-hint">${escapeHtml(T("stWebmHintBuiltin"))}</div>`
    : `
    <div class="pop-fx-label">${escapeHtml(T("stEffectLabel"))}</div>
    <div class="pop-webm-hint">${escapeHtml(T("stWebmHintCustom"))}</div>`;
  popupEl.innerHTML = `
    <div class="pop-row">
      <input class="pop-color" type="color" value="${escapeHtml(buff.color)}"/>
      <input class="pop-name" type="text" maxlength="20" value="${escapeHtml(displayedName)}" placeholder="${escapeHtml(T("stNamePh"))}"/>
    </div>
    <div class="pop-row rounds">
      <span class="pop-rounds-label">${escapeHtml(T("stRoundsLabel"))}</span>
      <input class="pop-rounds" type="number" min="0" max="99" step="1"
             value="${buff.rounds ?? ""}" placeholder="0"/>
      <span class="pop-rounds-label">${escapeHtml(T("stRoundsUnlimited"))}</span>
    </div>
    ${effectsBlock}
    ${webmBlock}
    <div class="pop-row pop-actions">
      <button class="pop-del" type="button">${escapeHtml(T("stDelete"))}</button>
      <span style="flex:1"></span>
      <button class="pop-cancel" type="button">${escapeHtml(T("stCancel"))}</button>
      <button class="pop-save" type="button">${escapeHtml(T("stSave"))}</button>
    </div>
  `;
  // Position popup just below the anchor bubble, clamped inside the
  // card so it can't fly off-screen on small panels.
  const cardRect = cardEl.getBoundingClientRect();
  const aRect = anchor.getBoundingClientRect();
  popupEl.classList.add("open");
  // Measure popup AFTER making it visible (display:flex).
  const pw = popupEl.offsetWidth;
  const ph = popupEl.offsetHeight;
  let left = aRect.left - cardRect.left;
  let top = aRect.bottom - cardRect.top + 4;
  if (left + pw > cardRect.width - 6) left = cardRect.width - pw - 6;
  if (left < 6) left = 6;
  if (top + ph > cardRect.height - 6) {
    // Flip above the anchor if there's no room below.
    top = aRect.top - cardRect.top - ph - 4;
    if (top < 6) top = 6;
  }
  popupEl.style.left = `${left}px`;
  popupEl.style.top = `${top}px`;

  const nameInp = popupEl.querySelector<HTMLInputElement>(".pop-name")!;
  const colorInp = popupEl.querySelector<HTMLInputElement>(".pop-color")!;
  const roundsInp = popupEl.querySelector<HTMLInputElement>(".pop-rounds")!;
  const save = popupEl.querySelector<HTMLButtonElement>(".pop-save")!;
  const cancel = popupEl.querySelector<HTMLButtonElement>(".pop-cancel")!;
  const del = popupEl.querySelector<HTMLButtonElement>(".pop-del")!;
  const fxSegs = popupEl.querySelectorAll<HTMLButtonElement>(".pop-fx-seg");
  const imgRow = popupEl.querySelector<HTMLDivElement>(".pop-img-row");
  const imgInp = popupEl.querySelector<HTMLInputElement>(".pop-img-url");
  const imgPick = popupEl.querySelector<HTMLButtonElement>(".pop-img-pick");
  fxSegs.forEach((seg) => {
    seg.addEventListener("click", () => {
      const fx = seg.dataset.fx as BuffEffect | undefined;
      if (!fx) return;
      pendingEffect = fx;
      fxSegs.forEach((s) => s.classList.toggle("on", s.dataset.fx === fx));
      if (imgRow) imgRow.style.display = (fx === "default") ? "none" : "";
    });
  });
  if (imgInp) {
    imgInp.addEventListener("input", () => {
      pendingImageUrl = imgInp.value;
      // Manually-typed URL invalidates the cached dims — they'll
      // be re-probed by particles.ts on next sync.
      pendingImageW = undefined;
      pendingImageH = undefined;
    });
  }
  // 2026-05 — WebM effect toggle (built-in buffs only). 无 clears the
  // asset + marks `webmOff` so the catalog loader won't re-seed it;
  // 默认特效 restores the buff's canonical DEFAULT_BUFFS asset.
  const webmSegs = popupEl.querySelectorAll<HTMLButtonElement>(".pop-webm-seg");
  webmSegs.forEach((seg) => {
    seg.addEventListener("click", () => {
      if (seg.dataset.webm === "default") {
        pendingWebmAsset = defaultWebm;
        pendingWebmOff = false;
      } else {
        pendingWebmAsset = undefined;
        pendingWebmOff = true;
      }
      webmSegs.forEach((s) => s.classList.toggle("on", s === seg));
    });
  });

  if (imgPick) {
    imgPick.addEventListener("click", async () => {
      // OBR.assets.downloadImages opens OBR's library picker.
      // Returns ImageContent[] with URL + dims already populated,
      // so we save the dims to skip the DOM re-probe later.
      try {
        const images = await OBR.assets.downloadImages(false, "");
        if (Array.isArray(images) && images.length > 0) {
          const img = images[0] as any;
          if (typeof img.url === "string") {
            pendingImageUrl = img.url;
            pendingImageW = typeof img.width === "number" ? img.width : undefined;
            pendingImageH = typeof img.height === "number" ? img.height : undefined;
            if (imgInp) imgInp.value = img.url;
          }
        }
      } catch (e) {
        console.warn("[status/palette] downloadImages failed", e);
      }
    });
  }

  const close = (): void => {
    const dropped = discardUnnamedBuffIfPending(id);
    popupBuffId = null;
    popupEl.classList.remove("open");
    popupEl.innerHTML = "";
    if (dropped) render();
  };

  save.addEventListener("click", async () => {
    const name = nameInp.value.trim();
    if (!name) {
      // Empty-name save also closes the popup and discards a
      // newly-created placeholder buff. Differs from existing buffs
      // (which never get a save with empty name because their input
      // pre-fills with the real name) — those would stay open if the
      // user manually cleared their name and clicked save, but that's
      // an edge case the user accepted.
      close();
      return;
    }
    // User committed a real name — drop the new-buff placeholder
    // tracking BEFORE we mutate the catalog so the close handler
    // doesn't re-delete the buff if something goes wrong.
    newlyCreatedBuffIds.delete(id);
    const target = buffs.find((b) => b.id === id);
    if (target) {
      target.name = name === displayedName.trim() ? buff.name : name;
      target.color = colorInp.value;
      const rounds = Math.floor(Number(roundsInp.value));
      if (Number.isFinite(rounds) && rounds > 0) target.rounds = rounds;
      else delete target.rounds;
      target.effect = pendingEffect === "default" ? undefined : pendingEffect;
      // 2026-05 — persist webmAsset + webmOff. For a built-in buff,
      // 无 stores `webmOff: true` so the loader doesn't re-seed the
      // default; 默认特效 stores the asset + clears webmOff. Custom
      // buffs never touch the toggle, so their webmAsset is preserved
      // as-is and webmOff stays absent.
      if (pendingWebmAsset) target.webmAsset = pendingWebmAsset;
      else delete (target as any).webmAsset;
      if (pendingWebmOff) (target as any).webmOff = true;
      else delete (target as any).webmOff;
      // effectParams: persist imageUrl + cached dims when user has
      // configured a particle image. Empty URL → no effectParams,
      // particles fall back to the bundled default sparkle.
      const cleanUrl = pendingImageUrl.trim();
      if (target.effect && cleanUrl.length > 0) {
        const params: any = { imageUrl: cleanUrl };
        if (typeof pendingImageW === "number") params.imageWidth = pendingImageW;
        if (typeof pendingImageH === "number") params.imageHeight = pendingImageH;
        (target as any).effectParams = params;
      } else {
        // No effect, or no image configured — clear any leftover
        // imageUrl so the catalog JSON stays terse.
        const ep = (target as any).effectParams;
        if (ep) {
          const { imageUrl: _, imageWidth: __, imageHeight: ___, ...rest } = ep;
          if (Object.keys(rest).length > 0) (target as any).effectParams = rest;
          else delete (target as any).effectParams;
        }
      }
      await saveCatalog();
    }
    close();
    render();
  });
  cancel.addEventListener("click", close);
  del.addEventListener("click", async () => {
    if (!window.confirm(T("stDeleteBuffConfirm").replace("{name}", statusName(buff, getLocalLang())))) return;
    buffs = buffs.filter((b) => b.id !== id);
    await saveCatalog();
    close();
    render();
  });
  nameInp.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); save.click(); }
    else if (e.key === "Escape") close();
  });

  requestAnimationFrame(() => nameInp.focus());
}

// Close popup when user clicks anywhere outside the popup AND outside
// a bubble (clicking another bubble re-opens the popup at that
// target, so we let that path through).
function handleOutsidePopupClick(e: MouseEvent): void {
  if (!popupEl.classList.contains("open")) return;
  const tgt = e.target as Node | null;
  if (!tgt) return;
  if (popupEl.contains(tgt)) return;
  const bubble = (tgt as HTMLElement).closest?.(".bubble.editable");
  if (bubble) return;
  // Same close-side cleanup as the popup's own close(): discard a
  // newly-created placeholder buff whose name was never filled in.
  let dropped = false;
  if (popupBuffId) dropped = discardUnnamedBuffIfPending(popupBuffId);
  popupBuffId = null;
  popupEl.classList.remove("open");
  popupEl.innerHTML = "";
  if (dropped) render();
}
window.addEventListener("click", handleOutsidePopupClick, true);

// === Edit-mode actions ======================================================

async function onRenameCategory(oldName: string): Promise<void> {
  const next = window.prompt(T("stRenameCatPrompt").replace("{name}", oldName), oldName);
  if (next === null) return;
  const trimmed = next.trim();
  if (trimmed === "") {
    // Refuse to delete the last named group — the user must always
    // have somewhere to drop new buffs into. (UNCATEGORIZED still
    // exists implicitly but isn't a "named" group the user can
    // rename / reorder, so leaving zero named groups breaks the
    // create-buff-into-active-filter UX.)
    if (groupOrder.length <= 1) {
      window.alert(T("stCatMinOne").replace("{name}", oldName));
      return;
    }
    if (!window.confirm(T("stCatDeleteConfirm").replace("{name}", oldName).replace("{uncat}", T("stCatUncategorized")))) return;
    for (const b of buffs) if ((b.group ?? UNCATEGORIZED) === oldName) b.group = undefined;
    groupOrder = groupOrder.filter((g) => g !== oldName);
    if (activeFilter === oldName) activeFilter = null;
    await saveCatalog();
    render();
    return;
  }
  if (trimmed === oldName) return;
  if (trimmed === UNCATEGORIZED) return;
  for (const b of buffs) if ((b.group ?? UNCATEGORIZED) === oldName) b.group = trimmed;
  const idx = groupOrder.indexOf(oldName);
  if (idx >= 0) groupOrder[idx] = trimmed;
  else groupOrder.push(trimmed);
  if (activeFilter === oldName) activeFilter = trimmed;
  await saveCatalog();
  render();
}

async function onReorderCategory(dragName: string, dropOnName: string): Promise<void> {
  if (dragName === dropOnName) return;
  const order = mergedGroupOrder(groupOrder, buffs);
  const idxFrom = order.indexOf(dragName);
  if (idxFrom < 0) return;
  // Remove from old position; recompute target index AFTER removal so
  // the splice math stays right regardless of relative direction.
  order.splice(idxFrom, 1);
  const idxTo = order.indexOf(dropOnName);
  if (idxTo < 0) return;
  order.splice(idxTo, 0, dragName);
  groupOrder = order;
  await saveCatalog();
  render();
}

async function onMoveBuff(id: string, targetGroup: string): Promise<void> {
  const target = buffs.find((b) => b.id === id);
  if (!target) return;
  const nextGroup = targetGroup === UNCATEGORIZED ? undefined : targetGroup;
  if ((target.group ?? UNCATEGORIZED) === (nextGroup ?? UNCATEGORIZED)) return;
  target.group = nextGroup;
  await saveCatalog();
  render();
}

async function onReorderBuff(dragId: string, dropOnId: string, before: boolean): Promise<void> {
  if (dragId === dropOnId) return;
  const fromIdx = buffs.findIndex((b) => b.id === dragId);
  const toIdx0 = buffs.findIndex((b) => b.id === dropOnId);
  if (fromIdx < 0 || toIdx0 < 0) return;
  const [moved] = buffs.splice(fromIdx, 1);
  // Recompute drop-on index after splice (it shifts if from < to).
  const toIdx = buffs.findIndex((b) => b.id === dropOnId);
  // Inherit the drop target's group so that dragging across groups
  // also moves the buff into the destination's category — matches
  // user expectation that drag-to-reorder visually lands the buff
  // wherever it drops.
  const dropTarget = buffs[toIdx];
  if (dropTarget) moved.group = dropTarget.group;
  buffs.splice(before ? toIdx : toIdx + 1, 0, moved);
  await saveCatalog();
  render();
}

async function onAddBuff(): Promise<void> {
  // New buffs land in the active filter group (apply-side activeFilter
  // doesn't apply in edit mode, but we still respect it as the last
  // user intent), or UNCATEGORIZED otherwise.
  const group = activeFilter && activeFilter !== UNCATEGORIZED ? activeFilter : undefined;
  const id = genId();
  const newBuff: BuffDef = {
    id,
    // Default name intentionally empty (user request 2026-05-08): the
    // popup auto-opens with focus on the name field, so the user types
    // a real name before saving. If they bail out without naming, the
    // close-side cleanup (newlyCreatedBuffIds) drops the placeholder.
    name: "",
    color: "#5dade2",
    group,
  };
  buffs.push(newBuff);
  newlyCreatedBuffIds.add(id);
  await saveCatalog();
  render();
  // Auto-open the edit popup so the user can rename / recolour
  // immediately. Need to wait for the new <div> to land in the DOM.
  requestAnimationFrame(() => {
    const el = gridEl.querySelector<HTMLElement>(`.bubble[data-id="${cssEscape(id)}"]`);
    if (el) openEditPopup(id, el);
  });
}

/** Drop a newly-created buff from the catalog if its name is still
 *  empty when the popup closes. Called from EVERY close path of the
 *  edit popup (save-with-empty bail, cancel, outside-click, escape).
 *  Returns true if a buff was actually deleted (so the caller can
 *  re-render). */
function discardUnnamedBuffIfPending(id: string): boolean {
  if (!newlyCreatedBuffIds.has(id)) return false;
  newlyCreatedBuffIds.delete(id);
  const buff = buffs.find((b) => b.id === id);
  if (!buff) return false;
  if (buff.name.trim() !== "") return false;
  buffs = buffs.filter((b) => b.id !== id);
  void saveCatalog();
  return true;
}

// CSS.escape polyfill for the auto-open bubble lookup. CSS.escape
// is widely supported but a tiny safe shim avoids any edge case.
function cssEscape(value: string): string {
  if (typeof (window as any).CSS?.escape === "function") {
    return (window as any).CSS.escape(value);
  }
  return value.replace(/([!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, "\\$1");
}

// === Render dispatcher ======================================================

// Footer text is split into one line per affordance so each
// reads on its own row inside the cramped 340px panel — much less
// eye-strain than a long " · "-joined run-on string.
// Built fresh per render() so a live language switch is reflected.
// {x} = the inline red-cross SVG icon.
function footApplyLines(): string[] {
  return [
    T("stFootApply1"),
    T("stFootApply2"),
    T("stFootApply3").replace("{x}", SVG_CROSS),
    T("stFootApply4").replace("{x}", SVG_CROSS),
    T("stFootApply5"),
  ];
}
function footEditLines(): string[] {
  return [
    T("stFootEdit1"),
    T("stFootEdit2"),
    T("stFootEdit3"),
    T("stFootEdit4"),
    T("stFootEdit5"),
  ];
}

function setFooter(lines: string[]): void {
  footEl.innerHTML = lines.map((l) => `<div class="foot-line">${l}</div>`).join("");
}

function render(): void {
  if (editMode) {
    btnEdit.classList.add("on");
    document.body.classList.add("edit-mode");
    footEl.classList.add("edit-foot");
    setFooter(footEditLines());
  } else {
    btnEdit.classList.remove("on");
    document.body.classList.remove("edit-mode");
    footEl.classList.remove("edit-foot");
    addCatPending = false;
    setFooter(footApplyLines());
  }
  renderFilters();
  renderGrid();
  // Mode toggle invalidates any open popup (its anchor may be gone).
  popupBuffId = null;
  popupEl.classList.remove("open");
  popupEl.innerHTML = "";
}

btnEdit.addEventListener("click", () => {
  editMode = !editMode;
  if (editMode) void cancelApplySelection();
  render();
});

// === Toolbar / shortcuts ====================================================

window.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  void cancelApplySelection();
});

bindPanelDrag(dragHandle, PANEL_IDS.statusPalette);

btnClose.addEventListener("click", async () => {
  try { await OBR.broadcast.sendMessage(BC_TOGGLE, {}, { destination: "LOCAL" }); } catch {}
});

// 2026-05-16 — render-mode cycle button. auto → effect → text → auto.
// Per-client localStorage; bubbles.ts reads getStatusRenderMode() on
// every describe(). Refresh visible tokens after a flip so the user
// sees the change immediately rather than waiting for the next
// items.onChange.
function refreshRenderModeLabel(): void {
  if (!btnRenderMode) return;
  const mode = getStatusRenderMode();
  btnRenderMode.textContent =
    mode === "effect" ? T("stRenderEffect") :
    mode === "text"   ? T("stRenderText") :
                        T("stRenderAuto");
  btnRenderMode.dataset.mode = mode;
}
refreshRenderModeLabel();
if (btnRenderMode) {
  btnRenderMode.addEventListener("click", async () => {
    const cur = getStatusRenderMode();
    const next: StatusRenderMode =
      cur === "auto"   ? "effect" :
      cur === "effect" ? "text"   :
                         "auto";
    setStatusRenderMode(next);
    refreshRenderModeLabel();
    // Force-resync so the mode flip lands right away. ONE coalesced
    // full pass via the catalog-changed handler (which clears the
    // background's sig snapshot before syncing — required because
    // tokenSyncKey doesn't encode the render mode). The old per-token
    // BC_REFRESH_TOKEN loop spawned N concurrent un-serialized
    // refreshes on a 30-token scene.
    try {
      await OBR.broadcast.sendMessage(
        "com.obr-suite/status/catalog-changed",
        {},
        { destination: "LOCAL" },
      );
    } catch (e) {
      console.warn("[status/palette] render-mode resync broadcast failed", e);
    }
  });
}
window.addEventListener("keydown", async (e) => {
  if (e.key === "]" || e.key === "Escape") {
    if (e.key === "Escape" && selectedApplyKey) {
      e.preventDefault();
      await cancelApplySelection();
      return;
    }
    if (popupBuffId) {
      popupBuffId = null;
      popupEl.classList.remove("open");
      popupEl.innerHTML = "";
      return;
    }
    if (addCatPending) {
      addCatPending = false;
      render();
      return;
    }
    e.preventDefault();
    try { await OBR.broadcast.sendMessage(BC_TOGGLE, {}, { destination: "LOCAL" }); } catch {}
  }
});

// === JSON import / export ===================================================

btnExport.addEventListener("click", () => {
  // 2026-05-15 — bundle presets alongside the catalog so the user's
  // preset library round-trips with the JSON. Older versions of this
  // file ignored extra keys; parseCatalog accepts either { buffs,
  // groupOrder } or the bare buffs array, so adding `presets` is
  // backward-compatible.
  const file = {
    version: 3,
    buffs,
    groupOrder: mergedGroupOrder(groupOrder, buffs),
    presets,
  };
  const blob = new Blob([JSON.stringify(file, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "status-buff-catalog.json";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1000);
});

btnImport.addEventListener("click", () => {
  fileImport.value = "";
  fileImport.click();
});
fileImport.addEventListener("change", async () => {
  const f = fileImport.files?.[0];
  if (!f) return;
  try {
    const text = await f.text();
    const json = JSON.parse(text);
    const parsed = parseCatalog(json);
    if (!parsed) {
      window.alert(T("stImportBadJson"));
      return;
    }
    buffs = parsed.buffs;
    groupOrder = parsed.groupOrder;
    await saveCatalog();
    // 2026-05-15 — v3 files also carry a `presets` array. Older v2
    // files have no presets key → parsePresets returns []. Merge into
    // the existing local presets (don't overwrite) so an import never
    // silently wipes the user's saved presets — dedupe by name.
    if (json && typeof json === "object" && Array.isArray((json as any).presets)) {
      const incoming = parsePresets((json as any).presets);
      if (incoming.length > 0) {
        const seen = new Set(presets.map((p) => p.name));
        for (const p of incoming) {
          if (seen.has(p.name)) continue;
          presets.push(p);
          seen.add(p.name);
        }
        savePresets();
        renderPresets();
      }
    }
    render();
  } catch (e: any) {
    window.alert(T("stImportFailed").replace("{err}", e?.message ?? String(e)));
  }
});

// === Boot ===================================================================

OBR.onReady(async () => {
  installDebugOverlay();
  // Bubble items are rendered by the GM client only (sole-writer
  // design in modules/statusTracker) — a player flipping the
  // per-client render mode would see the label cycle and nothing
  // change on canvas. Hide the button for players instead of leaving
  // a dead control.
  try {
    const role = await OBR.player.getRole();
    if (role !== "GM" && btnRenderMode) btnRenderMode.style.display = "none";
  } catch (e) {
    console.warn("[status/palette] getRole failed — leaving render-mode button visible", e);
  }
  try {
    OBR.player.onChange((p) => {
      if (!btnRenderMode) return;
      if (p.role) btnRenderMode.style.display = p.role === "GM" ? "" : "none";
    });
  } catch (e) {
    console.warn("[status/palette] player.onChange subscribe failed", e);
  }
  refreshLanguage();
  const offLanguage = onLangChange(refreshLanguage);
  window.addEventListener("pagehide", offLanguage, { once: true });
  // 2026-05-16 — scale text + buff icons with palette size. Baseline
  // = PALETTE_W × PALETTE_H from statusTracker/index.ts.
  installPanelZoom({ baseWidth: 340, baseHeight: 544 });
  await loadCatalog();
  loadPresets();
  renderPresets();
  // Cross-tab refresh — same client, two iframes (e.g. palette popover
  // + manage popover) editing the catalog or presets. The `storage`
  // event fires when the OTHER tab writes localStorage; reload + render.
  window.addEventListener("storage", (e) => {
    if (e.key === LS_BUFF_CATALOG) void loadCatalog();
    if (e.key === LS_PRESETS) { loadPresets(); renderPresets(); }
  });
});

/** Translate existing nodes: render() closes the popup and replaces category
 * inputs, so language changes must never call it or commit a user's draft. */
function refreshLanguage(): void {
  const lang = getLocalLang();
  document.documentElement.lang = lang; document.title = T("stPaletteTitle");
  applyI18nDom(lang); refreshRenderModeLabel();
  const text = (selector: string, key: Parameters<typeof T>[0]) => document.querySelectorAll<HTMLElement>(selector).forEach(el => { el.textContent = T(key); });
  const attribute = (selector: string, name: string, key: Parameters<typeof T>[0]) => document.querySelectorAll<HTMLElement>(selector).forEach(el => el.setAttribute(name, T(key)));
  filtersEl.querySelectorAll<HTMLElement>(".cat-btn").forEach(el => { const group = el.dataset.g; el.textContent = group ? groupLabel(group) : T("stCatAll"); });
  attribute("#cat-add-input", "placeholder", "stNewCatPh"); attribute("#cat-add-btn", "title", "stAddCat");
  gridEl.querySelectorAll<HTMLElement>(".bubble[data-id]").forEach(el => {
    const id = el.dataset.id;
    if (id === "__clear__") el.innerHTML = SVG_CROSS + T("stClearAllBuffs");
    else if (id === "__manage__") el.innerHTML = SVG_WRENCH + T("stManageBuffs");
    else { const buff = buffs.find(b => b.id === id); if (buff) el.textContent = stripEmoji(statusName(buff, lang)); }
  });
  text("#add-buff-pill", "stNewBuffPill"); text(".presets-lbl", "stPresetsLbl"); text(".presets-empty", "stPresetsEmpty"); text("#presetSave", "stPresetSave");
  attribute("#presetSave", "title", "stPresetSaveTitle"); attribute(".preset-chip", "title", "stPresetChipTitle");
  for (const [action, key] of [["overwrite", "stPresetOverwrite"], ["merge", "stPresetMerge"], ["rename", "stPresetRename"], ["delete", "stPresetDelete"]] as const) text(`.preset-menu [data-act="${action}"]`, key);
  attribute(".pop-name", "placeholder", "stNamePh"); attribute(".pop-img-url", "placeholder", "stFxParticleUrlPh"); attribute(".pop-img-pick", "title", "stFxPickFromLib");
  text(".pop-del", "stDelete"); text(".pop-cancel", "stCancel"); text(".pop-save", "stSave");
  text('.pop-webm-seg[data-webm="none"]', "stWebmNone"); text('.pop-webm-seg[data-webm="default"]', "stWebmDefault");
  const roundsLabels = popupEl.querySelectorAll<HTMLElement>(".pop-rounds-label");
  if (roundsLabels[0]) roundsLabels[0].textContent = T("stRoundsLabel");
  if (roundsLabels[1]) roundsLabels[1].textContent = T("stRoundsUnlimited");
  const fxLabels = popupEl.querySelectorAll<HTMLElement>(".pop-fx-label");
  fxLabels.forEach((el, index) => { el.textContent = T(STATUS_EFFECTS_ENABLED && index === 0 ? "stFxLabel" : "stEffectLabel"); });
  text(".pop-webm-hint", popupEl.querySelector(".pop-webm-seg") ? "stWebmHintBuiltin" : "stWebmHintCustom");
  for (const effect of EFFECT_LABELS) { text(`.pop-fx-seg[data-fx="${effect.id}"]`, effect.labelKey); attribute(`.pop-fx-seg[data-fx="${effect.id}"]`, "title", effect.hintKey); }
  if (_previewActiveId) {
    const buff = buffs.find(b => b.id === _previewActiveId);
    if (buff && previewLabelEl) {
      const name = previewLabelEl.querySelector(".bp-name"), hint = previewLabelEl.querySelector(".bp-hint");
      if (name) name.textContent = statusName(buff, lang);
      if (hint) hint.textContent = (buff.group ? groupLabel(buff.group) + " · " : "") + T("stHoverPreview");
    }
  }
  setFooter(editMode ? footEditLines() : footApplyLines());
}
