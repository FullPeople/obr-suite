// Trickster module — DM-placed circular trigger zone that fires "time
// stop + camera focus on the entering token" when any of the
// configured target tokens drag-commits into the zone.
//
// Architecture mirrors modules/portals/index.ts:
//   1. GM-only tool with crosshair cursor; drag = define center +
//      radius. Live preview via scene.local. Drag-end commits a real
//      Image item with TRICKSTER_KEY metadata.
//   2. items.onChange watcher diffs each candidate token's position.
//      When a candidate's position TRANSITIONS from outside-the-zone
//      to inside-the-zone, fire the trigger. No 350ms debounce — we
//      want the time-stop overlay to land as fast as OBR's onChange
//      fires after drag-commit.
//   3. Edit popover opens automatically on a freshly-drawn or
//      newly-selected trickster (DM-only) — same auto-popover pattern
//      portals uses.
//
// Difference from portals' watcher:
//   - Portals trigger only on tokens this client just dragged
//     (lastModifiedUserId guard) so the destination popover only
//     pops on the dragger's screen. Trickster MUST fire on the GM
//     even when a player did the dragging — time stop is a global
//     effect and the camera focus only matters on the GM's screen.
//   - We therefore key off lastModifiedUserId === <triggering player>
//     for ATTRIBUTION (so we know which player to blame and to
//     suppress double-fires for self-moves), but the GM's client is
//     the one that actually performs the time-stop write + camera
//     focus.

import OBR, { buildImage, Item } from "@owlbear-rodeo/sdk";
import { assetUrl } from "../../asset-base";
import { turnOnTimeStop } from "../timeStop";
import {
  PLUGIN_ID,
  TRICKSTER_KEY,
  CREATE_PREFS_KEY,
  CreatePrefs,
  TricksterMeta,
  TricksterTargetMode,
} from "./types";

const TOOL_ID = `${PLUGIN_ID}/tool`;
const TOOL_MODE_ID = `${PLUGIN_ID}/mode`;
const PREVIEW_KEY = `${PLUGIN_ID}/preview`;

const EDIT_POPOVER_ID = `${PLUGIN_ID}/edit-popover`;
const EDIT_URL = assetUrl("trickster-edit.html");
const EDIT_W = 380;
const EDIT_H = 480;
const EDIT_TOP_OFFSET = 60;

// `?v=2` cache-buster: the SVGs were redesigned 2026-05-08 (jester
// mask → "two heads peeking from behind a wall"). OBR's image
// renderer caches assets by URL, and the user reported still seeing
// the old jester even after redeploy — both browser cache and
// (probably) OBR's CDN held onto the v1 file. The query string
// makes the cache key fresh; bumping the number again forces a
// re-fetch every time we change the SVG. The `migrateLegacyTrickster`
// sweep below also rewrites every existing on-canvas trickster's
// `image.url` to ICON_URL, so old saved scenes don't keep showing
// the v1 art either.
const ICON_URL = assetUrl("trickster-icon.svg") + "?v=4";
const TOOL_ICON_URL = assetUrl("trickster-tool-icon.svg") + "?v=3";

const ICON_INTRINSIC = 64;
const ICON_SIZE = ICON_INTRINSIC;
const MIN_RADIUS = 16;

// --- Module state ---
const unsubs: Array<() => void> = [];
let role: "GM" | "PLAYER" = "PLAYER";

// Drag-to-draw state, mirrors portals.
let dragStart: { x: number; y: number } | null = null;
let previewItemId: string | null = null;

// Per-client position cache — used to detect transition-into-zone
// edges. We don't care about lastModifiedUserId here (unlike portals)
// because the GM may need to react to a player's drag.
const lastTokenPos = new Map<string, { x: number; y: number }>();

// Per-trickster cooldown so a single drag-commit can't fire twice
// (e.g. if items.onChange double-fires for the same batched commit).
const recentlyFired = new Map<string, number>();
const FIRE_COOLDOWN_MS = 1500;

// Auto-edit-popover state (DM single-select → open editor).
let editPopoverOpen = false;
let currentEditId: string | null = null;
let suppressAutoEditOnce: string | null = null;

// --- Helpers ---

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function isTrickster(it: Item): boolean {
  return !!it.metadata[TRICKSTER_KEY];
}

function readTricksterMeta(it: Item): TricksterMeta | null {
  const m = it.metadata[TRICKSTER_KEY];
  if (!m || typeof m !== "object") return null;
  const mm = m as any;
  if (typeof mm.targetMode !== "string") return null;
  // Migrate legacy "specific" mode (v1) → "all" so old saves keep firing.
  let mode: TricksterTargetMode =
    mm.targetMode === "specific" ? "all" : (mm.targetMode as TricksterTargetMode);
  return {
    name: typeof mm.name === "string" ? mm.name : "",
    radius: typeof mm.radius === "number" && mm.radius > 0 ? mm.radius : 70,
    // Default flipped to false (was true) — trickster zones are
    // ambush traps, players shouldn't see the marker by default.
    visible: typeof mm.visible === "boolean" ? mm.visible : false,
    locked: typeof mm.locked === "boolean" ? mm.locked : true,
    targetMode: mode,
    oneShot: typeof mm.oneShot === "boolean" ? mm.oneShot : true,
    fired: typeof mm.fired === "boolean" ? mm.fired : false,
  };
}

function tricksterCenter(it: Item): { x: number; y: number } {
  return { x: it.position.x, y: it.position.y };
}

/** Token is a valid trigger candidate for THIS trickster's targetMode. */
function tokenMatchesTarget(
  token: Item,
  meta: TricksterMeta,
  gmUserId: string,
): boolean {
  if (token.layer !== "CHARACTER" && token.layer !== "MOUNT") return false;
  if (isTrickster(token)) return false;
  switch (meta.targetMode) {
    case "all":
      return true;
    case "playerOnly":
      // Player tokens are CREATED by a non-GM player, OR have no
      // createdUserId at all (legacy). DM-spawned NPCs have createdUserId
      // === gmUserId.
      return (token as any).createdUserId !== gmUserId;
    case "npcOnly":
      return (token as any).createdUserId === gmUserId;
    default:
      return false;
  }
}

// --- Live preview (local-only) ---

async function startPreview(center: { x: number; y: number }) {
  try {
    let sceneDpi = 150;
    try { sceneDpi = await OBR.scene.grid.getDpi(); } catch {}
    const half = ICON_SIZE / 2;
    const s = (2 * MIN_RADIUS) / sceneDpi;
    const img = buildImage(
      {
        width: ICON_SIZE,
        height: ICON_SIZE,
        url: ICON_URL,
        mime: "image/svg+xml",
      },
      { dpi: ICON_SIZE, offset: { x: half, y: half } },
    )
      .position(center)
      .scale({ x: s, y: s })
      .layer("DRAWING")
      .locked(true)
      .disableHit(true)
      .visible(true)
      .metadata({ [PREVIEW_KEY]: true })
      .build();
    await OBR.scene.local.addItems([img]);
    previewItemId = img.id;
  } catch (e) {
    console.error("[obr-suite/trickster] startPreview failed", e);
  }
}

async function updatePreview(center: { x: number; y: number }, radius: number) {
  if (!previewItemId) return;
  try {
    let sceneDpi = 150;
    try { sceneDpi = await OBR.scene.grid.getDpi(); } catch {}
    const s = (2 * radius) / sceneDpi;
    await OBR.scene.local.updateItems([previewItemId], (drafts) => {
      for (const d of drafts) {
        d.position = { x: center.x, y: center.y };
        d.scale = { x: s, y: s };
      }
    });
  } catch {}
}

async function clearPreview() {
  if (!previewItemId) return;
  const id = previewItemId;
  previewItemId = null;
  try { await OBR.scene.local.deleteItems([id]); } catch {}
}

// --- Create trickster ---

async function createTrickster(center: { x: number; y: number }, radius: number) {
  let prefs: CreatePrefs = {};
  try {
    const raw = localStorage.getItem(CREATE_PREFS_KEY);
    if (raw) prefs = JSON.parse(raw) as CreatePrefs;
  } catch {}
  // Visibility flipped: default OFF (players don't see the marker)
  // unless the user explicitly opted in last time. Trickster is
  // an ambush mechanic, surprise > visibility.
  const visible = prefs.visible === true;
  const locked = prefs.locked !== false;
  const oneShot = prefs.oneShot !== false;
  // Migrate legacy "specific" pref → "all".
  const targetMode: TricksterTargetMode =
    (prefs.targetMode === "playerOnly" || prefs.targetMode === "npcOnly")
      ? prefs.targetMode
      : "all";

  const meta: TricksterMeta = {
    name: "",
    radius,
    visible,
    locked,
    targetMode,
    oneShot,
    fired: false,
  };

  let sceneDpi = 150;
  try { sceneDpi = await OBR.scene.grid.getDpi(); } catch {}
  const half = ICON_SIZE / 2;
  const s = (2 * radius) / sceneDpi;
  const img = buildImage(
    {
      width: ICON_SIZE,
      height: ICON_SIZE,
      url: ICON_URL,
      mime: "image/svg+xml",
    },
    { dpi: ICON_SIZE, offset: { x: half, y: half } },
  )
    .position(center)
    .scale({ x: s, y: s })
    .name("捣蛋鬼在哪？")
    .layer("PROP")
    .visible(visible)
    .locked(locked)
    .metadata({ [TRICKSTER_KEY]: meta })
    .build();
  await OBR.scene.items.addItems([img]);
  suppressAutoEditOnce = img.id;
  await openEditPopover(img.id, true);
}

// --- Edit popover ---

async function openEditPopover(tricksterId: string, isNew: boolean) {
  if (editPopoverOpen && currentEditId === tricksterId) return;
  if (editPopoverOpen) await closeEditPopover();
  try {
    const vw = await OBR.viewport.getWidth();
    const url = `${EDIT_URL}?id=${encodeURIComponent(tricksterId)}${isNew ? "&isNew=1" : ""}`;
    await OBR.popover.open({
      id: EDIT_POPOVER_ID,
      url,
      width: EDIT_W,
      height: EDIT_H,
      anchorReference: "POSITION",
      anchorPosition: {
        left: Math.round(vw / 2),
        top: EDIT_TOP_OFFSET,
      },
      anchorOrigin: { horizontal: "CENTER", vertical: "TOP" },
      transformOrigin: { horizontal: "CENTER", vertical: "TOP" },
      hidePaper: true,
      disableClickAway: true,
    });
    editPopoverOpen = true;
    currentEditId = tricksterId;
  } catch (e) {
    console.error("[obr-suite/trickster] openEditPopover failed", e);
  }
}

async function closeEditPopover() {
  try { await OBR.popover.close(EDIT_POPOVER_ID); } catch {}
  editPopoverOpen = false;
  currentEditId = null;
}

async function handleDMSelectionForEdit(selection: string[] | undefined) {
  if (role !== "GM") return;
  if (!selection || selection.length !== 1) {
    if (editPopoverOpen) await closeEditPopover();
    return;
  }
  const id = selection[0];
  if (suppressAutoEditOnce === id) {
    suppressAutoEditOnce = null;
    return;
  }
  let target: Item | null = null;
  try {
    const items = await OBR.scene.items.getItems([id]);
    if (items.length > 0 && isTrickster(items[0])) target = items[0];
  } catch {}
  if (!target) {
    if (editPopoverOpen) await closeEditPopover();
    return;
  }
  if (currentEditId === target.id && editPopoverOpen) return;
  await openEditPopover(target.id, false);
}

// --- Trigger detection ---
//
// On every items.onChange, walk every trickster currently in the
// scene and check if any of its target tokens has TRANSITIONED from
// outside the trigger radius to inside. The transition check uses
// `lastTokenPos` — without it, a token that started inside the zone
// at scene-load would fire on first tick.

/** Sweep every existing trickster item in the scene and rewrite
 *  `image.url` to the current ICON_URL. Needed when we redesign the
 *  on-canvas SVG: existing items still carry the OLD URL (often
 *  without the `?v=N` cache-buster), and OBR keeps rendering the
 *  legacy art for them. Idempotent — items already at ICON_URL skip
 *  the update. Same pattern as `portals.migrateLegacyPortals`. */
async function migrateLegacyTrickster(): Promise<void> {
  try {
    const items = await OBR.scene.items.getItems(isTrickster);
    const stale = items.filter((it: any) => {
      const u = it?.image?.url;
      return typeof u === "string" && u !== ICON_URL;
    });
    if (stale.length === 0) return;
    await OBR.scene.items.updateItems(
      stale.map((it: any) => it.id),
      (drafts: any[]) => {
        for (const d of drafts) {
          if (d.image) d.image.url = ICON_URL;
        }
      },
    );
    console.info("[obr-suite/trickster] migrated", stale.length, "legacy item(s) to current ICON_URL");
  } catch (e) {
    console.warn("[obr-suite/trickster] migration skipped", e);
  }
}

async function maybeFireTrickster(items: Item[]) {
  if (role !== "GM") return; // Only GM commits the time-stop write.

  // Snapshot all trigger candidates from this tick's item array.
  const tricksters = items.filter(isTrickster);
  if (tricksters.length === 0) {
    // Nothing to watch. Still update lastTokenPos so a future
    // trickster placement starts from a clean baseline.
    for (const it of items) {
      if (it.layer !== "CHARACTER" && it.layer !== "MOUNT") continue;
      lastTokenPos.set(it.id, { x: it.position.x, y: it.position.y });
    }
    return;
  }

  let gmUserId = "";
  try { gmUserId = await OBR.player.getId(); } catch {}

  // Cleanup expired fire-cooldowns.
  const now = Date.now();
  for (const [id, t] of recentlyFired) {
    if (now - t > FIRE_COOLDOWN_MS) recentlyFired.delete(id);
  }

  // Two passes: first detect transitions, then fire (and update
  // lastTokenPos on every token so the next tick's diff is accurate
  // regardless of whether the trigger fired).
  type Hit = { trickster: Item; meta: TricksterMeta; token: Item };
  const hits: Hit[] = [];

  for (const tok of items) {
    if (tok.layer !== "CHARACTER" && tok.layer !== "MOUNT") continue;
    if (isTrickster(tok)) continue;

    const prev = lastTokenPos.get(tok.id);
    const cur = { x: tok.position.x, y: tok.position.y };

    if (!prev) {
      // First sighting — seed only, don't fire.
      lastTokenPos.set(tok.id, cur);
      continue;
    }

    // Position unchanged → no transition possible.
    if (prev.x === cur.x && prev.y === cur.y) {
      continue;
    }

    // Position changed: was the token outside any matching
    // trickster on the previous tick AND inside one now? That's
    // the transition.
    for (const trick of tricksters) {
      if (recentlyFired.has(trick.id)) continue;
      const meta = readTricksterMeta(trick);
      if (!meta) continue;
      if (meta.oneShot && meta.fired) continue;
      if (!tokenMatchesTarget(tok, meta, gmUserId)) continue;

      const center = tricksterCenter(trick);
      const wasInside = dist(prev, center) <= meta.radius;
      const nowInside = dist(cur, center) <= meta.radius;
      if (!wasInside && nowInside) {
        hits.push({ trickster: trick, meta, token: tok });
        // Fire-cooldown gate set BEFORE the async fire so a re-tick
        // mid-fire can't double-trigger this same trickster.
        recentlyFired.set(trick.id, now);
        break; // one trickster per token per tick
      }
    }
  }

  // Update position cache for every visible token, regardless of
  // hits. Tokens removed from the scene get cleaned up below.
  const seenIds = new Set<string>();
  for (const tok of items) {
    if (tok.layer !== "CHARACTER" && tok.layer !== "MOUNT") continue;
    seenIds.add(tok.id);
    lastTokenPos.set(tok.id, { x: tok.position.x, y: tok.position.y });
  }
  for (const id of [...lastTokenPos.keys()]) {
    if (!seenIds.has(id)) lastTokenPos.delete(id);
  }

  // Process hits sequentially — the time-stop fire is global, so
  // multiple tricksters firing on the same tick would all just
  // trigger the same overlay. Camera focuses on the FIRST hit's
  // token (subsequent hits that are also entering the same/other
  // tricksters in the same tick get their fire-flag set but we
  // skip the camera double-jump).
  if (hits.length === 0) return;

  for (let i = 0; i < hits.length; i++) {
    const hit = hits[i];
    if (i === 0) await fireTrickster(hit.trickster, hit.meta, hit.token);
    else await flagTricksterFired(hit.trickster, hit.meta);
  }
}

async function fireTrickster(trickster: Item, meta: TricksterMeta, token: Item) {
  // 1. Mark fired so subsequent ticks don't re-trigger (oneShot path).
  await flagTricksterFired(trickster, meta);

  // 2. Time stop — programmatic on, idempotent if already on.
  try { await turnOnTimeStop(); } catch (e) {
    console.warn("[obr-suite/trickster] turnOnTimeStop failed", e);
  }

  // 3. Camera focus on the triggering token.
  try {
    const [vw, vh, vScale] = await Promise.all([
      OBR.viewport.getWidth(),
      OBR.viewport.getHeight(),
      OBR.viewport.getScale(),
    ]);
    const targetPos = {
      x: -token.position.x * vScale + vw / 2,
      y: -token.position.y * vScale + vh / 2,
    };
    OBR.viewport.animateTo({ position: targetPos, scale: vScale }).catch(() => {});
  } catch {}
}

async function flagTricksterFired(trickster: Item, meta: TricksterMeta) {
  if (!meta.oneShot) return; // No flag needed on non-one-shot triggers.
  try {
    await OBR.scene.items.updateItems([trickster.id], (drafts) => {
      for (const d of drafts) {
        const cur = (d.metadata[TRICKSTER_KEY] as TricksterMeta | undefined);
        if (!cur) continue;
        d.metadata[TRICKSTER_KEY] = { ...cur, fired: true };
      }
    });
  } catch (e) {
    console.warn("[obr-suite/trickster] mark-fired failed", e);
  }
}

// --- Setup / teardown ---

export async function setupTrickster(): Promise<void> {
  try { role = (await OBR.player.getRole()) as "GM" | "PLAYER"; } catch {}

  // GM-only sweep — rewrites legacy trickster items (placed before
  // the 2026-05-08 icon redesign) to use the current ICON_URL so OBR
  // re-fetches the new SVG on next render. Fire-and-forget; safe to
  // run before the tool is registered.
  if (role === "GM") {
    void migrateLegacyTrickster();
  }

  if (role === "GM") {
    await OBR.tool.create({
      id: TOOL_ID,
      icons: [
        {
          icon: TOOL_ICON_URL,
          label: "捣蛋鬼在哪？",
          filter: { roles: ["GM"] },
        },
      ],
      onClick: async () => {
        await OBR.tool.activateTool(TOOL_ID);
        return false;
      },
    });

    await OBR.tool.createMode({
      id: TOOL_MODE_ID,
      icons: [
        {
          icon: TOOL_ICON_URL,
          label: "拖动绘制触发区",
          filter: { activeTools: [TOOL_ID] },
        },
      ],
      cursors: [{ cursor: "crosshair" }],
      onToolDragStart: async (_ctx, event) => {
        const target: any = (event as any).target;
        if (target && target.metadata && target.metadata[TRICKSTER_KEY]) {
          // Drag began on an existing trickster — let OBR handle move/select.
          dragStart = null;
          return;
        }
        const p = (event as any).pointerPosition as { x: number; y: number };
        if (!p) return;
        dragStart = { x: p.x, y: p.y };
        await startPreview(p);
      },
      onToolDragMove: async (_ctx, event) => {
        if (!dragStart) return;
        const p = (event as any).pointerPosition as { x: number; y: number };
        if (!p) return;
        const r = dist(dragStart, p);
        await updatePreview(dragStart, r);
      },
      onToolDragEnd: async (_ctx, event) => {
        if (!dragStart) return;
        const p = (event as any).pointerPosition as { x: number; y: number };
        const center = dragStart;
        dragStart = null;
        await clearPreview();
        if (!p) return;
        const radius = dist(center, p);
        if (radius < MIN_RADIUS) return;
        await createTrickster(center, radius);
      },
      onToolDragCancel: async () => {
        dragStart = null;
        await clearPreview();
      },
    });
  }

  // Selection watcher (DM): single trickster selected → edit popover.
  unsubs.push(
    OBR.player.onChange(async (player) => {
      if (role === "GM") {
        try { await handleDMSelectionForEdit(player.selection); } catch {}
      }
    }),
  );

  // Items watcher: fires the trigger detector AND closes the edit popover
  // if the currently-edited trickster gets deleted.
  unsubs.push(
    OBR.scene.items.onChange(async (items) => {
      if (editPopoverOpen && currentEditId) {
        if (!items.find((i) => i.id === currentEditId)) {
          await closeEditPopover();
        }
      }
      await maybeFireTrickster(items);
    }),
  );

  // Edit-popover broadcast handlers — save / delete / close / reset come
  // from trickster-edit-page.ts.
  const BC_SAVE = `${PLUGIN_ID}/edit-save`;
  const BC_DELETE = `${PLUGIN_ID}/edit-delete`;
  const BC_CLOSE = `${PLUGIN_ID}/edit-close`;
  const BC_RESET = `${PLUGIN_ID}/edit-reset`;

  unsubs.push(
    OBR.broadcast.onMessage(BC_SAVE, async (msg) => {
      const data = msg.data as Partial<TricksterMeta> & { id: string } | undefined;
      if (!data || !data.id) return;
      try {
        await OBR.scene.items.updateItems([data.id], (drafts) => {
          for (const d of drafts) {
            const cur = (d.metadata[TRICKSTER_KEY] as TricksterMeta | undefined);
            if (!cur) continue;
            const next: TricksterMeta = {
              ...cur,
              name: typeof data.name === "string" ? data.name : cur.name,
              targetMode: data.targetMode ?? cur.targetMode,
              oneShot: typeof data.oneShot === "boolean" ? data.oneShot : cur.oneShot,
              visible: typeof data.visible === "boolean" ? data.visible : cur.visible,
              locked: typeof data.locked === "boolean" ? data.locked : cur.locked,
              // Save also clears `fired` if the user explicitly re-armed
              // a one-shot via the popover.
              fired: typeof data.fired === "boolean" ? data.fired : cur.fired,
            };
            d.metadata[TRICKSTER_KEY] = next;
            // Persist visible/locked at the item level too so the OBR
            // engine (eye / lock toggles) reflects the value.
            if (typeof next.visible === "boolean") d.visible = next.visible;
            if (typeof next.locked === "boolean") d.locked = next.locked;
          }
        });
      } catch (e) {
        console.error("[obr-suite/trickster] save failed", e);
      }
    }),
  );

  unsubs.push(
    OBR.broadcast.onMessage(BC_DELETE, async (msg) => {
      const data = msg.data as { id: string } | undefined;
      if (!data) return;
      try { await OBR.scene.items.deleteItems([data.id]); } catch {}
      await closeEditPopover();
    }),
  );

  unsubs.push(
    OBR.broadcast.onMessage(BC_CLOSE, async () => {
      await closeEditPopover();
    }),
  );

  unsubs.push(
    OBR.broadcast.onMessage(BC_RESET, async (msg) => {
      const data = msg.data as { id: string } | undefined;
      if (!data) return;
      try {
        await OBR.scene.items.updateItems([data.id], (drafts) => {
          for (const d of drafts) {
            const cur = (d.metadata[TRICKSTER_KEY] as TricksterMeta | undefined);
            if (!cur) continue;
            d.metadata[TRICKSTER_KEY] = { ...cur, fired: false };
          }
        });
      } catch (e) {
        console.warn("[obr-suite/trickster] reset failed", e);
      }
    }),
  );
}

export async function teardownTrickster(): Promise<void> {
  await closeEditPopover();
  await clearPreview();
  if (role === "GM") {
    try { await OBR.tool.removeMode(TOOL_MODE_ID); } catch {}
    try { await OBR.tool.remove(TOOL_ID); } catch {}
  }
  for (const u of unsubs.splice(0)) u();
  lastTokenPos.clear();
  recentlyFired.clear();
}
