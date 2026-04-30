import OBR, { buildLabel, Item } from "@owlbear-rodeo/sdk";

// Bubbles — small HP / temp-HP / AC indicators rendered above each
// CHARACTER / MOUNT token that carries the standalone Bubbles
// extension's metadata key (kept for data interop with existing
// scenes):
//
//   tok.metadata["com.owlbear-rodeo-bubbles-extension/metadata"] =
//     { health, "max health", "temporary health", "armor class", hide }
//
// All rendering uses native OBR `buildLabel()` items in the local
// scene (OBR.scene.local — per-client, no network sync). Two
// labels per token: HP capsule below the bottom edge, AC circle
// at the top-right. Both updated by polling scene.items via
// onChange + a 60 ms debounce.
//
// IMPORTANT QUIRKS NAILED DOWN BY EARLIER ROUNDS, NOW HANDLED:
//   • OBR Label defaults — `pointerDirection: "DOWN"` with a 4×4
//     speech-bubble tail. Position anchors at the pointer TIP
//     (bottom-center of the overall shape). We disable the
//     pointer (pointerWidth=0, pointerHeight=0) and treat
//     position as the label's BOTTOM-CENTER — body extends
//     up + left + right from there.
//   • `attachedTo` was unreliable for our use case — relative-
//     vs-absolute position semantics weren't predictable across
//     scale changes, and the user reported labels landing at
//     wildly off coordinates. Replaced with explicit world
//     positions reconciled on every items.onChange. That makes
//     drag follow O(updateItems-per-onChange-tick) but
//     OBR.scene.local is fast enough.
//   • No `minViewScale` / `maxViewScale` — let the labels scale
//     with the camera the way every other scene item does. The
//     user reported "reversed scaling" with the clamp, presumably
//     because Shape primitives scale 1:1 with the camera while
//     Labels with min/maxViewScale don't, and the mismatch read
//     as wrong. All-labels-no-clamp keeps everything consistent.

const PLUGIN_ID = "com.obr-suite/bubbles";
const BUBBLE_OWNER_KEY = `${PLUGIN_ID}/owner`;
const BUBBLE_ROLE_KEY = `${PLUGIN_ID}/role`;

export const LS_BUBBLES_ENABLED = `${PLUGIN_ID}/enabled`;
export const LS_BUBBLES_SCALE = `${PLUGIN_ID}/scale`;

export const BUBBLES_META = "com.owlbear-rodeo-bubbles-extension/metadata";
const BUBBLES_NAME = "com.owlbear-rodeo-bubbles-extension/name";

interface BubbleData {
  hp: number;
  maxHp: number;
  tempHp: number;
  ac: number | null;
  hide: boolean;
}

function readBubbleData(item: Item): BubbleData | null {
  const m = (item.metadata as any)?.[BUBBLES_META];
  if (!m || typeof m !== "object") return null;
  const hpRaw = Number(m["health"]);
  const maxRaw = Number(m["max health"]);
  const tempRaw = Number(m["temporary health"]);
  const acRaw = m["armor class"];
  const hasHp = Number.isFinite(maxRaw) && maxRaw > 0;
  const hasAc = acRaw != null && Number.isFinite(Number(acRaw));
  if (!hasHp && !hasAc) return null;
  return {
    hp: Number.isFinite(hpRaw)
      ? Math.max(0, Math.min(hpRaw, hasHp ? maxRaw : hpRaw))
      : (hasHp ? maxRaw : 0),
    maxHp: hasHp ? maxRaw : 0,
    tempHp: Number.isFinite(tempRaw) && tempRaw > 0 ? Math.floor(tempRaw) : 0,
    ac: hasAc ? Number(acRaw) : null,
    hide: !!m["hide"],
  };
}

function dataHash(d: BubbleData): string {
  return `${d.hp}|${d.maxHp}|${d.tempHp}|${d.ac == null ? "_" : d.ac}|${d.hide ? 1 : 0}`;
}

function hpColor(ratio: number): string {
  if (ratio > 0.6) return "#5bd96a";
  if (ratio > 0.3) return "#f5a623";
  return "#e74c3c";
}

const AC_BG = "#1f2230";
const TEXT_COLOR = "#ffffff";
const TEXT_HALO = "#000000";

// Sizes are in SCENE-PIXEL units (the same coordinate system as
// `tok.position`). At a typical sceneDpi of 150, 1 grid cell =
// 150 scene-pixels, so an HP bar 70×18 occupies ≈ 47% × 12% of a
// 1-cell token. Deliberately small — easier to scale up than down.
const HP_W = 70;
const HP_H = 18;
const AC_W = 26;
const AC_H = 22;

// Gap between the bubble and the token edge (overlap into the
// token by this much, so bubbles look "stuck" rather than
// floating outside).
const HP_OVERLAP = 4;
const AC_OVERLAP = 4;

interface BubbleEntry {
  hpId: string | null;
  acId: string | null;
  hash: string;       // matches dataHash for content
  posKey: string;     // matches the position key for placement
}
const entries = new Map<string, BubbleEntry>();

interface TokenGeom {
  cx: number; cy: number;
  width: number; height: number;
  left: number; right: number; top: number; bottom: number;
}
function tokenGeom(tok: Item, sceneDpi: number): TokenGeom {
  const a = tok as any;
  const imgW = a.image?.width ?? sceneDpi;
  const imgH = a.image?.height ?? sceneDpi;
  const imgDpi = a.image?.dpi ?? sceneDpi;
  const sx = Math.abs(tok.scale?.x ?? 1);
  const sy = Math.abs(tok.scale?.y ?? 1);
  const width = (imgW / imgDpi) * sceneDpi * sx;
  const height = (imgH / imgDpi) * sceneDpi * sy;
  const cx = tok.position.x;
  const cy = tok.position.y;
  return {
    cx, cy, width, height,
    left: cx - width / 2,
    right: cx + width / 2,
    top: cy - height / 2,
    bottom: cy + height / 2,
  };
}

function positionKey(g: TokenGeom): string {
  return `${g.cx}|${g.cy}|${g.width}|${g.height}`;
}

function readEnabled(): boolean {
  try {
    const v = localStorage.getItem(LS_BUBBLES_ENABLED);
    if (v === "0") return false;
    if (v === "1") return true;
  } catch {}
  return true;
}

function readUserScale(): number {
  try {
    const v = localStorage.getItem(LS_BUBBLES_SCALE);
    if (v) {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0.3 && n < 3) return n;
    }
  } catch {}
  return 1;
}

let role: "GM" | "PLAYER" = "PLAYER";
let unsubs: Array<() => void> = [];
let inSync = false;
let queuedSync = false;
let pendingTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleSync(): void {
  if (pendingTimer) return;
  pendingTimer = setTimeout(() => {
    pendingTimer = null;
    syncBubbles().catch((e) => console.warn("[obr-suite/bubbles] sync failed", e));
  }, 60);
}

// --- Position math --------------------------------------------------------
//
// With OBR's Label defaults left in place (pointerDirection "DOWN",
// pointer disabled via width/height = 0), the `position` field
// anchors at the BOTTOM-CENTER of the label. Body extends UP from
// there: from (position.x − W/2, position.y − H) to
// (position.x + W/2, position.y).

function hpPosition(g: TokenGeom, u: number): { x: number; y: number } {
  // We want the HP capsule body to straddle the token's bottom
  // edge — most of it BELOW the token, a small `HP_OVERLAP`
  // bite into the token's lower edge.
  // body bottom y = token.bottom + (H - HP_OVERLAP)
  // → position.y = body bottom y (because pointer-tip-bottom anchor)
  const h = HP_H * u;
  return {
    x: g.cx,
    y: g.bottom + (h - HP_OVERLAP * u),
  };
}

function acPosition(g: TokenGeom, u: number): { x: number; y: number } {
  // AC circle straddles the token's top-right corner — most of
  // it OUTSIDE the corner, a small `AC_OVERLAP` bite back in.
  // Want body's CENTER ~at the corner, i.e. (token.right, token.top).
  // body bottom y = body center y + H/2
  //               = token.top + AC_OVERLAP + H/2
  // body center x = token.right − AC_OVERLAP
  const h = AC_H * u;
  return {
    x: g.right - AC_OVERLAP * u,
    y: g.top + AC_OVERLAP * u + h / 2,
  };
}

// --- Item construction ----------------------------------------------------

function buildHpLabel(tokenId: string, data: BubbleData, pos: { x: number; y: number }, u: number): any {
  const w = HP_W * u;
  const h = HP_H * u;
  const ratio = Math.max(0, Math.min(1, data.hp / data.maxHp));
  const text = `${data.hp}/${data.maxHp}${data.tempHp > 0 ? ` +${data.tempHp}` : ""}`;
  return buildLabel()
    .plainText(text)
    .width(w)
    .height(h)
    .padding(2)
    .fontSize(Math.max(11, h * 0.6))
    .fontWeight(700)
    .textAlign("CENTER")
    .textAlignVertical("MIDDLE")
    .fillColor(TEXT_COLOR)
    .fillOpacity(1)
    .strokeColor(TEXT_HALO)
    .strokeOpacity(0.7)
    .strokeWidth(1.2)
    .backgroundColor(hpColor(ratio))
    .backgroundOpacity(0.95)
    .cornerRadius(h / 2)
    .pointerWidth(0)
    .pointerHeight(0)
    .position(pos)
    .layer("TEXT")
    .locked(true)
    .disableHit(true)
    .visible(true)
    .disableAutoZIndex(true)
    .zIndex(100)
    .metadata({ [BUBBLE_OWNER_KEY]: tokenId, [BUBBLE_ROLE_KEY]: "hp" })
    .build();
}

function buildAcLabel(tokenId: string, data: BubbleData, pos: { x: number; y: number }, u: number): any {
  const w = AC_W * u;
  const h = AC_H * u;
  return buildLabel()
    .plainText(`${data.ac}`)
    .width(w)
    .height(h)
    .padding(2)
    .fontSize(Math.max(11, h * 0.55))
    .fontWeight(800)
    .textAlign("CENTER")
    .textAlignVertical("MIDDLE")
    .fillColor(TEXT_COLOR)
    .fillOpacity(1)
    .strokeColor(TEXT_HALO)
    .strokeOpacity(0.7)
    .strokeWidth(1.2)
    .backgroundColor(AC_BG)
    .backgroundOpacity(0.96)
    .cornerRadius(Math.min(w, h) / 2)
    .pointerWidth(0)
    .pointerHeight(0)
    .position(pos)
    .layer("TEXT")
    .locked(true)
    .disableHit(true)
    .visible(true)
    .disableAutoZIndex(true)
    .zIndex(101)
    .metadata({ [BUBBLE_OWNER_KEY]: tokenId, [BUBBLE_ROLE_KEY]: "ac" })
    .build();
}

// --- Sync -----------------------------------------------------------------

async function syncBubbles(): Promise<void> {
  if (inSync) {
    queuedSync = true;
    return;
  }
  inSync = true;
  try {
    if (!readEnabled()) {
      await clearAll();
      return;
    }
    const u = readUserScale();

    let items: Item[];
    try { items = await OBR.scene.items.getItems(); }
    catch (e) {
      console.warn("[obr-suite/bubbles] getItems failed", e);
      return;
    }

    let sceneDpi = 150;
    try { sceneDpi = await OBR.scene.grid.getDpi(); } catch {}

    const tokenById = new Map<string, Item>();
    for (const it of items) {
      if (it.layer === "CHARACTER" || it.layer === "MOUNT") {
        tokenById.set(it.id, it);
      }
    }

    // What we WANT to render right now.
    interface Wanted {
      data: BubbleData;
      g: TokenGeom;
      hash: string;
      posKey: string;
    }
    const wanted = new Map<string, Wanted>();
    for (const [id, tok] of tokenById) {
      const d = readBubbleData(tok);
      if (!d) continue;
      if (d.hide && role !== "GM") continue;
      const g = tokenGeom(tok, sceneDpi);
      wanted.set(id, {
        data: d,
        g,
        hash: dataHash(d),
        posKey: positionKey(g),
      });
    }

    // Phase 1 — drop bubbles for tokens that are gone or hidden
    // from this client.
    const orphanIds: string[] = [];
    for (const [tokId, entry] of entries) {
      if (!wanted.has(tokId)) {
        if (entry.hpId) orphanIds.push(entry.hpId);
        if (entry.acId) orphanIds.push(entry.acId);
        entries.delete(tokId);
      }
    }
    if (orphanIds.length > 0) {
      await OBR.scene.local.deleteItems(orphanIds).catch((e) => {
        console.warn("[obr-suite/bubbles] delete orphans failed", e);
      });
    }

    // Phase 2 — for each wanted bubble, decide: keep / update
    // (cheap position move) / rebuild (data changed → background
    // color or text shifts).
    const toAdd: any[] = [];
    const positionUpdates: Array<{ id: string; pos: { x: number; y: number } }> = [];
    const rebuildIds: string[] = [];

    for (const [tokId, w] of wanted) {
      const showHp = w.data.maxHp > 0;
      const showAc = w.data.ac != null;
      const existing = entries.get(tokId);

      // Same data + same geometry → nothing to do.
      if (existing && existing.hash === w.hash && existing.posKey === w.posKey) {
        continue;
      }

      // Data hash changed → rebuild from scratch (background
      // color, text content, and pill shape may all shift). Also
      // rebuild if the pill should appear / disappear.
      const dataChanged = !existing || existing.hash !== w.hash;
      const hpShouldExist = showHp;
      const acShouldExist = showAc;
      const hpExists = !!existing?.hpId;
      const acExists = !!existing?.acId;

      if (dataChanged || hpExists !== hpShouldExist || acExists !== acShouldExist) {
        if (existing?.hpId) rebuildIds.push(existing.hpId);
        if (existing?.acId) rebuildIds.push(existing.acId);

        let hpId: string | null = null;
        let acId: string | null = null;
        if (hpShouldExist) {
          const item = buildHpLabel(tokId, w.data, hpPosition(w.g, u), u);
          toAdd.push(item);
          hpId = item.id;
        }
        if (acShouldExist) {
          const item = buildAcLabel(tokId, w.data, acPosition(w.g, u), u);
          toAdd.push(item);
          acId = item.id;
        }
        entries.set(tokId, { hpId, acId, hash: w.hash, posKey: w.posKey });
        continue;
      }

      // Only position changed (token moved, or scale changed) —
      // patch the existing labels in-place. Smooth follow on drag.
      if (existing.hpId) {
        positionUpdates.push({ id: existing.hpId, pos: hpPosition(w.g, u) });
      }
      if (existing.acId) {
        positionUpdates.push({ id: existing.acId, pos: acPosition(w.g, u) });
      }
      existing.posKey = w.posKey;
    }

    if (rebuildIds.length > 0) {
      await OBR.scene.local.deleteItems(rebuildIds).catch((e) => {
        console.warn("[obr-suite/bubbles] delete-for-rebuild failed", e);
      });
    }
    if (toAdd.length > 0) {
      await OBR.scene.local.addItems(toAdd).catch((e) => {
        console.warn("[obr-suite/bubbles] addItems failed", e);
      });
    }
    if (positionUpdates.length > 0) {
      const ids = positionUpdates.map((p) => p.id);
      await OBR.scene.local.updateItems(ids, (drafts) => {
        for (const d of drafts) {
          const u = positionUpdates.find((p) => p.id === d.id);
          if (u) (d as any).position = u.pos;
        }
      }, true).catch((e) => {
        console.warn("[obr-suite/bubbles] position update failed", e);
      });
    }

    if (toAdd.length || rebuildIds.length || orphanIds.length) {
      console.log(
        "%c[obr-suite/bubbles] sync",
        "background:#5dade2;color:#fff;padding:1px 5px;border-radius:3px",
        {
          tokensWithData: wanted.size,
          itemsAdded: toAdd.length,
          itemsRebuilt: rebuildIds.length,
          orphans: orphanIds.length,
          positionUpdates: positionUpdates.length,
          totalTokens: entries.size,
        },
      );
    }
  } finally {
    inSync = false;
    if (queuedSync) {
      queuedSync = false;
      scheduleSync();
    }
  }
}

async function clearAll(): Promise<void> {
  const ids: string[] = [];
  for (const e of entries.values()) {
    if (e.hpId) ids.push(e.hpId);
    if (e.acId) ids.push(e.acId);
  }
  entries.clear();
  if (ids.length > 0) {
    await OBR.scene.local.deleteItems(ids).catch(() => {});
  }
}

// --- Module lifecycle -----------------------------------------------------

export async function setupBubbles(): Promise<void> {
  try { role = (await OBR.player.getRole()) as "GM" | "PLAYER"; } catch {}

  console.log(
    "%c[obr-suite/bubbles] setup",
    "background:#9a6cf2;color:#fff;padding:2px 6px;font-weight:bold;border-radius:3px",
    { role, enabled: readEnabled(), scale: readUserScale() },
  );

  unsubs.push(
    OBR.scene.items.onChange(() => scheduleSync()),
  );

  const onStorage = (e: StorageEvent) => {
    if (e.key === LS_BUBBLES_ENABLED || e.key === LS_BUBBLES_SCALE) {
      void clearAll().then(() => syncBubbles().catch(() => {}));
    }
  };
  window.addEventListener("storage", onStorage);
  unsubs.push(() => window.removeEventListener("storage", onStorage));

  void syncBubbles();
}

export async function teardownBubbles(): Promise<void> {
  for (const u of unsubs.splice(0)) u();
  if (pendingTimer) {
    clearTimeout(pendingTimer);
    pendingTimer = null;
  }
  await clearAll();
}

// --- Public helper for other modules to write bubble data ---------------
export async function writeBubbleStats(
  tokenId: string,
  patch: { hp?: number; maxHp?: number; tempHp?: number; ac?: number | null; hide?: boolean; name?: string },
): Promise<void> {
  try {
    await OBR.scene.items.updateItems([tokenId], (drafts) => {
      for (const d of drafts) {
        const cur = ((d.metadata as any)[BUBBLES_META] as Record<string, unknown> | undefined) ?? {};
        const next: Record<string, unknown> = { ...cur };
        if (patch.hp != null) next["health"] = Math.max(0, Math.floor(patch.hp));
        if (patch.maxHp != null) next["max health"] = Math.max(0, Math.floor(patch.maxHp));
        if (patch.tempHp != null) next["temporary health"] = Math.max(0, Math.floor(patch.tempHp));
        if (patch.ac !== undefined) {
          if (patch.ac == null) delete next["armor class"];
          else next["armor class"] = Math.floor(patch.ac);
        }
        if (patch.hide != null) next["hide"] = !!patch.hide;
        const mx = Number(next["max health"]);
        const cur2 = Number(next["health"]);
        if (Number.isFinite(mx) && mx > 0 && Number.isFinite(cur2)) {
          next["health"] = Math.max(0, Math.min(cur2, mx));
        }
        (d.metadata as any)[BUBBLES_META] = next;
        if (patch.name != null) (d.metadata as any)[BUBBLES_NAME] = patch.name;
      }
    });
  } catch (e) {
    console.warn("[obr-suite/bubbles] writeBubbleStats failed", e);
  }
}

export function readBubbleStatsForToken(item: Item): BubbleData | null {
  return readBubbleData(item);
}
