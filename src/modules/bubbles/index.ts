import OBR, { buildLabel, buildShape, Item } from "@owlbear-rodeo/sdk";

// Bubbles module — renders HP / temp-HP / AC indicators on tokens.
//
// Visual layout follows the canonical OBR token-stat convention
// confirmed in the upstream README:
//
//   • HP HEALTH BAR at the BOTTOM of the token, full width,
//     straddling the bottom edge (≈50% above, ≈50% below).
//     Composed of a dark background rectangle, a color-ramped fill
//     rectangle whose width = current/max ratio, and a centered
//     text overlay showing "current/max" (with a "+temp" suffix
//     when temp HP is non-zero).
//   • AC BUBBLE — a small navy circle at the TOP-RIGHT corner of
//     the token, with the AC value inside.
//
// Data-shape compatibility with the standalone Bubbles plugin's
// metadata key is preserved so existing scenes keep their values:
//
//   tok.metadata["com.owlbear-rodeo-bubbles-extension/metadata"] =
//     { health, "max health", "temporary health", "armor class", hide }
//
// All rendering is local-only (OBR.scene.local) and attached to the
// parent token. POSITION inheritance auto-follows drag / teleport;
// SCALE inheritance is DISABLED because we already factor the
// token's own scale into our size math (otherwise it gets
// double-applied). On any token signature change (scale or
// image-size) the diff loop rebuilds that token's items so the
// layout stays consistent.

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

// HP color ramp.
function hpColor(ratio: number): string {
  if (ratio > 0.6) return "#5bd96a"; // healthy green
  if (ratio > 0.3) return "#f5a623"; // bloodied orange
  return "#e74c3c";                  // critical red
}

const AC_BG = "#1f2230";
const AC_BORDER = "#5dade2";
const BAR_BG = "#0a0c14";
const BAR_BORDER = "#5dade2";
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
let pendingTimer: ReturnType<typeof setTimeout> | null = null;
let queuedSync = false;

function scheduleSync(): void {
  if (pendingTimer) return;
  pendingTimer = setTimeout(() => {
    pendingTimer = null;
    syncBubbles().catch((e) => console.warn("[obr-suite/bubbles] sync failed", e));
  }, 60);
}

// --- Item construction ----------------------------------------------------

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

const COMMON_ATTACH_DISABLES: ("ROTATION" | "SCALE" | "LOCKED")[] = [
  "ROTATION", // bubble stays upright when token spins
  "SCALE",    // we factor token scale into widths manually; OBR
              // doubling on top would be wrong for our math
  "LOCKED",   // we set our own .locked() so don't inherit parent
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

  // -------- HP bar (3 items: bg, fill, text overlay) --------
  if (showHp) {
    // Bar dimensions scale with the token's actual rendered width
    // so the bar always spans most of the token's footprint.
    const barW = g.width * 0.92 * userScale;
    const barH = Math.max(14, g.width * 0.13 * userScale);
    const barLeft = g.cx - barW / 2;
    const barTop = g.bottom - barH / 2; // straddles the bottom edge

    // Background (dark rectangle).
    const bg = buildShape()
      .shapeType("RECTANGLE")
      .width(barW)
      .height(barH)
      .fillColor(BAR_BG)
      .fillOpacity(0.92)
      .strokeColor(BAR_BORDER)
      .strokeOpacity(0.55)
      .strokeWidth(1.5)
      .position({ x: barLeft, y: barTop })
      .layer("ATTACHMENT")
      .attachedTo(tok.id)
      .locked(true)
      .disableHit(true)
      .visible(true)
      .disableAutoZIndex(true)
      .zIndex(100)
      .disableAttachmentBehavior(COMMON_ATTACH_DISABLES)
      .metadata({ [BUBBLE_OWNER_KEY]: tok.id })
      .build();
    items.push(bg);
    ids.push(bg.id);

    // Fill (color-ramped rectangle, width = ratio).
    const ratio = Math.max(0, Math.min(1, data.hp / data.maxHp));
    if (ratio > 0) {
      const inset = 1.5;
      const fillW = (barW - 2 * inset) * ratio;
      const fillH = barH - 2 * inset;
      const fill = buildShape()
        .shapeType("RECTANGLE")
        .width(fillW)
        .height(fillH)
        .fillColor(hpColor(ratio))
        .fillOpacity(0.95)
        .strokeOpacity(0)
        .strokeWidth(0)
        .position({ x: barLeft + inset, y: barTop + inset })
        .layer("ATTACHMENT")
        .attachedTo(tok.id)
        .locked(true)
        .disableHit(true)
        .visible(true)
        .disableAutoZIndex(true)
        .zIndex(101)
        .disableAttachmentBehavior(COMMON_ATTACH_DISABLES)
        .metadata({ [BUBBLE_OWNER_KEY]: tok.id })
        .build();
      items.push(fill);
      ids.push(fill.id);
    }

    // Text overlay — current/max with optional "+temp" suffix.
    const hpText = `${data.hp}/${data.maxHp}${showTemp ? ` +${data.tempHp}` : ""}`;
    const fontSize = Math.max(10, barH * 0.62);
    const text = buildLabel()
      .plainText(hpText)
      .width(barW)
      .height(barH)
      .padding(0)
      .fontSize(fontSize)
      .fontWeight(800)
      .textAlign("CENTER")
      .textAlignVertical("MIDDLE")
      .fillColor(TEXT_COLOR)
      .fillOpacity(1)
      .strokeColor(TEXT_HALO)
      .strokeOpacity(0.7)
      .strokeWidth(1.6)
      .backgroundColor("#000000")
      .backgroundOpacity(0)        // transparent — bg comes from the Shape underneath
      .cornerRadius(0)
      .position({ x: barLeft, y: barTop })
      .layer("ATTACHMENT")
      .attachedTo(tok.id)
      .locked(true)
      .disableHit(true)
      .visible(true)
      .disableAutoZIndex(true)
      .zIndex(102)
      .disableAttachmentBehavior(COMMON_ATTACH_DISABLES)
      .metadata({ [BUBBLE_OWNER_KEY]: tok.id })
      .build();
    items.push(text);
    ids.push(text.id);
  }

  // -------- AC bubble (1 circular label at the top-right corner) --------
  if (showAc) {
    const diameter = Math.max(30, g.width * 0.32 * userScale);
    // Center of the circle sits exactly on the top-right corner of
    // the token — half inside, half peeking outside diagonally.
    const acLeft = g.right - diameter / 2;
    const acTop = g.top - diameter / 2;
    const acFontSize = Math.max(11, diameter * 0.46);

    const acLabel = buildLabel()
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
      .backgroundOpacity(0.95)
      .cornerRadius(diameter / 2) // full circle
      .position({ x: acLeft, y: acTop })
      .layer("ATTACHMENT")
      .attachedTo(tok.id)
      .locked(true)
      .disableHit(true)
      .visible(true)
      .disableAutoZIndex(true)
      .zIndex(105)
      .disableAttachmentBehavior(COMMON_ATTACH_DISABLES)
      .metadata({
        [BUBBLE_OWNER_KEY]: tok.id,
        // Stroke the label like a shield outline by overlaying a
        // tinted border via strokeColor on its background — Label's
        // background draw includes its strokeColor when strokeWidth
        // > 0. We use AC_BORDER cyan for the suite-themed accent.
        [`${PLUGIN_ID}/role`]: "ac",
      })
      .build();
    // Apply the cyan border via the underlying style fields exposed
    // by the builder. (LabelBuilder supports strokeColor for the
    // text — the BACKGROUND stroke is part of LabelStyle's default
    // border which draws around the rounded background. Setting
    // stroke* on Label affects the TEXT stroke; for the background
    // border we leave it default — most OBR clients render a faint
    // 1-px border on labels which reads as the bubble outline.)
    items.push(acLabel);
    ids.push(acLabel.id);
    void AC_BORDER;
  }

  return { items, ids };
}

// --- Sync loop ------------------------------------------------------------

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

    // Drop bubbles for tokens that lost data or were deleted.
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

    // Rebuild tokens whose data hash or token signature changed.
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

// --- Public helper for other modules to write bubble data -----------------
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
