import OBR, { buildLabel, Item } from "@owlbear-rodeo/sdk";

// Bubbles module — renders HP / temp-HP / AC info on tokens.
//
// Visual: two indicators per token, both rendered as native OBR
// Label primitives:
//   • HP capsule along the BOTTOM EDGE of the token, color-ramped
//     by the current/max ratio, showing "current/max" (with a
//     "+temp" suffix when temp HP > 0)
//   • AC circle at the TOP-RIGHT CORNER of the token, navy
//     background, showing the AC value
//
// Both labels use `minViewScale(1).maxViewScale(1)` so they stay
// at a constant ON-SCREEN size regardless of camera zoom — the
// canonical "stat indicator" behavior. Without these, OBR labels
// scale 1:1 with the camera, which feels backwards (zoom in =
// bubbles overpower the token, zoom out = bubbles vanish).
//
// SCALE attachment-inheritance is DISABLED so the token's own
// scale doesn't get double-applied — we already factor it into
// width / height math from `image.width / image.dpi * sceneDpi *
// scale`, and OBR doubling on top of that would over-scale
// 2-cell tokens. POSITION inheritance stays ON so the bubble
// auto-follows drag / teleport.
//
// Data-shape compatibility: we read and write the same metadata
// key namespace the standalone Bubbles extension uses, so scenes
// previously using it migrate transparently.
//
//   tok.metadata["com.owlbear-rodeo-bubbles-extension/metadata"] =
//     { health, "max health", "temporary health", "armor class", hide }
//
// Per-client toggles (localStorage):
//   com.obr-suite/bubbles/enabled  ("0" / "1" — default 1)
//   com.obr-suite/bubbles/scale    (0.6×–2× user knob, default 1)

const PLUGIN_ID = "com.obr-suite/bubbles";
const BUBBLE_OWNER_KEY = `${PLUGIN_ID}/owner`;

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

interface BubbleEntry {
  ids: string[];
  hash: string;
  tokSig: string;
}
const entries = new Map<string, BubbleEntry>();

function tokenSignature(tok: Item): string {
  const a = tok as any;
  return `${a.image?.width ?? "_"}|${a.image?.height ?? "_"}|${a.image?.dpi ?? "_"}|${tok.scale?.x ?? 1}|${tok.scale?.y ?? 1}|${tok.position.x}|${tok.position.y}|${tok.visible ? 1 : 0}`;
}

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

const COMMON_DISABLES: ("ROTATION" | "SCALE" | "LOCKED")[] = [
  "ROTATION", // bubble stays upright when token spins
  "SCALE",    // we factor token scale into widths manually
  "LOCKED",   // honor our own .locked() regardless of parent
];

function makeItems(
  tok: Item,
  data: BubbleData,
  sceneDpi: number,
  userScale: number,
): { items: any[]; ids: string[] } {
  const showHp = data.maxHp > 0;
  const showAc = data.ac != null;
  const showTemp = data.tempHp > 0 && showHp;
  if (!showHp && !showAc) return { items: [], ids: [] };

  const g = tokenGeom(tok, sceneDpi);
  const items: any[] = [];
  const ids: string[] = [];

  // -------- HP capsule along the bottom edge --------
  if (showHp) {
    const barW = g.width * 0.92 * userScale;
    const barH = Math.max(16, g.width * 0.16 * userScale);
    const barLeft = g.cx - barW / 2;
    const barTop = g.bottom - barH / 2; // straddles bottom edge
    const ratio = Math.max(0, Math.min(1, data.hp / data.maxHp));
    const hpText = `${data.hp}/${data.maxHp}${showTemp ? ` +${data.tempHp}` : ""}`;
    const fontSize = Math.max(11, barH * 0.58);

    const hp = buildLabel()
      .plainText(hpText)
      .width(barW)
      .height(barH)
      .padding(2)
      .fontSize(fontSize)
      .fontWeight(800)
      .textAlign("CENTER")
      .textAlignVertical("MIDDLE")
      .fillColor(TEXT_COLOR)
      .fillOpacity(1)
      .strokeColor(TEXT_HALO)
      .strokeOpacity(0.7)
      .strokeWidth(1.5)
      .backgroundColor(hpColor(ratio))
      .backgroundOpacity(0.95)
      .cornerRadius(barH / 2)            // capsule ends
      .minViewScale(1)                   // ┐ clamp the camera-zoom
      .maxViewScale(1)                   // ┘ → constant on-screen size
      .position({ x: barLeft, y: barTop })
      .layer("ATTACHMENT")
      .attachedTo(tok.id)
      .locked(true)
      .disableHit(true)
      .visible(true)
      .disableAutoZIndex(true)
      .zIndex(100)
      .disableAttachmentBehavior(COMMON_DISABLES)
      .metadata({ [BUBBLE_OWNER_KEY]: tok.id })
      .build();
    items.push(hp);
    ids.push(hp.id);
  }

  // -------- AC circle at the top-right corner --------
  if (showAc) {
    const diameter = Math.max(30, g.width * 0.34 * userScale);
    // Center of the circle sits on the token's top-right corner —
    // half inside, half peeking diagonally outward.
    const acLeft = g.right - diameter / 2;
    const acTop = g.top - diameter / 2;
    const acFontSize = Math.max(12, diameter * 0.48);

    const ac = buildLabel()
      .plainText(`${data.ac}`)
      .width(diameter)
      .height(diameter)
      .padding(2)
      .fontSize(acFontSize)
      .fontWeight(800)
      .textAlign("CENTER")
      .textAlignVertical("MIDDLE")
      .fillColor(TEXT_COLOR)
      .fillOpacity(1)
      .strokeColor(TEXT_HALO)
      .strokeOpacity(0.7)
      .strokeWidth(1.5)
      .backgroundColor(AC_BG)
      .backgroundOpacity(0.96)
      .cornerRadius(diameter / 2)        // full circle
      .minViewScale(1)
      .maxViewScale(1)
      .position({ x: acLeft, y: acTop })
      .layer("ATTACHMENT")
      .attachedTo(tok.id)
      .locked(true)
      .disableHit(true)
      .visible(true)
      .disableAutoZIndex(true)
      .zIndex(105)
      .disableAttachmentBehavior(COMMON_DISABLES)
      .metadata({ [BUBBLE_OWNER_KEY]: tok.id })
      .build();
    items.push(ac);
    ids.push(ac.id);
  }

  return { items, ids };
}

// --- Sync ----------------------------------------------------------------

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
    const userScale = readUserScale();

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

    const desired = new Map<string, BubbleData>();
    for (const [id, tok] of tokenById) {
      const d = readBubbleData(tok);
      if (!d) continue;
      if (d.hide && role !== "GM") continue;
      desired.set(id, d);
    }

    const orphanItemIds: string[] = [];
    for (const [tokId, entry] of entries) {
      if (!desired.has(tokId) || !tokenById.has(tokId)) {
        orphanItemIds.push(...entry.ids);
        entries.delete(tokId);
      }
    }
    if (orphanItemIds.length > 0) {
      await OBR.scene.local.deleteItems(orphanItemIds).catch((e) => {
        console.warn("[obr-suite/bubbles] delete orphans failed", e);
      });
    }

    const rebuildIds: string[] = [];
    const toAdd: any[] = [];
    const newEntries = new Map<string, BubbleEntry>();

    for (const [tokId, data] of desired) {
      const tok = tokenById.get(tokId)!;
      const hash = dataHash(data);
      const sig = tokenSignature(tok);
      const existing = entries.get(tokId);
      if (existing && existing.hash === hash && existing.tokSig === sig) {
        newEntries.set(tokId, existing);
        continue;
      }
      if (existing) rebuildIds.push(...existing.ids);
      const built = makeItems(tok, data, sceneDpi, userScale);
      if (built.items.length === 0) continue;
      toAdd.push(...built.items);
      newEntries.set(tokId, { ids: built.ids, hash, tokSig: sig });
    }

    entries.clear();
    for (const [k, v] of newEntries) entries.set(k, v);

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

    if (toAdd.length > 0 || orphanItemIds.length > 0 || rebuildIds.length > 0) {
      console.log(
        "%c[obr-suite/bubbles] sync",
        "background:#5dade2;color:#fff;padding:1px 5px;border-radius:3px",
        {
          tokensWithData: desired.size,
          itemsAdded: toAdd.length,
          itemsRebuilt: rebuildIds.length,
          orphans: orphanItemIds.length,
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
  for (const e of entries.values()) ids.push(...e.ids);
  entries.clear();
  if (ids.length > 0) {
    await OBR.scene.local.deleteItems(ids).catch(() => {});
  }
}

// --- Module lifecycle ----------------------------------------------------

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
