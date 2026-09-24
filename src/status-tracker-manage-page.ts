// Status tracker — buff management popover.
//
// Spawned by index.ts in response to a BC_OPEN_MANAGE broadcast,
// which itself was triggered by the user dragging the 🛠 manage
// pill out of the palette and dropping it onto a token. The
// popover anchors visually on the token (computed in
// openManagePopover from index.ts via OBR.viewport.transformPoint).
//
// Each buff currently on the token is rendered as a draggable
// pill. pointerdown on a pill broadcasts BC_DRAG_START with
// kind="manage-transfer" + buff + sourceTokenId; the existing
// capture overlay (status-tracker-capture-page.ts) handles the
// drag and the drop logic:
//   - drop on another token → transfer
//   - drop on empty space   → remove from source
//   - drop back on source   → revert
//
// Refreshes when scene metadata or the token's items list change
// so the popover stays in sync with concurrent edits.

import OBR, { type Item } from "@owlbear-rodeo/sdk";
import {
  PLUGIN_ID,
  STATUS_BUFFS_KEY,
  STATUS_BUFF_ROUNDS_KEY,
  SCENE_BUFF_CATALOG_KEY,
  DEFAULT_BUFFS,
  BuffDef,
  textColorFor,
} from "./modules/statusTracker/types";
import { t, applyI18nDom } from "./i18n";
import { getLocalLang, onLangChange } from "./state";
import { rememberStatusSource, statusName } from "./modules/statusTracker/localization";

// Read the active language fresh on each render. This popover is
// short-lived (opens on a token, closes on drop), so a live language
// switch mid-open is a non-case; reading at render time suffices.
const T = (k: Parameters<typeof t>[1]) => t(getLocalLang(), k);

const BC_DRAG_START = `${PLUGIN_ID}/drag-start`;
const BC_CLOSE_MANAGE = `${PLUGIN_ID}/close-manage`;
const POPOVER_ID = `${PLUGIN_ID}/manage`;
// Per-browser palette catalog (custom + effect buffs the user added
// locally). Same key status-tracker-page.ts writes. The manage popover
// MUST consult it too — otherwise a custom / effect buff that lives
// only in this browser's localStorage (never written to the shared
// scene catalog) can't be resolved here and the applied buff is
// silently dropped → invisible → impossible to remove.
const LS_BUFF_CATALOG = "obr-suite/status/buff-catalog";

const params = new URLSearchParams(location.search);
const tokenId = params.get("token") ?? "";

const titleEl = document.getElementById("title") as HTMLSpanElement;
const gridEl = document.getElementById("grid") as HTMLDivElement;
const btnClose = document.getElementById("btnClose") as HTMLButtonElement;

let catalog: BuffDef[] = [];
let myBuffIds: string[] = [];
let myBuffRounds: Record<string, number> = {};
let tokenName = "";

// 2026-05-15 — strip pictographic emoji from buff names so the manage
// popover stays text-only (matches the palette + capture sweep). The
// underlying buff data is left intact: legacy "麻痹 ⚡" / etc. saves
// still load, only the rendered label drops the emoji decoration.
function stripEmoji(s: string): string {
  return s.replace(/\p{Extended_Pictographic}/gu, "")
          .replace(/[\u{FE0E}\u{FE0F}\u{200D}]/gu, "")
          .replace(/[\u{1F3FB}-\u{1F3FF}]/gu, "")
          .replace(/\s+/g, " ")
          .trim();
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!),
  );
}

function parseCatalogArray(v: unknown): BuffDef[] {
  let arr: any[] | null = null;
  if (Array.isArray(v)) arr = v;
  else if (v && typeof v === "object" && Array.isArray((v as any).buffs)) {
    arr = (v as any).buffs;
  }
  if (!arr) return [];
  return arr
    .filter((e) => e && typeof e.id === "string")
    .map((e) => {
      const def: any = {
        id: e.id,
        name: String(e.name ?? e.id),
        color: typeof e.color === "string" ? e.color : "#ffffff",
        group: typeof e.group === "string" && e.group.length > 0 ? e.group : undefined,
        rounds: Number.isFinite(Number(e.rounds)) && Number(e.rounds) > 0 ? Math.floor(Number(e.rounds)) : undefined,
      };
      // Preserve effect fields so an effect buff resolves with its real
      // look (and so a transfer/remove drag carries the full def).
      if (typeof e.webmAsset === "string") def.webmAsset = e.webmAsset;
      if (typeof e.iconAsset === "string") def.iconAsset = e.iconAsset;
      return rememberStatusSource(def as BuffDef, e as BuffDef);
    });
}

async function loadCatalog(): Promise<void> {
  // Merge EVERY catalog source so the manage popover can resolve (and
  // therefore let the user remove) any applied buff: built-in defaults,
  // this browser's local palette (custom + effect buffs), and the
  // shared scene catalog. Later sources override earlier ones by id —
  // scene (shared truth) wins over local, which wins over default.
  const byId = new Map<string, BuffDef>();
  for (const b of DEFAULT_BUFFS) byId.set(b.id, b);
  try {
    const raw = localStorage.getItem(LS_BUFF_CATALOG);
    if (raw) for (const b of parseCatalogArray(JSON.parse(raw))) byId.set(b.id, b);
  } catch { /* private mode / malformed — skip local */ }
  try {
    const meta = await OBR.scene.getMetadata();
    for (const b of parseCatalogArray(meta[SCENE_BUFF_CATALOG_KEY])) byId.set(b.id, b);
  } catch { /* offline — scene layer skipped */ }
  catalog = [...byId.values()];
}

/** Rebuild this popover's token state. When items.onChange already
 *  delivered the scene snapshot, pass it in — no extra getItems. */
async function loadTokenState(itemsSnapshot?: Item[]): Promise<void> {
  if (!tokenId) return;
  try {
    const tok = itemsSnapshot
      ? itemsSnapshot.find((it) => it.id === tokenId)
      : (await OBR.scene.items.getItems([tokenId]))[0];
    if (!tok) {
      myBuffIds = [];
      tokenName = "";
      return;
    }
    tokenName = tok.name || "";
    const ids = (tok.metadata as any)[STATUS_BUFFS_KEY];
    myBuffIds = Array.isArray(ids) ? ids.filter((x: any) => typeof x === "string") : [];
    const rounds = (tok.metadata as any)[STATUS_BUFF_ROUNDS_KEY];
    myBuffRounds = {};
    if (rounds && typeof rounds === "object" && !Array.isArray(rounds)) {
      for (const [id, raw] of Object.entries(rounds as Record<string, unknown>)) {
        const n = Math.floor(Number(raw));
        if (Number.isFinite(n) && n > 0) myBuffRounds[id] = n;
      }
    }
  } catch (e) {
    console.warn("[status/manage] loadTokenState failed", { tokenId, error: e });
    myBuffIds = [];
    myBuffRounds = {};
  }
}

// Resolve an applied buff id to a def — falling back to a generic pill
// for ids we still can't place (a custom / effect buff from another
// client, or a stale id). The whole job of this popover is to REMOVE
// buffs, so an unresolved id MUST still be shown + draggable, never
// silently dropped (that was the "看不到自定义/特效 buff 没法删" bug).
function resolveBuff(id: string): BuffDef {
  const found = catalog.find((b) => b.id === id);
  if (found) return found;
  return { id, name: T("stUnknownBuff"), color: "#6b7280" } as BuffDef;
}

function render(): void {
  titleEl.textContent = `${tokenName || T("stRoleFallback")} · buff`;
  if (myBuffIds.length === 0) {
    gridEl.innerHTML = `<div class="empty">${T("stNoBuffsOnChar")}</div>`;
    return;
  }

  gridEl.innerHTML = myBuffIds.map((id) => {
    const b = resolveBuff(id);
    const fg = textColorFor(b.color);
    const rounds = myBuffRounds[id];
    const cleanName = stripEmoji(statusName(b, getLocalLang()));
    const label = rounds > 0 ? `${cleanName} ${rounds}` : cleanName;
    return `<div class="bubble" data-id="${escapeHtml(id)}"
                 style="background:${escapeHtml(b.color)};color:${escapeHtml(fg)}">${escapeHtml(label)}</div>`;
  }).join("");

  gridEl.querySelectorAll<HTMLElement>(".bubble").forEach((el) => {
    el.addEventListener("pointerdown", onBubblePointerDown);
    el.addEventListener("contextmenu", (e) => e.preventDefault());
  });
}

async function onBubblePointerDown(e: Event): Promise<void> {
  const ev = e as PointerEvent;
  // Only left button. Right button doesn't make sense here — the
  // popover's whole job is "drag this buff somewhere", a paint-toggle
  // would just nuke buffs across multiple tokens at the source.
  if (ev.button !== 0) return;
  ev.preventDefault();
  ev.stopPropagation();
  const el = ev.currentTarget as HTMLElement;
  const id = el.dataset.id ?? "";
  if (!id) return;
  // Use the same fallback as render() so an unresolved buff is still
  // draggable-to-remove (the capture overlay only needs buff.id to
  // strip it off the source token).
  const buff = resolveBuff(id);
  try {
    await OBR.broadcast.sendMessage(
      BC_DRAG_START,
      {
        kind: "manage-transfer",
        buff,
        mode: "drop",
        sourceTokenId: tokenId,
      },
      { destination: "LOCAL" },
    );
  } catch (err) {
    console.warn("[status/manage] BC_DRAG_START failed", err);
  }
}

btnClose.addEventListener("click", async () => {
  try {
    await OBR.broadcast.sendMessage(BC_CLOSE_MANAGE, {}, { destination: "LOCAL" });
  } catch {}
  try { await OBR.popover.close(POPOVER_ID); } catch {}
});

window.addEventListener("contextmenu", (e) => e.preventDefault());

window.addEventListener("keydown", async (e) => {
  if (e.key === "Escape") {
    e.preventDefault();
    try {
      await OBR.broadcast.sendMessage(BC_CLOSE_MANAGE, {}, { destination: "LOCAL" });
    } catch {}
    try { await OBR.popover.close(POPOVER_ID); } catch {}
  }
});

OBR.onReady(async () => {
  applyI18nDom(getLocalLang());
  await loadCatalog();
  await loadTokenState();
  render();
  const refreshLanguage = () => {
    document.documentElement.lang = getLocalLang(); document.title = T("stManageBuffs");
    applyI18nDom(getLocalLang());
    titleEl.textContent = `${tokenName || T("stRoleFallback")} · buff`;
    gridEl.querySelectorAll<HTMLElement>(".bubble[data-id]").forEach(el => {
      const id = el.dataset.id!, buff = resolveBuff(id), rounds = myBuffRounds[id];
      el.textContent = stripEmoji(statusName(buff, getLocalLang())) + (rounds > 0 ? ` ${rounds}` : "");
    });
    const empty = gridEl.querySelector(".empty"); if (empty) empty.textContent = T("stNoBuffsOnChar");
  };
  refreshLanguage(); const offLanguage = onLangChange(refreshLanguage);
  window.addEventListener("pagehide", offLanguage, { once: true });

  // Re-render when the catalog changes (e.g. user edits a buff
  // colour from the palette while this popover is open).
  OBR.scene.onMetadataChange(async (meta) => {
    if (!(SCENE_BUFF_CATALOG_KEY in meta)) return;
    try {
      await loadCatalog();
      render();
    } catch (e) {
      console.warn("[status/manage] scene metadata handler failed", e);
    }
  });
  // Single items.onChange: the delivered snapshot both answers "is
  // the token still there" and carries its metadata — the old pair of
  // handlers discarded the payload and re-fetched getItems([tokenId])
  // on every scene tick (checklist §1).
  OBR.scene.items.onChange(async (items) => {
    try {
      if (!tokenId) return;
      const stillThere = items.some((it) => it.id === tokenId);
      if (!stillThere) {
        // Token deleted while the popover is open — close rather than
        // show stale data forever.
        try { await OBR.popover.close(POPOVER_ID); } catch {}
        return;
      }
      await loadTokenState(items);
      render();
    } catch (e) {
      console.warn("[status/manage] scene items handler failed", { tokenId, error: e });
    }
  });
});
