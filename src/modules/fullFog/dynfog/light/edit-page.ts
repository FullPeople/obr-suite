// Light settings — runs INSIDE the right-click context menu via
// `contextMenu.create({ embed: { url, height } })`.
//
// Basic light controls plus one optional ownership override. Automatic
// ownership uses bound cards first, then ordinary player-created tokens.
//
// One addition, and it does not cost a field: AMBIENT rides in the Type
// group as a third option. It is ours rather than upstream's, and it is
// load-bearing for light occlusion — a wall sconce flagged ambient stays
// visible to a player who is not carrying their own torch, and without
// it an occluded scene goes black for them. Ambient implies PRIMARY,
// which is what every fixed light source in practice wants to be.
//
// The target is the current selection — that's the token whose context
// menu opened this embed — re-resolved on selection change so the panel
// follows if the GM clicks another light without closing the menu.

import OBR, { type GridScale, type Item } from "@owlbear-rodeo/sdk";
import { getLocalLang, getState, onStateChange, startSceneSync } from "../../../../state";
import { LIGHT_KEY } from "../ids";
import { isPlainObject } from "../meta";
import { VISION_KEY, readVisionOwnership, type VisionOwnership } from "./visionPolicy";
import {
  ANGLE_CONE_INNER,
  ANGLE_CONE_OUTER,
  ANGLE_FULL_INNER,
  ANGLE_FULL_OUTER,
  FALLOFF_HARD,
  FALLOFF_SOFT,
  normaliseLightConfig,
  withDefaults,
  type LightConfig,
} from "./config";

const en = getLocalLang() === "en";
if (en) {
  document.title = "Light settings · fullFog";
  document.querySelectorAll<HTMLElement>("[data-en]").forEach((el) => {
    el.textContent = el.dataset.en!;
  });
  document.querySelectorAll<HTMLElement>("[data-en-title]").forEach((el) => {
    el.title = el.dataset.enTitle!;
  });
}

const panelEl = document.getElementById("panel") as HTMLDivElement;
const statusEl = document.getElementById("status") as HTMLDivElement;
const rangeEl = document.getElementById("range") as HTMLInputElement;
const rangeUnitEl = document.getElementById("range-unit") as HTMLSpanElement;
const angleEl = document.getElementById("angle") as HTMLDivElement;
const edgeEl = document.getElementById("edge") as HTMLDivElement;
const typeEl = document.getElementById("type") as HTMLDivElement;
const rotateBtn = document.getElementById("btn-rotate") as HTMLButtonElement;
const removeBtn = document.getElementById("btn-remove") as HTMLButtonElement;
const visionField = document.createElement("label");
visionField.className = "field";
visionField.style.cssText = "display:block;margin-top:8px;font-size:11px";
const visionLabel = document.createElement("span");
visionLabel.textContent = en ? "Vision owner" : "视野归属";
const visionOwner = document.createElement("select");
visionOwner.style.cssText = "display:block;width:100%;margin-top:4px;padding:4px;background:#1e2230;color:#eee;border:1px solid #50566a;border-radius:4px";
visionOwner.title = en ? "Uses the card owner or player who created the character. Shared vision lets all players use these sources. Hidden and GM-only units are excluded." : "自动识别角色卡归属或创建角色的玩家。开启共享视野后，全部玩家可使用这些视野；隐藏单位和仅主持人单位除外。";
visionField.append(visionLabel, visionOwner);
const visionError = document.createElement("span");
visionError.style.cssText = "display:block;color:#f0b8a0;font-size:10px;margin-top:3px";
visionError.setAttribute("role", "status");
visionField.append(visionError);
panelEl.querySelector(".actions")?.before(visionField);

let gridDpi = 150;
let gridScale: GridScale | null = null;
let targetIds: string[] = [];
let values: Required<LightConfig> | null = null;
/** True while we're repainting the UI from scene data — stops the
 *  input handlers from echoing that back as a write. */
let syncing = false;
let currentRole: "GM" | "PLAYER" = "PLAYER";
let loadRevision = 0;
let sceneRevision = 0;
let savedVisionOwner = "auto";
let visionWriteRevision = 0;

function automaticOwnerLabel(): string {
  return getState().fogShareVision
    ? (en ? "All players (automatic)" : "全部玩家（自动归属）")
    : (en ? "Owning player (automatic)" : "所属玩家（自动归属）");
}

function setStatus(text: string | null): void {
  if (text) {
    statusEl.textContent = text;
    statusEl.classList.remove("hidden");
    panelEl.classList.add("hidden");
  } else {
    statusEl.classList.add("hidden");
    panelEl.classList.remove("hidden");
  }
}

function setSegment(group: HTMLElement, value: string): void {
  for (const button of group.querySelectorAll<HTMLButtonElement>("button")) {
    button.setAttribute(
      "aria-pressed",
      button.dataset.value === value ? "true" : "false",
    );
  }
}

function pxToUnits(px: number): string {
  if (!gridScale) return String(Math.round(px));
  const { multiplier, digits } = gridScale.parsed;
  return ((px / gridDpi) * multiplier).toFixed(digits);
}

function unitsToPx(text: string): number {
  const parsed = parseFloat(text);
  if (!Number.isFinite(parsed)) return NaN;
  // Mirror pxToUnits exactly: with no grid scale it shows raw pixels,
  // so it has to parse raw pixels back. Scaling here regardless meant a
  // bare focus-then-blur on the Range field, changing nothing,
  // multiplied attenuationRadius by the grid dpi every time.
  if (!gridScale) return parsed;
  const multiplier = gridScale.parsed.multiplier;
  if (multiplier === 0) return NaN;
  return (parsed / multiplier) * gridDpi;
}

function paint(config: Required<LightConfig>): void {
  syncing = true;
  values = config;
  rangeEl.value = pxToUnits(config.attenuationRadius);
  rangeUnitEl.textContent = gridScale?.parsed.unit ?? "px";
  const isCone = config.outerAngle !== 360;
  setSegment(angleEl, isCone ? "CONE" : "FULL");
  setSegment(edgeEl, config.falloff > 1 ? "SOFT" : "HARD");
  // Ambient wins the Type group: it is the thing that changes how the
  // light is TREATED, and an ambient light is always primary anyway.
  setSegment(typeEl, config.ambient ? "AMBIENT" : config.lightType);
  rotateBtn.classList.toggle("hidden", !isCone);
  syncing = false;
}

/** Merge a patch into every selected item's light config. Reading the
 *  existing value per item (rather than writing a whole config built
 *  from the panel) keeps a multi-selection with different ranges from
 *  being flattened by a single toggle press. */
async function patch(update: Partial<LightConfig>): Promise<void> {
  if (targetIds.length === 0 || currentRole !== "GM") return;
  const scene = sceneRevision;
  try {
    await OBR.scene.items.updateItems(targetIds, (items) => {
      if (scene !== sceneRevision || currentRole !== "GM") return;
      for (const item of items) {
        const metadata = item.metadata as Record<string, unknown>;
        const current = metadata[LIGHT_KEY];
        if (isPlainObject(current)) {
          Object.assign(current, update);
        } else {
          metadata[LIGHT_KEY] = { ...update };
        }
      }
    });
  } catch (e) {
    console.error("[dynfog/light-edit] write failed", e);
  }
}

async function load(): Promise<void> {
  const revision = ++loadRevision;
  const scene = sceneRevision;
  // Old controls must not write onto the newly selected target while its
  // ownership/role read is pending.
  targetIds = [];
  let selection: string[] = [];
  try {
    selection = (await OBR.player.getSelection()) ?? [];
  } catch {}
  if (revision !== loadRevision || scene !== sceneRevision) return;
  if (selection.length === 0) {
    setStatus(en ? "No token selected." : "未选中目标。");
    return;
  }

  try {
    gridDpi = await OBR.scene.grid.getDpi();
  } catch {}
  try {
    gridScale = await OBR.scene.grid.getScale();
  } catch {}

  let items: Item[] = [];
  try {
    items = await OBR.scene.items.getItems(selection);
  } catch {}
  const [role, players] = await Promise.all([
    OBR.player.getRole().catch(() => "PLAYER" as const),
    OBR.party.getPlayers().catch(() => []),
  ]);
  if (revision !== loadRevision || scene !== sceneRevision) return;
  currentRole = role;
  const withLight = items.find((item) => LIGHT_KEY in item.metadata);
  if (!withLight) {
    setStatus(en ? "This token has no light." : "该目标没有光源。");
    return;
  }
  targetIds = selection;
  const config =
    normaliseLightConfig(
      (withLight.metadata as Record<string, unknown>)[LIGHT_KEY],
    ) ?? {};
  setStatus(null);
  paint(withDefaults(config, gridDpi));
  visionOwner.replaceChildren();
  const option = (value: string, text: string) => {
    const el = document.createElement("option"); el.value = value; el.textContent = text; visionOwner.append(el);
  };
  option("auto", automaticOwnerLabel());
  option("gm", en ? "GM only" : "仅主持人");
  for (const player of players.filter(player => player.role === "PLAYER")) option(`owner:${player.id}`, player.name);
  const own = readVisionOwnership(withLight.metadata[VISION_KEY]);
  let selected = own.mode;
  if (own.mode === "owners") {
    selected = "owners";
    if (own.ownerIds.length === 1) {
      const value = `owner:${own.ownerIds[0]}`;
      if (![...visionOwner.options].some(option => option.value === value)) option(value, en ? "Assigned player (offline)" : "已指定的玩家（离线）");
      visionOwner.value = value;
    } else {
      option("owners", en ? `${own.ownerIds.length} assigned players` : `已指定 ${own.ownerIds.length} 位玩家`);
      visionOwner.value = "owners";
    }
  } else visionOwner.value = selected;
  savedVisionOwner = visionOwner.value;
  visionError.textContent = "";
  for (const control of panelEl.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>("input, button, select")) control.disabled = currentRole !== "GM";
}

visionOwner.addEventListener("change", async () => {
  if (syncing || currentRole !== "GM" || !targetIds.length) return;
  const value = visionOwner.value;
  if (value === "owners") return;
  const ownership: VisionOwnership = value.startsWith("owner:")
    ? { mode: "owners", ownerIds: [value.slice(6)] }
    : { mode: value === "gm" ? "gm" : "auto", ownerIds: [] };
  const scene = sceneRevision;
  const targets = [...targetIds];
  const revision = ++visionWriteRevision;
  try {
    await OBR.scene.items.updateItems(targets, items => {
      if (scene !== sceneRevision || currentRole !== "GM" || revision !== visionWriteRevision) return;
      for (const item of items) {
        if (ownership.mode === "auto") delete item.metadata[VISION_KEY];
        else item.metadata[VISION_KEY] = ownership;
      }
    });
    if (scene === sceneRevision && revision === visionWriteRevision && JSON.stringify(targets) === JSON.stringify(targetIds)) {
      savedVisionOwner = value;
      visionError.textContent = "";
    }
  } catch (error) {
    console.warn("[dynfog/light-edit] vision owner update failed", error);
    if (scene !== sceneRevision || revision !== visionWriteRevision || JSON.stringify(targets) !== JSON.stringify(targetIds)) return;
    visionOwner.value = savedVisionOwner;
    visionError.textContent = en ? "Not saved. Choose the owner again to retry." : "保存失败，请再次选择归属重试。";
  }
});

// --- input wiring -----------------------------------------------------------

function commitRange(): void {
  if (syncing) return;
  const px = unitsToPx(rangeEl.value);
  if (!Number.isFinite(px) || px <= 0) {
    if (values) rangeEl.value = pxToUnits(values.attenuationRadius);
    return;
  }
  void patch({ attenuationRadius: px });
}

rangeEl.addEventListener("blur", commitRange);
rangeEl.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    commitRange();
    (event.target as HTMLElement).blur();
  } else if (event.key === "Escape") {
    if (values) rangeEl.value = pxToUnits(values.attenuationRadius);
    (event.target as HTMLElement).blur();
  } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
    // One grid cell per press, ten with shift — same feel as upstream's
    // NumberField.
    event.preventDefault();
    if (!values) return;
    const step = gridDpi * (event.shiftKey ? 10 : 1);
    const next = Math.max(
      1,
      values.attenuationRadius + (event.key === "ArrowUp" ? step : -step),
    );
    values = { ...values, attenuationRadius: next };
    rangeEl.value = pxToUnits(next);
    void patch({ attenuationRadius: next });
  }
});

angleEl.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest("button");
  if (!button?.dataset.value) return;
  const cone = button.dataset.value === "CONE";
  setSegment(angleEl, button.dataset.value);
  rotateBtn.classList.toggle("hidden", !cone);
  void patch({
    innerAngle: cone ? ANGLE_CONE_INNER : ANGLE_FULL_INNER,
    outerAngle: cone ? ANGLE_CONE_OUTER : ANGLE_FULL_OUTER,
  });
});

edgeEl.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest("button");
  if (!button?.dataset.value) return;
  const soft = button.dataset.value === "SOFT";
  setSegment(edgeEl, button.dataset.value);
  void patch({ falloff: soft ? FALLOFF_SOFT : FALLOFF_HARD });
});

typeEl.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest("button");
  if (!button?.dataset.value) return;
  setSegment(typeEl, button.dataset.value);
  // Both fields are written every time, so switching away from AMBIENT
  // actually clears the flag rather than leaving a primary light that
  // is still quietly exempt from occlusion.
  if (button.dataset.value === "AMBIENT") {
    void patch({ ambient: true, lightType: "PRIMARY" });
  } else {
    void patch({
      ambient: false,
      lightType: button.dataset.value as "PRIMARY" | "SECONDARY",
    });
  }
});

rotateBtn.addEventListener("click", () => {
  if (!values) return;
  const rotation = (values.rotation + 90) % 360;
  values = { ...values, rotation };
  void patch({ rotation });
});

removeBtn.addEventListener("click", async () => {
  if (targetIds.length === 0 || currentRole !== "GM") return;
  const scene = sceneRevision;
  try {
    await OBR.scene.items.updateItems(targetIds, (items) => {
      if (scene !== sceneRevision || currentRole !== "GM") return;
      for (const item of items) {
        delete (item.metadata as Record<string, unknown>)[LIGHT_KEY];
      }
    });
    setStatus(en ? "Light removed." : "光源已移除。");
  } catch (e) {
    console.error("[dynfog/light-edit] remove failed", e);
  }
});

OBR.onReady(async () => {
  startSceneSync();
  const stopState = onStateChange(() => {
    // Update only the label: a settings change must not discard an edit.
    const automatic = visionOwner.querySelector('option[value="auto"]');
    if (automatic) automatic.textContent = automaticOwnerLabel();
  });
  window.addEventListener("pagehide", stopState, { once: true });
  OBR.scene.onReadyChange(ready => {
    sceneRevision++; loadRevision++; targetIds = [];
    if (ready) void load();
    else setStatus(en ? "No scene open." : "未打开场景。");
  });
  try {
    OBR.player.onChange(player => {
      currentRole = player.role;
      for (const control of panelEl.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>("input, button, select")) control.disabled = currentRole !== "GM";
      void load();
    });
  } catch {}
  try {
    OBR.scene.items.onChange(() => {
      // Don't fight the user mid-edit: skip the repaint while a field
      // has focus.
      if (document.activeElement === rangeEl) return;
      void load();
    });
  } catch {}
  OBR.party.onChange(() => { if (document.activeElement !== visionOwner) void load(); });
  await load();
});
