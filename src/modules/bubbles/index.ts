import OBR, { buildLabel, Item } from "@owlbear-rodeo/sdk";

// Bubbles — minimal HP-bar overlay above each token.
//
// Per the user's most recent direction: keep the feature surface
// dead simple — one Settings toggle, one HP bar per token, no AC /
// no temp-HP-as-separate-pill / no other indicators. Match the
// upstream Bubbles extension's data namespace so existing scenes
// migrate transparently:
//
//   tok.metadata["com.owlbear-rodeo-bubbles-extension/metadata"] =
//     { health, "max health", "temporary health", "armor class", hide }
//
// (We still READ "armor class" so cross-tool data isn't lost,
// but we don't render anything for it. Same with the temp HP —
// shown inline in the HP bar's text as "current/max +N", not a
// separate pill.)
//
// Rendering pipeline:
//   1. List CHARACTER/MOUNT tokens that carry the metadata
//   2. Call OBR.scene.items.getItemBounds(tokenId) — returns the
//      token's TRUE rendered {min, max, center, width, height} in
//      scene coords. This sidesteps every previous round's bug
//      where we tried to derive token bounds from image.width /
//      dpi / scale and ended up off by a cell or two when the
//      image offset wasn't at center.
//   3. Build / patch a local Label item per token, anchored just
//      below the token's bounding-box bottom edge.
//
// Single OBR.scene.local Label per token. Position update is a
// fastUpdate patch on items.onChange so dragging is smooth.

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
  if (!hasHp) return null; // HP bar is the only thing we render
  return {
    hp: Number.isFinite(hpRaw) ? Math.max(0, Math.min(hpRaw, maxRaw)) : maxRaw,
    maxHp: maxRaw,
    tempHp: Number.isFinite(tempRaw) && tempRaw > 0 ? Math.floor(tempRaw) : 0,
    ac: acRaw != null && Number.isFinite(Number(acRaw)) ? Number(acRaw) : null,
    hide: !!m["hide"],
  };
}

function dataHash(d: BubbleData): string {
  return `${d.hp}|${d.maxHp}|${d.tempHp}|${d.hide ? 1 : 0}`;
}

function hpColor(ratio: number): string {
  if (ratio > 0.6) return "#5bd96a";
  if (ratio > 0.3) return "#f5a623";
  return "#e74c3c";
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

interface BubbleEntry {
  id: string;
  hash: string;
  posKey: string;
}
const entries = new Map<string, BubbleEntry>();

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
    catch { return; }

    // Filter to tokens that should display a bubble for this client.
    const candidates: Array<{ tok: Item; data: BubbleData }> = [];
    for (const it of items) {
      if (it.layer !== "CHARACTER" && it.layer !== "MOUNT") continue;
      const d = readBubbleData(it);
      if (!d) continue;
      if (d.hide && role !== "GM") continue;
      candidates.push({ tok: it, data: d });
    }

    // Pull true rendered bounds for each token from OBR. One call
    // per token because getItemBounds returns the UNION when given
    // multiple ids — we need per-token bounds to anchor each
    // bubble individually.
    const boundsByTokenId = new Map<string, {
      min: { x: number; y: number };
      max: { x: number; y: number };
      center: { x: number; y: number };
      width: number;
      height: number;
    }>();
    await Promise.all(candidates.map(async (c) => {
      try {
        const b = await OBR.scene.items.getItemBounds([c.tok.id]);
        boundsByTokenId.set(c.tok.id, b);
      } catch {}
    }));

    // Compute the desired bubble state per token.
    interface Wanted {
      tokId: string;
      data: BubbleData;
      pos: { x: number; y: number };
      hash: string;
      posKey: string;
    }
    const wanted = new Map<string, Wanted>();
    for (const c of candidates) {
      const b = boundsByTokenId.get(c.tok.id);
      if (!b) continue;
      // Anchor: just below the token's bottom edge, centered
      // horizontally on the token. Small gap so the bubble looks
      // attached to the model, not floating away.
      // 4 scene-pixel gap × user scale knob.
      const gap = 4 * userScale;
      const pos = { x: b.center.x, y: b.max.y + gap };
      wanted.set(c.tok.id, {
        tokId: c.tok.id,
        data: c.data,
        pos,
        hash: dataHash(c.data),
        posKey: `${pos.x.toFixed(2)}|${pos.y.toFixed(2)}`,
      });
    }

    // Phase 1 — drop bubbles for tokens that lost their data or
    // were removed entirely.
    const orphans: string[] = [];
    for (const [tokId, entry] of entries) {
      if (!wanted.has(tokId)) {
        orphans.push(entry.id);
        entries.delete(tokId);
      }
    }
    if (orphans.length) {
      await OBR.scene.local.deleteItems(orphans).catch((e) =>
        console.warn("[obr-suite/bubbles] delete orphans failed", e),
      );
    }

    // Phase 2 — for each wanted bubble, decide rebuild vs cheap
    // position-update.
    const toAdd: any[] = [];
    const positionUpdates: Array<{ id: string; pos: { x: number; y: number } }> = [];
    const rebuildIds: string[] = [];

    for (const [tokId, w] of wanted) {
      const existing = entries.get(tokId);
      if (existing && existing.hash === w.hash && existing.posKey === w.posKey) continue;

      if (!existing || existing.hash !== w.hash) {
        if (existing) rebuildIds.push(existing.id);
        const item = buildBubbleLabel(tokId, w.data, w.pos, userScale);
        toAdd.push(item);
        entries.set(tokId, { id: item.id, hash: w.hash, posKey: w.posKey });
      } else {
        positionUpdates.push({ id: existing.id, pos: w.pos });
        existing.posKey = w.posKey;
      }
    }

    if (rebuildIds.length) {
      await OBR.scene.local.deleteItems(rebuildIds).catch((e) =>
        console.warn("[obr-suite/bubbles] delete-for-rebuild failed", e),
      );
    }
    if (toAdd.length) {
      await OBR.scene.local.addItems(toAdd).catch((e) =>
        console.warn("[obr-suite/bubbles] addItems failed", e),
      );
    }
    if (positionUpdates.length) {
      await OBR.scene.local.updateItems(
        positionUpdates.map((u) => u.id),
        (drafts) => {
          for (const d of drafts) {
            const u = positionUpdates.find((p) => p.id === d.id);
            if (u) (d as any).position = u.pos;
          }
        },
        true,
      ).catch((e) => console.warn("[obr-suite/bubbles] position update failed", e));
    }

    if (toAdd.length || rebuildIds.length || orphans.length) {
      const sample = [...wanted.values()][0];
      console.log(
        "%c[obr-suite/bubbles] sync",
        "background:#5dade2;color:#fff;padding:1px 5px;border-radius:3px",
        {
          tokensWithData: wanted.size,
          added: toAdd.length,
          rebuilt: rebuildIds.length,
          orphans: orphans.length,
          sample: sample ? {
            tokenId: sample.tokId,
            bounds: boundsByTokenId.get(sample.tokId),
            bubblePos: sample.pos,
          } : null,
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

function buildBubbleLabel(
  tokenId: string,
  data: BubbleData,
  pos: { x: number; y: number },
  userScale: number,
): any {
  const ratio = Math.max(0, Math.min(1, data.hp / data.maxHp));
  const text = `${data.hp}/${data.maxHp}${data.tempHp > 0 ? ` +${data.tempHp}` : ""}`;
  const fontSize = 14 * userScale;
  return buildLabel()
    .plainText(text)
    .padding(4 * userScale)
    .fontSize(fontSize)
    .fontWeight(700)
    .textAlign("CENTER")
    .textAlignVertical("MIDDLE")
    .fillColor("#ffffff")
    .strokeColor("#000000")
    .strokeOpacity(0.7)
    .strokeWidth(1.4)
    .backgroundColor(hpColor(ratio))
    .backgroundOpacity(0.95)
    .cornerRadius(6 * userScale)
    // Pointer at the TOP of the label, body extends DOWN. With
    // pointer width/height = 0 the visible tail is invisible, but
    // OBR keeps using the pointer-tip anchor for `position`. So:
    //   position.y = body's TOP edge (handy because we have
    //                bounds.max.y + gap = body's top)
    //   position.x = body's horizontal center
    .pointerDirection("UP")
    .pointerWidth(0)
    .pointerHeight(0)
    .position(pos)
    .layer("TEXT")
    .locked(true)
    .disableHit(true)
    .visible(true)
    .metadata({ [BUBBLE_OWNER_KEY]: tokenId })
    .build();
}

async function clearAll(): Promise<void> {
  const ids = [...entries.values()].map((e) => e.id);
  entries.clear();
  if (ids.length) {
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
