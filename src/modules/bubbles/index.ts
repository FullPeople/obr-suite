import OBR, { buildLabel, Item } from "@owlbear-rodeo/sdk";

// Bubbles module — renders compact HP / AC / Temp-HP info above each
// token that carries a `com.owlbear-rodeo-bubbles-extension/metadata`
// payload. Data-shape compatible with that namespace key so scenes
// previously using the standalone Bubbles extension keep their
// values.
//
// Implementation:
//   - native OBR Label primitives (one per stat, attached to the
//     token). Earlier rounds tried an inline-SVG-via-data-URI Image
//     and OBR's image pipeline silently dropped them ("!" placeholder
//     then nothing). buildLabel renders through OBR's own canvas
//     path so it's fully reliable.
//   - up to 3 attached LOCAL items per token: an AC pill (navy), an
//     HP pill (color-ramped by current/max ratio), and an optional
//     +N temp-HP pill. Players don't see hidden bubbles; GMs do.
//   - attached items inherit POSITION + SCALE from the parent so
//     drag / teleport / zoom Just Work without re-anchoring per
//     event. We only re-anchor on token signature change (scale or
//     image-size, since POSITION inheritance is translation-only).
//
// Per-client preferences (localStorage):
//   - com.obr-suite/bubbles/enabled  ("0" / "1", default 1)
//   - com.obr-suite/bubbles/scale    (0.6×–2×, default 1)

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
    hp: Number.isFinite(hpRaw) ? Math.max(0, Math.min(hpRaw, hasHp ? maxRaw : hpRaw)) : (hasHp ? maxRaw : 0),
    maxHp: hasHp ? maxRaw : 0,
    tempHp: Number.isFinite(tempRaw) && tempRaw > 0 ? Math.floor(tempRaw) : 0,
    ac: hasAc ? Number(acRaw) : null,
    hide: !!m["hide"],
  };
}

function dataHash(d: BubbleData): string {
  return `${d.hp}|${d.maxHp}|${d.tempHp}|${d.ac == null ? "_" : d.ac}|${d.hide ? 1 : 0}`;
}

// HP color ramp tuned to match the suite's accent / functional colors.
function hpColor(ratio: number): string {
  if (ratio > 0.6) return "#5bd96a"; // healthy
  if (ratio > 0.3) return "#f5a623"; // bloodied
  return "#e74c3c";                  // critical
}

const AC_COLOR = "#1f2230";
const TEMP_COLOR = "#2f4f8e";
const TEXT_COLOR = "#ffffff";

// --- Layout ---------------------------------------------------------------
//
// Pixel sizes here are SCENE UNITS. Labels use SCALE inheritance from the
// attached parent, so a 1-cell token displays bubbles at these exact
// dimensions and a 2-cell token doubles them automatically.

const PILL_H = 22;        // height of each pill
const AC_W = 32;          // AC pill width
const HP_W = 64;          // HP pill width
const TEMP_W = 28;        // Temp HP pill width
const GAP = 5;            // gap between pills

interface BubbleEntry {
  ids: string[];          // ordered: [acId?, hpId, tempId?]
  hash: string;
  tokSig: string;
}
const entries = new Map<string, BubbleEntry>(); // tokenId → entry

function tokenSignature(tok: Item): string {
  const a = tok as any;
  return `${a.image?.width ?? "_"}|${a.image?.height ?? "_"}|${a.image?.dpi ?? "_"}|${tok.scale?.x ?? 1}|${tok.scale?.y ?? 1}|${tok.position.x}|${tok.position.y}|${tok.visible ? 1 : 0}`;
}

function tokenTopY(tok: Item, sceneDpi: number): number {
  const a = tok as any;
  const imgH = a.image?.height ?? sceneDpi;
  const imgDpi = a.image?.dpi ?? sceneDpi;
  const sy = Math.abs(tok.scale?.y ?? 1);
  const tokenHalfH = (imgH / imgDpi) * sceneDpi * sy / 2;
  return tok.position.y - tokenHalfH;
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

interface PillSpec {
  text: string;
  fill: string;
  centerX: number;
  centerY: number;
  width: number;
  height: number;
}

function buildPill(tokenId: string, spec: PillSpec): any {
  // Label position semantics: the label is centered on `position`.
  // (Confirmed empirically — earlier OBR releases anchored at
  // top-left, but current builds use center anchor for built
  // labels.) We compute centerX / centerY explicitly.
  return buildLabel()
    .plainText(spec.text)
    .width(spec.width)
    .height(spec.height)
    .padding(2)
    .fontFamily("Roboto, system-ui, -apple-system, sans-serif")
    .fontSize(13)
    .fontWeight(700)
    .textAlign("CENTER")
    .textAlignVertical("MIDDLE")
    .fillColor(TEXT_COLOR)
    .fillOpacity(1)
    .strokeColor("#000000")
    .strokeOpacity(0.55)
    .strokeWidth(1.2)
    .backgroundColor(spec.fill)
    .backgroundOpacity(0.92)
    .cornerRadius(6)
    .position({ x: spec.centerX, y: spec.centerY })
    .layer("ATTACHMENT")
    .attachedTo(tokenId)
    .locked(true)
    .disableHit(true)
    .visible(true)
    .disableAttachmentBehavior(["ROTATION", "LOCKED"])
    .metadata({ [BUBBLE_OWNER_KEY]: tokenId })
    .build();
}

function makeBubblePills(
  tok: Item,
  data: BubbleData,
  sceneDpi: number,
  userScale: number,
): { items: any[]; ids: string[] } {
  // Compose the row: [AC?] [HP] [Temp?]. Compute total width from
  // present blocks, center horizontally above the token.
  const showAc = data.ac != null;
  const showHp = data.maxHp > 0;
  const showTemp = data.tempHp > 0 && data.maxHp > 0;

  const u = userScale; // applied to widths AND vertical placement
  const ac_w = AC_W * u;
  const hp_w = HP_W * u;
  const temp_w = TEMP_W * u;
  const pill_h = PILL_H * u;
  const gap = GAP * u;

  let totalW = 0;
  if (showAc) totalW += ac_w + gap;
  if (showHp) totalW += hp_w;
  if (showTemp) totalW += gap + temp_w;
  if (totalW <= 0) return { items: [], ids: [] };

  // Vertical placement: pill row sits ABOVE the token's top edge but
  // the bottom 25% of the row dips into the token (matches the
  // reference plugin's tucked-into-the-head look).
  const top = tokenTopY(tok, sceneDpi);
  const centerY = top - pill_h * 0.5 + pill_h * 0.30;

  const rowLeft = tok.position.x - totalW / 2;
  let cursor = rowLeft;
  const items: any[] = [];
  const ids: string[] = [];

  if (showAc) {
    const it = buildPill(tok.id, {
      text: `${data.ac}`,
      fill: AC_COLOR,
      centerX: cursor + ac_w / 2,
      centerY,
      width: ac_w,
      height: pill_h,
    });
    items.push(it);
    ids.push(it.id);
    cursor += ac_w + gap;
  }

  if (showHp) {
    const ratio = data.maxHp > 0 ? Math.max(0, Math.min(1, data.hp / data.maxHp)) : 0;
    const it = buildPill(tok.id, {
      text: `${data.hp}/${data.maxHp}`,
      fill: hpColor(ratio),
      centerX: cursor + hp_w / 2,
      centerY,
      width: hp_w,
      height: pill_h,
    });
    items.push(it);
    ids.push(it.id);
    cursor += hp_w;
  }

  if (showTemp) {
    cursor += gap;
    const it = buildPill(tok.id, {
      text: `+${data.tempHp}`,
      fill: TEMP_COLOR,
      centerX: cursor + temp_w / 2,
      centerY,
      width: temp_w,
      height: pill_h,
    });
    items.push(it);
    ids.push(it.id);
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
    try { items = await OBR.scene.items.getItems(); } catch (e) {
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

    // Tokens that lost data (or were deleted) — drop their pills.
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

    // For surviving entries: rebuild if data hash changed OR token
    // signature changed (scale / image-size shifted, so positions
    // need recompute). The cheapest correct path is delete + add
    // since pill counts may differ between old/new (e.g. temp-HP
    // appeared or disappeared).
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
      const built = makeBubblePills(tok, data, sceneDpi, userScale);
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
          added: toAdd.length,
          rebuiltIds: rebuildIds.length,
          orphans: orphanItemIds.length,
          totalEntries: entries.size,
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
