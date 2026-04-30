import OBR, { buildImage, Item } from "@owlbear-rodeo/sdk";

// Bubbles module — renders compact HP / AC / Temp-HP info above each
// token that carries a `com.owlbear-rodeo-bubbles-extension/metadata`
// payload. The data-shape is kept compatible with that namespace key
// so scenes that previously used the standalone Bubbles extension
// keep their values when migrating to the suite.
//
// Rendering strategy:
//   - one local item per token (OBR.scene.local — per-client, no
//     network sync, fastest possible update path)
//   - the local item is `attachedTo` the parent token so OBR's
//     POSITION + SCALE inheritance handles drag / teleport / zoom
//     for free; we only re-anchor when the token's own scale changes
//     (because OBR's POSITION inheritance is translation-only)
//   - the bubble's visual is a single inline-SVG data URI — one
//     rounded HP bar, an AC shield, and an optional +N temp-HP
//     badge. SVG hashed by data so we only re-write the URL when
//     the numbers change
//
// Permissions:
//   - the BUBBLES_META object can carry a `hide: true` flag (set by
//     bestiary.spawnMonster). Hidden bubbles only render for the GM
//     so players don't see monster HP/AC.
//
// Per-client preferences (localStorage):
//   - `com.obr-suite/bubbles/enabled` ("0" / "1" / unset → default 1)
//   - `com.obr-suite/bubbles/scale` (number, default 1)

const PLUGIN_ID = "com.obr-suite/bubbles";
const BUBBLE_OWNER_KEY = `${PLUGIN_ID}/owner`;

export const LS_BUBBLES_ENABLED = `${PLUGIN_ID}/enabled`;
export const LS_BUBBLES_SCALE = `${PLUGIN_ID}/scale`;

// Compatibility namespace — preserved so existing scenes keep working.
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

// Suite palette + functional HP color ramp.
function hpRampColor(ratio: number): string {
  if (ratio > 0.6) return "#5bd96a";   // healthy
  if (ratio > 0.3) return "#f5a623";   // bloodied
  return "#e74c3c";                    // critical
}

const SVG_W = 100;
const SVG_H = 24;

function buildSvg(d: BubbleData): string {
  const ratio = d.maxHp > 0 ? Math.max(0, Math.min(1, d.hp / d.maxHp)) : 0;
  const hpColor = hpRampColor(ratio);

  // Three blocks, conditionally laid out left → right:
  //   AC shield (if present), HP bar, temp-HP badge (if > 0).
  // We compute offsets so the whole row is centered horizontally
  // regardless of which blocks are visible.
  const showAc = d.ac != null;
  const showHp = d.maxHp > 0;
  const showTemp = d.tempHp > 0;

  const ACW = 16;        // AC shield width
  const TEMPW = 18;      // temp HP badge width
  const GAP = 3;
  const HP_MIN = 38;
  const HP_MAX = 78;

  // HP bar takes whatever's left after AC + temp + gaps, clamped.
  let hpW = SVG_W - 4 - 4; // outer padding 4 each side
  if (showAc) hpW -= ACW + GAP;
  if (showTemp) hpW -= TEMPW + GAP;
  hpW = Math.max(HP_MIN, Math.min(HP_MAX, hpW));

  const totalW =
    (showAc ? ACW + GAP : 0) +
    (showHp ? hpW : 0) +
    (showTemp ? GAP + TEMPW : 0);
  let cursorX = (SVG_W - totalW) / 2;

  const parts: string[] = [];

  if (showAc) {
    // Heater shield — flat top, gentle curve to a point.
    parts.push(`<g transform="translate(${cursorX.toFixed(2)},2)">
      <path d="M0,0 H${ACW} V12 Q${ACW / 2},${ACW + 1} 0,12 Z"
            fill="#1f2230" stroke="#5dade2" stroke-width="0.8" stroke-linejoin="round"/>
      <text x="${ACW / 2}" y="11.5" font-family="-apple-system,system-ui,'Segoe UI',sans-serif"
            font-size="9.5" font-weight="800" fill="#e0e7ff" text-anchor="middle">${d.ac}</text>
    </g>`);
    cursorX += ACW + GAP;
  }

  if (showHp) {
    const fillW = ratio * (hpW - 2);
    const hpText = `${d.hp}/${d.maxHp}`;
    parts.push(`<g transform="translate(${cursorX.toFixed(2)},5)">
      <rect width="${hpW}" height="14" rx="3" ry="3"
            fill="#0a0c14" fill-opacity="0.92"
            stroke="rgba(93,173,226,0.42)" stroke-width="0.7"/>
      <rect x="1" y="1" width="${fillW.toFixed(2)}" height="12" rx="2.4" ry="2.4"
            fill="${hpColor}" fill-opacity="0.95"/>
      <text x="${(hpW / 2).toFixed(2)}" y="10.4" font-family="-apple-system,system-ui,'Segoe UI',sans-serif"
            font-size="9" font-weight="800" fill="#ffffff" text-anchor="middle"
            style="paint-order:stroke;stroke:#000;stroke-width:1.7px;stroke-linejoin:round;">${hpText}</text>
    </g>`);
    cursorX += hpW + GAP;
  }

  if (showTemp) {
    parts.push(`<g transform="translate(${cursorX.toFixed(2)},4)">
      <rect width="${TEMPW}" height="16" rx="3" ry="3"
            fill="#324a87" stroke="#9cc4f4" stroke-width="0.7"/>
      <text x="${TEMPW / 2}" y="11.5" font-family="-apple-system,system-ui,'Segoe UI',sans-serif"
            font-size="8.5" font-weight="800" fill="#e8f0ff" text-anchor="middle">+${d.tempHp}</text>
    </g>`);
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SVG_W} ${SVG_H}" width="${SVG_W}" height="${SVG_H}">${parts.join("")}</svg>`;
}

function svgDataUri(svg: string): string {
  // Base64 encoding — OBR's image renderer rejected the
  // encodeURIComponent variant (it showed "!" as broken-image
  // fallback). base64 is bulkier but every <img> implementation
  // accepts it without quirks. TextEncoder lets the path stay safe
  // if the SVG ever picks up a non-ASCII char.
  const bytes = new TextEncoder().encode(svg);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return `data:image/svg+xml;base64,${btoa(bin)}`;
}

// --- Per-token state -------------------------------------------------------

interface BubbleEntry {
  bubbleId: string;
  hash: string;
  // Last-known token rendering signature so we can detect when the
  // token changed scale / image size and re-anchor accordingly.
  tokSig: string;
}
const entries = new Map<string, BubbleEntry>(); // tokenId → entry

function tokenSignature(tok: Item): string {
  const a = tok as any;
  return `${a.image?.width ?? "_"}|${a.image?.height ?? "_"}|${a.image?.dpi ?? "_"}|${tok.scale?.x ?? 1}|${tok.scale?.y ?? 1}|${tok.position.x}|${tok.position.y}|${tok.visible ? 1 : 0}`;
}

function bubbleAnchorY(tok: Item, sceneDpi: number, _userScale: number): number {
  // Anchor sits exactly on the token's visible top edge. The actual
  // overlap (~30% of bubble height into the token) comes from the
  // image's own offset point — see makeBubbleItem(): we pick
  // offset.y = SVG_H * 0.7 so the anchor is 70% down inside the
  // bubble graphic, which leaves the bottom 30% of the bubble
  // hanging below the anchor (i.e. tucked inside the token).
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
let syncScheduled = false;
let inSync = false;

async function syncBubbles(): Promise<void> {
  if (inSync) {
    syncScheduled = true;
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
    try { items = await OBR.scene.items.getItems(); } catch { return; }

    let sceneDpi = 150;
    try { sceneDpi = await OBR.scene.grid.getDpi(); } catch {}

    const tokenById = new Map<string, Item>();
    for (const it of items) {
      if (it.layer === "CHARACTER" || it.layer === "MOUNT") {
        tokenById.set(it.id, it);
      }
    }

    // Compute desired set for THIS client (filter hidden bubbles for
    // players).
    const desired = new Map<string, BubbleData>();
    for (const [id, tok] of tokenById) {
      const d = readBubbleData(tok);
      if (!d) continue;
      if (d.hide && role !== "GM") continue;
      desired.set(id, d);
    }

    // Phase 1: tokens that lost their bubble data → delete bubble.
    const orphanIds: string[] = [];
    for (const [tokId, entry] of entries) {
      if (!desired.has(tokId) || !tokenById.has(tokId)) {
        orphanIds.push(entry.bubbleId);
        entries.delete(tokId);
      }
    }
    if (orphanIds.length > 0) {
      await OBR.scene.local.deleteItems(orphanIds).catch(() => {});
    }

    // Phase 2: new bubbles to add + existing bubbles that need
    // visual or position refresh.
    const toAdd: any[] = [];
    const visualUpdates: Array<{ id: string; svgUrl: string }> = [];
    const anchorUpdates: Array<{ id: string; pos: { x: number; y: number } }> = [];

    for (const [tokId, data] of desired) {
      const tok = tokenById.get(tokId)!;
      const hash = dataHash(data);
      const sig = tokenSignature(tok);
      const existing = entries.get(tokId);
      if (!existing) {
        const svg = buildSvg(data);
        const item = makeBubbleItem(tok, svgDataUri(svg), sceneDpi, userScale);
        toAdd.push(item);
        entries.set(tokId, { bubbleId: item.id, hash, tokSig: sig });
        continue;
      }
      if (existing.hash !== hash) {
        visualUpdates.push({ id: existing.bubbleId, svgUrl: svgDataUri(buildSvg(data)) });
        existing.hash = hash;
      }
      if (existing.tokSig !== sig) {
        anchorUpdates.push({
          id: existing.bubbleId,
          pos: { x: tok.position.x, y: bubbleAnchorY(tok, sceneDpi, userScale) },
        });
        existing.tokSig = sig;
      }
    }

    if (toAdd.length > 0) {
      await OBR.scene.local.addItems(toAdd).catch(() => {});
    }
    if (visualUpdates.length > 0) {
      const ids = visualUpdates.map((v) => v.id);
      await OBR.scene.local.updateItems(ids, (drafts) => {
        for (const d of drafts) {
          const upd = visualUpdates.find((v) => v.id === d.id);
          if (!upd) continue;
          (d as any).image.url = upd.svgUrl;
        }
      }).catch(() => {});
    }
    if (anchorUpdates.length > 0) {
      const ids = anchorUpdates.map((v) => v.id);
      await OBR.scene.local.updateItems(ids, (drafts) => {
        for (const d of drafts) {
          const upd = anchorUpdates.find((v) => v.id === d.id);
          if (!upd) continue;
          (d as any).position = upd.pos;
        }
      }).catch(() => {});
    }
  } finally {
    inSync = false;
    if (syncScheduled) {
      syncScheduled = false;
      scheduleSync();
    }
  }
}

function makeBubbleItem(
  tok: Item,
  svgUrl: string,
  sceneDpi: number,
  userScale: number,
) {
  const anchorY = bubbleAnchorY(tok, sceneDpi, userScale);
  // dpi = SVG_W → at scale=1 the bubble renders 1 grid cell wide.
  // SCALE inheritance from `attachedTo` then auto-scales it with the
  // token, and userScale gives the player a per-client size knob.
  return buildImage(
    {
      url: svgUrl,
      width: SVG_W,
      height: SVG_H,
      mime: "image/svg+xml",
    },
    {
      dpi: SVG_W,
      // Anchor 70% down the bubble — 70% of the graphic sits ABOVE
      // the anchor point, 30% sits BELOW it. Combined with
      // `position.y = tokenTop` (see bubbleAnchorY) this tucks the
      // bottom slice of the bubble inside the token's upper edge,
      // which matches the reference Bubbles plugin's tight-to-the
      // -head placement instead of floating high above the token.
      offset: { x: SVG_W / 2, y: SVG_H * 0.7 },
    },
  )
    .position({ x: tok.position.x, y: anchorY })
    .scale({ x: userScale, y: userScale })
    .layer("ATTACHMENT")
    .attachedTo(tok.id)
    .locked(true)
    .disableHit(true)
    .visible(true)
    // ROTATION inherited would tilt the bubble with the token — we
    // want it stable. POSITION+SCALE+VISIBLE+DELETE all inherit by
    // default which is exactly the behavior we want.
    .disableAttachmentBehavior(["ROTATION", "LOCKED"])
    .metadata({ [BUBBLE_OWNER_KEY]: tok.id })
    .build();
}

async function clearAll(): Promise<void> {
  const ids = [...entries.values()].map((e) => e.bubbleId);
  entries.clear();
  if (ids.length > 0) {
    await OBR.scene.local.deleteItems(ids).catch(() => {});
  }
}

let pendingTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSync(): void {
  if (pendingTimer) return;
  pendingTimer = setTimeout(() => {
    pendingTimer = null;
    syncBubbles().catch((e) => console.warn("[obr-suite/bubbles] sync failed", e));
  }, 60);
}

export async function setupBubbles(): Promise<void> {
  try { role = (await OBR.player.getRole()) as "GM" | "PLAYER"; } catch {}

  // Watch scene items — drag, scale change, metadata edits all flow
  // through this single channel and the debounce keeps us from
  // hammering the local-item layer on big batched updates.
  unsubs.push(
    OBR.scene.items.onChange(() => scheduleSync()),
  );

  // Settings panel writes localStorage; storage events let us pick
  // the change up live across iframes.
  const onStorage = (e: StorageEvent) => {
    if (e.key === LS_BUBBLES_ENABLED || e.key === LS_BUBBLES_SCALE) {
      void clearAll().then(() => syncBubbles().catch(() => {}));
    }
  };
  window.addEventListener("storage", onStorage);
  unsubs.push(() => window.removeEventListener("storage", onStorage));

  // Initial pass (don't await — non-blocking startup).
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

// --- Public helper for other modules to write/update bubble data ----------
//
// Used by character-cards (on bind/save) and bestiary monster-info
// (on +/- HP edit). Keeping the writer here keeps the metadata-shape
// knowledge in one place.
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
        // Clamp current HP to maxHp if both are set.
        const mx = Number(next["max health"]);
        const cur2 = Number(next["health"]);
        if (Number.isFinite(mx) && mx > 0 && Number.isFinite(cur2)) {
          next["health"] = Math.max(0, Math.min(cur2, mx));
        }
        (d.metadata as any)[BUBBLES_META] = next;
        if (patch.name != null) {
          (d.metadata as any)[BUBBLES_NAME] = patch.name;
        }
      }
    });
  } catch (e) {
    console.warn("[obr-suite/bubbles] writeBubbleStats failed", e);
  }
}

export function readBubbleStatsForToken(item: Item): BubbleData | null {
  return readBubbleData(item);
}
