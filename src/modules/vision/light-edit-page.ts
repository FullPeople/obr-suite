// Light editor popover. Reads the target item's LightSource metadata
// into the form on open, writes back on Save.

import OBR from "@owlbear-rodeo/sdk";
import { LIGHT_KEY, LightSource, PLUGIN_ID } from "./types";

const POPOVER_ID = `${PLUGIN_ID}/light-edit`;
const params = new URLSearchParams(location.search);
const itemId = params.get("id") ?? "";

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const $i = (id: string) => document.getElementById(id) as HTMLInputElement;

const inpColorR = $i("inp-color-r");
const inpDarkR = $i("inp-dark-r");
const inpColor = $i("inp-color");
const inpFalloff = $i("inp-falloff");
const inpRays = $i("inp-rays");

async function load(): Promise<void> {
  if (!itemId) return;
  try {
    const items = await OBR.scene.items.getItems([itemId]);
    if (items.length === 0) return;
    const m = (items[0].metadata as any)?.[LIGHT_KEY] as Partial<LightSource> | undefined;
    inpColorR.value = String(m?.colorRadius ?? 30);
    inpDarkR.value = String(m?.darkRadius ?? 30);
    inpColor.value = (m?.color as string) || "#ffd479";
    inpFalloff.value = String(m?.falloff ?? 8);
    inpRays.value = String(m?.rays ?? 240);
  } catch (e) {
    console.error("[vision/light-edit] load failed", e);
  }
}

async function save(): Promise<void> {
  if (!itemId) return;
  const next: LightSource = {
    colorRadius: clamp(Number(inpColorR.value) || 0, 0, 500),
    darkRadius: clamp(Number(inpDarkR.value) || 0, 0, 500),
    color: inpColor.value || "#ffd479",
    falloff: clamp(Number(inpFalloff.value) || 0, 0, 40),
    rays: clamp(Math.round(Number(inpRays.value) || 240), 60, 720),
  };
  if (!next.darkRadius || next.darkRadius <= 0) delete next.darkRadius;
  try {
    await OBR.scene.items.updateItems([itemId], (drafts) => {
      for (const d of drafts) {
        (d.metadata as any)[LIGHT_KEY] = next;
      }
    });
  } catch (e) {
    console.error("[vision/light-edit] save failed", e);
  }
  try { await OBR.popover.close(POPOVER_ID); } catch {}
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

OBR.onReady(async () => {
  await load();
  $("btn-save").addEventListener("click", () => { void save(); });
  const cancel = async () => { try { await OBR.popover.close(POPOVER_ID); } catch {} };
  $("btn-cancel").addEventListener("click", cancel);
  $("x").addEventListener("click", cancel);
  window.addEventListener("keydown", async (e) => {
    if (e.key === "Enter") { e.preventDefault(); await save(); }
    else if (e.key === "Escape") { e.preventDefault(); await cancel(); }
  });
});
