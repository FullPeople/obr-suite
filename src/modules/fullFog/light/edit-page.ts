// Light edit — runs INSIDE the right-click context menu via
// `contextMenu.create({ embed: { url, height } })`. The page reads
// the player's current selection (which is the token whose context
// menu opened us) instead of taking the id as a URL param, matching
// the upstream dynamic-fog Menu.tsx pattern.
//
// Three sliders (radius / source radius / falloff) writing back to
// the target's LIGHT_KEY metadata. Live updates while sliders move
// so the DM sees the illumination reshape in real time
// (vision/index.ts watches scene.items.onChange and re-renders).

import OBR from "@owlbear-rodeo/sdk";
import {
  LIGHT_KEY,
  DEFAULT_LIGHT_FALLOFF,
  DEFAULT_LIGHT_SOURCE_RADIUS,
  DEFAULT_LIGHT_RADIUS_CELLS,
  type LightConfig,
} from "./types";

const radiusEl = document.getElementById("radius") as HTMLInputElement;
const radiusValEl = document.getElementById("radius-val") as HTMLSpanElement;
const sourceEl = document.getElementById("source") as HTMLInputElement;
const sourceValEl = document.getElementById("source-val") as HTMLSpanElement;
const falloffEl = document.getElementById("falloff") as HTMLInputElement;
const falloffValEl = document.getElementById("falloff-val") as HTMLSpanElement;
const titleEl = document.getElementById("title") as HTMLHeadingElement;
const removeBtn = document.getElementById("btn-remove") as HTMLButtonElement;

let dpi = 150;
/** Resolved every render — the active selection's id when the
 *  context-menu embed was opened. Re-resolved on selection change so
 *  the panel keeps targeting the right token if the user re-clicks
 *  another light without closing the menu. */
let itemId: string | null = null;
let itemIds: string[] = [];

function pxToCells(px: number): number {
  return px / dpi;
}
function cellsToPx(cells: number): number {
  return cells * dpi;
}

function applyUI(cfg: LightConfig): void {
  // Radius slider stored in CELLS (= 5ft per cell on a 5ft grid) for
  // intuitive editing; the underlying metadata stays in pixels.
  const cells = Math.round(pxToCells(cfg.attenuationRadius) * 2) / 2;
  radiusEl.value = String(cells);
  radiusValEl.textContent = `${cells} 格`;
  sourceEl.value = String(cfg.sourceRadius);
  sourceValEl.textContent = `${cfg.sourceRadius} px`;
  falloffEl.value = String(cfg.falloff);
  falloffValEl.textContent = cfg.falloff.toFixed(2);
}

async function load(): Promise<void> {
  try {
    const sel = await OBR.player.getSelection();
    itemIds = Array.isArray(sel) ? sel.slice() : [];
    itemId = itemIds[0] ?? null;
  } catch {
    itemIds = [];
    itemId = null;
  }
  if (!itemId) {
    titleEl.textContent = "未选中目标";
    return;
  }
  try { dpi = await OBR.scene.grid.getDpi(); } catch {}
  try {
    const items = await OBR.scene.items.getItems([itemId]);
    if (items.length === 0) {
      titleEl.textContent = "未找到目标 token";
      return;
    }
    const it = items[0] as any;
    const cfg = (it.metadata?.[LIGHT_KEY] as LightConfig | undefined) ?? {
      attenuationRadius: cellsToPx(DEFAULT_LIGHT_RADIUS_CELLS),
      sourceRadius: DEFAULT_LIGHT_SOURCE_RADIUS,
      falloff: DEFAULT_LIGHT_FALLOFF,
    };
    applyUI(cfg);
    titleEl.textContent = `光源设置 · ${it.name ?? "(未命名)"}`;
  } catch (e) {
    console.error("[fullFog/light-edit] load failed", e);
  }
}

let writeTimer: number | null = null;
function scheduleWrite(): void {
  if (writeTimer != null) clearTimeout(writeTimer);
  writeTimer = window.setTimeout(async () => {
    writeTimer = null;
    if (itemIds.length === 0) return;
    const cfg: LightConfig = {
      attenuationRadius: cellsToPx(Number(radiusEl.value)),
      sourceRadius: Number(sourceEl.value),
      falloff: Number(falloffEl.value),
    };
    try {
      await OBR.scene.items.updateItems(itemIds, (drafts) => {
        for (const d of drafts) {
          (d.metadata as any)[LIGHT_KEY] = cfg;
        }
      });
    } catch (e) {
      console.error("[fullFog/light-edit] write failed", e);
    }
  }, 120);
}

radiusEl.addEventListener("input", () => {
  radiusValEl.textContent = `${radiusEl.value} 格`;
  scheduleWrite();
});
sourceEl.addEventListener("input", () => {
  sourceValEl.textContent = `${sourceEl.value} px`;
  scheduleWrite();
});
falloffEl.addEventListener("input", () => {
  falloffValEl.textContent = Number(falloffEl.value).toFixed(2);
  scheduleWrite();
});
removeBtn.addEventListener("click", async () => {
  if (itemIds.length === 0) return;
  try {
    await OBR.scene.items.updateItems(itemIds, (drafts) => {
      for (const d of drafts) {
        delete (d.metadata as any)[LIGHT_KEY];
      }
    });
    // Removing the metadata makes the "Light Settings" filter no
    // longer match → context menu hides this embed automatically on
    // the next open. No need to manually close anything.
    titleEl.textContent = "光源已移除";
  } catch (e) {
    console.error("[fullFog/light-edit] remove failed", e);
  }
});

OBR.onReady(async () => {
  await load();
  // Re-load on selection change so the embed keeps targeting the
  // right token if the user clicks elsewhere without closing the
  // context menu.
  try {
    OBR.player.onChange(() => { void load(); });
  } catch {}
  try {
    OBR.scene.items.onChange(() => { void load(); });
  } catch {}
});
