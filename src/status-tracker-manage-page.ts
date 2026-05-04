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

import OBR from "@owlbear-rodeo/sdk";
import {
  PLUGIN_ID,
  STATUS_BUFFS_KEY,
  SCENE_BUFF_CATALOG_KEY,
  DEFAULT_BUFFS,
  BuffDef,
  textColorFor,
} from "./modules/statusTracker/types";

const BC_DRAG_START = `${PLUGIN_ID}/drag-start`;
const BC_CLOSE_MANAGE = `${PLUGIN_ID}/close-manage`;
const POPOVER_ID = `${PLUGIN_ID}/manage`;

const params = new URLSearchParams(location.search);
const tokenId = params.get("token") ?? "";

const titleEl = document.getElementById("title") as HTMLSpanElement;
const gridEl = document.getElementById("grid") as HTMLDivElement;
const btnClose = document.getElementById("btnClose") as HTMLButtonElement;

let catalog: BuffDef[] = [];
let myBuffIds: string[] = [];
let tokenName = "角色";

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!),
  );
}

async function loadCatalog(): Promise<void> {
  try {
    const meta = await OBR.scene.getMetadata();
    const v = meta[SCENE_BUFF_CATALOG_KEY] as unknown;
    let arr: any[] | null = null;
    if (Array.isArray(v)) arr = v;
    else if (v && typeof v === "object" && Array.isArray((v as any).buffs)) {
      arr = (v as any).buffs;
    }
    if (arr) {
      const parsed = arr
        .filter((e) => e && typeof e.id === "string")
        .map((e) => ({
          id: e.id,
          name: String(e.name ?? e.id),
          color: typeof e.color === "string" ? e.color : "#ffffff",
          group: typeof e.group === "string" && e.group.length > 0 ? e.group : undefined,
        } as BuffDef));
      // 2026-05-05 bug fix: when the user has applied default-catalog
      // buffs to tokens but never opened the palette's ✎ edit popup
      // to save a custom catalog, scene metadata is empty and parsed
      // ends up empty too. Falling back to DEFAULT_BUFFS lets the
      // manage popover still resolve names + colours for those
      // default ids. Previously it incorrectly rendered "no buffs on
      // this token" even when the token clearly had them.
      catalog = parsed.length > 0 ? parsed : DEFAULT_BUFFS.slice();
    } else {
      catalog = DEFAULT_BUFFS.slice();
    }
  } catch {
    catalog = DEFAULT_BUFFS.slice();
  }
}

async function loadTokenState(): Promise<void> {
  if (!tokenId) return;
  try {
    const items = await OBR.scene.items.getItems([tokenId]);
    if (items.length === 0) {
      myBuffIds = [];
      tokenName = "角色";
      return;
    }
    const tok = items[0];
    tokenName = tok.name || "角色";
    const ids = (tok.metadata as any)[STATUS_BUFFS_KEY];
    myBuffIds = Array.isArray(ids) ? ids.filter((x: any) => typeof x === "string") : [];
  } catch {
    myBuffIds = [];
  }
}

function render(): void {
  titleEl.textContent = `${tokenName} · buff`;
  // Resolve buff IDs through the catalog. Drop ids whose entry is
  // missing (they'd render as undefined; better to silently skip).
  const myBuffs = myBuffIds
    .map((id) => catalog.find((b) => b.id === id))
    .filter((b): b is BuffDef => !!b);

  if (myBuffs.length === 0) {
    gridEl.innerHTML = `<div class="empty">该角色没有 buff</div>`;
    return;
  }

  gridEl.innerHTML = myBuffs.map((b) => {
    const fg = textColorFor(b.color);
    return `<div class="bubble" data-id="${escapeHtml(b.id)}"
                 style="background:${escapeHtml(b.color)};color:${escapeHtml(fg)}">${escapeHtml(b.name)}</div>`;
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
  const buff = catalog.find((b) => b.id === id);
  if (!buff) return;
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
  await loadCatalog();
  await loadTokenState();
  render();

  // Re-render when the catalog changes (e.g. user edits a buff
  // colour from the palette while this popover is open).
  OBR.scene.onMetadataChange(async () => {
    await loadCatalog();
    render();
  });
  // Re-render when the token's buff list changes — including
  // changes WE just made via a manage-transfer drag (the capture
  // overlay's metadata write triggers items.onChange here too).
  OBR.scene.items.onChange(async () => {
    await loadTokenState();
    render();
  });

  // If the token disappears from the scene (deleted while the
  // popover is open), close ourselves rather than showing stale
  // data forever.
  OBR.scene.items.onChange(async (items) => {
    if (!tokenId) return;
    const stillThere = items.some((it) => it.id === tokenId);
    if (!stillThere) {
      try { await OBR.popover.close(POPOVER_ID); } catch {}
    }
  });
});
