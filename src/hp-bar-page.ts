// Standalone HP / Temp / AC bar — popover script.
//
// URL params:
//   itemId — required, the token whose bubbles metadata we read & write.
//
// Reads & writes the same `com.owlbear-rodeo-bubbles-extension/metadata`
// key that bestiary-info / cc-info already use — so any change here
// updates the on-token HP bar / heater shield instantly via the
// existing bubbles plugin.

import OBR from "@owlbear-rodeo/sdk";
import { installDebugOverlay } from "./utils/debugOverlay";
import { bindPanelDrag } from "./utils/panelDrag";
import { PANEL_IDS } from "./utils/panelLayout";
import { installPanelZoom } from "./utils/panelZoom";
import {
  parseStatInput,
  readBubbles,
  patchBubbles,
  clampStat,
  type BubblesData,
} from "./utils/statEdit";

const params = new URLSearchParams(location.search);
const itemId = params.get("itemId") ?? "";

const dragHandle = document.getElementById("dragHandle") as HTMLDivElement;
const hpPillEl = document.getElementById("hpPill") as HTMLDivElement;
const lockBtn = document.getElementById("lockBtn") as HTMLButtonElement | null;
const pinBtn = document.getElementById("panelPinBtn") as HTMLButtonElement | null;
const resetBtn = document.getElementById("resetBtn") as HTMLButtonElement | null;
const nameRowEl = document.getElementById("nameRow") as HTMLDivElement | null;
const inputs = Array.from(
  document.querySelectorAll<HTMLInputElement>(".stat-input"),
);

// 2026-05-11 — reset button. Broadcasts to the bubbles bg module to
// drop the cached entry for the currently-selected token + sweep
// every local item it owns, then trigger a fresh sync. Used when the
// on-canvas HP bar / heater shield drift away from their token; this
// is the "force a re-render" escape hatch.
const BC_BUBBLES_RESET_TOKEN = "com.obr-suite/bubbles-reset-token";
resetBtn?.addEventListener("click", () => {
  if (!itemId) return;
  try {
    OBR.broadcast.sendMessage(
      BC_BUBBLES_RESET_TOKEN,
      { tokenId: itemId },
      { destination: "LOCAL" },
    );
  } catch (e) {
    console.warn("[hp-bar] reset broadcast failed", e);
  }
  // Visual flash so the user knows the click registered even before
  // the on-canvas redraw lands.
  resetBtn.classList.add("flash");
  setTimeout(() => resetBtn.classList.remove("flash"), 400);
});

// Metadata keys we read for name resolution. Mirrors the constants in
// modules/hpBar/index.ts and modules/characterCards/* — duplicated here
// so this iframe page doesn't take a build-time dependency on the bg
// module's exports.
const CC_BIND_KEY = "com.character-cards/boundCardId";
const CC_LIST_KEY = "com.character-cards/list";
const BUBBLES_NAME_KEY = "com.owlbear-rodeo-bubbles-extension/name";

// 2026-05-10: pin-panel feature — mirror of bestiary monster-info /
// cc-info. When ON, the popover stays open across deselect / different-
// token selection (data still updates if a different valid token is
// selected). Per-client localStorage; LOCAL broadcast picked up by
// modules/hpBar/index.ts to gate handleSelection's auto-close.
const LS_HP_BAR_PINNED = "obr-suite/hp-bar-pinned";
const BC_HP_BAR_PIN_CHANGED = "com.obr-suite/hp-bar-pin-changed";

function readHpBarPinned(): boolean {
  try { return localStorage.getItem(LS_HP_BAR_PINNED) === "1"; } catch { return false; }
}

function paintPinBtn(): void {
  if (!pinBtn) return;
  const v = readHpBarPinned();
  pinBtn.classList.toggle("pinned", v);
  pinBtn.setAttribute("aria-pressed", String(v));
  pinBtn.title = v
    ? "已置顶（取消则恢复随选择关闭）"
    : "置顶面板（取消选中也保持显示）";
}

function toggleHpBarPinned(): void {
  const next = !readHpBarPinned();
  try { localStorage.setItem(LS_HP_BAR_PINNED, next ? "1" : "0"); } catch {}
  paintPinBtn();
  try {
    OBR.broadcast.sendMessage(
      BC_HP_BAR_PIN_CHANGED,
      { pinned: next },
      { destination: "LOCAL" },
    );
  } catch {}
}

paintPinBtn();
pinBtn?.addEventListener("click", (e) => {
  e.preventDefault();
  e.stopPropagation();
  toggleHpBarPinned();
});

let live: BubblesData = {};
let isGM = false;

function fmt(v: number | undefined, fallback = 0): string {
  return String(typeof v === "number" ? v : fallback);
}

function paint(): void {
  // Set each stat input's display value from `live`. We do this when
  // not focused so the user's in-progress edit (e.g. typing "+5")
  // doesn't get overwritten mid-keystroke.
  for (const inp of inputs) {
    if (document.activeElement === inp) continue;
    const field = inp.dataset.field as keyof BubblesData;
    inp.value = fmt(live[field] as number | undefined);
  }
  // Update the HP fill ratio.
  const hp = typeof live.health === "number" ? live.health : 0;
  const max = typeof live["max health"] === "number" ? live["max health"] : 0;
  const ratio = max > 0 ? Math.max(0, Math.min(1, hp / max)) : 1;
  hpPillEl.style.setProperty("--hp-ratio", String(ratio));
  // Lock button reflects current `locked` state. Default true (the
  // bubbles module treats absent `locked` as locked = combat-gated
  // visibility for players).
  if (lockBtn) {
    const locked = live.locked === undefined ? true : !!live.locked;
    lockBtn.dataset.locked = locked ? "true" : "false";
    lockBtn.title = locked
      ? "已锁定：战斗外玩家看不到血条详情。点击解锁让所有人可见。"
      : "已解锁：所有人可见血条与 AC。点击锁定恢复战斗外隐藏。";
  }
}

// 2026-05-10c — resolve the name to display above the bar, with the
// priority CC name (from the room's character-cards list) → bestiary
// monster name (BUBBLES_NAME meta) → OBR item.name (image filename
// the user chose). Reads scene metadata + the item's own metadata.
async function resolveDisplayName(id: string): Promise<string> {
  if (!id) return "";
  let item: any = null;
  try {
    const list = await OBR.scene.items.getItems([id]);
    item = list[0] ?? null;
  } catch {}
  if (!item) return "";
  const meta = (item.metadata ?? {}) as Record<string, unknown>;
  // 1. Character card binding takes precedence.
  const cardId = meta[CC_BIND_KEY];
  if (typeof cardId === "string" && cardId) {
    try {
      const sceneMeta = await OBR.scene.getMetadata();
      const list = sceneMeta[CC_LIST_KEY];
      if (Array.isArray(list)) {
        const card = (list as any[]).find((c) => c && c.id === cardId);
        if (card && typeof card.name === "string" && card.name.trim()) {
          return String(card.name).trim();
        }
      }
    } catch {}
  }
  // 2. Bubbles name (set by bestiary bind / writeBubbleStats).
  const bubblesName = meta[BUBBLES_NAME_KEY];
  if (typeof bubblesName === "string" && bubblesName.trim()) {
    return String(bubblesName).trim();
  }
  // 3. OBR item name (the user's image / token name).
  if (typeof item.name === "string" && item.name.trim()) {
    return String(item.name).trim();
  }
  return "";
}

function paintName(name: string): void {
  if (!nameRowEl) return;
  nameRowEl.textContent = name || "—";
  nameRowEl.title = name || "";
}

async function refresh(): Promise<void> {
  if (!itemId) return;
  try {
    live = await readBubbles(itemId);
  } catch {
    live = {};
  }
  paint();
  // Refresh the name in parallel so a CC rename / bestiary rebind
  // propagates here without a popover reload.
  try {
    const name = await resolveDisplayName(itemId);
    paintName(name);
  } catch {}
}

// Commit the user's edit on blur or Enter. Parses the input via
// parseStatInput (supports "20", "+5", "-3", "15+5") and writes via
// patchBubbles which clamps + merges.
async function commit(inp: HTMLInputElement): Promise<void> {
  if (!itemId) return;
  const field = inp.dataset.field as keyof BubblesData;
  const cur = (live[field] as number | undefined) ?? 0;
  const parsed = parseStatInput(inp.value, cur);
  if (parsed === null) {
    // Bad input — revert to live value.
    inp.value = fmt(cur);
    return;
  }
  const v = clampStat(field, parsed);
  const updated = await patchBubbles(itemId, { [field]: v } as Partial<BubblesData>);
  live = updated;
  paint();
}

for (const inp of inputs) {
  inp.addEventListener("focus", () => { inp.select(); });
  inp.addEventListener("blur", () => { void commit(inp); });
  inp.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      inp.blur();
    } else if (e.key === "Escape") {
      e.preventDefault();
      const field = inp.dataset.field as keyof BubblesData;
      inp.value = fmt(live[field] as number | undefined);
      inp.blur();
    }
  });
}

bindPanelDrag(dragHandle, PANEL_IDS.hpBar);

window.addEventListener("contextmenu", (e) => e.preventDefault());

// Lock button — DM-only via body class. Toggles the `locked` field
// on the bubbles metadata. The bubbles module treats locked = true
// as "hide HP / AC details from players outside combat". Players
// don't get a button (CSS hides it via `body.is-player`).
lockBtn?.addEventListener("click", async () => {
  if (!itemId || !isGM) return;
  const next = !(live.locked === undefined ? true : !!live.locked);
  const updated = await patchBubbles(itemId, { locked: next });
  live = updated;
  paint();
});

OBR.onReady(async () => {
  installDebugOverlay();
  // 2026-05-16 — scale text + click targets with panel size. Baseline
  // = POPOVER_W × POPOVER_H from hpBar/index.ts.
  installPanelZoom({ baseWidth: 320, baseHeight: 78 });
  try {
    isGM = (await OBR.player.getRole()) === "GM";
  } catch {}
  if (!isGM) document.body.classList.add("is-player");
  await refresh();
  // Live sync — when ANY scene item changes, refresh our snapshot
  // so external HP / AC edits (e.g. via the bestiary popover, or a
  // direct metadata edit) keep this bar accurate.
  OBR.scene.items.onChange(() => { void refresh(); });
  OBR.player.onChange((p) => {
    const nextGM = p.role === "GM";
    if (nextGM !== isGM) {
      isGM = nextGM;
      document.body.classList.toggle("is-player", !isGM);
    }
  });
});
